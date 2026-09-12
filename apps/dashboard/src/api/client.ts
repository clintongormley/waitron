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
 * `@waitron/identity` (or any DB/server-touching `@waitron/*`). A runtime import from those packages
 * would drag their barrels — and through them `@waitron/db` and Node builtins — into the browser
 * bundle. A handful of duplicated field lists is the price of keeping the bundle free of server code,
 * exactly as `apps/till/src/api/client.ts` does. If those server shapes change, these follow — a
 * mismatch surfaces as a runtime shape error a view test catches, not a compile break.
 *
 * `TimingBand` below is the one exception, imported from `@waitron/shared` rather than re-declared —
 * that package is GENERIC (types + pure functions, no DB/Node builtins) and already a dashboard
 * dependency, exactly the precedent `apps/till/src/api/client.ts` sets for the same type.
 */
import type { TimingBand } from "@waitron/shared";
import {
  createRequest,
  LiveData,
  type DashboardRequest,
  type FetchLike,
} from "@waitron/dashboard-kit";

/** A person's role in the management model — the four levels the slice-1b staff API assigns. */
export type PersonRole = "staff" | "supervisor" | "manager" | "admin";

export interface OwnProfile {
  displayName: string;
  firstNames: string | null;
  lastNames: string | null;
  telephone: string | null;
  email: string | null;
  pendingEmail: string | null;
  locale: string | null;
  hasPassword: boolean;
  hasTotp: boolean;
  hasGoogle: boolean;
  passkeys: Array<{ id: string; name: string | null; createdAt: string }>;
}
export interface ProfileCredentials {
  currentPassword?: string;
  totp?: string;
}
export interface ProfileDetails extends ProfileCredentials {
  displayName: string;
  firstNames: string;
  lastNames: string;
  telephone: string | null;
  email: string;
  locale: string;
}

/** One `GET /management-api/staff-roster` entry — the colleague-picker list, no role or status. */
export interface RosterEntry {
  personId: string;
  displayName: string;
}

/** One `GET /management-api/staff` row — the full management view of a person. */
export interface PersonSummary {
  personId: string;
  displayName: string;
  firstNames?: string | null;
  lastNames?: string | null;
  telephone?: string | null;
  role: PersonRole;
  status: "pending" | "active" | "suspended";
  hasPassword: boolean;
  hasTotp: boolean;
  /** The person's login email, or null when none is set. */
  email: string | null;
}

export interface PersonEditDetails {
  displayName: string;
  firstNames: string;
  lastNames: string;
  telephone: string | null;
  email: string;
  role: PersonRole;
  status: "pending" | "active" | "suspended";
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

/**
 * An ingredient's dietary-origin category (design §diet) — the taxonomy the recipes/catalogue folds
 * roll up into a product's `diet`. A LOCAL copy of `@waitron/catalogue`'s `DIETARY_ORIGINS` token
 * union (no runtime import — the #70 bundle rule, as the allergen shapes above are). `null` on an
 * ingredient means UNCATEGORISED, which makes every product using it publish diet-PENDING rather than
 * a false "vegan"; the server's `validateOrigin` is the `diet.invalid_origin` authority.
 */
export type DietaryOrigin =
  "plant" | "meat" | "fish" | "shellfish" | "dairy" | "egg" | "honey" | "other_animal";

/**
 * The dietary-origin taxonomy in DISPLAY order — the runtime companion of {@link DietaryOrigin}, the
 * single dashboard-local source both the ingredient-form origin picker and the option-group manager's
 * per-item origin overlay render from (the way `i18n/domain.ts`'s `ALLERGEN_CODES` is shared by the
 * allergen picker and the same manager). Kept LOCAL, not imported from `@waitron/catalogue`, so its
 * barrel — and through it `@waitron/db` and Node builtins — stays out of the browser bundle (the #70
 * rule). The raw tokens stay the WIRE VALUES (emitted `origin` and `<option>` values); each renders
 * its localised label at the render edge through `t("origin.<token>")`, so this stays `as const` to
 * keep the literal keys.
 */
export const DIETARY_ORIGINS = [
  "plant",
  "meat",
  "fish",
  "shellfish",
  "dairy",
  "egg",
  "honey",
  "other_animal",
] as const;

/** The contains-tags a diet override may hand-assert / hand-strip — the strictly-smaller subset of
 * {@link DietaryOrigin} the derivation surfaces as `contains`. A LOCAL copy of `@waitron/catalogue`'s
 * `CONTAINS_TAGS` union (no runtime import — the #70 bundle rule). */
export type ContainsTag = "meat" | "fish";

/**
 * A product's staff DIET OVERRIDE (design §diet) — the diet twin of the manual allergen overlay. A
 * LOCAL copy of `@waitron/catalogue`'s `DietOverride` (no runtime import — the #70 rule). Each label
 * field, when present, FORCES that diet regardless of the recipe-derived profile (`"yes"`/`"no"`); an
 * ABSENT field defers to derivation (halal/kosher have no derivation, so their meaningful states are
 * still absent/yes/no). `addContains`/`removeContains` hand-add / hand-strip a contains-tag over the
 * derived set. The server's `validateDietOverride` is the `diet.*` authority; an EMPTY override (no
 * forced labels, no contains edits) is stored as `null`, never `{}`.
 */
export interface DietOverride {
  vegan?: "yes" | "no";
  vegetarian?: "yes" | "no";
  halal?: "yes" | "no";
  kosher?: "yes" | "no";
  addContains?: ContainsTag[];
  removeContains?: ContainsTag[];
}

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
  /** The staff diet override ALONE (the diet twin of `manualAllergens`), or null when none. The product
   * editor seeds its diet-override sub-form from THIS, so the recipe-derived profile is never
   * double-counted into the override on the next save. */
  dietOverride: DietOverride | null;
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
  /** The staff diet override; omitted or `null` leaves the product with no override (published `diet`
   * is the recipe-derived profile alone). An EMPTY override is sent as `null`, never `{}`. */
  dietOverride?: DietOverride | null;
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
  /** Patch the staff diet override; `null` clears it (published `diet` reverts to the recipe-derived
   * profile), omitted leaves it unchanged. An EMPTY override is sent as `null`, never `{}`. */
  dietOverride?: DietOverride | null;
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
  /** The most of this option a diner may take (`max_quantity`); 1 = no per-option quantity. */
  maxQuantity: number;
  /** Allergens this option ADDS to the dish it modifies (the three-state declaration — `null` here
   * means "adds nothing", the picker's PENDING state being inert for an add). Non-optional on the
   * read row to match the server shape (Task 5). */
  addAllergens: AllergenDeclaration;
  /** Allergen codes this option REMOVES from the dish (e.g. "no cheese" removes `milk`), or `null`
   * for none. A code appearing in both `addAllergens` and here is rejected server-side
   * (`allergen.add_remove_conflict`). */
  removeAllergens: string[] | null;
  /** Dietary ORIGINS this option ADDS to the dish ("add bacon" → ["meat"]), or `null` for none — the
   * diet twin of `addAllergens` (Task 5 folds these into the as-served diet). */
  addOrigins: string[] | null;
  /** Dietary origins this option REMOVES from the dish ("no cheese" → ["dairy"]), or `null` for none.
   * Unlike allergens an origin add/remove is not a conflict (add wins the fold), so there is no
   * disjointness check. */
  removeOrigins: string[] | null;
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
 * other fields default to the column defaults (priceDelta "0", sort 0, active true, maxQuantity 1). A
 * `maxQuantity` below 1 (or non-integer) rejects `options.item_invalid`. */
export interface OptionGroupItemInput {
  name: Record<string, string>;
  priceDelta?: string;
  vatClass?: VatClass | null;
  sort?: number;
  active?: boolean;
  /** The per-option quantity cap; omitted defaults to 1 (no per-option quantity). An integer >= 1. */
  maxQuantity?: number;
  /** Allergens this option adds / removes (see {@link OptionGroupItem}); omitted (or `null`) adds /
   * removes nothing. A code in both is rejected `allergen.add_remove_conflict`. */
  addAllergens?: AllergenDeclaration;
  removeAllergens?: string[] | null;
  /** Dietary origins this option adds / removes (see {@link OptionGroupItem}); omitted (or `null`) adds /
   * removes nothing. Each entry is validated against the origin taxonomy server-side. */
  addOrigins?: string[] | null;
  removeOrigins?: string[] | null;
}

/** The `PATCH /management-api/option-groups/:groupId/items/:itemId` body — mirrors catalogue's
 * `UpdateOptionGroupItemInput`. Every key is optional (absent = unchanged); `vatClass: null` reverts
 * the item to inheriting the parent dish's rate. A present `maxQuantity` is re-validated (>= 1). */
export interface OptionGroupItemPatch {
  name?: Record<string, string>;
  priceDelta?: string;
  vatClass?: VatClass | null;
  sort?: number;
  active?: boolean;
  /** Absent leaves the stored value unchanged; a present value is re-validated as an integer >= 1. */
  maxQuantity?: number;
  /** Allergens this option adds / removes (see {@link OptionGroupItem}); absent leaves each unchanged,
   * `null` clears it. A code in both is rejected `allergen.add_remove_conflict`. */
  addAllergens?: AllergenDeclaration;
  removeAllergens?: string[] | null;
  /** Dietary origins this option adds / removes (see {@link OptionGroupItem}); absent leaves each
   * unchanged, `null` clears it. Each present side is validated against the origin taxonomy. */
  addOrigins?: string[] | null;
  removeOrigins?: string[] | null;
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
  /** The dietary-origin category, or null when uncategorised (dependent products go diet-PENDING). */
  dietaryOrigin: DietaryOrigin | null;
  active: boolean;
}

/** The `POST /management-api/ingredients` body — mirrors recipes' `CreateIngredientInput`. `allergens`
 * omitted leaves the ingredient unreviewed (null); `dietaryOrigin` omitted leaves it uncategorised
 * (null); a supplied map/value is validated server-side. */
export interface IngredientInput {
  name: string;
  allergens?: Record<string, AllergenEntry>;
  dietaryOrigin?: DietaryOrigin | null;
}

/** The `PATCH /management-api/ingredients/:id` body — mirrors recipes' `UpdateIngredientInput`. Every
 * key is optional; `allergens: null` clears the declaration back to unreviewed, `dietaryOrigin: null`
 * uncategorises the ingredient, `active` toggles it. */
export interface IngredientPatch {
  name?: string;
  allergens?: AllergenDeclaration;
  dietaryOrigin?: DietaryOrigin | null;
  active?: boolean;
}

/** One line of `GET /management-api/products/:id/recipe` — the ingredient rows composing a product's
 * recipe. `recipes`' `getProductRecipe` returns full `Ingredient` rows, so a recipe line IS an
 * `Ingredient`; aliased (not re-declared) so the two shapes cannot drift. */
export type RecipeLine = Ingredient;

// ── Receipt-trim (configurable-till) types ────────────────────────────────────────────────────────
// A LOCAL copy of `@waitron/layouts`' receipt JSON shape (the `/management-api/receipt` route wrapping
// the layouts service), deliberately NOT imported from `@waitron/layouts`/`@waitron/db` — a runtime
// import would drag their barrels + Node builtins into the browser bundle (the #70 rule, as the
// staff/catalogue shapes above do). If the server shape changes this follows, and a mismatch surfaces
// as a runtime shape error a view test catches, not a compile break.

/**
 * The authorable, NON-FISCAL receipt trim (design §7/§8) — a `headerSubtitle` under the venue name and a
 * `footerMessage` under the VERI*FACTU legend, both optional. It renders AROUND the immutable art. 7.1
 * core, never able to touch it; no field here can suppress or reorder a mandated element.
 */
export interface ReceiptConfig {
  headerSubtitle?: string;
  footerMessage?: string;
}

export interface TestEmailAddress {
  name: string;
  address: string;
}

export interface TestEmailSummary {
  id: string;
  from: TestEmailAddress;
  to: TestEmailAddress[];
  subject: string;
  snippet: string;
  createdAt: string;
  read: boolean;
}

export interface TestEmail extends Omit<TestEmailSummary, "snippet" | "createdAt" | "read"> {
  date: string;
  text: string;
}

export interface EmailInbox {
  mode: "local_capture" | "smtp" | "unconfigured";
  count: number;
  messages: TestEmailSummary[];
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
 * single counter/pass fallback (only {@link DashboardApi.setDefaultStation}/`createStation` flip it).
 * The three `*AfterMinutes` fields (KDS order-timing alerts, design §8) are the station's configured
 * order-age bands in MINUTES — a fired ticket item goes `warm` after `warmAfterMinutes`, `overdue`
 * after `overdueAfterMinutes`, `forgotten` after `forgottenAfterMinutes` — and are what the Cocina
 * threshold editor (`kitchen-screen.ts`) seeds its three inputs from. */
export interface Station {
  id: string;
  name: string;
  displayOrder: number;
  isDefault: boolean;
  active: boolean;
  warmAfterMinutes: number;
  overdueAfterMinutes: number;
  forgottenAfterMinutes: number;
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
 * device (device-identity-1): `kind` is DERIVED from the device profile's form factor (`kindOfFormFactor`,
 * server-side — there is no `device_kind` column), `stationId`
 * the bound kitchen station (null for a non-station kind), `active` false once revoked,
 * `lastSeenAt` the last time the device authenticated (null before its first call), `enrolledAt` when it
 * redeemed its pairing code. `deviceProfileId` is the device's currently-assigned device profile (null =
 * the form-factor default). The two timestamps are ISO-8601 strings (never `Date`s over the wire). The
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
  deviceProfileId: string | null;
}

/** One `GET /management-api/canvases` row — a tenant canvas as the canvas picker needs it. The
 * server answers `{ canvases: [{ id, name, definition }] }`; this is one element. `definition` is the
 * opaque layout JSON, typed `unknown` DELIBERATELY: the dashboard's device-enrolment picker binds only a
 * canvas's `{ id, name }`, and importing `@waitron/layouts`' real definition type would drag that
 * package's barrel + Node builtins into the browser bundle (the #70 rule the printing/till shapes follow).
 * A layout editor that must read the definition parses it at its own edge; a mismatch surfaces as a
 * runtime shape error a view test catches, not a compile break. */
export interface Canvas {
  id: string;
  name: string;
  definition: unknown;
}

/** A device's FORM FACTOR — the shape of hardware a profile targets, and what the server derives the
 * device KIND from. A LOCAL copy of `@waitron/layouts`' `FormFactor` union (no runtime import — the
 * #70 bundle rule the shapes above follow); the create/update routes re-validate it against
 * `FORM_FACTORS`, so a bad value is a runtime `management.request_invalid`, not a compile break. */
export type FormFactor = "till" | "phone-portrait" | "tablet-landscape" | "kds";

/** One `GET /management-api/device-profiles` row — a reusable device profile (SP device-profile
 * feature): a named bundle of an assigned canvas (`canvasId`, `null` = fall back to the form-factor
 * default), a capability set (`integrated-card-payment`/`open-cash-drawer`/`act-as-kds`/`print-receipt`) and the
 * `formFactor` it targets. The server answers `{ deviceProfiles: [...] }` for the list and the bare
 * row elsewhere. `capabilities` crosses the boundary as `string[]` DELIBERATELY — the dashboard
 * renders it against a LOCAL flag mirror rather than importing `@waitron/layouts`' `CapabilityFlag`
 * (the #70 bundle rule the canvas / printing shapes follow); an unknown flag is a runtime shape error
 * a view test catches, not a compile break. */
export interface DeviceProfile {
  id: string;
  name: string;
  canvasId: string | null;
  capabilities: string[];
  formFactor: FormFactor;
  /** The auto-logout idle timeout in SECONDS; `null` = never (and always `null` for a `kds` profile).
   * The editor works in whole minutes and converts at its own edge. */
  inactivityTimeoutSeconds: number | null;
}

/**
 * One `GET /management-api/join-requests` row — a device (or print agent) waiting to be let in
 * (device-join-and-accept design §1.2). It carries NO verification number, deliberately and
 * structurally: the server's projection has no such field, so the list cannot show the answer beside
 * the question. The three numbers to choose between come from {@link DashboardApi.joinChallenge}, and
 * only once a row is opened. `createdAt` is an ISO-8601 instant; `label` is the name the joiner asked
 * for, which is attacker-chosen text and is rendered as text, never as markup. Mirrors
 * `listPendingJoinRequests` (`apps/server/src/join-requests.ts`); NOT imported from `apps/server` (the
 * #70 bundle rule the shapes above follow).
 */
export interface JoinRequestRow {
  id: string;
  kind: "device" | "print_agent";
  label: string;
  createdAt: string;
}

/** `GET /management-api/pairing-mode` — the venue-wide window that admits knocks. `openUntil` is the
 * ISO instant it lapses (null while shut), and `refusedRecently` counts the knocks the SHUT window
 * turned away in the last ten minutes (`REFUSED_WINDOW_MS`, `apps/server/src/pairing-mode.ts`) — an
 * in-memory count on the primary, so it resets on a restart or a promotion. */
export interface PairingModeState {
  open: boolean;
  openUntil: string | null;
  refusedRecently: number;
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

// ── Printing types (print agents + printers + jobs) ───────────────────────────────────────────────
// LOCAL copies of the server's printing JSON shapes (the `print-api.ts` routes wrapping
// `@waitron/printing`'s ops), deliberately NOT imported from `@waitron/printing`/`@waitron/db` — a
// runtime import would drag their barrels + Node builtins into the browser bundle (the #70 rule, as
// every shape above does). These are the CONTRACT the Impresoras screen builds on; if the server
// shapes change these follow, and a mismatch surfaces as a runtime shape error a view test catches.

/** How a printer is reached — the `print_transport` pgEnum (schema/printers.ts). `usb`/`bluetooth`
 * printers are keyed by a stable `localKey` (USB serial / Bluetooth MAC); `network_tcp` by host+port;
 * `cloud_poll` self-polls. No transport stores a serving agent — which box serves a printer is derived
 * at run time from the devices it can currently see (central printer provisioning §3). */
export type PrintTransport = "usb" | "network_tcp" | "bluetooth" | "cloud_poll";

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
  host: string | null;
  active: boolean;
  /** The node that self-enrolled this agent on its own box (`/api/node/enrol-self`), or null for an
   * agent enrolled manually through the join-and-accept flow. The surface shows a provenance marker
   * when it is set. */
  nodeId: string | null;
  lastSeenAt: string | null;
  enrolledAt: string;
}

/** One `GET /management-api/printers` row — printer configuration plus full-history job totals. The connection
 * fields are transport-specific and null when unused (`localKey` = the USB serial / Bluetooth MAC for
 * `usb`/`bluetooth`); both active and deactivated printers are listed. There is no serving-agent column
 * any more — eligibility is derived at run time (central printer provisioning §3). */
export interface Printer {
  /** Queued, in-flight, and retryable failed jobs across the complete history. */
  pendingJobs: number;
  lastPrintAt: string | null;
  id: string;
  name: string;
  transport: PrintTransport;
  host: string | null;
  port: number | null;
  localKey: string | null;
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
  host?: string;
  port?: number;
  /** The stable device id — the USB serial (`usb`) or Bluetooth MAC (`bluetooth`). Absent for
   * `network_tcp`/`cloud_poll`. A create whose `localKey` already names a printer in this venue rejects
   * `printer.already_registered`. */
  localKey?: string;
  pollId?: string;
}

/** One `GET /management-api/discovered-printers` row — a device an agent currently sees or found in a
 * scan (central printer provisioning §9). `usb`/`bluetooth` devices carry a stable `localKey`; a freshly
 * scanned `network_tcp` printer carries `host`/`port` and may have no `localKey`. `agentName` is the box
 * that reported it (null if it since went away), `make`/`model`/`name` its self-reported identity when
 * known, and `alreadyRegistered` is true when it matches a registered printer — a usb/bluetooth device
 * on its `localKey`, a network device on host:port — with `printerId` saying which; the discovered table
 * hides active matches and offers disabled matches for reactivation. The registered printer's own
 * row shows when it was seen. */
export interface DiscoveredPrinter {
  agentId: string;
  agentName: string | null;
  transport: PrintTransport;
  localKey?: string;
  host?: string | null;
  port?: number | null;
  make?: string | null;
  model?: string | null;
  name?: string | null;
  alreadyRegistered: boolean;
  /** The registered printer this device matches (usb/bluetooth on `localKey`, network on host:port), or null. */
  printerId: string | null;
  /** ISO instant of the agent report that last carried this device. */
  lastSeenAt: string;
}

/** The `PATCH /management-api/printers/:id` body — mirrors `@waitron/printing`'s `UpdatePrinterInput`.
 * Every key is optional (a PATCH touches only what it names); the connection fields (`host`, `port`,
 * `localKey`, `pollId`) accept an explicit `null` to CLEAR them, which `undefined` (absent) does not. */
export interface PrinterPatch {
  name?: string;
  transport?: PrintTransport;
  host?: string | null;
  port?: number | null;
  /** The stable device id (USB serial / Bluetooth MAC); `null` clears it. A re-key to a device already
   * registered in this venue rejects `printer.already_registered`. */
  localKey?: string | null;
  pollId?: string | null;
  ticketScope?: PrintTicketScope;
  active?: boolean;
}

export type PrintPreviewBlock =
  | { kind: "text"; text: string }
  | { kind: "feed"; lines: number }
  | { kind: "cut" }
  | { kind: "image"; width: number; height: number; data: string; qrData?: string };

/** A bounded preview of the recorded printer commands. */
export interface PrintJobPreview {
  text: string;
  blocks: PrintPreviewBlock[];
  qrData: string[];
  omittedGraphics: boolean;
  truncated: boolean;
  unsupported: boolean;
}

/** One `GET /management-api/print-jobs` row — the dashboard's status read (recent activity, newest
 * first, no payload). Mirrors print-api.ts's projection; `deliveredAt` is set only once `done`. */
export interface PrintJobRow {
  canResend: boolean;
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

/**
 * One `GET /management-api/reports/overdue-orders` row (KDS order-timing alerts, design §7.4) —
 * mirrors `@waitron/reporting`'s `OverdueOrder`: a currently-open order whose worst UNSERVED line has
 * crossed into `overdue`/`forgotten`, worst-first. `stationName`/`ageMinutes`/`band` describe that
 * WORST line, not necessarily the order's oldest. `tableLabel` is `null` for a bare walk-up (the same
 * optionality the till's `ExpoOrder.tableLabel` carries) — the manager overview screen renders that as
 * the em-dash placeholder `staff-list.ts` already uses for an absent field, not a new i18n string.
 */
export interface OverdueOrder {
  orderId: string;
  orderNumber: number;
  tableLabel: string | null;
  stationName: string;
  ageMinutes: number;
  /** Only ever `"overdue"` or `"forgotten"` in practice — the route never returns a fresh/warm order —
   * but typed as the full union to mirror the server shape exactly, as every DTO here does. */
  band: TimingBand;
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

// ── Diagnostics (recent logs + runtime verbosity) types ──────────────────────────────────────────
// LOCAL copies of the server's diagnostics JSON shapes (the `/management-api/diagnostics/*` routes,
// Task 7), deliberately NOT imported from `apps/server`/`@waitron/*` — a runtime import would drag
// their barrels + Node builtins into the browser bundle (the #70 rule every shape above follows).
// These are the CONTRACT the diagnostics viewer screen builds on; the server shapes stay the source
// of truth, and a mismatch surfaces as a runtime shape error a view test catches, not a compile break.

/** One line of `GET /management-api/diagnostics/recent` — a structured log record. `at` (the ISO
 * instant), `level` (the severity) and `event` (the log key) are always present; `requestId` is set
 * only when the line belongs to a request (a boot/background line carries none); the open `Record`
 * tail carries whatever per-event fields the server attached. */
export type DiagnosticsLine = {
  at: string;
  level: string;
  event: string;
  requestId?: string;
} & Record<string, unknown>;

/** `GET /management-api/diagnostics/verbosity` — the node's current log verbosity. `level` is the
 * floor being emitted; `revertsAt` is the ISO instant a temporary raise expires (null when the level
 * is the standing default, with no pending revert). */
export type Verbosity = { level: "debug" | "info"; revertsAt: string | null };

// ── Backup admin (recovery-key wizard) types ─────────────────────────────────────────────────────
// LOCAL copies of the server's backup-status/apply JSON shapes (the `/api/backup/*` routes wrapping
// `apps/server`'s `BackupSupervisor`), deliberately NOT imported from `apps/server`/`@waitron/db` — a
// runtime import would drag its barrel + Node builtins into the browser bundle (the #70 rule every
// shape above follows). These are the CONTRACT the backup admin screen builds on; the server shapes
// stay the source of truth, and a mismatch surfaces as a runtime shape error a view test catches.

/** How often a backup runs. A `wall-clock` schedule fires on the chosen days at a fixed time or the
 * box-chosen `auto` slot (after close + the day's reports); `interval` is the every-N-ms form the box
 * image may set — the screen authors only `wall-clock`, but reads either back in status. Mirrors the
 * server's `BackupSchedule`. */
export type BackupSchedule =
  | { kind: "interval"; ms: number }
  | {
      kind: "wall-clock";
      days: "daily" | number[];
      at: { hour: number; minute: number } | "auto";
    };

/** One configured destination's freshness (mirrors the server's `DestinationStatus`). `lastBackupAt`
 * is null and `stale` true when nothing has landed there yet. */
export type BackupDestinationStatus = {
  id: string;
  lastBackupAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
};

/** The per-destination freshness read (mirrors the server's `BackupStatus`): `configured: false` when
 * backups are off, else one entry per destination. */
export type BackupFreshness =
  { configured: false } | { configured: true; destinations: BackupDestinationStatus[] };

/** `GET /api/backup/status` — the running backup duty projected for the admin surface, the server's
 * `BackupRuntimeStatus` MINUS the secret `recoveryKey`, plus the async freshness read (`backupStatus`)
 * and the derived `archiveUnderCurrentKey`. `schedule`/`retention`/`keyFingerprint`/`keyRotatedAt` are
 * absent (optional here) when no backup is configured. Mirrors the server's `projectStatus`. */
export interface BackupStatusView {
  enabled: boolean;
  isPrimary: boolean;
  managedByEnvironment: boolean;
  destinations: { id: string; dir: string }[];
  schedule?: BackupSchedule;
  retention?: { count: number; days: number };
  keyFingerprint?: string;
  keyRotatedAt?: string;
  backupStatus: BackupFreshness;
  archiveUnderCurrentKey: boolean;
}

/** The `POST /api/backup/apply` body — the destination, the chosen recovery key, and the policy
 * (schedule + retention). Mirrors the server's `readApplyBody`. */
export interface BackupApplyBody {
  destinationDir: string;
  recoveryKey: string;
  schedule: BackupSchedule;
  retention: { count: number; days: number };
}

// ── Card payments (providers + readers) ──────────────────────────────────────────────────────────
// LOCAL copies of the generic payments routes' JSON shapes (`apps/server/src/payments-api.ts`),
// deliberately NOT imported from `@waitron/payments`/a provider package/`@waitron/db` — a runtime
// import would drag their barrels and Node builtins into the browser bundle (the #70 rule the printing
// shapes above follow). A secret NEVER crosses these: connect returns only the merchant name, and the
// provider list carries connection STATE, no ciphertext. If the server shapes change these follow, and
// a mismatch surfaces as a runtime shape error a view test catches, not a compile break.

/** One `GET /management-api/payments/providers` row. `state` is the credential-connection fact the
 * route computes ("connected" when a sealed credential exists for the provider's purpose, else
 * "not_connected"); there is NO persisted merchant name, so a reloaded connected provider shows
 * "connected", never "connected as X" (Task 11 ruling). The wire also carries the provider's
 * credential/reader field descriptors, which the generic screen ignores — it mounts each provider's
 * own panel (`CARD_PROVIDER_PANELS`) for the forms — so they are omitted here. */
export interface PaymentProviderRow {
  providerId: string;
  state: "connected" | "not_connected";
}

/** One `GET /management-api/payments/readers` row. `active` is false for a retired reader (the row is
 * kept so historical payments still resolve its name); `deviceCount` is how many devices name it as
 * their default. `provider` is the provider token ("sumup"/"stripe"), resolved to a display name via
 * the matching panel's `displayNameKey`. */
export interface ReaderRow {
  id: string;
  provider: string;
  name: string;
  active: boolean;
  deviceCount: number;
}

/** A reader's live status as `GET /management-api/payments/readers/:id/status` returns it — loaded
 * lazily per row. `online` is device connectivity; `pairingStatus` (SumUp) is pairing completion,
 * DISTINCT from connectivity (a reader can be paired yet briefly offline). */
export interface ReaderStatusView {
  online: boolean;
  detail?: string;
  pairingStatus?: "processing" | "paired";
}

/** The `POST /management-api/payments/readers` body. Every provider sends `providerId` + `name` plus
 * its own field(s) — SumUp a `code`, Stripe a `reference` — so the extra fields are a string index.
 * The generic screen never calls this (each provider's add-reader panel does, through the request
 * primitive); it exists so the client surface is complete. */
export interface AddReaderInput {
  providerId: string;
  name: string;
  [field: string]: string;
}

export class DashboardApi {
  readonly liveData = new LiveData();
  #background?: DashboardApi;
  #onError?: (code: string) => void;

  get background(): DashboardApi {
    return (this.#background ??= new DashboardApi(
      this.#baseUrl,
      this.#fetch,
      this.#onError,
      undefined,
      true,
    ));
  }
  /** The one request primitive every method funnels through (see @waitron/dashboard-kit's
   * createRequest for the credentials/JSON/FormData/empty-body/`{ code }` rules). */
  readonly #request: DashboardRequest;
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  #localesPromise?: Promise<{
    locales: Array<{ code: string; label: string }>;
    venueDefault: string;
    loginDefault: string;
    venueName: string;
    onboardingIntent?: "demo" | "prepare" | "live";
  }>;

  /**
   * @param baseUrl prefixed to every path (default `""`: same-origin, so the browser fetches
   *   `/management-api/...` from the origin serving the app).
   * @param fetchImpl the `fetch` to use (default the global; a test injects a stub).
   */
  constructor(
    baseUrl = "",
    fetchImpl: FetchLike = fetch,
    onError?: (code: string) => void,
    onSuccess?: (path: string) => void,
    passive = false,
  ) {
    this.#baseUrl = baseUrl;
    this.#fetch = fetchImpl;
    this.#onError = onError;
    this.#request = createRequest({ baseUrl, fetchImpl, onError, onSuccess, passive });
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
   * `SUPPORTED_LOCALES` entry, `venueDefault` the tenant's fallback locale, `loginDefault` the
   * Accept-Language match for this browser, and `venueName` its public
   * legal name for the pre-login banner. The language chooser reads the list; the app decides what to
   * do with a pick, so the client only surfaces the shape.
   */
  getLocales(): Promise<{
    locales: Array<{ code: string; label: string }>;
    venueDefault: string;
    loginDefault: string;
    venueName: string;
    onboardingIntent?: "demo" | "prepare" | "live";
  }> {
    // Share the catalogue and language defaults for this page's lifetime.
    // Cache the promise ONLY on success — clear it on rejection so a transient failure retries.
    this.#localesPromise ??= this.#request<{
      locales: Array<{ code: string; label: string }>;
      venueDefault: string;
      loginDefault: string;
      venueName: string;
      onboardingIntent?: "demo" | "prepare" | "live";
    }>("/management-api/locales", "GET").catch((err) => {
      this.#localesPromise = undefined;
      throw err;
    });
    return this.#localesPromise;
  }

  /**
   * `POST /management-api/session` — log in with an email + password. Returns who is now logged in;
   * a bad credential rejects with the server's `{ code }`.
   */
  login(input: {
    email: string;
    password: string;
    totp?: string;
    recoveryCode?: string;
  }): Promise<{ personId: string }> {
    return this.#request<{ personId: string }>("/management-api/session", "POST", input);
  }

  requestPasswordReset(email: string): Promise<void> {
    return this.#request<void>("/management-api/password-reset", "POST", { email });
  }

  inspectAccountAction(
    token: string,
    purpose: "invitation" | "password_reset",
  ): Promise<{ email: string; purpose: "invitation" | "password_reset" }> {
    return this.#request("/management-api/account-actions/inspect", "POST", { token, purpose });
  }

  getProfile(): Promise<OwnProfile> {
    return this.#request<OwnProfile>("/management-api/session/me/profile", "GET");
  }
  getGoogleConfig(): Promise<{ configured: boolean; privacyNoticeUrl?: string }> {
    return this.#request<{ configured: boolean; privacyNoticeUrl?: string }>(
      "/management-api/google/config",
      "GET",
    );
  }
  beginGoogleLogin(): Promise<{ authorizationUrl: string }> {
    return this.#request<{ authorizationUrl: string }>("/management-api/google/login", "POST");
  }
  beginGoogleLink(input: ProfileCredentials): Promise<{ authorizationUrl: string }> {
    return this.#request<{ authorizationUrl: string }>(
      "/management-api/session/me/google",
      "POST",
      input,
    );
  }
  saveProfile(input: ProfileDetails): Promise<{ emailVerificationSent: boolean }> {
    return this.#request("/management-api/session/me/profile", "PUT", input);
  }
  confirmProfileEmail(code: string): Promise<{ email: string }> {
    return this.#request("/management-api/session/me/profile/email/confirm", "POST", { code });
  }
  changePassword(input: ProfileCredentials & { password: string }): Promise<void> {
    return this.#request<void>("/management-api/session/me/password", "PUT", input);
  }
  changePin(input: ProfileCredentials & { pin: string }): Promise<void> {
    return this.#request<void>("/management-api/session/me/pin", "PUT", input);
  }
  beginTotp(input: ProfileCredentials): Promise<{
    enrollmentId: string;
    secret: string;
    uri: string;
    expiresAt: string;
  }> {
    return this.#request("/management-api/session/me/totp/begin", "POST", input);
  }
  finishTotp(enrollmentId: string, code: string): Promise<{ codes: string[] }> {
    return this.#request("/management-api/session/me/totp/finish", "POST", {
      enrollmentId,
      code,
    });
  }
  regenerateRecoveryCodes(input: ProfileCredentials): Promise<{ codes: string[] }> {
    return this.#request("/management-api/session/me/recovery-codes", "POST", input);
  }
  disableTotp(input: ProfileCredentials): Promise<void> {
    return this.#request<void>("/management-api/session/me/totp", "DELETE", input);
  }
  unlinkGoogle(input: ProfileCredentials): Promise<void> {
    return this.#request<void>("/management-api/session/me/google", "DELETE", input);
  }
  removePasskey(id: string, input: ProfileCredentials): Promise<void> {
    return this.#request<void>(
      `/management-api/session/me/passkeys/${encodeURIComponent(id)}`,
      "DELETE",
      input,
    );
  }

  completeAccountAction(
    token: string,
    purpose: "invitation" | "password_reset",
    password: string,
    pin?: string,
  ): Promise<{ personId: string; authenticated: boolean }> {
    return this.#request<{ personId: string; authenticated: boolean }>(
      "/management-api/account-actions/complete",
      "POST",
      {
        token,
        purpose,
        password,
        ...(pin === undefined ? {} : { pin }),
      },
    );
  }

  getEmailInbox(): Promise<EmailInbox> {
    return this.#request<EmailInbox>("/management-api/email", "GET");
  }

  getTestEmail(id: string): Promise<TestEmail> {
    return this.#request<TestEmail>(
      `/management-api/email/message/${encodeURIComponent(id)}`,
      "GET",
    );
  }

  /** `DELETE /management-api/session` — end the session. Answers an empty 204. */
  logout(): Promise<void> {
    return this.#request<void>("/management-api/session", "DELETE");
  }

  /** `GET /management-api/staff` — the full staff list (role, status, credential flags). */
  listStaff(): Promise<PersonSummary[]> {
    return this.#request<PersonSummary[]>("/management-api/staff", "GET");
  }

  /** Create a person with their required dashboard email and device PIN. */
  createPerson(input: {
    displayName: string;
    firstNames: string;
    lastNames: string;
    telephone: string | null;
    role: PersonRole;
    email: string;
  }): Promise<{ id: string; invitationSent: boolean }> {
    return this.#request<{ id: string; invitationSent: boolean }>(
      "/management-api/staff",
      "POST",
      input,
    );
  }

  resendInvitation(id: string): Promise<{ invitationSent: boolean }> {
    return this.#request<{ invitationSent: boolean }>(
      `/management-api/staff/${id}/invitation`,
      "POST",
    );
  }

  savePerson(id: string, details: PersonEditDetails): Promise<void> {
    return this.#request<void>(`/management-api/staff/${id}`, "PUT", details);
  }

  /** `POST /management-api/staff/:id/reset-pin` — set a person's new PIN. Answers an empty 204. */
  resetPin(id: string): Promise<void> {
    return this.#request<void>(`/management-api/staff/${id}/reset-pin`, "POST");
  }

  deactivatePerson(id: string): Promise<void> {
    return this.#request<void>(`/management-api/staff/${id}/deactivate`, "POST");
  }

  resetLogin(id: string): Promise<{ invitationSent: boolean }> {
    return this.#request<{ invitationSent: boolean }>(
      `/management-api/staff/${id}/reset-login`,
      "POST",
    );
  }

  reactivatePerson(id: string): Promise<{ invitationSent: boolean }> {
    return this.#request<{ invitationSent: boolean }>(
      `/management-api/staff/${id}/reactivate`,
      "POST",
    );
  }

  /**
   * `POST /management-api/passkey/register/options` — begin enrolling a passkey for the signed-in
   * operator (gated: the route resolves the person from the session). Takes no body; returns the
   * creation options for `startRegistration` plus the challenge handle its verify half echoes.
   */
  passkeyRegisterOptions(input: ProfileCredentials): Promise<PasskeyChallenge> {
    return this.#request<PasskeyChallenge>(
      "/management-api/passkey/register/options",
      "POST",
      input,
    );
  }

  /**
   * `POST /management-api/passkey/register/verify` — finish enrolling a passkey: the signed response
   * from `startRegistration` plus the handle from `passkeyRegisterOptions`. Answers `{ credentialId }`.
   */
  passkeyRegisterVerify(
    body: PasskeyVerification & { name?: string },
  ): Promise<{ credentialId: string }> {
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

  // ── Receipt-trim configuration ────────────────────────────────────────────────────────────────

  /**
   * `GET /management-api/receipt` — the authored receipt trim, or the server's `DEFAULT_RECEIPT` (`{}`)
   * when this tenant has never authored one (the route falls back server-side), so this never 404s.
   */
  getReceipt(): Promise<{ receipt: ReceiptConfig }> {
    return this.#request<{ receipt: ReceiptConfig }>("/management-api/receipt", "GET");
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

  /** `PATCH /management-api/stations/:id` — patch a station's mutable slice (name, order, active,
   * timing thresholds — NOT is_default, which only {@link setDefaultStation} flips). The three
   * `*AfterMinutes` fields (KDS order-timing alerts, design §8) travel as ONE group, mirroring the
   * route's own all-or-nothing validation: supplying one requires all three, strictly ordered
   * `warm < overdue < forgotten`, or the route rejects the whole patch with
   * `management.request_invalid`. Answers an empty 204. */
  updateStation(
    id: string,
    patch: {
      name?: string;
      displayOrder?: number;
      active?: boolean;
      warmAfterMinutes?: number;
      overdueAfterMinutes?: number;
      forgottenAfterMinutes?: number;
    },
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
  // The verbs the Devices screen drives against apps/server/src/device-api.ts, all device.manage-gated
  // server-side. `listDevices` reads the enrolled devices (newest first); `revokeDevice` deactivates a
  // device (an empty 204). A device is created by ACCEPTING a join request, not by minting a code —
  // see the join-request verbs below.

  /** `GET /management-api/devices` — this tenant's enrolled devices, newest-enrolled first (the server's
   * order; the screen does not re-sort). Each carries its bound station, active flag and last-seen time. */
  listDevices(): Promise<DeviceRow[]> {
    return this.#request<DeviceRow[]>("/management-api/devices", "GET");
  }

  // ── Pairing mode + join requests (device-join-and-accept) ────────────────────────────────────────
  // The seven verbs the Devices screen's join half drives (apps/server/src/join-api.ts). The window
  // routes and the device accept are `device.manage`-gated; list, challenge and deny take their
  // permission from the row's KIND, so this same set serves the printers screen's agent queue.

  /** `GET /management-api/pairing-mode` — the venue-wide window (design §1.1). */
  pairingMode(): Promise<PairingModeState> {
    return this.#request<PairingModeState>("/management-api/pairing-mode", "GET");
  }

  /** `POST /management-api/pairing-mode` — open the window, or move an open one's lapse to a fresh
   * window from now (the route is idempotent, so Extend and Open are the same call). */
  openPairingMode(): Promise<{ openUntil: string }> {
    return this.#request<{ openUntil: string }>("/management-api/pairing-mode", "POST");
  }

  /** `DELETE /management-api/pairing-mode` — shut the window (an empty 204). Requests already pending
   * stay pending and are still acceptable: the window admits an ask, it does not hold one open. */
  closePairingMode(): Promise<void> {
    return this.#request<void>("/management-api/pairing-mode", "DELETE");
  }

  /** `GET /management-api/join-requests?kind=` — one surface's pending queue. The rows carry NO
   * verification number (see {@link JoinRequestRow}); the list must never show the answer beside the
   * question, so nothing here fetches a challenge. */
  joinRequests(kind: "device" | "print_agent"): Promise<JoinRequestRow[]> {
    return this.#request<JoinRequestRow[]>(`/management-api/join-requests?kind=${kind}`, "GET");
  }

  /** `GET /management-api/join-requests/:id/challenge` — three two-digit numbers, shuffled, one of them
   * this request's. The server does not say which, and the set is fixed at join, so calling twice
   * teaches nothing. */
  joinChallenge(id: string): Promise<{ choices: string[] }> {
    return this.#request<{ choices: string[] }>(
      `/management-api/join-requests/${id}/challenge`,
      "GET",
    );
  }

  /** `POST /management-api/join-requests/:id/deny` — delete the request (an empty 204). */
  denyJoinRequest(id: string): Promise<void> {
    return this.#request<void>(`/management-api/join-requests/${id}/deny`, "POST");
  }

  /**
   * `POST /management-api/device-join-requests/:id/accept` — approve a device's ask with the number the
   * admin tapped, the profile they chose and the binding its form factor calls for (a `kds` profile
   * takes `stationId`, a handheld `registerId`, a till neither — the register is created server-side).
   *
   * A WRONG `choice` is not a rejected submission: the server has already deleted the request by the
   * time it answers `device.join_mismatch`, so that code is TERMINAL for this row (design §1.2) and the
   * caller must refresh rather than offer a second attempt.
   */
  acceptDeviceJoinRequest(
    id: string,
    input: { choice: string; profileId: string; stationId?: string; registerId?: string },
  ): Promise<{ deviceId: string; name: string; formFactor: FormFactor }> {
    return this.#request<{ deviceId: string; name: string; formFactor: FormFactor }>(
      `/management-api/device-join-requests/${id}/accept`,
      "POST",
      input,
    );
  }

  /** `POST /management-api/print-agent-join-requests/:id/accept` — approve a print agent's ask with the
   * number the admin tapped (an empty 204). The body is just `{ choice }` — an agent binds nothing, so
   * there is no profile or station to resolve.
   *
   * A WRONG `choice` is terminal: the server DELETED the request before answering `device.join_mismatch`
   * (the surface-neutral code, shared with the device accept), so the caller refreshes rather than
   * offering a second attempt. */
  acceptPrintAgentJoinRequest(id: string, input: { choice: string }): Promise<void> {
    return this.#request<void>(
      `/management-api/print-agent-join-requests/${id}/accept`,
      "POST",
      input,
    );
  }

  /** `GET /management-api/canvases` — this tenant's canvases (`till.configure`-gated server-side;
   * every role that reaches the Devices screen holds it). The server answers `{ canvases: [...] }`; this
   * unwraps to the array. Each canvas's `definition` is the opaque layout JSON — typed `unknown` here
   * because the dashboard's canvas PICKER needs only `{ id, name }`, and importing the real
   * `@waitron/layouts` definition type would drag that package's barrel + Node builtins into the browser
   * bundle (the #70 bundle rule the printing/till shapes follow). */
  listCanvases(): Promise<Canvas[]> {
    return this.#request<{ canvases: Canvas[] }>("/management-api/canvases", "GET").then(
      (r) => r.canvases,
    );
  }

  /** `GET /management-api/canvases/:id` — one canvas (definition is opaque `unknown`; parsed at the editor edge). */
  getCanvas(id: string): Promise<Canvas> {
    return this.#request<Canvas>(`/management-api/canvases/${id}`, "GET");
  }
  /** `POST /management-api/canvases` — create; returns the new id at 201. `definition` is a validated CanvasDef the server re-validates. */
  createCanvas(name: string, definition: unknown): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/canvases", "POST", { name, definition });
  }
  /** `PUT /management-api/canvases/:id` — full replace; 204. */
  updateCanvas(id: string, name: string, definition: unknown): Promise<void> {
    return this.#request<void>(`/management-api/canvases/${id}`, "PUT", { name, definition });
  }
  /** `DELETE /management-api/canvases/:id` — 204; a since-deleted id rejects `canvas.not_found`. */
  deleteCanvas(id: string): Promise<void> {
    return this.#request<void>(`/management-api/canvases/${id}`, "DELETE");
  }

  // ── Device profiles ──────────────────────────────────────────────────────────────────────────────
  // The five verbs the Device-profiles screen drives, all `till.configure`-gated server-side (the
  // management-api.ts device-profile routes). Mirrors the canvas CRUD above; the list unwraps
  // `{ deviceProfiles: [...] }`, create/update return the stored row, delete answers 204.

  /** `GET /management-api/device-profiles` — this tenant's device profiles. The server answers
   * `{ deviceProfiles: [...] }`; this unwraps to the array. */
  listDeviceProfiles(): Promise<DeviceProfile[]> {
    return this.#request<{ deviceProfiles: DeviceProfile[] }>(
      "/management-api/device-profiles",
      "GET",
    ).then((r) => r.deviceProfiles);
  }

  /** `GET /management-api/device-profiles/:id` — one profile, or `device_profile.not_found` (404). */
  getDeviceProfile(id: string): Promise<DeviceProfile> {
    return this.#request<DeviceProfile>(`/management-api/device-profiles/${id}`, "GET");
  }

  /** `POST /management-api/device-profiles` — create; returns the stored row at 201. A duplicate name
   * rejects `device_profile.name_taken` (409); a bad capability set or canvas reference rejects
   * `device_profile.invalid` (400). `canvasId` `null` = the form-factor default. */
  createDeviceProfile(
    name: string,
    canvasId: string | null,
    capabilities: string[],
    formFactor: FormFactor,
    inactivityTimeoutSeconds: number | null,
  ): Promise<DeviceProfile> {
    return this.#request<DeviceProfile>("/management-api/device-profiles", "POST", {
      name,
      canvasId,
      capabilities,
      formFactor,
      inactivityTimeoutSeconds,
    });
  }

  /** `PUT /management-api/device-profiles/:id` — full replace; returns the stored row (200). A
   * since-deleted id rejects `device_profile.not_found` (404). */
  updateDeviceProfile(
    id: string,
    name: string,
    canvasId: string | null,
    capabilities: string[],
    formFactor: FormFactor,
    inactivityTimeoutSeconds: number | null,
  ): Promise<DeviceProfile> {
    return this.#request<DeviceProfile>(`/management-api/device-profiles/${id}`, "PUT", {
      name,
      canvasId,
      capabilities,
      formFactor,
      inactivityTimeoutSeconds,
    });
  }

  /** `DELETE /management-api/device-profiles/:id` — 204; a since-deleted id rejects
   * `device_profile.not_found`. */
  deleteDeviceProfile(id: string): Promise<void> {
    return this.#request<void>(`/management-api/device-profiles/${id}`, "DELETE");
  }

  /** `POST /management-api/devices/:id/revoke` — revoke a device (flip `active = false`, instant): the
   * device's cookie stops validating at once. Answers an empty 204; an unknown id rejects
   * `{ code: "device.not_found" }`. Never a hard delete — a device is a durable identity. */
  revokeDevice(id: string): Promise<void> {
    return this.#request<void>(`/management-api/devices/${id}/revoke`, "POST");
  }

  /** `POST /management-api/devices/:id/assign-device-profile` — reassign (or clear) a device's device
   * profile (device.manage-gated): `deviceProfileId` a tenant device profile's id, or `null` to fall back
   * to the form-factor default. Answers an empty 204; an unknown device rejects
   * `{ code: "device.not_found" }`. A UUID-shaped id that names no device profile of this tenant (unknown
   * or foreign) reaches the composite FK and rejects `{ code: "device.binding_invalid" }`; a MALFORMED
   * (non-UUID) id is screened earlier and rejects `{ code: "management.request_invalid" }`. The dashboard
   * only ever sends a real device-profile id or `null`, so those two rejects are defense-in-depth. */
  reassignDeviceProfile(id: string, deviceProfileId: string | null): Promise<void> {
    return this.#request<void>(`/management-api/devices/${id}/assign-device-profile`, "POST", {
      deviceProfileId,
    });
  }

  /** `PATCH /management-api/devices/:id/hardware` — set a device's static hardware bindings (SP-A.2
   * §16.3, device.manage-gated): its receipt printer (`receiptPrinterId`, a tenant printer's id or
   * `null` to clear) and cash-drawer flag (`hasCashDrawer`). Only a NAMED field is written. Returns the
   * updated device's hardware (200). A `receiptPrinterId` naming no printer of this tenant rejects
   * `{ code: "device.binding_invalid" }`; an unknown device rejects `{ code: "device.not_found" }`
   * (404). (The card reader default lives in `device_card_readers`, not on the device.) */
  patchDeviceHardware(
    id: string,
    patch: {
      receiptPrinterId?: string | null;
      hasCashDrawer?: boolean;
    },
  ): Promise<{
    id: string;
    receiptPrinterId: string | null;
    hasCashDrawer: boolean;
  }> {
    return this.#request(`/management-api/devices/${id}/hardware`, "PATCH", patch);
  }

  // ── Printing (print agents + printers + jobs) ────────────────────────────────────────────────────
  // The verbs the Impresoras screen drives, gated by printer.manage, with print.resend for resends (the print-api.ts
  // management routes). Agents: `listAgents` reads the enrolled agents (newest first); `revokeAgent`
  // deactivates an agent and `allowAgent` reverses that (each 204). A print agent JOINS through the
  // shared join-and-accept mechanism above
  // (`joinRequests("print_agent")` / `joinChallenge` / `denyJoinRequest` / `acceptPrintAgentJoinRequest`),
  // not a pairing code — though some agents self-enrolled silently on their own node (hence the `nodeId`
  // provenance the list now carries), a path the dashboard never drives; it only drives the knock.
  // Printers: `listPrinters`/`createPrinter`/`updatePrinter`/`deactivatePrinter` are
  // the config CRUD (create returns the minted id at 201; patch/deactivate answer an empty 204).
  // `listRecentJobs` is the status read; `testPrint` enqueues a known diagnostic payload (202).
  // Paths/bodies against apps/server/src/print-api.ts.

  /** `GET /management-api/print-agents` — this tenant's enrolled print agents, newest-enrolled first
   * (the server's order). Each carries its active flag and last-seen time; the token hash never leaves. */
  listAgents(): Promise<PrintAgentRow[]> {
    return this.#request<PrintAgentRow[]>("/management-api/print-agents", "GET");
  }

  updateAgent(id: string, patch: { name: string }): Promise<void> {
    return this.#request<void>(`/management-api/print-agents/${id}`, "PATCH", patch);
  }

  /** `POST /management-api/print-agents/:id/revoke` — revoke a print agent (flip `active = false`,
   * instant): a revoked agent fails `requireAgent` at once. Answers an empty 204; an unknown id rejects
   * `{ code: "agent.not_found" }`. Never a hard delete — an agent is a durable identity. */
  revokeAgent(id: string): Promise<void> {
    return this.#request<void>(`/management-api/print-agents/${id}/revoke`, "POST");
  }

  /** `POST /management-api/print-agents/:id/allow` — reverse a revoke (flip `active = true`): the agent
   * passes `requireAgent` again at once. Answers an empty 204; an unknown id rejects
   * `{ code: "agent.not_found" }`. The inverse of `revokeAgent`. */
  allowAgent(id: string): Promise<void> {
    return this.#request<void>(`/management-api/print-agents/${id}/allow`, "POST");
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

  /** `POST /management-api/printer-discovery/start` — open the venue's short discovery window so the
   * agents run their active scans (LAN/mDNS sweep for IP, Bluetooth inquiry) and report what they find.
   * Returns the window's end (`discoveryUntil`, epoch ms). The screen then reads {@link
   * listDiscoveredPrinters} to show the results. */
  startPrinterDiscovery(): Promise<{ discoveryUntil: number }> {
    return this.#request<{ discoveryUntil: number }>(
      "/management-api/printer-discovery/start",
      "POST",
    );
  }

  /** `GET /management-api/discovered-printers` — the merged in-memory list of devices the agents
   * currently see (always-on USB/BT presence) or found in an open discovery window.
   * Each carries the registered printer it matches (`printerId`, on the local key or on host:port) and
   * when it was last reported (`lastSeenAt`): the create table lists only the unmatched ones, and the
   * registered list shows the seen-status against the matched printer. */
  listDiscoveredPrinters(): Promise<DiscoveredPrinter[]> {
    return this.#request<DiscoveredPrinter[]>("/management-api/discovered-printers", "GET");
  }

  /** `PATCH /management-api/printers/:id` — patch a printer's mutable slice (name, transport,
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

  resendPrintJob(id: string): Promise<{ jobId: string }> {
    return this.#request<{ jobId: string }>(`/management-api/print-jobs/${id}/resend`, "POST");
  }

  getPrintJobPreview(id: string): Promise<PrintJobPreview> {
    return this.#request<PrintJobPreview>(`/management-api/print-jobs/${id}/preview`, "GET");
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
   *
   * Module gating (SP2 Task 4): the response also carries the signed-in person's effective
   * `permissions` (a hint set) and the enabled `modules`; the shell shows a module's nav/screen only
   * when the module is enabled AND its permission is in this set.
   */
  getMe(): Promise<{
    personId: string;
    role: PersonRole;
    email: string | null;
    locale: string | null;
    venueLocale: string;
    permissions: string[];
    modules: string[];
    venueName: string;
    onboardingIntent?: "demo" | "prepare" | "live";
    sessionExpiresInSeconds?: number;
    sessionIdleTimeoutSeconds?: number;
  }> {
    return this.#request<{
      personId: string;
      role: PersonRole;
      email: string | null;
      locale: string | null;
      venueLocale: string;
      permissions: string[];
      modules: string[];
      venueName: string;
      onboardingIntent?: "demo" | "prepare" | "live";
      sessionExpiresInSeconds?: number;
      sessionIdleTimeoutSeconds?: number;
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

  /** `GET /management-api/reports/overdue-orders` — this node's currently-open orders whose worst
   * unserved line is `overdue`/`forgotten`, worst-first (KDS order-timing alerts, design §7.4). A live
   * snapshot, not a business-day query. Backs `dashboard-overview-screen`'s poll-on-an-interval tile. */
  getOverdueOrders(): Promise<{ orders: OverdueOrder[] }> {
    return this.#request<{ orders: OverdueOrder[] }>(
      "/management-api/reports/overdue-orders",
      "GET",
    );
  }

  /** `GET /management-api/diagnostics/recent?limit=` — the node's most recent structured log lines,
   * newest last (`limit` caps how many, default 200). Backs the diagnostics viewer's log pane. */
  getRecentLogs(limit = 200): Promise<{ lines: DiagnosticsLine[] }> {
    return this.#request<{ lines: DiagnosticsLine[] }>(
      `/management-api/diagnostics/recent?limit=${limit}`,
      "GET",
    );
  }

  /** `GET /management-api/diagnostics/verbosity` — the node's current log level and any pending
   * revert (see {@link Verbosity}). Backs the diagnostics viewer's verbosity control. */
  getVerbosity(): Promise<Verbosity> {
    return this.#request<Verbosity>("/management-api/diagnostics/verbosity", "GET");
  }

  /** `POST /management-api/diagnostics/verbosity` — raise (or restore) the node's log level for
   * `ttlMinutes` minutes, after which it reverts to the standing default. */
  setVerbosity(level: "debug" | "info", ttlMinutes: number): Promise<void> {
    return this.#request<void>("/management-api/diagnostics/verbosity", "POST", {
      level,
      ttlMinutes,
    });
  }

  // ── Backup admin (recovery-key wizard) ────────────────────────────────────────────────────────

  /** `GET /api/backup/status` — the running backup duty, projected without the recovery key (see
   * {@link BackupStatusView}). Backs the always-available status view. */
  getBackupStatus(): Promise<BackupStatusView> {
    return this.#request<BackupStatusView>("/api/backup/status", "GET");
  }

  /** Download the encrypted, configuration-only preparation artifact. The ordinary request helper
   * parses JSON, so this binary response keeps its own small fetch path. */
  async exportConfiguration(passphrase: string): Promise<Blob> {
    const response = await this.#fetch(`${this.#baseUrl}/management-api/configuration-export`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });
    if (!response.ok) {
      let code = "server.internal";
      try {
        const body = JSON.parse(await response.text()) as { error?: { code?: unknown } };
        if (typeof body.error?.code === "string") code = body.error.code;
      } catch {
        // The same fallback as the JSON request helper for a malformed error response.
      }
      throw { code };
    }
    return response.blob();
  }

  /** `POST /api/backup/mint-key` — mint a strong recovery key for the operator to record. Stateless:
   * mints and returns, stores nothing (`apply` is what persists a chosen key). */
  mintBackupKey(): Promise<{ key: string }> {
    return this.#request<{ key: string }>("/api/backup/mint-key", "POST");
  }

  /** `POST /api/backup/apply` — configure + enable backups from the wizard; returns the fresh status.
   * Rejects with a `backup.*` `{ code }` (env-managed, non-primary, an unstorable/too-short key, a bad
   * schedule/destination) the screen surfaces via `codeMessage`. */
  applyBackup(body: BackupApplyBody): Promise<BackupStatusView> {
    return this.#request<BackupStatusView>("/api/backup/apply", "POST", body);
  }

  /** `GET /api/backup/recovery-key` — the EFFECTIVE running recovery key so an admin can re-record it
   * (the rotate screen re-shows the OLD key before changing it). `null` when no backup is configured. */
  getBackupRecoveryKey(): Promise<{ key: string | null }> {
    return this.#request<{ key: string | null }>("/api/backup/recovery-key", "GET");
  }

  /** `POST /api/backup/rotate` — change the recovery key, reusing the running destination/schedule/
   * retention; returns the fresh status. Archives taken before the rotate still need the OLD key. */
  rotateBackupKey(body: { recoveryKey: string }): Promise<BackupStatusView> {
    return this.#request<BackupStatusView>("/api/backup/rotate", "POST", body);
  }

  // ── Card payments (providers + readers) ──────────────────────────────────────────────────────────
  // The verbs the generic Payments screen drives, all payments.manage-gated server-side
  // (`apps/server/src/payments-api.ts`). The per-provider connect + add-reader forms are NOT here — a
  // provider's own panel (`CARD_PROVIDER_PANELS`) owns those and talks to the routes through the shared
  // request primitive — so the screen's client covers only the provider-neutral reads and actions:
  // list providers/readers, a reader's lazy status, disconnect a provider, retire a reader.

  /** `GET /management-api/payments/providers` — every card provider and its connection state. */
  listPaymentProviders(): Promise<PaymentProviderRow[]> {
    return this.#request<PaymentProviderRow[]>("/management-api/payments/providers", "GET");
  }

  /** `POST /management-api/payments/providers/:id/connect` — verify the typed credential, seal it,
   * return the merchant name to confirm (NEVER a secret). The generic screen does not call this; a
   * provider's connect panel does. Kept for a complete client surface. */
  connectPaymentProvider(
    id: string,
    payload: Record<string, string>,
  ): Promise<{ merchantName: string }> {
    return this.#request<{ merchantName: string }>(
      `/management-api/payments/providers/${id}/connect`,
      "POST",
      payload,
    );
  }

  /** `POST /management-api/payments/providers/:id/disconnect` — drop the sealed credential. Answers an
   * empty 204; rejects `{ code: "payment.provider_in_use" }` while any active reader still uses it (the
   * operator retires those first), `{ code: "payment.provider_unknown" }` on a bad id. */
  disconnectPaymentProvider(id: string): Promise<void> {
    return this.#request<void>(`/management-api/payments/providers/${id}/disconnect`, "POST");
  }

  /** `GET /management-api/payments/readers` — this tenant's card readers by name (active AND retired,
   * so the surface can show a retired one). Each carries its provider, active flag and device count. */
  listReaders(): Promise<ReaderRow[]> {
    return this.#request<ReaderRow[]>("/management-api/payments/readers", "GET");
  }

  /** `POST /management-api/payments/readers` — add a reader (create returns the minted id + status at
   * 201). The generic screen does not call this; a provider's add-reader panel does. Kept for a
   * complete client surface. */
  addReader(input: AddReaderInput): Promise<{ id: string; status: string }> {
    return this.#request<{ id: string; status: string }>(
      "/management-api/payments/readers",
      "POST",
      input,
    );
  }

  /** `GET /management-api/payments/readers/:id/status` — a reader's live status, loaded lazily per row.
   * An unknown/foreign reader rejects `{ code: "reader.not_found" }`. */
  readerStatus(id: string): Promise<ReaderStatusView> {
    return this.#request<ReaderStatusView>(`/management-api/payments/readers/${id}/status`, "GET");
  }

  /** `POST /management-api/payments/readers/:id/retire` — retire a reader (soft: `active = false`,
   * the row is KEPT so historical payments still resolve its name). Answers an empty 204; an
   * unknown/already-retired id rejects `{ code: "reader.not_found" }`. */
  retireReader(id: string): Promise<void> {
    return this.#request<void>(`/management-api/payments/readers/${id}/retire`, "POST");
  }

  /** `GET /management-api/payments/devices/:id/reader` — device `id`'s default reader (from
   * `device_card_readers`, not a device-hardware field), or `null` when none is set. */
  getDeviceReader(id: string): Promise<{ readerId: string | null }> {
    return this.#request<{ readerId: string | null }>(
      `/management-api/payments/devices/${id}/reader`,
      "GET",
    );
  }

  /** `PUT /management-api/payments/devices/:id/reader` — set device `id`'s default reader, or clear it
   * with `readerId: null`. Answers an empty 204; a foreign, retired or unknown reader id rejects
   * `{ code: "reader.not_found" }`. */
  setDeviceReader(id: string, readerId: string | null): Promise<void> {
    return this.#request<void>(`/management-api/payments/devices/${id}/reader`, "PUT", {
      readerId,
    });
  }
}
