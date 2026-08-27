import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./venue-screen.js";
import type { SetupVenueScreen } from "./venue-screen.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("setup-venue-screen a11y (%s theme)", (theme) => {
  it("has no violations on the pristine form (every field, both selects, the locale group labelled)", async () => {
    const { host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {}, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations with the validation banner and invalid fields shown", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {}, theme);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
