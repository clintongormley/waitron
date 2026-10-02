import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { fieldLabel, fieldLabelState, fieldStyles } from "@waitron/ui-core/field-styles";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";
import "./wt-icon.js";

/**
 * A whole-number field with − and + buttons. `value` is text, and typing emits exactly what
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

      .control {
        display: grid;
        grid-template-columns: minmax(var(--wt-stepper-field-width), max-content);
      }

      .field {
        align-self: baseline;
        display: grid;
        grid-template-columns: minmax(var(--wt-tap-min), 1fr) repeat(2, var(--wt-tap-min));
        align-items: stretch;
      }

      /* The hidden label copy reserves its full resting width while the visible label floats. */
      .field::before {
        content: attr(data-label-text);
        order: 1;
        grid-column: 1 / -1;
        grid-row: 1;
        height: 0;
        overflow: hidden;
        visibility: hidden;
        padding-inline-start: var(--wt-space-2);
        padding-inline-end: calc(2 * var(--wt-tap-min) + var(--wt-space-2));
      }

      .field[data-label-required]::before {
        content: attr(data-label-text) "*";
        padding-inline-end: calc(2 * var(--wt-tap-min) + var(--wt-space-2) + var(--wt-space-1));
      }

      .field-label {
        inset-inline-start: var(--wt-space-2);
        inset-inline-end: calc(2 * var(--wt-tap-min) + var(--wt-space-2));
      }

      .field-control {
        grid-column: 1;
        grid-row: 1;
        width: 0;
        min-width: 100%;
        box-sizing: border-box;
        padding-inline: var(--wt-space-2);
        text-align: start;
      }

      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        height: 100%;
        padding: 0;
        border: 0;
        border-inline-start: 1px solid var(--wt-color-surface);
        background: var(--wt-color-stepper-button);
        color: var(--wt-color-primary);
        font: inherit;
        cursor: pointer;
      }

      button[data-step="-1"] {
        grid-column: 2;
        grid-row: 1;
      }

      button[data-step="1"] {
        grid-column: 3;
        grid-row: 1;
        border-start-end-radius: var(--wt-radius-md);
      }

      button:not(:disabled):hover {
        background: var(--wt-color-stepper-button-hover);
      }

      button:disabled wt-icon {
        opacity: var(--wt-opacity-disabled);
      }

      button:disabled {
        cursor: not-allowed;
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
          <button
            type="button"
            data-step="-1"
            aria-label=${this.decreaseLabel(this.label)}
            ?disabled=${this.disabled || atMin}
            @click=${(event: Event) => this.step(-1, event)}
          >
            <wt-icon name="minus"></wt-icon>
          </button>
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
