import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-slider.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-slider a11y (%s theme)", (theme) => {
  test("at rest", async () => {
    await mountThemed('<wt-slider label="Columns" min="2" max="6" value="4"></wt-slider>', theme);
    await expectNoA11yViolations(host);
  });

  test("at the minimum", async () => {
    await mountThemed('<wt-slider label="Columns" min="6" max="10" value="6"></wt-slider>', theme);
    await expectNoA11yViolations(host);
  });

  test("with an error", async () => {
    await mountThemed(
      '<wt-slider label="Columns" min="2" max="6" value="4" error="Pick a number from 2 to 6"></wt-slider>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("disabled", async () => {
    await mountThemed(
      '<wt-slider label="Columns" min="2" max="6" value="4" disabled></wt-slider>',
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
