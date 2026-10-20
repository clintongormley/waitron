import { afterEach, describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { FLOOR_MAP_FILLS, type FloorMapCue, type FloorMapFill } from "../floor-map-fills.js";
import type { PlanPlacement } from "../floor-plan-geometry.js";
import type { FloorMapTable, WtFloorMap } from "./wt-floor-map.js";
import "./wt-floor-map.js";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const t = (
  id: string,
  placement: Partial<PlanPlacement>,
  over: Partial<FloorMapTable> = {},
): FloorMapTable => ({
  id,
  label: id,
  placement: { x: 0, y: 0, width: 6, height: 6, shape: "rect", rotation: 0, ...placement },
  fill: "free",
  outline: null,
  pulse: null,
  cue: null,
  joinId: null,
  description: "Free",
  ...over,
});

function press(type: string, target: EventTarget, at: { x: number; y: number }): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "touch",
      clientX: at.x,
      clientY: at.y,
    }),
  );
}

const centreOf = (element: Element) => {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};

async function mountMap(
  theme: "light" | "dark",
  tables: FloorMapTable[],
  reducedMotion = true,
): Promise<void> {
  const el = (await mountThemed(
    '<wt-floor-map style="width: 480px; height: 240px"></wt-floor-map>',
    theme,
  )) as WtFloorMap;
  el.reducedMotion = reducedMotion;
  el.tables = tables;
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("wt-floor-map a11y (%s theme)", (theme) => {
  test("A669 allergy marks alongside pulses, including a merge", async () => {
    await mountMap(
      theme,
      [
        t("T1", { x: 0 }, { allergy: true, fill: "calm", pulse: "overdue" }),
        t("T2", { x: 8 }, { allergy: true, fill: "danger", pulse: "forgotten", joinId: "j" }),
        t("T3", { x: 14 }, { allergy: true, fill: "danger", pulse: "forgotten", joinId: "j" }),
        t("T4", { x: 30, width: 1, height: 1 }, { allergy: true }),
      ],
      false,
    );
    const root = host.querySelector("wt-floor-map")!.shadowRoot!;
    expect(root.querySelectorAll('[part="allergy"]')).toHaveLength(3);
    expect(root.querySelectorAll("[data-pulse]")).toHaveLength(3);
    await expectNoA11yViolations(host);
  });

  test("one table in each of the nine fills", async () => {
    await mountMap(
      theme,
      FLOOR_MAP_FILLS.map((fill, i) =>
        t(`T${i + 1}`, { x: i * 8, shape: i % 2 ? "round" : "rect" }, { fill }),
      ),
    );
    const root = host.querySelector("wt-floor-map")!.shadowRoot!;
    expect(root.querySelectorAll('[part="table"]')).toHaveLength(9);
    await expectNoA11yViolations(host);
  });

  test("each outline and pulse, with a cue on every fill", async () => {
    const looks: Partial<FloorMapTable>[] = [
      { fill: "calm", outline: "overdue", pulse: "overdue" },
      { fill: "ready", outline: "waiting" },
      { fill: "free", outline: "clearing" },
      { fill: "danger", outline: "clearing", pulse: "forgotten" },
      { fill: "warning", pulse: "fire" },
    ];
    await mountMap(
      theme,
      looks.map((look, i) =>
        t(`T${i + 1}`, { x: i * 8 }, { ...look, cue: { icon: "floor-timer", text: "5" } }),
      ),
      false,
    );
    const root = host.querySelector("wt-floor-map")!.shadowRoot!;
    expect(root.querySelectorAll('[part="cue"]')).toHaveLength(looks.length);
    expect(root.querySelectorAll("[data-pulse]")).toHaveLength(3);
    expect(root.querySelectorAll("[data-outline]")).toHaveLength(4);
    await expectNoA11yViolations(host);
  });

  test("each new fill with its cue", async () => {
    const looks: [FloorMapFill, FloorMapCue, string][] = [
      ["calm", { icon: "floor-timer", text: "Waiting" }, "Seated, Waiting"],
      ["ready", { icon: "floor-ready", text: "2" }, "Seated, 2 ready"],
      ["danger", { icon: "floor-timer", text: "Forgotten" }, "Seated, Forgotten order"],
      ["warning", { icon: "floor-out", text: "Out" }, "Seated, Unavailable: Paella"],
      ["plain", { icon: "floor-clear", text: "Clear" }, "Needs clearing"],
      ["bill", { icon: "floor-bill", text: "Bill" }, "Seated, Bill requested"],
      ["calm", { icon: "floor-held", text: "12′" }, "Seated, Held, fire in 12 minutes"],
      ["reserved", { icon: null, text: "21:00" }, "Reserved 21:00"],
      ["calm", { icon: "floor-check", text: "" }, "Seated, Nothing needed"],
    ];
    await mountMap(
      theme,
      looks.map(([fill, cue, description], i) =>
        t(`T${i + 1}`, { x: i * 8 }, { fill, cue, description }),
      ),
    );
    const root = host.querySelector("wt-floor-map")!.shadowRoot!;
    expect(root.querySelectorAll('[part="cue"]')).toHaveLength(looks.length);
    await expectNoA11yViolations(host);
  });

  test("Overdue, Waiting and Needs clearing outlines over fills", async () => {
    await mountMap(theme, [
      t("T1", { x: 0 }, { fill: "calm", outline: "overdue" }),
      t("T2", { x: 8 }, { fill: "bill", outline: "overdue" }),
      t("T3", { x: 16 }, { fill: "ready", outline: "waiting" }),
      t("T4", { x: 24 }, { fill: "plain", outline: "clearing" }),
      t("T5", { x: 32 }, { fill: "free", outline: "clearing" }),
    ]);
    const root = host.querySelector("wt-floor-map")!.shadowRoot!;
    expect(root.querySelectorAll("[data-ring]")).toHaveLength(3);
    expect(root.querySelectorAll('[data-outline="clearing"]')).toHaveLength(2);
    await expectNoA11yViolations(host);
  });

  test("a forgotten, an overdue and a due pulse, moving", async () => {
    await mountMap(
      theme,
      [
        t("T1", { x: 0 }, { fill: "danger", pulse: "forgotten" }),
        t("T2", { x: 8 }, { fill: "calm", outline: "overdue", pulse: "overdue" }),
        t("T3", { x: 16 }, { fill: "warning", pulse: "fire" }),
      ],
      false,
    );
    const root = host.querySelector("wt-floor-map")!.shadowRoot!;
    const pulses = [...root.querySelectorAll<HTMLElement>("[data-pulse]")];
    expect(pulses.map((p) => p.dataset["pulse"])).toEqual(["forgotten", "overdue", "fire"]);
    expect(pulses.every((p) => p.getAnimations().length > 0)).toBe(true);
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

  test("a fixed table's copy over a target", async () => {
    await mountMap(theme, [t("T1", { x: 8 }, { fixed: true }), t("T2", { x: 0 })]);
    const el = host.querySelector("wt-floor-map")!;
    const root = el.shadowRoot!;
    const shapeOf = (id: string) => root.querySelector(`[data-table-id="${id}"] [part="shape"]`)!;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    press("pointerdown", shapeOf("T1"), centreOf(shapeOf("T1")));
    vi.advanceTimersByTime(500);
    press("pointermove", window, centreOf(shapeOf("T2")));
    await el.updateComplete;
    expect(root.querySelector('[part="ghost"]')).not.toBeNull();
    expect(root.querySelector('[part="drag-link"]')).not.toBeNull();
    expect(root.querySelector('[data-table-id="T2"]')!.hasAttribute("data-drop-target")).toBe(true);
    vi.useRealTimers();
    await expectNoA11yViolations(host);
  });

  test("a linked party", async () => {
    await mountMap(theme, [
      t("Bar 1", { x: 0 }, { linkId: "p1", fill: "seated" }),
      t("Bar 2", { x: 12 }, { linkId: "p1", fill: "seated" }),
      t("T3", { x: 0, y: 8 }),
    ]);
    const root = host.querySelector("wt-floor-map")!.shadowRoot!;
    const lines = root.querySelectorAll('[part="links"] line');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBeInstanceOf(SVGLineElement);
    await expectNoA11yViolations(host);
  });

  test("focus on the second table after an arrow key", async () => {
    await mountMap(theme, [t("T1", { x: 0 }), t("T2", { x: 8 })]);
    const root = host.querySelector("wt-floor-map")!.shadowRoot!;
    root.querySelector<HTMLElement>('[data-table-id="T1"]')!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(root.activeElement?.getAttribute("tabindex")).toBe("0");
    await expectNoA11yViolations(host);
  });

  test("no tables", async () => {
    await mountMap(theme, []);
    await expectNoA11yViolations(host);
  });
});
