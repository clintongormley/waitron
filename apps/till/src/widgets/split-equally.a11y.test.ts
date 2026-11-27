import { afterEach, beforeEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import "./split-equally.js";
import type { TillSplitEqually } from "./split-equally.js";

const originalLocale = currentLocale();

beforeEach(() => setLocale("en"));

afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

const states: [string, Partial<TillSplitEqually>][] = [
  ["with nothing taken", { left: "73.30", startCount: 3 }],
  ["asking who is still to pay", { left: "48.86", taken: true, startCount: 4 }],
  [
    "with a paid guest and a card in progress",
    {
      left: "24.43",
      taken: true,
      startCount: 3,
      paid: [
        { amount: "24.44", state: "received" },
        { amount: "24.43", state: "card" },
      ],
    },
  ],
  ["at a limit", { left: "0.02", startCount: 2 }],
];

describe.each(["light", "dark"] as const)("till-split-equally a11y (%s theme)", (theme) => {
  it.each(states)("has no violations %s", async (_, props) => {
    const { host } = await mountWidget<TillSplitEqually>(
      "till-split-equally",
      { billName: "Bill 1", ...props },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
