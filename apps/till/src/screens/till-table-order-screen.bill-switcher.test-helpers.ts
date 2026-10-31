import { expect } from "vitest";
import { userEvent } from "vitest/browser";
import type { PartyBill, TableParty } from "../api/client.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

export const switcherParty: TableParty = {
  kitchenNote: { scope: { partyId: "v1" }, note: null, revision: 0, ownerRevision: 4 },
  id: "v1",
  revision: 4,
  guestCount: 3,
  state: "open",
  name: null,
  displayName: "4",
  openingBillId: "wo-1",
  outstanding: "38.50",
  billCount: 1,
  tableIds: ["t4"],
  unsentDrafts: [],
  reminder: null,
};

/** A bill of {@link switcherParty} owing `outstanding`. */
export function partyBill(
  workingOrderId: string,
  billNumber: number | null,
  outstanding: string,
  over: Partial<PartyBill> = {},
): PartyBill {
  return {
    workingOrderId,
    revision: 0,
    invoiceType: "F2",
    recipient: null,
    partyId: "v1",
    label: null,
    billNumber,
    billName: null,
    status: "open",
    total: outstanding,
    outstanding,
    hasPayments: false,
    receiptAvailable: false,
    ...over,
  };
}

const tableMenu = (el: TillTableOrderScreen) => el.shadowRoot!.querySelector("[data-table-menu]")!;

const tableMenuIsOpen = (el: TillTableOrderScreen) =>
  tableMenu(el).shadowRoot!.querySelector("[popover]")?.matches(":popover-open") ?? false;

async function tapTableMenu(el: TillTableOrderScreen): Promise<void> {
  await userEvent.click(tableMenu(el).shadowRoot!.querySelector<HTMLElement>("button")!);
  await el.updateComplete;
}

/** Opens the ⋮'s list, and fails unless it is open afterwards. */
export async function openTableMenu(el: TillTableOrderScreen): Promise<void> {
  expect(tableMenuIsOpen(el)).toBe(false);
  await tapTableMenu(el);
  expect(tableMenuIsOpen(el)).toBe(true);
}

/** Closes the ⋮'s list, and fails unless it is closed afterwards. */
export async function closeTableMenu(el: TillTableOrderScreen): Promise<void> {
  expect(tableMenuIsOpen(el)).toBe(true);
  await tapTableMenu(el);
  expect(tableMenuIsOpen(el)).toBe(false);
}

const billSwitcher = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector("[data-bill-switcher]")!;

const billSwitcherIsOpen = (el: TillTableOrderScreen) =>
  billSwitcher(el).shadowRoot!.querySelector("[popover]")?.matches(":popover-open") ?? false;

/** Opens the bill switcher, failing unless its list opens, and taps the bill's row. */
export async function switchToBill(
  el: TillTableOrderScreen,
  workingOrderId: string,
): Promise<void> {
  expect(billSwitcherIsOpen(el)).toBe(false);
  await userEvent.click(billSwitcher(el).shadowRoot!.querySelector<HTMLElement>("button")!);
  await el.updateComplete;
  expect(billSwitcherIsOpen(el)).toBe(true);
  await userEvent.click(
    billSwitcher(el).querySelector<HTMLElement>(`[data-switch-bill="${workingOrderId}"]`)!,
  );
  await el.updateComplete;
}

/** The text of the ⋮'s list and the bill switcher together. */
export const tableMenuAndSwitcherText = (el: TillTableOrderScreen): string =>
  [...el.shadowRoot!.querySelectorAll("[data-table-menu], [data-bill-switcher]")]
    .map((node) => node.textContent ?? "")
    .join("\n");
