import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-sheet.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-sheet a11y (%s theme)", (theme) => {
  test("collapsed", async () => {
    await mountThemed('<wt-sheet heading="Tables"><p>Table 1</p></wt-sheet>', theme);
    await expectNoA11yViolations(host);
  });

  test("expanded with content", async () => {
    await mountThemed(
      '<wt-sheet heading="Tables" expanded><p>Table 1</p><button type="button">Add</button></wt-sheet>',
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
