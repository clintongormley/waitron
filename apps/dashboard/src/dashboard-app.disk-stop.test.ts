import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { BUILD_CHANGED_EVENT } from "@waitron/diagnostics";
import { leaveCoordinatorFor, type WtBanner } from "@waitron/ui";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import "./dashboard-app.js";
import type { DashboardApp } from "./dashboard-app.js";
import { DashboardApi, type DiskStopResponse, type PersonSummary } from "./api/client.js";
import { diag } from "./diagnostics.js";
import { setLocale } from "./i18n/t.js";
import { createSessionSignals } from "./session-signals.js";

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
    getVenueTheme: vi.fn().mockResolvedValue({ hash: "waitron", css: "", logo: null }),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    listCategories: vi.fn().mockResolvedValue([]),
    listProducts: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    putReceipt: vi.fn().mockResolvedValue(undefined),
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
    getDiskStop: vi.fn().mockResolvedValue({ stopped: false, deleted: null }),
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
  } as unknown as DashboardApi;
}

const MANAGER_EN =
  "Disk full: the tills cannot save anything (sales, orders, clock-ins). The box deleted its 2 oldest backups (28 Oct 2026). Box status can free old logs, old crash reports and what an interrupted backup left.";
const MANAGER_ES =
  "Disco lleno: las cajas no pueden guardar nada (ventas, pedidos, fichajes). El equipo borró sus 2 copias más antiguas (28 oct 2026). Estado del equipo puede liberar registros de actividad e informes de fallos antiguos, y lo que dejó una copia interrumpida.";
const STAFF_EN =
  "Disk full: the tills cannot save anything (sales, orders, clock-ins). Sign in as a manager to free space on Box status; this signs you out.";

const stopped: DiskStopResponse = {
  stopped: true,
  deleted: { count: 2, date: "2026-10-28", lastDate: "2026-10-28", severalDays: false },
};
const notStopped: DiskStopResponse = { stopped: false, deleted: null };

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

const diskBar = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<WtBanner>("wt-banner[data-test=disk-stop-bar]");
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
  history.replaceState(null, "", "/manage");
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

describe("the shell's full-disk bar", () => {
  it("shows a manager the red bar under the banner, naming the recent deletion", async () => {
    const { api } = shellApi(vi.fn().mockResolvedValue(stopped), {
      getMe: vi.fn().mockResolvedValue(me("manager", ["system.manage"])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskBar(el)?.message).toBe(MANAGER_EN);
    expect(diskBar(el)!.getAttribute("tone")).toBe("error");
    expect(diskBar(el)!.closest(".banner-row")).not.toBeNull();
    expect(diskBar(el)!.actionLabel).toBe("Open Box status");
  });

  it("draws the manager's line in Spanish, and repaints it when the language changes", async () => {
    const { api } = shellApi(vi.fn().mockResolvedValue(stopped), {
      getMe: vi.fn().mockResolvedValue(me("manager", ["system.manage"], "es-ES")),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskBar(el)?.message).toBe(MANAGER_ES);
    el.shadowRoot!.querySelector(".shell")!.dispatchEvent(
      new CustomEvent("wt-locale-selected", { detail: { code: "en-GB" }, bubbles: true }),
    );
    await expect.poll(() => diskBar(el)?.message).toBe(MANAGER_EN);
  });

  it("shows a supervisor the staff line, never the deletion, even when the read carries one", async () => {
    const { api } = shellApi(vi.fn().mockResolvedValue(stopped), {
      getMe: vi.fn().mockResolvedValue(me("supervisor", ["booking.manage"])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskBar(el)?.message).toBe(STAFF_EN);
  });

  it("shows staff the bar too", async () => {
    const { api } = shellApi(vi.fn().mockResolvedValue(stopped), {
      getMe: vi.fn().mockResolvedValue(me("staff", [])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskBar(el)?.message).toBe(STAFF_EN);
  });

  it("sends every read through the background client, the first included", async () => {
    const background = vi.fn().mockResolvedValue(stopped);
    const { api, liveData, foreground } = shellApi(background, {
      getMe: vi.fn().mockResolvedValue(me("manager", ["system.manage"])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskBar(el)).not.toBeNull();
    liveData.invalidate([{ type: "incidents", id: "x" }]);
    await expect.poll(() => background.mock.calls.length).toBe(2);
    expect(foreground).not.toHaveBeenCalled();
  });

  it("takes the bar away when a later read finds the stop lifted", async () => {
    const background = vi.fn().mockResolvedValueOnce(stopped).mockResolvedValue(notStopped);
    const { api, liveData } = shellApi(background, {
      getMe: vi.fn().mockResolvedValue(me("manager", ["system.manage"])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskBar(el)).not.toBeNull();
    liveData.invalidate([{ type: "incidents", id: "x" }]);
    await expect.poll(() => diskBar(el)).toBeNull();
  });

  it("keeps the bar when a later read fails, and records the failure", async () => {
    const record = vi.spyOn(diag, "record");
    const background = vi
      .fn()
      .mockResolvedValueOnce(stopped)
      .mockRejectedValue({ code: "connection.failed" });
    const { api, liveData } = shellApi(background, {
      getMe: vi.fn().mockResolvedValue(me("manager", ["system.manage"])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskBar(el)).not.toBeNull();
    liveData.invalidate([{ type: "incidents", id: "x" }]);
    await expect
      .poll(() => record.mock.calls.some((call) => call[1] === "disk_stop.load_failed"))
      .toBe(true);
    await flush(el);
    expect(diskBar(el)?.message).toBe(MANAGER_EN);
  });

  it.each([[[]], [{}]])("draws no bar for an answer of %j", async (answer) => {
    const background = vi.fn().mockResolvedValue(answer);
    const { api } = shellApi(background, {
      getMe: vi.fn().mockResolvedValue(me("manager", ["system.manage"])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => background).toHaveBeenCalled();
    await flush(el);
    expect(diskBar(el)).toBeNull();
  });

  it.each([
    ["still pending", () => new Promise(() => undefined)],
    ["refused", () => Promise.reject({ code: "connection.failed" })],
  ])(
    "shows no bar to the next person after a sign-out, while their read is %s",
    async (_case, next) => {
      const background = vi.fn().mockResolvedValueOnce(stopped).mockImplementation(next);
      const getMe = vi
        .fn()
        .mockResolvedValueOnce(me("manager", ["system.manage"]))
        .mockResolvedValue(me("supervisor", []));
      const { api } = shellApi(background, { getMe });
      const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
      await expect.poll(() => diskBar(el)).not.toBeNull();
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=logout]")!.click();
      await expect.poll(() => login(el)).not.toBeNull();
      expect(diskBar(el)).toBeNull();
      signIn(el);
      await expect.poll(() => background.mock.calls.length).toBe(2);
      await flush(el);
      expect(login(el)).toBeNull();
      expect(diskBar(el)).toBeNull();
    },
  );

  it("shows no bar after an expired session's next sign-in, while the read is pending", async () => {
    const background = vi
      .fn()
      .mockResolvedValueOnce(stopped)
      .mockImplementation(() => new Promise(() => undefined));
    const { api } = shellApi(background, {
      getMe: vi.fn().mockResolvedValue(me("manager", ["system.manage"])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskBar(el)).not.toBeNull();
    window.dispatchEvent(
      new CustomEvent("waitron-session-invalid", {
        detail: { code: "management_session.expired" },
      }),
    );
    await expect.poll(() => login(el)).not.toBeNull();
    expect(diskBar(el)).toBeNull();
    signIn(el);
    await expect.poll(() => background.mock.calls.length).toBe(2);
    await flush(el);
    expect(login(el)).toBeNull();
    expect(diskBar(el)).toBeNull();
  });

  it("shows no bar on the sign-in page, even when the read would report a stop", async () => {
    const background = vi.fn().mockResolvedValue(stopped);
    const { api, foreground } = shellApi(background, {
      getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => login(el)).not.toBeNull();
    await flush(el);
    expect(diskBar(el)).toBeNull();
    expect(background).not.toHaveBeenCalled();
    expect(foreground).not.toHaveBeenCalled();
  });

  it("draws the disk bar before the update bar in the banner row", async () => {
    const { api } = shellApi(vi.fn().mockResolvedValue(stopped), {
      getMe: vi.fn().mockResolvedValue(me("manager", ["system.manage"])),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskBar(el)).not.toBeNull();
    window.dispatchEvent(new Event(BUILD_CHANGED_EVENT));
    await flush(el);
    const banners = [...el.shadowRoot!.querySelectorAll<WtBanner>(".banner-row > wt-banner")].map(
      (banner) => banner.dataset["test"],
    );
    expect(banners).toEqual(["disk-stop-bar", "update-bar"]);
  });
});

describe("the full-disk bar's button", () => {
  const actionButton = (el: DashboardApp) =>
    diskBar(el)!.shadowRoot!.querySelector("wt-button")!.shadowRoot!.querySelector("button")!;
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
    await expect.poll(() => diskBar(el)).not.toBeNull();
    return { el, api };
  }

  it("opens Box status for a manager, and draws no button on Box status itself", async () => {
    const { el } = await mountAs("manager", ["system.manage"]);
    expect(diskBar(el)!.actionLabel).toBe("Open Box status");
    await pressButton(el);
    await expect
      .poll(() => el.shadowRoot!.querySelector("dashboard-box-status-screen"))
      .not.toBeNull();
    expect(location.pathname).toBe("/manage/box-status");
    await el.updateComplete;
    expect(diskBar(el)!.actionLabel).toBe("");
    await diskBar(el)!.updateComplete;
    expect(diskBar(el)!.shadowRoot!.querySelector("wt-button")).toBeNull();
  });

  it("moves keyboard focus to the page area when Open Box status takes its own button away", async () => {
    const { el } = await mountAs("manager", ["system.manage"]);
    await diskBar(el)!.updateComplete;
    actionButton(el).focus();
    expect(deepActiveElement()).toBe(actionButton(el));
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => el.shadowRoot!.querySelector("dashboard-box-status-screen"))
      .not.toBeNull();
    await el.updateComplete;
    await diskBar(el)!.updateComplete;
    expect(diskBar(el)!.shadowRoot!.querySelector("wt-button")).toBeNull();
    expect(deepActiveElement()).not.toBe(document.body);
    const main = el.shadowRoot!.querySelector(".main")!;
    expect(deepActiveElement()).toBe(main);
    await userEvent.keyboard("{Tab}");
    expect(deepActiveElement()).not.toBe(main);
    expect(main.hasAttribute("tabindex")).toBe(false);
  });

  it("asks before Open Box status leaves unsaved changes, and Keep editing stays", async () => {
    const { el } = await mountAs("manager", ["system.manage"]);
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
    const { el } = await mountAs("manager", ["system.manage"]);
    await diskBar(el)!.updateComplete;
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

  it.each([
    ["a manager", "manager", ["system.manage"], "dashboard-box-status-screen"],
    ["a supervisor", "supervisor", [], "dashboard-overview-screen"],
  ])(
    "signs a supervisor out with Box status kept for the next sign-in; %s then lands on it or their usual page",
    async (_who, role, permissions, landing) => {
      const getMe = vi
        .fn()
        .mockResolvedValueOnce(me("supervisor", []))
        .mockResolvedValue(me(role, permissions));
      const logout = vi.fn().mockResolvedValue(undefined);
      const { el } = await mountAs("supervisor", [], { getMe, logout });
      expect(diskBar(el)!.actionLabel).toBe("Sign in as a manager");
      await pressButton(el);
      await expect.poll(() => login(el)).not.toBeNull();
      expect(logout).toHaveBeenCalledOnce();
      expect(diskBar(el)).toBeNull();
      expect(location.pathname).toBe("/manage/box-status");
      signIn(el);
      await expect.poll(() => el.shadowRoot!.querySelector(landing)).not.toBeNull();
    },
  );

  it("reads the stop no more after Sign in as a manager, so the sign-in page keeps Box status in the address", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      // Any read after the first answers as an ended session does: the real client signals it.
      const background = vi
        .fn()
        .mockResolvedValueOnce(stopped)
        .mockImplementation(() => {
          window.dispatchEvent(
            new CustomEvent("waitron-session-invalid", {
              detail: { code: "management_session.required" },
            }),
          );
          return Promise.reject({ code: "management_session.required" });
        });
      const { api } = shellApi(background, {
        getMe: vi.fn().mockResolvedValue(me("supervisor", [])),
        logout: vi.fn().mockResolvedValue(undefined),
      });
      const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
      await expect.poll(() => diskBar(el)).not.toBeNull();
      await pressButton(el);
      await expect.poll(() => login(el)).not.toBeNull();
      expect(location.pathname).toBe("/manage/box-status");
      vi.advanceTimersByTime(61_000);
      await flush(el);
      expect(background).toHaveBeenCalledOnce();
      expect(location.pathname).toBe("/manage/box-status");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a refusal from a read still in flight when Sign in as a manager signs out keeps Box status as the destination", async () => {
    let finish!: (response: Response) => void;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(stopped), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (finish = resolve)));
    const signals = createSessionSignals();
    const real = new DashboardApi("", fetchImpl, signals.reportError, signals.reportActivity);
    const { api, liveData } = shellApi(
      vi.fn(() => real.background.getDiskStop()),
      { getMe: vi.fn().mockResolvedValue(me("supervisor", [])) },
    );
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskBar(el)).not.toBeNull();
    liveData.invalidate([{ type: "incidents", id: "x" }]);
    await expect.poll(() => fetchImpl.mock.calls.length).toBe(2);
    await diskBar(el)!.updateComplete;
    await pressButton(el);
    await expect.poll(() => login(el)).not.toBeNull();
    expect(location.pathname).toBe("/manage/box-status");
    finish(
      new Response(JSON.stringify({ error: { code: "management_session.required" } }), {
        status: 401,
      }),
    );
    await flush(el);
    await flush(el);
    expect(location.pathname).toBe("/manage/box-status");
  });

  it("a refusal from a read that answers while Sign in as a manager is still signing out keeps Box status as the destination", async () => {
    let finishRead!: (response: Response) => void;
    let finishLogout!: (response: Response) => void;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(stopped), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (finishRead = resolve)))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (finishLogout = resolve)));
    const signals = createSessionSignals();
    const real = new DashboardApi("", fetchImpl, signals.reportError, signals.reportActivity);
    const { api, liveData } = shellApi(
      vi.fn(() => real.background.getDiskStop()),
      {
        getMe: vi.fn().mockResolvedValue(me("supervisor", [])),
        logout: vi.fn(() => real.logout()),
      },
    );
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await expect.poll(() => diskBar(el)).not.toBeNull();
    liveData.invalidate([{ type: "incidents", id: "x" }]);
    await expect.poll(() => fetchImpl.mock.calls.length).toBe(2);
    await diskBar(el)!.updateComplete;
    await pressButton(el);
    await expect.poll(() => fetchImpl.mock.calls.length).toBe(3);
    expect(String(fetchImpl.mock.calls[2]![0])).toBe("/management-api/session");
    finishRead(
      new Response(JSON.stringify({ error: { code: "management_session.required" } }), {
        status: 401,
      }),
    );
    await flush(el);
    await flush(el);
    finishLogout(new Response(null, { status: 204 }));
    await expect.poll(() => login(el)).not.toBeNull();
    await flush(el);
    expect(location.pathname).toBe("/manage/box-status");
  });

  it("asks before Sign in as a manager signs out over unsaved changes", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const { el } = await mountAs("supervisor", [], { logout });
    pageDraft(el);
    await pressButton(el);
    await expect.poll(() => question(el).open).toBe(true);
    expect(logout).not.toHaveBeenCalled();
    expect(login(el)).toBeNull();
  });

  it("leaves the staff screen's administrator sign-in clearing the address as before", async () => {
    history.replaceState(null, "", "/manage/staff");
    const logout = vi.fn().mockResolvedValue(undefined);
    const { el } = await mountAs("manager", ["system.manage", "person.view"], { logout });
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
