import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
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
        position: relative;
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

      .control.has-end input {
        padding-inline-end: calc(var(--wt-tap-min) + var(--wt-space-3));
      }

      .end {
        display: none;
        position: absolute;
        inset-block: 0;
        inset-inline-end: var(--wt-space-1);
        align-items: center;
      }

      .control.has-end .end {
        display: flex;
      }

      input[aria-invalid="true"] {
        border-color: var(--wt-color-danger);
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
  @property() type = "text";
  @property() autocomplete = "";
  @property() placeholder = "";
  @property() error = "";
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) invalid = false;
  @state() private hasEnd = false;

  // Unnamed legacy fields retain a generated id. Named fields use the semantic name for both native
  // attributes, so consumers never have to infer "email" from "wt-input-2". Each input owns its own
  // shadow root, so repeated names do not collide with another field's label association.
  private readonly generatedInputId = uniqueId("wt-input");
  private readonly errorId = uniqueId("wt-input-error");

  private onInput(event: Event): void {
    this.value = (event.target as HTMLInputElement).value;
    dispatchWtChange(this, event, { value: this.value });
  }

  private onEndSlotChange(event: Event): void {
    this.hasEnd = (event.target as HTMLSlotElement).assignedElements().length > 0;
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
              <slot name="help"></slot>
            </div>`
          : nothing
      }
      <div class=${this.hasEnd ? "control has-end" : "control"}>
        <input
          id=${inputId}
          name=${this.name || nothing}
          .value=${this.value}
          type=${this.type}
          autocomplete=${this.autocomplete || nothing}
          placeholder=${this.placeholder}
          ?required=${this.required}
          ?disabled=${this.disabled}
          aria-invalid=${this.invalid || hasError}
          aria-describedby=${hasError ? this.errorId : nothing}
          @input=${this.onInput}
        />
        <slot class="end" name="end" @slotchange=${this.onEndSlotChange}></slot>
      </div>
      ${hasError ? html`<p id=${this.errorId} class="error" data-error>${this.error}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-input": WtInput;
  }
}
