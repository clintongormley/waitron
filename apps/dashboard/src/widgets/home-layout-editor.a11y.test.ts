import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { page } from "vitest/browser";
import type { HomeLayout } from "../api/client.js";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { MemberListEditor } from "./member-list-editor.js";
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

  it.each([
    "actions",
    "replacement",
    "invalid replacement",
    "refused replacement",
    "field refusal",
  ])("renders a missing tile's %s accessibly", async (state) => {
    const rows = layouts();
    rows[0]!.tiles[1] = {
      memberId: "t-missing",
      position: 1,
      ref: { kind: "missing", name: "Drinks › Beer" },
      name: "Drinks › Beer",
      missingName: "Drinks › Beer",
      reachable: false,
    };
    const { el, host } = await mountWidget<HomeLayoutEditor>(
      "dashboard-home-layout-editor",
      {
        layouts: rows,
        menuName: "Evening",
        sections: [{ id: "s-wines", internalName: "Drinks › Wines" }],
      },
      theme,
    );
    const list = el.shadowRoot!.querySelector<MemberListEditor>("dashboard-member-list-editor")!;
    await list.updateComplete;
    if (state === "actions") {
      const actions = list.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
        '[data-test="actions-t-missing"]',
      )!;
      await actions.updateComplete;
      actions.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
      await actions.updateComplete;
    } else {
      list.shadowRoot!.querySelector<HTMLElement>('[data-test="replace-t-missing"]')!.click();
      await list.updateComplete;
      if (state === "refused replacement" || state === "field refusal") {
        await chooseOption(
          list.shadowRoot!.querySelector('wt-combobox[name="member-ref"]')!,
          "section:s-wines",
        );
        el.replacementCompletion("t-missing")("Request refused", state === "field refusal");
        await list.updateComplete;
      }
      if (state === "invalid replacement") {
        list.shadowRoot!.querySelector<HTMLElement>('[data-test="add"]')!.click();
        await list.updateComplete;
      }
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
