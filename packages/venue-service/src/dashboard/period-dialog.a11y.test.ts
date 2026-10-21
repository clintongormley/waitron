import { afterEach, describe, expect, test } from "vitest";
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
    "floor-plan",
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
        colour: state === "colour-invalid" ? ("beige" as never) : "green",
        menuId: "lunch",
        staffMenuIds: ["deli"],
        floorPlanSetId: null,
        weekdays: [1],
        routingUses: [],
      };
    }
    if (state.startsWith("painted-in") || state === "not-painted") {
      el.seasons = [
        { id: "autumn", colour: "orange" },
        { id: "winter", colour: "blue" },
        { id: "spring", colour: "green" },
        { id: "summer", colour: "amber" },
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
    if (state === "floor-plan") {
      el.departmentId = "restaurant";
      el.floorPlans = [
        {
          id: "restaurant",
          sets: [
            { id: "house", name: "House", isDefault: true },
            { id: "late", name: "Late", isDefault: false },
          ],
        },
      ];
    }
    if (state === "add-from-page")
      el.departments = [
        { id: "restaurant", name: "Restaurant", colourUsers: [{ name: "Lunch", colour: "red" }] },
        { id: "bar", name: "Bar", colourUsers: [] },
      ];
    el.open = true;
    await el.updateComplete;
    if (state.startsWith("painted-in"))
      expect(el.shadowRoot!.querySelectorAll("[data-test=painted-in] .chip")).toHaveLength(5);
    if (state === "not-painted")
      expect(el.shadowRoot!.querySelector("[data-test=not-painted]")).not.toBeNull();
    if (state === "deletable")
      expect(
        el.shadowRoot!.querySelector("[data-test=delete-period]")!.closest("wt-form-actions"),
      ).not.toBeNull();
    if (state === "add-from-page")
      expect(el.shadowRoot!.querySelector("[name=departmentId]")).not.toBeNull();
    if (state === "floor-plan")
      expect(el.shadowRoot!.querySelector("[name=floorPlanSetId]")).not.toBeNull();
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
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-colour-chooser"]>(
          "wt-colour-chooser[name=colour]",
        )!.choices,
      ).toHaveLength(16);
    }
    if (state === "colour-invalid") {
      name.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Dinner" } }));
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!.click();
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-colour-chooser"]>(
          "wt-colour-chooser[name=colour]",
        )!.error,
      ).toBe("Choose a colour.");
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
