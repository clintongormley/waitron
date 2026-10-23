import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it } from "vitest";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { fill, setLocale } from "../i18n/t.js";
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
const outlasts = theme("t-out", "Outlasts", {
  ...WAITRON_CHOICES,
  handSet: { light: { text: "#aaaaaa", "surface-sunken": "#555555" }, dark: {} },
});
const christmas = theme("t-xmas", "Christmas", {
  ...WAITRON_CHOICES,
  brandColor: "#7a1f2b",
  brandFix: { dark: true },
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

async function openSaveDialog(el: Card, canFix: boolean): Promise<string> {
  await press(el, "save");
  const dialog = q(el, "dashboard-hard-to-read-dialog")!;
  await expect.poll(() => dialog.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
  expect(dialog.shadowRoot!.querySelector("[data-test=fix-and-save]") !== null).toBe(canFix);
  return "dashboard-hard-to-read-dialog";
}

const advanced = (el: Card) => q(el, "dashboard-theme-advanced")!;
const inAdvanced = (el: Card, selector: string) =>
  advanced(el).shadowRoot!.querySelector<HTMLElement>(selector);

async function openAdvanced(el: Card) {
  const disclosure = inAdvanced(
    el,
    "[data-test=advanced]",
  ) as HTMLElementTagNameMap["wt-disclosure"];
  if (!disclosure.open) {
    await userEvent.click(disclosure.shadowRoot!.querySelector("button.header")!);
    await disclosure.updateComplete;
  }
  expect(disclosure.open).toBe(true);
}

async function typeHand(el: Card, mode: string, key: string, value: string) {
  await openAdvanced(el);
  const field = inAdvanced(el, `wt-input[name="handSet.${mode}.${key}"]`)!;
  await page.elementLocator(field.shadowRoot!.querySelector("input")!).fill(value);
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
  "the Hard to read dialog with Fix and save": {
    list: inUse(lucia),
    reach: async (el) => {
      await typeInCode(el, "#f2d300");
      return openSaveDialog(el, true);
    },
  },
  "the Hard to read dialog without Fix and save": {
    list: inUse(outlasts),
    reach: async (el) => {
      const square = [
        ...q(el, "wt-segmented-control[name=corners]")!.shadowRoot!.querySelectorAll("button"),
      ].at(-1)!;
      await userEvent.click(square);
      await el.updateComplete;
      return openSaveDialog(el, false);
    },
  },
  "the editor showing Save as new theme…": {
    list: inUse(lucia),
    reach: async () => "[data-test=save-as-new]",
  },
  "the editor headed Edit theme: Christmas": {
    list: { themes: [lucia, christmas], inUse: lucia.id },
    reach: async (el) => {
      el.edit({ id: christmas.id });
      await el.updateComplete;
      expect(q(el, "section.settings-card header > h2")?.textContent?.trim()).toBe(
        fill("appearance.edit_theme_heading", { name: "Christmas" }),
      );
      return "[data-test=save-as-new]";
    },
  },
  "the first save's name dialog open over the editor": {
    list: { themes: [lucia], inUse: null },
    reach: async (el) => {
      await userEvent.click(q(el, 'button.swatch[data-color="#dd5f5f"]')!);
      await el.updateComplete;
      await press(el, "save");
      const host = q(el, "dashboard-theme-name-dialog")!;
      await expect
        .poll(
          () =>
            host.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>("wt-dialog")!.open,
        )
        .toBe(true);
      return "dashboard-theme-name-dialog";
    },
  },
  "the code field's error": {
    list: inUse(lucia),
    reach: async (el) => {
      await typeInCode(el, "#12");
      await press(el, "save");
      return "wt-input[name=brandColor]";
    },
  },
  "Advanced open, nothing set by hand": {
    list: inUse(lucia),
    reach: async (el) => {
      await openAdvanced(el);
      return "dashboard-theme-advanced";
    },
  },
  "Advanced open with two warnings": {
    list: inUse(twoFixes),
    reach: async (el) => {
      await openAdvanced(el);
      expect(inAdvanced(el, "[data-test=hand-warning-light-text]")).not.toBeNull();
      expect(inAdvanced(el, "[data-test=hand-warning-light-surface-sunken]")).not.toBeNull();
      return "dashboard-theme-advanced";
    },
  },
  "a fixed-from line": {
    list: inUse(twoFixes),
    reach: async (el) => {
      await press(el, "fix-all");
      await openAdvanced(el);
      await expect.poll(() => inAdvanced(el, "[data-test=hand-fixed-light-text]")).toBeTruthy();
      return "dashboard-theme-advanced";
    },
  },
  "a hand code's error": {
    list: inUse(lucia),
    reach: async (el) => {
      await typeHand(el, "light", "bg", "#12");
      await press(el, "save");
      await expect
        .poll(
          () =>
            (
              inAdvanced(
                el,
                'wt-input[name="handSet.light.bg"]',
              ) as HTMLElementTagNameMap["wt-input"]
            ).error,
        )
        .not.toBe("");
      return "dashboard-theme-advanced";
    },
  },
  "the dark own colour line": {
    list: inUse(lucia),
    reach: async (el) => {
      await press(el, "pick-dark");
      await typeHand(el, "dark", "primary", "#5fa77a");
      return "[data-test=dark-own]";
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
  // The editor behind an open dialog is covered by the states above; "without Fix and save" draws
  // unreadable text in its preview by definition, and axe still reaches it behind this dialog.
  const dialog = q(el, "dashboard-hard-to-read-dialog");
  await expectNoA11yViolations(state.startsWith("the Hard to read dialog") ? dialog! : host);
});
