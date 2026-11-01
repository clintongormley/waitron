import { afterEach, describe, it } from "vitest";
import { decimal, formatMoney } from "@waitron/shared";
import type { BillBalance, TabLine } from "../api/client.js";
import { currentLocale } from "../i18n/t.js";
import { paidQuantities } from "../state/bill-payment.js";
import { tabLinePortionKey } from "../state/portion-groups.js";
import { pickRows, type PickRow, type Picks } from "../state/portion-selection.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./portion-picker.js";
import type { TillPortionPicker } from "./portion-picker.js";

function line(id: string, lineNo: number, over: Partial<TabLine> = {}): TabLine {
  return {
    id,
    lineNo,
    stationId: "bar",
    changesAfterSending: null,
    movable: true,
    name: "Caña",
    productId: "cana",
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
    menuItemId: "offer-cana",
    portion: true,
    ...over,
  };
}

function balance(total: string, received: string, paidLines: BillBalance["paidLines"] = []) {
  return {
    workingOrderId: "bill-1",
    status: "open",
    total,
    received,
    reserved: "0.00",
    outstanding: "0.00",
    tips: "0.00",
    payments: [],
    paidLines,
  } satisfies BillBalance;
}

const CANAS = [line("c1", 1), line("c2", 2), line("c3", 3), line("c4", 4)];
const WEIGHED = line("w1", 9, {
  name: "Pulpo",
  productId: "pulpo",
  menuItemId: "pulpo",
  quantity: "0.350",
  priceQuantity: "0.350",
  unitPrecision: 3,
  unitPriceGross: "40.00",
});
const STEAK = line("s1", 5, {
  name: "Steak",
  productId: "steak",
  menuItemId: "steak",
  unitPriceGross: "32.00",
});

const STATES: [string, readonly TabLine[], BillBalance | null, Picks][] = [
  ["an empty list", [], null, new Set()],
  ["a grouped row, unticked", CANAS, null, new Set()],
  ["a grouped row ticked at 2 of 4", CANAS, null, new Set(["c1", "c2"])],
  ["a weighed row", [WEIGHED], null, new Set(["w1"])],
  [
    "a paid row",
    [line("k1", 1), line("k2", 2)],
    balance("10.00", "5.00", [{ lineId: "k1", lineNo: 1, paidQuantity: "1.000" }]),
    new Set(),
  ],
  ["a floor-blocked row", [...CANAS, STEAK], balance("52.00", "40.00"), new Set(["c1", "c2"])],
];

function rowsOf(lines: readonly TabLine[], paid: BillBalance | null, picks: Picks): PickRow[] {
  const keyOf = (row: TabLine) =>
    tabLinePortionKey(
      row,
      lines,
      paid === null ? null : (paidQuantities(paid).get(row.lineNo) ?? null),
    );
  return pickRows(lines, keyOf, paid, new Set(), picks);
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("A803 picker a11y (%s theme)", (theme) => {
  it.each(STATES)("%s has no violations", async (_name, lines, paid, picks) => {
    const { host } = await mountWidget<TillPortionPicker>(
      "till-portion-picker",
      {
        rows: rowsOf(lines, paid, picks),
        picks,
        nameOf: (row: PickRow) => row.members[0]!.name ?? "",
        money: (amount: string) => formatMoney(decimal(amount), currentLocale()),
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
