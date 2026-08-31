import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./dietary-origin-picker.js";
import type { DietaryOriginPicker } from "./dietary-origin-picker.js";

/**
 * The picker is a single labelled `<select>` over the dietary-origin taxonomy. Its accessible name
 * comes from an associated `<label>` (the `origin.label` string), and it is run against the themed
 * host in BOTH themes so a color-contrast check means what it means in the app.
 */
afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("dietary-origin-picker a11y (%s theme)", (theme) => {
  it("renders accessibly", async () => {
    const { host } = await mountWidget<DietaryOriginPicker>(
      "dashboard-dietary-origin-picker",
      { value: "meat" },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
