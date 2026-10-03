import axe from "axe-core";
import { expect } from "vitest";
import { applyTokens } from "@waitron/ui";

export type Theme = "light" | "dark";

const mounted: HTMLElement[] = [];

export interface Mounted<T extends HTMLElement> {
  el: T;
  host: HTMLElement;
}

/**
 * Assigns `props` before connecting, because the wizard screens take object properties that cannot
 * travel through markup. The host is painted `--wt-color-surface-raised`, the background of the page
 * column the screens render inside (`setup-app.ts`), so a contrast check sees the app's colours.
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
  host.style.background = "var(--wt-color-surface-raised)";
  paintCanvas(host);
  mounted.push(host);

  const el = document.createElement(tag) as T;
  Object.assign(el, props);
  host.appendChild(el);
  await (el as T & { updateComplete: Promise<unknown> }).updateComplete;
  return { el, host };
}

/**
 * Paints `<body>` and `<html>` with `host`'s background, so nothing axe composites against the page
 * canvas meets the default white. `<body>` and `<html>` are not theme roots, so the concrete colour
 * is read off `host` rather than passed as a `var()`.
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

export function formatViolations(violations: axe.Result[]): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
      return `${violation.id} [${violation.impact}]: ${violation.help}\n  targets: ${targets}`;
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
 * Runs the full default axe ruleset against `context` and fails the test on any violation, or on a
 * colour-contrast check axe left undecided for a reason about the colours themselves (`equalRatio`,
 * `fgAlpha`, `colorParse`).
 */
export async function expectNoA11yViolations(context: Element): Promise<void> {
  const results = await axe.run(context);
  expect(results.violations, formatViolations(results.violations)).toEqual([]);
  const colourReadings = undecidedColourReadings(results.incomplete);
  expect(colourReadings, colourReadings.join("\n\n")).toEqual([]);
}
