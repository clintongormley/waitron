import "./errors.js";
import { workingOrderLines, newId, type Transaction, kitchenStations } from "@waitron/db";
import {
  type ResolvedExtraList,
  readProductModifiers,
  readOptionListsByIds,
  menusOfVersions,
  type GrossLines,
  grossBasketWithOptions,
  NO_LIVE_FIELDS,
  readInvoiceLocales,
  readSavedContentLanguages,
  contentLanguagesOr,
  parentsWithActiveVariants,
  type BasketItemWithOptions,
  selectMenuVariant,
  EACH_UNIT_ID,
  loadClassification,
  classifyLine,
  defaultLanguageDescriptions,
} from "@waitron/menu";
import type { ExtrasUnit } from "@waitron/menu/src/unit-extras.js";
import { prepareUnitSnapshot } from "@waitron/menu/src/unit-presentation.js";
import type { ZoneMenuOffer, ZoneOffers, LineContextInput } from "@waitron/module";
import { requireNullableString } from "@waitron/server-kit";
import {
  type OptionList,
  type ContentLanguages,
  newCustomerPresentation,
  type VatClass,
  AppError,
  isUuid,
  type ExtraSelection,
  type OptionSelection,
  type OptionSnapshot,
  customerPresentationText,
  type DatedRate,
  newCustomerText,
  stringToThousandths,
  decimalToCents,
} from "@waitron/shared";
import { offeredKey } from "@waitron/venue-service";
import { and, inArray, eq } from "drizzle-orm";
import { setMenuALaCartePrices } from "./a-la-carte-price.js";
import { requireCourse, requireLiveCourse } from "./kitchen.js";
import type { LateSendConfirmation } from "./late-send.js";
import {
  type ExtraProductFacts,
  type ExtraChild,
  namedPicks,
  buildLineExtras,
} from "./modifier-selection.js";
import { VENUE_SERVICE } from "./modules.js";
import { type RetainedCourseLine, RETAINED_COURSE } from "./retained-course.js";
import {
  SET_MENU_DRAFT_LINE,
  type SetMenuDraftLine,
  type SetMenuPlacement,
  refuseUnlessSetMenuBill,
} from "./set-menu-bill.js";
import {
  type SetMenuOfferLookup,
  setMenuOfferLookup,
  assertSetMenuPortion,
} from "./set-menu-offers.js";
import type { OrderLineIdentity } from "./stored-order-lines.js";
import type { TradingContext } from "./trading-context.js";
import { type EndedMenu, confirmLateDishes } from "./working-order-late-send.js";
import { takesExtras } from "@waitron/menu/src/unit-extras.js";

export type WorkingOrderLineInsert = typeof workingOrderLines.$inferInsert;
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
export interface OfferModifiers {
  extras: ResolvedExtraList[];
  options: OptionList[];
  /** Every product {@link OfferModifiers.extras} offers, by id: what {@link buildLineExtras}
   * freezes onto a child. */
  extraProducts: ReadonlyMap<string, ExtraProductFacts>;
}
export const NO_MODIFIERS: OfferModifiers = { extras: [], options: [], extraProducts: new Map() };
function copyNames(names: Readonly<Record<string, string>> | null): Record<string, string> | null {
  return names === null ? null : { ...names };
}
export function offerModifiers(offer: ZoneMenuOffer, config: ContentLanguages): OfferModifiers {
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
        descriptions: Object.fromEntries(
          config.languages.map((language) => [
            language,
            newCustomerPresentation(item.presentation, language, config),
          ]),
        ),
        kitchenName: item.kitchenName,
        vatClass: item.vatClass as VatClass,
        takeawayVatClass: item.takeawayVatClass as VatClass,
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
/** The extras lists a line of a dish in `unit` is checked against. The till draws no extras list on
 * a dish that does not take extras, so none may demand a pick here; a pick the lists accept is
 * refused as `extras.unsupported_product` once it is priced. */
export function extrasListsFor(
  lists: ResolvedExtraList[],
  unit: ExtrasUnit | undefined,
): ResolvedExtraList[] {
  return unit === undefined || takesExtras(unit)
    ? lists
    : lists.map((list) => ({ ...list, minPicks: 0 }));
}
/** Each product's own options lists, in its order, keyed by the lower-cased product id. */
export async function productOptionLists(
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
export async function readBasketOffers(
  tx: Transaction,
  workingOrderId: string,
  zoneId: string | undefined,
  lines: readonly { menuVersionId?: unknown; [SET_MENU_DRAFT_LINE]?: SetMenuDraftLine }[],
  menuItemIds: readonly unknown[],
): Promise<ZoneOffers> {
  if (zoneId === undefined) {
    throw new AppError("order.service_context_missing", { workingOrderId });
  }
  const versionIds = new Set<string>();
  for (const { menuVersionId, [SET_MENU_DRAFT_LINE]: draft } of lines) {
    if (menuVersionId === undefined || draft !== undefined) continue;
    if (typeof menuVersionId !== "string" || !isUuid(menuVersionId)) {
      throw new AppError("management.request_invalid", { field: "menuVersionId" });
    }
    versionIds.add(menuVersionId.toLowerCase());
  }
  const named = menuItemIds.filter((id): id is string => typeof id === "string");
  const offers = await VENUE_SERVICE.listZoneOffers(tx, zoneId, {
    menuItemIds: named,
    withDefault: false,
  });
  const live = new Set(offers.menus.map((menu) => menu.versionId));
  const stale = [...versionIds].filter((versionId) => !live.has(versionId));
  if (stale.length === 0) return offers;
  // Only a refusal is left: its details name each stale version's menu, which is looked up here.
  const menus = await menusOfVersions(tx, stale);
  if (menus.size < stale.length) {
    throw new AppError("management.request_invalid", { field: "menuVersionId" });
  }
  return VENUE_SERVICE.listZoneOffers(tx, zoneId, {
    asserted: [...menus].map(([versionId, menuId]) => ({ menuId, versionId })),
    menuItemIds: named,
    withDefault: false,
  });
}
/**
 * Marks a requested line that only prices extras added to a stored dish: its dish row is discarded,
 * so it orders no new portion of the dish. A symbol, so no JSON body can set it.
 */
export const ADDED_EXTRAS_ONLY = Symbol("addedExtrasOnly");
/**
 * Marks an {@link ADDED_EXTRAS_ONLY} line whose stored dish, or one of its extras, has been sent:
 * stamped sent or holding a ticket item, held or fired. Only such extras take the period-ended
 * check. A symbol, so no JSON body can set it.
 */
export const ON_SENT_DISH = Symbol("onSentDish");
/**
 * Marks a requested line that prices a raised quantity of a stored line: after its period it is
 * refused `menu_period.not_running`, never late and never also sold. A symbol, so no JSON body can set it.
 */
export const STORED_RISE = Symbol("storedRise");
// Answers an edit has already settled: symbols, so no JSON body can set them.
export const FROZEN_OPTIONS = Symbol("frozenOptions");
export const FROZEN_EXTRAS = Symbol("frozenExtras");
export const STORED_SET_MENU_OFFER = Symbol("storedSetMenuOffer");
type StoredSetMenuOffer = NonNullable<ReturnType<SetMenuOfferLookup["offerFor"]>>;
/**
 * Return insertable snapshots and their gross lines together. The gross lines total but carry no
 * rates, so they cannot be rated: an order is filed from its stored lines, rated at issue.
 */
export async function priceOrderLines(
  tx: Transaction,
  cfg: TradingContext,
  workingOrderId: string,
  // `courseId` absent or null = the offer's default course; a string is an override.
  // An ACTIVE options list must be answered even when `options` is absent.
  requestedLines: ({
    menuItemId: string;
    quantity: string;
    courseId?: string | null;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
    [SET_MENU_DRAFT_LINE]?: SetMenuDraftLine;
    [STORED_SET_MENU_OFFER]?: StoredSetMenuOffer;
    [FROZEN_OPTIONS]?: OptionSnapshot[];
    [FROZEN_EXTRAS]?: ExtraChild[];
    [ADDED_EXTRAS_ONLY]?: true;
    [ON_SENT_DISH]?: true;
    [STORED_RISE]?: true;
  } & LineExtras &
    RetainedCourseLine)[],
  zoneId?: string,
  /** The zone's offers, when the caller has already read them with {@link readBasketOffers}. */
  snapshot?: ZoneOffers,
  invalidMakeAt: "refuse" | "ignore" = "refuse",
  periodCheck: "added" | "none" = "added",
  lateSend?: LateSendConfirmation,
): Promise<{
  lineRows: WorkingOrderLineInsert[];
  /** Aligned with `lineRows`: a dish sold in whole portions, which may be split one per dish. */
  portionable: boolean[];
  gross: GrossLines;
  identities: OrderLineIdentity[];
  lineContexts: (LineContextInput & { placement?: Omit<SetMenuPlacement, "workingOrderLineId"> })[];
  /** The zone's offers the lines were priced from, for `lineContextColumns`. */
  offers: ZoneOffers;
}> {
  if (requestedLines.length === 0) {
    return {
      lineRows: [],
      portionable: [],
      gross: grossBasketWithOptions([]),
      identities: [],
      lineContexts: [],
      offers: {
        service: {
          open: false,
          zoneOpen: true,
          periodName: null,
          periodOccurrenceKey: null,
          keepOpen: null,
          zoneKeepOpen: null,
        },
        defaultMenuId: null,
        menus: [],
        offers: [],
        setMenus: [],
        liveFields: NO_LIVE_FIELDS,
      },
    };
  }
  const offers =
    snapshot ??
    (await readBasketOffers(
      tx,
      workingOrderId,
      zoneId,
      requestedLines,
      requestedLines.map((line) => line.menuItemId),
    ));
  const offerById = new Map(offers.offers.map((offer) => [offer.id, offer]));
  const setMenuLines = requestedLines.flatMap((line) => {
    const draft = line[SET_MENU_DRAFT_LINE];
    return draft === undefined
      ? []
      : [{ ...line, setMenuId: draft.setMenuId, menuVersionId: line.menuVersionId ?? null }];
  });
  if (setMenuLines.length > 0) await refuseUnlessSetMenuBill(tx, workingOrderId);
  const setMenus = await setMenuOfferLookup(tx, workingOrderId, setMenuLines, offers.menus);
  const selectedSetMenu = (line: (typeof requestedLines)[number]) => {
    if (line[STORED_SET_MENU_OFFER] !== undefined) return line[STORED_SET_MENU_OFFER];
    const draft = line[SET_MENU_DRAFT_LINE];
    return draft === undefined
      ? undefined
      : setMenus.offerFor({
          setMenuId: draft.setMenuId,
          menuItemId: line.menuItemId,
          menuVersionId: line.menuVersionId ?? null,
        });
  };
  let service: Awaited<ReturnType<typeof VENUE_SERVICE.resolveDepartmentService>> | null = null;
  // Dishes and extras added to sent dishes can be marked when their menu ended earlier today.
  const ended = new Map<(typeof requestedLines)[number], EndedMenu>();
  let alsoSold: ReadonlySet<string> = new Set();
  const marks = new Map<number, NonNullable<LineContextInput["late"]>>();
  const checked = (line: (typeof requestedLines)[number]) =>
    line[ADDED_EXTRAS_ONLY] !== true || line[ON_SENT_DISH] === true;
  if (periodCheck === "added" && requestedLines.some(checked)) {
    const context = await VENUE_SERVICE.resolveZoneContext(tx, zoneId!);
    const at = new Date();
    // Extras added to a stored dish are not new service, so a closed zone does not refuse them;
    // after a sent dish's period they are late like a new dish of it.
    if (requestedLines.some((line) => line[ADDED_EXTRAS_ONLY] !== true))
      await VENUE_SERVICE.assertZoneTakesNewOrders(tx, context.zoneId, at);
    service = await VENUE_SERVICE.resolveDepartmentService(tx, context.departmentId, at);
    const periodOf = new Map(service.endedMenus.map((menu) => [menu.menuId, menu]));
    const items: { productId: string; variantId: string | null }[] = [];
    for (const line of requestedLines) {
      const selected = selectedSetMenu(line);
      if (selected?.fromRecordedCopy === true) continue;
      const offer =
        selected?.offer ??
        (line[SET_MENU_DRAFT_LINE] === undefined ? offerById.get(line.menuItemId) : undefined);
      if (offer === undefined) continue;
      const period = periodOf.get(offer.menuId);
      if (
        period === undefined ||
        !checked(line) ||
        line[STORED_RISE] === true ||
        service.orderableMenuIds.includes(offer.menuId)
      )
        continue;
      ended.set(line, period);
      items.push({ productId: offer.productId, variantId: line.variantId ?? null });
    }
    if (items.length > 0) {
      alsoSold = await VENUE_SERVICE.productsOfferedIn(
        tx,
        context.zoneId,
        service.orderableMenuIds,
        items,
      );
    }
  }
  const late: (EndedMenu & { index: number; menuItemId: string })[] = [];
  const versionOf = new Map(offers.menus.map((menu) => [menu.id, menu.versionId]));
  const lines = requestedLines.map((line, index) => {
    // The wire body is JSON, so a line may still name a product the types no longer carry, or the
    // string spelling of an answer only the server settles.
    if (
      typeof line.menuItemId !== "string" ||
      Object.hasOwn(line, "productId") ||
      Object.hasOwn(line, "frozenOptions") ||
      Object.hasOwn(line, "frozenExtras")
    ) {
      throw new AppError("management.request_invalid", { field: "lines" });
    }
    const setMenu = line[SET_MENU_DRAFT_LINE];
    const selected = selectedSetMenu(line);
    const isSetMenu = setMenu !== undefined || line[STORED_SET_MENU_OFFER] !== undefined;
    const offer = isSetMenu ? selected?.offer : offerById.get(line.menuItemId);
    if (offer === undefined) {
      throw new AppError("service_zone.offer_not_allowed", {
        zoneId: zoneId!,
        menuItemId: line.menuItemId,
      });
    }
    const period = ended.get(line);
    if (
      selected?.fromRecordedCopy === true &&
      service !== null &&
      !service.orderableMenuIds.includes(offer.menuId)
    ) {
      // A held dish carries the mark so Fire recognises the already permitted send.
      if (setMenu?.held === true) {
        const name = service.endedMenus.find(({ menuId }) => menuId === offer.menuId)?.periodName;
        marks.set(index, { periodId: null, periodName: name ?? offer.menuName, confirmedBy: null });
      }
    } else if (period !== undefined) {
      if (!alsoSold.has(offeredKey(offer.productId, line.variantId ?? null))) {
        late.push({ index, menuItemId: offer.id, ...period });
      }
    } else if (
      service !== null &&
      line[ADDED_EXTRAS_ONLY] !== true &&
      !service.orderableMenuIds.includes(offer.menuId)
    ) {
      throw new AppError("menu_period.not_running", {
        departmentId: service.departmentId,
        menuId: offer.menuId,
      });
    }
    // Every asserted version is live, so one naming another menu is not this line's.
    if (
      setMenu === undefined &&
      line.menuVersionId !== undefined &&
      line.menuVersionId.toLowerCase() !== versionOf.get(offer.menuId)
    ) {
      throw new AppError("management.request_invalid", { field: "menuVersionId" });
    }
    if (!offer.available) {
      throw new AppError("product.unavailable", { productId: offer.productId });
    }
    if (
      !isSetMenu &&
      offer.ordering === "not_sold_separately" &&
      line[ADDED_EXTRAS_ONLY] !== true
    ) {
      throw new AppError("product.not_sold_separately", { productId: offer.productId });
    }
    if (isSetMenu) assertSetMenuPortion(offer, line.variantId ?? null);
    const setMenuOffer =
      selected === undefined ? undefined : { offer, versionId: selected.copy.versionId };
    return { ...line, offer, setMenuOffer, holding: selected?.document };
  });
  const aLaCarte = await setMenuALaCartePrices(
    tx,
    lines.map(({ holding, offer, variantId }) => ({
      holding,
      productId: offer.productId,
      variantId: variantId ?? null,
    })),
  );
  if (late.length > 0) {
    const confirmedBy = await confirmLateDishes(tx, service!.departmentId, late, lateSend);
    for (const { index, periodId, periodName } of late)
      marks.set(index, { periodId, periodName, confirmedBy });
  }
  const invoiceLocales = await readInvoiceLocales(tx);
  const savedLanguages = await readSavedContentLanguages(tx);
  const contentConfig = contentLanguagesOr(savedLanguages, cfg.locale);

  const modifiersByOffer = new Map<ZoneMenuOffer, OfferModifiers>();
  for (const { offer } of lines) {
    if (!modifiersByOffer.has(offer)) {
      modifiersByOffer.set(offer, offerModifiers(offer, contentConfig));
    }
  }
  // A product with an Active variant is never sold as itself, and an extras pick cannot name a
  // variant, so a pick of such a product is refused below, before the published lists are asked:
  // a version published after the variant was switched on no longer offers the product at all.
  const picksOf = (line: (typeof lines)[number]) => line[FROZEN_EXTRAS] ?? namedPicks(line.extras);
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
              and(inArray(kitchenStations.id, namedStations), eq(kitchenStations.active, true)),
            )
        ).map((station) => station.id),
  );
  if (invalidMakeAt === "refuse") {
    const invalidStationId = namedStations.find((stationId) => !activeStations.has(stationId));
    if (invalidStationId !== undefined)
      throw new AppError("route.station_inactive", { stationId: invalidStationId });
  }
  type LineMeta = { setMenuOffer?: LineContextInput["setMenuOffer"] } & (
    | {
        kind: "parent";
        productId: string;
        variantId?: string;
        menuItemId: string;
        courseId: string | null;
        note: string | null;
        makeAt: string | null;
        unit: ExtraChild["unitContext"];
        portionable: boolean;
        aLaCarteCents: number | null;
        placement?: Omit<SetMenuPlacement, "workingOrderLineId">;
        late?: LineContextInput["late"];
        vatClass: VatClass;
        takeawayVatClass: VatClass;
      }
    | {
        kind: "child";
        productId: string;
        menuItemId: string;
        extraListId: string;
        unit?: ExtraChild["unitContext"];
        late?: LineContextInput["late"];
        vatClass: VatClass;
        takeawayVatClass: VatClass;
      }
  );
  const items: BasketItemWithOptions[] = [];
  const lineMeta: LineMeta[] = [];
  for (const [index, line] of lines.entries()) {
    const mark = marks.get(index);
    const { offer } = line;
    const selection = selectMenuVariant(offer, line.variantId ?? null);
    const customerText = customerPresentationText(
      selection,
      contentConfig.defaultLanguage,
      contentConfig.languages,
    );
    const classes = {
      vatClass: selection.vatClass as VatClass,
      takeawayVatClass: selection.takeawayVatClass as VatClass,
    };
    const product = {
      name: selection.name,
      unitPrice: selection.unitPrice,
      unit: prepareUnitSnapshot(selection.unit, contentConfig),
      pricingUnit: selection.unit.hardwareUnit === null ? ("each" as const) : ("weight" as const),
      vatClass: classes.vatClass,
      // Empty, so rating these lines refuses: a line's rate is read when its order is issued.
      vatRates: [] as readonly DatedRate[],
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

    const modifiers = modifiersByOffer.get(offer)!;
    const built = buildLineExtras(
      {
        extras:
          line[FROZEN_EXTRAS] === undefined ? extrasListsFor(modifiers.extras, selection.unit) : [],
        options: line[FROZEN_OPTIONS] === undefined ? modifiers.options : [],
      },
      modifiers.extraProducts,
      {
        extras: line[FROZEN_EXTRAS] === undefined ? line.extras : [],
        options: line[FROZEN_OPTIONS] === undefined ? line.options : [],
      },
      contentConfig.defaultLanguage,
    );
    const extraChildren = line[FROZEN_EXTRAS] ?? built.extraChildren;
    const optionSnapshots = line[FROZEN_OPTIONS] ?? built.optionSnapshots;

    // A child is priced at dish quantity × pick quantity, so on a dish sold by weight, in decimals or
    // in a measure an extra's quantity would be a weight, a fraction or a measure, not a number of
    // extras.
    const portionable = takesExtras(selection.unit);
    if (extraChildren.length > 0 && !portionable) {
      throw new AppError("extras.unsupported_product", {
        productId: offer.productId,
        soldBy:
          selection.unit.hardwareUnit !== null
            ? "weight"
            : selection.unit.precision > 0
              ? "fraction"
              : "measure",
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
        vatRates: [] as readonly DatedRate[],
        quantity: child.quantity,
        physicalQuantity: child.physicalQuantity,
        priceQuantity: child.priceQuantity,
        unitName: child.unitContext?.id === EACH_UNIT_ID ? undefined : child.unitName,
        unitPrecision: child.unitContext?.id === EACH_UNIT_ID ? undefined : child.unitPrecision,
      })),
    });
    const draft = line[SET_MENU_DRAFT_LINE];
    lineMeta.push({
      kind: "parent",
      setMenuOffer: line.setMenuOffer,
      ...(draft === undefined
        ? {}
        : {
            placement: { draft, productId: offer.productId, variantId: line.variantId ?? null },
          }),
      productId: selection.productId,
      ...(line.variantId == null ? {} : { variantId: line.variantId }),
      menuItemId: line.menuItemId,
      courseId: line.courseId ?? product.courseId ?? null,
      note,
      makeAt: line.makeAt != null && activeStations.has(line.makeAt) ? line.makeAt : null,
      portionable,
      aLaCarteCents: aLaCarte[index]!,
      ...classes,
      ...(mark === undefined ? {} : { late: mark }),
      unit: {
        id: selection.unit.id,
        name: {
          [contentConfig.defaultLanguage]: newCustomerText(
            selection.unit.name,
            selection.unit.staffName,
            contentConfig.defaultLanguage,
            contentConfig,
          ),
        },
        precision: selection.unit.precision,
        hardwareUnit: selection.unit.hardwareUnit,
      },
    });
    for (const child of extraChildren) {
      lineMeta.push({
        kind: "child",
        setMenuOffer: line.setMenuOffer,
        productId: child.productId,
        menuItemId: line.menuItemId,
        extraListId: child.listId,
        unit: child.unitContext,
        vatClass: child.vatClass,
        takeawayVatClass: child.takeawayVatClass,
        ...(mark === undefined ? {} : { late: mark }),
      });
    }
  }

  for (const line of lines) {
    const courseId = line.courseId;
    if (courseId === null || courseId === undefined) continue;
    if (!isUuid(courseId)) {
      throw new AppError("course.not_found", { courseId });
    }
    if (line[RETAINED_COURSE] === true) await requireCourse(tx, courseId);
    else await requireLiveCourse(tx, courseId);
  }

  const gross = grossBasketWithOptions(items);
  const classification = await loadClassification(tx, [
    ...new Set(lineMeta.map((meta) => meta.productId)),
  ]);
  const classifications = lineMeta.map((meta) => classifyLine(classification, meta.productId));

  for (const line of gross.lines) {
    line.descriptions = defaultLanguageDescriptions(
      line.descriptions,
      invoiceLocales,
      contentConfig.defaultLanguage,
      line.name,
    );
    if (line.variantDescriptions != null) {
      line.variantDescriptions = defaultLanguageDescriptions(
        line.variantDescriptions,
        invoiceLocales,
        contentConfig.defaultLanguage,
        line.variantName ?? "",
      );
    }
  }

  // Pre-generated ids let extras name their dish before either row is written.
  // gross.lines lists each dish before its extras, as chunked inserts need for the parent key.
  const ids = gross.lines.map(() => newId());
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
      optionSnapshots: line.optionSnapshots,
      unitName: line.unitName,
      unitPrecision: line.unitPrecision,
      countAsPortions: meta.kind === "parent" && meta.portionable,
      quantity: stringToThousandths(line.quantity),
      ...(line.priceQuantity === undefined
        ? {}
        : { priceQuantity: stringToThousandths(line.priceQuantity) }),
      // The gross unit price LOCKED at add time: a retrieved order is filed from it without a
      // re-price, so a later menu price change never moves the filed total. Never derived as
      // `line_total ÷ quantity`, which drifts for a weighed line.
      unitPriceGross: decimalToCents(line.grossUnitPrice),
      aLaCarteUnitPrice:
        meta.kind === "parent" ? (meta.aLaCarteCents ?? decimalToCents(line.grossUnitPrice)) : null,
      vatClass: meta.vatClass,
      takeawayVatClass: meta.takeawayVatClass,
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
    ...(meta.setMenuOffer === undefined ? {} : { setMenuOffer: meta.setMenuOffer }),
    ...(meta.kind !== "parent" || meta.placement === undefined
      ? {}
      : { placement: meta.placement }),
    ...(meta.kind === "parent" && meta.variantId !== undefined
      ? { variantId: meta.variantId }
      : {}),
    ...(meta.unit !== undefined ? { unit: meta.unit } : {}),
    ...(meta.late !== undefined ? { late: meta.late } : {}),
  }));
  const portionable = lineMeta.map((meta) => meta.kind === "parent" && meta.portionable);
  return { lineRows, portionable, gross, identities, lineContexts, offers };
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
