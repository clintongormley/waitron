import { currentContentLanguages } from "@waitron/ui";
import type { ContentLanguages } from "@waitron/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { productUnit } from "./widgets/product-name.js";
import { TillApp } from "./till-app.js";
import { ServerRouter } from "./api/server-router.js";
import { setLocale, t } from "./i18n/t.js";
import { DEV_DEVICE_STORAGE_KEY } from "./api/dev-device.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTicketView } from "./screens/till-ticket-view.js";
import type { CanvasDef, CapabilityFlag } from "./layout.js";
import type {
  ProductCatalogue,
  ServiceZoneSummary,
  TillApi,
  TillProduct,
  TillSaleResult,
  ZoneOfferCatalogue,
} from "./api/client.js";

const cafe: TillProduct = {
  id: "cafe",
  name: "Café",
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
  catalogueId: "cat-default",
  catalogueName: "Carta",
};

const defaultMenu = { id: "cat-default", name: "Carta", isDefault: true };

const saleResult: TillSaleResult = {
  orderLabel: null,
  orderNumber: 1,
  invoiceNumber: "F-0001",
  issuedAt: "2026-08-05T10:00:00.000Z",
  total: "3.00",
  vatBreakdown: [{ rate: "21", base: "2.48", tax: "0.52" }],
  lines: [{ descriptions: { "es-ES": "Café" }, quantity: "2", gross: "3.00" }],
  tender: { method: "cash", change: "2.00" },
  qr: "https://example.test/vf?nif=B1&num=F-0001&fecha=05-08-2026&total=3.00",
};

const tillCanvas: CanvasDef = {
  formFactor: "till",
  tabs: [
    {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [{ type: "product-grid", colSpan: 8, rowSpan: 6, config: {} }],
    },
    {
      key: "floor",
      title: "Floor",
      columns: 24,
      cards: [{ type: "floor-plan", colSpan: 24, rowSpan: 12, config: {} }],
    },
  ],
};

const kdsCanvas: CanvasDef = {
  formFactor: "kds",
  tabs: [
    {
      key: "kitchen",
      title: "Kitchen",
      columns: 24,
      cards: [{ type: "kds-board", colSpan: 24, rowSpan: 12, config: {} }],
    },
  ],
};

const till = {
  locale: "es-ES",
  invoiceLocale: "es-ES",
  venueName: "Bar Pepe",
  nif: "B12345678",
  orderFlow: "prepay" as const,
  receiptPrintMode: "auto" as "auto" | "on_request" | "never",
  bumpMode: "line" as const,
  fireControl: "waiter" as const,
  courses: [] as { id: string; name: string; displayOrder: number }[],
  cardProvider: "none" as const,
  tipsEnabled: false,
  canvas: tillCanvas,
  capabilities: ["print-receipt"] as CapabilityFlag[],
  inactivityTimeoutSeconds: null as number | null,
  nodeId: "n1",
  servers: [],
};

function zoneOffers(
  catalogue: ProductCatalogue,
  zoneId: string,
  serviceMode: ServiceZoneSummary["serviceMode"] = "prepay",
  defaultMenuId: string | null = catalogue.menus.find((menu) => menu.isDefault)?.id ?? null,
): ZoneOfferCatalogue {
  return {
    context: { zoneId, departmentId: "department-default", serviceMode },
    defaultMenuId,
    menus: catalogue.menus,
    offers: catalogue.products.map((product, index): ZoneOfferCatalogue["offers"][number] => ({
      id: product.menuItemId ?? `menu-item-${product.id}-${index}`,
      menuId: product.catalogueId ?? "menu-fixture",
      productId: product.productId ?? product.id,
      sectionId: `section-${index}`,
      grossPrice: product.unitPrice,
      unitPrice: product.unitPrice,
      displayOrder: index,
      active: true,
      menuName: product.catalogueName ?? "Menu",
      sectionName: { en: product.category ?? "Other" },
      name: product.name,
      customerName: null,
      kitchenName: null,
      unit: productUnit(product),
      vatClass: product.vatClass,
      category: product.category ?? "Other",
      allergens: product.allergens,
      diet: null,
      dietDerivation: null,
      dietOverride: null,
      dietaryDeclarations: [],
      offeredModifiers: [],
      variants: [],
      courseId: null,
    })),
  };
}

const zone = (id: string, serviceMode: ServiceZoneSummary["serviceMode"]): ServiceZoneSummary => ({
  id,
  name: id,
  departmentId: `department-${id}`,
  departmentName: id,
  serviceMode,
});

let api: TillApi;
function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getTill: vi.fn().mockResolvedValue(till),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
    }),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
      stationId: null,
    }),
    getDeviceStation: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    listStaff: vi.fn().mockResolvedValue([]),
    listDefaultZoneOffers: vi
      .fn()
      .mockResolvedValue(zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter")),
    listZoneOffers: vi.fn(),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    getStationQueue: vi.fn().mockResolvedValue([]),
    getExpoQueue: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    listStatuses: vi.fn().mockResolvedValue([]),
    recordSale: vi.fn().mockResolvedValue(saleResult),
    pay: vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult }),
    retrieveWorkingOrder: vi.fn(),
    reprint: vi.fn().mockResolvedValue(undefined),
    printReceipt: vi.fn().mockResolvedValue(undefined),
    printPaymentSlip: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
}

function fakeSessionActivity() {
  return {
    configure: vi.fn(),
    noteInteraction: vi.fn(),
    reacquire: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

async function mountApp(overrides: Record<string, unknown> = {}, props: Partial<TillApp> = {}) {
  api = stubApi(overrides);
  return mountWidget<TillApp>("till-app", { api, ...props });
}

async function flush(el: TillApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

const lock = (el: TillApp) => el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen");
const shell = (el: TillApp) =>
  el.shadowRoot!.querySelector<
    HTMLElement & { activeTabKey?: string; loadLocales?: () => Promise<unknown> }
  >("till-tab-shell");
const counter = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen");
const ticket = (el: TillApp) => el.shadowRoot!.querySelector<TillTicketView>("till-ticket-view");
const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");
const privateState = <T>(el: TillApp, field: string): T =>
  (el as unknown as Record<string, T>)[field]!;

async function toCounter(el: TillApp): Promise<TillCounterScreen> {
  await flush(el);
  emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
  await flush(el);
  return counter(el)!;
}

/** Stands in for the page's `setTimeout` so the one-minute content-language refresh can be fired by
 * hand; every other delay still runs on the real timer. */
function captureMinuteTimers() {
  const realSetTimeout = window.setTimeout.bind(window);
  const minuteTimers: (() => void)[] = [];
  const spy = vi.spyOn(window, "setTimeout").mockImplementation(((
    handler: () => void,
    ms?: number,
  ) => {
    if (ms === 60_000) {
      minuteTimers.push(handler);
      return 0;
    }
    return realSetTimeout(handler, ms);
  }) as unknown as typeof window.setTimeout);
  return { minuteTimers, restore: () => spy.mockRestore() };
}

beforeEach(() => {
  setLocale("es-ES");
  sessionStorage.removeItem(DEV_DEVICE_STORAGE_KEY);
});
const initialUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  sessionStorage.removeItem("waitron.lastMenu");
  sessionStorage.removeItem("waitron.dietFilter");
  history.replaceState(null, "", initialUrl);
});

describe("till-app session activity", () => {
  it("restarts the idle countdown on a pointer or key press anywhere inside the app", async () => {
    const sa = fakeSessionActivity();
    const { el } = await mountApp({}, { sessionActivity: sa as never });
    await flush(el);
    const inner = lock(el)!;

    inner.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(sa.noteInteraction).toHaveBeenCalledTimes(1);
    inner.dispatchEvent(new Event("keydown", { bubbles: true, composed: true }));
    expect(sa.noteInteraction).toHaveBeenCalledTimes(2);
  });

  it("asks for the screen wake lock again when the tab's visibility changes", async () => {
    const sa = fakeSessionActivity();
    const { el } = await mountApp({}, { sessionActivity: sa as never });
    await flush(el);
    expect(sa.reacquire).not.toHaveBeenCalled();

    document.dispatchEvent(new Event("visibilitychange"));

    expect(sa.reacquire).toHaveBeenCalledOnce();
  });

  it("treats a device with an unknown form factor as an ordinary till on the login screen", async () => {
    const sa = fakeSessionActivity();
    const { el } = await mountApp(
      {
        getDeviceIdentity: vi.fn().mockResolvedValue({
          deviceId: "d9",
          name: "Future device",
          formFactor: "wall-panel",
          stationId: null,
        }),
      },
      { sessionActivity: sa as never },
    );
    await flush(el);

    expect(sa.configure.mock.calls.at(-1)![0]).toMatchObject({ loggedIn: false, kind: "till" });
    expect(lock(el)).not.toBeNull();
    expect(lock(el)!.deviceName).toBe("Future device");
  });
});

describe("till-app boot interrupted by removal from the page", () => {
  it("does not open the dev device chooser when the device list arrives after removal", async () => {
    let resolveDevices!: (list: unknown) => void;
    const { el, host } = await mountApp({
      getDevDevices: vi.fn(() => new Promise((resolve) => (resolveDevices = resolve))),
    });
    await flush(el);

    host.removeChild(el);
    resolveDevices({ devices: [] });
    await flush(el);
    host.appendChild(el);
    await flush(el);

    expect(el.shadowRoot!.querySelector("till-device-chooser")).toBeNull();
    expect(lock(el)).not.toBeNull();
  });

  it("does not enter kitchen-display mode when the station arrives after removal", async () => {
    const sa = fakeSessionActivity();
    let resolveStation!: (station: unknown) => void;
    const { el, host } = await mountApp(
      {
        getTill: vi
          .fn()
          .mockResolvedValue({ ...till, canvas: kdsCanvas, capabilities: ["act-as-kds"] }),
        getDeviceIdentity: vi.fn().mockResolvedValue({
          deviceId: "kds1",
          name: "Pass",
          formFactor: "kds",
          stationId: "st-1",
        }),
        getDeviceStation: vi.fn(() => new Promise((resolve) => (resolveStation = resolve))),
      },
      { sessionActivity: sa as never },
    );
    await flush(el);

    host.removeChild(el);
    resolveStation({ station: { id: "st-1", queue: [] } });
    await flush(el);

    expect(sa.configure).not.toHaveBeenCalled();
    host.appendChild(el);
    await flush(el);
    expect(shell(el)).toBeNull();
    expect(lock(el)).not.toBeNull();
  });
});

describe("till-app content languages", () => {
  it("re-reads the content languages every minute and applies the new answer", async () => {
    const timers = captureMinuteTimers();
    try {
      const getContentLanguages = vi
        .fn()
        .mockResolvedValueOnce({ defaultLanguage: "fr", languages: ["fr", "en"] })
        .mockResolvedValueOnce({ defaultLanguage: "ca", languages: ["ca", "es"] });
      const { el } = await mountApp({ getContentLanguages });
      await flush(el);
      expect(currentContentLanguages().defaultLanguage).toBe("fr");
      expect(timers.minuteTimers).toHaveLength(1);

      timers.minuteTimers[0]!();
      await flush(el);

      expect(getContentLanguages).toHaveBeenCalledTimes(2);
      expect(currentContentLanguages().defaultLanguage).toBe("ca");
      expect(timers.minuteTimers).toHaveLength(2);
    } finally {
      timers.restore();
    }
  });

  it("keeps the minute refresh going after a refresh fails, without an unhandled rejection", async () => {
    const timers = captureMinuteTimers();
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent): void => {
      rejections.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    try {
      const getContentLanguages = vi
        .fn()
        .mockResolvedValueOnce({ defaultLanguage: "fr", languages: ["fr", "en"] })
        .mockRejectedValueOnce(new TypeError("Failed to fetch"));
      const { el } = await mountApp({ getContentLanguages });
      await flush(el);

      timers.minuteTimers[0]!();
      await flush(el);
      await flush(el);

      expect(getContentLanguages).toHaveBeenCalledTimes(2);
      expect(rejections).toEqual([]);
      expect(currentContentLanguages().defaultLanguage).toBe("fr");
      expect(timers.minuteTimers).toHaveLength(2);
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
      timers.restore();
    }
  });

  it("applies nothing and schedules no refresh when the first answer arrives after removal", async () => {
    const timers = captureMinuteTimers();
    try {
      let answer!: (config: ContentLanguages) => void;
      const { el, host } = await mountApp({
        getContentLanguages: vi.fn(() => new Promise((resolve) => (answer = resolve))),
      });
      const before = currentContentLanguages().defaultLanguage;
      expect(before).not.toBe("fr");

      host.removeChild(el);
      answer({ defaultLanguage: "fr", languages: ["fr", "en"] });
      await flush(el);

      expect(currentContentLanguages().defaultLanguage).toBe(before);
      expect(timers.minuteTimers).toHaveLength(0);
    } finally {
      timers.restore();
    }
  });
});

describe("till-app receipt issuance", () => {
  async function ticketAfterSale(tillInfo: Record<string, unknown>): Promise<TillTicketView> {
    const { el } = await mountApp({ getTill: vi.fn().mockResolvedValue(tillInfo) });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    return ticket(el)!;
  }

  it("treats a server that sends no receipt print mode as printing automatically", async () => {
    const legacyTill: Record<string, unknown> = { ...till };
    delete legacyTill.receiptPrintMode;

    expect((await ticketAfterSale(legacyTill)).originalReceiptAvailable).toBe(false);
    cleanupWidgets();
    expect(
      (await ticketAfterSale({ ...till, receiptPrintMode: "on_request" })).originalReceiptAvailable,
    ).toBe(true);
  });

  it("keeps the original receipt on offer and says why when printing it fails", async () => {
    const printReceipt = vi.fn().mockRejectedValue({ code: "printing.no_printer" });
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, receiptPrintMode: "on_request" }),
      printReceipt,
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    const workingOrderId = vi.mocked(api.recordSale).mock.calls[0]![2];

    emit(ticket(el)!, "print-receipt");
    await flush(el);

    expect(printReceipt).toHaveBeenCalledWith(workingOrderId);
    expect(banner(el)!.textContent).toContain(t("receipt.error"));
    expect(ticket(el)!.originalReceiptAvailable).toBe(true);
  });

  it("says the card slip could not print when printing it fails", async () => {
    const printPaymentSlip = vi.fn().mockRejectedValue({ code: "printing.no_printer" });
    const { el } = await mountApp({ printPaymentSlip });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    emit(ticket(el)!, "payment-slip");
    await flush(el);

    expect(printPaymentSlip).toHaveBeenCalledOnce();
    expect(banner(el)!.textContent).toContain(t("payment_slip.error"));
    expect(ticket(el)).not.toBeNull();
  });

  it.each([
    ["reprint", "reprint"],
    ["print-receipt", "printReceipt"],
    ["payment-slip", "printPaymentSlip"],
  ] as const)("a %s request with no filed sale on screen sends nothing", async (type, method) => {
    const { el } = await mountApp();
    const c = await toCounter(el);

    emit(c, type);
    await flush(el);

    expect(
      (api as unknown as Record<string, ReturnType<typeof vi.fn>>)[method],
    ).not.toHaveBeenCalled();
    expect(banner(el)).toBeNull();
  });
});

describe("till-app counter menus and service zones", () => {
  const twoMenus = [
    { id: "menu-food", name: "Comida", isDefault: false },
    { id: "menu-drinks", name: "Bebidas", isDefault: true },
  ];

  it("ignores a menu pick naming a menu the counter's zone does not offer", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    expect(privateState<string>(el, "selectedCatalogueId")).toBe("cat-default");
    sessionStorage.removeItem("waitron.lastMenu");

    emit(c, "menu-selected", { id: "menu-elsewhere" });
    await flush(el);

    expect(privateState<string>(el, "selectedCatalogueId")).toBe("cat-default");
    expect(sessionStorage.getItem("waitron.lastMenu")).toBeNull();
  });

  it("ignores a zone change naming a zone the counter was not offered", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    catalogue.zones = [zone("zone-counter", "prepay"), zone("zone-deli", "prepay")];
    const { el } = await mountApp({ listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue) });
    const c = await toCounter(el);

    emit(c, "counter-zone-selected", { zoneId: "zone-unknown" });
    await flush(el);

    expect(api.listZoneOffers).not.toHaveBeenCalled();
    expect(c.selectedServiceZoneId).toBe("zone-counter");
  });

  it("keeps the counter's pay timing when the new zone serves by table tab, and falls back to its marked default menu", async () => {
    const catalogue = zoneOffers(
      { menus: [defaultMenu], products: [cafe] },
      "zone-counter",
      "invoice_first",
    );
    catalogue.zones = [zone("zone-counter", "invoice_first"), zone("zone-terrace", "table_tab")];
    const terrace = zoneOffers(
      {
        menus: twoMenus,
        products: [
          { ...cafe, id: "tostada", catalogueId: "menu-food" },
          { ...cafe, id: "cana", catalogueId: "menu-drinks" },
        ],
      },
      "zone-terrace",
      "table_tab",
      null,
    );
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
      listZoneOffers: vi.fn().mockResolvedValue(terrace),
    });
    const c = await toCounter(el);
    expect(c.orderFlow).toBe("invoice_first");

    emit(c, "counter-zone-selected", { zoneId: "zone-terrace" });
    await flush(el);

    expect(c.selectedServiceZoneId).toBe("zone-terrace");
    expect(c.orderFlow).toBe("invoice_first");
    expect(c.selectedMenuId).toBe("menu-drinks");
  });

  it("shows service_zone.load_error when the new zone's menus cannot load, but not for a superseded request", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    catalogue.zones = [
      zone("zone-counter", "prepay"),
      zone("zone-a", "prepay"),
      zone("zone-b", "prepay"),
    ];
    let rejectA!: (reason: unknown) => void;
    let rejectB!: (reason: unknown) => void;
    const listZoneOffers = vi.fn(
      (zoneId: string) =>
        new Promise<ZoneOfferCatalogue>((_resolve, reject) => {
          if (zoneId === "zone-a") rejectA = reject;
          else rejectB = reject;
        }),
    );
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
      listZoneOffers,
    });
    const c = await toCounter(el);

    emit(c, "counter-zone-selected", { zoneId: "zone-a" });
    emit(c, "counter-zone-selected", { zoneId: "zone-b" });
    rejectA(new TypeError("Failed to fetch"));
    await flush(el);
    expect(banner(el)).toBeNull();

    rejectB(new TypeError("Failed to fetch"));
    await flush(el);
    expect(banner(el)!.textContent).toContain(t("service_zone.load_error"));
    expect(c.selectedServiceZoneId).toBe("zone-counter");
  });
});

describe("till-app integrated card collection", () => {
  it("sends the reader the operator picked", async () => {
    const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, cardProvider: "simulator" }),
      pay,
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    await el.updateComplete;

    emit(c, "collect-card", { readerId: "reader-2" });
    await flush(el);

    expect(pay).toHaveBeenCalledWith(expect.objectContaining({ readerId: "reader-2" }));
  });
});

describe("till-app retrieving a held order", () => {
  it("resolves a line's selling id to the FIRST live offer carrying it", async () => {
    const catalogue = zoneOffers(
      {
        menus: [defaultMenu],
        products: [
          { ...cafe, id: "first", name: "Primero", unitPrice: "1.00", menuItemId: "mi-dup" },
          { ...cafe, id: "second", name: "Segundo", unitPrice: "2.00", menuItemId: "mi-dup" },
        ],
      },
      "zone-counter",
    );
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
      retrieveWorkingOrder: vi.fn().mockResolvedValue({
        id: "wo-1",
        orderNumber: 5,
        label: null,
        lines: [{ menuItemId: "mi-dup", quantity: "1.000" }],
      }),
    });
    const c = await toCounter(el);

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);

    expect(c.store.lines.map((line) => line.product.name)).toEqual(["Primero"]);
  });

  it("keeps a line that names no product or selling id from its stored snapshot", async () => {
    const snapshot: TillProduct = { ...cafe, id: "retired", name: "Antiguo", unitPrice: "4.00" };
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn().mockResolvedValue({
        id: "wo-1",
        orderNumber: 5,
        label: null,
        lines: [{ quantity: "1.000", product: snapshot }],
      }),
    });
    const c = await toCounter(el);

    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);

    expect(c.store.lines).toHaveLength(1);
    expect(c.store.lines[0]!.product).toMatchObject({ id: "retired", name: "Antiguo" });
    expect(c.store.lines[0]!.quantity).toBe("1");
    expect(banner(el)).toBeNull();
  });
});

describe("till-app shell navigation", () => {
  it("ignores a tab selection naming a tab the canvas does not have", async () => {
    const { el } = await mountApp();
    await toCounter(el);
    const path = location.pathname;

    emit(shell(el)!, "tab-select", { key: "reports" });
    await flush(el);

    expect(shell(el)!.activeTabKey).toBe("counter");
    expect(counter(el)).not.toBeNull();
    expect(location.pathname).toBe(path);
  });

  it("renders the shell with no tab body for a canvas that authors no tabs", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: { formFactor: "till", tabs: [] } }),
    });
    await toCounter(el);

    expect(shell(el)).not.toBeNull();
    expect(counter(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-card-grid")).toBeNull();
  });

  it("does not open a destination as an overlay when the canvas authors it as a tab", async () => {
    const withScheduleTab: CanvasDef = {
      formFactor: "till",
      tabs: [...tillCanvas.tabs, { key: "schedule", title: "Schedule", columns: 12, cards: [] }],
    };
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: withScheduleTab }),
    });
    await toCounter(el);

    emit(shell(el)!, "show-schedule");
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-schedule-screen")).toBeNull();
    expect(location.pathname).not.toContain("schedule");

    emit(shell(el)!, "show-expo");
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-expo-screen")).not.toBeNull();
  });

  it("hands the shell's language chooser the till's list of interface languages", async () => {
    const { el } = await mountApp();
    await toCounter(el);

    await expect(shell(el)!.loadLocales!()).resolves.toEqual([
      { code: "es-ES", label: "Español" },
      { code: "en-GB", label: "English" },
    ]);
    expect(api.getLocales).toHaveBeenCalledOnce();
  });

  it("probes the servers again when the lock screen asks to check again", async () => {
    const router = new ServerRouter({
      origin: "https://box.deli.test",
      fetchImpl: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as typeof fetch,
      storage: { getItem: () => null, setItem: () => undefined },
    });
    const probeNow = vi.spyOn(router, "probeNow").mockResolvedValue(undefined);
    const { el } = await mountApp({}, { router });
    await flush(el);

    emit(lock(el)!, "check-again");

    expect(probeNow).toHaveBeenCalledOnce();
  });
});

describe("till-app logout while a request is waiting for the server", () => {
  it("stays on the lock screen when a cash sale's answer arrives after the operator logged out", async () => {
    let answerSale!: (result: TillSaleResult) => void;
    const { el } = await mountApp({
      recordSale: vi.fn(() => new Promise<TillSaleResult>((resolve) => (answerSale = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(api.recordSale).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    expect(lock(el)).not.toBeNull();

    answerSale(saleResult);
    await flush(el);

    expect(lock(el)).not.toBeNull();
    expect(shell(el)).toBeNull();
    expect(privateState<string>(el, "operatorName")).toBe("");
  });
});
