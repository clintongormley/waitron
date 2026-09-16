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

## A scenario's verdict is a measurement, and the exit code says so

`scenarios` prints one Markdown table — id, title, verdict, detail — and exits **non-zero only when a
scenario marked `critical` has the verdict `FAIL`**. `MEASURED` and `SKIPPED` never fail the run, and
neither does a non-critical `FAIL`: a scenario that fails is a recorded outcome, which is the answer
this gate exists to produce (spec §7). The critical scenarios are the fiscal-safety and restorability
ones — a failure there means the loop's premise is broken and slice 1 would be building on a hole.

A scenario that **throws** is recorded as a critical `FAIL` whatever it was going to claim, because a
harness that broke mid-scenario never got as far as saying what it was measuring.

## The pins, and why the results only hold on them

- **MinIO:** `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z`, digest
  `sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`.
  The registry is quay.io because Docker Hub refuses the image anonymously:
  `docker pull minio/minio:RELEASE.2025-04-22T22-12-26Z` →
  `pull access denied for minio/minio, repository does not exist or may require 'docker login'`.
- **Litestream:** `v0.5.17` (arrives with this rig's later tasks).

The rig **establishes** external behaviour by observing it rather than asserting it: what MinIO's
conditional write does, and how Litestream lays out and restores a replica, are measured on these
exact versions. A different version is a different measurement, so a version bump re-runs the
scenarios rather than inheriting their verdicts. MinIO is also not the store the product will run —
Waitron Cloud has not chosen one — so the conditional-write result is a fact about the mechanism, and
re-running it against the real store is a standing obligation recorded in the results note (spec §5).

## Why it can't join `pnpm -r test`

Three independent reasons, each checked in this worktree rather than inherited from the pglite bench's
README:

1. The package defines no `test` script — only `scenarios` and `typecheck`. Root `pnpm test` ends in
   `pnpm -r test`, which skips a workspace member that has no such script instead of failing on it:
   `pnpm -r --filter @waitron/bench-sqlite-failover test` prints nothing and exits 0.
2. It contains no `*.test.ts` file, so even if a `test` script were added by reflex later, Vitest's
   default include pattern would match nothing here.
3. Root `pnpm test` also runs `vitest run` at the repository root first, and that project cannot reach
   here: its `include` is `["scripts/**/*.test.mjs", "scripts/**/*.test.ts"]` (root
   `vitest.config.ts`), which does not reach `bench/`.

That keeps a Docker-dependent rig out of CI's test shards and the pre-push hook permanently. The
package's gate is `typecheck` + `pnpm format:check` + `pnpm lint`; the evidence that it works is the
recorded run in its results note, not a green CI job.

## Several files, not one

`node src/scenarios.ts` runs the TypeScript directly — Node 26 strips types natively, with no build
step and no `tsx`. Unlike `bench/pglite-throughput`, which is one self-contained file because native
stripping does not do the `.js`-suffix remapping the rest of the repo relies on, this package spreads
over several modules and every relative import carries an explicit `.ts` extension
(`import { openNode } from "../model.ts"`). `tsconfig.json` sets `allowImportingTsExtensions` so the
typechecker accepts the same specifiers Node executes.
