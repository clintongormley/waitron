import type { Transaction } from "@waitron/db";
import { readReceiptLanguage } from "@waitron/catalogue";
import { resolveReceiptTrim, type ReceiptPresentation } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { readLocationAddress } from "./venue-address.js";

export async function readReceiptPresentation(
  tx: Transaction,
  cfg: Pick<TillConfig, "locationId">,
  saleId: string,
  printedLanguage: string,
): Promise<
  ReceiptPresentation & {
    receiptHeader?: { tradingName: string; printTradingName: boolean };
  }
> {
  const header = await VENUE_SERVICE.readSaleReceiptHeader(tx, saleId);
  const current = await readReceiptLanguage(tx, cfg.locationId);
  const diagnostic = (event: { operation: string; code: string; departmentId?: string }) =>
    console.warn("receipt.optional_read_failed", event);
  const department =
    header?.departmentId == null
      ? null
      : await VENUE_SERVICE.readPrintedDepartmentReceipt(
          tx,
          {
            ...cfg,
            receiptLanguages: [...new Set([printedLanguage, current.locale])],
            receiptDiagnostic: diagnostic,
          },
          header.departmentId,
          "80mm",
        );
  let venueAddress: string[] = [];
  try {
    venueAddress = await readLocationAddress(tx, cfg.locationId);
  } catch {
    diagnostic({ operation: "readLocationAddress", code: "receipt.read_failed" });
  }
  return {
    receiptHeader: header?.departmentId == null ? undefined : header,
    receiptTrim: resolveReceiptTrim(
      department?.receipt ?? null,
      {},
      printedLanguage,
      current.locale,
    ),
    venueAddress,
    receiptSettings: { printAddress: department?.receipt.printAddress === true },
  };
}
