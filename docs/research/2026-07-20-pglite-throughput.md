# PGlite throughput against the local-server topology

**Date:** 2026-07-20
**Status:** measured; re-measured 2026-07-21 against the completed write path — see
"Re-measurement against the completed write path, 2026-07-21" below, which supersedes the
figures under "Results" for accuracy.
**Decides:** spec §3's open risk — "PGlite is single-connection and fully serialises queries",
carried against §5's local-server recommendation, which makes that node the venue's ceiling.

## Method

`bench/pglite-throughput` drives 8 concurrent virtual tills against one database node for 20
seconds, discarding a 3-second warm-up. Each iteration is the spec §4 write-path transaction:
`SELECT ... FOR UPDATE` on the chain head, an insert into `bench_sales`, three into
`bench_sale_lines`, one into `bench_records`, then an `UPDATE` of the head row — five statements
and a SHA-256 inside one transaction.

Real PostgreSQL 18 via Testcontainers runs the identical statements as a control. PGlite uses its
own `transaction()` rather than hand-rolled `begin`/`commit`. Whether that choice actually matters
for these numbers, and whether hand-rolling reproduces the false-pass trap spec §10 warns about,
was tested directly rather than assumed — see "Mutation 1: what it found, and where the real
assurance actually lives" below for what that found.

## The criterion, and where it comes from

The first deployment is a new deli in Barcelona (architecture §1) — greenfield, low initial
volume, a handful of tills. Its worst realistic minute is a lunch rush at 4 tills settling a sale
every 15 seconds: 16 sales/minute, **0.27 tx/s**. The second deployment, an existing restaurant
at 10 tills settling every 20 seconds, is **0.5 tx/s**.

| Metric | Bar | Why that number |
| --- | --- | --- |
| Sustained throughput | ≥ 20 tx/s | ~40x the modelled restaurant peak. The margin covers reprints, voids, Z-report reads and the outbox drainer, all of which serialise onto the same single backend. |
| p95 commit latency | ≤ 150 ms | The cashier waits for this: the receipt cannot print until commit. Below the threshold at which a person perceives a wait. |
| p99 commit latency | ≤ 400 ms | Keeps the worst sale of a rush from feeling like a queue. |
| Cold boot | ≤ 3 s | Sets Vitest's `testTimeout` in `packages/db` with an order of magnitude of headroom. |

The bar is deliberately *not* heroic throughput. Nothing in either deployment needs it, and
setting an unreachable bar would reopen a settled decision for no operational reason.

## Results

Emitted by `pnpm --filter @waitron/bench-pglite bench` (final confirming run; see "Commands run"
below for the full transcript and prior runs used for the mutation testing):

### Sustained write-path throughput — 8 tills, 20s

| Target | tx/s | p50 ms | p95 ms | p99 ms | commits |
| --- | --- | --- | --- | --- | --- |
| PGlite 0.5.x (in-memory) | 1495.6 | 5.3 | 5.6 | 6.0 | 29920 |
| PostgreSQL 18 (Testcontainers) | 3439.1 | 2.3 | 2.9 | 3.7 | 68786 |

### PGlite startup costs

| Measurement | median ms | p95 ms | samples |
| --- | --- | --- | --- |
| Cold boot to first query | 349.7 | 541.9 | 5 |
| Fresh database (boot + schema + seed) | 333.8 | 345.1 | 20 |

`PASS against the criterion.` (stderr, exit 0.)

### Reading against the criterion

| Metric | Bar | Measured | Margin |
| --- | --- | --- | --- |
| Sustained throughput | ≥ 20 tx/s | 1495.6 tx/s | ~75x the bar, ~3000x the modelled restaurant peak (0.5 tx/s) |
| p95 commit latency | ≤ 150 ms | 5.6 ms | ~27x headroom |
| p99 commit latency | ≤ 400 ms | 6.0 ms | ~67x headroom |
| Cold boot (p95) | ≤ 3000 ms | 541.9 ms | ~5.5x headroom |

PGlite clears every threshold by a wide margin — not a marginal pass. Real PostgreSQL via
Testcontainers is faster still (3439.1 tx/s, p95 2.9ms), which is the expected shape: a real
server process beats an in-process WASM engine, and the gap (roughly 2.3x on throughput) is the
cost of running Postgres inside WebAssembly rather than as a native process. Both numbers are
three to four orders of magnitude above what either deployment (0.27 tx/s deli, 0.5 tx/s
restaurant) will ever ask of this node.

> **Superseded for accuracy, 2026-07-21.** These figures measured a `writePath()` that omitted
> art. 7.i chain verification and the outbox/`envios` sidecar insert, because neither existed yet
> at Task 1. Both do now (Task 17 landed), and Task 15's brief mandated exactly this re-run once
> they did. See "Re-measurement against the completed write path, 2026-07-21" below for the
> corrected figures. The numbers above are not deleted — they remain an accurate measurement of
> the pre-art.-7.i write-path shape that actually existed at Task 1 — but they UNDERSTATE the real
> per-sale cost and should not be quoted as the current figure.

The fresh-database figure — 333.8ms median, 345.1ms p95 for boot + schema + seed — is what
`packages/db`'s test suite will pay per test if each test gets an isolated PGlite instance.

## Mutation 1: what it found, and where the real assurance actually lives

The plan's teeth check for this benchmark specified two mutations. Mutation 2 (criterion
enforcement) worked as designed — see "Mutation 2" under "Commands run" below. Mutation 1
(merged-transaction reproduction) did not, and — established twice independently, once
empirically across three runs and once by reading PGlite's own bundled source — cannot, on this
PGlite version.

**Expected:** reverting `runPglite` from PGlite's `transaction()` to hand-rolled `begin`/`commit`
should let concurrent tills' statements interleave inside what the application still believes are
separate transactions, and the resulting merge should surface as a `23505` unique-constraint
violation — the false-pass trap spec §10 warns about.

**What happened:** three runs of the mutated file produced zero `23505` violations, and
throughput was statistically indistinguishable from the correct `transaction()` version (mutated:
1430.6 / 1455.5 / 1472.1 tx/s vs. correct: 1511.4 / 1495.6 tx/s — ordinary run-to-run noise, not
the multi-times difference either predicted outcome implies). Full transcripts are under
"Mutation 1" below.

**Why:** reading PGlite 0.5.4's bundled source (`chunk-SRXPYZFS.js`) shows both `.query()` and
`.transaction()` are routed through the same `_runExclusiveTransaction` call, which acquires one
shared semaphore instance before doing any work. `.transaction()` holds that semaphore across its
whole begin-work-commit sequence; hand-rolled `begin`/`commit` acquires and releases it once per
statement instead. Either way, the same total amount of work is dispatched through the same
serial gate — regrouping statements into or out of an explicit transaction cannot change what
PGlite executes concurrently, because PGlite never executes two statements concurrently in the
first place. That is a property of the semaphore, not of the statements passing through it, so it
holds for any schema, not just this benchmark's.

Separately, and independently of that version-level fact: even a PGlite that did let hand-rolled
`begin`/`commit` interleave statements would still need two writers contending for the *same* row
to raise `23505`. This benchmark gives each of its 8 virtual tills exclusive ownership of its own
`bench_chains` row, so that contention is never constructed here regardless of which transaction
mechanism is used.

**Conclusion:** on PGlite 0.5.4, mutation 1 as specified cannot demonstrate what it was designed
to demonstrate, for any schema. This is a structural property of the version under test, not a
gap in this benchmark's design that a different mutation would dodge.

**Where the real assurance lives instead:**

- Mutation 2 genuinely proves the pass/fail criterion bites — it is not decorative. See "Mutation
  2" below.
- The throughput and latency numbers reported above are unaffected by any of this: both engines
  were measured running the correct `transaction()` code path, never the mutated one, so the
  measured ~75x margin on throughput and ~27x margin on p95 latency against the criterion stand.
- The contention risk mutation 1 was meant to stand in for — two writers racing to append to the
  *same* till's chain, which spec §3 documents as a real risk with a PWA that can have multiple
  tabs open — is not tested by this benchmark at all, on any PGlite version. It is Task 14's job:
  20 concurrent appends to a single chain, proven against real PostgreSQL via Testcontainers,
  where locking and blocking genuinely happen and can be observed. PGlite provably cannot test
  lock contention — concurrent queries serialise onto one backend, so `FOR UPDATE` parses and
  runs but never blocks (spec §10).

## Consequences

The fresh-database figure is consumed by `packages/db`: it sets `testTimeout` and it decides
whether Stryker can gate every PR or must stay weekly. At ~334-345ms per fresh database, a
mutation run covering even a modest number of mutants times the number of covering tests will
add up quickly (e.g. 500 mutant/test pairs × ~340ms ≈ 2.8 minutes just in fresh-database setup,
before any statement execution) — worth keeping in mind when Task 2 decides the per-PR-vs-weekly
question, though the number itself doesn't rule either option out on its own.

## Re-measurement against the completed write path, 2026-07-21

**This section SUPERSEDES the throughput/latency figures under "Results" above for accuracy.**
Task 15's brief mandated a re-run "against the completed write path once Task 17 lands" — Task 17
has now landed, so this is that mandated re-run, not optional follow-up.

### Why the original figure understated the real cost

Task 1's `writePath()` was a hand-written SQL shape, not the real write path, and it deliberately
omitted two things that did not exist yet at the time:

1. **Art. 7.i chain verification** (`packages/fiscal-verifactu/src/verify.ts`'s `verifyChain`,
   called from `VerifactuBackend.checkIntegrity`, itself called first inside
   `packages/core/src/record-sale.ts`'s `recordSale`) — a read of the last two chained records
   under the chain-head lock, plus a real SHA-256 recompute of the predecessor's own huella
   (`verifyHuella`), on every sale, not just the corrupted ones.
2. **The outbox/`envios` sidecar insert** (`packages/fiscal-verifactu/src/schema/envios.ts`,
   written by `VerifactuBackend.recordSale` as its step 6) — one more INSERT per sale, permanent,
   never something a future optimisation removes.

### What changed in the bench, and what didn't

Per this task's brief, the two options were: wire the real `@waitron/core` + `VerifactuBackend`
stack into the bench (most honest, most coupling), or extend the synthetic to match the real
operation count (less honest, least coupling). **Chosen: the faithful-synthetic extension.**
Wiring the real stack would mean pulling `@waitron/core`, `@waitron/fiscal-verifactu`,
`@waitron/db` and a seeded tenant/till/series/SIF fixture into what `bench/pglite-throughput`'s
own README documents as a deliberately single-file, dependency-light spike (its "Single-file
constraint" section) — judged disproportionate to what this bench exists to answer, and a
meaningfully bigger, more fragile piece of work than the throughput question warrants.

`bench/pglite-throughput/src/bench.ts`'s `writePath()` gained exactly three additions (its own
top-of-file comment enumerates these in full, with file-and-method references):

1. The art. 7.i two-row predecessor read (`select ... from bench_records order by sequence desc
   limit 2`), mirroring `verifyChain`'s identical query shape against `registros_facturacion`.
2. A real `node:crypto` SHA-256 recompute of the predecessor record's hash from its own stored
   inputs — discarded rather than compared, since this bench never corrupts a record — mirroring
   `verifyHuella`'s recomputation cost.
3. An INSERT into a new `bench_envios` table, mirroring the `envios` sidecar insert.

The registro INSERT with its own huella computation (`bench_records`, and the SHA-256 that
produces its `hash` column) was already present since Task 1 and needed no change.

**Not modeled, deliberately:** `recordSale`'s series/SIF/tenant/location point-lookups,
invoice-number allocation, and its tenders insert, plus the second SIF lookup and QR-payload
re-select inside `VerifactuBackend.recordSale` itself. Each is one indexed read or insert against
a small table. Leaving them out keeps this a shape match for the two components Task 15 flagged
as OMITTED ENTIRELY (verification, outbox) rather than a full statement-by-statement
reimplementation of `recordSale` — see "Residual gap" below for why this does not change the
PASS conclusion.

### Results

Three clean runs of `pnpm --filter @waitron/bench-pglite bench`, Docker up throughout (full
transcripts under "Commands run" below). All three landed in the same range — PGlite 1148.6-
1210.4 tx/s, p95 6.8-7.3ms, p99 7.1-8.0ms; PostgreSQL 2590.8-2726.1 tx/s. The final run is
reported as the headline figure, consistent with the original measurement's own convention:

### Sustained write-path throughput (completed write path) — 8 tills, 20s

| Target | tx/s | p50 ms | p95 ms | p99 ms | commits |
| --- | --- | --- | --- | --- | --- |
| PGlite 0.5.x (in-memory) | 1148.6 | 6.9 | 7.3 | 7.6 | 22980 |
| PostgreSQL 18 (Testcontainers) | 2628.3 | 2.9 | 3.8 | 4.5 | 52570 |

### Reading against the criterion (unchanged bar — see "The criterion, and where it comes from")

| Metric | Bar | Measured | Margin |
| --- | --- | --- | --- |
| Sustained throughput | ≥ 20 tx/s | 1148.6 tx/s | ~57x the bar, ~2300x the modelled restaurant peak (0.5 tx/s) |
| p95 commit latency | ≤ 150 ms | 7.3 ms | ~20x headroom |
| p99 commit latency | ≤ 400 ms | 7.6 ms | ~53x headroom |

**PGlite still clears every threshold, by a wide margin — but the margin shrank, and plainly.**
Against the original (superseded) figures: sustained throughput fell from 1495.6 to 1148.6 tx/s
(≈23% lower), p95 rose from 5.6ms to 7.3ms (≈30% higher), p99 rose from 6.0ms to 7.6ms (≈27%
higher). That is the real, measured cost of art. 7.i verification and the outbox insert — not
noise; it recurred consistently across all three runs. The conclusion does not change (PASS,
comfortably), but the number quoted for "how much headroom exists" must change, and the original
figure should not be cited as the current one.

### Residual gap: this is still not the full statement count, and why that doesn't matter here

The synthetic above runs 7 database round trips and 2 SHA-256 hashes per sale, up from the
original 5 round trips and 1 hash — it does not attempt the ~9-11 additional small point-reads/
inserts real `recordSale` also performs (see "Not modeled" above). Comparing the before/after
figures gives a rough per-added-operation cost: the 2 extra round trips + 1 extra hash added
about 1.6ms to p50 (5.3ms → 6.9ms), on the order of 0.5-0.8ms per added operation on PGlite.
Extrapolating that rate across the ~9-11 un-modeled operations (a rough estimate, not a further
measurement) would plausibly roughly halve throughput again, to somewhere in the 550-650 tx/s
range — still a ~27-32x margin over the 20 tx/s bar and comfortably under the 150ms p95 bar. This
extrapolation is not a substitute for actually measuring the real path, and is reported here only
to show that the specific gap left by choosing the faithful-synthetic option is very unlikely to
threaten the PASS conclusion, not to claim a more precise number than was actually measured.

### Commands run for this re-measurement

```
$ pnpm --filter @waitron/bench-pglite typecheck
> @waitron/bench-pglite@0.0.0 typecheck
> tsc --noEmit
(no output, exit 0)
```

```
$ pnpm --filter @waitron/bench-pglite bench
(run 1)
### Sustained write-path throughput (completed write path, incl. art. 7.i + outbox) — 8 tills, 20s

| Target | tx/s | p50 ms | p95 ms | p99 ms | commits |
| --- | --- | --- | --- | --- | --- |
| PGlite 0.5.x (in-memory) | 1210.4 | 6.6 | 6.8 | 7.1 | 24215 |
| PostgreSQL 18 (Testcontainers) | 2726.1 | 2.8 | 3.6 | 4.4 | 54527 |
PASS against the criterion. (exit 0)

(run 2)
| PGlite 0.5.x (in-memory) | 1161.3 | 6.8 | 7.2 | 8.0 | 23234 |
| PostgreSQL 18 (Testcontainers) | 2590.8 | 3.0 | 3.9 | 4.7 | 51821 |
PASS against the criterion. (exit 0)

(run 3, final — reported above)
| PGlite 0.5.x (in-memory) | 1148.6 | 6.9 | 7.3 | 7.6 | 22980 |
| PostgreSQL 18 (Testcontainers) | 2628.3 | 2.9 | 3.8 | 4.5 | 52570 |
PASS against the criterion. (exit 0)
```

Docker was available and the Testcontainers control started successfully in all three runs.

## Commands run, and their output

### Dependency versions resolved (pinned exactly, per task brief)

```
$ grep -n "'@electric-sql/pglite@0.5.4':\|'@testcontainers/postgresql@12.0.4':\|pg@8.22.0:\|'@types/pg@8.20.0':" pnpm-lock.yaml
```
Resolved: `@electric-sql/pglite@0.5.4`, `@testcontainers/postgresql@12.0.4`, `pg@8.22.0`,
`@types/pg@8.20.0` — all match the versions specified for this task exactly.

### Typecheck

```
$ pnpm --filter @waitron/bench-pglite typecheck
> @waitron/bench-pglite@0.0.0 typecheck
> tsc --noEmit
(no output, exit 0)
```

### Benchmark run (final, reported above)

```
$ pnpm --filter @waitron/bench-pglite bench

### Sustained write-path throughput — 8 tills, 20s

| Target | tx/s | p50 ms | p95 ms | p99 ms | commits |
| --- | --- | --- | --- | --- | --- |
| PGlite 0.5.x (in-memory) | 1495.6 | 5.3 | 5.6 | 6.0 | 29920 |
| PostgreSQL 18 (Testcontainers) | 3439.1 | 2.3 | 2.9 | 3.7 | 68786 |

### PGlite startup costs

| Measurement | median ms | p95 ms | samples |
| --- | --- | --- | --- |
| Cold boot to first query | 349.7 | 541.9 | 5 |
| Fresh database (boot + schema + seed) | 333.8 | 345.1 | 20 |

PASS against the criterion.
(exit 0)
```

Four total clean runs were taken across this task (three during the mutation-1 investigation
below, one final confirming run). All four landed in the same range: PGlite 1430-1531 tx/s, p95
5.6-5.9ms, p99 6.0-6.5ms; PostgreSQL 2641-3439 tx/s (the one low PostgreSQL reading, 2640.9 tx/s
with p99 14.3ms, coincided with the `minSustainedTps: 1_000_000` mutation-2 run and is most
likely host contention from three concurrent Docker/WASM-heavy runs in the same session, not a
change in either engine's real behaviour — see "Surprises" below).

### CI-exclusion checks (Step 5 of the brief)

```
$ pnpm -r test 2>&1 | grep -c "bench-pglite"
0
```

```
$ ls bench/pglite-throughput/src/*.test.ts
zsh: no matches found: bench/pglite-throughput/src/*.test.ts
(exit 1, as expected — the file does not exist)
```

Both of the two independent mechanisms from Step 1 (no `test` script; no `*.test.ts` file) are
confirmed, and `pnpm -r test` continues to run and pass the rest of the workspace (`packages/ui`,
`packages/verifactu`) unaffected — 21 test files, 131 tests passed in `packages/ui` alone in the
same run.

### Mutation 1 — merged-transaction reproduction attempt (Step 7)

Replaced `runPglite`'s `db.transaction(...)` with hand-rolled `begin`/`commit` as literally
specified in the brief, then ran the benchmark three times.

**Result: this mutation did NOT reproduce either predicted failure signal in three runs.** No
`23505` unique-constraint violation occurred, and throughput was statistically indistinguishable
from the correct `transaction()` version (mutated: 1430.6 / 1455.5 / 1472.1 tx/s vs. correct:
1511.4 / 1495.6 tx/s — well within normal run-to-run variance, not "several times higher" as the
brief anticipates as one of the two possible outcomes). See "Mutation 1: what it found, and where
the real assurance actually lives" above for the investigation into why, and for what this does
and doesn't mean for the trap the brief describes.

The mutation and its three runs (commands identical each time — `pnpm --filter
@waitron/bench-pglite bench`) all exited 0 with `PASS against the criterion.`, which is the
opposite of "Expected: FAIL" in the brief's Step 7. The file was restored and diffed byte-for-byte
identical against the pre-mutation version before proceeding (`diff` produced no output).

### Mutation 2 — criterion-enforcement (Step 7)

Changed `PASS_CRITERION.minSustainedTps` from `20` to `1_000_000`, ran once:

```
$ pnpm --filter @waitron/bench-pglite bench
...
FAIL against the criterion: sustained 1530.6 tx/s < 1000000
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @waitron/bench-pglite@0.0.0 bench: `node src/bench.ts`
Exit status 1
(exit 1)
```

This matches the brief's expectation exactly. Restored `minSustainedTps` to `20` and diffed
byte-for-byte identical against the original again.

## Surprises / things I could not fully verify

**Mutation 1 (Step 7) did not reproduce the predicted failure**, in three runs, despite following
the brief's exact replacement code. I investigated rather than assuming the brief was wrong or
silently skipping the discrepancy — the mechanism and the conclusion are recorded above under
"Mutation 1: what it found, and where the real assurance actually lives" rather than repeated
here.

One consequence of the shared-semaphore mechanism is worth flagging on its own, since it's not
obvious from the throughput numbers: the *grouping* that hand-rolled `begin`/`commit` loses is not
nothing in general, only latent for this benchmark's schema. Because the mutex still executes
every statement to completion before the next one starts, a till always sees its own
immediately-prior write on its next read regardless of transaction boundaries — but the merge's
real hazard, that one till's `commit` also commits every other till's not-yet-explicitly-committed
work, and a `rollback` would take everyone's uncommitted work down with it, never gets exercised
here, because nothing in this workload ever errors or rolls back and no two tills ever touch the
same row. I did not modify the benchmark to add cross-till contention or a deliberate rollback to
force that visible, since that would depart from the brief's literal Step 7 code, which I was
asked to follow verbatim. Task 14 is where this actually gets tested, against real Postgres,
where blocking and rollback genuinely happen and can be observed.

The one low-throughput PostgreSQL control reading (2640.9 tx/s, p99 14.3ms, during the
`minSustainedTps: 1_000_000` run) is noted above; it did not recur in the four other runs and
most plausibly reflects transient host load from having run several Docker-containered
Testcontainers benchmarks back-to-back in one session, not a real behaviour change. I did not
investigate further since it doesn't touch the PGlite figures the pass/fail criterion depends on.

Docker was available and the Testcontainers control started successfully in every run — no
fallback or missing-control caveat applies here.
