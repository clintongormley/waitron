import { receiptLabelsFor } from "@waitron/country-packs";
import { esc, labelAmountLines, prepareText, wrapText, type EscSetting } from "@waitron/printing";
import type { CardDetails } from "@waitron/payments";
import { receiptDateTime } from "./receipt-dates.js";
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

export function formatPaymentSlip(input: PaymentSlipInput): Uint8Array {
  const labels = receiptLabelsFor(input.invoiceLocale);
  const b = esc(input.printer).init();
  const { columns } = b.grid;
  const text = (s: string): void => {
    for (const line of wrapText(prepareText(s), columns)) b.line(line);
  };
  const row = (label: string, value: string): void => {
    for (const line of labelAmountLines(prepareText(label), prepareText(value), columns)) {
      b.line(line);
    }
  };
  text(labels.paymentHeading);
  text(labels.paymentNotice);
  text(`${input.issuer.venueName} · ${input.issuer.nif}`);
  text(receiptDateTime(input.paidAt, input.invoiceLocale));
  text([input.orderLabel, `${labels.order} ${input.orderNumber}`].filter(Boolean).join(" · "));
  b.line();
  if (input.card !== null) {
    row(labels.card, `${input.card.scheme} **** ${input.card.last4}`);
    const entries: Partial<Record<CardDetails["entryMode"], string>> = {
      contactless: labels.paymentContactless,
      chip: labels.paymentChip,
      swipe: labels.paymentSwipe,
    };
    const entry = entries[input.card.entryMode];
    if (entry !== undefined) row(labels.paymentEntry, entry);
    if (input.card.authCode !== null) row(labels.paymentAuthorization, input.card.authCode);
    b.line();
  }
  row(labels.paymentAmount, formatMoney(input.amount, input.invoiceLocale));
  // A zero tip prints no line. `tip` comes from `centsToDecimal` (`payment-slip-print.ts`), which
  // always renders two places, so a zero tip is "0.00" and nothing else.
  if (input.tip !== "0.00") row(labels.tip, formatMoney(input.tip, input.invoiceLocale));
  row(labels.charged, formatMoney(input.charged, input.invoiceLocale));
  return b.feedAndCut().bytes();
}
