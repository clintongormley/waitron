import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import type { BlockReason, BlockedLine, ChangedLine } from "../state/menu-refresh.js";

export interface BasketRefreshDetail {
  changed: ChangedLine[];
  blocked: BlockedLine[];
}

const REASON_WORDS: Record<BlockReason, StringKey> = {
  removed: "basket_refresh.removed",
  variant_removed: "basket_refresh.removed",
  unavailable: "basket_refresh.unavailable",
  extra_unavailable: "basket_refresh.unavailable",
  extra_removed: "basket_refresh.extra_removed",
  unit_changed: "basket_refresh.unit_changed",
};

/**
 * What a newly published menu changes in the basket (D9): each line's new price, and each line that
 * must be removed or replaced. It re-prices nothing itself; the app does that on
 * `wt-basket-refresh-confirmed`, and keeps the basket as it was on `wt-basket-refresh-cancelled`.
 */
@customElement("till-basket-refresh-dialog")
export class TillBasketRefreshDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      h3 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
      }

      ul {
        margin: 0 0 var(--wt-space-4);
        padding-left: var(--wt-space-5);
      }

      li {
        margin-bottom: var(--wt-space-1);
      }

      .price {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
    `,
  ];

  @property({ attribute: false }) changed: ChangedLine[] = [];

  @property({ attribute: false }) blocked: BlockedLine[] = [];

  /** `send`: a table's order, where a blocked line stays unsent rather than holding up payment. */
  @property() purpose: "pay" | "send" = "pay";

  #emit(type: "wt-basket-refresh-confirmed" | "wt-basket-refresh-cancelled"): void {
    this.dispatchEvent(
      new CustomEvent<BasketRefreshDetail>(type, {
        detail: { changed: this.changed, blocked: this.blocked },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #money(value: string): string {
    return formatMoney(value, currentLocale());
  }

  override render() {
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${t("basket_refresh.title")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#emit("wt-basket-refresh-cancelled");
      }}
    >
      ${
        this.changed.length === 0
          ? nothing
          : html`<section data-changed>
              <h3>${t("basket_refresh.changed")}</h3>
              <ul>
                ${this.changed.map(
                  (line) =>
                    html`<li data-line=${line.lineNo}>
                      ${line.name}
                      <span class="price"
                        >${
                          line.from === undefined
                            ? this.#money(line.to)
                            : `${this.#money(line.from)} → ${this.#money(line.to)}`
                        }</span
                      >
                    </li>`,
                )}
              </ul>
            </section>`
      }
      ${
        this.blocked.length === 0
          ? nothing
          : html`<section data-blocked>
              <h3>
                ${t(this.purpose === "send" ? "basket_refresh.blocked_send" : "basket_refresh.blocked")}
              </h3>
              <ul>
                ${this.blocked.map(
                  (line) =>
                    html`<li data-line=${line.lineNo}>
                      ${t(REASON_WORDS[line.reason]).replace("{name}", () => line.name)}
                    </li>`,
                )}
              </ul>
            </section>`
      }
      <wt-button
        slot="footer"
        data-cancel
        variant="secondary"
        @click=${() => this.#emit("wt-basket-refresh-cancelled")}
      >
        ${t("action.cancel")}
      </wt-button>
      <wt-button
        slot="footer"
        data-confirm
        variant="primary"
        @click=${() => this.#emit("wt-basket-refresh-confirmed")}
      >
        ${t("basket_refresh.confirm")}
      </wt-button>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-basket-refresh-dialog": TillBasketRefreshDialog;
  }
}
