import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { WAITRON_CHOICES } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { setLocale, t } from "../i18n/t.js";
import { openDraft, type LookDraft } from "./look-draft.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { ThemeTextRows } from "./theme-text.js";
import "./theme-text.js";

const WORKED_OUT = openDraft(WAITRON_CHOICES);
const ALL_SET = openDraft({
  ...WAITRON_CHOICES,
  textScale: 115,
  text: {
    family: "serif",
    size: { sm: 13, md: 15, lg: 19, xl: 23 },
    weight: { normal: 500, medium: 600, bold: 800 },
  },
});

const states: Record<
  string,
  { draft: LookDraft; extra?: () => Partial<ThemeTextRows>; check?: (el: ThemeTextRows) => void }
> = {
  "worked out": { draft: WORKED_OUT },
  "every row set by hand": {
    draft: ALL_SET,
    check: (el) => expect(q(el, '[data-test="text-worked-out-size.sm"]')).not.toBeNull(),
  },
  "an error": {
    draft: { ...WORKED_OUT, textCodes: { sm: "x" } },
    extra: () => ({ errors: { "text.size.sm": t("appearance.bad_text_px") } }),
    check: (el) =>
      expect(
        q<HTMLElementTagNameMap["wt-number-stepper"]>(el, 'wt-number-stepper[name="text.size.sm"]')!
          .error,
      ).not.toBe(""),
  },
};

const q = <T extends Element = HTMLElement>(el: ThemeTextRows, selector: string) =>
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
  "Text rows: $state, $width px, $locale / $mode",
  async ({ mode, width, state, locale }) => {
    setLocale(locale);
    await page.viewport(width, 900);
    const { draft, extra, check } = states[state]!;
    const { el, host } = await mountWidget<ThemeTextRows>(
      "dashboard-theme-text",
      { draft, derived: deriveTheme(draft.choices), ...extra?.() },
      mode,
    );
    check?.(el);
    await expectNoA11yViolations(host);
  },
);
