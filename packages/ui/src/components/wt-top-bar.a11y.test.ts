import { afterEach, describe, test } from "vitest";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { cleanup, host } from "../test-helpers.js";
import "./wt-top-bar.js";
import "./wt-icon-button.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-top-bar (%s)", (theme) => {
  test.each([
    ["heading only", '<wt-top-bar heading="At the reader"></wt-top-bar>'],
    [
      "back and action",
      '<wt-top-bar back-label="Table 4" heading="Pay" subtitle="Bill 1"><wt-icon-button slot="action" icon="check" label="Equipment"></wt-icon-button></wt-top-bar>',
    ],
    [
      "a title button",
      '<wt-top-bar back-label="Floor" subtitle="Bill 1"><wt-button slot="title" variant="ghost">Table 4</wt-button></wt-top-bar>',
    ],
  ])("%s", async (_state, markup) => {
    await mountThemed(markup, theme);
    await expectNoA11yViolations(host);
  });
});
