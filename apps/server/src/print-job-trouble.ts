import { and, eq, gte, inArray, lt, not, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import { printJobs } from "@waitron/db";
import { MAX_DELIVERY_ATTEMPTS } from "@waitron/printing";

/** A document job older than this that has not printed counts as in trouble. */
export const JOBS_WAITING_MS = 2 * 60 * 1000;

const copy = alias(printJobs, "resend_copy");

/**
 * A document job not printed after {@link JOBS_WAITING_MS}, or given up on (failed with no delivery
 * attempts left) however recent, until a resend of the same job queued after it has printed. A
 * drawer pulse never counts. The printer's alert and a table's printing problem both read this; the
 * printer's alert also leaves out jobs a succeeded Unpair ended (`printingAlertSource`,
 * apps/server/src/alert-sources.ts).
 * "After" is `rowid`, as in `readPrintProblems` (apps/server/src/kitchen-print.ts), since two jobs
 * can share a `created_at` to the millisecond.
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
  )!;
}
