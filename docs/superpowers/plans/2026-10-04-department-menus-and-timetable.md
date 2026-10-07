# Department menus and timetable — implementation plan (W98)

> **For agentic workers:** implement each task test-first: write the failing behavioural test,
> run it and watch it fail for the stated reason, then the minimal implementation. Use
> `superpowers:subagent-driven-development`; one implementer per task, in this worktree, in order.
> **Existing assertions:** a task may edit only the assertions listed for it in "Assertions the
> approved design changes" at the end, and only in a separate commit of its own whose message
> begins `Changed test checks (awaiting owner exception, questions.md W98 A):` and lists each
> `file:line` with its before and after. No other existing assertion may change. An assertion
> not on the list that turns out to need changing is a STOP: report it, do not edit it. Adding
> fixture rows, stub methods, or a new key to a whole-shape pin is allowed (listed at the end).

> **Rewritten 2026-10-07** against `main` at `7d10d2ccc`, after A261 step 2 (#1233 and 2c–2e),
> step 5 Hours (#1298), step 6 public holidays (#1305) and W97 profile access (#1311) landed.
> **Revised the same day** after a fresh-context review (findings F1–F21; the runner's decisions
> are recorded in `~/waitron-campaign-b/questions.md`, W98). Every `file:line` below was read at
> `7d10d2ccc`; claims marked **(measured)** were run, everything else was read.

**Goal:** each department owns one ordered available-menu list and the only menu timetable:
named periods (each with the department's default menu), placed as time slots on a normal week
and on special dates from the shared Hours calendar, plus an all-day default for the gaps. A zone
may override only the default — for one named period, wherever that period runs, or for the
all-day gaps. Staff can order from any menu in the list at any time. Recorded lines are never
rewritten.

**Spec:** [Devices, menus and service zones](../specs/2026-10-04-devices-menus-and-service-zones-design.md)
§§1, 2, 8, 9 ("Time", "Removed menus"), 10; [Venue operations](../specs/2026-10-03-venue-operations-design.md)
§4 (`:158-159`, "Not in this table: menus … belongs on the Menus screen"), §7 (Hours, special
dates), §8. Backlog entry: "Department menu timetables and queued publication"
(`docs/backlog.md:1026`), and the hand-on notes at `docs/backlog.md:4461` and `:4582`.
Forward-only publication is a separate plan (`2026-10-04-forward-only-menu-publication.md`).

**Risk triggers present** (review weight): a migration that rebuilds a table and needs a venue
reset; a cross-package contract (`VenueServiceContribution`, `packages/module/src/module.ts`).
Full `/finish-branch` ceremony.

---

## Survey of the current code (what the tasks change)

### 1. Every consumer of per-zone menus today

Storage, `packages/venue-service/src/schema/service.ts`:
- `zone_service_policies.default_menu_id` (`:68`) with key `zone_service_policies_default_menu_fk`
  to `catalogues` (`:88-92`) and the cycle key `zone_service_policies_default_allowed_fk`
  `(zone_id, default_menu_id) -> zone_menus(zone_id, menu_id)` (`:93-101`).
- `zone_menus (zone_id, menu_id, display_order)` (`:179-200`), whose `zone_id` cascades from
  `zone_service_policies` (`:188-192`); `ZONE_MENU_KEY` closes the cycle (`:206`). This is the
  "default-menu foreign-key cycle": a policy row must be inserted with a null default, then its
  `zone_menus` rows, then the default named (comment `:93-96`).

Venue-service code, `packages/venue-service/src/operations.ts`:
- `listZoneMenuAssignments` `:76-95` (dashboard model `zoneMenus`); `listVenueReadiness`
  `:319-406` (left-joins `zone_menus` on the zone default; issues `zone.menu_missing`,
  `zone.menu_unpublished`, `zone.menu_empty` per zone); `configureZone` `:409-443`;
  `allowMenuInZone` `:483-518`; `resolveZoneContext` `:520-558` and `resolveNewOrderZone`
  `:830-864` (both return the zone's `defaultMenuId`); `zoneMenuIdsByZone` `:724-738`;
  `zoneMenuIds` `:741-749`; `zoneLiveDocuments` `:756-767`; `listZoneOffers` `:777-808`
  (default = zone default, or the first published menu when that default is not served,
  `:793-797`); `menuState` `:814-823`.
- Seat: `VENUE_SERVICE` (`packages/venue-service/src/service.ts:53-95`); contract in
  `packages/module/src/module.ts:246-264` (`ZoneOffers`, `ZoneMenuState`) and `:330-420`;
  re-exported from `packages/module/src/index.ts`.
- Routes, `packages/venue-service/src/routes.ts`: error-to-status map `STATUS` `:79-109`;
  `GET /management-api/venue-service` returns `zoneMenus` and `readiness` (`:627-643`);
  `PUT /management-api/venue-service/zones/:zoneId/menus/:menuId` calls `allowMenuInZone`
  (`:919-934`); no delete route. Special-date routes `:379-431` (only duplicate and delete pass
  `VENUE_SERVICE_CALENDAR_PARTICIPANTS`; `PUT …/special-dates/:id` at `:391-399` does not).
- Provisioning, `packages/venue-service/src/provisioning.ts:104-118`: inserts the counter zone's
  `zone_menus` row for `locations.catalogue_id` and sets the zone default where null.
- Transfer, `packages/venue-service/src/configuration-transfer.ts:316-337`: `zone_menus` is a
  plain entry (`:320`); `zone_service_policies.default_menu_id` is remapped as a key. The cycle is
  handled by `pragma defer_foreign_keys = on` in `apps/server/src/configuration-transfer.ts:648-655`,
  whose comment names the `zone_menus` cycle.
- Classification `packages/venue-service/src/classification.ts:13`; dashboard live query
  `packages/venue-service/src/dashboard/live-queries.ts:62`.
- Dashboard: `packages/venue-service/src/dashboard/client.ts` (`ZoneMenu` `:23-28`, model
  `zoneMenus` `:70`, `allowMenu` → `PUT …/zones/:id/menus/:menuId` `:221-231`);
  `venue-operations-screen.ts` (readiness messages `:556-561`, "Make available" under a zone's
  `zone.menu_missing` `:678-690`, tree action `menus-tree-zone-*` `:1176-1179`, zones-table
  "default" column `:1330-1338`, `#zoneMenus()` table `:1358-1430`, assignment editor
  `:1518-1560`); strings `strings.ts:270, 316, 352-354, 852, 899, 935-937`; the module's screen
  list `dashboard/index.ts:12-111`, whose `moreScreens[0]` (Prep stations) and `[1]` (Hours) are
  pinned by position in `dashboard/index.test.ts:166, 222`.
- `zoneMenus: []` fixture keys (typed as the model): `dashboard/index.test.ts:102`,
  `venue-navigation.test.ts:15`, `client.test.ts:108, 260, 307`,
  `venue-operations-screen.a11y.test.ts:21, 61, 101, 171`, `venue-operations-screen.test.ts:61`
  and spread rows `:2212, 2531, 2548, 2567, 2680, 3034, 3196`,
  `apps/dashboard/src/dashboard-app.test.ts:1662, 3725, 3792`.

Server (`apps/server`):
- `till-api.ts`: `GET /api/default-service-zone/offers` `:1300-1325`,
  `GET /api/service-zones/:zoneId/offers` `:1329-1349` (both spread `listZoneOffers`),
  `GET /api/menu-state` `:1351-1371` (returns `menuState`); till status map
  `menu.version_changed` 409 (`:389`), `service_zone.offer_not_allowed` 400 (`:450`).
- Line pricing: `readBasketOffers` (`working-order.ts:347-379`) and `priceOrderLines`
  (`:409-475`) price every new line from `listZoneOffers` of the ORDER's zone, refusing an offer
  the zone does not serve with `service_zone.offer_not_allowed` (`:457-461`) and an asserted
  version that is no longer live with `menu.version_changed` (`assertLiveVersions`,
  `packages/catalogue/src/menu-publication.ts:189-207`). `order-drafts.ts:759-770` (`offersFor`)
  reads offers the same way; `working-order.ts:437` builds an empty `ZoneOffers`. **The server
  already enforces membership + live version from current rows, never from a client list; Task 1
  changes where membership is read and that enforcement follows.**
- Demo seed: `scripts/demo-seed/seed-floor.ts:132-146, 162-171, 245-252` (per-zone rows, already
  uniform per department); `seed-catalogue.ts:97-101` reads the counter zone's `default_menu_id`.
- Test support: `src/testing/zone-offers.ts:13, 73-76`; `src/testing/party-venue.ts:25, 409-428`
  (`pricedInZone`); `src/testing/clear-provision-fixture.ts:30-32`; raw `insert into zone_menus` in
  many suites (listed per task).

Till (`apps/till`): reads `defaultMenuId`/`menus[].isDefault` from the offers answers only
(`till-app.ts:1936-1973, 2302-2320, 2489-2507, 4307-4311`); `menu-filter.ts:50` picks the
`isDefault` menu else the first. No till code knows about `zone_menus` (the till's `ZoneMenu`
names are the module's offer types, not the table).

### 2. The Hours calendar model (A261 steps 5–6)

- Tables, `packages/venue-service/src/schema/hours.ts`: `hours_week_cells` (`:30-63`) with
  `hours_week_periods` (`:65-83`); `special_dates` (`:85-109`, one per location and date) with
  `special_date_hours` (`:111-148`) and `special_date_hours_periods` (`:150-168`). "No hours set"
  and "inherit the week" are stored as no row (`docs/developers/conventions-data.md:356-386`).
- Periods are wall-clock `HH:MM` on the wire, stored `HH:MM:SS` through `storedTime`
  (`operations.ts:72-74`); an end at or before the start runs past midnight and belongs to the
  opening date (`hours-rules.ts:68-82`, `cellIntervals`); start included, end excluded
  (`Interval`, `:23-27`). Overlap inside a cell is refused (`parseCell` `:121-148`), across a
  midnight by `tailOverlaps` (`:84-90`); special dates are checked against their neighbours
  (`hours.ts:530-589`).
- Which hours apply on local date D: `resolveSubjects` / `resolveOpeningDateHours`
  (`hours.ts:910-1003`). The instant-level rule is `stationStatus` (`routing.ts:110-141`):
  today's periods by wall time plus yesterday's overnight tail; an unreadable clock applies no
  time (`:117`).
- Venue time zone: `readLocationClock` (`packages/reporting/src/business-day.ts:220-230`) →
  `venueLocalMoment` (`hours-clock.ts:18-25`) gives `civilDate`, `weekday`, `timeOfDay`.
- Clock changes: a special-date period opening or closing at a minute the clock skips is refused
  (`skippedEndpoint`, `hours-clock.ts:68-82`; `hours.ts:600-610, 833-838`); a time the clock
  shows twice is explained, not refused (`repeatedTimes`, `hours-occurrences.ts:54-67`, used by
  `dashboard/hours-screen.ts:941-980`). Week periods carry no clock-change check. Test support:
  `src/testing/clock-change.ts` (`clockChangeAfter`).
- The extension seam for this item: `SpecialDateParticipant { copy; beforeDelete }`
  (`hours.ts:779-788`, documented "such as a menu timetable's overrides"), passed by
  `duplicateSpecialDate` (`:795-883`), `deleteSpecialDate` (`:890-904`) and holidays'
  `duplicateHolidayNamedSpecialDates` (`holidays.ts:387-406`); not by `saveSpecialDate`
  (`:661-756`). The list `VENUE_SERVICE_CALENDAR_PARTICIPANTS` is empty
  (`calendar-participants.ts:4`). The Hours plan requires W98's rows to hang off `special_dates`
  with a cascading key and `beforeDelete` to only refuse
  (`docs/superpowers/plans/2026-10-05-hours.md:149-151`). The Hours dialog places a refusal by its
  `params.date` for `special_date.date_taken` on a duplicate (`hours-screen.ts:643-647`) and by
  `field` for `hours.invalid` (`:619-649`).

**Decision (spec §2, "A special-date menu timetable replaces that department's normal timetable
for the date. The calendar is shared with opening hours"):** menu timetables are NEW rows, not
opening-hours rows: opening hours are public hours (venue operations §7: they never stop a sale)
and a menu period has different boundaries and a menu. What is shared is the calendar: a
special-date menu timetable is keyed by `special_dates.id` (cascade), so a date is created,
renamed, moved, duplicated and deleted on Hours, and a department either has a menu timetable on
it (replacing its normal week that date, possibly with no slots, meaning the all-day default all
day) or has none (normal week).

**Decision F1 (Q13):** the stable identity a zone overrides is a **named department period**
(`menu_periods`: "Mañanas", default menu Desayunos). The normal week and each special-date
timetable hold **time slots** pointing at a named period. A zone's override attaches to the named
period, so Barra's "Mañanas → Café" holds every day Mañanas runs, whatever its slots on that day,
and survives re-editing the week. A per-slot override (the earlier draft) would have bound
Barra's choice to Monday's 09:00 slot only.

### 3. How the till picks and browses menus today, and where W97 enforces zones

- Server: the profile's starting zone is resolved by `resolveNewOrderZone`
  (`operations.ts:830-864`); a named zone, order, party or table is checked against the profile by
  `checkZones`/`assertSubjectZones` (`apps/server/src/zone-access.ts:37-71`), refusing
  `service_zone.not_allowed`; the default-zone answer lists only allowed counter zones
  (`till-api.ts:1311-1318`).
- Till: `#browsing { personId, zoneId, menuId | null }` (`till-app.ts:1369-1371`; null = following
  the zone's default). Sign-in (`#enterSignedIn`, `:1917-1980`) returns the same person to the zone
  and manual menu they left and starts anyone else at the profile's starting zone and its default;
  a zone change (`#onCounterZoneSelected`, `:2291-2326`) selects the new zone's default; a manual
  pick (`#onMenuSelected`, `:2247-2255`) records it. These owner rules are **already pinned** by
  `apps/till/src/till-app.test.ts:10795-10933`: do not duplicate them. What is missing is time:
  the default is read once per offers answer, and the 15-second `MenuStatePoll`
  (`state/menu-state-poll.ts`, wired at `till-app.ts:1328-1339`, handled by `#onMenuState`
  `:2466-2487`) carries versions and availability only.

### 4. Where menus are edited and where they belong

Today the per-zone list and default are edited on Departments and zones
(`venue-operations-screen.ts:1358-1430, 1518-1560`), the interim path A261 step 2 kept
(`docs/superpowers/plans/2026-10-04-departments-and-zones.md:40`). Venue operations §4
(`2026-10-03-venue-operations-design.md:158-159`) says menus "belong on the Menus screen", and
the devices spec §10 (`2026-10-04-devices-menus-and-service-zones-design.md:305`) says "Retain the
placement of menu configuration on Menus". The plan departs from the letter of both (Q1): the
Menus screen (`apps/dashboard/src/screens/menus-screen.ts`) is core and may not name a module,
and `DashboardContribution` (`packages/dashboard-kit/src/contract.ts:34-63`) offers only whole
screens (`moreScreens`, `:61`) and Venue settings panels (`settingsPanels`, `:62`), with no seat
for a panel inside a core screen. A module screen can sit in the core "menu" nav group
(`apps/dashboard/src/dashboard-app.ts:189-197`; module screens follow that group's core items,
`:1637-1655`).

---

## Global constraints

- **Migrations** are generated with `pnpm --filter @waitron/venue-service db:generate` against the
  current tree; never hardcode a number. Generate **additions and removals in separate
  generations**: drizzle-kit 0.31.11 asks interactively "created or renamed from another …?" when
  one generation both adds and drops entities (`node_modules/.pnpm/drizzle-kit@0.31.11/node_modules/drizzle-kit/bin.cjs:7478`,
  read, not run); if a prompt appears anyway, stop and report. Read every generated `.sql` before
  running it. A rebuild must not also add a column (`conventions-data.md:1620-1645`); no new table
  here has an expression index. No new table may reference `zone_service_policies` (it is rebuilt
  in Task 1); reference `floor_zones` instead.
- **Reset-required release.** Task 1's removal generation rebuilds `zone_service_policies`.
  Inbound keys to it: `zone_sale_policies.zone_id` (no action; `configureZone` writes a row for
  every configured zone, `operations.ts:438-441`) and `zone_menus.zone_id` (cascade; dropped in
  the same generation); and `zone_service_policies` itself holds a no-action key into `zone_menus`.
  **(measured, 2026-10-07, `node:sqlite`, Node v26.7.0, `/tmp/w98-probe/probe.mjs`):** one
  particular statement order — the rebuild of `zone_service_policies` first, then `DROP TABLE
  zone_menus` — inside `BEGIN … COMMIT` over one policy row, one `zone_menus` row and one
  `zone_sale_policies` row failed at `DROP TABLE zone_service_policies` with `FOREIGN KEY
  constraint failed`; with `PRAGMA defer_foreign_keys=ON` first, every statement ran and the
  COMMIT failed with the same message. The generated migration may order its statements
  differently and fail elsewhere; **do not predict** which statement or text the upgrade walk will
  report. Run `scripts/migration-upgrade.test.ts`, and add the `RESETS` entry with exactly the
  text it printed (precedent `venue-service/0020_retire_invoice_first`, `:247-249`). The PR's first
  line says every populated venue must be reset; so does the backlog entry. After the branch
  lands, the shared dev venue needs `wa-wt reset demo <name>`. (Q9 offers the retire-in-place
  alternative.)
- No backwards-compatibility or data-migration code (CLAUDE.md §3): old `zone_menus` rows are not
  carried into department rows.
- Every new table is classified `state` in `VENUE_SERVICE_CLASSIFICATION`, none append-only;
  declare every key and unique index in TypeScript; `state` tables only, so no cross-class keys.
  Every multi-table write runs inside the caller's one `tx`; reads on a `tx` are awaited in turn,
  never `Promise.all`.
- Times are stored `HH:MM:SS` through `storedTime` and compared as wall-clock `HH:MM`, exactly as
  Hours does. Start included, end excluded; a slot whose end is at or before its start runs past
  midnight and belongs to the date it starts.
- New refusals assert the domain code (`toMatchObject({ code, params })`), never
  `toBeInstanceOf(Error)`. A test that expects a refusal from a write catches it OUTSIDE the
  transaction, around the whole `withTransaction` (CLAUDE.md §3). New codes (none is an incident
  code, so no alert wording; dashboard strings in English and Spanish), each added to
  `STATUS` in `packages/venue-service/src/routes.ts:79-109` with a route test asserting the status:
  - `department_menu.not_found` `{ departmentId, menuId }` → 404: a default, period or zone
    override names a menu the department's list does not hold.
  - `department_menu.in_use` `{ departmentId, menuId, uses: MenuUse[] }` → 409, where
    `MenuUse = { kind: "department_all_day" } | { kind: "period"; periodId } |
    { kind: "zone_all_day"; zoneId } | { kind: "zone_period"; zoneId; periodId }`: removing a menu
    something still names, listing every such use (inactive zones included).
  - `menu_period.not_found` `{ periodId }` → 404.
  - `menu_period.in_use` `{ periodId, uses: ({ kind: "week"; weekday } | { kind: "special_date";
    specialDateId; date })[] }` → 409: deleting a named period still placed on a day, past
    special dates included.
  - `menu_timetable.invalid` `{ field: string; date?: string; departmentId?: string }` → 400: same
    shape and field-path convention as `hours.invalid` (`errors.ts:55-59`).
  Reuse `department.not_found`, `service_zone.not_found`, `catalogue.not_found`,
  `special_date.not_found`, `management.request_invalid`, `setup.request_invalid`.
- **No menu is unremovable:** every use a refusal names is visible and clearable through the
  editor's model and routes — inactive zones' overrides, named periods, and past special dates'
  timetables included.
- Fixtures use DISTINCT names. Menus: **Desayunos**, **Almuerzo**, **Cena**, **Bebidas**
  (all-day), **Café** (Barra's breakfast override), **Cócteles** (Barra's evening override),
  **Copas** (overnight), **Deli para llevar** (Deli's menu), **Brunch de Navidad** (special date).
  Named Restaurant periods: **Mañanas** (Desayunos), **Mediodía** (Almuerzo), **Noches** (Cena),
  **Madrugada** (Copas), **Brunch navideño** (Brunch de Navidad). Zones: **Barra**, **Sala**,
  **Terraza** in Restaurant; **Mostrador deli** in Deli. Venue zone `Europe/Madrid`.
- Do not edit a shipped migration. Inspect every changed screen in both themes at 390 px and
  1280 px. Run focused tests while implementing; CI runs the package suites (CLAUDE.md §2).
- Schema-change guard commands (run after every generation):
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/id-columns-are-references.test.ts scripts/module-graph-honesty.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`. Read each run's
  `Tests` count.

## Schema (all in a new `packages/venue-service/src/schema/menus.ts`, exported from `schema/index.ts`)

Task 1 (generation A, additions only):

| Table | Columns | Keys and constraints |
| --- | --- | --- |
| `department_menus` | `department_id` id not null, `menu_id` id not null, `display_order` count not null default 0 | PK `department_menus_pk (department_id, menu_id)`; FK `department_menus_department_fk` → `departments(id)`; FK `department_menus_menu_fk` → `catalogues(id)`; index `department_menus_order_idx (department_id, display_order)` (not unique: list writes upsert in place) |
| `department_all_day_menus` | `department_id` id PK, `menu_id` id not null | FK `department_all_day_menus_member_fk (department_id, menu_id)` → `department_menus(department_id, menu_id)` |
| `zone_all_day_menus` | `zone_id` id PK, `department_id` id not null, `menu_id` id not null | FK `zone_all_day_menus_zone_fk` → `floor_zones(id)`; FK `zone_all_day_menus_member_fk (department_id, menu_id)` → `department_menus` |

Task 1 (generation B, removals only): drop `zone_menus`; drop `zone_service_policies.default_menu_id`
with both its keys (drizzle rebuilds `zone_service_policies`; reset-required, above).

Task 2 (generation C, additions only):

| Table | Columns | Keys and constraints |
| --- | --- | --- |
| `menu_periods` (named periods) | `id` id PK `$defaultFn(newId)`, `department_id` id not null, `name` label not null, `menu_id` id not null | FK → `departments(id)`; FK `menu_periods_member_fk (department_id, menu_id)` → `department_menus`; unique `menu_periods_department_name_key (department_id, name)`; unique `menu_periods_department_key (id, department_id)` (target of the composite keys below); CHECK `menu_periods_name_ck` `trim(name) <> ''` |
| `menu_day_timetables` | `id` id PK `$defaultFn(newId)`, `department_id` id not null, `weekday` count null, `special_date_id` id null | FK → `departments(id)`; FK `menu_day_timetables_date_fk` → `special_dates(id)` **on delete cascade**; CHECK `menu_day_timetables_one_day_ck` `(weekday is null) <> (special_date_id is null)`; CHECK `menu_day_timetables_weekday_ck` `weekday is null or weekday between 0 and 6`; unique `menu_day_timetables_week_key (department_id, weekday) where weekday is not null`; unique `menu_day_timetables_date_key (special_date_id, department_id) where special_date_id is not null`; unique `menu_day_timetables_department_key (id, department_id)` |
| `menu_slots` | `id` id PK `$defaultFn(newId)`, `timetable_id` id not null, `department_id` id not null, `period_id` id not null, `starts_at` timeOfDay not null, `ends_at` timeOfDay not null | FK `menu_slots_timetable_fk (timetable_id, department_id)` → `menu_day_timetables(id, department_id)` **on delete cascade**; FK `menu_slots_period_fk (period_id, department_id)` → `menu_periods(id, department_id)` (no action: a slot's period is its own department's); CHECK `menu_slots_distinct_ck` `starts_at <> ends_at`; index `menu_slots_timetable_idx (timetable_id, starts_at)` |
| `zone_period_menus` | `zone_id` id not null, `period_id` id not null, `department_id` id not null, `menu_id` id not null | PK `zone_period_menus_pk (zone_id, period_id)`; FK → `floor_zones(id)`; FK `zone_period_menus_period_fk (period_id, department_id)` → `menu_periods(id, department_id)` **on delete cascade** (the override's department is the period's); FK `zone_period_menus_member_fk (department_id, menu_id)` → `department_menus` |

Nothing references a slot, so a day's slots are replaced by delete-then-insert (the `REFERENCES`
check of `conventions-data.md:292` is satisfied) and slot ids are the server's. A named period
may appear in several slots, on several days and on special dates. A week day with no
`menu_day_timetables` row has no slots (the all-day default all day). A special date with a row
for a department replaces that department's week on that date, even with zero slots; no row =
the normal week. Deleting a special date cascades its timetables and slots; zone overrides are
on named periods and are untouched. Deleting a named period is refused while any slot places it;
once none does, its zone overrides cascade with it. A zone override's `department_id` must equal
the zone's own department as well as the period's (the SQL ties only the latter): every writer
and the import `validate` check it, and `configureZone` deletes a zone's `zone_all_day_menus` AND
`zone_period_menus` rows when it moves the zone to another department.

## Seams and signatures

`packages/venue-service/src/department-menus.ts` (Task 1):

```ts
export async function listDepartmentMenus(tx: Transaction, cfg: VenueScope):
  Promise<{ departmentId: string; menuIds: string[]; allDayMenuId: string | null }[]>;
/** Replaces the ordered list. Removing a menu something still names is refused
 *  `department_menu.in_use` with every use; an unknown menu `catalogue.not_found`; a department not
 *  this venue's `department.not_found`. Writes by difference (delete removed, upsert kept), never
 *  delete-all-then-insert, because defaults and periods hold keys into the rows. */
export async function setDepartmentMenus(tx, cfg, departmentId: string, menuIds: readonly string[]): Promise<void>;
/** Appends or re-orders one menu; for provisioning, the demo seed and allowMenuInZone. The upsert
 *  names its conflict target explicitly, `target: [departmentMenus.departmentId,
 *  departmentMenus.menuId]` (CLAUDE.md §3: an untargeted conflict clause absorbs every unique
 *  conflict), and on conflict sets `display_order` only when `displayOrder` is given. */
export async function addDepartmentMenu(tx, cfg, departmentId: string, menuId: string,
  options?: { displayOrder?: number }): Promise<void>;
export async function setDepartmentAllDayMenu(tx, cfg, departmentId: string, menuId: string | null): Promise<void>;
/** `null` = inherit the department's. */
export async function setZoneAllDayMenu(tx, cfg, zoneId: string, menuId: string | null): Promise<void>;
```

`packages/venue-service/src/menu-timetable.ts` (Task 2) and browser-safe
`menu-timetable-rules.ts` / `menu-timetable-types.ts` (parsers, overlap and neighbour rules built
on `cellIntervals`, `tailOverlaps`, `effective`, `pairMatters` from `hours-rules.ts`).
**Whole-venue closure never affects menus:** `effective` (`hours-rules.ts:107-117`) answers no
intervals for a `closeWholeVenue` date before it looks at that date's cells, and the Hours plan
says department Closed must not suppress ordering or menu availability
(`docs/superpowers/plans/2026-10-05-hours.md:147`). Every call the menu rules and the resolver make
into the Hours helpers builds its `DateState` with `closeWholeVenue: false`, whatever the special
date's own flag; the resolver never reads `special_dates.close_whole_venue`:

```ts
export interface MenuPeriod { id: string; name: string; menuId: string }
export interface MenuSlot { periodId: string; startsAt: string; endsAt: string } // wire HH:MM
export interface ZoneMenuChoice {
  departmentId: string;
  /** Active member menus in department order; publication not checked here. */
  availableMenuIds: string[];
  /** In a slot: the zone's override of its named period, else the period's menu. In a gap: the
   *  zone's all-day, else the department's. Null when none is set. Before the publication fallback. */
  defaultMenuId: string | null;
  /** The named period in force at `at`; null in a gap or when the clock cannot be read. */
  periodId: string | null;
}
/** One captured instant; a fixed number of reads however many slots, periods, zones or dates. */
export async function resolveZoneMenus(tx, cfg, zoneId: string, at: Date): Promise<ZoneMenuChoice>;
export async function saveMenuPeriod(tx, cfg, departmentId: string,
  period: { id: string | null; name: string; menuId: string }): Promise<MenuPeriod>;
/** Refused `menu_period.in_use` while any slot places it (past special dates included). */
export async function deleteMenuPeriod(tx, cfg, periodId: string): Promise<void>;
export async function replaceMenuWeek(tx, cfg, departmentId: string,
  days: readonly { weekday: number; slots: MenuSlot[] }[], at: Date): Promise<void>;
/** `slots` may be empty (explicitly the all-day default all day). */
export async function saveSpecialDateMenus(tx, cfg, specialDateId: string, departmentId: string,
  slots: readonly MenuSlot[], at: Date): Promise<void>;
/** Back to the normal week on that date; allowed on a past date. */
export async function clearSpecialDateMenus(tx, cfg, specialDateId: string, departmentId: string, at: Date): Promise<void>;
/** `null` = inherit the named period's menu. */
export async function setZonePeriodMenu(tx, cfg, zoneId: string, periodId: string, menuId: string | null): Promise<void>;
export async function readMenuTimetableModel(tx, cfg, at: Date): Promise<MenuTimetableModel>;
export const MENU_TIMETABLE_CALENDAR_PARTICIPANT: SpecialDateParticipant;
```

`MenuTimetableModel`: the venue clock (`timeZone`, `clockReadable`, `civilDate`); per department
(inactive included, flagged) its ordered `menuIds`, `allDayMenuId`, named periods each with its
uses (weekdays and special dates, past ones included), the week's slots (seven days, Sunday
first), and every zone of the department (inactive included, flagged) with `allDayMenuId` and
`periodMenus: { periodId, menuId }[]`; the special dates from the venue's yesterday on, plus every
earlier special date that holds a menu timetable, each with its department timetables. Menu
names come from the existing `/management-api/catalogues` read.

Resolution at instant `at` for zone Z of department P: read the clock; if unreadable, no slot
applies. Else with `civilDate` D and `timeOfDay` t: P's timetable for D is its special-date row on
D if one exists, else its week row for `weekday(D)`; same for D−1. In force: a D slot with
`startsAt <= t` and (`t < endsAt` or it runs past midnight), else a D−1 slot running past midnight
with `t < endsAt`; when both match (only in data a writer refused, such as an import that
bypassed it), the D slot wins. Then the slot's named period gives the default (Z's override of
that period, else the period's menu). Repeated wall times follow the wall-clock rule (both
occurrences follow the timetable, as Hours explains on its page); a slot starting at a skipped
minute starts at the first minute that exists.

Contract changes, `packages/module/src/module.ts` (Tasks 2–3):
- `listZoneOffers` options gain `at?: Date` (default `new Date()`) and `withDefault?: false`.
  With `withDefault: false` the timetable is not read at all, `defaultMenuId` is `null` and no
  menu is flagged `isDefault`; the two pricing callers pass it (`readBasketOffers`,
  `working-order.ts:367, 376`, and `offersFor`, `order-drafts.ts:767`). Without it, `ZoneOffers`
  keeps its exact shape and behaviour, `menuItemIds` included (`operations.test.ts:2350-2363`
  pins that a `menuItemIds` read equals the whole read with fewer offers); `defaultMenuId` and
  `menus[].isDefault` come from `resolveZoneMenus`, then the existing "a default that is not served
  gives way to the first served menu" rule (`operations.ts:793-797`).
- `resolveZoneContext` and `resolveNewOrderZone` stop returning `defaultMenuId` (it is not in
  `OrderServiceContext`, `module.ts:73-77`; every test reading their result uses `toMatchObject`).
- New seat `resolveDefaultMenu(tx, cfg, zoneId, at, servedMenuIds: readonly string[]):
  Promise<string | null>`: the served default after the publication fallback, taking the
  published list `menuState` already read, so it reads no publication rows of its own.
  `menuState(tx, zoneId)` is NOT changed: its statement-count pin is
  `expect(prepared).toHaveBeenCalledTimes(4)` (`operations.test.ts:2310`), four statements in all,
  of which today's membership read is one; that one read stays one statement.

`hours.ts` (Task 2): `SpecialDateParticipant` gains an optional
`beforeMove?(tx, cfg, id, toDate): Promise<void>`; `saveSpecialDate` gains an optional last
argument `participants: readonly SpecialDateParticipant[] = []` and calls `beforeMove` before
writing when an existing date's `date` changes; `PUT /management-api/venue-service/special-dates/:id`
passes `VENUE_SERVICE_CALENDAR_PARTICIPANTS`.

---

### Task 1: Department membership and all-day defaults replace per-zone menus

**Files:** create `packages/venue-service/src/schema/menus.ts`, `src/department-menus.ts`,
`src/department-menus.test.ts`; modify `schema/service.ts` (delete `zoneMenus`, `ZONE_MENU_KEY`,
`defaultMenuId` and its two keys), `schema/index.ts`, `classification.ts`, `operations.ts`,
`routes.ts` (routes and `STATUS`), `errors.ts`, `provisioning.ts`, `configuration-transfer.ts`,
`index.ts`, `dashboard/live-queries.ts`; two generated migrations;
`apps/server/src/configuration-transfer.ts` (the cycle comment only),
`apps/server/scripts/demo-seed/seed-floor.ts`, `seed-catalogue.ts`; test support
`apps/server/src/testing/zone-offers.ts`, `party-venue.ts`, `clear-provision-fixture.ts`;
`scripts/migration-upgrade.test.ts` (`RESETS`); fixture rewrites listed below.

- [ ] **Failing tests first**, `packages/venue-service/src/department-menus.test.ts` (real
  database via `useVenueDb`, `VENUE_SERVICE_MIGRATIONS` plus core and catalogue sets, as
  `operations.test.ts` does). Restaurant with Barra, Sala, Terraza; Deli with Mostrador deli;
  menus Desayunos, Almuerzo, Bebidas, Deli para llevar, each published.
  1. `setDepartmentMenus(Restaurant, [Bebidas, Desayunos, Deli para llevar])` → `listZoneOffers`
     for Barra, Sala and Terraza each list exactly those three menus in that order; Mostrador deli
     lists none of them until Deli's own list is set, and setting Deli's list to
     `[Deli para llevar]` leaves Restaurant's unchanged.
  2. Department all-day default Bebidas → every Restaurant zone's `defaultMenuId` is Bebidas;
     `setZoneAllDayMenu(Barra, Desayunos)` → Barra's default is Desayunos, Sala's still Bebidas;
     `setZoneAllDayMenu(Barra, null)` → Barra back to Bebidas.
  3. Refusals (caught outside `withTransaction`): `setZoneAllDayMenu(Mostrador deli, Bebidas)` →
     `department_menu.not_found`; `setDepartmentAllDayMenu(Restaurant, Almuerzo)` (not in list) →
     `department_menu.not_found`; removing Bebidas while it is the all-day default and Barra's
     all-day override → `department_menu.in_use` with `uses` `[{ kind: "department_all_day" },
     { kind: "zone_all_day", zoneId: <Barra> }]` and the list unchanged; the same with Barra
     deactivated still names Barra, and clearing Barra's override through the zone route (allowed
     on an inactive zone) then the department default lets the removal through; an unknown menu id
     → `catalogue.not_found`; another venue's department → `department.not_found`; a duplicate id
     in the body → `management.request_invalid` `{ field: "menuIds" }`.
  4. Reordering `[Deli para llevar, Bebidas, Desayunos]` keeps the all-day default and Barra's
     override (writes by difference: the defaults' keys survive).
  5. Moving Barra to Deli (`configureZone`) deletes Barra's `zone_all_day_menus` row in the same
     transaction, and Barra's offers become Deli's list. (Task 2 adds the `zone_period_menus` half
     of this case.)
  6. A menu removed from Restaurant's list: a fresh `listZoneOffers` for Sala no longer serves it,
     and asserting its version → `menu.version_changed` with `liveVersionId: null`.
  7. Readiness, per zone as today (`zone.menu_missing` = no all-day default of its own or its
     department's; `zone.menu_unpublished` = no published active menu in its department's list;
     `zone.menu_empty` per zone and published menu): a department with a list and no all-day
     default reports each of its active zones `zone.menu_missing`; giving one zone an override
     clears only that zone.
  8. Routes (`routes.test.ts` style, a new `describe`): `PUT /management-api/venue-service/departments/:departmentId/menus`
     `{ menuIds }`, `PUT …/departments/:departmentId/all-day-menu` `{ menuId | null }`,
     `PUT …/zones/:zoneId/all-day-menu` `{ menuId | null }` — each 204 for a manager with
     `venue_service.manage`, 403 without; `department_menu.not_found` → 404 and
     `department_menu.in_use` → 409 with their `params`.
  Run `pnpm --filter @waitron/venue-service exec vitest run src/department-menus.test.ts` and see
  them fail because the functions and tables do not exist.
- [ ] Add the three Task 1 tables to `schema/menus.ts`, classify them `state`, add them to the
  transfer list after `departments`/`zone_sale_policies` (order: `department_menus`,
  `department_all_day_menus`, `zone_all_day_menus`), and extend `validate` to refuse a
  `zone_all_day_menus` row whose `department_id` is not its zone's policy department
  (`setup.request_invalid`, `field: "zone_all_day_menus.department_id"`). Generate (generation A);
  read the SQL: three `CREATE TABLE`s, no `__new_`.
- [ ] Implement `department-menus.ts` and the codes (`errors.ts`, `STATUS`). Rewire
  `operations.ts`: membership reads join `zone_service_policies` → `department_menus` →
  `catalogues` in one statement, replacing today's one `zone_menus` read, so `menuState` still
  issues the four statements `operations.test.ts:2310` counts; the default comes from the
  zone override else the department default; `listZoneMenuAssignments` returns, per configured
  zone, its department's rows with `isDefault` = the zone's effective all-day default (same row
  shape, so the Departments and zones screen keeps working until Task 4); `allowMenuInZone` keeps
  its signature and refusals (`catalogue.not_found`, then `service_zone.not_found`) and becomes
  "add to the zone's department list at `displayOrder ?? 0`; with `makeDefault`, set the zone's
  all-day override" — its doc comment says it changes every zone of the department. Add the three
  routes. `configureZone` deletes the moved zone's overrides when the department changes.
- [ ] Provisioning: replace `provisioning.ts:104-118` with `addDepartmentMenu(tx, node,
  counterDepartmentId, catalogueId, { displayOrder: 0 })` and set the department's all-day default only where it has none.
  Demo seed: Restaurant `[restaurant, lunch]` with all-day default `restaurant`; Deli `[deli]`
  default `deli`; `seed-catalogue.ts:97-101` reads the counter zone's department's all-day
  default. Test support: `zone-offers.ts:73-76` reads the zone's `zone_all_day_menus` row;
  `clear-provision-fixture.ts` deletes the new tables before `zone_service_policies`.
- [ ] Remove `zoneMenus`, `ZONE_MENU_KEY`, `default_menu_id` and its keys from `schema/service.ts`;
  remove `zone_menus` from classification, transfer and `live-queries.ts` (add the three new
  tables there). Generate (generation B); read the SQL: the `zone_service_policies` rebuild and
  `DROP TABLE zone_menus`, nothing else. Replace the cycle comment at
  `apps/server/src/configuration-transfer.ts:648-655`: run the transfer suite once with the pragma
  line removed, restore it, and write only what that run showed (CLAUDE.md §1: a correction is a
  new claim).
- [ ] Fixture rewrites (setup only, meaning unchanged):
  - `apps/server/src/till-api.test.ts:226-240, 3529-3533, 4322-4325` (the counter zone's own
    raw inserts become `addDepartmentMenu` + the zone or department default as each needs).
  - `till-api.test.ts:1796, 1807, 1889`: the SECOND zone's `insert into zone_menus` lines and its
    `delete from zone_menus where zone_id = …` are **removed**, never translated into a department
    write or delete: the second zone is in the counter's department and now serves its list
    without a row of its own, and a department delete would take the counter's menu away too.
  - `till-sale.test.ts:237-241`; `working-order.test.ts:236-255, 1115-1126`;
    `till-api.sell-published.test.ts:236-238, 442`; `served-at-huella.test.ts:219, 335-352`;
    `tabs.test.ts:1013-1022`; `sale-till-source.receipt.test.ts:159-166`;
    `till-api.fiscal-sale-paths.test.ts:219-226`; `till-api.receipt.test.ts:196-203`.
  - `testing-zone-offers.test.ts:146` (the `counts()` helper counts `department_menus`; the
    `toEqual(before)` at `:310` compares the helper with itself).
  - `operations.test.ts:2141-2143` and `:2160-2166`: the raw deletes of the Bar zone's row become
    deletes of the Bar department's `department_menus` row. This translation is sound only because
    `seedSellingVenue`'s Bar department has exactly one zone (`operations.test.ts:1381-1415`);
    confirm that before writing it, and STOP if it has another.
  - `provisioning.test.ts:127-133` (setup; its assertion is listed at the end).
  - Dashboard fixtures keep `zoneMenus: []` until Task 4. Leave
    `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json` alone (it is
    the refused old export, `configuration-import.test.ts:86`).
- [ ] Run `scripts/migration-upgrade.test.ts`; add the `RESETS` entry for generation B with the
  text the walk printed, and a one-line comment stating only what it printed.
- [ ] Run: `pnpm --filter @waitron/venue-service exec vitest run src/department-menus.test.ts src/operations.test.ts src/routes.test.ts src/provisioning.test.ts src/migrations.test.ts src/schema/service.test.ts src/configuration-transfer.test.ts src/service.test.ts`;
  `pnpm --filter @waitron/server exec vitest run src/till-api.test.ts src/till-api.sell-published.test.ts src/till-api.profile-zones.test.ts src/working-order.test.ts src/party-move-bill.test.ts src/configuration-transfer.test.ts src/provision.test.ts src/testing-zone-offers.test.ts scripts/demo-seed/seed.test.ts`;
  the schema-change guard commands; `pnpm --filter @waitron/venue-service typecheck`,
  `pnpm --filter @waitron/server typecheck`. The assertions listed under Task 1 at the end fail
  until edited.
- [ ] Commit the product and new tests with `git commit -s`; its first line says the release needs
  a venue reset. Then make exactly the Task 1 assertion edits from the list, rerun the commands
  above to green, and commit them separately with `git commit -s` and the message
  `Changed test checks (awaiting owner exception, questions.md W98 A): …` listing each `file:line`
  with before and after.

### Task 2: Named periods, one department timetable, zone period overrides, and the calendar participant

**Files:** create `src/menu-timetable.ts`, `src/menu-timetable-rules.ts`,
`src/menu-timetable-types.ts`, `src/menu-timetable.test.ts`, `src/menu-timetable-rules.test.ts`,
`src/menu-timetable-routes.test.ts`; modify `schema/menus.ts`, `classification.ts`,
`calendar-participants.ts`, `hours.ts` (optional `beforeMove`, optional `participants` on
`saveSpecialDate`), `routes.ts` (new routes, `STATUS`, the special-date PUT passing participants),
`hours-routes.test.ts` (one added case), `operations.ts` (`listZoneOffers`), `service.ts`,
`errors.ts`, `configuration-transfer.ts`, `index.ts`, `department-menus.ts` (the in-use check
learns periods and period overrides), `configureZone`; `apps/server/src/working-order.ts:367, 376`
and `order-drafts.ts:767` (pass `withDefault: false`); `packages/module/src/module.ts`;
`dashboard/hours-screen.ts` and `hours-screen.test.ts` (refusal placement); one generated
migration; `docs/developers/conventions-data.md` (a short "Menu timetables share the special-date
calendar" section beside "Opening hours store 'no claim' as no row").

- [ ] **Failing tests first.** `menu-timetable-rules.test.ts` (pure): slot overlap inside a day
  refused at `days.N.slots.M`; a Friday 22:00–02:00 Madrugada slot with a Saturday 01:00 start
  refused (`tailOverlaps`), Sunday into Monday included; `startsAt === endsAt` refused; a
  non-UUID `periodId` refused.

  `menu-timetable.test.ts` (real database). Restaurant as above; list `[Desayunos, Almuerzo, Cena,
  Bebidas, Café, Cócteles, Copas, Brunch de Navidad]`, all-day Bebidas; named periods Mañanas →
  Desayunos, Mediodía → Almuerzo, Noches → Cena, Madrugada → Copas; week Mon–Fri Mañanas
  09:00–12:00, Mediodía 12:00–16:00, Noches 18:00–20:00; Sat–Sun Mediodía 13:00–17:00 only; Fri
  Madrugada 22:00–02:00. Each case calls `resolveZoneMenus` at an explicit instant built from
  `Europe/Madrid` wall time:
  1. Monday 10:00 Sala → Desayunos, `periodId` Mañanas; Monday 12:00 → Almuerzo (start included);
     11:59 → Desayunos; 16:00 → Bebidas (end excluded, gap); 17:00 → Bebidas, `periodId` null.
  2. Zone overrides of named periods: Barra overrides Mañanas with Café and Noches with Cócteles;
     Terraza overrides nothing. Monday 10:00 Barra → Café, Terraza → Desayunos; 12:30 both →
     Almuerzo; 18:30 Barra → Cócteles, Terraza → Cena.
  3. **The override follows the named period, not a day (F1):** with Barra's Mañanas override set,
     replace Monday's slots only (Mañanas 08:30–12:00, the rest unchanged) through
     `replaceMenuWeek`; Tuesday 10:00 at Barra resolves Café, and Monday 08:45 at Barra resolves
     Café.
  4. A zone all-day override does not beat a period: Terraza all-day Café → Monday 12:30 Terraza
     → Almuerzo, 17:00 → Café.
  5. Weekend differs: Saturday 10:00 → Bebidas (gap), 13:00 → Almuerzo.
  6. Overnight: Saturday 01:00 → Copas (Friday's slot); Saturday 02:00 → Bebidas.
  7. Special date: Christmas (made through `saveSpecialDate`) with a Restaurant timetable of one
     slot, the named period Brunch navideño (→ Brunch de Navidad) 11:00–15:00 → 10:00 → Bebidas,
     12:00 → Brunch de Navidad, 16:00 → Bebidas (the week's Mediodía does not apply); a Christmas
     timetable placing Mañanas 09:00–11:00 → Barra at 10:00 resolves Café (its period override
     holds on the special date); an explicitly empty timetable → Bebidas all day; Deli on the same
     date with no row → its normal week. With Christmas saved as `closeWholeVenue: true` (Close the
     whole venue), 12:00 still resolves Brunch de Navidad and 16:00 Bebidas, and Deli still
     follows its normal week; a neighbour-clash check across that date still sees its slots.
  8. Unreadable clock (location time zone set to an invalid value with raw SQL in the test) →
     `periodId` null, all-day default.
  9. Clock change, using `clockChangeAfter("Europe/Madrid", …)`: a week slot starting at a skipped
     minute is in force from the first minute that exists; a special-date slot ending at a skipped
     minute is refused `menu_timetable.invalid` at `slots.N.endsAt`; on a repeated hour, a boundary
     at the repeated minute gives exactly one named period at every sampled instant (sample both
     occurrences).
  10. Writers (refusals caught outside `withTransaction`): `setZonePeriodMenu(Mostrador deli,
      Mañanas, …)` → `menu_timetable.invalid` `field: "periodId"`; a period naming Deli para llevar
      (not in Restaurant's list) → `department_menu.not_found`; a slot naming a Deli period →
      `menu_timetable.invalid` `field: "days.N.slots.M.periodId"`; an unknown period id on the
      override route → `menu_period.not_found`; a second period named Mañanas →
      `menu_timetable.invalid` `field: "name"` (2026-10-07 review: now `menu_period.name_taken`
      `{ departmentId, name }`, 409; a blank name stays `menu_timetable.invalid`); removing Café from the list while Barra's Mañanas
      override names it → `department_menu.in_use` with `uses: [{ kind: "zone_period", zoneId:
      <Barra>, periodId: <Mañanas> }]`; a week whose Friday tail would overlap a special Saturday's
      own early slot is refused `menu_timetable.invalid` `{ field: "date", date, departmentId }`
      (as `assertWeekBesideSpecialDates` does for hours), and a past pair is ignored
      (`pairMatters`).
  11. **No menu is unremovable (F2):** Brunch navideño is placed only on last year's Christmas
      (a past special date). Removing Brunch de Navidad from the list → `department_menu.in_use`
      `uses: [{ kind: "period", periodId: <Brunch navideño> }]`; deleting Brunch navideño →
      `menu_period.in_use` `uses: [{ kind: "special_date", specialDateId, date }]`;
      `readMenuTimetableModel` lists that past date and the period's use of it;
      `clearSpecialDateMenus` on the past date succeeds; then `deleteMenuPeriod` succeeds; then the
      menu's removal succeeds.
  12. Zone moves (F2): Barra with an all-day override and a Mañanas override moved to Deli by
      `configureZone` → both its `zone_all_day_menus` and `zone_period_menus` rows are gone in the
      same transaction.
  13. Participant: duplicating Christmas to two dates (`duplicateHolidayNamedSpecialDates` with
      `VENUE_SERVICE_CALENDAR_PARTICIPANTS`) copies Restaurant's timetable and slots under new
      ids, pointing at the same named periods (so Barra's period override applies on both copies,
      and no zone-override row is copied); a copy whose slot would end at a skipped minute on its
      target refuses `menu_timetable.invalid` `{ field: "date", date: <that target>, departmentId }`
      and creates no target at all (assert both target dates are absent afterwards); deleting
      Christmas reverts Restaurant to its week that date and leaves no `menu_slots` or
      `menu_day_timetables` rows for it, without touching a recorded order line
      (`working_line_contexts` row count and values unchanged); deleting it is refused
      `menu_timetable.invalid` `{ field: "date", date: <the neighbour>, departmentId }` when the
      week it resumes would overlap a neighbour's menu timetable. Moving Christmas to another date
      through `saveSpecialDate` with the participants re-checks the slots on the new date and
      refuses the same way.
  14. `listZoneOffers(…, { at })`: Barra at Monday 10:00 → `defaultMenuId` Café and `menus` flags
      Café `isDefault`; with Café unpublished → the first served menu in department order
      (existing fallback rule); the ZoneOffers keys are unchanged.
  15. Statement counts (spy on `prepareQuery`, as `operations.test.ts:2309-2311` does):
      `resolveZoneMenus` issues the same number with one slot and with twenty, and with one zone
      override and with five; `listZoneOffers(…, { menuItemIds, withDefault: false })` issues the
      same number whether the department has no periods or five periods with twenty slots and
      five zone overrides, and none of its statements reads `menu_periods`, `menu_slots`,
      `menu_day_timetables`, `zone_period_menus` or `zone_all_day_menus`.
  `menu-timetable-routes.test.ts`: `GET /management-api/venue-service/menu-timetable` (`venue.view`)
  returns the model; `POST …/departments/:departmentId/menu-periods` `{ name, menuId }` → 201;
  `PUT …/menu-periods/:periodId` `{ name, menuId }` → 200 with the period (2026-10-07 review: each
  field optional, at least one, and a missing one keeps its stored value); `DELETE
  …/menu-periods/:periodId` → 204; `PUT …/departments/:departmentId/menu-week` `{ days }` → 204;
  `PUT …/special-dates/:id/menu-timetables/:departmentId` `{ slots }` → 204; `DELETE` the same path
  → 204; `PUT …/zones/:zoneId/period-menus/:periodId` `{ menuId | null }` → 204 (writes behind
  `venue_service.manage`); each refusal's status from `STATUS` and its `params`.
  `hours-routes.test.ts`: one added case beside `:605` — `PUT …/special-dates/:id` hands the
  date move to the participants in the request's transaction.
  `hours-screen.test.ts` (browser): a duplicate refused `menu_timetable.invalid` with
  `params.date` equal to the second target date marks `dates.1`; a date move refused the same way
  marks `date`; a delete refused that way says so in the dialog's bottom message.
  Run `pnpm --filter @waitron/venue-service exec vitest run src/menu-timetable-rules.test.ts src/menu-timetable.test.ts src/menu-timetable-routes.test.ts src/hours-routes.test.ts src/dashboard/hours-screen.test.ts`
  and see the new cases fail.
- [ ] Add the four Task 2 tables (classification `state`; transfer after `special_dates` and
  `zone_all_day_menus`: `menu_periods`, `menu_day_timetables`, `menu_slots`, `zone_period_menus`).
  Generate (generation C, additions only); read the SQL. Expect `scripts/migration-upgrade.test.ts`
  to fail to fill `menu_day_timetables`: the walk leaves a nullable column null only when it is
  outside every unique index (`:39-41`), `weekday` and `special_date_id` are each inside one, and the
  one-day CHECK refuses both set. Add `CANDIDATES` entry
  `"menu_day_timetables.special_date_id": [null]` (a value may be `null`, `Value` at `:429`), with
  a one-line reason: the walk's rows are then week rows, whose `weekday` the generic integers fill
  within the 0–6 CHECK. Run the walk and keep the entry only if the walk needed it; add any further
  entry it asks for (for `menu_slots` or `zone_period_menus`) the same way, with its reason.
- [ ] Implement rules, resolver and writers. Writers replace a day's slots by delete-then-insert.
  Special-date writers refuse skipped endpoints (`skippedEndpoint`) and neighbour clashes from the
  venue's yesterday on; week writers check neighbours only, like `replaceWeekHours`. Extend the
  Task 1 in-use check with `period` and `zone_period` uses. Add
  `MENU_TIMETABLE_CALENDAR_PARTICIPANT` to `VENUE_SERVICE_CALENDAR_PARTICIPANTS`: `copy` clones the
  source date's timetables and slots, then re-checks skipped endpoints and neighbours on the target,
  throwing `menu_timetable.invalid { field: "date", date, departmentId }`; `beforeDelete` only
  refuses, with the same shape; `beforeMove` checks the new date the same way. Add the optional
  `beforeMove` and `saveSpecialDate`'s optional `participants`; the special-date PUT route passes
  the list. Hours dialog (`hours-screen.ts:619-697`): place `menu_timetable.invalid` by
  `params.date` on a duplicate (`dates.N`, as `special_date.date_taken` is placed at `:643-647`),
  on `date` in the date editor, and in the bottom message on delete, with English and Spanish
  sentences. Switch `listZoneOffers` to `resolveZoneMenus` (`at`, `withDefault` options); pass
  `withDefault: false` from the two pricing callers; add the `resolveDefaultMenu` seat. Import
  `validate`: the same structural, overlap and skipped-endpoint rules over the bundle's rows
  (`setup.request_invalid` naming `<table>.<column>`), and a zone override's department equal to
  its zone's.
- [ ] Run the focused venue-service files above plus `src/hours.test.ts src/holidays.test.ts src/holidays-routes.test.ts src/operations.test.ts src/service.test.ts src/configuration-transfer.test.ts src/department-menus.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts src/working-order.test.ts src/till-api.sell-published.test.ts`,
  the schema-change guards, typechecks.
- [ ] Commit the product and new tests with sign-off; then the Task 2 assertion edit from the
  list (`hours.test.ts:2150-2153`) in its own signed-off commit with the
  `Changed test checks (awaiting owner exception, questions.md W98 A):` message.

### Task 3: Browsing follows the timetable; ordering stays membership-only

**Files:** `apps/server/src/till-api.ts` (`/api/menu-state`), new
`apps/server/src/till-api.menu-timetable.test.ts`; `apps/till/src/api/client.ts` (local
`MenuStateAnswer = MenuState & { defaultMenuId?: string | null }`; the catalogue leaf type is not
changed), `state/menu-state-poll.ts` (type only), `till-app.ts`; new
`apps/till/src/till-app-menu-timetable.test.ts`.

- [ ] **Server tests** (`useVenueDb` + `migrationOptionsFor(manifestSets(), null)`, venue with
  Restaurant/Deli as above, fixed instants with `vi.setSystemTime`, as
  `apps/server/src/station-health.test.ts` does):
  1. At Monday 13:00 (Mediodía in force), `POST /api/working-orders` in Sala with a Desayunos line
     → 200, priced at Desayunos's price (breakfast still orderable after its default ends).
  2. A Restaurant profile ordering a Deli para llevar line in Barra, with Deli para llevar in
     Restaurant's list → 200, and the order's `order_service_contexts.department_id` and the line's
     `working_line_contexts.department_id` are Restaurant's; the same profile asking
     `/api/service-zones/<Mostrador deli>/offers` → 403 `service_zone.not_allowed`; a Deli para
     llevar line sent while it is NOT in Restaurant's list → 400 `service_zone.offer_not_allowed`.
  3. Removal after the screen loaded: read Sala's offers, remove Desayunos from Restaurant's list,
     then add a line asserting its version → 409 `menu.version_changed`
     `{ menus: [{ menuId: <Desayunos>, liveVersionId: null }] }`; a held order's earlier Desayunos
     line keeps its `unit_price_gross`, `working_line_contexts.menu_name` and version, and the
     order can still be paid by cash (if the pay route refuses it, STOP and report: the spec says
     existing lines stay intact).
  4. `/api/menu-state?zoneId=<Barra>` at Monday 10:00 → `defaultMenuId` Café; at 12:30 →
     Almuerzo; with no zone named → the profile's starting zone's default.
  Cases 1–3 are expected to pass already after Tasks 1–2, so prove each bites **by deletion**
  before relying on it: (1) temporarily make `listZoneOffers` serve only the resolved default menu
  and watch case 1 fail; (2) temporarily read membership from every active menu at the location
  instead of the zone's department and watch the `offer_not_allowed` half fail; (3) temporarily
  pass the department's full list, removed menu included, to `assertLiveVersions` and watch the
  `version_changed` half fail. Restore each, rerun green, and state the three experiments in the
  commit message. Case 4 fails until the route changes. Run
  `pnpm --filter @waitron/server exec vitest run src/till-api.menu-timetable.test.ts`.
- [ ] `/api/menu-state` answers `{ ...state, defaultMenuId: await VENUE_SERVICE.resolveDefaultMenu(tx, cfg, zone, new Date(), state.menus.map((m) => m.menuId)) }`
  inside the same transaction, after `menuState` (awaited in turn).
- [ ] **Failing till browser tests** (`till-app-menu-timetable.test.ts`, fake timers as
  `till-app-menu-refresh.test.ts:332-372` does; offers stubs with Desayunos default; poll stubs
  that later answer `defaultMenuId` Almuerzo):
  1. Following the default, empty basket: the next poll selects Almuerzo.
  2. Following the default with lines in the basket: the poll changes nothing; once the sale
     completes (basket cleared), Almuerzo is selected without waiting for another poll.
  3. A manual pick of Desayunos: the poll changes nothing, and signing in again as the same person
     keeps Desayunos (consistent with `till-app.test.ts:10861`).
  4. An open table order: a poll for the table's zone never changes `tableSelectedCatalogueId`.
  5. A poll answer with no `defaultMenuId` key (today's stubs) changes nothing.
  6. A polled default that is not among the loaded menus: the offers are reloaded (as
     `versionsMoved` already does) and then the default is selected.
  7. The remembered default is kept per zone and dropped on a zone change and on sign-in: Barra's
     poll says Almuerzo while the basket has lines; the basket is cleared after switching to
     Terraza (whose offers answer names Cena) → Cena stays selected and Barra's Almuerzo is not
     applied; likewise a sign-out and sign-in before the basket clears applies nothing remembered
     from before.
  Run `pnpm --filter @waitron/till exec vitest run src/till-app-menu-timetable.test.ts` and see
  1, 2, 6 and 7 fail.
- [ ] Implement in `#onMenuState` (`till-app.ts:2466`): keep a per-zone map of the latest polled
  default, cleared for the zone left on a zone change and entirely on sign-in or sign-out; when
  `#browsing.menuId === null`, the basket is empty and nothing is in flight, select the counter
  zone's remembered default; apply it where the basket is cleared after a sale or park (the
  `#store.clear()` sites, `till-app.ts:3395, 4145, 6137, 6692`, through one helper). Never touch
  the table-order selection.
- [ ] Run the new files plus `src/till-app-menu-refresh.test.ts src/till-app-boot-and-counter.test.ts src/till-app.test.ts`
  (memory headroom first, CLAUDE.md §2); check both themes at 390 px and 1280 px; typechecks;
  commit with sign-off.

### Task 4: Manager editing on Menu timetable, and the old zone-menu editor retired

**Files:** create `packages/venue-service/src/dashboard/menu-timetable-screen.ts`,
`menu-timetable-client.ts`, `menu-slot-editor.ts`, their `*.test.ts` and `*.a11y.test.ts`;
modify `dashboard/index.ts` (a `moreScreens` entry `{ id: "menu-timetable", navLabelKey:
"nav.menu_timetable", group: "menu", requiresPermission: "venue_service.manage", readPermission:
"venue.view" }` **appended at the end of `moreScreens`**, so the positional pins at
`dashboard/index.test.ts:166, 222` keep naming Prep stations and Hours), `strings.ts` (English and
Spanish: "Menu timetable" / "Horario de cartas"), `hours-cell-editor.ts` (one optional property,
below), `live-queries.ts` (a `menu-timetable` query over the seven new tables, `special_dates`,
`departments`, `floor_zones`, `catalogues`; `scripts/live-subscriptions.test.ts`),
`venue-operations-screen.ts`, `client.ts`, `routes.ts`, `operations.ts`; move `allowMenuInZone`
to `src/testing/zone-menus.ts` (package export `./testing/zone-menus.js`) once no production
caller remains; remove the `zoneMenus` fixture keys listed at the end; `docs/backlog.md`.

- [ ] **The slot editor composes `hours-cell-editor`** (`hours-cell-editor.ts:83-249`) rather than
  re-drawing time fields: each day's slots are passed in as its `cell` (`startsAt`/`endsAt` mapped
  to `opensAt`/`closesAt`), its exported `cellChecks` and `weekChecks` (`:21-80`) give the overlap
  and midnight checks, and one new optional property — a per-period-row render hook that the menu
  editor uses for the named-period `wt-combobox` — draws the period choice beside each row. Week
  days use the "periods" mode with "no slots" offered as the all-day default; a special date adds
  "Normal week" (the editor's `inherit`). The hook is additive and absent for Hours, so every
  existing `hours-cell-editor` test is unchanged; if composing needs any existing assertion
  changed, STOP and report instead.
- [ ] **Failing browser tests first** (stubbed API, as `hours-screen.test.ts` does): choosing a
  department shows its ordered list (add, remove, reorder with `wt-*` controls), its all-day
  default, its named periods (name and default menu; add, rename, delete), a week grid (Monday
  first, `WEEK_DISPLAY_ORDER`) of slots each naming a period, the special dates (from yesterday on,
  and every earlier one holding a menu timetable) with the department's timetable or "Normal
  week", and a periods × zones table whose rows are labelled by period name (plus an "All day" row)
  and whose zone cells are blank = inherit, showing the period's menu in grey (A261 §4's
  inheritance pattern); inactive zones appear, marked, so their overrides can be cleared. Cases:
  saving a reordered list calls the list route once; removing Café while Barra's Mañanas override
  uses it shows `department_menu.in_use` beside the list naming "Barra · Mañanas" and keeps the
  draft; removing a menu blocked by a past special date names that date and offers its "Use normal
  week"; deleting a period still placed shows `menu_period.in_use` naming the days; a zone cell
  offers only the department's menus (Deli para llevar is offered on a Restaurant zone only when
  Restaurant's list holds it); an overlapping slot marks that slot's field and the summary line
  above the buttons; a special date's "Use normal week" calls DELETE; a time the clock repeats on
  that date shows a note (`repeatedTimes`); a read-only (`venue.view`) manager sees no controls.
  Every field is a `wt-input`/`wt-combobox`/`wt-button` (`scripts/native-form-fields.test.ts`),
  every refusal placed by what the error carries. `*.a11y.test.ts`: each distinct state, both
  themes.
- [ ] Departments and zones: remove the zone-menu section, tree action, "default" column and
  assignment editor; the `zone.menu_missing` line under a zone links to
  `/manage/menu-timetable?departmentId=…` instead of opening the old editor (2026-10-07 review: the
  address is now `/manage/menu-timetable/department/…`, written through the navigation guard). Remove
  `PUT …/zones/:zoneId/menus/:menuId`, `listZoneMenuAssignments` and `zoneMenus` from the model and
  its type, and remove the `zoneMenus` fixture keys; `allowMenuInZone` moves to `src/testing/`
  with its refusal cases unchanged (import paths change in its callers).
- [ ] Run `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/menu-timetable-screen.test.ts src/dashboard/menu-timetable-screen.a11y.test.ts src/dashboard/hours-cell-editor.test.ts src/dashboard/hours-cell-editor.a11y.test.ts src/dashboard/index.test.ts src/dashboard/venue-operations-screen.test.ts src/dashboard/venue-operations-screen.a11y.test.ts src/dashboard/client.test.ts src/routes.test.ts`,
  `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/live-subscriptions.test.ts scripts/pinned-actions-column.test.ts scripts/style-token-names.test.ts`,
  `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts`. Open the screen
  with `wa-wt demo <worktree>` and look at it in both themes at 390 px and 1280 px.
- [ ] Update `docs/backlog.md` (the W98 entry, the two hand-on notes, and the reset). Commit with
  sign-off; then the Task 4 assertion edits from the list in their own signed-off commit with the
  `Changed test checks (awaiting owner exception, questions.md W98 A):` message. During
  `/finish-branch`, verify current-head CI coverage; record anything belonging to forward-only
  publication separately.

## Review focus

1. A Restaurant zone offers Deli para llevar without the profile gaining Mostrador deli, and the
   line keeps Restaurant's service context (Task 1 case 1, Task 3 case 2).
2. A zone override follows its named period on every day it runs, and inherits the department's
   lunch period even when its all-day choice differs (Task 2 cases 3, 4).
3. At an overnight or clock-change boundary exactly one named period is in force (Task 2 cases 6, 9).
4. A removed or unpublished menu is absent from new choices while an existing line stays intact
   and payable; no menu is unremovable (Task 1 cases 3, 6; Task 2 case 11; Task 3 case 3).
5. Following the default changes menus only between orders; a manual pick, an open order and the
   same person's re-login keep their menu; a remembered default never crosses a zone change or a
   sign-in (Task 3 till cases).
6. Pricing paths read no timetable (Task 2 case 15).
7. The `zone_service_policies` rebuild: inbound keys, the measured refusal, the `RESETS` entry
   copied from the walk, and the PR's first line.

---

## Assertions the approved design changes

The owner's exception is asked in `~/waitron-campaign-b/questions.md` (W98, question A). Each task
edits only its own items below, in a separate commit (see the top of this plan). Line numbers are
at `7d10d2ccc`. Fixture rewrites (setup lines, raw inserts, helper SQL) are listed in the tasks.

**Per-zone membership pinned directly (Task 1):**
1. `apps/server/src/party-move-bill.test.ts:929-930`, "keeps an item's price and VAT class, and
   prices what is added later from the receiving zone": `expect(counterOffer).toMatchObject({ code:
   "service_zone.offer_not_allowed" })`. `pricedInZone` (`testing/party-venue.ts:409-428`) offers
   its menu in the counter zone only; the counter and tables zones share one department
   (`party-venue.ts:157-158`), so department-wide the tables zone serves it too. Its doc comment
   "Every other zone keeps selling the product at its own price" stops being true.
2. `packages/venue-service/src/operations.test.ts:1365-1370`, "removes a zone's routing and watcher
   selections while retaining its menu and policy": selects `zoneMenus` rows for the zone and
   expects `[{ menuId }]`. No per-zone membership row exists; the nearest replacement is the zone's
   `zone_all_day_menus` row (retained on deactivation).
3. `operations.test.ts:1665-1670`, "moves a zone between departments without changing its tables
   or menu": expects the moved zone's `zoneMenus` rows unchanged. Department-wide, moving a zone
   changes its list to the target department's and drops its overrides.
4. `operations.test.ts:2384`, "reads the live versions once for every zone, however many share a
   menu": `/from "zone_menus"/` toHaveLength(1). The one membership read becomes `from
   "department_menus"`.

**Schema guards that name the retired storage (Task 1):**
5. `packages/venue-service/src/migrations.test.ts:36` (`TABLES` includes `zone_menus`) feeding the
   whole-shape `toEqual` at `:165-178` (the `zone_service_policies` keys `(default_menu_id) ->
   catalogues(id)` and `(zone_id, default_menu_id) -> zone_menus(…)`, and the `zone_menus` block).
6. `migrations.test.ts:280`: `columns("zone_menus_order_idx")` toEqual `["zone_id", "display_order"]`.
7. `migrations.test.ts:365-368`: the refusal of an insert into `zone_menus` naming `zone_menus_zone_fk`.
8. `migrations.test.ts:384-432`, "refuses a default menu the zone does not allow, at the statement
   or at commit": the whole test exercises the retired cycle key.
9. `packages/venue-service/src/schema/service.test.ts:65-66` (`zone_service_policies_default_menu_fk`,
   `zone_service_policies_default_allowed_fk`), `:93-100` (the `zone_menus` entry) and `:239-241`
   (`toHaveLength(18)`; the count changes with the tables).
10. `scripts/schema-constraints.test.ts:277-279, 283`: `EXPECTED_FOREIGN_KEYS` rows for
    `zone_menus` and `zone_service_policies.default_menu_id`. (New rows for the new tables are
    growth.)

**Values read from the dropped column or table (Task 1):**
11. `apps/server/src/configuration-transfer.test.ts:2067-2080`, "keeps a name that equals another
    row's id, while the ids that point at rows are rewritten": reads
    `zone_service_policies.default_menu_id` and expects every row's to be a remapped target menu.
    The remapped default moves to `department_all_day_menus.menu_id`.
12. `apps/server/src/provision.test.ts:203-209`: counts `zone_menus` rows and expects
    `{ menus: 1, zone_menus: 1 }`. The count moves to `department_menus` (expected 1).
13. `packages/venue-service/src/provisioning.test.ts:140-146`, "seeds one counter policy
    idempotently without resetting authored mode": expects `[{ service_mode: "ticket_then_pay",
    default_menu_id: <Authored> }]` from `zone_service_policies`. The authored default that must
    survive a re-seed becomes the department's all-day default.
14. `apps/server/scripts/demo-seed/seed.test.ts:348-358`: the query that produces
    `read.serviceZones` joins `zone_menus`; the expected values at `:476-512` already match
    department-wide membership and do not change, only the query does. (Borderline: listed for
    transparency.)

**Calendar participant (Task 2):**
15. `packages/venue-service/src/hours.test.ts:2150-2153`, "has none of its own in step 5":
    `expect(VENUE_SERVICE_CALENDAR_PARTICIPANTS).toEqual([])`. W98 is the step that adds one, as
    the Hours plan and `docs/backlog.md:4461` record.

**The old zone-menu editor and route (Task 4):**
16. `packages/venue-service/src/routes.test.ts:1376-1377` ("configures a department and zone menu":
    the model's `zoneMenus` rows) and `:1471-1488` ("stores a zone menu's explicit display
    order …": the `PUT …/zones/:id/menus/:menuId` route and `zoneMenus` row shape).
17. `packages/venue-service/src/dashboard/client.test.ts:293-299`: `allowMenu` →
    `["/management-api/venue-service/zones/z1/menus/m1", "PUT"]`.
18. `packages/venue-service/src/dashboard/venue-operations-screen.test.ts`, every case built on the
    zone-menu section, tree action, default column or assignment editor: `:239`, `:253`, `:262`
    (opening zone menus from the tree), `:457` (missing-menu warning opens the assignment editor;
    becomes a link), `:1901`, `:1942`, `:1974` (the `zone-menus` empty-table sentence, English and
    Spanish), `:2062` (zones table shows the menu default "Casa Delgado"), `:2208`, `:2368`,
    `:2525`, `:2544`, `:2563`, `:2600` (column-chooser row for `zone-menus`), `:2676`, the
    `allowMenu` rows of the refusal tables at `:2959-2995`, `:3030`, `:3211`, `:3234`,
    `:3259-3386` (focus after an editor opened from the zone-menu Add), `:3381`, `:3495`, and the
    phone-width row at `:3609`. The readiness text cases (`:437`, `:2234`, `:2264`) keep their
    assertions if the strings stay.
19. `packages/venue-service/src/dashboard/venue-operations-screen.a11y.test.ts:143` ("the menu
    editor") clicks `menus-tree-zone-z1` and `new-assignment-z1`; it asserts accessibility only,
    but its subject is removed.

**Permitted without an exception (fixture, type and growth edits; listed for the reviewer):**
- Whole-shape pins that gain a key: `packages/venue-service/src/service.test.ts:7-48` gains
  `resolveDefaultMenu`; `apps/server/src/till-api.sell-published.test.ts:858-861, 868-871`
  (`/api/menu-state` `toEqual`) gain `defaultMenuId`.
- Guard lists that grow: `scripts/migration-upgrade.test.ts` `RESETS` (and possibly
  `CANDIDATES`); `scripts/schema-constraints.test.ts` rows for the new keys, unique indexes and
  checks; `migrations.test.ts` `TABLES` and `schema/service.test.ts` entries for the new tables.
- Type and fixture edits that follow the model and contract changes (Task 4 unless stated):
  removing `zoneMenus` from the dashboard model type and the fixture literals typed as it —
  `dashboard/index.test.ts:102`, `venue-navigation.test.ts:15`, `client.test.ts:108, 260, 307`,
  `venue-operations-screen.a11y.test.ts:21, 61, 101, 171`, `venue-operations-screen.test.ts:61`
  and spread rows `:2212, 2531, 2548, 2567, 2680, 3034, 3196`,
  `apps/dashboard/src/dashboard-app.test.ts:1662, 3725, 3792`; the `ZoneOffers`/seat types in
  `packages/module/src/module.ts` and its `index.ts` re-exports (Tasks 2–3); the empty
  `ZoneOffers` literal at `apps/server/src/working-order.ts:437` (shape unchanged); the import
  paths of `allowMenuInZone`'s callers when it moves to `src/testing/`.

**Checked and expected to survive unchanged** (the compatibility `allowMenuInZone` keeps per-zone
`makeDefault` as a zone override, readiness stays per zone, `ZoneOffers` keeps its shape, pricing
callers opt out of the default explicitly): `operations.test.ts:226-234, 280-298, 534-536,
747-754, 767-771, 919-921, 2133-2148, 2160-2187, 2210-2235, 2246-2248, 2309-2311, 2350-2370`;
`till-api.profile-zones.test.ts:1105-1135` (its two zones are in different departments);
`till-api.test.ts:1796-1807, 1889-1927` (after the second zone's fixture lines are removed);
`dashboard/index.test.ts:166, 222`; every `hours-cell-editor` test. An implementer who finds one
of these failing STOPS and reports it.

## Open questions (defaults taken)

- **Q1. Where the editor lives.** The specs say "on the Menus screen": venue operations §4
  (`docs/superpowers/specs/2026-10-03-venue-operations-design.md:158-159`) and the devices spec §10
  ("Retain the placement of menu configuration on Menus",
  `docs/superpowers/specs/2026-10-04-devices-menus-and-service-zones-design.md:305`). The default
  departs from that: (a) a separate venue-service screen "Menu timetable" beside Menus in the
  "Products and menus" nav group, because the Menus screen is core
  (`apps/dashboard/src/screens/menus-screen.ts`) and may not name a module, and a module can add
  only whole screens and Venue settings panels (`packages/dashboard-kit/src/contract.ts:61-62`),
  with no seat for a tab inside a core screen. Alternatives: (b) add that seat to
  `DashboardContribution` (a new cross-package contract) and put the editor in a Menus tab;
  (c) reorder the core nav so the module screen sits directly under Menus. **Default (a).**
- **Q2. Creating special dates from the menu editor.** (a) Only pick existing dates, with a link to
  Hours; (b) allow "Make this a special date" there too. **Default (a):** one place creates dates.
- **Q3. Removing a menu something still names.** (a) Refuse `department_menu.in_use`, naming every
  use (department all-day, named periods, zone all-day and period overrides, inactive zones
  included), each of which the editor shows and can clear, past special dates included;
  (b) cascade zone overrides away and refuse only department defaults; (c) cascade everything.
  **Default (a).**
- **Q4. A zone moved to another department.** (a) Drop its all-day and period overrides (they name
  the old department's periods and list); (b) refuse the move while it has overrides.
  **Default (a).**
- **Q5. A scheduled default that is unpublished or deactivated.** (a) Existing rule: the first
  served menu in list order; (b) fall through to the zone's, then the department's all-day default.
  **Default (a)**, unchanged behaviour.
- **Q6. Is an all-day default required?** (a) Optional; a zone with neither its own nor its
  department's shows today's readiness line "needs a default menu"; (b) required whenever the list
  is non-empty. **Default (a).**
- **Q7. Zone overrides on special dates.** (a) A zone's override of a named period applies wherever
  that period is placed, special dates included, and a special date may use a period of its own
  (Brunch navideño) that zones can override like any other; duplicating a date copies its slots,
  not overrides; (b) special dates ignore zone overrides. **Default (a):** spec §2 "a zone may
  choose another default for that same period".
- **Q8. Unreadable venue clock.** (a) No slot applies; the all-day default is offered; (b) refuse
  the offers read. **Default (a)**, as stations do (`stationStatus`, `routing.ts:117`).
- **Q9. Dropping the old storage now.** (a) Drop `zone_menus` and `default_menu_id` in this branch:
  every populated venue must be reset (measured above); (b) stop reading and writing them now and
  drop them in a later batched reset release, avoiding a reset today but keeping dead tables, the
  cycle key and guard rows. **Default (a)**, per the pre-live rule (CLAUDE.md §3) and the precedents
  `venue-service/0020` and core `0092`.
- **Q10. How fast a screen follows a period change.** (a) The existing 15-second poll carries the
  default; a busy basket defers until it empties; the remembered default is per zone and forgotten
  on a zone change or sign-in; (b) the offers answer also names the next change instant and the
  till schedules a re-read. **Default (a).**
- **Q11. Deleting a special date that has a menu timetable.** (a) Allowed; its menu timetable and
  slots go with it (refused only by a neighbour clash); (b) warn on the Hours page.
  **Default (a)**; the Hours page changes only to place the new refusal.
- **Q12. Clock-change handling.** Week slots are not checked against clock changes and special-date
  endpoints at a skipped minute are refused, a repeated time explained, exactly as Hours does.
  Spec §9's "ask which occurrence" is written for publication times, which this item does not
  schedule. **Default: follow Hours.**
- **Q13. What a zone override is attached to (F1).** (a) A named department period
  (`menu_periods`: id, department, name, menu); the week and special dates hold time slots
  pointing at named periods, and Barra's override of Mañanas applies every day Mañanas runs;
  (b) each time slot, so an override binds to one weekday's slot (the earlier draft: Barra's
  Monday breakfast override would not reach Tuesday); (c) a period's position within each day.
  **Default (a).** Consequence: deleting a named period is refused while any day places it
  (`menu_period.in_use`), and the editor lists those days, past special dates included.
