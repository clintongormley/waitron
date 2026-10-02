import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { fieldLabel, fieldLabelState, fieldStyles } from "@waitron/ui-core/field-styles";
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
    fieldStyles,
    css`
      :host {
        display: inline-grid;
        max-width: var(--wt-field-max-width);
      }

      /* The box's column runs from the width token up to what its label needs, so a long label
         widens the box and a row too narrow for it narrows the box again, cutting the label. */
      .control {
        display: grid;
        grid-template-columns: auto minmax(var(--wt-stepper-field-width), max-content) auto;
        justify-content: start;
        align-items: center;
        gap: var(--wt-space-1);
      }

      /* The only item aligned by baseline, so the element's baseline is the number's — a row
         aligned by baseline lines the text up — while the buttons centre on the box. */
      .field {
        align-self: baseline;
        display: grid;
      }

      /* An invisible copy of the label, at the size the resting label inherits (larger than the
         floated label), is what widens the box: the label itself is positioned over the box and
         takes no room. Ordered after the number so the number stays the box's baseline. Hidden,
         not only clipped: Chromium puts generated text clipped to nothing in the accessibility
         tree all the same. */
      .field::before {
        content: attr(data-label-text);
        order: 1;
        height: 0;
        overflow: hidden;
        visibility: hidden;
        padding-inline: var(--wt-space-2);
      }

      .field[data-label-required]::before {
        content: attr(data-label-text) "*";
        padding-inline-end: calc(var(--wt-space-2) + var(--wt-space-1));
      }

      .field-label {
        inset-inline: var(--wt-space-2);
      }

      .field-control {
        width: var(--wt-stepper-field-width);
        min-width: 100%;
        padding-inline: var(--wt-space-2);
        text-align: center;
      }

      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        padding: 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
      }

      button:disabled {
        ${disabledStyles}
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
  /** Each is given `label`, naming the button after its field. */
  @property({ attribute: false }) decreaseLabel: (label: string) => string = (label) =>
    `Decrease ${label}`;
  @property({ attribute: false }) increaseLabel: (label: string) => string = (label) =>
    `Increase ${label}`;

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
    // Stopped here as well as in dispatchWtChange: a press that changes nothing emits nothing, and
    // its click must not reach a click handler outside either.
    event.stopPropagation();
    const current = this.current();
    if (current === null && delta === -1) return;
    const max = this.max ?? Number.POSITIVE_INFINITY;
    const next =
      current === null
        ? Math.min(Math.max(this.min, 1), max)
        : Math.min(Math.max(current + delta, this.min), max);
    if (next === current) return;
    this.value = String(next);
    dispatchWtChange(this, event, { value: this.value });
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
    const invalid = this.invalid || hasError;
    return html`
      <div class="control">
        <button
          type="button"
          data-step="-1"
          aria-label=${this.decreaseLabel(this.label)}
          ?disabled=${this.disabled || atMin}
          @click=${(event: Event) => this.step(-1, event)}
        >
          <wt-icon name="minus"></wt-icon>
        </button>
        <div
          class="field"
          part="field"
          data-label=${fieldLabelState({
            value: this.value,
            hint: this.hint,
            placeholder: this.placeholder,
          })}
          ?data-invalid=${invalid}
          ?data-disabled=${this.disabled}
          ?data-compact=${!showLabel}
          data-label-text=${showLabel ? this.label : nothing}
          ?data-label-required=${showLabel && this.required}
        >
          ${showLabel ? fieldLabel(inputId, this.label, this.required) : nothing}
          <input
            class="field-control"
            id=${inputId}
            name=${this.name || nothing}
            .value=${this.value}
            inputmode="numeric"
            placeholder=${this.placeholder || this.hint || nothing}
            ?required=${this.required}
            ?disabled=${this.disabled}
            aria-label=${this.hideLabel && this.label ? this.label : nothing}
            aria-invalid=${invalid}
            aria-describedby=${describedBy.length ? describedBy.join(" ") : nothing}
            @input=${this.onInput}
          />
        </div>
        <button
          type="button"
          data-step="1"
          aria-label=${this.increaseLabel(this.label)}
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
