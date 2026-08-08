import axe from "axe-core";
import { expect } from "vitest";
import { applyTokens } from "@waitron/ui";

/**
 * Test support for the dashboard's Lit widgets. It mirrors `packages/ui/src/test-helpers.ts` and
 * `a11y-helpers.ts`, but mounts by ASSIGNING PROPERTIES rather than parsing an HTML string: every
 * dashboard widget takes its data as `@property({ attribute: false })` objects, which cannot travel
 * through markup. So it creates the element, assigns the props, then connects it.
 */

export type Theme = "light" | "dark";

const mounted: HTMLElement[] = [];

/** The element under test plus the themed host it was mounted into (pass the host to axe). */
export interface Mounted<T extends HTMLElement> {
  el: T;
  host: HTMLElement;
}

/**
 * Mounts a custom element `tag` with `props` assigned before connection, inside a fresh themed
 * host, and waits for its first render. Pass `theme` to pin `data-theme` (and paint the host's
 * `--wt-color-bg`, as a real deployment does) so a color-contrast a11y check means what it means in
 * the app; omit it to render in whatever theme the environment resolves to.
 */
export async function mountWidget<T extends HTMLElement>(
  tag: string,
  props: Partial<T>,
  theme?: Theme,
): Promise<Mounted<T>> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  if (theme) host.setAttribute("data-theme", theme);
  host.style.background = "var(--wt-color-bg)";
  mounted.push(host);

  const el = document.createElement(tag) as T;
  Object.assign(el, props);
  host.appendChild(el);
  await (el as T & { updateComplete: Promise<unknown> }).updateComplete;
  return { el, host };
}

/** Removes every host mounted since the last cleanup. Use as `afterEach(cleanupWidgets)`. */
export function cleanupWidgets(): void {
  for (const host of mounted.splice(0)) host.remove();
}

/** Formats axe violations into a readable message: rule id, impact, help text, and node targets. */
export function formatViolations(violations: axe.Result[]): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
      return `${violation.id} [${violation.impact}]: ${violation.help}\n  targets: ${targets}`;
    })
    .join("\n\n");
}

/** Runs the full default axe ruleset against `context` and fails the test on any violation. */
export async function expectNoA11yViolations(context: Element): Promise<void> {
  const results = await axe.run(context);
  expect(results.violations, formatViolations(results.violations)).toEqual([]);
}
