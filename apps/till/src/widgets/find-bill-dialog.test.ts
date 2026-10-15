import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./find-bill-dialog.js";
import type { TillFindBillDialog } from "./find-bill-dialog.js";
import type { BillLookupRow } from "../api/client.js";

const debt: BillLookupRow = {
  workingOrderId: "wo-1",
  orderNumber: 12,
  label: "Birthday",
  partyName: "Familia Ruiz",
  tables: ["Mesa 4"],
  invoiceNumber: "A/12",
  openedAt: "2026-10-01T18:00:00.000Z",
  departedAt: "2026-10-01T21:30:00.000Z",
  status: "left_without_paying",
  stillOwed: "30.00",
};
async function mount(bill = debt) {
  const { el } = await mountWidget<TillFindBillDialog>("till-find-bill-dialog", { bill });
  return el;
}
function input(el: TillFindBillDialog, name: string) {
  return el.shadowRoot!.querySelector<
    HTMLElement & { value: string; error: string; updateComplete: Promise<unknown> }
  >(`[name="${name}"]`)!;
}
async function type(el: TillFindBillDialog, name: string, value: string) {
  input(el, name).shadowRoot!.querySelector<HTMLInputElement>("input")!.value = value;
  input(el, name)
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}
async function click(el: TillFindBillDialog, selector: string) {
  el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
  await el.updateComplete;
}

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
});

describe("Find a bill", () => {
  it("shows the selected debt with its invoice, table, name and amount", async () => {
    const el = await mount();
    expect(el.shadowRoot!.textContent).toContain("Familia Ruiz");
    expect(el.shadowRoot!.textContent).toContain("A/12");
    expect(el.shadowRoot!.textContent).toContain("Mesa 4");
    expect(el.shadowRoot!.textContent).toContain("30.00");
  });

  it("collects the chosen invoice debt with a cash tender and closes only after the app succeeds", async () => {
    const el = await mount();
    const paid: unknown[] = [];
    el.addEventListener("find-bill-pay", (event) => paid.push((event as CustomEvent).detail));
    await click(el, "[data-collect]");
    expect(paid).toEqual([
      {
        workingOrderId: "wo-1",
        tender: { method: "cash", amount: "30.00" },
        invoiced: true,
      },
    ]);
  });

  it("refuses cash below the debt and sends a card reference with the exact debt", async () => {
    const el = await mount();
    const paid: unknown[] = [];
    el.addEventListener("find-bill-pay", (event) => paid.push((event as CustomEvent).detail));
    await type(el, "cash-received", "20.00");
    await click(el, "[data-collect]");
    expect(paid).toEqual([]);
    expect(input(el, "cash-received").error).toContain("30.00");
    await click(el, "[data-card]");
    await type(el, "terminal-reference", "123456");
    await click(el, "[data-collect]");
    expect(paid).toEqual([
      {
        workingOrderId: "wo-1",
        tender: { method: "card", amount: "30.00", externalRef: "123456" },
        invoiced: true,
      },
    ]);
  });

  it("marks a bill without an invoice for an original receipt and returns to the page", async () => {
    const el = await mount({ ...debt, invoiceNumber: null });
    const paid: unknown[] = [];
    el.addEventListener("find-bill-pay", (event) => paid.push((event as CustomEvent).detail));
    await click(el, "[data-collect]");
    expect(paid).toEqual([
      { workingOrderId: "wo-1", tender: { method: "cash", amount: "30.00" }, invoiced: false },
    ]);
    const closed = vi.fn();
    el.addEventListener("find-bill-close", closed);
    await click(el, "[slot=cancel]");
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
  });

  it("tells the app when a new bill is selected and when the collector closes", async () => {
    const el = await mount();
    const changes = vi.fn(),
      closes = vi.fn();
    el.addEventListener("find-bill-selection", changes);
    el.addEventListener("find-bill-close", closes);
    el.bill = { ...debt, workingOrderId: "wo-2" };
    await el.updateComplete;
    expect(changes).toHaveBeenCalledTimes(1);
    await click(el, "[slot=cancel]");
    await vi.waitFor(() => expect(closes).toHaveBeenCalledTimes(1));
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "en",
      "This would take the order over €3,010.00, the most this till accepts without a full invoice naming the customer, which it cannot issue. Take something off the order.",
    ],
    [
      "es",
      "El pedido pasaría de 3010,00 €, el máximo que admite esta caja sin una factura completa a nombre del cliente, y no puede emitirla. Quita algo del pedido.",
    ],
  ])("words an over-limit refusal naming the limit in %s", async (locale, sentence) => {
    setLocale(locale);
    const el = await mount();
    el.error = { overLimit: "3010.00" };
    await el.updateComplete;
    const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
    await actions.updateComplete;
    expect(
      actions.shadowRoot!.querySelector("[data-error]")!.textContent!.trim().replace(/\s/g, " "),
    ).toBe(sentence);
  });

  it("keeps the collector readable at phone width", async () => {
    await page.viewport(390, 844);
    try {
      const el = await mount();
      const dialog = el
        .shadowRoot!.querySelector("wt-dialog")!
        .shadowRoot!.querySelector("dialog")!;
      expect(dialog.getBoundingClientRect().width).toBeGreaterThanOrEqual(300);
      expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(390);
    } finally {
      await page.viewport(1280, 720);
    }
  });
});

it("decimal input cash collection shows Spanish and refuses grouped or over-precision text", async () => {
  setLocale("es");
  const el = await mount();
  const paid: unknown[] = [];
  el.addEventListener("find-bill-pay", (event) => paid.push((event as CustomEvent).detail));
  const control = input(el, "cash-received");
  await control.updateComplete;
  const native = control.shadowRoot!.querySelector("input")!;
  expect(native.value).toBe("30,00");
  for (const bad of ["40,123", "1,234.56", "1.234,56", "1 234,56"]) {
    await type(el, "cash-received", bad);
    await click(el, "[data-collect]");
    expect(paid).toEqual([]);
    expect(control.error).not.toBe("");
  }
  await type(el, "cash-received", "40,80");
  await click(el, "[data-collect]");
  expect(paid).toEqual([
    { workingOrderId: "wo-1", tender: { method: "cash", amount: "40.80" }, invoiced: true },
  ]);
});

it("a selected collector has no search, and clean Back closes to the page", async () => {
  const { el } = await mountWidget<TillFindBillDialog>("till-find-bill-dialog", { bill: debt });
  const closed = vi.fn();
  el.addEventListener("find-bill-close", closed);
  expect(el.shadowRoot!.querySelector("[name=bill-search]")).toBeNull();
  expect(input(el, "cash-received").value).toBe("30.00");
  await click(el, "[slot=cancel]");
  await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
  expect(el.shadowRoot!.querySelector("[data-search]")).toBeNull();
});
it("no selected bill means no collection or legacy search", async () => {
  const { el } = await mountWidget<TillFindBillDialog>("till-find-bill-dialog", {});
  expect(el.shadowRoot!.querySelector("[name=bill-search]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-collect]")).toBeNull();
});
