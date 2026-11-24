import "./errors.js";
import {
  type Transaction,
  workingOrderLines,
  lineServiceCancellations,
  nowIso,
  ticketItems,
} from "@waitron/db";
import { assertQuantityPrecision, MAX_UNIT_PRECISION } from "@waitron/menu";
import {
  decimalToThousandths,
  multiplyDecimal,
  thousandthsToDecimal,
  divideDecimal,
  type Decimal,
  decimal,
  decimalToCents,
  subtractDecimal,
  centsToDecimal,
  AppError,
  stringToThousandths,
  compareDecimal,
  addDecimal,
} from "@waitron/shared";
import { and, eq, or, inArray } from "drizzle-orm";
import type { AttendanceRecorder } from "./attendance-capture.js";
import { assertBillInvariant } from "./bill-payments.js";
import { type DishKitchenItem, dishKitchenItems } from "./dish-kitchen.js";
import {
  hasUngroupedHoldPaper,
  isStarted,
  readCancelledExtra,
  enqueueCorrectionSlips,
  type CancelledExtra,
  type CorrectionItem,
  enqueueExtraCancelled,
} from "./kitchen-print.js";
import { readLineCancellations, serviceQuantities } from "./line-service-state.js";
import {
  type HoldPaper,
  type HeldChange,
  holdPaperFor,
  correctHoldTickets,
} from "./order-group-hold-paper.js";
import { removeEmptiedHeldGroups } from "./order-group-records.js";
import {
  keptExtrasOf,
  type KeptExtra,
  extraQuantityFor,
  grossLineTotal,
  perDishExtraPicks,
} from "./order-line-quantities.js";
import { cancelPortions, refuseTooManyPortions } from "./order-portions.js";
import { partyOfOrder, bumpPartyRevision, canonicalJson } from "./parties.js";
import type { TradingContext } from "./trading-context.js";
import {
  bumpRevision,
  type EditableParent,
  type EditableLine,
  refusePaymentInFlight,
  bumpRevisionKeepingPayment,
  type EditableOrder,
} from "./working-order-edit-state.js";
import { clampServed } from "./working-order-serving.js";
import type { TicketState } from "./kitchen-print.js";

/** A line as a cancel takes from it, with its ticket item's kitchen state. */
export interface VoidTarget {
  id: string;
  parentLineId: string | null;
  groupId: string | null;
  quantity: number;
  unitPrecision: number | null;
  unitPriceGross: number;
  ticketItemId: string | null;
  firedAt: string | null;
  stationId: string | null;
  state: TicketState | null;
  firedQuantity: number;
}
function heldChangeOf(
  orderId: string,
  groupId: string | null,
  item: Pick<
    DishKitchenItem,
    "workingOrderLineId" | "stationId" | "requestedAt" | "firedAt" | "holdPaperQueued"
  >,
  quantity: number,
  holdPaper: HoldPaper,
): HeldChange[] {
  const group = groupId === null ? undefined : holdPaper(groupId, item);
  if (group === undefined && (groupId !== null || !hasUngroupedHoldPaper(item))) return [];
  return [
    {
      workingOrderId: orderId,
      workingOrderLineId: item.workingOrderLineId,
      stationId: item.stationId,
      quantity,
      ...(groupId === null ? {} : { groupId, group }),
    },
  ];
}
/**
 * The caller checks that the bill and paid quantities allow removal. Corrections must precede
 * deletion because notices and slips read the removed rows.
 */
export async function removeFromLine(
  tx: Transaction,
  cfg: TradingContext,
  tabId: string,
  target: VoidTarget,
  removed: number | null,
  operatorId: string | undefined,
  attendance?: { recorder: AttendanceRecorder; at: string },
  preparationStarted = false,
): Promise<void> {
  const wasStarted = preparationStarted || isStarted(target.state);
  const extra =
    target.parentLineId === null ? null : await readCancelledExtra(tx, target.id, cfg.locale);
  const dishId = target.parentLineId ?? target.id;
  const work = (await dishKitchenItems(tx, [dishId])).get(dishId) ?? [];
  const childItems = target.parentLineId === null ? work.filter((item) => item.extra) : [];
  const removedQuantity = (item: (typeof childItems)[number]) =>
    removed === null
      ? item.firedQuantity
      : decimalToThousandths(
          multiplyDecimal(
            thousandthsToDecimal(removed),
            divideDecimal(
              thousandthsToDecimal(item.lineQuantity),
              thousandthsToDecimal(target.quantity),
              3,
            ),
          ),
        );
  const voided =
    target.firedAt !== null
      ? [
          {
            workingOrderLineId: target.id,
            stationId: target.stationId!,
            // A whole void takes away everything the station was asked for.
            quantity: removed ?? target.firedQuantity,
            wasStarted,
          },
        ]
      : [];
  voided.push(
    ...childItems
      .filter((item) => item.firedAt !== null)
      .map((item) => ({
        workingOrderLineId: item.workingOrderLineId,
        stationId: item.stationId,
        quantity: removedQuantity(item),
        wasStarted: preparationStarted || isStarted(item.state),
      })),
  );
  // Before the delete or the reduction: the notice and the slip re-read the line.
  await enqueueCorrectionSlips(tx, cfg, tabId, voided, "VOID");
  const holdPaper = await holdPaperFor(tx, target.groupId === null ? [] : [target.groupId]);
  const own = work.find((item) => item.workingOrderLineId === target.id);
  await correctHoldTickets(
    tx,
    cfg,
    [
      ...(own === undefined
        ? []
        : heldChangeOf(tabId, target.groupId, own, removed ?? target.firedQuantity, holdPaper)),
      ...childItems.flatMap((item) =>
        heldChangeOf(tabId, target.groupId, item, removedQuantity(item), holdPaper),
      ),
    ],
    { kind: "HOLD CANCELLED" },
  );
  await bumpRevision(tx, [tabId]);
  if (removed === null) {
    if (target.parentLineId === null)
      await cancelPortions(tx, tabId, [target.id], operatorId ?? null);
    // Takes the line's child modifier lines in the same statement: the parent alone would be
    // refused by the self-referencing foreign key.
    await tx
      .delete(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.workingOrderId, tabId),
          or(eq(workingOrderLines.id, target.id), eq(workingOrderLines.parentLineId, target.id)),
        ),
      );
    if (extra !== null) await tellKitchenOfCancelledExtra(tx, cfg, tabId, extra);
    await assertBillInvariant(tx, [tabId]);
    await partyAfterEdit(
      tx,
      tabId,
      target.groupId === null ? [] : [target.groupId],
      operatorId,
      attendance,
    );
    return;
  }
  const children = await tx
    .select({
      id: workingOrderLines.id,
      quantity: workingOrderLines.quantity,
      priceQuantity: workingOrderLines.priceQuantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.parentLineId, target.id));
  await reduceLine(tx, target, removed, keptExtrasOf(children, target.quantity));
  await assertBillInvariant(tx, [tabId]);
  await partyAfterEdit(tx, tabId, [], operatorId, attendance);
}
/**
 * {@link removeFromLine} for several whole dish portions of one till row at once, each with its
 * extras (plan D32): the kitchen is told in one correction, as for one grouped line of them.
 */
export async function removePortions(
  tx: Transaction,
  cfg: TradingContext,
  tabId: string,
  targets: readonly VoidTarget[],
  operatorId: string | undefined,
  attendance?: { recorder: AttendanceRecorder; at: string },
  preparationStarted = false,
): Promise<void> {
  const ids = targets.map(({ id }) => id);
  const work = await dishKitchenItems(tx, ids);
  const childrenOf = (target: VoidTarget) =>
    (work.get(target.id) ?? []).filter((item) => item.extra);
  const voided = targets.flatMap((target) => [
    ...(target.firedAt !== null
      ? [
          {
            workingOrderLineId: target.id,
            stationId: target.stationId!,
            quantity: target.firedQuantity,
            wasStarted: preparationStarted || isStarted(target.state),
          },
        ]
      : []),
    ...childrenOf(target)
      .filter((item) => item.firedAt !== null)
      .map((item) => ({
        workingOrderLineId: item.workingOrderLineId,
        stationId: item.stationId,
        quantity: item.firedQuantity,
        wasStarted: preparationStarted || isStarted(item.state),
      })),
  ]);
  // Before the delete: the notice and the slip re-read the lines.
  await enqueueCorrectionSlips(tx, cfg, tabId, voided, "VOID");
  const groupIds = [...new Set(targets.flatMap(({ groupId }) => groupId ?? []))];
  const holdPaper = await holdPaperFor(tx, groupIds);
  const held = targets.flatMap((target) =>
    (work.get(target.id) ?? []).flatMap((item) =>
      heldChangeOf(
        tabId,
        target.groupId,
        item,
        item.extra ? item.firedQuantity : target.firedQuantity,
        holdPaper,
      ),
    ),
  );
  await correctHoldTickets(tx, cfg, held, { kind: "HOLD CANCELLED" });
  await bumpRevision(tx, [tabId]);
  await cancelPortions(tx, tabId, ids, operatorId ?? null);
  await tx
    .delete(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.workingOrderId, tabId),
        or(inArray(workingOrderLines.id, ids), inArray(workingOrderLines.parentLineId, ids)),
      ),
    );
  await assertBillInvariant(tx, [tabId]);
  await partyAfterEdit(tx, tabId, groupIds, operatorId, attendance);
}
/**
 * Once an extra is off its dish, tell a kitchen that has the dish which extra to take off: a fired
 * dish, or an unfired one on HOLD paper ({@link holdPaperFor}, asked with the dish's item). Any
 * other dish, or one going to no station, tells it nothing.
 */
async function tellKitchenOfCancelledExtra(
  tx: Transaction,
  cfg: TradingContext,
  tabId: string,
  extra: CancelledExtra,
): Promise<void> {
  const { item } = extra;
  if (item === null || item.stationId === null) return;
  const correction: CorrectionItem = {
    workingOrderLineId: extra.dishLineId,
    stationId: item.stationId,
    quantity: item.firedQuantity,
    wasStarted: isStarted(item.state),
  };
  if (item.firedAt !== null) {
    await enqueueExtraCancelled(tx, cfg, tabId, correction, extra.label);
    return;
  }
  if (extra.dishGroupId === null) {
    if (hasUngroupedHoldPaper(item))
      await enqueueExtraCancelled(
        tx,
        cfg,
        tabId,
        { ...correction, ungroupedHold: true },
        extra.label,
      );
    return;
  }
  const group = (await holdPaperFor(tx, [extra.dishGroupId]))(extra.dishGroupId, item);
  if (group === undefined) return;
  await enqueueExtraCancelled(
    tx,
    cfg,
    tabId,
    { ...correction, group, holdGroupId: extra.dishGroupId },
    extra.label,
  );
}
/**
 * After a line edit or void on a bill of a party, which carries no party revision of its own (D19):
 * remove each of `leftGroups` it left held and empty, and move the party's revision on. A bill of no
 * party is left as it was.
 */
export async function partyAfterEdit(
  tx: Transaction,
  orderId: string,
  leftGroups: readonly string[],
  operatorId: string | undefined,
  attendance?: { recorder: AttendanceRecorder; at: string },
): Promise<void> {
  const partyId = await partyOfOrder(tx, orderId);
  if (partyId === null) return;
  await removeEmptiedHeldGroups(tx, partyId, leftGroups, operatorId, attendance);
  await bumpPartyRevision(tx, partyId);
}
/** Each child's quantity and total follow its dish to `dishQuantity`, at the child's stored gross
 * price. */
export async function rescaleExtras(
  tx: Transaction,
  kept: readonly KeptExtra[],
  dishQuantity: Decimal,
): Promise<void> {
  for (const { child, perDish } of kept) {
    const priceQuantity = child.priceQuantity ?? decimal("1");
    const quantity = extraQuantityFor(perDish, dishQuantity, priceQuantity);
    await tx
      .update(workingOrderLines)
      .set({
        quantity: decimalToThousandths(quantity),
        lineTotal: decimalToCents(grossLineTotal(child.unitPriceGross, quantity, priceQuantity)),
      })
      .where(eq(workingOrderLines.id, child.id));
  }
}
/**
 * Take `removed` thousandths off a dish line: its quantity and total at its stored gross price, its
 * extras children's in proportion (they follow their dish), and its ticket item's fired quantity.
 */
export async function reduceLine(
  tx: Transaction,
  target: {
    id: string;
    quantity: number;
    unitPriceGross: number;
    ticketItemId: string | null;
    firedQuantity: number;
  },
  removed: number,
  children: readonly KeptExtra[],
): Promise<void> {
  const remaining = subtractDecimal(
    thousandthsToDecimal(target.quantity),
    thousandthsToDecimal(removed),
  );
  await tx
    .update(workingOrderLines)
    .set({
      quantity: decimalToThousandths(remaining),
      lineTotal: decimalToCents(grossLineTotal(centsToDecimal(target.unitPriceGross), remaining)),
    })
    .where(eq(workingOrderLines.id, target.id));
  await rescaleExtras(tx, children, remaining);
  const ids = [target.id, ...children.map(({ child }) => child.id)];
  const cancellations = await readLineCancellations(tx, ids);
  const cancelled = cancellations.get(target.id) ?? 0;
  if (cancelled > 0 && decimalToThousandths(remaining) === cancelled) {
    const [beforeClamp] = await tx
      .select({
        served: workingOrderLines.servedQuantity,
        servedAt: workingOrderLines.servedAt,
        cancelledAt: lineServiceCancellations.cancelledAt,
      })
      .from(workingOrderLines)
      .innerJoin(
        lineServiceCancellations,
        eq(lineServiceCancellations.lineId, workingOrderLines.id),
      )
      .where(eq(workingOrderLines.id, target.id));
    // With no active food left, the cancellation row retains the service completion time.
    const completedAt =
      beforeClamp!.served < removed
        ? nowIso()
        : (beforeClamp!.servedAt ?? beforeClamp!.cancelledAt);
    if (Date.parse(completedAt) > Date.parse(beforeClamp!.cancelledAt))
      await tx
        .update(lineServiceCancellations)
        .set({ cancelledAt: completedAt })
        .where(eq(lineServiceCancellations.lineId, target.id));
  }
  for (const { child, perDish } of children) {
    const quantity = decimalToThousandths(
      extraQuantityFor(perDish, remaining, child.priceQuantity),
    );
    const active = serviceQuantities(quantity, 0, cancellations.get(child.id) ?? 0).active;
    if (active === 0) {
      await tx.delete(ticketItems).where(eq(ticketItems.workingOrderLineId, child.id));
      continue;
    }
    await tx
      .update(ticketItems)
      .set({ quantity: active })
      .where(eq(ticketItems.workingOrderLineId, child.id));
  }
  await clampServed(tx, ids);
  if (target.ticketItemId !== null) {
    if (target.firedQuantity <= removed)
      await tx.delete(ticketItems).where(eq(ticketItems.id, target.ticketItemId));
    else
      await tx
        .update(ticketItems)
        .set({ quantity: target.firedQuantity - removed })
        .where(eq(ticketItems.id, target.ticketItemId));
  }
}
/**
 * `quantity` of a line as thousandths, else `refused()`: a positive decimal no larger than the line,
 * in the line's unit's decimal places.
 */
export function quantityOfLine(
  quantity: string,
  line: { quantity: number; unitPrecision: number | null },
  refused: () => AppError,
): number {
  let asked: number;
  try {
    assertQuantityPrecision(quantity, line.unitPrecision ?? MAX_UNIT_PRECISION, { positive: true });
    asked = stringToThousandths(quantity);
  } catch {
    throw refused();
  }
  if (asked > line.quantity) throw refused();
  return asked;
}
/** How many portions raising a whole portion of 1 to `requested` adds. */
export function addedPortions(lineId: string, quantity: Decimal, requested: Decimal): number {
  const added = Number(subtractDecimal(requested, quantity));
  if (compareDecimal(quantity, decimal("1")) !== 0 || !Number.isInteger(added))
    throw new Error(`whole portion ${lineId} of ${quantity} cannot rise to ${requested}`);
  refuseTooManyPortions(added);
  return added;
}
/**
 * The HOLD corrections an edit makes to unfired lines on HOLD paper ({@link holdPaperFor}): a
 * removed line is `cancelled`; a line whose quantity alone changes loses (`taken`) or gains
 * (`given`) the difference; any other change takes the line away as it read, at its old quantity,
 * and gives it back as it now reads, at its new one. `taken` and `cancelled` print before the line
 * changes and `given` after, as each slip reads the line as it stands.
 */
export async function planHeldCorrections(
  tx: Transaction,
  orderId: string,
  changes: readonly {
    parent: EditableParent;
    quantity: Decimal;
    modified: boolean;
    kept: { child: EditableLine; perDish: number }[];
    removedChildren: EditableLine[];
  }[],
  removed: readonly EditableParent[],
): Promise<{ cancelled: HeldChange[]; taken: HeldChange[]; given: HeldChange[] }> {
  const held = (parent: EditableParent) =>
    [parent, ...parent.children].some(
      ({ ticket }) =>
        ticket !== null &&
        (parent.groupId === null ? hasUngroupedHoldPaper(ticket) : ticket.firedAt === null),
    );
  const heldChanges = changes.filter(({ parent }) => held(parent));
  const heldRemoved = removed.filter(held);
  const holdPaper = await holdPaperFor(tx, [
    ...heldChanges.flatMap(({ parent }) => parent.groupId ?? []),
    ...heldRemoved.flatMap((parent) => parent.groupId ?? []),
  ]);
  const change = (parent: EditableParent, part: EditableLine, quantity: number): HeldChange[] =>
    quantity <= 0 || part.ticket === null
      ? []
      : heldChangeOf(
          orderId,
          parent.groupId,
          { ...part.ticket, workingOrderLineId: part.id },
          quantity,
          holdPaper,
        );
  const before = (edit: { parent: EditableParent }) => decimalToThousandths(edit.parent.quantity);
  const after = (edit: { quantity: Decimal }) => decimalToThousandths(edit.quantity);
  return {
    cancelled: [
      ...heldRemoved.flatMap((parent) =>
        [parent, ...parent.children].flatMap((part) =>
          change(parent, part, part.ticket?.firedQuantity ?? 0),
        ),
      ),
      ...heldChanges.flatMap(({ parent, removedChildren }) =>
        removedChildren.flatMap((part) => change(parent, part, part.ticket?.firedQuantity ?? 0)),
      ),
    ],
    taken: heldChanges.flatMap((edit) => [
      ...change(
        edit.parent,
        edit.parent,
        edit.modified ? before(edit) : before(edit) - after(edit),
      ),
      ...edit.kept.flatMap(({ child, perDish }) =>
        change(
          edit.parent,
          child,
          edit.modified
            ? (child.ticket?.firedQuantity ?? 0)
            : (child.ticket?.firedQuantity ?? 0) -
                decimalToThousandths(extraQuantityFor(perDish, edit.quantity, child.priceQuantity)),
        ),
      ),
    ]),
    given: heldChanges.flatMap((edit) => [
      ...change(edit.parent, edit.parent, edit.modified ? after(edit) : after(edit) - before(edit)),
      ...edit.kept.flatMap(({ child, perDish }) =>
        change(
          edit.parent,
          child,
          edit.modified
            ? decimalToThousandths(extraQuantityFor(perDish, edit.quantity, child.priceQuantity))
            : decimalToThousandths(extraQuantityFor(perDish, edit.quantity, child.priceQuantity)) -
                (child.ticket?.firedQuantity ?? 0),
        ),
      ),
    ]),
  };
}
/** A dish line and its extras, none of which an edit may leave holding a paid quantity. */
export function paidLineParts(
  parent: EditableParent,
): { id: string; lineNo: number; keeps: number }[] {
  return [parent, ...parent.children].map((line) => ({
    id: line.id,
    lineNo: parent.lineNo,
    keeps: 0,
  }));
}
/**
 * Count a write on the order's revision only when it changed something, and answer the revision the
 * order is at after it: `copy` is the one {@link requireEditableOrder} matched in this transaction.
 * While card money of the order is unresolved ({@link refusePaymentInFlight}) a write is refused
 * unless `uncharged` says it changed nothing the bill charges, and one that changes nothing is
 * refused too.
 */
export async function countEdit(
  tx: Transaction,
  orderId: string,
  copy: number,
  changed: boolean,
  uncharged: boolean,
): Promise<number> {
  if (!changed) {
    await refusePaymentInFlight(tx, [orderId]);
    return copy;
  }
  if (uncharged) await bumpRevisionKeepingPayment(tx, [orderId]);
  else await bumpRevision(tx, [orderId]);
  return copy + 1;
}
/**
 * The dishes `lineNos` names as the rest of `first`'s Sent row: each named once, not `first`, a
 * dish line of the order and the same dish as `first`, else `management.request_invalid`.
 */
export function rowPortions(
  order: EditableOrder,
  first: EditableParent,
  lineNos: unknown,
): EditableParent[] {
  const refused = () => new AppError("management.request_invalid", { field: "portionLineNos" });
  if (!Array.isArray(lineNos)) throw refused();
  if (lineNos.length === 0) return [];
  const byLineNo = new Map<number, EditableParent>();
  for (const candidate of order.parents)
    if (!byLineNo.has(candidate.lineNo)) byLineNo.set(candidate.lineNo, candidate);
  let firstKey: string | undefined;
  const seen = new Set<number>([first.lineNo]);
  return lineNos.map((lineNo: unknown) => {
    if (typeof lineNo !== "number" || !Number.isInteger(lineNo) || seen.has(lineNo)) {
      throw refused();
    }
    seen.add(lineNo);
    const dish = byLineNo.get(lineNo);
    if (dish === undefined || sameDishKey(dish) !== (firstKey ??= sameDishKey(first))) {
      throw refused();
    }
    return dish;
  });
}
/**
 * What every dish of one Sent row must share, as the server checks it: product, offer, note,
 * options answer and extras, by value, so neither key order nor list order tells them apart.
 */
function sameDishKey(dish: EditableParent): string {
  return canonicalJson({
    productId: dish.productId ?? null,
    menuItemId: dish.menuItemId ?? null,
    note: dish.note,
    options: dish.optionSnapshots.map(canonicalJson).sort(),
    extras: dish.children
      .map((child) =>
        canonicalJson({
          listId: child.extraListId ?? null,
          productId: child.productId ?? null,
          perDish: perDishExtraPicks(child.quantity, dish.quantity, child.priceQuantity),
        }),
      )
      .sort(),
  });
}
/**
 * How much a row's requested `total` raises it: a whole number not below the dishes' total now,
 * else `management.request_invalid` (`quantity`).
 */
export function rowRise(total: unknown, row: EditableParent[]): Decimal {
  const refused = () => new AppError("management.request_invalid", { field: "quantity" });
  if (typeof total !== "string" || !/^\d+$/.test(total)) throw refused();
  const now = row.reduce((sum, dish) => addDecimal(sum, dish.quantity), decimal("0"));
  const rise = subtractDecimal(decimal(total), now);
  if (compareDecimal(rise, decimal("0")) < 0) throw refused();
  return rise;
}
