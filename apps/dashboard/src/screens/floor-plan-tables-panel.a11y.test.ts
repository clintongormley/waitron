import { afterEach, describe, expect, it } from "vitest";
import type { WtSheet } from "@waitron/ui";
import "@waitron/ui/src/components/wt-sheet.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./floor-plan-tables-panel.js";
import type { FloorPlanTablesPanel } from "./floor-plan-tables-panel.js";
import type { DraftTable, FloorPlanDraft } from "./floor-plan-draft.js";

afterEach(cleanupWidgets);

const table = (key: string, label: string, placed: boolean, seats: number | null): DraftTable => ({
  key,
  id: key,
  liveTableId: null,
  label,
  seats,
  fixed: false,
  placement: placed ? { x: 0, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 } : null,
});

const props: Partial<FloorPlanTablesPanel> = {
  draft: {
    tables: [
      table("m1", "T1", true, 4),
      table("m2", "T2", false, 2),
      table("m3", "T3", true, null),
      table("m4", "T4", false, null),
    ],
    joins: [],
  } satisfies FloorPlanDraft,
  selected: "m3",
  marks: new Map([["m4", "Booked 12 Oct, 21:00"]]),
};

// axe does not judge a non-text marker, so its colour is measured against what it is drawn on.
// The parser reads rgb()/rgba() only, which is why each colour is checked for that form first.
function contrastRatio(a: string, b: string): number {
  const luminance = (rgb: string) => {
    expect(rgb).toMatch(/^rgba?\(/);
    const [r, g, bl] = rgb
      .match(/\d+(\.\d+)?/g)!
      .slice(0, 3)
      .map((part) => Number(part) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

function tokenColour(host: HTMLElement, token: string): string {
  const probe = document.createElement("div");
  probe.style.background = `var(${token})`;
  host.append(probe);
  const colour = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return colour;
}

describe.each(["light", "dark"] as const)("floor-plan-tables-panel a11y (%s theme)", (theme) => {
  it("shows placed, spare, selected and marked rows accessibly", async () => {
    const { el, host } = await mountWidget<FloorPlanTablesPanel>(
      "floor-plan-tables-panel",
      props,
      theme,
    );
    await el.updateComplete;
    await expectNoA11yViolations(host);

    const marker = (key: string) =>
      getComputedStyle(el.shadowRoot!.querySelector(`[data-table=${key}] [data-marker]`)!);
    const selectedRow = getComputedStyle(el.shadowRoot!.querySelector("[data-table=m3]")!);
    for (const ground of ["--wt-color-bg", "--wt-color-surface"]) {
      const behind = tokenColour(host, ground);
      expect(contrastRatio(marker("m2").borderTopColor, behind)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(marker("m1").backgroundColor, behind)).toBeGreaterThanOrEqual(3);
    }
    expect(
      contrastRatio(marker("m3").backgroundColor, selectedRow.backgroundColor),
    ).toBeGreaterThanOrEqual(3);
  });

  it("shows the list inside a sheet accessibly", async () => {
    const { el: sheet, host } = await mountWidget<WtSheet>(
      "wt-sheet",
      { heading: "Tables", expanded: true },
      theme,
    );
    const panel = document.createElement("floor-plan-tables-panel");
    Object.assign(panel, props, { inSheet: true });
    sheet.append(panel);
    await sheet.updateComplete;
    await panel.updateComplete;
    await expectNoA11yViolations(host);
    const spare = getComputedStyle(
      panel.shadowRoot!.querySelector("[data-table=m2] [data-marker]")!,
    );
    expect(
      contrastRatio(spare.borderTopColor, tokenColour(host, "--wt-color-surface")),
    ).toBeGreaterThanOrEqual(3);
  });
});
