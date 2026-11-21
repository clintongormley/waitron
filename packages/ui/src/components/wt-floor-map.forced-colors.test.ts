import { afterEach, describe, expect, it } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { cleanup, elementPixels, emulateForcedColours, host, mount } from "../test-helpers.js";
import type { FloorMapTable, WtFloorMap } from "./wt-floor-map.js";
import "./wt-floor-map.js";

afterEach(async () => {
  cleanup();
  await emulateForcedColours(null);
  await commands.emulateColorScheme(null);
});

function table(id: string, x: number, state: Partial<FloorMapTable> = {}, size = 4): FloorMapTable {
  return {
    id,
    label: id,
    placement: { x, y: 0, width: size, height: size, shape: "rect", rotation: 0 },
    fill: "free",
    outline: null,
    pulse: null,
    cue: null,
    joinId: null,
    description: "Free",
    ...state,
  };
}

async function map(theme: "light" | "dark", tables: FloorMapTable[], still = false) {
  await page.viewport(560, 400);
  await commands.emulateColorScheme(theme);
  await emulateForcedColours("active");
  const el = (await mount(
    '<wt-floor-map style="width: 476px; height: 256px"></wt-floor-map>',
  )) as WtFloorMap;
  host.dataset["theme"] = theme;
  el.tables = tables;
  el.reducedMotion = still;
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
  return el;
}

function button(el: WtFloorMap, id: string) {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(`[data-table-id="${id}"]`)!;
}

async function paintedBands(el: WtFloorMap, shape: Element, rows: number[]) {
  const box = shape.getBoundingClientRect();
  const outer = el.getBoundingClientRect();
  const at = await elementPixels(el);
  const canvas = String(at(outer.left + 2, outer.top + 2));
  return rows.map((dy) =>
    Array.from({ length: 12 }, (_, x) => box.left + box.width / 2 - 6 + x).some(
      (x) => String(at(x, box.top + dy + 0.5)) !== canvas,
    ),
  );
}

describe.each(["light", "dark"] as const)("forced colours in %s", (theme) => {
  it("keeps separate forgotten, held and keyboard focus lines around a joined table", async () => {
    const joined = { joinId: "joined", pulse: "forgotten", outline: "overdue" } as const;
    const el = await map(theme, [table("A", 0, joined), table("B", 4, joined), table("C", 9)]);
    const selected = button(el, "A");
    await userEvent.keyboard("{Tab}");
    // Isolate the visible held state from pointer timing and drag movement.
    selected.setAttribute("data-held", "");
    expect(selected.matches(":focus-visible")).toBe(true);
    const shape = selected.querySelector('[part="shape"]')!;
    expect(await paintedBands(el, button(el, "C"), [-1, 0])).toEqual([false, true]);
    // Outside to inside: focus, gap, selection, gap, forgotten, gap, table edge, overdue.
    const bands = await paintedBands(el, shape, [-11, -9, -7, -5, -2, -1, 0, 3]);
    expect(bands).toEqual([true, false, true, false, true, false, true, true]);
  });

  it("keeps the forgotten mark on a small table with no caption and reduced motion", async () => {
    const el = await map(theme, [table("A", 0, { pulse: "forgotten" }, 1), table("B", 26)], true);
    const small = button(el, "A");
    expect(small.querySelector('[part="name"], [part="caption"]')).toBeNull();
    expect(await paintedBands(el, small, [-2, 0])).toEqual([true, true]);
  });

  it("keeps the clearing edge and the forgotten line on the same table", async () => {
    const el = await map(theme, [table("A", 0, { outline: "clearing", pulse: "forgotten" })]);
    expect(await paintedBands(el, button(el, "A"), [-3, -1, 1])).toEqual([true, false, true]);
  });
});
