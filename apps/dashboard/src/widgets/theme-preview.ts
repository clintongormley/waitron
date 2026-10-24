import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { formatMoney } from "@waitron/shared";
import { ContentLanguageController, applyTokens, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-venue-logo.js";
import { liveMediaImage } from "@waitron/ui/src/live-media-image.js";
import { WAITRON_LOCKUP_DARK_URL, WAITRON_LOCKUP_URL } from "@waitron/ui/src/waitron-lockup.js";
import {
  MODES,
  themeSheet,
  type DerivedTheme,
  type Mode,
  type ThemeLogo,
} from "@waitron/ui-core/theme";
import { currentLocale, t } from "../i18n/t.js";
import { previewProductName } from "./theme-words.js";

/**
 * A picture of a theme draft: one panel per mode, each a theme root of its own, painted from a
 * sheet adopted into this shadow root only, so neither the page's theme reaches the panels nor
 * the draft the page.
 */
@customElement("dashboard-theme-preview")
export class ThemePreview extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        container-type: inline-size;
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
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wt-space-4);
      }
      /* A panel's content needs about 280px; this leaves room for larger fonts. */
      @container (min-width: 640px) {
        .panels {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
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
      /* The side menu stays beside the body while the body's narrowest content fits, and goes
         above it otherwise, whatever the language's word lengths; on its own line it takes the
         width, beside the body the body takes it. */
      .panel {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        padding: var(--wt-space-3);
        background: var(--wt-color-bg);
        color: var(--wt-color-text);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-lg);
        font-family: var(--wt-font-family);
        font-size: var(--wt-font-size-md);
      }
      .strip {
        display: flex;
        flex: 1 1 100%;
        align-items: center;
        gap: var(--wt-space-3);
        min-width: 0;
        margin-inline: calc(-1 * var(--wt-space-3));
        padding: 0 var(--wt-space-3) var(--wt-space-3);
        border-bottom: 1px solid var(--wt-color-border);
      }
      .lockup {
        display: block;
        flex: none;
        height: var(--wt-space-6);
      }
      .legal-name {
        min-width: 0;
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }
      .nav {
        display: flex;
        flex: 1 1 auto;
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
        flex: 1000 1 0;
        flex-direction: column;
        gap: var(--wt-space-3);
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
        contain: inline-size;
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
      .till {
        display: flex;
        flex: 1 1 100%;
        flex-direction: column;
        gap: var(--wt-space-3);
        min-width: 0;
      }
      /* A counter till's narrowest tile (HOME_GRID_COLUMNS). */
      .tile {
        display: flex;
        flex-direction: column;
        align-items: center;
        box-sizing: border-box;
        width: calc(var(--wt-tap-min) * 2 + var(--wt-space-4));
        padding: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        text-align: center;
        overflow-wrap: break-word;
      }
      .tile > * {
        max-width: 100%;
      }
      .tile-name {
        font-weight: var(--wt-font-weight-bold);
        hyphens: auto;
      }
      .tile-price {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .bill-line {
        display: flex;
        align-items: baseline;
        gap: var(--wt-space-3);
        min-width: 0;
      }
      .bill-name {
        flex: 1;
        min-width: 0;
        hyphens: auto;
        overflow-wrap: break-word;
      }
    `,
  ];

  @property({ attribute: false }) theme!: Pick<DerivedTheme, "light" | "dark">;
  @property({ attribute: false }) name = "";
  @property({ attribute: false }) logo: ThemeLogo | null = null;
  @property({ attribute: false }) legalName = "";

  readonly #draft = new CSSStyleSheet();

  constructor() {
    super();
    new ContentLanguageController(this);
  }

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

  #logo(mode: Mode) {
    const logo = this.logo;
    if (logo === null) {
      const src = mode === "dark" ? WAITRON_LOCKUP_DARK_URL : WAITRON_LOCKUP_URL;
      return html`<img class="lockup" src=${src} alt="" />`;
    }
    return html`<wt-venue-logo
      size="bar"
      light=${liveMediaImage(logo.light, "display")}
      dark=${logo.dark ? liveMediaImage(logo.dark, "display") : nothing}
    ></wt-venue-logo>`;
  }

  #till() {
    const product = previewProductName();
    const locale = currentLocale();
    return html`<div class="till">
      <div class="tile" data-test="preview-tile">
        <span class="tile-name" lang=${product.lang}>${product.text}</span>
        <span class="tile-price">${formatMoney("2.20", locale)}</span>
      </div>
      <div class="bill-line" data-test="preview-bill-line">
        <span class="bill-name" lang=${product.lang}>${product.text}</span>
        <span>2</span>
        <span>${formatMoney("4.40", locale)}</span>
      </div>
    </div>`;
  }

  #panel(mode: Mode) {
    return html`<figure data-mode=${mode}>
      <h4>${t(`appearance.preview_${mode}`)}</h4>
      <div class="panel" data-theme=${mode} aria-hidden="true">
        <div class="strip">
          ${this.#logo(mode)}<span class="legal-name">${this.legalName}</span>
        </div>
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
        ${this.#till()}
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
