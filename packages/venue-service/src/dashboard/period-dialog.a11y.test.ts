import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { PeriodDialog } from "./period-dialog.js";
import "./period-dialog.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Period dialog (%s)", (theme) => {
  test.each([
    "new",
    "edit",
    "invalid",
    "colour-invalid",
    "refused",
    "saving",
    "painted-in-links",
    "painted-in-plain",
    "not-painted",
    "add-from-page",
    "deletable",
  ])("%s", async (state) => {
    setLocale("en");
    const el = (await mountThemed("<period-dialog></period-dialog>", theme)) as PeriodDialog;
    el.departmentName = "Restaurant";
    el.menus = [
      { id: "lunch", name: "Lunch", active: true, includes: ["Drinks"] },
      { id: "drinks", name: "Drinks", active: true, includes: [] },
      { id: "deli", name: "Deli", active: true, includes: [] },
    ];
    if (state !== "new" && state !== "invalid" && state !== "add-from-page") {
      el.period = {
        id: "p1",
        name: "Lunch",
        colour: state === "colour-invalid" ? ("pink" as never) : "green",
        menuId: "lunch",
        staffMenuIds: ["deli"],
        endOffsetMinutes: 0,
        weekdays: [1],
        routingUses: [],
      };
    }
    if (state.startsWith("painted-in") || state === "not-painted") {
      el.seasons = [
        { id: "autumn", startsOn: "09-01" },
        { id: "winter", startsOn: "12-01" },
        { id: "spring", startsOn: "03-01" },
        { id: "summer", startsOn: "06-01" },
      ];
      el.departmentId = "restaurant";
      el.paintedInLinks = state === "painted-in-links";
      el.paintedIn =
        state === "not-painted"
          ? { seasons: [], specialDays: [] }
          : {
              seasons: [
                { id: "autumn", name: "Autumn" },
                { id: "winter", name: "Winter" },
                { id: "spring", name: "Spring" },
                { id: "summer", name: "Summer" },
              ],
              specialDays: [{ id: "sd1", name: "Company dinners" }],
            };
    }
    if (state === "deletable") el.deletable = true;
    if (state === "add-from-page")
      el.departments = [
        { id: "restaurant", name: "Restaurant", usedColours: ["red"] },
        { id: "bar", name: "Bar", usedColours: [] },
      ];
    el.open = true;
    await el.updateComplete;
    if (state.startsWith("painted-in"))
      expect(el.shadowRoot!.querySelectorAll("[data-test=painted-in] .chip")).toHaveLength(5);
    if (state === "not-painted")
      expect(el.shadowRoot!.querySelector("[data-test=not-painted]")).not.toBeNull();
    if (state === "deletable")
      expect(el.shadowRoot!.querySelector("[data-test=delete-period]")).not.toBeNull();
    if (state === "add-from-page")
      expect(el.shadowRoot!.querySelector("[name=departmentId]")).not.toBeNull();
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
    if (state === "new" || state === "edit") {
      expect(el.shadowRoot!.querySelectorAll("[role=radiogroup] [role=radio]")).toHaveLength(6);
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=floorPlanId]")!
          .disabled,
      ).toBe(true);
    }
    if (state === "colour-invalid") {
      name.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Dinner" } }));
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-test=colour-error]")!.textContent!.trim()).toBe(
        "Choose a colour.",
      );
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
          const el = (await mountThemed("<period-dialog></period-dialog>", theme)) as PeriodDialog;
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
            routingUses: [],
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
            path: `../__screenshots__/a506-11-dialog/${state}-${locale}-${theme}-${width}.png`,
          });
          cleanup();
        }
      } finally {
        await page.viewport(1280, 768);
      }
    });
  });
});
