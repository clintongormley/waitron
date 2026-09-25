import type { ContentLanguages } from "@waitron/shared";
import { compareDecimal, decimal, subtractDecimal } from "@waitron/shared";

/**
 * The browser-side face of the till's HTTP API — one thin `fetch` wrapper per server route
 * (`apps/server/src/till-api.ts`), so the Lit views never touch `fetch`, URLs, cookies or
 * error-envelope shapes: they call a typed method and get back a typed payload, or a rejected
 * `{ code }`.
 *
 * Most response interfaces below are LOCAL copies of the server's JSON shapes, because a RUNTIME
 * import from a server package would drag its barrel — and through it `@waitron/db` — into the
 * browser bundle. The cost is that a mismatch with the server is not a compile break.
 *
 * The OFFER and MENU shapes are the exception: `TillMenuOffer`, `TillMenu` and `OfferedModifier` are
 * `import type` aliases from catalogue's type-only leaf `@waitron/catalogue/src/menu-types.js`, which
 * pulls in no runtime, so removing or retyping a field the till reads is a compile break here.
 * `TillProduct` stays LOCAL: it is the till's own display model, built by
 * {@link menuOfferToTillProduct} from an offer and by `getHeldOrder` from a retrieved line.
 */

import type { CanvasDef, CapabilityFlag, ReceiptConfig } from "../layout.js";
import type {
  ExtraSelection,
  OptionSelection,
  OptionSnapshot,
  StationThresholds,
  TimingBand,
} from "@waitron/shared";
import type {
  AccessibleCatalogue,
  MenuOffer,
  OfferedModifier,
} from "@waitron/catalogue/src/menu-types.js";

/** Re-exported, never re-declared, so a widget imports the offered-list shapes where it imports every
 * other wire type. */
export type {
  OfferedExtraItem,
  OfferedExtrasList,
  OfferedModifier,
  OfferedOptionsList,
} from "@waitron/catalogue/src/menu-types.js";

/** The subset of `fetch` this client uses; the global satisfies it, and a test injects a stub. */
export type FetchLike = typeof fetch;

/** A plain (non-array, non-null) object — the only parsed body shape an error envelope can be read from. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a rejected request got NO answer: `fetch` rejects with a TypeError when the connection fails
 * and with an AbortError on a timeout. Either way the outcome is UNKNOWN — the server may have received
 * and processed the request — which is why the caller shows `sale.unconfirmed` (check before retrying)
 * rather than `sale.error` (the server refused; retry freely). A server that DID answer rejects through
 * `#request` as a `{ code }`.
 */
export function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof DOMException && err.name === "AbortError");
}

/**
 * `GET /api/till` — the public boot info the app reads before login. `orderFlow` is needed before login
 * so the app can choose which pay control to render; `cardProvider`/`tipsEnabled` decide whether the
 * integrated-card pay control renders at all and whether it prompts for a tip (`cardProvider: "none"`
 * for a till with no integrated reader). `receipt` is the owner-authored receipt trim, or the built-in
 * default.
 */
export interface TillInfo {
  locale: string;
  onboardingIntent?: "demo" | "prepare" | "live";
  /**
   * The RECEIPT (fiscal document) locale, DELIBERATELY DISTINCT from the UI {@link locale}: the venue
   * default derivation drops UI-unsupported codes, which must never reach the receipt.
   */
  invoiceLocale: string;
  venueName: string;
  nif: string;
  orderFlow: OrderFlow;
  /** Whether issuance auto-enqueues the original receipt or leaves it for the completion prompt. */
  receiptPrintMode: "auto" | "on_request" | "never";
  /**
   * The KDS bump mode: `line` (per-line bump only, the source of truth) or `ticket` (the display also
   * offers a whole-ticket bump).
   */
  bumpMode: "line" | "ticket";
  /**
   * Which surface offers the course fire action: `waiter` (the tab), `kitchen` (the station display) or
   * `expo` (the pass).
   */
  fireControl: "waiter" | "kitchen" | "expo";
  /** The venue's ACTIVE kitchen courses, by `displayOrder`; `[]` for a venue with none. */
  courses: TillCourse[];
  cardProvider: "none" | "stripe_terminal" | "stripe_on_device" | "sumup_cloud" | "simulator";
  /**
   * The paying device's DEFAULT reader's row id, or absent when it has none. `cardProvider` only names a
   * provider TYPE and a venue can have several readers on one provider, so this is what finds the
   * default reader's NAME in {@link activeReaders}.
   */
  defaultReaderId?: string;
  /** The venue's ACTIVE card readers, `[]` when none; feeds the payment-time reader picker. */
  activeReaders: TillActiveReader[];
  tipsEnabled: boolean;
  receipt: ReceiptConfig;
  /**
   * The CALLING device's layout canvas — its assigned one, or the form-factor default the server falls
   * back to (a cookieless request gets the `till` default).
   */
  canvas: CanvasDef;
  /** The CALLING device's capability set from its profile; `[]` for a no-profile or cookieless request. */
  capabilities: CapabilityFlag[];
  /**
   * The CALLING device's per-profile inactivity auto-logout, in seconds, or `null` for no idle logout
   * (also a no-profile or cookieless request).
   */
  inactivityTimeoutSeconds: number | null;
  /** This node's id, so the app can tell which `servers` entry it is on. */
  nodeId: string;
  /** The venue's routable servers, primary first; `[]` when no membership document is held. */
  servers: TillServer[];
}

/**
 * One venue-routable server as the boot payload carries it. `evicted` nodes are excluded server-side,
 * so `standing` is the three serving/sell states only.
 */
export interface TillServer {
  nodeId: string;
  url: string;
  standing: "serving-primary" | "serving-secondary" | "sell-only";
}

/** One ACTIVE kitchen course as the boot payload carries it. */
export interface TillCourse {
  id: string;
  name: string;
  displayOrder: number;
}

/**
 * One ACTIVE card reader as the boot payload carries it; `id` is what `POST /api/pay`'s `readerId`
 * names. `provider` is narrower than {@link TillInfo.cardProvider}: a device-local mode has no reader
 * ROW to list.
 */
export interface TillActiveReader {
  id: string;
  name: string;
  provider: "stripe_terminal" | "sumup_cloud";
}

/** One `GET /api/staff` roster entry — no PIN, role or status. */
export interface StaffMember {
  personId: string;
  displayName: string;
}

/**
 * `POST /api/session` success. `canConfigureTill` is computed server-side
 * (`roleHasPermission(role, "venue.configure")`) so the client never mirrors the role→permission map.
 * Convenience only — the on-till placement routes re-check `venue.configure`, so a tampered client
 * value grants nothing.
 */
export interface SessionResult {
  personId: string;
  canConfigureTill: boolean;
  /** The operator's stored UI locale, or `null` when they have never set one (the venue default applies). */
  locale: string | null;
}

/** One VAT band on a ticket: a rate and its taxable base + tax, as decimal strings. */
export interface VatBreakdownEntry {
  rate: string;
  base: string;
  tax: string;
}

/**
 * LOCAL copies of catalogue's `dietary.ts` types, structurally identical so a value crosses the
 * boundary. `DietLabel` is a cautious tri-state: `"unknown"` when the base recipe is unreviewed — never
 * a positive claim.
 */
export type DietaryOrigin =
  "plant" | "meat" | "fish" | "shellfish" | "dairy" | "egg" | "honey" | "other_animal";
export type ContainsTag = "meat" | "fish";
export type DietLabel = "yes" | "no" | "unknown";

/** The recipe-derived diet basis: `pending` is true while the recipe is unreviewed (holding
 * vegan/vegetarian at "unknown"). */
export interface DietDerivation {
  origins: DietaryOrigin[];
  pending: boolean;
}
/** A staff diet OVERRIDE: an explicit label wins over the derivation; halal/kosher are never derived.
 * Absent fields don't override. */
export interface DietOverride {
  vegan?: "yes" | "no";
  vegetarian?: "yes" | "no";
  halal?: "yes" | "no";
  kosher?: "yes" | "no";
  addContains?: ContainsTag[];
  removeContains?: ContainsTag[];
}
/** The PUBLISHED diet profile — the derivation folded with the override. halal/kosher appear only when
 * the override set them. */
export interface DietProfile {
  vegan: DietLabel;
  vegetarian: DietLabel;
  contains: ContainsTag[];
  halal?: "yes" | "no";
  kosher?: "yes" | "no";
}

/**
 * One sellable product as the till's widgets consume it, built from exactly two payloads:
 * {@link menuOfferToTillProduct} adapts a zone offer, and `getHeldOrder` synthesises one per line of a
 * retrieved order. It is NOT the shape of `GET /api/products`.
 */
export interface TillProduct {
  id: string;
  /** The shared product identity used by recipes, stock and preparation routing. */
  productId?: string;
  /** The selling identity whose menu, price and offered modifiers were selected. */
  menuItemId?: string;
  variantId?: string;
  /** The selected variant's staff-facing name; a line naming a variant is shown under it alone. */
  variantName?: string;
  /** The selected variant's customer-facing text, locale -> text; null when it has none. */
  variantCustomerName?: Record<string, string> | null;
  variantKitchenName?: string | null;
  kitchenName?: string | null;
  /** Each variant's selling values are its EFFECTIVE ones as the offer resolved them — a line rung
   * up as the variant is sold under these, never the parent's. */
  variants?: (TillSellingValues & {
    id: string;
    name: string;
    customerName?: Record<string, string> | null;
    kitchenName?: string | null;
    image?: string | null;
    unitPrice: string;
    /** The variant's price minus its parent's on this menu, negative when cheaper, null when equal —
     * for the picker's "+€1.50" label; nothing stores it. */
    unitPriceDifference: string | null;
    available: boolean;
  })[];
  /**
   * The product's STAFF-facing name, not per-language — what the till's buttons and basket render. A
   * retrieved line carries the name frozen onto it at add time.
   */
  name: string;
  /** The product's customer-facing text, locale -> text; null or blank falls back to {@link name}. */
  customerName?: Record<string, string> | null;
  unit?: {
    id: string;
    name: Record<string, string>;
    abbreviation: Record<string, string>;
    precision: number;
    hardwareUnit: "kg" | "g" | "mg" | null;
  };
  pricingUnit?: "each" | "weight";
  unitPrice: string;
  vatClass: "general" | "reduced" | "super_reduced" | "zero";
  category: string | null;
  /** EU-14 allergen declaration keyed by allergen code; null = not reviewed. */
  allergens: Record<string, { presence: "contains" | "may_contain"; source?: string }> | null;
  /** The product's DEFAULT kitchen course, which the per-line course picker pre-selects; absent or null
   * means no default course. */
  courseId?: string | null;
  /** The menu this product is sold from; the till's menu filter shows only the selected menu's
   * products, and an absent value never matches one. */
  catalogueId?: string;
  /** The menu's display name; the switcher renders `TillMenu.name`, not this. */
  catalogueName?: string;
  /**
   * The ordered extras and options lists this dish offers, in the product's own attachment order. The
   * basket resolves a pick's allergens and dietary labels off it BY PRODUCT ID.
   *
   * Absent on a product synthesised from a retrieved held line, so a surface reading this treats absent
   * as "offers nothing" rather than "not loaded yet".
   */
  offeredModifiers?: OfferedModifier[];
  /** The PUBLISHED diet profile. Null/absent reads as an unreviewed dish (never vegan/vegetarian), so
   * the diet filters exclude it. */
  diet?: DietProfile | null;
  /** The recipe-derived diet basis, carried so the basket can recompute the AS-SERVED diet
   * client-side. Null/absent = no recipe (folds as pending). */
  dietDerivation?: DietDerivation | null;
  /** The staff diet OVERRIDE alone, re-applied over the as-served derivation. Null/absent = none. */
  dietOverride?: DietOverride | null;
  dietaryDeclarations?: string[];
}

/** The product values a line is sold under, apart from its price and names. */
export type TillSellingValues = Pick<
  TillProduct,
  | "unit"
  | "pricingUnit"
  | "vatClass"
  | "category"
  | "allergens"
  | "courseId"
  | "diet"
  | "dietDerivation"
  | "dietOverride"
  | "dietaryDeclarations"
>;

/** Exactly the {@link TillSellingValues} of `source`, so spreading them over a product replaces every
 * one of the product's — an absent value included — and nothing else. */
export function sellingValuesOf(source: TillSellingValues): TillSellingValues {
  return {
    unit: source.unit,
    pricingUnit: source.pricingUnit,
    vatClass: source.vatClass,
    category: source.category,
    allergens: source.allergens,
    courseId: source.courseId,
    diet: source.diet,
    dietDerivation: source.dietDerivation,
    dietOverride: source.dietOverride,
    dietaryDeclarations: source.dietaryDeclarations,
  };
}

/**
 * One menu. In a zone-offers body `isDefault` flags the zone's default menu, which the till selects
 * first; in {@link ProductCatalogue.menus} it flags the location's default.
 */
export type TillMenu = AccessibleCatalogue;

/** The `GET /api/products` payload. The app builds its product grid from zone offers, not this route;
 * the test harness uses it as its fixture seam. */
export interface ProductCatalogue {
  menus: TillMenu[];
  products: TillProduct[];
}

/** A product's selling identity on one menu — the `offers[]` of `GET /api/service-zones/:zoneId/offers`. */
export type TillMenuOffer = MenuOffer;

export interface ZoneOfferCatalogue {
  context: {
    zoneId: string;
    departmentId: string;
    serviceMode: "table_tab" | "prepay" | "invoice_first" | "ticket_then_pay";
  };
  defaultMenuId: string | null;
  menus: TillMenu[];
  offers: TillMenuOffer[];
  zones?: ServiceZoneSummary[];
}

export interface ServiceZoneSummary {
  id: string;
  name: string;
  departmentId: string;
  departmentName: string;
  serviceMode: "table_tab" | "prepay" | "invoice_first" | "ticket_then_pay";
}

/** Adapt a menu offer to the till's display model while keeping product and selling ids distinct. */
export function menuOfferToTillProduct(offer: TillMenuOffer): TillProduct {
  return {
    id: offer.productId,
    productId: offer.productId,
    menuItemId: offer.id,
    name: offer.name,
    customerName: offer.customerName,
    kitchenName: offer.kitchenName,
    unit: offer.unit,
    // No `pricingUnit`: `productUnit()` consults it only when `unit` is absent, and an offer always
    // carries its `unit`.
    unitPrice: offer.unitPrice,
    vatClass: offer.vatClass,
    category: offer.category,
    allergens: offer.allergens,
    courseId: offer.courseId,
    catalogueId: offer.menuId,
    catalogueName: offer.menuName,
    // The offered lists pass through in the order they arrive — the product's own attachment order,
    // which nothing on the till re-sorts.
    variants: offer.variants.map((variant) => {
      const difference = subtractDecimal(decimal(variant.unitPrice), decimal(offer.unitPrice));
      return {
        ...sellingValuesOf(variant),
        id: variant.id,
        name: variant.name,
        customerName: variant.customerName,
        kitchenName: variant.kitchenName,
        image: variant.image,
        unitPrice: variant.unitPrice,
        unitPriceDifference: compareDecimal(difference, decimal("0")) === 0 ? null : difference,
        available: variant.available,
      };
    }),
    offeredModifiers: offer.offeredModifiers,
    dietaryDeclarations: offer.dietaryDeclarations,
    diet: offer.diet,
    dietDerivation: offer.dietDerivation,
    dietOverride: offer.dietOverride,
  };
}

/**
 * One basket line the till sends to `POST /api/sales`: never a price — the server re-prices.
 *
 * `options` answers the dish's options lists, one entry per list, naming the list and the chosen
 * label; `extras` answers its extras lists, one entry per list, naming the PRODUCTS picked off it and
 * how many of each this dish takes. Each key is ABSENT on a line that answered nothing of that kind —
 * never `[]`. Every ACTIVE options list a dish attaches must be answered, or the line is refused
 * `options.label_required` (`validateOptionSelections`, `packages/catalogue/src/option-contract.ts`).
 *
 * `note` is a NON-FISCAL free-text kitchen instruction, stored on the working-order line only, never on
 * the sale. It is ABSENT for a plain line — a whitespace-only note is omitted.
 */
export interface SaleLine {
  /** Stable server line identity on a retrieved order; omitted for a newly selected line. */
  workingOrderLineId?: string;
  menuItemId?: string;
  variantId?: string;
  quantity: string;
  extras?: ExtraSelection[];
  options?: OptionSelection[];
  note?: string;
}

/**
 * One round line sent to {@link TillApi.addTabRound}. `courseId` is the waiter's course OVERRIDE; absent,
 * the server uses the product's default course. `hold: true` inserts the line without firing it,
 * whatever its course; an un-held line OMITS the field.
 */
export interface RoundLine extends SaleLine {
  courseId?: string;
  hold?: boolean;
}

/** A cash tender: the full amount the operator keyed in (the server computes the change). */
export interface CashTender {
  method: "cash";
  amount: string;
}

/**
 * A manual card tender, charged on the standalone bank terminal. `amount` is the sale total (never
 * over-tendered, so no change); `externalRef` is the terminal's optional operation number.
 */
export interface CardTender {
  method: "card";
  amount: string;
  externalRef?: string;
}

/** Either tender `POST /api/sales` accepts. The server distinguishes them on `method`. */
export type Tender = CashTender | CardTender;

/**
 * One line of the FILED composition the receipt identifies (RD 1619/2012 art. 7.1.e): `descriptions`
 * in the invoice locale, the display `quantity`, and the GROSS line total. The receipt renders THESE,
 * never the client basket, so the printed line list cannot diverge from the invoice.
 */
export interface TillSaleLine {
  /** The dish's frozen answers to its options lists; absent on a line that answered none and on
   *  every child line. The six names per answer are the server's, copied by value. */
  optionSnapshots?: OptionSnapshot[];
  descriptions: Record<string, string>;
  /** Unit values frozen with the filed line; null for a modifier child. */
  unitName?: Record<string, string> | null;
  unitPrecision?: number | null;
  quantity: string;
  gross: string;
  /** The `lineNo` of this row's PARENT dish when it is a CHILD modifier line, else null/absent.
   *  Presentation only — never hashed, never a fiscal figure. */
  parentLineNo?: number | null;
}

/**
 * How a filed sale was paid, read back from the committed rows: `unpaid` is an invoice issued before
 * collection, `cash` carries the change, and `card` the whole charge (`charged` = total + tip), the
 * `tip` ("0.00" when none) and the operator `reference` (null for an integrated capture). Card-present
 * identity belongs only to the separate payment slip.
 */
export type TenderBlock =
  | { method: "unpaid" }
  | { method: "cash"; change: string }
  | {
      method: "card";
      charged: string;
      tip: string;
      reference: string | null;
    };

/** `POST /api/sales` success — the ticket payload the receipt view renders. */
export interface TillSaleResult {
  /** Issuer identity stored with the filed invoice; immediate issuance responses may omit it. */
  issuer?: { venueName: string; nif: string };
  /** The table/operator label and venue order number printed on every document as its grouping key. */
  orderLabel: string | null;
  orderNumber: number;
  invoiceNumber: string;
  issuedAt: string;
  total: string;
  vatBreakdown: VatBreakdownEntry[];
  /** The filed line list, rendered by the receipt instead of the client basket. */
  lines: TillSaleLine[];
  tender: TenderBlock;
  qr: string;
}

/**
 * One row of `GET /api/working-orders` — a parked order the counter can retrieve. `total` is the GROSS
 * (VAT-inclusive) draft total; `label` is null when the order was parked without one.
 */
export interface HeldOrderSummary {
  id: string;
  orderNumber: number;
  label: string | null;
  itemCount: number;
  total: string;
  openedAt: string;
}

/**
 * One CHILD line of a retrieved held order's dish: the picked product, its three frozen names, the
 * price it was sold at, and how many of it this dish takes. See {@link HeldOrder}'s `extras` for why
 * this is values rather than a selection.
 */
export interface HeldExtra {
  productId: string | null;
  name: string;
  descriptions: Record<string, string>;
  kitchenName: string | null;
  price: string;
  quantity: number;
}

/**
 * `GET /api/working-orders/:id` — a retrieved parked order: its stored inputs and commercial snapshots,
 * enough to rebuild its basket even when a line's live offer is no longer available. `quantity` is a
 * three-place decimal string ("2.000").
 */
export interface HeldOrder {
  id: string;
  orderNumber: number;
  label: string | null;
  lines: (Omit<SaleLine, "extras" | "options"> & {
    productId?: string;
    /**
     * What each CHILD line of this dish froze, with `quantity` per dish. These are VALUES, not a
     * re-sendable selection — a child holds no list id, so an edit re-derives one from the dish's live
     * offer (`deriveExtraSelections`, `../state/held-extras.ts`).
     */
    extras?: HeldExtra[];
    product?: TillProduct;
    /**
     * The dish's frozen answers to its options lists; absent on a line that answered none and on
     * every child line. The six names per answer are the server's, copied by value.
     *
     * `options` is deliberately NOT here: a frozen answer carries no list or label id, so the till
     * re-derives them by matching these names against the dish's live offered lists
     * (`deriveOptionSelections`, `../state/held-options.ts`). The match is on the STAFF name alone, so
     * a list or label whose staff wording changed matches nothing and the operator answers it again.
     */
    optionSnapshots?: OptionSnapshot[];
  })[];
}

/**
 * The per-location pay-timing mode. `prepay` pays at order; `invoice_first` and `ticket_then_pay`
 * place the order first and collect payment later.
 */
export type OrderFlow = "prepay" | "invoice_first" | "ticket_then_pay";

/** The kitchen state a ticket item advances through: `queued → preparing → ready`. */
export type TicketState = "queued" | "preparing" | "ready";

/**
 * A working order's own status (`open → placed → settled|abandoned`). The station queue carries it so
 * the display offers the collect action only on a `settled` order awaiting its counter handover
 * ({@link TillApi.markCollected}).
 */
export type WorkingOrderStatus = "open" | "placed" | "settled" | "abandoned";

/**
 * `POST /api/working-orders/:id/place` success. `invoice_first` files a deferred invoice at placing;
 * the other modes file nothing then, so every field past `id`/`status` is present only for it.
 */
export interface PlaceOrderResult {
  id: string;
  status: "placed" | "settled";
  invoiceNumber?: string;
  issuedAt?: string;
  total?: string;
  qr?: string;
  vatBreakdown?: VatBreakdownEntry[];
}

/**
 * One configured kitchen station from `GET /api/stations`. `isDefault` names the venue's single fallback
 * station (the counter/pass).
 */
export interface Station {
  id: string;
  name: string;
  displayOrder: number;
  isDefault: boolean;
  active: boolean;
}

/**
 * One selected option on a queue item: the child modifier line's SNAPSHOTTED `descriptions`, which the
 * display localises client-side. A modifier is never its own ticket item; it rides beneath its parent.
 */
export interface QueueModifier {
  descriptions: Record<string, string>;
  /** The extra's OWN allergens, shown beside the dish's own — never folded. Absent/null when it
   *  declares none. */
  addAllergens?: Record<string, { presence: "contains" | "may_contain"; source?: string }> | null;
  /** The extra's OWN positive dietary suitability, shown beside the dish's own. Absent/empty when it
   *  declares none. */
  suitableFor?: string[] | null;
}

/**
 * The dish's OWN allergen profile on a queue/expo item, with no modifier contribution. `pending` is true
 * when the dish's allergens are unreviewed, so the display shows the plate as unverified. Display-only —
 * never a fiscal value.
 */
export interface AsServedAllergens {
  allergens: Record<string, { presence: "contains" | "may_contain"; source?: string }>;
  pending: boolean;
}

/** One ticket item on a station's queue; `id` is the per-line bump target. */
export interface StationQueueItem {
  /** The dish's frozen answers to its options lists; absent on a line that answered none and on
   *  every child line. The six names per answer are the server's, copied by value. */
  optionSnapshots?: OptionSnapshot[];
  id: string;
  workingOrderLineId: string;
  state: TicketState;
  /** The line's snapshotted KITCHEN name — the kitchen name falling back to the staff name, the
   * variant's own on a variant line. */
  name: string;
  /** The line's quantity, as a three-place decimal string, e.g. "2.000". */
  quantity: string;
  /** Unit values frozen with the line. Absent/null only on older payloads. */
  unitName?: Record<string, string> | null;
  unitPrecision?: number | null;
  /** The dish's selected options, in selection order; absent reads as none. */
  modifiers?: QueueModifier[];
  /** The dish's OWN allergen profile; absent renders nothing. */
  asServed?: AsServedAllergens;
  /** The dish's OWN diet profile, the diet twin of {@link asServed}; absent renders nothing. */
  asServedDiet?: DietProfile;
  /** The item's course, or `null` for a line with none — the display groups the queue by it. */
  course: StationQueueCourse | null;
  /** `null` while the item's course is HELD — not advanceable (`ticket.item_held`); a timestamp once
   *  fired. */
  firedAt: string | null;
  /** The NON-FISCAL kitchen note as frozen at fire, so a later edit never changes what the cook sees. */
  note?: string | null;
}

/** The course a queue item was fired for; `null` on the item when its line carried no course. */
export interface StationQueueCourse {
  id: string;
  name: string;
  displayOrder: number;
}

/**
 * One order's lines at a station. `queuedAt` is that of the order's OLDEST line at this station — the
 * group's ordering key and the age-colouring anchor.
 */
export interface StationQueueGroup {
  orderId: string;
  orderNumber: number;
  label: string | null;
  queuedAt: string;
  /** The order's own status. Abandoned and collected orders are excluded server-side, so a `settled`
   *  order here is a pickup awaiting its counter handover ({@link TillApi.markCollected}). */
  status: WorkingOrderStatus;
  items: StationQueueItem[];
  /** This station's order-timing thresholds. Every group from one call shares them; they ride
   *  per-group so the widget can re-derive {@link queuedAt}'s band locally between refreshes
   *  (`classifyBand`, `@waitron/shared`). */
  thresholds: StationThresholds;
}

/**
 * `POST /api/device/join` success: the pending REQUEST's id and the two-digit number an admin picks out
 * of three in the dashboard to approve it. The device token leaves the server ONLY in the httpOnly
 * `Set-Cookie`. `joinId` IS the id the device will have once accepted — `acceptDeviceJoinRequest`
 * carries the request's id onto the `devices` row (`apps/server/src/join-requests.ts`).
 */
export interface DeviceJoinResult {
  joinId: string;
  verificationNumber: string;
}

/**
 * `GET /api/device/join/status` success. `not_approved` folds denied, lapsed and never-existed
 * together: the joiner's recovery is to knock again in every one of those cases.
 */
export interface DeviceJoinStatus {
  status: "pending" | "approved" | "not_approved";
}

/**
 * `GET /api/device/me` success — the enrolled device's own NON-SECRET identity, read on boot to choose
 * which shell the till boots into (via {@link kindOfFormFactor}). `formFactor` is a plain `string`, not
 * a union: the client branches only on the values it knows, so a new server form factor never breaks
 * an older client.
 */
export interface DeviceIdentity {
  deviceId: string;
  formFactor: string;
  name: string;
  stationId: string | null;
  /** The `tills` row a sale-capable device rings against; `null` for a `kds_station`. */
  tillId?: string | null;
  /** The per-device receipt printer; `null` when none. */
  receiptPrinterId?: string | null;
  hasCashDrawer?: boolean;
}

/**
 * `GET /api/device/station` success — the enrolled display's OWN bound station and its queue. The
 * device cookie names the station, so there is no id to pass.
 */
export interface DeviceStation {
  station: { id: string; queue: StationQueueGroup[] };
}

/**
 * The dev-only `GET /api/dev/devices` list: this venue's ACTIVE enrolled devices, each with its derived
 * `kind`.
 */
export interface DevDevice {
  id: string;
  kind: string;
  label: string;
  tillId: string | null;
  stationId: string | null;
  active: boolean;
}
export interface DevDeviceList {
  devices: DevDevice[];
}

/**
 * One item on the cross-station expo/pass board. Unlike {@link StationQueueItem} it carries the RESOLVED
 * `stationName`, so the expediter sees which station is lagging.
 */
export interface ExpoItem {
  /** The dish's frozen answers to its options lists; absent on a line that answered none and on
   *  every child line. The six names per answer are the server's, copied by value. */
  optionSnapshots?: OptionSnapshot[];
  id: string;
  name: string;
  qty: string;
  /** Unit values frozen with the line. Absent/null only on older payloads. */
  unitName?: Record<string, string> | null;
  unitPrecision?: number | null;
  stationName: string;
  state: TicketState;
  /** `null` while the item's course is HELD; a timestamp once fired. */
  firedAt: string | null;
  /** `null` until the expediter dispatches it (`markCourseAway`); a timestamp once away to the floor. */
  awayAt: string | null;
  /** The kitchen note as frozen at fire, as {@link StationQueueItem.note}. */
  note?: string | null;
  /** The dish's selected options, in selection order; absent reads as none. */
  modifiers?: QueueModifier[];
  /** The dish's OWN allergen profile; absent renders nothing. */
  asServed?: AsServedAllergens;
  /** The dish's OWN diet profile; absent renders nothing. */
  asServedDiet?: DietProfile;
  /**
   * This item's own queued-at, ISO. Unlike {@link StationQueueGroup.thresholds} the timing rides PER
   * ITEM: one expo order's items can span several stations, each with its own thresholds.
   */
  queuedAt: string;
  /** This item's OWN station's order-timing thresholds (see {@link queuedAt}). */
  thresholds: StationThresholds;
  /** This item's age band on the DB clock at fetch time. Not read by `till-expo-screen`, which derives
   *  the band from {@link queuedAt} and {@link thresholds}. */
  band: TimingBand;
}

/**
 * One course section of an expo order; a null course has `courseId`/`courseName`/`displayOrder` null
 * and sorts EARLIEST. `fired` is true once EVERY item carries `firedAt`; `away` once every item carries
 * `awayAt`.
 */
export interface ExpoCourse {
  courseId: string | null;
  courseName: string | null;
  displayOrder: number | null;
  fired: boolean;
  away: boolean;
  items: ExpoItem[];
}

/**
 * One order on the cross-station expo/pass board, its items grouped BY COURSE. `tableLabel` is omitted
 * when the order maps to no table. The server excludes abandoned, collected and FULLY-away orders; a
 * surviving order still carries its away items, so the SCREEN hides fully-away courses (via
 * {@link ExpoCourse.away}).
 */
export interface ExpoOrder {
  orderId: string;
  tableLabel?: string;
  orderNumber: number;
  openedMinutes: number;
  courses: ExpoCourse[];
  /** The worst age band across the order's UNSERVED lines on the DB clock at fetch time. Not read by
   *  `till-expo-screen`, which derives the band from each item's `queuedAt` and thresholds. */
  worstBand: TimingBand;
}

/**
 * `POST /api/pay` outcome. Unlike {@link TillSaleResult}'s throw-or-ticket shape, a decline, stall or
 * offline refusal is DATA, never a thrown `{ code }` — nothing may block a sale on anything but the
 * sale itself (CLAUDE.md §5) — so the caller branches on `outcome` instead of catching.
 */
export type PayOutcome =
  | { outcome: "captured"; ticket: TillSaleResult }
  | { outcome: "declined" }
  | { outcome: "timeout" }
  | { outcome: "network_unavailable" };

/** The `absence_kind` members; the server re-validates against the real enum. */
export type AbsenceKind = "holiday" | "sick_leave" | "leave" | "unpaid";

/** One of my upcoming shifts (`GET /api/schedule/shifts`). */
export interface MyShift {
  id: string;
  locationId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  role: string | null;
  rosterVersionId: string | null;
}

/**
 * One swap I'm party to (`GET /api/schedule/swaps`). `direction` says which side I'm on:
 * `offered_to_me` (I can accept it while `status === "requested"`) or `requested_by_me`.
 */
export interface MySwap {
  id: string;
  requestedByPersonId: string;
  fromShiftId: string;
  toPersonId: string;
  toShiftId: string | null;
  status: "requested" | "accepted" | "approved" | "rejected";
  createdAt: string;
  direction: "offered_to_me" | "requested_by_me";
}

/** One of my absences, any status (`GET /api/schedule/absences`). */
export interface MyAbsence {
  id: string;
  personId: string;
  kind: AbsenceKind;
  startsOn: string;
  endsOn: string;
  status: "requested" | "approved" | "rejected";
  note: string | null;
  createdAt: string;
}

/** One active floor-plan zone from `GET /api/zones`. */
export interface FloorZone {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
}

/**
 * One row of the live-floor occupancy read-model from `GET /api/tables/state`. The
 * `tabId`/`tabLineCount`/`tabTotal` trio is present iff a tab is open; `tabTotal` is the tab's gross
 * draft total as a two-place decimal string. `status` is the table's MANUAL service status,
 * independent of occupancy. `pendingToServe` counts the open tab's lines still to deliver,
 * `readyToServe` those the kitchen has bumped `ready` but the waiter has not served, and `enRoute`
 * those the pass has dispatched but the waiter has not acknowledged; all three are DISTINCT from
 * `pendingDeliveries` (uncollected counter deliveries).
 */
export interface TableState {
  id: string;
  label: string;
  zoneId: string | null;
  capacity: number | null;
  state: "free" | "open-tab" | "delivery-pending";
  hasOpenTab: boolean;
  tabId?: string;
  tabLineCount?: number;
  tabTotal?: string;
  pendingDeliveries: number;
  pendingToServe: number;
  readyToServe: number;
  enRoute: number;
  /**
   * The worst age band across the open tab's UNSERVED lines; `"fresh"` for a free table. Only the
   * REDUCED band is sent, not the per-line ages and thresholds, so the floor cannot re-derive it
   * locally: it is fixed until the next `getTablesState` fetch.
   */
  timingBand: TimingBand;
  status: { id: string; label: string; color: string } | null;
  /**
   * The table's next imminent `booked` reservation today, or `null`. Only `time` (venue-local "HH:MM")
   * is projected, so the party size and contact name are deliberately kept off every till device.
   */
  nextReservation: { time: string } | null;
  /**
   * Placement on the floor-plan canvas — coordinates in 0..1000 permille, `rotation` in degrees — or
   * `null` for an unplaced table.
   */
  posX: number | null;
  posY: number | null;
  shape: TableShape | null;
  rotation: number | null;
}

/** The rendered shape of a placed table; a server round-trip re-validates against the real vocabulary. */
export type TableShape = "round" | "square" | "rect";

/**
 * The body of a `PUT /api/tables/:id/placement`; the server re-validates every field. `zoneId` is
 * `| null` because the canvas can emit a placement for a still-zoneless table — the server refuses it,
 * so a `null` never silently persists.
 */
export interface TablePlacement {
  posX: number;
  posY: number;
  shape: TableShape;
  rotation: number;
  zoneId: string | null;
}

/** One ACTIVE table service status from `GET /api/statuses`, for the Estado picker. */
export interface TableServiceStatus {
  id: string;
  label: string;
  color: string;
}

/** `POST /api/tables/:id/tab` success — the new tab's working-order id and its order number. */
export interface TabResult {
  tabId: string;
  orderNumber: number;
}

/**
 * One line of an open tab from `GET /api/working-orders/:id/lines`. A tab does NOT re-price:
 * `unitPriceGross` is the gross unit price LOCKED at add-time. `servedAt` is the pre-fiscal served
 * marker (`null` ⇒ still to serve).
 */
export interface TabLine {
  /** The line's frozen STAFF label — the variant's name on a variant line, else the product's. Absent
   * only on a fixture that omits it, which falls back to the live catalogue name. */
  name?: string;
  /** The dish's frozen answers to its options lists; absent on a line that answered none and on
   *  every child line. The six names per answer are the server's, copied by value. */
  optionSnapshots?: OptionSnapshot[];
  lineNo: number;
  /** The line's product. `string | null` because the COLUMN is nullable, NOT because a child line lacks
   * a product: an extras child carries the PICKED product. Tell a child from a dish by
   * {@link parentLineNo}, never by this field. */
  productId: string | null;
  /** The `lineNo` of this row's PARENT dish when it is a CHILD extras line, else `null` — the one field
   * on this wire that tells the two apart. An absent value reads as a dish. */
  parentLineNo?: number | null;
  quantity: string;
  /** How many decimal places the line's unit takes, frozen when it was rung (0 = sold by the unit), or
   * null on an extras child. The split reads this, never the product: a line sold as a variant names
   * the variant, which is not one of the till's products. Absent reads as three places. */
  unitPrecision?: number | null;
  unitPriceGross: string;
  servedAt: string | null;
  /** The line's RESOLVED kitchen course, or null when it has none. */
  courseId: string | null;
  /** When the line's kitchen ticket item FIRED, or null while its course is still HELD. */
  firedAt: string | null;
  /** The line's kitchen ticket item state, or null when it has no LIVE ticket item. A child modifier
   * line never has one; a parent line can lack one too, so null is not impossible for a parent. A
   * RECALLABLE line has `firedAt` set and `state === "queued"`; "preparing"/"ready" is cancel-only. */
  state: TicketState | null;
}

/**
 * One entry in a line transfer. Omit `quantity` (or pass the whole line quantity) for a whole-line move;
 * a smaller decimal string splits the line, the destination inheriting the same locked per-unit price.
 */
export interface TabTransfer {
  lineNo: number;
  quantity?: string;
}

export class TillApi {
  readonly #baseUrl: string;
  readonly #fetchImpl: FetchLike;
  #serviceZoneId?: string;
  #localesPromise?: Promise<{
    locales: Array<{ code: string; label: string }>;
    venueDefault: string;
  }>;

  /**
   * @param baseUrl prefixed to every path (default `""`: same-origin).
   * @param fetchImpl the `fetch` to use (default the global; a test injects a stub).
   */
  constructor(baseUrl = "", fetchImpl: FetchLike = fetch) {
    this.#baseUrl = baseUrl;
    this.#fetchImpl = fetchImpl;
  }

  getTill(): Promise<TillInfo> {
    return this.#request<TillInfo>("/api/till", "GET");
  }

  getContentLanguages(): Promise<ContentLanguages> {
    return this.#request<ContentLanguages>("/api/content-languages", "GET");
  }

  /** `GET /api/locales` — the venue's offered languages and its fallback locale. Public (pre-login). */
  getLocales(): Promise<{ locales: Array<{ code: string; label: string }>; venueDefault: string }> {
    // Fetched once and shared; a rejection clears the cache so a transient failure retries.
    this.#localesPromise ??= this.#request<{
      locales: Array<{ code: string; label: string }>;
      venueDefault: string;
    }>("/api/locales", "GET").catch((err) => {
      this.#localesPromise = undefined;
      throw err;
    });
    return this.#localesPromise;
  }

  listStaff(): Promise<StaffMember[]> {
    return this.#request<StaffMember[]>("/api/staff", "GET");
  }

  login(personId: string, pin: string): Promise<SessionResult> {
    return this.#request<SessionResult>("/api/session", "POST", { personId, pin });
  }

  async logout(): Promise<void> {
    await this.#request<{ ok: boolean }>("/api/session", "DELETE");
  }

  /**
   * Persist the signed-in operator's OWN UI language → `PUT /api/session/locale`. The session names the
   * person, so there is no id to pass. An unsupported `code` rejects with `locale.unsupported`.
   */
  async putLocale(code: string): Promise<void> {
    await this.#request<void>("/api/session/locale", "PUT", { locale: code });
  }

  /** `GET /api/products` — see {@link ProductCatalogue}. */
  listProducts(): Promise<ProductCatalogue> {
    return this.#request<ProductCatalogue>("/api/products", "GET");
  }

  async listZoneOffers(zoneId: string): Promise<ZoneOfferCatalogue> {
    return this.#request<ZoneOfferCatalogue>(
      `/api/service-zones/${encodeURIComponent(zoneId)}/offers`,
      "GET",
    );
  }

  async listDefaultZoneOffers(): Promise<ZoneOfferCatalogue> {
    return this.#request<ZoneOfferCatalogue>("/api/default-service-zone/offers", "GET");
  }

  /** Set the service zone used for newly created counter orders after the app accepts an offer load. */
  setServiceZone(zoneId: string): void {
    this.#serviceZoneId = zoneId;
  }

  /**
   * Ring one sale over a persisted working order. `workingOrderId` is the pay-idempotency key: the till
   * holds it stable across a lost-response retry, so a re-sent pay REPLAYS against the same row rather
   * than filing a second chained fiscal record (unrepairable — an invoice number is never reused). To
   * pay a PARKED order the till sends that order's own id.
   */
  recordSale(
    lines: SaleLine[],
    tender: Tender,
    workingOrderId: string,
    zoneId?: string,
  ): Promise<TillSaleResult> {
    return this.#request<TillSaleResult>("/api/sales", "POST", {
      lines,
      tender,
      workingOrderId,
      zoneId: zoneId ?? this.#serviceZoneId,
    });
  }

  /**
   * Pay over the INTEGRATED card terminal → `POST /api/pay`. `id` is the pay-idempotency key, as in
   * {@link recordSale}; `lines` is ignored server-side for a retrieved or placed order, which files its
   * own stored lines. `allowOffline` is per-transaction staff consent to accept the card offline.
   * `readerId` names a reader other than the device default; omitted, the server uses the default. A
   * decline is data, not a throw — see {@link PayOutcome}.
   */
  pay(req: {
    id: string;
    lines: SaleLine[];
    zoneId?: string;
    tip?: string;
    allowOffline?: boolean;
    simulationOutcome?: "captured" | "declined";
    readerId?: string;
  }): Promise<PayOutcome> {
    return this.#request<PayOutcome>("/api/pay", "POST", {
      ...req,
      zoneId: req.zoneId ?? this.#serviceZoneId,
    });
  }

  /**
   * Reprint a FILED sale's customer receipt → `POST /api/sales/:id/reprint`, by the till's own
   * working-order id. Paper only: it files NOTHING and ignores the location's `receipt_print_mode`. An
   * id naming no filed sale, or a till with no active printer, is a 200 no-op.
   */
  async reprint(workingOrderId: string): Promise<void> {
    await this.#request<void>(`/api/sales/${workingOrderId}/reprint`, "POST", {});
  }

  /** Print the ORIGINAL receipt offered at invoice issuance. */
  async printReceipt(workingOrderId: string): Promise<void> {
    await this.#request<void>(`/api/sales/${workingOrderId}/receipt`, "POST", {});
  }

  /** Print the separate card-payment slip for the filed sale's integrated capture, when one exists. */
  async printPaymentSlip(workingOrderId: string): Promise<void> {
    await this.#request<void>(`/api/sales/${workingOrderId}/payment-slip`, "POST", {});
  }

  /**
   * Open the cash drawer with no sale → `POST /api/drawer/open`. Authorized and audited server-side; the
   * till's printer is resolved there, so it takes no id.
   *
   * Under a `gated` policy an operator whose role lacks `cash.drawer` is refused
   * `authorization.not_permitted` (403); the caller then fetches {@link listDrawerAuthorizers} and
   * retries with `override: { personId, pin }` for the authorizing supervisor. The override travels
   * ONLY in this request's body, never a URL, and only when supplied. A wrong PIN rejects `pin.invalid`
   * (401); a till with no receipt printer `drawer.no_printer` (400).
   */
  async openDrawer(override?: { personId: string; pin: string }): Promise<void> {
    await this.#request<void>("/api/drawer/open", "POST", override ? { override } : {});
  }

  /**
   * The eligible authorizers for a gated drawer open → `GET /api/drawer/authorizers`: the active persons
   * whose role holds `cash.drawer`, with no secrets.
   */
  listDrawerAuthorizers(): Promise<StaffMember[]> {
    return this.#request<StaffMember[]>("/api/drawer/authorizers", "GET");
  }

  /**
   * Park a working order to pay later → `POST /api/working-orders`. `id` is client-minted so a
   * lost-response retry is idempotent against the primary key; `lines` carry no price.
   */
  parkOrder(req: { id: string; lines: SaleLine[]; zoneId?: string; label?: string }): Promise<{
    id: string;
    orderNumber: number;
  }> {
    return this.#request<{ id: string; orderNumber: number }>("/api/working-orders", "POST", {
      ...req,
      zoneId: req.zoneId ?? this.#serviceZoneId,
    });
  }

  /** The cross-till held list → `GET /api/working-orders`: every OPEN working order in the venue. */
  listWorkingOrders(): Promise<HeldOrderSummary[]> {
    return this.#request<HeldOrderSummary[]>("/api/working-orders", "GET");
  }

  /**
   * Retrieve one parked order → `GET /api/working-orders/:id`. An id naming no OPEN order rejects with
   * `working_order.not_found`.
   */
  retrieveWorkingOrder(id: string): Promise<HeldOrder> {
    return this.#request<HeldOrder>(`/api/working-orders/${id}`, "GET");
  }

  /**
   * Edit a parked order → `PUT /api/working-orders/:id`. A full REPLACEMENT: the sent `lines` and
   * `label` become the order's new state (`label` absent clears it). Only an `open` order may change
   * (else `working_order.not_open`).
   */
  async updateWorkingOrder(id: string, req: { lines: SaleLine[]; label?: string }): Promise<void> {
    await this.#request<void>(`/api/working-orders/${id}`, "PUT", req);
  }

  /**
   * Discard a parked order (`open → abandoned`) → `DELETE /api/working-orders/:id`. A non-open or
   * unknown id rejects with `working_order.not_open`.
   */
  async abandonWorkingOrder(id: string): Promise<void> {
    await this.#request<void>(`/api/working-orders/${id}`, "DELETE");
  }

  /**
   * Place a working order → `POST /api/working-orders/:id/place` (`open → placed`): freezes its
   * composition and opens its amendment log; for `invoice_first` also files a deferred (unpaid) chained
   * invoice. A non-open or absent id rejects with `working_order.not_open`.
   */
  placeOrder(id: string): Promise<PlaceOrderResult> {
    return this.#request<PlaceOrderResult>(`/api/working-orders/${id}/place`, "POST");
  }

  /**
   * Collect and finalise a PLACED order → `POST /api/working-orders/:id/collect`. `invoice_first`
   * settles the already-issued invoice with `tender`; `ticket_then_pay` files from the order's stored
   * lines — never a client basket. A still-open or absent id rejects with `working_order.not_placed`.
   */
  collectOrder(id: string, tender: Tender): Promise<TillSaleResult> {
    return this.#request<TillSaleResult>(`/api/working-orders/${id}/collect`, "POST", { tender });
  }

  /** The venue's ACTIVE kitchen stations → `GET /api/stations`, by display order then name. */
  listStations(): Promise<Station[]> {
    return this.#request<Station[]>("/api/stations", "GET");
  }

  /**
   * One station's kitchen queue → `GET /api/stations/:id/queue`, grouped by order, oldest first. A
   * malformed or unknown station id rejects with `station.not_found`.
   */
  getStationQueue(stationId: string): Promise<StationQueueGroup[]> {
    return this.#request<StationQueueGroup[]>(`/api/stations/${stationId}/queue`, "GET");
  }

  /**
   * Advance ONE ticket item one kitchen step → `POST /api/ticket-items/:id/advance`. `to` is the NEXT
   * state; a skip, repeat or backwards move, or an unknown item, rejects with
   * `ticket.invalid_transition`.
   */
  async advanceTicketItem(itemId: string, to: Exclude<TicketState, "queued">): Promise<void> {
    await this.#request<void>(`/api/ticket-items/${itemId}/advance`, "POST", { to });
  }

  /**
   * Advance a WHOLE ticket → `POST /api/orders/:id/stations/:sid/advance`: every not-yet-`to` line of
   * the order at the station. An empty match is a no-op, so unlike {@link advanceTicketItem} it never
   * rejects on a transition.
   */
  async advanceTicket(
    orderId: string,
    stationId: string,
    to: Exclude<TicketState, "queued">,
  ): Promise<void> {
    await this.#request<void>(`/api/orders/${orderId}/stations/${stationId}/advance`, "POST", {
      to,
    });
  }

  // --- Device mode: these verbs need NO operator session; the httpOnly device cookie rides
  // `credentials: "include"` like the session cookie. ---

  /**
   * Ask to join this venue → `POST /api/device/join`. Unauthenticated. Refused `device.pairing_closed`
   * (403) unless an admin has pairing mode open; otherwise sets an httpOnly cookie naming a pending
   * REQUEST, inert until an admin approves it. A flood draws `device.join_rate_limited`; a venue at its
   * pending cap `device.join_full`.
   */
  join(name: string): Promise<DeviceJoinResult> {
    return this.#request<DeviceJoinResult>("/api/device/join", "POST", { name });
  }

  /**
   * Am I in yet? → `GET /api/device/join/status`. No new cookie follows an approval: the SAME cookie
   * that named the request now names the device. A missing or malformed cookie rejects
   * `device.unauthorized` (401).
   */
  joinStatus(): Promise<DeviceJoinStatus> {
    return this.#request<DeviceJoinStatus>("/api/device/join/status", "GET");
  }

  /**
   * The enrolled display's OWN bound station and queue → `GET /api/device/station`. A missing, rejected
   * or revoked cookie rejects `device.unauthorized` (401).
   */
  getDeviceStation(): Promise<DeviceStation> {
    return this.#request<DeviceStation>("/api/device/station", "GET");
  }

  /**
   * This enrolled device's OWN identity → `GET /api/device/me`. A missing, rejected or revoked cookie
   * rejects `device.unauthorized` (401) — the signal that this browser is not an enrolled device.
   */
  getDeviceIdentity(): Promise<DeviceIdentity> {
    return this.#request<DeviceIdentity>("/api/device/me", "GET");
  }

  /**
   * Advance ONE of the bound station's ticket items → `POST /api/device/ticket-items/:id/advance`, the
   * device-scoped {@link advanceTicketItem}: the cookie's own station is the only one it may touch. An
   * item at ANOTHER station rejects `device.forbidden_station` (403); an illegal transition or unknown
   * item `ticket.invalid_transition`.
   */
  async deviceAdvance(itemId: string, to: Exclude<TicketState, "queued">): Promise<void> {
    await this.#request<void>(`/api/device/ticket-items/${itemId}/advance`, "POST", { to });
  }

  /** Dev chooser: this venue's ACTIVE enrolled devices (dev-only route, 404 outside devMode). */
  getDevDevices(): Promise<DevDeviceList> {
    return this.#request<DevDeviceList>("/api/dev/devices", "GET");
  }

  /**
   * FIRE a SETTLED order to the kitchen → `POST /api/working-orders/:id/prep` — for an order that pays
   * at order and so never places. A non-settled or absent id rejects `working_order.not_settled`; a
   * re-fire `ticket.already_fired`; incomplete routing `route.missing`.
   */
  async sendToPrep(id: string): Promise<void> {
    await this.#request<void>(`/api/working-orders/${id}/prep`, "POST", {});
  }

  /**
   * Hand a SETTLED, fired order to the customer → `POST /api/orders/:id/collect`. NON-FISCAL: it stamps
   * `collected_at`, which drops the order off the station queue — DISTINCT from {@link collectOrder},
   * the fiscal placed → settled collect. A non-settled or absent id rejects
   * `working_order.not_settled`, an already-collected order `working_order.already_collected`, and one
   * never fired `ticket.not_fired`.
   */
  async markCollected(id: string): Promise<void> {
    await this.#request<void>(`/api/orders/${id}/collect`, "POST", {});
  }

  /**
   * Reprint an order's CURRENT kitchen tickets → `POST /api/orders/:id/reprint`. A SESSION verb: there
   * is no device reprint route. NON-FISCAL and changes no order state; an order with no fired items is a
   * 200 no-op. A malformed or unknown id rejects `working_order.not_found`.
   */
  async reprintOrder(orderId: string): Promise<void> {
    await this.#request<void>(`/api/orders/${orderId}/reprint`, "POST", {});
  }

  /**
   * FIRE a HELD course of an order → `POST /api/orders/:id/courses/:courseId/fire`. NON-FISCAL;
   * idempotent — a course with nothing held is a 200 no-op. A malformed or unknown course id rejects
   * `course.not_found`; a malformed order id `working_order.not_found`.
   */
  async fireCourse(orderId: string, courseId: string): Promise<void> {
    await this.#request<void>(`/api/orders/${orderId}/courses/${courseId}/fire`, "POST", {});
  }

  /**
   * The cross-station expo/pass queue → `GET /api/expo/queue`: orders aggregated into courses ACROSS all
   * stations, oldest first. See {@link ExpoOrder} for what the server excludes.
   */
  getExpoQueue(): Promise<ExpoOrder[]> {
    return this.#request<ExpoOrder[]>("/api/expo/queue", "GET");
  }

  /**
   * Bump a WHOLE course to `ready` across every station → `POST
   * /api/orders/:id/courses/:courseId/ready`: every FIRED, not-yet-`ready` item of the order and course.
   * NON-FISCAL. A course with nothing left to bump is a 200 no-op; a malformed order id rejects
   * `working_order.not_found`, a malformed course id `course.not_found`.
   */
  async bumpCourseReady(orderId: string, courseId: string): Promise<void> {
    await this.#request<void>(`/api/orders/${orderId}/courses/${courseId}/ready`, "POST", {});
  }

  /**
   * DISPATCH a plated course to the floor → `POST /api/orders/:id/courses/:courseId/away`: stamps
   * `away_at` on every `ready` item of the order and course, skipping already-away ones. NON-FISCAL.
   * UNLIKE {@link bumpCourseReady} it existence-checks the course, so a malformed or unknown course id
   * rejects `course.not_found` (404); a malformed order id `working_order.not_found`.
   */
  async markCourseAway(orderId: string, courseId: string): Promise<void> {
    await this.#request<void>(`/api/orders/${orderId}/courses/${courseId}/away`, "POST", {});
  }

  /**
   * Cancel a PLACED order → `POST /api/working-orders/:id/cancel` (`placed → abandoned`), logging an
   * `order_cancelled` amendment carrying `reason`. A blank reason rejects
   * `working_order.reason_required` before any transition; a non-placed or absent id
   * `working_order.not_placed`.
   */
  async cancelOrder(id: string, reason: string): Promise<void> {
    await this.#request<void>(`/api/working-orders/${id}/cancel`, "POST", { reason });
  }

  // --- Live floor. `served_at` is a PRE-FISCAL operational field, so the served markers touch no
  // fiscal path. ---

  /** The venue's ACTIVE floor-plan zones, by display order → `GET /api/zones`. */
  listZones(): Promise<FloorZone[]> {
    return this.#request<FloorZone[]>("/api/zones", "GET");
  }

  /** The venue's ACTIVE service statuses → `GET /api/statuses`; a deactivated status can't be applied. */
  listStatuses(): Promise<TableServiceStatus[]> {
    return this.#request<TableServiceStatus[]>("/api/statuses", "GET");
  }

  /** The live-floor occupancy read-model → `GET /api/tables/state`, one row per active table. */
  getTablesState(): Promise<TableState[]> {
    return this.#request<TableState[]>("/api/tables/state", "GET");
  }

  /**
   * Mark ONE line of an open tab as delivered → `POST /api/working-orders/:orderId/lines/:lineNo/served`.
   * PRE-FISCAL: it never enters `registros`/`computeHuella`.
   */
  async markLineServed(orderId: string, lineNo: number): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/lines/${lineNo}/served`, "POST");
  }

  /** Clear ONE line's delivered marker, for a mis-tap — the inverse of {@link markLineServed}. */
  async unmarkLineServed(orderId: string, lineNo: number): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/lines/${lineNo}/served`, "DELETE");
  }

  /**
   * Open the running tab on a table → `POST /api/tables/:tableId/tab`. `lines` opens it with an initial
   * round; absent, the tab opens empty and the body is `{}`, so the route still has JSON to parse.
   * `table.not_found`, `table.inactive` and `tab.already_open` surface as a rejected `{ code }`.
   */
  openTab(tableId: string, lines?: SaleLine[]): Promise<TabResult> {
    return this.#request<TabResult>(`/api/tables/${tableId}/tab`, "POST", { lines });
  }

  /**
   * Append a round to an open tab → `POST /api/working-orders/:orderId/round`. The new lines are priced
   * at add-time and the existing lines are NOT re-priced. `tab.not_open` and `sale.empty_basket` surface
   * as a rejected `{ code }`.
   */
  async addTabRound(orderId: string, lines: RoundLine[]): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/round`, "POST", { lines });
  }

  /**
   * Read one open tab's lines → `GET /api/working-orders/:orderId/lines`. A non-open or absent tab
   * rejects with `tab.not_open`.
   */
  getTabLines(orderId: string): Promise<TabLine[]> {
    return this.#request<TabLine[]>(`/api/working-orders/${orderId}/lines`, "GET");
  }

  /**
   * Move ONE not-yet-fired line into another course → `PATCH
   * /api/working-orders/:orderId/lines/:lineNo/course`. `null` CLEARS the line's course and is sent as an
   * explicit null, not an absent field. NON-FISCAL. Rejects `tab.not_open`, `course.not_found`,
   * `tab.line_not_found`, or `ticket.already_fired` (correct a fired line via {@link recallLines}).
   */
  async setLineCourse(orderId: string, lineNo: number, courseId: string | null): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/lines/${lineNo}/course`, "PATCH", {
      courseId,
    });
  }

  /**
   * Fire SPECIFIC held lines of an open tab → `POST /api/working-orders/:orderId/lines/send`. An empty
   * `lineNos` releases every held line of the tab. NON-FISCAL; idempotent — an unknown or already-fired
   * line matches nothing. Rejects `tab.not_open`.
   */
  async sendLines(orderId: string, lineNos: number[]): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/lines/send`, "POST", { lineNos });
  }

  /**
   * UN-send not-yet-started lines of an open tab → `POST /api/working-orders/:orderId/lines/recall`, the
   * inverse of {@link sendLines}. NON-FISCAL; a previously-fired line gets a RECALLED correction slip.
   * Rejects `tab.not_open`, `tab.line_not_found`, or `ticket.already_started` (the kitchen has started
   * it); an already-held line is a no-op.
   */
  async recallLines(orderId: string, lineNos: number[]): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/lines/recall`, "POST", { lineNos });
  }

  /**
   * Cancel (VOID) ONE line of an open tab → `DELETE /api/working-orders/:orderId/lines/:lineNo`: the
   * cancel path for a line the kitchen has already STARTED, which can no longer be recalled. NON-FISCAL;
   * the server prints a correction slip. Rejects `tab.not_open` or `tab.line_not_found`.
   */
  async voidLine(orderId: string, lineNo: number): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/lines/${lineNo}`, "DELETE");
  }

  /**
   * Set or clear a table's MANUAL service status → `POST /api/tables/:tableId/status`. Keyed by TABLE
   * id: the status belongs to the table, not to any tab. `null` CLEARS it, sent as an explicit null.
   * Rejects `status.not_found`, `status.inactive` or `table.not_found`.
   */
  async setTableStatus(tableId: string, statusId: string | null): Promise<void> {
    await this.#request<void>(`/api/tables/${tableId}/status`, "POST", { statusId });
  }

  /**
   * Relocate this tab's party to a FREE table → `POST /api/tabs/:tabId/move`. No line moves;
   * PRE-FISCAL. Rejects `table.occupied`, `table.inactive`, `table.not_found` or `tab.not_open`.
   */
  async moveTab(orderId: string, toTableId: string): Promise<void> {
    await this.#request<void>(`/api/tabs/${orderId}/move`, "POST", { toTableId });
  }

  /**
   * Extend this tab onto an ADDITIONAL free table → `POST /api/tabs/:tabId/join`. No line moves;
   * PRE-FISCAL. Same rejection codes as {@link moveTab}.
   */
  async joinTable(orderId: string, tableId: string): Promise<void> {
    await this.#request<void>(`/api/tabs/${orderId}/join`, "POST", { tableId });
  }

  /**
   * Combine ANOTHER open tab onto this one → `POST /api/tabs/:tabId/merge`, where the path names the
   * DESTINATION tab and `fromTabId` the source, whose lines move here before it is abandoned.
   * `freeSourceTable` frees the vacated table (`true`) or re-points it at this tab (`false`).
   * PRE-FISCAL. Rejects `tab.not_open` or `tab.merge_self`.
   */
  async mergeTabs(orderId: string, fromTabId: string, freeSourceTable: boolean): Promise<void> {
    await this.#request<void>(`/api/tabs/${orderId}/merge`, "POST", { fromTabId, freeSourceTable });
  }

  /**
   * Move SELECTED items OUT of this tab into another open tab → `POST /api/tabs/:tabId/transfer`, where
   * the path names the SOURCE tab (see {@link TabTransfer}). PRE-FISCAL. Rejects `tab.not_open`,
   * `tab.transfer_self`, `tab.line_not_found`, `tab.transfer_quantity_invalid` or
   * `tab.transfer_duplicate_line`.
   */
  async transferLines(
    orderId: string,
    toTabId: string,
    transfers: readonly TabTransfer[],
  ): Promise<void> {
    await this.#request<void>(`/api/tabs/${orderId}/transfer`, "POST", { toTabId, transfers });
  }

  /** Carve selected items from a table tab into a detached check, ready for the existing pay path. */
  splitTab(orderId: string, transfers: readonly TabTransfer[]): Promise<{ checkId: string }> {
    return this.#request<{ checkId: string }>(`/api/tabs/${orderId}/split`, "POST", { transfers });
  }

  /**
   * Place a table on the floor plan → `PUT /api/tables/:tableId/placement`, gated by the operator's OWN
   * `venue.configure` permission. The server re-checks the gate (client hiding is convenience only) and
   * re-validates the values: `placement.invalid`, `zone.not_found` and `table.not_found` surface as a
   * rejected `{ code }`.
   */
  async setTablePlacement(tableId: string, placement: TablePlacement): Promise<void> {
    await this.#request<void>(`/api/tables/${tableId}/placement`, "PUT", placement);
  }

  /**
   * Un-place a table (its four placement columns become null; its zone stays) →
   * `DELETE /api/tables/:tableId/placement`. Same gate as {@link setTablePlacement}; an unknown id
   * rejects `table.not_found`.
   */
  async clearPlacement(tableId: string): Promise<void> {
    await this.#request<void>(`/api/tables/${tableId}/placement`, "DELETE");
  }

  // --- Staff schedule (`apps/server/src/schedule-api.ts`). The server takes the requester from the
  // session, never from the request body. ---

  /** My shifts over a half-open `[from, to)` window (`YYYY-MM-DD`) → `GET /api/schedule/shifts`. */
  listMyShifts(from: string, to: string): Promise<MyShift[]> {
    return this.#request<MyShift[]>(`/api/schedule/shifts?from=${from}&to=${to}`, "GET");
  }

  /** The swaps I'm party to (offered to me, or requested by me) → `GET /api/schedule/swaps`. */
  listMySwaps(): Promise<MySwap[]> {
    return this.#request<MySwap[]>("/api/schedule/swaps", "GET");
  }

  /**
   * Request a swap → `POST /api/schedule/swaps`: offer one of MY shifts to a colleague; `toShiftId`
   * null is a one-sided give-away. A shift that is not mine rejects `swap.not_permitted`.
   */
  requestSwap(req: {
    fromShiftId: string;
    toPersonId: string;
    toShiftId: string | null;
  }): Promise<{ swapId: string }> {
    return this.#request<{ swapId: string }>("/api/schedule/swaps", "POST", req);
  }

  /**
   * Accept a swap offered TO me → `POST /api/schedule/swaps/:swapId/accept`. A swap not offered to me
   * rejects `swap.not_permitted`; one no longer `requested` `swap.not_acceptable`.
   */
  async acceptSwap(swapId: string): Promise<void> {
    await this.#request<void>(`/api/schedule/swaps/${swapId}/accept`, "POST");
  }

  /** My absences, every status → `GET /api/schedule/absences`. */
  listMyAbsences(): Promise<MyAbsence[]> {
    return this.#request<MyAbsence[]>("/api/schedule/absences", "GET");
  }

  /**
   * Request an absence for myself → `POST /api/schedule/absences`. A range overlapping an existing
   * absence rejects `absence.overlaps`.
   */
  requestAbsence(req: {
    kind: AbsenceKind;
    startsOn: string;
    endsOn: string;
    note: string | null;
  }): Promise<{ absenceId: string }> {
    return this.#request<{ absenceId: string }>("/api/schedule/absences", "POST", req);
  }

  /**
   * The one request path every method funnels through. A non-2xx becomes a rejected
   * `{ ...params, code, status }` read from the server's `{ error: { code, params } }` envelope, falling
   * back to `server.internal` when the body names no code, so callers branch on a stable domain code;
   * `status` is the answered HTTP status.
   *
   * `fetchImpl` is read into a local so it is invoked as a free function, not as a method of `this`
   * (which would rebind a native `fetch`).
   *
   * A 2xx with an EMPTY body resolves to `undefined`, where `res.json()` would throw; a method
   * whose route answers one types `T` as `void`.
   */
  async #request<T>(path: string, method: string, body?: unknown): Promise<T> {
    const fetchImpl = this.#fetchImpl;
    const init: RequestInit =
      body === undefined
        ? { method, credentials: "include" }
        : {
            method,
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          };
    const res = await fetchImpl(this.#baseUrl + path, init);
    if (!res.ok) {
      // The body is untrusted: it may not be JSON, and the literal `null` is valid JSON, so the parsed
      // value is checked for being an object before `.error` is read off it.
      const parsed: unknown = await res.json().catch(() => undefined);
      const envelope = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined;
      const rawCode = envelope?.code;
      const code = typeof rawCode === "string" ? rawCode : "server.internal";
      const rawParams = envelope?.params;
      const params = isRecord(rawParams) ? rawParams : undefined;
      // `params` first, so a `code` or `status` key inside it cannot overwrite the validated ones.
      throw { ...params, code, status: res.status };
    }
    const text = await res.text();
    return (text === "" ? undefined : JSON.parse(text)) as T;
  }
}
