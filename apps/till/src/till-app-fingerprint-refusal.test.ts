import { page } from "vitest/browser";
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
  billOf,
  dialog,
  openDialog,
  type,
  press,
  inDialog,
} from "../test/bill-pay-app.js";
import { cleanupWidgets, mountWidget, cancelThroughDialog } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillProduct } from "./api/client.js";
import { setLocale } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";

const refusal = { code: "fiscal.fingerprint_mismatch", status: 409 };
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
    (["cash", "card", "reader"] as const).map((method) => ({ locale, method })),
  ),
)(
  "keeps the $method counter basket and allows an explicit retry in $locale",
  async ({ locale, method }) => {
    const write = vi.fn().mockRejectedValue(refusal);
    const { el } = await mount(
      locale,
      method === "reader" ? { pay: write } : { recordSale: write },
    );
    const screen = await openCounter(el);
    const event = method === "reader" ? "collect-card" : "confirm-payment";
    const detail =
      method === "reader"
        ? {}
        : {
            method,
            amount: "5.00",
            ...(method === "card" ? { externalRef: "terminal-operation" } : {}),
          };
    emit(screen, event, detail);
    await flush(el);
    expectRefused(el);
    expect(screen.store.lines).toHaveLength(1);
    expect(write).toHaveBeenCalledOnce();
    expect(screen.busy).toBe(false);
    emit(screen, event, detail);
    await flush(el);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
    expectRefused(el);
  },
);

it.each(["en-GB", "es-ES"])("keeps a whole table payment retryable in %s", async (locale) => {
  const write = vi.fn().mockRejectedValue(refusal);
  const { el } = await mount(locale, { recordSale: write });
  const screen = await openTable(el);
  emit(screen, "pay-tab", { method: "cash", amount: "120.00" });
  await flush(el);
  expectRefused(el);
  expect(tableOrder(el)).toBe(screen);
  expect(screen.lines.length).toBeGreaterThan(0);
  expect(write).toHaveBeenCalledOnce();
  emit(screen, "pay-tab", { method: "cash", amount: "120.00" });
  await flush(el);
  expect(write).toHaveBeenCalledTimes(2);
});

it.each(["en-GB", "es-ES"])(
  "preserves the bill payment choice and permits retry in %s",
  async (locale) => {
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
    expect(dialog(el)!.isConnected).toBe(true);
    expect(write).toHaveBeenCalledOnce();
    expect(inDialog(el, "[data-pay-continue]")!.disabled).toBe(false);
    await press(el, "[data-pay-continue]");
    emit(dialog(el)!, "bill-pay-confirm", { guestCount: 4 });
    await flush(el);
    expect(write).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector("till-paid-view")).toBeNull();
  },
);

it.each(["en-GB", "es-ES"])("keeps a refused line edit on its table in %s", async (locale) => {
  const write = vi.fn().mockRejectedValue(refusal);
  const { el } = await mount(locale, { updateOrderLine: write });
  const screen = await openTable(el);
  const detail = { lineNo: 1, lineName: "Dish", patch: { quantity: "2" }, revision: 0 };
  emit(screen, "change-line", detail);
  await flush(el);
  expectRefused(el);
  expect(tableOrder(el)).toBe(screen);
  expect(write).toHaveBeenCalledOnce();
  emit(screen, "change-line", detail);
  await flush(el);
  expect(write).toHaveBeenCalledTimes(2);
});

it.each(["en-GB", "es-ES"])("keeps a refused cancellation in its dialog in %s", async (locale) => {
  const write = vi.fn().mockRejectedValue(refusal);
  const { el } = await mount(locale, { applyAdjustment: write });
  const screen = await openTable(el);
  await cancelThroughDialog(el, screen, "line-1", () => flush(el));
  const editor = el.shadowRoot!.querySelector("till-adjustment-dialog")!;
  await editor.updateComplete;
  expect(editor.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
    codeMessage(refusal.code),
  );
  expect(write).toHaveBeenCalledOnce();
  expect(tableOrder(el)).toBe(screen);
});

it.each(["en-GB", "es-ES"])("keeps a refused collection retryable in %s", async (locale) => {
  const write = vi.fn().mockRejectedValue(refusal);
  const { el } = await mount(locale, { collectOrder: write });
  const screen = await openCounter(el);
  emit(screen, "collect-order", { method: "cash", amount: "5.00" });
  await flush(el);
  expectRefused(el);
  expect(screen.store.lines).toHaveLength(1);
  expect(screen.busy).toBe(false);
  expect(write).toHaveBeenCalledOnce();
  emit(screen, "collect-order", { method: "cash", amount: "5.00" });
  await flush(el);
  expect(write).toHaveBeenCalledTimes(2);
});

it.each(["en-GB", "es-ES"])("keeps a refused placement and its basket in %s", async (locale) => {
  const write = vi.fn().mockRejectedValue(refusal);
  const { el } = await mount(locale, { placeOrder: write });
  const screen = await openCounter(el);
  emit(screen, "place-order", { label: "Counter" });
  await flush(el);
  expectRefused(el);
  expect(screen.store.lines).toHaveLength(1);
  expect(screen.busy).toBe(false);
  expect(write).toHaveBeenCalledOnce();
  emit(screen, "place-order", { label: "Counter" });
  await flush(el);
  expect(write).toHaveBeenCalledTimes(2);
});

it.each(["en-GB", "es-ES"])("keeps a refused discard in the held list in %s", async (locale) => {
  const write = vi.fn().mockRejectedValue(refusal);
  const held = {
    items: [],
    id: "held",
    orderNumber: 5,
    label: "Counter",
    counts: { ordered: 2, unsent: 0, held: 0, waiting: 0, ready: 0 },
    total: "3.00",
    outstanding: "3.00",
    hasPayments: false,
    partyId: null,
    openedAt: "2026-08-05T10:00:00.000Z",
    signals: [],
  };
  const { el } = await mount(locale, {
    abandonWorkingOrder: write,
    listWorkingOrders: vi.fn().mockResolvedValue([held]),
  });
  const screen = await openCounter(el);
  emit(screen, "discard-order", { id: held.id });
  await flush(el);
  expectRefused(el);
  expect(screen.heldOrders).toEqual([held]);
  expect(write).toHaveBeenCalledOnce();
  emit(screen, "discard-order", { id: held.id });
  await flush(el);
  expect(write).toHaveBeenCalledTimes(2);
});

it.each(["en-GB", "es-ES"])(
  "retains the unpaid departure reason and permits retry in %s",
  async (locale) => {
    const write = vi.fn().mockRejectedValue(refusal);
    const { el } = await mount(locale, { recordUnpaidDeparture: write });
    const screen = await openTable(el);
    emit(screen, "record-unpaid-departure");
    await flush(el);
    const editor = el.shadowRoot!.querySelector("till-unpaid-departure-dialog")!;
    const field = editor
      .shadowRoot!.querySelector('wt-input[name="reason"]')!
      .shadowRoot!.querySelector("input")!;
    field.value = "Guests left";
    field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await flush(el);
    const button = () =>
      editor.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
        "[data-departure-confirm]",
      )!;
    button().click();
    await flush(el);
    expect(editor.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
      codeMessage(refusal.code),
    );
    expect(field.value).toBe("Guests left");
    expect(button().disabled).toBe(false);
    expect(tableOrder(el)).toBe(screen);
    expect(write).toHaveBeenCalledOnce();
    button().click();
    await flush(el);
    expect(write).toHaveBeenCalledTimes(2);
  },
);

it.each(["en-GB", "es-ES"])("retains the credit reason and permits retry in %s", async (locale) => {
  const write = vi.fn().mockRejectedValue(refusal);
  const { el } = await mount(locale, {
    cancelOrder: write,
    getPartyBills: vi
      .fn()
      .mockResolvedValue([
        billOf({ status: "placed", receiptAvailable: true, invoiceNumber: "A/1" }),
      ]),
  });
  const screen = await openTable(el);
  emit(screen, "cancel-credit-bill", { workingOrderId: "wo-4" });
  await flush(el);
  const editor = el.shadowRoot!.querySelector("till-cancel-credit-dialog")!;
  const field = editor
    .shadowRoot!.querySelector('wt-input[name="reason"]')!
    .shadowRoot!.querySelector("input")!;
  field.value = "Order cancelled";
  field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await flush(el);
  const button = () =>
    editor.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-cancel-credit-confirm]",
    )!;
  button().click();
  await flush(el);
  expect(editor.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
    codeMessage(refusal.code),
  );
  expect(field.value).toBe("Order cancelled");
  expect(button().disabled).toBe(false);
  expect(editor.shadowRoot!.querySelector("[data-cancel-credit-done]")).toBeNull();
  expect(write).toHaveBeenCalledOnce();
  button().click();
  await flush(el);
  expect(write).toHaveBeenCalledTimes(2);
});

it.each(
  ["en-GB", "es-ES"].flatMap((locale) =>
    (["light", "dark"] as const).flatMap((theme) =>
      [390, 1280].map((width) => ({ locale, theme, width })),
    ),
  ),
)("shows the refusal at $width in $locale/$theme", async ({ locale, theme, width }) => {
  await page.viewport(width, 900);
  try {
    const { el } = await mount(locale, { recordSale: vi.fn().mockRejectedValue(refusal) }, theme);
    const screen = await openCounter(el);
    emit(screen, "confirm-payment", { method: "cash", amount: "5.00" });
    await flush(el);
    expectRefused(el);
    const box = banner(el)!.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(0);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `__screenshots__/a1003-till-${locale}-${theme}-${width}.png` });
  } finally {
    await page.viewport(1280, 900);
  }
});
