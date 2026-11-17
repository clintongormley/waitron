import { sales, saleSubstitutions, tenders, tableExists, type Transaction } from "@waitron/db";
import { sql } from "drizzle-orm";
import { payments } from "@waitron/payments";
import { readReceiptLanguage } from "@waitron/menu";
import { resolveReceiptTrim, type ReceiptPresentation } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";
import { readVenueAddress } from "./venue-address.js";
import { readPresentations } from "@waitron/media";
import { readVenueLogoName } from "./receipt-venue-logo.js";

export async function readSimulatedCardPayment(
  tx: Transaction,
  saleId: string,
  practiceMode: boolean,
): Promise<boolean> {
  if (!practiceMode) return false;
  if (!(await tableExists(tx, "payments"))) return false;
  const charge = await tx.execute(sql`
    with recursive originals(id) as (
      select ${saleId}
      union
      select s.corrects_sale_id from ${sales} s
        join originals o on s.id = o.id where s.corrects_sale_id is not null
      union
      select s.substituted_sale_id from ${saleSubstitutions} s
        join originals o on s.substitution_sale_id = o.id
    )
    select distinct p.provider from ${payments} p join originals o on p.sale_id = o.id
    where p.state in ('captured', 'refunded', 'partially_refunded')
      and not exists (select 1 from ${tenders} t join originals o on t.sale_id = o.id where t.method <> 'card')
  `);
  return charge.rows.length === 1 && charge.rows[0]!.provider === "simulator";
}

export async function readReceiptPresentation(
  tx: Transaction,
  saleId: string,
  printedLanguage: string,
  practiceMode: boolean,
): Promise<
  ReceiptPresentation & {
    simulatedCardPayment: boolean;
    receiptHeader?: { tradingName: string; printTradingName: boolean };
  }
> {
  const header = await VENUE_SERVICE.readSaleReceiptHeader(tx, saleId);
  const current = await readReceiptLanguage(tx);
  const diagnostic = (event: { operation: string; code: string; departmentId?: string }) =>
    console.warn("receipt.optional_read_failed", event);
  const department =
    header?.departmentId == null
      ? null
      : await VENUE_SERVICE.readPrintedDepartmentReceipt(
          tx,
          {
            receiptLanguages: [...new Set([printedLanguage, current.locale])],
            receiptDiagnostic: diagnostic,
          },
          header.departmentId,
          "80mm",
        );
  let venueAddress: string[] = [];
  try {
    venueAddress = await readVenueAddress(tx);
  } catch {
    diagnostic({ operation: "readVenueAddress", code: "receipt.read_failed" });
  }
  const receiptTrim = resolveReceiptTrim(
    department?.receipt ?? null,
    await readVenueLogoName(tx, department, diagnostic),
    printedLanguage,
    current.locale,
  );
  if (receiptTrim.logo) {
    try {
      const image = (await readPresentations(tx, [receiptTrim.logo]))[receiptTrim.logo];
      if (image) receiptTrim.logoUrl = image.display;
    } catch {
      diagnostic({ operation: "readReceiptLogoPresentation", code: "receipt.read_failed" });
    }
  }
  return {
    simulatedCardPayment: await readSimulatedCardPayment(tx, saleId, practiceMode),
    receiptHeader: header?.departmentId == null ? undefined : header,
    receiptTrim,
    venueAddress,
    receiptSettings: { printAddress: department?.receipt.printAddress === true },
  };
}
