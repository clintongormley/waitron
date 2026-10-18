import { currentHelpMode, setHelpMode, type WtRowActions } from "@waitron/ui";
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import { LiveData, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import { DashboardApp } from "./dashboard-app.js";
import type { AlertView, DashboardApi, PersonSummary } from "./api/client.js";

const stubRequest: DashboardRequest = async () => [] as never;

const people: PersonSummary[] = [
  {
    personId: "p1",
    displayName: "Ada",
    role: "manager",
    status: "active",
    hasPassword: true,
    hasTotp: true,
    email: null,
  },
];

const meResponse = {
  personId: "p1",
  role: "manager",
  email: "manager@example.com",
  locale: null as string | null,
  venueLocale: "es-ES",
  sessionDefault: "es-ES",
  venueName: "Deli Test SL",
  onboardingIntent: "prepare",
  permissions: ["booking.manage"],
  modules: ["bookings"],
};

/** Every read the shell and the screens it mounts make on connect resolves: a stray rejection is a
 * finding. */
function stubApi(overrides: Record<string, unknown> = {}): DashboardApi {
  return {
    getMe: vi.fn().mockResolvedValue({ ...meResponse }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
      loginDefault: "es-ES",
      venueName: "Deli Test SL",
      onboardingIntent: "prepare",
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
    putLocale: vi.fn().mockResolvedValue(undefined),
    listStaff: vi.fn().mockResolvedValue(people),
    getStaffRoster: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ada" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    inspectAccountAction: vi
      .fn()
      .mockResolvedValue({ email: "new@example.test", purpose: "invitation" }),
    createPerson: vi.fn().mockResolvedValue({ id: "p2" }),
    logout: vi.fn().mockResolvedValue(undefined),
    listMyShifts: vi.fn().mockResolvedValue([]),
    listMySwaps: vi.fn().mockResolvedValue([]),
    listMyAbsences: vi.fn().mockResolvedValue([]),
    listCatalogues: vi.fn().mockResolvedValue([]),
    getCatalogueSettings: async () => ({ defaultProductVatClass: "general", defaultColor: null }),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    listCategories: vi.fn().mockResolvedValue([]),
    listProducts: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    putReceipt: vi.fn().mockResolvedValue(undefined),
    listStatuses: vi.fn().mockResolvedValue([]),
    getBumpMode: vi.fn().mockResolvedValue({ mode: "line" }),
    getKitchenTimingDefaults: vi.fn().mockResolvedValue({
      warmAfterMinutes: 5,
      overdueAfterMinutes: 10,
      forgottenAfterMinutes: 15,
    }),
    setKitchenTimingDefaults: vi.fn().mockResolvedValue(undefined),
    getFireControl: vi.fn().mockResolvedValue({ mode: "waiter" }),
    listCourses: vi.fn().mockResolvedValue([]),
    getReceiptLanguage: vi
      .fn()
      .mockResolvedValue({ language: "es-ES", choices: ["es-ES"], fixed: null }),
    getVenueDefaults: vi.fn().mockResolvedValue({
      receiptLanguage: "es-ES",
      receiptLanguageChoices: ["es-ES"],
      fixedReceiptLanguage: null,
      defaultProductVatClass: "general",
    }),
    previewReceiptDraft: vi.fn(() => new Promise(() => undefined)),
    getLocations: vi.fn().mockResolvedValue([{ id: "loc-1", name: "Main" }]),
    getRoster: vi.fn().mockResolvedValue({ version: null, shifts: [] }),
    listPendingSwaps: vi.fn().mockResolvedValue([]),
    listPendingAbsences: vi.fn().mockResolvedValue([]),
    getPlannedVsActual: vi.fn().mockResolvedValue([]),
    listPurchaseInvoices: vi.fn().mockResolvedValue([]),
    listTables: vi.fn().mockResolvedValue([]),
    listDevices: vi.fn().mockResolvedValue([]),
    listAgents: vi.fn().mockResolvedValue([]),
    listPrinters: vi.fn().mockResolvedValue([]),
    listRecentJobs: vi.fn().mockResolvedValue([]),

    getRecentLogs: vi.fn().mockResolvedValue({ lines: [] }),
    getVerbosity: vi.fn().mockResolvedValue({ level: "info", revertsAt: null }),
    setVerbosity: vi.fn().mockResolvedValue(undefined),
    getSalesOverview: vi.fn().mockResolvedValue({
      businessDay: "2026-08-30",
      takings: { tenderTotal: "0.00", tipTotal: "0.00", grossTotal: "0.00" },
      counts: { sales: 0, corrections: 0, voids: 0 },
      openTables: { open: 0, total: 0 },
      topSellers: [],
    }),
    getDailyClose: vi.fn().mockResolvedValue({
      businessDay: "2026-08-30",
      vat: { byRate: [], baseTotal: "0.00", taxTotal: "0.00", grossTotal: "0.00" },
      cash: { byOrigin: [], tenderTotal: "0.00", tipTotal: "0.00" },
      counts: { sales: 0, corrections: 0, voids: 0 },
      topSellers: [],
    }),
    getSalesPeriod: vi.fn().mockResolvedValue({
      from: "2026-08-30",
      to: "2026-08-30",
      vat: { byRate: [], baseTotal: "0.00", taxTotal: "0.00", grossTotal: "0.00" },
      topSellers: [],
    }),
    listOrderPages: vi.fn().mockResolvedValue({ rows: [], next: null, from: null, to: null }),
    listOrderStaff: vi.fn().mockResolvedValue({ staff: [] }),
    listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
    listHandledAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
    markIncidentHandled: vi.fn().mockResolvedValue(undefined),
    passkeySignals: vi.fn().mockResolvedValue({
      rpId: "localhost",
      userId: "cDE",
      credentialIds: [],
      name: "manager@example.com",
      displayName: "Manager",
    }),
    ...overrides,
  } as unknown as DashboardApi;
}

const initialUrl = location.href;
let signalAll: MockInstance<typeof PublicKeyCredential.signalAllAcceptedCredentials>;
let signalDetails: MockInstance<typeof PublicKeyCredential.signalCurrentUserDetails>;
beforeEach(() => {
  setLocale("en-GB");
  signalAll = vi
    .spyOn(PublicKeyCredential, "signalAllAcceptedCredentials")
    .mockResolvedValue(undefined);
  signalDetails = vi
    .spyOn(PublicKeyCredential, "signalCurrentUserDetails")
    .mockResolvedValue(undefined);
});
afterEach(() => {
  setHelpMode(false);
  cleanupWidgets();
  signalAll.mockRestore();
  signalDetails.mockRestore();
  vi.restoreAllMocks();
  history.replaceState(null, "", initialUrl);
  sessionStorage.clear();
  localStorage.clear();
  setLocale("es-ES");
});

const englishMe = { ...meResponse, sessionDefault: "en-GB", venueLocale: "en-GB" };

async function flush(el: DashboardApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function signedIn(overrides: Record<string, unknown> = {}, theme?: "light" | "dark") {
  const api = stubApi({ getMe: vi.fn().mockResolvedValue({ ...englishMe }), ...overrides });
  const { el, host } = await mountWidget<DashboardApp>(
    "dashboard-app",
    { api, request: stubRequest },
    theme,
  );
  await flush(el);
  expect(el.shadowRoot!.querySelector("dashboard-overview-screen")).not.toBeNull();
  return { el, host, api };
}

const q = <T extends HTMLElement = HTMLElement>(el: DashboardApp, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const helpSwitch = (el: DashboardApp) => q(el, "[data-test=help-switch]");
const switchButton = (el: DashboardApp) =>
  helpSwitch(el)!.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
const login = (el: DashboardApp) => q(el, "dashboard-login-screen");
const accountMenu = (el: DashboardApp) => q<WtRowActions>(el, "[data-test=account-menu]")!;
const menuPopup = (el: DashboardApp) =>
  accountMenu(el).shadowRoot!.querySelector<HTMLElement>("[popover]")!;

async function turnHelpOn(el: DashboardApp): Promise<void> {
  switchButton(el).click();
  await flush(el);
  expect(currentHelpMode()).toBe(true);
}

const alert = (id: string): AlertView => ({
  key: `incident:${id}`,
  kind: "event",
  code: "payment.offline_forward_declined",
  params: { amount: "12.50", paymentRef: `pi_${id}` },
  severity: "warning",
  since: "2026-09-14T12:00:00.000Z",
  area: "payments",
});

it("signed in, the banner has a Help switch between the bell and the account menu", async () => {
  const { el } = await signedIn({
    liveData: new LiveData(),
    listAlerts: vi.fn().mockResolvedValue({ visible: true, alerts: [alert("1")] }),
  });
  const actions = q(el, ".banner-actions")!;
  expect([...actions.children].map((child) => child.getAttribute("data-test"))).toEqual([
    "language-chooser",
    "alerts-bell",
    "help-switch",
    "account-menu",
  ]);
  await expect.element(switchButton(el)).toHaveAccessibleName("Help");
});

it("names the Help switch in Spanish", async () => {
  const { el } = await signedIn({ getMe: vi.fn().mockResolvedValue({ ...meResponse }) });
  await expect.element(switchButton(el)).toHaveAccessibleName("Ayuda");
});

it("signed out, there is no Help switch", async () => {
  const api = stubApi({
    getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
  });
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
  await flush(el);
  expect(login(el)).not.toBeNull();
  expect(helpSwitch(el)).toBeNull();
});

it("the switch turns help on and off, and shows when it is on", async () => {
  const { el } = await signedIn();
  expect(currentHelpMode()).toBe(false);
  expect(switchButton(el).getAttribute("aria-pressed")).toBe("false");
  switchButton(el).click();
  await flush(el);
  expect(currentHelpMode()).toBe(true);
  expect(switchButton(el).getAttribute("aria-pressed")).toBe("true");
  switchButton(el).click();
  await flush(el);
  expect(currentHelpMode()).toBe(false);
  expect(switchButton(el).getAttribute("aria-pressed")).toBe("false");
});

it("help stays on when moving between screens", async () => {
  const { el } = await signedIn();
  await turnHelpOn(el);
  q(el, "[data-test=nav-sales]")!.click();
  await flush(el);
  expect(q(el, "dashboard-sales-screen")).not.toBeNull();
  expect(currentHelpMode()).toBe(true);
  expect(switchButton(el).getAttribute("aria-pressed")).toBe("true");
});

it("logging out turns help off", async () => {
  const { el, api } = await signedIn();
  await turnHelpOn(el);
  q(el, "[data-test=logout]")!.click();
  await flush(el);
  expect(api.logout).toHaveBeenCalled();
  expect(login(el)).not.toBeNull();
  expect(currentHelpMode()).toBe(false);
});

it("the session expiring turns help off", async () => {
  vi.useFakeTimers();
  try {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({ ...englishMe, sessionExpiresInSeconds: 1 }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await vi.advanceTimersByTimeAsync(0);
    await el.updateComplete;
    switchButton(el).click();
    await el.updateComplete;
    expect(currentHelpMode()).toBe(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(currentHelpMode()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await el.updateComplete;
    expect(login(el)!.shadowRoot!.textContent).toContain(codeMessage("management_session.expired"));
    expect(currentHelpMode()).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it("a refused session turns help off", async () => {
  const { el } = await signedIn();
  await turnHelpOn(el);
  window.dispatchEvent(
    new CustomEvent("waitron-session-invalid", {
      detail: { code: "management_session.expired" },
    }),
  );
  await el.updateComplete;
  expect(login(el)).not.toBeNull();
  expect(currentHelpMode()).toBe(false);
});

it("another tab's expiry turns help off", async () => {
  const { el } = await signedIn();
  await turnHelpOn(el);
  window.dispatchEvent(
    new StorageEvent("storage", { key: "waitron-management-session-deadline", newValue: "0" }),
  );
  await el.updateComplete;
  expect(login(el)).not.toBeNull();
  expect(currentHelpMode()).toBe(false);
});

it("help is not saved, so a fresh page starts off", async () => {
  // A test cannot reload the page, so this and help-mode.test.ts's "nothing is saved" stand in for it.
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  const { el } = await signedIn();
  await turnHelpOn(el);
  switchButton(el).click();
  await flush(el);
  expect(currentHelpMode()).toBe(false);
  const written = setItem.mock.calls.map(([key]) => key);
  expect(written.filter((key) => /help/i.test(key))).toEqual([]);
  const keys = [...Object.keys(localStorage), ...Object.keys(sessionStorage)];
  expect(keys.filter((key) => /help/i.test(key))).toEqual([]);
});

it("has no accessibility violations with help on, in both themes", async () => {
  for (const theme of ["light", "dark"] as const) {
    const { el } = await signedIn({}, theme);
    await turnHelpOn(el);
    await expectNoA11yViolations(q(el, "[data-test=brand-banner]")!);
    accountMenu(el).shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
    await vi.waitFor(() => expect(menuPopup(el).matches(":popover-open")).toBe(true));
    await expectNoA11yViolations(q(el, "[data-test=brand-banner]")!);
    setHelpMode(false);
    cleanupWidgets();
  }
});
