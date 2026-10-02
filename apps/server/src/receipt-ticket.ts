/**
 * Formats a filed sale into the customer's ESC/POS receipt. Pure — no database, and no state beyond
 * a formatter cache — so the whole layout is pinned in a unit test.
 *
 * FISCAL SAFETY. It only reads an already-filed `TillSaleResult`: the paper is a re-render of the
 * filed record, never a second source of fiscal truth.
 *
 * THE PAPER IS A LEGAL DOCUMENT: a factura simplificada carrying the same mandated core as the
 * on-screen receipt (`apps/till/src/screens/till-ticket-view.ts`) — RD 1619/2012 art. 7.1 plus the
 * Veri*Factu QR and legend (Orden HAC/1177/2024 arts. 20-21), with AEAT's «QR tributario:» caption
 * above the QR; when a QR is printed, the caption, the QR and the legend come first, after any
 * practice warning (its QR specification v0.5.0, §3); sources in
 * `docs/compliance/verifactu-findings.md` §14 and the C115 entry in `docs/backlog.md`. The owner's
 * non-fiscal trim renders around that core and is never read by it.
 *
 * The receipt is issued in the INVOICE locale, not the operator's UI language: its fixed words come
 * from the country pack's table for that locale (`receiptLabelsFor`), and money, discount
 * percentages and date are formatted in it. Product names are looked up in `namesLocale`, which a
 * copy in another language sets to the language the sale was filed in. The helpers shared with the
 * till screen are copied rather than imported, because `apps/server` must not depend on
 * `apps/till`; keep them in step.
 */
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
import { groupByParent } from "./receipt-lines.js";
import { formatMoney } from "./receipt-money.js";
import type { ReceiptAdjustment, TillSaleResult } from "./till-sale.js";

/** The receipt issuer's legally-printed identity (RD 1619/2012 art. 7.1.d): venue name + NIF. */
export interface ReceiptIssuer {
  venueName: string;
  nif: string;
}

/**
 * The owner-authored NON-FISCAL trim: a subtitle under the venue name and a message after the
 * payment lines. No field here can suppress or reorder a mandated element.
 */
export interface ReceiptTrim {
  headerSubtitle?: string;
  footerMessage?: string;
}

/** Everything {@link formatReceipt} needs to render one filed sale onto paper. */
export interface FormatReceiptInput {
  /** The FILED sale to re-render — the authoritative fiscal figures and the goods composition. */
  result: TillSaleResult;
  /** The issuer identity legally printed on the ticket (art. 7.1.d). */
  issuer: ReceiptIssuer;
  /** The owner-authored non-fiscal header/footer trim; `{}` (or missing fields) prints no trim. */
  receipt: ReceiptTrim;
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

/** The Veri*Factu legend — a FIXED legal string (Orden HAC/1177/2024 art. 20.1.b). Never translated. */
const LEGEND = "VERI*FACTU";

/** AEAT's caption above the QR (its QR specification v0.5.0, §3). Spanish; never translated. */
const QR_CAPTION = "QR tributario:";

/** The per-dish option-quantity badge (`×2`). */
const QTY_BADGE = "×";

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
function issueDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/**
 * Render one filed sale — the customer's factura simplificada. Total: empty `lines`/`vatBreakdown`
 * yield a header-and-total ticket, and an empty `result.qr` prints no QR but still the legend.
 * Every string goes through `prepareText` before it is measured, so no line exceeds the column count.
 */
export function formatReceipt({
  result,
  issuer,
  receipt,
  invoiceLocale,
  namesLocale = invoiceLocale,
  printer,
  simulated = false,
  duplicate = false,
}: FormatReceiptInput): Uint8Array {
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
  const takenOff = (adjustment: ReceiptAdjustment, indent: number): void => {
    const name = `${" ".repeat(indent)}${adjustmentLabel(adjustment, locale, label)}`;
    row(name, `-${formatMoney(adjustment.amount, locale)}`, indent);
  };

  // The practice warning surrounds the immutable receipt content. It never enters the filed record or
  // its hash, but it must survive when a paper ticket leaves a Demo/Prepare till.
  if (simulated) {
    text(label.practice);
    b.line();
  }

  // AEAT's QR specification v0.5.0 §3 puts the QR at the start of the invoice, the caption above it
  // and the legend (art. 20.1.b) directly under it. The practice warning stays above it because it is
  // not invoice content.
  if (result.qr !== "") {
    const matrix = qrModules(result.qr);
    const dots = chooseQrDots(
      matrix.length,
      dpiValue(printer.resolution),
      safeWidthDots(printer.paperWidth),
    );
    b.align("center").line(QR_CAPTION);
    b.qrRaster(withQuietZone(matrix, QR_QUIET_ZONE), { moduleSize: dots });
    b.line(LEGEND).line().align("left");
  }

  // Issuer block — venue name, optional non-fiscal subtitle, NIF (art. 7.1.d).
  text(issuer.venueName);
  if (receipt.headerSubtitle) text(receipt.headerSubtitle);
  if (duplicate) text(label.duplicate);
  text(`${label.nif}: ${issuer.nif}`);
  b.line();

  text([result.orderLabel, `${label.order} ${result.orderNumber}`].filter(Boolean).join(" · "));

  // Metadata — serie+número (7.1.a) and fecha de expedición (7.1.b).
  row(label.invoice, result.invoiceNumber);
  row(label.date, issueDate(result.issuedAt, locale));
  b.line();

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
    row(
      `${quantity}${lineName(dish.descriptions, namesLocale)}`,
      formatMoney(dish.listGross ?? dish.gross, locale),
      nameIndent,
    );
    // The dish's frozen answers to its options lists, each under the dish it was asked about. An
    // extras pick is NOT here: it is its own priced child line, printed by the loop below.
    for (const answer of customerOptionSnapshotLabels(dish.optionSnapshots ?? [], namesLocale)) {
      text(`  ${answer}`, 2);
    }
    for (const option of options) {
      // No quantity prefix: an option is priced per dish. A "×N" badge shows a per-dish count above 1.
      const perDish = perDishOptionQuantity(option.quantity, dish.quantity);
      const name = lineName(option.descriptions, namesLocale);
      const caption = perDish > 1 ? `  ${name} ${QTY_BADGE}${perDish}` : `  ${name}`;
      row(caption, formatMoney(option.listGross ?? option.gross, locale), 2);
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

  // A sale with no cotejo URL (the fiscal backend minted none) prints no QR block, but still the
  // legend (art. 20.1.b), after the tender (the C115 entry in `docs/backlog.md`).
  if (result.qr === "") b.align("center").line(LEGEND).line().align("left");

  if (receipt.footerMessage) text(receipt.footerMessage);

  // Repeat the practice warning at the tear-off edge so either end of a separated ticket identifies
  // the document as simulated.
  if (simulated) {
    b.line();
    text(label.practice);
  }

  return b.feedAndCut().bytes();
}
