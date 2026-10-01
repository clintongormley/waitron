import { and, eq, gte, inArray, lt, not, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import { kitchenPrintJobs, printJobs } from "@waitron/db";
import { MAX_DELIVERY_ATTEMPTS } from "@waitron/printing";

/** A document job older than this that has not printed counts as in trouble. */
export const JOBS_WAITING_MS = 2 * 60 * 1000;

const copy = alias(printJobs, "resend_copy");
const link = alias(kitchenPrintJobs, "trouble_link");
const reprintLink = alias(kitchenPrintJobs, "trouble_reprint_link");
const reprintJob = alias(printJobs, "trouble_reprint_job");
const saleCopy = alias(printJobs, "trouble_sale_copy");
const printedResend = alias(printJobs, "trouble_printed_resend");

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
