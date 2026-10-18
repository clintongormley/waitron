import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { casaMarina } from "./floor-plans-fixture.js";
import type { FloorPlanSetDialog } from "./floor-plan-set-dialog.js";
import "./floor-plan-set-dialog.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Floor plan set dialog (%s)", (theme) => {
  test.each(["add", "add-start-from", "invalid", "rename", "copy", "refused", "saving"])(
    "%s",
    async (state) => {
      const el = (await mountThemed(
        "<dashboard-floor-plan-set-dialog></dashboard-floor-plan-set-dialog>",
        theme,
      )) as FloorPlanSetDialog;
      el.departments = casaMarina().departments;
      el.set = { id: "dinner", name: "Dinner" };
      el.mode =
        state === "rename" || state === "refused" ? "rename" : state === "copy" ? "copy" : "add";
      el.open = true;
      await el.updateComplete;
      const change = async (name: string, value: string) => {
        el.shadowRoot!.querySelector(`[name=${name}]`)!.dispatchEvent(
          new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
        );
        await el.updateComplete;
      };
      if (state === "add-start-from" || state === "saving")
        await change("departmentId", "restaurant");
      if (state === "add-start-from")
        expect(el.shadowRoot!.querySelector("[name=fromSetId]")).not.toBeNull();
      if (state === "invalid") {
        await change("name", "Brunch");
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-set]")!.click();
        await el.updateComplete;
        expect(
          el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=departmentId]")!
            .error,
        ).toBe("Choose a department.");
      }
      if (state === "refused") {
        await change("name", "Standard");
        el.refusal = { code: "floor_plan_set.name_taken" };
      }
      if (state === "saving") {
        await change("name", "Brunch");
        el.busy = true;
      }
      await el.updateComplete;
      await expectNoA11yViolations(host);
    },
  );
});
