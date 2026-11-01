# A1301 — Remove the location concept: one venue, one box, one premises

Status: design, 2026-11-01, lane A, revised after fresh-context review 1 (folds in Appendix A).
Owner decision it builds (2026-11-01 ~14:45): "Remove the location concept from the codebase
entirely", and (~14:55) "Give this high priority so we don't build anything more on this concept."
Inputs: the inventory and the fiscal check written for this item by two read-only research seats
(`~/waitron-campaign/a1301/inventory.md`, `~/waitron-campaign/a1301/fiscal-check.md`, both at
`790214ba8c`), the review (`~/waitron-campaign/a1301/review-1.md`), and lane B's in-flight A1268
[design](2026-11-01-a1268-clock-ins-per-venue-design.md) and
[plan](../plans/2026-11-01-a1268-clock-ins-per-venue.md). There is no A1301 entry in
`docs/backlog.md` yet; the plan adds it (a docs-only change).

**Amendment 2026-11-01**, after the owner's answers relayed at ~15:30:

- Questions 1 and 2 are answered as recommended: a working-time entry's hash names no place, and a
  pay period is closed once for the venue, one closure chain per node. Lane B's A1268 builds both,
  and carries no location on entries, sessions, corrections or closures (§7).
- Question 3 is withdrawn: A1268 now removes the location from clock-ins itself (§7).
- Question 4 was answered later, at ~15:55: (a), the working-time export names the workplace by
  the venue's name alone, with no reference column and no official workplace code (§7). S14 now
  waits only for A1268 to land.
- S13, S14, S15 and S22 shrink to what A1268 leaves, and wait for A1268 to land rather than for owner
  answers. S22 no longer touches a hash or an append-only table (§6, "How A1301 meets A1268").
- The build plan for the code and fixture slices amends this design in places — files moved between
  slices, S4's refusal named `mirror.venue_not_copied`, S16's limited edit of
  `first-fiscal-setup.e2e.test.ts`, and more: see its "Amendments to the design this plan makes"
  ([plan](../plans/2026-11-01-a1301-remove-location.md)).

Words used below, once:

- A **location** is today's `locations` row, a place a box was imagined to serve one of several of.
  A **venue** is the premises; after this item it is the only place there is.
- A **migration set** is one package's own list of database migrations.
- A **rebuild** is how the database tool changes a table it cannot alter in place: it creates a copy,
  moves the rows, deletes the old table and renames the copy.
- **Append-only** tables refuse any change to a row once written.
- A **reset** wipes a box's venue database and sets it up again; before go-live that is allowed in
  place of migrating data (CLAUDE.md §3, "No backwards-compatibility or data-migration code until
  Waitron is in production").
- The **invoicing system (SIF)** is the box's registered identity as the system that issues and files
  invoices. The **huella** is the invoice record's hash, chained from one record to the next.
- A **standby** is a second box kept ready to take over; **adoption** is the step that makes a box a
  standby of a running venue; its **dormant-standby state** is the reserved fiscal identity it would
  use if promoted.
- The **art. 34.9 export** is the working-time record Spanish labour law (Workers' Statute article
  34.9) requires an employer to keep and hand over. A **convenio** is a collective agreement.
- A **lane** is one of the unattended campaign runners; the **watcher** is the session that assigns
  their work.
- The **fiscal pair** is the two fiscal test suites that must pass with their assertions unedited:
  the append-only check (`inmutabilidad`) and the **golden hash case** in
  `packages/fiscal-verifactu/src/write-path.e2e.test.ts`, which pins a known record's huella.

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
setup app, the dashboard and the guides, in English and Spanish; the dashboard's location picker on
planned-versus-actual disappears; the attendance screens lose a "Location" column whose value was
always the same. One path that does not work today stays not working, on purpose: adopting a standby
(§3, S4).

**For fiscal records.** No AEAT message, huella, invoice chain, invoice numbering or invoicing-system
identity changes, provided S4 keeps standby adoption refused (§3). Two hashes outside AEAT — the
working-time entry hash and the pay-period closure hash — name the location today. The owner chose
that both drop it, and A1268 makes that change, not A1301 (§7, questions 1 and 2).

**For every box.** Every box is reset once, in a window (§6). On any box that holds a record pointing
at its node, the migrations cannot run at all (§4), so the reset is forced, not a precaution.

## 2. Where the venue's settings live

### Decision: a new one-row `venue_settings` table in the core migration set

Three homes were weighed.

1. **The `tenants` row — rejected.** `tenants` is the taxpayer: "One taxpayer per database. Fiscal
   identity is country + tax_id" (`packages/db/src/schema/tenants.ts:34-37`). Request code already
   writes it, through the three files `scripts/write-path-tables.json:13-17` allows
   (`apps/server/src/location-settings-api.ts:12` imports `renameTaxpayer` and `savePrivacyContact`
   from two of them), so a request write to `tenants` would not by itself break a rule. The reasons
   that remain:
   - it keeps the taxpayer row narrow: the venue's dozen settings would sit beside the fiscal
     identity;
   - the venue settings have more writers (the venue details page, the business-day start editor,
     A696's zone repair, the configuration bundle), and each would join the short list of files
     allowed to touch the taxpayer row, or route through one of them;
   - the four core triggers that check receipt languages (§2.3) and every clock reader would read the
     taxpayer row.

   These are reasons of separation, not of necessity. They are enough to choose a table of its own,
   and the choice costs one table.
2. **Split by owning module** (the inventory's §7 suggestion: default menu to `catalogue_settings`,
   business day to reporting) — **rejected for the core fields.** The receipt languages are read by
   four core-set triggers on `working_order_lines` (§2.3), the time zone and business-day start by
   reporting, core, workforce, bookings and venue-service (`readLocationClock`, 101 call lines in 40
   files, per inventory.md §4), the tax territory by generic provisioning. Splitting them would put
   core-set triggers and readers on module-owned tables. The one field that does belong to a module
   already lives in one: the convenio settings stay in `workforce-es` (§2.2).
3. **A new one-row table — chosen.** One row, `id = 1` enforced by a check, as `catalogue_settings`
   (`packages/catalogue/src/schema/settings.ts:16`), `tenant_receipts`, `payment_policy` and other
   one-row tables do. It is keyed by nothing, which fits "There is no tenant column … a query that
   wants 'this tenant's rows' reads the table" (CLAUDE.md §3): no child table gains a `venue_id`. It
   is not in `scripts/write-path-tables.json`, so request code may write it, as it writes `locations`
   today.

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
| `address_line1`, `address_line2`, `postal_code`, `city`, `province` | `venue_settings`, same names | printed on receipts and invoices; `city`/`province` drive holidays and receipt language |
| `time_zone` (default `Europe/Madrid`) | `venue_settings.time_zone` | see §2.4 for A696 |
| `day_cutover` (default `06:00:00`) | `venue_settings.day_cutover` | |
| `bump_mode` | **deleted, unused** | "Read by nothing: each station has its own `bump_mode`" (`tenants.ts:20-24`); re-checked: `git grep -n -E 'locations\.bumpMode\|l\.bump_mode\|locations\.bump_mode' -- apps packages ':!**/drizzle/**'` prints nothing (the `bumpMode` readers in `apps/server/src/kitchen.ts:146` read `kitchenStations`). The `bumpMode` builder in `tenants.ts:25` goes with the column; `kitchen_stations` types its own `bump_mode` with `BumpMode` from `@waitron/shared` |
| `fire_control` | **deleted, unused** | only the configuration bundle reads or writes it (`packages/provisioning/src/configuration-transfer.ts:104,174,536`; re-checked with `git grep -n -w -E 'fireControl\|fire_control' -- 'apps/*/src/**' 'packages/*/src/**' ':!*.test.ts'`), and its removal is already planned under A773-2 (`docs/backlog/kitchen.md:296`). Whichever lands first does it; the other drops the step. When firing is built it adds its own setting |
| `catalogue_id` (the default menu) | `venue_settings.default_catalogue_id` → `catalogues.id` | `catalogues` is a core table (`packages/db/src/schema/catalogue.ts:28`), so this stays a core-to-core key, as today |
| `location_catalogues(location_id, catalogue_id)` | `venue_catalogues(catalogue_id)` primary key | the extra menus offered; kept separate from the default on purpose — "membership and the default stay independent" (`packages/catalogue/src/operations.ts:1310-1316`) |
| `location_business_day_settings(location_id, revision)` | `business_day_settings(id = 1, revision)` | kept a table of its own so the live subscriptions that depend on it keep the same table dependencies and do not wake on every venue-details save |
| `location_day_cutover_changes(location_id, effective_business_day, day_cutover)` | `day_cutover_changes(effective_business_day` primary key`, day_cutover)` | same checks |

`nodes.location_id` and every other `location_id` column are deleted with nothing in their place
(§4). The `locations` table itself keeps its columns from S23 until S28 drops the whole table: it is read
only for its id, by `venueLocationId`, and still written at setup; cutting it to its id in S23 would mean an extra rebuild of a table 37 others point at (§4).

### 2.2 Settings held per location in other tables

`convenio_config` (`packages/workforce-es/src/schema/convenio-config.ts:45`, one convenio rule set
per location, `convenio_config_location_uq`) becomes a one-row table in its own set with the same
`id = 1` check. `staff_roles`, `departments`, `seasons` and the rest simply lose the column and the
location part of their unique keys (§4).

### 2.3 The four triggers that read `invoice_locales`

`working_order_lines_check_locales_insert/_update` and
`working_order_lines_check_variant_locales_insert/_update`
(`packages/db/drizzle/0110_printing_retirement_restore_readers.sql:1,29,58,91`, re-read) each join
`locations l ON l.id = wo.location_id` and `json_each(l.invoice_locales)`. S23 drops them and creates
them again reading only `(SELECT invoice_locales FROM venue_settings WHERE id = 1)`, with no join
through the order. Two consequences:

- After S23 these four no longer read `working_orders` or `locations`, so they are not in the way of
  the `working_orders` rebuild (S27) or the `locations` drop (S28).
- A line whose order does not exist is no longer refused by these four. The plan adds a case to
  `scripts/behavioural-triggers.test.ts` that inserts a line naming an order that does not exist and
  expects the open-parent refusal (`working_order_lines_require_open_parent_insert`); that file's
  connection runs with foreign keys off, so the foreign key is not what refuses it. The existing
  `line-orphaned` case covers only the delete path.

What the behaviour cases in `scripts/behavioural-triggers.test.ts:288-405` become:

- `wo-orphan` (an order naming a location that does not exist, refused at `:1343`) is replaced by a
  case with no `venue_settings` row: a line is refused. That defines what an order on a box with no
  venue settings does.
- `loc-es-only` ("the locale triggers must read the order's location, not its device's", `:361`) is
  a cross-location case and is deleted.
- `loc-relocale` (`:366-370`) exists so the venue's languages can change without moving what other
  cases read. Its purpose — a served line survives a change of the venue's languages — stays; the case
  changes the one `venue_settings` row, in a database of its own or as the file's last case (the plan
  picks which).

### 2.4 A696 (open PR #2369) adds location-keyed time-zone code

A696 is open and mergeable at `7e824ae233` (`gh pr view 2369 --json headRefOid,state`, 2026-11-01).
The design's first draft cited `8ec592f10f`, which is not an ancestor of that head
(`git merge-base --is-ancestor 8ec592f10f 7e824ae233` exits 1); every line below is at `7e824ae233`.

`readIssueZone` (`packages/fiscal/src/issue-clock.ts:7-23`) reads the saved zone from `locations`
through `nodes.location_id`, refusing `venue.time_zone_target_invalid` with reason `node`, `mismatch`
(a `scope.locationId` that differs from the node's) or `location`. `prepareIssueClock` (`:25-38`)
freezes `offsetMinutes` from that zone. In `packages/fiscal-verifactu/src/backend.ts` the offset is
`FechaHoraHusoGenRegistro`'s and is also used to rebuild an annulment's
`FechaExpedicionFacturaAnulada`, whose rendered day it leaves unchanged; the
record time is in the huella (fiscal-check.md "The hash, checked by running it"). Traced by reading,
not run. **This changes one fiscal-check finding once #2369 lands:** fiscal-check.md (at `790214ba8c`)
found the record offset taken from the host's clock, "never `locations.time_zone`". After #2369,
moving the zone from `locations` to `venue_settings` moves the source of a hashed input. The value is
the same, so no hash changes, but the slices that move it (S2, S23) are fiscal and the owner lands
them.

Every non-test caller at `7e824ae233`
(`git grep -n -E 'prepareIssueClock|readIssueZone' 7e824ae233 -- ':!*.test.ts' ':!*.md'`), and the
slice that changes it:

| Caller | Slice |
| --- | --- |
| `apps/server/src/till-sale.ts:987,1194,1628,1780` | S2 |
| `apps/server/src/bill-payments.ts:702,1121` | S2 |
| `apps/server/src/cancel-credit.ts:54` | S2 |
| `apps/server/src/working-order.ts:7038` | S2 (only this call; the rest of the file is S11) |
| `apps/server/src/trading-admission.ts:32` (`readIssueZone`) | S2 |
| `packages/fiscal-verifactu/src/void-issue-clock.ts:24` (annulments; its own `mismatch` at `:23` compares a sale's node with its record's node, not a location, and stays) | S2 |
| `packages/provisioning/src/fiscal-readiness-runner.ts:111` | S2 |
| `packages/provisioning/src/recover-provisioned-venue.ts:45` (passes `locationId`) | S2 |
| `apps/server/scripts/daily-close-demo.ts:176,205,249` | S2 |
| `apps/server/scripts/daily-close-z-demo.ts:190` | S2 |
| `apps/server/scripts/modelo-303-demo.ts:503,544` | S2 |
| `apps/server/scripts/demo-seed/seed.ts:78` (`readIssueZone(tx, venue)`; `venue` carries `locationId`) | S2 |
| `apps/server/scripts/record-one-sale.ts:145`, `demo-seed/seed-sales.ts:249` | S2 |

A696 also adds location-keyed code outside the fiscal path: `apps/server/src/venue-zone-context.ts`
(its own copy of the three refusals, `:41-50`), `venue-zone-repair.ts`, `venue-zone-repair-api.ts`,
`zone-repair-serving.ts`, `venue-details.ts`, `boot.ts` and the provisioning files `venue-apply.ts`,
`venue-plan.ts`, `configuration-transfer.ts` (S1, S16 and S17 below), plus text (§5). After S2 and S1 no
code throws reason `location` or `mismatch` from a location check; S18 removes `location` from the
error's reason type in `packages/shared/src/errors.ts:30` and keeps `node` and `mismatch`.

**A696 lands before S1**, and A1301 rebases over it, so its new readers are converted with the rest.

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
  location" → "at this venue"; A696's zone-repair hint "Check this against the venue's location" /
  "Compruébala con la ubicación del local" says "against the venue's address" / "con la dirección del
  local".
- **Till.** "Your open shift belongs to another location" goes: with no location on clock entries,
  A1268 leaves the refusal nothing to compare, and S15 deletes whatever of it A1268 leaves;
  attendance-day and hours screens stop showing or sending a location.
- **Guides.** §5.

## 3. Fiscal check

Per fiscal-check.md, with the claims re-checked marked.

- **Huella.** `computeHuella` joins issuer NIF, series-and-number, issue date, invoice type, tax
  total, total, previous hash and record time; no location field. Re-checked by re-running
  `/tmp/a1301-probe/huella-probe.mjs` against `packages/fiscal-verifactu/node_modules/@waitron/verifactu`:
  changing the operation description and the issuer name printed `SAME`; the control (changing the
  total) printed `DIFFERENT`.
- **Chain, numbering.** No location reference in `packages/db/src/allocate-number.ts` or
  fiscal-verifactu's `registro-sif`, `restore`, `chain`, `backend`, `registro-row`, `drain`,
  `reserved-series`, `allocation-identity`, `hour-identity`, or any `schema/` file; no
  fiscal-verifactu table or trigger names a location (fiscal-check.md "None of the files that build,
  chain, store or send a fiscal record mention the location"). Series are keyed by node
  (`invoice_series`).
- **Invoicing-system identity: one path changes unless S4 holds it.** Adopting a standby fails today
  at one step, and only because of `nodes.location_id`. `apps/server/src/finish-adoption.ts:32-43`
  records it: `establishReservedStandbyIdentity` (`apps/server/src/reserved-identity.ts`) inserts the
  standby's `nodes` row, whose NOT NULL `location_id` references `locations`, and an adopted mirror
  holds no `locations` row, because `adoptFromPrimary` refuses unless that table is empty
  (`assertNoOperationalVenue`, `packages/provisioning/src/tenant-guard.ts:38-40`, called at
  `apps/server/src/adopt.ts:131`). Once S25 drops that column, the insert would no longer be refused,
  and the same transaction goes on to each module's `provisioning.standby.establish` — the fiscal
  module's dormant-standby state. Not run: what adoption does with the column gone. **Decision: S4
  keeps adoption refused, on purpose**, before S25 removes the accidental refusal (S4, §6).
  Unblocking adoption belongs to the replacement copy mechanism already in the backlog
  (`docs/backlog.md` → *Replication, membership & failover*), not to A1301.
- **The live-venue guard.** `readOperationalVenueIds` counts `locations` rows and is read by
  `adopt.ts:131`, `boot.ts:949`, `boot.ts:1588` (with `assertSingleOperationalVenue`, comparing against
  the node's location), `reset-request.ts:62` and
  `packages/provisioning/src/first-setup-resolution-inspection.ts:90`. **What replaces the count: "an
  operational venue exists" means the `venue_settings` row exists.** `venue-apply.ts` writes it in the
  same transaction that writes the `locations` row today, and its `id = 1` check makes a second one
  impossible, so "exactly one" becomes "the row exists". S18 drops the id comparison at `boot.ts:1588`
  (the count stays on `locations` until then); S23, an owner slice because `adopt.ts` is on the
  adoption path, switches every reader to `venue_settings`. The refusal `provisioning.second_venue`
  keeps its name and meaning.
- **AEAT body.** One location field can reach it: `operation_description` → `DescripcionOperacion`,
  only as a fallback no production route takes (`apps/server/src/sale-operation-description.ts:7-50`
  always supplies one, per fiscal-check.md path 1). It moves to `venue_settings` with the same value.
  Not in the huella (the probe above).
- **Other dated values.** `sales.operation_date` (path 2), the certificate check's AEAT query month
  (path 3), the daily-close hash's business day and zone (path 7) and, after #2369, the record offset
  (§2.4) all read the time zone or business-day start; they keep the same values from the venue.
- **Not reached.** Modelo 303 dates each sale by its stored offset (`packages/reporting/src/vat-return.ts:25-35`).

**Plainly: provided S4 lands before S25, no AEAT message byte, huella, invoice chain, invoice series
or numbering, or invoicing-system identity changes.** The fiscal pair passes with its assertions
unedited in every slice; only the seed helpers that insert a `locations` row change (fiscal-check.md
"Tests in packages/fiscal-verifactu").

## 4. What the schema work must do

From inventory.md §1, re-checked where marked.

- **Tables carrying `location_id`: 39** (inventory.md §1b), plus `locations` itself. Two have no key
  to `locations`: `join_requests` (a node-local table, `packages/db/src/schema/join-requests.ts:45-51`)
  and `order_service_contexts`. By set: core 17 (`nodes`, `working_orders`, `dining_tables`,
  `floor_plan_sets`, `floor_zones`, `kitchen_stations`, `kitchen_courses`, `devices`, `join_requests`,
  `print_agents`, `printers`, `print_jobs`, `page_printers`, `tender_refunds`, and the three side
  tables); bookings 1; staffing 1; venue-service 8; workforce 11 (#2375 removes
  `workforce_chains`'s, and A1268's revision `time_entries`' and `pay_period_closures`'; §6, "How
  A1301 meets A1268"); workforce-es 1.
- **Unique keys that include `location_id`** lose that column: `dining_tables_location_label_key`,
  `…_short_name_key_uq`, `floor_zones_name_key`, `kitchen_stations_name_key`,
  `kitchen_stations_default_key` and `departments_one_default_per_location_key` (one default per
  venue), `kitchen_courses_name_key`, `devices_location_label_active_key`, `printers_local_key_key`,
  `page_printers_endpoint_uq`, `staff_roles_location_name_key`, `departments_location_name_key`,
  `zone_service_policies_one_counter_default_key`, the seven `routing_cells` partial unique indexes,
  `holiday_geographies_location_place_key`, `seasons_location_starts_key`/`…_name_key`,
  `special_day_dates_location_date_key`, the `attendance_*` scope keys, `roster_versions_published_period_uq`,
  `time_entries_subject_identity_uq`, `pay_period_closures_*_uq`, `convenio_config_location_uq`.
  The `time_entries` and `pay_period_closures` keys go in A1268 (§6, "How A1301 meets A1268").
  A key whose only column was `location_id` (the "one default" keys) becomes a partial unique index
  on the flag column — a real column, never a constant expression (next bullet).
- **Expression indexes.** None on these tables. Experiment: `/tmp/a1301-design/snap.mjs` read every
  set's latest snapshot and printed no index on a `location_id` table with a column containing a
  bracket or a space; the review's text check of the drizzle SQL agreed. A new "one default" index
  must be on a column, because drizzle-kit 0.31.11 writes an expression index back wrong in a rebuild
  (CLAUDE.md §3).
- **Dropping a column is a rebuild, and every column here is a rebuild.** On SQLite 3.54.0
  (`node:sqlite`), `ALTER TABLE nodes DROP COLUMN location_id` is refused when the foreign key is
  declared at the table level — `error in table nodes after drop column: unknown column "location_id"
  in foreign key definition` — which is how the real `nodes` declares it
  (`packages/db/drizzle/0000_baseline.sql:59`); it succeeds only with the key written inline (re-ran
  the review's `/tmp/a1301-rev/dropcol.mjs`; control: dropping an indexed column was refused too). The
  fiscal check's earlier probe wrote the key inline, so its "a plain drop succeeded" does not apply.
  And drizzle-kit 0.31.11 does not emit a plain drop anyway: removing `nodes.locationId` from a small
  schema generated `PRAGMA foreign_keys=OFF; CREATE TABLE __new_nodes …; INSERT INTO __new_nodes …;
  DROP TABLE nodes; ALTER TABLE __new_nodes RENAME TO nodes; PRAGMA foreign_keys=ON`
  (`/tmp/a1301-rev/dk/out/0001_v2.sql`, re-read). The `PRAGMA foreign_keys=OFF` has no effect inside
  the migration's transaction (CLAUDE.md §3, "A drizzle table rebuild on this engine runs with
  foreign keys ON").
- **Foreign keys pointing AT the tables that will be rebuilt** — the CLAUDE.md §3 hazard "its
  `DROP TABLE` silently deletes every cascading child's rows, and fails on a `no action` or
  `restrict` child holding rows". Measured from each set's latest snapshot (re-ran
  `/tmp/a1301-rev/fks.mjs nodes`; the other tables by `/tmp/a1301-design/snap.mjs`):
  - `nodes`: **22 keys, none cascading**, 13 of them from fiscal tables — core `sales` (restrict),
    `invoice_series`, `daily_closes`, `daily_close_chain`; fiscal-verifactu `registros_facturacion`,
    `registro_sif`, `cadenas`, `fiscal_allocations`, `fiscal_reservations` (on `node_id` and on
    `source_node_id`), `clock_checks`, `clock_confirmations`, `clock_stop_restarts` (no action). The
    other nine: `order_amendments`, `tender_refunds`, `pay_period_closures`, `time_entries`
    (restrict), `ticket_items`, `working_order_counters`, `working_orders`, `payments`,
    `workforce_chains` (no action).
  - `working_orders`: cascading children `working_order_lines`, `kitchen_print_jobs`,
    `bill_edit_states`, `order_service_contexts`, `kitchen_notices`, `order_kitchen_notes`;
    restricting children include `sales`, `bill_payments`, `payments`.
  - `devices`: cascading `device_approved_profiles`, `printer_holders`, `card_reader_holders`;
    restricting `sales`, `registros_facturacion`, `time_entries` and more.
  - `departments`, `seasons`, `special_day_dates`, `kitchen_stations`: cascading `shift_assignments`,
    `staffing_days`, `department_days`, `zone_days`; `routing_cells` → `routing_cell_periods`;
    `staff_roles` → `person_staff_roles`, `staffing_blocks`; `shifts` → `shift_assignments`,
    `shift_swaps`; `print_jobs` → `kitchen_print_job_lines`; `printers` → `printer_holders`.
  - `locations` itself: 37 children, none cascading. S28 drops it with a plain `DROP TABLE` once
    nothing points at it, not a rebuild.

  So S25's `DROP TABLE nodes` fails with `FOREIGN KEY constraint failed` on any box holding a row in
  any of those 22 tables — every box that has traded, filed or clocked anyone in; the rollback loses
  nothing, but the box cannot start the new version until it is reset. The plan's upgrade rehearsal
  records whether a box that is set up but has never traded also fails. Elsewhere a rebuild either
  fails the same way or quietly deletes cascading children (orders with lines but no sale yet).
  **Decision: every schema slice is a reset for every venue, said in the PR's first line**, forced
  where a migration refuses, declared anyway where it would cascade quietly.
- **Triggers in the way of a rebuild.** SQLite refuses the rename that ends a rebuild while another
  table's trigger reads the rebuilt table, with foreign keys on or off and **on an empty database**:
  `error in trigger other_check: no such table: main.nodes` (re-ran the review's
  `/tmp/a1301-rev/rename.mjs`). And a rebuild's `DROP TABLE` deletes the triggers that sit on the
  table itself. Scanning every set's drizzle SQL for live triggers (re-ran `/tmp/a1301-rev/trig.mjs`
  for readers and a sibling `/tmp/a1301-fold-trig-on.mjs` for triggers on each table):
  - **Read `working_orders` from another table:** `working_order_lines_require_open_parent_insert`
    and `_delete` (`packages/db/drizzle/0097_operator_script_restore_triggers.sql`),
    `working_order_lines_require_open_parent_update` (`0177_paid_line_service_group.sql:3-11`), and
    the four language checks (gone by S27, §2.3).
  - **Read `devices` from another table:** `device_profile_form_factor_locked`
    (`0161_restore_profile_form_factor_lock.sql:1-10`, the restore after an earlier `devices`
    rebuild).
  - **Read `locations`:** only the four language checks.
  - **On `working_orders` itself:** `working_orders_invoice_type_insert/_update` (`0104`),
    `working_orders_recipient_identity_insert/_update` and `working_orders_enforce_transition`
    (`0198_recipient_identifier_guards.sql`; the last names `location_id`).
  - **On `tender_refunds` itself:** `tender_refunds_guard_update` (names `location_id`) and
    `tender_refunds_no_delete` (`0163_tender_refund_transitions.sql`).
  - Every other table rebuilt here, `nodes` included, has none in the drizzle SQL.

  The scan reads migration text, so it does not see triggers code creates (the append-only triggers
  `appendOnly()` declares are made that way). **Each schema slice reruns the scan against
  `sqlite_master` of a database migrated with every manifest set through the app's own migrate path**,
  for each table it rebuilds, and lists the result in its plan. The migration then drops each reader
  trigger before the rebuild and creates it again after, and creates again every trigger that sat on
  the rebuilt table, rewritten without `location_id` where it named it — as `0105`/`0107` did for the
  language checks and `0161` for the form-factor lock, in hand-written migrations around the
  generated one.
- **The upgrade test's list of resets.** `scripts/migration-upgrade.test.ts:361-435` holds `RESETS`:
  every migration step that cannot carry the test's rows is listed with its exact refusal text
  (`refused:`, for example `["DROP TABLE \`locations\`", "FOREIGN KEY constraint failed"]`) or the
  tables whose rows it loses (`lost:`), and an unlisted step that fails or loses rows fails the guard.
  **Each schema slice adds its own `RESETS` entry, copied from the test's own output.** That entry is
  the written record of which venues need a reset.
- **Rehearsal.** Each schema slice reads the SQL drizzle-kit generates, lists the tables it rebuilds
  and their children from the list above, and rehearses on `node:sqlite` through
  `scripts/migration-upgrade.test.ts` and an empty-database migrate, never the `sqlite3` command line
  (CLAUDE.md §3: macOS's `sqlite3` 3.51.0 refuses the rename the app's 3.54.0 runs).
- **drizzle-kit 0.31.x rebuild plus added column** fails with `no such column` (CLAUDE.md §3): S23
  creates the four new tables and drops the three old side tables, and adds no column to a rebuilt
  table. Where a slice must do both, it uses two generations. If `drizzle-kit generate` stops to ask
  whether a new table is a renamed old one, the slice splits the create and the drop into separate
  generations; the build records which happened.
- **Append-only tables.** Only `time_entries` and `pay_period_closures` carry `location_id` (inventory.md
  §1b; both are `appendOnly` in `packages/workforce/src/classification.ts:12-13`). A1268's revision
  removes the column from both (§6, "How A1301 meets A1268"), so no A1301 slice rebuilds an
  append-only table. No fiscal table carries a location column (§3).
- **Configuration bundle.** `locationColumns` (`packages/module/src/module.ts:1592`, applied at
  `packages/provisioning/src/configuration-transfer.ts:737,755-756`) is deleted, with its declarations
  in the five `configuration-transfer.ts` files. The bundle's `venue.location` object becomes venue
  fields; `LocationDraft` (`apps/setup/src/api/client.ts:60-72`) folds into the venue draft. The
  default catalogue is not a setup field, so it travels outside `venue`'s own keys (CLAUDE.md §3,
  "A configuration bundle value that is not a setup field stays out of `venue`'s own keys"); the plan
  names the key. `venue_catalogues.catalogue_id` is a declared reference.
- **Host files.** Three kinds of file on the box name a location, and a box holding one when its slice
  lands is reset:
  - the dormant-standby state in `<state>/module-preparation-state.json` and the standby join bundle
    carry `locationId`, and `readDormant` demands exactly its six keys
    (`packages/fiscal-verifactu/src/hour-dormant-standby.ts:50-75`, per fiscal-check.md path 8) — S3;
  - `<state>/pending-adoption.json` (`PendingAdoption.locationId`, `finish-adoption.ts:46`) — S4;
  - `first-setup.json` and its sibling files require a `location` key
    (`packages/provisioning/src/first-setup-state.ts:240-279`), so a box in the middle of first setup
    is refused — S16.
- **Backups and exports from before the window.** A backup taken before the reset window holds rows
  the new migrations refuse, and a configuration export names `venue.location`, so neither is
  expected to restore or import after it. Pre-live that is allowed; each schema PR's first line says
  so next to "Every venue is reset".

### Fold the schema drop into A760? No.

A760, the planned squash of every migration set into one starting migration, is approved as a pure
squash: "generate each baseline from its unchanged TypeScript schema … retaining the exact fresh
schema" (`docs/operations/a760-migration-squash.md`, Goal and Architecture). Folding A1301's schema
change into it would change an owner-approved procedure, so **A1301's schema slices ship on their
own**. A760 starts only once "big work and migration branches drain" (`docs/backlog/architecture.md`,
A760), so the order is: A1301's reset window (S20–S28), then A760. A760 resets every venue anyway,
so the watcher keeps the boxes on its reset roster off between the two and resets them once, after
A760. The trade-off: A760 waits for A1301's schema slices. If the watcher has already started A760's
freeze when S20 is ready, S20–S28 wait for A760 to land and then ship as ordinary migrations on the
new baseline, with the same hazards.

## 5. Text and docs

Each slice updates the words its change makes stale (CLAUDE.md §6). S19 sweeps what is left and
proves it with a grep.

- **Guides** (English and Spanish twins, `apps/server/src/guide/`): `en/content-and-images.md:103,105`
  ("location's default", "location's receipt language") and `es/content-and-images.md:103,105` ("de la
  ubicación"); `en/backup-recovery.md:106` ("its source, business, location") and
  `es/backup-recovery.md:117-118` ("el local"); and A696's `en/time-zone.md` ("the venue's location")
  and `es/time-zone.md` ("la ubicación del local"). Search Spanish with plain words, not bracket
  classes or `.`: `git grep -i 'ubicación' -- apps/server/src/guide` finds both `content-and-images.md`
  lines, but `git grep -i -E 'ubicaci[oó]n'` and `git grep -E 'ubicaci.n'` find none, because neither
  matches the two-byte `ó`.
- **Translation keys** (inventory.md §5): `attendance.location`, `attendance.time_skipped`,
  `receipts.venue_wide`, `receipts.no_address`, `receipts.trading_name_location`, `location_settings.*`,
  `planned.location`, `planned.no_location`, `clock.other_location` (A1268), `venue.section.location`,
  `venue.label.location_name`, `venue.hint.name`, `venue.field.name`, `review.location`,
  `review.group.location`, `review.help.location`, `restore.preview_location`,
  `restore_bucket.venue_details`, the attendance email's `locationName`, the printer string, the
  dashboard error wording for `location.not_found`, A696's zone-repair hint strings
  (`apps/dashboard/src/i18n/strings.ts`), and the personal-data readme's "their times, location and
  the state of the rota" (`apps/server/src/i18n/personal-data-readme.ts:71`).
- **Error codes.** `location.not_found` (`packages/catalogue/src/errors.ts:94`) is deleted; codes whose
  details carry `locationId` (`station.no_default`, `convenio.not_found`, `roster.draft_exists`) drop
  it (#2375 already drops it from `attendance.append_contention`, `packages/workforce/src/errors.ts`); `restore.stream_venue_unconfirmed`'s
  `locationName` becomes `venueName`, and `scripts/personal-log-params.test.ts:125` follows;
  `venue.time_zone_target_invalid` loses reason `location` (§2.4); `provisioning.second_venue` stays
  (§3); S4 adds one refusal.
- **CLAUDE.md**: the dashboard-banner rule ("the tenant's legal name (not a location)") loses the
  comparison; the configuration-bundle rule ("the setup app copies `venue.location` by
  `LocationDraft`'s fields") and the transferred-table id rule (`locationColumns`) are rewritten by S17
  with `docs/developers/conventions-data.md`.
- **docs/developers**: conventions-data.md (31 matching lines), products.md, design-system.md,
  testing-guide.md, conventions-ui.md and the one- and two-line files in inventory.md §5.
- **Backlog**: the 16 lines that assume several locations (inventory.md §5's list; count re-run with
  the same grep). Entries that exist only for several locations are deleted — for example "the
  working-time record of a box with more than one location" (`docs/backlog/data-protection.md:126`),
  the cross-location scoping of by-id actions, and "Station deletion's draft-location filter needs a
  discriminating test" (`docs/backlog/architecture.md`). Lines that mention a location in passing are
  reworded. A1268's backlog entry and spec get a dated pointer. **Timing:** an entry is deleted or
  reworded in the slice whose code change makes it stale, not before; S19's early part touches only
  entries that describe plans, never ones that describe the code's current behaviour.
- **Demo seeds and scripts**: `apps/server/scripts/demo-seed/*`, `dev-setup.ts`, `allergens-demo.ts`,
  `daily-close-demo.ts`, `daily-close-z-demo.ts`, `modelo-303-demo.ts`, `record-one-sale.ts`. Country
  packs' `demo.locationName` (`packages/country/src/country.ts:26,124`, `packages/country/src/demo.ts:200`,
  `packages/country-es/src/spain.ts:274-341`, `packages/country-es/src/demo-testing.ts`,
`packages/country-es/src/demo/developer-presets.ts`) becomes
  `demo.venueName`.
- **Starter content**: no match (inventory.md §5).
- `scripts/no-till-as-issuer.mjs`'s ban on `WAITRON_LOCATION_ID` stays: it still bans a variable no one
  should add.

## 6. Slices

**How the code slices stay green without the schema.** S1 adds one interim helper,
`venueLocationId(tx)`, that returns the id of the database's single `locations` row and refuses
otherwise. Code that must still fill a `location_id` column until its schema slice calls it instead of
receiving an id; S28 deletes it with the last column. This keeps every code slice free of migrations
and resets. No A1301 slice changes a working-time hash: A1268 does (§7, questions 1 and 2).

**Which file belongs to which slice.** The slice tables name files, but a sweep found 280 source files
naming the word that the first draft's lists never mentioned. So the rule is by area: every non-test
file under `apps/`, `packages/` and `scripts/` that matches
`git grep -l -E '(^|[^A-Za-z])[Ll]ocations?([^A-Za-z]|$)|[Ll]ocation(Id|_id|Name|[A-Z_])|[a-z]Location' -- 'apps/**' 'packages/**' 'scripts/**' ':!*.test.ts' ':!*.test.mjs' ':!**/drizzle/**' ':!*.md'`
belongs to the slice whose area (the "Area and named files" column) contains it; files the table
names explicitly override the rule. Outside `src`, the fiscal demo scripts go to S2 (§2.4's table),
the `test/` fixture folders (`apps/server/test`, `apps/dashboard/test` and their package
equivalents) to the F slices, and every other file to the slice whose area holds it, else S18. The
plan runs that grep at its own head, assigns every file, and fails its own review if any is
unassigned. Limited to `apps/*/src` and `packages/*/src` it matched 560 files at `e32b9f3866`
(browser `location.reload()` and unrelated words such as `ServerKeyLocation` included); a narrower
`locationId|location_id|LocationId` grep found about 45 more non-test files outside those folders
(round3.md I3), so the wider paths are needed. Each slice's done-check is that grep over its area printing nothing but `venueLocationId`
calls, schema files and unrelated words the plan lists; S18's is the grep over everything.

**What makes a slice owner-landed.** The owner lands a slice that (a) changes code on the path that
builds, numbers, chains, stores, sends or prints an invoice record, (b) moves where a value hashed into
an invoice record or sent to AEAT is read from, (c) touches a path that writes an invoicing-system
identity, or (d) rebuilds a table invoice records point at by foreign key. The lane lands the rest.
By that rule the daily-close hash's clock (S1) is a lane slice: it is a hash of its own, not an
invoice record, and A1301 does not change its value. S10 (the print agent's job claim) and S24 (which rebuilds
`print_jobs`, `page_printers` and `print_agents`, which `invoice_deliveries` points at) are lane
slices too: an invoice delivery is not an invoice record, and neither slice changes an invoice byte.

**Each code slice** also deletes the tests that exist only to prove a cross-location refusal
(fiscal-check.md gives `allocation-operation.test.ts:680` and `cloud-preparation.test.ts:487` as
examples) and moves its callers of `readLocationClock(tx, id)` to `readVenueClock(tx)`.

**The test fixtures.** Tests insert the rows the schema slices drop: 419 test files run
`insert(locations)` (239 in `apps/server`, 69 `packages/venue-service`, 62 `packages/db`), 197 insert
`nodes`, `devices` or `working_orders`, 18 more write `insert into locations` in raw SQL, and 888 name
`locationId` (491 in `apps/server`). Left alone, S25–S28 would each edit hundreds of files. So five
fixture slices (F1–F5) run before the window: F1 makes the helpers in `packages/db/src/testing/seed.ts`
(`seedTenant`, `seedNode`, `seedDevice` exist today) the one place a test gets its venue, node, device
and order rows — a `seedVenue` that writes the single venue row, and node, device and order helpers
that fill `location_id` themselves — and F1–F5 move each package's tests onto them, by a codemod
script the slice writes and runs, then by hand for what it leaves. After that a schema slice changes
the helpers' bodies, not the tests. The module tables' own fixtures (staff roles, departments and the
rest) stay with their schema slice, which measures them first with
`git grep -l -w -E 'locationId|location_id' -- '<pkg>/**/*.test.ts'` and splits by package if the
count is past one implementer's budget.

**Size.** Every slice is planned as tasks one implementer finishes in well under 100 tool calls; the
plan measures each slice's files with the grep above and splits any slice that will not fit, before
dispatch.

Guard groups named below:
- **Fiscal pair** (see "Words used below").
- **Code guards**: `scripts/module-seams.test.ts`, `scripts/live-subscriptions.test.ts`,
  `scripts/errors-reachable.test.ts`, `scripts/personal-log-params.test.ts`, `scripts/english-only.test.ts`,
  plus the touched packages' focused tests (CI runs the package suites).
- **Schema guards**: `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`,
  `scripts/behavioural-triggers.test.ts`, `scripts/classification-complete.test.ts`,
  `scripts/two-file-foreign-keys.test.ts`, `scripts/migrations-match-schema.test.ts`,
  `scripts/migration-upgrade.test.ts` (with the slice's `RESETS` entry), `scripts/journal-monotonic.test.ts`,
  `scripts/id-columns-are-references.test.ts`, `scripts/append-only-migration-sets.test.ts`, the
  `sqlite_master` trigger scan (§4), an empty-database migrate, and the fiscal pair.
- **Text guards**: `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`,
  `scripts/claude-md-pointers.test.ts`.

### Code slices (no migration, no reset)

| Id | Goal | Area and named files | Depends on | Lands | Guards |
| --- | --- | --- | --- | --- | --- |
| **S1** | The venue accessor: `readVenue(tx)`, `readVenueClock(tx)`, interim `venueLocationId(tx)`; repoint the readers already named "venue" and A696's zone code | `packages/db/src/venue.ts` (new); `packages/reporting/src/*` (`business-day.ts`, `record-daily-close.ts:40`, `overdue-orders.ts`); `apps/server/src/venue-*.ts` (`venue-locale.ts`, `venue-time-zone.ts`, `venue-address.ts`, `venue-details.ts`, A696's `venue-zone-context.ts`, `venue-zone-repair.ts`, `venue-zone-repair-api.ts`), `zone-repair-serving.ts`, `location-settings-api.ts` (renamed `venue-settings-api.ts`), `business-day-start.ts`; dashboard `screens/venue-zone-repair.ts` | A696 (#2369) landed | lane | code |
| **S2** | Invoice record inputs and invoice documents read the venue: operation description fallback, a full invoice's operation date zone, the issue zone (`IssueScope` loses `locationId`), the printed and emailed invoice's address and language | `packages/core/src/sale-location.ts`, `record-sale.ts:276-294`, `record-correction.ts`, `record-substitution.ts`; `packages/fiscal/src/issue-clock.ts`; every caller in §2.4's table; `apps/server/src/invoice-document.ts`, `invoice-print.ts`, `invoice-page-print.ts`, `invoice-email-contact.ts`, `invoice-delivery*.ts`; `packages/shared/src/record-export-types.ts`; `apps/server/scripts/record-one-sale.ts`, `daily-close-demo.ts`, `daily-close-z-demo.ts`, `modelo-303-demo.ts`, demo `seed.ts` and `seed-sales.ts` | S1 | **owner** (a, b) | fiscal pair, code |
| **S3** | Fiscal-verifactu stops reading a location: "same venue" node checks deleted, certificate dates and query month from the venue zone, recovery document's venue name, dormant-standby state and join bundle lose `locationId` (host file reset, §4) | `packages/fiscal-verifactu/src/*` (fiscal-check.md groups 2–4, 17 source files) and its test helpers; `packages/fiscal/src/contribution.ts`; `apps/server/src/mirror-bundle.ts`, `fiscal-certificate-api.ts`, `box-health-api.ts` | S1 | **owner** (c) | fiscal pair, code |
| **S4** | Standby adoption stays refused on purpose: before inserting the standby's `nodes` row, the establish step refuses with a named code while the venue's rows are absent (proposed `adoption.venue_not_copied`; the plan settles the name against the registry), so the outcome is today's (latch kept, `adoption.establish_failed` logged) but no longer rests on a foreign key; `PendingAdoption` loses `locationId` (host file reset, §4); the `finish-adoption.ts:32-43` comment is rewritten to name the new refusal | `apps/server/src/adopt.ts`, `finish-adoption.ts`, `apps/server/src/reserved-identity.ts`, `packages/db/src/reserved-identity.ts`, `packages/provisioning/src/tenant-guard.ts` | S1; lands before S25 | **owner** (c) | fiscal pair, code; a test asserting the new code, and a control showing the step still refuses with the `nodes` foreign key removed in a scratch schema |
| **S5** | Catalogue: the default and extra menus belong to the venue; routes move to `/management-api/venue/catalogues…`; `location.not_found` deleted | `packages/catalogue/src/*`; `apps/server/src/catalogue-api.ts`; dashboard callers and `codes.ts`; till menu switcher | S1 | lane | code |
| **S6** | Venue-service, service side: departments, zone policies, routing, kitchen screens, order service contexts | `packages/venue-service/src/*` except S8's files; its `dashboard/`; server callers | S1 | lane | code |
| **S7** | Floor: plan sets, zones, tables, today's floor | `apps/server/src/floor-*.ts` (`floor-plan-sets.ts:60-85`, `floor-today-store.ts:110,342,397`, `floor-today-api.ts`, `floor-today-table.ts`, `floor-today-name.ts`, `floor-delete.ts`, `floor-plan.ts`, `floor-revision.ts`), `zone-access.ts`, `watch-zones.ts`; `apps/dashboard/src/screens/floor-plan-editor.ts` | S1 | lane | code |
| **S8** | Venue-service, calendar side: seasons, special days, holidays (`city`/`province` from the venue), opening hours, starter language, business-day schedule | `packages/venue-service/src/holidays.ts`, `starter-language.ts`, season/special-day/timetable files; server callers | S1 | lane | code |
| **S9** | Staffing and bookings | `packages/staffing/src/*`, `packages/bookings/src/*`; server callers | S1 | lane | code |
| **S10** | Printing and layouts: the agent's job claim stops filtering by location | `packages/printing/src/*` (`runtime.ts:109`, `agent.ts`, `outbox.ts`, `printers.ts`), `packages/layouts/src/*`; `apps/server/src/print-api.ts`, `page-printers.ts`, `receipt-print.ts`, `demo-printer.ts`, `station-outputs-down.ts` | S1 | lane | code |
| **S11** | Server: orders, refunds, kitchen, stations, reports, adjustments | `apps/server/src/working-order.ts` (except `:7038`, S2), `order-drafts.ts`, `tender-refund-*.ts`, `bill-refunds.ts:104-119,706`, `kitchen.ts`, `station-*.ts`, `receipt-preview-api.ts`, `report-api.ts:155`; `packages/adjustments/src/*`, `packages/recipes`, `packages/payments` leftovers | S1 | lane | code |
| **S12** | Server: devices, joins, admission, node reads, personal-data export; `GET /management-api/locations` and the `getLocations` live query deleted | `apps/server/src/device*.ts`, `join-requests.ts`, `promote.ts`, `personal-data-export-api.ts`, `restore-stream.ts:214`, `workforce-api.ts:109`; `packages/module/src/personal-data.ts`; `apps/dashboard/src/api/live-queries.ts`, `api/client.ts` (`LocationSummary`) | S1 | lane | code |
| **S13** | Workforce code that A1268 leaves: roster versions, shifts and shift templates lose their location filters; convenio read for the venue; business-day reads A1268 keeps on the box's location move to `readVenueClock`; any location filter or `?locationId=` in attendance, hours, end-of-day or the server routes that A1268's merged diff still has. Not here, because A1268 does it: the chain key, entries, sessions, corrections, closures and both hashes (§6, "How A1301 meets A1268") | `packages/workforce/src/*`, `packages/workforce-es/src/*` except `record-export.ts`; `apps/server/src/attendance-*.ts`, `management-attendance-api.ts`, `till-clock-*.ts`, `workforce-api.ts:124,136,405`; the plan lists which of them still match the area grep after A1268 lands | A1268 landed; S1 | lane | code |
| **S14** | The art. 34.9 export, per the owner's answer to question 4, (a): the opening table names the venue once (`Workplace \| From \| Before (excluded) \| …`), the name from `readVenue` (it reads `locations` at `record-export.ts:181-185` today); the "Workplace reference" column goes, so the entries and closures tables carry no workplace column; no official workplace code. Its plan reads A1268's merged `record-export.ts` first, so the two do not collide: at #2375's head `8eddd1a4f7` the column is still declared (`:30`) and filled per entry (`:252`) and per closure (`:372`), and #2375's only change to the file adds the skip-numbers note; if A1268's revision removes those fills, S14 drops only what is left. Not here, because A1268 does it: the per-venue export and leaving out the "positions can skip numbers" note | `packages/workforce-es/src/record-export.ts` and its tests and guide text | A1268 landed; S1 | lane | code |
| **S15** | Dashboard and till attendance and hours, as A1268 leaves them: the planned-versus-actual location picker deleted; the Location column deleted from attendance screens; hours and attendance-day screens and their API clients stop sending a location; the till's other-location refusal, `clock.other_location` and `activeLocationId` deleted if A1268 left any of them. #2375 changes no dashboard or till file | `apps/dashboard/src/screens/attendance-corrections-screen.ts`, `planned-actual-screen.ts`, `widgets/location-picker.ts` (deleted), `my-hours-panel.ts`, `hours-record.ts`, `attendance-export-dialog.ts`, `api/attendance*.ts`, `api/hours.ts`; `apps/till/src/*` (`till-app.ts`, `api/client.ts`, `screens/till-hours-screen.ts`, `widgets/attendance-day-dialog.ts`, `state/*`) | S13 | lane | code; check free memory first for browser tests |
| **S16** | Setup, restore and provisioning: `LocationDraft` folds into the venue draft; tax territory and fiscal-module choice read the venue field at setup and restore; `first-setup.json`'s `location` key goes (host file reset, §4) | `apps/setup/src/*`; `apps/server/src/setup-api.ts`, `recovery-backup-preview.ts`, `recovery-fiscal-selection.ts`, `first-fiscal-activation.ts`, `first-fiscal-mode.ts:25-28`, `restore.ts:862-863` (`readNodeLocation`, `restore.identity_unknown`), `module-operation-host.ts`, `boot.ts` territory reads; `packages/provisioning/src/*` except S4's and S17's files (`venue-plan.ts`, `venue-apply.ts`, `cli.ts`, `recover-provisioned-venue.ts` beyond S2's call, `first-setup-state.ts:240-279`, `first-setup-resolution-inspection.ts`); `packages/fiscal-verifactu/src/setup/first-hour.ts`, `venue-fields.ts`; `scripts/setup-wizard-fiscal-fields.test.ts` | S1 | **owner** (c: chooses the filing module and starts the chain at setup and restore) | fiscal pair, code, `apps/server/src/first-fiscal-setup.e2e.test.ts` |
| **S17** | Configuration bundle: `venue.location` → venue fields; `locationColumns` deleted; the two CLAUDE.md rules (§5) | `packages/module/src/module.ts:1592`, `packages/provisioning/src/configuration-transfer.ts`, the five declaring `configuration-transfer.ts` files, `scripts/id-columns-are-references.test.ts`, CLAUDE.md, `docs/developers/conventions-data.md` | S16 | lane | code, `id-columns-are-references`, `claude-md-pointers`, `apps/setup/src/setup-app-first-fiscal.test.ts` |
| **S18** | Contract and type cleanup: `cfg.locationId` out of the module contract, `ProvisionedNode`, backup verification, `NodeConfig`, `readNodeLocation`, `LocationId`, `ReceiptText.locationId`, `readLocationClock`; `boot.ts:1588` checks for exactly one venue row with no id comparison; reason `location` out of `venue.time_zone_target_invalid` | `packages/module/src/*` (`module.ts`, `backup-verification.ts`, `provisioning.ts`), `packages/db/src/backup-evidence.ts:253-271`, `packages/shared/src/ids.ts:11`, `receipt-text.ts:126`, `errors.ts:30`, `apps/server/src/node-config.ts`, `boot.ts:1587-1588,2916`; whatever the done-check grep still finds | S2–S17 | lane | code, fiscal pair; done when the whole-tree grep prints only `venueLocationId` calls, schema and listed unrelated words |
| **S19** | Text and docs sweep (§5) | translation files, guides EN+ES, `docs/developers/*`, backlog, demo seeds, country packs | plan-only backlog entries now; the rest after S18 | lane | text |

### Fixture slices (tests only, no migration, no reset)

| Id | Goal | Area | Depends on | Lands |
| --- | --- | --- | --- | --- |
| **F1** | The seed helpers become the one source of venue, node, device and order rows; `packages/db` tests move onto them | `packages/db/src/testing/seed.ts` and `packages/db` tests (62 files insert `locations`, 24 insert nodes, devices or orders, overlapping, at `e32b9f3866`) | S1 | lane |
| **F2** | Packages' tests move onto the helpers | every other package's tests and `src/testing/*` (files inserting `locations`: venue-service 69, printing 12, the rest under 6 each) | F1 | lane |
| **F3** | `apps/server` tests whose path under `src/` starts `a`–`f` | 109 files that insert one of the four tables | F1 | lane |
| **F4** | `apps/server`, `g`–`r` | 99 files | F1 | lane |
| **F5** | `apps/server`, `s`–`z` (with `src/testing/*`), the four `apps/server/scripts/` test files, the root `scripts/*.test.ts` raw-SQL seeds, and `apps/dashboard`/`apps/till` where they seed a database | 78 `apps/server` files plus the rest | F1 | lane |

### Schema slices (migration; every venue reset)

Every one adds its `RESETS` entry, reruns the `sqlite_master` trigger scan for each table it rebuilds,
migrates an empty database, and opens its PR with "Every venue is reset: …; backups and exports
from before this cannot be restored or imported".

| Id | Goal | Touches | Depends on | Lands |
| --- | --- | --- | --- | --- |
| **S20** | bookings, staffing, workforce-es (`convenio_config` one row) | three packages' `schema/`, `drizzle/`, classification, own fixtures | S9, S13, S18, F2 | lane |
| **S21** | venue-service's 8 tables; one-default keys on the flag column | `packages/venue-service/src/schema/*`, `drizzle/`, own fixtures | S6, S8, S18, F2 | lane |
| **S22** | The workforce tables A1268 leaves: `roster_versions`, `shifts` and `shift_templates` (state tables, outside A1268's scope), and any `attendance_*` table whose `location_id` A1268 keeps. No hash function and no append-only table: A1268 changes `time_entries`, `pay_period_closures`, `chain-hash.ts`, `pay-period-chain.ts` and backup verification's closure grouping | those tables' `packages/workforce/src/schema/*` files, `drizzle/`, own fixtures | A1268 landed; S13, S18, F2 | lane |
| **S23** | Core settings move: create `venue_settings`, `venue_catalogues`, `business_day_settings`, `day_cutover_changes`; drop the three old side tables; `readVenue`/`readVenueClock` and every writer switch; the four language-check triggers recreated reading `venue_settings` (§2.3, with the behaviour cases); the live-venue guard and S4's check read `venue_settings` (§3); `locations` left as it is, read only for its id by `venueLocationId` and still written at setup; live-query table lists (`packages/*/src/dashboard/live-queries.ts`, `apps/dashboard/src/api/live-queries.ts`) | `packages/db/src/schema/*`, `drizzle/`, `venue.ts`, `classification.ts`; writers in `venue-apply.ts`, `venue-settings-api.ts`, `business-day-start.ts`, zone repair, `configuration-transfer.ts`; `tenant-guard.ts` and its five readers (§3); `seedVenue` | S18, F1–F5 | **owner** (b, c) |
| **S24** | Core floor, kitchen and printing tables lose `location_id` | `dining_tables`, `floor_plan_sets`, `floor_zones`, `kitchen_stations`, `kitchen_courses`, `print_agents`, `printers`, `print_jobs`, `page_printers` schemas, `drizzle/`; their fixtures | S23 | lane |
| **S25** | `nodes` loses `location_id` (a rebuild; 22 child keys, §4) | `packages/db/src/schema/*`, `drizzle/`, `seedNode`; `insertReservedNodeTx` and `node-identity.ts` writers | S4, S23, S24 | **owner** (c, d) |
| **S26** | `devices` loses `location_id`; `device_profile_form_factor_locked` dropped before and recreated after | `packages/db/src/schema/*`, `drizzle/`, `seedDevice` | S25 | **owner** (d) |
| **S27** | `working_orders` and `tender_refunds` lose `location_id`; the three `require_open_parent` triggers dropped before and recreated after; the five triggers on `working_orders` and two on `tender_refunds` recreated, `working_orders_enforce_transition` and `tender_refunds_guard_update` without `location_id` | `packages/db/src/schema/*`, `drizzle/`, the order helper | S26 | **owner** (d) |
| **S28** | `join_requests` loses `location_id`; `locations` dropped (plain `DROP TABLE`); `venueLocationId` deleted; `seedVenue` stops writing `locations` | `packages/db/src/schema/*`, `drizzle/`, `venue.ts`, every remaining `venueLocationId` caller | S20–S27 | lane; ends with `git grep -n venueLocationId` printing nothing |

**Parallel work.** After S1: S2–S12 and S16 can run in different lanes at the same time, and F1 can
start; their only shared files are callers in `apps/server` (the plan names each slice's files
exactly so lanes rebase around one another). F2–F5 follow F1 in parallel. S13 and S14 start when
A1268 lands, S15 after S13, S17 after S16.
S18 waits for S2–S17. S19's plan-only part can start now. S20, S21 and S22 can be built in parallel;
S23–S28 one after another.

**The reset window.** S20–S28 land back to back in one window the watcher announces, each PR's first
line as above. It waits for no owner answer: questions 1 and 2 were answered on 2026-11-01, and the
hash changes they decide ship in A1268, which was asked to name the boxes it resets in its PR's
first line (lane B's `questions.md`, owner answers ~15:30). The laptop dev-stack slots (`wa-wt reset`), the Santet venue (its own
`local/square/reset.sh`) and the owner's home box are reset once after the window — or once after
A760 if it follows directly (§4).

**Owner-landed slices:** S2, S3, S4, S16, S23, S25, S26, S27 — eight, the letters in the table saying
which part of the rule above applies. None changes a fiscal byte, and each runs the fiscal pair
unedited.

### How A1301 meets A1268

A1268 is lane B's. Its first PR, #2375 (`feat/a1268-clock-ins-per-venue`, open at `8eddd1a4f7`,
`gh pr view 2375`), makes the working-time chain one per node. It was built before the owner's
per-venue decision, still keeps a location on each entry, and is held by a review thread until lane B
revises it (lane B's `~/waitron-campaign-b/questions.md`, watcher entry ~15:15). The owner's decisions put the rest of
working time in A1268 as well (lane B's `questions.md`, ~14:40 and ~15:30): no location on clock
entries (the column, the append input and the entry hash), on work sessions, on corrections and
confirmations, or on pay-period closures (the closure hash, one closure chain per node, one closure
per period); the export and the end-of-day pass per venue; no "positions can skip numbers" note.
At `8eddd1a4f7` neither the PR nor its plan
(`docs/superpowers/plans/2026-11-01-a1268-clock-ins-per-venue.md` on that branch) does those yet.
So A1301's workforce slices (S13, S14, S15, S22) start after A1268 lands, and each slice's plan reads
A1268's merged diff and removes only what is still there. "A1268 landed" in the slice tables means
every A1268 PR that removes a location has merged. A1268's PR 3 (pairing by write order after
a backward clock step) does not depend on locations.

| A1268 piece | Done by | What A1301 does |
| --- | --- | --- |
| `workforce_chains.location_id` and the chain key | #2375: `packages/workforce/src/schema/workforce-chains.ts`, `chain.ts`, `drizzle/0012_workforce_chain_per_node.sql` (plan Task 3a) | nothing |
| `time_entries_chain_position_uq` and `time_entries_person_chain_idx` lose the location | #2375: `packages/workforce/src/schema/time-entries.ts` (Task 3a) | nothing |
| `time_entries_location_chain_idx` (location, node, position) | added by #2375 (`schema/time-entries.ts:167` on that branch); goes with the column in A1268's revision | S22, only if A1268 leaves it |
| Backup verification groups time entries by node | #2375: `packages/workforce/src/backup-verification.ts`, `chainScope` (Tasks 2 and 3a) | nothing |
| `attendance.append_contention` loses `locationId` | #2375: `packages/workforce/src/errors.ts` (Task 3a) | nothing |
| `time_entries.location_id`, `TimeEntryAppend.locationId`, `LocationId` in the entry hash | A1268's revision (question 1) | nothing; a slice plan that finds any of it still there stops and asks the watcher |
| `time_entries_response_subject_fk`, `time_entries_subject_identity_uq`, `sameSubject`'s location half (D5) | A1268's revision | nothing. The three keys at `packages/workforce/src/schema/attendance.ts:168-182` name `time_entries.location_id`, so dropping that column changes them too |
| Pay-period closures per (node, location): the column, `pay_period_closures_chain_position_uq`, `_period_uq`, `computeClosureHash`'s location, backup verification's `closureScope` | A1268's revision (question 2) | nothing |
| "A session counts at its clock-in's location"; per-location hours reads and end-of-day pass (D4, D7) | A1268's revision: no per-location view, so `recordAtLocation` (its plan's Task 6) is not built | S13 removes what remains |
| "The box location's business day" (D7) | A1268 keeps the box's location as the source (lane B's `questions.md`, ~14:40) | S13 moves it to `readVenueClock` |
| The per-location art. 34.9 export and its skip-numbers note | #2375 adds the note (`packages/workforce-es/src/record-export.ts:435-438` on that branch, Task 3c); A1268's revision removes it and makes the export per venue | S14: the venue's name |
| The export's "Workplace reference" column | not in #2375 (at `8eddd1a4f7` it is still declared and filled); A1268's revision may remove the entries' and closures' fills | S14 removes what is left (question 4, answered (a)) |
| The till's other-location refusal, `clock.other_location`, `activeLocationId` | A1268's revision, if it removes them (its plan's Task 11 and open question 2) | S15 deletes what remains |
| `location_id` on the five `attendance_*` tables (`attendance.ts`, `attendance-responses.ts`) | A1268's revision, if its per-venue end-of-day pass drops them | S22 drops any left |
| Device admission by location (`admit`) | out of A1268 | S12 |
| `roster_versions`, `shifts`, `shift_templates` | out of A1268 | S13 (code), S22 (schema) |

## 7. Owner questions

Four questions were asked. Three are answered and one is withdrawn.

### Question 1 — does a working-time entry's hash name where it was made? Answered

Every clock-in, clock-out and break is hashed with the location it was made at
(`packages/workforce/src/chain-hash.ts:67`, `["LocationId", input.locationId]`). The question: should
an entry's hash name only the person, the node (the box that wrote it) and the event, and no place?

**Answered 2026-11-01 (~15:30, relayed by the watcher): (a), drop the field.** The hash input
becomes `SequenceNo=1&PersonId=p-7&NodeId=n-1&EntryKind=clock_in&…&PrevEntryHash=`, with no
`LocationId` at all, not an empty one. Every existing entry stops matching, so a box with clock
entries is reset. **A1268 builds it**, in the same PR that removes the location from entries.

### Question 2 — is a pay period closed once for the venue, with no place in its hash? Answered

`computeClosureHash` (`packages/workforce/src/pay-period-chain.ts:119-130`, `row.locationId` at
`:123`) hashes the closure's location, and closures form a chain per (node, location). The question:
should a pay period be closed once for the venue, its closures forming one chain per node, with no
place in the hash?

**Answered 2026-11-01 (~15:30, relayed by the watcher): yes.** The hash loses the location; the zone
and day start stay, with the same values. The chain position becomes unique per (node, sequence
number) and the period unique per (start, end). A box that has closed a pay period is reset. **A1268
builds it**, with question 1's change.

### Question 3 — is approved work built if a later approved item deletes it unseen? Withdrawn

It asked whether lane B should skip A1268's second PR, whose per-location session code A1301 would
delete. **Withdrawn 2026-11-01:** A1268 was revised to remove the location from clock-ins itself, so
it no longer builds that code and there is nothing left to skip.

### Question 4 — does the working-time export name the workplace only by the venue's name? Answered

The export names the workplace in two columns of its opening table — "Workplace reference /
Referencia del centro", the location's internal id, and "Workplace / Centro de trabajo", its name — and
its entries and closures tables carry the reference column alone
(`packages/workforce-es/src/record-export.ts:30-31`, `:97`, `:252`, `:336-337`, `:369`).
With one venue the reference identifies nothing the name does not. The rule: **does the export name
the workplace by the venue's name alone?**

Worked example, the first columns of the export's opening table and of its entries table:

- Today, opening table: `Workplace reference | Workplace | From | Before (excluded) | Version | …`
  with `6f1c…a2 | Casa Delgado | 2026-10-01 | 2026-11-01 | …`; entries table:
  `Entry reference | Worker reference | Worker | Workplace reference | Event | …` with
  `e-41 | p-7 | Ana Ruiz | 6f1c…a2 | …` (the closures table carries the same reference).
- (a) Drop the reference: opening table `Workplace | From | Before (excluded) | Version | …` with
  `Casa Delgado | 2026-10-01 | 2026-11-01 | …`; entries table
  `Entry reference | Worker reference | Worker | Event | …` with `e-41 | p-7 | Ana Ruiz | …`.
  The entries and closures tables then carry no workplace column; the opening table names the venue
  once for the whole file.
- (b) Keep the column and fill it with the box's node id: a stable code per box, which changes when a
  box is restored or a standby promoted.

**Recommended: (a).** An official workplace code (Spain's Social Security account code for the
workplace) would be a new field the venue enters, and a separate item if wanted.

**Answered 2026-11-01 (~15:55, relayed by the watcher): (a).** The "Workplace reference" column
goes. The opening table names the venue once for the whole file
(`Workplace | From | Before (excluded) | …`); the entries and closures tables carry no workplace
column; no official workplace code is added now. **S14 builds it**, and waits only for A1268 to
land. #2375 does not remove the column: at `8eddd1a4f7` (still open, head committed 15:09 CET, PR
unchanged since 15:15 CET) the export still declares it (`record-export.ts:30`) and fills it from each entry (`:252`)
and each closure (`:372`), and its only change to the file adds the skip-numbers note. A1268's
revision takes the location off entries and closures, which leaves those two fills with no value
to read, so it may remove them itself; S14's plan reads A1268's merged file and removes what is
left.

## 8. Risks, and what the plan review should check

1. **A migration that cannot run, or runs and cascades.** A rebuilt `nodes` fails on any box with a
   record; a rebuilt `working_orders`, `departments` or `kitchen_stations` deletes cascading children
   with no error (§4). The review checks that each schema slice's plan lists the rebuilt tables and
   their children, that its upgrade rehearsal seeds one cascading child row and records what happens
   to it, that its `RESETS` entry is copied from the test's output, and that the PR's first line
   declares the reset.
2. **A trigger in the way of a rebuild.** The review checks that each schema slice ran the
   `sqlite_master` scan for every table it rebuilds, drops and recreates each reader trigger, recreates
   each trigger the rebuild deletes, and migrates an empty database cleanly (§4).
3. **The hashed record time after #2369** (§2.4). The review checks that S2 and S23 prove the issue
   zone reads the same value before and after (a test across a daylight-saving change, with a control
   that fails when the zone source is wrong), and that the golden hash case is unedited.
4. **Standby adoption** (§3). The review checks that S4 lands before S25 and that S4's test shows the
   refusal holding with the foreign key gone.
5. **The interim helper outliving its purpose.** `venueLocationId` must have no caller after S28; the
   review checks that S28's plan ends with a grep for it returning nothing.
6. **Test fallout sizing.** The review checks that F1–F5 ran before the window, that each slice's file
   count was measured with the grep in §6, and that anything past about 100 implementer steps was
   split before dispatch.
7. **Deleted, not rewritten.** A cross-location refusal test is deleted with its check. The review
   checks that no other assertion is weakened along the way (each changed assertion names the
   decision here that changes it).
8. **Lanes in flight.** A696 (#2369) must land first; #2372 (A803 slice 4) and #2373 (W41s-7) touch
   order and invoice code S11 and S2 also touch. The review checks the plan's file lists against open
   PRs at the plan's head.
9. **`fire_control` and A773-2.** Whichever lands second drops its removal step.
10. **Spanish wording found by eye.** Spanish says "local" for both the premises and "local network",
    and a bracket class or `.` in `git grep` misses "ubicación" (§5). The review checks S19 searched with
    plain words, from the English keys.

## 9. Provenance

Claims from the research seats not re-checked here are marked "per inventory.md §N" or "per
fiscal-check.md …". Re-checked for this design, by running or reading at `790214ba8c` (the tree of
`e32b9f3866`) unless stated:

1. `tenants` has exactly three permitted writers, two of them reached from a request route — read
   `scripts/write-path-tables.json:13-17` and `apps/server/src/location-settings-api.ts:12`; no
   foreign key points at `tenants` (`node /tmp/a1301-rev/fks.mjs tenants` printed nothing).
2. `locations.bump_mode` has no reader — `git grep -n -E 'locations\.bumpMode|l\.bump_mode|locations\.bump_mode' -- apps packages ':!**/drizzle/**'` printed nothing.
3. `fire_control` is read only by the configuration bundle — `git grep -n -w -E 'fireControl|fire_control' -- 'apps/*/src/**' 'packages/*/src/**' ':!*.test.ts'` printed only `tenants.ts` and `configuration-transfer.ts` lines and one till test fixture; A773-2's plan read at `docs/backlog/kitchen.md:296`.
4. The four `invoice_locales` triggers — `/usr/bin/grep -n -E 'CREATE TRIGGER|invoice_locales|JOIN locations'` on `0110_printing_retirement_restore_readers.sql`: triggers at lines 1, 29, 58, 91, each joining `locations`; their behaviour cases read at `scripts/behavioural-triggers.test.ts:288-405,1343`.
5. The two working-time hashes name the location — read `chain-hash.ts:63-81` (`LocationId` at `:67`) and `pay-period-chain.ts:119-130` (`row.locationId` at `:123`).
6. The huella ignores description and issuer name — re-ran `/tmp/a1301-probe/huella-probe.mjs`: `SAME` for the change, `DIFFERENT` for the control.
7. A table-level foreign key makes SQLite refuse a column drop, and drizzle-kit emits a rebuild — re-ran `/tmp/a1301-rev/dropcol.mjs` (3.54.0: inline key dropped, table-level key refused, indexed-column control refused) and read `/tmp/a1301-rev/dk/out/0001_v2.sql`; `nodes`' table-level key read at `0000_baseline.sql:59`; fiscal-check's probe declared the key inline (`/tmp/a1301-probe/rebuild-probe.mjs:6`).
8. A rebuild's rename is refused while another table's trigger reads the table, empty or not — re-ran `/tmp/a1301-rev/rename.mjs` (refused with foreign keys on and off).
9. Live triggers reading or sitting on each rebuilt table — re-ran `/tmp/a1301-rev/trig.mjs` and `/tmp/a1301-fold-trig-on.mjs` over every set's drizzle SQL (text only; code-created triggers not seen).
10. 22 foreign keys point at `nodes`, none cascading, 13 from fiscal tables — `node /tmp/a1301-rev/fks.mjs nodes` (latest snapshots); other tables' children by `/tmp/a1301-design/snap.mjs`.
11. The adoption path and the live-venue guard — read `apps/server/src/finish-adoption.ts:29-54`, `packages/provisioning/src/tenant-guard.ts`, `apps/server/src/adopt.ts:120-140`, `apps/server/src/reserved-identity.ts:40-100`, and `git grep -n -E 'assertSingleOperationalVenue|readOperationalVenueIds|assertNoOperationalVenue'` (five readers). What adoption does without the column: not run.
12. A696's state, callers and new text — `gh pr view 2369 --json headRefOid,state` (OPEN, `7e824ae233`); `git merge-base --is-ancestor 8ec592f10f 7e824ae233` exited 1; `git grep -n -E 'prepareIssueClock|readIssueZone' 7e824ae233`; read `issue-clock.ts`, `void-issue-clock.ts:14-25` and `backend.ts:420-440` at that head; A696's added lines naming a location listed by `git diff 790214ba8c 7e824ae233` filtered by `/usr/bin/grep -i -E 'location|ubicaci'`. The hash path traced by reading, not run.
13. A760 is a pure squash — read `docs/operations/a760-migration-squash.md` lines 1-40.
14. The default menu and the extra menus are independent by design — read `packages/catalogue/src/operations.ts:1310-1378`.
15. The proposed table and function names are free — `git grep` for `table("venue…"`, `table("business_day…"`, `table("day_cutover…"` and `readVenue`/`readVenueClock` printed nothing.
16. Test fallout — `git grep -l 'insert(locations)' -- '*.test.ts'` (419 files), `git grep -l -w locationId -- '*.test.ts'` (888), `git grep -l -E 'insert\((nodes|devices|workingOrders)\)' -- '*.test.ts'` (197), `git grep -l -i 'insert into locations' -- '*.test.ts' '*.test.mjs'` (18), each grouped by package; F3–F5's counts from `git grep -l -E 'insert\((locations|nodes|devices|workingOrders)\)|insert into locations' -- 'apps/server/*.test.ts' 'apps/server/src/testing/*'` (286 files) split by the first letter of the path under `src/`; re-run in round 3 as 239 for `apps/server` and 109/99/78 for F3/F4/F5, four of the 286 under `apps/server/scripts/`.
17. Source files naming the word — the §6 grep matched 560 non-test files under `apps/*/src` and `packages/*/src`; the review's sweep found 280 basenames the first draft never named, and the files it sampled were re-checked by counting matches in each.
18. The Spanish search — `git grep -n -i 'ubicación' -- apps/server/src/guide` printed 2 lines; `git grep -n -i -E 'ubicaci[oó]n'` printed 0; `git grep -n -E 'ubicaci.n'` printed 0.
19. The art. 34.9 export's workplace columns — read `packages/workforce-es/src/record-export.ts:24-50`, `:92-110` (`ENTRY_KEYS`) and `:365-372` (the closures section).

## Appendix A. Review 1 folds

`~/waitron-campaign/a1301/review-1.md`. Each finding was checked by re-running its command or reading
its `file:line` before folding; none was rejected.

- **C1** → folded: confirmed by reading (§9.11). S4 (owner) keeps adoption refused on purpose; the
  live-venue guard reads `venue_settings` from S23; §1 and §3's identity claim narrowed to "provided S4
  lands before S25".
- **I1** → folded: `dropcol.mjs` and the drizzle-kit output re-run and re-read (§9.7, §9.10); §4 says the
  reset is forced and names the 22 keys.
- **I2** → folded: `rename.mjs` and `trig.mjs` re-run (§9.8, §9.9); the first draft's S22 split into S25–S28 with
  every trigger step named; the `sqlite_master` scan added because the text scan misses code-made
  triggers.
- **I3** → folded: `RESETS` read at `migration-upgrade.test.ts:361-435`; every schema slice adds its entry.
- **I4** → folded: counts re-run (419 and 888 match; the per-package split differs by a few files);
  fixture slices F1–F5 before the window; the first draft's S22 split by table.
- **I5** → folded: confirmed at `location-settings-api.ts:12`; the false half removed; the decision kept
  on separation reasons, said to be reasons of separation, not necessity.
- **I6** → folded: the sampled files confirmed by match counts (the floor-plan editor is under
  `screens/`, not `widgets/`); each assigned, a new Floor slice (S7), and an area rule with a
  done-check grep for the files no one listed.
- **I7** → folded: questions 3 and 4.
- **I8** → folded: re-cited at `7e824ae233` with every caller and its slice; A696's text and error reason
  added to §5; `void-issue-clock.ts`'s `mismatch` found to compare nodes, not locations, so it stays.
- **M1** → folded (§5). **M2** → folded (no count). **M3** → folded (rule text, not line numbers).
  **M4** → folded (§5 Backlog timing, S19). **M5** → folded (`locations` kept until S28's plain drop).
  **M6** → folded (§2.3). **M7** → folded (the owner-landed rule; invoice documents moved into S2).
  **M8** → folded (question 1 names Santet and the home box). **M9** → folded ("Words used below").
  **M10** → folded (§4, schema PR first lines).

## Appendix B. Round 3 claim-check folds

`~/waitron-campaign/a1301/round3.md`. Each fix applied as its wording says.

- **R3-I1** → folded: question 4 says the two columns sit together only in the opening table and the
  entries and closures tables carry the reference alone; option (a) says what those two tables are
  left with; the worked example shows the entries table before and after.
- **R3-I2** → folded: the `line-orphaned` citation removed; the plan adds an insert case expecting
  `require_open_parent_insert`'s refusal, and the text says foreign keys are off on that connection.
- **R3-I3** → folded: the four demo scripts added to §2.4's table and S2's files; the area grep widened
  to `apps/**`, `packages/**` and `scripts/**`, with the files outside `src` assigned (S2, the F slices,
  else S18).
- **R3-M1** → folded: the false `bumpMode` keep-reason replaced with the round's wording (the builder
  goes; `kitchen_stations` uses `BumpMode` from `@waitron/shared`).
- **R3-M2** → folded: 244 → 239 and F3/F5 113/74 → 109/78; F5 takes the four `apps/server/scripts/`
  test files; §9.16 notes the re-run.
- **R3-M3** → folded: `locations` is "read only for its id, by `venueLocationId`, and still written at
  setup" from S23 until S28, not "unread".
- **R3-M4** → folded: §5, §8 risk 10 and §9.18 say a bracket class or `.` misses the two-byte `ó`.
- **R3-M5** → folded: S10 and S24 stay lane slices; §6 says an invoice delivery is not an invoice record
  and neither slice changes an invoice byte.
- **R3-M6** → folded: the watcher opens the reset window only once questions 1 and 2 are answered.
- **R3-M7** → folded: §2.4 says the offset is used to rebuild the annulment's
  `FechaExpedicionFacturaAnulada`, whose rendered day it leaves unchanged.
