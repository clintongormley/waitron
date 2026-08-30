import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./planned-actual-screen.js";
import type { PlannedActualScreen } from "./planned-actual-screen.js";
import type { DashboardApi, PersonSummary, PlannedVsActualRow } from "../api/client.js";

const staff: PersonSummary[] = [
  {
    personId: "p1",
    displayName: "Ana",
    role: "staff",
    status: "active",
    hasPassword: false,
    hasTotp: false,
    email: null,
  },
];
const locations = [{ id: "loc-1", name: "Main" }];
const rows: PlannedVsActualRow[] = [
  {
    personId: "p1",
    workDate: "2026-03-02",
    plannedMinutes: 240,
    workedMinutes: 225,
    lateMinutes: 15,
    noShow: false,
    unplanned: false,
  },
  {
    personId: "p1",
    workDate: "2026-03-03",
    plannedMinutes: 0,
    workedMinutes: 90,
    lateMinutes: 0,
    noShow: true,
    unplanned: true,
  },
];

function stubApi(withRows: boolean): DashboardApi {
  return {
    getLocations: vi.fn().mockResolvedValue(locations),
    listStaff: vi.fn().mockResolvedValue(staff),
    getPlannedVsActual: vi.fn().mockResolvedValue(withRows ? rows : []),
  } as unknown as DashboardApi;
}
async function flush(el: PlannedActualScreen): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}
afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("planned-actual-screen a11y (%s theme)", (theme) => {
  it("renders the populated table accessibly", async () => {
    const { el, host } = await mountWidget<PlannedActualScreen>(
      "dashboard-planned-actual-screen",
      { api: stubApi(true) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the empty week accessibly", async () => {
    const { el, host } = await mountWidget<PlannedActualScreen>(
      "dashboard-planned-actual-screen",
      { api: stubApi(false) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
