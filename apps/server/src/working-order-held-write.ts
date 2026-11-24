import "./errors.js";
import { withIssuanceTransaction } from "@waitron/core";
import { type Database, withTransaction, workingOrders, type Transaction } from "@waitron/db";
import { AppError, addDecimal } from "@waitron/shared";
import { eq } from "drizzle-orm";
import { type OrderEditAuthority, requireOrderBillEditor } from "./bill-editing.js";
import { issueIfFullyPaid, refuseBillHoldingMoney } from "./bill-payments.js";
import { assertBillHasNoUnsent } from "./bill-unsent.js";
import type { LateSendConfirmation } from "./late-send.js";
import { VENUE_SERVICE } from "./modules.js";
import { requireOrderDining } from "./order-dining.js";
import { ensureFamilyBill, bumpPartyRevision } from "./parties.js";
import type { TillSaleResult } from "./till-sale.js";
import { type TradingAdmission, requireEconomicWrite } from "./trading-admission.js";
import type { TradingContext, OriginConfig } from "./trading-context.js";
import {
  type OrderAttendance,
  captureOrderEdit,
  type WorkingOrderDeps,
} from "./working-order-context.js";
import {
  requireEditableOrder,
  type UpdateHeldOrderRequest,
  type IssueOnSave,
  readEditableOrder,
  type EditableParent,
  type LineIntent,
  type RequestedLine,
  type OrderLinePatch,
  refusePaymentInFlight,
} from "./working-order-edit-state.js";
import { applyLineEdits } from "./working-order-line-edits.js";
import { screenNote } from "./working-order-pricing.js";
import { countEdit, rowPortions, rowRise } from "./working-order-removal.js";

export async function setWorkingOrderLabel(
  db: Database,
  orderId: string,
  request: OrderEditAuthority & { label: string; revision: number },
  attendance?: OrderAttendance & { personId: string },
): Promise<number> {
  return withTransaction(db, async (tx) => {
    const { label } = await requireEditableOrder(tx, orderId, request.revision);
    await requireOrderBillEditor(tx, orderId, request);
    const changed = label !== request.label;
    if (changed) {
      await tx
        .update(workingOrders)
        .set({ label: request.label })
        .where(eq(workingOrders.id, orderId));
    }
    const revision = await countEdit(tx, orderId, request.revision, changed, true);
    if (changed)
      await captureOrderEdit(tx, attendance, orderId, attendance?.personId, revision, "label");
    return revision;
  });
}
/**
 * Save an edited copy of an OPEN order, from any node of the venue, by the rules
 * {@link applyLineEdits} states. A line of the basket naming a stored line by id, through the same
 * offer and variant, edits it; a line naming a different offer or variant replaces it with a new
 * item priced now; a line naming none is new; a dish line the basket leaves out is removed. A
 * dish that is served, started or fired, or was sent with no kitchen record, is refused rather than
 * replaced, left out or lowered. An absent label clears it: the whole request is the new state. A
 * save given `issue` may issue the bill's invoice, so it must name who saves.
 */
export async function updateHeldOrder(
  deps: WorkingOrderDeps & { admission: TradingAdmission },
  cfg: TradingContext,
  id: string,
  req: UpdateHeldOrderRequest,
  issue?: undefined,
  attendance?: OrderAttendance,
): Promise<number>;

export async function updateHeldOrder(
  deps: WorkingOrderDeps & { admission: TradingAdmission },
  cfg: TradingContext,
  id: string,
  req: UpdateHeldOrderRequest & { operatorId: string },
  issue: IssueOnSave,
  attendance?: OrderAttendance,
): Promise<{ revision: number; invoice?: TillSaleResult }>;

export async function updateHeldOrder(
  deps: WorkingOrderDeps & { admission: TradingAdmission },
  cfg: TradingContext,
  id: string,
  req: UpdateHeldOrderRequest,
  issue?: IssueOnSave,
  attendance?: OrderAttendance,
): Promise<number | { revision: number; invoice?: TillSaleResult }> {
  return withIssuanceTransaction(deps.db, async (tx) => {
    await requireEconomicWrite(tx, cfg, deps.admission);
    const { revision, changed, at } = await saveHeldOrderIn(tx, cfg, id, req, attendance);
    const invoice =
      issue === undefined
        ? null
        : await issueIfFullyPaid(tx, issue.fiscal, issue.saleCfg, id, req.operatorId);
    if (changed) await captureOrderEdit(tx, attendance, id, req.operatorId, revision, "save", at);
    return issue === undefined ? revision : { revision, ...(invoice === null ? {} : { invoice }) };
  });
}

export async function saveHeldOrderIn(
  tx: Transaction,
  cfg: TradingContext,
  id: string,
  req: UpdateHeldOrderRequest,
  attendance?: OrderAttendance,
) {
  const { label } = await requireEditableOrder(tx, id, req.revision);
  await requireOrderDining(tx, id, req.dining);
  await requireOrderBillEditor(tx, id, {
    operatorId: req.operatorId,
    expectedEdit: req.expectedEdit,
  });
  const order = await readEditableOrder(tx, id);
  if (req.lines.length === 0 && !order.lines.some((line) => line.setMenuRole === "set_menu"))
    throw new AppError("sale.empty_basket", {});
  const byId = new Map(order.parents.map((parent) => [parent.id, parent]));
  const claimed = new Set<string>();
  const edits: { parent: EditableParent; intent: LineIntent }[] = [];
  const fresh: RequestedLine[] = [];
  for (const line of req.lines) {
    const parent =
      line.workingOrderLineId === undefined ? undefined : byId.get(line.workingOrderLineId);
    if (parent === undefined || claimed.has(parent.id) || parent.productId === null) {
      fresh.push(line);
      continue;
    }
    claimed.add(parent.id);
    // An offer line sells the variant it names, else the offer's own product. A line naming a
    // product or carrying a settled answer goes to the new-line path, which refuses it.
    const sameItem =
      parent.menuItemId === line.menuItemId &&
      !Object.hasOwn(line, "productId") &&
      !Object.hasOwn(line, "frozenOptions") &&
      !Object.hasOwn(line, "frozenExtras") &&
      (line.variantId ?? parent.parentProductId ?? parent.productId) === parent.productId;
    if (!sameItem) {
      claimed.delete(parent.id);
      fresh.push(line);
      continue;
    }
    edits.push({
      parent,
      intent: {
        quantity: line.quantity,
        note: screenNote(line.note),
        options: { set: line.options ?? [] },
        extras: { set: line.extras ?? [] },
        makeAt: line.makeAt,
      },
    });
  }
  const { changed, chargesUnchanged, at } = await applyLineEdits(
    tx,
    cfg,
    id,
    order,
    {
      edits,
      removed: order.parents.filter((parent) => !claimed.has(parent.id)),
      fresh,
      refuseSentDrop: true,
      keepRecordedAnswers: true,
    },
    req.operatorId,
    attendance,
    req.lateSend,
  );
  const relabelled = (req.label ?? null) !== label;
  if (relabelled) {
    await tx
      .update(workingOrders)
      .set({ label: req.label ?? null })
      .where(eq(workingOrders.id, id));
  }
  const revision = await countEdit(
    tx,
    id,
    req.revision,
    changed || relabelled,
    !changed || chargesUnchanged,
  );
  return { revision, changed: changed || relabelled, at };
}
/**
 * Edit ONE dish line of an OPEN order made from the copy at `revision`, by the rules
 * {@link applyLineEdits} states; an absent optional field of `patch` keeps the line's own.
 * The same change goes to every dish of the observed Sent row, and a raised total
 * is added to the line itself. A line number the order does not hold is `tab.line_not_found`, and
 * an extras line, which follows its dish, `management.request_invalid`. Answers the order's
 * revision after the edit.
 */
export async function updateOrderLine(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  lineNo: number,
  patch: OrderLinePatch,
  revision: number,
  authority: OrderEditAuthority & { admission: TradingAdmission },
  attendance?: OrderAttendance,
  /** The request's confirmation of extras it adds to a dish whose period ended earlier today. */
  lateSend?: LateSendConfirmation,
): Promise<number> {
  // Admission follows the writing node.
  await requireEconomicWrite(tx, { nodeId: cfg.nodeId }, authority.admission);
  await requireEditableOrder(tx, orderId, revision);
  await requireOrderBillEditor(tx, orderId, authority);
  const operatorId = authority.operatorId;
  const order = await readEditableOrder(tx, orderId);
  const line = order.lines.find((candidate) => candidate.lineNo === lineNo);
  if (line === undefined) {
    throw new AppError("tab.line_not_found", { tabId: orderId, lineNo });
  }
  const parent = order.parents.find((candidate) => candidate.id === line.id);
  if (parent === undefined) {
    throw new AppError("management.request_invalid", { field: "lineNo" });
  }
  const portions = rowPortions(order, parent, patch.portionLineNos);
  const row = [parent, ...portions];
  const rise = patch.quantity === undefined ? null : rowRise(patch.quantity, row);
  const { changed, chargesUnchanged, at } = await applyLineEdits(
    tx,
    cfg,
    orderId,
    order,
    {
      edits: row.map((dish, index) => ({
        parent: dish,
        intent: {
          quantity: index > 0 || rise === null ? dish.quantity : addDecimal(dish.quantity, rise),
          note: Object.hasOwn(patch, "note") ? screenNote(patch.note) : dish.note,
          options: patch.options === undefined ? null : { set: patch.options },
          extras: patch.extras === undefined ? null : { set: patch.extras },
          makeAt: patch.makeAt,
        },
      })),
      removed: [],
      fresh: [],
    },
    operatorId,
    attendance,
    lateSend,
  );
  const saved = await countEdit(tx, orderId, revision, changed, chargesUnchanged);
  if (changed) await captureOrderEdit(tx, attendance, orderId, operatorId, saved, "line", at);
  return saved;
}
/** Abandon an open held order anywhere in the venue. An unknown id reads as `working_order.not_open`. */
export async function abandonHeldOrder(
  deps: WorkingOrderDeps,
  cfg: OriginConfig,
  id: string,
  authority: OrderEditAuthority,
  attendance?: OrderAttendance & { personId: string },
): Promise<void> {
  return withTransaction(deps.db, async (tx) => {
    const [locked] = await tx
      .select({
        status: workingOrders.status,
        revision: workingOrders.revision,
        partyId: workingOrders.partyId,
      })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    if (locked === undefined || locked.status !== "open") {
      throw new AppError("working_order.not_open", { workingOrderId: id });
    }
    await requireOrderBillEditor(tx, id, authority);
    await refusePaymentInFlight(tx, [id]);
    await refuseBillHoldingMoney(tx, [id]);
    await assertBillHasNoUnsent(tx, id);
    const lines = await readEditableOrder(tx, id);
    if (
      lines.lines.some(
        (line) =>
          line.ticket !== null ||
          (line.sentAt !== null && (locked.partyId !== null || line.setMenuRole !== "set_menu")),
      )
    )
      throw new AppError("ticket.already_fired", { workingOrderId: id });
    await tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
    if (locked.partyId !== null && (await ensureFamilyBill(tx, cfg, locked.partyId))) {
      await bumpPartyRevision(tx, locked.partyId);
    }
    await VENUE_SERVICE.withdrawPendingDepartmentTransfers(tx, [id]);
    await captureOrderEdit(tx, attendance, id, attendance?.personId, locked.revision, "discard");
  });
}
