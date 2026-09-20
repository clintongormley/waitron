/**
 * Formats a filed sale into the customer's ESC/POS receipt (design §3b) — the pure byte-producing
 * half of the counter-printing slice. Like {@link formatKitchenTicket} it owns no state and touches no
 * database: it takes an already-filed {@link TillSaleResult} and returns the `print_jobs.payload` the
 * printing outbox moves verbatim. The counter-print path (Task 5) reads the sale, supplies the issuer
 * identity and the receipt trim, and hands these bytes to `enqueuePrintJob`; the HTTP layer is
 * elsewhere again. Keeping this a pure function is what lets the whole layout be pinned in a unit test
 * with no PGlite and no container.
 *
 * FISCAL SAFETY (spec §4). This function READS a `TillSaleResult` and produces bytes ONLY. It touches
 * no fiscal table, calls no filing/alta code, and imports nothing from `@waitron/core` or the alta
 * builders — the sale was already filed upstream, and the paper is a faithful RE-RENDER of that record,
 * never a second source of fiscal truth. The `TillSaleResult` import is TYPE-ONLY (erased at runtime),
 * so there is no runtime coupling to the till-sale filing path either.
 *
 * THE PAPER IS A LEGAL DOCUMENT. The printed ticket is a factura simplificada and reproduces the same
 * non-removable core the on-screen receipt does (`apps/till/src/screens/till-ticket-view.ts`), element
 * for element, so the paper never carries FEWER mandated elements than the screen (spec §4). The core
 * is RD 1619/2012 art. 7.1 plus the RRSIF/Veri*Factu QR + legend (Orden HAC/1177/2024 arts. 20-21),
 * all settled on primary source in `docs/compliance/verifactu-findings.md` §14:
 *
 *  - issuer venue name + NIF (7.1.d) — from {@link ReceiptIssuer};
 *  - número + serie (7.1.a) and fecha de expedición (7.1.b) — `result.invoiceNumber` / `result.issuedAt`;
 *  - identification of the goods (7.1.e) — one row per `result.lines` entry: name (invoice locale),
 *    quantity, per-line gross;
 *  - the tipo(s) impositivo(s) and the base imponible per rate (7.1.f) — from `result.vatBreakdown`
 *    (per-item VAT is NOT required; the cuota per rate is shown as an allowed extra);
 *  - contraprestación total (7.1.g) — `result.total`;
 *  - QR + VERI*FACTU legend (arts. 20-21).
 *
 * Allowed operational extras: efectivo (= total + change) and cambio. The owner-authored NON-FISCAL
 * trim ({@link ReceiptTrim}) renders AROUND that core — a header subtitle under the venue name and a
 * footer message under the legend — and can never suppress or reorder a mandated element, because the
 * core below is never read from or gated on it.
 *
 * INVOICE LOCALE. The receipt is a fiscal document ISSUED IN SPAIN and is rendered in the INVOICE
 * locale (`invoiceLocale`), which is INDEPENDENT of the operator's UI language (spec §9, findings §14):
 * an English-speaking operator still hands the customer a Spanish ticket. So the fiscal LABELS are
 * fixed Spanish constants ({@link LABEL} / {@link LEGEND}), while the money, date and product names are
 * FORMATTED with `invoiceLocale`. These helpers are ported here (not imported from `apps/till`) — an
 * `apps/server` → `apps/till` dependency would be backwards — but they are the same small, pure logic
 * the screen uses, kept in lock-step deliberately.
 *
 * PRINTER LAYOUT. The receipt takes the printer's paper width, resolution and character set
 * (design 2026-09-14): text is prepared for the character set, wrapped to the column count, and the QR
 * is a raster image sized to 30-40 mm. The builder has no bold verb, so the layout is plain text. The
 * paper itself is verified manually on the real printer; `receipt-ticket.test.ts` pins the bytes.
 */
import {
  QR_QUIET_ZONE,
  chooseQrDots,
  columnsFor,
  dpiValue,
  esc,
  labelAmountLines,
  prepareText,
  safeWidthDots,
  withQuietZone,
  wrapText,
  type CharacterSet,
  type PaperWidth,
  type Resolution,
} from "@waitron/printing";
import { customerOptionSnapshotLabels } from "@waitron/catalogue";
import { addDecimal, decimal, perDishOptionQuantity, resolveSnapshotText } from "@waitron/shared";

import { qrModules } from "./qr-matrix.js";
import { formatMoney } from "./receipt-money.js";
import type { TillSaleLine, TillSaleResult } from "./till-sale.js";

/** The receipt issuer's legally-printed identity (RD 1619/2012 art. 7.1.d): venue name + NIF. */
export interface ReceiptIssuer {
  venueName: string;
  nif: string;
}

/**
 * The owner-authored NON-FISCAL trim (design §8), mirroring the till's `ReceiptConfig`: a
 * `headerSubtitle` printed under the venue name and a `footerMessage` under the VERI*FACTU legend, both
 * optional. It renders AROUND the immutable art. 7.1 core, never inside it — no field here can suppress
 * or reorder a mandated element.
 */
export interface ReceiptTrim {
  headerSubtitle?: string;
  footerMessage?: string;
}

/** The three printer settings a receipt is laid out for (design 2026-09-14). */
export interface ReceiptPrinterSettings {
  paperWidth: PaperWidth;
  resolution: Resolution;
  characterSet: CharacterSet;
  characterTable: number;
}

/** Everything {@link formatReceipt} needs to render one filed sale onto paper. */
export interface FormatReceiptInput {
  /** The FILED sale to re-render — the authoritative fiscal figures and the goods composition. */
  result: TillSaleResult;
  /** The issuer identity legally printed on the ticket (art. 7.1.d). Supplied by the caller (Task 5). */
  issuer: ReceiptIssuer;
  /** The owner-authored non-fiscal header/footer trim; `{}` (or missing fields) prints no trim. */
  receipt: ReceiptTrim;
  /** The locale the money, date and product names are FORMATTED in (e.g. "es-ES"). NOT the operator UI. */
  invoiceLocale: string;
  /** The receipt printer's settings: they set the column count, the QR dot size and the text encoding. */
  printer: ReceiptPrinterSettings;
  /** Marks a Demo/Prepare transaction without changing any filed fiscal value. */
  simulated?: boolean;
  duplicate?: boolean;
}

/**
 * The fiscal labels are fixed Spanish constants — the invoice locale for a Spanish (ES-común) venue is
 * es-ES, so the receipt is a Spanish legal document regardless of the operator-UI language. The
 * `invoiceLocale` input drives number/date FORMATTING only; a non-Spanish invoice locale (a future
 * non-ES territory) would need a translated label set. Kept identical to `till-ticket-view.ts`'s LABEL.
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
} as const;

/** The Veri*Factu legend — a FIXED legal string (Orden HAC/1177/2024 art. 20.1.b). Never translated. */
const LEGEND = "VERI*FACTU";

/** The multiplication sign of a per-dish option-quantity badge (`×2`); `receipt-ticket.test.ts` pins it. */
const QTY_BADGE = "×";

/**
 * A filed line's goods name in the invoice locale (art. 7.1.e), resolved from the line's snapshotted
 * `descriptions` map exactly as the screen's `lineName` does: the invoice locale, then any description
 * the line carries, degrading to "" only for an empty map (a catalogue defect that still prints
 * something rather than blocking the paper — spec §4).
 */
function lineName(descriptions: Record<string, string>, locale: string): string {
  return descriptions[locale] ?? Object.values(descriptions)[0] ?? "";
}

/** A dish and the option lines filed beneath it — the shape {@link groupByParent} produces. */
interface LineGroup {
  dish: TillSaleLine;
  options: TillSaleLine[];
}

/**
 * Group the filed line list into dishes each carrying their child option lines (ordering modifiers,
 * Task 8). A parent dish has `parentLineNo == null`; a child option points at its dish's `lineNo`.
 * The filed lines arrive in emission order — dish immediately followed by its options
 * (`priceBasketWithOptions`) — so a single forward scan attaching each child to the most recent dish
 * groups them without a lookup. This does NOT recompute any figure: it re-orders the SAME already-filed
 * lines, so Σ(dish.gross + options.gross) is unchanged and still equals the filed `total`. Kept tiny and
 * in lock-step with the till's own `groupByParent` (`apps/till/src/screens/till-ticket-view.ts`), NOT
 * imported across the app boundary (an `apps/server` → `apps/till` dependency would be backwards).
 *
 * A leading child with no dish yet (structurally impossible for filed data — a dish is always emitted
 * before its options) is treated as its own dish rather than dropped, so no filed line ever vanishes
 * from a legal receipt and the printed lines always reconcile with the total (§4).
 */
function groupByParent(lines: readonly TillSaleLine[]): LineGroup[] {
  const groups: LineGroup[] = [];
  for (const line of lines) {
    const current = groups[groups.length - 1];
    if (line.parentLineNo == null || current === undefined) {
      groups.push({ dish: line, options: [] });
    } else {
      current.options.push(line);
    }
  }
  return groups;
}

/** The issue timestamp formatted in the invoice locale — the fecha de expedición (art. 7.1.b). */
function issueDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/**
 * Render one filed sale to an ESC/POS payload — the customer's factura simplificada. Pure and total:
 * an empty `lines`/`vatBreakdown` yields a header-and-total ticket rather than throwing, and an empty
 * `result.qr` prints no QR while still printing the legend. The element ORDER mirrors
 * `till-ticket-view.ts` element for element; only the line breaks depend on the printer. Every string
 * is prepared for the printer's character set before it is measured, so no printed line is longer than
 * the paper's column count.
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
  const columns = columnsFor(printer.paperWidth);
  const p = (s: string): string => prepareText(s, printer.characterSet);
  const b = esc(printer.characterSet, printer.characterTable).init();
  const text = (s: string, indent = 0): void => {
    for (const line of wrapText(p(s), columns, indent)) b.line(line);
  };
  const row = (label: string, amount: string, indent = 0): void => {
    for (const line of labelAmountLines(p(label), p(amount), columns, indent)) b.line(line);
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
  if (duplicate) b.line("DUPLICADO");
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
    const quantity = p(`${dish.quantity}${unit}  `);
    // The name's continuation lines normally start under the name (indent = the quantity prefix width).
    // Cap that at 2 when the prefix is wider than half the paper: past there `wrapText`'s remaining room
    // shrinks to a few columns and the name wraps one glyph per line.
    const nameIndent = quantity.length > columns / 2 ? 2 : quantity.length;
    row(
      `${quantity}${lineName(dish.descriptions, locale)}`,
      formatMoney(dish.gross, locale),
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
      row(label, formatMoney(option.gross, locale), 2);
    }
  }
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
  if (t.method === "cash") {
    row(LABEL.cash, formatMoney(addDecimal(decimal(result.total), decimal(t.change)), locale));
    row(LABEL.change, formatMoney(t.change, locale));
  } else if (t.method === "card") {
    b.line("Tarjeta");
    if (t.reference !== null) text(`Ref. ${t.reference}`);
    // String compare: `tenders.tip_amount` stores a count of whole cents, and `readTenderBlock`
    // (`till-sale.ts`) converts it at the row with `centsToDecimal`, which always renders two
    // places — so the tip reaching here is canonical "0.00"/"0.50" and never an unpadded "0".
    if (t.tip !== "0.00") {
      row(LABEL.tip, formatMoney(t.tip, locale));
      row(LABEL.charged, formatMoney(t.charged, locale));
    }
  }
  b.line();

  // The QR (arts. 20-21), printed as an image Waitron builds, sized for this printer (30-40 mm). A sale's
  // cotejo URL can legitimately be "" (the fiscal backend minted none): then no QR, but still the legend.
  if (result.qr !== "") {
    const matrix = qrModules(result.qr);
    const dots = chooseQrDots(
      matrix.length,
      dpiValue(printer.resolution),
      safeWidthDots(printer.paperWidth),
    );
    b.qrRaster(withQuietZone(matrix, QR_QUIET_ZONE), { moduleSize: dots }).line();
  }

  // The VERI*FACTU legend — printed UNCONDITIONALLY in Veri*Factu mode (art. 20.1.b).
  b.line(LEGEND);

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
