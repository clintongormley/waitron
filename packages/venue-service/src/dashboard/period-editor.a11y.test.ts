import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
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
        endOffsetMinutes: 0,
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

describe.each(["en", "es"] as const)("Offset form (%s)", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    test.each([1280, 390])("at %s px", async (width) => {
      setLocale(locale);
      await page.viewport(width, 900);
      try {
        for (const state of ["zero", "negative", "positive", "invalid", "refused"] as const) {
          const el = (await mountThemed("<period-editor></period-editor>", theme)) as PeriodEditor;
          el.departmentName = "Restaurant";
          el.menus = [
            { id: "lunch", name: "Lunch menu", active: true, includes: [] },
            { id: "staff", name: "Staff snacks", active: true, includes: [] },
          ];
          const offset = state === "negative" ? -15 : state === "positive" ? 14 : 0;
          el.period = {
            id: "p1",
            name: "Lunch",
            colour: "green",
            menuId: "lunch",
            staffMenuIds: ["staff"],
            endOffsetMinutes: offset,
            weekdays: [1],
          };
          el.open = true;
          await el.updateComplete;
          const control =
            el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
              "[name=endOffsetMinutes]",
            )!;
          await control.updateComplete;
          expect(control.shadowRoot!.querySelector("input")!.value).toBe(String(offset));
          if (state === "invalid" || state === "refused") {
            control.dispatchEvent(
              new CustomEvent("wt-change", {
                detail: { value: state === "invalid" ? "1.5" : "15" },
                bubbles: true,
                composed: true,
              }),
            );
            await el.updateComplete;
            el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!.click();
            if (state === "refused")
              el.refusal = {
                code: "menu_period.invalid",
                params: { field: "endOffsetMinutes", reason: "placement" },
              };
            await el.updateComplete;
            expect(control.error).not.toBe("");
            expect(
              el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
                "[data-test=save-period]",
              )!.disabled,
            ).toBe(state === "invalid");
          }
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `../__screenshots__/a432-editor/${state}-${locale}-${theme}-${width}.png`,
          });
          cleanup();
        }
      } finally {
        await page.viewport(1280, 768);
      }
    });
  });
});
