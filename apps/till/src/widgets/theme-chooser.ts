import { html, type TemplateResult } from "lit";
import { currentThemeChoice, themeLabelsPerLocale, type WtThemeLabels } from "@waitron/ui";
import "@waitron/ui/src/components/wt-theme-chooser.js";
import { currentLocale, t } from "../i18n/t.js";

const labelsFor = themeLabelsPerLocale(() => ({
  theme: t("theme.label"),
  light: t("theme.light"),
  dark: t("theme.dark"),
  device: t("theme.device"),
}));

export function themeLabels(): WtThemeLabels {
  return labelsFor(currentLocale());
}

/** The host must hold a `ThemeChoiceController` and a `LocaleChangeController`, or it draws stale. */
export function themeChooser(): TemplateResult {
  return html`<wt-theme-chooser
    data-test="theme-chooser"
    .active=${currentThemeChoice()}
    .labels=${themeLabels()}
  ></wt-theme-chooser>`;
}
