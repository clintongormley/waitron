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
  **2026-09-23: built** — `resetInFlightClaims` (`packages/fiscal-verifactu/src/drain.ts`) returns every `enviando` row to `pendiente`, raising `incidencia`, and `resetBeforeFirstDrain` (`apps/server/src/restart-reset.ts`) runs it once per boot, before the first filing pass.
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
  restart reset above.

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
