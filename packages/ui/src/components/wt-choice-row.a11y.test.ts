import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-choice-row.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-choice-row a11y (%s theme)", (theme) => {
  test("at rest", async () => {
    await mountThemed(
      '<wt-choice-row heading="Demo">A practice server. Nothing is filed to AEAT.</wt-choice-row>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("focused", async () => {
    const el = await mountThemed(
      '<wt-choice-row heading="Live">The real thing. Every sale is filed to AEAT.</wt-choice-row>',
      theme,
    );
    el.focus();
    await expectNoA11yViolations(host);
  });
});
