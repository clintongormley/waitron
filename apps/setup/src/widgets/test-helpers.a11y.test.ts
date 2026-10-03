import { afterEach, expect, test, vi } from "vitest";
import axe from "axe-core";
import type { WtInput } from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";

afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());

const COLOUR_READINGS = ["equalRatio", "fgAlpha", "colorParse"];

async function undecidedContrastReasons(
  host: HTMLElement,
): Promise<{ violations: string[]; reasons: string[] }> {
  const results = await axe.run(host);
  const reasons = results.incomplete
    .filter((result) => result.id === "color-contrast")
    .flatMap((result) => result.nodes.flatMap((node) => node.any))
    .map((check) => (check.data as { messageKey?: string } | null)?.messageKey ?? "");
  return { violations: results.violations.map((violation) => violation.id), reasons };
}

async function mountText(text: string, color: string, theme: "light" | "dark") {
  const mounted = await mountWidget<HTMLParagraphElement>("p", { textContent: text }, theme);
  mounted.el.style.color = color;
  return mounted;
}

test.each(["light", "dark"] as const)(
  "text the same colour as its background fails, though axe calls it undecided (%s)",
  async (theme) => {
    const { host } = await mountText("Hidden words", "var(--wt-color-surface-raised)", theme);
    const { violations, reasons } = await undecidedContrastReasons(host);
    expect(violations).not.toContain("color-contrast");
    expect(reasons).toContain("equalRatio");
    await expect(expectNoA11yViolations(host)).rejects.toThrow(
      /color-contrast \[undecided\]: Element has a 1:1 contrast ratio with the background/,
    );
  },
);

test.each(["light", "dark"] as const)("readable text passes (%s)", async (theme) => {
  const { host } = await mountText("Readable words", "var(--wt-color-text)", theme);
  await expectNoA11yViolations(host);
});

test("an undecided reading that is not about colour still passes", async () => {
  const { host } = await mountWidget<WtInput>("wt-input", { label: "Peso (kg)" }, "light");
  const { reasons } = await undecidedContrastReasons(host);
  expect(reasons).toContain("bgOverlap");
  expect(reasons.filter((reason) => COLOUR_READINGS.includes(reason))).toEqual([]);
  await expectNoA11yViolations(host);
});

function undecidedContrastResults(messageKey: string): axe.AxeResults {
  const check = (key: string) => ({
    id: "color-contrast",
    data: { messageKey: key },
    message: `Undecided because of ${key}`,
    impact: "serious",
    relatedNodes: [],
  });
  return {
    violations: [],
    incomplete: [
      {
        id: "color-contrast",
        nodes: [
          { target: ["#reading"], any: [check("bgOverlap"), check(messageKey)], all: [], none: [] },
        ],
      },
    ],
  } as unknown as axe.AxeResults;
}

test.each(["fgAlpha", "colorParse"])(
  "an undecided %s reading fails, though an unrelated reading comes first",
  async (messageKey) => {
    vi.spyOn(axe, "run").mockImplementationOnce(async () => undecidedContrastResults(messageKey));
    await expect(expectNoA11yViolations(document.body)).rejects.toThrow(
      `color-contrast [undecided]: Undecided because of ${messageKey}\n  targets: #reading`,
    );
  },
);
