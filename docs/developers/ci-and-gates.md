# CI and gates

This file holds the evidence behind Waitron's test gates: the mechanisms, the measurements, the
exact commands, and the incident that paid for each rule. The one-line versions of these rules
live in the repo root `CLAUDE.md`, section 2 ("The gate"), which points here. Read this file
before touching CI, the pre-push hook, or the test gates, or when you need to check a claim
against its receipt.

The rules below fall into four rough groups: the gate commands themselves (the shallow check and
the pre-push hook), the CI job layout and scheduling, the pnpm filter traps, and the concurrency /
machine-resource rules, plus one rule about migration-upgrade test coverage.

## The optional whole-workspace check

Run focused behavior tests during implementation. Use this broader local command when investigating
a failure or shared behavior, not as an automatic requirement for finishing a branch:

```bash
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
```

That is the shallow, whole-workspace check. Root `test` / `test:coverage` cap package concurrency
at two and enforce a 20-minute process deadline
(`scripts/run-with-deadline.mjs`). CI test jobs have a 15-minute job deadline; each light bin also
caps package concurrency at two. Direct package commands retain their Vitest timers.

## The pre-push hook

The pre-push hook (`.husky/pre-push`) checks sign-offs, runs
`pnpm install --frozen-lockfile`, `format:check`, lint and the root guards with coverage, then
`typecheck` over changed packages and their dependents. `scripts/changed-packages.mjs` resolves
the scope for both the hook and CI. Package tests and coverage run in CI; the root guards stay local
because they check the machinery that decides what runs. CI also runs mutation testing and
`bundle-smoke`.

A machinery-only push (`scripts/`, `.husky/`, `.github/`) is `scope=root` and stops after the root
guards. A documentation-only push stops after formatting. Deletion-only pushes run no checks.
Unknown ranges keep the full local gate, including workspace typechecking. The hook no longer
runs `pnpm reap`; run it manually before local database suites when needed.

Run the normal hook once through the push, then verify CI scope and required checks on the current
head. A green hook proves only its own checks; it is not evidence of package tests or coverage.
Owner decision 2026-09-12: stop duplicating mandatory package coverage locally before waiting for CI.
The shell regressions in `scripts/pre-push.test.mjs` exercise scope and failure behavior.

Bypassing the hook with `--no-verify` is for emergencies; the failure still has to be fixed because
CI runs the same checks. A hook failure the PR does not reproduce is a check CI has deferred to the
unfiltered `main` run, not a wrong hook.

## Coverage thresholds are split by package

Owner decision 2026-09-05: `statements 98 / lines 98 / functions 98 / branches 95` in `verifactu`,
`fiscal-verifactu`, `core`, `db`, `sync` and `payments` — the fiscal core and the data-layer
foundations — and the `90/90/85/85` floor in every other package, browser packages included. The
six are the owner's list, not a rule that derives them (`apps/server` holds the AEAT transport and
sits at the floor).

The root project keeps the high bar: its coverage table is the root `scripts/*.mjs` plus the
vocabulary module, two of them the classifiers that decide what CI and the hook run.

Which package holds which bar is pinned by `scripts/coverage-thresholds.test.ts` — a hardcoded
list, safe only because the root project is the one gate never narrowed away; moving a package is
an edit to that list, with the reason in the commit.

## CI job layout and scheduling

### CI's shards run `test:coverage`, not `test`

Before calling a package green, verify its CI coverage result on the current head. Run
`pnpm --filter <pkg> test:coverage` locally when investigating a failure. There is no single `test`
job: `.github/workflows/ci.yml` runs `test-heavy` (`packages/db`) and `test-server`
(`apps/server`) as three-way file shards each with a `-merge` job that enforces the thresholds on
the merged blob (#216), plus `test-fiscal-verifactu`, dedicated mixed database/browser jobs (`test-bookings`, `test-media`, `test-venue-service`,
`test-payments-stripe`, `test-payments-sumup`) and `test-replication`
jobs, the browser shards (`test-ui`, `test-till`, `test-dashboard`, `test-setup`) and
`test-light-a` / `test-light-b` for everything else (bins in `scripts/changed-scope.mjs`). Vitest
`--shard` splits by FILE COUNT, so shard imbalance is the real limit, and `N` must never exceed a
package's test-file count.

### A shard can exit 1 with every one of its tests passing

Seen once, on PR #414's first run (run 35355113501, job 105632564989, `test-server (3)`). The shard
printed `Test Files 87 passed (87)` and `Tests 1313 passed (1313)`, then `Errors 1 error`:

```
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
 ❯ Object.onTimeoutError  node_modules/.../vitest/dist/chunks/rpc.-pEldfrD.js
 ❯ Timeout._onTimeout     node_modules/.../vitest/dist/chunks/index.B521nVV-.js
```

It still exited 1, which failed the aggregate `ci` job. **`onTaskUpdate` is not a test.** It is the
call a test worker makes to tell the main process a test finished, and the message says the main
process did not answer it for a full minute.

**The timeout is sixty seconds and nothing in this repository can change it.** Read out of the
installed vitest (3.2.7) rather than the documentation: the worker builds that channel in
`dist/chunks/rpc.-pEldfrD.js`, which passes a `timeout` only if its caller supplies one; the fork
pool's caller is `dist/workers/forks.js` → `createForksRpcOptions(v8)`, which supplies none; so it
falls back to birpc's `DEFAULT_TIMEOUT = 6e4` in `dist/chunks/index.B521nVV-.js`. Grepping the whole
`dist` tree for `process.env.VITEST_` finds only `MAX_FORKS`, `MIN_FORKS`, `MAX_THREADS`,
`MIN_THREADS`, `POOL_ID`, `WORKER_ID`, `VM_POOL` and `SKIP_INSTALL_CHECKS`; the bracket form
(`process.env["VITEST_…"]`) returns nothing either, which is the control that stops the grep pattern
being the answer. So no `VITEST_*` variable reaches it, and no config key does. The claim is about
the pool this repository uses: raising the timeout under the BUILT-IN fork pool would mean carrying a
patched dependency. A custom pool or worker is vitest's own extension point and was not explored.

A review seat reproduced the signature rather than reading it, which is why this entry can be
specific: a reporter that accepts a passing result and then withholds its completion produced
`1 test passed` with `Errors 1 error`, the same `onTaskUpdate` message, both stack filenames above,
and **exit 1 after 60,340ms** — the 60-second default, paid once, on a suite where nothing failed.
The same seat pulled the original job's log (`gh api repos/clintongormley/waitron/actions/jobs/105632564989/logs`)
and confirmed the counts quoted here.

**What this entry does NOT establish:** why the main process went quiet for a minute. The SIGNATURE
was reproduced deliberately (below); the STALL was not, and the re-run that passed is evidence rather than proof — the second run
(35356264571) was on a head differing from the first only in prose, and all three `test-server`
shards passed. The shard runs four test workers plus the main process on a four-vCPU runner with a
PostgreSQL container alongside, so starvation is the obvious suspect and remains unmeasured.

**What to do when you meet it.** Keep the job's log and its printed counts BEFORE you re-run —
nobody knows the cause, so a second sighting's log is the only thing that could ever settle it, and
the house rule is retain-then-retry rather than re-running to green. Then read the counts: every test
passing plus this one error does not establish a failed assertion, and it does not identify a cause
either, so the diff is not where to start. This is not the silent-shard case in
[testing-guide.md](testing-guide.md) — there, tests were still unfinished; here they all finished.
Then re-run the shard. If it starts recurring, the two levers are lightening what that shard does per
tick (its four workers on four vCPUs) or patching vitest — both changes to CI machinery, and both
wanting a measurement first, because neither has one today.

### CI does not run every check on every push

The `changes` job skips the expensive `code`-gated jobs when every changed path is inert —
documentation, or root config no `code`-gated job reads (`.codex/`, `.vscode/`, the root
`.gitignore`, the root `.editorconfig`) — or is the repository's own machinery (`scope=root`:
`scripts/`, `.husky/`, `.github/`), and on a pull request narrows the shards and mutation jobs to
the changed packages and their dependents.

`lint` is ungated and runs on every push — eslint, `format:check` AND the repo-level Vitest
project, which is the suite that does read the machinery — so a regression in a skipped path is
still caught there.

A merge to `main` runs the unfiltered suite whenever anything outside those two sets changed; that
run verifies the narrowing, and a root-only or docs-only merge does not get one. Read the
`changes` job's `code`, `scope` and `packages` outputs before treating a green PR as evidence
about the workspace. Design: `docs/superpowers/specs/2026-07-31-scoped-ci-design.md`.

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

### A cheap job can still be the critical path

`mutation-verifactu` was ungated because a mutant is cheap; on run 30650089655 it was 3m26s of a
4m8s run. Sort a run's jobs by duration before calling a job cheap enough to leave ungated.

### The GHA cache is a shared per-repository budget and this repo sits AT it

A new `cache-to: type=gha,mode=max` exporter does not merely cost its own bytes — it competes for
space against every other job's entries, and GitHub reclaims by evicting the least recently used.

Docker layers are what fill it here: measured 2026-09-12, the total was at GitHub's 10 GB limit and
image blobs were roughly nine tenths of it, leaving the Playwright browser download and the pnpm
store caches that the test jobs restore to share the remainder. That is the second reason
`publish` dropped arm64 (`linux/amd64` alone, ci.yml): an emulated second platform's `mode=max`
export put a second set of image layers in on every merge to `main`.

The total is `gh api repos/:owner/:repo/actions/cache/usage`, but it answers only "how full" — for
WHICH entries a new export competes with, list them with sizes and last-access times
(`gh api "repos/:owner/:repo/actions/caches?per_page=100" --paginate`, or `gh cache list`) and name
them before adding the export.

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

### `--frozen-lockfile` is not in the four-command gate

Moving a dependency between `dependencies` and `devDependencies` fails CI at install. The hook
runs `--frozen-lockfile`; the shallow gate does not.

### A name-filtered test run does not load the package's guard suites

Not the schema-ownership or error-code-reachability guard suites, nor any e2e suite pinning a
shared wire body with `toEqual`. SP-2b's `/hello` change passed `test sync-api` (11 tests) and
broke two boot suites for two tasks. A focused pass proves only the selected cases; CI supplies
package-wide coverage. Run additional consumer tests locally when useful for investigating shared behavior.

### Adding a workspace package breaks the root guards until it is wired in

Three guards in the root Vitest project read workspace members BY NAME, and the ungated `lint` job and
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

What to wire, for an ordinary package with tests: a `vitest.config.ts` carrying the coverage bar the
package is assigned (which bar is pinned by `scripts/coverage-thresholds.test.ts`), and the shard lists
in `scripts/changed-scope.mjs` and `.github/workflows/ci.yml`. A package that declares no
`test:coverage` script at all — today only the two `bench/` members — additionally goes in
`PACKAGES_WITHOUT_TESTS`.

### A hardcoded cross-package list goes stale when a manifest or scope changes, and scoped CI hides it

Adding a member to `migrations.manifest.json`, `GENERIC_PACKAGES` or `OWN_SHARD_PACKAGES` left
tests in two OTHER packages red until an unrelated task ran them. Grep for tests that pin the list,
run those guards, and verify CI selects every affected consumer. Use a broader local run when
needed to investigate a failure.

### After a rebase + `--force-with-lease`, the hook can scope the WRONG package

Restacking a dashboard-only branch, it printed `all checks passed (@waitron/till + dependents)`.
Mechanism unconfirmed (plausibly the stale remote SHA git feeds a force-update). Confirm what
changed with `git diff --name-only origin/main..HEAD`, check that the hook typechecked the actual
changed packages, and run any missing typechecks. Verify CI’s package scope and coverage results
on the current head; the PR’s own CI scopes off the PR diff.

### The pre-push log file can be days stale

`/tmp/waitron-root-test-run.log` once named a test the branch had deleted. Reproduce; do not read
it.

## Concurrency and machine-resource rules

### Browser-mode packages run vitest in real headless Chromium

Browser-mode gates may run concurrently; what is not allowed is adding one beside OTHER SESSIONS'
browser runs or beside a backgrounded whole-workspace `pnpm -r test:coverage` — check what else is
testing on the machine first.

The receipt is two 65 GB RAM spikes and a force-quit on 2026-08-30, with several sessions testing
at once; one session running its own package gates in parallel was never the problem (owner
decision 2026-09-06, retiring "one gate at a time").

Concurrency is decided by measured headroom, never by a count: before a heavy run check free
memory (`memory_pressure | grep free`) and the heaviest processes
(`ps -axo rss,command | sort -nr | head`), then scale `--workspace-concurrency` to what is free.
Receipt: 77% of 64 GB free that night with two review sessions, four vitest workers and two
Chromiums running.

### Chromium's launch depends on the Codex seat's PERMISSIONS, not on Codex

Sandboxed, it cannot start
(`bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer: Permission denied (1100)`,
measured 2026-09-06); with approved host execution, a direct Codex driver can run browser tests.
Receipt: on 2026-09-12, `pnpm --filter @waitron/dashboard test src/screens/payments-screen.test.ts`
passed in Chromium. Check host execution before deferring browser testing to another agent.

## Migration-upgrade test coverage gap

### Only the `core` migration set has an upgrade test; every module set is still migrated from a VIRGIN database only

So a green gate is no evidence that a module set can upgrade a box. Drizzle applies a set's
PENDING migrations in one transaction, and PostgreSQL refuses to name a label added by
`ALTER TYPE … ADD VALUE` in that same transaction unless the type was created there too — a virgin
database, which creates the type in that batch, is the one shape where it is legal.

Cost: a bricked box, an hour of guesswork, and a wipe that destroyed the evidence.

The static guard covers every set (`scripts/enum-add-value-safety.test.ts`); the upgrade
regression that migrates real databases from each release point covers `core` alone
(`packages/db/src/migrate-upgrade.pg.test.ts`).

## Check every command's exit status

A shell sequence separated by newlines reports only its last command's status. Use `&&` for dependent
validation steps, or capture each status separately. Cost: the A3 review-fix command ran a successful
build after a failed server typecheck and reported success; the pre-push hook correctly refused the
test's incomplete response type. Receipt:
`docs/superpowers/plans/2026-09-12-printer-address-probe.md`.
