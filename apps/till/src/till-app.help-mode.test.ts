import { userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { currentHelpMode, setHelpMode, type WtRowActions } from "@waitron/ui";
import { cleanupWidgets, mountWidget, servedMenus } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { deviceZonesFixture } from "../test/device-zones.js";
import { ServerRouter } from "./api/server-router.js";
import "./till-app.js";
import type { TillApp } from "./till-app.js";
import type { TillApi, ZoneOfferCatalogue } from "./api/client.js";
import type { TillShell } from "./widgets/till-shell.js";

const originalLocale = currentLocale();

afterEach(() => {
  setHelpMode(false);
  cleanupWidgets();
  setLocale(originalLocale);
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

function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    getTill: vi.fn().mockResolvedValue(counterTill),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi
      .fn()
      .mockResolvedValue({ deviceId: "till-dev", name: "Till 1", formFactor: "till" }),
    reportBattery: vi.fn().mockResolvedValue(undefined),
    listStaff: vi.fn().mockResolvedValue([]),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
      loginDefault: "es-ES",
    }),
    joinStatus: vi.fn().mockResolvedValue({ status: "pending" }),
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(undefined, [])),
    getDeviceStationScreen: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    listDefaultZoneOffers: vi.fn().mockResolvedValue(counterOffers),
    listZoneOffers: vi.fn().mockResolvedValue(counterOffers),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
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

async function flush(el: TillApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

const lock = (el: TillApp) => el.shadowRoot!.querySelector("till-lock-screen");
const shell = (el: TillApp) => el.shadowRoot!.querySelector<TillShell>("till-shell");

async function mount(overrides: Record<string, unknown> = {}, props: Partial<TillApp> = {}) {
  const { el } = await mountWidget<TillApp>("till-app", { api: stubApi(overrides), ...props });
  await vi.waitFor(() => expect(lock(el)).not.toBeNull());
  await flush(el);
  return el;
}

async function signIn(el: TillApp, personId = "p1", displayName = "Ana"): Promise<TillShell> {
  emit(lock(el)!, "logged-in", { personId, displayName, permissions: [] });
  await vi.waitFor(() => expect(shell(el)).not.toBeNull());
  await flush(el);
  const bar = shell(el)!;
  await bar.updateComplete;
  return bar;
}

function switchButton(bar: TillShell): HTMLButtonElement {
  return bar
    .shadowRoot!.querySelector<HTMLElement>("[data-test=help-switch]")!
    .shadowRoot!.querySelector("button")!;
}

async function turnHelpOn(bar: TillShell): Promise<void> {
  await userEvent.click(switchButton(bar));
  expect(currentHelpMode()).toBe(true);
}

async function logOutFromMore(el: TillApp, bar: TillShell): Promise<void> {
  const more = bar.shadowRoot!.querySelector<WtRowActions>("[data-test=more-menu]")!;
  await more.updateComplete;
  await userEvent.click(more.shadowRoot!.querySelector("button")!);
  await userEvent.click(bar.shadowRoot!.querySelector<HTMLElement>("wt-button.logout")!);
  await vi.waitFor(() => expect(lock(el)).not.toBeNull());
}

it("logging out from More turns help off", async () => {
  const el = await mount();
  const bar = await signIn(el);
  await turnHelpOn(bar);
  await logOutFromMore(el, bar);
  expect(currentHelpMode()).toBe(false);
});

it("the idle logout turns help off", async () => {
  const activity = fakeSessionActivity();
  const el = await mount({}, { sessionActivity: activity as never });
  const bar = await signIn(el);
  await turnHelpOn(bar);
  (activity.configure.mock.calls.at(-1)![0] as { onIdle: () => void }).onIdle();
  await vi.waitFor(() => expect(lock(el)).not.toBeNull());
  expect(currentHelpMode()).toBe(false);
});

it("moving to another server turns help off", async () => {
  const router = new ServerRouter({
    origin: "https://box.deli.test",
    fetchImpl: vi.fn().mockRejectedValue(new TypeError("Offline")) as typeof fetch,
    storage: { getItem: () => null, setItem: () => undefined },
  });
  const el = await mount({}, { router });
  const bar = await signIn(el);
  await turnHelpOn(bar);
  router.dispatchEvent(new CustomEvent("server-changed", { detail: { from: "a", to: "b" } }));
  await vi.waitFor(() => expect(lock(el)).not.toBeNull());
  expect(currentHelpMode()).toBe(false);
});

it("the next person signs in with help off", async () => {
  const el = await mount();
  const first = await signIn(el);
  await turnHelpOn(first);
  await logOutFromMore(el, first);
  const next = await signIn(el, "p2", "Bea");
  expect(next.shadowRoot!.textContent).toContain("Bea");
  expect(switchButton(next).getAttribute("aria-pressed")).toBe("false");
  expect(currentHelpMode()).toBe(false);
});

it("help stays on between Counter and Floor", async () => {
  const el = await mount({
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(["zone-counter"], ["zone-floor"])),
  });
  const bar = await signIn(el);
  await turnHelpOn(bar);
  const tab = (name: string) =>
    [...bar.shadowRoot!.querySelectorAll<HTMLButtonElement>("button.tab")].find(
      (button) => button.textContent!.trim() === name,
    )!;
  await vi.waitFor(() => expect(tab("Floor")).toBeDefined());
  await userEvent.click(tab("Floor"));
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-floor-screen")).not.toBeNull());
  expect(currentHelpMode()).toBe(true);
  await userEvent.click(tab("Counter"));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("till-counter-screen")).not.toBeNull(),
  );
  expect(currentHelpMode()).toBe(true);
  expect(switchButton(shell(el)!).getAttribute("aria-pressed")).toBe("true");
});

it("a profile switch keeps help on", async () => {
  const getTill = vi.fn().mockResolvedValue(counterTill);
  const el = await mount({
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
  const bar = await signIn(el);
  await turnHelpOn(bar);
  emit(bar, "open-profile");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("till-profile-dialog")).not.toBeNull(),
  );
  const calls = getTill.mock.calls.length;
  emit(el.shadowRoot!.querySelector("till-profile-dialog")!, "profile-switch", {
    profileId: "bar",
  });
  await vi.waitFor(() => expect(getTill.mock.calls.length).toBeGreaterThan(calls));
  await vi.waitFor(() => expect(shell(el)).not.toBeNull());
  await flush(el);
  expect(lock(el)).toBeNull();
  expect(currentHelpMode()).toBe(true);
  expect(switchButton(shell(el)!).getAttribute("aria-pressed")).toBe("true");
});
