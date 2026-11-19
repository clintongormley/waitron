import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, type WtDialog } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { StaffNotice } from "../api/client.js";
import { staffNoticeText } from "../i18n/staff-notices.js";
import { t } from "../i18n/t.js";
import { trackDialog } from "./track-dialog.js";

/** Shown in place of a payment while payments wait for the box's time: why, in the waiting
 * notice's own words, and "Check the time" while the box offers it. Sends `payments-paused-close`
 * and `payments-paused-check-time`. */
@customElement("till-payments-paused-dialog")
export class TillPaymentsPausedDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      p {
        margin: 0 0 var(--wt-space-3);
        font-size: var(--wt-font-size-lg);
      }
    `,
  ];

  @property({ attribute: false }) notice!: StaffNotice;
  @property({ type: Boolean }) checkTimeOffered = false;

  #send(name: "payments-paused-close" | "payments-paused-check-time"): void {
    this.dispatchEvent(new CustomEvent(name, { detail: {}, bubbles: true, composed: true }));
  }

  override render(): TemplateResult {
    const words = staffNoticeText(this.notice);
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${t("payments_paused.title")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) this.#send("payments-paused-close");
      }}
    >
      <p>${words.main}</p>
      <p>${t("payments_paused.order_open")}</p>
      <wt-form-actions>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-close
          @click=${() =>
            void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel")}
          >${t("payments_paused.close")}</wt-button
        >
        ${
          this.checkTimeOffered
            ? html`<wt-button
                variant="primary"
                data-check-time
                @click=${() => this.#send("payments-paused-check-time")}
                >${t("staff_notice.check_time")}</wt-button
              >`
            : nothing
        }
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-payments-paused-dialog": TillPaymentsPausedDialog;
  }
}
