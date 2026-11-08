import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import "./wt-waitron-lockup.js";

/** The words in `label`, then Waitron's lockup in the colours of the theme it sits in. */
@customElement("wt-powered-by")
export class WtPoweredBy extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        align-items: baseline;
        justify-content: center;
        gap: var(--wt-space-2);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }

      wt-waitron-lockup {
        flex: none;
        inline-size: calc(var(--wt-space-6) * 2);
      }
    `,
  ];

  @property() label = "";

  override render() {
    return html`${this.label ? html`<span part="label">${this.label}</span>` : nothing}<wt-waitron-lockup
        part="lockup"
      ></wt-waitron-lockup>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-powered-by": WtPoweredBy;
  }
}
