import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./dietary-origin-picker.js";
import type { DietaryOriginPicker } from "./dietary-origin-picker.js";

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
