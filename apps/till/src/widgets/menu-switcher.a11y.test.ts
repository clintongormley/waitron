import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./menu-switcher.js";
import type { TillMenuSwitcher } from "./menu-switcher.js";

const twoMenus = [
  { id: "cat-food", name: "Food", isDefault: true },
  { id: "cat-drinks", name: "Drinks", isDefault: false },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-menu-switcher a11y (%s theme)", (theme) => {
  it("a segmented control of menus has no violations", async () => {
    const { host } = await mountWidget<TillMenuSwitcher>(
      "till-menu-switcher",
      { menus: twoMenus, selectedId: "cat-food" },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
