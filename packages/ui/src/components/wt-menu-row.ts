import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, disabledStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions } from "../interactive.js";
import "./wt-help-tooltip.js";
import "./wt-icon.js";

@customElement("wt-menu-row")
export class WtMenuRow extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;
  static override styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        width: 100%;
      }

      :host([divider]) {
        border-block-end: var(--wt-field-line-width) solid var(--wt-color-border);
      }

      .row {
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        gap: var(--wt-space-2);
        min-width: var(--wt-tap-min);
        min-height: max(var(--wt-tap-min), var(--wt-menu-row-height));
        padding-block: 0;
        padding-inline: var(--wt-menu-row-padding-start) var(--wt-space-4);
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: var(--wt-menu-row-label-size);
        font-weight: var(--wt-font-weight-normal);
        text-align: start;
      }
      :host([divider]) .row {
        min-height: max(var(--wt-tap-min), var(--wt-menu-row-height) - var(--wt-field-line-width));
      }
      button.row:not(:disabled) {
        cursor: pointer;
      }
      button.row:not(:disabled):is(:hover, :active) {
        background: var(--wt-color-field-fill);
      }
      button.row:disabled {
        ${disabledStyles}
      }
      button.row:focus-visible {
        outline-offset: calc(-1 * var(--wt-focus-offset));
      }
      .label {
        flex: 1 1 auto;
      }
      .trailing {
        display: flex;
        align-items: center;
        gap: var(--wt-menu-row-value-gap);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-md);
      }
      .trailing wt-icon {
        color: inherit;
        flex: none;
      }
      .trailing wt-icon[name="check"] {
        color: var(--wt-color-primary);
      }
      .row ::slotted(*) {
        flex: none;
      }

      ::slotted(*) {
        flex: 1 1 auto;
        min-width: 0;
      }

      /* Beats the badge's own :host rules, which hang it over a corner at a smaller size. */
      wt-help-tooltip[data-help-on] {
        position: static;
        margin: 0;
        flex: none;
        --wt-help-badge-target: var(--wt-tap-min);
      }

      @media (forced-colors: active) {
        :host([divider]) {
          border-block-end-color: CanvasText;
        }
        button.row:focus-visible {
          outline-color: Highlight;
        }
      }
    `,
  ];

  /** The help box's text; empty draws no badge. */
  @property() help = "";
  /** The badge's accessible name, whole. */
  @property({ attribute: "help-label" }) helpLabel = "";

  @property({ attribute: "guide-href" }) guideHref = "";
  @property({ attribute: "guide-label" }) guideLabel = "";

  @property({ type: Boolean, reflect: true }) action = false;
  @property() label = "";
  @property() value: string | number = "";
  @property({ type: Boolean }) chevron = false;
  @property({ type: Boolean }) check = false;
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean, reflect: true }) divider = false;

  private renderRow() {
    const label = html`<span class="label">${this.label}</span>`;
    const trailing =
      this.value !== "" || this.chevron || this.check
        ? html`<span class="trailing">
            ${this.value === "" ? nothing : html`<span class="value">${this.value}</span>`}
            ${this.chevron ? html`<wt-icon name="chevron-right" size="lg"></wt-icon>` : nothing}
            ${this.check ? html`<wt-icon name="check" size="lg"></wt-icon>` : nothing}
          </span>`
        : nothing;
    if (this.action)
      return html`<button type="button" class="row" ?disabled=${this.disabled}>
        ${label}${trailing}
      </button>`;
    return this.label
      ? html`<div class="row">${label}${trailing}<slot></slot></div>`
      : html`<slot></slot>`;
  }

  override render() {
    return html`${this.renderRow()}${
      this.help
        ? html`<wt-help-tooltip
            mode="help-mode"
            data-keep-open
            aria-label=${this.helpLabel}
            guide-href=${this.guideHref}
            guide-label=${this.guideLabel}
            >${this.help}</wt-help-tooltip
          >`
        : nothing
    }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-menu-row": WtMenuRow;
  }
}
