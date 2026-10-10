import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { PlanCanvasTable, WtFloorPlanCanvas } from "./wt-floor-plan-canvas.js";
import "./wt-floor-plan-canvas.js";

afterEach(cleanup);

const tables: PlanCanvasTable[] = [
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
    fixed: false,
    placement: { x: 24, y: 2, width: 2, height: 2, shape: "rect", rotation: 45 },
  },
];

async function mountCanvas(
  theme: "light" | "dark",
  props: Partial<Pick<WtFloorPlanCanvas, "tables" | "selected">>,
): Promise<void> {
  const el = (await mountThemed(
    '<wt-floor-plan-canvas style="width: 480px; height: 240px"></wt-floor-plan-canvas>',
    theme,
  )) as WtFloorPlanCanvas;
  Object.assign(el, props);
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("wt-floor-plan-canvas a11y (%s theme)", (theme) => {
  test("no tables", async () => {
    await mountCanvas(theme, { tables: [] });
    await expectNoA11yViolations(host);
  });

  test("tables, none selected", async () => {
    await mountCanvas(theme, { tables: tables.slice(0, 1) });
    await expectNoA11yViolations(host);
  });

  test("a table selected, one fixed, one too small for its name", async () => {
    await mountCanvas(theme, { tables, selected: "t1" });
    await expectNoA11yViolations(host);
  });

  test("a selected table with its rotation handle above it", async () => {
    const lowered = tables.map((t) => ({ ...t, placement: { ...t.placement, y: 8 } }));
    await mountCanvas(theme, { tables: lowered, selected: "b1" });
    await expectNoA11yViolations(host);
  });

  test("refused tables, outlined with their reasons, one selected and one round", async () => {
    const refused = [
      { ...tables[0]!, refused: "Booked 12 Oct, 21:00" },
      { ...tables[1]!, refused: "Booked 13 Oct, 13:30" },
      tables[2]!,
    ];
    await mountCanvas(theme, { tables: refused, selected: "t1" });
    await expectNoA11yViolations(host);
  });

  test("a selected table at the top with its rotation handle below it", async () => {
    await mountCanvas(theme, { tables, selected: "b1" });
    await expectNoA11yViolations(host);
  });
});
