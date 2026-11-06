# The migration history before the A760 squash (test-only)

A760 replaced every package's `drizzle/` history with one starting migration per set. A few tests
check what a single old migration did to rows written under the schema before it, so they need the
old history. This folder keeps it, frozen.

- **Taken from** commit `59be31e3b72b2db0bc5e26f47a1ef305ea052d4c`, the last commit before the
  squash. Each folder is named after the old set as `packages/migrations/migrations.manifest.json`
  named it then (`core` came from `packages/db/drizzle`, `node` from `packages/node-db/drizzle`, the
  rest from the package of the same name). `fiscal-none` had no migrations and is left out.
- **What was copied:** every `.sql` file and `meta/_journal.json`, byte for byte. The snapshot files
  were not copied: drizzle's `readMigrationFiles` (in `drizzle-orm/migrator.js`) reads only the
  journal and the `<tag>.sql` file each journal entry names. The journals keep their original
  `when` dates.
- **`old-migrations.manifest.json`** is `packages/migrations/migrations.manifest.json` from that
  commit, byte for byte: each old set's journal table, append-only tables and database, in the
  order the old runner applied them.
- **`manifest.json`** records, for each set, the folder it came from, its migrations table, how
  many journal entries it had, the SHA-256 of its journal and of every SQL file, and the sets its
  old module descriptor `requires` (copied from `packages/composition/src/modules.ts` and
  `packages/media/src/module.ts` at that commit). It also holds the SHA-256 of
  `old-migrations.manifest.json`. `scripts/a760-history-fixture.test.ts` checks those hashes,
  checks one hash of the whole folder's frozen files that is written in the test itself (so a
  changed byte needs a changed line there, even if `manifest.json` is changed to match), and checks
  that the two manifests agree. It also checks that nothing that builds the server's
  `dist/drizzle/` or the image copies this folder. That last check is weaker than its name: it
  reads `copy-migrations.mjs` and the `COPY --from=build` lines of `deploy/Dockerfile` as text,
  and never builds the image or looks inside it.
- **Test-only.** It is never shipped and never run against a venue. Do not edit it: a changed byte
  no longer describes what venues ran.

A test asks for one old set with `historicalSet("<old set name>")`, or for the whole old world
with `historicalSets()`, from `historical-set.mjs`. Each set comes back shaped as `applyMigrations`
takes it: `{ name, migrationsFolder, migrationsTable, appendOnlyTables, database?, requires }`.
`historicalSets()` leaves out `fiscal-none`: a venue ran it or `fiscal-verifactu`, never both. A
test that applies several sets takes them all from here, never mixing in today's. Copy a folder
somewhere temporary before cutting its journal; never write into this one.

A test of today's code meeting a database one step behind today does not belong here: the old
steps cannot be followed by today's single starting migration. It builds the database from today's
sets and gives the code one made-up step more, with `migrationsRootWith` in
`apps/server/src/testing/migrations-ahead.ts`.

## Which tests read it

Each test below replays the old history up to the step named, from the journals here, so every
step keeps the `when` date its journal gave it. "All" means `historicalSets()`.

| Test                                                                | Old sets                       | Old step it stops before or replays                                                   |
| ------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| `apps/server/src/canvas-retirement-upgrade.test.ts`                 | all                            | core `0160_retire_canvases`                                                           |
| `apps/server/src/draft-line-place-upgrade.test.ts`                  | all                            | core `0172_draft_line_place`                                                          |
| `apps/server/src/printer-pickup-upgrade.test.ts`                    | all                            | core `0149_steep_deathbird`, `0160_retire_canvases`                                   |
| `apps/server/src/printing-retirement-upgrade.test.ts`               | all                            | every step, over stored older venues; core's `DROP TABLE locations` refuses           |
| `apps/server/src/station-order-migration.test.ts`                   | all                            | core `0167`, `0187`–`0189`, `0193`, `0204` (station and release steps)                |
| `packages/db/src/schema/drawer-refund-upgrade.test.ts`              | core                           | `0164_tender_refund_drawer_target`                                                    |
| `packages/db/src/schema/kitchen-timing-upgrade.test.ts`             | core                           | `0102_kitchen_timing_inheritance`                                                     |
| `packages/db/src/schema/sale-receipt-guests-upgrade.test.ts`        | core                           | `0194_sale_receipt_guest_count`                                                       |
| `packages/fiscal-verifactu/src/clock-confirmations-upgrade.test.ts` | all                            | fiscal-verifactu `0012_clock_confirmations_staff`                                     |
| `packages/fiscal-verifactu/src/outage-upgrade.test.ts`              | all                            | fiscal-verifactu `0009_aeat_outage_flag`                                              |
| `packages/fiscal-verifactu/src/record-replacement-upgrade.test.ts`  | all                            | fiscal-verifactu `0014_w41s8_record_replacements`                                     |
| `packages/media/src/schema/name-only-upgrade.test.ts`               | core, catalogue, media         | media `0004_drop_category_image_triggers`, `0007_recreate_product_image_triggers`     |
| `packages/migrations/src/incident-source-rebuild.test.ts`           | all                            | core `0195_incident_backup_source`                                                    |
| `packages/migrations/src/order-group-events-rebuild.test.ts`        | all                            | core `0120_order_group_firer_columns`, `0201`, `0202` (main bill)                     |
| `packages/staffing/src/role-retirement-upgrade.test.ts`             | workforce                      | `0009_real_lockheed`                                                                  |
| `packages/venue-service/src/department-receipts.upgrade.test.ts`    | core, catalogue, venue-service | venue-service `0048_department_receipts`                                              |
| `packages/venue-service/src/order-kitchen-notes.upgrade.test.ts`    | core, catalogue, venue-service | venue-service `0053_order_kitchen_notes`                                              |
| `packages/venue-service/src/party-allergy.upgrade.test.ts`          | core, catalogue, venue-service | venue-service `0055_party_allergy`                                                    |
| `packages/venue-service/src/kitchen-allergy.upgrade.test.ts`        | core, catalogue, venue-service | venue-service `0063_kitchen_allergy_copies`                                           |
| `packages/workforce/src/record-migration.test.ts`                   | core, identity, workforce      | workforce `0004_a10_record_columns`                                                   |
| `packages/workforce/src/attendance-response-migration.test.ts`      | core, identity, workforce      | workforce `0008_attendance_responses`                                                 |
| `packages/workforce/src/working-time-per-venue-migration.test.ts`   | core, identity, workforce      | workforce `0012_time_entries_person_entry_key`                                        |
| `scripts/fiscal-allocation-migration.test.ts`                       | all                            | fiscal-verifactu `0006_numerous_roughhouse`                                           |
| `scripts/fiscal-certificate-migration.test.ts`                      | all                            | fiscal-verifactu `0007_certificate_installs`                                          |
| `scripts/menu-sections-upgrade.test.ts`                             | all                            | catalogue `0018_sections_owned_prepare`, media `0006_recreate_section_image_triggers` |
