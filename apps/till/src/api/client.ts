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
 * The OFFER and MENU shapes are the exception: `TillMenuOffer`, `TillMenu`, `TillZoneMenu` and
 * `OfferedModifier` are `import type` aliases from catalogue's type-only leaves
 * `@waitron/catalogue/src/menu-types.js` and `menu-document-types.js`, which pull in no runtime, so
 * removing or retyping a field the till reads is a compile break here. `MenuState` and
 * `MenuUnavailable` come from the same leaf, and venue-service builds its `menuState` answer as that
 * `MenuState` and each zone-offers menu as `TillZoneMenu`'s `ServedMenu`, so adding a required field
 * to any of them, or dropping or retyping one, breaks the server's compile too; an optional one does
 * not.
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
import type { AccessibleCatalogue, OfferedModifier } from "@waitron/catalogue/src/menu-types.js";
import type {
  LiveOffer,
  MenuState,
  MenuUnavailable,
  ServedMenu,
} from "@waitron/catalogue/src/menu-document-types.js";

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

/** A read the caller can cancel: an aborted read rejects with `fetch`'s own abort error, which
 * {@link isNetworkFailure} counts as no answer. */
export interface ReadOptions {
  signal?: AbortSignal;
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
  /** The published menu version this product was offered from; absent on a retrieved held line. */
  menuVersionId?: string;
  /** False when it cannot be sold now; absent on a retrieved held line. */
  available?: boolean;
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

/** One menu. In {@link ProductCatalogue.menus} `isDefault` flags the location's default. */
export type TillMenu = AccessibleCatalogue;

/** The `GET /api/products` payload. The app builds its product grid from zone offers, not this route;
 * the test harness uses it as its fixture seam. */
export interface ProductCatalogue {
  menus: TillMenu[];
  products: TillProduct[];
}

/** A product's selling identity on one menu — the `offers[]` of `GET /api/service-zones/:zoneId/offers`:
 * the menu's published version, each offer, variant, extras item and option label marked with whether
 * it can be sold now. */
export type TillMenuOffer = LiveOffer;

/** A menu in a zone-offers body: the published version its offers come from, that version's
 * structure and home layouts, and the layout this device shows. */
export type TillZoneMenu = ServedMenu;

export interface ZoneOfferCatalogue {
  context: {
    zoneId: string;
    departmentId: string;
    serviceMode: "table_tab" | "prepay" | "invoice_first" | "ticket_then_pay";
  };
  defaultMenuId: string | null;
  menus: TillZoneMenu[];
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

export type { MenuState, MenuUnavailable };

/** The offered lists as the picker asks them: only the extras items and option labels sellable now. */
function sellableModifiers(entries: TillMenuOffer["offeredModifiers"]): OfferedModifier[] {
  return entries.map((entry) =>
    entry.kind === "extras"
      ? { ...entry, items: entry.items.filter((item) => item.available) }
      : { ...entry, labels: entry.labels.filter((label) => label.available) },
  );
}

/**
 * Adapt a menu offer to the till's display model while keeping product and selling ids distinct.
 * `menuVersionId` is the published version of the offer's menu, which each line added from it sends.
 */
export function menuOfferToTillProduct(offer: TillMenuOffer, menuVersionId?: string): TillProduct {
  return {
    id: offer.productId,
    productId: offer.productId,
    menuItemId: offer.id,
    ...(menuVersionId === undefined ? {} : { menuVersionId }),
    available: offer.available,
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
    offeredModifiers: sellableModifiers(offer.offeredModifiers),
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
  /** The menu version an unsaved line was priced against. The server refuses the request
   * `menu.version_changed` when it is not the live one; absent means the live one. */
  menuVersionId?: string;
  quantity: string;
  extras?: ExtraSelection[];
  options?: OptionSelection[];
  note?: string;
}

/** Whether a submitted group goes to the kitchen now or waits until it is fired. */
export type GroupRelease = "fire" | "hold";

/** One line of a submitted group. Its group, not its course, decides when it is released. `courseId`
 * is the waiter's course OVERRIDE; absent, the server uses the product's default course. */
export interface GroupLine extends SaleLine {
  courseId?: string;
}

/** A party's group of lines as `GET /api/parties/:id/groups` reads it. `lineIds` are the group's dish
 * lines, on whichever of the party's bills they sit; `summary` names them by staff name, e.g.
 * "2 × Steak, 1 × Fish". A removed group is never listed. */
export interface OrderGroup {
  id: string;
  position: number;
  state: "held" | "fired";
  firedAt: string | null;
  remindAt: string | null;
  /** Present only when a person recorded every fired kitchen item of the group ready. */
  ready?: true;
  /** Present only when every fired kitchen item of the group has left the pass. */
  away?: true;
  lineIds: string[];
  summary: string;
}

/** The party's first held group, and when staff are reminded to fire it; `dueAt` is null while a
 * fired group before it has a dish line not fully served, or when nothing dates it. */
export interface ReleaseReminder {
  groupId: string;
  dueAt: string | null;
}

/** Only what the kitchen recorded for a dish: a station that records nothing leaves `queued`. */
export interface CurrentOrderKitchen {
  state: TicketState;
  firedAt: string | null;
  awayAt: string | null;
}

/** A dish row of `GET /api/parties/:id/current-orders`, on any bill of the party but an abandoned
 * one, a paid one included. Only a `released` row can be marked served; its extras are served with it. */
export interface CurrentOrderRow {
  lineId: string;
  workingOrderId: string;
  lineNo: number;
  /** The staff name. */
  name: string;
  quantity: string;
  /** Decimal places the line's unit takes (0 = sold by the unit). */
  unitPrecision: number | null;
  servedQuantity: string;
  /** Set once the whole quantity is served. */
  servedAt: string | null;
  released: boolean;
  kitchen: CurrentOrderKitchen | null;
  note: string | null;
  extras: { lineId: string; name: string; quantity: string }[];
}

export interface CurrentOrderGroup {
  id: string;
  position: number;
  state: "held" | "fired";
  firedAt: string | null;
  remindAt: string | null;
  /** A fired group's firing; a held group's holding. */
  sentAt: string;
  /** The display name of whoever fired or held it; null when the server has none. */
  sentBy: string | null;
  rows: CurrentOrderRow[];
}

/** What the party has ordered and what is known of it, groups in sequence. */
export interface CurrentOrders {
  revision: number;
  reminder: ReleaseReminder | null;
  groups: CurrentOrderGroup[];
  /** Dish rows in no group. */
  ungrouped: CurrentOrderRow[];
}

/** A kitchen ticket of a party's bill not printed after the server's `JOBS_WAITING_MS`, or given up
 * on; `since` is when the oldest such ticket was queued. */
export interface PrintProblem {
  workingOrderId: string;
  stationId: string;
  stationName: string;
  since: string;
}

/** What every group command sends: its submission id, and the party's revision as last read. */
export interface GroupCommand {
  submissionId: string;
  expectedPartyRevision: number;
}

/** A group submission: the groups in the order they go in the party's sequence, or one held group
 * added to the existing held group `joinGroupId`. */
export interface GroupSubmission extends GroupCommand {
  groups: { lines: GroupLine[]; release: GroupRelease }[];
  joinGroupId?: string;
}

/** The answer to a group submission: the tab the lines landed on, the party's revision after it, and
 * the groups created or joined. */
export interface SubmittedGroups {
  tabId: string;
  revision: number;
  groups: OrderGroup[];
}

/**
 * One line of a person's unsent order on a party (`apps/server/src/order-drafts.ts`). A draft line
 * carries ids and no name or price. Every save gives every line a NEW id, so an id names a line of
 * one revision only. `unavailable` is worked out by the server on each read, never stored.
 */
export interface DraftLine {
  id: string;
  menuItemId: string;
  variantId: string | null;
  /** The published menu version the line was priced against; null means the live one. */
  menuVersionId: string | null;
  options: OptionSelection[];
  extras: ExtraSelection[];
  note: string | null;
  /** A decimal string of up to three places. */
  quantity: string;
  /** The waiter's course override; null means the product's default course. */
  courseId: string | null;
  /** Never merged with another line, either way; Split quantity's rows carry it. */
  noMerge: boolean;
  unavailable: boolean;
}

/** A draft line as the till saves it. */
export type DraftLineInput = Omit<DraftLine, "id" | "unavailable">;

/** One person's unsent order on a party, at the revision a save or submit sends back. */
export interface Draft {
  id: string;
  partyId: string;
  ownerId: string;
  ownerName: string;
  revision: number;
  lines: DraftLine[];
  /** The owner before the draft was last taken over; null when it never was. `name` is "" for a
   * person the server has no name for. */
  takenOverFrom: { personId: string; name: string } | null;
}

/** A save of the signed-in person's draft: `draftId` null and `revision` 0 start a new one. */
export interface DraftSave {
  draftId: string | null;
  revision: number;
  lines: DraftLineInput[];
}

/** A submission of lines of the draft at `draftRevision`, each group naming that revision's line
 * ids, in the order the groups go in the party's sequence. */
export interface DraftSubmission extends GroupCommand {
  draftRevision: number;
  groups: { lineIds: string[]; release: GroupRelease }[];
  joinGroupId?: string;
  /** The party's bill to put the lines on; the server refuses one that is not an open bill of the
   * party. Absent, they go on the party's main bill, which the server makes if there is none. */
  billId?: string;
}

/** The groups placed, and the draft as it is left: null once every line was sent. */
export type SubmittedDraft = SubmittedGroups & { draft: Draft | null };

/** One unsent draft on a party, as the floor shows it: `lineCount` counts rows, not units. */
export interface UnsentDraft {
  ownerName: string;
  lineCount: number;
}

/** The party a bill belongs to, at its revision after a void or line edit on the bill; null for a
 * bill with no party. */
export type BillParty = { id: string; revision: number } | null;

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
  /** `total` less the money the bill has received. */
  outstanding: string;
  /** A payment is pending or received on the bill, which the counter's single payment refuses. */
  hasPayments: boolean;
  /** Null for a counter order; a party's own bill is listed too. */
  partyId: string | null;
  openedAt: string;
}

/**
 * One CHILD line of a retrieved held order's dish: the picked product, its three frozen names, the
 * price it was sold at, how many of it this dish takes, and the list it was picked from.
 */
export interface HeldExtra {
  productId: string | null;
  name: string;
  descriptions: Record<string, string>;
  kitchenName: string | null;
  price: string;
  quantity: number;
  /** Null only on a child older than `0014_order_edit_columns.sql`. */
  listId: string | null;
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
  /** What a save of this copy sends back, so a save from a copy since changed is refused. */
  revision: number;
  lines: (Omit<SaleLine, "extras" | "options"> & {
    productId?: string;
    /**
     * What each CHILD line of this dish froze, with `quantity` per dish. An edit turns them back into
     * a selection against the dish's live offer (`deriveExtraSelections`, `../state/held-extras.ts`).
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

/** The seated party a queue card's bill belongs to, at the revision the queue was read at. */
export interface QueueParty {
  id: string;
  revision: number;
}

/** The group a queue item's dish was sent in. */
export interface QueueGroup {
  id: string;
  position: number;
  state: "held" | "fired";
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
  /** Counted in Each, whose unit the kitchen screen leaves out; absent reads as not. */
  soldInEach?: boolean;
  /** The dish's selected options, in selection order; absent reads as none. */
  modifiers?: QueueModifier[];
  /** The dish's OWN allergen profile; absent renders nothing. */
  asServed?: AsServedAllergens;
  /** The dish's OWN diet profile, the diet twin of {@link asServed}; absent renders nothing. */
  asServedDiet?: DietProfile;
  /** The item's course, or `null` for a line with none — the display groups the queue by it. */
  course: StationQueueCourse | null;
  /** Absent on a bill with no party, and on a line moved in from another bill. */
  group?: QueueGroup;
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

/** What a kitchen notice tells a station: a line recalled, voided, changed or moved to another
 *  table after it was sent. */
export type KitchenNoticeKind = "recalled" | "void" | "changed" | "moved";

/**
 * A correction to work a station was sent, until a cook acknowledges it. `lineName` is the kitchen
 * name. `orderLabel` is the order's, and `unitName`, `soldInEach` and `note` are the line's, each
 * copied as it stood when the notice was recorded.
 */
export interface KitchenNotice {
  id: string;
  stationId: string;
  workingOrderId: string;
  orderLabel: string;
  kind: KitchenNoticeKind;
  lineName: string;
  /** The line's unit snapshot, keyed by locale; null when the line recorded none. */
  unitName: Record<string, string> | null;
  /** Counted in Each, whose unit the kitchen screen leaves out. */
  soldInEach: boolean;
  quantity: string;
  note: string | null;
  wasStarted: boolean;
  /** On a `moved` notice, the table the work now belongs to. */
  movedTo: string | null;
  /** On a `changed` notice, whether `quantity` was added to the work or taken from it. */
  direction: "added" | "removed" | null;
  createdAt: string;
}

/** `GET /api/stations/:id/queue` — the station's work, oldest first, and its unacknowledged notices. */
export interface StationQueue {
  items: StationQueueGroup[];
  notices: KitchenNotice[];
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
  /** Absent on a bill with no party. */
  party?: QueueParty;
  /** Present only when one of this bill's tickets for the station was not printed after the
   *  server's `JOBS_WAITING_MS`, or was given up on. */
  printProblem?: true;
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
}

/**
 * `GET /api/device/station` success — the enrolled display's OWN bound station and its queue. The
 * device cookie names the station, so there is no id to pass.
 */
export interface DeviceStation {
  station: { id: string; queue: StationQueueGroup[]; notices: KitchenNotice[] };
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
  /** Counted in Each, whose unit the expo board leaves out; absent reads as not. */
  soldInEach?: boolean;
  stationName: string;
  state: TicketState;
  /** `null` while the item's course is HELD; a timestamp once fired. */
  firedAt: string | null;
  /** `null` until the expediter dispatches it; a timestamp once away to the floor. */
  awayAt: string | null;
  /** Absent on a bill with no party, and on a line moved in from another bill. */
  group?: QueueGroup;
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
  /** This item's age band on the server's clock at fetch time. Not read by `till-expo-screen`,
   *  which derives the band from {@link queuedAt} and {@link thresholds}. */
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
 * One group section of a seated party's bill on the expo board. The section of lines with no group
 * has every group field `null` and sorts first. `fired` and `away` roll up as {@link ExpoCourse}'s.
 */
export interface ExpoGroup {
  groupId: string | null;
  position: number | null;
  state: QueueGroup["state"] | null;
  fired: boolean;
  away: boolean;
  items: ExpoItem[];
}

/**
 * One order on the cross-station expo/pass board, its items grouped BY COURSE, or by group for a
 * seated party's bill. `tableLabel` is omitted
 * when the order maps to no table. The server excludes abandoned, collected and FULLY-away orders; a
 * surviving order still carries its away items, so the SCREEN hides fully-away courses and groups
 * (via {@link ExpoCourse.away} and {@link ExpoGroup.away}).
 */
export interface ExpoOrder {
  orderId: string;
  tableLabel?: string;
  orderNumber: number;
  openedMinutes: number;
  /** Absent on a bill with no party. */
  party?: QueueParty;
  /** Empty on a seated party's bill. */
  courses: ExpoCourse[];
  /** A seated party's bill's sections; absent or empty on any other bill. */
  groups?: ExpoGroup[];
  /** The worst age band across the order's UNSERVED lines on the server's clock at fetch time.
   *  Not read by `till-expo-screen`, which derives the band from each item's `queuedAt` and
   *  thresholds. */
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
 * The party seated at a table (`TableState.party`). `outstanding` is what the party's open and placed
 * bills still owe, merged parties' bills included, as a two-place decimal string; `billCount` leaves
 * out abandoned bills; `tableIds` lists every table the party sits at, in the order they joined it.
 * `revision` is what a command that changes the party's tables or bills sends back.
 */
export interface TableParty {
  id: string;
  revision: number;
  guestCount: number | null;
  state: "open" | "needs_clearing" | "closed";
  /** The name staff gave the party, or null. */
  name: string | null;
  /** `name`, or else the party's tables' labels. */
  displayName: string;
  /** The bill an order that names none goes on; null until the party's next order makes one. */
  mainBillId: string | null;
  outstanding: string;
  billCount: number;
  tableIds: string[];
  /** Every open draft on the party that holds a line, oldest first; `ownerName` is "" for an
   * unknown person. */
  unsentDrafts: UnsentDraft[];
  /** Null when the venue has reminders off, no group is held, or the party is not open. */
  reminder: ReleaseReminder | null;
}

/** One bill of a seated party from `GET /api/parties/:id/bills`. `outstanding` is zero on a settled or
 * abandoned bill; `receiptAvailable` says a sale was filed for it, so its receipt can be printed again. */
export interface PartyBill {
  workingOrderId: string;
  partyId: string;
  label: string | null;
  status: "open" | "placed" | "settled" | "abandoned";
  total: string;
  outstanding: string;
  /** A payment is pending or received on the bill, which the single payment refuses. */
  hasPayments: boolean;
  receiptAvailable: boolean;
}

/**
 * What Move guests and Join tables send of the parties the till read (D19): the moving party's
 * revision, and what it read at the target table. `otherPartyId` is the party seated there, sent with
 * its revision, or null for a table read free; both are left out for a table of the party itself.
 */
export interface TableActionRevisions {
  expectedPartyRevision: number;
  otherPartyId?: string | null;
  expectedOtherPartyRevision?: number;
}

/** A move or join's answer: the party the guests are in now, its main bill, and whether the two
 * main bills were merged. */
export interface TableActionResult {
  partyId: string;
  mainBillId: string | null;
  merged: boolean;
}

/** What a bill action sends of the party the till read the bill under: its revision and its id. Both
 * are left out for a bill of no party. */
export interface BillRevisions {
  expectedPartyRevision?: number;
  partyId?: string;
}

/** Where Move a bill sends a bill: a table, or the counter in the counter's zone (null for none). */
export type MoveBillTarget = { tableId: string } | { counter: { zoneId: string | null } };

/**
 * What Move a bill sends of the parties the till read: the bill's party and its revision, as
 * {@link BillRevisions} does, but `partyId: null` for a bill read with no party, as a counter order;
 * and what it read at a target table, as {@link TableActionRevisions} does.
 */
export interface MoveBillRevisions
  extends
    Omit<BillRevisions, "partyId">,
    Pick<TableActionRevisions, "otherPartyId" | "expectedOtherPartyRevision"> {
  partyId?: string | null;
}

/** A move's answer: the party the bill is in now (null at the counter), and the bill it ended up
 * as, the receiving main bill when `merged`. */
export interface MoveBillResult {
  partyId: string | null;
  billId: string;
  merged: boolean;
}

/**
 * One row of the live-floor occupancy read-model from `GET /api/tables/state`. A table is
 * `"open-tab"` while a party holds it, paid or not. `tabLineCount`/`tabTotal` are present iff a tab
 * is open.
 * `tabTotal` is the tab's gross draft total as a two-place decimal string. `status` is the table's MANUAL service status,
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
  /** `held` while a party holds the table; `needs_clearing` after Finish table with the clearing
   * setting on, until Mark cleared. */
  condition: "free" | "held" | "needs_clearing";
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
  party: TableParty | null;
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

/** `POST /api/tables/:id/seat` success — the new party, its tab and the tab's order number. */
export interface SeatResult {
  partyId: string;
  tabId: string;
  revision: number;
  orderNumber: number;
}

/** One dish line's edit. An absent field keeps the line's own; a null `note` clears it; `options` and
 * `extras`, when present, replace the line's whole set. */
export interface OrderLinePatch {
  quantity?: string;
  note?: string | null;
  options?: OptionSelection[];
  extras?: ExtraSelection[];
}

/** `GET /api/working-orders/:id/lines` — an open tab's lines and the revision they were read at. */
export interface TabLines {
  lines: TabLine[];
  revision: number;
  /** The venue's setting. When false the server refuses to change or recall a dish line with
   * `sentAt !== null && state !== null` (`ticket.already_fired`). Cancelling it through the void route
   * ({@link TillApi.voidLine}) still works; removing it inside an edit is refused like a change. */
  editSentLines: boolean;
}

/**
 * One line of an open tab from `GET /api/working-orders/:id/lines`. A tab does NOT re-price:
 * `unitPriceGross` is the gross unit price LOCKED at add-time. `servedAt` is the pre-fiscal served
 * marker (`null` ⇒ still to serve).
 */
export interface TabLine {
  /** The row's id, which a group move names. A dish in an order group is listed by it in
   * {@link OrderGroup.lineIds}; a child extras row never is. */
  id: string;
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
  /** When the line was first released: fired, or for a no-preparation line, when it would have
   * fired; null if it never was. A recall clears `firedAt` and keeps this. */
  sentAt: string | null;
  /** When the line's kitchen ticket item FIRED, or null while its course is still HELD. */
  firedAt: string | null;
  /** The line's kitchen ticket item state, or null when it has no LIVE ticket item. A child modifier
   * line never has one; a parent line can lack one too, so null is not impossible for a parent. A
   * RECALLABLE line has `firedAt` set, `state === "queued"`, and the venue allows changes to sent items
   * (`editSentLines`); "preparing"/"ready" is cancel-only. */
  state: TicketState | null;
  /** The order group the line is released with; null when it is in none, as on a bill with no party
   * or for a line moved in from another party's bill or from a bill with no party. */
  groupId: string | null;
  note: string | null;
  /** The extras list a CHILD row was picked from, which a prefilled pick goes back to; null on a
   * dish. */
  listId: string | null;
  /** The offer the line was sold under (a child row's is its dish's), which finds the live product
   * whose picker an edit opens; null on a line with no recorded service context. */
  menuItemId: string | null;
  /** On a dish sold as a variant, {@link productId} names the variant and this its parent product;
   * otherwise null. */
  parentProductId: string | null;
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

  async listZoneOffers(zoneId: string, options: ReadOptions = {}): Promise<ZoneOfferCatalogue> {
    return this.#request<ZoneOfferCatalogue>(
      `/api/service-zones/${encodeURIComponent(zoneId)}/offers`,
      "GET",
      undefined,
      options.signal,
    );
  }

  menuState(zoneId: string, options: ReadOptions = {}): Promise<MenuState> {
    return this.#request<MenuState>(
      `/api/menu-state?zoneId=${encodeURIComponent(zoneId)}`,
      "GET",
      undefined,
      options.signal,
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
   * (else `working_order.not_open`), and only from the copy at its current `revision` (else
   * `working_order.out_of_date`). Resolves the revision the order is at after the save, which a save
   * that changed nothing leaves where it was.
   */
  updateWorkingOrder(
    id: string,
    req: { lines: SaleLine[]; label?: string; revision: number },
  ): Promise<{ revision: number }> {
    return this.#request<{ revision: number }>(`/api/working-orders/${id}`, "PUT", req);
  }

  /**
   * Edit ONE dish line of an open order → `PUT /api/working-orders/:orderId/lines/:lineNo`, from the
   * copy read at `revision`. An absent field keeps the line's own. Rejects `working_order.out_of_date`,
   * `order.payment_in_flight`, `ticket.already_started`, `ticket.already_fired` or
   * `tab.line_not_found`. Resolves the revision the order is at after the edit, and its party's.
   */
  updateOrderLine(
    orderId: string,
    lineNo: number,
    patch: OrderLinePatch,
    revision: number,
  ): Promise<{ revision: number; party: BillParty }> {
    return this.#request<{ revision: number; party: BillParty }>(
      `/api/working-orders/${orderId}/lines/${lineNo}`,
      "PUT",
      { ...patch, revision },
    );
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
   * Collect and finalise a PLACED order → `POST /api/working-orders/:id/collect`. When an invoice was
   * already issued for the order, collect settles it with `tender`; otherwise it files one from the
   * order's stored lines — never a client basket. A still-open or absent id rejects with
   * `working_order.not_placed`.
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
  getStationQueue(stationId: string, options: ReadOptions = {}): Promise<StationQueue> {
    return this.#request<StationQueue>(
      `/api/stations/${stationId}/queue`,
      "GET",
      undefined,
      options.signal,
    );
  }

  /** Acknowledge one kitchen notice → `POST /api/kitchen-notices/:id/acknowledge`. An unknown id
   * rejects with `kitchen_notice.not_found`. */
  async acknowledgeKitchenNotice(id: string): Promise<void> {
    await this.#request<void>(`/api/kitchen-notices/${id}/acknowledge`, "POST");
  }

  /** The station display's twin of {@link acknowledgeKitchenNotice}, by its device cookie; a notice
   * at another station rejects as an unknown one does. */
  async deviceAcknowledgeKitchenNotice(id: string): Promise<void> {
    await this.#request<void>(`/api/device/kitchen-notices/${id}/acknowledge`, "POST");
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
  getDeviceStation(options: ReadOptions = {}): Promise<DeviceStation> {
    return this.#request<DeviceStation>("/api/device/station", "GET", undefined, options.signal);
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
   * is no device reprint route. NON-FISCAL and changes no order state; an order with no fired items and
   * no held group whose HOLD ticket was queued is a 200 no-op. A malformed or unknown id rejects
   * `working_order.not_found`.
   */
  async reprintOrder(orderId: string): Promise<void> {
    await this.#request<void>(`/api/orders/${orderId}/reprint`, "POST", {});
  }

  /**
   * FIRE a HELD course of an order → `POST /api/orders/:id/courses/:courseId/fire`. On a seated
   * party's order, each held group holding a dish of that course on that order fires whole; the
   * course's lines held outside a group are released. NON-FISCAL; idempotent — a course with nothing held is a 200 no-op. A malformed or unknown course id rejects
   * `course.not_found`; a malformed order id `working_order.not_found`.
   */
  async fireCourse(orderId: string, courseId: string): Promise<void> {
    await this.#request<void>(`/api/orders/${orderId}/courses/${courseId}/fire`, "POST", {});
  }

  /**
   * The cross-station expo/pass queue → `GET /api/expo/queue`: orders aggregated into courses, or
   * into groups for a seated party's bill, ACROSS all stations, oldest first. See {@link ExpoOrder}
   * for what the server excludes.
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

  // --- Live floor. ---

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
   * Seat a party at a free table → `POST /api/tables/:tableId/seat`, which opens its tab. `guestCount`
   * is sent as an explicit null when none was given. A table a party already holds rejects
   * `tab.already_open`; `table.not_found`, `table.inactive` and `table.needs_clearing` surface as a
   * rejected `{ code }`.
   */
  seatTable(tableId: string, guestCount: number | null): Promise<SeatResult> {
    return this.#request<SeatResult>(`/api/tables/${tableId}/seat`, "POST", { guestCount });
  }

  /**
   * Finish a party's table → `POST /api/parties/:partyId/finish`. Rejects `party.bill_outstanding`
   * while a bill is unpaid, `party.not_open`, or `party.out_of_date` when the party changed since
   * `expectedPartyRevision` was read.
   */
  finishTable(partyId: string, expectedPartyRevision: number): Promise<{ state: "closed" }> {
    return this.#request(`/api/parties/${partyId}/finish`, "POST", { expectedPartyRevision });
  }

  /** Free a table that needs clearing → `POST /api/tables/:tableId/cleared`. A table that does not
   * need it is left as it is; rejects `table.not_found`. */
  async markTableCleared(tableId: string): Promise<void> {
    await this.#request<void>(`/api/tables/${tableId}/cleared`, "POST");
  }

  /** Every bill of a party, merged parties' included → `GET /api/parties/:partyId/bills`. */
  getPartyBills(partyId: string): Promise<PartyBill[]> {
    return this.#request<PartyBill[]>(`/api/parties/${partyId}/bills`, "GET");
  }

  /** A party's order groups in sequence, with its revision → `GET /api/parties/:partyId/groups`. */
  listGroups(partyId: string): Promise<{ revision: number; groups: OrderGroup[] }> {
    return this.#request(`/api/parties/${partyId}/groups`, "GET");
  }

  /**
   * Put groups of lines on a party's main bill → `POST /api/parties/:partyId/groups`, each released
   * now or held. A party with no main bill, as after its last one was paid, presented or abandoned,
   * gets a new one: the answer names the bill the lines landed on. A repeat with the same submission id answers as the first.
   * Rejects `party.out_of_date`, `party.not_open`, `submission.id_reused`, `group.not_held` and
   * `group.not_found` as `{ code }`.
   */
  submitGroups(
    partyId: string,
    submission: GroupSubmission,
    options: ReadOptions = {},
  ): Promise<SubmittedGroups> {
    return this.#request(`/api/parties/${partyId}/groups`, "POST", submission, options.signal);
  }

  /** Every open draft on a party, whoever holds it, oldest first → `GET /api/parties/:partyId/drafts`. */
  async listDrafts(partyId: string, options: ReadOptions = {}): Promise<Draft[]> {
    const { drafts } = await this.#request<{ drafts: Draft[] }>(
      `/api/parties/${partyId}/drafts`,
      "GET",
      undefined,
      options.signal,
    );
    return drafts;
  }

  /**
   * Replace every line of the signed-in person's draft → `PUT /api/parties/:partyId/drafts`. The
   * server merges lines that order the same thing and answers the draft as saved. Rejects, among
   * others, `draft.out_of_date` (with the draft's `draftId` and `revision`), `draft.taken_over` (with
   * `ownerId` and `ownerName`), `draft.not_found`, `draft.already_submitted` and `party.not_open`.
   */
  saveDraft(partyId: string, save: DraftSave, options: ReadOptions = {}): Promise<Draft> {
    return this.#request(`/api/parties/${partyId}/drafts`, "PUT", save, options.signal);
  }

  /**
   * Make another person's draft the signed-in person's →
   * `POST /api/parties/:partyId/drafts/:draftId/take-over`. When they already hold a draft on the
   * party, the taken lines join it and the answer is THAT draft, under its own id.
   */
  takeOverDraft(
    partyId: string,
    draftId: string,
    revision: number,
    options: ReadOptions = {},
  ): Promise<Draft> {
    return this.#request(
      `/api/parties/${partyId}/drafts/${draftId}/take-over`,
      "POST",
      { revision },
      options.signal,
    );
  }

  /**
   * Send lines of the signed-in person's draft as groups →
   * `POST /api/parties/:partyId/drafts/:draftId/submit`. A repeat with the same submission id answers
   * as the first. Rejects, among others, the `draft.*` refusals, `party.out_of_date`,
   * `party.not_open`, `submission.id_reused` and pricing refusals such as `menu.version_changed`.
   */
  submitDraft(
    partyId: string,
    draftId: string,
    submission: DraftSubmission,
    options: ReadOptions = {},
  ): Promise<SubmittedDraft> {
    return this.#request(
      `/api/parties/${partyId}/drafts/${draftId}/submit`,
      "POST",
      submission,
      options.signal,
    );
  }

  /** Send a held group to the kitchen → `POST /api/parties/:partyId/groups/:groupId/fire`. Rejects
   * `group.not_held`, `group.not_found`, `product.unavailable` and the command refusals. */
  fireGroup(
    partyId: string,
    groupId: string,
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/groups/${groupId}/fire`, "POST", command);
  }

  /** The pass marks a fired group's kitchen items ready → `POST /api/parties/:partyId/groups/:groupId/ready`.
   * A held group is a no-op that still moves the revision. Rejects `group.not_found` and the command
   * refusals. */
  bumpGroupReady(
    partyId: string,
    groupId: string,
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/groups/${groupId}/ready`, "POST", command);
  }

  /** The pass sends a group's ready items to the floor → `POST /api/parties/:partyId/groups/:groupId/away`.
   * Rejects `group.not_found` and the command refusals. */
  markGroupAway(
    partyId: string,
    groupId: string,
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/groups/${groupId}/away`, "POST", command);
  }

  /**
   * Mark part or all of each of a party's lines served → `POST /api/parties/:partyId/served`, on any
   * of its bills but an abandoned one, a paid one included. `quantity` is how much THIS command serves. Rejects
   * `tab.serve_quantity_invalid` for more than is left to serve, `group.line_held` for a line not yet
   * released, `group.not_found`, and the command refusals.
   */
  markServed(
    partyId: string,
    items: { lineId: string; quantity: string }[],
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/served`, "POST", { ...command, items });
  }

  /** Take back part or all of what was marked served on each line → `POST /api/parties/:partyId/unserved`;
   * more than is served rejects `tab.serve_quantity_invalid`. */
  unmarkServed(
    partyId: string,
    items: { lineId: string; quantity: string }[],
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/unserved`, "POST", { ...command, items });
  }

  /** Mark every line of a fired group served → `POST /api/parties/:partyId/groups/:groupId/served`.
   * A held group rejects `group.line_held`. */
  markGroupServed(
    partyId: string,
    groupId: string,
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/groups/${groupId}/served`, "POST", command);
  }

  /** Put off the release reminder of the group waiting (the party's first held group) →
   * `POST /api/parties/:partyId/groups/:groupId/snooze`: it becomes due `minutes` from now. A
   * fired group rejects `group.not_held`, and a held group other than the one waiting
   * `group.not_waiting`. */
  snoozeGroup(
    partyId: string,
    groupId: string,
    minutes: number,
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/groups/${groupId}/snooze`, "POST", {
      ...command,
      minutes,
    });
  }

  /** Clear the snooze of the group waiting →
   * `POST /api/parties/:partyId/groups/:groupId/unsnooze`: its reminder falls due at its own time
   * again, and a group with no snooze is left as it is. A fired group rejects `group.not_held`, and
   * a held group other than the one waiting `group.not_waiting`. */
  unsnoozeGroup(
    partyId: string,
    groupId: string,
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/groups/${groupId}/unsnooze`, "POST", command);
  }

  /** A party's Current orders → `GET /api/parties/:partyId/current-orders`. */
  readCurrentOrders(partyId: string): Promise<CurrentOrders> {
    return this.#request(`/api/parties/${partyId}/current-orders`, "GET");
  }

  /** A party's kitchen tickets that have not printed → `GET /api/parties/:partyId/print-problems`. */
  listPrintProblems(partyId: string): Promise<{ problems: PrintProblem[] }> {
    return this.#request(`/api/parties/${partyId}/print-problems`, "GET");
  }

  /** Put a party's held groups in a new order → `PUT /api/parties/:partyId/groups/order`, naming every
   * held group once. Fired groups keep their places. */
  reorderGroups(
    partyId: string,
    heldGroupIds: string[],
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/groups/order`, "PUT", {
      ...command,
      heldGroupIds,
    });
  }

  /** Move lines, or part of one, between held groups, or into a new held group at the end →
   * `POST /api/parties/:partyId/groups/move`. */
  moveLinesToGroup(
    partyId: string,
    moves: { lineId: string; quantity: string }[],
    target: { groupId: string } | "new",
    command: GroupCommand,
  ): Promise<{ revision: number }> {
    return this.#request(`/api/parties/${partyId}/groups/move`, "POST", {
      ...command,
      moves,
      target,
    });
  }

  /**
   * Read one open tab's lines → `GET /api/working-orders/:orderId/lines`. A non-open or absent tab
   * rejects with `tab.not_open`. `revision` is what an edit of this copy sends back.
   */
  getTabLines(orderId: string): Promise<TabLines> {
    return this.#request<TabLines>(`/api/working-orders/${orderId}/lines`, "GET");
  }

  /**
   * Move ONE not-yet-fired line into another course → `PATCH
   * /api/working-orders/:orderId/lines/:lineNo/course`. `null` CLEARS the line's course and is sent as an
   * explicit null, not an absent field. NON-FISCAL. Rejects `tab.not_open`, `course.not_found`,
   * `tab.line_not_found`, or `ticket.already_fired`.
   */
  async setLineCourse(orderId: string, lineNo: number, courseId: string | null): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/lines/${lineNo}/course`, "PATCH", {
      courseId,
    });
  }

  /**
   * Fire SPECIFIC held lines of an open tab → `POST /api/working-orders/:orderId/lines/send`.
   * NON-FISCAL; idempotent — an unknown or already-fired line matches nothing. Rejects `tab.not_open`,
   * and `group.line_held` for a named line in a held group, which only firing its group releases.
   */
  async sendLines(orderId: string, lineNos: number[]): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/lines/send`, "POST", { lineNos });
  }

  /**
   * UN-send not-yet-started lines of an open tab → `POST /api/working-orders/:orderId/lines/recall`, the
   * inverse of {@link sendLines}. NON-FISCAL; a previously-fired line gets a RECALLED correction slip.
   * Rejects `tab.not_open`, `tab.line_not_found`, `ticket.already_started` (the kitchen has started
   * it), or `ticket.already_fired` (the venue does not allow changes to sent items and a line with a
   * ticket item has been sent — a recalled line still counts as sent); a held line never sent changes
   * nothing but the order's revision.
   */
  async recallLines(orderId: string, lineNos: number[]): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/lines/recall`, "POST", { lineNos });
  }

  /**
   * Cancel (VOID) ONE line of an open tab → `DELETE /api/working-orders/:orderId/lines/:lineNo`: the
   * cancel path for a sent line, whether or not the kitchen has started it. NON-FISCAL;
   * the server prints a correction slip. `quantity`, a decimal string, voids that part of the line
   * only; absent voids all of it. Rejects `tab.not_open`, `tab.line_not_found`,
   * `tab.void_quantity_invalid` or `order.payment_in_flight`. Resolves the tab's party after the void.
   */
  voidLine(orderId: string, lineNo: number, quantity?: string): Promise<{ party: BillParty }> {
    const part = quantity === undefined ? "" : `?quantity=${encodeURIComponent(quantity)}`;
    return this.#request(`/api/working-orders/${orderId}/lines/${lineNo}${part}`, "DELETE");
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
   * The party moves off all its tables to `toTableId` → `POST /api/parties/:id/move`. At a table
   * another party holds the two become one, and `bills` says whether their main bills merge. Rejects,
   * among others, `table.needs_clearing`, `table.already_in_party`, `table.inactive`,
   * `service_zone.mode_incompatible`, `party.not_open` and `party.out_of_date`.
   */
  moveGuests(
    partyId: string,
    toTableId: string,
    bills: "merge" | "separate",
    revisions: TableActionRevisions,
  ): Promise<TableActionResult> {
    return this.#request(`/api/parties/${partyId}/move`, "POST", {
      toTableId,
      bills,
      ...revisions,
    });
  }

  /**
   * Move a whole bill to a table or the counter → `POST /api/bills/:id/move`. Rejects, among others,
   * `bill.paid`, `party.main_bill_stays`, `group.held_leaves_party`, `table.needs_clearing`,
   * `table.already_in_party` and `party.out_of_date`.
   */
  moveBill(
    billId: string,
    to: MoveBillTarget,
    bills: "merge" | "separate",
    revisions: MoveBillRevisions,
  ): Promise<MoveBillResult> {
    return this.#request(`/api/bills/${billId}/move`, "POST", { to, bills, ...revisions });
  }

  /**
   * `tableId` joins the party → `POST /api/parties/:id/join`; a party seated there joins with every
   * table it holds. Rejects as {@link moveGuests} does, and `service_zone.join_mismatch`.
   */
  joinTables(
    partyId: string,
    tableId: string,
    bills: "merge" | "separate",
    revisions: TableActionRevisions,
  ): Promise<TableActionResult> {
    return this.#request(`/api/parties/${partyId}/join`, "POST", { tableId, bills, ...revisions });
  }

  /**
   * `tableId` leaves the party and a new party starts there with `billId`, or with a new empty bill
   * when it is null → `POST /api/parties/:id/split-table`. Rejects, among others, `table.not_shared`,
   * `table.not_joined`, `party.main_bill_stays`, `group.held_leaves_party` and `party.out_of_date`.
   */
  splitTable(
    partyId: string,
    tableId: string,
    billId: string | null,
    expectedPartyRevision: number,
  ): Promise<{ partyId: string; mainBillId: string | null }> {
    return this.#request(`/api/parties/${partyId}/split-table`, "POST", {
      tableId,
      billId,
      expectedPartyRevision,
    });
  }

  /** Name the party, or clear its name with null → `PUT /api/parties/:id/name`. A name over 40
   * characters is `management.request_invalid` naming the field `name`. */
  setPartyName(
    partyId: string,
    name: string | null,
    expectedPartyRevision: number,
  ): Promise<{ revision: number; name: string | null }> {
    return this.#request(`/api/parties/${partyId}/name`, "PUT", { name, expectedPartyRevision });
  }

  /**
   * Put the chosen items of a bill on a new bill of the same party → `POST /api/bills/:billId/split`,
   * answering the new bill's id. Rejects, among others, `bill.paid`, `bill.presented`,
   * `bill.line_paid`, `tab.split_held_line`, `tab.transfer_modifier_line`, `party.not_open` and
   * `party.out_of_date`.
   */
  splitBill(
    billId: string,
    transfers: readonly TabTransfer[],
    revisions: BillRevisions,
  ): Promise<{ billId: string }> {
    return this.#request(`/api/bills/${billId}/split`, "POST", { transfers, ...revisions });
  }

  /**
   * Move every item of `fromBillId` onto `intoBillId`, two untouched bills of one party →
   * `POST /api/bills/:intoBillId/merge`. Rejects, among others, `bill.presented`, `bill.paid`,
   * `bill.other_party`, `bill.payments_received`, `tab.not_open` and `party.out_of_date`.
   */
  async mergeBills(
    intoBillId: string,
    fromBillId: string,
    revisions: BillRevisions,
  ): Promise<void> {
    await this.#request<void>(`/api/bills/${intoBillId}/merge`, "POST", {
      fromBillId,
      ...revisions,
    });
  }

  /**
   * Move the chosen items from one untouched bill of a party to another →
   * `POST /api/bills/:fromBillId/transfer` (see {@link TabTransfer}). Rejects as
   * {@link mergeBills} does, and `bill.line_paid` and `sale.empty_basket`.
   */
  async transferItems(
    fromBillId: string,
    toBillId: string,
    transfers: readonly TabTransfer[],
    revisions: BillRevisions,
  ): Promise<void> {
    await this.#request<void>(`/api/bills/${fromBillId}/transfer`, "POST", {
      toBillId,
      transfers,
      ...revisions,
    });
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
  async #request<T>(
    path: string,
    method: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
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
    if (signal !== undefined) init.signal = signal;
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
