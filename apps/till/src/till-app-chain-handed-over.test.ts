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
  catalogueId: "cat-default",
  catalogueName: "Drinks",
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
    expect(banner(el)?.textContent).toMatch(
      locale === "es-ES" ? /servidor principal/ : /main server/,
    );
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
  expect(banner(el)?.textContent).toMatch(
    locale === "es-ES" ? /servidor principal/ : /main server/,
  );
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
    locale === "es-ES" ? /servidor principal/ : /main server/,
  );
  expect(write).toHaveBeenCalledOnce();
});

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
