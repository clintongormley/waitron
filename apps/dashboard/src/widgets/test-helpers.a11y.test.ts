import { afterEach, expect, test, vi } from "vitest";
import axe from "axe-core";
import type { WtInput } from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";

afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());

const COLOUR_READINGS = ["equalRatio", "fgAlpha", "colorParse"];

const OVERLAPPED_TEXT =
  '<div style="position:relative"><p style="color:var(--wt-color-text)">Overlapped words here</p>' +
  '<div style="position:absolute;inset:0;background:var(--wt-color-surface);opacity:0.5"></div></div>';

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
    const { host } = await mountText("Hidden words", "var(--wt-color-bg)", theme);
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

test("an undecided reading that is not about colour still passes: an empty field", async () => {
  const { host } = await mountWidget<WtInput>("wt-input", { label: "Peso (kg)" }, "light");
  const { reasons } = await undecidedContrastReasons(host);
  expect(reasons).toContain("emptyValue");
  expect(reasons.filter((reason) => COLOUR_READINGS.includes(reason))).toEqual([]);
  await expectNoA11yViolations(host);
});

test("an undecided reading that is not about colour still passes: an overlapping box", async () => {
  const { host } = await mountWidget<HTMLDivElement>(
    "div",
    { innerHTML: OVERLAPPED_TEXT },
    "light",
  );
  const { reasons } = await undecidedContrastReasons(host);
  expect(reasons).toContain("bgOverlap");
  expect(reasons.filter((reason) => COLOUR_READINGS.includes(reason))).toEqual([]);
  await expectNoA11yViolations(host);
});

// Two, side by side: axe passes a lone small target under WCAG 2.5.8's spacing exception.
const SMALL_TARGETS =
  '<div style="display: flex">' +
  '<button aria-label="x" style="width: 10px; height: 10px; padding: 0"></button>' +
  '<button aria-label="y" style="width: 10px; height: 10px; padding: 0"></button></div>';

test("an extra rule can be switched on, and only then does it judge the page", async () => {
  const { host } = await mountWidget<HTMLDivElement>("div", { innerHTML: SMALL_TARGETS }, "light");
  await expectNoA11yViolations(host);
  await expect(expectNoA11yViolations(host, { enable: ["target-size"] })).rejects.toThrow(
    /target-size/,
  );
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
