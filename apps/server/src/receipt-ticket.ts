/** Print filed invoice facts; receipt trim never changes the fiscal record.
 * Layout sources: docs/compliance/verifactu-findings.md §14.
 * Keep copied display helpers in step with apps/till/src/screens/till-ticket-view.ts;
 * the server cannot import the browser application. */
import {
  QR_QUIET_ZONE,
  chooseQrDots,
  dpiValue,
  esc,
  labelAmountLines,
  prepareText,
  safeWidthDots,
  withQuietZone,
  wrapText,
  type EscSetting,
  type MonoRaster,
} from "@waitron/printing";
import { customerOptionSnapshotLabels } from "@waitron/catalogue";
import type { ReceiptLabels } from "@waitron/country";
import { receiptLabelsFor } from "@waitron/country-packs";
import {
  addDecimal,
  decimal,
  perDishOptionQuantity,
  resolveSnapshotText,
  subtractDecimal,
} from "@waitron/shared";

import { qrModules } from "./qr-matrix.js";
import { groupByParent, trimQuantityForDisplay } from "./receipt-lines.js";
import { formatMoney } from "./receipt-money.js";
import type { ReceiptAdjustment, TillSaleLine, TillSaleResult } from "./till-sale.js";

/** The receipt issuer's legally-printed identity (RD 1619/2012 art. 7.1.d): venue name + NIF. */
export interface ReceiptIssuer {
  venueName: string;
  nif: string;
  domicile?: string;
}

/**
 * The owner-authored NON-FISCAL trim: a slogan, a phone and an email in the top block, and a message
 * after the payment lines. No field here can suppress or reorder a mandated element.
 */
export interface ReceiptTrim {
  headerSubtitle?: string;
  phone?: string;
  email?: string;
  footerMessage?: string;
}

/** Everything {@link formatReceipt} needs to render one filed sale onto paper. */
export interface FormatReceiptInput {
  /** The FILED sale to re-render — the authoritative fiscal figures and the goods composition. */
  result: TillSaleResult;
  /** The issuer identity legally printed on the ticket (art. 7.1.d). */
  issuer: ReceiptIssuer;
  /** The department heading supplied for this filed sale. */
  receiptHeader?: { tradingName: string | null; printTradingName: boolean };
  /** The owner-authored non-fiscal header/footer trim; `{}` (or missing fields) prints no trim. */
  receipt: ReceiptTrim;
  /** The venue's address, one printed line each; none prints no address. */
  venueAddress?: readonly string[];
  /** The logo already drawn for this printer's paper; none prints no logo. */
  logo?: MonoRaster | null;
  /** The locale the fixed words are printed in and the money, discount percentages and date are FORMATTED in (e.g. "es-ES"). NOT the operator UI. */
  invoiceLocale: string;
  /** The locale goods names, unit names and option answers are looked up in; defaults to `invoiceLocale`. */
  namesLocale?: string;
  /** The receipt printer's settings: they set the image width, the column count and the QR dot size. */
  printer: EscSetting;
  /** Marks a Demo/Prepare transaction without changing any filed fiscal value. */
  simulated?: boolean;
  duplicate?: boolean;
}

/**
 * A filed line's goods name (art. 7.1.e): the names' locale, then any description; "" only for an
 * empty map, so a catalogue defect still prints rather than blocking the paper.
 */
function lineName(descriptions: Record<string, string>, locale: string): string {
  return descriptions[locale] ?? Object.values(descriptions)[0] ?? "";
}

const percentFormatters = new Map<string, Intl.NumberFormat>();

/** The label of an amount taken off: `Descuento 12,5%` for 1250 basis points. */
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

/** The issue timestamp formatted in the invoice locale — the fecha de expedición (art. 7.1.b). */
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

/**
 * Render one filed sale. Empty `lines`/`vatBreakdown`
 * yield a header-and-total ticket, and an empty `result.qr` prints no QR block at all.
 * Every string goes through `prepareText` before it is measured, so no line exceeds the column count.
 */
export function formatReceipt({
  result,
  issuer: currentIssuer,
  receiptHeader,
  receipt,
  venueAddress = [],
  logo = null,
  invoiceLocale,
  namesLocale = invoiceLocale,
  printer,
  simulated = false,
  duplicate = false,
}: FormatReceiptInput): Uint8Array {
  const issuer = result.issuer ?? currentIssuer;
  const locale = invoiceLocale;
  const label = receiptLabelsFor(locale);
  const b = esc(printer);
  const { columns, widthDots } = b.grid;
  b.init().printArea(widthDots);
  const text = (s: string, indent = 0): void => {
    for (const line of wrapText(prepareText(s), columns, indent)) b.line(line);
  };
  const row = (caption: string, amount: string, indent = 0): void => {
    for (const line of labelAmountLines(
      prepareText(caption),
      prepareText(amount),
      columns,
      indent,
    )) {
      b.line(line);
    }
  };
  const netFacts = (line: TillSaleLine, unit: string, indent: number): void => {
    if (result.invoiceType !== "F1" || line.net === undefined) return;
    row(
      label.netUnitPrice,
      `${formatMoney(line.net.unitPrice, locale)} / ${trimQuantityForDisplay(line.net.priceQuantity)}${unit}`,
      indent,
    );
    row(`${label.base} ${line.net.rate}%`, formatMoney(line.net.base, locale), indent);
    if (line.net.tax !== undefined) {
      row(`${label.vat} ${line.net.rate}%`, formatMoney(line.net.tax, locale), indent);
    }
  };
  const takenOff = (adjustment: ReceiptAdjustment, indent: number): void => {
    const included = result.invoiceType === "F1" ? ` (${label.vatIncluded})` : "";
    const name = `${" ".repeat(indent)}${adjustmentLabel(adjustment, locale, label)}${included}`;
    row(name, `-${formatMoney(adjustment.amount, locale)}`, indent);
  };

  // The practice warning surrounds the immutable receipt content. It never enters the filed record or
  // its hash, but it must survive when a paper ticket leaves a Demo/Prepare till.
  if (simulated) {
    text(label.practice);
    b.line();
  }

  if (result.qr !== "") {
    const matrix = qrModules(result.qr);
    const dots = chooseQrDots(
      matrix.length,
      dpiValue(printer.resolution),
      safeWidthDots(printer.paperWidth),
    );
    b.align("center");
    if (result.qrText) text(result.qrText.caption);
    b.qrRaster(withQuietZone(matrix, QR_QUIET_ZONE), { moduleSize: dots });
    if (result.qrText) text(result.qrText.legend);
    b.line().align("left");
  }

  if (result.invoiceType === "F1") text(label.fullInvoice);

  b.align("center");
  if (logo !== null) b.bitmap(logo);
  const tradingName = receiptHeader?.tradingName?.trim();
  if (receiptHeader?.printTradingName && tradingName && tradingName !== issuer.venueName.trim()) {
    text(tradingName);
  }
  text(issuer.venueName);
  if (receipt.headerSubtitle) text(receipt.headerSubtitle);
  if (result.invoiceType !== "F1" || !issuer.domicile) {
    for (const line of venueAddress) text(line);
  }
  if (receipt.phone) text(`${label.phone} ${receipt.phone}`);
  if (receipt.email) text(receipt.email);
  if (duplicate) text(label.duplicate);
  text(`${label.nif}: ${issuer.nif}`);
  if (result.invoiceType === "F1") {
    if (issuer.domicile) text(issuer.domicile);
  }
  b.line().align("left");

  text([result.orderLabel, `${label.order} ${result.orderNumber}`].filter(Boolean).join(" · "));

  // Metadata — serie+número (7.1.a) and fecha de expedición (7.1.b).
  row(label.invoice, result.invoiceNumber);
  row(
    label.date,
    issueDate(
      result.issuedAt,
      locale,
      result.invoiceType === "F1" ? result.issuedOffsetMinutes : undefined,
    ),
  );
  if (result.invoiceType === "F1" && result.operationDate !== undefined) {
    row(
      label.operationDate,
      new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(`${result.operationDate}T00:00:00Z`),
      ),
    );
  }
  b.line();
  if (result.invoiceType === "F1" && result.recipient) {
    text(result.recipient.legalName);
    text(`${label.nif}: ${result.recipient.taxId}`);
    text(result.recipient.address);
    b.line();
  }

  // Goods identification (7.1.e) — the FILED composition, grouped so each option prints indented beneath
  // its dish at its own delta. A dish name's continuation lines start under the name, not the quantity.
  for (const { dish, options } of groupByParent(result.lines)) {
    // The unit abbreviation does NOT go through `lineName`: only `descriptions` is re-keyed onto the
    // invoice locales, so a unit map still carries the bare content-language keys it was stored
    // under ("es", not "es-ES") and an exact-key lookup would miss every one of them.
    const unit =
      dish.unitName == null
        ? ""
        : ` ${resolveSnapshotText(dish.unitName, namesLocale, namesLocale)}`;
    const quantity = prepareText(`${dish.quantity}${unit}  `);
    // The name's continuation lines normally start under the name (indent = the quantity prefix width).
    // Cap that at 2 when the prefix is wider than half the paper: past there `wrapText`'s remaining room
    // shrinks to a few columns and the name wraps one glyph per line.
    const nameIndent = quantity.length > columns / 2 ? 2 : quantity.length;
    if (result.invoiceType === "F1" && dish.net !== undefined) {
      text(`${quantity}${lineName(dish.descriptions, namesLocale)}`, nameIndent);
      netFacts(dish, unit, 2);
    } else {
      row(
        `${quantity}${lineName(dish.descriptions, namesLocale)}`,
        formatMoney(dish.listGross ?? dish.gross, locale),
        nameIndent,
      );
    }
    // The dish's frozen answers to its options lists, each under the dish it was asked about. An
    // extras pick is NOT here: it is its own priced child line, printed by the loop below.
    for (const answer of customerOptionSnapshotLabels(dish.optionSnapshots ?? [], namesLocale)) {
      text(`  ${answer}`, 2);
    }
    for (const option of options) {
      const name = lineName(option.descriptions, namesLocale);
      let caption: string;
      if (result.invoiceType === "F1") {
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
      if (result.invoiceType === "F1" && option.net !== undefined) {
        text(caption, 2);
        netFacts(
          option,
          option.unitName == null
            ? ""
            : ` ${resolveSnapshotText(option.unitName, namesLocale, namesLocale)}`,
          2,
        );
      } else {
        row(caption, formatMoney(option.listGross ?? option.gross, locale), 2);
      }
    }
    for (const line of [dish, ...options]) {
      for (const adjustment of line.adjustments ?? []) takenOff(adjustment, 2);
    }
  }
  for (const adjustment of result.billAdjustments ?? []) takenOff(adjustment, 0);
  b.line();

  // VAT breakdown (7.1.f) — base imponible + cuota per tipo impositivo.
  for (const v of result.vatBreakdown) {
    row(`${label.base} ${v.rate}%`, formatMoney(v.base, locale));
    row(`${label.vat} ${v.rate}%`, formatMoney(v.tax, locale));
  }
  b.line();

  // Contraprestación total (7.1.g).
  row(label.total, formatMoney(result.total, locale));
  b.line();

  // Allowed operational extras — the tender block. Card identity belongs on the payment slip.
  const t = result.tender;
  if (result.payments !== undefined && result.payments.length > 0) {
    for (const payment of result.payments) {
      if (payment.method === "cash") {
        row(label.cash, formatMoney(payment.tendered, locale));
        if (payment.change !== "0.00") row(label.change, formatMoney(payment.change, locale));
      } else {
        // The tender amount is net of refunds, which print below it: show the original charge.
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
    // String compare is safe: `readTenderBlock` renders the tip with `centsToDecimal`, always two
    // places.
    if (t.tip !== "0.00") {
      row(label.tip, formatMoney(t.tip, locale));
      row(label.charged, formatMoney(t.charged, locale));
    }
  }
  b.line();

  if (receipt.footerMessage) {
    b.align("center");
    text(receipt.footerMessage);
    b.align("left");
  }

  // Repeat the practice warning at the tear-off edge so either end of a separated ticket identifies
  // the document as simulated.
  if (simulated) {
    b.line();
    text(label.practice);
  }

  return b.feedAndCut().bytes();
}
