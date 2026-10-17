import { html, type TemplateResult } from "lit";
import { currentThemeChoice } from "@waitron/ui";
import "@waitron/ui/src/components/wt-theme-chooser.js";
import { t } from "../i18n/t.js";

/** The host must hold a `ThemeChoiceController` and a `LocaleChangeController`, or it draws stale. */
export function themeChooser(): TemplateResult {
  return html`<wt-theme-chooser
    data-test="theme-chooser"
    .active=${currentThemeChoice()}
    .labels=${{
      theme: t("theme.label"),
      light: t("theme.light"),
      dark: t("theme.dark"),
      device: t("theme.device"),
    }}
  ></wt-theme-chooser>`;
}
