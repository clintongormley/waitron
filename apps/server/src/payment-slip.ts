import {
  esc,
  labelAmountLines,
  prepareText,
  textGrid,
  wrapText,
  type EscSetting,
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
  /** The receipt printer's settings, which set the image width and the column count. */
  printer: EscSetting;
}

const ENTRY_MODE_LABEL: Partial<Record<CardDetails["entryMode"], string>> = {
  contactless: "Sin contacto",
  chip: "Chip",
  swipe: "Banda",
};

export function formatPaymentSlip(input: PaymentSlipInput): Uint8Array {
  const { columns } = textGrid(input.printer.paperWidth, input.printer.resolution);
  const b = esc(input.printer).init();
  const text = (s: string): void => {
    for (const line of wrapText(prepareText(s), columns)) b.line(line);
  };
  const row = (label: string, value: string): void => {
    for (const line of labelAmountLines(prepareText(label), prepareText(value), columns)) {
      b.line(line);
    }
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
  // A zero tip prints no line. `tip` comes from `centsToDecimal` (`payment-slip-print.ts`), which
  // always renders two places, so a zero tip is "0.00" and nothing else.
  if (input.tip !== "0.00") row("Propina", formatMoney(input.tip, input.invoiceLocale));
  row("Cobrado", formatMoney(input.charged, input.invoiceLocale));
  return b.feedAndCut().bytes();
}
