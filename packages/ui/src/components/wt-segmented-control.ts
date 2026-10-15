import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, disabledStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, uniqueId } from "../interactive.js";

export interface SegmentedOption {
  value: string;
  label: string;
}

@customElement("wt-segmented-control")
export class WtSegmentedControl extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        max-width: var(--wt-field-max-width);
      }
      .label,
      .hint {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .label {
        margin-block-end: var(--wt-space-2);
      }
      .hint,
      [data-error] {
        margin-block-start: var(--wt-space-2);
      }
      [data-error] {
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
      [role="radiogroup"] {
        display: inline-flex;
        max-width: 100%;
      }
      button {
        flex: 1 1 auto;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        margin: 0;
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        cursor: pointer;
        overflow-wrap: anywhere;
      }
      button + button {
        border-inline-start-width: 0;
      }
      button:first-child {
        border-start-start-radius: var(--wt-radius-md);
        border-end-start-radius: var(--wt-radius-md);
      }
      button:last-child {
        border-start-end-radius: var(--wt-radius-md);
        border-end-end-radius: var(--wt-radius-md);
      }
      button[aria-checked="true"] {
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }
      button:disabled {
        ${disabledStyles}
      }
      button:focus-visible {
        position: relative;
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
    `,
  ];

  @property() name = "";
  @property() label = "";
  @property() value = "";
  @property({ attribute: false }) options: readonly SegmentedOption[] = [];
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property() error = "";
  @property() hint = "";
  readonly #hintId = uniqueId("wt-segmented-hint");
  readonly #errorId = uniqueId("wt-segmented-error");

  override focus(options?: FocusOptions): void {
    this.shadowRoot?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus(options);
  }

  private choose(value: string): void {
    if (this.disabled || value === this.value) return;
    this.value = value;
    this.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private keydown(event: KeyboardEvent, index: number): void {
    if (this.disabled) return;
    if (event.key === "Enter" || event.key === " ") {
      event.stopPropagation();
      return;
    }
    const last = this.options.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = index === 0 ? last : index - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.choose(this.options[next]!.value);
    this.shadowRoot!.querySelectorAll<HTMLButtonElement>("button")[next]!.focus();
  }

  override render() {
    const selected = this.options.findIndex((option) => option.value === this.value);
    const describedBy = [this.hint ? this.#hintId : "", this.error ? this.#errorId : ""]
      .filter(Boolean)
      .join(" ");
    return html`
      <span class="label">${this.label}</span>
      <div
        role="radiogroup"
        aria-label=${this.label}
        aria-describedby=${describedBy || nothing}
        aria-invalid=${this.error ? "true" : nothing}
      >
        ${this.options.map(
          (option, index) =>
            html`<button
              type="button"
              role="radio"
              aria-checked=${option.value === this.value}
              tabindex=${index === (selected < 0 ? 0 : selected) ? 0 : -1}
              ?disabled=${this.disabled}
              @keydown=${(event: KeyboardEvent) => this.keydown(event, index)}
              @click=${(event: Event) => {
                event.stopPropagation();
                this.choose(option.value);
              }}
            >
              ${option.label}
            </button>`,
        )}
      </div>
      ${this.hint ? html`<span id=${this.#hintId} class="hint">${this.hint}</span>` : nothing}
      ${this.error ? html`<span id=${this.#errorId} data-error>${this.error}</span>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-segmented-control": WtSegmentedControl;
  }
}
