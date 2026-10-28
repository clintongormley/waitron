import { commands, page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mediaTestReference,
  mediaTestRendition,
  useMediaPresentations,
} from "@waitron/ui/src/test-helpers.js";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeLogoPrint, ThemeView } from "../api/client.js";
import { fill, setLocale, t } from "../i18n/t.js";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
  openDisclosure,
  openFoldsAround,
} from "../widgets/test-helpers.js";
import {
  ADVANCED_SECTIONS,
  COLOUR_SECTIONS,
  type AdvancedSectionId,
} from "../widgets/advanced-sections.js";
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
  logo: null,
  handSet: { light: {}, dark: {} },
  textScale: 100,
  text: {},
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
const withLogo = theme("t-logo", "With a logo", {
  ...WAITRON_CHOICES,
  logo: { light: mediaTestReference("lucia.png"), dark: mediaTestReference("lucia-dark.png") },
});
const smallText = theme("t-small", "Small text", {
  ...WAITRON_CHOICES,
  text: { size: { sm: 10 } },
});
const inUse = (view: ThemeView): ThemeList => ({ themes: [view], inUse: view.id });

useMediaPresentations();

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

const section = (el: Card, id: AdvancedSectionId) =>
  inAdvanced(el, `[data-test=section-${id}]`) as HTMLElementTagNameMap["wt-disclosure"];

const visible = (node: Element | null) => expect(node!.checkVisibility()).toBe(true);

async function openAdvanced(el: Card) {
  await openDisclosure(
    inAdvanced(el, "[data-test=advanced]") as HTMLElementTagNameMap["wt-disclosure"],
    { domClick: true },
  );
}

async function typeHand(el: Card, mode: string, key: string, value: string) {
  const field = inAdvanced(el, `wt-input[name="handSet.${mode}.${key}"]`)!;
  const inner = field.shadowRoot!.querySelector("input")!;
  await openFoldsAround(inner, { domClick: true });
  await page.elementLocator(inner).fill(value);
  await el.updateComplete;
}

async function slideText(el: Card, value: number) {
  const slider = q(el, "wt-slider[name=textScale]") as HTMLElementTagNameMap["wt-slider"];
  const input = slider.shadowRoot!.querySelector("input")!;
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  await el.updateComplete;
  return slider;
}

const states: Record<
  string,
  { list: ThemeList; reach: (el: Card) => Promise<string>; api?: () => DashboardApi }
> = {
  "the editor with a logo and a dark one": {
    list: inUse(withLogo),
    reach: async () => "dashboard-theme-logo-field",
  },
  "a logo refusal shown": {
    list: inUse(withLogo),
    api: () =>
      ({
        saveTheme: vi.fn(async () => {
          throw {
            code: "theme.invalid",
            params: { field: "logo.light", reason: "image_not_found" },
          };
        }),
      }) as unknown as DashboardApi,
    reach: async (el) => {
      const square = [
        ...q(el, "wt-segmented-control[name=corners]")!.shadowRoot!.querySelectorAll("button"),
      ].at(-1)!;
      await userEvent.click(square);
      await el.updateComplete;
      await press(el, "save");
      const field = q(
        el,
        "dashboard-theme-logo-field",
      ) as HTMLElementTagNameMap["dashboard-theme-logo-field"];
      await expect.poll(() => field.errors.light).toBe(t("appearance.logo_not_found"));
      await field.updateComplete;
      return "dashboard-theme-logo-field";
    },
  },
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
  "Advanced open, every section closed": {
    list: inUse(lucia),
    reach: async (el) => {
      await openAdvanced(el);
      for (const id of ADVANCED_SECTIONS) {
        expect(section(el, id).open).toBe(false);
        visible(section(el, id));
      }
      return "dashboard-theme-advanced";
    },
  },
  "Advanced open, nothing set by hand": {
    list: inUse(lucia),
    reach: async (el) => {
      await openAdvanced(el);
      for (const id of ADVANCED_SECTIONS) await openDisclosure(section(el, id), { domClick: true });
      for (const { keys } of COLOUR_SECTIONS)
        visible(inAdvanced(el, `[data-test=hand-row-${keys[0]}]`));
      visible(inAdvanced(el, "dashboard-theme-text"));
      return "dashboard-theme-advanced";
    },
  },
  "Advanced open with a text size warning": {
    list: inUse(smallText),
    reach: async (el) => {
      await openAdvanced(el);
      const rows = inAdvanced(el, "dashboard-theme-text")!;
      expect(rows.shadowRoot!.querySelector('[data-test="text-warning-size.sm"]')).not.toBeNull();
      await openFoldsAround(rows.shadowRoot!.querySelector('[data-test="text-warning-size.sm"]')!, {
        domClick: true,
      });
      visible(rows.shadowRoot!.querySelector('[data-test="text-warning-size.sm"]'));
      return "dashboard-theme-advanced";
    },
  },
  "Advanced open with two warnings": {
    list: inUse(twoFixes),
    reach: async (el) => {
      await openAdvanced(el);
      expect(inAdvanced(el, "[data-test=hand-warning-light-text]")).not.toBeNull();
      expect(inAdvanced(el, "[data-test=hand-warning-light-surface-sunken]")).not.toBeNull();
      await openFoldsAround(inAdvanced(el, "[data-test=hand-warning-light-text]")!, {
        domClick: true,
      });
      await openFoldsAround(inAdvanced(el, "[data-test=hand-warning-light-surface-sunken]")!, {
        domClick: true,
      });
      visible(inAdvanced(el, "[data-test=hand-warning-light-text]"));
      visible(inAdvanced(el, "[data-test=hand-warning-light-surface-sunken]"));
      return "dashboard-theme-advanced";
    },
  },
  "a fixed-from line": {
    list: inUse(twoFixes),
    reach: async (el) => {
      await press(el, "fix-all");
      await openAdvanced(el);
      await expect.poll(() => inAdvanced(el, "[data-test=hand-fixed-light-text]")).toBeTruthy();
      await openFoldsAround(inAdvanced(el, "[data-test=hand-fixed-light-text]")!, {
        domClick: true,
      });
      visible(inAdvanced(el, "[data-test=hand-fixed-light-text]"));
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
      await el.updateComplete;
      expect(section(el, "surfaces").hasAttribute("has-error")).toBe(true);
      visible(inAdvanced(el, 'wt-input[name="handSet.light.bg"]'));
      return "dashboard-theme-advanced";
    },
  },
  "Pick a different colour for dark screens pressed": {
    list: inUse(lucia),
    reach: async (el) => {
      await press(el, "pick-dark");
      const field = inAdvanced(el, 'wt-input[name="handSet.dark.primary"]')!;
      const inner = field.shadowRoot!.querySelector("input")!;
      await expect.poll(() => field.shadowRoot!.activeElement).toBe(inner);
      expect(
        (inAdvanced(el, "[data-test=advanced]") as HTMLElementTagNameMap["wt-disclosure"]).open,
      ).toBe(true);
      expect(section(el, "buttons").open).toBe(true);
      visible(field);
      return "dashboard-theme-advanced";
    },
  },
  "text size moved to 130%": {
    list: inUse(lucia),
    reach: async (el) => {
      const slider = await slideText(el, 130);
      expect(slider.value).toBe(130);
      await slider.updateComplete;
      return "wt-slider[name=textScale]";
    },
  },
  "a refused text size": {
    list: inUse(lucia),
    api: () =>
      ({
        saveTheme: vi.fn(async () => {
          throw { code: "theme.invalid", params: { field: "textScale", reason: "bad_value" } };
        }),
      }) as unknown as DashboardApi,
    reach: async (el) => {
      const slider = await slideText(el, 120);
      await press(el, "save");
      await expect.poll(() => slider.error).toBe(t("appearance.bad_text_size"));
      await slider.updateComplete;
      return "wt-slider[name=textScale]";
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

/** The editor's "How it prints" answer: a normal picture of whichever image it asks about. */
const printing = () => ({
  getThemeLogoPrint: vi.fn(async (image: string): Promise<ThemeLogoPrint> => ({
    paperDots: 504,
    address: mediaTestRendition(image, "display"),
    picture: { widthDots: 16, heightDots: 1, data: "8A8=" },
    blackDots: 8,
  })),
});

const cases = ["light", "dark"].flatMap((mode) =>
  ["en-GB", "es-ES"].flatMap((locale) =>
    Object.keys(states).map((state) => ({ mode: mode as "light" | "dark", locale, state })),
  ),
);

// Folds open at once rather than over their animation.
beforeEach(() => commands.emulateReducedMotion("reduce"));
afterEach(async () => {
  cleanupWidgets();
  setLocale("en-GB");
  await commands.emulateReducedMotion(null);
});

it.each(cases)("Look card: $state, $locale / $mode", async ({ mode, locale, state }) => {
  setLocale(locale);
  const { list, reach, api } = states[state]!;
  const { el, host } = await mountWidget<Card>(
    "dashboard-look-card",
    { api: { ...printing(), ...api?.() } as unknown as DashboardApi, list, canEdit: true },
    mode,
  );
  await press(el, "edit");
  const select = await reach(el);
  await expect.poll(() => q(el, select)).toBeTruthy();
  if (state === "the code field's error") {
    expect((q(el, select) as HTMLElementTagNameMap["wt-input"]).error).not.toBe("");
  }
  const printed = q(el, "dashboard-theme-logo-field")?.shadowRoot?.querySelector(
    "dashboard-theme-logo-print",
  );
  if (printed)
    await expect
      .poll(() => printed.shadowRoot!.querySelector('[data-test="logo-print"] img'))
      .toBeTruthy();
  await el.updateComplete;
  // The editor behind an open dialog is covered by the states above; "without Fix and save" draws
  // unreadable text in its preview by definition, and axe still reaches it behind this dialog.
  const dialog = q(el, "dashboard-hard-to-read-dialog");
  await expectNoA11yViolations(state.startsWith("the Hard to read dialog") ? dialog! : host);
});

it.each(
  ["light", "dark"].flatMap((mode) =>
    ["en-GB", "es-ES"].map((locale) => ({ mode: mode as "light" | "dark", locale })),
  ),
)("the saved Look card with a logo, $locale / $mode", async ({ mode, locale }) => {
  setLocale(locale);
  const { el, host } = await mountWidget<Card>(
    "dashboard-look-card",
    { api: {} as DashboardApi, list: inUse(withLogo), canEdit: true },
    mode,
  );
  await expect.poll(() => q(el, "[data-test=saved-logo] wt-venue-logo")).toBeTruthy();
  await expectNoA11yViolations(host);
});
