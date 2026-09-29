import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import { baseStyles } from "@waitron/ui";
import type { WtDialog } from "@waitron/ui";
import { t } from "../i18n/t.js";

export interface BillChoiceDetail {
  bills: "merge" | "separate";
}

/**
 * Asks what happens to the bills when one party joins another: merged (the default) or kept as
 * separate bills. `scope` says which party joins which. The dialog only reports the choice.
 */
@customElement("till-bill-choice-dialog")
export class TillBillChoiceDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      p {
        margin: 0;
      }
    `,
  ];

  @property() scope = "";

  override async firstUpdated(): Promise<void> {
    await this.renderRoot.querySelector<WtDialog>("wt-dialog")!.updateComplete;
    this.renderRoot.querySelector<HTMLElement>("[data-bills-merge]")!.focus();
  }

  #choose(bills: BillChoiceDetail["bills"]): void {
    this.dispatchEvent(
      new CustomEvent<BillChoiceDetail>("bill-choice-confirm", {
        detail: { bills },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(): void {
    this.dispatchEvent(new CustomEvent("bill-choice-cancel", { bubbles: true, composed: true }));
  }

  override render() {
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${this.scope}
      @wt-close=${() => this.#cancel()}
    >
      <p>${t("table.bills_question")}</p>
      <wt-button slot="footer" data-bills-cancel variant="ghost" @click=${() => this.#cancel()}>
        ${t("action.cancel")}
      </wt-button>
      <wt-button
        slot="footer"
        data-bills-separate
        variant="secondary"
        @click=${() => this.#choose("separate")}
      >
        ${t("table.bills_separate")}
      </wt-button>
      <wt-button
        slot="footer"
        data-bills-merge
        variant="primary"
        @click=${() => this.#choose("merge")}
      >
        ${t("table.bills_merge")}
      </wt-button>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-bill-choice-dialog": TillBillChoiceDialog;
  }
}
