import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, draftServer, mountWidget } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { CanvasDef, CapabilityFlag } from "./layout.js";
import { menuOfferToTillProduct } from "./api/client.js";
import type {
  MenuState,
  ServiceZoneSummary,
  TillApi,
  TillMenuOffer,
  TillSaleResult,
  ZoneOfferCatalogue,
} from "./api/client.js";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";

interface Menu {
  id: string;
  name: string;
  product: string;
}
const DESAYUNOS: Menu = { id: "desayunos", name: "Desayunos", product: "Tostada" };
const ALMUERZO: Menu = { id: "almuerzo", name: "Almuerzo", product: "Menú del día" };
const CENA: Menu = { id: "cena", name: "Cena", product: "Croquetas" };

const unit = {
  id: "unit-each",
  name: { es: "unidad", en: "unit" },
  abbreviation: { es: "ud", en: "ea" },
  precision: 0,
  hardwareUnit: null,
};

function offer(menu: Menu): TillMenuOffer {
  return {
    id: `offer-${menu.id}`,
    menuId: menu.id,
    productId: menu.product,
    grossPrice: null,
    unitPrice: "3.00",
    available: true,
    image: null,
    description: null,
    menuName: menu.name,
    placements: [[]],
    name: menu.product,
    customerName: { es: menu.product },
    kitchenName: menu.product,
    unit,
    vatClass: "general",
    category: null,
    allergens: null,
    diet: null,
    dietDerivation: null,
    dietOverride: null,
    dietaryDeclarations: [],
    courseId: null,
    offeredModifiers: [],
    variants: [],
  } satisfies TillMenuOffer;
}

const zone = (id: string, name: string): ServiceZoneSummary => ({
  id,
  name,
  departmentId: "department-restaurant",
  departmentName: "Restaurant",
  serviceMode: "prepay",
});
const ZONES = [zone("zone-barra", "Barra"), zone("zone-terraza", "Terraza")];

function offers(
  zoneId: string,
  menus: Menu[],
  defaultMenuId: string,
  serviceMode: ZoneOfferCatalogue["context"]["serviceMode"] = "prepay",
): ZoneOfferCatalogue {
  return {
    service: { open: true, periodName: null, keepOpen: null },
    context: {
      departmentName: "Restaurant",
      zoneId,
      departmentId: "department-restaurant",
      serviceMode,
    },
    defaultMenuId,
    menus: menus.map((menu) => ({
      id: menu.id,
      name: menu.name,
      isDefault: menu.id === defaultMenuId,
      orderable: true,
      sendable: true,
      audience: "customer",
      versionId: "v1",
      structure: {
        members: [
          { kind: "product" as const, menuItemId: `offer-${menu.id}`, productId: menu.product },
        ],
      },
      home: {
        shortcuts: [],
        handheld: HOME_DISPLAY_DEFAULTS.handheld,
        till: HOME_DISPLAY_DEFAULTS.till,
      },
    })),
    offers: menus.map(offer),
    zones: ZONES,
  };
}

/** Barra opens on Desayunos, beside Almuerzo. */
const BARRA = offers("zone-barra", [DESAYUNOS, ALMUERZO], "desayunos");
/** Terraza opens on Cena, beside Almuerzo and Desayunos. */
const TERRAZA = offers("zone-terraza", [CENA, ALMUERZO, DESAYUNOS], "cena");

function state(menus: Menu[], defaultMenuId?: string): MenuState & { defaultMenuId?: string } {
  return {
    service: { open: true, periodName: null, keepOpen: null },
    menus: menus.map((menu) => ({
      menuId: menu.id,
      versionId: "v1",
      orderable: true,
      sendable: true,
    })),
    unavailable: { products: [], optionLabels: [] },
    ...(defaultMenuId === undefined ? {} : { defaultMenuId }),
  };
}

const saleResult: TillSaleResult = {
  orderLabel: null,
  orderNumber: 1,
  invoiceNumber: "F-0001",
  issuedAt: "2026-10-05T10:00:00.000Z",
  total: "3.00",
  vatBreakdown: [{ rate: "21", base: "2.48", tax: "0.52" }],
  lines: [{ descriptions: { "es-ES": "Tostada" }, quantity: "1", gross: "3.00" }],
  tender: { method: "cash", change: "17.00" },
  qr: "https://example.test/vf",
};

const counterTab: CanvasDef["tabs"][number] = {
  key: "counter",
  title: "Counter",
  columns: 12,
  cards: [
    { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
    { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
    { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
  ],
};

const tableCanvas: CanvasDef = {
  formFactor: "till",
  tabs: [
    counterTab,
    {
      key: "floor",
      title: "Floor",
      columns: 24,
      cards: [{ type: "floor-plan", colSpan: 24, rowSpan: 12, config: {} }],
    },
    {
      key: "order",
      title: "Order",
      columns: 12,
      cards: [{ type: "table-order", colSpan: 12, rowSpan: 8, config: {} }],
    },
  ],
};

const till = {
  locale: "en-GB",
  invoiceLocale: "es-ES",
  venueName: "Casa Delgado",
  nif: "B12345678",
  orderFlow: "prepay" as const,
  receiptPrintMode: "auto" as const,
  bumpMode: "line" as const,
  fireControl: "waiter" as const,
  courses: [],
  cardProvider: "none" as const,
  tipsEnabled: false,
  canvas: { formFactor: "till", tabs: [counterTab] } satisfies CanvasDef,
  capabilities: ["print-receipt", "take-cash"] as CapabilityFlag[],
  inactivityTimeoutSeconds: null,
  nodeId: "n1",
  servers: [],
};

let drafts: ReturnType<typeof draftServer>;
let api: Record<string, ReturnType<typeof vi.fn>>;

function stubApi(overrides: Record<string, unknown> = {}) {
  return {
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getTill: vi.fn().mockResolvedValue(till),
    getLocales: vi.fn().mockResolvedValue({ locales: [], venueDefault: "es-ES" }),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
      stationId: null,
    }),
    listStaff: vi.fn().mockResolvedValue([]),
    listDefaultZoneOffers: vi.fn(async () => BARRA),
    listZoneOffers: vi.fn(async (zoneId: string) => (zoneId === "zone-terraza" ? TERRAZA : BARRA)),
    menuState: vi.fn(async (zoneId: string) =>
      zoneId === "zone-terraza" ? state([CENA, ALMUERZO, DESAYUNOS]) : state([DESAYUNOS, ALMUERZO]),
    ),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    recordSale: vi.fn().mockResolvedValue(saleResult),
    parkOrder: vi.fn().mockResolvedValue({ id: "wo-1", orderNumber: 5 }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as Record<string, ReturnType<typeof vi.fn>>;
}

async function mountApp(overrides: Record<string, unknown> = {}) {
  api = stubApi(overrides);
  return mountWidget<TillApp>("till-app", { api: api as unknown as TillApi });
}

/** Settles awaited API promises (the real `setTimeout` is not faked) and Lit's render. */
async function flush(el: TillApp): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

/** One poll tick: only `setInterval` is faked, so every other wait in the app keeps real time. */
async function poll(el: TillApp): Promise<void> {
  vi.advanceTimersByTime(15_000);
  await flush(el);
}

function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

const lock = (el: TillApp) => el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen")!;
const counter = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
const selected = (el: TillApp) => counter(el).selectedMenuId;

async function signIn(el: TillApp, personId = "p1"): Promise<void> {
  await flush(el);
  emit(lock(el), "logged-in", { personId, displayName: "Ana", permissions: [] });
  await flush(el);
}

async function signInAgain(el: TillApp, personId = "p1"): Promise<void> {
  emit(counter(el), "logout");
  await flush(el);
  await signIn(el, personId);
}

/** Adds the counter's product from `menu`, as a tap on its tile would. */
function add(el: TillApp, menu: Menu): void {
  const c = counter(el);
  c.store.addProduct(
    c.products.find((product) => product.productId === menu.product)!,
    "1",
  );
}

async function park(el: TillApp): Promise<void> {
  emit(counter(el), "park-order", {});
  await flush(el);
}

beforeEach(() => {
  setLocale("en-GB");
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  drafts = draftServer(() => ({ tabId: "wo-7", revision: 2, groups: [] }));
});
afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
  sessionStorage.removeItem("waitron.lastMenu");
});

describe("period service at the counter", () => {
  it("end-offset poll closes selection with unchanged service and versions, then marks grace expiry", async () => {
    const running = { ...BARRA, service: { open: true, periodName: "Breakfast" } };
    const { el } = await mountApp({ listDefaultZoneOffers: vi.fn(async () => running) });
    await signIn(el);
    add(el, DESAYUNOS);
    await flush(el);
    const grace = {
      ...running,
      defaultMenuId: null,
      menus: running.menus.map((menu) => ({
        ...menu,
        orderable: false,
        sendable: true,
        isDefault: false,
      })),
    };
    api.listZoneOffers.mockResolvedValue(grace);
    api.menuState.mockResolvedValue({
      ...state([DESAYUNOS, ALMUERZO]),
      service: running.service,
      menus: state([DESAYUNOS, ALMUERZO]).menus.map((menu) => ({
        ...menu,
        orderable: false,
        sendable: true,
      })),
    });
    await poll(el);
    expect(counter(el).menus.every((menu) => !menu.orderable && menu.sendable)).toBe(true);
    const screen = counter(el);
    const grid = screen.shadowRoot!.querySelector("till-card-grid")!;
    expect(grid.shadowRoot!.querySelector("till-menu-browser")).toBeNull();
    expect(screen.shadowRoot!.querySelector("[data-last-orders-ended]")?.textContent?.trim()).toBe(
      "Last orders have ended",
    );
    expect(screen.store.lines[0]?.blocked).toBeUndefined();
    screen.store.setLineQuantity(0, "2");
    expect(screen.store.lines[0]?.quantity).toBe("1");
    const expired = { ...grace, menus: grace.menus.map((menu) => ({ ...menu, sendable: false })) };
    api.listZoneOffers.mockResolvedValue(expired);
    api.menuState.mockResolvedValue({
      ...state([DESAYUNOS, ALMUERZO]),
      service: running.service,
      menus: state([DESAYUNOS, ALMUERZO]).menus.map((menu) => ({
        ...menu,
        orderable: false,
        sendable: false,
      })),
    });
    await poll(el);
    expect(screen.store.lines[0]?.blocked).toBe("period_ended");
    const basket = grid.shadowRoot!.querySelector("till-basket")!;
    expect(basket.shadowRoot!.textContent).toContain("Last orders have ended");
    emit(screen, "confirm-payment", { method: "cash", amount: "20" });
    await flush(el);
    expect(api.recordSale).not.toHaveBeenCalled();
  });

  it("names the newly selected counter department when it is closed", async () => {
    const closed = {
      ...TERRAZA,
      context: { ...TERRAZA.context, departmentId: "department-deli", departmentName: "Deli" },
      service: { open: false, periodName: null, keepOpen: null },
      menus: TERRAZA.menus.map((menu) => ({ ...menu, orderable: false })),
    };
    const { el } = await mountApp({ listZoneOffers: vi.fn(async () => closed) });
    await signIn(el);
    emit(counter(el), "counter-zone-selected", { zoneId: "zone-terraza" });
    await flush(el);
    expect(
      counter(el).shadowRoot!.querySelector("[data-service-closed]")?.textContent?.trim(),
    ).toBe("Deli is closed: no period is running");
  });

  it("shows a failed offers read without claiming the department is closed", async () => {
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    await signIn(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();
    expect(counter(el).shadowRoot!.querySelector("[data-service-closed]")).toBeNull();
    expect(counter(el).shadowRoot!.querySelector("[data-service-period]")).toBeNull();
  });

  it.each(["en-GB", "es-ES"] as const)(
    "names a refused menu in one sentence (%s)",
    async (locale) => {
      const previousLocale = currentLocale();
      try {
        const { el } = await mountApp({
          recordSale: vi
            .fn()
            .mockRejectedValue({ code: "menu_period.not_running", menuId: "desayunos" }),
        });
        await signIn(el);
        setLocale(locale);
        add(el, DESAYUNOS);
        await flush(el);
        emit(counter(el), "confirm-payment", { method: "cash", amount: "20" });
        await flush(el);
        expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
          locale === "en-GB"
            ? "Desayunos is not available in the current period."
            : "Desayunos no está disponible en el periodo actual.",
        );
        expect(counter(el).store.lineCount).toBe(1);
      } finally {
        setLocale(previousLocale);
      }
    },
  );

  it("shows the initial closed department and refuses additions while retaining offers", async () => {
    const closed = {
      ...BARRA,
      service: { open: false, periodName: null, keepOpen: null },
      defaultMenuId: null,
      menus: BARRA.menus.map((menu) => ({ ...menu, orderable: false, isDefault: false })),
    };
    const { el } = await mountApp({ listDefaultZoneOffers: vi.fn(async () => closed) });
    await signIn(el);
    add(el, DESAYUNOS);
    await flush(el);
    const screen = counter(el);
    expect(screen.shadowRoot!.querySelector("[data-service-closed]")?.textContent?.trim()).toBe(
      "Restaurant is closed: no period is running",
    );
    const grid = screen.shadowRoot!.querySelector("till-card-grid")!;
    expect(grid.shadowRoot!.querySelector("till-menu-browser")).toBeNull();
    expect(grid.shadowRoot!.querySelector("till-basket")).not.toBeNull();
    expect(screen.store.lines.map((line) => line.product.productId)).toEqual([]);
    expect(screen.products.map((product) => product.productId)).toEqual([
      "Tostada",
      "Menú del día",
    ]);
  });

  it("closes and reopens at a poll without losing the pending basket", async () => {
    const { el } = await mountApp();
    await signIn(el);
    add(el, DESAYUNOS);
    await flush(el);
    const closed = {
      ...BARRA,
      service: { open: false, periodName: null, keepOpen: null },
      defaultMenuId: null,
      menus: BARRA.menus.map((menu) => ({ ...menu, isDefault: false, orderable: false })),
    };
    api.listZoneOffers.mockResolvedValue(closed);
    api.menuState.mockResolvedValue({
      ...state([DESAYUNOS, ALMUERZO]),
      service: closed.service,
      defaultMenuId: null,
    });
    await poll(el);
    expect(counter(el).shadowRoot!.querySelector("[data-service-closed]")).not.toBeNull();
    expect(counter(el).store.lineCount).toBe(1);
    expect(selected(el)).toBe("");
    api.listZoneOffers.mockResolvedValue(BARRA);
    api.menuState.mockResolvedValue(state([DESAYUNOS, ALMUERZO], "desayunos"));
    await poll(el);
    expect(counter(el).shadowRoot!.querySelector("[data-service-closed]")).toBeNull();
    expect(selected(el)).toBe("desayunos");
    expect(counter(el).store.lines.map((line) => [line.product.productId, line.quantity])).toEqual([
      ["Tostada", "1"],
    ]);
  });

  it("refreshes unchanged versions on a period change, chooses the running menu and keeps every basket line", async () => {
    const breakfast = {
      ...BARRA,
      service: { open: true, periodName: "Breakfast", keepOpen: null },
      menus: BARRA.menus.map((menu) => ({ ...menu, orderable: menu.id === "desayunos" })),
    };
    const lunch = {
      ...BARRA,
      defaultMenuId: "almuerzo",
      service: { open: true, periodName: "Lunch", keepOpen: null },
      menus: BARRA.menus.map((menu) => ({
        ...menu,
        isDefault: menu.id === "almuerzo",
        orderable: menu.id === "almuerzo",
      })),
    };
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn(async () => breakfast),
      listZoneOffers: vi.fn(async () => lunch),
    });
    await signIn(el);
    emit(counter(el), "menu-selected", { id: "desayunos" });
    add(el, DESAYUNOS);
    await flush(el);
    api.menuState.mockResolvedValue({
      ...state([DESAYUNOS, ALMUERZO], "almuerzo"),
      service: lunch.service,
    });
    await poll(el);
    expect(api.listZoneOffers).toHaveBeenCalledWith("zone-barra");
    expect(selected(el)).toBe("almuerzo");
    expect(
      counter(el).store.lines.map((line) => [
        line.product.productId,
        line.quantity,
        line.product.unitPrice,
      ]),
    ).toEqual([["Tostada", "1", "3.00"]]);
    expect(el.shadowRoot!.querySelector("till-basket-refresh")).toBeNull();
    expect(
      counter(el).shadowRoot!.querySelector("[data-service-period]")?.textContent?.trim(),
    ).toBe("Lunch");
  });
});

describe("a counter following its zone's default menu", () => {
  it("moves to the polled default while the basket is empty", async () => {
    const { el } = await mountApp();
    await signIn(el);
    expect(selected(el)).toBe("desayunos");

    api.menuState.mockResolvedValue(state([DESAYUNOS, ALMUERZO], "almuerzo"));
    await poll(el);
    expect(selected(el)).toBe("almuerzo");
  });

  it("stays put while the basket has lines, and moves as soon as the sale is over", async () => {
    const { el } = await mountApp();
    await signIn(el);
    add(el, DESAYUNOS);
    await flush(el);

    api.menuState.mockResolvedValue(state([DESAYUNOS, ALMUERZO], "almuerzo"));
    await poll(el);
    expect(selected(el)).toBe("desayunos");

    emit(counter(el), "confirm-payment", { method: "cash", amount: "20" });
    await flush(el);
    expect(api.recordSale).toHaveBeenCalledOnce();
    expect(selected(el)).toBe("desayunos");
    const polls = api.menuState.mock.calls.length;
    emit(counter(el), "new-sale");
    await flush(el);
    expect(counter(el).store.lineCount).toBe(0);
    expect(selected(el)).toBe("almuerzo");
    expect(api.menuState).toHaveBeenCalledTimes(polls);
  });

  it("reloads the offers first when the polled default is a menu it has not loaded", async () => {
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn(async () => offers("zone-barra", [DESAYUNOS], "desayunos")),
      // The reload still names Desayunos: the poll is the newer word on the default.
      listZoneOffers: vi.fn(async () => BARRA),
    });
    await signIn(el);
    expect(counter(el).menus.map((menu) => menu.id)).toEqual(["desayunos"]);

    api.menuState.mockResolvedValue(state([DESAYUNOS, ALMUERZO], "almuerzo"));
    await poll(el);
    expect(api.listZoneOffers).toHaveBeenCalledWith("zone-barra");
    expect(counter(el).menus.map((menu) => menu.id)).toEqual(["desayunos", "almuerzo"]);
    expect(selected(el)).toBe("almuerzo");
  });

  it("changes nothing when the poll's answer carries no default", async () => {
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn(async () =>
        offers("zone-barra", [DESAYUNOS, ALMUERZO], "almuerzo"),
      ),
    });
    await signIn(el);
    expect(selected(el)).toBe("almuerzo");

    api.menuState.mockResolvedValue(state([DESAYUNOS, ALMUERZO]));
    await poll(el);
    expect(selected(el)).toBe("almuerzo");
    expect(api.listZoneOffers).not.toHaveBeenCalled();
  });
});

describe("a menu the person picked", () => {
  it("is kept through a poll and through signing in again", async () => {
    const { el } = await mountApp();
    await signIn(el);
    emit(counter(el), "menu-selected", { id: "desayunos" });
    await flush(el);

    api.menuState.mockResolvedValue(state([DESAYUNOS, ALMUERZO], "almuerzo"));
    await poll(el);
    expect(selected(el)).toBe("desayunos");

    await signInAgain(el);
    expect(selected(el)).toBe("desayunos");
    await poll(el);
    expect(selected(el)).toBe("desayunos");
  });
});

describe("the remembered default", () => {
  it("belongs to its zone, and is dropped when the counter leaves the zone", async () => {
    const { el } = await mountApp();
    await signIn(el);
    add(el, DESAYUNOS);
    await flush(el);
    const terraza: { defaultMenuId?: string } = {};
    api.menuState.mockImplementation(async (zoneId: string) =>
      zoneId === "zone-terraza"
        ? state([CENA, ALMUERZO, DESAYUNOS], terraza.defaultMenuId)
        : state([DESAYUNOS, ALMUERZO], "almuerzo"),
    );
    await poll(el);
    expect(selected(el)).toBe("desayunos");

    counter(el).store.removeLine(0);
    emit(counter(el), "counter-zone-selected", { zoneId: "zone-terraza" });
    await flush(el);
    expect(selected(el)).toBe("cena");
    add(el, CENA);
    await park(el);
    expect(counter(el).store.lineCount).toBe(0);
    expect(selected(el)).toBe("cena");

    add(el, CENA);
    terraza.defaultMenuId = "desayunos";
    await poll(el);
    expect(selected(el)).toBe("cena");
    await park(el);
    expect(selected(el)).toBe("desayunos");

    emit(counter(el), "counter-zone-selected", { zoneId: "zone-barra" });
    await flush(el);
    emit(counter(el), "counter-zone-selected", { zoneId: "zone-terraza" });
    await flush(el);
    expect(selected(el)).toBe("cena");
    add(el, CENA);
    await park(el);
    expect(selected(el)).toBe("cena");
  });

  it("is forgotten by signing out and in again before the basket is cleared", async () => {
    const { el } = await mountApp();
    await signIn(el);
    add(el, DESAYUNOS);
    await flush(el);
    api.menuState.mockResolvedValue(state([DESAYUNOS, ALMUERZO], "almuerzo"));
    await poll(el);
    expect(selected(el)).toBe("desayunos");

    await signInAgain(el);
    expect(counter(el).store.lineCount).toBe(1);
    expect(selected(el)).toBe("desayunos");
    await park(el);
    expect(counter(el).store.lineCount).toBe(0);
    expect(selected(el)).toBe("desayunos");

    add(el, DESAYUNOS);
    await poll(el);
    expect(selected(el)).toBe("desayunos");
    await park(el);
    expect(selected(el)).toBe("almuerzo");
  });
});

describe("the remembered default and the session", () => {
  it("is not applied by an offers reload that finishes after the sign-out", async () => {
    let reload!: (value: ZoneOfferCatalogue) => void;
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn(async () => offers("zone-barra", [DESAYUNOS], "desayunos")),
      listZoneOffers: vi.fn(() => new Promise<ZoneOfferCatalogue>((resolve) => (reload = resolve))),
    });
    await signIn(el);
    api.menuState.mockResolvedValue(state([DESAYUNOS, ALMUERZO], "almuerzo"));
    await poll(el);
    expect(api.listZoneOffers).toHaveBeenCalledWith("zone-barra");

    emit(counter(el), "logout");
    await flush(el);
    reload(BARRA);
    await flush(el);
    expect(sessionStorage.getItem("waitron.lastMenu")).toBe("desayunos");
  });

  it("is forgotten when the device switches profile, which signs in again without signing out", async () => {
    const identity = {
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
      stationId: null,
      receiptPrinterId: null,
      paymentSlipPrinterId: null,
      printerChoices: { receipt: [], paymentSlip: [] },
      profileId: "pr-counter",
      approvedProfiles: [
        { id: "pr-counter", name: "Counter till" },
        { id: "pr-bar", name: "Bar till" },
      ],
    };
    const { el } = await mountApp({
      getDeviceIdentity: vi.fn().mockResolvedValue(identity),
      switchDeviceProfile: vi.fn().mockResolvedValue({
        activeProfileId: "pr-bar",
        receiptPrinterId: null,
        paymentSlipPrinterId: null,
      }),
    });
    await signIn(el);
    add(el, DESAYUNOS);
    await flush(el);
    api.menuState.mockResolvedValue(state([DESAYUNOS, ALMUERZO], "almuerzo"));
    await poll(el);
    expect(selected(el)).toBe("desayunos");
    api.menuState.mockResolvedValue(state([DESAYUNOS, ALMUERZO]));

    counter(el).store.removeLine(0);
    el.shadowRoot!.querySelector("till-tab-shell")!
      .shadowRoot!.querySelector<HTMLElement>("wt-button.profile")!
      .click();
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-profile-dialog")!, "profile-switch", {
      profileId: "pr-bar",
    });
    await flush(el);
    await flush(el);
    expect(api.switchDeviceProfile).toHaveBeenCalledOnce();
    expect(selected(el)).toBe("desayunos");
    add(el, DESAYUNOS);
    await park(el);
    expect(counter(el).store.lineCount).toBe(0);
    expect(selected(el)).toBe("desayunos");
  });
});

describe("an open table's order", () => {
  const table = {
    id: "t2",
    label: "2",
    zoneId: "zone-comedor",
    capacity: 4,
    state: "open-tab",
    hasOpenTab: true,
    tabLineCount: 0,
    tabTotal: "0.00",
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    status: null,
    nextReservation: null,
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
    signals: [],
    party: {
      id: "party-a",
      revision: 1,
      guestCount: 2,
      state: "open" as const,
      mainBillId: "wo-7",
      outstanding: "0.00",
      billCount: 1,
      tableIds: ["t2"],
    },
  };
  const COMEDOR = offers("zone-comedor", [DESAYUNOS, ALMUERZO], "desayunos", "table_tab");
  const shellGrid = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>("till-card-grid")!;
  const tableScreen = (el: TillApp) =>
    shellGrid(el).shadowRoot!.querySelector<HTMLElement & { selectedMenuId: string }>(
      "till-table-order-screen",
    )!;

  it("names the table's department independently of the counter when it is closed", async () => {
    const closed = {
      ...COMEDOR,
      context: { ...COMEDOR.context, departmentId: "department-deli", departmentName: "Deli" },
      service: { open: false, periodName: null, keepOpen: null },
      menus: COMEDOR.menus.map((menu) => ({ ...menu, orderable: false })),
    };
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: tableCanvas }),
      listZoneOffers: vi.fn(async () => closed),
      getTablesState: vi.fn().mockResolvedValue([table]),
      listZones: vi
        .fn()
        .mockResolvedValue([
          { id: "zone-comedor", name: "Comedor", displayOrder: 0, active: true },
        ]),
      listStatuses: vi.fn().mockResolvedValue([]),
      getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0, editSentLines: true }),
      listDrafts: drafts.listDrafts,
      saveDraft: drafts.saveDraft,
      submitDraft: drafts.submitDraft,
    });
    await signIn(el);
    emit(el.shadowRoot!.querySelector("till-tab-shell")!, "tab-select", { key: "floor" });
    await flush(el);
    emit(shellGrid(el).shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
      tableId: "t2",
      seated: true,
    });
    await flush(el);
    expect(
      tableScreen(el).shadowRoot!.querySelector("[data-service-closed]")?.textContent?.trim(),
    ).toBe("Deli is closed: no period is running");
  });

  it("moves a table off an ended menu while retaining its draft and the counter's selection", async () => {
    const breakfast = {
      ...COMEDOR,
      service: { open: true, periodName: "Breakfast", keepOpen: null },
      menus: COMEDOR.menus.map((menu) => ({ ...menu, orderable: menu.id === "desayunos" })),
    };
    const lunch = {
      ...COMEDOR,
      service: { open: true, periodName: "Lunch", keepOpen: null },
      defaultMenuId: "almuerzo",
      menus: COMEDOR.menus.map((menu) => ({
        ...menu,
        orderable: menu.id === "almuerzo",
        isDefault: menu.id === "almuerzo",
      })),
    };
    let current = breakfast;
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: tableCanvas }),
      listZoneOffers: vi.fn(async (zoneId: string) =>
        zoneId === "zone-comedor" ? current : BARRA,
      ),
      getTablesState: vi.fn().mockResolvedValue([table]),
      listZones: vi
        .fn()
        .mockResolvedValue([
          { id: "zone-comedor", name: "Comedor", displayOrder: 0, active: true },
        ]),
      listStatuses: vi.fn().mockResolvedValue([]),
      getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0, editSentLines: true }),
      listDrafts: drafts.listDrafts,
      saveDraft: drafts.saveDraft,
      submitDraft: drafts.submitDraft,
      menuState: vi.fn(async (zoneId: string) =>
        zoneId === "zone-comedor"
          ? {
              ...state([DESAYUNOS, ALMUERZO], current.defaultMenuId ?? undefined),
              service: current.service,
            }
          : state([DESAYUNOS, ALMUERZO], "desayunos"),
      ),
    });
    await signIn(el);
    emit(el.shadowRoot!.querySelector("till-tab-shell")!, "tab-select", { key: "floor" });
    await flush(el);
    emit(shellGrid(el).shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
      tableId: "t2",
      seated: true,
    });
    await flush(el);
    const screen = tableScreen(el);
    const browser = screen.shadowRoot!.querySelector<
      HTMLElement & { store: import("./state/working-order.js").WorkingOrderStore }
    >("till-menu-browser")!;
    browser.store.addProduct({ ...menuOfferToTillProduct(offer(DESAYUNOS), "v1") }, "1");
    await flush(el);
    current = lunch;
    await poll(el);
    expect(tableScreen(el).selectedMenuId).toBe("almuerzo");
    expect(
      browser.store.lines.map((line) => [
        line.product.productId,
        line.quantity,
        line.product.unitPrice,
      ]),
    ).toEqual([["Tostada", "1", "3.00"]]);
    expect(
      tableScreen(el).shadowRoot!.querySelector("[data-service-period]")?.textContent?.trim(),
    ).toBe("Lunch");
    emit(el.shadowRoot!.querySelector("till-tab-shell")!, "tab-select", { key: "counter" });
    await flush(el);
    expect(selected(el)).toBe("desayunos");
  });

  it("end-offset table poll hides selection and retains sendable grace before expiry", async () => {
    const breakfast = {
      ...COMEDOR,
      service: { open: true, periodName: "Breakfast" },
      menus: COMEDOR.menus.map((menu) => ({ ...menu, orderable: menu.id === "desayunos" })),
    };
    const lunch = {
      ...breakfast,
      defaultMenuId: null,
      menus: COMEDOR.menus.map((menu) => ({
        ...menu,
        orderable: false,
        sendable: true,
        isDefault: false,
      })),
    };
    let current: ZoneOfferCatalogue = breakfast;
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: tableCanvas }),
      listZoneOffers: vi.fn(async (zoneId: string) =>
        zoneId === "zone-comedor" ? current : BARRA,
      ),
      getTablesState: vi.fn().mockResolvedValue([table]),
      listZones: vi
        .fn()
        .mockResolvedValue([
          { id: "zone-comedor", name: "Comedor", displayOrder: 0, active: true },
        ]),
      listStatuses: vi.fn().mockResolvedValue([]),
      getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0, editSentLines: true }),
      listDrafts: drafts.listDrafts,
      saveDraft: drafts.saveDraft,
      submitDraft: drafts.submitDraft,
      menuState: vi.fn(async (zoneId: string) =>
        zoneId === "zone-comedor"
          ? {
              ...state([DESAYUNOS, ALMUERZO], current.defaultMenuId ?? undefined),
              service: current.service,
              menus: current.menus.map((menu) => ({
                menuId: menu.id,
                versionId: menu.versionId,
                orderable: menu.orderable,
                sendable: menu.sendable,
              })),
            }
          : state([DESAYUNOS, ALMUERZO], "desayunos"),
      ),
    });
    await signIn(el);
    emit(el.shadowRoot!.querySelector("till-tab-shell")!, "tab-select", { key: "floor" });
    await flush(el);
    emit(shellGrid(el).shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
      tableId: "t2",
      seated: true,
    });
    await flush(el);
    const screen = tableScreen(el);
    const browser = screen.shadowRoot!.querySelector<
      HTMLElement & { store: import("./state/working-order.js").WorkingOrderStore }
    >("till-menu-browser")!;
    browser.store.addProduct({ ...menuOfferToTillProduct(offer(DESAYUNOS), "v1") }, "1");
    await flush(el);
    current = lunch;
    await poll(el);
    expect(tableScreen(el).shadowRoot!.querySelector("till-menu-browser")).toBeNull();
    expect(
      tableScreen(el).shadowRoot!.querySelector("[data-last-orders-ended]")?.textContent?.trim(),
    ).toBe("Last orders have ended");
    expect(browser.store.lines[0]?.blocked).toBeUndefined();
    browser.store.addProduct(menuOfferToTillProduct(offer(DESAYUNOS), "v1"), "1");
    browser.store.setLineQuantity(0, "2");
    expect(browser.store.lines.map((line) => [line.product.productId, line.quantity])).toEqual([
      ["Tostada", "1"],
    ]);
    current = { ...lunch, menus: lunch.menus.map((menu) => ({ ...menu, sendable: false })) };
    await poll(el);
    expect(browser.store.lines[0]?.blocked).toBe("period_ended");
    const sendButtons = tableScreen(el).shadowRoot!.querySelectorAll<
      HTMLElement & { disabled: boolean; variant: string }
    >("[data-draft-action]");
    expect(sendButtons).toHaveLength(2);
    for (const button of sendButtons) {
      expect(button.disabled).toBe(true);
      expect(button.variant).toBe("secondary");
    }
    emit(el.shadowRoot!.querySelector("till-tab-shell")!, "tab-select", { key: "counter" });
    await flush(el);
    expect(selected(el)).toBe("desayunos");
  });

  it("keeps the menu the table shows whatever the poll names for the table's zone", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: tableCanvas }),
      listZoneOffers: vi.fn(async (zoneId: string) =>
        zoneId === "zone-comedor" ? COMEDOR : BARRA,
      ),
      getTablesState: vi.fn().mockResolvedValue([table]),
      listZones: vi
        .fn()
        .mockResolvedValue([
          { id: "zone-comedor", name: "Comedor", displayOrder: 0, active: true },
        ]),
      listStatuses: vi.fn().mockResolvedValue([]),
      getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0, editSentLines: true }),
      listDrafts: drafts.listDrafts,
      saveDraft: drafts.saveDraft,
      submitDraft: drafts.submitDraft,
      // Both zones name a default other than the table's menu, so a counter that follows its own
      // default cannot leave the table on Desayunos by coincidence.
      menuState: vi.fn(async () => state([DESAYUNOS, ALMUERZO], "almuerzo")),
    });
    await signIn(el);
    emit(el.shadowRoot!.querySelector("till-tab-shell")!, "tab-select", { key: "floor" });
    await flush(el);
    emit(shellGrid(el).shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
      tableId: "t2",
      seated: true,
    });
    await flush(el);
    expect(tableScreen(el).selectedMenuId).toBe("desayunos");

    await poll(el);
    expect(api.menuState.mock.calls.map((call) => call[0])).toContain("zone-comedor");
    expect(tableScreen(el).selectedMenuId).toBe("desayunos");
  });
});
