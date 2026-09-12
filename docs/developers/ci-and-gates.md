# CI and gates

This file holds the evidence behind Waitron's test gates: the mechanisms, the measurements, the
exact commands, and the incident that paid for each rule. The one-line versions of these rules
live in the repo root `CLAUDE.md`, section 2 ("The gate"), which points here. Read this file
before touching CI, the pre-push hook, or the test gates, or when you need to check a claim
against its receipt.

The rules below fall into four rough groups: the gate commands themselves (the shallow check and
the pre-push hook), the CI job layout and scheduling, the pnpm filter traps, and the concurrency /
machine-resource rules, plus one rule about migration-upgrade test coverage.

## The gate command

```bash
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
```

That is the shallow, whole-workspace check. Root `test` / `test:coverage` and the pre-push
coverage phase cap package concurrency at two and enforce a 20-minute process deadline
(`scripts/run-with-deadline.mjs`). CI test jobs have a 15-minute job deadline; each light bin also
caps package concurrency at two. Direct package commands retain their Vitest timers.

## The pre-push hook

The pre-push hook (`.husky/pre-push`) is deeper but narrower: `pnpm reap`,
`pnpm install --frozen-lockfile`, `format:check`, then `typecheck` and `test:coverage` over the
CHANGED packages and their dependents (resolved by `scripts/changed-packages.mjs`, the same script
CI's `changes` job uses).

A push that touches only the repository's own machinery — `scripts/`, `.husky/`, `.github/`, which
no workspace member reads — is `scope=root`: lint, format:check and the repo-level Vitest project,
no package typecheck or tests.

CI adds mutation testing and `bundle-smoke`, which nothing local runs. A green from any one of the
three (the shallow gate, the pre-push hook, CI) is evidence about what it ran — not about the other
two.

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

Before calling a package green, run `pnpm --filter <pkg> test:coverage`. There is no single `test`
job: `.github/workflows/ci.yml` runs `test-heavy` (`packages/db`) and `test-server`
(`apps/server`) as three-way file shards each with a `-merge` job that enforces the thresholds on
the merged blob (#216), plus `test-fiscal-verifactu`, dedicated `test-bookings` and `test-sync`
jobs, the browser shards (`test-ui`, `test-till`, `test-dashboard`, `test-setup`) and
`test-light-a` / `test-light-b` for everything else (bins in `scripts/changed-scope.mjs`). Vitest
`--shard` splits by FILE COUNT, so shard imbalance is the real limit, and `N` must never exceed a
package's test-file count.

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
Both gates first pipe the selection through `scripts/changed-packages.mjs runnable test:coverage`,
which refuses an empty run unless every member is in `PACKAGES_WITHOUT_TESTS`
(`scripts/changed-scope.mjs`). A green from that guard still does not mean a test ran.

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
broke two boot suites for two tasks. Run the package unfiltered before believing a pass, and the
whole workspace when you touch a value more than one suite asserts.

### A hardcoded cross-package list goes stale when a manifest or scope changes, and scoped CI hides it

Adding a member to `migrations.manifest.json`, `GENERIC_PACKAGES` or `OWN_SHARD_PACKAGES` left
tests in two OTHER packages red until an unrelated task ran them. Grep for tests that pin the list;
run the whole workspace.

### After a rebase + `--force-with-lease`, the hook can scope the WRONG package

Restacking a dashboard-only branch, it printed `all checks passed (@waitron/till + dependents)`.
Mechanism unconfirmed (plausibly the stale remote SHA git feeds a force-update). Confirm what
changed with `git diff --name-only origin/main..HEAD` and run THAT package's `typecheck` +
`test:coverage`; the PR's own CI scopes off the PR diff and is the trustworthy signal.

### The pre-push log file can be days stale

`/tmp/waitron-root-test-run.log` once named a test the branch had deleted. Reproduce; do not read
it.

## Concurrency and machine-resource rules

### The four browser packages run vitest in real headless Chromium

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
