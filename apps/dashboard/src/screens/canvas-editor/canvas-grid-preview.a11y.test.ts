import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../../widgets/test-helpers.js";
import "./canvas-grid-preview.js";
import type { CanvasGridPreview } from "./canvas-grid-preview.js";
import type { TabDef } from "./card-contracts.js";

/** Scanned in both shapes: the interactive editor canvas and the inert list thumbnail. */
const tab: TabDef = {
  key: "counter",
  title: "Counter",
  columns: 12,
  cards: [
    { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
    { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
  ],
};

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("canvas-grid-preview a11y (%s theme)", (theme) => {
  it("renders the interactive canvas (buttons, one selected) accessibly", async () => {
    const { el, host } = await mountWidget<CanvasGridPreview>(
      "canvas-grid-preview",
      { tab, interactive: true, selectedIndex: 0 },
      theme,
    );
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("renders the inert thumbnail accessibly", async () => {
    const { el, host } = await mountWidget<CanvasGridPreview>(
      "canvas-grid-preview",
      { tab, interactive: false },
      theme,
    );
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
