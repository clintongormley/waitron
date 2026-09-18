# Testing guide

This file holds the evidence behind waitron's testing rules — the mechanism, the measurement, and
the incident that paid for each one. The one-line rules themselves live in the repository root
`CLAUDE.md`, section 4 ("Testing"), which points here. Read this before writing or debugging a
test, especially one that touches real PostgreSQL or runs in browser mode.

**Choosing a target: PGlite versus real PostgreSQL**

## Two targets.

**PGlite** (`createPgliteDb` + `runMigrations`) is hermetic and fast. Its connection arrives as a
superuser, so a privilege test that never switches role runs as the owner and asserts nothing;
triggers still fire. Every query serialises onto its single backend, so a contention test on PGlite
is a **false pass**. **Real Postgres** via Testcontainers is required for concurrency, for triggers
running as the deployment role, and for anything that depends on who CONNECTED rather than who the
session made itself. `describeEachTarget` (`packages/db/src/testing/harness.ts`) runs a suite against
both. Pick the lighter one when the heavier one's justification does not apply, and say why in a
comment.

**Grants ARE enforced on PGlite once the session assumes the role.** This file and `CLAUDE.md` both
used to say the opposite — "grants are not enforced" — which sends a reader to a Docker container
they do not need. It is false. Corrected on the `onboarding` branch (2026-09-13) after running a
probe directly against PGlite 0.5.4, with a control in the other direction:

- The default connection reports `current_user = postgres`, `usesuper = true`. In that session, a
  `delete` on a table it holds no `delete` grant for **succeeds**. That is the control: this is what
  "grants are not enforced" would look like, and it is the only case where it is true.
- In the same session after `set local role app_user`, `current_user` is `app_user`; a `select` the
  role holds a grant for succeeds, and the `delete` it does not hold is **refused with SQLSTATE
  42501, "permission denied for table"**.
- Column-scoped grants are enforced too, which is the shape `packages/db/src/allocate-number.test.ts`
  ("allocates as the app role") depends on: under `grant select, update (next_number)`, updating
  `next_number` succeeds and updating an ungranted column in the same table is refused `42501`.
- A privilege held only through group membership is honoured as well: a `select` granted to a group
  the role is a member of succeeds.

Two real limits remain, and they are why the rule above still exists. PGlite has one backend
(`select count(*) from pg_stat_activity` returns 1), so nothing can contend. And a session that
assumed the role with `set role` can leave it again — after `reset role`, `current_user` is back to
`postgres` and the same `delete` succeeds — so PGlite can show that a grant is enforced, but not that
code is CONFINED to a role the way a real connection as that role confines it.

Note what this does NOT license. `asAppUser(tx)` is still mandatory in a grant assertion on either
target (see the rule further down this file), and nothing here changes the concurrency rule.

**Owning and cleaning up a database in a suite**

## Don't own a database in a suite — let a helper own it.

`usePgliteDb` / `useRealPostgres` (`@waitron/db/testing/lifecycle.js`) register their own hooks and
return an accessor that throws before setup. Raw `beforeAll`/`afterAll` only when the suite
legitimately builds its own resource, and then guarded (`if (db !== undefined) await db.close()`) —
enforced by `scripts/guarded-teardowns.test.ts`, whose header records why an ESLint rule was
rejected. Suites sharing a database clean up in a `finally`, order-independent.

## A PGlite suite is being moved behind one helper, and it is not the rule yet.

`useVenueDb` (`@waitron/db/testing/venue-db.js`) forwards to `usePgliteDb` unchanged — same options,
same handle, same per-test reset — so that the planned SQLite switch replaces one function body
instead of every call site (plan `2026-09-16-sqlite-slice1-storage-swap.md`, task P2).

State of the rollout, so nobody reads more into this than it says: **no suite has been converted
yet.** The suites that call `usePgliteDb` still call it directly, and they convert one package at a
time. Note also that `usePgliteDb` is not the only door: some suites call `createPgliteDb`
themselves, and `describeEachTarget`'s PGlite half is a third. Those are not a mechanical rename and
are decided with the storage flip, not here.
Until that finishes this is guidance for a converted package, not a rule — a rule with standing
violations needs a guard, and a guard cannot pass while the violations stand. The house rule in
`CLAUDE.md` and the guard that enforces it therefore land TOGETHER, in their own pull request AFTER
the last conversion. That is the shape the column-vocabulary rollout ended in: #414 was the last
conversion, and #416 added `scripts/column-vocabulary.test.ts` and the `CLAUDE.md` line together
afterwards.

**Containers and Docker**

## A container port-binding timeout needs Docker state as well as database logs.

Save `docker inspect`'s `HostConfig.PortBindings` and `NetworkSettings.Ports` before removing the
failed test fixture. The reader-adoption gate found a healthy PostgreSQL container with a requested
TCP binding but an empty published-port list; a focused rerun passed without explaining the first
failure. Receipt: `docs/superpowers/plans/2026-09-12-card-reader-adoption-and-status.md`.

## Reuse a supplied test container before probing Docker again.

A failing `docker info` command is not evidence that a container global setup already started is
absent. Run 34507423350 failed `deployment.test.ts` at this redundant check;
`harness.docker.test.ts` injects a CLI timeout to verify the shared-container path and retains the
required-Docker failure without either signal.

## Locate the unfinished package before diagnosing a silent shard as PostgreSQL contention.

Four inspected `test-light-a` hangs left only Bookings' browser files unfinished while Sync and
every database file completed; two jobs ran for about six hours. A Vitest test timer does not
bound a browser whose event loop has stopped. Preserve the job log and use an outer process/job
deadline, not a retry as proof of repair. Evidence and limits:
`docs/superpowers/specs/2026-09-09-test-load-design.md`.

## Vitest 3's fork limit belongs on the outer config, even with projects.

Its shared pool reads `vitest.config.poolOptions`; per-project `singleFork` is a separate
scheduling choice. Moving `maxForks: 4` inside fiscal-verifactu's project in #286 started 17
workers on the local host, observed during a Sync migration stall. fiscal-verifactu has since dropped
its projects. `scripts/fiscal-test-budget.test.ts` pins these configs and no others: fiscal-verifactu's
outer `maxForks: 4`, and `packages/media/vitest.config.ts`, which still has projects, keeping
`maxForks: 2` on its outer config with none inside a project. The test-load design records the live
process and database probes.

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

Guard: `scripts/spawn-timeout-budget.test.ts`, over `scripts/`, `packages/` and `apps/` alike. The
two halves are different shapes and it is worth knowing which you are in. Under `scripts/` the waits
are `spawnSync` timeouts and the bound is set in the file. Under `packages/` and `apps/` **nothing
spawns at all** — every wait is an `expect.poll` or a `vi.waitFor` — and a file almost never sets its
own bound, so the guard resolves one from the package's `vitest.config.ts`. That lookup is not a
refinement: without it the check invents a failure for every package suite that relies on its config,
which was 11 files when it was measured.

Resolving that bound is most of the work, and four traps in it each have a case in the guard's own
detector block, because each one was got wrong first.

**The default is not always 5000.** Vitest resolves `testTimeout ??= browser.enabled ? 15e3 : 5e3`,
so a browser project's default is three times larger. Reading 5000 for one would accuse a correct
browser suite the first time it waited between five and fifteen seconds — latent across four packages
here until it was fixed.

**A `testTimeout` beside `projects` is INERT** for a project run unless that project sets
`extends: true`, so taking it reports a bound a browser project does not have
(`packages/media/vitest.config.ts` has exactly that shape). With `extends: true` the opposite holds
and the project does inherit it — `apps/dashboard/vitest.config.ts` has that one. Both directions
need modelling; handling only the first silently mis-resolves the second.

**A package can hold a SECOND config** for suites its main one excludes, keyed by a filename suffix:
`vitest.preprod.config.ts` runs `*.preprod.test.ts`. There are 48 main package configs here and three
suffixed ones, so the suffix picks the config.

**Brace lists are not optional.** Vitest's own `configDefaults.exclude` carries
`**/.{idea,git,…}/**`, so a matcher that rejects `{}` cannot read the `exclude` of any project that
spreads it — which silently left 60 real files unresolved, plus 142 more in an app whose project sets
no `include` at all. A project with no `include` uses Vitest's default one, which matches every test
file.

Where it still cannot resolve a bound — two matching projects disagreeing, an `include` glob it does
not model, a config that throws on import — it declines. Of the files that declare a wait of five
seconds or more, 13 are compared and none decline today; the guard asserts a floor on that count, so
a break in the lookup cannot leave it silently checking nothing.

It is weaker than its name in three ways its own header states: it reads TEXT, so a timeout from an env var or built in a helper is invisible; it
works per FILE, taking the largest bound anywhere; and it compares that bound against the largest
SINGLE wait, which the paragraph above shows is necessary and not sufficient. It also cannot tell
code from strings, so a number inside a fixture string counts as though it were code — the guard is
its own example, since `budgets()` run over it reports numbers taken from its own test fixtures while
the suite performs no wait at all. It is the `docs/backlog.md` B9 entry that records why this scope was widened. It counts every `timeout:` option as a wait, not only `spawnSync`'s —
`expect.poll` and `vi.waitFor` are bounded by the same clock.

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

## Networked PostgreSQL fixtures use one Docker network and unique container names for DNS.

Testcontainers 12's `withNetworkAliases()` also attaches the default bridge. On this Docker Desktop
host that produced interfaces with MTUs 65535 and 1500: a 1,400-byte query passed, a 1,600-byte
query stalled, and removing the unused bridge made queries up to 100 KB pass. Use
`networkedPostgresContainer` (`packages/db/src/testing/postgres.ts`); its real-Docker guard checks
one interface, name resolution and a large query. WireGuard peers use `node.networkHost`. Evidence:
`docs/superpowers/specs/2026-09-09-test-load-design.md`.

## `TESTCONTAINERS_RYUK_DISABLED=true` is required locally. A recurrent real-PG stall needs a retained log and a live database snapshot.

The #286 boot retry and cluster mutex did not eliminate the later migration stall; its PostgreSQL
backend was waiting for client input, with no blocking backend. Reducing concurrency alone did not
fix the dual-network defect above. Keep the boot bounds and the package/worker caps, but locate the
stalled operation before assigning its cause to resource contention.

## With Ryuk off, INTERRUPTED runs leak containers

(a clean vitest exit self-reaps via `globalTeardown`). The bloat (once: 173 volumes, 23 GB) starves
PGlite `beforeAll`s and the `freePort` race, while an isolated re-run passes and proves nothing.
Run `pnpm reap` before local database testing when needed. The command
(`scripts/reap-testcontainers.mjs`) removes containers labelled
`com.waitron.reapable` (stamped by `startPostgresContainer` in packages/db, which a test pins, and by
`startStore` in bench/sqlite-failover, which nothing pins) AND older than 2 h —
so another repo's or a live watch-mode container survives — with their anon volumes. It never
touches images and there is no blanket `docker volume prune` (it would reach other projects and the
named dev volumes). `docker volume inspect` before any manual `rm`. Once a leaked container is gone
its anon VOLUME is orphaned (no `com.waitron.reapable` label to find it by), so `pnpm reap` cannot
reclaim it — a dangling-anon prune would reach the HA repos' testcontainers on this machine, so
those stay a clean-exit-plus-manual-targeted sweep.

## An interrupted run also ORPHANS its vitest workers, and `pnpm reap` sweeps these too.

A hard interrupt (an Esc, a killed parent, a timeout signal) can take the orchestrator while its
tinypool workers reparent to launchd (ppid 1) and spin at ~100% CPU indefinitely — SIGTERM did not
stop them, `kill -9` did (cost: four burned the fan for hours on 2026-09-07). The sweep is scoped by
ppid 1 AND the `node (vitest N)` process TITLE (its parens), NOT a bare `vitest` word anywhere in
the line — that broader match killed a real orphan whose argv only held a `vitest` log path (run-it
review).

## A probe that needs a Unix SOCKET runs inside the container.

Bind-mounting a `postgres` socket dir out of Docker Desktop's VM gives `ECONNREFUSED` on macOS (and
a scratchpad path blows the 104-byte `sun_path` first). `apk add nodejs npm && npm i pg` in the
container; parsing-only probes are fine on the host.

**Logical replication tests**

## A widened subscription can drop publisher writes committed before its apply worker restarts

`ALTER SUBSCRIPTION … SET PUBLICATION` returns before the subscriber's running apply worker restarts
(measured: it returned while that worker was paused and could not restart). Read in the source, not
tested: the worker takes the new list only when it restarts. A publisher write committed in that
window was lost, not delayed, so a longer poll cannot help. Wait for an apply worker whose
`pg_stat_activity.backend_start` is later than a `clock_timestamp()` read taken on the subscriber
before the ALTER, then write. `setPublicationsAndAwaitRestart` in
`apps/server/src/replication-arc.e2e.test.ts` does this; step (4) of that file failed once on CI
(#356) without it, its 45 s poll ending on `'Renamed pre-fence'`; fixed in #361.

Receipt, 2026-09-14, PostgreSQL 18.6 (`postgres:18-alpine`), from a throwaway probe on
`startTwoNodeCluster` (superuser connections, one table in each of two publications, subscription
created on both then narrowed; deleted afterwards):

- Apply worker paused with `docker exec … kill -STOP` for 500 ms across the widen and a write:
  **10 / 10 lost.** The slot's `confirmed_flush_lsn` was before the write while paused and at the
  write's position once the old worker had exited; the write was still absent after a later ledger
  row, written after that exit, had arrived.
- The same pause with no ALTER: 0 / 10 lost.
- Unpaused, idle host: 0 / 221 lost, across four runs (one of those widens was to the list the
  subscription already had, left behind by a bug in an earlier version of the probe).
- Unpaused, 30 busy PL/pgSQL loops on each node: **8 / 500 lost.** Here "lost" means absent 3 s after
  the write and still absent after a ledger row written at that point had arrived (waited up to 30 s;
  it arrived every time).
- Waiting for the apply worker's pid to change before writing: 0 / 500 lost under the same load, and
  10 / 10 arrived when paused. That measured a pid-only wait. The start-time check the test uses has
  the forced runs on the real test behind it instead: with the 500 ms pause, the old code left the
  rename absent for the whole 45 s poll in 2 / 2 runs (one local, one by the Codex review seat), and
  the start-time wait passed in 2 / 2.
- Narrowing never let a later write through: 0 of over 1,000 unpaused, 0 / 10 paused.
- A `SET PUBLICATION` to the list the subscription already had did not restart the worker in 5 / 5
  tries, each over 5 s, so a restart wait after a no-op ALTER times out.

Read in the PostgreSQL source (REL_18_STABLE), not tested: `LogicalRepApplyLoop` in `worker.c` handles
a queued keepalive, calling `send_feedback` with the received position (reported as flushed when
nothing is pending), before `AcceptInvalidationMessages(); maybe_reread_subscription();`, and a
restarted walsender begins at the slot's `confirmed_flush` (`logical.c`, "has been already streamed,
forwarding to").

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

`packages/ui` and `apps/till` have no such reset, and `packages/ui/src/components/wt-button.test.ts`
ends a test hovering a button without unhovering it — the same latent failure lives there, unpaid for
so far.

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

## Vitest's default coverage excludes swallow every dot-prefixed path (`**/[.]**`), and `include`/`exclude` replace rather than merge.

The root config's first version measured `All files | 0 | 0 | 0 | 0`, wrote `"Unknown"` percentages
and **exited 0** with the thresholds intact. Whenever `include` points inside a dot-directory, read
the per-file table, not the exit code. (The root config now carries no `exclude`; nothing it
measures is dot-prefixed.)

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
(`apps/server/src/payments-api.pg.test.ts`).

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
the first time. What it hid: `pg_roles.rolname` is `name`, so `array(select rolname …)` is
`name[]`, which `node-postgres` hands back as the wire literal `"{app_user}"` through a field typed
`string[]` — hence the `::text[]` casts in `instance-state.ts`. Work such a failure out case by
case: `"{app_user_probe}".includes("app_user")` is the one shape where string and array disagree, a
false positive that SKIPS a needed grant.

---

Adding a new real-PG test package: the shared-container pattern and its knobs (`useTemplateDb`,
`cloneTemplate`, `singleFork` vs `maxForks`, template-key naming) are in `docs/backlog.md` →
_Reference_.

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
directory left inside the package is measured as source by the next PACKAGE run: of the sixteen
patterns in vitest's default coverage excludes, the only two that would catch such a directory are
`coverage/**` and `**/[.]**`. Both qualifiers matter, and they rest on different evidence. The NAME
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

## A grant assertion must call `asAppUser(tx)` before the query under test

PGlite's connection arrives as a superuser, so a privilege test that never switches role passes
green while asserting nothing — it runs as the owner. (Once it does switch, the grant is enforced —
see "Two targets" above.) Every grant assertion must call
`asAppUser(tx)` (`packages/db/src/testing/roles.ts` — `set local role app_user`) before the query
under test; a grant test that skips this checks nothing about `app_user`'s reach regardless of what
it asserts.

## PGlite cannot test lock contention, on any schema

All queries serialise onto one backend
(`packages/fiscal-verifactu/src/chain.pglite-cannot-test-contention.test.ts` is a permanent,
executable demonstration of why), so `FOR UPDATE` parses and runs but never blocks — a hand-rolled
contention test can pass while nothing ever contended. Chain-append and allocation concurrency must
be tested against real Postgres via Testcontainers
(`packages/fiscal-verifactu/src/chain.concurrency.test.ts`), never PGlite alone.

## Treat "there is a test" as an unfinished sentence

This project has a documented history of tests that passed while the behaviour they were named
after was absent or broken. (The retired Copilot file cited
`.superpowers/sdd/coverage-mutation-report.md` here; that path does not exist in this repository and
did not when the file was deleted, so the pointer is dropped rather than carried forward.) Coverage
percentage does not rule this out — it only proves a line executed, not that anything asserted on
the result. When reviewing a test, ask specifically: if the behaviour under test were deleted or
reverted, which assertion would fail, and how? "It calls the component and doesn't throw" is not an
answer. `pnpm --filter @waitron/ui mutation` is the tool this repo uses to check that
systematically — a surviving mutant on a boolean flag, a comparison operator, or a conditional guard
means some test suite member exercises that code without noticing when it's wrong.


## Rejected writes assert their domain error code

During the Categories review on 2026-09-13, deleting the duplicate-membership guard left
`categories.test.ts` green: the later unique-constraint failure also matched `toBeInstanceOf(Error)`.
Keep rollback assertions, and assert the domain code that the API maps to its client response.

Replacing the duplicate-set condition in `replaceProductCategories` with `false` and running
`TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/catalogue test -- src/categories.test.ts
-t 'validates replacement primaries and rolls back invalid saves'` fails: expected
`category.membership_invalid`, received a wrapped PostgreSQL `23505`, "duplicate key value violates
unique constraint product_categories_tenant_id_product_id_category_id_pk". Re-verified 2026-09-13.
That constraint is now `product_categories_product_id_category_id_pk` — the tenant column went on
2026-09-14 — so a re-run prints the new name; nothing else about the measurement changes.
Note the test name — an earlier version of this paragraph named a test that no longer exists, and
because a `-t` filter matching nothing skips every test and still exits 0, following it produced a
green run that looked like a passing control.

The second guard in the same function family is the category identity row lock — the `for("update")`
on the category row in `deleteCategory`. Removing it makes
`apps/server/src/category-route-race.pg.test.ts` fail, but not where you would expect, and no longer
on a `category.in_use` code: since that delete cascades rather than refusing, nothing throws that
code on this path any more. What happens instead is that the delete still waits, because its final
`delete from categories` collides with the KEY SHARE lock the concurrent route insert holds through
its foreign key — it just waits too late. By then the earlier step that clears `preparation_routes`
has already run and seen nothing, because the insert had not committed when it looked. So once the
insert does commit, PostgreSQL rejects the category delete with `23503` on
`preparation_routes_category_fk`, "Key (id)=(…) is still referenced from table preparation_routes",
and the test fails on `expected 'rejected' to be 'fulfilled'`. The lock's job is to move the wait in
front of the cascade reads, not to create the wait. Both controls passed again with the production
guards restored.
