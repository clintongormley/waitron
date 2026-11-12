# A1308 fk1 — a zone's department and sale rules live on the zone row: implementation plan

> 2026-11-12, watcher 09:14: #2804 retired receipt_print_mode; fold only the three remaining sale overrides (five new zone columns total). Every receipt-mode enum, column, CHECK, reader/validator and test expectation below, including the protection prediction, is void. Carry fk0’s finished library and build its still-unbuilt seedZone rewrite here. Watcher 09:18 clears removing only the missing-policy readiness element at operations.test.ts:582; keep all subsequent assertions and let the schema refuse a missing department.

> 2026-11-12, watcher 09:50: fk1 carries fk0; use the combined forecast of about 1,420 counted lines and a 1.5× stop at about 2,130. Count at every checkpoint; keep generated files and committed script output separate under the slice rules.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox
> (`- [ ]`) syntax. Every step also follows
> [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules" below), which this plan cites
> and does not repeat.

**Goal:** `zone_service_policies` (a zone's department and the "counter default" mark) and
`zone_sale_policies` (a zone's four sale-rule overrides) fold into `floor_zones`, so a zone is one
row.

**Architecture:** six columns join `floor_zones`; the two side tables go; every reader that reached
a zone through `zone_service_policies` reads `floor_zones` and, where it did not already, asks for
`active = 1`, because a deleted zone now keeps its row (with its department) instead of losing its
policy row. A committed fixture script rewrites the test inserts the fold breaks.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest, the slice-1a rebuild command.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) and its
[floor and kitchen appendix](../specs/2026-11-02-rationalisation/tables-floorkitchen.md) §1.1, §4,
§5 (rows for `floor_zones`, `zone_service_policies`, `zone_sale_policies`). The README wins where
they differ (rules, opening).

**First line of the pull request:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported." (rules §2)

**Who lands:** the lane. Nothing here changes `sales`, invoice numbering, the fiscal record or a
value that feeds a fiscal hash (rules §6). `recordSaleReceiptHeader` reads the zone's department
for a receipt's printed header; that header is not in any hash.

---

## Where this plan sits

This is the first of nine plans for the floor and kitchen area, in build order:

| # | Plan | Tables |
| --- | --- | --- |
| fk0 | [fixture library](2026-11-08-a1308-fk0-fixture-library.md) | none: the shared test-rewrite library, `seedZone`, fk1's script (no schema change) |
| fk1 | this one | `zone_service_policies`, `zone_sale_policies` → `floor_zones` |
| fk2 | [today's choices](2026-11-08-a1308-fk2-todays-choices.md) | `zone_extensions` → `floor_zones`; `station_day_states` → `kitchen_stations` |
| fk3 | [floor design](2026-11-08-a1308-fk3-floor-design.md) | parts, kept sizes and set names fold into `floor_plan_tables`, `floor_reset_tables`, `floor_plan_placements`, `floor_plan_sets` |
| fk4 | [today's map](2026-11-08-a1308-fk4-todays-map.md) | `floor_today_tables` → `dining_tables`; `floor_today_zones` → `floor_zones` |
| fk5 | [splits and merges](2026-11-08-a1308-fk5-splits-and-merges.md) | `floor_today_split_parts`, `floor_today_join_tables` → `dining_tables`; `floor_today_joins` → `table_merges` |
| fk6 | [parties and person keys](2026-11-08-a1308-fk6-parties-and-person-keys.md) | `party_allergy` → `parties`; the area's six person keys |
| fk7 | [station printer list](2026-11-08-a1308-fk7-station-printer-list.md) | `station_printers` → `kitchen_stations.printer_ids` |
| fk8 | [kitchen tickets](2026-11-08-a1308-fk8-kitchen-tickets.md) | `ticket_item_allergies` → `ticket_items`; `kitchen_notices` additions; `routing_cell_periods` |
| fk9 | [ticket bill column](2026-11-08-a1308-fk9-ticket-bill-column.md) | `ticket_items.working_order_id` (measured, then dropped or guarded) |

The build order estimated 5–7 pull requests for this area. It is ten (fk0 to fk9) because fk0 lands
the fixture tooling alone (coordinator decision, 2026-11-08), and because the floor's today
state (fk4, fk5) cannot fit one pull request under the size cap, and fk9 waits on slice 0's bench,
which no other pull request here needs.

## Area files for the package move

The CI package move (agreed 2026-11-08, design not yet written; area order from the build order's "Order of areas", the owner accepted the proposed order on 2026-11-09) will move
this area's server code into its own package. These are the `apps/server/src` files that belong to
floor and kitchen, each with its `*.test.ts` siblings (`<name>.test.ts`, `<name>.*.test.ts`):

- Floor: `floor-*.ts` (16 files: `floor-delete`, `floor-layout-due`, `floor-plan`, `floor-plan-sets`,
  `floor-reset-plan`, `floor-revision`, `floor-today-api`, `floor-today-mark-moved`,
  `floor-today-merges`, `floor-today-name`, `floor-today-parts`, `floor-today-reset-table`,
  `floor-today-split`, `floor-today-split-group`, `floor-today-store`, `floor-today-table`),
  `joined-split-layout.ts`, `table-actions.ts`, `table-removal.ts`, `table-short-names.ts`,
  `table-signals.ts`, `tables.ts`, `delivery-release.ts`, `zone-access.ts`,
  `zone-repair-serving.ts`, `keep-open-api.ts`, `parties.ts`, `party-allergy.ts`,
  `party-allergy-api.ts`, `service-step-done.ts`, `service-step-reckoning.ts`,
  `service-step-signals.ts`.
- Kitchen: `kitchen.ts`, `kitchen-*.ts` (`kitchen-allergy`, `kitchen-language`, `kitchen-phase`,
  `kitchen-print`, `kitchen-release`, `kitchen-ticket`, `kitchen-timing`), `made-here.ts`,
  `order-kitchen-note.ts`, `order-kitchen-note-api.ts`, `pass.ts`, `pass-*.ts` (`pass-board`,
  `pass-card`, `pass-coverage`, `pass-release`), `station-*.ts` (`station-closing`,
  `station-delete`, `station-move`, `station-outputs-down`, `station-printers`,
  `station-queue-moves`, `station-today-api`), `course-delete.ts`, `demo-printer.ts`.
- Test helpers in `apps/server/src/testing/`: `floor-label.ts`, `floor-sets.ts`,
  `floor-today-venue.ts`, `live-table.ts`, `party-bill-of.ts`, `party-close-fixture.ts`,
  `party-venue.ts`, `service-zone.ts`, `zone-offers.ts`, `zone-payment-venue.ts`,
  `zone-process-child.ts`, `zone-process-matrix.ts`, `table-action-fixture.ts`,
  `table-snapshot.ts`, `kitchen-allergy-fixture.ts`, `kitchen-table-order.ts`, `pass-waiting.ts`,
  `pass-board-probe.ts`, `service-steps.ts`, `station-printing.ts`.
- Not this area although they read its tables: `working-order.ts`, `till-api*.ts`,
  `move-bill.ts`, `print-*.ts`, `printer-delete.ts` (orders, devices and printing).

**Where the move sits:** after fk9, as its own pull request. Every plan here cites
`apps/server/src/...:line`; moving the files first would make every cite stale, which is a stop
(rules §5.1), and moving them in the middle would put one lane's in-flight branch across the move.

---

## What it builds

- `floor_zones` gains `department_id` (not null, key to `departments`), `is_counter_default`
  (flag, default 0), and the four nullable sale-rule overrides `order_start`, `paid_when`,
  `collection_number`, `receipt_print_mode` (null = follow the department), with their four enum
  CHECKs and a unique partial index "one counter default among active zones".
- `zone_service_policies` and `zone_sale_policies` are deleted. `zone_extensions.zone_id` and
  `zone_days.zone_id` (the table the venue-and-box area renames `opening_hours`) point at
  `floor_zones.id` instead.
- Deleting a zone clears its sale rules and counter-default mark on the kept row; `department_id`
  stays (appendix §1.1).
- Every reader that reached a zone through `zone_service_policies` filters `floor_zones.active = 1`
  where it did not already.
- The configuration export carries the six columns with the zone; the validators read them from
  `floor_zones`.
- Runs fk0's committed `scripts/a1308/fk1-zone-fixtures.mjs` over the tests (its output is this
  pull request's, uncounted, rules §1), and widens fk0's `seedZone` so a zone gets a department.
- If batch 1 did not build one: `madridWithFoldedTables`, the Madrid baseline's fold helper, which
  fk2–fk8 reuse (Task 6).
- Raises the configuration bundle's format version by one (rules §9): the export no longer carries
  `zone_service_policies` or `zone_sale_policies`.

## What it leaves out

| Left out | Owner |
| --- | --- |
| `zone_extensions` → `floor_zones.kept_open_*` | fk2 |
| `floor_today_zones` → `floor_zones.today_*` | fk4 |
| Renaming `zone_days` to `opening_hours` | the venue-and-box area |
| `location_id` and the location key on any of these tables | slice 5 (assumed landed) |
| Device-profile zone lists becoming JSON lists | the devices area |

## Files

- Modify: `packages/db/src/schema/floor-zones.ts`, `packages/db/src/schema/venue-service/service.ts`
  (delete `zoneServicePolicies`, `zoneSalePolicies`; export the four enum types for reuse),
  `packages/db/src/schema/venue-service/zone-extensions.ts:16-20`,
  `packages/db/src/schema/venue-service/seasons.ts:177-181`, `packages/db/src/index.ts`,
  `packages/db/src/classification.ts:331,333`, `packages/venue-service/src/classification.ts:13,15`.
- Modify (writers): `packages/venue-service/src/operations.ts` (`configureZone` :373-435,
  `createServiceZone` :437 on, `listSalePolicies` :617-655, `setZoneSalePolicyOverride` :677-692,
  readiness :325-347), `packages/venue-service/src/provisioning.ts:76-145`,
  `packages/venue-service/src/service-delete-settings.ts:357-445`.
- Modify (readers, Task 4's list): `business-day-schedule.ts`, `day-resolver.ts`,
  `floor-layout-due.ts`, `floor-plan-set-store.ts`, `profile-access.ts`, `release-reminders.ts`,
  `routing-store.ts`, `service-delete.ts`, `service-step-completions.ts`, `special-days.ts`,
  `table-clearing.ts`, `zone-closed-times.ts`, all in `packages/venue-service/src/`.
- Modify (lists): `packages/venue-service/src/configuration-transfer.ts` (:283, :368, :465, :478,
  :566-578, :580-590, :592-601, :628-637, :703-704), `packages/venue-service/src/dashboard/live-queries.ts`,
  `apps/dashboard/src/api/live-queries.ts:61-62,370,487`,
  `apps/server/scripts/demo-seed/seed-floor.ts`, `apps/server/scripts/demo-seed/seed-catalogue.ts`,
  `apps/server/src/testing/clear-provision-fixture.ts`, `scripts/schema-constraints.test.ts:353-357`.
- Modify: `packages/db/src/testing/seed.ts` (`seedZone` gains a department),
  `packages/venue-service/src/index.ts:55-56` (re-exports of the two deleted tables),
  `packages/provisioning/src/configuration-transfer.ts:123, 160, 473-476` (the format version, rules
  §9).
- Modify (tests that pin these tables, listed under "Assertions that change, by design"):
  `packages/db/src/schema/venue-service/migrations.test.ts`, `packages/venue-service/src/schema/service.test.ts`,
  `apps/dashboard/src/api/live-queries.test.ts`, `apps/server/src/configuration-import.previous-export.test.ts`.
- Generated (uncounted): `packages/db/drizzle/0000_baseline.sql`, `packages/db/drizzle/meta/*`,
  `scripts/migration-baseline-epoch.json`.
- Docs: `docs/developers/conventions-data.md` ("Department and zone service settings" :4942-4964,
  "Permanent hierarchy deletion" :2337), `docs/developers/dashboard-live-updates.md:98`.

## Size

| Part | Counted lines (estimate) |
| --- | --- |
| Schema, classification, index exports, format version | 75 |
| Writers (create, configure, provisioning, sale rules, delete) | 130 |
| Readers (about 30 query sites, one to four lines each) | 120 |
| Configuration transfer validators and lists, live queries, demo seed | 90 |
| `seedZone` gains a department | 20 |
| New tests (schema refusals, delete, readers, transfer) | 140 |
| Hand edits to tests the script does not reach (recounted below) | 260 |
| Docs | 30 |
| **Total** | **≈ 865** |

The hand edits, counted at `a086eedfb7` over `*.test.ts` and test helpers: 492 lines name the two
tables in 81 files. fk1's script takes the 18 Drizzle inserts, the plain raw-SQL inserts among the
154 raw-SQL lines, and the 53 import lines. Left by hand: 78 Drizzle reads, updates and deletes; the
28 bundle keys in the transfer tests; the raw-SQL reads and updates (most in
`packages/db/src/schema/venue-service/migrations.test.ts`, re-pointed in Task 5 Step 4), about 260
changed lines in all. If the count after the script exceeds 320, it is stop point 5.

Uncounted: the script's output, deleted lines, and the generated migration files.

## Finish line

From the worktree root, each must pass (CLAUDE.md §2: focused runs locally, CI runs the suites):

```bash
pnpm --filter @waitron/venue-service exec vitest run src/operations.test.ts src/routes.test.ts \
  src/provisioning.test.ts src/service-delete-settings.test.ts src/service-delete.test.ts \
  src/configuration-transfer.test.ts src/configuration-policy-completeness.test.ts \
  src/profile-access.test.ts src/zone-closed-times.test.ts src/business-day-schedule.test.ts \
  src/keep-open.test.ts src/classification.test.ts src/dashboard/live-queries.test.ts src/schema
pnpm --filter @waitron/db exec vitest run src/schema
pnpm --filter @waitron/server exec vitest run src/service-delete.integration.test.ts \
  src/configuration-transfer.test.ts src/configuration-import.test.ts src/till-api.test.ts \
  src/receipt-print.test.ts src/floor-plan.test.ts src/floor-today-store.test.ts \
  src/till-api.zone-closed.test.ts src/till-api.profile-zones.test.ts \
  scripts/demo-seed/seed.integration.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts \
  scripts/live-subscriptions.test.ts scripts/starting-migrations.test.ts \
  scripts/migration-upgrade.test.ts scripts/id-columns-are-references.test.ts scripts/a1308
FILES=$(git ls-files '*.test.ts' 'apps/*/src/testing/*.ts' 'packages/*/src/testing/*.ts' 'packages/*/test/*.ts')
node scripts/a1308/fk0-seed-zone.mjs --write ${=FILES} && node scripts/a1308/fk1-zone-fixtures.mjs --write ${=FILES} && git diff --exit-code
```

The last line proves both scripts are idempotent on the tree (rules §1); `${=FILES}` splits the list
in zsh (global CLAUDE.md, "The Bash tool's shell is zsh"). Each Vitest run must
print a `Tests` count (CLAUDE.md §4).

## Expected protection-list difference

Every line below appears under each of the six `DIFF composition=… phase=… database=venue`
headers (two compositions × `sql-only`, `migrated`, `change-feed`), except `trigger
waitron_change_*` lines, which appear only under the two `change-feed` headers. Index names that
slice 5 rewrote are written here as slice 5 leaves them; where this plan guesses a slice-5 name, it
says "(slice-5 name)".

| Table | Lines |
| --- | --- |
| `zone_service_policies` (gone, appendix §5: "implicit" / "FK `floor_zones.department_id`") | `missing table zone_service_policies`; `missing index zone_service_policies.primary key(zone_id)`; `missing index zone_service_policies_one_counter_default_key` (slice-5 name); `missing trigger waitron_change_zone_service_policies_insert`, `…_update`, `…_delete` |
| `zone_sale_policies` (gone, §5: "implicit; CHECKs on `floor_zones`") | `missing table zone_sale_policies`; `missing index zone_sale_policies.primary key(zone_id)`; `missing trigger waitron_change_zone_sale_policies_insert`, `…_update`, `…_delete` |
| `floor_zones` (gains them) | `extra table floor_zones.columns[department_id]`, `[is_counter_default]`, `[order_start]`, `[paid_when]`, `[collection_number]`, `[receipt_print_mode]`; `changed table floor_zones.columnOrder`; `extra table floor_zones.foreignKeys[department_id->departments(id)]`; `extra table floor_zones.checks[floor_zones_order_start_ck]`, `[floor_zones_paid_when_ck]`, `[floor_zones_collection_number_ck]`, `[floor_zones_receipt_mode_ck]`; `extra index floor_zones_one_counter_default_key`; `changed trigger waitron_change_floor_zones_update.when` |
| `zone_extensions` (re-pointed) | `missing table zone_extensions.foreignKeys[zone_id->zone_service_policies(zone_id)]`; `extra table zone_extensions.foreignKeys[zone_id->floor_zones(id)]` |
| `zone_days` (re-pointed, cascade kept) | `missing table zone_days.foreignKeys[zone_id->zone_service_policies(zone_id)]`; `extra table zone_days.foreignKeys[zone_id->floor_zones(id)]` |

Nothing for any other table. A changed `when` on another table's update trigger is a stop
(rules §5.2): only `floor_zones` gains columns.

## Stop points (beyond rules §5)

1. A test that inserts a zone **before** its department, and counts departments afterwards, can
   only pass with a changed count: stop; do not let `seedZone` invent a department there.
2. `zone.department_missing` has an assertion that a zone with **no policy row** is reported. The
   fold makes that state impossible; the assertion is then about a state the database refuses.
   Stop and ask before deleting it (the appendix §1.1 predicts it: "has nothing left to find").
3. Any reader in Task 4's list returns a different row set in its own suite after the change.
4. The venue-and-box area's `zone_days` → `opening_hours` rename is in flight in lane 1 (rules §7):
   do not start until it has landed or has not started, and use the name `main` has.

5. After the script, the hand-edited test lines exceed about 320 (the size estimate's margin).

## Needs

- fk0 (the library, `seedZone`, and this plan's script).
- Batch 1, all of it (task brief): 1a's rebuild command and `packages/db/triggers/core.sql`; slice 5's
  location sweep (no `location_id` on `floor_zones`, `zone_service_policies`, `departments`).
- Outside this area: nothing else. Inside: nothing (first plan).

## Assumptions about batch 1

- **B1 (1a):** `pnpm --filter @waitron/server migration-baseline rebuild --set core` regenerates the
  starting migration; conflicts in generated files are resolved by taking `main`'s copy and
  re-running it (rules §2.4). Scripts live in `scripts/a1308/`, each with a `.test.mjs` beside it,
  as 1a's own rename script does; if 1a set a different test convention, follow it.
- **B3 (slice 5):** the cites below that still show `venueLocationId(tx)` or `location_id` are
  pre-slice-5; after slice 5 those arguments are gone and the builder ignores them.
- **B4 (Madrid baseline):** batch 1 (4a deletes tables with rows, 5 drops columns) set how
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` follows a schema change. If it built a
  fold helper, use it; if it re-captured the fixture, re-capture the same way; if neither, Task 6
  builds `madridWithFoldedTables`.
- **B6 (bundles):** the bundle's format version is `10` at `a086eedfb7`
  (`packages/provisioning/src/configuration-transfer.ts:123` writes it, `:476` refuses any other as
  `setup.configuration_outdated`); batch 1 may already have raised it. This pull request raises it by
  one from `main`'s value (rules §9), so an export from before it is refused as outdated. The module
  schema versions compared at `:595-602` do not catch it on their own: a rebuilt starting migration
  keeps its set's count. Fixture bundles under `apps/server/src/testing/fixtures/` follow batch 1's
  handling.

## In-flight work folded in (rules §8)

- No plan in `docs/superpowers/plans/` dated after 2026-11-01 changes these two tables (searched
  2026-11-08 with `grep -l -E "zone_service_policies|zone_sale_policies"` over the plans folder:
  only `2026-11-01-a1301-remove-location.md`, slice 5's source, names them).
- A1403 (unpaid kitchen stop, lane H) and A1378 (kitchen paper) change no table; they rebase.

## Assertions that change, by design

Each names a deleted table or one of its keys; the design section is the reason (rules §4).

| Where | Change | Design |
| --- | --- | --- |
| `packages/db/src/schema/venue-service/migrations.test.ts:37` (`TABLES`) | drop `zone_service_policies` | §4 "merge into floor_zones" |
| same file `:150` | the retired-column case updates `floor_zones` instead of `zone_service_policies` (still "no such column `service_mode`") | §1.1 |
| same file `:251-258` | the `zone_service_policies` key-shape entry goes | §5 "implicit" |
| same file `:412` | `zone_days`' key reads `(zone_id) -> floor_zones(id) on delete cascade` | §1.1 (`opening_hours.zone_id`) |
| same file `:442-449` | the counter-default index assertions move to `floor_zones_one_counter_default_key`, columns `["is_counter_default"]`, predicate with `active = 1` | §5 |
| same file `:493-650` | each sale-rule CHECK case writes `floor_zones` columns; refusal names `zone_sale_policies_*_ck` become `floor_zones_*_ck`; the accepting writes are kept | §5 "four enum CHECKs … CHECKs on `floor_zones`" |
| `packages/venue-service/src/schema/service.test.ts:63-87, :219` | the two `EXPECTED` entries go; the count `13` becomes `11` | §4 |
| `apps/dashboard/src/api/live-queries.test.ts:499` | `{ type: "zone_service_policies" }` → `{ type: "floor_zones" }` (the test's name, "when a zone's department changes", still holds) | §1.1 |
| same file `:1132-1133` | the hierarchy list drops the two names (`floor_zones` is already listed) | §4 |
| `apps/server/src/configuration-import.previous-export.test.ts:44` | `not.toHaveProperty("zone_sale_policies")` is still true of the old fixture but checks nothing new; add beside it that each of the fixture's `floor_zones` rows has no `order_start` key, so the line keeps meaning "this export predates the zone's sale rules" | §1.1 |
| venue-service and server transfer tests | error `field` values `zone_service_policies.*` / `zone_sale_policies.*` → `floor_zones.*` (Task 5 Step 4 lists them) | §1.1 |

## Global constraints

- Rules §1–§9 apply. Column vocabulary from `packages/db/src/schema/columns.ts` only (CLAUDE.md §3).
- Behaviour suites keep their assertions (rules §4). The only assertions this plan changes are in
  "Assertions that change, by design" below; any other is a stop.
- New error codes: none.

## Review Focus

1. **A deleted zone still matches a department join.** A reader that joins `departments` through
   `floor_zones.department_id` and forgets `active` now sees deleted zones. Test: Task 4's
   `deleted zone stays out of every zone read` case.
2. **Counter-default replacement during a delete.** The deleted zone must lose
   `is_counter_default` before the replacement gains it, or the new unique index refuses the
   delete. Test: Task 3's `deleting the counter zone hands the mark to its replacement`.
3. **A zone moved to another department keeps its overrides** (conventions-data.md :4958-4960).
   Test: the existing `routes.test.ts` real-row preservation cases, assertions unchanged.
4. **Import of a zone whose department is left behind** (inactive department): the zone row is
   now left behind with it, through the key. Test: Task 5's transfer case.
5. **Provisioning run twice** keeps one counter zone with its department. Test: the existing
   `provisioning.test.ts` re-run cases, assertions unchanged.

---

## Task 0: Record the base protection list

- [ ] **Step 1:** In a throwaway worktree of the base commit (`git worktree add --detach <dir>
  <base-sha>`, `pnpm install`), from `apps/server`: `pnpm protection-list list --out <A>` with `<A>`
  an empty absolute directory outside the repository (rules §3). Keep `<A>` for Task 7.

## Task 1: The schema

**Files:** `packages/db/src/schema/floor-zones.ts`, `packages/db/src/schema/venue-service/service.ts`,
`zone-extensions.ts`, `seasons.ts`, `packages/db/src/index.ts`, both classification files,
`scripts/schema-constraints.test.ts`; test `packages/db/src/schema/floor-zones.test.ts`.

**Interfaces:**
- Produces: `floorZones` with `departmentId: string`, `isCounterDefault: boolean`,
  `orderStart: "table" | "counter" | null`, `paidWhen: "prepay" | "ticket_then_pay" | null`,
  `collectionNumber: "none" | "numbered" | null`, `receiptPrintMode: "auto" | "on_request" | null`.
  `orderStart`, `paidWhen`, `collectionNumber`, `receiptMode` enum types exported from
  `service.ts` (they are `const` there today) so `floor-zones.ts` imports them; to avoid an import
  cycle (`service.ts` imports `floor-zones.ts`), move the four `enumType` declarations into a new
  `packages/db/src/schema/sale-rule-types.ts` and import it from both.

- [ ] **Step 1: Write the failing tests** in `packages/db/src/schema/floor-zones.test.ts`
  (`useVenueDb`), each asserting the refusal by its constraint name in the error text:
  - `refuses a zone with no department` (a bare insert on purpose; fk0's scripts skip every file under
    `packages/db/src/schema/`, so it stays) → insert without `department_id` fails with
    `NOT NULL constraint failed: floor_zones.department_id`.
  - `refuses a department that does not exist` → `FOREIGN KEY constraint failed`.
  - `refuses an unknown order start` (and one case each for the other three enums) → message names
    `floor_zones_order_start_ck` (etc.).
  - `allows one counter-default zone among active zones` → a second active zone with
    `is_counter_default = 1` fails naming `floor_zones_one_counter_default_key`; **and** a second
    one whose first holder is inactive succeeds (the legitimate write, rules §4).
  - `stores null sale rules as "follow the department"` → insert with all four null succeeds and
    reads back null.
- [ ] **Step 2: Run** `pnpm --filter @waitron/db exec vitest run src/schema/floor-zones.test.ts`;
  expect failures on the missing columns.
- [ ] **Step 3: Implement.** In `floorZones` add the six columns; `foreignKey({ columns:
  [t.departmentId], foreignColumns: [departments.id], name: "floor_zones_department_fk" })` (the
  key's name does not reach SQLite; it keeps drizzle's snapshot stable);
  `check("floor_zones_order_start_ck", enumCheck(t.orderStart))` and the three like it, named
  exactly as `zone_sale_policies`' were with the table prefix changed; `uniqueIndex(
  "floor_zones_one_counter_default_key").on(t.isCounterDefault).where(sql\`${t.isCounterDefault} = 1
  and ${t.active} = 1\`)`. `departments` lives in `venue-service/service.ts`, which imports
  `floor-zones.ts`; use a lazy `foreignKey` column reference as `dining-tables.ts:24` does
  (`(): AnySQLiteColumn => departments.id`) if the module cycle bites.
  Delete `zoneServicePolicies` and `zoneSalePolicies`; point `zone_extensions_zone_fk` and
  `zone_days_zone_fk` at `floorZones.id` (keep `onDelete("cascade")` on `zone_days`). Remove the
  two tables from `CORE_OWN`/`HOSTED_CLASSIFICATION` (`classification.ts:331,333`),
  `VENUE_SERVICE_TABLES` (`venue-service/src/classification.ts:13,15`) and the `@waitron/db` exports.
  In `scripts/schema-constraints.test.ts` replace the three `zone_service_policies` rows (:353-355)
  with `["floor_zones", ["department_id"], "departments"]`, and change :356-357's parent to
  `floor_zones`.
- [ ] **Step 4: Rebuild** `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
- [ ] **Step 5: Run** the Step 2 command and `pnpm exec vitest run scripts/schema-constraints.test.ts
  scripts/classification-complete.test.ts scripts/starting-migrations.test.ts`; expect pass.
- [ ] **Step 6: Commit** (`git commit -s`).

## Task 2: `seedZone` gains a department, and the fixture script runs

**Interfaces:**
- Consumes (fk0): `seedZone`, `scripts/a1308/fk1-zone-fixtures.mjs`, `lib/fold-inserts.mjs`.
- Produces: `seedZone(db, input: { id?; name; displayOrder?; active?; departmentId?: string;
  isCounterDefault?: boolean }): Promise<{ id: string; departmentId: string }>` — uses
  `input.departmentId`, else the first active department by `created_at`, else inserts one named
  `"Test floor department"` (trading name the same, `is_default` true only if none is default).

- [ ] **Step 1: Write the failing test** (`packages/db/src/testing/seed.test.ts`): `seedZone gives a
  zone the venue's first active department`, `… creates one department when there is none`, `…
  uses the department it is given`.
- [ ] **Step 2: Run**; expect fail. **Step 3: Implement.** **Step 4: Run**; expect pass.
- [ ] **Step 5:** Run `node scripts/a1308/fk1-zone-fixtures.mjs --write` over the finish line's file
  list, then `pnpm exec prettier --write` the changed files. Where it reports a site, and where a
  test inserts a zone before the department it then gives it (stop point 1), hand-edit: create the
  department first, or call `seedZone` with its id. List every hand edit in the pull request
  (rules §1).
- [ ] **Step 6: Commit** the script's output alone, then the hand edits.

## Task 3: Writers

**Files:** `packages/venue-service/src/operations.ts`, `provisioning.ts`,
`service-delete-settings.ts`; tests in `operations.test.ts`, `provisioning.test.ts`,
`service-delete-settings.test.ts`.

**Interfaces:**
- `createServiceZone(tx, { name, departmentId, displayOrder?, orderStart? })` inserts the zone with
  `departmentId` and `orderStart` in one insert (no `configureZone` call needed for a new zone).
- `configureZone(tx, { zoneId, departmentId, orderStart? })` becomes an `update(floorZones)` of
  `departmentId` (and `orderStart` when it is not `undefined`) on the active zone; the routing-period
  clean-up at :407-420 is unchanged (fk8 changes it).
- `setZoneSalePolicyOverride(tx, zoneId, field, value)` updates that column on the active zone.
- `listSalePolicies(tx)` keeps its answer shape: `zones[]` of `{ zoneId, orderStart, paidWhen,
  collectionNumber, receiptPrintMode, effective }`, now built from `floorZones` columns;
  `ZoneSalePolicyRow` becomes `Pick<typeof floorZones.$inferSelect, "orderStart" | "paidWhen" |
  "collectionNumber" | "receiptPrintMode"> & { zoneId: string }`.

- [ ] **Step 1: Write the failing tests:**
  - `operations.test.ts`: `a new zone carries its department and order start` — after
    `createServiceZone(tx, { name: "Terrace", departmentId: d, orderStart: "table" })`, the
    `floor_zones` row has `department_id = d`, `order_start = 'table'`, and the other three sale
    rules null. (No change-log check: a test database has no change feed; only `boot.ts` and the
    protection-list build install it.)
  - `service-delete-settings.test.ts`: `deleting a zone clears its sale rules and counter mark but
    keeps its department` — a zone with all four overrides set and `is_counter_default = 1`, deleted
    with a replacement: its row has the four rules null, `is_counter_default = 0`, `active = 0`,
    `department_id` unchanged; the replacement has `is_counter_default = 1`.
  - `deleting the counter zone hands the mark to its replacement` — the delete transaction commits
    (no `floor_zones_one_counter_default_key` refusal).
- [ ] **Step 2: Run** `pnpm --filter @waitron/venue-service exec vitest run src/operations.test.ts
  src/service-delete-settings.test.ts`; expect fail.
- [ ] **Step 3: Implement.** In `clearServiceDeleteSettings`, replace the sale-rule delete (:377) and
  the policy delete (:404) with one `update(floorZones).set({ isCounterDefault: false, orderStart:
  null, paidWhen: null, collectionNumber: null, receiptPrintMode: null }).where(inArray(floorZones.id,
  selected.zoneIds))` at :404's position, before the counter replacement at :438-442 (which becomes
  an update of `floorZones`). The `zone_days` delete at :376 stays explicit (appendix §1.1: a soft
  delete fires no cascade). In `provisioning.ts:76-145`, the counter-zone lookup reads
  `floorZones` (`isCounterDefault`, `active`, joined to active `departments`), the clearing update at
  :91-94 updates `floorZones`, and the zone insert at :98-110 carries `departmentId` and
  `isCounterDefault: true` in both `values` and the conflict `set`; delete the policy insert at
  :111-122 and the sale-policy insert at :141-144.
- [ ] **Step 4: Run** the Step 2 command plus `src/provisioning.test.ts src/routes.test.ts`; expect
  pass with no assertion changed.
- [ ] **Step 5: Commit.**

## Task 4: Readers ask for active zones

**Files:** the twelve reader files listed under Files; test
`packages/venue-service/src/zone-active-reads.test.ts` (create).

The rule: every query that today names `zoneServicePolicies` becomes a query on `floorZones` (its
`departmentId`, `isCounterDefault` or `id`), and gains `eq(floorZones.active, true)` unless it
already has it. The sites, at the base commit (`git grep -n -w zoneServicePolicies --
packages/venue-service/src ':!*.test.ts'` lists them all):

| File | Lines | Already filters `floor_zones.active`? |
| --- | --- | --- |
| `business-day-schedule.ts` | 78-90, 126-138, 288-296 | no |
| `day-resolver.ts` | 267 | no |
| `floor-layout-due.ts` | 110-119 | no |
| `floor-plan-set-store.ts` | 112-119 | check the `where` |
| `operations.ts` | 109-119, 325-347, 393-404, 495-510, 547-566, 807-829, 983-985, 1058-1060 | 325-347 yes; others check |
| `profile-access.ts` | 99-104, 167-170, 376-379 | check each |
| `provisioning.ts` | 78-94, 126-140 | yes |
| `release-reminders.ts` | 12-17 | no |
| `routing-store.ts` | 115-121, 653-654 | check; 653 no |
| `service-delete.ts` | 85-87, 212-215 | check |
| `service-delete-settings.ts` | 64-69, 103-107 | check |
| `service-step-completions.ts` | 29-38 | no |
| `special-days.ts` | 689-695 | check |
| `table-clearing.ts` | 12-15 | no |
| `zone-closed-times.ts` | 134-138 | check |

`operations.ts:325-347` (venue readiness): `zone.departmentId` can no longer be null; keep the
`departmentActive !== true` branch and drop the `=== null` half (stop point 2 if a test asserts it).

- [ ] **Step 1: Write the failing test** `deleted zone stays out of every zone read`: seed two zones
  in one department, delete one through `deleteZone`, then assert the deleted zone's id is absent
  from `listServiceZones`, `listSalePolicies().zones`, `resolveZoneContext` (refuses
  `service_zone.not_found`), `dueFloorLayouts`, the release-reminder read, the table-clearing read
  and the routing model's zone list. (It passes today through the policy row; it must keep passing.)
- [ ] **Step 2: Run it on the Task 3 tree** (before this task's edits it fails to compile; that is
  the red state).
- [ ] **Step 3: Implement** the table above.
- [ ] **Step 4: Run** the Finish-line venue-service command; expect pass.
- [ ] **Step 5: Commit.**

## Task 5: Configuration transfer, live queries, seeds

**Files:** `packages/venue-service/src/configuration-transfer.ts`, both `live-queries.ts`,
`apps/server/scripts/demo-seed/seed-floor.ts`, `seed-catalogue.ts`,
`apps/server/src/testing/clear-provision-fixture.ts`; tests in
`packages/venue-service/src/configuration-transfer.test.ts` and
`apps/server/src/configuration-transfer.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - venue-service `configuration-transfer.test.ts`: `a zone's department and sale rules travel on the
    zone` — export, import into a second venue: the imported zone has the new department's id and
    the same four rule values.
  - `refuses a zone naming a department not in the bundle` → `setup.request_invalid` with `field:
    "floor_zones.department_id"`.
  - `a zone of a switched-off department stays behind` → the export holds neither.
- [ ] **Step 2: Run**; expect fail.
- [ ] **Step 3: Implement.** Validators read `tables.floor_zones` rows' `department_id` where they
  read `tables.zone_service_policies` (:283, :368, :465, :478); `validateServiceHierarchy`
  (:566-578) checks `floor_zones.department_id` against departments; `validateReceiptModes` and
  `validateOrderStarts` read `floor_zones` (null allowed); `validateServicePolicyCompleteness`
  drops its two zone rows (a NOT NULL column replaces them). Remove the two table entries at
  :703-704. In the dashboard and venue-service `live-queries.ts`, replace `"zone_service_policies"`
  and `"zone_sale_policies"` with `"floor_zones"`, de-duplicating. Seeds write the zone's department
  in its insert. Raise the bundle format version by one from `main`'s value at
  `packages/provisioning/src/configuration-transfer.ts:123, 160, 473-476`, with a case that a bundle
  carrying the old number is refused `setup.configuration_outdated` (rules §9).
- [ ] **Step 4: Error fields that name a deleted table.** These assertions change, and only these
  (Global constraints): `field` values `zone_service_policies.zone_id`,
  `zone_service_policies.department_id`, `zone_sale_policies.zone_id`,
  `zone_sale_policies.receipt_print_mode`, `zone_sale_policies.order_start`, and the bare
  `zone_service_policies` / `zone_sale_policies` from the completeness check. Map them to
  `floor_zones.department_id`, `floor_zones.receipt_print_mode`, `floor_zones.order_start`; the
  zone-id and completeness cases are deleted with their checks. List each in the pull request.
- [ ] **Step 5: Run** the Finish-line commands for these files; expect pass.
- [ ] **Step 6: Commit.**

## Task 6: The Madrid baseline follows the fold

**Files:** `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`; if B4 found no helper,
create `apps/server/scripts/demo-seed/testing/madrid-folded-tables.ts` and `.test.ts`.

**Interfaces (only if built here):** `madridWithFoldedTables(snapshot: CanonicalMadridSemantics,
folds: readonly MadridFold[]): CanonicalMadridSemantics`, with `MadridFold = { from: string; into:
string; match: { from: string; into: string }; columns: Readonly<Record<string, string>> }`. For each
fold it copies every `from` row's listed columns (renamed by the map) onto the `into` row whose
`match.into` column equals the `from` row's `match.from`, gives an unmatched `into` row the
column's declared default, appends the columns to `into`'s column list, and removes `from` from
`tables` and from the phase counts.

- [ ] **Step 1: Write the failing test** (`madrid-folded-tables.test.ts`): a two-table snapshot
  folds into one; an unmatched row gets null; the `from` table and its count disappear.
- [ ] **Step 2: Run, see it fail; implement; run, see it pass.**
- [ ] **Step 3:** In `seed.madrid-baseline.test.ts`, fold `zone_service_policies` (match `zone_id`
  → `id`; columns `department_id`, `is_counter_default`) and `zone_sale_policies` (match `zone_id`
  → `id`; the four rule columns) into `floor_zones` for all three phases. Run
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts`;
  expect pass with the fixture files unchanged.
- [ ] **Step 4: Commit.**

## Task 7: Documents, backlog, protection list, finish

- [ ] **Step 1:** Update `conventions-data.md` "Department and zone service settings" to name
  `floor_zones.order_start` etc. (no table names left that no longer exist), and add to "Permanent
  hierarchy deletion" one sentence: a deleted zone keeps its row and department, with its sale
  rules and counter mark cleared. Update `dashboard-live-updates.md:98`. Leave
  `docs/developers/grants-retirement-audit.md` as written: it is a dated audit.
- [ ] **Step 2:** `pnpm protection-list list --out <B>`, then `pnpm protection-list compare --old <A>
  --new <B> --report <file>`; paste the report into the pull request with each line marked against
  the table above. Any unpredicted line is a stop (rules §5.2).
- [ ] **Step 3:** Run every Finish-line command; then `/finish-branch` (rules §9).
