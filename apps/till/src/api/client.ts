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
  venueName: string;
  nif: string;
  orderFlow: OrderFlow;
  cardProvider: "none" | "stripe_terminal" | "stripe_on_device";
  tipsEnabled: boolean;
  layout: LayoutDef;
  receipt: ReceiptConfig;
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
  /**
   * EU-14 allergen declaration; null = not reviewed. Keyed by allergen code (menu & allergens). A
   * LOCAL redefinition of catalogue's `ProductAllergens` shape, deliberately NOT imported from
   * `@waitron/catalogue` — same bundle-decoupling rationale as every other type in this file (see the
   * file header). `presence` is the contains/may-contain strength; `source` names the specific
   * substance ("wheat", "almendra") when known. Task 6 renders these on the allergen screen.
   */
  allergens: Record<string, { presence: "contains" | "may_contain"; source?: string }> | null;
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
