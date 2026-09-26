import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, disabledStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";
import "./wt-icon.js";

/**
 * A whole-number field between a − and a + button. `value` is text, and typing emits exactly what
 * was typed — never a clamped number — so the form's own validation sees a typed 0, a blank or a
 * non-number. The buttons draw the `minus` and `plus` icons, which the consuming app registers.
 */
@customElement("wt-number-stepper")
export class WtNumberStepper extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-grid;
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
        display: grid;
        grid-template-columns: auto auto auto;
        justify-content: start;
      }

      input,
      button {
        min-height: var(--wt-tap-min);
        border: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
      }

      /* The only item aligned by baseline, so the element's baseline is the number's — a row
         aligned by baseline lines the text up — while the buttons stretch level with the box. */
      input {
        align-self: baseline;
        width: var(--wt-stepper-field-width);
        min-width: var(--wt-tap-min);
        padding: var(--wt-space-2);
        border-inline-width: 0;
        text-align: center;
      }

      input::placeholder {
        color: var(--wt-color-text-muted);
      }

      input[aria-invalid="true"] {
        border-color: var(--wt-color-danger);
        border-inline-width: 1px;
      }

      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: var(--wt-tap-min);
        padding: 0;
        cursor: pointer;
      }

      button[data-step="-1"] {
        border-start-start-radius: var(--wt-radius-md);
        border-end-start-radius: var(--wt-radius-md);
      }

      button[data-step="1"] {
        border-start-end-radius: var(--wt-radius-md);
        border-end-end-radius: var(--wt-radius-md);
      }

      input:disabled,
      button:disabled {
        ${disabledStyles}
      }

      .required,
      .error {
        color: var(--wt-color-danger);
      }

      .required {
        margin-inline-start: var(--wt-space-1);
      }

      .error,
      .hint {
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
      }

      .hint {
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property() value = "";
  @property() label = "";
  @property() name = "";
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max: number | null = null;
  @property() placeholder = "";
  @property() error = "";
  @property() hint = "";
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) invalid = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, attribute: "hide-label" }) hideLabel = false;
  /** `{label}` is replaced with `label`, naming the button after its field. */
  @property() decreaseLabel = "Decrease {label}";
  @property() increaseLabel = "Increase {label}";

  private readonly generatedInputId = uniqueId("wt-number-stepper");
  private readonly errorId = uniqueId("wt-number-stepper-error");
  private readonly hintId = uniqueId("wt-number-stepper-hint");

  /** With delegation alone the host would focus the - button, the first control in the tree. */
  override focus(options?: FocusOptions): void {
    this.shadowRoot?.querySelector("input")?.focus(options);
  }

  private current(): number | null {
    const n = Number(this.value);
    return this.value.trim() === "" || !Number.isInteger(n) ? null : n;
  }

  private step(delta: -1 | 1, event: Event): void {
    event.stopPropagation();
    const current = this.current();
    let next: number;
    if (current === null) {
      if (delta === -1) return;
      next = Math.max(this.min, 1);
    } else {
      next = Math.min(Math.max(current + delta, this.min), this.max ?? Number.POSITIVE_INFINITY);
    }
    this.value = String(next);
    this.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onInput(event: Event): void {
    this.value = (event.target as HTMLInputElement).value;
    dispatchWtChange(this, event, { value: this.value });
  }

  override render() {
    const current = this.current();
    const hasError = this.error !== "";
    const hasHint = this.hint !== "";
    const describedBy = [...(hasHint ? [this.hintId] : []), ...(hasError ? [this.errorId] : [])];
    const inputId = this.name || this.generatedInputId;
    const atMin = current === null || current <= this.min;
    const atMax = this.max !== null && current !== null && current >= this.max;
    const showLabel = this.label !== "" && !this.hideLabel;
    return html`
      ${
        showLabel
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
        <button
          type="button"
          data-step="-1"
          aria-label=${this.decreaseLabel.replace("{label}", this.label)}
          ?disabled=${this.disabled || atMin}
          @click=${(event: Event) => this.step(-1, event)}
        >
          <wt-icon name="minus"></wt-icon>
        </button>
        <input
          id=${inputId}
          name=${this.name || nothing}
          .value=${this.value}
          inputmode="numeric"
          placeholder=${this.placeholder || nothing}
          ?required=${this.required}
          ?disabled=${this.disabled}
          aria-label=${this.hideLabel && this.label ? this.label : nothing}
          aria-invalid=${this.invalid || hasError}
          aria-describedby=${describedBy.length ? describedBy.join(" ") : nothing}
          @input=${this.onInput}
        />
        <button
          type="button"
          data-step="1"
          aria-label=${this.increaseLabel.replace("{label}", this.label)}
          ?disabled=${this.disabled || atMax}
          @click=${(event: Event) => this.step(1, event)}
        >
          <wt-icon name="plus"></wt-icon>
        </button>
      </div>
      ${hasHint ? html`<p id=${this.hintId} class="hint" data-hint>${this.hint}</p>` : nothing}
      ${hasError ? html`<p id=${this.errorId} class="error" data-error>${this.error}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-number-stepper": WtNumberStepper;
  }
}
