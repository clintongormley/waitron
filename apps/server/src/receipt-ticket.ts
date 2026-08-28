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
 * NO emphasis/bold (the `@waitron/printing` builder exposes `init`/`text`/`line`/`feed`/`cut`/`qr`,
 * verified against packages/printing/src/escpos.ts — there is no bold verb), so the layout uses only
 * those verbs, with `twoColumn` giving a label-left / value-right column feel. Exact column fit and QR
 * millimetres are verified MANUALLY on the real printer (design §5); the guarantee here is only that
 * the bytes are DETERMINISTIC and carry every mandated element, which `receipt-ticket.test.ts` pins.
 */
import { esc } from "@waitron/printing";
import { addDecimal, decimal } from "@waitron/shared";

import type { TillSaleResult } from "./till-sale.js";

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
} as const;

/** The Veri*Factu legend — a FIXED legal string (Orden HAC/1177/2024 art. 20.1.b). Never translated. */
const LEGEND = "VERI*FACTU";

/**
 * The receipt's character column width, in monospace cells — the common 80mm / Font-A width the deli's
 * `ReceiptPrinter` targets. {@link twoColumn} right-aligns values within it. This is a COSMETIC hint
 * only: exact fit is verified manually on the real printer (design §5), so a label + value that overrun
 * the width simply run together with one space rather than wrapping.
 */
const RECEIPT_WIDTH = 42;

/**
 * Blank lines fed before the cut, so the tear-off clears the print head and the customer has something
 * to grip. Matches `formatKitchenTicket`'s `feed(3)` and the test-print payload in print-api.ts.
 */
const FEED_BEFORE_CUT = 3;

/**
 * Format a money amount for the paper — the EDGE where a `Decimal` string becomes human-readable text.
 * Ported from `apps/till/src/i18n/format.ts` (deliberately not imported: no `apps/server` → `apps/till`
 * dependency). `Number(value)` is safe only here: at money scale (≤ ~12 integer digits, 2 decimals) the
 * value is well within IEEE-754 double precision, so the display conversion is lossless; it must NOT be
 * used to round or compute. NOTE: `Intl.NumberFormat("es-ES", …)` places a NON-BREAKING space (U+00A0,
 * or a narrow no-break space U+202F on some ICU builds) between the amount and the €, not an ASCII
 * space — callers/tests comparing the output must account for that.
 */
function formatMoney(value: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(
    Number(value),
  );
}

/**
 * A filed line's goods name in the invoice locale (art. 7.1.e), resolved from the line's snapshotted
 * `descriptions` map exactly as the screen's `lineName` does: the invoice locale, then any description
 * the line carries, degrading to "" only for an empty map (a catalogue defect that still prints
 * something rather than blocking the paper — spec §4).
 */
function lineName(descriptions: Record<string, string>, locale: string): string {
  return descriptions[locale] ?? Object.values(descriptions)[0] ?? "";
}

/** The issue timestamp formatted in the invoice locale — the fecha de expedición (art. 7.1.b). */
function issueDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/**
 * Compose a label-left / value-right column line. The value is right-aligned within {@link
 * RECEIPT_WIDTH}; when the two would overrun the width they simply run together with a single space
 * (`Math.max(1, …)`), never wrapping — the fit is cosmetic and verified on hardware (design §5). The
 * padding math runs on the FORMATTED string at its true Unicode length, so a money value's €/NBSP is
 * measured correctly here even though those bytes do not survive a Latin-1 decode downstream.
 */
function twoColumn(label: string, value: string): string {
  const gap = Math.max(1, RECEIPT_WIDTH - label.length - value.length);
  return label + " ".repeat(gap) + value;
}

/**
 * Render one filed sale to an ESC/POS payload — the customer's factura simplificada. Pure and total:
 * an empty `lines`/`vatBreakdown` yields a header-and-total ticket rather than throwing, and an empty
 * `result.qr` prints no QR command while still printing the legend (mirroring `qrSvg("") === ""` on the
 * screen, where the legend is unconditional). The element ORDER below mirrors
 * `till-ticket-view.ts:229-318` element for element.
 */
export function formatReceipt({
  result,
  issuer,
  receipt,
  invoiceLocale,
}: FormatReceiptInput): Uint8Array {
  const locale = invoiceLocale;
  const b = esc().init();

  // Issuer block — venue name, optional non-fiscal subtitle, NIF (art. 7.1.d).
  b.line(issuer.venueName);
  if (receipt.headerSubtitle) b.line(receipt.headerSubtitle);
  b.line(`${LABEL.nif}: ${issuer.nif}`);
  b.line();

  // Metadata — serie+número (7.1.a) and fecha de expedición (7.1.b).
  b.line(twoColumn(LABEL.invoice, result.invoiceNumber));
  b.line(twoColumn(LABEL.date, issueDate(result.issuedAt, locale)));
  b.line();

  // Goods identification (7.1.e) — the FILED composition: quantity, name (invoice locale), per-line
  // gross. This is `result.lines`, never a client basket, so the printed list cannot diverge from the
  // invoice.
  for (const line of result.lines) {
    b.line(
      twoColumn(
        `${line.quantity}  ${lineName(line.descriptions, locale)}`,
        formatMoney(line.gross, locale),
      ),
    );
  }
  b.line();

  // VAT breakdown (7.1.f) — base imponible + cuota per tipo impositivo.
  for (const v of result.vatBreakdown) {
    b.line(twoColumn(`${LABEL.base} ${v.rate}%`, formatMoney(v.base, locale)));
    b.line(twoColumn(`${LABEL.vat} ${v.rate}%`, formatMoney(v.tax, locale)));
  }
  b.line();

  // Contraprestación total (7.1.g).
  b.line(twoColumn(LABEL.total, formatMoney(result.total, locale)));
  b.line();

  // Allowed operational extras: cash tendered (= total + change) and change.
  b.line(
    twoColumn(
      LABEL.cash,
      formatMoney(addDecimal(decimal(result.total), decimal(result.change)), locale),
    ),
  );
  b.line(twoColumn(LABEL.change, formatMoney(result.change, locale)));
  b.line();

  // The QR (arts. 20-21). A sale's cotejo URL can legitimately be "" (the fiscal backend minted none),
  // and a QR of nothing is not a scannable code — so print no QR command then, exactly as the screen
  // renders no QR while still printing the legend below.
  if (result.qr !== "") b.qr(result.qr).line();

  // The VERI*FACTU legend — printed UNCONDITIONALLY in Veri*Factu mode (art. 20.1.b).
  b.line(LEGEND);

  // Non-fiscal footer trim, under the legend.
  if (receipt.footerMessage) b.line(receipt.footerMessage);

  return b.feed(FEED_BEFORE_CUT).cut().bytes();
}
