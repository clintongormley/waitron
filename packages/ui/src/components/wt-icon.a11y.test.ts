import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { registerIcons } from "./wt-icon.js";
import "./wt-icon.js";

registerIcons({ close: "M2 2 L14 14 M14 2 L2 14" });

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-icon a11y (%s theme)", (theme) => {
  test("a registered icon renders as decorative (aria-hidden) and carries no violations", async () => {
    await mountThemed('<wt-icon name="close"></wt-icon>', theme);
    await expectNoA11yViolations(host);
  });
});
