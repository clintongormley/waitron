# A1308 fk2 — today's keep-open and station closure live on their rows, with a history: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox
> (`- [ ]`) syntax. Every step also follows [the A1308 slice rules](2026-11-08-a1308-slice-rules.md)
> ("rules").

**Goal:** `zone_extensions` (a zone kept open later today) becomes three columns on `floor_zones`,
`station_day_states` (a station closed by hand today, and where its work goes) becomes two columns on
`kitchen_stations`, and each change is written to `activity_log` with the person who authorised it.

**Architecture:** each table held at most one row that anything reads (its writer deletes the other
days' rows first, appendix §1.1 and §1.15), so one set of columns holds it; a value stamped with an
earlier business day reads as "not set". The four activity kinds are for people to read; product
code keeps reading the columns (README §3, R2).

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest, the slice-1a rebuild command, slice
2's `activity_log` writer.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) U11 (`activity_log` scope),
[appendix](../specs/2026-11-02-rationalisation/tables-floorkitchen.md) §1.1 (`kept_open_*`), §1.15
(`closed_*`), §3 (the four kinds), §5, §8 item 6.

**First line of the pull request:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported."

**Who lands:** the lane (rules §6: nothing fiscal).

## What it builds

- `floor_zones.kept_open_day` (`day`), `kept_open_from`, `kept_open_until` (`timeOfDay`): all three
  set or all null; both times on a quarter hour.
- `kitchen_stations.closed_on_day` (`day`), `closed_sends_to_station_id` (key to
  `kitchen_stations`): the destination never names its own station, and is set only while
  `closed_on_day` is.
- Six CHECKs on `kitchen_stations` that its comments said were left out only because a CHECK would
  rebuild the table (coordinator decision, 2026-11-08): `warm_after_minutes >= 1`,
  `ready_warning_after_minutes >= 1`, and `colour`, `ticket_grouping`, `bump_mode`,
  `changes_after_sending` each in its list from `@waitron/shared` (`STATION_COLOURS`,
  `TICKET_GROUPINGS`, `BUMP_MODES`, `CHANGES_AFTER_SENDING`). The six comments at
  `kitchen-stations.ts:18, 22, 29, 31, 34, 36` go: the CHECK now says what they said. The routes' and
  the import's own refusals stay (they answer with a domain error before the database would).
- `zone_extensions` and `station_day_states` are deleted. `station_day_states.open` goes with it:
  every writer wrote `false` (`packages/venue-service/src/station-times.ts:56-65`).
- `activity_log` rows of kinds `zone.kept_open`, `zone.keep_open_ended`, `station.closed_for_day`,
  `station.reopened` (appendix §3), each naming the authorising person and the device.
- The configuration export leaves out the five columns (as it left out both tables,
  conventions-data.md "Today's station destination and zone extension"), and a round-trip test proves
  it (appendix §8 item 6, the zone and station half; fk4 and fk7 extend the same test).
- Deletes the backlog entry "Who authorised today's station or zone change"
  (`docs/backlog/architecture.md` "What A1308 retires" and its detail section in
  `docs/backlog/service-periods.md:32-39`).

## What it leaves out

| Left out | Owner |
| --- | --- |
| A dashboard history screen reading these rows | follow-up, README U11 ("not built here") |
| `kitchen_stations.printer_ids` | fk7 |

## Files

- Modify: `packages/db/src/schema/floor-zones.ts`, `packages/db/src/schema/kitchen-stations.ts`;
  delete `packages/db/src/schema/venue-service/zone-extensions.ts` and `station-times.ts`;
  `packages/db/src/index.ts`, `packages/db/src/classification.ts:332,349`,
  `packages/venue-service/src/classification.ts:14,31`, `packages/db/src/configuration-transfer.ts:67,76`
  (the `kitchen_stations` and `floor_zones` entries gain `omit`), `scripts/schema-constraints.test.ts:71-72,356`.
- Modify (writers): `packages/venue-service/src/keep-open.ts:116-174` (`keepZoneOpen`),
  `packages/venue-service/src/station-times.ts:25-66, 98-139` (`setStationToday`,
  `closeStationForToday`, `openStationForToday`), `packages/module/src/module.ts:869-874, 949`
  (the three signatures), `apps/server/src/keep-open-api.ts:32-56`,
  `apps/server/src/station-today-api.ts:71-116, 140-180`.
- Modify (readers): `packages/venue-service/src/zone-closed-times.ts:225-240`,
  `business-day-schedule.ts:288-299`, `routing-store.ts:410-425`.
- Modify (deletes): `packages/venue-service/src/service-delete-settings.ts:70-74, 304, 375`,
  `packages/venue-service/src/station-delete-settings.ts:65-74, 150-166`.
- Modify: `packages/db/src/testing/seed.ts` (`seedPerson`).
- Modify (lists): `apps/dashboard/src/api/live-queries.ts:63,371,472`,
  `packages/venue-service/src/dashboard/live-queries.ts:33,90,150`,
  `apps/server/src/testing/clear-provision-fixture.ts:14,20`, slice 2's activity-kind list.
- Create: `scripts/a1308/fk2-today-fixtures.mjs` and `.test.mjs` (on fk0's `lib/fold-inserts.mjs`),
  `apps/server/src/configuration-transfer.floor-kitchen.test.ts`,
  `packages/venue-service/src/todays-choices-history.test.ts`.
- Generated (uncounted): core's starting migration files and the epoch file.
- Docs: `docs/developers/conventions-data.md` "Today's station destination and zone extension"
  (:1949-1978), `docs/backlog/architecture.md`, `docs/backlog/service-periods.md`.

## Size

| Part | Counted lines |
| --- | --- |
| Schema, classification, export `omit` | 45 |
| Writers, module interface, two routes | 110 |
| Readers and delete paths | 60 |
| Live queries, clear fixture, activity kinds, `seedPerson` | 40 |
| Fixture script config and test | 50 |
| The six `kitchen_stations` CHECKs and their tests (a refusal and a legitimate write each) | 60 |
| New tests (schema refusals, history rows, export round trip) | 220 |
| Hand edits to tests the script reports, and actor arguments in callers' tests | 90 |
| Docs and backlog | 30 |
| **Total** | **≈ 705** |

Uncounted: the script's output (7 test files insert into the two tables directly:
`git grep -l -E "insert\((zoneExtensions|stationDayStates)\)" -- '*.test.ts'`), deletions, generated
migration files.

## Finish line

```bash
pnpm --filter @waitron/venue-service exec vitest run src/keep-open.test.ts src/station-times.test.ts \
  src/routing.test.ts src/routing-store.test.ts src/zone-closed-times.test.ts \
  src/business-day-schedule.test.ts src/service-delete-settings.test.ts \
  src/station-delete-settings.test.ts src/configuration-transfer.test.ts src/hours.live.test.ts \
  src/station-reopening-without-hours.test.ts src/todays-choices-history.test.ts \
  src/classification.test.ts src/dashboard/live-queries.test.ts src/schema
pnpm --filter @waitron/db exec vitest run src/schema
pnpm --filter @waitron/server exec vitest run src/till-api.keep-open.test.ts \
  src/till-api.station-today.test.ts src/configuration-transfer.test.ts \
  src/configuration-transfer.floor-kitchen.test.ts src/till-api.zone-closed.test.ts \
  scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm --filter @waitron/till exec vitest run src/widgets/keep-open.test.ts \
  src/widgets/station-today-dialog.test.ts src/screens/zone-keep-open-screens.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts \
  scripts/live-subscriptions.test.ts scripts/starting-migrations.test.ts \
  scripts/id-columns-are-references.test.ts scripts/a1308
node scripts/a1308/fk2-today-fixtures.mjs --write $(git ls-files '*.test.ts' 'apps/*/src/testing/*.ts' 'packages/*/src/testing/*.ts') && git diff --exit-code
```

The till files run real Chromium; check memory headroom first (CLAUDE.md §2).

## Expected protection-list difference

Under all six venue headers unless marked "change-feed only".

| Table | Lines |
| --- | --- |
| `zone_extensions` (gone; §5: "implicit (one per zone)"; step CHECK moves) | `missing table zone_extensions`; `missing index zone_extensions_day_key`; `missing index zone_extensions.primary key(id)`; change-feed only: `missing trigger waitron_change_zone_extensions_insert`, `_update`, `_delete` |
| `station_day_states` (gone; §5: "implicit"; self FK and not-self CHECK move) | `missing table station_day_states`; `missing index station_day_states_day_key`; `missing index station_day_states.primary key(id)`; change-feed only: `missing trigger waitron_change_station_day_states_insert`, `_update`, `_delete` |
| `floor_zones` | `extra table floor_zones.columns[kept_open_day]`, `[kept_open_from]`, `[kept_open_until]`; `changed table floor_zones.columnOrder`; `extra table floor_zones.checks[floor_zones_kept_open_ck]`, `[floor_zones_kept_open_step_ck]`; change-feed only: `changed trigger waitron_change_floor_zones_update.when` |
| `kitchen_stations` | `extra table kitchen_stations.columns[closed_on_day]`, `[closed_sends_to_station_id]`; `changed table kitchen_stations.columnOrder`; `extra table kitchen_stations.foreignKeys[closed_sends_to_station_id->kitchen_stations(id)]`; `extra table kitchen_stations.checks[kitchen_stations_closed_sends_to_not_self_ck]`, `[kitchen_stations_closed_sends_to_ck]`, `[kitchen_stations_warm_after_ck]`, `[kitchen_stations_ready_warning_after_ck]`, `[kitchen_stations_colour_ck]`, `[kitchen_stations_ticket_grouping_ck]`, `[kitchen_stations_bump_mode_ck]`, `[kitchen_stations_changes_after_sending_ck]`; change-feed only: `changed trigger waitron_change_kitchen_stations_update.when` |

`activity_log` gains rows, not objects: nothing for it.

## Stop points (beyond rules §5)

1. A test proves "an extension for another business day is ignored" by inserting **two** rows for
   one zone on different days. One row per zone cannot hold that; such a test is re-pointed to "a
   value stamped with yesterday reads as not kept open". If its assertion must change beyond that,
   stop.
2. A test caller of the three writers names a person id it cannot seed (an id the test asserts
   is unknown): stop.
3. An assertion changes that "Assertions that change, by design" does not list.
4. A station row in a fixture holds a value the new CHECKs refuse (a colour not in
   `STATION_COLOURS`, say): every venue is reset, so only a fixture can; fix it to a listed value,
   and stop if a product writer produces it.

## Assertions that change, by design

| Where | Change | Design |
| --- | --- | --- |
| `packages/db/src/schema/venue-service/migrations.test.ts:38, :42` (`TABLES`) | drop `zone_extensions`, `station_day_states` | §4 |
| same file `:259-262`, `:285-290` | their key-shape entries go | §5 "implicit (one per zone / station)" |
| same file `:430-431` | the `station_day_states_day_key` assertions go | §5 "implicit" |
| same file `:686-790` | the zone-extension and station-day cases go with their tables; each protection they proved is proved again by Task 1's cases on the new columns (step CHECK, sends-to key, not-self CHECK, "a destination needs a closure"); "one extension per business day" has no successor, because one row per zone holds one day (§1.1) | §1.1, §1.15 |
| `packages/venue-service/src/schema/service.test.ts:116-123, :219` | the `station_day_states` `EXPECTED` entry goes; the count falls by one more | §4 |
| `apps/dashboard/src/api/live-queries.test.ts:1030` (`stationDeleteReads`) | `station_day_states` → `kitchen_stations` (de-duplicated) | §1.15 |
| same file `:1134` | `zone_extensions` dropped (`floor_zones` already listed) | §1.1 |
| `apps/server/src/management-api.station-disable.test.ts:129`, `apps/server/src/station-delete.test.ts:146` | `station_day_states` leaves each snapshot list (the station rows carry the columns) | §1.15 |
| `apps/server/src/configuration-transfer.test.ts:5993, :5998` | `not.toHaveProperty("station_day_states")` would pass checking nothing; each becomes: every bundled `kitchen_stations` row has no `closed_on_day` and no `closed_sends_to_station_id` key | §1.15, §5 (export `omit`) |
| `packages/venue-service/src/hours.live.test.ts:227` | `["station_day_states"]` → `["kitchen_stations"]` | §1.15 |

## Needs

- fk1 (the `floor_zones` columns this adds to), fk0 (`lib/fold-inserts.mjs`).
- Batch 1: 1a (rebuild command), 2 (`activity_log` and its writer), 5 (no `location_id`).

## Assumptions about batch 1

- **B2 (slice 2), as its plan
  ([2026-11-08-a1308-2-activity-log.md](2026-11-08-a1308-2-activity-log.md), "Interfaces") names
  them:** `recordActivity(tx, { kind, subjectId, personId, deviceId?, data, at? })` from
  `@waitron/db` (`packages/db/src/activity-log.ts`); each kind is declared in
  `packages/db/src/activity-kinds.ts` twice — its `data` type in `ActivityKindData` and its subject
  in `ACTIVITY_KINDS` (`{ subject: "zone" }`, `{ subject: "station" }`) — so a caller never passes
  the subject kind. `personId` is "the signed-in person whose request this is"; `activity_log.person_id`
  has a key to `persons`. If the landed slice differs, use what landed.
- B1, B3, B4 as in [fk1](2026-11-08-a1308-fk1-zone-service-rules.md#assumptions-about-batch-1).

## In-flight work folded in

- None found: `grep -l -E "zone_extensions|station_day_states"` over the plans dated after
  2026-11-01 finds only slice 5's source plan. A1403 and A1378 change no table.

## Global constraints

- Rules §1–§9. The value read for "today" is always compared with today's business day from
  `venueMoment` (`station-times.ts:8-10`); a stored day other than today means "not set".
- `activity_log` rows carry a count or a time, never anything a guest said.

## Review Focus

1. **A value left over from yesterday.** No writer clears it at the day change; every reader must
   compare the stored day. Test: Task 3's `yesterday's keep-open and closure read as not set`.
2. **Ending a keep-open that was never set**, and reopening a station not closed today, write no
   history row. Test: Task 2's `no history for a change that changes nothing`.
3. **Deleting the destination station** clears `closed_sends_to_station_id` on every station that
   named it, keeping their closure. Test: the existing `station-delete-settings.test.ts` cases,
   assertions unchanged.
4. **The station closed from a kitchen display** (no signed-in person; the PIN's person) records that
   person and the display's device. Test: Task 2.
5. **Export carries neither today value; import starts every zone and station open.** Test: Task 4.

---

## Task 0: Base protection list

- [ ] As fk1 Task 0 (rules §3); keep `<A>`.

## Task 1: Schema, and the fixture script

**Interfaces:**
- Produces: `floorZones.keptOpenDay: string | null`, `keptOpenFrom: string | null`,
  `keptOpenUntil: string | null`; `kitchenStations.closedOnDay: string | null`,
  `closedSendsToStationId: string | null`.

- [ ] **Step 1: Write the failing tests** (`packages/db/src/schema/floor-zones.test.ts`,
  `kitchen-stations.test.ts`), asserting the constraint name in the refusal:
  `refuses a keep-open with a day and no times` (`floor_zones_kept_open_ck`); `refuses 21:10`
  (`floor_zones_kept_open_step_ck`); `stores a quarter-hour keep-open` (succeeds);
  `refuses a destination while open` (`kitchen_stations_closed_sends_to_ck`); `refuses a station
  sending to itself` (`kitchen_stations_closed_sends_to_not_self_ck`); `refuses a destination that
  does not exist` (`FOREIGN KEY constraint failed`); `stores a closure with no destination`
  (succeeds). For each of the six new CHECKs, a refusal and a legitimate write:
  `refuses a warm limit of 0` (`kitchen_stations_warm_after_ck`) / `accepts 1 minute`;
  `refuses a ready warning of 0` (`kitchen_stations_ready_warning_after_ck`) / `accepts 1`;
  `refuses colour "mauve"` (`kitchen_stations_colour_ck`) / `accepts every STATION_COLOURS value`;
  the same pair for `ticket_grouping` ("stacked"), `bump_mode` ("order") and
  `changes_after_sending` ("always"), each accepting every value of its list.
- [ ] **Step 2: Run** `pnpm --filter @waitron/db exec vitest run src/schema`; expect failures.
- [ ] **Step 3: Implement.** `check("floor_zones_kept_open_ck", sql\`(${t.keptOpenDay} is null and
  ${t.keptOpenFrom} is null and ${t.keptOpenUntil} is null) or (${t.keptOpenDay} is not null and
  ${t.keptOpenFrom} is not null and ${t.keptOpenUntil} is not null)\`)`;
  `floor_zones_kept_open_step_ck` is `zone_extensions_step_ck`'s expression
  (`zone-extensions.ts:21-25`) on the two new columns. The station's self key uses a lazy reference
  (`(): AnySQLiteColumn => kitchenStations.id`); `kitchen_stations_closed_sends_to_ck`:
  `closed_sends_to_station_id is null or closed_on_day is not null`; the not-self CHECK as
  `station_day_states_sends_to_not_self_ck` was. Delete both old tables and their exports,
  classifications and `schema-constraints.test.ts` rows; add `["kitchen_stations",
  ["closed_sends_to_station_id"], "kitchen_stations"]`. Add `omit: ["kept_open_day",
  "kept_open_from", "kept_open_until"]` to `floor_zones` and `omit: ["closed_on_day",
  "closed_sends_to_station_id"]` to `kitchen_stations` in `CORE_CONFIGURATION_TRANSFER`. Add the six
  CHECKs: `check("kitchen_stations_warm_after_ck", sql\`${t.warmAfterMinutes} >= 1\`)`, the same for
  `ready_warning_after_minutes`, and for each list column `check("kitchen_stations_colour_ck",
  sql\`${t.colour} in (${sql.raw(STATION_COLOURS.map(quoteLiteral).join(", "))})\`)` (`quoteLiteral`
  from `@waitron/shared`, as `change-feed.ts:3` imports it). Delete the six comments at
  `kitchen-stations.ts:18, 22, 29, 31, 34, 36`.
- [ ] **Step 4: Rebuild** core (`migration-baseline rebuild --set core`) and run Step 2; expect pass.
- [ ] **Step 5: The fixture script.** `scripts/a1308/fk2-today-fixtures.mjs` calls `runFoldCli` with
  `{ child: "zoneExtensions", parent: "floorZones", key: "zoneId", fields: { businessDay:
  "keptOpenDay", startsAt: "keptOpenFrom", endsAt: "keptOpenUntil", id: null } }` and `{ child:
  "stationDayStates", parent: "kitchenStations", key: "stationId", fields: { businessDay:
  "closedOnDay", sendsToStationId: "closedSendsToStationId", open: null, id: null } }`. Its test:
  one case per rule, and idempotence. Run it with `--write`, prettier, hand-edit what it reports,
  list the hand edits in the pull request.
- [ ] **Step 6: Commit** schema; script and its output; hand edits — three commits.

## Task 2: Writers and the history

**Interfaces:**
- Produces: `seedPerson(db: Database | Transaction, input?: { id?: string; displayName?: string }):
  Promise<string>` in `packages/db/src/testing/seed.ts` — inserts a `persons` row (`display_name`
  defaults to `"Test person"`; the shape of identity's `seedPerson`,
  `packages/identity/test/fixtures.ts:33-44`, which `@waitron/db` cannot import),
  `onConflictDoNothing` on `id`, answers the id. fk6 reuses it.
- Produces: `type ActivityActor = { personId: string | null; deviceId: string | null;
  authorizedBy: string }` in `packages/module/src/module.ts`. `personId` is the signed-in person
  (`requireSession(...).personId`, `apps/server/src/till-session.ts:95-99`), or, on a kitchen display
  where nobody is signed in, the PIN's person; `authorizedBy` is the person `authorize`/`authorizeByPin`
  answers (the manager who approved, when an override was used, else the signed-in person). README
  §10 "Applied as the design": "`authorized_by` stays inside `activity_log.data`".
- `keepZoneOpen(tx, zoneId, input: { until: string | null }, at: Date, actor: ActivityActor):
  Promise<void>`; `closeStationForToday(tx, stationId, sendsToStationId, at, actor)`;
  `openStationForToday(tx, stationId, at, actor)`; `setStationToday(tx, stationId, state, at,
  actor, sendsToStationId?)`.
- Four kinds in `packages/db/src/activity-kinds.ts` (slice 2's registry):
  `"zone.kept_open"` and `"zone.keep_open_ended"`, `{ subject: "zone" }`, data `{ businessDay:
  string; from: string; until: string; authorizedBy: string }` (for the end, the values ended);
  `"station.closed_for_day"` and `"station.reopened"`, `{ subject: "station" }`, data `{
  businessDay: string; sendsTo: string | null; authorizedBy: string }` (for a reopening, the
  destination it had). The design's data (§3) plus `authorizedBy`.

- [ ] **Step 1: Write the failing tests** in `packages/venue-service/src/todays-choices-history.test.ts`
  (`useVenueDb`, a person from `seedPerson` and a device from `seedDevice`, since
  `activity_log.device_id` has a key to `devices`):
  - `keeping a zone open writes the columns and one history row` — after `keepZoneOpen(…, { until:
    "23:30" }, at, actor)`: the zone's `kept_open_day` is today's business day, `kept_open_until`
    `'23:30'`; one `activity_log` row with `kind = 'zone.kept_open'`, `subject_kind = 'zone'`, `person_id =
    actor.personId`, `device_id = actor.deviceId`, `data = { businessDay, from, until: "23:30",
    authorizedBy }`.
  - `ending the keep-open clears the columns and records the end` — then `{ until: null }`: all three
    null; a `zone.keep_open_ended` row with the ended `from`/`until`.
  - `no history for a change that changes nothing` — `{ until: null }` on a zone not kept open, and
    `openStationForToday` on a station not closed today, add no row.
  - `closing a station writes the columns and one history row`; `reopening it clears both and
    records the destination it had`.
  - `a manager's override is recorded as the authoriser` — a staff session closes a station with a
    manager's PIN override: `person_id` is the staff member, `data.authorizedBy` the manager.
  - `a kitchen display's PIN closure records the PIN's person and the display` — through the route
    at `apps/server/src/station-today-api.ts:71-116` (put this case in `apps/server/src/till-api.station-today.test.ts`).
- [ ] **Step 2: Run**; expect fail.
- [ ] **Step 3: Implement.** `keepZoneOpen` reads the zone's three columns, computes as today
  (`keep-open.ts:121-163` unchanged), then one `update(floorZones)`: the three values, or all null for
  `until: null`. `setStationToday` replaces its delete/insert pair (`station-times.ts:34-65`) with one
  `update(kitchenStations)`: `closedOnDay = moment.businessDay` and the destination for `"closed"`,
  both null otherwise. Each writes its history row through `recordActivity` only when the stored
  value for today changed. Pass `actor` from `keep-open-api.ts` (`{ personId: session.personId, deviceId:
  session.deviceId, authorizedBy }`, where `authorize(...)` already answers `authorizedBy`, today
  discarded at :50-51) and from both station routes (the till route: the session's person and
  device with `authorizedBy`; the display route, `station-today-api.ts:71-116`: `personId` and
  `authorizedBy` both the PIN's person, `deviceId` the display's). Declare the four kinds.
- [ ] **Step 4: Run**; expect pass. Update the other callers' tests to pass an actor whose persons
  exist (`activity_log.person_id` has a key): the venue fixture's seeded person where it has one,
  else `seedPerson` (this task's Interfaces). `activity_log.device_id` has a key to `devices` too:
  pass `deviceId: null`, or a device made with `seedDevice` (`packages/db/src/testing/seed.ts:85`).
- [ ] **Step 5: Commit.**

## Task 3: Readers and delete paths

- [ ] **Step 1: Write the failing test** `yesterday's keep-open and closure read as not set` (in
  `zone-closed-times.test.ts` and `routing-store.test.ts`): columns stamped with yesterday's day; the
  zone's closed times are not lifted and the station reads open, its destination unused.
- [ ] **Step 2: Implement.** `zone-closed-times.ts:225-240` selects `floorZones.id`,
  `keptOpenFrom`, `keptOpenUntil` where `keptOpenDay = moment.businessDay` (and the zone filter);
  `business-day-schedule.ts:288-299` likewise with `tonight`, joined only to `floorZones` and
  `departments` (fk1 already dropped the policy join); `routing-store.ts:410-425` reads
  `closedOnDay`/`closedSendsToStationId` from the station rows it already selected, closed when
  `closedOnDay === businessDay`. `service-delete-settings.ts`: the impact count at :70-74/:304 counts
  the zones whose `kept_open_day` is not null (keep the impact key `zone_extensions`: it is the
  dashboard's copy key, `service-delete-copy.ts:18`, not a table name); the delete at :375 joins
  fk1's clearing update (add the three columns to its `set`). `station-delete-settings.ts:65-74`
  reads the station's own closure and the stations whose `closedSendsToStationId` is this one;
  :150-166 clears this station's two columns and sets `closedSendsToStationId = null` on those.
- [ ] **Step 3: Run** the Finish-line venue-service command; expect pass.
- [ ] **Step 4: Commit.**

## Task 4: Live queries, the export round trip, docs, finish

- [ ] **Step 1: Write the failing test** `apps/server/src/configuration-transfer.floor-kitchen.test.ts`
  (this file grows in fk4 and fk7; appendix §8 item 6): seed a venue, keep a zone open and close a
  station for today, export. Assert the bundle's `floor_zones` rows have no `kept_open_day`,
  `kept_open_from`, `kept_open_until` keys and its `kitchen_stations` rows no `closed_on_day`,
  `closed_sends_to_station_id` keys; import into a second venue and assert all five columns are null
  there. **Failing result named in advance:** any of the five keys in the bundle, or a non-null
  value after import. The design's answer to a failure is the `omit` entry, which Task 1 added; a
  failure here means the entry is not being read, which is a stop (rules §5.4).
- [ ] **Step 2: Run, see it pass** (Task 1 added the `omit` entries; to see it fail first, run it
  once with the two `omit` entries removed, then restore them — record both runs in the pull
  request).
- [ ] **Step 3:** Replace `"zone_extensions"` with `"floor_zones"` and `"station_day_states"` with
  `"kitchen_stations"` in both `live-queries.ts` files, de-duplicating; remove both from
  `clear-provision-fixture.ts`; update the tests the "Assertions that change, by design" table lists. Fold the two tables
  into `floor_zones`/`kitchen_stations` in the Madrid baseline (fk1 Task 6's helper; match on
  `zone_id`/`station_id`; the seed writes no rows to either, so the fold only drops the tables).
- [ ] **Step 4: Docs.** In conventions-data.md "Today's station destination and zone extension",
  name the columns and their omission, and replace "The approved slice 3 decision 14 leaves the
  authorising person unstored; the open history decision is in `docs/backlog/service-periods.md`"
  with one sentence: each change and its authorising person are written to `activity_log`
  (`zone.kept_open`, `zone.keep_open_ended`, `station.closed_for_day`, `station.reopened`). Delete
  the backlog entry and its detail section.
- [ ] **Step 5: Protection list** `list --out <B>`, `compare`, paste and mark against the table.
- [ ] **Step 6:** Finish line, then `/finish-branch`.
