import { afterEach, expect, it } from "vitest";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { en, es } from "../i18n/strings.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./theme-preview.js";

type Preview = HTMLElementTagNameMap["dashboard-theme-preview"];

const drafts: Record<string, ThemeChoices> = {
  waitron: WAITRON_CHOICES,
  lucia: {
    brandColor: "#1e5b3a",
    brandFix: { dark: true },
    background: "tinted",
    corners: "round",
    handSet: { light: {}, dark: {} },
  },
  lemon: { ...WAITRON_CHOICES, brandColor: "#f2d300" },
  "two fixes": {
    ...WAITRON_CHOICES,
    handSet: { light: { text: "#6a6a6a", "surface-sunken": "#bbbbbb" }, dark: {} },
  },
};

const cases = (["light", "dark"] as const).flatMap((mode) =>
  Object.keys(drafts).flatMap((draft) =>
    (["en-GB", "es-ES"] as const).map((locale) => ({ mode, draft, locale })),
  ),
);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it.each(cases)("theme preview: $draft, $locale / $mode", async ({ mode, draft, locale }) => {
  setLocale(locale);
  const { el, host } = await mountWidget<Preview>(
    "dashboard-theme-preview",
    { theme: deriveTheme(drafts[draft]!), name: "Bar Lucía" },
    mode,
  );
  const strings = locale === "es-ES" ? es : en;
  expect(el.shadowRoot!.querySelector("h3")?.textContent?.trim()).toBe(
    strings["appearance.preview"],
  );
  await expectNoA11yViolations(host);
});
