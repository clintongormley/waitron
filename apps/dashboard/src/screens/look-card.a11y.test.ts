import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it } from "vitest";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./look-card.js";

type Card = HTMLElementTagNameMap["dashboard-look-card"];

function theme(id: string, name: string, choices: ThemeChoices): ThemeView {
  const derived = deriveTheme(choices);
  return {
    id,
    name,
    updatedAt: "2026-10-21T10:00:00.000Z",
    choices,
    light: derived.light,
    dark: derived.dark,
    warnings: derived.warnings,
  };
}

const lucia = theme("t-lucia", "Bar Lucía", {
  brandColor: "#1e5b3a",
  brandFix: { dark: true },
  background: "tinted",
  corners: "round",
  handSet: { light: {}, dark: {} },
});
const twoFixes = theme("t-hand", "By hand", {
  ...WAITRON_CHOICES,
  handSet: { light: { text: "#6a6a6a", "surface-sunken": "#bbbbbb" }, dark: {} },
});
const inUse = (view: ThemeView): ThemeList => ({ themes: [view], inUse: view.id });

const q = (el: Card, selector: string) => el.shadowRoot!.querySelector(selector);

async function typeInCode(el: Card, value: string) {
  const inner = q(el, "wt-input[name=brandColor]")!.shadowRoot!.querySelector("input")!;
  await page.elementLocator(inner).fill(value);
  await el.updateComplete;
}

async function press(el: Card, test: string) {
  await userEvent.click(q(el, `[data-test=${test}]`)!);
  await el.updateComplete;
}

const states: Record<string, { list: ThemeList; reach: (el: Card) => Promise<string> }> = {
  "editing Bar Lucía": { list: inUse(lucia), reach: async () => "[data-test=brand-fixed-dark]" },
  "the lemon warning": {
    list: inUse(lucia),
    reach: async (el) => {
      await typeInCode(el, "#f2d300");
      return "[data-test=brand-fix-light]";
    },
  },
  "the lemon fixed": {
    list: inUse(lucia),
    reach: async (el) => {
      await typeInCode(el, "#f2d300");
      await press(el, "brand-fix-light");
      return "[data-test=brand-undo-light]";
    },
  },
  "the Fix all line": { list: inUse(twoFixes), reach: async () => "[data-test=fix-all]" },
  "the code field's error": {
    list: inUse(lucia),
    reach: async (el) => {
      await typeInCode(el, "#12");
      await press(el, "save");
      return "wt-input[name=brandColor]";
    },
  },
};

const cases = ["light", "dark"].flatMap((mode) =>
  ["en-GB", "es-ES"].flatMap((locale) =>
    Object.keys(states).map((state) => ({ mode: mode as "light" | "dark", locale, state })),
  ),
);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it.each(cases)("Look card: $state, $locale / $mode", async ({ mode, locale, state }) => {
  setLocale(locale);
  const { list, reach } = states[state]!;
  const { el, host } = await mountWidget<Card>(
    "dashboard-look-card",
    { api: {} as DashboardApi, list, canEdit: true },
    mode,
  );
  await press(el, "edit");
  const select = await reach(el);
  await expect.poll(() => q(el, select)).toBeTruthy();
  if (state === "the code field's error") {
    expect((q(el, select) as HTMLElementTagNameMap["wt-input"]).error).not.toBe("");
  }
  await el.updateComplete;
  await expectNoA11yViolations(host);
});
