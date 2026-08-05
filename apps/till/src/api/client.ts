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

/** The subset of `fetch` this client uses; the global satisfies it, and a test injects a stub. */
export type FetchLike = typeof fetch;

/** `GET /api/till` — the public boot info the app reads before login. */
export interface TillInfo {
  locale: string;
  venueName: string;
  nif: string;
}

/** One `GET /api/staff` roster entry — no PIN, role or status (the server strips them). */
export interface StaffMember {
  personId: string;
  displayName: string;
}

/** `POST /api/session` success — who is now logged in. */
export interface SessionResult {
  personId: string;
}

/** One VAT band on a ticket: a rate and its taxable base + tax, as decimal strings. */
export interface VatBreakdownEntry {
  rate: string;
  base: string;
  tax: string;
}

/** One sellable product from `GET /api/products` (mirrors catalogue's `AvailableProduct`). */
export interface TillProduct {
  id: string;
  descriptions: Record<string, string>;
  pricingUnit: "each" | "weight";
  unitPrice: string;
  vatClass: "general" | "reduced" | "super_reduced" | "zero";
  category: string | null;
}

/** One basket line the till sends to `POST /api/sales`: never a price — the server re-prices. */
export interface SaleLine {
  productId: string;
  quantity: string;
}

/** The single cash tender slice 1 supports. */
export interface CashTender {
  method: "cash";
  amount: string;
}

/** `POST /api/sales` success — the ticket payload the receipt view renders. */
export interface TillSaleResult {
  invoiceNumber: string;
  issuedAt: string;
  total: string;
  vatBreakdown: VatBreakdownEntry[];
  change: string;
  qr: string;
}

export class TillApi {
  readonly #baseUrl: string;
  readonly #fetchImpl: FetchLike;

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

  listStaff(): Promise<StaffMember[]> {
    return this.#request<StaffMember[]>("/api/staff", "GET");
  }

  login(personId: string, pin: string): Promise<SessionResult> {
    return this.#request<SessionResult>("/api/session", "POST", { personId, pin });
  }

  async logout(): Promise<void> {
    await this.#request<{ ok: boolean }>("/api/session", "DELETE");
  }

  listProducts(): Promise<TillProduct[]> {
    return this.#request<TillProduct[]>("/api/products", "GET");
  }

  recordSale(lines: SaleLine[], tender: CashTender): Promise<TillSaleResult> {
    return this.#request<TillSaleResult>("/api/sales", "POST", { lines, tender });
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
    return (await res.json()) as T;
  }
}
