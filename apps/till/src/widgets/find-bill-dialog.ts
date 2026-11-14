import { outsideCardFields, outsideCardValues, outsideCardStyles } from "./outside-card.js";
import type { OutsideCardDetails } from "../api/client.js";
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
import { clockUnusableText, currentLocale, overLimitText, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { codeMessage } from "../i18n/codes.js";
import { trackDialog } from "./track-dialog.js";

export interface FindBillPayDetail {
  workingOrderId: string;
  tender: Tender;
  invoiced: boolean;
}

type CollectionDraft = {
  method: "cash" | "card";
  cash: string;
  externalRef: string;
  outside: OutsideCardDetails;
};

@customElement("till-find-bill-dialog")
export class TillFindBillDialog extends LitElement {
  static override styles = [
    baseStyles,
    outsideCardStyles,
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
  @property({ type: Boolean }) unconfirmed = false;
  @property({ type: Boolean }) takesCash = false;
  @property({ type: Boolean }) takesManualCard = false;
  @property({ attribute: false }) confirmationTender?: Tender;
  @property({ attribute: false }) error?:
    | StringKey
    | { overLimit: string }
    | { code: string }
    | { unsentBill: BillUnsent }
    | { clockUnusable: { clockAt: string; offsetMinutes: number } };
  @state() private selected: BillLookupRow | null = null;
  @state() private method: "cash" | "card" = "cash";
  @state() private cash = "";
  @state() private cashError = false;
  @state() private externalRef = "";
  @state() private outside: OutsideCardDetails = {};
  @state() private active = true;
  #generation = 0;
  #scope?: DraftScope<CollectionDraft>;
  #leave?: LeaveCoordinator;
  #baseline?: CollectionDraft;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    !this.unconfirmed &&
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
    if (
      this.unconfirmed &&
      this.confirmationTender !== undefined &&
      (changed.has("confirmationTender") || changed.has("unconfirmed"))
    ) {
      const tender = this.confirmationTender;
      if (tender.method === "cash") {
        this.method = "cash";
        this.cash = tender.amount;
      } else if (tender.method === "card") {
        this.method = "card";
        this.externalRef = tender.externalRef ?? "";
        this.outside = outsideCardValues(tender);
      }
      this.cashError = false;
    }
    const offered = this.#methods();
    if (offered.length > 0 && !offered.includes(this.method)) this.method = offered[0]!;
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
        this.outside = value.outside;
        this.cashError = false;
      },
    });
    this.#scope?.commit(this.#baseline);
  }

  /** A payment awaiting its answer keeps its own method, so its retry can be sent as it was. */
  #methods(): ("cash" | "card")[] {
    const kept = this.unconfirmed ? this.confirmationTender?.method : undefined;
    return [
      ...(this.takesCash || kept === "cash" ? (["cash"] as const) : []),
      ...(this.takesManualCard || kept === "card" ? (["card"] as const) : []),
    ];
  }

  #draft(): CollectionDraft {
    return {
      method: this.method,
      cash: this.cash,
      externalRef: this.externalRef,
      outside: this.outside,
    };
  }

  #comparable(value: CollectionDraft): string {
    if (value.method === "card")
      return JSON.stringify({
        method: "card",
        externalRef: value.externalRef.trim(),
        ...outsideCardValues(value.outside),
      });
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
    if (!this.isConnected || !this.active || this.busy || this.unconfirmed) return;
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
    if (!this.isConnected || !this.active || this.busy || this.unconfirmed) return;
    void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("navigation");
  }

  #emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #select(row: BillLookupRow): void {
    if (
      !this.isConnected ||
      !this.active ||
      this.busy ||
      (this.unconfirmed && this.selected !== null)
    )
      return;
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
      this.method = this.#methods()[0] ?? "cash";
      this.#emit("find-bill-selection");
    };
    if (this.#scope?.isDirty()) {
      void this.#leave!.request({ scopes: [this], reason: "navigation", proceed: accept });
    } else accept();
  }

  #collect(): void {
    const bill = this.selected;
    if (!this.isConnected || !this.active || bill === null || this.busy) return;
    if (!this.#methods().includes(this.method)) return;
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
              ...outsideCardValues(this.outside),
            },
      invoiced: bill.invoiceNumber !== null,
    } satisfies FindBillPayDetail);
  }

  override render() {
    const bill = this.selected;
    if (bill === null) return nothing;
    const amount = formatMoney(bill.stillOwed, currentLocale());
    const methods = this.#methods();
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .heading=${t("find_bill.title")}
      .dismissible=${!this.busy && !this.unconfirmed}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      @wt-close=${this.#closed}
    >
      <div class="body">
        <div class="summary">
          <span>${bill.invoiceNumber ?? bill.orderNumber} ${bill.label ?? ""}</span
          ><span>${bill.tables.join(", ")} ${bill.partyName ?? ""}</span
          ><strong>${t("find_bill.owes").replace("{amount}", amount)}</strong>
        </div>
        ${methods.length === 0 ? nothing : this.#methodFields(methods, amount)}
        <wt-form-actions
          .error=${methods.length === 0 ? codeMessage("device.forbidden_action") : this.#errorText(bill)}
        >
          <wt-button
            slot="cancel"
            variant="secondary"
            .disabled=${this.busy || this.unconfirmed}
            @click=${this.#back}
          >
            ${t("find_bill.back")}</wt-button
          >
          ${
            methods.length === 0
              ? nothing
              : html`<wt-button
                  data-collect
                  variant="primary"
                  .loading=${this.busy}
                  .disabled=${this.busy || this.cashError}
                  @click=${() => this.#collect()}
                >
                  ${t("find_bill.confirm").replace("{amount}", amount)}</wt-button
                >`
          }
        </wt-form-actions>
      </div>
    </wt-dialog>`;
  }

  #methodFields(methods: readonly ("cash" | "card")[], amount: string) {
    return html`<div class="methods">
        ${
          methods.includes("cash")
            ? html`<wt-button
                data-cash
                variant=${this.method === "cash" ? "primary" : "secondary"}
                .disabled=${this.busy || this.unconfirmed}
                @click=${() => {
                  if (!this.isConnected || !this.active || this.busy || this.unconfirmed) return;
                  this.method = "cash";
                  this.#scope?.changed();
                }}
                >${t("find_bill.cash")}</wt-button
              >`
            : nothing
        }
        ${
          methods.includes("card")
            ? html`<wt-button
                data-card
                variant=${this.method === "card" ? "primary" : "secondary"}
                .disabled=${this.busy || this.unconfirmed}
                @click=${() => {
                  if (!this.isConnected || !this.active || this.busy || this.unconfirmed) return;
                  this.method = "card";
                  this.#scope?.changed();
                }}
                >${t("find_bill.card")}</wt-button
              >`
            : nothing
        }
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
              .disabled=${this.busy || this.unconfirmed}
              .error=${this.cashError ? t("find_bill.cash_short").replace("{amount}", amount) : ""}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                event.stopPropagation();
                if (!this.isConnected || !this.active || this.busy || this.unconfirmed) return;
                this.cash = event.detail.value;
                this.cashError = false;
                this.#scope?.changed();
              }}
            ></wt-price-input>`
          : html`<wt-input
                name="terminal-reference"
                .label=${t("find_bill.card_reference")}
                .value=${live(this.externalRef)}
                .disabled=${this.busy || this.unconfirmed}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  if (!this.isConnected || !this.active || this.busy || this.unconfirmed) return;
                  this.externalRef = event.detail.value;
                  this.#scope?.changed();
                }}
              ></wt-input
              >${outsideCardFields(
                this.outside,
                (value) => {
                  this.outside = value;
                  this.#scope?.changed();
                },
                this.busy || this.unconfirmed,
              )}`
      } `;
  }

  #errorText(bill: BillLookupRow): string {
    return typeof this.error === "string"
      ? t(this.error)
      : this.error
        ? "code" in this.error
          ? codeMessage(this.error.code)
          : "unsentBill" in this.error
            ? billUnsentText(bill.label ?? String(bill.orderNumber))
            : "clockUnusable" in this.error
              ? clockUnusableText(
                  this.error.clockUnusable.clockAt,
                  this.error.clockUnusable.offsetMinutes,
                )
              : overLimitText(this.error.overLimit)
        : this.cashError
          ? t("form.fix_fields")
          : "";
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-find-bill-dialog": TillFindBillDialog;
  }
}
