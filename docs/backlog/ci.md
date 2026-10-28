# CI, tests and developer tooling — detail

The open entries are listed in [the backlog](../backlog.md), under "CI, tests and developer tooling". This file holds
their full text.

## Tests that read a built command's error output fail under Claude Code

The command's stderr
begins with a `<claude-code-hint … />` line, so `apps/server/src/first-fiscal-launch.test.ts` and
seven `packages/provisioning` CLI cases fail locally under an agent on `main` (A798-B slice 8
plan, E8 and E13). Found while planning A798-B slice 8. On 2026-10-26, during A980 S1a2,
`packages/provisioning/src/first-setup-command-import.test.ts`'s case "the actual relocated command
resumes a retained import and publishes it once" failed this way (its child's stderr held
`<claude-code-hint …/>` where the case expects it empty) and passed under
`env -i HOME PATH TMPDIR`; it fails the same way on `27ae35c09` and `d23e32966`. Next action: find
which inherited variable lets the hint through and clear it in the cases' child environment.

## A backlog detail link still names the old five-handler heading

The till entry’s
`backlog/till.md#five-till-handlers-still-leave-a-failed-list-refresh-unhandled-and-one-a11y-file-may-not-render-its-screen`
no longer matches “Three till handlers still leave a failed list refresh unhandled”.
Retarget the link during the till backlog cleanup; keep the open handlers entry.

Two other index links need the same cleanup: A555 still targets the fiscal detail's old
`design-proposed-2026-10-21` heading, while that heading now says `DESIGN APPROVED`;
the payments link still names “The card refund path records only after the provider call,
with a fresh key each time”, while its detail now says “The reconciler's card reversal records
only after the provider call, with a fresh key each time”. Retarget both without changing
their open work, then check the index's local heading links.

## Retain failure screenshots for long browser test names

A failed waiting-list refresh case
in `apps/till/src/till-app.test.ts` logged `locator.screenshot: ENAMETOOLONG` during A743's
fixture checks. Bound the generated screenshot filename and keep the complete test name in
its metadata; verify with a deliberately failing case whose generated name is long.

## CodeQL's `timeout-minutes: 50` rests on the default setup's durations (A488)

codeql.yml
saves no overlay-base database, which the default setup's runs did, so its own durations may
differ. Next: after a week of nightly runs, read their job durations and set the limit from them
(docs/developers/ci-and-gates.md, "Every job has a time limit").

## Both image jobs still run `docker/setup-buildx-action`

The only stated reason was the
cache export #1427 removed. Whether the builds still need it (for example for `load: true` or the
print-agent build reusing the app build's layers) was not tried. Left open by A399 (#1427); no
action queued.

## A new branch pushed while the refresh fails still has its range start at the local `origin/main`'s merge base

Left open by the pre-push hook's sign-off fixes, A392 (#1421) and
A411 (#1445), after which the hook refreshes `origin/main` from the remote first; no action
queued.

## `bundle-smoke` builds only the credentials and server bundles

A change to
`scripts/bundle-node.mjs` selects print-agent and provisioning for typecheck and tests (#593,
through `ROOT_SCOPE_CONSUMERS` in `scripts/changed-scope.mjs`) but builds neither of their bundles
in CI.

## Neither `working_line_contexts.unit_id` nor its write refuses an empty unit id

The column
is `text NOT NULL` with no foreign key or CHECK, and `recordWorkingLineContexts`
(`packages/venue-service/src/operations.ts`) writes it unchecked. Refuse `""` there, with a case,
or record why a sale can never carry one. Left open by A810 (#1886).

## The hint's cover stops at the migration run, and provisioning runs after it

A module's
provisioning seat (`packages/catalogue/src/provisioning.ts` seeds units) executes once migrations
succeed, outside `withDevMigrationHint`, so a seeding failure there on a stale database gets no
curated line. Nobody has hit this. Left open by #343.

## `apps/server/src/rejoin-command.test.ts`'s sidecar assertions do not test the wipe

The
fixture closes the handles first, which removes the sidecars. The wipe's sidecar removal is
pinned by `apps/server/src/db-wipe.test.ts`; what is missing is a rejoin-level case with sidecars
on disk. Left open by SQLite slice 2 Task 5 (#569, `@waitron/stream`).

## Loose ends left by W92 (#1250)

- Some dashboard pixel and drag cases W92 did not change failed once when run in parallel locally
  during the branch's work; the cause was not found. They passed in the PR's dashboard CI shard on
  its final head.

## The server holds two separate 100-character limits for text a request sends

`SEARCH_MAX`
(`apps/server/src/orders-list.ts`, search text) and `TEXT_MAX` (`apps/server/src/orders-api.ts`, the Orders request's text fields).
Changing one leaves the other. Left open by A454 (#1491). **Next action:** decide whether they are
the same limit and, if so, share one constant.

## The test-shape half of #339's lesson is unwritten

#339 passed review and CI and the first
person to open the screen got a 500; the "open it and look" half is CLAUDE.md §4's rule. The
other half — a matrix that varies two things separately and never crosses them proves less than
it looks — wants its own line. Left open by content languages and the image library (#339).

## The other sharded packages still use Vitest's file-count split.

Fiscal-verifactu, till, dashboard,
venue-service, db and provisioning do not pack their shards by measured duration as the server
does. Left open by A938. On main run 40088908331 (head `d7d428e52`, 2026-10-24) `test-dashboard`
shard 3 took 276 s, past the 4-minute bar; packing the dashboard's shards by measured duration is
the fix at the cause. On main run 40597297102 (head `8e454b1eb`, 2026-10-27) the dashboard's four
shards' runs took about 115, 202, 235 and 239 s, and shard 4's job 4 min 46 s.
[Receipt](../developers/ci-and-gates.md#the-servers-shards-sixteen-packed-by-measured-duration)

## Nothing checks, on every CI run, that each server test file ran in exactly one shard.

A standing check, for example in `test-server-merge` comparing the shards' `end`
lines with the file list, is open. Left open by A938. [Receipt](../developers/ci-and-gates.md#the-servers-shards-sixteen-packed-by-measured-duration)

## The first fiscal-hour end-to-end file exceeds the job budget

Found while qualifying A731 on 24 October 2026. The file
`apps/server/src/first-fiscal-hour.e2e.test.ts` took 248.1, 249.4, 250.2 and 248.5 seconds in
successful main runs `40088908331`, `40088741438`, `40084093811` and `40102803326`, respectively.
Those runs precede A731's code. The same file took 280.7 seconds in A731's successful
[first PR run](https://github.com/clintongormley/waitron/actions/runs/40110506543).
These are the file's `[file-progress] end` times, before the rest of its shard and job setup.

Next: split the restart scenarios or reduce repeated fixture work, keep every fiscal and restart
assertion, and measure the resulting files on a slow CI runner. Refresh the duration table after
measuring; moving this whole file to another shard cannot bring its own time below four minutes.
The A731 repair suites are split separately; this existing fiscal-hour suite is outside that item.

Find why each restart test boots the real entry point twice. Left open by A938 (#1930).
[Receipt](../developers/ci-and-gates.md#the-servers-shards-sixteen-packed-by-measured-duration)

## Venue-service browser startup remains unexplained (#1557)

On 2026-10-11, [CI attempt 1's venue-service shard 2](https://github.com/clintongormley/waitron/actions/runs/38170156450/job/114561139899)
passed 317 database tests, then reported `Failed to connect to the browser session` before any
browser test started; attempt 2 passed on the same commit, and so did local macOS runs of shard
`2/4` with a warm and a cold dependency cache. The cause is still unknown.

Every `test-venue-service` shard now logs each browser start-up step with its time,
and a failed shard keeps the artifact `venue-service-diagnostics-<shard>` (its whole output, 5 s
resource samples and a runner snapshot, 14 days). How to read one, and the measurements:
[ci-and-gates.md](../developers/ci-and-gates.md#a-failed-venue-service-shard-keeps-its-browser-start-up-record).

Next: when the message appears again, download that shard's artifact and find the first start-up
step missing from `shard.log`; fix that step. Do not raise `connectTimeout`, add a retry or lower
concurrency first. A raised limit goes in the outer config's `test.browser` block, the only place
Vitest 4.1.11 reads it.

## The stream pause test's frozen-bucket control failed once in CI

- In
  `apps/server/src/stream-pause.e2e.test.ts` step 6, the call to the bucket made just after
  `s3.pause()` answered before the bound, so the assertion at line 540 read
  `expected 'answered' to be 'unanswered'`. W30 makes `pause()` await the stopped state before its
  caller starts that control. The original one-off race has not been reproduced locally. If the control
  fails again, retain that run's log and inspect the child state before naming another cause.

## What moving the upgrade test's scratch directory to `/dev/shm` (A122, #856) left open

`scratchParent()` does not fall back to the disk when `/dev/shm` is nearly full (in a Linux
container the test peaked at about 14 MiB and failed with 8 MiB free), and on CI's Linux runner
`scripts/scratch-dir.mjs` measures 83% of branches, because the line for a missing `/dev/shm` runs
only on macOS; the root project's thresholds still pass. Neither is queued. Receipt:
[ci-and-gates.md](../developers/ci-and-gates.md#the-upgrade-test-keeps-its-database-in-memory-on-linux).

## What the landing-port fix (A80, PR #740) left open

`freePorts(n)` (`apps/server/src/testing/free-ports.ts`) holds every probe until the last
port is drawn, then releases them. A different worker can take a released port before its
intended server binds. The normal `WAITRON_HTTP_PORT` parser refuses `"0"`.

The remaining work is in process-started server fixtures, including
`bench/sqlite-failover/src/unreachable-store.ts` and the inline reservation in
`apps/server/scripts/cloud-integration-fixture.ts`, and tests that must exercise configured ports,
advertised origins or release of a particular listener. Keep those assertions when choosing how
to remove their hand-off window. A port drawn to represent an unreachable peer can also be taken
by another worker after release; changing the HTTP listener does not reserve that peer port.

A1152 applies the bind-time port-zero fixture to the matching in-process `boot*.test.ts`
siblings. The fixture delegates to real Hono, waits for its real listener, and directs requests
to that listener's address. `boot.failed-start.test.ts` retains its configured-port teardown
checks. Explicit configured-port, tunnel-target, advertised-origin and paired landing-listener
cases retain the configured binding, including an unused peer drawn alongside the HTTP port. A907's
existing clock-listener fixture already selects at bind time. None changes production validation.

C88 (#920) reproduced the release-to-bind gap as one way the pause test's single CI failure
could happen; `startS3TestServer` now recovers from it. A sibling scan found two draws in
`promote-endpoint-e2e.test.ts`, but its mirror is bound and closed before the primary draw.
That is not two draws before either bind. The remaining work concerns the release-to-bind
interval, including single draws.

## The spawn-timeout guard compares a bound against the LARGEST SINGLE wait, never the sum

- A case that waits several times can still outlast a bound that
  passes this check. Only reading catches that shape; if it recurs, the answer is probably a runtime
  check rather than a text reader. (Its `packages/` and `apps/` half went with the real-PostgreSQL
  harness; re-extending the scan is worth doing only if suites under those roots start declaring
  long waits again — `CLAUDE.md` §4.)

## What the per-push CI concurrency groups (#384) left open

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

Standing rule: a flaky test is fixed at the root. Eleven UI suites failing to load with
"Vitest failed to find the current suite/runner" after a rebase (2026-09-11); bookings' browser
freeze, never reproduced locally after #291. A third, from #334's validation run (2026-09-12):
the service-status browser suite failed with Playwright's "Frame was detached" during a
whole-workspace run, and then passed on its own with no code change. The original log and screenshot were kept; the cause is unexplained, so retain them
again on the next sighting rather than re-running to green.

## A sixth: a CI shard exited 1 with every test passing (PR #414)

- **The exit-1 path closed by the
  Vitest 4.1.11 upgrade (#437); why the call went unanswered is still open.** Under vitest 3.2.7 one
  worker's `onTaskUpdate` reporting call timed out on birpc's 60-second default. On 4.1.11 an answer
  that never came would leave the shard waiting until the job's 10-minute `timeout-minutes`
  cancelled it, rather than failing it when the run ends. Written up in
  [ci-and-gates.md](../developers/ci-and-gates.md) rather than fixed (owner decision 2026-09-18); keep
  the job log on the next sighting — it is the cheapest evidence there is.


## A throwaway script found six comments that described code that was no longer there, and it is not a guard yet

Written 2026-09-14 during the tenant-column removal. It flags a comment whose
subject has gone from the lines beneath it. It is not usable as it stands: 13 of its 19 hits
were the legitimate shape where a block comment heads a group of members rather than describing
the one line below it. **Next action:** rewrite it as a real root guard with an allowlist for that
header-then-member shape, and its own tests, rather than re-running a scratch script.

## `apps/server/src/boot.mirror.test.ts`'s adoption-pending case no longer has a negative control

The case boots a mirror on an empty database and checks it serves a status surface. Its receipt
used to be a foreign key from `persons` to `tenants` — remove the guard and the boot would die on
it — and #378 removed every foreign key to that table, so nothing now says what
would break if the guard went. The test's own comment says this plainly and claims nothing more.
**Next action:** find a failure the empty database still causes without the guard, and name it;
if there is none, say so in the comment and stop calling the case a guard test.

## Two `health.test.ts` cases … feed a clean pass, so they check less than their titles say

- Two `health.test.ts` cases, "stays 200 when reconcile has failed runs but nothing
  parked" and "does not flip health for a failed-only run (parked stays 0)", feed a clean pass,
  so they check less than their titles say. Test titles left open by #624: "(T12b)" in
  `boot-pending-sweep.test.ts`, "(prove-by-deletion)" in
  `boot.reconcile.test.ts`, "(C2)", "(pre-merge review)", "(I1)" and "skipped a tenant" in
  `health.test.ts`, "the new guard" in `config.test.ts`.

## The v8-ignore reason "never run by `vitest run`" on schema files' extra-config functions was measured false

- #585 took the reason out of
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

`CLAUDE.md` §2 and `docs/developers/ci-and-gates.md` say "Claude
never pushes with `--no-verify`"; the hook's hint (`.husky/pre-push`) says "agents never". Codex
sometimes drives and reads `CLAUDE.md`, so the docs may need "no agent". **Next action:** the owner
decides whether the rule covers every agent, then the two docs follow.

## The shard layout was measured against an engine that is gone

The shard counts and their sizing arguments were all measured against PGlite.
`packages/db`'s ten mutation shards have since been timed on SQLite: 5m00s to 11m41s on run
38206876422 and 2.9 to 12.2 minutes on run 38241392066 (shard 10 the longest both times), and
`mutation.yml`'s comment above `mutation-db` says ten may now be more than the work needs. The count
has not been re-cut from those times. No local command produces the numbers, so re-cutting it has
to wait for a real run.



## `packages/ui/src/vitest-park-pointer.ts` is mutated and has no tests

It is test-only plumbing
the Vitest config loads — the same class as `src/test-helpers.ts` and `src/a11y-helpers.ts`, which
`packages/ui/stryker.config.json` excludes from `mutate`. Adding a third exclusion is the consistent
move and also shrinks the denominator `mutation-ui-aggregate`'s bar of 90 is measured against.
Owner's call. `packages/ui/src/vitest-pointer-gestures.ts` (A720 Part 4) is in the same position:
in `packages/ui`'s coverage and `mutate` lists, loaded only by `packages/venue-service`'s Vitest
config, so no ui test reaches it. Excluding it also needs a change to the exclusion list
`scripts/mutation-shard.test.mjs` pins.

## A pull request that changes only front-end code gets no SPA bundle built anywhere in CI

  `bundle-smoke` builds esbuild bundles only. The only thing that runs `vite build` is
  `deploy/Dockerfile`, which the `image` job runs — on a pull request only when an image input has
  changed (`.github/workflows/ci.yml`, the `image` job's `if`), and on every main push; it never
  OPENS one, so a bundle that builds and renders nothing passes there too. This is the work item
  `CLAUDE.md` §2 and `docs/developers/ci-and-gates.md` point at.

## P7's leftovers (#533)

- `no-tenant-column`'s SQL check still passed with one set's SQL dropped,
  because it checks for an absence and the remaining files clear its floor of eight.
  `module-graph-honesty`, `schema-constraints` and `packages/db/src/classification.test.ts` still
  read a set's SQL their own way — the top of the `drizzle` folder only, and `module-graph-honesty`
  unsorted — rather than through `migrationSqlFiles`, which walks subfolders (no set has SQL in a
  subfolder today). `journal-monotonic` parses `_journal.json` itself rather than sharing
  `headSnapshot`'s reader.

## The dev launcher looks for `trading.env` only in the state folder `apps/server/.env` names

Seen during #1320's look (2026-10-07, not checked against `main`): after the onboarding wizard
provisions, the stack started by `wa-wt onboarding <worktree>` restarted into setup mode, because
the dev launcher (`apps/server/scripts/dev-server.mjs`) looked for `trading.env` only in the state
folder `apps/server/.env` names, not the one `wa-wt` passes; the look worked round it with links. #1322's
look (2026-10-07, a Barcelona demo) met the same restart.

## Cross-app links in the split Vite dev stack

The deployed server serves both
apps on one origin, but the dev stack runs the till on port 5190 and the dashboard on 5191. A
request for `/manage/devices` on 5190 returned the till HTML, while the same path on 5191 returned
the dashboard HTML (measured 2026-10-03 with `curl`). Make cross-app links reach the other dev
server without changing their deployed same-origin paths; this also affects setup's existing links.

## At a load average near 60, more root guard files fail on time

2026-10-22: A994 adds a root worker limit calculated from startup processor and memory headroom.
Its simultaneous-root-suite experiment is described in
[CI and gates](../developers/ci-and-gates.md#root-workers-start-from-available-headroom).
The historical experiment also adds eight spinning loops; repeat that workload before
closing this entry.

Three root projects at once (`pnpm vitest run`, one with `--coverage`) and eight shell
loops that only spin.

Receipts in lane B's campaign folder,
`a751-receipts/heavy3/` (before A751) and `a751-receipts/verify-heavy3/` (A751's branch,
`425cf16b8`).

The retained failures name `scripts/fiscal-allocation-migration.test.ts`,
`scripts/guarded-teardowns.test.ts`, `scripts/menu-sections-upgrade.test.ts`,
`scripts/mutation-shard.test.mjs` and `scripts/pre-push.test.mjs`.
Each needs the same treatment A751 gave its own four files: what the bound waits for, its worst case under
this load with the bound lifted, and whether the case can be made cheaper.

### A668-5 normal-push recurrence, 2026-10-16

2026-10-22: A994 reproduces the diagnostic failure cold and starts that fixture after self refresh,
retaining its Docker, error, signal and 700 ms assertions. Its root worker estimate and concurrent
validation are recorded in [CI and gates](../developers/ci-and-gates.md#root-workers-start-from-available-headroom).

2026-10-17: A770 (#1816, `d2f9bc3de08c2a3c0d2284a03efcc342319809a1`) reproduced
paused-thread failures in the step-watch cases and changed their budgets, retaining their phase
checks. The installer, menu-upgrade and mutation-fixture failures retain their separate investigations.

Retain the full-suite workload when investigating the menu-upgrade failure; for the installer case, separate
the preparation before Docker from the deliberately hung command before deciding what its
700 ms budget should measure. Lane G retains both full logs and the process/open-file/memory
snapshots under its A668-5 receipts.

The moving-phases case in `scripts/step-watch.test.mjs` rejected against its no-progress
limit; the diagnostic-matching case raised `TypeError: object null is not iterable`.
Investigate the monitor's observed phase timing and its
missing diagnostic match separately from the mutation fixture's elapsed-time limit. The new
failure log is `push-final-attempt.log` in Lane G's A668-5 receipts.

## Switching the till's language mid-screen with `setLocale` left no error banner in some browser tests.

The park, place and fire-all clock cases (A798-B slice 8, Task 13b) failed that way and
were changed to start the till in the language instead; the table-service and parties cases
switch mid-screen and pass. Not diagnosed: a test-harness effect, or a refusal a language change
hides. Left open by A798-B slice 8 (#2012).

## Decisions and deliberate limits

- **The floor suites' fixed till-API clock keeps the system clock's time-zone offset (A1117,
  #2100).** `{ ...v.clock, now: () => ({ ...v.clock.now(), instant: NOW }) }` changes only the
  instant, so on the review machine it reported an offset of 60 minutes where Madrid on 10 October
  is 120. The floor code these suites reach reads the instant only, and none of them writes a fiscal
  record through the API; `floor-today-mark-moved` and `floor-catch-up` built their clocks the same
  way before. If one of these suites starts recording a sale through the API, give its clock the
  offset of its fixed instant.

- **Upgrade-test work budget follows the migration count (A489, 2026-10-11) and counts the walk's
  own processor time (A751, 2026-10-16).** The captured 110.242-second walk exceeded the old fixed
  deadline near its final step. Keep the workload budget and remeasure it when a new reset changes
  the cost of rebuilding the baseline. A walk with no phase start or finish for 120 s fails;
  Vitest's 1,800 s bound is a backstop above CI's eight-minute `root-guards` limit.
  [Receipt](../developers/ci-and-gates.md#the-upgrade-deadline-grows-with-the-walk),
  [processor time](../developers/ci-and-gates.md#the-upgrade-budget-counts-the-walks-own-processor-time).

- **Job-sharding levers:** `--shard` splits by FILE COUNT, except in `apps/server`, whose shards are
  packed by measured duration since A938
  ([how](../developers/ci-and-gates.md#the-servers-shards-sixteen-packed-by-measured-duration)); bump `shard: [1..N]` and the denominator
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

- **`packages/db`'s mutation gate runs only overnight, and that lag is accepted** (owner,
  2026-10-17). The gate lives in `.github/workflows/mutation.yml`, which runs nightly or by hand,
  so a pull request that thins a `packages/db` test merges green and the score drops the next
  night. No cheaper per-pull-request signal is wanted; `ui` and `ui-core` work the same way, and
  [ci-and-gates.md](../developers/ci-and-gates.md#mutation-floors-and-where-each-one-actually-bites) says
  so where a reader meets the gate.

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

The phone-width helper now attaches a geometry and font snapshot to the original failed
assertion, without changing its check or wait. Next: use that snapshot and
the existing failure screenshot to distinguish a wide scrolling box, delayed layout and missing
resize delivery before changing the screen or its test.

## Identify which pnpm setup command failed

A746 gives healthy version checks the installer's normal allowance and retains a controlled
slow-check regression. The original intermittent A737 hook retry was not reproduced. The setup
script reports the same `attempt N of 3 failed or stalled: npm install` line whether installation
or the version check failed, so stderr alone may not distinguish them. On recurrence, retain
separate statuses and timings for both commands before assigning the cause. The controlled
short-limit measurement is in [the CI guide](../developers/ci-and-gates.md#give-a-healthy-version-check-its-normal-allowance).

On 2026-10-28, main run [40644939856](https://github.com/clintongormley/waitron/actions/runs/40644939856)
reported workforce job `122671628160` in `Set up pnpm` from `06:37:54Z` through repeated
API snapshots. At the cancellation request that step had lasted 438 seconds; the same step in
successful run `40626865577` lasted two seconds. Normal cancellation left that job active while
other jobs finished cancelling. After force-cancellation, the run and job completed as cancelled.
`gh run view 40644939856 --job 122671628160 --log` then answered `log not found: 122671628160`;
the job-log REST endpoint returned HTTP 404. Recover runner-side evidence and distinguish a running
command from stale runner reporting before changing the installer, retry limits or job deadline.
The cause is unverified. Lane F retains the snapshots in `receipts/a976-media-localized-20261028/`.
At the watcher's request, `gh run rerun 40644939856 --job 122671628160` started one second sample
on the same commit. Job `122690326840` completed setup in two seconds on its first attempt and
passed the workforce suite and coverage checks. The overrun did not recur in that sample; this
does not diagnose the first attempt or demonstrate a repair. If a step again outlives its own
five-minute limit, retain the recurrence before changing any command deadline.

## The step-watch guard received an undefined held-thread result

On 2026-10-16, A737 Part 2's normal push at `877d14981`, rebased onto A751's
`39d07827e`, ran `pnpm vitest run --coverage`. The failing case was
`scripts/step-watch.test.mjs`'s "reports the phase a synchronous call holds the thread in,
from another thread, counting from the last phase event". At line 557,
`expect(seenWhileHeld).toMatch(...)` received undefined. Its callback assigns that value
inside the held database call; the retained output does not explain why it was absent.

Raw logs remain in Lane F's local
`receipts/a737-after-a751/push.log` and `step-watch-focused.log`.

2026-10-17: A770 landed in [#1816](https://github.com/clintongormley/waitron/pull/1816),
`d2f9bc3de08c2a3c0d2284a03efcc342319809a1`. Its controlled 200 ms thread pause reproduced this
failure, and the revised test limits passed the same pause. The original run's delay remains
unobserved. See [the retained experiment](../developers/ci-and-gates.md#the-upgrade-test-names-the-phase-it-stalled-in).

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

- [#1788](https://github.com/clintongormley/waitron/pull/1788): the captured 165,500/171,000 ms overruns have not been reproduced on the quieter host.
  On recurrence, retain the phase report and host state before retrying; compare repeated samples
  before assigning the variation to CPU scheduling or storage. Since A751 the budget counts the
  walk's own processor time, so a recurrence fails the test when that time passes the budget or no
  phase starts or finishes for 120 s (or, starved further, at CI's eight-minute `root-guards` limit
  with no report). Keep the failure report: a work-budget failure names the processor time used, a
  no-progress failure the wall time.
  [Measurement](../developers/ci-and-gates.md#reducing-repeated-upgrade-test-setup-work-a736)

## `.github/workflows/ci.yml` (about line 283) says the three-shell receipt sits in `.husky/pre-push` beside the same loop; it is not there

- Two reasons #602 deleted and did not restore, for the owner to confirm: the hook bullet at the
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
on a close-driven effect, and for a close followed by a poll of the dialog's `open` and a check on
what the closed screen refuses (A927), and decide whether the popovers need the same treatment.

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

Neither was reproduced or checked on `main`: "edge scroll reaches hidden column choices during a
stationary
reorder" (`packages/ui/src/components/wt-data-table.test.ts`), once in a `packages/ui` coverage
run; and "cancel keeps reassignment selections and target until explicit local Discard"
(`apps/dashboard/src/screens/units-reassignment.unsaved.test.ts`), once in seven runs, then six
passes alone. Neither types a search. **Next action:** reproduce each under load and fix at the
root (standing rule: a flaky test is fixed, never re-run to green).

## A printers-screen test failed once during A435 step 2's review fixes

"a press after one edit sends the edit and the field as it was read"
(`apps/dashboard/src/screens/printers-screen.save-state.test.ts`) failed once in eight runs of the
printers-screen files on 2026-10-10, then passed alone and in the seven later runs; its error was
not captured. It was not reproduced. **Next action:** reproduce it under load and fix at the root.

## A till late-send PIN test failed once, twice in two days (A1126)

"shows a wrong PIN on the app's line when the dialog was closed while it was sent, and asks afresh
next time" (`apps/till/src/till-app-late-send.test.ts`, the manager PIN case expecting "Wrong PIN,
try again") failed once and then passed on reruns, both times in a local combined run. On
2026-10-25 it failed in A797 slice 1's combined run (`pnpm --filter @waitron/till exec vitest run
src/till-app ...`). On 2026-10-26 it failed in A797 slice 3 Task 5a's first full run of
`pnpm --filter @waitron/till exec vitest run src/till-app src/state/bar-tables.test.ts
src/widgets/till-shell.test.ts`, then passed six times: three alone, two with its file, and two
later full runs. The suite runs as a till, where slice 3's bar is a fixed empty list. No cause was
found and the failure output was not kept. **Next action:** reproduce it under load by repeating
the combined run, keep the failure output, name the cause and fix it (standing rule: a flaky test
is fixed at the root, never re-run to green).

## Other `uses:` steps that fetch over the network have no step time limit, and the runner's own action download at job set-up is bounded only by long limits of its own (left open by A935)

2026-10-25 (A1100): artifact uploads now have
[two bounded attempts](../developers/ci-and-gates.md#every-artifact-upload-is-bounded).
The setup-node, cache, Docker and CodeQL steps below still wait on their job limits.

List them with

```sh
grep -n -E '^\s*-?\s*uses: (actions/(setup-node|cache)|docker/|github/codeql-action)' .github/workflows/*.yml
```

On 2026-10-20 none of the `setup-node`, `cache`, `upload-artifact`,
`docker/*` and `codeql-action` steps carried a step `timeout-minutes`; they rely on their job's
limit alone, as checkout did. The set-up download ("Download action repository …") is retried by
the runner, three attempts, each under a 20-minute limit (runner v2.337.0
`src/Runner.Worker/ActionManager.cs` L1647–1658: `retryCount < 3`,
`int timeoutSeconds = 20 * 60;`) — longer than most of our jobs' limits, which run from 5 to 50
minutes (`grep -h -E '^    timeout-minutes:' .github/workflows/*.yml`) — and a step
`timeout-minutes` cannot reach it. Whether the job's own limit covers set-up was not measured.
Receipt for the checkout half:
[ci-and-gates.md](../developers/ci-and-gates.md#every-checkout-is-bounded).

## The invoice PDF test took 162 s on one CI run

`apps/server/src/invoice-pdf.test.ts` took 162 s on run 39068745456, the slowest server file then
(the next was 99 s), so it sets a floor under whichever shard holds it. Over A938's six `main` runs
(39425472781, 39444354037, 39449527877, 39500330558, 39503634628, 39507125783) it took 109 to 172 s,
a median of 144 s. A938's local profile of its slowest test,
without coverage, put 95% of the time under `width()` (`apps/server/src/invoice-page.ts:47`,
`invoiceFont.layout(text).advanceWidth`). For a word that does not fit on the line, `wrap()`
measures a growing string once per character, and the 480-layout test measures the same strings
again each time. The whole file took 10.9 s locally without coverage and 49.6 s with it, about 4.5
times slower. Caching the advance width per string is the untried fix; it may also speed real
invoice rendering. Left open by A801. Receipts:
[A801](../developers/ci-and-gates.md#runners-come-in-two-speeds-and-the-busiest-shard-is-the-one-that-crosses-4-minutes),
[A938](../developers/ci-and-gates.md#the-servers-shards-sixteen-packed-by-measured-duration).


## The bundle CLI's entry predicate can skip a symlink-spelled path

A994's copied CLI returned status 0 without producing output when Node received its macOS
`/var/folders/.../scripts/bundle-node.mjs` path. Returning `realpathSync()` from the fixture helper
made all three real-bundle cases pass. `scripts/bundle-node.mjs:75` compares the argument's file URL
with the resolved module URL; A994 leaves that production predicate unchanged. Check which supported entry paths can use an alias before deciding whether to change this
predicate or other CLI predicates.

The failing and corrected focused commands are retained in lane G's
`receipts/a994-20261022-022554/plain-bundle-mode-green.log` (status-zero CLI with missing files)
and `plain-bundle-mode-green2.log` (15 passed). The copied source bytes were unchanged; only the
fixture command path changed between those probes.


## The UI showcase overflows a phone and inherits black text in its dark panel

At a
390 px viewport, the panels in `packages/ui/index.html` measured 572 px wide before and after
A974's wording cleanup; unstyled dark-panel text resolved to black on `rgb(16, 18, 22)`.
Give the showcase a responsive layout and a foreground colour on each theme root, then open
both themes at 390 px and 1280 px. Keep the price-format examples and demo interactions.


## Whether the 2026-10-20 checkout stalls were a GitHub-side incident was not checked (A935)

In which phase they stalled is unknown: the action passes no `--progress`, so its log is
silent while it waits. On a recurrence, read the bounded checkout's log: a low-speed failure
(`Operation too slow`) means a transfer stall; a step timeout says only that the attempt ran
out of time, not in which phase.

On 27 October, [main run 40555390596](https://github.com/clintongormley/waitron/actions/runs/40555390596)
failed in bookings job `122371062426`. Both checkout attempts logged a running `git fetch`
then "has timed out after 2 minutes", before dependency installation or tests. The log gives
no transfer progress or lower-level network error. The cause of that wait remains unverified;
retain this failure when comparing later runs rather than treating a fresh pass as its diagnosis.

On 28 October, [PR #2202's run 40729880084](https://github.com/clintongormley/waitron/actions/runs/40729880084/job/122963741771)
hit the same two checkout timeouts in `test-server (20)`. Both logs end at `git fetch`,
with no transfer progress or lower-level network error; dependency installation and tests
never ran in that job. The cause remains unverified.

The A1178 diagnosis compared three morning runs with first-checkout medians of 11 to
12.5 seconds and no retries against later run `40723334721`, with a 42.5-second median
and eight retries. Fresh local full-history pack controls grew by 1.49%; they did not reproduce
the hosted timeout. Both CI and licence checkout attempts now emit Git Trace2 JSON events,
and successful checkouts print stored-pack byte counts. See the
[measured diagnosis and its limits](../developers/ci-and-gates.md#checkout-stage-diagnostics-28-october-2026-a1178).
Capture the hosted stage of a recurrence before attributing it to GitHub, the network or local
indexing. A separately measured shallow checkout for jobs that do not read history remains open.

On 28 October, [main run 40750935978, till shard 3](https://github.com/clintongormley/waitron/actions/runs/40750935978/job/123038600113)
exhausted both 120-second attempts with `--depth=1`, before installation or tests. Reducing
full-history transfers does not eliminate this observed shallow-checkout failure mode.


## Profile provisioning's busiest shard after the A679 split

All six shards and merged
coverage pass in run `39380412391`, but shard 1 takes 297 s in Vitest and 330 s overall.
Find the slow files or setup cost before changing its distribution; keep every check and
coverage threshold. This exceeds the approximate four-minute target without reproducing
the former shared light-job timeout.


## Investigate two full-run till browser failures seen during A669 validation

On
2026-10-20, `pnpm --filter @waitron/till test:coverage` reached a missing `Filters 1`
control in `till-find-bill-screen.a11y.test.ts:89`; its failure capture showed three active
filters. After rebasing onto A582 help, Playwright could not
click the split control in `till-app-drafts.test.ts:8160`: the button detached during
scrolling. Retain both captures and reproduce
the saved-view and detached-control paths before changing code or tests; neither cause
is established, and a passing retry is not a repair. Lane G retains the logs and captures
under `resume-a669-land-20261020-090825`.


## Decide whether browser tests stop replacing modules (A943 follow-up)

A spy mock of
the till's pricing module failed once in CI with its cause not found, and #1934 replaced it
with a function the store takes. Its convention reviewer proposed a CLAUDE.md rule against
module mocks in browser tests; #1934 did not add one, because one failure with no known
cause is thin ground for a house rule. The owner decides.


## Check the older capture suites' viewport cleanup (A669-5 review)

`apps/till/src/screens/zone-keep-open-screens.a11y.test.ts` restores 1280×768 instead of its
incoming dimensions. Effects on later cases are unverified. Probe those cases before changing
their cleanup; preserve their current behavioral assertions.


## A902. Say in the testing guide that Vite also prints browser console output under an AI agent

Its section "Vitest hides a passing test's console output under an AI agent" names only
Vitest's reporter. A811 (#1888) found that Vite 8.3.4, when an agent variable such as `AI_AGENT`,
`CLAUDECODE` or `CODEX_THREAD_ID` is set, prints a browser test's `console.error`, `console.warn`,
uncaught errors and unhandled rejections to the terminal, a passing test's included (seen in
`apps/dashboard`, which now sets `server: { forwardConsole: false }`). The other browser packages
(`grep -l browser */*/vitest.config.ts`) still forward. Measure one of them with and without an
agent variable, then add the receipt to the guide, and decide with the owner whether they should
turn forwarding off as the dashboard did.


## A late move or second finger can overtake the gesture hold timer

A delayed move is
treated as a pan, and a delayed second finger misses hold cancellation. Disposable probes
reproduce both on unchanged main `d5230d32d` and A891's candidate. Extend hold recognition
to those paths with their own tests; native-device reproduction remains unverified.
[Detail](../developers/testing-guide.md#a-held-press-can-reach-pointer-up-before-its-hold-timer-runs).


## A891: retain input and timer timing if the missing product-information window recurs

A busy-renderer probe reproduces the original CI symptom, and the gesture now recognizes a
held release before its overdue timer. Main run `39180066136` retained no such trace, so its
exact cause remains unverified. On recurrence, keep pointer timestamps, hold-callback timing,
selection count and the screenshot before retrying.
[Reproduction](../developers/testing-guide.md#a-held-press-can-reach-pointer-up-before-its-hold-timer-runs).


## Other server test files still hash fixed PINs and passwords on every test

A801 moved the
shared fixtures under `apps/server/src/testing/` and the set-up of five heavy test files onto
`fixturePinHash`/`fixturePasswordHash` (`apps/server/src/testing/known-secret-hashes.ts`); other
test files and helpers still call `hashPin`/`hashPassword` directly (`rg -l
'hashPin\(|hashPassword\(' apps/server -g '*.test.ts' -g '**/testing/**'`), among them the
`attendance-*` suites, left alone while lane G's A773-1 was editing them, and the two venue
helpers under `apps/server/scripts/` (`testing/venue.ts`, `demo-seed/testing/provision-venue.ts`).
Move the set-up ones over; leave any test that is about hashing. Left open by A801.


## Tests copy the dashboard shell's link handler instead of calling it

`#onAppLink`
(`apps/dashboard/src/dashboard-app.ts`) has hand-made copies in tests, one of them
`packages/venue-service/src/testing/shell-link-capture.ts` (A719); a change to the real handler
is not seen by them. Export one function from `@waitron/ui` that both the shell and the tests
use. Left open by A719 (#1838).


## A999 residual: retain the other allergy-move failure if it recurs

The original loaded
run reported two failing cases without their names or assertion output. The 2026-10-22
reproduction identified the corrected-guest case, where a parent render restored a cleared
refusal. Capture the exact case and output on any further recurrence before attributing it
to the same mechanism. [Receipt](../developers/conventions-ui.md#a-parent-render-must-not-restore-a-corrected-request-refusal).


## `scripts/spawn-timeout-budget.test.ts` never judges `scripts/ci-workflow.test.mjs` or `scripts/migration-upgrade.test.ts`

Its `budgets()` returns `unreadable: true` for both, on
`main` (`b81f1481c`) as on A751's branch, so a wait in either that outgrows its bound passes it.
Measured by calling `budgets()` on each file's text; which construct it cannot resolve was not
traced.


## Loose ends left by the comment-pruning pull requests (#559 to #624)

- Two `health.test.ts` cases … feed a clean pass, so they check less than their titles say
  (#624).
  [Detail](#two-healthtestts-cases--feed-a-clean-pass-so-they-check-less-than-their-titles-say)
- `.github/workflows/ci.yml` (about line 283) says the three-shell receipt sits in
  `.husky/pre-push` beside the same loop; it is not there (#602).
  [Detail](#githubworkflowsciyml-about-line-283-says-the-three-shell-receipt-sits-in-huskypre-push-beside-the-same-loop-it-is-not-there)
- The v8-ignore reason "never run by `vitest run`" on schema files' extra-config functions was
  measured false (#562, #585).
  [Detail](#the-v8-ignore-reason-never-run-by-vitest-run-on-schema-files-extra-config-functions-was-measured-false)
- The `schema-conformance.test.ts` headers of `payments`, `workforce`, `media` and
  `workforce-es` say an unnamed unique constraint reaches the factory's refusal; drizzle-orm
  0.45.2 names an unnamed `unique()` itself, so nothing reaches it
  (`packages/db/src/testing/schema-conformance.ts`) (#559).
- In `packages/db/src/change-log.test.ts` the case under "THIS CASE NO LONGER SEPARATES
  ANYTHING" repeats the first case under another name (a test change, not a comment one; #589).
- The printing error test overstates its import requirement, and profile-store setup keeps a
  session across per-test resets (#588; the canvas-store test itself is retired).
  [Detail](#printing-error-test-wording-and-profile-store-session-setup)


## `packages/db`'s static mutants are not in its mutation score

Left open by A539.
`"ignoreStatic": true` in `packages/db/stryker.config.json` leaves out every mutant in code that
runs when a module loads (322 `Ignored` on run 38256003987, 229 of them in
`src/classification.ts`). Stryker runs every test for each static mutant; what measuring them
would cost has not been timed. Owner's call.


## `mutation.yml` repeats one shard-and-merge job pair three times

Left open by A841 slice 1, #1927.
`mutation-ui-core`, `mutation-ui` and `mutation-db` each have their own copied
shard job and `-aggregate` job; one reusable workflow would hold them. The root mutation guards
also repeat the list of sharded packages. Do it on its own branch.
[Detail](#packagesuisrcvitest-park-pointerts-is-mutated-and-has-no-tests)


## `scripts/changed-packages.mjs runnable` runs before the tests in many packages' jobs, fed from a pipe, so the selection guard does not count it and a change to it alone runs none of those jobs

Listing it against every member those jobs test would send every change to it through all of them
— the owner's call. Left open by SQLite slice 2 Task 10 (#652, the loop test against a real
S3-compatible server).


## Loose ends left by SQLite slice 1 (#490 and the preparation tasks)

- Every `maxWorkers: 1` config whose comment gives the coverage reason, apart from `payments`,
  which carries its own measurement, still says the pin is needed without having measured it; the
  same one-worker-against-several coverage comparison would settle each.
- P7's leftovers (#533).
  [Detail](#p7s-leftovers-533)
- A few suites still build engine-shaped refusals by hand rather than through `refusalError`
  (`packages/db/src/testing/refusals.ts`, P10, #527), among them
  `packages/provisioning/src/cli.test.ts` and `packages/scheduler/src/store.concurrency.test.ts`.


## Task 2's review found no test that fails when `device_profile_admission_roles` or `device_profile_admission_persons` is left out of `apps/server/src/testing/clear-provision-fixture.ts`

Read, not run: both tables' keys into
`device_profiles` cascade on delete (identity `0007_profile_admission.sql`). Left open by W97
(#1311).


## The relocated independent department preview needs a load investigation

The retired
`receipts-screen.defaults.test.ts` case failed once during A463 and was not reproduced.
A493 moves this behavior into the department receipt editor's language-independent preview cases
(`apps/dashboard/src/screens/department-receipt-editor.preview.test.ts`).
Reproduce that flow under load before assigning a cause; its retirement does not establish
that the original failure is fixed.


## drizzle-kit 0.31.11 left out `ON DELETE` when it generated an `ALTER TABLE … ADD … REFERENCES` on this engine, while its snapshot kept it

The schema-conformance suite compares declared
delete rules with the migrated database for the sets that opt in; [A812's deletion
experiment](../developers/testing-guide.md#a-missing-delete-rule-fails-the-schema-comparison) caught
one omitted rule. The generator omission was observed once by an implementer (five store tests
failed with a foreign-key refusal), not independently re-run. Left open by A429 slice 1 (#1493).

## The till shard's blocked operation is unknown (A1027)

Main run `39898823017` at `c76bcdaf3` lost the log for `test-till (2)`, job
`120235613840`; both the CLI and jobs-logs API could not retrieve it. The job
started at 04:29:59Z and ended cancelled at 04:44:59Z, while its configuration
named a ten-minute limit. Those timestamps do not establish where it waited.
The preceding and following healthy shards do not diagnose the hang.

A1027 adds a diagnostic process deadline with unfinished-file and process reports
to every browser package's test command. The original wait remains unlocated.
On recurrence, retain the failed step log and use its file list and process state
to identify the blocked operation. Keep the venue-service startup investigation
and A419's dashboard stall separate; no shared cause is established.

## A1089 merge read-back: server coverage upload timed out

Run `40222796480`, job `121257963434`, completed its tests but failed creating `server-blob-4` with `ETIMEDOUT`. Preserve the failed upload log and investigate bounded upload recovery separately; the underlying network/service cause is unknown and merged server coverage is unqualified.

## Local multi-file till browser interruption

A local run on 26 October produced no completed-file report before it was stopped, with
`src/till-app.theme.test.ts`, `src/widgets/basket.adjustments.test.ts`,
`src/till-app-parties.test.ts` and `src/till-app-counter-adjustments.test.ts` selected.
It was stopped after five minutes, with the source tests still unchanged. The cause
is unknown. The theme suite completed alone; the serial diagnostic command adds
`--maxWorkers=1 --reporter=verbose --reporter=../../scripts/vitest-file-progress.mjs`
to `pnpm --filter @waitron/till exec vitest run` with those four paths.

The serial diagnostic completed three files and was still reporting passing cases
in the larger parties suite when its four-minute outer deadline stopped it. That
run establishes no serial stall.

A standalone `src/till-app-parties.test.ts` run also reaches the local outer
deadline. Capture per-case progress and the pending browser operation for this
path too; no common cause with the multi-file interruption is established.

Capture the concurrent path's per-case and file progress, pending browser operation
and process tree on recurrence, under `scripts/run-with-deadline.mjs`. Keep that
qualification separate from a serial pass; neither a cause nor a repair has been
established.

## Coverage download actions and refused response bodies

The A1132 local probe reproduced an open 503 response keeping `actions/download-artifact@v8`
alive after its retry had finished all downloads. The server merge uses the response-closing
helper; other merge jobs still use that action. Audit those jobs separately and qualify their
report naming and coverage merge before adopting the helper. Preserve their bounded retry and
cleanup rules. The original main runner's socket state was not captured; the link to that
historical timeout remains an inference. See [the developer receipt](../developers/ci-and-gates.md#a-completed-transfer-can-still-leave-the-download-action-alive).

## One failing success-branch check in the first-fiscal-setup end-to-end file ends its worker

In `apps/server/src/first-fiscal-setup.e2e.test.ts`, a failure inside a row's success branch makes
the Vitest worker exit ("Worker exited unexpectedly"), so the later rows never run and the run
reports one failure (it still exits 1). Reproduced on `27ae35c09` by breaking the existing
tax-number check, during A980 S1a2. Cause not found.
