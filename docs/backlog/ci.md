# CI, tests and developer tooling — detail

The open entries are listed in [the backlog](../backlog.md), under "CI, tests and developer tooling". This file holds
their full text.

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

## Would the package suites' databases gain from memory too?

- **Would the package suites' databases gain from memory too?** `useVenueDb`
  (`packages/db/src/testing/venue-db.ts`) makes each suite's venue folder under the system temporary
  directory, and the root suites `scripts/append-only-triggers.test.ts` and
  `scripts/behavioural-triggers.test.ts` make theirs there too, so they all commit to the runner's
  disk. Not measured for them. Next action: time one database-heavy package's `test:coverage` in CI
  with its folders on the disk and under `/dev/shm` (`scratchParent()` in `scripts/scratch-dir.mjs`
  is the choice the upgrade test makes), and adopt it in `useVenueDb` only if the shard times move
  and a suite's databases fit in `/dev/shm` (Docker's default is 64 MiB). One data point from
  A130: on a CI runner a stream test's commit took 1,017 ms while Linux's pressure counters showed
  every process stalled on the disk ([testing-guide.md](../developers/testing-guide.md), "In CI their
  temporary files are in memory").

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

## Nobody has timed `packages/db/src/testing/schema-conformance.ts` under a mutation run

- **Nobody has timed `packages/db/src/testing/schema-conformance.ts` under a mutation run — OPEN
  (2026-09-23).** `packages/db`'s mutation run is split across ten parallel CI jobs by
  `scripts/mutation-shard.mjs`, which packs whole files into jobs by file size in bytes. That file is
  now the largest file the run mutates — recompute with
  `find packages/db/src -name '*.ts' ! -name '*.test.ts' -exec wc -lc {} + | sort -k2 -nr | head`
  rather than trusting a figure written here. `sales.ts` is the single entry in that script's
  `HEAVY_FILES`, the mechanism for splitting one file across several jobs. **The new file's runtime
  was not measured and no `HEAVY_FILES` entry was added**, so whether it drags a job out the way
  `sales.ts` did is unknown — and size alone does not settle it, since what dominated `sales.ts` was
  that nearly the whole suite covers its mutants. Nothing on a pull request will say either:
  `packages/db`'s mutation score and its job durations belong to the weekly `mutation.yml` run
  (`CLAUDE.md` §2). **Next action:** read the job durations from the next weekly run, and add a
  `HEAVY_FILES` entry if that file's job is the long one.

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

## A fifth: a stray `:hover` state in `test-dashboard`'s browser a11y suite

- **A fifth: a stray `:hover` state in `test-dashboard`'s browser a11y suite — FIXED in #350; two
  pieces still open.** The `dashboard-app.a11y.test.ts` heading-order sighting is a different rule
  with no colour evidence, so nothing here explains it — treat it as still unexplained. And
  `packages/ui` and `apps/till` have the same harness with no pointer reset (the dashboard's is
  `parkPointer`, guarded by `apps/dashboard/src/widgets/pointer-reset.test.ts`), with
  `packages/ui/src/components/wt-button.test.ts` ending a test hovering a button, so the same flake
  is waiting there.

## A sixth: a CI shard exited 1 with every test passing (PR #414)

- **A sixth: a CI shard exited 1 with every test passing (PR #414) — the exit-1 path closed by the
  Vitest 4.1.11 upgrade (#437); why the call went unanswered is still open.** Under vitest 3.2.7 one
  worker's `onTaskUpdate` reporting call timed out on birpc's 60-second default. On 4.1.11 an answer
  that never came would leave the shard waiting until the job's 15-minute `timeout-minutes`
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
  decisions out of date anyway (its own entry in Track C), so the two decisions belong together.

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

## The venue-service `migrations.test.ts` case titled "… or at commit" asserts no refusal at commit

- Found by #611 (`packages/venue-service`), outside its package or not fixable in a comments-only
  change. The venue-service `migrations.test.ts` case
  titled "… or at commit" asserts no refusal at commit, which is now testable because
  `packages/store/src/node-sqlite-adapter.ts` rolls back a refused commit (since #489); a
  commit-time case, and the title, are a test change. `operations.test.ts`'s placeholder unit id
  no longer shows an empty string refused: `unit_id` is plain text.

## `.github/workflows/ci.yml` (about line 283) says the three-shell receipt sits in `.husky/pre-push` beside the same loop; it is not there

- Found by #602 (`scripts/`), each in a file a comments-only change cannot carry.
  `.github/workflows/ci.yml` (about line 283) says the three-shell receipt sits in
  `.husky/pre-push` beside the same loop; it is not there.
  `docs/developers/modifiers.md` (about lines 469-472) calls the `catalogue-engine-neutral`
  header paragraph "the receipt" for not checking `pgEnum` in the order and sale files;
  #602 deleted that paragraph because those columns are now
  `enumType` (text plus a check). `docs/developers/testing-guide.md` (about line 294) says
  `scripts/ci-workflow.test.mjs` "had the mechanism right first"; #602's review corrected that
  file's comment to what testing-guide itself measured (the per-test timer does not fire during
  a blocking `spawnSync`; the test is failed afterwards for its length), so the credit no longer
  matches.
  Two reasons #602 deleted and did not restore, for the owner to confirm: the hook bullet at the
  top of `scripts/check-signoff.test.mjs` no longer gives a reason (the shell-instead-of-`.mjs`
  decision `licence.yml` points at is still stated), and `scripts/english-only.test.ts`'s
  provisioning-test exemption lost its end condition ("until that test runs against fiscal-none",
  spec §6 step 5).

## The v8-ignore reason "never run by `vitest run`" on schema files' extra-config functions was measured false

- The v8-ignore reason "never run by `vitest run`" on schema files' extra-config functions was
  measured false (identity, 2026-09-24, and #562's review). #585 took the reason out of
  `packages/db/src/schema`; the ignore pairs there stay. Four identity schema files and six in
  `packages/fiscal-verifactu/src/schema` keep the ignore pairs with no reason; removing a pair is a
  code change, for whoever next changes that package's code.

## One test title in `packages/layouts/src/canvas-store.db.test.ts` (line 144) still quotes PostgreSQL's error number 23001

- Found by #588 (`packages/layouts`), not fixable in a comments-only change. One test title in
  `packages/layouts/src/canvas-store.db.test.ts` (line 144) still quotes PostgreSQL's error number
  23001; the stores match SQLite's. `packages/printing/src/errors.test.ts:5`
  says the error construction typechecks "ONLY because" of one import — #588's review measured the
  same claim false for printing and layouts. Both layouts database suites create a
  manager session in `beforeAll`, while `useVenueDb` empties every data table after each test by
  default (`resetPerTest`, `packages/db/src/testing/venue-db.ts`), so only a suite's first test can
  use that session; they pass today because only the first does.

## `--no-verify`: the docs say "Claude never", the hook says "agents never"

**`--no-verify`: the docs say "Claude never", the hook says "agents never" — OWNER'S CALL (found
2026-10-03 by #1139's review).** `CLAUDE.md` §2 and `docs/developers/ci-and-gates.md` say "Claude
never pushes with `--no-verify`"; the hook's hint (`.husky/pre-push`) says "agents never". Codex
sometimes drives and reads `CLAUDE.md`, so the docs may need "no agent". **Next action:** the owner
decides whether the rule covers every agent, then the two docs follow.

## The shard layout was measured against an engine that is gone

**The shard layout was measured against an engine that is gone — OPEN (found 2026-09-23, task F1's
review wave).** The shard counts and their sizing arguments were all measured against PGlite and
none has been re-measured — `mutation.yml`'s ten-shard matrix for `packages/db` most of all, whose
comment says so explicitly. Read the next weekly run's shard durations before treating any of them
as current. No local command produces the numbers, so re-cutting the matrix has to wait for a real
weekly run.

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
fires on a weekly schedule and on `workflow_dispatch` only, and `mutation-db-aggregate` lives in it,
so a change that removes an assertion the score depended on reddens the following Monday. The ten db
shards took about 50 minutes of wall clock, which is why nobody has put them on the merge path.
Either accept the weekly lag and say so where a reader meets the gate, or find a cheaper
per-pull-request signal.

## `packages/ui/src/vitest-park-pointer.ts` is mutated and has no tests

**Left behind by raising the `packages/ui` mutation score (#466, 2026-09-20).**
**`packages/ui/src/vitest-park-pointer.ts` is mutated and has no tests.** It is test-only plumbing
the Vitest config loads — the same class as `src/test-helpers.ts`, `src/a11y-helpers.ts` and
`src/tokens/token-test-helpers.ts`, which `packages/ui/stryker.config.json` already excludes from
`mutate`. Adding a fourth exclusion is the consistent move and also shrinks the denominator the
`break: 90` is measured against. Owner's call.

## A pull request that changes only front-end code gets no SPA bundle built anywhere in CI

**Left behind by the vite 8 upgrade (#450, 2026-09-19).**

- **A pull request that changes only front-end code gets no SPA bundle built anywhere in CI.**
  `bundle-smoke` builds esbuild bundles only. The only thing that runs `vite build` is
  `deploy/Dockerfile`, which the `image` job runs — on a pull request only when an image input has
  changed (`.github/workflows/ci.yml`, the `image` job's `if`), and on every main push; it never
  OPENS one, so a bundle that builds and renders nothing passes there too. This is the work item
  `CLAUDE.md` §2 and `docs/developers/ci-and-gates.md` point at.

## Decisions and deliberate limits

- **Job-sharding levers:** `--shard` splits by FILE COUNT; bump `shard: [1..N]` and the denominator
  together with N at or below the file count; rebalance `LIGHT_A/B_PACKAGES` when one light shard
  dominates.

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
  its 3-hourly evaluation. A housekeeping check, never a blocker.
- **The pointers guard is deliberately narrower than "every pointer"** (#337): it does not check a
  root-level filename such as `eslint.config.js`, nor a bare directory. `CLAUDE.md` §7 says so;
  widen the guard if that gap ever costs something.
