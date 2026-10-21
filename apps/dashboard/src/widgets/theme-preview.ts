import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { applyTokens, baseStyles } from "@waitron/ui";
import { MODES, themeSheet, type DerivedTheme, type Mode } from "@waitron/ui-core/theme";
import { t } from "../i18n/t.js";

/**
 * A picture of a theme draft: one panel per mode, each a theme root of its own, painted from a
 * sheet adopted into this shadow root only, so neither the page's theme reaches the panels nor
 * the draft the page. A media query cannot read a custom property, so this repeats
 * DRAWER_BREAKPOINT's literal.
 */
@customElement("dashboard-theme-preview")
export class ThemePreview extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      h3,
      h4 {
        margin: 0;
      }
      .hint {
        margin: var(--wt-space-1) 0 var(--wt-space-3);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .panels {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--wt-space-4);
      }
      @media (max-width: 48rem) {
        .panels {
          grid-template-columns: 1fr;
        }
      }
      figure {
        margin: 0;
        min-width: 0;
      }
      h4 {
        margin-block-end: var(--wt-space-2);
        font-size: var(--wt-font-size-sm);
      }
      .panel {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--wt-space-3);
        padding: var(--wt-space-3);
        background: var(--wt-color-bg);
        color: var(--wt-color-text);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-lg);
      }
      .nav {
        display: flex;
        flex-direction: column;
      }
      .nav-item {
        padding: var(--wt-space-2) var(--wt-space-3);
        border-inline-start: 3px solid transparent;
        color: var(--wt-color-text-muted);
      }
      .nav-item.selected {
        border-inline-start-color: var(--wt-color-primary);
        color: var(--wt-color-primary-text);
        font-weight: var(--wt-font-weight-bold);
      }
      .body {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        min-width: 0;
        padding: var(--wt-space-3);
        background: var(--wt-color-surface);
        border-radius: var(--wt-radius-md);
      }
      .field {
        display: flex;
        flex-direction: column;
        padding: var(--wt-space-2) var(--wt-space-3);
        background: var(--wt-color-field-fill);
        border-start-start-radius: var(--wt-radius-md);
        border-start-end-radius: var(--wt-radius-md);
        box-shadow: inset 0 calc(-1 * var(--wt-field-line-width-active)) 0 var(--wt-color-primary);
      }
      .field-label {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-field-label-focus);
      }
      .field-value {
        color: var(--wt-color-field-value);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .save,
      .cancel {
        padding: var(--wt-space-2) var(--wt-space-4);
        border-radius: var(--wt-radius-md);
        border: 1px solid transparent;
      }
      .save {
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }
      .cancel {
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        border-color: var(--wt-color-border);
      }
      .track {
        position: relative;
        width: var(--wt-space-6);
        height: var(--wt-space-4);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-primary);
      }
      .thumb {
        position: absolute;
        inset-inline-end: 0;
        width: var(--wt-space-4);
        height: var(--wt-space-4);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-surface);
        box-shadow: var(--wt-shadow-1);
      }
      .link {
        color: var(--wt-color-primary-text);
        text-decoration: underline;
      }
      .segments {
        display: inline-flex;
      }
      .segment {
        padding: var(--wt-space-1) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }
      .segment + .segment {
        border-inline-start-width: 0;
      }
      .segment:first-child {
        border-start-start-radius: var(--wt-radius-md);
        border-end-start-radius: var(--wt-radius-md);
      }
      .segment:last-child {
        border-start-end-radius: var(--wt-radius-md);
        border-end-end-radius: var(--wt-radius-md);
      }
      .segment.chosen {
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }
    `,
  ];

  @property({ attribute: false }) theme!: Pick<DerivedTheme, "light" | "dark">;
  @property({ attribute: false }) name = "";

  readonly #draft = new CSSStyleSheet();

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("theme")) this.#draft.replaceSync(themeSheet(this.theme));
  }

  override firstUpdated(): void {
    for (const panel of this.renderRoot.querySelectorAll<HTMLElement>(".panel")) {
      applyTokens(panel);
    }
    const root = this.renderRoot as ShadowRoot;
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, this.#draft];
  }

  #panel(mode: Mode) {
    return html`<figure data-mode=${mode}>
      <h4>${t(`appearance.preview_${mode}`)}</h4>
      <div class="panel" data-theme=${mode} aria-hidden="true">
        <div class="nav">
          <span class="nav-item selected">${t("nav.appearance")}</span>
          <span class="nav-item">${t("nav.devices")}</span>
        </div>
        <div class="body">
          <div class="field">
            <span class="field-label">${t("venue_details.name")}</span>
            <span class="field-value">${this.name}</span>
          </div>
          <div class="row">
            <span class="save">${t("action.save")}</span>
            <span class="cancel">${t("action.cancel")}</span>
          </div>
          <div class="row">
            <span class="track"><span class="thumb"></span></span>
            <span class="link">${t("help.guide_link")}</span>
          </div>
          <div class="segments">
            <span class="segment chosen">${t("theme.light")}</span>
            <span class="segment">${t("theme.dark")}</span>
          </div>
        </div>
      </div>
    </figure>`;
  }

  override render() {
    return html`<h3>${t("appearance.preview")}</h3>
      <p class="hint">${t("appearance.preview_hint")}</p>
      <div class="panels">${MODES.map((mode: Mode) => this.#panel(mode))}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-theme-preview": ThemePreview;
  }
}
