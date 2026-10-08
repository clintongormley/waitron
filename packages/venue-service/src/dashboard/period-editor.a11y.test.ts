import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { PeriodEditor } from "./period-editor.js";
import "./period-editor.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Period editor (%s)", (theme) => {
  test.each(["new", "edit", "invalid", "refused", "saving"])("%s", async (state) => {
    setLocale("en");
    const el = (await mountThemed("<period-editor></period-editor>", theme)) as PeriodEditor;
    el.departmentName = "Restaurant";
    el.menus = [
      { id: "lunch", name: "Lunch", active: true, includes: ["drinks"] },
      { id: "drinks", name: "Drinks", active: true, includes: [] },
      { id: "deli", name: "Deli", active: true, includes: [] },
    ];
    if (state === "edit" || state === "refused" || state === "saving") {
      el.period = {
        id: "p1",
        name: "Lunch",
        colour: "green",
        menuId: "lunch",
        staffMenuIds: ["deli"],
        weekdays: [1],
      };
    }
    el.open = true;
    await el.updateComplete;
    const name = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
    if (state === "invalid") {
      name.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Dinner" } }));
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!.click();
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=menuId]")!.error,
      ).toBe("Choose a menu.");
    }
    if (state === "refused") el.refusal = { code: "menu_period.name_taken" };
    if (state === "saving") {
      name.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Dinner" } }));
      el.busy = true;
    }
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
