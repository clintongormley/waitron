import { afterEach, describe, test } from "vitest";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { cleanup, host } from "../test-helpers.js";
import "./wt-amount-block.js";
import "./wt-button.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-amount-block (%s)", (theme) => {
  test.each([false, true])("with a tip breakdown and action=%s", async (tip) => {
    await mountThemed(
      `<wt-amount-block><span slot="label">To pay</span>€80.52
        ${
          tip
            ? '<div slot="breakdown">Bill €73.20 + tip €7.32 <wt-button size="sm" variant="ghost">Remove tip</wt-button></div>'
            : ""
        }
      </wt-amount-block>`,
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
