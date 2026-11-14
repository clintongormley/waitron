import { and, count, eq, gte, inArray, isNull, lt, max, min, ne, not, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import {
  kitchenPrintJobs,
  kitchenStations,
  printJobs,
  printers,
  stationPrinterPairs,
  type Transaction,
} from "@waitron/db";
import { MAX_DELIVERY_ATTEMPTS, PRINTER_UNPAIRED } from "@waitron/printing";
import { kitchenJobsNotWaiting } from "./kitchen-print.js";

/** A document job older than this that has not printed counts as in trouble. */
export const JOBS_WAITING_MS = 2 * 60 * 1000;

const copy = alias(printJobs, "resend_copy");
const link = alias(kitchenPrintJobs, "trouble_link");
const reprintLink = alias(kitchenPrintJobs, "trouble_reprint_link");
const reprintJob = alias(printJobs, "trouble_reprint_job");
const saleCopy = alias(printJobs, "trouble_sale_copy");
const printedResend = alias(printJobs, "trouble_printed_resend");
const laterPrinted = alias(printJobs, "trouble_later_printed");

/** `job` has printed, itself or through a printed Printers-screen resend of it. */
export function printedOrResent(job: typeof printJobs | typeof reprintJob): SQL {
  return sql`(${job.status} = 'done' or exists (select 1 from ${printJobs} as ${printedResend}
    where ${printedResend.status} = 'done'
    and ${printedResend.resendOf} = ${job.id}))`;
}

/**
 * A document job not printed after {@link JOBS_WAITING_MS}, or given up on (failed with no delivery
 * attempts left) however recent, until a later job standing in for it has printed: a resend of
 * the same job; for a kitchen ticket, a Reprint on the same printer for every bill and station the
 * ticket is linked to, printed itself or through a resend ({@link printedOrResent}), which is how
 * `readPrintProblems` (apps/server/src/kitchen-print.ts) clears each link; for a receipt, another
 * receipt of the same sale on the same printer. A drawer pulse never counts. The printer's alert
 * ({@link printersInTrouble}) and a table's printing problem both read this.
 * "After" is `rowid` (for a kitchen ticket, its link row's), not `created_at`, which two jobs can
 * share to the millisecond: SQLite gives a new row one more than the table's largest `rowid`.
 * `VACUUM` and `VACUUM INTO` kept that order in `print_jobs` and `kitchen_print_jobs`, with rows
 * deleted first to leave gaps, when measured (node:sqlite, Node v26.7.0, 2026-10-01).
 */
export function printJobInTrouble(now: Date): SQL {
  const stuckBefore = new Date(now.getTime() - JOBS_WAITING_MS).toISOString();
  return and(
    eq(printJobs.kind, "document"),
    or(
      and(
        inArray(printJobs.status, ["queued", "printing", "failed"]),
        lt(printJobs.createdAt, stuckBefore),
      ),
      and(eq(printJobs.status, "failed"), gte(printJobs.attempts, MAX_DELIVERY_ATTEMPTS)),
    ),
    not(
      sql`exists (select 1 from ${printJobs} as ${copy} where ${copy.status} = 'done'
        and ${copy.resendOf} = coalesce(${printJobs.resendOf}, ${printJobs.id})
        and ${copy}.rowid > ${printJobs}.rowid)`,
    ),
    not(
      and(
        sql`exists (select 1 from ${kitchenPrintJobs} as ${link}
          where ${link.printJobId} = ${printJobs.id})`,
        sql`not exists (select 1 from ${kitchenPrintJobs} as ${link}
          where ${link.printJobId} = ${printJobs.id}
          and not exists (select 1 from ${kitchenPrintJobs} as ${reprintLink}
            join ${printJobs} as ${reprintJob} on ${reprintJob.id} = ${reprintLink.printJobId}
            where ${eq(reprintLink.reprint, true)}
            and ${reprintLink.workingOrderId} = ${link.workingOrderId}
            and ${reprintLink.stationId} = ${link.stationId}
            and ${reprintJob.printerId} = ${printJobs.printerId}
            and ${printedOrResent(reprintJob)}
            and ${reprintLink}.rowid > ${link}.rowid))`,
      )!,
    ),
    not(
      sql`exists (select 1 from ${printJobs} as ${saleCopy}
        where ${saleCopy.saleId} = ${printJobs.saleId}
        and ${saleCopy.printerId} = ${printJobs.printerId}
        and ${saleCopy.status} = 'done'
        and ${saleCopy}.rowid > ${printJobs}.rowid)`,
    ),
  )!;
}

// Unnamed, the planner took `print_jobs_printer_kind_idx` (node:26-slim, SQLite 3.54.0), reading
// each troubled job's later documents until a printed one: quadratic while none has printed.
const noLaterPrintedDocument = sql`not exists (select 1 from ${printJobs} as ${laterPrinted} indexed by print_jobs_pull_idx
  where ${laterPrinted.printerId} = ${printJobs.printerId}
  and ${laterPrinted.kind} = 'document'
  and ${laterPrinted.status} = 'done'
  and ${laterPrinted}.rowid > ${printJobs}.rowid)`;

const standInSource = alias(printJobs, "trouble_stand_in_source");
const standInLink = alias(kitchenPrintJobs, "trouble_stand_in_link");

/**
 * The job is a kitchen ticket, or a Printers-screen resend of one (which carries no links of its own)
 * on the ticket's printer: a job whose links, or its chain's first job's, a till Reprint on this
 * printer can cover. A resend sent to another printer is not one, since a Reprint covers only the
 * printer it prints on.
 */
const reprintCanStandIn = sql`exists (select 1 from ${printJobs} as ${standInSource}
  join ${kitchenPrintJobs} as ${standInLink} on ${standInLink.printJobId} = ${standInSource.id}
  where ${standInSource.id} = coalesce(${printJobs.resendOf}, ${printJobs.id})
  and ${standInSource.printerId} = ${printJobs.printerId})`;

export interface PrinterInTrouble {
  readonly id: string;
  readonly name: string;
  /** How many of its document jobs are in trouble. */
  readonly count: number;
  /** The oldest of them, as stored. */
  readonly oldest: string;
  /** The oldest of them with no later document printed on this printer, as stored; null when a
   * later document has printed after every one of them. */
  readonly stuckSince: string | null;
  /** An active kitchen station prints to it. */
  readonly kitchen: boolean;
}

const ticketId = sql<string | null>`case when ${reprintCanStandIn} then ${printJobs.id} end`;

/**
 * The troubled jobs of every active printer ({@link printJobInTrouble}), less those an Unpair
 * ended, in one pass: per printer, one row with a null `ticketId` totalling the jobs no Reprint can
 * stand in for ({@link reprintCanStandIn}), and one row for each job one can, named by `ticketId`.
 */
export function printersInTroubleQuery(tx: Transaction, now: Date) {
  return (
    tx
      .select({
        printerId: printers.id,
        printer: printers.name,
        ticketId,
        resendOf: max(printJobs.resendOf),
        n: count(),
        oldest: min(printJobs.createdAt),
        stuckSince: sql<
          string | null
        >`min(case when ${noLaterPrintedDocument} then ${printJobs.createdAt} end)`,
      })
      .from(printers)
      // As an inner join the planner scanned the whole index with `printers` inside (node:26-slim,
      // SQLite 3.54.0); a cross join keeps `printers` outside, so each printer's jobs are searched.
      .crossJoin(sql`${printJobs} indexed by print_jobs_pull_idx`)
      .where(
        and(
          eq(printJobs.printerId, printers.id),
          eq(printers.active, true),
          // Implied by `printJobInTrouble`; stated so the index search skips printed jobs.
          inArray(printJobs.status, ["queued", "printing", "failed"]),
          printJobInTrouble(now),
          // Ended on purpose by an Unpair, not a fault to fix.
          or(isNull(printJobs.lastError), ne(printJobs.lastError, PRINTER_UNPAIRED)),
        ),
      )
      .groupBy(printers.id, printers.name, ticketId)
  );
}

/** Every printer {@link printersInTroubleQuery} names, leaving out each job a Reprint can stand in
 * for that leaves nothing waiting there ({@link kitchenJobsNotWaiting}). */
export async function printersInTrouble(tx: Transaction, now: Date): Promise<PrinterInTrouble[]> {
  const groups = await printersInTroubleQuery(tx, now);
  const notWaiting = await kitchenJobsNotWaiting(
    tx,
    groups.flatMap(({ ticketId, printerId, resendOf }) =>
      ticketId === null ? [] : [{ id: ticketId, printerId, sourceId: resendOf ?? ticketId }],
    ),
  );
  const byPrinter = new Map<
    string,
    { id: string; printer: string; n: number; oldest: string; stuckSince: string | null }
  >();
  for (const group of groups) {
    if (group.ticketId !== null && notWaiting.has(group.ticketId)) continue;
    // A group only forms when a job matched, and `created_at` is notNull, so `oldest` is present.
    const oldest = group.oldest!;
    const row = byPrinter.get(group.printerId);
    if (row === undefined) {
      byPrinter.set(group.printerId, {
        id: group.printerId,
        printer: group.printer,
        n: Number(group.n),
        oldest,
        stuckSince: group.stuckSince,
      });
      continue;
    }
    row.n += Number(group.n);
    if (oldest < row.oldest) row.oldest = oldest;
    if (
      group.stuckSince !== null &&
      (row.stuckSince === null || group.stuckSince < row.stuckSince)
    ) {
      row.stuckSince = group.stuckSince;
    }
  }
  const rows = [...byPrinter.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (rows.length === 0) return [];

  const kitchen = await tx
    .select({ printerId: stationPrinterPairs.printerId })
    .from(stationPrinterPairs)
    .innerJoin(kitchenStations, eq(kitchenStations.id, stationPrinterPairs.stationId))
    .where(
      and(
        eq(kitchenStations.active, true),
        inArray(
          stationPrinterPairs.printerId,
          rows.map((r) => r.id),
        ),
      ),
    );
  const kitchenIds = new Set(kitchen.map((k) => k.printerId));
  return rows.map((r) => ({
    id: r.id,
    name: r.printer,
    count: r.n,
    oldest: r.oldest,
    stuckSince: r.stuckSince,
    kitchen: kitchenIds.has(r.id),
  }));
}
