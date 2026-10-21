import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  applyTokens,
  followVenueTheme,
  startVenueTheme,
  VENUE_THEME_STORAGE_KEY,
} from "@waitron/ui";
import { LiveConnection, LiveData } from "@waitron/dashboard-kit";
import {
  FIXTURE_ANSWER,
  FIXTURE_LIGHT_BG,
  WAITRON_LIGHT_BG,
} from "@waitron/ui/test/venue-theme-fixture.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { DashboardApp } from "./dashboard-app.js";
import type { DashboardApi } from "./api/client.js";
import { diag } from "./diagnostics.js";
import { setLocale } from "./i18n/t.js";

const SECOND_ANSWER = {
  hash: "second-fixture-hash",
  css: FIXTURE_ANSWER.css.replace(FIXTURE_LIGHT_BG, "#fff3f3"),
  logo: null,
};

const rejecting = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("Failed to fetch")));

const bg = (): string =>
  getComputedStyle(document.documentElement).getPropertyValue("--wt-color-bg").trim();

const meResponse = {
  personId: "p1",
  role: "manager",
  email: "manager@example.com",
  locale: null,
  venueLocale: "es-ES",
  sessionDefault: "es-ES",
  venueName: "Deli Test SL",
  onboardingIntent: "prepare",
  permissions: [],
  modules: [],
};

function stubApi(overrides: Record<string, unknown> = {}) {
  const api = {
    liveData: new LiveData(),
    getGoogleConfig: async () => ({ configured: false }),
    getLocales: async () => ({
      locales: [{ code: "es-ES", label: "Spanish" }],
      venueDefault: "es-ES",
      loginDefault: "es-ES",
      venueName: "Deli Test SL",
      onboardingIntent: "prepare",
    }),
    getMe: vi.fn().mockResolvedValue({ ...meResponse }),
    getVenueTheme: vi.fn().mockResolvedValue(FIXTURE_ANSWER),
    getContentLanguages: async () => ({ defaultLanguage: "es", languages: ["es"] }),
    listAlerts: async () => ({ visible: false, alerts: [] }),
    getSalesOverview: async () => ({
      businessDay: "2026-08-30",
      takings: { tenderTotal: "0.00", tipTotal: "0.00", grossTotal: "0.00" },
      counts: { sales: 0, corrections: 0, voids: 0 },
      openTables: { open: 0, total: 0 },
      topSellers: [],
    }),
    getOverdueOrders: async () => ({ orders: [] }),
    listMyShifts: async () => [],
    listMySwaps: async () => [],
    listMyAbsences: async () => [],
    getStaffRoster: async () => [],
    ...overrides,
  };
  return api as typeof api & DashboardApi;
}

async function flush(el: DashboardApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function mount(api: DashboardApi, liveUpdates?: LiveConnection): Promise<DashboardApp> {
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, liveUpdates });
  await flush(el);
  return el;
}

beforeEach(() => {
  applyTokens(document.documentElement);
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  startVenueTheme(document.documentElement, { fetchImpl: rejecting });
});

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  startVenueTheme(document.documentElement, { fetchImpl: rejecting });
  sessionStorage.clear();
  setLocale("es-ES");
});

it("a signed-in shell paints the theme in use", async () => {
  const api = stubApi();
  await mount(api);
  await vi.waitFor(() => expect(bg()).toBe(FIXTURE_LIGHT_BG));
  expect(api.getVenueTheme).toHaveBeenCalledOnce();
});

it("a change to the custom themes repaints without a reload", async () => {
  const api = stubApi();
  await mount(api);
  await vi.waitFor(() => expect(bg()).toBe(FIXTURE_LIGHT_BG));
  api.getVenueTheme.mockResolvedValue(SECOND_ANSWER);
  api.liveData.invalidate([{ type: "custom_themes" }]);
  await vi.waitFor(() => expect(bg()).toBe("#fff3f3"));
});

it("a change elsewhere reads nothing", async () => {
  const api = stubApi();
  const el = await mount(api);
  await vi.waitFor(() => expect(bg()).toBe(FIXTURE_LIGHT_BG));
  const calls = api.getVenueTheme.mock.calls.length;
  api.liveData.invalidate([{ type: "incidents" }]);
  await flush(el);
  await flush(el);
  expect(api.getVenueTheme).toHaveBeenCalledTimes(calls);
});

it("a staff session follows the theme too", async () => {
  const api = stubApi({ getMe: vi.fn().mockResolvedValue({ ...meResponse, role: "staff" }) });
  await mount(api);
  await vi.waitFor(() => expect(bg()).toBe(FIXTURE_LIGHT_BG));
  expect(api.getVenueTheme).toHaveBeenCalled();
});

it("a signed-out shell does not read it", async () => {
  const api = stubApi({
    getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
  });
  const el = await mount(api);
  await expect.poll(() => el.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull();
  await flush(el);
  expect(api.getVenueTheme).not.toHaveBeenCalled();
  expect(bg()).not.toBe(FIXTURE_LIGHT_BG);
});

it("after returning to sign-in, changes read nothing", async () => {
  const api = stubApi();
  const el = await mount(api);
  await vi.waitFor(() => expect(bg()).toBe(FIXTURE_LIGHT_BG));
  window.dispatchEvent(
    new CustomEvent("waitron-session-invalid", { detail: { code: "management_session.expired" } }),
  );
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull();
  const calls = api.getVenueTheme.mock.calls.length;
  api.liveData.invalidate([{ type: "custom_themes" }]);
  await flush(el);
  await flush(el);
  expect(api.getVenueTheme).toHaveBeenCalledTimes(calls);
});

it("a refresh still in flight when the session ends does not repaint the page", async () => {
  const api = stubApi();
  const el = await mount(api);
  await vi.waitFor(() => expect(bg()).toBe(FIXTURE_LIGHT_BG));
  let answer!: (value: typeof SECOND_ANSWER) => void;
  api.getVenueTheme.mockImplementation(
    () => new Promise<typeof SECOND_ANSWER>((resolve) => (answer = resolve)),
  );
  const calls = api.getVenueTheme.mock.calls.length;
  api.liveData.invalidate([{ type: "custom_themes" }]);
  await vi.waitFor(() => expect(api.getVenueTheme).toHaveBeenCalledTimes(calls + 1));
  window.dispatchEvent(
    new CustomEvent("waitron-session-invalid", { detail: { code: "management_session.expired" } }),
  );
  await el.updateComplete;
  answer(SECOND_ANSWER);
  await flush(el);
  await flush(el);
  expect(bg()).toBe(FIXTURE_LIGHT_BG);
});

it("a failed first read keeps the page and is recorded", async () => {
  const record = vi.spyOn(diag, "record");
  const api = stubApi({
    getVenueTheme: vi.fn().mockRejectedValue({ code: "connection.failed" }),
  });
  await mount(api);
  await vi.waitFor(() =>
    expect(record).toHaveBeenCalledWith("warn", "theme.load_failed", { code: "connection.failed" }),
  );
  expect(api.getVenueTheme).toHaveBeenCalledOnce();
  expect(bg()).toBe(WAITRON_LIGHT_BG);
});

it("a failed read keeps the page and is recorded", async () => {
  const record = vi.spyOn(diag, "record");
  const api = stubApi();
  await mount(api);
  await vi.waitFor(() => expect(bg()).toBe(FIXTURE_LIGHT_BG));
  api.getVenueTheme.mockRejectedValue({ code: "connection.failed" });
  api.liveData.invalidate([{ type: "custom_themes" }]);
  await vi.waitFor(() =>
    expect(record).toHaveBeenCalledWith("warn", "theme.load_failed", { code: "connection.failed" }),
  );
  expect(bg()).toBe(FIXTURE_LIGHT_BG);
});

it("a live answer sent before a newer theme was applied does not bring the older one back", async () => {
  const api = stubApi();
  const el = await mount(api);
  await vi.waitFor(() => expect(bg()).toBe(FIXTURE_LIGHT_BG));
  let answer!: (value: typeof FIXTURE_ANSWER) => void;
  api.getVenueTheme.mockImplementation(
    () => new Promise<typeof FIXTURE_ANSWER>((resolve) => (answer = resolve)),
  );
  const calls = api.getVenueTheme.mock.calls.length;
  api.liveData.invalidate([{ type: "custom_themes" }]);
  await vi.waitFor(() => expect(api.getVenueTheme).toHaveBeenCalledTimes(calls + 1));
  rejecting.mockImplementationOnce(() =>
    Promise.resolve(new Response(JSON.stringify(SECOND_ANSWER))),
  );
  followVenueTheme(SECOND_ANSWER.hash);
  await vi.waitFor(() => expect(bg()).toBe("#fff3f3"));
  answer(FIXTURE_ANSWER);
  await flush(el);
  await flush(el);
  expect(bg()).toBe("#fff3f3");
  expect(JSON.parse(localStorage.getItem(VENUE_THEME_STORAGE_KEY)!).hash).toBe(SECOND_ANSWER.hash);
});

it("sign-in takes the start-up answer, and the live stream's opening reads the latest", async () => {
  startVenueTheme(document.documentElement, {
    fetchImpl: () => Promise.resolve(new Response(JSON.stringify(FIXTURE_ANSWER))),
  });
  await vi.waitFor(() => expect(bg()).toBe(FIXTURE_LIGHT_BG));
  const api = stubApi({ getVenueTheme: vi.fn().mockResolvedValue(SECOND_ANSWER) });
  const streams: (EventTarget & { url: string; close(): void })[] = [];
  const liveUpdates = new LiveConnection(api.liveData, {
    open: (url) => {
      const stream = Object.assign(new EventTarget(), { url, close: () => undefined });
      streams.push(stream);
      return stream;
    },
  });
  const el = await mount(api, liveUpdates);
  await vi.waitFor(() => expect(streams.at(-1)?.url).toContain("custom_themes"));
  await flush(el);
  expect(api.getVenueTheme).not.toHaveBeenCalled();
  expect(bg()).toBe(FIXTURE_LIGHT_BG);
  streams.at(-1)!.dispatchEvent(new Event("open"));
  await vi.waitFor(() => expect(bg()).toBe("#fff3f3"));
  expect(api.getVenueTheme).toHaveBeenCalledOnce();
  liveUpdates.stop();
});
