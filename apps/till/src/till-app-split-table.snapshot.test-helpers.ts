import { expect, vi } from "vitest";
import type { BillBalance, PartyBill, SplitSources, TabLine } from "./api/client.js";
import { partyBill } from "./screens/till-table-order-screen.bill-switcher.test-helpers.js";
import type { TillApp } from "./till-app.js";
import type { TillSplitPicker } from "./widgets/split-picker.js";
import {
  api,
  emit,
  floor,
  lock,
  mountApp,
  party,
  server,
  shell,
  table,
  table7,
  tableOrder,
} from "../test/allergy-app-fixture.js";

export async function flush(el: TillApp, rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await vi.advanceTimersByTimeAsync(0);
    await el.updateComplete;
  }
}

export function dish(id: string, lineNo: number, name = id): TabLine {
  return {
    id,
    lineNo,
    stationId: "bar",
    changesAfterSending: null,
    movable: true,
    name,
    productId: id,
    parentProductId: null,
    parentLineNo: null,
    quantity: "1.000",
    priceQuantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "10.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    groupId: null,
    note: null,
    listId: null,
    menuItemId: `offer-${id}`,
    portion: true,
  };
}

export function balance(workingOrderId: string, total: string): BillBalance {
  return {
    workingOrderId,
    status: "open",
    total,
    received: "0.00",
    reserved: "0.00",
    outstanding: total,
    tips: "0.00",
    payments: [],
    paidLines: [],
  };
}

export const lost = () => new TypeError("Failed to fetch");

export const atFloor = (revision: number, over: Parameters<typeof party>[0] = {}) => {
  const held = party({ tableIds: ["t4", "t5"], billCount: 2, revision, ...over });
  return [table("t4", "4", held), table("t5", "5", held), table7];
};

/** One sources answer: Bill 2 at `total`, with the party's revision the server read beside it. */
export const rowsAt = (
  partyRevision: number,
  total: string,
  more: string[] = [],
): SplitSources => ({
  partyRevision,
  bills: [
    { billId: "wo-4", lines: [dish("soup", 1)], balance: balance("wo-4", "10.00") },
    { billId: "b2", lines: [dish("steak", 1)], balance: balance("b2", total) },
    ...more.map((billId) => ({
      billId,
      lines: [dish(`dish-${billId}`, 1)],
      balance: balance(billId, "5.00"),
    })),
  ],
});

export const listAt = (total: string, revision: number, more: string[] = []): PartyBill[] => [
  partyBill("wo-4", 1, "10.00"),
  partyBill("b2", 2, total, { revision }),
  ...more.map((billId, index) => partyBill(billId, 3 + index, "5.00")),
];

/** Calls that wait, in order, until a case answers or fails each of them. */
export function held<T>() {
  const calls: { answer: (value: T) => void; fail: () => void }[] = [];
  const read = () =>
    new Promise<T>((resolve, reject) =>
      calls.push({ answer: resolve, fail: () => reject(lost()) }),
    );
  return { calls, read };
}

export const q = <T extends HTMLElement = HTMLElement>(el: TillApp, selector: string) =>
  tableOrder(el)!.shadowRoot!.querySelector<T>(selector);
export const picker = (el: TillApp) => q<TillSplitPicker>(el, "till-split-picker");
export const splitButton = (el: TillApp) =>
  q<HTMLElementTagNameMap["wt-button"]>(el, "[data-split-confirm]");
export const takes = (el: TillApp) => q(el, "[data-split-takes]")?.textContent ?? "";
export const said = (el: TillApp) => q(el, "[data-split-refusal]")?.textContent?.trim() ?? null;
export const panelOpen = (el: TillApp) => q(el, "[data-split-pick]") !== null;
export const sent = (call: number) => api.splitTable!.mock.calls[call]![3];
export const tickBox = (el: TillApp, billId: string) =>
  picker(el)!.shadowRoot!.querySelector<HTMLInputElement>(`[data-split-tick="${billId}"]`);

export async function press(el: TillApp, selector: string): Promise<void> {
  q(el, selector)!.click();
  await flush(el);
}

export async function toPanel(el: TillApp): Promise<void> {
  await press(el, "[data-move-split]");
  await press(el, '[data-action="split-table"]');
  await press(el, '[data-target="t5"]');
}

export async function tick(el: TillApp, billId: string): Promise<void> {
  tickBox(el, billId)!.click();
  await flush(el);
}

export async function mounted(over: Record<string, unknown>): Promise<TillApp> {
  server.bills.add("wo-4");
  server.bills.add("b2");
  const { el } = await mountApp({
    getTablesState: vi.fn().mockResolvedValue(atFloor(3)),
    getPartyBills: vi.fn().mockResolvedValue(listAt("20.00", 0)),
    getSplitSources: vi.fn().mockResolvedValue(rowsAt(3, "20.00")),
    splitTable: vi.fn().mockResolvedValue({ partyId: "v-split", billIds: ["b2"] }),
    ...over,
  });
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
  await flush(el);
  emit(shell(el), "screen-select", { screen: "floor" });
  await flush(el);
  emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
  await flush(el);
  return el;
}

export async function billTwoTicked(over: Record<string, unknown> = {}): Promise<TillApp> {
  const el = await mounted(over);
  await toPanel(el);
  await tick(el, "b2");
  expect(takes(el)).toContain("20.00");
  return el;
}

export async function timedRead(el: TillApp): Promise<void> {
  await vi.advanceTimersByTimeAsync(15_000);
  await flush(el);
}

/** Moves the ticked bill's edit state once `moved.now` is set, so the till's own stop at Send runs on
 * the next press. */
export function draftsMoving() {
  const moved = { now: false };
  const listDrafts = vi.fn(async (partyId: string) => {
    const snapshot = await server.listDrafts(partyId);
    return moved.now
      ? {
          ...snapshot,
          billEdits: snapshot.billEdits.map((edit) =>
            edit.billId === "b2" ? { ...edit, editorVersion: 2 } : edit,
          ),
        }
      : snapshot;
  });
  return { moved, listDrafts };
}

export async function refreshDrafts(el: TillApp): Promise<void> {
  window.dispatchEvent(new Event("focus"));
  await flush(el);
}

/**
 * The ruling, for a case whose rows say which read they came from by Bill 2's amount: Split can be
 * pressed, and the press carries the revision of the rows on screen.
 */
export async function expectPressCarriesTheRows(
  el: TillApp,
  revisionOfAmount: Record<string, number>,
): Promise<void> {
  const shown = /€(\d+\.\d\d)/.exec(takes(el))?.[1];
  expect(shown === undefined ? undefined : Object.keys(revisionOfAmount)).toContain(shown);
  expect(splitButton(el)!.disabled).toBe(false);
  const before = api.splitTable!.mock.calls.length;
  await press(el, "[data-split-confirm]");
  await flush(el);
  expect(api.splitTable!.mock.calls.length).toBe(before + 1);
  expect(sent(before)).toBe(revisionOfAmount[shown!]);
}
