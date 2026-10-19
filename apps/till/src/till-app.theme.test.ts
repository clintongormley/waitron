import { commands, userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import {
  chooseTheme,
  leaveCoordinatorFor,
  startThemeChoice,
  THEME_STORAGE_KEY,
  type WtRowActions,
  type WtThemeChooser,
} from "@waitron/ui";
import { cleanupWidgets, mountWidget, servedMenus } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { themeLabels } from "./widgets/theme-chooser.js";
import { deviceZonesFixture } from "../test/device-zones.js";
import "./till-app.js";
import type { TillApp } from "./till-app.js";
import type { TillApi, TillProduct, ZoneOfferCatalogue } from "./api/client.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillShell } from "./widgets/till-shell.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateColorScheme: (colorScheme: "light" | "dark" | null) => Promise<void>;
  }
}

const originalLocale = currentLocale();

afterEach(async () => {
  cleanupWidgets();
  setLocale(originalLocale);
  chooseTheme("device");
  localStorage.removeItem(THEME_STORAGE_KEY);
  await commands.emulateColorScheme(null);
});

function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    getTill: vi.fn().mockResolvedValue({
      locale: "es-ES",
      venueName: "Bar Pepe",
      nif: "B12345678",
      orderFlow: "prepay",
      formFactor: "till",
      capabilities: [],
    }),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi
      .fn()
      .mockResolvedValue({ deviceId: "till-dev", name: "Till 1", formFactor: "till" }),
    reportBattery: vi.fn().mockResolvedValue(undefined),
    listStaff: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ana" }]),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
      loginDefault: "es-ES",
    }),
    joinStatus: vi.fn().mockResolvedValue({ status: "pending" }),
    ...overrides,
  } as unknown as TillApi;
}

async function flush(el: TillApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const bg = (host: HTMLElement) => getComputedStyle(host).getPropertyValue("--wt-color-bg").trim();
const DARK_BG = "#101216";

async function pickDarkOn(screenTag: string, overrides: Record<string, unknown> = {}) {
  await commands.emulateColorScheme("light");
  const { el, host } = await mountWidget<TillApp>("till-app", { api: stubApi(overrides) });
  startThemeChoice(host);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector(screenTag)).not.toBeNull());
  await flush(el);
  const screen = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    screenTag,
  )!;
  await screen.updateComplete;
  const chooser = () =>
    screen.shadowRoot!.querySelector<WtThemeChooser>("[data-test=theme-chooser]")!;
  chooser().shadowRoot!.querySelector<HTMLElement>("[data-test=theme-trigger]")!.click();
  await chooser().updateComplete;
  chooser().shadowRoot!.querySelector<HTMLElement>("[data-test=theme-dark]")!.click();
  await vi.waitFor(() => expect(bg(host)).toBe(DARK_BG));
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  await screen.updateComplete;
  expect(chooser().active).toBe("dark");
}

it("a pick on the sign-in screen turns the till dark and keeps it, with nobody signed in", async () => {
  await pickDarkOn("till-lock-screen");
});

it("a pick on the join screen does the same", async () => {
  await pickDarkOn("till-enrol-screen", {
    getDeviceIdentity: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
  });
});

const counterTill = {
  locale: "en",
  invoiceLocale: "es-ES",
  venueName: "Bar Pepe",
  nif: "B12345678",
  orderFlow: "prepay" as const,
  receiptPrintMode: "auto" as const,
  bumpMode: "line" as const,
  fireControl: "waiter" as const,
  courses: [],
  cardProvider: "none" as const,
  tipsEnabled: false,
  formFactor: "till" as const,
  capabilities: [],
  inactivityTimeoutSeconds: null,
  nodeId: "n1",
  servers: [],
};

const counterOffers: ZoneOfferCatalogue = {
  service: {
    open: true,
    zoneOpen: true,
    periodName: null,
    periodOccurrenceKey: null,
    keepOpen: null,
    zoneKeepOpen: null,
  },
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

const cafe: TillProduct = {
  id: "cafe",
  menuItemId: "mi-cafe",
  catalogueId: "cat-default",
  name: "Café",
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

it("picking a theme in the person's menu with an unsent order open asks nothing and keeps the order", async () => {
  await commands.emulateColorScheme("light");
  const { el, host } = await mountWidget<TillApp>("till-app", {
    api: stubApi({
      getTill: vi.fn().mockResolvedValue(counterTill),
      getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(undefined, [])),
      getDeviceStationScreen: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
      listStaff: vi.fn().mockResolvedValue([]),
      listDefaultZoneOffers: vi.fn().mockResolvedValue(counterOffers),
      listZoneOffers: vi.fn().mockResolvedValue(counterOffers),
      setServiceZone: vi.fn(),
      listWorkingOrders: vi.fn().mockResolvedValue([]),
      listCounterWaiting: vi.fn().mockResolvedValue([]),
      getTablesState: vi.fn().mockResolvedValue([]),
      listZones: vi.fn().mockResolvedValue([]),
      listStations: vi.fn().mockResolvedValue([]),
      getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    }),
  });
  startThemeChoice(host);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull());
  await flush(el);
  el.shadowRoot!.querySelector("till-lock-screen")!.dispatchEvent(
    new CustomEvent("logged-in", {
      detail: { personId: "p1", displayName: "Ana", permissions: [] },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("till-counter-screen")).not.toBeNull(),
  );
  await flush(el);
  const counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
  counter.store.addProduct(cafe, "1");
  // The counter basket is not a scope the language change asks about, so a staged edit stands
  // in for the unsaved work it does ask about.
  const coordinator = leaveCoordinatorFor(counter)!;
  let staged = "Original";
  const scope = coordinator.register({
    id: counter,
    current: () => staged,
    snapshot: (v) => v,
    equal: (a, b) => a === b,
    restore: (v) => {
      staged = v;
    },
  });
  staged = "Typed";
  scope.changed();
  await flush(el);
  const shell = el.shadowRoot!.querySelector<TillShell>("till-shell")!;
  await shell.updateComplete;
  expect(shell.shadowRoot!.querySelector("header wt-theme-chooser")).toBeNull();
  const choice = (name: string) =>
    shell.shadowRoot!.querySelector<HTMLElement>(`[data-test=theme-choice-${name}]`)!;
  const menu = choice("dark").closest<WtRowActions>("wt-row-actions")!;
  await menu.updateComplete;
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  await userEvent.click(choice("dark"));
  await vi.waitFor(() => expect(bg(host)).toBe(DARK_BG));
  await shell.updateComplete;
  expect(choice("dark").getAttribute("aria-pressed")).toBe("true");
  expect(choice("device").getAttribute("aria-pressed")).toBe("false");
  await flush(el);
  const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await question.updateComplete;
  expect(question.open).toBe(false);
  expect(el.shadowRoot!.querySelector("till-counter-screen")).toBe(counter);
  expect(counter.store.lines.map((line) => line.product.id)).toEqual(["cafe"]);
  expect(staged).toBe("Typed");
  expect(coordinator.isDirty()).toBe(true);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

  shell.shadowRoot!.querySelector("wt-language-chooser")!.dispatchEvent(
    new CustomEvent("wt-locale-selected", {
      detail: { code: "es-ES" },
      bubbles: true,
      composed: true,
    }),
  );
  await expect.poll(() => question.open).toBe(true);
  expect(counter.store.lines.map((line) => line.product.id)).toEqual(["cafe"]);
  expect(staged).toBe("Typed");
});

it("the theme chooser's labels stay the same object until the language changes", () => {
  setLocale("en-GB");
  const english = themeLabels();
  expect(themeLabels()).toBe(english);
  setLocale("es-ES");
  expect(themeLabels()).not.toBe(english);
  expect(themeLabels().theme).toBe("Tema");
});
