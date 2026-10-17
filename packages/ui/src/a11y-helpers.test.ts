import { afterEach, expect, test, vi } from "vitest";
import axe from "axe-core";
import { cleanup, host, mount } from "./test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "./a11y-helpers.js";
import "./components/wt-button.js";
import "./components/wt-icon.js";
import "./components/wt-input.js";

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

// The canary for the whole a11y harness: the markup worth checking lives in shadow roots, so axe
// has to be seen reaching into them.
test("axe traverses into shadow roots: catches an icon-only button with no accessible name", async () => {
  await mount('<wt-button><wt-icon name="close"></wt-icon></wt-button>');
  const results = await axe.run(host);
  const ruleIds = results.violations.map((violation) => violation.id);
  expect(ruleIds).toContain("button-name");
});

test("the same button is clean once aria-label restores its accessible name", async () => {
  await mount('<wt-button aria-label="Cerrar"><wt-icon name="close"></wt-icon></wt-button>');
  await expectNoA11yViolations(host);
});

const COLOUR_READINGS = ["equalRatio", "fgAlpha", "colorParse"];

const OVERLAPPED_TEXT =
  '<div style="position:relative"><p style="color:var(--wt-color-text)">Overlapped words here</p>' +
  '<div style="position:absolute;inset:0;background:var(--wt-color-surface);opacity:0.5"></div></div>';

async function undecidedContrastReasons(): Promise<{ violations: string[]; reasons: string[] }> {
  const results = await axe.run(host);
  const reasons = results.incomplete
    .filter((result) => result.id === "color-contrast")
    .flatMap((result) => result.nodes.flatMap((node) => node.any))
    .map((check) => (check.data as { messageKey?: string } | null)?.messageKey ?? "");
  return { violations: results.violations.map((violation) => violation.id), reasons };
}

test.each(["light", "dark"] as const)(
  "text the same colour as its background fails, though axe calls it undecided (%s)",
  async (theme) => {
    await mountThemed('<p style="color: var(--wt-color-bg)">Hidden words</p>', theme);
    const { violations, reasons } = await undecidedContrastReasons();
    expect(violations).not.toContain("color-contrast");
    expect(reasons).toContain("equalRatio");
    await expect(expectNoA11yViolations(host)).rejects.toThrow(
      /color-contrast \[undecided\]: Element has a 1:1 contrast ratio with the background/,
    );
  },
);

test.each(["light", "dark"] as const)("readable text passes (%s)", async (theme) => {
  await mountThemed('<p style="color: var(--wt-color-text)">Readable words</p>', theme);
  await expectNoA11yViolations(host);
});

test("an undecided reading that is not about colour still passes: an empty field", async () => {
  await mountThemed('<wt-input label="Peso (kg)"></wt-input>', "light");
  const { reasons } = await undecidedContrastReasons();
  expect(reasons).toContain("emptyValue");
  expect(reasons.filter((reason) => COLOUR_READINGS.includes(reason))).toEqual([]);
  await expectNoA11yViolations(host);
});

test("an undecided reading that is not about colour still passes: an overlapping box", async () => {
  await mountThemed(OVERLAPPED_TEXT, "light");
  const { reasons } = await undecidedContrastReasons();
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
