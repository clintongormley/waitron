import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi, PurchaseInvoice } from "../api/client.js";
import type { PurchaseList } from "../widgets/purchase-list.js";
import type { PurchaseForm } from "../widgets/purchase-form.js";
import { PurchasesScreen } from "./purchases-screen.js";

const invoices: PurchaseInvoice[] = [
  {
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
  },
];

/** A base create-purchase detail (as `dashboard-purchase-form` emits it), overridable per test. */
function createDetail(overrides: Record<string, unknown> = {}) {
  return {
    header: {
      supplierTaxId: "B1",
      supplierName: "Nuevo Proveedor",
      supplierInvoiceNumber: "N-1",
      issuedOn: "2026-08-01",
      receivedOn: "2026-08-02",
      total: "12.10",
      regime: "general" as const,
      deductibleProportion: "100.00",
      note: null,
    },
    lines: [{ rate: "21.00", base: "10.00", tax: "2.10", kind: "ordinary" as const }],
    ...overrides,
  };
}

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listPurchaseInvoices: vi.fn().mockResolvedValue(invoices),
    createPurchaseInvoice: vi.fn().mockResolvedValue({ ...invoices[0], id: "pi-new" }),
    updatePurchaseInvoice: vi.fn().mockResolvedValue(undefined),
    deletePurchaseInvoice: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Settles the in-flight fetches and the follow-up render. */
async function flush(el: PurchasesScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const list = (el: PurchasesScreen): PurchaseList | null =>
  el.shadowRoot!.querySelector("dashboard-purchase-list");
const form = (el: PurchasesScreen): PurchaseForm =>
  el.shadowRoot!.querySelector("dashboard-purchase-form")!;

/** Dispatch a composed event from a child as the real widget would. */
function emitFromChild(child: Element, type: string, detail: unknown): void {
  child.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

afterEach(cleanupWidgets);

describe("purchases-screen", () => {
  it("loads and lists the invoices on connect", async () => {
    const { el } = await mountWidget<PurchasesScreen>("dashboard-purchases-screen", {
      api: stubApi(),
    });
    await flush(el);
    expect(list(el)!.invoices).toEqual(invoices);
  });

  it("shows the empty prompt when there are no invoices", async () => {
    const api = stubApi({ listPurchaseInvoices: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<PurchasesScreen>("dashboard-purchases-screen", { api });
    await flush(el);
    expect(list(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=no-invoices]")).not.toBeNull();
  });

  it("shows a localised error banner when the load fails", async () => {
    const api = stubApi({
      listPurchaseInvoices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<PurchasesScreen>("dashboard-purchases-screen", { api });
    await flush(el);
    const alert = el.shadowRoot!.querySelector("[role=alert]")!;
    expect(alert.textContent).toContain(codeMessage("server.internal", "es-ES"));
  });

  it("opens the form for a create when Add is clicked", async () => {
    const { el } = await mountWidget<PurchasesScreen>("dashboard-purchases-screen", {
      api: stubApi(),
    });
    await flush(el);
    expect(form(el).open).toBe(false);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-purchase]")!.click();
    await el.updateComplete;
    expect(form(el).open).toBe(true);
    expect(form(el).invoice).toBeNull();
  });

  it("creates an invoice from the form's detail, then closes and reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PurchasesScreen>("dashboard-purchases-screen", { api });
    await flush(el);
    emitFromChild(form(el), "create-purchase", createDetail());
    await flush(el);
    expect(api.createPurchaseInvoice).toHaveBeenCalledWith(createDetail());
    expect(form(el).open).toBe(false);
    // listPurchaseInvoices: once on connect + once after the create.
    expect(api.listPurchaseInvoices).toHaveBeenCalledTimes(2);
  });

  it("opens the form pre-filled when the list asks to edit an invoice", async () => {
    const { el } = await mountWidget<PurchasesScreen>("dashboard-purchases-screen", {
      api: stubApi(),
    });
    await flush(el);
    emitFromChild(list(el)!, "edit-purchase", { id: "pi-1" });
    await el.updateComplete;
    expect(form(el).open).toBe(true);
    expect(form(el).invoice).toEqual(invoices[0]);
  });

  it("drops an edit event for an unknown id (stale event)", async () => {
    const { el } = await mountWidget<PurchasesScreen>("dashboard-purchases-screen", {
      api: stubApi(),
    });
    await flush(el);
    emitFromChild(list(el)!, "edit-purchase", { id: "nope" });
    await el.updateComplete;
    expect(form(el).open).toBe(false);
  });

  it("updates an invoice from the form's edit detail, then closes and reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PurchasesScreen>("dashboard-purchases-screen", { api });
    await flush(el);
    const patch = { header: { note: "corregido" }, lines: createDetail().lines };
    emitFromChild(form(el), "update-purchase", { id: "pi-1", patch });
    await flush(el);
    expect(api.updatePurchaseInvoice).toHaveBeenCalledWith("pi-1", patch);
    expect(form(el).open).toBe(false);
    expect(api.listPurchaseInvoices).toHaveBeenCalledTimes(2);
  });

  it("deletes an invoice when the list asks to, then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PurchasesScreen>("dashboard-purchases-screen", { api });
    await flush(el);
    emitFromChild(list(el)!, "delete-purchase", { id: "pi-1" });
    await flush(el);
    expect(api.deletePurchaseInvoice).toHaveBeenCalledWith("pi-1");
    expect(api.listPurchaseInvoices).toHaveBeenCalledTimes(2);
  });

  it("keeps the form open and shows the error when a create fails", async () => {
    const api = stubApi({
      createPurchaseInvoice: vi.fn().mockRejectedValue({ code: "purchase.duplicate" }),
    });
    const { el } = await mountWidget<PurchasesScreen>("dashboard-purchases-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-purchase]")!.click();
    await el.updateComplete;
    emitFromChild(form(el), "create-purchase", createDetail());
    await flush(el);
    expect(form(el).open).toBe(true);
    const alert = el.shadowRoot!.querySelector("[role=alert]")!;
    expect(alert.textContent).toContain(codeMessage("purchase.duplicate", "es-ES"));
  });

  it("keeps the form open and shows the error when an update fails", async () => {
    const api = stubApi({
      updatePurchaseInvoice: vi.fn().mockRejectedValue({ code: "purchase.not_found" }),
    });
    const { el } = await mountWidget<PurchasesScreen>("dashboard-purchases-screen", { api });
    await flush(el);
    emitFromChild(list(el)!, "edit-purchase", { id: "pi-1" });
    await el.updateComplete;
    emitFromChild(form(el), "update-purchase", { id: "pi-1", patch: { header: { note: "x" } } });
    await flush(el);
    expect(form(el).open).toBe(true);
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      codeMessage("purchase.not_found", "es-ES"),
    );
  });

  it("shows the error when a delete fails", async () => {
    const api = stubApi({
      deletePurchaseInvoice: vi.fn().mockRejectedValue({ code: "purchase.not_found" }),
    });
    const { el } = await mountWidget<PurchasesScreen>("dashboard-purchases-screen", { api });
    await flush(el);
    emitFromChild(list(el)!, "delete-purchase", { id: "pi-1" });
    await flush(el);
    const alert = el.shadowRoot!.querySelector("[role=alert]")!;
    expect(alert.textContent).toContain(codeMessage("purchase.not_found", "es-ES"));
  });

  it("single-flights create: a second create while one is in flight is dropped", async () => {
    let resolve!: () => void;
    const createPurchaseInvoice = vi.fn().mockImplementation(
      () =>
        new Promise<PurchaseInvoice>((r) => {
          resolve = () => r({ ...invoices[0]!, id: "pi-new" });
        }),
    );
    const api = stubApi({ createPurchaseInvoice });
    const { el } = await mountWidget<PurchasesScreen>("dashboard-purchases-screen", { api });
    await flush(el);
    emitFromChild(form(el), "create-purchase", createDetail());
    emitFromChild(form(el), "create-purchase", createDetail());
    await el.updateComplete;
    expect(createPurchaseInvoice).toHaveBeenCalledTimes(1);
    resolve();
    await flush(el);
  });

  it("passes the busy flag down to the form while a create is in flight", async () => {
    let resolve!: () => void;
    const createPurchaseInvoice = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise<PurchaseInvoice>((r) => (resolve = () => r({ ...invoices[0]!, id: "x" }))),
      );
    const api = stubApi({ createPurchaseInvoice });
    const { el } = await mountWidget<PurchasesScreen>("dashboard-purchases-screen", { api });
    await flush(el);
    emitFromChild(form(el), "create-purchase", createDetail());
    await el.updateComplete;
    expect(form(el).busy).toBe(true);
    resolve();
    await flush(el);
    expect(form(el).busy).toBe(false);
  });

  it("renders exactly one h1 (its own title)", async () => {
    const { el } = await mountWidget<PurchasesScreen>("dashboard-purchases-screen", {
      api: stubApi(),
    });
    await flush(el);
    expect(el.shadowRoot!.querySelectorAll("h1").length).toBe(1);
  });
});
