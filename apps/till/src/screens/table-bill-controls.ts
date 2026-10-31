import { type TemplateResult, css, html, nothing } from "lit";
import { decimal, formatMoney } from "@waitron/shared";
import type { PartyBill, TableParty } from "../api/client.js";
import { countText, currentLocale, fill, named, t } from "../i18n/t.js";
import { billLabel, billNumberLabel, shownBills } from "../state/bill-state.js";

/** What a bill still owes, or "Paid" once it is settled. */
function owes(bill: PartyBill): string {
  return bill.status === "settled"
    ? t("table.bill_paid")
    : formatMoney(decimal(bill.outstanding), currentLocale());
}

/** The ✓ drawn after "Paid"; the word alone is what is read out. */
function paidMark(bill: PartyBill | undefined): TemplateResult | typeof nothing {
  return bill?.status === "settled"
    ? html`<span data-paid-mark aria-hidden="true"> ✓</span>`
    : nothing;
}

const chevron = html`<span aria-hidden="true"> ▾</span>`;

/** One bill's row in the switcher: its short label, what it owes, and who has unsent dishes on it. */
export function billRowContent(bill: PartyBill, party: TableParty): TemplateResult {
  const unsent = party.unsentDrafts.filter((draft) => draft.billId === bill.workingOrderId);
  return html`<span class="bill-row-head"
      ><span class="bill-row-label">${billLabel(bill)}</span>
      <span class="bill-row-owes">${owes(bill)}${paidMark(bill)}</span></span
    >
    ${unsent.map(
      (draft) =>
        html`<span class="bill-row-unsent"
          >${named(
            draft.ownerName,
            countText(draft.lineCount, "floor.unsent_owner", "floor.unsent_owner_one"),
            countText(draft.lineCount, "floor.unsent", "floor.unsent_one"),
          )}</span
        >`,
    )}`;
}

/** "Bill 1 · €38.50"; with several bills "Bill 2 of 3 · Clint · €54.00"; "Bills" with none shown. */
function closedLabel(bills: readonly PartyBill[], shown: PartyBill | undefined): string {
  if (shown === undefined) return t("table.bills_title");
  const number = billNumberLabel(shown);
  return [
    bills.length > 1
      ? fill(t("table.bill_count"), { bill: number, count: String(bills.length) })
      : number,
    ...(shown.billName === null ? [] : [shown.billName]),
    owes(shown),
  ].join(" · ");
}

export interface BillSwitcherOptions {
  party: TableParty | null;
  bills: readonly PartyBill[];
  /** The bill on screen. */
  billId: string | undefined;
  /** + New bill is out, so it is drawn quiet and a tap on it does nothing. */
  newBillBusy: boolean;
  onSwitch(workingOrderId: string): void;
  onNewBill(): void;
}

/**
 * The drop-down naming the bill on screen, listing the party's shown bills in number order and,
 * always last, + New bill. Drawn whenever there is a party, even with one bill or none.
 */
export function billSwitcher(options: BillSwitcherOptions): TemplateResult | typeof nothing {
  const { party, billId } = options;
  if (party === null) return nothing;
  const bills = shownBills(options.bills);
  const shown = bills.find((bill) => bill.workingOrderId === billId);
  const closed = closedLabel(bills, shown);
  return html`<wt-row-actions
    class="bill-switcher"
    data-bill-switcher
    label=${shown === undefined ? closed : `${t("table.bills_title")}: ${closed}`}
  >
    <span slot="trigger"
      ><span data-bill-switcher-label>${closed}</span>${paidMark(shown)}${chevron}</span
    >
    <div role="menu" class="bill-switcher-menu">
      ${bills.map(
        (bill) =>
          html`<button
            type="button"
            role="menuitemradio"
            class="bill-switcher-item"
            data-switch-bill=${bill.workingOrderId}
            aria-checked=${bill.workingOrderId === billId ? "true" : "false"}
            @click=${() => {
              if (bill.workingOrderId !== billId) options.onSwitch(bill.workingOrderId);
            }}
          >
            ${billRowContent(bill, party)}
          </button>`,
      )}
      <button
        type="button"
        role="menuitem"
        class="bill-switcher-item"
        data-new-bill
        aria-disabled=${options.newBillBusy ? "true" : nothing}
        @click=${() => {
          if (!options.newBillBusy) options.onNewBill();
        }}
      >
        ${t("table.new_bill")}
      </button>
    </div>
  </wt-row-actions>`;
}

export interface TableMenuOptions {
  /** The bill section's heading: the bill on screen's short label. Left out when undefined. */
  billHeading: string | undefined;
  billItems: readonly (TemplateResult | typeof nothing)[];
  tableItems: readonly (TemplateResult | typeof nothing)[];
}

/** The table screen's one ⋮: what acts on the bill on screen, under its label, then what acts on
 * the whole table. */
export function tableMenu(options: TableMenuOptions): TemplateResult {
  return html`<wt-row-actions
    class="table-menu"
    data-table-menu
    data-move-split
    align="end"
    label=${t("table.actions_title")}
  >
    ${
      options.billHeading === undefined
        ? nothing
        : html`<div
              class="table-menu-group"
              data-table-menu-bill
              role="group"
              aria-labelledby="table-menu-bill"
            >
              <span id="table-menu-bill" class="table-menu-heading">${options.billHeading}</span>
              ${options.billItems}
            </div>
            <hr class="table-menu-rule" />`
    }
    <div
      class="table-menu-group"
      data-table-menu-table
      role="group"
      aria-labelledby="table-menu-table"
    >
      <span id="table-menu-table" class="table-menu-heading">${t("table.whole_table")}</span>
      ${options.tableItems}
    </div>
  </wt-row-actions>`;
}

export const billControlStyles = css`
  .bill-switcher::part(trigger) {
    min-height: var(--wt-tap-min);
    padding: var(--wt-space-2) var(--wt-space-3);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface);
    font-weight: var(--wt-font-weight-bold);
  }
  .bill-switcher-menu {
    display: flex;
    flex-direction: column;
  }
  .bill-switcher-item {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--wt-space-1);
    min-height: var(--wt-tap-min);
    padding: var(--wt-space-2) var(--wt-space-3);
    border: 1px solid transparent;
    border-radius: var(--wt-radius-md);
    background: transparent;
    color: var(--wt-color-text);
    font: inherit;
    cursor: pointer;
    text-align: start;
  }
  /* The open list is painted --wt-color-surface, which --wt-color-surface-raised equals in the
     light theme. */
  .bill-switcher-item:hover {
    background: var(--wt-color-bg);
  }
  .bill-switcher-item[aria-checked="true"] {
    border-color: var(--wt-color-border);
    background: var(--wt-color-surface-lifted);
  }
  .bill-switcher-item[aria-disabled="true"] {
    color: var(--wt-color-text-muted);
    background: transparent;
    cursor: not-allowed;
  }
  .bill-switcher-item:focus-visible {
    outline: var(--wt-focus-ring);
    outline-offset: var(--wt-focus-offset);
  }
  .bill-row-head {
    display: flex;
    justify-content: space-between;
    gap: var(--wt-space-3);
  }
  .table-menu-group {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-1);
  }
  .table-menu-heading {
    padding: var(--wt-space-1) var(--wt-space-4);
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
  .table-menu-rule {
    align-self: stretch;
    margin: 0;
    border: 0;
    border-block-start: 1px solid var(--wt-color-border);
  }
  .bill-row-unsent {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
`;
