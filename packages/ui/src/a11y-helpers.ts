import axe from "axe-core";
import { commands } from "vitest/browser";
import { beforeEach, expect } from "vitest";
import { host, mount } from "./test-helpers.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    // Moves the real cursor off every element, clearing CSS `:hover`. See `parkPointer` in
    // packages/ui/src/vitest-park-pointer.ts for why `userEvent.unhover()` cannot be used for this.
    parkPointer: () => Promise<void>;
  }
}

/**
 * Starts every a11y test with the mouse cursor off the page, so nothing inherits a `:hover` that an
 * earlier test's click or hover left behind — the cursor belongs to the shared page, not to the test
 * that moved it, and it outlives the file that moved it. Without this an a11y scan can catch a button
 * dimmed by `wt-button`'s hover rule and report a colour-contrast violation nobody can see in the app.
 * This module is imported by the suites that run `expectNoA11yViolations`, so the hook covers exactly
 * the tests that scan.
 */
beforeEach(() => commands.parkPointer());

export type Theme = "light" | "dark";

export function formatViolations(violations: axe.Result[]): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
      return `${violation.id} [${violation.impact}]: ${violation.help}\n  ${violation.helpUrl}\n  targets: ${targets}`;
    })
    .join("\n\n");
}

// The reasons in axe's colour-contrast messages (`locales/_template.json`) counted as being about
// the colours themselves. axe 4.13.0 never sets `fgAlpha`.
const UNDECIDED_COLOUR_READINGS = new Set(["equalRatio", "fgAlpha", "colorParse"]);

function undecidedColourReadings(incomplete: axe.Result[]): string[] {
  return incomplete
    .filter((result) => result.id === "color-contrast")
    .flatMap((result) =>
      result.nodes.flatMap((node) =>
        node.any
          .filter((check) =>
            UNDECIDED_COLOUR_READINGS.has(
              (check.data as { messageKey?: string } | null)?.messageKey ?? "",
            ),
          )
          .map(
            (check) =>
              `${result.id} [undecided]: ${check.message}\n  targets: ${node.target.join(" ")}`,
          ),
      ),
    );
}

/**
 * Runs axe's full default ruleset. Pass the themed `host` rather than the component, so axe also sees
 * the theme root's attributes. Excluding a rule is a decision for the call site, never this helper.
 * Fails on any violation, and on a colour-contrast check axe left undecided for a reason about the
 * colours themselves (`equalRatio`, `fgAlpha`, `colorParse`).
 */
export async function expectNoA11yViolations(context: Element): Promise<void> {
  const results = await axe.run(context);
  expect(results.violations, formatViolations(results.violations)).toEqual([]);
  const colourReadings = undecidedColourReadings(results.incomplete);
  expect(colourReadings, colourReadings.join("\n\n")).toEqual([]);
}

/**
 * Paints the host and the page canvas with the theme background, as the app does, so axe judges
 * contrast against the theme rather than the test page's white. `<body>` and `<html>` are not theme
 * roots, so they get the host's resolved colour, not the `var()`; `cleanup()` resets them.
 */
export async function mountThemed(html: string, theme?: Theme): Promise<HTMLElement> {
  const el = await mount(html);
  if (theme) host.setAttribute("data-theme", theme);
  host.style.background = "var(--wt-color-bg)";
  const canvasBg = getComputedStyle(host).backgroundColor;
  document.body.style.background = canvasBg;
  document.documentElement.style.background = canvasBg;
  return el;
}
