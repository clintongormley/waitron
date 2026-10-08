# Monitors, slice 5 — implementation plan (A366)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation.
>
> **Existing assertions.** The campaign queue's owner decision of 2026-10-05 governs: a check that
> pins behaviour this plan removes (listed under "Behaviour this slice removes") is changed to check
> the new behaviour at least as strictly, and listed in the pull request's "Changed test checks"
> section with `file:line`, before and after. Anything else is a STOP. The guard rows this plan
> deletes under `scripts/` are named in decisions 9 and 15 so that they are not a mid-build stop.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> **Base.** Written 2026-10-08 against `main` `1f95b0c44` plus slice 1's branch
> `feat/service-periods-slice-1` at commit **`79bffeca9b565525402b756d193bfe9015e2d665`**, which had
> not landed. Every `file:line` below was read at `main` `1f95b0c44` unless it says
> `@79bffeca9`. Before building, diff what slice 1 changed after that commit:
> `git diff 79bffeca9 <slice-1 merge sha> -- packages/venue-service/src/configuration-transfer.ts packages/venue-service/src/classification.ts packages/venue-service/src/errors.ts packages/venue-service/src/index.ts packages/venue-service/src/service.ts packages/venue-service/src/migrations.test.ts packages/module/src/module.ts apps/server/src/working-order.ts apps/server/src/till-api.ts apps/till/src/till-app.ts apps/till/src/api/client.ts scripts/schema-constraints.test.ts scripts/migration-upgrade.test.ts`
> — the files this slice shares with slice 1 — and re-read any line cited here that moved.

**Goal:** a kitchen display runs a monitor — a prep station monitor or a pass monitor — and shows
the stations (and, for the pass, the zones) its device chose within what its profile allows.
Watchers go: first as something a screen shows (Part A), then as something a printer follows
(Part B, after slice 4's combined tickets replace them).

**Architecture:** monitors live in venue-service, beside the profile's department and zone access
(`packages/venue-service/src/profile-access.ts`): three tables say which monitors a profile allows
and with which stations and zones, three say which one a device runs. The server stops reading
`devices.station_id` and `devices.watcher_id` and asks venue-service for the device's monitor. A
pass monitor's Done marks move from the watcher to the device (`pass_item_marks`, core). Once
nothing reads them, the device binding triggers go, `devices` is rebuilt without its two binding
columns, and the profile's station and watcher lists are dropped. The till's station screen shows
each of the device's stations; its pass screen shows the device's stations and zones. Part B
removes watchers' printers and configuration.

**Tech stack:** TypeScript, drizzle on SQLite (`node:sqlite`), Hono, Lit, Vitest (node and real
Chromium browser projects).

**Spec:** [Service times, departments, zones and prep stations](../specs/2026-10-07-service-times-departments-and-stations-design.md)
§3 (Monitor), §9.4, §12 (watchers and the Watchers tab), §13 item 5, §15 items 2 and 3; §8 and
§9.3 for what Part B waits on. Backlog: A366.

**Risk path:** FULL ceremony with two run-it reviews: migrations (a `devices` rebuild among them),
a changed cross-package contract (`VenueServiceContribution`, `packages/module/src/module.ts`), and
what a device's profile allows (a new capability and new device routes).

**Venue reset:** needed for Part A and for Part B. Each pull request's first line says
**"venue reset needed"**.

---

## What this slice needs from slices 2 to 4

### 1. Every file this slice changes

**Part A (Tasks A1–A14).**

- `packages/layouts/src/canvas.ts`, `device-profile.ts`, `canvas.test.ts`, `device-profile.test.ts`
- `apps/dashboard/src/screens/canvas-editor/card-contracts.ts`; `apps/till/src/layout.ts`
- `packages/module/src/module.ts`
- `packages/venue-service/src/`: `schema/monitors.ts` (new), `schema/index.ts`, `schema/service.ts`,
  `monitors.ts` (new) and `monitors.test.ts` (new), `profile-access.ts` and its test, `service.ts`,
  `index.ts`, `errors.ts`, `classification.ts` and its test, `configuration-transfer.ts` and its
  test, `migrations.test.ts`, `dashboard/prep-stations-screen.ts` and its tests,
  `dashboard/routing-client.ts`, `dashboard/live-queries.ts` and its test, `dashboard/strings.ts`;
  `drizzle/` (two generated migrations, snapshots, journal)
- `packages/db/src/`: `schema/pass-item-marks.ts` (new), `schema/watcher-item-marks.ts` (deleted),
  `schema/devices.ts`, `schema/index.ts`, `index.ts`, `classification.ts` and its test,
  `trigger-refusals.ts`, `schema/devices.trigger.test.ts`, `schema/devices.test.ts`,
  `schema/devices.fk.test.ts`; `drizzle/` (five migrations: two generated, three `--custom`)
- `apps/server/src/`: `device.ts`, `device-api.ts`, `device-session.ts`, `join-api.ts`,
  `join-requests.ts`, `management-api.ts`, `till-api.ts`, `pass-monitor.ts` (new, replaces
  `watcher-board.ts`), `pass-done-body.ts` (renamed from `watcher-done-body.ts`), `watchers.ts`
  (reference lists only), `working-order.ts` (`:3868-3874`), `station-health.ts`,
  `station-outputs-down.ts`, `errors.ts`, `testing/enrol.ts`, `testing/clear-provision-fixture.ts`,
  and the tests listed in each task
- `apps/server/scripts/dev-setup.ts`, `demo-seed/seed.ts`, `demo-seed/seed-watchers.ts` (deleted)
  and its test, `demo-seed/data-set.ts`, `demo-seed/data-sets/casa-delgado-es.ts`,
  `demo-seed/seed.test.ts`
- `apps/till/src/`: `api/client.ts`, `till-app.ts`, `navigation.ts`,
  `screens/till-station-screen.ts`, `screens/till-expo-screen.ts`, `widgets/card-grid.ts`,
  `widgets/profile-dialog.ts`, `i18n/strings.ts`, `i18n/codes.ts`, and their tests
- `apps/dashboard/src/`: `api/client.ts`, `api/live-queries.ts`,
  `screens/device-profiles-screen.ts`, `screens/devices-screen.ts`, `i18n/strings.ts`,
  `i18n/codes.ts`, and their tests (`*.test.ts`, `*.a11y.test.ts`, `*.unsaved.test.ts`,
  `*.save-state.test.ts`, `device-edit.unsaved.test.ts`, `device-pair.unsaved.test.ts`)
- `scripts/schema-constraints.test.ts`, `scripts/behavioural-triggers.test.ts`,
  `scripts/migration-upgrade.test.ts`
- `docs/developers/conventions-ui.md` (`:258-262`), `docs/backlog.md`

**Part B (Tasks B1–B3).** `apps/server/src/kitchen-print.ts`, `kitchen-ticket.ts`,
`working-order.ts` (`:1972-1983`), `station-move.ts` (`:326-332`), `station-printers.ts`
(`:39-44`), `watchers.ts` (deleted), `management-api.ts` (`:1885-1939`), `print-api.ts`
(`:993-1020`), `errors.ts`, `in-use-references.test.ts`, `configuration-transfer.test.ts`
(`:1736-1741`); `packages/printing/src/printers.ts` (`:116`, `:187-195`);
`packages/db/src/schema/watchers.ts` (deleted), `index.ts`, `classification.ts`,
`configuration-transfer.ts` (`:41-43`, `:61`), `drizzle/` (one generated migration);
`packages/venue-service/src/dashboard/prep-stations-screen.ts` (the Watchers tab),
`watcher-form.ts` and `watchers-seen.ts` (deleted), `routing-client.ts`, `live-queries.ts`
(`:28-32`), `strings.ts`, `operations.ts` (`:320`); `apps/dashboard/src/api/client.ts`,
`api/live-queries.ts` (`:49`, `:299`), `screens/printers-screen.ts` (`:1387`), `i18n/codes.ts`;
`scripts/schema-constraints.test.ts` (`:252-258`,
`:405`); `docs/developers/design-system.md` (`:1565`, `:1577`, `:1644`, `:1693-1697`, `:2917-2925`),
`docs/developers/products.md` (`:201`).

### 2. Does this slice need slice 2, 3 or 4?

| Slice | What it builds (spec) | Needed by this slice? | What was checked |
| --- | --- | --- | --- |
| 2 | Zone closed times, refusing new orders in a closed zone, named days, real weeks, the Calendar (§6 "Closed times", §7, §9.2, §13 item 2) | **Believed independent.** | A pass monitor filters by zone id the way a watcher does today (`watcherSees`, `apps/server/src/watchers.ts:45-53`, through `orderWatchZones`, `apps/server/src/watch-zones.ts:15`); nothing in §6–§7 changes a zone's id or which zone an order's food is in. Nothing this slice reads or writes is a zone's closed time or a named day. |
| 3 | Manager extensions; "Close for today" / "Open for today" for a station on the till and the kitchen display (§5 last bullet, §8 "Close for today asks where the work goes", §10, §13 item 3) | **Believed independent.** | This slice changes the kitchen display's station screen (`apps/till/src/screens/till-station-screen.ts`, device mode) from one station to several; slice 3 adds station controls to that same screen (§10). Neither needs the other's behaviour, but both change the same screen and `apps/server/src/device-api.ts`: whichever lands second puts its part on the other's shape (slice 3's controls go in each station's section of decision 6). |
| 4 | Station hours and fallbacks removed; worked-out times; period choices in routing cells; **combined tickets on shared printers**; the Stations page slimmed with a "Shown on" read-out (§8, §9.3, §13 item 4) | **Part A: believed independent. Part B: needs slice 4.** | Part B removes watcher printers, today the only way a printer gets one ticket covering several stations (spec §2: a station's ticket prints on each of its printers separately; `readWatcherPrinters` and the watcher block of `planKitchenTickets`, `apps/server/src/kitchen-print.ts:115-140`, `:465`, `:605-688`). §8 replaces that with "a shared printer gets one combined ticket per send" and §15 item 2 says a zone-following watcher printer has no replacement; removing watcher printers before slice 4 lands would leave a venue with no pass ticket. Part A changes no printing code: it reads `ticket_items.station_id` and zones; §8 changes which station a dish is routed to and does not mention that column. Part A changes the device read-out on the Prep stations screen (`prep-stations-screen.ts:1991-2007`, today's Tickets tab "Screens" column), which §9.3 turns into the Stations tab's "Shown on". |

**Conclusion.** Part A (monitors) is believed independent of slices 2, 3 and 4 and can be built as
soon as slice 1 lands. Part B (watchers' printers and configuration retired) needs slice 4's
combined tickets on shared printers (§8) and must not start before slice 4 lands; its tasks are
outlined from today's code and must be re-grounded then.

### 3. Files shared with slices 2 to 4 (same files, different areas)

- **Slice 2:** `packages/venue-service/src/classification.ts`, `configuration-transfer.ts`,
  `errors.ts`, `index.ts`, `migrations.test.ts`, `dashboard/strings.ts`, the venue-service
  `drizzle/` journal (a number collision is fixed by regenerating, never by hand — CLAUDE.md §3),
  `scripts/schema-constraints.test.ts`, `scripts/migration-upgrade.test.ts`. Believed not to share
  a function: slice 2's are zone times and named days.
- **Slice 3:** `apps/till/src/screens/till-station-screen.ts` (device mode),
  `apps/server/src/device-api.ts`, `apps/till/src/api/client.ts`, `apps/till/src/i18n/*`,
  `packages/module/src/module.ts`.
- **Slice 4:** `packages/venue-service/src/dashboard/prep-stations-screen.ts` (Part A's read-out;
  Part B's Watchers tab — §9.3 says the Watchers tab goes, so slice 4 may already have removed it),
  `routing-client.ts`, `dashboard/live-queries.ts` (`routing`, `:17-41`),
  `packages/module/src/module.ts`, the venue-service journal and the guard lists above; Part B
  shares `apps/server/src/kitchen-print.ts`, `station-printers.ts` (§8: "the rule against one
  printer both making and watching goes", today `printer.makes_and_watches`,
  `station-printers.ts:39-44` and `watchers.ts:319-324`), `print-api.ts`, `kitchen-ticket.ts`.

---

## Decisions this plan makes that the spec does not

Each has the default this plan builds; the owner may override any.

1. **Two pull requests.** DEFAULT: Part A (Tasks A1–A14) is its own pull request, buildable as
   soon as slice 1 lands; Part B (Tasks B1–B3) is a second pull request after slice 4 lands.
   Between the two, a watcher is a printer setting only: the Watchers tab keeps working for
   printers, and its "Runs the pass" cell stays but no screen reads it (decision 3 moves that job
   to the profile). Override "one pull request": build A1–A14 then B1–B3 on one branch after
   slice 4 lands.
2. **Monitors are a kitchen display's setting.** DEFAULT: only a `kds` profile lists monitors and
   only a `kds` device chooses one. Today the profile editor shows the station and watcher lists
   only for a kitchen display (`#shownFields`, `apps/dashboard/src/screens/device-profiles-screen.ts:699-712`),
   and only a kitchen display binds a station or watcher (`resolveDeviceBinding`,
   `apps/server/src/device.ts:359-383`); the server's list save does not check the form factor
   (`setProfileKitchenLists`, `profile-access.ts:350-368`), and `setProfileMonitors` will. A till
   or handheld keeps its Station screen's station choice; its Pass screen loses the watcher choice
   (`till-expo-screen.ts:508-530`) and always shows every station and zone, with no Done marks.
   What is lost: picking a watcher's narrower view, with its Done marks, at a till. Override: let a
   till or handheld profile carry a pass monitor whose stations and zones narrow its Pass screen.
3. **"Run the pass" is a capability a profile that people sign in on can hold.** DEFAULT: a new
   capability flag `run-the-pass` ("Runs the pass" / "Lleva el pase", the watcher switch's words)
   in the profile's actions list. A till or handheld's Pass screen shows Fire (when fire control is
   `expo`), Ready and Away only when its profile has it; without it the board has no levers. A
   kitchen display cannot hold it: today a shared display may hold only `prepare-orders`
   (`SHARED_DISPLAY_ACTIONS`, `packages/layouts/src/device-profile.ts:19`), a kitchen display's
   pass board never shows levers (`till-expo-screen.ts:870`, `:1034`; recorded as W7 in
   `docs/superpowers/plans/2026-10-01-watchers-slice-3d.md:184-188`), and the lever verbs record
   a person (`operatorId`, `apps/server/src/till-api.ts:950-956`). So a pass monitor shows its
   dishes and Done marks, as a kitchen display's watcher board does today. The server does not
   check `run-the-pass`: the lever routes keep their actions (the map at the top of
   `apps/server/src/till-api.profile-actions.test.ts`). The default till profile gets it
   (`DEFAULT_PROFILE_CAPABILITIES.till`, `device-profile.ts:90`), so a newly provisioned venue's
   counter keeps its levers. Override: let a kitchen display run the pass with nobody signed in —
   new device-cookie lever routes, with the device as the actor.
4. **Done marks belong to the device.** DEFAULT: `pass_item_marks` (device, ticket item, time)
   replaces `watcher_item_marks` (`packages/db/src/schema/watcher-item-marks.ts`); two pass monitors
   keep separate marks (§15 item 3). No person column: under decisions 2 and 3 only a kitchen
   display marks Done, and nobody signs in on one. A dish split onto another bill copies its marks,
   as it does today (`apps/server/src/working-order.ts:3868-3874`).
5. **Every station, every zone.** DEFAULT: each list — a profile's prep stations, pass stations and
   pass zones, and a device's — is either "Every station" / "Every zone" or a non-empty explicit
   list, as a watcher's are (`every_station`, `every_zone`, `packages/db/src/schema/watchers.ts:16-17`).
   A device's list lies within its profile's: an explicit profile list allows an explicit subset;
   "every" on the profile allows "every" or any explicit list. A prep monitor has no zones.
6. **A prep monitor with several stations shows them one after another.** DEFAULT: one section per
   station in station order (`display_order`, then name), each with its name, queue, notices and
   printers-down line; a single station looks as it does today. Override: one merged queue, or a
   switch between the stations.
7. **Narrowing a profile under a device is refused.** DEFAULT: removing a monitor, a station or a
   zone that an active device on the profile shows is refused `device_profile.monitor_in_use`,
   naming the device, as removing a listed station or watcher is today
   (`packages/venue-service/src/profile-access.ts:462-503`). A station or zone switched off since
   it was listed stays stored, is marked on both dashboard screens, may be kept but not newly
   chosen (as `checkLists`, `profile-access.ts:436-460`), and is skipped when a monitor is read.
8. **Station health and dark screens count prep monitors only.** DEFAULT: a station "has a screen"
   when an active device's prep monitor lists it or covers every station. A pass monitor does not
   count, as a watcher display does not today (`apps/server/src/station-health.ts:112-116`,
   `apps/server/src/station-outputs-down.ts:127`).
9. **The device binding triggers go; the rule moves into code.** DEFAULT: drop
   `device_binding_rule_insert` and `_update` (`packages/db/drizzle/0091_devices_recreate_triggers.sql:16-52`):
   their rule is about the two columns this slice removes, and a core trigger naming
   venue-service's monitor tables would make core depend on a module, where every module's
   descriptor requires core (`requires: { core: "*" … }`, `packages/composition/src/modules.ts`).
   `setDeviceMonitor` refuses a kitchen display with no monitor and any other device with one.
   This deletes the `device_binding_rule_*` rows of `scripts/behavioural-triggers.test.ts`
   (`:143-144`, the `describe` blocks at `:1527` and `:1626`) and the cases in
   `packages/db/src/schema/devices.trigger.test.ts`, and the three
   refusal texts in `packages/db/src/trigger-refusals.ts:46-59`. `device_profile_form_factor_locked`
   stays (dropped and re-created around the rebuild, as `0089`–`0091` did).
10. **Error codes** (pre-live, renamed freely — CLAUDE.md §3; every copy moves in the same change).
    DEFAULT, registered in `packages/venue-service/src/errors.ts`:
    `device_monitor.required` (replaces `device.station_required`, `apps/server/src/errors.ts:743`);
    `device_monitor.invalid` `{ field: "stationIds" | "zoneIds"; reason: "empty" | "not_found" }`;
    `monitor.not_allowed` `{ monitor }`; `monitor.zone_not_allowed` `{ zoneId }`;
    `station.not_allowed` kept; `device_profile.monitor_in_use` `{ monitor; deviceId; deviceName }`
    (replaces `device_profile.station_in_use` and `device_profile.watcher_in_use`);
    `device_profile.access_invalid`'s `field` loses `stationIds` and `watcherIds` and gains
    `monitors`, `prepStationIds`, `passStationIds`, `passZoneIds`, its `reason` gains
    `kitchen_display_only`. `watcher.not_allowed` goes. A non-kitchen device given a monitor is
    `management.request_invalid` `{ field: "monitor" }`, as one given a watcher is today
    (`device.ts:380-381`).
11. **Routes.** DEFAULT: `GET /api/device/prep` (the device's stations, each with queue, notices and
    printers down) replaces `GET /api/device/station`; `GET /api/device/pass` and
    `POST /api/device/pass/done` replace `/api/device/watcher` and `/api/device/watcher/done`;
    `GET /management-api/device-profile-monitors` replaces `.../device-profile-kitchen-lists`;
    device-profile POST and PUT take `monitors`, device PATCH and join accept take `monitor`,
    instead of `stationIds`/`watcherIds` and `stationId`/`watcherId`. Removed, answering 404:
    `/api/watchers`, `/api/watchers/:id/queue`, `/api/watchers/:id/done` and the three device
    routes above.
12. **Demo.** DEFAULT: "Pantalla Cocina" runs a prep monitor on the default station; "Pantalla Pase"
    runs a pass monitor on the demo watcher's two stations (kitchen and deli) and every zone
    (`apps/server/scripts/demo-seed/seed-watchers.ts:19-33`, `apps/server/scripts/dev-setup.ts:310-325`).
    The demo no longer seeds a watcher. `enrolDeviceForTest` lists each display's monitor on the
    seeded `kds` profile (decision 13). A newly provisioned venue's kitchen display profile lists
    no monitors, as today it lists no stations: `device_profile_stations` is written only by a
    manager's save (`writeLists`, `profile-access.ts:506-529`) and by the test helper
    (`enrol.ts:12-44`).
13. **Test helper.** DEFAULT: `enrolDeviceForTest` (`apps/server/src/testing/enrol.ts:50`) keeps
    its `stationId` option, meaning a prep monitor on that one station, and its `watcherId` option
    becomes `monitor: DeviceMonitor`; it lists what it is given on the profile, as `listOnProfile`
    does today (`enrol.ts:12-44`). Most suites that enrol a kitchen display keep their setup.
14. **Configuration transfer.** DEFAULT: the three profile monitor tables travel with a
    configuration export, as `device_profile_stations` does today
    (`packages/venue-service/src/configuration-transfer.ts:616`, `:557@79bffeca9`); the three device
    monitor tables do not, as devices do not (`apps/server/src/configuration-transfer.test.ts:1741`).
15. **Guard rows deleted with the tables they describe.** DEFAULT: the `scripts/schema-constraints.test.ts`
    rows for `device_profile_stations`, `device_profile_watchers`, `devices.station_id` and
    `devices.watcher_id` (`:101-104`, `:113-114`), `watcher_item_marks`
    (`:249-251`, `:417`) in Part A, and the watcher tables (`:252-258`, `:405`) in Part B; each new
    table gets its rows in the same task. Slice 1 did the same for its retired tables.

## Where the code differs from what the spec assumes

- §9.4 "Firing, Ready and Away are a profile action" assumes a pass monitor can run the pass. Today
  a kitchen display's pass board shows none of the three (`till-expo-screen.ts:870`, `:1034`), and
  a watcher's `runs_pass` acts only at a till where someone is signed in. Decision 3.
- §9.4 "today a device binds exactly one station or watcher" holds for kitchen displays only; any
  other device binds neither, enforced by the triggers in `0091_devices_recreate_triggers.sql` and
  by `resolveDeviceBinding` (`device.ts:359-383`).
- §15 item 3 "a watcher keeps its own Done marks": also at a till, where a person picks a watcher on
  the Pass screen and marks Done as themselves (`/api/watchers/:id/done`, `till-api.ts:1913-1932`).
  Decision 2 removes that.
- §9.3 "Shown on (the devices whose monitors show it)": today the read-out is the Tickets tab's
  "Screens" column and counts only a kitchen display bound to the station
  (`prep-stations-screen.ts:1991-2007`); the Watchers tab has its own "Screens" column
  (`:2761-2777`).
- §2 "a printer attached to a watcher already prints one combined ticket per send": matches
  `kitchen-print.ts:605-688`. Removing it is Part B.

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`.
- Work in this branch's worktree; never commit to `main`.
- A shipped migration file is never edited. New migrations only; numbers come from
  `pnpm --filter <package> db:generate` (or `db:generate:custom`) at build time, never typed.
- No data-migration code before go-live (CLAUDE.md §3): a migration changes the schema; old rows
  are left to the reset. Part A adds and drops; Part B drops.
- drizzle-kit 0.31.11: a generation that rebuilds a table must not also add a column to it; this
  slice's rebuild of `devices` only drops columns.
- A drizzle rebuild runs with foreign keys ON (CLAUDE.md §3): before shipping the `devices`
  rebuild, list every foreign key that names `devices`
  (`grep -ln 'REFERENCES \`devices\`' packages/*/drizzle/*.sql`, then each one's `ON DELETE`) and
  write the list in the commit message. At 1f95b0c44 three are `ON DELETE cascade`
  (`packages/db/drizzle/0112_device_approved_profiles.sql`, `0114_device_equipment.sql`,
  `packages/payments/drizzle/0006_device_reader_equipment.sql`); on a box with devices those rows
  would be deleted by the rebuild's `DROP TABLE`, which the reset covers.
- Every foreign key and unique index is declared in the TypeScript schema.
- Error codes name the domain concept and are registered in the throwing package's `errors.ts`;
  every file that throws one imports its registry.
- venue-service functions take `cfg: VenueScope`. Multi-table writes take one `tx: Transaction`;
  queries on one transaction are awaited in turn.
- New UI reads `--wt-*` tokens only; a screen does not draw its own `<select>`, `<textarea>` or text
  `<input>`; a `wt-*` component's own events are `wt-*`.
- **Save rule (owner, 2026-10-08, every A366 slice).** Each form this slice rewrites — the device
  profile editor's monitors, the device Pair and Edit dialogs — keeps or takes A331's rule as it
  stands on `main` (`docs/developers/design-system.md` → Forms): a draft scope from
  `draftScopeFor`, the action drawn through `saveActionState`, an early return in the save handler
  while `saveActionState(...).unchanged`, a `*.save-state.test.ts` and a `*.unsaved.test.ts` with
  #1422's reconnect case (take the form off the page, put it back, it still asks before
  discarding). The Pair dialog keeps `{ savableAtOpen: true }` (`devices-screen.ts:1961`). Do it
  test-first inside the task; list it under the pull request's changed checks.
- A code decision 10 retires leaves every registry and every translation list in the change that
  stops throwing it (`grep -rn '"<code>"' apps packages`; among them `apps/dashboard/src/i18n/codes.ts`,
  `apps/till/src/i18n/codes.ts`, `devices-screen.ts:107-122`, `profile-dialog.ts:19`).
- Strings in English and Spanish. Coverage stays at 98/98/98/95 in every package touched.
- Comments only for an invariant or a non-obvious why; no history.
- LOOK at every changed screen in EN and ES, both themes, 1280 and 390 wide.

## Behaviour this slice removes

Tests pinning these may change, under the rule at the top:

- A kitchen display binds exactly one station or one watcher; any other device binds neither
  (`device_binding_rule_*`; `resolveDeviceBinding`; `devices.station_id`, `devices.watcher_id`).
- A profile's flat station and watcher lists (`device_profile_stations`, `device_profile_watchers`;
  `readProfileKitchenLists`, `setProfileKitchenLists`, `assertProfileBinding`) and the
  `stationIds`/`watcherIds` fields of `readProfileServiceAccess`.
- Done marks kept per watcher (`watcher_item_marks`, `markWatcherItems`), and a person marking Done
  for a watcher at a till.
- The till Pass screen's watcher choice and the `till-watcher` address part
  (`apps/till/src/navigation.ts:11`); a pass board's levers depending on the watcher's `runs_pass`.
- The till Pass screen's levers shown to every profile with `show-expo`; they now need
  `run-the-pass`.
- The device routes and codes decisions 10 and 11 replace.
- The Prep stations screen's device read-outs reading `devices.stationId` and
  `devices.watcherId`.
- Part B: watcher printers and their copies, the Watchers tab, the watcher management routes,
  `printer.makes_and_watches` if slice 4 has not removed it.

## Review focus

The conditions most likely to bite a person that no single task's happy path exercises. Each has
its test in the task named.

1. **A pass monitor sees only its stations and zones.** A Terrace-only pass does not show a Bar
   order, and does not show a counter sale, which has no zone (as `watcherSees` today,
   `watchers.ts:45-53`) (Task A7).
2. **Two pass monitors, one dish.** Marking a dish Done on one leaves it on the other; a dish split
   onto another bill keeps the marks (Task A7).
3. **A kitchen display cannot bump another station's dish.** An advance on an item at a station
   outside the device's prep monitor is refused `device.forbidden_station`; an every-station
   monitor may advance any (Task A6).
4. **Narrowing a profile under a device.** Removing the station, zone or monitor a device shows is
   refused naming the device; a station switched off since may be kept but not newly chosen
   (Task A3).
5. **The `devices` rebuild.** After it, `device_profile_form_factor_locked` still refuses a form
   factor change under an active device, and the upgrade walk's only casualties are the ones its
   `RESETS` entry names (Task A9).
6. **Levers.** A till without `run-the-pass` shows no Fire, Ready or Away; a kitchen display
   profile cannot be given it (Tasks A1 and A11).

---

## Part A — monitors (first pull request)

### Task A1: The `run-the-pass` capability

**Files:**
- Modify: `packages/layouts/src/canvas.ts` (`CAPABILITY_FLAGS :37-50`, `PROFILE_SCREENS :67-72`),
  `packages/layouts/src/device-profile.ts` (`sharedDisplayMay :21-24`,
  `DEFAULT_PROFILE_CAPABILITIES.till :90`), `apps/dashboard/src/screens/canvas-editor/card-contracts.ts`
  (its mirror of both lists and `sharedDisplayMay`), `apps/till/src/layout.ts` (`CapabilityFlag :39`),
  `apps/dashboard/src/i18n/strings.ts` (`device_profiles.capability.run-the-pass`, EN and ES)
- Test: `packages/layouts/src/canvas.test.ts`, `device-profile.test.ts`,
  `apps/dashboard/src/screens/canvas-editor/card-contracts.parity.test.ts` (must pass unchanged)

**Interfaces:** `"run-the-pass"` joins `CAPABILITY_FLAGS` and `PROFILE_SCREENS` (it decides what
the till shows; it is not a `PROFILE_ACTIONS` member, so `assertProfileAction` never sees it).
`sharedDisplayMay("run-the-pass")` is false.

- [ ] **Step 1: Failing tests:** `validateCapabilities(["run-the-pass"], "kds")` throws
  `device_profile.invalid` with `reason: "shared_display_action"`; `validateCapabilities(["run-the-pass"], "till")`
  returns it; `DEFAULT_PROFILE_CAPABILITIES.till` contains it and `.kds` does not.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/layouts exec vitest run src/canvas.test.ts src/device-profile.test.ts`.
- [ ] **Step 3: Implement**, then the two mirrors and the label ("Runs the pass" / "Lleva el pase").
- [ ] **Step 4: Run; see them pass;** run the parity test; typecheck layouts, dashboard and till.
- [ ] **Step 5: Commit** — `feat(layouts): a profile can run the pass (A366)`.

---

### Task A2: Migration — monitor tables (add only)

**Files:**
- Create: `packages/venue-service/src/schema/monitors.ts`; generated
  `packages/venue-service/drizzle/00NN_*.sql`, snapshot, journal entry
- Modify: `schema/index.ts`, `classification.ts` and its test, `configuration-transfer.ts`
  (the profile tables, decision 14), `migrations.test.ts` (`TABLES`), `scripts/schema-constraints.test.ts`

**Interfaces — produces** (built from `@waitron/db`'s column vocabulary, as `schema/service.ts:1-24`
imports it):

```ts
export const MONITOR_KINDS = ["prep", "pass"] as const;
const monitorKind = enumType(MONITOR_KINDS);

// device_profile_monitors: a row means the profile allows that monitor.
//   device_profile_id → device_profiles.id ON DELETE cascade; monitor; every_station; every_zone
//   PK (device_profile_id, monitor); CHECK monitor in MONITOR_KINDS;
//   CHECK (monitor = 'pass' OR every_zone = 0)
// device_profile_monitor_stations: device_profile_id, monitor, station_id
//   PK (all three); FK (device_profile_id, monitor) → device_profile_monitors ON DELETE cascade;
//   FK station_id → kitchen_stations.id
// device_profile_monitor_zones: device_profile_id, monitor, zone_id
//   PK (all three); same parent FK; FK zone_id → floor_zones.id; CHECK monitor = 'pass'
// device_monitors: device_id PK → devices.id (no action: a later rebuild of devices then refuses
//   rather than silently emptying it); monitor; every_station; every_zone; the same two CHECKs
// device_monitor_stations: device_id → device_monitors.device_id ON DELETE cascade; station_id
//   → kitchen_stations.id; PK (device_id, station_id)
// device_monitor_zones: device_id → device_monitors.device_id ON DELETE cascade; zone_id
//   → floor_zones.id; PK (device_id, zone_id). Only a pass monitor holds rows: the check is
//   `setDeviceMonitor`'s (Task A3), since a CHECK cannot read the parent row.
```

- [ ] **Step 1: Failing test** in `migrations.test.ts`: the six tables exist; deleting a profile
  deletes its monitor rows; a prep row with `every_zone = 1` and a zone row on a prep monitor are
  refused by the database; deleting a device's `device_monitors` row deletes its station and zone
  rows. Run `pnpm --filter @waitron/venue-service exec vitest run --project node src/migrations.test.ts`.
- [ ] **Step 2: Schema, then generate** — `pnpm --filter @waitron/venue-service db:generate`. Read
  the SQL: only `CREATE TABLE` and indexes.
- [ ] **Step 3:** classify all six `state`; add the three profile tables to
  `VENUE_SERVICE_CONFIGURATION_TRANSFER.tables` beside `device_profile_stations`; add each table's
  keys to `scripts/schema-constraints.test.ts`.
- [ ] **Step 4: Run** Step 1's test and
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/module-graph-honesty.test.ts`.
  Read each run's `Tests` count.
- [ ] **Step 5: Commit** — `feat(venue-service): tables for profile and device monitors (A366)`.

---

### Task A3: Profile monitors and the device's choice (venue-service)

**Files:**
- Create: `packages/venue-service/src/monitors.ts`, `monitors.test.ts`
- Modify: `packages/module/src/module.ts` (adds the members below to `VenueServiceContribution`;
  `readProfileKitchenLists`, `setProfileKitchenLists`, `assertProfileBinding` and
  `readProfileServiceAccess`'s `stationIds`/`watcherIds` stay until A9, so the server keeps
  compiling), `packages/venue-service/src/service.ts`, `index.ts`, `errors.ts` (decision 10's new
  codes)

**Interfaces** (types in `packages/module/src/module.ts`, implementation in `monitors.ts`):

```ts
export type MonitorKind = "prep" | "pass";
/** null = every station / every zone. A prep monitor's zoneIds is always null. */
export interface MonitorScope { readonly stationIds: readonly string[] | null; readonly zoneIds: readonly string[] | null }
export interface DeviceMonitor extends MonitorScope { readonly kind: MonitorKind }
export type ProfileMonitors = Readonly<Partial<Record<MonitorKind, MonitorScope>>>;

readProfileMonitors(tx, cfg): Promise<{ profileId: string; monitors: ProfileMonitors }[]>; // every live profile; switched-off entries included
setProfileMonitors(tx, cfg, profileId: string, monitors: ProfileMonitors): Promise<void>;   // replaces all of the profile's monitors
readDeviceMonitor(tx, cfg, deviceId: string): Promise<DeviceMonitor | null>;                 // switched-off entries skipped
setDeviceMonitor(tx, cfg, input: { deviceId: string; profileId: string; monitor: DeviceMonitor | null; kept?: DeviceMonitor | null }): Promise<void>;
assertDeviceMonitor(tx, cfg, profileId: string, monitor: DeviceMonitor | null, kept?: DeviceMonitor | null): Promise<void>; // setDeviceMonitor's checks without the write
readPrepScreens(tx, cfg): Promise<{ deviceId: string; stationIds: string[] | null }[]>;   // active devices running a prep monitor (decision 8)
```

Rules the tests pin:

- `setProfileMonitors` on a profile that is not `kds` with any monitor →
  `device_profile.access_invalid` `{ field: "monitors", reason: "kitchen_display_only" }`; an
  explicit empty list → `reason: "empty"` on `prepStationIds`, `passStationIds` or `passZoneIds`;
  an unknown station or zone, or one switched off and not already stored → `reason: "not_found"`
  on the same field (as `checkLists`, `profile-access.ts:436-460`).
- Removing a monitor, or a station or zone, that an active device on the profile shows →
  `device_profile.monitor_in_use` naming the first such device by label (decision 7). "Shows"
  includes a device on "every" when the profile drops "every" for a list that no longer covers a
  station or zone the device names.
- `setDeviceMonitor`: a `kds` profile with `monitor: null` → `device_monitor.required`; another form
  factor with a monitor → `management.request_invalid` `{ field: "monitor" }`; a monitor the
  profile does not allow → `monitor.not_allowed`; a station outside the profile's list →
  `station.not_allowed`; a zone outside → `monitor.zone_not_allowed`; a zone on a prep monitor or
  an explicit empty list → `device_monitor.invalid`; "every" where the profile's list is explicit →
  `station.not_allowed` naming the profile's first missing station (or `monitor.zone_not_allowed`).
  A station or zone switched off since stays acceptable only when `kept` names it.
- `readDeviceMonitor` for every station returns `stationIds: null`; for an explicit list it drops
  switched-off stations and zones.

- [ ] **Step 1: Failing tests** in `monitors.test.ts` (with `useVenueDb`, as
  `profile-access.test.ts` sets up), one per rule; each rule the kitchen-list cases of
  `profile-access.test.ts` pin today has its counterpart here, at least as strict, before A9
  deletes them.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/monitors.test.ts`.
- [ ] **Step 3: Implement;** wire the contract in `service.ts`; register the codes.
- [ ] **Step 4: Run; see them pass;** typecheck venue-service, module and server.
- [ ] **Step 5: Commit** — `feat(venue-service): monitors on profiles and devices (A366)`.

---

### Task A4: Migrations — pass marks; the binding triggers go

**Files:**
- Create: `packages/db/src/schema/pass-item-marks.ts`; generated `packages/db/drizzle/00NN_*.sql`
  (the table) and a `--custom` one that drops `device_binding_rule_insert` and
  `device_binding_rule_update`; snapshots, journal
- Modify: `packages/db/src/schema/index.ts`, `src/index.ts`, `classification.ts` and its test,
  `trigger-refusals.ts` (delete `MISSING_PROFILE_REFUSAL`, `KDS_BINDING_REFUSAL`,
  `NON_KDS_BINDING_REFUSAL`, `:46-59`), `schema/devices.trigger.test.ts`, `schema/devices.ts`
  (its doc comment's sentence about the triggers), `scripts/behavioural-triggers.test.ts`
  (decision 9), `scripts/schema-constraints.test.ts`

**Interfaces:** `pass_item_marks`: `device_id` → `devices.id`, `ticket_item_id` → `ticket_items.id`
ON DELETE cascade, `done_at` (`tsString`, not null); PK `(device_id, ticket_item_id)`; index on
`ticket_item_id`. Classified `state`, with a reason like `watcher_item_marks`' (`classification.ts:107-111`).

- [ ] **Step 1: Failing tests:** in `packages/db` a schema test that a mark is deleted with its
  ticket item and that two devices may mark one item; in `devices.trigger.test.ts`, a `kds` device
  with no station and no watcher now inserts, and a till device with a station inserts (the
  triggers are gone; those columns go in A9).
- [ ] **Step 2: Generate** — `pnpm --filter @waitron/db db:generate`, then
  `pnpm --filter @waitron/db db:generate:custom` and write the two `DROP TRIGGER` statements.
- [ ] **Step 3:** classification; schema-constraints rows for the new table; remove the two
  trigger names and their `describe` blocks from `scripts/behavioural-triggers.test.ts`.
- [ ] **Step 4: Run** `pnpm --filter @waitron/db exec vitest run src/schema/devices.trigger.test.ts`
  and the Task A2 guard list plus `scripts/behavioural-triggers.test.ts`.
- [ ] **Step 5: Commit** — `feat(db): per-device pass marks; the device binding triggers go (A366)`.

---

### Task A5: The server binds a monitor, not a station or watcher

**Files:**
- Modify: `apps/server/src/device.ts` (`resolveDeviceBinding :337` → `resolveDeviceMonitor`;
  `updateDeviceSettings :84`, `insertDevice :59`, `switchActiveProfile :288`), `join-requests.ts`
  (`returningDevicesOf :257`, `acceptDeviceJoinRequest :487`), `join-api.ts` (`:330-366`),
  `device-api.ts` (`PATCH /management-api/devices/:id :568`, the list `:470`, `/api/device/me
  :261`, `/api/dev/devices`), `device-session.ts` (`DeviceBinding :91-101` loses `stationId` and
  `watcherId`), `management-api.ts` (profile routes `:1435-1536`, `saveKitchenLists :525`,
  `ProfileBody :558-578`), `errors.ts` (`device.station_required` goes), `testing/enrol.ts`
- Test: `device.test.ts`, `device-api.test.ts`, `join-requests.test.ts`, `join-api.test.ts`,
  `join-api.db.test.ts`, `join-e2e.test.ts`, `management-api.device-profiles.test.ts`,
  `device-session.test.ts`

**Interfaces:**

```ts
// device.ts
export async function resolveDeviceMonitor(
  tx: Transaction, cfg: TillConfig,
  input: { profileId: string; monitor?: DeviceMonitor | null; kept?: DeviceMonitor | null },
): Promise<{ monitor: DeviceMonitor | null; formFactor: FormFactor }>; // assertDeviceMonitor, then hands back what to store
```

Wire bodies (decision 11): profile POST/PUT `monitors?: ProfileMonitors` (absent keeps the stored
monitors, as an absent `stationIds` does today, `management-api.ts:1473`, `:1508`); device PATCH
and join accept `monitor?: DeviceMonitor | null` (absent on PATCH keeps it). `GET
/management-api/devices` rows carry `monitor: DeviceMonitor | null` in place of `stationId`,
`watcherId` and `binding`; `/api/device/me` carries `monitor` in place of `stationId` and
`watcherId`; `/api/dev/devices` drops `stationId`. Accepting a join, editing, and re-enabling a
device write the device row and then `setDeviceMonitor` in the same transaction; a profile switch
calls `assertDeviceMonitor` with the device's current monitor before it switches. Devices are
written with `station_id` and `watcher_id` null from here on; A9 drops the columns.

`enrolDeviceForTest(db, cfg, { …, stationId?, monitor? })` (decision 13).

- [ ] **Step 1: Failing tests:** accepting a join with a prep monitor on two stations stores it
  and `/api/device/me` answers it; a `kds` accept with no monitor → `device_monitor.required`; a
  till accept with a monitor → `management.request_invalid` `monitor`; a profile switch to a
  profile that does not allow the device's monitor → `monitor.not_allowed`; a device keeps a
  station switched off since it was chosen; `GET /management-api/device-profile-monitors` answers
  every live profile; a profile PUT naming `monitors` replaces them and one without leaves them.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/device.test.ts src/join-requests.test.ts src/management-api.device-profiles.test.ts`.
- [ ] **Step 3: Implement.** Then run every suite above and fix fixtures that enrolled a kitchen
  display with `watcherId` (`grep -rln "watcherId" apps/server/src --include='*.test.ts'`).
- [ ] **Step 4: Run; see them pass;** typecheck the server. The display routes
  `/api/device/station` and `/api/device/watcher` still read the columns A5 stops writing, so
  their suites fail until A6 and A7 replace them: build A5–A7 back to back and list those failing
  files in A5's commit message.
- [ ] **Step 5: Commit** — `feat(server): a kitchen display binds a monitor (A366)`.

---

### Task A6: The prep monitor's routes, station health and dark screens

**Files:**
- Modify: `apps/server/src/device-api.ts` (`/api/device/station :398` → `/api/device/prep`;
  acknowledge `:420`; advance `:437`, its station check at `:460`), `station-health.ts`
  (`:112-116`), `station-outputs-down.ts` (`:115-140`)
- Test: `device-api.test.ts`, `station-health.test.ts`, `station-outputs-down.test.ts`,
  `till-api.profile-zones.test.ts` (its description at `:152-153`)

**Interfaces:**

```ts
// GET /api/device/prep → 200
interface DevicePrep {
  stations: { id: string; name: string; queue: StationQueueGroup[]; notices: KitchenNotice[]; printersDown: StationPrinterDown[] }[];
}
```

Built from `readDeviceMonitor`; an every-station monitor lists every switched-on station in
`display_order`, then name; each entry uses today's per-station readers (`listStationQueue`,
`listStationNotices`, `stationPrintersDown`, as `device-api.ts:405-413`). A device whose monitor is
not a prep monitor answers `device.unauthorized`, as a device with no station does today
(`:401-404`). Advance: the item's station must be one the device's prep monitor covers, else
`device.forbidden_station`. Acknowledge: the notice must be at one of the device's stations
(read its station, then call `acknowledgeKitchenNotice` with that `stationId`). Station health's
"has a screen" and the dark-screen query read `readPrepScreens` (decision 8), expanding "every".

- [ ] **Step 1: Failing tests:** a two-station prep monitor's read lists both stations with their
  own queues; advancing an item at a third station → `device.forbidden_station`; an every-station
  monitor advances it; acknowledging a notice at a station outside the monitor → not found; a
  station covered only by an every-station prep monitor counts as having a screen, and one covered
  only by a pass monitor does not; a dark prep display raises the dark-screen alert for each of
  its stations.
- [ ] **Step 2: Run; watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; see them pass.**
- [ ] **Step 5: Commit** — `feat(server): a prep monitor shows and works its stations (A366)`.

---

### Task A7: The pass monitor and its Done marks

**Files:**
- Create: `apps/server/src/pass-monitor.ts` and `pass-monitor.test.ts` (from `watcher-board.ts`
  and `watcher-board.test.ts`, which are deleted), `pass-done-body.ts` (renamed from
  `watcher-done-body.ts`)
- Modify: `device-api.ts` (`/api/device/watcher :363`, `/done :374` → `/api/device/pass`,
  `/api/device/pass/done`), `till-api.ts` (delete `/api/watchers`, `/:id/queue`, `/:id/done`,
  `:1896-1932`, and their imports `:74-76`), `working-order.ts` (`:3868-3874` copies
  `pass_item_marks`), `watchers.ts` (`WATCHER_REFERENCES :165-168` loses `devices` and
  `watcherItemMarks`; `WATCHER_SETTINGS :171-176` loses `deviceProfileWatchers`),
  `till-api.profile-actions.test.ts` (the "watcher done marks" paragraph at `:97-100` describes
  `/api/device/pass/done` instead)
- Test: `pass-monitor.test.ts`, `till-api.watchers.test.ts` (→ `device-api.pass.test.ts`),
  `working-order.test.ts` (the split case), `in-use-references.test.ts`

**Interfaces:**

```ts
export interface PassScope { stationIds: readonly string[] | null; zoneIds: readonly string[] | null }
export function passSees(scope: PassScope, dish: { stationId: string; zoneId: string | null }): boolean; // watcherSees' rule
export type PassOrder = WatcherOrder; // today's shape: courses and groups with allReady (watcher-board.ts:11-16)
export async function listPassMonitor(tx: Transaction, cfg: TillConfig, deviceId: string, scope: PassScope): Promise<{ orders: PassOrder[] }>;
export async function markPassItems(tx: Transaction, cfg: TillConfig, deviceId: string, ticketItemIds: readonly string[], done: boolean, at: Date): Promise<void>;
```

`listPassMonitor` keeps `listWatcherQueue`'s selection (`watcher-board.ts:41-116`) with the marks
read for this device. `markPassItems` keeps `markWatcherItems`' location check (`:131-146`).

- [ ] **Step 1: Failing tests:** Review focus 1 and 2: a Terrace-only pass monitor does not list a
  Bar dish or a counter sale; marking Done on device A leaves the dish on device B; undoing removes
  only A's mark; a dish split onto another bill keeps A's mark; `/api/device/pass` on a prep device
  answers `device.unauthorized`; the removed routes answer 404.
- [ ] **Step 2: Run; watch them fail.**
- [ ] **Step 3: Implement.** Delete `watcher-board.ts`; nothing else should import it
  (`grep -rn "watcher-board" apps/server/src`).
- [ ] **Step 4: Run; see them pass;** the server package typechecks again from here.
- [ ] **Step 5: Commit** — `feat(server): a pass monitor shows its stations and zones, with its own Done marks (A366)`.

---

### Task A8: Demo seed, dev setup and remaining fixtures

**Files:**
- Modify: `apps/server/scripts/dev-setup.ts` (`:255-325`), `demo-seed/seed.ts` (`:18`, `:74`),
  `demo-seed/data-set.ts` (`watcherName :134`), `demo-seed/data-sets/casa-delgado-es.ts` (`:44`),
  `apps/server/src/testing/clear-provision-fixture.ts` (its table list, `:23`)
- Delete: `demo-seed/seed-watchers.ts`, `seed-watchers.test.ts`
- Test: `demo-seed/seed.test.ts`, `apps/server/scripts/dev-setup.test.ts`,
  `apps/server/src/configuration-transfer.test.ts` (a profile's monitors round-trip; decision 14)

- [ ] **Step 1: Failing tests:** decision 12's two displays and their monitors; no watcher seeded;
  an export holds a profile's monitor rows and an import restores them.
- [ ] **Step 2: Run; watch them fail.**
- [ ] **Step 3: Implement.** Then, after checking headroom (`memory_pressure | grep free`), run
  `pnpm --filter @waitron/server test:coverage` in the background and fix fixtures only.
- [ ] **Step 4: Run; see them pass.**
- [ ] **Step 5: Commit** — `test: demo and fixtures run monitors (A366)`.

---

### Task A9: Migrations — retire the old bindings (venue reset)

**Files:**
- Modify: `packages/db/src/schema/devices.ts` (drop `stationId`, `watcherId` and their
  `v8 ignore` pairs), delete `schema/watcher-item-marks.ts` and its exports, `classification.ts`;
  `packages/venue-service/src/schema/service.ts` (drop `deviceProfileStations`,
  `deviceProfileWatchers`, `:219-261`), `classification.ts`, `configuration-transfer.ts`
  (`:616-617`, `:557-558@79bffeca9`), `migrations.test.ts`, `profile-access.ts` (delete the
  kitchen-list half, `readProfileKitchenLists` to `writeLists`, `:311-529`, and the
  `stationIds`/`watcherIds` of `readProfileServiceAccess :51-90`) and the matching cases of its
  test, `service.ts`, `errors.ts` (`station_in_use`, `watcher_in_use`, `watcher.not_allowed`);
  `packages/module/src/module.ts` (the three old members and the two fields);
  `apps/server/src/testing/enrol.ts` (`listOnProfile`'s old half); `scripts/schema-constraints.test.ts`
  (decision 15), `scripts/migration-upgrade.test.ts` (`RESETS`)
- Create: core — a `--custom` migration dropping `device_profile_form_factor_locked`; a generated
  one dropping `watcher_item_marks` and rebuilding `devices`; a `--custom` one re-creating
  `device_profile_form_factor_locked` exactly as `0091_devices_recreate_triggers.sql:5-14` has
  it. venue-service — a generated one dropping the two profile list tables.

The `0089`–`0091` precedent explains the order (`0089_devices_drop_triggers.sql:1-3`): a rebuild
drops the triggers on the table silently, and its rename fails while a trigger on another table
names `devices`.

- [ ] **Step 1: Failing tests:** `packages/db` — `devices` has no `station_id` or `watcher_id`;
  `device_profile_form_factor_locked` still refuses a form factor change under an active device
  (`schema/device-profiles.trigger.test.ts` keeps passing); venue-service `TABLES` without the two
  list tables.
- [ ] **Step 2: Generate** in the order above. Read the rebuild SQL; list the foreign keys that
  name `devices` (Global constraints) in the commit message.
- [ ] **Step 3: Run** `scripts/migration-upgrade.test.ts` and add a `RESETS` entry for each step
  it refuses or that loses rows, naming exactly what it prints, as `core/0090_devices_lose_till`'s
  entry does (`scripts/migration-upgrade.test.ts:381-384`).
- [ ] **Step 4: Run** Step 1's tests, the Task A2 guard list, `scripts/append-only-triggers.test.ts`,
  `scripts/behavioural-triggers.test.ts`, `scripts/apply-migrations-callers.test.ts` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`; typecheck db,
  venue-service and server.
- [ ] **Step 5: Commit** — `feat(db): devices lose their station and watcher columns (A366) — venue reset needed`.

---

### Task A10: The till's prep monitor

**Files:**
- Modify: `apps/till/src/api/client.ts` (`DeviceIdentity :1360-1370` gains `monitor`, loses
  `stationId` and `watcherId`; `DeviceStation :1438` → `DevicePrep`; `getDeviceStation :2558` →
  `getDevicePrep`), `till-app.ts` (boot `:2293-2302`), `screens/till-station-screen.ts` (device
  mode: `#loadDevice :284`, `#adoptDeviceStation :311`, `#renderDevice :518`; advance and
  acknowledge keep their device verbs), `widgets/card-grid.ts` (`kds-board :388`),
  `i18n/strings.ts` (the "no monitor yet" sentence)
- Test: `till-station-screen.test.ts`, `.a11y.test.ts`, `till-app-boot-and-counter.test.ts`,
  `api/client.test.ts`

**Behaviour:** decision 6 — one section per station, each headed by its name, with its own queue,
notices and printers-down line, in the order the server sends; one station renders as today. A
`kds` device whose identity has `monitor: null` shows "This screen has no monitor yet. Ask a
manager to choose one in Devices." / "Esta pantalla aún no tiene monitor. Pide a un responsable que
elija uno en Dispositivos." and no queue.

- [ ] Steps: failing tests (two stations render two sections with their own items; bumping in the
  second section calls `deviceAdvance` for that item; the no-monitor sentence; axe in both themes);
  watch them fail (`pnpm --filter @waitron/till exec vitest run <files>`); implement; pass; look at
  a two-station display at 1280 and 390 in both themes; commit
  `feat(till): a prep monitor shows each of its stations (A366)`.

---

### Task A11: The till's pass screen and pass monitor

**Files:**
- Modify: `apps/till/src/api/client.ts` (`WatcherSummary`, `WatcherBoard` and the three watcher
  methods `:2562-2567`, `:2692-2707` → `PassBoard`, `getDevicePass`, `markDevicePassDone`),
  `screens/till-expo-screen.ts` (`#loadWatchers :508`, `#restoreSelection :517`, `#select`, the
  chooser markup `:717-747`, `#isWatcher :774`, `#runsPass :975`, the lever guards `:870`,
  `:1034`), `navigation.ts` (`"till-watcher" :11`), `till-app.ts` (`:2102`, `:2141`, `:2296`,
  `:2426`, `:8216`, `:8227`, `:8441`, `:8543-8549`; pass `.runsPass=${this.capabilities.includes("run-the-pass")}`
  to every `till-expo-screen`), `widgets/card-grid.ts` (`expo` and `kds-board` cases),
  `widgets/profile-dialog.ts` (`:19`, decision 10's codes), `i18n/strings.ts`, `i18n/codes.ts`
- Test: `till-expo-screen.test.ts`, `.a11y.test.ts`, `till-app.test.ts`,
  `till-app-boot-and-counter.test.ts`, `widgets/card-grid.test.ts`, `widgets/profile-dialog.test.ts`,
  `i18n/codes.test.ts`

**Behaviour:** at a till the Pass screen opens straight on every station (no chooser, no
`till-watcher` in the address); Fire, Ready and Away show only when `runsPass` is true (decision 3).
On a kitchen display with a pass monitor the board is the device's (`getDevicePass`), with Done and
Undo as a watcher display has today and no levers; its title is the device's name.

- [ ] Steps: failing tests (no chooser at a till; levers absent without `runsPass` and present
  with it; a pass monitor's Done calls `markDevicePassDone` and Undo reverses it; the old
  `till-watcher` address part is ignored; axe in both themes); watch them fail; implement; pass;
  look in both themes at 1280 and 390; commit
  `feat(till): the pass screen follows the profile and the device's pass monitor (A366)`.

---

### Task A12: Dashboard — the profile editor's monitors

**Files:**
- Modify: `apps/dashboard/src/screens/device-profiles-screen.ts` (`KITCHEN_LISTS :157-185`,
  `FIELDS :237-256`, `FIELD_TARGET :260-277`, `FIELD_BY_PARAM :281-298`, `#shownFields :699-712`,
  `#registerDraft :541-575`, `#onKitchenToggle :1167`, `#kitchenListsToSend :1186-1197`,
  `#duplicate :1397`, `#kitchenChoices :1733`, `#renderKitchenLists :1756`),
  `apps/dashboard/src/api/client.ts` (`ProfileKitchenLists :745-749`,
  `listProfileKitchenLists :2911` → `ProfileMonitors`, `listProfileMonitors`),
  `apps/dashboard/src/api/live-queries.ts` (`listProfileKitchenLists :273-281` →
  `listProfileMonitors` over `device_profiles`, the three profile monitor tables,
  `kitchen_stations`, `floor_zones`), `i18n/strings.ts`, `i18n/codes.ts` (decision 10)
- Test: `device-profiles-screen.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`, `.save-state.test.ts`;
  `scripts/live-subscriptions.test.ts` must pass

**Behaviour:** for a kitchen display profile, the editor shows "Prep station monitor" and "Pass
monitor" switches; under each one switched on, "Every station" or one switch per station; under
the pass monitor, "Every zone" or one switch per zone. Switched-off entries a list already holds
are shown marked, as `#kitchenChoices` marks them today. A refusal lands under the list its
`field` names. An edit sends `monitors` only when they changed, as `#kitchenListsToSend` sends the
lists today. Duplicate copies the monitors with only their switched-on stations and zones, as it
copies the lists today (`#duplicate`); a monitor whose explicit list would be left empty is not
copied. Save rule: the monitors are part of the editor's draft; Save stays quiet until
they change and quiet again when the change is undone; leaving with a changed monitor list asks;
#1422's reconnect case.

- [ ] Steps: failing tests per behaviour, including the save-state and reconnect cases; watch them
  fail (`pnpm --filter @waitron/dashboard exec vitest run <files>`); implement; pass; look in both
  themes at 1280 and 390; commit `feat(dashboard): a kitchen display profile lists its monitors (A366)`.

---

### Task A13: Dashboard — the device's monitor, and the read-outs

**Files:**
- Modify: `apps/dashboard/src/screens/devices-screen.ts` (the "Shows" binding: `PairField :61`,
  `FIELD_BY_CODE :107-115` and `FIELD_BY_PARAM :117`, `binding`/`bindingIds` `:174-205`,
  `#activeBinding :1055-1068`, `#bindingName :1011`, the edit draft `#registerEditDraft :551-579`,
  `#renderPairDialog :1924`), `apps/dashboard/src/api/client.ts` (`DeviceRow :628`,
  `ReturningDetails :776-782`, `acceptDeviceJoinRequest`'s body `:2852-2858`, `updateDevice`'s
  body `:2975-2981`), `api/live-queries.ts` (`listDevices :282-297`, drop
  `watchers`, add the three device monitor tables), `i18n/strings.ts`, `i18n/codes.ts`;
  `packages/venue-service/src/dashboard/prep-stations-screen.ts` (the Tickets tab's "Screens"
  `:1991-2007`, or slice 4's "Shown on" if it has landed; the Watchers tab's "Screens" column
  `:2761-2777` goes), `routing-client.ts` (`devices :70-77`), `dashboard/live-queries.ts`
  (`routing :17-41`: drop nothing yet, add the three device monitor tables)
- Test: `devices-screen.test.ts`, `.a11y.test.ts`, `.save-state.test.ts`,
  `device-edit.unsaved.test.ts`, `device-pair.unsaved.test.ts`; `prep-stations-screen.test.ts`

**Behaviour:** Pair and Edit, for a kitchen display: "Monitor" (`wt-combobox` of the monitors the
profile allows), then "Every station" or station switches within the profile's list, and for a
pass monitor "Every zone" or zone switches. Changing the profile clears a choice the new profile
does not offer (as the binding is cleared today, `devices-screen.ts:1176-1182`). The device list
reads "Prep: Grill, Fryer" / "Pass: every station · Terrace". The Prep stations read-out lists the
kitchen displays whose prep or pass monitor covers the station (§9.3 "Shown on"). Save rule: the
monitor is part of both drafts; Edit stays quiet until it changes; Pair keeps `savableAtOpen`;
leaving with a changed monitor asks; #1422's reconnect case in both `*.unsaved.test.ts`.

- [ ] Steps: failing tests per behaviour; watch them fail; implement; pass; look in both themes at
  1280 and 390; commit `feat(dashboard): a kitchen display chooses its monitor (A366)`.

---

### Task A14: Documentation and backlog

**Files:** `docs/developers/conventions-ui.md` (`:258-262`, the kitchen display's lists),
`docs/developers/design-system.md` (any line naming the device's "Shows" choice or the profile's
station and watcher lists: `grep -n "watcher list\|Shows" docs/developers/design-system.md`),
`docs/backlog.md` (A366: slice 5 Part A built; Part B waits for slice 4).

- [ ] Read every claim about kitchen displays, watchers on devices and Done marks across
  `docs/developers/` (CLAUDE.md §1: a behaviour change retires every receipt about the old one),
  correct each, and commit `docs: kitchen displays run monitors (A366)`.

Then run `/finish-branch` with this worktree and this plan. Pull request's first line: **"venue
reset needed"**.

---

## Part B — watchers retired (second pull request, after slice 4)

These tasks are outlined from today's code. **Slice 4 changes the same printing files**, so before
writing tests, re-ground each one: `grep -rn "watcher\|Watcher" apps/server/src packages/printing/src packages/venue-service/src apps/dashboard/src --include='*.ts' | grep -v test`
and `grep -rn "makes_and_watches" apps packages --include='*.ts'`. If slice 4's combined tickets
are not on `main`, or a pass ticket today still comes only from a watcher printer, STOP and ask.

### Task B1: Kitchen printing without watchers

**Files (today):** `apps/server/src/kitchen-print.ts` (`WatcherCopies :106`, `readWatcherPrinters
:115-140`, the watcher block of `planKitchenTickets :465` at `:475-494` and `:605-688`, the
`watchers` option of `enqueueKitchenTickets :712`, `enqueueWatcherCopies :733`,
`WatcherSlipRule :1034-1095`, `:1140`, `:1256`, `:1311`, `:1466-1471`),
`kitchen-ticket.ts` (`scope: "watcher" :61-62`, `:199`), `working-order.ts` (`:1972-1983`),
`station-move.ts` (`:326-332`); tests `kitchen-print.watchers.test.ts` (deleted; what it proved is
slice 4's combined tickets' job — confirm slice 4 has a test for a printer shared by several
stations printing one ticket per send before deleting it), `station-move.test.ts`,
`split-off-extras.send.test.ts`.

- [ ] Failing test: a send with a dish at each of two stations that share a printer prints the
  combined ticket slice 4 built, and no second copy. Implement by deleting the watcher paths.
  Commit `feat(server): kitchen tickets no longer print watcher copies (A366)`.

### Task B2: Watcher configuration removed

**Files (today):** `apps/server/src/watchers.ts` (deleted), `management-api.ts` (`:130-138`,
`:305-306`, `:354-375`, `:1885-1939`), `print-api.ts` (`:79`, `:117`, `:993-1020`),
`station-printers.ts` (`:39-44`, unless slice 4 removed it), `kitchen-print.ts` (`:49-50`),
`errors.ts` (`watcher.*`, `printer.makes_and_watches`), `in-use-references.test.ts`;
`packages/printing/src/printers.ts` (`:116`, `:187-195`); `packages/venue-service/src/operations.ts`
(`:320`), `dashboard/prep-stations-screen.ts` (`PREP_TABS :78` and the Watchers tab, unless
slice 4 removed it), `dashboard/watcher-form.ts`, `dashboard/watchers-seen.ts` (deleted),
`dashboard/routing-client.ts` (`:6`, `:68`, `:74`, `:78-96`), `dashboard/live-queries.ts`
(`:29-32`), `dashboard/strings.ts`; `apps/dashboard/src/api/client.ts` (`Watcher :603`,
`listWatchers :2696`, `setPrinterWatcher :3080`), `api/live-queries.ts` (`:49`, `:299`),
`screens/printers-screen.ts` (`:1387`), `i18n/codes.ts`.

- [ ] Failing tests: `/management-api/watchers` and `/management-api/printers/:id/watcher` answer
  404; the Prep stations screen has no Watchers tab and an old `view=watchers` address opens
  Stations (as an unknown view does, `prep-stations-screen.ts:289-295`). Implement; commit
  `feat: watchers are removed from configuration (A366)`.

### Task B3: Migration — drop the watcher tables (venue reset)

**Files (today):** `packages/db/src/schema/watchers.ts` (deleted), `schema/index.ts`, `index.ts`
(`:127`), `classification.ts` (`:103-106`), `configuration-transfer.ts` (`:41-43`, `:61`); one
generated migration dropping `watcher_printers`, `watcher_zones`, `watcher_stations`, `watchers`;
`scripts/schema-constraints.test.ts` (`:252-258`, `:405`); `scripts/migration-upgrade.test.ts`
(`RESETS`); `apps/server/src/configuration-transfer.test.ts` (`:1736-1741`);
`apps/server/scripts/demo-seed/` (anything left naming watchers); `docs/developers/design-system.md`
and `products.md` (the lines listed in section 1); `docs/backlog.md` (slice 5 built).

- [ ] Failing test: the four tables are gone and an export no longer names them. Generate; run the
  Task A2 and A9 guard lists; add `RESETS` entries naming what the walk prints; commit
  `feat(db): watchers are retired (A366) — venue reset needed`. Then `/finish-branch`; the pull
  request's first line: **"venue reset needed"**.
