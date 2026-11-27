import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange } from "../interactive.js";
import "./wt-icon.js";

/**
 * A count with − and + buttons and nothing to type. The buttons draw the `minus` and `plus` icons,
 * which the consuming app registers.
 */
@customElement("wt-stepper")
export class WtStepper extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
        vertical-align: middle;
      }

      .stepper {
        display: inline-flex;
        flex: none;
        align-items: stretch;
        box-sizing: border-box;
        height: var(--wt-tap-min);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background-color: var(--wt-color-surface);
      }

      button {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: var(--wt-tap-min);
        /* Over the box's border lines, so each button is a whole tap target while the box stays
           --wt-tap-min tall outside its border. */
        height: var(--wt-tap-min);
        margin-block: -1px;
        padding: 0;
        border: 0;
        border-radius: var(--wt-radius-md);
        background-color: transparent;
        font: inherit;
        cursor: pointer;
      }

      /* wt-icon's own styles set its colour, so the button's colour would not reach it. */
      button[data-step="-1"] wt-icon {
        color: var(--wt-color-text);
      }

      button[data-step="1"] wt-icon {
        color: var(--wt-color-primary);
      }

      button:disabled {
        cursor: not-allowed;
      }

      button:disabled wt-icon {
        opacity: var(--wt-opacity-disabled);
      }

      .count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: var(--wt-space-6);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max: number | null = null;
  @property() label = "";
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** Each is given `label`, naming the button after what it counts. */
  @property({ attribute: false }) decreaseLabel: (label: string) => string = (label) =>
    `Decrease ${label}`;
  @property({ attribute: false }) increaseLabel: (label: string) => string = (label) =>
    `Increase ${label}`;

  get #atMin(): boolean {
    return this.value <= this.min;
  }

  get #atMax(): boolean {
    return this.max !== null && this.value >= this.max;
  }

  // The buttons' disabled state is drawn a render late, so a click can still reach a refused step.
  private step(delta: -1 | 1, event: Event): void {
    if (this.disabled || (delta < 0 ? this.#atMin : this.#atMax)) {
      event.stopPropagation();
      return;
    }
    const next = this.value + delta;
    this.value = next;
    dispatchWtChange(this, event, { value: next });
  }

  override render() {
    const atMin = this.#atMin;
    const atMax = this.#atMax;
    return html`
      <div class="stepper" part="stepper" role="group" aria-label=${this.label}>
        <button
          type="button"
          data-step="-1"
          aria-label=${this.decreaseLabel(this.label)}
          ?disabled=${this.disabled || atMin}
          @click=${(event: Event) => this.step(-1, event)}
        >
          <wt-icon name="minus" size="lg"></wt-icon>
        </button>
        <span class="count" aria-live="polite">${this.value}</span>
        <button
          type="button"
          data-step="1"
          aria-label=${this.increaseLabel(this.label)}
          ?disabled=${this.disabled || atMax}
          @click=${(event: Event) => this.step(1, event)}
        >
          <wt-icon name="plus" size="lg"></wt-icon>
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-stepper": WtStepper;
  }
}
