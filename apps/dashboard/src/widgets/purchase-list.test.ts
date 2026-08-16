import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { regimeName } from "../i18n/domain.js";
import type { PurchaseInvoice } from "../api/client.js";
import { PurchaseList } from "./purchase-list.js";

afterEach(cleanupWidgets);

/** A representative received invoice; tests override the field they exercise via a spread. */
function invoice(overrides: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return {
    id: "pi-1",
    supplierTaxId: "B12345678",
    supplierName: "Distribuciones García SL",
    supplierInvoiceNumber: "F-2026/001",
    issuedOn: "2026-08-10",
    receivedOn: "2026-08-12",
    total: "121.00",
    regime: "general",
    deductibleProportion: "100.00",
    note: null,
    lines: [{ rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" }],
    ...overrides,
  };
}

describe("purchase-list", () => {
  it("renders one wt-card row per invoice", async () => {
    const invoices = [invoice({ id: "a" }), invoice({ id: "b" }), invoice({ id: "c" })];
    const { el } = await mountWidget<PurchaseList>("dashboard-purchase-list", { invoices });
    expect(el.shadowRoot!.querySelectorAll("wt-card[data-test=row]").length).toBe(3);
  });

  it("shows the supplier, invoice number, received date and total", async () => {
    const { el } = await mountWidget<PurchaseList>("dashboard-purchase-list", {
      invoices: [invoice()],
    });
    const text = el.shadowRoot!.querySelector("[data-test=row]")!.textContent!;
    expect(text).toContain("Distribuciones García SL");
    expect(text).toContain("F-2026/001");
    expect(text).toContain("2026-08-12");
    expect(text).toContain("121.00");
  });

  it("shows the localised regime name, not the raw token", async () => {
    const { el } = await mountWidget<PurchaseList>("dashboard-purchase-list", {
      invoices: [invoice({ regime: "equivalence_surcharge" })],
    });
    const text = el.shadowRoot!.querySelector("[data-test=row]")!.textContent!;
    expect(text).toContain(regimeName("equivalence_surcharge", "es-ES"));
    expect(text).not.toContain("equivalence_surcharge");
  });

  it("emits edit-purchase with the invoice id when a row's Edit control is clicked", async () => {
    const { el } = await mountWidget<PurchaseList>("dashboard-purchase-list", {
      invoices: [invoice({ id: "pi-42" })],
    });
    const detail = new Promise<{ id: string }>((resolve) =>
      el.addEventListener("edit-purchase", (e) => resolve((e as CustomEvent).detail)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-pi-42]")!.click();
    expect((await detail).id).toBe("pi-42");
  });

  it("emits delete-purchase with the invoice id when a row's Delete control is clicked", async () => {
    const { el } = await mountWidget<PurchaseList>("dashboard-purchase-list", {
      invoices: [invoice({ id: "pi-7" })],
    });
    const detail = new Promise<{ id: string }>((resolve) =>
      el.addEventListener("delete-purchase", (e) => resolve((e as CustomEvent).detail)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-pi-7]")!.click();
    expect((await detail).id).toBe("pi-7");
  });

  // Both events must escape this widget's shadow boundary to reach the screen — bubbles+composed.
  it("emits edit-purchase and delete-purchase as bubbling, composed events", async () => {
    const { el } = await mountWidget<PurchaseList>("dashboard-purchase-list", {
      invoices: [invoice({ id: "pi-9" })],
    });
    const edit = new Promise<Event>((resolve) => el.addEventListener("edit-purchase", resolve));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-pi-9]")!.click();
    const editEvent = await edit;
    expect(editEvent.bubbles).toBe(true);
    expect(editEvent.composed).toBe(true);

    const del = new Promise<Event>((resolve) => el.addEventListener("delete-purchase", resolve));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-pi-9]")!.click();
    const delEvent = await del;
    expect(delEvent.bubbles).toBe(true);
    expect(delEvent.composed).toBe(true);
  });

  it("renders no rows for an empty invoices list", async () => {
    const { el } = await mountWidget<PurchaseList>("dashboard-purchase-list", { invoices: [] });
    expect(el.shadowRoot!.querySelectorAll("[data-test=row]").length).toBe(0);
  });
});
