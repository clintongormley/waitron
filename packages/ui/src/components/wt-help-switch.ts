import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { registerIcons } from "./wt-icon.js";
import { delegatesFocusShadowRootOptions } from "../interactive.js";
import { HelpModeController, currentHelpMode, setHelpMode } from "../help-mode.js";

// Material Symbols Outlined, Copyright Google, Apache-2.0.
// Source: google/material-design-icons@10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7.
registerIcons({
  help: "M7.97 12q0.35 0 0.59-0.24T8.8 11.17q0-0.35-0.24-0.59T7.97 10.33q-0.35 0-0.59 0.24T7.13 11.17q0 0.35 0.24 0.59T7.97 12Zm-0.6-2.57h1.23q0-0.55 0.12-0.87t0.71-0.87q0.43-0.43 0.68-0.82t0.25-0.94q0-0.93-0.68-1.43t-1.62-0.5q-0.95 0-1.54 0.5T5.7 5.7l1.1 0.43q0.08-0.3 0.38-0.65t0.89-0.35q0.53 0 0.8 0.29t0.27 0.64q0 0.33-0.2 0.62T8.43 7.23q-0.73 0.65-0.9 0.98t-0.17 1.22Zm0.63 5.23q-1.38 0-2.6-0.53T3.28 12.72q-0.9-0.9-1.43-2.12T1.33 8q0-1.38 0.53-2.6T3.28 3.28q0.9-0.9 2.12-1.43T8 1.33q1.38 0 2.6 0.53T12.72 3.28q0.9 0.9 1.43 2.12T14.67 8q0 1.38-0.53 2.6T12.72 12.72q-0.9 0.9-2.12 1.43T8 14.67Zm0-1.33q2.23 0 3.78-1.55t1.55-3.78q0-2.23-1.55-3.78t-3.78-1.55q-2.23 0-3.78 1.55t-1.55 3.78q0 2.23 1.55 3.78t3.78 1.55Zm0-5.33Z",
});

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
        border: var(--wt-field-line-width) solid transparent;
        --wt-action-native-icon-color: currentColor;
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: var(--wt-color-text-muted);
        font: inherit;
        cursor: pointer;
        place-items: center;
      }

      button[aria-pressed="true"] {
        border-color: var(--wt-color-primary);
        background: var(--wt-color-surface-lifted);
        color: var(--wt-color-text);
      }

      @media (forced-colors: active) {
        button[aria-pressed="true"] {
          forced-color-adjust: none;
          border-color: Highlight;
          background: Highlight;
          color: HighlightText;
        }
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
      <wt-icon name="help" size="lg"></wt-icon>
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-help-switch": WtHelpSwitch;
  }
}
