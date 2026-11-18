import { ensureOperator } from "./cancel-line.js";
import { testTradingAdmission } from "./trading-admission.js";
import { eq, sql } from "drizzle-orm";
import { withTransaction, workingOrders, type Transaction, type Database } from "@waitron/db";
import {
  readBillEditState,
  requireOrderBillEditor,
  type OrderEditAuthority,
} from "../bill-editing.js";
import { pricePortionRound } from "./portion-bill.js";
import type { TradingContext } from "../trading-context.js";
import {
  sendLines as send,
  setLineCourse as course,
  updateOrderLine as line,
  updateHeldOrder as whole,
  setWorkingOrderLabel as label,
  setOrderReceiptLanguage as language,
  setOrderInvoiceChoice as invoice,
  placeOrder as place,
  assertPartyBillOpen,
  bumpRevision,
  fireLines,
  insertTabRound,
  priceTabRound,
  type TabRoundLine,
  abandonHeldOrder as abandon,
} from "../working-order.js";
import type { OrderAttendance, UpdateHeldOrderRequest } from "../working-order.js";
import { moveDishesToStation as moveStation, type StationMoveActor } from "../station-move.js";

const OPERATOR = "cccccccc-0000-4000-8000-0000000000f1";
async function authority(tx: Transaction, id: string, operatorId: string | undefined) {
  const [order] = await tx
    .select({ partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(eq(workingOrders.id, id));
  return {
    operatorId: order?.partyId == null ? operatorId : (operatorId ?? OPERATOR),
    expectedEdit: order?.partyId == null ? null : await readBillEditState(tx, id),
  };
}

// Content fixtures provide current observations; contract tests call the raw writers directly.
export async function sendLines(
  tx: Transaction,
  cfg: Parameters<typeof send>[1],
  id: string,
  lineNos: number[],
  attendance?: OrderAttendance & { personId: string },
) {
  return send(tx, cfg, id, lineNos, await authority(tx, id, attendance?.personId), attendance);
}
export async function setLineCourse(
  tx: Transaction,
  cfg: Parameters<typeof course>[1],
  id: string,
  lineNo: number,
  courseId: string | null,
  attendance?: OrderAttendance & { personId: string },
) {
  return course(
    tx,
    cfg,
    id,
    lineNo,
    courseId,
    await authority(tx, id, attendance?.personId),
    attendance,
  );
}
export async function updateOrderLine(
  tx: Transaction,
  cfg: Parameters<typeof line>[1],
  id: string,
  lineNo: number,
  patch: Omit<Parameters<typeof line>[4], "portionLineNos"> & { portionLineNos?: number[] },
  revision: number,
  operatorId?: string,
  attendance?: OrderAttendance,
) {
  const observed = await authority(tx, id, operatorId);
  if (observed.operatorId !== undefined) await ensureOperator(tx, observed.operatorId);
  return line(
    tx,
    cfg,
    id,
    lineNo,
    { portionLineNos: [], ...patch },
    revision,
    { ...observed, admission: testTradingAdmission() },
    attendance,
  );
}
export function updateHeldOrder(
  deps: Parameters<typeof whole>[0],
  cfg: Parameters<typeof whole>[1],
  id: string,
  input: Omit<UpdateHeldOrderRequest, "expectedEdit">,
  issue?: undefined,
  attendance?: OrderAttendance,
): Promise<number>;
export function updateHeldOrder(
  deps: Parameters<typeof whole>[0],
  cfg: Parameters<typeof whole>[1],
  id: string,
  input: Omit<UpdateHeldOrderRequest, "expectedEdit"> & { operatorId: string },
  issue: NonNullable<Parameters<typeof whole>[4]>,
  attendance?: OrderAttendance,
): Promise<number>;
export async function updateHeldOrder(
  deps: Parameters<typeof whole>[0],
  cfg: Parameters<typeof whole>[1],
  id: string,
  input: Omit<UpdateHeldOrderRequest, "expectedEdit">,
  issue?: Parameters<typeof whole>[4],
  attendance?: OrderAttendance,
) {
  const observed = await withTransaction(deps.db, (tx) => authority(tx, id, input.operatorId));
  const request = {
    ...input,
    operatorId: observed.operatorId,
    expectedEdit: observed.expectedEdit,
  };
  return issue === undefined
    ? whole(deps, cfg, id, request, undefined, attendance)
    : (await whole(deps, cfg, id, { ...request, operatorId: input.operatorId! }, issue, attendance))
        .revision;
}

export async function setWorkingOrderLabel(
  db: Parameters<typeof label>[0],
  id: string,
  request: { label: string; revision: number },
  attendance?: Parameters<typeof label>[3],
) {
  const observed = await withTransaction(db, (tx) => authority(tx, id, attendance?.personId));
  return label(db, id, { ...request, ...observed }, attendance);
}

export async function setOrderReceiptLanguage(
  db: Parameters<typeof language>[0],
  id: string,
  request: { revision: number; language: unknown },
  attendance?: Parameters<typeof language>[3],
) {
  const observed = await withTransaction(db, (tx) => authority(tx, id, attendance?.personId));
  return language(db, id, { ...request, ...observed }, attendance);
}

export async function setOrderInvoiceChoice(
  db: Parameters<typeof invoice>[0],
  backend: Parameters<typeof invoice>[1],
  cfg: Parameters<typeof invoice>[2],
  id: string,
  request: Omit<Parameters<typeof invoice>[4], "operatorId" | "expectedEdit">,
  delivery?: Parameters<typeof invoice>[5],
  attendance?: Parameters<typeof invoice>[6],
) {
  const observed = await withTransaction(db, (tx) =>
    authority(tx, id, delivery?.personId ?? attendance?.personId),
  );
  return invoice(db, backend, cfg, id, { ...request, ...observed }, delivery, attendance);
}

export async function placeOrder(
  deps: Parameters<typeof place>[0],
  cfg: Parameters<typeof place>[1],
  id: string,
  operatorId: string,
) {
  const observed = await withTransaction(deps.db, (tx) => authority(tx, id, operatorId));
  return place(deps, cfg, id, operatorId, observed.expectedEdit);
}

type RoundStamp = { groupId?: string; creditedTo?: string } & Partial<OrderEditAuthority>;

/** Each dish row's index in the request, extras rows aside: dish rows by line number are the
 * request's lines in order. */
async function priceGroupedRound(
  tx: Transaction,
  cfg: TradingContext,
  id: string,
  lines: TabRoundLine[],
): ReturnType<typeof pricePortionRound> {
  const round = await priceTabRound(tx, cfg, id, lines, "checked");
  const dishes = round.rows
    .filter((row) => row.parentLineId == null)
    .sort((a, b) => a.lineNo - b.lineNo);
  return { round, requestOfRow: round.rows.map((row) => dishes.indexOf(row)) };
}

async function appendRound(
  tx: Transaction,
  cfg: TradingContext,
  id: string,
  lines: TabRoundLine[],
  stamp: RoundStamp,
  price: typeof pricePortionRound,
) {
  await assertPartyBillOpen(tx, id);
  await requireOrderBillEditor(
    tx,
    id,
    "expectedEdit" in stamp
      ? { operatorId: stamp.operatorId, expectedEdit: stamp.expectedEdit ?? null }
      : await authority(tx, id, stamp.creditedTo),
  );
  const { round, requestOfRow } = await price(tx, cfg, id, lines);
  const inserted = await insertTabRound(
    tx,
    cfg,
    round,
    round.rows.map((row) => ({
      ...row,
      groupId: stamp.groupId ?? null,
      creditedTo: stamp.creditedTo ?? null,
    })),
  );
  const requestOfDish = new Map(
    round.rows.flatMap((row, i) =>
      row.parentLineId == null ? [[row.lineNo, lines[requestOfRow[i]!]] as const] : [],
    ),
  );
  await fireLines(
    tx,
    cfg,
    id,
    inserted.map((row) => ({
      ...row,
      hold: requestOfDish.get(row.lineNo)?.hold === true,
      release: requestOfDish.get(row.lineNo)?.release === true,
    })),
  );
  await bumpRevision(tx, [id]);
}

/**
 * A round appended to an open party bill as the product's add writes it: priced once, one row per
 * dish, fired with each request line's `hold` and `release`. A `stamp` carrying `expectedEdit` is
 * the editing authority as given; otherwise the bill's current one is observed.
 */
export async function addTabRound(
  tx: Transaction,
  cfg: TradingContext,
  id: string,
  lines: TabRoundLine[],
  stamp: RoundStamp = {},
) {
  await appendRound(tx, cfg, id, lines, stamp, pricePortionRound);
}

/**
 * {@link addTabRound} with each request line stored as ONE row holding its whole quantity, bound to
 * no portion: the grouped shape the part-quantity paths still handle (A803 slice 1's D12), which
 * the product does not write for whole dishes.
 */
export async function addGroupedTabRound(
  tx: Transaction,
  cfg: TradingContext,
  id: string,
  lines: TabRoundLine[],
  stamp: RoundStamp = {},
) {
  await appendRound(tx, cfg, id, lines, stamp, priceGroupedRound);
}

export async function abandonHeldOrder(
  deps: Parameters<typeof abandon>[0],
  cfg: Parameters<typeof abandon>[1],
  id: string,
  attendance?: Parameters<typeof abandon>[4],
) {
  const observed = await withTransaction(deps.db, (tx) => authority(tx, id, attendance?.personId));
  return abandon(deps, cfg, id, observed, attendance);
}

export async function moveDishesToStation(
  tx: Transaction,
  cfg: Parameters<typeof moveStation>[1],
  id: string,
  request: Parameters<typeof moveStation>[3],
  mover: StationMoveActor,
  options?: Parameters<typeof moveStation>[5],
) {
  if (mover.personId === null)
    return moveStation(tx, cfg, id, request, { ...mover, kind: "kitchen" }, options);
  const observed = await authority(tx, id, mover.personId ?? undefined);
  return moveStation(
    tx,
    cfg,
    id,
    request,
    {
      ...mover,
      kind: "order",
      expectedEdit: observed.expectedEdit,
    },
    options,
  );
}

export async function observedOrderWriteBody(
  db: Database,
  method: string,
  path: string,
  body: unknown,
): Promise<unknown> {
  const match =
    /^\/api\/working-orders\/([^/]+)(?:\/(?:place|label|receipt-language|invoice-choice|rounds|adjustments(?:\/preview)?|lines(?:\/(?:\d+|send|recall|move-station))?))?$/.exec(
      path,
    );
  if (match === null || !["PUT", "POST", "DELETE"].includes(method)) return body;
  if (body !== undefined && (body === null || typeof body !== "object" || Array.isArray(body)))
    return body;
  if (body !== undefined && Object.hasOwn(body, "expectedEdit")) return body;
  const [row] = await db
    .select({ partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(eq(workingOrders.id, match[1]!.toLowerCase()));
  if (row?.partyId == null) return body;
  return { expectedEdit: await readBillEditState(db, match[1]!.toLowerCase()), ...body };
}

export function observedOrderSender(
  database: () => Database,
  send: typeof import("./bill-venue.js").send,
): typeof send {
  return async (app, cookie, method, path, body) =>
    send(app, cookie, method, path, await observedOrderWriteBody(database(), method, path, body));
}

export async function clearSavedOffer(db: Database | Transaction, billId: string, lineNo?: number) {
  await db.execute(sql`update working_order_lines
    set menu_item_id = null, menu_id = null, menu_name = null, menu_version_id = null,
        offer_department_id = null, department_name = null, unit_id = null, sold_in_each = null,
        offer_unit_name = null, offer_unit_precision = null, offer_vat_class = null,
        offer_category_name = null, hardware_unit = null, allergens = null, diet = null,
        diet_override = null, late_period_name = null, late_confirmed_by = null, sent_nutrition = null
    where working_order_id = ${billId} ${lineNo === undefined ? sql`` : sql`and line_no = ${lineNo}`}`);
}
