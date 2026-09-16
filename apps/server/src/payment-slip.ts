import {
  columnsFor,
  esc,
  labelAmountLines,
  prepareText,
  wrapText,
  type CharacterSet,
  type PaperWidth,
} from "@waitron/printing";
import type { CardDetails } from "@waitron/payments";
import { formatMoney } from "./receipt-money.js";

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
  /** The receipt printer's layout settings. A slip carries no QR, so resolution does not apply. */
  printer: { paperWidth: PaperWidth; characterSet: CharacterSet; characterTable: number };
}

const ENTRY_MODE_LABEL: Partial<Record<CardDetails["entryMode"], string>> = {
  contactless: "Sin contacto",
  chip: "Chip",
  swipe: "Banda",
};

export function formatPaymentSlip(input: PaymentSlipInput): Uint8Array {
  const columns = columnsFor(input.printer.paperWidth);
  const p = (s: string): string => prepareText(s, input.printer.characterSet);
  const b = esc(input.printer.characterSet, input.printer.characterTable).init();
  const text = (s: string): void => {
    for (const line of wrapText(p(s), columns)) b.line(line);
  };
  const row = (label: string, value: string): void => {
    for (const line of labelAmountLines(p(label), p(value), columns)) b.line(line);
  };
  text("JUSTIFICANTE DE PAGO");
  text("Este documento no es una factura");
  text(`${input.issuer.venueName} · ${input.issuer.nif}`);
  text(
    new Intl.DateTimeFormat(input.invoiceLocale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(input.paidAt)),
  );
  text([input.orderLabel, `Pedido ${input.orderNumber}`].filter(Boolean).join(" · "));
  b.line();
  if (input.card !== null) {
    row("Tarjeta", `${input.card.scheme} **** ${input.card.last4}`);
    const entry = ENTRY_MODE_LABEL[input.card.entryMode];
    if (entry !== undefined) row("Entrada", entry);
    if (input.card.authCode !== null) row("Autorización", input.card.authCode);
    b.line();
  }
  row("Importe", formatMoney(input.amount, input.invoiceLocale));
  if (input.tip !== "0.00") row("Propina", formatMoney(input.tip, input.invoiceLocale));
  row("Cobrado", formatMoney(input.charged, input.invoiceLocale));
  return b.feedAndCut().bytes();
}
