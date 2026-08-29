import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./connect-screen.js";
import type { SetupConnectScreen } from "./connect-screen.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("setup-connect-screen a11y (%s theme)", (theme) => {
  it("has no violations on the pristine form", async () => {
    const { host } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {}, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations with the validation banner and invalid fields shown", async () => {
    const { el, host } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {}, theme);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations with a routed-back server error banner shown", async () => {
    const { host } = await mountWidget<SetupConnectScreen>(
      "setup-connect-screen",
      { errorMessage: "Couldn't reach the primary box." },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  // Fix (j): a routed server error AND a client-validation failure coincide — only the single client
  // alert renders, and it must stay a11y-clean.
  it("has no violations when a server error and a client error coincide (one alert)", async () => {
    const { el, host } = await mountWidget<SetupConnectScreen>(
      "setup-connect-screen",
      { errorMessage: "Couldn't reach the primary box." },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
