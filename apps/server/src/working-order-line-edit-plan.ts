import "./errors.js";
import type { Transaction } from "@waitron/db";
import { readContentLanguages, assertQuantityPrecision, MAX_UNIT_PRECISION } from "@waitron/menu";
import type { ClosedZoneConfirmation, ZoneMenuOffer } from "@waitron/module";
import {
  AppError,
  compareDecimal,
  decimal,
  type Decimal,
  type OptionSnapshot,
  type ExtraSelection,
  subtractDecimal,
} from "@waitron/shared";
import { readStationChanges, refuseChangesAfterSending } from "./changes-after-sending.js";
import { requireMakeAtStation } from "./dead-ends.js";
import type { VariantSwap } from "./dish-discount-ending.js";
import { isStarted } from "./kitchen-ticket-state.js";
import type { LateSendConfirmation } from "./late-send.js";
import {
  namedPicks,
  asksNoNewAnswer,
  editUnsentLineOptions,
  editLineOptions,
  editLineExtras,
} from "./modifier-selection.js";
import { extraQuantityFor, perDishExtraPicks } from "./order-line-quantities.js";
import { type GrowingPortion, readGrowingPortions } from "./order-portions.js";
import { RETAINED_COURSE } from "./retained-course.js";
import { setMenuOfferLookup } from "./set-menu-offers.js";
import type { TradingContext } from "./trading-context.js";
import {
  type EditableOrder,
  type EditableParent,
  type LineIntent,
  type RequestedLine,
  type EditableLine,
  kitchenStateOf,
  assertProductsSellable,
} from "./working-order-edit-state.js";
import type { RoutingOnce } from "./working-order-kitchen-fire.js";
import {
  readBasketOffers,
  productOptionLists,
  type OfferModifiers,
  NO_MODIFIERS,
  offerModifiers,
  extrasListsFor,
  STORED_SET_MENU_OFFER,
  STORED_RISE,
  STORED_DEPARTMENT,
  FROZEN_OPTIONS,
  FROZEN_EXTRAS,
  ADDED_EXTRAS_ONLY,
  ON_SENT_DISH,
  priceOrderLines,
} from "./working-order-pricing.js";
import { addedPortions } from "./working-order-removal.js";

export interface LineEditPlan {
  edits: { parent: EditableParent; intent: LineIntent }[];
  removed: EditableParent[];
  fresh: RequestedLine[];
  /** Removed lines each replaced by a fresh line of the same menu item at another variant. */
  swaps?: VariantSwap[];
  /** Refuse a lower count where a removal would be refused, rather than take it. */
  refuseSentDrop?: true;
  /** A sent line keeps its options answers while the edit names none it does not hold: a rename
   * cannot be told from a change. A line not yet sent goes through `editUnsentLineOptions`. */
  keepRecordedAnswers?: true;
}

type Action = "free" | "change" | "raise" | "drop";

export interface PreparedLineEdit {
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
}

export async function prepareLineEdits(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  order: EditableOrder,
  plan: LineEditPlan,
  zoneId: string | undefined,
  routing: RoutingOnce,
  lateSend?: LateSendConfirmation,
  zoneConfirmation?: ClosedZoneConfirmation,
) {
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
  const refuseSent = (line: EditableParent, fired: EditableLine["ticket"] | undefined): void => {
    if (fired != null)
      throw new AppError("ticket.already_fired", {
        workingOrderId: orderId,
        stationName: stationChanges.get(fired.stationId)!.name,
      });
    const parts = [line, ...line.children];
    const sent = parts.find((part) => part.sentAt !== null);
    if (sent !== undefined && parts.every((part) => part.ticket === null)) {
      throw new AppError("ticket.already_sent", { workingOrderId: orderId, lineId: sent.id });
    }
  };
  /**
   * Refuses what the kitchen state forbids, the stations' choice only for a change; answers
   * which record first shows fired work. A bare raise leaves the started work alone, so it is not
   * refused as started.
   */
  const firedWork = (line: EditableParent, change: boolean, bareRaise = false) => {
    const records = [line, ...line.children].flatMap((part) =>
      part.ticket === null ? [] : [part.ticket],
    );
    const started = records.find((record) => isStarted(record.state));
    if (started !== undefined && !bareRaise) {
      throw new AppError("ticket.already_started", {
        ticketItemId: started.id,
        stationName: stationChanges.get(started.stationId)!.name,
      });
    }
    if (change) refuseChangesAfterSending(orderId, records, stationChanges);
    return records.find((record) => record.firedAt !== null);
  };
  const wasSent = (parent: EditableParent): boolean =>
    [parent, ...parent.children].some(
      (part) => part.sentAt !== null || part.ticket?.firedAt != null,
    );
  let firedRefusal: AppError | undefined;
  const keepFirstFired = (error: unknown): void => {
    if (!(error instanceof AppError) || error.code === "ticket.already_started") throw error;
    if (error.code === "ticket.already_fired") firedRefusal ??= error;
    else if (firedRefusal === undefined) throw error;
  };
  if (plan.refuseSentDrop) {
    for (const parent of order.parents) {
      if (!wasSent(parent)) continue;
      try {
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
        refuseSent(parent, firedWork(parent, false));
        // refuseSent already refused sends without a ticket.
        const held = (parent.ticket ??
          parent.children.find((part) => part.ticket !== null)?.ticket)!;
        throw new AppError("ticket.already_fired", {
          workingOrderId: orderId,
          stationName: stationChanges.get(held.stationId)!.name,
        });
      } catch (error) {
        keepFirstFired(error);
      }
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
  // With a refusal held, only edits to existing lines can change the answer.
  const freshForSnapshot = firedRefusal === undefined ? plan.fresh : [];
  const snapshot = needsModifiers
    ? await readBasketOffers(tx, orderId, zoneId, freshForSnapshot, [
        ...freshForSnapshot.map((line) => line.menuItemId),
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

  const changes: PreparedLineEdit[] = [];
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
  const extrasChangedIds: string[] = [];
  const resent: string[] = [];
  let chargesUnchanged = plan.removed.length === 0 && plan.fresh.length === 0;
  const portionOf = await readGrowingPortions(
    tx,
    plan.edits.map(({ parent }) => parent.id),
  );

  const planEdit = async ({ parent, intent }: (typeof plan.edits)[number]) => {
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
    if (extrasChanged) extrasChangedIds.push(parent.id);
    const changed =
      intent.note !== parent.note ||
      (parent.sentAt === null &&
        parent.ticket === null &&
        intent.makeAt !== undefined &&
        intent.makeAt !== parent.makeAtStationId) ||
      optionSnapshots !== parent.optionSnapshots ||
      extrasChanged;
    if (!changed && rise === 0) return;
    // A stored line keeps its unit price (bar a dish's own comp or discount, which gives that dish's
    // share back once its extras change), so its extras and its quantity move what it charges; its
    // options answer is filed on the sale line, and a card at the reader files the answer it priced.
    if (extrasChanged || rise !== 0 || optionSnapshots !== parent.optionSnapshots)
      chargesUnchanged = false;
    const refusedDrop = rise < 0 && plan.refuseSentDrop === true;
    if (changed || refusedDrop) refuseServed(parent);
    const fired = firedWork(parent, changed || rise > 0, !changed && rise > 0);
    if (refusedDrop) refuseSent(parent, fired);
    const action: Action =
      fired === undefined ? "free" : changed ? "change" : rise > 0 ? "raise" : "drop";
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
      [STORED_DEPARTMENT]: parent.offerDepartmentId,
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
        [STORED_DEPARTMENT]: parent.offerDepartmentId,
        [STORED_SET_MENU_OFFER]: storedOffer,
        ...([parent, ...parent.children].some(
          (part) => part.sentAt !== null || part.ticket !== null,
        )
          ? { [ON_SENT_DISH]: { stationId: parent.ticket?.stationId ?? null } }
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
  };
  for (const edit of plan.edits) {
    try {
      await planEdit(edit);
    } catch (error) {
      keepFirstFired(error);
    }
  }
  if (firedRefusal !== undefined) throw firedRefusal;

  await assertProductsSellable(tx, resent);

  // Raising a line the kitchen does not have sells more of it at its stored price, so the dish and
  // its extras must still be offered and sellable: priced with the rest, and the price discarded.
  // Last, so `addedAt` still indexes the groups below.
  for (const line of raised) {
    pricing.push(line);
    pricedAs.push({ kind: "check" });
  }

  for (const parent of plan.removed) {
    refuseServed(parent);
    refuseSent(parent, firedWork(parent, false));
  }

  // Priced before anything is written, so a refused line leaves the order as it was.
  for (const line of plan.fresh)
    if (line.makeAt != null) await requireMakeAtStation(tx, line.makeAt);
  const priced = await priceOrderLines(
    tx,
    cfg,
    orderId,
    pricing,
    zoneId,
    snapshot,
    "ignore",
    "added",
    lateSend,
    undefined,
    routing,
    zoneConfirmation,
  );
  return { changes, priced, pricedAs, extrasChangedIds, chargesUnchanged };
}
