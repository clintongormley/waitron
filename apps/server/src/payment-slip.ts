import { esc } from "@waitron/printing";
import type { CardDetails } from "@waitron/payments";

/** Payment facts only: no invoice identifiers or fiscal rendering dependencies. */
export interface PaymentSlipInput {
  issuer: { venueName: string; nif: string };
  paidAt: string;
  orderLabel: string | null;
  orderNumber: number;
  amount: string;
  tip: string;
  charged: string;
  card: CardDetails | null;
  invoiceLocale: string;
}

const ENTRY_MODE_LABEL: Partial<Record<CardDetails["entryMode"], string>> = {
  contactless: "Sin contacto",
  chip: "Chip",
  swipe: "Banda",
};

export function formatPaymentSlip(input: PaymentSlipInput): Uint8Array {
  const b = esc().init();
  const money = (value: string) =>
    new Intl.NumberFormat(input.invoiceLocale, { style: "currency", currency: "EUR" }).format(
      Number(value),
    );
  const row = (label: string, value: string) =>
    b.line(label + " ".repeat(Math.max(1, 42 - label.length - value.length)) + value);
  b.line("JUSTIFICANTE DE PAGO");
  b.line("Este documento no es una factura");
  b.line(`${input.issuer.venueName} · ${input.issuer.nif}`);
  b.line(
    new Intl.DateTimeFormat(input.invoiceLocale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(input.paidAt)),
  );
  b.line([input.orderLabel, `Pedido ${input.orderNumber}`].filter(Boolean).join(" · "));
  b.line();
  if (input.card !== null) {
    row("Tarjeta", `${input.card.scheme} **** ${input.card.last4}`);
    const entry = ENTRY_MODE_LABEL[input.card.entryMode];
    if (entry !== undefined) row("Entrada", entry);
    if (input.card.authCode !== null) row("Autorización", input.card.authCode);
    b.line();
  }
  row("Importe", money(input.amount));
  if (input.tip !== "0.00") row("Propina", money(input.tip));
  row("Cobrado", money(input.charged));
  return b.feedAndCut().bytes();
}
