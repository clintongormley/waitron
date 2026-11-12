# A1308 environment, PR 1 of 8: tuning knobs become constants — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eleven environment variables that nobody sets outside tests stop being read. Their values
become constants in code, and the tests that shortened them pass a `timings` option to
`startServer` instead.

**Architecture:** `loadConfig` stops reading the duty-loop timings, the payment scheduler's five
settings and the two log-rotation settings. Their defaults become `DEFAULT_DUTY_TIMINGS` and two log
constants in `apps/server/src/config.ts`. `startServer`'s third argument (`StartServerSeams`, the
bag of test hooks it already takes, `apps/server/src/boot.ts:966`) gains `timings`, a partial
override merged over the defaults. The checks that today refuse a bad combination of variables stay,
as a programming error on the option, because only a test can now set one.

**Tech Stack:** TypeScript, Vitest.

**Spec:** [`environment.md`](../specs/2026-11-02-rationalisation/environment.md) §1 ("Knobs nobody
sets become constants"), §3 rows `WAITRON_LOG_MAX_BYTES` to `WAITRON_SCHEDULER_STALE_AFTER_MS`, §5
measure 3; [README](../specs/2026-11-02-rationalisation/README.md) §7 "Environment variables";
[`jobs.md`](../specs/2026-11-02-rationalisation/jobs.md) §4 (":542", the runner adopts these as its
per-job constants). Every slice rule in [the slice rules](2026-11-08-a1308-slice-rules.md) applies;
this plan cites them as "rules §n".

**The environment part, in order.** Eight pull requests, one plan each:
env1 (this), [env2 merged names](2026-11-08-a1308-env2-merged-names.md),
[env3 the payments document](2026-11-08-a1308-env3-payments-settings.md),
[env4 settings that leave the credentials store](2026-11-08-a1308-env4-unsealed-settings.md),
[env5 backups from the dashboard only](2026-11-08-a1308-env5-backups-from-dashboard.md),
[env6 the backup document](2026-11-08-a1308-env6-backup-document.md),
[env7 the one list](2026-11-08-a1308-env7-one-list.md),
[env8 the two fiscal-path leftovers](2026-11-08-a1308-env8-fiscal-leftovers.md).
env1, env2 and env5 need nothing from each other and may be built in any order.

**Base:** `main` with batch 1 and batch 2 of A1308 landed (rules, build order). Cites were read at
`a086eedfb7`. Batch 2 may have moved `apps/server` code into packages (build order, "Batch 2"); a
cite whose file moved but still says the same thing is followed to its new home and listed in the
pull request description. A cite that no longer says what this plan says is a stop (rules §5.1).

**Owner lands:** no (rules §6). Nothing here changes a sale, an invoice number, a fiscal record, the
fiscal identity, AEAT sending or a hashed value: every default the box runs with is unchanged, only
where it is written down moves. Read, not run.

**No venue reset.** No starting migration changes.

## Coordination with the job runner (batch 3)

`jobs.md` §4 says the runner turns `WAITRON_MAX_TICK_MS` and the scheduler settings into its
per-job constants after this part retires them, and the job-runner plans already read env1's names:
[jr4](2026-11-08-a1308-jr4-working-time-and-mail.md):21, [jr6](2026-11-08-a1308-jr6-fiscal-jobs.md):26,156-187
and [jr7](2026-11-08-a1308-jr7-housekeeping.md):132-133 use `timings.x` from `DutyTimings`, "or
`config.x` before env1". Land env1 before jr4. So:

- If the job runner's first pull request has **not** landed at your base, build this plan as written.
  The runner then starts from `DEFAULT_DUTY_TIMINGS` and the `timings` option.
- If it **has** landed and already removed some of these names, skip those names, keep the rest, and
  list the skipped names in the pull request description. This is the one case where a cite that has
  moved is not a stop.
- If a job-runner pull request is **in flight** and touches `config.ts` or the duty loop, stop and ask
  the watcher which lands first (rules §5.5).

## Global Constraints

- An empty environment value counts as unset (`isUnset`, `apps/server/src/env-value.ts:5-7`); this
  plan removes reads, so it adds no new one.
- No compatibility code for a retired name: a box that still sets one is ignored, and env7 later logs
  it as unknown (environment.md §1, "There is no refusal for a retired name").
- Tests keep their assertions (rules §4). A case whose only subject is an environment variable this
  plan retires is deleted, and the pull request names it (Task 2 lists them).

## Review Focus

1. A test that set `WAITRON_MIN_TICK_MS: "200"` to make a duty run quickly must still run quickly:
   if the option is not wired, the duty waits 5 s per turn and the suite times out instead of
   failing on an assertion. Every converted file is run (finish line 2).
2. `health.ts` builds the drain duty's staleness budget from `DEFAULT_MAX_TICK_MS`
   (`apps/server/src/health.ts:21-26`); the constant must stay below that budget (Task 1 pins it).
3. A `timings` override with `minTickMs` above `maxTickMs` is a test bug; it must throw at start,
   not run a duty loop that silently clamps (Task 1).
4. The crash suite's child process (`handover-stepdown.crash.test.ts:216-228`) reads its start
   arguments from `process.argv[1]`; its timings must travel there, not in `env`.
5. `settlementLagMs` undefined means "the neutral layer's own seven days", not zero
   (`config.ts:50`); the default stays undefined.

---

## What it builds

1. `WAITRON_MIN_TICK_MS`, `WAITRON_MAX_TICK_MS`, `WAITRON_SKIP_RETRY_MS`,
   `WAITRON_SETTLEMENT_LAG_MS`, `WAITRON_SCHEDULER_HORIZON_DAYS`,
   `WAITRON_SCHEDULER_MAX_PERIODS_PER_TICK`, `WAITRON_SCHEDULER_MAX_ATTEMPTS`,
   `WAITRON_SCHEDULER_BACKOFF_BASE_MS`, `WAITRON_SCHEDULER_STALE_AFTER_MS`,
   `WAITRON_LOG_MAX_BYTES` and `WAITRON_LOG_MAX_FILES` are read nowhere.
2. `DEFAULT_DUTY_TIMINGS` and `resolveDutyTimings(override)` in `config.ts`; `ServerConfig` loses
   `minTickMs`, `maxTickMs`, `skipRetryMs`, `settlementLagMs`, `scheduler`, `logMaxBytes` and
   `logMaxFiles`.
3. `StartServerSeams.timings`; every test that set one of the eleven names passes it instead.
4. The boot-time refusal `at_or_above_drain_budget` (`boot.ts:1071-1080`) is deleted, and with it
   the limit it enforced on a configured value: `resolveDutyTimings` does **not** check `maxTickMs`
   against the drain duty's staleness budget, because only a test can now set it, and a test that
   sets a long `maxTickMs` sets it on purpose. The default's relation to the budget becomes a unit
   case on the constant (Task 1). The pull request says this limit is gone.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| `WAITRON_BACKUP_STALE_AFTER_MS` → constant | env5, which removes every environment backup setting together |
| `WAITRON_TUNNEL_POOL_SIZE` | already gone: #2543 (A951, `f317c21cea`) deleted it with `loadTunnelConfig` and the other three `WAITRON_TUNNEL_*` relay names |
| `WAITRON_SPARE_SPACE_DIR` → a start option | already done before this plan: the name is gone and `StartServerSeams.spareBytes` exists (`boot.ts:969`, `node-entry.ts:124`) |
| The job runner's per-job constants | the job-runner part (jobs.md §4) |
| Declaring the remaining names in one list | env7 |

## Interfaces

```ts
// apps/server/src/config.ts
export interface SchedulerConfig { horizonDays: number; maxPeriodsPerTick: number; maxAttempts: number; backoffBaseMs: number; staleAfterMs: number } // unchanged
export interface DutyTimings {
  minTickMs: number;            // 5_000 (today's DEFAULT_MIN_TICK_MS, :137)
  maxTickMs: number;            // DEFAULT_MAX_TICK_MS, 3_600_000 (:135)
  skipRetryMs: number;          // DEFAULTS.skipRetryMs from @waitron/payments (:436)
  settlementLagMs: number | undefined; // undefined
  scheduler: SchedulerConfig;   // DEFAULTS.* from @waitron/payments (:583-591)
}
export const DEFAULT_DUTY_TIMINGS: DutyTimings;
export const LOG_MAX_BYTES = 10_000_000;  // today's DEFAULT_LOG_MAX_BYTES (:143)
export const LOG_MAX_FILES = 5;           // today's DEFAULT_LOG_MAX_FILES (:144)
/** Merges `override` over the defaults (scheduler merged field by field) and throws a plain
 * `Error` naming the option when minTickMs > maxTickMs, skipRetryMs is outside
 * [minTickMs, maxTickMs], maxTickMs > 2_147_483_647, or any number given is not a positive safe
 * integer. `settlementLagMs` may be left undefined (the neutral layer's own seven days); a number
 * given for it must be a positive safe integer. */
export function resolveDutyTimings(
  override?: Partial<Omit<DutyTimings, "scheduler">> & { scheduler?: Partial<SchedulerConfig> },
): DutyTimings;

// apps/server/src/boot.ts, on StartServerSeams
/** Shorter duty timings for a test; production passes nothing. */
timings?: Parameters<typeof resolveDutyTimings>[0];
```

## Files

- Modify: `apps/server/src/config.ts` (`:17-23` kept, `:45-51`, `:84-87`, `:129` removed from
  `ServerConfig`; `:132-144` become the exports above; `:417-457` and `:546`, `:557-558`, `:582-592`
  deleted from `loadConfig`).
- Modify: `apps/server/src/boot.ts` — `:966-1002` (`StartServerSeams.timings`), `:1071-1080` (the
  drain-budget refusal goes), `:1145`, `:1148` (log constants), `:2236`, `:2720`, `:3607-3698`
  (read `timings.*` from `resolveDutyTimings(seams.timings)` computed once near `:1070`), and every
  `config.scheduler` reader the grep in Task 1 step 4 prints.
- Modify: `apps/server/src/health.ts` only if it imports anything removed (it imports
  `DEFAULT_MAX_TICK_MS`, which stays).
- Modify (tests, set-up only): every file `git grep -l -E "WAITRON_(MIN_TICK|MAX_TICK|SKIP_RETRY|SETTLEMENT_LAG|SCHEDULER_|LOG_MAX)" -- apps packages`
  prints at the base; at `a086eedfb7` that is `config.test.ts`, `boot.test.ts`,
  `boot.fiscal-retry.test.ts`, `boot.handover-chart-moved-on.test.ts`,
  `boot.handover-collection.test.ts`, `boot.handover-destination.test.ts`,
  `boot.promote-endpoint.test.ts`, `boot.promote.test.ts`, `boot.restricted-quiet.test.ts`,
  `boot.restricted.test.ts`, `boot.start-check.test.ts`, `handover-activation-repair.test.ts`,
  `handover-controlled.e2e.test.ts`, `handover-relinquish.test.ts`,
  `handover-stepdown.crash.test.ts`, `handover-stepdown.real.test.ts`,
  `promote-endpoint-e2e.test.ts`, `read-only-exemptions.test.ts` and `testing/place-copy-box.ts`,
  all under `apps/server/src/`.
- Modify (docs): `apps/server/README.md` (the rows for the eleven names, including the
  `WAITRON_SKIP_RETRY_MS` row near line 230), `docs/operations/a679-changed-checks.md` and
  `docs/developers/*.md` lines the finish-line grep prints; `docs/backlog/architecture.md:1395-1397`
  and its detail in `docs/backlog/box.md:211-…` are deleted (the README row they fault is gone).

## Size

Counted, hand-written: about 90 lines of code (`config.ts` +45, `boot.ts` +30, seam +15) and about
230 lines of tests (about 75 set-up sites at 2–3 lines each, plus 3 new cases). Not counted: pure
deletions in `config.ts`, `config.test.ts` and `boot.test.ts` (about 250 lines). About 2 hours.

## Finish line

1. `git grep -n -E "WAITRON_(MIN_TICK|MAX_TICK|SKIP_RETRY|SETTLEMENT_LAG|SCHEDULER_|LOG_MAX)" -- . ':!docs/superpowers'`
   prints only the recorded command in `docs/operations/a679-changed-checks.md`'s
   "Task 4 startup configuration order, 2026-10-17" section. **Watcher, 2026-11-12 22:15:**
   this is the one historical-command exception; preserve that receipt with a dated pointer.
   Every other match is a failure.
2. `pnpm --filter @waitron/server exec vitest run src/config.test.ts src/health.test.ts src/boot.test.ts src/boot.fiscal-retry.test.ts src/boot.promote.test.ts src/boot.promote-endpoint.test.ts src/boot.restricted.test.ts src/boot.restricted-quiet.test.ts src/boot.start-check.test.ts src/boot.handover-chart-moved-on.test.ts src/boot.handover-collection.test.ts src/boot.handover-destination.test.ts src/handover-activation-repair.test.ts src/handover-relinquish.test.ts src/handover-stepdown.real.test.ts src/handover-stepdown.crash.test.ts src/promote-endpoint-e2e.test.ts src/read-only-exemptions.test.ts src/handover-controlled.e2e.test.ts`
   prints a `Tests` count with no failures (CLAUDE.md §4: no count is no evidence).
3. `pnpm --filter @waitron/server typecheck` passes.

## Expected protection-list difference

EQUAL: no table, trigger or index changes. Run rules §3's two commands anyway; any line is a stop.

## Stop points (beyond rules §5)

1. A converted test passes only with a longer timeout or a changed wait: the option is not reaching
   the duty it used to reach. Stop; do not lengthen timeouts.
2. Measure 3 (environment.md §5): a child-process host other than the crash suite sets one of the
   eleven names (`git grep -n -E "WAITRON_(MIN_TICK|MAX_TICK|SKIP_RETRY|SCHEDULER_)" -- apps/server/test apps/server/scripts`
   prints a line). The design's fallback is a test-only `WAITRON_TEST_TUNING` honoured only when
   `WAITRON_ENV=dev`; the watcher confirms before you take it. At `a086eedfb7` that grep prints
   nothing.

---

### Task 1: the constants, the resolver and the option

**Files:** `apps/server/src/config.ts`, `apps/server/src/boot.ts`, `apps/server/src/config.test.ts`,
`apps/server/src/health.test.ts`.

**Interfaces:** Produces everything in **Interfaces** above.

- [ ] **Step 0:** record the base protection list (rules §3).
- [ ] **Step 1: Write the failing cases** in `config.test.ts`, describe `"duty timings"`:
  - `"has the defaults the box has always run with"`: `expect(DEFAULT_DUTY_TIMINGS).toEqual({ minTickMs: 5000, maxTickMs: 3_600_000, skipRetryMs: DEFAULTS.skipRetryMs, settlementLagMs: undefined, scheduler: { horizonDays: DEFAULTS.horizonDays, maxPeriodsPerTick: DEFAULTS.maxPeriodsPerTick, maxAttempts: DEFAULTS.maxAttempts, backoffBaseMs: DEFAULTS.backoffBaseMs, staleAfterMs: DEFAULTS.staleAfterMs } })`.
  - `"merges an override field by field"`: `resolveDutyTimings({ minTickMs: 50, maxTickMs: 200, skipRetryMs: 100, scheduler: { maxPeriodsPerTick: 1 } })` equals the defaults with those four fields replaced and the other four scheduler fields unchanged.
  - `"refuses an impossible override"`: `{ minTickMs: 300, maxTickMs: 200 }`, `{ skipRetryMs: 1 }` (below the 5 000 minimum), `{ maxTickMs: 2_147_483_648 }` and `{ minTickMs: 0 }` each throw an `Error` whose message names the option (`minTickMs`, `skipRetryMs`, `maxTickMs`, `minTickMs`).
  - `"logs rotate at 10 MB and keep five files"`: `LOG_MAX_BYTES === 10_000_000`, `LOG_MAX_FILES === 5`.
  In `health.test.ts`: `"drain's budget exceeds the longest idle sleep"`:
  `expect(DEFAULT_DUTY_TIMINGS.maxTickMs).toBeLessThan(DUTY_BUDGET_MS[DRAIN_DUTY])`. This replaces
  the two boot cases at `boot.test.ts:2978-3005` (refusal at the budget, acceptance one below).
- [ ] **Step 2: Run them; they fail** (`DEFAULT_DUTY_TIMINGS` is not exported).
- [ ] **Step 3: Implement** the exports in `config.ts` and delete the eleven reads from `loadConfig`
  with the `ServerConfig` fields named in **Files**. Keep `positiveInt` (`WAITRON_HTTP_PORT`,
  `WAITRON_STAFF_PORT` and the backup settings env5 removes, `backup-config.ts`, still use it).
- [ ] **Step 4: Wire boot.** In `bootServer`, compute `const timings = resolveDutyTimings(seams.timings)`
  where the drain-budget check stood (`boot.ts:1071-1080`, deleted). Replace every
  `config.minTickMs`, `config.maxTickMs`, `config.skipRetryMs`, `config.settlementLagMs` and
  `config.scheduler` with `timings.*` (`git grep -n "config\.\(minTickMs\|maxTickMs\|skipRetryMs\|settlementLagMs\|scheduler\)" -- apps/server/src`
  lists them), and `config.logMaxBytes`/`logMaxFiles` (`:1145`, `:1148`) with the two constants.
- [ ] **Step 5: Run** step 1's cases and `pnpm --filter @waitron/server typecheck`; they pass.
- [ ] **Step 6: Commit:** `git commit -s -m "Duty timings, scheduler settings and log rotation become constants (A1308 env1)"`

### Task 2: the tests pass `timings` instead of variables

**Files:** the test files in **Files**.

- [ ] **Step 1: Convert each site.** Where a test builds an `env` object with any of the eleven names
  and hands it to `startServer(env, base, seams)`, move those keys into `seams.timings` with numbers,
  for example `WAITRON_MIN_TICK_MS: "200", WAITRON_MAX_TICK_MS: "600000"` becomes
  `timings: { minTickMs: 200, maxTickMs: 600_000 }`; `WAITRON_SCHEDULER_MAX_PERIODS_PER_TICK: "1"`
  (`handover-stepdown.real.test.ts:306`) becomes `timings: { scheduler: { maxPeriodsPerTick: 1 } }`.
  A shared helper that builds the env (`testing/place-copy-box.ts:409-410`, the module-level env
  constants in `boot.promote.test.ts:235-237`, `boot.promote-endpoint.test.ts:79-81`,
  `promote-endpoint-e2e.test.ts:124-126`, `read-only-exemptions.test.ts:176-178`) gains a sibling
  `timings` constant passed at each `startServer` call.
- [ ] **Step 2: The crash child.** In `handover-stepdown.crash.test.ts`, the child reads
  `const { env, binding, timings } = JSON.parse(process.argv[1])` (`:221`) and passes
  `timings` in its seams (`:222`); the parent puts `timings: { minTickMs: 200, maxTickMs: 600_000 }`
  into the JSON instead of `:409-410`.
- [ ] **Step 3: Delete the cases whose only subject is a retired variable,** and name each in the
  pull request: in `config.test.ts`, every case that sets one of the eleven names to test its
  parsing or a refusal naming it; in `boot.test.ts`, `"rejects WAITRON_MAX_TICK_MS at or above
  drain's staleness budget…"` and its acceptance twin (`:2978-3005`, replaced by Task 1's health
  case). Cases that only *used* a name to run fast keep their assertions and are converted in step 1.
  `boot.test.ts:2412`, "boots without WAITRON_SETTLEMENT_LAG_MS, taking the neutral layer's own
  default", keeps its assertion and is renamed "boots without a settlement lag, taking the neutral
  layer's own default". `boot.test.ts:2610`'s title says "WAITRON_SKIP_RETRY_MS, not
  WAITRON_MIN_TICK_MS"; it becomes "the skip retry, not the minimum tick"; its distinctive value
  45678 moves to `timings.skipRetryMs`.
- [ ] **Step 4: Run** finish lines 1–3. Every file prints a `Tests` count and no failure.
- [ ] **Step 5: Docs.** Delete the eleven rows from `apps/server/README.md`; fix any line the
  finish-line grep prints in `docs/developers` or `docs/operations`; delete the backlog entry
  `docs/backlog/architecture.md:1395-1397` and its detail section in `docs/backlog/box.md` (it faults
  a README row that no longer exists; CLAUDE.md §6, "A change that finishes an entry DELETES it").
- [ ] **Step 6: Protection list** (rules §3): `compare` prints nothing.
- [ ] **Step 7: Commit:** `git commit -s -m "Tests pass duty timings as a start option (A1308 env1)"`.
  Then `/finish-branch`.

## Waitron Cloud

Nothing to change: Cloud's repository sets none of the eleven names (`git grep` over
`~/workspace/repos/waitron-cloud` at `d4451d227`, read 2026-11-08).
