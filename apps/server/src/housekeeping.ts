import { setImmediate as turn } from "node:timers/promises";
import { inArray, sql } from "drizzle-orm";
import {
  invoiceDeliveries,
  printJobs,
  pruneActivityLog,
  withTransaction,
  type Database,
} from "@waitron/db";
import { MAX_DELIVERY_ATTEMPTS, PRINTER_DELETED } from "@waitron/printing";
import type { BusinessDayClock } from "@waitron/shared";
import { nextFireMs } from "./backup-schedule.js";
import { printJobInTrouble } from "./print-job-trouble.js";
import type { Logger } from "./logger.js";
import type { JobDefinition } from "./job-runner.js";

export const HOUSEKEEPING_BATCH = 500;

export async function clearOldPrintPayloads(
  db: Database,
  now: Date,
  signal: AbortSignal,
  batchSize = HOUSEKEEPING_BATCH,
): Promise<number> {
  const cutoff = new Date(now.getTime() - 7 * 86400000).toISOString();
  const end = db.all<{ last: number }>(
    sql`select coalesce(max(rowid), 0) as last from print_jobs`,
  )[0]!.last;
  let cursor = 0;
  let cleared = 0;
  while (cursor < end && !signal.aborted) {
    // Separate turns release the write lock and let waiting requests run between batches.
    const batch = await withTransaction(db, async (tx) => {
      if (signal.aborted) return { cursor: end, cleared: 0 };
      const rows = await tx.all<{ rowid: number; id: string }>(sql`
        select rowid, id from print_jobs where rowid > ${cursor} and rowid <= ${end}
        order by rowid limit ${batchSize}`);
      if (rows.length === 0) return { cursor: end, cleared: 0 };
      const changed = await tx.execute<{ id: string }>(sql`
        update print_jobs set payload = ${new Uint8Array(0)}
        where ${inArray(
          printJobs.id,
          rows.map((row) => row.id),
        )}
          and length(payload) > 0 and created_at < ${cutoff}
          and (status = 'done' or (status = 'failed' and
            (kind = 'drawer' or (kind = 'document' and
              (last_error = ${PRINTER_DELETED} or
                (attempts >= ${MAX_DELIVERY_ATTEMPTS} and not (${printJobInTrouble(now)})))))))

          and not exists (select 1 from ${invoiceDeliveries}
            where ${invoiceDeliveries.printJobId} = ${printJobs.id}
              and ${invoiceDeliveries.status} in ('queued', 'sending', 'unknown'))
        returning id`);
      return { cursor: rows.at(-1)!.rowid, cleared: changed.rows.length };
    });
    cursor = batch.cursor;
    cleared += batch.cleared;
    if (cursor < end && !signal.aborted) await turn();
  }
  return cleared;
}

export async function clearOldActivityLog(
  db: Database,
  now: Date,
  signal: AbortSignal,
  batchSize = HOUSEKEEPING_BATCH,
): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 86400000);
  let removed = 0;
  while (!signal.aborted) {
    const count = await withTransaction(db, (tx) =>
      signal.aborted ? Promise.resolve(0) : pruneActivityLog(tx, cutoff, batchSize),
    );
    removed += count;
    if (count < batchSize) break;
    await turn();
  }
  return removed;
}

export function housekeepingJob(deps: {
  db: Database;
  isPrimary(): boolean;
  clockUnconfirmed(): boolean;
  readClock(): Promise<BusinessDayClock>;
  jitterSeed: string;
  now(): Date;
  log: Logger;
  maxWaitMs: number;
}): JobDefinition {
  const schedule = { kind: "wall-clock", days: "daily", at: { hour: 4, minute: 0 } } as const;
  let due: number | undefined;
  return {
    name: "housekeeping",
    applies: deps.isPrimary,
    firstPassAfterMs: 1000,
    minSleepMs: 60000,
    maxSleepMs: deps.maxWaitMs,
    backoff: { firstMs: 60000, maxMs: 3600000 },
    async pass(ctx) {
      const clock = await deps.readClock();
      due ??= ctx.now.getTime();
      if (ctx.now.getTime() >= due) {
        await clearOldPrintPayloads(deps.db, ctx.now, ctx.signal);
        if (!deps.clockUnconfirmed()) await clearOldActivityLog(deps.db, ctx.now, ctx.signal);
        due = nextFireMs(schedule, clock, deps.now(), deps.jitterSeed);
      }
      return { nextDueAt: new Date(due) };
    },
  };
}
