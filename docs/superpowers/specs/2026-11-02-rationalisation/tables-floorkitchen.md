> Appendix to [README.md](README.md), the rationalisation design of 2 November 2026: one researcher's proposal for this area, written to the shared rules. Where README.md §5 decides differently, README.md wins.

# Floor, parties, bookings and kitchen — proposed tables

Area: the floor plan, tables, parties and bookings, the kitchen (stations, courses, tickets,
kitchen notices, routing, allergies, service steps), the zone policy side tables and the allergy
tables. Researched read-only on `main` at `64eeabb036` (2 November 2026). Nothing was run except
`grep`/`sed` over the source; every "the code does X" below was read, not executed, unless it says
otherwise. Section 8 lists what must be run before building.

**Result: 40 current tables → 24 target tables** (plus one table from the venue-and-box area,
`department_floor_plan_sets`, absorbed into `floor_plan_sets`).

The big move is the floor. Today one physical table is stored across up to seven tables: its design
(`floor_plan_tables`), which joined table it is part of in the design (`floor_plan_table_parts`), the
copy the zone's last reset took (`floor_reset_tables`, `floor_reset_table_parts`), the live table
(`dining_tables`), its state on today's map (`floor_today_tables`), and whether it is split off or in
a merge today (`floor_today_split_parts`, `floor_today_join_tables`). Every one of those is at most one
row per physical table (each carries a unique key on the table: `floor_plan_table_parts_part_key`,
`floor_reset_tables_table_key`, `floor_reset_table_parts_part_key`, `floor_today_tables_table_key`,
`floor_today_split_parts_part_key`, `floor_today_join_tables_table_key`,
`packages/db/src/schema/floor-plans.ts`), so under rule R1 they fold into the one row, as four named
groups of columns: **plan**, **reset**, **today**, plus the live name. The three groups are not
duplicates: they hold different values on purpose while a change waits (see §6).

---

## 1. Target tables

Types use the house column vocabulary (`packages/db/src/schema/columns.ts`): `id`, `label`, `flag`,
`count`, `smallCount`, `tsString`, `day`, `timeOfDay`, `json`, `quantity`. Reference venue: one
restaurant, 250 bills a day × 4 lines, 360 days a year. "Set" means migration set; see decision D2
for why everything below sits in `core` except `bookings`.

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
partial index on `is_counter_default` where true (was `zone_service_policies_one_counter_default_key`);
FK `department_id`; FK `today_set_id`; the four enum CHECKs; `kept_open_*` all set or all null, and
the quarter-hour CHECK of `zone_extensions_step_ck` on both times. Classification `state`, not
append-only, set `core`. Rows: about 6.

Why the "today" and "kept open" columns can be columns: `floor_today_zones` is unique on `zone_id`;
an absent row reads as revision 0 and "no business day" (`resetZoneFor`,
`apps/server/src/floor-today-store.ts:218-232`; `ensureToday` filters `isNull(businessDay)`,
`:1017`), which the nullable `today_business_day` and default `today_revision` 0 express. Every
`zone_extensions` writer deletes the zone's rows for other days first (`keepZoneOpen`,
`packages/venue-service/src/keep-open.ts:144-154`) and every reader filters to one business day
(`zone-closed-times.ts:248`, `business-day-schedule.ts:310`), so at most one row per zone is ever
read. The configuration export must `omit` the `today_*` and `kept_open_*` columns, as it omits
`zone_extensions` today (`docs/developers/conventions-data.md` "Today's station destination and zone
extension").

### 1.2 `dining_tables` — one physical table: its design, the last reset's copy, its live name and its state today

Absorbs `floor_plan_tables`, `floor_plan_table_parts`, `floor_reset_tables`,
`floor_reset_table_parts`, `floor_today_tables`, `floor_today_split_parts`,
`floor_today_join_tables`. See decision D1.

| group | column | type | key / null | from |
| --- | --- | --- | --- | --- |
| identity | id | id | PK | dining_tables / floor_plan_tables |
| | zone_id | id | not null, FK `floor_zones` | both |
| | created_at | tsString | not null | dining_tables |
| plan (as designed, shared by every layout set) | plan_label | label | null = not in the design any more (waits to leave the floor) | floor_plan_tables.label |
| | plan_short_name | label | null | floor_plan_tables.short_name |
| | plan_seats | count | null | floor_plan_tables.seats |
| | plan_fixed | flag | not null, default 0 | floor_plan_tables.fixed |
| | plan_part_of_table_id | id | null, FK self | floor_plan_table_parts.joined_table_id |
| live | label | label | null = not made yet (waits for its name) | dining_tables.label |
| | short_name | label | null | dining_tables.short_name |
| | short_name_key | label | null | dining_tables.short_name_key |
| | needs_clearing_since | tsString | null | dining_tables |
| reset (what the zone's last reset copied) | reset_label | label | null = no reset copy (added to the design since) | floor_reset_tables.label |
| | reset_short_name, reset_seats, reset_fixed | label, count, flag | null / default 0 | floor_reset_tables |
| | reset_x, reset_y, reset_width, reset_height, reset_shape, reset_rotation | smallCount ×4, enum, smallCount | null (all six or none) | floor_reset_tables |
| | reset_part_of_table_id | id | null, FK self | floor_reset_table_parts |
| | reset_remove, reset_pending, reset_placed, reset_ready_to_move, reset_taken_off | flag | not null, default 0 | floor_reset_tables |
| today (today's map) | on_floor | flag | not null, default 0 (was: a `floor_today_tables` row exists) | — |
| | today_seats, today_fixed | count, flag | null / default 0 | floor_today_tables |
| | today_x … today_rotation (six) | as reset | null (all six or none = an unplaced spare) | floor_today_tables |
| | taken_off | flag | not null, default 0 | floor_today_tables |
| | today_name | label | null = saved name | floor_today_tables.name |
| | split_from_table_id | id | null, FK self | floor_today_split_parts.joined_table_id |
| | merge_id | id | null, FK `table_merges` | floor_today_join_tables.join_id |
| | merge_before_x, merge_before_y, merge_before_rotation | smallCount | null (with merge_id) | floor_today_join_tables |

Protections: unique `label` (was `dining_tables_location_label_key`); unique `short_name_key` (was
`dining_tables_location_short_name_key_uq`); unique `(zone_id, plan_label)` (was
`floor_plan_tables_zone_label_key`; nulls do not collide); FK `zone_id`; three self FKs, each with a
not-self CHECK and an index (were the three `*_parts`/`split_parts` tables' FKs, not-self CHECKs and
`*_joined_idx` indexes); FK `merge_id`; index `(zone_id, reset_pending)` (was
`floor_reset_tables_zone_pending_idx`); the seats CHECK (0–999) on `plan_seats`, `reset_seats`,
`today_seats`; the placement CHECKs (x, y 0–999; width, height 1–99; rotation a multiple of 15 from 0
to 345; shape enum; all six or none) on the `reset_*` and `today_*` groups; the `merge_before_*`
range CHECKs. New CHECKs this layout makes possible: `merge_before_*` set exactly when `merge_id` is
set; `reset_label` null ⇒ every `reset_*` null or false; `on_floor` = 0 ⇒ every `today_*` null and
`taken_off` = 0, `split_from_table_id` and `merge_id` null; `label` null ⇒ `on_floor` = 0; not
(`plan_label` null and `label` null and `reset_pending` = 0) — a row that is neither designed, made
nor waiting to be made has no reason to exist. Every incoming FK keeps `ON DELETE NO ACTION`: the
removal path depends on it (`conventions-data.md`, "measured on 2026-10-11 … all `ON DELETE NO
ACTION` … Cascading here would allow removal to discard the records the release and refusal paths
must handle"). Classification `state`, not append-only, set `core`. Rows: about 40–50.

Why one row is safe: a live table is created only from a reset row with no table yet
(`floor-today-store.ts:711-725`, the only product `insert(diningTables)`), and such a row exists only
for a design table no live table follows (`targetsFromMaster`, `apps/server/src/floor-reset-plan.ts:228-280`),
so in product paths at most one live table follows a design table; the `plan_table_id` pointer
(`dining_tables`, `floor_reset_tables`) disappears because the row *is* the design table. A design
table deleted in the dashboard today has its followers' `plan_table_id` set null and stays live until
a reset removes it once free (`floor-plan.ts:582-590`); in the target that is `plan_label` null with
the live columns untouched. A design table deleted while its reset row is still waiting to create it
keeps that reset row today (`floor-plan.ts:586-588` nulls the pointer, the row stays pending), so the
target keeps the row while `reset_pending` is set (the last CHECK above) — see §8, item 3.

### 1.3 `floor_plan_sets` — a named group of layouts for one department (summer, winter …)

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

### 1.4 `floor_plans` — one set's layout of one zone (kept)

`id` PK, `zone_id` FK `floor_zones`, `set_id` FK `floor_plan_sets`, `revision` count not null default
0, `saved_at` tsString not null. Unique `(set_id, zone_id)`. `state`, `core`. Rows: zones × sets,
about 6–18. Kept because it is the thing a save's revision guards (`saveLayout`/`changedShared`,
`conventions-data.md` "A zone's floor plan") and what placements belong to.

### 1.5 `floor_plan_placements` — where one layout puts one table, or the size it keeps while off

Absorbs `floor_plan_table_sizes`. The two never hold a row for the same layout and table at once: a
save that places a table deletes its kept size, and one that takes a table off writes its size
(`floor-plan.ts:560-578`, `:622-628`); the layout read joins both (`layoutTables`, `floor-plan.ts:126-160`).

| column | type | key / null |
| --- | --- | --- |
| id | id | PK |
| plan_id | id | not null, FK `floor_plans` |
| table_id | id | not null, FK `dining_tables` |
| x, y | smallCount | null = off this layout (size kept) |
| width, height | smallCount | not null |
| shape | enum rect/round | null with x |
| rotation | smallCount | null with x |

Protections: unique `(plan_id, table_id)` (was both `floor_plan_placements_table_key` and
`floor_plan_table_sizes_plan_table_key`); width/height 1–99 CHECKs (both tables had them); x, y, shape,
rotation range CHECKs; x, y, shape, rotation all set or all null (narrowed from the six-column
placement CHECK because width and height are now always set). `state`, `core`. Rows: about 40–150.

### 1.6 `table_merges` — tables staff pushed together on the till today (renamed from `floor_today_joins`)

`id` PK, `zone_id` FK `floor_zones` (indexed), `seats` count not null CHECK ≥ 1, `name` label null.
Members are `dining_tables.merge_id`. `state`, `core`. Rows: 0–5 at a time. Kept as a table: it has
its own name and seat count and other rows point at it.

### 1.7 `parties` — one group of guests from seating to finish (kept, gains allergy answer and party kitchen note)

Current columns kept (`id`, `guest_count`, `state`, `opened_at`, `opened_by`, `closed_at`,
`closed_by`, `merged_into_party_id`, `bill_requested_at`, `name`, `revision`, `table_names`) plus:

| column | type | null | from |
| --- | --- | --- | --- |
| allergy_answer | enum none/allergies | null = not asked yet | party_allergy.answer |
| allergy_answered_by | id (person, no FK: identity is toggleable) | null | party_allergy.changed_by |
| allergy_answered_at | tsString | null | party_allergy.changed_at |
| kitchen_note | label | null | order_kitchen_notes (party rows).note |
| kitchen_note_revision | count | not null, default 0 | order_kitchen_notes (party rows).revision |

Protections: existing `parties_merged_into_fk`, `parties_merged_into_idx`, `parties_state_ck`,
`parties_guest_count_ck`, `parties_closed_at_ck`, `parties_merged_into_ck`; plus the answer enum
CHECK, the three allergy columns all set or all null, and the note revision CHECK (integer ≥ 0, was
`order_kitchen_notes_revision_ck`). `kitchen_note_revision` stays separate from `revision`: the note has
its own stale-edit refusal (`kitchen_note.out_of_date`,
`packages/venue-service/src/order-kitchen-notes.ts:78-79`), and sharing the party's counter would
refuse note edits whenever anything else about the party changed. An absent note row reads as
`{note: null, revision: 0}` today (`order-kitchen-notes.ts:37`, `:77`), which the defaults express.
`table_names` stays: it is written once at close, when `party_tables` rows are deleted
(`closePartyTables`, `apps/server/src/parties.ts:791-797`). `state`, `core`. Rows: about 200 a day,
about 72,000 a year; never deleted.

### 1.8 `party_tables` — which tables a party is at (kept)

Unchanged: `id`, `party_id` FK, `table_id` FK, `joined_at`, `left_at`. Protections kept: both FKs,
partial unique `party_tables_active_table_uq` (one open seating per table), `party_tables_party_idx`.
A link table with both sides checked (R7), and its `left_at` rows are read back while the party is
open ("used earlier by a party still open", `LiveTable.tied`, `floor-reset-plan.ts:37`); rows are
deleted at close (`parties.ts:796`). Rows: 0–50 at a time.

### 1.9 `party_allergy_guests` — one allergic guest at a table (kept, re-pointed)

Columns unchanged (`id`, `party_id`, `position`, `who`, `allergens`, `note`). FK `party_id` now →
`parties.id` ON DELETE CASCADE (was → `party_allergy.party_id`). Protections kept: position, who,
allergens, note CHECKs. The old FK also meant "a guest exists only for a party with a recorded
answer"; a BEFORE INSERT/UPDATE trigger `party_allergy_guests_need_answer` (refuse unless
`parties.allergy_answer` is set) keeps that. Rows: about 7,000–18,000 a year.

### 1.10 `allergy_line_ticks` — which allergic guest a dish line is for (kept)

Unchanged, all protections kept (three cascading FKs, the two unique line keys, the exactly-one-target
CHECK). Kept as its own table rather than a column on the lines for a protection reason (R1): ticks
on sent lines change while the party is open (`setAllergyLineTicks`,
`packages/venue-service/src/party-allergy.ts:169-279`, which checks the party is open but not the
bill), and a bill of an open party can already be settled, whose lines the
`working_order_lines_require_open_parent_update` trigger freezes except for served quantity
(`packages/db/drizzle/0177_paid_line_service_group.sql`). Rows: about 10,000–36,000 a year.

### 1.11 `order_kitchen_notes` — the kitchen note on one bill (kept for bills only)

`working_order_id` id PK, FK `working_orders` ON DELETE CASCADE; `note` label null; `revision` count
not null default 0, CHECK integer ≥ 0. The `id`, `party_id`, its unique key and the one-owner CHECK go
(party notes move to `parties`). Kept separate from `working_orders` for a protection reason: a
bill's note can be edited after it is settled, until it is collected (`order-kitchen-note.ts:202`
refuses only abandoned or collected), while the `working_orders` transition trigger lets a settled
bill change only `collected_at` (`packages/db/drizzle/0198_recipient_identifier_guards.sql:117-134`).
See D3. Rows: about 3,500–11,000 a year.

### 1.12 `service_steps` and `service_step_completions` (kept)

`service_steps` (a department's timed reminders) unchanged: FKs to `departments` and
`kitchen_courses`, indexes, start enum, course and minutes CHECKs. Rows 0–10.
`service_step_completions` unchanged: typed history the till reads back (`readStepCompletions` via
`apps/server/src/service-step-signals.ts`); both FKs cascade, both indexes kept. Rows 0, or about
110,000–290,000 a year when steps are used.

### 1.13 `kitchen_stations` — a preparation point (kept, gains today's closure)

Current columns minus `location_id`, plus:

| column | type | null | from |
| --- | --- | --- | --- |
| closed_on_day | day | null = not closed by hand | station_day_states.business_day |
| closed_sends_to_station_id | id | null, FK `kitchen_stations` | station_day_states.sends_to_station_id |

`station_day_states.open` is dropped: every writer writes `false` (`setStationToday`,
`packages/venue-service/src/station-times.ts:69-79`; reopening deletes the row, `:57-64`), and the
reader asks only for closed rows (`routing-store.ts:440-446`). The writer also deletes the station's
rows for other days first (`station-times.ts:48-55`), so one pair of columns holds everything read.
Protections: `kitchen_stations_name_key` (now `name` where active), `kitchen_stations_default_key`
(one default station, venue-wide), `kitchen_stations_thresholds_ordered`; plus the not-self CHECK of
`station_day_states_sends_to_not_self_ck` and "sends-to only while closed". Export `omit` adds the two
new columns (as `station_day_states` is left out today). The many per-station switches stay columns:
each station is a row with its own identity (R3). Rows: 3–4.

### 1.14 `kitchen_courses` (kept), `station_printers` (kept)

`kitchen_courses` loses `location_id`; `kitchen_courses_name_key` becomes `name` where active. Rows 3–5.
`station_printers` unchanged: composite PK, both FKs (R7). Rows 2–4.

### 1.15 `ticket_items` — the kitchen's copy of each sent dish line (kept, gains the allergy snapshot)

Kept separate from `working_order_lines` for a protection reason: its state advances after the bill
is settled ("a settled order still has its lines cooked", `packages/db/src/schema/ticket-items.ts`),
which the lines' freeze trigger would refuse (0177, above). Changes:

| change | why |
| --- | --- |
| + `allergy_frozen` flag not null default 0, `allergy_original` json null, `allergy_current` json null | from `ticket_item_allergies` (PK `ticket_item_id`, one row per item; "row presence also freezes an unticked dish", `packages/venue-service/src/schema/kitchen-allergy.ts`) |
| − `away_at` | no product writer: `grep -rnE "ticketItems\.awayAt\|awayAt:" apps packages --include='*.ts'` outside tests finds only the schema; removal is already planned (A773 PR D, `docs/superpowers/plans/2026-11-01-a773-2b-requested-release.md:201`) |
| − `node_id` (proposed) | one box per venue; only reader is the overdue report's filter (`packages/reporting/src/overdue-orders.ts:63`). Depends on the venue-and-box area's node decision |
| − `working_order_id` (proposed, after §8 item 1) | a copy of `working_order_lines.working_order_id`, no FK ("Denormalised grouping key", schema comment) |

Protections: `ticket_items_working_order_line_id_key` (one per line, the double-fire guard),
`ticket_items_queue_idx`, `ticket_items_course_idx`, `ticket_items_waiting_idx`,
`ticket_items_state_ck`, FKs line (cascade), station, course; `ticket_items_order_idx` goes only if
`working_order_id` goes. The two allergy block CHECKs (`kitchenAllergyBlockCheck`) move onto
`allergy_original`/`allergy_current`, plus `allergy_frozen` = 0 ⇒ both null. Classification stays
`ledger`, not append-only. Rows: about 1,000 a day, 360,000 a year (no housekeeping deletes them).
Note: A773-2 is changing this table now (`requested_at`, `pass_controlled`); this design keeps them.

### 1.16 `ticket_item_moves` (kept — typed history)

Unchanged; read back by product code to find the latest mover (`station-move.ts`,
`station-queue-moves.ts`, `working-order.ts`; ordering by `rowid`, `conventions-data.md` "Latest
station move follows insertion order"). Actor CHECK, four FKs, line index kept. Rows 0–3,600 a year.

### 1.17 `kitchen_print_jobs` and `kitchen_print_job_lines` (kept)

Both are link tables between `print_jobs` and bills/lines with both sides checked (R7). The bill link
is not a column of `print_jobs`: one job can carry several stations (`linkKitchenJob` inserts one row
per station, `apps/server/src/kitchen-print.ts:838-848`) and several bills, and a copied link has its
own `reprint` and position (`writeLinksAfter`, `:2209-2240`, which relies on `rowid` order). All
FKs, unique keys and indexes kept. Rows: 180,000–270,000 and 250,000–360,000 a year where stations
print; zero with screens only.

### 1.18 `kitchen_notices` (kept)

Unchanged, with all ten CHECKs, both FKs and the partial open index. It has its own identity, is a
list a cook acknowledges, and its copied dish fields are facts fixed when written (a void deletes the
line). Rows 7,000–30,000 a year.

### 1.19 `routing_cells` and `routing_cell_periods` (kept)

`routing_cells` loses `location_id`; its seven partial unique indexes lose that column and keep their
WHERE clauses; four CHECKs and the category (cascade), product, zone and station FKs kept. Rows 10–40.
`routing_cell_periods` is a many-per-cell child, not one-per-parent, so it stays; proposed: drop
`department_id`, a copy of `menu_periods.department_id`, and replace the composite FK with FK
`period_id` → `menu_periods` ON DELETE CASCADE (the zone-move clean-up at
`packages/venue-service/src/operations.ts:455-469` then joins `menu_periods`). Target CHECK and
`(cell_id, period_id)` unique kept. Rows 0–40.

### 1.20 `bookings` (kept, own set)

Loses `location_id` (A1301 S20); `bookings_location_date_idx` becomes an index on `booking_date`.
`table_label` stays (written when the table is removed, `packages/bookings/src/table-removal.ts`).
FKs to `dining_tables` and `working_orders`, the status/date index, party-size and status CHECKs kept.
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

Nothing in this area writes to `activity_log` today, and the target needs none to keep behaviour.
Typed history tables that remain, because product code reads them back:

- `ticket_item_moves` — latest mover (`station-move.ts`, `station-queue-moves.ts`, `working-order.ts`).
- `service_step_completions` — the till's "step due" signal (`service-step-signals.ts`).
- `kitchen_notices` — open notices on station screens (`listStationNotices`); acknowledged rows stay.
- `party_tables` — earlier tables of an open party (deleted at close).

Proposed `activity_log` kinds, for facts that are overwritten in place today (see D4):

| kind | subject | data | replaces |
| --- | --- | --- | --- |
| `party.allergy_answered` | party | `{answer, guests}` | today only the last answerer is kept (`party_allergy.changed_by`) |
| `station.closed_for_day`, `station.reopened` | station | `{businessDay, sendsTo}` | `station_day_states` keeps no person and no past days |
| `zone.kept_open`, `zone.keep_open_ended` | zone | `{businessDay, from, until}` | `zone_extensions` keeps no person and no past days |

## 4. Mapping

| current | fate | why |
| --- | --- | --- |
| dining_tables | keep (absorbs six tables) | the one row per physical table |
| floor_plan_tables | merge into dining_tables (`plan_*`) | design of the same physical table; pointer `plan_table_id` goes |
| floor_plan_table_parts | merge into dining_tables.plan_part_of_table_id | unique on the part: one parent per part |
| floor_reset_tables | merge into dining_tables (`reset_*`) | unique on table; its "to create" rows become the design row itself |
| floor_reset_table_parts | merge into dining_tables.reset_part_of_table_id | unique on the part |
| floor_today_tables | merge into dining_tables (`today_*`, `on_floor`) | unique on table |
| floor_today_split_parts | merge into dining_tables.split_from_table_id | unique on the part |
| floor_today_join_tables | merge into dining_tables (`merge_id`, `merge_before_*`) | unique on table |
| floor_today_joins | rename to table_merges | its own identity, name and seats |
| floor_today_zones | merge into floor_zones (`today_*`) | unique on zone |
| floor_plan_sets | keep (absorbs department_floor_plan_sets) | after A1301 it would be an id alone |
| floor_plans | keep | the layout a revision guards |
| floor_plan_placements | keep (absorbs floor_plan_table_sizes) | same key (layout, table) |
| floor_plan_table_sizes | merge into floor_plan_placements | never coexists with a placement row |
| floor_zones | keep (absorbs four tables) | the zone |
| zone_service_policies | merge into floor_zones | PK zone_id; every zone gets one at creation (`createServiceZone`, `operations.ts:486-530`) |
| zone_sale_policies | merge into floor_zones | PK zone_id; null columns already mean "follow the department" |
| zone_extensions | merge into floor_zones (`kept_open_*`) | one live row per zone; other days deleted by the writer |
| parties | keep (absorbs party_allergy, party kitchen notes) | the party |
| party_tables | keep | link table, read back while open |
| party_allergy | merge into parties (`allergy_*`) | PK party_id |
| party_allergy_guests | keep | many per party; ticks point at them |
| allergy_line_ticks | keep | settled lines are frozen; ticks still change |
| order_kitchen_notes | keep (bills only; party rows → parties) | settled bills are frozen; the note still changes |
| service_steps | keep | a list per department |
| service_step_completions | keep | typed history read by the till |
| kitchen_stations | keep (absorbs station_day_states) | the station |
| station_day_states | merge into kitchen_stations (`closed_*`) | one live row per station; `open` always false |
| kitchen_courses | keep | the course |
| station_printers | keep | link table |
| ticket_items | keep (absorbs ticket_item_allergies) | kitchen state outlives the frozen line |
| ticket_item_allergies | merge into ticket_items (`allergy_*`) | PK ticket_item_id |
| ticket_item_moves | keep | typed history read back |
| pass_item_marks | delete | dead (no writer, no reader) |
| kitchen_print_jobs | keep | link with per-link facts |
| kitchen_print_job_lines | keep | link table |
| kitchen_notices | keep | own identity, acknowledged list |
| routing_cells | keep | the routing rule |
| routing_cell_periods | keep | many per rule |
| bookings | keep | the reservation (own module) |

`pass_item_marks`: `grep -rlE "passItemMarks|pass_item_marks" apps packages scripts` outside drizzle
snapshots finds only its schema file, one test and `scripts/schema-constraints.test.ts`; its writer
went in #1944 (`509e8d42a6`), and its removal is already planned (A773 PR D).

## 5. Protections

Append-only triggers: none in this area (no table here is `appendOnly(...)` in
`packages/db/src/classification.ts`, `packages/venue-service/src/classification.ts` or
`packages/bookings/src/classification.ts`). Behavioural triggers: none currently installed on these
tables; the three that named them were dropped (`working_orders_clear_table_status` in core 0020,
`parties_clear_table_status` in 0180, the two `working_orders_release_main_bill*` in 0201) — read from
the migration files, not measured on a migrated database (§8 item 5).

| current protection | home |
| --- | --- |
| `dining_tables_location_label_key` | unique `dining_tables(label)` |
| `dining_tables_location_short_name_key_uq` | unique `dining_tables(short_name_key)` |
| `dining_tables_location_fk`, `floor_plan_sets_location_fk`, `floor_zones` / `kitchen_stations` / `kitchen_courses` / `zone_service_policies` / `routing_cells` / `bookings` location FKs | dropped: A1301 removes `locations` (R10) |
| `dining_tables_zone_fk` | kept |
| `dining_tables.plan_table_id` FK, `floor_reset_tables.plan_table_id` FK | dropped: the row is the design table |
| `floor_plans_set_zone_key`, `floor_plans_zone_fk`, `floor_plans_set_fk` | kept |
| `floor_plan_tables_zone_label_key` | unique `dining_tables(zone_id, plan_label)` |
| `floor_plan_tables_zone_fk` | `dining_tables_zone_fk` |
| `floor_plan_tables_seats_ck`, `floor_reset_tables_seats_ck`, `floor_today_tables_seats_ck` | seats CHECKs on `plan_seats`, `reset_seats`, `today_seats` |
| `floor_plan_placements_table_key`, `floor_plan_table_sizes_plan_table_key` | unique `floor_plan_placements(plan_id, table_id)` |
| placements' plan and table FKs; sizes' plan and table FKs | placements' FKs (table → `dining_tables`) |
| placements' x/y/width/height/rotation/shape CHECKs; sizes' width/height CHECKs | placements CHECKs |
| `floor_plan_placements_placement_ck` (all six or none) | x, y, shape, rotation all-or-none (width and height are now always set) |
| `floor_plan_table_parts_part_key`, `floor_reset_table_parts_part_key`, `floor_today_split_parts_part_key` | implicit: one column per row |
| the three parts tables' `*_joined_idx` | indexes on the three self-FK columns |
| the three parts tables' `*_not_self_ck` | three not-self CHECKs on `dining_tables` |
| the three parts tables' two FKs each | three self FKs (NO ACTION, as now) |
| `floor_reset_tables_table_key`, `floor_today_tables_table_key`, `floor_today_join_tables_table_key` | implicit: same row |
| `floor_reset_tables_zone_pending_idx` | index `dining_tables(zone_id, reset_pending)` |
| `floor_reset_tables_zone_fk`, `floor_reset_tables_table_fk`, `floor_today_tables_table_fk`, `floor_today_join_tables_table_fk` | implicit: same row |
| reset and today placement CHECKs (x, y, width, height, rotation, shape, all-or-none) | same CHECKs on the `reset_*` and `today_*` groups |
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
| `zone_service_policies_one_counter_default_key` | partial unique on `floor_zones.is_counter_default` |
| `zone_sale_policies_zone_fk`, four enum CHECKs | implicit; CHECKs on `floor_zones` |
| `zone_extensions_zone_fk`, `_day_key` | implicit (one per zone) |
| `zone_extensions_step_ck` | quarter-hour CHECK on `kept_open_from`, `kept_open_until` |
| `kitchen_stations_name_key`, `_default_key`, `_thresholds_ordered` | kept, without location |
| `station_day_states_station_fk`, `_day_key` | implicit (one per station) |
| `station_day_states_sends_to_fk`, `_sends_to_not_self_ck` | self FK and not-self CHECK on `kitchen_stations` |
| `kitchen_courses_name_key` | kept, without location |
| `ticket_items_*` (unique line key, four indexes, state CHECK, three FKs) | kept; `node_id` FK and `ticket_items_order_idx` go only with their columns |
| `ticket_item_allergies_ticket_fk` (cascade), `_original_ck`, `_current_ck` | implicit; the two CHECKs on `ticket_items.allergy_*` |
| `kitchen_print_jobs_*`, `kitchen_print_job_lines_*` | kept |
| `station_printers_pk` and FKs | kept |
| `pass_item_marks_pk`, FKs, index | dropped with the dead table |
| `ticket_item_moves_*` | kept |
| `kitchen_notices_*` (two FKs, partial index, ten CHECKs) | kept |
| `routing_cells_*` (four FKs, four CHECKs, seven partial uniques) | kept, without location |
| `routing_cell_periods_period_fk` (composite with department) | FK `period_id` → `menu_periods` cascade (department copy dropped) |
| `routing_cell_periods_cell_fk`, `_station_fk`, `_target_ck`, `_cell_period_key` | kept |
| `order_kitchen_notes_order_fk`, `_order_key` | PK = FK `working_order_id` (cascade) |
| `order_kitchen_notes_party_fk`, `_party_key` | implicit: the note is a column of the party |
| `order_kitchen_notes_owner_ck` | dropped: one owner per home |
| `order_kitchen_notes_revision_ck` | on `order_kitchen_notes.revision` and `parties.kitchen_note_revision` |
| `party_allergy` PK/FK (cascade), `party_allergy_answer_ck` | implicit; CHECK on `parties.allergy_answer` |
| `party_allergy_guests_party_fk` (→ answer row) | FK → `parties` (cascade) plus trigger `party_allergy_guests_need_answer` |
| `party_allergy_guests_position/who/allergens/note_ck` | kept |
| `allergy_line_ticks_*` | kept |
| `service_steps_*`, `service_step_completions_*` | kept |
| `bookings_location_date_idx` | index `bookings(booking_date)` |
| `bookings_table_fk`, `_tab_fk`, `_table_status_date_time_idx`, `_party_size_ck`, `_status_ck` | kept |
| Configuration export leaving out `station_day_states`, `zone_extensions`, `needs_clearing_since`, `short_name_key` | `omit` lists on `kitchen_stations`, `floor_zones`, `dining_tables` (also omit every `reset_*`, `today_*`, `merge_*`, `on_floor`) |

## 6. Duplicates removed

| same thing stored more than once | one home |
| --- | --- |
| a table's zone: `floor_plan_tables.zone_id`, `dining_tables.zone_id`, `floor_reset_tables.zone_id` | `dining_tables.zone_id` |
| the link from a live table to its design: `dining_tables.plan_table_id`, `floor_reset_tables.plan_table_id` | gone: same row |
| a set's existence (`floor_plan_sets`) and its name/department/default (`department_floor_plan_sets`) | `floor_plan_sets` |
| a zone's department in `zone_service_policies` beside the zone | `floor_zones.department_id` |
| `zone_service_policies.location_id`, and every other `location_id` here | gone (A1301) |
| `ticket_items.working_order_id`, a copy of the line's bill | proposed: read through the line (§8 item 1) |
| `routing_cell_periods.department_id`, a copy of the period's department | `menu_periods.department_id` |
| `ticket_items.node_id`, constant on a one-box venue | proposed: gone (venue-and-box area decides on nodes) |
| `station_day_states.open`, always false | gone |

Kept on purpose, with the reason:

- The table's name, short name, seats, "fixed" and place in three column groups (`plan_*`, `reset_*`,
  `today_*`/live). They are three states, not copies: a dashboard save changes `plan_*` without
  rearranging the floor ("Saving a layout does not rearrange tables during service: only a reset
  does", `conventions-data.md`), the reset copy keeps "a later save from changing what a reset is
  still applying" (same section), and the live/today values change only when the reset is applied to
  a free table. Folding them into one row removes the pointers and joins, not the states.
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
  `zone_days` and `zone_day_ranges` point at `zone_service_policies.zone_id` today
  (`packages/venue-service/src/schema/seasons.ts:179`) and must point at `floor_zones.id`; `locations`
  goes (A1301); `nodes` (`ticket_items.node_id`).
- **Menu:** `menu_periods` (FK from `routing_cell_periods`; `menu_periods.floor_plan_set_id` points at
  `floor_plan_sets`); `categories`, `products` (FKs from `routing_cells`).
- **Orders and sales:** `working_orders` (FKs from `kitchen_print_jobs`, `kitchen_notices`,
  `order_kitchen_notes`, `bookings.tab_id`; it points at `dining_tables` through `delivery_table_id` and
  at `parties`), `working_order_lines` (FKs from `ticket_items`, `ticket_item_moves`,
  `kitchen_print_job_lines`, `allergy_line_ticks`), `order_draft_lines` (`allergy_line_ticks`),
  `order_drafts`/`order_groups`/`unpaid_departures` (→ `parties`), `order_group_hold_stations` and the
  line/draft station and course columns (→ `kitchen_stations`, `kitchen_courses`),
  `order_service_contexts.zone_id` (→ `floor_zones`). This design assumes the line and bill freeze
  triggers stay as they are (they decide §1.10, §1.11, §1.15).
- **Devices:** `print_jobs`, `printers` (`station_printers`, `kitchen_print_jobs`), `devices`
  (`ticket_item_moves.moved_by_device_id`); device profile zones, starting zone, kitchen-screen
  stations and zones, made-here stations and device zone selections all point at `floor_zones` or
  `kitchen_stations`.
- **People:** person ids without FKs (`opened_by`, `closed_by`, `allergy_answered_by`, `done_by`,
  `created_by`, `moved_by_person_id`), because `identity` is toggleable.
- **Staffing (toggleable):** points at `kitchen_stations` (`packages/staffing/src/schema/staffing.ts`).
- **In-flight work:** A773-2 (firing and the pass) is changing `ticket_items` and removing `away_at`
  and `pass_item_marks`; A1301 is removing `location_id` from every table here.

## 8. Measure before building

1. **Dropping `ticket_items.working_order_id`.** 55 non-test reads name it
   (`grep -rnE "ticketItems\.workingOrderId" apps packages --include='*.ts' | grep -v test | wc -l`).
   Time the station screen, pass board, print-problem and overdue reads on a database with 360,000
   ticket items and 360,000 lines, with and without the column (join through `working_order_lines`).
   Failing result: the join version is noticeably slower on the reference box (for example the p95 of
   the station queue read more than doubles, or exceeds 50 ms). Then keep the column, and add a
   CHECK-by-trigger that it equals the line's bill so the two copies cannot drift.
2. **The merged `dining_tables` keeps behaviour.** The floor's suites (`apps/server/src/floor-*.test.ts`,
   `floor-catch-up.test.ts`, `floor-reset-plan.test.ts`, `table-removal`, bookings' floor tests) must
   pass with their assertions unchanged; only setup may change. Failing result: any assertion that has
   to be rewritten to pass means behaviour moved; stop and revisit D1.
3. **Deleting a design table whose creation is still waiting.** Today the waiting reset row survives
   with its pointer nulled (`floor-plan.ts:586-588`) and the catch-up still creates the table, which
   the next reset then removes. Write a test of that sequence against today's code first; the target
   must give the same result. Failing result: the target loses the waiting creation.
4. **The incoming foreign keys.** Re-run the `pragma_foreign_key_list` measurement the conventions
   doc records (2026-10-11 and 2026-10-18) on the target; every key into `dining_tables` must still be
   `ON DELETE NO ACTION`. Failing result: any cascade.
5. **No trigger names these tables.** On a fully migrated database, list `sqlite_master` triggers whose
   SQL names any target table. Expected: none, except the new `party_allergy_guests_need_answer`.
6. **The two "kept separate for protection" claims.** Run them: (a) update `kitchen_note` on a settled,
   uncollected bill folded into `working_orders` — the 0198 transition trigger should refuse it;
   (b) tick an allergic guest on a line of a settled bill in an open party — today it succeeds; with
   the tick as a line column, 0177 should refuse it. If either is not refused, that table can fold.
7. **Export round trip.** Configuration export and import with a zone kept open, a station closed for
   the day and a reset in progress: the bundle must carry none of the `today_*`, `reset_*`,
   `kept_open_*`, `closed_*` columns.

## 9. Decisions for the owner

- **D1. One row per physical table.** Fold the design table, the reset copy, today's state and the
  split/merge membership into `dining_tables` (seven tables → one, about 45 columns in four named
  groups). Alternative: keep `floor_plan_tables` separate, on the ground that a design entry can exist
  before its live table and outlive it (different lifetime, R1), and fold the other five into
  `dining_tables`. **Recommendation: fold all seven** — the lifetime difference is two nullable names
  (`plan_label`, `label`), the reset code's pointer-following and "more than one live table follows
  one design table" case (`copyParts`, `floor-today-store.ts:302-327`) disappear, and the floor's
  large behaviour suites are the safety net (§8 item 2). Cost: a rewrite of `floor-today-store.ts`,
  `floor-plan.ts`, `floor-plan-sets.ts`, `floor-reset-plan.ts` inputs, `joined-parts.ts` and the SQL in
  `catchUpDue`/`placeTaken`.
- **D2. One migration set for the floor and kitchen.** `floor_zones` (core) needs an FK to
  `departments` (venue-service), and `parties`/`ticket_items`/`kitchen_stations` (core) gain columns from
  venue-service tables. Core requires no other set, so it cannot point at venue-service. Both sets are
  `tier: "mandatory"` (`packages/composition/src/modules.ts:151`, `:192`), so nothing swappable is lost.
  **Recommendation: merge the venue-service migration set into core** (a cross-area decision; the
  venue-and-box area owns `departments`). Alternative: move `departments` alone into core.
- **D3. A bill's kitchen note.** Keep `order_kitchen_notes` for bills (recommended), or fold it into
  `working_orders` and add `kitchen_note`/`kitchen_note_revision` to the columns the transition trigger
  lets a settled, uncollected bill change. The orders-and-sales area owns that trigger.
- **D4. Who changed allergies, station closures and keep-open.** Today none of these keep a history
  or, for closures and keep-open, a person (`docs/backlog/service-periods.md` "Who authorised today's
  station or zone change", open). **Recommendation:** write the `activity_log` kinds in §3 with the
  person, since folding the day tables into columns is the moment the old values would otherwise be
  overwritten with no trace.
