# CI, tests and developer tooling — detail

The open entries are listed in [the backlog](../backlog.md), under "CI, tests and developer tooling". This file holds
their full text.

## Three adjustment-portion refusal checks also pass with shortened ID lists

A974's 5 November 2026 naming review observed that three cases in
`apps/server/src/order-portions.adjustments.test.ts` still pass after their request is shortened:

- The two "two croquetas from two rounds" cases (one kitchen note, one course) still pass when
  `lineIds` contains only the first croquette ID.
- The "a cancel naming portions of two different rows" case still passes when its list contains
  only the burger ID.

The driver repeated those three mutations together in the disposable review checkout:
`pnpm --filter @waitron/server exec vitest run src/order-portions.adjustments.test.ts -t 'two croquetas from two rounds|a cancel naming portions of two different rows'`
reported three passes. Source was restored exactly. This does not establish why the shortened
requests are refused. Removing `lineIds` failed the reviewer's checks; replacing the cancel's
croquette ID with the second burger ID also failed. Keep the existing refusal and unchanged-row
assertions, and add accepting controls that distinguish the intended note/course/mixed-row
condition from another invalid-request condition before changing these cases. No production
fault was established by these probes.

Current command after A976’s staff-sample rename (2026-11-09):
`pnpm --filter @waitron/server exec vitest run src/order-portions.adjustments.test.ts -t 'two croquettes from two rounds|a cancel naming portions of two different rows'`
The dated experiment above retains its original titles and command.

## A backlog detail link still names the old five-handler heading

The till entry’s
`backlog/till.md#five-till-handlers-still-leave-a-failed-list-refresh-unhandled-and-one-a11y-file-may-not-render-its-screen`
no longer matches “Three till handlers still leave a failed list refresh unhandled”.
Retarget the link during the till backlog cleanup; keep the open handlers entry.

One other index link needs the same cleanup:
the payments link still names “The card refund path records only after the provider call,
with a fresh key each time”, while its detail now says “The reconciler's card reversal records
only after the provider call, with a fresh key each time”. Retarget it without changing
its open work, then check the index's local heading links.

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

## `apps/server/src/rejoin-command.test.ts`'s sidecar assertions do not test the wipe

The
fixture closes the handles first, which removes the sidecars. The wipe's sidecar removal is
pinned by `apps/server/src/db-wipe.test.ts`; what is missing is a rejoin-level case with sidecars
on disk. Left open by SQLite slice 2 Task 5 (#569, `@waitron/stream`).

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

## What the landing-port fix (A80, PR #740) left open

The remaining work includes in-process setup/recovery suites outside the migrated `boot*`
siblings, such as `setup-tool-download.boot.test.ts`.
Audit each case's origin and listener-release assertions before choosing the bind-time fixture.
The recovery-backup preview suite uses that existing fixture with a competing configured-port
listener; it needs no change to the shared helper.

Cloud’s external `scripts/test-waitron-pairing.mjs:56` stops and relaunches the same saved origin while no process holds its port; retain that socket in Cloud’s runner across restarts (source read, not run).

`bench/sqlite-failover/src/unreachable-store.ts` still releases a port intended to stay unreachable.
Another worker can bind it later. Tests that must exercise configured ports, advertised origins
or release of a particular in-process listener also need their handoff audited; keep those assertions.

A1152 applies the bind-time port-zero fixture to the matching in-process `boot*.test.ts`
siblings. The fixture delegates to real Hono, waits for its real listener, and directs requests
to that listener's address. `boot.failed-start.test.ts` retains its configured-port teardown
checks. Explicit configured-port, tunnel-target, advertised-origin and paired landing-listener
cases retain the configured binding, including an unused peer drawn alongside the HTTP port. A907's
existing clock-listener fixture already selects at bind time. None changes production validation.

7 November 2026: A951-S removes the retired TCP relay's tunnel-target case. The remaining
configured-binding checks above still apply.

C88 (#920) reproduced the release-to-bind gap as one way the pause test's single CI failure
could happen; `startS3TestServer` now recovers from it.

Keep the shared fixture’s scope explicit when extending it: `ephemeralHttpMock` in
`apps/server/src/testing/ephemeral-listener.ts` rewrites every `serve` port in its default mode,
and `httpPort()` reports the last listener. A synthetic two-listener request reached the second
listener. The converted suites passed 233 cases with listener-call instrumentation.
Paired main/landing listeners retain the configured binding;
do not assume the default fixture can identify the main listener in that shape.

## Archive-settings inline advice must name its available action

An older, separate wording mismatch remains in `apps/dashboard/src/i18n/codes.ts`:
`backup.archive_settings_invalid` tells you to save again on Backups, while the shown action is
**Turn on backups** and you are already on that page. The English wording entered in
[PR #1628](https://github.com/clintongormley/waitron/pull/1628), before #2068, and remains on main.
Align the inline instruction with the available action when reworking this refusal; preserve its
cause and the distinction between a failed write and a successful write whose reload failed.

## Spanish separately installed certificate test checks mapping only

A1251's review of the #2055 test repair found another mapping-only assertion in
`apps/server/src/connection-bootstrap-page.test.ts`, in the separately supplied certificate case.
Restoring the Spanish `operator` installer's referral left all 24 page cases passing, both in the
reviewer's checkout and the driver's independent control on the repaired test. Restoring the
current wording also passes all 24. Run
`pnpm --filter @waitron/server exec vitest run src/connection-bootstrap-page.test.ts`.

The old wording came from #1929 and was replaced by #2064; #2055 changed only `failed`. Keep this
follow-up separate from the #2055 repair. Add independent Spanish checks for the HTTPS address
choice, stopping on a certificate warning, the page's replacement limit and absence of a referral.
Retain the existing locale-mapping, local Stop and no-write assertions. This is a test gap; the
control does not establish a defect in the current certificate workflow.

## A1251: qualify artifact-upload retries after a step timeout

Before treating artifact-upload retries as qualified for stalled connections, run a bounded
hosted probe whose first attempt reaches its step time limit. Observe the first attempt's
recorded outcome and whether the failure-only retry runs. Check recovery from an interrupted
upload separately, including replacement of an artifact left by that attempt.

The retrospective review of [PR #2069](https://github.com/clintongormley/waitron/pull/2069)
left both paths unverified. Its existing
[collision probe](../developers/ci-and-gates.md#every-artifact-upload-is-bounded) recovered from
a duplicate name after a complete upload. Neither that result nor the workflow text checks
establishes recovery after a timeout, cancellation or interruption. Preserve the distinction
when reporting the next experiment.

## A1251: reject conditional error tolerance in artifact-download guards

The download scanner in `scripts/ci-workflow.test.mjs` rejects literal `true` for
`continue-on-error` on the cleanup and retry steps, but accepts other strings. An expression
such as `${{ true }}` therefore passes that check. Refuse unsupported error-tolerance
expressions on both steps, retaining controls for legitimate absent and literal `false` values.

The #2069 retrospective found this in the older download guard, introduced by
[PR #2017](https://github.com/clintongormley/waitron/pull/2017). On 31 October 2026, executing
the current scanner functions over the current nightly workflow accepted an in-memory copy
whose first download retry gained `continue-on-error: ${{ true }}`. The same copy with literal
`true` was refused; the intact workflow passed. That experiment changed no workflow on disk.
It demonstrates a gap in the scanner, not a failing download in the current workflow.

## What the per-push CI concurrency groups (#384) left open

- **No run has exercised the `hold` answer** — an older run publishing after a newer one — which
  needs two merges close enough together to overlap and is not worth forcing.
- **Two states stop publishing until a person intervenes:** a `:main` carrying no
  `WAITRON_BUILD_ID`, and one built from a commit GitHub's comparison cannot place against the
  commit being published. Both wedge every later publish, the `sha-` tags included (read from
  `.github/workflows/ci.yml`, not run: the guard's step fails and the publish steps after it have
  no `if:`). A rewritten history reaches the second state whenever GitHub refuses the comparison:
  no common ancestor, or an old tip it no longer holds
  ([dated probes](../developers/ci-and-gates.md#separated-pushes-overlap-so-publishing-asks-before-it-takes-main)). The repair is
  to delete or retag `:main` by hand. Nothing alerts on it.
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

## Server shard 2 stalled once on a hosted runner (PR #2664, 2026-11-09)

Run [42690313010](https://github.com/clintongormley/waitron/actions/runs/42690313010), job
`test-server` shard 2, on a GitHub-hosted ubuntu-26.04 runner: two database-open hooks
(`boot.place-copy.test.ts`, `till-api.table-actions.test.ts`) hit "Hook timed out in 60000ms", and
`first-fiscal-boot.test.ts`'s "real HTTPS claim readiness … trading interruption restarts a separate
process" timed out at 120 s, with two sibling cases failing after it. The same server code had
passed that shard on the run before; the re-run of the failed job passed. No earlier sighting was
searched for beyond this file. The full log is kept at
`~/waitron-campaign-l/ci-logs/pr2664-run42690313010-test-server-2.log`. On the next sighting keep
that log too and locate what the hooks were waiting on before changing a deadline.

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

The shard counts and their sizing arguments were all measured against PGlite. On SQLite, the
nightly runs of 2026-10-31 to 2026-11-02 (41171151689, 41275572381, 41392057587) show
`packages/db`'s three `src/schema/sales.ts` ranges, each in a shard of its own because of
`HEAVY_FILES`, taking 29 to 164 s of mutation work, while the other seven shards took 270 to
1,258 s. The whole-file shards are now packed by estimated cost (about 980 s each of ten, by the model in
[ci-and-gates.md](../developers/ci-and-gates.md#dbs-mutation-shards-are-packed-by-estimated-cost)).
**Next action:** drop `sales.ts` from `HEAVY_FILES.db` and let the cost table place it, so every
shard shares the work; check a nightly run afterwards. The `ui` and `ui-core` splits have not been
re-measured.



## `packages/ui/src/vitest-park-pointer.ts` is mutated and has no tests

It is test-only plumbing
the Vitest config loads — the same class as `src/test-helpers.ts` and `src/a11y-helpers.ts`, which
`packages/ui/stryker.config.json` excludes from `mutate`. Adding a third exclusion is the consistent
move and also shrinks the denominator `mutation-ui-aggregate`'s bar of 90 is measured against.
Owner's call. `packages/ui/src/vitest-pointer-gestures.ts` (A720 Part 4) is in the same position:
in `packages/ui`'s coverage and `mutate` lists, loaded only by `packages/venue-service`'s Vitest
config, so no ui test reaches it. Excluding it also needs a change to the exclusion list
`scripts/mutation-shard.test.mjs` pins.

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
`scripts/mutation-shard.test.mjs` and `scripts/pre-push.test.mjs`. (2026-11-07, A1422: the first and
third were deleted with the frozen migration history, so three remain.)
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

## IPP timing fixture completion after its wait fails

A1251’s review of the #2092 cleanup repair observed no print outcome for the 2100 ms reply
case before the rest of the suite finished. A driver probe observed the same absence on the
repair’s parent, while both ordinary reply variants logged their outcomes. Check whether the
fixture must abort and await that call during teardown. Those runs did not establish whether it
sends any further requests after the fake printer closes or retains a live resource; do not
infer either from the missing outcome alone.

## A1398-2: slow browser test files

Keep the four-minute goal open after the selected draft autosave waits are advanced.
The watcher's initial 2026-11-11 16:38 cut targeted the drafts file in till shard 1 only.
The coverage-on baseline run 43034947887 recorded shard 1 at 266 s, shard 2 at
253 s (215 s of tests), and shard 5 at 250 s (59 s installing dependencies).
The watcher's 2026-11-11 21:23 cut shortens only the menu test mount helper's
loading poll, keeping the selector, timeout and every case. Compare its paired
coverage-on file measurements in the pull request before attributing a saving.
The watcher's 2026-11-11 23:38 cut shortens the disclosure duration only in the
36 static product-editor phone-layout fixtures, keeping animation settlement and
every geometry assertion. The watcher’s 2026-11-12 01:03 cut removes only the two
save-only screenshot calls from product-list’s alignment and root-controls matrices,
keeping every row, frame wait and assertion. The watcher’s 2026-11-12 03:30 cut
removes the Menus structure matrix’s six save-only captures per row, retaining
settleStructure, both animation frames, and every row, action and assertion.
The printer pick-up-role matrix runs without its two save-only captures, keeping
every interaction, flush, geometry and accessibility assertion. The shared axe helper stays unchanged; reducing unused result detail did not justify a shared change.
Dashboard packing uses refreshed complete-run file durations. Measure the current-head
coverage-on whole jobs before claiming a speed gain or the four-minute goal; any
remaining product-editor, product-list or menu cut still needs a demonstrated cause.
The till’s warm-cache `cpu-features` rebuild remains the next diagnostic target;
its install time still needs a root-cause fix.
Judge the first cut by drafts' own file time in its PR run; do not compare coverage-off
PR timings with those coverage-on timings as a measured speed gain. Bring the next
cause and its measurement to the watcher before splitting files or changing capacity.

## Bundle A1398: Pack the other packages' test shards by measured time

1 conditional entry. Add an inventory of run test files only if a same-count wrong-files case is
ever seen. For later packing comparisons, use qualified runs with one coverage mode; never mix
runs from before and after A1427.
Db, provisioning, venue-service and fiscal-verifactu keep the file-count split because their
measured shards are inside the four-minute target; revisit a package when a job passes about four minutes.

## Bundle: Get ready for A1308's history rewrite (A1306 and CI's concurrency groups)

2 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06),
except A1306's timing and the guard's corrected sentences (2026-11-07). The owner kept A1306 as the last step of A1308 (2026-11-06), so Task 19 of
[A760's plan](../superpowers/plans/2026-11-04-a760-squash-into-eight-sets.md) did not run in A760's
freeze. A760 part 3 corrected the guard's two wrong sentences.

- **A1306. Rewrite git history to drop the development artifacts** (owner, 2026-11-02: "there is
  no point in keeping these development artifacts as history"). Rewrite `main` with them removed,
  at a moment when the lanes are paused, as the last step of A1308 (owner, 2026-11-06).
  [Detail](ci.md#a1306-rewrite-git-history-to-drop-the-development-artifacts).
- **What the per-push CI concurrency groups (#384) left open:** two states stop publishing until a
  person intervenes; the repair is to delete or retag `:main` by hand. Nothing alerts on it. [Detail](ci.md#what-the-per-push-ci-concurrency-groups-384-left-open)

## Bundle: One repeated-run rig, then each named test

7 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06),
except the last, added on 2026-11-07.

- **A local four-file till browser run ended without a completed-file report.**
  Capture per-case and file progress plus a process snapshot on recurrence; a serial pass does
  not qualify the concurrent path. The standalone parties suite also reaches its local
  deadline; the cause is unknown. [Detail](ci.md#local-multi-file-till-browser-interruption).
- **Investigate two full-run till browser failures seen during A669 validation.**
  [Detail](ci.md#investigate-two-full-run-till-browser-failures-seen-during-a669-validation).
- **The payments test "refreshes only active reader statuses" failed once locally beside another
  coverage run**, then passed five times alone and in CI; not investigated. Left open by W100
  (#1332).
- **Two browser tests failed once each during A454's work (search everywhere), and neither was reproduced or checked on `main`**
  [Detail](ci.md#two-browser-tests-failed-once-each-during-a454s-work).
- **The relocated independent department preview needs a load investigation.**
  [Detail](ci.md#the-relocated-independent-department-preview-needs-a-load-investigation).
- **A printers-screen test failed once during A435 step 2's review fixes and was not reproduced**
  [Detail](ci.md#a-printers-screen-test-failed-once-during-a435-step-2s-review-fixes).
- **`apps/server/src/fiscal-certificate-diagnosis-process.test.ts`, "resolves only after its exact
  child exits…", failed once in 15 runs on a busy machine** (2026-11-07). The test's
  `cleanupMs = 200` gives a child 150 ms to exit after its result. Fix in the test (a larger budget,
  or a child that exits once its result is flushed), to be proved by a reproduction that delays the
  child's exit.


## Bundle: Replace 14 "if it happens again" entries with one table in `docs/backlog/ci

14 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Find why GitHub created no workflows for A987's main merge (A1022).** The runs API
  returned no runs for `e7ce92a7c`; the cause remains unverified. Recovery and the successful-CI
  baseline do not explain the missing trigger. Retain the after-merge run check.
  [Recovery procedure](../developers/ci-and-gates.md#recover-a-main-commit-whose-ci-run-was-never-created).
- **A891: retain input and timer timing if the missing product-information window recurs.**
  [Detail](ci.md#a891-retain-input-and-timer-timing-if-the-missing-product-information-window-recurs).
- **A999 residual: retain the other allergy-move failure if it recurs.**
  [Detail](ci.md#a999-residual-retain-the-other-allergy-move-failure-if-it-recurs).
- **Explain the two older silent pnpm setup stalls.**
  Both lacked command progress reports; replacing the initial Node read does not establish their cause.
  [Detail](ci.md#explain-the-two-older-silent-pnpm-setup-stalls).
- **The step-watch case's A544 pre-push failure is fixed at a likely cause, not a confirmed one.**
  [Detail](ci.md#the-step-watch-cases-a544-pre-push-failure-is-fixed-at-a-likely-cause-not-a-confirmed-one).
- **A1230 residual: dashboard shard 1's blocked operation is unknown.**
  Retain the next failing log's selected-file case/hook events and Playwright API log;
  use them to locate the pending operation before changing test or product behavior.
  A1305 owns the later shard-4 deadline with `device-profiles-screen.clock.test.ts` unfinished;
  its cause is also unconfirmed and its complete log is retained.
  [Detail](ci.md#a1230-dashboard-shard-1s-blocked-operation-is-unknown).
- **A1305 residual: the dashboard page blocked during a click, and what blocked it is unknown.**
  On `device-profiles-screen.clock.test.ts`, a switch click never completed and the log shows no
  later call naming an element that file clicks, which fits a blocked main thread. At the next
  stall of a file silent for 60 seconds past its time limits, read the reporter's `[file-progress] stack:` lines before changing test or product behaviour.
  [Detail](ci.md#a1305-the-dashboard-page-blocked-during-a-click-and-what-blocked-it-is-unknown).
- **A1027 residual: the till shard's blocked operation is unknown.**
  [Detail](ci.md#the-till-shards-blocked-operation-is-unknown-a1027).
- **Venue-service browser startup remains unexplained (#1557).**
  [Detail](ci.md#venue-service-browser-startup-remains-unexplained-1557).
- **A419 dashboard CI stall remains unexplained (#1474).**
  [Detail](ci.md#a419-dashboard-ci-stall-remains-unexplained-1474).
- **The stream pause test's frozen-bucket control failed once in CI (PR #1101, run 37108993254 attempt 1, job 111163230954, 2026-10-03; passed on re-run).**
  The original one-off race has not been reproduced locally.
  [Detail](ci.md#the-stream-pause-tests-frozen-bucket-control-failed-once-in-ci).
- **Three unexplained incidents, each seen once or twice; on recurrence retain the log before retrying**
  [Detail](ci.md#three-unexplained-incidents-each-seen-once-or-twice-on-recurrence-retain-the-log-before-retrying).
- **The unexplained dashboard heading-order failure remains open** after #350. The
  `dashboard-app.a11y.test.ts` heading-order sighting is a different rule with no colour evidence,
  so nothing here explains it — treat it as still unexplained.
- **A sixth: a CI shard exited 1 with every test passing (PR #414) — the exit-1 path closed by the Vitest 4.1.11 upgrade (#437); why the call went unanswered is still open.**
  [Detail](ci.md#a-sixth-a-ci-shard-exited-1-with-every-test-passing-pr-414).

## Bundle: Finish the time limits on CI's network steps

The original entries retain their text from the index (backlog review, 2026-11-06).
A1424's live qualification was added on 7 November 2026.

- **A1424 / A1440: finish qualifying server routing and recovery on real workloads.**
  CI compares server and GitHub `(running + waiting) / slots`, with server ties
  and the owner’s stipulated 20 hosted slots;
  ordinary same-repository jobs are eligible for the measured global pool. Family caps
  have been removed, and routing, recovery, image smoke, the final aggregate and publication stay hosted.
  Image smoke remains hosted until a disposable guest is qualified (watcher, 2026-11-09 08:20);
  both retained failures, runs 42550200310 and 42525659420, stop at the Bluetooth check
  with `dbus_unreachable`. Guest diagnosis remains open.
  The health check chooses hosted while the server queue is stuck, and the independent
  watchdog dispatches trusted-main health recovery for untouched queued PR planners;
  other stuck work is reported without moving runs. PR planner placement remains hosted
  until guest tools and an owned unavailable-label drill qualify it.
  Qualify the idle probe, browser guest
  requirements and current-head coverage/aggregate results.
  The successful stream job in main run 42506794616 applied loopback MTU 1500 and
  `TMPDIR=/dev/shm`; this is that job’s receipt, not a full guest qualification.
  Retain runner identities and unchanged source heads for the unavailable-label and hosted-retry
  drills. Keep the corrected v41 controller; the existing routing job uses the hosted
  approximation above (watcher, 2026-11-09 10:01). A1454 keeps six slots per host (owner,
  2026-11-11; see Decisions and deliberate limits); A1461 reduces run sizes. Per-job
  overflow, the remaining workflows and queue measurements remain open. Lane I reports
  existing-record observations on 15 November; episodic status reads cannot prove the full-day
  no-avoidable-wait target. Never drain other lanes' work for a drill.
  [Procedure and limits](../developers/ci-and-gates.md#disposable-server-test-runners).

- **`scripts/ci-diff-paths.sh` never looks for `gnutimeout` for its `-k` bound** (left open by
  A1310, #2400). On ubuntu-26.04 runners it gets uutils' `timeout`, whose forced kill reaches only
  `gh` itself ([receipt](../developers/ci-and-gates.md#every-pnpm-setup-is-bounded)); whether `gh api`
  starts a child is not checked. A fix also needs a `gnutimeout` stub in `ci-main-recovery.test.mjs`.
- **A1251: reject conditional error tolerance in artifact-download guards.**
  The scanner accepts a retry with `continue-on-error: ${{ true }}` while rejecting literal
  `true`. Add refusal cases and retain legitimate absent/false controls. [Detail](ci.md#a1251-reject-conditional-error-tolerance-in-artifact-download-guards).
- **Other `uses:` steps that fetch over the network have no step time limit, and the runner's own action download at job set-up is bounded only by long limits of its own (left open by A935).**
  Artifact uploads (A1100) and Node setup (A1254) now have bounded retries; the remaining sites are cache, Docker and CodeQL.
  [Detail](ci.md#other-uses-steps-that-fetch-over-the-network-have-no-step-time-limit-and-the-runners-own-action-download-at-job-set-up-is-bounded-only-by-long-limits-of-its-own-left-open-by-a935).
- **CodeQL's `timeout-minutes: 50` rests on the default setup's durations (A488).**
  [Detail](ci.md#codeqls-timeout-minutes-50-rests-on-the-default-setups-durations-a488).
- **Both image jobs still run `docker/setup-buildx-action`**. No action queued.
  [Detail](ci.md#both-image-jobs-still-run-dockersetup-buildx-action).

## Bundle: One small pull request for rule lines

5 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Decide whether browser tests stop replacing modules (A943 follow-up).**
  [Detail](ci.md#decide-whether-browser-tests-stop-replacing-modules-a943-follow-up).
- **`--no-verify`: the docs say "Claude never", the hook says "agents never"** — OWNER'S CALL.
  [Detail](ci.md#--no-verify-the-docs-say-claude-never-the-hook-says-agents-never).
- **The test-shape half of #339's lesson is unwritten.**
  [Detail](ci.md#the-test-shape-half-of-339s-lesson-is-unwritten).
- **A two-transaction concurrency test that starts both sides in sequence is racing itself.**
  Nothing guards the shape; look for it in any new racing test.
- **A trap not yet in `CLAUDE.md`: `pnpm --filter <pkg> test <file> -t "name"` silently drops the
  `-t` and runs the whole file**; only a bare `--` before it passes it through. **Next action:** add
  it to `CLAUDE.md` §2's trap list, through the normal pull request flow.

## Bundle: Add a control to each check that cannot fail

4 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Three adjustment-portion refusal checks also pass with shortened ID lists.** Qualify the
  intended mixed-row, note and course refusals with accepting controls, without weakening the
  existing error-code and unchanged-row assertions.
  [Detail](ci.md#three-adjustment-portion-refusal-checks-also-pass-with-shortened-id-lists).
- **Spanish separately installed certificate guidance is checked only against its translation.**
  Add an independent check for address checking, stopping on a certificate warning and the page's
  replacement limit. The earlier Spanish installer referral passes the whole current page suite.
  [Observed control](ci.md#spanish-separately-installed-certificate-test-checks-mapping-only).
- **Two setup-app checks for an absent error message cannot fail** (left open by A1176).
  Read the form errors too, as `shown()` in `setup-app-held-refusals.test.ts` does, and
  prove each check by injecting the message.
  [Detail](ci.md#two-setup-app-checks-for-an-absent-error-message-cannot-fail-left-open-by-a1176).
- **`apps/server/src/boot.mirror.test.ts`'s adoption-pending case no longer has a negative control.**
  [Detail](ci.md#appsserversrcbootmirrortesttss-adoption-pending-case-no-longer-has-a-negative-control).

## Bundle: The nightly mutation run: downloads, shard layout and repeated jobs

3 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **The mutation report downloads still use `actions/download-artifact`** (left open by
  A1216; shared added by A1272). Measure the mutation downloads before replacing their bounded
  action retries.
  [Detail](ci.md#the-mutation-report-downloads-still-use-actionsdownload-artifact).
- **The shard layout was measured against an engine that is gone** — OPEN.
  [Detail](ci.md#the-shard-layout-was-measured-against-an-engine-that-is-gone).
- **`mutation.yml` repeats one shard-and-merge job pair three times** — OPEN.
  [Detail](ci.md#mutationyml-repeats-one-shard-and-merge-job-pair-three-times).

## Bundle: apps/server's test speed: restart tests, measured speed-ups, fixed PINs

3 entries, size L. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Find why each restart test in `apps/server/src/first-fiscal-hour.e2e.test.ts` and
  `first-fiscal-hour-boot.e2e.test.ts` boots the real entry point twice.** Left open by A938 (#1930).
  [Receipt](../developers/ci-and-gates.md#the-servers-shards-sixteen-packed-by-measured-duration)
- **The server's test suite has more measured speed-ups left.** A1297 took the three largest;
  others were measured or named but not built. Plus two small guard gaps from the same PR.
  [Detail](ci.md#server-test-time-levers-left-after-a1297).
- **Other server test files still hash fixed PINs and passwords on every test.**
  [Detail](ci.md#other-server-test-files-still-hash-fixed-pins-and-passwords-on-every-test).

## Bundle: Vitest settings: what the guide says, what A490 left, the cold-cache check

3 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A902. Say in the testing guide that Vite also prints browser console output under an AI agent.**
  [Detail](ci.md#a902-say-in-the-testing-guide-that-vite-also-prints-browser-console-output-under-an-ai-agent).
- **Loose ends left by SQLite slice 1 (#490 and the preparation tasks).**
  [Detail](ci.md#loose-ends-left-by-sqlite-slice-1-490-and-the-preparation-tasks).
- **The dependency-optimizer fix still needs a cold-cache check on Vite 8.**
  [Detail](dependencies.md#a-dependency-optimizer-receipt-taken-on-vite-6-was-not-re-measured)

## Bundle: The logo retry checks' deadline and counting

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **The logo retry check can outwait its test deadline** (left open by A1332, #2458). Its 300-frame
  request wait can exceed the unchanged 15-second case deadline when Chromium throttles frames.
  [Detail](ci.md#the-logo-retry-check-can-outwait-its-test-deadline).
- **The shared logo primitive's retry checks still count a bounded timing list** (left open by
  A1332, #2458). Apply the till check's scoped observation after reproducing the same failure there.
  [Detail](ci.md#shared-logo-retry-checks-use-the-retained-timing-list).

## Bundle: One throwaway branch that interrupts an upload and re-runs a shard

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1251: qualify artifact-upload retries after a step timeout.**
  Check the first attempt's recorded outcome and whether its retry runs; the existing collision
  probe does not cover a timeout or an interrupted upload. [Detail](ci.md#a1251-qualify-artifact-upload-retries-after-a-step-timeout).
- **A1213. Does a re-run till shard's report reach `test-till-merge`?** Seen once, not proven, in
  A1125's CI (#2238, 2026-10-29), while the merge still used the download action.
  [Detail](ci.md#a1213-does-a-re-run-till-shards-report-reach-test-till-merge).

## Bundle: What the mutation score counts: db static mutants, the pointer test helper

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **`packages/db`'s static mutants are not in its mutation score** — OPEN. Owner's call.
  [Detail](ci.md#packagesdbs-static-mutants-are-not-in-its-mutation-score).
- **`packages/ui/src/vitest-park-pointer.ts` is mutated and has no tests** — left behind by raising
  the `packages/ui` mutation score (#466, 2026-09-20). Adding a third exclusion is the consistent
  move and also shrinks the denominator `mutation-ui-aggregate`'s bar of 90 is measured against.
  Owner's call. `packages/ui/src/vitest-pointer-gestures.ts` (A720 Part 4) is in the same position.

## Bundle: Tests that close a dialog and check too soon, and pressEscape

2 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Tests that close a dialog and then check after a single `flush` were not searched**
  [Detail](ci.md#tests-that-close-a-dialog-and-then-check-after-a-single-flush-a452-1487).
- **`pressEscape` in `packages/ui/src/components/wt-dialog.test.ts` waits a fixed 50 ms after each
  Escape.** **Next action:** decide whether "closes on a real Escape press" should wait for its
  `wt-close` instead, keeping the timer for the stays-open tests. Left open by service Task 11
  (#916). [Detail](till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

## Decisions and deliberate limits

- **A1454: keep six CI slots per host (owner, 2026-11-11).**
  The 11 November measurements show about 125 GiB per host. The simplest fixed split
  is two large and five small guests, seven jobs against six today, but large-job
  concurrency falls from six to two. The owner answered “Ok” to not building it
  (Lane I questions.md, watcher 19:07). No guest profiles or slot changes were built.


- **A1440: retain v40 without a new capacity gate (watcher, 2026-11-08 22:14).**
  The [routing comparison](../superpowers/plans/2026-11-08-a1440-capacity-routing.md) is an
  illustrative replay, not measured alternate outcomes. Its fit-only rules leave more modeled
  capacity idle; no snapshot-freshness limit was validated. Keep the deployed controller,
  advance A1454 and A1461, and report existing-record observations on 15 November. **2026-11-09:** the watcher
  dropped A1454 and retained six slots after its measurement-only cut; A1461 reduces run sizes. No new
  collector, workflow, reservation service or credential carrier is approved. **2026-11-09 10:01:**
  the owner approved the repository-only GitHub-first approximation in the existing router: no
  hosted queue and fewer than 20 running hosted jobs chooses GitHub; otherwise the server-health
  check applies. This supersedes parking that routing rule; v40 and six guest slots stay unchanged. **2026-11-09 12:05:**
  hosted routing additionally requires the selected initial job wave to fit the remaining room.
  Cloud PR #1115 publishes the matching 30-record reader in v41; six slots remain. **2026-11-09 17:19:**
  the owner replaced initial-wave fit with whole-run queue pressure; qualify the count variable and route before activation.
  **2026-11-10, A1470:** the owner chose “Unsure → GitHub (Recommended)”. New-run routing uses GitHub when inventory, capacity or its module cannot be read; normal ratios and server ties remain. Degraded reads may leave the server idle; retain the first natural blind decision’s source, route and runner results before claiming live qualification.

- **A1459: measured shared startup, with child internals still unknown (2026-11-08).**

  The [coverage-on nightly](https://github.com/clintongormley/waitron/actions/runs/42437905513) saved 1,275 files and 11,903.6 summed file-seconds, split into 27.0% import/collection, 4.3% shared hooks and residual execution, 68.1% case intervals including per-case hooks and 0.6% runner/setup work; the [single coverage-off probe](https://github.com/clintongormley/waitron/actions/runs/42517343026) below passed all 1,280 captured files on a newer revision, so these totals are separate workloads rather than a before/after comparison.

  The table ranks the twenty files with the most measured shared-helper time, in seconds, with nested intervals removed from starred columns in migration, watchdog, database-setup, boot, listener order; its total also includes 70.8 seconds of runner preparation, environment and setup-file work omitted from those columns, and both runs passed the incident-history, setup-download and checkout checks, with maximum checkouts of 10 and 9 seconds respectively.

  The factory at `packages/store/src/venue-liveness.ts:223` creates a watchdog thread through `startWatchdog`, `beginHolding`, `lockVenueDirectory` and `openVenueStore`, gated by exclusive/monitored opens and whether a watchdog already exists; A1453's older capture records 1,818 factory calls in 921 files and 489 child-process API calls in 76 files, which are calls rather than successful starts, and `?` means that capture provides no call record for the row.

  Known helper waits total 495.2 seconds, 4.91% of this probe's file-time, comprising 628 `startServer` settlements, 99 listener waits, 950 database-setup hooks, 20,451 migration calls and 1,701 watchdog-creation spans; the remaining 6,408.5 execution seconds still include test work, child startup, teardown and unmeasured paths, while bundle loading, child readiness, asynchronous watchdog bootstrap and instrumentation overhead remain unknown.

  No compatible group sharing a server was demonstrated, so there is no numeric warm-server estimate: `apps/server/vitest.config.ts` retains Vitest's measured `isolate: true` default and the 27.0% nightly import share, or 30.9% in the probe, is not counted as saved; per-file timings, mock/fake-clock/seeding flags, thirteen source-reference-without-span flags, qualification logs and the executable controls are retained in `~/waitron-campaign-d/receipts/a1459-20261108/` alongside the [approved plan](../superpowers/plans/2026-11-08-a1459-process-startup-measurement.md).

  | File | File seconds | Import | DB setup* | Migration* | Server boot* | Listen* | Watchdog* | Remaining execution | Past child / worker calls |
  | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
  | **Total** | 10094.7 | 3120.2 | 161.4 | 118.2 | 212.7 | 0.2 | 2.79 | 6408.5 | separate capture |
  | `src/boot.test.ts` | 35.0 | 7.6 | 0.0 | 0.9 | 16.6 | 0.0 | 0.00 | 9.8 | ? / 2 |
  | `src/boot.place-copy.test.ts` | 162.5 | 12.4 | 0.1 | 0.2 | 14.7 | 0.0 | 0.00 | 135.0 | 14 / 1 |
  | `src/boot.failed-start.test.ts` | 20.7 | 6.0 | 0.0 | 0.4 | 11.9 | 0.0 | 0.08 | 2.3 | ? / 201 |
  | `src/boot.setup-routes.test.ts` | 41.1 | 10.6 | 0.0 | 2.7 | 8.9 | 0.0 | 0.01 | 18.8 | 1 / 2 |
  | `src/boot.invoice-delivery.test.ts` | 21.1 | 4.1 | 0.1 | 0.2 | 10.3 | 0.0 | 0.00 | 6.4 | ? / 1 |
  | `src/first-fiscal-setup.e2e.test.ts` | 39.6 | 13.9 | 0.1 | 2.2 | 5.4 | 0.0 | 0.00 | 17.8 | ? / 1 |
  | `src/boot.restricted.test.ts` | 18.5 | 4.0 | 0.1 | 0.2 | 7.4 | 0.0 | 0.00 | 6.8 | ? / 2 |
  | `src/boot.disk-full-wiring.test.ts` | 13.8 | 4.4 | 0.1 | 0.2 | 6.1 | 0.0 | 0.00 | 2.9 | ? / 1 |
  | `src/boot.backup-network.test.ts` | 12.9 | 3.2 | 0.7 | 0.1 | 5.4 | 0.0 | 0.00 | 3.5 | ? / 1 |
  | `src/boot.restore.test.ts` | 17.6 | 7.7 | 0.0 | 1.2 | 3.5 | 0.0 | 0.00 | 5.2 | ? / 2 |
  | `src/boot.certificate-diagnosis.test.ts` | 10.7 | 4.1 | 0.1 | 0.2 | 4.4 | 0.0 | 0.00 | 2.0 | ? / 1 |
  | `src/boot.handover-chart-moved-on.test.ts` | 16.9 | 4.6 | 0.1 | 0.3 | 3.7 | 0.0 | 0.00 | 8.0 | ? / 1 |
  | `src/boot.attendance.test.ts` | 44.8 | 7.9 | 0.1 | 0.2 | 3.8 | 0.0 | 0.01 | 32.7 | ? / 2 |
  | `src/handover-controlled.e2e.test.ts` | 26.6 | 7.5 | 0.0 | 0.2 | 3.7 | 0.0 | 0.00 | 15.1 | ? / 1 |
  | `src/boot.attendance-export.test.ts` | 10.7 | 3.8 | 0.1 | 0.3 | 3.4 | 0.0 | 0.00 | 2.9 | ? / 3 |
  | `src/boot.node-configuration.test.ts` | 8.7 | 3.0 | 0.0 | 0.1 | 3.7 | 0.0 | 0.00 | 1.8 | ? / 1 |
  | `src/boot.box-emails.test.ts` | 8.2 | 2.4 | 0.0 | 0.1 | 3.7 | 0.0 | 0.00 | 1.9 | ? / 1 |
  | `src/boot.venue-details.test.ts` | 11.8 | 3.0 | 0.0 | 0.1 | 3.5 | 0.0 | 0.00 | 5.1 | ? / 1 |
  | `src/boot.hours.test.ts` | 10.0 | 3.6 | 0.1 | 0.2 | 3.3 | 0.0 | 0.00 | 2.7 | ? / 2 |
  | `src/boot.zone-admission.test.ts` | 10.4 | 2.7 | 0.0 | 0.1 | 3.4 | 0.0 | 0.00 | 4.1 | ? / 1 |

- **A1446 closed without a production cache (watcher, 2026-11-08).** The baseline and cold-cache runs each passed 31,487 server tests across 24 shards. The experimental cache occupied 263,556,548 stored bytes. A deliberately wrong sender name failed six existing local tests; restoring it passed all 13. The hosted changed-source control and restored warm run did not complete before the 19:30 stop, so warm savings and hosted invalidation remain unverified. Disposable PR #2613 closed without merging. Keep the cache disabled; [the dated result](../superpowers/plans/2026-11-08-a1446-server-module-cache.md#experiment-disposition-8-november-2026) records the runs and measurement limits.

- **A1452, owner 2026-11-08:** ordinary main pushes keep quick checks and skip package tests/shared mutation in `ci.yml`. PR selection and full nightly/manual/release testing remain. UI registry publication and deploy-selected image smoke keep their checks. BEHIND merges retain their existing rule; package-level failures caused only by combining branches wait for the next full run. Watcher approval and owner risk acceptance: Lane F, 17:48, confirming the owner’s 17:35 decision.

- **A1453 — drop this measured selector and remembered-result prototype (2026-11-08).**
  The initial 82.17% retention figure used a conservative static scan for worker paths.
  Direct child-process API records cover 12,452.6 of 78,421.8 qualified scoped file-seconds (15.88%).
  Positive V8 counts also show execution of the one-line worker factory in files accounting for
  61,871.0 seconds (78.90%); its body is `new Worker(source, options)` at the captured revision's
  `packages/store/src/venue-liveness.ts:223`. Their union is 64,135.2 seconds (81.78%). These are
  calls, not proof that every process started successfully or coverage of the worker body.

  **This sample does not support tens of times fewer test minutes.** Keeping that union, as the
  approved plan requires, caps savings at 18.22% even if every other file is free, below the 30% bar.
  Keeping only the directly recorded child-process files still leaves 15.88% of the file-time;
  a tenfold cut would need 10% or less. The original rule also retains 3.7 static-only seconds and
  297 seconds with no baseline map, giving its 17.83% ceiling. Keep package scoping; this does not
  establish a limit on every possible cache, another workload or the watcher's warm-runner proposal.

  The frozen sample ends at PR #2611, merged at 17:54 CET on 8 November, and contains 40 PRs.
  Ten scoped rows qualify: six ran measured tests and four ran none. Qualification checks incident history, download 5xx
  and checkout under about ten seconds. A separate coverage-enabled row has 2,517.6 file-seconds;
  other rows remain in the receipt with their disqualifying evidence. File-time sums concurrent
  file elapsed times: it is not runner minutes or the time a person waits.

  | Qualified scoped sample | Own-package fallbacks | Stricter dependent-package fallbacks |
  | --- | ---: | ---: |
  | Selection saving | 4.11% | 2.43% |
  | Additional conservative remembered passes | 0 | 0 |
  | Combined saving: ceiling, not verified safe | 5.36% | 5.36% |

  These are gross estimates before map download, matching and installation costs. No qualified
  whole job becomes empty: zero whole-job minutes avoided; partial-job wall-time savings are unmeasured.

  The ceiling adds only 1.25 percentage points over the own-package result (1.30% of its remaining work). The extra ceiling permits an old executed-function fingerprint to bypass
  a fallback. Each extra reuse has a risk line in the receipt: changed code the old map never ran,
  or an unrecorded input, can invalidate that result. Its key includes the whole test, recorded
  function bodies, their files' top-level code, helpers and configuration/runtime dependency
  identity. The retained history yields 2,981 ceiling keys, modelled as 539,561 serialized bytes. No production selector, cache or recurring workflow was installed.

  All 2,537 expected files have one record; 2,194 remain gap-marked, including 1,177 unreadable source-map paths. Maps are captured before Vitest merges coverage, with one test path per record;
  Node and concurrent Chromium controls distinguish called functions from merely imported ones.
  Worker exclusions come from a static scan of mapped source files, not proof each test starts a worker.
  The historical map base is `147914ca764a66a6dfc7fbe8500ea66c53763100`. Raw maps occupy 213.4 MB; hosted artifacts 30.7 MB. The 36 successful jobs took 150.25 summed job-minutes, including 119.50 capture-step minutes; conversion timers sum to 51.28 minutes within those steps.
  Rebuild costs are observed instrumented jobs, not measured savings or an incremental nightly cost.
  All 36 had no relevant incident or setup/download 5xx and checkout at most 10 seconds.
  Hosted receipts: [24 server jobs](https://github.com/clintongormley/waitron/actions/runs/42506976544)
  and [12 browser jobs](https://github.com/clintongormley/waitron/actions/runs/42510919846).

  All eleven observed failed PR file/head pairs and one main pair remain selected by the gap rule; none is reused. Six predate the map. The audit retains one unavailable attempt-metadata response and one missing
  failed-job log. Earlier-pass history requested 202 PR/main attempts; 42 archives were unavailable,
  supplemented where exact job logs survived. Missing history limits the ceiling; retaining those
  observed files does not prove safety. Other packages and required checks stay unchanged.

  Receipts: `~/waitron-campaign-d/receipts/a1453-20261108/measurement-results.md`, with all 40
  per-PR rows, failure heads, fallback reasons, risk lines, map/store sizes and commands.
  The [approved measurement plan](../superpowers/plans/2026-11-08-a1453-executed-test-measurement.md)
  records the scope; its prototype and temporary hosted workflow are not part of the product.

  **A1460 follow-up, 2026-11-08: exempt the fixed watchdog, retain child processes.**

  Source check at capture revision `147914ca`: `startWatchdog` passes the fixed `WATCHDOG_SOURCE` string to `new Worker` with `eval: true`, while its shared buffer, timing values and settings are read as data, with no data-derived code-loading path in that string (`packages/store/src/venue-liveness.ts:114`, `:223` and `:231`).

  Changing only that retention rule releases 866 watchdog-only gaps; every mapped watchdog caller is explicitly selected when `venue-liveness.ts` changes, other worker sources and child-process calls retain their fallbacks, all 39,769 stored function hashes match the current parser, and the unchanged-rule control reproduces all 59,206 historical file selections before this adjustment.

  Across the forty PRs below, five ran no measured files and median selected file-time is 11,395.4 seconds with a 0–17,179.7 spread; the thirty-five nonempty rows have median 98.94% selected and a 48.80–100% spread, but unqualified rows are diagnostic only and the ten qualified scoped rows, six nonempty, give 16.73% gross selection savings against the original 4.11%, or 8.91% under the stricter dependent-package fallback.

  In that qualified scoped sample, child-call files still force 12,452.6 of 78,421.8 file-seconds (15.88%), stale maps retain 41,359.4 and remaining attribution gaps retain 23,740.2; all twelve observed failed file/head pairs remain selected, including the one on main, while no sampled PR changes `venue-liveness.ts`, so its explicit invalidation rule is checked by a synthetic control and a deletion that makes that control fail.

  Keep the measured selector stopped under the original 30% bar: this replay reaches neither that bar nor a tens-fold reduction, measures selection rather than remembered passes or job-time savings, and adds no CI run, product selector or recurring workflow; all forty rows, the twelve failure heads, three passing controls and two failed deletion controls are retained in `~/waitron-campaign-d/receipts/a1460-20261108/`.

  | PR | Timing basis | All file-seconds | Original selected | New selected | Stricter selected | Child-call files |
  | --- | --- | ---: | ---: | ---: | ---: | ---: |
  | #2611 | qualified scoped | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
  | #2610 | qualified scoped | 11673.5 | 11673.5 | 11673.5 | 11673.5 | 1921.6 |
  | #2609 | unqualified | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
  | #2607 | unqualified | 10553.3 | 10553.3 | 10553.3 | 10553.3 | 1843.5 |
  | #2605 | unqualified | 10616.9 | 10478.4 | 10477.3 | 10616.9 | 1640.3 |
  | #2598 | unqualified | 17179.7 | 17179.7 | 17179.7 | 17179.7 | 2147.4 |
  | #2596 | unqualified | 13752.5 | 13752.5 | 13752.5 | 13752.5 | 2148.0 |
  | #2595 | unqualified | 16660.1 | 16507.8 | 16506.9 | 16660.1 | 2140.8 |
  | #2593 | unqualified | 16805.8 | 16805.8 | 16805.8 | 16805.8 | 2242.3 |
  | #2591 | unqualified | 12032.9 | 12032.9 | 12032.9 | 12032.9 | 2249.8 |
  | #2590 | unqualified | 14132.0 | 14132.0 | 14132.0 | 14132.0 | 2219.2 |
  | #2589 | unqualified | 14134.9 | 13986.0 | 13985.3 | 13985.3 | 2153.5 |
  | #2588 | unqualified | 14755.9 | 14595.9 | 14594.9 | 14755.9 | 2332.7 |
  | #2587 | unqualified | 11770.3 | 11770.3 | 11770.3 | 11770.3 | 2141.3 |
  | #2586 | unqualified | 11893.6 | 11215.0 | 11193.1 | 11193.1 | 2220.5 |
  | #2585 | qualified scoped | 10348.6 | 9767.9 | 9747.1 | 9747.1 | 1883.7 |
  | #2583 | unqualified | 11613.8 | 11613.8 | 11613.8 | 11613.8 | 2063.2 |
  | #2582 | qualified scoped | 11383.5 | 10743.3 | 8273.2 | 8273.2 | 2074.8 |
  | #2581 | qualified scoped | 14945.9 | 14258.9 | 11669.8 | 11669.8 | 2367.7 |
  | #2580 | qualified scoped | 16750.9 | 16080.2 | 13579.1 | 16750.9 | 2151.9 |
  | #2579 | unqualified | 10322.8 | 10322.8 | 10322.8 | 10322.8 | 1962.4 |
  | #2578 | unqualified | 16356.4 | 16356.4 | 16356.4 | 16356.4 | 2197.7 |
  | #2577 | qualified scoped | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
  | #2576 | unqualified | 16655.0 | 15963.5 | 12634.2 | 12634.2 | 2142.9 |
  | #2575 | qualified scoped | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
  | #2574 | unqualified | 10901.0 | 10308.1 | 8049.6 | 10901.0 | 2040.2 |
  | #2573 | unqualified | 12800.7 | 12800.7 | 12800.7 | 12800.7 | 1957.7 |
  | #2572 | unqualified | 10586.8 | 9901.2 | 6854.2 | 6854.2 | 1940.1 |
  | #2571 | qualified scoped | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
  | #2569 | unqualified | 11319.8 | 10622.4 | 7472.8 | 7472.8 | 2062.0 |
  | #2568 | unqualified | 12278.8 | 11244.4 | 7843.2 | 7843.2 | 2022.6 |
  | #2567 | unqualified | 15096.6 | 14062.7 | 10669.2 | 15096.6 | 2079.8 |
  | #2566 | unqualified | 19391.6 | 18325.0 | 9463.4 | 19391.6 | 2354.6 |
  | #2565 | unqualified | 12597.7 | 11924.3 | 9065.6 | 12597.7 | 1855.2 |
  | #2561 | qualified coverage | 2517.6 | 2517.6 | 2517.6 | 2517.6 | 0.0 |
  | #2558 | unqualified | 17171.8 | 17171.8 | 17171.8 | 17171.8 | 2153.0 |
  | #2557 | unqualified | 11597.6 | 11597.6 | 11597.6 | 11597.6 | 2114.0 |
  | #2545 | unqualified | 11788.3 | 11788.3 | 11788.3 | 11788.3 | 2228.0 |
  | #2542 | unqualified | 16259.0 | 15316.9 | 11672.0 | 16259.0 | 2325.1 |
  | #2531 | qualified scoped | 13319.4 | 12678.5 | 10358.8 | 13319.4 | 2052.9 |

- **A1448 — keep plain typechecks (watcher, 2026-11-08).** Do not adopt TypeScript 7.0.2’s incremental build information: in the retained reproduction, renaming `WtModal.heading` in `packages/ui/src/components/wt-dialog.ts` left two warm dashboard checks passing, while plain `tsc --noEmit` reported 119 errors. The affected callers receive the component type through the global `HTMLElementTagNameMap`; imported-dependency controls did catch errors and did not expose this case. The watcher closed the item and kept the implementation private. Reproduction and results: `~/waitron-campaign-k/receipts/a1448-20261108/reproduce-global-error.py` and `global-error-results.json`.

- **A1449, owner and watcher 2026-11-08:** the pre-push hook keeps sign-off, frozen install, formatting, lint and scoped typechecks. Root tests and coverage run in CI. Known package, machinery and documentation scopes check changed files with content caches; global or unknown scopes retain full format/lint scans.

- **An older PR head may lack a newer workflow's browser smoke script (watcher, 2026-11-08 04:18, A1402).** Keep checking out the PR head. When `apps/setup/test/bundle-smoke.mjs` is absent, skip only that browser check with a notice; builds and other smoke checks stay required. An existing script's failure still fails the job. [Mechanism and test](../developers/ci-and-gates.md#built-applications-in-bundle-smoke).

- **A1427 — keep package scoping; stop related-file selection (2026-11-07).** The corrected 40-PR replay narrowed five server runs to 1,135 of 1,273 files, retained 26 full runs and skipped nine. Its duration-table estimate was about 241 test-job seconds saved at four workers, against 698 local selection seconds plus 24 installs at 5.2 seconds each. These are estimates and local timings, not observed hosted savings. The watcher stopped PR2 at 22:49; keep the prototype and receipts unpublished and add no further selection machinery. Keep PR2557's package-scoped tests and nightly/manual full coverage.

  **A1442 measurement (2026-11-08):** Ten recent successful pull-request runs, each on its first attempt, had 150 test jobs: 144 server shards with 51–54 files each and six stream jobs with 13 each. Four runs started no package-test job; none of the 150 jobs ran zero to ten files. One job lacked API step timings, but its log reported 53 files. Only one test-bearing run met the checkout-time check: [42460639755](https://github.com/clintongormley/waitron/actions/runs/42460639755/attempts/1) spent 15.22 job-minutes before test steps and 45.75 in them. The watcher closed A1442 as measurement-only; keep package selection and the related-file prototype stopped.

- **Investigate CI failures before retrying (owner, 2026-10-31, A1243).** Follow the
  [CI-failure rule](../developers/ci-and-gates.md#what-to-do-when-ci-fails). Record a recurring
  unrelated failure against its root-cause fix before obtaining a clean run for unrelated work;
  a passing re-run is never the repair.

- **The IPP polling-clock fixture observes server connections, not the next agent pause (A1251,
  #2092).** Keep the exact 295 ms first-query assertion. In disposable probes, adding one
  `setImmediate` turn after the agent reads a job reply made both cases report 300 ms; five turns
  made their real-time wait expire. Delaying every server reply by 4 ms passed both cases.
  These probes changed the poller; they do not establish the cause of the historical CI failure.
  If you add a wait to that continuation, coordinate the fixture with it rather than widening
  the boundary assertion.

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

- **Job-sharding levers:** server, dashboard and till use measured-duration packing
  ([tables and refresh](../developers/ci-and-gates.md#package-duration-tables)); bump `shard: [1..N]` and the denominator
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
  when the file has grown noticeably, as a loose guide past about 71 KB, per `CLAUDE.md` §7. The campaign watcher checks it on
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

## Explain the two older silent pnpm setup stalls

Reproduce the two earlier silent setup failures before assigning their cause. Main run
[40644939856](https://github.com/clintongormley/waitron/actions/runs/40644939856), job
`122671628160`, stayed active through cancellation and its final job log was unavailable.
Run [42034714487](https://github.com/clintongormley/waitron/actions/runs/42034714487), job
`127269970638`, timed out in setup with no script output and no tests run. Both fresh-runner
samples passed without diagnosing the first attempt. The later named Node-read timeouts do not
establish what ran during those silent waits, and removing that initial Node dependency proves
nothing about their causes.

Retain each recurrence's last `start` and `end` lines and reproduce the named operation before
changing its limits. Prefix cleanup and writing `GITHUB_PATH` remain outside the command timeouts;
a cleanup start without an end needs evidence from that operation, not an npm retry. The legacy
attempt summary still names npm after a version failure; use the preceding named-phase status
and mismatch reports to identify the failed operation. Changing that retained summary needs
approval for its existing exact-output checks. The read, install and version limits are in
[the CI guide](../developers/ci-and-gates.md#every-pnpm-setup-is-bounded).

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

Since #602 the comment at `.github/workflows/ci.yml` about line 268 says the three-shell receipt is
in `.husky/pre-push`; that file holds no such receipt. Restore the receipt there or cut the pointer
from the comment.

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
root. Apply the [CI-failure rule](../developers/ci-and-gates.md#what-to-do-when-ci-fails)
before retrying unrelated work; a later pass does not fix either test.

## A printers-screen test failed once during A435 step 2's review fixes

"a press after one edit sends the edit and the field as it was read"
(`apps/dashboard/src/screens/printers-screen.save-state.test.ts`) failed once in eight runs of the
printers-screen files on 2026-10-10, then passed alone and in the seven later runs; its error was
not captured. It was not reproduced. **Next action:** reproduce it under load and fix at the root.

## Other `uses:` steps that fetch over the network have no step time limit, and the runner's own action download at job set-up is bounded only by long limits of its own (left open by A935)

2026-10-25 (A1100): artifact uploads now have
[two bounded attempts](../developers/ci-and-gates.md#every-artifact-upload-is-bounded).
2026-10-31 (A1254): Node setup now has
[two bounded attempts](../developers/ci-and-gates.md#every-node-setup-is-bounded).
The remaining cache, Docker and CodeQL steps still wait on their job limits, except the `lint` job's two cache steps, which have one-minute limits and may fail without failing the job (A1447).

List them with

```sh
grep -n -E '^\s*-?\s*uses: (actions/cache|docker/|github/codeql-action)' .github/workflows/*.yml
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
the hosted timeout. CI's checkout attempts emit Git Trace2 JSON events,
and successful checkouts print stored-pack byte counts. See the
[measured diagnosis and its limits](../developers/ci-and-gates.md#checkout-stage-diagnostics-28-october-2026-a1178).
In full comparison run `40765243305`, both a full-history and a shallow first attempt reached
`fetch_refs` with a started `index-pack` child and no matching completion before timeout. This
does not distinguish waiting for incoming data from local indexing. Capture more evidence at
that boundary before attributing the wait to GitHub, the network or local indexing.
Suite jobs use depth one, with full history retained for change classification and sign-off.
Since A1316 the full-history checkout skips old file contents
([why, and what was measured](../developers/ci-and-gates.md#the-full-history-checkout-skips-old-file-contents-a1316)).
Full baseline `40757792434` and shallow comparison `40765243305` each passed 76 jobs, with
one skipped publish. Package test counts matched; the root gained the new history guard.
Across the 35 converted suite instances, median stored pack bytes fell from 408,161,710 to
206,776,315 and median first-checkout time from 32 to 22 seconds. Stored bytes are not wire
traffic, and these hosted runs do not isolate timing from runner or network conditions. Both
coverage gates passed; the history change reduces requested data, not a proved timeout cause.

On 28 October, [main run 40750935978, till shard 3](https://github.com/clintongormley/waitron/actions/runs/40750935978/job/123038600113)
exhausted both 120-second attempts with `--depth=1`, before installation or tests. Reducing
full-history transfers does not eliminate this observed shallow-checkout failure mode.


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

On 2026-10-31 the same detached split click failed again — `till-app-drafts.test.ts` "keeps the source and pending edit when the save before a split fails", in a 66-file local till run on feat/a803-3-bill-switcher (432 of 432 passed when that file ran alone).


## Decide whether browser tests stop replacing modules (A943 follow-up)

A spy mock of
the till's pricing module failed once in CI with its cause not found, and #1934 replaced it
with a function the store takes. Its convention reviewer proposed a CLAUDE.md rule against
module mocks in browser tests; #1934 did not add one, because one failure with no known
cause is thin ground for a house rule. The owner decides.


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


## Loose ends left by SQLite slice 1 (#490 and the preparation tasks)

- Every `maxWorkers: 1` config whose comment gives the coverage reason, apart from `payments`,
  which carries its own measurement, still says the pin is needed without having measured it; the
  same one-worker-against-several coverage comparison would settle each.
- P7's leftovers (#533).
  [Detail](#p7s-leftovers-533)
- A few suites still build engine-shaped refusals by hand rather than through `refusalError`
  (`packages/db/src/testing/refusals.ts`, P10, #527), among them
  `packages/provisioning/src/cli.test.ts` and `packages/payments/src/reconciliation-schedule/store.concurrency.test.ts`.


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
On recurrence, retain the failed step log and use its file list, selected-file
case/hook events, Playwright API calls, any `[file-progress] stack:` lines and the
process state to identify a blocked operation or slow cases. The parties file ran
long; the line-detail and refund-unsaved files started within 13 seconds of the
deadline. The till shard selects all three for the existing case/hook trace and
enables `DEBUG=pw:api`; these diagnostics do not establish a cause or repair. Keep the venue-service startup investigation and A419's dashboard stall
separate; no shared cause is established.

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

## One failing success-branch check in the first-fiscal-setup end-to-end file ends its worker

In `apps/server/src/first-fiscal-setup.e2e.test.ts`, a failure inside a row's success branch makes
the Vitest worker exit ("Worker exited unexpectedly"), so the later rows never run and the run
reports one failure (it still exits 1). Reproduced on `27ae35c09` by breaking the existing
tax-number check, during A980 S1a2. Cause not found.


## A1230: dashboard shard 1's blocked operation is unknown

Main CI run `41046955691`, job `124036233860`, ended at its 360-second
command deadline on 30 October 2026. Its unfinished files were
`content-languages-screen.a11y.test.ts`, `content-translations-dialog.a11y.test.ts`
and `extra-list-form.save-state.test.ts`. The retained log identifies assigned
files, not the pending case, hook or browser command.

On macOS, the three files passed all 138 cases in 62.92 seconds. The original
shard-1 command with coverage passed 130 files and 3,327 cases in 104.55 seconds.
Neither run reproduced the CI stall; neither establishes its cause or a repair.

The dashboard shard now selects those three files for detailed reporter events
and enables Playwright API logging. On recurrence, preserve the whole failing log,
read each selected file's last collected/case/hook event and any unfinished
Playwright API call, then reproduce that wait. A completed collection event
separates a loaded module from an assigned file; a case-start event precedes its
beforeEach hooks. These events do not name a pending application promise. A
browser file that reports no case or hook for 60 seconds past its time limits also gets `[file-progress] stack:` lines once a page shows it (see A1305
below). Product behavior, test assertions, test deadlines
and shard counts have not changed in this diagnostic slice.

## A1305: the dashboard page blocked during a click, and what blocked it is unknown

Main CI run `41338680756` (`b0aa3502d`), job `124944000948`, `test-dashboard (4)`,
reached its 360-second deadline on 1 November 2026 with only
`src/screens/device-profiles-screen.clock.test.ts` unfinished. The file started at
18:58:17. Its Playwright API log shows the click on the Clock in switch at 18:58:17.532
log `performing click action` and never `click action done`: of the 83 clicks
started between 18:58:17 and 18:58:32, 82 succeeded and that one failed, at
18:58:32.166, when Playwright's timeout (the test's remaining 15 seconds) ran out on
the Node side. The log's click lines name no browser page, so it does not show which
pages the 82 ran on. Its `navigated to` lines do name a browser session: the clock
file's session loaded that file at 18:58:16.788 and nothing after it, while the other
two sessions went on loading test files until 18:58:56. No later API call in the log
names an element the clock file clicks, and its two later cases, whose first click is on
`edit-clock-profile`, never reached that click.

A blocked main thread explains that shape and a waiting test does not. On macOS,
a test whose click handler loops forever never finished and its file never ended,
as in CI; a test awaiting a promise that never settles failed at 15 seconds and its
file's next case passed. What blocked the page in CI was not found: the clock file
passed in 1,025 runs in batches of 25 (the file and 24 copies, three browser
workers; 275 runs with coverage on) and in 28 runs beside its CI neighbours (17
with coverage). Reading the click's path
(`wt-switch`, the screen's capability toggle, the draft scope, `wt-dialog`) found
no loop.

On the next stall, read the `[file-progress] stack:` lines first
([how they are taken](../developers/ci-and-gates.md#a-browser-file-silent-past-its-time-limits-gets-a-stack-sample)).
They show where the page's JavaScript was when paused, or that nothing paused and
whether the page answered, or that no page showed the file, or that a time limit Vitest treats as none kept it from pausing then. A file whose silence
began too close to the deadline for its limit to pass gets no `stack:` line. The earlier dashboard
stall (A1230, above) left too little evidence to say whether it was the same.

**1 November 2026, another unfinished browser file.** Main run `41338680756` on
`b0aa3502d761d8d327b00c32e0d43c498bdaf024`, job `124944000948` (`test-dashboard (4)`),
reached its 360-second command deadline with only
`src/screens/device-profiles-screen.clock.test.ts` unfinished. Its missing coverage blob
then failed upload. The full log, including the last browser calls and process snapshot, is
retained in Lane F's `receipts/w41s8-payload-20261101/a1304-main-dashboard4.log`.
No assertion failure was reported; whether this shares the earlier stall's cause is unverified.
A1305 owns that investigation in Lane B. Keep the failed run; a passing retry would not establish
the cause or a repair.

## Server test time levers left after A1297

[PR #2418](https://github.com/clintongormley/waitron/pull/2418) (A1297) remembered recovery-key checks
within a test file, migrated `heldSetup`'s databases once per file, sealed the test helpers' backups
under one salt per file and split `first-fiscal-hour.e2e.test.ts`. Its investigators measured or named
these, which it did not build (local figures, 2 November 2026):

- **Some server tests' child processes still load through `tsx`.** Among those,
  `hour-recovery-placement-1`, `hour-recovery-placement-2`, `handover-stepdown.crash.test.ts` and
  `handover-activation-repair.test.ts` replace modules at load time through `registerHooks`.
- **One migrated template for every `useVenueDb` suite: measured and not worth building** (A1443,
  8 November 2026). The 0.85 s per file recorded on 2 November predates [PR #2539](https://github.com/clintongormley/waitron/pull/2539),
  which took the repository from 405 migration files to 7. Timed on one Mac in a new process per run
  (every file is its own process under Vitest's defaults) with the full manifest: migrating takes a
  median of 65 ms and copying an already migrated database 18 ms, a saving of 47 ms per file. The same
  timing on the commit before #2539 gave about 1.9 s against 23 ms, so the timing can see a real gain.
  Across the 826 server test files in `apps/server/test-durations.json` that is about 39 s of 12,724 s
  recorded, or 0.3%; three times that, for a slower CI machine, is still under 1%. The 5% bar would need
  about 770 ms per file. Measured locally only: no CI run was made. Measure again only if the
  migration history grows back to hundreds of files.
- **The remaining random salts in test setup:** `src/testing/staged-hour-restore.ts` and
  `src/testing/staged-hour-crash.ts` still draw one per call. Sharing `apps/server/test/fixture-salt.ts` with `src/testing/` would mean moving it
  there, under coverage and mutation.
- **The recovery-key memo lives in `apps/server/test/hour-recovery-host.ts` only.** Files that do not
  load the host still pay the full derivation per check; moving the memo into a wider test setup
  must keep `src/testing/watched-scrypt.ts`'s derivation counts correct.

Guard gaps the review left:

- `scripts/vitest-duration-sequencer.test.mjs` checks shard counts up to 24, so the next increase has
  to raise that bound too.
- Nothing compares the server coverage merge's expected blob count (25) with the shard count plus the
  stream job; the download script refuses a wrong count only when CI runs.

## A1252: remaining server job time after the held-setup split

**Coordination, 1 November at 12:45:** the watcher closed A1252 after its split and three
observations, and assigned the remaining over-270-second work to **A1297**. The measurements
below remain receipts for that follow-up; they do not mean A1252 is still open.

On 31 October 2026, [PR #2341](https://github.com/clintongormley/waitron/pull/2341)
landed the held-setup split, preserving all 73 cases, including A1131's three
fresh-box restore cases. Its final [CI run 41200533986](https://github.com/clintongormley/waitron/actions/runs/41200533986)
checked out `3f446266f2b8872798ddc250fabce46b8079aeea` in every ordinary server job.
All 1,125 selected ordinary files ran exactly once. The coverage merge reports
26,935 tests passed and one skipped across 1,135 files, including the separate
stream/full-disk job.

The five held-setup files took 90.2–143.6 seconds each. Complete ordinary jobs
took 173–305 seconds, so this run does not meet the target of about 4.5 minutes
for every job. The table lists each job above 270 seconds and its longest file.
The test step runs the complete file group and coverage; setup and cleanup are
the rest of the job's recorded duration.

| Shard | Whole job (s) | Test step (s) | Setup and cleanup (s) | Longest file (s) |
| --- | ---: | ---: | ---: | --- |
| test-server (1) | 283 | 238 | 45 | `src/first-setup-start-again-backup-discard.test.ts` (206.6) |
| test-server (13) | 272 | 228 | 44 | `src/hour-recovery-placement-3.test.ts` (144) |
| test-server (2) | 274 | 226 | 48 | `src/invoice-pdf.test.ts` (180.1) |
| test-server (11) | 295 | 250 | 45 | `src/first-setup-backup-reopen.test.ts` (186.5) |
| test-server (10) | 274 | 228 | 46 | `src/first-setup-backup-recovery-preparation.test.ts` (167.1) |
| test-server (5) | 305 | 249 | 56 | `src/first-fiscal-hour.e2e.test.ts` (199.5) |
| test-server (20) | 271 | 236 | 35 | `src/first-setup-backup-resume-authority.test.ts` (141.6) |
| test-server (16) | 275 | 231 | 44 | `src/hour-recovery-placement-2.test.ts` (160.4) |

**1 November follow-up:** the three natural full main observations now exist:
[41288426367](https://github.com/clintongormley/waitron/actions/runs/41288426367),
[41278766733](https://github.com/clintongormley/waitron/actions/runs/41278766733) and
[41272334746](https://github.com/clintongormley/waitron/actions/runs/41272334746).
Each successfully executes all 20 ordinary server shards. Their maximum whole jobs
are 278, 292 and 306 seconds, respectively. The observation wait is complete; the
all-jobs target still has residual work.

| Run / shard | Whole job (s) | Test step (s) | Setup and cleanup (s) | Longest file (s) |
| --- | ---: | ---: | ---: | --- |
| 41288426367 / 3 | 276 | 230 | 46 | `first-setup-backup-resume-publication.test.ts` (177.8) |
| 41288426367 / 10 | 276 | 225 | 51 | `first-setup-backup-recovery-preparation.test.ts` (149.8) |
| 41288426367 / 19 | 278 | 236 | 42 | `restore-emergency-crash.e2e.test.ts` (123.7); `first-setup-backup-lease.test.ts` also takes 118.3 |
| 41278766733 / 11 | 292 | 250 | 42 | `first-setup-backup-reopen.test.ts` (174.1); `first-setup-database-holdings-damage.test.ts` also takes 147.4 |
| 41272334746 / 5 | 306 | 239 | 67 | `first-fiscal-hour.e2e.test.ts` (183.1) |

The first three rows cover every over-270-second job in the latest run; the final
two identify the longest job in each older observation. Retain whole-job,
test-step and per-file times when choosing further packing or suite-setup work,
with every behavioural assertion preserved. These measurements identify
contributors; they do not establish the cause of every aggregate delay.

**A696 observation, 1 November:** [PR CI 41305909069](https://github.com/clintongormley/waitron/actions/runs/41305909069)
passes at `4b85799d4`, after the branch's process matrix is split from one 348-second file
into five files retaining all 18 cases. The five files take 14.8–99.1 seconds. Their containing
jobs take 196, 204, 265, 269 and 294 seconds. The 294-second job's largest files are `boot.test.ts`
(126.7), `first-setup-database-holdings.test.ts` (123.2) and
`zone-process-matrix.callers.test.ts` (99.1). Nine server jobs exceed 270 seconds; the maximum is
329, with `first-fiscal-hour.e2e.test.ts` (213.2) and `boot.setup-routes.test.ts` (168.8) its largest
files. These are measured contributors, not a controlled causal comparison. This PR observation
is additional evidence, not a replacement for the three main observations above. The remaining
packing/setup work stays open. Lane E retains the exact twenty job logs, complete durations and
per-file measurements under `receipts/a696-resume-20261101/`.

A1242's separate publication/fallback qualification is complete. Main run
[41282000200](https://github.com/clintongormley/waitron/actions/runs/41282000200)
reuses successful PR run 41281175428, reports `code=true`, and successfully pushes
both `:main` images. PR #2365's tested head tree
`b5eeb91d4b82ec128a9c356e03f0330b780884e2` differs from its main squash tree
`bc1116107149662396b1b46ff1900d791c91bf9f`; main run 41278766733 reports
`reuse=false` and runs the full global suite successfully. Earlier post-fix run
41183258278 and docs run 41183408052 both report `code=false`, with publication
skipped. The API tree pairs, job scopes and publication logs are retained in
Lane E `receipts/a696-resume-20261101/`.


## Real-source bundle tests repeat metadata work

The permission verifier and certificate diagnosis suites run the real bundle CLI. Its release
stamp reads Git three times, with 20 seconds allowed for each read. Its runtime descriptor
subprocess then allows 60 seconds. A shared static build could avoid repeating those reads,
but the certificate suite also builds request-specific wrappers after starting local servers.

Measure selective shared setup that serves focused runs and shards without building unused
fixtures or retaining stale outputs. Keep the real CLI stamp and permission assertions. A1271's
trial built three static entries in one CLI invocation and in three invocations; it did not
implement or qualify Vitest global setup. The comparison and reverse-order control are in the
A1271 PR. The server suites' larger build limits do not remove repeated metadata work.

Audit these remaining CLI callers and their containing test or hook deadlines. Both pass the
16-second-per-Git-read control, which does not exhaust the metadata subprocess budgets:

- `packages/fiscal-verifactu/src/recovery-pdf-node.test.ts`: a 60-second build limit.
- `packages/provisioning/src/cli-entry.test.ts`: a 120-second build limit leaves no allowance
  beyond the metadata subprocess budgets for compilation. No timeout failure was reproduced.



## Retired settings after a source escape

On 1 November, A696's first normal pre-push run failed
`scripts/no-till-as-issuer.test.ts`: the old branch retained an obsolete location override and
one fiscal fixture still used a till identifier. Both are corrected without changing the guard.
A whole-source text search found the same retired override in another fixture's template literal,
immediately after an escaped newline. `inspectSource` reports the plain spelling but misses the
escaped-prefix form: the raw source has no word boundary where the decoded value has a newline.
The corrected fixture preserves its wrong-node restore input and all existing assertions.

Extend the spelling check to decoded string/template values, without dropping raw-text checks or
its legitimate negative/historical controls. Add the missing escaped-prefix case and a positive
control first. This branch records the scanner gap; it does not claim a new guard fix.
The two-way probe and blocked-hook output are in Lane E
`receipts/a696-resume-20261101/retired-setting-escape-control.log` and `push-1.log`.

## A1306. Rewrite git history to drop the development artifacts

Owner, 2026-11-02: "there is no point in keeping these development artifacts as history".
Mock-ups and screenshots left the tree on 2026-11-02, but history still holds 2,327 image
versions, about 300 MB compressed of a 584 MB pack (measured that day with `git rev-list
--objects --all` and `git cat-file --batch-check`). Rewrite `main` with them removed, at a moment
when the lanes are paused, as the last step of A1308 (owner, 2026-11-06). Every clone, worktree, lane and open pull
request then restarts from the rewritten `main`, and old commit links stop resolving. Decide then
whether other development artifacts (finished specs and plans, look reports) go too.

## A1251. Finish qualifying and reviewing historical PRs that skipped the Claude run-it review

Exclude documentation-only changes, verified test-data/name renames and changes already reviewed.
Review each remaining squash against its parent and check findings against current main before
opening a repair. Check refusal wording against independent expectations kept in the app's
`i18n` area.
Use the [qualified public-connection wording receipt](self-service-refusals.md#tls-repair)
without treating browser refusal checks as certificate-recovery qualification.
Check the later regional demo guides’ photo-library name claims against image metadata and the
screen’s content-language selection.
Keep the IPP clock-driver limit explicit when
changing the polling continuation, and check that a failed fixture’s print call settles after
teardown. Align the archive-settings inline instruction with its available action.
[Inline advice](#archive-settings-inline-advice-must-name-its-available-action).

## A1213. Does a re-run till shard's report reach `test-till-merge`?

Seen once, not proven, in A1125's CI (#2238, 2026-10-29), while the merge still used the download
action. Since A1216 the merge runs `scripts/download-coverage-blobs.mjs`, which keeps the
highest-id copy of each report name. Check on a throwaway branch (fail one shard on purpose,
re-run it, read which artifact id the helper downloads) that the highest id is the re-run's. If
it is, delete this entry; if not, make the helper keep the re-run's copy.

## Two setup-app checks for an absent error message cannot fail (left open by A1176)

`apps/setup/src/setup-app-missing-database.test.ts`'s "a damaged record reaches the
confirmation" case and the activity re-read case that checks for `initialOwnerStrings.en.error`
read the page's own text, but those messages are drawn only inside `wt-form-actions`' shadow
root. Read the form errors too, as `shown()` in `setup-app-held-refusals.test.ts` does, and
prove each check by injecting the message. Found by reading, not run.

## The mutation report downloads still use `actions/download-artifact`

Left open by A1216; shared added by A1272. `mutation-ui-core-aggregate`, `mutation-ui-aggregate`,
`mutation-db-aggregate` and CI's `mutation-shared-aggregate` fetch
`mutation-report-*-shard-*` directories. The coverage downloader accepts only coverage blob
names and writes one flat directory, while the mutation aggregate counts report directories.
Measure the mutation downloads before replacing their bounded action retries.
[Receipt](../developers/ci-and-gates.md#a-completed-transfer-can-still-leave-the-download-action-alive).

## A1307 follow-up: the file-progress reporter's tests set up a page with two near-copies of one helper

`scripts/vitest-file-progress.test.mjs` gained a second page-and-module setup beside the
existing one in #2395, and two of its new cases sit apart from the cases they extend. Fold the
new setup into the existing helper and move the two cases beside their neighbours; no assertion
changes.

## Shared logo retry checks use the retained timing list

`packages/ui/src/components/wt-venue-logo.retry.test.ts`'s `requests` helper reads
`performance.getEntriesByName`. By reading, it has the same bounded-observation shape that
A1332 reproduced in the till's logo check. Reproduce the primitive suite with a full timing
buffer, then retain its exact retry assertions while changing the observation. A1332 changed
only the till check; it did not qualify or change these sibling cases.

## The logo retry check can outwait its test deadline

`apps/till/src/widgets/till-shell.venue-logo.test.ts`'s `requestsReach` waits up to 300 animation
frames. A1332's run-it review measured 66–70 ms frames: the request wait then exceeds the
15-second test deadline, so a missing request can produce only a timeout before its count
assertion runs. The retry-disabled controls still detect the missing retry; they do not establish
that its count assertion always reports first. Reproduce the throttled-frame case before choosing
a wall-clock-bounded observation; keep the retry schedule, request assertions and existing case
deadline. The related `await failed` can also await a missing event until the case times out.

## Store bound-value test timeout

On 4 November, A790's first CI run
[41879243123, light-a job126747319929](https://github.com/clintongormley/waitron/actions/runs/41879243123/job/126747319929)
timed out after 5,000 ms in `packages/store/src/index.test.ts:648`, “refuses a statement binding
one value more on the reader and the writer of both files”. Its other 319 store cases passed.
The log does not locate the slow phase. The entire store source tree is byte-identical between
A790's base `e0da0ad18a` and failed head `87d06fc39e`; the focused local file passed 54 cases.
That local pass does not explain or repair the CI failure.

The investigation read 94 earlier failed-run logs among the latest 100 failed CI runs; five
historical logs were unavailable and the remaining run was this occurrence. No matching prior
failure was found in the logs read. Do not call it a known flake or a branch regression from
that search alone. Retain timings for opening the store, constructing the large query and each
reader/writer call on a comparable Linux runner. Preserve every bound-value assertion and locate
the slow work before changing the fixture or its deadline. A790's campaign receipt is
`receipts/a790-cut-a-20261104/unresolved-ci-classification.json`; the root-cause fix remains open.

## Till logo retry missing request

A790's 4 November CI runs 41879243123 and 41886182380 counted one request instead of two.
The observation mechanism was reproduced and corrected by A1332 (#2458); see
[Count image requests as they are delivered](../developers/testing-guide.md#count-image-requests-as-they-are-delivered).
The shared-logo and deadline qualifications remain in the logo retry bundle above.
