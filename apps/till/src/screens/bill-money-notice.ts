import { type TemplateResult, css, html, nothing } from "lit";
import "@waitron/ui/src/components/wt-button.js";
import { compareDecimal, decimal, formatMoney } from "@waitron/shared";
import type { BillBalance } from "../api/client.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { billNumberLabel } from "../state/bill-state.js";
import { overpaidOf } from "../state/pay-for-items.js";

const ZERO = decimal("0.00");

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
        notice.tipsEnabled && compareDecimal(decimal(notice.balance!.total), ZERO) !== 0
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
