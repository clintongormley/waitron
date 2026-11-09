# A1308 slice 5e: `location_id` leaves the floor, kitchen, printing, device, order, refund and join tables; the default menu becomes a flag — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every rule in
> [the slice rules](2026-11-08-a1308-slice-rules.md) applies ("rules §n"). The sweep's order and
> shared words: [5a](2026-11-08-a1308-5a-service-and-staff-location-columns.md#the-location-sweep-in-one-place).
> This slice re-runs 5a's script, `scripts/a1308/drop-location-id.mjs` (5a Task 1).

**Lands:** the lane (rules §6). A1301 made its S24, S26 and S27 owner-landed only because each was
a table rebuild that invoice records point at (its rule (d), design §6 "What makes a slice
owner-landed"); since A760 a slice changes the starting migration and rebuilds nothing (rules §2),
so that reason is gone. No `sales` row, number, record or hashed value changes: the two triggers
this slice edits lose only the dropped column from their "nothing else changed" lists. The S11 note
that `apps/server/src/working-order.ts` is an invoice-path file applied to its `:7038` call alone
(A1301 design §6, S11 row); the line this slice edits there (`:1717`) fills an open order's column.
**The owner may want to land it anyway:** it edits the refund guard trigger
(`tender_refunds_guard_update`) and `apps/server/src/tender-refund-reservation.ts`, and the build
order gives refunds' money trigger to the owner. The watcher asks before the lane lands it.

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2).

**Needs before it:** 5d (it removed the fiscal pair's read of `devices.location_id`,
`write-path.e2e.test.ts:552-555`, without which this slice could not pass the pair unedited);
**4a-ii** (coordinator, 2026-11-08: it deletes `location_catalogues`, its routes and the functions built
on it, and `setVenueDefaultCatalogue`'s "demote the old default to a member row" rule; the
default-menu work below assumes both are gone).

## What it builds

1. **Thirteen core tables lose `location_id` and its foreign key** (A1301 design §4, its S24, S26,
   S27 and S28's `join_requests`): `devices` (`packages/db/src/schema/devices.ts:20`),
   `working_orders` (`orders.ts:72`), `tender_refunds` (`tender-refunds.ts:45`), `join_requests`
   (`join-requests.ts:47`, no foreign key: a `local` table), `dining_tables`, `floor_plan_sets`
   (`floor-plans.ts:84`), `floor_zones`, `kitchen_stations`, `kitchen_courses`, `print_agents`,
   `printers`, `print_jobs`, `page_printers`.
2. **Indexes:**

   | Today | After |
   | --- | --- |
   | `dining_tables_location_short_name_key_uq`, `dining_tables_location_label_key` | `dining_tables_short_name_key_uq` (`short_name_key`), `dining_tables_label_key` (`label`) |
   | `devices_location_label_active_key` | `devices_label_active_key` (`label`) where active |
   | `floor_zones_name_key`, `kitchen_stations_name_key`, `kitchen_courses_name_key` | same names and predicates, (`name`) |
   | `kitchen_stations_default_key` (`location_id`) where `is_default` | same name, (`is_default`) where `is_default` (a column, A1301 §4) |
   | `printers_local_key_key` | same name and predicate, (`local_key`) — A1301 plan, "Indexes that lead with `location_id`" (S10) |
   | `page_printers_endpoint_uq` | same name, (`host`,`port`,`resource_path`) |

3. **Two hand-written triggers lose the column** (`packages/db/triggers/core.sql`):
   `working_orders_enforce_transition` loses its five `AND new.location_id IS old.location_id` lines,
   and `tender_refunds_guard_update` its one (A1301 design §4, "Triggers in the way of a rebuild",
   last two bullets: rewritten without `location_id`). Each still refuses every change it refuses
   today to every other column.
4. **Product code stops filling and filtering**: every `venueLocationId` call that fed one of these
   tables (at `a086eedfb7`: `apps/server/src/demo-printer.ts:35`, `floor-plan-sets.ts:255`,
   `floor-today-store.ts:694`, `join-requests.ts:208,561,608,724`, `kitchen-print.ts:831`,
   `kitchen.ts:100,289`, `page-printers.ts:89`, `payment-slip-print.ts:75`, `receipt-print.ts:69`,
   `tender-refund-reservation.ts:246`, `working-order.ts:1717`, `packages/printing/src/outbox.ts:62`,
   `printers.ts:69`, `apps/server/scripts/dev-setup.ts:247`, `apps/server/src/demo-seed.ts:25`,
   `apps/server/scripts/demo-seed/testing/provision-venue.ts:99`). In particular:
   - `enqueuePrintJob` loses its optional `venueId` (`packages/printing/src/outbox.ts:16-62`), and the
     callers that read the venue id once to pass it stop (`kitchen-print.ts:831`, `receipt-print.ts:69`,
     `payment-slip-print.ts:75`) — A1301 plan, "Carried to the schema plan", S10;
   - `configureDemoPrinter` (`demo-printer.ts:28-45`) drops its venue condition; its plan case is
     re-pointed (Finish line 4);
   - the configuration import's rule that sets every foreign key into `locations` to the importing
     venue's row goes (`packages/provisioning/src/configuration-transfer.ts:658-690`, its
     `venueLocationId` at `:704`, and the fill at `:738-740`): after this slice no transferred table
     points at `locations` (5a, 5c and this slice removed the last; `nodes` is not transferred).
     A1301 plan, "Carried to the schema plan": "S17's interim import rule … goes when the columns go".
5. **Test helpers** (`packages/db/src/testing/seed.ts:68-137`): `seedKitchenStation` and `seedDevice`
   lose their `locationId` option; `seedWorkingOrder` stops filling the column. `WithVenueRowId`
   (`apps/server/src/testing/venue-row-id.ts`) is deleted with every use (backlog A1301 entry:
   "goes when no `location_id` column is left to fill"; only `nodes.location_id`, filled inside
   `seedNode`, remains until 5f). Reporting's `seedVenueWithSeries` and `seedOpenOrder` lose their
   raw second-location branch (`packages/reporting/test/fixtures.ts:56,466`; backlog A1301 entry,
   "Fixture lines the helpers could not take"), and `working-order.test.ts`'s raw
   `insert into working_orders` in `seedForeignNodeOrder` (`:1348`) loses the column (F5's leftover).
6. **Second-location cases on these tables are deleted**, by title, listed in the pull request
   (A1301 plan rule). Known from the F-slice commits: `alerts-api`, `boot.test`, `device-api.pass`
   (backlog A1301 entry); the script's report finds the rest.
7. **The S18 leftovers outside the invoice path** (backlog A1301 entry, S18 bullet):
   `CatalogueApiDeps.venueCfg` (`apps/server/src/catalogue-api.ts:133`, set at `boot.ts:2640,2711`,
   read by nothing) goes with its test literals; the `void cfg;` discards in
   `apps/server/src/order-groups.ts` (`bumpGroupReady`) and `parties.ts` (`partyZone`) lose the
   parameter and every call site's argument; the `void cfg;` lines in test helpers (the files
   `git grep -l "void cfg;" -- '*.test.ts'` lists, 16 at `a086eedfb7`, and helpers such as `asApp`)
   go the same way. The ones in `till-sale.ts` and `working-order.ts` are left to 5f-ii, because the
   backlog records the owner landing those (S18b).

8. **The four "name already used" refusals that match the unique index by its columns** follow the
   new columns, or `device.name_taken` and `zone.name_taken` would arrive as raw database errors:
   `apps/server/src/device.ts:46-50` (`DEVICE_NAME_UNIQUE`, `["location_id", "label"]` → `["label"]`,
   and its comment naming `devices_location_label_active_key` → `devices_label_active_key`),
   `apps/server/src/tables.ts:101-103`, `packages/venue-service/src/operations.ts:467-469` and
   `:757-759` (`floor_zones`, `["location_id", "name"]` → `["name"]`); the comment at
   `packages/db/src/errors.ts:1092` that names the old index follows.
9. **The demo seed's raw SQL and keys** on these tables stop naming the column:
   `apps/server/scripts/demo-seed/seed-floor.ts:119,220`, `seed.ts:137`,
   `testing/madrid-semantics.ts:203` (`floor_zones`' key).
10. **The default menu becomes a flag on `catalogues`** (README U8; tables-menu §1.1; A1301 design
    §2.1 amended). `catalogues` gains `is_default` (`flag("is_default").notNull().default(false)`) and a
    partial unique index `catalogues_one_default_uq` on (`is_default`) `where is_default = 1` (a column,
    never an expression: CLAUDE.md §3). The menu slice renames table and index. `locations.catalogue_id`
    and its foreign key go.
    - Reader: `readDefaultCatalogueId(tx): Promise<string | null>` in `packages/catalogue` (exported)
      replaces `readVenue(tx).defaultCatalogueId` at each reader — `packages/catalogue/src/operations.ts`
      (`setVenueDefaultCatalogue` and the reader near `:1382`, as 4a-ii leaves them),
      `packages/catalogue/src/provisioning.ts:117`, `packages/venue-service/src/operations.ts:195`,
      `packages/venue-service/src/provisioning.ts:146` (`git grep -l -w defaultCatalogueId -- apps packages`
      lists 8 source and 9 test files at `a086eedfb7`, read on 2026-11-08). `Venue.defaultCatalogueId`
      goes.
    - Writer: `assignCatalogueToVenue` (`operations.ts:1319-1321`) becomes two statements in order —
      `update catalogues set is_default = 0 where is_default = 1`, then
      `update catalogues set is_default = 1 where id = ?` — so no row-at-a-time state breaks the index
      the final state satisfies (CLAUDE.md §3). `setVenueDefaultCatalogue` keeps its existence check.
    - `seedVenue`'s `defaultCatalogueId` override stays as a test convenience and sets the flag.
11. **The configuration export changes, so its format rises by one from `main`'s value** (rules §9):
    the transferred tables' rows lose `location_id` (`select *`, `configuration-transfer.ts:68-101`);
    the top-level `defaultCatalogueId` goes, with `applyPreparedVenue` (`:150-156`) and its two calls
    (`:704-705`, `:780-785`) — the default travels inside the exported `catalogues` rows as
    `is_default` (tables-menu §1.1, "Configuration export format 10"). The CLAUDE.md §3 rule's example
    "(the default menu travels as the top-level `defaultCatalogueId`)" becomes "(the privacy contact
    and content languages travel as top-level fields)", and the same words in
    `docs/developers/conventions-data.md:1835-1836`, `:5796-5797`, `:5900-5901` (README U8 names this).
12. **Madrid** (5a's dropped-columns transform for this slice's columns; 5b's document transform
    gains "a column into a flag on another table": the captured `locations.catalogue_id` value marks
    that `catalogues` row `is_default = 1`, every other row 0).
13. **Live types:** `getVenueDefaults` (`apps/dashboard/src/api/live-queries.ts:519`) and any query
    reading the default menu depend on `"catalogues"`.

## What it leaves out

| Left out | Taken by |
| --- | --- |
| `nodes.location_id`, `seedNode`'s location argument | 5f (owner) |
| `void cfg;` in `till-sale.ts` and `working-order.ts` | 5f-ii (owner, as the backlog records) |
| Renaming `catalogues` → `menus` | menu and photos |
| `bump_mode`, `fire_control`, `locations`, `venueLocationId`, its last callers (`promote.ts:257`, `restore.ts:936`, `reserved-identity.ts:76`, `boot.ts:2095` and test helpers) | 5f, 5g, 5h |
| The devices area's own redesign of `devices` (dv1 plan), the floor area's `floor_zones` work (fk1) | those slices, which assume this one landed (their plans say "slice 5 (already landed)") |
| `print_jobs`' next-attempt column (README "Additions of 6 November 2026") | devices and printing |

## Work beside this slice (rules §8)

- **#2594** (D1, drawer jobs) landed on `main` on 2026-11-08 (`5f11ab6405`), before 1a: it added
  `print_jobs_printer_kind_idx` in `packages/db/drizzle/0001_print_job_kind_index.sql`, and 1a's
  one-off rebuild folds that `0001` into core's starting migration (1a plan, item 6). On this
  slice's base the index is in the starting migration and in the base protection list, so it prints
  nothing here; the index is on `(printer_id, kind)` and does not name `location_id`
  (`packages/db/src/schema/print-jobs.ts:79` on `48d527dbc8`).
- **A790 Cut A (#2455)** adds six tables with foreign keys to `devices`, `page_printers`,
  `print_agents` and `sales` and no `location_id` (read at `f1f184de51`). The build order lands it
  before devices and printing; whether before or after this slice, the two share no column. If it
  lands first, its tables are in the base protection list and print nothing here.
- **#2570** changes only comments in `orders.ts`; a rebase.

## Files

```zsh
for t in devices workingOrders tenderRefunds joinRequests diningTables floorPlanSets floorZones kitchenStations kitchenCourses printAgents printers printJobs pagePrinters; do print "$t $(git grep -l "insert($t)" -- '*.test.ts' '**/testing/**' '**/test/**' | wc -l)"; done
# floorZones 98, kitchenStations 73, diningTables 41, printers 41, printAgents 31, pagePrinters 30, … at a086eedfb7
git grep -l WithVenueRowId | wc -l     # 90 files
git grep -c 'location_id' -- '*.test.ts' '*.test.mjs' '**/testing/**' '**/test/**' ':!**/drizzle/**' ':!*.json' | sort -t: -k2 -nr | head
```

Modify — schema: the thirteen schema files (and the prose comments the A1301 plan's 2026-11-05 list
names in them: `device-profile-printers.ts:17-18` (false today), `device-profiles.ts:23`,
`devices.ts:76`, `dining-tables.ts:9`, `floor-zones.ts:11`, `orders.ts:108,150`,
`station-printers.ts:7-8`); `packages/db/triggers/core.sql`.

Modify — product code: item 4's list; `packages/printing/src/outbox.ts` (the option);
`packages/provisioning/src/configuration-transfer.ts`; item 7's files.

Modify — helpers and tests: `packages/db/src/testing/seed.ts`, `apps/server/src/testing/venue-row-id.ts`
(deleted) and its users, `packages/reporting/test/fixtures.ts`, the script's output, hand edits.

Modify — guards: `scripts/schema-constraints.test.ts` (`printers_local_key_key` at `:480` stays by
name; the renamed keys change), `scripts/behavioural-triggers.test.ts` (its `workingOrder`, `device`
and `table` helpers, `:188-240`, lose the column; its cases for the two triggers keep their
assertions), `scripts/id-columns-are-references.test.ts` if it names a dropped column,
`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`, `apps/server/scripts/demo-seed/seed-floor.test.ts`
and `seed.test.ts` (each pins `location_id` lines).

Docs: `docs/developers/conventions-data.md` (the import's `locations` rule, `:1863-1864`: "Until
`locations` is dropped, a column whose foreign key points at it is set to the importing venue's
row" — delete the sentence), the backlog.

Regenerated: `packages/db/drizzle/**`, `scripts/migration-baseline-epoch.json`.

## Size

| Part | Counted |
| --- | --- |
| Schema (index re-keys; columns are deletions), triggers (deletions) | ~40 |
| Product code beyond deletions (outbox option, demo printer, import rule, signatures) | ~120 |
| Item 7 (parameters and call sites) | ~80 |
| Item 8 (four refusal targets, comment), item 9 (demo seed) | ~25 |
| Default-menu flag: schema, reader, writer, five readers, their cases | ~70 + ~90 |
| Bundle (format, `defaultCatalogueId`, the import's default step), CLAUDE.md and conventions-data wording, format rows | ~50 + ~30 |
| Madrid (dropped columns list; column-into-flag mode and its cases) | ~30 + ~25 |
| Hand edits in tests (raw SQL, `WithVenueRowId` reads, plan and index assertions, reporting branch) | ~350 |
| Guards, docs | ~40 |
| **Total** | **~950** |

Not counted: the script output (it removes the `locationId:` keys from roughly 400 test files'
inserts), deleted cases, regenerated files. The hand-edit share is the risk: `WithVenueRowId` alone
has 90 files. Split at Task 3 for a fresh implementer (rules §1).

## Finish line

1. The fiscal pair passes unedited (A1301 plan, "The fiscal pair"; `git diff --exit-code origin/main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts`).
2. The reviewer's re-run gives the output commit (5a, "The location sweep, in one place"), and a
   second run on the pull request's tree changes nothing.
3. ```zsh
   git grep -n -P "locationId|location_id|WithVenueRowId|\bvenueId\b" -- 'apps/server/src/*' 'apps/server/scripts/*' 'packages/printing/src/*' 'packages/layouts/src/*' 'packages/db/src/*' 'packages/provisioning/src/*' 'packages/venue-service/src/*' 'packages/catalogue/src/*' ':!**/drizzle/**'
   ```
   prints only: `nodes`' column and `seedNode` (5f); `venueLocationId`'s definition and its callers
   listed under "What it leaves out"; the backup and Cloud `venueId` lines 5f and 5g own
   (`boot.ts`, `backup-*.ts`, `stream-*.ts`, `cloud-*.ts`, `recovery-pack*.ts`, `restore*.ts`);
   fiscal-verifactu's `recipientVenueId` (not a location: 5f's open question). Control, on the base
   first: it prints `apps/server/src/device.ts:49` and `packages/printing/src/outbox.ts:62`.
4. `pnpm --filter @waitron/server exec vitest run src/demo-printer.test.ts` passes, its case renamed
   "finds its printer on the local-key index, not a scan" expecting
   `SEARCH printers USING INDEX printers_local_key_key (local_key=?)`.
5. `pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/migration-upgrade.test.ts scripts/live-subscriptions.test.ts scripts/module-seams.test.ts scripts/errors-reachable.test.ts` passes.
6. The touched suites pass by package (`git diff --name-only origin/main -- '*.test.ts'`), browser
   packages last and only above 15% free memory (CLAUDE.md §2).
7. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Under each of the six headers, except `waitron_change_*` lines (change-feed only). **Simulated**, as
5a's was (`/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/60457ed1-4051-43f0-8e47-e2be7ba7709b/scratchpad/a1308-5/sim.ts`,
mode `E`, 2026-11-08 at `a086eedfb7`), with the four language triggers first edited to stop reading
`working_orders.location_id`, as 5c leaves them; their lines are 5c's and do not appear here. The
default-menu lines (`catalogues`, `locations`) are written by hand in the same shapes and placed in
the tool's order (missing and changed by object name, then extras, `compare.ts:292-302`).

```text
missing index devices_location_label_active_key
missing index dining_tables_location_label_key
missing index dining_tables_location_short_name_key_uq
changed index floor_zones_name_key.columns[0].column
changed index floor_zones_name_key.columns[1].column
changed index floor_zones_name_key.columns[1].key
missing index floor_zones_name_key.columns[2]
changed index kitchen_courses_name_key.columns[0].column
changed index kitchen_courses_name_key.columns[1].column
changed index kitchen_courses_name_key.columns[1].key
missing index kitchen_courses_name_key.columns[2]
changed index kitchen_stations_default_key.columns[0].column
changed index kitchen_stations_name_key.columns[0].column
changed index kitchen_stations_name_key.columns[1].column
changed index kitchen_stations_name_key.columns[1].key
missing index kitchen_stations_name_key.columns[2]
changed index page_printers_endpoint_uq.columns[0].column
changed index page_printers_endpoint_uq.columns[1].column
changed index page_printers_endpoint_uq.columns[2].column
changed index page_printers_endpoint_uq.columns[3].column
changed index page_printers_endpoint_uq.columns[3].key
missing index page_printers_endpoint_uq.columns[4]
changed index printers_local_key_key.columns[0].column
changed index printers_local_key_key.columns[1].column
changed index printers_local_key_key.columns[1].key
missing index printers_local_key_key.columns[2]
changed table catalogues.columnOrder
changed table devices.columnOrder
missing table devices.columns[location_id]
missing table devices.foreignKeys[location_id->locations(id)]
changed table dining_tables.columnOrder
missing table dining_tables.columns[location_id]
missing table dining_tables.foreignKeys[location_id->locations(id)]
changed table floor_plan_sets.columnOrder
missing table floor_plan_sets.columns[location_id]
missing table floor_plan_sets.foreignKeys[location_id->locations(id)]
changed table floor_zones.columnOrder
missing table floor_zones.columns[location_id]
missing table floor_zones.foreignKeys[location_id->locations(id)]
changed table join_requests.columnOrder
missing table join_requests.columns[location_id]
changed table kitchen_courses.columnOrder
missing table kitchen_courses.columns[location_id]
missing table kitchen_courses.foreignKeys[location_id->locations(id)]
changed table kitchen_stations.columnOrder
missing table kitchen_stations.columns[location_id]
missing table kitchen_stations.foreignKeys[location_id->locations(id)]
changed table locations.columnOrder
missing table locations.columns[catalogue_id]
missing table locations.foreignKeys[catalogue_id->catalogues(id)]
changed table page_printers.columnOrder
missing table page_printers.columns[location_id]
missing table page_printers.foreignKeys[location_id->locations(id)]
changed table print_agents.columnOrder
missing table print_agents.columns[location_id]
missing table print_agents.foreignKeys[location_id->locations(id)]
changed table print_jobs.columnOrder
missing table print_jobs.columns[location_id]
missing table print_jobs.foreignKeys[location_id->locations(id)]
changed table printers.columnOrder
missing table printers.columns[location_id]
missing table printers.foreignKeys[location_id->locations(id)]
changed table tender_refunds.columnOrder
missing table tender_refunds.columns[location_id]
missing table tender_refunds.foreignKeys[location_id->locations(id)]
changed table working_orders.columnOrder
missing table working_orders.columns[location_id]
missing table working_orders.foreignKeys[location_id->locations(id)]
changed trigger tender_refunds_guard_update.body
changed trigger waitron_change_catalogues_update.when
changed trigger waitron_change_devices_update.when
changed trigger waitron_change_dining_tables_update.when
changed trigger waitron_change_floor_plan_sets_update.when
changed trigger waitron_change_floor_zones_update.when
changed trigger waitron_change_join_requests_update.when
changed trigger waitron_change_kitchen_courses_update.when
changed trigger waitron_change_kitchen_stations_update.when
changed trigger waitron_change_locations_update.when
changed trigger waitron_change_page_printers_update.when
changed trigger waitron_change_print_agents_update.when
changed trigger waitron_change_print_jobs_update.when
changed trigger waitron_change_printers_update.when
changed trigger waitron_change_tender_refunds_update.when
changed trigger waitron_change_working_orders_update.when
changed trigger working_orders_enforce_transition.body
extra table catalogues.columns[is_default]
extra index catalogues_one_default_uq
extra index devices_label_active_key
extra index dining_tables_label_key
extra index dining_tables_short_name_key_uq
```

Reasons: A1301 design §4 for every `location_id` line; tables-venuebox §5 ("`locations.catalogue_id`
FK → catalogues" becomes `menus.is_default` with "one default") and tables-menu §1.1 for the
`catalogues` and `catalogue_id` lines. The two `.body` lines differ from the old text only by the
removed `location_id` comparisons (the simulation printed them; compare the `old:`/`new:` text in the
report). #2594's index and, if it landed in between, A790 Cut A are in the base and print nothing.

## Stop points (beyond rules §5)

1. (Retired 2026-11-09: #2594 landed before 1a, so it cannot be open when this slice starts.)
2. A `.body` line for either trigger differs by anything but the removed comparisons.
3. A transferred table still has a foreign key to `locations` when item 4's import rule goes
   (`pragma_foreign_key_list` over the transfer lists in a migrated database).
4. An item-7 parameter has more than about 30 call sites, or is reached through a module contract:
   report it and leave it (it would be a codemod of its own).

## Assertions that change, by design

- The plan case in `demo-printer.test.ts:180-208` (index columns; A1301 S10's note).
- Index names and columns in `scripts/schema-constraints.test.ts` and the seed-floor tests.
- Second-location cases deleted by title (A1301 plan rule).
- `boot.node-configuration.test.ts` or any case reading `venueCfg` loses that read (the field goes,
  backlog S18 bullet).

---

### Task 1: Schema and triggers

- [ ] **Step 1:** Base protection list (rules §3).
- [ ] **Step 2: Failing cases** (rules §4): in `packages/db/src/schema/devices.test.ts` (or the
  file pinning devices' keys) "two active devices cannot share a label, and an inactive one can";
  in the kitchen-station schema test "a second default station is refused by
  `kitchen_stations_default_key`, two non-defaults are not"; in `dining-tables` "two tables cannot
  share a label"; in `scripts/behavioural-triggers.test.ts` the existing cases for
  `working_orders_enforce_transition` and `tender_refunds_guard_update` run unchanged (their
  set-up helpers lose the column).
- [ ] **Step 3:** Edit the thirteen schema files and the two trigger bodies; rebuild core
  (`pnpm --filter @waitron/server migration-baseline rebuild --set core`). Run Step 2's cases.
  Commit the schema alone (the reviewer's starting point for the script re-run, 5a).

### Task 2: The script run and product code

- [ ] **Step 1:**

  ```zsh
  T=devices,workingOrders,tenderRefunds,joinRequests,diningTables,floorPlanSets,floorZones,kitchenStations,kitchenCourses,printAgents,printers,printJobs,pagePrinters
  node scripts/a1308/drop-location-id.mjs --tables "$T" \
    --helper-prop seedKitchenStation.locationId,seedDevice.locationId --write $FILES > <report file outside the repo>
  ```

  (`$FILES`: 5a's one file list.) Prettier on the touched files; commit the output alone (rules §1).
- [ ] **Step 2:** Product code (item 4), the seed helpers (item 5), item 7's two server functions
  and `venueCfg`, item 8's four refusal targets, item 9's demo seed. Typecheck `@waitron/db`, `@waitron/printing`, `@waitron/provisioning`,
  `@waitron/server`. Run the focused suites of the changed product files. Commit.

### Task 2b: The default menu and the bundle

- [ ] **Step 1: Failing cases:** in `packages/catalogue/src/operations.test.ts` "setVenueDefaultCatalogue
  moves the default flag and leaves one default"; a `catalogues` schema case "a second default is
  refused by `catalogues_one_default_uq`, and two non-defaults are not" (rules §4);
  `provisioning.test.ts` "provisioning makes the starter menu the default when there is none";
  bundle cases "an export carries no `defaultCatalogueId` and its `catalogues` rows carry the flag",
  "an import restores the default from the rows' flag", "the previous format is refused as outdated".
  For item 8: "renaming a zone to a used name is refused `zone.name_taken`" and "labelling a device
  with a used label is refused `device.name_taken`" (today's codes, which a stale column list would
  turn into raw database errors).
- [ ] **Step 2:** Items 10, 11, 13; rebuild core. Run; commit.

### Task 3: Tests the script did not finish

Split point for a fresh implementer.

- [ ] **Step 1:** Delete `WithVenueRowId` and fix its users: a helper that returned
  `TradingContext & { locationId }` returns `TradingContext`; a test that read `cfg.locationId` only
  to fill a dropped column loses the read (the script removed most); anything else is reported.
- [ ] **Step 2:** Work through the report as in 5a Task 4 (raw SQL, second-location cases, helper
  parameters, lines for 5f/5g left alone). The reporting branch and `seedForeignNodeOrder` (item 5).
- [ ] **Step 3:** The `void cfg;` test-helper lines (item 7).
- [ ] **Step 4:** Finish lines 1–6. Commit.

### Task 4: Lists, docs, protection list, finish

- [ ] **Step 1:** Guards, Madrid (item 12, its new mode test first), the conventions-data sentence,
  CLAUDE.md §3's example (item 11).
- [ ] **Step 2:** Backlog, A1301 entry: delete the S10 sentence (`enqueuePrintJob`'s `venueId`, the
  demo printer's condition), the S17 import-rule sentence, the F5 `seedForeignNodeOrder` sentence,
  the `WithVenueRowId` sentence, the reporting `seedVenueWithSeries`/`seedOpenOrder` sentence, and
  the S18 bullet's `venueCfg` and non-invoice `void cfg` parts. "What A1308 retires": none of these
  tables has an entry. The "Drop `printers.ticket_scope` at the next reset" entry is the devices
  area's, not this slice's.
- [ ] **Step 3:** Protection list: compare, paste, mark (rules §3).
- [ ] **Step 4:** `pnpm format:check`; commit; `/finish-branch`.
