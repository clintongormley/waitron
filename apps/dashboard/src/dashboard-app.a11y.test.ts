import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./widgets/test-helpers.js";
import "./dashboard-app.js";
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
  },
  {
    personId: "p2",
    displayName: "Bea",
    role: "staff",
    status: "suspended",
    hasPassword: false,
    hasTotp: false,
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

  it("the staff screen renders accessibly with a single, well-ordered heading", async () => {
    // A resolved probe lands on staff. The staff screen renders the ONLY <h1> ("Usuarios"); the
    // shell's own chrome (the logout button) carries no competing heading, so the outline stays clean.
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue(people) });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
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
});
