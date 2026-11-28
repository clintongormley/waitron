import { LitElement, type PropertyValues, css, html, nothing, svg } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange } from "../interactive.js";
import "./wt-icon.js";

/** Bars `length` long and 2.5 thick in a square of that side, crossed for +. */
const mark = (plus: boolean, length: number) => {
  const offset = (length - 2.5) / 2;
  return html`<svg
    class="mark"
    data-mark
    viewBox="0 0 ${length} ${length}"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="0" y=${offset} width=${length} height="2.5"></rect>
    ${plus ? svg`<rect x=${offset} y="0" width="2.5" height=${length}></rect>` : nothing}
  </svg>`;
};

/** A count with − and + buttons and nothing to type. Given `removeLabel`, − is a bin at `min` that
 * sends `wt-remove` instead of stepping. */
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

      /* Drawn here rather than with wt-icon, whose shapes are thinner than the till's bold − and +. */
      .mark {
        width: calc(var(--wt-space-1) * 2.5);
        height: calc(var(--wt-space-1) * 2.5);
        fill: currentColor;
      }

      button[data-step="-1"] .mark,
      button[data-remove] wt-icon {
        color: var(--wt-color-text);
      }

      button[data-step="1"] .mark {
        color: var(--wt-color-primary);
      }

      button:disabled {
        cursor: not-allowed;
      }

      button:disabled .mark,
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

      :host([variant="portion"]) {
        align-items: center;
        min-block-size: var(--wt-tap-min);
      }

      .stepper.portion {
        align-items: center;
        height: calc(var(--wt-space-6) + var(--wt-space-1));
        border-radius: calc((var(--wt-space-6) + var(--wt-space-1)) / 2);
        background-color: transparent;
      }

      .portion button {
        border-radius: inherit;
      }

      .portion button :is(.mark, wt-icon),
      .portion .count {
        color: var(--wt-color-text-muted);
      }

      .portion .count {
        min-width: var(--wt-tap-min);
        font-size: var(--wt-font-size-md);
        text-wrap: nowrap;
      }

      .stepper.round {
        align-items: center;
        gap: calc(var(--wt-space-4) + var(--wt-space-1) / 2);
        height: auto;
        border: none;
        background-color: transparent;
      }

      .round button {
        width: calc(var(--wt-tap-min) + var(--wt-space-3));
        height: calc(var(--wt-tap-min) + var(--wt-space-3));
        margin-block: 0;
        border: var(--wt-field-line-width) solid var(--wt-color-border);
        border-radius: 50%;
        background-color: var(--wt-color-surface);
      }

      .round .mark {
        width: calc(var(--wt-space-1) * 3.75);
        height: calc(var(--wt-space-1) * 3.75);
      }

      .round .count {
        min-width: calc(var(--wt-tap-min) + var(--wt-space-5));
        font-size: var(--wt-font-size-payment-amount);
      }
    `,
  ];

  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max: number | null = null;
  @property() label = "";
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ reflect: true }) variant: "box" | "round" | "portion" = "box";
  @property({ attribute: false }) formatCount = (value: number, max: number): string =>
    `${value} of ${max}`;
  /** Each is given `label`, naming the button after what it counts. */
  @property({ attribute: false }) decreaseLabel: (label: string) => string = (label) =>
    `Decrease ${label}`;
  @property({ attribute: false }) increaseLabel: (label: string) => string = (label) =>
    `Increase ${label}`;
  @property({ attribute: false }) increaseDescription = "";
  /** Names the bin, given `label`; with none, − is disabled at `min` and there is no bin. */
  @property({ attribute: false }) removeLabel: ((label: string) => string) | null = null;

  #focused: Element | null = null;

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

  private pressBin(event: Event): void {
    event.stopPropagation();
    // As `step`: the bin's disabled state is drawn a render late.
    if (this.disabled || !this.#atMin) return;
    this.dispatchEvent(
      new CustomEvent("wt-remove", {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    this.#focused = (this.renderRoot as ShadowRoot).activeElement;
  }

  // The group holds focus when a limit disables the active step, so held Enter cannot reverse it.
  // When − becomes a bin, + can take focus since the bin must never receive a held Enter.
  protected override updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    const focused = this.#focused;
    this.#focused = null;
    if (!(focused instanceof HTMLButtonElement) || (focused.isConnected && !focused.disabled))
      return;
    const plus = this.renderRoot.querySelector<HTMLButtonElement>('button[data-step="1"]')!;
    if (!focused.isConnected && !plus.disabled) {
      plus.focus();
      return;
    }
    const group = this.renderRoot.querySelector<HTMLElement>('[role="group"]')!;
    group.tabIndex = -1;
    group.addEventListener("blur", () => group.removeAttribute("tabindex"), { once: true });
    group.focus();
  }

  override render() {
    const atMin = this.#atMin;
    const atMax = this.#atMax;
    const removeLabel = this.removeLabel;
    const portion = this.variant === "portion";
    const markLength = this.variant === "round" ? 15 : 10;
    return html`
      <div
        class=${portion ? "stepper portion" : this.variant === "round" ? "stepper round" : "stepper"}
        part="stepper"
        role="group"
        aria-label=${this.label}
      >
        ${
          removeLabel !== null && atMin
            ? html`<button
                type="button"
                data-remove
                aria-label=${removeLabel(this.label)}
                ?disabled=${this.disabled}
                @click=${(event: Event) => this.pressBin(event)}
              >
                <wt-icon name="menu-delete" size="lg"></wt-icon>
              </button>`
            : html`<button
                type="button"
                data-step="-1"
                aria-label=${this.decreaseLabel(this.label)}
                ?disabled=${this.disabled || atMin}
                @click=${(event: Event) => this.step(-1, event)}
              >
                ${mark(false, markLength)}
              </button>`
        }
        <span class="count" aria-live="polite"
          >${portion && this.max !== null ? this.formatCount(this.value, this.max) : this.value}</span
        >
        <button
          type="button"
          data-step="1"
          aria-label=${this.increaseLabel(this.label)}
          aria-description=${this.increaseDescription || nothing}
          ?disabled=${this.disabled || atMax}
          @click=${(event: Event) => this.step(1, event)}
        >
          ${mark(true, markLength)}
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
