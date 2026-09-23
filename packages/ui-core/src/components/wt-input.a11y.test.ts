import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-input.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-input a11y (%s theme)", (theme) => {
  test("labelled input", async () => {
    await mountThemed('<wt-input label="Peso (kg)" value="1.25"></wt-input>', theme);
    await expectNoA11yViolations(host);
  });

  // invalid only flips a visual border by default — the design-system contract requires it to
  // also set aria-invalid on the inner input, which is what makes this state accessible.
  test("invalid input", async () => {
    await mountThemed('<wt-input label="Peso (kg)" invalid value="-1"></wt-input>', theme);
    await expectNoA11yViolations(host);
  });

  test("disabled input", async () => {
    await mountThemed('<wt-input label="Peso (kg)" disabled></wt-input>', theme);
    await expectNoA11yViolations(host);
  });
});
