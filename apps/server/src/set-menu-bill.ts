import { and, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import {
  adjustmentLines,
  adjustments,
  billPaymentLines,
  billPayments,
  billSetMenuCopies,
  lineServiceCancellations,
  menuReleases,
  menuVersions,
  orderDraftLines,
  products,
  statementChunks,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import {
  AppError,
  contentLanguageCode,
  setMenuCopyOf,
  type BillSetMenuState,
  type DishPlace,
  type ServedSetMenuCopy,
} from "@waitron/shared";
import { serveRecordedSetMenus } from "@waitron/venue-service";
import "./errors.js";

export function notSetMenuLine() {
  return sql`${workingOrderLines.setMenuRole} is not 'set_menu'`;
}

export async function hasBillSetMenuLines(
  tx: Transaction,
  workingOrderId: string,
): Promise<boolean> {
  const [line] = await tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.workingOrderId, workingOrderId),
        isNotNull(workingOrderLines.setMenuRole),
      ),
    )
    .limit(1);
  return line !== undefined;
}

export async function hasDraftSetMenuLines(tx: Transaction, draftId: string): Promise<boolean> {
  const [line] = await tx
    .select({ id: orderDraftLines.id })
    .from(orderDraftLines)
    .where(and(eq(orderDraftLines.draftId, draftId), isNotNull(orderDraftLines.setMenuId)))
    .limit(1);
  return line !== undefined;
}

export async function isSetMenuBill(tx: Transaction, workingOrderId: string): Promise<boolean> {
  const [order] = await tx
    .select({
      partyId: workingOrders.partyId,
      dining: workingOrders.dining,
      serviceMode: workingOrders.serviceMode,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  return order !== undefined && isSetMenuBillRow(order);
}

/** {@link isSetMenuBill} for a bill row already read. */
export function isSetMenuBillRow(
  order: Pick<typeof workingOrders.$inferSelect, "partyId" | "dining" | "serviceMode">,
): boolean {
  return (
    order.dining === "takeaway" || (order.partyId !== null && order.serviceMode === "table_tab")
  );
}

/** `unwritten`: the bill's row when this transaction has not written it yet. */
export async function refuseUnlessSetMenuBill(
  tx: Transaction,
  workingOrderId: string,
  unwritten?: Pick<typeof workingOrders.$inferSelect, "partyId" | "dining" | "serviceMode">,
): Promise<void> {
  const holds =
    unwritten === undefined ? await isSetMenuBill(tx, workingOrderId) : isSetMenuBillRow(unwritten);
  if (!holds) throw new AppError("set_menu.not_seated", {});
}

/** Every (set menu, version) the bill records: a moved set menu can bring a second version (D26). */
export function readBillSetMenuVersions(
  tx: Transaction,
  workingOrderId: string,
): Promise<{ menuId: string; versionId: string }[]> {
  return tx
    .select({ menuId: billSetMenuCopies.setMenuId, versionId: billSetMenuCopies.menuVersionId })
    .from(billSetMenuCopies)
    .where(eq(billSetMenuCopies.workingOrderId, workingOrderId));
}

/** A (set menu, version) pair a bill records. */
export interface RecordedSetMenuVersion {
  menuId: string;
  versionId: string;
}

const copyConflict = {
  target: [
    billSetMenuCopies.workingOrderId,
    billSetMenuCopies.setMenuId,
    billSetMenuCopies.menuVersionId,
  ],
};

/** Records on `toBillId` every copy `fromBillId` records. */
export async function carryBillSetMenuCopies(
  tx: Transaction,
  fromBillId: string,
  toBillId: string,
): Promise<void> {
  await tx
    .insert(billSetMenuCopies)
    .select(
      tx
        .select({
          workingOrderId: sql<string>`${toBillId}`.as("working_order_id"),
          setMenuId: billSetMenuCopies.setMenuId,
          menuVersionId: billSetMenuCopies.menuVersionId,
        })
        .from(billSetMenuCopies)
        .where(eq(billSetMenuCopies.workingOrderId, fromBillId)),
    )
    .onConflictDoNothing(copyConflict);
}

/** Records on `billId` exactly these (set menu, version) pairs, keeping any it already records. */
export async function recordBillSetMenuVersions(
  tx: Transaction,
  billId: string,
  versions: readonly RecordedSetMenuVersion[],
): Promise<void> {
  const rows = versions.map(({ menuId, versionId }) => ({
    workingOrderId: billId,
    setMenuId: menuId,
    menuVersionId: versionId,
  }));
  for (const chunk of statementChunks(billSetMenuCopies, rows)) {
    await tx.insert(billSetMenuCopies).values(chunk).onConflictDoNothing(copyConflict);
  }
}

export async function readBillSetMenus(
  tx: Transaction,
  workingOrderId: string,
): Promise<BillSetMenuState> {
  const read = await readBillsSetMenus(tx, [workingOrderId], "recorded");
  return read.get(workingOrderId)!.setMenus;
}

interface BillSetMenusRead {
  setMenus: BillSetMenuState;
  setMenuCopies: ServedSetMenuCopy[];
}

export async function readBillsSetMenus(
  tx: Transaction,
  billIds: string[],
  declarations: "recorded" | "published",
): Promise<Map<string, BillSetMenusRead>> {
  if (billIds.length === 0) return new Map();
  const billValues = sql`(select value from json_each(${JSON.stringify(billIds)}))`;
  const lines = await tx
    .select({
      billId: workingOrderLines.workingOrderId,
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      role: workingOrderLines.setMenuRole,
      menuId: workingOrderLines.setMenuId,
      versionId: workingOrderLines.setMenuVersionId,
      setMenuLineId: workingOrderLines.setMenuLineId,
      place: workingOrderLines.setMenuPlace,
      countsAsCourseId: workingOrderLines.countsAsCourseId,
      priceCents: workingOrderLines.unitPriceGross,
      productId: workingOrderLines.productId,
      cancellationLineId: lineServiceCancellations.lineId,
      parentProductId: products.parentId,
    })
    .from(workingOrderLines)
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(lineServiceCancellations, eq(lineServiceCancellations.lineId, workingOrderLines.id))
    .where(
      and(
        inArray(workingOrderLines.workingOrderId, billValues),
        isNotNull(workingOrderLines.setMenuRole),
      ),
    )
    .orderBy(workingOrderLines.lineNo);
  const versions = await tx
    .select({
      billId: billSetMenuCopies.workingOrderId,
      menuId: billSetMenuCopies.setMenuId,
      versionId: billSetMenuCopies.menuVersionId,
    })
    .from(billSetMenuCopies)
    .where(inArray(billSetMenuCopies.workingOrderId, billValues));

  const menuLines = lines.filter((line) => line.role === "set_menu");
  const key = ({ menuId, versionId }: { menuId: string | null; versionId: string | null }) =>
    `${versionId}:${menuId}`;
  const requests = [
    ...new Map(
      [
        ...versions,
        ...menuLines.map(({ menuId, versionId }) => ({
          menuId: menuId!,
          versionId: versionId!,
        })),
      ].map((request) => [key(request), request]),
    ).values(),
  ];
  const served =
    requests.length === 0 ? [] : await serveRecordedSetMenus(tx, requests, declarations);
  const servedByVersion = new Map(requests.map((request, i) => [key(request), served[i]!]));
  const exact = new Map(
    (
      await tx
        .select({ id: workingOrders.id, exact: workingOrders.setMenusExact })
        .from(workingOrders)
        .where(inArray(workingOrders.id, billValues))
    ).map(({ id, exact }) => [id, exact]),
  );
  const placed = lines.filter((line) => line.role === "dish" && line.setMenuLineId !== null);
  const dishes = placed.length === 0 ? [] : await placedSetMenuDishes(tx, placed);
  const bills = billIds.map((billId) => {
    const billVersions = versions.filter((row) => row.billId === billId);
    const billMenus = menuLines.filter((row) => row.billId === billId);
    const copies = new Map<string, { copy: ServedSetMenuCopy; versionId: string }>();
    for (const row of [...billVersions, ...billMenus]) {
      const copy = servedByVersion.get(key(row))!;
      if (!copies.has(copy.key)) copies.set(copy.key, { copy, versionId: row.versionId! });
    }
    return {
      billId,
      billMenus,
      copies,
      recorded: recordedCopies([...copies.values()], billVersions),
    };
  });
  const publishOrder = await versionPublishOrder(
    tx,
    bills.flatMap(({ recorded }) => tiedVersions(recorded)),
  );
  return new Map(
    bills.map(({ billId, billMenus, copies, recorded }) => [
      billId,
      {
        setMenus: {
          copies: [...copies.values()].map(({ copy, versionId }) => setMenuCopyOf(copy, versionId)),
          recorded: newestRecorded(recorded, publishOrder),
          setMenus: billMenus.map(({ id, lineNo, menuId, versionId }) => ({
            lineId: id,
            lineNo,
            copyId: servedByVersion.get(key({ menuId, versionId }))!.key,
          })),
          dishes: dishes.filter((dish) => dish.billId === billId).map(({ dish }) => dish),
          exact: exact.get(billId)!,
        },
        setMenuCopies: [...copies.values()].map(({ copy }) => copy),
      },
    ]),
  );
}

type RecordedCopy = { menuId: string; versionId: string; changedAt: string };

/** The bill's copies its recorded versions hold. Taken from the bill's copies, so a version whose
 *  copy another recorded version also holds is never named. */
function recordedCopies(
  copies: readonly { copy: ServedSetMenuCopy; versionId: string }[],
  recorded: readonly { menuId: string; versionId: string }[],
): RecordedCopy[] {
  const pairs = new Set(recorded.map(({ menuId, versionId }) => `${versionId}:${menuId}`));
  return copies
    .filter(({ copy, versionId }) => pairs.has(`${versionId}:${copy.menuId}`))
    .map(({ copy, versionId }) => ({ menuId: copy.menuId, versionId, changedAt: copy.changedAt }));
}

/** The versions whose copy shares its set menu's change time with another recorded copy. */
function tiedVersions(recorded: readonly RecordedCopy[]): string[] {
  return recorded
    .filter((one) =>
      recorded.some(
        (other) =>
          other !== one && other.menuId === one.menuId && other.changedAt === one.changedAt,
      ),
    )
    .map(({ versionId }) => versionId);
}

/** The newest of the bill's recorded versions of each set menu, the one the till offers: by the
 *  copy's own change time, as `markNewestOnSale` picks for a new bill, then by publish order. */
function newestRecorded(
  recorded: readonly RecordedCopy[],
  publishOrder: ReadonlyMap<string, number>,
): Record<string, string> {
  const newest = new Map<string, RecordedCopy>();
  for (const copy of recorded) {
    const current = newest.get(copy.menuId);
    if (
      current === undefined ||
      copy.changedAt > current.changedAt ||
      (copy.changedAt === current.changedAt &&
        publishOrder.get(copy.versionId)! > publishOrder.get(current.versionId)!)
    )
      newest.set(copy.menuId, copy);
  }
  return Object.fromEntries([...newest].map(([menuId, { versionId }]) => [menuId, versionId]));
}

/** Each version's place in the order the versions went on sale: by when its release activated, then
 *  by its number, the order `liveVersions` chooses by within one menu. */
async function versionPublishOrder(
  tx: Transaction,
  versionIds: readonly string[],
): Promise<Map<string, number>> {
  if (versionIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: menuVersions.id })
    .from(menuVersions)
    .innerJoin(menuReleases, eq(menuReleases.versionId, menuVersions.id))
    .where(
      inArray(menuVersions.id, sql`(select value from json_each(${JSON.stringify(versionIds)}))`),
    )
    .orderBy(menuReleases.activatesAt, menuVersions.number, menuVersions.id);
  return new Map(rows.map(({ id }, index) => [id, index]));
}

/** Which of the dishes `lineIds` carry a comp or discount, on the dish or on one of its extras:
 * such a dish moves only with its set menu. */
export async function adjustedDishIds(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<Set<string>> {
  const extras = await tx
    .select({ id: workingOrderLines.id, parentLineId: workingOrderLines.parentLineId })
    .from(workingOrderLines)
    .where(
      inArray(
        workingOrderLines.parentLineId,
        sql`(select value from json_each(${JSON.stringify(lineIds)}))`,
      ),
    );
  const reduced = await reducedLineIds(tx, [...lineIds, ...extras.map(({ id }) => id)]);
  const adjusted = new Set(lineIds.filter((id) => reduced.has(id)));
  for (const extra of extras) if (reduced.has(extra.id)) adjusted.add(extra.parentLineId!);
  return adjusted;
}

/** Which of `lineIds` carry a comp or discount. */
async function reducedLineIds(tx: Transaction, lineIds: readonly string[]): Promise<Set<string>> {
  // By the line, not the bill: Split after print copies a comp's rows onto the new lines, and a
  // move leaves them pointing at the moved line, while the comp itself stays on the bill it was
  // made on.
  const reduced = await tx
    .select({ lineId: adjustmentLines.lineId })
    .from(adjustmentLines)
    .where(
      and(
        inArray(
          adjustmentLines.lineId,
          sql`(select value from json_each(${JSON.stringify(lineIds)}))`,
        ),
        gt(adjustmentLines.reduction, 0),
      ),
    );
  return new Set(reduced.map(({ lineId }) => lineId));
}

async function placedSetMenuDishes(
  tx: Transaction,
  placed: {
    billId: string;
    id: string;
    productId: string | null;
    parentProductId: string | null;
    setMenuLineId: string | null;
    place: number | null;
    priceCents: number;
    countsAsCourseId: string | null;
    cancellationLineId: string | null;
  }[],
) {
  const billValues = sql`(select value from json_each(${JSON.stringify([...new Set(placed.map(({ billId }) => billId))])}))`;
  const payments = await tx
    .select({ lineId: billPaymentLines.lineId })
    .from(billPaymentLines)
    .innerJoin(billPayments, eq(billPayments.id, billPaymentLines.billPaymentId))
    .where(inArray(billPayments.workingOrderId, billValues));
  const cancels = await tx
    .select({ lineId: adjustments.lineId, chargeKept: adjustments.chargeKept })
    .from(adjustments)
    .where(and(inArray(adjustments.workingOrderId, billValues), eq(adjustments.action, "cancel")));
  const fixed = new Set([
    ...payments.map(({ lineId }) => lineId),
    ...(await adjustedDishIds(
      tx,
      placed.map(({ id }) => id),
    )),
  ]);
  const cancelled = new Set<string>();
  for (const { lineId, chargeKept } of cancels) {
    if (lineId === null) continue;
    if (chargeKept) fixed.add(lineId);
    else cancelled.add(lineId);
  }
  return placed
    .filter(({ id }) => !cancelled.has(id))
    .map((line) => ({
      billId: line.billId,
      dish: {
        lineId: line.id,
        productId: line.parentProductId ?? line.productId!,
        variantId: line.parentProductId === null ? null : line.productId,
        setMenuLineId: line.setMenuLineId!,
        place: line.place!,
        priceCents: line.priceCents,
        countsAsCourseId: line.countsAsCourseId!,
        movable: line.cancellationLineId === null && !fixed.has(line.id),
      },
    }));
}

export function setMenuLineDescriptions(
  { name, terms }: { name: string; terms: Pick<ServedSetMenuCopy["terms"], "names"> },
  invoiceLocales: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    invoiceLocales.map((locale) => [
      locale,
      terms.names[locale]?.trim() || terms.names[contentLanguageCode(locale)]?.trim() || name,
    ]),
  );
}

/** Server-validated lines carry their placement order and reservation into pricing. */
export const SET_MENU_DRAFT_LINE = Symbol("setMenuDraftLine");

export interface SetMenuDraftLine {
  draftLineId?: string;
  position: number;
  setMenuId: string;
  held: boolean;
  reserved: DishPlace | null;
}
