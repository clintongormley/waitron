import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { en, es } from "../i18n/strings.js";
import { setLocale, t } from "../i18n/t.js";
import { openDraft, setHand, typeHandCode, type LookDraft } from "./look-draft.js";
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

const states: Record<
  string,
  {
    draft: LookDraft;
    open: boolean;
    extra?: () => Partial<ThemeAdvanced>;
    check?: (el: ThemeAdvanced) => void;
  }
> = {
  closed: { draft: CREAM, open: false },
  "open, nothing set by hand": { draft: NONE, open: true },
  "open, a value set by hand": {
    draft: CREAM,
    open: true,
    check: (el) => expect(q(el, "[data-test=hand-worked-out-light-bg]")).not.toBeNull(),
  },
  "open, a warning and its fix": {
    draft: TWO_FIXES,
    open: true,
    check: (el) => {
      expect(q(el, "[data-test=hand-warning-light-text]")).not.toBeNull();
      expect(q(el, "[data-test=hand-fix-light-text]")).not.toBeNull();
    },
  },
  "open, a fixed line": {
    draft: TAKEN,
    open: true,
    extra: () => ({ fixed: FIXED }),
    check: (el) => expect(q(el, "[data-test=hand-fixed-light-text-muted]")).not.toBeNull(),
  },
  "open, an error": {
    draft: HALF_TYPED,
    open: true,
    extra: () => ({ errors: { "handSet.light.bg": t("appearance.bad_code") } }),
    check: (el) =>
      expect(
        q<HTMLElementTagNameMap["wt-input"]>(el, 'wt-input[name="handSet.light.bg"]')!.error,
      ).not.toBe(""),
  },
};

const q = <T extends Element = HTMLElement>(el: ThemeAdvanced, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);

const cases = (["light", "dark"] as const).flatMap((mode) =>
  [1280, 390].flatMap((width) =>
    Object.keys(states).flatMap((state) =>
      (["en-GB", "es-ES"] as const).map((locale) => ({ mode, width, state, locale })),
    ),
  ),
);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it.each(cases)(
  "Advanced: $state, $width px, $locale / $mode",
  async ({ mode, width, state, locale }) => {
    setLocale(locale);
    await page.viewport(width, 900);
    const { draft, open, extra, check } = states[state]!;
    const { el, host } = await mountWidget<ThemeAdvanced>(
      "dashboard-theme-advanced",
      { draft, derived: deriveTheme(draft.choices), ...extra?.() },
      mode,
    );
    const disclosure = q<HTMLElementTagNameMap["wt-disclosure"]>(el, "[data-test=advanced]")!;
    const strings = locale === "es-ES" ? es : en;
    expect(disclosure.heading).toBe(strings["appearance.advanced"]);
    if (open) {
      await openDisclosure(disclosure);
      await el.updateComplete;
    }
    expect(disclosure.open).toBe(open);
    check?.(el);
    await expectNoA11yViolations(host);
  },
);
