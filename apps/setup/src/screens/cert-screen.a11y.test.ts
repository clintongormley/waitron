import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./cert-screen.js";
import type { SetupCertScreen } from "./cert-screen.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("setup-cert-screen a11y (%s theme)", (theme) => {
  it("has no violations on the empty form (file, passphrase and kind all labelled)", async () => {
    const { host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {}, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations with the validation banner and invalid fields shown", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {}, theme);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
