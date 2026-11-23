# A1308 fiscal 4a — Add the fiscal history table

Fi5 will write and read observed and lookup conflicts, Fi6 will write and read filing case notes,
and Fi7 will save AEAT answers before clearing them. Fi8–11 have no direct use for this table.
Separate tables could make individual row shapes easier to read, but would leave Fi5 and Fi6
maintaining separate audit stores and give Fi7 another one to build. Keep the shared append-only
history agreed in [A1308 §3](../specs/2026-11-02-rationalisation/README.md). Before Fi5, the verified
clock step is the sole user, so shrink Fi4a to the table, checks and writer that step needs. Fi4a
proves storage on its own, then [Fi4b](2026-11-08-a1308-fi4b-clock-onto-history.md) moves the live write.

**Base** is Fi3 at `f971e5506c`, including A1420 #3003 (`6e88c96309`). Follow the
[slice rules](2026-11-08-a1308-slice-rules.md). Estimated 80–110 code lines and 120–190 test lines.
**Landed by the owner.** Open the PR with “Every venue is reset: fiscal-verifactu; backups and
exports from before this cannot be restored or imported.”

## Build and check the table

- [ ] Take the base protection list from `apps/server` (rules §3).
- [ ] First write failing cases in `packages/fiscal-verifactu/src/schema/verifactu-history.test.ts`
      using `useVenueDb` and the fiscal migrations. Accept an admin and a staff row. For each named
      CHECK below, check the specific refusal with a wrong value and, for JSON fields, a missing key.
      Check malformed JSON and arrays against the data CHECK. Check duplicate `seq`, missing node
      and person parents, restricted deletion of a linked person, and append-only refusals on UPDATE
      and DELETE. Seed real node and person rows for the accepted writes. Run it and confirm the red
      result from the missing table before adding the schema.
- [ ] Add `src/schema/verifactu-history.ts` in that package. Use `id` with `newId` as the primary key,
      `seq` as a required `count` with `verifactu_history_seq_uq`, and required `kind`, `node_id`,
      `at` and `data` with the shared label, id, timestamp and JSON builders. Link `node_id` to `nodes`
      and nullable `person_id` to `persons` with restricted deletion (design U11). Require a person
      for the clock kind. List these CHECKs in this order:
  - `verifactu_history_data_ck` requires valid JSON with an object at its root.
  - `verifactu_history_kind_ck` admits `clock.confirmed`.
  - The `verifactu_history_confirmed_` CHECKs end in `source_ck` (admin or staff), `reason_ck`
    (start or unusable), `person_ck` (a nonempty person id) and `shape_ck` (text `confirmedAt`,
    integer `stepMs`, object `proof`). Wrap each kind-specific test in
    `kind <> 'clock.confirmed' OR coalesce(condition, 0)` so a missing key fails.
- [ ] Export the table in `src/schema/index.ts`, classify it with `appendOnly` as `ledger` and
      add it to the migration manifest. Update `schema-ownership`, root `append-only-triggers` and
      `schema-constraints` expectations and the Madrid seed's `ADDED_TABLES`. Run
      `pnpm --filter @waitron/server migration-baseline rebuild --set fiscal-verifactu`. Check the
      generated CHECK order and require the schema cases to pass. Stop for a wrongly accepted row or
      CHECK order that the generator fails to preserve.
- [ ] In `src/history.test.ts` first write and run cases that assert two appends with decreasing
      `at` get sequences 1 and 2 and each returned id names the stored payload. Then implement
      `appendHistory(tx: Transaction, entry: HistoryEntry): Promise<{ id: string; seq: number }>` in
      `src/history.ts`. The entry has `kind: "clock.confirmed"`, `nodeId: NodeId`, `at: Date`, `personId: string` and
      `data: { confirmedAt: string; stepMs: number; source; reason; proof }` with the types above
      (`proof` is a JSON object). Assign `max(seq) + 1`, starting at 1, and insert in the caller's
      write transaction. Run the writer cases again. Fi4b connects the writer to the clock.

## Finish line

```bash
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/{schema/verifactu-history,history,classification,schema-ownership,schema/schema-conformance,write-path.e2e,inmutabilidad}.test.ts
pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm exec vitest run scripts/{append-only-triggers,append-only-migration-sets,behavioural-triggers,schema-constraints,classification-complete,starting-migrations,migration-upgrade,two-file-foreign-keys}.test.ts
```

Require a passing test count for each run and keep the golden huella (invoice fingerprint) and
`inmutabilidad` suites unedited.

## Expected protection-list difference

For `composition=fiscal-verifactu database=venue`, all three phases
should report `extra index verifactu_history.primary key(id)`,
`extra index verifactu_history_seq_uq` and `extra table verifactu_history`. In `migrated` and
`change-feed`, also expect `extra trigger verifactu_history_append_only_delete` and
`extra trigger verifactu_history_append_only_update`. The two foreign keys and six CHECKs travel
with the table in the JSON. Compare the lists, check those fields and account for each line in
the PR. Apply the slice-rule stops, run `/finish-branch` and reset after the owner lands.

## Successor plans at stop point 1

Recheck each plan against its landed base before building. Fi5 first needs nullable `event_key`
with its unique index, `registro_id` with its record link (including backup verification), and
`verifactu_history_registro_kind_seq_idx (registro_id, kind, seq)`. Add them with the conflict
writes, reads and query-plan test so the schema pays for a tested use. Remove `clock.check_opened`
from Fi5's kind list and refresh its protection prediction, writer signature and fixtures. Fi6
first creates `triggers/fiscal-verifactu.sql` and
`src/trigger-refusals.ts` for its submission guards. Refresh its assumed history trigger, key
examples and ordering. Update Fi7's dependency on those files and recheck its baseline. Drop `ref_id` from
the three successor CHECKs. The deleted check link was its only planned user. Recheck borrowed
fixtures and the build order's Fi4a bench dependency. The stop readers, `(kind, seq)` index and
`--history` bench flag served deleted queries in [tables-fiscal §§0.3 and 8.3](../specs/2026-11-02-rationalisation/tables-fiscal.md).
Update those assumptions when the affected work next reaches its plan check, using the schema and
query that will actually ship.
