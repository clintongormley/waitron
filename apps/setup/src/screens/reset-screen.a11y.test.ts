import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./reset-screen.js";
import type { SetupResetScreen } from "./reset-screen.js";

afterEach(cleanupWidgets);

async function bottomOf(el: SetupResetScreen): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

describe.each(["light", "dark"] as const)("setup-reset-screen a11y (%s theme)", (theme) => {
  it("has no violations on the pristine form", async () => {
    const { host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {}, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations with the message above the reset button and invalid fields shown", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {}, theme);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=reset]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("Correct the highlighted fields to continue.");
    await expectNoA11yViolations(host);
  });

  it("has no violations with the refused login shown", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>(
      "setup-reset-screen",
      { credentialsRejected: true },
      theme,
    );
    expect(await bottomOf(el)).toContain("not the admin login");
    await expectNoA11yViolations(host);
  });

  it("has no violations with a routed-back message shown", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>(
      "setup-reset-screen",
      { errorMessage: "Too many attempts. Wait 30 seconds, then try again." },
      theme,
    );
    expect(await bottomOf(el)).toBe("Too many attempts. Wait 30 seconds, then try again.");
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
