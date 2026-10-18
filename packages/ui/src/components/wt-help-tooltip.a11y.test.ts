import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { setHelpMode } from "../help-mode.js";
import type { WtHelpTooltip } from "./wt-help-tooltip.js";
import "./wt-help-tooltip.js";

afterEach(cleanup);
afterEach(() => setHelpMode(false));

// The padding keeps the hanging badge off any text or other control.
const HELP_MODE_BADGE =
  '<div style="position: relative; padding: var(--wt-space-5)"><span style="color: var(--wt-color-text)">Selling unit</span>' +
  '<wt-help-tooltip mode="help-mode" aria-label="Help: Selling unit">The unit you sell it in.</wt-help-tooltip></div>';

async function mountHelpModeBadge(theme: "light" | "dark", on: boolean): Promise<WtHelpTooltip> {
  const container = await mountThemed(HELP_MODE_BADGE, theme);
  const badge = container.querySelector<WtHelpTooltip>("wt-help-tooltip")!;
  setHelpMode(on);
  await badge.updateComplete;
  return badge;
}

describe.each(["light", "dark"] as const)("wt-help-tooltip a11y (%s theme)", (theme) => {
  test("open help", async () => {
    const el = await mountThemed(
      '<wt-help-tooltip aria-label="About email addresses">Use the address this person checks.</wt-help-tooltip>',
      theme,
    );
    el.shadowRoot!.querySelector("button")!.click();
    await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    await expectNoA11yViolations(host);
  });

  test("help-mode badge, help off", async () => {
    await mountHelpModeBadge(theme, false);
    await expectNoA11yViolations(host);
  });

  test("help-mode badge, help on", async () => {
    await mountHelpModeBadge(theme, true);
    await expectNoA11yViolations(host, { enable: ["target-size"] });
  });

  test("help-mode badge, help on, box open", async () => {
    const badge = await mountHelpModeBadge(theme, true);
    badge.shadowRoot!.querySelector("button")!.click();
    await badge.updateComplete;
    await expectNoA11yViolations(host, { enable: ["target-size"] });
  });
});
