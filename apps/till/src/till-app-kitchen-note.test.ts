import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget, servedMenus } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillBasket } from "./widgets/basket.js";
import type { TillOrderKitchenNote } from "./widgets/order-kitchen-note.js";
import type { CanvasDef, CapabilityFlag } from "./layout.js";
import type {
  HeldOrder,
  TabLine,
  TabLines,
  TillApi,
  TillProduct,
  ZoneOfferCatalogue,
} from "./api/client.js";
const canvas: CanvasDef = {
  formFactor: "till",
  tabs: [
    {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [
        { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
        { type: "basket", colSpan: 4, rowSpan: 6, config: {} },
      ],
    },
  ],
};

const till = {
  locale: "en",
  invoiceLocale: "es-ES",
  venueName: "Bar Pepe",
  nif: "B12345678",
  orderFlow: "prepay" as const,
  receiptPrintMode: "auto" as const,
  bumpMode: "line" as const,
  fireControl: "waiter" as const,
  courses: [] as { id: string; name: string; displayOrder: number }[],
  cardProvider: "none" as const,
  tipsEnabled: false,
  canvas,
  capabilities: ["print-receipt"] as CapabilityFlag[],
  inactivityTimeoutSeconds: null as number | null,
  nodeId: "n1",
  servers: [],
};

const offers: ZoneOfferCatalogue = {
  service: { open: true, zoneOpen: true, periodName: null, keepOpen: null, zoneKeepOpen: null },
  context: {
    departmentName: "Restaurant",
    zoneId: "zone-counter",
    departmentId: "department-default",
    serviceMode: "prepay",
  },
  defaultMenuId: null,
  menus: servedMenus([{ id: "cat-default", name: "Carta", isDefault: true, versionId: "v1" }], []),
  offers: [],
};

const product = (id: string, name: string, unitPrice: string): TillProduct => ({
  id,
  menuItemId: `mi-${id}`,
  catalogueId: "cat-default",
  name,
  pricingUnit: "each",
  unitPrice,
  vatClass: "general",
  category: null,
  allergens: null,
});

const tabLine = (over: Partial<TabLine> & Pick<TabLine, "id" | "lineNo">): TabLine => ({
  stationId: null,
  movable: false,
  productId: null,
  parentLineNo: null,
  quantity: "1.000",
  unitPrecision: 0,
  unitPriceGross: "1.00",
  servedAt: null,
  courseId: null,
  sentAt: null,
  firedAt: null,
  state: null,
  groupId: null,
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
  ...over,
});

/** Croquetas the kitchen has, and a caña at `canaPrice` (given away when not 2.50). */
function heldOrder(revision: number, canaPrice = "2.50", canaQuantity = "1.000"): HeldOrder {
  return {
    id: "wo-9",
    orderNumber: 12,
    label: "Mesa 4",
    revision,
    kitchenNote: {
      scope: { workingOrderId: "wo-9" },
      note: null,
      revision: 0,
      ownerRevision: revision,
    },
    lines: [
      {
        workingOrderLineId: "l-1",
        productId: "croquetas",
        quantity: "1.000",
        product: product("croquetas", "Croquetas", "6.00"),
      },
      {
        workingOrderLineId: "l-2",
        productId: "cana",
        quantity: canaQuantity,
        product: product("cana", "Caña", canaPrice),
      },
    ],
  } as HeldOrder;
}

function listing(revision: number, canaPrice = "2.50", canaQuantity = "1.000"): TabLines {
  return {
    revision,
    editSentLines: true,
    lines: [
      tabLine({
        id: "l-1",
        lineNo: 1,
        name: "Croquetas",
        productId: "croquetas",
        unitPriceGross: "6.00",
        sentAt: "2026-09-30T09:00:00.000Z",
        firedAt: "2026-09-30T09:00:00.000Z",
        state: "queued",
      }),
      tabLine({
        id: "l-2",
        lineNo: 2,
        name: "Caña",
        productId: "cana",
        quantity: canaQuantity,
        unitPriceGross: canaPrice,
        ...(canaPrice === "2.50" ? {} : { listUnitPriceGross: "2.50" }),
      }),
    ],
  };
}

function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "en",
      loginDefault: "en",
    }),
    getTill: vi.fn().mockResolvedValue(till),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
    }),
    getDeviceStationScreen: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    listStaff: vi.fn().mockResolvedValue([]),
    listDefaultZoneOffers: vi.fn().mockResolvedValue(offers),
    listZoneOffers: vi.fn().mockResolvedValue(offers),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    listStatuses: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    logout: vi.fn().mockResolvedValue(undefined),
    retrieveWorkingOrder: vi
      .fn()
      .mockResolvedValueOnce(heldOrder(4))
      .mockResolvedValue(heldOrder(5, "0.00")),
    getTabLines: vi.fn().mockResolvedValueOnce(listing(4)).mockResolvedValue(listing(5, "0.00")),
    recordSale: vi.fn().mockRejectedValue({ code: "server.internal" }),
    pay: vi.fn().mockResolvedValue({ outcome: "declined" }),
    placeOrder: vi.fn().mockResolvedValue(undefined),
    parkOrder: vi.fn().mockResolvedValue({ id: "new", orderNumber: 1 }),
    updateWorkingOrder: vi.fn().mockResolvedValue({ revision: 6 }),
    setWorkingOrderLabel: vi.fn().mockResolvedValue({ revision: 6 }),
    setKitchenNote: vi.fn().mockResolvedValue({
      scope: { workingOrderId: "wo-9" },
      note: "Together",
      revision: 2,
      ownerRevision: 4,
    }),
    ...overrides,
  } as unknown as TillApi;
}
let api: TillApi;
async function flush(el: TillApp) {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}
function emit(source: Element, type: string, detail?: unknown) {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}
const counter = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
const basket = (el: TillApp) =>
  counter(el)
    .shadowRoot!.querySelector("till-card-grid")!
    .shadowRoot!.querySelector<TillBasket>("till-basket")!;
const heading = (el: TillApp) =>
  basket(el).shadowRoot!.querySelector<TillOrderKitchenNote>("till-order-kitchen-note")!;
async function mounted(overrides: Record<string, unknown> = {}, retrieve = true) {
  api = stubApi(overrides);
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flush(el);
  emit(el.shadowRoot!.querySelector("till-lock-screen")!, "logged-in", {
    personId: "p1",
    displayName: "Ana",
    permissions: [],
  });
  await flush(el);
  if (retrieve) {
    emit(counter(el), "retrieve-order", { id: "wo-9" });
    await flush(el);
  }
  return el;
}
async function edit(el: TillApp, text: string) {
  const h = heading(el);
  await userEvent.click(
    page.elementLocator(h.shadowRoot!.querySelector<HTMLElement>("[data-edit]")!),
  );
  await h.updateComplete;
  const field = h.shadowRoot!.querySelector("wt-textarea")!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("textarea")!), text);
  await userEvent.click(
    page.elementLocator(h.shadowRoot!.querySelector<HTMLElement>("[data-save]")!),
  );
  await flush(el);
  return h;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const initialUrl = location.href;
const previousLocale = currentLocale();
beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale(previousLocale);
  history.replaceState(null, "", initialUrl);
});
describe("whole-order kitchen notes through the app", () => {
  it("retrieves the canonical party note with its own note revision", async () => {
    const order = {
      ...heldOrder(4),
      kitchenNote: {
        scope: { partyId: "party-7" },
        note: "Train at 14:30",
        revision: 3,
        ownerRevision: 8,
      },
    };
    const el = await mounted({ retrieveWorkingOrder: vi.fn().mockResolvedValue(order) });
    expect(basket(el).store.kitchenNote).toBe("Train at 14:30");
    expect(basket(el).store.kitchenNoteScopeKey).toBe("party:party-7");
    expect(basket(el).store.kitchenNoteRevision).toBe(3);
    expect(basket(el).store.dirty).toBe(false);
    expect(basket(el).store.kitchenNoteDirty).toBe(false);
  });
  it.each(["cash", "card", "hold", "place"])("passes a fresh note before %s", async (action) => {
    const el = await mounted({}, false);
    const store = basket(el).store;
    store.addProduct(product("cana", "Caña", "2.50"), "1");
    store.kitchenNote = "Together";
    await flush(el);
    if (action === "cash") emit(counter(el), "confirm-payment", { method: "cash", amount: "5.00" });
    if (action === "card") emit(counter(el), "collect-card", {});
    if (action === "hold") emit(counter(el), "park-order", {});
    if (action === "place") emit(counter(el), "place-order");
    await flush(el);
    if (action === "cash") expect(vi.mocked(api.recordSale).mock.calls[0]?.[6]).toBe("Together");
    if (action === "card")
      expect(vi.mocked(api.pay).mock.calls[0]?.[0].kitchenNote).toBe("Together");
    if (action === "hold" || action === "place")
      expect(vi.mocked(api.parkOrder).mock.calls[0]?.[0].kitchenNote).toBe("Together");
  });
  it("saves a retrieved note without replacing or repricing dishes", async () => {
    const order = {
      ...heldOrder(4),
      kitchenNote: {
        scope: { workingOrderId: "wo-9" },
        note: "Old",
        revision: 1,
        ownerRevision: 4,
      },
    };
    const el = await mounted({ retrieveWorkingOrder: vi.fn().mockResolvedValue(order) });
    const h = heading(el);
    const store = basket(el).store;
    const lines = store.lines;
    emit(h, "save-kitchen-note", {
      scopeKey: "order:wo-9",
      revision: 1,
      visit: store.loadGeneration,
      note: "Together",
    });
    await flush(el);
    expect(api.setKitchenNote).toHaveBeenCalledWith(
      { workingOrderId: "wo-9" },
      {
        submissionId: expect.any(String),
        expectedNoteRevision: 1,
        expectedOrderRevision: 4,
        partyId: null,
        note: "Together",
      },
    );
    expect(store.kitchenNote).toBe("Together");
    expect(store.kitchenNoteRevision).toBe(2);
    expect(store.kitchenNoteDirty).toBe(false);
    expect(store.lines).toEqual(lines);
    expect(api.updateWorkingOrder).not.toHaveBeenCalled();
    expect(api.parkOrder).not.toHaveBeenCalled();
  });
});

describe("note-save ownership and ordering", () => {
  it("uses the captured party owner revision for a bill retrieved on Counter", async () => {
    const snapshot = { scope: { partyId: "party-7" }, note: "Old", revision: 3, ownerRevision: 8 };
    const el = await mounted({
      retrieveWorkingOrder: vi.fn().mockResolvedValue({ ...heldOrder(4), kitchenNote: snapshot }),
      setKitchenNote: vi
        .fn()
        .mockResolvedValue({ ...snapshot, note: "Together", revision: 4, ownerRevision: 9 }),
    });
    await edit(el, "Together");
    expect(api.setKitchenNote).toHaveBeenCalledWith(
      { partyId: "party-7" },
      {
        submissionId: expect.any(String),
        expectedNoteRevision: 3,
        expectedPartyRevision: 8,
        note: "Together",
      },
    );
    expect(basket(el).store.kitchenNoteOwnerRevision).toBe(9);
    expect(heading(el).shadowRoot!.querySelector("wt-dialog")).toBeNull();
  });
  it.each(["pay", "hold", "place"])(
    "waits for a note save before %s and blocks after failure",
    async (action) => {
      const pending = deferred<never>();
      const el = await mounted({ setKitchenNote: vi.fn().mockReturnValue(pending.promise) });
      await edit(el, "Together");
      if (action === "pay")
        emit(counter(el), "confirm-payment", { method: "cash", amount: "10.00" });
      if (action === "hold") emit(counter(el), "park-order", {});
      if (action === "place") emit(counter(el), "place-order");
      await flush(el);
      expect(api.recordSale).not.toHaveBeenCalled();
      expect(api.parkOrder).not.toHaveBeenCalled();
      expect(api.placeOrder).not.toHaveBeenCalled();
      pending.reject(new TypeError("offline"));
      await flush(el);
      expect(api.recordSale).not.toHaveBeenCalled();
      expect(api.parkOrder).not.toHaveBeenCalled();
      expect(api.placeOrder).not.toHaveBeenCalled();
      expect(heading(el).shadowRoot!.querySelector("wt-dialog")?.open).toBe(true);
    },
  );
  it("reuses the exact saved request after a lost response and keeps the modal draft", async () => {
    const setKitchenNote = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue({
        scope: { workingOrderId: "wo-9" },
        note: "Together",
        revision: 1,
        ownerRevision: 4,
      });
    const el = await mounted({ setKitchenNote });
    const h = await edit(el, "Together");
    expect(h.shadowRoot!.querySelector("wt-dialog")?.open).toBe(true);
    expect(h.shadowRoot!.querySelector("wt-textarea")!.value).toBe("Together");
    await userEvent.click(
      page.elementLocator(h.shadowRoot!.querySelector<HTMLElement>("[data-save]")!),
    );
    await flush(el);
    expect(setKitchenNote).toHaveBeenCalledTimes(2);
    expect(setKitchenNote.mock.calls[1]).toEqual(setKitchenNote.mock.calls[0]);
    expect(h.shadowRoot!.querySelector("wt-dialog")).toBeNull();
  });
  it.each(["replacement", "same-id reload", "logout"])(
    "discards a successful save after %s",
    async (change) => {
      const pending = deferred<{
        scope: { workingOrderId: string };
        note: string;
        revision: number;
        ownerRevision: number;
      }>();
      const el = await mounted({ setKitchenNote: vi.fn().mockReturnValue(pending.promise) });
      const store = basket(el).store;
      if (change === "logout")
        emit(heading(el), "save-kitchen-note", {
          scopeKey: "order:wo-9",
          revision: 0,
          visit: store.loadGeneration,
          note: "Old request",
        });
      else await edit(el, "Old request");
      if (change === "replacement") store.clear();
      if (change === "same-id reload")
        store.loadFrom(store.id, store.lines.slice(), undefined, 9, {
          note: "New read",
          revision: 4,
          scopeKey: `order:${store.id}`,
          ownerRevision: 9,
        });
      if (change === "logout") {
        const configured = vi.spyOn(el.sessionActivity, "configure");
        emit(counter(el), "logout");
        await flush(el);
        const discard = el.shadowRoot!.querySelector<HTMLElement>("[data-discard]");
        if (discard) discard.click();
        await flush(el);
        configured.mockRestore();
      }
      await flush(el);
      if (change === "logout")
        expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull();
      pending.resolve({
        scope: { workingOrderId: "wo-9" },
        note: "Old request",
        revision: 1,
        ownerRevision: 4,
      });
      await flush(el);
      expect(store.kitchenNote).toBe(change === "same-id reload" ? "New read" : null);
      expect(api.recordSale).not.toHaveBeenCalled();
    },
  );
  it("rereads a conflict without overwriting another basket and requires a new edit", async () => {
    const saved = {
      scope: { workingOrderId: "wo-9" },
      note: "Other till",
      revision: 4,
      ownerRevision: 6,
    };
    const getKitchenNote = vi.fn().mockResolvedValue(saved);
    const el = await mounted({
      getKitchenNote,
      setKitchenNote: vi.fn().mockRejectedValue({ code: "kitchen_note.out_of_date" }),
    });
    const h = await edit(el, "My draft");
    expect(getKitchenNote).toHaveBeenCalledWith({ workingOrderId: "wo-9" });
    expect(basket(el).store.kitchenNote).toBe("Other till");
    expect(basket(el).store.kitchenNoteRevision).toBe(4);
    expect(h.shadowRoot!.querySelector("wt-dialog")).toBeNull();
    expect(api.updateWorkingOrder).not.toHaveBeenCalled();
  });
});

describe("note save inverse controls", () => {
  it.each(["pay", "card", "hold", "place"])(
    "continues %s only after a successful note save",
    async (action) => {
      const pending = deferred<{
        scope: { workingOrderId: string };
        note: string;
        revision: number;
        ownerRevision: number;
      }>();
      const el = await mounted({ setKitchenNote: vi.fn().mockReturnValue(pending.promise) });
      await edit(el, "Together");
      if (action === "pay")
        emit(counter(el), "confirm-payment", { method: "cash", amount: "10.00" });
      if (action === "card") emit(counter(el), "collect-card", {});
      if (action === "hold") emit(counter(el), "park-order", {});
      if (action === "place") emit(counter(el), "place-order");
      await flush(el);
      expect(api.recordSale).not.toHaveBeenCalled();
      expect(api.pay).not.toHaveBeenCalled();
      expect(api.placeOrder).not.toHaveBeenCalled();
      pending.resolve({
        scope: { workingOrderId: "wo-9" },
        note: "Together",
        revision: 1,
        ownerRevision: 4,
      });
      await flush(el);
      if (action === "pay") expect(api.recordSale).toHaveBeenCalledOnce();
      if (action === "card") expect(api.pay).toHaveBeenCalledOnce();
      if (action === "hold") expect(basket(el).store.id).not.toBe("wo-9");
      if (action === "place") expect(api.placeOrder).toHaveBeenCalledWith("wo-9");
      expect(api.updateWorkingOrder).not.toHaveBeenCalled();
    },
  );
  it("flushes a persisted note-only change without invoking the line replacement path", async () => {
    const el = await mounted();
    const store = basket(el).store;
    store.kitchenNote = "Together";
    expect(store.dirty).toBe(false);
    expect(store.kitchenNoteDirty).toBe(true);
    emit(counter(el), "confirm-payment", { method: "cash", amount: "10.00" });
    await flush(el);
    expect(api.setKitchenNote).toHaveBeenCalledOnce();
    expect(api.recordSale).toHaveBeenCalledOnce();
    expect(vi.mocked(api.setKitchenNote).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.recordSale).mock.invocationCallOrder[0]!,
    );
    expect(api.updateWorkingOrder).not.toHaveBeenCalled();
  });
  it("uses a single in-flight save even for repeated dispatched Save events", async () => {
    const pending = deferred<{
      scope: { workingOrderId: string };
      note: string;
      revision: number;
      ownerRevision: number;
    }>();
    const el = await mounted({ setKitchenNote: vi.fn().mockReturnValue(pending.promise) });
    const store = basket(el).store;
    const detail = {
      scopeKey: "order:wo-9",
      revision: 0,
      visit: store.loadGeneration,
      note: "Together",
    };
    emit(heading(el), "save-kitchen-note", detail);
    emit(heading(el), "save-kitchen-note", detail);
    await flush(el);
    expect(api.setKitchenNote).toHaveBeenCalledOnce();
    pending.resolve({
      scope: { workingOrderId: "wo-9" },
      note: "Together",
      revision: 1,
      ownerRevision: 4,
    });
    await flush(el);
    expect(store.kitchenNote).toBe("Together");
  });
  it("does not apply a conflict reread after a same-id reload", async () => {
    const pending = deferred<{
      scope: { workingOrderId: string };
      note: string;
      revision: number;
      ownerRevision: number;
    }>();
    const el = await mounted({
      getKitchenNote: vi.fn().mockReturnValue(pending.promise),
      setKitchenNote: vi.fn().mockRejectedValue({ code: "kitchen_note.out_of_date" }),
    });
    await edit(el, "My draft");
    expect(api.getKitchenNote).toHaveBeenCalledOnce();
    const store = basket(el).store;
    store.loadFrom(store.id, store.lines.slice(), undefined, 7, {
      note: "Fresh",
      revision: 6,
      scopeKey: "order:wo-9",
    });
    pending.resolve({
      scope: { workingOrderId: "wo-9" },
      note: "Late",
      revision: 4,
      ownerRevision: 6,
    });
    await flush(el);
    expect(store.kitchenNote).toBe("Fresh");
    expect(store.kitchenNoteRevision).toBe(6);
  });
});

it("waits for the kitchen note before saving only a held label", async () => {
  const pending = deferred<{
    scope: { workingOrderId: string };
    note: string;
    revision: number;
    ownerRevision: number;
  }>();
  const el = await mounted({ setKitchenNote: vi.fn().mockReturnValue(pending.promise) });
  await edit(el, "Together");
  emit(counter(el), "park-order", { label: "New label" });
  await flush(el);
  expect(api.setWorkingOrderLabel).not.toHaveBeenCalled();
  pending.resolve({
    scope: { workingOrderId: "wo-9" },
    note: "Together",
    revision: 1,
    ownerRevision: 4,
  });
  await flush(el);
  expect(api.setWorkingOrderLabel).toHaveBeenCalledWith("wo-9", {
    label: "New label",
    revision: 4,
  });
  expect(api.updateWorkingOrder).not.toHaveBeenCalled();
});

it("adopts a moved bill's canonical party scope after a conflict", async () => {
  const snapshot = {
    scope: { partyId: "party-new" },
    note: "At the table",
    revision: 5,
    ownerRevision: 8,
  };
  const el = await mounted({
    getKitchenNote: vi.fn().mockResolvedValue(snapshot),
    setKitchenNote: vi.fn().mockRejectedValue({ code: "working_order.out_of_date" }),
  });
  await edit(el, "Counter draft");
  const store = basket(el).store;
  expect(store.kitchenNoteScopeKey).toBe("party:party-new");
  expect(store.kitchenNote).toBe("At the table");
  expect(store.kitchenNoteOwnerRevision).toBe(8);
  expect(heading(el).shadowRoot!.querySelector("wt-dialog")).toBeNull();
});
it("a note editor is usable again after the bill changes canonical scope", async () => {
  const snapshot = {
    scope: { partyId: "party-new" },
    note: "At the table",
    revision: 5,
    ownerRevision: 8,
  };
  const el = await mounted({
    getKitchenNote: vi.fn().mockResolvedValue(snapshot),
    setKitchenNote: vi.fn().mockRejectedValue({ code: "working_order.out_of_date" }),
  });
  await edit(el, "Counter draft");
  const h = heading(el);
  expect(h.busy).toBe(false);
  await userEvent.click(
    page.elementLocator(h.shadowRoot!.querySelector<HTMLElement>("[data-edit]")!),
  );
  expect(h.shadowRoot!.querySelector("wt-dialog")?.open).toBe(true);
});
it("a new visit can save while an old visit's response is still pending", async () => {
  const pending = deferred<{
    scope: { workingOrderId: string };
    note: string;
    revision: number;
    ownerRevision: number;
  }>();
  const setKitchenNote = vi
    .fn()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue({
      scope: { workingOrderId: "wo-9" },
      note: "New visit",
      revision: 5,
      ownerRevision: 9,
    });
  const el = await mounted({ setKitchenNote });
  await edit(el, "Old visit");
  const store = basket(el).store;
  store.loadFrom(store.id, store.lines.slice(), undefined, 9, {
    note: "Fresh",
    revision: 4,
    scopeKey: "order:wo-9",
    ownerRevision: 9,
  });
  await flush(el);
  const h = heading(el);
  expect(h.busy).toBe(false);
  await edit(el, "New visit");
  expect(setKitchenNote).toHaveBeenCalledTimes(2);
  pending.resolve({
    scope: { workingOrderId: "wo-9" },
    note: "Old visit",
    revision: 1,
    ownerRevision: 4,
  });
  await flush(el);
  expect(store.kitchenNote).toBe("New visit");
  expect(h.busy).toBe(false);
});

it("does not pay after an order reload between the note wait and payment", async () => {
  const el = await mounted();
  const store = basket(el).store;
  emit(counter(el), "confirm-payment", { method: "cash", amount: "10.00" });
  queueMicrotask(() =>
    store.loadFrom(store.id, store.lines.slice(), undefined, 9, {
      note: "New read",
      revision: 5,
      scopeKey: "order:wo-9",
      ownerRevision: 9,
    }),
  );
  await flush(el);
  expect(api.recordSale).not.toHaveBeenCalled();
  expect(store.kitchenNote).toBe("New read");
});
