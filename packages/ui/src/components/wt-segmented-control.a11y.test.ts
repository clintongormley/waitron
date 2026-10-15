import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-segmented-control.js";

afterEach(cleanup);
describe.each(["light", "dark"] as const)("%s", (theme) => {
  test.each(["public", "staff_only", "not_sold_separately"])("selected %s", async (value) => {
    const el = (await mountThemed(
      '<wt-segmented-control label="Ordered on its own by"></wt-segmented-control>',
      theme,
    )) as HTMLElementTagNameMap["wt-segmented-control"];
    el.options = [
      { value: "public", label: "Anyone" },
      { value: "staff_only", label: "Staff only" },
      { value: "not_sold_separately", label: "Nobody" },
    ];
    el.value = value;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll('[aria-checked="true"]')).toHaveLength(1);
    await expectNoA11yViolations(host);
  });
  test.each([false, true])("invalid group, disabled=%s", async (disabled) => {
    const el = (await mountThemed(
      '<wt-segmented-control label="Ordered on its own by"></wt-segmented-control>',
      theme,
    )) as HTMLElementTagNameMap["wt-segmented-control"];
    el.options = [{ value: "staff_only", label: "Staff only" }];
    el.value = "staff_only";
    el.disabled = disabled;
    el.error = "Choose who can order this dish.";
    el.hint = "Only staff can order it on its own.";
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[role="radiogroup"]')!.getAttribute("aria-invalid")).toBe(
      "true",
    );
    await expectNoA11yViolations(host);
  });
});
