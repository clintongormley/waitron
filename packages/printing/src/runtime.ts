import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { PrintTransport } from "./printers.js";
import type { PrinterTarget, Transport } from "./transport.js";

/**
 * The agent runtime (design §3c) — ONE pull → push → report batch. A deployable agent loop calls this
 * repeatedly; the inter-batch interval is that loop's concern (it is where the time BACKOFF between
 * retries lives), so this function stays a single, testable batch with no timers of its own.
 *
 * The three steps:
 *  1. PULL — atomically CLAIM a batch of this agent's due jobs, flipping them `queued`→`printing`. The
 *     claim is the double-print guard: a locking `for update … skip locked` SELECT hands each row to
 *     exactly one agent instance, so two agents (the two-boxes / reimaged-agent topology) never
 *     deliver the same job twice. Proven load-bearing by deletion in runtime.race.test.ts.
 *  2. PUSH — hand each claimed job's bytes to its printer via the injected transport.
 *  3. REPORT — mark each job `done`, or on a push failure `failed` with `attempts++` and the error.
 *
 * Single-writer-per-row (design §4): the enqueuer owns row CREATION, this path owns the
 * `printing`→`done`/`failed` TRANSITION. No cross-node sync, no second writer.
 */

/** Jobs claimed per batch. A bound, not a tuning knob — the loop calls again while work remains. */
export const PULL_BATCH_LIMIT = 50;

/**
 * How many delivery attempts a job gets before it stops being retried (design §3c "bounded"). A
 * `failed` job under this cap is re-claimed by a later batch; at the cap it stays `failed` and is no
 * longer pulled. This is an ATTEMPT bound, not a time-scheduled backoff: `print_jobs` carries no
 * next-attempt timestamp, so time spacing between retries is the agent loop's batch interval. A
 * time-scheduled per-job backoff would need a new column and is deliberately out of this slice.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

export interface AgentRuntimeDeps {
  /** A tenant-scoped transaction (the Task-6 route wraps this in `withTenant` + `asAppUser`). */
  tx: Transaction;
  /** The tenant the agent belongs to — the pull's explicit scope beside RLS. */
  cfg: { tenantId: string };
  /** The calling agent. The pull claims ONLY jobs on printers this agent serves (authorization
   * scope): a cross-agent pull matches no printer and claims nothing. */
  agentId: string;
  /** Where claimed bytes go — a real `RoutingTransport` in production, a `FakeSink` in tests. */
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

/** One claimed job plus its printer's connection facts, read via the RETURNING join. A `type` (not an
 * `interface`) so it satisfies `tx.execute`'s `Record<string, unknown>` row constraint — an interface
 * is open and TS will not give it an implicit index signature (the drain.ts `DueRow` precedent). */
export type ClaimedJob = {
  id: string;
  printer_id: string;
  payload: Buffer;
  transport: PrintTransport;
  host: string | null;
  port: number | null;
  usb_path: string | null;
};

/** The outcome an agent reports for one job (design §3c step 3). `done` → delivered; `failed` carries
 * the transport's error message, which the report records into `last_error` and bumps `attempts`. */
export type JobOutcome = { status: "done" } | { status: "failed"; error: string };

/**
 * PULL (design §3c step 1) — atomically CLAIM a batch of this agent's due jobs, flipping them
 * `queued`/`failed`→`printing`, and RETURN each with its printer's connection facts. Extracted from
 * `runAgentOnce` (Controller Ruling 6) so the SERVER path can claim-and-COMMIT within one HTTP request
 * (the route's `withTenant` transaction is the commit boundary) and then return the claimed jobs to a
 * remote agent, holding NO lock or transaction across that agent's socket write. `runAgentOnce` (local
 * mode) still calls this, then pushes+reports in the SAME transaction.
 *
 * Two statements in one transaction, deliberately: the locking SELECT is the claim, and keeping the
 * status filter OUT of the follow-up UPDATE's predicate is what makes `for update … skip locked`
 * UNAMBIGUOUSLY load-bearing. Delete the lock and two agents' SELECTs both return the same row, and
 * both UPDATEs (keyed only on `id`) then re-mark it — a double claim (runtime.race.test.ts proves
 * exactly this by deletion). All values bind as `$n` (Drizzle-parameterised), never concatenated; the
 * join to `printers` on `(tenant_id, id)` is the authorization scope — only THIS agent's printers'
 * jobs (a cross-agent pull claims nothing). A `failed` job under the attempt cap is re-claimed here
 * (the retry); at the cap it is filtered out (the bound). `for update of j` locks only the
 * `print_jobs` rows, not `printers`.
 */
export async function claimPrintJobs(
  tx: Transaction,
  cfg: { tenantId: string },
  agentId: string,
): Promise<ClaimedJob[]> {
  const picked = await tx.execute<{ id: string }>(sql`
    select j.id from print_jobs j
    join printers p on p.tenant_id = j.tenant_id and p.id = j.printer_id
    where j.tenant_id = ${cfg.tenantId}
      and p.agent_id = ${agentId}
      and (j.status = 'queued' or (j.status = 'failed' and j.attempts < ${MAX_DELIVERY_ATTEMPTS}))
    order by j.created_at
    limit ${PULL_BATCH_LIMIT}
    for update of j skip locked
  `);
  if (picked.rows.length === 0) return [];
  const ids = picked.rows.map((r) => r.id);

  // Mark the locked rows `printing` and return each with its printer's connection facts (the RETURNING
  // join), so the push step needs no second read. `id in ${ids}` uses Drizzle's array expansion —
  // `in ($1, $2, …)` — the shape verified in packages/fiscal-verifactu/src/drain.ts (NOT `= any(…)`
  // nor `in (${ids})`, both of which mis-expand for a uuid list). `ids` is non-empty (guarded above),
  // so the expansion never degenerates to `in ()`.
  const claimed = await tx.execute<ClaimedJob>(sql`
    update print_jobs set status = 'printing'
    from printers p
    where print_jobs.tenant_id = p.tenant_id
      and print_jobs.printer_id = p.id
      and print_jobs.id in ${ids}
    returning print_jobs.id, print_jobs.printer_id, print_jobs.payload,
              p.transport, p.host, p.port, p.usb_path
  `);
  return claimed.rows;
}

/**
 * REPORT (design §3c step 3) — record one job's delivery outcome, AGENT-SCOPED and IDEMPOTENT.
 * Extracted from `runAgentOnce` (Controller Ruling 6) so the SERVER path can report in a SEPARATE
 * request from the claim (the remote agent pushes the bytes, then POSTs the result). Two predicates
 * guard every report:
 *  - `from printers p … and p.agent_id = ${agentId}` is the AUTHORIZATION scope: an agent can only
 *    report on jobs served by its OWN printers, so a cross-agent report mutates nothing
 *    (`{ updated: false }`) — proven by deletion of that predicate.
 *  - `and print_jobs.status = 'printing'` is the IDEMPOTENCY guard: a report only applies to a
 *    currently-CLAIMED job. Without it a duplicated report (a retried HTTP request) on the `failed`
 *    path would bump `attempts` a second time, burning the 5-attempt cap faster than deliveries
 *    warrant; with it, a second report on an already-terminal (`done`/`failed`) job is a no-op. It
 *    holds for `runAgentOnce` too, which reports the job it just claimed to `printing` in the same tx.
 *
 * `done` sets `delivered_at`; `failed` records `last_error` and bumps `attempts` (the bounded-retry
 * counter). All values bind as `$n`, never concatenated.
 *
 * Returns whether a row matched. The server route treats a no-match as an idempotent no-op (a job that
 * is not this agent's, already terminal, or unknown) rather than an oracle, so it never discloses which
 * job ids exist.
 *
 * RECLAIM NUANCE (deliberately not over-built): a `failed` job under the cap is re-claimed
 * (`failed`→`printing`) by a later batch, so a duplicate report that arrives AFTER a re-claim finds the
 * job `printing` again and legitimately bumps `attempts` — indistinguishable at this layer from the
 * genuine report for that new claim. The `status = 'printing'` guard gives true idempotency for the
 * common case (a duplicate arriving before any re-claim); the post-reclaim race would need a per-claim
 * token the outbox schema does not carry, which is out of this slice.
 */
export async function reportPrintJob(
  tx: Transaction,
  cfg: { tenantId: string },
  input: { agentId: string; jobId: string; outcome: JobOutcome },
): Promise<{ updated: boolean }> {
  const { agentId, jobId, outcome } = input;
  const result =
    outcome.status === "done"
      ? await tx.execute<{ id: string }>(sql`
          update print_jobs set status = 'done', delivered_at = now()
          from printers p
          where print_jobs.tenant_id = p.tenant_id
            and print_jobs.printer_id = p.id
            and print_jobs.tenant_id = ${cfg.tenantId}
            and print_jobs.id = ${jobId}
            and print_jobs.status = 'printing'
            and p.agent_id = ${agentId}
          returning print_jobs.id`)
      : await tx.execute<{ id: string }>(sql`
          update print_jobs
             set status = 'failed', last_error = ${outcome.error}, attempts = print_jobs.attempts + 1
          from printers p
          where print_jobs.tenant_id = p.tenant_id
            and print_jobs.printer_id = p.id
            and print_jobs.tenant_id = ${cfg.tenantId}
            and print_jobs.id = ${jobId}
            and print_jobs.status = 'printing'
            and p.agent_id = ${agentId}
          returning print_jobs.id`);
  return { updated: result.rows.length > 0 };
}

export async function runAgentOnce(deps: AgentRuntimeDeps): Promise<AgentRunResult> {
  const { tx, cfg, agentId, transport } = deps;

  // 1. PULL — claim a batch of this agent's due jobs (the locking `claimPrintJobs`, flipping them to
  //    `printing`), returning each with its printer's connection facts so the push needs no second read.
  const claimed = await claimPrintJobs(tx, cfg, agentId);

  // 2/3. PUSH each job, then REPORT its outcome. Per-job try/catch ISOLATES a down/erroring printer:
  //      its failure marks only that job `failed` and the loop moves on, so one dead printer never
  //      blocks another printer's jobs in the same batch (design §3c). Both the claim above and each
  //      report below run in the SAME transaction here (local mode); the server path splits them across
  //      two HTTP requests, calling the identical `claimPrintJobs`/`reportPrintJob` pieces.
  let delivered = 0;
  let failed = 0;
  for (const job of claimed) {
    const target: PrinterTarget = {
      id: job.printer_id,
      transport: job.transport,
      host: job.host,
      port: job.port,
      usbPath: job.usb_path,
    };
    try {
      // The DB hands `payload` back as a Buffer; copy it into a plain Uint8Array so the transport
      // interface deals in Uint8Array and the fake sink's capture compares byte-for-byte against an
      // `esc().bytes()` (also a Uint8Array), free of any Buffer-vs-Uint8Array identity mismatch.
      await transport.send(target, new Uint8Array(job.payload));
      await reportPrintJob(tx, cfg, { agentId, jobId: job.id, outcome: { status: "done" } });
      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await reportPrintJob(tx, cfg, {
        agentId,
        jobId: job.id,
        outcome: { status: "failed", error: message },
      });
      failed += 1;
    }
  }
  return { claimed: claimed.length, delivered, failed };
}
