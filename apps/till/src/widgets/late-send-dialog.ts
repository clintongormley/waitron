import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import { baseStyles, type WtDialog } from "@waitron/ui";
import { currentLocale, t } from "../i18n/t.js";
import { dishLine } from "./dish-format.js";

export type LateSendPurpose = "send" | "save" | "extras" | "stored";

export interface LateSendDish {
  quantity: string;
  name: string;
  unitName?: Record<string, string> | null;
  soldInEach?: boolean;
  /** The extras a change adds to the dish, by name; absent on a dish asked about itself. */
  extras?: readonly string[];
}

/**
 * Lists dishes whose period has ended and changes nothing itself: Remove them (Don't add them, for
 * extras; Don't send them, for stored dishes) sends `wt-late-send-removed`, Station agreed sends
 * `wt-late-send-agreed`, and dismissing it sends `wt-late-send-cancelled`.
 */
@customElement("till-late-send-dialog")
export class TillLateSendDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      p {
        margin: 0 0 var(--wt-space-2);
      }

      ul {
        margin: 0 0 var(--wt-space-4);
        padding-left: var(--wt-space-5);
      }

      li {
        margin-bottom: var(--wt-space-1);
      }
    `,
  ];

  @property({ attribute: false }) dishes: readonly LateSendDish[] = [];

  /** In the order they first appear among the dishes. */
  @property({ attribute: false }) periodNames: readonly [string, ...string[]] = [""];

  /** `save`: a Park, which stores the order without sending it to the kitchen. `extras`: a change
   * adding extras to a sent dish, which the secondary choice abandons. `stored`: a Place of dishes
   * already stored on the order, which the secondary choice leaves there unsent. */
  @property() purpose: LateSendPurpose = "send";

  #emit(type: "wt-late-send-removed" | "wt-late-send-agreed" | "wt-late-send-cancelled"): void {
    this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true }));
  }

  #heading(): string {
    if (this.periodNames.length === 1)
      return t("late_send.heading").replace("{period}", () => this.periodNames[0]);
    const periods = new Intl.ListFormat(currentLocale(), { type: "conjunction" }).format(
      this.periodNames,
    );
    return t("late_send.heading_many").replace("{periods}", () => periods);
  }

  override render() {
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${this.#heading()}
      dismiss-on-backdrop
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#emit("wt-late-send-cancelled");
      }}
    >
      <p>${t("late_send.check")}</p>
      <ul>
        ${this.dishes.map(
          (dish) =>
            html`<li>
              ${dishLine(dish, dish.name)}${
                dish.extras?.length ? ` + ${dish.extras.join(", ")}` : ""
              }
            </li>`,
        )}
      </ul>
      <wt-button
        slot="footer"
        variant="secondary"
        @click=${(event: Event) => void (event.currentTarget as HTMLElement).closest<WtDialog>("wt-dialog")!.requestClose("cancel")}
        >${t("action.cancel")}</wt-button
      >
      <wt-button
        slot="footer"
        data-late-remove
        variant="secondary"
        @click=${() => this.#emit("wt-late-send-removed")}
      >
        ${t(
          this.purpose === "extras"
            ? "late_send.dont_add"
            : this.purpose === "stored"
              ? "late_send.dont_send"
              : "late_send.remove",
        )}
      </wt-button>
      <wt-button
        slot="footer"
        data-late-agreed
        variant="primary"
        @click=${() => this.#emit("wt-late-send-agreed")}
      >
        ${t(this.purpose === "save" ? "late_send.agreed_save" : "late_send.agreed")}
      </wt-button>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-late-send-dialog": TillLateSendDialog;
  }
}
