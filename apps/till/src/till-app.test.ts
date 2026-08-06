import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTicketView } from "./screens/till-ticket-view.js";
import type { HeldOrderSummary, TillApi, TillProduct, TillSaleResult } from "./api/client.js";
import type { WorkingOrderStore } from "./state/working-order.js";

const cafe: TillProduct = {
  id: "cafe",
  descriptions: { "es-ES": "Café" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
};

const jamon: TillProduct = {
  id: "jamon",
  descriptions: { "es-ES": "Jamón" },
  pricingUnit: "weight",
  unitPrice: "10.00",
  vatClass: "reduced",
  category: "charcutería",
};

const heldSummary: HeldOrderSummary = {
  id: "wo-1",
  orderNumber: 5,
  label: "Mesa 4",
  itemCount: 2,
  total: "3.00",
  openedAt: "2026-08-05T10:00:00.000Z",
};

const saleResult: TillSaleResult = {
  invoiceNumber: "F-0001",
  issuedAt: "2026-08-05T10:00:00.000Z",
  total: "3.00",
  vatBreakdown: [{ rate: "21", base: "2.48", tax: "0.52" }],
  change: "2.00",
  qr: "https://example.test/vf?nif=B1&num=F-0001&fecha=05-08-2026&total=3.00",
};

const till = { locale: "es-ES", venueName: "Bar Pepe", nif: "B12345678" };

/**
 * A fake `TillApi` covering every method the app (and the lock screen it mounts) calls. Each defaults
 * to a resolved value; a test overrides any with its own `vi.fn()`. Cast through `unknown` because the
 * app touches only this method surface, never the rest of the class.
 */
function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    getTill: vi.fn().mockResolvedValue(till),
    listStaff: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ana" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    listProducts: vi.fn().mockResolvedValue([cafe]),
    recordSale: vi.fn().mockResolvedValue(saleResult),
    parkOrder: vi.fn().mockResolvedValue({ id: "wo-1", orderNumber: 5 }),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    retrieveWorkingOrder: vi.fn().mockResolvedValue({
      id: "wo-1",
      orderNumber: 5,
      label: "Mesa 4",
      lines: [{ productId: "cafe", quantity: "2.000" }],
    }),
    abandonWorkingOrder: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
}

/** Drains the microtask queue (settling awaited API promises + chained awaits) then Lit's render. */
async function flush(el: TillApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const lock = (el: TillApp) => el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen");
const counter = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen");
const ticket = (el: TillApp) => el.shadowRoot!.querySelector<TillTicketView>("till-ticket-view");

/** Fires a composed, bubbling CustomEvent from `source` — the shape every till screen emits. */
function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

/** Boots the app, settles boot, and logs a person in — leaving the app on the counter. */
async function toCounter(el: TillApp): Promise<TillCounterScreen> {
  await flush(el);
  emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana" });
  await flush(el);
  return counter(el)!;
}

let currentApi: TillApi;
async function mountApp(overrides: Record<string, unknown> = {}) {
  currentApi = stubApi(overrides);
  return mountWidget<TillApp>("till-app", { api: currentApi });
}

beforeEach(() => setLocale("es-ES"));
afterEach(cleanupWidgets);

describe("till-app", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-app")).toBe(TillApp);
  });

  it("starts on the lock screen", async () => {
    const { el } = await mountApp();
    await flush(el);
    expect(lock(el)).not.toBeNull();
    expect(counter(el)).toBeNull();
    expect(ticket(el)).toBeNull();
  });

  it("boots: getTill sets the active locale", async () => {
    // getTill returns a locale that differs from the es-ES default, so the change is observable.
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, locale: "en" }),
    });
    await flush(el);
    expect(currentApi.getTill).toHaveBeenCalledOnce();
    expect(currentLocale()).toBe("en");
  });

  it("logs in: fetches products, shows the counter with the operator name", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    expect(currentApi.listProducts).toHaveBeenCalledOnce();
    expect(lock(el)).toBeNull();
    expect(c).not.toBeNull();
    expect(c.products).toEqual([cafe]);
    expect(c.operatorName).toBe("Ana");
  });

  it("confirm-payment: records the sale with the mapped lines + tender, then shows the ticket", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "2");
    await el.updateComplete;
    const workingOrderId = store.id; // the walk-up's STABLE client-minted id — the pay-idempotency key

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [{ productId: "cafe", quantity: "2" }],
      { method: "cash", amount: "5" },
      // The workingOrderId sent is the store's stable id, NOT a fresh uuid, so a lost-response re-tap
      // replays and a retrieved order settles under its own id (see the retrieve→pay and retry tests
      // below). A `expect.any(String)` here was satisfied by the old `crypto.randomUUID()` bug.
      workingOrderId,
    );
    const view = ticket(el)!;
    expect(view).not.toBeNull();
    expect(view.result).toBe(saleResult);
    expect(view.issuer).toEqual({ venueName: "Bar Pepe", nif: "B12345678" });
    // the ticket carries the line snapshot taken at pay time
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]!.product).toBe(cafe);
    expect(view.lines[0]!.quantity).toBe("2");
  });

  it("confirm-payment: a CARD tender forwards intact (method, amount, externalRef) with the store's stable id", async () => {
    // Task 2 widened ConfirmPaymentDetail/Tender to the cash|card union and Task 3's #onConfirmPayment
    // forwards whichever tender the widget emits without branching — this pins that a CARD tender
    // reaches recordSale UNCHANGED (method still "card", externalRef still present, never dropped) and
    // keyed under the store's own stable working-order id, exactly like the cash test above. Mutating
    // #onConfirmPayment to send only `{ method: tender.method, amount: tender.amount }` (dropping
    // externalRef) or to send `crypto.randomUUID()` instead of `this.#store.id` both fail this test —
    // the exact-object + exact-id assertions below are what make it load-bearing rather than a type-only
    // check.
    const { el } = await mountApp();
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "1");
    await el.updateComplete;
    const workingOrderId = store.id; // the walk-up's STABLE client-minted id — the pay-idempotency key

    emit(c, "confirm-payment", { method: "card", amount: "1.50", externalRef: "OP-42" });
    await flush(el);

    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [{ productId: "cafe", quantity: "1" }],
      { method: "card", amount: "1.50", externalRef: "OP-42" },
      workingOrderId,
    );
    const view = ticket(el)!;
    expect(view).not.toBeNull();
    expect(view.result).toBe(saleResult);
  });

  it("confirm-payment success: refreshes the held-orders list so a just-paid parked order drops off", async () => {
    // The Minor review finding: paying a RETRIEVED parked order must drop it off the cross-till held
    // list immediately, like park/retrieve/discard already do. `listWorkingOrders` returns the order
    // first, then an empty list after it is settled — so a successful pay re-reads and the settled
    // order is gone. Removing the new `#refreshHeldOrders()` on the success path fails this (one call,
    // not two — the order lingers in the in-memory list until the next park/retrieve/discard).
    const { el } = await mountApp({
      listWorkingOrders: vi.fn().mockResolvedValueOnce([heldSummary]).mockResolvedValue([]),
    });
    const c = await toCounter(el);
    expect(c.heldOrders).toEqual([heldSummary]); // one call on entering the counter
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    // once on entering the counter, once after the successful pay — the settled order drops off.
    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
    expect(ticket(el)).not.toBeNull(); // the sale still filed and the ticket still shows

    // Returning to the counter ("New sale") shows the refreshed (now empty) list, not the stale one —
    // the app's held state was updated to [] by the pay refresh, so the re-rendered counter reads it.
    emit(ticket(el)!, "new-sale");
    await flush(el);
    expect(counter(el)!.heldOrders).toEqual([]);
  });

  it("threads the invoice locale from getTill through to the ticket", async () => {
    // getTill's locale drives the RECEIPT locale (till-ticket-view.invoiceLocale), threaded from the
    // server till config — separately from the operator-UI setLocale. Use a locale that differs from
    // the es-ES default so the wiring is observable.
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, locale: "en" }),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(ticket(el)!.invoiceLocale).toBe("en");
  });

  it("retrieve then pay: recordSale settles under the RETRIEVED order's own id, not a fresh one", async () => {
    // The Critical fix: paying a retrieved order must send that order's adopted id (wo-1), so the
    // server takes the pay-the-parked-order branch and settles it. The pre-fix `crypto.randomUUID()`
    // sent a random id → the walk-up branch → wo-1 left `open` and re-payable → double-charge + a
    // second unrepairable chained record. `retrieveWorkingOrder` defaults to id "wo-1" + a cafe line.
    const { el } = await mountApp();
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(store.id).toBe("wo-1"); // loadFrom adopted the retrieved order's id

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    // the adopted id is the pay-idempotency key — this FAILS against the pre-fix random-uuid line.
    expect(currentApi.recordSale).toHaveBeenCalledWith(
      [{ productId: "cafe", quantity: "2" }],
      { method: "cash", amount: "5" },
      "wo-1",
    );
  });

  it("walk-up pay retry: a re-tapped confirm sends the SAME store id (idempotent replay, never two ids)", async () => {
    // A lost pay response then an operator re-tap must replay against the same working-order id, not
    // mint a second one — otherwise a second POST /api/sales files a second chained fiscal record
    // (spec §3: the client holds the id stable across retries). The first attempt rejects (response
    // lost); the re-tap succeeds. Both must carry the identical store id.
    const recordSale = vi
      .fn()
      .mockRejectedValueOnce({ code: "sale.rejected" })
      .mockResolvedValueOnce(saleResult);
    const { el } = await mountApp({ recordSale });
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "2");
    await el.updateComplete;
    const stableId = store.id;

    emit(c, "confirm-payment", { method: "cash", amount: "5" }); // first — rejects, basket intact
    await flush(el);
    emit(c, "confirm-payment", { method: "cash", amount: "5" }); // re-tap — succeeds
    await flush(el);

    expect(recordSale).toHaveBeenCalledTimes(2);
    // the SAME id both times (not two random uuids) — a re-tap replays rather than double-files.
    expect(recordSale.mock.calls[0]![2]).toBe(stableId);
    expect(recordSale.mock.calls[1]![2]).toBe(stableId);
  });

  it("new-sale: clears the basket and returns to an empty counter", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "2");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    emit(ticket(el)!, "new-sale");
    await flush(el);

    expect(counter(el)).not.toBeNull();
    expect(ticket(el)).toBeNull();
    expect(store.lines).toHaveLength(0);
  });

  it("park-order: parks the basket with its id + mapped lines + label, then empties it and stays on the counter", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "2");
    await el.updateComplete;
    const parkedId = store.id; // captured BEFORE the park — clear() re-mints it on success

    emit(c, "park-order", { label: "Mesa 4" });
    await flush(el);

    expect(currentApi.parkOrder).toHaveBeenCalledWith({
      id: parkedId,
      lines: [{ productId: "cafe", quantity: "2" }],
      label: "Mesa 4",
    });
    // The basket is emptied and its id re-minted, ready for the next customer; still on the counter.
    expect(store.lines).toHaveLength(0);
    expect(store.id).not.toBe(parkedId);
    expect(counter(el)).not.toBeNull();
    expect(ticket(el)).toBeNull();
  });

  it("park-order: forwards an unlabelled park (label undefined)", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "park-order", { label: undefined });
    await flush(el);

    expect(currentApi.parkOrder).toHaveBeenCalledWith({
      id: expect.any(String),
      lines: [{ productId: "cafe", quantity: "2" }],
      label: undefined,
    });
  });

  it("a failed parkOrder keeps the counter and the basket, showing a non-fatal error", async () => {
    const { el } = await mountApp({
      parkOrder: vi.fn().mockRejectedValue({ code: "working_order.rejected" }),
    });
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "park-order", { label: "Mesa 4" });
    await flush(el);

    expect(currentApi.parkOrder).toHaveBeenCalledOnce();
    expect(ticket(el)).toBeNull();
    expect(counter(el)).not.toBeNull();
    expect(store.lines).toHaveLength(1); // basket intact — a failed park never loses the order
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("held.park_error"));
    expect(el.shadowRoot!.textContent).not.toContain("working_order.rejected"); // never leaks the code
  });

  it("park single-flight: a second park-order while the first is pending parks EXACTLY ONCE", async () => {
    // A re-entrant park (double-tap / laggy link) must not fire a second POST. Deleting the
    // `if (this.parking) return` guard makes parkOrder fire twice — the deletion proof.
    const parkOrder = vi.fn(() => new Promise(() => {})); // never resolves
    const { el } = await mountApp({ parkOrder });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "park-order", { label: "Mesa 4" }); // first — raises the guard, awaits
    await el.updateComplete;
    emit(c, "park-order", { label: "Mesa 4" }); // second — guarded, a no-op
    await el.updateComplete;

    expect(parkOrder).toHaveBeenCalledOnce();
  });

  it("entering the counter loads the held-orders list and threads it to the counter", async () => {
    const { el } = await mountApp({
      listWorkingOrders: vi.fn().mockResolvedValue([heldSummary]),
    });
    const c = await toCounter(el);
    expect(currentApi.listWorkingOrders).toHaveBeenCalledOnce();
    expect(c.heldOrders).toEqual([heldSummary]);
  });

  it("park success: refreshes the held-orders list", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "park-order", { label: "Mesa 4" });
    await flush(el);

    // once on entering the counter, once after the successful park.
    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
  });

  it("retrieve-order: fetches, maps productId→OrderLine via products, loads it under the order's id", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);

    expect(currentApi.retrieveWorkingOrder).toHaveBeenCalledWith("wo-1");
    // the retrieved order's own id is adopted (so paying it later keys the same idempotency slot)
    expect(store.id).toBe("wo-1");
    expect(store.label).toBe("Mesa 4");
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0]!.product).toBe(cafe);
    // still on the counter with the retrieved basket
    expect(counter(el)).not.toBeNull();
    expect(ticket(el)).toBeNull();
  });

  it("retrieve-order: an each quantity displays without trailing zeros; a weight keeps its decimals", async () => {
    const { el } = await mountApp({
      listProducts: vi.fn().mockResolvedValue([cafe, jamon]),
      retrieveWorkingOrder: vi.fn().mockResolvedValue({
        id: "wo-1",
        orderNumber: 5,
        label: null,
        lines: [
          { productId: "cafe", quantity: "2.000" },
          { productId: "jamon", quantity: "0.320" },
        ],
      }),
    });
    const c = await toCounter(el);

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);

    const store = c.store;
    expect(store.lines).toHaveLength(2);
    // each: numeric(_,3) "2.000" is cleaned to "2" for display; re-pricing is unaffected
    expect(store.lines[0]!.quantity).toBe("2");
    // weight: decimals are kept verbatim
    expect(store.lines[1]!.quantity).toBe("0.320");
  });

  it("retrieve-order: drops a line whose product no longer resolves and shows a non-fatal held.product_gone", async () => {
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn().mockResolvedValue({
        id: "wo-1",
        orderNumber: 5,
        label: "Mesa 4",
        lines: [
          { productId: "cafe", quantity: "1.000" },
          { productId: "ghost", quantity: "1.000" }, // deactivated since the order was parked
        ],
      }),
    });
    const c = await toCounter(el); // products default to [cafe] — "ghost" won't resolve
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);

    // the unresolved line is dropped; the rest of the order is loaded
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0]!.product).toBe(cafe);
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("held.product_gone"));
    // still on the counter with the partial basket
    expect(counter(el)).not.toBeNull();
  });

  it("retrieve-order: refreshes the held-orders list after loading", async () => {
    const { el } = await mountApp({
      listWorkingOrders: vi
        .fn()
        .mockResolvedValueOnce([heldSummary]) // on entering the counter
        .mockResolvedValueOnce([]), // after the retrieve
    });
    const c = await toCounter(el);
    expect(c.heldOrders).toEqual([heldSummary]);

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);

    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
    expect(c.heldOrders).toEqual([]);
  });

  it("discard-order: abandons the order and refreshes the held-orders list", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);

    emit(c, "discard-order", { id: "wo-1" });
    await flush(el);

    expect(currentApi.abandonWorkingOrder).toHaveBeenCalledWith("wo-1");
    // once on entering the counter, once after the discard.
    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
  });

  it("retrieve-order: a stale row (order gone on another till) shows held.stale, refreshes, keeps the basket, leaks no code", async () => {
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn().mockRejectedValue({ code: "working_order.not_found" }),
      listWorkingOrders: vi
        .fn()
        .mockResolvedValueOnce([heldSummary]) // on entering the counter
        .mockResolvedValueOnce([]), // recovery refresh drops the vanished row
    });
    const c = await toCounter(el);
    expect(c.heldOrders).toEqual([heldSummary]);
    const store = c.store;
    store.addProduct(cafe, "2"); // a basket already in progress
    await el.updateComplete;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);

    // non-fatal, translated banner — never the raw code
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("held.stale"));
    expect(el.shadowRoot!.textContent).not.toContain("working_order.not_found");
    // the vanished order drops off the list on the recovery refresh
    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
    expect(c.heldOrders).toEqual([]);
    // the in-progress basket is UNTOUCHED — loadFrom never ran on the rejected retrieve
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0]!.product).toBe(cafe);
    // still on the counter
    expect(counter(el)).not.toBeNull();
    expect(ticket(el)).toBeNull();
  });

  it("discard-order: a stale row (order gone on another till) shows held.stale, refreshes, leaks no code", async () => {
    const { el } = await mountApp({
      abandonWorkingOrder: vi.fn().mockRejectedValue({ code: "working_order.not_open" }),
      listWorkingOrders: vi
        .fn()
        .mockResolvedValueOnce([heldSummary]) // on entering the counter
        .mockResolvedValueOnce([]), // recovery refresh drops the vanished row
    });
    const c = await toCounter(el);
    expect(c.heldOrders).toEqual([heldSummary]);

    emit(c, "discard-order", { id: "wo-1" });
    await flush(el);

    expect(currentApi.abandonWorkingOrder).toHaveBeenCalledWith("wo-1");
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("held.stale"));
    expect(el.shadowRoot!.textContent).not.toContain("working_order.not_open");
    // the recovery refresh runs even though the discard rejected, so the stale row drops off
    expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
    expect(c.heldOrders).toEqual([]);
  });

  it("discard success clears a stale banner left by a prior failed action", async () => {
    // A failed retrieve sets a `held.stale` banner; a SUCCESSFUL discard must clear it, like every
    // sibling handler. Without the `errorKey = undefined` at the top of `#onDiscardOrder`, the banner
    // would persist — this fails against the pre-fix handler.
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn().mockRejectedValue({ code: "working_order.not_found" }),
    });
    const c = await toCounter(el);

    emit(c, "retrieve-order", { id: "wo-1" }); // fails → held.stale banner
    await flush(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();

    emit(c, "discard-order", { id: "wo-1" }); // succeeds → clears the banner
    await flush(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it("logout: calls logout, returns to lock, and KEEPS the basket", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    const store: WorkingOrderStore = c.store;
    store.addProduct(cafe, "2");
    store.addProduct(cafe, "1");
    await el.updateComplete;

    emit(c, "logout");
    await flush(el);

    expect(currentApi.logout).toHaveBeenCalledOnce();
    expect(lock(el)).not.toBeNull();
    expect(counter(el)).toBeNull();
    // THE load-bearing assertion: a shift change never loses the half-built order.
    expect(store.lines).toHaveLength(2);
    expect(store.lines[0]!.product).toBe(cafe);
  });

  it("a failed recordSale keeps the counter and the basket, showing a non-fatal error", async () => {
    const { el } = await mountApp({
      recordSale: vi.fn().mockRejectedValue({ code: "sale.rejected" }),
    });
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(currentApi.recordSale).toHaveBeenCalledOnce();
    // The held-list refresh is gated to the SUCCESS path: a rejected pay must not re-read the list
    // (only the one call on entering the counter). Proves the new refresh is on success, not always.
    expect(currentApi.listWorkingOrders).toHaveBeenCalledOnce();
    expect(ticket(el)).toBeNull();
    expect(counter(el)).not.toBeNull();
    expect(store.lines).toHaveLength(1); // basket intact — the sale in progress is not lost
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("sale.error"));
    expect(el.shadowRoot!.textContent).not.toContain("sale.rejected"); // never leaks the raw code
  });

  it("clears a prior sale error when the next payment attempt starts", async () => {
    const recordSale = vi
      .fn()
      .mockRejectedValueOnce({ code: "sale.rejected" })
      .mockResolvedValueOnce(saleResult);
    const { el } = await mountApp({ recordSale });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" }); // rejected → error banner
    await flush(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();

    emit(c, "confirm-payment", { method: "cash", amount: "5" }); // retried → succeeds
    await flush(el);
    expect(ticket(el)).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it("single-flight: a second confirm-payment while recordSale is pending files the sale EXACTLY ONCE", async () => {
    // The double-file safety (CLAUDE.md §5): two chained registros_facturacion for one basket are
    // unrepairable. First recordSale never settles, so the sale stays in flight; a second
    // confirm-payment dispatched in that window (double-tap / laggy link) must be a no-op. Deleting
    // the `if (this.submitting) return` guard makes recordSale fire twice — the deletion proof.
    const recordSale = vi.fn(() => new Promise<TillSaleResult>(() => {})); // never resolves
    const { el } = await mountApp({ recordSale });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" }); // first — raises submitting, awaits
    await el.updateComplete;
    expect(counter(el)!.busy).toBe(true); // in flight → the pay affordance is disabled

    emit(c, "confirm-payment", { method: "cash", amount: "5" }); // second — guarded, a no-op
    await el.updateComplete;

    expect(recordSale).toHaveBeenCalledOnce();
  });

  it("resets the busy state after a REJECTED sale so the counter re-enables for a retry", async () => {
    const { el } = await mountApp({
      recordSale: vi.fn().mockRejectedValue({ code: "sale.rejected" }),
    });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    // Back on the counter, and `submitting` was cleared in the `finally` — the pay affordance is live
    // again so the operator can retry. (Without the finally reset, busy would stay true and stick.)
    expect(counter(el)).not.toBeNull();
    expect(counter(el)!.busy).toBe(false);
  });

  it("resets the busy state after a SUCCESSFUL sale so a later sale is not blocked", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(ticket(el)).not.toBeNull();

    // A fresh sale must fire a SECOND recordSale — proving `submitting` was cleared after the first
    // success rather than left stuck (a stuck flag would make this confirm-payment a silent no-op).
    emit(ticket(el)!, "new-sale");
    await flush(el);
    counter(el)!.store.addProduct(cafe, "1");
    await el.updateComplete;
    emit(counter(el)!, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(currentApi.recordSale).toHaveBeenCalledTimes(2);
  });

  it("does not change the global locale when the app disconnects before getTill resolves", async () => {
    let resolveTill!: (v: typeof till) => void;
    const getTill = vi.fn(() => new Promise<typeof till>((r) => (resolveTill = r)));
    const { el, host } = await mountApp({ getTill });
    host.remove(); // torn down before boot resolves
    resolveTill({ ...till, locale: "en" });
    await flush(el);
    expect(currentLocale()).toBe("es-ES"); // guard skipped setLocale on the detached app
  });
});
