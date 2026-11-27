import { type TemplateResult, css, html, nothing } from "lit";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-menu-row.js";
import { actionChoiceStyles } from "@waitron/ui/src/components/wt-row-actions.js";
import { decimal, formatMoney, TABLE_SEPARATOR } from "@waitron/shared";
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

function isPaid(bill: PartyBill | undefined): boolean {
  return bill?.status === "settled" && bill.deferred !== true;
}

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

function billUnsentDetails(bill: PartyBill, party: TableParty, marked: boolean): TemplateResult {
  const unsent = party.unsentDrafts.filter((draft) => draft.billId === bill.workingOrderId);
  return html`${
    marked
      ? html`<span class="bill-unsent-mark" data-bill-row-unsent-mark
          >${unsentIcon}${t("floor.unsent_mark")}</span
        >`
      : nothing
  }
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

function billSheetHeading(party: TableParty): string {
  const words = { party: party.displayName };
  if (party.name !== null) return fill(t("table.bills_for_party"), words);
  const labels = party.displayName.split(TABLE_SEPARATOR);
  if (labels.some((label) => !/^\d+[a-z]?$/i.test(label)))
    return fill(t("table.bills_on_table"), words);
  return fill(
    t(labels.length === 1 ? "table.bills_on_numbered_table" : "table.bills_on_numbered_tables"),
    words,
  );
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
  const name = shown === undefined ? t("table.bills_title") : billLabel(shown);
  const amount = shown === undefined ? undefined : owes(shown);
  const position =
    shown !== undefined && bills.length > 1
      ? fill(t("table.bill_position"), { position: String(index + 1), count: String(bills.length) })
      : undefined;
  const heading = bottomSheet ? billSheetHeading(party) : undefined;
  const marked = othersUnsent(bills, party, billId, options.personId);
  const words = marked.length === 0 ? undefined : unsentWords(marked);
  const label = [
    amount === undefined ? name : `${t("table.bills_title")}: ${name}`,
    amount,
    position,
    words,
  ]
    .filter((piece) => piece !== undefined)
    .join(" · ");
  return html`<wt-row-actions
    class="bill-switcher"
    data-bill-switcher
    .bottomSheet=${bottomSheet}
    sheet-variant="menu"
    sheet-heading=${heading ?? nothing}
    opens-below
    label=${label}
  >
    <span slot="trigger" class="bill-switcher-trigger">
      <span class="bill-switcher-closed">
        <span class="bill-switcher-caption">
          <span class="bill-switcher-name">${name}</span>
          ${
            amount === undefined
              ? nothing
              : html`<span class="bill-switcher-amount"
                  >${amount}${
                    isPaid(shown)
                      ? html`<span data-paid-mark aria-hidden="true"> ✓</span>`
                      : nothing
                  }</span
                >`
          }
        </span>
        ${
          position === undefined
            ? nothing
            : html`<span class="bill-switcher-position">${position}</span>`
        }
        <wt-icon name="chevron-down" size="lg" aria-hidden="true"></wt-icon>
      </span>
      ${
        words === undefined
          ? nothing
          : html`<span class="bill-unsent-mark" data-unsent-mark>${unsentIcon}${words}</span>`
      }
    </span>
    <div role="menu" class="bill-switcher-menu" aria-label=${heading ?? nothing}>
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
            <wt-icon data-row-check name="check" size="lg" aria-hidden="true"></wt-icon>
            <wt-menu-row label=${billLabel(bill)} .value=${owes(bill)} .check=${isPaid(bill)}>
            </wt-menu-row>
            ${billUnsentDetails(bill, party, marked.includes(bill))}
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
        <wt-icon name="plus" size="lg" aria-hidden="true"></wt-icon>
        <wt-menu-row label=${t("table.new_bill_menu")}></wt-menu-row>
      </button>
    </div>
  </wt-row-actions>`;
}

export function billActions(
  heading: string,
  items: readonly (TemplateResult | typeof nothing)[],
): TemplateResult {
  return html`<wt-row-actions
    class="table-menu"
    data-table-menu
    align="end"
    opens-below
    label=${t("table.bill_actions")}
  >
    <div
      class="table-menu-group"
      data-table-menu-bill
      role="group"
      aria-labelledby="table-menu-bill"
    >
      <span id="table-menu-bill" class="table-menu-heading">${heading}</span>
      ${items}
    </div>
  </wt-row-actions>`;
}

export const billControlStyles = css`
  ${actionChoiceStyles}
  .bill-switcher::part(trigger) {
    min-height: var(--wt-tap-min);
    width: 100%;
    padding: var(--wt-space-1) var(--wt-space-2) var(--wt-space-1) var(--wt-space-3);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface);
    text-align: start;
  }
  .bill-switcher-menu {
    --wt-menu-row-height: var(--wt-tap-min);
  }
  .bill-switcher:not([bottom-sheet]) .bill-switcher-menu {
    --wt-menu-row-gap: var(--wt-space-3);
  }
  .bill-switcher[bottom-sheet] .bill-switcher-menu {
    --wt-menu-row-height: var(--wt-field-height);
  }
  .bill-switcher[bottom-sheet]::part(sheet) {
    padding-block-end: max(
      calc(var(--wt-space-4) + var(--wt-space-1)),
      env(safe-area-inset-bottom)
    );
  }
  .bill-switcher-menu [data-row-choice] {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0;
  }
  .bill-switcher-menu [data-switch-bill] {
    border-block-end-width: var(--wt-field-line-width);
    border-block-end-color: var(--wt-color-border);
    border-radius: 0;
  }
  .bill-switcher[bottom-sheet] [data-switch-bill] wt-menu-row {
    --wt-menu-row-height: calc(var(--wt-field-height) - var(--wt-field-line-width));
  }
  .bill-switcher-menu [data-switch-bill][aria-checked="true"]:not(:hover, :active) {
    background: transparent;
  }
  .bill-switcher-menu [data-row-choice]:focus-visible {
    outline-offset: calc(-1 * var(--wt-focus-offset));
  }
  .bill-switcher-menu wt-menu-row {
    --wt-menu-row-padding-start: var(--wt-space-2);
    --wt-menu-row-check-color: var(--wt-color-text-muted);
    --wt-font-size-md: var(--wt-menu-row-label-size);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .bill-switcher-menu wt-menu-row::part(trailing) {
    white-space: nowrap;
  }
  .bill-switcher-menu [data-row-choice] > wt-icon {
    --wt-action-native-icon-color: var(--wt-color-primary);
    margin-inline-start: var(--wt-menu-row-padding-start);
    color: var(--wt-action-native-icon-color);
  }
  .bill-switcher-menu [data-new-bill]:not([aria-disabled="true"]) {
    color: var(--wt-color-primary-text);
  }
  .bill-switcher-menu [data-new-bill] wt-menu-row,
  .bill-switcher-menu [data-new-bill][aria-disabled="true"] > wt-icon {
    color: inherit;
  }
  .bill-switcher-menu :is(.bill-row-unsent, .bill-unsent-mark) {
    grid-column: 2;
    margin-inline: var(--wt-space-2) var(--wt-space-4);
    padding-block-end: var(--wt-space-1);
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
  .bill-row-unsent {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
  .bill-switcher-trigger {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: var(--wt-space-1);
  }
  .bill-switcher-closed,
  .bill-switcher-caption {
    display: flex;
    align-items: center;
    gap: var(--wt-space-2);
    min-width: 0;
  }
  .bill-switcher-caption {
    align-items: baseline;
    flex-wrap: wrap;
    row-gap: 0;
    font-size: var(--wt-font-size-lg);
    overflow-wrap: anywhere;
  }
  .bill-switcher-name {
    font-weight: var(--wt-font-weight-bold);
  }
  .bill-switcher-amount,
  .bill-switcher-position {
    color: var(--wt-color-text-muted);
    font-weight: var(--wt-font-weight-normal);
    white-space: nowrap;
  }
  .bill-switcher-position {
    margin-inline-start: auto;
    font-size: var(--wt-font-size-sm);
  }
  .bill-switcher-closed > wt-icon {
    flex: none;
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
