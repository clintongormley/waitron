import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./floor-plan-editor.js";
import type { FloorPlanEditor } from "./floor-plan-editor.js";
import type { DashboardApi, FloorPlan } from "../api/client.js";

const originalUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  history.replaceState(null, "", originalUrl);
});

const plan: FloorPlan = {
  zoneId: "z1",
  revision: 0,
  savedAt: null,
  tables: [
    {
      id: "m1",
      liveTableId: "l1",
      label: "T1",
      seats: 4,
      fixed: false,
      placement: { x: 2, y: 3, width: 8, height: 8, shape: "rect", rotation: 0 },
    },
    {
      id: "m2",
      liveTableId: "l2",
      label: "T2",
      seats: 2,
      fixed: true,
      placement: { x: 14, y: 3, width: 6, height: 6, shape: "round", rotation: 0 },
    },
  ],
  joins: [],
};

function stubApi(getFloorPlan: DashboardApi["getFloorPlan"]): DashboardApi {
  return {
    getFloorPlan,
    listZones: vi
      .fn()
      .mockResolvedValue([{ id: "z1", name: "Terrace", displayOrder: 0, active: true }]),
    listTables: vi.fn().mockResolvedValue([]),
  } as unknown as DashboardApi;
}

async function open(api: DashboardApi, theme: "light" | "dark") {
  history.replaceState(null, "", "/manage/floor-plan/zone/z1");
  const mounted = await mountWidget<FloorPlanEditor>("dashboard-floor-plan-editor", { api }, theme);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await mounted.el.updateComplete;
  return mounted;
}

describe.each(["light", "dark"] as const)("floor-plan-editor a11y (%s theme)", (theme) => {
  it("shows a loaded plan accessibly", async () => {
    const { host } = await open(stubApi(vi.fn().mockResolvedValue(plan)), theme);
    await expectNoA11yViolations(host);
  });

  it("shows a selected table accessibly", async () => {
    const { el, host } = await open(stubApi(vi.fn().mockResolvedValue(plan)), theme);
    el.shadowRoot!.querySelector("wt-floor-plan-canvas")!.dispatchEvent(
      new CustomEvent("wt-table-select", { detail: { key: "m1" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("shows a load failure accessibly", async () => {
    const { host } = await open(
      stubApi(vi.fn().mockRejectedValue({ code: "zone.not_found" })),
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
