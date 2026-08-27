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

  it("has no violations with a routed-back server error banner shown", async () => {
    const { host } = await mountWidget<SetupVenueScreen>(
      "setup-venue-screen",
      { errorMessage: "The country must match the fiscal territory." },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  // Fix (j): a routed server error AND a client-validation failure coincide — only the single client
  // alert renders, and it must stay a11y-clean.
  it("has no violations when a server error and a client error coincide (one alert)", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>(
      "setup-venue-screen",
      { errorMessage: "The country must match the fiscal territory." },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
