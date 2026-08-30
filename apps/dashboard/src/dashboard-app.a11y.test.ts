import { afterEach, describe, expect, it, vi } from "vitest";
import { commands } from "@vitest/browser/context";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./widgets/test-helpers.js";
import "./dashboard-app.js";

declare module "@vitest/browser/context" {
  interface BrowserCommands {
    // Resizes the Playwright viewport to cross Task 12's 48rem drawer breakpoint (fires matchMedia
    // change → flips the shell's `narrow` state). Restore a desktop width in a finally.
    setViewportSize: (width: number, height: number) => Promise<void>;
  }
}
import type { DashboardApp } from "./dashboard-app.js";
import type { DashboardApi, PersonSummary } from "./api/client.js";

/**
 * The shell in each of its screen states, scanned by axe in both themes. It is mounted by ASSIGNING
 * the `api` STUB as a property (never bare markup), exactly as the screen a11y suites do: the shell's
 * `firstUpdated` fires `void this.#probeSession()` → `api.getMe()` (WHOAMI), and the screens it then
 * mounts fetch their own data on connect, so the stub must resolve those too or a stray rejection
 * pollutes the run (a rejection is a finding). The probe's resolve/reject (and the resolved ROLE) picks
 * the state — a manager lands on the manager screens, a `staff` person on the self-service view.
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
    getMe: vi.fn().mockResolvedValue({ personId: "p1", role: "manager" }),
    listStaff: vi.fn().mockResolvedValue(people),
    getStaffRoster: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ada" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    createPerson: vi.fn().mockResolvedValue({ id: "p3" }),
    logout: vi.fn().mockResolvedValue(undefined),
    // The staff self-service (my-schedule) screen loads these on connect (getStaffRoster above).
    listMyShifts: vi.fn().mockResolvedValue([]),
    listMySwaps: vi.fn().mockResolvedValue([]),
    listMyAbsences: vi.fn().mockResolvedValue([]),
    // The catalogue screen (reachable via the nav) loads these on connect.
    listCatalogues: vi.fn().mockResolvedValue([]),
    listCategories: vi.fn().mockResolvedValue([]),
    listProducts: vi.fn().mockResolvedValue([]),
    // The location-menus screen (reachable via the nav) loads these on connect.
    getLocations: vi.fn().mockResolvedValue([{ id: "loc-1", name: "Main" }]),
    listLocationCatalogues: vi.fn().mockResolvedValue([]),
    // The layout + receipt screens (reachable via the nav) load `getLayout` on connect.
    getLayout: vi.fn().mockResolvedValue({ definition: [], receipt: {} }),
    putLayout: vi.fn().mockResolvedValue(undefined),
    putReceipt: vi.fn().mockResolvedValue(undefined),
    // The approvals screen (reachable via the nav) loads both queues on connect.
    listPendingSwaps: vi.fn().mockResolvedValue([]),
    listPendingAbsences: vi.fn().mockResolvedValue([]),
    // The planned-vs-actual screen (reachable via the nav) loads this on connect (getLocations /
    // listStaff are already stubbed above).
    getPlannedVsActual: vi.fn().mockResolvedValue([]),
    // The purchases screen (reachable via the nav) loads this on connect.
    listPurchaseInvoices: vi.fn().mockResolvedValue([]),
    // The floor-plan screen (reachable via the nav) loads both on connect.
    listZones: vi.fn().mockResolvedValue([]),
    listTables: vi.fn().mockResolvedValue([]),
    // The recipe screen (reachable via the nav) loads ingredients on connect (listCatalogues is
    // already stubbed above); getProductRecipe/setProductRecipe only fire once a product is chosen.
    listIngredients: vi.fn().mockResolvedValue([]),
    // The devices screen (reachable via the nav) loads both on connect; resolve them so navigating to it
    // leaves no stray rejection.
    listDevices: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    // The overview screen is now the non-staff LANDING (Task 9), so it loads on connect for every
    // manager-role state below; resolve it so booting leaves no stray rejection. getDailyClose /
    // getSalesPeriod back the sales screen (reachable via the nav) for the same reason.
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
      cash: { byTill: [], tenderTotal: "0.00", tipTotal: "0.00" },
      counts: { sales: 0, corrections: 0, voids: 0 },
      topSellers: [],
    }),
    getSalesPeriod: vi.fn().mockResolvedValue({
      from: "2026-08-30",
      to: "2026-08-30",
      vat: { byRate: [], baseTotal: "0.00", taxTotal: "0.00", grossTotal: "0.00" },
      topSellers: [],
    }),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Settles the in-flight session probe and the follow-up render. */
async function flush(el: DashboardApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("dashboard-app a11y (%s theme)", (theme) => {
  it("the login screen renders accessibly", async () => {
    // A rejected probe lands on login (the login screen owns its own top heading / no heading).
    const api = stubApi({
      getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
    });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    expect(el.shadowRoot!.querySelector("dashboard-login-screen")).toBeTruthy();
    await expectNoA11yViolations(host);
  });

  it("the staff self-service screen renders accessibly with a single, well-ordered heading", async () => {
    // A resolved probe for a STAFF-role person lands on the self-service my-schedule screen (its own
    // <h1> "Mi horario" is the sole heading; the staff chrome carries only a logout button, no nav).
    const api = stubApi({ getMe: vi.fn().mockResolvedValue({ personId: "p2", role: "staff" }) });
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
    // A resolved probe for a non-staff role lands on the business `overview` screen (Task 9's landing;
    // its own <h1> "Hoy de un vistazo" is the sole heading, alongside the nav + logout chrome).
    const api = stubApi({ getMe: vi.fn().mockResolvedValue({ personId: "p1", role: "manager" }) });
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
    // The hamburger toggle carries an aria-label so it has an accessible name even icon-only, and the
    // shell stays axe-clean with the drawer both closed (as it boots) and open (after the toggle, with
    // the scrim shown). A non-staff manager session renders the nav + hamburger chrome.
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    // Closed: the hamburger exists (with its accessible name) and axe passes.
    const toggle = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]");
    expect(toggle).toBeTruthy();
    await expectNoA11yViolations(host);
    // Open the drawer, then scan again with the scrim present.
    toggle!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".layout")!.classList.contains("drawer-open")).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("the off-canvas drawer is accessible at narrow width, closed and open (Task 12)", async () => {
    // The DESKTOP a11y test above validates DOM/ARIA structure but never the off-canvas rendering,
    // where the real risk lives (a closed off-screen sidebar keeping its 16 nav buttons in the tab
    // order). Shrink below the 48rem breakpoint and scan axe both closed (the sidebar is inert, so its
    // buttons leave the a11y tree) and open (the drawer slid in over a scrim).
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    const sidebar = () => el.shadowRoot!.querySelector<HTMLElement>(".sidebar")!;
    try {
      await commands.setViewportSize(400, 800);
      // Wait for matchMedia change to reach the element (async after a resize).
      for (let i = 0; i < 100 && !sidebar().hasAttribute("inert"); i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      // Closed + narrow: the sidebar is inert and axe is clean.
      expect(sidebar().hasAttribute("inert")).toBe(true);
      await expectNoA11yViolations(host);
      // Open the drawer at narrow width and scan again.
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!.click();
      await el.updateComplete;
      expect(sidebar().hasAttribute("inert")).toBe(false);
      await expectNoA11yViolations(host);
    } finally {
      await commands.setViewportSize(1280, 800);
    }
  });

  it("the staff screen renders accessibly with a single, well-ordered heading", async () => {
    // The shell now opens on `overview` (Task 9), so reach the staff screen via the nav. It renders the
    // ONLY <h1> ("Usuarios"); the shell's own chrome (nav + logout button) carries no competing
    // heading, so the outline stays clean.
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-staff]")!.click();
    await flush(el);
    const staff = el.shadowRoot!.querySelector("dashboard-staff-screen");
    expect(staff).toBeTruthy();
    // Exactly one <h1> across the composed tree — the staff screen's, not a second one in the shell.
    const h1s = [
      ...el.shadowRoot!.querySelectorAll("h1"),
      ...(staff!.shadowRoot?.querySelectorAll("h1") ?? []),
    ];
    expect(h1s).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("the catalogue screen renders accessibly with a single, well-ordered heading", async () => {
    // Navigate to the catalogue screen (its own <h1> "Carta" is then the sole heading; the shell's
    // nav chrome carries none), and scan the composed tree in this theme.
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

  it("the location-menus screen renders accessibly with a single, well-ordered heading", async () => {
    // Navigate to the location-menus screen (its own <h1> "Menús por local" is then the sole heading;
    // the shell's nav chrome carries none), and scan the composed tree in this theme.
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-location-menus]")!.click();
    await flush(el);
    const locationMenus = el.shadowRoot!.querySelector("dashboard-location-menus-screen");
    expect(locationMenus).toBeTruthy();
    const h1s = [
      ...el.shadowRoot!.querySelectorAll("h1"),
      ...(locationMenus!.shadowRoot?.querySelectorAll("h1") ?? []),
    ];
    expect(h1s).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("the layout screen renders accessibly with a single, well-ordered heading", async () => {
    // Navigate to the layout screen (its own <h1> "Disposición" is then the sole heading; the shell's
    // nav chrome carries none), and scan the composed tree in this theme.
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-layout]")!.click();
    await flush(el);
    const layout = el.shadowRoot!.querySelector("dashboard-layout-screen");
    expect(layout).toBeTruthy();
    const h1s = [
      ...el.shadowRoot!.querySelectorAll("h1"),
      ...(layout!.shadowRoot?.querySelectorAll("h1") ?? []),
    ];
    expect(h1s).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("the receipt screen renders accessibly with a single, well-ordered heading", async () => {
    // Navigate to the receipt screen (its own <h1> "Recibo" is then the sole heading; the shell's nav
    // chrome carries none), and scan the composed tree in this theme.
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-receipt]")!.click();
    await flush(el);
    const receipt = el.shadowRoot!.querySelector("dashboard-receipt-screen");
    expect(receipt).toBeTruthy();
    const h1s = [
      ...el.shadowRoot!.querySelectorAll("h1"),
      ...(receipt!.shadowRoot?.querySelectorAll("h1") ?? []),
    ];
    expect(h1s).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("the approvals screen renders accessibly with a single, well-ordered heading", async () => {
    // Navigate to the approvals screen (its own <h1> "Aprobaciones" is then the sole heading; the
    // shell's nav chrome carries none), and scan the composed tree in this theme.
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
    // Navigate to the planned-vs-actual screen (its own <h1> "Previsto vs real" is then the sole
    // heading; the shell's nav chrome carries none), and scan the composed tree in this theme.
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
    // Navigate to the purchases screen (its own <h1> "Compras" is then the sole heading; the shell's
    // nav chrome carries none), and scan the composed tree in this theme.
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
    // Navigate to the floor screen (its own <h1> "Sala" is then the sole heading; the shell's nav chrome
    // carries none, and the screen's panel headings are <h2>), and scan the composed tree in this theme.
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

  it("the recipe screen renders accessibly with a single, well-ordered heading", async () => {
    // Navigate to the recipe screen (its own <h1> "Recetas" is then the sole heading; the shell's nav
    // chrome carries none, and the screen's section headings are <h2>), and scan the composed tree in
    // this theme.
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-recipe]")!.click();
    await flush(el);
    const recipe = el.shadowRoot!.querySelector("dashboard-recipe-screen");
    expect(recipe).toBeTruthy();
    const h1s = [
      ...el.shadowRoot!.querySelectorAll("h1"),
      ...(recipe!.shadowRoot?.querySelectorAll("h1") ?? []),
    ];
    expect(h1s).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("the devices screen renders accessibly with a single, well-ordered heading", async () => {
    // Navigate to the devices screen (its own <h1> "Dispositivos" is then the sole heading; the shell's
    // nav chrome carries none, and the screen's section headings are <h2>), and scan the composed tree
    // in this theme.
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
