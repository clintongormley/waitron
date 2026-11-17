import { setImmediate as turn } from "node:timers/promises";
import { inArray, sql } from "drizzle-orm";
import {
  invoiceDeliveries,
  printJobs,
  pruneActivityLog,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { IDLE_TIMEOUT_MS } from "@waitron/identity";
import { MAX_DELIVERY_ATTEMPTS, PRINTER_DELETED } from "@waitron/printing";
import { codeOf } from "@waitron/server-kit";
import type { BusinessDayClock } from "@waitron/shared";
import { nextFireMs } from "./backup-schedule.js";
import { printJobInTrouble } from "./print-job-trouble.js";
import type { Logger } from "./logger.js";
import type { JobDefinition } from "./job-runner.js";

export const HOUSEKEEPING_BATCH = 500;
export const HOUSEKEEPING_SERVICE_COMMANDS = false;

export interface HousekeepingStep {
  readonly name: "sign_in_challenges" | "dashboard_sessions" | "media_blobs" | "service_commands";
  readonly enabled: boolean;
  deleteBatch(tx: Transaction, now: Date, limit: number): Promise<number>;
}

export const HOUSEKEEPING_STEPS: readonly HousekeepingStep[] = [
  {
    name: "sign_in_challenges",
    enabled: true,
    async deleteBatch(tx, now, limit) {
      const latest = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
      const result = await tx.execute(sql`delete from sign_in_challenges where id in (
        select id from sign_in_challenges
        where expires_at <= ${now.toISOString()} or expires_at > ${latest} limit ${limit}
      ) returning id`);
      return result.rows.length;
    },
  },
  {
    name: "dashboard_sessions",
    enabled: true,
    async deleteBatch(tx, now, limit) {
      const earliest = new Date(now.getTime() - IDLE_TIMEOUT_MS).toISOString();
      const latest = new Date(now.getTime() + IDLE_TIMEOUT_MS).toISOString();
      const result = await tx.execute(sql`delete from dashboard_sessions where id in (
        select id from dashboard_sessions where ended_at is not null
          or last_seen_at < ${earliest} or last_seen_at > ${latest} limit ${limit}
      ) returning id`);
      return result.rows.length;
    },
  },
  {
    name: "media_blobs",
    enabled: true,
    async deleteBatch(tx, _now, limit) {
      const result = await tx.execute(sql`delete from media_blobs where hash in (
        select b.hash from media_blobs b
        where not exists (select 1 from media_images where original_hash = b.hash)
          and not exists (select 1 from media_images where source_hash = b.hash) limit ${limit}
      ) returning hash`);
      return result.rows.length;
    },
  },
  {
    name: "service_commands",
    enabled: HOUSEKEEPING_SERVICE_COMMANDS,
    async deleteBatch(tx, now, limit) {
      const cutoff = new Date(now.getTime() - 86400000).toISOString();
      const result = await tx.execute(sql`delete from service_commands where id in (
        select c.id from service_commands c where
          (c.scope_kind = 'party' and exists (select 1 from parties p
            where p.id = c.scope_id and p.closed_at < ${cutoff}))
          or (c.scope_kind = 'bill' and exists (select 1 from working_orders b
            where b.id = c.scope_id and b.settled_at < ${cutoff})) limit ${limit}
      ) returning id`);
      return result.rows.length;
    },
  },
];

async function clearStep(db: Database, step: HousekeepingStep, now: Date, signal: AbortSignal) {
  // Each batch releases the write turn so a sale can commit before the next one starts.
  while (!signal.aborted) {
    const count = await withTransaction(db, (tx) =>
      signal.aborted ? Promise.resolve(0) : step.deleteBatch(tx, now, HOUSEKEEPING_BATCH),
    );
    if (count < HOUSEKEEPING_BATCH) break;
    await turn();
  }
}

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
  steps?: readonly HousekeepingStep[];
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
        const runs = [
          { name: "print_jobs", run: () => clearOldPrintPayloads(deps.db, ctx.now, ctx.signal) },
          {
            name: "activity_log",
            run: async () => {
              if (!deps.clockUnconfirmed()) await clearOldActivityLog(deps.db, ctx.now, ctx.signal);
            },
          },
          ...(deps.steps ?? HOUSEKEEPING_STEPS)
            .filter((step) => step.enabled)
            .map((step) => ({
              name: step.name,
              run: () => clearStep(deps.db, step, ctx.now, ctx.signal),
            })),
        ];
        const failures: unknown[] = [];
        for (const step of runs) {
          if (ctx.signal.aborted) break;
          try {
            await step.run();
          } catch (error) {
            deps.log("error", "housekeeping.step_failed", {
              step: step.name,
              errorCode: codeOf(error),
            });
            failures.push(error);
          }
        }
        if (failures.length > 0) throw failures[0];
        due = nextFireMs(schedule, clock, deps.now(), deps.jitterSeed);
      }
      return { nextDueAt: new Date(due) };
    },
  };
}
