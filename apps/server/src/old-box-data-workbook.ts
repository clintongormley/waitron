import { liveBackupQuery, type Database } from "@waitron/db";
import type { CanonicalValue } from "@waitron/membership";
import {
  MalformedHoldingsError,
  type ModuleHandoverContribution,
  type UnreturnedChain,
  type WaitronModule,
} from "@waitron/module";
import {
  INVOICE_LINE_KEYS,
  invoiceLineCells,
  paymentOnAccount,
  readAccountantInvoices,
} from "./accountant-export.js";
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
  /** `madeAt`'s date on the venue's calendar, `YYYY-MM-DD`, for the file's name. */
  madeOn: string;
  counts: {
    invoiceRows: number;
    orderRows?: number;
    paymentRows?: number;
    hoursRows?: number;
    activityRows?: number;
  };
}

/** Minutes east of UTC at an instant. */
type OffsetAt = (at: Date) => number;

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * `at` on a clock `offset` minutes east of UTC, as `YYYY-MM-DD HH:MM:SS.mmm+HH:MM`, or to the
 * minute: the offset tells apart the two hours a clock change repeats.
 */
function wallClock(at: Date, offset: number, to: "ms" | "minute" = "ms"): string {
  const local = new Date(at.getTime() + offset * 60_000)
    .toISOString()
    .slice(0, to === "ms" ? 23 : 16)
    .replace("T", " ");
  const size = Math.abs(offset);
  return `${local}${offset < 0 ? "-" : "+"}${pad(Math.floor(size / 60))}:${pad(size % 60)}`;
}

const QUARTER_HOUR_MS = 15 * 60_000;
const LAST_DATE_MS = 8.64e15;

/**
 * The venue zone's offset, asked once per quarter hour of UTC while the quarter's first and last
 * millisecond agree, and once per instant in a quarter holding a change.
 */
function zoneOffsets(zone: string): OffsetAt {
  const quarters = new Map<number, number | null>();
  return (at) => {
    const quarter = Math.floor(at.getTime() / QUARTER_HOUR_MS);
    let offset = quarters.get(quarter);
    if (offset === undefined) {
      const start = quarter * QUARTER_HOUR_MS;
      const first = timeZoneOffsetMinutes(zone, new Date(start));
      const last = timeZoneOffsetMinutes(
        zone,
        new Date(Math.min(start + QUARTER_HOUR_MS - 1, LAST_DATE_MS)),
      );
      offset = first === last ? first : null;
      quarters.set(quarter, offset);
    }
    return offset ?? timeZoneOffsetMinutes(zone, at);
  };
}

/** A stored time on the clock `offsetAt` gives; text that is not a time is shown as stored. */
function localTime(stored: string | null, offsetAt: OffsetAt): Cell {
  if (stored === null) return null;
  const at = new Date(stored);
  return Number.isNaN(at.getTime()) ? stored : wallClock(at, offsetAt(at));
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
  offsetAt: OffsetAt,
): Cell[] {
  const cells: Partial<Record<(typeof PAYMENT_KEYS)[number], Cell>> = {
    kind: words.paymentKinds[fact.kind],
    recordedAt: localTime(fact.recordedAt, offsetAt),
    changedAt: localTime(fact.changedAt, offsetAt),
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
  offsetAt: OffsetAt,
): string {
  if (rule.kind === "all") return words.sinceAllIntro;
  const from = new Date(rule.fromMs);
  const time = wallClock(from, offsetAt(from));
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
  const offsetAt = zoneOffsets(await venueTimeZoneIn(input.db));
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
    // The accountant's notes column names that export's own omissions, F3 among them; this tab omits
    // none, so it has no such column.
    ...INVOICE_LINE_KEYS.map((key) =>
      key === "voidedAt" ? words.voidedAtColumn : accountant.invoiceColumns[key],
    ),
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
        localTime(record.createdAt, offsetAt),
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
      for (const cells of invoiceLineCells(invoice, accountant, (stored) =>
        localTime(stored, offsetAt),
      ))
        rows.push([
          ...cells,
          invoice.saleDate ?? null,
          paymentOnAccount(invoice, accountant),
          ...recordCells,
        ]);
    }
  }
  const heardAt = (compared !== null ? input.mainHoldings?.heardAt : undefined) ?? input.madeAt;
  const time = wallClock(heardAt, offsetAt(heardAt), "minute");
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
    const intro = sinceIntro(input.since, words, "other", offsetAt);
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
            localTime(order.openedAt, offsetAt),
            localTime(order.settledAt, offsetAt),
            localTime(order.collectedAt, offsetAt),
            order.lineNo === null ? null : String(order.lineNo),
            order.item,
            order.quantity === null ? null : { number: order.quantity, places: 3 },
            amount(order.unitPrice),
            amount(order.lineTotal),
            localTime(order.sentAt, offsetAt),
            localTime(order.servedAt, offsetAt),
          ]),
        ],
      },
      {
        name: words.paymentsSheet,
        rows: [
          [sinceIntro(input.since, words, "payments", offsetAt)],
          words.paymentColumns,
          ...facts.map((fact) => paymentCells(fact, words, accountant, offsetAt)),
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
            localTime(entry.eventAt, () => entry.eventOffsetMinutes),
            localTime(entry.recordedAt, offsetAt),
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
            localTime(entry.at, offsetAt),
            entry.kind,
            entry.personName,
            entry.subjectKind,
            entry.subjectId,
          ]),
        ],
      },
    );
  }
  const madeOn = wallClock(input.madeAt, offsetAt(input.madeAt)).slice(0, 10);
  return { bytes: await renderWorkbook(sheets), madeOn, counts };
}
