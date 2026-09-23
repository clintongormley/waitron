import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { WtFormErrorSummary } from "./wt-form-error-summary.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-form-error-summary a11y (%s theme)", (theme) => {
  test("form errors", async () => {
    const el = (await mountThemed(
      '<wt-form-error-summary heading="There is a problem with this form"></wt-form-error-summary>',
      theme,
    )) as WtFormErrorSummary;
    el.errors = ["Enter an email address"];
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
