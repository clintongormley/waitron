import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";

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
      [part="value"] {
        font-weight: var(--wt-font-weight-bold);
        font-variant-numeric: tabular-nums;
      }
      input {
        width: 100%;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        margin: 0;
        accent-color: var(--wt-color-primary);
      }
      input:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      :host([disabled]) {
        opacity: var(--wt-opacity-disabled);
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
  @property() error = "";
  /** The number under the latest drag, until a release or a new `value` replaces it. A drag that
   * ends where it began sends no `change`, so a release alone cannot be relied on to clear it. */
  @state() private shown: number | null = null;

  readonly #id = uniqueId("wt-slider");

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("value")) this.shown = null;
  }

  #onInput(event: Event): void {
    event.stopPropagation();
    this.shown = Number((event.target as HTMLInputElement).value);
  }

  #onChange(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.value = value;
    dispatchWtChange(this, event, { value });
  }

  override render() {
    const errorId = `${this.#id}-error`;
    return html`<div class="row">
        <label for=${this.#id} part="label">${this.label}</label>
        <span part="value" aria-hidden="true">${this.shown ?? this.value}</span>
      </div>
      <input
        id=${this.#id}
        type="range"
        name=${this.name || nothing}
        .min=${String(this.min)}
        .max=${String(this.max)}
        .step=${String(this.step)}
        .value=${String(this.value)}
        ?disabled=${this.disabled}
        aria-invalid=${this.error ? "true" : nothing}
        aria-describedby=${this.error ? errorId : nothing}
        @input=${this.#onInput}
        @change=${this.#onChange}
      />
      ${this.error ? html`<p class="error" id=${errorId} role="alert">${this.error}</p>` : nothing}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-slider": WtSlider;
  }
}
