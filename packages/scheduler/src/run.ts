import { isAppError } from "@waitron/shared";
import { withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import type { TenantId } from "@waitron/shared";
import { derive, horizonStartFor, type DueWork } from "./derive.js";
import type { PeriodDuty, RunPeriod } from "./duty.js";
import {
  claimGap,
  claimRow,
  completeRun,
  enqueueSuccessor,
  readSnapshot,
  reclaimStale,
  type ClaimedRun,
} from "./store.js";

export interface SchedulerDeps {
  db: Database;
  duties: readonly PeriodDuty[];
  horizonDays: number;
  maxPeriodsPerTick: number;
  maxAttempts: number;
  backoffBaseMs: number;
  staleAfterMs: number;
}

/** One run this tick actually claimed and completed. */
export interface RunRecord {
  tenantId: TenantId;
  duty: string;
  period: RunPeriod;
  generation: number;
  outcome: "succeeded" | "failed" | "parked";
  errorCode?: string;
}

export interface TickResult {
  ran: RunRecord[];
  /** Eligible work this tick did not run, capped by `maxPeriodsPerTick`. Never silent. */
  deferred: number;
  /** Never-swept days dropped permanently by the horizon. Never silent. */
  beyondHorizon: number;
  /**
   * A (tenant, duty) abandoned part-way by an infrastructure failure — the snapshot read, or a
   * claim — rather than by a duty failing. A duty failure has a ledger row to carry it; this does
   * not, so it is reported here rather than swallowed.
   *
   * NOT "before any run could be recorded": the due-item loop runs inside the same `try`, so a
   * throw on the third of five items leaves the first two in `ran` AND this pair here. The pair is
   * what was abandoned, not necessarily the whole of its work.
   */
  skipped: { tenantId: TenantId; duty: string; errorCode: string }[];
  /**
   * `now` when work is available immediately — the per-tick cap deferred some, or a pair was
   * skipped and whatever it was abandoned part-way through is still due. Otherwise the earliest
   * FUTURE time work appears, as the ledger stands at the END of this tick: the derivation's own
   * answer, folded together with the backoff and re-sweep times this tick's own runs just wrote.
   *
   * Null only when there is no (tenant, duty) pair at all — which stays true only because a
   * skipped pair reports `now`. Mirrors `DrainResult.nextDueAt`.
   */
  nextDueAt: Date | null;
}

/**
 * One pass. No loop and no timer: the host decides cron versus long-running, and `now` is injected
 * on exactly the contract `drain(now)` / `forward(now)` / `reconcile(…, now)` already use.
 *
 * Tenants are a PARAMETER rather than an interface: enumerating them means an RLS bypass whose
 * correct form differs per deployment model, and that is the host's knowledge.
 *
 * Transaction discipline mirrors `reconcilePayments`: a short read, then the duty OUTSIDE every
 * transaction because it makes network calls, then a short write.
 */
export async function runDue(
  deps: SchedulerDeps,
  tenantIds: readonly TenantId[],
  now: Date,
): Promise<TickResult> {
  const result: TickResult = {
    ran: [],
    deferred: 0,
    beyondHorizon: 0,
    skipped: [],
    nextDueAt: null,
  };
  // The SAME expression `derive` uses for its gap window — one function, called twice, rather than
  // two copies: this decides which rows the snapshot returns, that decides which days count as
  // gaps, and a divergence would have derivation reasoning about a window it did not read.
  const horizonStart = horizonStartFor(now, deps.horizonDays);
  let earliestFuture = Number.POSITIVE_INFINITY;

  for (const tenantId of tenantIds) {
    for (const duty of deps.duties) {
      try {
        const snapshot = await withTenant(deps.db, tenantId, (tx) =>
          readSnapshot(tx, { tenantId, duty: duty.name, horizonStart }),
        );
        const derivation = derive(snapshot, now, deps);
        result.deferred += derivation.deferred;
        result.beyondHorizon += derivation.beyondHorizon;
        earliestFuture = Math.min(earliestFuture, derivation.nextDueAt.getTime());

        for (const work of derivation.due) {
          const completed = await runOne(deps, tenantId, duty, work, now);
          if (completed === null) continue;
          result.ran.push(completed.record);
          // The derivation above was computed from a snapshot taken BEFORE any duty ran, so it
          // cannot know about the backoff a failure just wrote or the re-sweep a success just
          // enqueued. Folding them in is what makes `nextDueAt` mean what it says — the earliest
          // time `runDue` would find work again — rather than the earliest time it would have
          // found work had this tick done nothing.
          if (completed.nextDueAt !== null) {
            earliestFuture = Math.min(earliestFuture, completed.nextDueAt.getTime());
          }
        }
      } catch (error) {
        result.skipped.push({ tenantId, duty: duty.name, errorCode: codeOf(error) });
      }
    }
  }

  // A skipped pair is due NOW: it was abandoned part-way, whatever it left undone was never
  // claimed, and nothing about it reached `earliestFuture`. Reporting the derivation's future
  // answer — or, when every pair threw, `null` — would tell a long-running host that nothing is
  // due, and one transient database blip would stop it polling for good.
  result.nextDueAt =
    result.deferred > 0 || result.skipped.length > 0
      ? now
      : earliestFuture === Number.POSITIVE_INFINITY
        ? null
        : new Date(earliestFuture);
  return result;
}

/**
 * What one claimed unit of work produced: the record for `TickResult.ran`, plus the time THIS run
 * made the ledger next carry work — the backoff a failure wrote, or the re-sweep a success
 * enqueued. Null there when the run left nothing further due (a success with no re-sweep, or a
 * park, both of which write a null `next_attempt_at`).
 */
interface CompletedRun {
  record: RunRecord;
  nextDueAt: Date | null;
}

/** Claim one unit of work, run it outside every transaction, and record what happened. Returns
 * null when another runner won the claim — not an error, and not this tick's business. Also null
 * when another runner reclaimed this row as stale WHILE this attempt was still running: by the
 * time this attempt's `completeRun` call runs, `startedAt` no longer matches, the fence rejects it,
 * and — same as a lost claim — the ledger carries no record attributable to THIS attempt, so
 * reporting it in `ran` would claim an outcome the ledger does not show. */
async function runOne(
  deps: SchedulerDeps,
  tenantId: TenantId,
  duty: PeriodDuty,
  work: DueWork,
  now: Date,
): Promise<CompletedRun | null> {
  const claimed = await withTenant(deps.db, tenantId, (tx) => {
    if (work.kind === "gap") {
      return claimGap(tx, { tenantId, duty: duty.name, period: work.period, now });
    }
    if (work.kind === "claimable") return claimRow(tx, { id: work.row.id, now });
    return reclaimStale(tx, { id: work.row.id, now, staleAfterMs: deps.staleAfterMs });
  });
  if (claimed === null) return null;

  const period: RunPeriod = {
    from: new Date(claimed.periodFrom),
    to: new Date(claimed.periodTo),
  };

  // OUTSIDE every transaction: a duty makes network calls.
  let summary: Record<string, unknown> | null = null;
  let errorCode: string | null = null;
  let resweepAfter: Date | undefined;
  try {
    const outcome = await duty.run(tenantId, period, now);
    summary = outcome.summary;
    resweepAfter = outcome.resweepAfter;
  } catch (error) {
    errorCode = codeOf(error);
  }

  const outcome = errorCode === null ? "succeeded" : parkOrRetry(deps, claimed);
  const nextAttemptAt = outcome === "failed" ? backoff(deps, claimed, now) : null;
  // `enqueuedAt` is non-null only when a successor row was actually INSERTED. A REFUSED enqueue
  // means some other non-terminal row already carries this period — the enqueue guard's whole
  // point — and that row's due time is not this run's to report: either the snapshot already
  // folded it in, or the concurrent tick that inserted it reports it.
  const [won, enqueuedAt] = await withTenant(
    deps.db,
    tenantId,
    async (tx): Promise<[boolean, Date | null]> => {
      const completed = await completeRun(tx, {
        id: claimed.id,
        startedAt: claimed.startedAt,
        state: outcome,
        summary,
        errorCode,
        nextAttemptAt,
        now,
      });
      // Same transaction as the completion, so the guard sees this run as already terminal. Gated
      // on the completion having actually WON its own fence: a `false` here means another runner
      // reclaimed this row as stale mid-flight and now owns it, so enqueueing would attach a
      // re-sweep to a row this attempt does not own.
      if (!completed || resweepAfter === undefined) return [completed, null];
      const inserted = await enqueueSuccessor(tx, {
        tenantId,
        duty: duty.name,
        period,
        dueAt: resweepAfter,
      });
      return [true, inserted ? resweepAfter : null];
    },
  );
  if (!won) return null;

  return {
    record: {
      tenantId,
      duty: duty.name,
      period,
      generation: claimed.generation,
      outcome,
      ...(errorCode === null ? {} : { errorCode }),
    },
    // Mutually exclusive by construction: `resweepAfter` is read only from a SUCCESSFUL outcome,
    // and `nextAttemptAt` is written only for a failed one.
    nextDueAt: enqueuedAt ?? nextAttemptAt,
  };
}

/** `attempts` was already incremented by the claim, so it is the number of attempts SPENT. */
function parkOrRetry(deps: SchedulerDeps, claimed: ClaimedRun): "failed" | "parked" {
  return claimed.attempts >= deps.maxAttempts ? "parked" : "failed";
}

function backoff(deps: SchedulerDeps, claimed: ClaimedRun, now: Date): Date {
  return new Date(now.getTime() + deps.backoffBaseMs * 2 ** (claimed.attempts - 1));
}

/** A structured code, never prose: the AppError's own code, or the literal "unknown". The same
 * convention `reconcilePayments`'s `remediate()` uses. */
function codeOf(error: unknown): string {
  return isAppError(error) ? error.code : "unknown";
}
