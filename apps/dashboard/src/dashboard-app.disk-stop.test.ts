import { withStaffPages } from "./testing/staff-page-fixture.js";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi, type Mock } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { BUILD_CHANGED_EVENT } from "@waitron/diagnostics";
import { leaveCoordinatorFor, type WtBanner } from "@waitron/ui";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import "./dashboard-app.js";
import type { DashboardApp } from "./dashboard-app.js";
import type { DashboardApi, DiskStopResponse, PersonSummary } from "./api/client.js";
import { diag } from "./diagnostics.js";
import { setLocale } from "./i18n/t.js";

const people: PersonSummary[] = [
  {
    personId: "p1",
    displayName: "Ada",
    roleIds: ["manager"],
    status: "active",
    hasPassword: true,
    hasTotp: true,
    email: null,
  },
];

const meResponse = {
  personId: "p1",
  roleIds: ["manager"],
  email: "manager@example.com",
  locale: null as string | null,
  venueLocale: "es-ES",
  sessionDefault: "es-ES",
  venueName: "Deli Test SL",
  onboardingIntent: "prepare",
  permissions: ["booking.manage", "venue.view", "menu.manage", "hardware.manage", "system.manage"],
  modules: ["bookings"],
};

/** Every read the shell and the screens it mounts make on connect resolves: a stray rejection is a
 * finding. */
function stubApi(overrides: Record<string, unknown> = {}): DashboardApi {
  return withStaffPages({
    getMe: vi.fn().mockResolvedValue({ ...meResponse }),
    forgetLocales: () => {},
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
    listMenus: vi.fn().mockResolvedValue([]),
    getMenuSettings: async () => ({
      defaultProductVatClass: "general",
      defaultColor: null,
      dineInVatRate: "10.00",
    }),
    getVenueTheme: vi.fn().mockResolvedValue({ hash: "waitron", css: "", logo: null }),
    getLegalAbout: vi.fn().mockResolvedValue({ release: null, build: "test" }),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    listCategories: vi.fn().mockResolvedValue([]),
    listProducts: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
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
    getVenuePrivacy: vi.fn().mockResolvedValue({ privacyNoticeUrl: null, privacyEmail: null }),
    previewReceiptDraft: vi.fn(() => new Promise(() => undefined)),
    getReceiptPaperWidths: vi.fn(() => new Promise(() => undefined)),
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
      departmentTakings: [],
      closureSummary: {
        billsClosed: { count: 0, total: "0.00" },
        deferredPayments: "0.00",
        received: "0.00",
      },
      counts: { sales: 0, corrections: 0, voids: 0 },
      openTables: { open: 0, total: 0 },
      topSellers: [],
    }),
    getDailyClose: vi.fn().mockResolvedValue({
      outsidePayments: [],
      timeZone: "Europe/Madrid",
      businessDay: "2026-08-30",
      vat: { byRate: [], baseTotal: "0.00", taxTotal: "0.00", grossTotal: "0.00" },
      cash: { byOrigin: [], tenderTotal: "0.00", tipTotal: "0.00" },
      departmentTakings: [],
      closureSummary: {
        billsClosed: { count: 0, total: "0.00" },
        deferredPayments: "0.00",
        received: "0.00",
      },
      counts: { sales: 0, corrections: 0, voids: 0 },
      topSellers: [],
    }),
    getSalesPeriod: vi.fn().mockResolvedValue({
      from: "2026-08-30",
      to: "2026-08-30",
      vat: { byRate: [], baseTotal: "0.00", taxTotal: "0.00", grossTotal: "0.00" },
      topSellers: [],
    }),
    listOrdersPage: vi
      .fn()
      .mockResolvedValue({ rows: [], total: 0, page: 0, pageSize: 50, from: null, to: null }),
    listOrderStaff: vi.fn().mockResolvedValue({ staff: [] }),
    listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
    getDiskStop: vi.fn().mockResolvedValue({ stopped: false }),
    getBoxNetwork: vi.fn().mockRejectedValue({ code: "box_host.unavailable" }),
    getBoxHealth: vi.fn(() => new Promise(() => undefined)),
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
  } as unknown as DashboardApi);
}

const STOP_EN = "Disk full";
const STOP_ES = "Disco lleno";
const stopped: DiskStopResponse = { stopped: true };
const notStopped: DiskStopResponse = { stopped: false };

function me(role: string, permissions: string[], locale = "en-GB") {
  return { ...meResponse, role, locale, permissions };
}

/** The shell's API with live data, and a background client whose `getDiskStop` is its own spy, so a
 * case can tell a passive read from a foreground one. */
function shellApi(
  background: Mock,
  overrides: Record<string, unknown> = {},
): { api: DashboardApi; liveData: LiveData; foreground: Mock } {
  const liveData = new LiveData();
  const foreground = vi.fn().mockResolvedValue(stopped);
  const api = stubApi({
    liveData,
    background: stubApi({ getDiskStop: background }),
    getDiskStop: foreground,
    ...overrides,
  });
  return { api, liveData, foreground };
}

async function flush(el: DashboardApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const diskScreen = (el: DashboardApp) => {
  const screen = el.shadowRoot!.querySelector("wt-stop-screen");
  return screen?.shadowRoot?.querySelector("dialog:modal") ? screen : null;
};
const diskDialog = (el: DashboardApp) => diskScreen(el)?.shadowRoot?.querySelector("dialog:modal");
const actionLabel = (el: DashboardApp) =>
  diskScreen(el)?.querySelector("wt-button")?.textContent?.trim();
const managerSignIn = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
    "[data-test=permission-sign-in]",
  );
const login = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-login-screen");
const signIn = (el: DashboardApp) =>
  login(el)!.dispatchEvent(
    new CustomEvent("logged-in", {
      detail: { loginMethod: "password", rememberEmail: false },
      bubbles: true,
      composed: true,
    }),
  );

const initialUrl = location.href;
beforeEach(() => {
  history.replaceState(null, "", "/");
  setLocale("en-GB");
});
afterEach(() => {
  cleanupWidgets();
  history.replaceState(null, "", initialUrl);
  sessionStorage.clear();
  localStorage.clear();
  setLocale("es-ES");
  vi.restoreAllMocks();
});

describe("the shell's full-disk window", () => {
  it("shows a manager a modal with the Box status action", async () => {
    const { api } = shellApi(vi.fn().mockResolvedValue(stopped), {
      getMe: vi.fn().mockResolvedValue(me("manager", ["venue.view", "system.manage"])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskScreen(el)?.heading).toBe(STOP_EN);
    await expect.poll(() => diskDialog(el)).toBeTruthy();
    expect(diskScreen(el)!.closest(".banner-row")).not.toBeNull();
    expect(actionLabel(el)).toBe("Open Box status");
  });

  it("draws the manager's line in Spanish, and repaints it when the language changes", async () => {
    const { api } = shellApi(vi.fn().mockResolvedValue(stopped), {
      getMe: vi.fn().mockResolvedValue(me("manager", ["venue.view", "system.manage"], "es-ES")),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskScreen(el)?.heading).toBe(STOP_ES);
    el.shadowRoot!.querySelector(".shell")!.dispatchEvent(
      new CustomEvent("wt-locale-selected", { detail: { code: "en-GB" }, bubbles: true }),
    );
    await expect.poll(() => diskScreen(el)?.heading).toBe(STOP_EN);
  });

  it("offers a supervisor the same stop with a sign-in action", async () => {
    const { api } = shellApi(vi.fn().mockResolvedValue(stopped), {
      getMe: vi.fn().mockResolvedValue(me("supervisor", ["booking.manage"])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskScreen(el)?.heading).toBe(STOP_EN);
    expect(actionLabel(el)).toBe("Sign in as a manager");
  });

  it("shows staff the screen too", async () => {
    const { api } = shellApi(vi.fn().mockResolvedValue(stopped), {
      getMe: vi.fn().mockResolvedValue(me("staff", [])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskScreen(el)?.heading).toBe(STOP_EN);
  });

  it("sends every read through the background client, the first included", async () => {
    const background = vi.fn().mockResolvedValue(stopped);
    const { api, liveData, foreground } = shellApi(background, {
      getMe: vi.fn().mockResolvedValue(me("manager", ["venue.view", "system.manage"])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskScreen(el)).not.toBeNull();
    liveData.invalidate([{ type: "incidents", id: "x" }]);
    await expect.poll(() => background.mock.calls.length).toBe(2);
    expect(foreground).not.toHaveBeenCalled();
  });

  it("takes the window away when a later read finds the stop lifted", async () => {
    const viewport = { width: innerWidth, height: innerHeight };
    onTestFinished(() => page.viewport(viewport.width, viewport.height));
    await page.viewport(1280, 720);
    const background = vi.fn().mockResolvedValue(notStopped);
    const { api, liveData } = shellApi(background, {
      getMe: vi.fn().mockResolvedValue(me("manager", ["venue.view", "system.manage"])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    const main = el.shadowRoot!.querySelector<HTMLElement>("main")!;
    main.focus();
    expect(el.shadowRoot!.activeElement).toBe(main);
    background.mockResolvedValueOnce(stopped);
    liveData.invalidate([{ type: "incidents", id: "x" }]);
    await expect.poll(() => diskDialog(el)).toBeTruthy();
    liveData.invalidate([{ type: "incidents", id: "x" }]);
    await expect.poll(() => diskScreen(el)).toBeNull();
    expect(el.shadowRoot!.activeElement?.localName).toBe("main");
  });

  it("keeps the window when a later read fails, and records the failure", async () => {
    const record = vi.spyOn(diag, "record");
    const background = vi
      .fn()
      .mockResolvedValueOnce(stopped)
      .mockRejectedValue({ code: "connection.failed" });
    const { api, liveData } = shellApi(background, {
      getMe: vi.fn().mockResolvedValue(me("manager", ["venue.view", "system.manage"])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskScreen(el)).not.toBeNull();
    liveData.invalidate([{ type: "incidents", id: "x" }]);
    await expect
      .poll(() => record.mock.calls.some((call) => call[1] === "disk_stop.load_failed"))
      .toBe(true);
    await flush(el);
    expect(diskScreen(el)?.heading).toBe(STOP_EN);
  });

  it.each([[[]], [{}]])("draws no window for an answer of %j", async (answer) => {
    const background = vi.fn().mockResolvedValue(answer);
    const { api } = shellApi(background, {
      getMe: vi.fn().mockResolvedValue(me("manager", ["venue.view", "system.manage"])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => background).toHaveBeenCalled();
    await flush(el);
    expect(diskScreen(el)).toBeNull();
  });

  it.each([
    ["still pending", () => new Promise(() => undefined)],
    ["refused", () => Promise.reject({ code: "connection.failed" })],
  ])(
    "shows no window to the next person after a sign-out, while their read is %s",
    async (_case, next) => {
      const background = vi.fn().mockResolvedValueOnce(stopped).mockImplementation(next);
      const getMe = vi
        .fn()
        .mockResolvedValueOnce(me("manager", ["venue.view", "system.manage"]))
        .mockResolvedValue(me("supervisor", []));
      const { api } = shellApi(background, { getMe });
      const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
      await expect.poll(() => diskScreen(el)).not.toBeNull();
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=logout]")!.click();
      await expect.poll(() => login(el)).not.toBeNull();
      expect(diskScreen(el)).toBeNull();
      signIn(el);
      await expect.poll(() => background.mock.calls.length).toBe(2);
      await flush(el);
      expect(login(el)).toBeNull();
      expect(diskScreen(el)).toBeNull();
    },
  );

  it("shows no window after an expired session's next sign-in, while the read is pending", async () => {
    const background = vi
      .fn()
      .mockResolvedValueOnce(stopped)
      .mockImplementation(() => new Promise(() => undefined));
    const { api } = shellApi(background, {
      getMe: vi.fn().mockResolvedValue(me("manager", ["venue.view", "system.manage"])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskScreen(el)).not.toBeNull();
    window.dispatchEvent(
      new CustomEvent("waitron-session-invalid", {
        detail: { code: "management_session.expired" },
      }),
    );
    await expect.poll(() => login(el)).not.toBeNull();
    expect(diskScreen(el)).toBeNull();
    signIn(el);
    await expect.poll(() => background.mock.calls.length).toBe(2);
    await flush(el);
    expect(login(el)).toBeNull();
    expect(diskScreen(el)).toBeNull();
  });

  it.each(["/box-status", "/check-card-payments"])(
    "leaves recovery page %s uncovered",
    async (url) => {
      history.replaceState(null, "", url);
      const background = vi.fn().mockResolvedValue(stopped);
      const { api } = shellApi(background);
      const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
      await expect.poll(() => background).toHaveBeenCalled();
      await flush(el);
      expect(location.pathname).toBe(url);
      expect(diskScreen(el)).toBeNull();
    },
  );

  it("shows no window on the sign-in page, even when the read would report a stop", async () => {
    const background = vi.fn().mockResolvedValue(stopped);
    const { api, foreground } = shellApi(background, {
      getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => login(el)).not.toBeNull();
    await flush(el);
    expect(diskScreen(el)).toBeNull();
    expect(background).not.toHaveBeenCalled();
    expect(foreground).not.toHaveBeenCalled();
  });

  it("keeps the update bar in the banner row underneath the modal", async () => {
    const { api } = shellApi(vi.fn().mockResolvedValue(stopped), {
      getMe: vi.fn().mockResolvedValue(me("manager", ["venue.view", "system.manage"])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskScreen(el)).not.toBeNull();
    window.dispatchEvent(new Event(BUILD_CHANGED_EVENT));
    await flush(el);
    const banners = [...el.shadowRoot!.querySelectorAll<WtBanner>(".banner-row > wt-banner")].map(
      (banner) => banner.dataset["test"],
    );
    expect(banners).toEqual(["update-bar"]);
    expect(diskDialog(el)).toBeTruthy();
  });
});

describe("the full-disk window's button", () => {
  const actionButton = (el: DashboardApp) =>
    diskScreen(el)!.querySelector("wt-button")!.shadowRoot!.querySelector("button")!;
  const pressButton = (el: DashboardApp) => userEvent.click(actionButton(el));
  const question = (el: DashboardApp) => el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  function deepActiveElement(): Element | null {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }

  /** A changed draft on the page now showing, held by the shell's leave coordinator. */
  function pageDraft(el: DashboardApp): void {
    const page = el.shadowRoot!.querySelector(".body")!.firstElementChild!;
    const input = document.createElement("input");
    input.value = "saved";
    page.shadowRoot!.append(input);
    const scope = leaveCoordinatorFor(el)!.register({
      id: input,
      current: () => input.value,
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => {
        input.value = value;
      },
    });
    input.value = "edited";
    scope.changed();
  }

  async function mountAs(role: string, permissions: string[], overrides = {}) {
    const { api } = shellApi(vi.fn().mockResolvedValue(stopped), {
      getMe: vi.fn().mockResolvedValue(me(role, permissions)),
      ...overrides,
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskDialog(el)).toBeTruthy();
    return { el, api };
  }

  it("opens manager sign-in over the stopped dashboard without signing the current person out", async () => {
    const { el, api } = await mountAs("supervisor", []);
    const stop = el.shadowRoot!.querySelector("wt-stop-screen");
    expect(stop).not.toBeNull();
    const button = stop!.querySelector("wt-button")!;
    expect(button.textContent!.trim()).toBe("Sign in as a manager");
    await button.updateComplete;
    await userEvent.click(button.shadowRoot!.querySelector("button")!);
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=permission-sign-in]"))
      .not.toBeNull();
    expect(api.logout).not.toHaveBeenCalled();
  });

  it("opens Box status for a manager and leaves it uncovered", async () => {
    const { el } = await mountAs("manager", ["venue.view", "system.manage"]);
    expect(actionLabel(el)).toBe("Open Box status");
    await pressButton(el);
    await expect
      .poll(() => el.shadowRoot!.querySelector("dashboard-box-status-screen"))
      .not.toBeNull();
    expect(location.pathname).toBe("/box-status");
    await el.updateComplete;
    expect(diskScreen(el)).toBeNull();
  });

  it("moves keyboard focus to the page area when Open Box status takes its own button away", async () => {
    const { el } = await mountAs("manager", ["venue.view", "system.manage"]);
    await diskScreen(el)!.updateComplete;
    actionButton(el).focus();
    expect(deepActiveElement()).toBe(actionButton(el));
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => el.shadowRoot!.querySelector("dashboard-box-status-screen"))
      .not.toBeNull();
    await el.updateComplete;
    expect(diskScreen(el)).toBeNull();
    expect(deepActiveElement()).not.toBe(document.body);
    const main = el.shadowRoot!.querySelector(".main")!;
    expect(deepActiveElement()).toBe(main);
    await userEvent.keyboard("{Tab}");
    expect(deepActiveElement()).not.toBe(main);
    expect(main.hasAttribute("tabindex")).toBe(false);
  });

  it("asks before Open Box status leaves unsaved changes, and Keep editing stays", async () => {
    const { el } = await mountAs("manager", ["venue.view", "system.manage"]);
    const before = location.pathname;
    pageDraft(el);
    await pressButton(el);
    await expect.poll(() => question(el).open).toBe(true);
    question(el).shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => question(el).open).toBe(false);
    await flush(el);
    expect(location.pathname).toBe(before);
    expect(el.shadowRoot!.querySelector("dashboard-box-status-screen")).toBeNull();
  });

  it("leaves focus where it was when Keep editing keeps the person on the page", async () => {
    const { el } = await mountAs("manager", ["venue.view", "system.manage"]);
    await diskScreen(el)!.updateComplete;
    pageDraft(el);
    actionButton(el).focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => question(el).open).toBe(true);
    question(el).shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => question(el).open).toBe(false);
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-box-status-screen")).toBeNull();
    expect(deepActiveElement()).not.toBe(el.shadowRoot!.querySelector(".main"));
  });

  it("opens Box status after an in-place manager sign-in", async () => {
    const getMe = vi
      .fn()
      .mockResolvedValueOnce(me("supervisor", []))
      .mockResolvedValue(me("manager", ["venue.view", "system.manage"]));
    const { el, api } = await mountAs("supervisor", [], { getMe });
    await pressButton(el);
    await expect.poll(() => managerSignIn(el)?.open).toBe(true);
    signIn(el);
    await expect
      .poll(() => el.shadowRoot!.querySelector("dashboard-box-status-screen"))
      .not.toBeNull();
    expect(location.pathname).toBe("/box-status");
    expect(diskScreen(el)).toBeNull();
    expect(api.logout).not.toHaveBeenCalled();
  });

  it("returns to the current account when a full disk refuses the manager sign-in", async () => {
    const refusedLogin = vi.fn().mockRejectedValue({ code: "storage.disk_full" });
    const { el, api } = await mountAs("supervisor", [], { login: refusedLogin });
    await pressButton(el);
    await expect.poll(() => managerSignIn(el)?.open).toBe(true);
    const screen = login(el)!;
    await screen.updateComplete;
    const email =
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=email]")!;
    await email.updateComplete;
    await userEvent.fill(email.shadowRoot!.querySelector("input")!, "manager@example.test");
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
    await screen.updateComplete;
    const password =
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=password]")!;
    await password.updateComplete;
    const nativePassword = password.shadowRoot!.querySelector("input")!;
    await userEvent.fill(nativePassword, "example-password");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => refusedLogin.mock.calls.length).toBe(1);
    expect(managerSignIn(el)?.open).toBe(true);
    managerSignIn(el)!.querySelector<HTMLElement>("[data-test=permission-stop]")!.click();
    await expect.poll(() => diskDialog(el)).toBeTruthy();
    expect(login(el)).toBeNull();
    expect(api.logout).not.toHaveBeenCalled();
    expect(actionLabel(el)).toBe("Sign in as a manager");
  });

  it("asks before opening manager sign-in over unsaved changes", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const { el } = await mountAs("supervisor", [], { logout });
    pageDraft(el);
    await pressButton(el);
    await expect.poll(() => question(el).open).toBe(true);
    expect(logout).not.toHaveBeenCalled();
    expect(login(el)).toBeNull();
  });

  it("leaves the staff screen's administrator sign-in clearing the address as before", async () => {
    history.replaceState(null, "", "/staff");
    const logout = vi.fn().mockResolvedValue(undefined);
    const { el } = await mountAs("manager", ["system.manage", "person.view", "venue.view"], {
      logout,
    });
    const staff = await vi.waitFor(() => {
      const screen = el.shadowRoot!.querySelector("dashboard-staff-screen");
      expect(screen).not.toBeNull();
      return screen!;
    });
    staff.dispatchEvent(new CustomEvent("admin-sign-in", { bubbles: true, composed: true }));
    await expect.poll(() => login(el)).not.toBeNull();
    expect(logout).toHaveBeenCalledOnce();
    expect(location.pathname).not.toContain("staff");
    expect(location.pathname).not.toContain("box-status");
  });
});

it("passes the signed-in venue country to both staff editors", async () => {
  history.replaceState(null, "", "/staff");
  const api = stubApi({
    getMe: vi.fn().mockResolvedValue({
      ...me("manager", ["person.view", "venue.view"]),
      venueCountry: "ES",
    }),
  });
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
  await expect.poll(() => el.shadowRoot!.querySelector("dashboard-staff-screen")).not.toBeNull();
  const staff = el.shadowRoot!.querySelector("dashboard-staff-screen")!;
  await staff.updateComplete;
  expect(staff.shadowRoot!.querySelector("dashboard-person-form")!.venueCountry).toBe("ES");
  expect(staff.shadowRoot!.querySelector("dashboard-person-edit")!.venueCountry).toBe("ES");
});
