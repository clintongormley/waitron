import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page } from "vitest/browser";
import type { WtSheet } from "@waitron/ui";
import { draftFromPlan, patchTable } from "./floor-plan-draft.js";
import { currentLocale, setLocale } from "../i18n/t.js";
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

function stubApi(
  getFloorPlan: DashboardApi["getFloorPlan"],
  saveFloorPlan?: DashboardApi["saveFloorPlan"],
): DashboardApi {
  return {
    getFloorPlan,
    saveFloorPlan,
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

  it("shows an older copy's message with Load newer plan accessibly", async () => {
    const { el, host } = await open(
      stubApi(
        vi.fn().mockResolvedValue(plan),
        vi.fn().mockRejectedValue({ code: "floor_plan.out_of_date", params: { zoneId: "z1" } }),
      ),
      theme,
    );
    el.shadowRoot!.querySelector("wt-floor-plan-canvas")!.dispatchEvent(
      new CustomEvent("wt-table-move", {
        detail: { key: "m1", x: 5, y: 4 },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("wt-button[data-action=save]")!.click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("wt-button[data-action=load-newer]"))
      .not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("shows the tables list accessibly", async () => {
    const before = [window.innerWidth, window.innerHeight] as const;
    await page.viewport(1280, 800);
    onTestFinished(() => page.viewport(...before));
    const { el, host } = await open(stubApi(vi.fn().mockResolvedValue(plan)), theme);
    await expect
      .poll(() => el.shadowRoot!.querySelector(".side floor-plan-tables-panel"))
      .not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("shows the sheet collapsed and expanded at 390 px accessibly", async () => {
    const before = [window.innerWidth, window.innerHeight] as const;
    await page.viewport(390, 844);
    onTestFinished(() => page.viewport(...before));
    const { el, host } = await open(stubApi(vi.fn().mockResolvedValue(plan)), theme);
    const sheet = () => el.shadowRoot!.querySelector<WtSheet>("wt-sheet");
    await expect.poll(sheet).not.toBeNull();
    await expectNoA11yViolations(host);
    sheet()!.shadowRoot!.querySelector<HTMLElement>("button")!.click();
    await sheet()!.updateComplete;
    await el.updateComplete;
    expect(sheet()!.expanded).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("heads the sheet Tables when the selected table has no name, accessibly", async () => {
    const before = [window.innerWidth, window.innerHeight] as const;
    await page.viewport(390, 844);
    onTestFinished(() => page.viewport(...before));
    const locale = currentLocale();
    setLocale("en-GB");
    onTestFinished(() => setLocale(locale));
    const { el, host } = await open(stubApi(vi.fn().mockResolvedValue(plan)), theme);
    const sheet = () => el.shadowRoot!.querySelector<WtSheet>("wt-sheet");
    await expect.poll(sheet).not.toBeNull();
    el.shadowRoot!.querySelector("wt-floor-plan-canvas")!.dispatchEvent(
      new CustomEvent("floor-plan-change", {
        detail: { draft: patchTable(draftFromPlan(plan), "m2", { label: " " }) },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("wt-button[data-action=save]")!.click();
    await el.updateComplete;
    expect(sheet()!.expanded).toBe(true);
    expect(sheet()!.heading).toBe("Tables");
    await sheet()!.updateComplete;
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
