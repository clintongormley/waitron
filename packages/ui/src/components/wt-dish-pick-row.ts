import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { baseStyles, disabledStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange } from "../interactive.js";
import "./wt-icon.js";

@customElement("wt-dish-pick-row")
export class WtDishPickRow extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        inline-size: 100%;
      }

      .row {
        position: relative;
        display: grid;
        grid-template-columns: auto minmax(var(--wt-space-5), auto) minmax(0, 1fr) auto;
        align-items: center;
        gap: calc(var(--wt-space-2) + var(--wt-space-1) / 2);
        min-block-size: calc(var(--wt-tap-min) + var(--wt-space-2));
        padding: calc(var(--wt-space-2) + var(--wt-space-1) / 2)
          calc(var(--wt-space-3) + var(--wt-space-1) / 2);
        border-block-end: var(--wt-field-line-width) solid var(--wt-color-border);
        background: var(--wt-color-surface);
        font-size: calc(var(--wt-font-size-md) + var(--wt-field-line-width));
        line-height: 1.35;
      }

      .row:has(#dish-quantity:empty) {
        grid-template-columns: auto minmax(0, 1fr) auto;
      }

      #dish-quantity:empty {
        display: none;
      }

      label.row {
        min-inline-size: var(--wt-tap-min);
        cursor: pointer;
      }

      input {
        position: absolute;
        inset: 0;
        inline-size: 100%;
        block-size: 100%;
        margin: 0;
        opacity: 0;
        cursor: inherit;
      }

      label:has(input:checked:not(:indeterminate)) {
        background: var(--wt-color-surface-lifted);
      }

      label:has(input:focus-visible) {
        outline: var(--wt-focus-ring);
        outline-offset: calc(-1 * var(--wt-focus-offset));
      }

      label:has(input:disabled) {
        cursor: not-allowed;
      }

      label:has(input:disabled)
        :is([part="mark"], #dish-quantity, #dish-label, #dish-description, #dish-amount) {
        ${disabledStyles}
      }

      div.row [part="mark"] {
        visibility: hidden;
      }

      [part="mark"] {
        display: grid;
        place-items: center;
        inline-size: var(--wt-space-5);
        block-size: var(--wt-space-5);
        border: var(--wt-field-line-width-active) solid var(--wt-color-field-line);
        border-radius: calc(var(--wt-radius-sm) + var(--wt-field-line-width-active));
        color: var(--wt-color-on-primary);
      }

      [part="mark"] wt-icon {
        display: none;
        color: inherit;
      }

      input:checked:not(:indeterminate) + [part="mark"] {
        border-color: var(--wt-color-primary);
        background: var(--wt-color-primary);
      }

      input:checked:not(:indeterminate) + [part="mark"] wt-icon {
        display: inline-flex;
      }

      input:indeterminate + [part="mark"] {
        border-color: var(--wt-color-primary);
        background: transparent;
      }

      input:indeterminate + [part="mark"]::before {
        content: "";
        inline-size: var(--wt-space-3);
        border-block-start: var(--wt-field-line-width-active) solid var(--wt-color-primary);
      }

      #dish-description,
      #dish-details {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: calc(var(--wt-font-size-sm) + var(--wt-field-line-width));
      }

      ::slotted([slot="details"]) {
        margin: 0;
      }

      [part="portion"] {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: calc(var(--wt-space-2) + var(--wt-space-1) / 2);
        padding: var(--wt-space-1) calc(var(--wt-space-3) + var(--wt-space-1) / 2) var(--wt-space-2)
          calc(var(--wt-space-5) * 2);
        border-block-end: var(--wt-field-line-width) solid var(--wt-color-border);
        background: var(--wt-color-surface-lifted);
        color: var(--wt-color-text-muted);
        font-size: calc(var(--wt-font-size-sm) + var(--wt-field-line-width));
      }

      .portion-amount {
        margin-inline-start: auto;
        color: var(--wt-color-text);
        font-weight: var(--wt-font-weight-bold);
        font-variant-numeric: tabular-nums;
      }

      .words {
        overflow-wrap: anywhere;
      }

      #dish-quantity,
      #dish-amount {
        font-weight: var(--wt-font-weight-bold);
        font-variant-numeric: tabular-nums;
      }

      #dish-amount {
        text-align: end;
      }

      @media (forced-colors: active) {
        input:is(:checked, :indeterminate) + [part="mark"] {
          border-color: Highlight;
          color: Highlight;
        }
        input:indeterminate + [part="mark"]::before {
          border-block-start-color: Highlight;
        }
      }
    `,
  ];

  @property() name = "";
  @property() label = "";
  @property() quantity = "";
  @property() description = "";
  @property() amount = "";
  @property({ attribute: "portion-label" }) portionLabel = "";
  @property({ attribute: "portion-amount" }) portionAmount = "";
  @property({ type: Boolean, attribute: "display-only" }) displayOnly = false;
  @property({ type: Boolean }) checked = false;
  @property({ type: Boolean }) indeterminate = false;
  @property({ type: Boolean, reflect: true }) disabled = false;

  private toggle(event: Event): void {
    const checkbox = event.currentTarget as HTMLInputElement;
    this.checked = checkbox.checked;
    this.indeterminate = false;
    dispatchWtChange(this, event, { checked: this.checked });
  }

  override render() {
    const content = html` <span part="mark" aria-hidden="true"
        ><wt-icon name="choice-check"></wt-icon
      ></span>
      <span id="dish-quantity">${this.quantity}</span>
      <span class="words">
        <span id="dish-label">${this.label}</span>
        <span id="dish-description" part="description">${this.description}</span>
        <span id="dish-details"><slot name="details"></slot></span>
      </span>
      <span id="dish-amount">${this.amount}</span>`;
    if (this.displayOnly) return html`<div class="row">${content}</div>`;
    return html` <label class="row">
        <input
          type="checkbox"
          name=${this.name}
          aria-labelledby="dish-quantity dish-label"
          aria-describedby="dish-description dish-details dish-amount"
          .checked=${live(this.checked && !this.indeterminate)}
          .indeterminate=${live(this.indeterminate)}
          ?disabled=${this.disabled}
          @input=${this.toggle}
        />
        ${content}
      </label>
      ${
        this.portionLabel
          ? html`<div part="portion">
              ${this.portionLabel}<slot name="stepper"></slot>
              <span class="portion-amount">${this.portionAmount}</span>
            </div>`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-dish-pick-row": WtDishPickRow;
  }
}
