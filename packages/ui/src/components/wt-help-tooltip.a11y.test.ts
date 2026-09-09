import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-help-tooltip.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-help-tooltip a11y (%s theme)", (theme) => {
  test("open help", async () => {
    const el = await mountThemed(
      '<wt-help-tooltip aria-label="About email addresses">Use the address this person checks.</wt-help-tooltip>',
      theme,
    );
    el.shadowRoot!.querySelector("button")!.click();
    await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    await expectNoA11yViolations(host);
  });
});
