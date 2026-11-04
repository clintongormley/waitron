> Appendix to [README.md](README.md), the rationalisation design of 2 November 2026: one researcher's proposal for this area, written to the shared rules. Where README.md §5 decides differently, README.md wins.

# Floor, parties, bookings and kitchen — proposed tables

Area: the floor plan, tables, parties and bookings, the kitchen (stations, courses, tickets,
kitchen notices, routing, allergies, service steps), the zone policy side tables and the allergy
tables. Researched read-only; every "the code does X" below was read, not executed, unless it says
otherwise. Section 8 lists what must be run before building.

This file carries the owner's review of 4 November 2026, and its cites were re-read on `main` at
`e0da0ad18a`. A773-2 PR D has since dropped `pass_item_marks` and `ticket_items.away_at` (migrations
`0205_retire_pass_item_marks` and `0206_retire_away_at`), so neither appears here. The `location_id`
columns, keys and foreign keys are still on main, and go in A1301's schema slices S20–S28.

**Result: 40 current tables → 25 target tables** (owner, 2026-11-04). The 40 count
`department_floor_plan_sets`, which sits in the venue-and-box area today and is absorbed into
`floor_plan_sets`.

The big move is the floor. Today one physical table is stored across up to seven tables: its design
(`floor_plan_tables`), which joined table it is part of in the design (`floor_plan_table_parts`), the
copy the zone's last reset took (`floor_reset_tables`, `floor_reset_table_parts`), the live table
(`dining_tables`), its state on today's map (`floor_today_tables`), and whether it is split off or in
a merge today (`floor_today_split_parts`, `floor_today_join_tables`). The seven become three (owner,
2026-11-04), one for each thing with its own lifetime:

- **`floor_plan_tables`, the design.** A design row can exist before its live table and outlive it.
  Placements point at it; parties, bookings and delivery point at the live table. Its parts fold in.
- **`dining_tables`, the live table.** Its state today, its split and its merge fold in. Each of those
  is at most one row per table.
- **`floor_reset_tables`, the reset's copy.** Every reset deletes the zone's rows and writes a fresh
  batch, and the copy can hold a table still to be made, which has no live row. Its parts fold in.

---

## 1. Target tables

Types use the house column vocabulary (`packages/db/src/schema/columns.ts`): `id`, `label`, `flag`,
`count`, `smallCount`, `tsString`, `day`, `timeOfDay`, `json`, `quantity`. Reference venue: one
restaurant, 250 bills a day × 4 lines, 360 days a year. "Set" means migration set: every table below
is in `core` except `bookings`, because venue-service's tables fold into core (README U1).

### 1.1 `floor_zones` — a named area of the dining room, with its service rules and today's record

Absorbs `zone_service_policies`, `zone_sale_policies`, `floor_today_zones` and `zone_extensions`
(each one row per zone: primary key or unique key on `zone_id`).

| column | type | key / null | from |
| --- | --- | --- | --- |
| id | id | PK | floor_zones |
| name | label | not null | floor_zones |
| display_order | count | not null, default 0 | floor_zones |
| active | flag | not null, default 1 | floor_zones |
| created_at | tsString | not null | floor_zones |
| department_id | id | not null, FK `departments` | zone_service_policies |
| is_counter_default | flag | not null, default 0 | zone_service_policies |
| order_start | enum table/counter | null = follow department | zone_sale_policies |
| paid_when | enum prepay/ticket_then_pay | null | zone_sale_policies |
| collection_number | enum none/numbered | null | zone_sale_policies |
| receipt_print_mode | enum auto/on_request | null | zone_sale_policies |
| today_business_day | day | null = no plan built yet | floor_today_zones.business_day |
| today_revision | count | not null, default 0 | floor_today_zones.generation |
| today_set_id | id | null, FK `floor_plan_sets` | floor_today_zones.set_id |
| today_layout_revision | count | not null, default 0 | floor_today_zones.layout_revision |
| today_occurrence | label | null | floor_today_zones.occurrence |
| kept_open_day | day | null = not kept open | zone_extensions.business_day |
| kept_open_from | timeOfDay | null | zone_extensions.starts_at |
| kept_open_until | timeOfDay | null | zone_extensions.ends_at |

Protections: unique `name` where `active` (was `floor_zones_name_key` with `location_id`); unique
partial index on `is_counter_default` where it is 1 and `active` is 1 (was
`zone_service_policies_one_counter_default_key`; the `active` term is new, see below); FK
`department_id`; FK `today_set_id`; the four enum CHECKs; `kept_open_*` all set or all null, and the
quarter-hour CHECK of `zone_extensions_step_ck` on both times. Classification `state`, not
append-only, set `core`. Rows: about 6.

Why the "today" and "kept open" columns can be columns: `floor_today_zones` is unique on `zone_id`;
an absent row reads as revision 0 and "no business day" (`resetZoneFor`,
`apps/server/src/floor-today-store.ts:210-226`; `ensureToday` filters `isNull(businessDay)`,
`:999`), which the nullable `today_business_day` and default `today_revision` 0 express. `moveRoom`
answers "no change" for a zone with no today row (`apps/server/src/floor-revision.ts:107-114`), so its
update gains the condition `today_business_day is not null`. Every `zone_extensions` writer deletes
the zone's rows for other days first (`keepZoneOpen`, `packages/venue-service/src/keep-open.ts:140-145`)
and every reader filters to one business day (`zone-closed-times.ts:230`,
`business-day-schedule.ts:299`), so at most one row per zone is ever read. The configuration export
must `omit` the `today_*` and `kept_open_*` columns, as it omits `zone_extensions` today
(`docs/developers/conventions-data.md` "Today's station destination and zone extension").

**A deleted zone stays as an inactive row, which changes three things.** Today a delete removes the
zone's policy rows and keeps the `floor_zones` row with `active` 0
(`packages/venue-service/src/service-delete-settings.ts:370-372`, `:399`;
`packages/venue-service/src/service-delete.ts:312`).

- The delete now clears the sale rules, `kept_open_*` and `is_counter_default` on that row.
  `department_id` stays on it. The key still holds, because a department is also deactivated and
  never deleted (`service-delete.ts:314`).
- Today a reader that reaches a zone through `zone_service_policies` skips a deleted zone without
  asking, for example `packages/venue-service/src/day-resolver.ts:263`. In the target each such
  reader must filter on `active`.
- `opening_hours.zone_id` cascades from the policy row today (`packages/venue-service/src/schema/seasons.ts:177-180`). A soft delete
  fires no cascade, so the explicit delete at `service-delete-settings.ts:371` stays and names
  `opening_hours`.

`department_id` can be not null because both product paths that create a zone write its policy in
the same transaction (`packages/venue-service/src/operations.ts:456`, then `configureZone`;
`packages/venue-service/src/provisioning.ts:95`, `:109`). The "no policy row" half of
`zone.department_missing` (`packages/venue-service/src/operations.ts:338-340`) then has nothing left to find. Test fixtures that
insert a bare zone need a department first.

### 1.2 `floor_plan_tables` — one table in the zone's design, shared by every layout set (kept, takes in `floor_plan_table_parts`)

| column | type | key / null | from |
| --- | --- | --- | --- |
| id | id | PK | floor_plan_tables |
| zone_id | id | not null, FK `floor_zones` | floor_plan_tables |
| label | label | not null | floor_plan_tables |
| short_name | label | null | floor_plan_tables |
| seats | count | null | floor_plan_tables |
| fixed | flag | not null, default 0 | floor_plan_tables |
| part_of_table_id | id | null = not part of a joined table; self FK | floor_plan_table_parts.joined_table_id |

Protections: unique `(zone_id, label)` (`floor_plan_tables_zone_label_key`), zone FK, seats CHECK
(0–999), all kept. `floor_plan_table_parts` is unique on the part (`floor_plan_table_parts_part_key`,
`packages/db/src/schema/floor-plans.ts:181`), so one column holds it; its index, not-self CHECK and
two keys become an index, a not-self CHECK and one self FK. Every key stays `ON DELETE NO ACTION`.
Classification `state`, set `core`. Rows: about 40–50.

The configuration import can fill the column: it moves key checks to commit
(`packages/provisioning/src/configuration-transfer.ts:689`) and maps every id before it writes a row
(`:706-710`), so the order rows arrive in does not matter. Read, not run.

### 1.3 `dining_tables` — one live table and its state today (kept, takes in today's state, split and merge)

Absorbs `floor_today_tables`, `floor_today_split_parts` and `floor_today_join_tables` (owner,
2026-11-04). Each is at most one row per live table: `floor_today_tables_table_key`,
`floor_today_split_parts_part_key`, `floor_today_join_tables_table_key`
(`packages/db/src/schema/floor-plans.ts`).

| group | column | type | key / null | from |
| --- | --- | --- | --- | --- |
| identity | id | id | PK | dining_tables |
| | zone_id | id | not null, FK `floor_zones` | dining_tables |
| | created_at | tsString | not null | dining_tables |
| | plan_table_id | id | null = the design no longer holds it; FK `floor_plan_tables` | dining_tables |
| live | label | label | not null | dining_tables |
| | short_name | label | null | dining_tables |
| | short_name_key | label | null | dining_tables |
| | needs_clearing_since | tsString | null | dining_tables |
| today (today's map) | on_floor | flag | not null, default 0 (was: a `floor_today_tables` row exists) | — |
| | today_seats | count | null | floor_today_tables.seats |
| | today_fixed | flag | not null, default 0 | floor_today_tables.fixed |
| | today_x, today_y, today_width, today_height, today_shape, today_rotation | smallCount ×4, enum, smallCount | null (all six or none = an unplaced spare) | floor_today_tables |
| | taken_off | flag | not null, default 0 | floor_today_tables |
| | today_name | label | null = saved name | floor_today_tables.name |
| split | split_from_table_id | id | null, self FK | floor_today_split_parts.joined_table_id |
| merge | merge_id | id | null, FK `table_merges` | floor_today_join_tables.join_id |
| | merge_before_x, merge_before_y, merge_before_rotation | smallCount | null (with merge_id) | floor_today_join_tables |

Protections: unique `label` (was `dining_tables_location_label_key`); unique `short_name_key` (was
`dining_tables_location_short_name_key_uq`); FK `zone_id`; FK `plan_table_id`; FK `merge_id`; the self
FK with its not-self CHECK and index (were `floor_today_split_parts`' two FKs, not-self CHECK and
`_joined_idx`); the seats CHECK (0–999) on `today_seats`; the placement CHECKs (x, y 0–999; width,
height 1–99; rotation a multiple of 15 from 0 to 345; shape enum; all six or none) on the `today_*`
group; the `merge_before_*` range CHECKs. Classification `state`, not append-only, set `core`. Rows:
about 40–50.

Two new CHECKs this layout makes possible:

- `merge_before_*` set exactly when `merge_id` is set. All three are not null today.
- `on_floor` = 0 ⇒ every `today_*` null, `today_fixed` and `taken_off` 0, `merge_id` null. The only
  two writers that delete a `floor_today_tables` row leave any merge first
  (`apps/server/src/floor-today-store.ts:845-848`, `apps/server/src/table-removal.ts:91-92`).
  `split_from_table_id` is deliberately outside this CHECK: `hideTable` removes the today row and does
  not touch a split row, so a hidden table can still name its joined table.

`deleteWithItsSplit` (`apps/server/src/table-removal.ts:111-130`) deletes the split rows naming a table when its delete
is refused. In the target it clears `split_from_table_id` on the rows that name the table.

Every incoming FK keeps `ON DELETE NO ACTION`: the removal path depends on it (`conventions-data.md`,
"Cascading here would allow removal to discard the records the release and refusal paths must
handle"). The configuration export adds every `today_*`, `on_floor`, `taken_off`,
`split_from_table_id` and `merge_*` column to `dining_tables`' `omit` list
(`packages/db/src/configuration-transfer.ts:79`).

### 1.4 `floor_reset_tables` — the zone's copy of the plan, as its last reset took it (kept, takes in `floor_reset_table_parts`)

One row per live table in the zone at that reset, plus one per table still to be made (`table_id`
null). It stays its own table (owner, 2026-11-04): `resetZoneFor` deletes the zone's rows and writes a
fresh batch (`floor-today-store.ts:241-270`), so its rows have their own lifetime, and a row for a
table still to be made has no live row to sit on.

| column | type | key / null | from |
| --- | --- | --- | --- |
| id | id | PK | floor_reset_tables |
| zone_id | id | not null, FK `floor_zones` | floor_reset_tables |
| table_id | id | null = still to be made; unique; FK `dining_tables` | floor_reset_tables |
| plan_table_id | id | null; FK `floor_plan_tables` | floor_reset_tables |
| label | label | not null | floor_reset_tables |
| short_name | label | null | floor_reset_tables |
| seats | count | null | floor_reset_tables |
| fixed | flag | not null, default 0 | floor_reset_tables |
| x, y, width, height, shape, rotation | smallCount ×4, enum, smallCount | null (all six or none) | floor_reset_tables |
| remove, pending, placed, ready_to_move, taken_off | flag | not null, default 0 | floor_reset_tables |
| part_of_reset_table_id | id | null; self FK | floor_reset_table_parts.joined_reset_table_id |

Protections: unique `table_id`, zone FK, table FK, plan-table FK, index `(zone_id, pending)`, seats
CHECK and the placement CHECKs, all kept. `floor_reset_table_parts` is unique on the part
(`floor_reset_table_parts_part_key`), so one column holds it, and its index, not-self CHECK and two
keys become an index, a not-self CHECK and one self FK, `ON DELETE NO ACTION`. Classification `state`,
set `core`. Rows: one per live or planned table, about 40–50; replaced at each reset.

**The self key survives the reset's delete.** Tested 4 November 2026 on `node:sqlite`, Node 26.13, on
a two-column stand-in with foreign keys on: deleting all of a zone's rows in one statement succeeds,
and the control, deleting only a joined row while its parts name it, is refused. The same script
shows one difference from today: a part row can now be deleted alone, which the link table refuses.
That is harmless here. The only rows deleted singly are those of removed tables
(`apps/server/src/table-removal.ts:93-96`), a removal row has no design table (`apps/server/src/floor-reset-plan.ts:263-272`), and
`copyParts` links only rows that have one (`floor-today-store.ts:308`).

**A finished row stays until the next reset, and the table keeps its name.** The review of 4 November asked
whether a row could be deleted once it finishes (`pending` false), which would make this table a plain
to-do list. It cannot. Every use of the two tables in `apps/` and `packages/` was found by grep, and
each one with no `pending` condition was read. These reads see finished rows all day, not only while
a reset runs:

- `backToSaved` puts a table back from its row, with no `pending` condition, and refuses
  `table.not_on_today_plan` when there is no row (`floor-today-store.ts:1302-1309`). This is the
  till's "Back to saved place".
- `partsOf` lists a joined table's parts from these rows (`apps/server/src/floor-today-parts.ts:37-94`).
  Splitting, merging and resetting a joined table all start from it
  (`floor-today-split.ts:28`, `floor-today-merges.ts:184`, `floor-today-reset-table.ts:42`).
- `resetTable` and the group split read the joined table's own row, and answer from its saved place
  and seats (`floor-today-reset-table.ts:46-48`, `floor-today-split-group.ts:155-158`).
- `stillJoinedPart` names finished rows in its own SQL: `part_row.pending = 0`
  (`packages/db/src/joined-parts.ts:34`). `joinedTableApart` and `readTodayTables` rest on the same
  rows (`joined-parts.ts:64-76`, `apps/server/src/working-order.ts:9046-9059`).
- `layoutPlacesIn` reads each table's place in the layout with no `pending` condition
  (`floor-today-store.ts:1031-1049`), and `savedPart` reads the copy to decide which tables are saved
  parts (`joined-parts.ts:147-179`).

So this is the day's saved plan as well as a list of work to finish. Nothing is proposed here. Read,
not run.

### 1.5 `floor_plan_sets` — a named group of layouts for one department (summer, winter …)

Absorbs `department_floor_plan_sets` (venue-and-box area; primary key `set_id`, one row per set,
`packages/venue-service/src/schema/floor-plan-sets.ts`). After A1301 removes `location_id`, the core
row would hold nothing but its id.

| column | type | key / null |
| --- | --- | --- |
| id | id | PK |
| department_id | id | not null, FK `departments` |
| name | label | not null |
| is_default | flag | not null, default 0 |

Protections: unique `(department_id, name)`; unique partial index on `department_id` where
`is_default` (one default per department); CHECK `trim(name) <> ''`; FK `department_id`. Classification
`state`, set `core`. Rows: 1–3. `is_default` is the R4 shape already (a flag on the row, not an id in
a document).

### 1.6 `floor_plans` — one set's layout of one zone (kept)

`id` PK, `zone_id` FK `floor_zones`, `set_id` FK `floor_plan_sets`, `revision` count not null default
0, `saved_at` tsString not null. Unique `(set_id, zone_id)`. `state`, `core`. Rows: zones × sets,
about 6–18. Kept because it is the thing a save's revision guards (`saveLayout`/`changedShared`,
`conventions-data.md` "A zone's floor plan") and what placements belong to.

### 1.7 `floor_plan_placements` — where one layout puts one design table, or the size it keeps while off

Absorbs `floor_plan_table_sizes`. The two never hold a row for the same layout and table at once: a
save that places a table deletes its kept size, and one that takes a table off writes its size
(`apps/server/src/floor-plan.ts:544-554`, `:597-604`); the layout read joins both (`layoutTables`,
`floor-plan.ts:111-156`).

| column | type | key / null |
| --- | --- | --- |
| id | id | PK |
| plan_id | id | not null, FK `floor_plans` |
| plan_table_id | id | not null, FK `floor_plan_tables` |
| x, y | smallCount | null = off this layout (size kept) |
| width, height | smallCount | not null |
| shape | enum rect/round | null with x |
| rotation | smallCount | null with x |

Protections: unique `(plan_id, plan_table_id)` (was both `floor_plan_placements_table_key` and
`floor_plan_table_sizes_plan_table_key`); width/height 1–99 CHECKs (both tables had them); x, y, shape,
rotation range CHECKs; x, y, shape, rotation all set or all null (narrowed from the six-column
placement CHECK because width and height are now always set). `state`, `core`. Rows: about 40–150.

### 1.8 `table_merges` — tables staff pushed together on the till today (renamed from `floor_today_joins`)

`id` PK, `zone_id` FK `floor_zones` (indexed), `seats` count not null CHECK ≥ 1, `name` label null.
Members are `dining_tables.merge_id`. `state`, `core`. Rows: 0–5 at a time. Kept as a table: it has
its own name and seat count and other rows point at it.

### 1.9 `parties` — one group of guests from seating to finish (kept, gains the allergy answer and the bill counter)

Current columns kept (`id`, `guest_count`, `state`, `opened_at`, `opened_by`, `closed_at`,
`closed_by`, `merged_into_party_id`, `bill_requested_at`, `name`, `revision`, `table_names`) plus:

| column | type | null | from |
| --- | --- | --- | --- |
| allergy_answer | enum none/allergies | null = not asked yet | party_allergy.answer |
| allergy_answered_by | id, FK `persons` | null | party_allergy.changed_by |
| allergy_answered_at | tsString | null | party_allergy.changed_at |
| last_bill_number | count | not null, default 0 | bill_number_allocations (`tables-ordersales.md` §4) |

`opened_by` and `closed_by` gain a key to `persons` too (README U1, U11).

Protections: existing `parties_merged_into_fk`, `parties_merged_into_idx`, `parties_state_ck`,
`parties_guest_count_ck`, `parties_closed_at_ck`, `parties_merged_into_ck`; plus the answer enum
CHECK, the three allergy columns all set or all null, and a trigger refusing any decrease of
`last_bill_number` (`tables-ordersales.md` §5).
`table_names` stays: it is written once at close, when `party_tables` rows are deleted
(`closePartyTables`, `apps/server/src/parties.ts:793-797`). `state`, `core`. Rows: about 200 a day,
about 72,000 a year; never deleted.

### 1.10 `party_tables` — which tables a party is at (kept)

Unchanged: `id`, `party_id` FK, `table_id` FK, `joined_at`, `left_at`. Protections kept: both FKs,
partial unique `party_tables_active_table_uq` (one open seating per table), `party_tables_party_idx`.
A link table with both sides checked (R7), and its `left_at` rows are read back while the party is
open ("used earlier by a party still open", `LiveTable.tied`, `floor-reset-plan.ts:37`); rows are
deleted at close (`apps/server/src/parties.ts:796`). Rows: 0–50 at a time.

### 1.11 `party_allergy_guests` — one allergic guest at a table (kept, re-pointed)

Columns unchanged (`id`, `party_id`, `position`, `who`, `allergens`, `note`). FK `party_id` now →
`parties.id` ON DELETE CASCADE (was → `party_allergy.party_id`). Protections kept: position, who,
allergens, note CHECKs. The old FK also meant "a guest exists only for a party with a recorded
answer"; a BEFORE INSERT/UPDATE trigger `party_allergy_guests_need_answer` (refuse unless
`parties.allergy_answer` is set) keeps that.

The old FK also cascaded. When a merge leaves a party with no answer, today's delete of the two
`party_allergy` rows takes their guests with it (`mergePartyAllergies`,
`packages/venue-service/src/party-allergy.ts:321-324`). Clearing three columns deletes nothing, so that
path deletes the guests itself. Rows: about 7,000–18,000 a year.

### 1.12 `allergy_line_ticks` — which allergic guest a dish line is for (kept)

Unchanged, all protections kept (three cascading FKs, the two unique line keys, the exactly-one-target
CHECK). Kept as its own table rather than a column on the lines for a protection reason (R1): ticks
on sent lines change while the party is open (`setAllergyLineTicks`,
`packages/venue-service/src/party-allergy.ts:169-279`, which checks the party is open but not the
bill), and a bill of an open party can already be settled, whose lines the
`working_order_lines_require_open_parent_update` trigger freezes except for served quantity
(`packages/db/drizzle/0177_paid_line_service_group.sql`). Rows: about 10,000–36,000 a year.

### 1.13 `order_kitchen_notes` — the kitchen note on one bill or one party (kept exactly as it is today)

No change (owner, 2026-11-04): the same columns (`id`, `working_order_id`, `party_id`, `note`,
`revision`), both cascading FKs, both unique keys, the one-owner CHECK and the revision CHECK. The
party's note does not move to `parties`, and the freeze rule does not change.

It stays apart from `working_orders` for a protection reason: a bill's note can be edited after it is
settled, until it is collected (`apps/server/src/order-kitchen-note.ts:198-199` refuses only abandoned or
collected), while the `working_orders` transition trigger lets a settled bill change only
`collected_at` (`packages/db/drizzle/0198_recipient_identifier_guards.sql:117-134`). Rows: about
3,500–11,000 a year on bills, plus party notes.

### 1.14 `service_steps` and `service_step_completions` (kept)

`service_steps` (a department's timed reminders) unchanged: FKs to `departments` and
`kitchen_courses`, indexes, start enum, course and minutes CHECKs. Rows 0–10.
`service_step_completions`: typed history the till reads back (`readStepCompletions` via
`apps/server/src/service-step-signals.ts`); both FKs cascade, both indexes kept, and `done_by` gains a
key to `persons` (README U11). Rows 0, or about 110,000–290,000 a year when steps are used.

### 1.15 `kitchen_stations` — a preparation point (kept, gains today's closure and its printer list)

Current columns minus `location_id`, plus:

| column | type | null | from |
| --- | --- | --- | --- |
| closed_on_day | day | null = not closed by hand | station_day_states.business_day |
| closed_sends_to_station_id | id | null, FK `kitchen_stations` | station_day_states.sends_to_station_id |
| printer_ids | json list of printer ids | not null, default `[]` | station_printers (owner, 2026-11-04) |

`station_day_states.open` is dropped: every writer writes `false` (`setStationToday`,
`packages/venue-service/src/station-times.ts:56-68`; reopening deletes the row, `:44-54`), and the
reader asks only for closed rows (`routing-store.ts:412-419`). The writer also deletes the station's
rows for other days first (`packages/venue-service/src/station-times.ts:36-43`), so one pair of columns holds everything read.

**`printer_ids` replaces `station_printers`** under R4's exception for a short list owned by one row. With `page_printers` merged into `printers`, no key stops an office (A4) printer being chosen here, so the station save refuses one.
The table holds 2–4 rows in a whole venue. Almost every read starts from the station
(`printerMappings`, `apps/server/src/kitchen-print.ts:141-161`; `stationPrintersDownQuery`,
`apps/server/src/station-outputs-down.ts:49-83`). The searches by printer, which `json_each` answers
over 3–4 station rows, are `apps/server/src/print-job-trouble.ts:134-146`,
`apps/server/src/printer-delete.ts:124-128` and `:179`, and `apps/server/src/demo-printer.ts:49`.

- **A stale id cannot reach a printer, but it would block a save.** Both print reads join `printers`
  and filter on `active` or `deleted_at` (`kitchen-print.ts:154-159`, `station-outputs-down.ts:65`,
  `:71`). `replaceStationPrinters` refuses a deleted printer in the list it is sent
  (`apps/server/src/station-printers.ts:62`), so a deleted printer left on a list would make that
  station unsaveable from the screen. `deletePrinter` taking the id out of every list prevents it, and
  nothing in the database backs that up. A printer's row stays with `deleted_at` set
  (`printer-delete.ts:181-184`), so the old foreign key never fired on a delete either.
- **What moves to code:** refusing an unknown printer, which `attachPrinterToStation` already does
  (`apps/server/src/station-printers.ts:31-36`), and refusing a duplicate, which today's primary key
  does.
- **What the import must learn:** it rewrites an id only when a whole value equals one, never ids
  inside a list (`scripts/id-columns-are-references.test.ts:24-25`). The devices area's lists need
  the same change (`tables-devices.md`).

Protections: `kitchen_stations_name_key` (now `name` where active), `kitchen_stations_default_key`
(one default station, venue-wide), `kitchen_stations_thresholds_ordered`; plus the not-self CHECK of
`station_day_states_sends_to_not_self_ck`, "sends-to only while closed", and a CHECK that
`printer_ids` is a JSON array. Export `omit` adds the two closure columns (as `station_day_states` is
left out today); `printer_ids` travels, as `station_printers` does. The many per-station switches stay
columns: each station is a row with its own identity (R3). Rows: 3–4.

### 1.16 `kitchen_courses` (kept)

`kitchen_courses` loses `location_id`; `kitchen_courses_name_key` becomes `name` where active. Rows 3–5.

### 1.17 `ticket_items` — the kitchen's copy of each sent dish line (kept, gains the allergy snapshot)

Kept separate from `working_order_lines` for a protection reason: its state advances after the bill
is settled ("a settled order still has its lines cooked", `packages/db/src/schema/ticket-items.ts`),
which the lines' freeze trigger would refuse (0177, above). Changes:

| change | why |
| --- | --- |
| + `allergy_frozen` flag not null default 0, `allergy_original` json null, `allergy_current` json null | from `ticket_item_allergies` (PK `ticket_item_id`, one row per item; "row presence also freezes an unticked dish", `packages/venue-service/src/schema/kitchen-allergy.ts`) |
| − `working_order_id` (proposed, after §8 item 1) | a copy of `working_order_lines.working_order_id`, no FK ("Denormalised grouping key", schema comment) |

Protections: `ticket_items_working_order_line_id_key` (one per line, the double-fire guard),
`ticket_items_queue_idx`, `ticket_items_course_idx`, `ticket_items_waiting_idx`,
`ticket_items_state_ck`, FKs line (cascade), station, course; `ticket_items_order_idx` goes only if
`working_order_id` goes. The two allergy block CHECKs (`kitchenAllergyBlockCheck`) move onto
`allergy_original`/`allergy_current`, plus `allergy_frozen` = 0 ⇒ both null. Classification stays
`ledger`, not append-only. Rows: about 1,000 a day, 360,000 a year (no housekeeping deletes them).
The A773-2 columns `requested_at` and `pass_controlled` stay
(`packages/db/src/schema/ticket-items.ts:65-66`).

`node_id` stays for now. Its only reader is the overdue report's filter
(`packages/reporting/src/overdue-orders.ts:61`; `git grep -n "ticketItems\.nodeId" -- apps packages`
outside tests finds only that line). It stays until §8 item 8 has checked what that report does with a
ticket written before a takeover.

### 1.18 `ticket_item_moves` (kept — typed history)

Read back by product code to find the latest mover (`station-move.ts`, `station-queue-moves.ts`,
`working-order.ts`; ordering by `rowid`, `conventions-data.md` "Latest station move follows insertion
order"), so it cannot go to `activity_log`, which product logic never reads (README §3). It stays a
table, not columns on `ticket_items`: the station screen uses only the latest move
(`apps/server/src/station-queue-moves.ts:14-37`), but when a ticket splits,
`apps/server/src/working-order.ts:5105-5116` copies every move of the line to the new line. Actor CHECK,
four FKs, line index kept; `moved_by_person_id` gains a key to `persons` (README U11). Rows 0–3,600 a
year.

### 1.19 `kitchen_print_jobs` and `kitchen_print_job_lines` (kept)

Both are link tables between `print_jobs` and bills/lines with both sides checked (R7). The bill link
is not a column of `print_jobs`: one job can carry several stations (`linkKitchenJob` inserts one row
per station, `apps/server/src/kitchen-print.ts:869-880`) and several bills, and a copied link has its
own `reprint` and position (`writeLinksAfter`, `:2241-2272`; the reader just above it orders a
bill's links by `rowid`, `:2225`). All FKs, unique keys and indexes kept. Rows: 180,000–270,000 and 250,000–360,000 a year where stations
print; zero with screens only.

### 1.20 `kitchen_notices` (kept)

Unchanged, with all ten CHECKs, both FKs and the partial open index. It has its own identity, is a
list a cook acknowledges, and its copied dish fields are facts fixed when written (a void deletes the
line). Rows 7,000–30,000 a year.

### 1.21 `routing_cells` and `routing_cell_periods` (kept)

`routing_cells` loses `location_id`; its seven partial unique indexes lose that column and keep their
WHERE clauses; four CHECKs and the category (cascade), product, zone and station FKs kept. Rows 10–40.
`routing_cell_periods` is a many-per-cell child, not one-per-parent, so it stays; proposed: drop
`department_id`, a copy of `menu_periods.department_id`, and replace the composite FK with FK
`period_id` → `menu_periods` ON DELETE CASCADE (the zone-move clean-up at
`packages/venue-service/src/operations.ts:407-420` then joins `menu_periods`). Target CHECK and
`(cell_id, period_id)` unique kept. Rows 0–40.

### 1.22 `bookings` (kept, own set)

Loses `location_id` (A1301 S20, the design's slice table,
`docs/superpowers/specs/2026-11-01-a1301-remove-location-design.md`, S20 row; no plan for S20–S28 exists
yet); `bookings_location_date_idx` becomes an index on `booking_date`. The A1301 plan records the
same index change, and why the day list keeps its location condition until then: S9a measured the
read falling back to a scan without it (`docs/superpowers/plans/2026-11-01-a1301-remove-location.md:499-505`).
`table_label` stays (written when the table is removed, `packages/bookings/src/table-removal.ts`).
FKs to `dining_tables` and `working_orders`, the status/date index, party-size and status CHECKs kept;
`created_by` gains a key to `persons` (README U11).
Set `bookings` (toggleable module). Rows 7,000–14,000 a year.

---

## 2. Settings documents

**None.** Every value that configures behaviour in this area belongs to a row with its own identity
that people see as a list and other rows point at — a station (thresholds, colour, bump mode, waits
for the pass), a course, a zone (its four sale-rule overrides), a routing rule, a service step — so
under R3 they stay columns of those rows. The two "choose one row" settings are already flags on
real rows (R4): the default station (`kitchen_stations.is_default`) and the counter-default zone
(`floor_zones.is_counter_default`), each guarded by a partial unique index.

## 3. History

Typed history tables that remain, because product code reads them back:

- `ticket_item_moves` — latest mover (`station-move.ts`, `station-queue-moves.ts`, `working-order.ts`).
- `service_step_completions` — the till's "step due" signal (`service-step-signals.ts`).
- `kitchen_notices` — open notices on station screens (`listStationNotices`); acknowledged rows stay.
- `party_tables` — earlier tables of an open party (deleted at close).

Allergy answers, station closures and keep-open go to `activity_log` (owner, 2026-11-04). Today none
of these keep a history or, for closures and keep-open, a person (`docs/backlog/service-periods.md`
"Who authorised today's station or zone change"), and folding the day tables into columns would
otherwise overwrite the old values with no trace. These rows are for people to read: product logic
keeps reading the columns, and never decides anything from them (README §3).

| kind | subject | data | replaces |
| --- | --- | --- | --- |
| `party.allergy_answered` | party | `{answer, guestCount}` | today only the last answerer is kept (`party_allergy.changed_by`) |
| `station.closed_for_day`, `station.reopened` | station | `{businessDay, sendsTo}` | `station_day_states` keeps no person and no past days |
| `zone.kept_open`, `zone.keep_open_ended` | zone | `{businessDay, from, until}` | `zone_extensions` keeps no person and no past days |

`party.allergy_answered` carries a count, never a guest's label or allergens: `activity_log` is
append-only, so a guest's health details stay out of it.

## 4. Mapping

| current | fate | why |
| --- | --- | --- |
| dining_tables | keep (absorbs three tables) | the live table |
| floor_plan_tables | keep (absorbs floor_plan_table_parts) | the design; it can exist before its live table and outlive it (owner, 2026-11-04) |
| floor_plan_table_parts | merge into floor_plan_tables.part_of_table_id | unique on the part: one parent per part |
| floor_reset_tables | keep (absorbs floor_reset_table_parts) | rewritten at every reset; holds tables still to be made (owner, 2026-11-04) |
| floor_reset_table_parts | merge into floor_reset_tables.part_of_reset_table_id | unique on the part |
| floor_today_tables | merge into dining_tables (`today_*`, `on_floor`, `taken_off`) | unique on table |
| floor_today_split_parts | merge into dining_tables.split_from_table_id | unique on the part |
| floor_today_join_tables | merge into dining_tables (`merge_id`, `merge_before_*`) | unique on table |
| floor_today_joins | rename to table_merges | its own identity, name and seats |
| floor_today_zones | merge into floor_zones (`today_*`) | unique on zone |
| floor_plan_sets | keep (absorbs department_floor_plan_sets) | after A1301 it would be an id alone |
| department_floor_plan_sets | merge into floor_plan_sets | primary key `set_id`: one row per set |
| floor_plans | keep | the layout a revision guards |
| floor_plan_placements | keep (absorbs floor_plan_table_sizes) | same key (layout, table) |
| floor_plan_table_sizes | merge into floor_plan_placements | never coexists with a placement row |
| floor_zones | keep (absorbs four tables) | the zone |
| zone_service_policies | merge into floor_zones | PK zone_id; every zone gets one at creation (§1.1) |
| zone_sale_policies | merge into floor_zones | PK zone_id; null columns already mean "follow the department" |
| zone_extensions | merge into floor_zones (`kept_open_*`) | one live row per zone; other days deleted by the writer |
| parties | keep (absorbs party_allergy) | the party |
| party_tables | keep | link table, read back while open |
| party_allergy | merge into parties (`allergy_*`) | PK party_id |
| party_allergy_guests | keep | many per party; ticks point at them |
| allergy_line_ticks | keep | settled lines are frozen; ticks still change |
| order_kitchen_notes | keep, unchanged (owner, 2026-11-04) | settled bills are frozen; the note still changes |
| service_steps | keep | a list per department |
| service_step_completions | keep | typed history read by the till |
| kitchen_stations | keep (absorbs station_day_states, station_printers) | the station |
| station_day_states | merge into kitchen_stations (`closed_*`) | one live row per station; `open` always false |
| station_printers | merge into kitchen_stations.printer_ids | a short list owned by one station (owner, 2026-11-04) |
| kitchen_courses | keep | the course |
| ticket_items | keep (absorbs ticket_item_allergies) | kitchen state outlives the frozen line |
| ticket_item_allergies | merge into ticket_items (`allergy_*`) | PK ticket_item_id |
| ticket_item_moves | keep | typed history read back |
| kitchen_print_jobs | keep | link with per-link facts |
| kitchen_print_job_lines | keep | link table |
| kitchen_notices | keep | own identity, acknowledged list |
| routing_cells | keep | the routing rule |
| routing_cell_periods | keep | many per rule |
| bookings | keep | the reservation (own module) |

## 5. Protections

Append-only triggers: none in this area (no table here is `appendOnly(...)` in
`packages/db/src/classification.ts`, `packages/venue-service/src/classification.ts` or
`packages/bookings/src/classification.ts`). Behavioural triggers: none currently installed on these
tables; the three that named them were dropped (`working_orders_clear_table_status` in core 0020,
`parties_clear_table_status` in 0180, the two `working_orders_release_main_bill*` in 0201) — read from
the migration files, not measured on a migrated database (§8 item 4).

| current protection | home |
| --- | --- |
| `dining_tables_location_label_key` | unique `dining_tables(label)` |
| `dining_tables_location_short_name_key_uq` | unique `dining_tables(short_name_key)` |
| `dining_tables_location_fk`, `floor_plan_sets_location_fk`, `floor_zones` / `kitchen_stations` / `kitchen_courses` / `zone_service_policies` / `routing_cells` / `bookings` location FKs | dropped: A1301 removes `locations` (R10) |
| `dining_tables_zone_fk` | kept |
| `dining_tables.plan_table_id` FK, `floor_reset_tables.plan_table_id` FK | kept |
| `floor_plans_set_zone_key`, `floor_plans_zone_fk`, `floor_plans_set_fk` | kept |
| `floor_plan_tables_zone_label_key`, `floor_plan_tables_zone_fk`, `floor_plan_tables_seats_ck` | kept |
| `floor_reset_tables_seats_ck` | kept |
| `floor_today_tables_seats_ck` | seats CHECK on `dining_tables.today_seats` |
| `floor_plan_placements_table_key`, `floor_plan_table_sizes_plan_table_key` | unique `floor_plan_placements(plan_id, plan_table_id)` |
| placements' plan and table FKs; sizes' plan and table FKs | placements' FKs |
| placements' x/y/width/height/rotation/shape CHECKs; sizes' width/height CHECKs | placements CHECKs |
| `floor_plan_placements_placement_ck` (all six or none) | x, y, shape, rotation all-or-none (width and height are now always set) |
| `floor_plan_table_parts_part_key`, `floor_reset_table_parts_part_key`, `floor_today_split_parts_part_key` | implicit: one column per row |
| the three parts tables' `*_joined_idx` | indexes on `part_of_table_id`, `part_of_reset_table_id`, `split_from_table_id` |
| the three parts tables' `*_not_self_ck` | not-self CHECKs on the same three columns |
| the three parts tables' two FKs each | one self FK each (NO ACTION, as now); a part row alone can now be deleted, §1.4 |
| `floor_reset_tables_table_key`, `floor_reset_tables_zone_pending_idx`, `floor_reset_tables_zone_fk`, `floor_reset_tables_table_fk` | kept |
| `floor_today_tables_table_key`, `floor_today_join_tables_table_key` | implicit: same row |
| `floor_today_tables_table_fk`, `floor_today_join_tables_table_fk` | implicit: same row |
| reset placement CHECKs (x, y, width, height, rotation, shape, all-or-none) | kept |
| today placement CHECKs (the same seven) | same CHECKs on `dining_tables.today_*` |
| `floor_today_join_tables_join_fk` | FK `dining_tables.merge_id` |
| `floor_today_join_tables_before_x/_y/_rotation_ck` | same CHECKs on `merge_before_*` |
| `floor_today_joins_zone_idx`, `_zone_fk`, `_seats_ck` | kept on `table_merges` |
| `floor_today_zones_zone_key`, `_zone_fk` | implicit: same row as the zone |
| `floor_today_zones_set_fk` | FK `floor_zones.today_set_id` |
| `parties_*` (FK, index, four CHECKs) | kept |
| `party_tables_*` (two FKs, partial unique, index) | kept |
| `floor_zones_name_key` | unique `floor_zones(name)` where active |
| `zone_service_policies_pk`, `_zone_fk` | implicit |
| `zone_service_policies_department_fk` | FK `floor_zones.department_id` |
| `zone_service_policies_one_counter_default_key` | partial unique on `floor_zones.is_counter_default`, where `active` |
| `zone_sale_policies_zone_fk`, four enum CHECKs | implicit; CHECKs on `floor_zones` |
| `zone_extensions_zone_fk`, `_day_key` | implicit (one per zone) |
| `zone_extensions_step_ck` | quarter-hour CHECK on `kept_open_from`, `kept_open_until` |
| `kitchen_stations_name_key`, `_default_key`, `_thresholds_ordered` | kept, without location |
| `station_day_states_station_fk`, `_day_key` | implicit (one per station) |
| `station_day_states_sends_to_fk`, `_sends_to_not_self_ck` | self FK and not-self CHECK on `kitchen_stations` |
| `kitchen_courses_name_key` | kept, without location |
| `ticket_items_*` (unique line key, four indexes, state CHECK, three FKs) | kept; `ticket_items_order_idx` goes only with its column (§8 item 1) |
| `ticket_item_allergies_ticket_fk` (cascade), `_original_ck`, `_current_ck` | implicit; the two CHECKs on `ticket_items.allergy_*` |
| `kitchen_print_jobs_*`, `kitchen_print_job_lines_*` | kept |
| `station_printers_pk` | moved to code: no duplicates in `kitchen_stations.printer_ids`, plus a CHECK that it is a JSON array |
| `station_printers`' two FKs | moved to code: `attachPrinterToStation` refuses an unknown printer; the list lives on the station (§1.15) |
| `ticket_item_moves_*` | kept |
| `kitchen_notices_*` (two FKs, partial index, ten CHECKs) | kept |
| `routing_cells_*` (four FKs, four CHECKs, seven partial uniques) | kept, without location |
| `routing_cell_periods_period_fk` (composite with department) | FK `period_id` → `menu_periods` cascade (department copy dropped) |
| `routing_cell_periods_cell_fk`, `_station_fk`, `_target_ck`, `_cell_period_key` | kept |
| `order_kitchen_notes_*` (two FKs, two unique keys, owner CHECK, revision CHECK) | all kept, unchanged |
| `party_allergy` PK/FK (cascade), `party_allergy_answer_ck` | implicit; CHECK on `parties.allergy_answer` |
| `party_allergy_guests_party_fk` (→ answer row) | FK → `parties` (cascade), plus trigger `party_allergy_guests_need_answer`; the merge deletes guests itself (§1.11) |
| `party_allergy_guests_position/who/allergens/note_ck` | kept |
| `allergy_line_ticks_*` | kept |
| `service_steps_*`, `service_step_completions_*` | kept |
| `bookings_location_date_idx` | index `bookings(booking_date)` |
| `bookings_table_fk`, `_tab_fk`, `_table_status_date_time_idx`, `_party_size_ck`, `_status_ck` | kept |
| Configuration export leaving out `station_day_states`, `zone_extensions`, `needs_clearing_since`, `short_name_key` | `omit` lists on `kitchen_stations`, `floor_zones`, `dining_tables` (also omit every `today_*`, `on_floor`, `taken_off`, `split_from_table_id`, `merge_*`) |

## 6. Duplicates removed

| same thing stored more than once | one home |
| --- | --- |
| a set's existence (`floor_plan_sets`) and its name/department/default (`department_floor_plan_sets`) | `floor_plan_sets` |
| a zone's department in `zone_service_policies` beside the zone | `floor_zones.department_id` |
| `zone_service_policies.location_id`, and every other `location_id` here | gone (A1301) |
| `ticket_items.working_order_id`, a copy of the line's bill | proposed: read through the line (§8 item 1) |
| `routing_cell_periods.department_id`, a copy of the period's department | `menu_periods.department_id` |
| `station_day_states.open`, always false | gone |

Kept on purpose, with the reason:

- The table's name, short name, seats, "fixed" and place in three tables (`floor_plan_tables`,
  `floor_reset_tables`, `dining_tables`), and `zone_id` on all three. They are three states, not
  copies: a dashboard save changes the design without rearranging the floor ("Saving a layout does
  not rearrange tables during service: only a reset does", `conventions-data.md`), the reset copy
  keeps "a later save from changing what a reset is still applying" (same section), and the live and
  today values change only when the reset is applied to a free table. The `plan_table_id` pointers
  stay for the same reason. More than one live table can follow one design table, a case `copyParts`
  handles (`floor-today-store.ts:295-320`).
- `short_name_key`, a folded copy of `short_name`: the venue-wide uniqueness check needs the folded
  value in an index, and the fold (`shortNameKey`, `@waitron/shared`) is JavaScript, which an
  expression index cannot call. Written only through `shortNameColumns`; nothing in the database ties
  it to `short_name` (`conventions-data.md`).
- `parties.table_names`, `bookings.table_label`, `kitchen_notices` dish fields, the
  `ticket_items.allergy_original` snapshot: facts fixed when written; their sources are deleted or
  change later.

## 7. Depends on other areas

- **Venue and box:** `departments` (FKs from `floor_zones.department_id`, `floor_plan_sets.department_id`,
  `service_steps.department_id`); `department_floor_plan_sets` is absorbed here, so that area drops it;
  `opening_hours.zone_id` (`tables-venuebox.md` §1.14) points at `floor_zones.id` (§1.1 says why its
  cascade no longer does the delete); `locations` goes (A1301); `nodes` (`ticket_items.node_id`).
- **Menu:** `menu_periods` (FK from `routing_cell_periods`; `menu_periods.floor_plan_set_id` points at
  `floor_plan_sets`); `categories`, `products` (FKs from `routing_cells`).
- **Orders and sales:** `working_orders` (FKs from `kitchen_print_jobs`, `kitchen_notices`,
  `order_kitchen_notes`, `bookings.tab_id`; it points at `dining_tables` through `delivery_table_id` and
  at `parties`), `working_order_lines` (FKs from `ticket_items`, `ticket_item_moves`,
  `kitchen_print_job_lines`, `allergy_line_ticks`), `order_draft_lines` (`allergy_line_ticks`),
  `order_drafts`/`order_groups`/`unpaid_departures` (→ `parties`), `order_group_hold_stations` and the
  line/draft station and course columns (→ `kitchen_stations`, `kitchen_courses`),
  `working_orders.zone_id` (→ `floor_zones`). `parties.last_bill_number` is that area's counter. This
  design relies on the line freeze trigger and the settled-bill branch of the bill trigger still
  refusing these columns (they decide §1.12, §1.13, §1.17). `tables-ordersales.md`'s exception for
  `party_id`, `bill_number` and `bill_name` does not change that.
- **Devices:** `print_jobs` (`kitchen_print_jobs`), `printers` (`kitchen_print_jobs`, and the ids in
  `kitchen_stations.printer_ids`), `devices` (`ticket_item_moves.moved_by_device_id`). The owner's
  device and profile lists become JSON lists (`tables-devices.md`), so a zone or station id held in
  one of them has no key. Zones and stations are soft-deleted, so those keys never fired on a delete,
  and the delete flows clear each list as they clear the rows today
  (`service-delete-settings.ts:378-398`).
- **People:** every person id here gains a key to `persons` (`opened_by`, `closed_by`,
  `allergy_answered_by`, `done_by`, `created_by`, `moved_by_person_id`), because identity's tables fold
  into core (README U1, U11). Writers pass the signed-in operator (`apps/server/src/parties.ts:278`, `:782`,
  `packages/venue-service/src/party-allergy.ts:154`, `service-step-done.ts:53`, `station-move.ts:482`, `bookings/src/routes.ts:161`);
  read, not traced to every caller.
- **Workforce:** staffing's tables point at `kitchen_stations`
  (`packages/staffing/src/schema/staffing.ts:82`, `:169`). Staffing folds into the `workforce` set
  (README U1), which can see core.
- **In-flight work:** A1301 is removing `location_id` from every table here, in its schema slices
  S20–S28, still to be planned.

## 8. Measure before building

1. **Dropping `ticket_items.working_order_id`.** 57 non-test reads name it
   (`git grep -n -E 'ticketItems\.workingOrderId' -- apps packages | grep -v test | wc -l`, on main
   `e0da0ad18a`).
   Time the station screen, pass board, pass release, print-problem and overdue reads on a database with 360,000
   ticket items and 360,000 lines, with and without the column (join through `working_order_lines`).
   Failing result: the join version is noticeably slower on the reference box (for example the p95 of
   the station queue read more than doubles, or exceeds 50 ms). Then keep the column, and add a
   CHECK-by-trigger that it equals the line's bill so the two copies cannot drift.
2. **The folded tables keep behaviour.** The floor's suites (`apps/server/src/floor-*.test.ts`,
   `floor-catch-up.test.ts`, `floor-reset-plan.test.ts`, `table-removal`, bookings' floor tests) must
   pass with their assertions unchanged; only setup may change. Failing result: any assertion that has
   to be rewritten to pass means behaviour moved; stop, and keep that side table separate.
3. **The incoming foreign keys.** Re-run the `pragma_foreign_key_list` measurement the conventions
   doc records (2026-10-11 and 2026-10-18) on the target; every key into `dining_tables` and
   `floor_plan_tables` must still be `ON DELETE NO ACTION`. Failing result: any cascade.
4. **No unexpected trigger names these tables.** On a fully migrated database, list `sqlite_master`
   triggers whose SQL names any target table. Expected: none, except the new
   `party_allergy_guests_need_answer` and the no-decrease trigger on `parties.last_bill_number`.
5. **The allergy tick stays a table for a real reason.** Run it: tick an allergic guest on a line of a
   settled bill in an open party. Today it succeeds; with the tick as a line column, 0177 should
   refuse it. If it is not refused, the table can fold.
6. **Export round trip.** Configuration export and import with a zone kept open, a station closed for
   the day and a reset in progress: the bundle must carry none of the `today_*`, `kept_open_*` or
   `closed_*` columns, no `floor_reset_tables` row, and `printer_ids` must arrive naming the importing
   venue's printers. Failing result: any of those, or a printer id from the exporting venue.
7. **Today's state waking other screens.** A till's table move writes `dining_tables` once today's
   state lives there, and the dashboard reads listening on `dining_tables` then wake on every move
   (`apps/dashboard/src/api/live-queries.ts`). Count the refreshes of a read that does not show today's
   state while a till moves tables. Failing result: a read that shows no today's state reloads on
   every move and costs more than noise; then give the change feed a narrower type for it.

8. **The overdue report after a takeover.** Write a ticket under another box's `node_id`, as a ticket
   sent before a takeover would be, and ask this box for the report. By reading the filter, the ticket
   should be left out. If it is, and the dish is still waiting after the takeover, the filter hides a late
   dish; the filter and `ticket_items.node_id` then go, with its key to `nodes`. Until this is run, the
   column stays.

## 9. Decisions for the owner

The owner has settled everything in this area on 4 November: three floor tables, not one; the party's
kitchen note stays where it is; allergy, closure and keep-open history goes to `activity_log`;
`station_printers` becomes a list on the station. `ticket_items.node_id` stays until §8 item 8 is done,
and `ticket_item_moves` stays a table. No question is open in this area.
