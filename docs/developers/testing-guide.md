# Testing guide

This file holds the evidence behind waitron's testing rules — the mechanism, the measurement, and
the incident that paid for each one. The one-line rules themselves live in the repository root
`CLAUDE.md`, section 4 ("Testing"), which points here. Read this before writing or debugging a
test, especially one that touches a venue database or runs in browser mode.

**Asking for a database**

## There is one database target, and a helper opens it.

A suite that needs a database calls `useVenueDb` (`@waitron/db/testing/venue-db.js`). It makes a
temporary directory, opens it with the product's own opener, applies in order the migration sets it
is handed, and installs the append-only triggers those sets declare. There is nothing to choose
between: PGlite, the Testcontainers PostgreSQL tier, the helper that ran a suite against both, and
the `*.pg.test.ts` suffix all went with the storage switch on 2026-09-22.

**What went with them, so nobody assumes it is still covered.** SQLite has no roles and no
grants — one process opens one file, and what a caller may do is decided outside the database — so
`asAppUser` (`packages/db/src/testing/roles.ts`) is an empty function today, kept only so the
switch did not also have to edit its call sites. Every privilege assertion that depended on it is
deleted, and each deletion is recorded in the header of the file it was deleted from:
`packages/db/src/allocate-number.test.ts` (a column-scoped `grant update (next_number)` was what
made allocation fail in production and pass in every test that skipped the role switch — nothing
now states which privileges that allocation needed),
`packages/fiscal-verifactu/src/inmutabilidad.test.ts` and `apps/server/src/payments-api.test.ts`.

Contention is a separate question and has its own section further down, "A contention test proves
the write queue serialises writers, not that a lock blocked".

**Owning and cleaning up a database in a suite**

## Don't own a database in a suite — let a helper own it.

`useVenueDb` (`@waitron/db/testing/venue-db.js`) registers its own hooks and returns an accessor
whose `db` throws if it is read before `beforeAll` has run. Raw `beforeAll`/`afterAll` only when
the suite legitimately builds its own resource, and then guarded
(`if (db !== undefined) await db.close()`) —
enforced by `scripts/guarded-teardowns.test.ts`, whose header records why an ESLint rule was
rejected. Suites sharing a database clean up in a `finally`, order-independent.

## The retired helper's name stays retired, and a guard enforces that.

The rule is in `CLAUDE.md` §4 and the guard is `scripts/venue-db-helper.test.ts`: no `.ts` file
under `packages/` or `apps/` may NAME `usePgliteDb` — not call it, name it. Nothing defines that
function any more, so all the guard holds today is that a reintroduced PGlite helper, or a comment
pointing a reader at one, is reported rather than quietly accumulating. It says so in its own
header, at some length, so nobody mistakes it for a check on how suites open databases. The
whole-package exemption `packages/db` held while it defined both helpers is gone.

**It forbids the NAME and not just the call**, and that is the part worth carrying: the dead
pointers this sweep kept finding were in comments — seven stood when the guard was written, five
of them in a `vitest.config.ts`, which no call-shaped grep over suites would ever have opened.

Which files take the seam is a grep rather than a list here, because a list is stale by the next
pull request. Run it from the workspace root; the paths it prints are relative to it, and the
`grep -v` is anchored to that form:

```bash
grep -rlE "useVenueDb[(]" --include="*.ts" packages apps \
  | grep -vE "^packages/db/src/testing/venue-db([.]test)?[.]ts$"
```

What that exclusion drops is `venue-db.ts` and `venue-db.test.ts`, the seam and its contract test,
which take the seam without being anyone's conversion. Read the output for what it is: the command
lists FILES, not packages and not call sites, and not every file it lists is a suite — some are
shared fixtures under a package's `test/` directory.

**The rule and the guard landed AFTER the last conversion (#473), deliberately.** A rule with standing
violations needs a guard, and the guard could not pass while a single suite still called the old
helper. That is the shape the column-vocabulary rollout ended in too: #414 was the last conversion,
and #416 added `scripts/column-vocabulary.test.ts` and the `CLAUDE.md` line together afterwards.

**Containers and Docker**

## A container port-binding timeout needs Docker state as well as the container's own logs.

Save `docker inspect`'s `HostConfig.PortBindings` and `NetworkSettings.Ports` before removing the
failed test fixture. Measured on a PostgreSQL container in September 2026: the reader-adoption gate
found a healthy container with a requested TCP binding but an empty published-port list, and a
focused rerun passed without explaining the first failure. Receipt:
`docs/superpowers/plans/2026-09-12-card-reader-adoption-and-status.md`. The only thing in this tree
that starts a container now is `bench/sqlite-failover`, which exposes a port the same way, so that
is where this still applies.

## Reuse a supplied test container before probing Docker again.

A failing `docker info` command is not evidence that a container global setup already started is
absent. Run 34507423350 failed `deployment.test.ts` at exactly that redundant check. The suites
that held this lesson went with the PostgreSQL test harness on 2026-09-22, and nothing in this tree
probes `docker info` today, so it is carried here without a prover.

## Locate the unfinished package before diagnosing a silent shard as database contention.

Four inspected `test-light-a` hangs left only Bookings' browser files unfinished while Sync and
every database file completed; two jobs ran for about six hours. A Vitest test timer does not
bound a browser whose event loop has stopped. Preserve the job log and use an outer process/job
deadline, not a retry as proof of repair. Evidence and limits:
`docs/superpowers/specs/2026-09-09-test-load-design.md`.

## On Vitest 4 a project's own `maxWorkers` wins; the outer config's is the fallback.

Read in vitest 4.1.11: `resolveMaxWorkers(project)` returns `project.config.maxWorkers` when that is
set and only then falls back to the outer config's (`dist/chunks/cli-api.CnMVyzaz.js`). Run
separately on a scratch fixture of four test files: an outer limit of 4 together with a project limit
of 1 gave peak concurrency 1 across four distinct worker processes, and the same fixture without the
project limit peaked at 4. Configs here depend on the project value winning — `packages/bookings`,
`packages/payments-stripe`, `packages/payments-sumup` and `packages/venue-service` each set
`maxWorkers: 1` inside a project.

This section came from Vitest 3, where moving `maxForks: 4`
inside fiscal-verifactu's project in #286 started 17 workers on the local host, observed during a
Sync migration stall. fiscal-verifactu has since dropped its projects. The test-load design records
the live process and database probes.

`scripts/fiscal-test-budget.test.ts` pins these configs and no others: fiscal-verifactu's outer
limit of 4, and `packages/media/vitest.config.ts`, which still has projects, keeping its limit of 2
on the outer config with none inside a project. That is a pin on the arrangement those two packages
chose, not on how Vitest resolves the limit.

**The option's NAME changed with Vitest 4** (2026-09-19): `poolOptions.forks.maxForks` became the
top-level `maxWorkers`, and `poolOptions.forks.singleFork: true` became `maxWorkers: 1` — the pool
is still forks by default, so the "one fork" reasoning behind the old name still holds, but the word
`singleFork` no longer exists in a config. Vitest 4 says so itself when it meets the old spelling:
"`test.poolOptions` was removed in Vitest 4. All previous `poolOptions` are now top-level
options." (`vitest@4.1.11`, `dist/chunks/coverage.DM_a_rWm.js:179`.)
`browser.fileParallelism` still works at 4.1.11 — the resolver reads
`browser.fileParallelism ??= options.fileParallelism`, so a project-level `fileParallelism` reaches
the browser pool and the configs here set it there, which is the spelling that survives into 5.

**What the rename costs, measured.** The two spellings do not run the same way:
`poolOptions.forks.singleFork: true` ran a package's test files in ONE reused process, while
`maxWorkers: 1` runs them one at a time in a FRESH process per file. Same package, same tests, two
runs each: `@waitron/shared` (17 test files) reports 1.58s and 1.56s under 4.1.11 with
`maxWorkers: 1`, against 567ms and 588ms under 3.2.7 with `singleFork: true`. Most vitest configs in
this workspace carry that pin, so the cost is paid widely. This is recorded as a cost, not as a
reason to change anything: the alternative that would recover it, `isolate: false`, would newly share
module state between test files, which the upgrade deliberately did not do.

### A package's `coverage.include` does not mean "this package's src"

Measured on 4.1.11, reading both installed copies. `include: ["src/**/*.ts"]` is matched by
picomatch against the ABSOLUTE file path with `contains: true`, so any path with a matching
segment matches, wherever that segment sits. What normally keeps another package out is the
external check — and in 4.1.11 that check is
`roots.every((root) => !filename.startsWith(root))`, a bare string prefix with no trailing
separator. So for a package whose directory were called `packages/sync`, a file at
`packages/sync-enrolment/src/migration-tables.ts` would not be judged external — its path starts
with the `packages/sync` root — and the include would then match it on its `src/…/*.ts` segment, so
it would land in that package's report.

**No pair in this tree is exposed today**, so the mechanism above is what to carry, not a reading.
The worked example it was written from was a `packages/sync` whose barrel re-exported
`@waitron/sync-enrolment` and whose own test imported that barrel, which pulled the sibling's files
into `packages/sync`'s report until `"**/sync-enrolment/**"` went into that package's
`coverage.exclude`. That package is not in this repository and is not on `origin/main` either
(`git ls-tree origin/main packages/`, taken 2026-09-22, lists `sync-enrolment` and no `sync`), so
the numbers that went with it are not repeatable here and are dropped rather than carried. What the
example also had was a control in the other direction: `packages/membership` imports
`@waitron/shared` in its source, `shared` is not a prefix of `membership`, and its files never
entered the report.

Vitest 5 fixes this: it matches the include against the path RELATIVE to the matching root and
requires `${root}/`. Until then a `coverage.exclude` naming the sibling is what a 4.x tree needs.
No package carries such a line today, because no pair needs one; a later Vitest 5 upgrade should
re-measure rather than assume.

The pairs to watch when adding a package, since the hazard is a NAME prefix and not a dependency:
`country`/`country-es`/`country-gb`/`country-packs`,
`fiscal`/`fiscal-verifactu`/`fiscal-none`, `payments`/`payments-stripe`/`payments-sumup`,
`workforce`/`workforce-es` — every place under `packages/` where one package directory's name is a
prefix of another's, listed on 2026-09-22. Only a pair where the shorter package's own tests load
the longer one's source is actually exposed. Under `apps/` there is no such pair: `dashboard`,
`print-agent`, `server`, `setup` and `till`, none of them a prefix of another.

## Vitest's per-test timeout does not bound a blocking child — it fails healthy runs that outlast it.

It is tempting to read a suite's two timeouts as one overriding the other. They do different things,
and the experiment separates them. Under Vitest's default per-test timeout of 5000ms, with no
`testTimeout` set:

- a child given `timeout: 9000` that sleeps 30s is still killed at **9004ms**, and `spawnSync`
  returns `status: null`, `signal: "SIGTERM"`, `error.code: "ETIMEDOUT"`. Vitest does not shorten
  the spawn timeout and cannot interrupt a blocking `spawnSync` at all;
- the test that then asserts on that result FAILS WITH ITS OWN ASSERTION — the reported error is
  `expected null to be +0`, not Vitest's timeout. A test that throws reports its throw;
- but a child that sleeps 7s and exits **0** — a healthy run, merely slow — is reported as
  `Test timed out in 5000ms`. A test that would have PASSED reports Vitest's timeout.

So the failure mode is precisely this: **a run that completes normally is failed for its duration
alone.** Nothing is lost about a genuine hang; what is lost is the healthy slow run. (Measured
2026-09-18 on an 18-core Mac. The earlier wording here — that a larger spawn timeout is "capped" or
"unreachable" — was wrong, and was corrected after a review ran the control above.
`scripts/ci-workflow.test.mjs` had the mechanism right first, and records that an earlier version of
its own comment had it wrong.)

What a bound has to clear, then, is the longest a healthy TEST can take: the SUM of every wait it
performs plus whatever untimed work sits between them. The largest single wait is only one term.
A tempting shortcut — "set the bound above the spawn timeout and no healthy run can be failed" — is
false, and the control is cheap: two healthy 4s waits, each well inside its own 6s spawn timeout,
failed against a 7s bound. `scripts/pre-push.test.mjs` is the case in this repo, with a test that
invokes the hook three times and a `git()` helper that spawns with no timeout at all; its bound comes
from measuring its cases, not from its spawn timeout. Where a suite's every case makes exactly one
bounded call — `scripts/waitron-sh.test.mjs` and `scripts/main-tag-guard.test.mjs` — the shortcut
does hold for THAT bound, and each says so in its own comment rather than relying on a general rule.
It leaves the other side of the pair open, which is the next section.

### The child's own retry budget is part of the test's worst case

The pair of bounds protects against two different failures, and reasoning about one says nothing
about the other. Vitest's per-test timeout can fail a healthy test for its DURATION; `spawnSync`'s
timeout KILLS a child that is still working. A suite can get the first right and still fail healthy
runs through the second — if the program under test can legitimately take longer than the spawn
timeout allows.

`deploy/waitron.sh` does. Its `wait_healthy` polls a container 36 times, five seconds apart — 35
sleeps, so about 175 seconds — against `scripts/waitron-sh.test.mjs`'s 20-second spawn timeout. `wait_healthy` has TWO call sites — install and reset — and most of that suite's cases pin neither
`WAITRON_SH_MAX_HEALTH_TRIES` nor anything else that bounds the loop, so any probe coming back as
something other than `healthy` put the child into it. Counted on the pre-fix file: the two install
cases and four reset cases, not the two the first version of this entry claimed. Measured with a stubbed `docker` by a review seat that drove each arm in one process and counted the
probes. The first arm pays this suite's cold-stub cost (a freshly written executable costs hundreds of
ms on macOS — see the stub-reuse section below), so it is not comparable with the rest; arms two and
three agree on a warm baseline near 0.1s:

| Arm | Probes | Wall clock | Exit |
| --- | --- | --- | --- |
| healthy on the first probe (cold stubs) | 1 | 0.692s | 0 |
| one probe misses, then healthy | 2 | 5.090s | 0 |
| never healthy, tries pinned to four | 4 | 15.119s | 1 |
| never healthy, 36 tries, delay 0.05 | 36 | 2.179s | 1 |

Each retry costs a whole five-second sleep. Against the 20-second spawn timeout that is finely
balanced, and the arithmetic is worth doing rather than rounding: on the warm baseline of ~0.1s, four
retries land at 20.1s — over the bound by a tenth of a second — and five clear it outright. A killed
child comes back with `status: null`, which reads as a broken test rather than a slow machine.

**That is a hypothesis about the failure recorded against this suite on 2026-09-18** under two
campaign runners and a MinIO container, not an established cause. What is known: the FILE took 29.5s
while its other cases ran at normal speed, which fits one child killed at the 20-second bound rather
than a uniform slowdown. That run's output was not kept, the miss has never been reproduced, and
nothing says what made a deterministic stub answer wrong. Plain CPU contention did not reproduce it:
six runs under 36 busy-loop processes on an 18-core machine (load average 62) all passed, and moved
the `install <ref>` case from 1.30s to 1.48s — a failure to reproduce at one load level, not a cause
eliminated.

The change cuts the WAIT rather than the try count, so the retrying itself survives:
`WAITRON_SH_HEALTH_DELAY` (default 5) sits beside the try-count override the script already had, and
the suite's `run()` sets it to 0.05 for every case. **It reduces the exposure; it does not guarantee
anything.** The seat falsified the stronger claim by patching the stub's `ps` branch to `sleep 0.6` before
answering: 29 probes, then `ETIMEDOUT` at 20.003s. What the change buys is the sleeps — 175 seconds of them down to under two —
while the probes' own cost stays. Unset, the default is unchanged, re-measured on the edited script:
36 probes, 35 sleeps of five seconds, and an empty override falls back to five (`:-` substitutes for
empty as well as unset).

Two cases pin it, both proved by mutation, and they prove different things.
`retries while the container has no health verdict yet, then succeeds` asserts the install succeeds
AND that two probes were recorded; `gives up with the unhealthy message after the shipped number of
tries` asserts the probe count equals the number read out of the script. Pinning the try count to 1
fails both — which is how the first version of this test was caught asserting nothing about retrying,
since a give-up message arrives just as happily after one try. Only the SECOND case holds the spawn
bound: delete the delay default from `run()` and its child retries for ~175s and is killed, measured
at 20.17s with `ETIMEDOUT`, while the first case merely slows to about six seconds and still passes.
Neither sees the shipped five-second default, so `scripts/deploy-image-env.test.ts` pins that as text,
with the closing brace in the pattern — proven by mutating the script to `:-50` and `:-360` and
watching both fail, where the unanchored version had let them through.

`scripts/ci-workflow.test.mjs` paid for this first, on PRs #128 and #129: a cold CI runner with no
warm pnpm store ran its sequential `pnpm ls` spawns at **at least** ~3.3x their warm time (a floor,
derived from their crossing the 5s default, not a measurement of the cold run) and crossed the
default. The lesson did not travel — sibling suites carried the same shape until 2026-09-18:
`scripts/waitron-sh.test.mjs` (20s spawn timeout), `scripts/pre-push.test.mjs` (15s) and
`scripts/main-tag-guard.test.mjs` (30s).

What made waitron-sh the one that actually failed in the #407 incident (2026-09-18, the Vitest side)
was its margin. Its `install <ref>` case takes
~1.3s on an idle host and **4518ms** with the machine driven to load average 66 — CPU burners on
every core plus a loop writing and executing fresh small executables — which is under the old 5000ms
ceiling by under half a second. Nothing in that suite touches Docker: `docker` is a stub on `PATH`.

Raising the bound widens the tolerance; it does not make a suite unfailable. A review deliberately
built a case that ran 31708ms and it failed against the new 30000ms bound, correctly.

Guard: `scripts/spawn-timeout-budget.test.ts`, over `scripts/` ALONE. It reads each root guard
suite's own text for two numbers — the largest `timeout:` option the file declares, and the largest
per-test bound it sets, file-wide with `vi.setConfig({ testTimeout })` or on one case with
`it(name, fn, ms)` — and fails the suite when the bound cannot clear the wait. Every `timeout:`
option counts as a wait, not only `spawnSync`'s: `expect.poll` and `vi.waitFor` are bounded by the
same clock.

**Nothing under `packages/` or `apps/` is scanned, and that is a hole with no guard in it.** That
half was retired on 2026-09-22 together with the real-PostgreSQL test harness, which owned every long
wait those two roots declared. With the harness gone, `grep -rnE "timeout: *[0-9_]+" packages apps
--include="*.test.ts"` answers nowhere at all, so the half's two non-vacuity cases — which exist to
refuse a scan that has judged no file — went red having nothing left to judge, and were deleted with
the machinery that fed them. **The rule is unchanged under both roots**: a suite there whose test
outlasts its per-test timeout still fails healthy runs, and nothing automated will say so. If you are
writing one, two things the retired half used to work out for you: a file under `packages/` or
`apps/` almost never sets its own bound, so the number that governs it comes from the package's
`vitest.config.ts` (and a `testTimeout` sitting beside `projects` is INERT for a project that does not
set `extends: true`); and a browser project's default bound is 15s, not 5s — Vitest resolves
`testTimeout ??= browser.enabled ? 15e3 : 5e3`.

It is weaker than its name in three ways its own header states: it reads TEXT, so a timeout from an
env var or built in a helper is invisible; it
works per FILE, taking the largest bound anywhere; and it compares that bound against the largest
SINGLE wait, which the paragraph above shows is necessary and not sufficient. It also cannot tell
code from strings, so a number inside a fixture string counts as though it were code — the guard is
its own example, since `budgets()` run over it reports numbers taken from its own test fixtures while
the suite performs no wait at all.

The one design choice worth knowing before trusting it in a gate: **a bound it cannot evaluate makes
it decline to judge the file, not accuse it.** A guard that fails a correct file stops every push, so
where precise reading fails — a bound written as an expression, a per-case bound past a regex literal
or on a template-table `it.each`, a number after some other callback — it goes quiet instead. That is
a deliberate hole, and its detector block has a case for each of those shapes recording the decline,
alongside cases for what it does read and what it is blind to.

## Build a suite's executable stubs ONCE per file, not once per test.

Executing a FRESHLY WRITTEN file is expensive on macOS and free on Linux, and that asymmetry decides
who benefits from this.

The same probe — six distinct fresh executables, first run then re-run, so the control rules out a
one-off warm-up — measured:

| | first execution | re-execution |
| --- | --- | --- |
| macOS, idle | ~120ms | ~12ms |
| macOS, loaded | 503–842ms | 3–4ms |
| Linux (container) | 0.2–0.6ms | 0.2–0.3ms |

So on macOS the penalty is real, per file, and swings by an order of magnitude with load; on Linux
there is no penalty to speak of. The cause looks like macOS's first-execution check of a new
executable, but that is the likely explanation rather than something these runs establish — no
`spctl` or `syspolicyd` observation was taken.

**What that means for where the time is saved:** the pre-push hook runs on a developer's machine, so
a macOS developer gets the whole win on every push. CI runs on Linux, where these suites were never
slow for this reason and will not get measurably faster. Worth knowing before reaching for the same
rewrite to speed up a CI job.

A suite that writes a fresh set of stub executables inside a per-test helper pays that per test, and
it is easy to pay it without noticing, because each stub is tiny and the helper looks cheap. Measured
on this host:

| suite | stubs per case | before | after |
| ----- | -------------- | ------ | ----- |
| `scripts/waitron-sh.test.mjs` | 5–6 | ~11.5s | ~2.1s (~4.75s since the two shipped-try-count cases landed on 2026-09-18 — re-measured three times after them) |
| `scripts/main-tag-guard.test.mjs` | 2 | ~3.3s | ~0.55s |
| the whole root Vitest project | — | ~21.7s | ~8.0s |

The rewrite is the same in both: build the stub directory at MODULE scope, and move whatever each
case varies — the health string, a failure flag, the stdout a fake `docker` should print — into
environment variables the stub reads at run time, instead of interpolating them into the stub's body.
Two things come free with it. A value containing a quote stops being a hazard, where interpolating
into a single-quoted shell string could break the stub; and the per-case state shrinks to a temporary
directory, which costs a `mkdir` rather than an exec.

**It does not pay off everywhere, so measure before rewriting.** The cost only matters when the
stubs are a large share of the suite's runtime. `scripts/pre-push.test.mjs` writes one stub per case
but each of its fixtures also runs about eleven real `git` commands, and reusing the stub there
measured 10.59s against 12.61s — inside the noise of `git` itself. `scripts/reap-testcontainers.test.mjs`
writes stubs in a single case out of seventeen, so "once per file" and "once per test" are the same
thing. Both were left alone deliberately.

When a suite's stubs go shared, prove the knobs still reach them rather than trusting a green run: a
value that no longer arrives usually leaves the stub taking its default, which is exactly the shape
that passes. Neutralise each variable in turn and confirm the cases that depend on it fail — done
for both suites above, every variable accounted for.

## A container given network aliases also joins the default bridge, and a second bridge can stall larger queries.

Measured on PostgreSQL containers on this Docker Desktop host: Testcontainers 12's
`withNetworkAliases()` also attached the default bridge, which left the container with interfaces at
MTU 65535 and MTU 1500 — a 1,400-byte query passed, a 1,600-byte query stalled, and removing the
unused bridge made queries up to 100 KB pass. The remedy was one Docker network plus unique
container names for DNS, and the fixture that applied it went with the rest of the PostgreSQL test
harness on 2026-09-22. **No fixture in this tree calls `withNetworkAliases()` today**, so this is
the mechanism with no live example; reach for it again if a networked fixture comes back. Evidence:
`docs/superpowers/specs/2026-09-09-test-load-design.md`.

## `TESTCONTAINERS_RYUK_DISABLED=true` is required locally, for the one container left.

That is `bench/sqlite-failover`, whose `startStore` opens a MinIO container
(`bench/sqlite-failover/src/store.ts`). Ryuk hangs on this machine, so it has to be off; with it off
an interrupted run leaks, which is the next section.

**A recurrent stall needs a retained log and a live database snapshot.** This was recorded against
the PostgreSQL test harness: the #286 boot retry and cluster mutex did not eliminate the later
migration stall, whose backend was waiting for client input with no blocking backend, and reducing
concurrency alone did not fix the dual-bridge defect above. What carries is the method: locate
the stalled operation before assigning its cause to resource contention.

## With Ryuk off, INTERRUPTED runs leak containers

The bloat (once: 173 volumes, 23 GB) starved the `freePort` race in `apps/server`'s boot and
end-to-end suites, while an isolated re-run passed and proved nothing. Run `pnpm reap` when that
bites. The command (`scripts/reap-testcontainers.mjs`) removes containers labelled
`com.waitron.reapable` — stamped by one helper today, `startStore` in
`bench/sqlite-failover/src/store.ts`, which nothing pins — AND older than 2 h —
so another repo's or a live watch-mode container survives — with their anon volumes. It never
touches images and there is no blanket `docker volume prune` (it would reach other projects and the
named dev volumes). `docker volume inspect` before any manual `rm`. Once a leaked container is gone
its anon VOLUME is orphaned (no `com.waitron.reapable` label to find it by), so `pnpm reap` cannot
reclaim it — a dangling-anon prune would reach the HA repos' testcontainers on this machine, so
those stay a clean-exit-plus-manual-targeted sweep.

## An interrupted run also ORPHANS its vitest workers, and `pnpm reap` sweeps these too.

A hard interrupt (an Esc, a killed parent, a timeout signal) can take the orchestrator while its
workers reparent to launchd (ppid 1) and spin at ~100% CPU indefinitely — SIGTERM did not stop them,
`kill -9` did (cost: four burned the fan for hours on 2026-09-07). The sweep is scoped by ppid 1 AND
the shape vitest leaves in the `ps` command column, NOT a bare `vitest` word anywhere in the line —
that broader match killed a real orphan whose argv only held a `vitest` log path (run-it review).

There are TWO such shapes, because the two vitest majors this repository has run look different, and
`scripts/reap-testcontainers.mjs` recognises both. Vitest 3 set a process TITLE — `node (vitest)` for
the orchestrator, `node (vitest N)` for a tinypool worker — and the parens are the marker, because a
parenthesised `(vitest` is vanishingly unlikely in an ordinary path or flag (`process.title = ` at `vitest@3.2.7`'s
`dist/chunks/utils.XdZDrNZV.js:31` and `cac.BfaZ95xE.js:1410`). Vitest 4 sets no title at all and
spawns its own workers, so a worker appears as its entrypoint path
`…/node_modules/vitest/dist/workers/<pool>.js` and the orchestrator as `…/vitest/vitest.mjs`; there
is no `process.title` anywhere in `vitest@4.1.11`'s `dist/`. Measured 2026-09-19 on
`packages/identity`, one version each: 3.2.7 showed `node (vitest)` and `node (vitest 1)`, 4.1.11
showed no `(vitest` at any sample and a worker running `…/vitest/dist/workers/forks.js`.

## A probe that needs a Unix SOCKET runs inside the container.

Bind-mounting a socket directory out of Docker Desktop's VM gives `ECONNREFUSED` on macOS, and a
scratchpad path blows the 104-byte `sun_path` limit before you get that far. Install what the probe
needs inside the container and run it there; parsing-only probes are fine on the host. Measured
against a PostgreSQL container, on a harness this tree no longer has.

**The `SET PUBLICATION` trap — the suites that reproduced it are gone, logical replication is not**

The FAILOVER suites were deleted on 2026-09-19 with the machinery they tested. What went, read off
`git diff origin/main --diff-filter=D --name-only` on that branch: the packages/replication-tests
package and @waitron/sync whole (both packages, suites and source together);
@waitron/provisioning's replication-bootstrap and replication-readiness suites; and in apps/server
the replication suites (replication, replication-arc.e2e, box-status.replication,
box-status.disposal) together with the rejoin and fence suites that needed a REAL replication slot
(rejoin-e2e, boot.fence — each opened a `startLogicalPostgresContainer` and imported
`@waitron/sync`, so neither could outlive that package). **Rejoin and fence are still tested**: the
suites that work over fixtures survive with the code they cover — `apps/server/src/rejoin.test.ts`,
`apps/server/src/rejoin-command.test.ts` and `apps/server/src/membership-fence.test.ts`, green on
2026-09-19 under
`pnpm --filter @waitron/server exec vitest run src/rejoin.test.ts src/rejoin-command.test.ts src/membership-fence.test.ts`.
Dropping boot.fence left no behaviour uncovered: what it proved — that a fence-LSN drain watermark
really flips once the carrier's slot advances past it — is gone from the product too, and
`apps/server/src/rejoin.ts`'s header says so under "WHAT IS GONE": rejoin now wipes without any drain
confirmation.

What stood here was a measured account of one trap those suites hit — `ALTER SUBSCRIPTION … SET
PUBLICATION` returning before the subscriber's apply worker restarts, so a publisher write committed
in that window is LOST rather than delayed (10 / 10 with the worker paused; 8 / 500 under load
unpaused). Nothing reproduces it, in the narrow sense that no code or test issues that statement:
`grep -rni "set publication" packages apps scripts deploy` matched nothing on 2026-09-19. If the
replacement failover mechanism ever streams over PostgreSQL replication again, re-measure rather than
trust this paragraph. The measured detail — a 2026-09-14 probe on PostgreSQL 18.6, plus a reading of
the PostgreSQL source behind it — was removed from this file on 2026-09-19 with those suites; the
trap surfaced as a CI failure in #356 and the fix landed in #361.

PostgreSQL logical replication was exercised here until 2026-09-22: a "copies a row A→B over the
network via a raw publication/subscription" case created a publication on one containerised node
and a subscription on the other, then waited for the row to arrive. It went with the two-node
fixture and the rest of the PostgreSQL test harness, so **no live example of it remains in this
tree.** The change feed's own replicated case had gone earlier, at the SQLite flip —
`installChangeFeed` emits SQLite triggers now, and this engine has no apply worker and no
`ENABLE ALWAYS` for one to skip. A third suite, in
`packages/catalogue`, created a publication with no subscriber at all,
so that `product_units` was PUBLISHED while the test reassigned a product's unit — the UPDATE
PostgreSQL refuses with `55000` when a published table has only a UNIQUE and no primary key
(CLAUDE.md §3; it asserted the success path, not the refusal). **The SQLite flip deleted it on
2026-09-21**, because SQLite has neither publications nor a replication identity.

**Shelling out to git from a test**

## A test that shells out to `git` must clear `GIT_DIR` and its family

(`GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`,
`GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_NAMESPACE`). Git exports `GIT_DIR` to every hook, so a
`mkdtemp` fixture that is isolated by hand writes into the real repo under `.husky/pre-push`: seven
fixture commits pushed three times, `user.name` rewritten in the shared config, and
`core.bare = true` set on the main checkout (`git worktree list` shows `(bare)`;
`git config --unset core.bare` restores it). Run such a suite once under `GIT_DIR` before trusting
it.

**Browser-mode tests**

## A width you set with `commands.setViewportSize` is not a width the component rendered at.

The components under test render inside vitest's own iframe. `commands.setViewportSize` resizes the
OUTER Playwright page and leaves that iframe alone: measured on 2026-09-20 while looking at the
dashboard's modifier screens, `window.innerWidth` inside the test read 414 — the default — after
calling it. `page.viewport(w, h)` is what resizes the iframe; the same measurement read 390 and 1280
through it.

This is CLAUDE.md §1's "a measurement taken where both answers look alike measures nothing" with a
helper attached: a phone-width screenshot taken through the wrong helper looks like a phone-width
screenshot of a layout that copes, and is a desktop-width screenshot of one that may not. It cost two
separate agents on one branch. State the width you measured, not the width you asked for — read
`window.innerWidth` inside the test and put it in the report.

A second thing a widget harness does not inherit: icons are registered in each app's `main.ts`, which
a harness mounting one widget never loads, so `wt-icon` renders an empty box and a grip handle looks
like a missing cell. Register the app's icon set in the harness before reading anything into a blank
control.

Nothing guards either of these.

## Browser passkey tests stub `navigator.credentials`, keeping the WebAuthn library real.

Preloading that library before the old module mocks reproduces `startRegistration is not a spy` and
`mockClear is not a function`; the credential stubs pass with the same preload. Do not rely on a
module mock replacing an already-loaded browser ES module. Evidence and limits:
`docs/superpowers/specs/2026-09-10-ci-test-failures.md`.

## Browser recovery tests read the native control inside a shared component.

A host's `checked` property can report the expected value while its inner checkbox remains visibly
wrong. The printer follow-up review reproduced that split by preserving the emitted change while
suppressing the host update; the old assertion passed and the inner-input assertion failed.
Pointer: `apps/dashboard/src/screens/printing-rules-screen.test.ts` (`switchChecked`).

## A reopened polling dialog owns a new in-flight gate.

Reset that gate on close and guard its release with the request's generation as well as guarding
the response. Otherwise an old read blocks the reopened dialog, or its `finally` releases the new
read's gate. The printer review reproduced both shapes
(`apps/dashboard/src/screens/printers-screen.test.ts`, "starts a fresh agent read immediately after
reopening").

## A browser test using fake timers must advance an awaited animation frame or restore real timers first.

The printer modal close test stalled on its own paused `requestAnimationFrame`; asserting the
native dialog's closed state avoids mixing that clock with the browser's queued close event
(`apps/dashboard/src/screens/printers-screen.test.ts`, "closing Add printer…").

## The mouse cursor belongs to the shared page, so a hover outlives the test — and the file — that moved it.

In browser mode every test file in a worker runs in its own iframe but shares ONE browser page, and
the cursor position is the page's. So `userEvent.click` or `userEvent.hover` parks the real cursor at
those coordinates for every test that runs afterwards, in that file and in every file scheduled after
it in the same worker. Whatever renders under those coordinates next is `:hover`ed with nothing in the
test asking for it, and Blink re-evaluates that after layout, so it lands on a freshly mounted element
even though no mouse event was sent. `wt-button`'s hover rule then dims the button to
`--wt-opacity-hover`, and an axe scan reports a colour-contrast violation for a button that looks
correct in the app.

Measured, 2026-09-13: `test-dashboard` failed three times on PR #350 on
`floor-screen.a11y.test.ts`'s "renders accessibly with empty lists" (light theme) — always
`wt-button[data-add-zone=""]`, always `#fefefe` on `#3f83ed` at 3.66:1. `#3f83ed` is no design token.
It is `--wt-color-primary` `#1f6feb` at opacity `0.85` over the light `--wt-color-bg` `#f7f7f8`, and
`#fefefe` is `--wt-color-on-primary` `#ffffff` composited the same way — all six channels exact. The
failure was reproduced locally by running a file that hovers a `wt-button` immediately before the
untouched `floor-screen.a11y.test.ts` in one worker (`--no-file-parallelism`): the same one test of
the eight failed, with the same element and the same two colours.

The fix is a reset in the shared harness, not in the test that happened to be scanned:
`apps/dashboard/src/widgets/test-helpers.ts` calls a `parkPointer` browser command
(`apps/dashboard/vitest.config.ts`) in a `beforeEach`, which moves the Playwright cursor to `(-1, -1)`
— outside the viewport, so no element can be under it. **`userEvent.unhover()` cannot do this job**:
@vitest/browser implements it as a hover of `html > body`, which parks the cursor in the MIDDLE of the
page, on top of whatever the next test mounts. Guard:
`apps/dashboard/src/widgets/pointer-reset.test.ts`, proven by deleting the `beforeEach`. Cost of the
reset, measured over the package's 1,827 tests: about 0.5s of a 6s run.

`apps/till` gained the same reset, in its own `apps/till/src/widgets/test-helpers.ts`. `packages/ui`
has one too, but only in `packages/ui/src/a11y-helpers.ts` — so the `*.a11y.test.ts` files get it and
the behavioural suites, which import `packages/ui/src/test-helpers.ts` instead, do not. Two of
`packages/ui/src/components/wt-button.test.ts`'s hover tests end with the cursor still on the button,
and those suites drive the real cursor a lot, so the same latent failure lives there, unpaid for so
far. `packages/media` and `packages/venue-service` register `parkPointerCommands` in their vitest
configs and DO get the reset, through `packages/ui`: their a11y suites
(`packages/media/src/dashboard/image-library.a11y.test.ts` and
`packages/venue-service/src/dashboard/venue-operations-screen.a11y.test.ts`) import
`packages/ui/src/a11y-helpers.ts`, whose line 22 is `beforeEach(() => commands.parkPointer())`.
Both vitest configs say so in a comment beside the registration. An earlier version of this
paragraph said neither ever called it — that was wrong when it was written, and has nothing to do
with the storage switch.

## Dispatch events when testing a `composedPath()` guard.

An undispatched `KeyboardEvent` has an empty path, so a missing-action test can pass at the
input-type guard without reaching the branch it claims to check. Exercise the event from the real
input and prove the target guard by deletion. Receipt: `packages/ui/src/submit-on-enter.test.ts`
(UI keyboard review, 2026-09-06).

## Position a native popover before its first paint.

In Chromium, positioning from the asynchronous `toggle` event left the row menu at `(0, 0)` for its
first frame. Open it synchronously, then measure and position it; the first-frame regression is in
`packages/ui/src/components/wt-row-actions.test.ts`; the dashboard wrapper retains its compatibility
tests.

**Guards that read the whole tree**

## Source scanners check filesystem type as well as the filename suffix — select files, not just paths ending in `.ts`.

Vitest stores failure screenshots in directories named `*.test.ts`; treating those directories as
TypeScript files made the vocabulary guard throw `EISDIR` after browser failures. A failing browser
test creates a screenshot directory named after its test file, and the vocabulary guard tried to
read that directory and failed with `EISDIR` after an intentional TDD failure. `sourceFilesIn` now
checks `isFile()`, keeping real nested source files in scope, with a fixture preserving an actual
nested source file. Regression: `scripts/english-only.test.ts`, "scans real TypeScript files…".

*(This heading merges two copies of the same rule that appeared separately in section 4 of
CLAUDE.md — same incident, same fix, same regression test.)*

## A guard that reads the whole tree belongs in the ROOT Vitest project (`scripts/`)

run by ci.yml's ungated `lint` job and by the hook on every non-docs push — a package-resident guard
only runs when its package is in scope, and most pushes never reach `packages/db`. Two costs of
living there: the root project does not typecheck (§2), and a module tested only from there must be
in the root `coverage.include` and excluded from its package's.

## Prove a guard by deletion, and confirm a negative control fails for the reason you think.

## A proof-by-deletion belongs to the SHAPE of the code it was taken against.

Restructure that code and the deletion can stop failing, with every test still green and nothing
saying so. Re-run the control after the restructure, and move the proof to whatever still catches it.

The instance (2026-09-21, task P4a of the storage switch). `packages/printing`'s agent pull used to
claim jobs in two statements — a locking `SELECT ... FOR UPDATE ... SKIP LOCKED`, then an `UPDATE`
keyed only on the ids it returned. `runtime.race.test.ts`'s header recorded a deletion for that
shape, and the sentence is copied here because the change below replaced it and the report it cited
(`task-5-report.md`) is not in this tree: *"with it, agent B skips agent A's in-flight row and the
job prints exactly once; delete it and B re-claims the same row after A commits, printing it twice
(total 2 → this test's `toBe(1)` fails)"*. That is a receipt nobody now holds, recorded as what the
old header said rather than as something re-run.

P4a replaced the pair with one statement — an `UPDATE ... WHERE <key> IN (locking SELECT)`. Three
control runs, each with `for update ... skip locked` removed from `packages/db/src/job-claim.ts` and
nothing else touched:

- `pnpm --filter @waitron/printing test -- runtime.race runtime.reclaim`, against the first version
  of the one statement (keyed on `ctid`) — **5 passed**.
- The same command against the version that shipped (keyed on the row's primary key) — **5 passed**
  again. The old proof does not hold for either.
- `pnpm --filter @waitron/db test -- job-claim.pg`, against the shipped version — **3 failed**,
  read on 2026-09-21, which on the day was every case in that file. That suite was deleted on
  2026-09-22 with the rest of the real-PostgreSQL tier; read it with
  `git show origin/main:packages/db/src/job-claim.pg.test.ts`. Only the FIRST failure is the
  control: it fails on the 30-second test timeout, which is the waiting. Its holder is then still
  parked, so the per-test reset blocks on that holder's row locks and takes the rest of the file
  down with it. Expect the
  control run to take minutes.

So what the clause buys is that a claimer does not WAIT, and that was the property the
real-PostgreSQL job-claim suite then held. What keeps a row from being claimed twice without
it was not measured and is not a property of the helper: it depends on whether the CALLER's
predicate excludes the state its stamp writes, which `claimPrintJobs`'s does.

## The key a claim stamps by must be the row's identifier, not its physical address.

**Historical as of 2026-09-22 (task F1, the SQLite switch).** Everything below was measured on
PostgreSQL, and the rule it paid for has been removed from CLAUDE.md rather than reworded: SQLite
has no `ctid` to key on, and a claim runs inside a write transaction no other writer can interleave
with, so the failure shape cannot arise. It is kept here because the *lesson* — a locking selection
has to carry its choice out on something that survives a rewrite — is about databases, not about
PostgreSQL, and slice 2 puts a second writer back. The suite named below was deleted with the rest
of the real-PostgreSQL tier; read it with
`git show origin/main:packages/db/src/job-claim.pg.test.ts`.

`ctid` is the obvious way to carry a locking selection's choice out to the UPDATE around it, and it
is wrong. Measured 2026-09-21 on PostgreSQL 18, with a claim parked mid-statement on an advisory
lock inside its own predicate while another transaction committed a change to the row it was about
to take: keyed on `ctid` the claim returned NOTHING — the outer scan still saw the row where it used
to be, while the selection had followed it to where it now was — and keyed on the row's primary key
the same claim took the row and carried the other transaction's change.

The measurement is one row, so what it shows is that a rewritten row is MISSED. In a batch the rows
nobody touched are still stamped, which is the shape worth worrying about: the claim comes back
short and says nothing.

The case was "takes a row another transaction rewrote while the claim was running", in the deleted
suite above; set its `key` to `ctid` and it failed with `expected [] to deeply equal
[ { position: 1, ... } ]`. What survives on SQLite is `packages/db/src/job-claim.sqlite.test.ts`,
which pins the one-statement claim's shape but cannot pin this property — there is no second writer
to rewrite the row.

## Vitest 4 ships no default coverage excludes, and `include`/`exclude` replace rather than merge.

`coverageConfigDefaults.exclude` is `[]` in 4.1.11 and the object has no `all` key; in 3.2.7 it was a
17-entry list — `**/[.]**` among them — with `all: true`. No default exclude GLOBS are applied for you
now: what scopes a package's report is its own `coverage.include`. The provider still drops four
things in code rather than as globs (`@vitest/coverage-v8@4.1.11`'s `dist/index.js`): anything whose
URL is not `file://`, anything under `node_modules`, and vitest's and vite's own client chunks.

The failure this section was written for is about the exit code rather than about the default list,
so it still stands. The root config's first version measured `All files | 0 | 0 | 0 | 0`, wrote
`"Unknown"` percentages and **exited 0** with the thresholds intact — that was a Vitest 3 run whose
`include` pointed inside a dot-directory the default list swallowed. Whenever a config's numbers
could plausibly be nothing, read the per-file table, not the exit code. (The root config now carries
no `exclude`.)

## `errors.ts` reachability is guarded once, in `scripts/errors-reachable.test.ts`,

which discovers every `packages/*` shipping `src/index.ts` + `src/errors.ts` and text-walks the
import graph from the barrel. The thirteen hand-copied per-package versions were deleted on
2026-08-11: six of them (the "construct an `AppError`" shape) passed with `errors.ts` fully
unreachable. It reads text, so a `from "./errors.js"` inside a comment fakes an edge — stated in its
header; comment-stripping was rejected because a block stripper mis-parses a `/*` inside a string.

**What makes a test prove nothing**

## Test public recovery links through the real boot modes that serve them.

Mounting a route on a bare Hono app cannot establish that trading or recovery boot installs it.
B1's standalone route tests passed while the real trading listener returned 404; the boot
regressions now request the guide and certificate aliases (`apps/server/src/boot.test.ts`,
`node-entry.test.ts`).

## Test provider HTTP refusals through the real client, as well as a throwing fake seat.

The SumUp unpair route's fake proved that a thrown error preserved the local reader, but the HTTP
client silently accepted 401/403/409. The reader-deletion regressions now reject those responses
and separately retain the already-absent 404 retry
(`packages/payments-sumup/src/sumup-client.test.ts`).

## Local reactivation cannot restore a removed provider registration.

Reader Enable initially accepted a row after Unpair had removed it at SumUp. Successful unpair now
records a local marker which only provider-verified adoption clears; the concurrent
Enable/unpair regression locks the reader before deciding
(`apps/server/src/payments-api.test.ts`).

## A fixture no check reads is unverified data, and a green suite resting on it proves nothing about the records production can build.

`@waitron/verifactu`'s `validate` had no production caller, so the shared alta fixture had drifted
into a record AEAT would reject — a full invoice naming no recipient — with the whole
`fiscal-verifactu` suite green on it. Cost: every operator-typed field reached the append-only
`registros_facturacion` unchecked, and the bad fixture had been masking a real production defect
(`recordSale` built an F1 and never filled in `Destinatarios`); correcting it took 42 tests from red
to green across eight files and left three red that were the bug. When a fixture describes
something an authority will judge, run the real check over it. Pointer:
`packages/fiscal-verifactu/src/chain.record-validation.test.ts`.

## `toMatchObject` checks only the keys you list.

A key you never list is never checked at all; `toEqual` is what put `memberOf` under a matcher for
the first time. **The worked example is historical** — it was taken on PostgreSQL, and the file it
names left this tree with the storage switch (read it with
`git show origin/main:packages/provisioning/src/instance-state.ts`). What the matcher hid there:
`pg_roles.rolname` is `name`, so `array(select rolname …)` was `name[]`, which `node-postgres`
handed back as the wire literal `"{app_user}"` through a field typed `string[]` — hence that
file's `::text[]` casts. Work such a failure out case by case:
`"{app_user_probe}".includes("app_user")` is the one shape where string and array disagree, a false
positive that SKIPS a needed grant. No equivalent example has been found in the current tree.

---

## Concurrent coverage runs must not share a package's report directory

Two local coverage runs can select the same package through expanded dependencies. In A2,
when the hook still ran package coverage,
two overlapping fiscal-verifactu runs ended with `ENOENT` writing `coverage/.tmp/coverage-41.json`;
Vitest cleans that shared directory. Inspect the resolved selection first, or give an intentional
second run its own `--coverage.reportsDirectory`. Receipt:
`docs/superpowers/plans/2026-09-12-setup-wizard-a2.md`.

**And put that second directory outside the package**, which the advice above did not say and
which is the more expensive half. The receipt it cites already worked that way —
`docs/superpowers/plans/2026-09-12-setup-wizard-a2.md` records that "the follow-up used a separate
`/tmp` report directory" — so the stronger remedy was the practice before it was the rule. A
directory left inside the package was measured as source by the next PACKAGE run. Every reading in
this section was taken on Vitest 3.2.7, where the only two entries in the default coverage excludes
that would have caught such a directory were `coverage/**` and `**/[.]**`. That list is gone —
`coverageConfigDefaults.exclude` is `[]` in 4.1.11 — so what decides now is the package's own
`coverage.include: ["src/**/*.ts"]`. On 4.1.11 that closes this route: untested-file discovery calls
`glob(include, { cwd: root, … })` with `root` at the package directory (vitest 4.1.11's
`getUntestedFilesByRoot`), so a directory outside `src/` is never scanned, and the `contains` match
described in the include section above widens only over files a test actually loaded — which a report
directory's own assets never are. Keep putting the second directory outside the package anyway: it
costs nothing and does not depend on which Vitest is installed.

Both qualifiers matter, and they rest on different evidence. The NAME
one was measured on
2026-09-18 in `packages/scheduler`: `--coverage.reportsDirectory=.coverage-review` does NOT
contaminate, the next run reading 402/404 at exit 0. The PACKAGE one is a reading, not a run — the
root Vitest project sets its own `coverage.include` (`vitest.config.ts`), which replaces rather than
merges and names nothing under `packages/`, so a stray directory in a package should be invisible
there. Untested.

What a non-dot directory inside the package costs: one run into `./coverage-x`, then an ordinary
`pnpm --filter @waitron/scheduler test:coverage`, and the second run's statement total went from 404
to 671 while its covered count stayed at 402 — **59.91%** against a 90 threshold, exit 1. The 267
extra statements are named in that run's own `coverage-summary.json` and are the HTML reporter's own
assets, written into the directory it had just written: `sorter.js` (192), `block-navigation.js` (73)
and `prettify.js` (2). Each leftover directory adds another 267.

It is worth a paragraph because it does not look like tooling — it looks like a coverage regression.
**Attribute every reading to the tree it came from**, or the receipt misleads exactly the way the
defect does: four successive runs here read 407, 674, 938 and 1205 statements, which is not one
sequence but two, the first two on a tree whose clean total is 407 and the last two on one whose
clean total is 404 (407, 407+267; then 404+2x267, 404+3x267).

**What removing the directories does NOT buy is a repeatable branch count.** Statement readings do
repeat — 405/407 and 402/404, reproduced independently by a second reviewer — but two clean runs of
the same BASE tree gave 98/101 and 99/102 branches, so a before/after branch comparison across runs
measures nothing. Compare statements; do not quote a branch delta.

**Carried from the retired Copilot instructions file** (deleted 2026-09-12; read it with
`git show f5941462:.github/instructions/waitron.instructions.md`). What was checked before deleting it: Copilot's automatic review was removed from
this repo's ruleset on 2026-09-06, no workflow under `.github/workflows/` references the file, and
Claude does not load `.github/instructions/`. Not checked: whether anyone's IDE Copilot still reads
it — an `applyTo: "**"` instructions file would be picked up there.

## A grant assertion had to call `asAppUser(tx)` — retired with the grants themselves

**Historical.** On PGlite the connection arrived as a superuser, so a privilege test that never
switched role ran as the owner and asserted nothing, however much it asserted; `asAppUser(tx)` ran
`set local role app_user` and was what made such a test mean anything. SQLite has neither roles nor
grants, so `asAppUser` (`packages/db/src/testing/roles.ts`) is an empty function today and there is
no privilege for it to switch to. The shape is worth keeping even though its subject is gone: a
test that asserts something is REFUSED has to put itself on the refused side first, or it proves
nothing about the refusal.

## A contention test proves the write queue serialises writers, not that a lock blocked

**This section replaces one that said PGlite cannot test lock contention and that chain-append
concurrency must therefore run against real Postgres through Testcontainers.** Both halves of that
advice retired with the engine: there is no PGlite, no PostgreSQL container tier, and no
`FOR UPDATE`. The executable demonstration it pointed at — a suite named
chain.pglite-cannot-test-contention.test.ts, beside the chain suites in
`packages/fiscal-verifactu/src` and again in `packages/workforce/src` until the SQLite flip deleted
both — existed to keep someone from dropping those two packages' Testcontainers dependency, and
neither package declares one now. That suite is named here without a backticked path deliberately:
the pointer guard (`scripts/claude-md-pointers.test.ts`) requires a backticked path to resolve, and
this one no longer does.

Testcontainers itself has not left the repository, and which members still declare it is a property
to check rather than a list to remember. **The bare key is only half the search.** `testcontainers`
and `@testcontainers/postgresql` are two separate dependency names, and most of the members that
kept one kept only the second, so a `grep -rn '"testcontainers"'` over the manifests reports a
handful and misses the rest. The grep that answers the question is
`grep -rn testcontainers --include=package.json . | grep -v node_modules`, which catches both
spellings. What still IMPORTS one of them is a much shorter list:
`grep -rn 'from "testcontainers"\|from "@testcontainers/postgresql"'` over `packages`, `apps`,
`bench` and `scripts`, taken 2026-09-23, returned `bench/sqlite-failover/src/store.ts` and
`bench/pglite-throughput/src/bench.ts` and nothing else — nothing under `packages/` or `apps/` at
all. Neither of those two is a test suite: both benches declare a `bench` script and no `test`
script, so no suite in this repository starts a container by importing them. Every remaining
declaration is a leftover the flip did not remove.

What a contention suite asserts now is that one writer holds the venue file at a time
(`packages/store/src/write-queue.ts`). `packages/fiscal-verifactu/src/chain.concurrency.test.ts` is
the worked example, and its own header names the two properties that did NOT survive the change:
per-node parallelism is gone — every writer serialises on the FILE, whichever node it appends to —
and a premise check that writers run on distinct backends has no counterpart, because one writer at
a time is the design rather than the thing that would make the suite theatre.

**Start a writer through `withTransaction`, never through a bare `db.transaction(...)`.** Only the
former takes the write queue (`packages/db/src/tenancy.ts` → `db.withWriteLock`). Twenty bare
`db.transaction(...)` calls started together against one venue file fail
`no such savepoint: wt_sp_1` — measured on the deleted suite above, which is how it was found.

## Treat "there is a test" as an unfinished sentence

This project has a documented history of tests that passed while the behaviour they were named
after was absent or broken. (The retired Copilot file cited
`.superpowers/sdd/coverage-mutation-report.md` here; that path does not exist in this repository and
did not when the file was deleted, so the pointer is dropped rather than carried forward.) Coverage
percentage does not rule this out — it only proves a line executed, not that anything asserted on
the result. When reviewing a test, ask specifically: if the behaviour under test were deleted or
reverted, which assertion would fail, and how? "It calls the component and doesn't throw" is not an
answer. `pnpm --filter @waitron/ui mutation` is the tool this repo uses to check that
systematically — a surviving mutant on a boolean flag, a comparison operator, a conditional guard, or
a whole statement deleted means some test suite member exercises that code without noticing when it's
wrong. The deleted-statement kind arrived with Stryker 10, which replaces a call statement, or a
`throw new …`, with an empty one and reports both under the mutator name `CallExpression`. **It only
does so when nothing else in that statement is mutable** — the mutant is dropped again if any other
mutant came out of the statement's subtree, so a string literal or an operator anywhere in the
statement suppresses it, and `throw new AppError("series.not_found", {})` never gets one. Nearly every
`throw new AppError(` in this repo passes a literal code, so do not expect this mutant to police
them. Where it does appear it catches a side effect nobody asserts on: the shape that produced it
here was a memo cache write whose arguments were both plain identifiers.


## Rejected writes assert their domain error code

During the Categories review on 2026-09-13, deleting the duplicate-membership guard left
`categories.test.ts` green: the later unique-constraint failure also matched `toBeInstanceOf(Error)`.
Keep rollback assertions, and assert the domain code that the API maps to its client response.

**The mutation below was run on PostgreSQL and has NOT been re-run on this engine.** Replacing the
duplicate-set condition in `replaceProductCategories` with `false` and running
`TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/catalogue test -- src/categories.test.ts
-t 'validates replacement primaries and rolls back invalid saves'` failed: expected
`category.membership_invalid`, received a wrapped PostgreSQL `23505`, "duplicate key value violates
unique constraint product_categories_tenant_id_product_id_category_id_pk" (2026-09-13; that
constraint lost its tenant column on 2026-09-14, so the name was already stale before the engine
changed). What SQLite raises in its place is not recorded here, because nobody has re-run it — and
the command itself now carries a pointless `TESTCONTAINERS_RYUK_DISABLED`, since this package starts
no container. None of that touches the rule: a constraint failure satisfies `toBeInstanceOf(Error)`
whichever database raises it, so assert the domain code. The test named above still exists
(`packages/catalogue/src/categories.test.ts`).
Note the test name — an earlier version of this paragraph named a test that no longer exists, and
because a `-t` filter matching nothing skips every test and still exits 0, following it produced a
green run that looked like a passing control.

**Historical, and the code is gone: `deleteCategory` takes no lock today.** The `for("update")` went
with the storage switch, so the paragraph below is a PostgreSQL measurement and not a description of
current behaviour. It is kept because it records what the lock was FOR.

The second guard in the same function family WAS the category identity row lock — the
`for("update")` on the category row in `deleteCategory`. Removing it made the category-route race
suite fail, but not where you would expect, and no longer on a `category.in_use` code: since that delete cascades rather than refusing, nothing throws that
code on this path any more. What happens instead is that the delete still waits, because its final
`delete from categories` collides with the KEY SHARE lock the concurrent route insert holds through
its foreign key — it just waits too late. By then the earlier step that clears `preparation_routes`
has already run and seen nothing, because the insert had not committed when it looked. So once the
insert does commit, PostgreSQL rejects the category delete with `23503` on
`preparation_routes_category_fk`, "Key (id)=(…) is still referenced from table preparation_routes",
and the test fails on `expected 'rejected' to be 'fulfilled'`. The lock's job is to move the wait in
front of the cascade reads, not to create the wait. Both controls passed again with the production
guards restored.

**That second control has no prover any more, and nothing replaced it (2026-09-22).** The suite it
ran against staged the wait on two PostgreSQL backends and watched it with `pg_blocking_pids`; the
storage switch leaves one writer per venue file, so the wait cannot be staged and the suite was
deleted. The `for("update")` clause itself went with the switch. The paragraph above is kept because
it records what the lock was FOR — but it is a measurement about an engine this product no longer
runs, and nothing today would notice if the ordering it describes were wrong.

## A default you did not state is not a value you tested

`@simplewebauthn/server` 14 decides its default signature-algorithm list when the module loads, from
what the running Node's Web Crypto reports:

```js
// esm/registration/generateRegistrationOptions.js:23-30 in 14.0.2, verbatim
export let defaultSupportedAlgorithmIDs = [
    COSEALG.EdDSA,
    COSEALG.ES256,
    COSEALG.RS256,
];
if (SettingsService.runtimeSupportsPQC()) {
    defaultSupportedAlgorithmIDs = [COSEALG.ML_DSA_44, ...defaultSupportedAlgorithmIDs];
}
```

Both `.d.ts` files still document the default as `[COSEALG.EdDSA, COSEALG.ES256, COSEALG.RS256]`.
Reading the types tells you three; only running tells you four.

`verifyRegistrationResponse.js:36` defaults its own `supportedAlgorithmIDs` to that same mutated
binding, so one runtime probe decides both what a WebAuthn registration OFFERS and what it ACCEPTS.
On Node 26.7.0 the probe says yes, and it is flagged experimental: importing the package prints two
warnings, `"The supports Web Crypto API method is an experimental feature and might change at any
time"` and the same sentence for `"The ML-DSA-44 Web Crypto API algorithm"`.

Version 13.3.2 had no such probe. Its options default was the three classical algorithms and its
verify default was a fixed list of ten — `supportedCOSEAlgorithmIdentifiers`,
`[-8,-7,-36,-37,-38,-39,-257,-258,-259,-65535]`, read out of the installed 13.3.2 tree. So pinning
three at both call sites keeps the OFFER identical to 13.3.2's and narrows what registration
ACCEPTS.

What made this worth a rule is the half-fix. Pinning `supportedAlgorithmIDs` on
`generateRegistrationOptions` alone made the OPTIONS byte-identical to 13.3.2's on fixed inputs — a
real measurement, and one that reads like the whole answer. It is not: the verify side still took the
runtime's list. The gate is not a signature check: `verifyRegistrationResponse.js:137` compares the credential public
key's own declared COSE algorithm against the list. A synthetic response whose key declares ML-DSA-44,
an algorithm those pinned options never offered, run against all three configurations:

```text
UNOFFERED -48 v13 REJECT Unexpected public key alg "-48", expected one of "-8, -7, -36, -37, -38, -39, -257, -258, -259, -65535"
UNOFFERED -48 v14 verified= true
UNOFFERED -48 v14 verify pin REJECT Unexpected public key alg "-48", expected one of "-8, -7, -257"
```

The middle line is the defect: the upgrade made the server accept a credential it had stopped asking
for, and this route persists whatever comes back verified (`packages/identity/src/passkey.ts`, the
insert that follows the `verified` check). Three reviewers on the branch reached the same file; the
one that RAN the response is the one that could show the middle line rather than argue about it.

Both call sites now take one module-level list (`SUPPORTED_ALGORITHM_IDS` in
`packages/identity/src/passkey.ts`), and `packages/identity/src/passkey.test.ts` asserts it on both —
the offered `pubKeyCredParams` and the argument handed to the verifier. `verifyAuthenticationResponse`
takes no such parameter (it verifies against the stored public key), so the assertion ceremony has
nothing equivalent to pin.
