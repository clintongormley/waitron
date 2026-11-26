import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

@customElement("wt-amount-block")
export class WtAmountBlock extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        padding: calc(var(--wt-space-3) + var(--wt-space-1) / 2) var(--wt-space-4)
          calc(var(--wt-space-2) - var(--wt-space-1) / 2);
        text-align: center;
        color: var(--wt-color-text-muted);
      }

      [part="label"] {
        font-size: var(--wt-font-size-sm);
      }

      strong {
        display: block;
        overflow-wrap: anywhere;
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-payment-amount);
        font-weight: var(--wt-font-weight-bold);
        font-variant-numeric: tabular-nums;
        line-height: 1.1;
      }

      [part="breakdown"] {
        font-size: var(--wt-font-size-md);
      }
    `,
  ];

  override render() {
    return html`<div part="label"><slot name="label"></slot></div>
      <strong part="amount"><slot></slot></strong>
      <div part="breakdown"><slot name="breakdown"></slot></div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-amount-block": WtAmountBlock;
  }
}
