import { and, count, eq, gte, inArray, isNull, lt, min, ne, not, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import {
  kitchenPrintJobs,
  kitchenStations,
  printJobs,
  printers,
  stationPrinters,
  type Transaction,
} from "@waitron/db";
import { MAX_DELIVERY_ATTEMPTS, PRINTER_UNPAIRED } from "@waitron/printing";

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
 * and a table's printing problem both read this; the printer's alert also leaves out jobs a
 * succeeded Unpair ended (`printingAlertSource`, apps/server/src/alert-sources.ts).
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

const noLaterPrintedDocument = sql`not exists (select 1 from ${printJobs} as ${laterPrinted}
  where ${laterPrinted.printerId} = ${printJobs.printerId}
  and ${laterPrinted.kind} = 'document'
  and ${laterPrinted.status} = 'done'
  and ${laterPrinted}.rowid > ${printJobs}.rowid)`;

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

/** Every active printer with a job in trouble at `now` ({@link printJobInTrouble}), leaving out jobs
 * an Unpair ended; given `locationId`, only that location's printers. */
export async function printersInTrouble(
  tx: Transaction,
  now: Date,
  options: { locationId?: string } = {},
): Promise<PrinterInTrouble[]> {
  const rows = await tx
    .select({
      id: printers.id,
      printer: printers.name,
      n: count(),
      oldest: min(printJobs.createdAt),
      stuckSince: sql<
        string | null
      >`min(case when ${noLaterPrintedDocument} then ${printJobs.createdAt} end)`,
    })
    .from(printers)
    .innerJoin(printJobs, eq(printJobs.printerId, printers.id))
    .where(
      and(
        eq(printers.active, true),
        printJobInTrouble(now),
        // Ended on purpose by an Unpair, not a fault to fix.
        or(isNull(printJobs.lastError), ne(printJobs.lastError, PRINTER_UNPAIRED)),
        options.locationId === undefined ? undefined : eq(printers.locationId, options.locationId),
      ),
    )
    .groupBy(printers.id, printers.name);
  if (rows.length === 0) return [];

  const kitchen = await tx
    .select({ printerId: stationPrinters.printerId })
    .from(stationPrinters)
    .innerJoin(kitchenStations, eq(kitchenStations.id, stationPrinters.stationId))
    .where(
      and(
        eq(kitchenStations.active, true),
        inArray(
          stationPrinters.printerId,
          rows.map((r) => r.id),
        ),
      ),
    );
  const kitchenIds = new Set(kitchen.map((k) => k.printerId));
  return rows.map((r) => ({
    id: r.id,
    name: r.printer,
    count: Number(r.n),
    // A group only forms when a job matched, and `created_at` is notNull, so `oldest` is present.
    oldest: r.oldest!,
    stuckSince: r.stuckSince,
    kitchen: kitchenIds.has(r.id),
  }));
}
