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
pnpm --filter @waitron/bench-sqlite-failover setup:litestream   # once per checkout
pnpm --filter @waitron/bench-sqlite-failover scenarios
pnpm --filter @waitron/bench-sqlite-failover typecheck
```

Docker must be running: most scenarios start their own MinIO container via Testcontainers. S2 and
S5 never do — each models its hand-over between two in-memory SQLite databases, so neither needs a
container or a store. `LS` starts one only once `setup:litestream` has been run: without the pinned
binary it reports SKIPPED before it reaches the store. S0 does the same, and starts ONE container
when it does run: its three runs of the loop share that store and are kept apart by term.

`setup:litestream` downloads the pinned litestream release into the gitignored `.bin/` for this
host's platform. Nothing else installs it, so the scenarios that drive litestream report SKIPPED
until it has been run. `resolveLitestream()` (`src/litestream.ts`) also accepts `$LITESTREAM_BIN` or
a `litestream` on `PATH`, and takes **only** the pinned version from any of the three — every result
this rig records about litestream is a measurement on that pin, so a different build answering the
same calls would be a result attributed to a version that never ran.

### What the `LS` foundation check does and does not drive

Each of its three parts was proved by mutation on 2026-09-18. Most of the mutations below were
applied to `src/litestream.ts` and the scenario re-run; the last two were not — one was scoped to the
control inside the scenario file, and one replaced the binary itself with a stub. Every file was
restored afterwards.

- a `syncOnce` that returns without spawning → the one-shot part fails on "uploaded nothing under
  venues/v1/gen-1-box-a", which is also what a `writeConfig` that ignores its `prefix` fails on;
- a `restore` that copies the database beside it instead of reading the store → the one-shot part
  fails on the copy's `ENOENT`, because that part deletes the source first. With the deletion
  removed as well, the whole scenario reports PASS — so that deletion is the only thing separating
  "read the store" from "copied the file next door";
- a `restore` that corrupts one payload after a successful restore → the one-shot part fails, so the
  comparison is of contents and not of a row count;
- a `replicate` that spawns the one-shot instead of the daemon → the daemon part fails at its
  deadline having seen 2 of 4 rows. **An earlier shape of that part passed under this mutation**: it
  wrote the extra rows immediately after spawning, and a one-shot syncs late enough to pick them up,
  so both answers looked alike. Waiting for the first sync to be visible before writing again is
  what fixed it;
- a `restore` that leaves a partial file behind when litestream refuses → the control fails on "a
  refused restore writes no database". Pre-creating an EMPTY file does not fail it, because
  litestream removes an empty output file itself;
- a `restore` that rejects for an unrelated reason (`spawn ENOENT`) in the control only → the control
  fails on "the refusal is litestream's missing-backup answer, not a failure to run it". **An earlier
  shape of the control passed under this mutation**, because it accepted any non-empty error message:
  a litestream that could not be run at all was recorded as a litestream that refused. It now matches
  the missing-backup words and prints them in the verdict;
- a stub binary whose `restore` sleeps → the scenario fails at its deadline instead of hanging. **An
  earlier shape had no bound at all**: the 60-second poll was still unsettled at 65 seconds and the
  scenario's cleanup had not run, so the MinIO container stayed up too. Each litestream call now
  carries its own timeout and kills its child, and it settles on the timeout rather than waiting for
  the child's `close` event — that event fires when the stdio pipes close, so a killed child whose own
  children inherited them never produces it.

Parts of `src/litestream.ts` are driven by no scenario, and are there because the failure they
prevent is silent rather than because anything measured them: the `process.on("exit")` sweep that
kills a `replicate` child the scenario's `finally` never reached, and `childEnv`'s refusal to spawn
against a config `writeConfig` did not write (which would otherwise reach litestream with empty
credentials and come back as a store error). A later task that needs one of them should pin it or
delete it.

**`scenarios` currently exits 1 on a clean tree**, because S2 is a critical scenario whose verdict is
FAIL — a recorded result, not a broken harness. See "What S2 measures, and what it does not" below. A
later task reading its own run's exit code has to account for that.

`TESTCONTAINERS_RYUK_DISABLED=true` is required locally (`CLAUDE.md` §4), and it turns off the reaper
that would otherwise clean up after an interrupted run. Scenarios run one at a time and each that opens a store stops it
in a `finally`, so an interrupt strands the container of the scenario in flight, not one per
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
- **Litestream:** `v0.5.17`, downloaded by `setup:litestream` from the GitHub release for that tag.
  The asset is matched on its full name, never a substring: the release lists both
  `litestream-0.5.17-darwin-arm64.tar.gz` (the CLI) and `litestream-vfs-v0.5.17-darwin-arm64.tar.gz`
  (a different artefact), so `includes("darwin-arm64")` matches two. Only darwin/arm64 has been
  downloaded and run.

The rig **establishes** external behaviour by observing it rather than asserting it: what MinIO's
conditional write does (S6, plan Task 2) and how Litestream lays out and restores a replica (plan
Task 6) are each measured on these exact versions. S6's half has been run —
`pnpm --filter @waitron/bench-sqlite-failover scenarios`, 2026-09-17, →
`create-only=true if-match=refuses-stale race=1/8 unfenced=8/8`. The Litestream half has been run too
— `pnpm --filter @waitron/bench-sqlite-failover setup:litestream` first, without which the row is
SKIPPED, then `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/bench-sqlite-failover
scenarios`, 2026-09-18, the `LS` row →
`version=0.5.17 one-shot-keys=1 one-shot-restored=3 daemon-restored=4 first-sync-restores=3 after-write-restores=3 control-refused="litestream restore exited 1: Error: no matching backup files available"`.
That is the foundation check only (find the binary, config, stream, restore); it claims nothing about
the failover loop, which is what S0, S3 and S4 are for — S0 is in, and its recorded run is in its own
section below. A different
version is a different measurement, so a version bump will re-run the scenarios rather than inherit
their verdicts. MinIO is also not the store the product will run — Waitron Cloud has not chosen one
— so the conditional-write result will be a fact about the mechanism, and re-running it against the
real store is a standing obligation for the results note, `docs/research/2026-09-16-sqlite-failover-prototype.md`,
which plan Task 10 writes (spec §5).

## What S0's loop covers, and what its Part C records

S0 runs the whole loop three times against the real litestream binary, driving it by **one-shot
syncs**: a box sells four times, syncs to its own generation (`venues/v1/gen-1-box-a` in Part A),
files those four itself, sells twice more and dies before the next sync; the cloud restores that
generation, takes the next term up (2 in Part A), sells once for itself and drains; the box comes back, reads `current.json`, sees the higher term and ships
its tail instead of selling. The three runs differ by two flags — does the box ship its tail, and do
the box's own filings reach the store before it dies.

**S0 never starts the streaming daemon.** Every upload it makes is `syncOnce`; `replicate`, the
long-running mode the product would run, is driven by the `LS` foundation check and by nothing else
in this rig. That is why "the box dies before the next sync" is a scripted step here: under the
daemon it would be a timing window, and S0 measures nothing about that window.

**The three parts share ONE store and are separated by TERM**, the way `s1_double_promotion`
separates its fenced race from its control. Box terms 1, 3 and 5 name the generation each part's box
streams to; cloud terms 2, 4 and 6 name the generation each part's cloud opens and the create-only
claim key its promotion takes; so no two parts share a generation prefix or a claim. The one key all
three write is `venues/v1/current.json`, which carries no term and which `promote` overwrites every
time — each part reads it back only after its own promotion, so a later part's pointer never reaches
an earlier one. What the single store trades away: with a
store per part, a part that reached for another part's prefix would find nothing and fail on the
restore, while here it finds a real generation. What makes a wrong prefix loud instead is that each
part checks what the receiver holds against the rows its OWN box wrote, and `recordSale` puts a
fresh uuid in every payload. Which assertion does that work differs by part, and both were run on
2026-09-18: with Part B's restore pointed at Part A's generation it fails on "the records the stream
carried match the box's own rows", printing both sets of payloads; with Part C's pointed there it
fails on "the cloud holds box-a:1, which neither node in this run wrote" — the attribution check,
not Part C's verbatim comparison, which walks repeats selected by identity and finds none in that
state. Each of those is the assertion that fires FIRST, not the only one that would: run again with
Part C's attribution check deleted and its restore still pointed at Part A's generation, Part C
failed instead on "box-a:5 links to the record before it", because the ship then grafts its own
tail onto another part's chain.

**Part A is the loop, and it is what the verdict is read off.** It asserts, in this order: every
chain on the cloud verifies (secuencias 1..N with no gap, each `huella_anterior` the row before it,
each huella the hash of its own payload); the cloud holds box-a's 1..6 with the contents box-a wrote
them with, compared field by field against box-a's own rows; the cloud's own chain is one record
carrying the huella its own write returned; every `records` row on the cloud sits under the node that
WROTE it, judged by the payload, which carries the sale's uuid; every record was handed to the
tax-agency stub exactly once across all three drains of the run; and `current.json`, read back from
the store, names that part's own term and generation — term 2 and `gen-2-cloud-1` for Part A.

Two things it does NOT establish, stated because a reader will assume them. **"Exactly once" is a
claim about the SUBMIT ledger and not about the table**: `records` is keyed `(node_id, secuencia)`,
so it could not hold a row twice however the loop behaved. And **nothing here fences box-a**: it
reads the higher term and ships because the scenario has it ship, not because anything would stop it
selling.

**Part B is the control**, the identical loop with the ship left out. The cloud must end up holding
box-a 1..4 and not the tail, and Part A's own comparison must be what refuses that state — the
control drives that same function and requires it to throw, rather than asserting "5 and 6 are
missing" in words of its own, which would stay green if Part A's comparison had stopped checking
anything. Without a control at all, "the restore plus the ship gave us 1..6" is unfalsifiable: a
restore that had somehow carried 5 and 6 would look exactly like a ship that worked.

**Part C is a MEASUREMENT and decides nothing.** It leaves out the sync that would carry box-a's
filing state to the store, which is the route "What S2 measures, and what it does not" describes and
says S2 does not drive: the box files records 1..4 and dies before that `envios` update syncs, so the
promoted cloud restores them `pendiente` and files them a second time. Measured, 2026-09-18: **four
records — `box-a:1` to `box-a:4`** — each a verbatim same-identity copy, same node, same secuencia,
same huella, same payload as the row box-a filed, which the scenario asserts row by row. That is what
makes it the shape the owner has already read down — a duplicate a real AEAT refuses with error 3000,
which our drain reads as filed — rather than a new danger, and it is why the number is recorded
instead of failing S0. That reading is the section "What the FAIL means against the real system
(owner review, 2026-09-17)". Part A is its control: the same code path with one flag different
re-files nothing, and a mutation flipping that flag back on in Part C took the count from four to
zero and its first drain from `[box-a:1..4, cloud-1:1]` to `[cloud-1:1]`.

**Part C also runs Part A's attribution check, and that is the assertion holding the sentence above.**
The repeats it walks are selected BY IDENTITY — the ids the cloud filed that the box had filed too —
so a duplicate payload filed under a DIFFERENT node id is not among them and neither the identity
count nor the verbatim comparison would see it. Measured 2026-09-18: an extra row carrying `box-a:1`'s
payload inserted as `box-c:1`, its huella recomputed so its own chain verifies, with a `pendiente`
submission, before the cloud's first drain. With the attribution check taken out of Part C the whole
scenario reported PASS, its first drain reading
`[box-a:1,box-a:2,box-a:3,box-a:4,box-c:1,cloud-1:1]`; with the check in, Part C fails on "the cloud
filed box-a:1's record as box-c:1".

**Part A was never watched to fail first.** The commit that wrote it records that it passed on its
first run, and it passed again on the first run after the restructure this section describes. The
mutations below stand in for that red. Each was applied on its own, the runner run whole with
`TESTCONTAINERS_RYUK_DISABLED=true node src/scenarios.ts` from `bench/sqlite-failover` on 2026-09-18,
and every file restored afterwards. A scenario that throws is reported by the runner as a critical
FAIL under its filename, which is why these read `s0_happy_loop` rather than `S0`:

- `syncOnce` made to return without spawning (in `src/litestream.ts`) → "the box's sync uploaded
  nothing under venues/v1/gen-1-box-a";
- the box's two tail sales recorded BEFORE its own drain → "the box files its own first four records
  before it dies", printing `box-a:5` and `box-a:6` as the extra entries;
- the tail loop made to write one row while `TAIL_SALES` still says two → "the box wrote six records
  before it died". Changing `TAIL_SALES` itself does NOT drive that assertion — it reads the same
  constant, so a run with one tail sale passes — which is why the mutation breaks the write instead;
- Part B's cloud term set to Part A's, so its promotion claims a key that already exists → "the cloud
  takes the venue for the higher term";
- the cloud's term set to the box's own → "the returning box reads a term above its own, so it ships
  rather than selling";
- the ship deleted → "the cloud holds box-a's records 1..6 exactly as box-a wrote them", printing 5
  and 6 as the rows the cloud lacks;
- the ship given BACK to Part B's control → "without the ship the cloud holds only the records the
  stream carried", so the control is not green by construction;
- Part B's restore pointed at Part A's generation → "the records the stream carried match the box's
  own rows"; the same done to Part C → "the cloud holds box-a:1, which neither node in this run
  wrote" — the single store's trade, above;
- one shipped record's payload corrupted on the way in → "box-a:5's huella is the hash of its own
  payload". The chain check runs before the field-by-field comparison, so it is the one that fires;
- one shipped record's `huella_anterior` rewritten → "box-a:5 links to the record before it";
- the ship made to leave out the first tail record → "box-a's chain runs 1..N with no gap (at
  position 5)";
- an EXTRA row under a third node id carrying box-a:6's payload, its huella recomputed so its own
  chain verifies, added to Part A's cloud → "the cloud filed box-a:6's record as box-c:1". The chain
  check, the 1..6 comparison and the own-chain check all passed on that state, which is what the
  attribution check is for. With an invented payload instead of box-a's → "the cloud holds box-c:1,
  which neither node in this run wrote";
- the cloud selling twice → "the cloud holds exactly the one record it wrote for itself";
- the huella captured at the cloud's own write replaced → "the cloud's record carries the huella its
  own write returned";
- the cloud promoted into the next term up with the expectation left where it was → "current.json
  names the cloud's term and generation", printing `gen-3-cloud-1` against `gen-2-cloud-1`;
- the returning box draining AFTER it ships → "every record was handed to the tax agency exactly once
  across the whole run", printing `box-a:5` and `box-a:6` twice. **That order is what doubles them**:
  the same drain placed BEFORE the ship leaves Part A green, because `diffTail` ships each row's
  `estado` and `applyTail` adopts a terminal state under terminal-state-wins, so the cloud takes those
  two rows as already filed and its second drain files nothing —
  `happy-cloud-second-drain=[] happy-submissions=7 happy-distinct=7`;
- the submit stub keeping one entry per identity instead of every call → **Part A still passes**, and
  it is fair to say so rather than claim the exactly-once check caught it: Part A has no repeats to
  drop, so that ledger reads the same either way. What fails is Part C, on "the cloud's drain files
  exactly the records it was holding pending" — the assertion both parts run;
- Part C's missing sync given back → the whole scenario passes with `lag-refiled=0`,
  `lag-cloud-first-drain=[cloud-1:1]` and `lag-refiled-shape=no-repeat-to-compare`, which is what
  makes Part C's four a difference in the loop's state rather than in what was asserted. That last
  key is derived from the comparison rather than printed as a literal, and this run is what shows
  it: written as a constant it would have gone on reporting `verbatim-same-identity` over an empty
  set, and would keep reporting it on the day the protocol changes and the count reaches zero.

Some assertions in the file have no mutation of their own, and saying which is cheaper than implying
otherwise:

- "the database holds at least one chain to verify" — by the time any assertion runs, the cloud has
  recorded its own sale, so no mutation of the loop's inputs leaves that database empty without an
  earlier assertion firing first; the line guards a later caller handing this helper an empty
  database;
- two lines of the cloud's own-chain check — "starts at secuencia 1" and "has no predecessor". The
  cloud records exactly one sale, so a mutation giving it a different first record fails the length
  assertion above them first. Its LAST line is not in this list and was wrongly put here at first:
  "the cloud's sale was its chain's first" reads the secuencia `recordSale` RETURNED, not a row, so
  a write that inserts normally and reports the wrong number passes every line above it. Run
  2026-09-18 — `{ ...recordSale(cloud, 5000), secuencia: 2 }` → "the cloud's sale was its chain's
  first";
- "Part A's 1..6 comparison refuses the state the control produces" — no state satisfies Part B's
  1..4 check and leaves this one failing; what it guards is that comparison quietly becoming a no-op;
- Part C's verbatim comparison, and the `the cloud filed …, which the box never wrote` guard beside
  it. The repeats are selected as an intersection with the box's own drain, so the lookup cannot
  miss; and the cloud's copies of records 1..4 come from restoring the box's own database, which the
  tail ship never touches (they sit at or below the watermark), so making one differ needs an UPDATE
  — the one thing `records` refuses (`s_smoke`).

The SKIPPED path was run again after the restructure, because a critical scenario that quietly starts
a container while claiming it was skipped is the failure that would hide. With `.bin/litestream` moved
aside and no `litestream` on `PATH` (`command -v litestream` finds none on this host), the scenario
was called directly from a throwaway file with a `startStore` that throws if it is ever reached, and
returned `S0 SKIPPED true litestream v0.5.17 not found; … — S0 is UNPROVEN until then`. The control in
the other direction — the same call with the binary back — printed `THREW PROBE: startStore was
called`. That detail string is also what keeps the row honest: the runner prints id, title, verdict
and detail, and reads `critical` only when a verdict is FAIL, so the flag does no work on a SKIPPED
row.

S0's recorded run — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter
@waitron/bench-sqlite-failover scenarios`, 2026-09-18:

```
| id | title | verdict | detail |
| --- | --- | --- | --- |
| S0 | the happy failover loop, end to end | PASS | version=0.5.17 happy-box-a-filed=[box-a:1,box-a:2,box-a:3,box-a:4] happy-cloud-first-drain=[cloud-1:1] happy-cloud-second-drain=[box-a:5,box-a:6] happy-submissions=7 happy-distinct=7 happy-refiled=0 happy-current={term:2,node:cloud-1,gen:gen-2-cloud-1} control-ship=off control-held=box-a:1..4 control-refused="the cloud holds box-a's records 1..6 exactly as box-a wrote them" lag-sync-after-drain=off lag-refiled=4 lag-refiled-ids=[box-a:1,box-a:2,box-a:3,box-a:4] lag-refiled-shape=verbatim-same-identity lag-cloud-first-drain=[box-a:1,box-a:2,box-a:3,box-a:4,cloud-1:1] |
```

That run's exit code is 1, and S0 is not why: S2 is the critical FAIL the runner reports.

What S0 leaves for the tasks after it: nothing streams the CLOUD's own generation anywhere, so a
node that restores `gen-2-cloud-1` and follows the pointer is plan Task 8's, and the promotion here
writes the pointer and a generation marker and no database.

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

**S2's verdict is FAIL, and that is a result rather than a broken harness.** The rig found a way the
loop as modelled here submits one sale to the tax agency twice. The scenario records it instead of
reporting PASS beside it, and nothing here proposes a fix. **How much that costs was revised on owner
review, 2026-09-17** — the next section. The short form: the model's stand-in for the tax agency
accepts a repeat, and the real one refuses it; and the model lets a sender keep filing after it has
started shipping, which the designed order forbids.

### What the FAIL means against the real system (owner review, 2026-09-17)

Two facts from outside the model, both read rather than run, change what a second submission here
would cost. Neither changes the measurement.

- **The real tax agency refuses a duplicate, and the real drain already reads that answer as
  "filed".** AEAT answers error 3000 on a record it already holds — per record, not per batch — and
  says what state the stored record is in (`docs/compliance/verifactu-findings.md` → "Record identity
  and duplicates", taken from AEAT's documentation; no live resend of an identical record has been
  observed). `resolveEstadoEfectivo` (`packages/verifactu/src/xml/parse-suministro.ts`) reads 3000
  plus `Correcta` as `accepted`, so the receiver's copy is marked filed and its chain carries on. The
  stub here never answers that way: it records the repeat and accepts it. So every second filing S2
  counts is, against the real endpoint, a submission AEAT refuses and the drain then records as filed
  — a wasted call, not a record filed twice. That reading compares no content when AEAT says
  `Correcta`, and it is safe here only because the shipped row is a verbatim copy (same node, same
  `secuencia`, same `huella`). A DIFFERENT record filed under a reused invoice number is the case
  `docs/superpowers/specs/2026-09-06-module-sp3d-fiscal-restore-hook-design.md` guards with fresh
  series; S2 does not model it.
- **The designed order is decommission first, then promote.** The old primary boots fenced —
  read-only — and only then ships its tail (topology design §5.2; owner, 2026-09-17: the primary is
  decommissioned before the secondary is promoted, so two nodes never file at once). Parts B and D,
  and Part E's second half, have the SENDER file after it has started shipping, which a fenced sender
  cannot do. Part E's second half rests on that entirely: a tail taken while the sender's own drain
  holds a row `enviando` cannot come from a sender that fenced first. The fence does not have to wait
  for that in-flight submission to resolve: §5.2 puts the recovery on the RECEIVER instead, which the
  "stuck `enviando` row" bullet below goes into.

Part D's shape has a second route the rig does not drive, and it lands in the same benign place. The
receiver can hold a copy of the sender's row with an out-of-date state without any second ship: the
Litestream stream carries
`envios` at whatever state each row had when it was streamed, so a sender that files a record and
dies before that update streams leaves the promoted receiver holding it `pendiente`. The tail ship
sends what the receiver LACKS, so it never corrects that row. Against the real endpoint that is one
refused duplicate submission per such row. S2 does not measure it — it models the receiver's stale
copy as coming from an earlier partial ship. **S0's Part C now drives it with the real litestream
binary, by one-shot syncs** — not by the streaming daemon, which only the `LS` check starts — and
measured four such rows in one run: see "What S0's loop covers, and what its Part C records" above.

**On the first follow-up this section first named — "make the stub answer a repeat the way AEAT
does" — a second look on 2026-09-17 found it would measure nothing, and it is dropped.** A stub that
models error 3000 is idempotent BY CONSTRUCTION: it can never record a second FILING for a repeated
identity, so **the double counter** under it reads zero whichever way the loop behaves — a
measurement taken where both answers look alike (`CLAUDE.md` §1), not a probe. That is a statement
about the counter and not about the whole scenario, and the difference was run, not reasoned: the
review seat replaced the stub with one that throws on a repeated identity, and S2 still failed —
on a control assertion outside the `submit` callback, not with a clean zero — because the parts
that assert do see the changed outcome, even though a throw INSIDE that callback is swallowed
(`src/model.ts`, `drainPass`). Its only effect would be to reclassify
Part D's and Part E's doubles from "submitted twice" to "refused duplicate", which is the analytic
point above, not something a run establishes.

No run is available because EVERY double this rig finds is the SAME invoice identity filed twice —
the tail ship and the Litestream stream each carry a record verbatim, same `node_id`, same
`secuencia` — and a real AEAT refuses a same-identity duplicate. Two shapes are worth separating
out, and neither is a double filing a run here could show:

- **The stuck `enviando` row** (Part E's second half) is a MODEL GAP, not a real-system filing hole.
  The rig's minimal drain claims only `pendiente` rows and never recovers a stale claim, so a shipped
  `enviando` sticks and never files. The real drain does not leave it there for good: it
  commits `enviando` before the AEAT call (`packages/fiscal-verifactu/src/drain.ts`, the T1/T2
  split), and `recoverStaleClaims` resets any `enviando` older than five minutes back to `pendiente`
  at the top of every pass (`drain.ts:449`) and re-files it, with AEAT's duplicate check catching the
  already-filed. So the real hole is a delay, not a permanent stop.

  Two things about that, both read on 2026-09-17 rather than run, and stated as narrowly as the
  reading supports. First, no boot-path reset exists. The evidence is an enumeration of every write
  to `envios` in non-test `packages/` and `apps/` code, not a single grep: `drain.ts` claims a row
  (601), recovers a stale claim (449), backs a thrown submission off (717), writes what AEAT answered
  (913) and halts a chain's successors (683, 954); `reconcile.ts` writes a consulta's answer (380), its `noTrace` remediation (393) and a clearing of the resubmit marker (412); `backend.ts` inserts new rows. Of those, 449 and 717 are
  the only ones that return a row to `pendiente` without an answer from the endpoint, none of them is
  reached from the boot path, and `apps/server/src/boot.ts` does not mention `envios` at all. Second,
  the unconditional reset on restart that would make recovery immediate — topology §5.2, owner
  2026-09-17 — is a requirement of that design and **is not built**. What is there instead is the
  five-minute gate, counted from when the row was CLAIMED (`enviado_en`) rather than from the
  restart — so after a promotion the inherited row is usually stale already and the first pass
  recovers it; a node that claimed a row moments before it died is the case that waits.

- **A DIFFERENT identity for one economic sale** — an invoice number reissued under re-keying — is
  the one genuine double-filing shape, and the only real-system concern that survives. AEAT does not
  refuse it, because the identity triple differs. S2 does not model it; fresh-series-on-restore
  (`docs/superpowers/specs/2026-09-06-module-sp3d-fiscal-restore-hook-design.md`) is what guards it,
  and measuring it would be its own scenario, not a change to S2.

The second follow-up is done on this branch: the topology design now states that the old primary is
decommissioned (fenced) before the secondary is promoted (§5.2), and that a row left in flight is the
RECEIVER's to deal with rather than something the fence must resolve first. Which mechanism deals
with it depends on how the row got there, and §5.2 is careful about this: a copy the promoted node
inherited through the stream is what the boot reset would catch once it is built, while a row that
ARRIVES in a tail after that node is already running is caught only by `recoverStaleClaims`'s
five-minute reset, because a reset that runs at boot cannot see a row delivered later. S2's exit code
records the MODEL's same-identity double SUBMISSION, which is a wasted call against a real AEAT, and
is not evidence that the product would file a record twice.

S2 drives the rig's model of the submission state machine — `drainPass`, `applyTail`, `diffTail` and
the `envios` table in `src/model.ts`. Its result is evidence about that mechanism and about nothing
else: `packages/fiscal-verifactu` is not imported here and has its own suites.

**The safe case and the unsafe one differ by one thing: what the sender knew when it built the
second batch.**

- **A ship RETRIED IN FULL is safe when nothing the batch carries has gone stale** (Parts A and B).
  The sender's confirmation never came back, so it re-sends the same range whatever state each row is
  in. The two parts get there differently, and the difference is the whole condition. In Part A the
  SENDER filed nothing in between — the receiver did — so replaying the identical frozen batch
  (`tailA`, every row still `pendiente`) is safe: terminal-state-wins refuses to walk the receiver's
  filed rows back. In Part B the sender filed its own rows in between, and its retry is rebuilt
  (`retriedTailB`, recomputed against the sender while reusing the OLD summary of the receiver), so
  it carries them as `enviado` and the receiver adopts that. Put a FROZEN batch in Part B's position
  — the sender files after the batch was built — and the receiver files the record a second time.
  That last one is a run, not a reading: the review seat's probe built a tail, applied it, drained
  the sender, applied the same frozen tail again and drained the receiver, giving
  `literal-full-batch-retry ["stale-sender:1","stale-sender:1"]`, reproduced independently on
  2026-09-17. S2 does not measure that variant. Thirteen filings across the three chains,
  none of them twice.
- **A ship RECOMPUTED against a REFRESHED view of the receiver files a record twice** (Part D). Here
  the sender asks the receiver what it holds and sends only the difference. `diffTail` picks records
  by a high-water mark over the receiver's `records`, so a record the receiver already holds is not
  in the batch at all — and the batch therefore carries no news that its owner has since filed it.
  The receiver's drain claims across every chain with no node filter, so it files that record itself.
  Measured: the sender takes two sales, ships record 1 while it is still unfiled, then files both of
  its own records; the recomputed batch carries record 2 only; the receiver is left holding
  `1 pendiente, 2 enviado`, and its next drain files `refreshed-sender:1` a second time.

**The rule those two sides rest on, and why each needs its own control.** A record the RECEIVER has
already filed must not be walked back to `pendiente` by a re-shipped copy taken before it was filed,
or the receiver files it twice itself. A record the SENDER has already filed must be adopted as filed
by a receiver still holding it `pendiente`, or the receiver files a record its owner has already
filed. Neither side implies the other, and only the second was red before this scenario: with the
earlier `ON CONFLICT DO NOTHING` write, a re-shipped `pendiente` changed nothing on a row the receiver
had marked `enviado`, so the first side held by accident of the conflict clause rather than by a rule.

Both sides are measured against ONE ledger of filings, because there is one tax agency: a record
filed by the node that owns it and filed again by the node it was shipped to has been filed twice,
whichever database each filing came out of. A ledger per node cannot see that at all. Parts A, B and
C deliberately SHARE one ledger, which is what lets the whole-ledger backstops catch a filing for a
chain no per-part check names; every part that is MEANT to file twice — Part D, Part E's second half
and both controls — keeps its own ledger and its own nodes, so it cannot disturb the count of a part
that is not.

`applyTailRegressing` drops the guard: the three rows the receiver had filed regress to `pendiente`
and its next pass files them again. `applyTailInsertOnly` drops the shipped submission state whenever
the receiver already holds the row: the two rows the receiver already held stay `pendiente`, and it
files rows its owner had already filed. Each control names the exact rows it expects to see filed
twice — "a duplicate happened somewhere" would also be satisfied by a broken harness. Both are thin
wrappers over the same `applyTail` body with one parameter changed, the `envios` rule, so a control
differs from the real path in that rule and in nothing else.

**The drain's blocked set, which spec §4's S2 also asks for, IS reachable** (Part E). An earlier
version of this section said it was not. The set lives for the whole of one `drainPass` loop and
`submit` is called from inside that loop, so a ship issued from inside a `submit` callback runs with
whatever chains are blocked at that instant still blocked. The true narrow statement is that the set
is not reachable from OUTSIDE `drainPass`, which is why the callback is the only seat to observe it
from — and that shipping from inside the callback is also the only way this synchronous model can
express "a ship lands mid-pass" at all, so what Part E measures is this model's ORDERING and not a
claim about how the real system's drain and its ship interleave.

Part E measures two things from that seat:

- **A ship for a blocked chain.** Chain one's first row is refused, which blocks it; from a later
  `submit` callback in the same pass, the rest of chain one is shipped in. The blocked chain files
  nothing for the rest of that pass — its second row is due and `pendiente` and is never handed to
  the stub — while chain two drains normally in the same pass, and the next pass files chain one
  whole, three records once each, the refused row and the row that arrived mid-pass included. The
  mid-pass apply reports `applied` = 2, counting only the record and submission row that were not
  already there.
- **A batch taken while the SENDER's own drain holds a row `enviando`.** `applyTail` writes the
  shipped state verbatim, so the receiver adopts `enviando`; a drain claims only `pendiente` rows,
  so no pass on the receiver ever touches that row again. Measured: the batch carried
  `[1 enviando, 2 pendiente]`, the receiver was left `1 enviando acked=0, 2 pendiente acked=0`, row 1
  is stuck against the receiver's own DRAIN, and row 2 — shipped unfiled and filed by its owner
  moments later — is filed a second time by the receiver. What is NOT measured: a later ship carrying
  row 1 as `enviado, acked=1` would satisfy the terminal-state-wins guard and clear it, and S2 sends
  no such ship. This is recorded, not asserted: nothing here says a stuck row is the right answer.

**The verdict is FAIL when ANY measured part records a second filing, and today two of them do** —
Part D's recomputed ship, and Part E's second half. They have different causes, which matters for
what would clear them. A ship carrying submission state for rows the receiver already holds, sent at
the points S2 already sends one, would clear Part D and leave Part E's second half standing — that
double comes from the receiver draining a foreign chain at the moment its live owner is draining the
same chain, so changing who may file a chain would clear it. That is one way and not the only one:
the review seat cleared Part E's second half without touching who may file, by adding a full
terminal-state ship at a point S2 does not send one — after the sender's pass and before the
receiver's — and S2 then reported PASS once Part D was cleared alongside it by the zero-watermark
mutation, the verdict expression untouched. So what this measures is the sequence, not an exclusive
remedy.

No SINGLE mutation of `src/model.ts` tried here returns S2 to PASS on its own: Part D's term was shown
to vary (see the mutation list below), and Part E's second half was not observed clear under any one
of them.

Two narrower boundaries:

- The guard tests the row already in the receiver's table and not the one arriving, so an arriving
  `pendiente` does overwrite an `enviando` row. `drainPass` never leaves a row in that state across a
  call, and that was measured rather than argued: reading `envios` back after a pass gave every row
  `enviado` when the stub accepted all three, `enviado pendiente pendiente` when it threw on the
  second, and three `pendiente` when it threw on all of them — never an `enviando`. `applyTail` is
  the way one does arrive, and Part E's second half above is the measurement of it.
- Read off the package, not run: S2 starts no container and opens no store — it is SQLite plus
  `src/model.ts`. It still runs inside a `scenarios` run that starts MinIO for the others.

S2's recorded run — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter
@waitron/bench-sqlite-failover scenarios`, 2026-09-17:

```
| id | title | verdict | detail |
| --- | --- | --- | --- |
| S2 | no second tax-agency filing on a re-sent or recomputed tail ship | FAIL | RETRIED-IN-FULL ship safe: filed=13 double=0 (A receiver files 5 once; B receiver files none of the owner's 4; C blocked chain drains 4 next pass after 1 refusal). D REFRESHED-SUMMARY ship files twice: refreshed-sender:1 (fresh tail carried records [2]; receiver left 1 pendiente acked=0, 2 enviado acked=1). E ship issued mid-pass for a blocked chain: that chain files nothing more that pass, next pass files 3 once, double=0. E tail taken mid-drain carried [1 enviando, 2 pendiente]: receiver left 1 enviando acked=0, 2 pendiente acked=0, and its own drain claims no enviando row, so 1 enviando acked=0 is stuck against that drain and cloud-f:2 is filed twice. Controls double-file: regressing=3 insert-only=2 |
```

That run exits non-zero, which is the runner working: S2 is critical, and a critical FAIL is what
this gate exists to report.

Parts A, B and C's assertions were put to mutation rather than read: eleven small changes to
`src/model.ts` (nine of a single line; two of a pair, where one rule is spelled out in two
statements), each run whole, each making one named assertion the one that failed. Three further
assertions were shown to bite by re-running a mutation with the earlier assertion that had caught it
first taken out. Seven were not made to fail by any mutation tried — preconditions, and whole-ledger
backstops that a sharper assertion earlier in the scenario always reached first. Those eleven were
run before Parts D and E existed and against the `envios` rule as it stood then; the mutations, the
message each produced, and those seven by name are in that task's pull request.

Parts D and E were put to four more, each run whole, each named by the message it produced:

- `diffTail`'s high-water mark forced to 0, so every ship carries the whole chain: Part D's segment
  of the detail line changes from `files twice: refreshed-sender:1` to `files twice: none`, with no
  edit to the scenario — the verdict really is read off the measurement. **S2 still reports FAIL and
  the run still exits 1**, because Part E's second half is untouched by that mutation: its receiver
  holds nothing when the mid-drain tail is taken, so that tail already carried the whole chain. This
  mutation is the one that shows a term can go clean; it is not a demonstration that the verdict can
  reach PASS, and no mutation tried here does that.
- A refused submission ending the whole pass (`break`) instead of blocking only its own chain: "Part
  E: the ship for the blocked chain ran from inside a submit callback". The pass stops at the
  refusal, so the later callback that issues the ship never runs.
- The blocked set never added to at all: "Part E: the blocked chain files nothing for the rest of the
  pass its refusal blocked". Part C's two assertions reach this mutation first, so this one was run
  with those two taken out — the same method as the three re-runs above.
- The `terminal-state-wins` rule's second condition removed — the arriving row's `estado`/`acked`
  differing from the row already there: "Part E: the mid-pass ship counts only the two rows it
  actually changed", the count having gone 2 → 4. A separate probe on node v26.7.0 took the control
  in the other direction: a second, identical `applyTail` of one shipped record reported `applied:1`
  without the condition and `applied:0` with it, every table byte-identical either way, while an
  apply that really does advance a row reported 1 under both.

## What S5 measures, and the savepoint it does not need

S5 ships a tail carrying a supplier invoice whose supplier and invoice number the receiving node has
already typed for itself under a different id. The apply names that row in its result, leaves it out
of the table, and applies everything else in the batch — the sender's other supplier invoice
included — compared row by row against the rows the sender shipped, not counted, because an apply
that altered a value on the way in still lands one row per row sent. Shipping the same tail again
reports the same one clash and changes nothing.

Its two controls are the two failures spec §4's S5 rules out in one line — the clash must be
"not applied, not silently dropped, not crashing the whole ship" — and each is a `ClashRule` setting
of the same apply (`src/model.ts`). `silent-drop` is "not silently dropped": the row goes into
neither the table nor the report, and nobody is told. `unisolated` is "not crashing the whole ship":
the refusal is left uncaught and rolls the whole batch back.

**A refusal is classified by the error before the table is looked at.** Only a uniqueness refusal is
a shape this rule knows; anything else is rethrown and takes the batch down with it. Measured on
SQLite 3.53.4 (`process.versions.sqlite` under node v26.7.0), against a table with a text primary
key, a `NOT NULL` column and a two-column `UNIQUE`: a duplicate primary key gave extended result code
1555, a duplicate unique pair 2067, a missing `NOT NULL` value 1299 and a trigger's `RAISE(ABORT)` 1811. The same probe is why the error's `errstr` cannot do this job, and a reader will reach for it:
all four refusals carry the errstr "constraint failed".

What holds that rule to its word is S5's own last assertion. The receiver there already holds the
arriving row's id — which is what a rule reading the table rather than the error calls a ship
arriving twice — and refuses the insert for an unrelated reason, a trigger's `RAISE(ABORT)`. The
apply has to let that refusal out and roll the batch back. Proved by deletion on 2026-09-18, twice:
with the error check removed altogether, and with it widened to accept any constraint code, the run
fails on "a refusal that is not about uniqueness leaves the apply instead of being read as a clash".
Without that assertion the check is invisible — S5 was green with the check deleted before the
assertion existed.

**The savepoint.** The plan for this scenario asked for each invoice insert to be wrapped in a
`SAVEPOINT`. It is not, and it needs none. SQLite's own documentation says of `ABORT`, its default
conflict resolution, that it "backs out any changes made by the current SQL statement; but changes
caused by prior SQL statements within the same transaction are preserved and the transaction remains
active" (<https://sqlite.org/lang_conflict.html>, read 2026-09-18). That was confirmed on the engine
this rig runs — SQLite 3.53.4 under node v26.7.0 — rather than taken on trust: one transaction was run twice — a
sale, a clashing invoice insert, then a clean invoice and a second sale — once with the clashing
insert inside `SAVEPOINT`/`ROLLBACK TO` and once with only a `try`/`catch` around it, and both runs
committed both sales and the clean invoice, left the receiver's own row alone, and neither `COMMIT`
errored. The probe can tell the two apart — repeated with the clashing insert written as
`INSERT OR ROLLBACK`, the savepoint run committed nothing at all and the savepoint-free run lost the
row written before the clash and then failed its `COMMIT`. S5's own
`assert.deepStrictEqual(rowsHeldFrom(receiver, senderId), rowsShipped(tail, clashId))` is the
standing check that a savepoint-free apply keeps the rest of the batch, so the `scenarios` run holds
it. Anything here that later uses a conflict resolution other than the default has to re-run that
probe before relying on any of this.

**The retry, put to mutation.** Two changes to the clash branch in `src/model.ts`, each run whole on
2026-09-18 against the code as it stands:

- Every row found holding the pair reported as a clash, the different-id comparison dropped: the run
  fails on "the retry reports the same one clash". That is the assertion that earns the branch.
- The primary-key fallback — `if (invoiceById.get(row.id)) continue;` — deleted: **S5 still passes**,
  and it is fair to say so rather than claim a proof. Classifying by the error first moved the
  retried-ship case into the pair lookup above it, so the fallback now only catches a uniqueness
  refusal where nothing holds the pair, which is a primary-key conflict against a row whose supplier
  and invoice number have since changed. No scenario here ships that, so nothing checks that line.

S5's recorded run — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/bench-sqlite-failover
scenarios`, 2026-09-18:

```
| id | title | verdict | detail |
| --- | --- | --- | --- |
| S5 | supplier-invoice clash reported and skipped, ship otherwise intact | PASS | applied=13 clashes=1 retry-applied=0 retry-clashes=1; silent-drop: clashes=0 clash-rows-held=0 records-held=3/3; unisolated: refused="UNIQUE constraint failed: supplier_invoices.supplier, supplier_invoices.invoice_number" records-held=0/3 sales-held=0/3 clean-invoice-rows-held=0; not-a-uniqueness-refusal: refused="the receiver refuses this row for its own reasons" records-held=0/3 |
```

That run's exit code is 1, and S5 is not why: S2 is the critical FAIL the runner reports.

## Why it can't join `pnpm -r test`

Three independent reasons. The first was run in this worktree; the second and third were read off the
package and the root config, and are marked as such — they are not measurements:

1. The package defines no `test` script — only `scenarios`, `setup:litestream` and `typecheck`. Root
   `pnpm test` ends in `pnpm -r test`, which skips a workspace member that has no such script instead
   of failing on it: `pnpm -r --filter @waitron/bench-sqlite-failover test` prints nothing and
   exits 0.
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
