import { page, userEvent } from "vitest/browser";
import { applyTokens, currentContentLanguages } from "@waitron/ui";
import type { ContentLanguages } from "@waitron/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
  servedMenus,
} from "./widgets/test-helpers.js";
import indexHtml from "../index.html?raw";
import { productUnit } from "./widgets/product-name.js";
import { TillApp } from "./till-app.js";
import { ServerRouter } from "./api/server-router.js";
import { setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import { DEV_DEVICE_STORAGE_KEY } from "./api/dev-device.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillCardGrid } from "./widgets/card-grid.js";
import type { TillTicketView } from "./screens/till-ticket-view.js";
import type { CanvasDef, CapabilityFlag } from "./layout.js";
import type {
  KitchenScreenKind,
  ProductCatalogue,
  ResolvedKitchenScreen,
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

function kitchenScreen(kind: KitchenScreenKind, available = true): ResolvedKitchenScreen {
  return { kind, available, stations: [], zones: null };
}

const till = {
  locale: "es-ES",
  invoiceLocale: "es-ES",
  venueName: "Bar Pepe",
  nif: "B12345678",
  orderFlow: "prepay" as const,
  bumpMode: "line" as const,
  fireControl: "waiter" as const,
  courses: [] as { id: string; name: string; displayOrder: number }[],
  cardProvider: "none" as const,
  tipsEnabled: false,
  canvas: tillCanvas,
  capabilities: ["print-receipt", "show-station", "show-expo", "show-schedule"] as CapabilityFlag[],
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
  const body: ZoneOfferCatalogue = {
    service: { open: true, zoneOpen: true, periodName: null, keepOpen: null, zoneKeepOpen: null },
    context: {
      departmentName: "Restaurant",
      zoneId,
      departmentId: "department-default",
      serviceMode,
    },
    defaultMenuId,
    // No `versionId`: a line added from these offers asserts no version, so the wire bodies the
    // suites pin are the ones a till sends against the live version.
    menus: [],
    offers: catalogue.products.map((product, index): ZoneOfferCatalogue["offers"][number] => ({
      id: product.menuItemId ?? `menu-item-${product.id}-${index}`,
      menuId: product.catalogueId ?? "menu-fixture",
      productId: product.productId ?? product.id,
      grossPrice: product.unitPrice,
      unitPrice: product.unitPrice,
      available: true,
      image: null,
      description: null,
      menuName: product.catalogueName ?? "Menu",
      placements: [[]],
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
  body.menus = servedMenus(catalogue.menus, body.offers) as ZoneOfferCatalogue["menus"];
  return body;
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
    }),
    getDeviceStationScreen: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    listStaff: vi.fn().mockResolvedValue([]),
    listDefaultZoneOffers: vi
      .fn()
      .mockResolvedValue(zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter")),
    listZoneOffers: vi.fn(),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    getExpoQueue: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    listStatuses: vi.fn().mockResolvedValue([]),
    recordSale: vi.fn().mockResolvedValue(saleResult),
    pay: vi.fn().mockResolvedValue({ outcome: "captured", ticket: saleResult }),
    retrieveWorkingOrder: vi.fn(),
    listSentDepartmentTransfers: vi.fn().mockResolvedValue({ requests: [] }),
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
  emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
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
  localStorage.removeItem("waitron.makeNow.till-dev");
  sessionStorage.removeItem("waitron.lastMenu");
  sessionStorage.removeItem("waitron.dietFilter");
  history.replaceState(null, "", initialUrl);
});

describe("till-app session activity", () => {
  it.each([
    [["act-as-kds", "run-the-pass"], true],
    [["act-as-kds"], false],
  ] as const)(
    "opens an enrolled pass screen without asking for a station (%j)",
    async (capabilities, runsPass) => {
      const board = { orders: [], stations: [], zones: null };
      const getDeviceStationScreen = vi.fn().mockRejectedValue({ code: "device.unauthorized" });
      const getDevicePassScreen = vi.fn().mockResolvedValue(board);
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: kdsCanvas, capabilities }),
        getDeviceIdentity: vi.fn().mockResolvedValue({
          deviceId: "pass-device",
          name: "Pantalla Pase",
          formFactor: "kds",
          kitchenScreens: [kitchenScreen("pass")],
        }),
        getDeviceStationScreen,
        getDevicePassScreen,
      });
      await flush(el);
      const screen = el.shadowRoot!.querySelector("till-card-grid")!.shadowRoot!.querySelector<
        HTMLElement & {
          deviceMode: boolean;
          initialDevicePass: unknown;
          runsPass: boolean;
          deviceName?: string;
        }
      >("till-expo-screen");
      expect(screen).not.toBeNull();
      expect(screen!.deviceMode).toBe(true);
      expect(screen!.initialDevicePass).toBe(board);
      expect(screen!.runsPass).toBe(runsPass);
      expect(screen!.deviceName).toBe("Pantalla Pase");
      expect(getDevicePassScreen).toHaveBeenCalledTimes(1);
      expect(getDeviceStationScreen).not.toHaveBeenCalled();
    },
  );

  it("keeps an enrolled station screen on its station board", async () => {
    const getDeviceStationScreen = vi.fn().mockResolvedValue({
      stations: [
        {
          name: "Cocina",
          available: true,
          today: {
            open: true,
            isDefault: true,
            byHand: null,
            sendsTo: null,
            why: "default" as const,
          },
          id: "st-1",
          queue: [],
          notices: [],
          printersDown: [],
        },
      ],
    });
    const getDevicePassScreen = vi.fn().mockRejectedValue({ code: "device.unauthorized" });
    const { el } = await mountApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, canvas: kdsCanvas, capabilities: ["act-as-kds"] }),
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "station-device",
        name: "Grill",
        formFactor: "kds",
        kitchenScreens: [kitchenScreen("station")],
      }),
      getDeviceStationScreen,
      getDevicePassScreen,
    });
    await flush(el);
    expect(
      el
        .shadowRoot!.querySelector("till-card-grid")!
        .shadowRoot!.querySelector("till-station-screen"),
    ).not.toBeNull();
    expect(getDeviceStationScreen).toHaveBeenCalledTimes(1);
    expect(getDevicePassScreen).not.toHaveBeenCalled();
  });

  it.each([
    [["act-as-kds", "take-orders"], true],
    [["act-as-kds"], false],
  ] as const)(
    "lets an enrolled station screen offer Move to station only with Take orders (%j)",
    async (capabilities, canMoveStation) => {
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: kdsCanvas, capabilities }),
        getDeviceIdentity: vi.fn().mockResolvedValue({
          deviceId: "station-device",
          name: "Grill",
          formFactor: "kds",
          kitchenScreens: [kitchenScreen("station")],
        }),
        getDeviceStationScreen: vi.fn().mockResolvedValue({ stations: [] }),
      });
      await flush(el);
      const screen = el
        .shadowRoot!.querySelector("till-card-grid")!
        .shadowRoot!.querySelector<HTMLElement & { canMoveStation: boolean }>(
          "till-station-screen",
        )!;
      expect(screen.canMoveStation).toBe(canMoveStation);
    },
  );

  it("hands an enrolled station screen its device id, which keys its remembered view", async () => {
    const { el } = await mountApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, canvas: kdsCanvas, capabilities: ["act-as-kds"] }),
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "station-device",
        name: "Grill",
        formFactor: "kds",
        kitchenScreens: [kitchenScreen("station")],
      }),
      getDeviceStationScreen: vi.fn().mockResolvedValue({
        stations: [
          {
            name: "Cocina",
            available: true,
            today: {
              open: true,
              isDefault: false,
              byHand: null,
              sendsTo: null,
              why: "open" as const,
            },
            id: "st-1",
            queue: [],
            notices: [],
            printersDown: [],
          },
        ],
      }),
    });
    await flush(el);
    const screen = el
      .shadowRoot!.querySelector("till-card-grid")!
      .shadowRoot!.querySelector<HTMLElement & { deviceId?: string }>("till-station-screen")!;
    expect(screen.deviceId).toBe("station-device");
  });

  it("replaces a pass screen when the device is given a station screen", async () => {
    const getDeviceIdentity = vi
      .fn()
      .mockResolvedValueOnce({
        deviceId: "watcher-device",
        name: "Pass",
        formFactor: "kds",
        kitchenScreens: [kitchenScreen("pass")],
      })
      .mockResolvedValueOnce({
        deviceId: "station-device",
        name: "Grill",
        formFactor: "kds",
        kitchenScreens: [kitchenScreen("station")],
      });
    const { el } = await mountApp({
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, canvas: kdsCanvas, capabilities: ["act-as-kds"] }),
      getDeviceIdentity,
      getDevicePassScreen: vi.fn().mockResolvedValue({ orders: [], stations: [], zones: null }),
      getDeviceStationScreen: vi.fn().mockResolvedValue({
        stations: [
          {
            name: "Cocina",
            available: true,
            today: {
              open: true,
              isDefault: false,
              byHand: null,
              sendsTo: null,
              why: "open" as const,
            },
            id: "st-1",
            queue: [],
            notices: [],
            printersDown: [],
          },
        ],
      }),
    });
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-card-grid")!, "enrolled");
    await flush(el);
    expect(getDeviceIdentity).toHaveBeenCalledTimes(2);
    const grid = el.shadowRoot!.querySelector("till-card-grid")!;
    expect(grid.shadowRoot!.querySelector("till-station-screen")).not.toBeNull();
    expect(grid.shadowRoot!.querySelector("till-expo-screen")).toBeNull();
  });

  it.each(["pass", "pass_monitor"] as const)(
    "a refused %s re-boots to the line saying a narrowing took it",
    async (kind) => {
      setLocale("en-GB");
      const board = { orders: [], stations: [], zones: null };
      const getDeviceIdentity = vi
        .fn()
        .mockResolvedValueOnce({
          deviceId: "kd-1",
          name: "Pantalla Pase",
          formFactor: "kds",
          kitchenScreens: [kitchenScreen(kind)],
        })
        .mockResolvedValue({
          deviceId: "kd-1",
          name: "Pantalla Pase",
          formFactor: "kds",
          kitchenScreens: [kitchenScreen(kind, false)],
        });
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          locale: "en-GB",
          canvas: kdsCanvas,
          capabilities: ["act-as-kds"],
        }),
        getDeviceIdentity,
        getDevicePassScreen: vi.fn().mockResolvedValue(board),
        getDevicePassMonitor: vi.fn().mockResolvedValue(board),
      });
      await flush(el);
      const grid = () => el.shadowRoot!.querySelector("till-card-grid")!.shadowRoot!;
      emit(grid().querySelector("till-expo-screen")!, "device-unauthorized");
      await flush(el);
      expect(getDeviceIdentity).toHaveBeenCalledTimes(2);
      expect(grid().querySelector("till-expo-screen")).toBeNull();
      expect(grid().querySelector(".kitchen-screen-message")?.textContent?.trim()).toBe(
        `This screen is no longer available: ${kind === "pass" ? "Pass screen" : "Pass monitor"}`,
      );
    },
  );

  it("re-boots from the line to the pass screen when its notice says the choice changed", async () => {
    const board = { orders: [], stations: [], zones: null };
    const passIdentity = (available: boolean) => ({
      deviceId: "kd-1",
      name: "Pantalla Pase",
      formFactor: "kds",
      kitchenScreens: [kitchenScreen("pass", available)],
    });
    const getDeviceIdentity = vi
      .fn()
      .mockResolvedValueOnce(passIdentity(false))
      .mockResolvedValue(passIdentity(true));
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        locale: "en-GB",
        canvas: kdsCanvas,
        capabilities: ["act-as-kds"],
      }),
      getDeviceIdentity,
      getDevicePassScreen: vi.fn().mockResolvedValue(board),
    });
    await flush(el);
    const grid = () => el.shadowRoot!.querySelector("till-card-grid")!.shadowRoot!;
    emit(grid().querySelector("till-kitchen-screen-notice")!, "kitchen-screen-changed");
    await flush(el);
    expect(getDeviceIdentity).toHaveBeenCalledTimes(2);
    expect(grid().querySelector(".kitchen-screen-message")).toBeNull();
    expect(grid().querySelector("till-expo-screen")).not.toBeNull();
  });

  it.each(["answers", "fails"] as const)(
    "a re-boot overtaken by a newer one, whose till read %s last, changes nothing",
    async (outcome) => {
      const board = { orders: [], stations: [], zones: null };
      const kds = { ...till, locale: "en-GB", canvas: kdsCanvas, capabilities: ["act-as-kds"] };
      const passIdentity = (available: boolean) => ({
        deviceId: "kd-1",
        name: "Pantalla Pase",
        formFactor: "kds",
        kitchenScreens: [kitchenScreen("pass", available)],
      });
      let settleOlder!: () => void;
      const getTill = vi
        .fn()
        .mockResolvedValueOnce(kds)
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              settleOlder = () =>
                outcome === "answers" ? resolve(kds) : reject({ code: "server.internal" });
            }),
        )
        .mockResolvedValue(kds);
      const getDeviceIdentity = vi
        .fn()
        .mockResolvedValueOnce(passIdentity(false))
        .mockResolvedValueOnce(passIdentity(true))
        .mockResolvedValue(passIdentity(false));
      const { el } = await mountApp({
        getTill,
        getDeviceIdentity,
        getDevicePassScreen: vi.fn().mockResolvedValue(board),
      });
      await flush(el);
      const grid = () => el.shadowRoot!.querySelector("till-card-grid")!.shadowRoot!;
      const notice = () => grid().querySelector("till-kitchen-screen-notice")!;
      emit(notice(), "kitchen-screen-changed"); // its till read waits
      await flush(el);
      emit(notice(), "kitchen-screen-changed"); // the newer re-boot reads the pass
      await flush(el);
      expect(grid().querySelector("till-expo-screen")).not.toBeNull();
      settleOlder();
      await flush(el);
      await flush(el);
      expect(getTill).toHaveBeenCalledTimes(3);
      expect(getDeviceIdentity).toHaveBeenCalledTimes(2);
      expect(grid().querySelector("till-expo-screen")).not.toBeNull();
      expect(grid().querySelector(".kitchen-screen-message")).toBeNull();
      expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    },
  );

  it.each(["identity", "pass board"] as const)(
    "a re-boot overtaken by a newer one, whose %s read answers last, changes nothing",
    async (last) => {
      const board = { orders: [], stations: [], zones: null };
      const passIdentity = (available: boolean) => ({
        deviceId: "kd-1",
        name: "Pantalla Pase",
        formFactor: "kds",
        kitchenScreens: [kitchenScreen("pass", available)],
      });
      let answerOlder!: () => void;
      const waitForOlder = <T>(value: T) =>
        new Promise<T>((resolve) => (answerOlder = () => resolve(value)));
      // Mount shows the line; the older re-boot is given the pass, the newer one the line again.
      const getDeviceIdentity = vi.fn().mockResolvedValueOnce(passIdentity(false));
      if (last === "identity")
        getDeviceIdentity.mockImplementationOnce(() => waitForOlder(passIdentity(true)));
      else getDeviceIdentity.mockResolvedValueOnce(passIdentity(true));
      getDeviceIdentity.mockResolvedValue(passIdentity(false));
      const getDevicePassScreen =
        last === "pass board" ? vi.fn(() => waitForOlder(board)) : vi.fn().mockResolvedValue(board);
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          locale: "en-GB",
          canvas: kdsCanvas,
          capabilities: ["act-as-kds"],
        }),
        getDeviceIdentity,
        getDevicePassScreen,
      });
      await flush(el);
      const grid = () => el.shadowRoot!.querySelector("till-card-grid")?.shadowRoot;
      emit(grid()!.querySelector("till-kitchen-screen-notice")!, "kitchen-screen-changed");
      await flush(el);
      emit(lock(el)!, "device-unauthorized"); // the newer re-boot, from the lock screen shown meanwhile
      await flush(el);
      expect(grid()!.querySelector(".kitchen-screen-message")).not.toBeNull();
      answerOlder();
      await flush(el);
      await flush(el);
      expect(getDeviceIdentity).toHaveBeenCalledTimes(3);
      expect(getDevicePassScreen).toHaveBeenCalledTimes(last === "identity" ? 0 : 1);
      expect(
        el.shadowRoot!.querySelector<TillCardGrid>("till-card-grid")!.initialDevicePass,
      ).toBeUndefined();
      expect(grid()!.querySelector("till-expo-screen")).toBeNull();
      expect(grid()!.querySelector(".kitchen-screen-message")).not.toBeNull();
    },
  );

  describe("a narrowing between the boot's identity read and its screen read", () => {
    const passIdentity = (available = true) => ({
      deviceId: "kd-1",
      name: "Pantalla Pase",
      formFactor: "kds",
      kitchenScreens: [kitchenScreen("pass", available)],
    });
    const mountRaced = (overrides: Record<string, unknown>) =>
      mountApp({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          locale: "en-GB",
          canvas: kdsCanvas,
          capabilities: ["act-as-kds"],
        }),
        ...overrides,
      });
    const grid = (el: TillApp) => el.shadowRoot!.querySelector("till-card-grid")?.shadowRoot;

    it("reads the identity again and shows the line instead of the join screen", async () => {
      setLocale("en-GB");
      const getDeviceIdentity = vi
        .fn()
        .mockResolvedValueOnce(passIdentity())
        .mockResolvedValue(passIdentity(false));
      const getDevicePassScreen = vi.fn().mockRejectedValue({ code: "device.unauthorized" });
      const { el } = await mountRaced({ getDeviceIdentity, getDevicePassScreen });
      await flush(el);
      expect(getDeviceIdentity).toHaveBeenCalledTimes(2);
      expect(getDevicePassScreen).toHaveBeenCalledTimes(1);
      expect(el.shadowRoot!.querySelector("till-enrol-screen")).toBeNull();
      expect(grid(el)!.querySelector(".kitchen-screen-message")?.textContent?.trim()).toBe(
        "This screen is no longer available: Pass screen",
      );
    });

    it("opens the screen the identity now names", async () => {
      const getDeviceIdentity = vi
        .fn()
        .mockResolvedValueOnce(passIdentity())
        .mockResolvedValue({ ...passIdentity(), kitchenScreens: [kitchenScreen("station")] });
      const getDeviceStationScreen = vi.fn().mockResolvedValue({
        stations: [
          {
            name: "Cocina",
            available: true,
            today: {
              open: true,
              isDefault: false,
              byHand: null,
              sendsTo: null,
              why: "open" as const,
            },
            id: "st-1",
            queue: [],
            notices: [],
            printersDown: [],
          },
        ],
      });
      const { el } = await mountRaced({
        getDeviceIdentity,
        getDevicePassScreen: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
        getDeviceStationScreen,
      });
      await flush(el);
      expect(el.shadowRoot!.querySelector("till-enrol-screen")).toBeNull();
      expect(grid(el)!.querySelector("till-station-screen")).not.toBeNull();
      expect(getDeviceStationScreen).toHaveBeenCalledTimes(1);
    });

    it("goes to the join screen when the screen read is refused a second time", async () => {
      const getDeviceIdentity = vi.fn().mockResolvedValue(passIdentity());
      const getDevicePassScreen = vi.fn().mockRejectedValue({ code: "device.unauthorized" });
      const { el } = await mountRaced({ getDeviceIdentity, getDevicePassScreen });
      await flush(el);
      expect(getDeviceIdentity).toHaveBeenCalledTimes(2);
      expect(getDevicePassScreen).toHaveBeenCalledTimes(2);
      expect(el.shadowRoot!.querySelector("till-enrol-screen")).not.toBeNull();
    });

    it("goes to the join screen when the second identity read is refused", async () => {
      const getDeviceIdentity = vi
        .fn()
        .mockResolvedValueOnce(passIdentity())
        .mockRejectedValue({ code: "device.unauthorized" });
      const { el } = await mountRaced({
        getDeviceIdentity,
        getDevicePassScreen: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
      });
      await flush(el);
      expect(getDeviceIdentity).toHaveBeenCalledTimes(2);
      expect(el.shadowRoot!.querySelector("till-enrol-screen")).not.toBeNull();
    });

    it("reads the identity once when the screen read fails for another reason", async () => {
      const getDeviceIdentity = vi.fn().mockResolvedValue(passIdentity());
      const { el } = await mountRaced({
        getDeviceIdentity,
        getDevicePassScreen: vi.fn().mockRejectedValue({ code: "server.internal" }),
      });
      await flush(el);
      expect(getDeviceIdentity).toHaveBeenCalledTimes(1);
      expect(el.shadowRoot!.querySelector("till-enrol-screen")).toBeNull();
    });
  });

  describe("a pass monitor", () => {
    const board = {
      orders: [],
      stations: [{ id: "st-1", name: "Parrilla", available: false }],
      zones: null,
    };
    const mountMonitor = async (theme?: "light" | "dark") => {
      const getDeviceStationScreen = vi.fn();
      const getDevicePassScreen = vi.fn();
      const getDevicePassMonitor = vi.fn().mockResolvedValue(board);
      api = stubApi({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          canvas: kdsCanvas,
          capabilities: ["act-as-kds", "run-the-pass"],
        }),
        getDeviceIdentity: vi.fn().mockResolvedValue({
          deviceId: "kd-1",
          name: "Pared del pase",
          formFactor: "kds",
          kitchenScreens: [kitchenScreen("pass_monitor")],
        }),
        getDeviceStationScreen,
        getDevicePassScreen,
        getDevicePassMonitor,
      });
      const { el, host } = await mountWidget<TillApp>("till-app", { api }, theme);
      await flush(el);
      return { el, host, getDeviceStationScreen, getDevicePassScreen, getDevicePassMonitor };
    };
    type MonitorScreen = HTMLElement & {
      monitor: boolean;
      deviceMode: boolean;
      deviceName?: string;
      initialDevicePassMonitor: unknown;
    };
    const monitor = (el: TillApp) =>
      el
        .shadowRoot!.querySelector("till-card-grid")!
        .shadowRoot!.querySelector<MonitorScreen>("till-expo-screen");

    it("boots straight into the monitor, read once from the pass monitor route", async () => {
      const { el, getDeviceStationScreen, getDevicePassScreen, getDevicePassMonitor } =
        await mountMonitor();
      expect(lock(el)).toBeNull();
      const screen = monitor(el);
      expect(screen).not.toBeNull();
      expect(screen!.monitor).toBe(true);
      expect(screen!.deviceMode).toBe(true);
      expect(screen!.deviceName).toBe("Pared del pase");
      expect(screen!.initialDevicePassMonitor).toBe(board);
      expect(screen!.shadowRoot!.querySelector("[data-unavailable]")).not.toBeNull();
      const grid = el.shadowRoot!.querySelector("till-card-grid")!.shadowRoot!;
      expect(grid.querySelector(".kitchen-screen-message")).toBeNull();
      expect(grid.querySelector("till-station-screen")).toBeNull();
      expect(getDevicePassMonitor).toHaveBeenCalledTimes(1);
      expect(getDeviceStationScreen).not.toHaveBeenCalled();
      expect(getDevicePassScreen).not.toHaveBeenCalled();
    });

    it("leaves the monitor when the device is given a station screen", async () => {
      const { el } = await mountMonitor();
      vi.mocked(api.getDeviceIdentity).mockResolvedValue({
        deviceId: "kd-1",
        name: "Grill",
        formFactor: "kds",
        kitchenScreens: [kitchenScreen("station")],
      });
      vi.mocked(api.getDeviceStationScreen).mockResolvedValue({
        stations: [
          {
            name: "Cocina",
            available: true,
            today: {
              open: true,
              isDefault: false,
              byHand: null,
              sendsTo: null,
              why: "open" as const,
            },
            id: "st-1",
            queue: [],
            notices: [],
            printersDown: [],
          },
        ],
      });
      emit(el.shadowRoot!.querySelector("till-card-grid")!, "enrolled");
      await flush(el);
      const grid = el.shadowRoot!.querySelector("till-card-grid")!.shadowRoot!;
      expect(grid.querySelector("till-station-screen")).not.toBeNull();
      expect(grid.querySelector("till-expo-screen")).toBeNull();
    });

    it.each(["light", "dark"] as const)("has no axe violations in the %s theme", async (theme) => {
      const { el, host } = await mountMonitor(theme);
      expect(monitor(el)).not.toBeNull();
      await expectNoA11yViolations(host);
    });
  });

  describe.each([
    {
      name: "a kitchen display with no kitchen screen says so",
      kitchenScreens: [],
      en: "This screen has nothing to show yet. Ask a manager to choose a screen for it in Devices.",
      es: "Esta pantalla aún no tiene nada que mostrar. Pide a un responsable que le elija una pantalla en Dispositivos.",
      guidance: { en: null, es: null },
    },
    {
      name: "a kitchen display whose kind a narrowing removed names it",
      kitchenScreens: [kitchenScreen("pass", false)],
      en: "This screen is no longer available: Pass screen",
      es: "Esta pantalla ya no está disponible: Pantalla de pase",
      guidance: {
        en: "Ask a manager to choose its screens again in Devices.",
        es: "Pide a un responsable que vuelva a elegir sus pantallas en Dispositivos.",
      },
    },
  ])("$name", ({ kitchenScreens, en, es, guidance }) => {
    const mountKitchenDisplay = async (locale: string, theme?: "light" | "dark") => {
      const getDeviceStationScreen = vi.fn();
      const getDevicePassScreen = vi.fn();
      api = stubApi({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          locale,
          canvas: kdsCanvas,
          capabilities: ["act-as-kds"],
        }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "kd-1", name: "Wall", formFactor: "kds", kitchenScreens }),
        getDeviceStationScreen,
        getDevicePassScreen,
      });
      const { el, host } = await mountWidget<TillApp>("till-app", { api }, theme);
      await flush(el);
      return { el, host, getDeviceStationScreen, getDevicePassScreen };
    };
    const grid = (el: TillApp) => el.shadowRoot!.querySelector("till-card-grid")!.shadowRoot!;

    it.each([
      ["en-GB", en, guidance.en],
      ["es-ES", es, guidance.es],
    ])("in %s, with no queue", async (locale, text, chooseAgain) => {
      const { el, getDeviceStationScreen, getDevicePassScreen } = await mountKitchenDisplay(locale);
      expect(lock(el)).toBeNull();
      expect(grid(el).querySelector(".kitchen-screen-message")?.textContent?.trim()).toBe(text);
      expect(grid(el).querySelector("[data-choose-again]")?.textContent?.trim() ?? null).toBe(
        chooseAgain,
      );
      expect(grid(el).querySelector("till-station-screen")).toBeNull();
      expect(grid(el).querySelector("till-expo-screen")).toBeNull();
      expect(getDeviceStationScreen).not.toHaveBeenCalled();
      expect(getDevicePassScreen).not.toHaveBeenCalled();
    });

    it.each(["light", "dark"] as const)("has no axe violations in the %s theme", async (theme) => {
      const { el, host } = await mountKitchenDisplay("es-ES", theme);
      expect(grid(el).querySelector(".kitchen-screen-message")).not.toBeNull();
      await expectNoA11yViolations(host);
    });
  });

  it("keeps a made-here instruction through navigation and restores it for the same device", async () => {
    setLocale("en-GB");
    localStorage.removeItem("waitron.makeNow.till-dev");
    let receive: ((items: unknown[]) => void) | undefined;
    const { el } = await mountApp({
      onMadeHere: vi.fn((listener) => {
        receive = listener;
      }),
    });
    await flush(el);
    const made = {
      lineId: "lager-1",
      name: "Lager",
      quantity: "2.000",
      unitName: null,
      soldInEach: true,
      optionSnapshots: [],
      extras: [],
      note: null,
    };
    receive!([made, made]);
    await flush(el);
    expect(
      el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.querySelectorAll("li"),
    ).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent).toContain(
      "2× Lager",
    );
    await toCounter(el);
    expect(el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent).toContain(
      "2× Lager",
    );
    expect(localStorage.getItem("waitron.makeNow.till-dev")).toContain("lager-1");
    el.remove();
    const reloaded = await mountApp();
    await flush(reloaded.el);
    expect(
      reloaded.el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent,
    ).toContain("2× Lager");
    reloaded.el
      .shadowRoot!.querySelector("till-make-now")!
      .shadowRoot!.querySelector("button")!
      .click();
    await flush(reloaded.el);
    expect(localStorage.getItem("waitron.makeNow.till-dev")).toBeNull();
    expect(
      reloaded.el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent,
    ).not.toContain("2× Lager");
  });

  it("does not restore another device's instructions", async () => {
    localStorage.setItem(
      "waitron.makeNow.other-device",
      JSON.stringify([
        {
          lineId: "other",
          name: "Other drink",
          quantity: "1.000",
          unitName: null,
          soldInEach: true,
          optionSnapshots: [],
          extras: [],
          note: null,
        },
      ]),
    );
    const { el } = await mountApp();
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent).not.toContain(
      "Other drink",
    );
    localStorage.removeItem("waitron.makeNow.other-device");
  });

  it("clears old instructions on a same-app device switch and restores them on return", async () => {
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "till-dev");
    const identity = vi.fn(async () => ({
      deviceId: sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY),
      name: "Device",
      formFactor: "till",
    }));
    let receive: ((items: unknown[]) => void) | undefined;
    const { el } = await mountApp({
      getDeviceIdentity: identity,
      getDevDevices: vi.fn().mockResolvedValue({ devices: [] }),
      onMadeHere: vi.fn((listener) => {
        receive = listener;
      }),
    });
    await flush(el);
    receive!([
      {
        lineId: "old-line",
        name: "Old drink",
        quantity: "1.000",
        unitName: null,
        soldInEach: true,
        optionSnapshots: [],
        extras: [],
        note: null,
      },
    ]);
    await flush(el);
    const widget = el.shadowRoot!.querySelector("till-make-now")!;
    expect(widget.shadowRoot!.textContent).toContain("Old drink");
    emit(el.shadowRoot!.querySelector(".app")!, "switch-device");
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-device-chooser")).not.toBeNull();
    expect(widget.shadowRoot!.textContent).not.toContain("Old drink");
    expect(localStorage.getItem("waitron.makeNow.till-dev")).toContain("old-line");
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "other-device");
    emit(el.shadowRoot!.querySelector(".app")!, "enrolled");
    await flush(el);
    expect(widget.shadowRoot!.textContent).not.toContain("Old drink");
    emit(el.shadowRoot!.querySelector(".app")!, "switch-device");
    await flush(el);
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "till-dev");
    emit(el.shadowRoot!.querySelector(".app")!, "enrolled");
    await flush(el);
    expect(widget.shadowRoot!.textContent).toContain("Old drink");
  });

  it("clears old instructions on a same-app switch when localStorage access throws", async () => {
    sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "till-dev");
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    try {
      let receive: ((items: unknown[]) => void) | undefined;
      const { el } = await mountApp({
        getDevDevices: vi.fn().mockResolvedValue({ devices: [] }),
        getDeviceIdentity: vi.fn(async () => ({
          deviceId: sessionStorage.getItem(DEV_DEVICE_STORAGE_KEY),
          name: "Device",
          formFactor: "till",
        })),
        onMadeHere: vi.fn((listener) => {
          receive = listener;
        }),
      });
      await flush(el);
      receive!([
        {
          lineId: "old-line",
          name: "Old drink",
          quantity: "1.000",
          unitName: null,
          soldInEach: true,
          optionSnapshots: [],
          extras: [],
          note: null,
        },
      ]);
      await flush(el);
      const widget = el.shadowRoot!.querySelector("till-make-now")!;
      expect(widget.shadowRoot!.textContent).toContain("Old drink");
      emit(el.shadowRoot!.querySelector(".app")!, "switch-device");
      await flush(el);
      expect(widget.shadowRoot!.textContent).not.toContain("Old drink");
      sessionStorage.setItem(DEV_DEVICE_STORAGE_KEY, "other-device");
      emit(el.shadowRoot!.querySelector(".app")!, "enrolled");
      await flush(el);
      expect(widget.shadowRoot!.textContent).not.toContain("Old drink");
    } finally {
      if (previous !== undefined) Object.defineProperty(globalThis, "localStorage", previous);
    }
  });

  it("ignores a stored value that is not an item list", async () => {
    localStorage.setItem("waitron.makeNow.till-dev", "{}");
    let receive: ((items: unknown[]) => void) | undefined;
    const { el } = await mountApp({
      onMadeHere: vi.fn((listener) => {
        receive = listener;
      }),
    });
    await flush(el);
    receive!([
      {
        lineId: "fresh",
        name: "Lager",
        quantity: "1.000",
        unitName: null,
        soldInEach: true,
        optionSnapshots: [],
        extras: [],
        note: null,
      },
    ]);
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent).toContain(
      "Lager",
    );
  });

  it("drops a stored item with malformed option snapshots before rendering", async () => {
    localStorage.setItem(
      "waitron.makeNow.till-dev",
      JSON.stringify([
        {
          lineId: "bad",
          name: "Lager",
          quantity: "1.000",
          unitName: null,
          soldInEach: true,
          optionSnapshots: [{}],
          extras: [],
          note: null,
        },
        {
          lineId: "good",
          name: "Coffee",
          quantity: "1.000",
          unitName: null,
          soldInEach: true,
          optionSnapshots: [
            {
              listName: { es: "Tamaño" },
              listCustomerName: null,
              listKitchenName: null,
              labelName: { es: "Grande" },
              labelCustomerName: null,
              labelKitchenName: null,
            },
          ],
          extras: [],
          note: null,
        },
      ]),
    );
    const { el } = await mountApp();
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent).not.toContain(
      "Lager",
    );
    expect(el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent).toContain(
      "Tamaño: Grande",
    );
  });

  it("keeps Done usable when site data methods throw", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      let receive: ((items: unknown[]) => void) | undefined;
      const { el } = await mountApp({
        onMadeHere: vi.fn((listener) => {
          receive = listener;
        }),
      });
      await flush(el);
      receive!([
        {
          lineId: "lager",
          name: "Lager",
          quantity: "1.000",
          unitName: null,
          soldInEach: true,
          optionSnapshots: [],
          extras: [],
          note: null,
        },
      ]);
      await flush(el);
      const widget = el.shadowRoot!.querySelector("till-make-now")!;
      expect(widget.shadowRoot!.textContent).toContain("Lager");
      widget.shadowRoot!.querySelector("button")!.click();
      await flush(el);
      expect(widget.shadowRoot!.textContent).not.toContain("Lager");
    } finally {
      get.mockRestore();
      set.mockRestore();
      remove.mockRestore();
    }
  });

  it("keeps the instruction when the localStorage global itself throws", async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    try {
      let receive: ((items: unknown[]) => void) | undefined;
      const { el } = await mountApp({
        onMadeHere: vi.fn((listener) => {
          receive = listener;
        }),
      });
      await flush(el);
      receive!([
        {
          lineId: "lager",
          name: "Lager",
          quantity: "1.000",
          unitName: null,
          soldInEach: true,
          optionSnapshots: [],
          extras: [],
          note: null,
        },
      ]);
      await flush(el);
      const widget = el.shadowRoot!.querySelector("till-make-now")!;
      expect(widget.shadowRoot!.textContent).toContain("Lager");
      widget.shadowRoot!.querySelector("button")!.click();
      await flush(el);
      expect(widget.shadowRoot!.textContent).not.toContain("Lager");
    } finally {
      if (previous !== undefined) Object.defineProperty(globalThis, "localStorage", previous);
    }
  });

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
          kitchenScreens: [kitchenScreen("station")],
        }),
        getDeviceStationScreen: vi.fn(() => new Promise((resolve) => (resolveStation = resolve))),
      },
      { sessionActivity: sa as never },
    );
    await flush(el);

    host.removeChild(el);
    resolveStation({
      stations: [
        {
          name: "Cocina",
          available: true,
          today: {
            open: true,
            isDefault: true,
            byHand: null,
            sendsTo: null,
            why: "default" as const,
          },
          id: "st-1",
          queue: [],
          notices: [],
        },
      ],
    });
    await flush(el);

    expect(sa.configure).not.toHaveBeenCalled();
    host.appendChild(el);
    await flush(el);
    expect(shell(el)).toBeNull();
    expect(lock(el)).not.toBeNull();
  });
});

describe("till-app content languages", () => {
  // `captureMinuteTimers` takes every one-minute timer, and the battery reporter's send limit is one.
  beforeEach(() => {
    Object.defineProperty(navigator, "getBattery", { configurable: true, value: undefined });
  });
  afterEach(() => {
    delete (navigator as { getBattery?: unknown }).getBattery;
  });

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
  it("shows Make now after a counter cash payment reports a drink", async () => {
    let receive: ((items: unknown[]) => void) | undefined;
    const item = {
      lineId: "lager-pay",
      name: "Lager",
      quantity: "1.000",
      unitName: null,
      soldInEach: true,
      optionSnapshots: [],
      extras: [],
      note: null,
    };
    const { el } = await mountApp({
      onMadeHere: vi.fn((listener) => {
        receive = listener;
      }),
      recordSale: vi.fn(async () => {
        receive!([item]);
        return saleResult;
      }),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent).toContain(
      "Lager",
    );
  });

  async function ticketAfterSale(catalogue: ZoneOfferCatalogue): Promise<TillTicketView> {
    const { el } = await mountApp({ listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue) });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    await el.updateComplete;
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    return ticket(el)!;
  }

  it("uses automatic printing when zone offers omit the receipt choice, with or without a zone chooser", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    catalogue.zones = [zone("zone-counter", "prepay")];
    expect((await ticketAfterSale(catalogue)).originalReceiptAvailable).toBe(false);
    cleanupWidgets();
    delete catalogue.zones;
    expect((await ticketAfterSale(catalogue)).originalReceiptAvailable).toBe(false);
  });

  it("takes pay timing from the zone context when no zone chooser is supplied", async () => {
    const catalogue = zoneOffers(
      { menus: [defaultMenu], products: [cafe] },
      "zone-counter",
      "ticket_then_pay",
    );
    delete catalogue.zones;
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
    });
    const c = await toCounter(el);

    expect(c.orderFlow).toBe("ticket_then_pay");
  });

  it("offers the original receipt according to the selected zone", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    catalogue.context.receiptPrintMode = "on_request";
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(ticket(el)!.originalReceiptAvailable).toBe(true);
  });

  it("updates original receipt availability when the counter switches zones", async () => {
    const initial = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    initial.context.receiptPrintMode = "on_request";
    initial.zones = [zone("zone-counter", "prepay"), zone("zone-deli", "prepay")];
    const deli = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-deli");
    deli.context.receiptPrintMode = "auto";
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(initial),
      listZoneOffers: vi.fn().mockResolvedValue(deli),
    });
    const c = await toCounter(el);
    emit(c, "counter-zone-selected", { zoneId: "zone-deli" });
    await flush(el);
    expect(c.selectedServiceZoneId).toBe("zone-deli");
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    expect(ticket(el)!.originalReceiptAvailable).toBe(false);
  });

  it("keeps the original receipt on offer and says why when printing it fails", async () => {
    const printReceipt = vi.fn().mockRejectedValue({ code: "printing.no_printer" });
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    catalogue.context.receiptPrintMode = "on_request";
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
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
  it("uses pay-first controls when zone offers fail despite a retired venue-wide mode", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, orderFlow: "ticket_then_pay" }),
      listDefaultZoneOffers: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });

    const c = await toCounter(el);

    expect(c.orderFlow).toBe("prepay");
    expect(banner(el)!.textContent).toContain(t("service_zone.load_error"));
  });

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
      "ticket_then_pay",
    );
    catalogue.zones = [zone("zone-counter", "ticket_then_pay"), zone("zone-terrace", "table_tab")];
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
    expect(c.orderFlow).toBe("ticket_then_pay");

    emit(c, "counter-zone-selected", { zoneId: "zone-terrace" });
    await flush(el);

    expect(c.selectedServiceZoneId).toBe("zone-terrace");
    expect(c.orderFlow).toBe("ticket_then_pay");
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

  it("says in its own words that the profile no longer works in the zone chosen", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    catalogue.zones = [zone("zone-counter", "prepay"), zone("zone-a", "prepay")];
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
      listZoneOffers: vi
        .fn()
        .mockRejectedValue({ code: "service_zone.not_allowed", status: 403, zoneId: "zone-a" }),
    });
    const c = await toCounter(el);

    emit(c, "counter-zone-selected", { zoneId: "zone-a" });
    await flush(el);

    expect(banner(el)!.textContent).toContain(codeMessage("service_zone.not_allowed"));
    expect(banner(el)!.textContent).not.toContain(t("service_zone.load_error"));
    expect(c.selectedServiceZoneId).toBe("zone-counter");
  });

  it("searches the menus of the zone the counter switches to", async () => {
    const lunch = { id: "menu-lunch", name: "Lunch", isDefault: true };
    const tostada = { ...cafe, id: "tostada", name: "Tostada", catalogueId: "menu-lunch" };
    const lunchOffers = { menus: [lunch], products: [tostada] };
    const zoneA = zoneOffers(
      {
        menus: [...lunchOffers.menus, { id: "menu-drinks", name: "Drinks", isDefault: false }],
        products: [
          ...lunchOffers.products,
          { ...cafe, id: "tinto", name: "Tinto", catalogueId: "menu-drinks" },
        ],
      },
      "zone-a",
    );
    zoneA.zones = [zone("zone-a", "prepay"), zone("zone-b", "prepay")];
    const zoneB = zoneOffers(
      {
        menus: [...lunchOffers.menus, { id: "menu-brunch", name: "Brunch", isDefault: false }],
        products: [
          ...lunchOffers.products,
          { ...cafe, id: "tortilla", name: "Tortilla", catalogueId: "menu-brunch" },
        ],
      },
      "zone-b",
    );
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(zoneA),
      listZoneOffers: vi.fn().mockResolvedValue(zoneB),
    });
    const c = await toCounter(el);
    const searchedGroups = async () => {
      const browser = deepFind(el, "till-menu-browser") as HTMLElement & {
        updateComplete: Promise<unknown>;
      };
      const input = browser
        .shadowRoot!.querySelector("wt-input")!
        .shadowRoot!.querySelector("input")!;
      input.value = "t";
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await browser.updateComplete;
      return [
        ...browser.shadowRoot!.querySelectorAll<HTMLElement>(
          '[data-region="results"] section[data-menu]',
        ),
      ].map((group) => group.dataset.menu);
    };
    expect(await searchedGroups()).toEqual(["menu-lunch", "menu-drinks"]);

    emit(c, "counter-zone-selected", { zoneId: "zone-b" });
    await flush(el);

    expect(c.selectedServiceZoneId).toBe("zone-b");
    expect(await searchedGroups()).toEqual(["menu-lunch", "menu-brunch"]);
  });
});

/** The first element matching `selector` anywhere under `root`, through shadow roots. */
function deepFind(root: Element, selector: string): Element | null {
  const tree = root.shadowRoot ?? root;
  const direct = tree.querySelector(selector);
  if (direct !== null) return direct;
  for (const child of tree.querySelectorAll("*")) {
    const found = child.shadowRoot === null ? null : deepFind(child, selector);
    if (found !== null) return found;
  }
  return null;
}

describe("till-app simplified-invoice limit", () => {
  // The counter with its basket card, so the basket's own buttons are on screen.
  const limitedTill = {
    ...till,
    simplifiedInvoiceLimit: "3.00",
    canvas: {
      ...tillCanvas,
      tabs: [
        {
          ...tillCanvas.tabs[0]!,
          cards: [
            { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
            { type: "basket", colSpan: 4, rowSpan: 6, config: {} },
          ],
        },
      ],
    } satisfies CanvasDef,
  };
  /** The banner's words, with the no-break space a formatted amount carries read as a space. */
  const said = (el: TillApp) => banner(el)!.textContent!.replace(/\s/g, " ");

  it("refuses a line that would take the basket past the limit, saying so in its own words", async () => {
    const { el } = await mountApp({ getTill: vi.fn().mockResolvedValue(limitedTill) });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "2");
    await el.updateComplete;
    expect(banner(el)).toBeNull();

    c.store.addProduct(c.products[0]!, "1");
    await el.updateComplete;
    expect(c.store.total).toBe("3.00");
    expect(c.store.lines).toHaveLength(1);
    expect(said(el)).toBe(
      "El pedido pasaría de 3,00 €, el máximo que admite esta caja sin una factura completa a nombre del cliente, y no puede emitirla. Quita algo del pedido.",
    );
  });

  it("refuses raising a line's quantity past the limit from the basket's own button", async () => {
    const { el } = await mountApp({ getTill: vi.fn().mockResolvedValue(limitedTill) });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "2");
    await flush(el);
    const basket = deepFind(el, "till-basket")!;
    basket.shadowRoot!.querySelector<HTMLElement>(".step-inc")!.click();
    await flush(el);
    expect(c.store.lines[0]!.quantity).toBe("2");
    expect(said(el)).toContain("3,00 €");
  });

  it("lets a named full-invoice basket grow past the limit without releasing the next basket", async () => {
    const { el } = await mountApp({ getTill: vi.fn().mockResolvedValue(limitedTill) });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "2");
    emit(c, "choose-invoice");
    await flush(el);
    emit(
      el.shadowRoot!.querySelector("till-invoice-recipient-dialog")!,
      "invoice-recipient-confirm",
      {
        invoiceType: "F1",
        recipient: {
          taxId: "12345678Z",
          legalName: "Ana García",
          address: "Calle Mayor 1, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      },
    );
    await flush(el);

    c.store.addProduct(c.products[0]!, "1");
    await flush(el);
    expect(c.store.total).toBe("4.50");
    expect(banner(el)).toBeNull();

    c.store.clear();
    c.store.addProduct(c.products[0]!, "2");
    c.store.addProduct(c.products[0]!, "1");
    await flush(el);
    expect(c.store.total).toBe("3.00");
    expect(said(el)).toContain("3,00 €");
  });

  it("refuses nothing for a server that sends no limit", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "9");
    await el.updateComplete;
    expect(c.store.total).toBe("13.50");
    expect(banner(el)).toBeNull();
  });

  it("shows the server's refusal of a sale past the limit in its own words, naming the limit", async () => {
    const { el } = await mountApp({
      recordSale: vi.fn().mockRejectedValue({
        code: "sale.total_exceeds_simplified_limit",
        total: "3010.01",
        limit: "3010.00",
        status: 409,
      }),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(said(el)).toBe(
      "El pedido pasaría de 3010,00 €, el máximo que admite esta caja sin una factura completa a nombre del cliente, y no puede emitirla. Quita algo del pedido.",
    );
    expect(c.store.lines).toHaveLength(1);
  });

  it("words the refusal without the amount when the server names no limit", async () => {
    const { el } = await mountApp({
      recordSale: vi
        .fn()
        .mockRejectedValue({ code: "sale.total_exceeds_simplified_limit", status: 409 }),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(banner(el)!.textContent).toBe(
      "Este pedido supera el máximo que admite esta caja sin una factura completa a nombre del cliente, y no puede emitirla. Quita algo del pedido",
    );
  });
});

describe("till-app integrated card collection", () => {
  it("sends the reader the operator picked", async () => {
    const pay = vi.fn().mockResolvedValue({ outcome: "declined" });
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        cardProvider: "simulator",
        capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
      }),
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

/** The bottom edges of the till and the screen it shows, and the box of that screen's language button. */
function edgesOf(el: TillApp, screen: Element) {
  const chooser = screen.shadowRoot!.querySelector("wt-language-chooser")!;
  return {
    app: el.getBoundingClientRect().bottom,
    screen: screen.getBoundingClientRect().bottom,
    chooser: chooser.getBoundingClientRect(),
  };
}

/** The language button is drawn, and lies vertically inside the page: neither above its top nor below its bottom. */
function expectChooserOnPage(chooser: DOMRect, pageBox: DOMRect): void {
  expect(chooser.height).toBeGreaterThan(0);
  expect(chooser.top).toBeGreaterThanOrEqual(pageBox.top);
  expect(chooser.bottom).toBeLessThanOrEqual(pageBox.bottom);
}

// The container stands in for the page: `index.html` gives the till one screen's height, less its own
// padding, so the till must fill that box and no more.
describe("till-app fits the page it is given", () => {
  const PAGE_HEIGHT = 500;
  /** A counter whose products fill far more than the page, as a real menu does, so the shell must
   * shrink below its content rather than to it. */
  const fullMenu = zoneOffers(
    {
      menus: [defaultMenu],
      products: Array.from({ length: 40 }, (_, i) => ({
        ...cafe,
        id: `cafe-${i}`,
        name: `Café ${i}`,
      })),
    },
    "zone-counter",
  );

  it("keeps the tab shell's language button on the page while a refusal banner shows", async () => {
    const { el, host } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        cardProvider: "simulator",
        capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
      }),
      pay: vi.fn().mockRejectedValue({ code: "device.forbidden_action", status: 403 }),
      listDefaultZoneOffers: vi.fn().mockResolvedValue(fullMenu),
    });
    host.style.height = `${PAGE_HEIGHT}px`;
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    await el.updateComplete;

    emit(c, "collect-card", {});
    await flush(el);

    expect(banner(el)).not.toBeNull();
    const pageBox = host.getBoundingClientRect();
    const pageBottom = pageBox.bottom;
    const edges = edgesOf(el, shell(el)!);
    expect(edges.app).toBe(pageBottom);
    expect(edges.screen).toBe(pageBottom);
    expectChooserOnPage(edges.chooser, pageBox);
  });

  it("keeps the whole page within the screen, its padding included, while a refusal banner shows", async () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    await page.viewport(1024, 768);
    const style = document.createElement("style");
    style.textContent = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)![1]!;
    document.head.append(style);
    applyTokens(document.documentElement);
    const app = document.createElement("div");
    app.id = "app";
    document.body.append(app);
    try {
      api = stubApi({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          cardProvider: "simulator",
          capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
        }),
        pay: vi.fn().mockRejectedValue({ code: "device.forbidden_action", status: 403 }),
        listDefaultZoneOffers: vi.fn().mockResolvedValue(fullMenu),
      });
      const el = Object.assign(document.createElement("till-app"), { api });
      app.append(el);
      const c = await toCounter(el);
      c.store.addProduct(c.products[0]!, "1");
      await el.updateComplete;

      emit(c, "collect-card", {});
      await flush(el);

      expect(banner(el)).not.toBeNull();
      expect(document.documentElement.scrollHeight).toBe(window.innerHeight);
    } finally {
      app.remove();
      style.remove();
      document.documentElement.removeAttribute("data-wt-theme-root");
      await page.viewport(width, height);
    }
  });

  it("keeps the lock screen's language button on the page while its staff list is short", async () => {
    const { el, host } = await mountApp();
    host.style.height = `${PAGE_HEIGHT}px`;
    await flush(el);

    const pageBox = host.getBoundingClientRect();
    const pageBottom = pageBox.bottom;
    const edges = edgesOf(el, lock(el)!);
    expect(edges.app).toBe(pageBottom);
    expect(edges.screen).toBe(pageBottom);
    expectChooserOnPage(edges.chooser, pageBox);
  });

  it("keeps the join screen's language button on the page", async () => {
    const { el, host } = await mountApp({
      getDeviceIdentity: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    });
    host.style.height = `${PAGE_HEIGHT}px`;
    await flush(el);

    const join = el.shadowRoot!.querySelector("till-enrol-screen")!;
    const pageBox = host.getBoundingClientRect();
    const pageBottom = pageBox.bottom;
    const edges = edgesOf(el, join);
    expect(edges.app).toBe(pageBottom);
    expect(edges.screen).toBe(pageBottom);
    expectChooserOnPage(edges.chooser, pageBox);
  });
});

describe("till-app battery report", () => {
  let battery: EventTarget & { level: number; charging: boolean };
  beforeEach(() => {
    battery = Object.assign(new EventTarget(), { level: 0.82, charging: false });
    Object.defineProperty(navigator, "getBattery", {
      configurable: true,
      value: () => Promise.resolve(battery),
    });
  });
  afterEach(() => {
    delete (navigator as { getBattery?: unknown }).getBattery;
  });

  it("reports the battery once booted as a paired device, and again when it changes", async () => {
    const reportBattery = vi.fn().mockResolvedValue(undefined);
    const { el } = await mountApp({ reportBattery });
    await flush(el);
    expect(reportBattery).toHaveBeenCalledWith(
      { level: 82, charging: false },
      { signal: expect.any(AbortSignal) },
    );

    battery.charging = true;
    battery.dispatchEvent(new Event("chargingchange"));
    expect(reportBattery).toHaveBeenLastCalledWith(
      { level: 82, charging: true },
      { signal: expect.any(AbortSignal) },
    );
    expect(reportBattery).toHaveBeenCalledTimes(2);
  });

  it("cancels the report in flight when the app is removed from the page", async () => {
    const reportBattery = vi.fn(() => new Promise<void>(() => undefined));
    const { el, host } = await mountApp({ reportBattery });
    await flush(el);
    const [, options] = reportBattery.mock.calls[0] as unknown as [
      unknown,
      { signal: AbortSignal },
    ];
    expect(options.signal.aborted).toBe(false);

    host.removeChild(el);
    expect(options.signal.aborted).toBe(true);
  });

  it("reports nothing from a browser that is not a paired device", async () => {
    const reportBattery = vi.fn().mockResolvedValue(undefined);
    const { el } = await mountApp({
      reportBattery,
      getDeviceIdentity: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    });
    await flush(el);
    expect(reportBattery).not.toHaveBeenCalled();
  });

  it("stops reporting when the app is removed from the page", async () => {
    const reportBattery = vi.fn().mockResolvedValue(undefined);
    const { el, host } = await mountApp({ reportBattery });
    await flush(el);
    reportBattery.mockClear();

    host.removeChild(el);
    battery.dispatchEvent(new Event("levelchange"));
    expect(reportBattery).not.toHaveBeenCalled();
  });

  it("does not start reporting when the device identity arrives after removal", async () => {
    const reportBattery = vi.fn().mockResolvedValue(undefined);
    let resolveIdentity!: (identity: unknown) => void;
    const { el, host } = await mountApp({
      reportBattery,
      getDeviceIdentity: vi.fn(() => new Promise((resolve) => (resolveIdentity = resolve))),
    });
    await flush(el);

    host.removeChild(el);
    resolveIdentity({ deviceId: "till-dev", name: "Till 1", formFactor: "till" });
    await flush(el);
    battery.dispatchEvent(new Event("levelchange"));
    expect(reportBattery).not.toHaveBeenCalled();
  });

  it("stops the previous report when a re-boot finds the device no longer paired", async () => {
    const reportBattery = vi.fn().mockResolvedValue(undefined);
    const getDeviceIdentity = vi
      .fn()
      .mockResolvedValueOnce({
        deviceId: "till-dev",
        name: "Till 1",
        formFactor: "till",
      })
      .mockRejectedValue({ code: "device.unauthorized" });
    const { el } = await mountApp({ reportBattery, getDeviceIdentity });
    await flush(el);
    reportBattery.mockClear();

    emit(lock(el)!, "device-unauthorized");
    await flush(el);
    expect(getDeviceIdentity).toHaveBeenCalledTimes(2);
    battery.dispatchEvent(new Event("levelchange"));
    expect(reportBattery).not.toHaveBeenCalled();
  });

  it("does not start reporting when a boot's identity arrives after a later boot found the device unpaired", async () => {
    const reportBattery = vi.fn().mockResolvedValue(undefined);
    let resolveFirstIdentity!: (identity: unknown) => void;
    const getDeviceIdentity = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirstIdentity = resolve)))
      .mockRejectedValue({ code: "device.unauthorized" });
    const { el } = await mountApp({ reportBattery, getDeviceIdentity });
    await flush(el);

    emit(lock(el)!, "device-unauthorized");
    await flush(el);
    expect(getDeviceIdentity).toHaveBeenCalledTimes(2);
    resolveFirstIdentity({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
    });
    await flush(el);
    battery.dispatchEvent(new Event("levelchange"));
    await flush(el);
    expect(reportBattery).not.toHaveBeenCalled();
  });

  it("keeps the later boot's report running when an earlier boot's identity arrives late", async () => {
    const reportBattery = vi.fn().mockResolvedValue(undefined);
    const identity = { deviceId: "till-dev", name: "Till 1", formFactor: "till" };
    let resolveFirstIdentity!: (identity: unknown) => void;
    const getDeviceIdentity = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirstIdentity = resolve)))
      .mockResolvedValue(identity);
    const { el } = await mountApp({ reportBattery, getDeviceIdentity });
    await flush(el);

    emit(lock(el)!, "device-unauthorized");
    await flush(el);
    expect(reportBattery).toHaveBeenCalledTimes(1);
    resolveFirstIdentity(identity);
    await flush(el);
    reportBattery.mockClear();

    battery.level = 0.81;
    battery.dispatchEvent(new Event("levelchange"));
    expect(reportBattery.mock.calls).toEqual([
      [{ level: 81, charging: false }, { signal: expect.any(AbortSignal) }],
    ]);
  });
});

describe("till-app logout while a request is waiting for the server", () => {
  it("does not start a sale after sign-out overtakes its first await", async () => {
    const recordSale = vi.fn();
    const { el } = await mountApp({ recordSale });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");

    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    emit(shell(el)!, "logout");
    await flush(el);

    expect(recordSale).not.toHaveBeenCalled();
  });

  it("does not place an order after its park answers for a signed-out operator", async () => {
    let answerPark!: () => void;
    const placeOrder = vi.fn();
    const { el } = await mountApp({
      parkOrder: vi.fn(() => new Promise<void>((resolve) => (answerPark = resolve))),
      placeOrder,
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "place-order");
    await flush(el);
    expect(api.parkOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    answerPark();
    await flush(el);

    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("does not show the next operator an earlier collection refusal", async () => {
    let refuse!: (reason: unknown) => void;
    const { el } = await mountApp({
      markCollected: vi.fn(() => new Promise<void>((_, reject) => (refuse = reject))),
    });
    const c = await toCounter(el);
    emit(c, "mark-collected", { orderId: "wo-1" });
    await flush(el);
    expect(api.markCollected).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
    await flush(el);
    refuse({ code: "server.internal" });
    await flush(el);

    expect(banner(el)).toBeNull();
  });

  it("does not start the waiting-list read when a hand-over's station read outlives sign-out", async () => {
    const { el } = await mountApp({ markCollected: vi.fn().mockResolvedValue(undefined) });
    const c = await toCounter(el);
    let answerStations!: (rows: []) => void;
    vi.mocked(api.listStations).mockImplementationOnce(
      () => new Promise((resolve) => (answerStations = resolve)),
    );
    emit(c, "hand-over-order", { id: "wo-1" });
    await flush(el);
    expect(answerStations).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answerStations([]);
    await flush(el);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not load a retrieved order into the next operator's basket", async () => {
    let answer!: (order: { id: string; orderNumber: number; label: null; lines: [] }) => void;
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn(() => new Promise((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    const basketId = c.store.id;
    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(api.retrieveWorkingOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    answer({ id: "wo-1", orderNumber: 1, label: null, lines: [] });
    await flush(el);

    expect(c.store.id).toBe(basketId);
  });

  it("does not reload held orders for a cash payment refused after sign-out", async () => {
    let refuse!: (reason: unknown) => void;
    const { el } = await mountApp({
      recordSale: vi.fn(() => new Promise((_, reject) => (refuse = reject))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(api.recordSale).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const heldReads = vi.mocked(api.listWorkingOrders).mock.calls.length;
    refuse({ code: "bill.payments_received" });
    await flush(el);

    expect(api.listWorkingOrders).toHaveBeenCalledTimes(heldReads);
  });

  it("does not start later list reads when a cash sale's held-list read outlives sign-out", async () => {
    const { el } = await mountApp();
    const c = await toCounter(el);
    let answerHeld!: (rows: []) => void;
    vi.mocked(api.listWorkingOrders).mockImplementationOnce(
      () => new Promise((resolve) => (answerHeld = resolve)),
    );
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(answerHeld).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const stationReads = vi.mocked(api.listStations).mock.calls.length;
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answerHeld([]);
    await flush(el);

    expect(api.listStations).toHaveBeenCalledTimes(stationReads);
    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not read waiting orders when a cash sale's station read outlives sign-out", async () => {
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue({
        ...zoneOffers(
          { menus: [defaultMenu], products: [cafe] },
          "zone-counter",
          "ticket_then_pay",
        ),
        zones: [zone("zone-counter", "ticket_then_pay")],
      }),
    });
    const c = await toCounter(el);
    let answerStations!: (rows: []) => void;
    vi.mocked(api.listStations).mockImplementationOnce(
      () => new Promise((resolve) => (answerStations = resolve)),
    );
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(answerStations).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answerStations([]);
    await flush(el);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not read waiting orders when a card capture's station read outlives sign-out", async () => {
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue({
        ...zoneOffers(
          { menus: [defaultMenu], products: [cafe] },
          "zone-counter",
          "ticket_then_pay",
        ),
        zones: [zone("zone-counter", "ticket_then_pay")],
      }),
    });
    const c = await toCounter(el);
    let answerStations!: (rows: []) => void;
    vi.mocked(api.listStations).mockImplementationOnce(
      () => new Promise((resolve) => (answerStations = resolve)),
    );
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "collect-card", {});
    await flush(el);
    expect(answerStations).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answerStations([]);
    await flush(el);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not read waiting orders when a place's station read outlives sign-out", async () => {
    const { el } = await mountApp({
      parkOrder: vi.fn().mockResolvedValue(undefined),
      placeOrder: vi.fn().mockResolvedValue(undefined),
    });
    const c = await toCounter(el);
    let answerStations!: (rows: []) => void;
    vi.mocked(api.listStations).mockImplementationOnce(
      () => new Promise((resolve) => (answerStations = resolve)),
    );
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "place-order");
    await flush(el);
    expect(answerStations).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answerStations([]);
    await flush(el);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not read waiting orders when a found-bill payment's station read outlives sign-out", async () => {
    const { el } = await mountApp({ collectOrder: vi.fn().mockResolvedValue(saleResult) });
    const c = await toCounter(el);
    let answerStations!: (rows: []) => void;
    vi.mocked(api.listStations).mockImplementationOnce(
      () => new Promise((resolve) => (answerStations = resolve)),
    );
    emit(c, "find-bill-pay", {
      workingOrderId: "wo-1",
      tender: { method: "cash", amount: "5" },
      invoiced: true,
    });
    await flush(el);
    expect(answerStations).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answerStations([]);
    await flush(el);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not read waiting orders when a collection's station read outlives sign-out", async () => {
    const { el } = await mountApp({ markCollected: vi.fn().mockResolvedValue(undefined) });
    const c = await toCounter(el);
    let answerStations!: (rows: []) => void;
    vi.mocked(api.listStations).mockImplementationOnce(
      () => new Promise((resolve) => (answerStations = resolve)),
    );
    emit(c, "mark-collected", { orderId: "wo-1" });
    await flush(el);
    expect(answerStations).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answerStations([]);
    await flush(el);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not reload stations for a zone choice answered after sign-out", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    catalogue.zones = [zone("zone-counter", "prepay"), zone("zone-deli", "prepay")];
    let answer!: (catalogue: ZoneOfferCatalogue) => void;
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
      listZoneOffers: vi.fn(() => new Promise<ZoneOfferCatalogue>((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    emit(c, "counter-zone-selected", { zoneId: "zone-deli" });
    await flush(el);
    expect(api.listZoneOffers).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const stationReads = vi.mocked(api.listStations).mock.calls.length;
    answer(zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-deli"));
    await flush(el);

    expect(api.listStations).toHaveBeenCalledTimes(stationReads);
  });

  it("does not choose a menu after a zone's station read outlives sign-out", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    catalogue.zones = [zone("zone-counter", "prepay"), zone("zone-deli", "prepay")];
    const deli = zoneOffers(
      { menus: [{ id: "cat-deli", name: "Deli", isDefault: true }], products: [cafe] },
      "zone-deli",
    );
    let answerStations!: (rows: []) => void;
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
      listZoneOffers: vi.fn().mockResolvedValue(deli),
    });
    const c = await toCounter(el);
    vi.mocked(api.listStations).mockImplementationOnce(
      () => new Promise((resolve) => (answerStations = resolve)),
    );
    emit(c, "counter-zone-selected", { zoneId: "zone-deli" });
    await flush(el);
    expect(answerStations).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const selected = privateState<string>(el, "selectedCatalogueId");
    answerStations([]);
    await flush(el);

    expect(privateState<string>(el, "selectedCatalogueId")).toBe(selected);
  });

  it("does not reload held orders for a retrieve refused after sign-out", async () => {
    let refuse!: (reason: unknown) => void;
    const { el } = await mountApp({
      retrieveWorkingOrder: vi.fn(() => new Promise((_, reject) => (refuse = reject))),
    });
    const c = await toCounter(el);
    emit(c, "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(api.retrieveWorkingOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const heldReads = vi.mocked(api.listWorkingOrders).mock.calls.length;
    refuse({ code: "working_order.not_found" });
    await flush(el);

    expect(api.listWorkingOrders).toHaveBeenCalledTimes(heldReads);
  });

  it("does not reload held orders for a discard answered after sign-out", async () => {
    let answer!: () => void;
    const { el } = await mountApp({
      abandonWorkingOrder: vi.fn(() => new Promise<void>((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    emit(c, "discard-order", { id: "wo-1" });
    await flush(el);
    expect(api.abandonWorkingOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const heldReads = vi.mocked(api.listWorkingOrders).mock.calls.length;
    answer();
    await flush(el);

    expect(api.listWorkingOrders).toHaveBeenCalledTimes(heldReads);
  });

  it("does not replace a discard refusal after its held-list read outlives sign-out", async () => {
    const { el } = await mountApp({
      abandonWorkingOrder: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const c = await toCounter(el);
    let answerHeld!: (rows: []) => void;
    vi.mocked(api.listWorkingOrders).mockImplementationOnce(
      () => new Promise((resolve) => (answerHeld = resolve)),
    );
    emit(c, "discard-order", { id: "wo-1" });
    await flush(el);
    expect(answerHeld).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
    await flush(el);
    const before = banner(el)?.textContent;
    answerHeld([]);
    await flush(el);

    expect(banner(el)?.textContent).toBe(before);
  });

  it("does not reload station and waiting lists for a found bill payment answered after sign-out", async () => {
    let answer!: (result: TillSaleResult) => void;
    const { el } = await mountApp({
      collectOrder: vi.fn(() => new Promise<TillSaleResult>((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    emit(c, "find-bill-pay", {
      workingOrderId: "wo-1",
      tender: { method: "cash", amount: "5" },
      invoiced: true,
    });
    await flush(el);
    expect(api.collectOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const stationReads = vi.mocked(api.listStations).mock.calls.length;
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answer(saleResult);
    await flush(el);

    expect(api.listStations).toHaveBeenCalledTimes(stationReads);
    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not reload counter lists for a card capture answered after sign-out", async () => {
    let answer!: (result: { outcome: "captured"; ticket: TillSaleResult }) => void;
    const { el } = await mountApp({
      pay: vi.fn(() => new Promise((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "collect-card", {});
    await flush(el);
    expect(api.pay).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const heldReads = vi.mocked(api.listWorkingOrders).mock.calls.length;
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answer({ outcome: "captured", ticket: saleResult });
    await flush(el);

    expect(api.listWorkingOrders).toHaveBeenCalledTimes(heldReads);
    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not show a card refusal to the next operator", async () => {
    let refuse!: (reason: unknown) => void;
    const { el } = await mountApp({
      pay: vi.fn(() => new Promise((_, reject) => (refuse = reject))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "collect-card", {});
    await flush(el);
    expect(api.pay).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
    await flush(el);
    refuse({ code: "sale.refused" });
    await flush(el);

    expect(banner(el)).toBeNull();
  });

  it("does not retry a cash sale after its version refresh outlives sign-out", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    let answerOffers!: (offers: ZoneOfferCatalogue) => void;
    const recordSale = vi
      .fn()
      .mockRejectedValueOnce({ code: "menu.version_changed" })
      .mockResolvedValue(saleResult);
    const { el } = await mountApp({
      recordSale,
      listZoneOffers: vi.fn(() => new Promise((resolve) => (answerOffers = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(answerOffers).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    answerOffers(catalogue);
    await flush(el);

    expect(recordSale).toHaveBeenCalledOnce();
  });

  it("does not retry a card sale after its version refresh outlives sign-out", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    let answerOffers!: (offers: ZoneOfferCatalogue) => void;
    const pay = vi
      .fn()
      .mockRejectedValueOnce({ code: "menu.version_changed" })
      .mockResolvedValue({ outcome: "captured", ticket: saleResult });
    const { el } = await mountApp({
      pay,
      listZoneOffers: vi.fn(() => new Promise((resolve) => (answerOffers = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "collect-card", {});
    await flush(el);
    expect(answerOffers).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    answerOffers(catalogue);
    await flush(el);

    expect(pay).toHaveBeenCalledOnce();
  });

  it("does not retry a place after its version refresh outlives sign-out", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    let answerOffers!: (offers: ZoneOfferCatalogue) => void;
    const placeOrder = vi
      .fn()
      .mockRejectedValueOnce({ code: "menu.version_changed" })
      .mockResolvedValue(undefined);
    const { el } = await mountApp({
      placeOrder,
      parkOrder: vi.fn().mockResolvedValue(undefined),
      listZoneOffers: vi.fn(() => new Promise((resolve) => (answerOffers = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "place-order");
    await flush(el);
    expect(answerOffers).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    answerOffers(catalogue);
    await flush(el);

    expect(placeOrder).toHaveBeenCalledOnce();
  });

  it("does not retry a park after its version refresh outlives sign-out", async () => {
    const catalogue = zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter");
    let answerOffers!: (offers: ZoneOfferCatalogue) => void;
    const parkOrder = vi
      .fn()
      .mockRejectedValueOnce({ code: "menu.version_changed" })
      .mockResolvedValue(undefined);
    const { el } = await mountApp({
      parkOrder,
      listZoneOffers: vi.fn(() => new Promise((resolve) => (answerOffers = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "park-order", { label: "Later" });
    await flush(el);
    expect(answerOffers).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    answerOffers(catalogue);
    await flush(el);

    expect(parkOrder).toHaveBeenCalledOnce();
  });

  it("does not retry a park after its dead-end recheck outlives sign-out", async () => {
    let answerDeadEnds!: (result: { sends: false; deadEnds: [] }) => void;
    const parkOrder = vi
      .fn()
      .mockRejectedValueOnce({ code: "station.no_replacement" })
      .mockResolvedValue(undefined);
    const { el } = await mountApp({
      parkOrder,
      askSaleDeadEnds: vi.fn(() => new Promise((resolve) => (answerDeadEnds = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "park-order", { label: "Later" });
    await flush(el);
    expect(answerDeadEnds).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    answerDeadEnds({ sends: false, deadEnds: [] });
    await flush(el);

    expect(parkOrder).toHaveBeenCalledOnce();
  });

  it("does not retry a cash sale after its save-refusal recheck outlives sign-out", async () => {
    let answerDeadEnds!: (result: { sends: false; deadEnds: [] }) => void;
    const recordSale = vi.fn();
    const { el } = await mountApp({
      recordSale,
      updateWorkingOrder: vi.fn().mockRejectedValue({ code: "station.no_replacement" }),
      askSaleDeadEnds: vi.fn(() => new Promise((resolve) => (answerDeadEnds = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    c.store.markPersisted();
    c.store.setLineQuantity(0, "2");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);
    expect(answerDeadEnds).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    answerDeadEnds({ sends: false, deadEnds: [] });
    await flush(el);

    expect(recordSale).not.toHaveBeenCalled();
    expect(api.updateWorkingOrder).toHaveBeenCalledOnce();
  });

  it("does not retry a card sale after its save-refusal recheck outlives sign-out", async () => {
    let answerDeadEnds!: (result: { sends: false; deadEnds: [] }) => void;
    const pay = vi.fn();
    const { el } = await mountApp({
      pay,
      updateWorkingOrder: vi.fn().mockRejectedValue({ code: "station.no_replacement" }),
      askSaleDeadEnds: vi.fn(() => new Promise((resolve) => (answerDeadEnds = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    c.store.markPersisted();
    c.store.setLineQuantity(0, "2");
    emit(c, "collect-card", {});
    await flush(el);
    expect(answerDeadEnds).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    answerDeadEnds({ sends: false, deadEnds: [] });
    await flush(el);

    expect(pay).not.toHaveBeenCalled();
    expect(api.updateWorkingOrder).toHaveBeenCalledOnce();
  });

  it("does not show a place refusal to the next operator", async () => {
    let refuse!: (reason: unknown) => void;
    const { el } = await mountApp({
      parkOrder: vi.fn().mockResolvedValue(undefined),
      placeOrder: vi.fn(() => new Promise((_, reject) => (refuse = reject))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "place-order");
    await flush(el);
    expect(api.placeOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
    await flush(el);
    refuse({ code: "sale.refused" });
    await flush(el);

    expect(banner(el)).toBeNull();
  });

  it("does not show a found-bill refusal to the next operator", async () => {
    let refuse!: (reason: unknown) => void;
    const { el } = await mountApp({
      collectOrder: vi.fn(() => new Promise((_, reject) => (refuse = reject))),
    });
    const c = await toCounter(el);
    emit(c, "find-bill-pay", {
      workingOrderId: "wo-1",
      tender: { method: "cash", amount: "5" },
      invoiced: true,
    });
    await flush(el);
    expect(api.collectOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
    await flush(el);
    refuse({ code: "sale.refused" });
    await flush(el);

    expect(privateState(el, "findBillError")).toBeUndefined();
  });

  it("does not reload waiting orders for a collect answered after sign-out", async () => {
    let answer!: (result: TillSaleResult) => void;
    const { el } = await mountApp({
      collectOrder: vi.fn(() => new Promise<TillSaleResult>((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    emit(c, "collect-order", { method: "cash", amount: "5" });
    await flush(el);
    expect(api.collectOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answer(saleResult);
    await flush(el);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not reload station and waiting lists for a place answered after sign-out", async () => {
    let answer!: () => void;
    const { el } = await mountApp({
      parkOrder: vi.fn().mockResolvedValue(undefined),
      placeOrder: vi.fn(() => new Promise<void>((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "place-order");
    await flush(el);
    expect(api.placeOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const stationReads = vi.mocked(api.listStations).mock.calls.length;
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answer();
    await flush(el);

    expect(api.listStations).toHaveBeenCalledTimes(stationReads);
    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not reload held orders for a park answered after sign-out", async () => {
    let answer!: () => void;
    const { el } = await mountApp({
      parkOrder: vi.fn(() => new Promise<void>((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "park-order", { label: "Later" });
    await flush(el);
    expect(api.parkOrder).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const heldReads = vi.mocked(api.listWorkingOrders).mock.calls.length;
    answer();
    await flush(el);

    expect(api.listWorkingOrders).toHaveBeenCalledTimes(heldReads);
  });

  it("does not reload station and waiting lists for a collection answered after sign-out", async () => {
    let answer!: () => void;
    const { el } = await mountApp({
      markCollected: vi.fn(() => new Promise<void>((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    emit(c, "mark-collected", { orderId: "wo-1" });
    await flush(el);
    expect(api.markCollected).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const stationReads = vi.mocked(api.listStations).mock.calls.length;
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answer();
    await flush(el);

    expect(api.listStations).toHaveBeenCalledTimes(stationReads);
    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not start the waiting read after a refused collection's station read outlives sign-out", async () => {
    const { el } = await mountApp({
      markCollected: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const c = await toCounter(el);
    let answerStations!: (rows: []) => void;
    vi.mocked(api.listStations).mockImplementationOnce(
      () => new Promise((resolve) => (answerStations = resolve)),
    );
    emit(c, "mark-collected", { orderId: "wo-1" });
    await flush(el);
    expect(answerStations).toBeTypeOf("function");

    emit(shell(el)!, "logout");
    await flush(el);
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    answerStations([]);
    await flush(el);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not reload the station list for a ticket advance answered after sign-out", async () => {
    let answer!: () => void;
    const { el } = await mountApp({
      advanceTicketItem: vi.fn(() => new Promise<void>((resolve) => (answer = resolve))),
    });
    const c = await toCounter(el);
    emit(c, "advance-ticket-item", { itemId: "item-1", to: "ready" });
    await flush(el);
    expect(api.advanceTicketItem).toHaveBeenCalledOnce();

    emit(shell(el)!, "logout");
    await flush(el);
    const stationReads = vi.mocked(api.listStations).mock.calls.length;
    answer();
    await flush(el);

    expect(api.listStations).toHaveBeenCalledTimes(stationReads);
  });

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
    const heldReads = vi.mocked(api.listWorkingOrders).mock.calls.length;
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;

    answerSale(saleResult);
    await flush(el);

    expect(lock(el)).not.toBeNull();
    expect(shell(el)).toBeNull();
    expect(privateState<string>(el, "operatorName")).toBe("");
    expect(api.listWorkingOrders).toHaveBeenCalledTimes(heldReads);
    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
  });

  it("does not retain the earlier operator's sale result after the next operator signs in", async () => {
    let answerSale!: (result: TillSaleResult) => void;
    const { el } = await mountApp({
      recordSale: vi.fn(() => new Promise<TillSaleResult>((resolve) => (answerSale = resolve))),
    });
    const c = await toCounter(el);
    c.store.addProduct(c.products[0]!, "1");
    emit(c, "confirm-payment", { method: "cash", amount: "5" });
    await flush(el);

    emit(shell(el)!, "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
    await flush(el);
    expect(privateState<TillSaleResult | undefined>(el, "result")).toBeUndefined();
    answerSale(saleResult);
    await flush(el);

    expect(privateState<TillSaleResult | undefined>(el, "result")).toBeUndefined();
  });
});

describe("department transfers across operator lifetimes", () => {
  const request = {
    id: "request-1",
    tabId: "tab-1",
    sourceDepartmentId: "deli",
    destinationDepartmentId: "restaurant",
    senderId: "sender",
    resolvedBy: null,
    destinationZoneId: null,
    status: "pending" as const,
    reason: null,
    createdAt: "2026-10-07T09:00:00.000Z",
    resolvedAt: null,
    revision: 0,
  };
  function transfers() {
    const signals: AbortSignal[] = [];
    let change: (() => void) | undefined;
    let incoming = [request];
    const calls = {
      listIncomingDepartmentTransfers: vi.fn(async () => ({
        count: incoming.length,
        requests: incoming,
      })),
      listDepartmentSentTransfers: vi.fn(async () => ({
        requests: [{ ...request, id: "sent-1", status: "declined", reason: "Closing" }],
      })),
      readDepartmentTransferEvents: vi.fn(
        (reload: () => void, { signal }: { signal: AbortSignal }) => {
          signals.push(signal);
          change = reload;
          return new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
        },
      ),
    };
    return {
      calls,
      signals,
      refresh() {
        change?.();
      },
      empty() {
        incoming = [];
        change?.();
      },
    };
  }
  async function signIn(el: TillApp, permissions = ["sale.take_payment"]) {
    emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions });
    await vi.waitFor(() => expect(shell(el)).not.toBeNull());
    await flush(el);
  }
  const pendingCount = (el: TillApp) =>
    shell(el)?.shadowRoot?.querySelector<HTMLElement>("[data-test=department-transfers]");

  const transferPanel = (el: TillApp) =>
    el.shadowRoot?.querySelector<HTMLElement>("till-department-transfers");
  const transferRoot = (el: TillApp) => transferPanel(el)?.shadowRoot;
  const currentDetail = {
    request,
    tab: {
      id: "tab-1",
      revision: 9,
      status: "placed",
      label: "Lunch",
      orderNumber: 12,
      deliveryTableId: null,
    },
    lines: [
      {
        id: "line-1",
        name: "Soup",
        variantName: null,
        quantity: "0.500",
        unitPriceGross: "2.80",
        note: "No salt",
        parentLineId: null,
      },
    ],
    outstandingWork: [
      {
        id: "work-1",
        lineId: "line-1",
        stationId: "kitchen",
        stationName: "Kitchen / Cocina",
        state: "queued",
        note: "No salt",
        firedAt: null,
        awayAt: null,
        courseId: null,
      },
    ],
  };
  async function openTransfers(el: TillApp) {
    const button = shell(el)?.shadowRoot?.querySelector<HTMLElement>("[data-open-transfers]");
    expect(button).not.toBeNull();
    button!.click();
    await vi.waitFor(() => expect(transferRoot(el)?.querySelector("wt-dialog")).not.toBeNull());
  }

  it("dismisses a notice without removing its durable pending request or accepting it", async () => {
    const desk = transfers();
    const accept = vi.fn();
    const { el } = await mountApp({ ...desk.calls, acceptDepartmentTransfer: accept });
    await signIn(el);
    await vi.waitFor(() =>
      expect(transferRoot(el)?.querySelectorAll("[data-notification]").length).toBe(2),
    );
    transferRoot(el)!
      .querySelector<HTMLElement>("[data-notification=request-1] [data-dismiss]")!
      .click();
    await vi.waitFor(() =>
      expect(transferRoot(el)?.querySelector("[data-notification=request-1]")).toBeNull(),
    );
    expect(pendingCount(el)?.textContent).toContain("1");
    await openTransfers(el);
    expect(transferRoot(el)?.querySelectorAll("[data-incoming]").length).toBe(1);
    expect(accept).not.toHaveBeenCalled();
    emit(shell(el)!, "logout");
    await vi.waitFor(() => expect(transferPanel(el)).toBeNull());
    await signIn(el);
    await vi.waitFor(() =>
      expect(transferRoot(el)?.querySelector("[data-notification=request-1]")).not.toBeNull(),
    );
  });

  it("keeps declined sender status and reason in history after dismissing its notification", async () => {
    const desk = transfers();
    const { el } = await mountApp(desk.calls);
    await signIn(el);
    await vi.waitFor(() =>
      expect(transferRoot(el)?.querySelector("[data-notification=sent-1]")?.textContent).toContain(
        "Closing",
      ),
    );
    transferRoot(el)!
      .querySelector<HTMLElement>("[data-notification=sent-1] [data-dismiss]")!
      .click();
    await openTransfers(el);
    expect(transferRoot(el)?.querySelector("[data-sent=sent-1]")?.textContent).toContain("Closing");
    expect(transferRoot(el)?.querySelector("[data-notification=sent-1]")).toBeNull();
  });

  it("opening an incoming request reads current lines and outstanding kitchen work without accepting", async () => {
    const desk = transfers();
    const read = vi.fn().mockResolvedValue(currentDetail);
    const accept = vi.fn();
    const decline = vi.fn();
    const { el } = await mountApp({
      ...desk.calls,
      getDepartmentTransfer: read,
      acceptDepartmentTransfer: accept,
      declineDepartmentTransfer: decline,
    });
    await signIn(el);
    await openTransfers(el);
    transferRoot(el)!.querySelector<HTMLElement>("[data-incoming=request-1] [data-view]")!.click();
    await vi.waitFor(() =>
      expect(transferRoot(el)?.querySelector("[data-current-tab]")?.textContent).toContain("Lunch"),
    );
    expect(read).toHaveBeenCalledWith("request-1", { signal: expect.any(AbortSignal) });
    expect(transferRoot(el)?.querySelector("[data-current-lines]")?.textContent).toContain("Soup");
    expect(transferRoot(el)?.querySelector("[data-current-work]")?.textContent).toContain("Soup");
    expect(transferRoot(el)?.querySelector("[data-current-work]")?.textContent).toContain(
      "No salt",
    );
    expect(accept).not.toHaveBeenCalled();
    expect(decline).not.toHaveBeenCalled();
    desk.empty();
    await vi.waitFor(() =>
      expect(transferRoot(el)?.querySelector("[data-current-tab]")).toBeNull(),
    );
    expect(pendingCount(el)?.textContent).toContain("0");
  });

  it("accepts from the actual shell with a catalogue zone and reloads its durable pending count", async () => {
    const desk = transfers();
    let accepted = false;
    const catalogue = zoneOffers(
      { menus: [defaultMenu], products: [cafe] },
      "terrace",
      "table_tab",
    );
    catalogue.zones = [
      {
        id: "terrace",
        name: "Terrace",
        departmentId: "restaurant",
        departmentName: "Restaurant",
        serviceMode: "table_tab",
      },
    ];
    const accept = vi.fn(async () => {
      accepted = true;
      return { ...request, status: "accepted" };
    });
    const { el } = await mountApp({
      ...desk.calls,
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue),
      listIncomingDepartmentTransfers: vi.fn(async () => ({
        count: accepted ? 0 : 1,
        requests: accepted ? [] : [request],
      })),
      getDepartmentTransfer: vi.fn().mockResolvedValue(currentDetail),
      acceptDepartmentTransfer: accept,
    });
    await signIn(el);
    await openTransfers(el);
    transferRoot(el)!.querySelector<HTMLElement>("[data-view]")!.click();
    await vi.waitFor(() =>
      expect(transferRoot(el)?.querySelector("[data-current-tab]")).not.toBeNull(),
    );
    transferRoot(el)!.querySelector<HTMLElement>("[data-accept]")!.click();
    await vi.waitFor(() =>
      expect(
        transferRoot(el)?.querySelector<HTMLElement & { disabled: boolean }>("[data-save-transfer]")
          ?.disabled,
      ).toBe(false),
    );
    const field = transferRoot(el)!.querySelector<
      HTMLElement & { options: { value: string; label: string }[] }
    >("[name=zoneId]")!;
    expect(field.options).toEqual([{ value: "terrace", label: "Terrace" }]);
    emit(field, "wt-change", { value: "terrace" });
    await vi.waitFor(() =>
      expect(field.getAttribute("value") ?? (field as unknown as { value: string }).value).toBe(
        "terrace",
      ),
    );
    transferRoot(el)!.querySelector<HTMLElement>("[data-save-transfer]")!.click();
    await vi.waitFor(() =>
      expect(accept).toHaveBeenCalledWith("request-1", {
        revision: 9,
        zoneId: "terrace",
        tableId: null,
      }),
    );
    await vi.waitFor(() => expect(pendingCount(el)?.textContent).toContain("0"));
    expect(transferRoot(el)?.querySelector("[data-current-tab]")).toBeNull();
  });

  it("requests the selected source tab from the actual shell and reloads its durable sender status", async () => {
    const desk = transfers();
    let requested = false;
    const send = vi.fn(async () => {
      requested = true;
      return { ...request, tabId: "selected-tab" };
    });
    const { el } = await mountApp({
      ...desk.calls,
      listDepartmentSentTransfers: vi.fn(async () => ({
        requests: requested ? [{ ...request, tabId: "selected-tab" }] : [],
      })),
      listDepartmentTransferDestinations: vi
        .fn()
        .mockResolvedValue({ destinations: [{ id: "restaurant", name: "Restaurant" }] }),
      requestDepartmentTransfer: send,
    });
    await signIn(el);
    Object.assign(el, { activeTabId: "selected-tab", drill: { kind: "table-order" } });
    el.requestUpdate();
    await flush(el);
    await openTransfers(el);
    const requestButton = transferRoot(el)!.querySelector<HTMLElement>("[data-request-transfer]");
    expect(requestButton).not.toBeNull();
    requestButton!.click();
    await vi.waitFor(() =>
      expect(
        transferRoot(el)?.querySelector<HTMLElement & { disabled: boolean }>("[data-save-transfer]")
          ?.disabled,
      ).toBe(false),
    );
    emit(transferRoot(el)!.querySelector("[name=destinationDepartmentId]")!, "wt-change", {
      value: "restaurant",
    });
    await flush(el);
    transferRoot(el)!.querySelector<HTMLElement>("[data-save-transfer]")!.click();
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith("selected-tab", "restaurant"));
    await vi.waitFor(() =>
      expect(transferRoot(el)?.querySelector("[data-sent=request-1]")).not.toBeNull(),
    );
    expect(transferRoot(el)?.querySelector("[data-request-transfer]")).toBeNull();
  });

  it("does not offer a request for a previously selected tab while another surface is showing", async () => {
    const desk = transfers();
    const { el } = await mountApp(desk.calls);
    await signIn(el);
    Object.assign(el, { activeTabId: "previous-tab" });
    el.requestUpdate();
    await flush(el);
    await openTransfers(el);
    expect(transferRoot(el)?.querySelector("[data-request-transfer]")).toBeNull();
  });

  it("starts a fresh detail read after close and ignores the previous opening's late reply", async () => {
    const desk = transfers();
    let oldReply!: (value: typeof currentDetail) => void;
    const read = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            oldReply = resolve;
          }),
      )
      .mockResolvedValue({
        ...currentDetail,
        tab: { ...currentDetail.tab, label: "Latest lunch" },
      });
    const { el } = await mountApp({ ...desk.calls, getDepartmentTransfer: read });
    await signIn(el);
    await openTransfers(el);
    transferRoot(el)!.querySelector<HTMLElement>("[data-incoming=request-1] [data-view]")!.click();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    transferRoot(el)!.querySelector<HTMLElement>("[data-close-transfers]")!.click();
    await vi.waitFor(() => expect(transferRoot(el)?.querySelector("wt-dialog")).toBeNull());
    expect(read.mock.calls[0]![1].signal.aborted).toBe(true);
    await openTransfers(el);
    transferRoot(el)!.querySelector<HTMLElement>("[data-incoming=request-1] [data-view]")!.click();
    await vi.waitFor(() =>
      expect(transferRoot(el)?.querySelector("[data-current-tab]")?.textContent).toContain(
        "Latest lunch",
      ),
    );
    oldReply(currentDetail);
    await flush(el);
    expect(transferRoot(el)?.querySelector("[data-current-tab]")?.textContent).toContain(
      "Latest lunch",
    );
  });

  it("starts only after authorised sign-in and shows a live persistent pending count", async () => {
    const desk = transfers();
    const { el } = await mountApp(desk.calls);
    await flush(el);
    expect(desk.calls.listIncomingDepartmentTransfers).not.toHaveBeenCalled();
    await signIn(el);
    await vi.waitFor(() => expect(pendingCount(el)?.textContent).toContain("1"));
    expect(desk.calls.listDepartmentSentTransfers).toHaveBeenCalled();
    desk.empty();
    await vi.waitFor(() => expect(pendingCount(el)?.textContent).toContain("0"));
    expect(desk.signals).toHaveLength(1);
  });

  it("does not read or show transfer controls without the person's permission", async () => {
    const desk = transfers();
    const { el } = await mountApp(desk.calls);
    await signIn(el, []);
    expect(pendingCount(el)).toBeNull();
    expect(desk.calls.listDepartmentSentTransfers).not.toHaveBeenCalled();
    expect(desk.signals).toHaveLength(0);
  });

  it("ends its stream on logout and starts a fresh stream on sign-in", async () => {
    const desk = transfers();
    const { el } = await mountApp(desk.calls);
    await signIn(el);
    emit(shell(el)!, "logout");
    expect(desk.signals[0]?.aborted).toBe(true);
    await vi.waitFor(() => expect(lock(el)).not.toBeNull());
    await signIn(el);
    await vi.waitFor(() => expect(desk.signals).toHaveLength(2));
    expect(desk.signals[1]?.aborted).toBe(false);
  });

  it("aborts its stream when detached", async () => {
    const desk = transfers();
    const { el, host } = await mountApp(desk.calls);
    await signIn(el);
    host.remove();
    expect(desk.signals[0]?.aborted).toBe(true);
  });

  it("locks locally when the transfer stream reports a revoked session", async () => {
    const desk = transfers();
    let refuse!: (error: unknown) => void;
    desk.calls.readDepartmentTransferEvents.mockImplementation((_reload, { signal }) => {
      desk.signals.push(signal);
      return new Promise<void>((_resolve, reject) => {
        refuse = reject;
      });
    });
    const { el } = await mountApp(desk.calls);
    await signIn(el);
    expect(desk.signals).toHaveLength(1);
    refuse({ code: "session.expired", status: 401 });
    await vi.waitFor(() => expect(lock(el)).not.toBeNull());
    expect(shell(el)).toBeNull();
    expect(desk.signals[0]?.aborted).toBe(true);
  });

  it("clears the old server's stream and count when the router changes server", async () => {
    const desk = transfers();
    const router = new ServerRouter({
      origin: "https://box.deli.test",
      fetchImpl: vi.fn().mockRejectedValue(new TypeError("Offline")) as typeof fetch,
      storage: { getItem: () => null, setItem: () => undefined },
    });
    const { el } = await mountApp(desk.calls, { router });
    await signIn(el);
    await vi.waitFor(() => expect(pendingCount(el)?.textContent).toContain("1"));
    router.dispatchEvent(new CustomEvent("server-changed", { detail: { from: "a", to: "b" } }));
    await vi.waitFor(() => expect(lock(el)).not.toBeNull());
    expect(desk.signals[0]?.aborted).toBe(true);
    expect(pendingCount(el)).toBeUndefined();
  });

  it.each([true, false])(
    "a profile switch replaces the stream only if it succeeds (%s)",
    async (succeeds) => {
      const desk = transfers();
      const identity = {
        deviceId: "till-dev",
        name: "Till 1",
        formFactor: "till",
        profileId: "counter",
        approvedProfiles: [
          { id: "counter", name: "Counter" },
          { id: "bar", name: "Bar" },
        ],
      };
      const { el } = await mountApp({
        ...desk.calls,
        getDeviceIdentity: vi.fn().mockResolvedValue(identity),
        switchDeviceProfile: succeeds
          ? vi.fn().mockResolvedValue({ activeProfileId: "bar" })
          : vi.fn().mockRejectedValue({ code: "device_profile.not_admitted" }),
      });
      await signIn(el);
      emit(shell(el)!, "open-profile");
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("till-profile-dialog")).not.toBeNull(),
      );
      const dialog = el.shadowRoot!.querySelector("till-profile-dialog")!;
      emit(dialog, "profile-switch", { profileId: "bar" });
      if (succeeds) {
        await vi.waitFor(() => expect(desk.signals).toHaveLength(2));
        expect(desk.signals[0]?.aborted).toBe(true);
        expect(desk.signals[1]?.aborted).toBe(false);
      } else {
        await vi.waitFor(() =>
          expect((dialog as HTMLElement & { notice: unknown }).notice).toEqual({
            code: "device_profile.not_admitted",
          }),
        );
        expect(desk.signals).toHaveLength(1);
        expect(desk.signals[0]?.aborted).toBe(false);
        expect(pendingCount(el)?.textContent).toContain("1");
      }
    },
  );

  it.each([
    "department_transfer.not_allowed",
    "device.forbidden_action",
    "authorization.not_permitted",
  ])("a %s transfer-access refusal keeps its operator signed in", async (code) => {
    const desk = transfers();
    desk.calls.readDepartmentTransferEvents.mockRejectedValue({ code, status: 403 });
    const { el } = await mountApp(desk.calls);
    await signIn(el);
    expect(shell(el)).not.toBeNull();
    expect(lock(el)).toBeNull();
    expect(pendingCount(el)).toBeNull();
  });

  it("stops the old profile's transfer stream before the new profile setup answers", async () => {
    const desk = transfers();
    let setup!: (value: typeof till) => void;
    const getTill = vi
      .fn()
      .mockResolvedValueOnce(till)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setup = resolve;
          }),
      );
    const { el } = await mountApp({
      ...desk.calls,
      getTill,
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "till-dev",
        name: "Till 1",
        formFactor: "till",
        profileId: "counter",
        approvedProfiles: [
          { id: "counter", name: "Counter" },
          { id: "bar", name: "Bar" },
        ],
      }),
      switchDeviceProfile: vi.fn().mockResolvedValue({ activeProfileId: "bar" }),
    });
    await signIn(el);
    emit(shell(el)!, "open-profile");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("till-profile-dialog")).not.toBeNull(),
    );
    emit(el.shadowRoot!.querySelector("till-profile-dialog")!, "profile-switch", {
      profileId: "bar",
    });
    await vi.waitFor(() => expect(getTill).toHaveBeenCalledTimes(2));
    expect(desk.signals).toHaveLength(1);
    expect(desk.signals[0]?.aborted).toBe(true);
    expect(pendingCount(el)).toBeNull();
    setup(till);
    await vi.waitFor(() => expect(desk.signals).toHaveLength(2));
    expect(desk.signals[1]?.aborted).toBe(false);
  });

  it("replaces private transfer state when another sign-in begins without a prior logout", async () => {
    const desk = transfers();
    const { el } = await mountApp(desk.calls);
    await signIn(el);
    emit(shell(el)!, "logged-in", {
      personId: "p2",
      displayName: "Bea",
      permissions: ["sale.take_payment"],
    });
    await vi.waitFor(() => expect(desk.signals).toHaveLength(2));
    expect(desk.signals[0]?.aborted).toBe(true);
    expect(desk.signals[1]?.aborted).toBe(false);
    expect(shell(el)?.shadowRoot?.textContent).toContain("Bea");
  });

  for (const locale of ["en-GB", "es-ES"]) {
    for (const theme of ["light", "dark"]) {
      for (const width of [390, 1280]) {
        it(`shows the pending count accessibly: ${locale}, ${theme}, ${width}`, async () => {
          const desk = transfers();
          await page.viewport(width, 800);
          try {
            const { el, host } = await mountApp({
              ...desk.calls,
              listDefaultZoneOffers: vi.fn().mockResolvedValue(
                zoneOffers(
                  {
                    menus: [defaultMenu],
                    products: [
                      {
                        ...cafe,
                        unit: {
                          id: "00000000-0000-0000-0000-000000000001",
                          name: { en: "each", es: "unidad" },
                          abbreviation: { en: "ea", es: "ud" },
                          precision: 0,
                          hardwareUnit: null,
                        },
                      },
                    ],
                  },
                  "zone-counter",
                ),
              ),
            });
            host.setAttribute("data-theme", theme);
            await signIn(el);
            setLocale(locale);
            await flush(el);
            const pending =
              locale === "en-GB"
                ? "Department transfers (1 pending)"
                : "Traspasos entre departamentos (pendientes: 1)";
            await vi.waitFor(() => expect(pendingCount(el)?.textContent).toContain(pending));
            // On a phone the visible count is in the closed menu; the status region is outside it.
            const status = shell(el)!.shadowRoot!.querySelector<HTMLElement>('[role="status"]')!;
            expect(status.textContent).toContain(pending);
            expect(status.checkVisibility()).toBe(true);
            if (width === 390) {
              const menu =
                shell(el)!.shadowRoot!.querySelector<HTMLElement>('[data-test="more-menu"]')!;
              await userEvent.click(menu.shadowRoot!.querySelector("button")!);
            }
            await vi.waitFor(() => expect(pendingCount(el)!.checkVisibility()).toBe(true));
            expect(pendingCount(el)!.getBoundingClientRect().right).toBeLessThanOrEqual(width);
            await expectNoA11yViolations(host);
            await page.screenshot({
              path: `../__screenshots__/w101-app-count/${locale}-${theme}-${width}.png`,
            });
          } finally {
            setLocale("es-ES");
            await page.viewport(1280, 768);
          }
        });
      }
    }
  }

  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  for (const locale of ["en-GB", "es-ES"]) {
    for (const theme of ["light", "dark"]) {
      for (const width of [1024, 1280]) {
        it(`keeps the counter's top bar to one row, its More icon drawn: ${locale}, ${theme}, ${width}`, async () => {
          const desk = transfers();
          await page.viewport(width, 800);
          try {
            const { el, host } = await mountApp({
              ...desk.calls,
              listDefaultZoneOffers: vi
                .fn()
                .mockResolvedValue(
                  zoneOffers({ menus: [defaultMenu], products: [cafe] }, "zone-counter"),
                ),
            });
            host.setAttribute("data-theme", theme);
            await signIn(el);
            setLocale(locale);
            await flush(el);
            await vi.waitFor(() => expect(pendingCount(el)).not.toBeNull());
            await frame();
            await frame();
            const root = shell(el)!.shadowRoot!;
            const header = root.querySelector("header")!;
            const box = header.getBoundingClientRect();
            const parts = [
              ...header.querySelectorAll<HTMLElement>(
                ":scope > .brand, :scope > .tabs, :scope > .session > *",
              ),
            ]
              .map((part) => part.getBoundingClientRect())
              .filter((r) => r.width > 0 && r.height > 0);
            const centres = parts.map((r) => r.top + r.height / 2);
            expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(2);
            for (const r of parts) {
              expect(r.top).toBeGreaterThanOrEqual(box.top);
              expect(r.bottom).toBeLessThanOrEqual(box.bottom);
              expect(r.right).toBeLessThanOrEqual(box.right);
            }
            expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
            const menu = root.querySelector<HTMLElement>('[data-test="more-menu"]')!;
            expect(menu.getAttribute("icon")).toBe("hamburger");
            const path = menu
              .shadowRoot!.querySelector("wt-icon")!
              .shadowRoot!.querySelector("svg path");
            expect(path?.getAttribute("d")).toBe(
              "M2 3.5H14V4.8H2ZM2 7.35H14V8.65H2ZM2 11.2H14V12.5H2Z",
            );
            expect(path!.getBoundingClientRect().width).toBeGreaterThan(0);
          } finally {
            setLocale("es-ES");
            await page.viewport(1280, 768);
          }
        });
      }
    }
  }

  it("does not publish a pending count on a profile that is not the receiving desk", async () => {
    const desk = transfers();
    desk.calls.listIncomingDepartmentTransfers.mockRejectedValue({
      code: "department_transfer.not_allowed",
      status: 403,
    });
    const { el } = await mountApp(desk.calls);
    await signIn(el);
    expect(pendingCount(el)).toBeNull();
    expect(desk.signals[0]?.aborted).toBe(false);
    expect(desk.calls.listDepartmentSentTransfers).toHaveBeenCalled();
  });

  it("does not publish zero while the first durable incoming read has not answered", async () => {
    const desk = transfers();
    desk.calls.listIncomingDepartmentTransfers.mockImplementation(() => new Promise(() => {}));
    const { el } = await mountApp(desk.calls);
    await signIn(el);
    expect(pendingCount(el)).toBeNull();
    expect(desk.signals[0]?.aborted).toBe(false);
  });

  it("clears a delayed old-session answer before a new operator signs in", async () => {
    const desk = transfers();
    let answer!: (value: { count: number; requests: (typeof request)[] }) => void;
    desk.calls.listIncomingDepartmentTransfers.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { el } = await mountApp(desk.calls);
    await signIn(el);
    emit(shell(el)!, "logout");
    await vi.waitFor(() => expect(lock(el)).not.toBeNull());
    desk.empty();
    await signIn(el);
    expect(desk.calls.listIncomingDepartmentTransfers).toHaveBeenCalledTimes(2);
    answer({ count: 1, requests: [request] });
    await flush(el);
    await vi.waitFor(() => expect(pendingCount(el)?.textContent).toContain("0"));
  });

  it("removes an accepted source tab and refreshes held and floor lists without clearing a different basket", async () => {
    const desk = transfers();
    let accepted = false;
    const held = {
      id: "tab-1",
      orderNumber: 12,
      label: "Lunch",
      itemCount: 1,
      total: "1.50",
      outstanding: "1.50",
      hasPayments: false,
      partyId: null,
      openedAt: "2026-10-07T09:00:00Z",
      signals: [],
    };
    const list = vi.fn(async () => (accepted ? [] : [held]));
    const floor = vi.fn(async () => []);
    const { el } = await mountApp({
      ...desk.calls,
      listDepartmentSentTransfers: vi.fn(async () => ({
        requests: [
          { ...request, status: accepted ? "accepted" : "pending", revision: accepted ? 1 : 0 },
        ],
      })),
      listWorkingOrders: list,
      getTablesState: floor,
    });
    await signIn(el);
    const c = counter(el)!;
    c.store.addProduct(c.products[0]!, "2");
    Object.assign(el, { activeTabId: "tab-1", drill: { kind: "table-order" } });
    el.requestUpdate();
    await flush(el);
    await openTransfers(el);
    const beforeLists = list.mock.calls.length;
    const beforeFloor = floor.mock.calls.length;
    accepted = true;
    desk.refresh();
    await vi.waitFor(() =>
      expect(transferRoot(el)?.querySelector("[data-sent=request-1]")?.textContent).toContain(
        "Traspaso aceptado",
      ),
    );
    expect((el as unknown as { activeTabId?: string }).activeTabId).toBeUndefined();
    expect(transferRoot(el)?.querySelector("[data-request-transfer]")).toBeNull();
    await vi.waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(beforeLists));
    await vi.waitFor(() => expect(floor.mock.calls.length).toBeGreaterThan(beforeFloor));
    expect(c.store.lines).toHaveLength(1);
    expect(c.store.lines[0]!.quantity).toBe("2");
    expect(c.store.total).toBe("3.00");
    expect(c.heldOrders).toEqual([]);
  });

  it("offers a transfer of a retrieved named counter tab and removes only that accepted basket", async () => {
    const desk = transfers();
    let accepted = false;
    const send = vi.fn(async () => ({ ...request, tabId: "counter-tab" }));
    const { el } = await mountApp({
      ...desk.calls,
      listDepartmentSentTransfers: vi.fn(async () => ({
        requests: accepted
          ? [{ ...request, tabId: "counter-tab", status: "accepted", revision: 1 }]
          : [],
      })),
      listDepartmentTransferDestinations: vi.fn(async () => ({
        destinations: [{ id: "restaurant", name: "Restaurant" }],
      })),
      requestDepartmentTransfer: send,
    });
    await signIn(el);
    const c = counter(el)!;
    c.store.loadFrom(
      "counter-tab",
      [{ product: c.products[0]!, quantity: "2" }],
      "Pablo's lunch",
      7,
    );
    await flush(el);
    await openTransfers(el);
    expect(transferRoot(el)?.textContent).toContain("Pablo's lunch");
    const button = transferRoot(el)?.querySelector<HTMLElement>("[data-request-transfer]");
    expect(button).not.toBeNull();
    button!.click();
    await vi.waitFor(() =>
      expect(
        transferRoot(el)?.querySelector<HTMLElement & { disabled: boolean }>("[data-save-transfer]")
          ?.disabled,
      ).toBe(false),
    );
    emit(transferRoot(el)!.querySelector("[name=destinationDepartmentId]")!, "wt-change", {
      value: "restaurant",
    });
    await flush(el);
    transferRoot(el)!.querySelector<HTMLElement>("[data-save-transfer]")!.click();
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith("counter-tab", "restaurant"));
    accepted = true;
    desk.refresh();
    await vi.waitFor(() => expect(c.store.persisted).toBe(false));
    expect(c.store.lines).toEqual([]);
    expect(c.store.id).not.toBe("counter-tab");
    expect(transferRoot(el)?.querySelector("[data-request-transfer]")).toBeNull();
  });

  it("retires an open source basket after sign-in even when its acceptance is outside recent department history", async () => {
    const desk = transfers();
    const { el } = await mountApp({
      ...desk.calls,
      listDepartmentSentTransfers: vi.fn(async () => ({ requests: [] })),
      listSentDepartmentTransfers: vi.fn(async () => ({
        requests: [
          {
            ...request,
            tabId: "counter-tab",
            status: "accepted",
            revision: 1,
            currentDepartmentId: "restaurant",
          },
        ],
      })),
    });
    await signIn(el);
    const c = counter(el)!;
    c.store.loadFrom("counter-tab", [{ product: c.products[0]!, quantity: "2" }], "Lunch", 7);
    await flush(el);
    emit(shell(el)!, "logout");
    await vi.waitFor(() => expect(lock(el)).not.toBeNull());
    await signIn(el);
    expect(c.store.persisted).toBe(false);
    expect(c.store.lines).toEqual([]);
    expect(c.store.id).not.toBe("counter-tab");
  });

  it("keeps a returned source basket when monitor restart reads its old acceptance", async () => {
    const desk = transfers();
    let historical = false;
    const { el } = await mountApp({
      ...desk.calls,
      listDepartmentSentTransfers: vi.fn(async () => ({
        requests: historical
          ? [
              {
                ...request,
                tabId: "counter-tab",
                status: "accepted",
                revision: 1,
                currentDepartmentId: "deli",
              },
            ]
          : [],
      })),
    });
    await signIn(el);
    const c = counter(el)!;
    c.store.loadFrom(
      "counter-tab",
      [{ product: c.products[0]!, quantity: "2" }],
      "Returned lunch",
      9,
    );
    emit(shell(el)!, "logout");
    await vi.waitFor(() => expect(lock(el)).not.toBeNull());
    historical = true;
    await signIn(el);
    await vi.waitFor(() =>
      expect(privateState<{ sent: unknown[] }>(el, "transferSnapshot").sent).toHaveLength(1),
    );
    expect(c.store.persisted).toBe(true);
    expect(c.store.id).toBe("counter-tab");
    expect(c.store.lines[0]?.quantity).toBe("2");
  });

  it.each([
    ["en-GB", "light", 390],
    ["en-GB", "light", 1280],
    ["en-GB", "dark", 390],
    ["en-GB", "dark", 1280],
    ["es-ES", "light", 390],
    ["es-ES", "light", 1280],
    ["es-ES", "dark", 390],
    ["es-ES", "dark", 1280],
  ] as const)(
    "keeps unsent counter edits as a read-only local copy in %s %s at %s until explicitly dismissed after transfer",
    async (locale, theme, width) => {
      const desk = transfers();
      let accepted = false;
      const { el, host } = await mountApp({
        ...desk.calls,
        listDepartmentSentTransfers: vi.fn(async () => ({
          requests: [
            {
              ...request,
              tabId: "counter-tab",
              status: accepted ? "accepted" : "pending",
              revision: accepted ? 1 : 0,
              currentDepartmentId: accepted ? "restaurant" : "deli",
            },
          ],
        })),
      });
      await signIn(el);
      setLocale(locale);
      host.dataset.theme = theme;
      await page.viewport(width, 900);
      host.style.width = `${width}px`;
      await flush(el);
      const c = counter(el)!;
      c.store.loadFrom(
        "counter-tab",
        [
          {
            product: c.products[0]!,
            quantity: "2",
          },
        ],
        "Lunch",
        7,
      );
      c.store.addProduct(c.products[0]!, "1", {
        note: "No sugar",
        extras: [
          { listId: "milk-list", productId: "milk", name: "Milk", price: "0.50", quantity: 1 },
        ],
        optionSnapshots: [
          {
            listName: { "en-GB": "Blend", "es-ES": "Blend" },
            listCustomerName: null,
            listKitchenName: null,
            labelName: { "en-GB": "Decaf", "es-ES": "Decaf" },
            labelCustomerName: null,
            labelKitchenName: null,
          },
        ],
      });
      expect(c.store.dirty).toBe(true);
      accepted = true;
      desk.refresh();
      await vi.waitFor(() => expect(c.store.persisted).toBe(false));
      const copy = () => el.shadowRoot!.querySelector<HTMLElement>("[data-transfer-local-copy]");
      expect(copy()).not.toBeNull();
      expect(copy()?.textContent).toContain("Lunch");
      expect(copy()?.textContent).toContain("No sugar");
      expect(copy()?.textContent).toContain("Milk");
      expect(copy()?.textContent).toContain("Decaf");
      expect(copy()?.querySelectorAll("[data-local-line]")).toHaveLength(2);
      expect(copy()?.querySelectorAll("[data-local-line]")[1]?.textContent).toContain("1");
      const native = copy()?.shadowRoot?.querySelector("dialog");
      expect(native?.open).toBe(true);
      await expectNoA11yViolations(copy()!);
      await page.screenshot({
        path: `../__screenshots__/w101-local-copy/${locale}-${theme}-${width}.png`,
      });
      await userEvent.keyboard("{Escape}");
      expect(copy()).not.toBeNull();
      if (locale === "en-GB" && theme === "light" && width === 390) {
        emit(shell(el)!, "logout");
        await vi.waitFor(() => expect(lock(el)).not.toBeNull());
        await signIn(el);
        await flush(el);
        expect(copy()?.textContent).toContain("No sugar");
      }
      const dismiss = copy()!.querySelector<HTMLElement>("[data-dismiss-local-copy]")!;
      const bounds = dismiss.shadowRoot!.querySelector("button")!.getBoundingClientRect();
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      await userEvent.click(dismiss);
      await flush(el);
      expect(copy()).toBeNull();
      expect(c.store.id).not.toBe("counter-tab");
      expect(c.store.lines).toEqual([]);
      setLocale("es-ES");
      await page.viewport(1280, 900);
    },
  );

  it("retains an unsaved label and its recorded extras in the transferred local copy", async () => {
    const desk = transfers();
    let accepted = false;
    const { el } = await mountApp({
      ...desk.calls,
      listDepartmentSentTransfers: vi.fn(async () => ({
        requests: [
          {
            ...request,
            tabId: "counter-tab",
            status: accepted ? "accepted" : "pending",
            revision: accepted ? 1 : 0,
            currentDepartmentId: accepted ? "restaurant" : "deli",
          },
        ],
      })),
    });
    await signIn(el);
    const c = counter(el)!;
    c.store.loadFrom(
      "counter-tab",
      [
        {
          product: c.products[0]!,
          quantity: "2",
          notOfferedExtras: [
            { productId: "cream", name: "Retired cream", price: "0.50", quantity: 1 },
          ],
        },
      ],
      "Lunch",
      7,
    );
    await flush(el);
    c.store.label = "Lunch for Ana";
    await flush(el);
    expect(c.store.dirty).toBe(false);
    accepted = true;
    desk.refresh();
    await vi.waitFor(() => expect(c.store.persisted).toBe(false));
    const copy = el.shadowRoot!.querySelector("[data-transfer-local-copy]");
    expect(copy).not.toBeNull();
    expect(copy?.textContent).toContain("Lunch for Ana");
    expect(copy?.textContent).toContain("Retired cream");
  });

  it("retains an unsent standalone table draft for review when its tab is transferred", async () => {
    const desk = transfers();
    let accepted = false;
    const { el } = await mountApp({
      ...desk.calls,
      listDepartmentSentTransfers: vi.fn(async () => ({
        requests: [
          {
            ...request,
            status: accepted ? "accepted" : "pending",
            revision: accepted ? 1 : 0,
            currentDepartmentId: accepted ? "restaurant" : "deli",
          },
        ],
      })),
    });
    await signIn(el);
    const product = counter(el)!.products[0]!;
    Object.assign(el, { activeTabId: "tab-1", drill: { kind: "table-order" } });
    el.requestUpdate();
    await flush(el);
    const table = el.shadowRoot!.querySelector<
      HTMLElement & { draftStore: import("./state/working-order.js").WorkingOrderStore }
    >("till-table-order-screen")!;
    expect(table).not.toBeNull();
    Object.assign(table, { menus: counter(el)!.menus });
    await flush(el);
    table.draftStore.addProduct(product, "1", { note: "Table unsent edit" });
    accepted = true;
    desk.refresh();
    await vi.waitFor(() =>
      expect(privateState<string | undefined>(el, "activeTabId")).toBeUndefined(),
    );
    const copy = el.shadowRoot!.querySelector("[data-transfer-local-copy]");
    expect(copy).not.toBeNull();
    expect(copy?.textContent).toContain("Table unsent edit");
    expect(table.draftStore.lines).toEqual([]);
  });

  it("refreshes the receiving ordinary lists when a durable request leaves the queue", async () => {
    const desk = transfers();
    let received = false;
    const row = {
      id: "tab-1",
      orderNumber: 12,
      label: "Lunch",
      itemCount: 1,
      total: "1.50",
      outstanding: "1.50",
      hasPayments: false,
      partyId: null,
      openedAt: "2026-10-07T09:00:00Z",
      signals: [],
    };
    const list = vi.fn(async () => (received ? [row] : []));
    const floor = vi.fn(async () => []);
    const { el } = await mountApp({
      ...desk.calls,
      listWorkingOrders: list,
      getTablesState: floor,
    });
    await signIn(el);
    await vi.waitFor(() => expect(pendingCount(el)?.textContent).toContain("1"));
    const beforeLists = list.mock.calls.length;
    const beforeFloor = floor.mock.calls.length;
    received = true;
    desk.empty();
    await vi.waitFor(() => expect(pendingCount(el)?.textContent).toContain("0"));
    await vi.waitFor(() => expect(counter(el)?.heldOrders).toEqual([row]));
    expect(list.mock.calls.length).toBeGreaterThan(beforeLists);
    await vi.waitFor(() => expect(floor.mock.calls.length).toBeGreaterThan(beforeFloor));
  });

  it("ignores a transfer list refresh from the API client that has been replaced", async () => {
    const desk = transfers();
    let received = false;
    let answer!: (rows: unknown[]) => void;
    const list = vi.fn(async () => {
      if (!received) return [];
      return new Promise<unknown[]>((resolve) => {
        answer = resolve;
      });
    });
    const { el } = await mountApp({ ...desk.calls, listWorkingOrders: list });
    await signIn(el);
    await vi.waitFor(() => expect(pendingCount(el)?.textContent).toContain("1"));
    received = true;
    desk.empty();
    await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
    el.api = stubApi({
      listIncomingDepartmentTransfers: vi.fn(async () => ({ count: 0, requests: [] })),
      listDepartmentSentTransfers: vi.fn(async () => ({ requests: [] })),
      readDepartmentTransferEvents: desk.calls.readDepartmentTransferEvents,
    });
    await flush(el);
    answer([
      {
        id: "old-tab",
        orderNumber: 12,
        label: "Old client",
        itemCount: 1,
        total: "1.50",
        outstanding: "1.50",
        hasPayments: false,
        partyId: null,
        openedAt: "2026-10-07T09:00:00Z",
        signals: [],
      },
    ]);
    await flush(el);
    expect(counter(el)?.heldOrders).toEqual([]);
  });

  it("does not reopen a transferred source tab from a retrieval already in flight", async () => {
    const desk = transfers();
    let accepted = false;
    let answer!: (value: unknown) => void;
    const retrieve = vi.fn(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { el } = await mountApp({
      ...desk.calls,
      listDepartmentSentTransfers: vi.fn(async () => ({
        requests: [
          { ...request, status: accepted ? "accepted" : "pending", revision: accepted ? 1 : 0 },
        ],
      })),
      retrieveWorkingOrder: retrieve,
    });
    await signIn(el);
    const c = counter(el)!;
    emit(c, "retrieve-order", { id: "tab-1" });
    await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
    accepted = true;
    desk.refresh();
    await vi.waitFor(() =>
      expect(
        transferPanel(el) as unknown as { snapshot: { sent: { status: string }[] } },
      ).toHaveProperty("snapshot.sent.0.status", "accepted"),
    );
    answer({
      id: "tab-1",
      orderNumber: 12,
      label: "Moved lunch",
      revision: 7,
      lines: [{ productId: "cafe", quantity: "1.000", product: cafe }],
    });
    await flush(el);
    expect(c.store.persisted).toBe(false);
    expect(c.store.id).not.toBe("tab-1");
    expect(c.store.lines).toEqual([]);
  });

  it("keeps a different tab's retrieval usable when a source transfer is accepted", async () => {
    const desk = transfers();
    let accepted = false;
    let answer!: (value: unknown) => void;
    const { el } = await mountApp({
      ...desk.calls,
      listDepartmentSentTransfers: vi.fn(async () => ({
        requests: [
          { ...request, status: accepted ? "accepted" : "pending", revision: accepted ? 1 : 0 },
        ],
      })),
      retrieveWorkingOrder: vi.fn(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      ),
    });
    await signIn(el);
    const c = counter(el)!;
    emit(c, "retrieve-order", { id: "different-tab" });
    await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
    accepted = true;
    desk.refresh();
    await vi.waitFor(() =>
      expect(
        transferPanel(el) as unknown as { snapshot: { sent: { status: string }[] } },
      ).toHaveProperty("snapshot.sent.0.status", "accepted"),
    );
    answer({
      id: "different-tab",
      orderNumber: 13,
      label: "Different lunch",
      revision: 7,
      lines: [{ productId: "cafe", quantity: "2.000", product: cafe }],
    });
    await flush(el);
    expect(c.store.persisted).toBe(true);
    expect(c.store.id).toBe("different-tab");
    expect(c.store.lines).toHaveLength(1);
    expect(c.store.total).toBe("3.00");
  });
});
