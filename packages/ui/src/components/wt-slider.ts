import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";

const MAX_MARKS = 101;

/** A labelled whole-number range that shows its value. */
@customElement("wt-slider")
export class WtSlider extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        gap: var(--wt-space-1);
        max-width: var(--wt-field-max-width);
      }
      .row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }
      .range {
        display: grid;
        grid-template-columns: 1fr auto;
        column-gap: var(--wt-space-3);
      }
      .range [part="value"] {
        align-self: center;
      }
      [part="marks"] {
        position: relative;
        height: var(--wt-space-2);
      }
      [part="mark"] {
        position: absolute;
        top: 0;
        transform: translateX(-50%);
        width: var(--wt-field-line-width);
        height: var(--wt-space-2);
        background-color: var(--wt-color-text-muted);
      }
      [part="label"] {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      [part="value"] {
        font-weight: var(--wt-font-weight-bold);
        font-variant-numeric: tabular-nums;
      }
      /* Drawn from tokens, never the native track: given an accent colour, Chromium shades the
         unfilled track by that colour's lightness alone, whatever the theme. */
      input {
        appearance: none;
        width: 100%;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        margin: 0;
        background: transparent;
        --wt-slider-fill: 0;
        --wt-slider-filled-to: calc(
          var(--wt-slider-thumb-size) / 2 + var(--wt-slider-fill) *
            (100% - var(--wt-slider-thumb-size))
        );
        --wt-slider-towards: to right;
      }
      input:dir(rtl) {
        --wt-slider-towards: to left;
      }
      /* Separate rules, never one selector list: Chromium drops a whole list that names
         ::-moz-range-track. */
      input::-webkit-slider-runnable-track {
        height: var(--wt-space-1);
        border-radius: var(--wt-radius-full);
        background: linear-gradient(
          var(--wt-slider-towards),
          var(--wt-color-primary) var(--wt-slider-filled-to),
          var(--wt-color-track) var(--wt-slider-filled-to)
        );
      }
      input::-moz-range-track {
        height: var(--wt-space-1);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-track);
      }
      input::-moz-range-progress {
        height: var(--wt-space-1);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-primary);
      }
      input::-webkit-slider-thumb {
        appearance: none;
        width: var(--wt-slider-thumb-size);
        height: var(--wt-slider-thumb-size);
        margin-top: calc((var(--wt-space-1) - var(--wt-slider-thumb-size)) / 2);
        border: none;
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-primary);
      }
      input::-moz-range-thumb {
        width: var(--wt-slider-thumb-size);
        height: var(--wt-slider-thumb-size);
        border: none;
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-primary);
      }
      input:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      :host([disabled]) {
        opacity: var(--wt-opacity-disabled);
      }
      .hint {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .error {
        margin: 0;
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  @property() label = "";
  @property() name = "";
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 10;
  @property({ type: Number }) step = 1;
  @property({ type: Number }) value = 0;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean }) continuous = false;
  @property() error = "";
  @property() hint = "";
  /** Draws one mark per step under the range, and the value at the range's end. */
  @property({ type: Boolean }) marks = false;
  @property({ attribute: false }) format: (value: number) => string = String;
  @property({ attribute: false }) valueText: ((value: number) => string) | null = null;
  /** The number under the latest drag, until a new `value` replaces it. */
  @state() private shown: number | null = null;

  readonly #id = uniqueId("wt-slider");
  readonly #offPage = Object.assign(document.createElement("input"), { type: "range" });
  #lastContinuousInput: number | null = null;
  /** The number the thumb sits at, read by both the drawn number and the fill. */
  #onRangeValue = 0;

  /**
   * The value a range with this min, max and step holds once given `value`, clamped and snapped
   * by the browser itself, so the number shown is the one the thumb sits at.
   */
  #onRange(value: number): number {
    Object.assign(this.#offPage, {
      min: String(this.min),
      max: String(this.max),
      step: String(this.step),
      value: String(value),
    });
    return this.#offPage.valueAsNumber;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("value")) this.shown = null;
    this.#onRangeValue = this.#onRange(this.shown ?? this.value);
  }

  #onInput(event: Event): void {
    event.stopPropagation();
    this.shown = Number((event.target as HTMLInputElement).value);
    if (this.continuous) {
      this.value = this.shown;
      this.#lastContinuousInput = this.value;
      dispatchWtChange(this, event, { value: this.value });
    }
  }

  #onChange(event: Event): void {
    event.stopPropagation();
    const value = Number((event.target as HTMLInputElement).value);
    const matchingInput = this.continuous && value === this.#lastContinuousInput;
    this.#lastContinuousInput = null;
    if (matchingInput) return;
    this.value = value;
    dispatchWtChange(this, event, { value });
  }

  /**
   * Where each step sits along the thumb's travel, from 0 at `min`. None when the range has no
   * travel, the step cannot advance, or there would be more than `MAX_MARKS`.
   */
  #markFractions(): number[] {
    const span = this.max - this.min;
    if (!(span > 0)) return [];
    // A step of 0 counts to Infinity, and a negative one to no marks.
    const count = Math.floor(span / this.step) + 1;
    if (count > MAX_MARKS) return [];
    return Array.from({ length: count }, (_, i) => (i * this.step) / span);
  }

  override updated(): void {
    const input = this.renderRoot.querySelector("input")!;
    const share = (this.#onRangeValue - this.min) / (this.max - this.min);
    input.style.setProperty("--wt-slider-fill", String(share));
  }

  override render() {
    const errorId = `${this.#id}-error`;
    const hintId = `${this.#id}-hint`;
    const shown = this.#onRangeValue;
    const describedBy = [this.hint && hintId, this.error && errorId].filter(Boolean).join(" ");
    const value = html`<span part="value" aria-hidden="true">${this.format(shown)}</span>`;
    const input = html`<input
      id=${this.#id}
      type="range"
      name=${this.name || nothing}
      .min=${String(this.min)}
      .max=${String(this.max)}
      .step=${String(this.step)}
      .value=${live(String(shown))}
      ?disabled=${this.disabled}
      aria-invalid=${this.error ? "true" : nothing}
      aria-describedby=${describedBy || nothing}
      aria-valuetext=${this.valueText ? this.valueText(shown) : nothing}
      @input=${this.#onInput}
      @change=${this.#onChange}
    />`;
    const label = html`<label for=${this.#id} part="label">${this.label}</label>`;
    const control = this.marks
      ? html`<div class="row" aria-disabled=${this.disabled ? "true" : nothing}>${label}</div>
          <div class="range">
            ${input}${value}
            <div part="marks" aria-hidden="true">
              ${this.#markFractions().map(
                (at) =>
                  html`<span
                    part="mark"
                    style="left: calc(var(--wt-slider-thumb-size) / 2 + ${at} * (100% - var(--wt-slider-thumb-size)))"
                  ></span>`,
              )}
            </div>
          </div>`
      : html`<div class="row" aria-disabled=${this.disabled ? "true" : nothing}>
            ${label}${value}
          </div>
          ${input}`;
    return html`${control}
    ${this.hint ? html`<p class="hint" part="hint" id=${hintId}>${this.hint}</p>` : nothing}
    ${this.error ? html`<p class="error" id=${errorId} role="alert" data-error>${this.error}</p>` : nothing}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-slider": WtSlider;
  }
}
