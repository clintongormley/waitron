import { customerOptionSnapshotLabels } from "@waitron/catalogue";
import type { ReceiptLabels } from "@waitron/country";
import { receiptLabelsFor } from "@waitron/country-packs";
import {
  addDecimal,
  decimal,
  perDishOptionQuantity,
  resolveSnapshotText,
  subtractDecimal,
  type ReceiptLogoRaster,
  type ReceiptPresentation,
} from "@waitron/shared";
import { groupByParent, trimQuantityForDisplay } from "./receipt-lines.js";
import { formatAmount, formatMoney, formatVatRate } from "./receipt-money.js";
import type { ReceiptAdjustment, TillSaleLine, TillSaleResult } from "./till-sale.js";

export interface ReceiptIssuer {
  venueName: string;
  nif: string;
  domicile?: string;
}

export interface ReceiptTrim {
  headerSubtitle?: string;
  phone?: string;
  email?: string;
  footerMessage?: string;
}

export interface ReceiptDocumentInput {
  surface?: "thermal" | "a4";
  logo?: ReceiptLogoRaster | null;
  result: Omit<TillSaleResult, keyof ReceiptPresentation>;
  issuer: ReceiptIssuer;
  receiptHeader?: { tradingName: string | null; printTradingName: boolean };
  receipt: ReceiptTrim;
  venueAddress?: readonly string[];
  invoiceLocale: string;
  namesLocale?: string;
  simulated?: boolean;
  duplicate?: boolean;
}

// The roll renderer resolves an indent after this prefix against the columns the line is drawn in.
export type ReceiptIndent = number | { after: string };
export type ReceiptStyle = { bold?: true; double?: true };
export type ReceiptElement =
  | { kind: "text"; text: string; indent: ReceiptIndent; style?: ReceiptStyle }
  | {
      kind: "amount";
      caption: string;
      amount: string;
      indent: ReceiptIndent;
      style?: ReceiptStyle;
      /** The fewest spaces between caption and amount on one line; fewer, and the amount drops. */
      gap?: number;
    }
  | { kind: "rule" }
  | { kind: "align"; alignment: "left" | "center" }
  | { kind: "logo" }
  | { kind: "qr"; text: string };

export interface ReceiptDocument {
  elements: readonly ReceiptElement[];
  duplicate: boolean;
  practice: boolean;
}

function lineName(descriptions: Record<string, string>, locale: string): string {
  return descriptions[locale] ?? Object.values(descriptions)[0] ?? "";
}

const percentFormatters = new Map<string, Intl.NumberFormat>();

function adjustmentLabel(
  adjustment: ReceiptAdjustment,
  locale: string,
  label: ReceiptLabels,
): string {
  if (adjustment.kind === "comp") return label.comp;
  if (adjustment.percentBp === undefined) return label.discount;
  let formatter = percentFormatters.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    percentFormatters.set(locale, formatter);
  }
  return `${label.discount} ${formatter.format(adjustment.percentBp / 100)}%`;
}

function issueDate(iso: string, locale: string, offsetMinutes?: number): string {
  const instant = new Date(iso);
  const date =
    offsetMinutes === undefined ? instant : new Date(instant.getTime() + offsetMinutes * 60_000);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(offsetMinutes === undefined ? {} : { timeZone: "UTC" }),
  }).format(date);
}

export function buildReceiptDocument({
  result,
  issuer: currentIssuer,
  receiptHeader,
  receipt,
  venueAddress = [],
  surface = "thermal",
  invoiceLocale,
  namesLocale = invoiceLocale,
  simulated = false,
  duplicate = false,
}: ReceiptDocumentInput): ReceiptDocument {
  const issuer = result.issuer ?? currentIssuer;
  const locale = invoiceLocale;
  const label = receiptLabelsFor(locale);
  const simplified = result.invoiceType !== "F1";
  const itemAmount = (value: string): string =>
    simplified ? formatAmount(value, locale) : formatMoney(value, locale);
  const elements: ReceiptElement[] = [];
  const text = (text: string, indent: ReceiptIndent = 0, style?: ReceiptStyle): void => {
    elements.push({ kind: "text", text, indent, ...(style ? { style } : {}) });
  };
  const row = (
    caption: string,
    amount: string,
    indent: ReceiptIndent = 0,
    style?: ReceiptStyle,
    gap?: number,
  ): void => {
    elements.push({
      kind: "amount",
      caption,
      amount,
      indent,
      ...(style ? { style } : {}),
      ...(gap === undefined ? {} : { gap }),
    });
  };
  // Ends a section; a section that drew nothing adds no second rule.
  const rule = (): void => {
    if (elements.at(-1)?.kind !== "rule") elements.push({ kind: "rule" });
  };
  const align = (alignment: "left" | "center"): void => {
    elements.push({ kind: "align", alignment });
  };
  const netFacts = (line: TillSaleLine, unit: string, indent: number): void => {
    if (simplified || line.net === undefined) return;
    row(
      label.netUnitPrice,
      `${formatMoney(line.net.unitPrice, locale)} / ${trimQuantityForDisplay(line.net.priceQuantity)}${unit}`,
      indent,
    );
    row(
      `${label.base} ${formatVatRate(line.net.rate, locale)}`,
      formatMoney(line.net.base, locale),
      indent,
    );
    if (line.net.tax !== undefined) {
      row(
        `${label.vat} ${formatVatRate(line.net.rate, locale)}`,
        formatMoney(line.net.tax, locale),
        indent,
      );
    }
  };
  const takenOff = (adjustment: ReceiptAdjustment, indent: number): void => {
    const included = simplified ? "" : ` (${label.vatIncluded})`;
    const name = `${" ".repeat(indent)}${adjustmentLabel(adjustment, locale, label)}${included}`;
    row(name, `-${itemAmount(adjustment.amount)}`, indent);
  };
  if (simulated) {
    text(label.practice);
    rule();
  }

  if (result.qr !== "") {
    align("center");
    if (result.qrText) text(result.qrText.caption);
    elements.push({ kind: "qr", text: result.qr });
    if (result.qrText) text(result.qrText.legend);
    rule();
    align("left");
  }

  if (!simplified) text(label.fullInvoice);

  align("center");
  elements.push({ kind: "logo" });
  const tradingName = receiptHeader?.tradingName?.trim();
  const printsTradingName =
    receiptHeader?.printTradingName === true &&
    !!tradingName &&
    tradingName !== issuer.venueName.trim();
  if (printsTradingName) text(tradingName, 0, { bold: true });
  if (receipt.headerSubtitle) text(receipt.headerSubtitle);
  text(issuer.venueName, 0, printsTradingName ? undefined : { bold: true });
  text(`${label.nif}: ${issuer.nif}`);
  if (surface === "thermal") {
    for (const line of venueAddress) text(line);
  }
  if (receipt.phone) text(`${label.phone} ${receipt.phone}`);
  if (receipt.email) text(receipt.email);
  if (!simplified && issuer.domicile) text(issuer.domicile);
  if (duplicate) text(label.duplicate);
  rule();
  align("left");

  const orderText = [result.orderLabel, `${label.order} ${result.orderNumber}`]
    .filter(Boolean)
    .join(" · ");
  if (simplified) {
    // Two spaces at least, or an order number running into the date reads as one figure.
    row(orderText, issueDate(result.issuedAt, locale), 0, undefined, 2);
    row(label.simplifiedInvoice, result.invoiceNumber);
  } else {
    text(orderText);
    row(label.invoice, result.invoiceNumber);
    row(label.date, issueDate(result.issuedAt, locale, result.issuedOffsetMinutes));
  }
  if (!simplified && result.operationDate !== undefined) {
    row(
      label.operationDate,
      new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(`${result.operationDate}T00:00:00Z`),
      ),
    );
  }
  rule();
  if (!simplified && result.recipient) {
    text(result.recipient.legalName);
    text(`${label.nif}: ${result.recipient.taxId}`);
    text(result.recipient.address);
    rule();
  }
  for (const { dish, options } of groupByParent(result.lines)) {
    const unit =
      dish.unitName == null
        ? ""
        : ` ${resolveSnapshotText(dish.unitName, namesLocale, namesLocale)}`;
    const quantity = `${dish.quantity}${unit}  `;
    const nameIndent: ReceiptIndent = { after: quantity };
    if (!simplified && dish.net !== undefined) {
      text(`${quantity}${lineName(dish.descriptions, namesLocale)}`, nameIndent);
      netFacts(dish, unit, 2);
    } else {
      row(
        `${quantity}${lineName(dish.descriptions, namesLocale)}`,
        itemAmount(dish.listGross ?? dish.gross),
        nameIndent,
      );
    }
    for (const answer of customerOptionSnapshotLabels(dish.optionSnapshots ?? [], namesLocale)) {
      text(`  ${answer}`, 2);
    }
    for (const option of options) {
      const name = lineName(option.descriptions, namesLocale);
      let caption: string;
      if (!simplified) {
        const unit =
          option.unitName == null
            ? ""
            : ` ${resolveSnapshotText(option.unitName, namesLocale, namesLocale)}`;
        caption = `  ${name} ${option.quantity}${unit}`;
      } else if (option.unitName == null || option.soldInEach === true) {
        const perDish = perDishOptionQuantity(option.quantity, dish.quantity);
        caption = perDish > 1 ? `  ${name} x${perDish}` : `  ${name}`;
      } else {
        caption = `  ${name} ${option.quantity} ${resolveSnapshotText(option.unitName, namesLocale, namesLocale)}`;
      }
      if (!simplified && option.net !== undefined) {
        text(caption, 2);
        netFacts(
          option,
          option.unitName == null
            ? ""
            : ` ${resolveSnapshotText(option.unitName, namesLocale, namesLocale)}`,
          2,
        );
      } else {
        row(caption, itemAmount(option.listGross ?? option.gross), 2);
      }
    }
    for (const line of [dish, ...options]) {
      for (const adjustment of line.adjustments ?? []) takenOff(adjustment, 2);
    }
  }
  for (const adjustment of result.billAdjustments ?? []) takenOff(adjustment, 0);
  rule();
  const vatRows = (): void => {
    const [only] = result.vatBreakdown;
    // Art. 7.1.f: one rate needs only the rate; several need each rate's base as well.
    if (simplified && only !== undefined && result.vatBreakdown.length === 1) {
      row(
        label.vatIncludedAtRate.replace("{rate}", formatVatRate(only.rate, locale)),
        formatMoney(only.tax, locale),
      );
      return;
    }
    for (const v of result.vatBreakdown) {
      row(`${label.base} ${formatVatRate(v.rate, locale)}`, formatMoney(v.base, locale));
      row(`${label.vat} ${formatVatRate(v.rate, locale)}`, formatMoney(v.tax, locale));
    }
  };
  const total = (): void => {
    row(label.total, formatMoney(result.total, locale), 0, { double: true });
  };
  if (simplified) {
    total();
    vatRows();
  } else {
    vatRows();
    rule();
    total();
  }
  rule();
  const t = result.tender;
  if (result.payments !== undefined && result.payments.length > 0) {
    for (const payment of result.payments) {
      if (payment.method === "cash") {
        row(label.cash, formatMoney(payment.tendered, locale));
        if (payment.change !== "0.00") row(label.change, formatMoney(payment.change, locale));
      } else {
        const charged = payment.refunds.reduce(
          (sum, refund) => addDecimal(addDecimal(sum, decimal(refund.amount)), decimal(refund.tip)),
          decimal(payment.amount),
        );
        row(label.card, formatMoney(charged, locale));
        if (payment.reference !== null) text(`${label.reference} ${payment.reference}`);
      }
      if (payment.tip !== "0.00") row(label.tip, formatMoney(payment.tip, locale));
      for (const refund of payment.refunds) {
        const given = addDecimal(decimal(refund.amount), decimal(refund.tip));
        row(label.refund, formatMoney(subtractDecimal(decimal("0.00"), given), locale));
      }
    }
  } else if (t.method === "cash") {
    row(label.cash, formatMoney(addDecimal(decimal(result.total), decimal(t.change)), locale));
    row(label.change, formatMoney(t.change, locale));
  } else if (t.method === "card") {
    text(label.card);
    if (t.reference !== null) text(`${label.reference} ${t.reference}`);
    if (t.tip !== "0.00") {
      row(label.tip, formatMoney(t.tip, locale));
      row(label.charged, formatMoney(t.charged, locale));
    }
  }
  rule();

  if (receipt.footerMessage) {
    align("center");
    text(receipt.footerMessage);
    align("left");
  }
  if (simulated) {
    rule();
    text(label.practice);
  }
  if (elements.at(-1)?.kind === "rule") elements.pop();

  return { elements, duplicate, practice: simulated };
}
