import { type TemplateResult, css, html, nothing } from "lit";
import "@waitron/ui/src/components/wt-button.js";
import { decimal, formatMoney, isZeroDecimal } from "@waitron/shared";
import type { BillBalance, PartyBill } from "../api/client.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { billNumberLabel, overpaidOf } from "../state/bill-state.js";

/** "Being paid on Bill 3" while the bill's chosen items wait for their card on a bill of their own. */
export function beingPaidNotice(balance: BillBalance | null): TemplateResult | typeof nothing {
  const on = balance?.beingPaidOn;
  if (on === undefined) return nothing;
  return html`<p class="bill-money-notice" role="status" data-being-paid-on>
    ${fill(t("table.being_paid_on"), { bill: billNumberLabel(on) })}
  </p>`;
}

export interface OverpaidNotice {
  balance: Pick<BillBalance, "overpaid" | "total"> | null;
  tipsEnabled: boolean;
  /** A Keep as tip is unanswered: both choices wait for it. */
  busy: boolean;
  onGiveBack: (excess: string) => void;
  onKeepAsTip: (excess: string) => void;
}

/** What the bill was paid over its total, with Give back and, while the venue takes tips, Keep as
 * tip. A bill that comes to nothing has no sale to tip on, so it is only given back. */
export function overpaidNotice(notice: OverpaidNotice): TemplateResult | typeof nothing {
  const excess = overpaidOf(notice.balance);
  if (excess === null) return nothing;
  const amount = formatMoney(decimal(excess), currentLocale());
  return html`<div class="bill-money-notice" role="status" data-overpaid>
    <p>${fill(t("table.overpaid"), { amount })}</p>
    <div class="bill-money-actions">
      <wt-button
        variant="secondary"
        size="sm"
        data-give-back
        ?disabled=${notice.busy}
        @click=${() => notice.onGiveBack(excess)}
        >${fill(t("table.give_back"), { amount })}</wt-button
      >
      ${
        notice.tipsEnabled && !isZeroDecimal(decimal(notice.balance!.total))
          ? html`<wt-button
              variant="secondary"
              size="sm"
              data-keep-as-tip
              ?disabled=${notice.busy}
              @click=${() => notice.onKeepAsTip(excess)}
              >${fill(t("table.keep_as_tip"), { amount })}</wt-button
            >`
          : nothing
      }
    </div>
  </div>`;
}

/** Finish table's refusal when what stops it is a bill paid more than it comes to: that bill's
 * excess is given back, or kept as a tip, on the bill itself. `go` is absent for the bill on screen,
 * whose own notice offers both. */
export function finishOverpaidRefusal(
  bill: PartyBill,
  keepsTips: boolean,
  go?: () => void,
): TemplateResult {
  const name = billNumberLabel(bill);
  const words =
    keepsTips && !isZeroDecimal(decimal(bill.total))
      ? t("table.finish_overpaid")
      : t("table.finish_overpaid_give_back");
  const amount = formatMoney(decimal(overpaidOf(bill) ?? "0"), currentLocale());
  return html`<div class="finish-refusal" role="alert" data-finish-refusal>
    <span>${fill(words, { bill: name, amount })}</span>
    ${
      go === undefined
        ? nothing
        : html`<div class="finish-refusal-actions">
            <wt-button size="sm" variant="primary" data-show-overpaid-bill @click=${go}
              >${fill(t("table.go_to_bill"), { bill: name })}</wt-button
            >
          </div>`
    }
  </div>`;
}

export const billMoneyNoticeStyles = css`
  .bill-money-notice {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-2);
    margin: var(--wt-space-2) 0 0;
    padding: var(--wt-space-2) var(--wt-space-3);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
  }

  .bill-money-notice p {
    margin: 0;
  }

  .bill-money-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--wt-space-2);
  }
`;
