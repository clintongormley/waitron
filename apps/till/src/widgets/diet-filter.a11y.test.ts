import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./diet-filter.js";
import type { TillDietFilter } from "./diet-filter.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-diet-filter a11y (%s theme)", (theme) => {
  it("a segmented control of dietary lenses has no violations (none selected)", async () => {
    const { host } = await mountWidget<TillDietFilter>(
      "till-diet-filter",
      { selected: null },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with an active lens (aria-pressed)", async () => {
    const { host } = await mountWidget<TillDietFilter>(
      "till-diet-filter",
      { selected: "vegan" },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
