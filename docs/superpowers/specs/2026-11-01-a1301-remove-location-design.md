# A1301 — Remove the location concept: one venue, one box, one premises

Status: design, 2026-11-01, lane A. Owner decision it builds (2026-11-01 ~14:45): "Remove the
location concept from the codebase entirely", and (~14:55) "Give this high priority so we don't
build anything more on this concept." Inputs: the inventory and the fiscal check written for this
item by two read-only research seats (`~/waitron-campaign/a1301/inventory.md`,
`~/waitron-campaign/a1301/fiscal-check.md`, both at `790214ba8c`), and lane B's in-flight A1268
[design](2026-11-01-a1268-clock-ins-per-venue-design.md) and
[plan](../plans/2026-11-01-a1268-clock-ins-per-venue.md). There is no A1301 entry in
`docs/backlog.md` yet; the plan adds it (a docs-only change).

Words used below, once: a **location** is today's `locations` row, a place a box was imagined to
serve one of several of. A **venue** is the premises; after this item it is the only place there
is. A **migration set** is one package's own list of database migrations. A **rebuild** is how the
database tool changes a table it cannot alter in place: it creates a copy, moves the rows, deletes
the old table and renames the copy. **Append-only** tables refuse any change to a row once written.
A **reset** wipes a box's venue database and sets it up again; before go-live that is allowed in
place of migrating data (CLAUDE.md §3, "No backwards-compatibility or data-migration code until
Waitron is in production").

## 1. Summary

**For a reader of the code.** The `locations` table, its three side tables and the `location_id`
column on 39 tables go. Nothing passes a location id any more: the module contract's
`cfg.locationId`, the server's `NodeConfig.locationId`, the `LocationId` id type, the
`?locationId=` queries and the `/management-api/locations…` routes all go. The venue's settings
(name, address, receipt languages, time zone, start of the business day, operation description,
tax territory) live in one new one-row table, `venue_settings`, read through one function that
takes no id. Every "is this row at the same location?" check, and every test that exists only to
prove such a check, is deleted rather than rewritten.

**For the venue's staff.** Nothing behaves differently on a box, because every box today serves
exactly one location (A1268 design §2). What changes is words: "location" becomes "venue" in the
setup app, the dashboard and two guide pages, in English and Spanish; the dashboard's location
picker on planned-versus-actual disappears; the attendance screens lose a "Location" column whose
value was always the same.

**For fiscal records.** No AEAT message, invoice hash, invoice chain, invoice numbering or
invoicing-system identity changes (§3). Two hashes outside AEAT — the working-time entry hash and
the pay-period closure hash — name the location today; what they name instead is the owner's
choice (§3, two questions).

## 2. Where the venue's settings live

### Decision: a new one-row `venue_settings` table in the core migration set

Three homes were weighed.

1. **The `tenants` row — rejected.** `tenants` is the taxpayer: "One taxpayer per database. Fiscal
   identity is country + tax_id" (`packages/db/src/schema/tenants.ts:34-37`). Only three
   provisioning files may write it (`scripts/write-path-tables.json:13-17`), and a table that file
   lists is one "request code may read and never write" (CLAUDE.md §3). The venue settings are
   edited by request code every day: the venue details page (`apps/server/src/location-settings-api.ts:98`
   writes `locations`), the business-day start editor, and A696's time-zone repair (§2.4). Putting
   them on `tenants` would either break that rule or put routine request writes beside the fiscal
   identity columns.
2. **Split by owning module** (the inventory's §7 suggestion: default menu to `catalogue_settings`,
   business day to reporting) — **rejected for the core fields.** The receipt languages are read by
   four core-set triggers on `working_order_lines` (§2.3), the time zone and business-day start by
   reporting, core, workforce, bookings and venue-service (`readLocationClock`, 101 call lines in 40
   files, per inventory.md §4), the tax territory by generic provisioning. Splitting them would put
   core-set triggers and readers on module-owned tables. The one field that does belong to a module
   already lives in one: the collective-agreement settings stay in `workforce-es` (§2.2).
3. **A new one-row table — chosen.** One row, `id = 1` enforced by a check, as six tables already do
   (`catalogue_settings` at `packages/catalogue/src/schema/settings.ts:16`; `adjustment_settings`,
   `content_languages`, `deployment`, `node_membership`, `tenant_receipts` per inventory.md §7). It is
   keyed by nothing, which fits "There is no tenant column … a query that wants 'this tenant's rows'
   reads the table" (CLAUDE.md §3): no child table gains a `venue_id`. It is not in
   `scripts/write-path-tables.json`, so request code may write it, as it writes `locations` today.

**Reason for entering the core migration set** (CLAUDE.md §3 asks for one): it replaces `locations`,
which is in the core set (`packages/db/src/classification.ts:104`), and its readers include the
core set's own triggers. The same reason covers the three replacement side tables below, each a
one-for-one replacement of a core table. All four are classified `state`, as their predecessors are
(`classification.ts:104-106,116`).

### 2.1 Field-by-field mapping

`locations` columns are from `packages/db/src/schema/tenants.ts:70-102`.

| Today | New home | Note |
| --- | --- | --- |
| `locations.id` | deleted | `venue_settings.id` is the constant 1 |
| `name` | `venue_settings.name` | read in 32 files (inventory.md §7); the art. 34.9 export's "Workplace / Centro de trabajo" shows it |
| `invoice_locales` (1–2 entries, `locations_invoice_locales_len`) | `venue_settings.invoice_locales`, same check | each sale still snapshots its own copy in `sales.invoice_locales` (`tenants.ts` comment above `locations`) |
| `operation_description` | `venue_settings.operation_description` | kept: it is the fallback the demo seed and tests file with (fiscal-check.md path 1); production callers always pass their own |
| `fiscal_territory` (default `ES-common`) | `venue_settings.fiscal_territory` | decides the fiscal module at setup and restore (fiscal-check.md path 4) |
| `address_line1`, `address_line2`, `postal_code`, `city`, `province` | `venue_settings`, same names | printed on receipts; `city`/`province` drive holidays and receipt language |
| `time_zone` (default `Europe/Madrid`) | `venue_settings.time_zone` | see §2.4 for A696 |
| `day_cutover` (default `06:00:00`) | `venue_settings.day_cutover` | |
| `bump_mode` | **deleted, unused** | "Read by nothing: each station has its own `bump_mode`" (`tenants.ts:20-24`); re-checked: `git grep -n -E 'locations\.bumpMode\|l\.bump_mode\|locations\.bump_mode' -- apps packages ':!**/drizzle/**'` prints nothing (the `bumpMode` readers in `apps/server/src/kitchen.ts:146` read `kitchenStations`) |
| `fire_control` | **deleted, unused** | only the configuration bundle reads or writes it (`packages/provisioning/src/configuration-transfer.ts:104,174,536`; re-checked with `git grep -n -w -E 'fireControl\|fire_control' -- 'apps/*/src/**' 'packages/*/src/**' ':!*.test.ts'`), and its removal is already planned under A773-2 (`docs/backlog/kitchen.md:296`). Whichever lands first does it; the other drops the step. When firing is built it adds its own setting |
| `catalogue_id` (the default menu) | `venue_settings.default_catalogue_id` → `catalogues.id` | `catalogues` is a core table (`packages/db/src/schema/catalogue.ts:28`), so this stays a core-to-core key, as today |
| `location_catalogues(location_id, catalogue_id)` | `venue_catalogues(catalogue_id)` primary key | the extra menus offered; kept separate from the default on purpose — "membership and the default stay independent" (`packages/catalogue/src/operations.ts:1310-1316`) |
| `location_business_day_settings(location_id, revision)` | `business_day_settings(id = 1, revision)` | kept a table of its own so the live subscriptions that depend on it keep the same table dependencies and do not wake on every venue-details save |
| `location_day_cutover_changes(location_id, effective_business_day, day_cutover)` | `day_cutover_changes(effective_business_day` primary key`, day_cutover)` | same checks |

`nodes.location_id` and every other `location_id` column are deleted with nothing in their place
(§4).

### 2.2 Settings held per location in other tables

`convenio_config` (`packages/workforce-es/src/schema/convenio-config.ts:45`, one collective-agreement
rule set per location, `convenio_config_location_uq`) becomes a one-row table in its own set with the
same `id = 1` check. `staff_roles`, `departments`, `seasons` and the rest simply lose the column and
the location part of their unique keys (§4).

### 2.3 The four triggers that read `invoice_locales`

`working_order_lines_check_locales_insert/_update` and
`working_order_lines_check_variant_locales_insert/_update`
(`packages/db/drizzle/0110_printing_retirement_restore_readers.sql:1,29,58,91`, re-read) each join
`locations l ON l.id = wo.location_id` and `json_each(l.invoice_locales)`. They are rewritten to read
`(SELECT invoice_locales FROM venue_settings WHERE id = 1)` with no join through the order, in the
same migration that creates `venue_settings` (S20). They are dropped before `locations` is rebuilt
and created again after, which is what 0105/0107 did for the same readers
(`packages/db/drizzle/0105_locations_drop_reader_triggers.sql`, `0107_locations_restore_reader_triggers.sql`).
`working_orders_enforce_transition` (`0198_recipient_identifier_guards.sql`) and
`tender_refunds_guard_update` (`0163_tender_refund_transitions.sql:20`) name `location_id` and are
rewritten without it in S22, before the column goes (SQLite refuses to drop a column a trigger
names).

### 2.4 A696 (open PR #2369) adds location-keyed time-zone code

A696 is open and mergeable at `8ec592f10f`. It reads the saved zone from `locations` through
`nodes.location_id` in new files: `packages/fiscal/src/issue-clock.ts:7-23` (`readIssueZone`, with a
`scope.locationId` mismatch refusal), `apps/server/src/venue-zone-context.ts:36-62`, and the
zone repair. **This changes one fiscal-check finding for the tree after #2369 lands:** fiscal-check.md
(at `790214ba8c`) found the record offset taken from the host's clock "never `locations.time_zone`";
with #2369, `prepareIssueClock` (`issue-clock.ts:24-38`) sets `offsetMinutes` from the saved zone, and
it is called where sales are recorded (`apps/server/src/till-sale.ts:987`, `bill-payments.ts:702`,
`cancel-credit.ts:54`, all at `8ec592f10f`). The offset feeds `FechaHoraHusoGenRegistro`, which is in
the invoice hash (fiscal-check.md "The hash, checked by running it"). Traced by reading at
`8ec592f10f`, not run. Consequence: after #2369, moving the zone from `locations` to `venue_settings`
moves the source of a hashed input. The value is the same, so no hash changes, but the slices that
move it (S2, S20) are fiscal and the owner lands them. **A696 lands before S1**, and A1301 rebases
over it, so its new readers are converted with the rest.

### 2.5 What each front end shows instead

- **Setup app.** The "Location" section and "Location name" field become "Venue" and "Venue name";
  the intro's "the address of this location" becomes "of this venue"; review's "Location" group
  becomes "Venue". Spanish already says "Local" / "Nombre del local"
  (`apps/setup/src/i18n/strings/venue.ts:292,299`) and keeps it. Restore's preview line naming the
  location shows the venue name.
- **Dashboard.** `wt-location-picker` (`apps/dashboard/src/widgets/location-picker.ts`, used only by
  `screens/planned-actual-screen.ts`) is deleted with its "No location configured yet." message;
  attendance screens lose the Location column; "Every location" (`receipts.venue_wide`) becomes
  "The whole venue" / "Todo el local"; the `location_settings.*` keys become `venue_settings.*`
  (wording unchanged except "location settings" → "venue settings"); "No active printer at this
  location" → "at this venue".
- **Till.** "Your open shift belongs to another location" goes (A1268 PR 2 or S12); attendance-day
  and hours screens stop showing or sending a location.
- **Guides.** §5.

## 3. Fiscal check

Per fiscal-check.md, with the claims re-checked marked.

- **Invoice hash (huella).** `computeHuella` joins issuer NIF, series-and-number, issue date,
  invoice type, tax total, total, previous hash and record time; no location field. Re-checked by
  re-running `/tmp/a1301-probe/huella-probe.mjs` against
  `packages/fiscal-verifactu/node_modules/@waitron/verifactu`: changing the operation description
  and the issuer name printed `SAME`; the control (changing the total) printed `DIFFERENT`.
- **Chain, numbering, invoicing-system identity.** No location reference in
  `packages/db/src/allocate-number.ts` or fiscal-verifactu's `registro-sif`, `restore`, `chain`,
  `backend`, `registro-row`, `drain`, `reserved-series`, `allocation-identity`, `hour-identity`, or
  any `schema/` file; no fiscal-verifactu table or trigger names a location (fiscal-check.md "None of
  the files that build, chain, store or send a fiscal record mention the location"). Series are keyed
  by node (`invoice_series`).
- **AEAT body.** One location field can reach it: `operation_description` → `DescripcionOperacion`,
  only as a fallback no production route takes (`apps/server/src/sale-operation-description.ts:7-50`
  always supplies one, per fiscal-check.md path 1). It moves to `venue_settings` with the same value.
  Not in the hash (the probe above).
- **Other dated values.** `sales.operation_date` (path 2), the certificate check's AEAT query month
  (path 3), the daily-close hash's business day and zone (path 7) and, after #2369, the record
  offset (§2.4) all read the time zone or business-day start; they keep the same values from the
  venue.
- **Not reached.** Modelo 303 dates each sale by its stored offset (`packages/reporting/src/vat-return.ts:25-35`).

**Plainly: no AEAT message byte, invoice hash, invoice chain, invoice series or numbering, or
invoicing-system identity changes.** The fiscal gates — `pnpm --filter @waitron/fiscal-verifactu exec
vitest run inmutabilidad` and `… src/write-path.e2e.test.ts` (the golden hash case) — pass with their
assertions unedited in every slice; only the seed helpers that insert a `locations` row change
(fiscal-check.md "Tests in packages/fiscal-verifactu").

### Owner question 1 — does a working-time entry's hash name where it was made?

Every clock-in, clock-out and break is hashed with the location it was made at
(`packages/workforce/src/chain-hash.ts:67`, `["LocationId", input.locationId]`, re-read). A1268 keeps
it (A1268 D1). With locations gone there is no place left to name. The rule question: **should an
entry's hash name only the person, the node (the box that wrote it) and the event, and no place?**

Worked example, one clock-in (ids shortened):

- Today: `SequenceNo=1&PersonId=p-7&LocationId=6f1c…a2&NodeId=n-1&EntryKind=clock_in&…&PrevEntryHash=`
- (a) Drop the field: `SequenceNo=1&PersonId=p-7&NodeId=n-1&EntryKind=clock_in&…&PrevEntryHash=`.
  Every existing entry's hash would no longer match, so a box that has clock entries is reset: its
  working-time record is wiped and starts again. Today that is only test and demo boxes.
- (b) Keep the field name with a fixed value (`LocationId=`): the format keeps a field that means
  nothing, and old entries still stop matching (they hashed a real id). Same reset.

**Recommended: (a).** The `time_entries` table has to be rebuilt either way to lose the column,
because its triggers refuse an update (fiscal-check.md path 9).

### Owner question 2 — is a pay period closed once for the venue, with no place in its hash?

`computeClosureHash` (`packages/workforce/src/pay-period-chain.ts:119-130`, re-read; `row.locationId`
at `:123`) hashes the closure's id, node, location, period, the clock (zone, day start, changes) and
more. Closures form a chain per (node, location), and a period can be closed once per location
(`pay_period_closures_period_uq`). A1268 leaves this alone (D6). The rule question: **should a pay
period be closed once for the venue, its closures forming one chain per node, with no place in the
hash?**

Worked example: `["c-1","n-1","6f1c…a2","2026-10-01","2026-10-31","Europe/Madrid","05:00",[…],…]`
becomes `["c-1","n-1","2026-10-01","2026-10-31","Europe/Madrid","05:00",[…],…]`. The zone and day
start stay, with the same values. The chain position becomes unique per (node, sequence number) and
the period unique per (start, end). Every existing closure stops matching, so a box that has closed
a pay period is reset. **Recommended: drop it, in the same slice as question 1.**

**Which slices wait for the answers:** only S19 (the workforce tables and the two hash functions).
Every other slice proceeds. Until S19, workforce code stamps the venue's single location id on new
entries through the interim helper (§6, S1), so the hashed bytes stay exactly as today.

## 4. What the schema work must do

From inventory.md §1, re-checked where marked.

- **Tables carrying `location_id`: 39** (inventory.md §1b), plus `locations` itself. Two have no key
  to `locations`: `join_requests` (a node-local table, `packages/db/src/schema/join-requests.ts:45-51`)
  and `order_service_contexts`. By set: core 17 (`nodes`, `working_orders`, `dining_tables`,
  `floor_plan_sets`, `floor_zones`, `kitchen_stations`, `kitchen_courses`, `devices`, `join_requests`,
  `print_agents`, `printers`, `print_jobs`, `page_printers`, `tender_refunds`, and the three side
  tables); bookings 1; staffing 1; venue-service 8; workforce 11 (A1268 PR 1 removes
  `workforce_chains`'s); workforce-es 1.
- **Unique keys that include `location_id`** lose that column: `dining_tables_location_label_key`,
  `…_short_name_key_uq`, `floor_zones_name_key`, `kitchen_stations_name_key`,
  `kitchen_stations_default_key` and `departments_one_default_per_location_key` (one default per
  venue), `kitchen_courses_name_key`, `devices_location_label_active_key`, `printers_local_key_key`,
  `page_printers_endpoint_uq`, `staff_roles_location_name_key`, `departments_location_name_key`,
  `zone_service_policies_one_counter_default_key`, the seven `routing_cells` partial unique indexes,
  `holiday_geographies_location_place_key`, `seasons_location_starts_key`/`…_name_key`,
  `special_day_dates_location_date_key`, the `attendance_*` scope keys, `roster_versions_published_period_uq`,
  `time_entries_subject_identity_uq`, `pay_period_closures_*_uq`, `convenio_config_location_uq`.
  A key whose only column was `location_id` (the "one default" keys) becomes a partial unique index
  on the flag column — a real column, never a constant expression (next bullet).
- **Expression indexes.** None on these tables. Experiment: `/tmp/a1301-design/snap.mjs` read every
  set's latest snapshot and printed no index on a `location_id` table with a column containing a
  bracket or a space. Weaker than it sounds: it reads drizzle's snapshot strings, not the SQL. A new
  "one default" index must be on a column, because drizzle-kit 0.31.11 writes an expression index back
  wrong in a rebuild (CLAUDE.md §3).
- **Foreign keys pointing AT the tables that will be rebuilt** — the CLAUDE.md §3 hazard "a drizzle
  table rebuild … runs with foreign keys ON, so its `DROP TABLE` silently deletes every cascading
  child's rows, and fails on a `no action` or `restrict` child holding rows". Measured with the same
  script (child tables with their delete rule):
  - `working_orders`: cascading children `working_order_lines`, `kitchen_print_jobs`,
    `bill_edit_states`, `order_service_contexts`, `kitchen_notices`, `order_kitchen_notes`;
    restricting children include `sales`, `bill_payments`, `payments`.
  - `nodes`: `sales`, `registros_facturacion`, `registro_sif`, `cadenas`, `invoice_series`,
    `daily_closes` and more (restrict / no action).
  - `devices`: cascading `device_approved_profiles`, `printer_holders`, `card_reader_holders`;
    restricting `sales`, `registros_facturacion`, `time_entries` and more.
  - `departments`, `seasons`, `special_day_dates`, `kitchen_stations`: cascading `shift_assignments`,
    `staffing_days`, `department_days`, `zone_days`; `routing_cells` → `routing_cell_periods`;
    `staff_roles` → `person_staff_roles`, `staffing_blocks`; `shifts` → `shift_assignments`,
    `shift_swaps`; `print_jobs` → `kitchen_print_job_lines`; `printers` → `printer_holders`.
  - `locations` itself: 37 children, none cascading.

  So a rebuild either fails loudly (a restricting child has rows) or quietly deletes cascading
  children (orders with lines but no sale yet). Fiscal-check.md's probe, re-run
  (`node /tmp/a1301-probe/rebuild-probe.mjs`, SQLite 3.54.0): a plain `ALTER TABLE nodes DROP COLUMN
  location_id` succeeded with and without a child row; a rebuild in a transaction failed with
  `FOREIGN KEY constraint failed` once a child row existed. **Decision: every schema slice is a reset
  for every venue, said in the PR's first line**, whether or not its migration happens to run on a
  given box. A box that "migrates" through a quiet cascade is still reset. Each schema slice reads the
  SQL drizzle-kit generates, lists which tables it rebuilds and their children from this table, and
  rehearses on `node:sqlite` through `scripts/migration-upgrade.test.ts`, never the `sqlite3` command
  line (CLAUDE.md §3: macOS's `sqlite3` 3.51.0 refuses the rename the app's 3.54.0 runs).
- **drizzle-kit 0.31.x rebuild plus added column** fails with `no such column` (CLAUDE.md §3): S20
  creates `venue_settings` as a new table and only removes columns from `locations`, so no single
  generation both rebuilds a table and adds a column to it. Where a slice must do both, it uses two
  generations. If `drizzle-kit generate` stops to ask whether a new table is a renamed old one, the
  slice splits the create and the drop into separate generations; the build records which happened.
- **Append-only tables.** Only `time_entries` and `pay_period_closures` carry `location_id` (inventory.md
  §1b). Their rebuild (S19) drops and must recreate their append-only triggers; the slice checks with
  `scripts/append-only-triggers.test.ts` that they are back, and discloses in the PR whether first
  start raises `append_only.triggers_restored` (CLAUDE.md §3 asks for that disclosure). No fiscal
  table carries a location column (§3).
- **Configuration bundle.** `locationColumns` (`packages/module/src/module.ts:1592`, applied at
  `packages/provisioning/src/configuration-transfer.ts:737,755-756`) is deleted, with its declarations
  in the five `configuration-transfer.ts` files. The bundle's `venue.location` object becomes venue
  fields; `LocationDraft` (`apps/setup/src/api/client.ts:60-72`) folds into the venue draft. The
  default catalogue is not a setup field, so it travels outside `venue`'s own keys (CLAUDE.md §3,
  "A configuration bundle value that is not a setup field stays out of `venue`'s own keys"); the plan
  names the key. `venue_catalogues.catalogue_id` is a declared reference. Old exports stop importing,
  which pre-live is allowed.
- **Host files.** The dormant-standby state in `<state>/module-preparation-state.json` and the standby
  join bundle carry `locationId`, and `readDormant` demands exactly its six keys
  (`packages/fiscal-verifactu/src/hour-dormant-standby.ts:50-75`, per fiscal-check.md path 8). A box
  holding that file is reset when S3 lands.

### Fold the schema drop into A760? No.

A760, the planned squash of every migration set into one starting migration, is approved as a pure
squash: "generate each baseline from its unchanged TypeScript schema … retaining the exact fresh
schema" (`docs/operations/a760-migration-squash.md`, Goal and Architecture). Folding A1301's schema
change into it would change an owner-approved procedure, so **A1301's schema slices ship on their
own**. A760 starts only once "big work and migration branches drain" (`docs/backlog/architecture.md`,
A760), so the order is: A1301's reset window (S17–S22), then A760. A760 resets every venue anyway,
so the watcher keeps the boxes on its reset roster off between the two and resets them once, after
A760. The trade-off: A760 waits for A1301's schema slices. If the watcher has already started A760's
freeze when S17 is ready, S17–S22 wait for A760 to land and then ship as ordinary migrations on the
new baseline, with the same hazards.

## 5. Text and docs

Each slice updates the words its change makes stale (CLAUDE.md §6). S16 sweeps what is left and
proves it with a grep.

- **Guides** (English and Spanish twins, `apps/server/src/guide/`): `en/content-and-images.md:103,105`
  ("location's default", "location's receipt language") and `es/content-and-images.md:103,105` ("de la
  ubicación"); `en/backup-recovery.md:106` ("its source, business, location") and
  `es/backup-recovery.md:117-118` ("el local"). Found with `/usr/bin/grep -rn 'ubicaci'`;
  `git grep -n -i -E 'ubicaci[oó]n'` printed nothing on the same files, so Spanish is searched with
  `/usr/bin/grep`.
- **Translation keys** (inventory.md §5): `attendance.location`, `attendance.time_skipped`,
  `receipts.venue_wide`, `receipts.no_address`, `receipts.trading_name_location`, `location_settings.*`,
  `planned.location`, `planned.no_location`, `clock.other_location` (A1268), `venue.section.location`,
  `venue.label.location_name`, `venue.hint.name`, `venue.field.name`, `review.location`,
  `review.group.location`, `review.help.location`, `restore.preview_location`,
  `restore_bucket.venue_details`, the attendance email's `locationName`, the printer string, and the
  dashboard error wording for `location.not_found`.
- **Error codes.** `location.not_found` (`packages/catalogue/src/errors.ts:94`) is deleted; codes whose
  details carry `locationId` (`station.no_default`, `convenio.not_found`,
  `attendance.append_contention`, `roster.draft_exists`) drop it; `restore.stream_venue_unconfirmed`'s
  `locationName` becomes `venueName`, and `scripts/personal-log-params.test.ts:125` follows.
- **CLAUDE.md**: line 297 ("the tenant's legal name (not a location)") loses the comparison; line 401
  (`venue.location` by `LocationDraft`'s fields) and line 547 (`locationColumns`) are rewritten by S14
  with `docs/developers/conventions-data.md`.
- **docs/developers**: conventions-data.md (31 matching lines), products.md, design-system.md,
  testing-guide.md, conventions-ui.md and the one- and two-line files in inventory.md §5.
- **Backlog**: the 16 lines that assume several locations (inventory.md §5's list; count re-run with
  the same grep). Entries that exist only for several locations are deleted — for example "the
  working-time record of a box with more than one location" (`docs/backlog/data-protection.md:126`),
  the cross-location scoping of by-id actions, and "Station deletion's draft-location filter needs a
  discriminating test" (`docs/backlog/architecture.md`). Lines that mention a location in passing are
  reworded. A1268's backlog entry and spec get a dated pointer.
- **Demo seeds and scripts**: `apps/server/scripts/demo-seed/*`, `dev-setup.ts`, `allergens-demo.ts`,
  `daily-close-demo.ts`, `daily-close-z-demo.ts`, `modelo-303-demo.ts`, `record-one-sale.ts`; test seeds
  `packages/db/src/testing/seed.ts`, `packages/fiscal-verifactu/src/testing/seed.ts`. Country packs'
  `demo.locationName` (`packages/country/src/country.ts:26,124`, `packages/country-es/src/spain.ts:274-341`)
  becomes `demo.venueName`.
- **Starter content**: no match (inventory.md §5).
- `scripts/no-till-as-issuer.mjs`'s ban on `WAITRON_LOCATION_ID` stays: it still bans a variable no one
  should add.

## 6. Slices

**How the code slices stay green without the schema.** S1 adds one interim helper,
`venueLocationId(tx)`, that returns the id of the database's single `locations` row and refuses
otherwise. Code that must still fill a `location_id` column until its schema slice calls it instead of
receiving an id; S22 deletes it with the last column. This keeps every code slice free of migrations
and resets, and keeps the working-time hashes byte-for-byte as today until S19.

Each code slice also deletes the tests that exist only to prove a cross-location refusal (fiscal-check.md
gives `allocation-operation.test.ts:680` and `cloud-preparation.test.ts:487` as examples) and moves its
callers of `readLocationClock(tx, id)` to `readVenueClock(tx)`. A rough upper bound on the test files
that mention a second place: about 300 (`git grep -l -i -E 'second ?location|another location|other
?location|locationB|location2|otherLoc|elsewhere' -- '*.test.ts'`, which also matches unrelated words);
the plan measures each slice's real share before sizing it, and splits any slice past one implementer's
budget.

Guard groups named below:
- **Fiscal pair**: `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`, assertions unedited.
- **Code guards**: `scripts/module-seams.test.ts`, `scripts/live-subscriptions.test.ts`,
  `scripts/errors-reachable.test.ts`, `scripts/personal-log-params.test.ts`, `scripts/english-only.test.ts`,
  plus the touched packages' focused tests (CI runs the package suites).
- **Schema guards**: `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`,
  `scripts/behavioural-triggers.test.ts`, `scripts/classification-complete.test.ts`,
  `scripts/two-file-foreign-keys.test.ts`, `scripts/migrations-match-schema.test.ts`,
  `scripts/migration-upgrade.test.ts`, `scripts/journal-monotonic.test.ts`,
  `scripts/id-columns-are-references.test.ts`, `scripts/append-only-migration-sets.test.ts`, and the
  fiscal pair.
- **Text guards**: `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`,
  `scripts/claude-md-pointers.test.ts`.

| Id | Goal | Touches | Depends on | Migration | Reset | Lands | Guards |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **S1** | The venue accessor: `readVenue(tx)`, `readVenueClock(tx)`, interim `venueLocationId(tx)`; repoint the readers already named "venue" | `packages/db/src/venue.ts` (new), `packages/reporting/src/business-day.ts`; `apps/server/src/venue-locale.ts`, `venue-time-zone.ts`, `venue-address.ts`, `venue-details.ts`, `location-settings-api.ts` (renamed `venue-settings-api.ts`), `business-day-start.ts`, A696's `venue-zone-context.ts` and zone repair | A696 (#2369) landed | no | no | lane | code |
| **S2** | Fiscal record inputs read the venue: operation description fallback, a full invoice's operation date zone, the issue zone (drop `scope.locationId`) | `packages/core/src/sale-location.ts`, `record-sale.ts:276-294`, `packages/fiscal/src/issue-clock.ts`; callers in `apps/server` (`till-sale.ts`, `bill-payments.ts`, `cancel-credit.ts`); `apps/server/scripts/record-one-sale.ts`, demo `seed-sales.ts` | S1 | no | no | **owner** | fiscal pair, code |
| **S3** | Fiscal-verifactu stops reading a location: "same venue" node checks deleted, certificate dates and query month from the venue zone, recovery document's venue name, dormant-standby state and join bundle lose `locationId` | fiscal-verifactu groups 2–4 of fiscal-check.md (17 source files) and its test helpers; `packages/fiscal/src/contribution.ts`; `apps/server/src/mirror-bundle.ts` | S1 | no | yes, a box holding a dormant-standby state file | **owner** | fiscal pair, code |
| **S4** | Catalogue: the default and extra menus belong to the venue; routes move to `/management-api/venue/catalogues…`; `location.not_found` deleted | `packages/catalogue/src/operations.ts`, `provisioning.ts`, `errors.ts`, `menu-types.ts`; `apps/server/src/catalogue-api.ts`; dashboard callers and `codes.ts`; till menu switcher | S1 | no | no | lane | code |
| **S5** | Venue-service, service side: departments, zone policies, routing, kitchen screens, order service contexts | `packages/venue-service/src/operations.ts`, `kitchen-screens.ts`, `provisioning.ts`, routing files, its `dashboard/`; server callers | S1 | no | no | lane | code |
| **S6** | Venue-service, calendar side: seasons, special days, holidays (`city`/`province` from the venue), opening hours, starter language, business-day schedule | `packages/venue-service/src/holidays.ts`, `starter-language.ts`, season/special-day/timetable files; server callers | S1 | no | no | lane | code |
| **S7** | Staffing and bookings | `packages/staffing/src/rota.ts`, `paint.ts`, `staff-roles.ts`, `dashboard/client.ts`; `packages/bookings/src/bookings.ts`, `wall-clock.ts`, `table-removal.ts`, `floor.ts`; server callers | S1 | no | no | lane | code |
| **S8** | Printing and layouts: the agent's job claim stops filtering by location | `packages/printing/src/runtime.ts:109`, `packages/layouts/src/device-equipment.ts`; `apps/server/src/print-api.ts`, `page-printers.ts`, `receipt-print.ts`, `demo-printer.ts`, `invoice-delivery*.ts`, `invoice-document.ts`, `station-outputs-down.ts` | S1 | no | no | lane | code |
| **S9** | Server: orders, refunds, kitchen and stations | `apps/server/src/working-order.ts`, `order-drafts.ts`, `tender-refund-*.ts`, `kitchen.ts`, `station-*.ts`, `receipt-preview-api.ts`, `packages/adjustments`, `packages/recipes`, `packages/payments` leftovers | S1 | no | no | lane | code |
| **S10** | Server: devices, joins, admission, node reads; `GET /management-api/locations` and the `getLocations` live query deleted | `apps/server/src/device*.ts`, `join-requests.ts`, `promote.ts`, `personal-data-export-api.ts`, `workforce-api.ts:109`, `apps/dashboard/src/api/live-queries.ts`, `api/client.ts` (`LocationSummary`) | S1 | no | no | lane | code |
| **S11** | Workforce code: no location filter in attendance, roster, shifts, hours reads, end-of-day, art. 34.9 export; convenio read for the venue; server attendance routes lose `?locationId=` | `packages/workforce/src/*`, `packages/workforce-es/src/*`; `apps/server/src/attendance-*.ts`, `management-attendance-api.ts`, `till-clock-*.ts`, `workforce-api.ts:124,136,405` | A1268 PR 1 landed; S1 | no | no | lane | code |
| **S12** | Dashboard and till attendance and hours: Location column and picker deleted; the till's other-location refusal and message deleted if A1268 PR 2 did not; `activeLocationId` deleted | `apps/dashboard/src/screens/attendance-corrections-screen.ts`, `planned-actual-screen.ts`, `widgets/location-picker.ts` (deleted), `my-hours-panel.ts`, `hours-record.ts`, `attendance-export-dialog.ts`, `api/attendance*.ts`, `api/hours.ts`; `apps/till/src/till-app.ts`, `api/client.ts`, `screens/till-hours-screen.ts`, `widgets/attendance-day-dialog.ts`, `state/*` | S11 | no | no | lane | code; check free memory first for browser tests |
| **S13** | Setup request and provisioning: `LocationDraft` folds into the venue draft; tax territory and fiscal-module choice read the venue field at setup and restore | `apps/setup/src/api/client.ts`, `setup-app.ts`, `screens/venue-screen.ts`, `review-screen.ts`, restore screens; `apps/server/src/setup-api.ts`, `recovery-backup-preview.ts`, `recovery-fiscal-selection.ts`, `first-fiscal-activation.ts`, `module-operation-host.ts`, `boot.ts` territory reads; `packages/provisioning/src/venue-plan.ts`, `venue-apply.ts`, `cli.ts`, `recover-provisioned-venue.ts`; `packages/fiscal-verifactu/src/setup/first-hour.ts`, `venue-fields.ts`; `scripts/setup-wizard-fiscal-fields.test.ts` | S1 | no | no | **owner** | fiscal pair, code, `apps/server/src/first-fiscal-setup.e2e.test.ts` |
| **S14** | Configuration bundle: `venue.location` → venue fields; `locationColumns` deleted; CLAUDE.md lines 401 and 547 | `packages/module/src/module.ts:1592`, `packages/provisioning/src/configuration-transfer.ts`, the five declaring `configuration-transfer.ts` files, `scripts/id-columns-are-references.test.ts`, CLAUDE.md, `docs/developers/conventions-data.md` | S13 | no | no | lane | code, `id-columns-are-references`, `claude-md-pointers`, `apps/setup/src/setup-app-first-fiscal.test.ts` |
| **S15** | Contract and type cleanup: `cfg.locationId` out of the module contract, `ProvisionedNode`, backup verification, `NodeConfig`, `readNodeLocation`, `LocationId`, `ReceiptText.locationId`, `readLocationClock` | `packages/module/src/module.ts`, `backup-verification.ts`, `packages/shared/src/ids.ts:11`, `receipt-text.ts:126`, `apps/server/src/node-config.ts`, `boot.ts:1587,2916` | S2–S14 | no | no | lane | code, fiscal pair |
| **S16** | Text and docs sweep (§5); done when the inventory's domain grep finds only `venueLocationId` calls and schema | translation files, guides EN+ES, `docs/developers/*`, backlog, demo seeds, country packs | docs-only part now; the rest after S15 | no | no | lane | text |
| **S17** | Schema: bookings, staffing, workforce-es (`convenio_config` one row) | three packages' `schema/`, `drizzle/`, classification | S7, S11, S15 | yes | **every venue** | lane | schema |
| **S18** | Schema: venue-service's 8 tables; one-default keys on the flag column | `packages/venue-service/src/schema/*`, `drizzle/` | S5, S6, S15 | yes | **every venue** | lane | schema |
| **S19** | Schema: workforce tables, including append-only `time_entries` and `pay_period_closures`; the two hash functions per the owner's answers; closures one chain per node | `packages/workforce/src/schema/*`, `chain-hash.ts`, `pay-period-chain.ts`, `pay-period-close.ts`, `drizzle/`; backup verification grouping | owner answers Q1 and Q2; S11, S15 | yes | **every venue** | lane, after the owner's answers | schema |
| **S20** | Schema: core settings move — create `venue_settings`, `venue_catalogues`, `business_day_settings`, `day_cutover_changes`; `readVenue`/`readVenueClock` and every writer switch; the four line-language triggers rewritten; `locations` cut to its id | `packages/db/src/schema/*`, `drizzle/`, `venue.ts`, `classification.ts`; writers in `venue-apply.ts`, `venue-settings-api.ts`, `business-day-start.ts`, zone repair, `configuration-transfer.ts`; live-query table lists | S15 | yes | **every venue** | **owner** | schema, behavioural triggers |
| **S21** | Schema: core floor, kitchen and printing tables lose `location_id` | `dining_tables`, `floor_plan_sets`, `floor_zones`, `kitchen_stations`, `kitchen_courses`, `print_agents`, `printers`, `print_jobs`, `page_printers` schemas, `drizzle/` | S20 | yes | **every venue** | lane | schema |
| **S22** | Schema: `nodes`, `devices`, `working_orders`, `tender_refunds`, `join_requests` lose `location_id`; the two guard triggers rewritten; `locations` and the three old side tables dropped; `venueLocationId` deleted | `packages/db/src/schema/*`, `drizzle/`, `venue.ts`, and every remaining `venueLocationId` caller | S17–S21 | yes | **every venue** | **owner** | schema |

**Parallel work.** After S1: S2, S3, S4, S5, S6, S7, S8, S9, S10 and S13 can run in different lanes at
the same time; their only shared files are callers in `apps/server` (the plan names each slice's
files exactly so lanes rebase around one another). S11 starts when A1268 PR 1 lands, S12 after S11,
S14 after S13. S15 waits for all of S2–S14. S16's docs-only part (backlog, `docs/developers`) can
start now. S17, S18 and S19 can be built in parallel; S20–S22 one after another.

**The reset window.** S17–S22 land back to back in one window the watcher announces, each PR's first
line saying "Every venue is reset: …". The laptop dev-stack slots (`wa-wt reset`), the Santet venue
(its own `local/square/reset.sh`) and the owner's home box are reset once after the window — or once
after A760 if it follows directly (§4).

**Fiscal slices (owner lands):** S2, S3, S13, S20, S22. S2 and S20 move where hashed and AEAT-bound
values come from (§2.4, §3); S3 edits the installation-name allocation and certificate code; S13
rewrites how the filing module is chosen at setup and restore; S22 rebuilds `nodes`, `devices` and
`working_orders`, which sales and filed records point at. None changes a fiscal byte, and each runs
the fiscal pair unedited. Every other slice the lane lands; S19 lands only after the owner has
answered both questions.

### How A1301 meets A1268

A1268 PR 1 (one working-time chain per node) is built on `feat/a1268-clock-ins-per-venue` and not yet
merged. A1301's workforce slices start after it lands. A1268 PR 2 (one clock state per person across
locations, sessions counted at their clock-in's location, `recordAtLocation`) is work A1301 would
then delete: with one place, removing the location filters already makes clock state and sessions
per person. **Recommendation to the watcher: do not build A1268 PR 2; S11 and S12 replace it**, taking
D3's till change (the refusal and its message). If PR 2 has already landed when S11 starts, S11
deletes `recordAtLocation` and its per-location view tests. A1268 PR 3 (pairing by write order after
a backward clock step) does not depend on locations and is unaffected.

The A1268 pieces A1301 removes, and where:

| A1268 piece | Kept by | Removed in |
| --- | --- | --- |
| `TimeEntryAppend.locationId` and `time_entries.location_id` | D1, PR 1 | S11 stops passing it (helper fills it); S19 drops it |
| `LocationId` in the entry hash | D1 | S19, per question 1 |
| `time_entries_response_subject_fk`, `time_entries_subject_identity_uq`, `sameSubject`'s location half | D5 | S19 |
| Pay-period closures per (node, location), `pay_period_closures_period_uq` | D6 | S19, per question 2 |
| Backup verification grouping closures by (node, location) | PR 1 | S19 (by node) |
| Device admission by location (`admit`) | D3 | S10 |
| "A session belongs to its clock-in's location"; the per-location export, end-of-day pass and hours screen | D4, D7 | S11 |
| "The box location's business day" | D7 | S11 (the venue's business day) |
| The export's note that a location's chain positions can skip numbers (PR 1 Task 3c) | PR 1 | S11 rewords it: positions skip only across nodes |
| The export's "Workplace reference" column (the location's internal id) | — | S11 deletes it; "Workplace / Centro de trabajo" shows the venue's name |
| `activeLocationId` in the till's clock state (A1268 plan open question 2) | PR 2 default | S12 |

## 7. Risks, and what the plan review should check

1. **A quiet cascade during a schema slice.** A rebuilt `working_orders`, `departments` or
   `kitchen_stations` deletes its cascading children with no error (§4). The review checks that each
   schema slice's plan lists the rebuilt tables and their children, that its upgrade rehearsal seeds
   one cascading child row and records what happens to it, and that the PR's first line declares a
   reset regardless.
2. **The hashed record time after #2369** (§2.4). The review checks that S2 and S20 prove the issue
   zone reads the same value before and after (a test across a daylight-saving change, with a control
   that fails when the zone source is wrong), and that the golden hash case is unedited.
3. **The interim helper outliving its purpose.** `venueLocationId` must have no caller after S22; the
   review checks that S22's plan ends with a grep for it returning nothing.
4. **Test fallout sizing.** About 300 test files may mention a second place (§6, upper bound). The
   review checks that the plan measured each code slice's real share and split anything past about
   100 implementer steps.
5. **Deleted, not rewritten.** A cross-location refusal test is deleted with its check. The review
   checks that no other assertion is weakened along the way (each changed assertion names the
   decision here that changes it).
6. **Lanes in flight.** A696 (#2369) must land first; #2372 (A803 slice 4) and #2373 (W41s-7) touch
   order and invoice code S9 and S2 also touch. The review checks the plan's file lists against open
   PRs at the plan's head.
7. **`fire_control` and A773-2.** Whichever lands second drops its removal step.
8. **The art. 34.9 export loses a column** ("Workplace reference"). It is not hashed and not AEAT,
   but it is a legal document; the review checks the export's tests and guide text say what remains.
9. **Spanish wording found by eye.** Spanish says "local" for both the premises and "local network",
   and `git grep -i -E` missed "ubicación" (§5). The review checks S16 searched with
   `/usr/bin/grep` from the English keys.

## 8. Provenance

Claims from the research seats not re-checked here are marked "per inventory.md §N" or "per
fiscal-check.md …". Re-checked for this design, by running or reading at `790214ba8c` unless stated:

1. `tenants` has exactly three permitted writers — read `scripts/write-path-tables.json:13-17`.
2. `locations.bump_mode` has no reader — `git grep -n -E 'locations\.bumpMode|l\.bump_mode|locations\.bump_mode' -- apps packages ':!**/drizzle/**'` printed nothing.
3. `fire_control` is read only by the configuration bundle — `git grep -n -w -E 'fireControl|fire_control' -- 'apps/*/src/**' 'packages/*/src/**' ':!*.test.ts'` printed only `tenants.ts` and `configuration-transfer.ts` lines and one till test fixture; A773-2's plan read at `docs/backlog/kitchen.md:296`.
4. The four `invoice_locales` triggers — `/usr/bin/grep -n -E 'CREATE TRIGGER|invoice_locales|JOIN locations'` on `0110_printing_retirement_restore_readers.sql`: triggers at lines 1, 29, 58, 91, each joining `locations`.
5. The two working-time hashes name the location — read `chain-hash.ts:63-81` (`LocationId` at `:67`) and `pay-period-chain.ts:119-130` (`row.locationId` at `:123`).
6. The invoice hash ignores description and issuer name — re-ran `/tmp/a1301-probe/huella-probe.mjs`: `SAME` for the change, `DIFFERENT` for the control.
7. A rebuild fails once a child row exists; a plain column drop does not — re-ran `/tmp/a1301-probe/rebuild-probe.mjs` (SQLite 3.54.0).
8. Child foreign keys of every table to be rebuilt, and no expression index on them — new script `/tmp/a1301-design/snap.mjs` over each set's latest snapshot (reads snapshot JSON, not SQL).
9. A696 reads the zone from `locations` and sets the record offset from it — read `git show 8ec592f10f:packages/fiscal/src/issue-clock.ts` and `git grep -n prepareIssueClock 8ec592f10f`; traced by reading, not run.
10. A760 is a pure squash — read `docs/operations/a760-migration-squash.md` lines 1-40.
11. The default menu and the extra menus are independent by design — read `packages/catalogue/src/operations.ts:1310-1378`.
12. The proposed table and function names are free — `git grep` for `table("venue…"`, `table("business_day…"`, `table("day_cutover…"` and `readVenue`/`readVenueClock` printed nothing.
