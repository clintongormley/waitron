import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decimal, formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { TabLine, TableParty, PartyBill, TableState } from "../api/client.js";

const money = (amount: string) => formatMoney(decimal(amount), currentLocale());

const party: TableParty = {
  id: "v1",
  revision: 4,
  guestCount: 3,
  state: "open",
  name: "Ana",
  displayName: "Ana",
  mainBillId: "wo-check",
  outstanding: "30.00",
  billCount: 2,
  tableIds: ["t4"],
  unsentDrafts: [],
  reminder: null,
};

const paidTab: PartyBill = {
  workingOrderId: "wo-tab",
  partyId: "v1",
  label: null,
  status: "settled",
  total: "14.00",
  outstanding: "0.00",
  hasPayments: false,
  receiptAvailable: true,
};
const check: PartyBill = {
  workingOrderId: "wo-check",
  partyId: "v1",
  label: null,
  status: "open",
  total: "30.00",
  outstanding: "30.00",
  hasPayments: false,
  receiptAvailable: false,
};
const abandoned: PartyBill = {
  workingOrderId: "wo-gone",
  partyId: "v1",
  label: null,
  status: "abandoned",
  total: "0.00",
  outstanding: "0.00",
  hasPayments: false,
  receiptAvailable: false,
};

const wine: TabLine = {
  id: "line-1",
  groupId: null,
  lineNo: 1,
  productId: "vino",
  quantity: "1.000",
  unitPrecision: 0,
  unitPriceGross: "30.00",
  servedAt: null,
  courseId: null,
  sentAt: null,
  firedAt: null,
  state: null,
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
};

async function mountScreen(over: Partial<TillTableOrderScreen> = {}) {
  const { el } = await mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products: [],
    lines: [],
    statuses: [],
    orderId: "wo-tab",
    party: party,
    bills: [paidTab, check, abandoned],
    ...over,
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
  await el.updateComplete;
  return el;
}

const bills = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-bills]")!;
const bill = (el: TillTableOrderScreen, id: string) =>
  bills(el).querySelector<HTMLElement>(`[data-bill="${id}"]`);

function capture(el: TillTableOrderScreen, type: string): unknown[] {
  const seen: unknown[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent).detail));
  return seen;
}

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("till-table-order-screen: the party's bills", () => {
  it("lists every bill with what it came to and what is still to pay, and the table's total", async () => {
    const el = await mountScreen();

    expect(bills(el).querySelectorAll("[data-bill]")).toHaveLength(2);
    const paid = bill(el, "wo-tab")!;
    expect(paid.querySelector("[data-bill-total]")!.textContent).toBe(money("14.00"));
    expect(paid.querySelector("[data-bill-state]")!.textContent).toBe(t("table.bill_paid"));
    const open = bill(el, "wo-check")!;
    expect(open.querySelector("[data-bill-total]")!.textContent).toBe(money("30.00"));
    expect(open.querySelector("[data-bill-state]")!.textContent).toBe(
      t("table.bill_to_pay").replace("{amount}", money("30.00")),
    );
    expect(bills(el).querySelector("[data-party-outstanding]")!.textContent).toBe(money("30.00"));
  });

  it("names each bill after the party, numbered in the order listed", async () => {
    const el = await mountScreen();

    expect(bill(el, "wo-tab")!.querySelector(".bill-name")!.textContent!.trim()).toBe(
      t("table.bill_of").replace("{party}", "Ana").replace("{n}", "1"),
    );
    expect(bill(el, "wo-check")!.querySelector(".bill-name")!.textContent!.trim()).toBe(
      t("table.bill_of").replace("{party}", "Ana").replace("{n}", "2"),
    );
  });

  it("names an unnamed party's bills after its tables, and never after a bill's own label", async () => {
    const el = await mountScreen({
      party: { ...party, name: null, displayName: "Mesa 4, 5" },
      bills: [paidTab, { ...check, label: "Mesa 4" }],
    });

    expect(bill(el, "wo-check")!.querySelector(".bill-name")!.textContent!.trim()).toBe(
      t("table.bill_of").replace("{party}", "Mesa 4, 5").replace("{n}", "2"),
    );
  });

  it("marks the bill new orders go to, and no other", async () => {
    const el = await mountScreen();

    expect(bill(el, "wo-check")!.querySelector("[data-bill-main]")!.textContent!.trim()).toBe(
      t("table.bill_main"),
    );
    expect(bill(el, "wo-tab")!.querySelector("[data-bill-main]")).toBeNull();
  });

  it("marks no bill when the party has no main bill until its next order", async () => {
    const el = await mountScreen({ party: { ...party, mainBillId: null } });

    expect(bills(el).querySelector("[data-bill-main]")).toBeNull();
  });

  it("leaves out a bill that was abandoned, which nobody pays", async () => {
    const el = await mountScreen();

    expect(bill(el, "wo-gone")).toBeNull();
  });

  it("offers a copy of a paid bill's receipt", async () => {
    const el = await mountScreen();
    const asked = capture(el, "reprint-bill");

    bill(el, "wo-tab")!.querySelector<HTMLElement>("[data-bill-receipt]")!.click();

    expect(asked).toEqual([{ workingOrderId: "wo-tab" }]);
    expect(bill(el, "wo-check")!.querySelector("[data-bill-receipt]")).toBeNull();
  });

  it("offers to take payment for another unpaid bill of the party", async () => {
    const el = await mountScreen();
    const asked = capture(el, "take-payment");

    bill(el, "wo-check")!.querySelector<HTMLElement>("[data-take-payment]")!.click();

    expect(asked).toEqual([{ workingOrderId: "wo-check" }]);
    expect(bill(el, "wo-tab")!.querySelector("[data-take-payment]")).toBeNull();
  });

  it("marks the bill on screen and offers no payment for it, since the charge below takes it", async () => {
    const el = await mountScreen({ orderId: "wo-check", lines: [wine] });

    expect(bill(el, "wo-check")!.getAttribute("aria-current")).toBe("true");
    expect(bill(el, "wo-check")!.querySelector("[data-take-payment]")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-tender-pay")).not.toBeNull();
  });

  it("hides the charge when the bill on screen is already paid", async () => {
    const el = await mountScreen();

    expect(el.shadowRoot!.querySelector("till-tender-pay")).toBeNull();
  });

  it("shows no bills section for a tab that belongs to no party", async () => {
    const el = await mountScreen({ party: null, bills: [] });

    expect(el.shadowRoot!.querySelector("[data-bills]")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-tender-pay")).not.toBeNull();
  });
});

describe("till-table-order-screen: paying a bill by its state", () => {
  const placed: PartyBill = { ...check, workingOrderId: "wo-placed", status: "placed" };
  const partlyPaid: PartyBill = {
    ...check,
    workingOrderId: "wo-part",
    outstanding: "10.00",
    hasPayments: true,
  };

  it("offers Take payment for a presented bill of the party", async () => {
    const el = await mountScreen({ bills: [paidTab, placed] });
    const asked = capture(el, "take-payment");

    bill(el, "wo-placed")!.querySelector<HTMLElement>("[data-take-payment]")!.click();

    expect(asked).toEqual([{ workingOrderId: "wo-placed" }]);
  });

  it("shows the charge on a presented bill on screen", async () => {
    const el = await mountScreen({ orderId: "wo-placed", bills: [paidTab, placed], lines: [wine] });

    expect(el.shadowRoot!.querySelector("till-tender-pay")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-bill-payments]")).toBeNull();
  });

  it("shows a partly paid bill on screen what it still owes and to take the rest as a bill payment, with no charge", async () => {
    const el = await mountScreen({
      orderId: "wo-part",
      bills: [paidTab, partlyPaid],
      lines: [wine],
    });

    expect(el.shadowRoot!.querySelector("till-tender-pay")).toBeNull();
    const notice = el.shadowRoot!.querySelector<HTMLElement>("[data-bill-payments]")!;
    expect(notice.textContent).toContain(
      t("table.bill_to_pay").replace("{amount}", money("10.00")),
    );
    expect(notice.textContent).toContain(t("bill.pay_with_bill_payments"));
  });

  it("takes no charge on a bill on screen whose only payment is a card still at the reader", async () => {
    const pending: PartyBill = { ...check, workingOrderId: "wo-pending", hasPayments: true };
    const el = await mountScreen({
      orderId: "wo-pending",
      bills: [paidTab, pending],
      lines: [wine],
    });

    expect(el.shadowRoot!.querySelector("till-tender-pay")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-bill-payments]")!.textContent).toContain(
      t("bill.pay_with_bill_payments"),
    );
  });
});

describe("till-table-order-screen: Cancel and credit", () => {
  const invoiced: PartyBill = {
    ...check,
    workingOrderId: "wo-invoiced",
    status: "placed",
    receiptAvailable: true,
    invoiceNumber: "A/12",
    creditNotes: [],
  };

  it("offers to cancel and credit a bill whose invoice was issued and nothing is paid", async () => {
    const el = await mountScreen({ bills: [paidTab, invoiced] });
    const asked = capture(el, "cancel-credit-bill");

    const action = bill(el, "wo-invoiced")!.querySelector<HTMLElement>("[data-cancel-credit]")!;
    expect(action.textContent!.trim()).toBe(t("cancel_credit.action"));
    action.click();

    expect(asked).toEqual([{ workingOrderId: "wo-invoiced" }]);
  });

  it.each<[string, PartyBill]>([
    ["an open bill", { ...invoiced, status: "open" }],
    ["a paid bill", { ...invoiced, status: "settled", outstanding: "0.00" }],
    ["a presented bill with no invoice yet", { ...invoiced, receiptAvailable: false }],
    ["a presented bill holding a payment", { ...invoiced, hasPayments: true }],
  ])("offers no cancel on %s", async (_, shown) => {
    const el = await mountScreen({ bills: [paidTab, shown] });

    expect(bill(el, "wo-invoiced")!.querySelector("[data-cancel-credit]")).toBeNull();
  });
});

describe("till-table-order-screen: the bill request", () => {
  /** The floor's row for the party's table, as the app passes it down. */
  const floorRow = (requested: boolean): TableState => ({
    id: "t4",
    label: "4",
    zoneId: "z1",
    capacity: 4,
    state: "open-tab",
    condition: "held",
    hasOpenTab: true,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    status: null,
    nextReservation: null,
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
    party,
    signals: requested ? [{ kind: "bill_requested", requestedAt: "2026-09-30T20:00:00.000Z" }] : [],
  });

  it("offers to mark the bill requested, naming the party it is for", async () => {
    const el = await mountScreen({ tables: [floorRow(false)] });
    const asked = capture(el, "request-bill");

    const action = bills(el).querySelector<HTMLElement>("[data-request-bill]")!;
    expect(action.textContent!.trim()).toBe("Mark bill requested for Ana");
    expect(bills(el).querySelector("[data-chip='bill-requested']")).toBeNull();
    expect(bills(el).querySelector("[data-cancel-bill-request]")).toBeNull();
    action.click();

    expect(asked).toEqual([{ requested: true }]);
  });

  it("shows a requested bill, and offers to cancel the request for the party it names", async () => {
    const el = await mountScreen({ tables: [floorRow(true)] });
    const asked = capture(el, "request-bill");

    expect(bills(el).querySelector("[data-chip='bill-requested']")!.textContent!.trim()).toBe(
      "Bill requested",
    );
    expect(bills(el).querySelector("[data-request-bill]")).toBeNull();
    const cancel = bills(el).querySelector<HTMLElement>("[data-cancel-bill-request]")!;
    expect(cancel.textContent!.trim()).toBe("Cancel the bill request for Ana");
    cancel.click();

    expect(asked).toEqual([{ requested: false }]);
  });

  it("holds the action while another command on the party runs", async () => {
    const asking = await mountScreen({ tables: [floorRow(false)], groupCommandBusy: true });
    const cancelling = await mountScreen({ tables: [floorRow(true)], groupCommandBusy: true });
    const disabled = (el: TillTableOrderScreen, selector: string) =>
      bills(el).querySelector<HTMLElement & { disabled: boolean }>(selector)!.disabled;

    expect(disabled(asking, "[data-request-bill]")).toBe(true);
    expect(disabled(cancelling, "[data-cancel-bill-request]")).toBe(true);
  });

  it("says it in Spanish", async () => {
    setLocale("es");
    const asking = await mountScreen({ tables: [floorRow(false)] });
    const cancelling = await mountScreen({ tables: [floorRow(true)] });

    expect(bills(asking).querySelector("[data-request-bill]")!.textContent!.trim()).toBe(
      "Marcar cuenta pedida para Ana",
    );
    expect(
      bills(cancelling).querySelector("[data-chip='bill-requested']")!.textContent!.trim(),
    ).toBe("Cuenta pedida");
    expect(bills(cancelling).querySelector("[data-cancel-bill-request]")!.textContent!.trim()).toBe(
      "Anular la petición de cuenta de Ana",
    );
  });
});

describe("till-table-order-screen: Finish table", () => {
  it("asks to finish the table", async () => {
    const el = await mountScreen();
    const asked = capture(el, "finish-table");

    bills(el).querySelector<HTMLElement>("[data-finish-table]")!.click();

    expect(asked).toHaveLength(1);
  });

  it("shows the refusal with Take payment for the first unpaid bill when a bill is outstanding", async () => {
    const el = await mountScreen({ finishRefused: true });
    const asked = capture(el, "take-payment");

    const refusal = bills(el).querySelector<HTMLElement>("[data-finish-refusal]")!;
    expect(refusal.getAttribute("role")).toBe("alert");
    expect(refusal.textContent).toContain(codeMessage("party.bill_outstanding"));
    refusal.querySelector<HTMLElement>("[data-take-payment]")!.click();

    expect(asked).toEqual([{ workingOrderId: "wo-check" }]);
  });

  it("points the refusal's Take payment at a presented bill, which is collected here", async () => {
    const placed: PartyBill = { ...check, status: "placed" };
    const el = await mountScreen({ finishRefused: true, bills: [paidTab, placed] });
    const asked = capture(el, "take-payment");

    const refusal = bills(el).querySelector<HTMLElement>("[data-finish-refusal]")!;
    refusal.querySelector<HTMLElement>("[data-take-payment]")!.click();

    expect(asked).toEqual([{ workingOrderId: "wo-check" }]);
    expect(bill(el, "wo-check")!.querySelector("[data-bill-state]")!.textContent).toBe(
      t("table.bill_to_pay").replace("{amount}", money("30.00")),
    );
  });

  it("offers no Take payment beside the refusal when every bill is paid or abandoned", async () => {
    const el = await mountScreen({ finishRefused: true, bills: [paidTab, abandoned] });

    const refusal = bills(el).querySelector<HTMLElement>("[data-finish-refusal]")!;
    expect(refusal.textContent).toContain(codeMessage("party.bill_outstanding"));
    expect(refusal.querySelector("[data-take-payment]")).toBeNull();
  });

  it("points the refusal's Take payment at another unpaid bill before the one on screen", async () => {
    const el = await mountScreen({
      finishRefused: true,
      orderId: "wo-check",
      bills: [check, { ...paidTab, status: "open", outstanding: "14.00" }],
    });
    const asked = capture(el, "take-payment");

    bills(el).querySelector<HTMLElement>("[data-finish-refusal] [data-take-payment]")!.click();

    expect(asked).toEqual([{ workingOrderId: "wo-tab" }]);
  });

  it("points the refusal's Take payment at the bill on screen when it is the only one unpaid", async () => {
    const el = await mountScreen({ finishRefused: true, orderId: "wo-check" });
    const asked = capture(el, "take-payment");

    bills(el).querySelector<HTMLElement>("[data-finish-refusal] [data-take-payment]")!.click();

    expect(asked).toEqual([{ workingOrderId: "wo-check" }]);
  });

  it("offers Record unpaid departure beside Take payment in the refusal, which asks the app to record it", async () => {
    const el = await mountScreen({ finishRefused: true });
    const asked = capture(el, "record-unpaid-departure");

    const refusal = bills(el).querySelector<HTMLElement>("[data-finish-refusal]")!;
    const actions = [...refusal.querySelectorAll<HTMLElement>("wt-button")];
    expect(actions.map((button) => button.textContent!.trim())).toEqual([
      t("table.take_payment"),
      t("departure.record"),
    ]);
    expect(actions[1]!.getAttribute("variant")).toBe("secondary");
    refusal.querySelector<HTMLElement>("[data-record-departure]")!.click();

    expect(asked).toEqual([{}]);
  });

  it("offers no Record unpaid departure when no bill it shows is unpaid", async () => {
    const el = await mountScreen({ finishRefused: true, bills: [paidTab, abandoned] });

    expect(bills(el).querySelector("[data-finish-refusal] [data-record-departure]")).toBeNull();
  });

  it("shows no refusal until Finish has been refused", async () => {
    const el = await mountScreen();

    expect(bills(el).querySelector("[data-finish-refusal]")).toBeNull();
  });
});
