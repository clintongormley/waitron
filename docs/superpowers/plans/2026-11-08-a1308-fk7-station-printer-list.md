# A1308 fk7 — a station's printers are a list on the station: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every step also
> follows [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules").

**Goal:** `station_printers` (which printers a kitchen station's tickets print on) becomes
`kitchen_stations.printer_ids`, a JSON list of printer ids, under R4's exception for a short list
owned by one row (owner, 2026-11-04).

**Architecture:** the database can no longer refuse an unknown or duplicate printer in the list, so
the writers do: they already refuse an unknown printer (`attachPrinterToStation`,
`apps/server/src/station-printers.ts:31-36`), and now also keep the list sorted and free of
repeats. Deleting a printer takes its id out of every list (appendix §1.15: nothing in the database
backs that up). Configuration import rewrites the ids inside the list through the devices area's
shared mechanism, which this plan uses and does not build.

**Tech stack:** TypeScript, Drizzle on `node:sqlite` (`json_each` for searches by printer), Vitest,
the slice-1a rebuild command, the dv0 list-reference mechanism.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) R4;
[appendix](../specs/2026-11-02-rationalisation/tables-floorkitchen.md) §1.15, §5 (the two
`station_printers` rows), §8 item 6 (the printer half);
[devices appendix](../specs/2026-11-02-rationalisation/tables-devices.md) §7 ("Configuration export
and import need new code for the JSON lists").

**First line of the pull request:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported."

**Who lands:** the lane (rules §6).

## What it builds

- `kitchen_stations.printer_ids` (`json<string[]>`, not null, default `[]`) with
  `kitchen_stations_printer_ids_ck`, built with dv0's `jsonShapeCheck(t.printerIds, "array")`
  (`json_valid(printer_ids) and json_type(printer_ids) = 'array'`).
- `station_printers` is deleted.
- Writers keep the list sorted ascending and without repeats; attaching a printer that does not exist
  or is inactive is refused `printer.not_found` (as today); deleting a printer removes it from every
  station's list in the same transaction; a station's delete empties its list.
- Every read that joined `station_printers` reads the list through one helper, which offers both a
  join source (for the readers that are one SQL query and must stay one) and a plain read.
- Raises the configuration bundle's format version by one (rules §9): `station_printers` leaves the
  bundle and `kitchen_stations` rows carry `printer_ids`. An export from before is refused as
  outdated, as fk1 set up (`packages/provisioning/src/configuration-transfer.ts:123, 160, 473-476`).
- `printer_ids` travels in the configuration export and arrives naming the importing venue's
  printers (appendix §8 item 6, printer half), through dv0's declaration `jsonReferences: [{ column:
  "printer_ids", paths: [["*"]] }]` on the `kitchen_stations` transfer entry.
- Deletes the backlog entry "`station_printers`: decide the remaining UPDATE restriction (A805
  follow-up)" (`docs/backlog/architecture.md`, "What A1308 retires"): the table is gone.

## What it leaves out

| Left out | Owner |
| --- | --- |
| Refusing an office (A4) printer in a station's list | the devices area, in the pull request that merges `page_printers` into `printers` (appendix §1.15; `tables-devices.md` §7: "A station's printer list must refuse an A4 printer"). Until that merge an office printer is not in `printers`, so `printer.not_found` already refuses it. |
| The import mechanism for ids inside JSON lists | dv0 ([plan](2026-11-08-a1308-dv0-json-list-references.md)) |
| Device and profile printer lists | the devices area |

## Files

- Modify: `packages/db/src/schema/kitchen-stations.ts`; delete `packages/db/src/schema/station-printers.ts`;
  `packages/db/src/index.ts:172`, `packages/db/src/classification.ts:137`,
  `packages/db/src/configuration-transfer.ts:103` (remove the entry; declare `printer_ids` on
  `kitchen_stations` through dv0), `scripts/schema-constraints.test.ts:308-309`.
- Create: `packages/db/src/station-printer-list.ts` and `.test.ts`;
  `scripts/a1308/fk7-station-printer-fixtures.mjs` and `.test.mjs`.
- Modify (writers): `apps/server/src/station-printers.ts:20-105`, `apps/server/src/printer-delete.ts:120-140,
  179`, `apps/server/src/station-delete.ts:98-104, 133, 192`, `apps/server/src/demo-printer.ts:45-50,
  165-175`.
- Modify (readers): `apps/server/src/kitchen-print.ts:155-175` (`printerMappings`),
  `apps/server/src/print-api.ts:1610-1622`, `apps/server/src/print-job-trouble.ts:130-146`,
  `apps/server/src/station-outputs-down.ts:55-75`.
- Modify (lists): `apps/dashboard/src/api/live-queries.ts:111,123,458,500`,
  `packages/venue-service/src/dashboard/live-queries.ts:76,140`,
  `apps/server/scripts/migration-baseline/controls.ts:414-430` (its "primary key columns changed"
  control uses `station_printers`).
- Generated (uncounted): core's starting migration and the epoch file.
- Docs: `docs/developers/conventions-data.md` (add one sentence to "A column of a transferred table
  that holds another row's id…" naming `kitchen_stations.printer_ids` as a list import rewrites, if
  dv0 has not already written the general rule there), `docs/backlog/architecture.md`.

## Size

| Part | Counted lines |
| --- | --- |
| Schema, lists, transfer declaration, control | 40 |
| `station-printer-list.ts` helper | 50 |
| Writers (attach, detach, replace, printer delete, station delete, demo printer) | 80 |
| Readers (four files) | 70 |
| Fixture script config and test | 50 |
| New tests (schema, writer rules, helper, export round trip) | 190 |
| Hand edits to tests (reads of `station_printers` the script reports) | 90 |
| Docs and backlog | 10 |
| Format version, the join source, the assertions above | 50 |
| **Total** | **≈ 630** |

Uncounted: the script's output (about 40 test files name the table), deletions, generated files.

## Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/schema src/station-printer-list.test.ts
pnpm --filter @waitron/server exec vitest run src/station-printers.test.ts src/printer-delete.db.test.ts \
  src/printer-delete-history.test.ts src/station-delete.test.ts src/kitchen-print*.test.ts \
  src/print-api*.test.ts \
  src/print-job-trouble.test.ts src/station-outputs-down.test.ts src/demo-printer.test.ts \
  src/configuration-transfer.test.ts src/configuration-transfer.floor-kitchen.test.ts \
  scripts/migration-baseline scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm --filter @waitron/venue-service exec vitest run src/dashboard/live-queries.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts \
  scripts/live-subscriptions.test.ts scripts/id-columns-are-references.test.ts \
  scripts/starting-migrations.test.ts scripts/write-path-tables.test.ts scripts/a1308
node scripts/a1308/fk7-station-printer-fixtures.mjs --write $(git ls-files '*.test.ts' 'apps/*/src/testing/*.ts' 'packages/*/src/testing/*.ts') && git diff --exit-code
```

Where a named suite has another file name at the base, run what `git ls-files apps/server/src | grep
-E "station-printers|printer-delete|station-delete|outputs-down|print-job-trouble|demo-printer"`
lists.

## Expected protection-list difference

Under all six venue headers unless "change-feed only".

| Table | Lines |
| --- | --- |
| `station_printers` (§5: "moved to code: no duplicates … plus a CHECK that it is a JSON array"; its two FKs "moved to code") | `missing table station_printers`; `missing index station_printers.primary key(station_id,printer_id)`; change-feed only: three `missing trigger waitron_change_station_printers_*` |
| `kitchen_stations` | `extra table kitchen_stations.columns[printer_ids]`; `changed table kitchen_stations.columnOrder`; `extra table kitchen_stations.checks[kitchen_stations_printer_ids_ck]`; change-feed only: `changed trigger waitron_change_kitchen_stations_update.when` |

## Stop points (beyond rules §5)

1. dv0 has not landed, or its `jsonReferences` declaration does not rewrite, prune and refuse the
   ids in `printer_ids` as its plan says: stop; do not build a second mechanism (task brief).
2. A test asserts the database refuses a duplicate or unknown printer pair: the refusal moved to
   code by design (appendix §5); re-point it to the writer's refusal. If the writer's refusal is a
   different code from what the test asserts, stop.
3. After 1a, `apps/server/scripts/migration-baseline/controls.ts` no longer exists or no longer uses
   `station_printers`: skip Task 4 Step 2 and say so.

## Needs

- **dv0** (`docs/superpowers/plans/2026-11-08-a1308-dv0-json-list-references.md`, devices area): the
  import rewrites ids inside a declared JSON list, the export prunes ids of rows it leaves behind,
  and `scripts/id-columns-are-references.test.ts` recognises the declaration.
- fk0 (the splice helpers), fk2 (the other `kitchen_stations` columns; lane order), fk1–fk6.
- Batch 1: 1a, 5.

## Assumptions

- **B5 (dv0), as its plan ([2026-11-08-a1308-dv0-json-list-references.md](2026-11-08-a1308-dv0-json-list-references.md),
  "Interfaces") names them:** `jsonReferences?: readonly { column: string; paths: readonly (readonly
  string[])[] }[]` on `ConfigurationTransferTable` (export drops an id naming no exported row;
  import rewrites each id and refuses one the bundle does not hold); `jsonShapeCheck(column, shape)`
  in `packages/db/src/schema/columns.ts`; `withoutId(value, id)` and `removeIdFromJson(tx, column, id):
  Promise<number>` in `@waitron/db`; and the guard `scripts/id-columns-are-references.test.ts`, which
  requires every transferred column a `json_valid(…)` CHECK names to be in `jsonReferences`, `omit`
  or `JSON_WITHOUT_IDS`. If the landed dv0 differs, use what landed.
- B1, B3, B4 as in [fk1](2026-11-08-a1308-fk1-zone-service-rules.md#assumptions-about-batch-1).

## In-flight work folded in

- A790 Cut A (#2455, venue document printer routing) lands before the devices area and does not name
  `station_printers` (its plan, `2026-11-04-a790-venue-document-printer-routing.md`, searched
  2026-11-08); if it lands first, rebase.
- A405 (printer details, `2026-11-05-a405-printer-details.md`) names printers, not station mappings;
  rebase if it lands first.

## Assertions that change, by design

| Where | Change | Design |
| --- | --- | --- |
| `apps/server/src/configuration-transfer.test.ts:6980` | `transferred.tables.station_printers` equal to one pair → the bundled `kitchen_stations` row for `ids.station` has `printer_ids` equal to `[ids.live]` | §1.15, §5 |
| same file `:7049-7066` (the forged bundle "carrying a deleted printer and a setting naming it") | the forgery puts `ids.old` into the station row's `printer_ids` instead of adding a `station_printers` row; the refusal it asserts (at staging and at import, nothing written) is unchanged, now raised by dv0's import check | §1.15; dv0 decision 3 |
| same file `:7107` | the count of `station_printers` rows becomes a read of the station's `printer_ids` length | §1.15 |
| `apps/dashboard/src/api/live-queries.test.ts:306, :322, :1016` | `station_printers` → `kitchen_stations` (de-duplicated) | §1.15 |
| `apps/server/src/management-api.station-disable.test.ts:129`, `apps/server/src/station-delete.test.ts:146` | `station_printers` leaves each snapshot list | §1.15 |

## Global constraints

- Rules §1–§9. The list holds printer ids only, sorted ascending, no repeats.
- Readers never trust a listed id: every print read keeps its join to `printers` with the `active`
  and `deleted_at` filters it has today (`kitchen-print.ts`, `station-outputs-down.ts`).

## Review Focus

1. **A printer deleted while stations list it** leaves no stale id (a stale id would make the station
   unsaveable: `replaceStationPrinters` refuses a deleted printer, appendix §1.15). Test: Task 2's
   `deleting a printer takes it out of every station's list`.
2. **Attaching an attached printer** changes nothing (today's `onConflictDoNothing`). Test: Task 2.
3. **Two stations listing one printer**, and a search by printer (print problems, delete impact,
   demo printer) finding both. Test: Task 1's helper cases.
4. **An imported venue's stations name the importing venue's printers**, and a printer the export
   left behind is not named. Test: Task 3.
5. **A malformed list** written by hand (`'{}'`, `'"x"'`) is refused by the CHECK. Test: Task 1.

---

## Task 0: Base protection list

- [ ] As fk1 Task 0; keep `<A>`.

## Task 1: Schema and the list helper

**Interfaces (produced), in `packages/db/src/station-printer-list.ts`:**
- `stationPrinterPairs` — a join source for one SQL query: a Drizzle subquery (or, if Drizzle cannot
  name a table-valued function in `.from()`, an `sql` fragment `(select ks.id as station_id, je.value
  as printer_id from kitchen_stations ks, json_each(ks.printer_ids) je) as station_printer_pairs` with
  typed column references `stationPrinterPairs.stationId` and `.printerId`) that a reader joins
  exactly where it joined `station_printers`. The readers that are SQL joins today stay single
  queries on it: `stationPrintersDownQuery` (`station-outputs-down.ts:55-75`, whose plan
  `station-outputs-down.test.ts:175-191` checks through `.toSQL()` and `explain query plan`),
  `printerMappings` (`kitchen-print.ts:155-175`) and the `print-api.ts:1610-1622` read.
- `readStationPrinterPairs(tx: Transaction | Database, filter?: { stationIds?: readonly string[];
  printerId?: string; activeStationsOnly?: boolean }): Promise<{ stationId: string; printerId: string
  }[]>` — one `select … from kitchen_stations, json_each(kitchen_stations.printer_ids)` with the
  filters in SQL, ordered by station id then printer id (the order `listStationPrinters` returns,
  `station-printers.ts:88-92`).
- `withPrinter(list: readonly string[], printerId: string): string[]` — a sorted, de-duplicated copy
  with the printer added. Taking one out uses dv0's `withoutId`; taking a deleted printer out of every
  station uses dv0's `removeIdFromJson(tx, kitchenStations.printerIds, printerId)`.
- `attachStationPrinterForTest(tx, stationId, printerId)` in `packages/db/src/testing/seed.ts` for
  fixtures (appends with `withPrinter`).

- [ ] **Step 1: Write the failing tests.** `kitchen-stations.test.ts`: `refuses a list that is not an
  array` (`kitchen_stations_printer_ids_ck`, with `'{}'` and `'"p"'`); `a new station has an empty
  list`. `station-printer-list.test.ts`: two stations both listing printer P and one listing Q —
  `readStationPrinterPairs` with `{ printerId: P }` answers both stations, with `{ stationIds: [s1] }`
  its two pairs in order; `removeIdFromJson(tx, kitchenStations.printerIds, P)` leaves `[Q]` and
  `[]` and answers 2; `withPrinter` keeps order and adds nothing on a repeat.
- [ ] **Step 2: Run**; expect fail.
- [ ] **Step 3: Implement.** `printerIds: json<string[]>("printer_ids").notNull().default([])` (the
  shape `adjustments.ts:52` uses) and the CHECK. Delete `stationPrinters`, its export, its
  classification, its transfer entry, its `schema-constraints.test.ts` rows (no replacement: the
  keys moved to code); add `jsonReferences: [{ column: "printer_ids", paths: [["*"]] }]` to the
  `kitchen_stations` transfer entry.
- [ ] **Step 4: Rebuild** core; run Step 2; expect pass. **Commit.**

## Task 2: Writers and readers

- [ ] **Step 1: Write the failing tests** (`apps/server/src/station-printers.test.ts`,
  `printer-delete.db.test.ts`):
  - `attaching keeps one sorted copy` — attach P2 then P1 then P2: the list is `[P1, P2]`.
  - `attaching an unknown or inactive printer is refused` — `printer.not_found`, list unchanged.
  - `replacing a station's printers writes exactly the list sent` — `replaceStationPrinters(s, [P3,
    P1])` gives `[P1, P3]`; a deleted printer in the list is refused as today.
  - `deleting a printer takes it out of every station's list` — after the printer delete flow, no
    station's `printer_ids` contains its id, and the delete impact still names the stations that
    listed it.
  - `deleting a station empties its list`.
- [ ] **Step 2: Run**; expect fail.
- [ ] **Step 3: Implement.** `attachPrinterToStation`, `detachPrinterFromStation` (`removeMapping`),
  `replaceStationPrinters` and `listStationPrinters` read and write the station's list (`withPrinter`,
  `withoutId`, `readStationPrinterPairs`); their exported signatures and answers do not change.
  `printer-delete.ts`: the impact read (:120-140) uses `readStationPrinterPairs({ printerId })` (keep
  the impact key `"station_printers"`: it is the dashboard's copy key,
  `apps/dashboard/src/widgets/printer-delete-copy.ts:38`, not a table name); the delete (:179) calls
  `removeIdFromJson(tx, kitchenStations.printerIds, id)`. `station-delete.ts`: impact (:98-104) reads the station's list joined to
  `printers`; :192 sets the list to `[]`. `demo-printer.ts`: :49 `removeIdFromJson`, :171
  `withPrinter` on the station. Readers: `printerMappings` (`kitchen-print.ts:155-175`),
  `print-api.ts:1610-1622` and `stationPrintersDownQuery` (`station-outputs-down.ts:55-75`) join
  `stationPrinterPairs` where they joined `station_printers`, staying one query each with their joins
  to `printers` and their filters (the plan test at `station-outputs-down.test.ts:175-191` passes
  unchanged: it still finds `print_jobs_pull_idx`); `print-job-trouble.ts:130-146` may use either.
- [ ] **Step 4: The fixture script.** `fk7-station-printer-fixtures.mjs` (its own rule, on the
  splice helpers fk0's `lib/fold-inserts.mjs` exports): `X.insert(stationPrinters).values({ stationId: S, printerId: P })` →
  `await attachStationPrinterForTest(X, S, P)`; an array of values becomes one call per element when
  every element is an object literal; anything else, and every read of `stationPrinters`, is
  reported. Test (each rule, a report, idempotence), run with `--write`, prettier, hand-edit the
  reports (reads become `readStationPrinterPairs` or a read of the station's `printerIds`), list
  them.
- [ ] **Step 5: Run** the Finish-line server command; expect pass. **Commit** code; script and output;
  hand edits.

## Task 3: The list travels and is rewritten (§8 item 6, printer half)

- [ ] **Step 1:** Extend `apps/server/src/configuration-transfer.floor-kitchen.test.ts`: venue A with
  printers P1, P2 and a deleted printer P3 (`deleted_at` set, which the export leaves behind,
  `packages/db/src/configuration-transfer.ts:96-101`); station S lists `[P1, P2]`; station T lists
  `[P3]` (written directly, as a stale list would be). Export, import into venue B. Assert: S's
  imported `printer_ids` equals the ids B gave P1 and P2 (sorted); no imported list holds any id of
  venue A; T's imported list is `[]`. Keep fk2's and fk4's assertions in the same file.
  **Failing result named in advance:** an id from venue A in any imported list, or P3's id carried
  across. The design's answer is dv0's mechanism; a failure is stop point 1.
- [ ] **Step 2: Run**; expect pass with dv0 present (to see it fail, run once with the `printer_ids`
  declaration removed; record both). **Commit.**

## Task 4: Lists, control, Madrid baseline, docs, finish

- [ ] **Step 1:** Live-query lists: `"station_printers"` → `"kitchen_stations"` (de-duplicate).
  Madrid baseline: fold `station_printers` into `kitchen_stations.printer_ids` (each station's rows,
  sorted, become its list; if fk1's helper cannot build a list from rows, add a `collect` option to
  it with a test).
- [ ] **Step 2:** In `apps/server/scripts/migration-baseline/controls.ts:414-430`, move the "primary
  key columns changed" control to another table with a two-column primary key in core's starting
  migration (`grep -n "PRIMARY KEY(\`[a-z_]*\`, \`" packages/db/drizzle/0000_baseline.sql`), choosing
  one the design's §4 target list keeps; rewrite its six expected lines for that table; run
  `pnpm --filter @waitron/server exec vitest run scripts/migration-baseline` (stop point 3).
- [ ] **Step 3:** Raise the bundle format version by one from `main`'s value
  (`packages/provisioning/src/configuration-transfer.ts:123, 160, 473-476`), with a case that the old
  number is refused `setup.configuration_outdated`. Docs and backlog as listed. Protection list compare; paste and mark. Finish line;
  `/finish-branch`.
