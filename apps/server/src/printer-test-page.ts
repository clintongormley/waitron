import { eq } from "drizzle-orm";
import { departments, readVenue, type Transaction } from "@waitron/db";
import type { ReceiptQrText } from "@waitron/fiscal";
import { readReceiptLanguage } from "@waitron/menu";
import type { EscSetting } from "@waitron/printing";
import { timeZoneOffsetMinutes } from "@waitron/shared";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import { readPrintedVenue, type PrintedVenue } from "./receipt-print.js";
import { formatReceipt } from "./receipt-ticket.js";
import { sampleDocument } from "./sample-receipt.js";
import { VENUE_SERVICE } from "./modules.js";
import type { TradingContext } from "./trading-context.js";

export interface PrinterTestPageInput extends PrintedVenue {
  receiptHeader?: ReceiptDocumentInput["receiptHeader"];
  printer: EscSetting;
  printerName: string;
  now: Date;
  timeZone: string;
  receiptLocale: string;
  qrText: ReceiptQrText | undefined;
  practice: boolean;
}

/** The sample sale, dated `now`, laid out as this venue's receipt and marked as no invoice. */
export function formatPrinterTestPage({
  printer,
  printerName,
  now,
  timeZone,
  receiptLocale,
  qrText,
  practice,
  ...venue
}: PrinterTestPageInput): Uint8Array {
  const sample = sampleDocument(qrText, receiptLocale);
  return formatReceipt({
    ...sample,
    ...venue,
    result: {
      ...sample.result,
      issuedAt: now.toISOString(),
      issuedOffsetMinutes: timeZoneOffsetMinutes(timeZone, now),
    },
    simulated: practice,
    testPage: { printer: `${printerName} · ${printer.paperWidth} · ${printer.resolution}` },
    printer,
  });
}

/** The test page as the venue's default department would print a receipt now. */
export async function layOutPrinterTestPage(
  tx: Transaction,
  cfg: Pick<TradingContext, "practiceMode">,
  page: Pick<PrinterTestPageInput, "printer" | "printerName" | "now" | "qrText">,
): Promise<Uint8Array> {
  const departmentId = await VENUE_SERVICE.receiptDefaultDepartment(tx);
  const receiptHeader =
    departmentId === null ? undefined : await readTradingNameHeader(tx, departmentId);
  const { locale } = await readReceiptLanguage(tx);
  const venue = (await readPrintedVenue(tx, cfg, departmentId, page.printer, locale))!;
  return formatPrinterTestPage({
    ...page,
    ...venue,
    ...(receiptHeader === undefined ? {} : { receiptHeader }),
    timeZone: (await readVenue(tx)).timeZone,
    receiptLocale: locale,
    practice: cfg.practiceMode === true,
  });
}

async function readTradingNameHeader(
  tx: Transaction,
  departmentId: string,
): Promise<NonNullable<ReceiptDocumentInput["receiptHeader"]>> {
  const [department] = await tx
    .select({
      tradingName: departments.tradingName,
      printTradingName: departments.printTradingName,
    })
    .from(departments)
    .where(eq(departments.id, departmentId));
  return department!;
}
