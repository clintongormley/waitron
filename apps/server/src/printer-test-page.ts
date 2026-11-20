import { eq } from "drizzle-orm";
import { departments, readVenue, type Transaction } from "@waitron/db";
import type { ReceiptQrText } from "@waitron/fiscal";
import { readReceiptLanguage } from "@waitron/menu";
import type { EscSetting } from "@waitron/printing";
import { AppError, timeZoneOffsetMinutes } from "@waitron/shared";
import "./errors.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import { readPrintedVenue, type PrintedVenue } from "./receipt-print.js";
import { formatReceipt } from "./receipt-ticket.js";
import { sampleDocument } from "./sample-receipt.js";
import { VENUE_SERVICE } from "./modules.js";
import type { TradingContext } from "./trading-context.js";

/** Beside the sample's first line, so the page stays a few lines long in every language. */
const SAMPLE_DISHES = 2;

export interface PrinterTestPageInput extends Omit<PrintedVenue, "issuer"> {
  receiptHeader?: ReceiptDocumentInput["receiptHeader"];
  printer: EscSetting;
  printerName: string;
  now: Date;
  timeZone: string;
  receiptLocale: string;
  qrText: ReceiptQrText | undefined;
}

/**
 * The sample sale from the sample issuer, dated `now`, with this venue's other printed parts, as a
 * practice document marked as no invoice. The venue's parts are taken by name so that a taxpayer
 * issuer passed along with them never replaces the sample's.
 */
export function formatPrinterTestPage({
  printer,
  printerName,
  now,
  timeZone,
  receiptLocale,
  qrText,
  receipt,
  venueAddress,
  logo,
  receiptHeader,
}: PrinterTestPageInput): Uint8Array {
  const sample = sampleDocument(qrText, receiptLocale, SAMPLE_DISHES);
  return formatReceipt({
    ...sample,
    receipt,
    venueAddress,
    logo,
    receiptHeader,
    result: {
      ...sample.result,
      issuedAt: now.toISOString(),
      issuedOffsetMinutes: timeZoneOffsetMinutes(timeZone, now),
    },
    testPage: { printer: `${printerName} · ${printer.paperWidth} · ${printer.resolution}` },
    printer,
  });
}

/** The test page with the venue's default department's header, trim, address and logo, dated now. */
export async function layOutPrinterTestPage(
  tx: Transaction,
  cfg: Pick<TradingContext, "practiceMode">,
  page: Pick<PrinterTestPageInput, "printer" | "printerName" | "now" | "qrText">,
): Promise<Uint8Array> {
  const departmentId = await VENUE_SERVICE.receiptDefaultDepartment(tx);
  const receiptHeader =
    departmentId === null ? undefined : await readTradingNameHeader(tx, departmentId);
  const { locale } = await readReceiptLanguage(tx);
  const venue = await readPrintedVenue(tx, cfg, departmentId, page.printer, locale, locale);
  if (venue === undefined) throw new AppError("venue.not_found", {});
  return formatPrinterTestPage({
    ...page,
    ...venue,
    ...(receiptHeader === undefined ? {} : { receiptHeader }),
    timeZone: (await readVenue(tx)).timeZone,
    receiptLocale: locale,
  });
}

async function readTradingNameHeader(
  tx: Transaction,
  departmentId: string,
): Promise<ReceiptDocumentInput["receiptHeader"]> {
  const [department] = await tx
    .select({
      tradingName: departments.tradingName,
      printTradingName: departments.printTradingName,
    })
    .from(departments)
    .where(eq(departments.id, departmentId));
  return department;
}
