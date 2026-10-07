# Testing guide

This file holds the evidence behind waitron's testing rules — the mechanism, the measurement, and
the incident that paid for each one. The one-line rules themselves live in the repository root
`CLAUDE.md`, section 4 ("Testing"), which points here. A few receipts that other sections of
`CLAUDE.md` point at, beside the stream tests, are here too. Read this before writing or debugging
a test, especially one that touches a venue database or runs in browser mode.

**Asking for a database**

## There is one database target, and a helper opens it.

A suite that needs a database calls `useVenueDb` (`@waitron/db/testing/venue-db.js`). It makes a
temporary directory, opens it with the product's own opener, applies in order the migration sets it
is handed, and installs the append-only triggers those sets declare. There is no other target to
choose.

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
function any more, so all the guard holds today is that a reintroduced helper of that name, or a
comment pointing a reader at one, is reported rather than quietly accumulating. It says so in its
own header, at some length, so nobody mistakes it for a check on how suites open databases.

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

## A migration set gets a whole database-backed suite by calling one function.

`packages/db/src/testing/schema-conformance.ts` is a suite FACTORY — a function you call at the top
level of a test file, which declares a whole suite of cases for you. One call and the calling
package has a suite that builds a real database from a migration set and then compares it, table by
table, with the drizzle declarations that set is supposed to have built — down to what each column
and each constraint says, plus an inventory case both ways and one rule the database cannot state.
**The exact list is written out at the top of the factory itself, and is not copied here**, because
a second copy of it is a thing to keep in step and the last one had already dropped two entries.
Read the header comment of `packages/db/src/testing/schema-conformance.ts`, and
`SchemaConformanceOptions` below it, before you write a call site or read a failure.

Two other checks in the tree look at the schema, and knowing what they leave out is how to see what
this one is for. `scripts/schema-constraints.test.ts` holds every set's built database to three
hand-written lists and only notices an entry the schema is MISSING; note that only two of the three
match by name — its foreign-key list is `[child table, child columns, parent table]`, not a name,
while its unique indexes and its check constraints are matched by name. The
`schema-ownership.test.ts` several packages carry checks the table names a barrel exports against a
hand-written list of the tables that package owns. Neither of them reads a column's own definition
or what an object SAYS, in any systematic way. So a retyped column, a nullability or a default that
moved, a referential action dropped, a foreign key pointing at the wrong parent column, an index's
columns or its filter, or a changed check-constraint body went unnoticed until a query failed at
runtime. Those are what the factory compares. The one narrow exception, so nobody reads "unnoticed"
as "unreachable": two ownership suites do assert a parent column by hand, four keys in all —
`packages/payments/src/schema-ownership.test.ts` and
`packages/fiscal-verifactu/src/schema-ownership.test.ts` each name two in the generated SQL. Nothing
makes the next key get a line.

It reaches other packages through `@waitron/db`'s enumerated exports map, as
`@waitron/db/testing/schema-conformance.js`; inside `packages/db` the import is relative. A call
site lives at `packages/<pkg>/src/schema/schema-conformance.test.ts` and is a handful of lines.
`ls packages/*/src/schema/schema-conformance.test.ts` says which sets have one; a set with none is
not checked by anything.

**What a call site states.** `SchemaConformanceOptions` in the factory is the list to trust, with a
sentence on each field; this is the shape of it. Four fields are required:

- `subject` — the migration set under test.
- `subjectName` — the name the suite's own case names will use, `core` or `catalogue`. It names the
  SET, not the package, and it is read by whoever reads a failure.
- `declarations` — the package's schema barrel, handed in as `import * as barrel from "./index.js"`.
  These are the declarations the subject set is supposed to have built. A package with no barrel
  hands in the schema file its `drizzle.config.ts` generates from, as `packages/bookings` does;
  the suite reads only the exports that are tables.
- `declaresClosedVocabularies` — whether any column in this set is declared with a closed
  vocabulary. The caller states it and the suite checks the statement, rather than the suite
  counting. The vocabulary block is one case per such column, so a set with none leaves that list
  empty, and an empty list of cases is indistinguishable from a list that passed. `catalogue` states
  `false` and is the reason the field exists.

Three more are optional:

- `prerequisites` — the sets applied BEFORE the subject, in order. Omit it for a set
  that has none; core is one, and so is any module set whose SQL names no other set's table.
- `reload` — an arrow function that re-imports that same module from inside a test. It earns its
  keep only in a package that runs a mutation test, which among these callers is `packages/db`
  alone, and that is the one call site passing it; the reason is written out at the field itself.
  If you do pass it, it has to be written in the CALLING module: a relative specifier such as
  `./index.js` resolves against the file it is written in, never the file that calls it.
- `timeoutMs` — a bigger budget for this suite's own setup, passed straight through to
  `useVenueDb`. No call site needs one today.

**How the suite knows which tables are the subject's** is worth knowing before you read a failure. A
module's database also holds its prerequisites' tables, so "every table in the database" would be
the wrong inventory for anything but core. `useVenueDb` applies the sets it is handed and only then
calls `setup`, so the factory hands it the prerequisites as its `migrations` and applies the
subject alone inside `setup`: a list of the table names, then the subject set, then a second list.
The difference between the two lists is the subject's own tables. A set with no prerequisites hands
over an empty list and takes its first reading of an unmigrated database, which is the same code
path rather than a special case.

**A trigger-backed vocabulary is not a CHECK constraint.** On 2026-10-05, A231's
`pnpm --filter @waitron/db exec vitest run src/schema/schema-conformance.test.ts` failed
`working_orders.invoice_type`: its `enumType` declaration advertised a CHECK-backed vocabulary,
while `0101_bill_invoice_choice_transition.sql` enforced the values through insert and update
triggers. The declaration now uses a typed `label`, as the trigger-backed product ordering does.
`pnpm --filter @waitron/db db:generate --name invoice_choice_trigger_type` reported no schema
changes. `packages/db/src/schema/orders.transition.test.ts` tries both valid insert values and a
third value, and keeps its invalid-update assertion. In an installed disposable candidate,
removing either invoice-type trigger made its corresponding refusal assertion fail. The factory's
vocabulary case checks CHECK constraints; these write tests check the triggers instead.

**Finding a module's prerequisites: read them off the set's own SQL, do not guess.** They are the
other sets whose tables the set's own `drizzle/*.sql` names — a foreign key's `REFERENCES`, the
table a `CREATE TRIGGER … ON` names, or a trigger body — and only those, in runtime order. A passing
suite does not confirm the list. A missing prerequisite reached only through a foreign key or a
trigger body does not stop a set migrating on this engine — a foreign key naming a table that does
not exist is refused at the first write, not at migrate time — so a clean migrate alone would not
have told you, and an existing `useVenueDb` call in the package is a place to start reading, not an
answer. `packages/workforce/src/schema/schema-conformance.test.ts` is the worked example, and it
states the reason for a two-set list in the comment beside it: core because the set's foreign keys
point at its `locations`, `devices` and `nodes`, and identity because they point at its `persons`.
That is the database those keys resolve in, not something the migration needs — the suite also
passes with an empty list (measured 2026-09-23) — which is why each call site writes the reason
down rather than just the list. A package's suites can apply MORE than its set's tables need,
though: `packages/workforce/src/migrations.test.ts` applies core also for the `tenants` row its
setup seeds and the `locations` and `nodes` rows its cases seed (`seedLocation`, `seedNode`), and
most of `packages/credentials`'s database suites apply core — `credentials.test.ts` because
`credentialProvisioned` reads `tenants` — while its migrations point at nothing in core, so its
`migrations.test.ts` and its schema-conformance call site pass no prerequisites.
`packages/media/src/schema/schema-conformance.test.ts` is the case of the trigger: its set puts
triggers on core's and catalogue's tables, and the migration fails with `no such table` without
them.

**Adding a call site can turn a module's own suite red, and that is the point.** A set getting its
first check may report real drift. Treat that as its own piece of work rather than something to fix
in passing.

**Making the factory shared changed which gates the machinery itself has to pass.** The code left a
`.test.ts` and landed in `src/testing/`, and `packages/db` both measures that directory for coverage
and mutates it. What that cost, with the figures, is in [ci-and-gates.md](ci-and-gates.md) →
"Moving harness code out of a `.test.ts` changes what gates it".

**Containers and Docker**

## A container port-binding timeout needs Docker state as well as the container's own logs.

Save `docker inspect`'s `HostConfig.PortBindings` and `NetworkSettings.Ports` before removing the
failed test fixture. Measured in September 2026: the reader-adoption gate
found a healthy container with a requested TCP binding but an empty published-port list, and a
focused rerun passed without explaining the first failure. During #329's full gate `docker inspect`
showed `HostConfig.PortBindings["5432/tcp"] = [{ HostIp: "", HostPort: "0" }]` beside
`NetworkSettings.Ports["5432/tcp"] = []`. Nothing under `packages/`
or `apps/` starts a container now, so the live subjects are the two `bench/` rigs that start a
container, both of which publish a port: `bench/pglite-throughput/src/bench.ts` starts a
`PostgreSqlContainer`, and `bench/sqlite-failover/src/store.ts:76` publishes a port with
`withExposedPorts(9000)` and reads it back with `getMappedPort(9000)`, which is the same shape the
failure above took. The rule was briefly pruned from `CLAUDE.md` §4 on 2026-09-23 on the ground that
no PACKAGE fixture binds a port — true, and narrower than "the tree" — and restored with that hedge
the same day; moved here 2026-10-07.

## Draw every port a test needs in one `freePorts(n)` call, before binding any of them.

`apps/server`'s suites pick ports by binding port 0, reading the number the system chose, and
releasing it, because `WAITRON_HTTP_PORT` refuses `"0"`. Drawing two ports that way one after the
other can return the same number twice on Linux, and did in CI run 36317643554: the boot's HTTPS
server took port 40141 and its landing listener was then refused `EADDRINUSE` on 40141 in the same
start. Measured 2026-09-27 in `node:24-slim` (Node v24.21.0, kernel 6.12): 9 repeats in 50,000
pairs drawn one after the other, 0 with both probes held until both were drawn; macOS (Node
v26.7.0) repeated 0 times in 20,000 pairs, so local runs did not show it. `freePorts(n)` in
`apps/server/src/testing/free-ports.ts` holds every probe until the last port is drawn, which rules
out a repeat within one call. It does not cover a port another worker takes between the release and
the test's own bind, nor a port drawn to stay unused (an "unreachable peer") that another worker
later binds. Nothing checks that a new suite uses the helper rather than its own copy. The S3 test
server is the one caller that recovers from a port taken in that gap, because versitygw exits when
its port is already bound and so can be started again on another (the stream loop test's section
below, "The S3 test server knows its own server"). A Waitron server the suites start is not retried:
a taken HTTP port is `server.listen_failed` (the `EADDRINUSE` case in `apps/server/src/boot.test.ts`).

## Locate the unfinished package before diagnosing a silent shard as database contention.

Four inspected `test-light-a` hangs left only Bookings' browser files unfinished while Sync and
every database file completed; two jobs ran for about six hours. A Vitest test timer does not
bound a browser whose event loop has stopped. Preserve the job log and use an outer process/job
deadline, not a retry as proof of repair. Evidence and limits (#291): the four job logs were read
on 2026-09-09; [Vitest issue 10791](https://github.com/vitest-dev/vitest/issues/10791) says
"testTimeout and retry are enforced inside the tester iframe's own JS", and `@vitest/browser` 3.2.7
called `orchestrator.createTesters()` with no deadline in `BrowserPool.runNextTest`. That is a
possible mechanism, not a diagnosis of those runs, and the hang was not reproduced locally.

## On Vitest 4 a project's own `maxWorkers` wins; the outer config's is the fallback.

Read in vitest 4.1.11: `resolveMaxWorkers(project)` returns `project.config.maxWorkers` when that is
set and only then falls back to the outer config's (`dist/chunks/cli-api.CnMVyzaz.js`). Run
separately on a scratch fixture of four test files: an outer limit of 4 together with a project limit
of 1 gave peak concurrency 1 across four distinct worker processes, and the same fixture without the
project limit peaked at 4. Configs here depend on the project value winning — `packages/bookings`,
`packages/payments-stripe`, `packages/payments-sumup`, `packages/venue-service` and
`packages/adjustments` each set `maxWorkers: 1` inside a project.

**A cap that must apply to every project still belongs on the outer config**, which a project
setting none of its own falls back to.

This section came from Vitest 3, where moving `maxForks: 4`
inside fiscal-verifactu's project in #286 started 17 workers on the local host, observed during a
Sync migration stall; `ps -axo pid,ppid,etime,pcpu,command` counted them, and #291 moved the limit
back to the outer config. fiscal-verifactu has since dropped its projects.

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

### A package that pins one worker inside one of several projects numbers its `groupOrder`s from 1, never 0

Vitest 4 lifts a `groupOrder: 0` project that runs one isolated worker out of its group and appends
it after every other group, so a database project numbered 0 runs AFTER the browser project it was
ordered before. Two of the lift's three conditions are DEFAULTS — `groupOrder` is 0 when unset and
isolation is on — so stating no `groupOrder` at all does not avoid it. The condition a package can
actually be outside is the third: `packages/media` and `apps/dashboard` split into projects too, and
are unaffected because neither pins a project-level `maxWorkers: 1`. Measured on `packages/bookings`
against the same run on Vitest 3. Guard: `scripts/bookings-test-budget.test.ts`, which pins bookings
alone, not the other packages with the same shape.

### A package's `coverage.include` does not mean "this package's src"

Measured on 4.1.11, reading both installed copies. `include: ["src/**/*.ts"]` is matched by
picomatch against the ABSOLUTE file path with `contains: true`, so any path with a matching
segment matches, wherever that segment sits. What normally keeps another package out is the
external check — and in 4.1.11 that check is
`roots.every((root) => !filename.startsWith(root))`, a bare string prefix with no trailing
separator. So for a package whose directory were called `packages/sync`, a file at
`packages/sync-enrolment/src/migration-tables.ts` would not be judged external — its path starts
with the `packages/sync` root — and the include would then match it on its `src/…/*.ts` segment, so
it would land in that package's report. When `packages/sync` existed (#437, 2026-09-19), its
report counted 114 statements at 81.57% with sync-enrolment's files in it, and 91 at 100% once they
were excluded.

`packages/ui` imports `packages/ui-core`, so its coverage config explicitly excludes
`**/ui-core/**`. Each package's CI job measures its own implementation. When changing
that exclusion, inspect both `coverage-summary.json` file lists as well as their totals.
Vitest's directory-prefix check makes the exclusion necessary with this installed version.

The pairs to watch when adding a package, since the hazard is a NAME prefix and not a dependency:
`country`/`country-es`/`country-gb`/`country-packs`,
`fiscal`/`fiscal-verifactu`/`fiscal-none`, `payments`/`payments-stripe`/`payments-sumup`,
`workforce`/`workforce-es` — every place under `packages/` where one package directory's name is a
prefix of another's, listed on 2026-09-22. Only a pair where the shorter package's own tests load
the longer one's source is actually exposed. Under `apps/` there is no such pair: `dashboard`,
`print-agent`, `server`, `setup` and `till`, none of them a prefix of another.

**A package config must name its own source tree in `coverage.include`, or an untested file stops
being counted.** Without one, Vitest 4 counts only the files a test loaded, so a file nobody imports
is invisible rather than a zero in the denominator: it can never pull the ratio down, and moving
code into one RAISES the percentage. Guard: `scripts/coverage-thresholds.test.ts`, which reads the
configs as TEXT and looks for one exact string, so a config that spells the same include
differently fails it.

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
"unreachable" — was wrong, and was corrected after a review ran the control above.)

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
half was retired on 2026-09-22: `grep -rnE "timeout: *[0-9_]+" packages apps --include="*.test.ts"`
answered nowhere at all, so the half's two non-vacuity cases — which exist to
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

**`scripts/spawn-timeout-budget.test.ts` does not cover a `spawnSync` timeout clearing the CHILD's
own worst case, retry loops included** (the previous section) — it reads a `scripts/` suite's own
declared waits, never the child's, so nothing guards that rule in general.

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

## `TESTCONTAINERS_RYUK_DISABLED=true` is required locally, for the `bench/` rigs.

Two rigs start a container: `bench/sqlite-failover`, whose `startStore` opens a MinIO container
(`bench/sqlite-failover/src/store.ts`), and `bench/pglite-throughput`, which starts a PostgreSQL one
(`bench/pglite-throughput/src/bench.ts`). Ryuk hangs on this machine, so it has to be off; with it off
an interrupted run leaks, which is the next section.

No test suite under `packages/` or `apps/` starts a container; the rigs under `bench/` do, so a
package suite that seems to hang is not waiting on Docker.

**A recurrent stall needs a retained log and a snapshot of whatever it was waiting on.** Locate the
stalled operation before assigning its cause to resource contention.

## With Ryuk off, INTERRUPTED runs leak containers

The bloat (once: 173 volumes, 23 GB) starved the `freePort` race in `apps/server`'s boot and
end-to-end suites, while an isolated re-run passed and proved nothing. Run `pnpm reap` when that
bites. The command (`scripts/reap-testcontainers.mjs`) removes containers labelled
`com.waitron.reapable` — stamped by `startStore` in `bench/sqlite-failover/src/store.ts`, which
nothing pins, and NOT by `bench/pglite-throughput`, whose container `pnpm reap` leaves behind — AND older than 2 h —
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

## The stream loop test skips locally without its two binaries, and a skip reads as a pass

`apps/server/src/stream-loop.e2e.test.ts` runs slice 2 end to end with the real pinned Litestream
and a real S3-compatible server started as a plain child process, because no package suite starts a
container. Box A streams to the bucket and dies; box B is rebuilt from the recovery kit, sells under a
fresh installation number, opens a generation of its own and moves the pointer; and a restore of B's
generation must equal B's database, every table but Litestream's own two
([conventions-data.md](conventions-data.md), the last section). On the owner's Mac it takes about
twelve seconds (2026-09-25). Its timeout is the sum of its waits and budgets, a little under ten
minutes, for the reason the "per-test timeout" section above gives.

**Binaries.** `node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs` installs
both under `.bin/` at the repository root; `WAITRON_LITESTREAM_BIN` and `WAITRON_VERSITYGW_BIN` point
the test elsewhere. A missing binary, or one reporting another version, SKIPS the case locally, and
FAILS it when `CI=true` (GitHub Actions sets it on every job) or `WAITRON_REQUIRE_STREAM_BINARIES=1`.
CI runs both tests in `test-server-stream`, the one job that installs both binaries, together
with the S3 test server's own suite, `apps/server/src/testing/s3-test-server.test.ts`, whose
cases that start versitygw skip and fail the same way; its other cases start a stub or Node in
versitygw's place and always run (`.github/workflows/ci.yml`; see
[ci-and-gates.md](ci-and-gates.md), "The stream loop and pause tests run in a job of their own").

**A skipped run looks like a quiet pass.** Measured 2026-09-25 with Vitest 4.1.11 and
`WAITRON_LITESTREAM_BIN=/nonexistent`: `pnpm --filter @waitron/server exec vitest run
src/stream-loop.e2e.test.ts` printed `Tests  1 skipped (1)`, `Test Files  1 passed (1)` and exited 0,
with neither the `stream loop test SKIPPED: …` warning the file prints nor the skip note. The same
command with `--reporter=verbose` printed both, the note naming the missing binary and the install
command. With `CI=true` added it failed: `Error: stream loop test cannot run: litestream is not
runnable at /nonexistent`, exit 1. So after a local run of `apps/server`, look for the skip count
before taking the loop as tested.

**What the guard does not see.** The guard on CI installing both binaries is
`scripts/ci-workflow.test.mjs`, which reads `ci.yml` as TEXT, so the install commands left only in
a YAML comment, or in a step an `if:` switches off, pass it.

**The frozen-server stage.** Ten sales are timed with the S3 server up, then it is frozen with
`SIGSTOP` (every call hangs rather than being refused) and ten more are timed. The slowest frozen sale
must stay under the larger of one second and five times the slowest sale before the freeze. It never
drives the side file to its limit. Its sales are recorded with `recordOneSale`
(`apps/server/scripts/record-one-sale.ts`), which opens a second store with `exclusive: false` and so
its own write queue, not the server's route and write queue. The next test reaches the limit.

**The stream pause test.** `apps/server/src/stream-pause.e2e.test.ts` needs the same two binaries
and skips or fails without them the same way. It boots one streaming server with `startServer`'s
third argument, a test seam, setting the side-file limit to 16 MiB; a 1 MiB limit paused the stream
while its generation was still opening, from boot's own writes (measured 2026-09-26). One till
session has three sellers posting sales at once to `/api/sales` over the box's TLS. At least ten
sales with the bucket up set the bound, as in the frozen-server stage. The bucket is frozen with
`SIGSTOP`, and a listing sent to it is checked to be still unanswered at the bound. The sellers post
until the side file passes the limit, stop, start again three seconds before the supervisor's next
once-a-minute measurement, and post until one of them sees the file folded back; at least ten more
sales follow during the pause. While filling, the sellers post nothing from the bound plus three
seconds before a measurement until three seconds after it: with the test held past a measurement
between the fill and the restart, the stream read `paused` before the sellers started again
(measured 2026-09-26). Every frozen sale must beat the bound, the stream must read `paused`,
and each seller must have exactly one sale whose side-file readings straddle the fold-back: the size
measured before it was posted at or over the limit, the size after its answer under it. Nothing else
in the server's own code shrinks that file: the stream host is `checkpointTruncate`'s only caller,
and no `journal_size_limit` is set. Then the bucket is let run: the stream must read `streaming` on
the same generation, a sale from the pause must be in a restore of that generation, and the server's
log must hold exactly one `stream.paused`, at this limit, followed by `stream.resumed`.

What it does not show: whether a straddling sale's own write waited in the write queue behind the
fold-back rather than landing before it — in each of two runs on 2026-09-26, one of the three
straddling sales was answered with the side file at 0 bytes, so its write had landed first — and how
long the fold-back of a 256 MiB file takes. The straddling-sale check does not guard the write queue
either: with `writes.exclusive(...)` in `checkpointTruncate` (`packages/store/src/index.ts`)
replaced by `Promise.resolve().then(...)`, the case still passed (70,258 ms, measured 2026-09-26).
Measured 2026-09-26 on the owner's Mac, with Vitest 4.1.11: 70,586 ms in all, most of it waiting for
the supervisor's measurement; the slowest sale 123 ms with the bucket up, 129 ms frozen before the
pause, 53 to 56 ms for the three straddling sales and 78 ms during the pause, against a bound of
1,000 ms; streaming again 253 ms after the bucket was let run. The fill's deadline was 30 seconds
until CI run 36210908359 (2026-09-26) found the side file at 15,697,232 bytes when it expired; it
is now 180 seconds, and the case's timeout, the sum of its waits and budgets, 526 seconds. Locally
the fill from 5,879,272 bytes took 3,819 ms plain, and under coverage 5,087 ms beside 18 busy loops
and 14,907 ms beside 72, on the owner's Mac, which reports 18 CPUs (2026-09-26). With `...seams.stream` deleted from
`apps/server/src/boot.ts`, so the default 256 MiB limit applied, the same run failed with `timed out
waiting for the fold-back: the stream reads {"state":"streaming",…}, the side file 27558712 bytes`.

**In CI their temporary files are in memory.** `test-server-stream` runs the loop and pause tests,
and the S3 test server's own suite, with `TMPDIR=/dev/shm`, pinned by
`scripts/ci-workflow.test.mjs`, which reads `ci.yml` as text. It is the CI step's environment, not
`scratchParent()`, so a local run still uses the system temporary directory. The loop and pause
tests each make their scratch directory under `tmpdir()`, and that directory holds the server's
database, Litestream's files and versitygw's bucket, so all of them move; the S3 test server's suite
keeps its scratch and its stub programs under `tmpdir()` too. Main run 36559470238 (2026-09-29)
failed with the slowest frozen sale at 1,228 ms. A probe with per-sale timing reproduced it on one
runner of 20 (run 36574315468, a sale of 1,262 ms, in the fill stage): that sale's commit took 1,017
ms. The next write waited 1,029 ms to begin, which the backlog's A130 entry infers was Litestream's
own checkpoint (A133 later measured such checkpoints holding a write up: see
[A sale can wait behind Litestream's own checkpoint](#a-sale-can-wait-behind-litestreams-own-checkpoint)),
and Linux's pressure counters showed every process stalled on the disk for 1,094 ms of that sale. The write queue wait was 0 ms and nothing waited on the
bucket. `node:sqlite` commits synchronously on the main thread of the process the test runs the
server in, so while a commit stalls no other request is served. With the stream switched off, sales
still reached 790 ms on slow-disk runners. With `TMPDIR=/dev/shm`, 58 runs across 20 runners
passed, and the slowest frozen sale was 104 ms (run 36575480881). So in CI no timed sale includes
a commit waiting on the runner's disk. What it gave up, in CI only, is timing sales against a real
disk, and with it any view there of how long a sale waits behind a Litestream checkpoint on a slow
disk (`docs/backlog.md`, A130); its assertions are unchanged. How much of `/dev/shm` the job's tests
use, and its size on CI's runners, was not measured; the 58 runs passed with it.

**A bucket question the pause is waiting on.** While paused, the supervisor asks the bucket for a
listing and resumes once one is answered (`#bucketAnswers`, `packages/stream/src/supervisor.ts`).
A server frozen with `SIGSTOP` answers the pending listing once it gets `SIGCONT`, as the pause test
shows. A server that takes the connection and never replies is different. Measured 2026-09-26 with
`@smithy/node-http-handler` 4.12.1, before the S3 store had a limit of its own: a listing sent to a
TCP server that accepts and never writes was still pending after 20,000 ms, and the control, a
server that closes each connection at once, was refused in 259 ms. So each question gives up after
`READ_DEADLINE_MS` (five minutes), logs `stream.pause_check_failed` with `errorCode: "timeout"`, and
the pause asks again on its next tick; the supervisor case "asks the bucket again when a question
during the pause goes unanswered, logs it, and resumes once one is answered" fails with the deadline
taken out of the race (re-run by A44). Since A44 the store also gives a request up when it
has had no reply 30 seconds after it started (`BUCKET_IDLE_MS`,
`packages/stream/src/s3-store.ts`), though not an answer whose body stalls after headers that
arrived within its first three seconds; with that default, a listing to such a server failed after
90,116 ms, three attempts. Against a server that never replies the pause therefore ends each
question as a refusal, before the deadline. Since A51 a refused question is logged once per pause,
`stream.pause_check_failed` with the refusal's code — for that server `backup.stream_request_failed`,
the code the store's "a bucket that stops answering" cases in `packages/stream/src/s3-store.test.ts`
assert for a listing — and a refusal that arrives after the deadline or a stop is not logged. The
supervisor case "logs a question during the pause the bucket refuses once per pause, with its code"
fails with the log line, the once-per-pause check, or the record shared across the pause taken out;
"logs nothing more for a question during the pause that is refused after its deadline" fails with
the deadline check taken out; "logs nothing for a question during the pause that is refused while
the run is stopping" fails with the stop check taken out; and "logs nothing for a question during
the pause that is refused after the run was stopped" is held by both checks, failing only with both
taken out. Since A57 that line, like the supervisor's other lines for a failed bucket request, also
carries the bucket's HTTP `status` when the bucket answered the refusal (the store's case "a
refused listing is a request failure" in `packages/stream/src/s3-store.test.ts` has a listing
answered 403 carry `status: 403`), and only the code when no answer arrived; the cases under "a
refusal the bucket answered is logged with its HTTP status" in
`packages/stream/src/supervisor.test.ts` that expect a status, with the "generation housekeeping"
case "logs a prune the bucket refuses, and streams on", each fail with their own line's status taken
out, and that block's no-answer and not-a-number cases fail with the number check taken out. Since
A60 such a line also carries `errorName`: the bucket's error name when it is on the fixed list in
`packages/stream/src/bucket-error-names.ts`, and `other` when it is not, never the bucket's own text.
The cases under "a refusal the bucket answered names its error, from a fixed list only" fail with
the list check taken out (the unlisted names), with a listed name taken off the list (that name's
case), and with the field taken off the line; a name `s3-store.ts` gives an answer it refused
through `answerRefused` is typed against the list, so a new one missing from it fails the typecheck
(TS2345); `requestFailed` still takes any string, so a refusal written with it type-checks, and since
A62 it stores a name that is not on the list as `other` in the error's params (the cases under
"the bucket's own error name" in `packages/stream/src/s3-store.test.ts`, at statuses 403 and 200);
the log line's check runs again over that.

**Why versitygw 1.8.0.** Five candidates were weighed on 2026-09-23. Four were run with the same
probe: a write "only if absent" over an existing key, a write "only if unchanged" with a stale ETag,
and twenty parallel create-only writes (taken while drafting slice 2's Task 10, which landed as
#652). versitygw, SeaweedFS 4.47 and MinIO's last binary release refused both
conditional writes with 412 and let one writer of twenty win. rclone `serve s3` overwrote the object
both times. The fifth, Garage, was ruled out by reading, not run: it does not support the
conditional write; its issue #1052 is open, and a maintainer wrote that "adding this to Garage is
not possible with our weak-consistency replication model". versitygw was preferred because it
answers `If-Match` on a missing key with 404 as AWS documents (SeaweedFS answers 412), it is one
process on one port, and its release publishes SHA-256 checksums (SeaweedFS publishes MD5). MinIO's
repository is archived and its community binaries are no longer published.

**The S3 test server knows its own server.** `startS3TestServer` draws its port with `freePort()`,
which releases it before versitygw binds it, so a server another test started in the same run can
take it first. versitygw 1.8.0 prints its "listening on" banner BEFORE it binds, and on a taken port
then prints `bind: address already in use` and exits 1 (run by hand 2026-09-30, on macOS and in
`node:24-slim`). Until 2026-09-30 the harness called a server ready once its port accepted a
connection, and every server shared one set of credentials, so a start whose port the other test's
server had taken came up talking to that server; its own `pause()` then did nothing, because its
process had exited. That is what the pause test's bucket control failing once on `main` looks like
(run 36619928071; `docs/backlog.md`, C88). Now each server has credentials of its own and is ready
only once a listing signed with them is answered; a server that exits on a taken port is started
again on a fresh one, up to five ports within the one `READY_TIMEOUT_MS`, each readiness probe cut
to the time left in it; and `pause()` and `resume()` throw, with the server's log, once its process
has exited. In `apps/server/src/testing/s3-test-server.test.ts`, two cases force a second server
onto the first one's port through a mocked `freePort()` and fail without each server's own
credentials or without the retry; one fails when `pause()` is silent on an exited server; three run
a stub in versitygw's place and fail when the deadline is reset per port, when a bind error written
after the process exited is missed, or when a probe may run past the deadline; and one checks that a
server exiting for another reason is not started again.

**It runs with `--sidecar`** (`apps/server/src/testing/s3-test-server.ts`), which keeps object
metadata in a plain directory instead of extended attributes, so it does not depend on what the
temporary filesystem supports. Litestream 0.5.17 replicated to it and restored from it in both modes
on darwin/arm64 (the same notes). Its first Linux run was #652's CI on 2026-09-25 (run
36173603563), where the loop test passed in 15,989 ms.

**If the conditional-write probe fails**, which is the case's first assertion and prints the probe's
reason and the server's log, suspect the server before the product. Check `.bin/versitygw
--version`. The recorded fallback is SeaweedFS 4.47, whose run passed the same probe; weigh its
MD5-only checksums, eleven listening ports and three-second stop before swapping.

**An interrupted run can leave either binary running.** `pnpm reap` kills a parentless process whose
command starts with a Waitron checkout's `.bin/litestream` or `.bin/versitygw`
(`scripts/reap-testcontainers.mjs`, `isTestBinaryProcess`).

## A sale can wait behind Litestream's own checkpoint

CLAUDE.md §5 states the rule; these are its figures. SQLite writes each change first to a side
file beside the database (its write-ahead log); a checkpoint copies those changes into the database
itself so SQLite can write the side file again from its beginning (below, "restart the side
file"); a TRUNCATE checkpoint also cuts the file to zero bytes, and the server's fold-back is one
of those (`checkpointTruncate`, `packages/store/src/index.ts`); a PASSIVE checkpoint copies as much
as it can "without waiting for any database readers or writers to finish" (SQLite's
`sqlite3_wal_checkpoint_v2` documentation). Read in Litestream 0.5.17's code (A133), Litestream
holds the write lock through each of its PASSIVE checkpoints; measured by A135 (below), writes also
waited through the TRUNCATE checkpoint it forces when the side file has passed about 477 MiB and a
PASSIVE one could not restart it, and through the snapshot it takes right after that. Measured
2026-09-29 with one seller through `POST /api/sales` (run 36615242523): on a disk delayed 100 ms
per flush, 14 writes in three runs waited 829–831 ms to begin; on a CI runner's normal disk, 288
writes waited 20 ms or more, most of them 33–105 ms and the longest 629 ms. Each such wait spanned
a Litestream checkpoint log line; with streaming off no write waited over 1 ms. How long a write
waits behind a checkpoint with several sellers at once, and on the box's own disk, is not measured.
How A133's probe ran is in `docs/backlog.md`, A130's entry, under A133. Litestream runs two routine
checkpoints, and the product leaves both at Litestream's defaults: a timed one (by default once the
database file has gone a minute without changing, `DefaultCheckpointInterval`, `db.go` line 34 at
tag v0.5.17, checked at line 1479), and a regular page-count one (`min-checkpoint-page-count`,
once the side file holds 1,000 pages by default, line 36). Its emergency checkpoint, at
`truncate-page-n` pages, is separate. What switching off the timed one and setting the regular
page-count one to a billion pages did is below.

**Switching off Litestream's timed checkpoint and setting its regular page-count one to a billion
pages removed the wait on the delayed disk, but not on the runner's normal disk at about 80 sales a
second** (A135, measured 2026-09-30, run 36657175716, probe commit `bc3b94671` on the throwaway
branch `probe/a135-litestream-checkpoints`, since deleted). The same probe, streaming on, one seller
for 300 s, three runs each of the product's settings and of a variant adding
`checkpoint-interval: 0s` and `min-checkpoint-page-count: 1000000000` to the database's Litestream
entry. On the runner's normal disk Litestream still forced its emergency checkpoints under the
variant: the ones it runs once the side file passes about 477 MiB (third bullet). On the delayed
disk it logged no checkpoint at all; the side file peaked at 278–280 MiB there. Judged by A133's
criterion, reused unchanged: with streaming on, writes wait under 20 ms to begin, as in A133's
streaming-off runs, where none waited over 1 ms. The variant met it on the delayed disk and failed
it on the normal disk, where 10 writes per run waited 20 ms or more.

- Delayed disk (10 ms per write and 100 ms per flush; 50 synced 4 KiB writes took 6.8–7.1 s,
  against 14–17 ms on the runner's own disk). Product settings: 12–13 writes per run waited
  829–831 ms, slowest sale 1.07–1.08 s. Variant: no write waited more than 1 ms to begin, slowest
  sale 0.57–0.65 s. In one run the slowest sale began 1 ms before the server's fold-back, which
  held the write queue for 278–294 ms across the runs, and the sale's first write was recorded the
  millisecond that fold-back ended; in the other two it was a sale whose own commit took
  624–625 ms, about a second before the fold-back.
- The runner's normal disk (about 80 sales a second). Product settings: 125–160 writes per run
  waited 20 ms or more, the longest 129–179 ms. Variant: 10 writes per run waited 20 ms or more and
  6–7 waited 100 ms or more, the longest 430–729 ms. Each of those 30 waits contained one of
  Litestream's emergency checkpoints: the 20 that contained a PASSIVE one lasted 33–179 ms, and
  every wait of 229–729 ms began 21–205 ms after Litestream logged `forcing truncate checkpoint`,
  and lasted through that checkpoint and the snapshot Litestream takes right after it.
- Under the variant SQLite's own automatic checkpoint, still on, did not restart the side file
  (Litestream keeps a read transaction open "to prevent checkpointing", `db.go` line 1183 at tag
  v0.5.17). Measured from the last size measurement before the file began to grow (about 4 MiB)
  to the first at or above 256 MiB, and counting the sales that both started and finished between
  those two measurements, the file grew by 226–228 KiB per one-line cash sale on either disk, over
  1,132–1,155 sales. On the normal disk, past 499,999,112 bytes, Litestream ran an emergency
  PASSIVE checkpoint and, when that did not restart the file, an emergency TRUNCATE one. That byte
  count is the side-file size of 121,359 pages of 4,096 bytes (Litestream's default
  `truncate-page-n`), counting each page's 24-byte header and the file's 32-byte header
  (`calcWALSize`, `db.go` line 1563 at tag v0.5.17); Litestream's own log printed
  `threshold=499999112`. The server measures the file against its 256 MiB limit once a minute
  (`TICK_MS`, `packages/stream/src/supervisor.ts`), so at this rate the file reached 525–529 MiB
  between measurements.
- Under the variant the server paused the stream once per run on the delayed disk and one to three
  times per run on the normal disk (`apps/server/src/alert-sources.ts` lists `backup.stream_paused`
  for as long as the stream reads paused). Every run ended streaming, and every sale in all twelve
  runs was answered 200.
- The stream loop and stream pause tests passed three times each with the variant written into
  every Litestream configuration their runs made.

Not measured: a venue's own sale rate, several sellers at once, and the box's own disk.

The owner chose on 2026-09-30 to leave both routine checkpoints at Litestream's defaults, so neither
setting shipped (`docs/backlog.md`, A130's entry).

**A copy behind, the side file's bound, and the guards.** A copy fifteen minutes behind raises
`backup.stream_behind`, unless a stopped, refused or unusable-settings alert already explains it
(`apps/server/src/alert-sources.ts`). The side file is bounded by stopping Litestream at a size
limit (`backup.stream_paused`) and then folding the file back; that fold-back is the server's own
checkpoint, and it takes its turn in the write queue with no busy wait (`checkpointTruncate`,
`packages/store/src/index.ts`), so a sale can queue behind it but never waits on the bucket.
Guards, narrower than the rule: `apps/server/src/stream-pause.e2e.test.ts` freezes the bucket,
then times the sales of three concurrent sellers on one till session through the server's own
route against a bound while the side file passes a 16 MiB limit, the server folds it back and the
pause holds — it does not observe whether a sale's write waited behind the fold-back rather than
landing before it, nor time the fold-back of a 256 MiB file; the frozen-server stage of
`apps/server/src/stream-loop.e2e.test.ts` records its sales through `recordOneSale`, a second
store with its own write queue; both are skipped locally without their binaries (the stream loop
test's section above); the bucket-copy cases in `apps/server/src/health.test.ts` hold `/health`.

**Printing on real hardware**

## How long a job of pictures takes to print on the box is not measured

Since 2026-10-01 (C107) every printed line is sent as a `GS v 0` picture rather than as text
(`docs/developers/conventions-ui.md`, "Printed documents take the printer's own layout settings").
No suite times a real printer, and the box's own timings are OWED: a kitchen ticket of 40 or more
lines and a receipt, each sent to the owner's Bluetooth printer through
`apps/print-agent/src/rfcomm-send.py` and to the network printer over TCP, timed to the printer's
answer to a `GS r 1` sent after the job (C106: _"the printer answers it only after the print data
before it"_). Record them here when they are taken.

The only measurement so far is C106's, on the owner's Mac, not the box, with Menlo rather than the
font the box draws with. In the queue entry's own words: _"The same 36-line Spanish receipt, 32
columns: as text (ESC t 16, cp1252) 946 bytes; as `GS v 0` images at 384 dots wide, one 24-dot band
per line, Menlo 20 px, 38,292 bytes. … Two runs each: text 2.72 s and 2.74 s to the answer; image
2.19 s and 2.19 s, its bytes sent in 0.86–0.87 s (about 44 KB/s)."_ That was the Bluetooth printer,
driven through IOBluetooth by a Swift sender. The network printer, the same two jobs over TCP:
_"text 946 bytes, answer after 1.50 s; image 38,292 bytes, answer after 1.53 s."_ C106 also lists
what it did not measure: _"80 mm paper (576 dots = 1.5× the image bytes); the box's Linux path
(`apps/print-agent/src/rfcomm-send.py`); a long kitchen ticket; a busy radio."_

**What a test run prints**

## Vitest hides a passing test's console output under an AI agent

Measured 2026-09-28 with Vitest 4.1.11 on Node v26.7.0: a passing test's `console.log` printed with
no agent variables set and with `CI=true`, and was hidden in two separate runs, one with
`AI_AGENT=1` set and one with `CLAUDECODE=1`. Read from the installed source and not run: std-env's
`isAgent`, true for `AI_AGENT`, `CLAUDECODE` and `CLAUDE_CODE` among others, makes Vitest pick its
`agent` reporter, which prints nothing for a passed test. A report written to file descriptor 2 with
`fs.writeSync` from a worker thread was not hidden (the upgrade test's second-thread report,
[ci-and-gates.md](ci-and-gates.md#the-upgrade-test-names-the-phase-it-stalled-in)); a test thread's
own `process.stderr.write` was not tried. To see a passing test's output from an agent session,
unset `AI_AGENT` and `CLAUDECODE` for the run (std-env checks others too): the output was hidden
with either set and shown with neither; passing
`--reporter=default` instead has not been measured.

## A run that shows no `Tests` count is no evidence that anything passed

Measured 2026-10-03 with Vitest 4.1.11 in `packages/shared`: `vitest run src/capitalise.test.ts
--reporter=basic` printed no `Tests` line and exited 1, because `basic` is not a Vitest 4 reporter;
the same command with `--reporter=dot` printed `Tests 6 passed (6)` and exited 0. The logged command
was `vitest run <file> --reporter=basic 2>&1 | tail -3`, so stderr was in the pipe too. An unknown
reporter is a start-up error that Vitest prints followed by `console.error("\n\n")`, so the last
three lines are blank and `tail -3` showed only those, while the pipe's exit status was `tail`'s, 0
(read from the installed source, not run) — which is how it was once read as a clean pass
(2026-09-22). Two other causes were logged, not re-measured here: a `*/` inside a `/** … */` comment
(a glob such as `packages/*/drizzle/`) ends the comment early, so the file fails to parse and every
suite reports `Tests no tests` (2026-09-23); and a run started while another agent ran Vitest in the
same package of the same worktree printed `no tests` or nothing, and passed when re-run
(2026-09-29). Under a reporter that prints the count (`dot` is the one measured here), read the
count; treat a missing or zero count as a broken run and look at the INPUT — the command, the file,
what else is running — before the filter. Not every reporter prints the count:
`--reporter=hanging-process` ran a test, printed nothing and exited 0 (run 2026-10-03 in
`packages/shared`), and it is not the only one (a reviewer of #1139 ran other built-in reporters
that day that printed none), so with a reporter that does not print a count, read that reporter's
own result.

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
`window.innerWidth` inside the test and put it in the report. A saved PNG's pixel width is not
evidence either: one session logged PNGs 333 and 1024 px wide after `page.viewport(390, …)` and
`page.viewport(1280, …)`, the frame scaled to the outer page (2026-09-26).

## A screenshot is saved only to a path Vite's `server.fs` configuration allows

`page.screenshot({ path: "/tmp/x.png" })` fails with `Access denied to "/tmp/x.png"`. In
`@vitest/browser-playwright` 4.1.11 the command behind it, `takeScreenshot` (`dist/index.js`),
passes the save path to `assertBrowserFileAccess`, which is Vite's `server.fs` allow check. The
workspace is allowed by default and `/tmp` is refused: on 2026-10-03 a reviewer saved a real
Chromium screenshot to `../../../review-shot.png` from `packages/ui` (outside the package, inside
the workspace), and the installed `assertBrowserFileAccess` with a real Vite config allowed a
sibling package's path and refused `/tmp/x.png`. Two sessions lost time to it a day apart
(2026-09-28 and 2026-09-29). Give a path relative to the test file under `__screenshots__/`
(`__screenshots__/look/a.png`, which lands beside it and which git ignores). Guard:
`scripts/screenshot-paths.test.ts`, weaker than its name — it reads `*.test.ts` source as text
through the TypeScript parser and judges only a literal `path`.

A second thing a widget harness does not inherit: icons are registered in each app's `main.ts`, which
a harness mounting one widget never loads, so `wt-icon` renders an empty box and a grip handle looks
like a missing cell. Register the app's icon set in the harness before reading anything into a blank
control.

Nothing guards the `/tmp` refusal or the icon registration.

## Browser passkey tests stub `navigator.credentials`, keeping the WebAuthn library real.

Preloading that library before the old module mocks reproduces `startRegistration is not a spy` and
`mockClear is not a function`; the credential stubs pass with the same preload. Do not rely on a
module mock replacing an already-loaded browser ES module. Evidence and limits: #303's commit
message.

## Browser recovery tests read the native control inside a shared component.

A host's `checked` property can report the expected value while its inner checkbox remains visibly
wrong. The printer follow-up review reproduced that split by preserving the emitted change while
suppressing the host update; the old assertion passed and the inner-input assertion failed.
The Tickets assignment check reads the multi-select's rendered `aria-selected` options
in `packages/venue-service/src/dashboard/prep-stations-screen.test.ts`, “Tickets retains station
printer memberships independently for each station”, rather than relying on the host values alone.

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
even though no mouse event was sent. `wt-button`'s hover rule then dims a secondary or ghost button
to `--wt-opacity-hover`, and an axe scan can report a colour-contrast violation for a button that
looks correct in the app. Until A306 the rule dimmed primary and danger buttons too, which is what the
measurement below caught.

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
`packages/ui-core/src/components/wt-button.test.ts`'s hover tests end with the cursor still on the button,
and those suites drive the real cursor a lot, so the same latent failure lives there, unpaid for so
far. `packages/adjustments`, `packages/media` and `packages/venue-service` register
`parkPointerCommands` in their vitest configs and DO get the reset, through `packages/ui`: their
a11y suites (`packages/adjustments/src/dashboard/reasons-screen.a11y.test.ts`,
`packages/media/src/dashboard/image-library.a11y.test.ts` and
`packages/venue-service/src/dashboard/venue-operations-screen.a11y.test.ts`) import
`packages/ui/src/a11y-helpers.ts`, whose line 22 is `beforeEach(() => commands.parkPointer())`.
Each of those packages' vitest configs says so in a comment beside the registration.

## Dispatch events when testing a `composedPath()` guard.

An undispatched `KeyboardEvent` has an empty path, so a missing-action test can pass at the
input-type guard without reaching the branch it claims to check. Exercise the event from the real
input and prove the target guard by deletion. Receipt: `packages/ui-core/src/submit-on-enter.test.ts`
(UI keyboard review, 2026-09-06).

## Test an inline Escape warning with the native keypress.

An inline editor that opens a confirmation from `keydown` must cancel Escape's default action as
well as its propagation. On 2026-10-06, W69's printer and Settings choice tests could open the
warning and then observe it closed after the same native Escape. Dispatched events had not exposed
that browser action. The handlers now call `preventDefault`; the printer regression observes that
the actual keydown was cancelled and the warning stays open until a subsequent answer.

Run `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/prep-stations-screen.printers-unsaved.test.ts src/dashboard/prep-stations-screen.settings-unsaved.test.ts`.
The pair passed 37 cases. In an independently installed candidate, removing the printer cancellation
failed its native case while a pristine form still closed directly. A preceding deletion survived
when the test asserted only the visible warning, so timing alone does not guard the cancellation.
These cases cover the named editors; they do not audit every inline Escape handler.

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
in the root `coverage.include` IF IT IS TO BE MEASURED AT ALL, and excluded from its package's.
That `include` is one file-type glob (`scripts/**/*.mjs`) plus the explicit paths added beside it,
so root-level source of another type is
measured only when somebody names it, suite or no suite — `scripts/dev-server-proxy.ts` is the one
such file today, and [ci-and-gates.md](ci-and-gates.md) records what naming it would cost.

## Prove a guard by deletion, and confirm a negative control fails for the reason you think.

Delete the guarded code, run the guard, and check that it fails with the message the guard was
written to report, not some other breakage.

## A proof by deletion says nothing about what the guard wrongly REFUSES, and that needs its own case.

A write-queue re-entrancy guard written as a flag passed every case in its own file, including the
one about queued callers (whose three callers are dispatched in ONE tick, before any body starts, so
the flag is still false when each checks it), and turned every concurrent request in
`packages/payments` into a 500. The distinction the flag could not make — nested INSIDE a running
body, versus merely waiting BEHIND one — is now read from asynchronous context, and the missing case
is the second caller in `packages/store/src/write-queue.test.ts` ("serves a caller that arrives after
another body has already started").

Deletion shows the guard catches what it was written for; only a case in the other direction — the
legitimate call that must still be served — shows it is not too wide.

## A proof-by-deletion belongs to the SHAPE of the code it was taken against.

Restructure that code and the deletion can stop failing, with every test still green and nothing
saying so. Re-run the control after the restructure, and move the proof to whatever still catches it.

The instance (2026-09-21). `packages/printing`'s agent pull used to claim jobs in two statements —
a locking selection, then an `UPDATE` keyed only on the ids it returned — and
`runtime.race.test.ts`'s header recorded that deleting the lock let a second agent re-claim the
first agent's row and print the job twice. Then the pair became one statement. With the locking
clause removed from `packages/db/src/job-claim.ts` and nothing else touched,
`pnpm --filter @waitron/printing test -- runtime.race runtime.reclaim` read **5 passed**, against
both the first and the shipped version of the one statement: the old proof held for neither. The
suite that did fail on the shipped version, `packages/db`'s PostgreSQL-era job-claim suite, was
deleted on 2026-09-22 with the database engine it ran against (read it with
`git show aabdde6a8^:packages/db/src/job-claim.pg.test.ts`). Today's `job-claim.ts` has no locking
clause to delete.

## Measure the old version in a throwaway worktree, never by swapping files in the working one

Each way of swapping the old version in and back out cost work:

- `git stash push -- <path>` makes no stash entry when that path has no uncommitted change, and the
  stash list is shared by every worktree of the repository, so the `git stash pop` that follows
  takes whatever entry was already there. On 2026-09-18 that was the owner's work in progress,
  applied with conflicts into a campaign worktree; it survived only because the pop failed and kept
  the entry.
- `git checkout <path>` restores from the index, so it throws away an unstaged rewrite of the
  same file along with the probe, silently and with exit 0. On 2026-09-18, during review fixes on
  #413, it reverted a rewritten test file to its committed version.
- A swap back to `HEAD` meant deleting new, untracked files by hand so the baseline run would not
  see them, and a snapshot built from `git status`'s modified lines alone had nothing to restore
  them from. On 2026-09-22, on the F1 flip branch,
  three new test files were lost this way.
- A probe appended with Python's `rstrip()` and then removed leaves the file without its final
  newline, which `prettier --check` fails while `git diff` shows the last line removed and
  re-added with the same text, marked only by `\ No newline at end of file` (F1 branch,
  2026-09-22).
- Two agents that pick the same hand-named folder under `/tmp` write over each other's files;
  `mktemp -d` gives each a folder of its own.

On 2026-10-03 a reviewer of #1139 ran two checks in a disposable repository: a stash made in
one worktree appeared in the other's `git stash list`, and the remedy worked — a detached
`git worktree add` held the old content while the original working file kept its uncommitted edit.
Nothing else here was re-run.

**The remedy.** `git worktree add --detach <dir> <base-sha>` (a measuring copy, not a feature
worktree: run `pnpm install` in it before running tests, and `git worktree remove` it after) gives
the before state without touching your edits; a copy set aside that cannot be avoided goes in
`mktemp -d`.

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

## Use the `/* v8 ignore start */` … `/* v8 ignore stop */` pair, not `/* v8 ignore next */`

Measured both ways for #437 (2026-09-19) on `packages/sync-enrolment/src/migration-tables.ts` as it
stood then, with two guard pairs (#511 later added a third), under `@vitest/coverage-v8@4.1.11`: with
the pair the package read 2 of 2 branches and passed; with the same two guards marked `next` it read
4 of 6 and failed the package's branch bar. Whether `next` can ever work is not established — the
provider's `ast-v8-to-istanbul@1.0.6` does parse `next` hints — but it did not here, and it fails
silently, with no message naming the marker. Nothing guards it.

## `errors.ts` reachability is guarded once, in `scripts/errors-reachable.test.ts`,

which discovers every `packages/*` shipping `src/index.ts` + `src/errors.ts` and text-walks the
import graph from the barrel. The thirteen hand-copied per-package versions were deleted on
2026-08-11: six of them (the "construct an `AppError`" shape) passed with `errors.ts` fully
unreachable. It now blanks comments with `blankComments` before reading imports. The regression
case puts both line and block commented imports in a synthetic barrel and expects no edge; a
separate case checks that a real import after `"/*"` inside a string remains reachable. The shared
reader guesses whether `/` opens a regular expression, so a wrong guess can still hide code or
expose a comment. An import-like string can still fake an edge, and dynamic imports are not followed.

`scripts/module-seams.test.ts` uses the same reader before its text match. Its synthetic line and
block comment case expects no regime import; its existing positive controls still find real imports.
An import-like string and the shared reader's regular-expression guesses remain outside that proof.

**What makes a test prove nothing**

## Test public recovery links through the real boot modes that serve them.

Mounting a route on a bare Hono app cannot establish that trading or recovery boot installs it.
B1's standalone route tests passed while the real trading listener returned 404; the boot
regressions now request the real listeners: `apps/server/src/boot.test.ts` fetches the trust page
and the CA certificate, and `node-entry.test.ts` fetches the recovery listener's trust page.

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
the first time.

## A page asserted as a STRING, or reached only through its API, has nothing checking that it renders.

An invalid CSS value, an unclosed tag, an unreadable dark-theme colour and a screen that throws on
open all pass every such assertion. Cost: a corrupted colour value on `/setup/trust` that every test
accepted, caught only by opening the page; and, on another branch, an image library that reached a
green gate through review and CI and then answered 500 to the first person who opened it. Open it
and LOOK, in both themes and at phone width. A browser-mode package has the harness already;
`apps/server`'s string-rendered pages have none, so write the rendered string to a file and open it
with the workspace's playwright Chromium.

`scripts/trust-page-logo.test.ts` checks only that the logo pasted into the server's source still
matches the brand lockup; it does not check that the page renders, that either theme is readable,
or that the logo is visible at all.

---

## Concurrent coverage runs must not share a package's report directory

Two local coverage runs can select the same package through expanded dependencies. In A2 (#334),
when the hook still ran package coverage,
two overlapping fiscal-verifactu runs ended with `ENOENT` writing `coverage/.tmp/coverage-41.json`;
Vitest cleans that shared directory. Inspect the resolved selection first, or give an intentional
second run its own `--coverage.reportsDirectory`. Receipt: #334.

**And put that second directory outside the package**, which the advice above did not say and
which is the more expensive half. The receipt it cites already worked that way — A2's follow-up run
used a separate `/tmp` report directory — so the stronger remedy was the practice before it was the
rule. A
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

## A contention test proves the write queue serialises writers, not that a lock blocked

What a contention suite asserts is that one writer holds the venue file at a time
(`packages/store/src/write-queue.ts`). `packages/fiscal-verifactu/src/chain.concurrency.test.ts` is
the worked example, and its header states what one queue costs: every writer waits on the file's one
queue, whichever node's chain it appends to, so two nodes' chains in one file are never written in
parallel.

**Start a writer through `withTransaction`, never through a bare `db.transaction(...)`.** Only the
former takes the write queue (`packages/db/src/tenancy.ts` → `db.withWriteLock`). Twenty bare
`db.transaction(...)` calls started together against one venue file fail
`no such savepoint: wt_sp_1` — measured on a suite since deleted, which is how it was found.

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

The general rule: state a default at every call site that shares it — the two ends of one ceremony
drift apart while each looks right.


### Restore the screen language after a test

Restore the previous language in `finally` when a single case changes the global screen locale.
On 2026-10-07, A284's new Spanish split case passed with the name-filtered split cases, then the
full `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.test.ts`
reported four failures and 219 passes: later transfer cases received Spanish labels instead of
the English labels their existing assertions required. Restoring `currentLocale()` in the new
case's `finally` left those assertions unchanged and produced 223 passes in the full file.
