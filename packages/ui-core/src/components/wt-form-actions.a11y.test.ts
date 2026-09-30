import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-button.js";
import type { WtFormActions } from "./wt-form-actions.js";
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

  test("with the form's message above the actions", async () => {
    const el = (await mountThemed(
      '<wt-form-actions><wt-button slot="cancel">Cancel</wt-button><wt-button variant="primary" disabled>Save</wt-button></wt-form-actions>',
      theme,
    )) as WtFormActions;
    el.error = "Correct the highlighted fields to continue.";
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
