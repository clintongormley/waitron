/**
 * Formats a filed sale into the customer's ESC/POS receipt. Pure — no database, and no state beyond
 * a formatter cache — so the whole layout is pinned in a unit test.
 *
 * FISCAL SAFETY. It only reads an already-filed `TillSaleResult`: the paper is a re-render of the
 * filed record, never a second source of fiscal truth.
 *
 * THE PAPER IS A LEGAL DOCUMENT: a factura simplificada carrying the same mandated core as the
 * on-screen receipt (`apps/till/src/screens/till-ticket-view.ts`) — RD 1619/2012 art. 7.1 plus the
 * Veri*Factu QR and legend (Orden HAC/1177/2024 arts. 20-21); sources in
 * `docs/compliance/verifactu-findings.md` §14. The owner's non-fiscal trim renders around that core
 * and is never read by it.
 *
 * The receipt is issued in the INVOICE locale, not the operator's UI language: the fiscal labels
 * are fixed Spanish constants, and only money, discount percentages, date and product names are
 * formatted with `invoiceLocale`. The helpers shared with the till screen are copied rather than
 * imported, because `apps/server` must not depend on `apps/till`; keep them in step.
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
 * The owner-authored NON-FISCAL trim: a subtitle under the venue name and a message under the
 * legend. No field here can suppress or reorder a mandated element.
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
  /** The locale the money, discount percentages, date and product names are FORMATTED in (e.g. "es-ES"). NOT the operator UI. */
  invoiceLocale: string;
  /** The receipt printer's settings: they set the image width, the column count and the QR dot size. */
  printer: EscSetting;
  /** Marks a Demo/Prepare transaction without changing any filed fiscal value. */
  simulated?: boolean;
  duplicate?: boolean;
}

/**
 * Fixed Spanish legal labels, whatever the operator's language; a non-Spanish invoice locale would
 * need its own set.
 */
const LABEL = {
  nif: "NIF",
  invoice: "Factura",
  date: "Fecha",
  base: "Base",
  vat: "IVA",
  total: "TOTAL",
  cash: "Efectivo",
  change: "Cambio",
  tip: "Propina",
  charged: "Cobrado",
  refund: "Devolución",
  comp: "Invitación",
  discount: "Descuento",
} as const;

/** The Veri*Factu legend — a FIXED legal string (Orden HAC/1177/2024 art. 20.1.b). Never translated. */
const LEGEND = "VERI*FACTU";

/** AEAT's caption above the QR (its QR specification v0.5.0, §3). Spanish; never translated. */
const QR_CAPTION = "QR tributario:";

/** The per-dish option-quantity badge (`×2`). */
const QTY_BADGE = "×";

/**
 * A filed line's goods name (art. 7.1.e): the invoice locale, then any description; "" only for an
 * empty map, so a catalogue defect still prints rather than blocking the paper.
 */
function lineName(descriptions: Record<string, string>, locale: string): string {
  return descriptions[locale] ?? Object.values(descriptions)[0] ?? "";
}

const percentFormatters = new Map<string, Intl.NumberFormat>();

/** The label of an amount taken off: `Descuento 12,5%` for 1250 basis points. */
function adjustmentLabel(adjustment: ReceiptAdjustment, locale: string): string {
  if (adjustment.kind === "comp") return LABEL.comp;
  if (adjustment.percentBp === undefined) return LABEL.discount;
  let formatter = percentFormatters.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    percentFormatters.set(locale, formatter);
  }
  return `${LABEL.discount} ${formatter.format(adjustment.percentBp / 100)}%`;
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
  printer,
  simulated = false,
  duplicate = false,
}: FormatReceiptInput): Uint8Array {
  const locale = invoiceLocale;
  const b = esc(printer);
  const { columns, widthDots } = b.grid;
  b.init().printArea(widthDots);
  const text = (s: string, indent = 0): void => {
    for (const line of wrapText(prepareText(s), columns, indent)) b.line(line);
  };
  const row = (label: string, amount: string, indent = 0): void => {
    for (const line of labelAmountLines(prepareText(label), prepareText(amount), columns, indent)) {
      b.line(line);
    }
  };
  const takenOff = (adjustment: ReceiptAdjustment, indent: number): void => {
    const label = `${" ".repeat(indent)}${adjustmentLabel(adjustment, locale)}`;
    row(label, `-${formatMoney(adjustment.amount, locale)}`, indent);
  };

  // The practice warning surrounds the immutable receipt content. It never enters the filed record or
  // its hash, but it must survive when a paper ticket leaves a Demo/Prepare till.
  if (simulated) {
    text("PRUEBA - SIN COBRO REAL");
    b.line();
  }

  // Issuer block — venue name, optional non-fiscal subtitle, NIF (art. 7.1.d).
  text(issuer.venueName);
  if (receipt.headerSubtitle) text(receipt.headerSubtitle);
  if (duplicate) text("DUPLICADO");
  text(`${LABEL.nif}: ${issuer.nif}`);
  b.line();

  text([result.orderLabel, `Pedido ${result.orderNumber}`].filter(Boolean).join(" · "));

  // Metadata — serie+número (7.1.a) and fecha de expedición (7.1.b).
  row(LABEL.invoice, result.invoiceNumber);
  row(LABEL.date, issueDate(result.issuedAt, locale));
  b.line();

  // Goods identification (7.1.e) — the FILED composition, grouped so each option prints indented beneath
  // its dish at its own delta. A dish name's continuation lines start under the name, not the quantity.
  for (const { dish, options } of groupByParent(result.lines)) {
    // The unit abbreviation does NOT go through `lineName`: only `descriptions` is re-keyed onto the
    // invoice locales, so a unit map still carries the bare content-language keys it was stored
    // under ("es", not "es-ES") and an exact-key lookup would miss every one of them.
    const unit =
      dish.unitName == null ? "" : ` ${resolveSnapshotText(dish.unitName, locale, locale)}`;
    const quantity = prepareText(`${dish.quantity}${unit}  `);
    // The name's continuation lines normally start under the name (indent = the quantity prefix width).
    // Cap that at 2 when the prefix is wider than half the paper: past there `wrapText`'s remaining room
    // shrinks to a few columns and the name wraps one glyph per line.
    const nameIndent = quantity.length > columns / 2 ? 2 : quantity.length;
    row(
      `${quantity}${lineName(dish.descriptions, locale)}`,
      formatMoney(dish.listGross ?? dish.gross, locale),
      nameIndent,
    );
    // The dish's frozen answers to its options lists, each under the dish it was asked about. An
    // extras pick is NOT here: it is its own priced child line, printed by the loop below.
    for (const label of customerOptionSnapshotLabels(dish.optionSnapshots ?? [], locale)) {
      text(`  ${label}`, 2);
    }
    for (const option of options) {
      // No quantity prefix: an option is priced per dish. A "×N" badge shows a per-dish count above 1.
      const perDish = perDishOptionQuantity(option.quantity, dish.quantity);
      const name = lineName(option.descriptions, locale);
      const label = perDish > 1 ? `  ${name} ${QTY_BADGE}${perDish}` : `  ${name}`;
      row(label, formatMoney(option.listGross ?? option.gross, locale), 2);
    }
    for (const line of [dish, ...options]) {
      for (const adjustment of line.adjustments ?? []) takenOff(adjustment, 2);
    }
  }
  for (const adjustment of result.billAdjustments ?? []) takenOff(adjustment, 0);
  b.line();

  // VAT breakdown (7.1.f) — base imponible + cuota per tipo impositivo.
  for (const v of result.vatBreakdown) {
    row(`${LABEL.base} ${v.rate}%`, formatMoney(v.base, locale));
    row(`${LABEL.vat} ${v.rate}%`, formatMoney(v.tax, locale));
  }
  b.line();

  // Contraprestación total (7.1.g).
  row(LABEL.total, formatMoney(result.total, locale));
  b.line();

  // Allowed operational extras — the tender block. Card identity belongs on the payment slip.
  const t = result.tender;
  if (result.payments !== undefined && result.payments.length > 0) {
    for (const payment of result.payments) {
      if (payment.method === "cash") {
        row(LABEL.cash, formatMoney(payment.tendered, locale));
        if (payment.change !== "0.00") row(LABEL.change, formatMoney(payment.change, locale));
      } else {
        // The tender amount is net of refunds, which print below it: show the original charge.
        const charged = payment.refunds.reduce(
          (sum, refund) => addDecimal(addDecimal(sum, decimal(refund.amount)), decimal(refund.tip)),
          decimal(payment.amount),
        );
        row("Tarjeta", formatMoney(charged, locale));
        if (payment.reference !== null) text(`Ref. ${payment.reference}`);
      }
      if (payment.tip !== "0.00") row(LABEL.tip, formatMoney(payment.tip, locale));
      for (const refund of payment.refunds) {
        const given = addDecimal(decimal(refund.amount), decimal(refund.tip));
        row(LABEL.refund, formatMoney(subtractDecimal(decimal("0.00"), given), locale));
      }
    }
  } else if (t.method === "cash") {
    row(LABEL.cash, formatMoney(addDecimal(decimal(result.total), decimal(t.change)), locale));
    row(LABEL.change, formatMoney(t.change, locale));
  } else if (t.method === "card") {
    text("Tarjeta");
    if (t.reference !== null) text(`Ref. ${t.reference}`);
    // String compare is safe: `readTenderBlock` renders the tip with `centsToDecimal`, always two
    // places.
    if (t.tip !== "0.00") {
      row(LABEL.tip, formatMoney(t.tip, locale));
      row(LABEL.charged, formatMoney(t.charged, locale));
    }
  }
  b.line();

  // The QR (arts. 20-21), printed as an image Waitron builds, sized for this printer (30-40 mm). A sale's
  // cotejo URL can legitimately be "" (the fiscal backend minted none): then no QR, but still the legend.
  b.align("center");
  if (result.qr !== "") {
    const matrix = qrModules(result.qr);
    const dots = chooseQrDots(
      matrix.length,
      dpiValue(printer.resolution),
      safeWidthDots(printer.paperWidth),
    );
    b.line(QR_CAPTION);
    b.qrRaster(withQuietZone(matrix, QR_QUIET_ZONE), { moduleSize: dots });
  }

  // The VERI*FACTU legend — printed UNCONDITIONALLY in Veri*Factu mode (art. 20.1.b).
  b.line(LEGEND).line().align("left");

  // Non-fiscal footer trim, under the legend.
  if (receipt.footerMessage) text(receipt.footerMessage);

  // Repeat the practice warning at the tear-off edge so either end of a separated ticket identifies
  // the document as simulated.
  if (simulated) {
    b.line();
    text("PRUEBA - SIN COBRO REAL");
  }

  return b.feedAndCut().bytes();
}
