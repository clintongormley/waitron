import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./card-grid.js";
import type { TillCardGrid } from "./card-grid.js";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TabDef } from "../layout.js";

const counterTab: TabDef = {
  key: "counter",
  title: "Counter",
  columns: 12,
  cards: [
    { type: "product-grid", colSpan: 8, rowSpan: 6, config: { columns: 4 } },
    { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
    { type: "total", colSpan: 4, rowSpan: 1, config: {} },
    { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
  ],
};

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-card-grid a11y (%s theme)", (theme) => {
  it("a rendered counter tab has no violations", async () => {
    const store = new WorkingOrderStore();
    const { host } = await mountWidget<TillCardGrid>(
      "till-card-grid",
      { tab: counterTab, store },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
