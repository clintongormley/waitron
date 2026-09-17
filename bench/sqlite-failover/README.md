# @waitron/bench-sqlite-failover

A throwaway rig, not a product package. It is **gate 2** of the storage switch: does the box → object
store → promote → return-with-a-tail → ship → rejoin loop hold together, and does it hold together
_fiscally_ — no dropped ledger row, no forked chain, no second submission to the Spanish tax agency.

It stands up a **minimal model** of the fiscal ledger in SQLite (`src/model.ts`) and never imports
`packages/fiscal-verifactu`. Every model table names the real table it stands in for. A result here is
evidence about the loop's mechanism, never about the real ledger's code.

See `docs/superpowers/specs/2026-09-16-sqlite-failover-prototype-design.md` for what it proves and
what it deliberately does not, and `docs/superpowers/plans/2026-09-16-sqlite-failover-prototype.md`
for the scenarios.

## Running it

```bash
export TESTCONTAINERS_RYUK_DISABLED=true
pnpm --filter @waitron/bench-sqlite-failover scenarios
pnpm --filter @waitron/bench-sqlite-failover typecheck
```

Docker must be running: each scenario starts its own MinIO container via Testcontainers.

`TESTCONTAINERS_RYUK_DISABLED=true` is required locally (`CLAUDE.md` §4), and it turns off the reaper
that would otherwise clean up after an interrupted run. Scenarios run one at a time and each stops its
own store in a `finally`, so an interrupt strands the container of the scenario in flight, not one per
scenario. `pnpm reap` is the fallback: `startStore()` stamps every container `com.waitron.reapable`,
which `scripts/reap-testcontainers.mjs` selects on — **and it removes only labelled containers older
than two hours**, so a reap run immediately after an interrupt reports nothing removed and the
stranded container is still there. Stop it by hand, or reap later. Never a blanket
`docker volume prune`.

## A scenario's verdict is a measurement, and the exit code says so

`scenarios` prints one Markdown table — id, title, verdict, detail — and exits **non-zero only when a
scenario marked `critical` has the verdict `FAIL`**. `MEASURED` and `SKIPPED` never fail the run, and
neither does a non-critical `FAIL`: a scenario that fails is a recorded outcome, which is the answer
this gate exists to produce (spec §7). The critical scenarios are S0, S1, S2, S3 and S6 (spec §7) — a
failure in one of those means slice 2 would be building on a hole.

A scenario that **throws** is recorded as a critical `FAIL` whatever it was going to claim, because a
harness that broke mid-scenario never got as far as saying what it was measuring.

## The pins, and why the results only hold on them

- **MinIO:** `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`
  — tag and digest together in the one reference `src/store.ts` starts the container from, so the
  pull resolves the digest and a reader still sees which release it is.
  The registry is quay.io because Docker Hub refuses this image anonymously:
  `docker pull minio/minio:RELEASE.2025-09-07T16-13-09Z` →
  `Error response from daemon: pull access denied for minio/minio, repository does not exist or may require 'docker login'`.
- **Litestream:** `v0.5.17` (arrives with this rig's later tasks).

The rig **establishes** external behaviour by observing it rather than asserting it: what MinIO's
conditional write does (S6, plan Task 2) and how Litestream lays out and restores a replica (plan
Task 6) are each measured on these exact versions. S6's half has been run —
`pnpm --filter @waitron/bench-sqlite-failover scenarios`, 2026-09-17, →
`create-only=true if-match=refuses-stale race=1/8 unfenced=8/8`. The Litestream half has not. A different
version is a different measurement, so a version bump will re-run the scenarios rather than inherit
their verdicts. MinIO is also not the store the product will run — Waitron Cloud has not chosen one
— so the conditional-write result will be a fact about the mechanism, and re-running it against the
real store is a standing obligation for the results note, `docs/research/2026-09-16-sqlite-failover-prototype.md`,
which plan Task 10 writes (spec §5).

## What S1's fence is, and what it is not

S1 measures the fence this **rig** uses: one key per term, claimed with a create-only write, under
the venue prefix `venues/v1/` — topology design §2.2 ("Each venue owns one prefix in the store,
`venues/<venue-id>/`"), and the prefix plan Tasks 7 and 8 stream a generation into. That shape is
plan Task 3's.

The **product's** fence is a different primitive: `current.json` written only if its version is
unchanged (topology §5.1), which is compare-and-swap, and which is what the prototype spec's §4 S1
describes. S6 records what the pinned store does with each. So S1's result is evidence that a
refusal by the store stops a double promotion — it is not a measurement of the product's own
conditional write, and the results note (plan Task 10) should say so in S1's row.

Spec §4 S1 also asks for two things this rig does not model, on top of the fence itself: the loser
"commits no promotion, activates no seat, and fences" — the rig shows only that it writes nothing —
and that "the store's history under the venue prefix stays restorable", which needs a Litestream
generation and so waits for plan Task 6.

S1's recorded run — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/bench-sqlite-failover
scenarios`, 2026-09-17:

```
| id | title | verdict | detail |
| --- | --- | --- | --- |
| S1 | double promotion fenced by the store's conditional write | PASS | fenced: winners=1/2 winner=box-a store-keys=3; control: winners=2/2 store-keys=5 |
```

`winner=` is the one value there that is a race outcome rather than a property: whichever node wins
is not the measurement, and it may differ from run to run.

## What S2 measures, and what it does not

S2 drives the rig's model of the submission state machine — `drainPass`, `applyTail` and the
`envios` table in `src/model.ts`. Its result is evidence about that mechanism and about nothing
else: `packages/fiscal-verifactu` is not imported here and has its own suites.

**The rule has two sides, and they are separate facts.** A record the RECEIVER has already filed
must not be walked back to `pendiente` by a re-shipped copy taken before it was filed, or the
receiver files it twice itself. A record the SENDER has already filed must be adopted as filed by a
receiver still holding it `pendiente`, or the receiver files a record its owner has already filed.
Neither side implies the other, and only the second was red before this scenario: with the earlier
`ON CONFLICT DO NOTHING` write, a re-shipped `pendiente` changed nothing on a row the receiver had
marked `enviado`, so the first side held by accident of the conflict clause rather than by a rule.

Both sides are measured against ONE ledger of filings, because there is one tax agency: a record
filed by the node that owns it and filed again by the node it was shipped to has been filed twice,
whichever database each filing came out of. A ledger per node cannot see that at all.

**Each side has its own control, because a control for one side proves nothing about the other.**
`applyTailRegressing` drops the guard: the three rows the receiver had filed regress to `pendiente`
and its next pass files them again. `applyTailInsertOnly` keeps the write as it stood before this
scenario: the two rows the receiver already held stay `pendiente`, and it files rows its owner had
already filed. Each control names the exact rows it expects to see filed twice — "a duplicate
happened somewhere" would also be satisfied by a broken harness. Both are thin wrappers over the
same `applyTail` body with one parameter changed, the `envios` rule, so a control differs from the
real path in that rule and in nothing else.

**What it does not measure.** Spec §4's S2 asks for a third thing: "the ship for a chain runs with
that chain paused in the drain's blocked set". The model's blocked set is a local variable inside
one `drainPass` call and is gone when that call returns (`src/model.ts`, `drainPass`), so no ship
can run while a chain sits in it, and nothing in S2 asserts that one does. What Part C measures
instead is the two things this model can show: a refused submission blocks the rest of that chain
for the rest of the pass — the chain's second row is due and `pendiente` and is never handed to the
stub at all — and a tail applied after that pass is drained by the next pass with every row filed
exactly once, the row that was refused included. A design that needs the pause to OUTLIVE a pass is
not modelled here; it would need a blocked set kept somewhere a ship can read.

Two narrower boundaries:

- The guard tests the row already in the receiver's table and not the one arriving, so an arriving
  `pendiente` does overwrite an `enviando` row. Nothing in this model leaves a row in that state
  across a call, and that was measured rather than argued: reading `envios` back after a pass gave
  every row `enviado` when the stub accepted all three, `enviado pendiente pendiente` when it threw
  on the second, and three `pendiente` when it threw on all of them — never an `enviando`. A row put
  there by hand stays, since a pass claims only `pendiente` rows; no function in `src/model.ts` puts
  one there.
- Read off the package, not run: S2 starts no container and opens no store — it is SQLite plus this
  rig's own two functions. It still runs inside a `scenarios` run that starts MinIO for the others.

S2's recorded run — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter
@waitron/bench-sqlite-failover scenarios`, 2026-09-17:

```
| id | title | verdict | detail |
| --- | --- | --- | --- |
| S2 | no second tax-agency submission on a retried tail ship | PASS | filed=13 double=0 (A receiver files 5 once; B receiver files none of the owner's 4; C blocked chain drains 4 next pass after 1 refusal); controls double-file: regressing=3 insert-only=2 |
```

Its assertions were put to mutation rather than read: eleven small changes to `src/model.ts` (nine
of a single line; two of a pair, where one rule is spelled out in two statements), each run whole,
each making one named assertion the one that failed. Three further assertions were
shown to bite by re-running a mutation with the earlier assertion that had caught it first taken
out. Seven were not made to fail by any mutation tried — preconditions, and whole-ledger backstops
that a sharper assertion earlier in the scenario always reached first. The mutations, the message
each produced, and those seven by name are in this task's pull request, so nothing here reads as
proved that was not.

## Why it can't join `pnpm -r test`

Three independent reasons. The first was run in this worktree; the second and third were read off the
package and the root config, and are marked as such — they are not measurements:

1. The package defines no `test` script — only `scenarios` and `typecheck`. Root `pnpm test` ends in
   `pnpm -r test`, which skips a workspace member that has no such script instead of failing on it:
   `pnpm -r --filter @waitron/bench-sqlite-failover test` prints nothing and exits 0.
2. Read, not run: the package contains no `*.test.ts` file, so a `test` script added by reflex later
   would find nothing for Vitest's default include pattern to match.
3. Read, not run: root `pnpm test` also runs `vitest run` at the repository root first, whose
   `include` is `["scripts/**/*.test.mjs", "scripts/**/*.test.ts"]` (root `vitest.config.ts`) and
   does not reach `bench/`.

What those three keep out is the rig's **scenarios** — no CI job and no pre-push hook run a MinIO
container. They do not keep the PACKAGE out of anything: it is a workspace member, so CI's shard
filters and the root guards see it by name, and it has to be wired for that. It is listed in
`PACKAGES_WITHOUT_TESTS` and placed in `LIGHT_B_PACKAGES` (`scripts/changed-scope.mjs`), and
subtracted from `test-light-a`'s selection in `.github/workflows/ci.yml` — exactly how
`@waitron/bench-pglite` is wired. Three root guards go red without that wiring —
`scripts/changed-scope.test.mjs`, `scripts/ci-workflow.test.mjs` and
`scripts/coverage-thresholds.test.ts`, the last by crashing rather than asserting. They live in the root Vitest project, which CI's ungated
`lint` job and `.husky/pre-push` both run. The general rule, for whoever adds the next workspace
member, is in [ci-and-gates.md](../../docs/developers/ci-and-gates.md).

The package's gate is `typecheck` + `pnpm format:check` + `pnpm lint`, plus those three root guards —
`pnpm vitest run` at the root is part of this package's gate precisely because it reads the wiring
above; the evidence that it works
will be the recorded run in its results note, not a green CI job.

## What the model enforces, not just labels

`records` is the rig's stand-in for `registros_facturacion`, and it is append-only in the way the real
table is rather than only in its comments. Two parts, and **both are needed**: `BEFORE UPDATE` and
`BEFORE DELETE` triggers that `RAISE(ABORT)`, plus `PRAGMA recursive_triggers = ON` in `openNode`.
Without the pragma, `INSERT OR REPLACE` deletes the conflicting row internally, that internal delete
does not fire `BEFORE DELETE`, and the row's payload and huella are rewritten — while plain `UPDATE`,
plain `DELETE` and `ON CONFLICT … DO UPDATE` are all refused either way, so a check covering only
those three passes with the hole open.

The `smoke` scenario is what runs them: it asserts all four refusals and reads the row back to confirm
its huella and payload survived. Flipping the pragma off makes that scenario fail.

That matters beyond this rig — the slice-1 spec commits to the same mechanism for the real ledger once
PostgreSQL's row-level trigger is gone, and it carries the pragma for this reason.

## Several files, not one

`node src/scenarios.ts` runs the TypeScript directly — Node 26 strips types natively, with no build
step and no `tsx`. Unlike `bench/pglite-throughput`, which is one self-contained file because native
stripping does not do the `.js`-suffix remapping the rest of the repo relies on, this package spreads
over several modules and every relative import carries an explicit `.ts` extension
(`import { openNode } from "../model.ts"`). `tsconfig.json` sets `allowImportingTsExtensions` so the
typechecker accepts the same specifiers Node executes.
