import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, disabledStyles } from "../base-styles.js";
import "./wt-icon.js";

@customElement("wt-choice-tile")
export class WtChoiceTile extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      button {
        --wt-choice-border-width: var(--wt-field-line-width);
        --wt-choice-border: var(--wt-color-border);
        display: flex;
        align-items: center;
        gap: calc(var(--wt-space-2) + var(--wt-space-1) / 2);
        inline-size: 100%;
        min-block-size: calc(var(--wt-tap-min) + var(--wt-space-3));
        padding-inline: calc(
          var(--wt-space-4) - var(--wt-choice-border-width) - var(--wt-field-line-width)
        );
        border: var(--wt-choice-border-width) solid var(--wt-choice-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        font-size: var(--wt-font-size-lg);
        text-align: start;
        cursor: pointer;
      }

      button[aria-pressed="true"] {
        --wt-choice-border-width: var(--wt-field-line-width-active);
        --wt-choice-border: var(--wt-color-primary);
        background: var(--wt-color-surface-lifted);
      }

      button:disabled {
        ${disabledStyles}
      }

      :host([check-position="start"]) button {
        border-radius: calc(var(--wt-radius-md) + var(--wt-field-line-width-active));
      }

      [part="label"] {
        flex: 1;
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }

      [part="hint"] {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-md);
        text-align: end;
      }

      [part="check"] {
        display: grid;
        place-items: center;
        inline-size: var(--wt-font-size-xl);
        flex: none;
        color: var(--wt-color-primary-text);
      }

      wt-icon {
        color: inherit;
      }
    `,
  ];

  @property() label = "";
  @property() hint = "";
  @property({ type: Boolean }) selected = false;
  @property({ type: Boolean }) disabled = false;
  @property({ attribute: "check-position", reflect: true }) checkPosition: "start" | "end" = "end";

  override render() {
    const check = html`<span part="check" aria-hidden="true"
      >${this.selected ? html`<wt-icon name="check" size="md"></wt-icon>` : nothing}</span
    >`;
    return html`<button
      type="button"
      ?disabled=${this.disabled}
      aria-pressed=${String(this.selected)}
    >
      ${this.checkPosition === "start" ? check : nothing}
      <span part="label">${this.label}</span>
      ${this.hint === "" ? nothing : html`<span part="hint">${this.hint}</span>`}
      ${this.checkPosition === "start" ? nothing : check}
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-choice-tile": WtChoiceTile;
  }
}
