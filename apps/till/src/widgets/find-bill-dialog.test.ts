import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./find-bill-dialog.js";
import type { TillFindBillDialog } from "./find-bill-dialog.js";
import type { BillLookupRow, InvoiceLookupRow, TillApi } from "../api/client.js";

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
const invoice: InvoiceLookupRow = {
  workingOrderId: "wo-filed",
  invoiceNumber: "FF/7",
  issuedAt: "2026-10-01T22:00:00.000Z",
  customerName: "Cliente Facturado",
  total: "3500.00",
};
const lookUpInvoices = vi.fn(async () => ({ invoices: [invoice] }));
const api = { lookUpBills, lookUpInvoices } as unknown as TillApi;

async function mount() {
  const { el } = await mountWidget<TillFindBillDialog>("till-find-bill-dialog", { api });
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
  lookUpBills.mockClear();
  lookUpInvoices.mockClear();
});

describe("Find a bill", () => {
  async function invoices(el: TillFindBillDialog) {
    const kind = el.shadowRoot!.querySelector("[name=search-kind]");
    expect(kind).not.toBeNull();
    kind!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "invoices" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
  }

  it("opens a saved full invoice without offering collection", async () => {
    const el = await mount();
    const opened: unknown[] = [];
    const paid: unknown[] = [];
    el.addEventListener("find-invoice-open", (event) => opened.push((event as CustomEvent).detail));
    el.addEventListener("find-bill-pay", (event) => paid.push((event as CustomEvent).detail));
    await invoices(el);
    await type(el, "bill-search", " FF/7 ");
    await click(el, "[data-search]");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-invoice]")?.textContent).toContain(
        "Cliente Facturado",
      ),
    );
    const row = el.shadowRoot!.querySelector("[data-invoice]")!;
    expect(row.textContent).toContain("FF/7");
    expect(row.textContent).toContain("3,500.00");
    expect(lookUpInvoices).toHaveBeenCalledWith(" FF/7 ");
    expect(lookUpBills).not.toHaveBeenCalled();
    await click(el, "[data-invoice]");
    expect(opened).toEqual([{ workingOrderId: "wo-filed" }]);
    expect(paid).toEqual([]);
    expect(el.shadowRoot!.querySelector("[data-collect]")).toBeNull();
  });

  it("discards an unpaid search finishing after the search kind changes", async () => {
    let finish!: (value: { bills: BillLookupRow[] }) => void;
    lookUpBills.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const el = await mount();
    await type(el, "bill-search", "Ruiz");
    await click(el, "[data-search]");
    await invoices(el);
    finish({ bills: [debt] });
    await Promise.resolve();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-bill]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-invoice]")).toBeNull();
    await click(el, "[data-search]");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-invoice]")).not.toBeNull());
    expect(el.shadowRoot!.querySelector("[data-invoice]")?.textContent).toContain("FF/7");
  });

  it("keeps invoice recovery retryable after a search refusal and explains no matches", async () => {
    lookUpInvoices
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ invoices: [] });
    const el = await mount();
    await invoices(el);
    await type(el, "bill-search", "FF/7");
    await click(el, "[data-search]");
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("The search failed"));
    expect(input(el, "bill-search").value).toBe("FF/7");
    await click(el, "[data-search]");
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("No full invoice matches"));
  });

  it("does not open an invoice twice while the app loads it", async () => {
    const el = await mount();
    await invoices(el);
    await type(el, "bill-search", "FF/7");
    await click(el, "[data-search]");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-invoice]")).not.toBeNull());
    el.busy = true;
    await el.updateComplete;
    const opened = vi.fn();
    el.addEventListener("find-invoice-open", opened);
    await click(el, "[data-invoice]");
    expect(opened).not.toHaveBeenCalled();
  });

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

  it("sends a search with its trailing space, and refuses spaces alone", async () => {
    const el = await mount();
    await type(el, "bill-search", "gin ");
    await click(el, "[data-search]");
    await vi.waitFor(() => expect(lookUpBills).toHaveBeenCalledWith("gin "));
    await invoices(el);
    await click(el, "[data-search]");
    await vi.waitFor(() => expect(lookUpInvoices).toHaveBeenCalledWith("gin "));
    lookUpBills.mockClear();
    lookUpInvoices.mockClear();
    await type(el, "bill-search", "   ");
    await click(el, "[data-search]");
    expect(lookUpBills).not.toHaveBeenCalled();
    expect(lookUpInvoices).not.toHaveBeenCalled();
    expect(input(el, "bill-search").error).toContain("Type an invoice number");
  });

  it("searches when Enter is pressed in the search field", async () => {
    const el = await mount();
    await type(el, "bill-search", "A/12");
    input(el, "bill-search").shadowRoot!.querySelector("input")!.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(lookUpBills).toHaveBeenCalledWith("A/12"));
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

  it("clears an earlier result when a new search fails", async () => {
    lookUpBills
      .mockResolvedValueOnce({ bills: [debt] })
      .mockRejectedValueOnce(new Error("offline"));
    const el = await mount();
    await type(el, "bill-search", "A/12");
    await click(el, "[data-search]");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-bill]")).not.toBeNull());
    await type(el, "bill-search", "Mesa 4");
    await click(el, "[data-search]");
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("The search failed"));
    expect(el.shadowRoot!.querySelector("[data-bill]")).toBeNull();
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

  it("keeps the search field readable at phone width", async () => {
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
  await type(el, "bill-search", "A/12");
  await click(el, "[data-search]");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-bill]")).not.toBeNull());
  await click(el, "[data-bill]");
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
