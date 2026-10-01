import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { page } from "vitest/browser";
import type { HomeLayout } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { HomeLayoutEditor } from "./home-layout-editor.js";

afterEach(cleanupWidgets);

/** The default holds a product tile, a section tile and a tile whose product left the menu. */
function layouts(): HomeLayout[] {
  return [
    {
      id: "l-home",
      name: "Home",
      isDefault: true,
      tiles: [
        {
          memberId: "t-burger",
          position: 0,
          ref: { kind: "product", productId: "p-burger" },
          name: "Burger",
          reachable: true,
          missingName: null,
        },
        {
          memberId: "t-drinks",
          position: 1,
          ref: { kind: "section", sectionId: "s-drinks" },
          name: "Drinks",
          reachable: true,
          missingName: null,
        },
        {
          memberId: "t-salad",
          position: 2,
          ref: { kind: "product", productId: "p-salad" },
          name: "Salad",
          reachable: false,
          missingName: "Salad",
        },
      ],
    },
    { id: "l-counter", name: "Counter", isDefault: false, tiles: [] },
  ];
}

const states = ["populated", "empty-layout", "busy"] as const;

describe.each(["light", "dark"] as const)("home layout editor (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state) => {
    const { el, host } = await mountWidget<HomeLayoutEditor>(
      "dashboard-home-layout-editor",
      {
        layouts: layouts(),
        selected: state === "empty-layout" ? "l-counter" : "l-home",
        products: [{ id: "p-chips", name: "Chips" }],
        sections: [{ id: "s-beer", internalName: "Beer" }],
        busy: state === "busy",
        menuName: "Lunch Menu",
      },
      theme,
    );
    if (state === "populated") {
      // The states this scan must cover are on screen: a "Not on this menu" tile, both previews.
      expect(
        el.shadowRoot!.querySelector('[data-test="preview-handheld"] [data-tile="t-salad"]'),
      ).not.toBeNull();
      expect(el.shadowRoot!.querySelector('[data-test="preview-till"]')).not.toBeNull();
    }
    await expectNoA11yViolations(host);
  });

  it("renders accessibly at a phone's width", async () => {
    const frame = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(390, 900);
    onTestFinished(() => page.viewport(frame.width, frame.height));
    const { host } = await mountWidget<HomeLayoutEditor>(
      "dashboard-home-layout-editor",
      { layouts: layouts(), selected: "l-home", menuName: "Lunch Menu" },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
