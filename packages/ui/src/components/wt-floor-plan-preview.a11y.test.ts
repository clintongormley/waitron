import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { PreviewTable, WtFloorPlanPreview } from "./wt-floor-plan-preview.js";
import "./wt-floor-plan-preview.js";

afterEach(cleanup);

const tables: PreviewTable[] = [
  {
    key: "t1",
    label: "T1",
    fixed: false,
    placement: { x: 2, y: 2, width: 8, height: 4, shape: "rect", rotation: 0 },
  },
  {
    key: "t2",
    label: "T2",
    fixed: true,
    placement: { x: 14, y: 2, width: 6, height: 6, shape: "round", rotation: 0 },
  },
  {
    key: "b1",
    label: "Bar 1",
    fixed: true,
    placement: { x: 24, y: 2, width: 2, height: 2, shape: "rect", rotation: 45 },
  },
];

async function mountPreview(theme: "light" | "dark", list: PreviewTable[]): Promise<void> {
  const el = (await mountThemed(
    '<wt-floor-plan-preview style="width: 320px" label="Floor plan: Terrace"></wt-floor-plan-preview>',
    theme,
  )) as WtFloorPlanPreview;
  el.tables = list;
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("wt-floor-plan-preview a11y (%s theme)", (theme) => {
  test("tables drawn, round, turned and fixed", async () => {
    await mountPreview(theme, tables);
    await expectNoA11yViolations(host);
  });

  test("no tables", async () => {
    await mountPreview(theme, []);
    await expectNoA11yViolations(host);
  });
});
