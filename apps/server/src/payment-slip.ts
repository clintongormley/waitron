import { receiptLabelsFor } from "@waitron/country-packs";
import { esc, labelAmountLines, prepareText, wrapText, type EscSetting } from "@waitron/printing";
import type { CardDetails } from "@waitron/payments";
import { cardName } from "./card-details.js";
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
  /** Cash or a card typed into another machine, which has no card facts to print. */
  method?: "cash" | "card";
  /** Another card machine's operation number and name, as typed; printed only with a `card` method. */
  reference?: string | null;
  machine?: string | null;
  card: CardDetails | null;
  notTaken?: true;
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
  text(input.notTaken === true ? labels.paymentNotTakenHeading : labels.paymentHeading);
  text(labels.paymentNotice);
  text(`${input.issuer.venueName} · ${input.issuer.nif}`);
  text(receiptDateTime(input.paidAt, input.invoiceLocale));
  text([input.orderLabel, `${labels.order} ${input.orderNumber}`].filter(Boolean).join(" · "));
  b.line();
  if (input.card !== null) {
    row(labels.card, cardName(input.card, labels.card));
    const entries: Partial<Record<CardDetails["entryMode"], string>> = {
      contactless: labels.paymentContactless,
      chip: labels.paymentChip,
      swipe: labels.paymentSwipe,
    };
    const entry = entries[input.card.entryMode];
    if (entry !== undefined) row(labels.paymentEntry, entry);
    if (input.card.authCode !== null) row(labels.paymentAuthorization, input.card.authCode);
    b.line();
  } else if (input.method === "cash") {
    text(labels.cash);
  } else if (input.method === "card") {
    text([labels.card, input.machine].filter(Boolean).join(" · "));
    if (input.reference) text(`${labels.reference} ${input.reference}`);
  }
  row(labels.paymentAmount, formatMoney(input.amount, input.invoiceLocale));
  // A zero tip prints no line. `tip` comes from `centsToDecimal` (`payment-slip-print.ts`), which
  // always renders two places, so a zero tip is "0.00" and nothing else.
  if (input.tip !== "0.00") row(labels.tip, formatMoney(input.tip, input.invoiceLocale));
  if (input.notTaken !== true) row(labels.charged, formatMoney(input.charged, input.invoiceLocale));
  return b.feedAndCut().bytes();
}
