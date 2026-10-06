import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { baseStyles, visuallyHiddenStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";

@customElement("wt-switch")
export class WtSwitch extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
        align-items: center;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        max-width: var(--wt-field-max-width);
      }

      /* The control and its label, and no more: a host stretched by its container must not
         toggle from the empty space past the label. */
      .hit-area {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-3);
        cursor: pointer;
      }

      :host([disabled]) .hit-area {
        cursor: not-allowed;
      }

      .control {
        position: relative;
        display: inline-flex;
        align-items: center;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
      }

      /* A zero-width line of text, centred like the label, so the control's baseline, and so the
         element's, is where the label's text sits: the track alone has no text to give one. */
      .control::before {
        content: "\\200b" / "";
      }

      /* The native input covers the control and keeps keyboard and assistive-technology
         behaviour. It fills .control exactly (inset: 0) rather than
         carrying its own min-height/min-width — the minimum tap target comes from .control
         (and :host) above, so the input can never stretch past its container and steal clicks
         from whatever is stacked next to or below the switch. */
      input {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        margin: 0;
        opacity: 0;
        cursor: pointer;
      }

      input:disabled {
        cursor: not-allowed;
      }

      .track {
        width: var(--wt-space-6);
        height: var(--wt-space-4);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-border);
        transition: background 120ms ease;
      }

      .thumb {
        position: absolute;
        left: 0;
        width: var(--wt-space-4);
        height: var(--wt-space-4);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-surface);
        box-shadow: var(--wt-shadow-1);
        transition: transform 120ms ease;
      }

      :host([checked]) .track {
        background: var(--wt-color-primary);
      }

      :host([checked]) .thumb {
        transform: translateX(var(--wt-space-4));
      }

      :host([disabled]) {
        opacity: var(--wt-opacity-disabled);
      }

      input:focus-visible ~ .track {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }

      label {
        cursor: inherit;
      }

      .visually-hidden {
        ${visuallyHiddenStyles}
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property() label = "";
  @property({ attribute: "accessible-name" }) accessibleName = "";
  /** Names the switch for assistive technology without drawing the label beside it — for a
   * switch whose column or row heading already says what it is. */
  @property({ type: Boolean, attribute: "hide-label" }) hideLabel = false;
  @property() name = "";
  /** Read to assistive technology as the switch's description; the screen draws any visible text. */
  @property() description = "";

  private readonly inputId = uniqueId("wt-switch");

  @query("input") private input!: HTMLInputElement;

  /** The original click is stopped once handed to the input, so a listener above the switch in
   * the bubbling phase sees one click. A disabled switch is left alone. */
  private onHitAreaClick(event: MouseEvent): void {
    if (this.disabled) return;
    const target = event.composedPath()[0];
    if (target === this.input || (target instanceof Element && target.closest("label"))) return;
    event.stopPropagation();
    this.input.click();
  }

  private onChange(event: Event): void {
    this.checked = (event.target as HTMLInputElement).checked;
    dispatchWtChange(this, event, { checked: this.checked });
  }

  override render() {
    return html`
      <span class="hit-area" @click=${this.onHitAreaClick}>
        <span class="control">
          <input
            id=${this.inputId}
            name=${this.name || nothing}
            type="checkbox"
            role="switch"
            .checked=${this.checked}
            ?disabled=${this.disabled}
            aria-label=${this.accessibleName || this.label || nothing}
            aria-describedby=${this.description ? `${this.inputId}-description` : nothing}
            @change=${this.onChange}
          />
          <span class="track"></span>
          <span class="thumb"></span>
        </span>
        ${this.label && !this.hideLabel ? html`<label part="label" for=${this.inputId}>${this.label}</label>` : nothing}
      </span>
      ${
        this.description
          ? html`<span class="visually-hidden" id="${this.inputId}-description"
              >${this.description}</span
            >`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-switch": WtSwitch;
  }
}
