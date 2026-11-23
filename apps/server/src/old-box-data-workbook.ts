import { liveBackupQuery, type Database } from "@waitron/db";
import { MalformedHoldingsError, type UnreturnedChain, type WaitronModule } from "@waitron/module";
import { invoiceLineCells, paymentOnAccount, readAccountantInvoices } from "./accountant-export.js";
import { ACCOUNTANT_EXPORT_WORDS } from "./i18n/accountant-export.js";
import { OLD_BOX_DATA_WORDS } from "./i18n/old-box-data.js";
import type { HeardHoldings } from "./old-box-holdings.js";
import { renderWorkbook, type Cell } from "./xlsx-workbook.js";

export interface OldBoxWorkbookInput {
  /** This (old) box's venue database; only read, never inside a write transaction. */
  db: Database;
  modules: readonly WaitronModule[];
  /**
   * The main box's chain summary from its latest answer, and when it arrived; null when none was
   * heard. A module it does not name, or whose seat cannot read its part, has every chain listed
   * whole.
   */
  mainHoldings: HeardHoldings | null;
  madeAt: Date;
  language: "en" | "es";
}

/**
 * The workbook an old main box makes: an Invoices tab listing, for each module that fills the
 * `unreturned` seat, the records the main box's summary does not show it holds (all of them for a
 * module the summary does not name), each with its invoice's accountant columns, one line per VAT
 * rate.
 */
export async function buildOldBoxWorkbook(
  input: OldBoxWorkbookInput,
): Promise<Uint8Array<ArrayBuffer>> {
  const words = OLD_BOX_DATA_WORDS[input.language];
  const accountant = ACCOUNTANT_EXPORT_WORDS[input.language];
  const chains: UnreturnedChain[] = [];
  let compared = true;
  for (const module of input.modules) {
    const seat = module.handover?.unreturned;
    if (seat === undefined) continue;
    const held = input.mainHoldings?.holdings[module.name];
    let listed: UnreturnedChain[] | undefined;
    if (held !== undefined)
      try {
        listed = await seat(liveBackupQuery(input.db), held);
      } catch (error) {
        if (!(error instanceof MalformedHoldingsError)) throw error;
      }
    if (listed === undefined) {
      compared = false;
      listed = await seat(liveBackupQuery(input.db), undefined);
    }
    chains.push(...listed);
  }
  const saleIds = [...new Set(chains.flatMap((chain) => chain.records.map((r) => r.saleId)))];
  const invoices = new Map(
    (await readAccountantInvoices(input.db, { saleIds })).map((invoice) => [invoice.id, invoice]),
  );
  const headings: Cell[] = [
    // The accountant's last column notes that export's own omissions, F3 among them; this tab omits none.
    ...accountant.invoiceColumns.slice(0, -1),
    accountant.saleDateColumn,
    accountant.paymentOnAccountColumn,
    ...words.recordColumns,
  ];
  const rows: Cell[][] = [];
  for (const chain of chains) {
    const chainName = Object.entries(chain.ids)
      .map(([key, value]) => `${words.chainFields[key] ?? key}: ${value}`)
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
          ...Array<Cell>(headings.length - words.recordColumns.length - 1).fill(null),
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
  const minute = (at: Date) => `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const time = minute(
    compared && input.mainHoldings !== null ? input.mainHoldings.heardAt : input.madeAt,
  );
  return renderWorkbook([
    {
      name: words.invoiceSheet,
      rows: [
        [(compared ? words.invoiceIntro : words.uncomparedIntro).replace("{time}", () => time)],
        headings,
        ...rows,
      ],
    },
  ]);
}
