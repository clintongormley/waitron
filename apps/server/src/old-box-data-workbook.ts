import { liveBackupQuery, type Database } from "@waitron/db";
import type { CanonicalValue } from "@waitron/membership";
import type { UnreturnedChain, WaitronModule } from "@waitron/module";
import { invoiceLineCells, paymentOnAccount, readAccountantInvoices } from "./accountant-export.js";
import { ACCOUNTANT_EXPORT_WORDS } from "./i18n/accountant-export.js";
import { OLD_BOX_DATA_WORDS } from "./i18n/old-box-data.js";
import { renderWorkbook, type Cell } from "./xlsx-workbook.js";

export interface OldBoxWorkbookInput {
  /** This (old) box's venue database; only read, never inside a write transaction. */
  db: Database;
  modules: readonly WaitronModule[];
  /** The main box's chain summary, by module name, as its download request carries it. */
  mainHoldings: Readonly<Record<string, CanonicalValue>>;
  madeAt: Date;
  language: "en" | "es";
}

/** The invoice columns an invoice this box does not hold leaves blank after its id. */
const INVOICE_CELLS_AFTER_ID = 19;

/**
 * The workbook an old main box makes for the main box: an Invoices tab listing, for each module
 * named in `mainHoldings` that fills the `unreturned` seat, the records the main box lacks, each
 * with its invoice's accountant columns, one line per VAT rate.
 */
export async function buildOldBoxWorkbook(
  input: OldBoxWorkbookInput,
): Promise<Uint8Array<ArrayBuffer>> {
  const words = OLD_BOX_DATA_WORDS[input.language];
  const accountant = ACCOUNTANT_EXPORT_WORDS[input.language];
  const chains: UnreturnedChain[] = [];
  for (const [name, held] of Object.entries(input.mainHoldings)) {
    const seat = input.modules.find((m) => m.name === name)?.handover?.unreturned;
    if (seat !== undefined) chains.push(...(await seat(liveBackupQuery(input.db), held)));
  }
  const saleIds = [...new Set(chains.flatMap((chain) => chain.records.map((r) => r.saleId)))];
  const invoices = new Map(
    (await readAccountantInvoices(input.db, { saleIds })).map((invoice) => [invoice.id, invoice]),
  );
  const rows: Cell[][] = [];
  for (const chain of chains) {
    const chainName = Object.entries(chain.ids)
      .map(([key, value]) => `${key}: ${value}`)
      .join("; ");
    for (const record of chain.records) {
      const recordCells: Cell[] = [
        chainName,
        String(record.number),
        words.recordTypes[record.type],
        record.createdAt,
        record.filingState === null
          ? words.notFiled
          : (words.filingStates[record.filingState] ?? record.filingState),
        chain.whole ? words.yes : words.no,
      ];
      const invoice = invoices.get(record.saleId);
      if (invoice === undefined) {
        rows.push([
          record.saleId,
          ...Array<Cell>(INVOICE_CELLS_AFTER_ID).fill(null),
          ...recordCells,
        ]);
        continue;
      }
      for (const cells of invoiceLineCells(invoice, accountant))
        rows.push([
          ...cells,
          invoice.saleDate ?? null,
          paymentOnAccount(invoice, accountant),
          ...recordCells,
        ]);
    }
  }
  const time = `${input.madeAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return renderWorkbook([
    {
      name: words.invoiceSheet,
      rows: [
        [words.invoiceIntro.replace("{time}", () => time)],
        [
          // The accountant's last column notes that export's own omissions, F3 among them; this tab omits none.
          ...accountant.invoiceColumns.slice(0, -1),
          accountant.saleDateColumn,
          accountant.paymentOnAccountColumn,
          ...words.recordColumns,
        ],
        ...rows,
      ],
    },
  ]);
}
