import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./category-create-form.js";

afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("Add category (%s)", (theme) => {
  it.each(["", "Hot dishes"])("renders accessibly with search %j", async (seed) => {
    const { el, host } = await mountWidget<HTMLElementTagNameMap["dashboard-category-create-form"]>(
      "dashboard-category-create-form",
      { open: true, seed, categories: [{ id: "food", name: "Food", parentId: null, color: null }] },
      theme,
    );
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    expect(modal.open).toBe(true);
    await expectNoA11yViolations(host);
  });
});
