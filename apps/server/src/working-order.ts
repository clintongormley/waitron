import {
  buildLineExtras,
  editLineExtras,
  namedPicks,
  sameOptionSelections,
} from "./modifier-selection.js";
import type { ExtraChild, ExtraProductFacts } from "./modifier-selection.js";
import type {
  ExtraSelection,
  KitchenSignal,
  OptionSelection,
  OptionSnapshot,
  SaleLineClassification,
  TableSignal,
} from "@waitron/shared";
import { readReceiptIssuer } from "./receipt-issuer.js";
import { readRestOfOrder, type RestOfOrderItem } from "./rest-of-order.js";
import { requireMakeAtStation } from "./dead-ends.js";
// Side-effect only: keeps this host's error registry (errors.ts) reachable from a file that throws
// its codes.
import "./errors.js";
import { rerouteHeldAtRelease, stillMovable } from "./station-move.js";
import type { Rerouted } from "./station-move.js";
import {
  bumpPartyRevision,
  checkAndBumpParty,
  readBillsOfParties,
  runServiceCommand,
  tableHeld,
  partyFamily,
  partyOfOrder,
} from "./parties.js";
import { randomUUID } from "node:crypto";
import { and, eq, exists, inArray, isNotNull, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import type { GetColumnData, SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  AppError,
  centsToDecimal,
  classifyBand,
  compareDecimal,
  type Decimal,
  decimal,
  decimalToCents,
  decimalToThousandths,
  divideDecimal,
  locationId as brandLocationId,
  partyDisplayName,
  MONEY_SCALE,
  multiplyDecimal,
  perDishOptionQuantity,
  rawCentsToDecimal,
  type SaleId,
  type StationThresholds,
  stringToThousandths,
  subtractDecimal,
  sumDecimals,
  thousandthsToDecimal,
  type TillId,
  type TimingBand,
  toScale,
  workingOrderId as brandWorkingOrderId,
  worstBand,
} from "@waitron/shared";
import {
  allocateOrderNumber,
  appendOrderAmendment,
  billPaymentRefunds,
  billPayments,
  diningTables,
  invoiceSeries,
  isUniqueViolation,
  kitchenCourses,
  kitchenStations,
  nowIso,
  orderGroups,
  orderTableLabels,
  products,
  sales,
  ticketItems,
  partyTables,
  parties,
  partyTableLabels,
  withTransaction,
  workingOrderLines,
  workingOrders,
  workingOrderStatus,
  watcherItemMarks,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import {
  MAX_UNIT_PRECISION,
  assertQuantityPrecision,
  classifyLine,
  contentLanguagesOr,
  expandDietaryDeclarations,
  loadClassification,
  grossBasketWithOptions,
  grossLockedLines,
  menusOfVersions,
  readOptionListsByIds,
  readProductModifiers,
  toInvoiceLineDescriptions,
  readContentLanguages,
  readSavedContentLanguages,
  readInvoiceLocales,
  readReceiptLanguage,
  parentsWithActiveVariants,
  selectMenuVariant,
  customerPresentationText,
  fillBlankLocalesWithStaffName,
  effectiveProductColumns,
  kitchenPresentationName,
  parentJoin,
  parentProducts,
  staffPresentationName,
} from "@waitron/catalogue";
import type {
  BasketItemWithOptions,
  DietaryLabel,
  DietProfile,
  LockedLine,
  GrossLines,
  OptionList,
  ProductAllergens,
  ResolvedExtraList,
  VatClass,
} from "@waitron/catalogue";
import { formatInvoiceNumber, recordSale, refuseOverSimplifiedLimit } from "@waitron/core";
import type {
  FloorAnnotator,
  MakerResolver,
  ServiceMode,
  ZoneMenuOffer,
  ZoneOffers,
} from "@waitron/module";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { authorize, type Override, type PinAttempts } from "@waitron/identity";
import type { FloorTableShape } from "./tables.js";
import { issuancePass } from "./issuance-pass.js";
import { issueMoment, type IssueMoment } from "./issue-moment.js";
import { VENUE_SERVICE } from "./modules.js";
import { readMadeHereStations } from "./made-here.js";
import { requireCourse, requireLiveCourse } from "./kitchen.js";
import { readUnsentDrafts } from "./order-drafts.js";
import { readBillSignals, readPartySignals, tableSignals } from "./table-signals.js";
import type { SeatedPartyFacts } from "./table-signals.js";
import type { UnsentDraft } from "./order-drafts.js";
import {
  correctHoldTickets,
  correctJoin,
  fireHeldGroupsOfCourse,
  onShownBill,
  printedHeldGroups,
  printHoldTickets,
  readReleaseReminders,
  recordGroupEvent,
  removeEmptiedHeldGroups,
  requireGroup,
  requireOperator,
  startGroup,
  type HeldChange,
  type ReleaseReminder,
  type PartyCommandArgs,
} from "./order-groups.js";
import {
  copyKitchenJobLines,
  copyKitchenPrintLinks,
  enqueueCorrectionSlips,
  enqueueExtraCancelled,
  enqueueKitchenTickets,
  enqueueWatcherCopies,
  firedQuantity,
  isStarted,
  ordersWithPrintProblem,
  readCancelledExtra,
} from "./kitchen-print.js";
import type { CancelledExtra, CorrectionItem, FiredItem, TicketState } from "./kitchen-print.js";
import { dishKitchenItems, onDishesOrTheirExtras } from "./dish-kitchen.js";
import { requireNullableString } from "@waitron/server-kit";
import { isUuid } from "./till-session.js";
import type { Logger } from "./logger.js";
import type { TillConfig } from "./till-config.js";
import { readReceiptOrder } from "./receipt-order.js";
import { receiptLines } from "./receipt-adjustments.js";
import { enqueueOriginalReceipt } from "./receipt-print.js";
import { ordersWithUnfiledPayment, paymentAttemptIsLive, receiptQr } from "./till-sale.js";
import type { TillSaleResult } from "./till-sale.js";
import { readIssuedSales } from "./sale-due.js";
import { creditWholeInvoice, readOrderInvoice } from "./cancel-credit.js";
import { overrideToCheck, withCheck, withPinCheckAhead } from "./pin-check-ahead.js";
import {
  assertBillInvariant,
  issueIfFullyPaid,
  outstandingOf,
  readPaidQuantities,
  readPaymentsByBill,
  refuseBillHoldingMoney,
  refuseBillWithPayments,
  refusePaidLines,
} from "./bill-payments.js";

export interface WorkingOrderDeps {
  db: Database;
}

/** `db` plus the fiscal backend and trusted clock that a path filing a sale needs. */
export interface TillSaleDeps {
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
  /** Where a failure that must not undo the sale or attempt around it is logged. */
  log?: Logger;
}

type WorkingOrderLineInsert = typeof workingOrderLines.$inferInsert;

/**
 * `note` is a free-text kitchen note on the parent dish line: non-fiscal, never part of a sale.
 * `menuVersionId` is the menu version an UNSAVED line was priced against on the till: what staff
 * saw, never a request for that version's prices. Absent, the line takes the live version.
 */
export type LineExtras = {
  note?: string;
  variantId?: string;
  menuVersionId?: string;
  makeAt?: string | null;
};

/**
 * The extras and options lists one published offer puts in front of a diner, as the validators
 * take them. An extras item that cannot be picked now is left out, so a pick of it is refused as a
 * pick the list never offered; an edit keeps a pick a stored line already holds by itself
 * ({@link editLineExtras}).
 */
interface OfferModifiers {
  extras: ResolvedExtraList[];
  options: OptionList[];
  /** Every product {@link OfferModifiers.extras} offers, by id: what {@link buildLineExtras}
   * freezes onto a child. */
  extraProducts: ReadonlyMap<string, ExtraProductFacts>;
}

const NO_MODIFIERS: OfferModifiers = { extras: [], options: [], extraProducts: new Map() };

function copyNames(names: Readonly<Record<string, string>> | null): Record<string, string> | null {
  return names === null ? null : { ...names };
}

function offerModifiers(offer: ZoneMenuOffer, defaultLanguage: string): OfferModifiers {
  const extras: ResolvedExtraList[] = [];
  const options: OptionList[] = [];
  const extraProducts = new Map<string, ExtraProductFacts>();
  for (const entry of offer.offeredModifiers) {
    const names = {
      id: entry.id,
      name: entry.name,
      customerName: copyNames(entry.customerName),
      kitchenName: entry.kitchenName,
      active: true,
    };
    if (entry.kind === "options") {
      options.push({
        ...names,
        defaultLabelId: entry.defaultLabelId,
        labels: entry.labels.map((label) => ({
          ...label,
          customerName: copyNames(label.customerName),
        })),
      });
      continue;
    }
    const items = entry.items.filter((item) => item.available);
    for (const item of items) {
      extraProducts.set(item.productId, {
        id: item.productId,
        name: item.name,
        descriptions: customerPresentationText(
          {
            name: item.name,
            customerName: item.customerName,
            kitchenName: item.kitchenName,
            variantName: null,
            variantCustomerName: null,
            variantKitchenName: null,
          },
          defaultLanguage,
        ).product,
        kitchenName: item.kitchenName,
        vatClass: item.vatClass as VatClass,
      });
    }
    extras.push({
      ...names,
      minPicks: entry.minPicks,
      maxPicks: entry.maxPicks,
      items: items.map((item) => ({
        id: "",
        productId: item.productId,
        maxQuantity: item.maxQuantity,
        preselected: item.preselected,
        price: item.price,
        portion: item.portion,
        unit: item.unit,
      })),
    });
  }
  return { extras, options, extraProducts };
}

/** Each product's own options lists, in its order, keyed by the lower-cased product id. */
async function productOptionLists(
  tx: Transaction,
  productIds: readonly string[],
): Promise<Map<string, OptionList[]>> {
  if (productIds.length === 0) return new Map();
  const refs = await readProductModifiers(tx, [...new Set(productIds)]);
  const lists = new Map(
    (
      await readOptionListsByIds(tx, [
        ...new Set(
          [...refs.values()].flatMap((held) =>
            held.flatMap((ref) => (ref.kind === "options" ? [ref.id] : [])),
          ),
        ),
      ])
    ).map((list) => [list.id, list]),
  );
  return new Map(
    [...refs].map(([productId, held]) => [
      productId,
      held.flatMap((ref) => {
        const list = ref.kind === "options" ? lists.get(ref.id) : undefined;
        return list === undefined ? [] : [list];
      }),
    ]),
  );
}

/**
 * The offers `menuItemIds` names from the zone's live menu versions, once every version the basket's
 * lines assert is live (`menu.version_changed` otherwise, before anything is priced or written). An
 * asserted id that is no menu version at all is a malformed request.
 */
async function readBasketOffers(
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
  zoneId: string | undefined,
  lines: readonly { menuVersionId?: unknown }[],
  menuItemIds: readonly unknown[],
): Promise<ZoneOffers> {
  if (zoneId === undefined) {
    throw new AppError("order.service_context_missing", { workingOrderId });
  }
  const versionIds = new Set<string>();
  for (const { menuVersionId } of lines) {
    if (menuVersionId === undefined) continue;
    if (typeof menuVersionId !== "string" || !isUuid(menuVersionId)) {
      throw new AppError("management.request_invalid", { field: "menuVersionId" });
    }
    versionIds.add(menuVersionId.toLowerCase());
  }
  const named = menuItemIds.filter((id): id is string => typeof id === "string");
  const offers = await VENUE_SERVICE.listZoneOffers(tx, cfg, zoneId, { menuItemIds: named });
  const live = new Set(offers.menus.map((menu) => menu.versionId));
  const stale = [...versionIds].filter((versionId) => !live.has(versionId));
  if (stale.length === 0) return offers;
  // Only a refusal is left: its details name each stale version's menu, which is looked up here.
  const menus = await menusOfVersions(tx, stale);
  if (menus.size < stale.length) {
    throw new AppError("management.request_invalid", { field: "menuVersionId" });
  }
  return VENUE_SERVICE.listZoneOffers(tx, cfg, zoneId, {
    asserted: [...menus].map(([versionId, menuId]) => ({ menuId, versionId })),
    menuItemIds: named,
  });
}

/**
 * Marks a requested line that only prices extras added to a stored dish: its dish row is discarded,
 * so it orders no new portion of the dish. A symbol, so no JSON body can set it.
 */
const ADDED_EXTRAS_ONLY = Symbol("addedExtrasOnly");

/**
 * Price requested lines from the order's zone's live menu versions — the dish, variant, extras and
 * options alike, each at the VAT class the version froze — and classify each line's product as it
 * stands now. Return both the insertable line snapshots and their gross lines, so a caller filing
 * the same basket rates those rather than pricing it twice. The stored gross unit price, class and
 * classification are what the line files.
 */
export async function priceOrderLines(
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
  // `courseId` absent or null = the offer's default course; a string is an override.
  // Each extras pick becomes a CHILD row taxed at the picked product's frozen class, never the dish's.
  // An ACTIVE options list must be answered even when `options` is absent.
  // `frozenOptions` and `frozenExtras` stand for answers an edit has already settled: an options
  // answer or an extras pick given that way is not validated or looked up again.
  requestedLines: ({
    menuItemId: string;
    quantity: string;
    courseId?: string | null;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
    frozenOptions?: OptionSnapshot[];
    frozenExtras?: ExtraChild[];
    [ADDED_EXTRAS_ONLY]?: true;
  } & LineExtras)[],
  zoneId?: string,
  /** The zone's offers, when the caller has already read them with {@link readBasketOffers}. */
  snapshot?: ZoneOffers,
  invalidMakeAt: "refuse" | "ignore" = "refuse",
): Promise<{
  lineRows: WorkingOrderLineInsert[];
  gross: GrossLines;
  identities: OrderLineIdentity[];
  lineContexts: { workingOrderLineId: string; menuItemId: string }[];
  /** The zone's offers the lines were priced from, for `recordLineContexts`. */
  offers: ZoneOffers;
}> {
  if (requestedLines.length === 0) {
    // A lineless call needs no zone and reads nothing.
    return {
      lineRows: [],
      gross: grossBasketWithOptions([]),
      identities: [],
      lineContexts: [],
      offers: { defaultMenuId: null, menus: [], offers: [] },
    };
  }
  const offers =
    snapshot ??
    (await readBasketOffers(
      tx,
      cfg,
      workingOrderId,
      zoneId,
      requestedLines,
      requestedLines.map((line) => line.menuItemId),
    ));
  const offerById = new Map(offers.offers.map((offer) => [offer.id, offer]));
  const versionOf = new Map(offers.menus.map((menu) => [menu.id, menu.versionId]));
  const lines = requestedLines.map((line) => {
    // The wire body is JSON, so a line may still name a product the types no longer carry.
    if (typeof line.menuItemId !== "string" || Object.hasOwn(line, "productId")) {
      throw new AppError("management.request_invalid", { field: "lines" });
    }
    const offer = offerById.get(line.menuItemId);
    if (offer === undefined) {
      throw new AppError("service_zone.offer_not_allowed", {
        zoneId: zoneId!,
        menuItemId: line.menuItemId,
      });
    }
    // Every asserted version is live, so one naming another menu is not this line's.
    if (
      line.menuVersionId !== undefined &&
      line.menuVersionId.toLowerCase() !== versionOf.get(offer.menuId)
    ) {
      throw new AppError("management.request_invalid", { field: "menuVersionId" });
    }
    if (!offer.available) {
      throw new AppError("product.unavailable", { productId: offer.productId });
    }
    if (offer.ordering === "not_sold_separately" && line[ADDED_EXTRAS_ONLY] !== true) {
      throw new AppError("product.not_sold_separately", { productId: offer.productId });
    }
    return { ...line, offer };
  });
  const invoiceLocales = await readInvoiceLocales(tx, cfg.locationId);
  const savedLanguages = await readSavedContentLanguages(tx);
  const contentConfig = contentLanguagesOr(savedLanguages, cfg.locale);

  const modifiersByOffer = new Map<string, OfferModifiers>();
  for (const { offer } of lines) {
    if (!modifiersByOffer.has(offer.id)) {
      modifiersByOffer.set(offer.id, offerModifiers(offer, contentConfig.defaultLanguage));
    }
  }
  // A product with an Active variant is never sold as itself, and an extras pick cannot name a
  // variant, so a pick of such a product is refused below, before the published lists are asked:
  // a version published after the variant was switched on no longer offers the product at all.
  const picksOf = (line: (typeof lines)[number]) => line.frozenExtras ?? namedPicks(line.extras);
  const requiresVariant = await parentsWithActiveVariants(tx, [
    ...new Set(lines.flatMap((line) => picksOf(line).map((pick) => pick.productId))),
  ]);

  // `grossBasketWithOptions` expands each item to a parent row then its child rows in this same
  // order, so `lineMeta[i]` lines up with `gross.lines[i]` one-for-one.
  const namedStations = [
    ...new Set(lines.flatMap((line) => (line.makeAt == null ? [] : [line.makeAt]))),
  ];
  const activeStations = new Set(
    namedStations.length === 0
      ? []
      : (
          await tx
            .select({ id: kitchenStations.id })
            .from(kitchenStations)
            .where(
              and(
                inArray(kitchenStations.id, namedStations),
                eq(kitchenStations.locationId, cfg.locationId),
                eq(kitchenStations.active, true),
              ),
            )
        ).map((station) => station.id),
  );
  if (invalidMakeAt === "refuse") {
    const invalidStationId = namedStations.find((stationId) => !activeStations.has(stationId));
    if (invalidStationId !== undefined)
      throw new AppError("route.station_inactive", { stationId: invalidStationId });
  }
  type LineMeta =
    | {
        kind: "parent";
        productId: string;
        menuItemId: string;
        courseId: string | null;
        note: string | null;
        makeAt: string | null;
      }
    | { kind: "child"; productId: string; menuItemId: string; extraListId: string };
  const items: BasketItemWithOptions[] = [];
  const lineMeta: LineMeta[] = [];
  for (const line of lines) {
    const { offer } = line;
    const selection = selectMenuVariant(offer, line.variantId ?? null);
    const customerText = customerPresentationText(selection, contentConfig.defaultLanguage);
    const product = {
      name: selection.name,
      unitPrice: selection.unitPrice,
      unit: selection.unit,
      pricingUnit: selection.unit.hardwareUnit === null ? ("each" as const) : ("weight" as const),
      vatClass: selection.vatClass as VatClass,
      category: selection.category,
      courseId: selection.courseId,
      descriptions: customerText.product,
      variantName: selection.variantName,
      variantDescriptions: customerText.variant,
      variantKitchenName: selection.variantKitchenName,
      kitchenName: selection.kitchenName,
    };

    // Validated before pricing, so a bad note aborts the whole basket.
    const note = screenNote(line.note);

    for (const { productId } of picksOf(line)) {
      if (requiresVariant.has(productId)) {
        throw new AppError("product.variant_required", { productId });
      }
    }

    const modifiers = modifiersByOffer.get(offer.id)!;
    const built = buildLineExtras(
      {
        extras: line.frozenExtras === undefined ? modifiers.extras : [],
        options: line.frozenOptions === undefined ? modifiers.options : [],
      },
      modifiers.extraProducts,
      {
        extras: line.frozenExtras === undefined ? line.extras : [],
        options: line.frozenOptions === undefined ? line.options : [],
      },
      contentConfig.defaultLanguage,
    );
    const extraChildren = line.frozenExtras ?? built.extraChildren;
    const optionSnapshots = line.frozenOptions ?? built.optionSnapshots;

    // A child is priced at dish quantity × pick quantity, so a dish sold by weight would bill a
    // fraction of each extra.
    if (extraChildren.length > 0 && product.pricingUnit !== "each") {
      throw new AppError("extras.unsupported_product", {
        productId: offer.productId,
        pricingUnit: product.pricingUnit,
      });
    }

    items.push({
      product,
      quantity: line.quantity,
      optionSnapshots,
      options: extraChildren.map((child) => ({
        name: child.name,
        descriptions: child.descriptions,
        kitchenName: child.kitchenName,
        // The GROSS price of ONE of this extra.
        priceDelta: child.price,
        // Always set, so the dish's class is never inherited.
        vatClass: child.vatClass,
        quantity: child.quantity,
        physicalQuantity: child.physicalQuantity,
        priceQuantity: child.priceQuantity,
        unitName: child.unitName,
        unitPrecision: child.unitPrecision,
      })),
    });
    // A CHILD row takes no course: kitchen coursing is per dish.
    lineMeta.push({
      kind: "parent",
      productId: selection.productId,
      menuItemId: line.menuItemId,
      courseId: line.courseId ?? product.courseId ?? null,
      note,
      makeAt: line.makeAt != null && activeStations.has(line.makeAt) ? line.makeAt : null,
    });
    for (const child of extraChildren) {
      lineMeta.push({
        kind: "child",
        productId: child.productId,
        menuItemId: line.menuItemId,
        extraListId: child.listId,
      });
    }
  }

  // Only an OVERRIDE is screened: the product's default course is already a stored key, and
  // re-validating it would refuse a product whose default course was since deactivated.
  const overrideCourseIds = new Set(
    lines
      .map((line) => line.courseId)
      .filter((courseId): courseId is string => courseId !== null && courseId !== undefined),
  );
  for (const courseId of overrideCourseIds) {
    if (!isUuid(courseId)) {
      throw new AppError("course.not_found", { courseId });
    }
    await requireLiveCourse(tx, cfg, courseId);
  }

  const gross = grossBasketWithOptions(items);
  const classification = await loadClassification(tx, [
    ...new Set(lineMeta.map((meta) => meta.productId)),
  ]);
  const classifications = lineMeta.map((meta) => classifyLine(classification, meta.productId));

  // New lines snapshot the location's receipt languages; locked and issued lines keep their stored
  // text. A locale a variant's text leaves blank takes the variant's own staff name, never the
  // parent's.
  for (const line of gross.lines) {
    line.descriptions = toInvoiceLineDescriptions(
      line.descriptions,
      invoiceLocales,
      contentConfig.defaultLanguage,
    );
    if (line.variantDescriptions != null) {
      line.variantDescriptions = fillBlankLocalesWithStaffName(
        toInvoiceLineDescriptions(
          line.variantDescriptions,
          invoiceLocales,
          contentConfig.defaultLanguage,
        ),
        line.variantName ?? "",
      );
    }
  }

  // Pre-generated so a CHILD row's `parent_line_id` can name its parent's id in the same insert.
  const ids = gross.lines.map(() => randomUUID());
  const byLineNo = new Map(gross.lines.map((line, i) => [line.lineNo, ids[i]!]));
  const lineRows = gross.lines.map((line, i) => {
    const meta = lineMeta[i]!;
    return {
      id: ids[i]!,
      workingOrderId,
      lineNo: line.lineNo,
      parentLineId: line.parentLineNo == null ? null : byLineNo.get(line.parentLineNo)!,
      productId: meta.productId,
      name: line.name,
      descriptions: line.descriptions,
      // Read off the gross line, so this row and a walk-up's sale filed from the same `gross`
      // result cannot describe different answers.
      optionSnapshots: line.optionSnapshots,
      unitName: line.unitName,
      unitPrecision: line.unitPrecision,
      quantity: stringToThousandths(line.quantity),
      ...(line.priceQuantity === undefined
        ? {}
        : { priceQuantity: stringToThousandths(line.priceQuantity) }),
      // The gross unit price LOCKED at add time: a retrieved order is filed from it without a
      // re-price, so a later catalogue price change never moves the filed total. Never derived as
      // `line_total ÷ quantity`, which drifts for a weighed line.
      unitPriceGross: decimalToCents(line.grossUnitPrice),
      vatClass: line.vatClass,
      // GROSS, unlike the filed `sale_lines.line_total`'s net base: every total the operator and
      // customer see is gross, so the held-orders list's `sum(line_total)` must be too.
      lineTotal: decimalToCents(line.lineGross),
      category: line.category ?? null,
      courseId: meta.kind === "parent" ? meta.courseId : null,
      note: meta.kind === "parent" ? meta.note : null,
      makeAtStationId: meta.kind === "parent" ? meta.makeAt : null,
      extraListId: meta.kind === "child" ? meta.extraListId : null,
      // From the priced row, never the request: only it holds the re-keyed customer text.
      variantName: line.variantName ?? null,
      variantDescriptions: line.variantDescriptions ?? null,
      variantKitchenName: line.variantKitchenName ?? null,
      kitchenName: line.kitchenName ?? null,
      classification: classifications[i]!,
    };
  });
  const identities = lineMeta.map((meta, index) => ({
    id: ids[index]!,
    productId: meta.productId,
    classification: classifications[index]!,
    listUnitGross: null,
  }));
  const lineContexts = lineMeta.map((meta, index) => ({
    workingOrderLineId: ids[index]!,
    menuItemId: meta.menuItemId,
  }));
  return { lineRows, gross, identities, lineContexts, offers };
}

/**
 * A line's free-text kitchen note, trimmed, or `null` for none. The body is JSON, so a non-string is
 * screened out before it can reach `.trim()` as a TypeError.
 */
export function screenNote(value: unknown): string | null {
  const NOTE_LIMIT = 200;
  const screened = value === undefined ? null : requireNullableString(value, "note");
  const trimmed = screened?.trim() ?? "";
  if (trimmed.length > NOTE_LIMIT) {
    throw new AppError("working_order.note_too_long", {
      length: trimmed.length,
      limit: NOTE_LIMIT,
    });
  }
  return trimmed.length === 0 ? null : trimmed;
}

/** A line's product can be sold now: Active and Available, and so is its parent for a variant. */
export const productSellable = sql<number>`(${products.active} and ${products.available}
  and (${parentProducts.id} is null or (${parentProducts.active} and ${parentProducts.available})))`;

const storedLineColumns = {
  id: workingOrderLines.id,
  productId: workingOrderLines.productId,
  parentLineId: workingOrderLines.parentLineId,
  grossUnitPrice: workingOrderLines.unitPriceGross,
  listUnitPriceGross: workingOrderLines.listUnitPriceGross,
  quantity: workingOrderLines.quantity,
  priceQuantity: workingOrderLines.priceQuantity,
  vatClass: workingOrderLines.vatClass,
  name: workingOrderLines.name,
  descriptions: workingOrderLines.descriptions,
  optionSnapshots: workingOrderLines.optionSnapshots,
  category: workingOrderLines.category,
  unitName: workingOrderLines.unitName,
  unitPrecision: workingOrderLines.unitPrecision,
  variantName: workingOrderLines.variantName,
  variantDescriptions: workingOrderLines.variantDescriptions,
  variantKitchenName: workingOrderLines.variantKitchenName,
  kitchenName: workingOrderLines.kitchenName,
  classification: workingOrderLines.classification,
};

type StoredLineRow = {
  [K in keyof typeof storedLineColumns]: GetColumnData<(typeof storedLineColumns)[K]>;
};

/**
 * Read a persisted order's STORED lines, snapshotted at add time, so every path that files a
 * persisted order files the same locked composition and a later catalogue price or VAT change never
 * moves the filed total.
 *
 * Refuses a LINELESS order with `sale.empty_basket`: an empty tab is a reachable state, and this is
 * the last check before its pay or place reaches a fiscal write or a card charge.
 */
export async function readLockedLines(
  tx: Transaction,
  workingOrderId: string,
): Promise<StoredOrderLine[]> {
  return toStoredLines(
    await tx
      .select(storedLineColumns)
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, workingOrderId))
      .orderBy(workingOrderLines.lineNo),
  );
}

/** {@link readLockedLines}, with whether each line may be paid now, read in the same query. */
async function readLockedLinesForIssuance(
  tx: Transaction,
  workingOrderId: string,
): Promise<(StoredOrderLine & { payable: boolean })[]> {
  const rows = await tx
    .select({
      ...storedLineColumns,
      sentAt: workingOrderLines.sentAt,
      sellable: productSellable,
    })
    .from(workingOrderLines)
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(parentProducts, parentJoin)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId))
    .orderBy(workingOrderLines.lineNo);
  return toStoredLines(rows).map((line, i) => ({
    ...line,
    // A sent line is committed work, payable whatever its product's availability now.
    payable:
      line.identity.productId === null || rows[i]!.sentAt !== null || Boolean(rows[i]!.sellable),
  }));
}

function toStoredLines(stored: readonly StoredLineRow[]): StoredOrderLine[] {
  if (stored.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }
  // `parentLineNo` is rebuilt in the array-position space `grossRows` renumbers into (`i + 1`), NOT
  // the stored `line_no` space: a void or a transfer leaves stored numbers with gaps, and keying on
  // them would file a child under the wrong parent in the immutable record.
  const positionById = new Map(stored.map((line, i) => [line.id, i + 1]));
  return stored.map((line) => ({
    identity: {
      id: line.id,
      productId: line.productId,
      classification: line.classification,
      listUnitGross:
        line.listUnitPriceGross === null ? null : centsToDecimal(line.listUnitPriceGross),
    },
    locked: {
      grossUnitPrice: centsToDecimal(line.grossUnitPrice),
      quantity: thousandthsToDecimal(line.quantity),
      priceQuantity: thousandthsToDecimal(line.priceQuantity),
      vatClass: line.vatClass as VatClass,
      name: line.name,
      descriptions: line.descriptions,
      optionSnapshots: line.optionSnapshots,
      category: line.category,
      unitName: line.unitName,
      unitPrecision: line.unitPrecision,
      parentLineNo:
        line.parentLineId == null ? null : (positionById.get(line.parentLineId) ?? null),
      variantName: line.variantName,
      variantDescriptions: line.variantDescriptions,
      variantKitchenName: line.variantKitchenName,
      kitchenName: line.kitchenName,
    },
  }));
}

/** A stored working-order line: its identity and its locked composition. */
export interface StoredOrderLine {
  identity: OrderLineIdentity;
  locked: LockedLine;
}

/** A working-order line's own identity. The filed sale line does not keep the line `id`. */
export interface OrderLineIdentity {
  id: string;
  productId: string | null;
  /** Recorded when the line was added. */
  classification: SaleLineClassification | null;
  /** The unit price before a comp or a discount changed it, or null. */
  listUnitGross: Decimal | null;
}

/** Gross lines together with, at the same index, the working-order line each was priced from. */
export interface GrossOrder {
  gross: GrossLines;
  identities: OrderLineIdentity[];
}

/** A persisted order's gross lines exactly as they are stored, to rebuild a filed ticket's lines or
 * total a bill. A rebuilt ticket takes its VAT breakdown from the filed record. */
export async function priceStoredOrder(
  tx: Transaction,
  workingOrderId: string,
): Promise<GrossLines> {
  return (await readStoredOrder(tx, workingOrderId)).gross;
}

/** What a persisted order's stored lines total, the figure its invoice is issued at; a lineless
 * order totals nothing. */
export async function storedOrderTotal(tx: Transaction, workingOrderId: string): Promise<Decimal> {
  const [line] = await tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, workingOrderId))
    .limit(1);
  return line === undefined ? decimal("0.00") : (await priceStoredOrder(tx, workingOrderId)).total;
}

/** An order's {@link storedOrderTotal} before an edit, for {@link refuseOrderOverSimplifiedLimit};
 * null, and nothing read, where the regime sets no limit. */
async function totalBeforeEdit(
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
): Promise<Decimal | null> {
  return cfg.simplifiedInvoiceLimit === null ? null : storedOrderTotal(tx, workingOrderId);
}

/**
 * Refuses, on the caller's transaction and so before anything it wrote commits, an edit that
 * raised an order's stored total above `before` and over the regime's simplified-invoice limit
 * (`cfg.simplifiedInvoiceLimit`). An edit that leaves the total at or below `before` passes even
 * with the order still over, so an order that grew before the limit existed can be shrunk step by
 * step.
 */
export async function refuseOrderOverSimplifiedLimit(
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
  before: Decimal | null,
): Promise<void> {
  if (cfg.simplifiedInvoiceLimit === null) return;
  const after = await storedOrderTotal(tx, workingOrderId);
  if (before !== null && compareDecimal(after, before) <= 0) return;
  refuseOverSimplifiedLimit(cfg.simplifiedInvoiceLimit, after);
}

/** {@link priceStoredOrder}, with the working-order line each gross line was priced from. */
export async function readStoredOrder(
  tx: Transaction,
  workingOrderId: string,
): Promise<GrossOrder> {
  const stored = await readLockedLines(tx, workingOrderId);
  return {
    gross: grossLockedLines(stored.map(({ locked }) => locked)),
    identities: stored.map(({ identity }) => identity),
  };
}

/**
 * A persisted order's gross lines to issue an invoice from: each line's stored gross unit price and
 * stored VAT class, which `issueMoment` rates on the day the invoice is issued. Returns each line's
 * working-order identity for `issuancePass`, and refuses a lineless order (see
 * {@link readLockedLines}).
 *
 * A line never sent whose product cannot be sold now is refused `product.unavailable` (spec §11.3):
 * staff remove it, or split the rest off, before paying. A sent line pays whatever its product's
 * availability. `refuseUnsentUnavailable: false` is for a payment the card network has already
 * captured, which is filed as it stands.
 */
export async function priceStoredOrderForIssuance(
  tx: Transaction,
  workingOrderId: string,
  options: { refuseUnsentUnavailable: boolean } = { refuseUnsentUnavailable: true },
): Promise<GrossOrder> {
  const stored = await readLockedLinesForIssuance(tx, workingOrderId);
  const unpayable = stored.find((line) => !line.payable);
  if (options.refuseUnsentUnavailable && unpayable !== undefined) {
    throw new AppError("product.unavailable", { productId: unpayable.identity.productId! });
  }
  return {
    gross: grossLockedLines(stored.map(({ locked }) => locked)),
    identities: stored.map(({ identity }) => identity),
  };
}

/** Read a filed sale's invoice number ("A/1"); the fiscal record reference is regime-opaque and
 * carries none. */
export async function readInvoiceNumber(tx: Transaction, saleId: SaleId): Promise<string> {
  return (await readInvoiceNumbers(tx, [saleId])).get(saleId)!;
}

/** {@link readInvoiceNumber} of each named sale, by sale id, in one read. */
export async function readInvoiceNumbers(
  tx: Transaction,
  saleIds: readonly string[],
): Promise<Map<string, string>> {
  if (saleIds.length === 0) return new Map();
  const issued = await tx
    .select({ id: sales.id, code: invoiceSeries.code, number: sales.invoiceNumber })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(inArray(sales.id, [...saleIds]));
  return new Map(issued.map((row) => [row.id, formatInvoiceNumber(row.code, row.number)]));
}

/** Surcharge fields a VAT band may carry are dropped deliberately: the counter ticket carries base
 * and tax only. */
export function toVatBreakdown(
  bands: readonly { rate: string; base: string; tax: string }[],
): { rate: string; base: string; tax: string }[] {
  return bands.map((v) => ({ rate: v.rate, base: v.base, tax: v.tax }));
}

/**
 * Carries NO price of any kind: the server prices from the zone's menu offers.
 *
 * `id` is client-supplied and held stable across a retry, which makes park IDEMPOTENT: a re-sent
 * park collides on `working_orders.id` and replays the existing OPEN order's result. A colliding id
 * whose row is no longer `open` is an id reuse, not a retry, and is re-thrown.
 *
 * `operatorId` is credited with the order's lines (`working_order_lines.credited_to`).
 */
export interface ParkOrderRequest {
  id: string;
  lines: ({
    menuItemId: string;
    quantity: string;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
  } & LineExtras)[];
  zoneId?: string;
  label?: string;
  operatorId?: string;
}

export interface ParkOrderResult {
  id: string;
  orderNumber: number;
}

/**
 * Persist an OPEN working order and its priced lines on the CALLER's transaction, returning the
 * gross lines its rows were built from so a walk-up files its sale from the same lines. Shared so a
 * walk-up order has the same shape as a parked one. The empty-basket refusal stays with each caller.
 */
export async function createOpenOrder(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  lines: ({
    menuItemId: string;
    quantity: string;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
  } & LineExtras)[],
  label: string | null,
  // `creditedTo` is the operator creating the order, whose sale its lines count as.
  placement: {
    deliveryTableId?: string | null;
    zoneId?: string;
    partyId?: string | null;
    creditedTo?: string;
    invalidMakeAt?: "ignore";
  } = {},
): Promise<{
  orderNumber: number;
  gross: GrossLines;
  identities: OrderLineIdentity[];
  lineRows: WorkingOrderLineInsert[];
}> {
  // Checked first so an unknown id is `table.not_found`, not a raw foreign-key failure. An inactive
  // table is allowed.
  const deliveryTableId = placement.deliveryTableId ?? null;
  let effectiveZoneId = placement.zoneId;
  if (deliveryTableId !== null) {
    const [table] = await tx
      .select({ id: diningTables.id, zoneId: diningTables.zoneId })
      .from(diningTables)
      .where(
        and(eq(diningTables.id, deliveryTableId), eq(diningTables.locationId, cfg.locationId)),
      );
    if (table === undefined) {
      throw new AppError("table.not_found", { tableId: deliveryTableId });
    }
    effectiveZoneId = table.zoneId ?? effectiveZoneId;
  }
  const pricedLines = await priceOrderLines(
    tx,
    cfg,
    id,
    lines,
    effectiveZoneId,
    undefined,
    placement.invalidMakeAt ?? "refuse",
  );
  const { gross, identities, lineContexts, offers } = pricedLines;
  refuseOverSimplifiedLimit(cfg.simplifiedInvoiceLimit, gross.total);
  const lineRows = pricedLines.lineRows.map((row) => ({
    ...row,
    creditedTo: placement.creditedTo ?? null,
  }));
  const orderNumber = await allocateOrderNumber(tx, cfg.nodeId);

  await tx.insert(workingOrders).values({
    id,
    tillId: cfg.tillId,
    nodeId: cfg.nodeId,
    orderNumber,
    label,
    status: "open",
    // Not a fiscal field.
    deliveryTableId,
    partyId: placement.partyId ?? null,
  });

  // An empty tab has no lines, and `tx.insert(...).values([])` throws.
  if (lineRows.length > 0) {
    await tx.insert(workingOrderLines).values(lineRows);
  }
  if (effectiveZoneId !== undefined) {
    await VENUE_SERVICE.recordOrderContext(tx, cfg, id, effectiveZoneId);
    await VENUE_SERVICE.recordLineContexts(tx, cfg, id, lineContexts, offers);
  }

  return { orderNumber, gross, identities, lineRows };
}

export async function parkOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  req: ParkOrderRequest,
): Promise<ParkOrderResult> {
  if (req.lines.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }

  try {
    return await withTransaction(deps.db, async (tx) => {
      const { orderNumber } = await createOpenOrder(tx, cfg, req.id, req.lines, req.label ?? null, {
        zoneId: req.zoneId,
        creditedTo: req.operatorId,
      });
      return { id: req.id, orderNumber };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // A re-sent park collided on the id an earlier park committed. One write transaction runs on the
    // venue file at a time, so that row is readable in a fresh transaction: replay its number.
    return withTransaction(deps.db, async (tx) => {
      const [existing] = await tx
        .select({ orderNumber: workingOrders.orderNumber })
        .from(workingOrders)
        .where(and(eq(workingOrders.id, req.id), eq(workingOrders.status, "open")));
      // The colliding id is not `open`: an id reuse, not a retry.
      if (existing === undefined) {
        throw error;
      }
      return { id: req.id, orderNumber: existing.orderNumber };
    });
  }
}

/**
 * Open the party's first bill at a table, clearing the table's manual status. Refused while the
 * table needs clearing and while a party holds it (an active `party_tables` row); the caller adds
 * the party's membership afterwards. The check cannot interleave with a second `openTab`, because
 * `withTransaction` IS the venue file's write lock.
 */
export async function openTab(
  tx: Transaction,
  cfg: TillConfig,
  req: {
    tableId: string;
    lines?: { menuItemId: string; quantity: string }[];
    partyId: string;
    /** Credited with `lines`. */
    operatorId?: string;
  },
): Promise<{ tabId: string; orderNumber: number }> {
  const [table] = await tx
    .select({
      active: diningTables.active,
      zoneId: diningTables.zoneId,
      needsClearingSince: diningTables.needsClearingSince,
    })
    .from(diningTables)
    .where(eq(diningTables.id, req.tableId));
  if (table === undefined) {
    throw new AppError("table.not_found", { tableId: req.tableId });
  }
  if (!table.active) {
    throw new AppError("table.inactive", { tableId: req.tableId });
  }
  if (table.needsClearingSince !== null) {
    throw new AppError("table.needs_clearing", { tableId: req.tableId });
  }

  if (table.zoneId !== null) {
    const context = await VENUE_SERVICE.resolveZoneContext(tx, cfg, table.zoneId);
    if (context.serviceMode !== "table_tab") {
      throw new AppError("service_zone.mode_incompatible", {
        zoneId: table.zoneId,
        expected: "table_tab",
        actual: context.serviceMode,
      });
    }
  }

  // A party still holds the table after its bills settle, until Finish table.
  if (await tableHeld(tx, req.tableId)) {
    throw new AppError("tab.already_open", { tableId: req.tableId });
  }

  const tabId = randomUUID();
  const { orderNumber } = await createOpenOrder(tx, cfg, tabId, req.lines ?? [], null, {
    zoneId: table.zoneId ?? undefined,
    partyId: req.partyId,
    creditedTo: req.operatorId,
  });
  await tx.update(diningTables).set({ statusId: null }).where(eq(diningTables.id, req.tableId));
  return { tabId, orderNumber };
}

/**
 * This working order is an open bill of a party, else `tab.not_open`; answers its revision. A counter
 * order is not.
 */
export async function assertPartyBillOpen(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
): Promise<number> {
  void cfg;
  const [order] = await tx
    .select({
      status: workingOrders.status,
      partyId: workingOrders.partyId,
      revision: workingOrders.revision,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, tabId));
  if (order?.status !== "open" || order.partyId === null) {
    throw new AppError("tab.not_open", { tabId });
  }
  return order.revision;
}

/** The columns of a stored line {@link fireLines} reads. */
export const fireableLineColumns = {
  id: workingOrderLines.id,
  productId: workingOrderLines.productId,
  courseId: workingOrderLines.courseId,
  parentLineId: workingOrderLines.parentLineId,
  note: workingOrderLines.note,
  quantity: workingOrderLines.quantity,
};

type FireableLine = {
  [K in keyof typeof fireableLineColumns]: GetColumnData<(typeof fireableLineColumns)[K]>;
};

export type RoutingOnce = (() => Promise<MakerResolver>) & {
  readonly at: Date;
  readonly opened: () => Promise<MakerResolver> | undefined;
};

export function routingOnce(tx: Transaction, cfg: TillConfig, at: Date): RoutingOnce {
  let opened: Promise<MakerResolver> | undefined;
  return Object.assign(() => (opened ??= VENUE_SERVICE.routingAt(tx, cfg, at)), {
    at,
    opened: () => opened,
  });
}

interface DishKitchenPlace {
  dishLineId: string;
  stationId: string | null;
  courseId: string | null;
  firedAt: string | null;
}

/** Insert records only for extra lines whose own station differs from their dish's destination. */
export async function insertSplitExtras(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  zoneId: string | null,
  dishes: readonly DishKitchenPlace[],
  routing: RoutingOnce,
): Promise<
  { workingOrderLineId: string; stationId: string; firedAt: string | null; quantity: number }[]
> {
  if (dishes.length === 0) return [];
  const byDish = new Map(dishes.map((dish) => [dish.dishLineId, dish]));
  const extras = await tx
    .select({
      id: workingOrderLines.id,
      parentLineId: workingOrderLines.parentLineId,
      productId: workingOrderLines.productId,
      quantity: workingOrderLines.quantity,
      ticketId: ticketItems.id,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      inArray(
        workingOrderLines.parentLineId,
        dishes.map((dish) => dish.dishLineId),
      ),
    );
  const fresh = extras.filter((extra) => extra.ticketId === null && extra.productId !== null);
  if (fresh.length === 0) return [];
  const decisions = await (
    await routing()
  ).extraMakers(
    zoneId,
    fresh.map((extra) => ({
      key: extra.id,
      productId: extra.productId!,
      dishStationId: byDish.get(extra.parentLineId!)!.stationId,
    })),
  );
  const madeHere = await readMadeHereStations(tx, cfg.sendingDeviceId);
  const values = fresh.flatMap((extra) => {
    const decision = decisions.get(extra.id);
    if (decision?.kind !== "made") return [];
    const dish = byDish.get(extra.parentLineId!)!;
    const here = madeHere.has(decision.stationId);
    const firedAt = here ? routing.at.toISOString() : dish.firedAt;
    return [
      {
        nodeId: cfg.nodeId,
        workingOrderId: orderId,
        workingOrderLineId: extra.id,
        stationId: decision.stationId,
        courseId: dish.courseId,
        note: null,
        quantity: extra.quantity,
        firedAt,
        madeHere: here,
        state: here ? ("ready" as const) : ("queued" as const),
        readyAt: here ? firedAt : null,
      },
    ];
  });
  if (values.length === 0) return [];
  try {
    const inserted = await tx.insert(ticketItems).values(values).returning({
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      firedAt: ticketItems.firedAt,
      quantity: ticketItems.quantity,
      madeHere: ticketItems.madeHere,
    });
    for (const row of inserted) if (row.madeHere) cfg.madeHereSink?.add(row.workingOrderLineId);
    return inserted
      .filter((row) => !row.madeHere)
      .map((row) => ({
        workingOrderLineId: row.workingOrderLineId,
        stationId: row.stationId,
        firedAt: row.firedAt,
        quantity: row.quantity!,
      }));
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AppError("ticket.already_fired", { workingOrderId: orderId });
    throw error;
  }
}

/**
 * The order's dish lines the kitchen has not been given, in line order: never stamped sent and
 * holding no ticket item. A held or recalled dish that goes to a station holds one; a
 * no-preparation dish is stamped sent when it fires, so one still held is returned.
 */
export async function unsentDishLines(tx: Transaction, orderId: string): Promise<FireableLine[]> {
  return tx
    .select(fireableLineColumns)
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        eq(workingOrderLines.workingOrderId, orderId),
        isNull(workingOrderLines.parentLineId),
        isNull(workingOrderLines.sentAt),
        isNull(ticketItems.id),
      ),
    )
    .orderBy(workingOrderLines.lineNo);
}

/**
 * Every order routes by exceptions, folder claims and the active default station. Station and
 * course are chosen at fire time. A made-here item is recorded and never printed. Extras are
 * decided after their dish against the same routing snapshot. An extra made elsewhere copies the
 * dish's course and hold, unless made here: then it is ready and fired at the send, even when its
 * dish is held.
 * An unroutable outcome refuses the send, unless payment uses `unroutable: "skip"` to leave
 * the dish unfired and unstamped and return it for the paid-order alert.
 */
export async function fireLines(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  // The dish decides first; an extra may get a separate record after its destination is known.
  // `quantity` is the line's stored thousandths, which the kitchen is asked to make.
  // `hold: true` inserts the line unfired whatever its course unless it is made here, and
  // `release: true` fires it whatever its course; neither is stored.
  lines: (FireableLine & { hold?: boolean; release?: boolean })[],
  options: {
    unroutable?: "skip";
    keepStations?: ReadonlyMap<string, string>;
    keepMadeHere?: ReadonlyMap<string, { madeHere: boolean; stationId: string }>;
    routing?: RoutingOnce;
  } = {},
): Promise<FireableLine[]> {
  const routing = options.routing ?? routingOnce(tx, cfg, new Date());
  const now = routing.at;
  const firedAt = now.toISOString();
  const parentLines = lines.filter((line) => line.parentLineId === null);
  if (parentLines.length === 0) {
    return [];
  }
  lines = parentLines;
  const chosenRows = await tx
    .select({
      id: workingOrderLines.id,
      makeAtStationId: workingOrderLines.makeAtStationId,
      stationActive: kitchenStations.active,
      stationLocationId: kitchenStations.locationId,
    })
    .from(workingOrderLines)
    .leftJoin(kitchenStations, eq(kitchenStations.id, workingOrderLines.makeAtStationId))
    .where(
      inArray(
        workingOrderLines.id,
        lines.map((line) => line.id),
      ),
    );
  const chosenStations = new Map(
    chosenRows.flatMap((row) =>
      row.makeAtStationId !== null && row.stationActive && row.stationLocationId === cfg.locationId
        ? [[row.id, row.makeAtStationId] as const]
        : [],
    ),
  );
  const serviceContext = await VENUE_SERVICE.findOrderContext(tx, cfg, orderId);
  const productIds = [
    ...new Set(
      lines
        .filter((line) => !chosenStations.has(line.id))
        .map((line) => line.productId)
        .filter((id): id is string => id !== null),
    ),
  ];

  const makers = await (await routing()).makers(serviceContext?.zoneId ?? null, productIds);
  const keepStates = options.keepStations?.size
    ? await VENUE_SERVICE.stationStates(tx, cfg, now)
    : null;
  const stationFor = (line: FireableLine): string | null => {
    const chosen = chosenStations.get(line.id);
    if (chosen !== undefined) return chosen;
    const outcome = line.productId === null ? undefined : makers.get(line.productId);
    if (outcome?.kind === "made") return null;
    if (outcome?.kind === "no_replacement") {
      const kept = options.keepStations?.get(line.id);
      if (kept !== undefined && keepStates?.get(kept)?.active) return kept;
    }
    return null;
  };
  let fallbackStationId: string | null = null;
  if (lines.some((line) => line.productId === null && !chosenStations.has(line.id))) {
    const [fallback] = await tx
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(
        and(
          eq(kitchenStations.locationId, cfg.locationId),
          eq(kitchenStations.isDefault, true),
          eq(kitchenStations.active, true),
        ),
      );
    fallbackStationId = fallback?.id ?? null;
    if (fallbackStationId === null)
      throw new AppError("station.no_default", { locationId: cfg.locationId });
  }
  const unrouted: FireableLine[] = [];
  const noReplacement: { stationId: string; productId: string }[] = [];
  lines = lines.filter((line) => {
    const outcome = line.productId === null ? undefined : makers.get(line.productId);
    const hasMaker =
      stationFor(line) !== null ||
      (line.productId === null ? fallbackStationId !== null : outcome?.kind === "made");
    if (hasMaker) return true;
    if (outcome?.kind === "no_replacement")
      noReplacement.push({ stationId: outcome.stationId, productId: line.productId! });
    if (options.unroutable !== "skip" && outcome?.kind !== "no_replacement")
      throw new AppError("station.no_default", { locationId: cfg.locationId });
    unrouted.push(line);
    return false;
  });
  if (noReplacement.length > 0 && options.unroutable !== "skip")
    throw new AppError("station.no_replacement", {
      stationId: noReplacement[0]!.stationId,
      productIds: noReplacement.map((line) => line.productId),
    });
  if (lines.length === 0) return unrouted;

  const madeHere = await readMadeHereStations(tx, cfg.sendingDeviceId);

  const courseByLine = new Map(lines.map((line) => [line.id, line.courseId ?? null]));

  // `anyFired` lets a later round join a course already cooking; `itemCount` includes prior rounds
  // when choosing the earliest course.
  const courseRows = await tx
    .select({
      id: kitchenCourses.id,
      displayOrder: kitchenCourses.displayOrder,
      // Arrives as the number 1 or 0, never a boolean: test its truthiness, never with `===`.
      anyFired: sql<boolean>`max(${ticketItems.firedAt} is not null and not ${ticketItems.madeHere})`,
      itemCount: sql<number>`cast(count(${ticketItems.id}) as int)`,
    })
    .from(kitchenCourses)
    .leftJoin(
      ticketItems,
      and(eq(ticketItems.courseId, kitchenCourses.id), eq(ticketItems.workingOrderId, orderId)),
    )
    .where(eq(kitchenCourses.locationId, cfg.locationId))
    .groupBy(kitchenCourses.id, kitchenCourses.displayOrder);

  const firedCourseIds = new Set(courseRows.filter((row) => row.anyFired).map((row) => row.id));

  // The order's earliest course, over prior rounds and this batch. A line with no course never
  // enters the set.
  const orderCourseIds = new Set<string>([
    ...courseRows.filter((row) => row.itemCount > 0).map((row) => row.id),
    ...[...courseByLine.values()].filter((id): id is string => id !== null),
  ]);
  const displayOrderByCourse = new Map(courseRows.map((row) => [row.id, row.displayOrder]));
  const orderDisplayOrders = courseRows
    .filter((row) => orderCourseIds.has(row.id))
    .map((row) => row.displayOrder);
  const earliestDisplayOrder =
    orderDisplayOrders.length === 0 ? null : Math.min(...orderDisplayOrders);

  const sentLineIds: string[] = [];
  const dishPlaces: DishKitchenPlace[] = [];
  // A line with nowhere to go refuses the whole fire.
  const values = lines
    .map((line) => {
      const outcome = line.productId === null ? undefined : makers.get(line.productId);
      const maker = outcome?.kind === "made" ? outcome.route : null;
      const courseId = courseByLine.get(line.id) ?? null;
      const courseFired =
        line.release === true ||
        (line.hold !== true &&
          (courseId === null ||
            firedCourseIds.has(courseId) ||
            displayOrderByCourse.get(courseId) === earliestDisplayOrder));
      // A no-preparation line has no kitchen station or ticket item.
      if (maker?.kind === "no_preparation" && stationFor(line) === null) {
        if (courseFired) sentLineIds.push(line.id);
        dishPlaces.push({
          dishLineId: line.id,
          stationId: null,
          courseId,
          firedAt: courseFired ? firedAt : null,
        });
        return null;
      }
      const stationId =
        stationFor(line) ?? (maker?.kind === "station" ? maker.stationId : fallbackStationId!);
      const kept = options.keepMadeHere?.get(line.id);
      const made =
        kept === undefined
          ? madeHere.has(stationId)
          : kept.madeHere && kept.stationId === stationId;
      // A line not fired now is HELD (`fired_at` NULL) until release, unless it is made here.
      const fired = made || courseFired;
      if (fired) sentLineIds.push(line.id);
      dishPlaces.push({
        dishLineId: line.id,
        stationId,
        courseId,
        firedAt: fired ? firedAt : null,
      });
      return {
        nodeId: cfg.nodeId,
        workingOrderId: orderId,
        workingOrderLineId: line.id,
        stationId,
        courseId,
        note: line.note,
        firedAt: fired ? firedAt : null,
        madeHere: made,
        state: made ? ("ready" as const) : ("queued" as const),
        readyAt: made ? firedAt : null,
        quantity: line.quantity,
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);
  if (values.length > 0) {
    const [alreadyFired] = await tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(
        inArray(
          ticketItems.workingOrderLineId,
          values.map((value) => value.workingOrderLineId),
        ),
      )
      .limit(1);
    if (alreadyFired !== undefined) {
      throw new AppError("ticket.already_fired", { workingOrderId: orderId });
    }
  }
  await stampSent(tx, orderId, sentLineIds, firedAt);
  // Printing from `.returning()`, not a re-query: a re-query would sweep up earlier rounds'
  // already-fired items and reprint them.
  const inserted =
    values.length === 0
      ? []
      : await tx.insert(ticketItems).values(values).returning({
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
          firedAt: ticketItems.firedAt,
          madeHere: ticketItems.madeHere,
        });

  for (const row of inserted) {
    if (row.madeHere) cfg.madeHereSink?.add(row.workingOrderLineId);
  }

  const firingDishes = dishPlaces.filter((dish) => dish.firedAt !== null);
  const releasedExtras =
    firingDishes.length === 0
      ? []
      : await tx
          .update(ticketItems)
          .set({ firedAt })
          .where(
            and(
              eq(ticketItems.workingOrderId, orderId),
              isNull(ticketItems.firedAt),
              inArray(
                ticketItems.workingOrderLineId,
                tx
                  .select({ id: workingOrderLines.id })
                  .from(workingOrderLines)
                  .where(
                    inArray(
                      workingOrderLines.parentLineId,
                      firingDishes.map((dish) => dish.dishLineId),
                    ),
                  ),
              ),
            ),
          )
          .returning({
            workingOrderLineId: ticketItems.workingOrderLineId,
            stationId: ticketItems.stationId,
          });
  const extraInserted = await insertSplitExtras(
    tx,
    cfg,
    orderId,
    serviceContext?.zoneId ?? null,
    dishPlaces,
    routing,
  );

  // Only newly fired items not made here print. Outbox inserts on this transaction: no hardware I/O
  // blocks the fire.
  const firedItems = inserted
    .filter((row) => row.firedAt !== null && !row.madeHere)
    .map((row) => ({ workingOrderLineId: row.workingOrderLineId, stationId: row.stationId }))
    .concat(
      releasedExtras,
      extraInserted
        .filter((row) => row.firedAt !== null)
        .map((row) => ({ workingOrderLineId: row.workingOrderLineId, stationId: row.stationId })),
    );
  await enqueueKitchenTickets(tx, cfg, orderId, firedItems);
  return unrouted;
}

/**
 * Stamp `sent_at` on dish lines not stamped yet, and on their extras children, which follow their
 * dish. A line already stamped keeps its first stamp, so a recalled line sent again keeps it.
 *
 * An abandoned order's lines are left alone: `working_order_lines_require_open_parent_update`
 * refuses a stamp there.
 */
async function stampSent(
  tx: Transaction,
  orderId: string,
  lineIds: readonly string[],
  at: string,
): Promise<void> {
  if (lineIds.length === 0) return;
  await tx
    .update(workingOrderLines)
    .set({ sentAt: at })
    .where(
      and(
        eq(workingOrderLines.workingOrderId, orderId),
        or(
          inArray(workingOrderLines.id, [...lineIds]),
          inArray(workingOrderLines.parentLineId, [...lineIds]),
        ),
        isNull(workingOrderLines.sentAt),
        exists(
          tx
            .select({ one: sql`1` })
            .from(workingOrders)
            .where(and(eq(workingOrders.id, orderId), ne(workingOrders.status, "abandoned"))),
        ),
      ),
    );
}

/**
 * The dish lines of an order that have no ticket item and are not yet stamped sent, whose route is
 * `no_preparation`, and that sit in one of `courseIds` (`null` standing for no course) or are named
 * in `lineIds` — or every such line, with `"all"`: the no-preparation lines a send releases.
 */
async function heldNoRouteLines(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  scope: { courseIds: readonly (string | null)[]; lineIds: readonly string[] } | "all",
  routing: RoutingOnce,
): Promise<{ zoneId: string | null; lines: { id: string; courseId: string | null }[] }> {
  const empty = { zoneId: null, lines: [] };
  let inScope: SQL | undefined;
  if (scope !== "all") {
    const namedCourses = scope.courseIds.filter((id): id is string => id !== null);
    const any = [
      ...(namedCourses.length > 0 ? [inArray(workingOrderLines.courseId, namedCourses)] : []),
      ...(scope.courseIds.includes(null) ? [isNull(workingOrderLines.courseId)] : []),
      ...(scope.lineIds.length > 0 ? [inArray(workingOrderLines.id, [...scope.lineIds])] : []),
    ];
    if (any.length === 0) return empty;
    inScope = or(...any);
  }
  const serviceContext = await VENUE_SERVICE.findOrderContext(tx, cfg, orderId);
  const candidates = await tx
    .select({
      id: workingOrderLines.id,
      productId: workingOrderLines.productId,
      courseId: workingOrderLines.courseId,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        eq(workingOrderLines.workingOrderId, orderId),
        isNull(workingOrderLines.parentLineId),
        isNotNull(workingOrderLines.productId),
        isNull(workingOrderLines.sentAt),
        isNull(ticketItems.id),
        inScope,
      ),
    );
  const zoneId = serviceContext?.zoneId ?? null;
  if (candidates.length === 0) return { zoneId, lines: [] };
  const routes = await (
    await routing()
  ).makers(zoneId, [...new Set(candidates.map((line) => line.productId!))]);
  return {
    zoneId,
    lines: candidates
      .filter((line) => {
        const outcome = routes.get(line.productId!);
        return outcome?.kind === "made" && outcome.route.kind === "no_preparation";
      })
      .map((line) => ({ id: line.id, courseId: line.courseId })),
  };
}

/**
 * Refuse `product.unavailable` for the first of these dish lines, or their extras children, whose
 * product cannot be sold now. A caller passes the lines it is about to send that have no fired
 * ticket item — never fired, held, or recalled — so a sold-out dish is never sent to the kitchen
 * again, whether or not the line was stamped sent before.
 */
export async function assertSendable(tx: Transaction, lineIds: readonly string[]): Promise<void> {
  if (lineIds.length === 0) return;
  const [refused] = await tx
    .select({ productId: workingOrderLines.productId })
    .from(workingOrderLines)
    .innerJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(parentProducts, parentJoin)
    .where(
      and(
        or(
          inArray(workingOrderLines.id, [...lineIds]),
          inArray(workingOrderLines.parentLineId, [...lineIds]),
        ),
        sql`not ${productSellable}`,
      ),
    )
    .orderBy(workingOrderLines.lineNo)
    .limit(1);
  if (refused !== undefined) {
    throw new AppError("product.unavailable", { productId: refused.productId! });
  }
}

export async function isOpenOrder(tx: Transaction, orderId: string): Promise<boolean> {
  const [order] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return order?.status === "open";
}

/**
 * Release held items of a course by stamping fired_at. Require the course to exist
 * in this venue, including a deactivated course whose food still needs release.
 * Already-fired items retain their timestamps; an empty held set is a no-op.
 *
 * On a party's order, the held groups holding the course's dishes fire whole first
 * ({@link fireHeldGroupsOfCourse}); `operatorId` is who fired them. The course's lines still held
 * outside a held group, such as one recalled from a fired group, are then released.
 */
export async function fireCourse(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  courseId: string,
  operatorId: string,
): Promise<void> {
  const routing = routingOnce(tx, cfg, new Date());
  await requireCourse(tx, cfg, courseId);
  await fireHeldGroupsOfCourse(tx, cfg, orderId, courseId, operatorId, routing);
  await releaseHeld(
    tx,
    cfg,
    orderId,
    eq(ticketItems.courseId, courseId),
    {
      courseIds: [courseId],
      lineIds: [],
    },
    undefined,
    routing,
  );
}

/**
 * Release these held dish lines of one order, as {@link fireCourse} releases a course: a line
 * already fired or sent is left as it is. `mark` heads the ticket printed for them.
 */
export async function fireOrderLines(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  lineIds: readonly string[],
  mark?: "FIRE",
  routing?: RoutingOnce,
): Promise<void> {
  await releaseHeld(
    tx,
    cfg,
    orderId,
    onDishesOrTheirExtras(tx, lineIds),
    { courseIds: [], lineIds },
    mark,
    routing,
  );
}

async function releaseHeld(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  ticketScope: SQL,
  noRouteScope: { courseIds: readonly (string | null)[]; lineIds: readonly string[] },
  mark?: "FIRE",
  routing = routingOnce(tx, cfg, new Date()),
): Promise<void> {
  const firedNow = routing.at.toISOString();
  const rerouted = await rerouteHeldAtRelease(tx, cfg, orderId, ticketScope, routing);
  const firedItems = await tx
    .update(ticketItems)
    .set({ firedAt: firedNow })
    .where(and(eq(ticketItems.workingOrderId, orderId), ticketScope, isNull(ticketItems.firedAt)))
    .returning({
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      quantity: ticketItems.quantity,
    });
  const noRoute = await heldNoRouteLines(tx, cfg, orderId, noRouteScope, routing);
  // Only an open order's lines can be removed, so only there is a sold-out line refused; a placed
  // order's held work is committed.
  await finishRelease(
    tx,
    cfg,
    orderId,
    firedItems,
    noRoute,
    firedNow,
    await isOpenOrder(tx, orderId),
    mark,
    routing,
    rerouted,
  );
}

/**
 * The end of {@link fireCourse} and {@link sendLines}: refuse a sold-out line when
 * `refuseSoldOut`, stamp the released lines sent, print the items that fired now (with the old
 * station's name for a re-routed dish), and count the
 * write if anything was released. `fired` must be exactly the items this release fired (an
 * update's `RETURNING` over `fired_at IS NULL`), so a re-send prints nothing.
 */
async function finishRelease(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  fired: FiredItem[],
  noRoute: { zoneId: string | null; lines: { id: string; courseId: string | null }[] },
  at: string,
  refuseSoldOut: boolean,
  mark?: "FIRE",
  routing = routingOnce(tx, cfg, new Date(at)),
  rerouted: Rerouted = new Map(),
): Promise<void> {
  const released = [
    ...fired.map((item) => item.workingOrderLineId),
    ...noRoute.lines.map((line) => line.id),
  ];
  if (refuseSoldOut) await assertSendable(tx, released);
  await stampSent(tx, orderId, released, at);
  const extras = await insertSplitExtras(
    tx,
    cfg,
    orderId,
    noRoute.zoneId,
    noRoute.lines.map((line) => ({
      dishLineId: line.id,
      stationId: null,
      courseId: line.courseId,
      firedAt: at,
    })),
    routing,
  );
  const ordinary = [...fired, ...extras.filter((item) => item.firedAt !== null)].filter(
    (item) => !rerouted.has(item.workingOrderLineId),
  );
  await enqueueKitchenTickets(tx, cfg, orderId, ordinary, { mark, watchers: "none" });
  const byOldStation = new Map<string, { from: string; items: FiredItem[] }>();
  for (const item of fired) {
    const old = rerouted.get(item.workingOrderLineId);
    if (old === undefined) continue;
    const bucket = byOldStation.get(old.stationId) ?? { from: old.stationName, items: [] };
    bucket.items.push(item);
    byOldStation.set(old.stationId, bucket);
  }
  for (const { from, items } of byOldStation.values())
    await enqueueKitchenTickets(tx, cfg, orderId, items, { from, watchers: "none" });
  await enqueueWatcherCopies(
    tx,
    cfg,
    orderId,
    [...fired, ...extras.filter((item) => item.firedAt !== null)],
    { mark, rerouted },
  );
  if (released.length > 0) await bumpRevision(tx, [orderId]);
}

/**
 * Send selected held lines of an open tab, considering dishes at stations that are not open for
 * re-routing and refreshing queued_at when they fire.
 * The caller's transaction includes kitchen writes and their print jobs.
 */
export async function sendLines(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lineNos: number[],
): Promise<void> {
  const routing = routingOnce(tx, cfg, new Date());
  await assertPartyBillOpen(tx, cfg, tabId);
  const namedLines =
    lineNos.length === 0
      ? []
      : await tx
          .select({ id: workingOrderLines.id, parentLineId: workingOrderLines.parentLineId })
          .from(workingOrderLines)
          .where(
            and(
              eq(workingOrderLines.workingOrderId, tabId),
              inArray(workingOrderLines.lineNo, lineNos),
            ),
          );
  if (namedLines.some((line) => line.parentLineId !== null)) {
    throw new AppError("management.request_invalid", { field: "lineNo" });
  }
  const heldGroupLines = await tx
    .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
    .from(workingOrderLines)
    .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(orderGroups.state, "held")))
    .orderBy(workingOrderLines.lineNo);
  const named = new Set(lineNos);
  const namedHeld = heldGroupLines.find((line) => named.has(line.lineNo));
  if (namedHeld !== undefined) {
    throw new AppError("group.line_held", { tabId, lineNo: namedHeld.lineNo });
  }
  const heldGroupLineIds = heldGroupLines.map((line) => line.id);
  const heldGroupLineIdSet = new Set(heldGroupLineIds);
  // An empty list fires every HELD line of the tab outside a held group.
  const namedLineIds = namedLines.map((line) => line.id);
  // One clock reading for both stamps: `queued_at` is what every age on the boards is measured from.
  const firedNow = routing.at.toISOString();
  const ticketScope =
    lineNos.length === 0
      ? notInArray(ticketItems.workingOrderLineId, heldGroupLineIds)
      : onDishesOrTheirExtras(tx, namedLineIds);
  const rerouted = await rerouteHeldAtRelease(tx, cfg, tabId, ticketScope, routing);
  const firedItems = await tx
    .update(ticketItems)
    .set({ firedAt: firedNow, queuedAt: firedNow })
    .where(and(eq(ticketItems.workingOrderId, tabId), isNull(ticketItems.firedAt), ticketScope))
    .returning({
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      courseId: ticketItems.courseId,
      quantity: ticketItems.quantity,
    });
  // Sending everything held releases every held no-route line outside a held group. Sending named
  // lines releases the named ones, and a course's no-route lines once nothing routed in that course is still held.
  const noRoute = await heldNoRouteLines(
    tx,
    cfg,
    tabId,
    lineNos.length === 0
      ? "all"
      : {
          courseIds: await releasedCourses(
            tx,
            tabId,
            firedItems.map((item) => item.courseId),
          ),
          lineIds: namedLineIds,
        },
    routing,
  );
  noRoute.lines = noRoute.lines.filter((line) => !heldGroupLineIdSet.has(line.id));
  await finishRelease(
    tx,
    cfg,
    tabId,
    firedItems,
    noRoute,
    firedNow,
    true,
    undefined,
    routing,
    rerouted,
  );
}

/** Of `courseIds` (`null` standing for no course), the ones with no held item left on the order. */
async function releasedCourses(
  tx: Transaction,
  orderId: string,
  courseIds: readonly (string | null)[],
): Promise<(string | null)[]> {
  const candidates = [...new Set(courseIds)];
  if (candidates.length === 0) return [];
  const stillHeld = await tx
    .selectDistinct({ courseId: ticketItems.courseId })
    .from(ticketItems)
    .where(and(eq(ticketItems.workingOrderId, orderId), isNull(ticketItems.firedAt)));
  const held = new Set(stillHeld.map((row) => row.courseId));
  return candidates.filter((courseId) => !held.has(courseId));
}

/**
 * Recall selected lines of an open tab only while their items remain queued.
 * Refuse the whole call if a line is missing or any item has started. Previously
 * fired lines record a RECALLED kitchen notice and enqueue correction slips in the same
 * transaction; held lines do neither. Leave queued_at untouched until a later send refreshes it.
 *
 * With changes to sent items switched off (`readEditSentLines`), a line that was ever sent to a
 * station — stamped sent and holding a ticket item — is refused `ticket.already_fired`: a
 * paper-only kitchen reports nothing, so a recall slip cannot be trusted, and a void is the only
 * correction.
 */
export async function recallLines(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lineNos: number[],
): Promise<void> {
  await assertPartyBillOpen(tx, cfg, tabId);
  if (lineNos.length === 0) {
    return;
  }
  const lines = await tx
    .select({
      lineNo: workingOrderLines.lineNo,
      id: workingOrderLines.id,
      parentLineId: workingOrderLines.parentLineId,
    })
    .from(workingOrderLines)
    .where(
      and(eq(workingOrderLines.workingOrderId, tabId), inArray(workingOrderLines.lineNo, lineNos)),
    );
  const foundLineNos = new Set(lines.map((r) => r.lineNo));
  if (lines.some((line) => line.parentLineId !== null)) {
    throw new AppError("management.request_invalid", { field: "lineNo" });
  }
  for (const lineNo of lineNos) {
    if (!foundLineNos.has(lineNo)) {
      throw new AppError("tab.line_not_found", { tabId, lineNo });
    }
  }
  const lineIds = lines.map((r) => r.id);
  // Read BEFORE the un-fire, so `fired_at` still says which lines printed and need a RECALLED slip.
  const items = await tx
    .select({
      ticketItemId: ticketItems.id,
      workingOrderLineId: ticketItems.workingOrderLineId,
      state: ticketItems.state,
      firedAt: ticketItems.firedAt,
      stationId: ticketItems.stationId,
      quantity: firedQuantity,
      sentAt: workingOrderLines.sentAt,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(onDishesOrTheirExtras(tx, lineIds));
  if (items.some((r) => r.sentAt !== null) && !(await VENUE_SERVICE.readEditSentLines(tx))) {
    throw new AppError("ticket.already_fired", { workingOrderId: tabId });
  }
  const started = items.find((r) => isStarted(r.state));
  if (started !== undefined) {
    throw new AppError("ticket.already_started", { ticketItemId: started.ticketItemId });
  }
  // A held line stays held, so it gets no slip.
  const recalled = items
    .filter((r) => r.firedAt !== null && r.state === "queued")
    .map((r) => ({
      workingOrderLineId: r.workingOrderLineId,
      stationId: r.stationId!,
      quantity: r.quantity,
      wasStarted: false,
    }));
  await tx
    .update(ticketItems)
    .set({ firedAt: null })
    .where(
      and(
        eq(ticketItems.workingOrderId, tabId),
        eq(ticketItems.state, "queued"),
        onDishesOrTheirExtras(tx, lineIds),
      ),
    );
  await enqueueCorrectionSlips(tx, cfg, tabId, recalled, "RECALLED");
  await bumpRevision(tx, [tabId]);
}

/**
 * Bump every fired item of this order and course directly to ready. Held items
 * are skipped. An empty match is a no-op; this operation changes kitchen state only.
 */
export async function bumpCourseReady(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  courseId: string,
): Promise<void> {
  void cfg;
  await tx
    .update(ticketItems)
    .set(advanceSet("ready"))
    .where(
      and(
        eq(ticketItems.workingOrderId, orderId),
        eq(ticketItems.courseId, courseId),
        ne(ticketItems.state, "ready"),
        isNotNull(ticketItems.firedAt),
      ),
    );
}

/**
 * Dispatch ready items of a course by stamping away_at once. Require an existing
 * course in this venue, including deactivated courses with plated food remaining.
 * Items still cooking and items already away are unchanged.
 */
export async function markCourseAway(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  courseId: string,
): Promise<void> {
  await requireCourse(tx, cfg, courseId);
  await tx
    .update(ticketItems)
    .set({ awayAt: nowIso() })
    .where(
      and(
        eq(ticketItems.workingOrderId, orderId),
        eq(ticketItems.courseId, courseId),
        eq(ticketItems.state, "ready"),
        isNull(ticketItems.awayAt),
      ),
    );
}

/**
 * One line of a round. `hold` and `release` are {@link fireLines}' flags for the line.
 */
export type TabRoundLine = {
  menuItemId: string;
  quantity: string;
  courseId?: string | null;
  extras?: ExtraSelection[];
  options?: OptionSelection[];
  hold?: boolean;
  release?: boolean;
} & LineExtras;

/**
 * APPEND a priced round to an OPEN tab, locking each new line's gross unit price at add time, WITHOUT
 * deleting or re-pricing existing lines: a tab does not re-price.
 */
export async function addTabRound(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lines: TabRoundLine[],
  // Written on every row the round inserts, extras children included.
  stamp: { groupId?: string; creditedTo?: string } = {},
): Promise<void> {
  const round = await priceTabRound(tx, cfg, tabId, lines);
  const appendedLines = await insertTabRound(
    tx,
    cfg,
    round,
    round.rows.map((row) => ({
      ...row,
      groupId: stamp.groupId ?? null,
      creditedTo: stamp.creditedTo ?? null,
    })),
  );
  // The k-th parent row by `line_no` is input line k. Correlated on `line_no`, not on the
  // `RETURNING` array position, so the mapping does not depend on the insert's row order.
  const requestByParentId = new Map<string, TabRoundLine | undefined>();
  appendedLines
    .filter((row) => row.parentLineId === null)
    .sort((a, b) => a.lineNo - b.lineNo)
    .forEach((row, k) => requestByParentId.set(row.id, lines[k]));
  const withHold = appendedLines.map((row) => ({
    ...row,
    hold: requestByParentId.get(row.id)?.hold === true,
    release: requestByParentId.get(row.id)?.release === true,
  }));
  await fireLines(tx, cfg, tabId, withHold);
  await bumpRevision(tx, [tabId]);
}

/** A round priced for an open tab and numbered after its last line, not yet written. */
export interface PricedTabRound {
  /** The bill the round goes on. */
  tabId: string;
  /** One row per line and per extras child, in the order the lines were sent. */
  rows: WorkingOrderLineInsert[];
  lineContexts: { workingOrderLineId: string; menuItemId: string }[];
  offers: ZoneOffers;
}

/**
 * Price a round for the bill and number its rows after the bill's last line, writing no line.
 * `"checked"` skips the check that the bill is open, for a caller that read it open in this
 * transaction.
 *
 * The `max(line_no)+1` read-then-insert cannot interleave with another append, because
 * `withTransaction` IS the venue file's write lock.
 */
export async function priceTabRound(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lines: TabRoundLine[],
  bill: "check" | "checked" = "check",
): Promise<PricedTabRound> {
  if (bill === "check") await assertPartyBillOpen(tx, cfg, tabId);
  if (lines.length === 0) {
    throw new AppError("sale.empty_basket", {});
  }
  const [{ maxLineNo }] = await tx
    .select({ maxLineNo: sql<number>`cast(coalesce(max(${workingOrderLines.lineNo}), 0) as int)` })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId));
  const context = await VENUE_SERVICE.findOrderContext(tx, cfg, tabId);
  const { lineRows, lineContexts, offers } = await priceOrderLines(
    tx,
    cfg,
    tabId,
    lines,
    context?.zoneId,
  );
  return {
    tabId,
    rows: lineRows.map((row, i) => ({ ...row, lineNo: maxLineNo + i + 1 })),
    lineContexts,
    offers,
  };
}

/** Insert a priced round's rows and record their line contexts; answers what {@link fireLines} reads. */
export async function insertTabRound(
  tx: Transaction,
  cfg: TillConfig,
  round: PricedTabRound,
  rows: WorkingOrderLineInsert[],
): Promise<(FireableLine & { lineNo: number; groupId: string | null })[]> {
  const before = await totalBeforeEdit(tx, cfg, round.tabId);
  const inserted = await tx
    .insert(workingOrderLines)
    .values(rows)
    .returning({
      ...fireableLineColumns,
      lineNo: workingOrderLines.lineNo,
      groupId: workingOrderLines.groupId,
    });
  await VENUE_SERVICE.recordLineContexts(tx, cfg, round.tabId, round.lineContexts, round.offers);
  await refuseOrderOverSimplifiedLimit(tx, cfg, round.tabId, before);
  return inserted;
}

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

/**
 * A cancel's change once the caller has checked the bill and the paid lines: take `removed`
 * thousandths off the line, reducing its extras children (which follow their dish) and its ticket
 * item's fired quantity, or the whole line with its extras children when null; and move the bill's
 * and the party's revisions on. A line that had already fired records a VOID kitchen notice for what
 * was removed — marked started when the cook had started it — and gets a VOID correction slip where
 * its station has a printer. A held line of a group whose HOLD ticket was queued records a `void`
 * notice for what was removed and gets a HOLD CANCELLED slip instead. Cancelling an extra also
 * tells the kitchen about its dish ({@link tellKitchenOfCancelledExtra}).
 */
export async function removeFromLine(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  target: VoidTarget,
  removed: number | null,
  operatorId: string | undefined,
): Promise<void> {
  const wasStarted = isStarted(target.state);
  const extra = target.parentLineId === null ? null : await readCancelledExtra(tx, target.id);
  const childItems =
    target.parentLineId === null
      ? ((await dishKitchenItems(tx, [target.id])).get(target.id) ?? []).filter(
          (item) => item.extra,
        )
      : [];
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
        wasStarted: isStarted(item.state),
      })),
  );
  // Before the delete or the reduction: the notice and the slip re-read the line.
  await enqueueCorrectionSlips(tx, cfg, tabId, voided, "VOID");
  if (target.groupId !== null) {
    const group = (await printedHeldGroups(tx, [target.groupId])).get(target.groupId);
    if (group !== undefined) {
      const held = childItems
        .filter((item) => item.firedAt === null)
        .map((item) => ({
          workingOrderId: tabId,
          workingOrderLineId: item.workingOrderLineId,
          stationId: item.stationId,
          quantity: removedQuantity(item),
          group,
        }));
      if (target.ticketItemId !== null && target.firedAt === null) {
        held.unshift({
          workingOrderId: tabId,
          workingOrderLineId: target.id,
          stationId: target.stationId!,
          quantity: removed ?? target.firedQuantity,
          group,
        });
      }
      await correctHoldTickets(tx, cfg, held, { kind: "HOLD CANCELLED" });
    }
  }
  await bumpRevision(tx, [tabId]);
  if (removed === null) {
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
    await partyAfterEdit(tx, tabId, target.groupId === null ? [] : [target.groupId], operatorId);
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
  await partyAfterEdit(tx, tabId, [], operatorId);
}

/**
 * Once an extra is off its dish, tell a kitchen that has the dish which extra to take off: a fired
 * dish, or a held one whose group's HOLD ticket was queued. A dish never sent, held with no HOLD
 * ticket queued, or going to no station tells it nothing.
 */
async function tellKitchenOfCancelledExtra(
  tx: Transaction,
  cfg: TillConfig,
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
  if (extra.dishGroupId === null) return;
  const group = (await printedHeldGroups(tx, [extra.dishGroupId])).get(extra.dishGroupId);
  if (group === undefined) return;
  await enqueueExtraCancelled(tx, cfg, tabId, { ...correction, group }, extra.label);
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
): Promise<void> {
  const partyId = await partyOfOrder(tx, orderId);
  if (partyId === null) return;
  await removeEmptiedHeldGroups(tx, partyId, leftGroups, operatorId);
  await bumpPartyRevision(tx, partyId);
}

/** A dish's extras child, and how many of it go with one of the dish. */
export interface KeptExtra {
  child: { id: string; unitPriceGross: Decimal; priceQuantity?: Decimal };
  perDish: number;
}

/** The stored extras children of a dish of `dishQuantity` thousandths, as a reduction keeps them. */
export function keptExtrasOf(
  children: readonly {
    id: string;
    quantity: number;
    priceQuantity: number;
    unitPriceGross: number;
  }[],
  dishQuantity: number,
): KeptExtra[] {
  const dish = thousandthsToDecimal(dishQuantity);
  return children.map((child) => ({
    child: {
      id: child.id,
      unitPriceGross: centsToDecimal(child.unitPriceGross),
      priceQuantity: thousandthsToDecimal(child.priceQuantity),
    },
    perDish: perDishExtraPicks(
      thousandthsToDecimal(child.quantity),
      dish,
      thousandthsToDecimal(child.priceQuantity),
    ),
  }));
}

/** An extras child's quantity once its dish is `dishQuantity`. */
export function extraQuantityFor(
  perDish: number,
  dishQuantity: Decimal,
  priceQuantity: Decimal = decimal("1"),
): Decimal {
  return multiplyDecimal(multiplyDecimal(dishQuantity, decimal(String(perDish))), priceQuantity);
}

function perDishExtraPicks(
  childQuantity: string,
  dishQuantity: string,
  priceQuantity: string,
): number {
  return Number(
    divideDecimal(
      decimal(childQuantity),
      multiplyDecimal(decimal(dishQuantity), decimal(priceQuantity)),
      0,
    ),
  );
}

/** Each child's quantity and total follow its dish to `dishQuantity`, at the child's stored gross
 * price. */
async function rescaleExtras(
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
async function reduceLine(
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
  for (const { child, perDish } of children) {
    await tx
      .update(ticketItems)
      .set({
        quantity: decimalToThousandths(extraQuantityFor(perDish, remaining, child.priceQuantity)),
      })
      .where(eq(ticketItems.workingOrderLineId, child.id));
  }
  await clampServed(tx, [target.id, ...children.map(({ child }) => child.id)]);
  if (target.ticketItemId !== null) {
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

/**
 * Move ONE not-yet-fired line of an OPEN tab into another kitchen course, or clear its course to null.
 * A deactivated course is not a valid new target. A line that has already FIRED is refused
 * `ticket.already_fired`: once the kitchen has been told to cook it, it is corrected by a recall,
 * never re-coursed underneath the pass.
 */
export async function setLineCourse(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
  lineNo: number,
  courseId: string | null,
): Promise<void> {
  await assertPartyBillOpen(tx, cfg, tabId);
  if (courseId !== null) {
    await requireLiveCourse(tx, cfg, courseId);
  }
  const [line] = await tx
    .select({ id: workingOrderLines.id, parentLineId: workingOrderLines.parentLineId })
    .from(workingOrderLines)
    .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, lineNo)));
  if (line === undefined) {
    throw new AppError("tab.line_not_found", { tabId, lineNo });
  }
  if (line.parentLineId !== null) {
    throw new AppError("management.request_invalid", { field: "lineNo" });
  }
  const [item] = await tx
    .select({ firedAt: ticketItems.firedAt })
    .from(ticketItems)
    .where(and(onDishesOrTheirExtras(tx, [line.id]), isNotNull(ticketItems.firedAt)));
  if (item !== undefined && item.firedAt != null) {
    throw new AppError("ticket.already_fired", { workingOrderId: tabId });
  }
  await tx.update(workingOrderLines).set({ courseId }).where(eq(workingOrderLines.id, line.id));
  // The held ticket item's course snapshot too; no row when the line has no item yet.
  await tx
    .update(ticketItems)
    .set({ courseId })
    .where(onDishesOrTheirExtras(tx, [line.id]));
  await bumpRevision(tx, [tabId]);
}

/** A dish line on a bill of a party, as a served command reads it. */
interface ServableLine {
  id: string;
  workingOrderId: string;
  lineNo: number;
  quantity: number;
  servedQuantity: number;
  unitPrecision: number | null;
  sentAt: string | null;
  groupState: "held" | "fired" | "removed" | null;
  ticketItemId: string | null;
  ticketFiredAt: string | null;
  ticketMadeHere: boolean | null;
  extraHeld: boolean;
}

/**
 * The dish lines `where` selects on the bills of the party and of every party merged into it that
 * Current orders shows ({@link onShownBill}), bill by bill in the order the bills were opened.
 */
async function servableLines(
  tx: Transaction,
  partyId: string,
  where: SQL,
): Promise<ServableLine[]> {
  const family = await partyFamily(tx, partyId);
  const extra = alias(workingOrderLines, "servable_extra");
  const extraItem = alias(ticketItems, "servable_extra_item");
  return tx
    .select({
      id: workingOrderLines.id,
      workingOrderId: workingOrderLines.workingOrderId,
      lineNo: workingOrderLines.lineNo,
      quantity: workingOrderLines.quantity,
      servedQuantity: workingOrderLines.servedQuantity,
      unitPrecision: workingOrderLines.unitPrecision,
      sentAt: workingOrderLines.sentAt,
      groupState: orderGroups.state,
      ticketItemId: ticketItems.id,
      ticketFiredAt: ticketItems.firedAt,
      ticketMadeHere: ticketItems.madeHere,
      extraHeld: exists(
        tx
          .select({ one: sql`1` })
          .from(extra)
          .innerJoin(extraItem, eq(extraItem.workingOrderLineId, extra.id))
          .where(and(eq(extra.parentLineId, workingOrderLines.id), isNull(extraItem.firedAt))),
      ).mapWith(Boolean),
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        where,
        isNull(workingOrderLines.parentLineId),
        inArray(workingOrders.partyId, family),
        onShownBill(),
      ),
    )
    .orderBy(
      workingOrders.openedAt,
      workingOrders.orderNumber,
      workingOrders.id,
      workingOrderLines.lineNo,
    );
}

/**
 * Whether a dish line is released work, which is what serving needs. A made-here line is released
 * at its send, even in a held group. Other held-group and unfired lines wait; an ungrouped line
 * with no kitchen item needs a sent time.
 */
export function isReleased(
  line: Pick<
    ServableLine,
    "groupState" | "ticketItemId" | "ticketFiredAt" | "ticketMadeHere" | "sentAt"
  >,
): boolean {
  if (line.ticketMadeHere === true) return true;
  return line.groupState === "held"
    ? false
    : line.ticketItemId !== null
      ? line.ticketFiredAt !== null
      : line.groupState !== null || line.sentAt !== null;
}

/**
 * The named orders holding a dish the kitchen is not making: one never sent and holding no kitchen
 * item ({@link unsentDishLines}), or one that is not released work ({@link isReleased}) — held in
 * a group, or held or recalled by its kitchen item.
 */
export async function ordersWithUnfiredDish(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const lines = await tx
    .select({
      workingOrderId: workingOrderLines.workingOrderId,
      sentAt: workingOrderLines.sentAt,
      groupState: orderGroups.state,
      ticketItemId: ticketItems.id,
      ticketFiredAt: ticketItems.firedAt,
      ticketMadeHere: ticketItems.madeHere,
    })
    .from(workingOrderLines)
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        inArray(workingOrderLines.workingOrderId, [...orderIds]),
        isNull(workingOrderLines.parentLineId),
      ),
    );
  return new Set(
    lines
      .filter((line) => (line.sentAt === null && line.ticketItemId === null) || !isReleased(line))
      .map((line) => line.workingOrderId),
  );
}

/** Serving needs released work ({@link isReleased}), else `group.line_held`. */
function refuseUnreleased(line: ServableLine): void {
  if (!isReleased(line) || line.extraHeld) {
    throw new AppError("group.line_held", { tabId: line.workingOrderId, lineNo: line.lineNo });
  }
}

/**
 * `quantity` as thousandths, refused `tab.serve_quantity_invalid` unless it is a positive decimal in
 * the line's unit's decimal places and no more than `limit`.
 */
function servedAmount(line: ServableLine, quantity: string, limit: number): number {
  const invalid = () =>
    new AppError("tab.serve_quantity_invalid", {
      tabId: line.workingOrderId,
      lineNo: line.lineNo,
      quantity,
    });
  let asked: number;
  try {
    assertQuantityPrecision(quantity, line.unitPrecision ?? MAX_UNIT_PRECISION, { positive: true });
    asked = stringToThousandths(quantity);
  } catch {
    throw invalid();
  }
  if (asked > limit) throw invalid();
  return asked;
}

/**
 * Give each line its new served count, and its extras children theirs in step; `served_at` is set
 * when a row is fully served and cleared when it is not. Serving is an operational fact, never
 * billing, and the filed sale does not read it, so no bill's revision moves and neither a card
 * payment nor a card refund running on the bill holds it up; the party's revision counts it.
 */
async function writeServed(
  tx: Transaction,
  changes: readonly { line: ServableLine; served: number }[],
): Promise<void> {
  if (changes.length === 0) return;
  const at = nowIso();
  const children = await tx
    .select({
      id: workingOrderLines.id,
      parentLineId: workingOrderLines.parentLineId,
      quantity: workingOrderLines.quantity,
      servedQuantity: workingOrderLines.servedQuantity,
    })
    .from(workingOrderLines)
    .where(
      inArray(
        workingOrderLines.parentLineId,
        changes.map(({ line }) => line.id),
      ),
    );
  for (const { line, served } of changes) {
    const servedAt = served === line.quantity ? at : null;
    await tx
      .update(workingOrderLines)
      .set({ servedQuantity: served, servedAt })
      .where(eq(workingOrderLines.id, line.id));
    for (const child of children.filter((row) => row.parentLineId === line.id)) {
      // A child's quantity is its dish's times the picks per dish, so this divides exactly.
      const childServed = Math.round((child.quantity * served) / line.quantity);
      await tx
        .update(workingOrderLines)
        .set({ servedQuantity: childServed, servedAt })
        .where(eq(workingOrderLines.id, child.id));
    }
  }
}

/**
 * Mark part or all of each named dish line of the party served. `quantity` is how much THIS command
 * serves, never more than is left to serve. Replayed by submission id before the party's revision is
 * compared (D8, D19).
 */
export async function markServed(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  items: { lineId: string; quantity: string }[],
  args: PartyCommandArgs,
): Promise<{ revision: number }> {
  return changeServed(tx, cfg, partyId, items, args, "line.served");
}

/** Take back part or all of what was marked served on each named dish line, for a mis-tap. */
export async function unmarkServed(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  items: { lineId: string; quantity: string }[],
  args: PartyCommandArgs,
): Promise<{ revision: number }> {
  return changeServed(tx, cfg, partyId, items, args, "line.unserved");
}

async function changeServed(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  items: { lineId: string; quantity: string }[],
  args: PartyCommandArgs,
  kind: "line.served" | "line.unserved",
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    kind,
    { partyId, items, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      if (items.length === 0 || new Set(items.map((item) => item.lineId)).size !== items.length) {
        throw new AppError("management.request_invalid", { field: "items" });
      }
      const lines = new Map(
        (
          await servableLines(
            tx,
            partyId,
            inArray(
              workingOrderLines.id,
              items.map((item) => item.lineId),
            ),
          )
        ).map((line) => [line.id, line]),
      );
      const changes = items.map(({ lineId, quantity }) => {
        const line = lines.get(lineId);
        if (line === undefined) throw new AppError("group.not_found", { lineId });
        const serving = kind === "line.served";
        // An undo stays open on a recalled dish: staff correct what was recorded.
        if (serving) refuseUnreleased(line);
        const amount = servedAmount(
          line,
          quantity,
          serving ? line.quantity - line.servedQuantity : line.servedQuantity,
        );
        return { line, served: line.servedQuantity + (serving ? amount : -amount) };
      });
      await writeServed(tx, changes);
      return { revision };
    },
    cfg.madeHereSink,
  );
}

/**
 * Mark every dish line of a fired group fully served, on every bill of the party it sits on that
 * Current orders shows, a paid one included. A held group is refused `group.line_held`, naming its
 * first line.
 */
export async function markGroupServed(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  groupId: string,
  args: PartyCommandArgs,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "group.served",
    { partyId, groupId, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      const state = await requireGroup(tx, partyId, groupId);
      const lines = await servableLines(tx, partyId, eq(workingOrderLines.groupId, groupId));
      // A held group left with no line is on its way to `removed`.
      if (state === "held" && lines.length === 0) {
        throw new AppError("group.not_found", { groupId });
      }
      lines.forEach(refuseUnreleased);
      await writeServed(
        tx,
        lines
          .filter((line) => line.servedQuantity < line.quantity)
          .map((line) => ({ line, served: line.quantity })),
      );
      return { revision };
    },
    cfg.madeHereSink,
  );
}

/**
 * After a line's quantity changed: what was served is cut to what it now holds, and `served_at`
 * says whether that is all of it, keeping the time it was first fully served.
 */
async function clampServed(tx: Transaction, lineIds: readonly string[]): Promise<void> {
  if (lineIds.length === 0) return;
  const { servedQuantity, quantity, servedAt } = workingOrderLines;
  await tx
    .update(workingOrderLines)
    .set({
      servedQuantity: sql`min(${servedQuantity}, ${quantity})`,
      servedAt: sql`case when ${servedQuantity} >= ${quantity} then coalesce(${servedAt}, ${nowIso()}) end`,
    })
    .where(
      and(
        inArray(workingOrderLines.id, [...lineIds]),
        sql`(${servedQuantity} > ${quantity} or (${servedAt} is not null) <> (${servedQuantity} >= ${quantity}))`,
      ),
    );
}

/**
 * Lines pass between two orders only when both have the same service mode, or neither has a service
 * context. A table bill sends nothing when it is paid, so a pay-first or invoice-first bill's unsent
 * dishes moved into it would never reach the kitchen.
 */
export async function assertServiceModesMatch(
  tx: Transaction,
  cfg: TillConfig,
  fromOrderId: string,
  toOrderId: string,
): Promise<void> {
  const fromContext = await VENUE_SERVICE.findOrderContext(tx, cfg, fromOrderId);
  const toContext = await VENUE_SERVICE.findOrderContext(tx, cfg, toOrderId);
  if (!modesMatch(fromContext, toContext)) {
    throw new AppError("service_zone.mode_incompatible", {
      zoneId: toContext?.zoneId ?? "unscoped",
      expected: fromContext?.serviceMode ?? "unscoped",
      actual: toContext?.serviceMode ?? "unscoped",
    });
  }
}

/** {@link assertServiceModesMatch} as an answer rather than a refusal. */
export async function serviceModesMatch(
  tx: Transaction,
  cfg: TillConfig,
  fromOrderId: string,
  toOrderId: string,
): Promise<boolean> {
  return modesMatch(
    await VENUE_SERVICE.findOrderContext(tx, cfg, fromOrderId),
    await VENUE_SERVICE.findOrderContext(tx, cfg, toOrderId),
  );
}

function modesMatch(
  from: { serviceMode: string } | null,
  to: { serviceMode: string } | null,
): boolean {
  if (from === null || to === null) return from === to;
  return from.serviceMode === to.serviceMode;
}

/**
 * Move lines (default all) from one OPEN order to another at the destination's next `line_no`s,
 * keeping each line's id, modifier links and any fired ticket; returns the ids of the lines it
 * moved. It makes no service-mode check: the caller has made {@link assertServiceModesMatch}'s, or
 * copied the source's context onto the destination.
 */
export async function moveOrderLines(
  tx: Transaction,
  cfg: TillConfig,
  fromTabId: string,
  toTabId: string,
  lineNos: number[] | undefined,
): Promise<string[]> {
  // A self-transfer would allocate line numbers that collide with the rows being moved.
  if (fromTabId === toTabId) {
    throw new AppError("tab.merge_self", { tabId: fromTabId });
  }
  const both = await tx
    .select({ id: workingOrders.id, status: workingOrders.status })
    .from(workingOrders)
    .where(or(eq(workingOrders.id, fromTabId), eq(workingOrders.id, toTabId)));
  const from = both.find((r) => r.id === fromTabId);
  const to = both.find((r) => r.id === toTabId);
  if (from === undefined || from.status !== "open") {
    throw new AppError("tab.not_open", { tabId: fromTabId });
  }
  if (to === undefined || to.status !== "open") {
    throw new AppError("tab.not_open", { tabId: toTabId });
  }
  const sourceWhere =
    lineNos === undefined
      ? eq(workingOrderLines.workingOrderId, fromTabId)
      : and(
          eq(workingOrderLines.workingOrderId, fromTabId),
          inArray(workingOrderLines.lineNo, lineNos),
        );

  const source = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
    })
    .from(workingOrderLines)
    .where(sourceWhere)
    .orderBy(workingOrderLines.lineNo);
  // A moved row takes its id with it, and a paid quantity stays on the bill it was paid on.
  await refusePaidLines(
    tx,
    fromTabId,
    source.map((line) => ({ id: line.id, lineNo: line.lineNo, keeps: 0 })),
  );

  const [agg] = await tx
    .select({ next: sql<number>`cast(coalesce(max(${workingOrderLines.lineNo}), 0) as int)` })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, toTabId));
  const base = agg!.next;
  const before = source.length > 0 ? await totalBeforeEdit(tx, cfg, toTabId) : null;

  // Moved in place so every row keyed on the line id survives. Destination numbers start beyond its
  // current maximum, so no update collides on `(working_order_id, line_no)`.
  for (let index = 0; index < source.length; index++) {
    const line = source[index]!;
    await tx
      .update(workingOrderLines)
      .set({ workingOrderId: toTabId, lineNo: base + index + 1 })
      .where(
        and(eq(workingOrderLines.workingOrderId, fromTabId), eq(workingOrderLines.id, line.id)),
      );
  }
  if (source.length > 0) {
    await tx
      .update(ticketItems)
      .set({ workingOrderId: toTabId })
      .where(
        inArray(
          ticketItems.workingOrderLineId,
          source.map((line) => line.id),
        ),
      );
    await refuseOrderOverSimplifiedLimit(tx, cfg, toTabId, before);
  }
  return source.map((line) => line.id);
}

/** Assert a working order is OPEN, else `tab.not_open`; its revision. */
export async function assertTabOpen(tx: Transaction, tabId: string): Promise<number> {
  const [tab] = await tx
    .select({ status: workingOrders.status, revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, tabId));
  if (tab === undefined || tab.status !== "open") {
    throw new AppError("tab.not_open", { tabId });
  }
  return tab.revision;
}

/** One line of an OPEN tab. `unitPriceGross` is the gross unit price LOCKED at add time, NOT a
 *  re-price. */
export interface TabLine {
  /** The row's id, which a group move names. A dish in an order group is listed by it in the group's
   *  `lineIds`; a child extras row never is (`readGroups`, `apps/server/src/order-groups.ts`). */
  id: string;
  /** The STAFF name (the variant's on a variant line): a waiter reads this list, not a diner. */
  name: string;
  /** The dish's frozen options answers; empty on a line that answered none and on every child. */
  optionSnapshots?: OptionSnapshot[];
  lineNo: number;
  // Nullable because the column is; a CHILD row carries the picked extra product.
  productId: string | null;
  /** The PARENT dish's `lineNo` on a CHILD extras line, else null: the one field on this wire that
   * tells the two apart. */
  parentLineNo: number | null;
  quantity: string;
  /** Decimal places the line's unit takes, frozen at add time (0 = sold by the unit). */
  unitPrecision: number | null;
  unitPriceGross: string;
  /** The unit price the line had before a comp or a discount changed it; absent on a line no
   * adjustment has touched. */
  listUnitPriceGross?: string;
  servedAt: string | null;
  courseId: string | null;
  /** When the line was first released: fired, or for a no-preparation line, when it would have
   * fired. A recall clears `firedAt` and keeps this. */
  sentAt: string | null;
  /** Null when the line is HELD or has no ticket item at all. A following extra has none; a split-off
   * extra has its own. A parent can lack one too: `openTab` inserts its initial lines without firing. */
  firedAt: string | null;
  /** Null when the line has no ticket item. A following extra has none; a split-off extra has its own. */
  state: TicketState | null;
  stationId: string | null;
  movable: boolean;
  /** The order group the line is released with; null when it is in none, as on a bill with no party
   * or for a line moved here from another party's bill. */
  groupId: string | null;
  note: string | null;
  /** The extras list a CHILD row was picked from; null on a dish. */
  listId: string | null;
  /** The offer the line was sold under (a child row's is its dish's); null on a line with no
   * recorded service context. */
  menuItemId: string | null;
  /** On a dish sold as a variant, `productId` names the variant and this its parent product;
   * otherwise null. */
  parentProductId: string | null;
}

/** Read an open tab's lines in line-number order, at their stored prices: no re-price. */
export async function readTabLines(
  tx: Transaction,
  cfg: TillConfig,
  tabId: string,
): Promise<TabLine[]> {
  await assertTabOpen(tx, tabId);
  // `ticket_items` is unique per line, so the join never multiplies rows.
  const rows = await tx
    .select({
      lineNo: workingOrderLines.lineNo,
      name: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
      optionSnapshots: workingOrderLines.optionSnapshots,
      productId: workingOrderLines.productId,
      id: workingOrderLines.id,
      parentLineId: workingOrderLines.parentLineId,
      quantity: workingOrderLines.quantity,
      unitPrecision: workingOrderLines.unitPrecision,
      unitPriceGross: workingOrderLines.unitPriceGross,
      listUnitPriceGross: workingOrderLines.listUnitPriceGross,
      servedAt: workingOrderLines.servedAt,
      servedQuantity: workingOrderLines.servedQuantity,
      courseId: workingOrderLines.courseId,
      sentAt: workingOrderLines.sentAt,
      firedAt: ticketItems.firedAt,
      state: ticketItems.state,
      stationId: ticketItems.stationId,
      awayAt: ticketItems.awayAt,
      madeHere: ticketItems.madeHere,
      groupId: workingOrderLines.groupId,
      note: workingOrderLines.note,
      listId: workingOrderLines.extraListId,
      productParentId: products.parentId,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);
  const menuItemByLine = new Map(
    (await VENUE_SERVICE.listLineContexts(tx, cfg, tabId)).map((context) => [
      context.workingOrderLineId,
      context.menuItemId,
    ]),
  );
  // The stored `line_no` is what this read returns, so, unlike `readLockedLines`, no renumbering.
  const lineNoById = new Map(rows.map((row) => [row.id, row.lineNo]));
  return rows.map((row) => {
    const sold = soldProduct(row);
    return {
      id: row.id,
      lineNo: row.lineNo,
      name: staffPresentationName({ name: row.name, variantName: row.variantName }),
      optionSnapshots: row.optionSnapshots,
      productId: row.productId,
      parentLineNo: row.parentLineId === null ? null : (lineNoById.get(row.parentLineId) ?? null),
      quantity: thousandthsToDecimal(row.quantity),
      unitPrecision: row.unitPrecision,
      unitPriceGross: centsToDecimal(row.unitPriceGross),
      ...(row.listUnitPriceGross === null
        ? {}
        : { listUnitPriceGross: centsToDecimal(row.listUnitPriceGross) }),
      servedAt: row.servedAt,
      courseId: row.courseId,
      sentAt: row.sentAt,
      firedAt: row.firedAt,
      state: row.state,
      stationId: row.stationId,
      movable:
        row.state !== null &&
        stillMovable({ state: row.state, awayAt: row.awayAt, madeHere: row.madeHere! }, row),
      groupId: row.groupId,
      note: row.note,
      listId: row.listId,
      menuItemId: menuItemByLine.get(row.id) ?? null,
      parentProductId: sold.variantId === null ? null : sold.productId,
    };
  });
}

/**
 * A dish sold as a variant stores the variant as its product; the dish the till rebuilds is the
 * variant's parent, with the variant chosen on it. A child row's product is the pick itself and is
 * kept as it is, a variant or not.
 */
function soldProduct(line: {
  parentLineId: string | null;
  productId: string | null;
  productParentId: string | null;
}): { productId: string | null; variantId: string | null } {
  const variantId =
    line.parentLineId === null && line.productParentId !== null ? line.productId : null;
  return { productId: variantId === null ? line.productId : line.productParentId, variantId };
}

/** An order's revision: what a copy of it read now carries back to an edit. */
export async function readOrderRevision(tx: Transaction, orderId: string): Promise<number> {
  const [order] = await tx
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return order!.revision;
}

/**
 * The same composition `grossRows` uses for a line's gross total, so a split line's `line_total` is
 * identical to an add-time line's.
 */
function grossLineTotal(grossUnit: string, quantity: string, priceQuantity: string = "1"): Decimal {
  return divideDecimal(
    multiplyDecimal(decimal(grossUnit), decimal(quantity)),
    decimal(priceQuantity),
    MONEY_SCALE,
  );
}

/**
 * Refuse a batch naming the same source `line_no` twice: each entry is validated against the line's
 * pre-batch quantity and the split sets the source to `original − q`, so two partial "1"s off a line
 * of 3 would add 2 to the destination while the source dropped by 1.
 */
export function assertDistinctTransferLines(tabId: string, transfers: { lineNo: number }[]): void {
  const seenLineNos = new Set<number>();
  for (const { lineNo } of transfers) {
    if (seenLineNos.has(lineNo)) {
      throw new AppError("tab.transfer_duplicate_line", { tabId, lineNo });
    }
    seenLineNos.add(lineNo);
  }
}

/**
 * Carry whole lines and partial splits between two orders, keeping each unit's LOCKED prices and
 * CONSERVING quantity. It makes no open-order check and no service-mode check of its own: the
 * CALLER makes the first, and ensures the second by {@link assertServiceModesMatch} or by copying the
 * source's context onto a new order. Every transfer is validated before anything moves. A partial
 * split of a dish with extras is refused `tab.transfer_modifier_line` unless `splitExtras` is set:
 * then each extra is split with it, the part going with the split dish being its count a dish times
 * the part split, and refused the same when an extra is not a whole count a dish. With
 * `refuseHeld`, a line whose own or split-off extra's ticket item is unfired is refused
 * `tab.split_held_line` unless its group is held: firing a group fires its lines on whichever bills
 * they are on. Returns each
 * ticket item a split made, mapped to the one it was copied from, and each row a split made, keyed
 * by the row it came from, a dish before its extras.
 */
export async function carveOffLines(
  tx: Transaction,
  cfg: TillConfig,
  fromTabId: string,
  toTabId: string,
  transfers: { lineNo: number; quantity?: string }[],
  opts: { refuseHeld: boolean; splitExtras?: boolean },
): Promise<{ splitFrom: Map<string, string>; splitLines: Map<string, SplitRow> }> {
  // Every line, not only the named ones: which dishes carry modifiers needs the whole tab.
  const sourceRows = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      productId: workingOrderLines.productId,
      name: workingOrderLines.name,
      descriptions: workingOrderLines.descriptions,
      optionSnapshots: workingOrderLines.optionSnapshots,
      quantity: workingOrderLines.quantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
      priceQuantity: workingOrderLines.priceQuantity,
      vatClass: workingOrderLines.vatClass,
      category: workingOrderLines.category,
      unitName: workingOrderLines.unitName,
      unitPrecision: workingOrderLines.unitPrecision,
      variantName: workingOrderLines.variantName,
      variantDescriptions: workingOrderLines.variantDescriptions,
      variantKitchenName: workingOrderLines.variantKitchenName,
      kitchenName: workingOrderLines.kitchenName,
      classification: workingOrderLines.classification,
      sentAt: workingOrderLines.sentAt,
      servedAt: workingOrderLines.servedAt,
      servedQuantity: workingOrderLines.servedQuantity,
      courseId: workingOrderLines.courseId,
      makeAtStationId: workingOrderLines.makeAtStationId,
      note: workingOrderLines.note,
      extraListId: workingOrderLines.extraListId,
      groupId: workingOrderLines.groupId,
      creditedTo: workingOrderLines.creditedTo,
      listUnitPriceGross: workingOrderLines.listUnitPriceGross,
      ticketItemId: ticketItems.id,
      ticketFiredAt: ticketItems.firedAt,
      groupState: orderGroups.state,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(eq(workingOrderLines.workingOrderId, fromTabId))
    .orderBy(workingOrderLines.lineNo);
  const sourceLines = sourceRows.map((l) => ({
    ...l,
    quantity: thousandthsToDecimal(l.quantity),
    unitPriceGross: centsToDecimal(l.unitPriceGross),
    priceQuantity: thousandthsToDecimal(l.priceQuantity),
  }));
  const byLineNo = new Map(sourceLines.map((l) => [l.lineNo, l]));
  const lineNoById = new Map(sourceLines.map((l) => [l.id, l.lineNo]));
  const childLineNosByParent = new Map<number, number[]>();
  for (const l of sourceLines) {
    if (l.parentLineId == null) {
      continue;
    }
    const parentLineNo = lineNoById.get(l.parentLineId);
    if (parentLineNo === undefined) {
      continue;
    }
    const siblings = childLineNosByParent.get(parentLineNo) ?? [];
    siblings.push(l.lineNo);
    childLineNosByParent.set(parentLineNo, siblings);
  }

  // A quantity equal to the line's own is a whole-line move: a split would leave a zero-quantity
  // source, which `working_order_lines_quantity_ck` refuses.
  const wholeLineNos: number[] = [];
  type SourceLine = (typeof sourceLines)[number];
  /** An extra split with its dish: what stays on its row and what goes to the new one. */
  type ExtraPart = { row: SourceLine; remaining: Decimal; moved: Decimal };
  const partials: { line: SourceLine; quantity: string; children: ExtraPart[] }[] = [];
  for (const t of transfers) {
    const line = byLineNo.get(t.lineNo);
    if (line === undefined) {
      throw new AppError("tab.line_not_found", { tabId: fromTabId, lineNo: t.lineNo });
    }
    // A modifier CHILD transfers only WITH its dish.
    if (line.parentLineId != null) {
      throw new AppError("tab.transfer_modifier_line", { tabId: fromTabId, lineNo: t.lineNo });
    }
    const childLineNos = childLineNosByParent.get(t.lineNo) ?? [];
    if (
      opts.refuseHeld &&
      line.groupState !== "held" &&
      [line, ...childLineNos.map((lineNo) => byLineNo.get(lineNo)!)].some(
        (row) => row.ticketItemId !== null && row.ticketFiredAt === null,
      )
    ) {
      throw new AppError("tab.split_held_line", { tabId: fromTabId, lineNo: t.lineNo });
    }
    if (t.quantity === undefined) {
      wholeLineNos.push(t.lineNo, ...childLineNos);
      continue;
    }
    // A malformed literal is reported as the same domain code as an out-of-range one.
    let inRange: boolean;
    try {
      assertQuantityPrecision(t.quantity, line.unitPrecision ?? MAX_UNIT_PRECISION, {
        positive: true,
      });
      inRange = compareDecimal(decimal(t.quantity), decimal(line.quantity)) <= 0;
    } catch {
      inRange = false;
    }
    if (!inRange) {
      throw new AppError("tab.transfer_quantity_invalid", {
        tabId: fromTabId,
        lineNo: t.lineNo,
        quantity: t.quantity,
      });
    }
    if (compareDecimal(decimal(t.quantity), decimal(line.quantity)) === 0) {
      wholeLineNos.push(t.lineNo, ...childLineNos);
    } else {
      if (childLineNos.length > 0 && opts.splitExtras !== true) {
        throw new AppError("tab.transfer_modifier_line", { tabId: fromTabId, lineNo: t.lineNo });
      }
      const moved = decimal(t.quantity);
      const remaining = subtractDecimal(decimal(line.quantity), moved);
      const children = childLineNos.map((childLineNo) => {
        const row = byLineNo.get(childLineNo)!;
        const perDish = perDishExtraPicks(row.quantity, line.quantity, row.priceQuantity);
        return {
          row,
          remaining: extraQuantityFor(perDish, remaining, row.priceQuantity),
          moved: extraQuantityFor(perDish, moved, row.priceQuantity),
        };
      });
      // An extra that is not a whole count a dish would split into parts that do not add up to it,
      // and the bill would drift.
      if (
        children.some(
          (child) =>
            compareDecimal(sumDecimals([child.remaining, child.moved]), child.row.quantity) !== 0,
        )
      ) {
        throw new AppError("tab.transfer_modifier_line", { tabId: fromTabId, lineNo: t.lineNo });
      }
      partials.push({ line, quantity: t.quantity, children });
    }
  }
  // A split keeps the source row, so its paid quantity may stay there while unpaid units move.
  await refusePaidLines(
    tx,
    fromTabId,
    partials.map(({ line, quantity }) => ({
      id: line.id,
      lineNo: line.lineNo,
      keeps: decimalToThousandths(line.quantity) - stringToThousandths(quantity),
    })),
  );

  const before =
    partials.length > 0 && fromTabId !== toTabId ? await totalBeforeEdit(tx, cfg, toTabId) : null;
  const movedLineIds =
    wholeLineNos.length > 0 ? await moveOrderLines(tx, cfg, fromTabId, toTabId, wholeLineNos) : [];

  const splitFrom = new Map<string, string>();
  const splitLines = new Map<string, SplitRow>();
  // Split line numbers are allocated after the moves, so they do not collide with moved rows.
  if (partials.length > 0) {
    const [{ maxLineNo }] = await tx
      .select({
        maxLineNo: sql<number>`cast(coalesce(max(${workingOrderLines.lineNo}), 0) as int)`,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, toTabId));
    let nextLineNo = maxLineNo!;
    /** Leave `row` holding `remaining`, and add a row of `moved` of it under the next line number;
     * answers the new row's id. */
    const splitRow = async (
      row: SourceLine,
      remaining: Decimal,
      moved: Decimal,
      parentLineId: string | null,
    ): Promise<string> => {
      await tx
        .update(workingOrderLines)
        .set({
          quantity: decimalToThousandths(remaining),
          lineTotal: decimalToCents(
            grossLineTotal(row.unitPriceGross, remaining, row.priceQuantity),
          ),
        })
        .where(eq(workingOrderLines.id, row.id));
      await clampServed(tx, [row.id]);
      // What was served stays on the source as far as it still holds; the rest goes with the split.
      const movedThousandths = decimalToThousandths(moved);
      const splitServed =
        row.servedQuantity - Math.min(row.servedQuantity, decimalToThousandths(remaining));
      const splitRowId = randomUUID();
      const lineNo = ++nextLineNo;
      await tx.insert(workingOrderLines).values({
        id: splitRowId,
        workingOrderId: toTabId,
        lineNo,
        productId: row.productId,
        parentLineId,
        name: row.name,
        descriptions: row.descriptions,
        optionSnapshots: row.optionSnapshots ?? [],
        quantity: movedThousandths,
        unitPriceGross: decimalToCents(row.unitPriceGross),
        priceQuantity: decimalToThousandths(row.priceQuantity),
        vatClass: row.vatClass,
        lineTotal: decimalToCents(grossLineTotal(row.unitPriceGross, moved, row.priceQuantity)),
        category: row.category,
        unitName: row.unitName,
        unitPrecision: row.unitPrecision,
        variantName: row.variantName,
        variantDescriptions: row.variantDescriptions,
        variantKitchenName: row.variantKitchenName,
        kitchenName: row.kitchenName,
        classification: row.classification,
        sentAt: row.sentAt,
        servedQuantity: splitServed,
        servedAt: splitServed === movedThousandths ? (row.servedAt ?? nowIso()) : null,
        courseId: row.courseId,
        makeAtStationId: row.makeAtStationId,
        note: row.note,
        extraListId: row.extraListId,
        groupId: row.groupId,
        creditedTo: row.creditedTo,
        listUnitPriceGross: row.listUnitPriceGross,
      });
      splitLines.set(row.id, { id: splitRowId, lineNo });
      await VENUE_SERVICE.copyLineContext(tx, cfg, row.id, splitRowId);
      return splitRowId;
    };
    for (const { line, quantity, children } of partials) {
      const remaining = subtractDecimal(decimal(line.quantity), decimal(quantity));
      const splitLineId = await splitRow(line, remaining, decimal(quantity), null);
      // Numbered straight after their dish: a receipt reads a dish's extras from the rows after it.
      for (const child of children) {
        const splitChildId = await splitRow(child.row, child.remaining, child.moved, splitLineId);
        if (child.row.ticketItemId !== null) {
          const splitTicketId = await splitTicketItem(
            tx,
            child.row.ticketItemId,
            child.row.quantity,
            toTabId,
            splitChildId,
            child.moved,
          );
          splitFrom.set(splitTicketId, child.row.ticketItemId);
          await copyKitchenJobLines(tx, child.row.id, splitChildId);
          movedLineIds.push(child.row.id);
        }
      }
      if (line.ticketItemId !== null) {
        const splitTicketId = await splitTicketItem(
          tx,
          line.ticketItemId,
          line.quantity,
          toTabId,
          splitLineId,
          quantity,
        );
        splitFrom.set(splitTicketId, line.ticketItemId);
        await copyKitchenJobLines(tx, line.id, splitLineId);
        movedLineIds.push(line.id);
      }
    }
  }
  if (fromTabId !== toTabId) {
    await copyKitchenPrintLinks(tx, fromTabId, toTabId, movedLineIds);
    // Whole lines were checked as they moved (`moveOrderLines`); the parts split off were not.
    if (partials.length > 0) await refuseOrderOverSimplifiedLimit(tx, cfg, toTabId, before);
  }
  return { splitFrom, splitLines };
}

/**
 * Refuse `group.held_leaves_party` for the lowest-numbered of these lines whose group is held: a
 * group belongs to its party (D1).
 */
export async function refuseHeldLeavingParty(
  tx: Transaction,
  tabId: string,
  lineIds: readonly string[],
): Promise<void> {
  if (lineIds.length === 0) return;
  const [held] = await tx
    .select({ lineNo: workingOrderLines.lineNo })
    .from(workingOrderLines)
    .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(and(inArray(workingOrderLines.id, [...lineIds]), eq(orderGroups.state, "held")))
    .orderBy(workingOrderLines.lineNo)
    .limit(1);
  if (held !== undefined) {
    throw new AppError("group.held_leaves_party", { tabId, lineNo: held.lineNo });
  }
}

/** Take these lines, and their extras children, out of their group: they left its party. */
export async function clearGroups(tx: Transaction, lineIds: readonly string[]): Promise<void> {
  if (lineIds.length === 0) return;
  await tx
    .update(workingOrderLines)
    .set({ groupId: null })
    .where(
      or(
        inArray(workingOrderLines.id, [...lineIds]),
        inArray(workingOrderLines.parentLineId, [...lineIds]),
      ),
    );
}

/** A row a split made. */
export interface SplitRow {
  id: string;
  lineNo: number;
}

/**
 * Split `quantity` of each of these top-level lines off into a new row of the same order, which
 * keeps its prices, group, credit and a ticket item of its own for the part; returns each new row
 * keyed by the id of the line it split. Each `quantity` must be less than its line's. A dish with
 * extras is refused unless `splitExtras` is set, as {@link carveOffLines} describes.
 */
export async function splitLinesWithinOrder(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  splits: { lineNo: number; quantity: string }[],
  opts: { splitExtras?: boolean } = {},
): Promise<Map<string, SplitRow>> {
  const { splitLines } = await carveOffLines(tx, cfg, orderId, orderId, splits, {
    refuseHeld: false,
    ...opts,
  });
  return splitLines;
}

/**
 * Give a split row its own copy of the source line's ticket item, asking for the part moved, and take
 * that part off the source's; returns the copy's id. The total the kitchen makes is unchanged.
 */
async function splitTicketItem(
  tx: Transaction,
  ticketItemId: string,
  lineQuantity: string,
  toOrderId: string,
  splitLineId: string,
  moved: string,
): Promise<string> {
  const [ticket] = await tx.select().from(ticketItems).where(eq(ticketItems.id, ticketItemId));
  const movedThousandths = stringToThousandths(moved);
  const asked = ticket!.quantity ?? decimalToThousandths(decimal(lineQuantity));
  await tx
    .update(ticketItems)
    .set({ quantity: asked - movedThousandths })
    .where(eq(ticketItems.id, ticketItemId));
  const id = randomUUID();
  await tx.insert(ticketItems).values({
    ...ticket!,
    id,
    workingOrderId: toOrderId,
    workingOrderLineId: splitLineId,
    quantity: movedThousandths,
  });
  const marks = await tx
    .select()
    .from(watcherItemMarks)
    .where(eq(watcherItemMarks.ticketItemId, ticketItemId));
  if (marks.length) {
    await tx.insert(watcherItemMarks).values(marks.map((mark) => ({ ...mark, ticketItemId: id })));
  }
  return id;
}

/** One row of the held-orders list the counter shows to retrieve a parked order. */
export interface HeldOrderSummary {
  id: string;
  orderNumber: number;
  /**
   * The operator-supplied label ("Mesa 4"); on an open bill moved to the counter, the party's display
   * name the server set; null when neither gave one.
   */
  label: string | null;
  /** Number of lines on the order, 0 for a lineless order. */
  itemCount: number;
  /** The GROSS total the operator saw; the filed `sale_lines.line_total` is net. */
  total: string;
  /** `total` less the money the bill has received. */
  outstanding: string;
  /** A payment is pending or received on the bill, one given back in full included. */
  hasPayments: boolean;
  /** The bill's own dishes ready or waiting long, which the counter's list shows. */
  signals: KitchenSignal[];
  /** Null for a counter order; a party's bill is listed here too. */
  partyId: string | null;
  openedAt: string;
}

/** A retrieved order with the stored commercial snapshot needed to rebuild its basket. */
export interface HeldOrder {
  id: string;
  orderNumber: number;
  label: string | null;
  /** What an edit of this copy sends back, so a save from a copy since changed is refused. */
  revision: number;
  /**
   * PARENT rows only, each dish's child lines nested as `extras`. A row carries its stored offer and
   * display snapshot, so retrieval does not depend on the offer still being active; a row with no
   * stored offer is returned by its product alone.
   */
  lines: {
    /** The dish's frozen options answers: names, no ids. */
    optionSnapshots?: OptionSnapshot[];
    workingOrderLineId?: string;
    menuItemId?: string;
    /** The dish: on a line sold as a variant, the variant's parent. */
    productId: string | null;
    /** The variant the line was sold as, absent when it names none. */
    variantId?: string;
    quantity: string;
    makeAt: string | null;
    /** One entry per CHILD line: the frozen values, and the list the pick was taken from. */
    extras?: {
      productId: string | null;
      name: string;
      descriptions: Record<string, string>;
      kitchenName: string | null;
      price: string;
      quantity: number;
      /** Null only on a child older than `0014_order_edit_columns.sql`. */
      listId: string | null;
    }[];
    note?: string;
    product?: {
      id: string;
      productId: string;
      menuItemId: string;
      variantId?: string;
      /** The staff name frozen at add time. */
      name: string;
      /** The line's frozen customer-facing text, locale -> text. */
      customerName: Record<string, string>;
      /** Kept apart from the product's names, so the retrieving surface picks the one it shows. */
      variantName?: string;
      variantCustomerName?: Record<string, string> | null;
      variantKitchenName?: string | null;
      unit: {
        id: string;
        name: Readonly<Record<string, string>>;
        precision: number;
        hardwareUnit: "kg" | "g" | "mg" | null;
      };
      unitPrice: string;
      vatClass: "general" | "reduced" | "super_reduced" | "zero";
      category: string | null;
      allergens: Readonly<
        Record<string, { readonly presence: "contains" | "may_contain"; readonly source?: string }>
      > | null;
      courseId: string | null;
      catalogueId: string;
      catalogueName: string;
      diet: unknown;
      dietDerivation: unknown;
      dietOverride: unknown;
    };
  }[];
}

/** List the venue's open bills, a party's bill and lineless ones included. */
export async function listHeldOrders(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
): Promise<HeldOrderSummary[]> {
  void cfg;
  return withTransaction(deps.db, async (tx) => {
    const rows = await tx
      .select({
        id: workingOrders.id,
        orderNumber: workingOrders.orderNumber,
        label: workingOrders.label,
        partyId: workingOrders.partyId,
        itemCount: sql<number>`cast(count(${workingOrderLines.id}) as int)`,
        // Cast to text for `rawCentsToDecimal`; see its doc comment.
        total: sql<string>`cast(coalesce(sum(${workingOrderLines.lineTotal}), 0) as text)`,
        openedAt: workingOrders.openedAt,
      })
      .from(workingOrders)
      .leftJoin(workingOrderLines, eq(workingOrderLines.workingOrderId, workingOrders.id))
      // Venue-wide: `node_id` records the writer and is never filtered on here.
      .where(eq(workingOrders.status, "open"))
      .groupBy(
        workingOrders.id,
        workingOrders.orderNumber,
        workingOrders.label,
        workingOrders.partyId,
        workingOrders.openedAt,
      )
      .orderBy(workingOrders.orderNumber);
    const ids = rows.map((row) => row.id);
    const { received, holding } = await readPaymentsByBill(tx, ids);
    const signals = await readBillSignals(tx, ids, Date.now());
    return rows.map((row) => {
      const total = rawCentsToDecimal(row.total);
      return {
        ...row,
        total,
        outstanding: outstandingOf(total, received.get(row.id)),
        hasPayments: holding.has(row.id),
        signals: signals.get(row.id)!,
      };
    });
  });
}

/** Read an open parked order anywhere in the venue, with the snapshots the till rebuilds its basket
 * from even when an offer has since been deactivated. */
export function getHeldOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
): Promise<HeldOrder> {
  return readBasketOrder(deps, cfg, id, eq(workingOrders.status, "open"));
}

/** A counter order sent without payment, read as {@link getHeldOrder} reads an open one, so the till
 * can take its payment. */
export function getPlacedCounterOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
): Promise<HeldOrder> {
  return readBasketOrder(
    deps,
    cfg,
    id,
    and(eq(workingOrders.status, "placed"), isNull(workingOrders.partyId))!,
  );
}

async function readBasketOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
  which: SQL,
): Promise<HeldOrder> {
  return withTransaction(deps.db, async (tx) => {
    const [order] = await tx
      .select({
        id: workingOrders.id,
        orderNumber: workingOrders.orderNumber,
        label: workingOrders.label,
        revision: workingOrders.revision,
      })
      .from(workingOrders)
      .where(and(eq(workingOrders.id, id), which));

    if (order === undefined) {
      throw new AppError("working_order.not_found", { workingOrderId: id });
    }

    const storedLines = await tx
      .select({
        id: workingOrderLines.id,
        productId: workingOrderLines.productId,
        quantity: workingOrderLines.quantity,
        descriptions: workingOrderLines.descriptions,
        variantDescriptions: workingOrderLines.variantDescriptions,
        optionSnapshots: workingOrderLines.optionSnapshots,
        unitPriceGross: workingOrderLines.unitPriceGross,
        courseId: workingOrderLines.courseId,
        makeAt: workingOrderLines.makeAtStationId,
        parentLineId: workingOrderLines.parentLineId,
        extraListId: workingOrderLines.extraListId,
        note: workingOrderLines.note,
        productParentId: products.parentId,
        variantName: workingOrderLines.variantName,
        variantKitchenName: workingOrderLines.variantKitchenName,
        kitchenName: workingOrderLines.kitchenName,
        name: workingOrderLines.name,
      })
      .from(workingOrderLines)
      .leftJoin(products, eq(products.id, workingOrderLines.productId))
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    const lineRows = storedLines.map(({ productParentId, ...line }) => {
      const { productId, variantId } = soldProduct({ ...line, productParentId });
      return {
        ...line,
        productId,
        variantId,
        quantity: thousandthsToDecimal(line.quantity),
        unitPriceGross: centsToDecimal(line.unitPriceGross),
      };
    });

    const contextByLine = new Map(
      (await VENUE_SERVICE.listLineContexts(tx, cfg, id)).map((line) => [
        line.workingOrderLineId,
        line,
      ]),
    );
    const childrenByParent = new Map<string, typeof lineRows>();
    for (const line of lineRows) {
      if (line.parentLineId === null) continue;
      const children = childrenByParent.get(line.parentLineId) ?? [];
      children.push(line);
      childrenByParent.set(line.parentLineId, children);
    }
    const lines = lineRows
      .filter((line) => line.parentLineId === null)
      .map((line) => {
        const context = contextByLine.get(line.id);
        if (context === undefined || line.productId === null) {
          return {
            productId: line.productId,
            quantity: line.quantity,
            makeAt: line.makeAt,
            optionSnapshots: line.optionSnapshots,
            ...(line.optionSnapshots.length ? { workingOrderLineId: line.id } : {}),
          };
        }
        // A child's stored quantity is dish quantity × pick count.
        const extras = (childrenByParent.get(line.id) ?? []).map((child) => ({
          productId: child.productId,
          name: child.name,
          descriptions: child.descriptions,
          kitchenName: child.kitchenName,
          price: child.unitPriceGross,
          quantity: Number(child.quantity) / Number(line.quantity),
          listId: child.extraListId,
        }));
        return {
          workingOrderLineId: line.id,
          optionSnapshots: line.optionSnapshots,
          menuItemId: context.menuItemId,
          productId: line.productId,
          quantity: line.quantity,
          makeAt: line.makeAt,
          ...(extras.length === 0 ? {} : { extras }),
          ...(line.note === null ? {} : { note: line.note }),
          ...(line.variantId === null ? {} : { variantId: line.variantId }),
          product: {
            id: line.productId,
            productId: line.productId,
            menuItemId: context.menuItemId,
            name: line.name,
            customerName: line.descriptions,
            ...(line.variantId === null ? {} : { variantId: line.variantId }),
            ...(line.variantName === null ? {} : { variantName: line.variantName }),
            variantCustomerName: line.variantDescriptions,
            variantKitchenName: line.variantKitchenName,
            kitchenName: line.kitchenName,
            unit: {
              id: context.unitId,
              name: context.unitName,
              precision: context.unitPrecision,
              hardwareUnit: context.hardwareUnit,
            },
            unitPrice: line.unitPriceGross,
            vatClass: context.vatClass as "general" | "reduced" | "super_reduced" | "zero",
            category: context.categoryName,
            allergens: context.allergens,
            courseId: line.courseId,
            catalogueId: context.menuId,
            catalogueName: context.menuName,
            diet: context.diet,
            dietDerivation: context.dietDerivation,
            dietOverride: context.dietOverride,
          },
        };
      });

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      label: order.label,
      revision: order.revision,
      lines,
    };
  });
}

/**
 * The complete edited basket and an optional label. A line naming a stored line by
 * `workingOrderLineId`, with the same offer and variant, is an edit of it; any other line is new. A
 * stored line the basket does not name is removed. The request never supplies a price.
 */
export interface UpdateHeldOrderRequest {
  lines: ({
    workingOrderLineId?: string;
    menuItemId: string;
    quantity: string;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
  } & LineExtras)[];
  label?: string;
  revision: number;
  /** Who saves: credited with the lines the save adds, and named by a group it starts or removes. */
  operatorId?: string;
}

/** What {@link updateHeldOrder} needs to issue the bill's invoice when the save leaves it fully paid. */
interface IssueOnSave {
  fiscal: TillSaleDeps;
  saleCfg: TillConfig | null;
}

/** What `PUT /api/working-orders/:id/lines/:lineNo` changes on one line; an absent field is kept. */
export interface OrderLinePatch {
  makeAt?: string | null;
  quantity?: string;
  note?: string | null;
  options?: OptionSelection[];
  extras?: ExtraSelection[];
}

/** A stored line as the edit path reads it, with its ticket item's kitchen state. */
interface EditableLine {
  id: string;
  lineNo: number;
  parentLineId: string | null;
  productId: string | null;
  /** Set on a variant line: the variant's parent, the dish whose lists the line answered. */
  parentProductId: string | null;
  quantity: Decimal;
  priceQuantity: Decimal;
  unitPriceGross: Decimal;
  unitPrecision: number | null;
  note: string | null;
  optionSnapshots: OptionSnapshot[];
  extraListId: string | null;
  courseId: string | null;
  makeAtStationId: string | null;
  sentAt: string | null;
  groupId: string | null;
  groupState: string | null;
  creditedTo: string | null;
  /** A comp or discount has set its price (`list_unit_price_gross` is set). */
  adjusted: boolean;
  ticket: {
    id: string;
    firedAt: string | null;
    state: TicketState;
    stationId: string;
    stationChosenAt: string | null;
    courseId: string | null;
    madeHere: boolean;
    /** Thousandths. */
    firedQuantity: number;
  } | null;
}

/** A stored dish line, its extras children and the offer it was sold through. */
interface EditableParent extends EditableLine {
  menuItemId: string | undefined;
  children: EditableLine[];
}

interface EditableOrder {
  /** The party the order belongs to; null for a counter order or a bill of no party. */
  partyId: string | null;
  lines: EditableLine[];
  parents: EditableParent[];
  maxLineNo: number;
  /**
   * What a line the edit adds gets from the kitchen: `fire` where some line of the order was sent
   * outside a held group, as a round's line would; a sent made-here line in a held group counts
   * as held work. `hold` where the kitchen holds items or a group holds lines; `none` where the order has no ticket item, no
   * grouped line and nothing sent, as a parked counter order, whose lines are fired when it is
   * placed.
   */
  newWork: "fire" | "hold" | "none";
  /** The courses in which the kitchen already has fired work, read before the edit changes any. */
  firedCourseIds: Set<string>;
}

/**
 * What a line the kitchen has not fired is waiting for, in {@link EditableOrder.newWork}'s terms: a
 * held or recalled item waits to be sent; a line with no item was released when it was stamped sent,
 * waits in its held group when it has one, and is otherwise a line nothing has sent.
 */
function kitchenStateOf(line: EditableLine): EditableOrder["newWork"] {
  if (line.ticket !== null) return "hold";
  if (line.sentAt !== null) return "fire";
  return line.groupId === null ? "none" : "hold";
}

/** What an edit asks of one stored dish line. `null` options or extras keep the stored ones. */
interface LineIntent {
  makeAt?: string | null;
  quantity: string;
  note: string | null;
  options: { set: unknown } | null;
  extras: { set: unknown } | null;
}

type RequestedLine = Parameters<typeof priceOrderLines>[3][number];

/**
 * An OPEN order, else `working_order.not_open`, whose revision is `revision`, else
 * `working_order.out_of_date`.
 */
async function requireEditableOrder(
  tx: Transaction,
  orderId: string,
  revision: number,
): Promise<{ label: string | null }> {
  const [order] = await tx
    .select({
      status: workingOrders.status,
      revision: workingOrders.revision,
      label: workingOrders.label,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  if (order === undefined || order.status !== "open") {
    throw new AppError("working_order.not_open", { workingOrderId: orderId });
  }
  if (revision !== order.revision) {
    throw new AppError("working_order.out_of_date", {
      workingOrderId: orderId,
      revision: order.revision,
    });
  }
  return { label: order.label };
}

/**
 * Refuse `bill.refund_in_progress` while a card refund of any of these bills is pending (bill
 * payments design §5.2, §6b): until its outcome is known, the money the bill has received is not
 * known either.
 */
export async function refuseRefundInProgress(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<void> {
  const [pending] = await tx
    .select({ workingOrderId: billPayments.workingOrderId })
    .from(billPaymentRefunds)
    .innerJoin(billPayments, eq(billPayments.id, billPaymentRefunds.billPaymentId))
    .where(
      and(
        inArray(billPayments.workingOrderId, [...orderIds]),
        eq(billPaymentRefunds.state, "pending"),
      ),
    )
    .orderBy(billPayments.workingOrderId)
    .limit(1);
  if (pending !== undefined) {
    throw new AppError("bill.refund_in_progress", { workingOrderId: pending.workingOrderId });
  }
}

/**
 * Refuse while money on any of these OPEN orders is moving: `bill.refund_in_progress` for a pending
 * card refund, else `order.payment_in_flight` for a card at the reader — a payment of the whole
 * order between pricing and filing (plan D22's mark), or a pending card payment of part of the bill
 * (bill payments design §5.2). Every line write that can change the bill's total stops here,
 * because the capture that completes the bill invoices it from that total; a served mark
 * (`writeServed`) does not.
 */
export async function refusePaymentInFlight(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<void> {
  await refuseRefundInProgress(tx, orderIds);
  await refuseOrderPaymentMarked(tx, orderIds);
  const [pending] = await tx
    .select({ workingOrderId: billPayments.workingOrderId })
    .from(billPayments)
    .innerJoin(workingOrders, eq(workingOrders.id, billPayments.workingOrderId))
    .where(
      and(
        inArray(billPayments.workingOrderId, [...orderIds]),
        eq(billPayments.state, "pending"),
        eq(workingOrders.status, "open"),
      ),
    )
    .orderBy(billPayments.workingOrderId)
    .limit(1);
  if (pending !== undefined) {
    throw new AppError("order.payment_in_flight", { workingOrderId: pending.workingOrderId });
  }
}

/**
 * Plan D22's half of {@link refusePaymentInFlight}: a payment of the whole order is between pricing
 * and filing. It reads the order's own mark, never the payments store: the simulator writes no
 * `attempting` row, and Stripe and SumUp write theirs after pricing committed. Only deciding when
 * the mark may be RELEASED reads that store (`till-sale.ts`). A payment of part of the bill checks
 * only this half: cash, or a second card, may be taken while another card is at the reader.
 */
export async function refuseOrderPaymentMarked(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<void> {
  const [paying] = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(
      and(
        inArray(workingOrders.id, [...orderIds]),
        eq(workingOrders.status, "open"),
        isNotNull(workingOrders.paymentAttemptAt),
      ),
    )
    .orderBy(workingOrders.id)
    .limit(1);
  if (paying !== undefined) {
    throw new AppError("order.payment_in_flight", { workingOrderId: paying.id });
  }
}

/**
 * Count one more write on each OPEN order named; a settled or placed order's revision stays. It
 * refuses first (`refusePaymentInFlight`), so a write that ends here is refused on an order being
 * paid, rolling back what it did before. A served mark does not end here (`writeServed`).
 */
export async function bumpRevision(tx: Transaction, orderIds: readonly string[]): Promise<void> {
  await refusePaymentInFlight(tx, orderIds);
  await tx
    .update(workingOrders)
    .set({ revision: sql`${workingOrders.revision} + 1` })
    .where(and(inArray(workingOrders.id, [...orderIds]), eq(workingOrders.status, "open")));
}

async function readEditableOrder(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
): Promise<EditableOrder> {
  const rows = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      productId: workingOrderLines.productId,
      parentProductId: products.parentId,
      quantity: workingOrderLines.quantity,
      priceQuantity: workingOrderLines.priceQuantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
      listUnitPriceGross: workingOrderLines.listUnitPriceGross,
      unitPrecision: workingOrderLines.unitPrecision,
      note: workingOrderLines.note,
      optionSnapshots: workingOrderLines.optionSnapshots,
      extraListId: workingOrderLines.extraListId,
      courseId: workingOrderLines.courseId,
      makeAtStationId: workingOrderLines.makeAtStationId,
      sentAt: workingOrderLines.sentAt,
      groupId: workingOrderLines.groupId,
      groupState: orderGroups.state,
      creditedTo: workingOrderLines.creditedTo,
      ticketId: ticketItems.id,
      firedAt: ticketItems.firedAt,
      state: ticketItems.state,
      stationId: ticketItems.stationId,
      stationChosenAt: ticketItems.stationChosenAt,
      ticketCourseId: ticketItems.courseId,
      madeHere: ticketItems.madeHere,
      firedQuantity,
    })
    .from(workingOrderLines)
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(workingOrderLines.workingOrderId, orderId))
    .orderBy(workingOrderLines.lineNo);
  const lines: EditableLine[] = rows.map((row) => ({
    id: row.id,
    lineNo: row.lineNo,
    parentLineId: row.parentLineId,
    productId: row.productId,
    parentProductId: row.parentProductId,
    quantity: thousandthsToDecimal(row.quantity),
    priceQuantity: thousandthsToDecimal(row.priceQuantity),
    unitPriceGross: centsToDecimal(row.unitPriceGross),
    unitPrecision: row.unitPrecision,
    note: row.note,
    optionSnapshots: row.optionSnapshots,
    extraListId: row.extraListId,
    courseId: row.courseId,
    makeAtStationId: row.makeAtStationId,
    sentAt: row.sentAt,
    groupId: row.groupId,
    groupState: row.groupState,
    creditedTo: row.creditedTo,
    adjusted: row.listUnitPriceGross !== null,
    ticket:
      row.ticketId === null
        ? null
        : {
            id: row.ticketId,
            firedAt: row.firedAt,
            state: row.state!,
            stationId: row.stationId!,
            stationChosenAt: row.stationChosenAt,
            courseId: row.ticketCourseId,
            madeHere: row.madeHere!,
            firedQuantity: row.firedQuantity,
          },
  }));
  const menuItemByLine = new Map(
    (await VENUE_SERVICE.listLineContexts(tx, cfg, orderId)).map((line) => [
      line.workingOrderLineId,
      line.menuItemId,
    ]),
  );
  const parents = lines
    .filter((line) => line.parentLineId === null)
    .map((line) => ({
      ...line,
      menuItemId: menuItemByLine.get(line.id),
      children: lines.filter((child) => child.parentLineId === line.id),
    }));
  return {
    partyId: await partyOfOrder(tx, orderId),
    lines,
    parents,
    maxLineNo: Math.max(0, ...lines.map((line) => line.lineNo)),
    newWork: rows.some(
      (line) => line.sentAt !== null && (!line.madeHere || line.groupState !== "held"),
    )
      ? "fire"
      : lines.some((line) => line.ticket !== null || line.groupId !== null)
        ? "hold"
        : "none",
    firedCourseIds: new Set(
      lines
        .filter(
          (line) =>
            line.ticket?.firedAt != null && !line.ticket.madeHere && line.ticket.courseId !== null,
        )
        .map((line) => line.ticket!.courseId!),
    ),
  };
}

/** Refuse `product.unavailable` for the first of these products that cannot be sold now. */
async function assertProductsSellable(
  tx: Transaction,
  productIds: readonly string[],
): Promise<void> {
  if (productIds.length === 0) return;
  const [refused] = await tx
    .select({ id: products.id })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(and(inArray(products.id, [...productIds]), sql`not ${productSellable}`))
    .limit(1);
  if (refused !== undefined) {
    throw new AppError("product.unavailable", { productId: refused.id });
  }
}

/**
 * Apply edits to an OPEN order's stored dish lines, remove the `removed` ones and add the `fresh`
 * ones, as plan D10 rules:
 *
 * - A stored line keeps its gross price, names and the other facts it was added with; only what the
 *   edit adds is priced now — a new line, and an extra added to a line. A note or an options answer
 *   carries no price. A kept extra is matched by list, product and quantity.
 * - A line with no ticket item, or a held or recalled one, is changed in place, except that units
 *   added to one a comp or a discount repriced go on a new line, priced now (ruling R12). A held one
 *   whose group has a queued HOLD ticket also prints HOLD corrections for its change or its removal
 *   ({@link planHeldCorrections}).
 * - A line the kitchen has, not started: a change recalls the old item with a notice and slip and
 *   fires the changed line as a new item; a quantity rise leaves the item and adds the difference as
 *   a new line; a drop voids the difference, with a notice and slip. Removing it voids it the same
 *   way.
 * - A started line is refused `ticket.already_started`; with changes to sent items switched off, a
 *   line that was sent to a station is refused `ticket.already_fired`.
 *
 * New lines are numbered after the order's highest line number, and reach the kitchen as
 * {@link EditableOrder.newWork} says: where work was sent, as a round's line would, a course the
 * kitchen had fired before the edit counting as fired. A line that gains an extra moves after that
 * number with its extras, so each dish is followed by its own extras in line order, as a ticket
 * groups them.
 *
 * On a party: an added extra takes its dish's group and credit; a fired line's raised quantity
 * goes in a new fired group, and a new dish in a new group fired or held as `newWork` says, both at
 * the end of the sequence and credited to `operatorId`, a held one printing its HOLD ticket where the
 * venue prints held work in advance; the units added to a comped or discounted line the kitchen has
 * not fired go on a new line, priced now, in that line's group and kitchen state (ruling R12), a
 * held one correcting its group's HOLD ticket where one was queued; a held group the edit empties
 * is removed; the party's revision moves on.
 */
async function applyLineEdits(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  order: EditableOrder,
  plan: {
    edits: { parent: EditableParent; intent: LineIntent }[];
    removed: EditableParent[];
    fresh: RequestedLine[];
  },
  operatorId: string | undefined,
): Promise<{ changed: boolean }> {
  const before = await totalBeforeEdit(tx, cfg, orderId);
  const routing = routingOnce(tx, cfg, new Date());
  const context = await VENUE_SERVICE.findOrderContext(tx, cfg, orderId);
  let editSentLines: boolean | undefined;
  /** Refuses what the kitchen state forbids; answers whether the kitchen holds fired work. */
  const kitchenHas = async (line: EditableParent): Promise<boolean> => {
    const records = [line, ...line.children].flatMap((part) =>
      part.ticket === null ? [] : [part.ticket],
    );
    if (line.sentAt !== null && records.length > 0) {
      editSentLines ??= await VENUE_SERVICE.readEditSentLines(tx);
      if (!editSentLines) throw new AppError("ticket.already_fired", { workingOrderId: orderId });
    }
    const started = records.find((record) => isStarted(record.state));
    if (started !== undefined) {
      throw new AppError("ticket.already_started", { ticketItemId: started.id });
    }
    return records.some((record) => record.firedAt !== null);
  };
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
  const defaultLanguage = needsModifiers
    ? (await readContentLanguages(tx, cfg.locale)).defaultLanguage
    : "";
  // Read once for the answers the edits are checked against and for the lines priced below.
  const snapshot = needsModifiers
    ? await readBasketOffers(tx, cfg, orderId, context?.zoneId, plan.fresh, [
        ...plan.fresh.map((line) => line.menuItemId),
        ...plan.edits.map(({ parent }) => parent.menuItemId),
      ])
    : undefined;
  const offerById = new Map(snapshot?.offers.map((offer) => [offer.id, offer]));
  // A stored line whose dish the live version no longer offers has no published lists left: its
  // options answer, which carries no price, is checked against the dish's own lists instead.
  const withdrawnDishes = needsModifiers
    ? plan.edits.flatMap(({ parent }) =>
        offerById.has(menuItemOf(parent)) ? [] : [parent.parentProductId ?? parent.productId!],
      )
    : [];
  const ownOptions = await productOptionLists(tx, withdrawnDishes);
  const modifiersByOffer = new Map<string, OfferModifiers>();
  const modifiersOf = (line: EditableParent): OfferModifiers => {
    const offer = offerById.get(menuItemOf(line));
    if (offer === undefined) {
      const dishId = (line.parentProductId ?? line.productId!).toLowerCase();
      return { ...NO_MODIFIERS, options: ownOptions.get(dishId) ?? [] };
    }
    let modifiers = modifiersByOffer.get(offer.id);
    if (modifiers === undefined) {
      modifiers = offerModifiers(offer, defaultLanguage);
      modifiersByOffer.set(offer.id, modifiers);
    }
    return modifiers;
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
      }
    | { kind: "extras" }
    | { kind: "check" }
  )[] = plan.fresh.map(() => ({ kind: "line", kitchen: order.newWork }));
  const raised: RequestedLine[] = [];
  const resent: string[] = [];
  const paid = await readPaidQuantities(tx, orderId);

  for (const { parent, intent } of plan.edits) {
    assertQuantityPrecision(intent.quantity, parent.unitPrecision ?? MAX_UNIT_PRECISION, {
      positive: true,
    });
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
      await requireMakeAtStation(tx, cfg, intent.makeAt);
    const modifiers = needsModifiers ? modifiersOf(parent) : NO_MODIFIERS;
    let optionSnapshots = parent.optionSnapshots;
    if (intent.options !== null) {
      const frozen = buildLineExtras(
        { extras: [], options: modifiers.options },
        modifiers.extraProducts,
        { options: intent.options.set },
        defaultLanguage,
      ).optionSnapshots;
      // By value, never by order: see `docs/developers/modifiers.md`.
      if (!sameOptionSelections(frozen, parent.optionSnapshots)) optionSnapshots = frozen;
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
        : editLineExtras(modifiers.extras, modifiers.extraProducts, intent.extras.set, {
            children: parent.children,
            dishQuantity: parent.quantity,
          });
    const changed =
      intent.note !== parent.note ||
      (parent.sentAt === null &&
        parent.ticket === null &&
        intent.makeAt !== undefined &&
        intent.makeAt !== parent.makeAtStationId) ||
      optionSnapshots !== parent.optionSnapshots ||
      extras.added.length > 0 ||
      extras.removed.length > 0;
    if (!changed && rise === 0) continue;
    // Changed in place or replaced, a paid line would no longer be what was paid for.
    await refusePaidLines(tx, orderId, paidLineParts(parent), paid);
    const fired = await kitchenHas(parent);
    const action: Action = !fired ? "free" : changed ? "change" : rise > 0 ? "raise" : "drop";
    // Widening an adjusted line would sell the added units at its adjusted price (ruling R12).
    const addedApart = action === "free" && rise > 0 && parent.adjusted;

    // The picks the line carries after the edit, as a request names them. A child older than
    // `0014_order_edit_columns.sql` names none, and pricing it again refuses it as `extras.invalid`.
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
    const asOffered = (quantity: string): RequestedLine => ({
      menuItemId: menuItemOf(parent),
      ...variantOf(parent),
      quantity,
      makeAt: inheritMakeAt ? parent.makeAtStationId : intent.makeAt,
      ...(intent.note === null ? {} : { note: intent.note }),
      frozenOptions: optionSnapshots,
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
            }
          : {
              kind: "line",
              kitchen: "fire",
              origin: parent,
              inheritMakeAt,
            },
      );
    }
    if (action === "free" && rise > 0 && !addedApart) raised.push(asOffered(requested));
    if (action === "change") {
      // The changed line goes to the kitchen again, which a sold-out dish never does.
      resent.push(parent.productId!, ...extras.kept.map(({ child }) => child.productId!));
    }
    const quantity = (action === "change" && rise > 0) || addedApart ? parent.quantity : requested;
    let addedAt: number | null = null;
    if (extras.added.length > 0) {
      addedAt = pricing.length;
      pricing.push({
        menuItemId: menuItemOf(parent),
        ...variantOf(parent),
        quantity,
        frozenOptions: [],
        frozenExtras: extras.added,
        [ADDED_EXTRAS_ONLY]: true,
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
  const voided: CorrectionItem[] = [];
  for (const parent of plan.removed) {
    await kitchenHas(parent);
    for (const part of [parent, ...parent.children])
      if (part.ticket !== null && part.ticket.firedAt !== null)
        voided.push({
          workingOrderLineId: part.id,
          stationId: part.ticket.stationId,
          quantity: part.ticket.firedQuantity,
          wasStarted: false,
        });
  }

  // Priced before anything is written, so a refused line leaves the order as it was.
  for (const line of plan.fresh)
    if (line.makeAt != null) await requireMakeAtStation(tx, cfg, line.makeAt);
  const priced = await priceOrderLines(
    tx,
    cfg,
    orderId,
    pricing,
    context?.zoneId,
    snapshot,
    "ignore",
  );
  const groups: { rows: WorkingOrderLineInsert[]; contexts: typeof priced.lineContexts }[] = [];
  priced.lineRows.forEach((row, index) => {
    if (row.parentLineId === null) groups.push({ rows: [], contexts: [] });
    groups[groups.length - 1]!.rows.push(row);
    groups[groups.length - 1]!.contexts.push(priced.lineContexts[index]!);
  });

  // On a party, what the edit adds for the kitchen goes in a new group at the end of the sequence,
  // one fired now, one held, as the lines' `kitchen` says, except units added beside an adjusted
  // line, which join that line's group. Its lines are credited to the editor.
  const newGroups = new Map<string, string>();
  if (order.partyId !== null) {
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
      const groupId = await startGroup(tx, order.partyId, as.kitchen, actorId);
      await recordGroupEvent(tx, {
        partyId: order.partyId,
        groupId,
        kind: "submitted",
        actorId,
        detail: { workingOrderId: orderId, release: as.kitchen },
      });
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
      ...voided,
      ...removedExtras,
      ...dropped.flatMap(({ parent, kept, removed }) => [
        ...(parent.ticket === null ? [] : [correctionFor(parent, removed)]),
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
  const fireNow: Parameters<typeof fireLines>[3] = [];
  const keepMadeHere = new Map<string, { madeHere: boolean; stationId: string }>();
  const keepStations = new Map<string, string>();
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
      // A held or recalled item is sent later as the line now reads.
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
  }

  // Units added apart from an adjusted line join its group, so it and they are released together.
  const joinedHeld: { groupId: string; lineId: string }[] = [];
  groups.forEach((group, index) => {
    const as = pricedAs[index]!;
    if (as.kind !== "line") return;
    const groupId = as.joins === undefined ? (newGroups.get(as.kitchen) ?? null) : as.joins.groupId;
    if (as.joins !== undefined && groupId !== null && as.kitchen === "hold") {
      joinedHeld.push({ groupId, lineId: group.rows[0]!.id! });
    }
    for (const [rowIndex, row] of group.rows.entries()) {
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
    await tx.insert(workingOrderLines).values(inserted);
    await VENUE_SERVICE.recordLineContexts(tx, cfg, orderId, insertedContexts, priced.offers);
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
      firedAt:
        parent.ticket !== null
          ? parent.ticket.firedAt
          : parent.groupState === "held" ||
              parent.children.some(
                (child) => child.ticket !== null && child.ticket.firedAt === null,
              )
            ? null
            : routing.at.toISOString(),
    })),
    routing,
  );
  await enqueueKitchenTickets(
    tx,
    cfg,
    orderId,
    insertedExtras.filter((item) => item.firedAt !== null),
  );
  const printedAdded = await printedHeldGroups(
    tx,
    addedToExisting.flatMap(({ parent }) => (parent.groupId === null ? [] : [parent.groupId])),
  );
  const givenExtras: HeldChange[] = insertedExtras.flatMap((item) => {
    const parent = addedToExisting.find(
      ({ parent }) =>
        parent.children.some((child) => child.id === item.workingOrderLineId) ||
        inserted.some(
          (row) => row.id === item.workingOrderLineId && row.parentLineId === parent.id,
        ),
    )?.parent;
    const group =
      parent?.groupId === null || parent === undefined
        ? undefined
        : printedAdded.get(parent.groupId);
    return item.firedAt === null && group !== undefined
      ? [
          {
            workingOrderId: orderId,
            workingOrderLineId: item.workingOrderLineId,
            stationId: item.stationId,
            quantity: item.quantity,
            group,
          },
        ]
      : [];
  });
  // After the extras a line gains are written: a slip reads the line as it now stands.
  await correctHoldTickets(tx, cfg, [...held.given, ...givenExtras], {
    kind: "HOLD CHANGED",
    direction: "added",
  });
  // Fired while the removed lines' items still stand, so a course they held counts as fired.
  await fireLines(tx, cfg, orderId, fireNow, { keepStations, keepMadeHere, routing });
  const heldGroup = newGroups.get("hold");
  if (heldGroup !== undefined) await printHoldTickets(tx, cfg, [heldGroup]);
  // As a raise of the line itself would: `+N` on its group's queued HOLD ticket, not a new one.
  for (const { groupId, lineId } of joinedHeld) await correctJoin(tx, cfg, groupId, [lineId]);
  if (plan.removed.length > 0) {
    const removedIds = plan.removed.map((parent) => parent.id);
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
  await assertBillInvariant(tx, [orderId]);
  const changed = changes.length > 0 || plan.removed.length > 0 || plan.fresh.length > 0;
  if (changed) await refuseOrderOverSimplifiedLimit(tx, cfg, orderId, before);
  if (changed) {
    await partyAfterEdit(
      tx,
      orderId,
      plan.removed.flatMap((parent) => (parent.groupId === null ? [] : [parent.groupId])),
      operatorId,
    );
  }
  return { changed };
}

/**
 * The HOLD corrections an edit makes to held lines of groups whose HOLD ticket was queued: a
 * removed line is `cancelled`; a line whose quantity alone changes loses (`taken`) or gains
 * (`given`) the difference; any other change takes the line away as it read, at its old quantity,
 * and gives it back as it now reads, at its new one. `taken` and `cancelled` print before the line
 * changes and `given` after, as each slip reads the line as it stands.
 */
async function planHeldCorrections(
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
    parent.groupId !== null &&
    [parent, ...parent.children].some(
      (part) => part.ticket !== null && part.ticket.firedAt === null,
    );
  const heldChanges = changes.filter(({ parent }) => held(parent));
  const heldRemoved = removed.filter(held);
  const printed = await printedHeldGroups(tx, [
    ...heldChanges.map(({ parent }) => parent.groupId!),
    ...heldRemoved.map((parent) => parent.groupId!),
  ]);
  const change = (parent: EditableParent, part: EditableLine, quantity: number): HeldChange[] => {
    const group = printed.get(parent.groupId!);
    if (
      group === undefined ||
      quantity <= 0 ||
      part.ticket === null ||
      part.ticket.firedAt !== null
    )
      return [];
    return [
      {
        workingOrderId: orderId,
        workingOrderLineId: part.id,
        stationId: part.ticket.stationId,
        quantity,
        group,
      },
    ];
  };
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
function paidLineParts(parent: EditableParent): { id: string; lineNo: number; keeps: number }[] {
  return [parent, ...parent.children].map((line) => ({
    id: line.id,
    lineNo: parent.lineNo,
    keeps: 0,
  }));
}

/**
 * Count a write on the order's revision only when it changed something, and answer the revision the
 * order is at after it: `copy` is the one {@link requireEditableOrder} matched in this transaction.
 * One that changes nothing is still refused while a card payment of the order is in flight, as a
 * write that changes something is.
 */
async function countEdit(
  tx: Transaction,
  orderId: string,
  copy: number,
  changed: boolean,
): Promise<number> {
  if (!changed) {
    await refusePaymentInFlight(tx, [orderId]);
    return copy;
  }
  await bumpRevision(tx, [orderId]);
  return copy + 1;
}

/**
 * Save an edited copy of an OPEN order, from any node of the venue, by the rules
 * {@link applyLineEdits} states. A line of the basket naming a stored line by id, through the same
 * offer and variant, edits it; a line naming a different offer or variant replaces it with a new
 * item priced now; a line naming none is new; a stored line the basket leaves out is removed. An
 * absent label clears it: the whole request is the new state. Answers the order's revision after
 * the save. A save given `issue` may issue the bill's invoice, so it must name who saves.
 */
export async function updateHeldOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
  req: UpdateHeldOrderRequest,
): Promise<number>;
export async function updateHeldOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
  req: UpdateHeldOrderRequest & { operatorId: string },
  issue: IssueOnSave,
): Promise<number>;
export async function updateHeldOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
  req: UpdateHeldOrderRequest,
  issue?: IssueOnSave,
): Promise<number> {
  return withTransaction(deps.db, async (tx) => {
    const { label } = await requireEditableOrder(tx, id, req.revision);
    // Rewriting an order to zero lines is a discard, which is `abandonHeldOrder`'s job.
    if (req.lines.length === 0) {
      throw new AppError("sale.empty_basket", {});
    }
    const order = await readEditableOrder(tx, cfg, id);
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
      // product goes to the new-line path, which refuses it.
      const sameItem =
        parent.menuItemId === line.menuItemId &&
        !Object.hasOwn(line, "productId") &&
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
    const { changed } = await applyLineEdits(
      tx,
      cfg,
      id,
      order,
      { edits, removed: order.parents.filter((parent) => !claimed.has(parent.id)), fresh },
      req.operatorId,
    );
    const relabelled = (req.label ?? null) !== label;
    if (relabelled) {
      await tx
        .update(workingOrders)
        .set({ label: req.label ?? null })
        .where(eq(workingOrders.id, id));
    }
    const revision = await countEdit(tx, id, req.revision, changed || relabelled);
    // An edit that lowers the total to what the bill has received issues its invoice (design §7).
    if (issue !== undefined) {
      await issueIfFullyPaid(tx, issue.fiscal, issue.saleCfg, id, req.operatorId);
    }
    return revision;
  });
}

/**
 * Edit ONE dish line of an OPEN order made from the copy at `revision`, by the rules
 * {@link applyLineEdits} states; an absent field of `patch` keeps the line's own. A line number the
 * order does not hold is `tab.line_not_found`, and an extras line, which follows its dish,
 * `management.request_invalid`. Answers the order's revision after the edit.
 */
export async function updateOrderLine(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  lineNo: number,
  patch: OrderLinePatch,
  revision: number,
  operatorId?: string,
): Promise<number> {
  await requireEditableOrder(tx, orderId, revision);
  const order = await readEditableOrder(tx, cfg, orderId);
  const line = order.lines.find((candidate) => candidate.lineNo === lineNo);
  if (line === undefined) {
    throw new AppError("tab.line_not_found", { tabId: orderId, lineNo });
  }
  const parent = order.parents.find((candidate) => candidate.id === line.id);
  if (parent === undefined) {
    throw new AppError("management.request_invalid", { field: "lineNo" });
  }
  const { changed } = await applyLineEdits(
    tx,
    cfg,
    orderId,
    order,
    {
      edits: [
        {
          parent,
          intent: {
            quantity: patch.quantity ?? parent.quantity,
            note: Object.hasOwn(patch, "note") ? screenNote(patch.note) : parent.note,
            options: patch.options === undefined ? null : { set: patch.options },
            extras: patch.extras === undefined ? null : { set: patch.extras },
            makeAt: patch.makeAt,
          },
        },
      ],
      removed: [],
      fresh: [],
    },
    operatorId,
  );
  return countEdit(tx, orderId, revision, changed);
}

/** Abandon an open held order anywhere in the venue. An unknown id reads as `working_order.not_open`. */
export async function abandonHeldOrder(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
): Promise<void> {
  void cfg;
  return withTransaction(deps.db, async (tx) => {
    const [locked] = await tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    if (locked === undefined || locked.status !== "open") {
      throw new AppError("working_order.not_open", { workingOrderId: id });
    }
    await refusePaymentInFlight(tx, [id]);
    await refuseBillHoldingMoney(tx, [id]);
    await tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
  });
}

/** The fiscal fields are filled only when placing files an invoice. */
export interface PlaceOrderResult {
  id: string;
  status: "placed" | "settled";
  invoiceNumber?: string;
  issuedAt?: string;
  total?: string;
  qr?: string;
  qrText?: TillSaleResult["qrText"];
  vatBreakdown?: { rate: string; base: string; tax: string }[];
}

/**
 * Place an open order, append its genesis amendment and fire kitchen items in one transaction.
 * invoice_first also files a deferred invoice from the stored prices. `saleTillId` is the
 * authenticated device's register on the fiscal record.
 *
 * A second placement cannot file a second invoice: `withTransaction` IS the venue file's write lock,
 * so it reads `placed` and is refused before it reaches the file.
 */
export async function placeOrder(
  deps: TillSaleDeps,
  cfg: TillConfig,
  id: string,
  operatorId: string,
  saleTillId: TillId,
): Promise<PlaceOrderResult> {
  return withTransaction(deps.db, async (tx) => {
    const [locked] = await tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    if (locked === undefined || locked.status !== "open") {
      throw new AppError("working_order.not_open", { workingOrderId: id });
    }
    await refusePaymentInFlight(tx, [id]);
    // An invoice_first placing files the whole total as one sale, and any other leaves an order
    // whose collect `refuseBillWithPayments` refuses.
    await refuseBillWithPayments(tx, id);
    const serviceContext = await VENUE_SERVICE.findOrderContext(tx, cfg, id);
    const orderFlow = serviceContext?.serviceMode ?? cfg.orderFlow;

    // Placing changes no line's quantity, course or note, so the lines read now are the ones fired.
    // Read before the stamp below. A bill moved here from a table has dishes already sent.
    const lines = await unsentDishLines(tx, id);
    await assertSendable(
      tx,
      lines.map((line) => line.id),
    );
    // Placing commits the whole order, a course the kitchen holds included, so every line is sent.
    await tx
      .update(workingOrderLines)
      .set({ sentAt: nowIso() })
      .where(and(eq(workingOrderLines.workingOrderId, id), isNull(workingOrderLines.sentAt)));

    // Only invoice-first files at placing, from the stored locked lines at the rates of the day it
    // is placed: the day its invoice is issued.
    let placeResult: PlaceOrderResult = { id, status: "placed" };
    if (orderFlow === "invoice_first") {
      const invoice = await priceForIssuance(tx, deps.clock, cfg, id);
      const issued = await issueUnpaidInvoice(
        tx,
        deps.backend,
        cfg,
        invoice,
        operatorId,
        saleTillId,
      );
      const { saleId } = issued;
      const ticket = await unpaidReceipt(tx, deps.backend, invoice, issued);
      placeResult = {
        id,
        status: "placed",
        invoiceNumber: ticket.invoiceNumber,
        issuedAt: ticket.issuedAt,
        total: ticket.total,
        qr: ticket.qr,
        ...(ticket.qrText === undefined ? {} : { qrText: ticket.qrText }),
        vatBreakdown: ticket.vatBreakdown,
      };
      await enqueueOriginalReceipt(tx, { ...cfg, tillId: saleTillId }, ticket, saleId);
    }

    await markOrderPlaced(tx, deps.clock, cfg, id, operatorId);

    await fireLines(tx, cfg, id, lines);

    return placeResult;
  });
}

/** An order's invoice priced from its stored lines at the rates of today, its issue date. */
export interface PricedInvoice extends IssueMoment {
  id: string;
  /** The working-order line each of `priced.lines` was priced from. */
  identities: OrderLineIdentity[];
}

/** Price an order's invoice for {@link issueUnpaidInvoice}. Writes nothing. */
export async function priceForIssuance(
  tx: Transaction,
  clock: TrustedClock,
  cfg: TillConfig,
  id: string,
): Promise<PricedInvoice> {
  const order = await priceStoredOrderForIssuance(tx, id);
  return {
    id,
    identities: order.identities,
    ...issueMoment(clock, await issuancePass(tx, cfg, id, order)),
  };
}

/** An invoice {@link issueUnpaidInvoice} filed, and the order fields its receipt prints. */
export interface IssuedInvoice {
  saleId: SaleId;
  /** The language the invoice was filed in. */
  locale: string;
  fiscal: Awaited<ReturnType<typeof recordSale>>["fiscal"];
  orderLabel: string | null;
  orderNumber: number;
}

/**
 * File the priced invoice with no tender and no settlement until `collectOrder` settles it, and,
 * on an order still open, save the label it was issued under. A placed order's label can change
 * only in the update that moves it to settled or abandoned (`working_orders_enforce_transition`).
 * Prints nothing. `saleTillId` is the device's register on the fiscal record.
 */
export async function issueUnpaidInvoice(
  tx: Transaction,
  backend: FiscalBackend,
  cfg: TillConfig,
  invoice: PricedInvoice,
  operatorId: string,
  saleTillId: TillId,
): Promise<IssuedInvoice> {
  const { id, priced, clock } = invoice;
  const language = await readReceiptLanguage(tx, cfg.locationId);
  const { saleId, fiscal } = await recordSale(tx, backend, {
    tillId: saleTillId,
    nodeId: cfg.nodeId,
    seriesId: cfg.seriesId,
    workingOrderId: brandWorkingOrderId(id),
    ...language,
    total: priced.total,
    lines: priced.lines,
    vatBreakdown: priced.vatBreakdown,
    clock,
    operatorId,
    settlement: { kind: "deferred" },
  });
  const order = await readReceiptOrder(tx, cfg, id, { atIssuance: true });
  await tx
    .update(workingOrders)
    .set({ label: order.orderLabel })
    .where(and(eq(workingOrders.id, id), eq(workingOrders.status, "open")));
  return { saleId, fiscal, locale: language.locale, ...order };
}

/** The receipt of an invoice {@link issueUnpaidInvoice} filed. */
async function unpaidReceipt(
  tx: Transaction,
  backend: FiscalBackend,
  invoice: PricedInvoice,
  issued: IssuedInvoice,
): Promise<TillSaleResult> {
  const { priced } = invoice;
  return {
    ...(await readReceiptIssuer(backend, tx, issued.saleId)),
    locale: issued.locale,
    orderLabel: issued.orderLabel,
    orderNumber: issued.orderNumber,
    invoiceNumber: await readInvoiceNumber(tx, issued.saleId),
    issuedAt: issued.fiscal.issuedAt.toISOString(),
    total: priced.total,
    ...receiptQr(backend, issued.fiscal.verificationUrl),
    vatBreakdown: toVatBreakdown(priced.vatBreakdown),
    ...(await receiptLines(tx, invoice.id, priced, invoice.identities)),
    tender: { method: "unpaid" },
  };
}

/** An open order becomes placed, and its `order_placed` amendment is appended. */
export async function markOrderPlaced(
  tx: Transaction,
  clock: TrustedClock,
  cfg: TillConfig,
  id: string,
  operatorId: string,
): Promise<void> {
  await tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, id));

  // `capturedByTillId` is the CONFIGURED register, as in `cancelPlacedOrder`, so one order's
  // placed/cancelled pair stays on the same register.
  const now = clock.now();
  await appendOrderAmendment(tx, {
    workingOrderId: id,
    kind: "order_placed",
    actorId: operatorId,
    reason: null,
    capturedByTillId: cfg.tillId,
    capturedByNodeId: cfg.nodeId,
    eventAt: now.instant,
    eventOffsetMinutes: now.offsetMinutes,
  });
}

/**
 * Cancel a placed order and append its reasoned amendment in one transaction. A second cancel reads
 * `abandoned` and is refused `working_order.not_placed`.
 *
 * An order whose invoice was issued has the whole invoice credited, on the till `saleTillId`
 * resolves, and settled owing nothing in the same transaction ({@link creditWholeInvoice}). It is
 * refused, writing nothing, while its bill holds a payment, or while a card payment of the invoice
 * is unresolved or captured and not yet filed. `saleTillId` is called only for such an order. Any
 * placed order is refused while an integrated card collection of it runs in this process.
 *
 * The credit needs `sale.rectify` from the operator or from `override`. Only when the operator lacks
 * it is the override's PIN checked, under `operator.attempts`, before the credit.
 */
export async function cancelPlacedOrder(
  deps: TillSaleDeps,
  cfg: TillConfig,
  id: string,
  reason: string,
  operator: { personId: string; sessionId: string; attempts: PinAttempts },
  saleTillId: () => Promise<TillId>,
  override?: Override,
): Promise<void> {
  // The reason is the amendment's accountable content. Checked before the status, so a missing reason
  // is a request-shape error, not the state conflict `not_placed` names.
  if (reason.trim() === "") {
    throw new AppError("working_order.reason_required", { workingOrderId: id });
  }
  const toCheck =
    (await readOrderInvoice(deps.db, id)) === undefined
      ? undefined
      : await overrideToCheck(
          deps.db,
          { sessionId: operator.sessionId, permission: "sale.rectify" },
          override,
        );

  return withPinCheckAhead(deps.db, toCheck, operator.attempts, (checked) =>
    cancelPlaced(deps, cfg, id, reason, operator, saleTillId, withCheck(override, checked)),
  );
}

async function cancelPlaced(
  deps: TillSaleDeps,
  cfg: TillConfig,
  id: string,
  reason: string,
  operator: { personId: string; sessionId: string; attempts: PinAttempts },
  saleTillId: () => Promise<TillId>,
  override: Override | undefined,
): Promise<void> {
  const authz = { sessionId: operator.sessionId, override };
  return withTransaction(deps.db, async (tx) => {
    const [locked] = await tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    if (locked === undefined || locked.status !== "placed") {
      throw new AppError("working_order.not_placed", { workingOrderId: id });
    }

    const invoice = await readOrderInvoice(tx, id);
    // Before the in-flight check, so the answer names the money already on the bill.
    if (invoice !== undefined) await refuseBillWithPayments(tx, id);
    // A placed order's card collection writes no mark, and its provider may write no payment row
    // until the card resolves, so only this process's own record of the attempt shows it.
    if (
      paymentAttemptIsLive(deps.db, id) ||
      (invoice !== undefined && (await ordersWithUnfiledPayment(tx, [id])).has(id))
    ) {
      throw new AppError("order.payment_in_flight", { workingOrderId: id });
    }
    if (invoice !== undefined) {
      await authorize(tx, { ...authz, permission: "sale.rectify" }, operator.attempts);
      await creditWholeInvoice(tx, deps, cfg, invoice, authz, await saleTillId());
    }

    await tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));

    const now = deps.clock.now();
    await appendOrderAmendment(tx, {
      workingOrderId: id,
      kind: "order_cancelled",
      actorId: operator.personId,
      reason,
      capturedByTillId: cfg.tillId,
      capturedByNodeId: cfg.nodeId,
      eventAt: now.instant,
      eventOffsetMinutes: now.offsetMinutes,
    });
  });
}

/**
 * Send a settled order's lines to the kitchen through `fireLines`, which refuses the send if any
 * line already has a ticket item.
 */
export async function sendToPrep(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
): Promise<void> {
  return withTransaction(deps.db, async (tx) => {
    const [order] = await tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    if (order === undefined || order.status !== "settled") {
      throw new AppError("working_order.not_settled", { workingOrderId: id });
    }

    const firedLines = await tx
      .select(fireableLineColumns)
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    // No sold-out check: a settled order's lines cannot be removed, so refusing would strand paid work.
    await fireLines(tx, cfg, id, firedLines);
  });
}

/**
 * Stamp a fired order as collected so it leaves the kitchen queue: a settled one, or a counter order
 * sent without payment in a mode that takes payment after the kitchen has it.
 */
export async function markCollected(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
  id: string,
): Promise<void> {
  return withTransaction(deps.db, (tx) => handOverOrder(tx, cfg, id));
}

/**
 * {@link markCollected} in the caller's transaction. With a `submissionId` it runs at most once per
 * id on this order: a resent request answers as the first did, and the same id sent for another
 * command on this bill is `submission.id_reused`.
 */
export function handOverOrder(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  submissionId?: string,
): Promise<void> {
  if (submissionId === undefined) return handOver(tx, cfg, id);
  return runServiceCommand(
    tx,
    { kind: "bill", workingOrderId: id },
    submissionId,
    "order.collect",
    { workingOrderId: id },
    () => handOver(tx, cfg, id),
    cfg.madeHereSink,
  );
}

async function handOver(tx: Transaction, cfg: TillConfig, id: string): Promise<void> {
  const [order] = await tx
    .select({
      status: workingOrders.status,
      collectedAt: workingOrders.collectedAt,
      partyId: workingOrders.partyId,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, id));
  if (
    order === undefined ||
    (order.status !== "settled" && !(await sentUnpaidCounterOrder(tx, cfg, id, order)))
  ) {
    throw new AppError("working_order.not_settled", { workingOrderId: id });
  }
  // Refused here, before the trigger that allows `collected_at` only NULL → non-null refuses it
  // as an opaque error.
  if (order.collectedAt !== null) {
    throw new AppError("working_order.already_collected", { workingOrderId: id });
  }
  // An order with no ticket items is on no station display to hand over.
  const [fired] = await tx
    .select({ id: ticketItems.id })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, id))
    .limit(1);
  if (fired === undefined) {
    throw new AppError("ticket.not_fired", { workingOrderId: id });
  }

  await tx
    .update(workingOrders)
    .set({ collectedAt: nowIso() })
    .where(and(eq(workingOrders.id, id), isNull(workingOrders.collectedAt)));
}

/** The service modes in which a counter order is sent to the kitchen before it is paid. */
const PAY_AFTER_SENDING: ReadonlySet<string> = new Set(["ticket_then_pay", "invoice_first"]);

async function sentUnpaidCounterOrder(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  order: { status: string; partyId: string | null },
): Promise<boolean> {
  if (order.status !== "placed" || order.partyId !== null) return false;
  const context = await VENUE_SERVICE.findOrderContext(tx, cfg, id);
  return paysAfterSending(context?.serviceMode, cfg);
}

/** An order with no frozen mode takes the venue's order flow. */
export function paysAfterSending(mode: string | undefined, cfg: TillConfig): boolean {
  return PAY_AFTER_SENDING.has(mode ?? cfg.orderFlow);
}

/** A counter order the counter is still waiting on: sent and not paid, or paid and not handed over. */
export interface CounterWaitingOrder {
  id: string;
  orderNumber: number;
  label: string | null;
  status: "placed" | "settled";
  openedAt: string;
  settledAt: string | null;
  /** When it was handed over; set on a placed order handed over before payment. */
  collectedAt: string | null;
  /** What collecting a placed order charges: the sale already issued for it, net of its credit
   * notes (`readIssuedSales`), else the sum of its lines. A settled order's is the sum of its lines. */
  total: string;
  /** {@link handOverOrder} would accept it now. */
  canHandOver: boolean;
  /** A placed order's frozen service mode, or `cfg.orderFlow` when it has none frozen; null on a
   * settled one. */
  serviceMode: ServiceMode | null;
  /** Only on a placed order whose invoice is issued: its number. */
  invoiceNumber?: string;
}

/**
 * The venue's counter orders (no party) that are `placed`, or `settled` with a kitchen ticket and no
 * handover, oldest first.
 */
export async function listCounterWaiting(
  deps: WorkingOrderDeps,
  cfg: TillConfig,
): Promise<CounterWaitingOrder[]> {
  return withTransaction(deps.db, async (tx) => {
    const firedOrders = tx.selectDistinct({ id: ticketItems.workingOrderId }).from(ticketItems);
    const rows = await tx
      .select({
        id: workingOrders.id,
        orderNumber: workingOrders.orderNumber,
        label: workingOrders.label,
        status: workingOrders.status,
        openedAt: workingOrders.openedAt,
        settledAt: workingOrders.settledAt,
        collectedAt: workingOrders.collectedAt,
        partyId: workingOrders.partyId,
        // Cast to text for `rawCentsToDecimal`; see its doc comment.
        total: sql<string>`cast(coalesce(sum(${workingOrderLines.lineTotal}), 0) as text)`,
        // The number 1 or 0: test its truthiness, never with `===`. Qualified, not bare, because
        // the query joins.
        fired: sql<number>`${workingOrders.id} in ${firedOrders}`,
      })
      .from(workingOrders)
      .leftJoin(workingOrderLines, eq(workingOrderLines.workingOrderId, workingOrders.id))
      .where(
        and(
          isNull(workingOrders.partyId),
          or(
            eq(workingOrders.status, "placed"),
            and(
              eq(workingOrders.status, "settled"),
              isNull(workingOrders.collectedAt),
              inArray(workingOrders.id, firedOrders),
            ),
          ),
        ),
      )
      .groupBy(workingOrders.id)
      .orderBy(workingOrders.openedAt, workingOrders.orderNumber);
    const placedIds = rows.filter((row) => row.status === "placed").map((row) => row.id);
    const modes = await VENUE_SERVICE.findOrderModes(tx, cfg, placedIds);
    const issued = await readIssuedSales(tx, placedIds);
    const numbers = await readInvoiceNumbers(
      tx,
      [...issued.values()].map((sale) => sale.saleId),
    );
    const waiting: CounterWaitingOrder[] = [];
    for (const row of rows) {
      const placed = row.status === "placed";
      const sale = issued.get(row.id);
      const eligible =
        Boolean(row.fired) &&
        row.collectedAt === null &&
        (!placed || paysAfterSending(modes.get(row.id), cfg));
      waiting.push({
        id: row.id,
        orderNumber: row.orderNumber,
        label: row.label,
        status: row.status as CounterWaitingOrder["status"],
        openedAt: row.openedAt,
        settledAt: row.settledAt,
        collectedAt: row.collectedAt,
        total: sale?.amountDue ?? rawCentsToDecimal(row.total),
        canHandOver: eligible,
        serviceMode: placed ? (modes.get(row.id) ?? cfg.orderFlow) : null,
        ...(sale === undefined ? {} : { invoiceNumber: numbers.get(sale.saleId)! }),
      });
    }
    return waiting;
  });
}

/** One unserved, fired line of an open tab, as `listTablesWithState`'s JSON aggregate emits it. */
interface UnservedLine {
  queuedAt: string;
  warmAfterMinutes: number;
  overdueAfterMinutes: number;
  forgottenAfterMinutes: number;
}

/**
 * The `tab_unserved_lines` aggregate, parsed.
 *
 * It arrives as JSON TEXT because `json_group_array` returns a string and a raw read reaches no
 * column mapping. An empty tab carries the literal `'[]'` the query coalesces to.
 */
function parseUnservedLines(value: string): UnservedLine[] {
  return JSON.parse(value) as UnservedLine[];
}

/**
 * Whole minutes from a stored ISO stamp to `nowMs`, floored. Callers read the clock ONCE per query,
 * so every row of one board is aged against one instant.
 */
function minutesSince(stamp: string, nowMs: number): number {
  return Math.floor((nowMs - Date.parse(stamp)) / 60_000);
}

export type { TicketState } from "./kitchen-print.js";

export type WorkingOrderStatus = (typeof workingOrderStatus.enumValues)[number];

/** The forward kitchen transitions, keyed by target state: the one legal predecessor and the column
 *  stamped. `queued` is not a target: a fire reaches it. */
const TICKET_TRANSITIONS = {
  preparing: { from: "queued", stampedAt: "preparingAt" },
  ready: { from: "preparing", stampedAt: "readyAt" },
} as const satisfies Record<
  Exclude<TicketState, "queued">,
  { from: TicketState; stampedAt: "preparingAt" | "readyAt" }
>;

/** A ternary, not a computed key: a computed key would widen the payload to a string index and lose
 *  Drizzle's typing against `ticket_items`. */
export function advanceSet(to: Exclude<TicketState, "queued">) {
  const at = nowIso();
  return TICKET_TRANSITIONS[to].stampedAt === "preparingAt"
    ? { state: to, preparingAt: at }
    : { state: to, readyAt: at };
}

/** Advance one fired ticket item one step. A held item is refused `ticket.item_held`. */
export async function advanceTicketItem(
  tx: Transaction,
  cfg: TillConfig,
  itemId: string,
  to: TicketState,
): Promise<void> {
  void cfg;
  // Own string keys only: `hasOwn` converts its key, so ["preparing"] would otherwise match, and an
  // inherited name such as "__proto__" is not a transition.
  if (typeof to !== "string" || !Object.hasOwn(TICKET_TRANSITIONS, to)) {
    throw new AppError("ticket.invalid_transition", { ticketItemId: itemId });
  }
  const validTo = to as Exclude<TicketState, "queued">;
  const transition = TICKET_TRANSITIONS[validTo];

  const updated = await tx
    .update(ticketItems)
    .set(advanceSet(validTo))
    .where(
      and(
        eq(ticketItems.id, itemId),
        eq(ticketItems.state, transition.from),
        isNotNull(ticketItems.firedAt),
      ),
    )
    .returning({ id: ticketItems.id });
  if (updated.length === 0) {
    const [item] = await tx
      .select({ firedAt: ticketItems.firedAt })
      .from(ticketItems)
      .where(eq(ticketItems.id, itemId));
    if (item !== undefined && item.firedAt === null) {
      throw new AppError("ticket.item_held", { ticketItemId: itemId });
    }
    throw new AppError("ticket.invalid_transition", { ticketItemId: itemId });
  }
}

/** Advance the fired items of one order at one station; held items are skipped. */
export async function advanceTicket(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  stationId: string,
  to: Exclude<TicketState, "queued">,
): Promise<void> {
  void cfg;
  await tx
    .update(ticketItems)
    .set(advanceSet(to))
    .where(
      and(
        eq(ticketItems.workingOrderId, orderId),
        eq(ticketItems.stationId, stationId),
        eq(ticketItems.state, TICKET_TRANSITIONS[to].from),
        isNotNull(ticketItems.firedAt),
      ),
    );
}

/** The LIVE course row an item's snapshotted `course_id` names. Not filtered by `active`, so a course
 *  deactivated after the item was fired still names its header. */
export interface StationQueueCourse {
  id: string;
  name: string;
  displayOrder: number;
}

/** A child without its own ticket item, shown beneath its dish. */
export interface QueueModifier {
  descriptions: Record<string, string>;
  /** The extra's OWN allergens, shown beside the dish's own, never folded into them. */
  addAllergens?: ProductAllergens | null;

  suitableFor?: string[] | null;
}

/** A line on another station's ticket that this item goes with. */
export interface QueueCrossRef {
  kind: "with" | "for";
  name: string;
  perDish?: number;
  stationName: string | null;
  addAllergens?: ProductAllergens | null;
  suitableFor?: string[] | null;
}

/** The seated party a queue card's bill belongs to, at the revision a pass command must send. */
export interface QueueParty {
  id: string;
  revision: number;
}

/** The group a queue item's dish was submitted in; absent for a bill of no party, or a line moved
 *  in from another party's bill or from a bill with no party. */
export interface QueueGroup {
  id: string;
  position: number;
  state: "held" | "fired";
}

export interface StationQueueItem {
  id: string;
  workingOrderLineId: string;
  state: TicketState;
  optionSnapshots?: OptionSnapshot[];
  /** The KITCHEN name, the same one the printed kitchen ticket carries. */
  name: string;
  quantity: string;
  unitName: Record<string, string> | null;
  unitPrecision: number | null;
  /** Counted in Each, whose unit the kitchen screen leaves out. */
  soldInEach: boolean;
  modifiers: QueueModifier[];
  crossRefs?: QueueCrossRef[];
  /** The dish's OWN allergens, no modifier contribution. `pending` when they are unreviewed. */
  asServed: { allergens: ProductAllergens; pending: boolean };
  asServedDiet?: DietProfile;
  course: StationQueueCourse | null;
  group?: QueueGroup;
  /** `null` while the item is HELD. */
  firedAt: string | null;
  /** Snapshotted at fire, so a later draft edit never changes what the kitchen already sees. */
  note: string | null;
  queuedAt: string;
  /** The age band at fetch time; the client re-ticks it locally afterwards. */
  band: TimingBand;
}

/** One item of the order at another station, shown in this station's card. */
export interface ElsewhereItem {
  id: string;
  name: string;
  quantity: string;
  unitName: Record<string, string> | null;
  unitPrecision: number | null;
  soldInEach: boolean;
  stationName: string;
  state: TicketState;
  held: boolean;
}

/** One order's lines at a station. `queuedAt` is its OLDEST line's. */
export interface StationQueueGroup {
  orderId: string;
  orderNumber: number;
  label: string | null;
  queuedAt: string;
  /** The station queue offers Collect on a `settled` order alone; a placed counter order is handed
   * over from the counter's waiting list. */
  status: WorkingOrderStatus;
  /** Absent for a bill of no party. */
  party?: QueueParty;
  /** Present only when one of this bill's tickets for the station was not printed after
   *  `JOBS_WAITING_MS`, or was given up on (`listPrintProblems`). */
  printProblem?: true;
  items: StationQueueItem[];
  /** Present only when this station shows the rest of the order: the order's items at other stations, possibly none. */
  elsewhere?: ElsewhereItem[];
  thresholds: StationThresholds;
}

/**
 * Queue lines' child modifiers and cross references, then each line's own allergens and diet.
 */
async function readQueueSubItems(
  tx: Transaction,
  lineIds: string[],
): Promise<{
  modifiersByParent: Map<string, QueueModifier[]>;
  crossRefsByLine: Map<string, QueueCrossRef[]>;
  asServedByParent: Map<
    string,
    {
      asServed: { allergens: ProductAllergens; pending: boolean };
      asServedDiet: DietProfile;
    }
  >;
}> {
  const modifiersByParent = new Map<string, QueueModifier[]>();
  const crossRefsByLine = new Map<string, QueueCrossRef[]>();
  const asServedByParent = new Map<
    string,
    {
      asServed: { allergens: ProductAllergens; pending: boolean };
      asServedDiet: DietProfile;
    }
  >();
  if (lineIds.length === 0) return { modifiersByParent, crossRefsByLine, asServedByParent };

  const parentQuantities = new Map(
    (
      await tx
        .select({ id: workingOrderLines.id, quantity: workingOrderLines.quantity })
        .from(workingOrderLines)
        .where(inArray(workingOrderLines.id, lineIds))
    ).map((line) => [line.id, line.quantity]),
  );

  const childTicket = alias(ticketItems, "queue_child_ticket");
  const childStation = alias(kitchenStations, "queue_child_station");

  // LEFT join, so a child whose product row has gone still renders its frozen text.
  const childRows = await tx
    .select({
      parentLineId: workingOrderLines.parentLineId,
      descriptions: workingOrderLines.descriptions,
      name: workingOrderLines.name,
      kitchenName: workingOrderLines.kitchenName,
      variantName: workingOrderLines.variantName,
      variantKitchenName: workingOrderLines.variantKitchenName,
      quantity: workingOrderLines.quantity,
      stationName: childStation.name,
      ticketId: childTicket.id,
      addAllergens: effectiveProductColumns.allergens,
      dietaryDeclarations: effectiveProductColumns.dietaryDeclarations,
    })
    .from(workingOrderLines)
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(parentProducts, parentJoin)
    .leftJoin(childTicket, eq(childTicket.workingOrderLineId, workingOrderLines.id))
    .leftJoin(childStation, eq(childStation.id, childTicket.stationId))
    .where(inArray(workingOrderLines.parentLineId, lineIds))
    .orderBy(workingOrderLines.lineNo);
  for (const child of childRows) {
    if (child.ticketId !== null) {
      const refs = crossRefsByLine.get(child.parentLineId!) ?? [];
      refs.push({
        kind: "with",
        name: kitchenPresentationName(child),
        perDish: perDishOptionQuantity(
          thousandthsToDecimal(child.quantity),
          thousandthsToDecimal(parentQuantities.get(child.parentLineId!)!),
        ),
        stationName: child.stationName,
        addAllergens: (child.addAllergens as ProductAllergens | null) ?? null,
        suitableFor: expandDietaryDeclarations(child.dietaryDeclarations as DietaryLabel[]),
      });
      crossRefsByLine.set(child.parentLineId!, refs);
      continue;
    }
    const mods = modifiersByParent.get(child.parentLineId!) ?? [];
    mods.push({
      descriptions: child.descriptions,
      addAllergens: (child.addAllergens as ProductAllergens | null) ?? null,
      suitableFor: expandDietaryDeclarations(child.dietaryDeclarations as DietaryLabel[]),
    });
    modifiersByParent.set(child.parentLineId!, mods);
  }

  const parents = await tx
    .select({
      lineId: workingOrderLines.id,
      allergens: effectiveProductColumns.allergens,
      dietaryDeclarations: effectiveProductColumns.dietaryDeclarations,
    })
    .from(workingOrderLines)
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(parentProducts, parentJoin)
    .where(inArray(workingOrderLines.id, lineIds));
  for (const p of parents) {
    const allergens = (p.allergens ?? {}) as ProductAllergens;
    const expanded = expandDietaryDeclarations(p.dietaryDeclarations as DietaryLabel[]);
    const asServedDiet: DietProfile = {
      vegan: expanded.includes("vegan") ? "yes" : "unknown",
      vegetarian: expanded.includes("vegetarian") ? "yes" : "unknown",
      contains: [],
      ...(expanded.includes("halal") ? { halal: "yes" as const } : {}),
      ...(expanded.includes("kosher") ? { kosher: "yes" as const } : {}),
    };
    asServedByParent.set(p.lineId, {
      asServed: { allergens, pending: p.allergens == null },
      asServedDiet,
    });
  }
  const dish = alias(workingOrderLines, "queue_dish_line");
  const dishTicket = alias(ticketItems, "queue_dish_ticket");
  const dishStation = alias(kitchenStations, "queue_dish_station");
  const extraRows = await tx
    .select({
      lineId: workingOrderLines.id,
      name: dish.name,
      kitchenName: dish.kitchenName,
      variantName: dish.variantName,
      variantKitchenName: dish.variantKitchenName,
      stationName: dishStation.name,
    })
    .from(workingOrderLines)
    .innerJoin(dish, eq(dish.id, workingOrderLines.parentLineId))
    .leftJoin(dishTicket, eq(dishTicket.workingOrderLineId, dish.id))
    .leftJoin(dishStation, eq(dishStation.id, dishTicket.stationId))
    .where(inArray(workingOrderLines.id, lineIds));
  for (const extra of extraRows) {
    crossRefsByLine.set(extra.lineId, [
      {
        kind: "for",
        name: kitchenPresentationName(extra),
        stationName: extra.stationName,
      },
    ]);
  }
  return { modifiersByParent, crossRefsByLine, asServedByParent };
}

const queueGroupColumns = {
  partyId: parties.id,
  partyRevision: parties.revision,
  groupId: orderGroups.id,
  groupPosition: orderGroups.position,
  groupState: orderGroups.state,
};

function queueParty(row: {
  partyId: string | null;
  partyRevision: number | null;
}): QueueParty | undefined {
  return row.partyId === null ? undefined : { id: row.partyId, revision: row.partyRevision! };
}

function queueGroup(row: {
  groupId: string | null;
  groupPosition: number | null;
  groupState: string | null;
}): QueueGroup | undefined {
  return row.groupId === null
    ? undefined
    : {
        id: row.groupId,
        position: row.groupPosition!,
        state: row.groupState as QueueGroup["state"],
      };
}

/** `{ [key]: value }`, or nothing when there is no value: a queue leaves an absent party or group out. */
function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

/**
 * The venue's ticket items at one station, grouped by order, oldest first. An abandoned or collected
 * order drops out; printable kitchen items are not filtered by state, so a `ready` line stays until its order collects.
 * Items made at the till are absent from the station queue.
 * When the station shows the rest of the order, each card also carries its unserved items at other stations.
 */
export async function listStationQueue(
  tx: Transaction,
  stationId: string,
): Promise<StationQueueGroup[]> {
  const rows = await tx
    .select({
      itemId: ticketItems.id,
      workingOrderLineId: ticketItems.workingOrderLineId,
      state: ticketItems.state,
      queuedAt: ticketItems.queuedAt,
      // Customer-facing text is deliberately not read: a cook reads the kitchen name.
      name: workingOrderLines.name,
      kitchenName: workingOrderLines.kitchenName,
      variantName: workingOrderLines.variantName,
      variantKitchenName: workingOrderLines.variantKitchenName,
      optionSnapshots: workingOrderLines.optionSnapshots,
      quantity: firedQuantity,
      unitName: workingOrderLines.unitName,
      unitPrecision: workingOrderLines.unitPrecision,
      lineNo: workingOrderLines.lineNo,
      courseId: ticketItems.courseId,
      courseName: kitchenCourses.name,
      courseDisplayOrder: kitchenCourses.displayOrder,
      firedAt: ticketItems.firedAt,
      // The fire-time snapshot, not the live line.
      note: ticketItems.note,
      orderId: workingOrders.id,
      orderNumber: workingOrders.orderNumber,
      label: workingOrders.label,
      status: workingOrders.status,
      ...queueGroupColumns,
      warmAfterMinutes: kitchenStations.warmAfterMinutes,
      overdueAfterMinutes: kitchenStations.overdueAfterMinutes,
      forgottenAfterMinutes: kitchenStations.forgottenAfterMinutes,
      showsRestOfOrder: kitchenStations.showsRestOfOrder,
    })
    .from(ticketItems)
    .innerJoin(workingOrders, eq(ticketItems.workingOrderId, workingOrders.id))
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .innerJoin(kitchenStations, eq(ticketItems.stationId, kitchenStations.id))
    // Not filtered by `active`: a course deactivated after the item was fired still names its header.
    .leftJoin(kitchenCourses, eq(ticketItems.courseId, kitchenCourses.id))
    .leftJoin(parties, eq(parties.id, workingOrders.partyId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(
      and(
        eq(ticketItems.stationId, stationId),
        eq(ticketItems.madeHere, false),
        ne(workingOrders.status, "abandoned"),
        isNull(workingOrders.collectedAt),
      ),
    )
    // `line_no` breaks the tie between lines fired together with an identical `queued_at`.
    .orderBy(ticketItems.queuedAt, workingOrderLines.lineNo);

  const { modifiersByParent, crossRefsByLine, asServedByParent } = await readQueueSubItems(
    tx,
    rows.map((row) => row.workingOrderLineId),
  );
  const soldInEach = await VENUE_SERVICE.readLinesSoldInEach(
    tx,
    rows.map((row) => row.workingOrderLineId),
  );

  const orderIds = [...new Set(rows.map((row) => row.orderId))];
  const showsRestOfOrder = rows[0]?.showsRestOfOrder ?? false;
  const rest: Map<string, RestOfOrderItem[]> = showsRestOfOrder
    ? await readRestOfOrder(tx, orderIds)
    : new Map();
  const restSoldInEach = showsRestOfOrder
    ? await VENUE_SERVICE.readLinesSoldInEach(
        tx,
        [...rest.values()].flatMap((items) => items.map((item) => item.workingOrderLineId)),
      )
    : new Set<string>();

  const nowMs = Date.now();
  const printProblems = await ordersWithPrintProblem(tx, stationId, orderIds, new Date(nowMs));
  // The Map keeps insertion order, so groups come out oldest-first.
  const groups = new Map<string, StationQueueGroup>();
  for (const row of rows) {
    const thresholds: StationThresholds = {
      warmAfterMinutes: row.warmAfterMinutes,
      overdueAfterMinutes: row.overdueAfterMinutes,
      forgottenAfterMinutes: row.forgottenAfterMinutes,
    };
    let group = groups.get(row.orderId);
    if (group === undefined) {
      group = {
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        label: row.label,
        queuedAt: row.queuedAt,
        status: row.status,
        ...optional("party", queueParty(row)),
        ...optional("printProblem", printProblems.has(row.orderId) ? true : undefined),
        items: [],
        ...optional(
          "elsewhere",
          showsRestOfOrder
            ? (rest.get(row.orderId) ?? [])
                .filter((item) => item.stationId !== stationId)
                .map((item) => ({
                  id: item.ticketItemId,
                  name: item.name,
                  quantity: item.quantity,
                  unitName: item.unitName,
                  unitPrecision: item.unitPrecision,
                  soldInEach: restSoldInEach.has(item.workingOrderLineId),
                  stationName: item.stationName,
                  state: item.state,
                  held: item.held,
                }))
            : undefined,
        ),
        thresholds,
      };
      groups.set(row.orderId, group);
    }
    group.items.push({
      id: row.itemId,
      workingOrderLineId: row.workingOrderLineId,
      state: row.state,
      name: kitchenPresentationName(row),
      optionSnapshots: row.optionSnapshots,
      quantity: thousandthsToDecimal(row.quantity),
      unitName: row.unitName,
      unitPrecision: row.unitPrecision,
      soldInEach: soldInEach.has(row.workingOrderLineId),
      modifiers: modifiersByParent.get(row.workingOrderLineId) ?? [],
      ...optional("crossRefs", crossRefsByLine.get(row.workingOrderLineId)),
      asServed: asServedByParent.get(row.workingOrderLineId)?.asServed ?? {
        allergens: {},
        pending: true,
      },
      asServedDiet: asServedByParent.get(row.workingOrderLineId)?.asServedDiet ?? {
        vegan: "unknown",
        vegetarian: "unknown",
        contains: [],
      },
      // A non-null `course_id` always matches a `kitchen_courses` row: the foreign key guarantees it.
      course:
        row.courseId === null
          ? null
          : { id: row.courseId, name: row.courseName!, displayOrder: row.courseDisplayOrder! },
      ...optional("group", queueGroup(row)),
      firedAt: row.firedAt,
      note: row.note,
      queuedAt: row.queuedAt,
      // Rounded to the whole minute first: what the bands were tuned against.
      band: classifyBand(nowMs - minutesSince(row.queuedAt, nowMs) * 60_000, nowMs, thresholds),
    });
  }
  return [...groups.values()];
}

/** One item on the cross-station expo board. */
export interface ExpoItem {
  optionSnapshots?: OptionSnapshot[];
  id: string;
  /** The same KITCHEN name the stations read. */
  name: string;
  qty: string;
  unitName: Record<string, string> | null;
  unitPrecision: number | null;
  /** Counted in Each, whose unit the expo board leaves out. */
  soldInEach: boolean;
  stationName: string;
  state: TicketState;
  firedAt: string | null;
  awayAt: string | null;
  note: string | null;
  modifiers: QueueModifier[];
  crossRefs?: QueueCrossRef[];
  asServed: { allergens: ProductAllergens; pending: boolean };
  asServedDiet?: DietProfile;
  queuedAt: string;
  group?: QueueGroup;
  /** This item's OWN station's order-timing thresholds — per item, not per order, because one order's
   *  items can span several stations each with different thresholds. */
  thresholds: StationThresholds;
  band: TimingBand;
}

/** One course of an expo order; the null course sorts earliest. `fired` and `away` are true only once
 *  EVERY item of the course carries that stamp. */
export interface ExpoCourse {
  courseId: string | null;
  courseName: string | null;
  displayOrder: number | null;
  fired: boolean;
  away: boolean;
  items: ExpoItem[];
}

/** One group of a seated party's bill on the expo board; the section of lines with no group has
 *  every group field `null` and sorts first. `fired` and `away` roll up as {@link ExpoCourse}'s do. */
export interface ExpoGroup {
  groupId: string | null;
  position: number | null;
  state: QueueGroup["state"] | null;
  fired: boolean;
  away: boolean;
  items: ExpoItem[];
}

/** One order on the cross-station expo board. `tableLabel` is absent for an unlabelled walk-up. A
 *  seated party's bill is sectioned by `groups` and has no `courses`; any other bill the reverse. */
export interface ExpoOrder {
  orderId: string;
  tableLabel?: string;
  orderNumber: number;
  openedMinutes: number;
  party?: QueueParty;
  courses: ExpoCourse[];
  groups: ExpoGroup[];
  /** The worst age band over the UNSERVED lines: a served line has reached the guest. */
  worstBand: TimingBand;
}

/**
 * The cross-station expo read: every order in the venue that is not abandoned, not collected, and
 * has at least one kitchen item not yet away (open, placed and settled orders alike), its kitchen items gathered
 * across all stations and sectioned by group in position order for a seated party's bill, by course
 * for any other. A surviving order carries all its kitchen items, away ones included, so a per-section `away`
 * flag can be rolled up. `locationId` scopes only the table found for an order of no party.
 */
export async function listExpoQueue(
  tx: Transaction,
  cfg: TillConfig,
  locationId?: string,
): Promise<ExpoOrder[]> {
  const loc = locationId ?? cfg.locationId;
  return readPassBoard(
    tx,
    loc,
    sql`exists (
      select 1 from ${ticketItems} tix
      where tix.working_order_id = ${workingOrders.id}
        and tix.made_here = 0
        and tix.away_at is null)`,
  );
}

/** Build every section of the selected pass orders before a watcher narrows their items. */
export async function readPassBoard(
  tx: Transaction,
  locationId: string,
  scope: SQL,
): Promise<ExpoOrder[]> {
  const rows = await tx
    .select({
      itemId: ticketItems.id,
      lineId: ticketItems.workingOrderLineId,
      state: ticketItems.state,
      firedAt: ticketItems.firedAt,
      awayAt: ticketItems.awayAt,
      note: ticketItems.note,
      name: workingOrderLines.name,
      kitchenName: workingOrderLines.kitchenName,
      variantName: workingOrderLines.variantName,
      variantKitchenName: workingOrderLines.variantKitchenName,
      optionSnapshots: workingOrderLines.optionSnapshots,
      quantity: firedQuantity,
      unitName: workingOrderLines.unitName,
      unitPrecision: workingOrderLines.unitPrecision,
      lineNo: workingOrderLines.lineNo,
      // Not exposed; read only to leave a served line out of `worstBand`.
      servedAt: workingOrderLines.servedAt,
      stationName: kitchenStations.name,
      // Per item, not per order: one order's items can span stations with different thresholds.
      queuedAt: ticketItems.queuedAt,
      warmAfterMinutes: kitchenStations.warmAfterMinutes,
      overdueAfterMinutes: kitchenStations.overdueAfterMinutes,
      forgottenAfterMinutes: kitchenStations.forgottenAfterMinutes,
      courseId: ticketItems.courseId,
      courseName: kitchenCourses.name,
      courseDisplayOrder: kitchenCourses.displayOrder,
      orderId: workingOrders.id,
      orderNumber: workingOrders.orderNumber,
      openedAt: workingOrders.openedAt,
      ...queueGroupColumns,
      groupCreatedAt: orderGroups.createdAt,
      // Not exposed; read only to name the order's table (`orderTableLabels`).
      deliveryTableId: workingOrders.deliveryTableId,
      label: workingOrders.label,
    })
    .from(ticketItems)
    .innerJoin(workingOrders, eq(ticketItems.workingOrderId, workingOrders.id))
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .innerJoin(kitchenStations, eq(ticketItems.stationId, kitchenStations.id))
    // Not filtered by `active`, as in `listStationQueue`.
    .leftJoin(kitchenCourses, eq(ticketItems.courseId, kitchenCourses.id))
    .leftJoin(parties, eq(parties.id, workingOrders.partyId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(
      and(
        eq(ticketItems.madeHere, false),
        ne(workingOrders.status, "abandoned"),
        isNull(workingOrders.collectedAt),
        scope,
      ),
    )
    .orderBy(
      workingOrders.openedAt,
      sql`${kitchenCourses.displayOrder} asc nulls first`,
      workingOrderLines.lineNo,
      ticketItems.id,
    );

  const { modifiersByParent, crossRefsByLine, asServedByParent } = await readQueueSubItems(
    tx,
    rows.map((row) => row.lineId),
  );
  const soldInEach = await VENUE_SERVICE.readLinesSoldInEach(
    tx,
    rows.map((row) => row.lineId),
  );
  const tableLabels = await orderTableLabels(
    tx,
    locationId,
    [...new Map(rows.map((row) => [row.orderId, row])).values()].map((row) => ({
      id: row.orderId,
      partyId: row.partyId,
      deliveryTableId: row.deliveryTableId,
      label: row.label,
    })),
  );

  const nowMs = Date.now();
  // Maps keep insertion order, so the SQL order survives the grouping.
  const orders = new Map<string, ExpoOrder>();
  const sectionMaps = new Map<string, Map<string, ExpoCourse | ExpoGroup>>();
  const groupCreatedAt = new Map<string, string>();
  for (const row of rows) {
    if (row.groupId !== null) groupCreatedAt.set(row.groupId, row.groupCreatedAt!);
    let order = orders.get(row.orderId);
    if (order === undefined) {
      order = {
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        openedMinutes: minutesSince(row.openedAt, nowMs),
        ...optional("party", queueParty(row)),
        courses: [],
        groups: [],
        ...optional("tableLabel", tableLabels.get(row.orderId) ?? undefined),
        worstBand: "fresh",
      };
      orders.set(row.orderId, order);
      sectionMaps.set(row.orderId, new Map());
    }
    const sections = sectionMaps.get(row.orderId)!;
    const group = queueGroup(row);
    const byGroup = order.party !== undefined;
    const sectionKey = (byGroup ? group?.id : row.courseId) ?? "__none__";
    let section = sections.get(sectionKey);
    if (section === undefined) {
      if (byGroup) {
        const expoGroup: ExpoGroup = {
          groupId: group?.id ?? null,
          position: group?.position ?? null,
          state: group?.state ?? null,
          fired: true,
          away: true,
          items: [],
        };
        order.groups.push(expoGroup);
        section = expoGroup;
      } else {
        const course: ExpoCourse = {
          courseId: row.courseId,
          courseName: row.courseId === null ? null : row.courseName!,
          displayOrder: row.courseId === null ? null : row.courseDisplayOrder!,
          fired: true,
          away: true,
          items: [],
        };
        order.courses.push(course);
        section = course;
      }
      sections.set(sectionKey, section);
    }
    const thresholds: StationThresholds = {
      warmAfterMinutes: row.warmAfterMinutes,
      overdueAfterMinutes: row.overdueAfterMinutes,
      forgottenAfterMinutes: row.forgottenAfterMinutes,
    };
    // Rounded to the whole minute first, as in `listStationQueue`.
    const band = classifyBand(
      nowMs - minutesSince(row.queuedAt, nowMs) * 60_000,
      nowMs,
      thresholds,
    );
    section.items.push({
      id: row.itemId,
      name: kitchenPresentationName(row),
      optionSnapshots: row.optionSnapshots,
      qty: thousandthsToDecimal(row.quantity),
      unitName: row.unitName,
      unitPrecision: row.unitPrecision,
      soldInEach: soldInEach.has(row.lineId),
      stationName: row.stationName,
      state: row.state,
      firedAt: row.firedAt,
      awayAt: row.awayAt,
      note: row.note,
      modifiers: modifiersByParent.get(row.lineId) ?? [],
      ...optional("crossRefs", crossRefsByLine.get(row.lineId)),
      asServed: asServedByParent.get(row.lineId)?.asServed ?? {
        allergens: {},
        pending: true,
      },
      asServedDiet: asServedByParent.get(row.lineId)?.asServedDiet ?? {
        vegan: "unknown",
        vegetarian: "unknown",
        contains: [],
      },
      queuedAt: row.queuedAt,
      ...optional("group", group),
      thresholds,
      band,
    });
    if (row.firedAt === null) section.fired = false;
    if (row.awayAt === null) section.away = false;
    if (row.servedAt === null) order.worstBand = worstBand([order.worstBand, band]);
  }
  for (const order of orders.values()) {
    const made = (group: ExpoGroup) =>
      group.groupId === null ? "" : groupCreatedAt.get(group.groupId)!;
    order.groups.sort(
      (a, b) =>
        (a.position ?? 0) - (b.position ?? 0) ||
        made(a).localeCompare(made(b)) ||
        (a.groupId ?? "").localeCompare(b.groupId ?? ""),
    );
  }
  return [...orders.values()];
}

/** The seated party a table belongs to, as the floor shows it. */
export interface TableParty {
  id: string;
  revision: number;
  guestCount: number | null;
  state: "open" | "closed";
  /** The name staff gave the party, or null. */
  name: string | null;
  /** `name`, or else the party's tables' labels ({@link partyDisplayName}). */
  displayName: string;
  /** The bill an order that names none goes on; null until the party's next order makes one. */
  mainBillId: string | null;
  /** What the party's bills, and those of every party merged into it, still owe. */
  outstanding: string;
  /** The party's bills that are not abandoned, merged parties' included. */
  billCount: number;
  /** Every table the party sits at, in the order they joined it. */
  tableIds: string[];
  /** Each open draft on the party holding a line, oldest first. */
  unsentDrafts: UnsentDraft[];
  /**
   * The held group waiting to be released and when it is due; null with no held group, with
   * reminders off, or once the party is no longer open.
   */
  reminder: ReleaseReminder | null;
}

/** Whether a party holds the table, it waits to be cleared, or it is free. */
export type TableCondition = "free" | "held" | "needs_clearing";

/** Held while a party holds the table, whatever its clearing state; else as its clearing state says. */
export function tableCondition(row: {
  held: boolean;
  needsClearingSince: string | null;
}): TableCondition {
  if (row.held) return "held";
  return row.needsClearingSince === null ? "free" : "needs_clearing";
}

/** One row of the occupancy read-model. */
export interface TableState {
  id: string;
  label: string;
  zoneId: string | null;
  capacity: number | null;
  /** `open-tab` while a party holds the table, whether or not it has a bill still open. */
  state: "free" | "open-tab" | "delivery-pending";
  /** The party holding the table has an open bill. */
  hasOpenTab: boolean;
  condition: TableCondition;
  /** The lines on the party's open bills; present with `hasOpenTab`. */
  tabLineCount?: number;
  /** The GROSS draft total of the party's open bills; present with `hasOpenTab`. */
  tabTotal?: string;
  pendingDeliveries: number;
  /**
   * The unserved lines of every bill of the party's family that is not abandoned, paid ones
   * included, whatever their kitchen state.
   */
  pendingToServe: number;
  /** Those unserved lines whose ticket item is `ready`. */
  readyToServe: number;
  /** Those unserved lines the pass has sent away. Such a line counts in `readyToServe` too. */
  enRoute: number;
  /** The worst age band over those unserved lines; a counter delivery does not feed it. */
  timingBand: TimingBand;
  /** The MANUAL service status, independent of occupancy: a `free` table may carry one. */
  status: { id: string; label: string; color: string } | null;
  /** Floor-plan placement, `null` when unplaced. */
  posX: number | null;
  posY: number | null;
  shape: FloorTableShape | null;
  rotation: number | null;
  /** Merged from the enabled modules' floor annotators; `null` when none annotates the table. */
  nextReservation: { time: string } | null;
  party: TableParty | null;
  /** What wants attention at the table: its party's signals, then its own clearing. */
  signals: TableSignal[];
}

/**
 * Read the location's active tables with their occupancy. Every table a party holds shows that
 * party's bills: the open ones for its line count and total, and for the dishes still to serve every
 * bill of its family that is not abandoned, since a paid or presented bill's dishes are still
 * carried to the table. A party takes precedence over a delivery. A pending delivery has kitchen
 * items and is neither collected nor abandoned. Made-here items count as bill lines but do not
 * contribute kitchen readiness, delivery presence or kitchen waiting time.
 */
export async function listTablesWithState(
  tx: Transaction,
  cfg: TillConfig,
  annotators: readonly FloorAnnotator[] = [],
  locationId?: string,
  now: Date = new Date(),
): Promise<TableState[]> {
  const loc = locationId ?? cfg.locationId;
  const result = await tx.execute<{
    id: string;
    label: string;
    zone_id: string | null;
    capacity: number | null;
    open_bills: number;
    tab_line_count: number;
    tab_total: string | null;
    pending_to_serve: number;
    ready_to_serve: number;
    en_route: number;
    // Classified in JS, never in SQL, so server and client share one classifier.
    tab_unserved_lines: string;
    pending_deliveries: number;
    status_id: string | null;
    status_label: string | null;
    status_color: string | null;
    pos_x: number | null;
    pos_y: number | null;
    shape: FloorTableShape | null;
    rotation: number | null;
    needs_clearing_since: string | null;
  }>(sql`
    -- Each seated party and every party merged into it: a bill a merged-in party kept still has its
    -- dishes carried to the table.
    with recursive family(root, id) as (
      select party_id, party_id from party_tables where left_at is null
      union
      select f.root, p.id from parties p join family f on p.merged_into_party_id = f.id
    )
    select
      dt.id, dt.label, dt.zone_id, dt.capacity,
      dt.pos_x, dt.pos_y, dt.shape, dt.rotation, dt.needs_clearing_since,
      cast(coalesce(tab.open_bills, 0) as int) as open_bills,
      cast(coalesce(tab.line_count, 0) as int) as tab_line_count,
      tab.tab_total,
      cast(coalesce(tab.pending_to_serve, 0) as int) as pending_to_serve,
      cast(coalesce(tab.ready_to_serve, 0) as int) as ready_to_serve,
      cast(coalesce(tab.en_route, 0) as int) as en_route,
      coalesce(tab.unserved_lines, '[]') as tab_unserved_lines,
      cast(coalesce(del.pending, 0) as int) as pending_deliveries,
      tss.id as status_id, tss.label as status_label, tss.color as status_color
    from dining_tables dt
    -- A GROUPED derived table joined on the table id, not a LEFT JOIN LATERAL ... ON TRUE: this
    -- engine has no LATERAL and refuses it at prepare with near "select": syntax error (measured
    -- 2026-09-22 on Node v26.7.0). The only correlation is the table's id, reached through its
    -- active membership, which is an ordinary join key, so every held table's bills are aggregated
    -- once and matched by id.
    left join (
      select pt.table_id,
             cast(count(distinct wo.id) filter (where wo.status = 'open') as int) as open_bills,
             cast(count(wol.id) filter (where wo.status = 'open') as int) as line_count,
             cast(count(wol.id) filter (where wol.served_at is null) as int) as pending_to_serve,
             -- KDS-1 section 3d "N listos": lines the kitchen has bumped ready but the waiter has not
             -- yet carried out (served_at is null). The ticket item is joined 1:1 on the line -- its
             -- (working_order_line_id) UNIQUE gives at most one ti per wol, so this LEFT JOIN
             -- neither multiplies wol rows (line_count / tab_total stay correct) nor double-counts. An
             -- unfired, made-here or not-yet-ready line has ti.state null or != 'ready' and is excluded by the filter.
             cast(count(*) filter (where ti.state = 'ready' and wol.served_at is null) as int) as ready_to_serve,
             -- KDS-3 section 3c "en camino": lines the pass has DISPATCHED (ti.away_at is not null, set by
             -- markCourseAway) that the waiter has not yet carried out (served_at is null). Same 1:1
             -- ti-on-line join as ready_to_serve, so no wol multiplication; an away item is still ready
             -- and unserved, so it counts here AND in ready_to_serve until served -- the client applies the
             -- en-camino > listos precedence off the two counts.
             cast(count(*) filter (where ti.away_at is not null and wol.served_at is null) as int) as en_route,
             -- A count of whole cents read raw, cast to text and converted by rawCentsToDecimal in
             -- the mapping below -- see its doc comment for why it is text and not an integer cast.
             cast(coalesce(sum(wol.line_total) filter (where wo.status = 'open'), 0) as text) as tab_total,
             -- KDS order-timing alerts (design §3/§6): the queued_at + thresholds of each unserved
             -- kitchen line with a ticket item (ti.id is not null), a HELD one included, one JSON object per
             -- line -- never a band label (§3's raw-material-in-SQL, classified-in-JS split), reduced
             -- with classifyBand/worstBand in JS below. A line never sent has no ticket_items row and
             -- is excluded, same as a served one.
             --
             -- json_group_array returns JSON TEXT rather than a value the driver parses, so the
             -- row mapping parses it.
             json_group_array(
               json_object(
                 'queuedAt', ti.queued_at,
                 'warmAfterMinutes', ks.warm_after_minutes,
                 'overdueAfterMinutes', ks.overdue_after_minutes,
                 'forgottenAfterMinutes', ks.forgotten_after_minutes
               )
             ) filter (where wol.served_at is null and ti.id is not null) as unserved_lines
      from party_tables pt
      join family f on f.root = pt.party_id
      join working_orders wo
        on wo.party_id = f.id and wo.status <> 'abandoned'
      left join working_order_lines wol
        on wol.working_order_id = wo.id
      left join ticket_items ti
        on ti.working_order_line_id = wol.id and ti.made_here = 0
      -- The unserved line's OWN station thresholds, for the JSON aggregate above. LEFT (not INNER): a row
      -- with no ticket item (ti null) must survive so line_count/tab_total/the other aggregates above
      -- are unaffected by this join — such a row is excluded from unserved_lines by the FILTER instead.
      left join kitchen_stations ks
        on ks.id = ti.station_id
      where pt.left_at is null
      group by pt.table_id
    ) tab on tab.table_id = dt.id
    -- The delivery count, grouped the same way: the LATERAL form's correlation was
    -- d.delivery_table_id = dt.id, so it becomes the join key. A NULL delivery_table_id groups
    -- to a row nothing joins to, which is the LATERAL form's no-rows answer.
    left join (
      select d.delivery_table_id, cast(count(*) as int) as pending
      from working_orders d
      where d.status <> 'abandoned' and d.collected_at is null
        and exists (
          select 1 from ticket_items ti
          where ti.working_order_id = d.id
            and ti.made_here = 0
        )
      group by d.delivery_table_id
    ) del on del.delivery_table_id = dt.id
    left join table_service_statuses tss
      on tss.id = dt.status_id
    where dt.location_id = ${loc} and dt.active = true
    order by dt.label
  `);

  const { seated, facts } = await readSeatedParties(tx, loc);
  // Not the `now` parameter, which is the VENUE clock the annotators take and a caller may supply.
  const nowMs = Date.now();
  const partySignals = await readPartySignals(tx, [...new Set(seated.values())], facts, nowMs);

  const states = result.rows.map((r) => {
    const hasOpenTab = Number(r.open_bills) > 0;
    const party = seated.get(r.id);
    const pendingDeliveries = Number(r.pending_deliveries);
    const state: TableState["state"] =
      party !== undefined ? "open-tab" : pendingDeliveries > 0 ? "delivery-pending" : "free";
    const timingBand = worstBand(
      parseUnservedLines(r.tab_unserved_lines).map((line) =>
        classifyBand(nowMs - minutesSince(line.queuedAt, nowMs) * 60_000, nowMs, {
          warmAfterMinutes: line.warmAfterMinutes,
          overdueAfterMinutes: line.overdueAfterMinutes,
          forgottenAfterMinutes: line.forgottenAfterMinutes,
        }),
      ),
    );
    return {
      id: r.id,
      label: r.label,
      zoneId: r.zone_id,
      capacity: r.capacity,
      state,
      hasOpenTab,
      condition: tableCondition({
        held: party !== undefined,
        needsClearingSince: r.needs_clearing_since,
      }),
      pendingToServe: Number(r.pending_to_serve),
      readyToServe: Number(r.ready_to_serve),
      enRoute: Number(r.en_route),
      timingBand,
      pendingDeliveries,
      status:
        r.status_id !== null
          ? { id: r.status_id, label: r.status_label!, color: r.status_color! }
          : null,
      posX: r.pos_x,
      posY: r.pos_y,
      shape: r.shape,
      rotation: r.rotation,
      nextReservation: null as { time: string } | null,
      party: party ?? null,
      signals: tableSignals(
        party === undefined ? undefined : partySignals.get(party.id),
        r.needs_clearing_since,
      ),
      ...(hasOpenTab
        ? {
            tabLineCount: Number(r.tab_line_count),
            tabTotal: rawCentsToDecimal(r.tab_total!),
          }
        : {}),
    };
  });

  if (annotators.length > 0) {
    const tableIds = states.map((s) => s.id);
    const annCfg = { locationId: brandLocationId(loc) };
    for (const annotator of annotators) {
      const annotations = await annotator.annotate(tx, annCfg, now, tableIds);
      for (const s of states) {
        const reserved = annotations.get(s.id)?.reservedTime ?? null;
        if (reserved !== null) s.nextReservation = { time: reserved };
      }
    }
  }
  return states;
}

/**
 * Each table of the location a party holds, with the party, and what else was read of each party,
 * keyed by party.
 */
async function readSeatedParties(
  tx: Transaction,
  locationId: string,
): Promise<{ seated: Map<string, TableParty>; facts: Map<string, SeatedPartyFacts> }> {
  const members = await tx
    .select({
      tableId: partyTables.tableId,
      partyId: parties.id,
      revision: parties.revision,
      guestCount: parties.guestCount,
      state: parties.state,
      name: parties.name,
      mainBillId: parties.mainBillId,
      billRequestedAt: parties.billRequestedAt,
    })
    .from(partyTables)
    .innerJoin(parties, eq(parties.id, partyTables.partyId))
    .innerJoin(diningTables, eq(diningTables.id, partyTables.tableId))
    .where(and(isNull(partyTables.leftAt), eq(diningTables.locationId, locationId)))
    .orderBy(partyTables.joinedAt, partyTables.id);
  const partyIds = [...new Set(members.map((member) => member.partyId))];
  const labels = await partyTableLabels(tx, partyIds);
  const bills = await readBillsOfParties(tx, partyIds);
  const unsentDrafts = await readUnsentDrafts(tx, partyIds);
  const reminders = await readReleaseReminders(tx, partyIds);
  const partyOf = new Map<string, TableParty>();
  const facts = new Map<string, SeatedPartyFacts>();
  for (const member of members) {
    const known = partyOf.get(member.partyId);
    if (known !== undefined) {
      known.tableIds.push(member.tableId);
      continue;
    }
    const own = bills.get(member.partyId)!;
    facts.set(member.partyId, { bills: own, billRequestedAt: member.billRequestedAt });
    partyOf.set(member.partyId, {
      id: member.partyId,
      revision: member.revision,
      guestCount: member.guestCount,
      state: member.state,
      name: member.name,
      displayName: partyDisplayName(member.name, labels.get(member.partyId)!),
      mainBillId: member.mainBillId,
      outstanding: toScale(sumDecimals(own.map((bill) => decimal(bill.outstanding))), MONEY_SCALE),
      billCount: own.filter((bill) => bill.status !== "abandoned").length,
      tableIds: [member.tableId],
      unsentDrafts: unsentDrafts.get(member.partyId)!,
      reminder: reminders.get(member.partyId)!,
    });
  }
  return {
    seated: new Map(members.map((member) => [member.tableId, partyOf.get(member.partyId)!])),
    facts,
  };
}
