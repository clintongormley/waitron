import { css, html, nothing } from "lit";
import { formatMoney } from "@waitron/shared";
import type { TransactionRow } from "../api/find-bill-types.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import "@waitron/ui/src/components/wt-icon.js";

const label = (key: string) => t(`find_page.${key}` as StringKey);

function venueDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function rowTime(issuedAt: string, timeZone: string): string {
  const now = new Date();
  const at = new Date(issuedAt);
  const days =
    (Date.parse(venueDay(now, timeZone)) - Date.parse(venueDay(at, timeZone))) / 86_400_000;
  const locale = currentLocale();
  if (days === 0)
    return at.toLocaleTimeString(locale, { timeZone, hour: "2-digit", minute: "2-digit" });
  if (days > 0 && days <= 6) return at.toLocaleDateString(locale, { timeZone, weekday: "short" });
  return at.toLocaleDateString(locale, { timeZone, day: "2-digit", month: "2-digit" });
}

function place(row: TransactionRow): string {
  if (row.tableName) return row.tableName;
  if (row.orderNumber !== null)
    return [row.zoneName, fill(label("order_number"), { number: String(row.orderNumber) })]
      .filter(Boolean)
      .join(" · ");
  return row.customerName ?? "—";
}

function wayIcon(row: TransactionRow): string | null {
  if (row.type === "refund") return "undo";
  const method = row.methods[0]?.method;
  return method === "card" || method === "cash" ? method : null;
}

function ways(row: TransactionRow): string {
  const paid = row.methods
    .map((way, index) => {
      const prefix = index === 0 ? "" : "joined_";
      return way.method === "card" && way.last4
        ? fill(label(`${prefix}card_digits`), { last4: way.last4 })
        : label(`${prefix}${way.method}`);
    })
    .join(", ");
  return [paid || label("unpaid"), row.staff?.name].filter(Boolean).join(" · ");
}

function detail(row: TransactionRow, shownPlace: string): string {
  const invoice = row.type === "full-invoice" || row.type === "full-correction";
  return invoice && row.customerName && row.customerName !== shownPlace
    ? row.customerName
    : ways(row);
}

function receiptNumber(number: string) {
  const series = number.lastIndexOf("/") + 1;
  if (series === 0) return html`<span class="whole">${number}</span>`;
  return html`<span class="whole">${number.slice(0, series)}</span><wbr /><span class="whole"
      >${number.slice(series)}</span
    >`;
}

export function findBillRow(
  row: TransactionRow,
  options: { timeZone: string; disabled: boolean; open: () => void },
) {
  const where = place(row);
  const icon = wayIcon(row);
  const amount = formatMoney(row.amount, currentLocale()).replace("-", "\u2212");
  return html`<button
    type="button"
    class="sale"
    data-transaction=${row.transactionId}
    ?disabled=${options.disabled}
    @click=${options.open}
  >
    <span class="time" data-time>${rowTime(row.issuedAt, options.timeZone)}</span>
    <span class="place" data-place>${where}</span>
    <span class="amount" data-amount
      >${row.amountMatch === "amount" ? html`<span class="hl">${amount}</span>` : amount}</span
    >
    <span class="way" data-way>
      ${icon ? html`<wt-icon name=${icon} size="lg" aria-hidden="true"></wt-icon>` : nothing}
      ${row.type === "sale" ? nothing : html`<span class="tag" data-tag>${label(row.type)}</span>`}
      <span class="detail">${detail(row, where)}</span>
    </span>
    <span class="number" data-number>${receiptNumber(row.invoiceNumber)}</span>
  </button>`;
}

export const findBillRowStyles = css`
  .sale {
    display: grid;
    grid-template-columns:
      calc(var(--wt-space-6) + var(--wt-space-4))
      minmax(calc(3 * var(--wt-space-6)), 1fr)
      auto;
    column-gap: calc(var(--wt-space-2) + var(--wt-space-1) / 2);
    row-gap: calc(var(--wt-space-1) / 2);
    align-items: center;
    inline-size: 100%;
    min-block-size: var(--wt-tap-min);
    padding: calc(var(--wt-space-2) + var(--wt-space-1) / 2)
      calc(var(--wt-space-3) + var(--wt-space-1) / 2);
    border: 0;
    border-block-end: var(--wt-field-line-width) solid var(--wt-color-border);
    background: var(--wt-color-surface);
    color: var(--wt-color-text);
    font: inherit;
    font-size: var(--wt-font-size-md);
    text-align: start;
    cursor: pointer;
  }
  .sale:disabled {
    cursor: not-allowed;
  }
  .sale:not(:disabled):is(:hover, :active) {
    background: var(--wt-color-field-fill);
  }
  .sale:focus-visible {
    outline: var(--wt-focus-ring);
    outline-offset: calc(-1 * var(--wt-focus-offset));
  }
  .time {
    color: var(--wt-color-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .place {
    min-inline-size: 0;
    overflow-wrap: anywhere;
    font-weight: var(--wt-font-weight-bold);
  }
  .amount {
    justify-self: end;
    font-variant-numeric: tabular-nums;
    font-weight: var(--wt-font-weight-bold);
    white-space: nowrap;
  }
  .hl {
    padding-inline: calc(var(--wt-space-1) / 2);
    border-radius: var(--wt-radius-sm);
    background: var(--wt-color-surface-lifted);
    color: var(--wt-color-text);
  }
  .way {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-1);
    min-inline-size: 0;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
  .way wt-icon {
    flex: none;
  }
  .detail {
    min-inline-size: 0;
    overflow-wrap: anywhere;
  }
  .tag {
    min-inline-size: 0;
    overflow-wrap: anywhere;
    padding: calc(var(--wt-space-1) / 4) calc(var(--wt-space-1) + var(--wt-space-1) / 2);
    border-radius: var(--wt-radius-full);
    background: var(--wt-color-surface-sunken);
    color: var(--wt-color-text);
    font-weight: var(--wt-font-weight-bold);
  }
  .number {
    grid-column: 3;
    justify-self: end;
    text-align: end;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
  .whole {
    white-space: nowrap;
  }
`;
