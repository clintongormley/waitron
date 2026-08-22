import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTicketView } from "./screens/till-ticket-view.js";
import type { TillScheduleScreen } from "./screens/till-schedule-screen.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillTenderPay } from "./widgets/tender-pay.js";
import type { TillStationQueue } from "./widgets/station-queue.js";
import type { TillProductGrid } from "./widgets/product-grid.js";
import { LAYOUT_A, type LayoutDef } from "./layout.js";
import type {
  FloorZone,
  HeldOrderSummary,
  PayOutcome,
  TabLine,
  TableState,
  TillApi,
  TillProduct,
  TillSaleResult,
} from "./api/client.js";
import type { WorkingOrderStore } from "./state/working-order.js";

const cafe: TillProduct = {
  id: "cafe",
  descriptions: { "es-ES": "Café" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

const jamon: TillProduct = {
  id: "jamon",
  descriptions: { "es-ES": "Jamón" },
  pricingUnit: "weight",
  unitPrice: "10.00",
  vatClass: "reduced",
  category: "charcutería",
  allergens: null,
};

const heldSummary: HeldOrderSummary = {
  id: "wo-1",
  orderNumber: 5,
  label: "Mesa 4",
  itemCount: 2,
  total: "3.00",
  openedAt: "2026-08-05T10:00:00.000Z",
};

const floorZone: FloorZone = { id: "z1", name: "Comedor", displayOrder: 0, active: true };

const freeTable: TableState = {
  id: "t1",
  label: "1",
  zoneId: "z1",
  capacity: 4,
  state: "free",
  hasOpenTab: false,
  pendingDeliveries: 0,
  pendingToServe: 0,
  readyToServe: 0,
  status: null,
  // FP-2: unplaced (the app tests exercise the FP-1 flows, which default to the list view).
  posX: null,
  posY: null,
  shape: null,
  rotation: null,
};

const openTable: TableState = {
  id: "t2",
  label: "2",
  zoneId: "z1",
  capacity: 4,
  state: "open-tab",
  hasOpenTab: true,
  tabId: "wo-7",
  tabLineCount: 2,
  tabTotal: "12.00",
  pendingDeliveries: 0,
  pendingToServe: 1,
  readyToServe: 0,
  status: null,
  posX: null,
  posY: null,
  shape: null,
  rotation: null,
};

const saleResult: TillSaleResult = {
  invoiceNumber: "F-0001",
  issuedAt: "2026-08-05T10:00:00.000Z",
  total: "3.00",
  vatBreakdown: [{ rate: "21", base: "2.48", tax: "0.52" }],
  // The FILED line list the ticket renders (server's composition), never the client basket.
  lines: [{ descriptions: { "es-ES": "Café" }, quantity: "2", gross: "3.00" }],
  change: "2.00",
  qr: "https://example.test/vf?nif=B1&num=F-0001&fecha=05-08-2026&total=3.00",
};

const till = {
  locale: "es-ES",
  venueName: "Bar Pepe",
  nif: "B12345678",
  orderFlow: "prepay" as const,
  // The venue's KDS whole-ticket bump mode (KDS-1 §2e); `line` is the default (per-line bump only), so
  // the station-screen tests that don't drive it exercise the per-line path. A test overrides it.
  bumpMode: "line" as const,
  // The venue's KDS fire-control mode (KDS-2 §2c); `waiter` is the default (the tab screen fires), so the
  // station display shows no fire action unless a test drives this to `kitchen`.
  fireControl: "waiter" as const,
  // Both always present on the real `GET /api/till` (`TillInfo`'s own doc) — defaulted here to the
  // manual (datáfono) Card path, `"none"`, so every pre-Task-9 test below (which never touches these
  // two fields) keeps exercising #62's unchanged behaviour rather than the integrated one.
  cardProvider: "none" as const,
  tipsEnabled: false,
  // `layout`/`receipt` are DELIBERATELY omitted (an older server that predates the editor): #boot then
  // leaves the received layout undefined, so #layoutFor()'s Mode-P prep-queue drop applies as the
  // fallback and the ticket receipt defaults to {} — the slice-1 behaviour every pre-Task-9 test relies
  // on. The `authored layout + receipt` suite supplies them explicitly.
};

const placedResult = {
  id: "wo-1",
  status: "placed" as const,
  invoiceNumber: "A/1",
  issuedAt: "2026-08-06T10:00:00.000Z",
  total: "3.00",
  qr: "x",
  vatBreakdown: [{ rate: "21", base: "2.48", tax: "0.52" }],
};

const stationGroup = {
  orderId: "wo-1",
  orderNumber: 5,
  label: "Mesa 4",
  queuedAt: "2026-08-17T10:00:00.000Z",
  status: "settled" as const,
  items: [
    {
      id: "ti-1",
      workingOrderLineId: "wol-1",
      state: "queued" as const,
      descriptions: { "es-ES": "Paella" },
      quantity: "2.000",
    },
  ],
};

/** The venue's single default station — what `#refreshStationQueue` resolves to fetch the counter's
 * default-station queue (Modes I/T). */
const defaultStation = {
  id: "st-default",
  name: "Cocina",
  displayOrder: 0,
  isDefault: true,
  active: true,
};

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
    pay: vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult }),
    parkOrder: vi.fn().mockResolvedValue({ id: "wo-1", orderNumber: 5 }),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    retrieveWorkingOrder: vi.fn().mockResolvedValue({
      id: "wo-1",
      orderNumber: 5,
      label: "Mesa 4",
      lines: [{ productId: "cafe", quantity: "2.000" }],
    }),
    abandonWorkingOrder: vi.fn().mockResolvedValue(undefined),
    updateWorkingOrder: vi.fn().mockResolvedValue(undefined),
    placeOrder: vi.fn().mockResolvedValue(placedResult),
    collectOrder: vi.fn().mockResolvedValue(saleResult),
    // KDS-1 kitchen surface: the counter's default-station queue (Modes I/T) + the per-line advance.
    listStations: vi.fn().mockResolvedValue([defaultStation]),
    getStationQueue: vi.fn().mockResolvedValue([]),
    advanceTicketItem: vi.fn().mockResolvedValue(undefined),
    markCollected: vi.fn().mockResolvedValue(undefined),
    advanceTicket: vi.fn().mockResolvedValue(undefined),
    // Live floor (FP-1): the app loads these on entering the floor and opens a tab on a table tap.
    getTablesState: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    openTab: vi.fn().mockResolvedValue({ tabId: "wo-new", orderNumber: 12 }),
    // FP-1 table-order screen: the app loads the tab's lines on entering it and writes rounds/serve/
    // status from its events. Each defaults to a resolved value; a test overrides any with its own fn.
    getTabLines: vi.fn().mockResolvedValue([]),
    addTabRound: vi.fn().mockResolvedValue(undefined),
    markLineServed: vi.fn().mockResolvedValue(undefined),
    setTableStatus: vi.fn().mockResolvedValue(undefined),
    listStatuses: vi.fn().mockResolvedValue([]),
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
const schedule = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillScheduleScreen>("till-schedule-screen");
const floor = (el: TillApp) => el.shadowRoot!.querySelector<TillFloorScreen>("till-floor-screen");
const tableOrder = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen");
/** The pay widget nested inside the counter screen's OWN shadow root (7c per-mode control). */
const tenderPay = (el: TillApp) =>
  counter(el)!.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;
/** The station-queue widget nested inside the counter screen's shadow root (the default-station queue),
 * or `null` when the layout (Mode P) omits it. */
const stationQueueWidget = (el: TillApp) =>
  counter(el)!.shadowRoot!.querySelector<TillStationQueue>("till-station-queue");

/** Fires a composed, bubbling CustomEvent from `source` — the shape every till screen emits. */
function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

/** Boots the app, settles boot, and logs a person in — leaving the app on the counter. */
async function toCounter(el: TillApp): Promise<TillCounterScreen> {
  await flush(el);
  // Log in as a NON-configuring operator by default (the common case) — the FP-2 capability tests below
  // drive a configuring one explicitly. `canConfigureTill` rides the `logged-in` event exactly as the
  // lock screen sends it (the server computes it from the operator's role).
  emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
  await flush(el);
  return counter(el)!;
}

/** Boots, logs in, opens the floor, then opens `table`'s tab — leaving the app on the table-order
 * screen (FP-1). The app must be mounted with `getTablesState` returning `table` so the floor has it. */
async function toTableOrder(el: TillApp, table: TableState): Promise<TillTableOrderScreen> {
  await toCounter(el);
  emit(counter(el)!, "show-floor");
  await flush(el);
  emit(floor(el)!, "open-table", { tableId: table.id, hasOpenTab: table.hasOpenTab });
  await flush(el);
  return tableOrder(el)!;
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

  it("a failing listStaff leaves the roster empty and never blocks the counter (no unhandled rejection)", async () => {
    // `#onLoggedIn` loads the colleague roster AFTER the counter is shown, so a roster failure must
    // degrade gracefully: leave `staff` at its default `[]` and surface no error. Under
    // `void this.#onLoggedIn(...)` an uncaught rejection escapes as an UNHANDLED promise rejection —
    // the load-bearing assertion below is `rejections === []`, since `staff` is `[]` either way (the
    // unguarded assignment simply never completes). Removing the try/catch makes `rejections` hold the
    // roster error and this test go red — the deletion proof.
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent): void => {
      rejections.push(event.reason);
      event.preventDefault(); // mark handled so it doesn't pollute sibling tests
    };
    window.addEventListener("unhandledrejection", onRejection);
    try {
      const { el } = await mountApp({
        listStaff: vi.fn().mockRejectedValue(new Error("roster down")),
      });
      const c = await toCounter(el);
      // Give any pending unhandled-rejection notification a couple of macrotasks to surface.
      await flush(el);
      await flush(el);

      // The counter still shows — the sale flow is never blocked by the roster fetch.
      expect(c).not.toBeNull();
      expect(counter(el)).not.toBeNull();
      // The roster degraded to empty rather than throwing.
      expect((el as unknown as { staff: unknown[] }).staff).toEqual([]);
      // No error banner: a roster failure is non-fatal, not a surfaced error.
      expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
      // The rejection was caught, not left unhandled.
      expect(rejections).toEqual([]);
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
    }
  });

  // Both boot-failure shapes reach the same bare `catch`: a network rejection (server unreachable) and a
  // non-2xx `{ code }` the client throws (e.g. `server.internal`). Parametrised so the comment's "either
  // way boot cannot complete" claim is a tested receipt, not just prose.
  it.each([
    { label: "server unreachable", reason: new Error("server down") },
    { label: "non-2xx { code }", reason: { code: "server.internal" } },
  ])(
    "a failing getTill ($label) surfaces the boot error, never an unhandled rejection",
    async ({ reason }) => {
      // `firstUpdated` fires `void this.#boot()`, and `#boot` awaits `getTill()` to load the till's setup
      // (locale, issuer, order flow, card wiring). A failing boot must be a HANDLED state, not an UNHANDLED
      // promise rejection: it surfaces the `boot.error` banner and stays on the lock screen. The two
      // load-bearing assertions are the visible banner (removing `#boot`'s try/catch drops the errorKey) AND
      // `rejections === []` (removing it lets getTill's rejection escape as an unhandled rejection) —
      // together the deletion proof.
      const rejections: unknown[] = [];
      const onRejection = (event: PromiseRejectionEvent): void => {
        rejections.push(event.reason);
        event.preventDefault(); // mark handled so it doesn't pollute sibling tests
      };
      window.addEventListener("unhandledrejection", onRejection);
      try {
        const { el } = await mountApp({
          getTill: vi.fn().mockRejectedValue(reason),
        });
        // Give any pending unhandled-rejection notification a couple of macrotasks to surface.
        await flush(el);
        await flush(el);

        // A boot failure never crashes the app into a blank screen — the lock screen still renders.
        expect(lock(el)).not.toBeNull();
        // The failure is surfaced, not swallowed: the operator sees why the till is unusable.
        const banner = el.shadowRoot!.querySelector('[role="alert"]');
        expect(banner).not.toBeNull();
        expect(banner!.textContent).toContain(t("boot.error"));
        // The rejection was caught, not left unhandled.
        expect(rejections).toEqual([]);
      } finally {
        window.removeEventListener("unhandledrejection", onRejection);
      }
    },
  );

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
    // A FRESH walk-up (never persisted) is filed straight from its lines — no pre-pay re-lock. Only a
    // RETRIEVED/parked basket is synced first (see the retrieve→edit→pay test); syncing a walk-up here
    // would try to update a working order the server has never seen.
    expect(currentApi.updateWorkingOrder).not.toHaveBeenCalled();
    const view = ticket(el)!;
    expect(view).not.toBeNull();
    // The ticket renders the SERVER result (its `lines` are the filed composition), not a client basket.
    expect(view.result).toBe(saleResult);
    expect(view.issuer).toEqual({ venueName: "Bar Pepe", nif: "B12345678" });
  });

  it("the printed receipt line list comes from the SERVER result, not the client basket (Finding 2)", async () => {
    // The client basket and the FILED lines deliberately DIVERGE: the store holds café×2, but the
    // server's filed result reports a different composition (agua×3). The rendered ticket must show the
    // FILED "Agua"/"3"/"6,00 €" — proof the receipt renders `result.lines`, never the mutable basket, so
    // a local edit can never make the printed goods list disagree with the invoice.
    const filed: TillSaleResult = {
      ...saleResult,
      total: "6.00",
      lines: [{ descriptions: { "es-ES": "Agua" }, quantity: "3", gross: "6.00" }],
    };
    const norm = (s: string): string => s.replace(/[\u00A0\u202F]/g, " ");
    const { el } = await mountApp({ recordSale: vi.fn().mockResolvedValue(filed) });
    const c = await toCounter(el);
    c.store.addProduct(cafe, "2"); // client basket — different from the filed lines
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "10" });
    await flush(el);

    const rows = ticket(el)!.shadowRoot!.querySelectorAll(".line");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Agua");
    expect(rows[0]!.textContent).toContain("3");
    expect(norm(rows[0]!.textContent!)).toContain("6,00 €");
    // The client basket's "Café" never reaches the receipt.
    expect(ticket(el)!.shadowRoot!.textContent).not.toContain("Café");
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
    // Behaviour 1 (re-review): the order was retrieved but NOT edited, so it must NOT be re-synced —
    // re-syncing re-prices with the live catalogue and would file at the pay-time price, defeating the
    // add-time lock. An unedited retrieve→pay files from the stored lock (recordSale straight through).
    expect(currentApi.updateWorkingOrder).not.toHaveBeenCalled();
  });

  it("retrieve → edit → pay re-syncs the edited basket BEFORE paying, so the edit is not dropped (Finding 2)", async () => {
    // 7c regression: the server's retrieved-order pay files from the STORED lock and IGNORES the sent
    // basket, so an edit made after retrieve must be re-locked (`updateWorkingOrder`) BEFORE the pay or
    // it is SILENTLY DROPPED from both the charge and the filed record. Retrieve wo-1 (café×2), add a
    // second café, then pay: `updateWorkingOrder` must carry the EDITED composition and run BEFORE
    // `recordSale`. Deleting the persisted-sync in `#onConfirmPayment` makes this fail (the edit is lost).
    const updateWorkingOrder = vi.fn().mockResolvedValue(undefined);
    const recordSale = vi.fn().mockResolvedValue(saleResult);
    const { el } = await mountApp({ updateWorkingOrder, recordSale });
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(store.persisted).toBe(true); // a retrieved order is persisted server-side

    store.addProduct(cafe, "1"); // the edit AFTER retrieve
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    // The edited composition was re-locked: café×2 (retrieved) + café×1 (the edit), under the order's id.
    expect(updateWorkingOrder).toHaveBeenCalledWith("wo-1", {
      lines: [
        { productId: "cafe", quantity: "2" },
        { productId: "cafe", quantity: "1" },
      ],
      label: "Mesa 4",
    });
    // recordSale files the SAME edited composition under the same id, and the sync ran FIRST — the
    // server needs the lock updated before it files from it.
    expect(recordSale).toHaveBeenCalledWith(
      [
        { productId: "cafe", quantity: "2" },
        { productId: "cafe", quantity: "1" },
      ],
      { method: "cash", amount: "5" },
      "wo-1",
    );
    expect(updateWorkingOrder.mock.invocationCallOrder[0]!).toBeLessThan(
      recordSale.mock.invocationCallOrder[0]!,
    );
  });

  it("retrieve → edit → pay: a not_open re-sync FALLS THROUGH to the settled replay, not sale.error (Findings 3 & 4)", async () => {
    // Behaviours 3 & 4 of the re-review: a lost-response retry, or the LOSER of a two-till concurrent
    // pay on the same parked order (a normal 7b flow), finds the order ALREADY settled. The edit-gated
    // re-sync then throws `working_order.not_open` — which must NOT surface. It means "already settled →
    // let the pay path replay": `recordSale`'s settled branch returns the FILED ticket (no double-file,
    // no error banner). Deleting the not_open swallow in `#onConfirmPayment` makes this fail (the throw
    // reaches the sale.error handler and no ticket shows) — the replay-safety deletion proof.
    const updateWorkingOrder = vi.fn().mockRejectedValue({ code: "working_order.not_open" });
    const recordSale = vi.fn().mockResolvedValue(saleResult); // the server's settled-replay ticket
    const { el } = await mountApp({ updateWorkingOrder, recordSale });
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    store.addProduct(cafe, "1"); // an edit → the basket is dirty, so the re-sync is attempted
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    // The re-sync was attempted and rejected `not_open` — but the pay REPLAYED: ticket shown, no error.
    expect(updateWorkingOrder).toHaveBeenCalled();
    expect(recordSale).toHaveBeenCalledWith(
      [
        { productId: "cafe", quantity: "2" },
        { productId: "cafe", quantity: "1" },
      ],
      { method: "cash", amount: "5" },
      "wo-1",
    );
    expect(ticket(el)).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull(); // no sale.error banner
  });

  it("retrieve → edit → pay: a NON-not_open re-sync failure surfaces as a non-fatal error (basket intact)", async () => {
    // The other side of the swallow: only `working_order.not_open` falls through. Any OTHER re-sync
    // rejection (a network error, some other domain code) is a real failure — it must surface as the
    // generic sale.error, leave the basket intact, and NOT file (recordSale is never reached). Mutating
    // the swallow to catch every code would let a genuine failure be silently paid past.
    const updateWorkingOrder = vi.fn().mockRejectedValue({ code: "server.internal" });
    const recordSale = vi.fn().mockResolvedValue(saleResult);
    const { el } = await mountApp({ updateWorkingOrder, recordSale });
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    store.addProduct(cafe, "1"); // edit → dirty → re-sync attempted
    await el.updateComplete;

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(recordSale).not.toHaveBeenCalled(); // the failed sync short-circuits before filing
    expect(ticket(el)).toBeNull();
    expect(counter(el)).not.toBeNull();
    expect(store.lines).toHaveLength(2); // basket intact — café×2 retrieved + café×1 edit
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("sale.error"));
    expect(el.shadowRoot!.textContent).not.toContain("server.internal"); // never leaks the raw code
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

  it("retrieve → edit → Hold re-syncs the edit via updateWorkingOrder instead of re-parking (P6)", async () => {
    // P6 "Re-hold of a retrieved-and-edited order is not wired": now that the server made park
    // IDEMPOTENT (a re-sent park with the same id REPLAYS the existing OPEN order and inserts nothing —
    // the re-sent basket is DISCARDED), re-parking a RETRIEVED, EDITED order would SILENTLY DISCARD the
    // edit yet show success. So Hold must mirror the pay/place paths: route a PERSISTED order through
    // `#syncIfDirty` (`updateWorkingOrder`), never `parkOrder`. Retrieve wo-1 (café×2), add a second
    // café, tap Hold: `updateWorkingOrder` must carry the EDITED composition + label and `parkOrder`
    // must NOT be called; the basket clears (success). Before the fix `#onParkOrder` calls `parkOrder`
    // unconditionally — the edit is replayed away — so this fails (parkOrder called, updateWorkingOrder
    // not).
    const updateWorkingOrder = vi.fn().mockResolvedValue(undefined);
    const parkOrder = vi.fn().mockResolvedValue({ id: "wo-1", orderNumber: 5 });
    const { el } = await mountApp({ updateWorkingOrder, parkOrder });
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(store.persisted).toBe(true); // a retrieved order is persisted server-side

    store.addProduct(cafe, "1"); // the edit AFTER retrieve → the basket is dirty
    await el.updateComplete;

    emit(c, "park-order", { label: "Mesa 4" });
    await flush(el);

    // The edit is re-locked via updateWorkingOrder (café×2 retrieved + café×1 edit), under the order's
    // id and label — NOT re-parked (a re-park would idempotently replay and discard the edit).
    expect(updateWorkingOrder).toHaveBeenCalledWith("wo-1", {
      lines: [
        { productId: "cafe", quantity: "2" },
        { productId: "cafe", quantity: "1" },
      ],
      label: "Mesa 4",
    });
    expect(parkOrder).not.toHaveBeenCalled();
    // Success path: the basket empties and stays on the counter (a hold is not a completed sale).
    expect(store.lines).toHaveLength(0);
    expect(counter(el)).not.toBeNull();
    expect(ticket(el)).toBeNull();
  });

  it("retrieve → (no edit) → Hold does not re-park an unedited retrieved order (P6)", async () => {
    // The unedited half of P6: a retrieved order tapped straight to Hold has nothing to save — and must
    // STILL not re-park, because an idempotent re-park is a needless round trip that only replays the
    // already-stored order. `#syncIfDirty` no-ops on a clean basket (`persisted && !dirty`), so neither
    // `updateWorkingOrder` nor `parkOrder` fires; the basket clears so the operator can move on. Before
    // the fix `parkOrder` IS called, so this fails.
    const updateWorkingOrder = vi.fn().mockResolvedValue(undefined);
    const parkOrder = vi.fn().mockResolvedValue({ id: "wo-1", orderNumber: 5 });
    const { el } = await mountApp({ updateWorkingOrder, parkOrder });
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(store.persisted).toBe(true);
    expect(store.dirty).toBe(false); // retrieved but never edited

    emit(c, "park-order", { label: "Mesa 4" });
    await flush(el);

    expect(parkOrder).not.toHaveBeenCalled(); // an idempotent re-park is not a save — skip it
    expect(updateWorkingOrder).not.toHaveBeenCalled(); // #syncIfDirty no-ops on a clean basket
    // Success path: the basket empties and stays on the counter.
    expect(store.lines).toHaveLength(0);
    expect(counter(el)).not.toBeNull();
  });

  it("retrieve → edit → Hold with a BLANK label keeps the retrieved order's name, does not wipe it (P6)", async () => {
    // The Hold field opens BLANK, so `park-order` carries `label: undefined`. `updateWorkingOrder` writes
    // `label ?? null`, so forwarding that undefined would WIPE the retrieved order's name ("Mesa 4" → NULL)
    // — anonymising it in the cross-till held list. The persisted branch falls back to the STORED label,
    // so a blank re-hold preserves the name. Proven by deletion: dropping `?? this.#store.label` sends
    // label undefined here and fails this assertion. (A typed label still renames — the case above.)
    const updateWorkingOrder = vi.fn().mockResolvedValue(undefined);
    const parkOrder = vi.fn().mockResolvedValue({ id: "wo-1", orderNumber: 5 });
    const { el } = await mountApp({ updateWorkingOrder, parkOrder });
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(store.label).toBe("Mesa 4"); // loadFrom adopted the retrieved order's name

    store.addProduct(cafe, "1"); // edit AFTER retrieve → dirty
    await el.updateComplete;

    emit(c, "park-order", { label: undefined }); // the blank Hold field
    await flush(el);

    // The stored "Mesa 4" is preserved, NOT wiped — updateWorkingOrder carries the name, not undefined.
    expect(updateWorkingOrder).toHaveBeenCalledWith("wo-1", {
      lines: [
        { productId: "cafe", quantity: "2" },
        { productId: "cafe", quantity: "1" },
      ],
      label: "Mesa 4",
    });
    expect(parkOrder).not.toHaveBeenCalled();
  });

  it("retrieve → edit → Hold surfaces held.park_error and keeps the basket when the update fails (P6)", async () => {
    // The persisted Hold path's error handling: a REAL `updateWorkingOrder` failure (not the
    // `working_order.not_open` that `#syncIfDirty` swallows) must surface the same non-fatal
    // `held.park_error` banner and leave the basket intact — the exact guarantee the fresh-walk-up park
    // has (see "a failed parkOrder keeps the counter and the basket"), now proven for the persisted path.
    const updateWorkingOrder = vi.fn().mockRejectedValue({ code: "working_order.rejected" });
    const parkOrder = vi.fn().mockResolvedValue({ id: "wo-1", orderNumber: 5 });
    const { el } = await mountApp({ updateWorkingOrder, parkOrder });
    const c = await toCounter(el);
    const store = c.store;

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    store.addProduct(cafe, "1"); // edit → dirty, so #syncIfDirty attempts the update
    await el.updateComplete;

    emit(c, "park-order", { label: "Mesa 4" });
    await flush(el);

    expect(updateWorkingOrder).toHaveBeenCalledOnce();
    expect(parkOrder).not.toHaveBeenCalled();
    expect(store.lines).toHaveLength(2); // basket intact (not cleared) so the operator can retry
    expect(counter(el)).not.toBeNull();
    const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain(t("held.park_error"));
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

  it("show-schedule shows the schedule screen (basket preserved) and threads the roster + operator id", async () => {
    const { el } = await mountApp({
      listMyShifts: vi.fn().mockResolvedValue([]),
      listMySwaps: vi.fn().mockResolvedValue([]),
      listMyAbsences: vi.fn().mockResolvedValue([]),
    });
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "2");
    await el.updateComplete;

    emit(c, "show-schedule");
    await flush(el);

    expect(schedule(el)).not.toBeNull();
    expect(counter(el)).toBeNull();
    // Basket-preserving, like logout: navigating to the schedule never loses the half-built order.
    expect(store.lines).toHaveLength(1);
    // The roster (from listStaff) and the logged-in operator id reach the schedule screen.
    expect(schedule(el)!.operatorPersonId).toBe("p1");
    expect(schedule(el)!.staff).toEqual([{ personId: "p1", displayName: "Ana" }]);
  });

  it("back-to-counter returns to the counter with the basket intact after a schedule round trip", async () => {
    const { el } = await mountApp({
      listMyShifts: vi.fn().mockResolvedValue([]),
      listMySwaps: vi.fn().mockResolvedValue([]),
      listMyAbsences: vi.fn().mockResolvedValue([]),
    });
    const c = await toCounter(el);
    const store = c.store;
    store.addProduct(cafe, "2");
    store.addProduct(cafe, "1");
    await el.updateComplete;

    emit(c, "show-schedule");
    await flush(el);
    expect(schedule(el)).not.toBeNull();

    emit(schedule(el)!, "back-to-counter");
    await flush(el);

    expect(counter(el)).not.toBeNull();
    expect(schedule(el)).toBeNull();
    // The load-bearing assertion: the basket survives the whole counter → schedule → counter round trip.
    expect(store.lines).toHaveLength(2);
    expect(store.lines[0]!.product).toBe(cafe);
  });

  describe("live floor (FP-1)", () => {
    it("show-floor loads the zones + occupancy read-model and shows the floor (basket preserved)", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      const c = await toCounter(el);
      const store = c.store;
      store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "show-floor");
      await flush(el);

      expect(floor(el)).not.toBeNull();
      expect(counter(el)).toBeNull();
      expect(currentApi.getTablesState).toHaveBeenCalledOnce();
      expect(currentApi.listZones).toHaveBeenCalledOnce();
      // The loaded zones + tables reach the floor screen.
      expect(floor(el)!.zones).toEqual([floorZone]);
      expect(floor(el)!.tables).toEqual([freeTable]);
      // Basket-preserving like the schedule nav: the half-built order survives the round trip.
      expect(store.lines).toHaveLength(1);
    });

    it("show-floor degrades to an empty floor when the occupancy load fails (never blocks)", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockRejectedValue({ code: "server.internal" }),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      const c = await toCounter(el);

      emit(c, "show-floor");
      await flush(el);

      // A failed read shows the floor anyway (degrade gracefully), with tables left at their default.
      expect(floor(el)).not.toBeNull();
      expect(floor(el)!.tables).toEqual([]);
    });

    it("threads the api + the canEdit gate to the floor screen (FP-2)", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      const c = await toCounter(el);
      emit(c, "show-floor");
      await flush(el);

      // The floor screen gets the app's api (for the on-till placement writes) and the manager gate.
      // `toCounter` logged in as STAFF, so `canEdit` is false here (the manager path is covered below).
      expect(floor(el)!.api).toBe(currentApi);
      expect(floor(el)!.canEdit).toBe(false);
    });

    it("a login WITH the till.configure capability lights up the on-till floor editor, end-to-end", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await flush(el);
      // The lock screen sends the server-computed capability; a manager holds `till.configure`.
      emit(lock(el)!, "logged-in", {
        personId: "p1",
        displayName: "Marta",
        canConfigureTill: true,
      });
      await flush(el);
      emit(counter(el)!, "show-floor");
      await flush(el);

      expect(floor(el)!.canEdit).toBe(true);
      expect(floor(el)!.shadowRoot!.querySelector("[data-edit-toggle]")).not.toBeNull();

      // Logging out drops the privilege so the next operator starts un-privileged.
      emit(floor(el)!, "back-to-counter");
      await flush(el);
      emit(counter(el)!, "logout");
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Ana", canConfigureTill: false });
      await flush(el);
      emit(counter(el)!, "show-floor");
      await flush(el);
      expect(floor(el)!.canEdit).toBe(false);
    });

    it("a login WITHOUT the till.configure capability keeps the on-till floor editor hidden, end-to-end", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      await flush(el);
      emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
      await flush(el);
      emit(counter(el)!, "show-floor");
      await flush(el);

      expect(floor(el)!.canEdit).toBe(false);
      expect(floor(el)!.shadowRoot!.querySelector("[data-edit-toggle]")).toBeNull();
    });

    it("floor-refresh re-reads the tables but NOT the zones after an on-till placement write (FP-2)", async () => {
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      const c = await toCounter(el);
      emit(c, "show-floor");
      await flush(el);
      // The initial floor load read each once.
      expect(currentApi.getTablesState).toHaveBeenCalledOnce();
      expect(currentApi.listZones).toHaveBeenCalledOnce();

      emit(floor(el)!, "floor-refresh");
      await flush(el);

      // The refresh re-read the TABLES (twice total) so the map reflects the just-persisted placement —
      // but NOT the zones: a placement write cannot change the zone list, so re-fetching it is waste.
      expect(currentApi.getTablesState).toHaveBeenCalledTimes(2);
      expect(currentApi.listZones).toHaveBeenCalledOnce();
    });

    it("floor-refresh degrades gracefully when the re-read fails (keeps the last-known floor)", async () => {
      // The first load succeeds; the refresh re-read rejects. A failed refresh must NOT blank the floor
      // or throw (the floor touches no fiscal path) — the last-known tables stay put.
      const { el } = await mountApp({
        getTablesState: vi
          .fn()
          .mockResolvedValueOnce([freeTable])
          .mockRejectedValue({ code: "server.internal" }),
        listZones: vi.fn().mockResolvedValue([floorZone]),
      });
      const c = await toCounter(el);
      emit(c, "show-floor");
      await flush(el);
      expect(floor(el)!.tables).toEqual([freeTable]);

      emit(floor(el)!, "floor-refresh");
      await flush(el);

      // Still on the floor, tables unchanged from the last good load.
      expect(floor(el)).not.toBeNull();
      expect(floor(el)!.tables).toEqual([freeTable]);
    });

    it("open-table on a FREE table opens a fresh tab and moves to the table-ordering screen", async () => {
      const openTab = vi.fn().mockResolvedValue({ tabId: "wo-new", orderNumber: 12 });
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([freeTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
        openTab,
      });
      const c = await toCounter(el);
      emit(c, "show-floor");
      await flush(el);

      emit(floor(el)!, "open-table", { tableId: "t1", hasOpenTab: false });
      await flush(el);

      // A free table opens a NEW tab (a pre-fiscal working order) before transitioning.
      expect(openTab).toHaveBeenCalledWith("t1");
      expect(floor(el)).toBeNull();
      // The real table-order screen (Ruling FP-D) now holds the slot, pointed at the freshly-opened tab
      // id (the app stored `openTab`'s new id in activeTabId and threads it through as `.orderId`).
      const screen = tableOrder(el);
      expect(screen).not.toBeNull();
      expect(screen!.orderId).toBe("wo-new");
    });

    it("open-table on an OCCUPIED table resumes its tab WITHOUT opening a new one", async () => {
      const openTab = vi.fn();
      const { el } = await mountApp({
        getTablesState: vi.fn().mockResolvedValue([openTable]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
        openTab,
      });
      const c = await toCounter(el);
      emit(c, "show-floor");
      await flush(el);

      emit(floor(el)!, "open-table", { tableId: "t2", hasOpenTab: true });
      await flush(el);

      // An occupied table already has a tab — no fresh openTab, just the transition. The screen points
      // at the RESUMED tab id (resolved from the read-model's tabId), not a new one.
      expect(openTab).not.toHaveBeenCalled();
      expect(floor(el)).toBeNull();
      expect(tableOrder(el)!.orderId).toBe("wo-7");
    });

    it("open-table on an occupied table missing from the read-model transitions with no order id", async () => {
      const openTab = vi.fn();
      const { el } = await mountApp({
        // The read-model is empty, so the tapped table can't be resolved to a tab id.
        getTablesState: vi.fn().mockResolvedValue([]),
        listZones: vi.fn().mockResolvedValue([floorZone]),
        openTab,
      });
      const c = await toCounter(el);
      emit(c, "show-floor");
      await flush(el);

      emit(floor(el)!, "open-table", { tableId: "t2", hasOpenTab: true });
      await flush(el);

      // A resume never opens a fresh tab; with no tab id resolved the screen carries none.
      expect(openTab).not.toHaveBeenCalled();
      expect(tableOrder(el)).not.toBeNull();
      expect(tableOrder(el)!.orderId).toBeUndefined();
    });

    it("back-to-counter returns from the floor to the counter, basket intact", async () => {
      const { el } = await mountApp();
      const c = await toCounter(el);
      const store = c.store;
      store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "show-floor");
      await flush(el);
      expect(floor(el)).not.toBeNull();

      emit(floor(el)!, "back-to-counter");
      await flush(el);

      expect(counter(el)).not.toBeNull();
      expect(floor(el)).toBeNull();
      expect(store.lines).toHaveLength(1);
    });

    describe("table-order screen (FP-1)", () => {
      const tabLine: TabLine = {
        lineNo: 1,
        productId: "cafe",
        quantity: "2.000",
        unitPriceGross: "1.50",
        servedAt: null,
      };
      it("loads the tab's lines and threads them (with the catalogue) to the screen", async () => {
        const getTabLines = vi.fn().mockResolvedValue([tabLine]);
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines,
        });
        const screen = await toTableOrder(el, openTable);

        expect(getTabLines).toHaveBeenCalledWith("wo-7");
        expect(screen.lines).toEqual([tabLine]);
        expect(screen.products).toEqual([cafe]);
      });

      it("loads the ACTIVE service-status catalogue and threads it to the Estado picker", async () => {
        const catalogue = [
          { id: "s1", label: "Reservada", color: "#cc0000" },
          { id: "s2", label: "Cuenta pedida", color: "#0a8a0a" },
        ];
        const listStatuses = vi.fn().mockResolvedValue(catalogue);
        const { el } = await mountApp({
          // openTable carries `status: null`, so a list DERIVED from the occupancy read-model would be
          // empty — the picker must be fed the loaded catalogue (incl. a status applied to no table).
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          listStatuses,
        });
        const screen = await toTableOrder(el, openTable);
        expect(listStatuses).toHaveBeenCalled();
        expect(screen.statuses).toEqual(catalogue);
      });

      it("send-round appends the round to the tab then reloads its lines", async () => {
        const addTabRound = vi.fn().mockResolvedValue(undefined);
        const getTabLines = vi.fn().mockResolvedValue([tabLine]);
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          addTabRound,
          getTabLines,
        });
        const screen = await toTableOrder(el, openTable);
        expect(getTabLines).toHaveBeenCalledTimes(1);

        emit(screen, "send-round", { lines: [{ productId: "cafe", quantity: "1" }] });
        await flush(el);

        // Appended to the tab's own working order, then re-read so the drawer reflects the new round.
        expect(addTabRound).toHaveBeenCalledWith("wo-7", [{ productId: "cafe", quantity: "1" }]);
        expect(getTabLines).toHaveBeenCalledTimes(2);
      });

      it("serve-line marks the line served then reloads its lines", async () => {
        const markLineServed = vi.fn().mockResolvedValue(undefined);
        const getTabLines = vi.fn().mockResolvedValue([tabLine]);
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          markLineServed,
          getTabLines,
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "serve-line", { lineNo: 1 });
        await flush(el);

        expect(markLineServed).toHaveBeenCalledWith("wo-7", 1);
        expect(getTabLines).toHaveBeenCalledTimes(2);
      });

      it("a failed round/serve/status write surfaces a non-fatal error, leaving the screen up", async () => {
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue([tabLine]),
          addTabRound: vi.fn().mockRejectedValue({ code: "tab.not_open" }),
          markLineServed: vi.fn().mockRejectedValue({ code: "tab.line_not_found" }),
          setTableStatus: vi.fn().mockRejectedValue({ code: "status.not_found" }),
        });
        const screen = await toTableOrder(el, openTable);

        for (const [type, detail] of [
          ["send-round", { lines: [{ productId: "cafe", quantity: "1" }] }],
          ["serve-line", { lineNo: 1 }],
          ["set-status", { statusId: "s1" }],
        ] as const) {
          emit(screen, type, detail);
          await flush(el);
          // Non-fatal: the operator stays on the table-order screen and sees the generic banner.
          expect(tableOrder(el)).not.toBeNull();
          expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(t("table.error"));
        }
      });

      it("set-status sets the table's manual status keyed by TABLE id (not the tab's order id)", async () => {
        const setTableStatus = vi.fn().mockResolvedValue(undefined);
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          setTableStatus,
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "set-status", { statusId: "s1" });
        await flush(el);

        // Keyed by the TABLE id "t2" (Ruling FP-F), never the tab's order id "wo-7".
        expect(setTableStatus).toHaveBeenCalledWith("t2", "s1");
      });

      it("pay-tab settles the WHOLE tab via recordSale with the tab id and NO re-price, then shows the ticket", async () => {
        const recordSale = vi.fn().mockResolvedValue(saleResult);
        const updateWorkingOrder = vi.fn().mockResolvedValue(undefined);
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue([tabLine]),
          recordSale,
          updateWorkingOrder,
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "pay-tab", { method: "cash", amount: "10.00" });
        await flush(el);

        // The server files the tab's STORED locked lines and ignores the sent basket, so we send `[]`
        // (the documented shape) tagged with the tab's order id — and crucially NEVER #syncIfDirty →
        // updateWorkingOrder, which would re-price and destroy the tab's locks (H2).
        expect(recordSale).toHaveBeenCalledWith([], { method: "cash", amount: "10.00" }, "wo-7");
        expect(updateWorkingOrder).not.toHaveBeenCalled();
        expect(ticket(el)).not.toBeNull();
      });

      it("a failed tab pay keeps the operator on the screen with a non-fatal error", async () => {
        const { el } = await mountApp({
          getTablesState: vi.fn().mockResolvedValue([openTable]),
          listZones: vi.fn().mockResolvedValue([floorZone]),
          getTabLines: vi.fn().mockResolvedValue([tabLine]),
          recordSale: vi.fn().mockRejectedValue({ code: "sale.rejected" }),
        });
        const screen = await toTableOrder(el, openTable);

        emit(screen, "pay-tab", { method: "cash", amount: "10.00" });
        await flush(el);

        expect(ticket(el)).toBeNull();
        expect(tableOrder(el)).not.toBeNull();
        expect(el.shadowRoot!.querySelector(".error")!.textContent).toContain(t("sale.error"));
      });

      it("back-to-floor reloads the occupancy read-model and returns to the floor", async () => {
        const getTablesState = vi.fn().mockResolvedValue([openTable]);
        const listZones = vi.fn().mockResolvedValue([floorZone]);
        const { el } = await mountApp({ getTablesState, listZones });
        const screen = await toTableOrder(el, openTable);
        // One load on entering the floor before opening the tab.
        expect(getTablesState).toHaveBeenCalledTimes(1);

        emit(screen, "back-to-floor");
        await flush(el);

        // A fresh occupancy read (a just-paid table shows free) and the floor is shown again.
        expect(getTablesState).toHaveBeenCalledTimes(2);
        expect(listZones).toHaveBeenCalledTimes(2);
        expect(floor(el)).not.toBeNull();
        expect(tableOrder(el)).toBeNull();
      });
    });
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

  // ---------------------------------------------------------------------------------------------
  // collect-card (integrated card terminal, sub-project 7 Task 8): same shape as confirm-payment
  // (single-flight, dirty-retrieved-order re-sync, held-list refresh on success) but branching on the
  // server's DATA outcome instead of assuming a ticket — a decline/timeout/network_unavailable must
  // never wedge the till (CLAUDE.md §5: nothing may block a sale but the sale itself). The widget that
  // EMITS `collect-card` is Task 9; these tests dispatch the synthetic event directly.
  // ---------------------------------------------------------------------------------------------

  describe("collect-card (integrated card terminal, Task 8)", () => {
    it("pays over the integrated terminal with the mapped lines(+tip+allowOffline), then shows the ticket", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      const store = c.store;
      store.addProduct(cafe, "2");
      await el.updateComplete;
      const workingOrderId = store.id; // the walk-up's stable id — the same pay-idempotency key

      emit(c, "collect-card", { tip: "0.50", allowOffline: true });
      await flush(el);

      expect(pay).toHaveBeenCalledWith({
        id: workingOrderId,
        lines: [{ productId: "cafe", quantity: "2" }],
        tip: "0.50",
        allowOffline: true,
      });
      const view = ticket(el)!;
      expect(view).not.toBeNull();
      expect(view.result).toBe(saleResult);
    });

    it("omits tip/allowOffline from the request when the event detail carries neither", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "1");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      expect(pay).toHaveBeenCalledWith({
        id: c.store.id,
        lines: [{ productId: "cafe", quantity: "1" }],
      });
    });

    it("success: refreshes the held-orders list so a just-paid parked order drops off", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult });
      const { el } = await mountApp({
        pay,
        listWorkingOrders: vi.fn().mockResolvedValueOnce([heldSummary]).mockResolvedValue([]),
      });
      const c = await toCounter(el);
      expect(c.heldOrders).toEqual([heldSummary]); // one call on entering the counter
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      // once on entering the counter, once after the successful pay — the settled order drops off.
      expect(currentApi.listWorkingOrders).toHaveBeenCalledTimes(2);
      expect(ticket(el)).not.toBeNull();
    });

    it("declined: stays on the counter with the basket intact and records the outcome for the widget", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      // A decline is data, never a fault: no ticket, still on the counter, basket untouched, and no
      // sale.error banner — the operator retries the card or switches tender, nothing is lost.
      expect(ticket(el)).toBeNull();
      expect(counter(el)).not.toBeNull();
      expect(c.store.lines).toHaveLength(1);
      expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
      // `cardOutcome` is `private` (TS's `private` is compile-time only, so the cast through
      // `unknown` still reads its real runtime value). `till-tender-pay` (Task 9) is the real reader
      // now — its own tests cover the rendered retry/switch-tender/wait output — so this layer stays
      // scoped to till-app's own state, the same way every other assertion in this file does.
      expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBe("declined");
      // The held list is re-read only on a captured outcome — nothing settled here, so no re-read.
      expect(currentApi.listWorkingOrders).toHaveBeenCalledOnce();
    });

    it.each(["timeout", "network_unavailable"] as const)(
      "%s: also stays on the counter with the basket intact and records the outcome",
      async (outcome) => {
        const pay = vi.fn().mockResolvedValue({ outcome });
        const { el } = await mountApp({ pay });
        const c = await toCounter(el);
        c.store.addProduct(cafe, "2");
        await el.updateComplete;

        emit(c, "collect-card", {});
        await flush(el);

        expect(ticket(el)).toBeNull();
        expect(counter(el)).not.toBeNull();
        expect(c.store.lines).toHaveLength(1);
        expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
        expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBe(outcome);
      },
    );

    it("clears a prior declined outcome when the next collect-card attempt starts", async () => {
      const pay = vi
        .fn()
        .mockResolvedValueOnce({ outcome: "declined" })
        .mockResolvedValueOnce({ outcome: "captured", ticket: saleResult });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {}); // first — declines
      await flush(el);
      expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBe("declined");

      emit(counter(el)!, "collect-card", {}); // retry — captures
      await flush(el);
      expect(ticket(el)).not.toBeNull();
    });

    // Fix round 1 (Important): cardOutcome must not survive the basket it describes being replaced.
    // errorKey is reset at every user action; cardOutcome was only reset in #onCollectCard itself and
    // #onNewSale, so a decline on basket A leaked into whatever basket the operator moved to next via
    // Park or Retrieve. Task 9 now threads `.cardOutcome` through `till-counter-screen`/`till-tender-pay`,
    // so a stale value here would reach the rendered card_outcome screen without this reset.
    it("park: a declined cardOutcome does not survive into the NEXT (empty) basket", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);
      expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBe("declined");

      // Switch tender instead of retrying the card: park the (still-declined) basket for later.
      emit(counter(el)!, "park-order", { label: "Mesa 4" });
      await flush(el);

      // store.clear() re-minted a fresh id — this is now an UNRELATED next-customer basket, and it
      // must not show the previous basket's decline.
      expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBeUndefined();
    });

    it("retrieve: a declined cardOutcome does not survive into a DIFFERENT retrieved order's basket", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);
      expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBe("declined");

      // Retrieve a DIFFERENT order (wo-1) into the basket instead of retrying the card.
      emit(counter(el)!, "retrieve-order", { id: "wo-1" });
      await flush(el);

      // loadFrom swapped in wo-1's lines — the decline described the basket that was just replaced,
      // not this one.
      expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBeUndefined();
      expect(c.store.id).toBe("wo-1");
    });

    it("discard: an UNRELATED held order being discarded does not touch the current basket's cardOutcome", async () => {
      // The deliberate non-fix: #onDiscardOrder addresses a held order by the EVENT's own id, never
      // `#store` — discarding some other parked order must not wipe a decline that still correctly
      // describes the basket that is still on the counter. Proves the deviation from treating discard
      // like park/retrieve is intentional, not an oversight.
      const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      const declinedBasketId = c.store.id;

      emit(c, "collect-card", {});
      await flush(el);
      expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBe("declined");

      emit(counter(el)!, "discard-order", { id: "some-other-held-order" });
      await flush(el);

      // The current basket (and its decline) is untouched — discard never reached `#store`.
      expect((el as unknown as { cardOutcome?: string }).cardOutcome).toBe("declined");
      expect(c.store.id).toBe(declinedBasketId);
      expect(c.store.lines).toHaveLength(1);
    });

    it("a genuine fault (thrown, incl. the recovery-corruption 500) surfaces sale.error, basket intact, no ticket", async () => {
      const pay = vi.fn().mockRejectedValue({ code: "server.internal" });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      expect(ticket(el)).toBeNull();
      expect(counter(el)).not.toBeNull();
      expect(c.store.lines).toHaveLength(1);
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("sale.error"));
      expect(el.shadowRoot!.textContent).not.toContain("server.internal"); // never leaks the raw code
    });

    it("single-flight: a second collect-card while pay is pending fires exactly once", async () => {
      // Same double-file safety as confirm-payment's single-flight test (CLAUDE.md §5): the first pay
      // never resolves, so a second collect-card dispatched in that window (double-tap / laggy link)
      // must be a no-op.
      const pay = vi.fn(() => new Promise<PayOutcome>(() => {})); // never resolves
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {}); // first — raises submitting, awaits
      await el.updateComplete;
      expect(counter(el)!.busy).toBe(true); // in flight → the pay affordance is disabled

      emit(c, "collect-card", {}); // second — guarded, a no-op
      await el.updateComplete;

      expect(pay).toHaveBeenCalledOnce();
    });

    it("resets the busy state after a declined outcome so the counter re-enables for a retry", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
      const { el } = await mountApp({ pay });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      expect(counter(el)!.busy).toBe(false);
    });

    it("retrieve → edit → collect-card re-syncs the edited basket BEFORE paying, so the edit is not dropped", async () => {
      // The same 7c regression #onConfirmPayment guards against (its own "Finding 2" test above): the
      // server's retrieved-order pay path files from the STORED lock and IGNORES req.lines for the
      // integrated route too (IntegratedPayRequest's own doc), so an edit made after retrieve must be
      // re-locked (updateWorkingOrder) BEFORE the pay or it is silently dropped from both the charge and
      // the filed record. Deleting the #syncIfDirty call in #onCollectCard makes this fail (the edit is
      // lost from both assertions below).
      const updateWorkingOrder = vi.fn().mockResolvedValue(undefined);
      const pay = vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult });
      const { el } = await mountApp({ updateWorkingOrder, pay });
      const c = await toCounter(el);
      const store = c.store;

      emit(c, "retrieve-order", { id: "wo-1" });
      await flush(el);
      store.addProduct(cafe, "1"); // the edit AFTER retrieve
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      expect(updateWorkingOrder).toHaveBeenCalledWith("wo-1", {
        lines: [
          { productId: "cafe", quantity: "2" },
          { productId: "cafe", quantity: "1" },
        ],
        label: "Mesa 4",
      });
      expect(pay).toHaveBeenCalledWith({
        id: "wo-1",
        lines: [
          { productId: "cafe", quantity: "2" },
          { productId: "cafe", quantity: "1" },
        ],
      });
      expect(updateWorkingOrder.mock.invocationCallOrder[0]!).toBeLessThan(
        pay.mock.invocationCallOrder[0]!,
      );
    });

    it("retrieve → collect-card (unedited): no re-sync, files the stored lock straight through", async () => {
      // Behaviour 1's mirror for the integrated route: an UNEDITED retrieve must NOT re-sync — that
      // would re-price against the live catalogue and defeat the add-time lock (design §3).
      const updateWorkingOrder = vi.fn().mockResolvedValue(undefined);
      const pay = vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult });
      const { el } = await mountApp({ updateWorkingOrder, pay });
      const c = await toCounter(el);

      emit(c, "retrieve-order", { id: "wo-1" });
      await flush(el);

      emit(c, "collect-card", {});
      await flush(el);

      expect(updateWorkingOrder).not.toHaveBeenCalled();
      expect(pay).toHaveBeenCalledWith({
        id: "wo-1",
        lines: [{ productId: "cafe", quantity: "2" }],
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Integrated card wiring (Task 9): `cardProvider`/`tipsEnabled`, read once from `GET /api/till`
  // (#boot), and `cardOutcome` (Task 8's state) all reach the REAL nested `till-tender-pay` — through
  // `till-counter-screen`, exactly like `orderFlow`/`stage` above (per-mode pay control).
  // ---------------------------------------------------------------------------------------------

  describe("integrated card wiring (Task 9): threaded from GET /api/till to the widget", () => {
    it("defaults cardProvider 'none'/tipsEnabled false, reproducing the #62 manual path unchanged", async () => {
      const { el } = await mountApp(); // the till fixture defaults cardProvider: "none"
      await toCounter(el);
      expect(tenderPay(el).cardProvider).toBe("none");
      expect(tenderPay(el).tipsEnabled).toBe(false);
    });

    it("threads a real integrated cardProvider + tipsEnabled through to the widget", async () => {
      const { el } = await mountApp({
        getTill: vi
          .fn()
          .mockResolvedValue({ ...till, cardProvider: "stripe_on_device", tipsEnabled: true }),
      });
      await toCounter(el);
      expect(tenderPay(el).cardProvider).toBe("stripe_on_device");
      expect(tenderPay(el).tipsEnabled).toBe(true);
    });

    it("threads a declined cardOutcome through to the widget, driving its card_outcome view", async () => {
      const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, cardProvider: "stripe_terminal" }),
        pay,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      expect(tenderPay(el).cardOutcome).toBe("declined");
      expect(tenderPay(el).shadowRoot!.querySelector(".retry")).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------
  // 7c prepare & collect: per-mode control selection (end-to-end, not just the widget in isolation)
  // and the prep queue rendered from fetched data.
  // ---------------------------------------------------------------------------------------------

  describe("per-mode pay control + station queue (KDS-1)", () => {
    it("boots into Mode P (prepay, the default): tender-pay shows the unchanged Pay flow, no station queue fetched or rendered", async () => {
      const { el } = await mountApp(); // the till fixture defaults orderFlow: "prepay"
      const c = await toCounter(el);
      expect(tenderPay(el).mode).toBe("prepay");
      expect(tenderPay(el).stage).toBe("order");
      expect(stationQueueWidget(el)).toBeNull(); // Mode P's layout omits the widget entirely
      expect(currentApi.getStationQueue).not.toHaveBeenCalled();
      expect(c.products).toEqual([cafe]); // sanity: still a normal counter otherwise
    });

    it("boots into Mode I (invoice_first): tender-pay starts on the order stage; the default station's queue is fetched and rendered", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
      });
      await toCounter(el);
      expect(tenderPay(el).mode).toBe("invoice_first");
      expect(tenderPay(el).stage).toBe("order");
      expect(stationQueueWidget(el)).not.toBeNull();
      // Resolves the default station once, then reads its queue on entering the counter.
      expect(currentApi.listStations).toHaveBeenCalledOnce();
      expect(currentApi.getStationQueue).toHaveBeenCalledWith("st-default");
    });

    it("boots into Mode T (ticket_then_pay): the same per-mode selection applies", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
      });
      await toCounter(el);
      expect(tenderPay(el).mode).toBe("ticket_then_pay");
      expect(stationQueueWidget(el)).not.toBeNull();
    });

    it("renders the station queue from fetched data, not just an empty placeholder", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
        getStationQueue: vi.fn().mockResolvedValue([stationGroup]),
      });
      await toCounter(el);
      expect(stationQueueWidget(el)!.groups).toEqual([stationGroup]);
    });

    it("no default station configured leaves the counter queue empty rather than throwing", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
        listStations: vi.fn().mockResolvedValue([{ ...defaultStation, isDefault: false }]),
      });
      await toCounter(el);
      expect(currentApi.getStationQueue).not.toHaveBeenCalled();
      expect(stationQueueWidget(el)!.groups).toEqual([]);
    });

    it("place-order (fresh basket): parks then places, moves to the collect stage, refreshes the prep queue", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      const id = c.store.id;
      expect(c.store.persisted).toBe(false); // a fresh walk-up basket, never parked

      emit(c, "place-order");
      await flush(el);

      expect(currentApi.parkOrder).toHaveBeenCalledWith({
        id,
        lines: [{ productId: "cafe", quantity: "2" }],
        label: undefined,
      });
      expect(currentApi.placeOrder).toHaveBeenCalledWith(id);
      expect(currentApi.updateWorkingOrder).not.toHaveBeenCalled();
      expect(c.store.persisted).toBe(true); // marked persisted after the successful park
      expect(tenderPay(el).stage).toBe("collect"); // Place → Collect
      expect(counter(el)).not.toBeNull(); // stays on the counter (no ticket for a mere place)
      expect(ticket(el)).toBeNull();
      // once on entering the counter, once after the successful place (Modes I/T auto-enqueue).
      expect(currentApi.getStationQueue).toHaveBeenCalledTimes(2);
    });

    it("place-order on an UNEDITED retrieved order does NOT re-sync — placeOrder files the stored composition", async () => {
      // Symmetric with the unedited retrieve→pay path (Behaviour 1 above): retrieving adopts the order's
      // id and marks it persisted+clean (loadFrom). An UNEDITED retrieved order must NOT re-sync before
      // placing — `updateWorkingOrder` re-prices with the LIVE catalogue and would replace the add-time
      // lock, filing at the place-time price and defeating the line-add snapshot (design §3: placing does
      // not re-lock price). It must never re-park either (a re-park of the same id would idempotently
      // REPLAY the existing open order server-side and discard the edit). `placeOrder` files the STORED
      // composition straight. Removing the `dirty` gate in `#syncIfDirty` makes this fail (the unedited
      // order re-syncs).
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
      });
      const c = await toCounter(el);

      emit(c, "retrieve-order", { id: "wo-1" });
      await flush(el);
      expect(c.store.persisted).toBe(true);
      expect(c.store.dirty).toBe(false); // retrieved but never edited

      emit(c, "place-order");
      await flush(el);

      expect(currentApi.parkOrder).not.toHaveBeenCalled();
      expect(currentApi.updateWorkingOrder).not.toHaveBeenCalled();
      expect(currentApi.placeOrder).toHaveBeenCalledWith("wo-1");
      expect(tenderPay(el).stage).toBe("collect");
    });

    it("place-order on an EDITED retrieved order re-syncs the edit via updateWorkingOrder before placing", async () => {
      // The mirror of the pay path's retrieve→edit→pay: an edit made after retrieve must be re-locked
      // (`updateWorkingOrder`) BEFORE placing, or the server places the STORED lock and silently drops
      // the edit. Retrieve wo-1 (café×2), add a second café, then place: `updateWorkingOrder` carries the
      // EDITED composition and runs BEFORE `placeOrder`. Deleting the `#syncIfDirty` call in the
      // persisted branch of `#onPlaceOrder` makes this fail (the edit is lost).
      const updateWorkingOrder = vi.fn().mockResolvedValue(undefined);
      const placeOrder = vi.fn().mockResolvedValue(placedResult);
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        updateWorkingOrder,
        placeOrder,
      });
      const c = await toCounter(el);

      emit(c, "retrieve-order", { id: "wo-1" });
      await flush(el);
      c.store.addProduct(cafe, "1"); // the edit AFTER retrieve → the basket is dirty
      await el.updateComplete;

      emit(c, "place-order");
      await flush(el);

      expect(currentApi.parkOrder).not.toHaveBeenCalled();
      expect(updateWorkingOrder).toHaveBeenCalledWith("wo-1", {
        lines: [
          { productId: "cafe", quantity: "2" }, // retrieved
          { productId: "cafe", quantity: "1" }, // the edit
        ],
        label: "Mesa 4",
      });
      expect(placeOrder).toHaveBeenCalledWith("wo-1");
      expect(updateWorkingOrder.mock.invocationCallOrder[0]!).toBeLessThan(
        placeOrder.mock.invocationCallOrder[0]!,
      );
      expect(tenderPay(el).stage).toBe("collect");
    });

    it("place-order on an EDITED retrieved order already placed elsewhere: the re-tap surfaces place.error (placeOrder is not idempotent)", async () => {
      // The concurrent-place race / lost-response re-tap: the order has already moved past `open` (placed
      // on another register, or the first place landed and its response was lost). The edit-gated re-sync
      // calls `updateWorkingOrder`, which returns `working_order.not_open` — SWALLOWED by `#syncIfDirty` —
      // and then the server's `placeOrder`, which is NOT idempotent (it refuses ANY non-open order with
      // the same `working_order.not_open`; till-api.test.ts pins that 409), returns `not_open` too. So
      // `#onPlaceOrder` surfaces `place.error` and stays on the ORDER stage — it does NOT fall through to
      // collect: placing has no `sales_working_order_id_key` replay the way pay does. Both server calls are
      // mocked to reject `not_open`, matching the real server (the earlier revision mocked `placeOrder` to
      // SUCCESS, an impossible pairing — `placeOrder` succeeds only when the order is open, which is exactly
      // when `updateWorkingOrder` would not have thrown). Removing `#onPlaceOrder`'s place.error handler,
      // or advancing the stage on a failed place, makes this fail.
      const updateWorkingOrder = vi.fn().mockRejectedValue({ code: "working_order.not_open" });
      const placeOrder = vi.fn().mockRejectedValue({ code: "working_order.not_open" });
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
        updateWorkingOrder,
        placeOrder,
      });
      const c = await toCounter(el);

      emit(c, "retrieve-order", { id: "wo-1" });
      await flush(el);
      c.store.addProduct(cafe, "1"); // edit → dirty → re-sync attempted
      await el.updateComplete;

      emit(c, "place-order");
      await flush(el);

      expect(tenderPay(el).stage).toBe("order"); // NOT advanced to collect — the place failed
      expect(ticket(el)).toBeNull(); // stays on the counter, no ticket
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("place.error"));
      expect(el.shadowRoot!.textContent).not.toContain("working_order.not_open"); // raw code never leaks
    });

    it("a failed place keeps the counter, the order stage and the basket, showing a non-fatal error", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
        parkOrder: vi.fn().mockRejectedValue({ code: "working_order.rejected" }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "place-order");
      await flush(el);

      expect(currentApi.placeOrder).not.toHaveBeenCalled(); // never reached — the park failed first
      expect(tenderPay(el).stage).toBe("order"); // never advanced
      expect(counter(el)).not.toBeNull();
      expect(c.store.lines).toHaveLength(1); // basket intact
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("place.error"));
      expect(el.shadowRoot!.textContent).not.toContain("working_order.rejected");
    });

    it("place single-flight: a second place-order while the first is pending places EXACTLY ONCE", async () => {
      const parkOrder = vi.fn(() => new Promise(() => {})); // never resolves
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
        parkOrder,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;

      emit(c, "place-order"); // first — raises the guard, awaits
      await el.updateComplete;
      expect(counter(el)!.busy).toBe(true); // in flight → the Place affordance is disabled
      emit(c, "place-order"); // second — guarded, a no-op
      await el.updateComplete;

      expect(parkOrder).toHaveBeenCalledOnce();
    });

    it("collect-order: settles the placed order and shows the ticket", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      const id = c.store.id;
      emit(c, "place-order");
      await flush(el);
      expect(tenderPay(el).stage).toBe("collect");

      emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
      await flush(el);

      expect(currentApi.collectOrder).toHaveBeenCalledWith(id, { method: "cash", amount: "5" });
      const view = ticket(el)!;
      expect(view).not.toBeNull();
      // The ticket renders the SERVER collect result (its `lines` are the filed placed composition),
      // not the local basket — a local edit between place and collect can't diverge the printed list.
      expect(view.result).toBe(saleResult);
    });

    it("a failed collect keeps the counter (collect stage) and the basket, showing a non-fatal error", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
        collectOrder: vi.fn().mockRejectedValue({ code: "working_order.not_placed" }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "place-order");
      await flush(el);

      emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
      await flush(el);

      expect(ticket(el)).toBeNull();
      expect(counter(el)).not.toBeNull();
      expect(tenderPay(el).stage).toBe("collect"); // still awaiting collection
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("sale.error"));
      expect(el.shadowRoot!.textContent).not.toContain("working_order.not_placed");
    });

    it("collect single-flight: a second collect-order while the first is pending collects EXACTLY ONCE", async () => {
      const collectOrder = vi.fn(() => new Promise<TillSaleResult>(() => {})); // never resolves
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
        collectOrder,
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "place-order");
      await flush(el);

      emit(counter(el)!, "collect-order", { method: "cash", amount: "5" }); // first — awaits
      await el.updateComplete;
      expect(counter(el)!.busy).toBe(true);
      emit(counter(el)!, "collect-order", { method: "cash", amount: "5" }); // second — guarded
      await el.updateComplete;

      expect(collectOrder).toHaveBeenCalledOnce();
    });

    it("new-sale resets the collect stage back to order for the next basket", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "place-order");
      await flush(el);
      emit(counter(el)!, "collect-order", { method: "cash", amount: "5" });
      await flush(el);
      expect(ticket(el)).not.toBeNull();

      emit(ticket(el)!, "new-sale");
      await flush(el);

      expect(tenderPay(el).stage).toBe("order");
    });

    it("advance-ticket-item: advances the line, then refreshes the default station's queue", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
        getStationQueue: vi.fn().mockResolvedValueOnce([stationGroup]).mockResolvedValue([]),
      });
      const c = await toCounter(el);
      expect(stationQueueWidget(el)!.groups).toEqual([stationGroup]);

      emit(c, "advance-ticket-item", { itemId: "ti-1", to: "preparing" });
      await flush(el);

      expect(currentApi.advanceTicketItem).toHaveBeenCalledWith("ti-1", "preparing");
      // once on entering the counter, once after the advance.
      expect(currentApi.getStationQueue).toHaveBeenCalledTimes(2);
      expect(stationQueueWidget(el)!.groups).toEqual([]);
    });

    it("a failed advance-ticket-item still refreshes the queue and shows a non-fatal error", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
        advanceTicketItem: vi.fn().mockRejectedValue({ code: "ticket.invalid_transition" }),
      });
      const c = await toCounter(el);

      emit(c, "advance-ticket-item", { itemId: "ti-1", to: "preparing" });
      await flush(el);

      // the refresh runs even though the advance rejected — a stale entry corrects itself.
      expect(currentApi.getStationQueue).toHaveBeenCalledTimes(2);
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("station.advance_error"));
      expect(el.shadowRoot!.textContent).not.toContain("ticket.invalid_transition");
    });

    // The app's `#onMarkCollected` is mode-independent (it stamps a settled order's handover and reloads);
    // the reload is only OBSERVABLE where the counter's queue is live — Modes I/T — since `#refreshStationQueue`
    // skips Mode P by a pre-existing decision (`sendToPrep` has no counter UI yet). So these exercise the
    // handler wiring under `invoice_first`, exactly as the advance-ticket-item tests above do.
    it("mark-collected: hands over the order via markCollected, then refreshes the default station's queue", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
        getStationQueue: vi.fn().mockResolvedValueOnce([stationGroup]).mockResolvedValue([]),
      });
      const c = await toCounter(el);
      expect(stationQueueWidget(el)!.groups).toEqual([stationGroup]);

      emit(c, "mark-collected", { orderId: "wo-1" });
      await flush(el);

      expect(currentApi.markCollected).toHaveBeenCalledWith("wo-1");
      // once on entering the counter, once after the handover — so the collected order drops off the queue.
      expect(currentApi.getStationQueue).toHaveBeenCalledTimes(2);
      expect(stationQueueWidget(el)!.groups).toEqual([]);
    });

    it("a failed mark-collected still refreshes the queue and shows a non-fatal error", async () => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "invoice_first" }),
        markCollected: vi.fn().mockRejectedValue({ code: "working_order.already_collected" }),
      });
      const c = await toCounter(el);

      emit(c, "mark-collected", { orderId: "wo-1" });
      await flush(el);

      expect(currentApi.getStationQueue).toHaveBeenCalledTimes(2);
      const banner = el.shadowRoot!.querySelector('[role="alert"]')!;
      expect(banner.textContent).toContain(t("station.collect_error"));
      expect(el.shadowRoot!.textContent).not.toContain("working_order.already_collected");
    });

    it("show-station: the counter nav switches to the station-display screen (basket-preserving)", async () => {
      const { el } = await mountApp();
      const c = await toCounter(el);
      c.store.addProduct(cafe, "1"); // a basket in progress
      await el.updateComplete;

      emit(c, "show-station");
      await flush(el);

      expect(el.shadowRoot!.querySelector("till-station-screen")).not.toBeNull();
      expect(counter(el)).toBeNull();
      // The basket survives the trip (till-owned store, not per-counter), like the schedule/floor nav —
      // still one line even while the counter is unmounted and the station screen is showing.
      expect(c.store.lines).toHaveLength(1);

      // Back returns to the counter with the basket intact.
      emit(el.shadowRoot!.querySelector("till-station-screen")!, "back-to-counter");
      await flush(el);
      expect(counter(el)).not.toBeNull();
      expect(counter(el)!.store.lines).toHaveLength(1);
    });

    it("threads the venue bump_mode from boot to the station screen (a ticket-mode venue gets whole-ticket bump)", async () => {
      // The default `till` fixture is `line`; a venue configured `ticket` must reach the station
      // screen's `.bumpMode` so its whole-ticket affordance turns on — proving #boot reads
      // `TillInfo.bumpMode` rather than leaving the hardcoded `line` default.
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, bumpMode: "ticket" }),
      });
      const c = await toCounter(el);
      emit(c, "show-station");
      await flush(el);
      const screen = el.shadowRoot!.querySelector("till-station-screen") as unknown as {
        bumpMode: string;
      };
      expect(screen.bumpMode).toBe("ticket");
    });

    it("threads the venue fire_control from boot to the station screen (a kitchen-fire venue gets the fire action)", async () => {
      // The default `till` fixture is `waiter`; a venue configured `kitchen` must reach the station
      // screen's `.fireControl` so its per-course fire affordance turns on — proving #boot reads
      // `TillInfo.fireControl` rather than leaving the hardcoded `waiter` default.
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, fireControl: "kitchen" }),
      });
      const c = await toCounter(el);
      emit(c, "show-station");
      await flush(el);
      const screen = el.shadowRoot!.querySelector("till-station-screen") as unknown as {
        fireControl: string;
      };
      expect(screen.fireControl).toBe("kitchen");
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Layout & receipt editors (Task 9): #boot reads `layout`/`receipt` from GET /api/till. An AUTHORED
  // layout (structurally different from the built-in default) renders VERBATIM — no Mode-P filter, the
  // owner's choice (design §7); a DEFAULT or ABSENT layout keeps slice 1's Mode-P prep-queue drop as
  // the fallback (#layoutFor). `receipt` is threaded to the ticket view. The `till` fixture above OMITS
  // both fields, so every pre-Task-9 test exercises the ABSENT→fallback branch.
  // ---------------------------------------------------------------------------------------------

  describe("authored layout + receipt (design §7)", () => {
    // A full 6-widget layout, but prep-queue FIRST — a structural difference from LAYOUT_A (reordered),
    // so it is AUTHORED, not the default.
    const authoredReordered: LayoutDef = [
      { type: "prep-queue", region: "aside", config: {} },
      { type: "product-grid", region: "main", config: {} },
      { type: "basket", region: "aside", config: {} },
      { type: "total", region: "aside", config: {} },
      { type: "tender-pay", region: "aside", config: {} },
      { type: "held-orders", region: "aside", config: {} },
    ];

    const gridOf = (el: TillApp) =>
      counter(el)!.shadowRoot!.querySelector<TillProductGrid>("till-product-grid")!;

    it("renders an AUTHORED layout verbatim — under Mode P an authored prep-queue is NOT dropped", async () => {
      // The two-branch proof (this is the AUTHORED half): under Mode P the default fallback would drop
      // prep-queue, but an authored layout is rendered verbatim, so the owner's prep-queue survives.
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          orderFlow: "prepay",
          layout: authoredReordered,
          receipt: {},
        }),
      });
      const c = await toCounter(el);
      // the authored arrangement reached the counter verbatim (order preserved)
      expect(c.layout).toEqual(authoredReordered);
      // and under Mode P the authored prep-queue is present — the mode filter did NOT run
      expect(stationQueueWidget(el)).not.toBeNull();
    });

    it("threads an authored product-grid `columns` config end to end to the grid widget", async () => {
      // A full layout identical to the default EXCEPT product-grid carries `columns: 4` — a config
      // difference makes it AUTHORED (rendered verbatim), and the value reaches the real grid widget.
      const authoredColumns: LayoutDef = [
        { type: "product-grid", region: "main", config: { columns: 4 } },
        { type: "basket", region: "aside", config: {} },
        { type: "total", region: "aside", config: {} },
        { type: "tender-pay", region: "aside", config: {} },
        { type: "held-orders", region: "aside", config: {} },
        { type: "prep-queue", region: "aside", config: {} },
      ];
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, layout: authoredColumns, receipt: {} }),
      });
      await toCounter(el);
      expect(gridOf(el).columns).toBe(4);
    });

    it("a layout structurally EQUAL to the default keeps the Mode-P prep-queue drop (default detection)", async () => {
      // The two-branch proof (this is the DEFAULT half): a VALUE-copy of LAYOUT_A (not the local
      // reference — it arrives as fresh JSON) is detected as the default, so under Mode P the fallback
      // still drops prep-queue exactly as slice 1 shipped. Making isDefaultLayout return a constant
      // false breaks this (prep-queue would survive); returning constant true breaks the authored test.
      const defaultCopy: LayoutDef = LAYOUT_A.map((w) => ({ ...w, config: { ...w.config } }));
      const { el } = await mountApp({
        getTill: vi
          .fn()
          .mockResolvedValue({ ...till, orderFlow: "prepay", layout: defaultCopy, receipt: {} }),
      });
      await toCounter(el);
      expect(stationQueueWidget(el)).toBeNull();
    });

    it("falls back to #layoutFor() when GET /api/till OMITS `layout` (older server): Mode P drops prep-queue", async () => {
      // The `till` fixture carries no `layout` — #boot leaves receivedLayout undefined, so #layoutFor()
      // applies the Mode-P prep-queue drop, the slice-1 behaviour, unchanged.
      const { el } = await mountApp();
      await toCounter(el);
      expect(stationQueueWidget(el)).toBeNull();
    });

    it("threads the receipt trim from getTill through to the ticket view", async () => {
      const receipt = { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias por su visita" };
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, layout: LAYOUT_A, receipt }),
      });
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      expect(ticket(el)!.receipt).toEqual(receipt);
    });

    it("defaults the ticket receipt to {} when GET /api/till omits it (older server)", async () => {
      const { el } = await mountApp(); // the `till` fixture omits `receipt`
      const c = await toCounter(el);
      c.store.addProduct(cafe, "2");
      await el.updateComplete;
      emit(c, "confirm-payment", { method: "cash", amount: "5" });
      await flush(el);
      expect(ticket(el)!.receipt).toEqual({});
    });
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
