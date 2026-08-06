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

/** `POST /api/sales` success — the ticket payload the receipt view renders. */
export interface TillSaleResult {
  invoiceNumber: string;
  issuedAt: string;
  total: string;
  vatBreakdown: VatBreakdownEntry[];
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
 * One order's kitchen-prep state (7c, design §5). Mirrors the server's `PrepState`
 * (`apps/server/src/working-order.ts`, derived from `@waitron/db`'s `prep_state` enum). An order
 * enters at `queued` (placing, for Modes I/T, or `sendToPrep` for Mode P) and advances one step at a
 * time; `collected` never appears in `GET /api/prep-queue` (see {@link PrepQueueEntry}).
 */
export type PrepState = "queued" | "preparing" | "ready" | "collected";

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
 * One row of `GET /api/prep-queue` (7c) — an order still ACTIVE in prep on this node (queued,
 * preparing or ready). `collected` orders never appear: `listPrepQueue` excludes them server-side, so
 * an order drops off the till's queue the moment its last advance lands. Mirrors the server's
 * `PrepQueueEntry`; `queuedAt` is when the order FIRST entered prep, not when it reached its current
 * `state`.
 */
export interface PrepQueueEntry {
  id: string;
  orderNumber: number;
  label: string | null;
  state: PrepState;
  queuedAt: string;
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
   * Advance an order's prep state one step (7c, design §5) → `POST /api/working-orders/:id/prep` with
   * `{ to }`. Only the NEXT state in `queued → preparing → ready → collected` is legal; any other
   * target (or an id with no active prep row) rejects with `{ code: "order_prep.invalid_transition" }`.
   * The server answers an empty 200; re-read `listPrepQueue` for the new state.
   */
  async advancePrep(id: string, to: PrepState): Promise<void> {
    await this.#request<void>(`/api/working-orders/${id}/prep`, "POST", { to });
  }

  /**
   * Enqueue a SETTLED order into the node's prep queue at `queued` (7c, design §5) → the same
   * `POST /api/working-orders/:id/prep` route as {@link advancePrep}, with no `to` — the Mode-P
   * pickup for an order that pays at order and so never places (Modes I/T enqueue automatically when
   * `placeOrder` runs). A non-settled or already-queued id rejects `{ code: "order_prep.invalid_transition" }`.
   */
  async sendToPrep(id: string): Promise<void> {
    await this.#request<void>(`/api/working-orders/${id}/prep`, "POST", {});
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

  /**
   * The node-scoped prep queue (7c, design §5) → `GET /api/prep-queue`. Every order still active in
   * prep on this node (queued/preparing/ready), oldest first; a collected order has already dropped
   * off (see {@link PrepQueueEntry}).
   */
  listPrepQueue(): Promise<PrepQueueEntry[]> {
    return this.#request<PrepQueueEntry[]>("/api/prep-queue", "GET");
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
