import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  emit,
  flush,
  lock,
  shell,
  openTable,
  tableOrder,
  stubApi,
  resetBillPayDrafts,
  till,
  dialog,
  openDialog,
  type,
  press,
  inDialog,
} from "../test/bill-pay-app.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillProduct } from "./api/client.js";
import { setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";

const refusal = { code: "fiscal.chain_handed_over", status: 409, nodeId: "this-box" };
const product: TillProduct = {
  id: "coffee",
  menuItemId: "coffee-offer",
  name: "Staff coffee",
  customerName: { en: "Customer coffee" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
  menuId: "cat-default",
  menuName: "Drinks",
};
const counter = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>('[role="alert"]');

beforeEach(() => {
  resetBillPayDrafts();
  setLocale("en-GB");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function mount(
  locale: string,
  overrides: Record<string, unknown> = {},
  theme: "light" | "dark" = "light",
) {
  const api = stubApi({
    getTill: vi.fn().mockResolvedValue({
      ...till,
      locale,
      capabilities: ["take-cash", "hand-keyed-card-payment", "integrated-card-payment"],
    }),
    readCurrentOrders: vi.fn().mockResolvedValue({
      revision: 0,
      hasGroups: false,
      nextDisplayNumber: 1,
      retainedCourses: [],
      reminder: null,
      groups: [],
      ungrouped: [],
    }),
    parkOrder: vi.fn().mockResolvedValue({ id: "held", orderNumber: 5 }),
    getKitchenNote: vi.fn(async (scope) => ({ scope, note: null, revision: 0, ownerRevision: 0 })),
    ...overrides,
  });
  const { el, host } = await mountWidget<TillApp>("till-app", { api }, theme);
  return { el, host, api };
}

async function openCounter(el: TillApp) {
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Operator", permissions: [] });
  await flush(el);
  emit(shell(el), "screen-select", { screen: "counter" });
  await flush(el);
  const screen = counter(el);
  screen.store.addProduct(product, "2");
  await flush(el);
  return screen;
}

function expectRefused(el: TillApp) {
  expect(banner(el)?.textContent?.trim()).toBe(codeMessage(refusal.code));
  expect(el.shadowRoot!.textContent).not.toContain(refusal.code);
  expect(
    el.shadowRoot!.querySelector("till-ticket-view, till-settlement-document-dialog"),
  ).toBeNull();
}

it.each(
  ["en-GB", "es-ES"].flatMap((locale) =>
    (["cash", "reader"] as const).map((method) => ({ locale, method })),
  ),
)(
  "says a $method counter sale was refused because this is no longer the main server, in $locale",
  async ({ locale, method }) => {
    const write = vi.fn().mockRejectedValue(refusal);
    const { el } = await mount(
      locale,
      method === "reader" ? { pay: write } : { recordSale: write },
    );
    const screen = await openCounter(el);
    emit(
      screen,
      method === "reader" ? "collect-card" : "confirm-payment",
      method === "reader" ? {} : { method, amount: "5.00" },
    );
    await flush(el);
    expectRefused(el);
    expect(banner(el)?.textContent).toMatch(locale === "es-ES" ? /servidor principal/ : /main box/);
    expect(write).toHaveBeenCalledOnce();
  },
);

it.each(
  ["en-GB", "es-ES"].flatMap((locale) =>
    ["fiscal.chain_handed_over", "handover.stepping_down"].map((code) => ({ locale, code })),
  ),
)(
  "adds terminal refund advice for $code on a hand-keyed card counter sale in $locale",
  async ({ locale, code }) => {
    const write = vi.fn().mockRejectedValue({ ...refusal, code });
    const { el } = await mount(locale, { recordSale: write });
    const screen = await openCounter(el);
    emit(screen, "confirm-payment", { method: "card", amount: "3.00" });
    await flush(el);
    expect(banner(el)?.textContent?.trim()).toBe(t("sale.chain_handed_over_manual_card"));
    expect(banner(el)?.textContent).toMatch(locale === "es-ES" ? /datáfono/ : /terminal/);
    expect(write).toHaveBeenCalledOnce();
  },
);

it("says nothing of a terminal when no card was taken", async () => {
  const { el } = await mount("en-GB", { recordSale: vi.fn().mockRejectedValue(refusal) });
  const screen = await openCounter(el);
  emit(screen, "confirm-payment", { method: "cash", amount: "5.00" });
  await flush(el);
  expect(banner(el)?.textContent).not.toMatch(/terminal/);
});

it.each(["en-GB", "es-ES"])("says a whole table payment was refused in %s", async (locale) => {
  const write = vi.fn().mockRejectedValue(refusal);
  const { el } = await mount(locale, { recordSale: write });
  await openTable(el);
  emit(tableOrder(el)!, "pay-tab", { method: "cash", amount: "120.00" });
  await flush(el);
  expectRefused(el);
  expect(banner(el)?.textContent).toMatch(locale === "es-ES" ? /servidor principal/ : /main box/);
});

it.each(["en-GB", "es-ES"])("says a bill payment was refused in %s", async (locale) => {
  const write = vi.fn().mockRejectedValue(refusal);
  const { el } = await mount(locale, { takeBillPayment: write });
  await openTable(el);
  await openDialog(el, "contribution");
  await type(el, "amount", "40");
  await type(el, "tendered", "50");
  await press(el, "[data-pay-continue]");
  emit(dialog(el)!, "bill-pay-confirm", { guestCount: 4 });
  await flush(el);
  expect(inDialog(el, "wt-form-actions")!.error).toBe(codeMessage(refusal.code));
  expect(inDialog(el, "wt-form-actions")!.error).toMatch(
    locale === "es-ES" ? /servidor principal/ : /main box/,
  );
  expect(write).toHaveBeenCalledOnce();
});

it.each(["en-GB", "es-ES"])(
  "says a cash bill payment was refused by a box handing over in %s",
  async (locale) => {
    const write = vi.fn().mockRejectedValue({ code: "handover.stepping_down", status: 503 });
    const { el } = await mount(locale, { takeBillPayment: write });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    emit(dialog(el)!, "bill-pay-confirm", { guestCount: 4 });
    await flush(el);
    expect(inDialog(el, "wt-form-actions")!.error).toBe(codeMessage("handover.stepping_down"));
    expect(inDialog(el, "wt-form-actions")!.error).toMatch(
      locale === "es-ES" ? /traspasando el local/ : /handing over/,
    );
    expect(dialog(el)!.confirmationLocked).toBe(false);
    expect(write).toHaveBeenCalledOnce();
  },
);

it.each(["en-GB", "es-ES"])(
  "keeps a bill payment unconfirmed when its resend after no answer is refused by a box handing over, in %s",
  async (locale) => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValue({ code: "handover.stepping_down", status: 503 });
    const { el } = await mount(locale, { takeBillPayment: write });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    emit(dialog(el)!, "bill-pay-confirm", { guestCount: 4 });
    await expect.poll(() => write.mock.calls.length, { timeout: 10_000 }).toBe(2);
    await flush(el);
    const error = inDialog(el, "wt-form-actions")!.error;
    expect(error).not.toBe(codeMessage("handover.stepping_down"));
    expect(error).toBe(t("bill_pay.unconfirmed"));
    expect(error).toMatch(
      locale === "es-ES" ? /No se ha podido confirmar/ : /could not be confirmed/,
    );
    expect(dialog(el)!.confirmationLocked).toBe(true);
    emit(dialog(el)!, "bill-pay-confirm", { guestCount: 4 });
    await expect.poll(() => write.mock.calls.length, { timeout: 10_000 }).toBe(3);
    await flush(el);
    const ids = write.mock.calls.map(([, request]) => request.submissionId);
    expect(new Set(ids).size).toBe(1);
    expect(inDialog(el, "wt-form-actions")!.error).toBe(t("bill_pay.unconfirmed"));
    expect(dialog(el)!.confirmationLocked).toBe(true);
  },
);

it.each(["en-GB", "es-ES"])(
  "says a card reader bill payment was refused by a box handing over in %s",
  async (locale) => {
    const reader = { id: "5b1c3a52-0000-4000-8000-000000000001", name: "Barra" };
    const write = vi.fn().mockRejectedValue({ code: "handover.stepping_down", status: 503 });
    const { el } = await mount(locale, {
      getTill: vi.fn().mockResolvedValue({
        ...till,
        locale,
        cardProvider: "stripe_terminal",
        capabilities: ["take-cash", "integrated-card-payment"],
        activeReaders: [{ ...reader, provider: "stripe_terminal" }],
        defaultReaderId: reader.id,
      }),
      previewBillPayment: vi.fn().mockResolvedValue({
        kind: "allocated",
        choice: null,
        applied: "40.00",
        tip: "0.00",
        change: null,
        charged: "40.00",
      }),
      takeBillPayment: write,
    });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    await flush(el);
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]![1]).toMatchObject({ method: "card", entry: "reader" });
    expect(inDialog(el, "wt-form-actions")!.error).toBe(codeMessage("handover.stepping_down"));
    expect(inDialog(el, "wt-form-actions")!.error).toMatch(
      locale === "es-ES" ? /traspasando el local/ : /handing over/,
    );
    expect(dialog(el)!.confirmationLocked).toBe(false);
  },
);

it.each(["en-GB", "es-ES"])(
  "keeps terminal refund advice on a stopped hand-keyed table bill in %s",
  async (locale) => {
    const write = vi.fn().mockRejectedValue({ ...refusal, code: "handover.stepping_down" });
    const { el } = await mount(locale, { takeBillPayment: write });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    inDialog(el, 'input[name="method"][value="card"]')!.click();
    await flush(el);
    await type(el, "externalRef", "123");
    await press(el, "[data-pay-continue]");
    emit(dialog(el)!, "bill-pay-confirm", { guestCount: 4 });
    await flush(el);
    expect(inDialog(el, "wt-form-actions")!.error).toBe(t("sale.chain_handed_over_manual_card"));
    expect(write).toHaveBeenCalledOnce();
  },
);

const noAnswer = () => new TypeError("Failed to fetch");
const steppingDown = { code: "handover.stepping_down", status: 503 };
const sendOf = { manual: "recordSale", reader: "pay", collect: "collectOrder" } as const;
const eventOf = {
  manual: "confirm-payment",
  reader: "collect-card",
  collect: "collect-order",
} as const;
const unconfirmedWords = (locale: string) =>
  locale === "es-ES" ? /El servidor no respondió/ : /did not answer/;

it.each(
  ["en-GB", "es-ES"].flatMap((locale) =>
    (["manual", "reader", "collect"] as const).map((method) => ({ locale, method })),
  ),
)(
  "keeps a $method counter sale unconfirmed when a later tap is refused by a box handing over, in $locale",
  async ({ locale, method }) => {
    const write = vi.fn().mockRejectedValueOnce(noAnswer()).mockRejectedValue(steppingDown);
    const { el } = await mount(locale, { [sendOf[method]]: write });
    const screen = await openCounter(el);
    const tap = () =>
      emit(screen, eventOf[method], method === "reader" ? {} : { method: "card", amount: "3.00" });
    tap();
    await flush(el);
    expect(banner(el)?.textContent?.trim()).toBe(t("sale.unconfirmed"));
    tap();
    await flush(el);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
    const shown = banner(el)?.textContent?.trim();
    expect(shown).not.toBe(t("sale.chain_handed_over_manual_card"));
    expect(shown).not.toBe(codeMessage("handover.stepping_down"));
    expect(shown).toBe(t("sale.unconfirmed"));
    expect(shown).toMatch(unconfirmedWords(locale));
  },
);

const notPermitted = {
  code: "authorization.not_permitted",
  status: 403,
  permission: "payment.take",
};

it.each(
  ["en-GB", "es-ES"].flatMap((locale) =>
    (["manual", "reader", "collect"] as const).map((method) => ({ locale, method })),
  ),
)(
  "keeps a $method counter sale unconfirmed through a refused tap before a box handing over refuses, in $locale",
  async ({ locale, method }) => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(noAnswer())
      .mockRejectedValueOnce(notPermitted)
      .mockRejectedValue(steppingDown);
    const { el } = await mount(locale, { [sendOf[method]]: write });
    const screen = await openCounter(el);
    const tap = () =>
      emit(screen, eventOf[method], method === "reader" ? {} : { method: "card", amount: "3.00" });
    tap();
    await flush(el);
    expect(banner(el)?.textContent?.trim()).toBe(t("sale.unconfirmed"));
    tap();
    await flush(el);
    expect(banner(el)?.textContent?.trim()).toBe(t("take_payment.not_permitted"));
    tap();
    await flush(el);
    expect(write).toHaveBeenCalledTimes(3);
    expect(write.mock.calls[2]).toEqual(write.mock.calls[0]);
    const shown = banner(el)?.textContent?.trim();
    expect(shown).not.toBe(t("sale.chain_handed_over_manual_card"));
    expect(shown).not.toMatch(locale === "es-ES" ? /datáfono/ : /terminal/);
    expect(shown).not.toBe(codeMessage("handover.stepping_down"));
    expect(shown).not.toMatch(locale === "es-ES" ? /traspasando el local/ : /handing over/);
    expect(shown).toBe(t("sale.unconfirmed"));
    expect(shown).toMatch(unconfirmedWords(locale));
  },
);

it.each(
  ["en-GB", "es-ES"].flatMap((locale) =>
    (["manual", "collect"] as const).map((method) => ({ locale, method })),
  ),
)(
  "gives terminal refund advice on a $method counter sale once a refusal says the unanswered tap was not recorded, in $locale",
  async ({ locale, method }) => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(noAnswer())
      .mockRejectedValueOnce({ code: "bill.unsent_dishes", status: 409, billId: "bill-1" })
      .mockRejectedValue(steppingDown);
    const { el } = await mount(locale, { [sendOf[method]]: write });
    const screen = await openCounter(el);
    const tap = () => emit(screen, eventOf[method], { method: "card", amount: "3.00" });
    tap();
    await flush(el);
    expect(banner(el)?.textContent?.trim()).toBe(t("sale.unconfirmed"));
    tap();
    await flush(el);
    expect(banner(el)?.textContent?.trim()).not.toBe(t("sale.unconfirmed"));
    tap();
    await flush(el);
    expect(write).toHaveBeenCalledTimes(3);
    expect(write.mock.calls[2]).toEqual(write.mock.calls[0]);
    const shown = banner(el)?.textContent?.trim();
    expect(shown).not.toBe(t("sale.unconfirmed"));
    expect(shown).toBe(t("sale.chain_handed_over_manual_card"));
    expect(shown).toMatch(locale === "es-ES" ? /datáfono/ : /terminal/);
  },
);

it.each(["en-GB", "es-ES"])(
  "names a box handing over on a reader counter sale once an answer follows the unanswered tap, in %s",
  async (locale) => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(noAnswer())
      .mockResolvedValueOnce({ outcome: "declined" })
      .mockRejectedValue(steppingDown);
    const { el } = await mount(locale, { pay: write });
    const screen = await openCounter(el);
    const tap = () => emit(screen, "collect-card", {});
    tap();
    await flush(el);
    expect(banner(el)?.textContent?.trim()).toBe(t("sale.unconfirmed"));
    tap();
    await flush(el);
    tap();
    await flush(el);
    expect(write).toHaveBeenCalledTimes(3);
    expect(write.mock.calls[2]).toEqual(write.mock.calls[0]);
    expect(banner(el)?.textContent?.trim()).toBe(codeMessage("handover.stepping_down"));
    expect(banner(el)?.textContent).toMatch(
      locale === "es-ES" ? /traspasando el local/ : /handing over/,
    );
  },
);

it.each(
  ["en-GB", "es-ES"].flatMap((locale) =>
    (["reader", "collect"] as const).map((method) => ({ locale, method })),
  ),
)(
  "names a box handing over on a $method counter sale when no earlier tap went unanswered, in $locale",
  async ({ locale, method }) => {
    const write = vi.fn().mockRejectedValue(steppingDown);
    const { el } = await mount(locale, { [sendOf[method]]: write });
    emit(
      await openCounter(el),
      eventOf[method],
      method === "reader" ? {} : { method: "card", amount: "3.00" },
    );
    await flush(el);
    expect(banner(el)?.textContent?.trim()).toBe(
      method === "reader"
        ? codeMessage("handover.stepping_down")
        : t("sale.chain_handed_over_manual_card"),
    );
    expect(banner(el)?.textContent).toMatch(
      method === "reader"
        ? locale === "es-ES"
          ? /traspasando el local/
          : /handing over/
        : locale === "es-ES"
          ? /datáfono/
          : /terminal/,
    );
  },
);

it.each(
  ["en-GB", "es-ES"].flatMap((locale) =>
    [true, false].map((unanswered) => ({ locale, unanswered })),
  ),
)(
  "on a whole table bill paid by hand-keyed card, a box handing over is named only when no earlier send went unanswered (earlier unanswered: $unanswered), in $locale",
  async ({ locale, unanswered }) => {
    const write = unanswered
      ? vi.fn().mockRejectedValueOnce(noAnswer()).mockRejectedValue(steppingDown)
      : vi.fn().mockRejectedValue(steppingDown);
    const { el } = await mount(locale, { recordSale: write });
    await openTable(el);
    const tap = () =>
      emit(tableOrder(el)!, "pay-tab", { method: "card", amount: "120.00", externalRef: "op-1" });
    if (unanswered) {
      tap();
      await flush(el);
      expect(banner(el)?.textContent?.trim()).toBe(t("sale.unconfirmed"));
    }
    tap();
    await flush(el);
    expect(write).toHaveBeenCalledTimes(unanswered ? 2 : 1);
    expect(write.mock.calls.at(-1)).toEqual(write.mock.calls[0]);
    const shown = banner(el)?.textContent?.trim();
    if (unanswered) {
      expect(shown).not.toBe(t("sale.chain_handed_over_manual_card"));
      expect(shown).toBe(t("sale.unconfirmed"));
      expect(shown).toMatch(unconfirmedWords(locale));
    } else {
      expect(shown).toBe(t("sale.chain_handed_over_manual_card"));
      expect(shown).toMatch(locale === "es-ES" ? /datáfono/ : /terminal/);
    }
  },
);

it.each(["en-GB", "es-ES"])(
  "keeps a whole table bill paid by hand-keyed card unconfirmed through a refused send before a box handing over refuses, in %s",
  async (locale) => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(noAnswer())
      .mockRejectedValueOnce(notPermitted)
      .mockRejectedValue(steppingDown);
    const { el } = await mount(locale, { recordSale: write });
    await openTable(el);
    const tap = () =>
      emit(tableOrder(el)!, "pay-tab", { method: "card", amount: "120.00", externalRef: "op-1" });
    tap();
    await flush(el);
    expect(banner(el)?.textContent?.trim()).toBe(t("sale.unconfirmed"));
    tap();
    await flush(el);
    expect(banner(el)?.textContent?.trim()).not.toBe(t("sale.unconfirmed"));
    tap();
    await flush(el);
    expect(write).toHaveBeenCalledTimes(3);
    expect(write.mock.calls[2]).toEqual(write.mock.calls[0]);
    const shown = banner(el)?.textContent?.trim();
    expect(shown).not.toMatch(locale === "es-ES" ? /datáfono/ : /terminal/);
    expect(shown).toBe(t("sale.unconfirmed"));
    expect(shown).toMatch(unconfirmedWords(locale));
  },
);
