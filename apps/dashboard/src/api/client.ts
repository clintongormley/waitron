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
 * form OMITS the key for a PENDING declaration. `image` omitted leaves it null.
 */
export interface ProductInput {
  catalogueId: string;
  categoryId: string | null;
  descriptions: Record<string, string>;
  pricingUnit: PricingUnit;
  unitPrice: string;
  vatClass: VatClass;
  allergens?: Record<string, AllergenEntry>;
  image?: string | null;
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
