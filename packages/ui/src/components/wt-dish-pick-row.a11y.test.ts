import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { cleanup, host } from "../test-helpers.js";

import "./wt-dish-pick-row.js";

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
});
