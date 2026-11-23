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
import { timeZoneOffsetMinutes, type Decimal } from "@waitron/shared";
import { venueTimeZoneIn } from "./venue-time-zone.js";
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

/** `at` on the venue's wall clock, as `YYYY-MM-DD HH:MM:SS.mmm`. */
const wallClock = (at: Date, zone: string) =>
  new Date(at.getTime() + timeZoneOffsetMinutes(zone, at) * 60_000)
    .toISOString()
    .slice(0, 23)
    .replace("T", " ");
const minute = (at: Date, zone: string) => wallClock(at, zone).slice(0, 16);
/** The since tabs' cutoff, exact to the millisecond their reads compare. */
const exact = (at: Date, zone: string) => wallClock(at, zone);
/** A stored time as the venue's wall clock; text that is not a time is shown as stored. */
function localTime(stored: string | null, zone: string): Cell {
  if (stored === null) return null;
  const at = new Date(stored);
  return Number.isNaN(at.getTime()) ? stored : wallClock(at, zone);
}

type Words = (typeof OLD_BOX_DATA_WORDS)["en" | "es"];

const amount = (value: Decimal | null): Cell => (value === null ? null : { number: value });

const PAYMENT_KEYS = [
  "kind",
  "recordedAt",
  "changedAt",
  "amount",
  "tip",
  "method",
  "state",
  "order",
  "provider",
  "reference",
  "refundReference",
  "partPaymentId",
  "refundId",
  "person",
  "id",
] as const;

function paymentCells(
  fact: PaymentRow,
  words: Words,
  accountant: (typeof ACCOUNTANT_EXPORT_WORDS)["en" | "es"],
  zone: string,
): Cell[] {
  const cells: Partial<Record<(typeof PAYMENT_KEYS)[number], Cell>> = {
    kind: words.paymentKinds[fact.kind],
    recordedAt: localTime(fact.recordedAt, zone),
    changedAt: localTime(fact.changedAt, zone),
    amount: amount(fact.amount),
    order: fact.orderNumber === null ? null : String(fact.orderNumber),
    id: fact.id,
  };
  switch (fact.kind) {
    case "part":
      Object.assign(cells, {
        tip: amount(fact.tip),
        method: accountant.paymentMethods[fact.method],
        state: words.partPaymentStates[fact.state],
        person: fact.personName,
      });
      break;
    case "card":
      Object.assign(cells, {
        state: accountant.paymentStates[fact.state],
        provider: fact.provider,
        reference: fact.reference,
        partPaymentId: fact.partPaymentId,
      });
      break;
    case "refund":
      Object.assign(cells, {
        tip: amount(fact.tip),
        method: accountant.paymentMethods[fact.method],
        state: words.refundStates[fact.state],
        provider: fact.provider,
        reference: fact.reference,
        refundReference: fact.refundReference,
        partPaymentId: fact.partPaymentId,
        person: fact.personName,
      });
      break;
    case "cardRefund":
      Object.assign(cells, {
        state: words.cardRefundStates[fact.state],
        provider: fact.provider,
        reference: fact.reference,
        refundReference: fact.refundReference,
        person: fact.personName,
      });
      break;
    case "drawer":
      Object.assign(cells, {
        state: words.drawerKinds[fact.drawerKind],
        partPaymentId: fact.partPaymentId,
        refundId: fact.refundId,
        person: fact.personName,
      });
      break;
  }
  return PAYMENT_KEYS.map((key) => cells[key] ?? null);
}

function sinceIntro(
  rule: SinceRule,
  words: Words,
  tab: "payments" | "other",
  zone: string,
): string {
  if (rule.kind === "all") return words.sinceAllIntro;
  const time = exact(new Date(rule.fromMs), zone);
  const intros =
    tab === "payments"
      ? { copy: words.paymentsCopyIntro, own: words.paymentsOwnIntro }
      : { copy: words.sinceCopyIntro, own: words.sinceOwnIntro };
  return intros[rule.kind].replace("{time}", () => time);
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
 * The workbook an old main box makes, with each tab's row count: an Invoices tab listing, for each
 * module that fills the `unreturned` seat, the records the main box's summary does not show it
 * holds (all of them, for every module, when one module's part is not compared), each with its
 * invoice's accountant columns, one line per VAT rate.
 */
export async function makeOldBoxWorkbook(input: OldBoxWorkbookInput): Promise<OldBoxWorkbook> {
  const words = OLD_BOX_DATA_WORDS[input.language];
  const accountant = ACCOUNTANT_EXPORT_WORDS[input.language];
  const zone = await venueTimeZoneIn(input.db);
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
    // The accountant's last column notes that export's own omissions, F3 among them; this tab omits
    // none. Its voided time is the venue's wall clock here, so that heading is this tab's own.
    ...accountant.invoiceColumns.slice(0, -2),
    words.voidedAtColumn,
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
        localTime(record.createdAt, zone),
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
          ...cells.slice(0, -1),
          localTime(invoice.voidedAt, zone),
          invoice.saleDate ?? null,
          paymentOnAccount(invoice, accountant),
          ...recordCells,
        ]);
    }
  }
  const time = minute(
    (compared !== null ? input.mainHoldings?.heardAt : undefined) ?? input.madeAt,
    zone,
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
    const intro = sinceIntro(input.since, words, "other", zone);
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
            words.orderStatuses[order.status],
            localTime(order.openedAt, zone),
            localTime(order.settledAt, zone),
            localTime(order.collectedAt, zone),
            order.lineNo === null ? null : String(order.lineNo),
            order.item,
            order.quantity === null ? null : { number: order.quantity, places: 3 },
            amount(order.unitPrice),
            amount(order.lineTotal),
            localTime(order.sentAt, zone),
            localTime(order.servedAt, zone),
          ]),
        ],
      },
      {
        name: words.paymentsSheet,
        rows: [
          [sinceIntro(input.since, words, "payments", zone)],
          words.paymentColumns,
          ...facts.map((fact) => paymentCells(fact, words, accountant, zone)),
        ],
      },
      {
        name: words.hoursSheet,
        rows: [
          [intro],
          words.hoursColumns,
          ...hours.map((entry): Cell[] => [
            entry.personName,
            words.entryKinds[entry.entryKind],
            localTime(entry.eventAt, zone),
            localTime(entry.recordedAt, zone),
            entry.correctsEntryId,
            entry.correctionStatus === null
              ? null
              : words.correctionStatuses[entry.correctionStatus],
            entry.correctionReason,
            entry.id,
          ]),
        ],
      },
      {
        name: words.activitySheet,
        rows: [
          [intro],
          words.activityColumns,
          ...activity.map((entry) => [
            localTime(entry.at, zone),
            entry.kind,
            entry.personName,
            entry.subjectKind,
            entry.subjectId,
          ]),
        ],
      },
    );
  }
  return { bytes: await renderWorkbook(sheets), counts };
}
