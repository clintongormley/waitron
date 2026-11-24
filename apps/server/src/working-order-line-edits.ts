import "./errors.js";
import { type Transaction, workingOrderLines, ticketItems, insertInChunks } from "@waitron/db";
import { readContentLanguages, assertQuantityPrecision, MAX_UNIT_PRECISION } from "@waitron/menu";
import type { ZoneMenuOffer, TicketAllergyCopy } from "@waitron/module";
import {
  AppError,
  compareDecimal,
  decimal,
  type Decimal,
  type OptionSnapshot,
  type ExtraSelection,
  subtractDecimal,
  decimalToThousandths,
  thousandthsToDecimal,
  decimalToCents,
} from "@waitron/shared";
import { eq, inArray, or, sql, and } from "drizzle-orm";
import { newId } from "@waitron/db";
import {
  readBillExcess,
  readPaidQuantities,
  refusePaidLines,
  assertLinesKeptExcess,
} from "./bill-payments.js";
import { readStationChanges, refuseChangesAfterSending } from "./changes-after-sending.js";
import { requireMakeAtStation } from "./dead-ends.js";
import { copyAllergyWorkingTicks, refreshKitchenAllergyClashes } from "./kitchen-allergy.js";
import { initiatedAt, requestedItem } from "./kitchen-phase.js";
import {
  isStarted,
  type CorrectionItem,
  enqueueCorrectionSlips,
  enqueueKitchenTickets,
  hasUngroupedHoldPaper,
  firedQuantity,
  inIds,
} from "./kitchen-print.js";
import type { LateSendConfirmation } from "./late-send.js";
import {
  namedPicks,
  asksNoNewAnswer,
  editUnsentLineOptions,
  editLineOptions,
  editLineExtras,
} from "./modifier-selection.js";
import { VENUE_SERVICE } from "./modules.js";
import {
  nextFireKind,
  requireOperator,
  startGroup,
  recordGroupEvent,
  correctHoldTickets,
  holdPaperFor,
  type HeldChange,
  recordJoiningStations,
  printHoldTickets,
  correctJoin,
} from "./order-groups.js";
import { extraQuantityFor, perDishExtraPicks, grossLineTotal } from "./order-line-quantities.js";
import {
  type GrowingPortion,
  readGrowingPortions,
  expandPortionRows,
  carryLineReductions,
  cancelPortions,
} from "./order-portions.js";
import { RETAINED_COURSE } from "./retained-course.js";
import { type SetMenuPlacement, placeSetMenuRows } from "./set-menu-bill.js";
import { setMenuOfferLookup } from "./set-menu-offers.js";
import { totalBeforeEdit, refuseOrderOverSimplifiedLimit } from "./stored-order-lines.js";
import type { TradingContext } from "./trading-context.js";
import type { OrderAttendance } from "./working-order-context.js";
import {
  type EditableOrder,
  type EditableParent,
  type LineIntent,
  type RequestedLine,
  type EditableLine,
  kitchenStateOf,
  assertProductsSellable,
  hasRequestedPart,
} from "./working-order-edit-state.js";
import { routingOnce, fireLines, insertSplitExtras } from "./working-order-kitchen-fire.js";
import {
  readBasketOffers,
  productOptionLists,
  type OfferModifiers,
  NO_MODIFIERS,
  offerModifiers,
  extrasListsFor,
  STORED_SET_MENU_OFFER,
  STORED_RISE,
  FROZEN_OPTIONS,
  FROZEN_EXTRAS,
  ADDED_EXTRAS_ONLY,
  ON_SENT_DISH,
  priceOrderLines,
  type WorkingOrderLineInsert,
} from "./working-order-pricing.js";
import {
  paidLineParts,
  addedPortions,
  planHeldCorrections,
  reduceLine,
  rescaleExtras,
  partyAfterEdit,
} from "./working-order-removal.js";
import { clampServed } from "./working-order-serving.js";

/**
 * Apply edits to an OPEN order's stored dish lines, remove the `removed` ones and add the `fresh`
 * ones, as plan D10 rules:
 *
 * - A stored line keeps its gross price, names and the other facts it was added with; only what the
 *   edit adds is priced now — a new line, and an extra added to a line. A note or an options answer
 *   carries no price. A kept extra is matched by list, product and quantity.
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
  plan: {
    edits: { parent: EditableParent; intent: LineIntent }[];
    removed: EditableParent[];
    fresh: RequestedLine[];
    /** Refuse a lower count where a removal would be refused, rather than take it. */
    refuseSentDrop?: true;
    /** A sent line keeps its options answers while the edit names none it does not hold: a rename
     * cannot be told from a change. A line not yet sent goes through `editUnsentLineOptions`. */
    keepRecordedAnswers?: true;
  },
  operatorId: string | undefined,
  attendance?: OrderAttendance,
  lateSend?: LateSendConfirmation,
): Promise<{ changed: boolean; chargesUnchanged: boolean; at?: string }> {
  const before = await totalBeforeEdit(tx, cfg, orderId);
  // A bill Pay for items left overpaid takes dishes that use up its excess.
  const excessBefore = await readBillExcess(tx, orderId);
  const routing = routingOnce(tx, new Date());
  const context = await VENUE_SERVICE.findOrderContext(tx, orderId);
  const stationChanges = await readStationChanges(
    tx,
    order.lines.flatMap((line) => (line.ticket === null ? [] : [line.ticket.stationId])),
  );
  const refuseServed = (line: EditableParent): void => {
    const served = [line, ...line.children].find((part) => part.servedQuantity > 0);
    if (served !== undefined) {
      throw new AppError("ticket.already_served", { workingOrderId: orderId, lineId: served.id });
    }
  };
  const refuseSent = (line: EditableParent, fired: boolean): void => {
    if (fired) throw new AppError("ticket.already_fired", { workingOrderId: orderId });
    const parts = [line, ...line.children];
    const sent = parts.find((part) => part.sentAt !== null);
    if (sent !== undefined && parts.every((part) => part.ticket === null)) {
      throw new AppError("ticket.already_sent", { workingOrderId: orderId, lineId: sent.id });
    }
  };
  /**
   * Refuses what the kitchen state forbids, the stations' choice only for a change; answers
   * whether the kitchen holds fired work. A bare raise leaves the started work alone, so it is not
   * refused as started.
   */
  const kitchenHas = (line: EditableParent, change: boolean, bareRaise = false): boolean => {
    const records = [line, ...line.children].flatMap((part) =>
      part.ticket === null ? [] : [part.ticket],
    );
    const started = records.find((record) => isStarted(record.state));
    if (started !== undefined && !bareRaise) {
      throw new AppError("ticket.already_started", { ticketItemId: started.id });
    }
    if (change) refuseChangesAfterSending(orderId, records, stationChanges);
    return records.some((record) => record.firedAt !== null);
  };
  const wasSent = (parent: EditableParent): boolean =>
    [parent, ...parent.children].some(
      (part) => part.sentAt !== null || part.ticket?.firedAt != null,
    );
  if (plan.refuseSentDrop) {
    for (const parent of order.parents) {
      if (!wasSent(parent)) continue;
      const edit = plan.edits.find((edit) => edit.parent.id === parent.id);
      const picks = namedPicks(edit?.intent.extras?.set);
      const drops =
        edit === undefined ||
        compareDecimal(decimal(edit.intent.quantity), parent.quantity) < 0 ||
        parent.children.some((child) => {
          const pick = picks.find(
            (pick) => pick.listId === child.extraListId && pick.productId === child.productId,
          );
          return (
            compareDecimal(
              extraQuantityFor(
                pick?.quantity ?? 0,
                decimal(edit.intent.quantity),
                child.priceQuantity,
              ),
              child.quantity,
            ) < 0
          );
        });
      if (!drops) continue;
      refuseServed(parent);
      refuseSent(parent, kitchenHas(parent, false));
      throw new AppError("ticket.already_fired", { workingOrderId: orderId });
    }
  }
  const menuItemOf = (line: EditableParent): string => {
    if (line.menuItemId === undefined) {
      throw new AppError("order.service_context_missing", { workingOrderId: orderId });
    }
    return line.menuItemId;
  };
  const variantOf = (line: EditableParent) =>
    line.parentProductId === null ? {} : { variantId: line.productId! };

  const needsModifiers = plan.edits.some(
    ({ intent }) => intent.options !== null || intent.extras !== null,
  );
  const contentConfig = needsModifiers ? await readContentLanguages(tx, cfg.locale) : undefined;
  const defaultLanguage = contentConfig?.defaultLanguage ?? "";
  // Read once for the answers the edits are checked against and for the lines priced below.
  const snapshot = needsModifiers
    ? await readBasketOffers(tx, orderId, context?.zoneId, plan.fresh, [
        ...plan.fresh.map((line) => line.menuItemId),
        ...plan.edits.map(({ parent }) => parent.menuItemId),
      ])
    : undefined;
  const offerById = new Map(snapshot?.offers.map((offer) => [offer.id, offer]));
  const recordedKeys = plan.edits.flatMap(({ parent }) =>
    parent.setMenuId === null
      ? []
      : [
          {
            setMenuId: parent.setMenuId,
            menuVersionId: parent.menuVersionId,
            menuItemId: menuItemOf(parent),
          },
        ],
  );
  const recorded = await setMenuOfferLookup(tx, null, recordedKeys, [], "stored");
  const recordedOffer = (line: EditableParent) =>
    line.setMenuId === null
      ? undefined
      : recorded.offerFor({
          setMenuId: line.setMenuId,
          menuVersionId: line.menuVersionId,
          menuItemId: menuItemOf(line),
        });
  const offerOf = (line: EditableParent) =>
    line.setMenuId === null ? offerById.get(menuItemOf(line)) : recordedOffer(line)?.offer;

  // A stored line whose dish the live version no longer offers has no published lists left: its
  // options answer, which carries no price, is checked against the dish's own lists instead.
  const withdrawnDishes = needsModifiers
    ? plan.edits.flatMap(({ parent }) =>
        parent.setMenuId !== null || offerOf(parent) !== undefined
          ? []
          : [parent.parentProductId ?? parent.productId!],
      )
    : [];
  const ownOptions = await productOptionLists(tx, withdrawnDishes);
  const modifiersByOffer = new Map<ZoneMenuOffer, OfferModifiers>();
  const modifiersOf = (line: EditableParent): OfferModifiers => {
    const offer = offerOf(line);
    if (offer === undefined) {
      const dishId = (line.parentProductId ?? line.productId!).toLowerCase();
      return { ...NO_MODIFIERS, options: ownOptions.get(dishId) ?? [] };
    }
    let modifiers = modifiersByOffer.get(offer);
    if (modifiers === undefined) {
      modifiers = offerModifiers(offer, contentConfig!);
      modifiersByOffer.set(offer, modifiers);
    }
    return modifiers;
  };
  const offerUnitOf = (line: EditableParent) => {
    const offer = offerOf(line);
    if (line.parentProductId === null) return offer?.unit;
    return offer?.variants.find((variant) => variant.id === line.productId)?.unit;
  };

  type Action = "free" | "change" | "raise" | "drop";
  const changes: {
    parent: EditableParent;
    action: Action;
    /** The dish quantity the stored row takes. */
    quantity: Decimal;
    note: string | null;
    makeAt: string | null;
    optionSnapshots: OptionSnapshot[];
    kept: { child: EditableLine; perDish: number }[];
    removedChildren: EditableLine[];
    /** Index into `pricing` of the line carrying this line's added extras, if any. */
    addedAt: number | null;
    /** Whether the note, options answer or extras change, not only the quantity. */
    modified: boolean;
    /** Portions a whole portion's rise adds as copies of it, in its cohort. */
    copies: number;
    portion: GrowingPortion | undefined;
  }[] = [];
  // Every line priced now, in one offer read: a new dish line, which the kitchen gets as `kitchen`
  // says, the carrier of extras added to a stored line, whose dish row is not kept, or a raised
  // line's check, whose rows are discarded.
  const pricing: RequestedLine[] = [...plan.fresh];
  const pricedAs: (
    | {
        kind: "line";
        kitchen: EditableOrder["newWork"];
        /** The stored line whose group the new one joins, for units added apart from it. */
        joins?: EditableParent;
        /** The sent dish whose kitchen decision the added units follow. */
        origin?: EditableParent;
        inheritMakeAt?: boolean;
        /** Written as portions of a cohort of their own: units added apart from a dish that is a
         * portion, or any new line. */
        expand?: boolean;
      }
    | { kind: "extras" }
    | { kind: "check" }
  )[] = plan.fresh.map(() => ({
    kind: "line",
    kitchen: order.newWork,
    expand: true,
  }));
  const raised: RequestedLine[] = [];
  const resent: string[] = [];
  let chargesUnchanged = plan.removed.length === 0 && plan.fresh.length === 0;
  const paid = await readPaidQuantities(tx, orderId);
  const portionOf = await readGrowingPortions(
    tx,
    plan.edits.map(({ parent }) => parent.id),
  );

  for (const { parent, intent } of plan.edits) {
    assertQuantityPrecision(
      intent.quantity,
      parent.setMenuId === null ? (parent.unitPrecision ?? MAX_UNIT_PRECISION) : 0,
      { positive: true },
    );
    const requested = decimal(intent.quantity);
    const rise = compareDecimal(requested, parent.quantity);
    if (
      intent.makeAt !== undefined &&
      intent.makeAt !== null &&
      ((parent.sentAt === null &&
        parent.ticket === null &&
        intent.makeAt !== parent.makeAtStationId) ||
        ((parent.sentAt !== null || parent.ticket !== null) && rise > 0))
    )
      await requireMakeAtStation(tx, intent.makeAt);
    const modifiers = needsModifiers ? modifiersOf(parent) : NO_MODIFIERS;
    let optionSnapshots = parent.optionSnapshots;
    if (intent.options !== null) {
      const wholeOrder = plan.keepRecordedAnswers === true;
      const sent = wasSent(parent);
      if (
        !wholeOrder ||
        !sent ||
        !asksNoNewAnswer(modifiers.options, intent.options.set, parent.optionSnapshots)
      ) {
        const edit = wholeOrder && !sent ? editUnsentLineOptions : editLineOptions;
        optionSnapshots =
          edit(modifiers.options, intent.options.set, parent.optionSnapshots, defaultLanguage) ??
          parent.optionSnapshots;
      }
    }
    const extras =
      intent.extras === null
        ? {
            kept: parent.children.map((child) => ({
              child,
              perDish: perDishExtraPicks(child.quantity, parent.quantity, child.priceQuantity),
            })),
            added: [],
            removed: [],
          }
        : editLineExtras(
            extrasListsFor(modifiers.extras, offerUnitOf(parent)),
            modifiers.extraProducts,
            intent.extras.set,
            {
              children: parent.children,
              dishQuantity: parent.quantity,
            },
            defaultLanguage,
          );
    const extrasChanged = extras.added.length > 0 || extras.removed.length > 0;
    const changed =
      intent.note !== parent.note ||
      (parent.sentAt === null &&
        parent.ticket === null &&
        intent.makeAt !== undefined &&
        intent.makeAt !== parent.makeAtStationId) ||
      optionSnapshots !== parent.optionSnapshots ||
      extrasChanged;
    if (!changed && rise === 0) continue;
    // A stored line keeps its unit price, so its extras and its quantity move what it charges; its
    // options answer is filed on the sale line, and a card at the reader files the answer it priced.
    if (extrasChanged || rise !== 0 || optionSnapshots !== parent.optionSnapshots)
      chargesUnchanged = false;
    // Changed in place or replaced, a paid line would no longer be what was paid for.
    await refusePaidLines(tx, orderId, paidLineParts(parent), paid);
    const refusedDrop = rise < 0 && plan.refuseSentDrop === true;
    if (changed || refusedDrop) refuseServed(parent);
    const fired = kitchenHas(parent, changed || rise > 0, !changed && rise > 0);
    if (refusedDrop) refuseSent(parent, fired);
    const action: Action = !fired ? "free" : changed ? "change" : rise > 0 ? "raise" : "drop";
    // Added set-menu units each need their own place. Adjusted prices apply only to existing units.
    const addedApart =
      action === "free" && rise > 0 && (parent.adjusted || parent.setMenuId !== null);
    const portion = portionOf.get(parent.id);
    // A whole portion rises by copies of itself, so the filed row is what raising it in place gave.
    const copies =
      action === "free" && rise > 0 && !addedApart && portion !== undefined && !portion.measured
        ? addedPortions(parent.id, parent.quantity, requested)
        : 0;

    // The picks the line carries after the edit, as a request names them.
    const picks: ExtraSelection[] =
      intent.extras === null
        ? [...new Set(parent.children.map((child) => child.extraListId))].map((listId) => ({
            listId: listId!,
            picks: extras.kept
              .filter(({ child }) => child.extraListId === listId)
              .map(({ child, perDish }) => ({ productId: child.productId!, quantity: perDish })),
          }))
        : (intent.extras.set as ExtraSelection[]);
    const inheritMakeAt =
      intent.makeAt === undefined ||
      (intent.makeAt === null && parent.ticket?.stationChosenAt != null);
    const storedOffer = recordedOffer(parent);
    const asOffered = (quantity: string): RequestedLine => ({
      [STORED_SET_MENU_OFFER]: storedOffer,
      [RETAINED_COURSE]: true,
      [STORED_RISE]: true,
      courseId: parent.courseId,
      menuItemId: menuItemOf(parent),
      ...variantOf(parent),
      quantity,
      makeAt: inheritMakeAt ? parent.makeAtStationId : intent.makeAt,
      ...(intent.note === null ? {} : { note: intent.note }),
      [FROZEN_OPTIONS]: optionSnapshots,
      extras: picks,
    });
    if (action === "raise" || (action === "change" && rise > 0) || addedApart) {
      pricing.push({
        ...asOffered(subtractDecimal(requested, parent.quantity)),
        courseId: parent.courseId,
      });
      pricedAs.push(
        addedApart
          ? {
              kind: "line",
              kitchen: kitchenStateOf(parent),
              joins: parent,
              origin: parent,
              inheritMakeAt,
              expand: portion !== undefined,
            }
          : {
              kind: "line",
              kitchen: "fire",
              origin: parent,
              inheritMakeAt,
              expand: portion !== undefined,
            },
      );
    }
    if (action === "free" && rise > 0 && !addedApart) raised.push(asOffered(requested));
    if (action === "change") {
      resent.push(parent.productId!, ...extras.kept.map(({ child }) => child.productId!));
    }
    const quantity =
      (action === "change" && rise > 0) || addedApart || copies > 0 ? parent.quantity : requested;
    let addedAt: number | null = null;
    if (extras.added.length > 0) {
      addedAt = pricing.length;
      pricing.push({
        menuItemId: menuItemOf(parent),
        ...variantOf(parent),
        quantity,
        [FROZEN_OPTIONS]: [],
        [FROZEN_EXTRAS]: extras.added,
        [ADDED_EXTRAS_ONLY]: true,
        [STORED_SET_MENU_OFFER]: storedOffer,
        ...([parent, ...parent.children].some(
          (part) => part.sentAt !== null || part.ticket !== null,
        )
          ? { [ON_SENT_DISH]: true }
          : {}),
      });
      pricedAs.push({ kind: "extras" });
    }
    changes.push({
      parent,
      action,
      quantity,
      note: intent.note,
      makeAt:
        parent.sentAt === null && parent.ticket === null && intent.makeAt !== undefined
          ? intent.makeAt
          : parent.makeAtStationId,
      optionSnapshots,
      kept: extras.kept,
      removedChildren: extras.removed,
      addedAt,
      modified: changed,
      copies,
      portion,
    });
  }

  await assertProductsSellable(tx, resent);

  // Raising a line the kitchen does not have sells more of it at its stored price, so the dish and
  // its extras must still be offered and sellable: priced with the rest, and the price discarded.
  // Last, so `addedAt` still indexes the groups below.
  for (const line of raised) {
    pricing.push(line);
    pricedAs.push({ kind: "check" });
  }

  await refusePaidLines(tx, orderId, plan.removed.flatMap(paidLineParts), paid);
  for (const parent of plan.removed) {
    refuseServed(parent);
    refuseSent(parent, kitchenHas(parent, false));
  }

  // Priced before anything is written, so a refused line leaves the order as it was.
  for (const line of plan.fresh)
    if (line.makeAt != null) await requireMakeAtStation(tx, line.makeAt);
  const priced = await priceOrderLines(
    tx,
    cfg,
    orderId,
    pricing,
    context?.zoneId,
    snapshot,
    "ignore",
    "added",
    lateSend,
  );
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

  // Before any line changes: a notice and a slip copy the line as it stands.
  const held = await planHeldCorrections(tx, orderId, changes, plan.removed);
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

  let nextLineNo = order.maxLineNo;
  const inserted: WorkingOrderLineInsert[] = [];
  const insertedContexts: typeof priced.lineContexts = [];
  const setMenuPlacements: SetMenuPlacement[] = [];
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
        const sent = line.ticket?.sentOrderNumber ?? null;
        if (sent !== null) keepSentNumber.set(sent, [...(keepSentNumber.get(sent) ?? []), line.id]);
        if (line.ticket?.firedAt != null) keepReleased.add(line.id);
        else if (line.ticket?.requestedAt != null)
          keepRequestedAt.set(line.id, line.ticket.requestedAt);
      }
      if (parent.ticket !== null) {
        keepMadeHere.set(parent.id, {
          madeHere: parent.ticket.madeHere,
          stationId: parent.ticket.stationId,
        });
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
      const origin = as.origin;
      const placement = group.contexts[rowIndex]!.placement;
      if (placement !== undefined) {
        setMenuPlacements.push({ workingOrderLineId: row.id!, ...placement });
      } else if (row.parentLineId === null && origin?.setMenuId != null) {
        setMenuPlacements.push({
          workingOrderLineId: row.id!,
          draft: {
            position: setMenuPlacements.length,
            setMenuId: origin.setMenuId,
            reserved: null,
          },
          productId: origin.parentProductId ?? origin.productId!,
          variantId: origin.parentProductId === null ? null : origin.productId,
        });
      }
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
    const placed = await placeSetMenuRows(
      tx,
      orderId,
      inserted.map((row) => ({ ...row, ...contextByLine.get(row.id!) })),
      setMenuPlacements,
    );
    await insertInChunks(tx, workingOrderLines, placed);
    await carryLineReductions(tx, copiedContexts);
    await copyAllergyWorkingTicks(tx, copiedDishes);
  }
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
      stationId: parent.ticket?.stationId ?? null,
      courseId: parent.ticket?.courseId ?? parent.courseId,
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
  if (plan.removed.length > 0) {
    const removedIds = plan.removed.map((parent) => parent.id);
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
