import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import "./wt-icon.js";

export type ShareListState = "due" | "current" | "paid";

/** `amount` is shown as given, so the caller formats the money. */
export interface ShareListShare {
  name: string;
  detail: string;
  amount: string;
  state: ShareListState;
}

/** The shares of a bill, one row each, marking which are paid and whose turn it is. The marker is
 * hidden from screen readers, so a state the marker alone would show goes into `detail`. */
@customElement("wt-share-list")
export class WtShareList extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      ol {
        margin: 0 var(--wt-space-3);
        padding: 0;
        overflow: hidden;
        list-style: none;
        border: var(--wt-field-line-width) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background-color: var(--wt-color-surface);
      }

      li {
        display: flex;
        align-items: center;
        gap: calc(var(--wt-space-2) + var(--wt-space-1) / 2);
        padding: calc(var(--wt-space-2) + var(--wt-space-1) * 0.75)
          calc(var(--wt-space-3) + var(--wt-space-1) / 2);
        border-block-end: var(--wt-field-line-width) solid var(--wt-color-border);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-normal);
      }

      li:last-child {
        border-block-end: none;
      }

      .marker {
        display: grid;
        flex: none;
        place-items: center;
        width: calc(var(--wt-space-5) - var(--wt-space-1) / 2);
        height: calc(var(--wt-space-5) - var(--wt-space-1) / 2);
        border: var(--wt-field-line-width-active) solid var(--wt-color-border);
        border-radius: 50%;
      }

      .text {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .detail {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .amount {
        margin-inline-start: auto;
        font-weight: var(--wt-font-weight-bold);
        font-variant-numeric: tabular-nums;
      }

      li[data-state="current"] {
        background-color: var(--wt-color-surface-lifted);
        font-weight: var(--wt-font-weight-bold);
      }

      li[data-state="current"] .marker {
        border-color: var(--wt-color-primary);
        background-color: var(--wt-color-primary);
      }

      li[data-state="paid"] {
        color: var(--wt-color-text-muted);
      }

      li[data-state="paid"] .marker {
        border-color: var(--wt-color-primary);
      }

      .marker wt-icon {
        color: var(--wt-color-primary-text);
      }

      li[data-state="paid"] .amount {
        font-weight: var(--wt-font-weight-medium);
      }

      /* A contrast theme drops the current marker's fill, leaving it a ring like a due one. */
      @media (forced-colors: active) {
        li[data-state="current"] .marker {
          forced-color-adjust: none;
          border-color: Highlight;
          background-color: Highlight;
        }
      }
    `,
  ];

  @property() label = "";
  @property({ attribute: false }) shares: ShareListShare[] = [];

  override render() {
    if (this.shares.length === 0) return nothing;
    return html`<ol part="list" aria-label=${this.label}>
      ${this.shares.map(
        (share) =>
          html`<li
            data-state=${share.state}
            aria-current=${share.state === "current" ? "step" : nothing}
          >
            <span class="marker" data-marker aria-hidden="true"
              >${
                share.state === "paid" ? html`<wt-icon name="check" size="lg"></wt-icon>` : nothing
              }</span
            >
            <span class="text">
              <span data-name>${share.name}</span>
              <span class="detail" data-detail>${share.detail}</span>
            </span>
            <span class="amount" data-amount>${share.amount}</span>
          </li>`,
      )}
    </ol>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-share-list": WtShareList;
  }
}
