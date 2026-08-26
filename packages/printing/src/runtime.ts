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
 *  1. PULL — atomically CLAIM a batch of this agent's due jobs (queued, under-cap failed, or a
 *     lease-expired stuck `printing` job — §5 Gap 1), stamping each `printing` with a fresh `claimed_at`.
 *     The claim is the double-print guard: a locking `for update … skip locked` SELECT hands each row to
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

/**
 * The claim LEASE (failover-printing design §5 Gap 1, §10) — a visibility timeout. `claimPrintJobs`
 * stamps `claimed_at = now()` on every claim; a job still `printing` whose `claimed_at` is older than
 * this is treated as a DROPPED claim (the agent crashed or the box died mid-service) and re-selected by
 * the pull, exactly like a fresh job. 60s: long enough not to reclaim a slow-but-LIVE push (a real
 * network/USB push is seconds), short enough that a genuine drop is caught within a service. NOTE the
 * 60s is reasoned per-push, but `claimed_at` is stamped once per CLAIM (a batch of up to
 * `PULL_BATCH_LIMIT` jobs): a large batch to a slow printer can age its unsent tail past the lease.
 * Harmless in the shipped model — a printer is pinned to one `agent_id` and the agent loop is
 * sequential, so in local mode the batch tx holds the row locks (SKIP LOCKED blocks any reclaim) and in
 * server mode no second agent serves the same printer to reclaim the tail. The un-pin follow-on
 * (failover-printing §4a, "any LAN agent serves") makes it reachable and must weigh it (a per-claim
 * token, a lease heartbeat, or a batch sized against the lease) alongside its own distinct-agents race
 * test. This is
 * deliberately AT-LEAST-ONCE (§5): a reclaim can reprint a job that physically printed but whose `done`
 * report was lost — for a kitchen ticket a duplicate is a nuisance, a drop is a missed order, so we
 * accept the rare duplicate. No per-claim token exists to tighten it (see reportPrintJob's RECLAIM
 * NUANCE), and none is added in this slice.
 */
export const PRINT_JOB_LEASE_MS = 60_000;

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
 *
 * `p.active = true` makes a DEACTIVATED printer (`deactivatePrinter`) stop being served: the pull skips
 * ALL of its jobs — a queued job, an under-cap `failed` retry, AND a lease-expired stuck `printing` row
 * (the reclaim below is suppressed too). Its jobs are not failed or dropped, just left unclaimed until
 * the printer is reactivated — the delivery half of "deactivated = disabled" (the enqueue half is the
 * `active = true` pre-check in outbox.ts). Proven load-bearing by deletion in runtime.active.test.ts.
 *
 * LEASE RECLAIM (failover-printing design §5 Gap 1, IMPLEMENTED here): the predicate re-picks `queued`
 * rows, under-cap `failed` rows, AND a row still `printing` whose claim has EXPIRED — `claimed_at` older
 * than PRINT_JOB_LEASE_MS. So a job an agent CLAIMED (`queued`→`printing`, committed by the claim
 * request) but never reported — because the agent crashed between the claim and `POST /result`, or the
 * box died holding the claim — is no longer stranded forever: once the lease elapses the pull reclaims
 * it and delivers it, on the SAME agent rebooted or on any surviving agent serving the printer. A
 * committed stuck `printing` row is UNLOCKED, so `for update … skip locked` does not skip it once the
 * lease predicate makes it eligible; the reclaim then re-stamps `claimed_at = now()` below, treating it
 * exactly like a fresh claim. AT-LEAST-ONCE by design (§5, PRINT_JOB_LEASE_MS): a reclaim may reprint a
 * job that printed but lost its `done` — a nuisance duplicate we accept over a dropped ticket. Proven by
 * deletion of the reclaim branch in runtime.reclaim.test.ts (the stuck job is not reclaimed without it).
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
      and p.active = true
      and (
        j.status = 'queued'
        or (j.status = 'failed' and j.attempts < ${MAX_DELIVERY_ATTEMPTS})
        or (j.status = 'printing'
            and j.claimed_at < now() - ${PRINT_JOB_LEASE_MS}::double precision * interval '1 millisecond')
      )
    order by j.created_at
    limit ${PULL_BATCH_LIMIT}
    for update of j skip locked
  `);
  if (picked.rows.length === 0) return [];
  const ids = picked.rows.map((r) => r.id);

  // Mark the locked rows `printing` and STAMP `claimed_at = now()` (the lease anchor — a fresh claim and
  // a lease reclaim both restart the lease), returning each with its printer's connection facts (the
  // RETURNING join) so the push step needs no second read. Keeping the status filter OUT of this
  // UPDATE's predicate — it keys only on the ids the locking SELECT returned — is what makes
  // `for update … skip locked` UNAMBIGUOUSLY load-bearing (runtime.race.test.ts). `id in ${ids}` uses
  // Drizzle's array expansion — `in ($1, $2, …)` — the shape verified in
  // packages/fiscal-verifactu/src/drain.ts (NOT `= any(…)` nor `in (${ids})`, both of which mis-expand
  // for a uuid list). `ids` is non-empty (guarded above), so the expansion never degenerates to `in ()`.
  const claimed = await tx.execute<ClaimedJob>(sql`
    update print_jobs set status = 'printing', claimed_at = now()
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
 * RECLAIM NUANCE (deliberately not over-built): a job is re-claimed into `printing` by a later batch two
 * ways — a `failed` job under the cap (`failed`→`printing`), or a lease-EXPIRED `printing` job whose
 * claimer died (the visibility timeout, `claimPrintJobs`/PRINT_JOB_LEASE_MS, §5). Either way a duplicate
 * report that arrives AFTER the re-claim finds the job `printing` again and legitimately applies to that
 * NEW claim — indistinguishable at this layer from the genuine report for it. The `status = 'printing'`
 * guard gives true idempotency for the common case (a duplicate arriving before any re-claim); the
 * post-reclaim race would need a per-claim token the outbox schema does not carry, which is out of this
 * slice — and for the lease path is exactly the accepted AT-LEAST-ONCE reprint (§5).
 */
export async function reportPrintJob(
  tx: Transaction,
  cfg: { tenantId: string },
  input: { agentId: string; jobId: string; outcome: JobOutcome },
): Promise<{ updated: boolean }> {
  const { agentId, jobId, outcome } = input;
  // Only the SET clause differs by outcome; the WHERE — the `status = 'printing'` idempotency guard, the
  // `printer_id`→agent-scope join and the tenant predicate — is IDENTICAL for both, so it is written
  // once. `done` stamps `delivered_at`; `failed` records `last_error` and bumps the bounded-retry
  // `attempts`. `${outcome.error}` binds as `$n` like every other value here, never concatenated.
  const setClause =
    outcome.status === "done"
      ? sql`status = 'done', delivered_at = now()`
      : sql`status = 'failed', last_error = ${outcome.error}, attempts = print_jobs.attempts + 1`;
  const result = await tx.execute<{ id: string }>(sql`
    update print_jobs set ${setClause}
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
  //      blocks another printer's jobs in the same batch (design §3c). The push is SERIAL, so that
  //      isolation depends on each `transport.send` being BOUNDED: a black-hole printer (accepts the
  //      TCP connection but never drains, or a dropped SYN) would otherwise hang this loop for the OS
  //      TCP timeout (~1-2 min) and stall every later job behind it — which is why `NetworkTcpTransport`
  //      arms a per-send timeout (transport.ts's `DEFAULT_TCP_TIMEOUT_MS`), turning a stalled printer
  //      into a prompt `failed` bounded by that deadline rather than an unbounded stall. Both the claim
  //      above and each report below run in the SAME transaction here (local mode); the server path
  //      splits them across two HTTP requests, calling the identical `claimPrintJobs`/`reportPrintJob`
  //      pieces.
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
