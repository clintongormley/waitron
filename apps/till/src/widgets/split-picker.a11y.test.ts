import { afterEach, describe, expect, it } from "vitest";
import { decimal, formatMoney } from "@waitron/shared";
import type { BillBalance, PartyBill, TabLine } from "../api/client.js";
import { currentLocale } from "../i18n/t.js";
import { billGross } from "../state/adjust-target.js";
import { paidQuantities } from "../state/bill-payment.js";
import { tabLinePortionKey } from "../state/portion-groups.js";
import { pickGroups } from "../state/portion-selection.js";
import type { SplitPicks, SplitSource } from "../state/split-selection.js";
import "./split-picker.js";
import type { TillSplitPicker } from "./split-picker.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";

function line(id: string, lineNo: number, over: Partial<TabLine> = {}): TabLine {
  return {
    id,
    lineNo,
    stationId: "bar",
    changesAfterSending: null,
    movable: true,
    name: "Beer",
    productId: "beer",
    parentProductId: null,
    parentLineNo: null,
    quantity: "1.000",
    priceQuantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "5.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    groupId: null,
    note: null,
    listId: null,
    menuItemId: "offer-beer",
    portion: true,
    ...over,
  };
}

const DISHES = [
  line("c1", 1),
  line("c2", 2),
  line("c3", 3),
  line("h1", 4, { name: "Ham", productId: "ham", menuItemId: "ham", unitPriceGross: "9.00" }),
];

function source(
  over: {
    status?: PartyBill["status"];
    received?: string;
    paid?: string[];
    held?: SplitSource["held"];
    ownUnsent?: boolean;
  } = {},
): SplitSource {
  const balance: BillBalance = {
    workingOrderId: "b1",
    status: over.status ?? "open",
    total: billGross(DISHES),
    received: over.received ?? "0.00",
    reserved: "0.00",
    outstanding: "0.00",
    tips: "0.00",
    payments: [],
    paidLines: (over.paid ?? []).map((lineId) => ({
      lineId,
      lineNo: DISHES.find((row) => row.id === lineId)!.lineNo,
      paidQuantity: "1.000",
    })),
  };
  const keyOf = (row: TabLine) =>
    tabLinePortionKey(row, DISHES, paidQuantities(balance).get(row.lineNo) ?? null);
  return {
    bill: {
      workingOrderId: "b1",
      revision: 0,
      invoiceType: "F2",
      recipient: null,
      partyId: "party",
      label: null,
      billNumber: 1,
      billName: null,
      status: over.status ?? "open",
      total: balance.total,
      outstanding: balance.total,
      hasPayments: false,
      receiptAvailable: false,
    },
    groups: pickGroups(DISHES, keyOf, balance),
    held: over.held ?? null,
    ownUnsent: over.ownUnsent ?? false,
    refundPending: false,
  };
}

const NOTHING: SplitPicks = { whole: new Set(), picks: new Map() };
const WHOLE: SplitPicks = { whole: new Set(["b1"]), picks: new Map() };
const SOME: SplitPicks = { whole: new Set(), picks: new Map([["b1", new Set(["c1", "c2"])]]) };
const luis = { draftId: "draft-luis", revision: 1, ownerName: "Luis", takenFromYou: false };
const money = (amount: string) => formatMoney(decimal(amount), currentLocale());

const STATES: [string, SplitSource, SplitPicks][] = [
  ["nothing ticked", source(), NOTHING],
  ["a whole bill", source(), WHOLE],
  ["some, with a stepped row", source(), SOME],
  ["part-paid, with a paid row", source({ received: "9.00", paid: ["h1"] }), NOTHING],
  ["whole and part-paid, with a paid row", source({ received: "9.00", paid: ["h1"] }), WHOLE],
  ["presented", source({ status: "placed" }), NOTHING],
  ["held", source({ held: luis }), NOTHING],
  ["held and selected", source({ held: luis }), WHOLE],
  ["this person's unsent dishes", source({ ownUnsent: true }), NOTHING],
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-split-picker a11y (%s theme)", (theme) => {
  it.each(STATES)("%s has no violations", async (_name, one, split) => {
    const { host } = await mountWidget<TillSplitPicker>(
      "till-split-picker",
      { sources: [one], split, nameOf: (dish: TabLine) => dish.name ?? "", money },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it.each(STATES)("%s has no violations with every dish marked", async (_name, one, split) => {
    const { host } = await mountWidget<TillSplitPicker>(
      "till-split-picker",
      {
        sources: [one],
        split,
        nameOf: (dish: TabLine) => dish.name ?? "",
        money,
        markOf: () => "Held · Mains",
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("a held bill's disabled tick is the picker's visible box, and says why in words", async () => {
    const { el } = await mountWidget<TillSplitPicker>(
      "till-split-picker",
      { sources: [source({ held: luis })], split: NOTHING, money },
      theme,
    );
    const tick = el.shadowRoot!.querySelector<HTMLInputElement>('input[data-split-tick="b1"]')!;
    expect(tick.disabled).toBe(true);
    expect(getComputedStyle(tick).appearance).toBe("none");
    const reason = el.shadowRoot!.getElementById(tick.getAttribute("aria-describedby")!)!;
    expect(reason.getBoundingClientRect().height).toBeGreaterThan(0);
  });
});
