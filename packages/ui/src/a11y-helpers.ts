import axe from "axe-core";
import { expect } from "vitest";
import { host, mount } from "./test-helpers.js";

export type Theme = "light" | "dark";

/**
 * Formats axe violations into a readable multi-line message: rule id, impact, the human-readable
 * help text, and the CSS selector(s) of every affected node — enough to find the offending markup
 * without re-running axe by hand.
 */
export function formatViolations(violations: axe.Result[]): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
      return `${violation.id} [${violation.impact}]: ${violation.help}\n  ${violation.helpUrl}\n  targets: ${targets}`;
    })
    .join("\n\n");
}

/**
 * Runs the full default axe-core ruleset against `context` and fails the test (via a vitest
 * `expect`, with a readable message) if it finds any violations.
 *
 * `context` is almost always the themed host `<div>` — the live `host` binding from
 * `test-helpers.ts` — rather than the mounted component itself, so axe also sees the theme root's
 * own attributes. axe-core traverses into open shadow roots automatically; see
 * `a11y-helpers.test.ts` for the empirical proof that this setup actually does so (a component
 * with a deliberately broken accessible name, deep inside a shadow root, is caught here).
 *
 * No ruleset is narrowed here — every caller runs the same, full default set. If a rule ever needs
 * excluding, that is a decision to make (and justify) explicitly at the call site, not silently
 * inside this helper.
 */
export async function expectNoA11yViolations(context: Element): Promise<void> {
  const results = await axe.run(context);
  expect(results.violations, formatViolations(results.violations)).toEqual([]);
}

/**
 * Mounts `html` (see `mount()` in test-helpers.ts) and, in addition, paints the host's own
 * background from `--wt-color-bg` — exactly what a real deployment does (see
 * `packages/ui/index.html`'s `.panel { background: var(--wt-color-bg) }` / `demo/main.ts`).
 *
 * Without this, a component with no background of its own (e.g. `wt-input`'s `<label>`, which is
 * transparent) would be contrast-checked against the test page's default white background
 * regardless of theme — meaningless for dark mode, where that label is never actually seen on
 * white. Painting the host closes that gap so a color-contrast check here means what it means in
 * the real app.
 *
 * Pass `theme` to pin `data-theme="light"|"dark"` on the host (overriding
 * `prefers-color-scheme`); omit it to test whatever theme the environment currently resolves to.
 */
export async function mountThemed(html: string, theme?: Theme): Promise<HTMLElement> {
  const el = await mount(html);
  if (theme) host.setAttribute("data-theme", theme);
  host.style.background = "var(--wt-color-bg)";
  return el;
}
