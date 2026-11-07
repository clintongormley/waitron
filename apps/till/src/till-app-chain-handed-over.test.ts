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
import { setLocale } from "./i18n/t.js";
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
  expect(el.shadowRoot!.querySelector("till-ticket-view, till-paid-view")).toBeNull();
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
