import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { FLOOR_MAP_FILLS } from "../floor-map-fills.js";
import type { PlanPlacement } from "../floor-plan-geometry.js";
import type { FloorMapTable, WtFloorMap } from "./wt-floor-map.js";
import "./wt-floor-map.js";

afterEach(cleanup);

const t = (
  id: string,
  placement: Partial<PlanPlacement>,
  over: Partial<FloorMapTable> = {},
): FloorMapTable => ({
  id,
  label: id,
  placement: { x: 0, y: 0, width: 6, height: 6, shape: "rect", rotation: 0, ...placement },
  fill: "free",
  dot: null,
  joinId: null,
  description: "Free",
  ...over,
});

async function mountMap(theme: "light" | "dark", tables: FloorMapTable[]): Promise<void> {
  const el = (await mountThemed(
    '<wt-floor-map style="width: 480px; height: 240px"></wt-floor-map>',
    theme,
  )) as WtFloorMap;
  el.reducedMotion = true;
  el.tables = tables;
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("wt-floor-map a11y (%s theme)", (theme) => {
  test("one table in each fill", async () => {
    await mountMap(
      theme,
      FLOOR_MAP_FILLS.map((fill, i) =>
        t(`T${i + 1}`, { x: i * 8, shape: i % 2 ? "round" : "rect" }, { fill }),
      ),
    );
    await expectNoA11yViolations(host);
  });

  test("a ready dot and a forgotten dot", async () => {
    await mountMap(theme, [
      t("T1", { x: 0 }, { fill: "seated", dot: "ready", description: "Seated, 2 ready" }),
      t("T2", { x: 8 }, { fill: "seated", dot: "forgotten", description: "Seated, forgotten" }),
    ]);
    await expectNoA11yViolations(host);
  });

  test("a merge, and a name too small to draw", async () => {
    await mountMap(theme, [
      t("Terrace 4", { x: 0 }, { joinId: "j1", fill: "bill" }),
      t("Terrace 5", { x: 6 }, { joinId: "j1", fill: "bill" }),
      t("Stool 1", { x: 40, y: 20, width: 1, height: 1, rotation: 45 }),
    ]);
    await expectNoA11yViolations(host);
  });

  test("a table held", async () => {
    await mountMap(theme, [t("T1", { x: 0 }), t("T2", { x: 8 })]);
    host
      .querySelector("wt-floor-map")!
      .shadowRoot!.querySelector('[data-table-id="T1"]')!
      .setAttribute("data-held", "");
    await expectNoA11yViolations(host);
  });

  test("no tables", async () => {
    await mountMap(theme, []);
    await expectNoA11yViolations(host);
  });
});
