# The SQLite + Litestream failover loop — prototype results

**Date:** 2026-09-19 (the recorded runs were taken late on 2026-09-18)
**Status:** measured. One critical scenario FAILS, and that failure is the gate's answer rather
than a broken rig — read "S2" below before reading the failure as a blocker.
**Decides:** the one gate still standing in
[SQLite + Litestream topologies](../superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md)
§12.2 — the throwaway failover-loop prototype that runs **before slice 2** (the gate moved there on
2026-09-16: all five risks it checks live in slice 2 or later, and slice 1 has no streaming, no store
and no promotion).
**Reproducer:** [`bench/sqlite-failover`](../../bench/sqlite-failover/README.md). The rig is the
evidence; this note is the product.
**2026-09-23:** slice 2's five measurements are appended under [Slice 2 measurements](#slice-2-measurements).

---

## The question, and the answer

**The question.** A venue's box runs the till. It streams its database to an object store. The box
dies; a cloud node rebuilds from the store, takes over and starts selling for itself; the box comes
back holding sales it never streamed and hands them over. Does that loop hold together — and does it
hold together *fiscally*: no dropped ledger row, no forked hash chain, no sale filed twice with the
Spanish tax agency?

**The answer.** The loop holds everywhere but one place. Nine of the ten rows the rig prints pass or
measure; the tenth — S2, the crux fiscal-safety case — **fails**, in one of its five parts and in the second half of another: a
hand-over recomputed against a refreshed view of the receiver files one sale a second time, and so
does a hand-over taken while the sender is part-way through filing. That is the gate's negative result and
it is recorded rather than fixed. Against the real tax agency it costs a refused call rather than a
duplicate record, for reasons set out under S2; it also leaves one piece of work this repository now
owns, named under "What this gate leaves to be built".

| id | what it had to show | critical | verdict |
| --- | --- | --- | --- |
| S0 | the whole loop works once, with nothing adversarial | yes | **PASS** |
| S1 | two nodes promoting while partitioned cannot both stay primary | yes | **PASS** |
| S2 | a retried or recomputed hand-over files nothing to the tax agency twice | yes | **FAIL** |
| S3 | a replica copied between two places in the store restores the same database as a direct stream | yes | **PASS** |
| S4 | a box offline for days neither slows sales nor grows its write-ahead log without bound | no | **MEASURED** — latency fine, the log is bounded only by how long the box stays offline, and its space cannot be reclaimed while litestream is attached |
| S5 | a supplier invoice number typed on both machines is reported and skipped, the rest of the hand-over intact | no | **PASS** |
| S6 | the store really offers the atomic conditional write S1 depends on | yes | **PASS** (on MinIO — see the standing obligation) |
| LS | the litestream foundation: find the binary, configure it, stream, restore | no | **PASS** |
| RUNNER | the runner's own exit rule and `--json` dump | yes | **PASS** |
| smoke | the harness itself is up: store, SQLite, model | no | **PASS** |

`scenarios` exits **1** on a clean tree. S2 is why, and that is the runner working as designed.

---

## Method

### What the rig is, and what it is not

`bench/sqlite-failover` is a private workspace package with no test suite and no CI job, in the
pattern `bench/pglite-throughput` already set. It stands up a **minimal model** of the fiscal ledger
in SQLite (`src/model.ts`), each table naming in a comment the real table it stands in for, and it
imports no `@waitron/` package at all — `packages/fiscal-verifactu` included. **A result here is evidence about the loop's mechanism, never
about the real ledger's code.** A shape the real schema has and the model lacks is invisible here;
that is stated in the prototype spec §9 and it has not changed.

Each scenario is a self-contained file under `src/scenarios/`. The runner discovers them, runs them
one at a time, prints one Markdown table — or, with `--json`, one parseable document — and exits
non-zero only on a critical failure.

### How a result here is made honest

Three rules, each of which cost something on the way:

- **Every scenario that measures the loop carries a control that reproduces the OPPOSITE result**,
  and the control drives the scenario's *own* comparison rather than asserting the failure in words
  of its own. A control that says "the rows are the wrong node's" in its own words stays green if the
  assertion it is meant to protect has stopped checking anything. Two rows have no control and are
  not measurements of the loop: `smoke`, which checks the harness is up, and `RUNNER`, which drives
  the runner's own rule over a table of cases.
- **External behaviour is established by observing it, never by asserting it.** What MinIO's
  conditional write does, how litestream lays out a replica and when it deletes one, what an offline
  litestream does to a checkpoint — each was run before anything was built on it, and several of
  those runs moved the design. Three of the plan's own expectations turned out to be wrong this way
  and are recorded as such rather than quietly replaced (S3's control, S4's WAL ceiling, and the
  compaction settings litestream needs before it deletes anything).
- **A scenario is a MEASUREMENT, not a build gate.** A FAIL is a recorded outcome. Where a part's
  outcome *is* the finding, it measures and feeds the verdict instead of asserting.

### The pins — every result below holds on these and no others

| | pinned to | how it is pinned |
| --- | --- | --- |
| Litestream | **v0.5.17** | `setup:litestream` downloads that tag; `resolveLitestream()` accepts `$LITESTREAM_BIN` or a `litestream` on `PATH` and takes **only** this version from any of the three |
| Object store | **MinIO** `RELEASE.2025-09-07T16-13-09Z`, digest `sha256:14cea493…8936e` | tag and digest together in the one reference `src/store.ts` starts the container from |
| SQLite | **3.53.4**, via node's built-in `node:sqlite` | `node -e 'select sqlite_version()'`, 2026-09-18 |
| Node | **v26.7.0** | `node --version`, 2026-09-18 |
| Host | **darwin/arm64** | only this platform has been downloaded and run |
| Linux | **linux/amd64** (emulated on the darwin/arm64 host) and **linux/arm64**, in node:26-slim | measurement 5 only, below |
| Litestream archives | linux-x86_64 sha256:cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d, linux-arm64 sha256:f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5 | recomputed from the downloaded bytes, equal to the release API's digest |

A different version is a different measurement. A version bump re-runs the scenarios rather than
inheriting their verdicts.

### The recorded run

```
cd bench/sqlite-failover
pnpm --filter @waitron/bench-sqlite-failover setup:litestream   # once per checkout
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/bench-sqlite-failover scenarios
```

2026-09-18, on the branch that added this note, Docker running:

```
| id | title | verdict | detail |
| --- | --- | --- | --- |
| S0 | the happy failover loop, end to end | PASS | version=0.5.17 happy-box-a-filed=[box-a:1,box-a:2,box-a:3,box-a:4] happy-cloud-first-drain=[cloud-1:1] happy-cloud-second-drain=[box-a:5,box-a:6] happy-submissions=7 happy-distinct=7 happy-refiled=0 happy-current={term:2,node:cloud-1,gen:gen-2-cloud-1} control-ship=off control-held=box-a:1..4 control-refused="the cloud holds box-a's records 1..6 exactly as box-a wrote them" lag-sync-after-drain=off lag-refiled=4 lag-refiled-ids=[box-a:1,box-a:2,box-a:3,box-a:4] lag-refiled-shape=verbatim-same-identity lag-cloud-first-drain=[box-a:1,box-a:2,box-a:3,box-a:4,cloud-1:1] |
| S1 | double promotion fenced by the store's conditional write | PASS | fenced: winners=1/2 winner=box-a store-keys=3; control: winners=2/2 store-keys=5 |
| S2 | no second tax-agency filing on a re-sent or recomputed tail ship | FAIL | RETRIED-IN-FULL ship safe: filed=13 double=0 (A receiver files 5 once; B receiver files none of the owner's 4; C blocked chain drains 4 next pass after 1 refusal). D REFRESHED-SUMMARY ship files twice: refreshed-sender:1 (fresh tail carried records [2]; receiver left 1 pendiente acked=0, 2 enviado acked=1). E ship issued mid-pass for a blocked chain: that chain files nothing more that pass, next pass files 3 once, double=0. E tail taken mid-drain carried [1 enviando, 2 pendiente]: receiver left 1 enviando acked=0, 2 pendiente acked=0, and its own drain claims no enviando row, so 1 enviando acked=0 is stuck against that drain and cloud-f:2 is filed twice. Controls double-file: regressing=3 insert-only=2 |
| S3 | a copied replica equals a direct stream | PASS | version=0.5.17 source-keys=6 source-deleted=1 deletion-waited-ms=4155 direct-rows=19 foreign-keys=9 copied=6 mirror-deleted=6 copied-rows=19 copied-sha-equal=true control-foreign-keys=9 control-copied=6 control-stale=6 control-rows=9 control-nodes=[box-b] control-integrity="row 1 missing from index sqlite_autoindex_chain_head_1" control-refused="the copied replica restores an intact database" same-lineage-stale=1 same-lineage-rows=19 same-lineage-additive="identical" |
| S4 | offline write load | MEASURED | version=0.5.17 sales=7500 days=30 sales-per-day=250 day-rate=assumed-not-measured rounds=15 idle-ms=1500 offline-daemon=ECONNREFUSED offline-attach-ms=1024 offline-daemon-alive-after-load=true p50-ms=0.171 p95-ms=0.315 p99-ms=0.446 max-ms=2.729 first-day-p95-ms=0.403 last-day-p95-ms=0.196 peak-wal-bytes=308489152 wal-bytes-per-sale=41132 offline-checkpoint-rounds=0/15 checkpointed-db-bytes=3866624 wal-amplification=79.8x spec-small-multiple-ceiling=not-met spec-small-multiple=10 offline-days-per-gib=104.4 reclaim-offline="ms=12442.7 busy=1 log=74876 checkpointed=4 wal=308489152->308489152 shrank=false" reclaim-next-sale-ms=1.345 reclaim-control="ms=25.9 busy=0 log=0 checkpointed=0 wal=308526232->0 shrank=true" control="peak-wal=21143872 end-wal=21143872 db=3850240 store-keys=36 checkpoint-rounds=15/15 p95-ms=0.282 p99-ms=0.453" breaches=none |
| S5 | supplier-invoice clash reported and skipped, ship otherwise intact | PASS | applied=13 clashes=1 retry-applied=0 retry-clashes=1; silent-drop: clashes=0 clash-rows-held=0 records-held=3/3; unisolated: refused="UNIQUE constraint failed: supplier_invoices.supplier, supplier_invoices.invoice_number" records-held=0/3 sales-held=0/3 clean-invoice-rows-held=0; not-a-uniqueness-refusal: refused="the receiver refuses this row for its own reasons" records-held=0/3 |
| S6 | store conditional write | PASS | create-only=true if-match=refuses-stale race=1/8 unfenced=8/8 |
| LS | litestream roundtrip | PASS | version=0.5.17 one-shot-keys=1 one-shot-restored=3 daemon-restored=4 first-sync-restores=3 after-write-restores=3 control-refused="litestream restore exited 1: Error: no matching backup files available" |
| RUNNER | the runner's exit rule and --json dump | PASS | exit-rule-cases=8 critical-fail-exit=1 non-critical-fail-exit=0 critical-skipped-exit=0 critical-measured-exit=0 critical-pass-exit=0 empty-run-exit=0 throw-verdict=FAIL throw-critical=true throw-exit=1 json-parsed=true json-rows=3 json-exit-code=1 json-critical-ids=1 table-rows=5 table-escapes-pipe=true table-flattens-newline=true json-selected-by-flag=true |
| smoke | harness up: store + sqlite + model | PASS | chain advanced to 2, 4 mutations refused, store round-trip ok |
```

stderr: `CRITICAL failure: S2 — see the results above.` Exit status **1**.

**Which of those numbers are properties of the rig, and which move.** The whole suite was run **seven
times** while this note was written — six printing the table, one with `--json` — and the detail lines
compared token by token. **Every verdict was the same on every run, and every run exited 1 with S2 the
only critical failure.** The table above is the last of the seven, taken on the exact tree this note
lands with. **S0, S1, S2, S5, S6, LS and smoke were byte-identical across all seven.** (`RUNNER`'s
detail is not comparable across the whole set: the row did not exist for the first run, and gained two
keys when review found four of its checks missing, so it is identical within each group.) Two
scenarios moved, and only in the places the rig already names as outcomes rather than properties:

- **S3**, in up to four tokens of thirty-one, all of them downstream of a wait on a real store
  listing: `deletion-waited-ms` read between 3896 and 4160. With the shortest waits `source-keys`,
  `copied` and `control-copied` read 5 where the longer ones read 6, and the three row counts
  (`direct-rows`, `copied-rows`, `same-lineage-rows`) read 19 on most runs and 18 on one. They were
  always **equal to each other**, which is what S3 asserts; the count itself is not the claim.
- **S4**, in more than twenty tokens of forty-five — every latency and every write-ahead-log figure.
  That is what a measurement of a real machine does, and these seven runs pushed the package README's
  own recorded spreads out at both ends. **Nothing in S4 should be quoted as a single number.** Across
  these runs the reclaim duration read between 8.3 s and 12.4 s, p95 between 0.302 and 0.332 ms, p99
  between 0.420 and 0.506 ms, and the per-sale write-ahead-log rate between 41,132 and 41,415 bytes —
  the rate stable to well under a percent while the percentiles wander.

S1's `winner=` is the third value the rig names as a race outcome rather than a property — which node
wins is not the measurement, `winners=1/2` is. It happened to read `box-a` on every run here, which
is not evidence that it always will.

---

## Scenario by scenario

### S0 — the happy loop · critical · **PASS**

**Criterion.** After the box returns and hands over its tail, the union of all records across the run
is present exactly once, every chain's hash links verify, and no record is attributed to the wrong
node.

**What passed.** The cloud ends holding the box's six records with the contents the box wrote,
compared field by field; the cloud's own sale is a separate intact chain; every record sits under the
node that wrote it; every chain's sequence numbers run 1..N with no gap; every record reached the
tax-agency stand-in **exactly once** (`happy-submissions=7 happy-distinct=7 happy-refiled=0`); and the
pointer in the store names the cloud's term and generation, read back rather than assumed.

**The control** is the identical loop with the hand-over left out. The cloud must end up holding the
box's 1..4 and not the tail, and **Part A's own comparison** is what must refuse that state.

**A third part measures and decides nothing.** With the sync that would carry the box's filing state
left out, the promoted cloud restores those records as unfiled and files them again: **four records,
each a verbatim same-identity copy** — same node, same sequence number, same hash, same payload,
asserted row by row. That is the same shape S2 found, arriving by the streaming route instead, and it
is recorded rather than failed for the reason under S2.

**What S0 does not establish.** It never starts the streaming daemon — every upload is a one-shot, so
"the box dies before the next upload" is a scripted step here, not the timing window the product would
face. "Exactly once" is a claim about the filing ledger, not the table, which is keyed by node and
sequence number and could not hold a row twice whatever the loop did. **Nothing fences the returning
box**: it hands over because the scenario has it hand over. And **nothing streams the cloud's own
generation**, so a node restoring `gen-2-cloud-1` and following the store pointer is unmodelled.

### S1 — a double promotion, fenced · critical · **PASS**

**Criterion, as the spec writes it.** Of two nodes promoting to the same term from the same base,
exactly one conditional write is accepted; the other is rejected **by the store**, commits no
promotion, activates no seat and fences, and the store's history under the venue prefix stays
restorable.

**What was actually shown.** `winners=1/2`, and three keys under the venue prefix rather than five.
**The control** replaces the conditional write with a plain read-check-write and reproduces the double
accept: `winners=2/2 store-keys=5`. So the assertion tests the fence and not an accident.

**Two caveats this note must carry, because the criterion above is wider than the measurement.**

- **The rig's fence is not the product's primitive.** The rig claims **one key per term, create-only**;
  the product writes `current.json` only if its version is unchanged, which is compare-and-swap. S1 is
  evidence that *a refusal by the store* stops a double promotion — it is **not** a measurement of the
  product's own conditional write. S6 records what the pinned store does with each.
- **Two parts of the criterion are unmodelled.** Of "commits no promotion, activates no seat and
  fences", the rig shows only that the loser **writes nothing**. And "the store's history stays
  restorable" needs a litestream generation, which S1 does not have — S3 is where a restore from the
  store is driven.

### S2 — no second tax-agency filing · critical · **FAIL**

**This is the gate's negative result.** The rig found a way the loop as modelled here submits one sale
to the tax agency twice. Nothing here proposes a fix, and the scenario records the failure rather than
reporting PASS beside it.

**What is safe.** A hand-over **re-sent in full** is safe: 13 sales filed, none twice. An already-filed
sale is not pushed back to unfiled by an older copy arriving over it, and a sale the sender has already
filed is taken as filed — provided the sender rebuilt the batch after filing it.

**What is not.** Three shapes:

- **A batch recomputed against a refreshed view of the receiver.** The sender leaves out what the
  receiver already has, so the news that the sender has since filed one of them never travels, and the
  receiver files it itself. `refreshed-sender:1`.
- **A batch taken while the sender is part-way through filing** carries a sale marked as being filed
  right now, which the rig's minimal filing run never picks up, so it sticks — and one sale is filed
  twice. **The real drain is slower rather than stuck**: it resets a sale left that way for more than
  five minutes (`recoverStaleClaims`, `packages/fiscal-verifactu/src/drain.ts`) and files it again.
  That difference is a **model gap**, read from the code on 2026-09-17 rather than run.
- **Replaying an unchanged earlier batch after the sender has filed.** This one is **not part of S2's
  recorded run**: it was run as a variant by the review seat, in the position S2's own Part B occupies,
  and the receiver filed the sale a second time. It is here because it bounds what "a re-sent batch is
  safe" means — safe so long as the sender rebuilt the batch after filing.

**The controls double-file in both directions**: with terminal-state-wins removed the receiver
regresses three sales and re-files them; with the apply made insert-only, two.

**What the FAIL costs against the real system — read, not run.** AEAT refuses a record it already holds
with error 3000, per record, and `resolveEstadoEfectivo`
(`packages/verifactu/src/xml/parse-suministro.ts`) already reads 3000 plus `Correcta` as accepted, so
the receiver's copy is marked filed and its chain carries on. **Every second filing S2 counts is, against
the real endpoint, a wasted call rather than a record filed twice.** Two limits on that reading, stated
because they are what would make it wrong: it compares no content when AEAT says `Correcta`, and it is
safe here only because every duplicate this rig produces is a verbatim same-identity copy. **A third,
found by following the call chain into the drain rather than stopping at the parser**: the parser
classifies a 3000 four ways, and the drain reads three of them as filed — `Correcta` directly;
`AceptadaConErrores` as an accept carrying a warning incident (`drain.ts`: "Still an accept … The record
IS stored by AEAT"); and an unknown or absent duplicate state by consulting AEAT and comparing the hash,
which for a verbatim copy matches and lands on accepted. The fourth, `Anulada`, does not: that identity
is burned and the record halts. So the reading holds for a verbatim same-identity copy in three of the
four cases, and the annulled one is a halt rather than a wasted call. A *different*
record filed under a reused invoice number is a different case, and this rig does not model it. Both
facts were established by reading the compliance findings and the code, and no live resend of an
identical record has been observed.

**And the designed order already removes these sequences.** Decommission the old primary, *then*
promote the secondary (topology design §5.2, owner 2026-09-17), so two nodes never file at once. A
fenced sender cannot file after it has started handing over — and that is what Parts B and D and the
second half of Part E all depend on, which is every shape above. **That is an argument from the design,
not a measurement**: nothing in this rig fences a sender, so no run here shows the fence removing
them.

**Why the obvious follow-up was dropped.** "Make the stub refuse a repeat the way AEAT does" measures
nothing: such a stub is idempotent by construction, so the double counter reads zero whichever way the
loop behaves — both answers look alike. That was not reasoned; the review seat ran it, and S2 still
failed, on a control assertion outside the submit callback.

**How far the FAIL was pushed.** Parts A, B and C's assertions were driven by eleven mutations of the
model, Parts D and E by four more, each applied alone and the scenario run whole. Two limits on that,
both recorded in the package README rather than in the scenario: **seven of its assertions were not made
to fail by any mutation tried** — preconditions, and whole-ledger backstops that a sharper assertion
always reaches first — and **no single mutation of `src/model.ts` returns S2 to PASS on its own**. That
last one is narrower than it sounds: the README also records a review seat reaching PASS with two
changes together, so it identifies no single fix rather than showing there is none.

### S3 — a copied replica equals a direct stream · critical · **PASS**

**Criterion.** A replica copied from one prefix of the store to another must restore the same database
as the prefix litestream streamed to directly.

**What passed.** The box sells under a **real litestream daemon** and keeps selling until the store has
actually deleted a file it was holding — an outer deadline over a real listing, never a sleep — so the
deletion case genuinely arises. Its database is then deleted from disk and the replica copied into a
destination that already holds a **different venue's** replica. With deletions propagated, the restore
is the same file bytes, the same ledger rows compared field by field against what the box wrote, the
same chain tips, and SQLite calling both files intact.

**The control** is the identical recipe with deletion propagation off, driven through Part A's own
comparison. It restores the **other machine's nine rows**, with litestream exiting 0 and raising
nothing; what refuses it is SQLite calling the mixed file damaged (`row 1 missing from index
sqlite_autoindex_chain_head_1`). So the claim is narrower than "a copy equals a stream": **a copy
equals a stream when the copy is a mirror**, and an additive copy onto a dirty destination silently
restores whatever the leftovers win.

**The plan's own control does not bite on this pin, and that is recorded rather than hidden.** Where the
leftovers are the same database's own compacted-away files, the restore comes back identical, because a
replica file's name carries the transaction range it covers — putting one back under its old name puts
the same range back twice. That is Part C, which decides nothing.

**What S3 does not establish.** Whether litestream ever writes **different bytes under a key it has
already used** — the one case that would make the same-lineage half unsafe. Nothing about an empty
destination, since both copies land on a dirty one. Nothing about the cloud generation or the store
pointer.

**Two things the rig needed on the way**, both now in the harness for every later scenario: litestream
deletes replica files only once four of its global settings are turned down — on the defaults, the box
wrote 131 replica files in two minutes and litestream removed none, which is the negative control for
that claim; and writing to a
database while a litestream daemon reads it surfaced a "database is locked" flake, so nodes now set a
busy timeout **and** begin write transactions immediately — each measured to be insufficient alone, and
the refusal counts move run to run.

### S4 — a box offline for days · not critical · **MEASURED**

A measurement, not a pass or a fail. Thirty modelled days of selling — 7500 sales at an **assumed** 250
a day — against a box whose store is unreachable, beside a control arm that differs **only** in whether
the store can be reached.

**Three results.**

1. **The cashier is fine.** On the recorded run, p95 **0.315 ms** and p99 **0.446 ms**; across every
   run recorded here and in the package README, p95 between 0.297 and 0.333 ms and p99 between 0.420
   and 0.528 ms — against the pglite bench's 150 ms and
   400 ms bars — two to three orders of magnitude clear. **The evidence for "no drift as the log grows"
   is inside the run**: the last modelled day's p95 (0.196 ms) is below the first's (0.403 ms), with
   the log having grown to 308 MB in between. Nothing here extends that beyond 7500 sales — an earlier
   draft cited a longer probe, and it is gone because its output was never recorded anywhere a reader
   could check.
2. **The log grows linearly and is bounded only by how long the box stays offline** — about **41 KB a
   sale**, 308 MB over 7500 sales, roughly **104 offline trading days per GiB**. It holds about **80x**
   the data a checkpoint then writes into the database. The prototype spec's example ceiling — "a small
   multiple of the streamed data" — is therefore **not met**, and the row says so
   (`spec-small-multiple-ceiling=not-met`) rather than quietly substituting a bar that passes. **The
   control is what makes this a fact about being offline**: with the store reachable, litestream
   checkpoints the log and it plateaus at ~21 MB.
3. **We cannot reclaim that space while an OFFLINE litestream is attached** — the condition is
   attached AND unable to reach its store, since a reachable daemon checkpoints the log itself, which
   is what the control arm shows. Our own
   `PRAGMA wal_checkpoint(TRUNCATE)` blocked for **seconds** — 12.4 s on the recorded run, and 6.8 s to
   12.4 s across every run recorded here and in the package README — answered busy, reported 4 against a
   log figure of about 75,000, and
   left the file exactly the size it was. With the daemon gone the same call took milliseconds and
   truncated the log to nothing. Read that as seconds against milliseconds: the durations are not
   stable, and what SQLite's three return values mean is not something this rig established. That is
   topology risk 9's "put our own process on the sale path", measured rather than assumed.

**And risk 9 is wider than it was written.** It is stated as conditional on `wal_autocheckpoint = 0`,
and it is not. With an offline daemon attached, dropping that pragma changes nothing, because SQLite's
own automatic checkpoint is refused exactly the way ours is (a 2x2 probe: ~41 KB a sale either way while
attached; with the daemon detached the pragma does bite, ~41 KB a sale with it against 558 bytes
without). **A slice-2 design hoping to bound the log by changing that setting has nothing to change
while the daemon is attached.**

**What S4 does not establish.** That litestream *tried and failed* — the scenario only observes that the
daemon stays up. A probe outside the rig did read the log, and litestream 0.5.17 does try and does fail,
but it logged its first sync error only after **116 s** in one run and **125.6 s** in another — not a
constant, and neither run establishes what sets it. An S4 run lasts about half a minute, which is
arithmetic over the recorded row rather than a measured wall time, so **that line never appears within a
run, and its absence is evidence of nothing**. Anything that turns on elapsed time: the load is volume; thirty modelled days pass in half a
minute. Anything about the real ledger's cost per commit: 41 KB a sale is this rig's own model at
SQLite's default page size, not `packages/fiscal-verifactu`'s schema — the same load at an 8192-byte page
grew linearly and sat over the per-sale ceiling throughout, so a breach can equally mean a wider page or
a wider schema. That a longer offline stretch stays linear: the run stops at 7500 sales, and days-per-GiB
extrapolates the measured rate. And a disk budget: no partition size is recorded anywhere in this
repository. **250 sales a day is an assumption nothing in this repository measures**, and the row says so
(`day-rate=assumed-not-measured`).

### S5 — the residual natural-key clash · not critical · **PASS**

**Criterion.** The one clash the design resolves by a human skip — a supplier invoice number typed on
both machines during a partition — must be detected and reported, the offending row skipped, and every
other row in the hand-over applied.

**What passed.** 13 rows applied, 1 clash reported; a retry reports the same clash and applies nothing
new. **Two controls**, each reproducing one of the two failures the criterion rules out: a silent drop
applies the rows and reports no clash, and an unisolated apply lets the database's own uniqueness error
refuse the whole hand-over, holding none of the three ledger rows. A third arm is S5's own last
assertion rather than a control: a refusal that is *not* a uniqueness violation must not be swallowed as
a clash. The error-classification rule was proved by deletion twice — removed
altogether, and widened to accept any constraint code.

**What S5 does not establish.** Only a uniqueness refusal is a shape this rule knows; anything else is
rethrown and takes the batch down with it, and the error code it matches on is pinned to SQLite 3.53.4
under node v26.7.0. One branch of the apply — the fallback that skips a supplier invoice the receiver
already holds by primary key — is checked by nothing: **deleting it leaves S5 passing**, because no
scenario here ships that case.

### S6 — the store's conditional write · critical · **PASS**

**Criterion.** Of N racers writing from the same version handle, exactly one succeeds and the rest are
rejected **by the store**, not by our code.

**What passed, on MinIO** `RELEASE.2025-09-07T16-13-09Z`: create-only writes are supported
(`create-only=true`) and of eight racers claiming create-only **exactly one** won (`race=1/8`). **The
control** is the same race with no condition attached, where all eight are accepted
(`unfenced=8/8`) — without it, "one winner" could equally mean the store refuses repeated writes to
that key for some reason of its own, and both answers would look alike.

**Two limits the scenario states about itself.** The pair establishes **conditional against
unconditional acceptance** — it does **not** show that the requests overlapped on the wire, which it
cannot show either way, since an unconditional write is accepted whether or not anything else is in
flight. And `if-match=refuses-stale` is **recorded, not asserted**: nothing in this rig turns on
compare-and-swap, because S1's fence claims a key create-only. The product's fence is the
compare-and-swap one, which is why the value is written down.

**One flake, recorded rather than smoothed over.** S6 failed once during S1's mutation runs with its
message lost, then passed eight consecutive solo runs; all seven whole-suite runs taken for this note
passed.
If a later run sees it again, capture the whole table and stderr rather than re-running to green.

### LS — the litestream foundation · not critical · **PASS**

Not a statement about the failover loop: it establishes that the rig can find the pinned binary, point it
at the store, upload a database, keep streaming one as it is written, and rebuild it from the store
afterwards. Its three parts were each proved by mutation. **The control** is a restore with no backup in
the store, matched on **litestream's own missing-backup words** rather than on a non-zero exit — an
earlier shape of that control accepted any error message, so a litestream that could not be run at all
was being recorded as a litestream that refused.

Four things it measured that the loop scenarios would otherwise re-derive: restoring refuses a non-empty
output file unless forced and writes no SQLite sidecar files of its own; a restore works with the source
database absent, which is what makes it evidence about the store; litestream writes its ordinary log to
standard output and its errors to standard error; and no write-ahead-log setting is needed first, because
litestream switches the database itself.

### RUNNER — the runner's own contract · critical · **PASS**

Eight cases over the exit rule, plus the shape of both outputs. It is marked critical although it is not
one of the spec's five fiscal-safety scenarios, for one reason: **a wrong exit rule makes every other
row's reporting untrustworthy**, because a run's exit code is what an unattended caller reads instead of
the table.

### smoke — the harness is up · not critical · **PASS**

The store round-trips, SQLite opens, the model advances a chain, and four mutations of an append-only row
are refused.

---

## The exit code, and what it means

`scenarios` exits **non-zero only when a scenario marked `critical` has the verdict `FAIL`**. `MEASURED`
and `SKIPPED` never fail a run, and neither does a non-critical `FAIL`. A scenario that **throws** is
recorded as a critical FAIL whatever its id, because a harness that broke mid-scenario never got as far
as saying what it was measuring. The critical set is the spec's five — S0, S1, S2, S3, S6 — plus the
runner's own self-check.

**A critical `SKIPPED` exits 0, and that is deliberate**: a skipped scenario is UNPROVEN, which is a fact
for this note rather than a broken premise. Which is why the next line matters.

**Nothing here has been skipped.** All ten rows above ran. Three scenarios *can* report SKIPPED when the
pinned litestream binary is absent: S0 and S3, the two CRITICAL ones, each of which says in its own row
that it is UNPROVEN until `setup:litestream` has been run, and `LS`, which is not critical. None of the
three did on any of the seven recorded runs. S4 does not skip without
the binary: it drops the daemon, the control and the container, runs the SQLite half alone, and says so
in its row. **If a future run reports SKIPPED for a critical scenario, that scenario is UNPROVEN and this
note's verdict for it does not carry over.**

The rule lives in one place, `src/runner-contract.ts`, and `src/scenarios/s_runner_contract.ts` drives it
over a table of cases so it cannot drift silently. `--json` prints the same run as one parseable
document — the rows verbatim, the ids of the critical failures, and the exit code, which a piped run's
own exit status would otherwise lose. Driven on a real whole run, 2026-09-18: `scenarios --json`
exited **1**, wrote `CRITICAL failure: S2` to stderr, and its stdout parsed whole into one object of ten
rows with `criticalFailures: ["S2"]` and `exitCode: 1` — the same value the process exited with.

**Every row's `detail` is carried verbatim as a string, and the dump parses none of them.** Their shapes
are not uniform: S4, S6 and `RUNNER` are pure `key=value` lists; S0, S3 and `LS` are mostly that; S1 and
S5 group `key=value` pairs under labels; `smoke` is one short sentence; and **S2's is English prose** —
ten `key=value` tokens in a hundred and eleven. `docs/backlog.md` named this task as where that shape
should be settled, because the dump would be built from those strings. It is not built from them: it
carries them, so the consequence that motivated the change does not arise, and re-wording the one
negative result this gate produced would have rewritten its recorded run for no measurement. The
suggestion stands for whoever picks the rig up next.

**The hedge, because it is the kind a failing test can never restore.** The self-check drives
everything in `src/runner-contract.ts` and **nothing in `main()`** — and `main()` decides four things
no scenario reaches: which files count as scenarios, handing `process.argv` to the renderer, the
summary line written to stderr, and turning the computed exit code into the process's own exit status.
Two of the four were measured rather than reasoned about. Cutting the argument hand-off made `--json`
print the table with the self-check still reporting PASS (2026-09-18). Replacing
`process.exit(exitCode)` with `process.exitCode = 0`, against a run holding a critical FAIL, made the
process exit **0** while the table showed the failure and the self-check again reported PASS
(2026-09-19). The other two are named because the same argument covers them: a discovery filter that
silently matched a subset would print a short table and exit 0, and the stderr summary is what an
unattended caller reads. A scenario cannot reach any of the four without spawning the runner, which
would run the whole suite. **So a caller trusting this rig's exit code is trusting `main()`, which
nothing drives.** This hedge has been widened twice, each time by a reviewer who found it too narrow;
read "the self-check covers the runner" as false.

---

## What this gate does NOT establish

Stated together, because each is something a reader would otherwise assume the green rows covered:

- **The real schema.** Everything here runs against the rig's own model, not
  `packages/fiscal-verifactu`'s tables. Slice 1's own tests, over the real ported schema, are where the
  full-schema loop is proven. This gate de-risks the mechanism, not the port.
- **The production object store.** Every store result is MinIO's.
- **Litestream beyond 0.5.17 on darwin/arm64.**
- **The cloud's own generation, and the store pointer.** Nothing streams the cloud's generation and no
  node restores by following `current.json`. S0 handed that case to S3; **S3 did not take it, and neither
  did S4, so it is unowned.**
- **Fencing a returning node.** No scenario stops a node selling or filing; the decommission-then-promote
  rule the topology design §5.2 states is unmodelled.
- **Whether litestream ever writes different bytes under a key it has already used** (S3).
- **Elapsed time, and anything that turns on it** (S4).
- **Two branches of the litestream wrapper** — the sweep that kills a stray daemon if the runner dies,
  and its refusal to run against a configuration file it did not write — are driven by no scenario. They
  are there because the failure they prevent is silent. A later task should pin them or delete them.

## Standing obligations

- **Re-run S6 against the real store when Waitron Cloud picks one**, and against any self-host target the
  product claims to support. An older S3-compatible target may lack the conditional write, and without it
  the promotion tie-break is unsafe (topology §12.2, risk 11). This is the obligation the prototype spec
  §5 asks this note to record, and it is the one result here that a store choice can invalidate outright.
- **Build the restart reset.** A node must, on restart and before it files anything, reset every sale it
  inherited in the "being filed right now" state, with no five-minute wait. That covers the copy a
  promoted node inherited through the stream; a sale arriving later in a hand-over is still the
  five-minute reset's job, because a reset that runs at startup cannot see one delivered afterwards. It
  is written into the topology design §5.2 and it is **not built**. Today the only reset of a sale left
  that way is `recoverStaleClaims`'s five-minute one in `packages/fiscal-verifactu/src/drain.ts`, plus
  the backoff that returns a sale whose submission threw — read on 2026-09-17, not run.
  **2026-09-23: built** — `resetInFlightClaims` (`packages/fiscal-verifactu/src/drain.ts`) returns every `enviando` row to `pendiente`, raising `incidencia`, and `resetBeforeFirstDrain` (`apps/server/src/restart-reset.ts`) runs it before a boot's first filing pass, and again only if that attempt failed.
- **Own the cloud-generation/pointer case, or write down that nothing covers it.**
- **Measure the sales-a-day rate** before quoting S4's days-per-GiB at anyone; 250 is an assumption.
- **Re-run everything on a litestream or MinIO bump.** The verdicts do not carry across a version.

## What this gate leaves to be built

Two design decisions this measurement hands to slice 2:

- **A box that has been offline for days cannot have its write-ahead log reclaimed while litestream is
  attached, and the pragma the risk names is not the lever.** The only thing that reclaimed it here was
  stopping the daemon first; whether anything else would was not tested. Doing that on the sale path is
  the thing risk 9 exists to forbid, so bounding that log is a design question slice 2 inherits open.
- **The fence-before-ship rule removes S2's failing sequences** — an argument from the design, since
  nothing here fences a sender — so whichever slice turns promotion on owns it, together with the
  restart reset above. **2026-09-23:** the restart reset is built — `resetInFlightClaims` (`packages/fiscal-verifactu/src/drain.ts`), see `docs/backlog.md`.

## Slice 2 measurements

**Date:** 2026-09-23. **For:** [slice 2 spec §8.1](../superpowers/specs/2026-09-23-sqlite-slice2-stream-and-cold-restore-design.md).
**Pins:** the table above, plus node:26-slim for measurement 5. **Reproducer:** `bench/sqlite-failover`'s
`probe:*` scripts (the package README, "Slice 2 probes"). Every figure is one run; nothing here should
be quoted as a single number where S4's spread already shows these move run to run.

Every probe ran against the rig's model schema (`src/model.ts`), not `packages/fiscal-verifactu`'s,
and against the pinned local MinIO, not the owner's bucket. Each was first run once with its code
altered so that it had to print its failing case; that line is quoted beside the real one. The probes
ran one at a time.

### What later tasks read

| value | recorded | read by |
| --- | --- | --- |
| `RESTART_RESYNCS` | `RESTART_RESYNCS = true` (measurement 1) | Task 6: same generation after a pause, or a new one |
| `AUTOCHECKPOINT_OFF_NEEDED` | `AUTOCHECKPOINT_OFF_NEEDED = false` (measurement 2; the peak comparison behind it is close, see below) | Task 6: whether the venue connection sets `wal_autocheckpoint = 0` while streaming |
| `TRUNCATE_THRESHOLD_OFFLINE` | `D-crossed-threshold=true D-shrank-after-threshold=false D-max-commit-ms=6.861` (arm 2b; peak side file 621,090,032 bytes; past the threshold for the last three of fifteen rounds only) | Task 6: the side-file limit |
| `LINUX_BINARIES_RUN` | `LINUX_BINARIES_RUN = true`; `litestream-0.5.17-linux-x86_64.tar.gz` sha256:cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d, `litestream-0.5.17-linux-arm64.tar.gz` sha256:f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5 (measurement 5; amd64 under emulation) | Task 6: the image's download-and-check step |
| restore points | on the compressed schedule, every sampled boundary newer than the oldest surviving full copy restored, at level-1 granularity, and nothing older did (measurement 3); extrapolated to production: 30-second points back to the oldest surviving daily full copy | the spec's promise about going back in time (docs) |
| restore time | 4,058 / 4,107 / 4,092 ms at 5,000 × 171 KiB images; 7,345 / 51,712 / 9,394 ms at 5,000 × 330 KiB (measurement 4, local store, no network) | the rebuild screen's wording (docs) |

**Litestream configuration lines each probe used, and whether it was seen taking effect** (for Task 6's
config writer). Every probe wrote the rig's base shape — top-level `access-key-id: ${VAR}` and
`secret-access-key: ${VAR}`, then one `dbs:` entry with a singular `replica:` whose `url` carries
`endpoint`, `region=us-east-1` and `force-path-style=true` — and every upload and restore below used
that shape.

- Measurement 3 added, at the top level, `snapshot:` with `interval: 60s` and `retention: 180s`,
  `levels:` with three `interval:` entries (`2s`, `10s`, `30s`), `l0-retention: 2s` and
  `l0-retention-check-interval: 1s`. The `snapshot:` block was **seen taking effect**: 11 full copies
  (level 9) were seen in 630 seconds with it, against 1 with it removed, and the oldest surviving full
  copy was 150 seconds old against a 180-second retention. The `levels:` block was seen taking effect
  by count: 313 level-1, 62 level-2 and 20 level-3 files were seen in 630 seconds (the listing was
  sampled every five seconds), close to the 315, 63 and 21 its intervals allow (arithmetic) and far
  from what the documented 30s/5m/1h defaults would allow (21, 2 and 0). No run removed `levels:` on
  its own, so that reading rests on the counts.
- Measurement 4 added `snapshot:` with the production `interval: 24h` and `retention: 168h`. The store
  held one full copy at the end, which is all a 24-hour interval allows in a run of minutes; nothing
  else about those two lines was observed.
- Measurement 5's TLS check put `access-key-id` and `secret-access-key` inside the `replica:` block
  instead of at the top level. Amazon S3 answered `InvalidAccessKeyId` to the made-up key, so the
  binary sent that key: the per-replica form was read.
- Measurements 1 and 2 added no lines. Measurement 2's arm B switched automatic folding off with
  `PRAGMA wal_autocheckpoint = 0` on SQLite's side and read `0` back; that is not a Litestream setting.

### 1 — restart after an outside fold-back

**Failing would print:** `RESTART_RESYNCS=false … restore-complete=false missing=21-80` (or a dead daemon).
**Control:** the store read before the restart held only the first 20 sales.
**Failing case, printed on purpose** (phase 4 given no daemon, so nothing could upload after the fold-back):

```
| m1-restart-after-foldback | RESTART_RESYNCS=false | version=0.5.17 offline=ECONNREFUSED held-checkpoint-busy=1 fold-back-busy=0 second-fold-back-busy=0 control-before-restart-rows=20 control-expected=20 restore-complete=false restored-rows=20 expected=80 missing=21-80 restore-attempts=112 integrity=ok daemon-alive=false daemon-exit=0 objects-before={"0000":{"count":2,"bytes":10260},"0001":{"count":1,"bytes":2203},"0009":{"count":1,"bytes":2203},"opened.json":{"count":1,"bytes":45}} objects-after={"0000":{"count":2,"bytes":10260},"0001":{"count":1,"bytes":2203},"0009":{"count":1,"bytes":2203},"opened.json":{"count":1,"bytes":45}} marker-survived=true log-problems=0 first-problem=none |
```

**Printed:**

```
| m1-restart-after-foldback | RESTART_RESYNCS=true | version=0.5.17 offline=ECONNREFUSED held-checkpoint-busy=1 fold-back-busy=0 second-fold-back-busy=0 control-before-restart-rows=20 control-expected=20 restore-complete=true restored-rows=80 expected=80 missing=none restore-attempts=3 integrity=ok daemon-alive=true daemon-exit=0 objects-before={"0000":{"count":2,"bytes":10249},"0001":{"count":1,"bytes":2203},"0009":{"count":1,"bytes":2203},"opened.json":{"count":1,"bytes":45}} objects-after={"0000":{"count":3,"bytes":48455},"0001":{"count":1,"bytes":2203},"0002":{"count":1,"bytes":2203},"0009":{"count":1,"bytes":2203},"opened.json":{"count":1,"bytes":45}} marker-survived=true log-problems=0 first-problem=none |
```

The run: 20 sales streamed to MinIO; the daemon restarted against a closed port and 20 more sales,
during which our own `PRAGMA wal_checkpoint(TRUNCATE)` answered busy (`held-checkpoint-busy=1`, S4's
reading, so the offline daemon did hold the file); the daemon stopped, our fold-back completed and
emptied the side file; 20 more sales with nothing attached and a second fold-back; then the daemon
restarted against MinIO and 20 more sales. The restore after the restart held all 80 sales in order
with `integrity=ok`, the daemon was still running, and it logged no WARN or ERROR line. So on the pin,
sales that existed only in the database file when Litestream restarted were uploaded, into the same
generation prefix. `objects-after` shows how: level 0 went from 2 files (10,249 bytes) to 3 (48,455
bytes) and a level-2 file appeared, while level 9 stayed at one file of 2,203 bytes — **no fresh full
copy was uploaded at level 9**, the missing sales travelled in a level-0 file. The spec's §8.1 wording
also names "Litestream exits 0 having uploaded no fresh full copy" as failing: the daemon did not exit,
and no full copy was taken, yet the restore was complete. The generation's `opened.json` marker
survived, and no WARN or ERROR line was logged. `daemon-exit=0` is the exit code of the probe's own
stop at the end (read from the probe: the field is filled after its `kill()`), not a death.
Not established: a pause longer than seconds, batches larger than 20 sales, and what Litestream's own
directory beside the database (`.venue.db-litestream/`) held or grew to — it was not read.

### 2 — automatic fold-back with the bucket reachable, and 2b — offline past `truncate-page-n`

**Failing would print:** `AUTOCHECKPOINT_OFF_NEEDED=true`, because arm A's restore is incomplete, its
integrity check is not `ok`, Litestream logged a WARN/ERROR line, A's peak side file is larger than
B's, or A uploaded more than twice B's bytes.
**Control:** arm C, default folding with the store unreachable, must grow at least 4096 bytes a sale,
or the probe cannot see growth and prints `VOID`.
**Failing case, printed on purpose** (arm C pointed at the reachable store):

```
| m2-autocheckpoint | VOID | version=0.5.17 sales=7500 rounds=15 idle-ms=1500 A-autocheckpoint=1000 A-peak-wal=20830752 A-restore-complete=true A-integrity=ok A-store-bytes=10147789 A-log-problems=0 A-first-problem=none A-p99-ms=0.517 B-autocheckpoint=0 B-peak-wal=21152112 B-restore-complete=true B-integrity=ok B-store-bytes=9325423 B-log-problems=0 C-wal-per-sale=2790 C-daemon-alive=true D-sales=15000 D-peak-wal=620414352 D-threshold-bytes=497086464 D-crossed-threshold=true D-shrank-after-threshold=false D-max-commit-ms=5.205 D-p99-ms=0.419 D-daemon-alive=true D-log-problems=0 D-wal-by-round=40178272,81732592,122825472,164445712,206362592,248040512,289965632,331058512,372163752,413499712,454942792,496113952,537515832,578930072,620414352 |
```

**Printed:**

```
| m2-autocheckpoint | AUTOCHECKPOINT_OFF_NEEDED=false | version=0.5.17 sales=7500 rounds=15 idle-ms=1500 A-autocheckpoint=1000 A-peak-wal=20958472 A-restore-complete=true A-integrity=ok A-store-bytes=9887370 A-log-problems=0 A-first-problem=none A-p99-ms=0.697 B-autocheckpoint=0 B-peak-wal=21061472 B-restore-complete=true B-integrity=ok B-store-bytes=10314513 B-log-problems=0 C-wal-per-sale=41258 C-daemon-alive=true D-sales=15000 D-peak-wal=621090032 D-threshold-bytes=497086464 D-crossed-threshold=true D-shrank-after-threshold=false D-max-commit-ms=6.861 D-p99-ms=0.545 D-daemon-alive=true D-log-problems=0 D-wal-by-round=40174152,82103392,123830752,164993672,206498552,247801552,289001552,330481712,371768232,413454392,455049912,496328192,537754792,579609872,621090032 |
```

Arms A–C each made 7,500 sales in 15 rounds with a 1.5-second pause after each. With SQLite's default
automatic folding (`A-autocheckpoint=1000`, read back) and the store reachable, arm A restored
completely with `integrity=ok`, logged no WARN or ERROR line, uploaded 9,887,370 bytes against arm
B's 10,314,513, and peaked at 20,958,472 bytes of side file against arm B's 21,061,472 with folding
switched off. **The margin on that last comparison is small**: A came out 103,000 bytes (about 0.5%)
below B here, and 321,360 bytes below B on the failing-case run, whose arms A and B were unchanged. Two
runs put A below B; a run where A came out above B would print `true` by the probe's own rule. Arm C
grew 41,258 bytes a sale, about the rate S4 recorded offline; pointed at the reachable store it grew 2,790
and the line read `VOID`, as intended.

Arm D (2b) made 15,000 sales with default folding and the store unreachable. The side file grew every
round, crossed 497,086,464 bytes (`truncate-page-n`'s documented default of 121,359 pages at 4096
bytes — the default of the current release's documentation, not read from the pin) in round 13, and
was larger again in rounds 14 and 15, ending at 621,090,032. It never shrank; the longest commit was
6.861 ms and p99 0.545 ms; the daemon stayed up and logged no WARN or ERROR line. What that does NOT
establish: the file was past the threshold only for the last three rounds, a few seconds (each round
is its sales plus a 1.5-second pause), so what Litestream's emergency checkpoint does over minutes or
hours past the threshold was not measured; and the whole arm lasts about half a minute by arithmetic,
less than the 116 seconds S4's probe waited before litestream logged its first sync error, so the
absence of log lines says nothing.

### 3 — which restore points survive

**Failing would print** (the probe is a measurement, so these make it `VOID`):
`snapshot-interval-applied=false`, `unmatched-keys>0`, `beyond-refused=false`, or `latest-rows`
differing from `sales`.
**Control:** the same run with the `snapshot:` block removed must read `snapshot-interval-applied=false`.
**Failing case, printed on purpose** (`snapshot:` block removed):

```
| m3-restore-points | VOID | version=0.5.17 schedule={"l1":2,"l2":10,"l3":30,"snapshot":60,"retention":180,"l0Retention":2} run-s=630 sales=2492 txid-flag-on-pin=true unmatched-keys=0 first-unmatched=none l9-files-seen=1 snapshot-interval-applied=false oldest-surviving-l9-age-s=630 retention-applied=false L0-seen=378 L0-surviving=0 L0-oldest-surviving-age-s=null L1-seen=313 L1-surviving=313 L1-oldest-surviving-age-s=629 L2-seen=63 L2-surviving=63 L2-oldest-surviving-age-s=627 L3-seen=21 L3-surviving=21 L3-oldest-surviving-age-s=617 latest-rows=2492 L1-surviving-boundaries=629s:rows0,423s:rows820,215s:rows1642,7s:rows2464 L1-gone-boundaries=none L2-surviving-boundaries=627s:rows4,417s:rows835,217s:rows1627,7s:rows2456 L2-gone-boundaries=none L3-surviving-boundaries=617s:rows4,407s:rows835,227s:rows1555,17s:rows2385 L3-gone-boundaries=none L9-surviving-boundaries=630s:rows0 L9-gone-boundaries=none beyond-refused=true |
```

**Printed:**

```
| m3-restore-points | MEASURED | version=0.5.17 schedule={"l1":2,"l2":10,"l3":30,"snapshot":60,"retention":180,"l0Retention":2} run-s=630 sales=2486 txid-flag-on-pin=true unmatched-keys=0 first-unmatched=none l9-files-seen=11 snapshot-interval-applied=true oldest-surviving-l9-age-s=150 retention-applied=true L0-seen=310 L0-surviving=0 L0-oldest-surviving-age-s=null L1-seen=313 L1-surviving=102 L1-oldest-surviving-age-s=208 L2-seen=62 L2-surviving=20 L2-oldest-surviving-age-s=200 L3-seen=20 L3-surviving=6 L3-oldest-surviving-age-s=180 latest-rows=2486 L1-surviving-boundaries=208s:refused,140s:rows1930,74s:rows2190,6s:rows2458 L1-gone-boundaries=629s:refused,490s:refused,350s:refused,210s:refused L2-surviving-boundaries=200s:refused,140s:rows1922,70s:rows2198,10s:rows2434 L2-gone-boundaries=620s:refused,480s:refused,350s:refused,210s:refused L3-surviving-boundaries=180s:refused,120s:rows1961,90s:rows2079,30s:rows2324 L3-gone-boundaries=600s:refused,480s:refused,330s:refused,210s:refused L9-surviving-boundaries=150s:rows1894,90s:rows2131,30s:rows2367 L9-gone-boundaries=630s:refused,510s:refused,330s:refused,210s:refused beyond-refused=true |
```

The run used a compressed schedule — level 1 every 2 s, level 2 every 10 s, level 3 every 30 s, a full
copy every 60 s, 180 s kept — which keeps the order of slice 2's production intervals (30 s, 5 min,
1 h, a day, 168 h) but not their ratios, for 630 seconds with a sale about every 250 ms. The pin has `-txid`
on `restore`. At the end, restores were tried at the last transaction of four files per level and per
group (still in the store, or removed), spread by age:

- every sampled point **younger than the oldest surviving full copy** (150 s) restored — level 1 at
  140, 74 and 6 s; level 2 at 140, 70 and 10 s; level 3 at 120, 90 and 30 s; full copies at 150, 90
  and 30 s;
- every sampled point **older** than it was refused, both from files already removed (210–630 s) and
  from files still in the store (level 1 at 208 s, level 2 at 200 s, level 3 at 180 s);
- a restore past the newest transaction was refused (`beyond-refused=true`), so a refusal is how the
  pin answers "no such point".

Level-1 files were not removed once level 2 had merged them: level-1 points 140 seconds old were
still in the store and restored, although level-2 files of the same age were there too and the
10-second level-2 interval had passed many times since. They were removed by the
retention window, together with full copies and higher levels. In the control run, with the default
24-hour retention, every level-1, level-2 and level-3 file seen was still there after 630 seconds. So on this schedule the limit on going back was the oldest surviving full copy, and within it
the finest point was a level-1 boundary. The plan's reading of this probe had expected a level-1 point
to be lost once merged into level 2; that is not what the pin did.

**Extrapolated, not measured:** with the production settings, a restore could reach any 30-second
(level-1) boundary back to the oldest surviving daily full copy, which on this run's pattern (the
oldest full copy between the window minus one interval and the window) would be six to seven days
old; nothing older restores, whatever level files remain. Keeping every level-1 file for 168 hours is
about 20,000 files at 30 seconds (arithmetic). The level-0 files had all gone by the end
(`l0-retention: 2s`), so level-0 granularity was not measured.

### 4 — restore time

**Failing would print:** `VOID` with `verified=false`, when a restored copy does not hold exactly the
source's ledger rows, image count and image bytes.
**Failing case, printed on purpose** (the source's image count raised by one; 10 images of 64 KiB, 2
days of history, 1 restore):

```
| m4-restore-time | VOID | version=0.5.17 sizes=owner-count-measured-size images=10 image-kib=64 history-days=2 sales-per-day=250 day-sales=250 db-bytes=5324904 image-bytes=655360 records=750 initial-upload-ms=46 store-bytes=3990589 store-objects={"0000":{"count":19,"bytes":2131771},"0001":{"count":2,"bytes":976476},"0009":{"count":1,"bytes":882342}} restore-ms=105 integrity-check-ms=2 verified=false |
```

**Printed** (5,000 images at the 171 KiB average of Task 0's ten shrunk photos, then every image at
330 KiB, about the 338 KB largest of them):

```
| m4-restore-time | MEASURED | version=0.5.17 sizes=owner-count-measured-size images=5000 image-kib=171 history-days=365 sales-per-day=250 day-sales=250 db-bytes=931881688 image-bytes=875520000 records=91500 initial-upload-ms=4285 store-bytes=2763368469 store-objects={"0000":{"count":17,"bytes":922995953},"0001":{"count":1,"bytes":920186258},"0009":{"count":1,"bytes":920186258}} restore-ms=4058,4107,4092 integrity-check-ms=256,255,259 verified=true |
| m4-restore-time | MEASURED | version=0.5.17 sizes=owner-count-measured-size images=5000 image-kib=330 history-days=365 sales-per-day=250 day-sales=250 db-bytes=1752470152 image-bytes=1689600000 records=91500 initial-upload-ms=8198 store-bytes=5232635309 store-objects={"0000":{"count":17,"bytes":1745539198},"0001":{"count":2,"bytes":1744422392},"0009":{"count":1,"bytes":1742673719}} restore-ms=7345,51712,9394 integrity-check-ms=391,4571,390 verified=true |
```

Each run built a database of 5,000 random-byte images (random bytes do not compress, as an
already-compressed photo does not) and 91,250 sales (365 days at the assumed 250 a day), uploaded it
in one shot with the production `snapshot:` lines, streamed a day of 250 more sales through a daemon,
and restored it three times, each copy checked against the source. 5,000 is the owner's upper figure
for product images (Reconciliation O2), not a venue's count. At 171 KiB the three restores took 4,058,
4,107 and 4,092 ms and the integrity check 255–259 ms, for a database plus side file of 931,881,688 bytes. At 330 KiB they
took 7,345, **51,712** and 9,394 ms, with integrity checks of 391, 4,571 and 390 ms, for 1,752,470,152
bytes of database and side file; nothing in the run explains the second restore's time, and it was not re-run.

store-bytes is what the store held under the generation, not what a restore read: here it held three
copies of about the database's size (levels 0, 1 and 9), and how much of that a restore downloads
was not measured. So store-bytes is an upper bound on what a rebuild downloads; divide the download
by the venue's line speed for the part this local run leaves out. Since the images are incompressible,
the download is unlikely to be much below `image-bytes` (reasoning, not measured). Not established:
any network, a real photo's bytes, or the real schema.

### 5 — the pinned binary on Linux

**Failing would print:** `LINUX_BINARIES_RUN=false`, with the failing platform's inside line showing
which of `sha256-matches-release`, `version`, `roundtrip-equal`, `control-refused` or `tls` is wrong.
**Control:** the TLS check repeated in bare `node:26-slim`, without `ca-certificates`, should read
`tls=roots-missing`.
**Failing case, printed on purpose** (the expected version changed to `0.5.16`; both inside lines read
`FAIL` with `version=0.5.17`):

```
| m5-linux-binaries | LINUX_BINARIES_RUN=false | host-arch=arm64 base-image=node:26-slim amd64-pass=false amd64-sha256=cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d amd64-tls-control=indistinguishable arm64-pass=false arm64-sha256=f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5 arm64-tls-control=indistinguishable |
```

**Printed:**

```
| m5-inside-x64 | PASS | mode=full uname-m=x86_64 asset=litestream-0.5.17-linux-x86_64.tar.gz sha256=cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d sha256-matches-release=true sha256-in-checksums=true version=0.5.17 roundtrip-rows=3/3 roundtrip-equal=true control-refused=true tls=ok tls-evidence="Error: sync database /tmp/m5-N45StE/tls.db: check database behind replica: get replica position: operation error S3: ListObjectsV2, https response error StatusCode: 403, RequestID: BRDCADN4ZGP08MS4, HostID: oSCqN9LftTB6zHtSKcXQLuqrLcqygg/yKA7a0sXcy3A13PtHAlEypwAQXqRgsDAuwlTHMx0j+kQC95cyj28JJDEtFTv7qpwh, api error InvalidAccessKeyId: The AWS Access Key Id you provided does not exist in our records." |
| m5-inside-x64 | CONTROL | mode=tls-only uname-m=x86_64 asset=litestream-0.5.17-linux-x86_64.tar.gz sha256=cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d sha256-matches-release=true sha256-in-checksums=true version=0.5.17 tls=ok tls-evidence="Error: sync database /tmp/m5-VrWLZ0/tls.db: check database behind replica: get replica position: operation error S3: ListObjectsV2, https response error StatusCode: 403, RequestID: Y7J1J0HBZST5G9VN, HostID: xuX+kqnDpy9bI8KazHcSpxNXY/azlPseu120ScWPmyRJelpSxdXeJD+hbBx3sNRvlk6WDJ9G4Yrr4yEN5XhIcQAAYqcHWXI+, api error InvalidAccessKeyId: The AWS Access Key Id you provided does not exist in our records." |
| m5-inside-arm64 | PASS | mode=full uname-m=aarch64 asset=litestream-0.5.17-linux-arm64.tar.gz sha256=f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5 sha256-matches-release=true sha256-in-checksums=true version=0.5.17 roundtrip-rows=3/3 roundtrip-equal=true control-refused=true tls=ok tls-evidence="Error: sync database /tmp/m5-RkZo4m/tls.db: check database behind replica: get replica position: operation error S3: ListObjectsV2, https response error StatusCode: 403, RequestID: 8JRY1XMQZNEE88K0, HostID: 6zamUhSuGUEzjjwEMHwNPsGuSm8wdlKCjt67sBKR0TDRUfsOO6ZjPk5LmK8tIEP9OhGgsDx8o+HsSMNler3DARmb680iwnKx, api error InvalidAccessKeyId: The AWS Access Key Id you provided does not exist in our records." |
| m5-inside-arm64 | CONTROL | mode=tls-only uname-m=aarch64 asset=litestream-0.5.17-linux-arm64.tar.gz sha256=f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5 sha256-matches-release=true sha256-in-checksums=true version=0.5.17 tls=ok tls-evidence="Error: sync database /tmp/m5-NF7uXe/tls.db: check database behind replica: get replica position: operation error S3: ListObjectsV2, https response error StatusCode: 403, RequestID: GHH0JPC101QXVQ2G, HostID: MricTFyouWDrb6MONRgDnh3TpjUSau894lxRLumN5po9b8emuJMJghNKuaUjxIae9CKgv5z1dc5GA0F0rZo9Pnlw2s0VsggV, api error InvalidAccessKeyId: The AWS Access Key Id you provided does not exist in our records." |
| m5-linux-binaries | LINUX_BINARIES_RUN=true | host-arch=arm64 base-image=node:26-slim amd64-pass=true amd64-sha256=cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d amd64-tls-control=indistinguishable arm64-pass=true arm64-sha256=f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5 arm64-tls-control=indistinguishable |
```

Run in Docker Desktop on the darwin/arm64 host, on `node:26-slim` (the local tag resolved on 2026-09-23 to
`node@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1`) with `ca-certificates`
installed by `apt-get install -y --no-install-recommends`, as `deploy/Dockerfile`'s runtime stage
installs it. **linux/amd64 ran under Docker Desktop's
emulation** (`uname-m=x86_64` inside), so its pass shows a working amd64 build under emulation, not a
run on amd64 hardware; linux/arm64 ran natively (`uname-m=aarch64`). On both, the archive's SHA-256,
recomputed from the downloaded bytes, equalled the release API's digest and appeared in
`checksums.txt`; `litestream version` printed `0.5.17`; three sales round-tripped through a MinIO on
the same Docker network with the source deleted first; a restore from a prefix nothing streamed was
refused with `no matching backup files available`; and a one-shot sync to Amazon S3 with a made-up key
was refused by S3 (`InvalidAccessKeyId`), not by certificate verification. Both digests equal the ones
the plan read from the release API on 2026-09-23 (its Spec problems item 7), so no re-upload was
seen.

**The TLS control did not discriminate** (`tls-control=indistinguishable` on both): bare
`node:26-slim` also reached S3. So this probe does not establish that Litestream used the image's
certificate store. A check outside the probe, the same day: bare `node:26-slim` has no `/etc/ssl`
directory and `dpkg-query` reports `ca-certificates` `not-installed`, on both platforms; and `strings`
on both Linux binaries (downloaded again, same digests) finds `golang.org/x/crypto/x509roots/fallback`
(9 matches each). That is consistent with the binary carrying Go's fallback root certificates, which
would explain the control, but it was not established that those roots verified S3's certificate. The
first native amd64 confirmation is the first CI job that runs the pinned binary.

---

## Reproducing this

```bash
export TESTCONTAINERS_RYUK_DISABLED=true
pnpm --filter @waitron/bench-sqlite-failover setup:litestream   # once per checkout
pnpm --filter @waitron/bench-sqlite-failover scenarios                   # the table; exits 1 on S2
pnpm --silent --filter @waitron/bench-sqlite-failover scenarios --json   # the same run, machine-readable
```

Docker must be running. No scenario runs in CI, by design — the package has no test script, so the
evidence for a result is its recorded run in the pull request that produced it, never a green CI job.
`bench/sqlite-failover/README.md` carries, for most scenarios, the mutations that prove its assertions
and the assertions that no mutation drives. It has such a section for S0, S2, S3, S4, S5, `LS` and
`RUNNER`. **S1, S6 and `smoke` have none** — S1's section states what it does and does not model but
records no mutation — so what drives those three scenarios' assertions is not written down anywhere.
