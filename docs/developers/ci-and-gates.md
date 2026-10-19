# CI and gates

This file holds the evidence behind Waitron's test gates: the mechanisms, the measurements, the
exact commands, and the incident that paid for each rule. The one-line versions of these rules
live in the repo root `CLAUDE.md`, section 2 ("The gate"), which points here. Read this file
before touching CI, the pre-push hook, or the test gates, or when you need to check a claim
against its receipt.

The rules below fall into four rough groups: the gate commands themselves (the shallow check and
the pre-push hook), the CI job layout and scheduling, the pnpm filter traps, and the concurrency /
machine-resource rules, plus a migration-upgrade group: its coverage, how its stall report works, and
why it keeps its database in memory.

## The optional whole-workspace check

Run focused behavior tests during implementation. Use this broader local command when investigating
a failure or shared behavior, not as an automatic requirement for finishing a branch:

```bash
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
```

That is the shallow, whole-workspace check. Root `test` / `test:coverage` cap package concurrency
at two and enforce a 20-minute process deadline
(`scripts/run-with-deadline.mjs`). CI test jobs and shard legs have a 10-minute job limit, and merge jobs 5; each light bin also
caps package concurrency at two. Direct package commands retain their Vitest timers.

## The pre-push hook

The pre-push hook (`.husky/pre-push`) checks sign-offs, runs
`pnpm install --frozen-lockfile`, `format:check`, lint and the root guards with coverage, then
`typecheck` over changed packages and their dependents. `scripts/changed-packages.mjs` resolves
the scope for both the hook and CI. Before anything else the hook refreshes `origin/main` from
`origin`, giving up after 20 seconds plus the deadline runner's 5-second grace
(`WAITRON_PRE_PUSH_FETCH_SECONDS` sets the 20, so a test can shorten it). When that works, the sign-off check leaves out commits already on `origin/main`. When
it fails (no remote, no network, no `main` there, or the limit), the hook says so and does not leave
main's commits out of the sign-off range. A new branch's range still starts at its merge base with the local
`origin/main`, so for a new branch a failed refresh leaves open the hole the next section describes. The typecheck
scope below reads whatever `origin/main` the checkout has either way. For a ref the remote already has, the typecheck scope is
what the push changes since the remote's old tip, plus the branch's own changes since its merge base
with `origin/main` when that merge base exists and differs from the old tip. A new ref is scoped
from its merge base with `origin/main`. Package tests and coverage run in CI; the root guards stay
local because they check the machinery that decides what runs. CI also runs mutation testing and
`bundle-smoke`.

### Why the sign-off check leaves out main's commits, and why only a refreshed main

An existing remote ref makes the hook use its remote tip as the range base. After a rebase onto
newer main, that range holds main's commits as well as the branch's, and some of main's commits
carry no sign-off (A376's squash `6797bc03a` among them), so before A392 (#1421) such a push was refused for a commit that was not its own.
Measured 2026-10-08 for A231p part 1, candidate
`dccc28a1575993028aba265d5932eeb7e3f6a116`: `scripts/check-signoff.sh` passed the 34 commits
from main `dd8510d005843474daedcd61b95625b7ad4cf7dd` to that candidate. It failed the 67-commit
push range from old remote tip `8adba929fde4faa3256412bf2d7d0c5269aab419`, naming only
main's A376 squash `6797bc03a8c5770718a6fdc1efca7fdd397c6092`. `git show -s --format=%B`
for that squash contained no `Signed-off-by` trailer. The normal push stopped before installation,
formatting, lint, root coverage or types.

The hook used to trust the checkout's own `origin/main`. In #1421's review, an unsigned commit put
by hand on a local `origin/main` that the remote lacked passed the hook. A successful refresh (A411)
closes that; a failed one does not for a new branch. `scripts/pre-push.test.mjs` holds the
already-pushed case.

Licence.yml's `dco` job checks every pull request's commits, and since A411 every push to `main`
too, from the push's previous tip to its new one. That run is the one that sees a direct push to
`main` (documentation goes that way) made with the hook skipped, and the squash commit GitHub
writes when a pull request merges, which no hook ever sees: `6797bc03a` reached `main` unsigned
that way. A push that creates `main` (its previous tip is all zeros), and one whose previous tip
the checkout does not have, name no range the job can list, and each fails rather than passing
unchecked; `scripts/check-signoff.test.mjs` runs the step against both.

### What `bundle-smoke` does NOT cover: the three front-end bundles

`bundle-smoke` runs the build scripts of two packages, `@waitron/credentials` and `@waitron/server`,
and every bundle they produce is an esbuild bundle. **Nothing in that job, or in any other job a
front-end-only pull request runs, executes `vite build`.** In CI, the dashboard, setup and till
bundles are built only inside `deploy/Dockerfile` — and on a pull request the `image` job carries
`needs.changes.outputs.deploy == 'true'`, so it runs only when the pull request changed an image
input: a path under `deploy/`, or a file `IMAGE_SMOKE_FILES` names (`scripts/changed-scope.mjs`),
which `isImageInputPath` in the same file reads. A change under
`apps/till/src` therefore reaches a main push before anything in CI builds its bundle. Locally the
root `build` script does run all three, which is how this branch got its evidence.

Three hedges, because the gap is both narrower and wider than it first reads. Narrower on the
trigger: `image` builds all three on a pull request that happens to change an image input, and on
every code-gated main push. Narrower again: the Dockerfile is also built by `publish` on a push and nightly
by `image-nightly.yml`, which exists precisely as the safety net for this scoping and says so in its
own header — so all three SPAs are built daily against the default branch. Wider, and this is the
part a reader is most likely to assume away: every one of those paths only BUILDS them. Nothing
opens one, so a bundle that compiles and then renders nothing passes everywhere.

This was first recorded on 2026-08-27, in the plan behind #146 (its item R6), which called a
cross-front-end build-smoke "a separate later cleanup". It was still uncleaned when the vite 6 → 8
upgrade replaced the bundler underneath all three apps (Rolldown and Oxc for Rollup and esbuild),
which is the change it would most have been wanted for; that upgrade's build evidence had to be
taken locally instead. `docs/backlog.md` carries the work item.

A machinery-only push (`scripts/`, `.husky/`, `.github/`) is `scope=root` and stops after the root
guards — unless it changes a file `ROOT_SCOPE_CONSUMERS` (`scripts/changed-scope.mjs`) names, which
also selects the members listed against it (those that read it, or whose CI test job runs it) and
their dependents, or a file `GLOBAL_ROOT_FILES` there names (the test-progress reporter every CI
test command loads), which typechecks the whole workspace here and runs every package in CI. A documentation-only push stops after formatting. Deletion-only pushes run no
checks. Unknown ranges keep the full local gate, including workspace typechecking.

The hook no longer runs `pnpm reap`, and what is left to run it by hand FOR has narrowed to one of
its two halves. `pnpm reap` (`scripts/reap-testcontainers.mjs`) removes stale containers and, as a
separate pass, kills orphaned vitest workers and parentless test binaries a checkout keeps in a
`.bin` — Litestream and the S3 test server (`isTestBinaryProcess`). **The container half no longer has a subject in any
package suite.** It matches the `com.waitron.reapable` label alone, and
`grep -rn com.waitron.reapable` over the repository on 2026-09-23 finds exactly one stamp outside
that script and its own suite — `bench/sqlite-failover/src/store.ts:75`, a `.withLabels({...})` on
the MinIO container `startStore` brings up — in a bench that declares no `test` script at all, so
no suite under `packages/` or `apps/` can leave a container for it to find. **The worker half's vitest
case has nothing to do with the storage engine:** an interrupted vitest run still reparents
its workers to ppid 1, where they spin at ~100% CPU until killed. So the occasion to run it is after
an interrupted run of ANY suite, not before a database one.

**What that grep does NOT say is that the labelled rig is the only container starter, and an earlier
version of this paragraph said so.** `bench/pglite-throughput/src/bench.ts:331` starts a real
`postgres:18-alpine` through `PostgreSqlContainer` and chains no `.withLabels` at all, so an
interrupted run of that rig leaks a container the reaper's label filter can never match. Clear it by
hand — `docker ps -a --filter ancestor=postgres:18-alpine`, then `docker rm -f` what that names,
after `docker volume inspect` on anything attached. Measured on this machine on 2026-09-23: that
filter named leaked `postgres:18-alpine` containers, and `docker inspect --format
'{{json .Config.Labels}}'` on each printed `{}` — no `com.waitron.reapable`, so the reaper would
indeed have walked past them. Neither bench declares a `test` script — `pnpm-workspace.yaml` says
that is on purpose — so this only bites someone who ran the rig by hand. `docs/backlog.md` carries
the open choice between stamping the label there and keeping the by-hand cleanup.

Run the normal hook once through the push, then verify CI scope and required checks on the current
head. A green hook proves only its own checks; it is not evidence of package tests or coverage.
Owner decision 2026-09-12: stop duplicating mandatory package coverage locally before waiting for CI.
The shell regressions in `scripts/pre-push.test.mjs` exercise scope and failure behavior.

**Claude never pushes with `--no-verify`**; the owner may, in an emergency (owner decision
2026-10-03), and the failure still has to be fixed because CI runs the same checks. The hook's
failure message says so beside its skip hint, pinned by `scripts/pre-push.test.mjs`. A hook failure the PR does not reproduce is a check CI has deferred to the
unfiltered `main` run, not a wrong hook.

## Coverage thresholds: one bar for every package

**Every package, and the root project, holds `statements 98 / lines 98 / functions 98 / branches
95`** (owner decision 2026-09-23). That retired the split of 2026-09-05, which reserved the high bar
for the fiscal core and the data-layer foundations on the grounds of consequence, and put every
other package, browser packages included, at a `90/90/85/85` floor. The owner chose the whole bar
over two narrower answers to the questions task T3 left open — raising only the floor's functions
minimum, to 95 or to 90. Each package under it was brought up in a pull request of its own (listed
below), and on 2026-09-24, once none was left on it, the floor was removed from the guard and
retired as policy: live prose mentions it only as retired, and dated history still records it. A new
package holds the bar from its first commit.

First promotion PR #498 (21 packages); then one pull request each: `printing` (#500), `bookings`
(#503), `tunnel` (#506), `print-agent-app` (#508), `provisioning` (#510), `payments-sumup` (#512),
`payments-stripe` (#514), `server-kit` (#515), `sync-enrolment` (#518), `dashboard-kit` (#521),
`fiscal-none` (#522), `setup` (#523), `print-agent` (#525), `identity` (#526), `catalogue` (#530),
`apps/server` (#534), `apps/till` (#536), `apps/dashboard` (#538), `venue-service` (#546) and
`media` (#547).

The bar is negotiable only where the rest of a package's gap could be closed solely by tests that
assert nothing useful (owner, 2026-09-23: "we never want to add junk tests just to meet a coverage
bar. the tests added must actually test something useful."). The promotions also worked under a
rule of their own, which stands: a gap is never closed by hiding code a test could reach — adding an
exclude or an ignore comment over it, or moving it under `src/testing/`.

`scripts/coverage-thresholds.test.ts` pins it from the root project, because a package's own config
decides whether its tests run at all. It is weaker than its name in four ways. It reads each
config's `thresholds` literal as TEXT rather than importing the config. It never reads a config's
`coverage.exclude` or any ignore comment, so a newly added exclude passes it. It checks the members
`pnpm ls` lists minus `PACKAGES_WITHOUT_TESTS` (`scripts/changed-scope.mjs`), so a member named
there is outside it. And its check that `pnpm ls` returned the workspace is only that the names in
`EXPECTED_MEMBERS` (one per workspace folder holding tested members) are listed and that the list
meets `MIN_TESTED_MEMBERS`, a loose minimum well under today's count — which stops an empty list
from passing having read nothing, but lets a listing that drops a few other members pass.

The root project keeps the high bar. Its `coverage.include` names `scripts/**/*.mjs` plus
`packages/db/src/english-only.ts`, so its table is the root's own non-test `.mjs` scripts — among
them the two classifiers that decide what CI and the hook run — and the vocabulary module. Every
`.ts` file under `scripts/` but one is a guard SUITE, which Vitest leaves out of its own table
whatever `coverage.include` says; the exception is `scripts/dev-server-proxy.ts`, and the T3
subsection below says what it costs to leave it where it is.

### The first promotion — measured 2026-09-23

`pnpm -r --no-bail --workspace-concurrency=4 test:coverage` on `9cd2fda58`: green in all 46 members
that run coverage, 1,066 test files and 13,811 tests. Every member's
`coverage/coverage-summary.json` was read, and none holds a path outside its own package directory
(the sibling-prefix leak described below). **21 packages cleared `98/98/98/95` on all four metrics
and were promoted together**, joining the five already there: `composition`, `country`,
`country-es`, `country-gb`, `country-packs`, `credentials`, `dashboard-modules`, `diagnostics`,
`fiscal`, `layouts`, `membership`, `migrations`, `module`, `purchasing`, `recipes`, `reporting`,
`scheduler`, `shared`, `ui`, `workforce` and `workforce-es` — as measured that day. The nearest to its new bar is
`scheduler`, 1.22 points over on statements; eighteen of the 21 are at 100% on all four.

The 20 still under it, with the metric furthest below its bar — `printing` (functions, 1.23 short),
`catalogue` (statements, 1.64), `bookings` (branches, 1.99), `tunnel` (functions, 2.48),
`apps/server` (branches, 2.95), `apps/till` (branches, 3.10), `apps/print-agent` (branches, 3.65),
`provisioning` (functions, 3.77), `payments-sumup` (functions, 3.89), `payments-stripe`
(functions, 4.67), `server-kit` (branches, 5.00), `sync-enrolment` (functions, 5.15),
`apps/dashboard` (branches, 6.16), `dashboard-kit` (branches, 6.34), `fiscal-none` (functions,
6.34), `apps/setup` (functions, 6.42), `print-agent` (functions, 6.54), `identity` (branches, 7.38),
`media` (branches, 7.80) and `venue-service` (branches, 8.07). These are one day's figures, not a
standing list: the package's own `test:coverage` table is the receipt for any of them.

### What the storage switch did to the bars — measured 2026-09-23 (task T3)

Recorded before the owner's 2026-09-23 decision: which package holds which bar below is as it
stood then, before the first promotion above.

**No bar moved, and the reason is that the workspace did not shrink.** Both whole-tree runs were
taken on `c33a4bc11`, T2's backlog pointer: `pnpm -r test:coverage` green in all 46 members that run
coverage (1,065 test files, 13,784 tests, no threshold failure), and `pnpm vitest run --coverage`
green at the root (54 test files, 3,255 tests, over a coverage table of eight files). #493 landed 14
more packages' worth of change while this was being written, so those 14 were re-measured on top of
it and not one per-package figure below moved. The root project reads 3,256 there rather than 3,255,
and the extra test is not a mystery: `scripts/module-seams.test.ts` runs one `it.each` case per
non-test source file under `packages/*/src` and `apps/*/src`, and #493 added
`packages/store/src/connections.ts`.

The tree is the same size either side of the flip. Summing the blob sizes of every `.ts` file under
`packages/*/src` and `apps/*/src` whose name does not end `.test.ts`: 8,323 KB over 1,013 files at
`320f1dc08`, the commit before the flip, and 8,359 KB over 987 files on the tree this branch merges
into — the deletions and the new code very nearly cancel. (`c33a4bc11` reads 8,339 over 986; #493
added one file between them, which is how a sloppier version of this paragraph came to quote a figure
from one tree and a commit name from another.) Re-run it with

```
git ls-tree -r -l <ref> | awk -F'\t' '$2 ~ "^(packages|apps)/[^/]+/src/" && $2 ~ "[.]ts$" && $2 !~ "[.]test[.]ts$" { split($1, f, " "); n += f[4]; c++ } END { printf "%.0f KB over %d files\n", n/1024, c }'
```

and per package by grouping on the first two path segments. Four packages shrank by more than a
tenth: `packages/provisioning` by 32% (195,783 to 132,840 bytes), `packages/recipes` by 21%,
`packages/purchasing` by 14% and `packages/workforce-es` by 14%. Provisioning is the large one, and
it lost `waitron-provision instance`; it still clears the floor by 7.7 points on statements, and
the other three are at 100% on all four metrics. One package is new, `packages/store`, at 100% on
all four against the high bar.

**The high bar is the one doing the work, and which metric binds differs by package** — worth saying
because it is easy to assume branches always binds, and it does not. Taking each package's smallest
margin over its own bar: `fiscal-verifactu` 0.85 on STATEMENTS, `db` 0.86 on branches, `payments`
1.43 on statements, `core` 1.48 on LINES, `venue-service` 1.93 on branches, `store` 2.00 on
statements, and the root project 1.07 on branches. Five of the six PACKAGES in that list are the five
high-bar packages themselves; the sixth is `venue-service`, and at the floor it is the only package
within two points of any bar it holds. The root project's 1.07 sits outside that ranking — it is a
project, not a package, and it holds the high bar over a table of eight files.

**Two traps were checked rather than assumed**, both of them the shape where a passing report is
measuring the wrong files:

- **The `coverage.include` sibling leak** — Vitest 4 calls a file external only when its absolute
  path does not `startsWith` the package directory, with no trailing slash, so
  `packages/sync-enrolment`'s files once landed in `packages/sync`'s report. Every one of the 46
  `coverage-summary.json` files was read and none holds a path outside its own package directory;
  four package names prefix a sibling's today — `country`, `fiscal`, `payments` and `workforce`,
  eight pairs between them — and none of them leaked.
- **Harness-move inflation** — nine configs exclude `src/testing/**` (eight packages and
  `apps/server`), so code moved there stops being measured while the percentage rises. Across the
  same range, `src/testing/` shrank in eight of those nine: the switch deleted harness rather than
  adding it, which is the safe direction. The ninth, `packages/venue-service`, has no `src/testing/`
  at either ref — its exclude is pre-emptive. One package's `src/testing/` DID grow,
  `packages/fiscal` by about a kilobyte, and it is not one of the nine, so nothing was hidden there
  either.

**One source file is measured by no coverage table, and it now says so in the one place that could
mislead.** `scripts/dev-server-proxy.ts` is real source — the three front-ends' `vite.config.ts`
import it — and the root project's `coverage.include` names `scripts/**/*.mjs`, not `*.ts`. The
config's comment justified that by claiming every `.ts` under `scripts/` is a guard suite, which is
false by that one file. Widening the include to `scripts/**/*.ts` was tried and measured: the root
project reads 99.71/95.18/100/100 with it — still green, but 0.18 over its branch bar instead of
1.07. Both branches it adds are easy to EXECUTE and hard to ASSERT, in different ways.

- **`resolve(configured)` makes no observable difference**, because `existsSync` already resolves a
  relative path against the working directory. Measured 2026-09-23. A case was added to
  `scripts/dev-proxy-config.test.ts` pointing `WAITRON_STATE_DIR` at the suite's own state directory
  spelled relative to the repository root, which vitest runs from:

  ```ts
  // `relative` has to be added to the file's `node:path` import; it has only `join` today.
  process.env.WAITRON_STATE_DIR = relative(REPO_ROOT, stateDir);
  expect(devServerProxy()).toEqual({ target: "https://127.0.0.1:8080", secure: false });
  ```

  Then the control: replacing `isAbsolute(configured) ? configured : resolve(configured)` with plain
  `configured` left that case green, and the suite's two existing cases with it. The case was never
  committed — a test whose control does not bite is a false receipt (CLAUDE.md §1). It does execute
  the ternary's second arm, so it would move the branch count; what it cannot do is fail when the
  behaviour it names is removed.
- **The `WAITRON_STATE_DIR` fallback** to `apps/server/src/state` runs whenever the variable is
  unset, so a test reaches it by doing nothing. Asserting on it is the awkward part: its answer
  cannot be told apart from any other leafless directory unless a TLS leaf exists at that path,
  which is the box's real state directory in a developer's checkout. The run-it reviewer showed the
  third way — copy the module into a temporary directory, give THAT copy's default path a leaf, and
  the assertion discriminates, because `DEFAULT_STATE_DIR` is derived from
  `import.meta.url`. That proves the logic; it does not exercise the shipped file's own default.

So the include is unchanged. What naming the file would COST is 0.89 of the root project's branch
margin — 1.07 down to 0.18 — in exchange for one test that asserts nothing (`resolve`) and one that
must either write into the box's state directory or exercise a copy of the module. The config
comment now carries that reason instead of the claim it used to make. The obvious
alternative nobody has taken: `isAbsolute(configured) ? configured : resolve(configured)` has no
observable effect at all, so deleting it would remove the unassertable branch outright — a change to
dev tooling rather than to a coverage bar, which is why T3 did not make it. The alternative worth
considering, and not taken here because it is a refactor rather than a bar decision, is to move the
file into a package where its coverage would count.

## Mutation floors, and where each one actually bites

A mutation run makes one small change to a source file at a time and reruns the tests; a change
nothing notices is behaviour no test is checking. `thresholds.break` turns that score into a gate.
Three packages carry `"thresholds": { "high": 95, "low": 90, "break": 90 }` —
`packages/shared` since July 2026, `packages/fiscal` under the owner's 2026-09-19 decision that the
target is 90 everywhere, and `packages/ui-core` since its extraction (#519, 2026-09-23).
`packages/db` and `packages/ui` carry no `break` in their own configs, deliberately: CI splits each
run into shards (ten for db, thirty for ui), each passed its own `--mutate` list, so a
`thresholds.break` there would gate one slice rather than the package. Their bars live in the
`mutation-db-aggregate` and `mutation-ui-aggregate` jobs instead, each of which merges its package's
shard reports and scores them once. ui held its bar in its own config from 2026-09-19 until A539
moved it to the merged score, when one job stopped fitting its 185-minute limit.

Where each failure arrives differs, which is the part a session gets wrong:

| package | what runs it | when a drop below 90 is seen |
| --- | --- | --- |
| `shared` | `mutation-shared` in `.github/workflows/ci.yml` | a pull request whose resolved scope contains the package; on `main` the scope is `global`, so always |
| `ui-core` | the `mutation` matrix in `.github/workflows/mutation.yml` | the nightly run, or one dispatched by hand — a branch that thins a UI test goes green and reddens the next night |
| `ui` | the sharded `mutation-ui` matrix plus `mutation-ui-aggregate`, both in `.github/workflows/mutation.yml` | the nightly run, or one dispatched by hand, on the merged score of the thirty shards — a single shard's own slice is never gated, and a LOCAL `pnpm --filter @waitron/ui mutation` prints a score and gates nothing |
| `fiscal` | nothing in CI | only a local `pnpm --filter @waitron/fiscal mutation` |
| `db` | the sharded `mutation-db` matrix plus `mutation-db-aggregate`, both in `.github/workflows/mutation.yml` | the nightly run, or one dispatched by hand, on the merged score of the ten shards — a single shard's own slice is never gated, and a LOCAL `pnpm --filter @waitron/db mutation` prints a score and gates nothing |

Four hedges worth carrying. `packages/fiscal`'s `mutate` list names two source files, so its floor
is not a package-wide one. Neither is `packages/db`'s, for a smaller reason: one file is out of its
`mutate` set — `src/english-only.ts`, whose only suite lives in the root vitest project and which
nothing under `packages/db` imports, so every one of its mutants survives by construction. The
receipt is the `!src/english-only.ts` entry in `packages/db/stryker.config.json`'s `mutate` list;
`scripts/mutation-shard.mjs` reads each sharded package's `mutate` list from that config rather than
keeping its own copy, and `scripts/mutation-shard.test.mjs` names `src/english-only.ts` as the one
file db's selection leaves out. Nor do ui's and db's merged scores count every mutant: one whose
span crosses a `HEAVY_FILES` range boundary is mutated by no shard — 2 in db and 26 in ui at the
2026-10-12 splits, as counted by that day's Codex review by instrumenting each split file whole and
by range. And `scripts/mutation-break-thresholds.test.mjs`, which pins which
package holds which bar, is weaker than its name: it reads `mutation.yml` as TEXT for db's and ui's
bars, so a step that reached the same command through a variable would be invisible to it.

`packages/shared`'s score is taken without `src/conventions.test.ts`: its `vitest.config.ts`
excludes that file whenever `STRYKER_MUTATOR_WORKER` is set, which Stryker 10 sets on the worker
processes it starts (`child-process-proxy.js` in `@stryker-mutator/core`). Stryker's vitest runner
runs only the suites vitest finds related to the mutated files (`vitest.related`, default true in
`@stryker-mutator/vitest-runner` 10.0.0), and in its sandbox each `src` file is the instrumented
copy, so a suite that reads the package's source as text reads Stryker's code once it imports a
`src` file.
Measured 2026-09-27: main's `conventions.test.ts` with one added `import "./sql-literal.js"` failed
Stryker's first test run on `expected '\nfunction stryNS_9fa48() {…' not to match /[-+*/%]/`;
unchanged, it was not run at all (that run counted 396 tests, the package's 449 less that file's
53), and neither was a probe suite whose only input was `?raw` source. Any mutation-tested package
with a suite that imports a mutated file and reads its package's `src` as text could read Stryker's
instrumented copies the same way — `packages/fiscal/src/no-hardcoded-margin.test.ts` imports `./clock.js`, which fiscal's
`mutate` list names, and reads `./*.ts` as raw text. Only `packages/shared` was checked.

### Mutation testing runs nightly at 05:00 UTC

Nightly rather than Mondays only (owner, 2026-10-12). A run is 43 jobs (ui's 30 shards, db's 10,
ui-core, and the two aggregates), and the account never ran more than 20 jobs at once from 6 to 12
October except for one instant that read 21 (every job that held a runner, from
`gh api 'repos/clintongormley/waitron/actions/runs?created=<day>&per_page=100' --paginate` and
`gh api repos/clintongormley/waitron/actions/runs/<id>/jobs?per_page=100&filter=all --paginate`, a
re-run attempt's repeated copies dropped). On dispatch run `38256003987`
(2026-10-12, 13:29 to 14:09 UTC) 18 of its jobs ran at once, and the 58 jobs other workflows created
during it waited a median of 330 s to start (90th percentile 737 s, longest 777 s, in pull-request
run `38257189737`). With no mutation run going, the 69 jobs created from 14:10 to 14:50 waited a
median of 3 s (longest 188 s), and the 33 from 12:20 to 13:00 a median of 3 s (longest 131 s).

The hour is chosen for that. Over 6 to 11 October the account sat at 20 running jobs for 2.2% of
the 05:00 UTC hour, the least of any hour, against 24.2% at 11:00 and 23.6% at 19:00; its jobs
started a median of 3 s after creation (90th percentile 77 s). 03:00 was about as quiet
(2.5%) but holds image-nightly; stripe-sandbox runs at 04:00 and CodeQL at 01:37. The 2026-10-12
scheduled run was created at 05:11.

### Reading `packages/db`'s score by hand

The ten shard reports are artifacts of the run, so the number can be read without waiting for the
job:

```
gh run download <run-id> -D /tmp/db-mut -p "mutation-report-db-shard-*"
node scripts/mutation-aggregate.mjs /tmp/db-mut --package db --shards 10 --break 90
```

Two things that script does deliberately, each because the obvious version was wrong. It keys a
mutant by its mutator, its replacement and BOTH ends of its span: `a && b` yields two
ConditionalExpression mutants that replace with `true` from the same start column, and keyed on
the start alone they merged — 21 of them on run 35504169506, 7 of those pairing a detected mutant
with an undetected one, so the score moved with the order the artifacts were listed in. And it
counts shard DIRECTORIES holding a recognisable report, not `*.json` files: a reviewer showed with
a constructed case that one stray json beside nine real reports made the count ten and hid a shard
whose job had failed.

A file with no counted mutants — every mutant in a status the score leaves out, or none at all —
has no score, so the table lists it as `not measured — <count per status>` whatever the `--break`
bar. On run 35528428168 (commit `3ad257b11`) the three such files, `src/change-feed.ts`,
`src/classification.ts` and `src/testing/venue-db.ts`, were every mutant `Ignored` as static
mutants, the deliberate kind from `"ignoreStatic": true` in `packages/db/stryker.config.json`. When
two shard reports give one mutant two statuses outside the score, a compile or run error is kept
over the others, so a broken measurement is not listed as a deliberate skip.

A test that loads a module with `import()` inside a case makes Stryker count that case as covering
the module's load-time code, so under `"ignoreStatic": true` the module's static mutants run against
that one case instead of being left out (the hybrid rule in `@stryker-mutator/core` 10.0.0,
`dist/src/mutants/mutant-test-planner.js`). Measured 2026-10-12 (A539): on main `6838acb1c`,
where `packages/db/src/schema/columns.test.ts` loaded `../index.js` that way, `pnpm exec stryker run
--mutate src/classification.ts,src/trigger-refusals.ts,src/venue-holder-identity.ts --force` in
`packages/db` left 229 and 15 mutants of the first two files `Survived`; with the import at the top
of the file, the same command (run by that day's Codex review) left them `Ignored`. db's merged
score read 85.47%, 85.23% and 86.00% on scheduled runs `36380351019`, `37267389722` and
`38206876422`, and 92.40% on run `38256003987`. `describeSchemaConformance`'s `reload` option
(`packages/db/src/testing/schema-conformance.ts`) loads a module inside a case on purpose, after
`vi.resetModules()`, so the cases that read the schema's declarations cover them.

Receipt for the `ui` floor (2026-09-20): before the tests that branch added, the package read
78.62% — 1658 of 2109 valid mutants — and the run exited 1 against the new threshold, which is the
gate proving itself rather than a floor set under a number. After them, four whole-package runs read
between 96.73% and 96.83% (2043 to 2045 of 2112) and all exited 0. Quote the range, not one figure:
the spread is mutants that TIME OUT, which Stryker counts as detected, and how many do moves with
whatever else the machine is running — 8 to 13 across those four runs.

## Moving harness code out of a `.test.ts` changes what gates it

Test files are not measured for coverage and are not mutated. Ordinary source files under `src/`
are measured for coverage where the package's `coverage.include` names them and its
`coverage.exclude` does not (several configs, `apps/server` among them, exclude `src/testing/**`),
and mutated where the package's Stryker `mutate` list reaches them. So moving a block of
test-support code out of a `.test.ts` and into a `src/testing/` module — a perfectly sensible thing
to do when several packages need it — can quietly hand that code to as many as two gates it was
never under. Neither shows up in the diff.

The first half of that is a measurement, not an assumption: the `coverage-summary.json` a
`pnpm --filter @waitron/db test:coverage` run writes under that package's `coverage/` directory
listed 69 files when it was read on 2026-09-23, and not one of them was a `.test.ts`. (It is not
backticked as a path here on purpose — `coverage/` is generated and gitignored, and
`scripts/claude-md-pointers.test.ts` would fail on a backticked path that is missing from a fresh
checkout.) The second half is config: `packages/db/stryker.config.json` takes `src/**/*.ts` and
subtracts `*.test.ts`.

**The coverage half.** `packages/db`'s `vitest.config.ts` deliberately does NOT exclude
`src/testing/**`, and says why at that line: it was once excluded wholesale as "harness code, not
product code", and that hid three helpers in it that no test executed at all. It is held to the same
thresholds as the rest of `src/`, the same bar every package holds — statements 98, lines 98,
functions 98, branches 95.

Measured on branch `feat/module-schema-conformance-guard`, 2026-09-23, with
`pnpm --filter @waitron/db test:coverage`. The suite machinery moved out of
`packages/db/src/schema/schema-conformance.test.ts` — which went from 505 lines to a call site of a
few dozen — and into `packages/db/src/testing/schema-conformance.ts`, with nothing else changed:

| `packages/db` | statements | branches | functions | lines |
| --- | --- | --- | --- | --- |
| before the move | 99.62 | 97.2 | 100 | 99.78 |
| after the move, no other change | 98.41 | 93.03 | 98.73 | 99.32 |

The second row exits 1: branches at 93.03 against a bar of 95.

**Where the package ended up.** Getting back above the bar took a unit suite written against the
moved code from inside `packages/db`. Measured 2026-09-23 on the finished branch with the same
command, exit 0:

| `packages/db`, finished | statements | branches | functions | lines |
| --- | --- | --- | --- | --- |
| 2026-09-23 | 99.13 | 95.86 | 99.16 | 99.83 |

Branches are the figure to carry, because branches are what the move cost: **95.86 against the hard
bar of 95, which is 232 of 242 covered — 0.86 of a percentage point of room.** Work the arithmetic
rather than trusting the adjective: three more uncovered branches added to that report (232 of 245)
reads 94.69 and fails, two (232 of 244) reads 95.08 and passes. So this package has roughly two
uncovered branches of slack, and a change that adds a few unreached `??` or `?.` to `src/` here can
redden the job on its own.

**The mutation half, which is invisible until the nightly run.** `packages/db/stryker.config.json` mutates
`src/**/*.ts` minus `*.test.ts` and minus `src/english-only.ts`, so the moved code enters the
mutation subject set too. On that branch `packages/db/src/testing/schema-conformance.ts` became the
largest mutation-eligible file in the package, about half as long again as
`packages/db/src/schema/sales.ts`. Recompute rather than trusting a figure written here:

```bash
find packages/db/src -name '*.ts' ! -name '*.test.ts' -exec wc -lc {} + | sort -k2 -nr | head
```

That matters because `sales.ts` is db's single entry in `scripts/mutation-shard.mjs`'s `HEAVY_FILES`
— the list of files split into line ranges so one file's cost spreads across several parallel jobs
instead of dominating one — and the reason recorded beside it is that it "alone ran 186min while
every other N=10 shard finished <=90min". Each range of a split file runs in a shard of its own,
and the packer spreads the other files over the remaining shards by their size in bytes.

`schema-conformance.ts` ran in db shard 4 on 2026-10-12 (`node scripts/mutation-shard.mjs db 4 10`
listed it),
which took 558 s on run `38241392066`, not the longest db shard (shard 10, 732 s), so it has no
`HEAVY_FILES` entry.

To see where the mutation half applies: `ls packages/*/stryker.config.json`, then read its `mutate`
list.

## CI job layout and scheduling

### CI's test jobs measure coverage, never plain `test`

Before calling a package green, verify its CI coverage result on the current head. Run
`pnpm --filter <pkg> test:coverage` locally when investigating a failure. There is no single `test`
job: `.github/workflows/ci.yml` runs `test-heavy` (`packages/db`) and `test-server`
(`apps/server`) as three-way and eleven-way file shards, each with a `-merge` job that enforces the thresholds on
the merged blob (#216) — the files that need either downloaded binary (the stream loop and pause tests, the S3 rehearsal
scenarios, the rehearsal's send gate and interrupt suites, and the S3 test server's suite) run in `test-server-stream` instead, whose
blob joins the same merge. `test-dashboard` and `test-venue-service` are four-way and `test-till`
two-way file shards in the same pattern, each with its own `-merge` job, so those three packages'
coverage bars are enforced in the merge job, not in a shard. Then the
dedicated mixed database/browser jobs (`test-fiscal-verifactu`, `test-bookings`, `test-media`, `test-payments-stripe`,
`test-payments-sumup`, `test-adjustments`, `test-staffing`), the unsharded browser jobs (`test-ui`, `test-setup`) and
`test-light-a` / `test-light-b` for everything else (bins in `scripts/changed-scope.mjs`). Vitest
`--shard` splits by FILE COUNT, so shard imbalance is the real limit, and `N` must never exceed a
package's test-file count (guard: "run no more shards than the package has test files" in
`scripts/ci-workflow.test.mjs`, weaker than its name — it counts files named `*.test.ts`, not what
the Vitest config includes).

The three browser packages were sharded because no CI test job should run past about four minutes
(owner, 2026-10-09); on main they took 510 s (dashboard), 469 s (venue service) and 294 s (till) on
average. A merge job installs no browser: `--merge-reports` runs no test. Measured 2026-10-09 on
apps/till, locally: `pnpm --filter "@waitron/till" test:shard --shard=1/2
--outputFile=.vitest-reports/blob-1.json` (112 files) and `--shard=2/2 …blob-2.json` (111 files)
read 81.54% and 86.63% statements alone; `PLAYWRIGHT_BROWSERS_PATH=<empty folder> pnpm --filter
"@waitron/till" test:merge` exited 0 with 223 files, 6,328 tests and 98.03 / 95.46 / 98.97 / 99.38
(statements / branches / functions / lines), the same as an unsharded `test:coverage`. The control,
one till test file run under the same empty folder, failed with "Executable doesn't exist".

The three browser packages' `test:merge` names a coverage provider of its own,
`scripts/vitest-shard-coverage-merge.mjs`: v8's, with only the merge changed. On Vitest 4.1.11 a
shard adds each `coverage.include` file it never loaded as an untested copy built by the server-side
transform, and for some functions that copy's end position differs from the browser-loaded one, so
a plain merge keeps both and the untested one is never hit. The error only ever LOWERS coverage.
The wrapper drops a file's untested copies wherever a shard loaded it, and keeps one, at zero, where
none did. Measured 2026-10-09 on `packages/venue-service`, four `test:shard` blobs: `pnpm test:merge`
exited 0 at 98.38 / 95.16 / 99.32 / 99.2, every count equal to an unsharded `pnpm test:coverage`;
`pnpm exec vitest --merge-reports .vitest-reports --coverage` exited 1 at 98.09 / 95.16 / 97.44 /
99.2 (functions 2,635 of 2,704 against 2,635 of 2,653). A throwaway source file no test loaded
appeared in the wrapper's json report with every count zero. On `apps/till`'s two blobs the plain
merge and the wrapper printed the same counts. On a Vitest upgrade, run a plain merge over a
browser package's blobs: if it gives the unsharded totals, delete the wrapper.

### Every package test job prints which file is running

Every `Run the … shard` step, and the stream tests' step, adds the reporter
`scripts/vitest-file-progress.mjs`. It prints a `[file-progress] start` line when a test file is
handed to a worker, an `end` line with its result and how long it took, and every 60 seconds a
`still running:` line for each file not yet finished. Vitest's default reporter, off a terminal,
names a file only when it finishes, so a job that hangs says nothing about where: on 2026-10-09
`test-dashboard` in PR #1474's run 37932573955 printed its last finished file at 13:01:18 and then
nothing until the job was cancelled at 13:04:44, about 13m47s after it started. Its cause was not
established. In browser mode a file's `start` line means it was handed
to a browser worker, which happens in batches, so it can come before the file is loaded. A
`test:coverage` command passes `--reporter=default` beside it, because a lone `--reporter` replaces
the default one; `test:shard` already names `default` and `blob`. Guard: the file-progress case in
`scripts/ci-workflow.test.mjs`, weaker than its name — it reads `ci.yml` as text, and finds a test
command only in a `Run the … shard` step or the stream step.

A file whose `end` line comes more than 90 seconds after its `start` line also gets a GitHub
warning annotation (`::warning title=Slow test file::`), because one file that long holds up its
shard (see "Every CI test job should finish in about 4 minutes" below). In browser mode that time can
include waiting to be loaded (above). It warns and never fails the job.

### The `ci` check passes only when every needed job succeeded or was skipped

The `ci` job has two steps, and each fails unless every needed job ended `success` or `skipped`;
any other value fails, including one nobody listed. The first reads `toJSON(needs)`. The second,
added by A276, reads the same jobs from GitHub's jobs API for this run attempt
(`repos/<repo>/actions/runs/<run_id>/attempts/<run_attempt>/jobs`, every page), and runs even when
the first has failed, so both print what they saw. GitHub's REST reference for "List jobs for a
workflow run attempt" (https://docs.github.com/en/rest/actions/workflow-jobs) says _"Anyone with
read access to the repository can use this endpoint."_ A workflow's `GITHUB_TOKEN` is, in
GitHub's words, _"a GitHub App installation access token"_
(https://docs.github.com/en/actions/concepts/security/github_token), and "Permissions required for
GitHub Apps" (https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps),
under 'Repository permissions for "Actions"', has the row
`` | `GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs` | read | UAT, IAT | ✗ | ``,
where IAT is that page's "installation access token". So the `ci` job alone holds `actions: read`,
the permission GitHub lists for that endpoint; a run without it was not tried.

The first step makes one exception to "skipped passes" (A452): when `changes` reports
`code == "true"` and a coverage merge job's own gate `"true"`, that merge job ending `skipped`
fails, with a message such as
`@waitron/db was selected but its coverage merge job test-heavy-merge was skipped`. A skipped merge
job for a selected package means that package's coverage bar was never checked. The step holds a
table naming every `-merge` job in ci.yml, each with the gate and package its own job reads. When some job also failed or was cancelled, the step stops on that failure's message first.
With no `changes` outputs to read, nothing counts as selected and this check does not fire; a
`changes` job that failed is already caught as a failure. The second step does not make this
check.

Why two. Until A274 the first step fired only on `failure` or `cancelled`, and that let a
cancellation through: in run 37368759185 attempt 1 (2026-10-05, PR head `4123486d0`),
`test-dashboard` was cancelled with "The job was not acquired by Runner of type hosted even after
multiple attempts" and `ci` finished green with its step skipped; run 37371194302 attempt 1 did the
same with twelve such jobs. Every superseded run's cancellations that evening did fire the old step,
and one of their logs printed `"result": "cancelled"`. GitHub's documentation (github/docs,
`content/actions/reference/workflows-and-actions/contexts.md`) says of `needs.<job_id>.result`:
_"Possible values are `success`, `failure`, `cancelled`, or `skipped`."_ The old step did not fire,
so a never-acquired job reached `ci` as neither `failure` nor `cancelled`: either `success` or
`skipped`, which the first step's allowlist passes as well, or a value outside those four. For that
same job the jobs API answered `"conclusion": "cancelled"` with `runner_id` 0, which the second step
fails: on 2026-10-06,
`gh api repos/clintongormley/waitron/actions/runs/37368759185/attempts/1/jobs?per_page=100` listed
`test-dashboard` with conclusion `cancelled` and `runner_id` 0, and `ci` with conclusion `success`.

How the second step reads the API. While no needed job sets a `name:`, a needed job's entries are
named by its id (`lint`), by its id and a matrix value (`test-heavy (1)`), or, for a job that calls
a reusable workflow, by its id and the inner job (`image / smoke`; plain `image` when it was
skipped); GitHub names a job by its `name:` when one is set (on 2026-10-06,
`gh api "repos/clintongormley/waitron/actions/runs/37435810196/attempts/1/jobs?per_page=100"`, a
`licence.yml` run, listed its two jobs as `Every commit is signed off` and
`LICENSE is unmodified Elastic License 2.0`), so the guard below fails if a needed job sets one.
A completed entry with any other conclusion fails at once. It tries again at thirty-second
intervals, twenty-one tries in all, when the API call fails, the number of jobs read differs from
its `total_count`, a needed job has no entry, or an entry is not yet completed, and fails when the
tries run out, so an API it cannot read fails the check rather than passing it. The step has a
twelve-minute limit (`timeout-minutes: 12`) inside a fifteen-minute job, so a call that hangs fails
the check when the step limit is reached. The step carries its own limit because GitHub's runner marks a timed-out step
failed: `actions/runner`'s `src/Runner.Worker/StepsRunner.cs` (branch `main`, fetched 2026-10-06)
reads, at lines 328 and 329,
`` step.ExecutionContext.Error($"The action '{step.DisplayName}' has timed out after {timeoutMinutes} minutes."); ``
and `step.ExecutionContext.Result = TaskResult.Failed;`. A job-level timeout instead ended
`cancelled` in the jobs API: `changes` in run 37425317943 and in run 37435424791 (attempt 1 of
each) has conclusion `cancelled` and the annotation "The job has exceeded the maximum execution
time of 1m0s". A step reaching its limit on GitHub was not run; its `failed` result is read from
the runner's source only. `gh api --paginate` prints each page as its own JSON object (measured 2026-10-06 with
gh 2.97.0: `per_page=10` on the 30 jobs of run 37432123633 printed three objects, each giving
`total_count` 30), and the step reads them all. A "re-run failed jobs" attempt lists every job of
the run under the new attempt, the ones not re-run carrying their earlier result, so such a
re-run's `ci` reads those results rather than missing them. Measured 2026-10-06:
`gh api --paginate "repos/clintongormley/waitron/actions/runs/37361632949/attempts/2/jobs?per_page=100"`
listed all 30 jobs with `total_count` 30; `lint` appeared with attempt 1's `started_at`
(2026-10-05T19:12:20Z) and runner, conclusion `success`, while `test-server-merge`, cancelled with
`runner_id` 0 in attempt 1, had been re-run (started 2026-10-05T21:40:45Z, conclusion `success`).
Run 37368759185 attempt 2 showed the same shape with 26 jobs.

`scripts/ci-workflow.test.mjs` runs each step's script: the first on sample `needs` results, the
second against a stand-in `gh` that serves sample pages and failures. Default-window cases use
twenty-one tries and a thirty-second delay through a stand-in `sleep` that records each wait.
They accept success on the last poll and reject a job still pending then, or an API that always
fails. The guard also fails if a needed job sets a `name:`. It runs the first step with each merge job skipped while its package is
selected, and compares the step's merge table with ci.yml's `-merge` jobs, reading both as text. GitHub alone evaluates `toJSON(needs)` and answers the API. That guard is
weaker than its name: it reads ci.yml as text, extracts each step by its `name:` and checks the
first step has no `if:` key, the second has `if: always()` and `timeout-minutes: 12`, the job has
`timeout-minutes: 15`, and each keeps its `env:` lines; an `if:` reaching a step another way — a job-level change, or YAML spelled
differently — is not seen, and neither what `toJSON(needs)` produces nor the API's real answers are
tested there.

**A674, 2026-10-16: allow a late API status to settle.** Main run
[`38573258715`, attempt 1](https://github.com/clintongormley/waitron/actions/runs/38573258715/attempts/1)
failed after six polls. Its `ci` job `115887527392` logged `not completed:
test-payments-stripe` from 13:44:52Z through 13:45:50Z on 2026-10-14. On 2026-10-16,
`gh api repos/clintongormley/waitron/actions/runs/38573258715/attempts/1/jobs` returned that
Stripe job (`115883881130`) as successful, with `completed_at` 13:39:39Z; all its steps had
ended by 13:39:36Z. The original `ci` log, retrieved through
`gh api --allow-escape-sequences repos/clintongormley/waitron/actions/jobs/115887527392/logs`,
still reported it pending 6 minutes 11 seconds after that recorded completion time. This does not
measure when the API finally caught up.

Twenty-one polls thirty seconds apart give ten minutes of waits from the first poll to the last.
That exceeds the observed lag and uses fewer calls than polling every ten seconds. The twelve-minute
step allows another two minutes for calls and processing; slow calls can still exhaust that step
before all polls run. The enclosing job's fifteen-minute limit leaves room for its first step and
setup. These are chosen margins, not a measured upper bound on GitHub's lag. You still get a failed
check if the API never settles, or as soon as a completed job has an unsuccessful conclusion.
The local tests run the workflow's shell and jq with controlled API answers and recorded waits;
they do not reproduce GitHub's lag or exercise a real twelve-minute step timeout.

On GitHub, A274 through throwaway pull request #1282: run 37424069355, every test job skipped →
`ci` passed; 37424588800, `changes` failed → `ci` failed; 37425317943, `changes` cancelled by its
own `timeout-minutes` → `ci` failed; 37425907838, the run cancelled by hand while `changes` ran →
`ci` failed. A276 through throwaway pull request #1284: run 37434757498, every test job skipped →
both steps passed, the second printing each needed job from the API; 37435424791, `lint` failed and
`changes` timed out → both steps failed, the second with `not succeeded or skipped: changes, lint`;
37435810561, `lint` asked for a runner label no runner has (`runs-on: a276-no-such-runner`) — the
API showed it `queued` with `runner_id` 0 for seven minutes, GitHub neither failing nor cancelling
it, and when the run was cancelled by hand it ended `cancelled` with `runner_id` 0 and both steps
failed. In that run `needs` also said `cancelled`, so it does not show the second step catching what
the first missed. GitHub's own "not acquired" cancellation, the 2026-10-05 case, could not be
produced on demand, so the second step has not been seen failing a run that `needs` passed.

### A shard can exit 1 with every one of its tests passing — RETIRED from CLAUDE.md

Taken out of `CLAUDE.md` §2 on 2026-09-25: on Vitest 4.1.11 this call has no timeout, measured
below. Kept as the receipt, not as a rule. Seen once, on Vitest 3.2.7: PR #414's first run
(run 35355113501, job 105632564989, `test-server (3)`) printed `Test Files 87 passed (87)` and
`Tests 1313 passed (1313)`, then `Errors 1 error`:

```
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
 ❯ Object.onTimeoutError  node_modules/.../vitest/dist/chunks/rpc.-pEldfrD.js
 ❯ Timeout._onTimeout     node_modules/.../vitest/dist/chunks/index.B521nVV-.js
```

and exited 1, which failed the aggregate `ci` job. `onTaskUpdate` is not a test: it is the call a
test worker makes to tell the main process a test finished, and on 3.2.7 that call failed the run if
it went unanswered for sixty seconds (birpc's `DEFAULT_TIMEOUT = 6e4`, which 3.2.7's fork pool never
overrides). Vitest 4.1.11 passes `timeout: -1` for that channel (`dist/chunks/rpc.MzXet3jl.js:117`),
and its bundled birpc starts a timer only for a timeout of zero or more
(`dist/chunks/index.Chj8NDwU.js:63`).

**The probe.** A one-test suite in a scratch directory outside the repository, with a reporter whose
`onTaskUpdate` withholds its answer for 75 seconds once a passing result arrives, run as
`node node_modules/vitest/vitest.mjs run` on Node v26.7.0 under the default fork pool. The failing
case prints `Errors 1 error` and a timeout on `onTaskUpdate` after about sixty seconds, and exits 1.

- The repository's installed Vitest 4.1.11 (linked into the scratch directory): `Tests 1 passed (1)`,
  `Duration 75.10s`, no error, exit 0. The run waited for the answer.
- Control, the same 4.1.11 installed from npm with that one `timeout: -1` edited to `timeout: 6e4`:
  `Error: [birpc] timeout on calling "onTaskUpdate"`, `Errors 1 error`, `Duration 60.17s`, exit 1.
- Control, Vitest 3.2.7 unedited: `Error: [vitest-worker]: Timeout calling "onTaskUpdate"`,
  `Errors 1 error`, `Duration 60.14s`, exit 1.

No Vitest config in the tree sets `pool`, so every project without browser mode runs this fork
pool, including the node projects of packages that also run a browser project. Browser mode's
channel was read, not run: `@vitest/browser` 4.1.11 also passes `timeout: -1`
(`dist/client.js:420`, `dist/index.js:3316`).

**What this does not settle:** why that one call went unanswered. The main process did not stall:
through the minute before the error it kept printing pass marks, for completed test files and for
slow tests listed under them, never more than 5.2 seconds apart, and the largest output gap
anywhere in the job was 21.9 seconds, during startup. The error is printed only in the end-of-run
unhandled-error block, after the last file completed, so the log does not show when the timeout
fired. Nobody found the cause, and the probe does not model it: it shows a late answer being waited
for, not one that never comes. A single-file variant whose reporter never answers printed the
file's `✓`, no `Test Files` or `Tests` summary, and was still waiting when an outer `gtimeout 180`
killed it (exit 124). So if the stall recurs on 4.1.11 and never clears, expect no summary and the
job cancelled by its `timeout-minutes` (`.github/workflows/ci.yml`); whether a shard's other
files still finish meanwhile was not shown. This is not the silent-shard case in
[testing-guide.md](testing-guide.md): there, tests were still unfinished; here they all finished.
Keep the job log before re-running.

### CI does not run every check on every push

The `changes` job skips the expensive `code`-gated jobs when every changed path is inert —
documentation, or root config no `code`-gated job reads (`.codex/`, `.vscode/`, the root
`.gitignore`, the root `.editorconfig`) — or is the repository's own machinery (`scope=root`:
`scripts/`, `.husky/`, `.github/`), and on a pull request narrows the shards and mutation jobs to
the changed packages and their dependents. A root file a member depends on is the exception — a
root file `ROOT_SCOPE_CONSUMERS` in `scripts/changed-scope.mjs` lists, because a member file reads
it or the ci.yml job that tests the member runs it first: that map selects those members, so its
change is `code=true`. A root file a ci.yml test command loads as a Vitest reporter
(`scripts/vitest-file-progress.mjs`) is in `GLOBAL_ROOT_FILES` instead, and its change runs
everything (`scope=global`): every tested member loads it, and a hand-kept list of them had to
gain every new package (A452). `scripts/root-scope-consumers.test.mjs` fails when a member file
starts reading an unlisted file, when a ci.yml job starts running an unlisted one before a member's
tests, or when a listed entry is neither; and when a reporter in a ci.yml test command is missing
from `GLOBAL_ROOT_FILES`, a file there is no such reporter, or one is also in
`ROOT_SCOPE_CONSUMERS`. That guard is weaker than its name: it reads
text, so in a member file only a relative `../scripts/…` spelling counts, a path built from parts
is invisible to it, and a comment spelling the path counts as a reference; in ci.yml, and no other
workflow, only a line starting `node scripts/…` counts, in a job that tests a member through one
quoted `pnpm --filter "<name>" test:shard` or `test:coverage` — so a script fed from a pipe does
not count, and a step an `if:` switches off does; a reporter counts only in a `--reporter=` flag
on a `pnpm … test:shard` or `test:coverage` line, never one set in a package's own config; and only
root `scripts/` is scanned.

`lint` (eslint and `format:check`) and `root-guards` (the repo-level Vitest project) are ungated
and run on every push, so a regression in a skipped path is caught there only as far as the root suites
exercise it.

A merge to `main` runs the unfiltered suite whenever its `code` output is true — anything but a
change made only of inert paths, documentation, or machinery neither `ROOT_SCOPE_CONSUMERS` nor
`GLOBAL_ROOT_FILES` lists;
that run verifies the narrowing. Read the `changes` job's `code`, `scope` and `packages` outputs
before treating a green PR as evidence about the workspace. Designed and built in #27.

### Two pushes to `main` must never share a concurrency group

A run that is still WAITING for its group is not protected by `cancel-in-progress: false`. GitHub's
own words, on its Actions concurrency page (read 2026-09-16,
<https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency>): _"When you limit
concurrency, by default only one run can be pending in a concurrency group—any additional pending
runs cancel the previous one."_ The newer arrival evicts the one already in line, and
`cancel-in-progress` never comes into it — that setting governs a run that has already started.

Cost, on 2026-09-16, in timestamps that are GitHub's own. PR #381 merged at 13:46:01 and its run
took eight minutes. PR #380 merged at 13:49:35 and, sharing the group, went pending behind it. The
`docs(backlog)` commit that follows every merge was pushed at 13:50:31, and at 13:50:33 the pending
run was cancelled. Evidence it never started:

```
$ gh api repos/:owner/:repo/actions/runs/35104425392/attempts/1/jobs --jq .total_count
0
```

The attempt is part of that command: the run was later re-run by hand, so the unqualified
`…/runs/35104425392/jobs` now answers for attempt 2 and shows a full job list. The other half of the
evidence is that the backlog commit's own jobs started at 13:54:09, three seconds after #381's run
ended at 13:54:06 — the group was serialising them.

The backlog commit's run then completed green, but it is documentation, so `changes.code` was false
and both `image` and `publish` were skipped. `:main` stayed on `sha-d0e0923`, the #381 merge, and
the printer work in #380 was in no image at all. The §2 unfiltered main suite for #380 never ran
either.

It had been happening for a long time, mostly hidden because the next code merge republished
`:main` soon after. This lists CANCELLED runs on `main`, which is a SUPERSET — a run somebody
cancelled by hand looks the same — and it cannot show the run described above any more, because
re-running that one by hand made its conclusion `success`:

```
gh run list --workflow CI --branch main --limit 300 \
  --json conclusion,displayTitle,headSha,createdAt \
  -q '.[] | select(.conclusion=="cancelled")'
```

On 2026-09-16 that returned 38 runs, the oldest at `2026-09-07T11:45:17Z` — and the oldest run in
the window at all was `2026-09-07T08:59:53Z`, so the `--limit` is what bounds that answer, not the
data. At `--limit 60` the same query returns 7 and reaches back two days, which is why the number
here is a reading of a window rather than a count of the thing.

The fix is separation, not a cancellation policy: on a push the group carries `github.run_id`, so a
push is never grouped with anything, and a pull request keeps the ref so a force-push still
supersedes the run it made stale. Guard: `scripts/ci-workflow.test.mjs`, which reads the block as
text — it pins how the expression is written, not what GitHub evaluates it to.

Cost: a code merge that got NO run at all — no image published, no unfiltered main suite, and
nothing red anywhere, so check after a merge that its own run exists.

**What the guard does not see.** The concurrency cases of `scripts/ci-workflow.test.mjs` read ci.yml
alone, as TEXT, so another workflow's group is not seen.

### Separated pushes overlap, so publishing asks before it takes `:main`

Two `main` runs now build at the same time, and the one that finishes LAST is not always the one
carrying the newest commit. A registry tag is last-write-wins, so the older run's publish would
retag `:main` and pull every box following that tag back onto an older image — a race the old
shared group hid, because a queue publishes in arrival order.

So the publish job asks `scripts/main-tag-guard.sh` before adding `:main`. It reads
`WAITRON_BUILD_ID` out of the image the tag currently points at, asks GitHub's compare endpoint
where that commit sits relative to this one, and answers `move` or `hold`. A `hold` still publishes
this commit's immutable `sha-` tag; it declines only to move `:main`.

**What that does and does not buy.** It is a question asked before the build, not a compare-and-swap
at the registry, so it covers the case this repository hits — a newer run that has ALREADY published
— and not two publishes in flight at the same instant, which remain last-write-wins.

The reads it makes were checked against the real registry on 2026-09-16, anonymously:

```
$ docker buildx imagetools inspect ghcr.io/clintongormley/waitron:main \
    --format '{{range .Image.Config.Env}}{{println .}}{{end}}'
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
…
WAITRON_BUILD_ID=1c57940203777e2a408258d34e363718c3d89181
…
$ docker buildx imagetools inspect ghcr.io/clintongormley/waitron:no-such-tag-xyz …
ERROR: ghcr.io/clintongormley/waitron:no-such-tag-xyz: not found
```

The build id above is what `:main` held at that moment, and a later merge has moved it since —
which is the tag doing its job. What the receipt is for is the two SHAPES: the template reads
the environment of a published image, and a missing tag says so in those words.

Three things that came out of those commands and are easy to get wrong:

- The template works on the published image even though it is an index carrying a provenance
  attestation, so no per-platform key is needed.
- The missing-tag match is that exact wording and nothing wider. `not found` on its own also appears
  in a missing credential helper, a proxy's 404 page and a missing `docker` binary, and reading any
  of those as "no tag yet" publishes the backwards tag the guard exists to prevent. A package that
  does not exist at all answers `403 Forbidden` instead, so the FIRST publish into a fresh package
  stops there and needs a person.
- **The print-agent image carries no `WAITRON_BUILD_ID`** — `deploy/Dockerfile` declares the build
  arg only in the app stage — so the guard reads the app image and the print-agent tag rides along
  on that decision.

The script fails rather than guessing. A transient registry error is repaired by the next merge, but
two states are NOT self-repairing: a `:main` carrying no build id, and one built from a commit this
repository's history does not contain (an image built outside CI, or a rewritten history). Both
wedge every later publish identically until `:main` is deleted or retagged by hand. Its suite,
`scripts/main-tag-guard.test.mjs`, runs the real script against a stubbed `docker` and `gh`.

### Every CI test job should finish in about 4 minutes

Owner decision (2026-10-09, restated 2026-10-11 in the watcher session: "if something regularly
takes 10 minutes it is not good, we want tests to max out at around 4 minutes" — "Each test group
≤ 4 min"): each CI test job, one shard of one package, should take about 4 minutes at most on a
normal runner. The whole run's wall time is not the target. The fix for a job over it is at its
cause: a shard holding one slow file (split the file or find why it is slow), too few shards for the
package, or slow setup. Never cut what a test checks to save time, and never move coverage or
mutation out of CI.

**Provisioning, 2026-10-19:** run `39267628062`, job `118111582827`, starts provisioning
at14:19:38Z and still starts another file at14:28:27Z, before cancellation at14:28:28Z.
Its log records70 completed files totalling520.5seconds. The largest is
`first-setup-empty-database.test.ts`,160.9seconds; the next is `cli-first-setup.test.ts`,52.3.
This is advancing serial work beyond the shared job's budget, not evidence of a stopped socket
or timer. The underlying cost of the largest file is not profiled by that log.

Provisioning now runs in six shards outside both light bins, with a separate coverage merge.
Its one-worker setting, test bodies and full coverage thresholds stay unchanged. The changes
job selects its dedicated gate, and the aggregate refuses a skipped merge when that gate is
selected. `scripts/ci-workflow.test.mjs` and `scripts/changed-scope.test.mjs` check the partition
and execute the aggregate refusal. All six local shards pass1,471 cases in73 files; the v8
merge retains the earlier full counts: S3725/3800, B2789/2884, F692/701 and L3333/3367.
Individual local shard wall times range from57.75 to134.90seconds, with two processes at a
time. The new layout still needs its own CI timing measurement.

Measured for A528 over the 42 successful `main` runs that ran the test jobs, up to run
38177927525 (2026-10-11), minutes from the jobs API:

| Job                 | Median | Worst | Of which the test step (median) |
| ------------------- | ------ | ----- | ------------------------------- |
| `test-server (5)`   | 5.3    | 5.9   | 4.6                             |
| `test-server (4)`   | 3.9    | 4.2   | 3.3                             |
| `test-server (2)`   | 3.7    | 4.1   | 3.1                             |
| `test-light-b`      | 3.6    | 3.8   | 3.0                             |
| `test-server (6)`   | 3.6    | 4.3   | 3.0                             |
| `test-light-a`      | 3.4    | 3.7   | 2.9                             |
| `test-dashboard (3)`| 3.4    | 4.1   | 2.8                             |

Every other test job's median was 3.2 minutes or less. The steps beside the test step (checkout,
pnpm, Node, install, the blob upload) took 0.5 to 0.7 minutes of each job.

`test-server (5)` held the two slowest files in the package, read from the shards' `[file-progress]`
lines in runs 38177927525, 38171667214 and 38170124439: `src/bill-payments.test.ts` (140.5–208.5 s) and
`src/boot.test.ts` (163.4–186.8 s). No other server file took more than 73.6 s.

- `bill-payments.test.ts` was slow in Vitest's own deep equality, not in the product: a CPU profile
  of a local run put most of its time in `@vitest/expect`'s `keys`, `eq` and
  `iterableEquality`. Its whole-table `toEqual`s read `print_jobs`, whose `payload` is a
  `Uint8Array`, and Vitest compares a typed array one element at a time. `apps/server` now registers
  an equality tester for byte arrays (`apps/server/src/testing/byte-equality.ts`, through the
  config's `setupFiles`) that compares two arrays of one constructor with `Buffer.compare`, and
  leaves equal bytes to Vitest when either array has an enumerable own key besides its indices,
  string or symbol. Measured locally with coverage: the file fell from 44.3 s to 6.4–7.3 s; with
  the tester, `print-api.test.ts`, `receipt-print.test.ts` and `till-api.receipt.test.ts` together
  took 24.2–29.6 s.
- `boot.test.ts` is real work — a CPU profile put about half of a local run in migrating fresh
  databases and about a sixth in deriving and generating keys — so it was split, test for test, into
  `boot.test.ts`, `boot.restore.test.ts` and `boot.setup-routes.test.ts` (17.9, 14.4 and 23.4 s
  locally, each file run alone, without coverage), with their shared helpers in
  `apps/server/src/testing/boot-harness.ts`. Vitest runs one file on one worker, so a file of that
  size set a floor under its shard.
- `test-server` went from six shards to eight. Vitest 4.1.11 assigns files to shards by the sha1 of
  each file's path, sorted and cut into equal COUNTS (`BaseSequencer.shard`), so which files share a
  shard is luck. A simulation of that split over the three runs' per-file times, with the two fixes
  above applied, left the busiest of six shards with about 870 s of file time (the old shard 5 held
  about 1,080 s, the old shard 2 about 740 s at a 3.7-minute median) and the busiest of eight with
  about 690 s. (Eleven since A801: see "Runners come in two speeds…" below.)

Guards, each weaker than the rule: the 90-second warning above names a slow FILE but never fails a
job; the "pin each sharded package's shard count" case in `scripts/ci-workflow.test.mjs` holds the
counts, not the times; and each test job's 10-minute `timeout-minutes` (the "bounds every test job"
case in the same file) is the only one that stops a job: GitHub cancels it at 10 minutes, which fails
the `ci` check. Nothing measures a job's time against 4 minutes.

### A job far over its usual time on unchanged code: read the runner's setup times first

A test job that runs several times its usual length can be a slow RUNNER rather than a slow file.
The tell is in the job's own log, before any test starts: the pnpm self-install
(npm's `added 1 package in …` line, printed while `scripts/ci-setup-pnpm.sh` runs) and `pnpm install` (`Done in …`) take
several times what they take on other runs, and then every file is slower by about the same factor.
A slow file is the opposite: setup as usual, one file stretched.

The two cases, both on 2026-10-16:

- Run 38947429454 attempt 1, `test-server (4)` (job 117130599004, region centralus), cancelled at its
  10-minute limit with 20 files finished. Its self-install took 6 s and its install 18.9 s; attempt 2
  on the same head (job 117136086883, also centralus) took 985 ms and 4 s, and passed in 2 min 49 s.
  For the 20 files both attempts finished, the `[file-progress]` times summed 1,766.4 s against
  265.0 s — 6.7 times — and no file was less than 4.4 or more than 7.3 times slower. No
  `provisioning.database_holder_frozen` line appears in attempt 1's log.
- Run 38932759150, `test-venue-service (1)` (job 117080878600, region eastus2): self-install 13 s and
  install 54.5 s, against 1 s and 3.1 s on run 38921822907's passing shard 1 (centralus). There the
  slowness also let the venue watchdog kill a test worker (testing-guide.md, "A file of synchronous
  database work gets no timer turn unless `useVenueDb` yields one", fixed in #1815).

How rare: over CI's latest 60 runs (created 2026-10-16 12:28:48Z to 19:59:00Z), every attempt (the
jobs API with `filter=all`), 1,084 `test-*` jobs other than the merge jobs ran; two took more than
twice their group's median successful time, and they are the two above. What made those runners
slow is inside GitHub's machine and not measured here; the region does not explain it, since
centralus served both the slow and the fast `test-server (4)`.

What is kept when it happens: the job log always carries the two setup times. A `test-venue-service`
shard cancelled at its limit also keeps its sampled load and memory (`resources.log`, "A failed
venue-service shard keeps its browser start-up record" below); no other test job samples the runner.

### Runners come in two speeds, and the busiest shard is the one that crosses 4 minutes

A801 (2026-10-18). `test-server (7)` ran 3.9, 3.6 and 4.0 minutes on the three `main` runs before
30498070b, then 5.8 to 6.1 on the five from 30498070b to 585719547, though 30498070b changed no file
under `apps/server`. Earlier `main` runs the same day had already taken 6.0 and 5.6 (4ce6c6523,
45ce9e66d).

- **Nothing in the shard changed.** Its `[file-progress]` lines on run 39051766762 (8fa9669ff, 4.0
  min) and run 39068745456 (bb69ea3ea, 6.1 min) name the same 92 files; every file was slower on the
  second, about 1.5 times, and Vitest's import time rose with it (130 s against 221 s). The two jobs'
  pnpm set-up and install steps were within a second of each other, so this is not the stalled
  runner of the section above.
- **The shards show two speeds.** Vitest's `Duration` for each server shard over seven `main` runs
  (39047556649 to 39071289190): shard 2 took 135–143 s or 202–221 s, shard 7 187–203 s or 316–326 s,
  1.5 to 1.65 times apart; most other shards split the same way, with a few runs in between. About
  four in five of the 56 shard jobs ran at the slower speed. Region does not decide it: centralus
  ran shard 4 at 149 s on one run and at 235 s on another. On pull-request runs the same day shard 7 took either 3.7–4.0 or
  5.6–6.1 minutes, which reads as five slower draws in a row on `main`, not a change.
- **Shard 7 holds the most work.** Vitest 4.1.11 sorts the files by the sha1 of each one's path
  under the package root (`/src/…`) and cuts the list into equal counts (`BaseSequencer.shard`). A
  replay of that split over run 39068745456's per-file times put the same 92 files in each shard as
  the run did, and shard 7 at 1,257 file-seconds against 818–969 for the others. On that run the
  other seven server shard jobs took 4.3–4.8 minutes.
- **About a third of that shard's work was scrypt, much of it test set-up.** A CPU profile of shard
  7's files run locally put `scryptSync` at about 30% of the busy time. Counting the calls (a
  temporary log in `hashSecret` and `verifySecretAsync`, locally without coverage): 3,516 hashes and
  1,210 checks, at about 32 ms each. The shared fixtures under `apps/server/src/testing/` hashed the
  same literal PINs and passwords for every test (`venue-fixtures.ts` alone 620 hashes, 20 s), and
  `restore.test.ts` encrypted the same backup artifact, with its N=2^17 key, for nearly every case.
  The largest single caller, `createJoinRequest` through `testing/enrol.ts` (691 hashes, 22.5 s), is
  the product minting a device token and stays.

The fix: `fixturePinHash` and `fixturePasswordHash` (`apps/server/src/testing/known-secret-hashes.ts`)
hash each distinct secret once per test file, the fixtures and the heaviest set-up functions use
them, and `restore.test.ts` encrypts each distinct archive once. On shard 7's 92 files locally, with
coverage and four workers, alternating old and new code twice on a busy machine (load average
14–22): 670 and 747 s of CPU before, 650 and 554 s after. `test-server` went from eight shards to eleven: the same
replay put the busiest of eleven at 864 file-seconds before the fixture change (nine: 1,136; ten:
953; twelve: 945, because a cluster of heavy files then falls together).

What this does not fix: `src/invoice-pdf.test.ts` took 162 s on run 39068745456, a floor under
whichever shard holds it. Local wall times were no guide here: the same old code took 138.7 s and
197.2 s on consecutive runs beside other sessions' tests.

### A cheap job can still be the critical path

The since-removed `mutation-verifactu` job was ungated because a mutant is cheap; on run 30650089655
it was 3m26s of a 4m8s run. Sort a run's jobs by duration before calling a job cheap enough to leave
ungated.

### Every job has a time limit

Every job in `.github/workflows/` carries `timeout-minutes`, because without one GitHub lets a job
run for six hours: github/docs `workflow-syntax.md`, `jobs.<job_id>.timeout-minutes`, "The maximum
number of minutes to let a job run before GitHub automatically cancels it. Default: 360". The one
stall that prompted this: PR #1399's image smoke sat 46 minutes on one cache layer download (run
`37743000577`, see "Neither image build uses the remote layer cache" below). A job that reaches its
limit ends `cancelled`, not `failed` — see "The `ci` check passes only when every needed job
succeeded or was skipped" above.

The rule: the longest measured run that ran to its end, times two, rounded up to the next multiple
of 5, and never under 5. A run that failed its own checks ran to its end and counts (ui's 90-minute
mutation run `37267389722` did); a cancelled run does not. The window: ci.yml's latest 264 runs, 2026-10-07 08:24
to 2026-10-08T09:03:33Z, read 2026-10-08; the other workflows' latest 30 runs; `mutation-db` only
since the SQLite switch (#489, 2026-09-23), because its earlier shards ran a different engine.

| file               | job                               | longest measured (min)         | limit |
| ------------------ | --------------------------------- | ------------------------------ | ----- |
| ci.yml             | changes                           | 0.9                            | 5     |
| ci.yml             | lint                              | 5.1 (root guards then included) | 8     |
| ci.yml             | root-guards                       | not yet measured               | 8     |
| ci.yml             | typecheck                         | 2.1                            | 5     |
| ci.yml             | mutation-shared                   | 3.1                            | 10    |
| ci.yml             | ci                                | 0.7                            | 15    |
| ci.yml             | publish                           | 3.2                            | 10    |
| image-smoke.yml    | smoke                             | 5.7 (run 37629651848)          | 15    |
| licence.yml        | licence-integrity                 | 0.2                            | 5     |
| licence.yml        | dco                               | 0.3                            | 5     |
| mutation.yml       | mutation (matrix ui-core)         | 5.3 (2026-10-05)               | 15    |
| mutation.yml       | mutation-ui (matrix shards)       | 23.7 (run 38256003987, slowest of 30) | 50    |
| mutation.yml       | mutation-ui-aggregate             | under 1 (run 38256003987)      | 5     |
| mutation.yml       | mutation-db (matrix shards)       | 8.8 (since the SQLite switch); 12.2 (run 38241392066) | 25    |
| mutation.yml       | mutation-db-aggregate             | 0.3                            | 5     |
| stripe-sandbox.yml | stripe-sandbox                    | 0.7                            | 5     |
| codeql.yml         | analyze (matrix of four languages) | 24.0 (javascript-typescript)  | 50    |

Test jobs and shard legs (10 minutes), `-merge` jobs (5), and `lint` and `root-guards` (8) are set
from the owner's four-minute bound (2026-10-09), not the doubling rule; the
"bounds every test job" case in `scripts/ci-workflow.test.mjs` pins those numbers.

**2026-10-16, A674:** `ci` is another exception to the doubling rule. Its limit rose from five
to fifteen minutes, with twelve minutes for its jobs API step, to accommodate a ten-minute retry
window. The observed API status lag and chosen margins are recorded under "How the second step
reads the API" above; the table's 0.7-minute measurement predates this change.

ui-core's figure is run `37267389722` (5m18s; its other two scheduled runs, `36380351019` and
`38206876422`, took 2m06s and 4m56s).
`mutation-ui`'s and `mutation-ui-aggregate`'s figures are dispatch run `38256003987`, with 30 ui
shards: the slowest shard (9, `wt-data-table.ts:1029-1285`) took 23.7
minutes and the aggregate under 1, so its limit is 50 by the doubling rule. The same shard took 17
minutes on run `38241392066`, before A539 added data-table tests. On
the previous run, `38233718266`, with 20 ui shards, `wt-combobox.ts` and `wt-dialog.ts` each reached
the 30-minute limit alone. Until A539 split it, ui ran inside the `mutation` matrix at a 185-minute
limit, which run `38206876422` reached and was cancelled at. `mutation-db`'s 8.8 is from runs `36380351019` and `37267389722`, the two scheduled runs from the
SQLite switch to 2026-10-05; on run `38241392066` its shards took 2.9 to 12.2 minutes (shard 10 longest, 732 s),
so its limit is 25 by the doubling rule.

codeql.yml's figure is from GitHub's default setup, before A488 replaced it: the 55 successful
`main` runs from 2026-10-10 09:16 to 2026-10-11 10:33 UTC, where the `javascript-typescript` job
took at most 24.0 minutes (run `38065526655`) and the other three at most 1.3. Those runs saved an
overlay-base database and codeql.yml does not, so its own durations may differ; re-measuring them is
the backlog entry "CodeQL's `timeout-minutes: 50` rests on the default setup's durations".

The `smoke` figure was measured while the remote layer cache was still in place; its limit is
checked again without it: the whole `smoke` job took 2.4 and 2.3 minutes in image-nightly runs
`37757851422` and `37758191291` (commit `642537ead`). The workflows' other jobs already carried their own
limits and are not in the table. A job that calls a reusable workflow (ci.yml's `image`,
image-nightly.yml's `smoke`) cannot carry `timeout-minutes` — it is not among the keywords github/docs
`reusing-workflow-configurations.md` lists for "the job containing the call" — so the called
workflow's own jobs carry it.

Guard: the "job time limits" cases in `scripts/ci-workflow.test.mjs`, weaker than its name — it reads
each workflow as TEXT by indent, so a flow-style job or a `timeout-minutes` written as an expression
is reported as unbounded, it does not judge whether the number is a sensible one, and it exempts
every job with a four-space `uses:`, relying on the called workflow's own jobs, which it reads only
when that workflow is one of this repository's `.github/workflows/` files.

### Every apt wait is bounded

Every `apt-get update` and `apt-get install` in a workflow, in `deploy/Dockerfile`, in
`deploy/waitron.sh` and in the bench's CA probe image (`bench/sqlite-failover/src/probes/linux-binaries.ts`)
runs under an outer `timeout`, and runs again when it stalls or exits non-zero (in the workflow, the
update and the install run again together), because apt's own read timeout did not end a wait on a
mirror sending a byte every 5 s. A workflow's `playwright install --with-deps` runs apt itself,
where no `-o` option on our command line reaches it, so it must run under `timeout <n>` too.

An `apt-get update` that could not connect, or timed out waiting, warned "Failed to fetch" and
exited 0 (apt 2.8.3 and 3.0.3), so a retry loop never saw it fail. The Dockerfile and the bench image
therefore also set `APT::Update::Error-Mode "any"`, which makes that update exit 100 and be retried.
`deploy/waitron.sh` does not: the box's apt sources are not ours, and a broken third-party index must
not fail an install that works without the setting.

The stall: main run `37771042263`, `image / smoke`, step "Load the print agent's AppArmor profile,
and put a stand-in BlueZ on the system bus", `sudo apt-get update`. From 11:36:22Z the log printed
nothing after

    Get:3 http://azure.archive.ubuntu.com/ubuntu noble-updates InRelease [126 kB]

until the job's 15-minute limit cancelled it.

Measured 2026-10-08 in an `ubuntu:24.04` container, apt 2.8.3, against a local listener on a docker
network, each run as `timeout 400 apt-get update`:

- a listener that accepts and never answers: apt gave up after 247 s, with a warning and exit 0;
- one that sends an HTTP 200 head and then nothing: apt gave up after 127 s;
- one that sends the head and then one byte every 5 s: still waiting at 400 s, having printed only
  `Get:1 http://a422-trickle:8099/ubuntu noble InRelease [200 kB]` — the same shape as the CI log.

apt's own read timeout did not end a wait in which a byte arrived every 5 s; an outer limit does.

Normal duration of the whole AppArmor/BlueZ step (apt included) over 29 green runs: median 10 s,
longest 24 s.

The limits chosen:

- In `image-smoke.yml` the apt calls have a step of their own with `timeout-minutes: 8` (the job's
  limit is 15). Each attempt is `timeout 60` for the update and `timeout 90` for the install, with
  `Acquire::Retries=3` and `Acquire::http::Timeout=30` / `Acquire::https::Timeout=30`, up to three
  attempts: at most 3 × (60 + 90) = 450 s, under the step's 480 s.
- In `deploy/Dockerfile` each apt-get goes through a `bounded()` wrapper: `timeout 300` per attempt,
  three attempts, with the same apt settings written to `/etc/apt/apt.conf.d/99bounded-waits` and
  removed again in the same `RUN`, so the image ships no apt setting. 300 s rather than CI's 60-90 s,
  because `deploy/waitron.sh install <ref>` builds this same file on the box, for a branch or
  commit, over whatever link the box has. In CI one stalled attempt costs 5 minutes and its retry
  fits inside `smoke`'s 15-minute job limit; three stalled attempts (900 s) do not, and the job's
  limit ends the build first. `publish` (`ci.yml`) builds both targets of the same file under a
  10-minute limit, so one stalled attempt there uses half of it. The bench's CA probe image uses the
  same wrapper and settings.
- In `deploy/waitron.sh`, `apt_get` is the wrapper: three attempts, each under `timeout` (or
  `gtimeout`) for 300 s for an update and 1800 s for an install, with `Acquire::Retries=3` and the
  two read timeouts on the command line, so nothing is written to the box. An install gets longer
  because Docker's packages are large enough that a slow box link can take more than 300 s to fetch.
  The script stops with a message after the third failed attempt, or before the first when neither
  timeout command is installed.

The same probe with the bound, run 2026-10-08 in the same containers. If the bound did nothing, the
trickling case would print nothing more after its `Get:1` line until an outside limit killed it, as
it did at 400 s above. The workflow step's loop, copied verbatim less `sudo`, run under `bash`:

- against the trickling listener: three attempts, each ended by `timeout 60` at 60, 120 and 180 s,
  then `apt-get failed or stalled on all three attempts` and exit 1 after 180 s;
- against the silent listener: the same, exit 1 after 180 s;
- control, against the image's own Ubuntu mirror: the update and the install of `bluez`,
  `python3-dbus` and `python3-gi` finished in 10 s, exit 0.

The Dockerfile's `bounded()` wrapper and settings file, copied verbatim, run under `sh` in a
`node:26-slim` container (Debian 13, apt 3.0.3):

- against the trickling listener: `bounded apt-get update` printed
  `attempt N of 3 failed or stalled: apt-get update` after each of its three 300 s attempts, N
  running 1 to 3, and the shell exited 1 after 900 s;
- control, against Debian's own mirror: `bounded apt-get update` and
  `bounded apt-get install -y --no-install-recommends python3-minimal` finished in 4 s, exit 0.

`APT::Update::Error-Mode "any"`, measured 2026-10-08 in `ubuntu:24.04` (apt 2.8.3) and `node:26-slim`
(apt 3.0.3), arm64, with the sources replaced by `deb http://127.0.0.1:9/debian trixie main`, a
closed port. If the setting did nothing, the bounded run would exit 0 after one attempt:

- without the setting, `apt-get update` printed `W: Failed to fetch … Connection refused` and exited
  0, in 7 s, in both images;
- with the settings file exactly as the Dockerfile writes it, it printed `E: Failed to fetch …` and
  exited 100, in 7 s;
- through the Dockerfile's `bounded()`, copied verbatim and run under `sh`, it printed
  `attempt N of 3 failed or stalled: apt-get update` three times and exited 1, in 21 s;
- control, the image's own sources with the same settings: one attempt, exit 0.

Guards: the "apt waits" and "playwright --with-deps waits" cases in `scripts/ci-workflow.test.mjs`,
and "the Dockerfile's apt waits" (which also reads the bench's CA probe image) and "waitron.sh's apt
waits" cases in `scripts/deploy-image-env.test.ts`, each weaker than its name — all read TEXT. The
`--with-deps` case asks only that the command holding it start with `timeout <n>` (after an
optional `if`, `!` or `sudo`) on the same line (a lone `&` ends a command; the `&` in `2>&1` does not), not for a retry. The waitron.sh case asks
that every `apt-get` outside a whole-line comment or a `command -v apt-get` sits inside `apt_get()`,
and that every `apt-get` in that body, other than one named inside quotes, runs under
`"$limit" <n>` in its own command; it does not run the shell. The numbers `apt_get` hands to `timeout`,
its retries and its stop are run with stubs (the `timeout` stub drops the limit, so no stall is ever
cut off) by "the apt_get wrapper inside waitron.sh" cases in `scripts/waitron-sh.test.mjs`. Both
workflow cases read steps through the same reader as the "apt installs" case, which takes the quotes
off a one-line `run: "…"` or `run: '…'` value. The apt waits case therefore misses every install
that case's comment lists as passing — among them apt run by a script the step calls, by a
composite or Docker action, by a tool itself (`playwright install --with-deps`, which only the
`--with-deps` case reads), or from a command
built from a variable — and it checks neither the retry loop nor the step's `timeout-minutes`. It
reads each line on its own, so a `timeout` at the end of a `\`-continued line is reported as
unbounded. The Dockerfile case sees only `apt-get` named in a `RUN`, does not check that `bounded()`
retries, and neither runs the shell nor judges the numbers.

### Every pnpm setup is bounded

Every workflow step that sets pnpm up runs `bash scripts/ci-setup-pnpm.sh` under
`timeout-minutes: 5`, never `pnpm/action-setup`. The script reads the version from `package.json`'s
`packageManager`, installs it with `npm install --global --prefix "$RUNNER_TEMP/pnpm-setup"`, checks
that the installed `pnpm --version` prints that version, and puts the prefix's `bin` on
`GITHUB_PATH`. Each npm attempt runs under `timeout` (60 s, `PNPM_SETUP_ATTEMPT_SECONDS`) with a
forced kill 10 s later (`PNPM_SETUP_KILL_SECONDS`); the version check has its own 10 s limit
(`PNPM_SETUP_VERSION_SECONDS`) with a 2 s kill, and a check that fails or is stopped fails the
attempt even when it printed the right version. Three attempts, then the step fails. Worst case
3 × (60 + 10) + 3 × (10 + 2) = 246 s, under the step's 300 s. In the jobs whose own limit is also
5 minutes (`changes`, `typecheck`, the `-merge` jobs and `stripe-sandbox`), that job limit
covers every other step too, so there a setup that needs its third attempt can still end with the
job cancelled.

The stall: main run `38799624567`, job `test-dashboard (2)`. `pnpm/action-setup@v6` printed
"Running self-installer..." and then nothing for 260 s; the next main run did the same shard in
3 min 39 s.

What the action does (source at tag v6, `f520eceda224fe1a4aed5a2a27a194379a409996`,
`src/install-pnpm/run.ts`): `npm ci` of a bootstrap pnpm from a lockfile committed in the action,
into `~/setup-pnpm`, then `pnpm self-update <version>` — two network fetches, neither under any time
limit. A `uses:` step can take `timeout-minutes`, so the action could be bounded in place; but a
retry would need a second copy of the step (`continue-on-error` and a conditional repeat) at every
site, and the two fetches inside the action cannot be bounded separately. So it was replaced.

Measured 2026-10-15: the `Run pnpm/action-setup@v6` step over the last 8 finished `ci.yml` runs on
`main`, from `gh api repos/{owner}/{repo}/actions/runs/<id>/jobs`, each step's
`completed_at - started_at` in whole seconds — 376 step records. Half took 1 s or less, 90% 7 s or
less, 95% 13 s or less; 15 took over 20 s (22, 31, 42, 60, 69, 75, 86, 98, 103, 115, 122, 132, 159,
226, 264), 11 of them over 60 s. The 60 s per attempt was chosen from these timings of the ACTION,
whose two fetches are not the script's one `npm install`; whether the slow ones were stalled or just
slow was not checked.

The control, `scripts/ci-setup-pnpm.test.mjs`, runs the real script under a stubbed `npm` that
sleeps 300 s, with a 1 s limit and a 1 s kill grace: it prints three
`attempt N of 3 failed or stalled` lines and exits 1 in under 15 s. With the `timeout` prefix taken
off the npm call, that case failed (2026-10-15). A second case uses a stub that ignores the polite
stop (`trap '' TERM`); with only `-k` taken off, it failed and the plain hang case still passed.

The cache moved. The action exported `PNPM_HOME=~/setup-pnpm/node_modules/.bin`, and pnpm 9.15.0
puts its store under `$PNPM_HOME/store/v3` when that is set (`PNPM_HOME=/tmp/fakehome pnpm store
path` printed `/tmp/fakehome/store/v3`, run 2026-10-15 on macOS). The script exports no `PNPM_HOME`,
so the store is at pnpm's default path, and `actions/setup-node`'s `cache: pnpm` entries saved under
the old path will most likely miss once per job until `main` has saved new ones; that was not
measured. The old entries are left for the cache's least-recently-used eviction.

A744 left image-build installs outside this workflow-setup change. **2026-10-16:** A745 adds
separate limits to the Dockerfile's two installs; see “The image build bounds its package installs”
below.

Guards: "the workflows' pnpm setups" in `scripts/ci-workflow.test.mjs`, weaker than its name — it
reads every workflow as TEXT and does not run it: no non-comment `uses: pnpm/action-setup`, a
`timeout-minutes` on every step running the script, and the setup before each job's first step that
runs `pnpm`. A setup in a composite action or a reusable workflow is invisible to it, and a `pnpm`
run by a script the step calls is not seen, and the step's `timeout-minutes` is not compared with
the script's worst case. `scripts/setup-node-pnpm.test.mjs` finds the setup only by a one-line
`run: bash scripts/ci-setup-pnpm.sh`. The script's behaviour — the bound, the kill
grace, the retries, the version check, refusing an empty `RUNNER_TEMP` or `GITHUB_PATH`, a
PATH with neither `gtimeout` nor `timeout`, and a `packageManager` that is not an exact version — is
run under a stubbed npm by `scripts/ci-setup-pnpm.test.mjs`; the real registry is never contacted
by it.

#### Give a healthy version check its normal allowance

When you simulate a stalled command, shorten the deadline only for that case. The pnpm setup
suite lets healthy version checks use the script's ten-second default; only its deliberately
hanging version check sets a one-second limit. The install-hang and ignored-stop cases retain
their own short install limits, and every child still has the thirty-second outer bound.

A746's controlled probe delays the first successful version check by two seconds. With the former
blanket one-second version limit, `pnpm exec vitest run scripts/ci-setup-pnpm.test.mjs -t 'slow
successful first version'` failed: installation succeeded on attempt 2 rather than the required
attempt 1. For this probe, a temporary wrapper on `PATH` invoked the real `gtimeout` with
`--verbose` and logged each call's exit status. That wrapper recorded TERM and exit 124 for the
first version check. The same added case in the full root run failed beside 6,694 passing cases. The unchanged root
baseline had passed all 6,694 cases, so this probe establishes the short-limit failure mechanism;
it does not establish why A737's original intermittent first check was delayed.

### The image build bounds its package installs

A hung package install can consume an image job's whole allowance. The build stage in
`deploy/Dockerfile` gives each `npm install --global pnpm@9.15.0` attempt 60 seconds and each
`pnpm install --frozen-lockfile` attempt 300 seconds. Both use `timeout -k 10`: ten seconds after
the first stop signal, a command that is still running is forcibly stopped. Each failed or
stopped attempt prints its number and command. The first successful attempt ends the loop;
a third failure stops that Dockerfile instruction.

Measured on 2026-10-16 from the first uncached build-stage records in each successful CI run's
`image / smoke` job log (`gh run view <run> --job <job> --log`):

| Run | Job | pnpm setup | Workspace install |
| --- | --- | --- | --- |
| 38830786806 | 116748974125 | 1.8 s | 12.9 s |
| 38843584366 | 116789076300 | 1.8 s | 13.9 s |
| 38846737878 | 116798959862 | 2.0 s | 13.8 s |

The 60-second setup limit allows thirty times this sample's longest setup. The workspace gets
five minutes because a box building a branch uses the same Dockerfile over its own link and
fetches the whole workspace. That allowance is about twenty-one times this sample's longest
workspace install; a slow-link box was not measured. These are per-attempt limits, not build
budgets. Including the kill grace, three setup attempts can take 210 seconds and three workspace
attempts 930 seconds. The CI smoke and publish jobs keep their existing 15- and 10-minute
limits, so their job limit can end the build before all retries finish.

The package-install cases in `scripts/deploy-image-env.test.ts` execute the two Dockerfile
`RUN` bodies under `sh`, with controlled npm and pnpm executables. Each install is checked for
success on attempt one, two and three; three ordinary failures; three hangs; and three installers
that ignore the first stop signal. A timeout adapter records and checks positive command limits
and kill graces, then uses the real timeout executable, shortening only the deliberate hangs to
one second plus a one-second kill grace. The suite checks the command arguments, attempt count,
exit status and whether the next shell command ran. It does not contact a registry, reproduce a
real package-manager hang, or judge whether the chosen production limits suit a particular link.
The image smoke checks the built image separately.

### The GHA cache is a shared per-repository budget, evicted least-recently-used

A new `cache-to: type=gha,mode=max` exporter does not merely cost its own bytes — it competes for
space against every other job's entries, and GitHub reclaims by evicting the least recently used.

Docker layers are what filled it: measured 2026-09-12, the total was at GitHub's 10 GB limit and
image blobs were roughly nine tenths of it, leaving the Playwright browser download and the pnpm
store caches that the test jobs restore to share the remainder. On 2026-10-08 at 09:26 UTC the total
was 11,296 MB, 9,154 MB of it in 941 `buildkit` entries. That was the second reason `publish`
dropped arm64 (`linux/amd64` alone, ci.yml): an emulated second platform's `mode=max` export put a
second set of image layers in on every merge to `main`. Since A399 no workflow exports Docker
layers; the `buildkit` entries already there are left for GitHub to evict, and the pnpm store and
Playwright entries remain.

On 2026-10-11 the cache was CodeQL's: `gh api "repos/:owner/:repo/actions/caches?per_page=100"
--paginate` listed 36 entries and 10,471,063,513 bytes, of which 34 entries and 10,021,766,320 bytes
were keyed `codeql-overlay-base-database-…`, about 1.2 GB for each JavaScript database. The rest was
one `playwright-Linux` entry (271 MB) and one `node-cache` entry (158 MB). GitHub's default setup
saved a database after every push to `main` so that pull-request scans could start from it. Since
A488 CodeQL runs from `codeql.yml`, nightly, and saves nothing (next section).

The total is `gh api repos/:owner/:repo/actions/cache/usage`, but it answers only "how full" — for
WHICH entries a new export competes with, list them with sizes and last-access times
(`gh api "repos/:owner/:repo/actions/caches?per_page=100" --paginate`, or `gh cache list`) and name
them before adding the export.

### CodeQL scans `main` nightly, and nothing waits for it

`.github/workflows/codeql.yml` runs at 01:37 UTC on the default branch and on request (`gh workflow
run codeql.yml --ref main`), never on a push or a pull request (owner, 2026-10-11, A488). Until then
it was GitHub's default setup, a repository setting with no file, which scanned every push to `main`
and every pull request. It scans the same four languages: `javascript-typescript`; `python`, which
on 2026-10-11 covered three scripts (`apps/print-agent/src/rfcomm-send.py`,
`packages/reporting/reference/generate-dr303-layout.py` and `scripts/fake-bluez.py`); `c-cpp`, which
then covered one file (`apps/server/src/testing/raster-reference/cups-reference.c`); and `actions`,
the workflows themselves. Each uses `build-mode: none`, as the default setup did, and the default
query suite. It uploads under the categories the default setup's analyses carry
(`/language:<language>`, read with `gh api
"repos/:owner/:repo/code-scanning/analyses?ref=refs/heads/main"`).

While the default setup is switched on, GitHub does not process its analyses and the analyze step
fails: `github/codeql-action` at tag `v4`, 2026-10-11, treats the processing error "CodeQL analyses
from advanced configurations cannot be processed when the default setup is enabled" as a
configuration error (`shouldConsiderConfigurationError`, `src/upload-lib.ts`), and the analyze step
waits for processing by default (`wait-for-processing`, `analyze/action.yml`). Read from the source,
not tried on this repository. `gh api repos/:owner/:repo/code-scanning/default-setup --jq .state`
must print `not-configured`; `gh api -X PATCH repos/:owner/:repo/code-scanning/default-setup -f
state=not-configured` switches it off.

It saves nothing to the Actions cache. `CODEQL_OVERLAY_DATABASE_MODE: none` stops the overlay-base
database, which only speeds up a pull-request scan, and `trap-caching: false` stops the TRAP cache,
which the action turns on by itself on a hosted runner when the overlay is off. Both read from
`github/codeql-action` at tag `v4`, 2026-10-11: `checkOverlayEnablement` and `isTrapCachingEnabled`
in `src/config-utils.ts`. Dependency caching is already off for a workflow file
(`getDependencyCachingEnabled`, `src/caching-utils.ts`). Guard: the "CodeQL's workflow" cases in
`scripts/ci-workflow.test.mjs`, weaker than their name — they read codeql.yml as text and do not
check what the action does with either switch.

### Neither image build uses the remote layer cache

Since A399, neither `image-smoke.yml`'s builds nor `publish`'s (ci.yml) import or export a
`type=gha` layer cache.

The import hit only layers before `COPY . .` in `deploy/Dockerfile`. In the image-nightly control
run `37722747608` it hit one layer of the app build, `npm install --global pnpm@9.15.0`, which took
1.8 s to build without it in run `37755993548`; every other layer of that build ran. In publish run
`37750748442` it hit that layer and `WORKDIR /src`, and `pnpm install` rebuilt even after the smoke
build of the same commit. "Build
the image" took a mean of 88 s and at most 127 s over 30 image-nightly runs with the import, and
110 s in run `37755993548` (commit `9ff673d12`) without the import but still exporting, of which
"preparing build cache for export" was 23.4 s. The export was about 17–23 s of every main build.
Without import or export, "Build the image" took 54 s and 55 s (image-nightly runs `37757851422`
and `37758191291`, commit `642537ead`, neither log naming `importing cache manifest` or
`preparing build cache for export`).

The one stall: measured 2026-10-08 on PR #1399, run `37743000577`, job `113198431831`, the cached
print-agent layer `sha256:6e14a6c2683e027cbf0f8e85962c02bf23fea4a97b588241ddac0b68fdc621b8`
reported `0B / 20.81MB` from 07:27:22 UTC until 08:13:06 UTC, then finished downloading
at 08:13:10 UTC. The same layer downloaded in 1.2 seconds in the earlier main-based
image-nightly run `37741541793`. The cause of the remote delay remains unverified.
Retrieve the logs with `gh api --allow-escape-sequences
repos/clintongormley/waitron/actions/jobs/113198431831/logs` and
`gh run view 37741541793 --log`.

### sharp and the server bundle

sharp, which shrinks uploaded photos (`packages/media/src/prepare.ts`), is a native addon that loads
libvips as a separate shared library, and esbuild does not refuse to bundle it. So every Node
bundle in the workspace is built by `scripts/bundle-node.mjs`, which passes `--external:sharp` to
every esbuild command it runs, and the box image carries sharp beside the bundle in
`/app/node_modules`. Measured 2026-09-23 with the repository's esbuild 0.28.2, when each package's
`build` script still spelled out its own esbuild commands:

- With `--external:sharp` removed from the `src/bin.ts` command, `pnpm --filter @waitron/server
  build` exited 0. The resulting `dist/server.js` held no `import("sharp")` and 24 lines naming
  `sharp-libvips`, and `node --check apps/server/dist/server.js` failed with `SyntaxError: Identifier
  'createRequire' has already been declared`: bundled sharp declares it a second time beside the
  `--banner:js` every command adds. The server would not start at all. `bundle-smoke`'s boot step
  would fail too, without naming why; its `grep -q 'import("sharp")'` step names it. With the flag
  back, the bundle held one `import("sharp")` and `node --check` passed.
- A stand-in entry calling `prepareImage` on a demo photo, bundled with the same flags and
  `--external:sharp`, loaded and then failed at the first shrink with `ERR_MODULE_NOT_FOUND: Cannot
  find package 'sharp'` when nothing was beside it. It shrank the photo once a flattened copy of
  `node_modules/.pnpm/sharp@0.35.4…/node_modules` was put beside it. The build stage of
  `deploy/Dockerfile` makes that copy (`/sharp-runtime`), and the runtime stage puts it at
  `/app/node_modules`.
- The provisioning bundle (`dist/bin.js` in `packages/provisioning`) reaches `@waitron/media` as well. Copied to a directory with no
  sharp anywhere above it, it printed its usage and exited 2, because `prepare.ts` imports sharp only
  when a photo is prepared.

**2026-10-07 update:** the shared banner imports `createRequire` as
`__waitronCreateRequire`, so an entry importing Node's `createRequire` can load alongside
the CommonJS shim. `pnpm exec vitest run scripts/bundle-node.test.mjs` first failed its new
load case with `Identifier 'createRequire' has already been declared`, then passed all 15
cases with the alias. The fixture also calls the shim; removing its declaration fails with
`Dynamic require of "node:path" is not supported`, while the package-licence control
passes. The 2026-09-23 duplicate-name failure above records the old banner. Sharp's separate
native runtime remains external.

In the image built from the Dockerfile on linux/arm64 (2026-09-23), run as uid 10001: sharp 0.35.4
loaded libvips 8.18.6 from `/app/node_modules`, and image-smoke's shrink script passed. With
`/app/node_modules` removed, `import("sharp")` failed `ERR_MODULE_NOT_FOUND`. `ldd` on the addon
resolved `libvips-cpp.so.8.18.6` to `@img/sharp-libvips-linux-arm64/lib/`, a separate file.
`/app/node_modules` was 23 MB, 2.7 MB of it `@types/node`, which pnpm links beside sharp for its
peer dependency and the copy follows. pnpm 9.15.0 had also installed the musl builds
(`@img+sharp-linuxmusl-arm64`, `@img+sharp-libvips-linuxmusl-arm64`) on that glibc machine; the build
stage deletes them. A linux/amd64 build of the same Dockerfile (`docker buildx build --platform
linux/amd64`, emulated on an arm64 Mac) carried `@img/sharp-linux-x64` and
`@img/sharp-libvips-linux-x64`, also 23 MB, and passed the same shrink script.

What the guards leave open. `scripts/deploy-image-env.test.ts` takes the flag from the shared
script's own argument builder, which it imports, so every command that script runs is covered. It
cannot see a bundle built some other way: it finds a direct `esbuild` call by reading each
workspace member's `package.json` scripts as TEXT, so a package script that runs a file of its own
which calls esbuild, or esbuild's JavaScript API, passes. `packages/ui-core`'s browser build is
built exactly that way (`packages/ui-core/scripts/build.mjs`) and reaches no sharp. The bundles
that can reach `@waitron/media` are named in the test rather than found: it pins that
`@waitron/server`'s and `@waitron/provisioning`'s `build` scripts name the shared script, so a NEW
member that reaches `@waitron/media` and bundles through something the first case cannot see — a
file of its own, another bundler, or esbuild reached by path — is not flagged. bundle-smoke's
`grep -q 'import("sharp")'` step reads the server bundle (`dist/server.js` in `apps/server`) only,
so the other bundles the server's `build` makes, and `waitron-provision` (`dist/bin.js` in
`packages/provisioning`), are not read by it.

### The stream loop and pause tests run in a job of their own, which downloads two binaries

`apps/server/src/stream-loop.e2e.test.ts` and `apps/server/src/stream-pause.e2e.test.ts` run in
`test-server-stream`, beside the `test-server` shards rather than inside one of them: each
shard's `test:shard` call passes `--exclude` for both files, which Vitest 4.1.11 adds to the
config's own `exclude` list rather than replacing it (`vitest list --filesOnly` in `apps/server`
listed 289 files without the two flags and 287 with them, and the config-excluded
`src/**/*.preprod.test.ts` file in neither, 2026-09-26). The S3 test server's own suite,
`apps/server/src/testing/s3-test-server.test.ts`, has cases that need versitygw too and is excluded
and run the same way (2026-09-30), and so are the Amazon S3 rehearsal's scenarios run against
versitygw, `apps/server/src/s3-rehearsal-scenarios.e2e.test.ts` (2026-10-14), and the
rehearsal's send gate and interrupt suites, `apps/server/src/aws-send-gate.e2e.test.ts` and
`apps/server/src/aws-rehearsal-interrupt.e2e.test.ts`.
`test-server-stream` runs
the same `test:shard` script over those files alone and uploads its blob as `server-blob-stream`,
which `test-server-merge`'s `server-blob-*` download picks up with the shards' blobs, so the
coverage gate counts what those tests reach. It alone runs `node scripts/setup-litestream.mjs` and
`node scripts/setup-s3-test-server.mjs`, because the cases that run them fail rather than skip in CI
without them; the S3 test server's suite runs versitygw alone, and only in some of its cases, and
the S3 rehearsal scenarios and the rehearsal's send gate and interrupt suites run versitygw alone in
every case
([testing-guide.md](testing-guide.md), "The stream loop test skips locally without its two
binaries, and a skip reads as a pass"). That is about 13.5 MB of Litestream and 27.5 MB of versitygw
for linux/amd64 (the release APIs' `size` fields, read 2026-09-25), from GitHub's release downloads,
each checked against a pinned SHA-256. Run locally with `CI=true` on the owner's Mac (2026-09-26),
that job's command took 72 seconds: the loop test 13 and the pause test 70, the two files running
side by side (`apps/server/vitest.config.ts` sets `maxWorkers: 4`). Guard:
`scripts/ci-workflow.test.mjs`, which reads `ci.yml` as TEXT. Its test step sets `TMPDIR=/dev/shm`
([testing-guide.md](testing-guide.md), "In CI their temporary files are in memory"), and a step
before it sets loopback's MTU to 1500
([testing-guide.md](testing-guide.md#the-stream-tests-ci-job-gives-loopback-a-normal-networks-packet-size));
the 2026-09-26 timings in this section were taken before either setting existed.

Measured on CI, one run each side (2026-09-26). After: run 36231025265, PR #682 at `81b07b698`.
Before: run 36229776393, `main` at `1821da0e0`, the last run before the change to execute the
server jobs. Times are each job's start to finish as GitHub reports them.

- `test-server-stream` took 103 s: 3 s for the two downloads, 78 s for the test step (Vitest's
  own `Duration` 77.15 s; the loop test 13.2 s, the pause test 72.1 s). The pause test filled the
  side file with 283 sales, from 5,586,752 to 17,353,472 bytes, in 16.9 s. On the shard before
  the change the same fill took 745 sales and 78.1 s, and A37's run for `464d9eca7` 895 sales and
  82 s.
- The three `test-server` shards took 123, 124 and 170 s, against 106, 130 and 242 s before; the
  pause test had been in the third. From the shards' start to the end of `test-server-merge` the
  server's jobs took 198 s, against 278 s before.
- Their `Test Files` counts were 96, 96 and 95, and with the stream job's 2 that makes 289, the
  total `test-server-merge` reported. Before, the shards held 97, 96 and 96.
- `test-server-merge` reported 289 files and 4,449 tests passed, none skipped, with both stream
  files among them, and the same coverage totals as before: 98.69% statements, 96.71% branches,
  98.7% functions, 99.02% lines.

They are not cached. On 2026-09-25 `gh api repos/:owner/:repo/actions/cache/usage` reported
11,174,362,480 bytes across 1,066 entries, and the plan's grouping of the entries on 2026-09-23 put
about nine tenths of that day's total in Docker layers; a new entry would compete under least-recently-used eviction
with the pnpm store and Playwright entries the test jobs restore (see "The GHA cache is a shared
per-repository budget, evicted least-recently-used" above). An error answer from a release download fails the job with a message
naming the URL. Since A399 (2026-10-08) no workflow exports Docker layers; the layers already
stored stay until GitHub evicts them (see "Neither image build uses the remote layer cache").

**A change to either installer alone selects `apps/server`**, because both are in
`ROOT_SCOPE_CONSUMERS` (`scripts/changed-scope.mjs`) against it. Checked
2026-09-26: `printf 'scripts/setup-litestream.mjs\n' | node scripts/changed-packages.mjs`, and the
same for `scripts/setup-s3-test-server.mjs`, each printed `code=true`, `scope=packages`,
`packages=@waitron/server`; and `pnpm --filter "...@waitron/server" ls --depth -1 --json | node
scripts/changed-scope.mjs`, the `changes` job's gate step for that scope, printed `server=true` with
every other gate false. `test-server`'s and `test-server-stream`'s `if:` ask for `code` and
`server` both true. On `main` the `changes` job forces `scope=global`, whose gate step prints every gate true. On a real pull
request, PR #682: its run for `1081bbb7c`, which changed `ci.yml`, docs and root scripts but neither
installer, skipped the shards and `test-server-stream`; its next run, 36231025265, for a commit
that added one line to `scripts/setup-litestream.mjs`, ran both and `test-server-merge`. The cost, read from the jobs' `if:` lines
in `.github/workflows/ci.yml`: on a pull request an installer change runs the server shards (three then, six from A441, eight from A528, eleven since A801),
`test-server-stream`, `test-server-merge`, and `typecheck` and `bundle-smoke`, which ask for
`code` alone; on its merge to `main` those two run again, the forced global scope runs every test job and `mutation-shared`, and
the push runs `image` and, once `ci` passes, `publish`, which moves `:main` unless
`scripts/main-tag-guard.sh` holds it for a newer commit.

**What the guard does not see.** `scripts/ci-workflow.test.mjs` is weaker than its name for the
`TMPDIR=/dev/shm` setting: it reads `ci.yml` as text, so a step an `if:` switches off, or a `run:`
that sets `TMPDIR` again, passes; and it never reads the step's test files, so one that makes its
scratch somewhere other than `tmpdir()` passes too.

## Two TypeScript compilers are installed, and that is deliberate

Since 2026-09-20 a package's `tsc` is **TypeScript 7** — the compiler rewritten in Go. Measured on
this workspace that day, `time pnpm typecheck` went from 2:05.51 to 28.7s. It is doing the same
work: a deliberate `const __probe: number = "not a number";` added to a package's `src/index.ts`
came back as `error TS2322`, and came back green when removed.

Version 7 does **not** ship the old JavaScript API. Its `.` export is a version stub, and the API
it does ship sits under `./unstable/*` — a different API, which no tool here reads yet:

```
$ node -e 'const ts = require("typescript"); console.log(Object.keys(ts), typeof ts.createProgram)'
[ 'version', 'versionMajorMinor' ] undefined
$ node -e 'console.log(Object.keys(require("typescript/package.json").exports))'
[ './package.json', '.', './unstable/sync', './unstable/async', './unstable/fs', './unstable/proto',
  './unstable/ast', './unstable/ast/is', './unstable/ast/factory', './unstable/ast/utils',
  './unstable/ast/scanner', './unstable/ast/visitor', './unstable/ast/clone' ]
```

The first command alone would print the same thing whether or not `./unstable/*` existed, which is
why the second one is here.

typescript-eslint 8.70.0 does not read either API from version 7 — it refuses the version outright,
before it loads its parser. `@typescript-eslint/parser/dist/index.js` reads `ts.versionMajorMinor` at
import time and throws when the major is 7 or above, so the refusal would happen even if version 7
had kept the whole old API. Its words, which are also what `pnpm lint` prints:

> typescript-eslint does not support TS 7.0.
> Please see https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0 to run typescript-eslint using the TS 6 API.
> See also https://github.com/typescript-eslint/typescript-eslint/issues/10940 for tracking typescript-eslint's support for TS >=7.1

So the ROOT `package.json` resolves the name `typescript` to `npm:@typescript/typescript6`, the
compatibility package Microsoft published for this. Their announcement, section *Running
Side-by-Side with TypeScript 6.0* (fetched with `curl -sL
https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/` on 2026-09-20 and read with
the HTML tags stripped, rather than through a summarising fetch — see the repository's rule about
quotes that turn out to be paraphrases):

> This package provides an executable named `tsc6`, so that if needed, you can install TypeScript
> 7.0 (which ships its own `tsc` binary) side-by-side without naming conflicts. The new package also
> re-exports the TypeScript 6.0 API, so that you can use `tsc` for TypeScript 7, while other tooling
> can continue to rely on 6.0.

The root is the only place that needs it, though not because ESLint only runs there — 47 manifests
declare `"lint": "eslint ."`. It is because `eslint` and `typescript-eslint` are declared in the ROOT
`package.json` and nowhere else, so whichever directory eslint is launched from, it is the root's
install reading the root's config and resolving `typescript` from the root. Two consequences a reader
will meet:

- **There is no `tsc` at the repository root.** `pnpm exec tsc` there answers `Command "tsc" not
  found`; the root's binary is `tsc6`. Measured 2026-09-20: root `tsc6` reports 6.0.3, every
  package's `tsc` reports 7.0.2. Both are declared as caret ranges, so re-measure rather than
  trusting those numbers. One reading trap: the root's `node_modules/typescript/package.json` says
  `6.0.2`. That is the alias shim's own version; it re-exports `@typescript/old`, which is
  `typescript@6.0.3`, and 6.0.3 is the compiler you actually get.
- **Raising the root entry to version 7 breaks `pnpm lint`,** with the message above and no lint
  results at all. Leave it on the alias until typescript-eslint's issue 10940 ships version 7
  support — the message names 7.1 as its target — then, after porting `scripts/comments-only.mjs`,
  `scripts/apply-migrations-callers.test.ts`, `scripts/pinned-actions-column.test.ts`,
  `scripts/native-form-fields.test.ts` and `scripts/screenshot-paths.test.ts` to version 7's API or keeping the alias for them,
  collapse both back to one plain range
  (`docs/backlog.md` → Dependency upgrades).

The root DOES therefore have a working TypeScript compiler API, at version 6, importable from the
root Vitest project. The root scripts that import it, `scripts/comments-only.mjs`,
`scripts/apply-migrations-callers.test.ts`, `scripts/pinned-actions-column.test.ts`,
`scripts/native-form-fields.test.ts` and `scripts/screenshot-paths.test.ts`, all parse with `ts.createSourceFile`. Two places had named its absence as the reason a guard
reads text instead of parsing — the header of `scripts/dashboard-browser-purity.test.ts`, and the
backlog note on `scripts/column-vocabulary.test.ts` — and both were corrected in the same change.

Beyond those scripts, lint and typechecking, nothing in the repository depends on which
compiler is installed, because **`tsc` is never asked to emit here**: every use of it is `tsc --noEmit` inside a
`typecheck` script, the bundles are esbuild's, and Vitest strips types without typechecking — a
claim the tree also makes in `packages/payments-stripe/src/wiring.test.ts`'s barrel test, and one
you can check directly by running a package's suite with no `tsc` involved. That is what bounds a
TypeScript bump's blast radius to `pnpm typecheck`, `pnpm lint`, `scripts/comments-only.mjs` with
its suite `scripts/comments-only.test.mjs`, `scripts/apply-migrations-callers.test.ts`,
`scripts/pinned-actions-column.test.ts`, `scripts/native-form-fields.test.ts` and
`scripts/screenshot-paths.test.ts`, every suite
among them in the root Vitest project.

One thing version 7 catches that 5.9.3 did not: a file imported by a relative path that climbs out
of its own package is `error TS6059` ("not under `rootDir`"). Exactly one **typechecked** file in
the tree did that — `apps/server/src/print-agent-e2e.test.ts`. Grepping will turn up three more
(`apps/dashboard/vite.config.ts`, `apps/setup/vite.config.ts` and `apps/till/vite.config.ts` each
import `../../scripts/dev-server-proxy.js`); those are silent only because all three tsconfigs set
`"include": ["src"]`, so the compiler never opens them — not because the rule spares them. The
compiler is the guard for this; no text-scanning guard was added.

The repair, so nobody tidies it away: the climb-out became a workspace subpath import, which is why
`apps/print-agent/package.json` carries a one-entry `exports` map naming `./tcp-probe.js` and
`apps/server` lists `@waitron/print-agent-app` among its test-only dependencies. Delete either and
the relative path is the only way back, along with `TS6059`.

## pnpm filter traps

### The pnpm changed-since filter silently matches nothing in a `git worktree`

Measured on pnpm 9.15.0, and all feature work here happens in one. Verify anything touching the
filter in a clone or on a real PR.

### `pnpm --filter ""` is a hard error

An unquoted `$PACKAGES` expansion still GLOBS even with `eval` gone (`pack*` →
`package.json packages`, measured in bash 3.2, busybox ash and bash 5.3). Both gates build filters
as positional parameters under `set -f … set +f`. What keeps that loop safe is that every member is
named `@waitron/<lowercase-and-hyphens>` — a property of today's manifests, not a rule (`npm pack`
accepts `pack*`).

### A scoped `pnpm` run that selects nothing REPORTS SUCCESS

`No projects matched` and `None of the selected packages has a "test:coverage" script` both exit 0.
CI checks the selection with `scripts/changed-packages.mjs runnable test:coverage`; the hook uses
`runnable typecheck`. The helper refuses an empty run unless every member is in
`PACKAGES_WITHOUT_TESTS` (`scripts/changed-scope.mjs`). Every current workspace member has a
`typecheck` script. A green selection guard alone does not mean a check ran.

### The workspace root is outside `pnpm -r`

Root config (`vitest.config.ts`, `scripts/`) is linted but never typechecked, and
`eslint.config.js` is not type-aware. Proven by mutation: an exported `const x: number = "no"` in
root config passes lint, typecheck and vitest.

### A name-filtered test run does not load the package's guard suites

Not the schema-ownership or error-code-reachability guard suites, nor any e2e suite pinning a
shared wire body with `toEqual`. SP-2b's `/hello` change passed `test sync-api` (11 tests) and
broke two boot suites for two tasks. A focused pass proves only the selected cases; CI supplies
package-wide coverage. Run additional consumer tests locally when useful for investigating shared behavior.

### Adding a workspace package breaks the root guards until it is wired in

Three guards in the root Vitest project read workspace members BY NAME, and the ungated `root-guards` job and
`.husky/pre-push` both run that project on every non-documentation push. So a new member that is not
wired in fails the hook, on a branch that may have nothing else wrong with it.

Measured twice, in both directions, on 2026-09-16 — adding `@waitron/bench-sqlite-failover`, then
taking the wiring away again. Unwired, exactly three files in the root project go red, and they are
the three named below; wired, the root project is green. The three:

- `scripts/changed-scope.test.mjs` — a member declaring no `test:coverage` script and not named in
  `PACKAGES_WITHOUT_TESTS` is a mistake, and this fails on it.
- `scripts/ci-workflow.test.mjs` — the shards must select every member exactly once; an unlisted
  member lands in both light bins.
- `scripts/coverage-thresholds.test.ts` — this one does not fail, it CRASHES, with `ENOENT` opening a
  `vitest.config.ts` the new package does not have. A crash rather than an assertion is worth knowing,
  because the message names a missing file and reads like a broken checkout rather than a missing
  registration.

What to wire, for an ordinary package with tests: a `vitest.config.ts` whose thresholds are
`98/98/98/95` (pinned by `scripts/coverage-thresholds.test.ts`), the shard lists
in `scripts/changed-scope.mjs` and `.github/workflows/ci.yml`. A package that declares no
`test:coverage` script at all — today only the two `bench/` members — additionally goes in
`PACKAGES_WITHOUT_TESTS`.

- A generic, English-only package must also be named in `GENERIC_PACKAGES`
  (`packages/db/src/english-only.ts`) and in its pinned copy in `scripts/english-only.test.ts`. No
  guard fails when it is left out: a package in neither that list nor a module's declared vocabulary
  is never scanned for Spanish words.

### A hardcoded cross-package list goes stale when a manifest or scope changes, and scoped CI hides it

Adding a member to `migrations.manifest.json`, `GENERIC_PACKAGES` or `OWN_SHARD_PACKAGES` left
tests in two OTHER packages red until an unrelated task ran them. Grep for tests that pin the list,
run those guards, and verify CI selects every affected consumer. Use a broader local run when
needed to investigate a failure.

A679's first push, 2026-10-19, found another form of this drift. Retiring the fiscal
custodian build removed its manifest's relative reference to `scripts/bundle-node.mjs`.
Two fiscal test helpers still executed that root script, using `../../scripts` from the
package working directory. `root-scope-consumers.test.mjs` resolves literal references from
the containing source file, so it saw neither helper as a root-script consumer and refused
the existing fiscal entry. The full hook reported 7,441 passes and that one failure.

Those helpers now use `fileURLToPath(new URL("../../../scripts/bundle-node.mjs", import.meta.url))`.
A direct path comparison resolves the same executable before and after; the unchanged consumer
guard passes all 22 cases and both real bundled-helper suites pass all 10. No list entry or
assertion was removed. This fixes those literal sites, not the scanner's documented inability
to trace computed paths or transitive root-script imports.

### After a rebase, the old-tip..new-tip diff can leave out the branch's own changes

Restacking a dashboard-only branch once printed `all checks passed (@waitron/till + dependents)`.
`scripts/pre-push.test.mjs` shows one way this happens: in its fixture, a branch already pushed
with a change to one package is rebased onto a main commit touching another, and
`git diff --name-only` from the remote's old tip to the new tip names only main's file — the
branch's own change is on both sides, so it cancels out. Whether that was the cause of the till
incident was not checked. The hook now adds the branch's own changes since it left `origin/main`
(its merge base with `origin/main`) to the scope, and the test asserts that both packages are
typechecked. With no `origin/main` in the checkout the hook keeps the old-tip diff alone. The PR's
own CI scopes off the PR diff.

## Concurrency and machine-resource rules

### Browser-mode packages run vitest in real headless Chromium

Browser-mode gates may run concurrently, within one session or across several: a browser run may
start beside another session's browser run when `memory_pressure` reports free memory well above
15% (owner decision 2026-09-24). What is not allowed is adding one beside a backgrounded
whole-workspace `pnpm -r test:coverage` — check what else is testing on the machine first.

The receipt is two 65 GB RAM spikes and a force-quit on 2026-08-30. In one, an implementer subagent
ran the till's browser gate while the controlling session ran verification gates and other subagents
were active; in the other, a backgrounded whole-workspace `pnpm -r test:coverage` ran beside review
and implementer subagents, with six Claude Code sessions open at once. The owner read both incidents
as several sessions testing at once, so one session's own package gates may still run in parallel
(owner decision 2026-09-06, retiring "one gate at a time"), and on 2026-09-24 the owner retired the
ban on starting beside another session's browser run too, keeping the measured-headroom check.

Concurrency is decided by measured headroom, never by a count: before a heavy run check free
memory (`memory_pressure | grep free`) and the heaviest processes
(`ps -axo rss,command | sort -nr | head`), then scale `--workspace-concurrency` to what is free.
Receipt: 77% of 64 GB free on 2026-09-06 with two review sessions, four vitest workers and two
Chromiums running.

### Chromium's launch depends on the Codex seat's PERMISSIONS, not on Codex

Sandboxed, it cannot start
(`bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer: Permission denied (1100)`,
measured 2026-09-06); with approved host execution, a direct Codex driver can run browser tests.
Receipt: on 2026-09-12, `pnpm --filter @waitron/dashboard test src/screens/payments-screen.test.ts`
passed in Chromium. Check host execution before deferring browser testing to another agent.

## Migration-upgrade test coverage

### A migration can fail on a database that already carries earlier migrations and what boot installed after them

Drizzle applies a set's pending migrations in one transaction, so a statement that is legal on a
fresh database — where the same batch creates everything it then names — can be refused on one that
already carries earlier migrations and whatever boot installed after them.

**2026-09-26.** The box took an image whose core `0013` drops `devices.has_cash_drawer` and failed
three starts with `error in trigger waitron_change_devices_update after drop column: no such column:
new.has_cash_drawer`. The change feed's update trigger names every column the table had when boot
installed it, and SQLite refuses to drop a column a trigger names. Every suite migrated a fresh
database before installing the feed, so none met it. The failed migration rolled back whole (the
box still had `has_cash_drawer` and lacked `print_agents.setup_port`, which the same migration
adds); deleting the feed's triggers and retrying started the box, and boot recreated all 285.
`applyMigrations` now removes the feed before migrating (`removeChangeFeed`,
`packages/db/src/change-feed.ts`).

`scripts/migration-upgrade.test.ts` walks one database through every shipped migration in date
order, installing the change feed between steps as boot does. Measured 2026-09-26: with
`removeChangeFeed(store.venue)` deleted from `packages/migrations/src/apply.ts`,
`pnpm exec vitest run scripts/migration-upgrade.test.ts` failed dropping
`working_order_lines.variant_id` (core `0006_drop_line_variant_id`) with
`no such column: new.variant_id`. Inferred from that, not run against a real box: a box that booted
before that migration would have failed the same way. The guard also meets the shape
[conventions-data.md](conventions-data.md#a-migration-set-depends-on-another-through-a-foreign-key-a-trigger-on-its-table-or-a-trigger-body-naming-its-table)
already records: core `0003_variant_inherited_nullable` rebuilds `products` while a trigger from
media's `0001_image_references` reads it in its body, and SQLite refuses the rename that ends the
rebuild (`error in trigger products_media_image_fk_parent_delete: no such table: main.products`).
The guard applies everything up to `0003` together for that reason; a future rebuild of a table
another set's trigger BODY reads fails it. Until A164 (2026-10-01) it seeded no rows, so a
migration that failed only on data passed it; the next section says what it carries now.

After `applyMigrations` removes the change feed, `installChangeFeed` in `apps/server/src/boot.ts`
reinstalls it. Cost, besides the box that failed three starts on 2026-09-26: an earlier bricked box
that was wiped.

### The upgrade test carries rows through every step

Since A164 (2026-10-01) `scripts/migration-upgrade.test.ts` tops every table up to two rows after
each step, reading that step's own schema: `pragma_table_info`, `pragma_foreign_key_list`, the
unique indexes, and the `CHECK (…)` bodies parsed out of the `CREATE TABLE` text. It writes them
on its own `node:sqlite` connection after the store has closed, with `foreign_keys` and
`recursive_triggers` on, so the file's foreign keys, CHECKs and triggers all apply. A column's
values come from its default, the literals a CHECK compares it with, a short generic list per
declared type, and `CANDIDATES` for the few columns a CHECK or trigger needs a particular shape
for; a search with conflict-directed backjumping picks a combination every CHECK and foreign key
accepts. A nullable column outside every unique index is null wherever its constraints allow, so a
rebuild that makes it required meets a null. The second row repeats the first wherever its constraints allow and differs in the
primary key and in every unique index over plain columns. Before the next step the row counts are recorded,
and a table that still exists afterwards holding fewer rows fails the step. A singleton
(`CHECK (id = 1)`) and the tables `ONE_ROW` names hold one row; at the end, every table but
drizzle's `__drizzle_migrations_*` bookkeeping must hold at least one.

What it was shown to catch, measured 2026-10-01 (Node v26.7.0, its SQLite 3.53.4) by planting a
migration at the end of the catalogue set and running
`pnpm exec vitest run scripts/migration-upgrade.test.ts`: each plant passed the guard as it stood
before A164 and failed it after.

- `ALTER TABLE labels ADD planted integer NOT NULL` — `Cannot add a NOT NULL column with default
  value NULL`. The same statement on an EMPTY table was accepted (measured in a bare `node:sqlite`
  script), which is why the old guard passed it.
- A drizzle-shaped rebuild of `labels` (create, copy, drop, rename), whose child `product_labels`
  cascades — `Step catalogue/0099_plant lost rows the step before wrote: product_labels: 2 rows
  before, 0 after`. With the row-count comparison deleted (and `RESETS`' `core/0012` entry, which
  depends on it, removed) the same plant passed: the comparison is what catches it.
- `CREATE UNIQUE INDEX planted_uq ON labels (created_at)` — `UNIQUE constraint failed:
  labels.created_at`.

**On 2026-10-01, seven shipped steps could not carry these rows**, found by running the walk with each failure
logged and the database rebuilt empty at that step: catalogue `0003_menu_price_nullable` and
`0008_menu_details` (the `menu_items` rebuild's `DROP TABLE` refused with `FOREIGN KEY constraint
failed`), core `0044_drop_table_bill_pointer` (the same for `dining_tables`), core
`0008_node_keyed_rows`, identity `0003_session_token_hash_required` and core `0026_line_vat_class`
(a rebuild making a column required, refused with `NOT NULL constraint failed` on a copied row
whose value is null), and core `0012_printer_calibration`, which rebuilds `drawer_opens` without
copying its rows (`drawer_opens: 2 rows before, 0 after`). These were the first steps `RESETS`
listed; C107 then added core `0055_drop_printer_character_set` (the `printers` rebuild, refused
with `FOREIGN KEY constraint failed` the way `0044` is), and `RESETS` in
`scripts/migration-upgrade.test.ts` holds the whole list. At each step it lists, the guard
checks the failure is still the listed one, then migrates an empty database to that point and
carries on. A reset that expects a
row loss must lose exactly the listed tables, so a second table losing rows at the same step fails
the guard; at a step refused by a constraint, nothing else the step does to the rows is seen.
Removing the row-count comparison made the `core/0012` entry fail with
`is listed in RESETS … but it carried the rows`, so a listed step that stops failing is reported.
The null-column refusals are about these synthetic rows; whether a real box held such a null was not
checked.

A new schema the filler cannot satisfy fails with `could not write row N of <table>` (or `could
not write <table>`, when a foreign key names a table the step lacks). First check that the new
schema accepts any row at all; if it does, the fix is usually a `CANDIDATES` entry for the column
or a `ONE_ROW` entry with its reason. It is never a `RESETS` entry, which is for a step that refuses
or loses rows it was given. An entry the walk never reaches fails the guard too; a `CANDIDATES` or
`ONE_ROW` entry the walk reaches but no longer needs passes.

Runtime, three runs each on the same machine (`CI` unset, agent variables unset), Vitest's `tests`
figure: 8.05, 8.09 and 8.07 seconds before; 9.93, 9.96 and 9.95 after.

**What the guard does not see.** `scripts/migration-upgrade.test.ts` is weaker than its name. The
rows it carries through each step are synthetic, read from each step's schema rather than written by
the product, so a migration that fails only on values the product writes and they lack passes. It
installs today's change-feed list, and today's append-only list less the tables the previous step
lacked, at every step. Rows are counted, not compared, so a step that rewrites a value passes. And
after the final step it also checks the `products_*` triggers it lists, but a rebuild that drops any
other trigger passes it (SQLite drops one silently: [conventions-data.md](conventions-data.md)).

### The upgrade test names the phase it stalled in

`scripts/migration-upgrade.test.ts` times each migration step in five phases — migrate, open,
change feed, close, rows — through `scripts/step-watch.mjs` (`watch.phase`), and runs the whole walk under
`reportStallAfter`, which holds it to two limits. The first is the work budget, in the walk's own
processor time ([below](#the-upgrade-budget-counts-the-walks-own-processor-time)). The second is
the no-progress limit, `NO_PROGRESS_LIMIT_MS`: when no phase starts or finishes for that long in
wall time, the test fails with the phase still running, the process's active resources
(`process.getActiveResourcesInfo()`) and every finished phase's duration. The limit does not stop
the stalled work; it only names it. The active resources are resource TYPES, not a cause, and
the report's own timer is among them. The gap is also checked at every phase event and when the
walk ends, so a synchronous hold longer than the limit that then lets go fails too, with
`No phase started or finished for N ms, past the M ms no-progress limit, until phase X started`
(or `finished`, or `before the body finished` when the walk ends) and the summary.

The two measurements below were taken when the limit was a whole-walk deadline. The report's
content is the same; its first line now reads `Still running after N ms with no phase started or
finished for G ms, past the M ms no-progress limit.`, and the worker's says `its M ms no-progress
timer` where these say `deadline timer`.
Measured 2026-09-28 (Vitest 4.1.11, Node v26.7.0) with the deadline set to one second, `CI=true`
and the agent variables unset, the test failed:

```text
Error: Still running after 1006 ms, past the 1000 ms deadline. Stalled in phase core/0009_node_sealed_state: migrate after 0 ms. Active resources: FSReqPromise, PipeWrap, PipeWrap, PipeWrap, PipeWrap, Timeout.
Phases finished before it:
```

followed by the list.

**A synchronous hold.** The database engine is synchronous, so a stall inside one call also holds
the test thread's timers, and the limit cannot fire until the call returns. A second thread (a
worker) therefore watches too: if the test's thread has not answered `graceMs` (one second) after
the limit fell due, counted from the last phase event the worker has read, the worker writes its own report straight to standard error with `fs.writeSync`,
because a worker's `process.stderr` is relayed through the held thread: measured 2026-09-28 in a
standalone Node v26.7.0 script with the main thread held for one second, a worker's
`process.stderr.write` at 200 ms printed after the main thread was released and
`fs.writeSync(2, …)` printed before it, and the sibling watchdog in
`packages/store/src/venue-liveness.ts` records the same for `console.error`. Measured 2026-09-28 with a
temporary six-second `Atomics.wait` in the `core/0007_node_roles: change feed` phase and a temporary
3000 ms deadline, the worker printed
`The test's thread has not run its 3000 ms deadline timer 1000 ms after it fell due: something synchronous is holding it. Stalled in phase core/0007_node_roles: change feed after 3361 ms.`
followed by the finished phases. Its limits: the worker's report has no `Active resources:` line,
because the worker does not collect one; and once the hold ends, the test's own error names
wherever that thread got to next, with the held phase in its finished list at its long duration — in
the same run,
`Still running after 6776 ms, past the 3000 ms deadline. Stalled in phase core/0008_node_keyed_rows: migrate after 0 ms.`
with `core/0007_node_roles: change feed: 6130 ms` in the list. Whether SQLite's own lock-wait sleep
holds the thread the same way was not measured.

A worker that starts after its report fell due could have its timer fire before it had read the
phase messages already waiting for it, and report `Stalled between phases` with no finished phases:
measured 2026-10-13 in a standalone Node v26.7.0 script with `reportStallAfter`'s `helper` option
pointing at a module that busy-waits 400 ms while loading, one run in 23 did (A544). It now reads
those messages before it writes (`receiveMessageOnPort`). The case "reads the phases the test's
thread already sent when its timer fires before they are delivered" (`scripts/step-watch.test.mjs`)
fires the timer before delivery, and failed without that read.

The helper's own suite leaves room for a paused thread (A770). On 2026-10-16 lane F's pre-push root
run, rebased on A751's merge `39d07827e`, failed "reports the phase a synchronous call holds the
thread in, from another thread, counting from the last phase event" with
`.toMatch() expects to receive a string, but got undefined`: the held call never ran, so the check
read nothing. A751 had made the case wait 60 ms in each of four phases against a 100 ms no-progress
limit, so a delay of 40 ms or more in any one wait fails the body before it reaches the held call;
what delayed lane F's run was not observed. Not reproduced without help, on macOS, Node v26.11.1 and
Vitest 4.1.11: 90 runs of the case beside 28 and then 54 spinning `yes` processes all passed (30,
then 60; the one-minute load average read 12 and 20 around the first batch, 21 as the second began
and 103 two and a half minutes after it ended), and so did 10 runs inside one root coverage run.
Reproduced by pausing the test's thread once, for 200 ms with `Atomics.wait`, 30 ms into the body:
that error, and A751's two sibling cases ("passes a body whose phases keep moving", "fails naming
the phase that stopped") failed too. The three cases now use a 1,000 ms limit and passed with the
same pause. "writes no report when the body waits without holding the thread" passed that pause in
the first run, then failed 8 of 12 runs of it alone in review, on the test thread's own 300 ms
limit; it now waits 600 ms against a 1,000 ms limit and passed 12 of 12, and a watchdog changed to
report at once, or at half the limit, failed it 5 of 5. Receipts are in lane B's campaign folder,
`a770-probe/`.

A healthy run prints the number of timed phases, their summed time, the five slowest, the step
count, the walk's processor and wall time, and both limits. Measured
2026-09-28 with `CI=true`: `224 phases, 4976 ms in all; the slowest:`, then five lines, the first
`payments/0001_payment_resolutions: migrate: 84 ms`. The total covers the timed phases only; copying
the migration folders, rewriting their journals, and the per-source `pragma_table_info` reads and
the `sqlite_master` read between phases (`scripts/migration-upgrade.test.ts`) are not timed, and a
stall in one of those reads is reported as `Stalled between phases`. That summary is a passing test's
`console.log`, which Vitest hides under an AI agent: see
[testing-guide.md](testing-guide.md#vitest-hides-a-passing-tests-console-output-under-an-ai-agent).
The worker's report is written to standard error directly and was visible with `CLAUDECODE=1` and
with `AI_AGENT=1` set. Read from the installed Vitest 4.1.11 source, not run: Vitest 4 starts the
root project's test process with `stdio: "pipe"` and passes its standard error through past the
reporter.

### The upgrade deadline grows with the walk

Since A751 (2026-10-16) this budget is spent in the walk's own processor time, not wall time: see
"The upgrade budget counts the walk's own processor time" below. The measurements in this section
are wall time.

The fixed 110-second deadline failed near the end of a growing walk. On 2026-10-11, main run
38137016367 (`e5447f902`, Node v26.7.0, Vitest 4.1.11, root coverage) printed
`Still running after 110242 ms, past the 110000 ms deadline`, entering
`core/0139_floor_retire_recreate_table_triggers: migrate after 0 ms`. The 1,291 finished phases
summed to 107,403 ms: migrate 50,245; rows 29,266; change feed 22,349; close 2,873; open 2,670.
No finished phase exceeded 1,372 ms. This report places the deadline at the final step; it does
not establish a stall inside that step.

Read back with `gh run view <run> --job <root-guards-job> --log`:

| Passing main run | Test duration | Timed phases | Room under the old deadline |
| --- | ---: | ---: | ---: |
| 38134978065 | 79,738 ms | 77,681 ms | 30,262 ms |
| 38134868867 | 91,492 ms | 89,200 ms | 18,508 ms |
| 38135363758 | 102,551 ms | 100,067 ms | 7,449 ms |
| 38130831236 (first with core 0137–0139) | 105,339 ms | 102,702 ms | 4,661 ms |

Those passing logs retain only the five slowest phases, so they cannot supply a complete
per-step comparison. Core 0138's successful migrate phase took 950, 966 and 988 ms in the latter
three logs. In the failure, core 0137's five phases totalled 265 ms; core 0138's refused attempt
and successful retry totalled 1,540 ms. The three added cuts and reset added 16 reported phases
(1,280 before #1528, 1,296 after). The earlier main run 38127537621 took 76,189 ms; these runs
were on different runners, so their total difference does not measure the migration's cost.

The budget (a wall-time deadline until A751, processor time since) allows 30 seconds plus 500 ms
per distinct post-floor migration date, with one more step for the baseline. Until A751 the test timeout left another ten seconds for the report. For
249 steps that is a 154,500 ms budget, 44,258 ms beyond the captured failing workload and
49,161 ms beyond the slowest passing run above. The fixed allowance covers setup and resets;
the per-step allowance is slightly above the failed walk's average of about 443 ms per step.
This is a workload budget, not a claim that every individual phase fits 500 ms. Two additional
dates, such as the in-flight core 0140 and venue-service 0049, add 1,000 ms; their runtime has
not been measured here. A new reset may require measuring this allowance again.

`scripts/migration-upgrade-budget.test.mjs` sends the captured workload through the real
`reportStallAfter` as processor time, over the heaviest loaded wall time measured: the budget
accepts it, and a walk whose work reaches the budget fails. During A489's failing-test experiment, substituting the old 110,000 ms budget rejected
the captured workload and the doubled walk. All migration,
row-preservation, reset and trigger assertions in the upgrade test stay in force.

### Reducing repeated upgrade-test setup work (A736)

A walk pays setup costs at every migration date, including dates that add no table or row. The
filler now reads a table's constraints only when it has fewer than two rows, or appears in
`ONE_ROW`. It still counts every table before and after filling and compares every carried count
before selecting the tables to fill. A partial child reads its fully populated parent's keys from
the database. Constraint information is read anew whenever a table needs a row; there is no schema
cache across migrations.

Feed installation in this guard runs inside one `withWriteLock` transaction. The next migration
still meets all the installed triggers; the guard does not exercise interruption partway through
feed installation. Product boot and migration code are unchanged. The budget, still 30 seconds plus 500 ms per step,
is now spent in processor time (below).

Measured 2026-10-16 on macOS, Node v26.11.1 and Vitest 4.1.11, from main
`3e713d3a780b8f65447ab203bc9a2f08f336f884`:

- `pnpm exec vitest run scripts/migration-upgrade.test.ts --execArgv=--cpu-prof
  --execArgv=--cpu-prof-dir=<receipt-directory>`: the unchanged test took 57,430 ms. Inclusive CPU
  profile samples attributed 16,714 ms to `installChangeFeed`, 13,323 ms to `removeChangeFeed`, and
  8,498 ms to `carryRows`, including 2,655 ms to `shapeOf`. These samples include native calls;
  they do not separate CPU work from waiting inside SQLite.
- The same profiled command after skipping unnecessary schema reads took 60,630 ms. `shapeOf`
  samples fell to 611 ms and `carryRows` to 6,099 ms, while feed installation/removal samples rose
  to 19,343/14,919 ms. This sample does not show a whole-walk improvement from that change alone.
- A temporary `useVenueDb` probe on the full current schema installed all 186 sources with and
  without `withWriteLock`, in alternating order twice. Installation took 75.28/72.24 ms without
  the transaction and 41.18/39.40 ms with it. Removal took 55.62/53.31 ms without and 22.63/25.23 ms
  with it; removal remains unchanged in this branch. Each installation was checked for a count of 558
  feed triggers, and each removal for an empty feed-trigger list.
- With both test changes, `pnpm exec vitest run scripts/migration-upgrade.test.ts --silent=false
  --disableConsoleIntercept` took 45,610 ms. A temporary full phase report recorded the same
  284 steps, 1,472 phases and 208 populated tables: migrate 28,777 ms, open 915 ms, feed installation
  7,422 ms, close 1,026 ms and rows 6,574 ms. The deadline was 172,000 ms.
- Before the changes, `pnpm exec vitest run --coverage --silent=false --disableConsoleIntercept`
  passed all 6,703 root cases in 68.51 seconds; the upgrade walk's timed phases summed to
  63,429 ms. This run did not reproduce the historical deadline failures.

The regression case in `scripts/migration-upgrade.test.ts` initially failed with two schema reads
where one was required. It now also checks the preserved parent rows and the child's second valid
row. A separate case removes one of three rows and requires a row-loss refusal even though two
rows remain. A third checks `ONE_ROW` reachability when two rows are already present, restoring its
tracking state afterwards. Existing migration, reset, trigger and row-preservation assertions are
unchanged.

The independent run-it review's ordinary candidate run passed in 65,550 ms; its isolated
`ONE_ROW`-omission run passed in 60,540 ms before the dedicated case was added. These additional
samples retain the runtime-variation caveat. Its feed-definition probe compared stored trigger
names and SQL after transactional and ordinary installation at every step: all 286 installations
matched. There are 284 distinct step dates; `core/0012_printer_calibration` and
`venue-service/0038_clammy_klaw` each reach feed installation again after their row-loss reset.
Deleting the schema filter, row-loss refusal or pre-migration feed cleanup made each corresponding
test fail. The driver then deleted the `ONE_ROW` exception in the disposable checkout and observed
the new reachability case fail too. Review artifacts are retained with
[PR #1788](https://github.com/clintongormley/waitron/pull/1788)'s campaign receipts.

The retained failure reports were re-read on 2026-10-16. The table sums only the first contiguous
`Phases finished before it:` block in each log; GitHub repeats part of the CI report in an error
annotation. Summing both copies gives 168,686 ms for that CI failure, rather than the first
report's 160,828 ms.

| Failure | Elapsed / deadline | Finished phases | Sum | Longest finished phase |
| --- | ---: | ---: | ---: | ---: |
| CI run 38607502363, job 116002045326 (2026-10-14) | 166,059 / 165,500 ms | 991 | 160,828 ms | 1,983 ms |
| A10-2 local push (2026-10-14) | 165,546 / 165,500 ms | 1,346 | 162,090 ms | 1,350 ms |
| A585-6 local push (2026-10-15) | 171,087 / 171,000 ms | 1,452 | 167,826 ms | 2,114 ms |

The CI log was retrieved with `gh run view 38607502363 --job 116002045326 --log` and retained as
`receipts/a736/historical-ci-root.log` in Lane F. The local reports are
`receipts/a10-2-ci-fix-push.log` and `receipts/a585-6/push2.log`; their current first-block sums
above replace the old backlog's figures. A parser retained at
`receipts/a736/reparse-phase-reports.py` prints the block's count, sum and maximum.

Other retained context: A10-2's report reached `venue-service/0051_wakeful_loa` 386 ms into its
migrate phase. Its process snapshot and isolated probe are
`receipts/a10-2-upgrade-ps-before.txt` and `receipts/a10-2-upgrade-deadline-probe.log`; the latter
passed in 62,597 ms. A585-6's failure reached `core/0157_mature_sir_ram` 419 ms into migration.
`receipts/a585-6/main-migration-upgrade.log` records an isolated walk passing in 157,630 ms, with
host load 12.09 before and 13.22 after. The previous backlog recorded load 22.07 after the failed
hook; that value has not been rechecked here. Neither isolated pass establishes the cause of the
failure it followed.

These probes identify and reduce repeated work. The reports' longest finished phases and their
accumulated times do not identify which host scheduling or storage event caused the earlier
overruns. The new samples and review experiments remain under
`~/waitron-campaign-f/receipts/a736/`; the developer backlog retains this unresolved variation.

### The upgrade budget counts the walk's own processor time

The budget is the formula above, 30 seconds plus 500 ms per step (173,000 ms for 286 steps), spent
in the walk's main-thread processor time (`process.threadCpuUsage()`; the engine is synchronous on
that thread), checked at every phase event and when the walk ends. The no-progress limit is
120,000 ms of wall time. Vitest's own bound for the case is 1,800,000 ms, a backstop for a walk
that keeps moving while starved. Processor time on one thread cannot exceed the wall time that
passed, so the work budget fails no walk the wall-time deadline passed; a walk slowed only by
other work on the machine now passes. The no-progress limit is new, and stricter in one case: a
walk with 120 s or more in which no phase starts or finishes (at the start, between phases, or
before it ends), finishing inside the old 173 s deadline, passed before and fails now (the largest gap measured under the load below was 34 s). CI's `root-guards` job allows eight minutes (`timeout-minutes: 8`),
below the Vitest bound, so a CI walk starved past that without spending its budget is cut off by
GitHub without the walk's report. What neither limit sees: a walk that waits without using the
processor — on the disk, say — in many gaps each under two minutes.

Measured 2026-10-16 on an 18-core Mac (64 GB, 58–60% of memory free throughout, so processor
starvation rather than swapping), Node v26.11.1, Vitest 4.1.11. "The load" is three root projects
at once (`pnpm vitest run`, one with `--coverage`) plus eight shell loops that only spin; the
one-minute load average peaked between 60 and 102 across the runs. Receipts are in lane B's campaign folder, `a751-receipts/`.

| Run | Wall time | Main-thread processor time | Largest gap between phase events |
| --- | ---: | ---: | ---: |
| The walk alone, on this change | 50,299 ms | 45,145 ms | not recorded |
| Under the load, limits lifted, load kept up for 20 minutes | 1,108,312 ms | 114,909 ms | 34,068 ms |
| Under the load, on this change, one walk in each of the three roots | 901,422–906,051 ms | 114,453–117,148 ms | not recorded |

Under the wall-time deadline the same load failed every walk at about 173 seconds, as it failed
lane G's push on 2026-10-16 (`Still running after 174060 ms, past the 174000 ms deadline`). The
loaded walk spent about 2.5 times the processor time of the walk alone. The budget's margin over
the largest loaded figure is 1.5 times; a heavier load than this was not measured. The no-progress
limit is 3.5 times the largest gap measured, and the Vitest bound 1.6 times the longest loaded wall
time.

### The upgrade test keeps its database in memory on Linux

`scripts/migration-upgrade.test.ts` makes its scratch directory under `scratchParent()`
(`scripts/scratch-dir.mjs`): `/dev/shm`, a memory-backed filesystem on Linux, when it is a
directory, and the system temporary directory otherwise. A passing run's summary names which it
used, though Vitest hides that output under an AI agent (previous section).

Why. The test failed five times in CI's `lint` job. The first, run 36401947339 (2026-09-28, #803's
docs-only head `b3768ddb3`), failed `Test timed out in 120000ms` under the old 120-second bound,
before the per-phase report existed, so nothing is known about its shape. The other four failed the
110-second deadline with the report: runs 36471580455 (#817), 36501083786 (`main`), 36544133895
(`main`) and 36550884979 (#851). Each of those four reports showed the test slow from its first
phase rather than stuck in one. In the 114 `lint` jobs that ran it in CI runs 36466135605
to 36551592480 it took 17 to 112 seconds; the 11 runs over 60 seconds, those four failures among them,
were all in the `centralus` region, and in those 11 every other root suite finished within 27 to 30
seconds of the first root suite finishing, against 31 to 46 seconds on all but two of the other 103
runs. The test commits hundreds of times: a change-feed phase
alone issues a `drop trigger` and a `create trigger` for each of three triggers on each source
present at that step, 86 at the first steps up to 115 at the last, one statement at a time outside
any transaction. The store leaves SQLite's `synchronous` at the driver's default, which reads back as
`2` (full) on Node v26.7.0, so each of those commits waits for the disk. Two probes in a temporary
workflow, 20 runners each, 2026-09-29:

- The test alone, with `TMPDIR=/tmp` and then `TMPDIR=/dev/shm` on the same runner (run
  36553496623): 17 to 34 seconds on the disk and 4 to 8 seconds in memory, the memory run under half
  the disk run's time on every runner. 300 separate `create table` commits took 128 to 709 ms on the
  disk and 8 to 22 ms in memory.
- With this change, `pnpm vitest run --coverage`, the command the `lint` job then ran (run 36554428373):
  the test took 6.2 to 11.5 seconds on all 20, three of them in `centralus`, and every run printed
  `Scratch directory under /dev/shm.`

That the disk caused the 60-to-112-second runs is an inference. The probes show the disk slows this
test 2.5 to 6 times, but neither reproduced that range.

`/dev/shm` has a size limit. Measured 2026-09-29 by the review's run-it seat in a Linux container
(Node v26.10.0) started with `--shm-size=64m`, Docker's default size: the scratch directory peaked at
about 14 MiB and the test passed; after a 56 MiB file was written into `/dev/shm` first, leaving
8 MiB, the test failed with `migrations.apply_failed`. The scratch directory was removed both times.

`useVenueDb` (`packages/db/src/testing/venue-db.ts`) makes its directories under the system
temporary directory. In CI's venue-service shards that is now `/dev/shm` (next section); every other
package's `useVenueDb` suites still make theirs on the runner's disk, and so do the root suites
`scripts/append-only-triggers.test.ts` and `scripts/behavioural-triggers.test.ts`, so they still pay
the disk; A441, one run each side, saw no job's time move consistently when the packages' suites
moved, and did not measure the root suites (`docs/backlog/ci.md`, "The package suites' databases
stay on the runner's disk").

### The venue-service shards keep their test databases in memory

The step that runs each `test-venue-service` shard in `.github/workflows/ci.yml` sets
`TMPDIR=/dev/shm`. Every test database in `@waitron/venue-service` is made by `useVenueDb`, which
makes its directory under `os.tmpdir()` (`packages/db/src/testing/venue-db.ts`), and Node's
`os.tmpdir()` reads `TMPDIR`. So the shard's databases live in memory, and its commits no longer
wait for the runner's disk (previous section: 300 separate commits took 128 to 709 ms on the disk
against 8 to 22 ms in memory). It is the CI step's environment, so a local run still uses the system
temporary directory. On one runner in shard 2, `/dev/shm` (7,995 MB) held at most 14 MB until the
browser started, then 2,090 MB at its peak once Chromium ran. Chromium's profile was there (its
launch line reads `--user-data-dir=/dev/shm/playwright_chromiumdev_profile-…`); how the 2,090 MB
split between the profile and Chromium's other use of `/dev/shm` was not measured. Next section.

Why. Main run 38142687186's job `test-venue-service (4)` (2026-10-11), in region `westus`, hit its
10-minute limit. Against two green runs of the same shard that day, 38158202160 and 38156571198, the
six database-backed test files compared (`routing-store`, `menu-timetable`, `kitchen-screens`,
`department-transfers`, `routing-cells` and `schema/schema-conformance`) each took about ten times
as long, among them `routing-store.test.ts` 68.4 s against 7.0 and 7.3 s, `menu-timetable.test.ts`
118.1 s against 12.0 and 13.1 s, and `kitchen-screens.test.ts` 34.8 s against 3.6 and 3.9 s. In
eight green CI runs that day (38146965866 to 38158202160) shard 4 took 1m43s to 2m18s in total, and
every venue-service shard finished within 3m20s. The setup steps on the failing runner were slow too
(setup-node 72 s against 9 s, the install 44 s against 6 s), so the whole runner was slow, not only
its disk. That the disk caused the overrun is an inference from the previous section's measurements;
it was not measured on this job. A441 (#1477) set `TMPDIR=/dev/shm` on every database test job for
one run each side and no job's time moved consistently (`docs/backlog/ci.md`, "The package suites'
databases stay on the runner's disk"); this change is aimed at runners as slow as that one, not at a
typical runner.

The job's time limit stays 10 minutes. The shards' times with this change, against those green
runs, are in #1553's description, under "Measurement".

Guard: the "venue-service shards' test databases" case in `scripts/ci-workflow.test.mjs`, weaker
than its name: it reads `ci.yml` as TEXT, so a step an `if:` switches off, or a `run:` that sets
`TMPDIR` again, still passes, and it never checks that the tests' databases actually land under
`TMPDIR`.

### A failed venue-service shard keeps its browser start-up record

On 2026-10-11, [run 38170156450 attempt 1's venue-service shard 2](https://github.com/clintongormley/waitron/actions/runs/38170156450/job/114561139899)
passed its 317 database tests, printed nothing for three minutes, and failed with
`Failed to connect to the browser session … within the timeout` before any browser test started.
Its log could not say which start-up step had not happened when the timer ran out. Each
`test-venue-service` shard now keeps a record that can.

What the job does:

- A step before the shard samples the runner every 5 s into
  `$RUNNER_TEMP/shard-diagnostics/resources.log`: load, memory, `/dev/shm`, and the ten largest
  processes.
- The shard step turns on Vitest's browser channels and Playwright's browser log
  (`DEBUG=vitest:browser:pool,vitest:browser:playwright,vitest:browser:api,pw:browser`, plus
  `VITEST_PW_DEBUG=1`, which prints any page request that fails), and writes its whole output to
  `$RUNNER_TEMP/shard-diagnostics/shard.log`. The job log hides one kind of line, the api channel's
  `Triggering command`, one per browser command, so a passing shard's log grows by about 230 lines
  rather than about a thousand.
- When the shard fails or is cancelled — at its time limit, by a newer push to the same pull
  request, or by hand (both steps are `if: failure() || cancelled()`; only the time-limit cancel was
  measured) — a step adds `after.txt` (memory, `/dev/shm`, every large
  process, the end of `dmesg`), and the folder is kept for 14 days as the artifact
  `venue-service-diagnostics-<shard>`. A passing shard keeps nothing.

`failure()` alone is false after a time-limit cancel. On `main` run 38932759150, job
`test-venue-service (1)` (job 117080878600) was cancelled at its 10-minute limit, and its two
`if: failure()` steps did not run while the `if: always()` blob upload did. Probe run 38951332497
(throwaway PR #1813, closed): a job with `timeout-minutes: 1` whose step slept 300 s was cancelled
at its limit; afterwards a step with `if: failure()` was skipped, and steps with `if: cancelled()`
and `if: always() && steps.<id>.outcome != 'success'` ran.

**Reading a record.** Vitest 4.1.11 starts its connection timer when it creates the session
(`BrowserSessions.createSession` in `vitest/dist/chunks/cli-api.*.js`), and the session succeeds
only when the page has connected AND reported ready. In a passing shard the lines come in this
order, each with its time:

1. `vitest:browser:pool … creating session for browser (chromium)` — the timer starts.
2. `vitest:browser:playwright … initializing the browser`, then `pw:browser <launched> pid=…` —
   Chromium started.
3. `… the page is ready`, then `… browser page is created, opening http://localhost:63315/…` — the
   page exists and is navigating.
4. `vitest:browser:api … Browser API connected to orchestrator` — the page connected.
5. `vitest:browser:pool … run test` — the page also reported ready; tests start.

The first missing line is the step that did not happen before the timer ran out. Readiness has no
line of its own: line 4 present and line 5 absent means the page connected and did not report ready
in time.

The old log leaves two readings of its three minutes. The last database test ended at 20:03:05.7
and the error printed at 20:06:05.4, against a 60 s timer. Either about two minutes passed before
the session was created, or the run took about two minutes to end after the timer fired. In the
forced failure below, the provider had closed 1.6 s after the session was created, so a quick
close is what a normal failure looks like; that does not show what the stuck one did. The record's
times tell the two readings apart.

**What the probes measured** (2026-10-12):

- **No reproduction in 100 repeats.** Probe run 38189152637 ran shard `2/4` exactly as CI does, on
  25 runners at a time, four times: 100 of 100 passed. In the last attempt's 25 records (the run's
  artifact list held only the last attempt's), the first browser test started 0.54 to 2.07 s after
  its session was created, median 0.92 s. On attempt 1's first runner, sampled every 2 s, `/dev/shm`
  (7,995 MB) held at most 14 MB before the browser started and peaked at 2,090 MB once Chromium ran,
  and available memory was never below 11,527 MB.
- **The record works on a real failure.** Probe pull request #1573 (run 38192012149) forced shard 2
  to fail with a 1 ms connection limit. It failed with the same message and kept
  `venue-service-diagnostics-2` with all three files and steps 1–4 above timed; shards 1, 3 and 4
  passed and kept nothing.
- **The error is rare.** In the newest 900 CI runs (2026-10-07 02:12 to 2026-10-12 00:47 UTC,
  every attempt), the message appears in the log of one failed test job: the one above. Those runs
  hold 868 venue-service shard jobs.

The first forced-failure probe set the limit on the command line and passed: Vitest reads
`connectTimeout` from the outer config's `test.browser` block only
([testing-guide.md](testing-guide.md#vitest-reads-a-browsers-connecttimeout-from-the-outer-config-only)).

Guard: the cases under "the venue-service shards' browser start-up record" in
`scripts/ci-workflow.test.mjs`, weaker than their name: they read `ci.yml` as TEXT and never run a
shard, so a Vitest or Playwright upgrade that renames a debug channel would leave the record silent
while the cases pass. They read the snapshot step's and the upload step's `if:` lines as text, not
what GitHub decides from them, and never read the snapshot step's commands or what the job log's
`grep -v` hides; a sampler or shard step an `if:` switches off still passes. The channel names above were read from Vitest 4.1.11 and
Playwright 1.63.0.

## `prettier --check` on an ignored path prints the same line as a clean one

`docs/` is ignored whole (`.prettierignore`), so a format check over it reports
`All matched files use Prettier code style!` and exits 0 having checked nothing — CLAUDE.md §1's
"both answers look alike" with a command attached, and the same two lines a genuinely clean path
prints. Re-run 2026-10-03: `pnpm exec prettier --check docs/backlog.md` printed that line and
exited 0, and `pnpm exec prettier --file-info docs/backlog.md` printed
`{ "ignored": true, "inferredParser": null }`. Cost: a dated pointer scripted into a plan matched a
line-wrapped `**Run`, split the bold span and left the paragraph rendering wrong; a format check over
that directory reported clean, and a review seat found it by reading.

## Check every command's exit status

A shell sequence separated by newlines reports only its last command's status. Use `&&` for dependent
validation steps, or capture each status separately. Cost: the A3 review-fix command ran a successful
build after a failed server typecheck and reported success; the pre-push hook correctly refused the
test's incomplete response type. Receipt: #335.


## The box reports the running image's identity

A490 stamps the revision and UTC creation time on both final Dockerfile targets; CI also labels
the published and smoke images with the requested ref. The smoke job prints each image's complete
labels and compares revision, creation time and ref against that build's inputs.
`waitron.sh status` reads the running containers' immutable image IDs, rather than the tags that
may have been pulled since those containers started. Branch installs resolve one commit for both
builds through the commit API, without requiring git on the box.

| Source | Source wording | Use |
| --- | --- | --- |
| [GitHub, Get a commit](https://docs.github.com/en/rest/commits/commits#get-a-commit), checked 2026-10-11 | “Returns the commit's SHA-1 hash.” (`application/vnd.github.sha`) | Resolve a branch, tag or abbreviated commit before building. |

Probe on 2026-10-11: `curl -fsSL -H 'Accept: application/vnd.github.sha' https://api.github.com/repos/clintongormley/waitron/commits/main`
printed `fb6a474b830ceb51ce96babd133a6a635e5f725d`. The shell regressions cover resolution failure,
both pinned builds, status without labels or running containers, different revisions for the two
services, and UTC-to-local conversion. The source guards read text; the smoke job inspects the
built images.


Keep changing image metadata after package-install `RUN` steps. A490's first label placement
made those steps depend on the timestamp. On Docker Desktop 29.3.0, a scratch probe based on
`node:26-slim` used `ARG C`, `LABEL created="${C}"` and `RUN printf cache-probe > /tmp/a490-cache`.
Two `docker build --progress=plain --build-arg C=<value>` calls with new values `111014521` and
`111014522` each printed `#5 DONE 0.1s` for that RUN. Moving ARG/LABEL after RUN made the second
call print `#5 CACHED`. This measures that tiny Dockerfile, not the box's Docker version or apt's
runtime. Both shipped targets now place the metadata after their final RUN; the deploy guard
checks that ordering as text.


A490's correction also hit a prose occurrence of `ENV`, creating `ENV including`; source scans
passed, but CI failed before building a layer. The driver reproduced `ENV must have two arguments`
with `docker build --check -f deploy/Dockerfile .`. Use anchored instruction lines when moving
Dockerfile declarations, and run that check after changing them. The metadata-order guard now
requires an actual ARG/LABEL line, but remains a source scan, not Docker's parser.


## Root instruction receipts retained on 2026-10-14

These excerpts retain the measurements, mechanisms and guard limits from the root
`CLAUDE.md` before A583 moved their detail here. They do not change the rules.

### Four-minute test jobs

Cost: `test-server (5)` ran a 5.3-minute median behind two files
of about 3 minutes each, one of them slow only in Vitest comparing byte arrays element by
element.

### Four-minute guards

Guards, weaker than the rule: the reporter's warning on a file over 90 s, which never
fails a job, the shard-count pin in `scripts/ci-workflow.test.mjs`, and each test job's 10-minute
`timeout-minutes` (its "bounds every test job" case).

### Browser coverage merge

**A browser package's shard coverage merges through `scripts/vitest-shard-coverage-merge.mjs`,
never a plain `--merge-reports`**, which on Vitest 4.1.11 counts a file some shards never loaded
twice and reads functions low. Cost: the venue-service merge failed at 97.44% functions against
99.32% unsharded.

### Browser coverage guard

Guard: the browser-merge case in `scripts/ci-workflow.test.mjs`, weaker than its
name — it reads `ci.yml` and package.json as text, and counts a package as browser-mode when its
`devDependencies` name `@vitest/browser-playwright`, not by reading its Vitest config.

### Sharp bundle guards

Guards: `scripts/deploy-image-env.test.ts`,
weaker than its name (it finds a direct `esbuild` call by reading package.json TEXT); the
bundle-smoke grep in `.github/workflows/ci.yml`, which reads `dist/server.js` alone; and
image-smoke's sharp step.

### Workflow job limits

Cost: PR #1399's image smoke sat 46 minutes
on one cache download.

### Apt read timeout

**An apt-get in a workflow, `deploy/Dockerfile`, `deploy/waitron.sh` or the bench's CA probe image
runs under an outer `timeout`, and is retried when it stalls or exits non-zero**, because apt's own
read timeout did not end a wait on a mirror sending a byte every 5 s.

### Apt incident

Cost: main run
37771042263's image smoke sat silent in `apt-get update` until its 15-minute limit, and `publish`
was cancelled with it.

### In-memory CI databases

Cost: a main run failed the pause test's bound of at least
1000 ms; a probe reproduced it on one runner in 20, catching a disk stall that held one commit for
about a second. A main run's venue-service shard 4 hit its 10-minute limit on a slow runner; that
the disk caused it is an inference.

### Dynamic imports and mutation

In `packages/db`, whose Stryker config sets `ignoreStatic`, a test loads a source module with
`import()` inside a case only when that case asserts on what the module builds as it loads
(as `describeSchemaConformance`'s `reload` does); otherwise it imports at the top of the file.
Stryker
counts the case as covering the module's load-time code and runs those mutants against it alone. Cost: db's mutation score
read about 86% on three weekly runs (A539).
