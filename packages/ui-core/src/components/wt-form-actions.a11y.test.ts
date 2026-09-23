import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-button.js";
import "./wt-form-actions.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-form-actions a11y (%s theme)", (theme) => {
  test("cancel and primary actions", async () => {
    await mountThemed(
      '<wt-form-actions><wt-button slot="cancel">Cancel</wt-button><wt-button variant="primary">Save</wt-button></wt-form-actions>',
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
