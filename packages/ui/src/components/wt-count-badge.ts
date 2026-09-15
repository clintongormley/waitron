import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

export type WtCountBadgeTone = "neutral" | "warning" | "error";

/** A count pill. Renders nothing at zero and caps its text at "99+". It has no accessible name of
 * its own: the control it decorates must say the count. */
@customElement("wt-count-badge")
export class WtCountBadge extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
      }
      span {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: var(--wt-space-5);
        padding: 0 var(--wt-space-1);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        line-height: var(--wt-space-5);
      }
      :host([tone="warning"]) span {
        border-color: transparent;
        background: var(--wt-color-warning);
        color: var(--wt-color-on-warning);
      }
      :host([tone="error"]) span {
        border-color: transparent;
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
      }
    `,
  ];

  @property({ type: Number }) count = 0;
  @property({ reflect: true }) tone: WtCountBadgeTone = "neutral";

  override render() {
    if (!(this.count > 0)) return nothing;
    return html`<span part="badge">${this.count > 99 ? "99+" : String(this.count)}</span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-count-badge": WtCountBadge;
  }
}
