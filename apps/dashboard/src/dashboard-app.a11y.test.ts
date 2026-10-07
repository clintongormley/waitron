import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./widgets/test-helpers.js";
import "./dashboard-app.js";

import type { DashboardApp } from "./dashboard-app.js";
import type { AlertsBell } from "./widgets/alerts-bell.js";
import type { WtToast } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi, PersonSummary } from "./api/client.js";
import type { WtInput } from "@waitron/ui";

/**
 * The screens the shell mounts fetch their own data on connect, so the stub must resolve those
 * reads too, or a stray rejection pollutes the run.
 */
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
  {
    personId: "p2",
    displayName: "Bea",
    role: "staff",
    status: "suspended",
    hasPassword: false,
    hasTotp: false,
    email: null,
  },
];

function stubApi(overrides: Record<string, unknown> = {}): DashboardApi {
  return {
    getMe: vi.fn().mockResolvedValue({
      personId: "p1",
      role: "manager",
      locale: null,
      venueLocale: "es-ES",
      sessionDefault: "es-ES",
      venueName: "Deli Test SL",
      permissions: [],
      modules: [],
    }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
      loginDefault: "es-ES",
      venueName: "Deli Test SL",
    }),
    getCatalogueSettings: async () => ({ defaultProductVatClass: "general" }),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
    listStaff: vi.fn().mockResolvedValue(people),
    getStaffRoster: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ada" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    createPerson: vi.fn().mockResolvedValue({ id: "p3" }),
    logout: vi.fn().mockResolvedValue(undefined),
    listMyShifts: vi.fn().mockResolvedValue([]),
    listMySwaps: vi.fn().mockResolvedValue([]),
    listMyAbsences: vi.fn().mockResolvedValue([]),
    listCatalogues: vi.fn().mockResolvedValue([]),
    listCategories: vi.fn().mockResolvedValue([]),
    listProducts: vi.fn().mockResolvedValue([]),
    getLocations: vi.fn().mockResolvedValue([{ id: "loc-1", name: "Main" }]),
    listLocationCatalogues: vi.fn().mockResolvedValue([]),
    getReceipt: vi.fn().mockResolvedValue({ receipt: {}, venueAddress: [] }),
    putReceipt: vi.fn().mockResolvedValue(undefined),
    listPendingSwaps: vi.fn().mockResolvedValue([]),
    listPendingAbsences: vi.fn().mockResolvedValue([]),
    getPlannedVsActual: vi.fn().mockResolvedValue([]),
    listPurchaseInvoices: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    listTables: vi.fn().mockResolvedValue([]),
    listDevices: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
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
    listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: DashboardApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("dashboard-app a11y (%s theme)", (theme) => {
  it("the login screen renders accessibly", async () => {
    const api = stubApi({
      getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
    });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-login-screen")).toBeTruthy();
    await expectNoA11yViolations(host);
  });

  it.each([
    ["demo", "signed in", true],
    ["demo", "signed out", false],
    ["prepare", "signed in", true],
    ["prepare", "signed out", false],
  ] as const)(
    "when the intent is %s, the shared bar and banner render accessibly %s",
    async (intent, _state, signedIn) => {
      const api = signedIn
        ? stubApi({
            getMe: vi.fn().mockResolvedValue({
              personId: "p1",
              role: "manager",
              locale: null,
              venueLocale: "es-ES",
              sessionDefault: "es-ES",
              venueName: "Deli Test SL",
              onboardingIntent: intent,
              permissions: [],
              modules: [],
            }),
          })
        : stubApi({
            getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
            getLocales: vi.fn().mockResolvedValue({
              locales: [{ code: "es-ES", label: "Español" }],
              venueDefault: "es-ES",
              loginDefault: "es-ES",
              venueName: "Deli Test SL",
              onboardingIntent: intent,
            }),
          });
      const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
      await flush(el);
      expect(
        el
          .shadowRoot!.querySelector("wt-demo-bar")
          ?.shadowRoot!.querySelector('a[href="/manage/email"]'),
      ).toBeTruthy();
      await expectNoA11yViolations(host);
    },
  );

  it("the staff self-service screen renders accessibly with a single, well-ordered heading", async () => {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p2",
        role: "staff",
        locale: null,
        venueLocale: "es-ES",
        sessionDefault: "es-ES",
        venueName: "Deli Test SL",
        permissions: ["sale.take_payment"],
        modules: [],
      }),
    });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    const screen = el.shadowRoot!.querySelector("dashboard-my-schedule-screen");
    expect(screen).toBeTruthy();
    const h1s = [
      ...el.shadowRoot!.querySelectorAll("h1"),
      ...(screen!.shadowRoot?.querySelectorAll("h1") ?? []),
    ];
    expect(h1s).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("the business overview screen renders accessibly with a single, well-ordered heading", async () => {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        personId: "p1",
        role: "manager",
        locale: null,
        venueLocale: "es-ES",
        sessionDefault: "es-ES",
        venueName: "Deli Test SL",
        permissions: [],
        modules: [],
      }),
    });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    const screen = el.shadowRoot!.querySelector("dashboard-overview-screen");
    expect(screen).toBeTruthy();
    const h1s = [
      ...el.shadowRoot!.querySelectorAll("h1"),
      ...(screen!.shadowRoot?.querySelectorAll("h1") ?? []),
    ];
    expect(h1s).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("the responsive drawer is accessible both closed and open (Task 12)", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    const toggle = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]");
    expect(toggle).toBeTruthy();
    await expectNoA11yViolations(host);
    toggle!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".layout")!.classList.contains("drawer-open")).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("the off-canvas drawer is accessible at narrow width, closed and open (Task 12)", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    const sidebar = () => el.shadowRoot!.querySelector<HTMLElement>(".sidebar")!;
    const width = window.innerWidth,
      height = window.innerHeight;
    try {
      await page.viewport(400, 800);
      expect(window.innerWidth).toBe(400);
      for (let i = 0; i < 100 && !sidebar().hasAttribute("inert"); i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(sidebar().hasAttribute("inert")).toBe(true);
      await expectNoA11yViolations(host);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!.click();
      await el.updateComplete;
      expect(sidebar().hasAttribute("inert")).toBe(false);
      await expectNoA11yViolations(host);
    } finally {
      await page.viewport(width, height);
    }
  });

  it("the desktop sidebar's group headers and current page are accessible at rest and under the pointer", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const width = window.innerWidth,
      height = window.innerHeight;
    try {
      await page.viewport(1280, 800);
      const { el } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
      await flush(el);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-staff]")!.click();
      await flush(el);
      const sidebar = el.shadowRoot!.querySelector<HTMLElement>(".sidebar")!;
      expect(sidebar.hasAttribute("inert")).toBe(false);
      const header = sidebar.querySelector<HTMLElement>('button.nav-group[aria-expanded="true"]')!;
      const current = sidebar.querySelector<HTMLElement>('.nav-item[aria-current="page"]')!;
      expect(header).toBeTruthy();
      expect(current).toBeTruthy();
      await expectNoA11yViolations(sidebar);

      for (const target of [header, current]) {
        await userEvent.hover(target);
        expect(target.matches(":hover")).toBe(true);
        await expectNoA11yViolations(sidebar);
      }
    } finally {
      await page.viewport(width, height);
    }
  });

  it("the sidebar's page search box and its message are accessible empty, with matches and with none", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const width = window.innerWidth,
      height = window.innerHeight;
    try {
      await page.viewport(1280, 800);
      const { el } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
      await flush(el);
      const box = el.shadowRoot!.querySelector<WtInput>("[data-test=nav-search]")!;
      const status = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-search-empty]")!;
      await expectNoA11yViolations(box);

      for (const [term, message] of [
        ["impres", ""],
        ["zzz", "Ninguna página coincide."],
      ]) {
        box.focus();
        box.shadowRoot!.querySelector("input")!.select();
        await userEvent.keyboard(term);
        await flush(el);
        expect(status.textContent!.trim()).toBe(message);
        await expectNoA11yViolations(box);
        await expectNoA11yViolations(status);
      }
    } finally {
      await page.viewport(width, height);
    }
  });

  it("the staff screen renders accessibly with a single, well-ordered heading", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-staff]")!.click();
    await flush(el);
    const staff = el.shadowRoot!.querySelector("dashboard-staff-screen");
    expect(staff).toBeTruthy();
    const h1s = [
      ...el.shadowRoot!.querySelectorAll("h1"),
      ...(staff!.shadowRoot?.querySelectorAll("h1") ?? []),
    ];
    expect(h1s).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("the catalogue screen renders accessibly with a single, well-ordered heading", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-catalogue]")!.click();
    await flush(el);
    const catalogue = el.shadowRoot!.querySelector("dashboard-catalogue-screen");
    expect(catalogue).toBeTruthy();
    const h1s = [
      ...el.shadowRoot!.querySelectorAll("h1"),
      ...(catalogue!.shadowRoot?.querySelectorAll("h1") ?? []),
    ];
    expect(h1s).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("the Venue settings page renders accessibly with a single, well-ordered heading", async () => {
    const api = stubApi({
      listStaff: vi.fn().mockResolvedValue(people),
      getBumpMode: vi.fn().mockResolvedValue({ mode: "line" }),
      getKitchenTimingDefaults: vi.fn().mockResolvedValue({
        warmAfterMinutes: 5,
        overdueAfterMinutes: 10,
        forgottenAfterMinutes: 15,
      }),
      setKitchenTimingDefaults: vi.fn().mockResolvedValue(undefined),
      getFireControl: vi.fn().mockResolvedValue({ mode: "waiter" }),
      listCourses: vi.fn().mockResolvedValue([]),
      listStatuses: vi.fn().mockResolvedValue([]),
    });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-venue-settings]")!.click();
    await flush(el);
    const page = el.shadowRoot!.querySelector("dashboard-venue-settings-screen");
    expect(page).toBeTruthy();
    const deep = (root: ParentNode): Element[] => [
      ...root.querySelectorAll("h1"),
      ...[...root.querySelectorAll("*")].flatMap((child) =>
        child.shadowRoot ? deep(child.shadowRoot) : [],
      ),
    ];
    expect(deep(el.shadowRoot!)).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("the approvals screen renders accessibly with a single, well-ordered heading", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-approvals]")!.click();
    await flush(el);
    const approvals = el.shadowRoot!.querySelector("dashboard-approvals-screen");
    expect(approvals).toBeTruthy();
    const h1s = [
      ...el.shadowRoot!.querySelectorAll("h1"),
      ...(approvals!.shadowRoot?.querySelectorAll("h1") ?? []),
    ];
    expect(h1s).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("the planned-vs-actual screen renders accessibly with a single, well-ordered heading", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-planned-actual]")!.click();
    await flush(el);
    const plannedActual = el.shadowRoot!.querySelector("dashboard-planned-actual-screen");
    expect(plannedActual).toBeTruthy();
    const h1s = [
      ...el.shadowRoot!.querySelectorAll("h1"),
      ...(plannedActual!.shadowRoot?.querySelectorAll("h1") ?? []),
    ];
    expect(h1s).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("the purchases screen renders accessibly with a single, well-ordered heading", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-purchases]")!.click();
    await flush(el);
    const purchases = el.shadowRoot!.querySelector("dashboard-purchases-screen");
    expect(purchases).toBeTruthy();
    const h1s = [
      ...el.shadowRoot!.querySelectorAll("h1"),
      ...(purchases!.shadowRoot?.querySelectorAll("h1") ?? []),
    ];
    expect(h1s).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("the floor-plan screen renders accessibly with a single, well-ordered heading", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-floor]")!.click();
    await flush(el);
    const floor = el.shadowRoot!.querySelector("dashboard-floor-screen");
    expect(floor).toBeTruthy();
    const h1s = [
      ...el.shadowRoot!.querySelectorAll("h1"),
      ...(floor!.shadowRoot?.querySelectorAll("h1") ?? []),
    ];
    expect(h1s).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("the banner's alerts bell is accessible closed and open", async () => {
    const api = stubApi({
      listAlerts: vi.fn().mockResolvedValue({
        visible: true,
        alerts: [
          {
            key: "incident:1",
            kind: "event",
            code: "payment.offline_forward_declined",
            params: { amount: "12.50", paymentRef: "pi_1" },
            severity: "error",
            since: "2026-09-14T12:00:00.000Z",
            area: "payments",
          },
        ],
      }),
    });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    const bell = el.shadowRoot!.querySelector<AlertsBell>("[data-test=alerts-bell]");
    expect(bell).toBeTruthy();
    await bell!.updateComplete;
    await expectNoA11yViolations(host);
    bell!.open();
    const popup = bell!
      .shadowRoot!.querySelector("wt-row-actions")!
      .shadowRoot!.querySelector("[popover]")!;
    expect(popup.matches(":popover-open")).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("the new-alerts pop-up is accessible while it is open below the banner", async () => {
    const alert = (id: string) => ({
      key: `incident:${id}`,
      kind: "event",
      code: "payment.offline_forward_declined",
      params: { amount: "12.50", paymentRef: `pi_${id}` },
      severity: "error",
      since: "2026-09-14T12:00:00.000Z",
      area: "payments",
    });
    const liveData = new LiveData();
    const api = stubApi({
      liveData,
      listAlerts: vi
        .fn()
        .mockResolvedValueOnce({ visible: true, alerts: [alert("1")] })
        .mockResolvedValue({ visible: true, alerts: [alert("1"), alert("2")] }),
    });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    // The first read never pops up; a second one bringing a new alert does.
    liveData.invalidate([{ type: "incidents" }]);
    const toast = () => el.shadowRoot!.querySelector<WtToast>("[data-test=alert-toast]")!;
    await vi.waitFor(() => expect(toast().open).toBe(true));
    await toast().updateComplete;
    // Axe files the pop-up's text contrast as "incomplete" here, because the pop-up sits over the
    // page; wt-toast's own accessibility test judges its contrast.
    await expectNoA11yViolations(host);
  });

  it("the devices screen renders accessibly with a single, well-ordered heading", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-devices]")!.click();
    await flush(el);
    const devices = el.shadowRoot!.querySelector("dashboard-devices-screen");
    expect(devices).toBeTruthy();
    const h1s = [
      ...el.shadowRoot!.querySelectorAll("h1"),
      ...(devices!.shadowRoot?.querySelectorAll("h1") ?? []),
    ];
    expect(h1s).toHaveLength(1);
    await expectNoA11yViolations(host);
  });
});
