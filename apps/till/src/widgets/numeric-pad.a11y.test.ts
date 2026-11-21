import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./numeric-pad.js";
import type { TillNumericPad } from "./numeric-pad.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-numeric-pad a11y (%s theme)", (theme) => {
  it("has no violations with a partially entered value", async () => {
    const { host } = await mountWidget<TillNumericPad>("till-numeric-pad", { value: "0.3" }, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations in pin mode with a partly entered PIN", async () => {
    const { host } = await mountWidget<TillNumericPad>(
      "till-numeric-pad",
      { value: "01", mode: "pin" },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
