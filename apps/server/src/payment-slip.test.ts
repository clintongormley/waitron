import { receiptLabelsFor } from "@waitron/country-packs";
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
  offsetMinutes: 0,
  orderLabel: "Table 6",
  orderNumber: 41,
  amount: "1.00",
  tip: "0.50",
  charged: "1.50",
  invoiceLocale: "es-ES",
  card: { scheme: "VISA", last4: "5838", entryMode: "contactless" as const, authCode: "328600" },
  printer: { paperWidth: "80mm", resolution: "180dpi" } as const,
};
describe("payment slip (pure renderer, no database)", () => {
  it("shows no amount owed", () => {
    const labels = receiptLabelsFor("en-GB");
    const text = decodeTicket(formatPaymentSlip({ ...input, invoiceLocale: "en-GB" }));
    expect(text).not.toContain(labels.owed);
  });

  it.each(["es-ES", "ca-ES", "gl-ES", "eu-ES", "en-GB", "ca", "fr-FR"])(
    "A965 payment language uses %s resources for each card entry mode",
    (invoiceLocale) => {
      const labels = receiptLabelsFor(invoiceLocale);
      for (const [entryMode, key] of [
        ["contactless", "paymentContactless"],
        ["chip", "paymentChip"],
        ["swipe", "paymentSwipe"],
        ["unknown", null],
      ] as const) {
        const bytes = formatPaymentSlip({
          ...input,
          invoiceLocale,
          amount: "1234.56",
          card: { ...input.card, entryMode },
        });
        const text = decodeTicket(bytes);
        expect(text).toContain(labels.paymentHeading);
        expect(text).toContain(labels.paymentNotice);
        expect(text).toContain(`${labels.order} 41`);
        expect(text).toContain(labels.card);
        expect(text).toContain(labels.paymentAuthorization);
        expect(text).toContain(labels.paymentAmount);
        expect(text).toContain(labels.charged);
        if (key !== null) {
          expect(text).toContain(labels.paymentEntry);
          expect(text).toContain(labels[key]);
        } else expect(text).not.toContain(labels.paymentEntry);
        if (invoiceLocale === "en-GB") expect(text).toContain("€1,234.56");
        expect(text).not.toContain("VERI*FACTU");
        expect(commandNames(bytes)).not.toContain("GS ( k");
      }
      const missing = decodeTicket(
        formatPaymentSlip({ ...input, invoiceLocale, card: null, tip: "0.00" }),
      );
      expect(missing).not.toContain(labels.paymentEntry);
      expect(missing).not.toContain(labels.paymentAuthorization);
      expect(missing).not.toContain(labels.tip);
      expect(missing).toContain(labels.paymentAmount);
    },
  );

  it.each([
    ["es-ES", "cash", "Efectivo"],
    ["es-ES", "card", "Tarjeta"],
    ["en-GB", "cash", "Cash"],
    ["en-GB", "card", "Card"],
  ] as const)(
    "a %s slip with no card facts names %s on a line of its own",
    (locale, method, word) => {
      const lines = decodeTicket(
        formatPaymentSlip({ ...input, invoiceLocale: locale, method, card: null }),
      )
        .split("\n")
        .map((line) => line.trim());
      expect(lines.filter((line) => line === word)).toHaveLength(1);
    },
  );

  it("a card typed into another machine names the machine and the operation number before the amount", () => {
    const labels = receiptLabelsFor("es-ES");
    const linesOf = (extra: { reference: string | null; machine: string | null }) =>
      decodeTicket(formatPaymentSlip({ ...input, method: "card", card: null, ...extra }))
        .split("\n")
        .map((line) => line.trim());

    const typed = linesOf({ reference: "OP-77", machine: "SumUp Solo" });
    const method = typed.indexOf("Tarjeta · SumUp Solo");
    const reference = typed.indexOf("Ref. OP-77");
    const amount = typed.findIndex((line) => line.startsWith(labels.paymentAmount));
    expect(method).toBeGreaterThan(-1);
    expect(reference).toBe(method + 1);
    expect(amount).toBeGreaterThan(reference);
    expect(typed).not.toContain("Tarjeta");

    const untyped = linesOf({ reference: null, machine: null });
    expect(untyped.filter((line) => line === "Tarjeta")).toHaveLength(1);
    expect(untyped.some((line) => line.startsWith(labels.reference))).toBe(false);

    const cash = decodeTicket(
      formatPaymentSlip({
        ...input,
        method: "cash",
        card: null,
        reference: "OP-77",
        machine: "SumUp Solo",
      }),
    );
    expect(cash).not.toContain("OP-77");
    expect(cash).not.toContain("SumUp Solo");
  });

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
      "Table 6 · Pedido 41",
      "Visa ****5838",
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
  it("names a card of unknown type with the slip's own word for card", () => {
    const text = decodeTicket(
      formatPaymentSlip({ ...input, card: { ...input.card, scheme: "UNKNOWN" } }),
    );
    expect(text).toContain("Tarjeta ****5838");
    expect(text).not.toMatch(/unknown/i);
  });
  it("prints the payment time with a two-digit hour", () => {
    const paidAt = "2026-09-12T09:05:00.000Z";
    expect(decodeTicket(formatPaymentSlip({ ...input, paidAt }))).toContain("12 sept 2026, 09:05");
  });
  it("omits missing card facts, tip and label while keeping the amount", () => {
    const text = decodeTicket(
      formatPaymentSlip({ ...input, card: null, orderLabel: null, tip: "0.00", charged: "1.00" }),
    );
    expect(text).toContain("\nPedido 41\n");
    for (const fragment of ["Tarjeta", "Entrada", "Autorización", "Propina", "Table"])
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
        expect(line.widthDots).toBe(widthDots);
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
        orderLabel: "Terrace back row table",
        printer,
      }),
    );
    const columns = printer.paperWidth === "58mm" ? 30 : 42;
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(columns);
    expect(lines).toContain(`Cobrado${" ".repeat(columns - 13)}1,50 €`);
  });

  it.each(["es-ES", "ca-ES", "gl-ES", "eu-ES", "en-GB"])(
    "a payment not taken is headed so in %s and says nothing was charged",
    (invoiceLocale) => {
      const labels = receiptLabelsFor(invoiceLocale);
      const text = decodeTicket(formatPaymentSlip({ ...input, invoiceLocale, notTaken: true }));
      expect(text).toContain(labels.paymentNotTakenHeading);
      expect(text).not.toContain(labels.paymentHeading);
      expect(text).toContain(labels.paymentNotice);
      expect(text).toContain(labels.paymentAmount);
      expect(text).not.toContain(labels.charged);
    },
  );
});
