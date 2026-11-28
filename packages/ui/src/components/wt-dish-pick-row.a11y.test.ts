import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { cleanup, host } from "../test-helpers.js";

import "./wt-dish-pick-row.js";
import "./wt-stepper.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-dish-pick-row a11y (%s theme)", (theme) => {
  test.each(["", "checked", "indeterminate", "disabled"])(
    "the checkbox has a name and details in the %s state",
    async (state) => {
      await mountThemed(
        `<wt-dish-pick-row label="Croquetas" quantity="3" amount="€12.00"
          description="With garlic mayonnaise" ${state}></wt-dish-pick-row>`,
        theme,
      );
      const checkbox = page.getByRole("checkbox", { name: "3 Croquetas", exact: true });
      await expect.element(checkbox).toHaveAccessibleDescription("With garlic mayonnaise €12.00");
      if (state === "disabled") await expect.element(checkbox).toBeDisabled();
      else await expect.element(checkbox).toBeEnabled();
      await expectNoA11yViolations(host, { enable: ["target-size"] });
    },
  );

  test("the part strip keeps the stepper separate from the checkbox", async () => {
    await mountThemed(
      '<wt-dish-pick-row label="Croquetas" quantity="3" amount="€12.00" indeterminate ' +
        'portion-label="Paying for" portion-amount="€4.00">' +
        '<wt-stepper slot="stepper" label="Croquetas" variant="portion" value="1" max="3"></wt-stepper>' +
        "</wt-dish-pick-row>",
      theme,
    );
    const row = host.querySelector("wt-dish-pick-row")!;
    const strip = row.shadowRoot!.querySelector('[part="portion"]')!;
    expect(strip.textContent).toContain("Paying for");
    expect(strip.textContent).toContain("€4.00");
    expect(strip.querySelector("slot")!.assignedElements()).toEqual([
      row.querySelector("wt-stepper"),
    ]);
    await expect.element(page.getByRole("checkbox", { name: "3 Croquetas" })).toBeEnabled();
    await expect.element(page.getByRole("button", { name: "Increase Croquetas" })).toBeEnabled();
    await expectNoA11yViolations(host, { enable: ["target-size"] });
  });
});
