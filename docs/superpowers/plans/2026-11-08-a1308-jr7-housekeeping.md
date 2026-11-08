# A1308 jr7 — the daily tidy-up job, `housekeeping` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner lands:** no (rules §6). It deletes expired sign-in ceremonies, idle dashboard sign-ins and
unused photo bytes; nothing fiscal.

**Goal:** One daily job (R16) that deletes, in short batches on the primary, what the table reviews
said should be pruned: expired sign-in challenges, dashboard sessions idle past the timeout, and
photo bytes no photo names. Its fourth step, deleting old till command records, is built but stays
**off** until the latest possible till retry is confirmed (tables-ordersales.md §8 M10).

**Architecture:** `apps/server/src/housekeeping.ts` holds the steps and the job. Each step deletes at
most `HOUSEKEEPING_BATCH` rows per transaction and loops until a batch comes back short, checking the
job's signal between batches; writes stay on the main thread (jobs.md R16). The job runs once a day
at 04:00 in the venue's time zone, using the backup schedule's own `nextFireMs`
(`apps/server/src/backup-schedule.ts:78`) for a daily wall-clock time.

**Spec:** [jobs.md §2 R16 and "R16 `housekeeping`: what the daily tidy-up deletes"; §4 "Performance"; §5 measure 10; §6 "To confirm before `housekeeping`'s service-command step is switched on"](../specs/2026-11-02-rationalisation/jobs.md);
README U10; tables-people.md (`dashboard_sessions`, `sign_in_challenges`); tables-menu.md §1.23
(`media_blobs`); tables-ordersales.md §1.8 and §8 M10 (`service_commands`). The people plans defer
the tidy-up to this job: [pp2](2026-11-08-a1308-pp2-sign-in-challenges.md) ("The daily tidy-up job
that deletes expired rows nobody inserts after") and
[pp3](2026-11-08-a1308-pp3-dashboard-sessions-and-account-actions.md) ("Deleting idle dashboard
sessions nobody signs out"). Slice rules apply.

## What it builds

| Step | Deletes | Rule |
| --- | --- | --- |
| `sign_in_challenges` | rows with `expires_at <= now` or `expires_at > now + 10 minutes` | pp2's insert-time sweep predicate (a clock stepped back makes the second half); reuse pp2's helper if it exports one |
| `dashboard_sessions` | rows that ended (`ended_at` set) or whose `last_seen_at` is more than `IDLE_TIMEOUT_MS` (`packages/identity/src/management-session.ts:11`, 30 minutes) away from now **in either direction** — the sign-in check itself treats a session stamped further ahead than that as expired (`Math.abs`, `:79`) — **except** `MIRROR_VIEWER_SESSION_ID` (`apps/server/src/mirror-session.ts:20`), whatever its state | jobs.md R16 ("rows that ended, or idle past `IDLE_TIMEOUT_MS`"); tables-people.md: the viewer's keepalive only updates its row, so a deleted row is not recreated until the next start. After pp3 a sign-out deletes the row, so ended rows are only left by paths pp3 did not convert |
| `media_blobs` | rows no photo's `original_hash` or `source_hash` names | tables-menu.md §1.23: the photo write deletes its own unused blob; this is the safety net, and the RESTRICT keys make deleting a blob in use impossible |
| `service_commands` (**off**) | rows whose party or bill closed more than a day ago | tables-ordersales.md §1.8; `HOUSEKEEPING_SERVICE_COMMANDS = false` until M10 is confirmed |

Not pruned, by design: ended `till_sessions`, `staff_activity`, print job payloads, and
`outgoing_mail` (A980 decides their periods, jobs.md R16 table's last paragraph).

## Files

- Create: `apps/server/src/housekeeping.ts`, `apps/server/src/housekeeping.test.ts`
- Modify: `apps/server/src/boot.ts` (one `jobRunner.add` beside the other primary jobs), `boot.promote.test.ts`

## Size

| Hand-written | Lines |
| --- | --- |
| Code: `housekeeping.ts` 150, `boot.ts` 15 | **~165** |
| Tests: `housekeeping.test.ts` 250, promotion 10 | **~260** |
| Total | **~425** |

## Finish line

1. `pnpm --filter @waitron/server exec vitest run src/housekeeping.test.ts src/boot.promote.test.ts src/mirror-session.test.ts` — passes, `Tests` count printed.
2. Measure 10's two runs recorded in the PR description (Task 1).
3. Typecheck, format clean; protection list EQUAL.

## Expected protection-list difference

**EQUAL.** It deletes rows; no schema changes. Any line is a stop.

## Stop points (beyond rules §5)

1. Measure 10 fails (Task 1). 2. A step would need an index that does not exist (that is a schema
change, owned by the area's slice): stop and ask.

## Needs

jr1–jr3; pp2, pp3 (the people slice's `sign_in_challenges` and `dashboard_sessions`); the menu slice's
`media_blobs`.

## Global Constraints

- Short batches, one transaction each, so a sale never waits long for the write lock (jobs.md R16).
- Primary only; stops at a stepdown's signal (catalogue).
- The service-command step never runs while its switch is off; switching it on is one constant and
  waits for M10's answer (jobs.md §6).
- A step's failure is logged (`housekeeping.step_failed`, `{ step, errorCode }`) and the next step
  still runs; if any step failed, the pass throws afterwards so a lasting failure raises `job.failing`.

## Review Focus

1. **The mirror viewer's session row on a read mirror.** Never deleted, however long idle. Task 2.
2. **A photo replaced mid-run.** The RESTRICT keys refuse deleting a blob a new photo names between
   the select and the delete; the delete selects and deletes in one statement. Task 2's
   "a blob a photo names is never deleted".
3. **A clock stepped back.** A challenge stamped in the future past the 10-minute window goes; a
   session stamped more than 30 minutes in the future goes too, because the sign-in check already
   answers `management_session.expired` for it (`management-session.ts:78-81`); one stamped less
   than 30 minutes ahead stays. Task 2.
4. **The box restarting the night the job was due.** The next due time is worked out from the
   schedule at start, so a missed 04:00 runs at the next one; nothing here is urgent.
5. **A stepdown during a long `media_blobs` run.** No further batch starts once the signal is aborted.

---

### Task 1: Measure 10 — the batch size against sales

- [ ] **Step 1:** On the bench's year-of-trading copy (slice 0's built year; plan
  `2026-11-04-a1308-slice-0-bench.md` Task 5), in a throwaway worktree with Task 2's code, **first
  seed what the job deletes**, because a year of trading alone gives most steps nothing: 20,000
  expired sign-in challenges, 5,000 idle and ended dashboard sessions (persons seeded first), and
  2,000 photo-data rows no photo names (each a 200 KB blob). Then run a
  sale write every 2 seconds for 5 minutes twice: once with the job off, once running all four steps
  (the service-command step switched on in the throwaway copy only, since it is the only large
  table, ≈360,000–1,000,000 rows a year) with `HOUSEKEEPING_BATCH = 500`. Record each run's longest
  wait of a sale write for the write lock.
- [ ] **Step 2: Failing result, written in advance:** the longest sale wait with the job running
  exceeds the run without it by more than 50 ms. Then the batch shrinks (try 100, then 25) until it
  does not (jobs.md §5.10). Record the batch size chosen. If even 25 fails, stop (stop point 1).

### Task 2: The steps and the job

**Interfaces:**

```ts
export const HOUSEKEEPING_BATCH = 500;          // or measure 10's answer
export const HOUSEKEEPING_SERVICE_COMMANDS = false;
export interface HousekeepingStep {
  readonly name: "sign_in_challenges" | "dashboard_sessions" | "media_blobs" | "service_commands";
  readonly enabled: boolean;
  /** Deletes up to `limit` rows in one transaction; returns how many it deleted. */
  deleteBatch(tx: Transaction, now: Date, limit: number): Promise<number>;
}
export const HOUSEKEEPING_STEPS: readonly HousekeepingStep[];
export function housekeepingJob(deps: {
  db: Database;
  isPrimary: () => boolean;
  readClock: () => Promise<VenueClock>;   // as the backup supervisor's readClock, boot.ts:2876-2879
  jitterSeed: string;                     // the node id, as backups use
  now: () => Date;
  log: Logger;
  steps?: readonly HousekeepingStep[];
}): JobDefinition;
```

Name `housekeeping`; `applies: isPrimary`; `minSleepMs: 60_000` (a promotion still wakes it at once:
`roleChanged()` skips the floor, jr1); `maxSleepMs: timings.maxTickMs`
(env1, or `config.maxTickMs`); `backoff { firstMs: 60_000, maxMs: 3_600_000 }`; the job keeps its
`fireAt` in its closure: on its first pass it works out the next 04:00 with
`nextFireMs({ kind: "wall-clock", days: "daily", at: { hour: 4, minute: 0 } }, clock, now, jitterSeed)`
and returns it; on a pass at or after `fireAt` it runs every enabled step, then works out the next.

- [ ] **Step 1: Failing tests** (`useVenueDb`; seed persons first, rules §4):
  `"deletes expired challenges and ones stamped more than ten minutes ahead, and keeps live ones"`;
  `"deletes dashboard sessions idle past thirty minutes and keeps active ones"`;
  `"deletes ended dashboard sessions"`; `"deletes a session stamped more than thirty minutes ahead and keeps one stamped ten minutes ahead"`;
  `"never deletes the mirror viewer's session, however long idle"`;
  `"deletes photo bytes no photo names"`; `"a blob a photo names is never deleted"`;
  `"deletes in batches of HOUSEKEEPING_BATCH, one transaction each"` (count transactions with a
  batch of 2 over 5 rows: 3);
  `"the service-command step deletes records a day after their party or bill closed"` (calling the
  step directly) and `"the job does not run the service-command step while it is switched off"`;
  `"stops between batches once its signal is aborted"`;
  `"a failing step is logged and the next step runs, then the pass throws"`;
  `"runs once a day at 04:00 in the venue's time zone"`; `"does nothing on a box that is not primary"`.
- [ ] **Step 2–4:** FAIL; implement; PASS. For `service_commands`, join each row to its scope by
  `scope_kind`/`scope_id` (`packages/db/src/schema/parties.ts:102-130` at `a086eedfb7`) and read the
  scope's close time from the column the orders slice left (today the party's and the bill's own
  close columns); "a day" is 24 hours.
  Commit: "Add the daily tidy-up job".

### Task 3: Boot and measure 8

- [ ] **Step 1:** `jobRunner.add(housekeepingJob({ … }))` beside the other primary jobs.
  `boot.promote.test.ts`: add `housekeeping` to `PRIMARY_ONLY` — it has passed (its first pass only
  works out the next 04:00) after the promote.
- [ ] **Step 2:** Delete any backlog entry this finishes (`docs/backlog/architecture.md`, "What A1308
  retires", and any entry pp2 or pp3 left for the tidy-up). Run the Finish line. Commit: "Run the daily tidy-up on the primary".
