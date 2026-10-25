import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
  pageAt,
  resetPage,
} from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./late-send-dialog.js";
import type { TillLateSendDialog } from "./late-send-dialog.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const dishes = [
  { quantity: "2.000", name: "Omelette", unitName: null },
  { quantity: "0.320", name: "Ham", unitName: { en: "kg" }, soldInEach: false },
];

describe.each(["light", "dark"] as const)("till-late-send-dialog a11y (%s theme)", (theme) => {
  it.each([
    ["one period", ["Lunch"]],
    ["two periods", ["Breakfast", "Lunch"]],
  ])("has no violations with %s", async (_state, periodNames) => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillLateSendDialog>(
      "till-late-send-dialog",
      { dishes, periodNames, purpose: "send" },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});

describe("till-late-send-dialog on a 390px phone", () => {
  afterEach(resetPage);

  it.each(["send", "save"] as const)(
    "keeps each footer button inside the screen (%s)",
    async (purpose) => {
      await pageAt(390, 844);
      setLocale("es-ES");
      const { el } = await mountWidget<TillLateSendDialog>("till-late-send-dialog", {
        dishes,
        periodNames: ["Breakfast", "Lunch"],
        purpose,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const buttons = [
        ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-late-remove], [data-late-agreed]"),
      ];
      expect(buttons).toHaveLength(2);
      expect(window.innerWidth).toBe(390);
      for (const button of buttons) {
        const box = button.getBoundingClientRect();
        expect(box.width).toBeGreaterThan(0);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(window.innerWidth);
      }
    },
  );
});
