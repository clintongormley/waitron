import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import "./wt-help-tooltip.js";

/** A menu option with a help-mode badge in its own square beside it. Not itself a control. */
@customElement("wt-menu-row")
export class WtMenuRow extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        width: 100%;
      }

      ::slotted(*) {
        flex: 1 1 auto;
        min-width: 0;
      }

      /* Beats the badge's own :host rules, which hang it over a corner at a smaller size. */
      wt-help-tooltip[data-help-on] {
        position: static;
        margin: 0;
        flex: none;
        --wt-help-badge-target: var(--wt-tap-min);
      }
    `,
  ];

  /** The help box's text; empty draws no badge. */
  @property() help = "";
  /** The badge's accessible name, whole. */
  @property({ attribute: "help-label" }) helpLabel = "";

  override render() {
    return html`<slot></slot>${
        this.help
          ? html`<wt-help-tooltip mode="help-mode" data-keep-open aria-label=${this.helpLabel}
              >${this.help}</wt-help-tooltip
            >`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-menu-row": WtMenuRow;
  }
}
