import { afterEach, beforeEach, expect, it } from "vitest";
import { commands, page } from "vitest/browser";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { en, es } from "../i18n/strings.js";
import { setLocale, t } from "../i18n/t.js";
import { ADVANCED_SECTIONS, COLOUR_SECTIONS, type AdvancedSectionId } from "./advanced-sections.js";
import { openDraft, setHand, setTextSize, typeHandCode, type LookDraft } from "./look-draft.js";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
  openDisclosure,
} from "./test-helpers.js";
import type { ThemeAdvanced } from "./theme-advanced.js";
import "./theme-advanced.js";

const LUCIA: ThemeChoices = {
  brandColor: "#1e5b3a",
  brandFix: { dark: true },
  background: "tinted",
  corners: "round",
  logo: null,
  handSet: { light: {}, dark: {} },
  textScale: 100,
  text: {},
};
const NONE = openDraft(LUCIA);
const CREAM = setHand(NONE, "light", "bg", "#f8f1e1");
const TWO_FIXES = setHand(
  setHand(openDraft(WAITRON_CHOICES), "light", "text", "#6a6a6a"),
  "light",
  "surface-sunken",
  "#bbbbbb",
);
const TAKEN = setHand(CREAM, "light", "text-muted", "#526a5b");
const FIXED = { "handSet.light.text-muted": { from: "#8fa898", to: "#526a5b" } };
const HALF_TYPED = typeHandCode(NONE, "light", "bg", "#12");

const SMALL_TEXT = setTextSize(NONE, "sm", 10);

const q = <T extends Element = HTMLElement>(el: ThemeAdvanced, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const section = (el: ThemeAdvanced, id: AdvancedSectionId) =>
  q<HTMLElementTagNameMap["wt-disclosure"]>(el, `[data-test=section-${id}]`)!;
const drawnSummary = (fold: HTMLElementTagNameMap["wt-disclosure"]) =>
  fold.shadowRoot!.querySelector(".summary")!.textContent!;
const visible = (node: Element | null) => expect(node!.checkVisibility()).toBe(true);

const states: Record<
  string,
  {
    draft: LookDraft;
    open: boolean;
    sections: readonly AdvancedSectionId[];
    extra?: () => Partial<ThemeAdvanced>;
    check: (el: ThemeAdvanced, strings: Record<keyof typeof en, string>) => void;
  }
> = {
  closed: {
    draft: CREAM,
    open: false,
    sections: [],
    check: (el) => visible(q(el, "[data-test=advanced]")),
  },
  "open, every section closed": {
    draft: NONE,
    open: true,
    sections: [],
    check: (el) => {
      for (const id of ADVANCED_SECTIONS) {
        expect(section(el, id).open).toBe(false);
        visible(section(el, id));
      }
    },
  },
  "open, every section open, nothing set by hand": {
    draft: NONE,
    open: true,
    sections: ADVANCED_SECTIONS,
    check: (el) => {
      for (const { keys } of COLOUR_SECTIONS) visible(q(el, `[data-test=hand-row-${keys[0]}]`));
      visible(q(el, "dashboard-theme-text"));
    },
  },
  "open, a value set by hand": {
    draft: CREAM,
    open: true,
    sections: ["surfaces"],
    check: (el) => visible(q(el, "[data-test=hand-worked-out-light-bg]")),
  },
  "open, a warning and its fix": {
    draft: TWO_FIXES,
    open: true,
    sections: ["surfaces", "text-colours"],
    check: (el) => {
      visible(q(el, "[data-test=hand-warning-light-text]"));
      visible(q(el, "[data-test=hand-fix-light-text]"));
      visible(q(el, "[data-test=hand-warning-light-surface-sunken]"));
    },
  },
  "open, a fixed line": {
    draft: TAKEN,
    open: true,
    sections: ["text-colours"],
    extra: () => ({ fixed: FIXED }),
    check: (el) => visible(q(el, "[data-test=hand-fixed-light-text-muted]")),
  },
  "open, an error": {
    draft: HALF_TYPED,
    open: true,
    sections: [],
    extra: () => ({ errors: { "handSet.light.bg": t("appearance.bad_code") } }),
    check: (el) => {
      expect(section(el, "surfaces").open).toBe(true);
      const input = q<HTMLElementTagNameMap["wt-input"]>(el, 'wt-input[name="handSet.light.bg"]')!;
      expect(input.error).not.toBe("");
      visible(input);
    },
  },
  "open, sections closed, counting warnings": {
    draft: TWO_FIXES,
    open: true,
    sections: [],
    check: (el, strings) => {
      const counted = ` · ${strings["appearance.hard_to_read_count_one"]}`;
      for (const id of ADVANCED_SECTIONS) {
        expect(section(el, id).open).toBe(false);
        visible(section(el, id));
        const warned = id === "surfaces" || id === "text-colours";
        expect(drawnSummary(section(el, id)).endsWith(counted)).toBe(warned);
      }
    },
  },
  "open, the Text section open with a text warning": {
    draft: SMALL_TEXT,
    open: true,
    sections: ["text"],
    check: (el) =>
      visible(
        q(el, "dashboard-theme-text")!.shadowRoot!.querySelector(
          '[data-test="text-warning-size.sm"]',
        ),
      ),
  },
};

const cases = (["light", "dark"] as const).flatMap((mode) =>
  [1280, 390].flatMap((width) =>
    Object.keys(states).flatMap((state) =>
      (["en-GB", "es-ES"] as const).map((locale) => ({ mode, width, state, locale })),
    ),
  ),
);

// Folds open at once rather than over their animation.
beforeEach(async () => {
  await commands.emulateReducedMotion("reduce");
});
afterEach(async () => {
  cleanupWidgets();
  setLocale("en-GB");
  await commands.emulateReducedMotion(null);
});

it.each(cases)(
  "Advanced: $state, $width px, $locale / $mode",
  async ({ mode, width, state, locale }) => {
    setLocale(locale);
    await page.viewport(width, 900);
    const { draft, open, sections, extra, check } = states[state]!;
    const { el, host } = await mountWidget<ThemeAdvanced>(
      "dashboard-theme-advanced",
      { draft, derived: deriveTheme(draft.choices), ...extra?.() },
      mode,
    );
    const disclosure = q<HTMLElementTagNameMap["wt-disclosure"]>(el, "[data-test=advanced]")!;
    const strings = locale === "es-ES" ? es : en;
    expect(disclosure.heading).toBe(strings["appearance.advanced"]);
    if (open) {
      await openDisclosure(disclosure, { domClick: true });
      await el.updateComplete;
    }
    expect(disclosure.open).toBe(open);
    for (const id of sections) await openDisclosure(section(el, id), { domClick: true });
    await el.updateComplete;
    check(el, strings);
    await expectNoA11yViolations(host);
  },
);
