import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, disabledStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";

@customElement("wt-input")
export class WtInput extends LitElement {
  // Delegates .focus() on the host to the inner <input> — a POS constantly needs to
  // programmatically focus a specific field.
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      label {
        display: block;
        margin-bottom: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }

      input {
        width: 100%;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
      }

      input:disabled {
        ${disabledStyles}
      }

      :host([invalid]) input {
        border-color: var(--wt-color-danger);
      }
    `,
  ];

  @property() value = "";
  @property() label = "";
  @property() type = "text";
  @property() placeholder = "";
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) invalid = false;

  // Unique per instance so a page with multiple wt-input elements never
  // collides label `for`/input `id` pairs.
  private readonly inputId = uniqueId("wt-input");

  private onInput(event: Event): void {
    this.value = (event.target as HTMLInputElement).value;
    dispatchWtChange(this, event, { value: this.value });
  }

  override render() {
    return html`
      ${this.label ? html`<label for=${this.inputId}>${this.label}</label>` : nothing}
      <input
        id=${this.inputId}
        .value=${this.value}
        type=${this.type}
        placeholder=${this.placeholder}
        ?disabled=${this.disabled}
        aria-invalid=${this.invalid}
        @input=${this.onInput}
      />
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-input": WtInput;
  }
}
