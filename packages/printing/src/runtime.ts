import { sql } from "drizzle-orm";
import { claimRows, nowIso, type Transaction } from "@waitron/db";
import type { PrintTransport, PrinterTarget, Transport } from "@waitron/print-agent";

/**
 * The agent runtime: one pull → push → report batch. The calling loop owns the interval between
 * batches, which is also the only spacing between retries.
 *
 * Single writer per row: the enqueuer owns a job's creation, this path its
 * `printing`→`done`/`failed` transition.
 */

/** Jobs claimed per batch. A bound, not a tuning knob — the loop calls again while work remains. */
export const PULL_BATCH_LIMIT = 50;

/**
 * Delivery attempts before a `failed` job stops being re-claimed. An attempt bound, not a time
 * backoff: `print_jobs` carries no next-attempt timestamp.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

/**
 * The claim lease: a job still `printing` whose `claimed_at` is older than this is a dropped claim
 * (the agent crashed or the box died) and the pull re-claims it. Long enough not to reclaim a live
 * push, which takes seconds.
 *
 * `claimed_at` is stamped once per BATCH, so a large batch to a slow printer can age its unsent
 * tail past the lease. Another agent in the venue can then re-claim a network printer's unsent jobs
 * and print them while the first still sends every job it pulled, so those jobs print twice.
 * Delivery is deliberately at-least-once: a reclaim can also reprint a job that printed but whose
 * `done` report was lost. A double print is accepted over a dropped kitchen ticket.
 */
export const PRINT_JOB_LEASE_MS = 60_000;

export interface AgentRuntimeDeps {
  tx: Transaction;
  /** Not an eligibility filter: it is stamped into `claimed_by`, and only the claimer may report. */
  agentId: string;
  /** A `network_tcp` printer is claimable by any agent reporting its venue. */
  locationId: string;
  /** The device keys (USB serials, Bluetooth MACs) the agent currently sees. A usb/bluetooth printer
   * is eligible only when its `local_key` is one of these. */
  visibleKeys: string[];
  transport: Transport;
}

export interface AgentRunResult {
  /** Jobs claimed this batch. */
  claimed: number;
  /** Of those, delivered (marked `done`). */
  delivered: number;
  /** Of those, failed (marked `failed`, attempts bumped). */
  failed: number;
}

/** A `type`, not an `interface`, so it satisfies `claimRows`'s `Record<string, unknown>` constraint. */
export type ClaimedJob = {
  id: string;
  printer_id: string;
  payload: Buffer;
  transport: PrintTransport;
  host: string | null;
  port: number | null;
  local_key: string | null;
};

export type JobOutcome = { status: "done" } | { status: "failed"; error: string };

/**
 * Claims a batch of this agent's due jobs and returns each with its printer's connection facts.
 * Separate from `runAgentOnce` so the server can commit the claim in one request and hand the jobs to
 * a remote agent without holding a transaction across that agent's socket write.
 *
 * A job is due when `queued`, `failed` under the attempt cap, or `printing` with no live claim. That
 * last case covers `claimed_at IS NULL` too: every claim stamps it, so a `printing` row without one
 * is stuck, and `<` alone would never select it. A deactivated printer's jobs, stuck ones included,
 * are left unclaimed until it is reactivated.
 *
 * SQLite has no boolean type but reads `true` as 1, which is what the `active` column stores.
 */
export async function claimPrintJobs(
  tx: Transaction,
  agentId: string,
  ctx: { locationId: string; visibleKeys: string[] },
): Promise<ClaimedJob[]> {
  // `claimed_at` is text, so `<` is a string comparison, a correct time order only for the
  // `toISOString()` spelling `nowIso` writes; the cutoff is computed here to keep one spelling. Stamp
  // and cutoff read the clock of the one process that holds the venue file.
  const claimedAt = nowIso();
  const leaseCutoff = new Date(Date.parse(claimedAt) - PRINT_JOB_LEASE_MS).toISOString();
  const usbBt =
    ctx.visibleKeys.length > 0
      ? sql`(p.transport in ('usb','bluetooth') and p.local_key in ${ctx.visibleKeys})`
      : sql`false`;
  return claimRows<ClaimedJob>(tx, {
    table: "print_jobs",
    key: "id",
    claimableJoin: sql`join printers p on p.id = j.printer_id`,
    claimable: sql`p.active = true
      and ( (p.transport = 'network_tcp' and p.location_id = ${ctx.locationId}) or ${usbBt} )
      and (
        j.status = 'queued'
        or (j.status = 'failed' and j.attempts < ${MAX_DELIVERY_ATTEMPTS})
        or (j.status = 'printing'
            and (j.claimed_at is null or j.claimed_at < ${leaseCutoff}))
      )`,
    order: sql`j.created_at`,
    limit: PULL_BATCH_LIMIT,
    set: sql`status = 'printing', claimed_at = ${claimedAt}, claimed_by = ${agentId}`,
    // Correlated subqueries: SQLite refuses a RETURNING column from a table an `UPDATE … FROM` joins.
    returning: sql`print_jobs.id, print_jobs.printer_id, print_jobs.payload,
      (select transport from printers where printers.id = print_jobs.printer_id) as transport,
      (select host from printers where printers.id = print_jobs.printer_id) as host,
      (select port from printers where printers.id = print_jobs.printer_id) as port,
      (select local_key from printers where printers.id = print_jobs.printer_id) as local_key`,
  });
}

/**
 * Records one job's outcome. Only the agent that claimed the job may report it, and only while it is
 * `printing`, so a retried report on a finished job is a no-op rather than a second `attempts` bump.
 * An unknown job, another agent's and a finished one all return the same `{ updated: false }`.
 *
 * A duplicate report that arrives after the SAME agent re-claimed the job applies to the new claim:
 * telling the two apart would need a per-claim token the schema does not carry.
 */
export async function reportPrintJob(
  tx: Transaction,
  input: { agentId: string; jobId: string; outcome: JobOutcome },
): Promise<{ updated: boolean }> {
  const { agentId, jobId, outcome } = input;
  const setClause =
    outcome.status === "done"
      ? sql`status = 'done', delivered_at = ${nowIso()}`
      : sql`status = 'failed', last_error = ${outcome.error}, attempts = print_jobs.attempts + 1`;
  const result = await tx.execute<{ id: string }>(sql`
    update print_jobs set ${setClause}
    where print_jobs.id = ${jobId}
      and print_jobs.status = 'printing'
      and print_jobs.claimed_by = ${agentId}
    returning print_jobs.id`);
  return { updated: result.rows.length > 0 };
}

export async function runAgentOnce(deps: AgentRuntimeDeps): Promise<AgentRunResult> {
  const { tx, agentId, locationId, visibleKeys, transport } = deps;

  const claimed = await claimPrintJobs(tx, agentId, { locationId, visibleKeys });

  // The push is serial, so one dead printer blocks the rest of the batch unless each
  // `transport.send` is bounded — `NetworkTcpTransport` arms a per-send timeout for that.
  let delivered = 0;
  let failed = 0;
  for (const job of claimed) {
    const target: PrinterTarget = {
      id: job.printer_id,
      transport: job.transport,
      host: job.host,
      port: job.port,
      devicePath: job.local_key,
    };
    // Gap, deliberately left: if the database refuses the `done` report inside this `try`, the
    // catch records `failed` for a job whose bytes were sent, so a later batch can print it again.
    // No production caller reaches it today (`apps/server/src/print-api.ts` calls the split
    // functions), but it is exported from `index.ts`.
    try {
      // `ClaimedJob.payload` is typed `Buffer`, but this raw read delivers a plain `Uint8Array`
      // (measured 2026-09-22).
      await transport.send(target, new Uint8Array(job.payload));
      await reportPrintJob(tx, { agentId, jobId: job.id, outcome: { status: "done" } });
      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await reportPrintJob(tx, {
        agentId,
        jobId: job.id,
        outcome: { status: "failed", error: message },
      });
      failed += 1;
    }
  }
  return { claimed: claimed.length, delivered, failed };
}
