import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { formatMoney } from "@waitron/shared";
import type { WtStepper, WtTopBar } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./bill-pay-dialog.js";
import { splitAmong } from "../../test/bill-pay-app.js";
import type { PayRequest, TillBillPayDialog } from "./bill-pay-dialog.js";
import type { TillSplitEqually } from "./split-equally.js";
import type { TablePayQuoteRequest } from "../state/table-pay-quote.js";
import type { BillBalance } from "../api/payments-api.js";

const originalLocale = currentLocale();

beforeEach(() => setLocale("en"));

afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

const balanceOf = (over: Partial<BillBalance> = {}): BillBalance => ({
  workingOrderId: "wo-4",
  status: "open",
  total: "73.30",
  received: "0.00",
  reserved: "0.00",
  outstanding: "73.30",
  tips: "0.00",
  payments: [],
  ...over,
});

/** A table's Pay on a till, opened on Whole bill. */
const mount = (over: Partial<TillBillPayDialog> = {}) =>
  mountWidget<TillBillPayDialog>("till-bill-pay-dialog", {
    quiet: true,
    way: "whole",
    billName: "Bill 1",
    tableName: "Table 4",
    cardReader: "simulator",
    takesManualCard: true,
    balance: balanceOf(),
    lines: [],
    ...over,
  }).then(({ el }) => el);

const root = (el: TillBillPayDialog) => el.shadowRoot!;
const money = (amount: string) => formatMoney(amount, currentLocale());
const screen = (el: TillBillPayDialog) =>
  root(el).querySelector<TillSplitEqually>("till-split-equally");
const stepper = (el: TillBillPayDialog) =>
  screen(el)!.shadowRoot!.querySelector<WtStepper>("wt-stepper")!;
const question = (el: TillBillPayDialog) =>
  screen(el)!.shadowRoot!.querySelector("[data-split-question]")!.textContent!.trim();
const payTopBar = (el: TillBillPayDialog) =>
  root(el).querySelector<WtTopBar>("[data-quiet-pay] wt-top-bar")!;
const peopleField = (el: TillBillPayDialog) => root(el).querySelector('wt-input[name="people"]');
const amount = (el: TillBillPayDialog) =>
  root(el).querySelector("[data-quiet-pay-amount]")!.textContent!.trim();

async function settle(el: TillBillPayDialog): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await el.updateComplete;
    await screen(el)?.updateComplete;
  }
}

async function choose(el: TillBillPayDialog, way: string): Promise<void> {
  root(el).querySelector<HTMLElement>(`[data-quiet-pay-way="${way}"]`)!.click();
  await settle(el);
}

async function back(bar: WtTopBar, el: TillBillPayDialog): Promise<void> {
  bar.dispatchEvent(new CustomEvent("wt-back", { bubbles: true, composed: true }));
  await settle(el);
}

const startText = (el: TillBillPayDialog) =>
  screen(el)!.shadowRoot!.querySelector("wt-button[data-split-start]")!.textContent!.trim();
const splitBar = (el: TillBillPayDialog) =>
  screen(el)!.shadowRoot!.querySelector<WtTopBar>("wt-top-bar")!;
const backButton = (bar: WtTopBar) =>
  bar.shadowRoot!.querySelector("wt-button")!.shadowRoot!.querySelector("button");
const shareTile = (el: TillBillPayDialog) =>
  root(el).querySelector<HTMLElement>('[data-quiet-pay-way="share"]')!;

function deepActive(): Element | null {
  let focused = document.activeElement;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  return focused;
}

function capture<T>(el: TillBillPayDialog, type: string): T[] {
  const seen: T[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent<T>).detail));
  return seen;
}

describe("till-bill-pay-dialog: Split equally on a table's Pay", () => {
  it("opens the Split equally screen at the table's guest count, and Back returns to the ways", async () => {
    const el = await mount({ receiptGuests: 4 });
    await choose(el, "share");

    expect(root(el).querySelector("[data-quiet-pay]")).toBeNull();
    expect(stepper(el).value).toBe(4);
    expect(question(el)).toBe(t("split_equally.question"));

    await back(screen(el)!.shadowRoot!.querySelector<WtTopBar>("wt-top-bar")!, el);
    expect(screen(el)).toBeNull();
    expect(
      root(el).querySelector<HTMLElement & { selected: boolean }>('[data-quiet-pay-way="whole"]')!
        .selected,
    ).toBe(true);
    expect(amount(el)).toBe(money("73.30"));
  });

  it("starts at 2 when the table's guest count is under 2", async () => {
    const el = await mount({ receiptGuests: 1 });
    await choose(el, "share");
    expect(stepper(el).value).toBe(2);
  });

  it("on a till after one share, with no record, starts at 2 asking who is still to pay", async () => {
    const el = await mount({
      receiptGuests: 4,
      balance: balanceOf({ received: "24.44", outstanding: "48.86" }),
    });
    await choose(el, "share");

    expect(stepper(el).value).toBe(2);
    expect(question(el)).toBe(t("split_equally.question_left"));
  });

  it("counts a card in progress as money held", async () => {
    const el = await mount({
      receiptGuests: 4,
      balance: balanceOf({ reserved: "24.44", outstanding: "48.86" }),
    });
    await choose(el, "share");

    expect(stepper(el).value).toBe(2);
    expect(question(el)).toBe(t("split_equally.question_left"));
  });

  it("Start shows that guest's share with no typed count, and asks the server for a share among the count", async () => {
    const el = await mount({ receiptGuests: 2 });
    const quotes = capture<TablePayQuoteRequest>(el, "bill-pay-quote");
    el.quoteContext = "table bill";
    await choose(el, "share");
    await splitAmong(el, 3);

    expect(screen(el)).toBeNull();
    expect(amount(el)).toBe(money("24.44"));
    expect(peopleField(el)).toBeNull();
    await expect.poll(() => quotes.at(-1)?.asked.choice).toEqual({ kind: "share", shareOf: 3 });
  });

  it("Back from the share's Pay returns to Split equally with its count kept", async () => {
    const el = await mount({ receiptGuests: 2 });
    await choose(el, "share");
    await splitAmong(el, 5);
    expect(payTopBar(el).backLabel).toBe(t("bill_pay.way_share"));

    await back(payTopBar(el), el);

    expect(stepper(el).value).toBe(5);
  });

  it("the entry step draws no count for a share started from Split equally", async () => {
    const el = await mount({ receiptGuests: 2 });
    const previews = capture<PayRequest>(el, "bill-pay-preview");
    await choose(el, "share");
    await splitAmong(el, 3);
    root(el).querySelector<HTMLElement>("[data-quiet-pay-manual]")!.click();
    await settle(el);

    expect(root(el).querySelector("[data-pay-continue]")).not.toBeNull();
    expect(peopleField(el)).toBeNull();
    root(el).querySelector<HTMLElement>("[data-pay-continue]")!.click();
    await settle(el);
    expect(previews.at(-1)!.choice).toEqual({ kind: "share", shareOf: 3 });
  });

  it.each([
    ["before the balance is read", null],
    ["while the balance read showed nothing taken", balanceOf()],
  ])(
    "follows a balance with money taken that arrives while it is open, %s",
    async (_when, first) => {
      const el = await mount({ receiptGuests: 4, balance: first });
      const quotes = capture<TablePayQuoteRequest>(el, "bill-pay-quote");
      el.quoteContext = "table bill";
      await choose(el, "share");

      el.balance = balanceOf({ received: "24.44", outstanding: "48.86" });
      await settle(el);

      expect(stepper(el).value).toBe(2);
      expect(question(el)).toBe(t("split_equally.question_left"));
      expect(startText(el)).toBe(`Start with Guest 1 · ${money("24.43")}`);
      screen(el)!.shadowRoot!.querySelector<HTMLElement>("wt-button[data-split-start]")!.click();
      await settle(el);
      await expect.poll(() => quotes.at(-1)?.asked.choice).toEqual({ kind: "share", shareOf: 2 });
    },
  );

  it("starts at the table's count once a balance with nothing taken arrives after opening", async () => {
    const el = await mount({ receiptGuests: 4, balance: null });
    await choose(el, "share");

    el.balance = balanceOf();
    await settle(el);

    expect(stepper(el).value).toBe(4);
    expect(question(el)).toBe(t("split_equally.question"));
  });

  it("chosen again from another way, starts by the starting rule; tapped again while chosen, keeps its count", async () => {
    const el = await mount({
      receiptGuests: 4,
      balance: balanceOf({ received: "24.44", outstanding: "48.86" }),
    });
    await choose(el, "share");
    await splitAmong(el, 3);

    await choose(el, "whole");
    await choose(el, "share");
    expect(stepper(el).value).toBe(2);

    await splitAmong(el, 3);
    await choose(el, "share");
    expect(stepper(el).value).toBe(3);
  });

  it("on the form after a payment, a share chosen from another way starts by the starting rule", async () => {
    const el = await mount({
      receiptGuests: 4,
      balance: balanceOf({ received: "24.44", outstanding: "48.86" }),
      taken: { change: null },
    });
    const radio = (way: string) =>
      root(el).querySelector<HTMLInputElement>(`input[name="way"][value="${way}"]`)!;
    radio("share").click();
    await settle(el);
    await splitAmong(el, 3);
    expect(radio("share").checked).toBe(true);

    radio("share").click();
    await settle(el);
    expect(stepper(el).value).toBe(3);
    await splitAmong(el, 3);

    radio("whole").click();
    await settle(el);
    radio("share").click();
    await settle(el);
    expect(stepper(el).value).toBe(2);
  });

  it("takes keyboard focus into Split equally, and back to the way or to the share's Pay", async () => {
    const el = await mount({ receiptGuests: 3 });
    shareTile(el).focus();
    await userEvent.keyboard("{Enter}");
    await settle(el);
    await expect.poll(deepActive).toBe(backButton(splitBar(el)));

    await userEvent.keyboard("{Enter}");
    await settle(el);
    expect(screen(el)).toBeNull();
    await expect.poll(deepActive).toBe(shareTile(el).shadowRoot!.querySelector("button"));

    await userEvent.keyboard("{Enter}");
    await settle(el);
    await expect.poll(deepActive).toBe(backButton(splitBar(el)));
    screen(el)!.shadowRoot!.querySelector<HTMLElement>("wt-button[data-split-start]")!.click();
    await settle(el);
    await expect.poll(deepActive).toBe(backButton(payTopBar(el)));
  });

  it("takes nothing for a share chosen with no count", async () => {
    const el = await mount({ way: "share" });

    expect(
      root(el).querySelector<HTMLElement & { disabled: boolean }>("[data-quiet-pay-manual]")!
        .disabled,
    ).toBe(true);
  });

  it("puts a refusal of the count above the action, and a new Start clears it", async () => {
    const el = await mount({ receiptGuests: 2 });
    await choose(el, "share");
    await splitAmong(el, 3);
    el.refusal = { code: "management.request_invalid", field: "shareOf" };
    await settle(el);

    const actions = () =>
      root(el).querySelector<HTMLElement & { error: string }>("wt-form-actions")!;
    expect(actions().error).toBe(codeMessage("management.request_invalid"));

    await back(payTopBar(el), el);
    await splitAmong(el, 2);
    expect(actions().error).toBe("");
  });
});

describe("till-bill-pay-dialog: an equal share on Counter", () => {
  it("keeps the typed count of people still to pay on Pay and on the entry step", async () => {
    const el = await mount({ counter: true });
    await choose(el, "share");

    expect(screen(el)).toBeNull();
    expect(peopleField(el)).not.toBeNull();
    await splitAmong(el, 3);
    root(el).querySelector<HTMLElement>("[data-quiet-pay-manual]")!.click();
    await settle(el);
    expect(peopleField(el)).not.toBeNull();
  });
});
