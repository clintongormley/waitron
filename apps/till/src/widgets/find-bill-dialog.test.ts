import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./find-bill-dialog.js";
import type { TillFindBillDialog } from "./find-bill-dialog.js";
import type { BillLookupRow, TillApi } from "../api/client.js";

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
const lookUpBills = vi.fn(async () => ({ bills: [debt] }));
const api = { lookUpBills } as unknown as TillApi;

async function mount() {
  const { el } = await mountWidget<TillFindBillDialog>("till-find-bill-dialog", { api });
  return el;
}
function input(el: TillFindBillDialog, name: string) {
  return el.shadowRoot!.querySelector<HTMLElement & { value: string; error: string }>(
    `[name="${name}"]`,
  )!;
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
  lookUpBills.mockClear();
});

describe("Find a bill", () => {
  it("searches by the text typed and shows a debt with its invoice, table, name and amount", async () => {
    const el = await mount();
    await type(el, "bill-search", "A/12");
    await click(el, "[data-search]");
    await vi.waitFor(() => expect(lookUpBills).toHaveBeenCalledWith("A/12"));
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-bill]")).not.toBeNull());
    expect(el.shadowRoot!.querySelector("[data-bill]")!.textContent).toContain("Familia Ruiz");
    expect(el.shadowRoot!.querySelector("[data-bill]")!.textContent).toContain("A/12");
    expect(el.shadowRoot!.querySelector("[data-bill]")!.textContent).toContain("Mesa 4");
    expect(el.shadowRoot!.querySelector("[data-bill]")!.textContent).toContain("30.00");
  });

  it("refuses an empty search beside the field", async () => {
    const el = await mount();
    await click(el, "[data-search]");
    expect(lookUpBills).not.toHaveBeenCalled();
    expect(input(el, "bill-search").error).toContain("Type an invoice number");
  });

  it("keeps the query on a failed read and explains an empty result", async () => {
    lookUpBills.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ bills: [] });
    const el = await mount();
    await type(el, "bill-search", "A/12");
    await click(el, "[data-search]");
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("The search failed"));
    expect(input(el, "bill-search").value).toBe("A/12");
    await click(el, "[data-search]");
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("No unpaid bill matches"));
  });

  it("collects the chosen invoice debt with a cash tender and closes only after the app succeeds", async () => {
    const el = await mount();
    const paid: unknown[] = [];
    el.addEventListener("find-bill-pay", (event) => paid.push((event as CustomEvent).detail));
    await type(el, "bill-search", "A/12");
    await click(el, "[data-search]");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-bill]")).not.toBeNull());
    await click(el, "[data-bill]");
    await click(el, "[data-collect]");
    expect(paid).toEqual([
      {
        workingOrderId: "wo-1",
        tender: { method: "cash", amount: "30.00" },
        invoiced: true,
      },
    ]);
  });

  it("keeps only the latest search answer when requests finish out of order", async () => {
    let finishFirst!: (value: { bills: BillLookupRow[] }) => void;
    lookUpBills.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    lookUpBills.mockResolvedValueOnce({
      bills: [{ ...debt, workingOrderId: "wo-2", partyName: "Latest" }],
    });
    const el = await mount();
    await type(el, "bill-search", "first");
    await click(el, "[data-search]");
    await type(el, "bill-search", "second");
    await click(el, "[data-search]");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-bill]")!.textContent).toContain("Latest"),
    );
    finishFirst({ bills: [debt] });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-bill]")!.textContent).toContain("Latest");
  });

  it("refuses cash below the debt and sends a card reference with the exact debt", async () => {
    const el = await mount();
    const paid: unknown[] = [];
    el.addEventListener("find-bill-pay", (event) => paid.push((event as CustomEvent).detail));
    await type(el, "bill-search", "A/12");
    await click(el, "[data-search]");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-bill]")).not.toBeNull());
    await click(el, "[data-bill]");
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

  it("marks a bill without an invoice for an original receipt and returns to results", async () => {
    lookUpBills.mockResolvedValueOnce({ bills: [{ ...debt, invoiceNumber: null }] });
    const el = await mount();
    const paid: unknown[] = [];
    el.addEventListener("find-bill-pay", (event) => paid.push((event as CustomEvent).detail));
    await type(el, "bill-search", "12");
    await click(el, "[data-search]");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-bill]")).not.toBeNull());
    await click(el, "[data-bill]");
    await click(el, "[data-collect]");
    expect(paid).toEqual([
      { workingOrderId: "wo-1", tender: { method: "cash", amount: "30.00" }, invoiced: false },
    ]);
    await click(el, "[slot=cancel]");
    expect(el.shadowRoot!.querySelector("[data-bill]")).not.toBeNull();
  });
});
