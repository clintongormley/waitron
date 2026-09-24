import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, id, json, label, newId, nowIso, table, tsString } from "@waitron/db";

/**
 * The lifecycle of one scheduled run. `pending` is work enqueued but not yet attempted (a
 * re-sweep); `failed` will be retried; `parked` has exhausted its attempts and never will be.
 * `succeeded` and `parked` are the two TERMINAL states (`TERMINAL` in `derive.ts`).
 */
export const runState = ["pending", "running", "succeeded", "failed", "parked"] as const;
export type RunState = (typeof runState)[number];

/**
 * One attempt-carrying record of one duty over one period. The runner holds no queue: it derives
 * due work by asking which periods have NO row here.
 *
 * `generation` is in the unique key because a re-sweep must run a period AGAIN without
 * overwriting what the first sweep recorded.
 */
export const scheduledRuns = table(
  "scheduled_runs",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    /** `PeriodDuty.name`. */
    duty: label("duty").notNull(),
    /** The half-open `[period_from, period_to)` stored explicitly, never derived: a later
     * timezone-aware cadence must change how periods are COMPUTED, not what past rows mean. */
    periodFrom: tsString("period_from").notNull(),
    periodTo: tsString("period_to").notNull(),
    /** 0 = derived from a gap; N > 0 = the Nth re-sweep of the same period. */
    generation: count("generation").notNull().default(0),
    state: label("state").$type<RunState>().notNull(),
    /** Incremented at CLAIM, not at completion — so a run stranded by a crash has already spent
     * its attempt, and a reclaim cannot loop for ever. */
    attempts: count("attempts").notNull().default(0),
    /** When this row becomes claimable. Null unless `pending` or `failed`. */
    nextAttemptAt: tsString("next_attempt_at"),
    startedAt: tsString("started_at"),
    finishedAt: tsString("finished_at"),
    /** The duty's own result, stored verbatim. */
    summary: json<Record<string, unknown>>("summary"),
    /** A structured code — an AppError code, or the literal "unknown". NEVER prose. */
    errorCode: label("error_code"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // The claim-by-INSERT depends on this: ON CONFLICT DO NOTHING against this key is what makes
    // "the insert IS the lock" true.
    uniqueIndex("scheduled_runs_key").on(t.duty, t.periodFrom, t.generation),
    check(
      "scheduled_runs_state_ck",
      sql`${t.state} in ('pending', 'running', 'succeeded', 'failed', 'parked')`,
    ),
    check("scheduled_runs_period_ck", sql`${t.periodFrom} < ${t.periodTo}`),
    check("scheduled_runs_generation_ck", sql`${t.generation} >= 0`),
    check("scheduled_runs_attempts_ck", sql`${t.attempts} >= 0`),
  ],
);
