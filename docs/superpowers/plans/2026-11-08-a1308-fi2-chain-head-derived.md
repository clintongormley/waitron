# A1308 fiscal 2: the chain head is read from the records — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `cadenas`, the stored copy of each node's chain head, and read the head from
`verifactu_records` itself; drop the plain index that duplicates the records' unique position index.
Measure first, on a year of trading grown to 100,000 and 500,000 records, with the fallback (keep
`cadenas`) decided in advance.

**Architecture:** A chain's position (`secuencia`) is unique per node
(`verifactu_records_node_secuencia_uq`, renamed by fi1 from `registros_tenant_node_secuencia_uq`) and
never reset. So the next position is the node's largest `secuencia` plus one, and the previous record
is the node's record at that largest position **if** it was written under the identity this append
uses; otherwise this record opens a new chain (`PrimerRegistro = "S"`). That is exactly what
`cadenas` holds today, written in the same serial write transaction, and exactly what the backup
chain walk already checks (`packages/fiscal-verifactu/src/backup-verification-chain.ts:95-131`).
One indexed read replaces a read of `cadenas`, a read of the predecessor and a write of `cadenas`.

**Tech stack:** TypeScript, drizzle-orm on `node:sqlite`, Vitest; slice 0's bench.

**Spec:** [tables-fiscal.md](../specs/2026-11-02-rationalisation/tables-fiscal.md) §0.1 (the
derivation and its readers), §1.1 (drop `registros_node_secuencia_idx`), §5 (`cadenas` row), §6, §8
item 1; README §5 U6 (`cadenas` deleted), §6 "Performance"; rules
[2026-11-08-a1308-slice-rules.md](2026-11-08-a1308-slice-rules.md).

**Base:** `main` after fi1. Names below are fi1's (`verifactu_records`, `verifactuRecords`,
`verifactu_identities` …). Line numbers were read at `a086eedfb7` with the old names; fi1 renamed
words without moving lines, except in the six renamed schema files.

**Owner lands:** yes (rules §6: it changes how the chain's predecessor, a hashed input, is found).

**Pull request's first line:** "Every venue is reset: fiscal-verifactu; backups and exports from
before this cannot be restored or imported."

## Global Constraints

- Rules §1–§9 apply.
- **The record's hashed inputs do not change.** For every append, the derived head must give the
  same `secuencia`, the same `PrimerRegistro`, and the same `RegistroAnterior` (issuer, number, date,
  huella of the predecessor) that `cadenas` gives today. fi1's record suites pin it.
- No record is read by time to find a head: by `secuencia` only (the clock is what may be wrong).
- Measurement before code (Task 1). The fallback is in "Stop points".

## Review Focus

1. **A new identity's first record.** After `activate` registers a new identity on a node that
   already has records, the next record must be `PrimerRegistro = "S"`, with `secuencia` continuing.
   Pinned by `registro-sif.test.ts:206-248`, `allocation.test.ts`, `restore.sold-node.test.ts`.
2. **A query plan that scans.** The head read and the two walks that named the dropped index must
   each `SEARCH … USING INDEX verifactu_records_node_secuencia_uq`. Pinned by Task 3's plan test.
3. **Timing taken where both answers look alike.** A head read on an empty venue proves nothing; the
   measurement uses 100,000 and 500,000 records (Task 1). A route's timing is too coarse to rely on
   for one read: the read is a small part of a sale's request, so a slower read could hide inside
   the route's spread (a reviewer's point, not measured here). The deciding checks are the query
   plan and a timing of the read statements alone (Task 1 Steps 5–6, Task 5 Step 2); the route
   timings are reported, not judged.

---

## What it builds

- `readChainHead(tx, nodeId, sifId?)` reads only: the node's record with the largest `secuencia`,
  one query. It no longer inserts a `cadenas` row.
- `appendToChain` resolves the identity first, then the head, then builds the record exactly as
  today (`chain.ts:132-262`).
- `esPrimerRegistro(tx, nodeId)` derived: true when the node has no record, or its latest record's
  `sif_id` is not the current identity's.
- `readChainHeight` (Box status) from the records: `height` = largest `secuencia`, `lastAt` = that
  record's `creado_en`; `{ height: 0, lastAt: null }` with no record. Two answers change by design
  (tables-fiscal §0.1: the head is the latest record), listed under "Assertions that change, by
  design".
- `cadenas` deleted with every writer (`registro-sif.ts:59-66` `resetChainHead`, `allocation.ts:448-454`),
  the backup walk's head check (`backup-verification-chain.ts:139-151`), and every list naming it.
- `verifactu_records_node_secuencia_idx` dropped (`schema/verifactu-records.ts`, fi1's name for
  `registros_node_secuencia_idx`, `registros.ts:128` at the cite commit).
- `bench grow-fiscal`, a bench command that grows a built venue's chain, sales and submissions to a
  given number of records, chained and hashed by the module's own functions. fi3, fi4a and fi6 reuse it.
- The first half of tables-fiscal §8 item 1, measured.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| `invoice_series.next_number` and the number half of §8 item 1 | fi3 |
| `daily_closes` and `daily_close_chain` | A1325, which replaces both and lands before fiscal (build order; [its design](../specs/2026-11-06-a1325-close-a-drawer-design.md), decision 10 and "What changes in the existing code"). Nothing of either is left for A1308: tables-fiscal §1.2 is superseded |
| The working-time chain's head (`workforce_chains`) | The people slice (design U6) |
| `registerSif` / `writeReservedSif` themselves | fi9 deletes them; here they only lose `resetChainHead` |

## Interfaces

```ts
// packages/fiscal-verifactu/src/chain.ts
export interface ChainHead {
  /** The node's largest `secuencia`; 0 with no record. Never reset. */
  secuencia: number;
  /** The node's latest record, when it was written under `sifId`; else null (a new chain). */
  ultimoRegistroId: string | null;
  ultimaHuella: string | null;
}
/** Reads only. `sifId` defaults to the node's current identity; with none, the pointer is null. */
export function readChainHead(tx: Transaction, nodeId: NodeId, sifId?: string): Promise<ChainHead>;
```

The shape is today's (`chain.ts:76-80`), so callers and tests that read `ultimoRegistroId` or
`ultimaHuella` keep their assertions.

```text
pnpm bench grow-fiscal --venue <absolute dir> --records <n>
```

Grows the venue in place (the caller works on a copy, as `bench measure` does) until
`verifactu_records` holds `n` rows on the venue's node. Prints the counts of `verifactu_records`,
`sales` and `verifactu_submissions` before and after, and `chains ok` from
`checkFiscalChains` (`handover-chain-check.ts`); exits 1 if that says `broken`.

## Files

**Modify**
- `packages/fiscal-verifactu/src/chain.ts:76-130` (`ChainHead`, `selectHead`, `readChainHead`),
  `:132-177` (`attemptAppend` head and predecessor), `:256-259` (the `cadenas` update goes).
- `packages/fiscal-verifactu/src/registro-sif.ts:47-66` (`resetChainHead` goes), `:106`, `:147`
  (its calls), `:180-199` (`esPrimerRegistro`).
- `packages/fiscal-verifactu/src/allocation.ts:448-454` (the `cadenas` upsert goes).
- `packages/fiscal-verifactu/src/verify.ts:6`, `:42-44` (the `readChainHead` call goes; its comment
  reason was the insert).
- `packages/fiscal-verifactu/src/backup-verification-chain.ts:6`, `:55-63`, `:139-151`.
- `packages/fiscal-verifactu/src/handover-chain-check.ts:8-12` (two tables, not three).
- `packages/fiscal-verifactu/src/backup-verification-history.ts:28` (drop `"cadenas"` from the
  exclusion).
- `packages/fiscal-verifactu/src/schema/verifactu-records.ts` (drop the plain index) and
  `schema/index.ts`, `src/index.ts:30`, `src/classification.ts:17`.
- `packages/fiscal-verifactu/src/filing-cases.ts:25-31` and `submission-alerts.ts:86-88` (the comment
  names the unique index the walk now uses).
- `apps/server/src/chain-height.ts`, `apps/server/src/box-status.ts:21-22` (comment).
- `apps/server/src/testing/fiscal-fixtures.ts:216-241` (the `cadena` option goes),
  `apps/server/src/testing/clear-provision-fixture.ts:43`.
- `scripts/no-till-as-issuer.mjs:89`, `scripts/no-till-as-issuer.test.ts:113`,
  `scripts/schema-constraints.test.ts:55-56`, `:576`.
- `packages/db/src/english-only.ts:64-65` (comment: the fiscal tables it names).
- `packages/fiscal-verifactu/src/vocabulary.ts:21` (`"cadenas"` leaves the module's word list).
- `packages/fiscal-verifactu/src/write-path.e2e.test.ts:310` and `:435`, comments only: each says
  the rollback "reverts `invoice_series.next_number` and the `cadenas` head"; the `cadenas` half
  is cut (fi3 cuts the other). A comment-only hand edit to the fiscal pair, named in the pull
  request; no assertion in the pair changes. Without it the Finish line's grep prints both lines.
- `packages/fiscal-verifactu/test/drain-fixtures.ts:11` (import), `:152` (a read joining `cadenas`
  to the records: becomes the head read from the records), `:203` and `:340` (`update cadenas`:
  deleted), `:522` (`insert(cadenas)`: deleted).
- `packages/fiscal-verifactu/test/fixtures.ts:149-151` (comment naming `cadenas` and
  `cadenas_puntero_ck`) and `:221` (`update cadenas`: deleted).
  Found with `git grep -nw "cadenas\|readChainHead\|esPrimerRegistro\|cadenas_puntero_ck" -- packages/fiscal-verifactu/test packages/fiscal-verifactu/src/vocabulary.ts`.
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (the capture: Task 4).
- Tests that seed or read `cadenas` (101 files name `cadenas`, `readChainHead` or
  `esPrimerRegistro` at `a086eedfb7`, 261 lines; most are an import and one seeding line, deleted).
- `apps/server/scripts/bench/cli.ts` (the new command).

**Create**
- `apps/server/scripts/bench/grow-fiscal.ts`, `grow-fiscal.test.ts`.
- `packages/fiscal-verifactu/src/chain-plans.test.ts` (query plans, Task 3).

**Delete**
- `packages/fiscal-verifactu/src/schema/cadenas.ts`.

**Generated:** `packages/fiscal-verifactu/drizzle/*`, `scripts/migration-baseline-epoch.json`.

## Size

| Counted (hand-written) | Lines, estimated |
| --- | --- |
| Code: chain 40, `esPrimerRegistro` 12, chain height 15, backup walk and handover check 8, lists 8, bench command 210 (with the unique-index check) | ~293 |
| Tests: plan test 70, bench command test 80, re-pointed head and backup cases 120, two chain-height cases 30, allocation set-up 15, demo capture 25, fixtures (two files) 30 | ~370 |
| **Total** | **~663** |

Not counted: deletions (the schema file, `resetChainHead`, the backup head check and its damage
cases, the fixture option, seeding lines), the generated migration. About 3 hours of work plus two
bench builds run as tracked background work.

## Assertions that change, by design

Rules §4. Design reason for both: tables-fiscal §0.1 (the head is the node's latest record by
`secuencia`; nothing else is stored).

| Answer | Before | After | Test |
| --- | --- | --- | --- |
| Box status `chain.lastAt` after a new identity is activated on a node that has records | The activation time: `resetChainHead` (`registro-sif.ts:63`) and the `allocation.ts:448-454` upsert set `actualizado_en` | The latest record's `creado_en`, which may be under the previous identity | None asserts it at `a086eedfb7` (`git grep -n "lastAt" -- '*.test.ts'` hits only `chain-height.test.ts:74`, `:88` and stubbed answers). Task 4 Step 1 adds one, expecting the record's time |
| Box status `chain.lastAt` for a provisioned node with no record | The registration time (provisioning seeds `cadenas` at `secuencia` 0) | `null` | None asserts it (`chain-height.test.ts:68-75` uses an unknown node id); Task 4 Step 1 adds one |

Nothing on a screen reads `chain.lastAt`: `apps/dashboard/src/screens/box-status-rows.ts:233-235`
shows `health.sales.lastAt`, which `apps/server/src/box-health.ts:315` reads from `sales`
(`git grep -n "lastAt" -- apps/dashboard/src` at `a086eedfb7`, read, not run in a browser).

Not an assertion change: `allocation.test.ts:881-893` ("starts an empty chain while retaining its
existing sequence") seeds a `cadenas` row at `secuencia` 13 with no record and expects 13. Read
from the records, that seeding gives 0. Task 2 Step 4 changes its set-up to a real record at 13
(the expected values stay); a version that keeps the old set-up and changes the expected 13 is a
stop (rules §5.3).

## Finish line

```bash
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/chain-plans.test.ts src/chain.test.ts src/chain.concurrency.test.ts src/chain.node-rekey.concurrency.test.ts src/registro-sif.test.ts src/reserved-sif.test.ts src/allocation.test.ts src/restore.sold-node.test.ts src/restore.test.ts src/handover-chain-check.test.ts src/backup-verification-history.test.ts src/index.test.ts src/filing-cases.test.ts src/submission-alerts.test.ts
# and fi1's record suites (fi1 plan, "Finish line")
pnpm --filter @waitron/server exec vitest run src/chain-height.test.ts src/restore-fiscal-e2e.test.ts src/restore-command.archive.test.ts scripts/bench/grow-fiscal.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm exec vitest run scripts/no-till-as-issuer.test.ts scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts scripts/append-only-triggers.test.ts
pnpm --filter @waitron/composition exec vitest run src/composition.test.ts
git grep -nw "cadenas\|cadenas_puntero_ck\|verifactu_records_node_secuencia_idx" -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**' ':!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts' ':!packages/workforce/**' ':!packages/reporting/**'
```

The grep prints nothing (`packages/workforce` and `packages/reporting` use the Spanish word for their
own, different chains). And the measurement (Task 1, Task 5) passes as stated there.

## Expected protection-list difference

Three headers, `composition=fiscal-verifactu`, `database=venue`, one per phase; nothing else. The
same three lines under each (simulated on 2026-11-08 from a list of `a086eedfb7` with fi1's map and
these two removals applied; a prediction):

```text
missing index cadenas.primary key(node_id)
missing index verifactu_records_node_secuencia_idx
missing table cadenas
```

`cadenas` had no append-only trigger (`classification.ts:17`, plain `classify`), so no trigger line.
Its two foreign keys (to `nodes` and to the records) go inside `missing table cadenas`. Design
reasons: tables-fiscal §5, the `cadenas` row ("Dropped with the table … `PrimerRegistro` follows from
whether the latest record on this node is under the current identity") and the
`registros_node_secuencia_idx` row ("duplicates the unique index on the same columns"). No line for
`verifactu_records` itself: its unique indexes, CHECKs, keys and triggers are untouched.

## Stop points (beyond rules §5)

1. **Measurement fails** (Task 1 or Task 5, rules §5.4). Fallback, confirmed by the watcher first:
   keep `cadenas` and every writer; this pull request then only drops the duplicate index (if its
   own plan check passes) and records the measurement in tables-fiscal §8 item 1 and the backlog.
2. Any change to the bytes of a record's hashed fields, to what is sent to AEAT, or to which
   identity or series a sale uses: any of fi1's record suites fails.
3. A test asserting `ultimoRegistroId`, `ultimaHuella`, `secuencia` or `esPrimerRegistro` needs a
   different expected value.
4. `git grep -nw "daily_close_chain\|daily_closes" -- packages apps` finds the tables: A1325 has not
   landed (build order says it lands before fiscal). Ask the watcher.
5. A `readChainHead` caller outside `packages/fiscal-verifactu` relies on the insert it used to make.

## Needs

fi1. Slice 0's bench (`pnpm bench build`, `measure`, `compare`; slice 0 plan Tasks 4–6). A1325 landed.
Slice 0's bench is on branch `feat/a1308-s0-bench`, which was not on `main` (nor pushed) on
2026-11-08 (`git merge-base --is-ancestor feat/a1308-s0-bench main` answered no): it must land
before this slice starts.

**Landed by: owner.**

---

### Task 0: record the base protection list

- [ ] As fi1 Task 0, into `<A>`.

### Task 1: measure before writing the code (tables-fiscal §8 item 1, chain half)

The bench builds a year of real trading through the routes (slice 0 plan, Task 5); a year is about
90,000 bills, and every bill is a sale with one record. Two sizes are needed: 100,000 and 500,000
records. A built year at 400 days gives about 100,000. 500,000 is more than five years, which the
bench does not build ("Out of scope, by decision", slice 0 plan); `bench grow-fiscal` grows it.

**Files:** create `apps/server/scripts/bench/grow-fiscal.ts`, `grow-fiscal.test.ts`; modify
`apps/server/scripts/bench/cli.ts`.

Decisions for `grow-fiscal`:
- It opens the folder with `openVenueDatabase` and works in raw SQL against whatever schema the folder
  holds, so the branch's command can grow a venue the base built (with `cadenas` and `next_number`)
  as well as one the branch built (without them).
- Template: the node's record with the largest `secuencia` among ordinary sales' registrations
  (`corrects_registro_id` null, and its sale's `corrects_sale_id` null), and its sale; a correction
  or void copied would repeat `verifactu_records_corrects_registro_uq`. Each new row copies the
  template's sale (`insert into sales (<every column>) select … from sales where id = ?`, the column
  list read with `pragma table_info`), with a new id and `invoice_number` = the series' largest + 1;
  then a record copying the template record with a new id, that `sale_id`, `secuencia` = largest + 1,
  `num_serie_factura` = `formatInvoiceNumber(<series code>, <number>)`
  (`packages/core/src/record-sale.ts:105`), the four `anterior_*` columns = the previous row's issuer,
  number, date and huella, `primer_registro` = 0, and `huella` =
  `computeHuella(fromRegistroRow(decodeRegistroRow(<the new row>)))` (`@waitron/verifactu`;
  `registro-row.ts`); then a `verifactu_submissions` row in `aceptado` with the template's `csv`.
  Generation time stays the template's, so the clock stop sees no later record than real trading did.
- **Copies are walk-up sales.** Every `sales` column that is in a unique index other than the
  (series, number) one is set to NULL in the copy. At `a086eedfb7` that is `working_order_id`
  (`sales_working_order_id_key`, `packages/db/src/schema/sales.ts:141`: one sale per parked order;
  NULLs are distinct, which is what lets walk-up sales coexist). Copying it would refuse the second
  copy. The command finds these columns at start with `pragma index_list('sales')` and
  `pragma index_info`, so a column the orders-and-sales slices renamed is still found, and exits 1
  naming the column if one is `NOT NULL` (it could not be a walk-up sale then; ask the watcher).
  The pull request says the grown sales are walk-up sales with no bill behind them.
- When the folder has `cadenas`, it sets the node's row to the last grown record; when
  `invoice_series` has `next_number`, it sets it to the largest number + 1. So the base code keeps
  numbering after a grow, as it would have.
- Writes in transactions of 1,000 rows, yielding a timer turn between them (slice 0 plan, "Give
  timers a turn").

- [ ] **Step 1: Write the failing test** `grow-fiscal.test.ts` on a 2-day bench venue
  (`openBenchVenue`, `tradeDay`): grow to `records + 50`; `checkFiscalChains` returns `ok`; record,
  sale and submission counts each rose by 50; the template's sale has a `working_order_id` (asserted,
  so the walk-up rule is exercised) and every grown sale's is null; the next sale through
  `POST /api/sales` succeeds and
  its record's `RegistroAnterior` names the last grown record. Control: grow by 50 with one grown
  record's huella edited before the walk (on a copy, with the append-only trigger dropped in the
  copy): the walk returns `broken`.
- [ ] **Step 2:** Run `pnpm --filter @waitron/server exec vitest run scripts/bench/grow-fiscal.test.ts`. FAIL.
- [ ] **Step 3:** Implement; add `grow-fiscal` to `cli.ts`. Run; PASS. Commit: "Add a bench command
  that grows a venue's fiscal chain (A1308 fiscal 2)".
- [ ] **Step 4: Build the base venues** (tracked background work; check `memory_pressure | grep free`
  and `df -h` first; the year is about 10 GB). In a throwaway worktree of the base commit:
  `pnpm bench build --out ~/waitron-bench/<base-sha>/year --days 400 --seed 1`. Then two
  copy-on-write copies (`cp -c -R`): `100k` as built, and `500k` grown with this branch's command
  (`pnpm bench grow-fiscal --venue ~/waitron-bench/<base-sha>/500k --records 500000`).
- [ ] **Step 5: Plan the derived read on both base venues**, with the app's engine (never the
  `sqlite3` command line, CLAUDE.md §3):

  ```bash
  node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1],{readOnly:true});
  const node=db.prepare("select node_id from verifactu_records limit 1").get().node_id;
  for (const q of ["select id, secuencia, sif_id, id_emisor_factura, num_serie_factura, fecha_expedicion_factura, huella from verifactu_records where node_id = ? order by secuencia desc limit 1"])
    console.log(db.prepare("explain query plan "+q).all(node).map(r=>r.detail));' <venue>/venue.db
  ```

  **Passing:** `SEARCH verifactu_records USING INDEX verifactu_records_node_secuencia_uq (node_id=?)`,
  or the same with the plain `verifactu_records_node_secuencia_idx`, which still exists on the base.
  **Failing:** any line containing `SCAN verifactu_records`, or `USE TEMP B-TREE FOR ORDER BY`.
  A failing result is stop 1.
- [ ] **Step 6: Time the base.** The read the chain code makes, timed alone on each base venue with
  `node:sqlite` (prepared once, run 10,000 times after 100 unmeasured runs, median per call
  reported): today's two reads, timed together as one call,
  `select secuencia, ultimo_registro_id, ultima_huella from cadenas where node_id = ?`
  followed by the predecessor `select id_emisor_factura, num_serie_factura, fecha_expedicion_factura, huella from verifactu_records where id = ?`.
  Keep each venue's median for Task 5. Then, from the base worktree, `pnpm bench measure --venue <100k> --out
  <before-100k.json>` and the same for `500k`; these route timings are reported in the pull request,
  not judged (Review Focus 3).

### Task 2: the derived head (test first)

**Files:** `chain.ts`, `registro-sif.ts`, `allocation.ts`, `verify.ts`, `chain.test.ts`,
`registro-sif.test.ts`.

- [ ] **Step 1: Failing tests** in `chain.test.ts` (existing cases stay as they are):
  - "reads the head without writing": `select total_changes()` on the transaction's connection is
    the same before and after `readChainHead`, on a node with no record (where today's code
    inserts a `cadenas` row) and on one with records. (Whether `cadenas` still exists is Task 3's
    check: the table is only dropped there.)
  - "a new identity opens a new chain on the same node": seed two records under identity A, activate
    identity B (`activate`, as `allocation.test.ts` does), append: the record has `secuencia` 3,
    `primer_registro` 1 and null `anterior_*`; append again: `secuencia` 4 chained to 3.
  - "an append under a supplied identity chains to that identity's latest record": the four calls in
    `backend.ts` pass `sif` inside `appendToChain`'s fourth argument, `reads: AppendReads`
    (`{ sif, chart }` since #2570; `chain.ts:145-149`); the head uses its id.
- [ ] **Step 2:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/chain.test.ts`. FAIL.
- [ ] **Step 3: Implement.** `selectHead` becomes the one query of Task 1 Step 5; `readChainHead`
  returns `{ secuencia: row?.secuencia ?? 0, ultimoRegistroId: row && row.sif_id === sifId ? row.id : null, ultimaHuella: … }`,
  where `sifId` defaults to the current identity read with
  `select id from verifactu_identities where node_id = ? and revocado_en is null` (no throw: none means
  null pointer). In `attemptAppend`, resolve `resolvedSif` before the head, pass its id, and take the
  predecessor's four fields from the same row instead of a second select (`chain.ts:161-177`); the
  "unreachable" branch goes with the second select. Delete the `cadenas` update (`:256-259`),
  `resetChainHead` and its two calls, the `allocation.ts` upsert, and `verify.ts`'s call.
  `esPrimerRegistro` reads `readChainHead(tx, nodeId)` and returns `ultimoRegistroId === null`.
- [ ] **Step 4:** Run the Step 2 file, then `src/registro-sif.test.ts src/reserved-sif.test.ts
  src/allocation.test.ts src/restore.sold-node.test.ts src/verify.test.ts` and fi1's record suites.
  Re-point any test that seeded or read `cadenas`: seeding lines go; an assertion on a `cadenas`
  value becomes the same assertion on `readChainHead`. One needs a real record instead:
  `allocation.test.ts:881-893` seeds `cadenas` at `secuencia` 13 with no record. Seed instead one
  record at `secuencia` 13 under an earlier identity with `seedSoldRegistro`
  (`packages/fiscal-verifactu/test/fixtures.ts:158`, which takes a `secuencia`), then `activate()`;
  the assertion becomes `readChainHead(tx, node.nodeId)` equal to
  `{ secuencia: 13, ultimoRegistroId: null, ultimaHuella: null }`, the same three values. The suite
  seeds no identity before its first `activate()` (`allocation.test.ts:151-155`), so seed one
  identity row first (as `:743-748` does) for the record to name. Elsewhere in
  `allocation.test.ts`: the `it.each` row `["reset chain", "before insert on cadenas"]` (`:738`)
  is deleted with the write it refused (a pure deletion, named in the pull request; its siblings
  stay); `"cadenas"` leaves the table lists at `:622` and `:1012` and the snapshot read at `:657`;
  the read at `:959` becomes `readChainHead`. PASS.
- [ ] **Step 5:** Commit: "Read each chain's head from its records (A1308 fiscal 2)".

### Task 3: drop the duplicate index; pin the plans

**Files:** `schema/verifactu-records.ts`, `filing-cases.ts`, `submission-alerts.ts`, create
`src/chain-plans.test.ts`.

- [ ] **Step 1: Failing test** `chain-plans.test.ts` (`useVenueDb` with the fiscal migrations; capture
  statements as `apps/server/src/history-read-plans.test.ts:26-64` does):
  - the head read during `appendToChain` plans as `SEARCH verifactu_records USING INDEX verifactu_records_node_secuencia_uq`;
  - `heldRecords` (`filing-cases.ts:245`) and the submission-alerts walk (`submission-alerts.ts:86`)
    each plan their `preceding` read with that index;
  - `select name from sqlite_master where name in ('verifactu_records_node_secuencia_idx', 'cadenas')`
    is empty.
  None may contain `SCAN verifactu_records`.
- [ ] **Step 2:** Run it. FAIL (the index and `cadenas` still exist).
- [ ] **Step 3:** Remove the plain index from the schema; delete `cadenas`'s schema file, its exports,
  classification entry, and every list naming it (Files), including the package's word list
  (`vocabulary.ts:21`) and the two test fixture files (`test/drain-fixtures.ts`, `test/fixtures.ts`),
  whose `cadenas` writes would otherwise fail once the table is gone. Run
  `pnpm --filter @waitron/server migration-baseline rebuild --set fiscal-verifactu`. Update the two
  comments to name `verifactu_records_node_secuencia_uq`.
- [ ] **Step 4:** Run the plan test and the Finish line's fiscal-verifactu line. PASS. Commit:
  "Drop cadenas and the duplicate position index (A1308 fiscal 2)".

### Task 4: the readers outside the chain

**Files:** `chain-height.ts`, `box-status.ts`, `backup-verification-chain.ts`,
`handover-chain-check.ts`, `backup-verification-history.ts`, the fixtures, the guards, the demo test.

- [ ] **Step 1: Chain height.** Re-point `chain-height.test.ts`: "no `cadenas` row" becomes "no
  record" (expected `{ height: 0, lastAt: null }`, unchanged); "once a chain row exists" seeds a
  record at `secuencia` 7 with `creado_en` `2026-08-29T10:00:00.000Z` instead of a `cadenas` row
  (expected values unchanged). Implement
  `select secuencia, creado_en from verifactu_records where node_id = ? order by secuencia desc limit 1`.
  One behaviour changes by design (tables-fiscal §0.1): a provisioned node with no record now shows
  `lastAt: null` rather than its registration time; and after a new identity, `lastAt` is the
  latest record's time rather than the activation time ("Assertions that change, by design"). Add
  two cases to `chain-height.test.ts`: a provisioned node with no record gives
  `{ height: 0, lastAt: null }`; a node with a record at 7 under an older identity and a newer
  identity activated afterwards gives height 7 and that record's `creado_en`.
  `box-status.ts:21-22` already says "No records is `chain.height === 0`, never `chain.lastAt`";
  reword its second clause to say the time is null, and `chain-height.ts:4-8`'s comment to say
  where the two values now come from.
- [ ] **Step 2: Backup and handover.** Remove `cadenas` from the walk's table check and node union
  and delete the head check. In `backup-verification-chain.test.ts`, delete only the damage cases
  whose SQL touches `cadenas` (list them in the pull request); every other case stays. The handover
  check counts two tables.
- [ ] **Step 3: Fixtures and guards.** Delete the `cadena` option from `seedFiscalRegistro` and from
  each caller; `"cadenas"` from `clear-provision-fixture.ts`, `no-till-as-issuer.mjs`, its test,
  `schema-constraints.test.ts`. Update `english-only.ts:64-65`'s comment to the fiscal tables'
  remaining Spanish names (column names, not tables).
- [ ] **Step 4: The demo capture.** The capture holds one `cadenas` row in its `provisioned` and
  `seeded` phases (`madrid-before-move.manifest.json` counts, 1 each) and `REMOVED_TABLES` refuses a
  table with captured rows (`seed.madrid-baseline.test.ts:124-131`). Add the case the earlier slices'
  adapter uses for a dropped table that held derivable rows if there is one; otherwise add
  `DERIVED_TABLES = { cadenas: … }`: before deleting the table from the expectation, assert each
  captured row equals the head read from the captured `verifactu_records` (`secuencia` 0 and null
  pointer for a node with none). No other assertion changes.
- [ ] **Step 5:** Run the Finish line except the measurement. PASS. Commit: "The backup walk, Box
  status and the handover check read the chain from its records (A1308 fiscal 2)".

### Task 5: measure after, compare, finish

- [ ] **Step 1:** On this branch build the year again with the same seed and days
  (`pnpm bench build --out ~/waitron-bench/<branch-sha>/year --days 400 --seed 1`), copy and grow as
  Task 1 Step 4, plan as Task 1 Step 5 (passing: `SEARCH … USING INDEX verifactu_records_node_secuencia_uq`;
  the plain index no longer exists), and measure both sizes.
- [ ] **Step 2: Judge.** Time the derived read alone on both branch venues, as Task 1 Step 6 (the
  one query of Task 1 Step 5, same counts). **Failing**, either of: a plan line in Step 1 containing
  `SCAN verifactu_records` or `USE TEMP B-TREE FOR ORDER BY`; or, at either size, the derived read's
  median per call more than twice the base's two reads' median together. That is stop 1.
  Then `pnpm bench compare --before <before-100k.json> --after <after-100k.json>` and the same at
  500k: reported in the pull request (with `sale.counter` and `payment.final` named, since both
  append a record), not judged (Review Focus 3).
- [ ] **Step 3: Protection list:** `pnpm protection-list list --out <B>`, compare with `<A>`; it prints
  exactly "Expected protection-list difference". Paste the report, the four read medians and both
  `bench compare` tables (with machine, commit, row counts) into the pull request.
- [ ] **Step 4: Documents** (rules §9): in tables-fiscal.md §8 item 1 add a dated line with the two
  plans and the compare result; delete "`cadenas`: decide the remaining DELETE restriction (A805
  follow-up)" from "What A1308 retires" (`docs/backlog/architecture.md`), and add to
  `docs/developers/grants-retirement-audit.md` a dated line after `:144` like its existing ones:
  "**2026-11-xx:** `cadenas` was dropped by A1308 fiscal 2; its row needs no decision."
  `docs/developers/conventions-data.md`: replace any sentence that says the chain head is stored
  with "the head is the node's latest record by `secuencia`". At `a086eedfb7`
  `git grep -nw cadenas -- docs/developers` finds only `conventions-data.md:1372`, inside a dated
  measurement (which tables refused their own writers when the trigger wiring went in): a receipt,
  so its words stay (CLAUDE.md §6), and `grants-retirement-audit.md:97`, a historical table row.
- [ ] **Step 5:** Commit; `/finish-branch` (full wave: fiscal is a risk trigger). After it lands,
  `wa-wt reset` the dev slots and the Santet venue.
