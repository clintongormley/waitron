import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-lozenge.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-lozenge a11y (%s theme)", (theme) => {
  test("coloured", async () => {
    await mountThemed('<wt-lozenge color="#256bb1">Sandwiches</wt-lozenge>', theme);
    await expectNoA11yViolations(host);
  });
  test("colourless", async () => {
    await mountThemed("<wt-lozenge>Sundries</wt-lozenge>", theme);
    await expectNoA11yViolations(host);
  });
});
