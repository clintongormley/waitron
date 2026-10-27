import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { stationColumnNames } from "./station-queue.js";
import type { KitchenColumnsDialog } from "./kitchen-columns-dialog.js";
import "./kitchen-columns-dialog.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("the Columns window a11y (%s theme)", (theme) => {
  it("the Columns window, with a hidden column and both ends' arrows disabled, has no violations", async () => {
    const { el, host } = await mountWidget<KitchenColumnsDialog>(
      "till-kitchen-columns-dialog",
      {
        layout: { order: ["waiting", "preparing", "ready"], hidden: ["preparing"], collapsed: [] },
        names: stationColumnNames(),
        boardName: "Grill",
        opener: null,
      },
      theme,
    );
    await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
    expect(el.shadowRoot!.querySelector('[data-column-show="preparing"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
