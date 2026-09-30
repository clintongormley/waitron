import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./cert-screen.js";
import type { SetupCertScreen } from "./cert-screen.js";

afterEach(cleanupWidgets);

/** The message above Next, so each invalid-state case proves axe saw it. */
async function bottomOf(el: SetupCertScreen): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

describe.each(["light", "dark"] as const)("setup-cert-screen a11y (%s theme)", (theme) => {
  it("has no violations on the empty form (file, passphrase and kind all labelled)", async () => {
    const { host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {}, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations with the message above Next and invalid fields shown", async () => {
    const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {}, theme);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("Correct the highlighted fields to continue.");
    await expectNoA11yViolations(host);
  });
});
