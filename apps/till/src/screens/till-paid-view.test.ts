import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { BillPaymentView, OriginalReceiptPrint } from "../api/client.js";
import "./till-paid-view.js";
import type { TillPaidView } from "./till-paid-view.js";

function payment(over: Partial<BillPaymentView>): BillPaymentView {
  return {
    id: "p1",
    submissionId: "s1",
    kind: "share",
    shareOf: 3,
    method: "card",
    entry: "reader",
    applied: "20.80",
    tip: "0.00",
    tendered: null,
    change: null,
    state: "received",
    createdAt: "2026-10-19T12:00:00.000Z",
    receivedAt: "2026-10-19T12:00:05.000Z",
    lines: [],
    refunds: [],
    ...over,
  };
}

const threePayments: BillPaymentView[] = [
  payment({ id: "p1" }),
  payment({ id: "p2", submissionId: "s2", state: "pending" }),
  payment({
    id: "p3",
    submissionId: "s3",
    method: "cash",
    entry: null,
    tendered: "25.00",
    change: "4.20",
  }),
];

const sent = (status: "queued" | "printing" | "done" | "failed", canRetry = false) =>
  ({ status, jobId: "j1", canRetry }) as OriginalReceiptPrint;

async function mount(props: Partial<TillPaidView>) {
  const { el } = await mountWidget<TillPaidView>("till-paid-view", {
    tableName: "Mesa 4",
    total: "62.40",
    payments: threePayments,
    receipt: sent("done"),
    canPrint: true,
    ...props,
  });
  return el;
}

const text = (el: TillPaidView, selector: string) =>
  el.shadowRoot!.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim();
const button = (el: TillPaidView, test: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`);

beforeEach(() => setLocale("es-ES"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("till-paid-view", () => {
  it("says the table is paid, in how many payments, and that a simplified invoice was issued", async () => {
    const el = await mount({});
    expect(text(el, "[data-paid-title]")).toBe("Mesa 4 pagada");
    expect(text(el, "[data-paid-summary]")).toBe(
      "62,40 € en 3 pagos · factura simplificada emitida",
    );
  });

  it("says one payment for one, and for a presented bill's empty list hides the list", async () => {
    const one = await mount({ payments: [payment({})] });
    expect(text(one, "[data-paid-summary]")).toBe(
      "62,40 € en un pago · factura simplificada emitida",
    );
    expect(one.shadowRoot!.querySelectorAll("[data-paid-payment]")).toHaveLength(1);
    cleanupWidgets();
    const none = await mount({ payments: [] });
    expect(text(none, "[data-paid-summary]")).toBe(
      "62,40 € en un pago · factura simplificada emitida",
    );
    expect(none.shadowRoot!.querySelector("[data-paid-payments]")).toBeNull();
  });

  it("lists each payment with its method, amount, change and state", async () => {
    const el = await mount({});
    const rows = [...el.shadowRoot!.querySelectorAll("[data-paid-payment]")].map((row) =>
      row.textContent!.replace(/\s+/g, " ").trim(),
    );
    expect(rows).toEqual([
      "Pago 1: Tarjeta 20,80 € Cobrado",
      "Pago 2: Tarjeta 20,80 € En curso",
      "Pago 3: Efectivo 20,80 € · Cambio 4,20 € Cobrado",
    ]);
  });

  it("shows a tip beside the amount where one was given", async () => {
    const el = await mount({ payments: [payment({ tip: "1.50" })] });
    expect(text(el, "[data-paid-payment]")).toBe(
      "Pago 1: Tarjeta 20,80 € · Propina 1,50 € Cobrado",
    );
  });

  it.each(["queued", "printing", "done"] as const)(
    "a %s original reads Ticket enviado, naming no printer",
    async (status) => {
      const el = await mount({ receipt: sent(status) });
      expect(text(el, "[data-paid-ticket-status]")).toBe("Ticket enviado");
      expect(text(el, "[data-paid-ticket-kind]")).toBe("Factura simplificada");
      expect(el.shadowRoot!.querySelector("[data-paid-ticket-hint]")).toBeNull();
    },
  );

  it("a failed original reads No se ha podido imprimir, with Retry only where it can be retried", async () => {
    const retryable = await mount({ receipt: sent("failed", true) });
    expect(text(retryable, "[data-paid-ticket-status]")).toBe("No se ha podido imprimir");
    expect(button(retryable, "retry-receipt")).not.toBeNull();
    expect(button(retryable, "reprint")).toBeNull();
    cleanupWidgets();
    const notRetryable = await mount({ receipt: sent("failed", false) });
    expect(text(notRetryable, "[data-paid-ticket-status]")).toBe("No se ha podido imprimir");
    expect(button(notRetryable, "retry-receipt")).toBeNull();
    expect(button(notRetryable, "reprint")).not.toBeNull();
  });

  it("offers no Retry to a device that may not print", async () => {
    const el = await mount({ receipt: sent("failed", true), canPrint: false });
    expect(button(el, "retry-receipt")).toBeNull();
    expect(button(el, "reprint")).toBeNull();
  });

  it("a ticket never queued reads No se ha impreso ticket and says who can reprint it", async () => {
    const el = await mount({ receipt: { status: "not_queued" } });
    expect(text(el, "[data-paid-ticket-status]")).toBe("No se ha impreso ticket");
    expect(text(el, "[data-paid-ticket-hint]")).toBe(
      "Un dispositivo cuyo perfil puede imprimir tickets puede reimprimirlo.",
    );
  });

  it("a failed read drops the reprint hint of an earlier not-queued answer", async () => {
    const el = await mount({ receipt: { status: "not_queued" }, receiptReadFailed: true });
    expect(text(el, "[data-paid-ticket-status]")).toBe(
      "No se pudo consultar la impresión del original. Vuelve a comprobarla.",
    );
    expect(el.shadowRoot!.querySelector("[data-paid-ticket-hint]")).toBeNull();
  });

  it("while reading says it is checking, and a failed read says so", async () => {
    const reading = await mount({ receipt: null });
    expect(text(reading, "[data-paid-ticket-status]")).toBe(
      "Consultando la impresión del original…",
    );
    cleanupWidgets();
    const failed = await mount({ receipt: null, receiptReadFailed: true });
    expect(text(failed, "[data-paid-ticket-status]")).toBe(
      "No se pudo consultar la impresión del original. Vuelve a comprobarla.",
    );
  });

  it("offers the original print where it is available, Reimprimir otherwise, each only with canPrint", async () => {
    const original = await mount({ receipt: { status: "not_queued" }, originalAvailable: true });
    expect(text(original, '[data-test="print-receipt"]')).toBe("Imprimir recibo");
    expect(button(original, "reprint")).toBeNull();
    cleanupWidgets();
    const copy = await mount({});
    expect(text(copy, '[data-test="reprint"]')).toBe("Reimprimir");
    expect(button(copy, "print-receipt")).toBeNull();
    cleanupWidgets();
    const noPrint = await mount({ originalAvailable: true, canPrint: false });
    expect(button(noPrint, "print-receipt")).toBeNull();
    expect(button(noPrint, "reprint")).toBeNull();
  });

  it.each([
    ["finish-table", "finish-table"],
    ["back-to-table", "back-to-table"],
    ["reprint", "reprint"],
    ["print-receipt", "print-receipt"],
    ["retry-receipt", "retry-receipt"],
  ] as const)("the %s button sends %s, bubbling out of the shadow root", async (test, name) => {
    const el = await mount({
      receipt: test === "retry-receipt" ? sent("failed", true) : sent("done"),
      originalAvailable: test === "print-receipt",
    });
    const seen: CustomEvent[] = [];
    document.addEventListener(name, (event) => seen.push(event as CustomEvent), { once: true });
    button(el, test)!.click();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.bubbles).toBe(true);
    expect(seen[0]!.composed).toBe(true);
    expect(seen[0]!.detail).toEqual({});
  });

  it("Cerrar mesa is the primary action and Volver a la mesa the secondary one", async () => {
    const el = await mount({});
    const finish = button(el, "finish-table") as HTMLElement & { variant: string };
    const back = button(el, "back-to-table") as HTMLElement & { variant: string };
    expect(finish.textContent!.trim()).toBe("Cerrar mesa");
    expect(finish.variant).toBe("primary");
    expect(back.textContent!.trim()).toBe("Volver a la mesa");
    expect(back.variant).toBe("secondary");
  });

  it("busy disables every action", async () => {
    const el = await mount({ busy: true, receipt: sent("failed", true) });
    for (const test of ["finish-table", "back-to-table", "retry-receipt"])
      expect((button(el, test) as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    el.busy = false;
    await el.updateComplete;
    expect((button(el, "finish-table") as HTMLElement & { disabled: boolean }).disabled).toBe(
      false,
    );
  });

  it("speaks English", async () => {
    setLocale("en-GB");
    const el = await mount({ payments: [payment({})] });
    expect(text(el, "[data-paid-title]")).toBe("Mesa 4 paid");
    expect(text(el, "[data-paid-ticket-status]")).toBe("Ticket sent");
    expect(text(el, '[data-test="back-to-table"]')).toBe("Back to the table");
  });
});
