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
pnpm --filter @waitron/bench-sqlite-failover scenarios          # the Markdown table
pnpm --filter @waitron/bench-sqlite-failover scenarios --json   # the same run, one JSON document
pnpm --filter @waitron/bench-sqlite-failover typecheck
```

**The results are written up in
[`docs/research/2026-09-16-sqlite-failover-prototype.md`](../../docs/research/2026-09-16-sqlite-failover-prototype.md)**
— what each scenario had to show, its recorded verdict, the control that makes that verdict a
measurement, what the gate does not establish, and the obligations it leaves standing. That note is
the product of this gate; this package is its reproducer, and the per-scenario sections below carry
the mutations each scenario's assertions were proved by.

Docker must be running: most scenarios start their own MinIO container via Testcontainers. S2 and
S5 never do — each models its hand-over between two in-memory SQLite databases, so neither needs a
container or a store. `LS` starts one only once `setup:litestream` has been run: without the pinned
binary it reports SKIPPED before it reaches the store. S0 and S3 do the same, and each starts ONE
container when it does run: S0's three runs of the loop share that store and are kept apart by term,
and S3's three parts share it and are kept apart by prefix. S4 starts one too, and only for its
reachable-store control — its offline half needs no container at all. Without the pinned binary S4
does NOT report SKIPPED: it drops the daemon, the control and the container, runs the SQLite half
alone and says so in its row.

`setup:litestream` downloads the pinned litestream release into the gitignored `.bin/` for this
host's platform. Nothing else installs it, so the scenarios that drive litestream report SKIPPED
until it has been run — every one of them but S4, which degrades to its SQLite half instead ("What S4
measures, and what it does not", below). `resolveLitestream()` (`src/litestream.ts`) also accepts `$LITESTREAM_BIN` or
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

**`scenarios` exits 1 on a clean tree**, because S2 is a critical scenario whose verdict is FAIL — a
recorded result, not a broken harness. See "What S2 measures, and what it does not" below. Anything
reading this rig's exit code has to account for that: a 1 here means "a critical scenario failed", and
on this tree that scenario is S2 and it is expected.

`TESTCONTAINERS_RYUK_DISABLED=true` is required locally (`CLAUDE.md` §4), and it turns off the reaper
that would otherwise clean up after an interrupted run. Scenarios run one at a time and each that opens a store stops it
in a `finally`, so an interrupt strands the container of the scenario in flight, not one per
scenario. `pnpm reap` is the fallback: `startStore()` stamps every container `com.waitron.reapable`,
which `scripts/reap-testcontainers.mjs` selects on — **and it removes only labelled containers older
than two hours**, so a reap run immediately after an interrupt reports nothing removed and the
stranded container is still there. Stop it by hand, or reap later. Never a blanket
`docker volume prune`.

## A scenario's verdict is a measurement, and the exit code says so

`scenarios` prints one Markdown table — id, title, verdict, detail — or, with `--json`, one parseable
JSON document carrying the same rows verbatim, the ids of the critical failures and the exit code (a
piped run's own exit status is the pipeline's last command, not the runner's). Either way it exits
**non-zero only when a scenario marked `critical` has the verdict `FAIL`**. `MEASURED` and `SKIPPED`
never fail the run, and neither does a non-critical `FAIL`: a scenario that fails is a recorded
outcome, which is the answer this gate exists to produce (spec §7). The critical scenarios are S0, S1,
S2, S3 and S6 (spec §7) — a failure in one of those means slice 2 would be building on a hole — **plus
`RUNNER`**, the runner's own self-check, which is critical for a different reason: a wrong exit rule
makes every other row's reporting untrustworthy.

A scenario that **throws** is recorded as a critical `FAIL` whatever it was going to claim, because a
harness that broke mid-scenario never got as far as saying what it was measuring.

A critical **`SKIPPED`** exits 0 deliberately: that scenario is UNPROVEN, which is a fact for the
results note rather than a broken premise. S0 and S3 are the two that can report it — neither did on
any run taken for the note — and each says in its own row that it is UNPROVEN until
`setup:litestream` has been run.

**The rule itself is in `src/runner-contract.ts`**, not in `main()`, and
`src/scenarios/s_runner_contract.ts` drives it over a table of cases: see "What the `RUNNER` check
drives, and the one thing it cannot" below.

## What the `RUNNER` check drives, and the one thing it cannot

`src/runner-contract.ts` holds everything the runner decides — which result sets fail a run, how a
scenario that threw is recorded, and both output shapes — and `src/scenarios/s_runner_contract.ts`
drives all of it over a table of cases. It starts no container, opens no store and touches no file,
and runs in about 20ms.

It is in its own module rather than in `scenarios.ts` because `scenarios.ts` ends in a top-level
`await main()`: importing a VALUE from it runs the whole suite. Measured 2026-09-18 — a `node:module`
load hook over `import('./src/scenarios.ts')` printed `LOADED SCENARIO MODULE: s0_happy_loop.ts` and
then s1, s2, s3, s4, while importing a scenario, which takes only `import type` from `scenarios.ts`,
resolved in 31ms and loaded nothing.

Each of the following was applied to the production code on its own, the scenario re-run, and the file
restored from a copy taken beforehand (2026-09-18). Each names the assertion that caught it:

- exit non-zero on **any** FAIL → `a non-critical FAIL exits 0`;
- exit non-zero on **any critical row whatever its verdict** → `a critical SKIPPED exits 0`;
- always exit 0 → `a critical FAIL exits non-zero`;
- `criticalFailures` returning nothing → `a critical FAIL exits non-zero`;
- a scenario that threw recorded non-critical → `a scenario that threw is recorded critical whatever
its id`;
- `--json` emitting the Markdown table → `--json prints one parseable JSON document`;
- the JSON dump losing its `exitCode` → `the --json dump reports the same exit code the runner exits
with`;
- the JSON dump blanking each row's detail → `the --json dump carries every row verbatim`;
- `formatTable` returning an empty string → `the table prints a header, a separator and one row per
scenario`;
- the table's header renamed → `the table's header names the four columns the results note reads`;
- the pipe escape dropped → `a pipe inside a cell is escaped`.

**Two of those were uncaught first, and the fix is why the output choice takes an argument list.** With
the `--json` flag read inside `main()`, cutting its wiring printed the table under `--json` and this
scenario still reported PASS; and with `formatTable` returning `""` the runner printed **nothing** and
still exited 0, again with a PASS on this row. Both were measured before the change, not reasoned
about. `render(argv, results)` now makes the choice, and the scenario drives it both ways.

**The hedge, stated because a failing test can never restore it:** what is still driven by nothing is
the single line `console.log(render(process.argv, results))`. Everything the runner decides is behind
`render`; handing it the real `process.argv` is not. A scenario cannot reach that without spawning the
runner, which would run the whole suite.

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
the failover loop, which is what S0, S3 and S4 are for — all three are in, and each recorded run is
in its own section below. A different
version is a different measurement, so a version bump will re-run the scenarios rather than inherit
their verdicts. MinIO is also not the store the product will run — Waitron Cloud has not chosen one
— so the conditional-write result is a fact about the mechanism, and re-running it against the real
store is a standing obligation, recorded as one in
[the results note](../../docs/research/2026-09-16-sqlite-failover-prototype.md) (spec §5).

## What S0's loop covers, and what its Part C records

S0 runs the whole loop three times against the real litestream binary, driving it by **one-shot
syncs**: a box sells four times, syncs to its own generation (`venues/v1/gen-1-box-a` in Part A),
files those four itself, sells twice more and dies before the next sync; the cloud restores that
generation, takes the next term up (2 in Part A), sells once for itself and drains; the box comes back, reads `current.json`, sees the higher term and ships
its tail instead of selling. The three runs differ by two flags — does the box ship its tail, and do
the box's own filings reach the store before it dies.

**S0 never starts the streaming daemon.** Every upload it makes is `syncOnce`; `replicate`, the
long-running mode the product would run, is driven by the `LS` foundation check and by S3, and by
nothing else in this rig. That is why "the box dies before the next sync" is a scripted step here:
under the daemon it would be a timing window, and S0 measures nothing about that window.

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

## What S3's copy covers, and what its Part C records

S3 asks whether a replica COPIED from one prefix of the store to another restores the same database
as the prefix litestream streamed to directly. It runs three parts against one MinIO store and one
temporary directory, under four prefixes of the one venue — `venues/v1/gen-1-box-a` is the source
box-a streams to, and `gen-2`, `gen-3` and `gen-4` are the destinations Parts A, B and C copy into.
Nothing here drives `promotion.ts`: no term is claimed, no pointer is written, and the generation
names only follow topology §2.2's shape so these keys sit where a promotion's would.

**Part A is the verdict.** Box-a sells under a real `replicate` daemon and keeps selling until the
store has DELETED a key it previously held — an outer deadline over a real listing, never a sleep,
and a loud failure at the bound. That wait is the first of the two things this scenario had to
establish, because "the copy propagates deletions" is a claim about a case that has to actually
arise. The daemon is then stopped, the last writes flushed with a one-shot, box-a's database
**deleted from disk**, and the copy made into a destination that already holds a DIFFERENT venue's
replica — box-b's, nine sales each followed by its own sync. After
`copyUp(…, { propagateDeletions: true })` the destination must hold exactly the source's objects and
nothing else, and the database restored from it must be the database restored from the source: the
same file bytes, the same `records` rows compared field by field against the rows box-a itself
wrote, the same `chain_head` rows, and `PRAGMA integrity_check` reading ok on both.

**The file bytes are hashed BEFORE anything opens the database**, so that nothing `openNode` does can
enter the hash: it runs `CREATE TABLE IF NOT EXISTS` and its triggers, and opening a database
litestream has restored creates the `-wal` and `-shm` sidecars beside it. That ordering is the
conservative one; it is not a claim that an open WOULD change the file. The one probe that looked
found the main file unchanged. On 2026-09-18, a model database seeded with five sales and left in
WAL journal mode was hashed, opened with `openNode`, hashed again while open, closed and hashed a
third time: `hash-open equal=true wal=true shm=true`, `hash-close equal=true`. The sidecars do
appear; on that run the main file's bytes did not move. Whether some other open could move them is
not established.

**The dirty destination is what makes Part A a measurement.** Copying into an EMPTY prefix gives the
same answer with the flag set either way, so the two flags would look alike and nothing would be
under test. Part B runs the identical recipe with the flag off and gets a different venue's ledger
back.

**Part B is the control**, and it drives Part A's own comparison over what the additive copy left,
requiring it to throw — a control asserting "the rows are box-b's" in words of its own would stay
green if Part A's comparison had stopped checking anything. Its destination is dirtied the same way
Part A's is and with its own count printed — `control-foreign-keys` is how many objects box-b's nine
sales left under `gen-3-box-a` before box-a's replica was copied over them, the twin of
`foreign-keys` under `gen-2-box-a`. What the additive copy leaves behind is
not a litestream error: the restore exits 0 and writes a database. On the recorded run that database
holds **box-b's nine rows** — `control-rows=9 control-nodes=[box-b]` — and SQLite reports it damaged,
`row 1 missing from index sqlite_autoindex_chain_head_1`, so the assertion that refuses it is the
integrity check rather than the row comparison. Both the integrity string and the refusal's own
words are printed, because a later run refusing at the row comparison instead would be a different
finding and should read as one.

**Part C is a MEASUREMENT and decides nothing.** It is the control plan Task 8 asked for, and **it
does not reproduce the opposite result on this pin**. The plan expected an additive copy to diverge
because stale compacted files would be present; when the destination holds only THIS lineage's
files — an early copy taken while the daemon was still streaming, some of whose objects the source
has since deleted — the restore comes back identical to the direct one. A replica file's name
carries the transaction range it covers (a listing taken on 2026-09-18 read
`venues/v1/gen-1-box-a/0000/0000000000000001-0000000000000001.ltx` and two like it), so putting a
file back under the name it already had puts the same range back twice. What Part C did NOT test is
whether litestream ever writes different bytes under a name it has used before. Part C asserts only
its two preconditions — the destination must hold objects the source no longer has — and REPORTS the
outcome, computed rather than written as a literal.

**Part C has three outcomes and none of them fails the scenario**, corrected on 2026-09-18: a
litestream that DECLINES to restore the same-lineage replica is a legitimate result of the
experiment, and until that day it made the whole scenario throw, which the runner reports as a
critical FAIL. The outcome is now `identical`, `diverged: <the assertion that refused it>`, or
`refused: …`. That third string is not litestream's own words alone: it is this rig's wrapper text
(`litestream restore exited <code>: `) followed by litestream's first line of stderr.

**Which declines count is matched on litestream's WORDS, not on a non-zero exit** — a second
correction the same day, because the first attempt matched only the wrapper and that wrapper goes on
EVERY non-zero exit of `restore`. Driven from a scratch copy of the scenario whose Part C restore
threw instead of running:

- with litestream's missing-backup words, S3 PASSED and printed `same-lineage-rows=0
same-lineage-additive="refused: litestream restore exited 1: Error: no matching backup files
available"`;
- with the decode error a wrongly copied replica really produces — `litestream restore exited 1:
Error: decode database: decode header: non-contiguous transaction ids in input files:
(0000000000000002,0000000000000002) -> (0000000000000001,0000000000000001)`, the same words the
  shifted-`CopySource` mutation below produced — S3 threw and failed;
- and against the wrapper-only matcher, that same decode error was recorded as an outcome and S3
  reported **PASS**, printing `same-lineage-additive="refused: litestream restore exited 1: Error:
decode database: …"`. That is the defect the words-matcher removes, and it is the shape the `LS`
  control above already paid for once.

A store error (`NoSuchBucket`) and an output file that is already there and not empty (`cannot
restore, output path already exists and is not empty`) are exit 1 with the same wrapper too, both
measured in `src/litestream.ts`; each of those now fails the scenario as well.

**`same-lineage-rows=0` means no restore happened**, not that a restore came back empty — there is no
database to count rows in when litestream declines. Read `same-lineage-additive` first; it is what
separates the two.

**What S3 is not evidence about.** Not `packages/fiscal-verifactu`: every table here is the rig's
model. Not whether an additive copy is safe into an EMPTY destination — nothing here copies into
one. Not whether copying is how a real node should re-home a replica; this measures what a copy
does, not what the product should do. And not a lower bound on the compaction settings or on how
long a deletion takes: the part waits for the effect and reports how long it waited.

**S3 found a flake in the rig itself, and it is fixed at the root.** S3 is the first scenario to
write to a database while a litestream DAEMON is reading it, and on one full run it failed with
`database is locked`. Both halves of the cause were established by running a node that sold every
5ms for twelve seconds against a daemon on the fast compaction settings — about 1800 writes each
time, on 2026-09-18, and run twice by different people: a busy timeout alone left 16 refusals on the
first run and 15 on the second; `BEGIN IMMEDIATE` alone, with no timeout, left 19 and then 15; the
two together left 0 on both. The counts move run to run — what reproduced is that either change
alone leaves writes refused. `model.ts` now opens every node with `PRAGMA busy_timeout = 5000` and
begins every write transaction with `BEGIN IMMEDIATE`. Every other scenario's verdict line still
reads exactly as its own recorded run did.

**Why the timeout alone is not enough**, corrected twice on 2026-09-18. The first correction got the
journal mode wrong: it read a `delete`-mode control as though it described the case the fix is
about, and by the time box-a is writing under a `replicate` daemon litestream has switched the file
to WAL (`src/litestream.ts` records `PRAGMA journal_mode` reading `delete` before a run and `wal`
after). The three results below are kept apart deliberately.

**The `delete`-mode finding, as a `delete`-mode finding.** Two connections on one file, nobody
holding a write lock: with the first on `BEGIN` alone, the second's `BEGIN EXCLUSIVE` was
`ACCEPTED`; with the first on `BEGIN` and then one `SELECT`, the second's was refused, "database is
locked". So in that mode a plain `BEGIN` takes no lock and the first READ takes one.

**The same probe in WAL does not reproduce the read-lock half.** Both cases were `ACCEPTED`: a
reader there blocks nobody.

```
mode=delete A=begin-only    -> B BEGIN EXCLUSIVE ACCEPTED
mode=delete A=begin+select  -> B BEGIN EXCLUSIVE REFUSED: database is locked
mode=wal    A=begin-only    -> B BEGIN EXCLUSIVE ACCEPTED
mode=wal    A=begin+select  -> B BEGIN EXCLUSIVE ACCEPTED
```

**The outcome the fix rests on reproduces in BOTH modes.** A second probe, with a holder process
taking `BEGIN IMMEDIATE` and keeping it for 1500ms while the probe connection carried
`PRAGMA busy_timeout = 5000` (node v26.7.0, `node:sqlite`, measured 2026-09-18):

```
mode=delete style=deferred  -> REFUSED database is locked elapsed-ms=0
mode=delete style=immediate -> ACCEPTED elapsed-ms=1590
mode=wal    style=deferred  -> REFUSED database is locked elapsed-ms=1
mode=wal    style=immediate -> ACCEPTED elapsed-ms=1613
```

"deferred" is what `recordSale` does under a plain `BEGIN` — read `chain_head`, then insert — and in
both modes it is refused at once with the timeout set, while the same connection asking up front
with `BEGIN IMMEDIATE` waits the holder out and commits. **WHY the deferred one is refused differs
by mode, and this rig has not established it**; the `delete`-mode read-lock story above does not
carry over to WAL, and nothing was run that would settle the WAL case.

**The five seconds is not justified by a measurement.** It is a bound on a stall, and nothing here
has measured how long a litestream checkpoint holds the file — the wait it exists for. The only wait
on record is an ARTIFICIAL one the probe above chose: a 1500ms hold, waited out in 1590ms and 1613ms
because the wait also covers the holder's commit. That is a fact about the probe. The number is
deliberately large rather than dialled to anything.

**The numbers in the verdict line are not fixed.** Box-a sells for as long as the wait takes, so
`direct-rows`, `source-keys` and `deletion-waited-ms` differ run to run — 15, 16 and 19 rows across
three runs, all correct. `mirror-deleted` and `control-stale` move with them: they count the foreign
objects whose names box-a's replica did not happen to reuse.

**`deletion-waited-ms` is QUANTISED to the poll interval, and is neither the store's latency nor
litestream's.** It times the polling loop alone, and that loop is sell, sleep a quarter-second, list
— so a deletion that lands mid-sleep is not seen until the next poll, and the number is a wait
rounded UP to the next 250ms. The sleeps are the measurement's RESOLUTION, not overhead sitting on
top of the wait: subtracting them leaves a figure nothing measured, and an earlier version of this
paragraph invited exactly that by setting the sale cadence against the total. Read it as "the fast
compaction settings did produce a deletion within this long, to a resolution of 250ms", and never as
a latency. Corrected 2026-09-18 twice over: until that day the clock also covered opening box-a, its
first three sales, the config write, the daemon spawn, the daemon's kill and the final one-shot —
setup and teardown, now outside it.

S3's recorded run — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter
@waitron/bench-sqlite-failover scenarios`, 2026-09-18:

```
| id | title | verdict | detail |
| --- | --- | --- | --- |
| S3 | a copied replica equals a direct stream | PASS | version=0.5.17 source-keys=6 source-deleted=1 deletion-waited-ms=4164 direct-rows=19 foreign-keys=9 copied=6 mirror-deleted=6 copied-rows=19 copied-sha-equal=true control-foreign-keys=9 control-copied=6 control-stale=6 control-rows=9 control-nodes=[box-b] control-integrity="row 1 missing from index sqlite_autoindex_chain_head_1" control-refused="the copied replica restores an intact database" same-lineage-stale=1 same-lineage-rows=19 same-lineage-additive="identical" |
```

That run's exit code is 1, and S3 is not why: S2 is the critical FAIL the runner reports.

**Part A was watched to fail first**, on the one thing this task added that did not exist: with the
scenario written and `src/copy-up.ts` absent, the runner reported
`s3_copied_replica | threw | FAIL | Cannot find module …/src/copy-up.ts`. Every assertion below was
then driven by its own mutation. Each was applied on its own and the scenario run, on 2026-09-18,
and every file was restored from a copy kept outside the repository afterwards:

- the stream left on litestream's DEFAULT compaction settings (`fastCompaction: false`) → "litestream
  deleted none of the 131 replica files it wrote under venues/v1/gen-1-box-a within 120000ms —
  nothing below is measuring a propagated deletion". That is the negative control for the four
  config keys: 131 files written, none removed, in two minutes;
- box-a's own rows captured under a node id nothing wrote → "box-a kept selling while the daemon
  streamed";
- the source database left on disk instead of deleted before the restores → "the source database is
  gone before any restore". That deletion is what makes every comparison below a statement about the
  STORE rather than about the file next door;
- Part A's copy made additive → "after the mirroring copy the destination holds exactly the source's
  objects and nothing else";
- Part A's restore pointed at the early-copy prefix, which holds a subset → "the copied replica
  restores the same ledger rows as the direct stream";
- the capture of box-a's rows made to drop its last record → "those rows are the ones box-a itself
  wrote, field for field";
- the hash made to depend on the file's path as well as its bytes → "the two restored files are byte
  for byte the same database";
- the reader made to return no chain tips for the copied restore → "the copied replica restores the
  same chain tips as the direct stream";
- the reader made to report the DIRECT restore damaged → "the directly streamed replica restores an
  intact database";
- the control given the real rule back (`propagateDeletions: true`) → "an additive copy deletes
  nothing from the destination", so the control is not green by construction;
- the same, with that assertion removed as well → "the additive copy leaves the foreign lineage's
  objects under the destination";
- the control's destination left clean, the foreign lineage streamed to a prefix of its own → the
  same "the additive copy leaves the foreign lineage's objects under the destination", which is the
  assertion that keeps the control from copying into an empty prefix and proving nothing;
- the control's destination dirtied with box-a's OWN lineage instead of a foreign one → "Part A's
  comparison refuses the database the additive copy restores". That is Part C's finding arriving in
  Part B: same-lineage leftovers do not diverge, so the control needs a FOREIGN lineage to refuse;
- the same-lineage copy taken AFTER the stream instead of during it → "the early copy holds at least
  one object the source has since deleted";
- Part C's second copy made to mirror → "the second additive copy still leaves the source's deleted
  objects in place";
- the foreign lineage never synced → "the foreign lineage streamed nothing under
  venues/v1/gen-2-box-a";
- every object copied under the RIGHT key but with another object's BYTES — `CopySource` shifted by
  one, so the destination's key set still matches the source's exactly → the restore itself is
  refused, `litestream restore exited 1: Error: decode database: decode header: non-contiguous
transaction ids in input files: (0000000000000002,0000000000000002) ->
(0000000000000001,0000000000000001)`. So what catches an object copied wrongly under a right name
  is litestream's own decode, not any comparison in this file: the scenario fails by throwing, which
  the runner reports as a critical FAIL. The comparisons above ARE each driven by a mutation, but by
  mutations of what the scenario READS — the restore pointed at another prefix, the hash made
  path-dependent — and no mutation of the COPY reaches them, because a wrong key set is refused by
  the object comparison first and wrong bytes are refused by litestream;
- `copyUp` given one prefix twice → it throws `copyUp was given one prefix twice: venues/v1/gen-1-box-a`,
  and given a destination nested under the source → `copyUp prefixes overlap: venues/v1/gen-1-box-a
and venues/v1/gen-1-box-a/nested`. A scenario that throws is reported by the runner as a critical
  FAIL under its filename.

Two assertions have no mutation of their own, and saying which is cheaper than implying otherwise:

- "the copied replica restores an intact database" is never driven by a mutation, because it fires on
  every UNMUTATED run: it is the assertion Part B's control refuses on. The mutation above drives its
  twin on the direct side instead;
- `suffixesUnder`'s "… is not under …" guard. Every key it is handed comes from `store.listKeys`,
  which filters by that prefix, so no mutation of the scenario reaches it; it guards a later caller
  passing a listing from somewhere else.

The SKIPPED path was run rather than read, because a critical scenario that quietly starts a
container while claiming it was skipped is the failure that would hide. With `.bin/litestream` moved
aside and no `litestream` on `PATH` (`command -v litestream` finds none on this host), the scenario
was called directly from a throwaway file with a `startStore` that throws if it is ever reached, and
returned `S3 SKIPPED critical=true litestream v0.5.17 not found; … — S3 is UNPROVEN until then`. The
control in the other direction — the same call with the binary back — printed `THREW PROBE:
startStore was called`.

## What S4 measures, and what it does not

S4 is the multi-day offline write load. It asks what a box does to its own WAL, and to the cashier's
wait, while litestream cannot reach the store and `wal_autocheckpoint = 0` leaves nobody else to
checkpoint — topology design §13's risk 9 and §10's finding 8. It is a MEASUREMENT (spec §7): its
verdict is `MEASURED` unless a stated bar is breached, and a BREACH is `FAIL` with `critical: false`,
which stops nothing. A THROW is the other path and it is not covered by that sentence: the runner
records a scenario that throws as a critical FAIL under its FILENAME, so every path below does stop
the run.

**This is the one list of them.** `s4_offline_load.ts` points here rather than restating it: two
lists of these paths were written inside a single commit, they disagreed, and both were short.

- either arm, whenever a litestream daemon is started: `waitForAttach`'s deadline, 30 seconds with
  no sidecar directory beside the database, which is a daemon that never attached;
- either arm: the two pragma readbacks — `journal_mode` is `wal`, `wal_autocheckpoint` is 0;
- the offline arm: `createUnreachableStore`'s refusal probe, which will not hand back an
  "unreachable" store whose port accepted a connection;
- the offline arm: the WAL floor, at least one SQLite page a sale;
- the offline arm: it committed all 7500 `records` rows its load drives;
- both arms together: the plateau comparison, `PLATEAU_FACTOR`;
- the control arm: it committed the same 7500;
- the control arm: at least one of its fifteen rounds checkpointed.

The last three are listed in the order the file runs them, and that order is deliberate — only the
first assertion to throw prints its message, and `s4_offline_load.ts` says why the plateau comparison
goes ahead of its own two preconditions.

A run without the pinned binary drops the daemon, the control arm and the container, so only three of
those are reachable in it: the pragma readbacks, the WAL floor and the offline arm's row count — see
"Without the pinned binary" below.

**The volume mapping, and the assumption inside it.** `SALES_PER_DAY = 250` and `DAYS = 30`, so 7500
sales. **250 a day is an ASSUMPTION and not a measurement** — nothing in this repository records the
deli's real ticket count, and the nearest stated figure,
[`bench/pglite-throughput/src/bench.ts:60-78`](../pglite-throughput/src/bench.ts), models the worst
realistic MINUTE (16 sales a minute across four tills), which implies no daily total whatever. Every
figure below is therefore also given per sale, so a reader who knows the real rate can rescale it.
And the load is **volume, not wall-clock** (spec §9): thirty days of trading driven through in about
half a minute, so nothing here says anything about a quantity that turns on elapsed time.

**Both arms pause between rounds, and that took a restructure.** Part A (offline) and Part B
(reachable store) drive the identical load — fifteen rounds of five hundred sales with a 1500ms idle
after each — and differ in ONE thing, whether the config names a live MinIO or a closed port. The
first shape drove all 7500 sales back to back, and a mutation is what showed that shape measured
nothing about being offline: pointed at a live store instead of the closed port, it recorded
`peak-wal-bytes=310759272`, the offline figure, because 7500 sales finish in about a second and
litestream never gets a turn. The idle is a cadence this rig CHOSE — it is not a model of a trading
day, and litestream documents no such number.

**The bars, and where each comes from.**

- p95 ≤ 150ms and p99 ≤ 400ms are the pglite bench's, `bench/pglite-throughput/src/bench.ts:82-83`,
  and their justification is the cashier's perceived wait at `bench.ts:75-78` — the receipt cannot
  print until the commit lands. Spec §4's S4 asks for exactly this reuse.
- Peak WAL ≤ 64KiB a sale is a **stated ceiling and not a derived one**. Nothing in this repository
  records the appliance's partition size, so it is not a disk guarantee and must not be read as one.
  What it bounds is an AVERAGE: the run's peak WAL divided by its sale count, and it sits well above
  what a commit costs in this model's schema — about **40.3KiB** a sale, which is 41,271 bytes on the
  recorded run. That figure is given in KiB so that it and the ceiling are the same unit: read as
  "41KB against 64KiB" the two are not comparable, and elsewhere in this file the same quantity is
  written 41KB in decimal. It establishes **nothing about the
  SHAPE of that growth**, and the earlier wording here — that a breach meant super-linear growth
  rather than growth — was falsified by running it. With SQLite's page size set to 8192 and
  everything else identical (2026-09-18), the same load gave 194,489,184 WAL bytes at 2500 sales,
  390,909,096 at 5000 and 588,544,976 at 7500 — 77,796, 78,182 and 78,473 bytes a sale: linear the
  whole way, and over this ceiling the whole way. So a breach can equally mean a wider page, a wider
  schema or another index. Saying anything about the shape needs a comparison ACROSS load sizes,
  which this scenario does not drive.
- A FLOOR of one SQLite page a sale (4096 bytes) is a precondition rather than a bar: under it,
  something checkpointed and Part A is not measuring an offline WAL at all. It bites — see the
  mutations below.

**What the recorded run measured.** The commit does not slow down as the WAL grows: p50 0.128ms,
p95 0.312ms, p99 0.436ms, max 1.583ms, and the LAST modelled day's p95 (0.143ms) is below the FIRST
day's (0.382ms), which is the direction a first-run warm-up goes and not drift. The pglite bars are
passed by two to three orders of magnitude. The WAL reaches 309,531,512 bytes — 41,271 a sale.

**Which of these numbers move, measured rather than guessed.** The run above is one of several taken
on this machine in this shape, by two people and a review seat, and they do not agree to the digit.
The **per-sale WAL rate is the stable one**: 41,206, 41,237, 41,271, 41,317, 41,347, 41,352, 41,353,
41,379, 41,387, 41,413 — ten figures spanning 207 bytes, which is 0.50% of the smallest, and that is
why the ceiling is expressed per sale. That spread is itself a number to distrust: it was written
here as "176 bytes, 0.43%" over nine figures and the very next run, 41,206, widened it. The
**latency percentiles move with the machine**: over seven runs of the OFFLINE arm, p95 between
0.297ms and 0.333ms, p99 between 0.433ms and 0.528ms, max between 1.583ms and 4.426ms — two to three
orders of magnitude clear of the 150ms and 400ms bars, and the max has no bar of its own.

**Ten against seven is not a counting slip: the two lists are not the same set of runs.** One of the
three extra per-sale figures is identified — 41,413 came from the injected-stall mutation listed at
the end of this section, which the first draft of this paragraph (commit `c593a58a`) labelled, with
41,189, as "under two mutations that do not touch the write path". That run's p95 of 0.174ms and p99
of 450.105ms describe the injected stall rather than this rig, so they are left out of the range
above deliberately. The other two are NOT identified: the record does not say which run produced
which figure, so the lists cannot be paired run by run and neither is a sample of the other. Read
each as a spread and nothing more.

Every one of those figures is the OFFLINE arm's, which is the thing to check before quoting one: the
control arm's percentiles are printed separately in the same row, and its 0.244ms p95 belongs to that
arm and not to this range. The **reclaim timings move the most** and are treated below. Anything
quoted here as a single number is one run's figure, not a property of the rig.

**The amplification is about 80x, and the spec's illustrative ceiling is NOT met.** After the control
checkpoint completes, the database holds 3,862,528 bytes of the 310MB the WAL held. Spec §4's S4
offers "a small multiple of the streamed data" as an example ceiling; eighty times is not a small
multiple, so **that formulation was not adopted as the bar** and `MAX_WAL_BYTES_PER_SALE` is what the
verdict uses. The scenario prints `spec-small-multiple-ceiling=not-met` rather than quietly
substituting a bar that passes — and it prints it by COMPARING this run's amplification against a
stated `SPEC_SMALL_MULTIPLE` of ten, so the label is read off the measurement instead of being a
sentence about it that a later change could leave standing. The figure slice 2 actually needs is the last one on that line:
`offline-days-per-gib=104.1` — at the assumed 250 sales a day, about 104 days of offline trading per
GiB of WAL, arithmetic over the measured rate rather than a box that ran that long.

**Risk 9's own question — can WE get the WAL back? Not while the daemon is there.** Part C times one
`PRAGMA wal_checkpoint(TRUNCATE)` from our own connection, twice. With the offline daemon still
running it took **6,776.9ms**, answered `busy=1 log=75129 checkpointed=4`, and left the WAL file
exactly as it was. The daemon was then killed and the same statement took **7.5ms**, answered
`busy=0 log=0 checkpointed=0`, truncated the WAL to zero and left the database at 3,862,528 bytes —
so the pages did move.

**How much of that reproduces, and how much is one run's number.** What reproduced in every run that
reached it — both shapes of this scenario, two hand-written probes, and runs by two people — is the
SHAPE: with the daemon there, `busy=1`, `checkpointed=4` against a `log` of about seventy-five
thousand (75,129 on the recorded row, and 75,020, 75,067 and 75,341 on three others), and a WAL file
the same size afterwards as before; with the daemon gone, `busy=0` and a WAL truncated to zero.
**The durations are not stable and an earlier draft of this section overstated them.** It said "11.7s
to 12.5s … every time", which the run recorded above then falsified at 6.8s. Measured so far: twelve
BLOCKED durations — 6.8s / 7.3s / 7.8s / 7.8s / 8.0s / 8.2s / 8.2s / 11.7s / 11.9s / 12.0s / 12.4s /
12.4s, 6776.9ms at the fastest and 12412.2ms at the slowest — and twelve UNBLOCKED ones — 4.2ms /
5.1ms / 7.5ms / 14.9ms / 18.0ms / 21.0ms / 21.7ms / 22.1ms / 23.9ms / 26.8ms / 27.0ms / 48.6ms. Three
entries in each list are a review seat's runs of this scenario on this machine.

**Twelve and twelve is not twelve pairs**, and the two lists do not come from one set of runs: the
21.7ms is the without-a-binary run recorded further down, which starts no offline daemon at all and
so contributes an unblocked figure and no blocked one. At least thirteen runs sit behind the two
lists, and which unblocked figure belongs with which blocked one is not recorded. So the honest
statement is **seconds against milliseconds**. The pairs those lists ALLOW span 139x to 2955x — two
to three orders of magnitude, not three, and not any particular number of seconds — but a pair taken
from lists this loosely joined is a bound on the gap and not a measurement of it; the pairs that
certainly come from ONE run are tighter — 903.6x on the run recorded above (6776.9ms against 7.5ms),
and 521.9x and 291.1x on the two clean runs taken while this section was being corrected (7775.6ms
against 14.9ms, 7801.2ms against 26.8ms). One decimal place, because 6776.9/7.5 is 903.59 and both
"903x" and "904x" have been written for it.

What the three numbers in that row MEAN is SQLite's business and this rig has not established it:
reading `log` as a count of frames is an interpretation. It is an EXACT fit, which is worth stating
and is still not evidence — a WAL frame is a page plus a 24-byte frame header and the WAL file
carries a 32-byte header of its own, so 32 + 75,129 x (4096 + 24) is 309,531,512, the WAL byte count
to the byte. What is READ is `busy` and the file sizes either side.

**Two things that pair does not show.** It does not show what a SALE would have done during the
seconds the checkpoint was blocked: this rig is one process and the checkpoint is synchronous, so no
sale was attempted while it ran. The sale that is measured is the one immediately AFTER, and it
committed in 0.241ms.
And nothing in the product is driven here — no code path in `packages/` asks for this checkpoint;
what was measured is a rig calling the pragma itself.

**`wal_autocheckpoint = 0` is not what makes the offline WAL grow — the attached daemon is.** This
came out of the mutation that drops the pragma, which did NOT collapse the WAL, and it needed its own
2x2 before anything could be said about it. A scratch script outside the repository, driving this
rig's `openNode` and `recordSale` for 7500 sales in each of four configurations, one run each
(2026-09-18, node v26.7.0, litestream 0.5.17):

```
no daemon,      wal_autocheckpoint = 0     -> wal 308,513,872 (41,135/sale)  db 57,344
no daemon,      wal_autocheckpoint = 1000  -> wal   4,185,952 (558/sale)     db 3,862,528
offline daemon, wal_autocheckpoint = 0     -> wal 310,137,152 (41,352/sale)  db 57,344
offline daemon, wal_autocheckpoint = 1000  -> wal 309,552,112 (41,274/sale)  db 65,536
```

With nothing attached the pragma decides everything; with an offline litestream attached it decides
nothing, because SQLite's own automatic checkpoint is refused the same way our explicit one is. Read
narrowly, that WIDENS risk 9 rather than answering it: the unbounded WAL does not depend on the
pragma the risk is conditioned on. Nothing in the rig re-runs this 2x2 — it is a probe, and the
scenario keeps the pragma set because that is the configuration topology §4.2 specifies.

**Without the pinned binary S4 does not report SKIPPED** — unlike S0 and S3, it degrades. It runs the
offline load with no daemon and no container at all, and its row then reads
`version=absent offline-daemon=no-litestream-v0.5.17 … reclaim-offline=no-litestream-v0.5.17
control=no-litestream-v0.5.17`. That state was run rather than read, with `.bin/litestream` moved
aside and no `litestream` on `PATH`, against a `startStore` that throws if it is ever reached:
`MEASURED … peak-wal-bytes=310145392 wal-bytes-per-sale=41353 … reclaim-control="ms=21.7 busy=0
log=0 checkpointed=0 wal=310145392->0 shrank=true"`, and the probe was never called. What those
numbers describe is SQLite with automatic checkpointing off and nothing else: no reachable-store
control, and no risk-9 reclaim pair.

**What S4 does NOT establish**, stated because a reader will assume some of it:

- **that litestream tried and failed — the SCENARIO does not show this, though a probe does.**
  Against the closed port the daemon stays up, which is all the scenario observes
  (`offline-daemon-alive-after-load=true`); it reads neither the daemon's log nor the store. A
  scratch probe outside the rig did read that log, and litestream 0.5.17 does try and does fail: one
  run on 2026-09-18, a daemon against `http://127.0.0.1:1` with a node selling throughout, logged its
  eight startup lines and then, **116 seconds after starting**, one line —
  `level=ERROR msg="sync error" … error="check database behind replica: get replica position:
operation error S3: ListObjectsV2, exceeded maximum number of attempts, 10, … dial tcp
127.0.0.1:1: connect: connection refused" consecutive_errors=1 backoff=1s`. A second probe of the
  same shape, a review seat's against a closed port on this machine, logged its first `sync error` at
  **125,628ms**. So: two runs, 116s and 125.6s, and the delay is not a constant — neither run
  establishes what sets it. Two things follow, and
  the second is why the hedge stays. The endpoint really is refusing it, so the offline arm is a
  litestream that cannot reach its store rather than one sitting idle. And **S4's own daemon does not
  live that long** — arithmetic over the recorded row, not a measured wall time: it is alive from
  `offline-attach-ms` (1114ms), through fifteen rounds each carrying a 1500ms idle (22.5s), to the
  end of the held-up checkpoint (6776.9ms on that row; 12.4s at the slowest ever measured), plus the
  second or so the 7500 sales themselves take. That is about half a minute, and under forty seconds
  even with the slowest checkpoint. So within an S4 run that line never appears. WHY the first failure takes nearly two minutes was not established: the
  line names ten exhausted attempts, which is the SDK's retry budget, and a refused connection
  returns at once, so something between those attempts accounts for the rest — this probe did not
  look. A reader watching an S4 run should expect a silent daemon, and that silence is not evidence
  either way.
- **anything that turns on elapsed time.** The load is volume; thirty modelled days pass in half a
  minute.
- **anything about the real ledger's cost per commit.** The ~41KB a sale is this rig's own MODEL
  (`model.ts`) with its indexes at SQLite's default page size, not
  `packages/fiscal-verifactu`'s schema.
- **that a LONGER offline stretch stays linear.** The run stops at 7500 sales; `offline-days-per-gib`
  extrapolates the measured rate and measures nothing beyond it.
- **a disk budget.** The WAL ceiling is stated, not derived from any partition size — this repository
  records none.

S4's recorded run — `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/bench-sqlite-failover
scenarios`, 2026-09-18:

```
| id | title | verdict | detail |
| --- | --- | --- | --- |
| S4 | offline write load | MEASURED | version=0.5.17 sales=7500 days=30 sales-per-day=250 day-rate=assumed-not-measured rounds=15 idle-ms=1500 offline-daemon=ECONNREFUSED offline-attach-ms=1114 offline-daemon-alive-after-load=true p50-ms=0.128 p95-ms=0.312 p99-ms=0.436 max-ms=1.583 first-day-p95-ms=0.382 last-day-p95-ms=0.143 peak-wal-bytes=309531512 wal-bytes-per-sale=41271 offline-checkpoint-rounds=0/15 checkpointed-db-bytes=3862528 wal-amplification=80.1x spec-small-multiple-ceiling=not-met spec-small-multiple=10 offline-days-per-gib=104.1 reclaim-offline="ms=6776.9 busy=1 log=75129 checkpointed=4 wal=309531512->309531512 shrank=false" reclaim-next-sale-ms=0.241 reclaim-control="ms=7.5 busy=0 log=0 checkpointed=0 wal=309568592->0 shrank=true" control="peak-wal=20974952 end-wal=20974952 db=3854336 store-keys=35 checkpoint-rounds=15/15 p95-ms=0.244 p99-ms=0.382" breaches=none |
```

That run's exit code is 1, and S4 is not why: S2 is the critical FAIL the runner reports. Every other
scenario's row in it matches its own recorded run above VERBATIM — S0, S1, S2, S5, S6, LS — with one
exception the S3 section already covers: its `deletion-waited-ms` read 3857 against the 4164 recorded
there, and its `direct-rows`, `copied-rows` and `same-lineage-rows` read 18 against 19, which are the
numbers that section says move because box-a sells for as long as the wait takes. The three row
counts stayed EQUAL to each other, which is what S3 asserts. That comparison was run twice, on two
whole-suite runs taken from this branch.

`offline-checkpoint-rounds=0/15` against the control's `checkpoint-rounds=15/15` is the pair to read
first: it counts the rounds that left the main database file larger, which is where a checkpoint
moves pages to. The window is the WHOLE round — the size is read at the top, before the round's five
hundred sales, and compared again after the idle — so what it reports is that a checkpoint happened
somewhere in the round, not that it happened during the idle.

**The red was watched on the module import, not through the runner.** With the scenario written and
`src/unreachable-store.ts` absent,
`node -e "import('./src/scenarios/s4_offline_load.ts')"` from `bench/sqlite-failover` gave
`Cannot find module …/src/unreachable-store.ts imported from …/src/scenarios/s4_offline_load.ts`.
The runner reports a scenario that throws under its FILENAME with `error.message` as the detail
(`src/scenarios.ts`), so that is the string its row would have carried — read off the runner, not
run.

Every assertion in the throw list above except `waitForAttach`'s deadline was then put to mutation,
along with the two latency bars, each mutation applied on its own and the scenario run whole, with
the files restored from copies kept outside the repository afterwards (2026-09-18). Two things have
NO mutation of their own, and naming them is cheaper than a completeness claim this list does not
support: `waitForAttach`'s 30-second deadline, and the per-sale WAL CEILING — no mutation drove
`wal-bytes-per-sale` over 64KiB through the scenario, though the 8192-byte page-size probe recorded
above sat over that ceiling from end to end, at 77-78KB a sale. The mutations that END IN A THROW —
every one below except the stall and the deleted pragma — are reported by the runner as
`s4_offline_load … FAIL critical=true` under the filename, not as an S4 row:

- **the `wal_autocheckpoint = 0` pragma and its readback deleted → NOTHING CHANGED**, and saying so
  is the point: `wal-bytes-per-sale=41189`, `offline-checkpoint-rounds=1/15`, verdict still MEASURED.
  That is the finding in the 2x2 above — under an attached offline daemon the pragma does no work —
  and it means Part A's measurement is insensitive to the pragma in exactly that configuration;
- **the same mutation with the daemon removed as well** (the offline arm called with no binary) →
  "the offline arm's WAL grew 559 bytes a sale, under one page — something checkpointed it, so
  nothing here is measuring an offline WAL". So the floor precondition does bite, and it is what
  catches a checkpoint that happened;
- **the control's daemon never started** → the plateau assertion fails: "with the store reachable the
  WAL plateaus: 309337872 bytes against the offline arm's 309350232 for the same 7500 sales, which is
  under 4x apart". Without the daemon nothing checkpoints, the two arms land on the same number, and
  the control is what refuses that. Those bytes are from a re-run on 2026-09-18, after the control
  arm's three assertions were put in the order the file now has. This mutation makes all THREE of the
  control-arm assertions true at once and only the first to throw prints, so the order decides which
  receipt exists — run as a control on 2026-09-18 with the previous commit's order restored and the
  same mutation applied, what came back was NOT the plateau but "the control arm's rounds left the
  main database file larger in 0 of 15, so nothing checkpointed and its peak of 309667472 bytes is
  not a plateau". That is why the plateau comparison goes first. The earlier run of the same mutation
  read 309659232 against 310413192 — the shape is what reproduces, not the digits;
- **`recordSale` removed from the control arm alone**, its daemon and pauses and readings left alone →
  "the control arm committed 0 rows in `records` against the offline arm's 7500, so the two arms did
  not drive the same 7500-sale load". Before that assertion existed the same mutation returned
  MEASURED with `breaches=none`: a control that sells nothing satisfies the plateau comparison for
  free, because a smaller peak is exactly what the comparison asks for, and its `store-keys=3` does
  not give it away either — an empty database still produced three. Re-run on 2026-09-18 with the
  plateau comparison moved ahead of it, and it still reaches this assertion and prints this message:
  the empty control's peak really does pass the comparison, so the reordering costs this receipt
  nothing;
- **each round driving one sale fewer than the load claims**, `driveLoad`'s inner loop started at 1
  instead of 0 → "the offline arm committed 7485 rows in `records`, not the 7500 its load drives".
  Fifteen missing sales out of 7500 leave the WAL floor untouched, so this is the assertion that
  catches a load which quietly shrank, and it fires in the offline arm before the store is even
  started;
- **the checkpoint-detection window collapsed**, `dbBefore` read after the round's idle instead of at
  the top of the round, so the comparison is a file against itself → "the control arm's rounds left
  the main database file larger in 0 of 15, so nothing checkpointed and its peak of 21106792 bytes is
  not a plateau". The control still plateaued and still committed 7500 rows, so the two assertions
  ahead of this one passed and this is the message that came back — which is what makes it reachable
  at all;
- **the OFFLINE arm pointed at the REACHABLE store** → "the offline arm's WAL grew 2817 bytes a sale,
  under one page…". The floor fires first, before the plateau assertion gets a chance: 2817 x 7500 is
  21.1MB, which is the control's plateau, so the arm that was supposed to be offline had plateaued;
- **a 450ms stall on about 1.1% of the offline arm's commits, inside the timed region** → the bars
  are read off the measurement rather than asserted, so the scenario does not throw: it reported
  `FAIL` with `critical: false` and `breaches="p99-ms=450.105>400"`, p95 untouched at 0.174ms;
- **`PRAGMA wal_autocheckpoint = 0` set to 1000, readback kept** → "automatic checkpointing is off,
  which is the condition risk 9 is about";
- **`PRAGMA journal_mode = WAL` set to DELETE** → "the database is in WAL journal mode". Those two
  are why the pragmas are read BACK rather than just set;
- **`unreachable-store.ts`'s reserved port left LISTENING instead of closed** → "127.0.0.1:53231
  accepted a connection, so it is not an unreachable store". The helper verifies its own premise, and
  that refusal probe is what establishes it.

## What S1's fence is, and what it is not

S1 measures the fence this **rig** uses: one key per term, claimed with a create-only write, under
the venue prefix `venues/v1/` — topology design §2.2 ("Each venue owns one prefix in the store,
`venues/<venue-id>/`"), and the prefix plan Tasks 7 and 8 stream a generation into. That shape is
plan Task 3's.

The **product's** fence is a different primitive: `current.json` written only if its version is
unchanged (topology §5.1), which is compare-and-swap, and which is what the prototype spec's §4 S1
describes. S6 records what the pinned store does with each. So S1's result is evidence that a
refusal by the store stops a double promotion — it is not a measurement of the product's own
conditional write. The results note says so under S1, together with the two parts of the spec's S1
criterion this rig does not model.

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
binary, by one-shot syncs** — not by the streaming daemon, which the `LS` check and S3 start and no
other scenario does — and measured four such rows in one run: see "What S0's loop covers, and what
its Part C records" above.

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
above; the evidence that it works is the recorded run in
[the results note](../../docs/research/2026-09-16-sqlite-failover-prototype.md), not a green CI job.

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
