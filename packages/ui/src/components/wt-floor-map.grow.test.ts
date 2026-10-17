import { afterEach, expect, it, vi } from "vitest";
import { cleanup, mountInShadowRoot } from "../test-helpers.js";
import type { PlanPlacement } from "../floor-plan-geometry.js";
import type { FloorMapTable, WtFloorMap } from "./wt-floor-map.js";
import "./wt-floor-map.js";

const t = (id: string, label: string, placement: Partial<PlanPlacement> = {}): FloorMapTable => ({
  id,
  label,
  placement: { x: 0, y: 0, width: 8, height: 4, shape: "rect", rotation: 0, ...placement },
  fill: "free",
  dot: null,
  joinId: null,
  description: "Free",
});

// Its crop is 12 × 8 squares.
const t1 = t("t1", "T1", { x: 10, y: 5 });

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

async function settled(el: WtFloorMap): Promise<void> {
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
}

async function map(tables: FloorMapTable[]): Promise<WtFloorMap> {
  const el = (await mountInShadowRoot(
    `<wt-floor-map style="width: 600px; height: 300px"></wt-floor-map>`,
  )) as WtFloorMap;
  el.tables = tables;
  await settled(el);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return el;
}

const ratioOf = (el: WtFloorMap) => el.style.getPropertyValue("--floor-map-ratio");

it("publishes its tables' crop, width over height, as --floor-map-ratio on its own host", async () => {
  const el = await map([t1]);
  expect(Number(ratioOf(el))).toBe(12 / 8);
});

it("publishes a ratio of 1 with no tables", async () => {
  const el = await map([]);
  expect(ratioOf(el)).toBe("1");
});

it("publishes the new crop's ratio when the tables are replaced", async () => {
  const el = await map([t1]);
  el.tables = [t1, t("t2", "T2", { x: 22, y: 5, width: 4, height: 4 })];
  await el.updateComplete;
  expect(Number(ratioOf(el))).toBe(20 / 8);
});
