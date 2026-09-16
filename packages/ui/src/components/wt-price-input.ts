import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";

/**
 * A money field with a trailing button that shows the pricing unit ("each", "kg", …). The product
 * editor uses one per variant/product price: typing emits `wt-change` with the raw string value,
 * and pressing the unit button emits `wt-unit-click` for the consumer to open its unit picker.
 *
 * The unit button's visible text IS its accessible name, so a consumer must supply `unit`; an empty
 * unit leaves the button nameless.
 */
@customElement("wt-price-input")
export class WtPriceInput extends LitElement {
  // Delegates .focus() on the host to the inner <input> — the product editor focuses the price
  // field directly when a variant row opens.
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .label-row {
        display: flex;
        align-items: center;
        margin-bottom: var(--wt-space-1);
      }

      label {
        display: block;
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }

      .control {
        display: flex;
      }

      input {
        flex: 1;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        /* The field and the unit button read as one control: the field rounds only its leading
           corners and drops the seam border the button supplies. */
        border-inline-end: 0;
        border-start-start-radius: var(--wt-radius-md);
        border-end-start-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
      }

      input[aria-invalid="true"] {
        border-color: var(--wt-color-danger);
      }

      .unit {
        flex: none;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-start-end-radius: var(--wt-radius-md);
        border-end-end-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
      }

      .required,
      .error {
        color: var(--wt-color-danger);
      }

      .required {
        margin-inline-start: var(--wt-space-1);
      }

      .error {
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  @property() value = "";
  @property() label = "";
  @property() name = "";
  @property() unit = "";
  @property() error = "";
  @property({ type: Boolean, reflect: true }) required = false;

  // A named field uses its semantic name for both the input's id and name; an unnamed one falls
  // back to a per-instance id so its label association never collides with another field's.
  private readonly generatedInputId = uniqueId("wt-price-input");
  private readonly errorId = uniqueId("wt-price-input-error");

  private onInput(event: Event): void {
    this.value = (event.target as HTMLInputElement).value;
    dispatchWtChange(this, event, { value: this.value });
  }

  private onUnitClick(event: Event): void {
    // Stop the native click before re-emitting, or a consumer listening across the shadow boundary
    // observes the change twice (see the design system's event-discipline rule).
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("wt-unit-click", { detail: {}, bubbles: true, composed: true }),
    );
  }

  override render() {
    const hasError = this.error !== "";
    const inputId = this.name || this.generatedInputId;
    return html`
      ${
        this.label
          ? html`<div class="label-row">
              <label for=${inputId}
                >${this.label}${
                  this.required
                    ? html`<span class="required" data-required aria-hidden="true">*</span>`
                    : nothing
                }</label
              >
            </div>`
          : nothing
      }
      <div class="control">
        <input
          id=${inputId}
          name=${this.name || nothing}
          .value=${this.value}
          inputmode="decimal"
          ?required=${this.required}
          aria-invalid=${hasError}
          aria-describedby=${hasError ? this.errorId : nothing}
          @input=${this.onInput}
        />
        <button type="button" class="unit" @click=${this.onUnitClick}>${this.unit}</button>
      </div>
      ${hasError ? html`<p id=${this.errorId} class="error" data-error>${this.error}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-price-input": WtPriceInput;
  }
}
