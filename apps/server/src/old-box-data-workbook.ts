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
import {
  readActivitySince,
  readOrdersSince,
  readPaymentsSince,
  readTimeEntriesSince,
  type PaymentRow,
  type SinceRule,
} from "./old-box-data-since.js";
import type { Decimal } from "@waitron/shared";
import { renderWorkbook, type Cell, type WorkbookSheet } from "./xlsx-workbook.js";

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
  /** When present, the "since" tabs follow Invoices, listing rows from the rule's start. */
  since?: SinceRule;
}

/** The workbook's bytes and how many rows each tab lists, for the download's log line. */
export interface OldBoxWorkbook {
  bytes: Uint8Array<ArrayBuffer>;
  counts: {
    invoiceRows: number;
    orderRows?: number;
    paymentRows?: number;
    hoursRows?: number;
    activityRows?: number;
  };
}

const minute = (at: Date) => `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;

type Words = (typeof OLD_BOX_DATA_WORDS)["en" | "es"];

const amount = (value: Decimal | null): Cell => (value === null ? null : { number: value });

function paymentCells(fact: PaymentRow, words: Words): Cell[] {
  const kind = words.paymentKinds[fact.kind];
  const common = { at: fact.recordedAt, amount: amount(fact.amount), order: fact.orderNumber };
  const order = common.order === null ? null : String(common.order);
  switch (fact.kind) {
    case "part":
      return [
        kind,
        common.at,
        common.amount,
        amount(fact.tip),
        words.methods[fact.method] ?? fact.method,
        words.partPaymentStates[fact.state] ?? fact.state,
        order,
        null,
        null,
        null,
        fact.personName,
        fact.id,
      ];
    case "card":
      return [
        kind,
        common.at,
        common.amount,
        null,
        null,
        words.cardPaymentStates[fact.state] ?? fact.state,
        order,
        fact.provider,
        fact.reference,
        fact.partPaymentId,
        null,
        fact.id,
      ];
    case "drawer":
      return [
        kind,
        common.at,
        common.amount,
        null,
        null,
        words.drawerKinds[fact.drawerKind] ?? fact.drawerKind,
        order,
        null,
        null,
        fact.partPaymentId,
        fact.personName,
        fact.id,
      ];
  }
}

function sinceIntro(rule: SinceRule, words: Words): string {
  if (rule.kind === "all") return words.sinceAllIntro;
  const time = minute(new Date(rule.fromMs));
  return (rule.kind === "copy" ? words.sinceCopyIntro : words.sinceOwnIntro).replace(
    "{time}",
    () => time,
  );
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
  return (await makeOldBoxWorkbook(input)).bytes;
}

/** {@link buildOldBoxWorkbook}, with each tab's row count. */
export async function makeOldBoxWorkbook(input: OldBoxWorkbookInput): Promise<OldBoxWorkbook> {
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
  const time = minute(
    (compared !== null ? input.mainHoldings?.heardAt : undefined) ?? input.madeAt,
  );
  const sheets: WorkbookSheet[] = [
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
  ];
  const counts: OldBoxWorkbook["counts"] = { invoiceRows: rows.length };
  if (input.since !== undefined) {
    const intro = sinceIntro(input.since, words);
    const orders = await readOrdersSince(input.db, input.since);
    const facts = await readPaymentsSince(input.db, input.since);
    const hours = await readTimeEntriesSince(input.db, input.since);
    const activity = await readActivitySince(input.db, input.since);
    counts.orderRows = orders.length;
    counts.paymentRows = facts.length;
    counts.hoursRows = hours.length;
    counts.activityRows = activity.length;
    sheets.push(
      {
        name: words.ordersSheet,
        rows: [
          [intro],
          words.orderColumns,
          ...orders.map((order): Cell[] => [
            String(order.orderNumber),
            order.label,
            words.orderStatuses[order.status] ?? order.status,
            order.openedAt,
            order.settledAt,
            order.collectedAt,
            order.lineNo === null ? null : String(order.lineNo),
            order.item,
            order.quantity === null ? null : { number: order.quantity, places: 3 },
            amount(order.unitPrice),
            amount(order.lineTotal),
            order.sentAt,
            order.servedAt,
          ]),
        ],
      },
      {
        name: words.paymentsSheet,
        rows: [[intro], words.paymentColumns, ...facts.map((fact) => paymentCells(fact, words))],
      },
      {
        name: words.hoursSheet,
        rows: [
          [intro],
          words.hoursColumns,
          ...hours.map((entry): Cell[] => [
            entry.personName,
            words.entryKinds[entry.entryKind] ?? entry.entryKind,
            entry.eventAt,
            entry.recordedAt,
            entry.correctsEntryId,
            entry.correctionStatus === null
              ? null
              : (words.correctionStatuses[entry.correctionStatus] ?? entry.correctionStatus),
            entry.correctionReason,
            entry.id,
          ]),
        ],
      },
    );
    sheets.push({
      name: words.activitySheet,
      rows: [
        [intro],
        words.activityColumns,
        ...activity.map((entry) => [
          entry.at,
          entry.kind,
          entry.personName,
          entry.subjectKind,
          entry.subjectId,
        ]),
      ],
    });
  }
  return { bytes: await renderWorkbook(sheets), counts };
}
