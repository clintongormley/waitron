import { and, eq, gte, inArray, lt, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { printJobs } from "@waitron/db";
import { MAX_DELIVERY_ATTEMPTS } from "@waitron/printing";

/** A document job older than this that has not printed counts as in trouble. */
export const JOBS_WAITING_MS = 2 * 60 * 1000;

/**
 * A document job not printed after {@link JOBS_WAITING_MS}, or given up on (failed with no delivery
 * attempts left) however recent. A drawer pulse never counts. The printer's alert and a table's
 * printing problem both read this; the printer's alert also leaves out jobs a succeeded Unpair
 * ended (`printingAlertSource`, apps/server/src/alert-sources.ts).
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
  )!;
}
