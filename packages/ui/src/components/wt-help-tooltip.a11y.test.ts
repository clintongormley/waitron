import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { setHelpMode } from "../help-mode.js";
import type { WtHelpTooltip } from "./wt-help-tooltip.js";
import "./wt-help-tooltip.js";
import "./wt-input.js";
import "./wt-textarea.js";

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

// wt-input and wt-textarea live in packages/ui-core, which cannot load wt-help-tooltip.
describe.each([
  ["wt-input", "light"],
  ["wt-input", "dark"],
  ["wt-textarea", "light"],
  ["wt-textarea", "dark"],
] as const)("%s holding a help-mode badge, a11y (%s theme)", (tag, theme) => {
  const markup =
    `<${tag} label="Name" name="name"><wt-help-tooltip slot="help" mode="help-mode" aria-label="Help: Name">` +
    `What it is called.</wt-help-tooltip></${tag}>`;

  test("with a help-mode badge, help off", async () => {
    await mountThemed(markup, theme);
    await expectNoA11yViolations(host);
  });

  test("with a help-mode badge, help on", async () => {
    await mountThemed(markup, theme);
    const badge = host.querySelector<WtHelpTooltip>("wt-help-tooltip")!;
    setHelpMode(true);
    await badge.updateComplete;
    expect(badge.checkVisibility()).toBe(true);
    await expectNoA11yViolations(host, { enable: ["target-size"] });
  });
});
