import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./mode-screen.js";
import type { SetupModeScreen } from "./mode-screen.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("setup-mode-screen a11y (%s theme)", (theme) => {
  it("has no violations on the demo/live choice view", async () => {
    const { host } = await mountWidget<SetupModeScreen>(
      "setup-mode-screen",
      { environment: "production" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations on the live-confirm view (its warning, switch and buttons)", async () => {
    const { el, host } = await mountWidget<SetupModeScreen>("setup-mode-screen", {}, theme);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-live]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations with the 'I understand' switch on and confirm enabled", async () => {
    const { el, host } = await mountWidget<SetupModeScreen>("setup-mode-screen", {}, theme);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-live]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=understand]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
