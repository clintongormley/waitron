import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setLocale, t } from "../i18n/t.js";
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

  it("has no violations and no sideways scroll at phone width in Spanish", async () => {
    const previous = [innerWidth, innerHeight];
    setLocale("es-ES");
    try {
      await page.viewport(390, 1200);
      const { el, host } = await mountWidget<SetupCertScreen>("setup-cert-screen", {}, theme);
      expect(el.shadowRoot!.textContent).toContain(t("cert.next", "es-ES"));
      await expectNoA11yViolations(host);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    } finally {
      setLocale("en-GB");
      await page.viewport(previous[0]!, previous[1]!);
    }
  });
});
