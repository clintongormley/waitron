# CI, tests and developer tooling — detail

The open entries are listed in [the backlog](../backlog.md), under "CI, tests and developer tooling". This file holds
their full text.

## The upgrade walk's total time limit can expire while phases still advance

On 2026-10-16, A182-2's normal push at local commit
`6edd7909e40c4ddc53e6c4ff78c52dc40522f4c2` ran the unchanged hook with
`VITEST_MAX_WORKERS=2`. Formatting and lint passed. The root coverage suite passed 6,736 cases
and failed only the migration walk, after 331.59 seconds overall. The failure printed:

```text
Still running after 174044 ms, past the 174000 ms deadline.
Stalled in phase core/0159_furry_beyonder: migrate after 423 ms.
```

The report includes completed phases through `workforce/0009_real_lockheed`; the current phase
had run for less than a second when the whole-walk deadline fired. The retained process snapshot
reports load averages of 51.78, 59.12 and 52.28, with 52% free memory. This observation does not
measure how much of the elapsed time came from CPU scheduling or filesystem work.

The branch's `migration-upgrade-budget.mjs` and `step-watch.mjs` match main byte for byte. The
budget came from `fb6a474b830ceb51ce96babd133a6a635e5f725d` (#1541); this branch adds only the
owner-approved canvas-retirement reset entry to the walk. The push was rejected before upload.
The complete hook output and process snapshot are retained in Lane G's local A182-2 receipts as
`q3-push-hook.log` and `q3-hook-failure-snapshot-163641.txt`.

2026-10-16: A751 (#1805, `39d07827e18658c671bfd3e9661dde065fc973c9`) replaced this wall-time deadline with a processor-time budget and a separate no-progress limit. See [the measured limits](../developers/ci-and-gates.md#the-upgrade-budget-counts-the-walks-own-processor-time). The receipt above records the earlier failure.

## Venue-service browser startup remains unexplained (#1557)

On 2026-10-11, [CI attempt 1's venue-service shard 2](https://github.com/clintongormley/waitron/actions/runs/38170156450/job/114561139899)
passed 317 database tests, then reported `Failed to connect to the browser session` before any
browser test started; attempt 2 passed on the same commit, and so did local macOS runs of shard
`2/4` with a warm and a cold dependency cache. The cause is still unknown.

A527 (2026-10-12) could not reproduce it: 100 repeats of shard `2/4` on CI's Linux runners, with
Vitest's browser channels and Playwright's browser log on, all passed (probe run 38189152637), and
in the newest 900 CI runs the message appears in that one job's log only. What A527 landed instead
is a record: every `test-venue-service` shard now logs each browser start-up step with its time,
and a failed shard keeps the artifact `venue-service-diagnostics-<shard>` (its whole output, 5 s
resource samples and a runner snapshot, 14 days). How to read one, and the measurements:
[ci-and-gates.md](../developers/ci-and-gates.md#a-failed-venue-service-shard-keeps-its-browser-start-up-record).

Next: when the message appears again, download that shard's artifact and find the first start-up
step missing from `shard.log`; fix that step. Do not raise `connectTimeout`, add a retry or lower
concurrency first. A raised limit goes in the outer config's `test.browser` block, the only place
Vitest 4.1.11 reads it.

## The stream pause test's frozen-bucket control failed once in CI

- **The stream pause test's frozen-bucket control failed once in CI (PR #1101, run 37108993254
  attempt 1, job 111163230954, 2026-10-03; passed on re-run).** In
  `apps/server/src/stream-pause.e2e.test.ts` step 6, the call to the bucket made just after
  `s3.pause()` answered before the bound, so the assertion at line 540 read
  `expected 'answered' to be 'unanswered'`. W30 makes `pause()` await the stopped state before its
  caller starts that control. The original one-off race has not been reproduced locally; the
  changed real-binary stream pause and loop suites passed together on 2026-10-03. If the control
  fails again, retain that run's log and inspect the child state before naming another cause.

## What moving the upgrade test's scratch directory to `/dev/shm` (A122, #856) left open

- **What moving the upgrade test's scratch directory to `/dev/shm` (A122, #856) left open:**
  `scratchParent()` does not fall back to the disk when `/dev/shm` is nearly full (in a Linux
  container the test peaked at about 14 MiB and failed with 8 MiB free), and on CI's Linux runner
  `scripts/scratch-dir.mjs` measures 83% of branches, because the line for a missing `/dev/shm` runs
  only on macOS; the root project's thresholds still pass. Neither is queued. Receipt:
  [ci-and-gates.md](../developers/ci-and-gates.md#the-upgrade-test-keeps-its-database-in-memory-on-linux).

## What the landing-port fix (A80, PR #740) left open

- **What the landing-port fix (A80, PR #740) left open:** `freePorts(n)`
  (`apps/server/src/testing/free-ports.ts`) holds every probe until the last port is drawn, but a
  port is still released before the server binds it, so another test worker drawing or connecting
  in that gap can take it; nothing has measured how often. Removing that would need the server to
  accept port 0 and report the port it bound (`WAITRON_HTTP_PORT` refuses `"0"` today).
  `bench/sqlite-failover/src/unreachable-store.ts`'s `reservePort` and the inline copy in
  `apps/server/scripts/cloud-integration-fixture.ts` have the same release-then-use shape and were
  not changed. C88 (#920) reproduced this gap as one way the pause test's single CI failure could
  happen, and `startS3TestServer` now recovers from it; the Waitron servers' own ports still have the
  gap.

## The spawn-timeout guard compares a bound against the LARGEST SINGLE wait, never the sum

- **The spawn-timeout guard compares a bound against the LARGEST SINGLE wait, never the sum — OPEN,
  and the guard cannot close it.** A case that waits several times can still outlast a bound that
  passes this check. Only reading catches that shape; if it recurs, the answer is probably a runtime
  check rather than a text reader. (Its `packages/` and `apps/` half went with the real-PostgreSQL
  harness; re-extending the scan is worth doing only if suites under those roots start declaring
  long waits again — `CLAUDE.md` §4.)

## What the per-push CI concurrency groups (#384) left open

- **What the per-push CI concurrency groups (#384) left open:**
  - **No run has exercised the `hold` answer** — an older run publishing after a newer one — which
    needs two merges close enough together to overlap and is not worth forcing.
  - **Two states stop publishing until a person intervenes:** a `:main` carrying no
    `WAITRON_BUILD_ID`, and one built from a commit this repository's history does not contain (an
    image built outside CI, or a rewritten history). Both wedge every later publish identically; the
    `sha-` tags keep coming. The repair is to delete or retag `:main` by hand. Nothing alerts on it.
  - **The first publish into a brand-new package will stop**, because GHCR answers `403 Forbidden`
    for a package that does not exist rather than `not found`, and treating a 403 as "no tag yet" is
    exactly the broadening that would publish a backwards tag. It matters only to a fork.
  - **The guard's concurrency cases see ci.yml alone.** `scripts/ci-workflow.test.mjs` reads that
    one file as text for them, so a future push-triggered workflow that groups by ref is seen by
    nothing.

## Three unexplained incidents, each seen once or twice; on recurrence retain the log before retrying

- **Three unexplained incidents, each seen once or twice; on recurrence retain the log before
  retrying** (standing rule: a flaky test is fixed at the root): eleven UI suites failing to load with
  "Vitest failed to find the current suite/runner" after a rebase (2026-09-11); a test PostgreSQL
  container with no published port (2026-09-12 — capture `docker inspect` and check the Docker
  Desktop VM's ephemeral ports); bookings' browser freeze, never reproduced locally after #291. A
  fourth, from #334's validation run (2026-09-12): the service-status browser suite failed with
  Playwright's "Frame was detached" during a whole-workspace run, and then passed on its own with no
  code change. The original log and screenshot were kept; the cause is unexplained, so retain them
  again on the next sighting rather than re-running to green.

## A sixth: a CI shard exited 1 with every test passing (PR #414)

- **A sixth: a CI shard exited 1 with every test passing (PR #414) — the exit-1 path closed by the
  Vitest 4.1.11 upgrade (#437); why the call went unanswered is still open.** Under vitest 3.2.7 one
  worker's `onTaskUpdate` reporting call timed out on birpc's 60-second default. On 4.1.11 an answer
  that never came would leave the shard waiting until the job's 10-minute `timeout-minutes`
  cancelled it, rather than failing it when the run ends. Written up in
  [ci-and-gates.md](../developers/ci-and-gates.md) rather than fixed (owner decision 2026-09-18); keep
  the job log on the next sighting — it is the cheapest evidence there is.

## `bench/pglite-throughput` starts a container `pnpm reap` cannot see

- **`bench/pglite-throughput` starts a container `pnpm reap` cannot see — OPEN (T2, 2026-09-23).**
  `bench/pglite-throughput/src/bench.ts` starts a real `postgres:18-alpine` through Testcontainers and
  stamps NO label, so an interrupted run of that rig leaks a container the reaper's label filter will
  never match; `bench/sqlite-failover` is the only rig that stamps `com.waitron.reapable`
  ([ci-and-gates.md](../developers/ci-and-gates.md) carries the receipt naming each rig). Either stamp
  the label in that rig or accept cleaning it by hand — but the rig's schema is three storage
  decisions out of date anyway (its own entry, _The PGlite throughput bench no longer matches the shape it says it matches_), so the two decisions belong together.

## A throwaway script found six comments that described code that was no longer there, and it is not a guard yet

- **A throwaway script found six comments that described code that was no longer there, and it is
  not a guard yet** (written 2026-09-14 during the tenant-column removal). It flags a comment whose
  subject has gone from the lines beneath it. It is not usable as it stands: 13 of its 19 hits
  were the legitimate shape where a block comment heads a group of members rather than describing
  the one line below it. **Next action:** rewrite it as a real root guard with an allowlist for that
  header-then-member shape, and its own tests, rather than re-running a scratch script.

## `apps/server/src/boot.mirror.test.ts`'s adoption-pending case no longer has a negative control

- **`apps/server/src/boot.mirror.test.ts`'s adoption-pending case no longer has a negative control.**
  The case boots a mirror on an empty database and checks it serves a status surface. Its receipt
  used to be a foreign key from `persons` to `tenants` — remove the guard and the boot would die on
  it — and #378 removed every foreign key to that table, so nothing now says what
  would break if the guard went. The test's own comment says this plainly and claims nothing more.
  **Next action:** find a failure the empty database still causes without the guard, and name it;
  if there is none, say so in the comment and stop calling the case a guard test.

## Two `health.test.ts` cases … feed a clean pass, so they check less than their titles say

- Found by #624 (`apps/server` part c1), outside its files or not fixable in a comments-only
  change. Two `health.test.ts` cases, "stays 200 when reconcile has failed runs but nothing
  parked" and "does not flip health for a failed-only run (parked stays 0)", feed a clean pass,
  so they check less than their titles say. Test titles #624 could
  not touch: "(T12b)" in `boot-pending-sweep.test.ts`, "(prove-by-deletion)" in
  `boot.reconcile.test.ts`, "(C2)", "(pre-merge review)", "(I1)" and "skipped a tenant" in
  `health.test.ts`, "the new guard" in `config.test.ts`.

## The v8-ignore reason "never run by `vitest run`" on schema files' extra-config functions was measured false

- The v8-ignore reason "never run by `vitest run`" on schema files' extra-config functions was
  measured false (identity, 2026-09-24, and #562's review). #585 took the reason out of
  `packages/db/src/schema`; the ignore pairs there stay. Four identity schema files and six in
  `packages/fiscal-verifactu/src/schema` keep the ignore pairs with no reason; removing a pair is a
  code change, for whoever next changes that package's code.

## Printing error test wording and profile-store session setup

Left open by #588: `packages/printing/src/errors.test.ts:5` says the error construction typechecks
"ONLY because" of one import; #588's review measured that claim false. The remaining layouts
profile-store suite creates a manager session in `beforeAll`, while `useVenueDb` resets data per
test, so that session belongs only to its first case. The canvas-store suite and its old
PostgreSQL-number title are retired with A182 part 2.

## `--no-verify`: the docs say "Claude never", the hook says "agents never"

**`--no-verify`: the docs say "Claude never", the hook says "agents never" — OWNER'S CALL (found
2026-10-03 by #1139's review).** `CLAUDE.md` §2 and `docs/developers/ci-and-gates.md` say "Claude
never pushes with `--no-verify`"; the hook's hint (`.husky/pre-push`) says "agents never". Codex
sometimes drives and reads `CLAUDE.md`, so the docs may need "no agent". **Next action:** the owner
decides whether the rule covers every agent, then the two docs follow.

## The shard layout was measured against an engine that is gone

**The shard layout was measured against an engine that is gone — OPEN (found 2026-09-23, task F1's
review wave).** The shard counts and their sizing arguments were all measured against PGlite.
`packages/db`'s ten mutation shards have since been timed on SQLite: 5m00s to 11m41s on run
38206876422 and 2.9 to 12.2 minutes on run 38241392066 (shard 10 the longest both times), and
`mutation.yml`'s comment above `mutation-db` says ten may now be more than the work needs. The count
has not been re-cut from those times. No local command produces the numbers, so re-cutting it has
to wait for a real run.

## The PGlite throughput bench no longer matches the shape it says it matches

**The PGlite throughput bench no longer matches the shape it says it matches — OPEN (found
2026-09-21, task P6).** `bench/pglite-throughput/src/bench.ts:18` calls itself "a faithful SHAPE
match" of the write path, and its `create table` statements are three landed storage decisions
behind: `numeric` money and quantity columns where the real columns are now whole-number counts
(#475 and task P6), and a `tenant_id` column the real schema no longer has. Either bring the three
decisions across and re-baseline, or change the sentence to say what it is.

## The gate never runs on a pull request, so thinning a `packages/db` test merges green

**Left behind by gating `packages/db`'s mutation score (#472, 2026-09-20).** **The gate never runs
on a pull request, so thinning a `packages/db` test merges green.** `.github/workflows/mutation.yml`
fires nightly and on `workflow_dispatch` only, and `mutation-db-aggregate` lives in it, so a change
that removes an assertion the score depended on reddens the next night. The ten db shards run side
by side, 2.9 to 12.2 minutes each on run `38241392066`, but a pull request that started them would
take ten of the roughly 20 jobs the account was seen running at once at most
([ci-and-gates.md](../developers/ci-and-gates.md#mutation-testing-runs-nightly-at-0500-utc)).
Either accept the overnight lag and say so where a reader meets the gate, or find a cheaper
per-pull-request signal.

## `packages/ui/src/vitest-park-pointer.ts` is mutated and has no tests

**Left behind by raising the `packages/ui` mutation score (#466, 2026-09-20).**
**`packages/ui/src/vitest-park-pointer.ts` is mutated and has no tests.** It is test-only plumbing
the Vitest config loads — the same class as `src/test-helpers.ts` and `src/a11y-helpers.ts`, which
`packages/ui/stryker.config.json` excludes from `mutate`. Adding a third exclusion is the consistent
move and also shrinks the denominator `mutation-ui-aggregate`'s bar of 90 is measured against.
Owner's call. `packages/ui/src/vitest-pointer-gestures.ts` (A720 Part 4) is in the same position:
in `packages/ui`'s coverage and `mutate` lists, loaded only by `packages/venue-service`'s Vitest
config, so no ui test reaches it. Excluding it also needs a change to the exclusion list
`scripts/mutation-shard.test.mjs` pins.

## A pull request that changes only front-end code gets no SPA bundle built anywhere in CI

**Left behind by the vite 8 upgrade (#450, 2026-09-19).**

- **A pull request that changes only front-end code gets no SPA bundle built anywhere in CI.**
  `bundle-smoke` builds esbuild bundles only. The only thing that runs `vite build` is
  `deploy/Dockerfile`, which the `image` job runs — on a pull request only when an image input has
  changed (`.github/workflows/ci.yml`, the `image` job's `if`), and on every main push; it never
  OPENS one, so a bundle that builds and renders nothing passes there too. This is the work item
  `CLAUDE.md` §2 and `docs/developers/ci-and-gates.md` point at.

## P7's leftovers (#533)

**What slice 1 left (#490 and the preparation tasks):**

- **P7's leftovers (#533):** `no-tenant-column`'s SQL check still passed with one set's SQL dropped,
  because it checks for an absence and the remaining files clear its floor of eight.
  `module-graph-honesty`, `schema-constraints` and `packages/db/src/classification.test.ts` still
  read a set's SQL their own way — the top of the `drizzle` folder only, and `module-graph-honesty`
  unsorted — rather than through `migrationSqlFiles`, which walks subfolders (no set has SQL in a
  subfolder today). `journal-monotonic` parses `_journal.json` itself rather than sharing
  `headSnapshot`'s reader.

## The dev launcher looks for `trading.env` only in the state folder `apps/server/.env` names

Left open by #1320 (W109-6) and #1322 (W109-4), content languages per region:

And seen
during #1320's look (2026-10-07, not checked against `main`): after the onboarding wizard
provisions, the stack started by `wa-wt onboarding <worktree>` restarted into setup mode, because
the dev launcher (`apps/server/scripts/dev-server.mjs`) looked for `trading.env` only in the state
folder `apps/server/.env` names, not the one `wa-wt` passes; the look worked round it with links. #1322's
look (2026-10-07, a Barcelona demo) met the same restart.

## Cross-app links in the split Vite dev stack

**Cross-app links in the split Vite dev stack — OPEN, unqueued.** The deployed server serves both
apps on one origin, but the dev stack runs the till on port 5190 and the dashboard on 5191. A
request for `/manage/devices` on 5190 returned the till HTML, while the same path on 5191 returned
the dashboard HTML (measured 2026-10-03 with `curl`). Make cross-app links reach the other dev
server without changing their deployed same-origin paths; this also affects setup's existing links.

## At a load average near 60, more root guard files fail on time

Measured 2026-10-16 on the 18-core Mac (64 GB, 58–60% of memory free), Node v26.11.1, Vitest
4.1.11: three root projects at once (`pnpm vitest run`, one with `--coverage`) and eight shell
loops that only spin; the one-minute load average peaked at 72 before the change and 102 on the
branch. Receipts in lane B's campaign folder,
`a751-receipts/heavy3/` (before A751) and `a751-receipts/verify-heavy3/` (A751's branch,
`425cf16b8`).

Before A751, each of the three runs failed 30–33 tests in 8–10 files. On A751's branch each failed
7–8 tests in four or five files, every one of them in all three runs except `guarded-teardowns` (one run):

| File | Case | What it printed (one run) |
| --- | --- | --- |
| `scripts/fiscal-allocation-migration.test.ts` | the whole file | `Hook timed out in 60000ms`, in `useVenueDb`'s `beforeAll` (`packages/db/src/testing/venue-db.ts`) |
| `scripts/guarded-teardowns.test.ts` | guards the resource it releases | `STACK_TRACE_ERROR` after 82 s |
| `scripts/menu-sections-upgrade.test.ts` | both cases | `STACK_TRACE_ERROR` after 43–69 s |
| `scripts/mutation-shard.test.mjs` | fills every shard | `STACK_TRACE_ERROR` after 51–58 s |
| `scripts/pre-push.test.mjs` | four to five cases | assertion failures or `STACK_TRACE_ERROR`, after 17–40 s |

`brand-build` (`status: null` after 10 s), `run-with-deadline` and `write-path-tables` failed the
same load before A751 and passed it on the branch; whether that is A751's lighter `ci-workflow` and
upgrade walk or chance was not measured. `fiscal-allocation-migration` passed the load before A751
(7.1–7.5 s) and failed it in all three runs on the branch. It failed the same way, `Hook timed out
in 60000ms`, on `main`'s code (`b81f1481c`) in the run where the load was kept up for 20 minutes
(`a751-receipts/heavy3-lifted/root1.json`), so it fails under sustained load without A751. On the
branch the load lasts longer because each root's upgrade walk is no longer cut off at 173 s. None of these failed with the root project and 16 spinning
loops alone (`a751-receipts/loaded16-full-root.json`), nor in lane G's failing push of 2026-10-16.
Each needs the same treatment A751 gave its own four files: what the bound waits for, its worst case under
this load with the bound lifted, and whether the case can be made cheaper.

## Decisions and deliberate limits

- **Upgrade-test work budget follows the migration count (A489, 2026-10-11) and counts the walk's
  own processor time (A751, 2026-10-16).** The captured 110.242-second walk exceeded the old fixed
  deadline near its final step. Keep the workload budget and remeasure it when a new reset changes
  the cost of rebuilding the baseline. A walk with no phase start or finish for 120 s fails;
  Vitest's 1,800 s bound is a backstop above CI's eight-minute `root-guards` limit.
  [Receipt](../developers/ci-and-gates.md#the-upgrade-deadline-grows-with-the-walk),
  [processor time](../developers/ci-and-gates.md#the-upgrade-budget-counts-the-walks-own-processor-time).

- **Job-sharding levers:** `--shard` splits by FILE COUNT; bump `shard: [1..N]` and the denominator
  together with N at or below the file count; rebalance `LIGHT_A/B_PACKAGES` when one light shard
  dominates.
- **The package suites' databases stay on the runner's disk, except in `test-venue-service` and
  `test-server-stream`.** With
  `TMPDIR=/dev/shm` on every database test job (A441, #1477: run 37945937673 against main run
  37938947421, one run each), no job's time moved consistently: the server shards took 219, 330 and
  424 s against 297, 273 and 438 s, and `apps/server/src/bill-payments.test.ts` 175.8 s against
  174.6 s. The root suites were not measured. The exceptions: `test-server-stream`'s step sets
  `TMPDIR=/dev/shm` (`docs/developers/testing-guide.md`, "In CI their temporary files are in
  memory"), and so does `test-venue-service`'s since A500 (2026-10-11), after main run 38142687186's
  shard 4 hit its 10-minute limit on a slow runner.
  [Receipt](../developers/ci-and-gates.md#the-venue-service-shards-keep-their-test-databases-in-memory).

**The development stack:**

- **A stale dev database is only reported AFTER the boot dies, never before it** (#343). A pre-flight
  check was offered and deliberately not built (owner chose the message and the documentation
  instead, 2026-09-13): compare each set's applied rows against its journal entry count
  (`packages/migrations/migrations.manifest.json` gives the set-to-table mapping) and warn before
  launching. Worth doing only if the after-the-fact line turns out not to be enough.
- **The hint cannot fire for an ahead-of-image database** (`provisioning.database_ahead`), by
  design: its operator text never suggests wiping — the remedy there is restore or reinstall (owner
  decision 2026-09-10).

**House rules and their guards:**

- **`CLAUDE.md` stays contained through regular housekeeping — it is not gated** (owner, 2026-09-14
  and 2026-10-07). #1337 (2026-10-07) moved the receipts into the `docs/developers/` topic files and
  took it from about 102 KB to about 71 KB. Add rules freely; prune when touching an entry, and sweep
  when the file has grown well past about 71 KB, per `CLAUDE.md` §7. The campaign watcher checks it on
  its 3-hourly evaluation. A housekeeping check, never a blocker. Receipt excerpts and the pointer guard's limits are retained in the
  [developer topics](../developers/writing-claims.md#root-instruction-receipts-retained-on-2026-10-14).
- **The pointers guard is deliberately narrower than "every pointer"** (#337): it does not check a
  root-level filename such as `eslint.config.js`, nor a bare directory. `CLAUDE.md` §7 says so;
  widen the guard if that gap ever costs something.


## Menu prices' narrow-layout CI failure still needs a cause (A613)

Main run [38505417966](https://github.com/clintongormley/waitron/actions/runs/38505417966/job/115661820912)
failed the cleared-price range case in `apps/dashboard/src/widgets/menu-prices-table.test.ts`:
its 320 px table did not acquire `narrow` during the existing wait. The cause remains unverified.

On 2026-10-14, the unchanged file passed five macOS runs of 261 tests. The CI-format command
`pnpm --filter @waitron/dashboard test:shard --shard=4/4` passed 3,438 tests, including that file;
this local shard used a separate coverage directory and did not enforce package-wide coverage.
Two sets of 24 target cases also passed with a retained Chromium CDP CPU-throttle request at
rate 8, then with that request and a deliberately delayed Verdana font response. The ordinary
fixture's runtime font inventory was empty and its status loaded. These macOS probes do not
reproduce the failed Linux run or establish a repair.

The phone-width helper now attaches a geometry and font snapshot to the original failed
assertion, without changing its check or wait. In an independently installed disposable copy,
removing the table's `narrow` update failed the original check; the snapshot reported a connected
tree at 320 px with `narrow: false`. Restoring the update passed both target cases. This control
checks the diagnostic, not the cause of the intermittent failure. Next: use that snapshot and
the existing failure screenshot to distinguish a wide scrolling box, delayed layout and missing
resize delivery before changing the screen or its test.

## Identify which pnpm setup command failed

A746 gives healthy version checks the installer's normal allowance and retains a controlled
slow-check regression. The original intermittent A737 hook retry was not reproduced. The setup
script reports the same `attempt N of 3 failed or stalled: npm install` line whether installation
or the version check failed, so stderr alone may not distinguish them. On recurrence, retain
separate statuses and timings for both commands before assigning the cause. The controlled
short-limit measurement is in [the CI guide](../developers/ci-and-gates.md#give-a-healthy-version-check-its-normal-allowance).

## The step-watch guard received an undefined held-thread result

On 2026-10-16, A737 Part 2's normal push at `877d14981`, rebased onto A751's
`39d07827e`, ran `pnpm vitest run --coverage`. Vitest 4.1.11 reported 6,838 passing
cases and one failure in 157.65 seconds. The failing case was
`scripts/step-watch.test.mjs`'s "reports the phase a synchronous call holds the thread in,
from another thread, counting from the last phase event". At line 557,
`expect(seenWhileHeld).toMatch(...)` received undefined. Its callback assigns that value
inside the held database call; the retained output does not explain why it was absent.

The same case run alone passed: `pnpm exec vitest run scripts/step-watch.test.mjs
-t 'reports the phase a synchronous call holds'` reported 1 passed, 45 skipped.
The guard and implementation had no diff from `origin/main`. Neither observation establishes
the cause or excludes a contribution from the feature branch. The normal push stopped before
uploading objects; no hook was bypassed. Raw logs remain in Lane F's local
`receipts/a737-after-a751/push.log` and `step-watch-focused.log`.

Next: capture the orchestration outcome and phase events before the missing-value assertion,
reproduce the full-run failure, then repair the responsible side without weakening the held-call
or phase-history checks. The phase waits exceeding the 100 ms no-progress limit are a hypothesis,
not a measured cause. An unchanged retry or the isolated pass is not a repair.

## The simulator suite lost its worker to the venue watchdog

On 2026-10-16, an A739a investigation at `6dcffc9d3` ran:

```sh
pnpm --filter @waitron/payments exec vitest run src/simulator.test.ts
```

On Node v26.11.1 and Vitest 4.1.11, the run reported 15 passing cases out of 22,
then one unhandled worker-exit error and exit 1. Its stderr logged
`provisioning.database_holder_frozen`, with `lockedAt` at
`2026-10-16T15:09:44.978Z`, `lastTickAt` at `2026-08-31T07:20:36.594Z`, and a stack
ending in a database insert. The complete log remains in Lane F's local
`receipts/a739a/provider-20261016.log`.

The focused ordinary capture, immediate decline and pretend-reader decline cases passed
(3 cases). The expiry case, run alone with
`-t 'expires an abandoned pretend reader' --reporter=verbose`, also passed (1 case).
Neither result repairs or explains the full run's worker loss.

The expiry case uses unrestricted `vi.useFakeTimers()` at
`packages/payments/src/simulator.test.ts:199`. The watchdog's stamp read `process.hrtime.bigint()` on the main
thread; the watchdog thread reads its own real clock. Next: if a full run on a commit that has the
captured clock loses its worker again, retain per-case timing and the stamp's value, and reproduce
before changing anything; otherwise close this entry.

On 2026-10-16 (A769, branch `fix/a769-venue-service-shard-hang`, on top of `1df3f5557`) the
unchanged suite passed 22 of 22 in each of 17 runs without the fix below, so the failure did not
reproduce as it was. With a 1,100 ms `Atomics.wait` added after the expiry case's
`vi.useFakeTimers()` and a 1,500 ms one in the case after it, the run printed the frozen line with
`lastTickAt` `2026-08-31T07:20:36.668Z` and `Tests 11 passed (22)`, exit 1 — within a tenth of a
second of the logged one, which is ten minutes, the time that case moves its fake clock, after the
moment this machine's monotonic clock read zero. The watchdog's stamp now reads a real clock and runs
on a real interval, both taken when `venue-liveness.ts` loads; with those waits the run then printed
`Tests 22 passed (22)`, and three unchanged runs did too. Detail:
[testing-guide.md](../developers/testing-guide.md#a-file-of-synchronous-database-work-gets-no-timer-turn-unless-usevenuedb-yields-one).

## A624. The upgrade walk cannot step a new set whose first migration names another set's later table

`scripts/migration-upgrade.test.ts` applies every set's first migration together at its
first step, so a set added now whose first migration has a foreign key to a table another set
created later fails there ("no such table: main.special_day_dates", found building A585-1). A585-1
fitted the walk by generating `staffing`'s tables in two migrations: `0000` holds the two tables
whose targets every first migration creates, `0001` the other three, among them `staffing_days`,
whose keys name venue-service's seasons and special days' dates. Next: teach the walk to apply a
first migration dated after its floor at its own date (a change to how the guard walks, so the owner
decides), then a set like staffing could keep one baseline.

## The step-watch case's A544 pre-push failure is fixed at a likely cause, not a confirmed one

The failure's message was not kept. A worker that starts late could report
`Stalled between phases` with no finished phases although phases had already been sent, which
the fix closes
([receipt](../developers/ci-and-gates.md#the-upgrade-test-names-the-phase-it-stalled-in)); a worker
that writes nothing within the held case's 5 s wait, so that the case reads an empty report, was
not reproduced and is unchanged. Next: if "reports the phase a synchronous call holds the thread in…"
fails again, keep its message and compare it with those two shapes.

On 2026-10-16 (A770) it failed in lane F's pre-push run with
`.toMatch() expects to receive a string, but got undefined`, neither shape: the held call never
ran. A pause that fails the body first on A751's 100 ms no-progress limit reproduces that error,
and A770 widened the limit
([receipt](../developers/ci-and-gates.md#the-upgrade-test-names-the-phase-it-stalled-in)); neither
shape above has yet been seen in a real run.

## A419 dashboard CI stall remains unexplained (#1474)

Run `37932573955` left `catalogue-screen.test.ts` unfinished; local focused and full-package runs
and diagnostic CI `37936013331` completed. No repair was established. Next: if it recurs, retain
per-test progress and locate the waiting operation before changing the browser harness. Since A441
every package test job prints each file's start and end and, every 60 s, the files still running
(`scripts/vitest-file-progress.mjs`); that run was cancelled, not timed out, after 3m26s with no
output.

## The upgrade walk's historical runtime variation remains unexplained after reducing setup work (A736, #1788)

- **The upgrade walk's historical runtime variation remains unexplained after reducing setup work
  (A736, [#1788](https://github.com/clintongormley/waitron/pull/1788)).** The captured 165,500/171,000 ms overruns have not been reproduced on the quieter host.
  On recurrence, retain the phase report and host state before retrying; compare repeated samples
  before assigning the variation to CPU scheduling or storage. Since A751 the budget counts the
  walk's own processor time, so a recurrence fails the test when that time passes the budget or no
  phase starts or finishes for 120 s (or, starved further, at CI's eight-minute `root-guards` limit
  with no report). Keep the failure report: a work-budget failure names the processor time used, a
  no-progress failure the wall time.
  [Measurement](../developers/ci-and-gates.md#reducing-repeated-upgrade-test-setup-work-a736)

## `.github/workflows/ci.yml` (about line 283) says the three-shell receipt sits in `.husky/pre-push` beside the same loop; it is not there

- Found by #602 (`scripts/`), each in a file a comments-only change cannot carry.
  `.github/workflows/ci.yml` (about line 283) says the three-shell receipt sits in
  `.husky/pre-push` beside the same loop; it is not there.
  Two reasons #602 deleted and did not restore, for the owner to confirm: the hook bullet at the
  top of `scripts/check-signoff.test.mjs` no longer gives a reason (the shell-instead-of-`.mjs`
  decision `licence.yml` points at is still stated), and `scripts/english-only.test.ts`'s
  provisioning-test exemption lost its end condition ("until that test runs against fiscal-none",
  spec §6 step 5).

## Chromium's ResizeObserver loop message in other dashboard suites (after W72h)

W72h (#1247) stopped Chromium logging "ResizeObserver loop completed with undelivered
notifications" from the Products tree's category name box. A261-3 (2026-10-05) and A349
(2026-10-08) then saw the message in other dashboard suites, on their own candidates and on the
commits before them; that comparison does not establish which observer causes it or its effect on
the rendered screen. A407 (#1432) later recorded: "The original-main catalogue-only command passed
270 cases without the warning; its historical occurrence was not reproduced and is not attributed
to currency fields."

The runs behind this are in
[the catalogue names section](catalogue.md#catalogue-no-two-categories-with-one-parent-and-no-two-active-products-share-a-name-w72-to-w72h-left-open).

## Tests that close a dialog and then check after a single `flush` (A452, #1487)

A452 made browser tests wait for a dialog's `wt-close` before checking what a screen does on close,
but its search found only a click or Escape followed within three lines by a wait; one followed by
a single-frame `flush` and an assertion was fixed in the Printers tests alone. Popovers (combobox,
help tooltip, row actions) report their toggle late too, and were not looked at.

**Next action:** search the browser suites for a dialog close followed by `flush` and an assertion
on a close-driven effect, and decide whether the popovers need the same treatment.

## The browser-purity guard checks only some of venue-service's dashboard files

`scripts/dashboard-browser-purity.test.ts` checks venue-service's `src/dashboard/painter.ts` and
the files it reaches by relative imports, beside bookings', adjustments' and staffing's dashboard
folders. Nothing else in venue-service's dashboard folder is checked, including the
`./dashboard/season-tint` export staffing uses, because the whole folder fails the guard: the scan
reached `@waitron/db` or `drizzle-orm` from many of its files (receipt: the Task 4.0 corrections in
`docs/superpowers/plans/2026-10-13-a585-staffing-and-rota.md`). **Next action:** list each
browser-safe venue-service export as a file. Left open by the reviews of A261 step 5 (Hours,
#1298) and by A585-4.

Checked 2026-10-16 (A774): the guard's list now also names
`packages/venue-service/src/dashboard/calendar-day-box.ts` and `fixed-title.ts`; `season-tint.ts`
and `live-queries.ts`, both exported by `packages/venue-service/package.json`, are still not named,
and no file the guard names imports `season-tint`.

## Two browser tests failed once each during A454's work

Two browser tests failed once each during A454's work (search everywhere), and neither was
reproduced or checked on `main`: "edge scroll reaches hidden column choices during a stationary
reorder" (`packages/ui/src/components/wt-data-table.test.ts`), once in a `packages/ui` coverage
run; and "cancel keeps reassignment selections and target until explicit local Discard"
(`apps/dashboard/src/screens/units-reassignment.unsaved.test.ts`), once in seven runs, then six
passes alone. Neither types a search. **Next action:** reproduce each under load and fix at the
root (standing rule: a flaky test is fixed, never re-run to green).

## A printers-screen test failed once during A435 step 2's review fixes

"a press after one edit sends the edit and the field as it was read"
(`apps/dashboard/src/screens/printers-screen.save-state.test.ts`) failed once in eight runs of the
printers-screen files on 2026-10-10, then passed alone and in the seven later runs; its error was
not captured. It was not reproduced. **Next action:** reproduce it under load and fix at the root
(standing rule: a flaky test is fixed, never re-run to green).
