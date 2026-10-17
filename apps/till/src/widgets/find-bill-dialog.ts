import type { BillUnsent } from "../api/client.js";
import { billUnsentText } from "../state/bill-unsent.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { formatMoney, stringToCents } from "@waitron/shared";
import {
  baseStyles,
  leaveCoordinatorFor,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-price-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { BillLookupRow, Tender } from "../api/client.js";
import { typedAmount } from "../state/bill-payment.js";
import { currentLocale, overLimitText, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { codeMessage } from "../i18n/codes.js";
import { trackDialog } from "./track-dialog.js";

export interface FindBillPayDetail {
  workingOrderId: string;
  tender: Tender;
  invoiced: boolean;
}

type CollectionDraft = { method: "cash" | "card"; cash: string; externalRef: string };

@customElement("till-find-bill-dialog")
export class TillFindBillDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .body {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        width: min(
          var(--wt-form-max-width),
          calc(var(--wt-dialog-max-width) - 2 * var(--wt-space-5))
        );
      }
      .summary {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }
      .methods {
        display: flex;
        gap: var(--wt-space-2);
      }
      p {
        margin: 0;
      }
    `,
  ];

  @property({ attribute: false }) bill: BillLookupRow | null = null;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) error?:
    StringKey | { overLimit: string } | { code: string } | { unsentBill: BillUnsent };
  @state() private selected: BillLookupRow | null = null;
  @state() private method: "cash" | "card" = "cash";
  @state() private cash = "";
  @state() private cashError = false;
  @state() private externalRef = "";
  @state() private active = true;
  #generation = 0;
  #scope?: DraftScope<CollectionDraft>;
  #leave?: LeaveCoordinator;
  #baseline?: CollectionDraft;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.#generation++;
    super.disconnectedCallback();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("bill") && this.bill !== null && this.bill !== this.selected)
      this.#select(this.bill);
    if (changed.has("busy") && this.busy && this.#baseline) this.#scope?.commit(this.#baseline);
    if (!this.isConnected || !this.active || this.selected === null || this.#scope) return;
    this.#baseline ??= this.#draft();
    this.#leave = leaveCoordinatorFor(this);
    this.#scope = this.#leave?.register<CollectionDraft>({
      id: this,
      current: () => this.#draft(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => this.#comparable(a) === this.#comparable(b),
      restore: (value) => {
        this.method = value.method;
        this.cash = value.cash;
        this.externalRef = value.externalRef;
        this.cashError = false;
      },
    });
    this.#scope?.commit(this.#baseline);
  }

  #draft(): CollectionDraft {
    return { method: this.method, cash: this.cash, externalRef: this.externalRef };
  }

  #comparable(value: CollectionDraft): string {
    if (value.method === "card")
      return JSON.stringify({ method: "card", externalRef: value.externalRef.trim() });
    let amount: string | { invalid: string };
    try {
      amount = stringToCents(value.cash).toString();
    } catch {
      amount = { invalid: value.cash };
    }
    return JSON.stringify({ method: "cash", amount });
  }

  #closed(event?: Event): void {
    event?.stopPropagation();
    if (event && event.target !== event.currentTarget) return;
    if (!this.isConnected || !this.active || this.busy) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#emit("find-bill-close");
  }

  closeSaved(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.active = false;
    this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.closeAfter("saved");
  }

  #back(): void {
    if (!this.isConnected || !this.active || this.busy) return;
    void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
  }

  #emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #select(row: BillLookupRow): void {
    if (!this.isConnected || !this.active || this.busy) return;
    const generation = ++this.#generation;
    const accept = () => {
      if (
        !this.isConnected ||
        !this.active ||
        this.busy ||
        this.bill !== row ||
        generation !== this.#generation
      )
        return;
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#baseline = undefined;
      this.selected = row;
      this.cash = row.stillOwed;
      this.cashError = false;
      this.method = "cash";
      this.#emit("find-bill-selection");
    };
    if (this.#scope?.isDirty()) {
      void this.#leave!.request({ scopes: [this], reason: "navigation", proceed: accept });
    } else accept();
  }

  #collect(): void {
    const bill = this.selected;
    if (!this.isConnected || !this.active || bill === null || this.busy) return;
    if (this.method === "cash") {
      let enough = false;
      try {
        const amount = typedAmount(this.cash);
        enough = amount !== null && stringToCents(amount) >= stringToCents(bill.stillOwed);
      } catch {
        /* invalid amount */
      }
      this.cashError = !enough;
      if (!enough) return;
    }
    this.#emit("find-bill-pay", {
      workingOrderId: bill.workingOrderId,
      tender:
        this.method === "cash"
          ? { method: "cash", amount: typedAmount(this.cash)! }
          : {
              method: "card",
              amount: bill.stillOwed,
              ...(this.externalRef.trim() ? { externalRef: this.externalRef.trim() } : {}),
            },
      invoiced: bill.invoiceNumber !== null,
    } satisfies FindBillPayDetail);
  }

  override render() {
    const bill = this.selected;
    if (bill === null) return nothing;
    const amount = formatMoney(bill.stillOwed, currentLocale());
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .heading=${t("find_bill.title")}
      .dismissible=${!this.busy}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      @wt-close=${this.#closed}
    >
      <div class="body">
        <div class="summary">
          <span>${bill.invoiceNumber ?? bill.orderNumber} ${bill.label ?? ""}</span
          ><span>${bill.tables.join(", ")} ${bill.partyName ?? ""}</span
          ><strong>${t("find_bill.owes").replace("{amount}", amount)}</strong>
        </div>
        <div class="methods">
          <wt-button
            variant=${this.method === "cash" ? "primary" : "secondary"}
            .disabled=${this.busy}
            @click=${() => {
              if (!this.isConnected || !this.active || this.busy) return;
              this.method = "cash";
              this.#scope?.changed();
            }}
            >${t("find_bill.cash")}</wt-button
          >
          <wt-button
            data-card
            variant=${this.method === "card" ? "primary" : "secondary"}
            .disabled=${this.busy}
            @click=${() => {
              if (!this.isConnected || !this.active || this.busy) return;
              this.method = "card";
              this.#scope?.changed();
            }}
            >${t("find_bill.card")}</wt-button
          >
        </div>
        ${
          this.method === "cash"
            ? html`<wt-price-input
                name="cash-received"
                decimal-locale=${currentLocale()}
                .label=${t("find_bill.cash_received")}
                unit="€"
                .fixedUnit=${true}
                .value=${live(this.cash)}
                .disabled=${this.busy}
                .error=${this.cashError ? t("find_bill.cash_short").replace("{amount}", amount) : ""}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  if (!this.isConnected || !this.active || this.busy) return;
                  this.cash = event.detail.value;
                  this.cashError = false;
                  this.#scope?.changed();
                }}
              ></wt-price-input>`
            : html`<wt-input
                name="terminal-reference"
                .label=${t("find_bill.card_reference")}
                .value=${live(this.externalRef)}
                .disabled=${this.busy}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  if (!this.isConnected || !this.active || this.busy) return;
                  this.externalRef = event.detail.value;
                  this.#scope?.changed();
                }}
              ></wt-input>`
        }
        <wt-form-actions
          .error=${
            typeof this.error === "string"
              ? t(this.error)
              : this.error
                ? "code" in this.error
                  ? codeMessage(this.error.code)
                  : "unsentBill" in this.error
                    ? billUnsentText(this.error.unsentBill, bill.label ?? String(bill.orderNumber))
                    : overLimitText(this.error.overLimit)
                : this.cashError
                  ? t("form.fix_fields")
                  : ""
          }
        >
          <wt-button slot="cancel" variant="secondary" .disabled=${this.busy} @click=${this.#back}>
            ${t("find_bill.back")}</wt-button
          >
          <wt-button
            data-collect
            variant="primary"
            .loading=${this.busy}
            .disabled=${this.busy || this.cashError}
            @click=${() => this.#collect()}
          >
            ${t("find_bill.confirm").replace("{amount}", amount)}</wt-button
          >
        </wt-form-actions>
      </div>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-find-bill-dialog": TillFindBillDialog;
  }
}
