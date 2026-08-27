import axe from "axe-core";
import { expect } from "vitest";
import { applyTokens } from "@waitron/ui";

/**
 * Test support for the setup wizard's Lit screens. It mirrors `apps/dashboard/src/widgets/
 * test-helpers.ts` (and, upstream, `packages/ui/src/test-helpers.ts` / `a11y-helpers.ts`), but mounts
 * by ASSIGNING PROPERTIES rather than parsing an HTML string: every wizard screen takes its data as
 * `@property({ attribute: false })`/property objects, which cannot travel through markup. So it creates
 * the element, assigns the props, then connects it.
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
  paintCanvas(host);
  mounted.push(host);

  const el = document.createElement(tag) as T;
  Object.assign(el, props);
  host.appendChild(el);
  await (el as T & { updateComplete: Promise<unknown> }).updateComplete;
  return { el, host };
}

/**
 * Paints the page CANVAS (`<body>` and `<html>`) with `host`'s resolved theme background, mirroring
 * what a real deployment does: `index.html` sets `body { background: var(--wt-color-bg) }` under
 * `applyTokens(document.documentElement)`, so in the app every element ultimately sits on the theme's
 * background. The harness themes only the nested `host` `<div>`, which leaves the page's default WHITE
 * canvas behind it — and axe-core composites the background of any element it cannot trace back to
 * `host` (e.g. one pushed off-viewport by a wide header, where `elementsFromPoint` returns nothing)
 * against that canvas. On white that reads as a false color-contrast failure for the dark theme's
 * light text (`#eceef2` on `#ffffff` → 1.16:1) even though the element renders correctly on the dark
 * canvas in the app. `<body>`/`<html>` are not themselves theme roots, so read the concrete colour off
 * `host` rather than passing the `var()`. Reset in {@link cleanupWidgets}.
 */
function paintCanvas(host: HTMLElement): void {
  const bg = getComputedStyle(host).backgroundColor;
  document.body.style.background = bg;
  document.documentElement.style.background = bg;
}

/** Removes every host mounted since the last cleanup. Use as `afterEach(cleanupWidgets)`. */
export function cleanupWidgets(): void {
  for (const host of mounted.splice(0)) host.remove();
  document.body.style.background = "";
  document.documentElement.style.background = "";
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
