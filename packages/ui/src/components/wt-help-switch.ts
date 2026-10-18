import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions } from "../interactive.js";
import { HelpModeController, currentHelpMode, setHelpMode } from "../help-mode.js";

@customElement("wt-help-switch")
export class WtHelpSwitch extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-block;
      }

      button {
        display: inline-grid;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: 0;
        border: 0;
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: var(--wt-color-text-muted);
        font: inherit;
        cursor: pointer;
        place-items: center;
      }

      .icon {
        display: inline-grid;
        width: calc(var(--wt-space-6) - var(--wt-space-2));
        height: calc(var(--wt-space-6) - var(--wt-space-2));
        border: 1px solid currentColor;
        border-radius: var(--wt-radius-full);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        place-items: center;
      }

      button[aria-pressed="true"] .icon {
        border-color: transparent;
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }
    `,
  ];

  @property() label = "Help";

  readonly #help = new HelpModeController(this);

  override render() {
    const on = this.#help.on;
    return html`<button
      type="button"
      aria-label=${this.label}
      aria-pressed=${on ? "true" : "false"}
      @click=${() => setHelpMode(!currentHelpMode())}
    >
      <span class="icon" aria-hidden="true">?</span>
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-help-switch": WtHelpSwitch;
  }
}
