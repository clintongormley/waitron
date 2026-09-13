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
`com.waitron.reapable` (stamped by `startPostgresContainer`, pinned by test) AND older than 2 h —
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
