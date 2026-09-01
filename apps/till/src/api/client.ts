/**
 * The browser-side face of the till's HTTP API — one thin `fetch` wrapper per server route
 * (`apps/server/src/till-api.ts`). It exists so the Lit views built on top of it never touch
 * `fetch`, URLs, cookies or error-envelope shapes directly: they call a typed method and get back a
 * typed payload, or a rejected `{ code }`.
 *
 * Every request sends `credentials: "include"` so the httpOnly session cookie the login route set
 * rides along; without it the session-guarded routes (`GET /api/products`, `POST /api/sales`) 401.
 *
 * The response interfaces below are LOCAL copies of the server's JSON shapes, deliberately NOT
 * imported from `@waitron/catalogue`/`@waitron/identity`. A runtime import from those packages would
 * drag their barrels — and through them `@waitron/db` and Node builtins — into the browser bundle.
 * A handful of duplicated field lists is the price of keeping the bundle free of server code, and is
 * the decoupling the task brief calls for. `TillProduct` mirrors catalogue's `AvailableProduct`;
 * `TillSaleResult` mirrors the server's `TillSaleResult`. If those server shapes change, these
 * follow — a mismatch surfaces as a runtime shape error a view test catches, not a compile break.
 */

// The till's LOCAL layout/receipt shapes (`../layout.ts`) — plain data, browser-safe, bundle-decoupled
// exactly like every interface below. `GET /api/till` carries the authored-or-default arrangement +
// receipt trim; importing these from `../layout.js` (never `@waitron/layouts`) keeps the decoupling.
import type { LayoutDef, ReceiptConfig } from "../layout.js";
// `StationThresholds`/`TimingBand` are plain data shapes from the GENERIC `@waitron/shared` package
// (not a server package), so importing their types here doesn't reintroduce the bundle-decoupling risk
// the note above warns about — every till widget already depends on `@waitron/shared` for money/locale
// primitives.
import type { StationThresholds, TimingBand } from "@waitron/shared";

/** The subset of `fetch` this client uses; the global satisfies it, and a test injects a stub. */
export type FetchLike = typeof fetch;

/**
 * `GET /api/till` — the public boot info the app reads before login. `orderFlow` (7c prepare &
 * collect) is the location's pay-timing mode — see {@link OrderFlow}'s own doc — needed BEFORE login
 * so the app can select which pay control (Place/Collect vs Pay) to render once the operator reaches
 * the counter. `cardProvider`/`tipsEnabled` (integrated card terminal, sub-project 7 Task 8) are the
 * till's card wiring — mirrors the server's `deps.cfg.cardProvider`/`deps.tipsEnabled`
 * (`apps/server/src/till-api.ts`), both always present (a till with no integrated reader still echoes
 * `cardProvider: "none"`) — needed so the counter can choose whether to render the integrated-card
 * pay control at all, and whether that control prompts for a tip.
 *
 * `layout`/`receipt` (layout & receipt editors) are the owner-authored till arrangement and receipt
 * trim, or the built-in defaults when the tenant has never opened the editor — the server always sends
 * both (`getLayout` returns `DEFAULT_LAYOUT`/`DEFAULT_RECEIPT` on absence, `till-api.ts`). Like
 * `orderFlow`/`venueName` they carry no secrets, only the widget arrangement + footer text. The app
 * renders `layout` in place of the hardcoded `LAYOUT_A` and threads `receipt` to its ticket.
 */
export interface TillInfo {
  locale: string;
  /**
   * The RECEIPT (fiscal document) locale — the language the printed legal ticket renders in. Sourced
   * server-side from the fiscal `cfg.locale`, DELIBERATELY DISTINCT from the UI-driving {@link locale}
   * above (the venue default derivation drops UI-unsupported codes, which must never reach the
   * receipt — per-user-language spec, decision 2). The app threads it to `till-ticket-view.invoiceLocale`
   * SEPARATELY from `setLocale(locale)`. A LOCAL mirror of the server's `GET /api/till` field.
   */
  invoiceLocale: string;
  venueName: string;
  nif: string;
  orderFlow: OrderFlow;
  /**
   * The venue's KDS whole-ticket bump mode (KDS-1 §2e, `locations.bump_mode`): `line` (per-line bump
   * only, the source of truth) or `ticket` (the display also offers a whole-ticket bump). Read once
   * from `GET /api/till` on boot and threaded to the station-display screen so it can enable the
   * whole-ticket affordance. A LOCAL mirror of the server's `bump_mode` enum, deliberately NOT
   * imported — same bundle-decoupling rationale as every other type in this file.
   */
  bumpMode: "line" | "ticket";
  /**
   * The venue's KDS fire-control mode (KDS-2/3 §2c, `locations.fire_control`): `waiter` (the tab surfaces
   * the fire action), `kitchen` (the station display surfaces it) or `expo` (KDS-3 — the expo/pass display
   * surfaces it). Read once from `GET /api/till` on boot and threaded to the station-display screen so it
   * shows the per-course kitchen-fire action only for a `kitchen` venue. A LOCAL mirror of the server's
   * `fire_control` enum, deliberately NOT imported — same bundle-decoupling rationale as `bumpMode` above
   * and every other type in this file.
   */
  fireControl: "waiter" | "kitchen" | "expo";
  /**
   * The venue's ACTIVE kitchen courses (KDS-2 §5b), by `display_order` — the options the tab-order
   * screen's per-line course picker offers, and the id→name source its "Fire <course>" actions read.
   * Read once from `GET /api/till` on boot and threaded to that screen. A LOCAL mirror of the trimmed
   * course shape the boot route sends (`{ id, name, displayOrder }`; the server's `Course.active` is
   * always true in an active-only list, so it is dropped), deliberately NOT imported — same
   * bundle-decoupling rationale as every other type in this file. `[]` for a venue with no courses.
   */
  courses: TillCourse[];
  cardProvider: "none" | "stripe_terminal" | "stripe_on_device";
  tipsEnabled: boolean;
  layout: LayoutDef;
  receipt: ReceiptConfig;
}

/**
 * One ACTIVE kitchen course as the boot payload carries it (KDS-2 §5b) — its id (the
 * {@link TillApi.fireCourse} target + a round line's course override), display `name`, and the
 * `displayOrder` that sequences the picker + the waiter-fire actions. A LOCAL mirror of the server's
 * trimmed course shape, NOT imported (the bundle rule).
 */
export interface TillCourse {
  id: string;
  name: string;
  displayOrder: number;
}

/** One `GET /api/staff` roster entry — no PIN, role or status (the server strips them). */
export interface StaffMember {
  personId: string;
  displayName: string;
}

/**
 * `POST /api/session` success — who is now logged in, plus the SERVER-COMPUTED `canConfigureTill`
 * capability (`roleHasPermission(role, "till.configure")`, resolved server-side from the session's
 * role). The till reads it to gate manager-only affordances (FP-2's on-till "Editar plano") without
 * mirroring the role→permission map on the client, where it would silently drift from `permissions.ts`.
 * Convenience only — the on-till placement route re-checks `till.configure` server-side
 * (`apps/server/src/till-api.ts`), so a tampered client value grants nothing.
 */
export interface SessionResult {
  personId: string;
  canConfigureTill: boolean;
  /**
   * The signed-in operator's stored per-user UI locale (per-user-language-preference, Task 5), or
   * `null` when they have never set one. The app feeds it to `resolveActiveLocale(personLocale,
   * venueDefault)` on login to pick the language to switch the UI into; a `null` falls back to the
   * venue default. A LOCAL mirror of the server's `POST /api/session` response field.
   */
  locale: string | null;
}

/** One VAT band on a ticket: a rate and its taxable base + tax, as decimal strings. */
export interface VatBreakdownEntry {
  rate: string;
  base: string;
  tax: string;
}

/**
 * The dietary shapes (dietary-classification, Task 6), LOCAL redefinitions of catalogue's `dietary.ts`
 * types — deliberately NOT imported from `@waitron/catalogue`, the same bundle-decoupling rationale as
 * every other type in this file (see the file header). They are structurally identical to the shared
 * shapes, so a value the deep-imported `deriveAsServedDiet` returns/accepts is assignable across the
 * boundary. `DietaryOrigin` is the ingredient-origin taxonomy (`plant`, `meat`, …); `ContainsTag` is
 * the meat/fish subset the "no-meat"/"no-fish" filters read; `DietLabel` is a cautious tri-state
 * (`"unknown"` when the base recipe is unreviewed — never a positive claim).
 */
export type DietaryOrigin =
  "plant" | "meat" | "fish" | "shellfish" | "dairy" | "egg" | "honey" | "other_animal";
export type ContainsTag = "meat" | "fish";
export type DietLabel = "yes" | "no" | "unknown";

/** The recipe-derived diet basis (`products.dietDerivation`): the folded ingredient origins plus a
 * `pending` flag that is true while the recipe is unreviewed (holding vegan/vegetarian at "unknown"). */
export interface DietDerivation {
  origins: DietaryOrigin[];
  pending: boolean;
}
/** A staff diet OVERRIDE (`products.dietOverride`): explicit label wins over the derivation, plus
 * halal/kosher (which are never derived) and contains-tag add/remove. Absent fields don't override. */
export interface DietOverride {
  vegan?: "yes" | "no";
  vegetarian?: "yes" | "no";
  halal?: "yes" | "no";
  kosher?: "yes" | "no";
  addContains?: ContainsTag[];
  removeContains?: ContainsTag[];
}
/** The PUBLISHED diet profile of a product (`products.diet`) — the derivation folded with the override.
 * `contains` lists the meat/fish tags present; halal/kosher appear only when the override set them. */
export interface DietProfile {
  vegan: DietLabel;
  vegetarian: DietLabel;
  contains: ContainsTag[];
  halal?: "yes" | "no";
  kosher?: "yes" | "no";
}

/**
 * One selectable choice inside a {@link TillOptionGroup} (ordering modifiers, Task 3). A LOCAL mirror
 * of catalogue's `ResolvedOptionItem`, deliberately NOT imported from `@waitron/catalogue` — same
 * bundle-decoupling rationale as every other type in this file. `priceDelta` is the GROSS
 * (VAT-inclusive) numeric column carried as a string, like {@link TillProduct.unitPrice}; the modifier
 * picker adds the selected deltas to its display-only running price. `vatClass` is null when the item
 * INHERITS the parent dish's rate (a non-null value overrides it) — carried for shape-fidelity; the
 * client never prices from it (the server re-prices authoritatively from the id).
 */
export interface TillOptionItem {
  id: string;
  name: Record<string, string>;
  priceDelta: string;
  vatClass: "general" | "reduced" | "super_reduced" | "zero" | null;
  /**
   * The AUTHORED cap on how many times this option may be taken per dish (catalogue's
   * `option_group_items.max_quantity`, per-option quantity). `1` = a plain single choice (no
   * stepper); `> 1` lets the modifier picker offer a `− N +` stepper (bounded also by the group's
   * `maxSelect`). Always sent by `GET /api/products` — the resolved product shape carries it. The
   * client uses it only to bound the stepper UX; the server re-validates the count authoritatively.
   */
  maxQuantity: number;
  /**
   * The option's per-item allergen OVERLAY (modifier↔allergen, Task 4), carried so the basket can
   * compute each dish line's AS-SERVED profile CLIENT-side (`deriveAsServedAllergens`), the same way
   * it prices lines client-side — no server round trip. `addAllergens`: the codes this option
   * CONTRIBUTES ("extra cheese" → milk), keyed by allergen code, null when it adds nothing.
   * `removeAllergens`: the codes it STRIPS from the dish's declared set ("gluten-free bun" → gluten),
   * null when it strips nothing. A LOCAL redefinition of catalogue's `ResolvedOptionItem` overlay,
   * deliberately NOT imported from `@waitron/catalogue` — same bundle-decoupling rationale as every
   * other type in this file. `GET /api/products` sends both (a straight passthrough of catalogue's
   * `listAvailableProducts`, which projects them onto each item).
   */
  addAllergens: Record<string, { presence: "contains" | "may_contain"; source?: string }> | null;
  removeAllergens: string[] | null;
  /**
   * The option's per-item ORIGIN overlay (dietary-classification, Task 6) — the diet twin of
   * `addAllergens`/`removeAllergens`, carried so the basket can compute each dish line's AS-SERVED diet
   * CLIENT-side (`deriveAsServedDiet`) exactly as it does the as-served allergens. `addOrigins`: the
   * ingredient origins this option CONTRIBUTES ("add bacon" → `["meat"]`), null when it adds nothing.
   * `removeOrigins`: the origins it STRIPS ("no cheese" → `["dairy"]`), null when it strips nothing.
   * Carried as `string[]` (the wire shape from catalogue's `listAvailableProducts`); `asServedDiet`
   * narrows to the origin union at the fold boundary, as the server's `deriveAsServedDiet` call does.
   */
  addOrigins: string[] | null;
  removeOrigins: string[] | null;
}

/**
 * One active option group attached to a product (ordering modifiers, Task 3) — its active `items` in
 * sort order (`[]` when every item is inactive), plus the selection bounds the modifier picker enforces
 * CLIENT-side as UX (the server re-validates authoritatively): `minSelect`/`maxSelect` bound how many
 * items a diner may pick and `required` forces at least one. A LOCAL mirror of catalogue's
 * `ResolvedOptionGroup`, NOT imported — same bundle-decoupling rationale as every other type in this file.
 */
export interface TillOptionGroup {
  id: string;
  name: Record<string, string>;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  items: TillOptionItem[];
}

/** One sellable product from `GET /api/products` (mirrors catalogue's `AvailableProduct`). */
export interface TillProduct {
  id: string;
  descriptions: Record<string, string>;
  pricingUnit: "each" | "weight";
  unitPrice: string;
  vatClass: "general" | "reduced" | "super_reduced" | "zero";
  category: string | null;
  /**
   * EU-14 allergen declaration; null = not reviewed. Keyed by allergen code (menu & allergens). A
   * LOCAL redefinition of catalogue's `ProductAllergens` shape, deliberately NOT imported from
   * `@waitron/catalogue` — same bundle-decoupling rationale as every other type in this file (see the
   * file header). `presence` is the contains/may-contain strength; `source` names the specific
   * substance ("wheat", "almendra") when known. Task 6 renders these on the allergen screen.
   */
  allergens: Record<string, { presence: "contains" | "may_contain"; source?: string }> | null;
  /**
   * The product's DEFAULT kitchen course (KDS-2 `products.course_id`), or null when it has none — the
   * value the tab-order screen's per-line course picker PRE-SELECTS. Mirrors catalogue's
   * `AvailableProduct.course_id`, which `GET /api/products` always sends; OPTIONAL here (unlike
   * `category`) purely so the many pre-KDS-2 `TillProduct` fixtures that predate it need no update — an
   * absent value reads as "no default course", the same as null. NOT imported (the bundle rule).
   */
  courseId?: string | null;
  /**
   * The catalogue (menu) this product is sold from — its `catalogues.id`. A location may sell across
   * several accessible menus (its default plus any joined ones), so each product is tagged with which
   * one it came from; the till's client-side menu filter shows only the selected menu's products.
   * Mirrors catalogue's `AvailableProduct.catalogueId`, which `GET /api/products` always sends. OPTIONAL
   * here (like {@link courseId}) purely so the many pre-multi-menu `TillProduct` fixtures need no update
   * — an absent value simply never matches a selected menu. NOT imported (the bundle rule).
   */
  catalogueId?: string;
  /** The menu's display name (`catalogues.name`, localised at seed time). Mirrors `AvailableProduct`;
   * carried for completeness — the switcher renders `TillMenu.name`, not this. OPTIONAL for the same
   * fixture reason as {@link catalogueId}. */
  catalogueName?: string;
  /**
   * The product's attached ACTIVE option groups (ordering modifiers, Task 3), each with its active items
   * in sort order — `[]`/absent when the product has none. Mirrors catalogue's
   * `AvailableProduct.optionGroups`, which `GET /api/products` always sends. OPTIONAL here (like
   * {@link courseId}/{@link catalogueId}) purely so the many pre-modifier `TillProduct` fixtures need no
   * update — an absent value reads as "no groups", the same as `[]`. Tapping a product that HAS a
   * non-empty group opens the modifier picker (Task 10); one with none rings up straight away. NOT
   * imported (the bundle rule).
   */
  optionGroups?: TillOptionGroup[];
  /**
   * The product's PUBLISHED diet profile (dietary-classification, Task 6) — catalogue's `products.diet`,
   * the derivation folded with any staff override. The menu diet filter (`filterProductsByDiet`) reads
   * it; the diet screen renders it. OPTIONAL/nullable for the same fixture reason as {@link courseId}: a
   * `null`/absent value reads as an unreviewed dish (never vegan/vegetarian), so those filters exclude it.
   * Mirrors catalogue's `AvailableProduct.diet`, which `GET /api/products` always sends. NOT imported.
   */
  diet?: DietProfile | null;
  /** The recipe-derived diet basis (`products.dietDerivation`) — origins + `pending`, carried so the
   * basket can recompute the AS-SERVED diet client-side. Null/absent = no recipe (folds as pending).
   * Mirrors `AvailableProduct.dietDerivation`; OPTIONAL for the fixture reason above. NOT imported. */
  dietDerivation?: DietDerivation | null;
  /** The staff diet OVERRIDE ALONE (`products.dietOverride`), re-applied over the as-served derivation.
   * Null/absent = no override. Mirrors `AvailableProduct.dietOverride`; OPTIONAL for the fixture reason
   * above. NOT imported. */
  dietOverride?: DietOverride | null;
}

/**
 * One menu (catalogue) the till's location may sell from — the `menus[]` half of `GET /api/products`.
 * Mirrors catalogue's `AccessibleCatalogue` (NOT imported — the bundle rule). Ordered default-first by
 * the server; `isDefault` flags the location's own catalogue, which the switcher pre-selects.
 */
export interface TillMenu {
  id: string;
  name: string;
  isDefault: boolean;
}

/** The `GET /api/products` payload: the location's accessible menus + every sellable product across
 * them (each tagged with its {@link TillProduct.catalogueId}). The till filters `products` by the
 * selected menu client-side; a single-menu location renders exactly as before (no switcher). */
export interface ProductCatalogue {
  menus: TillMenu[];
  products: TillProduct[];
}

/**
 * The meat-doneness enum (order-line customisation) — a LOCAL redefinition of the server's
 * `packages/db` `Doneness`, the same bundle-decoupling rationale as every other type in this file (see
 * the file header). Values MUST match the server's `DONENESS` tuple exactly (`schema/orders.ts`); the
 * server re-validates any `doneness` it receives against that enum (`working_order.invalid_doneness`). NON-FISCAL:
 * doneness lives only on `working_order_lines`/`ticket_items` (snapshotted at fire), never on the fiscal
 * projection or a huella.
 *
 * Declared as a runtime `as const` TUPLE so the `Doneness` TYPE is DERIVED from it — the client picker
 * (`line-extras-editor`) imports this one array rather than re-listing the five values, and the type
 * pins them so the array and the union can never drift. Kept a client-local literal, NOT imported from
 * `@waitron/db` at runtime (the bundle rule — see the file header).
 */
export const DONENESS = ["rare", "medium_rare", "medium", "medium_well", "well_done"] as const;
export type Doneness = (typeof DONENESS)[number];

/**
 * One basket line the till sends to `POST /api/sales`: never a price — the server re-prices.
 * `options` (ordering modifiers) are the selected modifiers on the line, each naming an
 * `optionGroupItemId` the server resolves AUTHORITATIVELY (price, VAT, name) and files as a child line
 * under this dish, plus an OPTIONAL `quantity` — how many times that option is taken per dish
 * (per-option quantity). `quantity` is ABSENT when it is 1, so a plain modifier's wire is
 * byte-identical to before; when present it is a small positive integer the server re-prices and
 * re-validates against the option's authored `max_quantity`. `options` itself is ABSENT for a plain
 * line — never `[]` — so a no-modifier sale is byte-identical to before. The server (`POST /api/sales`,
 * `addTabRound`) reads `options ?? []`; a `weight` line carrying options is refused server-side. The
 * client sends only the id (and the count when > 1): the running line price is DISPLAY-ONLY.
 *
 * `note` (a free-text kitchen instruction, capped at 200 chars server-side) and `doneness` (the meat
 * enum above) are the per-line customisation (order-line customisation, spec §2/§3), NON-FISCAL: the
 * server trims/validates them and stores them on the working-order line only, never on the sale. Both
 * are ABSENT for a plain line — a whitespace-only note is "not chosen" and omitted — so a no-note,
 * no-doneness sale stays byte-identical to before.
 */
export interface SaleLine {
  productId: string;
  quantity: string;
  options?: { optionGroupItemId: string; quantity?: number }[];
  note?: string;
  doneness?: Doneness;
}

/**
 * One round line the tab-order screen sends to {@link TillApi.addTabRound} (KDS-2 §5b): a {@link SaleLine}
 * that MAY carry a `courseId` OVERRIDE the waiter picked. Absent (the picker left on the product default)
 * = the server resolves the product's default course (`<override> ?? product.course_id`). Only ever a real
 * course id — the picker offers no explicit "no course" option — so never `null`.
 *
 * It MAY also carry `hold: true` — the round bar's per-line hold toggle (coursing editing A3): insert the
 * line but do NOT fire it yet, regardless of its course (the server reads `hold` to hold `fired_at NULL`
 * even for a course that would otherwise fire on send). Absent (the toggle left OFF, its default) = the
 * line fires by the normal course rule; only ever `true` — an un-held line OMITS the field, never `false`.
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
 * A manual card tender — the counter charged the card on the standalone bank terminal (datáfono) and
 * records it here. `amount` is the sale total (a card is charged the exact total, never over-tendered,
 * so there is no change); `externalRef` is the terminal's optional operation number, absent when the
 * operator did not key one.
 */
export interface CardTender {
  method: "card";
  amount: string;
  externalRef?: string;
}

/** Either tender `POST /api/sales` accepts. The server distinguishes them on `method`. */
export type Tender = CashTender | CardTender;

/**
 * One line of the FILED composition the receipt identifies (RD 1619/2012 art. 7.1.e). Mirrors the
 * server's `TillSaleLine`: goods `descriptions` (locale → text, resolved in the invoice locale), the
 * display `quantity`, and the GROSS per-line total (Σ equals `total`). The receipt renders THESE, never
 * the mutable client basket, so the printed line list can never diverge from the invoice.
 */
export interface TillSaleLine {
  descriptions: Record<string, string>;
  quantity: string;
  gross: string;
  /** The `lineNo` of this row's PARENT dish when it is a CHILD modifier line (ordering modifiers), else
   *  `null`/absent for a top-level dish — mirrors the server's `TillSaleLine.parentLineNo`
   *  (`apps/server/src/till-sale.ts`), carried through unchanged from the filed composition. PRESENTATION
   *  metadata only (never hashed, never a fiscal figure): the settled-ticket view (Task 14) groups each
   *  option under its dish by this field, the same grouping the printed receipt (`formatReceipt`) and
   *  the on-screen basket already render. */
  parentLineNo?: number | null;
}

/** `POST /api/sales` success — the ticket payload the receipt view renders. */
export interface TillSaleResult {
  invoiceNumber: string;
  issuedAt: string;
  total: string;
  vatBreakdown: VatBreakdownEntry[];
  /** The filed line list (goods identification), rendered by the receipt instead of the client basket. */
  lines: TillSaleLine[];
  change: string;
  qr: string;
}

/**
 * One row of `GET /api/working-orders` — a parked order the counter can retrieve (park & retrieve,
 * sub-project 7b). Mirrors the server's `HeldOrderSummary` (`apps/server/src/working-order.ts`):
 * `total` is the GROSS (VAT-inclusive) draft total — equal to the basket total the operator saw, the
 * figure the held-orders widget shows with `formatMoney` — and `itemCount` the line count, both as the
 * server sends them; `label` is null when the order was parked without one.
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
 * `GET /api/working-orders/:id` — a retrieved parked order: enough to name it in the UI plus the
 * pricing INPUTS to rebuild its basket. Mirrors the server's `HeldOrder`. `lines` are `product_id` +
 * `quantity` only (never a stored price — the till re-prices on retrieve); the server sends
 * `quantity` at numeric(_,3) scale ("2.000"), passed through here as sent.
 */
export interface HeldOrder {
  id: string;
  orderNumber: number;
  label: string | null;
  lines: SaleLine[];
}

/**
 * The per-location pay-timing / service mode (7c prepare & collect, design §3). Mirrors the server's
 * `OrderFlow` (`apps/server/src/till-config.ts`, derived from `@waitron/db`'s `order_flow` enum) as a
 * LOCAL copy — same decoupling rationale as every other type in this file. `prepay` (Mode P) pays at
 * order, today's walk-up flow; `invoice_first` (Mode I) and `ticket_then_pay` (Mode T) place the order
 * first and collect payment later.
 */
export type OrderFlow = "prepay" | "invoice_first" | "ticket_then_pay";

/**
 * The kitchen state a ticket item advances through (KDS-1 §2d) — `queued → preparing → ready`. A LOCAL
 * copy of the server's `TicketState` (`apps/server/src/working-order.ts`, the `ticket_state` enum that
 * succeeds `order_prep`'s dropped `prep_state`), deliberately NOT imported — same bundle-decoupling
 * rationale as every other type in this file. `collected` is GONE from the kitchen states: a counter
 * order's handover is now an order-level `collected_at`, not a kitchen state (design §2d/§3e).
 */
export type TicketState = "queued" | "preparing" | "ready";

/**
 * A working order's own status (`open → placed → settled|abandoned`). A LOCAL copy of the server's
 * `WorkingOrderStatus` (`apps/server/src/working-order.ts`, derived from `@waitron/db`'s
 * `working_order_status` enum), NOT imported — same bundle-decoupling rationale as every other type in
 * this file. The station queue carries it so the display shows the Mode-P collect action only on a
 * COLLECTABLE order — a `settled` one awaiting its counter handover ({@link TillApi.markCollected}); an
 * `open` (tab) or `placed` (awaiting the fiscal {@link TillApi.collectOrder}) order is not collectable there.
 */
export type WorkingOrderStatus = "open" | "placed" | "settled" | "abandoned";

/**
 * `POST /api/working-orders/:id/place` success (7c). `open → placed`: Mode I files a deferred
 * invoice HERE and returns its number; Modes T and P (the latter never reaches this route) file
 * nothing at placing, so every field past `id`/`status` is present only for Mode I. Mirrors the
 * server's `PlaceOrderResult`.
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
 * One configured kitchen station from `GET /api/stations` (KDS-1 §3f) — the slim shape the station
 * picker reads. A LOCAL mirror of the server's `Station` (`apps/server/src/kitchen.ts`), deliberately
 * NOT imported — same bundle-decoupling rationale as every other type in this file. The display only
 * READS stations to populate its picker; station CRUD is the management API's, so this carries no
 * create-side fields. `isDefault` names the venue's single fallback station (the counter/pass), the one
 * the counter's own default-station queue reads.
 */
export interface Station {
  id: string;
  name: string;
  displayOrder: number;
  isDefault: boolean;
  active: boolean;
}

/**
 * One selected option (ordering modifier) on a queue item — mirrors the server's `QueueModifier`
 * (`apps/server/src/working-order.ts`): the child modifier line's SNAPSHOTTED `descriptions` map, so
 * the KDS display localises it client-side exactly as it does the dish name, never a pre-flattened
 * string (the never-store-formatted rule). A dish is never its own ticket item; it rides here as
 * sub-text beneath its parent.
 */
export interface QueueModifier {
  descriptions: Record<string, string>;
}

/**
 * The AS-SERVED allergen profile of a queue/expo item (modifier↔allergen, Task 8/9) — the parent
 * product's published allergens folded with its selected options' overlays (Cautious: a `remove` strips
 * a code, an `add` merges one), computed SERVER-side and attached to each read. `allergens` is keyed by
 * allergen code (`presence` = contains/may-contain strength, `source` names the specific substance when
 * known); `pending` is true when the dish's OWN allergens are unreviewed (a null base), so the KDS shows
 * the plate as unverified. Display-only — never a fiscal value. A LOCAL mirror of catalogue's / the
 * server's `AsServedAllergens`, NOT imported — same bundle-decoupling rationale as every type in this file.
 */
export interface AsServedAllergens {
  allergens: Record<string, { presence: "contains" | "may_contain"; source?: string }>;
  pending: boolean;
}

/**
 * One ticket item on a station's queue (KDS-1 §3c) — its id (the per-line bump target for
 * {@link TillApi.advanceTicketItem}), the working-order line it was fired from, and its current kitchen
 * `state`. A LOCAL mirror of the server's `StationQueueItem` (`apps/server/src/working-order.ts`), NOT
 * imported — same bundle-decoupling rationale as every other type in this file.
 */
export interface StationQueueItem {
  id: string;
  workingOrderLineId: string;
  state: TicketState;
  /**
   * The line's snapshotted dish description (locale → text), so the kitchen display renders the dish
   * name ("2× Paella"), not a bare line number. Resolved for display in the operator's locale with a
   * first-available fallback, exactly as `productName` resolves a product's `descriptions`.
   */
  descriptions: Record<string, string>;
  /** The line's quantity (numeric(12,3) as text, e.g. "2.000"), shown as "qty× dish" on the display. */
  quantity: string;
  /** The dish's selected options (ordering modifiers), in selection order — rendered as indented `+
   *  <name>` sub-text beneath this item (KDS widgets, Task 14). Optional/absent on an older payload or a
   *  plain-dish fixture, treated identically to an empty array — a modifier-free item renders exactly
   *  as before. */
  modifiers?: QueueModifier[];
  /** The dish's AS-SERVED allergen profile (modifier↔allergen, Task 8/9) — the parent's published
   *  allergens folded with its selected options' overlays; the KDS renders its codes as "contains" chips
   *  and shows a "not reviewed" note when {@link AsServedAllergens.pending}. Optional/absent on an older
   *  payload or a pre-Task-8 fixture, treated as "no profile attached" (nothing rendered) — a plain dish
   *  reads exactly as before. */
  asServed?: AsServedAllergens;
  /** The dish's AS-SERVED diet profile (dietary-classification, Task 5) — the diet twin of
   *  {@link asServed}: the recipe-derived origins folded with the options' overlays, the staff override
   *  re-applied. The KDS renders vegan/vegetarian/halal/kosher badges + contains chips beside the
   *  allergen chips, and a neutral "not reviewed" note while `vegan === "unknown"` (pending). Optional/
   *  absent (⇒ nothing rendered) on an older payload or a pre-diet fixture. */
  asServedDiet?: DietProfile;
  /** The base allergen codes the selected options SUBTRACTED (present in the product but not in
   *  {@link asServed}) — the KDS renders each as a struck "NO <allergen>" callout, the allergen name
   *  localised like the "contains" chips ("gluten-free bun" removed gluten). Optional/absent (⇒ empty)
   *  on an older payload, like {@link asServed}. */
  removed?: string[];
  /** The item's course (KDS-2 §3d/§5a), or `null` for a line with no course — the display groups the
   *  queue by this and renders a per-course header in `displayOrder`. A LOCAL mirror of the server's
   *  `StationQueueCourse` (`apps/server/src/working-order.ts`), NOT imported (the bundle rule). */
  course: StationQueueCourse | null;
  /** `null` while the item's course is HELD — the display renders it GREYED and non-advanceable
   *  (`advanceTicketItem` refuses it, `ticket.item_held`); a timestamp once fired (the auto-fired
   *  earliest course, or released via {@link TillApi.fireCourse}). */
  firedAt: string | null;
  /** The per-line kitchen customisation (order-line customisation, spec §2/§3, NON-FISCAL) — the
   *  SNAPSHOTTED `note`/`doneness` the server froze at fire (not the live line, so a later edit never
   *  changes what the cook sees). The KDS renders the doneness PROMINENTLY and the note as sub-text beside
   *  the modifiers. Optional/`null`/absent (⇒ nothing rendered) on an older payload or a plain line —
   *  {@link Doneness} is the meat-doneness enum, localised via the `doneness.*` labels. */
  note?: string | null;
  doneness?: Doneness | null;
}

/**
 * The course a queue item was fired for (KDS-2 §5a) — its id (the {@link TillApi.fireCourse} target), the
 * display `name`, and the `displayOrder` that sequences the coursing sections. A LOCAL mirror of the
 * server's `StationQueueCourse` (`apps/server/src/working-order.ts`), NOT imported — same bundle-decoupling
 * rationale as every other type in this file. `null` on the item when its line carried no course.
 */
export interface StationQueueCourse {
  id: string;
  name: string;
  displayOrder: number;
}

/**
 * One order's lines at a station, grouped for the per-station display (KDS-1 §3c) — the order's id and
 * operator `label`, the `queuedAt` of its OLDEST line at this station (the group's oldest-first
 * ordering key + the age-colouring anchor), and the lines themselves. A LOCAL mirror of the server's
 * `StationQueueGroup` (`apps/server/src/working-order.ts`), NOT imported — same bundle-decoupling
 * rationale as every other type in this file. The per-line/per-station successor to the removed
 * `PrepQueueEntry` (which was one row per order); the reworked `GET /api/stations/:id/queue` returns
 * these grouped by order, oldest first.
 */
export interface StationQueueGroup {
  orderId: string;
  orderNumber: number;
  label: string | null;
  queuedAt: string;
  /** The order's own status (KDS-1 collect fix). Every order on the queue is non-abandoned and not
   *  yet collected (the server filters both), so the display reads COLLECTABLE off this alone: a
   *  `settled` order is a Mode-P pickup awaiting its counter handover ({@link TillApi.markCollected}). */
  status: WorkingOrderStatus;
  items: StationQueueItem[];
  /** This station's order-timing thresholds (KDS order-timing alerts, design §3/§6/§11) — every group
   *  from one `getStationQueue` call shares the same station, hence the same thresholds, but they ride
   *  per-group (not a separate fetch) so the widget's `TickingClock` can re-derive {@link queuedAt}'s
   *  band locally between refreshes, via `classifyBand` (`@waitron/shared`). A LOCAL-mirror field like
   *  every other one in this file — the server's `StationQueueGroup` (`apps/server/src/working-order.ts`)
   *  is the source of truth. */
  thresholds: StationThresholds;
}

/**
 * `POST /api/device/enrol` success (device-identity-1 §5a/§3b) — the four NON-SECRET fields the server
 * echoes after redeeming a pairing code: the new device's id, its `kind`, the `stationId` it is bound to
 * (fixed by enrolment), and the operator-chosen `label`. The trusted device TOKEN is deliberately ABSENT —
 * it leaves the server ONLY in the httpOnly `Set-Cookie` header, never a JSON body (`device-api.ts`) — so
 * the client never sees it. The enrol view shows these to confirm which station the display bound to. A
 * LOCAL mirror of the server's enrol response, NOT imported — the same bundle-decoupling rationale as
 * every other type in this file.
 */
export interface DeviceEnrolment {
  deviceId: string;
  kind: string;
  // `null` for a station-less kind (a `handheld`); a `kds_station` enrolment carries its station id.
  // The server's POST /api/device/enrol returns `null` here for a handheld; both callers ignore the
  // resolved value (they re-boot off the device cookie), so this widening is documentation-accuracy.
  stationId: string | null;
  label: string;
}

/**
 * `GET /api/device/me` success (device-identity §3b, handheld-tableside Task 4) — the enrolled device's
 * own NON-SECRET identity: its `deviceId`, its `kind` (`kds_station` for a kitchen display, `handheld`
 * for a waiter's phone), and the `stationId` it is bound to (`null` for a kind that binds to no station,
 * such as a handheld). Read once on boot ({@link TillApp}'s device probe) to decide which shell the till
 * boots into. A LOCAL mirror of the server's response, NOT imported — the bundle-decoupling rule. `kind`
 * is a plain `string` (not a union): the client only branches on the values it knows and treats any other
 * as "not a special device", so a server that adds a new kind never breaks an older client.
 */
export interface DeviceIdentity {
  deviceId: string;
  kind: string;
  stationId: string | null;
}

/**
 * `GET /api/device/station` success (device-identity-1 §5a) — the enrolled display's OWN bound station:
 * its `id` and current `queue` (grouped by order, the SAME {@link StationQueueGroup} shape the
 * session-gated `getStationQueue` returns). The station is fixed by enrolment, so there is no picker and
 * no id to pass — the device cookie names it server-side. A LOCAL mirror of the server's response, NOT
 * imported (the bundle rule).
 */
export interface DeviceStation {
  station: { id: string; queue: StationQueueGroup[] };
}

/**
 * One item on the cross-station expo/pass board (KDS-3 §3a) — a fired-or-held ticket item carrying the
 * display fields the pass renders: the line's snapshotted `name` map + `qty`, the RESOLVED station name
 * (the cross-station label {@link StationQueueItem} deliberately omits, so the expediter sees the grill
 * lagging the cold station), the kitchen `state`, and the `firedAt`/`awayAt` lifecycle stamps. A LOCAL
 * mirror of the server's `ExpoItem` (`apps/server/src/working-order.ts`), NOT imported — same
 * bundle-decoupling rationale as every other type in this file. `name` is the locale→description map
 * (localised client-side, per the never-store-formatted rule), like {@link StationQueueItem.descriptions}.
 */
export interface ExpoItem {
  id: string;
  name: Record<string, string>;
  qty: string;
  stationName: string;
  state: TicketState;
  /** `null` while the item's course is HELD (the pass greys it); a timestamp once fired. */
  firedAt: string | null;
  /** `null` until the expediter dispatches it (`markCourseAway`); a timestamp once away to the floor. */
  awayAt: string | null;
  /** The per-line kitchen customisation (order-line customisation, spec §2/§3) — the SNAPSHOTTED
   *  `note`/`doneness` the server froze at fire, the same fields {@link StationQueueItem.note}/`doneness`
   *  carry; the pass renders the doneness PROMINENTLY and the note as sub-text. Optional/`null`/absent
   *  (⇒ nothing rendered) on an older payload or a plain line. */
  note?: string | null;
  doneness?: Doneness | null;
  /** The dish's selected options (ordering modifiers), in selection order — rendered as indented `+
   *  <name>` sub-text beneath this item (Task 14), the same {@link QueueModifier} shape the per-station
   *  display renders. Optional/absent on an older payload or a plain-dish fixture, treated identically
   *  to an empty array — a modifier-free item renders exactly as before. */
  modifiers?: QueueModifier[];
  /** The dish's AS-SERVED allergen profile (modifier↔allergen, Task 8/9) — the same fold
   *  {@link StationQueueItem.asServed} carries; the pass renders its codes as "contains" chips and a
   *  "not reviewed" note when {@link AsServedAllergens.pending}. Optional/absent (⇒ nothing rendered) on
   *  an older payload or a plain-dish fixture. */
  asServed?: AsServedAllergens;
  /** The dish's AS-SERVED diet profile (dietary-classification, Task 5) — the same fold
   *  {@link StationQueueItem.asServedDiet} carries; the pass renders diet badges + contains chips and a
   *  neutral "not reviewed" note when pending. Optional/absent (⇒ nothing rendered). */
  asServedDiet?: DietProfile;
  /** The base allergen codes the selected options SUBTRACTED — see {@link StationQueueItem.removed};
   *  the pass renders each as a struck, localised "NO <allergen>" callout. Optional/absent (⇒ empty). */
  removed?: string[];
  /**
   * This item's own `ticket_items.queued_at` (KDS order-timing alerts, design §3/§6/§11), ISO —
   * UNLIKE {@link StationQueueGroup.thresholds} this rides PER ITEM: a single expo order's items can
   * span several stations, each with its own thresholds, so the pass classifies each item against ITS
   * OWN station rather than a single order-wide clock. `till-expo-screen`'s `TickingClock` re-derives
   * the live band from this plus {@link thresholds} between refreshes (`classifyBand`,
   * `@waitron/shared`), the same re-tick shape `StationQueueGroup.queuedAt` already drives. A LOCAL
   * mirror field like every other one in this file — the server's `ExpoItem`
   * (`apps/server/src/working-order.ts`) is the source of truth.
   */
  queuedAt: string;
  /** This item's OWN station's order-timing thresholds — per item, not per order, because one order's
   *  items can span several stations each with different thresholds (see {@link queuedAt}). */
  thresholds: StationThresholds;
  /** This item's age band against its own station's thresholds, computed on the DB clock at fetch
   *  time. Authoritative for the very first paint; `till-expo-screen` re-derives it locally afterward
   *  (via {@link queuedAt}/{@link thresholds}) so a lagging item keeps escalating between refreshes
   *  with no new fetch. */
  band: TimingBand;
}

/**
 * One course section of an expo order (KDS-3 §3a) — the order's items for one course, ordered by
 * `displayOrder` (a null course has `courseId`/`courseName`/`displayOrder` null and sorts EARLIEST, the
 * same null-first coursing {@link StationQueueGroup} renders). Two roll-up flags drive the pass's
 * per-course lever: `fired` is true once EVERY item carries `firedAt` (so a held course reads `false` and
 * the pass offers Fire under `fire_control = 'expo'`); `away` is true once every item carries `awayAt`
 * (the drop-off signal the screen uses to retire the course). A LOCAL mirror of the server's `ExpoCourse`
 * (`apps/server/src/working-order.ts`), NOT imported — same bundle-decoupling rationale as every type here.
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
 * One open order on the cross-station expo/pass board (KDS-3 §3a) — its id, the human `orderNumber` and
 * optional dining-table label, how long it has been open (`openedMinutes`, the pass's urgency clock), and
 * its ticket items grouped BY COURSE in `displayOrder`. `tableLabel` is present only when the order maps
 * to a table (a tab back-pointer or a counter delivery); it is omitted for a bare walk-up (the `?`). A
 * LOCAL mirror of the server's `ExpoOrder` (`apps/server/src/working-order.ts`), NOT imported — same
 * bundle-decoupling rationale as every other type in this file. The server excludes abandoned/collected
 * and FULLY-away orders; a surviving order still carries all its items (away ones included), so the
 * SCREEN hides fully-away courses (via {@link ExpoCourse.away}), the read does not.
 */
export interface ExpoOrder {
  orderId: string;
  tableLabel?: string;
  orderNumber: number;
  openedMinutes: number;
  courses: ExpoCourse[];
  /**
   * The worst age band across the order's UNSERVED lines, computed on the DB clock at fetch time
   * (design §3 — a served line drops off the clock, so the reduction skips it; `"fresh"` when none
   * are aging). A LOCAL mirror of the server's `ExpoOrder.worstBand`
   * (`apps/server/src/working-order.ts`), NOT imported (the bundle rule). Authoritative for the very
   * first paint only: `till-expo-screen` re-derives a card's LIVE worst band locally, via `worstBand`
   * (`@waitron/shared`) over each visible item's own re-ticked {@link ExpoItem.band}, so the accent
   * keeps escalating between refreshes under its `TickingClock` — this field is not read directly by
   * that recompute, but rides for parity with the server payload.
   */
  worstBand: TimingBand;
}

/**
 * `POST /api/pay` outcome (integrated card terminal, sub-project 7 Task 8). Mirrors the server's
 * `IntegratedPayOutcome` (`apps/server/src/till-sale.ts`) as a LOCAL copy — same decoupling rationale
 * as every other type in this file. A DELIBERATE divergence from {@link TillSaleResult}'s
 * throw-or-ticket shape: a decline/stall/offline-refusal is DATA, never a thrown `{ code }` — nothing
 * may block a sale on anything but the sale itself (CLAUDE.md §5) — so the caller branches on
 * `outcome` instead of catching. `timeout` is reserved: the server currently collapses a poll-window
 * stall into `declined` too (`toPayOutcome`'s own doc, `apps/server/src/till-sale.ts:1217-1225`) —
 * "every other non-terminal state — today just `failed` … maps to `declined`" — so a client that
 * branches on `timeout` today would never see it fire.
 */
export type PayOutcome =
  | { outcome: "captured"; ticket: TillSaleResult }
  | { outcome: "declined" }
  | { outcome: "timeout" }
  | { outcome: "network_unavailable" };

/**
 * The four `absence_kind` enum members (`@waitron/workforce`'s `absenceKind`), a LOCAL union — never a
 * runtime import from the engine (the bundle rule, see the file header). The staff schedule screen's
 * kind picker offers these; the server re-validates against the real enum.
 */
export type AbsenceKind = "holiday" | "sick_leave" | "leave" | "unpaid";

/** One of my upcoming shifts (`GET /api/schedule/shifts`; mirrors the server's `PersonShiftRow`). */
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
 * One swap I'm party to (`GET /api/schedule/swaps`; mirrors the server's `PersonSwapRow`). `direction`
 * says which side I'm on — `offered_to_me` (I can Accept it while `status === "requested"`) or
 * `requested_by_me` — and `status` its lifecycle stage.
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

/** One of my absences, any status (`GET /api/schedule/absences`; mirrors the server's `PersonAbsenceRow`). */
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

/**
 * One active floor-plan zone from `GET /api/zones` (FP-1). A LOCAL mirror of the server's `FloorZone`
 * (`apps/server/src/tables.ts`), deliberately NOT imported — same bundle-decoupling rationale as every
 * other type in this file. The till only READS zones to render the live floor; zone CRUD is the
 * management API's, so this shape carries no create-side fields.
 */
export interface FloorZone {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
}

/**
 * One row of the live-floor occupancy read-model from `GET /api/tables/state` (FP-1, design §4). A LOCAL
 * mirror of the server's `TableState` (`apps/server/src/working-order.ts`'s `listTablesWithState` return),
 * NOT imported — same bundle-decoupling rationale as every other type in this file. The raw signals
 * (`hasOpenTab`, `pendingDeliveries`, `pendingToServe`, `readyToServe`) sit alongside the rolled-up
 * `state` so the floor plan can render a richer badge. `zoneId` is the `floor_zones` row this table sits
 * in, or null. The `tabId`/`tabLineCount`/`tabTotal` trio is present iff a tab is open (`hasOpenTab`);
 * `tabTotal` is the open tab's gross draft total as numeric(12,2) text. `status` is the table's MANUAL
 * service status (a colour badge), independent of occupancy, or null. `pendingToServe` counts the open
 * tab's lines still to deliver (`served_at IS NULL`); `readyToServe` counts those the kitchen has bumped
 * `ready` but the waiter has not yet served (KDS-1 §3d, the floor's "N listos"); `enRoute` counts those
 * the pass has DISPATCHED (`away_at IS NOT NULL`) but the waiter has not yet acknowledged (KDS-3 §3c, the
 * floor's "en camino"). All three are DISTINCT from `pendingDeliveries` (uncollected counter deliveries).
 * The floor renders the MOST-ADVANCED hint per table — en camino (`enRoute`) over listos (`readyToServe`)
 * over por servir (`pendingToServe`).
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
   * The worst age band across the open tab's UNSERVED lines (KDS order-timing alerts, design §7.3) —
   * `"fresh"` for a free table or one whose unserved lines are all still fresh. A LOCAL mirror of the
   * server's `TableState.timingBand` (`apps/server/src/working-order.ts`'s `listTablesWithState`),
   * NOT imported — same bundle-decoupling rationale as every other field in this file. UNLIKE
   * {@link StationQueueGroup.thresholds}/{@link ExpoItem.thresholds}, the floor ships only the
   * REDUCED worst band, not the raw per-line ages/thresholds `classifyBand` would need — so the live
   * floor screen cannot re-derive a climbing band locally; the value is fixed until the next
   * `getTablesState` fetch. Drives the floor's flash-red tile (`till-floor-screen`'s `#card`).
   */
  timingBand: TimingBand;
  status: { id: string; label: string; color: string } | null;
  /**
   * The table's NEXT imminent `booked` reservation (Bookings-1 §4, reserved-on-floor) — its earliest
   * reservation for the venue's TODAY at or after the grace floor (the venue's wall-clock rolled back a
   * short window so a due/late guest's badge lingers), or `null`. The floor
   * renders "Reserved HH:MM" from `time` (venue-local "HH:MM"). A LOCAL mirror of the server's
   * `TableState.nextReservation` (`apps/server/src/working-order.ts`'s `listTablesWithState`), NOT
   * imported — the same bundle-decoupling rationale as the siblings here. Non-optional `| null`,
   * unconditionally present, matching `status`/`posX`. Data-minimisation: only `time` is projected —
   * the floor badge renders "Reserved HH:MM" and nothing else, so the customer's party size / contact
   * name are deliberately kept off every till device (server: `listTablesWithState`).
   */
  nextReservation: { time: string } | null;
  /**
   * FP-2 spatial placement on the floor-plan canvas — canvas coordinates (0..1000 permille), the
   * rendered `shape`, and `rotation` in degrees, or `null` for an unplaced table. A LOCAL mirror of the
   * server's `TableState` placement fields (`apps/server/src/working-order.ts`'s `listTablesWithState`),
   * NOT imported — same bundle-decoupling rationale as every other type in this file. Written by
   * `setTablePlacement` / `clearPlacement`; the live-floor screen reads `posX != null` to decide whether
   * a table is placed (map) or belongs in the unplaced tray. Non-optional `| null` (unconditionally
   * present, `null` when unplaced), matching the `zoneId`/`capacity`/`status` siblings above.
   */
  posX: number | null;
  posY: number | null;
  shape: TableShape | null;
  rotation: number | null;
}

/**
 * The rendered shape of a placed table (FP-2). A LOCAL union mirroring `@waitron/db`'s
 * `floorTableShape = pgEnum("floor_table_shape", ["round", "square", "rect"])` and `@waitron/ui`'s
 * `TableShape` — deliberately NOT imported (the bundle-decoupling rule; a server round-trip
 * re-validates against the real enum).
 */
export type TableShape = "round" | "square" | "rect";

/**
 * The body of a `PUT /api/tables/:id/placement` (FP-2, Task 4) — the four placement columns plus the
 * table's target zone. Mirrors the on-till route's parsed body (`apps/server/src/till-api.ts`); the
 * server re-validates every field (`placement.invalid` for an out-of-range coord / bad shape / bad
 * rotation, `zone.not_found` for a missing or inactive zone). `zoneId` is `| null` because the shared
 * canvas can emit a placement for a still-zoneless table — the server refuses it, so a `null` never
 * silently persists.
 */
export interface TablePlacement {
  posX: number;
  posY: number;
  shape: TableShape;
  rotation: number;
  zoneId: string | null;
}

/**
 * One pickable table service status (FP-1, TS-2) from `GET /api/statuses` — the ACTIVE-only
 * `{ id, label, color }` the table-order screen's Estado picker offers. A LOCAL mirror of the server's
 * `ServiceStatusOption` (`apps/server/src/tables.ts`), deliberately NOT imported — same bundle-decoupling
 * rationale as every other type in this file. Structurally identical to the inline `TableState.status`
 * shape, and re-exported by `till-table-order-screen` as its `.statuses` element type.
 */
export interface TableServiceStatus {
  id: string;
  label: string;
  color: string;
}

/**
 * `POST /api/tables/:id/tab` success (FP-1) — the newly opened tab's working-order id plus the per-node
 * order number the counter sees. Mirrors the server's `openTab` return (`apps/server/src/working-order.ts`).
 * `tabId` is the working-order id the live floor threads to `addTabRound`/`markLineServed`.
 */
export interface TabResult {
  tabId: string;
  orderNumber: number;
}

/**
 * One line of an open tab from `GET /api/working-orders/:id/lines` (FP-1, design §3b) — what the
 * table-order screen renders per line. A LOCAL mirror of the server's `TabLine`
 * (`apps/server/src/working-order.ts`), deliberately NOT imported — same bundle-decoupling rationale as
 * every other type in this file. DISTINCT from {@link HeldOrder}'s `lines` (`productId` + `quantity`
 * only, for a basket rebuild that RE-prices): a tab does NOT re-price, so `unitPriceGross` is the gross
 * unit price LOCKED at add-time, carried back verbatim — never a catalogue recompute. `servedAt` is the
 * pre-fiscal served marker (`null` ⇒ "Pendiente de servir", a timestamp ⇒ "Servido"). `productId` only —
 * the screen resolves names from its own catalogue prop, mirroring `HeldOrder`. `quantity`/
 * `unitPriceGross` are decimal strings as the server sends them.
 */
export interface TabLine {
  lineNo: number;
  /** The line's product, or `null` for a CHILD MODIFIER line (ordering modifiers, Task 2) — a child has
   * no product of its own (it rides under its parent dish). Mirrors the server's nullable
   * `TabLine.productId` (`apps/server/src/working-order.ts`). The tab screen keys off this to tell a
   * top-level dish from a modifier row: a child (`productId === null`) carries no per-line kitchen action
   * and no course picker (coursing corrections C5 / C4), since it never fires a ticket item of its own
   * (`firedAt`/`state` are always null for it). Non-null for every top-level dish line. */
  productId: string | null;
  quantity: string;
  unitPriceGross: string;
  servedAt: string | null;
  /** The line's RESOLVED kitchen course (KDS-2), or null when it has none. The tab-order screen groups
   * its waiter-fire actions by this (the course NAME comes from {@link TillInfo.courses}). Mirrors the
   * server's `TabLine.courseId`, NOT imported (the bundle rule). */
  courseId: string | null;
  /** When the line's kitchen ticket item FIRED, or null while its course is still HELD (KDS-2 §5b) — a
   * course with any held line gets a "Fire <course>" action under `fire_control = 'waiter'`. Mirrors the
   * server's `TabLine.firedAt`, NOT imported (the bundle rule). */
  firedAt: string | null;
  /** The line's kitchen ticket item {@link TicketState}, or null when the line has no ticket item — the
   * same LEFT-join edge {@link firedAt} documents. A child modifier line ALWAYS lacks one (the server
   * never fires a modifier line to the kitchen). A parent line normally has one once fired/held, but can
   * also lack one — e.g. a tab opened with an initial round (inserted without firing), or a line moved
   * between tabs (merge/transfer re-inserts the line under a new id without re-firing it). Treat null as
   * "no LIVE ticket item", not as impossible for a parent. Coursing corrections (C1): lets the till tell
   * a RECALLABLE line (`firedAt` set, `state === "queued"`) from a CANCEL-only one (`state` "preparing"/
   * "ready") — `firedAt === null` alone means held, not recallable. Mirrors the server's `TabLine.state`,
   * NOT imported (the bundle rule). */
  state: TicketState | null;
}

/**
 * One entry in a TS-4 line transfer: which line to move and, for a PARTIAL move, how much of it. Omit
 * `quantity` (or pass the whole line quantity) for a whole-line move; a smaller decimal string splits the
 * line, the destination inheriting the same locked per-unit price. Mirrors the server's transfer entry
 * shape, NOT imported (the bundle rule).
 */
export interface TabTransfer {
  lineNo: number;
  quantity?: string;
}

export class TillApi {
  readonly #baseUrl: string;
  readonly #fetchImpl: FetchLike;
  #localesPromise?: Promise<{
    locales: Array<{ code: string; label: string }>;
    venueDefault: string;
  }>;

  /**
   * @param baseUrl prefixed to every path (default `""`: same-origin, so the browser fetches
   *   `/api/...` from the origin serving the app).
   * @param fetchImpl the `fetch` to use (default the global; a test injects a stub).
   */
  constructor(baseUrl = "", fetchImpl: FetchLike = fetch) {
    this.#baseUrl = baseUrl;
    this.#fetchImpl = fetchImpl;
  }

  getTill(): Promise<TillInfo> {
    return this.#request<TillInfo>("/api/till", "GET");
  }

  /**
   * `GET /api/locales` — the venue's offered languages (per-user-language-preference, Task 4). PUBLIC
   * (pre-login, like {@link getTill}): each `{ code, label }` is a `SUPPORTED_LOCALES` entry, and
   * `venueDefault` the tenant's fallback locale. The language chooser reads the list; the app decides
   * what to do with a pick, so the client only surfaces the shape.
   */
  getLocales(): Promise<{ locales: Array<{ code: string; label: string }>; venueDefault: string }> {
    // The list + venue default are immutable for this client's lifetime; fetch once and share.
    // Cache the promise ONLY on success — clear it on rejection so a transient failure retries.
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
   * Persist the signed-in operator's OWN UI-language preference (per-user-language-preference) →
   * `PUT /api/session/locale` with body `{ locale }`. Identity is the session's person server-side,
   * so there is no id to pass; the route answers an empty 204, so this resolves void. An unsupported
   * `code` rejects with `{ code: "locale.unsupported" }` (the server's one validation path). The app
   * calls this ONLY while logged in — a pre-login pick is transient and never written.
   */
  async putLocale(code: string): Promise<void> {
    await this.#request<void>("/api/session/locale", "PUT", { locale: code });
  }

  /**
   * `GET /api/products` — the location's accessible menus + every sellable product across them (each
   * tagged with its `catalogueId`). Returns the whole {@link ProductCatalogue}; the till holds all the
   * products and filters them by the selected menu client-side (a menu switch never re-fetches). SESSION
   * -guarded server-side — the app calls this only after login.
   */
  listProducts(): Promise<ProductCatalogue> {
    return this.#request<ProductCatalogue>("/api/products", "GET");
  }

  /**
   * Ring one sale over a persisted working order. `workingOrderId` is the pay-idempotency key: the
   * till holds it stable across a lost-response retry, so a re-sent pay REPLAYS against the same
   * `working_orders`/`sales` row rather than filing a second chained fiscal record (unrepairable — an
   * invoice number is never reused). For a walk-up it is a fresh client-minted id; to pay a PARKED
   * order the till sends that order's own id, so the settle lands on the retrieved order.
   */
  recordSale(lines: SaleLine[], tender: Tender, workingOrderId: string): Promise<TillSaleResult> {
    return this.#request<TillSaleResult>("/api/sales", "POST", { lines, tender, workingOrderId });
  }

  /**
   * Pay over the INTEGRATED card terminal (sub-project 7 Task 8) → `POST /api/pay`. Same
   * pay-idempotency shape as {@link recordSale}: `id` is the till's stable working-order id, kept
   * across a lost-response retry so a re-sent pay replays rather than filing a second chained fiscal
   * record; `lines` is the walk-up basket to price and file, IGNORED server-side for a
   * retrieved/placed order (it files its own stored locked lines). `tip` is the till-entered gross
   * tip (clamped to none when the till has tips disabled); `allowOffline` is per-transaction staff
   * consent to accept the card offline if the network is down. Unlike `recordSale`, the outcome is
   * always a 200 — see {@link PayOutcome}'s own doc for why a decline is data, not a throw.
   */
  pay(req: {
    id: string;
    lines: SaleLine[];
    tip?: string;
    allowOffline?: boolean;
  }): Promise<PayOutcome> {
    return this.#request<PayOutcome>("/api/pay", "POST", req);
  }

  /**
   * Reprint a FILED sale's customer receipt (counter receipt/drawer §3d/§5) → `POST /api/sales/:id/reprint`
   * with an empty body — the ticket screen's "Reprint" lever. `workingOrderId` is the till's own
   * working-order id (the client-minted key it sent on `POST /api/sales`, the id `recordSale` returns
   * against and the till still holds at the ticket stage); the server reads the ALREADY-FILED sale back by
   * it and re-enqueues PAPER only, filing NOTHING (§4 — the fiscal record is untouched) and IGNORING the
   * location's `receipt_print_mode` (a reprint is always available, §0). NON-FISCAL and idempotent: an id
   * naming no filed sale, or a till with no active printer, is a 200 NO-OP. The server answers an empty 200
   * (`c.body(null, 200)`), so this resolves void; the empty `{}` body mirrors the sibling
   * {@link reprintOrder}/{@link markCollected} order-level verbs (the route parses none).
   */
  async reprint(workingOrderId: string): Promise<void> {
    await this.#request<void>(`/api/sales/${workingOrderId}/reprint`, "POST", {});
  }

  /**
   * Manually open the cash drawer (counter receipt/drawer §3d/§5 + cash-drawer-authorization §5) →
   * `POST /api/drawer/open` — the ticket screen's "Abrir cajón" lever, for a no-sale open (giving
   * change, a cash count). SESSION-gated, AUTHORIZED and AUDITED server-side: it enqueues a kick-only
   * outbox job to the till's receipt printer (the drawer IS that printer's kick) and records a
   * `drawer_opens('manual')` row. It takes no id — the till's printer is resolved server-side from `cfg`.
   *
   * Under a `gated` drawer-open policy an operator whose role lacks `cash.drawer` is refused
   * `{ code: "authorization.not_permitted" }` (403); the caller then fetches the eligible supervisors
   * ({@link listDrawerAuthorizers}) and retries with an `override: { personId, pin }` — the authorizing
   * supervisor's id and PIN. The `override` is sent in the body ONLY on this authenticated request (never
   * a URL or query), and only when supplied — a permitted operator, and every `open`-policy open, sends
   * none. A wrong PIN rejects `{ code: "pin.invalid" }` (401); a till with NO receipt printer rejects
   * `{ code: "drawer.no_printer" }` (400). The server answers an empty 200 (`c.body(null, 200)`), so this
   * resolves void; with no override the `{}` body mirrors the empty-200 POST siblings (the route parses
   * an optional body).
   */
  async openDrawer(override?: { personId: string; pin: string }): Promise<void> {
    await this.#request<void>("/api/drawer/open", "POST", override ? { override } : {});
  }

  /**
   * The eligible authorizers for a gated cash-drawer open (cash-drawer-authorization §5) →
   * `GET /api/drawer/authorizers`. SESSION-gated (any logged-in operator may ask): the active persons
   * whose role holds `cash.drawer`, as `{ personId, displayName }` only — the same no-secrets shape as
   * {@link listStaff}. The caller shows them as a picker in the supervisor-override dialog; the chosen
   * supervisor's PIN reaches only {@link openDrawer}'s authenticated request.
   */
  listDrawerAuthorizers(): Promise<StaffMember[]> {
    return this.#request<StaffMember[]>("/api/drawer/authorizers", "GET");
  }

  /**
   * Park a working order to pay later (park & retrieve, sub-project 7b) → `POST /api/working-orders`.
   * `id` is client-minted (the till mints the working-order uuid) so a lost-response retry is
   * idempotent against the primary key; `lines` carry no price — the server re-prices. Returns the
   * persisted `{ id, orderNumber }` (the human order number the counter types back in to retrieve).
   */
  parkOrder(req: { id: string; lines: SaleLine[]; label?: string }): Promise<{
    id: string;
    orderNumber: number;
  }> {
    return this.#request<{ id: string; orderNumber: number }>("/api/working-orders", "POST", req);
  }

  /** The cross-till held list for this node → `GET /api/working-orders`. Every OPEN parked order. */
  listWorkingOrders(): Promise<HeldOrderSummary[]> {
    return this.#request<HeldOrderSummary[]>("/api/working-orders", "GET");
  }

  /**
   * Retrieve one parked order to rebuild its basket → `GET /api/working-orders/:id`. An id naming no
   * OPEN order rejects with `{ code: "working_order.not_found" }` (the server's 404).
   */
  retrieveWorkingOrder(id: string): Promise<HeldOrder> {
    return this.#request<HeldOrder>(`/api/working-orders/${id}`, "GET");
  }

  /**
   * Edit a parked order → `PUT /api/working-orders/:id`. A full REPLACEMENT: whatever `lines` +
   * `label` are sent become the order's new state (`label` absent clears it). The server re-prices
   * and answers an empty 200; only an `open` order may change (else `{ code: "working_order.not_open" }`).
   */
  async updateWorkingOrder(id: string, req: { lines: SaleLine[]; label?: string }): Promise<void> {
    await this.#request<void>(`/api/working-orders/${id}`, "PUT", req);
  }

  /**
   * Discard a parked order (`open → abandoned`) → `DELETE /api/working-orders/:id`. The server answers
   * an empty 200; a non-open or unknown id rejects with `{ code: "working_order.not_open" }`.
   */
  async abandonWorkingOrder(id: string): Promise<void> {
    await this.#request<void>(`/api/working-orders/${id}`, "DELETE");
  }

  /**
   * Place a working order (7c, design §3) → `POST /api/working-orders/:id/place`. `open → placed`:
   * freezes the order's composition and opens its amendment log; for Mode I also files a deferred
   * (unpaid) chained invoice and returns its number, issue time, total, QR and VAT breakdown. A
   * non-open id (already placed/settled/abandoned, or absent/foreign — RLS hides it) rejects with
   * `{ code: "working_order.not_open" }`.
   */
  placeOrder(id: string): Promise<PlaceOrderResult> {
    return this.#request<PlaceOrderResult>(`/api/working-orders/${id}/place`, "POST");
  }

  /**
   * Collect and finalise a PLACED order (7c) → `POST /api/working-orders/:id/collect`. Mode I settles
   * the already-issued deferred invoice with `tender`; Mode T files `recordSale` immediate from the
   * order's stored (locked) lines — never a client basket. Returns the same ticket payload
   * {@link recordSale} does. A non-placed id (still open, already settled and not idempotently
   * replayable in a new way, or absent/foreign) rejects with `{ code: "working_order.not_placed" }`.
   */
  collectOrder(id: string, tender: Tender): Promise<TillSaleResult> {
    return this.#request<TillSaleResult>(`/api/working-orders/${id}/collect`, "POST", { tender });
  }

  /**
   * The venue's ACTIVE kitchen stations (KDS-1, design §3f) → `GET /api/stations`. LIST-ONLY, by display
   * order then name — the picker's catalogue for the station-display screen (session-gated; kitchen staff
   * log in and pick a station). Station CRUD is the management API's, so this reads only.
   */
  listStations(): Promise<Station[]> {
    return this.#request<Station[]>("/api/stations", "GET");
  }

  /**
   * One station's kitchen queue (KDS-1, design §3c) → `GET /api/stations/:id/queue`. This node's ticket
   * items at that station, GROUPED BY ORDER (each group one order's lines at the station), oldest order
   * first — what the display renders as kanban/rail. A malformed/unknown station id rejects with
   * `{ code: "station.not_found" }`.
   */
  getStationQueue(stationId: string): Promise<StationQueueGroup[]> {
    return this.#request<StationQueueGroup[]>(`/api/stations/${stationId}/queue`, "GET");
  }

  /**
   * Advance ONE ticket item one kitchen step (KDS-1, design §3c) → `POST /api/ticket-items/:id/advance`
   * with `{ to }` — the per-line bump that is the source of truth. `to` is the NEXT state
   * (`queued → preparing → ready`); a skip/repeat/backwards move, or an absent/foreign item, rejects with
   * `{ code: "ticket.invalid_transition" }`. The server answers an empty 200; re-read `getStationQueue`
   * for the new state.
   */
  async advanceTicketItem(itemId: string, to: Exclude<TicketState, "queued">): Promise<void> {
    await this.#request<void>(`/api/ticket-items/${itemId}/advance`, "POST", { to });
  }

  /**
   * Advance a WHOLE ticket (KDS-1, design §3c) → `POST /api/orders/:id/stations/:sid/advance` with
   * `{ to }` — the convenience the `bump_mode = 'ticket'` venue setting drives, over the per-line truth.
   * Advances every not-yet-`to` line of order `orderId` at station `stationId` to `to`. It NO-OPs on an
   * empty match by design (bumping an already-advanced ticket is not an error), so unlike the per-line
   * verb it never rejects on a transition; the server answers an empty 200. Re-read `getStationQueue`.
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

  // --- Device mode (device-identity-1 §5a): the enrolled KDS station display. These three verbs need
  // NO operator session — the httpOnly device cookie rides `credentials: "include"` (set by
  // `enrolDevice`'s Set-Cookie) exactly like the session cookie, so `#request`'s path is unchanged. ---

  /**
   * Enrol this browser as a trusted device by redeeming a pairing code (device-identity-1 §5a/§3b) →
   * `POST /api/device/enrol` with `{ code }`. UNAUTHENTICATED (no prior session), the till's `POST
   * /api/session` counterpart: the server redeems the single-use code, mints the device token, and
   * returns it ONLY in the httpOnly device cookie (never the body) — so this resolves the four
   * NON-SECRET {@link DeviceEnrolment} fields the enrol view confirms. The `code` is sent VERBATIM: the
   * server normalises it, the client does not. A random/consumed code rejects
   * `{ code: "device.pairing_invalid" }`, one past its TTL `{ code: "device.pairing_expired" }`.
   */
  enrolDevice(code: string): Promise<DeviceEnrolment> {
    return this.#request<DeviceEnrolment>("/api/device/enrol", "POST", { code });
  }

  /**
   * The enrolled display's OWN bound station + queue (device-identity-1 §5a) → `GET /api/device/station`.
   * The device cookie names the station server-side (fixed at enrolment), so there is no id to pass. A
   * missing/rejected/revoked cookie rejects `{ code: "device.unauthorized" }` (401) — the signal the
   * station screen reads to show its enrol view instead of the queue.
   */
  getDeviceStation(): Promise<DeviceStation> {
    return this.#request<DeviceStation>("/api/device/station", "GET");
  }

  /**
   * This enrolled device's OWN identity (device-identity §3b, handheld-tableside Task 4) →
   * `GET /api/device/me`. The device cookie names the device server-side, so there is no id to pass. The
   * boot probe reads {@link DeviceIdentity.kind} to pick the till's shell (a `handheld` phone shell, a
   * `kds_station` display, or a normal operator till). A missing/rejected/revoked cookie rejects
   * `{ code: "device.unauthorized" }` (401) — the signal that this browser is not an enrolled device.
   */
  getDeviceIdentity(): Promise<DeviceIdentity> {
    return this.#request<DeviceIdentity>("/api/device/me", "GET");
  }

  /**
   * Advance ONE of the bound station's ticket items one kitchen step (device-identity-1 §5a) → `POST
   * /api/device/ticket-items/:id/advance` with `{ to }` — the device-scoped counterpart to
   * {@link advanceTicketItem}, with NO session and NO station param (the cookie's own station is the only
   * one it may touch). `to` is the next state (`preparing`/`ready`); the server answers an empty 204. An
   * item at ANOTHER station rejects `{ code: "device.forbidden_station" }` (403); an illegal transition
   * or unknown item `{ code: "ticket.invalid_transition" }`.
   */
  async deviceAdvance(itemId: string, to: Exclude<TicketState, "queued">): Promise<void> {
    await this.#request<void>(`/api/device/ticket-items/${itemId}/advance`, "POST", { to });
  }

  /**
   * FIRE a SETTLED order to the kitchen (KDS-1, design §3b) → `POST /api/working-orders/:id/prep` with no
   * `to` — the Mode-P pickup for an order that pays at order and so never places (Modes I/T fire
   * automatically when `placeOrder` runs). The server's reworked route no longer enqueues one order row;
   * it fires the order's lines through `fireLines`, inserting one `ticket_items` row per line, each routed
   * to a station (product ?? category ?? default) SNAPSHOTTED at fire time. A non-settled/absent/foreign
   * id rejects `{ code: "working_order.not_settled" }`; a re-fire of an already-sent order
   * `{ code: "ticket.already_fired" }`; a venue with no default station `{ code: "station.no_default" }`.
   */
  async sendToPrep(id: string): Promise<void> {
    await this.#request<void>(`/api/working-orders/${id}/prep`, "POST", {});
  }

  /**
   * Hand a SETTLED, fired order to the customer — Mode P's counter handover (KDS-1 §3e) →
   * `POST /api/orders/:id/collect` with an empty body. NON-FISCAL: the server stamps the order-level
   * `collected_at`, which drops the order off `getStationQueue` (the display shows an order until it is
   * collected). It touches no sale/registro/tender — the order was paid + filed at settle — so this is
   * DISTINCT from {@link collectOrder}, the placed → settled FISCAL collect on `/api/working-orders/:id/collect`.
   * A non-settled/absent/foreign id rejects `{ code: "working_order.not_settled" }`, an already-collected
   * order `{ code: "working_order.already_collected" }`, and one never fired `{ code: "ticket.not_fired" }`.
   * The server answers an empty 200; re-read `getStationQueue` for the updated display.
   */
  async markCollected(id: string): Promise<void> {
    await this.#request<void>(`/api/orders/${id}/collect`, "POST", {});
  }

  /**
   * Reprint an order's CURRENT kitchen tickets (KDS-4 §3d) → `POST /api/orders/:id/reprint` with an empty
   * body — the "a jam ate the paper, print it again" lever on the station display + expo. A SESSION verb,
   * NOT a device verb: the reprint route is `requireSession`-gated (`apps/server/src/till-api.ts`), so it
   * rides the operator session cookie like {@link markCollected}/{@link fireCourse}, never the httpOnly
   * device cookie — an enrolled KDS display (device mode) has no session and would 401, so the callers
   * hide it there (there is no device reprint route). NON-FISCAL and STATE-LESS: the server re-queries the
   * order's currently-fired `ticket_items` and re-enqueues the whole current ticket through the SAME
   * never-block outbox a fire uses — it touches no sale/registro/tender and changes no order state, so
   * there is nothing to re-read. IDEMPOTENT — an order with no fired items enqueues nothing and is a 200
   * no-op (no new error code). A malformed/unknown id rejects `{ code: "working_order.not_found" }`. The
   * server answers an empty 200 (`c.body(null, 200)`), so this resolves void. The empty `{}` body mirrors
   * the sibling order-level KDS verbs ({@link markCollected}/{@link fireCourse}); the route parses none.
   */
  async reprintOrder(orderId: string): Promise<void> {
    await this.#request<void>(`/api/orders/${orderId}/reprint`, "POST", {});
  }

  /**
   * FIRE a HELD course of an order (KDS-2 §3c/§5a) → `POST /api/orders/:id/courses/:courseId/fire` with
   * an empty body — the operator's "release this course" action. NON-FISCAL: the server stamps
   * `fired_at = now()` on every held item of this order + course, so they stop being greyed on the
   * display and become advanceable; it touches no sale/registro/tender. IDEMPOTENT — a course with
   * nothing held is a 200 no-op. A malformed/unknown course id rejects `{ code: "course.not_found" }`;
   * a malformed order id `{ code: "working_order.not_found" }`. The server answers an empty 200; re-read
   * {@link getStationQueue} for the released (now fired) items.
   */
  async fireCourse(orderId: string, courseId: string): Promise<void> {
    await this.#request<void>(`/api/orders/${orderId}/courses/${courseId}/fire`, "POST", {});
  }

  /**
   * The cross-station EXPO/PASS queue (KDS-3 §3a) → `GET /api/expo/queue`. This node's OPEN orders,
   * aggregated into courses ACROSS all stations (each item labelled with its station), oldest order
   * first — what the pass/expo display renders as a card per order. The server excludes abandoned,
   * collected and FULLY-away orders; the display re-reads after each fire/ready/away. READ-ONLY, no
   * fiscal touch, no path param (the pass is the whole node's, so there is nothing to screen).
   */
  getExpoQueue(): Promise<ExpoOrder[]> {
    return this.#request<ExpoOrder[]>("/api/expo/queue", "GET");
  }

  /**
   * Bump a WHOLE course to `ready` across every station (KDS-3 §3b) → `POST
   * /api/orders/:id/courses/:courseId/ready` with an empty body — the expediter's "this course is all
   * plated" lever on the pass. NON-FISCAL: the server advances every FIRED, not-yet-`ready` item of this
   * order + course to `ready`; it touches no sale/registro/tender. It is `advanceTicket`'s
   * no-throw-on-empty bulk shape, so a course with nothing left to bump is a 200 no-op (a malformed
   * order id is `working_order.not_found`, a malformed course id `course.not_found`). The server answers
   * an empty 200; re-read {@link getExpoQueue} for the bumped items.
   */
  async bumpCourseReady(orderId: string, courseId: string): Promise<void> {
    await this.#request<void>(`/api/orders/${orderId}/courses/${courseId}/ready`, "POST", {});
  }

  /**
   * DISPATCH a plated course to the floor (KDS-3 §3b) → `POST /api/orders/:id/courses/:courseId/away`
   * with an empty body — the expediter's "this course is away" lever, the pass counterpart to
   * {@link bumpCourseReady}. NON-FISCAL: the server stamps `away_at = now()` on every `ready` item of
   * this order + course (idempotent — already-away items are skipped), which retires the course from the
   * pass; it touches no sale/registro/tender. UNLIKE `ready`, it EXISTENCE-checks the course, so a
   * malformed/unknown course id rejects `course.not_found` (404); a malformed order id
   * `working_order.not_found`. The server answers an empty 200; re-read {@link getExpoQueue}.
   */
  async markCourseAway(orderId: string, courseId: string): Promise<void> {
    await this.#request<void>(`/api/orders/${orderId}/courses/${courseId}/away`, "POST", {});
  }

  /**
   * Cancel a PLACED order (7c, spec §4) → `POST /api/working-orders/:id/cancel`. `placed → abandoned`,
   * appending a logged `order_cancelled` amendment carrying `reason` — the accountable content, so an
   * absent/blank reason rejects `{ code: "working_order.reason_required" }` before any transition. A
   * non-placed or absent/foreign id rejects `{ code: "working_order.not_placed" }`.
   */
  async cancelOrder(id: string, reason: string): Promise<void> {
    await this.#request<void>(`/api/working-orders/${id}/cancel`, "POST", { reason });
  }

  // --- Live floor (FP-1): zones, occupancy read-model, served markers, tab open/round. All
  // SESSION-GUARDED reads/writes; `served_at` is a PRE-FISCAL operational field (design H2), so the
  // served markers below touch no fiscal path. ---

  /** The venue's ACTIVE floor-plan zones, by display order → `GET /api/zones` (FP-1). LIST-ONLY. */
  listZones(): Promise<FloorZone[]> {
    return this.#request<FloorZone[]>("/api/zones", "GET");
  }

  /**
   * The venue's ACTIVE service statuses for the table-order screen's Estado picker (FP-1) →
   * `GET /api/statuses`. LIST-ONLY and active-only (a deactivated status can't be applied); status CRUD
   * is the management API's. Operator-session-gated like the other floor reads.
   */
  listStatuses(): Promise<TableServiceStatus[]> {
    return this.#request<TableServiceStatus[]>("/api/statuses", "GET");
  }

  /**
   * The live-floor occupancy read-model → `GET /api/tables/state` (FP-1, design §4). One row per active
   * table with its derived `state`, the raw occupancy signals, the open tab's summary (when any), and the
   * table's manual service status. Gathers tabs across NODES (a table lives at the venue, not the till).
   */
  getTablesState(): Promise<TableState[]> {
    return this.#request<TableState[]>("/api/tables/state", "GET");
  }

  /**
   * Mark ONE line of an open tab as DELIVERED (`served_at = now()`) → `POST
   * /api/working-orders/:orderId/lines/:lineNo/served` (FP-1, design §3b). The live floor's "this went
   * out" tap — an operational verb, PRE-FISCAL (design H2): it never enters `registros`/`computeHuella`.
   * The server answers an empty 200; re-read `getTablesState` for the new "N still to serve" count.
   */
  async markLineServed(orderId: string, lineNo: number): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/lines/${lineNo}/served`, "POST");
  }

  /**
   * Clear ONE line's delivered marker (`served_at = NULL`) → `DELETE
   * /api/working-orders/:orderId/lines/:lineNo/served` (FP-1) — the inverse of {@link markLineServed},
   * for a mis-tap. Same PRE-FISCAL note; the server answers an empty 200.
   */
  async unmarkLineServed(orderId: string, lineNo: number): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/lines/${lineNo}/served`, "DELETE");
  }

  /**
   * Open the running tab on a table → `POST /api/tables/:tableId/tab` (FP-1, design §3a). `lines?` opens
   * the tab with an initial round; absent, the tab opens empty (the body is `{}`, so the route still has
   * JSON to parse). Returns the new tab's working-order id + order number. `table.not_found` /
   * `table.inactive` / `tab.already_open` surface as a rejected `{ code }`.
   */
  openTab(tableId: string, lines?: SaleLine[]): Promise<TabResult> {
    return this.#request<TabResult>(`/api/tables/${tableId}/tab`, "POST", { lines });
  }

  /**
   * Append a priced round to an open tab → `POST /api/working-orders/:orderId/round` (FP-1, design §3b).
   * Prices each new line at add-time and appends WITHOUT re-pricing the existing lines. `lines` carry no
   * price — the server prices them — but each MAY carry a `courseId` OVERRIDE the tab's course picker set
   * (KDS-2 §5b); absent, the server applies the product's default course. The server answers an empty 200;
   * `tab.not_open` (a non-open/absent tab) / `sale.empty_basket` (no lines) surface as a rejected `{ code }`.
   */
  async addTabRound(orderId: string, lines: RoundLine[]): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/round`, "POST", { lines });
  }

  /**
   * Read one open tab's lines for the table-order screen → `GET /api/working-orders/:orderId/lines`
   * (FP-1, design §3b). Each line carries its `lineNo`, `productId`, `quantity`, the LOCKED gross unit
   * price (`unitPriceGross` — a tab does NOT re-price, so this is the add-time lock, never a recompute)
   * and its `servedAt` marker (null ⇒ still to serve). A non-open/absent tab rejects with
   * `{ code: "tab.not_open" }`; the screen resolves product names from its own catalogue prop
   * (`TabLine` carries `productId` only, mirroring {@link retrieveWorkingOrder}).
   */
  getTabLines(orderId: string): Promise<TabLine[]> {
    return this.#request<TabLine[]>(`/api/working-orders/${orderId}/lines`, "GET");
  }

  /**
   * Move ONE not-yet-fired line of an open tab into another course, or clear its course to `null`
   * (coursing editing A1) → `PATCH /api/working-orders/:orderId/lines/:lineNo/course` with
   * `{ courseId }`. `courseId` is a first-class `string | null` — `null` CLEARS the line's course
   * override, sent as an explicit null, not an absent field. NON-FISCAL. `tab.not_open` (a malformed
   * tab id) / `course.not_found` (an absent/foreign/retired target) / `tab.line_not_found` (an
   * in-range line matching nothing) / `ticket.already_fired` (the line's ticket has already fired —
   * correct via {@link recallLines}, not a move) surface as a rejected `{ code }`. The server answers
   * an empty 200; re-read {@link getTabLines} for the new course.
   */
  async setLineCourse(orderId: string, lineNo: number, courseId: string | null): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/lines/${lineNo}/course`, "PATCH", {
      courseId,
    });
  }

  /**
   * Fire SPECIFIC held lines of an open tab (coursing editing A2) → `POST
   * /api/working-orders/:orderId/lines/send` with `{ lineNos }` — a finer release than
   * {@link fireCourse}'s whole-course fire. An empty/omitted `lineNos` releases every held line of the
   * tab (send-all). NON-FISCAL: it writes only `ticket_items` (fired_at/queued_at) + the kitchen-print
   * outbox, never a filed record. IDEMPOTENT — an unknown or already-fired line simply matches nothing.
   * `tab.not_open` (a malformed/absent/non-open tab) surfaces as a rejected `{ code }`. The server
   * answers an empty 200; re-read {@link getTabLines}/{@link getStationQueue} for the fired lines.
   */
  async sendLines(orderId: string, lineNos: number[]): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/lines/send`, "POST", { lineNos });
  }

  /**
   * UN-send not-yet-started lines of an open tab (coursing editing A4) → `POST
   * /api/working-orders/:orderId/lines/recall` with `{ lineNos }` — the inverse of {@link sendLines}.
   * NON-FISCAL: it writes `ticket_items` (clearing `fired_at`) plus, for a previously-fired line, a
   * RECALLED correction slip to the `print_jobs` outbox; never a filed record. `tab.not_open` (a
   * malformed/absent/non-open tab) / `tab.line_not_found` (an
   * absent line) / `ticket.already_started` (the kitchen has already started the line — preparing/
   * ready, so it can no longer be recalled) surface as a rejected `{ code }`; an already-held line is
   * a no-op. The server answers an empty 200; re-read {@link getTabLines} for the recalled lines.
   */
  async recallLines(orderId: string, lineNos: number[]): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/lines/recall`, "POST", { lineNos });
  }

  /**
   * Cancel (VOID) ONE line of an open tab (coursing editing C5) → `DELETE
   * /api/working-orders/:orderId/lines/:lineNo` (the server's `voidTabLine`). This is the cancel path for
   * a line the kitchen has already STARTED — one that can no longer be {@link recallLines}'d — so the till
   * gates it behind a consequence-naming confirm. NON-FISCAL: it edits the pre-fiscal working order (drops
   * the line + its kitchen ticket item), never a filed record; the server prints a correction slip.
   * `tab.not_open` (a malformed/absent/non-open tab) / `tab.line_not_found` (an absent line) surface as a
   * rejected `{ code }`. The server answers an empty 200; re-read {@link getTabLines} after.
   */
  async voidLine(orderId: string, lineNo: number): Promise<void> {
    await this.#request<void>(`/api/working-orders/${orderId}/lines/${lineNo}`, "DELETE");
  }

  /**
   * Set (or clear) a table's MANUAL service status → `POST /api/tables/:tableId/status` (FP-1, design
   * §3b). Keyed by TABLE id, not order id — the status is a property of the table, independent of any
   * open tab. `statusId` null CLEARS the badge (a first-class value the route accepts, sent as an
   * explicit null). An unknown/malformed status id rejects `{ code: "status.not_found" }`, a
   * deactivated one `{ code: "status.inactive" }`, a bad table id `{ code: "table.not_found" }`. The
   * server answers an empty 200; re-read `getTablesState` for the new badge.
   */
  async setTableStatus(tableId: string, statusId: string | null): Promise<void> {
    await this.#request<void>(`/api/tables/${tableId}/status`, "POST", { statusId });
  }

  /**
   * Relocate this tab's party to a FREE table (TS-3 move) → `POST /api/tabs/:tabId/move`. Frees the
   * tab's current table(s) and points `toTableId` at the tab. NO line move, PRE-FISCAL. The server
   * answers an empty 200; re-read `getTablesState`/`getTabLines` after. Rejects `{ code: "table.occupied" }`
   * / `"table.inactive"` / `"table.not_found"` / `"tab.not_open"`.
   */
  async moveTab(orderId: string, toTableId: string): Promise<void> {
    await this.#request<void>(`/api/tabs/${orderId}/move`, "POST", { toTableId });
  }

  /**
   * Extend this tab's coverage onto an ADDITIONAL free table (TS-3 join) → `POST /api/tabs/:tabId/join`.
   * Both the original and the new table then point at the tab. NO line move, no status turnover,
   * PRE-FISCAL. Same rejection codes as {@link moveTab}.
   */
  async joinTable(orderId: string, tableId: string): Promise<void> {
    await this.#request<void>(`/api/tabs/${orderId}/join`, "POST", { tableId });
  }

  /**
   * Combine ANOTHER open tab onto THIS bill (TS-3 merge) → `POST /api/tabs/:tabId/merge`, where `:id` is
   * the DESTINATION (into) tab and `fromTabId` is the source that gets absorbed (its lines move here, it
   * is then abandoned). `freeSourceTable` frees the vacated table (`true`) or re-points it at this tab
   * (`false`). PRE-FISCAL. Rejects `{ code: "tab.not_open" }` / `"tab.merge_self"`.
   */
  async mergeTabs(orderId: string, fromTabId: string, freeSourceTable: boolean): Promise<void> {
    await this.#request<void>(`/api/tabs/${orderId}/merge`, "POST", { fromTabId, freeSourceTable });
  }

  /**
   * Move SELECTED items OUT of this tab into another open tab (TS-4 transfer) → `POST
   * /api/tabs/:tabId/transfer`, where `:id` is the SOURCE tab and `toTabId` the destination. Each entry
   * omits `quantity` for a whole-line move or carries a `quantity` < the line's for a partial split (the
   * locked per-unit price is carried, never re-priced). PRE-FISCAL. Rejects `{ code: "tab.not_open" }` /
   * `"tab.transfer_self"` / `"tab.line_not_found"` / `"tab.transfer_quantity_invalid"` /
   * `"tab.transfer_duplicate_line"`.
   */
  async transferLines(
    orderId: string,
    toTabId: string,
    transfers: readonly TabTransfer[],
  ): Promise<void> {
    await this.#request<void>(`/api/tabs/${orderId}/transfer`, "POST", { toTabId, transfers });
  }

  /**
   * Place (or re-place) a table on the FP-2 spatial floor plan → `PUT /api/tables/:tableId/placement`
   * (Task 4's ON-TILL route, gated by the operator's OWN `till.configure` role — NOT the management-api
   * route). Writes the four placement columns + the target zone; the server re-checks the manager gate
   * (client hiding is convenience only) and re-validates the values (`placement.invalid` /
   * `zone.not_found` / `table.not_found` surface as a rejected `{ code }`). The route answers an empty
   * 204, so this resolves void. The live-floor screen re-reads `getTablesState` after a successful call.
   */
  async setTablePlacement(tableId: string, placement: TablePlacement): Promise<void> {
    await this.#request<void>(`/api/tables/${tableId}/placement`, "PUT", placement);
  }

  /**
   * Un-place a table (NULL its four placement columns, leaving `zone_id` as-is) →
   * `DELETE /api/tables/:tableId/placement` (Task 4's on-till route). Same manager gate as
   * {@link setTablePlacement}; the route answers an empty 204, so this resolves void. `table.not_found`
   * (a bad/absent id) surfaces as a rejected `{ code }`.
   */
  async clearPlacement(tableId: string): Promise<void> {
    await this.#request<void>(`/api/tables/${tableId}/placement`, "DELETE");
  }

  // --- Staff schedule (the till-session-gated request path, `apps/server/src/schedule-api.ts`). The
  // requester is ALWAYS the session's operator server-side; these methods never send a personId. ---

  /** My shifts over a half-open `[from, to)` window (`YYYY-MM-DD`) → `GET /api/schedule/shifts`. */
  listMyShifts(from: string, to: string): Promise<MyShift[]> {
    return this.#request<MyShift[]>(`/api/schedule/shifts?from=${from}&to=${to}`, "GET");
  }

  /** The swaps I'm party to (offered to me, or requested by me) → `GET /api/schedule/swaps`. */
  listMySwaps(): Promise<MySwap[]> {
    return this.#request<MySwap[]>("/api/schedule/swaps", "GET");
  }

  /**
   * Request a swap → `POST /api/schedule/swaps`. Offer one of MY shifts (`fromShiftId`) to a colleague
   * (`toPersonId`); `toShiftId` null is a one-sided give-away (the case this slice's UI files). A shift
   * that is not mine rejects `{ code: "swap.not_permitted" }`. Returns the new swap's id.
   */
  requestSwap(req: {
    fromShiftId: string;
    toPersonId: string;
    toShiftId: string | null;
  }): Promise<{ swapId: string }> {
    return this.#request<{ swapId: string }>("/api/schedule/swaps", "POST", req);
  }

  /**
   * Accept a swap offered TO me → `POST /api/schedule/swaps/:swapId/accept`. Only the named recipient
   * may accept; a swap not offered to me rejects `{ code: "swap.not_permitted" }`, one no longer
   * `requested` `{ code: "swap.not_acceptable" }`. The server answers an empty 204.
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
   * absence rejects `{ code: "absence.overlaps" }`. Returns the new absence's id.
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
   * The one request path every method funnels through. `credentials: "include"` on every call (the
   * session cookie). A `body` is JSON-encoded and its `content-type` header set only when one is
   * present, so a GET/DELETE carries neither. A non-2xx becomes a rejected `{ code }` read from the
   * server's `{ error: { code } }` envelope — falling back to `server.internal` when the body names
   * none — so callers branch on a stable domain code, never on an HTTP status or a raw message.
   *
   * `fetchImpl` is read into a local before the call so it is invoked as a free function, not as a
   * method of `this` (which would rebind a native `fetch`).
   *
   * A 2xx with an EMPTY body resolves to `undefined` rather than being JSON-parsed: the working-order
   * `PUT`/`DELETE` routes answer `204`-style empty 200s (`c.body(null, 200)`), on which `res.json()`
   * would throw a `SyntaxError`. Those callers type `T` as `void`; every JSON route sends a body, so
   * the non-empty branch parses exactly as before.
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
      const envelope = (await res.json()) as { error?: { code?: string } };
      throw { code: envelope.error?.code ?? "server.internal" };
    }
    const text = await res.text();
    return (text === "" ? undefined : JSON.parse(text)) as T;
  }
}
