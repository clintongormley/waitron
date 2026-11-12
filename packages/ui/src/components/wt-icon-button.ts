import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { iconButtonStyles, trackIconTooltip } from "../icon-button.js";
import { delegatesFocusShadowRootOptions } from "../interactive.js";
import "./wt-icon.js";

@customElement("wt-icon-button")
export class WtIconButton extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;
  static override styles = [
    baseStyles,
    iconButtonStyles,
    css`
      :host {
        display: inline-flex;
      }
    `,
  ];

  @property() label = "";
  @property() icon = "";
  @property({ attribute: false }) pressed?: boolean;
  @property({ type: Boolean, reflect: true }) disabled = false;

  override render() {
    return html`<button
      type="button"
      part="button"
      class="icon-button"
      aria-label=${this.label}
      aria-pressed=${this.pressed === undefined ? nothing : String(this.pressed)}
      ?disabled=${this.disabled}
      @pointerenter=${trackIconTooltip}
      @pointerleave=${trackIconTooltip}
      @focus=${trackIconTooltip}
      @blur=${trackIconTooltip}
    >
      <wt-icon name=${this.icon}></wt-icon
      ><span class="icon-tooltip" aria-hidden="true">${this.label}</span>
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-icon-button": WtIconButton;
  }
}
