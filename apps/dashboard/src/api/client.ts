/**
 * The browser-side face of the management dashboard's HTTP API — one thin `fetch` wrapper per
 * slice-1b `/management-api/*` route. It exists so the Lit views built on top of it never touch
 * `fetch`, URLs, cookies or error-envelope shapes directly: they call a typed method and get back a
 * typed payload, or a rejected `{ code }`.
 *
 * Every request sends `credentials: "include"` so the httpOnly session cookie the login route set
 * rides along; without it the session-guarded routes (`GET /management-api/staff`, the mutations)
 * 401.
 *
 * The types below are LOCAL copies of the server's JSON shapes, deliberately NOT imported from
 * `@waitron/identity` (or any `@waitron/*`). A runtime import from those packages would drag their
 * barrels — and through them `@waitron/db` and Node builtins — into the browser bundle. A handful of
 * duplicated field lists is the price of keeping the bundle free of server code, exactly as
 * `apps/till/src/api/client.ts` does. If those server shapes change, these follow — a mismatch
 * surfaces as a runtime shape error a view test catches, not a compile break.
 */

/** A person's role in the management model — the four levels the slice-1b staff API assigns. */
export type PersonRole = "staff" | "supervisor" | "manager" | "admin";

/** One `GET /management-api/staff-roster` entry — the colleague-picker list, no role or status. */
export interface RosterEntry {
  personId: string;
  displayName: string;
}

/** One `GET /management-api/staff` row — the full management view of a person. */
export interface PersonSummary {
  personId: string;
  displayName: string;
  role: PersonRole;
  status: "active" | "suspended";
  hasPassword: boolean;
  hasTotp: boolean;
  /** The person's login email, or null when none is set. */
  email: string | null;
}

/**
 * The credential-creation / -request options a passkey ceremony's "begin" route returns — WebAuthn's
 * `PublicKeyCredentialCreationOptionsJSON` / `...RequestOptionsJSON`. Typed as an opaque blob on
 * purpose: it is handed straight to `@simplewebauthn/browser`'s `startRegistration` /
 * `startAuthentication` in the view layer (slice-1d Task 7), which validates the concrete shape at the
 * call site. Keeping it loose holds this client's type surface free of `@simplewebauthn/*` and of the
 * `@waitron/*` server shapes it wraps, exactly as the header note above requires.
 */
export type PasskeyOptions = Record<string, unknown>;

/** A passkey "begin" route's answer: the opaque options + the handle its "verify" half must echo. */
export interface PasskeyChallenge {
  challengeHandle: string;
  options: PasskeyOptions;
}

/**
 * The signed ceremony a passkey "verify" route consumes: the handle from the matching "begin" call
 * plus the authenticator's response. `response` is the opaque object `@simplewebauthn/browser` returns
 * from `startRegistration` / `startAuthentication`; the server validates its shape.
 */
export interface PasskeyVerification {
  challengeHandle: string;
  response: unknown;
}

// ── Catalogue-management types ──────────────────────────────────────────────────────────────────
// LOCAL copies of the server's catalogue JSON shapes (the `catalogue-api.ts` routes wrapping
// `@waitron/catalogue`'s ops), deliberately NOT imported from `@waitron/catalogue`/`@waitron/db` — a
// runtime import would drag their barrels + Node builtins into the browser bundle (the #70 rule, as
// the staff shapes above and `apps/till/src/api/client.ts` do). These are the CONTRACT the catalogue
// widgets/screens (product list, product form, allergen picker, image upload, catalogue screen) build
// on; if the server shapes change these follow, and a mismatch surfaces as a runtime shape error a
// view test catches, not a compile break.

/** A product's pricing basis — the `products.pricing_unit` CHECK set (`schema/catalogue.ts`). */
export type PricingUnit = "each" | "weight";

/** A product's VAT band — the `products.vat_class` CHECK set; resolved to a rate server-side. */
export type VatClass = "general" | "reduced" | "super_reduced" | "zero";

/** Whether an allergen is present, or may be present via cross-contamination (EU 1169/2011 Annex II). */
export type AllergenPresence = "contains" | "may_contain";

/** One allergen entry, keyed by its EU-14 code in a {@link AllergenDeclaration}. */
export interface AllergenEntry {
  presence: AllergenPresence;
  /** Optional specific substance ("trigo", "almendras") for Annex II specificity. */
  source?: string;
}

/**
 * A product's whole allergen declaration — the THREE-STATE value the allergen picker owns and the
 * product form/list read (design §7):
 *   - `null` = not yet reviewed (PENDING; a compliance gap, never rendered as "allergen-free"),
 *   - `{}` = reviewed, none of the 14 present,
 *   - `{ code: { presence, source? } }` = reviewed, these declared.
 * Keys are EU-14 allergen codes; the server's `validateAllergens` is the `allergen.*` authority, so
 * this stays a plain string-keyed map browser-side (mirrors catalogue's `ProductAllergens | null`).
 */
export type AllergenDeclaration = Record<string, AllergenEntry> | null;

/** One `GET/POST /management-api/catalogues` row — mirrors catalogue's `Catalogue`. */
export interface CatalogueSummary {
  id: string;
  name: string;
  active: boolean;
  /** The sync-seam version, created at 1 (bumped by a future replication task). */
  version: number;
}

/** One `GET /management-api/locations/:id/catalogues` row — mirrors catalogue's `LocationCatalogue`:
 * a `CatalogueSummary` plus whether this location may sell it (`sellable`) and whether it is the
 * location's default menu (`isDefault`). */
export interface LocationCatalogueSummary extends CatalogueSummary {
  sellable: boolean;
  isDefault: boolean;
}

/** One `GET/POST /management-api/categories` row — mirrors catalogue's `Category`. */
export interface CategorySummary {
  id: string;
  name: string;
}

/**
 * One product row as `GET /management-api/catalogues/:id/products` and `POST /management-api/products`
 * return it — a faithful mirror of catalogue's `Product` (`operations.ts`). `unitPrice` is a GROSS
 * (VAT-inclusive) `numeric(12,2)` decimal STRING, never a number; `image` is a bare `<sha256>.<ext>`
 * filename served at `/media/<image>`, or null when there is no picture.
 */
export interface Product {
  id: string;
  catalogueId: string;
  categoryId: string | null;
  descriptions: Record<string, string>;
  pricingUnit: PricingUnit;
  unitPrice: string;
  vatClass: VatClass;
  active: boolean;
  allergens: AllergenDeclaration;
  /** The staff-authored allergen overlay — what a human explicitly declared, SEPARATE from the published
   * `allergens` (which is the computed union of this overlay and any recipe-derived floor). The product
   * editor seeds its allergen picker from THIS, so recipe-derived allergens are never re-saved as manual. */
  manualAllergens: AllergenDeclaration;
  image: string | null;
}

/**
 * The `POST /management-api/products` body — mirrors catalogue's `CreateProductInput`. `allergens`
 * omitted leaves the product unreviewed (null); the server refuses an explicit `null` here, so the
 * form OMITS the key for a PENDING declaration. `image` is the same: the POST route accepts a string
 * or the key's absence, never a literal `null` (that 400s as `management.request_invalid`), so it is
 * typed `string` and omitted when there is no picture — only `ProductPatch.image` is nullable (a PATCH
 * clears the photo with `null`). `active` omitted leaves the product active (the column default);
 * `false` creates it inactive in the SAME request — the create is atomic, with no follow-up patch.
 * `optionGroupIds` (Task 11/12) is the ORDERED set of reusable option groups to attach in the SAME
 * request; omitted leaves the product with no attached groups (the create route treats an absent key
 * the same as `undefined` on `setProductOptionGroups` — never called, so nothing attaches).
 */
export interface ProductInput {
  catalogueId: string;
  categoryId: string | null;
  descriptions: Record<string, string>;
  pricingUnit: PricingUnit;
  unitPrice: string;
  vatClass: VatClass;
  allergens?: Record<string, AllergenEntry>;
  image?: string;
  active?: boolean;
  optionGroupIds?: string[];
}

/**
 * The `PATCH /management-api/products/:id` body — the mutable slice, mirrors catalogue's
 * `UpdateProductInput`. Every key is optional; an absent key is left unchanged. `allergens: null`
 * clears the declaration back to unreviewed, `image: null` clears the photo, and `active` toggles the
 * product active/inactive through this one route. `optionGroupIds` (Task 11/12) is a FULL REPLACE of
 * the attached option groups, in the given order; omitted leaves the current attachment untouched, and
 * `[]` detaches every group.
 */
export interface ProductPatch {
  descriptions?: Record<string, string>;
  unitPrice?: string;
  vatClass?: VatClass;
  pricingUnit?: PricingUnit;
  categoryId?: string | null;
  allergens?: AllergenDeclaration;
  image?: string | null;
  active?: boolean;
  optionGroupIds?: string[];
}

// ── Option groups (reusable modifiers) + product attach (Task 11/12) ─────────────────────────────
// LOCAL copies of the server's option-group authoring JSON shapes (the `catalogue-api.ts` routes
// wrapping `@waitron/catalogue`'s option-group ops), deliberately NOT imported from
// `@waitron/catalogue`/`@waitron/db` — a runtime import would drag their barrels + Node builtins into
// the browser bundle (the #70 rule the shapes above follow). These are the CONTRACT the option-group
// manager + the product form's attach section build on; if the server shapes change these follow, and
// a mismatch surfaces as a runtime shape error a view test catches, not a compile break.

/** A reusable `option_groups` row for the authoring editor — mirrors catalogue's `OptionGroup`. The
 * whole row (active AND inactive), unlike the sale-time resolved shape the till reads. */
export interface OptionGroup {
  id: string;
  name: Record<string, string>;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  sort: number;
  active: boolean;
}

/** One `option_group_items` row for the authoring editor — mirrors catalogue's `OptionGroupItem`.
 * `priceDelta` is the GROSS numeric column carried as a string (like `unitPrice`); `vatClass` is null
 * when the item INHERITS the parent dish's rate. */
export interface OptionGroupItem {
  id: string;
  groupId: string;
  name: Record<string, string>;
  priceDelta: string;
  vatClass: VatClass | null;
  sort: number;
  active: boolean;
}

/** The `POST /management-api/option-groups` body — mirrors catalogue's `CreateOptionGroupInput`.
 * Every field but `name` is optional; the server defaults mirror the column defaults (min 0, max 1,
 * required false, sort 0, active true). An invalid combination (`max < min`, or `required` with
 * `minSelect < 1`) rejects `options.group_invalid`. */
export interface OptionGroupInput {
  name: Record<string, string>;
  minSelect?: number;
  maxSelect?: number;
  required?: boolean;
  sort?: number;
  active?: boolean;
}

/** The `PATCH /management-api/option-groups/:id` body — mirrors catalogue's `UpdateOptionGroupInput`.
 * Every key is optional (absent = unchanged); the select-bound invariant is checked against the MERGE
 * of this patch onto the stored row, so a partial patch that would violate it still rejects
 * `options.group_invalid`. */
export interface OptionGroupPatch {
  name?: Record<string, string>;
  minSelect?: number;
  maxSelect?: number;
  required?: boolean;
  sort?: number;
  active?: boolean;
}

/** The `POST /management-api/option-groups/:id/items` body — mirrors catalogue's
 * `CreateOptionGroupItemInput`. `vatClass` omitted (or `null`) inherits the parent dish's rate; the
 * other fields default to the column defaults (priceDelta "0", sort 0, active true). */
export interface OptionGroupItemInput {
  name: Record<string, string>;
  priceDelta?: string;
  vatClass?: VatClass | null;
  sort?: number;
  active?: boolean;
}

/** The `PATCH /management-api/option-groups/:groupId/items/:itemId` body — mirrors catalogue's
 * `UpdateOptionGroupItemInput`. Every key is optional (absent = unchanged); `vatClass: null` reverts
 * the item to inheriting the parent dish's rate. */
export interface OptionGroupItemPatch {
  name?: Record<string, string>;
  priceDelta?: string;
  vatClass?: VatClass | null;
  sort?: number;
  active?: boolean;
}

// ── Ingredient & product-recipe types ─────────────────────────────────────────────────────────────
// LOCAL copies of the server's recipe-authoring JSON shapes (the `recipe-api.ts` routes wrapping
// `@waitron/recipes`' ops), deliberately NOT imported from `@waitron/recipes`/`@waitron/catalogue`/
// `@waitron/db` — a runtime import would drag their barrels + Node builtins into the browser bundle
// (the #70 rule, as the catalogue/layout/shift shapes above do). They REUSE the local
// `AllergenDeclaration`/`AllergenEntry` types (same three-state `null` = PENDING semantics). These are
// the CONTRACT the ingredient list/form + product recipe editor build on; if the server shapes change
// these follow, and a mismatch surfaces as a runtime shape error a view test catches, not a compile break.

/** One `GET/POST /management-api/ingredients` row — mirrors recipes' `Ingredient`. A raw material /
 * prep item; `allergens` null means not yet reviewed (PENDING). */
export interface Ingredient {
  id: string;
  name: string;
  allergens: AllergenDeclaration;
  active: boolean;
}

/** The `POST /management-api/ingredients` body — mirrors recipes' `CreateIngredientInput`. `allergens`
 * omitted leaves the ingredient unreviewed (null); a supplied map is validated server-side. */
export interface IngredientInput {
  name: string;
  allergens?: Record<string, AllergenEntry>;
}

/** The `PATCH /management-api/ingredients/:id` body — mirrors recipes' `UpdateIngredientInput`. Every
 * key is optional; `allergens: null` clears the declaration back to unreviewed, `active` toggles it. */
export interface IngredientPatch {
  name?: string;
  allergens?: AllergenDeclaration;
  active?: boolean;
}

/** One line of `GET /management-api/products/:id/recipe` — the ingredient rows composing a product's
 * recipe. `recipes`' `getProductRecipe` returns full `Ingredient` rows, so a recipe line IS an
 * `Ingredient`; aliased (not re-declared) so the two shapes cannot drift. */
export type RecipeLine = Ingredient;

// ── Till layout & receipt (configurable-till) types ──────────────────────────────────────────────
// LOCAL copies of `@waitron/layouts`' JSON shapes (the `/management-api/layout` + `/management-api/receipt`
// routes wrapping the layouts service), deliberately NOT imported from `@waitron/layouts`/`@waitron/db` —
// a runtime import would drag their barrels + Node builtins into the browser bundle (the #70 rule, as the
// staff/catalogue shapes above and `apps/till/src/layout.ts` do — the till keeps its own local copy the
// same way). If the server shapes change these follow, and a mismatch surfaces as a runtime shape error a
// view test catches, not a compile break.

/** One of the six counter widgets the layout editor can place (mirrors layouts' `WidgetType`). */
export type WidgetType =
  "product-grid" | "basket" | "total" | "tender-pay" | "held-orders" | "prep-queue";

/** One placed widget: which widget, which region it sits in, and its per-widget `config` bag. */
export interface WidgetInstance {
  type: WidgetType;
  region: "main" | "aside";
  config: Record<string, unknown>;
}

/** A whole layout: the ordered widget instances the till renders, in order, into their regions. */
export type LayoutDef = WidgetInstance[];

/**
 * The authorable, NON-FISCAL receipt trim (design §7/§8) — a `headerSubtitle` under the venue name and a
 * `footerMessage` under the VERI*FACTU legend, both optional. It renders AROUND the immutable art. 7.1
 * core, never able to touch it; no field here can suppress or reorder a mandated element.
 */
export interface ReceiptConfig {
  headerSubtitle?: string;
  footerMessage?: string;
}

// ── Table service-status configuration types ──────────────────────────────────────────────────────
// A LOCAL copy of apps/server's `ServiceStatus` JSON shape (the `/management-api/service-statuses`
// routes wrapping `apps/server/src/tables.ts`'s config CRUD), deliberately NOT imported from any
// `@waitron/*` — a runtime import would drag its barrel + Node builtins into the browser bundle (the
// #70 rule, as every shape above does). This is the CONTRACT the service-status editor builds on; if
// the server shape changes this follows, and a mismatch surfaces as a runtime shape error a view test
// catches, not a compile break.

/** A configured service status (mirrors apps/server's ServiceStatus; browser-local copy). */
export interface ServiceStatus {
  id: string;
  label: string;
  color: string;
  displayOrder: number;
  active: boolean;
  createdAt: string;
}

// ── Floor-plan types (FP-1) ─────────────────────────────────────────────────────────────────────
// LOCAL copies of the server's floor-zone/dining-table JSON shapes (`apps/server/src/tables.ts`'s
// `FloorZone`/`DiningTable`, wrapped by the `/management-api/zones` + `/management-api/tables`
// routes), deliberately NOT imported from `apps/server` (the #70 rule the staff/catalogue/layout
// shapes above follow). These are the CONTRACT the floor-plan config screen builds on; the server shapes
// stay the source of truth, and a mismatch surfaces as a runtime shape error a view test catches.

/** One `floor_zones` row as the config surface returns it (`GET /management-api/zones`, active only,
 * by `displayOrder`) — mirrors the server's `FloorZone`. */
export interface FloorZone {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
}

/**
 * The rendered shape of a placed table on the FP-2 floor plan. A LOCAL union mirroring `@waitron/db`'s
 * `floorTableShape = pgEnum("floor_table_shape", ["round", "square", "rect"])` and `@waitron/ui`'s
 * `TableShape` — deliberately NOT imported (the bundle-decoupling rule the whole file follows; a server
 * round-trip re-validates against the real enum).
 */
export type TableShape = "round" | "square" | "rect";

/**
 * The body of a `PUT /management-api/tables/:id/placement` (FP-2, Task 3) — the four placement columns
 * plus the table's target zone. Mirrors the management placement route's parsed body
 * (`apps/server/src/management-api.ts`); the server re-validates every field (`placement.invalid` for an
 * out-of-range coord / bad shape / bad rotation, `zone.not_found` for a missing or inactive zone).
 * `zoneId` is `| null` because the shared canvas can emit a placement for a still-zoneless table — the
 * server refuses it, so a `null` never silently persists.
 */
export interface TablePlacement {
  posX: number;
  posY: number;
  shape: TableShape;
  rotation: number;
  zoneId: string | null;
}

/** One `dining_tables` row as the config surface returns it (`GET /management-api/tables`, active
 * only, by `label`) — mirrors the server's `DiningTable`. `zoneId` is the `floor_zones` FK or null;
 * `createdAt` is an ISO instant. */
export interface DashboardTable {
  id: string;
  label: string;
  zoneId: string | null;
  capacity: number | null;
  active: boolean;
  createdAt: string;
  /**
   * FP-2 spatial placement on the floor-plan canvas — canvas coordinates (0..1000 permille), the
   * rendered `shape`, and `rotation` in degrees; `null`/absent for an unplaced table. These mirror the
   * server's `dining_tables` placement columns (`apps/server/src/tables.ts`'s `DiningTable`), written by
   * {@link DashboardApi.setTablePlacement} / {@link DashboardApi.clearPlacement}. The config route
   * `GET /management-api/tables` (`listTables`) now PROJECTS them (Task 7b), alongside the till's
   * `listTablesWithState` (`GET /api/tables/state`), so a loaded row carries its placement and the Plano
   * editor keeps a placed table placed on reload. Kept OPTIONAL (`?`) so the type also admits an unplaced
   * row that omits the fields; the editor reads `posX != null` to decide placed vs unplaced, mirroring
   * the till's live-floor screen.
   */
  posX?: number | null;
  posY?: number | null;
  shape?: TableShape | null;
  rotation?: number | null;
}

// ── Kitchen-station + routing types (KDS-1) ─────────────────────────────────────────────────────
// LOCAL copies of the server's kitchen-station JSON shapes (`apps/server/src/kitchen.ts`'s `Station`
// and `BumpMode`, wrapped by the `/management-api/stations`, `/management-api/categories/:id/station`,
// `/management-api/products/:id/station` and `/management-api/bump-mode` routes), deliberately NOT
// imported from `apps/server`/`@waitron/db` (the #70 rule the staff/catalogue/floor shapes above
// follow). These are the CONTRACT the Cocina config screen + catalogue routing selects build on; the
// server shapes stay the source of truth, and a mismatch surfaces as a runtime shape error a view test
// catches, not a compile break.

/** One `kitchen_stations` row as the config surface returns it (`GET /management-api/stations`, active
 * only, by `displayOrder` then `name`) — mirrors the server's `Station`. `isDefault` marks the venue's
 * single counter/pass fallback (only {@link DashboardApi.setDefaultStation}/`createStation` flip it). */
export interface Station {
  id: string;
  name: string;
  displayOrder: number;
  isDefault: boolean;
  active: boolean;
}

/** The venue's whole-ticket bump mode (`locations.bump_mode`) — `line` = per-line bump only; `ticket`
 * = the station display ALSO offers a whole-ticket "bump all". Mirrors the server's `BumpMode`. */
export type BumpMode = "line" | "ticket";

/** One `kitchen_courses` row as the config surface returns it (`GET /management-api/courses`, active
 * only, by `displayOrder` then `name`) — mirrors the server's `Course` (KDS-2). No `isDefault`: courses
 * have no default (a null course simply fires earliest). The Cursos config editor + the product-course
 * select build on this; NOT imported from `apps/server` (the #70 bundle rule the shapes above follow). */
export interface Course {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
}

/**
 * One `GET /management-api/devices` row as the device-management surface returns it — a faithful mirror
 * of the server projection (`apps/server/src/device-api.ts`, `devices` columns). An enrolled always-on
 * device (device-identity-1): `kind` is the `device_kind` enum (only `kds_station` today), `stationId`
 * the bound kitchen station (null for a future non-station kind), `active` false once revoked,
 * `lastSeenAt` the last time the device authenticated (null before its first call), `enrolledAt` when it
 * redeemed its pairing code. The two timestamps are ISO-8601 strings (never `Date`s over the wire). The
 * server orders NEWEST-enrolled first; the screen renders that order as-is. NOT imported from `apps/server`
 * (the #70 bundle rule the shapes above follow); a mismatch surfaces as a runtime shape error a view test
 * catches, not a compile break.
 */
export interface DeviceRow {
  id: string;
  kind: string;
  stationId: string | null;
  label: string;
  active: boolean;
  lastSeenAt: string | null;
  enrolledAt: string;
}

/** The venue's KDS fire-control mode (`locations.fire_control`) — `waiter` = the tab surfaces the
 * per-course fire; `kitchen` = the station display surfaces it; `expo` (KDS-3) = the expo/pass display
 * surfaces it. Mirrors the server's `FireControl`. */
export type FireControl = "waiter" | "kitchen" | "expo";

// ── Shift-planning types ──────────────────────────────────────────────────────────────────────────
// LOCAL copies of the server's roster/shift JSON shapes (the `workforce-api.ts` routes wrapping
// `@waitron/workforce`'s verbs), deliberately NOT imported from `@waitron/workforce`/`@waitron/db` — a
// runtime import would drag their barrels + Node builtins into the browser bundle (the #70 rule, as
// the staff/catalogue/layout shapes above do). These are the CONTRACT the roster screen + shift dialog
// build on; if the server shapes change these follow, and a mismatch surfaces as a runtime shape error
// a view test catches, not a compile break.

/** One `roster_versions` row — mirrors workforce's `RosterVersionRow`. Dates are 'YYYY-MM-DD' strings
 * (inclusive `periodStart`/`periodEnd`); `publishedAt` is a UTC ISO instant or null. */
export interface RosterVersion {
  id: string;
  locationId: string;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "published" | "superseded";
  publishedAt: string | null;
  publishedByPersonId: string | null;
}

/** One `shifts` row — mirrors workforce's `ShiftRow`. Instants are UTC ISO strings. */
export interface Shift {
  id: string;
  personId: string;
  locationId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  role: string | null;
  rosterVersionId: string | null;
}

/** The week's roster snapshot — mirrors workforce's `RosterSnapshot`. */
export interface RosterSnapshot {
  version: RosterVersion | null;
  shifts: Shift[];
}

/** The `POST …/roster/:versionId/shifts` body — mirrors workforce's `AddShiftInput` minus the
 * tenant/version the route supplies. The SCREEN fills `locationId` from the selected roster. */
export interface ShiftInput {
  personId: string;
  locationId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  role: string | null;
}

/** The `PATCH …/roster/shifts/:shiftId` body — mirrors workforce's `UpdateShiftInput` (partial). */
export interface ShiftPatch {
  personId?: string;
  startsAt?: string;
  startsOffsetMinutes?: number;
  endsAt?: string;
  endsOffsetMinutes?: number;
  role?: string | null;
}

/** The 7 advisory breach kinds `validateRoster` reports (mirrors workforce's `RosterBreachKind`). */
export type RosterBreachKind =
  | "rest_too_short"
  | "exceeds_daily_max"
  | "exceeds_weekly_max"
  | "overtime_cap_exceeded"
  | "weekly_rest_insufficient"
  | "break_owed"
  | "night_work";

/** One advisory breach from `POST …/publish` — the kind + person plus per-kind detail fields. */
export interface RosterBreach {
  kind: RosterBreachKind;
  personId: string;
  [detail: string]: unknown;
}

/** One `GET /management-api/locations` row — the location picker's option. */
export interface LocationSummary {
  id: string;
  name: string;
}

/** One `GET /management-api/swaps` row — mirrors workforce's `PendingSwapRow` (always `accepted`). */
export interface PendingSwap {
  id: string;
  requestedByPersonId: string;
  fromShiftId: string;
  toPersonId: string;
  toShiftId: string | null;
  status: string;
  createdAt: string;
}

/** One `GET /management-api/absences` row — mirrors workforce's `PendingAbsenceRow` (always `requested`). */
export interface PendingAbsence {
  id: string;
  personId: string;
  kind: string;
  startsOn: string;
  endsOn: string;
  status: string;
  note: string | null;
  createdAt: string;
}

/** One `GET /management-api/planned-vs-actual` row — mirrors workforce's `PlannedVsActual`. Minutes
 * are integers; `workDate` is the worker's LOCAL day (YYYY-MM-DD). */
export interface PlannedVsActualRow {
  personId: string;
  workDate: string;
  plannedMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  noShow: boolean;
  unplanned: boolean;
}

// ── Staff self-service (my schedule) types ──────────────────────────────────────────────────────
// LOCAL copies of the server's STAFF-FACING schedule JSON shapes (the `me-api.ts` routes wrapping
// `@waitron/workforce`'s #90 read-models/verbs), deliberately NOT imported from
// `@waitron/workforce`/`@waitron/db` — a runtime import would drag their barrels + Node builtins into
// the browser bundle (the #70 rule, as every shape above does, and exactly as `apps/till/src/api/client.ts`
// keeps its own `MyShift`/`MySwap`/`MyAbsence` copies). These are DISTINCT from the manager-view
// `Shift`/`PendingSwap`/`PendingAbsence` above: a staff person sees their OWN rows (a swap tagged with the
// `direction` they are on, an absence of ANY status), never the manager queues. If the server shapes
// change these follow, and a mismatch surfaces as a runtime shape error a view test catches, not a
// compile break.

/** The four absence kinds the request form offers — mirrors the server's `absence_kind` enum; the
 * server re-validates against the real enum. */
export type AbsenceKind = "holiday" | "sick_leave" | "leave" | "unpaid";

/** One of my upcoming shifts (`GET /management-api/me/schedule/shifts`; mirrors the server's
 * `PersonShiftRow`). Instants are UTC ISO strings; person is implied (me), so it is not repeated. */
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
 * One swap I'm party to (`GET /management-api/me/schedule/swaps`; mirrors the server's `PersonSwapRow`).
 * `direction` says which side I'm on — `offered_to_me` (I can Accept it while `status === "requested"`)
 * or `requested_by_me` — and `status` its lifecycle stage.
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

/** One of my absences, any status (`GET /management-api/me/schedule/absences`; mirrors the server's
 * `PersonAbsenceRow`). */
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

// ── Purchase-invoice types ──────────────────────────────────────────────────────────────────────
// LOCAL copies of the server's purchase-invoice JSON shapes (the `purchasing-api.ts` routes wrapping
// `@waitron/purchasing`'s ops), deliberately NOT imported from `@waitron/purchasing`/`@waitron/db` — a
// runtime import would drag their barrels + Node builtins into the browser bundle (the #70 rule, as
// the staff/catalogue/layout/shift shapes above do). These are the CONTRACT the purchase screen +
// form build on; every `Decimal` is a `numeric` decimal STRING browser-side (never a number), and the
// two enums are re-declared as local unions. If the server shapes change these follow, and a mismatch
// surfaces as a runtime shape error a view test catches, not a compile break.

/** The VAT regime a received invoice is treated under — the `purchase_regime` enum. `general` is
 * deductible (on the 303); `equivalence_surcharge` (recargo de equivalencia) is non-deductible. */
export type PurchaseRegime = "general" | "equivalence_surcharge";

/** What a VAT line was spent on — the `purchase_vat_kind` enum. `ordinary` = operaciones corrientes;
 * `capital` = bienes de inversión. */
export type PurchaseVatKind = "ordinary" | "capital";

/** One per-rate VAT line of a received invoice — mirrors purchasing's `PurchaseInvoiceLine`. `tax` is
 * the cuota (IVA soportado); `rate`/`base`/`tax` are `numeric` decimal STRINGS. */
export interface PurchaseInvoiceLine {
  rate: string;
  base: string;
  tax: string;
  kind: PurchaseVatKind;
}

/**
 * One received supplier invoice as `GET/POST /management-api/purchase-invoices` return it — a faithful
 * mirror of purchasing's `PurchaseInvoice`. `total`/`deductibleProportion` are decimal STRINGS;
 * `issuedOn`/`receivedOn` are `YYYY-MM-DD` civil dates.
 */
export interface PurchaseInvoice {
  id: string;
  supplierTaxId: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  issuedOn: string;
  receivedOn: string;
  total: string;
  regime: PurchaseRegime;
  deductibleProportion: string;
  note: string | null;
  lines: PurchaseInvoiceLine[];
}

/** A VAT line supplied on create/update — mirrors purchasing's `PurchaseInvoiceLineInput`; `kind`
 * omitted defaults to `ordinary` server-side. */
export interface PurchaseInvoiceLineInput {
  rate: string;
  base: string;
  tax: string;
  kind?: PurchaseVatKind;
}

/** The header fields supplied on create — mirrors purchasing's `PurchaseInvoiceHeaderInput`;
 * `regime`/`deductibleProportion` omitted fall to their server defaults. */
export interface PurchaseInvoiceHeaderInput {
  supplierTaxId: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  issuedOn: string;
  receivedOn: string;
  total: string;
  regime?: PurchaseRegime;
  deductibleProportion?: string;
  note?: string | null;
}

/** The `POST /management-api/purchase-invoices` body — the nested header + the VAT desglose. */
export interface PurchaseInvoiceInput {
  header: PurchaseInvoiceHeaderInput;
  lines: PurchaseInvoiceLineInput[];
}

/**
 * The `PATCH /management-api/purchase-invoices/:id` body — mirrors purchasing's
 * `UpdatePurchaseInvoiceInput`. `header` is a partial (only named fields change); `lines`, when
 * present, is a FULL replacement of the desglose (omitted leaves it unchanged).
 */
export interface PurchaseInvoicePatch {
  header?: Partial<PurchaseInvoiceHeaderInput>;
  lines?: PurchaseInvoiceLineInput[];
}

// ── Bookings (staff-entered table reservations, Bookings-1) ───────────────────────────────────────
// LOCAL copies of the server's booking JSON shapes (the `booking-api.ts` routes wrapping `bookings.ts`'s
// verbs), deliberately NOT imported from `apps/server`/`@waitron/db` (the #70 rule every shape above
// follows). These are the CONTRACT the Bookings screen builds on; the server shapes stay the source of
// truth, and a mismatch surfaces as a runtime shape error a view test catches, not a compile break.

/** A reservation's lifecycle state — the `booking_status` pgEnum. */
export type BookingStatus = "booked" | "seated" | "completed" | "no_show" | "cancelled";

/**
 * One reservation as `GET /management-api/bookings` returns it — a faithful mirror of the server's
 * `Booking` row. `bookingDate` is a `YYYY-MM-DD` civil date and `bookingTime` an `HH:MM:SS` wall-clock
 * time (BOTH plain local values, NOT a UTC instant — the #52 lesson, design §2b); the screen shows the
 * time as `HH:MM`. `tableId`/`tabId` are the optional TS-1 links (`tabId` set on seat); `createdAt` is
 * an ISO instant.
 */
export interface Booking {
  id: string;
  bookingDate: string;
  bookingTime: string;
  partySize: number;
  contactName: string;
  contactPhone: string | null;
  notes: string | null;
  tableId: string | null;
  tabId: string | null;
  status: BookingStatus;
  createdBy: string;
  createdAt: string;
}

/**
 * The `POST /management-api/bookings` body — the new reservation's fields. `bookingDate`/`bookingTime`
 * are the plain local `YYYY-MM-DD` + `HH:MM` the form composes (NEVER a `${day}T${time}Z` instant —
 * design §2b, the anti-#52 rule). `createdBy` is set SERVER-SIDE from the session and is deliberately
 * absent here. `contactPhone`/`notes`/`tableId` are optional and may be `null`.
 */
export interface BookingInput {
  bookingDate: string;
  bookingTime: string;
  partySize: number;
  contactName: string;
  contactPhone?: string | null;
  notes?: string | null;
  tableId?: string | null;
}

/** The `PATCH /management-api/bookings/:id` body — the editable business fields of a `booked`
 * reservation. A field left absent is untouched; `contactPhone`/`notes`/`tableId` accept `null` to
 * clear them. Status moves only through the lifecycle verbs, so it is not here. */
export interface BookingPatch {
  bookingDate?: string;
  bookingTime?: string;
  partySize?: number;
  contactName?: string;
  contactPhone?: string | null;
  notes?: string | null;
  tableId?: string | null;
}

// ── Printing types (print agents + printers + jobs) ───────────────────────────────────────────────
// LOCAL copies of the server's printing JSON shapes (the `print-api.ts` routes wrapping
// `@waitron/printing`'s ops), deliberately NOT imported from `@waitron/printing`/`@waitron/db` — a
// runtime import would drag their barrels + Node builtins into the browser bundle (the #70 rule, as
// every shape above does). These are the CONTRACT the Impresoras screen builds on; if the server
// shapes change these follow, and a mismatch surfaces as a runtime shape error a view test catches.

/** How a printer is reached — the `print_transport` pgEnum (schema/printers.ts). */
export type PrintTransport = "usb" | "network_tcp" | "cloud_poll";

/** A printer's kitchen-ticket grouping — the `print_ticket_scope` pgEnum (Slice B). */
export type PrintTicketScope = "station" | "order";

/** One outbox job's lifecycle state — the `print_job_status` pgEnum (schema/print-jobs.ts). */
export type PrintJobStatus = "queued" | "printing" | "done" | "failed";

/** One `GET /management-api/print-agents` row — the management view of an enrolled print agent, newest
 * first (server-ordered). The `token_hash` is never projected. `lastSeenAt` is null before the agent's
 * first authenticated call; the two timestamps are ISO-8601 strings. Mirrors print-api.ts's projection. */
export interface PrintAgentRow {
  id: string;
  name: string;
  active: boolean;
  lastSeenAt: string | null;
  enrolledAt: string;
}

/** One `GET /management-api/printers` row — mirrors `@waitron/printing`'s `PrinterRow`. The connection
 * fields are transport-specific and null when unused; both active and deactivated printers are listed. */
export interface Printer {
  id: string;
  name: string;
  transport: PrintTransport;
  agentId: string | null;
  host: string | null;
  port: number | null;
  usbPath: string | null;
  pollId: string | null;
  ticketScope: PrintTicketScope;
  active: boolean;
}

/** The `POST /management-api/printers` body — mirrors `@waitron/printing`'s `CreatePrinterInput`. Which
 * connection fields a transport REQUIRES is enforced server-side (`printer.invalid_config`); the screen
 * sends only the fields it has and lets the server be the authority. */
export interface PrinterInput {
  name: string;
  transport: PrintTransport;
  agentId?: string;
  host?: string;
  port?: number;
  usbPath?: string;
  pollId?: string;
}

/** The `PATCH /management-api/printers/:id` body — mirrors `@waitron/printing`'s `UpdatePrinterInput`.
 * Every key is optional (a PATCH touches only what it names); the connection fields + `agentId` accept
 * an explicit `null` to CLEAR them, which `undefined` (absent) does not. */
export interface PrinterPatch {
  name?: string;
  transport?: PrintTransport;
  agentId?: string | null;
  host?: string | null;
  port?: number | null;
  usbPath?: string | null;
  pollId?: string | null;
  ticketScope?: PrintTicketScope;
  active?: boolean;
}

/** One `GET /management-api/print-jobs` row — the dashboard's status read (recent activity, newest
 * first, no payload). Mirrors print-api.ts's projection; `deliveredAt` is set only once `done`. */
export interface PrintJobRow {
  id: string;
  printerId: string;
  status: PrintJobStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

/** One station↔printer mapping pair as `GET /management-api/printers/:pid/stations` (and the mirrored
 * per-station read) return it — mirrors apps/server's `StationPrinter` (`station-printers.ts`). The
 * tenant is implicit in the session scope. NOT imported from `apps/server` (the #70 bundle rule the
 * printing shapes above follow); a mismatch surfaces as a runtime shape error a view test catches. */
export interface StationPrinter {
  stationId: string;
  printerId: string;
}

// ── Receipt-printer + print-mode configuration (counter receipt/drawer §5) ────────────────────────
// LOCAL copies of the server's till/receipt-mode/drawer-policy shapes (the print-api.ts routes:
// `GET /management-api/tills`, `PATCH …/tills/:id/receipt-printer`, `PATCH …/locations/:id/receipt-print-mode`,
// `PATCH …/locations/:id/drawer-open-policy`, all printer.manage-gated), deliberately NOT imported from
// `apps/server`/`@waitron/db` (the #70 bundle rule the printing shapes above follow). These are the CONTRACT
// the Impresoras screen's receipt-printer picker + print-mode toggle + drawer-policy toggle build on; a
// mismatch surfaces as a runtime shape error a view test catches.

/** The venue's per-location receipt print mode — the `receipt_print_mode` pgEnum
 * (`auto` = auto-print on sale; `on_request` = only reprint; `never`). Mirrors the server enum; the
 * server re-validates against the real enum on the PATCH. */
export type ReceiptPrintMode = "auto" | "on_request" | "never";

/** The venue's per-location cash-drawer-open policy — the `drawer_open_policy` pgEnum
 * (`gated` = a supervisor must authorize an out-of-sale drawer open — `cash.drawer` is held by
 * supervisor/manager/admin — the SECURE default; `open` = any operator may). Mirrors the server enum;
 * the server re-validates against the real enum on the PATCH. */
export type DrawerOpenPolicy = "gated" | "open";

/** One `GET /management-api/tills` row — the till-picker's source. `label` is the till's display name
 * (`tills.name`), `locationId` its location (so the receipt-printer picker can offer that location's
 * printers), and `receiptPrinterId` the currently-set printer or null (none). Mirrors the print-api.ts
 * projection; NOT imported from `apps/server` (the #70 bundle rule). */
export interface Till {
  id: string;
  label: string;
  locationId: string;
  receiptPrinterId: string | null;
}

// ── Reporting (sales & takings) types ────────────────────────────────────────────────────────────
// LOCAL copies of the reporting routes' JSON shapes (`apps/server/src/report-api.ts`, wrapping
// `@waitron/reporting`), deliberately NOT imported from `@waitron/reporting`/`@waitron/db` — a runtime
// import would drag their barrels + Node builtins into the browser bundle (the #70 rule, as every shape
// above does). Money fields cross the wire as decimal STRINGS: the server's branded `Decimal`
// JSON-stringifies as-is, so every amount is typed `string` here (never `number`). If the server shapes
// change these follow, and a mismatch surfaces as a runtime shape error a view test catches, not a
// compile break.

/** One top-sellers row (mirrors `@waitron/reporting`'s `TopSeller`) — the frozen per-line
 * `descriptions` snapshot (locale → label) plus its summed quantity and total, both decimal strings. */
export interface TopSellerRow {
  descriptions: Record<string, string>;
  quantity: string;
  total: string;
}

/** One VAT rate row (mirrors `VatRateLine`) — the rate literal (e.g. "21.00") with its net base + tax. */
export interface VatRateRow {
  rate: string;
  base: string;
  tax: string;
}

/** The VAT summary (mirrors `VatSummary`) — per-rate breakdown plus the base/tax/gross totals. */
export interface VatSummaryDto {
  byRate: VatRateRow[];
  baseTotal: string;
  taxTotal: string;
  grossTotal: string;
}

/** One tender-method row within a till's cash-up (mirrors `TenderMethodLine`) — total collected via
 * this method (tip-inclusive) and the tip portion of it. */
export interface TenderMethodRow {
  method: string;
  amount: string;
  tip: string;
}

/** One till's cash-up (mirrors `TillCashUp`) — its per-method breakdown and its cash takings. */
export interface TillCashUpRow {
  tillId: string;
  byMethod: TenderMethodRow[];
  cashTakings: string;
}

/** The cash-up (mirrors `CashUp`) — per-till breakdown plus the tender + tip totals. */
export interface CashUpDto {
  byTill: TillCashUpRow[];
  tenderTotal: string;
  tipTotal: string;
}

/** The record counts for a business day (mirrors `CloseCounts`). */
export interface SalesCounts {
  sales: number;
  corrections: number;
  voids: number;
}

/** `GET /management-api/reports/overview` — this node's takings/counts/open-tables/top-sellers for
 * TODAY (the venue clock decides "today"). Takings amounts are decimal strings. */
export interface SalesOverview {
  businessDay: string;
  takings: { tenderTotal: string; tipTotal: string; grossTotal: string };
  counts: SalesCounts;
  openTables: { open: number; total: number };
  topSellers: TopSellerRow[];
}

/** `GET /management-api/reports/daily-close?businessDay=` — the full daily close for ONE explicit
 * business day: VAT summary, cash-up, record counts and top sellers. */
export interface DailyCloseDto {
  businessDay: string;
  vat: VatSummaryDto;
  cash: CashUpDto;
  counts: SalesCounts;
  topSellers: TopSellerRow[];
}

/** `GET /management-api/reports/period?from=&to=` — a VAT summary + top sellers over an inclusive
 * business-day range. */
export interface SalesPeriodDto {
  from: string;
  to: string;
  vat: VatSummaryDto;
  topSellers: TopSellerRow[];
}

/** The subset of `fetch` this client uses; the global satisfies it, and a test injects a stub. */
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class DashboardApi {
  readonly #baseUrl: string;
  readonly #fetchImpl: FetchLike;
  #localesPromise?: Promise<{
    locales: Array<{ code: string; label: string }>;
    venueDefault: string;
  }>;

  /**
   * @param baseUrl prefixed to every path (default `""`: same-origin, so the browser fetches
   *   `/management-api/...` from the origin serving the app).
   * @param fetchImpl the `fetch` to use (default the global; a test injects a stub).
   */
  constructor(baseUrl = "", fetchImpl: FetchLike = fetch) {
    this.#baseUrl = baseUrl;
    this.#fetchImpl = fetchImpl;
  }

  /** `GET /management-api/staff-roster` — the staff self-service colleague picker in
   * `my-schedule-screen.ts` (id + display name only). UNAUTHENTICATED but no longer part of login:
   * the login screen POSTs `{ email }` and no longer reads this. */
  getStaffRoster(): Promise<RosterEntry[]> {
    return this.#request<RosterEntry[]>("/management-api/staff-roster", "GET");
  }

  /**
   * `GET /management-api/locales` — the venue's offered languages (per-user-language-preference,
   * Task 4). PUBLIC and read pre-login by the login screen's language chooser: each `{ code, label }` is a
   * `SUPPORTED_LOCALES` entry, and `venueDefault` the tenant's fallback locale. The language chooser
   * reads the list; the app decides what to do with a pick, so the client only surfaces the shape.
   */
  getLocales(): Promise<{ locales: Array<{ code: string; label: string }>; venueDefault: string }> {
    // The list + venue default are immutable for this client's lifetime; fetch once and share.
    // Cache the promise ONLY on success — clear it on rejection so a transient failure retries.
    this.#localesPromise ??= this.#request<{
      locales: Array<{ code: string; label: string }>;
      venueDefault: string;
    }>("/management-api/locales", "GET").catch((err) => {
      this.#localesPromise = undefined;
      throw err;
    });
    return this.#localesPromise;
  }

  /**
   * `POST /management-api/session` — log in with an email + password (and an optional TOTP second
   * factor). Returns who is now logged in; a bad credential rejects with the server's `{ code }`.
   */
  login(input: { email: string; password: string; totp?: string }): Promise<{ personId: string }> {
    return this.#request<{ personId: string }>("/management-api/session", "POST", input);
  }

  /** `DELETE /management-api/session` — end the session. Answers an empty 204. */
  logout(): Promise<void> {
    return this.#request<void>("/management-api/session", "DELETE");
  }

  /** `GET /management-api/staff` — the full staff list (role, status, credential flags). */
  listStaff(): Promise<PersonSummary[]> {
    return this.#request<PersonSummary[]>("/management-api/staff", "GET");
  }

  /** `POST /management-api/staff` — create a person with a starting role and PIN (and an optional
   * login email); returns its id. */
  createPerson(input: {
    displayName: string;
    role: PersonRole;
    pin: string;
    email?: string;
  }): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/staff", "POST", input);
  }

  /**
   * `PATCH /management-api/staff/:id` — change a person's role, active status and/or login email.
   * Answers an empty 204.
   */
  updatePerson(
    id: string,
    patch: { role?: PersonRole; status?: "active" | "suspended"; email?: string },
  ): Promise<void> {
    return this.#request<void>(`/management-api/staff/${id}`, "PATCH", patch);
  }

  /** `POST /management-api/staff/:id/reset-pin` — set a person's new PIN. Answers an empty 204. */
  resetPin(id: string, pin: string): Promise<void> {
    return this.#request<void>(`/management-api/staff/${id}/reset-pin`, "POST", { pin });
  }

  /**
   * `POST /management-api/staff/:id/password` — set a person's dashboard password. Answers an empty
   * 204.
   */
  setPassword(id: string, password: string): Promise<void> {
    return this.#request<void>(`/management-api/staff/${id}/password`, "POST", { password });
  }

  /**
   * `POST /management-api/passkey/register/options` — begin enrolling a passkey for the signed-in
   * operator (gated: the route resolves the person from the session). Takes no body; returns the
   * creation options for `startRegistration` plus the challenge handle its verify half echoes.
   */
  passkeyRegisterOptions(): Promise<PasskeyChallenge> {
    return this.#request<PasskeyChallenge>("/management-api/passkey/register/options", "POST");
  }

  /**
   * `POST /management-api/passkey/register/verify` — finish enrolling a passkey: the signed response
   * from `startRegistration` plus the handle from `passkeyRegisterOptions`. Answers `{ credentialId }`.
   */
  passkeyRegisterVerify(body: PasskeyVerification): Promise<{ credentialId: string }> {
    return this.#request<{ credentialId: string }>(
      "/management-api/passkey/register/verify",
      "POST",
      body,
    );
  }

  /**
   * `POST /management-api/passkey/auth/options` — begin a passkey login (UNGATED — this IS the login,
   * the parallel of `login`). Takes no body; returns the request options for `startAuthentication`
   * plus the challenge handle its verify half echoes.
   */
  passkeyAuthOptions(): Promise<PasskeyChallenge> {
    return this.#request<PasskeyChallenge>("/management-api/passkey/auth/options", "POST");
  }

  /**
   * `POST /management-api/passkey/auth/verify` — finish a passkey login (UNGATED): the signed assertion
   * from `startAuthentication` plus the handle from `passkeyAuthOptions`. The server sets the session
   * cookie and returns who is now logged in, exactly as `login` does.
   */
  passkeyAuthVerify(body: PasskeyVerification): Promise<{ personId: string }> {
    return this.#request<{ personId: string }>("/management-api/passkey/auth/verify", "POST", body);
  }

  // ── Catalogue management ──────────────────────────────────────────────────────────────────────

  /** `GET /management-api/catalogues` — every catalogue (id, name, active, version). */
  listCatalogues(): Promise<CatalogueSummary[]> {
    return this.#request<CatalogueSummary[]>("/management-api/catalogues", "GET");
  }

  /** `POST /management-api/catalogues` — create a catalogue by name; returns the created row (201). */
  createCatalogue(name: string): Promise<CatalogueSummary> {
    return this.#request<CatalogueSummary>("/management-api/catalogues", "POST", { name });
  }

  // ── Location menus (which catalogues a location sells) ─────────────────────────────────────────

  /** `GET /management-api/locations/:id/catalogues` — every tenant catalogue flagged
   * `sellable`/`isDefault` for this location. */
  listLocationCatalogues(locationId: string): Promise<LocationCatalogueSummary[]> {
    return this.#request<LocationCatalogueSummary[]>(
      `/management-api/locations/${locationId}/catalogues`,
      "GET",
    );
  }

  /** `POST /management-api/locations/:id/catalogues` — add a catalogue to the location's accessible
   * set (make it sellable there). Answers an empty 204. */
  addLocationCatalogue(locationId: string, catalogueId: string): Promise<void> {
    return this.#request<void>(`/management-api/locations/${locationId}/catalogues`, "POST", {
      catalogueId,
    });
  }

  /** `DELETE /management-api/locations/:id/catalogues/:catalogueId` — remove a catalogue from the
   * location's accessible set (stop selling it there). Never removes the default. Answers 204. */
  removeLocationCatalogue(locationId: string, catalogueId: string): Promise<void> {
    return this.#request<void>(
      `/management-api/locations/${locationId}/catalogues/${catalogueId}`,
      "DELETE",
    );
  }

  /** `PUT /management-api/locations/:id/default-catalogue` — set the location's default menu; the old
   * default stays sellable (keep-sellable). Answers 204. */
  setLocationDefaultCatalogue(locationId: string, catalogueId: string): Promise<void> {
    return this.#request<void>(`/management-api/locations/${locationId}/default-catalogue`, "PUT", {
      catalogueId,
    });
  }

  /** `GET /management-api/categories` — every category (id, name). */
  listCategories(): Promise<CategorySummary[]> {
    return this.#request<CategorySummary[]>("/management-api/categories", "GET");
  }

  /** `POST /management-api/categories` — create a category by name; returns the created row (201). */
  createCategory(name: string): Promise<CategorySummary> {
    return this.#request<CategorySummary>("/management-api/categories", "POST", { name });
  }

  /** `GET /management-api/catalogues/:id/products` — the products of one catalogue. */
  listProducts(catalogueId: string): Promise<Product[]> {
    return this.#request<Product[]>(`/management-api/catalogues/${catalogueId}/products`, "GET");
  }

  /** `POST /management-api/products` — create a product; returns the created `Product` (201). */
  createProduct(input: ProductInput): Promise<Product> {
    return this.#request<Product>("/management-api/products", "POST", input);
  }

  /**
   * `PATCH /management-api/products/:id` — patch a product's mutable slice (descriptions, price, VAT,
   * pricing unit, category, allergens, image, active). Answers an empty 204.
   */
  updateProduct(id: string, patch: ProductPatch): Promise<void> {
    return this.#request<void>(`/management-api/products/${id}`, "PATCH", patch);
  }

  /** `GET /management-api/products/:id/option-groups` — the option groups attached to a product, as
   * ordered ids (per-attachment `sort` order) — the read-back the product form uses to seed its attach
   * section's picked-and-ordered list on open. */
  listProductOptionGroupIds(productId: string): Promise<string[]> {
    return this.#request<string[]>(`/management-api/products/${productId}/option-groups`, "GET");
  }

  // ── Option groups (reusable modifiers) + their items (Task 11/12) ────────────────────────────────
  // The CRUD the option-group manager drives (the catalogue-api.ts routes wrapping
  // `@waitron/catalogue`'s option-group ops, `person.manage`-gated like the rest of this section).
  // Groups/items are per-item POST/PATCH (a reload after each, the station/course idiom); create
  // returns the created row at 201, patch answers an empty 204.

  /** `GET /management-api/option-groups` — every option group (active AND inactive), by `sort` then
   * id — the authoring editor's list and the product form's attach picker. */
  listOptionGroups(): Promise<OptionGroup[]> {
    return this.#request<OptionGroup[]>("/management-api/option-groups", "GET");
  }

  /** `POST /management-api/option-groups` — create an option group; returns the created row (201). An
   * invalid select-bound configuration rejects `{ code: "options.group_invalid" }`. */
  createOptionGroup(input: OptionGroupInput): Promise<OptionGroup> {
    return this.#request<OptionGroup>("/management-api/option-groups", "POST", input);
  }

  /** `PATCH /management-api/option-groups/:id` — patch a group's mutable slice (name, min/max select,
   * required, sort, active). Answers an empty 204; an invalid select-bound configuration rejects
   * `{ code: "options.group_invalid" }`. */
  updateOptionGroup(id: string, patch: OptionGroupPatch): Promise<void> {
    return this.#request<void>(`/management-api/option-groups/${id}`, "PATCH", patch);
  }

  /** `GET /management-api/option-groups/:id/items` — a group's choices (active AND inactive), by
   * `sort` then id. */
  listOptionGroupItems(groupId: string): Promise<OptionGroupItem[]> {
    return this.#request<OptionGroupItem[]>(
      `/management-api/option-groups/${groupId}/items`,
      "GET",
    );
  }

  /** `POST /management-api/option-groups/:id/items` — create a choice within a group; returns the
   * created row (201). */
  createOptionGroupItem(groupId: string, input: OptionGroupItemInput): Promise<OptionGroupItem> {
    return this.#request<OptionGroupItem>(
      `/management-api/option-groups/${groupId}/items`,
      "POST",
      input,
    );
  }

  /** `PATCH /management-api/option-groups/:groupId/items/:itemId` — patch an item's mutable slice
   * (name, price delta, VAT override, sort, active). Answers an empty 204. */
  updateOptionGroupItem(
    groupId: string,
    itemId: string,
    patch: OptionGroupItemPatch,
  ): Promise<void> {
    return this.#request<void>(
      `/management-api/option-groups/${groupId}/items/${itemId}`,
      "PATCH",
      patch,
    );
  }

  /**
   * `POST /management-api/product-images` — upload an image as `multipart/form-data` (a single `file`
   * part) and get back its stored `{ image }` reference (`<sha256>.<ext>`, served at `/media/<image>`).
   *
   * The body is a `FormData`, which `#request` passes through AS-IS with NO `content-type` header — the
   * browser derives `multipart/form-data` and appends the boundary itself; setting the header by hand
   * would omit that boundary and corrupt the request. Credential + error-envelope handling is
   * `#request`'s, exactly as the JSON methods.
   */
  uploadImage(file: File): Promise<{ image: string }> {
    const form = new FormData();
    form.append("file", file);
    return this.#request<{ image: string }>("/management-api/product-images", "POST", form);
  }

  // ── Ingredients & product recipes ──────────────────────────────────────────────────────────────

  /** `GET /management-api/ingredients` — every ingredient (id, name, allergens, active). */
  listIngredients(): Promise<Ingredient[]> {
    return this.#request<Ingredient[]>("/management-api/ingredients", "GET");
  }

  /** `POST /management-api/ingredients` — create an ingredient; returns the created `Ingredient` (201). */
  createIngredient(input: IngredientInput): Promise<Ingredient> {
    return this.#request<Ingredient>("/management-api/ingredients", "POST", input);
  }

  /**
   * `PATCH /management-api/ingredients/:id` — patch an ingredient's mutable slice (name, allergens,
   * active). Answers an empty 204.
   */
  updateIngredient(id: string, patch: IngredientPatch): Promise<void> {
    return this.#request<void>(`/management-api/ingredients/${id}`, "PATCH", patch);
  }

  /** `GET /management-api/products/:id/recipe` — the ingredient lines composing a product's recipe. */
  getProductRecipe(productId: string): Promise<RecipeLine[]> {
    return this.#request<RecipeLine[]>(`/management-api/products/${productId}/recipe`, "GET");
  }

  /**
   * `PUT /management-api/products/:id/recipe` — replace the WHOLE recipe (full-replace) with the given
   * ordered `ingredientIds`. Answers an empty 204.
   */
  setProductRecipe(productId: string, ingredientIds: string[]): Promise<void> {
    return this.#request<void>(`/management-api/products/${productId}/recipe`, "PUT", {
      ingredientIds,
    });
  }

  // ── Till layout & receipt configuration ──────────────────────────────────────────────────────

  /**
   * `GET /management-api/layout` — the authored till layout + receipt trim, or the server's defaults
   * when this tenant has never authored one (`getLayout` falls back to `DEFAULT_LAYOUT`/`DEFAULT_RECEIPT`
   * server-side), so this never 404s.
   */
  getLayout(): Promise<{ definition: LayoutDef; receipt: ReceiptConfig }> {
    return this.#request<{ definition: LayoutDef; receipt: ReceiptConfig }>(
      "/management-api/layout",
      "GET",
    );
  }

  /**
   * `PUT /management-api/layout` — replace the WHOLE layout definition (full-replace, idempotent, the
   * editor's "author the whole layout" semantics). Answers an empty 204; a definition the server rejects
   * throws `layout.invalid`.
   */
  putLayout(definition: LayoutDef): Promise<void> {
    return this.#request<void>("/management-api/layout", "PUT", { definition });
  }

  /**
   * `PUT /management-api/receipt` — replace the receipt trim config (full-replace). Answers an empty
   * 204; a config the server rejects throws `receipt.invalid`.
   */
  putReceipt(receipt: ReceiptConfig): Promise<void> {
    return this.#request<void>("/management-api/receipt", "PUT", { receipt });
  }

  // ── Table service-status configuration ──────────────────────────────────────────────────────────
  // The per-item CRUD the service-status editor drives (Task 8's `/management-api/service-statuses`
  // routes wrapping `apps/server/src/tables.ts`, `till.configure`-gated). The editor calls one endpoint
  // per mutation and reloads (`listStatuses`) after each — the routes are per-item POST/PATCH/DELETE,
  // not a single bulk PUT like the layout/receipt config.

  /** `GET /management-api/service-statuses` — the tenant's configured statuses (active + inactive). */
  listStatuses(): Promise<ServiceStatus[]> {
    return this.#request<ServiceStatus[]>("/management-api/service-statuses", "GET");
  }

  /** `POST /management-api/service-statuses` — create a status (label + colour, optional order);
   * returns its id. */
  createStatus(input: {
    label: string;
    color: string;
    displayOrder?: number;
  }): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/service-statuses", "POST", input);
  }

  /** `PATCH /management-api/service-statuses/:id` — patch a status's mutable slice (label, colour,
   * order, active). Answers an empty 204. */
  updateStatus(
    id: string,
    patch: { label?: string; color?: string; displayOrder?: number; active?: boolean },
  ): Promise<void> {
    return this.#request<void>(`/management-api/service-statuses/${id}`, "PATCH", patch);
  }

  /** `DELETE /management-api/service-statuses/:id` — soft-delete (deactivate) a status. Answers an
   * empty 204. */
  deactivateStatus(id: string): Promise<void> {
    return this.#request<void>(`/management-api/service-statuses/${id}`, "DELETE");
  }

  // ── Floor-plan zone + table configuration (FP-1) ────────────────────────────────────────────────
  // The per-item CRUD the floor-plan config screen drives (the `/management-api/zones` + `/management-api/
  // tables` routes in `apps/server/src/management-api.ts`, `till.configure`-gated). One endpoint per
  // mutation and a reload (`listZones`/`listTables`) after each — the routes are per-item
  // POST/PATCH/DELETE, not a single bulk PUT (the service-status shape above). Creates return the
  // minted id at 201; PATCH/DELETE answer an empty 204. `updateTable` carries no `active` field: the
  // table PATCH route accepts only `label`/`zoneId`/`capacity` (deactivate is the DELETE route), unlike
  // the zone PATCH route, which does take `active`.

  /** `GET /management-api/zones` — the venue's ACTIVE floor zones, by display order. */
  listZones(): Promise<FloorZone[]> {
    return this.#request<FloorZone[]>("/management-api/zones", "GET");
  }

  /** `POST /management-api/zones` — create a zone (name, optional display order); returns its id (201). */
  createZone(input: { name: string; displayOrder?: number }): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/zones", "POST", input);
  }

  /** `PATCH /management-api/zones/:id` — patch a zone's mutable slice (name, order, active). Answers an
   * empty 204. */
  updateZone(
    id: string,
    patch: { name?: string; displayOrder?: number; active?: boolean },
  ): Promise<void> {
    return this.#request<void>(`/management-api/zones/${id}`, "PATCH", patch);
  }

  /** `DELETE /management-api/zones/:id` — soft-delete (deactivate) a zone. Answers an empty 204. */
  deactivateZone(id: string): Promise<void> {
    return this.#request<void>(`/management-api/zones/${id}`, "DELETE");
  }

  /** `GET /management-api/tables` — the venue's ACTIVE dining tables, by label. */
  listTables(): Promise<DashboardTable[]> {
    return this.#request<DashboardTable[]>("/management-api/tables", "GET");
  }

  /** `POST /management-api/tables` — create a table (label, optional zone + capacity); returns its id
   * (201). */
  createTable(input: {
    label: string;
    capacity?: number;
    zoneId?: string;
  }): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/tables", "POST", input);
  }

  /** `PATCH /management-api/tables/:id` — patch a table's mutable slice (label, zone, capacity). The
   * route takes no `active` field (deactivate is the DELETE route). Answers an empty 204. */
  updateTable(
    id: string,
    patch: { label?: string; zoneId?: string; capacity?: number },
  ): Promise<void> {
    return this.#request<void>(`/management-api/tables/${id}`, "PATCH", patch);
  }

  /** `DELETE /management-api/tables/:id` — soft-delete (deactivate) a table. Answers an empty 204. */
  deactivateTable(id: string): Promise<void> {
    return this.#request<void>(`/management-api/tables/${id}`, "DELETE");
  }

  /**
   * Place (or re-place) a table on the FP-2 spatial floor plan → `PUT /management-api/tables/:id/placement`
   * (Task 3's MANAGEMENT route, `authorizeManager(till.configure)`-gated — the dashboard's own path, NOT
   * the on-till route). Writes the four placement columns + the target zone; the server re-validates the
   * values (`placement.invalid` for an out-of-range coord / bad shape / bad rotation; `zone.not_found`
   * for a missing/inactive zone; `table.not_found` for a bad/absent id) — each surfaced as a rejected
   * `{ code }`. The route answers an empty 204, so this resolves void; the Plano editor reloads
   * `listTables` after a successful call.
   */
  async setTablePlacement(tableId: string, placement: TablePlacement): Promise<void> {
    await this.#request<void>(`/management-api/tables/${tableId}/placement`, "PUT", placement);
  }

  /**
   * Un-place a table (NULL its four placement columns, leaving `zone_id` as-is) →
   * `DELETE /management-api/tables/:id/placement` (Task 3's management route, same
   * `authorizeManager(till.configure)` gate as {@link setTablePlacement}). The route answers an empty
   * 204, so this resolves void; `table.not_found` (a bad/absent id) surfaces as a rejected `{ code }`.
   */
  async clearPlacement(tableId: string): Promise<void> {
    await this.#request<void>(`/management-api/tables/${tableId}/placement`, "DELETE");
  }

  // ── Kitchen stations + routing (KDS-1) ───────────────────────────────────────────────────────────
  // The verbs the Cocina config screen + catalogue routing selects drive (KDS-1's
  // /management-api/stations, .../categories/:id/station, .../products/:id/station and .../bump-mode
  // routes, till.configure-gated). Station CRUD is per-item POST/PATCH/DELETE (a reload after each, the
  // service-status/floor idiom); the default is a POST to /:id/default; routing + bump-mode are PUTs
  // (idempotent full-writes). Creates return the minted id at 201; the rest answer an empty 204.

  /** `GET /management-api/stations` — the venue's ACTIVE kitchen stations, by display order then name. */
  listStations(): Promise<Station[]> {
    return this.#request<Station[]>("/management-api/stations", "GET");
  }

  /** `POST /management-api/stations` — create a station (name, optional order + default); returns its
   * id (201). Marking it default ADOPTS it as THE default in the same request (the verb clears any
   * prior default). */
  createStation(input: {
    name: string;
    displayOrder?: number;
    isDefault?: boolean;
  }): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/stations", "POST", input);
  }

  /** `PATCH /management-api/stations/:id` — patch a station's mutable slice (name, order, active — NOT
   * is_default, which only {@link setDefaultStation} flips). Answers an empty 204. */
  updateStation(
    id: string,
    patch: { name?: string; displayOrder?: number; active?: boolean },
  ): Promise<void> {
    return this.#request<void>(`/management-api/stations/${id}`, "PATCH", patch);
  }

  /** `DELETE /management-api/stations/:id` — soft-delete (deactivate) a station. Answers an empty 204. */
  deactivateStation(id: string): Promise<void> {
    return this.#request<void>(`/management-api/stations/${id}`, "DELETE");
  }

  /** `POST /management-api/stations/:id/default` — make this station the venue's single default (the
   * counter/pass fallback). A retired or foreign station rejects `{ code: "station.not_found" }`.
   * Answers an empty 204. */
  setDefaultStation(id: string): Promise<void> {
    return this.#request<void>(`/management-api/stations/${id}/default`, "POST");
  }

  /** `PUT /management-api/categories/:id/station` — set (or clear, with `null`) a category's default
   * routing station. A non-null station that is not live rejects `{ code: "station.not_found" }`.
   * Answers an empty 204. */
  setCategoryStation(categoryId: string, stationId: string | null): Promise<void> {
    return this.#request<void>(`/management-api/categories/${categoryId}/station`, "PUT", {
      stationId,
    });
  }

  /** `PUT /management-api/products/:id/station` — set (or clear, with `null`) a product's OVERRIDE
   * routing station (wins over its category default). Same faults as {@link setCategoryStation}.
   * Answers an empty 204. */
  setProductStation(productId: string, stationId: string | null): Promise<void> {
    return this.#request<void>(`/management-api/products/${productId}/station`, "PUT", {
      stationId,
    });
  }

  /** `PUT /management-api/bump-mode` — set the venue's whole-ticket bump mode (`line`/`ticket`).
   * Answers an empty 204. */
  setBumpMode(mode: BumpMode): Promise<void> {
    return this.#request<void>("/management-api/bump-mode", "PUT", { mode });
  }

  // ── Kitchen courses + fire control (KDS-2) ─────────────────────────────────────────────────────────
  // The Cursos config panel's CRUD + order, the product-course routing select, and the fire-control
  // toggle (`/management-api/courses*`, `.../products/:id/course`, `.../fire-control`; all till.configure-
  // gated). Course CRUD is per-item POST/PATCH/DELETE (a reload after each, the station idiom); the
  // product course + fire-control are PUTs; fire-control is also readable. Mirrors the station verbs above.

  /** `GET /management-api/courses` — the venue's ACTIVE kitchen courses, by display order then name. */
  listCourses(): Promise<Course[]> {
    return this.#request<Course[]>("/management-api/courses", "GET");
  }

  /** `POST /management-api/courses` — create a course (name, optional order); returns its id (201). No
   * default concept (courses have none). `course.name_taken` on a duplicate surfaces as a rejected `{ code }`. */
  createCourse(input: { name: string; displayOrder?: number }): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/courses", "POST", input);
  }

  /** `PATCH /management-api/courses/:id` — patch a course's mutable slice (name, order, active). Answers
   * an empty 204. A name collision rejects `{ code: "course.name_taken" }`; an unknown id `{ code: "course.not_found" }`. */
  updateCourse(
    id: string,
    patch: { name?: string; displayOrder?: number; active?: boolean },
  ): Promise<void> {
    return this.#request<void>(`/management-api/courses/${id}`, "PATCH", patch);
  }

  /** `DELETE /management-api/courses/:id` — soft-delete (deactivate) a course. Answers an empty 204. */
  deactivateCourse(id: string): Promise<void> {
    return this.#request<void>(`/management-api/courses/${id}`, "DELETE");
  }

  /** `PUT /management-api/products/:id/course` — set (or clear, with `null`) a product's default kitchen
   * course (KDS-2). A non-null course that is not live rejects `{ code: "course.not_found" }`. Answers 204. */
  setProductCourse(productId: string, courseId: string | null): Promise<void> {
    return this.#request<void>(`/management-api/products/${productId}/course`, "PUT", { courseId });
  }

  /** `GET /management-api/fire-control` — the venue's fire-control setting (`{ mode }`). */
  getFireControl(): Promise<{ mode: FireControl }> {
    return this.#request<{ mode: FireControl }>("/management-api/fire-control", "GET");
  }

  /** `PUT /management-api/fire-control` — set the venue's fire-control setting (`waiter`/`kitchen`).
   * Answers an empty 204. */
  setFireControl(mode: FireControl): Promise<void> {
    return this.#request<void>("/management-api/fire-control", "PUT", { mode });
  }

  // ── Devices (always-on station enrolment, device-identity-1) ─────────────────────────────────────
  // The three verbs the Devices screen drives, all device.manage-gated server-side. `listDevices` reads
  // the enrolled devices (newest first); `createDeviceCode` mints a single-use pairing code returned
  // ONCE (201, never re-fetchable); `revokeDevice` deactivates a device (an empty 204). Paths/bodies
  // against apps/server/src/device-api.ts.

  /** `GET /management-api/devices` — this tenant's enrolled devices, newest-enrolled first (the server's
   * order; the screen does not re-sort). Each carries its bound station, active flag and last-seen time. */
  listDevices(): Promise<DeviceRow[]> {
    return this.#request<DeviceRow[]>("/management-api/devices", "GET");
  }

  /** `POST /management-api/device-codes` — mint a single-use pairing code, returning the plaintext code
   * ONCE (201). The code is never re-readable (like a passkey challenge handle). `kind` is a `device_kind`
   * value: a `"kds_station"` binds to a station (`stationId` required; a bad/absent/retired station rejects
   * `{ code: "station.not_found" }`), while a `"handheld"` is station-less (`stationId` omitted). */
  createDeviceCode(input: { kind: string; stationId?: string; label: string }): Promise<{
    code: string;
  }> {
    return this.#request<{ code: string }>("/management-api/device-codes", "POST", input);
  }

  /** `POST /management-api/devices/:id/revoke` — revoke a device (flip `active = false`, instant): the
   * device's cookie stops validating at once. Answers an empty 204; an unknown id rejects
   * `{ code: "device.not_found" }`. Never a hard delete — a device is a durable identity. */
  revokeDevice(id: string): Promise<void> {
    return this.#request<void>(`/management-api/devices/${id}/revoke`, "POST");
  }

  // ── Printing (print agents + printers + jobs) ────────────────────────────────────────────────────
  // The nine verbs the Impresoras screen drives, all printer.manage-gated server-side (the print-api.ts
  // management routes). Agents: `listAgents` reads the enrolled agents (newest first); `createAgentCode`
  // mints a single-use pairing code returned ONCE (201, never re-fetchable); `revokeAgent` deactivates an
  // agent (204). Printers: `listPrinters`/`createPrinter`/`updatePrinter`/`deactivatePrinter` are the
  // config CRUD (create returns the minted id at 201; patch/deactivate answer an empty 204). `listRecentJobs`
  // is the status read; `testPrint` enqueues a known diagnostic payload (202). Paths/bodies against
  // apps/server/src/print-api.ts.

  /** `GET /management-api/print-agents` — this tenant's enrolled print agents, newest-enrolled first
   * (the server's order). Each carries its active flag and last-seen time; the token hash never leaves. */
  listAgents(): Promise<PrintAgentRow[]> {
    return this.#request<PrintAgentRow[]>("/management-api/print-agents", "GET");
  }

  /** `POST /management-api/print-agents/codes` — mint a single-use agent pairing code, returning the
   * plaintext code ONCE (201). The code is never re-readable (like a device pairing code / passkey
   * challenge handle). */
  createAgentCode(label: string): Promise<{ code: string }> {
    return this.#request<{ code: string }>("/management-api/print-agents/codes", "POST", { label });
  }

  /** `POST /management-api/print-agents/:id/revoke` — revoke a print agent (flip `active = false`,
   * instant): a revoked agent fails `requireAgent` at once. Answers an empty 204; an unknown id rejects
   * `{ code: "agent.not_found" }`. Never a hard delete — an agent is a durable identity. */
  revokeAgent(id: string): Promise<void> {
    return this.#request<void>(`/management-api/print-agents/${id}/revoke`, "POST");
  }

  /** `GET /management-api/printers` — this tenant's printers by name (active AND deactivated, so the
   * surface can show and reactivate them). */
  listPrinters(): Promise<Printer[]> {
    return this.#request<Printer[]>("/management-api/printers", "GET");
  }

  /** `POST /management-api/printers` — create a printer; returns the minted id (201). A transport short
   * of its required connection fields rejects `{ code: "printer.invalid_config" }` (422); a binding to an
   * unknown agent `{ code: "agent.not_found" }` (404). */
  createPrinter(input: PrinterInput): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/printers", "POST", input);
  }

  /** `PATCH /management-api/printers/:id` — patch a printer's mutable slice (name, transport, agent,
   * connection fields, ticket scope, active). Answers an empty 204; an unknown id rejects
   * `{ code: "printer.not_found" }`, an edit that leaves a transport short of a required field
   * `{ code: "printer.invalid_config" }`. */
  updatePrinter(id: string, patch: PrinterPatch): Promise<void> {
    return this.#request<void>(`/management-api/printers/${id}`, "PATCH", patch);
  }

  /** `POST /management-api/printers/:id/deactivate` — soft-delete (deactivate) a printer, NEVER a hard
   * delete (a job history references it). Answers an empty 204; an unknown id rejects
   * `{ code: "printer.not_found" }`. */
  deactivatePrinter(id: string): Promise<void> {
    return this.#request<void>(`/management-api/printers/${id}/deactivate`, "POST");
  }

  /** `GET /management-api/print-jobs` — the recent print jobs (newest first, bounded), the dashboard's
   * status read: last delivered, failing printers. No payload — opaque bytes are not status. */
  listRecentJobs(): Promise<PrintJobRow[]> {
    return this.#request<PrintJobRow[]>("/management-api/print-jobs", "GET");
  }

  /** `POST /management-api/printers/:id/test-print` — enqueue a known diagnostic payload on the printer
   * so the operator can confirm it (and its agent) are wired up. Returns the queued `{ jobId }` (202);
   * an unknown id rejects `{ code: "printer.not_found" }`. Enqueue only — never blocks on the printer. */
  testPrint(printerId: string): Promise<{ jobId: string }> {
    return this.#request<{ jobId: string }>(
      `/management-api/printers/${printerId}/test-print`,
      "POST",
    );
  }

  // ── Station↔printer mapping (KDS-4) ──────────────────────────────────────────────────────────────
  // The three verbs the printer editor's station-mapping section drives (the print-api.ts routes at
  // /management-api/stations/:sid/printers/:pid + /management-api/printers/:pid/stations, printer.manage-
  // gated). `listPrinterStations` reads a printer's current mapping (the editor's per-printer view);
  // attach/detach are the toggle's two directions. Attach is idempotent server-side (re-attach = 204
  // no-op) and detach is a pure idempotent delete, so a toggle never races itself into an error. The
  // station LIST for the toggles reuses `listStations()` above (the KDS-1 stations read).

  /** `GET /management-api/printers/:pid/stations` — the stations this printer serves, each a
   * `{ stationId, printerId }` pair. The editor reads it to show a printer's current mapping. */
  listPrinterStations(printerId: string): Promise<StationPrinter[]> {
    return this.#request<StationPrinter[]>(`/management-api/printers/${printerId}/stations`, "GET");
  }

  /** `POST /management-api/stations/:sid/printers/:pid` — attach `printerId` to `stationId` (a fire at
   * the station prints at the printer). Idempotent — re-attaching a pair is a 204 no-op. A retired/absent
   * station rejects `{ code: "station.not_found" }`, a retired/absent printer `{ code: "printer.not_found" }`.
   * Answers an empty 204. */
  attachPrinterToStation(stationId: string, printerId: string): Promise<void> {
    return this.#request<void>(
      `/management-api/stations/${stationId}/printers/${printerId}`,
      "POST",
    );
  }

  /** `DELETE /management-api/stations/:sid/printers/:pid` — detach `printerId` from `stationId`. A PURE
   * idempotent delete: it validates neither end (a mapping to a since-retired station/printer stays
   * detachable) and detaching an absent pair is a 204 no-op. Answers an empty 204. */
  detachPrinterFromStation(stationId: string, printerId: string): Promise<void> {
    return this.#request<void>(
      `/management-api/stations/${stationId}/printers/${printerId}`,
      "DELETE",
    );
  }

  // ── Receipt printer + print mode + drawer policy (counter receipt/drawer §5) ──────────────────────
  // The four verbs the Impresoras screen's receipt-printing section drives (the print-api.ts routes,
  // printer.manage-gated). `listTills` is the picker's source; `setTillReceiptPrinter` points a till at
  // one of its location's printers (or clears it with `null`); `setReceiptPrintMode` sets a location's
  // auto/on_request/never mode; `setDrawerOpenPolicy` sets a location's gated/open drawer policy. The
  // writes answer an empty 204.

  /** `GET /management-api/tills` — this tenant's tills (id, display label, location, currently-set
   * receipt printer or null). The per-till receipt-printer picker's source. */
  listTills(): Promise<Till[]> {
    return this.#request<Till[]>("/management-api/tills", "GET");
  }

  /** `PATCH /management-api/tills/:id/receipt-printer` — set (or clear, with `null`) a till's receipt
   * printer. A `printerId` that is not an ACTIVE printer in the till's OWN location rejects
   * `{ code: "printer.not_found" }` (404); an unknown till or a body missing `printerId`
   * `{ code: "management.request_invalid" }` (400). Answers an empty 204. */
  setTillReceiptPrinter(tillId: string, printerId: string | null): Promise<void> {
    return this.#request<void>(`/management-api/tills/${tillId}/receipt-printer`, "PATCH", {
      printerId,
    });
  }

  /** `PATCH /management-api/locations/:id/receipt-print-mode` — set a location's receipt print mode
   * (`auto` / `on_request` / `never`). An unknown location or a value off the enum rejects
   * `{ code: "management.request_invalid" }` (400). Answers an empty 204. */
  setReceiptPrintMode(locationId: string, mode: ReceiptPrintMode): Promise<void> {
    return this.#request<void>(
      `/management-api/locations/${locationId}/receipt-print-mode`,
      "PATCH",
      {
        mode,
      },
    );
  }

  /** `PATCH /management-api/locations/:id/drawer-open-policy` — set a location's cash-drawer-open
   * policy (`gated` / `open`). An unknown location or a value off the enum rejects
   * `{ code: "management.request_invalid" }` (400). Answers an empty 204. */
  setDrawerOpenPolicy(locationId: string, policy: DrawerOpenPolicy): Promise<void> {
    return this.#request<void>(
      `/management-api/locations/${locationId}/drawer-open-policy`,
      "PATCH",
      {
        policy,
      },
    );
  }

  // ── Shift planning (roster authoring) ──────────────────────────────────────────────────────────

  /** `GET /management-api/locations` — the tenant's centros de trabajo for the roster location picker. */
  getLocations(): Promise<LocationSummary[]> {
    return this.#request<LocationSummary[]>("/management-api/locations", "GET");
  }

  /** `GET /management-api/roster?locationId=&period=` — the week's draft-or-published snapshot + shifts. */
  getRoster(locationId: string, period: string): Promise<RosterSnapshot> {
    return this.#request<RosterSnapshot>(
      `/management-api/roster?locationId=${locationId}&period=${period}`,
      "GET",
    );
  }

  /** `POST /management-api/roster` — open a draft for the week; returns `{ versionId }` (201). */
  createRosterVersion(locationId: string, period: string): Promise<{ versionId: string }> {
    return this.#request<{ versionId: string }>("/management-api/roster", "POST", {
      locationId,
      period,
    });
  }

  /** `POST …/roster/:versionId/shifts` — add a planned shift; returns `{ shiftId }` (201). */
  addShift(versionId: string, input: ShiftInput): Promise<{ shiftId: string }> {
    return this.#request<{ shiftId: string }>(
      `/management-api/roster/${versionId}/shifts`,
      "POST",
      input,
    );
  }

  /** `PATCH …/roster/shifts/:shiftId` — edit a shift's fields. Answers an empty 204. */
  updateShift(shiftId: string, patch: ShiftPatch): Promise<void> {
    return this.#request<void>(`/management-api/roster/shifts/${shiftId}`, "PATCH", patch);
  }

  /** `DELETE …/roster/shifts/:shiftId` — remove a shift. Answers an empty 204. */
  removeShift(shiftId: string): Promise<void> {
    return this.#request<void>(`/management-api/roster/shifts/${shiftId}`, "DELETE");
  }

  /** `POST …/roster/:versionId/publish` — publish the draft; returns the advisory `{ breaches }`. */
  publishRoster(versionId: string): Promise<{ breaches: RosterBreach[] }> {
    return this.#request<{ breaches: RosterBreach[] }>(
      `/management-api/roster/${versionId}/publish`,
      "POST",
    );
  }

  // ── Approvals (shift swaps + absences) ──────────────────────────────────────────────────────────

  /** `GET /management-api/swaps` — the tenant's accepted swaps awaiting a manager decision. */
  listPendingSwaps(): Promise<PendingSwap[]> {
    return this.#request<PendingSwap[]>("/management-api/swaps", "GET");
  }

  /** `POST …/swaps/:id/decide` — approve/reject an accepted swap. Answers an empty 204. */
  decideSwap(swapId: string, decision: "approved" | "rejected"): Promise<void> {
    return this.#request<void>(`/management-api/swaps/${swapId}/decide`, "POST", { decision });
  }

  /** `GET /management-api/absences` — the tenant's requested absences awaiting a manager decision. */
  listPendingAbsences(): Promise<PendingAbsence[]> {
    return this.#request<PendingAbsence[]>("/management-api/absences", "GET");
  }

  /** `POST …/absences/:id/decide` — approve/reject a requested absence. Answers an empty 204.
   * Named `decideAbsence` for symmetry with `decideSwap`; it hits the same route → `setAbsenceStatus`. */
  decideAbsence(absenceId: string, decision: "approved" | "rejected"): Promise<void> {
    return this.#request<void>(`/management-api/absences/${absenceId}/decide`, "POST", {
      decision,
    });
  }

  // ── Planned vs actual (worked-time comparison) ───────────────────────────────────────────────────

  /** `GET /management-api/planned-vs-actual?locationId=&from=&to=` — the location's planned-vs-actual
   * comparison over a half-open [from, to) local window. */
  getPlannedVsActual(locationId: string, from: string, to: string): Promise<PlannedVsActualRow[]> {
    return this.#request<PlannedVsActualRow[]>(
      `/management-api/planned-vs-actual?locationId=${locationId}&from=${from}&to=${to}`,
      "GET",
    );
  }

  // ── Staff self-service (my schedule) ─────────────────────────────────────────────────────────────
  // The staff portal half of the dashboard (`apps/server/src/me-api.ts`), gated by the MANAGEMENT
  // session and role-blind. The requester is ALWAYS the session's person server-side; these methods
  // never send a personId (the #90 identity property).

  /**
   * `GET /management-api/session/me` — WHOAMI: who is signed into this browser, and with what role. The
   * shell probes this on boot / after login to decide whether to open the STAFF view (`role === "staff"`)
   * or the manager screens. Role-blind (no `authorizeManager`), so a staff session RESOLVES here —
   * unlike the old boot probe (`listStaff`, `person.manage`-gated), which 403'd a staff session and
   * dropped it to the login screen. (A request with no session still 401s via `management_session.required`.)
   *
   * Per-user-language-preference (Task 5): the response also carries the signed-in person's stored UI
   * `locale` (`null` when they have never chosen one) and the geography-derived `venueLocale` fallback —
   * the same value `GET /management-api/locales` echoes as `venueDefault`. The shell resolves the two via
   * `resolveActiveLocale(locale, venueLocale)` on boot/login to pick the operator-UI language.
   */
  getMe(): Promise<{
    personId: string;
    role: PersonRole;
    locale: string | null;
    venueLocale: string;
  }> {
    return this.#request<{
      personId: string;
      role: PersonRole;
      locale: string | null;
      venueLocale: string;
    }>("/management-api/session/me", "GET");
  }

  /**
   * `PUT /management-api/session/me/locale` with body `{ locale }` — persist the signed-in person's UI
   * language preference (per-user-language-preference, Task 6). Identity is the session's person
   * server-side, so the body carries only the chosen `code`; an unsupported `code` rejects with
   * `{ code: "locale.unsupported" }` (the server's one validation path). The shell switches the UI
   * only after this resolves, so a failed save leaves the language unchanged.
   */
  putLocale(code: string): Promise<void> {
    return this.#request<void>("/management-api/session/me/locale", "PUT", { locale: code });
  }

  /** `GET /management-api/me/schedule/shifts?from=&to=` — my shifts over a half-open `[from, to)`
   * window (`YYYY-MM-DD`). */
  listMyShifts(from: string, to: string): Promise<MyShift[]> {
    return this.#request<MyShift[]>(
      `/management-api/me/schedule/shifts?from=${from}&to=${to}`,
      "GET",
    );
  }

  /** `GET /management-api/me/schedule/swaps` — the swaps I'm party to (offered to me, or requested by me). */
  listMySwaps(): Promise<MySwap[]> {
    return this.#request<MySwap[]>("/management-api/me/schedule/swaps", "GET");
  }

  /**
   * `POST /management-api/me/schedule/swaps` — request a swap: offer one of MY shifts (`fromShiftId`) to
   * a colleague (`toPersonId`); `toShiftId` null is a one-sided give-away (the case this slice's UI files).
   * A shift that is not mine rejects `{ code: "swap.not_permitted" }`. Returns the new swap's id.
   */
  requestSwap(req: {
    fromShiftId: string;
    toPersonId: string;
    toShiftId: string | null;
  }): Promise<{ swapId: string }> {
    return this.#request<{ swapId: string }>("/management-api/me/schedule/swaps", "POST", req);
  }

  /**
   * `POST /management-api/me/schedule/swaps/:swapId/accept` — accept a swap offered TO me. Only the named
   * recipient may accept; a swap not offered to me rejects `{ code: "swap.not_permitted" }`, one no
   * longer `requested` `{ code: "swap.not_acceptable" }`. The server answers an empty 204.
   */
  acceptSwap(swapId: string): Promise<void> {
    return this.#request<void>(`/management-api/me/schedule/swaps/${swapId}/accept`, "POST");
  }

  /** `GET /management-api/me/schedule/absences` — my absences, every status. */
  listMyAbsences(): Promise<MyAbsence[]> {
    return this.#request<MyAbsence[]>("/management-api/me/schedule/absences", "GET");
  }

  /**
   * `POST /management-api/me/schedule/absences` — request an absence for myself. A range overlapping an
   * existing absence rejects `{ code: "absence.overlaps" }`. Returns the new absence's id.
   */
  requestAbsence(req: {
    kind: AbsenceKind;
    startsOn: string;
    endsOn: string;
    note: string | null;
  }): Promise<{ absenceId: string }> {
    return this.#request<{ absenceId: string }>(
      "/management-api/me/schedule/absences",
      "POST",
      req,
    );
  }

  // ── Purchase invoices (facturas recibidas) ────────────────────────────────────────────────────

  /** `GET /management-api/purchase-invoices` — every received invoice (header + its VAT lines). */
  listPurchaseInvoices(): Promise<PurchaseInvoice[]> {
    return this.#request<PurchaseInvoice[]>("/management-api/purchase-invoices", "GET");
  }

  /** `POST /management-api/purchase-invoices` — create a received invoice from its header + desglose;
   * returns the created `PurchaseInvoice` (201). */
  createPurchaseInvoice(input: PurchaseInvoiceInput): Promise<PurchaseInvoice> {
    return this.#request<PurchaseInvoice>("/management-api/purchase-invoices", "POST", input);
  }

  /** `PATCH /management-api/purchase-invoices/:id` — patch the header and/or fully replace the VAT
   * lines. Answers an empty 204. */
  updatePurchaseInvoice(id: string, patch: PurchaseInvoicePatch): Promise<void> {
    return this.#request<void>(`/management-api/purchase-invoices/${id}`, "PATCH", patch);
  }

  /** `DELETE /management-api/purchase-invoices/:id` — remove a received invoice (its VAT lines
   * cascade). Answers an empty 204. */
  deletePurchaseInvoice(id: string): Promise<void> {
    return this.#request<void>(`/management-api/purchase-invoices/${id}`, "DELETE");
  }

  // ── Bookings (staff-entered table reservations, Bookings-1) ───────────────────────────────────────

  /** `GET /management-api/bookings?date=YYYY-MM-DD` — the location's reservations for that wall-clock
   * day, ordered by time (all statuses; the screen filters/labels them). */
  listBookings(date: string): Promise<Booking[]> {
    return this.#request<Booking[]>(`/management-api/bookings?date=${date}`, "GET");
  }

  /** `POST /management-api/bookings` — create a `booked` reservation from its plain local date+time and
   * contact fields (NO `createdBy` — the server sets it from the session); returns the new id (201). */
  createBooking(input: BookingInput): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/bookings", "POST", input);
  }

  /** `PATCH /management-api/bookings/:id` — edit a `booked` reservation's business fields. Answers an
   * empty 204. */
  updateBooking(id: string, patch: BookingPatch): Promise<void> {
    return this.#request<void>(`/management-api/bookings/${id}`, "PATCH", patch);
  }

  /** `POST /management-api/bookings/:id/seat` — open a TS-1 tab on the table (the passed `tableId`, else
   * the booking's own) and link it; returns the new `{ tabId }`. Passing no table sends an empty body so
   * the server reuses the booking's assigned table. */
  seatBooking(id: string, req: { tableId?: string } = {}): Promise<{ tabId: string }> {
    return this.#request<{ tabId: string }>(`/management-api/bookings/${id}/seat`, "POST", req);
  }

  /** `POST /management-api/bookings/:id/cancel` — `booked|seated → cancelled`. Answers an empty 204. */
  cancelBooking(id: string): Promise<void> {
    return this.#request<void>(`/management-api/bookings/${id}/cancel`, "POST");
  }

  /** `POST /management-api/bookings/:id/no-show` — `booked → no_show`. Answers an empty 204. */
  markNoShow(id: string): Promise<void> {
    return this.#request<void>(`/management-api/bookings/${id}/no-show`, "POST");
  }

  /** `POST /management-api/bookings/:id/complete` — `seated → completed`. Answers an empty 204. */
  completeBooking(id: string): Promise<void> {
    return this.#request<void>(`/management-api/bookings/${id}/complete`, "POST");
  }

  // ── Reporting (sales & takings) ─────────────────────────────────────────────────────────────────

  /** `GET /management-api/reports/overview` — this node's sales/takings overview for TODAY (the venue
   * clock decides "today"): takings, record counts, the open-tables tile and the top sellers. */
  getSalesOverview(): Promise<SalesOverview> {
    return this.#request<SalesOverview>("/management-api/reports/overview", "GET");
  }

  /** `GET /management-api/reports/daily-close?businessDay=` — the full daily close for ONE explicit
   * business day (`YYYY-MM-DD`): VAT summary, cash-up, record counts and that day's top sellers. */
  getDailyClose(businessDay: string): Promise<DailyCloseDto> {
    return this.#request<DailyCloseDto>(
      `/management-api/reports/daily-close?businessDay=${businessDay}`,
      "GET",
    );
  }

  /** `GET /management-api/reports/period?from=&to=` — a VAT summary + top sellers over an inclusive
   * business-day range (`from`..`to`, each `YYYY-MM-DD`). */
  getSalesPeriod(from: string, to: string): Promise<SalesPeriodDto> {
    return this.#request<SalesPeriodDto>(
      `/management-api/reports/period?from=${from}&to=${to}`,
      "GET",
    );
  }

  /**
   * The one request path every method funnels through. `credentials: "include"` on every call (the
   * session cookie). A JSON `body` is JSON-encoded under a `content-type: application/json` header; a
   * `FormData` body (the image upload) is passed through AS-IS with NO `content-type`, so the browser
   * sets `multipart/form-data` and its boundary itself (a manual header would drop the boundary and
   * corrupt the upload); a GET/DELETE with no body carries neither header nor body. A non-2xx becomes a
   * rejected `{ code }` read from the server's `{ error: { code } }` envelope — falling back to
   * `server.internal` when the body names none — so callers branch on a stable domain code, never on an
   * HTTP status or a raw message.
   *
   * `fetchImpl` is read into a local before the call so it is invoked as a free function, not as a
   * method of `this` (which would rebind a native `fetch`).
   *
   * A 2xx with an EMPTY body resolves to `undefined` rather than being JSON-parsed: the mutation
   * routes (`logout`, `updatePerson`, `resetPin`, `setPassword`) answer empty 204s (`c.body(null,
   * 204)` in `apps/server/src/management-api.ts`), on which `res.json()` would throw a `SyntaxError`.
   * Those callers type `T` as `void`; every JSON route sends a body, so the non-empty branch parses
   * exactly as before. The branch keys off the empty body (`res.text() === ""`), not the status.
   */
  async #request<T>(path: string, method: string, body?: unknown): Promise<T> {
    const fetchImpl = this.#fetchImpl;
    const init: RequestInit =
      body === undefined
        ? { method, credentials: "include" }
        : body instanceof FormData
          ? { method, credentials: "include", body }
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
