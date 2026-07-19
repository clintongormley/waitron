import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";

@customElement("wt-switch")
export class WtSwitch extends LitElement {
  // Delegates .focus() on the host to the inner <input> — same rationale as wt-button/wt-input.
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-3);
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
      }

      .control {
        position: relative;
        display: inline-flex;
        align-items: center;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
      }

      /* The native input covers the control so it stays the hit target and keeps keyboard and
         assistive-technology behaviour. It fills .control exactly (inset: 0) rather than
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
        cursor: pointer;
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property() label = "";

  // Unique per instance so a page with multiple wt-switch elements never
  // collides label `for`/input `id` pairs.
  private readonly inputId = uniqueId("wt-switch");

  private onChange(event: Event): void {
    this.checked = (event.target as HTMLInputElement).checked;
    dispatchWtChange(this, event, { checked: this.checked });
  }

  override render() {
    return html`
      <span class="control">
        <input
          id=${this.inputId}
          type="checkbox"
          role="switch"
          .checked=${this.checked}
          ?disabled=${this.disabled}
          aria-label=${this.label || nothing}
          @change=${this.onChange}
        />
        <span class="track"></span>
        <span class="thumb"></span>
      </span>
      ${this.label ? html`<label for=${this.inputId}>${this.label}</label>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-switch": WtSwitch;
  }
}
