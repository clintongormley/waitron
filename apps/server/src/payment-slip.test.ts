import { describe, expect, it } from "vitest";
import { formatPaymentSlip } from "./payment-slip.js";
import {
  commandNames,
  decodeTicket,
  printedCommands,
  printedLines,
} from "./testing/decode-ticket.js";

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
  printer: { paperWidth: "80mm", resolution: "180dpi" } as const,
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
    expect(text).not.toMatch(/^\s*(?:Factura|Serie|Número de factura)\s*[:#]?\s*\S+/im);
    expect(commandNames(bytes)).not.toContain("GS ( k");
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

describe("payment slip printer layout", () => {
  it.each([
    [{ paperWidth: "58mm", resolution: "180dpi" } as const, 360],
    [{ paperWidth: "58mm", resolution: "203dpi" } as const, 384],
    [{ paperWidth: "80mm", resolution: "180dpi" } as const, 512],
    [{ paperWidth: "80mm", resolution: "203dpi" } as const, 576],
  ])(
    "draws every line as an image as wide as %j's setting, selecting no character table",
    (printer, widthDots) => {
      const commands = printedCommands(formatPaymentSlip({ ...input, printer }));
      const names = commands.map((command) => command.name);
      expect(names).not.toContain("ESC t");
      expect(names).not.toContain("FS .");
      expect(names).not.toContain("text");
      const lines = commands.filter((command) => command.name === "GS v 0");
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.text).toBeDefined();
        expect((line.bytes[4]! + 256 * line.bytes[5]!) * 8).toBe(widthDots);
      }
    },
  );

  it("separates each amount from the euro sign with a space", () => {
    const amounts = printedLines(formatPaymentSlip(input)).filter((line) => line.includes("€"));
    expect(amounts).toHaveLength(3); // Importe, Propina, Cobrado
    for (const line of amounts) expect(line).toMatch(/\d €$/u);
  });

  it.each([
    { paperWidth: "80mm", resolution: "180dpi" },
    { paperWidth: "58mm", resolution: "180dpi" },
    { paperWidth: "58mm", resolution: "203dpi" },
  ] as const)("keeps every line within the column count ($paperWidth, $resolution)", (printer) => {
    const lines = printedLines(
      formatPaymentSlip({
        ...input,
        issuer: { venueName: "Charcutería y Bodega La Buena Mesa", nif: "B12345678" },
        orderLabel: "Terraza mesa del fondo",
        printer,
      }),
    );
    const columns = printer.paperWidth === "58mm" ? 30 : 42;
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(columns);
    expect(lines).toContain(`Cobrado${" ".repeat(columns - 13)}1,50 €`);
  });
});
