# Live controls, slice 3 — keeping a period or zone open, and closing a station for today (A366)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation.
>
> **Existing assertions.** A task may change an existing assertion only where it pins behaviour
> this plan removes (listed under "Behaviour this slice removes"), and only in a separate commit
> whose message begins `Changed test checks (A366 slice 3):` and lists each `file:line` with its
> before and after. Any other assertion that turns out to need changing is a STOP: report it, do
> not edit it. Adding fixture rows, or a key to a whole-shape pin, is allowed.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> **Green between tasks.** Before its commit, every task runs its package's whole node project
> (`pnpm --filter @waitron/venue-service exec vitest run --project node`;
> `pnpm --filter @waitron/server exec vitest run` for `apps/server`, which has one project), the
> browser files it touched, and the typecheck of every package it touched. A task touching
> `apps/till` runs the till's whole suite (Chromium only) after checking headroom with
> `memory_pressure | grep free`. Read each run's `Tests` count.
>
> **What this plan was read against.** `main` at `49a80d770` (marked **M**; first written at
> `c5965c228`). `git diff --stat c5965c228 49a80d770` touches none of the code files cited here;
> of the cited docs, `docs/backlog.md`'s S11 entry moved to `:1309-1312` and `design-system.md`'s
> Prep stations paragraph to `:1705-1708`. Slice 1's unlanded branch
> `feat/service-periods-slice-1` was read at commit **`bdf64d9cd8b0a6527cc9110aa9a2b09988f608fd`**
> (marked **S1**; `git rev-parse feat/service-periods-slice-1` on 2026-10-08), rebased onto main
> `18331517c`; it was first read at `ea88489ab`, and its last commit after `36697d7b5` adds two lines
> to `apps/till/src/widgets/menu-browser.home-columns.test.ts` only, which nothing here cites. It builds on the
> [slice 1 plan](2026-10-07-a366-slice-1-service-periods.md) and the unbuilt
> [slice 2 plan](2026-10-08-a366-slice-2-zone-closed-times-and-named-days.md), and reads the
> [slice 5 plan](2026-10-08-a366-slice-5-monitors.md) for the screens both slices change. Slice 1
> does not change `packages/venue-service/src/station-times.ts`, `routing.ts`, `routing-store.ts`,
> `dashboard/prep-stations-screen.ts`, `apps/till/src/screens/till-station-screen.ts`,
> `apps/server/src/device-api.ts`, `station-move.ts`, `pin-check-ahead.ts` or anything in
> `packages/identity` (`git diff --stat 18331517c 36697d7b5 -- <those paths>` is empty), so in
> those files an **M** line is also the S1 line. It does change `apps/server/src/till-api.ts`, adding
> one line in each of its hunks at `:1382`, `:1489` and `:2689`, so a `till-api.ts` line past 1382
> moves by up to three on S1; the `till-api.ts` lines below are **M** lines. In every other
> file an S1 line wins.
>
> **Slice 1 changed its rule while this plan was written** (`baa24e213`, `d19fb1390`; the
> "Owner update, 2026-10-08" paragraph of spec §5, on slice 1's branch only): a request adds dishes only while their own period runs, with a
> per-period end offset that slice 1 fixes at 0 and backlog item A432 will make configurable. This
> plan's extension changes when a period runs; A432's offset is then measured from the extended
> end (decision 19).
>
> **Start Part A only after slice 1 has merged; Part B only after slice 2 has merged.** Before
> each part, re-read every line cited from the slice it waits on, and diff what that slice changed
> after the commit read here.

> **Implementation grounding, 2026-10-08 (Lane E, Part A).** Slice 1 landed in PR #1460 as
> `685a6074b152eeb904a66cfac9f83e8f432196ab`; this branch starts at
> `8d52162e3`. `git diff --name-only bdf64d9cd8b0a6527cc9110aa9a2b09988f608fd
> 685a6074b152eeb904a66cfac9f83e8f432196ab -- packages/venue-service packages/module
> packages/catalogue apps/till apps/server/src/till-api.ts scripts/schema-constraints.test.ts
> scripts/migration-upgrade.test.ts` printed no paths. The S1 code cited below therefore matches
> the landed tree for those paths; historical doc line numbers are not used to locate entries.
> The owner's 21:55 answer in Lane C's questions approves all 19 decisions.
> At start, slice 2 and slice 5 Part A have no worktree or open PR. Lane D instead has A432 in
> `feat/period-end-offset`, including a venue-service migration numbered 0034 and changes to
> period validation and contract types. Both branches proceed under the queue's overlap waiver;
> whoever lands second regenerates any colliding migrations and keeps the extended end as the
> reference for A432's offset. Lane A is working on menu structure; Lane B's venue forms are
> outside Task A1. The read-only file inventory is retained in Lane E's local receipts.
> Per the owner's 17:10 queue instruction, implementation runs focused checks and the explicit
> migration/fiscal guards; mandatory package tests and coverage remain in CI. Part A is one PR;
> Tasks B1–B4 belong to Lane D. The unattended runner authorises landing after green checks.

**Goal:** during service, a manager keeps a period open later than planned ("Keep Lunch open until
14:30 today") from the till, and, once zones have closed times, keeps a zone open later ("Keep the
Terrace open until 01:30 today"). Staff close a prep station for the rest of the day, or open it,
from the till's Station screen and from the kitchen display, and closing it asks where its new
work goes, offering the default station first. Each choice lasts until the business day ends.

**Architecture:** a period extension is one row per department per business day
(`period_extensions`), laid over that day's ranges by a pure function in `service-day.ts`, so the
one resolver slice 1 built (`resolveDepartmentService`) answers the till's menus, the server's
item checks and the till's period line alike. A zone extension (Part B) is one row per zone per
business day (`zone_extensions`), carved out of slice 2's closed times by the one function that
answers "which zones are closed now". A station's "today" row (`station_day_states`, which exists)
gains the station its work goes to; the routing walk follows that choice ahead of the station's
configured fallback. The till and kitchen display reach new venue-service seats through two small
server mounts that share the till's PIN throttle; the dashboard loses its own "Close for today"
buttons.

**Tech stack:** TypeScript, drizzle on SQLite (`node:sqlite`), Hono, Lit, Vitest (node and real
Chromium browser projects).

**Spec:** [Service times, departments, zones and prep stations](../specs/2026-10-07-service-times-departments-and-stations-design.md)
§5 (last bullet), §8 ("Close for today asks where the work goes"), §10, §12 (the station fallback
setting, in part), §13 item 3, §15 item 1. Backlog: A366, and S11 (folded in, `docs/backlog.md:1309-1312`, M).

**Risk path:** FULL ceremony: two migrations, a changed cross-package contract (`ZoneOffers`,
`ZoneMenuState`, `stationStates` and new seats in `packages/module/src/module.ts`), a new
authorization path (a PIN on a kitchen display), and routing that decides where a dish is made.

**Venue reset: not needed** for either part. Every migration here adds a table, a nullable
column, or (Task A1's second generation, expected) rebuilds `station_day_states` to add a check:
nothing points at that table, its copy keeps every row, and a row stored before has a null
destination, which the check accepts. Each pull request's first line says "no venue reset needed"
(Part A's adds "`station_day_states` is rebuilt, rows kept") and the upgrade walk
(`scripts/migration-upgrade.test.ts`) shows no casualty.

---

## What this slice needs from slice 2

### 1. Every file this slice changes

**Part A (Tasks A1–A14c).**

- `packages/venue-service/src/`: `schema/station-times.ts`, `schema/period-extensions.ts` (new),
  `schema/index.ts`, `classification.ts` and its test, `migrations.test.ts`, `service.test.ts`,
  `station-times.ts` and `station-times.test.ts`, `routing.ts` and `routing.test.ts`,
  `routing-store.ts` and `routing-store.test.ts`, `service-day.ts` and its test,
  `menu-timetable.ts`, `menu-timetable-types.ts`, `menu-timetable.test.ts`, `keep-open.ts` (new)
  and `keep-open.test.ts` (new), `operations.ts` and `operations.test.ts`, `service.ts`,
  `index.ts`, `errors.ts`, `permissions.ts`, `routes.ts`, `routes.test.ts`,
  `dashboard/prep-stations-screen.ts` and its tests, `dashboard/routing-client.ts` and its test,
  `dashboard/strings.ts`; `drizzle/` (one or two generated migrations, snapshots, journal)
- `packages/module/src/module.ts`; `packages/catalogue/src/menu-document-types.ts`
- `packages/identity/src/authorize.ts`, `staff.ts`, `index.ts` and their tests
- `apps/server/src/`: `station-today-api.ts` (new), `keep-open-api.ts` (new), `till-api.ts` (the
  `STATUS` map and two mount calls), `pin-check-ahead.ts`, `device-api.ts`
  (`GET /api/device/station`), `errors.ts` if a code is declared there,
  `till-api.profile-actions.test.ts`, `till-api.profile-zones.test.ts`,
  `till-api.station-today.test.ts` (new), `till-api.keep-open.test.ts` (new),
  `testing/clear-provision-fixture.ts`, `configuration-transfer.test.ts`, `station-move.test.ts`
  (two new cases), `working-order.ts` (one empty `service` literal, `:447` S1)
- `apps/till/src/`: `api/client.ts`, `state/menu-state-poll.ts`, `till-app.ts`,
  `screens/till-station-screen.ts`, `screens/till-counter-screen.ts`,
  `screens/till-table-order-screen.ts`, `widgets/station-today.ts` (new),
  `widgets/station-today-dialog.ts` (new), `widgets/keep-open.ts` (new),
  `widgets/keep-open-dialog.ts` (new), `i18n/strings.ts`, `i18n/codes.ts`, and their tests
  (`*.test.ts`, `*.a11y.test.ts`, `*.unsaved.test.ts`, `*.save-state.test.ts`,
  `screens/service-periods.a11y.test.ts`, `till-app-menu-refresh.test.ts`)
- `scripts/schema-constraints.test.ts`, `scripts/migration-upgrade.test.ts` (only if it needs an
  entry)
- `docs/developers/conventions-ui.md` (`:246-249`, M), `docs/developers/conventions-data.md`,
  `docs/developers/design-system.md` (`:1705-1708`, M), `docs/backlog.md` (S11 `:1309-1312` and
  the A366 entry), `docs/backlog/service-periods.md`

**Part B (Tasks B1–B4).** `packages/venue-service/src/schema/zone-extensions.ts` (new),
`schema/index.ts`, `classification.ts` and its test, `migrations.test.ts`, `service.test.ts`,
`zone-closed-times.ts` and its test (slice 2's, new there), `keep-open.ts` and its test,
`operations.ts`, `service.ts`, `errors.ts`; `drizzle/` (one migration);
`packages/module/src/module.ts`; `packages/catalogue/src/menu-document-types.ts`;
`apps/server/src/keep-open-api.ts`, `till-api.ts` (`/api/zones`, `STATUS`),
`till-api.keep-open.test.ts`, `till-api.profile-zones.test.ts`,
`testing/clear-provision-fixture.ts`; `apps/till/src/api/client.ts`, `widgets/keep-open.ts`,
`widgets/keep-open-dialog.ts`, `screens/till-counter-screen.ts`,
`screens/till-table-order-screen.ts`, `screens/till-floor-screen.ts`, `till-app.ts`,
`i18n/strings.ts`, `i18n/codes.ts`, and their tests; `scripts/schema-constraints.test.ts`;
`docs/developers/conventions-data.md`, `docs/backlog.md`.

### 2. Does this slice need slice 2?

| What | Needs slice 2? | What was checked |
| --- | --- | --- |
| "Keep Lunch open until 14:30 today" (spec §5) | **No.** | It changes when a department's period runs. Periods, days and the resolver are slice 1's (`resolveDepartmentService`, `packages/venue-service/src/menu-timetable.ts:193-315`, S1); slice 1 already waits for it (slice 1 plan, decision 2: "until slice 3's manager extension can keep the period open"). Slice 2 adds nothing a period reads except named days with own hours (slice 2 decision 6), which change which ranges a date has, not how an extension is laid over them. |
| "Close for today" / "Open for today" for a station (§8, §10, S11) | **No.** | Today's by-hand state is `station_day_states` (`packages/venue-service/src/schema/station-times.ts:26-42`, M) and its writer `setStationToday` (`station-times.ts:66-102`, M), read by routing (`routing-store.ts:267-289`, `routing.ts:193-224`, M). Slice 2 touches only the station-hours readers for repeating named days (slice 2 Task 4, `readStationSchedules` and `stationsRestrictedFrom` in `hours.ts`), which this slice does not change. |
| "Keep the Terrace open until 01:30 today" (§5) | **Yes — Part B.** | A zone is closed only by slice 2's closed times: §6 "Closed times"; slice 2 Task 2 (`zone_closed_times`), Task 10 (`closedZoneIdsAt`, `assertZoneTakesNewOrders`, `service.zoneOpen`), Task 11 (the server refusing new orders in a closed zone), Tasks 13–14 (the till's closed-zone notice and floor). On M and S1 nothing closes a zone apart from its department (`git grep -n "zone_closed\|zoneOpen" <ref> -- '*.ts'` printed nothing for `main` or `feat/service-periods-slice-1`), so there is nothing to keep open. "It cannot open a zone while its department is closed" (§5) is the same rule as slice 2's decision 14 (one refusal per reason). |

**Conclusion.** **Part A** (Tasks A1–A14c: the period extension and the station controls) needs
slice 1 only and can be built as soon as slice 1 lands, before or beside slice 2. **Part B**
(Tasks B1–B4: the zone extension) needs slice 2 and must not start until slice 2 lands; its tasks
are written against slice 2's plan, not its code, and must be re-grounded then. The spec's order
(§13) puts all of slice 3 after slice 2; building Part A first is a departure (decision 1).

### 3. Files shared with other slices (same files, different areas)

- **Slice 1's branch** (Part A builds on it): `menu-timetable.ts` (`resolveDepartmentService`),
  `menu-timetable-types.ts` (`DepartmentService :27-35`, S1), `service-day.ts`, `operations.ts`
  (`listZoneOffers :820-871`, `menuState :873-904`, S1), `packages/module/src/module.ts`
  (`ZoneOffers :250-255`, `ZoneMenuState :266-270`, S1), `packages/catalogue/src/menu-document-types.ts`
  (`MenuState.service :382`, S1), `apps/till/src/api/client.ts`, `till-app.ts`
  (`#onMenuState :2949-2981`, S1), `till-counter-screen.ts` (`:148-151`, `:286-293`, S1),
  `till-table-order-screen.ts` (`:1106-1109`, `:2800-2807`, S1), `i18n/*`, `errors.ts`,
  `classification.ts`, `migrations.test.ts`, `routes.ts`, `routes.test.ts`, `hours-routes.test.ts`,
  `clear-provision-fixture.ts`, `scripts/schema-constraints.test.ts`,
  `scripts/migration-upgrade.test.ts`.
- **Slice 2** (unbuilt): the same `service` shape in `module.ts`, `operations.ts`,
  `menu-document-types.ts` and the till client (slice 2 Task 10 adds `zoneOpen` beside this
  slice's `keepOpen`); `resolveDepartmentService` (slice 2 Task 3 changes its named-day read,
  `menu-timetable.ts:236-248` S1); `till-counter-screen.ts`, `till-table-order-screen.ts` and
  `till-app.ts`'s menu-state comparisons (slice 2 Task 13); `routing-store.test.ts` (slice 2 Task
  4's cases); `till-api.ts`'s `STATUS` map; `errors.ts`, `classification.ts`,
  `migrations.test.ts`, the venue-service drizzle journal (a number collision is fixed by
  regenerating, never by hand — CLAUDE.md §3), `scripts/schema-constraints.test.ts`,
  `clear-provision-fixture.ts`. Whichever lands second puts its field beside the other's.
- **Slice 5** (monitors; its Part A may land before this slice): `till-station-screen.ts` (device
  mode goes from one station to several, slice 5 decision 7), `GET /api/device/station` (becomes
  `GET /api/device/prep`, slice 5 decision 12), `apps/till/src/api/client.ts`, `i18n/*`,
  `module.ts`, the profile-actions map. If slice 5 lands first, Task A7 puts the station control
  in each station's section of the prep monitor and checks the station against the device's
  monitor instead of `device.stationId`.

### 4. What slice 4 will change that this slice touches

Slice 4 removes station hours and the configured fallback (§8, §13 item 4). This slice leaves both
working and builds on them, so slice 4's planner should know:

- `StationTiming.todaySendsTo` (Task A3) becomes the only "next station" a closed station has; the
  fallback branch of `walkFallbacks` (`routing.ts:244-260`, M) goes. A closed-for-today row with no
  destination (rows written before Task A1, and the many tests that call
  `setStationToday(…, "closed", …)` with no destination) then needs a rule: this plan's default
  for slice 4 is the default station.
- `openStationForToday` (Task A2) deletes today's row when the station's hours would have it open
  now and stores "open" otherwise. With hours gone, slice 4 decides what "open now" means
  (§8: "a station is open whenever something it makes can be ordered").
- The dashboard's fallback field is relabelled "Outside its hours, work goes to" (Task A8);
  slice 4 deletes it with the rest of the station hours.
- The `out_of_hours` and `closedSendsTo` paths in the dashboard's status sentences
  (`prep-stations-screen.ts:1670-1694`, M) and the station read-outs added here
  (`StationTodayState.why`, Task A3) lose `out_of_hours`.

---

## Decisions this plan makes that the spec does not

Each is the DEFAULT to build; the owner may override any when reviewing the plan.

1. **Two pull requests.** Part A (period extension, station controls) after slice 1; Part B (zone
   extension) after slice 2. Why: the station controls and the period extension need nothing from
   slice 2, and S11 has waited since 2026-10-01. Override: one pull request after slice 2.
2. **Who may do it: `venue_service.manage`, by sign-in or by a PIN.** It is the permission today's
   dashboard "Close for today" already checks (`VENUE_SERVICE_PERMISSIONS`,
   `packages/venue-service/src/permissions.ts`, granted from manager; the route at
   `packages/venue-service/src/routes.ts:566-581` S1 runs through `gated`, `:283` S1). No new
   permission (the owner prefers few, coarse ones). At a till, a signed-in person without it is
   refused `authorization.not_permitted` and the till offers the PIN of someone who holds it, as
   the drawer does (`till-app.ts:4304-4314`, M; S11 asks for exactly this). On a kitchen display
   nobody is signed in, so every close or open takes such a PIN. `authorize`,
   `listActivePersonsWithPermission` and `overrideToCheck` widen their `permission` to
   `Permission | (string & {})`, as `authorizeManager` already does
   (`packages/identity/src/manager-login.ts:164-166`, M). Override: a kitchen display closes its
   own station with no PIN, gated only by its profile's `prepare-orders`.
3. **No profile action for the till's routes; `prepare-orders` for the kitchen display's.** The
   till's close, open and keep-open routes order, pay, prepare, hand over, print and open no drawer,
   so they join the map's "left ungated by decision" list
   (`apps/server/src/till-api.profile-actions.test.ts:92-103`, M) with that reason; the person's
   permission is the check. The kitchen display's route also checks `prepare-orders`, its only
   action (`SHARED_DISPLAY_ACTIONS`, `packages/layouts/src/device-profile.ts:19`, M; slice 5 plan
   decision 4 cites the same line), so a display whose profile has lost it cannot act.
4. **A period extension is one row per department per business day**, `period_extensions`
   (department, business day, period, `starts_at`, `ends_at`, clock times read inside the business
   day as slice 1's ranges are — slice 1 decision 3). It lays the span `starts_at`–`ends_at` over
   the day as a range of its period: a range it covers wholly does not run that day, one it
   overlaps is cut back. A new extension replaces the day's row. It is `state`, not carried by a
   configuration export, and needs no clean-up job: readers ask only for today's business day, and
   the writer deletes the department's rows for other days (as `setStationToday` does,
   `station-times.ts:76-83`, M).
5. **What can be kept open.** The period running now, or, when none runs, the period whose range
   (scheduled or extended) ended last today. `starts_at` is the scheduled end of that period's run;
   an existing extension of the same period keeps its `starts_at` and only moves its end. `until`
   is a clock time in 15-minute steps, later than now and than `starts_at`, at most the changeover
   (`locations.day_cutover`; an `until` equal to the changeover is the end of the business day,
   slice 1 decision 3), and not a minute the clock skips (slice 1's `skippedEndpoint` rule). It may
   run past the next period's start: that period then starts at `until`, and the dialog says so.
   "End the extension" deletes the row; the scheduled day applies at once. Nothing shortens a
   period below its schedule (the spec asks only to extend).
6. **The till's period line shows the end.** `service` gains `keepOpen` (Task A11): the running
   period's effective end, or the last one's, and whether it is extended. The counter and table
   screens' period line (`till-counter-screen.ts:290-292`, `till-table-order-screen.ts:2807`, S1)
   reads "Lunch · until 14:00", or "Lunch · kept open until 14:30", with a quiet "Keep Lunch open
   later" button; the closed-department notice (`:288`, `:2803`, S1) gets "Keep Lunch open later"
   when a period ran earlier today. The dialog lists the times a server read offers
   (`GET /api/service-zones/:zoneId/keep-open`), so the till never computes the changeover or the
   clock's skipped minutes.
7. **A clock that cannot be read** refuses every write here with `time_zone.unreadable` (the code
   `setStationToday` already throws, `station-times.ts:75`, M) and the till shows no keep-open
   button (`keepOpen: null`). Reads keep slice 1's decision 5: every menu stays orderable.
8. **"Close for today" asks where the work goes.** The choices are the active stations open now
   other than this one, the default station first and chosen when the dialog opens (spec §8); a
   station closed for today is never offered, so two choices cannot point at each other; the
   database also refuses a station pointing at itself (`station_day_states_sends_to_not_self_ck`,
   Task A1), as it does for the configured fallback (`station_fallbacks_not_self_ck`). "No
   preparation" is not offered: a closed station's work is never dropped. The server refuses a
   destination that is this station, unknown, switched off or closed now
   (`station.destination_invalid`). The default station cannot be closed: no button, and the server
   refuses `station.always_open` (the existing code, `packages/venue-service/src/errors.ts:122`
   S1, today used for hours on the default station, `hours.ts:116` M). Every other active station
   can be closed, including one with no hours, which today's dashboard does not offer
   (`#todayCell`, `prep-stations-screen.ts:1702`, M, shows "Always open" for `no_hours`).
9. **Where work goes while a station is closed for today.** `station_day_states` gains
   `sends_to_station_id`. Routing walks from a station closed by hand to its chosen destination; if
   that one is closed too, the walk continues from it (its own chosen destination, or its
   configured fallback when it is out of hours) as today. A walk that left a station closed with a
   recorded destination and finds no open station ends at the default station, never at
   `station.no_replacement` (`apps/server/src/working-order.ts:1522-1526`, M). A closed row with
   no destination — rows written before this slice, and test fixtures that call
   `setStationToday(…, "closed", …)` — keeps today's behaviour (the configured fallback); slice 4
   replaces that (section 4 above). Out-of-hours closures keep the configured fallback until
   slice 4.
10. **Closing moves nothing already sent, and only some held work.** Dishes already sent to the
    station stay on its screen and tickets. Held (not yet sent) work at the station is handled at
    its release by `rerouteHeldAtRelease` (`apps/server/src/station-move.ts:20-`, M), which this
    slice does not change, and which moves less than "everything held":
    - a held dish placed there by the routing (no `stationChosenAt`, and its make-at station is not
      this one, `station-move.ts:63-68`, M) is re-routed at release, so it goes to the chosen
      destination;
    - a held dish placed there by hand (`stationChosenAt` set, or its make-at station is this one)
      stays at the closed station, with no alert (it is filtered out at `:63-68` before the stranded
      list is built);
    - a held extra or a held line with no product (`:69-70`), and a dish whose routing at release
      still answers this station or no station (`:97-104`), stays and raises
      `raiseReleasedAtClosedStation` (`:71-87`).
    The dialog says only what is true for every case: "Dishes already sent stay on this screen.
    Dishes placed here by hand stay here too." Task A3 pins the first two bullets with tests. Staff
    move what stays with the existing move (`POST /api/working-orders/:id/lines/move-station`).
    Override (not built): re-route hand-placed held dishes when their station is closed for today.
11. **"Open for today" moves nothing back.** Work sent to the destination stays there. Opening
    deletes today's row when the station's hours would have it open now, and stores "open"
    otherwise, so a station closed at 15:00 and reopened at 16:00 still closes at its scheduled
    17:00. There is no "Back to the schedule" on the till (the dashboard's third button,
    `prep.back_to_schedule`, goes with the dashboard buttons).
12. **The dashboard loses its today buttons.** Spec §9 and §10: live controls are not on the
    configuration pages. `PUT /management-api/venue-service/stations/:stationId/today` goes
    (`routes.ts:566-581`, S1), with the client method and the Prep stations screen's "Close for
    today", "Open for today" and "Back to the schedule" (`prep-stations-screen.ts:1696-1715`,
    `:3312-3330`, M). The screen's status sentence stays until slice 4 slims the page, now naming
    the chosen destination. The fallback field's label becomes "Outside its hours, work goes to" /
    "Fuera de su horario, el trabajo va a" (`prep.when_closed`, `dashboard/strings.ts:109`, `:830`,
    M), because a station closed by hand no longer uses it.
13. **What the kitchen display shows.** Above its queue, one status line for its station — "Open",
    "Closed for today. New dishes go to Grill.", "Opened for today.", "Closed now (outside its
    hours). New dishes go to Grill." or, for the default station, "Always open: this is the default
    station." — and one quiet button, "Close for today" while it is open, "Open for today" while it
    is closed. Closing opens the destination dialog, then the PIN; opening goes straight to the
    PIN. The till's Station screen shows the same line and button for the station picked, and
    marks a closed station in its picker ("Bar · Closed"). Neither shows period or zone extensions
    (spec §10: those are on the till only).
14. **No record of who.** Neither table stores the person who authorized a change; the routes
    record nothing beyond the row. Override: a `set_by_person_id` column on each table.
15. **Error codes** (pre-live, named for the concept — CLAUDE.md §3; siblings checked in
    `packages/venue-service/src/errors.ts`, S1):
    - `period_extension.invalid` `{ field: "until" | "periodId"; reason?: "step" | "not_later" | "clock_skips" }` — 400.
    - `period_extension.not_allowed` `{ periodId: string }` — 409: the period is not the one
      running now nor the last one today.
    - `station.destination_invalid` `{ stationId: string; destinationId: string; reason: "self" | "not_found" | "inactive" | "closed" }` — 409.
    - Reused: `station.always_open` (409), `route.station_inactive` (closing a switched-off
      station, 409), `station.not_found`, `time_zone.unreadable` (409), `service_zone.not_found`,
      `service_zone.not_allowed`, `authorization.not_permitted`, `pin.invalid`, `pin.throttled`,
      `device.forbidden_station` (a kitchen display acting on a station not its own),
      `device.forbidden_action`.
    - Part B: `zone_extension.invalid` `{ field: "until"; reason?: "step" | "not_later" | "clock_skips" }`
      (400) and `zone_extension.not_allowed` `{ zoneId: string; reason: "not_closing" | "department_closed" }`
      (409).
    None is a recorded incident, so none needs alert wording.
16. **Part B — the zone extension.** One row per zone per business day, `zone_extensions` (zone,
    business day, `starts_at`, `ends_at`), carved out of the zone's closed ranges that day. It may
    lift the closed range in force now or the next one that starts later today; `starts_at` is
    that range's start. `until` follows decision 5's rules, and the department must be open (its
    periods and any period extension) at every minute from `max(now, starts_at)` up to `until`,
    else `zone_extension.not_allowed` `reason: "department_closed"` — spec §5's "cannot open a zone
    while its department is closed". A zone with no closed time left today is `not_closing`. If
    the department's own extension later ends earlier, the zone's row stays but the department's
    refusal (slice 1's `menu_period.not_running`) wins, as slice 2 decision 14 keeps one reason per
    refusal.
17. **Part B — where the zone control sits.** In slice 2's closed-zone notice on the counter and
    table screens (slice 2 decision 17), beside the period line while the zone closes later today,
    and on the floor's zone bar for the zone shown when it is closed or closes later today.
18. **The business day.** Every row here is keyed by slice 1's business day (`serviceMomentAt`,
    `packages/venue-service/src/service-day.ts:71-82`, S1, from `locations.day_cutover`), and ends
    at the changeover. Changing the changeover while a row exists reads its clock times inside the
    new day, the same open question slice 1's review left for saved ranges (`docs/backlog.md`
    A366 entry, S1, "changing the business-day start after saving hours"); this slice adds no
    handling of its own.
19. **A432's end offset is measured from the extended end.** Slice 1 now accepts a new dish only
    while its own period runs, with a per-period offset from the end fixed at 0 (slice 1 decision 1
    at S1; the "Owner update, 2026-10-08" paragraph of spec §5, lines 111-115, present only on
    slice 1's branch at S1). An extension moves the period's end, so when A432 makes the
    offset configurable, "Lunch kept open until 14:30" with a −15 offset takes last orders at
    14:15. This slice builds nothing for A432; it only keeps the extended end as the one end every
    reader sees (`withExtension`, Task A9).

## Where the code differs from what the spec assumes

- §5 says an extension "ends at the changeover, like a station's 'Open for today'". A station's
  "Open for today" exists today, on the dashboard only, keyed by business day
  (`station_day_states`, `setStationToday`, `station-times.ts:66-102`, M), with a third state,
  "Back to the schedule". Decision 11 drops the third state.
- §8 says the "If closed, work goes to" setting goes. §13 puts that in slice 4, with station hours,
  so this slice keeps it for out-of-hours closures only (decision 9) and relabels it (decision 12).
- §10 folds in S11, which asks for "a core till route calling a new `VENUE_SERVICE` seat method …
  Take a manager's PIN as the cash drawer route does" (`docs/backlog.md:1309-1312`, M). The drawer
  checks `cash.drawer` through `authorize` and a session (`till-api.ts:2117-2150`, M); a kitchen
  display has no session, so Task A5 adds a PIN-only authorization.
- §10 puts the station controls on "the kitchen display". Today a kitchen display shows exactly one
  station (`device.stationId`, `apps/server/src/device-api.ts:398-416`, M) until slice 5.

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`.
- Work in this branch's worktree; never commit to `main`.
- A shipped migration file is never edited. New migrations only, generated with
  `pnpm --filter @waitron/venue-service db:generate`, never hand-numbered or hand-edited.
- drizzle-kit 0.31.11: a generation that rebuilds a table must not also add a column to it. A
  rebuild runs with foreign keys on, so its `DROP TABLE` empties cascading children: list the keys
  that point at the table first (`grep -rln 'REFERENCES \`<table>\`' packages/*/drizzle/`).
- No data-migration code before go-live (CLAUDE.md §3).
- Every foreign key and unique index is declared in the TypeScript schema; every new table is
  classified in `VENUE_SERVICE_CLASSIFICATION` (`classification.ts`), as `state`.
- Error codes are registered in `packages/venue-service/src/errors.ts` (or the throwing package's
  registry), with a status in every route map that answers them (`packages/venue-service/src/routes.ts`
  `STATUS :90-`, S1 and `apps/server/src/till-api.ts` `STATUS :370`, M), and wording in English and
  Spanish wherever a screen shows them (`apps/till/src/i18n/codes.ts`, `strings.ts`).
- venue-service functions take `cfg: VenueScope`; multi-table writes take one `tx: Transaction`;
  queries on one transaction are awaited in turn.
- **A PIN is checked before the transaction opens and in turn**: `withPinCheckAhead`
  (`apps/server/src/pin-check-ahead.ts:24-39`, M) with `overridePinAttempts`
  (`till-api.ts:617-622`, M), as the drawer route does (`till-api.ts:2117-2150`, M). The new mounts
  receive the till's one `pinThrottle` (`till-api.ts:1051`, M), as `mountBillPaymentsApi` does.
- **Every new till route** gets a row in the route-to-action map
  (`apps/server/src/till-api.profile-actions.test.ts:38-107`, M) and the route-to-zone map
  (`apps/server/src/till-api.profile-zones.test.ts:61-155`, M), and a refusing case for each gate
  it has. Both maps are comments: nothing fails when a row is missing (CLAUDE.md §3).
- The till uses polling, not the dashboard's live subscriptions; no subscription name changes, so
  `scripts/live-subscriptions.test.ts` is untouched. The dashboard's routing live query already
  lists `station_day_states` (`packages/venue-service/src/dashboard/live-queries.ts:34`, `:51`, M).
- **Save rule (A331).** Each dialog this slice creates — the station's Close dialog and the
  keep-open dialog — takes its scope from `draftScopeFor`, draws its action through
  `saveActionState`, returns early in its save handler while `saveActionState(scope).unchanged`,
  and has a `*.save-state.test.ts` and a `*.unsaved.test.ts` with #1422's reconnect case (edit,
  take the dialog off the page, put it back: it still asks before discarding), as
  `apps/till/src/widgets/station-choice-dialog.ts:62-84`, `:135` (M) does. The Close dialog opens
  with the default station already chosen, so it is `{ savableAtOpen: true }`: closing is the
  action, not an edit. The keep-open dialog opens with nothing chosen and its action quiet and
  disabled. **A button that is not a save** ("Close for today", "Open for today", "Keep … open
  later", "End the extension") is drawn quiet (`secondary`) while it waits for a load, and in its
  own colour once it can act (CLAUDE.md §3; design-system.md → Forms).
- A screen does not draw its own `<select>`: the destination and the time are `wt-combobox`
  (`search="never"`), as `station-choice-dialog.ts:180-195` (M) does.
- New UI reads `--wt-*` tokens only. Strings in English and Spanish. Coverage stays at
  98/98/98/95 in every package touched. Comments only for an invariant or a non-obvious why.
- **LOOK** at every changed screen in English and Spanish, light and dark themes, 1280 and 390 CSS
  pixels wide, and say in the task's report what was looked at.

## Behaviour this slice removes

Tests pinning these may change, under the commit rule at the top, in the task named.

- **The dashboard's "Close for today", "Open for today" and "Back to the schedule"** and their
  route: `PUT /management-api/venue-service/stations/:stationId/today` (`routes.ts:566-581`, S1),
  `RoutingApi.setStationToday` (`dashboard/routing-client.ts:263-265`, M) and its test,
  `#todayCell`'s buttons and the `today` station action (`prep-stations-screen.ts:73`,
  `:1696-1715`, `:1801`, `:3312-3330`, M). Pinned at `prep-stations-screen.test.ts:2753-2757`,
  `:2966-2967`, `:3103` (M) and in `dashboard/routing-client.test.ts`. Task A8.
- **A station closed by hand with a recorded destination following its configured fallback.**
  Only rows Task A2's new writers create carry a destination, so no existing assertion is expected
  to change; if one does, it is a STOP.
- **The fallback field reading "When closed, work goes to"** (`prep.when_closed`). Task A8.
- **Slice 1's refusal of a new dish, or of a raised quantity on a stored line, after its period
  ended, while a manager keeps that period open** (slice 1 decisions 1 and 2 at S1; decision 2
  says it lasts "until slice 3's manager extension can keep the period open"). No slice 1
  assertion is expected to change: the refusal stands whenever no extension exists.

## Review focus

The conditions most likely to bite a person that no single task's happy path exercises.

1. **The boundary moves with the extension.** Lunch 12:00–14:00, Afternoon 14:00–19:00; Lunch kept
   open until 14:30 at 13:50: at 14:15 a Lunch item is accepted and an Afternoon item refused
   `menu_period.not_running`; raising a stored Lunch line's quantity at 14:15 is accepted; at
   14:30 Afternoon runs; at 14:30 a Lunch item is refused again (slice 1's offset of 0 is
   measured from the extended end) (Tasks A9 and A11).
2. **It ends at the changeover.** Night 21:00–03:00 kept open until 06:00 (cutover 06:00): at
   05:59 Night runs; at 06:00 the next business day starts with no extension (Task A9).
3. **Reopening a closed department.** After Lunch ends at 14:00 with nothing until 19:00, keeping
   Lunch open until 16:00 at 15:10 is accepted and Lunch runs until 16:00; a whole-venue closure
   day offers nothing to keep open (Tasks A9 and A10).
4. **A closed station's work is never dropped.** Grill closed for today → Bar: a Grill dish sent
   goes to Bar; a held Grill dish released goes to Bar; dishes sent before closing stay at Grill;
   Bar then switched off or closed sends Grill's work on, and a walk that finds nothing open ends
   at the default station, not at `station.no_replacement` (Tasks A3 and A4).
5. **Who can act.** A staff member's close is refused `authorization.not_permitted`; with a
   manager's PIN it succeeds; a wrong PIN answers `pin.invalid` and counts towards
   `pin.throttled` on that device; a kitchen display cannot close a station it does not show
   (`device.forbidden_station`) nor act without a PIN; a till outside the zone's department cannot
   keep its period open (`service_zone.not_allowed`) (Tasks A5, A6, A11).
6. **Nothing external.** Every write here is local; a clock that cannot be read refuses the write
   and leaves selling as slice 1 left it (Tasks A2, A10).
7. **Part B.** Terrace closed 23:30–06:00, kept open until 01:30 at 23:00: seating at 01:00 is
   accepted, at 01:30 refused `service_zone.closed`; with the department closing at 01:00 the
   extension to 01:30 is refused `department_closed` (Tasks B2 and B3).

---

## Part A — the period extension and station controls (first pull request)

### Task A1: Migrations — a station's destination today, and period extensions (add only)

**Files:**
- Modify: `packages/venue-service/src/schema/station-times.ts` (`stationDayStates :26-42`, M),
  `schema/index.ts`, `classification.ts` and `classification.test.ts` (`:17`, `:31`, S1),
  `migrations.test.ts` (`TABLES :33-`, S1), `service.test.ts` (beside `:94`, M: the new table is
  not transferred), `scripts/schema-constraints.test.ts` (foreign keys beside `:61`, unique indexes
  beside `:373`, checks beside `:467`, M), `apps/server/src/testing/clear-provision-fixture.ts`
  (`period_extensions` first in the list, `:7-` S1, since its department key has no delete rule)
- Create: `packages/venue-service/src/schema/period-extensions.ts`; generated
  `packages/venue-service/drizzle/00NN_*.sql`, snapshot, journal entry

**Interfaces — produces:**
- `stationDayStates.sendsToStationId`: `id("sends_to_station_id")`, nullable; foreign key
  `station_day_states_sends_to_fk` → `kitchen_stations.id` (no delete rule: at M `git grep -n "delete(kitchenStations"` finds only a test,
  `packages/db/src/schema/kitchen-stations.test.ts:129`; stations are switched off,
  `deactivateStation`); check `station_day_states_sends_to_not_self_ck`
  (`sends_to_station_id <> station_id`), written as `station_fallbacks_not_self_ck`
  (`schema/station-times.ts:22`, M). A null destination passes it, so rows already stored copy
  through unchanged.
- `periodExtensions` (table `period_extensions`): `id` (primary key, `newId`), `departmentId` not
  null → `departments.id` (`period_extensions_department_fk`), `businessDay` (`day`, not null),
  `periodId` not null, `startsAt`, `endsAt` (`timeOfDay`, not null). The period's key is
  **composite**, `(period_id, department_id)` → `menu_periods(id, department_id)`
  (`period_extensions_period_fk`, **on delete cascade**: a deleted period takes its extension with
  it), so a row cannot name another department's period. That is slice 1's pattern:
  `menu_slots_period_fk` (`schema/menus.ts:130-134`, S1) over the unique index
  `menu_periods_department_key` (`:42`, S1). Unique index `period_extensions_day_key`
  (`department_id`, `business_day`); check `period_extensions_step_ck` written as
  `menu_slots_step_ck` (`:135-139`, S1).

- [x] **Step 1: Failing test** in `migrations.test.ts`: `period_extensions` in `TABLES`; a second
  row for one department and business day is refused by the database; a row at `14:10` is
  refused; a row naming one department and another department's period is refused; deleting the
  period deletes its row; `station_day_states` takes a row with `sends_to_station_id` naming a
  station, refuses one naming nothing, and refuses one naming its own station. Run
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/migrations.test.ts`;
  expected: fails (no such table or column).
- [x] **Step 2: Schema, then generate — in two generations**, because the new check is expected to
  make drizzle rebuild `station_day_states` (believed: drizzle-kit for SQLite cannot add a CHECK
  with `ALTER TABLE`; Step 2b reads the SQL to confirm), and the 0.31.11 trap forbids a generation
  that rebuilds a table and adds a column to it (CLAUDE.md §3).
  - **2a.** Declare `period_extensions` whole and the new column with its foreign key, **without**
    the check. `pnpm --filter @waitron/venue-service db:generate`. Read the SQL: expected
    `CREATE TABLE period_extensions …` and `ALTER TABLE station_day_states ADD
    sends_to_station_id …`. If this generation already rebuilds `station_day_states` (a
    `__new_station_day_states` copy), revert its files, declare the column without its key,
    generate, and move the key to 2b.
  - **2b.** Add the check (and the key, if 2a moved it). Generate again. Expected: a rebuild of
    `station_day_states` and nothing else. The rebuild is safe: nothing points at the table
    (`grep -rln 'REFERENCES \`station_day_states\`' packages/*/drizzle/` printed nothing at M), so
    no child is emptied, and the copy keeps every row; an old row's null destination passes the
    check. If 2b does not rebuild (drizzle wrote an `ALTER`), keep it as generated.
- [x] **Step 3: Classification** — `period_extensions` as `state`. Add the keys, index and check to
  `scripts/schema-constraints.test.ts`; add the table to the fixture clear list; add
  `expect(names).not.toContain("period_extensions")` beside `service.test.ts:94` (M).
- [x] **Step 4: Run** Step 1's test, the package's node project, the server package (for the
  clear list), and
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/module-graph-honesty.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`. If the
  upgrade walk reports a casualty, STOP and report it: this slice promises no reset.
- [x] **Step 5: Commit** — `feat(venue-service): a station's destination today and period extensions (A366)`.

---

### Task A2: Writing a station's day — close with a destination, open, and the choices

**Files:**
- Modify: `packages/venue-service/src/station-times.ts` (`setStationToday :66-102`, M),
  `routing-store.ts` (the private `snapshot`, `:235`, M, gains the `ignoreToday` option and an
  exported reader that uses it — `snapshot` itself is not exported),
  `errors.ts` (register `station.destination_invalid`), `routes.ts` (its status in the map,
  `STATUS :90-`, S1), `index.ts` (exports), `permissions.ts` (export `MANAGE_VENUE_SERVICE`, today a
  local destructure at `routes.ts:89`, S1)
- Test: `packages/venue-service/src/station-times.test.ts`

**Interfaces — produces:**

```ts
export const MANAGE_VENUE_SERVICE: string; // "venue_service.manage"
/** Existing signature kept; a destination is stored only with "closed". Its many test callers keep working. */
export async function setStationToday(tx, cfg, stationId, state: "open" | "closed" | null, at: Date, sendsToStationId?: string | null): Promise<void>;
/** Active stations open at `at` other than `stationId`, the default first, then display order and name. */
export async function stationDestinations(tx: Transaction, cfg: VenueScope, stationId: string, at: Date): Promise<readonly { id: string; name: string; isDefault: boolean }[]>;
export async function closeStationForToday(tx: Transaction, cfg: VenueScope, stationId: string, sendsToStationId: string, at: Date): Promise<void>;
export async function openStationForToday(tx: Transaction, cfg: VenueScope, stationId: string, at: Date): Promise<void>;
```

`closeStationForToday` refuses, in this order: an unknown station (`station.not_found`), a
switched-off one (`route.station_inactive`), the default one (`station.always_open`), a
destination that is this station, unknown, switched off or not open now
(`station.destination_invalid` with `reason`), an unreadable clock (`time_zone.unreadable`).
`openStationForToday` deletes today's row when the station's status with today's row left out
would be open now, else stores "open" (decision 11). "Open now" comes from the same
`stationStatus` routing uses (`routing.ts:193-224`, M) over a snapshot read without today's row;
add a `{ ignoreToday?: true }` option to `snapshot`'s scope (`SnapshotScope :216`,
`snapshot :235`, `routing-store.ts`, M) and export one reader from `routing-store.ts`
(`scheduledStationStatus(tx, cfg, stationId, at)`) rather than a second status rule.

- [ ] **Step 1: Failing tests:** closing Grill with Bar stores `open: false` and Bar; closing the
  default station → `station.always_open`; closing Grill towards itself, towards a switched-off
  station and towards a station closed for today → `station.destination_invalid` with `self`,
  `inactive`, `closed`; `stationDestinations` for Grill lists the default first and leaves out
  Grill and a station closed for today; opening a station closed by hand inside its hours removes
  the row; opening one outside its hours stores "open"; an unreadable time zone refuses each
  writer. (Fails today: neither function exists.)
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/station-times.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; see them pass;** the venue-service node project; typecheck.
- [ ] **Step 5: Commit** — `feat(venue-service): close a station for today with a destination (A366)`.

---

### Task A3: Routing follows the chosen destination; the station states seat says why

**Files:**
- Modify: `packages/venue-service/src/routing.ts` (`StationTiming :53-62`, `walkFallbacks :244-260`,
  `closedSendsTo :270-282`, M), `routing-store.ts` (the snapshot's day-state read and timing
  `:267-292`; `stationStates :724-744`, M), `packages/module/src/module.ts` (`stationStates`
  value type, `:488` S1)
- Test: `routing.test.ts`, `routing-store.test.ts`, `apps/server/src/station-move.test.ts` (one
  new case beside `:1857`, M)

**Interfaces:**

```ts
// StationTiming gains (optional, so existing fixtures stand):
readonly todaySendsTo?: string | null;
// stationStates values gain the fields of:
export interface StationTodayState {
  readonly byHand: "open" | "closed" | null;
  /** Where a closed station's new work goes now; null while open or when nothing would take it. */
  readonly sendsTo: string | null;
  /** `stationStatus`'s `why` (`routing.ts:70-75`, M), with the open reasons folded into one. */
  readonly why: "default" | "open" | "opened_by_hand" | "closed_by_hand" | "out_of_hours" | "switched_off";
}
```

`StationTodayState` is declared in `packages/module/src/module.ts` beside the `stationStates`
seat, so the server and the till's answer types name it. `why` maps `stationStatus`'s reasons:
`in_hours`, `no_hours` and `time_not_applied` → `"open"`; the rest by name.

`walkFallbacks` takes the next station from `todaySendsTo` when the step's reason is
`closed_by_hand` and a destination is recorded, else from `fallbackId` as today. When the walk
passed a station closed by hand with a recorded destination and ends with no station, it returns
the default station if one is active (decision 9). `closedSendsTo` follows the same walk, so the
dashboard's status sentence (`routing-store.ts:837`, M) names the chosen destination.

- [ ] **Step 1: Failing tests:** in `routing.test.ts` — Grill closed by hand → Bar routes a Grill
  dish to Bar although Grill's fallback is Pastry; Grill → Bar with Bar out of hours follows Bar's
  fallback; Grill → Bar with Bar switched off and no fallback lands at the default station, not
  `noReplacement`; Grill closed by hand with no destination still follows Pastry (today's rule).
  In `routing-store.test.ts` — `stationStates` reports `byHand: "closed"`, `sendsTo` Bar and
  `why: "closed_by_hand"` for Grill, and `why: "switched_off"` for a switched-off station.
  In `station-move.test.ts` (decision 10) — a dish held at Grill by the routing, Grill closed for
  today towards Bar, then released: its ticket item is at Bar; a dish held at Grill **by hand**
  (make-at Grill), Grill closed the same way, then released: its ticket item stays at Grill and no
  incident is raised (pinning today's behaviour, which this slice keeps). (Fails today: the walk
  reads only `fallbackId`, `routing.ts:257`; the hand-placed case is expected to pass at once and
  is there so a later change to it is seen.)
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/routing.test.ts src/routing-store.test.ts` and `pnpm --filter @waitron/server exec vitest run src/station-move.test.ts`.
- [ ] **Step 3: Implement**, and add the three `StationTodayState` fields (`byHand`, `sendsTo`, `why`) wherever a test stub builds a `stationStates`
  value (`grep -rn "stationStates" apps packages`).
- [ ] **Step 4: Run; see them pass;** the venue-service node project and the server package;
  typecheck `@waitron/module`, `@waitron/venue-service`, `@waitron/server`.
- [ ] **Step 5: Commit** — `feat(venue-service): a station closed for today sends its work where it was told (A366)`.

---

### Task A4: Seats for the till — a station's day

**Files:**
- Modify: `packages/module/src/module.ts` (the venue-service seat list, beside `stationStates`
  `:488`, S1), `packages/venue-service/src/service.ts` (beside `stationStates`, `:19`, `:94`, M),
  every test stub of the contribution the typecheck names
- Test: `packages/venue-service/src/service.test.ts` (the seats exist and call through)

**Interfaces — seats:** `stationDestinations`, `closeStationForToday`, `openStationForToday`, with
the signatures of Task A2 and `cfg: { locationId: LocationId }`.

- [ ] Steps: failing test (each seat on `VENUE_SERVICE` — the contribution object,
  `packages/venue-service/src/service.ts:67`, M — closes, opens and lists as
  Task A2's functions do — fails today: no such seats); watch it fail
  (`pnpm --filter @waitron/venue-service exec vitest run --project node src/service.test.ts`);
  implement; the venue-service node project; typecheck every package the typecheck names; commit
  `feat(module): station day seats (A366)`.

---

### Task A5: Identity — a module's permission in an override, and a PIN without a session

**Files:**
- Modify: `packages/identity/src/authorize.ts` (`authorize :41-70`, `Authorization :25-29`, M),
  `staff.ts` (`listActivePersonsWithPermission :595-600`, M), `index.ts`,
  `apps/server/src/pin-check-ahead.ts` (`overrideToCheck :46-65`, M)
- Test: `packages/identity/src/authorize.test.ts` and
  `packages/identity/src/staff.list-active-with-permission.test.ts` (the suite for
  `listActivePersonsWithPermission`; both exist at M)

**Interfaces:**

```ts
// permission widens to Permission | (string & {}) in authorize, Authorization.permission,
// listActivePersonsWithPermission and overrideToCheck.
/** For a device with nobody signed in: the override's person must hold `permission`. Throws
 * `pin.invalid` (any credential that cannot sign in), `pin.throttled`, `authorization.not_permitted`. */
export async function authorizeByPin(
  tx: Transaction,
  args: { permission: Permission | (string & {}); override: Override },
  attempts: PinAttempts,
): Promise<Authorization>; // viaOverride: true
```

`authorizeByPin` uses `verifyThrottledCredential` (`packages/identity/src/credential.ts:83`, M) and
`roleHasPermission`, as `authorize`'s override branch does (`authorize.ts:62-69`, M).

- [ ] Steps: failing tests (a manager's PIN for `venue_service.manage` — registered as a
  **literal**, `registerModulePermissions([{ permission: "venue_service.manage", grantedFrom: "manager" }])`,
  as `packages/identity/src/permissions.test.ts:131` (M) registers `booking.manage`, never by
  importing `VENUE_SERVICE_PERMISSIONS`: `@waitron/venue-service` depends on `@waitron/identity`
  (`packages/venue-service/package.json:31`, M), so an identity test importing it closes a
  workspace dependency loop, which `scripts/workspace-cycles.test.ts` refuses (it counts
  `devDependencies`, `:22`, M) — passes; a staff member's right PIN → `authorization.not_permitted`; a wrong PIN → `pin.invalid`
  and counts towards `pin.throttled`; `listActivePersonsWithPermission(tx, "venue_service.manage")`
  lists the manager and not the staff member — fails today on types and on the missing function);
  watch them fail (`pnpm --filter @waitron/identity exec vitest run src/authorize.test.ts`);
  implement; the identity package and `pnpm --filter @waitron/server typecheck`; commit
  `feat(identity): a module permission in an override, and a PIN without a session (A366)`.

---

### Task A6: Server — the till's station routes

**Files:**
- Create: `apps/server/src/station-today-api.ts`
  (`mountStationTodayApi(app, deps, log, run, pinThrottle)`, shaped as
  `apps/server/src/unpaid-departure-api.ts`), `apps/server/src/till-api.station-today.test.ts`
- Modify: `apps/server/src/till-api.ts` (one call beside `:1054-1056`, M; `STATUS :370-` gains
  `station.destination_invalid: 409`, `station.always_open: 409`, `time_zone.unreadable: 409`,
  `device.forbidden_station: 403` where absent — `route.station_inactive` is there, `:474`, M),
  `GET /api/stations` (`:1797-1814`, M) answers `byHand`, `sendsTo` and `why` per station,
  `till-api.profile-actions.test.ts` (rows in "left ungated by decision", `:92-103`, M),
  `till-api.profile-zones.test.ts` ("Not zone-gated", `:151-154`, M)

**Routes.** The two reads need only a session, any person: staff without the permission need the
destinations and the authorizers before the PIN step, as `/api/drawer/authorizers` is
session-gated only (`till-api.ts:2106-2115`, M). Only the PUT checks `venue_service.manage` or an
override.

| Route | Gate | Body | Answer |
| --- | --- | --- | --- |
| `GET /api/service-day/authorizers` | session | — | the people holding `venue_service.manage` |
| `GET /api/stations/:stationId/today` | session | — | `{ destinations: { id, name, isDefault }[] }` |
| `PUT /api/stations/:stationId/today` | session + `venue_service.manage` or override | `{ state: "closed", sendsToStationId } \| { state: "open" }`, optional `override: { personId, pin }` | 204 |

The server package's identity registry knows `venue_service.manage` only once it is registered:
the new test file calls `registerModulePermissions(VENUE_SERVICE_PERMISSIONS)` at its top, as
`apps/server/src/management-api.test.ts:68` (M) does (production registers it at boot).

The PUT follows the drawer's order: `parseOverrideField` and `overrideToCheck` before any
transaction, `withPinCheckAhead` with `overridePinAttempts(pinThrottle, session.deviceId)`, then one
transaction running `authorize` and the seat. A malformed `state` or id is
`management.request_invalid`-style refusal already used by the till (`invalid("state")`, as
`parseOverrideField` refuses `override`, `till-api.ts:600-611`, M).

- [ ] **Step 1: Failing tests** through the real routes (`setupPartyVenue`,
  `apps/server/src/testing/party-venue.ts`): a manager closes Grill towards Bar → 204, and
  `GET /api/stations` shows Grill `open: false`, `byHand: "closed"`, `sendsTo` Bar; a staff
  member's close → 403 `authorization.not_permitted` and nothing stored; the same with a
  manager's override → 204; a wrong PIN → 401 `pin.invalid`, and repeated wrong PINs →
  `pin.throttled`; closing the default station → 409 `station.always_open`; a destination closed
  for today → 409 `station.destination_invalid`; opening → 204; a staff member reads the
  destinations and the authorizers list → 200. Then a sale
  sent from the till with a Grill dish prints at Bar (`ticket_items.station_id`). (Fails today: no
  such routes.)
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/till-api.station-today.test.ts`.
- [ ] **Step 3: Implement**; add the map rows: each new route "left ungated by decision — a
  manager's decision about the venue's day, checked by `venue_service.manage`"; zone map: "Not
  zone-gated — names no zone".
- [ ] **Step 4: Run; see them pass;** the server package; `pnpm --filter @waitron/server typecheck`.
- [ ] **Step 5: Commit** — `feat(server): close or open a station for today from the till (A366)`.

---

### Task A7: Server — the kitchen display's station route

**Files:**
- Modify: `apps/server/src/station-today-api.ts`, `apps/server/src/device-api.ts`
  (`GET /api/device/station :398-416`, M: the answer gains `name` and `today`),
  `till-api.profile-actions.test.ts` (a `prepare-orders` row and a refusing case in `ROUTES`)
- Test: `apps/server/src/till-api.station-today.test.ts`

**Routes (device cookie, `requireDevice`; the device's station only):**

| Route | Body | Answer |
| --- | --- | --- |
| `GET /api/device/stations/:stationId/today` | — | `{ destinations, authorizers }` |
| `PUT /api/device/stations/:stationId/today` | as the till's, with `authorizer: { personId, pin }` | 204 |

A station that is not `device.stationId` → `device.forbidden_station` (`device-api.ts:461`, M,
the same refusal the bump route gives); a profile without `prepare-orders` →
`device.forbidden_action` (`assertProfileAction`); no `authorizer` →
`authorization.not_permitted`; otherwise `withPinCheckAhead` with
`overridePinAttempts(pinThrottle, device.deviceId)` and `authorizeByPin`. The routes live in the
till's mount, not `device-api.ts`, so they share the till's PIN throttle (`device-api.ts` has
none: `grep -n pinThrottle apps/server/src/device-api.ts` finds nothing at M). `GET
/api/device/station`'s `today` is `{ open, isDefault, byHand, sendsTo: { id, name } | null, why }`
from `stationStates` (Task A3); `why` is `StationTodayState["why"]`, `switched_off` included, so a
kitchen display bound to a station switched off since shows "Switched off" and no button.
If slice 5 has landed, the station check reads the device's prep monitor instead, and `today`
goes on each station of `GET /api/device/prep`.

- [ ] Steps: failing tests (a kitchen display bound to Grill closes Grill with a manager's PIN →
  204; without a PIN → 403; with a staff PIN → 403; for Bar → 403 `device.forbidden_station`; its
  profile stripped of `prepare-orders` → 403 `device.forbidden_action`; `GET /api/device/station`
  shows `today.byHand: "closed"` and `sendsTo` Bar, and `why: "switched_off"` once Grill is
  switched off — fails today: no such routes or field); watch
  them fail; implement; the server package; typecheck; commit
  `feat(server): close or open its station from the kitchen display, with a manager's PIN (A366)`.

---

### Task A8: Dashboard — the Prep stations screen loses its today buttons

**Files:**
- Modify: `packages/venue-service/src/routes.ts` (delete the route, `:566-581` S1),
  `dashboard/routing-client.ts` (`setStationToday :263-265`, M), `dashboard/prep-stations-screen.ts`
  (`StationAction`'s `today` kind `:73`; `#todayCell :1696-1715`; `:1801`; the dialog's today
  heading and sentence `:3312-3330`, M), `dashboard/strings.ts` (remove `prep.close_today`,
  `prep.open_today`, `prep.back_to_schedule`, `prep.close_confirm`, `prep.close_confirm_ask` once
  unused; relabel `prep.when_closed` at `:109` and `:830`, M)
- Test: `prep-stations-screen.test.ts`, `prep-stations-screen.a11y.test.ts`,
  `dashboard/routing-client.test.ts`, `routes.test.ts`. (`prep-stations-screen.unsaved.test.ts`
  holds only `today: null` fixture data, `:34`, `:38`, M, and is not expected to change.)

**Behaviour:** the Today column keeps its status sentence (`#stationStatus`, `:1670-1694`, M) and
loses its button; a station closed by hand reads "Closed now, closed by hand until {time} {day}.
Work goes to {destination}." naming the chosen destination (Task A3's `closedSendsTo`). The route
answers 404.

**Assertions this task may change** (the class: any assertion on the Today column's buttons, the
`today` station action and its confirmation, `setStationToday` on the dashboard client, and the
`/management-api/venue-service/stations/:id/today` route). Found at M with
`grep -n "close-today\|open-today\|schedule-\|Close for today\|Open for today\|Back to the schedule\|setStationToday\|/today\|close_confirm" <file>`:

- `prep-stations-screen.test.ts` (M lines): "keeps station action %s in Stations rather than
  Routing" (`:386-389`); "shows station status %j" (`:676-694`); "confirms a by-hand closure and
  clears it back to the schedule" (`:732-758`); "saves the by-hand action %s" (`:1882-1907`);
  "guards the pending close dialog against cancellation until %s" (`:2273-2287`); "has no station hours section or editor,
  and keeps Today's schedule actions" (`:2741-2757`); "Today redraws the scheduled label when the
  next background read no longer carries the by-hand closure" (`:2762-2789`); "keeps subject tabs
  accessible and inside the viewport" (`:2877-`, only its `setStationToday` stub at `:2951`);
  "Today confirms a %s action on the selected station before writing" (`:2965-2988`); "Today
  names the effective fallback and returns a by-hand closure to the schedule" (`:2991-3013`);
  "Today keeps its confirmation and refusal after a write fails and allows a retry"
  (`:3028-3055`); "Today controls remain accessible in %s %s at %ipx" (`:3059-3105`); "Today
  changes at a schedule boundary without a database event" (`:3148-3179`); "keeps supervisor
  numbers and drilldowns live without exposing any configuration controls" (`:4766-4799`, whose
  absence check of `close-today-upstairs` stays true).
- `prep-stations-screen.a11y.test.ts`: "checks %s" (`:329-`, the stub at `:457` and the
  `close-today` selector at `:502`).
- `dashboard/routing-client.test.ts:10-14`.
- `routes.test.ts`: "saves and clears today's by-hand state and validates its value"
  (`:855-`, the route at `:857`) and "serves today's station status to a supervisor without
  exposing routing configuration" (`:2484-2519` S1, `:2477-2512` M; its PUT now answers 404, not
  403). (`routes.test.ts` lines are S1, since slice 1 changed the file; `:855`/`:857` are the same
  on both.)

A case that checks the status sentence keeps its assertion; a case that drives a button is
changed to assert the button is absent, or deleted when the button was its whole subject, and
the commit lists each with `file:line`, before and after.

- [ ] Steps: the separate `Changed test checks (A366 slice 3):` commit first, covering the list
  above; watch them fail; implement; `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/prep-stations-screen.test.ts src/dashboard/prep-stations-screen.a11y.test.ts src/dashboard/prep-stations-screen.unsaved.test.ts src/dashboard/routing-client.test.ts`
  and the node project; `grep -rn "setStationToday\|close_today\|back_to_schedule" packages apps`
  shows only the venue-service function and its test callers; LOOK at Prep stations → Stations in
  EN and ES, both themes, 1280 and 390; commit
  `feat(venue-service): live station controls leave the dashboard (A366)`.

---

### Task A9: The extension laid over the day

**Files:**
- Modify: `packages/venue-service/src/service-day.ts` (S1), `menu-timetable.ts`
  (`resolveDepartmentService :193-315`, S1), `menu-timetable-types.ts` (`DepartmentService
  :27-35`, S1)
- Test: `service-day.test.ts`, `menu-timetable.test.ts`

**Interfaces:**

```ts
export interface ServiceExtension { periodId: string; startsAt: string; endsAt: string }
/** `ranges` with `extension` laid over them: its span runs its period; a range it covers wholly is
 * dropped; one it overlaps is cut back. Sorted by start. */
export function withExtension(ranges: readonly ServiceRange[], extension: ServiceExtension | null, cutover: string): ServiceRange[];

// DepartmentService gains:
readonly keepOpen: {
  periodId: string;
  periodName: string;
  /** The end of that period's run today, after any extension, as a clock time. */
  endsAt: string;
  running: boolean;
  extendedUntil: string | null;
} | null;
```

Refactor the day read out of `resolveDepartmentService` into one internal function
(`departmentDay(tx, cfg, departmentId, moment, clock)`: periods, staff menus, today's and
yesterday's ranges, and today's extension), so Task A10's writer and Part B read the same day.
Today's ranges become `withExtension(ranges, extension, cutover)` before `rangeInForce` and the
"ended" list (`:299-302`, S1), so a range the extension covers wholly is never "ended"
(`endedMenuIds` is still answered, `:310` S1, though since `baa24e213` no request reads it to
accept a line: `git grep -n endedMenuIds 36697d7b5 -- '*.ts'` finds only its type and producer
outside tests). `keepOpen`
is the running period's merged run (two touching ranges of one period are one run), else the run
that ended last today; null on an unreadable clock, and null when no range has run today.

- [ ] **Step 1: Failing tests:** `withExtension` — review focus 1's day with Lunch extended to 14:30
  gives Lunch 12:00–14:00, Lunch 14:00–14:30, Afternoon 14:30–19:00; an extension to 20:00 drops
  Afternoon; a Night 21:00–03:00 extended to 06:00 with cutover 06:00 ends at the end of the day.
  `resolveDepartmentService` with a stored row — at 14:15 the period is Lunch and Afternoon's menus
  are neither orderable nor ended; at 05:59 Night runs, at 06:00 the next business day has no
  extension; `keepOpen` at 13:50 is Lunch until 14:00, at 14:15 Lunch until 14:30 extended, at
  15:10 with nothing running Lunch until 14:00 not running. (Fails today: no extension is read.)
  Beside slice 1's pricing pin "prices every period menu without reading ranges, dates or the venue
  clock" (`menu-timetable.test.ts`, S1 — find it by that title), a case that no statement names
  `period_extensions` when pricing.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/service-day.test.ts src/menu-timetable.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; see them pass;** the venue-service node project; typecheck.
- [ ] **Step 5: Commit** — `feat(venue-service): a kept-open period runs past its scheduled end (A366)`.

---

### Task A10: Keeping a period open — the writer and the read

**Files:**
- Create: `packages/venue-service/src/keep-open.ts`, `keep-open.test.ts`
- Modify: `errors.ts` (`period_extension.invalid`, `period_extension.not_allowed`), `routes.ts`
  (statuses), `index.ts`, `service.ts` and `packages/module/src/module.ts` (two seats)

**Interfaces:**

```ts
export interface KeepOpenSubject {
  id: string;                 // the period's id (Part B: or the zone's)
  name: string;
  endsAt: string;             // as things stand, clock time
  running: boolean;
  extendedUntil: string | null;
  /** Clock times offered for "until", 15-minute steps after max(now, the run's scheduled end) up to
   * the changeover, minus minutes the clock skips. */
  choices: readonly string[];
  /** The first period the longest choice would delay or drop, for the dialog's sentence. */
  next: { name: string; startsAt: string } | null;
}
export async function readKeepOpen(tx: Transaction, cfg: VenueScope, zoneId: string, at: Date): Promise<{ period: KeepOpenSubject | null }>;
export async function keepPeriodOpen(tx: Transaction, cfg: VenueScope, zoneId: string, input: { periodId: string; until: string | null }, at: Date): Promise<void>;
```

The zone is resolved through `resolveZoneContext` (`operations.ts`, S1), which refuses another
venue's zone; the department is the zone's. `until: null` deletes the day's row. Otherwise
decision 5's rules, refusing `period_extension.not_allowed` for any other period, and
`period_extension.invalid` with `field: "until"` and `reason` `step`, `not_later` or `clock_skips`
(the last through one exported check, chosen here: move the body of slice 1's private
`skippedSlot` (`menu-timetable.ts:150-169`, S1) into `service-day.ts` as
`clockTimeSkipped(businessDay: string, time: string, cutover: string, timeZone: string, asEnd: boolean): boolean`,
and make `skippedSlot` call it with `asEnd` true for `endsAt` and false for `startsAt`. The flag is
needed because the two are dated differently at the changeover: `skippedSlot` checks an **end**
equal to the changeover on the next calendar date, but a **start** at the changeover on the business
day itself, through `calendarDateOfTime` (`service-day.ts:97-99`, S1: `time < cutover` is false for
the changeover). An extension's `until` is an end (`asEnd: true`). Not `skippedEndpoint` (`hours-clock.ts:68-82`, M): it takes
station-hours cells and dates a closing by comparing it with the opening, not with the
changeover. `readKeepOpen`'s choices leave out the minutes it reports). The writer upserts on `period_extensions_day_key` and deletes
the department's rows for other business days.

- [ ] Steps: failing tests (keep Lunch open until 14:30 at 13:50 → stored with `starts_at` 14:00;
  again until 15:00 at 14:20 → `starts_at` still 14:00; Afternoon at 13:50 → `not_allowed`; 14:10
  → `step`; 13:45 → `not_later`; a minute the clock skips on a clock-change day → `clock_skips`;
  `null` removes the row; at 15:10 with nothing running, Lunch until 16:00 → accepted;
  `readKeepOpen` choices start at the next step and end at the changeover; `next` names Afternoon
  at 14:00; a whole-venue closure day → `period: null`; in `service-day.test.ts`, with the
  changeover inside the skipped spring hour (cutover 02:30, `Europe/Madrid`, whose clocks skip
  02:00–03:00 on Sunday 2027-03-28 — checked with Python's `zoneinfo`: offset +1:00 at 01:59, +2:00
  at 03:00), `clockTimeSkipped("2027-03-27", "02:30", "02:30", "Europe/Madrid", true)` is true (the
  end falls on the Sunday) and the same call with `false` is false (a start at the changeover falls
  on Saturday 2027-03-27, which has 02:30) — fails today: no such module or
  function); watch them fail
  (`pnpm --filter @waitron/venue-service exec vitest run --project node src/keep-open.test.ts src/service-day.test.ts`);
  implement; the venue-service node project; typecheck `@waitron/module`, `@waitron/venue-service`;
  commit `feat(venue-service): keep a period open later today (A366)`.

---

### Task A11: Server — the keep-open routes, and the till's `service` field

**Files:**
- Create: `apps/server/src/keep-open-api.ts` (`mountKeepOpenApi(app, deps, log, run, pinThrottle)`),
  `apps/server/src/till-api.keep-open.test.ts` (fixtures as slice 1's
  `till-api.service-periods.test.ts`, S1)
- Modify: `apps/server/src/till-api.ts` (mount call; `STATUS` gains the two `period_extension.*`
  codes), `packages/venue-service/src/operations.ts` (`listZoneOffers :867`, `menuState :890`,
  `:897`, S1: `service` gains `keepOpen`), `packages/module/src/module.ts` (`ZoneOffers.service`,
  `ZoneMenuState.service`, `:251`, `:267`, S1), `packages/catalogue/src/menu-document-types.ts`
  (`:382`, S1), `apps/till/src/api/client.ts` (the answer types only), and as fixture growth the
  empty `service` literals the typecheck names (S1: `till-app.ts:2413`, `:4932`, `:4946`,
  `apps/server/src/working-order.ts:447`, and the
  till test helpers), `till-api.profile-zones.test.ts`, `till-api.profile-actions.test.ts`

**Routes (session; `venue_service.manage` or an override for the PUT; both zone-gated by the path
zone through `gateZones`):**

| Route | Body | Answer |
| --- | --- | --- |
| `GET /api/service-zones/:zoneId/keep-open` | — | `{ period: KeepOpenSubject \| null }` |
| `PUT /api/service-zones/:zoneId/period-extension` | `{ periodId, until: "14:30" \| null }`, optional `override` | 204 |

`service.keepOpen` is `{ periodId, periodName, endsAt, running, extendedUntil } | null`, from
`DepartmentService.keepOpen`; with `withDefault: false` (pricing) it is `null` and nothing new is
read.

- [ ] **Step 1: Failing tests** through the real routes with `vi.setSystemTime`: review focus 1 —
  at 13:50 a manager keeps Lunch open until 14:30; at 14:15 a basket with a Lunch item is accepted
  and one with an Afternoon item refused `menu_period.not_running`; raising a stored Lunch line's
  quantity at 14:15 is accepted (refused without the extension, slice 1 decision 2); a staff
  member's PUT → 403 then 204 with a manager's override; a till whose profile is the Deli's → 403
  `service_zone.not_allowed` for a Restaurant zone; `GET /api/menu-state` answers `keepOpen`
  extended until 14:30. (Fails today: no such route; the field is absent.)
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/till-api.keep-open.test.ts`.
- [ ] **Step 3: Implement**; map rows: action map "left ungated by decision" (as Task A6); zone map
  "path zone" with a refusing case each.
- [ ] **Step 4: Run; see them pass;** the server package and the venue-service node project; the
  till's whole suite (for the type growth); typecheck `@waitron/module`, `@waitron/catalogue`,
  `@waitron/venue-service`, `@waitron/server`, `@waitron/till`.
- [ ] **Step 5: Commit** — `feat(server): keep a period open from the till (A366)`.

---

### Task A12a: The till — the station-today widget and its Close dialog

**Files:**
- Create: `apps/till/src/widgets/station-today.ts` (`<till-station-today>`: the status line, the
  button, and the flow), `widgets/station-today-dialog.ts` (`<till-station-today-dialog>`: the
  destination choice), and tests: `station-today.test.ts`, `station-today.a11y.test.ts`,
  `station-today-dialog.test.ts`, `station-today-dialog.a11y.test.ts`,
  `station-today-dialog.save-state.test.ts`, `station-today-dialog.unsaved.test.ts`
- Modify: `apps/till/src/api/client.ts` (`Station :1150-1157` gains `byHand`, `sendsTo` and `why`; methods
  `stationToday`, `setStationToday`, `serviceDayAuthorizers`), `i18n/strings.ts`, `i18n/codes.ts`

**Behaviour (decisions 8, 10, 11, 13):** `<till-station-today>` takes `api`, `station`
(`{ id, name, isDefault, active, open, byHand, sendsTo, why }`) and `deviceMode` (false here; Task
A13 adds the device path). While open, "Close for today" opens the dialog: a `wt-combobox` of
destinations (`GET /api/stations/:id/today`) with the default chosen, the `sent_stay` sentence,
and "Close for today". Confirm sends the PUT. A `station.destination_invalid` refusal with
`reason: "closed"` or `"inactive"` shows its sentence under the combobox **and re-reads the
destinations**, so the station that just closed or was switched off leaves the list and the
choice falls back to the default; the action stays enabled, since a refusal never disables it by
itself (CLAUDE.md §3, forms). `authorization.not_permitted` opens
`<till-supervisor-override-dialog>` (`widgets/supervisor-override-dialog.ts`, M) with
`approverRole: "manager"` and the authorizers, and retries with the override;
`pin.invalid`/`pin.throttled` keep it open, as `#onOverrideConfirm` does
(`till-app.ts:4586-4602`, M). While closed, "Open for today" sends the PUT at once, with the same
override path. The widget emits `station-today-changed` (an app event, plain name). No button for
the default station or a switched-off one.

**Wording (EN / ES):**

| Key | English | Spanish |
| --- | --- | --- |
| `station_today.open` | Open | Abierta |
| `station_today.closed_by_hand` | Closed for today. New dishes go to {station}. | Cerrada por hoy. Los platos nuevos van a {station}. |
| `station_today.opened_by_hand` | Opened for today. | Abierta por hoy. |
| `station_today.out_of_hours` | Closed now (outside its hours). New dishes go to {station}. | Cerrada ahora (fuera de su horario). Los platos nuevos van a {station}. |
| `station_today.out_of_hours_nowhere` | Closed now (outside its hours). | Cerrada ahora (fuera de su horario). |
| `station_today.default` | Always open: this is the default station. | Siempre abierta: es la estación predeterminada. |
| `station_today.close` | Close for today | Cerrar por hoy |
| `station_today.open_action` | Open for today | Abrir por hoy |
| `station_today.dialog_heading` | Close {station} for today | Cerrar {station} por hoy |
| `station_today.destination` | New dishes go to | Los platos nuevos van a |
| `station_today.default_choice` | {station} (default) | {station} (predeterminada) |
| `station_today.sent_stay` | Dishes already sent stay on this screen. Dishes placed here by hand stay here too. | Los platos ya enviados se quedan en esta pantalla. Los platos asignados aquí a mano también se quedan. |
| `station_today.switched_off` | Switched off. | Desactivada. |
| `station_today.picker_closed` | {station} · Closed | {station} · Cerrada |
| code `station.destination_invalid` | That station cannot take the work now. Choose another. | Esa estación no puede recibir el trabajo ahora. Elige otra. |
| code `station.always_open` | The default station is always open. | La estación predeterminada siempre está abierta. |
| code `time_zone.unreadable` | The venue's clock cannot be read, so this cannot be changed now. | No se puede leer la hora del local, así que ahora no se puede cambiar. |

Check `apps/till/src/i18n/codes.ts` for each code first; add only what is missing.

- [ ] Steps: failing tests (the line and button per state, `switched_off` included; the dialog
  opens with the default chosen and its action enabled, `savableAtOpen`; a `destination_invalid`
  refusal shows its sentence and re-reads the destinations; `authorization.not_permitted` opens
  the override dialog and the retry carries `{ personId, pin }`; axe for each state in both
  themes; the save-state and unsaved cases of the global constraints — fails today: no such
  widgets); watch them fail
  (`pnpm --filter @waitron/till exec vitest run src/widgets/station-today.test.ts src/widgets/station-today-dialog.test.ts`);
  implement; the till's whole suite; commit
  `feat(till): a station's today line and its Close dialog (A366)`.

---

### Task A12b: The till — the Station screen shows it

**Files:**
- Modify: `apps/till/src/screens/till-station-screen.ts` (operator mode: the widget for the picked
  station above the queue, `#body :597-603`; the picker marks a closed station, `#pick :624-636`,
  M; on `station-today-changed` the screen reloads), `i18n/strings.ts` (`station_today.picker_closed`
  if A12a did not add it)
- Test: `till-station-screen.test.ts`, `till-station-screen.a11y.test.ts` (both exist at M)

- [ ] Steps: failing tests (operator mode shows the widget for the picked station; switching the
  picked station switches the widget; the picker reads "Bar · Closed"; a close reloads the
  stations — fails today: the screen renders no such widget); watch them fail
  (`pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts`);
  implement; the till's whole suite; LOOK at the Station screen in EN and ES, both themes, 1280
  and 390, open and closed, and at the dialog and the PIN step; commit
  `feat(till): close or open a station for today from the Station screen (A366)`.

---

### Task A13: The kitchen display's station control

**Files:**
- Modify: `apps/till/src/api/client.ts` (`DeviceStation :1438-1445` gains `name` and `today`;
  methods `deviceStationToday`, `deviceSetStationToday`), `widgets/station-today.ts` (device
  mode), `screens/till-station-screen.ts` (`#renderDevice :518-520`, M: the widget above the queue)
- Test: `station-today.test.ts`, `station-today.a11y.test.ts`, `till-station-screen.test.ts`

**Behaviour:** in device mode the widget reads `GET /api/device/stations/:id/today` for the
destinations and the authorizers; closing goes dialog → `<till-supervisor-override-dialog>` →
`PUT /api/device/stations/:id/today` with `authorizer`; opening goes straight to the PIN. The KDS
refreshes every `REFRESH_MS` already (`till-station-screen.ts:216`, M), so the line follows a
change made at a till within one tick.

- [ ] Steps: failing tests (device mode shows the line from `today`; a close sends the authorizer;
  a refused PIN keeps the dialog; a `device.forbidden_station` answer shows its sentence — fails
  today: the device answer has no `today`); watch them fail
  (`pnpm --filter @waitron/till exec vitest run src/widgets/station-today.test.ts src/screens/till-station-screen.test.ts`);
  implement; the till's whole suite; LOOK at a kitchen display (device mode) in EN and ES, both
  themes, 1280 and 390, open and closed, with the PIN step; commit
  `feat(till): the kitchen display closes or opens its station for today (A366)`.

---

### Task A14a: The till — the keep-open widget and dialog

**Files:**
- Create: `apps/till/src/widgets/keep-open.ts` (`<till-keep-open>`: the button and flow; it takes
  `api`, `zoneId` and `service.keepOpen`, and emits `keep-open-changed`),
  `widgets/keep-open-dialog.ts` (`<till-keep-open-dialog>`), and tests (`*.test.ts`,
  `*.a11y.test.ts`, `*.save-state.test.ts`, `*.unsaved.test.ts`)
- Modify: `apps/till/src/api/client.ts` (`keepOpen`, `keepPeriodOpen`), `i18n/strings.ts`,
  `i18n/codes.ts`

**Behaviour (decision 6):** while `keepOpen` is non-null the widget draws a quiet "Keep {period}
open later". The dialog (`GET …/keep-open`) says "{period} ends at {time} today." (or "ended
at"), offers the choices in a `wt-combobox` (the last labelled "End of the day ({time})"), says
what it delays ("{next} will start at {time} instead of {scheduled}." or "{next} will not run
today."), and has "Keep open" (quiet and disabled until a time is chosen) and, when extended, "End
the extension". A `period_extension.*` refusal shows its sentence and re-reads the choices.
Refusals and the override follow Task A12a's flow.

| Key | English | Spanish |
| --- | --- | --- |
| `keep_open.line_until` | {period} · until {time} | {period} · hasta las {time} |
| `keep_open.line_extended` | {period} · kept open until {time} | {period} · horario ampliado hasta las {time} |
| `keep_open.button` | Keep {period} open later | Ampliar el horario de {period} |
| `keep_open.heading` | Keep {period} open later today | Ampliar hoy el horario de {period} |
| `keep_open.ends` / `keep_open.ended` | {period} ends at {time} today. / {period} ended at {time}. | Hoy {period} termina a las {time}. / {period} terminó a las {time}. |
| `keep_open.until` | Until | Hasta |
| `keep_open.end_of_day` | End of the day ({time}) | Fin del día ({time}) |
| `keep_open.delays` / `keep_open.drops` | {next} will start at {time} instead of {scheduled}. / {next} will not run today. | {next} empezará a las {time} en lugar de a las {scheduled}. / Hoy no habrá {next}. |
| `keep_open.save` / `keep_open.stop` | Keep open / End the extension | Ampliar / Quitar la ampliación |
| code `period_extension.invalid` | Choose a later time, in 15-minute steps, before the end of the day. | Elige una hora posterior, en pasos de 15 minutos, antes del final del día. |
| code `period_extension.not_allowed` | Only the period running now, or the last one today, can be kept open. | Solo se puede ampliar el periodo en curso o el último de hoy. |

- [ ] Steps: failing tests (no button when `keepOpen` is null; the dialog's choices and sentence;
  save sends `{ periodId, until }`; "End the extension" sends `until: null`; the override path;
  axe in both themes; save-state and unsaved cases — fails today: no such widget); watch them
  fail (`pnpm --filter @waitron/till exec vitest run src/widgets/keep-open.test.ts src/widgets/keep-open-dialog.test.ts`);
  implement; the till's whole suite; commit `feat(till): the keep-open dialog (A366)`.

---

### Task A14b: The till — the period line and the keep-open control on the order screens

**Files:**
- Modify: `apps/till/src/state/menu-state-poll.ts` (a public `readNow(zoneId)` beside `start`,
  `:40-49` S1), `till-app.ts` (`#onMenuState`'s `serviceMoved`, `:2953-2955` and `:2971-2973` S1,
  also compares `keepOpen`; `keep-open-changed` calls `readNow` for that zone),
  `screens/till-counter-screen.ts` (`service :148`, the line and notice `:286-293`, S1),
  `screens/till-table-order-screen.ts` (`service :1106`, `:2800-2807`, S1; it gains an `api`
  property — believed absent: `grep -n TillApi` on that file finds nothing at M),
  `i18n/strings.ts` (`keep_open.line_until`, `keep_open.line_extended` if A14a did not add them)
- Test: `screens/service-periods.a11y.test.ts` (S1), `till-counter-screen.test.ts`,
  `till-table-order-screen.test.ts`, `till-app-menu-refresh.test.ts`, `state/menu-state-poll.test.ts`

**Behaviour:** the period line reads "{period} · until {time}" or "{period} · kept open until
{time}", with `<till-keep-open>` beside it; the closed-department notice carries it too when a
period ran earlier today.

- [ ] Steps: failing tests (the line's two forms on both screens; the widget beside the line and in
  the closed notice; `readNow` reads one zone at once; a poll that changes only `keepOpen` redraws
  the open order screen; axe in both themes — fails today: the line shows the period name alone);
  watch them fail
  (`pnpm --filter @waitron/till exec vitest run src/screens/service-periods.a11y.test.ts src/till-app-menu-refresh.test.ts src/state/menu-state-poll.test.ts`);
  implement; the till's whole suite; LOOK at the counter and table order screens in EN and ES,
  both themes, 1280 and 390, with a period running, extended, and the department closed after
  Lunch; commit `feat(till): keep a period open later from the till (A366)`.

---

### Task A14c: Documentation and backlog

**Files:** `docs/developers/conventions-ui.md` (`:246-249`, M: a kitchen display
closes or opens its station only with a manager's PIN; nobody signs in), `conventions-data.md`
(a short entry beside the hours sections slice 1 rewrote: period extensions and the station's
destination are per business day, not transferred, and how routing walks a closed station),
`design-system.md` (`:1705-1708`, M: the Prep stations editors no longer include the today
actions), `docs/backlog.md` (delete S11, `:1309-1312` M, since it is done; update the A366 entry
and `docs/backlog/service-periods.md`; add an entry for each point this slice leaves open, at
least decision 14's "who" if the owner keeps the default). Run `pnpm exec prettier --file-info` on
each path (most of `docs/` is ignored) and `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
Commit `docs: live station controls and keeping a period open (A366 slice 3)`.

---

## Part B — the zone extension (second pull request, after slice 2)

Re-ground every task against slice 2 as landed: `zone_closed_times`, `closedZoneIdsAt` and
`assertZoneTakesNewOrders` (slice 2 Task 10), `service.zoneOpen`, the closed-zone notice (Task 13),
`GET /api/zones`' `closed` and the floor (Task 14). Names below are slice 2's planned names.

### Task B1: Migration — zone extensions (add only)

**Files:** `packages/venue-service/src/schema/zone-extensions.ts` (new), `schema/index.ts`,
`classification.ts` and its test, `migrations.test.ts`, `service.test.ts`,
`scripts/schema-constraints.test.ts`, `apps/server/src/testing/clear-provision-fixture.ts`
(before `zone_service_policies`); generated migration.

**Interfaces:** `zoneExtensions` (table `zone_extensions`): `id`, `zoneId` not null →
`zone_service_policies.zone_id` (`zone_extensions_zone_fk`, as slice 2's
`zone_closed_times_zone_fk`), `businessDay`, `startsAt`, `endsAt` (`timeOfDay`); unique
`zone_extensions_day_key` (`zone_id`, `business_day`); check `zone_extensions_step_ck`. `state`;
not transferred.

- [ ] Steps: as Task A1 (failing migration test; generate; read the SQL — only `CREATE TABLE`;
  classification, guards, clear list; the guard and upgrade runs; commit
  `feat(venue-service): zone extensions (A366)`).

---

### Task B2: Keeping a zone open — closed times, the writer and the read

**Files:** `packages/venue-service/src/zone-closed-times.ts` (slice 2's `closedZoneIdsAt`),
`keep-open.ts` and its test, `zone-closed-times.test.ts`, `errors.ts`, `routes.ts`, `service.ts`,
`packages/module/src/module.ts`, `operations.ts` (`service` gains `zoneKeepOpen`),
`packages/catalogue/src/menu-document-types.ts`, `apps/till/src/api/client.ts` (types).

**Interfaces:**

```ts
export async function keepZoneOpen(tx: Transaction, cfg: VenueScope, zoneId: string, input: { until: string | null }, at: Date): Promise<void>;
// readKeepOpen's answer gains: zone: KeepOpenSubject | null
// service gains: zoneKeepOpen: { zoneId; zoneName; closesAt: string; running: boolean; extendedUntil: string | null } | null
```

`closedZoneIdsAt` carves today's extension out of the zone's closed ranges (decision 16) with the
same shape of pure function as `withExtension`, applied to closed ranges. `keepZoneOpen` checks the
department is open at every minute from `max(now, starts_at)` to `until` through Task A9's
`departmentDay` with its extension applied.

- [ ] Steps: failing tests (review focus 7; a zone with no closed time left today → `not_closing`;
  a zone whose department is closed now → `department_closed`; `null` removes the row; the
  pricing path reads no `zone_extensions` row; `closedZoneIdsAt` at 01:00 leaves the Terrace open,
  at 01:30 closed — fails today: no extension is read); watch them fail
  (`pnpm --filter @waitron/venue-service exec vitest run --project node src/keep-open.test.ts src/zone-closed-times.test.ts`);
  implement; the venue-service node project; typecheck; commit
  `feat(venue-service): keep a zone open later today (A366)`.

---

### Task B3: Server — the zone extension route

**Files:** `apps/server/src/keep-open-api.ts`, `till-api.ts` (`STATUS`; `GET /api/zones` gains
`closesAt` beside slice 2's `closed`), `till-api.keep-open.test.ts`, `till-api.profile-zones.test.ts`,
`till-api.profile-actions.test.ts`.

**Route:** `PUT /api/service-zones/:zoneId/zone-extension` — `{ until | null }`, optional
`override`; same authorization, gating and map rows as Task A11.

- [ ] Steps: failing tests through the real routes (seat a Terrace table at 01:00 after keeping
  the Terrace open until 01:30 → 200; at 01:30 → 409 `service_zone.closed`; with the department
  closing at 01:00 the PUT → 409 `zone_extension.not_allowed` `department_closed`; a staff PUT → 403
  then 204 with an override; `/api/zones` answers `closesAt`); watch them fail; implement; the
  server package; typecheck; commit `feat(server): keep a zone open from the till (A366)`.

---

### Task B4: The till — "Keep the Terrace open later"; documentation

**Files:** `apps/till/src/widgets/keep-open.ts`, `keep-open-dialog.ts` (a zone subject),
`screens/till-counter-screen.ts`, `screens/till-table-order-screen.ts` (slice 2's closed-zone
notice and the period line), `screens/till-floor-screen.ts` (the zone bar), `till-app.ts`,
`api/client.ts`, `i18n/*`, their tests; `docs/developers/conventions-data.md`, `docs/backlog.md`.

**Wording:** `keep_open.zone_button` "Keep {zone} open later" / "Ampliar el horario de {zone}";
`keep_open.zone_closes` "{zone} closes at {time} today." / "Hoy {zone} cierra a las {time}.";
`keep_open.zone_closed` "{zone} is closed now." / "{zone} está cerrada ahora."; code
`zone_extension.not_allowed` "This area cannot stay open after {department} closes, or has no
closing time left today." / "Esta zona no puede seguir abierta cuando {department} ha cerrado, o
hoy ya no tiene hora de cierre."; code `zone_extension.invalid` as `period_extension.invalid`.

- [ ] Steps: failing tests (the zone button in the closed-zone notice and beside the period line
  while the zone closes later today; the floor's zone bar; the dialog and override paths; axe in
  both themes; save-state and unsaved cases); watch them fail; implement; the till's whole suite;
  LOOK at the counter, table order and floor screens in EN and ES, both themes, 1280 and 390, with
  the Terrace open, closing later, closed and kept open; docs as Task A14c; commit
  `feat(till): keep a zone open later from the till (A366)` and
  `docs: keeping a zone open (A366 slice 3)`.

---

## After the last task of each part

Run `/finish-branch` with the worktree and this plan. Each part touches risk triggers (migrations,
a cross-package contract, authorization, routing), so each takes the full wave with two run-it
reviews: one on this plan's review focus, one told to set it aside and test what it does not name.
The first line of each pull request: "no venue reset needed". Do not merge; the owner lands it.
