import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../../widgets/test-helpers.js";
import "./canvas-grid-preview.js";
import type { CanvasGridPreview } from "./canvas-grid-preview.js";
import type { TabDef } from "./card-contracts.js";

afterEach(cleanupWidgets);
const tab: TabDef = {
  key: "counter",
  title: "Counter",
  columns: 12,
  cards: [
    { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
    { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
  ],
};

describe("canvas-grid-preview", () => {
  it("renders one tile per card with the tab's column count and per-card spans", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", { tab });
    await el.updateComplete;
    const grid = el.shadowRoot!.querySelector<HTMLElement>("[data-test=grid]")!;
    expect(grid.style.gridTemplateColumns).toContain("repeat(12,");
    const tiles = el.shadowRoot!.querySelectorAll("[data-test^=tile-]");
    expect(tiles.length).toBe(2);
    expect(el.shadowRoot!.querySelector<HTMLElement>("[data-test=tile-0]")!.style.gridColumn).toBe(
      "span 8",
    );
    expect(el.shadowRoot!.querySelector<HTMLElement>("[data-test=tile-0]")!.style.gridRow).toBe(
      "span 6",
    );
  });
  it("emits select-card with the index when interactive and a tile is clicked", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab,
      interactive: true,
    });
    await el.updateComplete;
    let got = -1;
    el.addEventListener("select-card", (e) => {
      got = (e as CustomEvent<{ index: number }>).detail.index;
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=tile-1]")!.click();
    expect(got).toBe(1);
  });
  it("marks the selected tile and is inert (aria-hidden, no buttons) when not interactive", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab,
      interactive: false,
      selectedIndex: 0,
    });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=grid]")!.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(el.shadowRoot!.querySelectorAll("button").length).toBe(0);
  });
  it("renders nothing when tab is null (caller between selections)", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", { tab: null });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=grid]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=empty-grid]")).toBeNull();
  });
  it("renders an empty-grid affordance for a tab with no cards", async () => {
    const { el } = await mountWidget<CanvasGridPreview>("canvas-grid-preview", {
      tab: { ...tab, cards: [] },
      interactive: true,
    });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=empty-grid]")).toBeTruthy();
  });
});
