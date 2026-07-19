import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-button.js";
import "./wt-icon.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-button a11y (%s theme)", (theme) => {
  test("text button", async () => {
    await mountThemed("<wt-button>Cobrar</wt-button>", theme);
    await expectNoA11yViolations(host);
  });

  // The icon-only form is one of the three real ARIA defects a hand review previously found:
  // wt-icon's SVG is aria-hidden and there's no text content, so without a forwarded aria-label
  // the button has no accessible name at all.
  test("icon-only button", async () => {
    await mountThemed(
      '<wt-button aria-label="Cerrar"><wt-icon name="close"></wt-icon></wt-button>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test.each(["primary", "secondary", "danger", "ghost"] as const)("%s variant", async (variant) => {
    await mountThemed(`<wt-button variant="${variant}">Cobrar</wt-button>`, theme);
    await expectNoA11yViolations(host);
  });

  test("disabled button", async () => {
    await mountThemed("<wt-button disabled>Cobrar</wt-button>", theme);
    await expectNoA11yViolations(host);
  });
});
