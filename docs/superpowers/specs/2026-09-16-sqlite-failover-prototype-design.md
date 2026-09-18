# The SQLite + Litestream failover prototype — design

**Date:** 2026-09-16. **Status:** design, awaiting owner review. This is gate 2 of the storage switch
(the [SQLite + Litestream topology design](2026-09-16-sqlite-litestream-topology-design.md) §12.2 —
the density gate beside it was retired on 2026-09-16). It is a **throwaway** rig whose output is an
answer, not product code: does the box → store → promote → return-with-a-tail → ship → rejoin loop
hold together, and does it hold together **fiscally** — no dropped ledger row, no forked chain, no
second submission to the Spanish tax agency. It is built and run once, its results are recorded, and
the rig is kept only as the receipt (the way `bench/pglite-throughput` and its `docs/research` note
were kept), never grown into the product.

**Why it precedes the rewrite.** Slice 1 (the storage swap) is the largest slice, and its whole
premise is that this loop works. If the loop has a hole, we want to find it in a rig on a laptop, not
half-way through porting the storage layer. The owner decided (2026-09-16) to run this prototype **in
parallel** with slice 1 rather than strictly before it, judging Litestream mature enough (five-year
project, widely used) that the risk of wasted slice-1 work is acceptable; this spec is written so the
prototype still gives an early, loud signal if that judgement is wrong.

**Companion documents.** The mechanism this rig exercises is defined in the topology design's §2.2
(generations and the `current.json` conditional write), §4 (the four topologies), §5.1 (promotion)
and §5.2 (the tail shipper); the natural-key clash shapes come from the
[outbox → native replication swap](2026-09-05-outbox-to-native-replication-swap-design.md) §4.2/§4.4.
Litestream's documented behaviour is quoted in the
[SQLite instead of PostgreSQL discussion note](2026-09-16-sqlite-instead-of-postgres-discussion.md) §3.

---

## 0. Decisions folded in (owner, 2026-09-16)

1. **Run in parallel with slice 1**, not strictly before it (above).
2. **Option A autonomy** (the away-campaign decision the same day): the runner may land this prototype
   unattended, because it never modifies the unrepairable fiscal core — it *drives* a minimal model of
   it (see §2). Slice-1 work that touches the real core is left for owner review; this is not that.
3. **The prototype lands like the pglite bench did** — a private workspace package under `bench/`
   plus a `docs/research/` results note carrying the method, the criterion per scenario, and the
   recorded output. §6.

---

## 1. What this proves — and what it deliberately does not

**Proves (the loop's mechanism, end to end):**

- A box running SQLite with Litestream streaming to an object store can be promoted-from — a fresh
  reader restores the latest state from the store and carries on — and the returning box can hand over
  the ledger rows it wrote but had not yet streamed (its **tail**) without losing or duplicating one.
- Two nodes that both believe they are primary at the same term (an offline **double promotion**)
  cannot both keep their promotion: the store's **conditional write** of `current.json` accepts exactly
  one, and the loser fences.
- A retried or partial tail ship does **not** cause a second submission to the tax agency, even though
  the receiver's drain claims across every chain with no node filter.
- A cloud restore from a **copied-up** replica (the on-prem-mirror path) is byte-identical to a restore
  from a directly-streamed one — which requires the copy-up to propagate Litestream's file **deletions**,
  not only its additions.
- A multi-day offline stretch with checkpointing disabled keeps sale latency and the write-ahead log
  size bounded — our own streaming process never lands on the sale path.
- The **chosen object store actually offers the conditional write** the whole tie-break rests on.

**Does not prove (out of scope, owned elsewhere):**

- **The money → integer-cents conversion and the byte-identical-huella test.** That is a slice-1
  concern (topology §9, risk 3); the prototype's minimal ledger does not use the real money columns and
  makes no hash claims about them.
- **The real fiscal drain's own correctness.** The prototype re-implements a *minimal, faithful* model
  of the submission state machine and cites the real code it mirrors (§2); it proves the **storage and
  ship mechanism preserves** that machine's terminal-state-wins invariant under a Litestream restore and
  a tail ship. It does not re-test `packages/fiscal-verifactu`, which has its own suites.
- **Drizzle's SQLite dialect, the query rewrites, the LISTEN/NOTIFY-to-in-process move.** All slice 1.
- **Performance parity with PostgreSQL.** No cost or throughput comparison is made or implied (the
  density gate was retired precisely because no such number decides anything — topology §12.1).

Stating the boundary this sharply is deliberate: a throwaway rig that quietly proves less than it
claims is the §1 defect class of `CLAUDE.md` in prototype form.

---

## 2. The minimal fiscal model the rig drives

The rig does **not** import `packages/fiscal-verifactu` (which is PostgreSQL-shaped and not yet ported).
It stands up a **minimal SQLite schema** that mirrors the *shape* the loop depends on, and every mirror
cites the real table or code it stands in for, so a reader can check the model is faithful:

- **`records`** — the append-only fiscal ledger, mirroring `registros_facturacion`. Keyed
  `(node_id, secuencia)`, hash-chained (`huella`, `huella_anterior`), insert-only. Mirrors
  `packages/fiscal-verifactu/src/schema/registros.ts:23,139` (the `node_id` rekey and the
  `(node_id, secuencia)` unique index).
- **`chain_head`** — the per-node chain tip, mirroring `cadenas` (PK `node_id`,
  `packages/fiscal-verifactu/src/schema/cadenas.ts:44`). Updated in place, by the owning node only.
- **`envios`** — the submission-state row per record, mirroring the real `envios`: a state of
  `pendiente → enviando → enviado`, hanging off a `records` row (child, no `node_id` of its own — the
  real `envios` is keyed through its parent, topology §5.2). `acks` is folded into it as a terminal flag
  for the model's purposes.
- **A minimal `drain`** that mirrors the real one's two load-bearing behaviours, and only those:
  it **claims across every chain with no node filter** (the real `claimBatch` takes no node argument —
  `packages/fiscal-verifactu/src/drain.ts:542`), and it carries a **per-pass in-memory blocked-chain
  set** so a paused chain is skipped (`blockedSifIds`, `drain.ts:304,547`). "Submitting to AEAT" is a
  stub that records an *idempotency assertion*: it fails the scenario if the same `(node_id, secuencia)`
  is ever submitted twice. That assertion is the whole point of scenario S2.
  *(2026-09-17: the landed stub has no assertion in it — `drainPass` swallows one — and S2's blocked-set
  assertion turned out to be reachable. What the rig measures instead, and the second-filing path it
  found, are in `bench/sqlite-failover/README.md` → "What S2 measures, and what it does not". Owner
  review the same day: the stub also ACCEPTS a repeat, which AEAT does not — it answers error 3000
  and the real drain reads that as filed — so a second submission the stub counts is a refused call
  against the real endpoint. README → "What the FAIL means against the real system".)*

Non-fiscal ledger shapes the loop also touches are modelled just as thinly: a `sales`/`sale_lines` pair
(parent carries `node_id`, child hangs off `sale_id`) and a `supplier_invoices` table carrying a
natural-key unique on `(supplier, invoice_number)` — the one clash the current design still resolves by
a human skip (§5, and outbox-swap §4.2; the working-time chain clash was removed by the per-node rekey
in §4.4, so it is not modelled).

Everything in this section is a **model**, labelled as such in the code, so no reader mistakes the rig's
schema for the product's.

---

## 3. The rig's components

- **Litestream**, the real binary, pinned to a specific 0.5.x release. The rig **establishes** how
  Litestream 0.5 lays out and advances a replica (its snapshot + LTX layout, what `restore` and
  continuous `restore -f` actually do, how `sync` flushes) by observing it — it does not assert that
  behaviour up front (memory: briefs say what to establish, not what is impossible). What it reads from
  the docs is in the discussion note §3; what it *depends* on is confirmed by the rig, on the pinned
  version.
- **An object store**, run locally as a container (§5). Litestream streams to it; the rig's own code
  does the `current.json` conditional write against it.
- **"Nodes"** — each a SQLite file plus a small supervised process that opens it, applies writes, and
  runs a Litestream child. The rig starts two (box A and either the cloud or box B, per the scenario)
  and a third fresh reader for a from-store promotion.
- **A harness** that scripts each scenario deterministically: apply a known write load, kill and
  restart processes at chosen points, drive promotion/return, and assert the scenario's invariant. Each
  scenario is an isolated script with one purpose, one setup, and one assertion — so a reader can see
  what it does, run it alone, and know what a failure means.

Docker is required (the store container and, if Litestream is containerised, its image);
`TESTCONTAINERS_RYUK_DISABLED=true` as everywhere locally.

---

## 4. The scenarios

Each is a unit: **purpose · setup · the assertion · what a failure means**. The assertion is written
first and watched to fail against an unwired harness (TDD, `CLAUDE.md` §4) before the harness is built
to satisfy it. The scenarios map one-to-one onto topology §12.2's obligations.

### S0 — the happy loop

- **Purpose:** the whole loop works once with nothing adversarial.
- **Setup:** box A streams a known set of records to the store; kill A; a fresh reader restores the
  latest generation, promotes (opens `gen-<term+1>-<reader-id>`, wins the `current.json` write), and
  keeps writing; A returns holding a tail of records it never streamed.
- **Assert:** after A ships its tail and rejoins, the union of all records across the run is present
  exactly once, every chain verifies (`huella` links intact), and no record is attributed to the wrong
  node.
- **Failure means:** the loop's basic shape is wrong — stop and tell the owner; slice 1's premise is
  broken.

### S1 — offline double promotion, and the conditional-write fence

- **Purpose:** two nodes reaching term *n+1* while partitioned cannot both stay primary.
- **Setup:** partition box A and box B from each other but both able to reach the store; drive both to
  promote to the same term from the same base `current.json` version handle.
- **Assert:** exactly one node's conditional write of `current.json` is accepted; the other is rejected,
  commits no promotion, activates no seat, and fences; the store's history under the venue prefix stays
  restorable (no two writers ever wrote one generation path — the `gen-<term>-<node-id>` naming holds,
  topology §2.2). A control: with the conditional write replaced by a plain read-check-write, the rig
  **reproduces** the double-accept (proving the assertion tests the fence, not an accident).
- **Failure means:** the "one primary" guarantee is not structural — a serious finding; stop and tell
  the owner.

### S2 — tail ship retried after the receiver has already submitted → no double submission

- **Purpose:** the crux fiscal-safety case. The receiver's drain claims across every chain with no node
  filter, so a shipped record can be submitted before the ship is confirmed; a retry must not resubmit.
- **Setup:** A ships part of its tail; the receiver's drain runs and "submits" (the stub) some of those
  records and marks their `envios` `enviado`; the ship is then retried in full (a partial/retried ship).
- **Assert:** no `(node_id, secuencia)` is submitted twice (the shared filing ledger records no identity twice; the stub as landed records repeats rather than throwing on them); the
  apply is **terminal-state-wins** for `envios`, in both of its directions — an `enviado` row is never
  regressed to `pendiente` by the re-shipped older version, and a row the receiver still holds
  `pendiente` adopts the sender's terminal state (2026-09-17: the first direction was already
  satisfied before any change; the second is the one S2 shows the risk in); the ship for a chain runs with that chain paused in the drain's blocked
  set. A control: with terminal-state-wins removed, the rig reproduces the double submission.
  *(2026-09-17, as landed: all three are measured, the blocked-set one included, and S2's verdict is
  FAIL — a ship recomputed against a refreshed view of the receiver files a record twice.
  `bench/sqlite-failover/README.md` → "What S2 measures, and what it does not" carries the result.
  Owner review, 2026-09-17, revised what that FAIL costs: the real endpoint refuses a duplicate and
  the real drain records the refusal as filed, and the designed order fences the old primary before
  it ships, which removes the sequences Parts B, D and E's second half depend on. README → "What the
  FAIL means against the real system".)*
- **Failure means:** the design can double-file to the tax agency — the single most serious possible
  finding; stop and tell the owner immediately. *(2026-09-17: read with the note above — a FAIL from
  the stub as landed is a double SUBMISSION. A stub that refused a repeat the way AEAT does could
  not report a double FILING either, since it would never record the second one; what it would do is
  reclassify these doubles as refused duplicates, which is an argument rather than a measurement.)*

### S3 — copied replica equals direct stream (deletions propagate)

- **Purpose:** the on-prem-mirror path (topology §4.4): box B copies A's replica up to the store; a
  cloud restore from that copy must equal a restore from a direct stream.
- **Setup:** A streams to B's replica directory over the LAN path; B copies it up as Litestream
  compacts and deletes files in it; restore the venue from the copied-up store contents.
- **Assert:** the restored database is byte-identical (same `PRAGMA integrity_check`, same row set, same
  chain heads) to a restore from a directly-streamed generation. A control: with the copy-up made
  additive-only (deletions not propagated), the restore **diverges or fails**, proving the check bites.
  *(2026-09-18, as landed: the byte-identical assertion holds, and **the control as written here was RUN
  and does NOT bite**. An additive copy-up into a destination holding only THIS lineage's files — some of
  them objects the source had since compacted away — restored a database identical to the direct one:
  same bytes, same rows, same chain tips, no error from litestream. That is kept as S3's Part C, which
  records its outcome and decides nothing. The control that DOES bite is a destination holding ANOTHER
  node's replica: there the additive copy leaves the foreign objects in place and the restore exits 0
  and hands back the other node's ledger, with no error from litestream anywhere — S3's Part B, which is
  what the landed scenario uses as its control. So the claim this scenario supports is narrower than the
  sentence above: a copied replica equals a direct stream when the copy is a MIRROR, and an additive copy
  onto a DIRTY destination silently restores whatever the leftovers win. What was not tested either way
  is whether litestream ever writes different bytes under a key it has already used.
  `bench/sqlite-failover/README.md` → "What S3's copy covers, and what its Part C records" carries the
  recorded run and the mutation list.)*
- **Failure means:** the two-box topology silently corrupts a cloud restore — a serious finding.

### S4 — multi-day offline write load, checkpointing disabled

- **Purpose:** a box offline for days with `wal_autocheckpoint = 0` (so nothing streamable is lost)
  must not grow its WAL unbounded or slow sales.
- **Setup:** drive a multi-day-shaped write load against an offline box with autocheckpoint off and
  Litestream unable to reach the store; measure sale-commit latency and WAL file size over the run.
- **Assert:** sale-commit p95/p99 stay within a stated bound (reusing the pglite bench's latency bars as
  the reference — p95 ≤ 150 ms, p99 ≤ 400 ms) and the WAL size stays bounded (a stated ceiling, e.g.
  it does not exceed a small multiple of the streamed data). This scenario is a **measurement**: its
  numbers are recorded whatever they are. *(2026-09-18, run: **the example ceiling in that sentence is
  not met, and was not adopted.** The WAL held about 80x the data the checkpoint then wrote into the
  database — 310MB over 3.85MB — so "a small multiple of the streamed data" would fail whatever the
  growth looked like. The landed bar is a per-sale ceiling of 64KiB — the run's AVERAGE WAL bytes per
  sale, which is neither a disk budget nor a statement about the SHAPE of the growth: the same load
  at an 8192-byte SQLite page size grew linearly and sat over that ceiling throughout, so a breach
  can equally mean a wider page or a wider schema. The scenario prints
  `spec-small-multiple-ceiling=not-met` so
  the substitution is visible in its own row. The latency bars held, two to three orders of magnitude
  clear: 481x on p95 (0.312ms against 150ms) and 917x on p99 (0.436ms against 400ms) on the recorded
  run. `bench/sqlite-failover/README.md` → "What S4 measures, and what it does not".)*
- **Failure means:** a **recorded caveat**, not a stop — it constrains how long a box may run offline
  and whether a periodic local checkpoint is needed, which is slice-2 design input, not a foundation
  break.

### S5 — the residual natural-key clash

- **Purpose:** the one clash the design resolves by a human skip — a supplier invoice number typed on
  both nodes during a partition.
- **Setup:** enter the same `(supplier, invoice_number)` on both nodes; ship A's tail.
- **Assert:** the clash is **detected and reported, and the offending row skipped** (not applied, not
  silently dropped, not crashing the whole ship); every other row in the tail applies. Mirrors the one
  review step outbox-swap §4.2 keeps.
- **Failure means:** either a clash corrupts the ship, or a clash is applied silently — a correctness
  finding; record it, and if it corrupts the ship, stop.

### S6 — the store's conditional write

- **Purpose:** confirm the chosen store actually offers the atomic version-conditional write S1 depends
  on.
- **Setup:** drive concurrent conditional writes of `current.json` against the real store API.
- **Assert:** of N racers writing from the same version handle, exactly one succeeds; the rest are
  rejected by the store (not by our code). Establish which primitive the store exposes (S3
  `If-Match`/`If-None-Match`, GCS generation preconditions, Azure ETag) and record it.
- **Failure means:** that store cannot host the design; record it as a hard constraint on store choice
  (the tie-break is unsafe without it — topology §2.2, risk 11).

---

## 5. The object store

**Default target: a local MinIO container**, for the mechanism. MinIO is S3-compatible, runs as a
Testcontainers image beside the rig, and supports conditional writes via `If-Match`/`If-None-Match`,
which is what S1/S6 exercise. The rig streams to it, restores from it, and races the conditional write
against it.

**The store the product will actually run is not yet chosen** — Waitron Cloud is a separate, unstarted
service (backlog: cloud primary is back-burner). So S6's result against MinIO proves the *mechanism*,
not the *production store*. The results note states, as a standing obligation, that **S6 is re-run
against the real store when Waitron Cloud selects one, and against any self-host target the product
claims to support** — an older S3-compatible target may lack the conditional write (topology §12.2,
risk 11). If the owner names a store now, the rig runs S6 against it too; absent that, MinIO is the
default and the obligation is recorded.

---

## 6. Deliverable and landing

Mirrors `bench/pglite-throughput` exactly, because that pattern already solved "a Docker-dependent
throwaway rig that must not enter CI's test shards":

- **`bench/sqlite-failover`** — a private workspace package (`"private": true`, `type: module`), with
  scripts `scenarios` (runs S0–S6, prints a per-scenario PASS/FAIL/MEASURED table, exits non-zero only
  on a **critical** failure — §7), `setup:litestream` (added 2026-09-18: downloads the pinned litestream
  release into a gitignored `.bin/`) and `typecheck`. **No `test` script and no `*.test.ts`**, so no CI
  job and no pre-push step ever runs a SCENARIO. That is not the same as CI never seeing the package:
  it stays a workspace member the shard filters and the root guard suite read by name, which is why it
  is listed in `PACKAGES_WITHOUT_TESTS` and `LIGHT_B_PACKAGES` (`scripts/changed-scope.mjs`) and
  subtracted from `test-light-a`'s selection in `.github/workflows/ci.yml`.
- **`docs/research/2026-09-16-sqlite-failover-prototype.md`** — the results note: the method, each
  scenario's criterion and its recorded output (including the controls that reproduce the failure in
  the other direction — `CLAUDE.md` §1: a measurement taken where both answers look alike measures
  nothing), the Litestream version pinned, the store used, and the standing S6-re-run obligation. This
  note is the actual product of the gate; the package is its reproducer.

Landing is the normal PR flow (`finish-branch` → `land-branch`). The gate for the package is
`typecheck` + `format:check` + `lint` plus the root Vitest guard suite, which reads this package's
wiring by name (there is no scenario to run in CI, by design); the *evidence it works* is the recorded
run in the results note, exactly as the pglite bench's evidence lives in its `docs/research` note, not
in CI.

---

## 7. How it fits the away-campaign — measurements, not gates

This is the one place the prototype's queue item behaves unlike a feature item, and the runner must be
told so, or it will thrash trying to "fix" a scenario whose failure is actually the answer the gate
exists to produce.

- **A scenario result is a measurement, not a build gate.** The package's own `typecheck`/`lint`/
  `format` must be green to land (an ordinary red gate, `CLAUDE.md` §2). But a **scenario** that fails
  is a *recorded outcome*, not a failing test to fix or a blocked item to retry. The runner records
  every scenario's PASS/FAIL/MEASURED in the results note and lands the note plus the rig.
- **A critical-scenario failure STOPS the campaign.** If S0, S1, S2, S3 or S6 fails (the fiscal-safety
  and restorability scenarios), the loop's premise is broken and continuing slice 1 would build on a
  hole. The runner writes a loud summary to the campaign log and `touch`es the STOP sentinel, leaving
  the owner a `needs-owner-review` note — it does **not** grind on slice-1 items. *(2026-09-17, after
  S2 did exactly this: the stop is what the exit code buys, and the note is where the campaign hands
  over. Whether the premise is actually broken is the owner's reading of the result, not something the
  exit code carries — for S2 the owner read it as a wasted call against the real endpoint rather than
  a hole. Two corrections to the sentence above, which predates them: the gate moved on 2026-09-16 to
  run before SLICE 2, so slice 1 was never what it covered and slice 1's own work carried on for that
  reason rather than because of this reading; and the campaign's prototype tasks 5-10 are still
  stopped. 2026-09-18: the campaign was re-armed and Task 5 has been built — S5 exists and passes —
  so the sentence just above is true only of tasks 6-10 from that date on.)* This is the
  prototype's most important interaction with the rest of the queue.
- **A non-critical failure (S4 latency/WAL, S5 handled-clash) is a recorded caveat**, and the campaign
  continues. S4 in particular is expected to *produce numbers*, not pass/fail.
- **The rig never modifies `packages/fiscal-verifactu` or any core table**, so it never trips the
  campaign's H2 (no autonomous fiscal-core landing). It is clean autonomous fuel: it lands its own
  `bench/` package and a `docs/research` note and nothing else.

---

## 8. Testing and running

- The scenarios **are** the tests — each asserts its invariant and each carries a control that
  reproduces the opposite result (S1 without the CAS, S2 without terminal-state-wins, S3 without
  deletion propagation), so a green scenario is not a measurement taken where both answers look alike
  (`CLAUDE.md` §1). *(2026-09-17: S2 added a third shape. A part whose outcome IS the finding — its
  Part D and Part E's second half — measures and feeds the verdict instead of asserting, so the
  verdict is read off the measurement rather than off a passing assertion.)*
- Run: `pnpm --filter @waitron/bench-sqlite-failover scenarios` (Docker up). Prints the table, writes
  the results note's data, exits non-zero only on a critical failure. *(2026-09-19, as landed: the
  note is written and lives at `docs/research/2026-09-16-sqlite-failover-prototype.md`. Three things
  this section and §6 now describe too narrowly. The runner's table is **ten** rows, not S0-S6: the
  litestream foundation check, a smoke check and a `RUNNER` self-check sit beside them. "Writes the
  results note's data" is a `--json` flag, which prints the same run as one parseable document
  carrying the rows verbatim, the ids of the critical failures and the exit code. And the critical
  set is §7's five **plus `RUNNER`** — a wrong exit rule makes every other row's reporting
  untrustworthy, which is a different reason from the fiscal-safety one, and the runner already
  treated any THROWING scenario as critical whatever its id. The gate's result: every critical row
  PASSes but S2, whose FAIL is the gate's answer; `scenarios` exits 1 on a clean tree for that
  reason.)*
- Concurrency: the rig runs its own containers (a store, possibly Litestream) and several node
  processes; it must not be launched beside another session's Docker-heavy or browser run (`CLAUDE.md`
  §2, §4 — measured headroom, never a count). The campaign wrapper serialises firings, so within the
  campaign this is automatic.

---

## 9. Risks and what the rig cannot establish

- **Fidelity of the minimal model.** The rig proves the loop over a *model* of the ledger, not the real
  schema (which does not yet exist on SQLite). The model is faithful to the shapes the loop depends on
  and each is cited to real code (§2), but a shape the real schema has and the model lacks is invisible
  here. Named so it is not assumed away: slice 1's own tests, over the real ported schema, are where the
  full-schema loop is proven; the prototype de-risks the mechanism, not the port.
- **The store is MinIO, not the production store** (§5) — S6's standing re-run obligation covers this.
- **Litestream 0.5's behaviour is established by observation on one pinned version.** A later version
  may differ; the pin and the observed behaviour are both recorded so a version bump re-checks them.
- **A multi-day load is compressed** into a rig run; S4 states how it accelerates time (write volume,
  not wall-clock days) so its bound is read correctly.

---

## Provenance

| Claim | Source | How established |
| --- | --- | --- |
| The loop's shape (promote/return/ship/rejoin) and the scenarios | topology design §5.1, §5.2, §12.2 | read 2026-09-16 |
| Generation naming `gen-<term>-<node-id>`; `current.json` conditional write is the fence | topology design §2.2 | read 2026-09-16 |
| `claimBatch` claims across every chain with no node filter; `blockedSifIds` is a per-pass in-memory set | `packages/fiscal-verifactu/src/drain.ts:542,304,547` | read 2026-09-16 |
| `records`/`chain_head` keyed by `node_id`; `envios` hangs off its parent | the `registros_facturacion`, `cadenas` and `registro_sif` schema files under `packages/fiscal-verifactu/src/schema/` | read 2026-09-16 |
| The residual natural-key clash is the supplier invoice; the working-time clash was removed | outbox-swap design §4.2, §4.4 | read 2026-09-16 |
| Litestream behaviour (snapshots, follow, one-writer-per-path, no 0.5 encryption) | litestream.io docs | quoted in discussion note §3 (`curl`, 2026-09-16); re-confirmed by the rig on the pinned version |
| The throwaway-that-lands pattern (private `bench/` package + `docs/research` note, no CI test) | `bench/pglite-throughput/{package.json,README.md}` | read 2026-09-16 |
| MinIO supports `If-Match`/`If-None-Match` conditional writes | S6 on the pinned MinIO image, run 2026-09-17 | `create-only=true if-match=refuses-stale race=1/8 unfenced=8/8` |
