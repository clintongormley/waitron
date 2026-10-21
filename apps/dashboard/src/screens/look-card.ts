import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { CATEGORY_PALETTE, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import {
  BUILT_IN_THEME_NAME,
  MODES,
  THEME_COLOURS,
  WAITRON_CHOICES,
  type Mode,
  type ThemeChoices,
} from "@waitron/ui-core/theme";
import { WAITRON_DEFAULTS } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { fill, t } from "../i18n/t.js";
import { settingsCard, settingsCardStyles, settingsRows } from "../widgets/settings-card.js";
import { savedWarningLine, themeColourName } from "../widgets/theme-words.js";

const PRIMARY = "--wt-color-primary";

function chip(colour: string): TemplateResult {
  return html`<span class="chip" aria-hidden="true" style="background:${colour}"></span>`;
}

function brandRow(view: ThemeView | undefined, choices: ThemeChoices): TemplateResult {
  const { brandColor } = choices;
  if (brandColor === null) {
    return html`${chip(WAITRON_DEFAULTS.light[PRIMARY]!)}${t("appearance.brand_waitron")}`;
  }
  const value = (CATEGORY_PALETTE as readonly string[]).includes(brandColor)
    ? brandColor
    : fill("appearance.brand_custom", { colour: brandColor });
  const fixes = MODES.flatMap((mode: Mode) => {
    const shade = choices.brandFix[mode] ? view?.[mode]?.[PRIMARY] : undefined;
    return shade === undefined
      ? []
      : [html` · ${t(`appearance.saved_fix_${mode}`)} ${chip(shade)}${shade}`];
  });
  return html`${chip(brandColor)}${value}${fixes}`;
}

function handRow(choices: ThemeChoices): string {
  const names = MODES.flatMap((mode: Mode) =>
    THEME_COLOURS.filter((key) => choices.handSet[mode][key] !== undefined).map((key) =>
      fill("appearance.hand_item", {
        name: themeColourName(key),
        mode: t(`appearance.mode.${mode}`),
      }),
    ),
  );
  return names.length === 0 ? t("appearance.none") : names.join(", ");
}

@customElement("dashboard-look-card")
export class LookCard extends LitElement {
  static override styles = [
    baseStyles,
    settingsCardStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .chip {
        display: inline-block;
        vertical-align: middle;
        width: var(--wt-space-4);
        height: var(--wt-space-4);
        margin-inline-end: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
      }
      .chip:not(:first-child) {
        margin-inline-start: var(--wt-space-1);
      }
      .warning {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin: var(--wt-space-3) 0 0;
        color: var(--wt-color-warning);
      }
      .note {
        margin: var(--wt-space-4) 0 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) list: ThemeList | undefined;
  @property({ attribute: false }) canEdit = false;

  override render() {
    const list = this.list;
    if (list === undefined) return nothing;
    const view =
      list.inUse === null ? undefined : list.themes.find((theme) => theme.id === list.inUse);
    const choices = view?.choices ?? WAITRON_CHOICES;
    const warnings = view?.warnings ?? [];
    return settingsCard({
      id: "look-card",
      heading: t("appearance.look"),
      editing: false,
      action:
        view && this.canEdit
          ? html`<wt-button data-test="edit">${t("action.edit")}</wt-button>`
          : nothing,
      body: html`${settingsRows([
          {
            label: t("appearance.theme_in_use"),
            value: view?.name ?? BUILT_IN_THEME_NAME,
            dataTest: "saved-theme",
          },
          {
            label: t("appearance.brand"),
            value: brandRow(view, choices),
            dataTest: "saved-brand",
          },
          {
            label: t("appearance.background"),
            value: t(`appearance.background.${choices.background}`),
            dataTest: "saved-background",
          },
          {
            label: t("appearance.corners"),
            value: t(`appearance.corners.${choices.corners}`),
            dataTest: "saved-corners",
          },
          {
            label: t("appearance.colours_by_hand"),
            value: handRow(choices),
            dataTest: "saved-hand",
          },
        ])}
        ${warnings.map(
          (warning) =>
            html`<p class="warning" data-test="saved-warning">
              <wt-icon name="warning"></wt-icon><span>${savedWarningLine(warning)}</span>
            </p>`,
        )}
        <p class="note" data-test="look-note">${t("appearance.note")}</p>`,
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-look-card": LookCard;
  }
}
