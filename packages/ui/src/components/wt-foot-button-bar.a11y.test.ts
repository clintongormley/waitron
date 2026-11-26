import { afterEach, describe, test } from "vitest";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { cleanup, host } from "../test-helpers.js";
import "./wt-foot-button-bar.js";
import "./wt-button.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-foot-button-bar (%s)", (theme) => {
  test.each(["stack", "row"])("%s", async (layout) => {
    await mountThemed(
      `<wt-foot-button-bar layout="${layout}">
        <wt-button>Cash</wt-button>
        <wt-button variant="primary" ${layout === "row" ? "disabled" : ""}>Charge</wt-button>
        ${layout === "stack" ? '<wt-button variant="ghost" slot="link">Other card machine</wt-button>' : ""}
      </wt-foot-button-bar>`,
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
