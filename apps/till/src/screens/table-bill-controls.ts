import { type TemplateResult, css, html, nothing } from "lit";
import "@waitron/ui/src/components/wt-icon.js";
import {
  actionChoiceStyles,
  actionDividerStyles,
} from "@waitron/ui/src/components/wt-row-actions.js";
import { decimal, formatMoney } from "@waitron/shared";
import type { PartyBill, TableParty } from "../api/floor-api.js";
import { countText, currentLocale, fill, named, t } from "../i18n/t.js";
import { billLabel, billNumberLabel, shownBills } from "../state/bill-state.js";

function owes(bill: PartyBill): string {
  if (bill.deferred === true) return t("table.bill_deferred");
  if (bill.leftUnpaid && bill.status !== "settled") return t("departure.left_unpaid");
  if (bill.status === "settled") return t("table.bill_paid");
  return bill.overpaid === undefined
    ? formatMoney(decimal(bill.outstanding), currentLocale())
    : fill(t("table.bill_overpaid"), {
        amount: formatMoney(decimal(bill.overpaid), currentLocale()),
      });
}

/** The ✓ drawn after "Paid"; the word alone is what is read out. */
function paidMark(bill: PartyBill | undefined): TemplateResult | typeof nothing {
  return bill?.status === "settled" && bill.deferred !== true
    ? html`<span data-paid-mark aria-hidden="true"> ✓</span>`
    : nothing;
}

const chevron = html`<span aria-hidden="true"> ▾</span>`;

const unsentIcon = html`<wt-icon name="floor-unsent" aria-hidden="true"></wt-icon>`;

/** Slice 11, D2: the shown bills other than the one on screen holding this person's unsent dishes. */
function othersUnsent(
  bills: readonly PartyBill[],
  party: TableParty,
  billId: string | undefined,
  personId: string,
): PartyBill[] {
  return bills.filter(
    (bill) =>
      bill.workingOrderId !== billId &&
      party.unsentDrafts.some(
        (draft) =>
          draft.billId === bill.workingOrderId && draft.ownerId === personId && draft.lineCount > 0,
      ),
  );
}

/** "Bill 2 unsent", or "2 bills unsent" with several. */
function unsentWords(marked: readonly PartyBill[]): string {
  return marked.length === 1
    ? fill(t("table.unsent_bill"), { bill: billNumberLabel(marked[0]!) })
    : fill(t("table.unsent_bills"), { n: String(marked.length) });
}

/** One bill's row in the switcher: its short label, what it owes, and who has unsent dishes on it.
 * `marked` adds the Unsent mark after the label. */
export function billRowContent(bill: PartyBill, party: TableParty, marked = false): TemplateResult {
  const unsent = party.unsentDrafts.filter((draft) => draft.billId === bill.workingOrderId);
  return html`<span class="bill-row-head"
      ><span class="bill-row-label"
        >${billLabel(bill)}${
          marked
            ? html` <span class="bill-unsent-mark" data-bill-row-unsent-mark
                >${unsentIcon}${t("floor.unsent_mark")}</span
              >`
            : nothing
        }</span
      >
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

export interface BillSwitcherOptions {
  party: TableParty | null;
  bills: readonly PartyBill[];
  bottomSheet: boolean;
  /** The bill on screen. */
  billId: string | undefined;
  /** Who is signed in: another bill holding their unsent dishes is marked. */
  personId: string;
  /** + New bill is out, so it is drawn quiet and a tap on it does nothing. */
  newBillBusy: boolean;
  onSwitch(workingOrderId: string): void;
  onNewBill(): void;
}

/**
 * The drop-down naming the bill on screen, listing the party's shown bills in number order and,
 * always last, New bill. Drawn whenever there is a party, even with one bill or none.
 */
export function billSwitcher(options: BillSwitcherOptions): TemplateResult | typeof nothing {
  const { party, billId, bottomSheet } = options;
  if (party === null) return nothing;
  const bills = shownBills(options.bills);
  const index = bills.findIndex((bill) => bill.workingOrderId === billId);
  const shown = bills[index];
  const closed =
    shown === undefined ? t("table.bills_title") : `${billLabel(shown)} · ${owes(shown)}`;
  const position =
    shown !== undefined && bills.length > 1
      ? ` · ${fill(t("table.bill_position"), { position: String(index + 1), count: String(bills.length) })}`
      : "";
  const headingKey =
    party.name !== null
      ? "table.bills_for_party"
      : /^\d+$/.test(party.displayName)
        ? "table.bills_on_numbered_table"
        : "table.bills_on_table";
  const heading = bottomSheet ? fill(t(headingKey), { party: party.displayName }) : undefined;
  const marked = othersUnsent(bills, party, billId, options.personId);
  const words = marked.length === 0 ? undefined : unsentWords(marked);
  const label = shown === undefined ? closed : `${t("table.bills_title")}: ${closed}${position}`;
  return html`<wt-row-actions
    class="bill-switcher"
    data-bill-switcher
    .bottomSheet=${bottomSheet}
    opens-below
    label=${words === undefined ? label : `${label} · ${words}`}
  >
    <span slot="trigger" class="bill-switcher-trigger"
      ><span class="bill-switcher-closed"
        ><span data-bill-switcher-label>${closed}${paidMark(shown)}${position}</span
        >${chevron}</span
      >${
        words === undefined
          ? nothing
          : html` <span class="bill-unsent-mark" data-unsent-mark>${unsentIcon}${words}</span>`
      }</span
    >
    <div
      role="menu"
      class="bill-switcher-menu"
      aria-labelledby=${heading === undefined ? nothing : "bill-switcher-heading"}
    >
      ${
        heading === undefined
          ? nothing
          : html`<div id="bill-switcher-heading" class="table-menu-heading" role="presentation">
              ${heading}
            </div>`
      }
      ${bills.map(
        (bill) =>
          html`<button
            type="button"
            role="menuitemradio"
            data-row-choice
            data-switch-bill=${bill.workingOrderId}
            aria-checked=${bill.workingOrderId === billId ? "true" : "false"}
            @click=${() => {
              if (bill.workingOrderId !== billId) options.onSwitch(bill.workingOrderId);
            }}
          >
            <wt-icon data-row-check name="menu-check" size="lg"></wt-icon>
            <span class="bill-row-details"
              >${billRowContent(bill, party, marked.includes(bill))}</span
            >
          </button>`,
      )}
      <button
        type="button"
        role="menuitem"
        data-row-choice
        data-new-bill
        aria-disabled=${options.newBillBusy ? "true" : nothing}
        @click=${() => {
          if (!options.newBillBusy) options.onNewBill();
        }}
      >
        <wt-icon name="menu-add" size="lg"></wt-icon>
        ${t("table.new_bill_menu")}
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
    opens-below
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
  ${actionChoiceStyles}
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
  .bill-row-details {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: var(--wt-space-1);
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
    ${actionDividerStyles}
  }
  .bill-row-unsent {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
  .bill-switcher-trigger {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: var(--wt-space-2);
  }
  .bill-switcher-closed {
    white-space: nowrap;
  }
  .bill-unsent-mark {
    display: inline-flex;
    align-items: center;
    gap: var(--wt-space-1);
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-normal);
  }
`;
