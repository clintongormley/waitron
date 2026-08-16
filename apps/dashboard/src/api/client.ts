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

/** One `GET /management-api/staff-roster` entry — the pre-login picker list, no role or status. */
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
}

/**
 * The `PATCH /management-api/products/:id` body — the mutable slice, mirrors catalogue's
 * `UpdateProductInput`. Every key is optional; an absent key is left unchanged. `allergens: null`
 * clears the declaration back to unreviewed, `image: null` clears the photo, and `active` toggles the
 * product active/inactive through this one route.
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
}

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

/** The subset of `fetch` this client uses; the global satisfies it, and a test injects a stub. */
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class DashboardApi {
  readonly #baseUrl: string;
  readonly #fetchImpl: FetchLike;

  /**
   * @param baseUrl prefixed to every path (default `""`: same-origin, so the browser fetches
   *   `/management-api/...` from the origin serving the app).
   * @param fetchImpl the `fetch` to use (default the global; a test injects a stub).
   */
  constructor(baseUrl = "", fetchImpl: FetchLike = fetch) {
    this.#baseUrl = baseUrl;
    this.#fetchImpl = fetchImpl;
  }

  /** `GET /management-api/staff-roster` — the pre-login person picker (id + display name only). */
  getStaffRoster(): Promise<RosterEntry[]> {
    return this.#request<RosterEntry[]>("/management-api/staff-roster", "GET");
  }

  /**
   * `POST /management-api/session` — log in with a password (and an optional TOTP second factor).
   * Returns who is now logged in; a bad credential rejects with the server's `{ code }`.
   */
  login(input: {
    personId: string;
    password: string;
    totp?: string;
  }): Promise<{ personId: string }> {
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

  /** `POST /management-api/staff` — create a person with a starting role and PIN; returns its id. */
  createPerson(input: {
    displayName: string;
    role: PersonRole;
    pin: string;
  }): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/staff", "POST", input);
  }

  /**
   * `PATCH /management-api/staff/:id` — change a person's role and/or active status. Answers an
   * empty 204.
   */
  updatePerson(
    id: string,
    patch: { role?: PersonRole; status?: "active" | "suspended" },
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
   */
  getMe(): Promise<{ personId: string; role: PersonRole }> {
    return this.#request<{ personId: string; role: PersonRole }>(
      "/management-api/session/me",
      "GET",
    );
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
