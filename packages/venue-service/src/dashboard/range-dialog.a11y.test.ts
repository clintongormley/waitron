import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { RangeDialog } from "./range-dialog.js";
import "./range-dialog.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Range dialog (%s)", (theme) => {
  test.each(["new", "edit", "invalid", "busy"])("%s", async (state) => {
    setLocale("en");
    const el = (await mountThemed("<range-dialog></range-dialog>", theme)) as RangeDialog;
    el.periods = [{ id: "lunch", name: "Lunch" }];
    el.range = {
      startsAt: "09:00",
      endsAt: "10:00",
      periodId: state === "new" || state === "invalid" ? "" : "lunch",
    };
    el.deletable = state === "edit";
    el.open = true;
    await el.updateComplete;
    if (state === "invalid") {
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
        "[name=endsAt]",
      )!.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "11:00" } }));
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=periodId]")!
          .error,
      ).toBe("Choose a period.");
    }
    if (state === "busy") el.busy = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
