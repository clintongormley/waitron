import { liveBackupQuery, type Database } from "@waitron/db";
import type { CanonicalValue } from "@waitron/membership";
import {
  MalformedHoldingsError,
  type ModuleHandoverContribution,
  type UnreturnedChain,
  type WaitronModule,
} from "@waitron/module";
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
   * heard. When it does not name some module that fills the `unreturned` seat, or that module's
   * comparison throws `MalformedHoldingsError`, every module is listed whole.
   */
  mainHoldings: HeardHoldings | null;
  madeAt: Date;
  language: "en" | "es";
}

type Seat = { name: string; unreturned: NonNullable<ModuleHandoverContribution["unreturned"]> };

/**
 * Each seat's records the summary does not cover; null, so that every module is listed whole and
 * the first line can say so truly, when the summary does not name a module or a seat cannot read
 * its part.
 */
async function comparedChains(
  db: Database,
  seats: readonly Seat[],
  summary: Readonly<Record<string, CanonicalValue>> | undefined,
): Promise<UnreturnedChain[] | null> {
  if (summary === undefined || seats.some(({ name }) => summary[name] === undefined)) return null;
  const chains: UnreturnedChain[] = [];
  for (const { name, unreturned } of seats)
    try {
      for (const chain of await unreturned(liveBackupQuery(db), summary[name])) chains.push(chain);
    } catch (error) {
      if (error instanceof MalformedHoldingsError) return null;
      throw error;
    }
  return chains;
}

async function wholeChains(db: Database, seats: readonly Seat[]): Promise<UnreturnedChain[]> {
  const chains: UnreturnedChain[] = [];
  for (const { unreturned } of seats)
    for (const chain of await unreturned(liveBackupQuery(db), undefined)) chains.push(chain);
  return chains;
}

/**
 * The workbook an old main box makes: an Invoices tab listing, for each module that fills the
 * `unreturned` seat, the records the main box's summary does not show it holds (all of them, for
 * every module, when one module's part is not compared), each with its invoice's accountant
 * columns, one line per VAT rate.
 */
export async function buildOldBoxWorkbook(
  input: OldBoxWorkbookInput,
): Promise<Uint8Array<ArrayBuffer>> {
  const words = OLD_BOX_DATA_WORDS[input.language];
  const accountant = ACCOUNTANT_EXPORT_WORDS[input.language];
  const seats = input.modules.flatMap((module) => {
    const unreturned = module.handover?.unreturned;
    return unreturned === undefined ? [] : [{ name: module.name, unreturned }];
  });
  const compared = await comparedChains(input.db, seats, input.mainHoldings?.holdings);
  const chains = compared ?? (await wholeChains(input.db, seats));
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
    (compared !== null ? input.mainHoldings?.heardAt : undefined) ?? input.madeAt,
  );
  return renderWorkbook([
    {
      name: words.invoiceSheet,
      rows: [
        [
          (compared !== null ? words.invoiceIntro : words.uncomparedIntro).replace(
            "{time}",
            () => time,
          ),
        ],
        headings,
        ...rows,
      ],
    },
  ]);
}
