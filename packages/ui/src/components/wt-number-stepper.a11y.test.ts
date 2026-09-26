import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { registerIcons } from "./wt-icon.js";
import "./wt-number-stepper.js";

afterEach(cleanup);

// Registered so the buttons draw their icons as they do in the app; an icon is aria-hidden, so it
// never names a button.
registerIcons({
  minus: "M2.5 7.25H13.5V8.75H2.5Z",
  plus: "M7.25 2.5H8.75V7.25H13.5V8.75H8.75V13.5H7.25V8.75H2.5V7.25H7.25Z",
});

describe.each(["light", "dark"] as const)("wt-number-stepper a11y (%s theme)", (theme) => {
  test("empty", async () => {
    await mountThemed(
      '<wt-number-stepper label="Maximum choices" name="max" placeholder="No limit"></wt-number-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("with a value", async () => {
    await mountThemed(
      '<wt-number-stepper label="Maximum choices" name="max" value="3"></wt-number-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("at min", async () => {
    await mountThemed(
      '<wt-number-stepper label="Max quantity" name="q" value="1" min="1"></wt-number-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("at max", async () => {
    await mountThemed(
      '<wt-number-stepper label="Max quantity" name="q" value="5" min="1" max="5"></wt-number-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("required, with a hint", async () => {
    await mountThemed(
      '<wt-number-stepper label="Minimum choices" name="min" value="0" required hint="0 makes the list optional"></wt-number-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("invalid with an error", async () => {
    await mountThemed(
      '<wt-number-stepper label="Max quantity" name="q" value="0" min="1" error="Enter 1 or more"></wt-number-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("disabled", async () => {
    await mountThemed(
      '<wt-number-stepper label="Max quantity" name="q" value="2" disabled></wt-number-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("hide-label", async () => {
    await mountThemed(
      '<wt-number-stepper label="Max quantity" name="q" value="2" hide-label></wt-number-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
