import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./bill-pay-dialog.js";
import type { PayLine, PayRequest, TillBillPayDialog } from "./bill-pay-dialog.js";
import type { AllocationPreview, BillBalance } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

function balanceOf(over: Partial<BillBalance> = {}): BillBalance {
  return {
    workingOrderId: "wo-4",
    status: "open",
    total: "120.00",
    received: "0.00",
    reserved: "0.00",
    outstanding: "120.00",
    tips: "0.00",
    payments: [],
    paidLines: [],
    ...over,
  };
}

const paella: PayLine = {
  lineNo: 1,
  name: "Paella",
  quantity: "1",
  total: "35.00",
  unitTotal: null,
};
const beers: PayLine = { lineNo: 2, name: "Beer", quantity: "3", total: "9.00", unitTotal: "3.00" };
const tiramisu: PayLine = {
  lineNo: 3,
  name: "Tiramisu",
  quantity: "1",
  total: "6.00",
  unitTotal: null,
};
const lines = [paella, beers, tiramisu];

async function mount(over: Partial<TillBillPayDialog> = {}) {
  const { el } = await mountWidget<TillBillPayDialog>("till-bill-pay-dialog", {
    balance: balanceOf(),
    lines,
    way: "items",
    ...over,
  });
  return el;
}

const root = (el: TillBillPayDialog) => el.shadowRoot!;
const text = (node: Element | ShadowRoot | null) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const money = (amount: string) => formatMoney(amount, currentLocale());
const field = (el: TillBillPayDialog, name: string) =>
  root(el).querySelector<HTMLElement & { error: string; required: boolean; value: string }>(
    `wt-input[name="${name}"]`,
  );
const actions = (el: TillBillPayDialog) =>
  root(el).querySelector<HTMLElement & { error: string }>("wt-form-actions")!;
const button = (el: TillBillPayDialog, selector: string) =>
  root(el).querySelector<HTMLElement & { disabled: boolean }>(selector)!;
const scope = (el: TillBillPayDialog) => text(root(el).querySelector("[data-pay-scope]"));
const offered = (el: TillBillPayDialog) =>
  [...root(el).querySelectorAll<HTMLInputElement>('input[name="line"]')].map((box) =>
    text(box.closest("label")),
  );

async function type(el: TillBillPayDialog, name: string, value: string): Promise<void> {
  const input = field(el, name)!.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

async function click(el: TillBillPayDialog, selector: string): Promise<void> {
  button(el, selector).click();
  await el.updateComplete;
}

async function pick(el: TillBillPayDialog, name: string, value: string): Promise<void> {
  root(el).querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!.click();
  await el.updateComplete;
}

function capture<T>(el: TillBillPayDialog, type: string): T[] {
  const seen: T[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent<T>).detail));
  return seen;
}

/** Continue, answered as the app answers it: what was asked, and the server's preview of it. */
async function previewed(el: TillBillPayDialog, preview: AllocationPreview): Promise<PayRequest> {
  const asked = capture<PayRequest>(el, "bill-pay-preview");
  await click(el, "[data-pay-continue]");
  el.asked = asked.at(-1)!;
  el.preview = preview;
  await el.updateComplete;
  return asked.at(-1)!;
}

const cashPreview = (applied: string, change: string, tip = "0.00"): AllocationPreview => ({
  kind: "allocated",
  choice: null,
  applied,
  tip,
  change,
  charged: null,
});

describe("till-bill-pay-dialog: the bill's balance", () => {
  it("shows the bill's total, what it has received, what a card in progress holds and what is still to pay", async () => {
    const el = await mount({
      balance: balanceOf({ received: "50.00", reserved: "20.00", outstanding: "50.00" }),
    });

    expect(text(root(el).querySelector("[data-pay-total]"))).toContain(money("120.00"));
    expect(text(root(el).querySelector("[data-pay-received]"))).toContain(money("50.00"));
    expect(text(root(el).querySelector("[data-pay-reserved]"))).toContain(money("20.00"));
    expect(text(root(el).querySelector("[data-pay-outstanding]"))).toContain(money("50.00"));
  });

  it("shows the balance again when it is read again", async () => {
    const el = await mount();
    el.balance = balanceOf({ received: "30.00", outstanding: "90.00" });
    await el.updateComplete;

    expect(text(root(el).querySelector("[data-pay-received]"))).toContain(money("30.00"));
    expect(text(root(el).querySelector("[data-pay-outstanding]"))).toContain(money("90.00"));
  });

  it("says the balance is being read while it has none", async () => {
    const el = await mount({ balance: null });
    expect(text(root(el).querySelector("[data-pay-balance]"))).toContain(t("bill_pay.reading"));
  });
});

describe("till-bill-pay-dialog: paying for items", () => {
  it("offers every item not yet paid for, and the units of a line still to pay", async () => {
    const el = await mount({
      balance: balanceOf({
        paidLines: [
          { lineId: "l-2", lineNo: 2, paidQuantity: "1.000" },
          { lineId: "l-3", lineNo: 3, paidQuantity: "1.000" },
        ],
      }),
    });

    expect(offered(el)).toEqual([`Paella ×1 · ${money("35.00")}`, `Beer ×2 · ${money("6.00")}`]);
  });

  it("shows what the chosen items come to before anything is asked", async () => {
    const el = await mount();
    await pick(el, "line", "1");
    await pick(el, "line", "2");

    expect(scope(el)).toContain(money("44.00"));
    expect(scope(el)).toContain("Paella");
    expect(scope(el)).toContain("Beer ×3");
  });

  it("asks for chosen whole lines, and for fewer units of a line by their count", async () => {
    const el = await mount();
    const asked = capture<PayRequest>(el, "bill-pay-preview");
    await pick(el, "line", "1");
    await pick(el, "line", "2");
    await click(el, '[data-units-less="2"]');
    await type(el, "tendered", "50");
    await click(el, "[data-pay-continue]");

    expect(scope(el)).toContain(money("41.00"));
    expect(asked).toEqual([
      {
        choice: { kind: "items", picks: [{ lineNo: 1 }, { lineNo: 2, units: 2 }] },
        pay: { method: "cash", tendered: "50" },
      },
    ]);
  });

  it("asks for the units still to pay by their count once some of a line is paid", async () => {
    const el = await mount({
      balance: balanceOf({ paidLines: [{ lineId: "l-2", lineNo: 2, paidQuantity: "1.000" }] }),
    });
    const asked = capture<PayRequest>(el, "bill-pay-preview");
    await pick(el, "line", "2");
    await type(el, "tendered", "6");
    await click(el, "[data-pay-continue]");

    expect(asked[0]!.choice).toEqual({ kind: "items", picks: [{ lineNo: 2, units: 2 }] });
  });

  it("does not step units beyond one or beyond what is still to pay", async () => {
    const el = await mount();
    await pick(el, "line", "2");

    expect(button(el, '[data-units-more="2"]').disabled).toBe(true);
    await click(el, '[data-units-less="2"]');
    await click(el, '[data-units-less="2"]');
    expect(button(el, '[data-units-less="2"]').disabled).toBe(true);
    expect(text(root(el).querySelector('[data-units="2"]'))).toBe("1");
  });

  it("says when every item is already paid for", async () => {
    const el = await mount({
      lines: [tiramisu],
      balance: balanceOf({ paidLines: [{ lineId: "l-3", lineNo: 3, paidQuantity: "1.000" }] }),
    });
    expect(text(root(el).querySelector("[data-items-none]"))).toBe(t("bill_pay.items_none"));
  });
});

describe("till-bill-pay-dialog: contributing and splitting equally", () => {
  it("asks for a contribution of the amount typed, read with a decimal comma", async () => {
    const el = await mount({ way: "contribution" });
    const asked = capture<PayRequest>(el, "bill-pay-preview");
    await type(el, "amount", "25,50");
    await pick(el, "method", "card");
    await click(el, "[data-pay-continue]");

    expect(scope(el)).toContain(money("25.50"));
    expect(asked).toEqual([
      {
        choice: { kind: "contribution", amount: "25.50" },
        pay: { method: "card" },
        card: { entry: "manual" },
      },
    ]);
  });

  it("starts a contribution at the amount it was opened with", async () => {
    const el = await mount({ way: "contribution", amount: "40.00" });
    expect(field(el, "amount")!.value).toBe("40.00");
  });

  it("asks for an equal share among the people still to pay, and shows what they share", async () => {
    const el = await mount({ way: "items" });
    const asked = capture<PayRequest>(el, "bill-pay-preview");
    await pick(el, "way", "share");
    await type(el, "people", "3");
    await type(el, "tendered", "50");
    await click(el, "[data-pay-continue]");

    expect(scope(el)).toContain(money("120.00"));
    expect(scope(el)).toContain("3");
    expect(asked[0]!.choice).toEqual({ kind: "share", shareOf: 3 });
  });

  it("sends a card's tip and its operation number with a hand-keyed card", async () => {
    const el = await mount({ way: "contribution" });
    const asked = capture<PayRequest>(el, "bill-pay-preview");
    await type(el, "amount", "40");
    await pick(el, "method", "card");
    await type(el, "cardTip", "10");
    await type(el, "externalRef", " 000123 ");
    await click(el, "[data-pay-continue]");

    expect(asked[0]).toEqual({
      choice: { kind: "contribution", amount: "40" },
      pay: { method: "card", addedTip: "10" },
      card: { entry: "manual", externalRef: "000123" },
    });
  });
});

describe("till-bill-pay-dialog: its own checks", () => {
  it("marks the required fields", async () => {
    const el = await mount({ way: "contribution" });
    expect(field(el, "amount")!.required).toBe(true);
    expect(field(el, "tendered")!.required).toBe(true);
    await pick(el, "method", "card");
    expect(field(el, "tendered")).toBeNull();
    expect(field(el, "cardTip")!.required).toBe(false);
  });

  it("explains an empty submission beside each field and once beside the action, which waits until they are fixed", async () => {
    const el = await mount({ way: "items" });
    const asked = capture<PayRequest>(el, "bill-pay-preview");
    await click(el, "[data-pay-continue]");

    expect(text(root(el).querySelector('[data-error-for="lines"]'))).toBe(
      t("bill_pay.items_required"),
    );
    expect(field(el, "tendered")!.error).toBe(t("bill_pay.tendered_invalid"));
    expect(actions(el).error).toBe(t("form.fix_fields"));
    expect(button(el, "[data-pay-continue]").disabled).toBe(true);
    expect(asked).toEqual([]);

    await pick(el, "line", "1");
    await type(el, "tendered", "35");

    expect(actions(el).error).toBe("");
    expect(button(el, "[data-pay-continue]").disabled).toBe(false);
  });

  it.each([
    ["contribution", "amount", "0", "bill_pay.amount_invalid"],
    ["contribution", "amount", "abc", "bill_pay.amount_invalid"],
    ["share", "people", "0", "bill_pay.people_invalid"],
    ["share", "people", "1.5", "bill_pay.people_invalid"],
  ] as const)("refuses a %s %s of %s", async (way, name, value, key) => {
    const el = await mount({ way });
    await type(el, name, value);
    await type(el, "tendered", "10");
    await click(el, "[data-pay-continue]");

    expect(field(el, name)!.error).toBe(t(key));
  });

  it("refuses a card tip that is not an amount", async () => {
    const el = await mount({ way: "contribution" });
    await type(el, "amount", "10");
    await pick(el, "method", "card");
    await type(el, "cardTip", "x");
    await click(el, "[data-pay-continue]");

    expect(field(el, "cardTip")!.error).toBe(t("bill_pay.tip_invalid"));
  });
});

describe("till-bill-pay-dialog: confirming cash", () => {
  async function toConfirm(el: TillBillPayDialog, preview: AllocationPreview) {
    await pick(el, "line", "1");
    await type(el, "tendered", "50");
    return previewed(el, preview);
  }

  it("shows what the bill takes, the cash handed over and the change before the payment is taken", async () => {
    const el = await mount();
    await toConfirm(el, cashPreview("35.00", "15.00"));

    expect(text(root(el).querySelector("[data-pay-applied]"))).toContain(money("35.00"));
    expect(text(root(el).querySelector("[data-pay-tendered]"))).toContain(money("50.00"));
    expect(text(root(el).querySelector("[data-pay-change]"))).toContain(money("15.00"));
    expect(scope(el)).toContain("Paella");
  });

  it("asks again with all the change left as a tip", async () => {
    const el = await mount();
    const first = await toConfirm(el, cashPreview("35.00", "15.00"));
    const asked = capture<PayRequest>(el, "bill-pay-preview");

    await pick(el, "leaveTip", "all");

    expect(asked).toEqual([
      { ...first, pay: { method: "cash", tendered: "50", addedTip: "15.00" } },
    ]);
  });

  it("asks again with part of the change left as a tip, then gives it all back as change", async () => {
    const el = await mount();
    const first = await toConfirm(el, cashPreview("35.00", "15.00"));
    const asked = capture<PayRequest>(el, "bill-pay-preview");

    await pick(el, "leaveTip", "part");
    await type(el, "tipAmount", "5");
    await click(el, "[data-pay-confirm]");
    el.asked = asked[0]!;
    el.preview = cashPreview("35.00", "10.00", "5.00");
    await el.updateComplete;
    await pick(el, "leaveTip", "none");

    expect(asked).toEqual([
      { ...first, pay: { method: "cash", tendered: "50", addedTip: "5" } },
      first,
    ]);
    expect(text(root(el).querySelector("[data-pay-tip]"))).toContain(money("5.00"));
  });

  it("refuses a tip larger than the change beside the tip, and holds the payment until it is fixed", async () => {
    const el = await mount();
    await toConfirm(el, cashPreview("35.00", "15.00"));
    const confirmed = capture(el, "bill-pay-confirm");

    await pick(el, "leaveTip", "part");
    await type(el, "tipAmount", "20");
    await click(el, "[data-pay-confirm]");

    expect(field(el, "tipAmount")!.error).toBe(
      t("bill_pay.tip_amount_invalid").replace("{amount}", money("15.00")),
    );
    expect(actions(el).error).toBe(t("form.fix_fields"));
    expect(button(el, "[data-pay-confirm]").disabled).toBe(true);
    expect(confirmed).toEqual([]);
    await type(el, "tipAmount", "15");
    expect(button(el, "[data-pay-confirm]").disabled).toBe(false);
  });

  it("takes the payment it showed", async () => {
    const el = await mount();
    await toConfirm(el, cashPreview("35.00", "15.00"));
    const confirmed = capture(el, "bill-pay-confirm");

    await click(el, "[data-pay-confirm]");

    expect(confirmed).toHaveLength(1);
  });

  it("goes back to the form with what was entered", async () => {
    const el = await mount();
    await toConfirm(el, cashPreview("35.00", "15.00"));
    const edits = capture(el, "bill-pay-edit");

    await click(el, "[data-pay-back]");
    el.preview = null;
    await el.updateComplete;

    expect(edits).toHaveLength(1);
    expect(field(el, "tendered")!.value).toBe("50");
  });
});

describe("till-bill-pay-dialog: confirming a card", () => {
  it("shows what the bill takes, the tip and what the card is charged before it is taken", async () => {
    const el = await mount({ way: "contribution" });
    await type(el, "amount", "40");
    await pick(el, "method", "card");
    await type(el, "cardTip", "10");
    await previewed(el, {
      kind: "allocated",
      choice: null,
      applied: "40.00",
      tip: "10.00",
      change: null,
      charged: "50.00",
    });

    expect(text(root(el).querySelector("[data-pay-applied]"))).toContain(money("40.00"));
    expect(text(root(el).querySelector("[data-pay-tip]"))).toContain(money("10.00"));
    expect(text(root(el).querySelector("[data-pay-charged]"))).toContain(money("50.00"));
    expect(root(el).querySelector("[data-pay-change]")).toBeNull();
    expect(root(el).querySelector('input[name="leaveTip"]')).toBeNull();
  });
});

describe("till-bill-pay-dialog: moving between steps", () => {
  it("takes a card straight away after going back from cash with part of the change marked as a tip", async () => {
    const el = await mount({ way: "contribution" });
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    await previewed(el, cashPreview("40.00", "10.00"));
    await pick(el, "leaveTip", "part");
    await click(el, "[data-pay-back]");
    el.asked = null;
    el.preview = null;
    await el.updateComplete;
    await pick(el, "method", "card");
    await type(el, "cardTip", "5");
    await previewed(el, {
      kind: "allocated",
      choice: null,
      applied: "40.00",
      tip: "5.00",
      change: null,
      charged: "45.00",
    });
    const confirmed = capture(el, "bill-pay-confirm");

    await click(el, "[data-pay-confirm]");

    expect(confirmed).toHaveLength(1);
  });

  it("takes the payment when the tip typed is the tip already shown", async () => {
    const el = await mount({ way: "contribution" });
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    const first = await previewed(el, cashPreview("40.00", "10.00"));
    await pick(el, "leaveTip", "part");
    await type(el, "tipAmount", "4");
    el.asked = { ...first, pay: { method: "cash", tendered: "50", addedTip: "4" } };
    el.preview = cashPreview("40.00", "6.00", "4.00");
    await el.updateComplete;
    const asked = capture(el, "bill-pay-preview");
    const confirmed = capture(el, "bill-pay-confirm");

    await click(el, "[data-pay-confirm]");

    expect(asked).toEqual([]);
    expect(confirmed).toHaveLength(1);
  });

  it("drops an item it was paying for when it is unticked, and steps its units back up", async () => {
    const el = await mount();
    await pick(el, "line", "1");
    await pick(el, "line", "2");
    await click(el, '[data-units-less="2"]');
    await click(el, '[data-units-more="2"]');
    await pick(el, "line", "1");

    expect(scope(el)).toBe(
      t("bill_pay.scope_items").replace("{items}", "Beer ×3").replace("{amount}", money("9.00")),
    );
  });

  it("goes back to cash after choosing a card", async () => {
    const el = await mount({ way: "contribution" });
    await pick(el, "method", "card");
    await pick(el, "method", "cash");
    expect(field(el, "tendered")).not.toBeNull();
    expect(field(el, "cardTip")).toBeNull();
  });

  it("asks from the keyboard: Enter in a field presses Continue", async () => {
    const el = await mount({ way: "contribution" });
    const asked = capture<PayRequest>(el, "bill-pay-preview");
    await type(el, "amount", "10");
    await type(el, "tendered", "10");
    field(el, "tendered")!
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    await el.updateComplete;

    expect(asked).toHaveLength(1);
  });

  it("closes when the dialog is dismissed", async () => {
    const el = await mount();
    const closed = capture(el, "bill-pay-close");
    root(el).querySelector("wt-dialog")!.dispatchEvent(new CustomEvent("wt-close"));
    expect(closed).toHaveLength(1);
  });
});

describe("till-bill-pay-dialog: refusals and answers", () => {
  it("shows a refusal that names no field beside the action, which stays enabled", async () => {
    const el = await mount({ refusal: { code: "bill.nothing_outstanding" } });
    expect(actions(el).error).toBe(codeMessage("bill.nothing_outstanding"));
    expect(button(el, "[data-pay-continue]").disabled).toBe(false);
  });

  it("puts a refusal of the cash handed over under that field until it changes", async () => {
    const el = await mount({
      way: "contribution",
      refusal: { code: "management.request_invalid", field: "tendered" },
    });
    expect(field(el, "tendered")!.error).toBe(t("bill_pay.tendered_short"));
    expect(actions(el).error).toBe(t("form.fix_fields"));
    expect(button(el, "[data-pay-continue]").disabled).toBe(false);

    await type(el, "tendered", "60");
    expect(field(el, "tendered")!.error).toBe("");
    expect(actions(el).error).toBe("");
  });

  it.each([
    ["amount", "contribution", "cash", "amount"],
    ["shareOf", "share", "cash", "people"],
    ["addedTip", "contribution", "card", "cardTip"],
  ] as const)(
    "puts a refusal of %s under its field in the refusal's own words",
    async (refused, way, method, name) => {
      const el = await mount({ way });
      if (method === "card") await pick(el, "method", "card");
      el.refusal = { code: "management.request_invalid", field: refused };
      await el.updateComplete;
      expect(field(el, name)!.error).toBe(codeMessage("management.request_invalid"));
    },
  );

  it.each([
    ["a field the form does not show", { field: "lines" }, "cash"],
    ["the cash handed over, on a card", { field: "tendered" }, "card"],
    ["a tip left from cash change", { field: "addedTip" }, "cash"],
  ] as const)("puts a refusal naming %s beside the action", async (_case, named, method) => {
    const el = await mount({ way: "contribution" });
    if (method === "card") await pick(el, "method", "card");
    el.refusal = { code: "management.request_invalid", ...named };
    await el.updateComplete;
    expect(actions(el).error).toBe(codeMessage("management.request_invalid"));
  });

  it("says when the bill's payments could not be read again", async () => {
    const el = await mount({ refusal: { code: "unread" } });
    expect(actions(el).error).toBe(t("bill_pay.read_failed"));
  });

  it("says a payment that got no answer may have been taken", async () => {
    const el = await mount({ refusal: { code: "network" } });
    expect(actions(el).error).toBe(t("bill_pay.unconfirmed"));
  });

  it("reopens the confirmation with the new amounts when the bill changed, saying so", async () => {
    const el = await mount();
    await pick(el, "line", "1");
    await type(el, "tendered", "50");
    await previewed(el, cashPreview("35.00", "15.00"));

    el.preview = cashPreview("30.00", "20.00");
    el.refusal = { code: "bill.allocation_changed" };
    await el.updateComplete;

    expect(text(root(el).querySelector("[data-pay-applied]"))).toContain(money("30.00"));
    expect(text(root(el).querySelector("[data-pay-change]"))).toContain(money("20.00"));
    expect(actions(el).error).toBe(codeMessage("bill.allocation_changed"));
    expect(button(el, "[data-pay-confirm]").disabled).toBe(false);
  });

  it("says to contribute instead when the chosen items cost more than is left", async () => {
    const el = await mount();
    await pick(el, "line", "1");
    await type(el, "tendered", "50");
    await previewed(el, {
      kind: "choose",
      options: [{ choice: "use_pool", applied: "20.00", tip: "0.00" }],
    });

    expect(root(el).querySelector("[data-pay-confirm]")).toBeNull();
    expect(actions(el).error).toBe(t("bill_pay.choose_later"));
  });

  it("says a payment was taken and the change to give, and starts the form again", async () => {
    const el = await mount({ way: "contribution" });
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    el.taken = { change: "10.00" };
    await el.updateComplete;

    expect(text(root(el).querySelector("[data-pay-taken]"))).toBe(
      t("bill_pay.taken_change").replace("{amount}", money("10.00")),
    );
    expect(field(el, "amount")!.value).toBe("");
    expect(field(el, "tendered")!.value).toBe("");
  });

  it("says a payment was taken with no change", async () => {
    const el = await mount();
    el.taken = { change: null };
    await el.updateComplete;
    expect(text(root(el).querySelector("[data-pay-taken]"))).toBe(t("bill_pay.taken"));
  });

  it("closes from its Close button", async () => {
    const el = await mount();
    const closed = capture(el, "bill-pay-close");
    await click(el, "[data-pay-close]");
    expect(closed).toHaveLength(1);
  });
});
