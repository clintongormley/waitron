import "./errors.js";
import {
  type Transaction,
  newId,
  workingOrderLines,
  ticketItems,
  insertInChunks,
} from "@waitron/db";
import type { ClosedZoneConfirmation, TicketAllergyCopy } from "@waitron/module";
import {
  compareDecimal,
  decimal,
  subtractDecimal,
  decimalToThousandths,
  thousandthsToDecimal,
  decimalToCents,
} from "@waitron/shared";
import { eq, inArray, or, sql, and } from "drizzle-orm";
import { readBillExcess, assertLinesKeptExcess } from "./bill-payment-rows.js";
import { endRepricedDishDiscounts } from "./dish-discount-ending.js";
import { copyAllergyWorkingTicks, refreshKitchenAllergyClashes } from "./kitchen-allergy.js";
import { initiatedAt, requestedItem } from "./kitchen-phase.js";
import { hasUngroupedHoldPaper } from "./kitchen-ticket-paper.js";
import { type CorrectionItem, enqueueCorrectionSlips } from "./kitchen-ticket-corrections.js";
import { firedQuantity } from "./kitchen-ticket-state.js";
import { enqueueKitchenTickets } from "./kitchen-ticket-enqueue.js";
import { inIds } from "./in-ids.js";
import type { LateSendConfirmation } from "./late-send.js";
import { VENUE_SERVICE } from "./modules.js";
import { recordOrderedPeriods } from "./ordered-periods.js";
import {
  correctHoldTickets,
  holdPaperFor,
  type HeldChange,
  recordJoiningStations,
  printHoldTickets,
  correctJoin,
} from "./order-group-hold-paper.js";
import {
  nextFireKind,
  requireOperator,
  startGroup,
  recordGroupEvent,
} from "./order-group-records.js";
import { extraQuantityFor, grossLineTotal } from "./order-line-quantities.js";
import { expandPortionRows, carryLineReductions, cancelPortions } from "./order-portions.js";
import { endDiscountsCancelledWith } from "./set-menu-discount-ending.js";
import { regroupBills } from "./set-menu-regroup.js";
import { linkSetMenusFor } from "./set-menu-links.js";
import { totalBeforeEdit, refuseOrderOverSimplifiedLimit } from "./stored-order-lines.js";
import type { TradingContext } from "./trading-context.js";
import type { OrderAttendance } from "./working-order-context.js";
import {
  type EditableOrder,
  type EditableLine,
  kitchenStateOf,
  hasRequestedPart,
} from "./working-order-edit-state.js";
import { routingOnce, fireLines, insertSplitExtras } from "./working-order-kitchen-fire.js";
import {
  prepareLineEdits,
  type LineEditPlan,
  type PreparedLineEdit,
} from "./working-order-line-edit-plan.js";
import type { WorkingOrderLineInsert } from "./working-order-pricing.js";
import {
  planHeldCorrections,
  reduceLine,
  rescaleExtras,
  partyAfterEdit,
} from "./working-order-removal.js";
import { clampServed } from "./working-order-serving.js";

async function correctKitchenBeforeLineEdits(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  changes: PreparedLineEdit[],
  removed: LineEditPlan["removed"],
) {
  // Before any line changes: a notice and a slip copy the line as it stands.
  const held = await planHeldCorrections(tx, orderId, changes, removed);
  const correctionFor = (part: EditableLine, quantity: number): CorrectionItem => ({
    workingOrderLineId: part.id,
    stationId: part.ticket!.stationId,
    quantity,
    wasStarted: false,
  });
  const recalled = changes
    .filter(({ action }) => action === "change")
    .flatMap(({ parent, kept }) =>
      [parent, ...kept.map(({ child }) => child)]
        .filter((part) => part.ticket?.firedAt != null)
        .map((part) => correctionFor(part, part.ticket!.firedQuantity)),
    );
  const removedExtras = changes
    .flatMap(({ removedChildren }) => removedChildren)
    .filter((child) => child.ticket?.firedAt != null)
    .map((child) => correctionFor(child, child.ticket!.firedQuantity));
  const dropped = changes
    .filter(({ action }) => action === "drop")
    .map(({ parent, quantity, kept }) => ({
      parent,
      kept,
      removed: decimalToThousandths(subtractDecimal(parent.quantity, quantity)),
    }));
  await enqueueCorrectionSlips(tx, cfg, orderId, recalled, "RECALLED");
  await enqueueCorrectionSlips(
    tx,
    cfg,
    orderId,
    [
      ...removedExtras,
      ...dropped.flatMap(({ parent, kept, removed }) => [
        ...(parent.ticket?.firedAt == null ? [] : [correctionFor(parent, removed)]),
        ...kept
          .filter(({ child }) => child.ticket?.firedAt != null)
          .map(({ child, perDish }) =>
            correctionFor(
              child,
              decimalToThousandths(
                extraQuantityFor(perDish, thousandthsToDecimal(removed), child.priceQuantity),
              ),
            ),
          ),
      ]),
    ],
    "VOID",
  );
  await correctHoldTickets(tx, cfg, held.cancelled, { kind: "HOLD CANCELLED" });
  await correctHoldTickets(tx, cfg, held.taken, { kind: "HOLD CHANGED", direction: "removed" });
  for (const { parent, kept, removed } of dropped) {
    await reduceLine(
      tx,
      {
        id: parent.id,
        quantity: decimalToThousandths(parent.quantity),
        unitPriceGross: decimalToCents(parent.unitPriceGross),
        ticketItemId: parent.ticket?.id ?? null,
        firedQuantity: parent.ticket?.firedQuantity ?? 0,
      },
      removed,
      kept,
    );
  }
  return held;
}

/**
 * Apply edits to an OPEN order's stored dish lines, remove the `removed` ones and add the `fresh`
 * ones, as plan D10 rules:
 *
 * - A stored line keeps its gross price, names and the other facts it was added with; only what the
 *   edit adds is priced now — a new line, and an extra added to a line — except that a dish's own
 *   comp or discount gives its share back when its extras change or a basket save swaps its
 *   variant ({@link endRepricedDishDiscounts}). A note or an options answer carries no price. A
 *   kept extra is matched by list, product and quantity.
 * - A line with no ticket item, or a held one, is changed in place, except that units
 *   added to one a comp or a discount repriced go on a new line, priced now (ruling R12), and any
 *   other whole portion rises by copies of itself in its cohort (a measured one rises in place). A
 *   held one whose group has a queued HOLD ticket also prints HOLD corrections for its change or its
 *   removal ({@link planHeldCorrections}).
 * - A change to a dish the kitchen has ends its old work with a RECALLED notice and slip,
 *   then sends the replacement. Sent-dish removal belongs to Cancel item.
 *
 * New lines are numbered after the order's highest line number, and reach the kitchen as
 * {@link EditableOrder.newWork} says: where work was sent, as a round's line would, a course the
 * kitchen had fired before the edit counting as fired. A line that gains an extra moves after that
 * number with its extras, so each dish is followed by its own extras in line order, as a ticket
 * groups them.
 *
 * On a party: an added extra takes its dish's group and credit; a fired line's raised quantity
 * goes in a new fired group, and a new dish in a new group fired or held as `newWork` says, both at
 * the end of the sequence and credited to `operatorId`, a held one printing its HOLD ticket at the
 * stations that print held work in advance; the units added to a comped or discounted line the
 * kitchen has not fired go on a new line, priced now, in that line's group and kitchen state (ruling
 * R12), a held one printing `+N` at the stations that have its group's HOLD paper; a held group the
 * edit empties is removed; the party's revision moves on.
 */
export async function applyLineEdits(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  order: EditableOrder,
  plan: LineEditPlan,
  operatorId: string | undefined,
  attendance?: OrderAttendance,
  lateSend?: LateSendConfirmation,
  zoneConfirmation?: ClosedZoneConfirmation,
): Promise<{ changed: boolean; chargesUnchanged: boolean; at?: string }> {
  const before = await totalBeforeEdit(tx, cfg, orderId);
  // An overpaid bill takes dishes that use up its excess.
  const excessBefore = await readBillExcess(tx, orderId);
  const routing = routingOnce(tx, new Date());
  const context = await VENUE_SERVICE.findOrderContext(tx, orderId);
  const {
    changes,
    priced,
    pricedAs,
    extrasChangedIds,
    chargesUnchanged: preparedChargesUnchanged,
  } = await prepareLineEdits(
    tx,
    cfg,
    orderId,
    order,
    plan,
    context?.zoneId,
    routing,
    lateSend,
    zoneConfirmation,
  );
  let chargesUnchanged = preparedChargesUnchanged;
  const groups: {
    rows: WorkingOrderLineInsert[];
    contexts: typeof priced.lineContexts;
    portionable: boolean[];
  }[] = [];
  priced.lineRows.forEach((row, index) => {
    if (row.parentLineId === null) groups.push({ rows: [], contexts: [], portionable: [] });
    groups[groups.length - 1]!.rows.push(row);
    groups[groups.length - 1]!.contexts.push(priced.lineContexts[index]!);
    groups[groups.length - 1]!.portionable.push(priced.portionable[index]!);
  });

  // On a party, what the edit adds for the kitchen goes in a new group at the end of the sequence,
  // one fired now, one held, as the lines' `kitchen` says, except units added beside an adjusted
  // line, which join that line's group. Its lines are credited to the editor.
  const newGroups = new Map<string, string>();
  const changed = changes.length > 0 || plan.removed.length > 0 || plan.fresh.length > 0;
  const activity =
    attendance === undefined || operatorId === undefined || !changed
      ? undefined
      : { recorder: attendance.recorder, at: attendance.clock.now().instant.toISOString() };
  if (order.partyId !== null) {
    const fireKind = pricedAs.some(
      (as) => as.kind === "line" && as.joins === undefined && as.kitchen === "fire",
    )
      ? await nextFireKind(tx, order.partyId)
      : undefined;
    for (const as of pricedAs) {
      if (
        as.kind !== "line" ||
        as.joins !== undefined ||
        as.kitchen === "none" ||
        newGroups.has(as.kitchen)
      ) {
        continue;
      }
      const actorId = requireOperator(operatorId);
      const groupId = await startGroup(
        tx,
        order.partyId,
        as.kitchen,
        actorId,
        as.kitchen === "fire" ? fireKind! : "next_course",
      );
      await recordGroupEvent(
        tx,
        {
          partyId: order.partyId,
          groupId,
          kind: "group.submitted",
          actorId,
          detail: { workingOrderId: orderId, release: as.kitchen },
        },
        activity,
      );
      newGroups.set(as.kitchen, groupId);
    }
  }

  const held = await correctKitchenBeforeLineEdits(tx, cfg, orderId, changes, plan.removed);

  let nextLineNo = order.maxLineNo;
  const inserted: WorkingOrderLineInsert[] = [];
  const insertedContexts: typeof priced.lineContexts = [];
  // D11: a dish taken from a set-menu folder, and a portion added to one, records that set menu.
  const setMenuOfRow = new Map<string, string>();
  const fireNow: Parameters<typeof fireLines>[3] = [];
  const keepMadeHere = new Map<string, { madeHere: boolean; stationId: string }>();
  const keepStations = new Map<string, string>();
  const keepReleased = new Set<string>();
  const keepRequestedAt = new Map<string, string>();
  const keepSentNumber = new Map<number, string[]>();
  const copiedContexts: { from: string; to: string }[] = [];
  const copiedDishes: { from: string; to: string }[] = [];
  const raisedApart: { from: string; to: string }[] = [];
  // Two raised portions of one cohort number their copies on from each other.
  const nextOrdinal = new Map<string, number>();
  const joinedHeld: { groupId: string; lineIds: string[] }[] = [];
  const replacing = changes
    .filter(({ action }) => action === "change")
    .flatMap(({ parent, kept }) => [parent, ...kept.map(({ child }) => child)]);
  const oldAllergies = await VENUE_SERVICE.readTicketAllergies(
    tx,
    replacing.flatMap((line) => (line.ticket === null ? [] : [line.ticket.id])),
  );
  const keepAllergies = new Map<string, TicketAllergyCopy>(
    replacing.flatMap((line) => {
      const copy = line.ticket === null ? undefined : oldAllergies.get(line.ticket.id);
      return copy === undefined ? [] : [[line.id, copy]];
    }),
  );
  for (const change of changes.filter(({ action }) => action === "free" || action === "change")) {
    const { parent, quantity, note, optionSnapshots, kept } = change;
    await tx
      .update(workingOrderLines)
      .set({
        quantity: decimalToThousandths(quantity),
        lineTotal: decimalToCents(grossLineTotal(parent.unitPriceGross, quantity)),
        note,
        makeAtStationId: change.makeAt,
        optionSnapshots,
      })
      .where(eq(workingOrderLines.id, parent.id));
    if (change.removedChildren.length > 0) {
      await tx.delete(workingOrderLines).where(
        inArray(
          workingOrderLines.id,
          change.removedChildren.map((child) => child.id),
        ),
      );
    }
    await rescaleExtras(tx, kept, quantity);
    await clampServed(tx, [parent.id, ...kept.map(({ child }) => child.id)]);
    if (change.addedAt !== null) {
      // The dish and the extras it keeps move after the highest number, and the added ones follow.
      for (const line of [parent, ...kept.map(({ child }) => child)]) {
        await tx
          .update(workingOrderLines)
          .set({ lineNo: ++nextLineNo })
          .where(eq(workingOrderLines.id, line.id));
      }
      const group = groups[change.addedAt]!;
      for (const [index, row] of group.rows.entries()) {
        if (row.parentLineId === null) continue;
        inserted.push({
          ...row,
          parentLineId: parent.id,
          lineNo: ++nextLineNo,
          groupId: parent.groupId,
          creditedTo: parent.creditedTo,
        });
        insertedContexts.push(group.contexts[index]!);
      }
    }
    if (change.action === "change") {
      for (const line of [parent, ...kept.map(({ child }) => child)]) {
        const ticket = line.ticket;
        if (ticket === null) continue;
        keepMadeHere.set(line.id, { madeHere: ticket.madeHere, stationId: ticket.stationId });
        const sent = ticket.sentOrderNumber;
        if (sent !== null) keepSentNumber.set(sent, [...(keepSentNumber.get(sent) ?? []), line.id]);
        if (ticket.firedAt !== null) keepReleased.add(line.id);
        else if (ticket.requestedAt !== null) keepRequestedAt.set(line.id, ticket.requestedAt);
      }
      if (parent.ticket !== null) {
        await tx.delete(ticketItems).where(eq(ticketItems.id, parent.ticket.id));
        keepStations.set(parent.id, parent.ticket.stationId);
      }
      for (const { child } of kept)
        if (child.ticket !== null)
          await tx.delete(ticketItems).where(eq(ticketItems.id, child.ticket.id));
      fireNow.push({
        id: parent.id,
        productId: parent.productId,
        courseId: parent.courseId,
        parentLineId: null,
        note,
        quantity: decimalToThousandths(quantity),
        release: true,
      });
    } else if (parent.ticket !== null) {
      await tx
        .update(ticketItems)
        .set({ quantity: decimalToThousandths(quantity), note })
        .where(eq(ticketItems.id, parent.ticket.id));
    }
    if (change.action === "free")
      for (const { child, perDish } of kept)
        if (child.ticket !== null)
          await tx
            .update(ticketItems)
            .set({
              quantity: decimalToThousandths(
                extraQuantityFor(perDish, quantity, child.priceQuantity),
              ),
            })
            .where(eq(ticketItems.id, child.ticket.id));
    if (change.copies > 0) {
      // Copies of the dish as it now reads, with its extras, taking the kitchen state units added
      // apart from it would take.
      const [stored, ...storedExtras] = await tx
        .select()
        .from(workingOrderLines)
        .where(
          or(eq(workingOrderLines.id, parent.id), eq(workingOrderLines.parentLineId, parent.id)),
        )
        .orderBy(sql`${workingOrderLines.parentLineId} is not null`, workingOrderLines.lineNo);
      const addedExtras = inserted.filter((row) => row.parentLineId === parent.id);
      const kitchen = kitchenStateOf(parent);
      const copyIds: string[] = [];
      const { cohortId } = change.portion!;
      let ordinal = nextOrdinal.get(cohortId) ?? change.portion!.nextOrdinal;
      for (let k = 0; k < change.copies; k++) {
        const dishId = newId();
        copyIds.push(dishId);
        inserted.push({
          ...stored!,
          id: dishId,
          lineNo: ++nextLineNo,
          servedAt: null,
          servedQuantity: 0,
          cohortOrdinal: ordinal++,
        });
        copiedContexts.push({ from: parent.id, to: dishId });
        copiedDishes.push({ from: parent.id, to: dishId });
        for (const extra of storedExtras) {
          const id = newId();
          inserted.push({
            ...extra,
            id,
            parentLineId: dishId,
            lineNo: ++nextLineNo,
            servedAt: null,
            servedQuantity: 0,
          });
          copiedContexts.push({ from: extra.id, to: id });
        }
        for (const extra of addedExtras) {
          const id = newId();
          inserted.push({ ...extra, id, parentLineId: dishId, lineNo: ++nextLineNo });
          insertedContexts.push({
            ...insertedContexts.find((context) => context.workingOrderLineId === extra.id)!,
            workingOrderLineId: id,
          });
        }
        if (kitchen === "none") continue;
        if (parent.ticket !== null) {
          keepStations.set(dishId, parent.ticket.stationId);
          keepMadeHere.set(dishId, {
            madeHere: parent.ticket.madeHere,
            stationId: parent.ticket.stationId,
          });
        }
        fireNow.push({
          id: dishId,
          productId: stored!.productId,
          courseId: stored!.courseId,
          parentLineId: null,
          note: stored!.note,
          quantity: stored!.quantity,
          hold: kitchen === "hold",
          release:
            kitchen === "fire" &&
            (stored!.groupId !== null ||
              (stored!.courseId !== null && order.firedCourseIds.has(stored!.courseId))),
        });
      }
      nextOrdinal.set(cohortId, ordinal);
      if ((kitchen === "hold" || hasRequestedPart(parent)) && parent.groupId !== null)
        joinedHeld.push({ groupId: parent.groupId, lineIds: copyIds });
    }
  }

  // Units added apart from an adjusted line join its group, so it and they are released together.
  groups.forEach((priced, index) => {
    const as = pricedAs[index]!;
    if (as.kind !== "line") return;
    let group: { rows: WorkingOrderLineInsert[]; contexts: typeof priced.contexts } = priced;
    if (as.expand === true) {
      const portionable =
        as.origin?.setMenuId == null
          ? priced.portionable
          : priced.rows.map((row) => row.parentLineId === null);
      const out = expandPortionRows(priced.rows, priced.contexts, portionable, 0);
      group = { rows: out.rows, contexts: out.lineContexts };
    }
    const groupId = as.joins === undefined ? (newGroups.get(as.kitchen) ?? null) : as.joins.groupId;
    if (
      as.joins !== undefined &&
      groupId !== null &&
      (as.kitchen === "hold" || hasRequestedPart(as.joins))
    ) {
      joinedHeld.push({
        groupId,
        lineIds: group.rows.flatMap((row) => (row.parentLineId === null ? [row.id!] : [])),
      });
    }
    for (const [rowIndex, row] of group.rows.entries()) {
      const setMenuId =
        group.contexts[rowIndex]!.setMenuId ??
        (row.parentLineId === null ? as.origin?.setMenuId : undefined);
      if (setMenuId != null) setMenuOfRow.set(row.id!, setMenuId);
      if (as.joins?.groupId === null) {
        const source =
          row.parentLineId === null
            ? as.joins
            : as.joins.children.find(
                (child) =>
                  child.productId === row.productId && child.extraListId === row.extraListId,
              );
        if (source !== undefined) raisedApart.push({ from: source.id, to: row.id! });
      }
      inserted.push({
        ...row,
        lineNo: ++nextLineNo,
        groupId,
        creditedTo: operatorId ?? null,
        ...(as.inheritMakeAt &&
        as.origin !== undefined &&
        row.parentLineId === null &&
        row.makeAtStationId == null &&
        as.origin.makeAtStationId !== null
          ? { makeAtStationId: as.origin.makeAtStationId }
          : {}),
      });
      insertedContexts.push(group.contexts[rowIndex]!);
      if (row.parentLineId === null && as.kitchen !== "none") {
        if (as.origin?.ticket !== null && as.origin?.ticket !== undefined) {
          keepStations.set(row.id!, as.origin.ticket.stationId);
          keepMadeHere.set(row.id!, {
            madeHere: as.origin.ticket.madeHere,
            stationId: as.origin.ticket.stationId,
          });
        }
        const courseId = row.courseId ?? null;
        fireNow.push({
          id: row.id!,
          productId: row.productId!,
          courseId,
          parentLineId: null,
          note: row.note ?? null,
          quantity: row.quantity,
          hold: as.kitchen === "hold",
          // A fired group releases every line in it, whatever its course. Off a party, a changed
          // line's old item is deleted above, so `fireLines` alone could no longer see that its
          // course had fired.
          release:
            as.kitchen === "fire" &&
            (groupId !== null || (courseId !== null && order.firedCourseIds.has(courseId))),
        });
      }
    }
  });
  if (inserted.length > 0) {
    const contextByLine = await VENUE_SERVICE.lineContextColumns(
      tx,
      orderId,
      insertedContexts,
      priced.offers,
    );
    await insertInChunks(
      tx,
      workingOrderLines,
      inserted.map((row) => ({
        ...row,
        ...contextByLine.get(row.id!),
        ...(setMenuOfRow.has(row.id!) ? { setMenuId: setMenuOfRow.get(row.id!)! } : {}),
      })),
    );
    await carryLineReductions(tx, copiedContexts);
    await copyAllergyWorkingTicks(tx, copiedDishes);
  }
  const ordersDishes =
    plan.fresh.length > 0 ||
    plan.edits.some(
      ({ parent, intent }) => compareDecimal(decimal(intent.quantity), parent.quantity) > 0,
    );
  if (ordersDishes) await recordOrderedPeriods(tx, orderId, routing);
  await linkSetMenusFor(tx, orderId, priced.setMenuLinks);
  const addedToExisting = changes.filter(
    (change) =>
      change.action === "free" &&
      change.addedAt !== null &&
      (change.parent.ticket !== null ||
        change.parent.sentAt !== null ||
        change.parent.children.some((child) => child.ticket !== null)),
  );
  const insertedExtras = await insertSplitExtras(
    tx,
    cfg,
    orderId,
    context?.zoneId ?? null,
    addedToExisting.map(({ parent }) => ({
      dishLineId: parent.id,
      productId: parent.productId,
      stationId: parent.ticket?.stationId ?? null,
      courseId: parent.ticket?.courseId ?? parent.courseId,
      chosenStation: parent.ticket?.stationId === parent.makeAtStationId,
      initiated:
        parent.ticket !== null
          ? initiatedAt(parent.ticket) !== null
          : parent.groupState !== "held" &&
            !parent.children.some(
              (child) => child.ticket !== null && initiatedAt(child.ticket) === null,
            ),
    })),
    routing,
  );
  await enqueueKitchenTickets(
    tx,
    cfg,
    orderId,
    insertedExtras.filter((item) => item.firedAt !== null),
  );
  const holdPaper = await holdPaperFor(
    tx,
    addedToExisting.flatMap(({ parent }) => (parent.groupId === null ? [] : [parent.groupId])),
  );
  const givenExtras: (HeldChange & { groupId: string })[] = insertedExtras.flatMap((item) => {
    const parent = addedToExisting.find(
      ({ parent }) =>
        parent.children.some((child) => child.id === item.workingOrderLineId) ||
        inserted.some(
          (row) => row.id === item.workingOrderLineId && row.parentLineId === parent.id,
        ),
    )?.parent;
    const groupId = parent?.groupId ?? null;
    const group = groupId === null ? undefined : holdPaper(groupId, item);
    return groupId !== null && group !== undefined
      ? [
          {
            workingOrderId: orderId,
            workingOrderLineId: item.workingOrderLineId,
            stationId: item.stationId,
            quantity: item.quantity,
            groupId,
            group,
          },
        ]
      : [];
  });
  await recordJoiningStations(tx, givenExtras);
  // After the extras a line gains are written: a slip reads the line as it now stands.
  await correctHoldTickets(tx, cfg, [...held.given, ...givenExtras], {
    kind: "HOLD CHANGED",
    direction: "added",
  });
  // Fired while the removed lines' items still stand, so a course they held counts as fired.
  await fireLines(tx, cfg, orderId, fireNow, {
    keepStations,
    keepMadeHere,
    keepAllergies,
    keepReleased,
    keepRequestedAt,
    routing,
  });
  for (const [sent, lineIds] of keepSentNumber)
    await tx
      .update(ticketItems)
      .set({ sentOrderNumber: sent })
      .where(
        and(inArray(ticketItems.workingOrderLineId, lineIds), eq(ticketItems.madeHere, false)),
      );
  const heldGroup = newGroups.get("hold");
  if (heldGroup !== undefined) await printHoldTickets(tx, cfg, [heldGroup]);
  const counterHoldStations = new Map(
    order.lines.flatMap(({ id, groupId, ticket }) =>
      groupId === null && ticket !== null && hasUngroupedHoldPaper(ticket)
        ? [[id, ticket.stationId]]
        : [],
    ),
  );
  const carriedCounterPaper = new Map(
    [...copiedContexts, ...raisedApart].flatMap(({ from, to }) => {
      const stationId = counterHoldStations.get(from);
      return stationId === undefined ? [] : [[to, stationId] as const];
    }),
  );
  if (carriedCounterPaper.size > 0) {
    const additions = await tx
      .select({
        workingOrderLineId: ticketItems.workingOrderLineId,
        stationId: ticketItems.stationId,
        quantity: firedQuantity,
      })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(
        and(
          inIds(ticketItems.workingOrderLineId, [...carriedCounterPaper.keys()]),
          requestedItem(),
        ),
      );
    await correctHoldTickets(
      tx,
      cfg,
      additions.flatMap((item) =>
        carriedCounterPaper.get(item.workingOrderLineId) === item.stationId
          ? [{ ...item, workingOrderId: orderId }]
          : [],
      ),
      { kind: "HOLD CHANGED", direction: "added" },
    );
  }
  // As a raise of the line itself would: `+N` at the stations that have its group's HOLD paper.
  await correctJoin(tx, cfg, joinedHeld);
  await refreshKitchenAllergyClashes(
    tx,
    cfg,
    orderId,
    changes
      .filter((change) => change.addedAt !== null || change.removedChildren.length > 0)
      .map((change) => change.parent.id),
  );
  await endRepricedDishDiscounts(
    tx,
    orderId,
    extrasChangedIds,
    new Map(
      changes.map(({ parent, removedChildren }) => [
        parent.id,
        removedChildren.map(({ id }) => id),
      ]),
    ),
    (plan.swaps ?? []).map(({ fromId, freshIndex }) => ({
      fromId,
      toId: groups[freshIndex]!.rows[0]!.id!,
    })),
  );
  if (plan.removed.length > 0) {
    const removedIds = plan.removed.map((parent) => parent.id);
    await endDiscountsCancelledWith(tx, orderId, removedIds);
    await cancelPortions(tx, orderId, removedIds, operatorId ?? null);
    await tx
      .delete(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.workingOrderId, orderId),
          or(
            inArray(workingOrderLines.id, removedIds),
            inArray(workingOrderLines.parentLineId, removedIds),
          ),
        ),
      );
  }
  if (changed && (await regroupBills(tx, [orderId])).has(orderId)) chargesUnchanged = false;
  await assertLinesKeptExcess(tx, excessBefore);
  if (changed) await refuseOrderOverSimplifiedLimit(tx, cfg, orderId, before);
  if (changed) {
    await partyAfterEdit(
      tx,
      orderId,
      plan.removed.flatMap((parent) => (parent.groupId === null ? [] : [parent.groupId])),
      operatorId,
      activity,
    );
  }
  return { changed, chargesUnchanged: changed && chargesUnchanged, at: activity?.at };
}
