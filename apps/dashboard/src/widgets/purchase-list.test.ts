import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { t } from "../i18n/t.js";
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

  // ── Delete needs a confirming second click (a factura recibida is re-keyable, but an accidental
  //    single-click delete costs a full re-entry). The first click ARMS the row; the second emits. ──

  /** The Delete control of `id`, re-queried each time (its label/aria flips on arm). */
  function del(el: PurchaseList, id: string): HTMLElement {
    return el.shadowRoot!.querySelector<HTMLElement>(`[data-test=delete-${id}]`)!;
  }

  it("does NOT emit delete-purchase on the first click; the row arms instead", async () => {
    const { el } = await mountWidget<PurchaseList>("dashboard-purchase-list", {
      invoices: [invoice({ id: "pi-7" })],
    });
    let fired = false;
    el.addEventListener("delete-purchase", () => (fired = true));
    del(el, "pi-7").click();
    await el.updateComplete;
    expect(fired).toBe(false);
    // The armed control's label and aria-label change to the confirm prompt.
    const control = del(el, "pi-7");
    expect(control.textContent!.trim()).toBe(t("purchase.delete_confirm", "es-ES"));
    expect(control.getAttribute("aria-label")).toContain(t("purchase.delete_confirm", "es-ES"));
    expect(control.getAttribute("data-armed")).toBe("true");
  });

  it("emits delete-purchase with the invoice id on the SECOND (confirming) click", async () => {
    const { el } = await mountWidget<PurchaseList>("dashboard-purchase-list", {
      invoices: [invoice({ id: "pi-7" })],
    });
    const detail = new Promise<{ id: string }>((resolve) =>
      el.addEventListener("delete-purchase", (e) => resolve((e as CustomEvent).detail)),
    );
    del(el, "pi-7").click(); // arm
    await el.updateComplete;
    del(el, "pi-7").click(); // confirm
    expect((await detail).id).toBe("pi-7");
    // After confirming, the control disarms back to the plain Delete label.
    await el.updateComplete;
    const control = del(el, "pi-7");
    expect(control.textContent!.trim()).toBe(t("purchase.delete", "es-ES"));
    expect(control.getAttribute("data-armed")).toBeNull();
  });

  it("disarms a row when another row's Delete is clicked (only one armed at a time)", async () => {
    const { el } = await mountWidget<PurchaseList>("dashboard-purchase-list", {
      invoices: [invoice({ id: "a" }), invoice({ id: "b" })],
    });
    let fired = false;
    el.addEventListener("delete-purchase", () => (fired = true));
    del(el, "a").click(); // arm a
    await el.updateComplete;
    del(el, "b").click(); // arms b, disarms a — no emit
    await el.updateComplete;
    expect(fired).toBe(false);
    expect(del(el, "a").getAttribute("data-armed")).toBeNull();
    expect(del(el, "b").getAttribute("data-armed")).toBe("true");
  });

  it("disarms an armed row when its Edit control is clicked", async () => {
    const { el } = await mountWidget<PurchaseList>("dashboard-purchase-list", {
      invoices: [invoice({ id: "pi-7" })],
    });
    del(el, "pi-7").click(); // arm
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-pi-7]")!.click();
    await el.updateComplete;
    expect(del(el, "pi-7").getAttribute("data-armed")).toBeNull();
  });

  it("disarms on a click elsewhere (pointerdown outside the armed control)", async () => {
    const { el } = await mountWidget<PurchaseList>("dashboard-purchase-list", {
      invoices: [invoice({ id: "pi-7" })],
    });
    del(el, "pi-7").click(); // arm
    await el.updateComplete;
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(del(el, "pi-7").getAttribute("data-armed")).toBeNull();
  });

  it("stays armed on a pointerdown that lands ON the armed control (the confirming click starts)", async () => {
    const { el } = await mountWidget<PurchaseList>("dashboard-purchase-list", {
      invoices: [invoice({ id: "pi-7" })],
    });
    del(el, "pi-7").click(); // arm
    await el.updateComplete;
    // A pointerdown whose composed path includes the armed control must NOT disarm it.
    del(el, "pi-7").dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(del(el, "pi-7").getAttribute("data-armed")).toBe("true");
  });

  it("disarms when the invoices list is replaced (a screen refresh)", async () => {
    const { el } = await mountWidget<PurchaseList>("dashboard-purchase-list", {
      invoices: [invoice({ id: "pi-7" })],
    });
    del(el, "pi-7").click(); // arm
    await el.updateComplete;
    el.invoices = [invoice({ id: "pi-7" })];
    await el.updateComplete;
    expect(del(el, "pi-7").getAttribute("data-armed")).toBeNull();
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

    const deleted = new Promise<Event>((resolve) =>
      el.addEventListener("delete-purchase", resolve),
    );
    del(el, "pi-9").click(); // arm
    await el.updateComplete;
    del(el, "pi-9").click(); // confirm → emits
    const delEvent = await deleted;
    expect(delEvent.bubbles).toBe(true);
    expect(delEvent.composed).toBe(true);
  });

  it("renders no rows for an empty invoices list", async () => {
    const { el } = await mountWidget<PurchaseList>("dashboard-purchase-list", { invoices: [] });
    expect(el.shadowRoot!.querySelectorAll("[data-test=row]").length).toBe(0);
  });
});
