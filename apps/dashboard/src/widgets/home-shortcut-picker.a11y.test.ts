import { afterEach, describe, expect, it } from "vitest";
import { chooseOptions } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { HomeShortcutPicker } from "./home-shortcut-picker.js";

afterEach(cleanupWidgets);

const options = [
  { value: "p-lemonade", label: "Lemonade" },
  { value: "p-lager", label: "Lager" },
  { value: "p-burger", label: "Burger" },
];

describe.each(["light", "dark"] as const)("home shortcut picker (%s)", (theme) => {
  it.each(["nothing chosen", "several chosen", "field error"] as const)(
    "renders %s accessibly",
    async (state) => {
      const { el, host } = await mountWidget<HomeShortcutPicker>(
        "dashboard-home-shortcut-picker",
        {
          options,
        },
        theme,
      );
      if (state === "several chosen" || state === "field error") {
        await chooseOptions(el.shadowRoot!.querySelector("wt-combobox")!, ["p-lager", "p-burger"]);
        await el.updateComplete;
      }
      if (state === "field error") {
        el.options = [];
        await el.updateComplete;
        el.shadowRoot!.querySelector<HTMLElement>('[data-test="add"]')!.click();
        await el.updateComplete;
        expect(el.shadowRoot!.querySelector("wt-combobox")!.error).not.toBe("");
      }
      await expectNoA11yViolations(host);
    },
  );
});
