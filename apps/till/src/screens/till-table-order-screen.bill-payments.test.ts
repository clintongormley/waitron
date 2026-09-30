import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decimal, formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import "./till-table-order-screen.js";
import type { BillPayDetail, TillTableOrderScreen } from "./till-table-order-screen.js";
import type {
  BillBalance,
  CurrentOrders,
  OrderGroup,
  PartyBill,
  TabLine,
  TableParty,
} from "../api/client.js";
import { currentGroup, row } from "./till-table-order-screen.current-orders.test-helpers.js";

const money = (amount: string) => formatMoney(decimal(amount), currentLocale());
const text = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

const party: TableParty = {
  id: "v1",
  revision: 4,
  guestCount: 3,
  state: "open",
  name: null,
  displayName: "4",
  mainBillId: "wo-4",
  outstanding: "45.00",
  billCount: 1,
  tableIds: ["t4"],
  unsentDrafts: [],
  reminder: null,
};

const untouched: PartyBill = {
  workingOrderId: "wo-4",
  partyId: "v1",
  label: null,
  status: "open",
  total: "45.00",
  outstanding: "45.00",
  hasPayments: false,
  receiptAvailable: false,
};
const partlyPaid: PartyBill = { ...untouched, outstanding: "39.00", hasPayments: true };

function line(over: Partial<TabLine>): TabLine {
  return {
    id: `line-${over.lineNo}`,
    groupId: null,
    lineNo: 1,
    productId: "p",
    quantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "1.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: null,
    note: null,
    listId: null,
    menuItemId: null,
    parentProductId: null,
    ...over,
  };
}

const paella = line({ lineNo: 1, name: "Paella", unitPriceGross: "30.00" });
const beer = line({ lineNo: 2, name: "Beer", quantity: "3.000", unitPriceGross: "3.00" });
const tiramisu = line({ lineNo: 3, name: "Tiramisu", unitPriceGross: "6.00", groupId: "g-2" });

function balance(over: Partial<BillBalance> = {}): BillBalance {
  return {
    workingOrderId: "wo-4",
    status: "open",
    total: "45.00",
    received: "6.00",
    reserved: "0.00",
    outstanding: "39.00",
    tips: "0.00",
    payments: [],
    paidLines: [],
    ...over,
  };
}

async function mountScreen(over: Partial<TillTableOrderScreen> = {}) {
  const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products: [],
    lines: [paella, beer, tiramisu],
    statuses: [],
    orderId: "wo-4",
    party,
    bills: [untouched],
    ...over,
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
  await el.updateComplete;
  return el;
}

function capture<T>(el: TillTableOrderScreen, type: string): T[] {
  const seen: T[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent<T>).detail));
  return seen;
}

const press = async (el: TillTableOrderScreen, selector: string) => {
  el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
  await el.updateComplete;
};

const offeredLines = [
  { lineNo: 1, name: "Paella", quantity: "1", total: "30.00", unitTotal: null },
  { lineNo: 2, name: "Beer", quantity: "3", total: "9.00", unitTotal: "3.00" },
  { lineNo: 3, name: "Tiramisu", quantity: "1", total: "6.00", unitTotal: null },
];

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("till-table-order-screen: the ways to pay part of a bill", () => {
  it.each([
    ["items", "bill_pay.way_items"],
    ["contribution", "bill_pay.way_contribution"],
    ["share", "bill_pay.way_share"],
  ] as const)(
    "offers %s beside the plain charge of an untouched bill, with the bill's dishes",
    async (way, label) => {
      const el = await mountScreen();
      const asked = capture<BillPayDetail>(el, "bill-pay");

      expect(el.shadowRoot!.querySelector("till-tender-pay")).not.toBeNull();
      expect(text(el.shadowRoot!.querySelector(`[data-open-bill-pay="${way}"]`))).toBe(t(label));
      await press(el, `[data-open-bill-pay="${way}"]`);

      expect(asked).toEqual([{ way, lines: offeredLines }]);
    },
  );

  it("opens a contribution of what a partly paid bill still owes from the sentence saying to take the rest", async () => {
    const el = await mountScreen({ bills: [partlyPaid], billBalance: balance() });
    const asked = capture<BillPayDetail>(el, "bill-pay");

    const rest = el.shadowRoot!.querySelector<HTMLElement>("[data-bill-payments] [data-pay-rest]")!;
    expect(text(rest)).toBe(t("bill.pay_with_bill_payments"));
    await press(el, "[data-pay-rest]");

    expect(asked).toEqual([{ way: "contribution", amount: "39.00", lines: offeredLines }]);
    expect(el.shadowRoot!.querySelector("till-tender-pay")).toBeNull();
    expect(
      el.shadowRoot!.querySelector('[data-bill-payments] [data-open-bill-pay="items"]'),
    ).not.toBeNull();
  });

  it("says what a partly paid bill has received so far", async () => {
    const el = await mountScreen({ bills: [partlyPaid], billBalance: balance() });
    expect(text(el.shadowRoot!.querySelector("[data-bill-received]"))).toContain(money("6.00"));
  });

  it("says nothing of money received when the balance read is another bill's", async () => {
    const el = await mountScreen({
      bills: [partlyPaid],
      billBalance: balance({ workingOrderId: "wo-other" }),
    });
    expect(el.shadowRoot!.querySelector("[data-bill-received]")).toBeNull();
  });
});

describe("till-table-order-screen: items already paid for", () => {
  const paidOf = (el: TillTableOrderScreen) =>
    [...el.shadowRoot!.querySelectorAll("[data-line-paid]")].map((mark) => text(mark));

  it("marks each line paid for, and how much of a line is", async () => {
    const el = await mountScreen({
      bills: [partlyPaid],
      billBalance: balance({
        paidLines: [
          { lineId: "line-2", lineNo: 2, paidQuantity: "1.000" },
          { lineId: "line-3", lineNo: 3, paidQuantity: "1.000" },
        ],
      }),
    });

    expect(paidOf(el)).toEqual([
      t("bill_pay.paid_part").replace("{paid}", "1").replace("{quantity}", "3"),
      t("bill_pay.paid"),
    ]);
  });

  it("marks nothing paid from another bill's balance", async () => {
    const el = await mountScreen({
      billBalance: balance({
        workingOrderId: "wo-other",
        paidLines: [{ lineId: "line-1", lineNo: 1, paidQuantity: "1.000" }],
      }),
    });
    expect(paidOf(el)).toEqual([]);
  });

  it("keeps a held dish paid for held in Current orders, marked paid", async () => {
    const held: OrderGroup = {
      id: "g-2",
      position: 2,
      state: "held",
      lineIds: ["line-3"],
      summary: "1 × Tiramisu",
      firedAt: null,
      remindAt: null,
    };
    const currentOrders: CurrentOrders = {
      groups: [
        currentGroup("g-2", 2, "held", [
          row("line-3", "Tiramisu", "1.000", {
            lineNo: 3,
            released: false,
            kitchen: { state: "queued", firedAt: null, awayAt: null },
          }),
        ]),
      ],
      ungrouped: [],
      revision: 1,
      reminder: null,
    };
    const el = await mountScreen({
      bills: [partlyPaid],
      groups: [held],
      currentOrders,
      billBalance: balance({
        paidLines: [{ lineId: "line-3", lineNo: 3, paidQuantity: "1.000" }],
      }),
    });

    const group = el.shadowRoot!.querySelector<HTMLElement>('[data-group="g-2"]')!;
    expect(group.dataset.groupState).toBe("held");
    expect(text(group.querySelector('[data-group-line="line-3"] [data-line-paid]'))).toBe(
      t("bill_pay.paid"),
    );
  });
});
