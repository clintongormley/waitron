import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./reset-screen.js";
import type { SetupResetScreen } from "./reset-screen.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("setup-reset-screen a11y (%s theme)", (theme) => {
  it("has no violations on the pristine form", async () => {
    const { host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {}, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations with the validation summary and invalid fields shown", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {}, theme);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=reset]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations with the refused login marked", async () => {
    const { host } = await mountWidget<SetupResetScreen>(
      "setup-reset-screen",
      { credentialsRejected: true },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with a routed-back message shown", async () => {
    const { host } = await mountWidget<SetupResetScreen>(
      "setup-reset-screen",
      { errorMessage: "Too many attempts. Wait 30 seconds, then try again." },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations while the reset is in flight", async () => {
    const { host } = await mountWidget<SetupResetScreen>(
      "setup-reset-screen",
      { busy: true },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it.each(["resetting", "refused"] as const)(
    "has no violations on the %s outcome",
    async (kind) => {
      const { host } = await mountWidget<SetupResetScreen>(
        "setup-reset-screen",
        { outcome: { kind, message: "The server is resetting and will restart." } },
        theme,
      );
      await expectNoA11yViolations(host);
    },
  );
});
