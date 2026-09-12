import { describe, expect, it } from "vitest";
import { formatPaymentSlip } from "./payment-slip.js";
import { bytesInclude, decodeTicket } from "./testing/decode-ticket.js";

const input = {
  issuer: { venueName: "Casa Gormley", nif: "B12345678" },
  paidAt: "2026-09-12T12:32:00.000Z",
  orderLabel: "Mesa 6",
  orderNumber: 41,
  amount: "1.00",
  tip: "0.50",
  charged: "1.50",
  invoiceLocale: "es-ES",
  card: { scheme: "VISA", last4: "5838", entryMode: "contactless" as const, authCode: "328600" },
};
describe("payment slip (pure renderer, no database)", () => {
  it("prints payment identity, grouping and amounts without fiscal identifiers or QR", () => {
    const bytes = formatPaymentSlip({
      ...input,
      invoiceNumber: "SECRET-SERIES/42",
      qr: "https://fiscal.invalid",
    } as typeof input);
    const text = decodeTicket(bytes);
    for (const fragment of [
      "JUSTIFICANTE DE PAGO",
      "Este documento no es una factura",
      "Casa Gormley",
      "B12345678",
      "Mesa 6 · Pedido 41",
      "VISA **** 5838",
      "Sin contacto",
      "328600",
      "Importe",
      "1,00",
      "Propina",
      "0,50",
      "Cobrado",
      "1,50",
    ])
      expect(text).toContain(fragment);
    expect(text).not.toContain("SECRET-SERIES");
    expect(text).not.toContain("https://fiscal.invalid");
    expect(text).not.toContain("VERI*FACTU");
    expect(bytesInclude(bytes, Uint8Array.from([0x1d, 0x28, 0x6b]))).toBe(false);
  });
  it("omits missing card facts, tip and label while keeping the amount", () => {
    const text = decodeTicket(
      formatPaymentSlip({ ...input, card: null, orderLabel: null, tip: "0.00", charged: "1.00" }),
    );
    expect(text).toContain("\nPedido 41\n");
    for (const fragment of ["Tarjeta", "Entrada", "Autorización", "Propina", "Mesa"])
      expect(text).not.toContain(fragment);
    expect(text).toContain("Cobrado");
  });
  it.each([
    ["chip", "Chip"],
    ["swipe", "Banda"],
    ["unknown", null],
  ] as const)("handles %s with no authorization", (entryMode, label) => {
    const text = decodeTicket(
      formatPaymentSlip({ ...input, card: { ...input.card, entryMode, authCode: null } }),
    );
    expect(text).not.toContain("Autorización");
    if (label) expect(text).toContain(label);
    else expect(text).not.toContain("Entrada");
  });
});
