import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget, servedMenus, draftServer } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { codeMessage } from "./i18n/codes.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillBasket } from "./widgets/basket.js";
import type { TillOrderKitchenNote } from "./widgets/order-kitchen-note.js";
import type { CanvasDef, CapabilityFlag } from "./layout.js";
import type {
  TableState,
  TableParty,
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
    getKitchenNote: vi.fn(async (scope: { workingOrderId: string } | { partyId: string }) => ({
      scope,
      note: null,
      revision: 0,
      ownerRevision: 0,
    })),
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
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockResolvedValue({ ...heldOrder(6), kitchenNote: saved }),
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

const waitingOrder = {
  id: "waiting-7",
  orderNumber: 7,
  label: "Train",
  status: "settled" as const,
  openedAt: "2026-10-16T10:00:00Z",
  settledAt: "2026-10-16T10:01:00Z",
  collectedAt: null,
  total: "8.00",
  canHandOver: true,
  serviceMode: null,
  movableDishes: [],
};
const waitingSnapshot = {
  scope: { workingOrderId: "waiting-7" },
  note: "Train at 14:30",
  revision: 3,
  ownerRevision: 7,
};
const waitingEditor = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillOrderKitchenNote>("[data-waiting-note]");
async function saveWaiting(el: TillApp, note: string) {
  const h = waitingEditor(el)!;
  emit(h.shadowRoot!.querySelector("wt-textarea")!, "wt-change", { value: note });
  await flush(el);
  await userEvent.click(
    page.elementLocator(h.shadowRoot!.querySelector<HTMLElement>("[data-save]")!),
  );
  await flush(el);
}
describe("Waiting kitchen note editor", () => {
  it("reads and saves a paid order's note without replacing the current basket", async () => {
    const el = await mounted({
      listCounterWaiting: vi.fn().mockResolvedValue([waitingOrder]),
      getKitchenNote: vi.fn().mockResolvedValue(waitingSnapshot),
      setKitchenNote: vi
        .fn()
        .mockResolvedValue({ ...waitingSnapshot, note: "All together", revision: 4 }),
    });
    const store = basket(el).store;
    const lines = store.lines;
    emit(counter(el), "edit-waiting-kitchen-note", { id: waitingOrder.id });
    await flush(el);
    expect(api.getKitchenNote).toHaveBeenCalledWith({ workingOrderId: waitingOrder.id });
    const h = waitingEditor(el)!;
    expect(h.shadowRoot!.querySelector("wt-dialog")?.open).toBe(true);
    expect(h.note).toBe("Train at 14:30");
    expect(h.shadowRoot!.querySelector("[data-edit]")).toBeNull();
    await saveWaiting(el, "All together");
    expect(api.setKitchenNote).toHaveBeenCalledWith(waitingSnapshot.scope, {
      submissionId: expect.any(String),
      expectedNoteRevision: 3,
      expectedOrderRevision: 7,
      partyId: null,
      note: "All together",
    });
    expect(waitingEditor(el)).toBeNull();
    expect(store.id).toBe("wo-9");
    expect(store.lines).toEqual(lines);
    expect(store.lines[0]).toBe(lines[0]);
    expect(store.kitchenNote).toBeNull();
    expect(api.retrieveWorkingOrder).toHaveBeenCalledOnce();
    expect(api.updateWorkingOrder).not.toHaveBeenCalled();
  });
  it("reuses the same submission on a lost response and leaves the modal available", async () => {
    const setKitchenNote = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValue({ ...waitingSnapshot, note: "Together", revision: 4 });
    const el = await mounted({
      listCounterWaiting: vi.fn().mockResolvedValue([waitingOrder]),
      getKitchenNote: vi.fn().mockResolvedValue(waitingSnapshot),
      setKitchenNote,
    });
    emit(counter(el), "edit-waiting-kitchen-note", { id: waitingOrder.id });
    await flush(el);
    expect(waitingEditor(el)).not.toBeNull();
    await saveWaiting(el, "Together");
    expect(waitingEditor(el)?.shadowRoot!.querySelector("wt-dialog")?.open).toBe(true);
    await saveWaiting(el, "Together");
    expect(setKitchenNote).toHaveBeenCalledTimes(2);
    expect(setKitchenNote.mock.calls[1]).toEqual(setKitchenNote.mock.calls[0]);
    expect(waitingEditor(el)).toBeNull();
  });
  it("ignores a Waiting read after logout", async () => {
    const pending = deferred<typeof waitingSnapshot>();
    const el = await mounted({
      listCounterWaiting: vi.fn().mockResolvedValue([waitingOrder]),
      getKitchenNote: vi.fn().mockReturnValue(pending.promise),
    });
    emit(counter(el), "edit-waiting-kitchen-note", { id: waitingOrder.id });
    await flush(el);
    expect(api.getKitchenNote).toHaveBeenCalledOnce();
    emit(el.shadowRoot!.querySelector(".app")!, "logout");
    await flush(el);
    pending.resolve(waitingSnapshot);
    await flush(el);
    expect(waitingEditor(el)).toBeNull();
    expect(api.setKitchenNote).not.toHaveBeenCalled();
  });
});

describe("fresh persisted counter notes", () => {
  it.each(["card", "place"])("adopts canonical note metadata after fresh %s", async (action) => {
    let id = "";
    const getKitchenNote = vi.fn(async () => ({
      scope: { workingOrderId: id },
      note: "Initial",
      revision: 1,
      ownerRevision: 0,
    }));
    const el = await mounted(
      {
        getKitchenNote,
        pay: vi.fn().mockResolvedValue({ outcome: "declined" }),
        setKitchenNote: vi.fn(async () => ({
          scope: { workingOrderId: id },
          note: "Changed",
          revision: 2,
          ownerRevision: 0,
        })),
      },
      false,
    );
    const store = basket(el).store;
    store.addProduct(product("cana", "Caña", "2.50"), "1");
    store.kitchenNote = "Initial";
    id = store.id;
    emit(counter(el), action === "card" ? "collect-card" : "place-order", {});
    await flush(el);
    expect(getKitchenNote).toHaveBeenCalledWith({ workingOrderId: id });
    expect(store.persisted).toBe(true);
    expect(store.kitchenNoteRevision).toBe(1);
    expect(store.kitchenNoteDirty).toBe(false);
    await edit(el, "Changed");
    expect(api.setKitchenNote).toHaveBeenCalledWith(
      { workingOrderId: id },
      {
        submissionId: expect.any(String),
        note: "Changed",
        expectedNoteRevision: 1,
        expectedOrderRevision: 0,
        partyId: null,
      },
    );
    expect(store.kitchenNote).toBe("Changed");
    expect(api.updateWorkingOrder).not.toHaveBeenCalled();
  });
});

const partyNote = {
  scope: { partyId: "party-table" },
  note: "Table instruction",
  revision: 2,
  ownerRevision: 3,
};
const tableParty = (note = partyNote): TableParty & { kitchenNote: typeof partyNote } => ({
  id: "party-table",
  revision: note.ownerRevision,
  guestCount: 2,
  state: "open",
  name: null,
  displayName: "Four",
  mainBillId: "bill-table",
  outstanding: "0.00",
  billCount: 1,
  tableIds: ["table-four"],
  unsentDrafts: [],
  reminder: null,
  kitchenNote: note,
});
const tableRow = (party: TableParty | null): TableState => ({
  id: "table-four",
  label: "Four",
  zoneId: "zone-counter",
  state: party ? "open-tab" : "free",
  condition: party ? "held" : "free",
  hasOpenTab: party !== null,
  pendingDeliveries: 0,
  pendingToServe: 0,
  readyToServe: 0,
  enRoute: 0,
  timingBand: "fresh",
  status: null,
  nextReservation: null,
  today: null,
  signals: [],
  party,
});
const tableScreen = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!;
const tableHeading = (el: TillApp) =>
  tableScreen(el).shadowRoot!.querySelector<TillOrderKitchenNote>("till-order-kitchen-note")!;
async function mountedTable(
  overrides: Record<string, unknown> = {},
  initialParty: TableParty | null = tableParty(),
) {
  const server = draftServer();
  const el = await mounted(
    {
      getTablesState: vi.fn().mockResolvedValue([tableRow(initialParty)]),
      getTabLines: vi.fn().mockResolvedValue({ revision: 0, lines: [], editSentLines: true }),
      getPartyBills: vi.fn().mockResolvedValue([]),
      listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [] }),
      listPrintProblems: vi.fn().mockResolvedValue({ problems: [] }),
      listDrafts: server.listDrafts,
      saveDraft: server.saveDraft,
      submitDraft: server.submitDraft,
      takeOverDraft: server.takeOverDraft,
      fireGroup: vi.fn().mockResolvedValue({ revision: 5 }),
      getKitchenNote: vi.fn().mockResolvedValue(partyNote),
      setKitchenNote: vi
        .fn()
        .mockResolvedValue({ ...partyNote, note: "Together", revision: 3, ownerRevision: 4 }),
      ...overrides,
    },
    false,
  );
  emit(counter(el), "floor-refresh", {});
  await flush(el);
  expect(api.getTablesState).toHaveBeenCalled();
  emit(counter(el), "open-table", { tableId: "table-four", seated: true });
  await flush(el);
  expect(tableScreen(el)).not.toBeNull();
  expect(tableScreen(el).party?.id ?? null).toBe(initialParty?.id ?? null);
  return { el, server };
}
async function editTable(el: TillApp, text: string) {
  const h = tableHeading(el);
  await userEvent.click(
    page.elementLocator(h.shadowRoot!.querySelector<HTMLElement>("[data-edit]")!),
  );
  await flush(el);
  emit(h.shadowRoot!.querySelector("wt-textarea")!, "wt-change", { value: text });
  await flush(el);
  await userEvent.click(
    page.elementLocator(h.shadowRoot!.querySelector<HTMLElement>("[data-save]")!),
  );
  await flush(el);
  return h;
}
describe("party kitchen note integration", () => {
  it("hydrates the shared note and saves it without saving any draft lines", async () => {
    const { el, server } = await mountedTable();
    expect(tableHeading(el).note).toBe("Table instruction");
    const store = tableScreen(el).draftStore;
    await editTable(el, "Together");
    expect(api.setKitchenNote).toHaveBeenCalledWith(
      { partyId: "party-table" },
      {
        submissionId: expect.any(String),
        expectedPartyRevision: 3,
        expectedNoteRevision: 2,
        note: "Together",
      },
    );
    expect(tableHeading(el).note).toBe("Together");
    expect(tableScreen(el).party?.revision).toBe(4);
    expect(tableScreen(el).draftStore).toBe(store);
    expect(server.saveDraft).not.toHaveBeenCalled();
    expect(tableHeading(el).shadowRoot!.querySelector("wt-dialog")).toBeNull();
  });
  it("waits for the note before firing and uses the returned party revision", async () => {
    const pending = deferred<typeof partyNote>();
    const { el } = await mountedTable({ setKitchenNote: vi.fn().mockReturnValue(pending.promise) });
    await editTable(el, "Together");
    expect(api.setKitchenNote).toHaveBeenCalledOnce();
    emit(tableScreen(el), "fire-group", { groupId: "group-held" });
    await flush(el);
    expect(api.fireGroup).not.toHaveBeenCalled();
    pending.resolve({ ...partyNote, note: "Together", revision: 3, ownerRevision: 4 });
    await flush(el);
    expect(api.fireGroup).toHaveBeenCalledWith("party-table", "group-held", {
      submissionId: expect.any(String),
      expectedPartyRevision: 4,
    });
  });
  it("keeps a refused note editable and does not fire food", async () => {
    const pending = deferred<typeof partyNote>();
    const { el } = await mountedTable({ setKitchenNote: vi.fn().mockReturnValue(pending.promise) });
    await editTable(el, "Together");
    expect(api.setKitchenNote).toHaveBeenCalledOnce();
    emit(tableScreen(el), "fire-group", { groupId: "group-held" });
    await flush(el);
    pending.reject(new TypeError("network"));
    await flush(el);
    expect(api.fireGroup).not.toHaveBeenCalled();
    expect(tableHeading(el).shadowRoot!.querySelector("wt-dialog")?.open).toBe(true);
    expect(tableHeading(el).refusal).not.toBe("");
  });
  it("adopts a polled note without resetting a dirty editor or the line draft", async () => {
    const { el } = await mountedTable();
    const store = tableScreen(el).draftStore;
    const h = tableHeading(el);
    await userEvent.click(
      page.elementLocator(h.shadowRoot!.querySelector<HTMLElement>("[data-edit]")!),
    );
    await flush(el);
    emit(h.shadowRoot!.querySelector("wt-textarea")!, "wt-change", { value: "My draft" });
    await flush(el);
    vi.mocked(api.getTablesState).mockResolvedValue([
      tableRow(tableParty({ ...partyNote, note: "Other device", revision: 3, ownerRevision: 4 })),
    ]);
    emit(el.shadowRoot!.querySelector(".app")!, "floor-refresh", { poll: true });
    await flush(el);
    expect(h.note).toBe("Other device");
    expect(h.revision).toBe(3);
    expect(h.shadowRoot!.querySelector("wt-textarea")!.value).toBe("My draft");
    expect(tableScreen(el).draftStore).toBe(store);
  });
});

it.each(["send-lines", "pay-tab", "bill-pay"])(
  "waits for a party note before %s",
  async (action) => {
    const pending = deferred<typeof partyNote>();
    const { el } = await mountedTable({
      setKitchenNote: vi.fn().mockReturnValue(pending.promise),
      sendLines: vi.fn().mockResolvedValue(undefined),
      getBillBalance: vi.fn().mockResolvedValue({
        workingOrderId: "bill-table",
        status: "open",
        total: "1.00",
        received: "0.00",
        reserved: "0.00",
        outstanding: "1.00",
        tips: "0.00",
        payments: [],
        paidLines: [],
      }),
    });
    await editTable(el, "Together");
    emit(
      tableScreen(el),
      action,
      action === "send-lines"
        ? { lineNos: [1] }
        : action === "pay-tab"
          ? { method: "cash", amount: "10.00" }
          : { way: "contribution", amount: "1.00", lines: [] },
    );
    await flush(el);
    expect(api.sendLines).not.toHaveBeenCalled();
    expect(api.recordSale).not.toHaveBeenCalled();
    expect(api.getBillBalance).not.toHaveBeenCalled();
    pending.resolve({ ...partyNote, note: "Together", revision: 3, ownerRevision: 4 });
    await flush(el);
    if (action === "send-lines") expect(api.sendLines).toHaveBeenCalledWith("bill-table", [1]);
    if (action === "pay-tab")
      expect(api.recordSale).toHaveBeenCalledWith(
        [],
        { method: "cash", amount: "10.00" },
        "bill-table",
      );
    if (action === "bill-pay") expect(api.getBillBalance).toHaveBeenCalled();
  },
);

it("waits for a party note before submitting the selected round", async () => {
  const pending = deferred<typeof partyNote>();
  const { el, server } = await mountedTable({
    setKitchenNote: vi.fn().mockReturnValue(pending.promise),
  });
  const store = tableScreen(el).draftStore!;
  store.addProduct(product("cana", "Caña", "2.50"), "1");
  await flush(el);
  await editTable(el, "Together");
  emit(tableScreen(el), "submit-draft", {
    groups: [{ release: "fire", lineIndexes: [0] }],
    store,
    sent: store.lines,
  });
  await flush(el);
  expect(server.submitDraft).not.toHaveBeenCalled();
  pending.resolve({ ...partyNote, note: "Together", revision: 3, ownerRevision: 4 });
  await vi.waitFor(() => expect(server.submitDraft).toHaveBeenCalledOnce());
  expect(server.submitDraft.mock.calls[0]?.[2].expectedPartyRevision).toBe(4);
});

it("keeps a failed party note ahead of a later Fire until it is discarded", async () => {
  const { el } = await mountedTable({
    setKitchenNote: vi.fn().mockRejectedValue(new TypeError("network")),
  });
  const h = await editTable(el, "Unsent instruction");
  expect(h.refusal).not.toBe("");
  emit(tableScreen(el), "fire-group", { groupId: "group-held" });
  await flush(el);
  expect(api.fireGroup).not.toHaveBeenCalled();
  h.closeEditor();
  await flush(el);
  emit(tableScreen(el), "fire-group", { groupId: "group-held" });
  await flush(el);
  expect(api.fireGroup).toHaveBeenCalledOnce();
});
it("keeps a failed counter note ahead of a later payment", async () => {
  const el = await mounted({ setKitchenNote: vi.fn().mockRejectedValue(new TypeError("network")) });
  await edit(el, "Unsent instruction");
  emit(counter(el), "confirm-payment", { method: "cash", amount: "10.00" });
  await flush(el);
  expect(api.recordSale).not.toHaveBeenCalled();
});
it("keeps a newer polled instruction when an older successful save arrives", async () => {
  const pending = deferred<typeof partyNote>();
  const { el } = await mountedTable({ setKitchenNote: vi.fn().mockReturnValue(pending.promise) });
  await editTable(el, "Together");
  vi.mocked(api.getTablesState).mockResolvedValue([
    tableRow(tableParty({ ...partyNote, note: "Newer", revision: 4, ownerRevision: 5 })),
  ]);
  emit(tableScreen(el), "floor-refresh", {});
  await flush(el);
  expect(tableHeading(el).note).toBe("Newer");
  pending.resolve({ ...partyNote, note: "Together", revision: 3, ownerRevision: 4 });
  await flush(el);
  expect(tableHeading(el).note).toBe("Newer");
  expect(tableHeading(el).shadowRoot!.querySelector("wt-dialog")).toBeNull();
});
it("removes the Waiting editor after its native close completes", async () => {
  const el = await mounted({
    listCounterWaiting: vi.fn().mockResolvedValue([waitingOrder]),
    getKitchenNote: vi.fn().mockResolvedValue(waitingSnapshot),
  });
  emit(counter(el), "edit-waiting-kitchen-note", { id: waitingOrder.id });
  await flush(el);
  const h = waitingEditor(el)!;
  const dialog = h.shadowRoot!.querySelector("wt-dialog")!;
  const closed = new Promise<void>((resolve) =>
    dialog.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  await userEvent.click(
    page.elementLocator(h.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!),
  );
  await closed;
  await flush(el);
  expect(waitingEditor(el)).toBeNull();
  expect(api.setKitchenNote).not.toHaveBeenCalled();
});

it.each([false, true])(
  "seats the unassigned table instruction before making its draft sendable, lines=%s",
  async (withLines) => {
    const note = { ...partyNote, note: "Train", revision: 1, ownerRevision: 0 };
    const { el, server } = await mountedTable(
      {
        seatTable: vi.fn(async () => {
          vi.mocked(api.getTablesState).mockResolvedValue([tableRow(tableParty(note))]);
          return {
            tabId: "bill-table",
            partyId: "party-table",
            revision: 0,
            orderNumber: 1,
            kitchenNote: note,
          };
        }),
      },
      null,
    );
    const draft = tableScreen(el).draftStore!;
    draft.kitchenNote = "Train";
    if (withLines) {
      draft.addProduct(product("cana", "Caña", "2.50"), "2", { note: "No salt" });
      draft.setLineCourse(0, "mains");
      draft.setLineMakeAt(0, "s1");
    }
    const lines = draft.lines;
    await flush(el);
    emit(tableScreen(el), "open-table", { tableId: "table-four", seated: false, guestCount: 2 });
    await flush(el);
    expect(api.seatTable).toHaveBeenCalledWith("table-four", 2, "Train");
    expect(tableScreen(el).party?.id).toBe("party-table");
    expect(tableHeading(el).note).toBe("Train");
    expect(tableHeading(el).revision).toBe(1);
    expect(api.setKitchenNote).not.toHaveBeenCalled();
    expect(tableScreen(el).draftStore!.lines).toEqual(lines);
    if (withLines) await vi.waitFor(() => expect(server.saveDraft).toHaveBeenCalled());
  },
);

it("does not adopt a note save after reopening the same table", async () => {
  const pending = deferred<typeof partyNote>();
  const { el } = await mountedTable({ setKitchenNote: vi.fn().mockReturnValue(pending.promise) });
  await editTable(el, "Old visit");
  vi.mocked(api.getTablesState).mockResolvedValue([
    tableRow(tableParty({ ...partyNote, note: "Fresh visit", revision: 5, ownerRevision: 8 })),
  ]);
  emit(tableScreen(el), "floor-refresh", {});
  await flush(el);
  emit(tableScreen(el), "open-table", { tableId: "table-four", seated: true });
  await flush(el);
  expect(tableHeading(el).note).toBe("Fresh visit");
  pending.resolve({ ...partyNote, note: "Old visit", revision: 3, ownerRevision: 4 });
  await flush(el);
  expect(tableHeading(el).note).toBe("Fresh visit");
  expect(tableScreen(el).party?.revision).toBe(8);
});
it("rereads a stale party note and keeps the current line draft", async () => {
  const fresh = { ...partyNote, note: "Other staff", revision: 5, ownerRevision: 8 };
  const { el } = await mountedTable({
    setKitchenNote: vi.fn().mockRejectedValue({ code: "party.out_of_date" }),
    getKitchenNote: vi.fn().mockResolvedValue(fresh),
  });
  const store = tableScreen(el).draftStore;
  await editTable(el, "Stale change");
  expect(api.getKitchenNote).toHaveBeenCalledWith({ partyId: "party-table" });
  expect(tableHeading(el).note).toBe("Other staff");
  expect(tableScreen(el).party?.revision).toBe(8);
  expect(tableScreen(el).draftStore).toBe(store);
  expect(tableHeading(el).shadowRoot!.querySelector("wt-dialog")).toBeNull();
});
it("saves a party note when settlement left no main bill", async () => {
  const party = { ...tableParty(), mainBillId: null };
  const { el } = await mountedTable({}, party);
  expect(tableScreen(el).orderId).toBeUndefined();
  await editTable(el, "Together");
  expect(api.setKitchenNote).toHaveBeenCalledWith(
    { partyId: "party-table" },
    {
      submissionId: expect.any(String),
      expectedPartyRevision: 3,
      expectedNoteRevision: 2,
      note: "Together",
    },
  );
  expect(tableHeading(el).note).toBe("Together");
  expect(api.parkOrder).not.toHaveBeenCalled();
});
it("retries a lost party-note response with the same submission", async () => {
  const setKitchenNote = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("network"))
    .mockResolvedValue({ ...partyNote, note: "Together", revision: 3, ownerRevision: 4 });
  const { el } = await mountedTable({ setKitchenNote });
  const h = await editTable(el, "Together");
  expect(h.refusal).not.toBe("");
  await userEvent.click(
    page.elementLocator(h.shadowRoot!.querySelector<HTMLElement>("[data-save]")!),
  );
  await flush(el);
  expect(setKitchenNote).toHaveBeenCalledTimes(2);
  expect(setKitchenNote.mock.calls[1]).toEqual(setKitchenNote.mock.calls[0]);
  expect(tableHeading(el).note).toBe("Together");
  expect(h.shadowRoot!.querySelector("wt-dialog")).toBeNull();
});

it("recovers persisted note ownership after a fresh card request loses its response", async () => {
  let id = "";
  const getKitchenNote = vi.fn(async () => ({
    scope: { workingOrderId: id },
    note: "Stored instruction",
    revision: 4,
    ownerRevision: 0,
  }));
  const el = await mounted(
    { pay: vi.fn().mockRejectedValue(new TypeError("network")), getKitchenNote },
    false,
  );
  const store = basket(el).store;
  store.addProduct(product("cana", "Caña", "2.50"), "1");
  store.kitchenNote = "Original instruction";
  id = store.id;
  emit(counter(el), "collect-card", {});
  await flush(el);
  expect(getKitchenNote).toHaveBeenCalledWith({ workingOrderId: id });
  expect(store.persisted).toBe(true);
  expect(store.kitchenNote).toBe("Stored instruction");
  expect(store.kitchenNoteRevision).toBe(4);
  expect(store.revision).toBe(0);
  expect(api.recordSale).not.toHaveBeenCalled();
});

it("rereads changed lines before accepting a newer order revision from note recovery", async () => {
  let id = "";
  const snapshot = () => ({
    scope: { workingOrderId: id },
    note: "Stored",
    revision: 4,
    ownerRevision: 2,
  });
  const retrieveWorkingOrder = vi.fn(async () => ({
    ...heldOrder(2, "9.00", "3.000"),
    id,
    kitchenNote: snapshot(),
  }));
  const el = await mounted(
    {
      pay: vi.fn().mockRejectedValue(new TypeError("network")),
      getKitchenNote: vi.fn(async () => snapshot()),
      retrieveWorkingOrder,
      getTabLines: vi.fn().mockResolvedValue(listing(2, "9.00", "3.000")),
    },
    false,
  );
  const store = basket(el).store;
  store.addProduct(product("cana", "Caña", "2.50"), "1");
  id = store.id;
  emit(counter(el), "collect-card", {});
  await flush(el);
  expect(retrieveWorkingOrder).toHaveBeenCalledWith(id);
  expect(store.revision).toBe(2);
  expect(store.lines.find((line) => line.product.id === "cana")?.quantity).toBe("3");
  expect(store.lines.find((line) => line.product.id === "cana")?.product.unitPrice).toBe("9.00");
  expect(store.kitchenNote).toBe("Stored");
});
it("refreshes stale counter lines before the next note edit uses their revision", async () => {
  const snapshot = {
    scope: { workingOrderId: "wo-9" },
    note: "New state",
    revision: 4,
    ownerRevision: 8,
  };
  const retrieveWorkingOrder = vi
    .fn()
    .mockResolvedValueOnce(heldOrder(4))
    .mockResolvedValue({ ...heldOrder(8, "9.00", "3.000"), kitchenNote: snapshot });
  const setKitchenNote = vi
    .fn()
    .mockRejectedValueOnce({ code: "working_order.out_of_date" })
    .mockResolvedValue({ ...snapshot, note: "Fresh edit", revision: 5 });
  const el = await mounted({
    retrieveWorkingOrder,
    getKitchenNote: vi.fn().mockResolvedValue(snapshot),
    setKitchenNote,
  });
  await edit(el, "Old edit");
  expect(retrieveWorkingOrder).toHaveBeenCalledTimes(2);
  expect(basket(el).store.lines[1]!.product.unitPrice).toBe("9.00");
  expect(basket(el).store.revision).toBe(8);
  await edit(el, "Fresh edit");
  expect(setKitchenNote.mock.calls[1]?.[1].expectedOrderRevision).toBe(8);
  expect(basket(el).store.kitchenNote).toBe("Fresh edit");
});

it("opens the Waiting note from its real row action and returns focus after Cancel", async () => {
  const el = await mounted({
    getTill: vi.fn().mockResolvedValue({
      ...till,
      capabilities: ["take-orders"],
      canvas: {
        ...canvas,
        tabs: [
          {
            ...canvas.tabs[0]!,
            cards: [
              ...canvas.tabs[0]!.cards,
              { type: "held-orders", colSpan: 12, rowSpan: 3, config: {} },
            ],
          },
        ],
      },
    }),
    listCounterWaiting: vi.fn().mockResolvedValue([waitingOrder]),
    getKitchenNote: vi.fn().mockResolvedValue(waitingSnapshot),
  });
  const grid = counter(el).shadowRoot!.querySelector("till-card-grid")!;
  const waiting = grid.shadowRoot!.querySelector("till-counter-waiting")!;
  const button = waiting.shadowRoot!.querySelector<HTMLElement>("[data-waiting-kitchen-note]");
  expect(button).not.toBeNull();
  await userEvent.click(page.elementLocator(button!));
  await flush(el);
  const h = waitingEditor(el)!;
  expect(h.shadowRoot!.querySelector("wt-dialog")?.open).toBe(true);
  const dialog = h.shadowRoot!.querySelector("wt-dialog")!;
  const closed = new Promise<void>((resolve) =>
    dialog.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  await userEvent.click(
    page.elementLocator(h.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!),
  );
  await closed;
  await flush(el);
  expect(waitingEditor(el)).toBeNull();
  expect(button!.shadowRoot!.activeElement).toBe(button!.shadowRoot!.querySelector("button"));
});

it.each(["reload", "table"])(
  "drops a Waiting read after leaving its counter view by %s",
  async (change) => {
    const pending = deferred<typeof waitingSnapshot>();
    const el = await mounted({
      listCounterWaiting: vi.fn().mockResolvedValue([waitingOrder]),
      getKitchenNote: vi.fn().mockReturnValue(pending.promise),
    });
    emit(counter(el), "edit-waiting-kitchen-note", { id: waitingOrder.id });
    await flush(el);
    expect(api.getKitchenNote).toHaveBeenCalledOnce();
    if (change === "reload") {
      const store = basket(el).store;
      const generation = store.loadGeneration;
      emit(counter(el), "retrieve-order", { id: "wo-9" });
      await flush(el);
      expect(store.loadGeneration).toBeGreaterThan(generation);
    } else {
      emit(counter(el), "open-table", { tableId: "table-four", seated: true });
      await flush(el);
      expect(tableScreen(el)).not.toBeNull();
    }
    pending.resolve(waitingSnapshot);
    await flush(el);
    expect(waitingEditor(el)).toBeNull();
    expect(api.setKitchenNote).not.toHaveBeenCalled();
  },
);

it("keeps the second party after the first party's note save returns", async () => {
  const pending = deferred<typeof partyNote>();
  const { el } = await mountedTable({ setKitchenNote: vi.fn().mockReturnValue(pending.promise) });
  await editTable(el, "First party change");
  const second: TableParty = {
    ...tableParty(),
    id: "party-second",
    tableIds: ["table-second"],
    mainBillId: "bill-second",
    revision: 1,
    kitchenNote: {
      scope: { partyId: "party-second" },
      note: "Second party instruction",
      revision: 0,
      ownerRevision: 1,
    },
  };
  vi.mocked(api.getTablesState).mockResolvedValue([
    tableRow(tableParty()),
    { ...tableRow(second), id: "table-second", label: "Second" },
  ]);
  emit(tableScreen(el), "floor-refresh", {});
  await flush(el);
  emit(tableScreen(el), "open-table", { tableId: "table-second", seated: true });
  await flush(el);
  expect(tableScreen(el).party?.id).toBe("party-second");
  expect(tableHeading(el).note).toBe("Second party instruction");
  pending.resolve({ ...partyNote, note: "First party change", revision: 3, ownerRevision: 4 });
  await flush(el);
  expect(tableScreen(el).party?.id).toBe("party-second");
  expect(tableScreen(el).party?.kitchenNote.scope).toEqual({ partyId: "party-second" });
  expect(tableHeading(el).note).toBe("Second party instruction");
  expect(tableHeading(el).revision).toBe(0);
});

it("keeps a newer passive note when another floor read carries an older snapshot", async () => {
  const { el } = await mountedTable();
  vi.mocked(api.getTablesState).mockResolvedValue([
    tableRow(
      tableParty({ ...partyNote, note: "Newer passive note", revision: 4, ownerRevision: 6 }),
    ),
  ]);
  emit(tableScreen(el), "floor-refresh", { poll: true });
  await flush(el);
  expect(tableHeading(el).note).toBe("Newer passive note");
  expect(tableScreen(el).party?.revision).toBe(3);
  vi.mocked(api.getTablesState).mockResolvedValue([
    tableRow(
      tableParty({ ...partyNote, note: "Older passive note", revision: 3, ownerRevision: 5 }),
    ),
  ]);
  emit(tableScreen(el), "floor-refresh", { poll: true });
  await flush(el);
  expect(tableHeading(el).note).toBe("Newer passive note");
  expect(tableHeading(el).revision).toBe(4);
  expect(tableScreen(el).party?.revision).toBe(3);
});

describe("note failure recovery and callback boundaries", () => {
  it("saves a fresh counter instruction through the editor without a server write", async () => {
    const el = await mounted({}, false);
    await edit(el, "Fresh local instruction");
    expect(basket(el).store.kitchenNote).toBe("Fresh local instruction");
    expect(basket(el).store.persisted).toBe(false);
    expect(api.setKitchenNote).not.toHaveBeenCalled();
    expect(heading(el).shadowRoot!.querySelector("wt-dialog")).toBeNull();
  });
  it("saves an unseated table instruction through its editor", async () => {
    const { el } = await mountedTable({ seatTable: vi.fn() }, null);
    const draft = tableScreen(el).draftStore!;
    await editTable(el, "Before seating");
    expect(draft.kitchenNote).toBe("Before seating");
    expect(tableScreen(el).party).toBeNull();
    expect(api.setKitchenNote).not.toHaveBeenCalled();
    expect(api.seatTable).not.toHaveBeenCalled();
  });
  it("keeps a confirmed Place in the basket when its note cannot be reread", async () => {
    const el = await mounted(
      { getKitchenNote: vi.fn().mockRejectedValue(new TypeError("network")) },
      false,
    );
    const store = basket(el).store;
    store.addProduct(product("cana", "Caña", "2.50"), "1");
    store.kitchenNote = "Local instruction";
    const id = store.id;
    const lines = store.lines;
    emit(counter(el), "place-order", {});
    await flush(el);
    expect(api.parkOrder).toHaveBeenCalledOnce();
    expect(api.getKitchenNote).toHaveBeenCalledWith({ workingOrderId: id });
    expect(store.persisted).toBe(true);
    expect(store.id).toBe(id);
    expect(store.lines).toEqual(lines);
    expect(store.kitchenNote).toBe("Local instruction");
  });
  it.each(["before read", "during read"])(
    "keeps a replacement basket when a fresh Place finishes %s",
    async (phase) => {
      const held = deferred<{ id: string; orderNumber: number }>();
      const read = deferred<{
        scope: { workingOrderId: string };
        note: string;
        revision: number;
        ownerRevision: number;
      }>();
      const el = await mounted(
        {
          parkOrder: vi.fn().mockReturnValue(held.promise),
          getKitchenNote: vi.fn().mockReturnValue(read.promise),
        },
        false,
      );
      const store = basket(el).store;
      store.addProduct(product("cana", "Caña", "2.50"), "1");
      const id = store.id;
      emit(counter(el), "place-order", {});
      await flush(el);
      if (phase === "during read") {
        held.resolve({ id, orderNumber: 1 });
        await flush(el);
        expect(api.getKitchenNote).toHaveBeenCalledOnce();
      }
      store.loadFrom("replacement", store.lines.slice(), "Replacement", 8, {
        note: "Replacement instruction",
        revision: 1,
        scopeKey: "order:replacement",
      });
      await flush(el);
      if (phase === "before read") held.resolve({ id, orderNumber: 1 });
      else
        read.resolve({
          scope: { workingOrderId: id },
          note: "Late instruction",
          revision: 1,
          ownerRevision: 8,
        });
      await flush(el);
      expect(store.id).toBe("replacement");
      expect(store.kitchenNote).toBe("Replacement instruction");
      expect(store.revision).toBe(8);
      if (phase === "before read") expect(api.getKitchenNote).not.toHaveBeenCalled();
    },
  );
  it("keeps a counter conflict editable when its authoritative reread fails", async () => {
    const el = await mounted({
      setKitchenNote: vi.fn().mockRejectedValue({ code: "working_order.out_of_date" }),
      getKitchenNote: vi.fn().mockRejectedValue(new TypeError("network")),
    });
    const h = await edit(el, "Counter draft");
    expect(h.refusal).toBe(codeMessage("working_order.out_of_date"));
    expect(h.shadowRoot!.querySelector("wt-textarea")!.value).toBe("Counter draft");
    expect(
      h.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-save]")!.disabled,
    ).toBe(false);
    expect(api.updateWorkingOrder).not.toHaveBeenCalled();
  });
  it("keeps a party conflict editable when its authoritative reread fails", async () => {
    const { el } = await mountedTable({
      setKitchenNote: vi.fn().mockRejectedValue({ code: "party.out_of_date" }),
      getKitchenNote: vi.fn().mockRejectedValue(new TypeError("network")),
    });
    const h = await editTable(el, "Party draft");
    expect(h.refusal).toBe(codeMessage("party.out_of_date"));
    expect(h.shadowRoot!.querySelector("wt-textarea")!.value).toBe("Party draft");
    expect(
      h.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-save]")!.disabled,
    ).toBe(false);
  });
  it("does not open Waiting for an order no longer in the list", async () => {
    const el = await mounted();
    emit(counter(el), "edit-waiting-kitchen-note", { id: "removed" });
    await flush(el);
    expect(api.getKitchenNote).not.toHaveBeenCalled();
    expect(waitingEditor(el)).toBeNull();
  });
  it("keeps Waiting closed after a failed note read", async () => {
    const el = await mounted({
      listCounterWaiting: vi.fn().mockResolvedValue([waitingOrder]),
      getKitchenNote: vi.fn().mockRejectedValue(new TypeError("network")),
    });
    emit(counter(el), "edit-waiting-kitchen-note", { id: waitingOrder.id });
    await flush(el);
    expect(api.getKitchenNote).toHaveBeenCalledOnce();
    expect(waitingEditor(el)).toBeNull();
    expect(api.setKitchenNote).not.toHaveBeenCalled();
  });
  it("abandons a Waiting read invalidated between its reply and the editor render", async () => {
    const read = deferred<typeof waitingSnapshot>();
    const el = await mounted({
      listCounterWaiting: vi.fn().mockResolvedValue([waitingOrder]),
      getKitchenNote: vi.fn().mockReturnValue(read.promise),
    });
    emit(counter(el), "edit-waiting-kitchen-note", { id: waitingOrder.id });
    await flush(el);
    const store = basket(el).store;
    read.resolve(waitingSnapshot);
    queueMicrotask(() => store.loadFrom("replacement", store.lines.slice()));
    await flush(el);
    expect(store.id).toBe("replacement");
    expect(waitingEditor(el)).toBeNull();
  });
  it("uses the party owner revision for a Waiting bill and closes a stale edit", async () => {
    const saved = { ...waitingSnapshot, scope: { partyId: "waiting-party" } };
    const el = await mounted({
      listCounterWaiting: vi.fn().mockResolvedValue([waitingOrder]),
      getKitchenNote: vi.fn().mockResolvedValue(saved),
      setKitchenNote: vi.fn().mockRejectedValue({ code: "party.out_of_date" }),
    });
    emit(counter(el), "edit-waiting-kitchen-note", { id: waitingOrder.id });
    await flush(el);
    await saveWaiting(el, "Party instruction");
    expect(api.setKitchenNote).toHaveBeenCalledWith(
      { partyId: "waiting-party" },
      {
        note: "Party instruction",
        submissionId: expect.any(String),
        expectedNoteRevision: 3,
        expectedPartyRevision: 7,
      },
    );
    expect(waitingEditor(el)).toBeNull();
    expect(basket(el).store.id).toBe("wo-9");
  });
  it.each(["success", "refusal"])(
    "keeps a newer Waiting editor after an older save's %s",
    async (outcome) => {
      const write = deferred<typeof waitingSnapshot>();
      const second = {
        ...waitingSnapshot,
        scope: { workingOrderId: "waiting-8" },
        note: "Second instruction",
        revision: 0,
      };
      const el = await mounted({
        listCounterWaiting: vi
          .fn()
          .mockResolvedValue([waitingOrder, { ...waitingOrder, id: "waiting-8" }]),
        getKitchenNote: vi.fn().mockResolvedValueOnce(waitingSnapshot).mockResolvedValue(second),
        setKitchenNote: vi.fn().mockReturnValue(write.promise),
      });
      emit(counter(el), "edit-waiting-kitchen-note", { id: waitingOrder.id });
      await flush(el);
      await saveWaiting(el, "First instruction");
      waitingEditor(el)!.closeEditor();
      await flush(el);
      emit(counter(el), "edit-waiting-kitchen-note", { id: "waiting-8" });
      await flush(el);
      expect(waitingEditor(el)?.note).toBe("Second instruction");
      if (outcome === "success")
        write.resolve({ ...waitingSnapshot, note: "First instruction", revision: 4 });
      else write.reject({ code: "party.out_of_date" });
      await flush(el);
      expect(waitingEditor(el)?.note).toBe("Second instruction");
      expect(waitingEditor(el)?.refusal).toBe("");
      expect(waitingEditor(el)?.shadowRoot!.querySelector("wt-dialog")?.open).toBe(true);
    },
  );
  it.each(["send-lines", "pay-tab", "bill-pay", "submit-draft"])(
    "keeps a refused party note ahead of %s",
    async (action) => {
      const { el, server } = await mountedTable({
        setKitchenNote: vi.fn().mockRejectedValue(new TypeError("network")),
        sendLines: vi.fn(),
        getBillBalance: vi.fn(),
      });
      const store = tableScreen(el).draftStore!;
      store.addProduct(product("cana", "Caña", "2.50"), "1");
      await flush(el);
      const h = await editTable(el, "Unsent instruction");
      expect(h.refusal).not.toBe("");
      emit(
        tableScreen(el),
        action,
        action === "send-lines"
          ? { lineNos: [1] }
          : action === "pay-tab"
            ? { method: "cash", amount: "10.00" }
            : action === "bill-pay"
              ? { way: "contribution", amount: "1.00", lines: [] }
              : { groups: [{ release: "fire", lineIndexes: [0] }], store, sent: store.lines },
      );
      await flush(el);
      expect(api.sendLines).not.toHaveBeenCalled();
      expect(api.recordSale).not.toHaveBeenCalled();
      expect(api.getBillBalance).not.toHaveBeenCalled();
      expect(server.submitDraft).not.toHaveBeenCalled();
      expect(h.shadowRoot!.querySelector("wt-textarea")!.value).toBe("Unsent instruction");
    },
  );
  it("does not begin a card payment when saving a dirty persisted instruction fails", async () => {
    const el = await mounted({
      setKitchenNote: vi.fn().mockRejectedValue(new TypeError("network")),
      pay: vi.fn(),
    });
    const store = basket(el).store;
    store.kitchenNote = "Unsent instruction";
    emit(counter(el), "collect-card", {});
    await flush(el);
    expect(api.setKitchenNote).toHaveBeenCalledOnce();
    expect(api.pay).not.toHaveBeenCalled();
    expect(store.kitchenNote).toBe("Unsent instruction");
  });
});

it.each(["save refusal", "conflict reread"])(
  "keeps a reopened table after an old note's %s",
  async (phase) => {
    const write = deferred<typeof partyNote>();
    const read = deferred<typeof partyNote>();
    const { el } = await mountedTable({
      setKitchenNote: vi.fn().mockReturnValue(write.promise),
      getKitchenNote: vi.fn().mockReturnValue(read.promise),
    });
    await editTable(el, "Old visit draft");
    if (phase === "conflict reread") {
      write.reject({ code: "party.out_of_date" });
      await flush(el);
      expect(api.getKitchenNote).toHaveBeenCalledOnce();
    }
    vi.mocked(api.getTablesState).mockResolvedValue([
      tableRow(
        tableParty({ ...partyNote, note: "New visit instruction", revision: 5, ownerRevision: 8 }),
      ),
    ]);
    emit(tableScreen(el), "floor-refresh", {});
    await flush(el);
    emit(tableScreen(el), "open-table", { tableId: "table-four", seated: true });
    await flush(el);
    expect(tableHeading(el).note).toBe("New visit instruction");
    if (phase === "save refusal") write.reject({ code: "party.out_of_date" });
    else
      read.resolve({
        ...partyNote,
        note: "Old conflict instruction",
        revision: 2,
        ownerRevision: 3,
      });
    await flush(el);
    expect(tableHeading(el).note).toBe("New visit instruction");
    expect(tableHeading(el).refusal).toBe("");
    expect(tableScreen(el).party?.revision).toBe(8);
    if (phase === "save refusal") expect(api.getKitchenNote).not.toHaveBeenCalled();
  },
);

it.each(["scope", "visit"])("drops a counter save event with an obsolete %s", async (field) => {
  const el = await mounted();
  const store = basket(el).store;
  emit(heading(el), "save-kitchen-note", {
    scopeKey: field === "scope" ? "order:earlier-order" : store.kitchenNoteScopeKey,
    visit: field === "visit" ? store.loadGeneration - 1 : store.loadGeneration,
    revision: store.kitchenNoteRevision,
    note: "Obsolete instruction",
  });
  await flush(el);
  expect(store.kitchenNote).toBeNull();
  expect(api.setKitchenNote).not.toHaveBeenCalled();
});
it.each(["scope", "visit"])("drops a party save event with an obsolete %s", async (field) => {
  const { el } = await mountedTable();
  const h = tableHeading(el);
  emit(h, "save-kitchen-note", {
    scopeKey: field === "scope" ? "party:earlier-party" : h.scopeKey,
    visit: field === "visit" ? h.visit - 1 : h.visit,
    revision: h.revision,
    note: "Obsolete instruction",
  });
  await flush(el);
  expect(h.note).toBe(partyNote.note);
  expect(api.setKitchenNote).not.toHaveBeenCalled();
});
it("does not pay a basket replaced just after its dirty note was saved", async () => {
  const el = await mounted({
    setKitchenNote: vi.fn().mockResolvedValue({
      scope: { workingOrderId: "wo-9" },
      note: "Saved instruction",
      revision: 1,
      ownerRevision: 4,
    }),
  });
  const store = basket(el).store;
  store.kitchenNote = "Saved instruction";
  let replaced = false;
  const off = store.subscribe(() => {
    if (!replaced && !store.kitchenNoteDirty) {
      replaced = true;
      queueMicrotask(() =>
        store.loadFrom("replacement", store.lines.slice(), "New order", 8, {
          note: "Replacement instruction",
          revision: 0,
          ownerRevision: 8,
          scopeKey: "order:replacement",
        }),
      );
    }
  });
  emit(counter(el), "confirm-payment", { method: "cash", amount: "10.00" });
  await flush(el);
  off();
  expect(replaced).toBe(true);
  expect(store.id).toBe("replacement");
  expect(store.kitchenNote).toBe("Replacement instruction");
  expect(api.recordSale).not.toHaveBeenCalled();
});
