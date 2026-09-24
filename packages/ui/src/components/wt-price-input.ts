import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, disabledStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";

/** The unit button's visible text is its accessible name, so an empty `unit` leaves it nameless. */
@customElement("wt-price-input")
export class WtPriceInput extends LitElement {
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

      input::placeholder {
        color: var(--wt-color-text-muted);
      }

      input:disabled {
        ${disabledStyles}
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

      .unit:disabled {
        ${disabledStyles}
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
  @property() placeholder = "";
  @property() error = "";
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) disabled = false;

  private readonly generatedInputId = uniqueId("wt-price-input");
  private readonly errorId = uniqueId("wt-price-input-error");

  private onInput(event: Event): void {
    this.value = (event.target as HTMLInputElement).value;
    dispatchWtChange(this, event, { value: this.value });
  }

  private onUnitClick(event: Event): void {
    // Stop the native click before re-emitting, or a consumer across the shadow boundary sees two.
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
          placeholder=${this.placeholder || nothing}
          ?required=${this.required}
          ?disabled=${this.disabled}
          aria-invalid=${hasError}
          aria-describedby=${hasError ? this.errorId : nothing}
          @input=${this.onInput}
        />
        <button type="button" class="unit" ?disabled=${this.disabled} @click=${this.onUnitClick}>
          ${this.unit}
        </button>
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
