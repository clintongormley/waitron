import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/pg-core";
import { count, id, json, label, table, tsString } from "@waitron/db";

/**
 * The lifecycle of one scheduled run. `pending` is work enqueued but not yet attempted (a
 * re-sweep); `failed` will be retried; `parked` has exhausted its attempts and never will be.
 * `succeeded` and `parked` are the two TERMINAL states — the successor-enqueue guard keys on
 * exactly that distinction.
 */
export const runState = ["pending", "running", "succeeded", "failed", "parked"] as const;
export type RunState = (typeof runState)[number];

/**
 * One attempt-carrying record of one duty over one period. The runner holds no queue: it derives
 * due work by asking which periods have NO row here, so this table is a record rather than a
 * schedule — there is no successor row whose loss would silently stop a duty.
 *
 * `generation` is what makes the unique key safe. A table-wide unique on
 * (duty, period_from) would break the one caller that legitimately needs N rows per
 * key: a re-sweep must run a period AGAIN without overwriting what the first sweep recorded.
 */
export const scheduledRuns = table(
  "scheduled_runs",
  {
    id: id("id").primaryKey().defaultRandom(),
    /** `PeriodDuty.name`. Changing a duty's name orphans its history — it is an identifier. */
    duty: label("duty").notNull(),
    /** The half-open `[period_from, period_to)` stored explicitly, never derived: a later
     * timezone-aware cadence must change how periods are COMPUTED, not what past rows mean. */
    periodFrom: tsString("period_from").notNull(),
    periodTo: tsString("period_to").notNull(),
    /** 0 = derived from a gap; N > 0 = the Nth re-sweep of the same period. */
    generation: count("generation").notNull().default(0),
    // A plain text column beside its own check constraint below, NOT the enumText/enumCheck pair.
    // Every COST columns.ts records for that substitution was measured here on 2026-09-18 and none
    // of them lands: the constraint already carries the ", " spacing enumCheck emits, so
    // substituting is schema-silent; the narrowing is already in force, $type<RunState>() refusing
    // a plain string today; and the union enumText derives from `runState` IS `RunState`, so there
    // is no branded type to lose. What keeps it plain is the one thing columns.ts records that is a
    // decision rather than a measurement: scope. Rewriting a constraint is not a conversion's job.
    // See enumText in packages/db/src/schema/columns.ts.
    state: label("state").$type<RunState>().notNull(),
    /** Incremented at CLAIM, not at completion — so a run stranded by a crash has already spent
     * its attempt, and a reclaim cannot loop for ever. */
    attempts: count("attempts").notNull().default(0),
    /** When this row becomes claimable. Null unless `pending` or `failed`. */
    nextAttemptAt: tsString("next_attempt_at"),
    startedAt: tsString("started_at"),
    finishedAt: tsString("finished_at"),
    /** The duty's own result, stored verbatim. Null until a run finishes. This is the durable home
     * for findings a duty cannot otherwise persist — payments reconcile's `remediationFailures`
     * names the scheduler as its owner. */
    summary: json<Record<string, unknown>>("summary"),
    /** A structured code — an AppError code, or the literal "unknown". NEVER prose. */
    errorCode: label("error_code"),
    createdAt: tsString("created_at").notNull().defaultNow(),
    updatedAt: tsString("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // The claim-by-INSERT depends on this: ON CONFLICT DO NOTHING against this key is what makes
    // "the insert IS the lock" true.
    uniqueIndex("scheduled_runs_key").on(t.duty, t.periodFrom, t.generation),
    // NO other index at all — not for gap derivation, and not for claimable pickup.
    //
    // Derivation reads by duty, which the unique key's own leading columns already
    // serve; it then filters `next_attempt_at` in JavaScript, over rows it has already fetched.
    // Every claim keys on `id`, which the primary key serves. So a partial index on
    // `next_attempt_at where state in ('pending','failed')` — which this table did carry — was
    // read by no query at all, while costing every INSERT and every claim UPDATE a second index
    // maintenance. Provisioning it "for a future cross-duty pickup query" would be speculation
    // the rest of this package refuses (see `duty.ts` on the unbuilt second duty kind), and it
    // would contradict the very reason a (duty, period_from) index is refused above.
    // Adding one when a query needs it is one line and a migration.
    check(
      "scheduled_runs_state_ck",
      sql`${t.state} in ('pending', 'running', 'succeeded', 'failed', 'parked')`,
    ),
    check("scheduled_runs_period_ck", sql`${t.periodFrom} < ${t.periodTo}`),
    check("scheduled_runs_generation_ck", sql`${t.generation} >= 0`),
    check("scheduled_runs_attempts_ck", sql`${t.attempts} >= 0`),
  ],
);
