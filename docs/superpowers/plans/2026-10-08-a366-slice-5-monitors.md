# Kitchen screens and monitors, slice 5 — implementation plan (A366)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation.
>
> **Existing assertions.** The campaign queue's owner decision of 2026-10-05 governs: a check that
> pins behaviour this plan removes (listed under "Behaviour this slice removes") is changed to check
> the new behaviour at least as strictly, and listed in the pull request's "Changed test checks"
> section with `file:line`, before and after. Anything else is a STOP. The guard rows this plan
> deletes under `scripts/` are named in decisions 10 and 16 so that they are not a mid-build stop.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> **Every commit is green.** Each task ends with its package suites passing and every touched
> package typechecking. The order below is chosen for that: new tables and readers first, writers
> that write both the old columns and the new rows next, readers switched after, the old columns
> and tables dropped last.
>
> **Base.** First written 2026-10-08 against `main` `1f95b0c44` plus slice 1's unlanded branch at
> `79bffeca9`. **Revised 2026-10-08 to the owner's answers and re-grounded on `main`
> `063fcb5cd41181abcbb3a5671da9b83566eb8622`, after slice 1 landed as `685a6074b` (#1460).** Every
> `file:line` below holds at `063fcb5cd`: a line in a file unchanged since `1f95b0c44`
> (`git diff --numstat 1f95b0c44 063fcb5cd -- <file>` prints nothing) keeps the first version's
> reading; every cited line in a changed file was mapped with `git diff -U0 1f95b0c44 063fcb5cd`
> and re-read; every line new to this revision was read at `063fcb5cd`. What the re-grounding
> found: of the fifteen files the first version listed as shared with slice 1,
> `git diff 79bffeca9 685a6074b -- <those files>` changes only `apps/server/src/working-order.ts`
> (a quantity-raise marker removed, around `:394-491` and `:4809-4831`, lines this plan does not
> cite) and `apps/till/src/till-app.ts` (an icon and two comments). Other commits on `main` since
> `1f95b0c44` moved cited lines in the dashboard and till API clients, screens and tests,
> `till-app.ts`, `till-api.ts`, `working-order.ts`, venue-service's `errors.ts` and transfer list,
> two guard suites and two developer docs. One citation was off by one at the old base too
> (`#adoptDeviceStation`, now `till-station-screen.ts:312`).

**Goal:** any device can run a kitchen **working screen** — a station screen or a pass screen,
each with its buttons — within the stations and zones its profile allows; a kitchen display runs
exactly one, or a view-only **monitor**. Watchers go: first as something a screen shows (Part A),
then as something a printer follows (Part B, after slice 4's combined tickets replace them).

**Architecture:** the choices live in venue-service, beside the profile's department and zone
access (`packages/venue-service/src/profile-access.ts`): three tables say which kitchen screens a
profile offers and with which stations and zones, three say which ones a device chose. A device
keeps its stored choice when its profile narrows; every read works out what is no longer
available and names it. The server stops reading `devices.station_id` and `devices.watcher_id`.
Done marks move from the watcher to the device, with the signed-in person when there is one
(`pass_item_marks`, core). A kitchen display's pass gets device-cookie lever routes, and its Fire
records the device. Once nothing reads them, the device binding triggers go, `devices` is rebuilt
without its two binding columns, and the profile's station and watcher lists are dropped. Part B
removes watchers' printers and configuration.

**Tech stack:** TypeScript, drizzle on SQLite (`node:sqlite`), Hono, Lit, Vitest (node and real
Chromium browser projects).

**Spec:** [Service times, departments, zones and prep stations](../specs/2026-10-07-service-times-departments-and-stations-design.md)
§3 (Kitchen display, Monitor), §9.4 (revised 2026-10-08 to this plan's owner answers), §12
(watchers and the Watchers tab), §13 item 5, §15 items 2 and 3; §8 and §9.3 for what Part B waits
on. Backlog: A366.

**Risk path:** FULL ceremony with two run-it reviews: migrations (a `devices` rebuild and an
append-only table's rebuild among them), a changed cross-package contract
(`VenueServiceContribution`, `packages/module/src/module.ts`), what a device's profile allows (new
device routes that fire, ready and send away), and a fiscal-adjacent audit table
(`order_group_events`).

**Venue reset: required, not optional.** Part A's `devices` rebuild fails on any box that has ever
had a sign-in, a sale, a payment or a fiscal record (Task A10 says why), so that box would not
start until it is reset. Each pull request's first line reads: **"venue reset needed — required:
the migration refuses on any box with a sign-in or a sale, and the box will not start until it is
reset"** (Part B's first line keeps "venue reset needed" and gives its own reason).

---

## Words this plan uses

Plain meanings first; the code names follow.

- **Kitchen display** — a device with the `kds` form factor: a screen on a kitchen or pass wall.
  Nobody signs in on one today: the server refuses its sign-in (`refuseKitchenSignIn`,
  `apps/server/src/till-api.ts:982-986`). It runs exactly one kitchen screen.
- **Kitchen screen** — the umbrella word for what a profile offers and a device chooses, code name
  `KitchenScreenKind`. Three kinds:
  - **Station screen** (`station`) — a **working screen** with buttons: a prep station's queue,
    where cooks start, ready and finish dishes, as the kitchen display's station screen works
    today (`POST /api/device/ticket-items/:id/advance`, `apps/server/src/device-api.ts:437-467`).
    On a till or handheld it is the Station screen ("Kitchen" in the till, `station.title`).
  - **Pass screen** (`pass`) — a **working screen** with buttons: the pass queue for some stations
    and zones, with Done on each dish and, when the profile has "Run the pass", Fire, Ready and
    Away. On a till or handheld it is the Pass screen ("Pass", `expo.title`; `expo` in code).
  - **Pass monitor** (`pass_monitor`) — a **monitor**: a view-only screen with **no buttons**,
    for example a wall screen showing the pass queue. Kitchen displays only (decision 17).
- **Working screen** — a station screen or a pass screen: it has buttons.
- **Monitor** — a view-only screen. The pass monitor is the only one this slice builds; the spec's
  floor plan and sales monitors (§14) are later work.
- **Run the pass** — a profile setting (`run-the-pass`) that shows Fire, Ready and Away on a pass
  screen (decision 3).
- **No longer available** — a station, zone or kitchen screen a device chose that its profile no
  longer allows, or that has been switched off since (decision 8).

### Renames from the first version of this plan

The owner's FYI (the campaign questions file, "A366-5p") used the first version's words. Every
name below is replaced; nothing in the left column is built.

| First version | This version | Why |
| --- | --- | --- |
| "monitor" for any kitchen screen | "kitchen screen"; "working screen" (station or pass screen) vs "monitor" (view-only) | owner answer 4 |
| prep monitor / `prep` | station screen / `station` | the till already calls it the Station screen |
| pass monitor / `pass` (with Done marks) | pass screen / `pass` (working) | owner answer 4 |
| — | pass monitor / `pass_monitor` (view-only) | owner answers 4 and 10 |
| `MonitorKind`, `MonitorScope`, `DeviceMonitor`, `ProfileMonitors` | `KitchenScreenKind`, `KitchenScreenScope`, `DeviceKitchenScreen`, `ProfileKitchenScreens` | |
| `device_profile_monitors`, `device_profile_monitor_stations`, `device_profile_monitor_zones` | `device_profile_kitchen_screens`, `device_profile_kitchen_screen_stations`, `device_profile_kitchen_screen_zones` | |
| `device_monitors`, `device_monitor_stations`, `device_monitor_zones` | `device_kitchen_screens`, `device_kitchen_screen_stations`, `device_kitchen_screen_zones` | a till may now hold two rows (decision 2) |
| `readProfileMonitors`, `setProfileMonitors`, `addProfileMonitor`, `readDeviceMonitor`, `setDeviceMonitor`, `assertDeviceMonitor`, `readPrepScreens` | `readProfileKitchenScreens`, `setProfileKitchenScreens`, `addProfileKitchenScreen`, `readDeviceKitchenScreens`, `setDeviceKitchenScreens`, `assertDeviceKitchenScreens`, `readStationScreens` | |
| `device_monitor.required`, `.not_allowed`, `.zone_not_allowed`, `.invalid` | `kitchen_screen.required`, `.not_allowed`, `.zone_not_allowed`, `.invalid` | decision 11 |
| `device_profile.monitor_in_use` | none | owner answer 8: narrowing is allowed |
| `GET /api/device/prep` | `GET /api/device/station-screen` | |
| `GET /api/device/pass`, `POST /api/device/pass/done` | `GET /api/device/pass-screen`, `POST /api/device/pass-screen/done` | |
| — | `GET /api/device/pass-monitor`; the six device lever routes | decisions 4 and 12 |
| `GET /management-api/device-profile-monitors` | `GET /management-api/device-profile-kitchen-screens` | |
| `monitors` / `monitor` request fields | `kitchenScreens` | |
| `pass-monitor.ts` (server) | `pass-board.ts` | it serves the pass screen and the pass monitor |
| `enrolDeviceForTest`'s `monitor` option | `kitchenScreen` | |

---

## What this slice needs from slices 2 to 4

### 1. Every file this slice changes

**Part A (Tasks A1–A18).**

- `packages/layouts/src/canvas.ts`, `device-profile.ts`, `canvas.test.ts`, `device-profile.test.ts`
- `apps/dashboard/src/screens/canvas-editor/card-contracts.ts`; `apps/till/src/layout.ts`
- `packages/module/src/module.ts`
- `packages/venue-service/src/`: `schema/kitchen-screens.ts` (new), `schema/index.ts`,
  `schema/service.ts`, `kitchen-screens.ts` (new) and `kitchen-screens.test.ts` (new),
  `profile-access.ts` and its test, `service.ts`, `index.ts`, `errors.ts`, `classification.ts`
  and its test, `configuration-transfer.ts` and its test, `migrations.test.ts`,
  `dashboard/prep-stations-screen.ts` and its tests, `dashboard/watcher-form.ts` and
  `watcher-form.unsaved.test.ts`, `dashboard/routing-client.ts`, `dashboard/live-queries.ts` and
  its test, `dashboard/strings.ts`; `drizzle/` (two generated migrations, snapshots, journal)
- `packages/db/src/`: `schema/pass-item-marks.ts` (new), `schema/watcher-item-marks.ts` (deleted),
  `schema/order-groups.ts`, `schema/devices.ts`, `schema/index.ts`, `index.ts`,
  `classification.ts` and its test, `trigger-refusals.ts`, `schema/devices.trigger.test.ts`,
  `schema/devices.test.ts`, `schema/devices.fk.test.ts`, `schema/order-groups.test.ts`,
  `schema/watchers.test.ts`; `drizzle/` (seven migrations: four generated, three `--custom`)
- `apps/server/src/`: `device.ts`, `device-api.ts`, `device-session.ts`, `join-api.ts`,
  `join-requests.ts`, `management-api.ts`, `till-api.ts`, `order-groups.ts`, `move-bill.ts`,
  `working-order.ts`, `pass-board.ts` (new, replaces `watcher-board.ts`), `pass-done-body.ts`
  (renamed from `watcher-done-body.ts`), `device-levers.ts` (new), `watchers.ts` (reference lists
  only) and `watchers.test.ts`, `station-health.ts`, `station-outputs-down.ts`, `errors.ts`,
  `testing/enrol.ts`, `testing/clear-provision-fixture.ts`, `till-api.profile-actions.test.ts`,
  `till-api.profile-zones.test.ts`, and the tests listed in each task
- `apps/server/scripts/dev-setup.ts`, `demo-seed/seed.ts`, `demo-seed/seed-watchers.ts` (deleted)
  and its test, `demo-seed/data-set.ts`, `demo-seed/data-sets/casa-delgado-es.ts`,
  `demo-seed/seed.test.ts`
- `apps/till/src/`: `api/client.ts`, `till-app.ts`, `navigation.ts`,
  `screens/till-station-screen.ts`, `screens/till-expo-screen.ts`,
  `screens/till-pass-monitor-screen.ts` (new), `widgets/station-queue.ts`, `widgets/card-grid.ts`,
  `widgets/profile-dialog.ts`, `i18n/strings.ts`, `i18n/codes.ts`, and their tests
- `apps/dashboard/src/`: `api/client.ts`, `api/live-queries.ts`,
  `screens/device-profiles-screen.ts`, `screens/devices-screen.ts`, `i18n/strings.ts`,
  `i18n/codes.ts`, and their tests (`*.test.ts`, `*.a11y.test.ts`, `*.unsaved.test.ts`,
  `*.save-state.test.ts`, `device-edit.unsaved.test.ts`, `device-pair.unsaved.test.ts`)
- `scripts/schema-constraints.test.ts`, `scripts/behavioural-triggers.test.ts`,
  `scripts/migration-upgrade.test.ts`
- `docs/developers/conventions-ui.md` (`:258-262`), `docs/developers/design-system.md`,
  `docs/backlog.md`, `docs/backlog/service-periods.md`

**Part B (Tasks B1–B3).** `apps/server/src/kitchen-print.ts`, `kitchen-ticket.ts`,
`working-order.ts` (`:1996-2007`), `station-move.ts` (`:326-332`), `station-printers.ts`
(`:39-44`), `watchers.ts` and `watchers.test.ts` (deleted), `management-api.ts` (`:1885-1939`),
`print-api.ts` (`:993-1020`), `errors.ts`, `in-use-references.test.ts`,
`configuration-transfer.test.ts` (`:1735-1740`); `packages/printing/src/printers.ts` (`:116`,
`:187-195`); `packages/db/src/schema/watchers.ts` and `watchers.test.ts` (deleted), `index.ts`,
`classification.ts`, `configuration-transfer.ts` (`:41-43`, `:61`), `drizzle/` (one generated
migration); `packages/venue-service/src/dashboard/prep-stations-screen.ts` (the Watchers tab),
`watcher-form.ts` and `watchers-seen.ts` (deleted), `routing-client.ts`, `live-queries.ts`
(`:28-32`), `strings.ts`, `operations.ts` (`:320`); `apps/dashboard/src/api/client.ts`,
`api/live-queries.ts` (`:61`, `:309`), `screens/printers-screen.ts` (`:1380`), `i18n/codes.ts`;
`scripts/schema-constraints.test.ts` (`:248-254`, `:399`); `docs/developers/design-system.md`
(`:1595`, `:1608`, `:1680`, `:1730-1734`, `:2997-3005`), `docs/developers/products.md` (`:223`).

### 2. Does this slice need slice 2, 3 or 4?

| Slice | What it builds (spec) | Needed by this slice? | What was checked |
| --- | --- | --- | --- |
| 2 | Zone closed times, refusing new orders in a closed zone, named days, real weeks, the Calendar (§6 "Closed times", §7, §9.2, §13 item 2) | **Believed independent.** No branch exists (`git branch -a` lists no slice 2 branch, 2026-10-08). | A pass screen or monitor filters by zone id the way a watcher does today (`watcherSees`, `apps/server/src/watchers.ts:45-53`, through `orderWatchZones`, `apps/server/src/watch-zones.ts:15`); nothing in §6–§7 changes a zone's id or which zone an order's food is in. Nothing this slice reads or writes is a zone's closed time or a named day. |
| 3 | Manager extensions; "Close for today" / "Open for today" for a station on the till and the kitchen display (§5 last bullet, §8 "Close for today asks where the work goes", §10, §13 item 3) | **Believed independent.** Lane E is building its Part A on `feat/service-periods-slice-3-station-controls` (read at `2c5e3ede3`, six commits; it moves). | This slice changes the kitchen display's station screen (`apps/till/src/screens/till-station-screen.ts`, device mode) from one station to several, in two views (decision 7); slice 3's plan (Tasks A7, A12b, A13) adds station controls to that screen and a `today` field to `GET /api/device/station` (`device-api.ts:398-416`). Neither needs the other's behaviour; whichever lands second puts its part on the other's shape: slice 3's control goes in each station's section of the stacked view, and in the merged view as one line per station above the queue. At its tip the branch has not yet touched `till-station-screen.ts`, `device-api.ts` or the till client; it has changed the shared files in section 3. |
| 4 | Station hours and fallbacks removed; worked-out times; period choices in routing cells; **combined tickets on shared printers**; the Stations page slimmed with a "Shown on" read-out (§8, §9.3, §13 item 4) | **Part A: believed independent. Part B: needs slice 4.** No branch exists. | Part B removes watcher printers, today the only way a printer gets one ticket covering several stations (spec §2: a station's ticket prints on each of its printers separately; `readWatcherPrinters` and the watcher block of `planKitchenTickets`, `apps/server/src/kitchen-print.ts:115-140`, `:465`, `:605-688`). §8 replaces that with "a shared printer gets one combined ticket per send" and §15 item 2 says a zone-following watcher printer has no replacement; removing watcher printers before slice 4 lands would leave a venue with no pass ticket. Part A changes no printing code: it reads `ticket_items.station_id` and zones; §8 changes which station a dish is routed to and does not mention that column. Part A changes the device read-out on the Prep stations screen (`prep-stations-screen.ts:1995-2011`, today's Tickets tab "Screens" column), which §9.3 turns into the Stations tab's "Shown on". |

**Conclusion.** Part A is believed independent of slices 2, 3 and 4 and can be built now: slice 1
has landed. Part B (watchers' printers and configuration retired) needs slice 4's combined tickets
on shared printers (§8) and must not start before slice 4 lands; its tasks are outlined from
today's code and must be re-grounded then. Building Part A ahead of slices 2–4 is itself a
departure from the spec's order (decision 1).

### 3. Files shared with slices 2 to 4 (same files, different areas)

- **Slice 2** (no branch): `packages/venue-service/src/classification.ts`,
  `configuration-transfer.ts`, `errors.ts`, `index.ts`, `migrations.test.ts`,
  `dashboard/strings.ts`, the venue-service `drizzle/` journal (a number collision is fixed by
  regenerating, never by hand — CLAUDE.md §3), `scripts/schema-constraints.test.ts`,
  `scripts/migration-upgrade.test.ts`. Believed not to share a function: slice 2's are zone times
  and named days.
- **Slice 3** — what its branch has already changed at `2c5e3ede3`
  (`git diff main...feat/service-periods-slice-3-station-controls --stat`):
  `packages/module/src/module.ts` (a `StationTodayState` type and three new
  `VenueServiceContribution` members; this slice adds its own members beside them),
  venue-service `classification.ts`, `errors.ts`, `index.ts`, `service.ts`, `schema/index.ts`,
  `migrations.test.ts` and its journal (its migrations are `0034` and `0035`; this slice's
  numbers come from regeneration after it), `apps/server/src/testing/clear-provision-fixture.ts`
  (one table added), `scripts/schema-constraints.test.ts`. What its plan will change next:
  `apps/till/src/screens/till-station-screen.ts` (device mode, `#renderDevice`),
  `apps/server/src/device-api.ts` (`GET /api/device/station`, which this slice replaces with
  `GET /api/device/station-screen`), `apps/till/src/api/client.ts` (`DeviceStation`, which this
  slice replaces with `DeviceStationScreen`), `apps/till/src/i18n/*`, and
  `apps/server/src/till-api.profile-actions.test.ts` (both slices add rows to its map). Its
  decisions 2 and 3 rely on a kitchen display having nobody signed in and acting only through
  `prepare-orders`: after this slice a kitchen display profile may also hold `take-orders` and
  `hand-over-orders` (decision 23), which slice 3's kitchen display route does not check, and
  nobody can yet sign in on one (decision 18), so neither of its decisions changes.
- **Slice 4** (no branch): `packages/venue-service/src/dashboard/prep-stations-screen.ts` (Part
  A's read-out and the tab row; Part B's Watchers tab — §9.3 says the Watchers tab goes, so slice
  4 may already have removed it), `routing-client.ts`, `dashboard/live-queries.ts` (`routing`,
  `:17-41`), `packages/module/src/module.ts`, the venue-service journal and the guard lists above;
  Part B shares `apps/server/src/kitchen-print.ts`, `station-printers.ts` (§8: "the rule against
  one printer both making and watching goes", today `printer.makes_and_watches`,
  `station-printers.ts:39-44` and `watchers.ts:319-324`), `print-api.ts`, `kitchen-ticket.ts`.

---

## Decisions

Each says its final state and where it came from: an owner answer of 2026-10-08 to this plan's
first version (numbered as that version numbered its decisions), this plan's default the owner
accepted, or **NEW** — a default this revision had to choose, which the owner may override. Every
NEW one is also listed under "New decisions this revision made" at the end.

1. **Two pull requests (owner 2026-10-08 answer 1).** Departs from §13 ("each slice is its own plan
   and pull request, in this order"). Part A (Tasks A1–A18) is its own pull request, buildable now
   that slice 1 has landed; Part B (Tasks B1–B3) is a second pull request after slice 4 lands.
   Why: until slice 4's combined tickets exist, a watcher printer is the only way one printer gets
   one ticket for several stations (`kitchen-print.ts:115`, `:465`, `:605`), so watcher printers
   cannot go before slice 4. Between the two pull requests a watcher is a printer setting only: the
   Watchers tab keeps editing the venue's existing watchers for their printers, its "Runs the
   pass" cell stays but nothing reads it (decision 3 moves that job to the profile), and no new
   watcher can be made (decision 22).
2. **Any device can run a working screen (owner 2026-10-08 answer 2).** A profile of any form
   factor may offer a station screen and a pass screen, each with its stations (and, for the pass,
   zones); only a kitchen display profile may offer a pass monitor (decision 17).
   - **A kitchen display runs exactly one kitchen screen** — station screen, pass screen or pass
     monitor — and must have one (`kitchen_screen.required`). Its profile's rows are the screens it
     may choose; a kind with no row is not offered.
   - **A till or handheld may choose a station screen, a pass screen, both or neither; the choice
     narrows its Station and Pass screens.** Its profile's rows bound what its devices may choose;
     a kind with no row bounds nothing (every station, every zone). **NEW (decision 20):** with no
     choice, a till's Station screen lists every station and its Pass screen is today's "All
     stations" board (`/api/expo/queue`: no Done, fully-away courses hidden,
     `till-expo-screen.ts:46`); with a pass screen choice its Pass screen is that board with Done
     marks, as choosing a watcher gives today (`till-expo-screen.ts:609-648`); the Station screen
     keeps its picker, listing only the chosen stations.
   - **On a till the signed-in person acts**: its levers stay on today's session routes, which
     record the person (`operatorId`, `apps/server/src/till-api.ts:950-956`); its Done goes through
     the device route, which on any device other than a kitchen display requires a session and
     records its person (decision 5).
3. **"Run the pass" is a screen setting (owner 2026-10-08 answer 3, as first planned).** Departs
   from §9.4's first text ("Firing, Ready and Away are a profile action"). `run-the-pass` ("Runs
   the pass" / "Lleva el pase", the watcher switch's words) joins `PROFILE_SCREENS`, not
   `PROFILE_ACTIONS`, and any form factor may hold it. It decides only whether a pass screen draws
   Fire (when fire control is `expo`), Ready and Away. The server keeps checking the action each
   lever takes on every lever route, the kitchen display's new ones included: fire against
   `take-orders`, ready against `prepare-orders`, away against `hand-over-orders`
   (`apps/server/src/till-api.profile-actions.test.ts:61-63` for courses, `:77-79` for groups).
   Why not a server-checked action: the same session routes serve other screens — the order
   screen fires a group (`apps/till/src/till-app.ts:5805`), the station screen fires a course and a
   group (`till-station-screen.ts:433`, `:447`), and the station queue offers a group's Fire
   (`widgets/station-queue.ts:656`). The default till profile gets the flag
   (`DEFAULT_PROFILE_CAPABILITIES.till`, `packages/layouts/src/device-profile.ts:90-102`); the
   default kitchen display profile does not (`:111`).
4. **A kitchen display's working screen has buttons; a monitor has none (owner 2026-10-08 answer
   4).** Overrides the first version's "a kitchen display never runs the pass".
   - **Station screen:** start, ready and done, and kitchen notices, as today.
   - **Pass screen:** Done on each dish always; Fire (when fire control is `expo`), Ready and Away
     when its profile has "Run the pass" (decision 3).
   - **Pass monitor:** the pass queue, no buttons, no Done, no reprint.
   - **With nobody signed in, the device is the actor**: the request carries only the device's
     cookie and is checked against the device's profile's actions, as
     `POST /api/device/ticket-items/:id/advance` is today (`device-api.ts:437-467`), which records
     no actor at all (`advanceTicketItem`, `apps/server/src/working-order.ts:6041-6066`). Ready and
     Away store no actor either (`bumpCourseReady`, `markCourseAway`, `working-order.ts:2215-2258`;
     for a group, `passStep`, `apps/server/src/order-groups.ts:326-347`, whose replay record keeps
     only a fingerprint of the request, `runServiceCommand`, `apps/server/src/parties.ts:715-760`).
     Fire does store one, so a kitchen display's Fire records the device (decision 19).
5. **Done marks per device, plus the person when someone is signed in (owner 2026-10-08 answer
   5).** `pass_item_marks` (device, ticket item, time, person or none) replaces
   `watcher_item_marks` (`packages/db/src/schema/watcher-item-marks.ts`); two devices keep separate
   marks (§15 item 3, revised). On a kitchen display the person is none: nobody can sign in on one
   (decision 18). On any other device the Done route requires a session and records its person.
   The route reads the signed-in person with `signedInPersonOn` (`apps/server/src/till-session.ts:64-82`),
   so a kitchen display's marks will record the person once one can sign in. A dish split onto
   another bill copies its marks, as it does today (`apps/server/src/working-order.ts:3892-3898`).
   It goes in the core set, not venue-service's (CLAUDE.md §3 asks for the reason in the commit):
   it replaces a core table, its two keys are core tables (`ticket_items`, `devices`), and its
   only writers are core-table code in `apps/server` (the pass screen's Done, and the split copy
   in `working-order.ts`).
6. **Every station, every zone (owner 2026-10-08 answer 6, as first planned).** Each list — a
   profile's and a device's — is either "Every station" / "Every zone" or a non-empty explicit
   list, as a watcher's are (`every_station`, `every_zone`, `packages/db/src/schema/watchers.ts:16-17`).
   A device's list lies within its profile's. A station screen has no zones. **NEW:** a device's
   "every" means every station (zone) its profile allows, so it follows the profile when the
   profile narrows and is never "no longer available" itself; a device may choose "every" under
   an explicit profile list.
7. **A kitchen display's station screen with several stations offers two views and a switch (owner
   2026-10-08 answer 7).** **Stacked:** one section per station in station order (`display_order`,
   then name), each with its name, queue, notices and printers-down line. **Merged:** one queue of
   every station's dishes, each dish labelled with its station's name, oldest first; the stations'
   notices and printers-down lines above it, each naming its station. Defaults (proposed by the
   campaign's watching session while the owner answered; the owner may override them): it opens stacked; the device remembers the
   last view chosen, in the browser's local storage keyed by the device id, as the lock screen
   remembers the last person (`apps/till/src/screens/till-lock-screen.ts:216-221`, `:304`); a
   screen with one station looks as it does today and shows no switch. A till's Station screen
   keeps its one-station picker (decision 20).
8. **Narrowing a profile is allowed and narrows its devices (owner 2026-10-08 answer 8, as the
   owner corrected it).** No refusal: `device_profile.station_in_use` and
   `device_profile.watcher_in_use` go, and no new refusal replaces them.
   - **Data — NEW (decision 21):** the device keeps its stored choice. Every read of a device's
     kitchen screens works out what is no longer available — a stored station or zone its profile
     no longer allows or that has been switched off since, and a stored kind its profile no longer
     offers — and returns each by name beside what the device still shows. Why this design: it
     needs no extra column or table and nothing kept in step between the profile and its devices;
     the name comes from the stored id, and no code deletes a station or zone row outside a
     configuration import, which empties a fresh venue's configuration
     (`apps/server/src/configuration-transfer.ts:654-665`; checked with
     `grep -rn "delete(kitchenStations)\|delete(floorZones)\|delete from kitchen_stations\|delete from floor_zones" apps packages --include='*.ts'`,
     which finds no deleter outside tests). The stored entry stays until someone edits the device:
     an edit sends only what is still available (the dashboard does not send the rest), and the
     write replaces the stored choice.
   - **On the device:** where the removed one was, the screen says "This station is no longer
     available: Deli" ("Esta estación ya no está disponible: Deli"), and likewise "This zone is no
     longer available: Terrace" and "This screen is no longer available: Pass screen". A device
     left with nothing shows only those lines, until someone picks again. Nothing falls back to the
     profile's list.
   - **On the dashboard:** the profile save still succeeds and its answer names the devices it
     changed (`narrowedDevices`: each device, the screens, stations and zones it no longer shows),
     which the editor shows after saving, for example "Saved. Pantalla Pase no longer shows Deli."
     A device on "every" whose profile list shrank is named too, with what it lost.
   - **NEW:** a profile switch (`POST /api/device/active-profile`, a signed-in person on a till) is
     never refused for the device's kitchen screens either; what the new profile does not allow
     shows as no longer available.
9. **Station health and dark screens count kitchen displays' station screens only; a station with
   no screen, or a venue with none, is normal (owner 2026-10-08 answer 9).** A station "has a
   screen" when an active kitchen display runs a station screen that covers it ("every" covers
   all). Pass screens and monitors do not count, as a watcher display does not today
   (`apps/server/src/station-health.ts:112-116`, `apps/server/src/station-outputs-down.ts:127`).
   **NEW (decision 20):** a till's or handheld's station choice never counts either. Read today
   (not run): `hasScreen` (`station-health.ts:139-158`) changes only how a station's dishes are
   counted (with no screen every dish counts as waiting, and the preparing and ready cells show a
   neutral "No screen", `packages/venue-service/src/dashboard/station-health-table.ts:90-91`), and
   the dark-screen query starts from the devices bound to each station (`stationScreensDark`,
   `station-outputs-down.ts:114-140`, an inner join on `devices.station_id`), so a station with no
   device raises nothing. This slice keeps both behaviours, Task A7 adds the tests that prove
   them, and the pull request says so.
10. **The device binding triggers go; the rule moves into code (owner 2026-10-08 answer 12, as
    first planned).** Drop `device_binding_rule_insert` and `_update`
    (`packages/db/drizzle/0091_devices_recreate_triggers.sql:16-52`): their rule is about the two
    columns this slice removes, and a core trigger naming venue-service's tables would make core
    depend on a module, where every module's descriptor requires core (`requires: { core: "*" … }`,
    `packages/composition/src/modules.ts`). `setDeviceKitchenScreens` refuses a kitchen display
    with none or more than one, and a pass monitor on any other device. This deletes the
    `device_binding_rule_*` rows of `scripts/behavioural-triggers.test.ts` (`:143-144`, the
    `describe` blocks at `:1527` and `:1626`), the cases in
    `packages/db/src/schema/devices.trigger.test.ts`, and the three refusal texts in
    `packages/db/src/trigger-refusals.ts:46-59`. `device_profile_form_factor_locked` stays (dropped
    and re-created around the rebuild, as `0089`–`0091` did).
11. **Error codes, one prefix (owner 2026-10-08 answer 12, renamed).** Pre-live, renamed freely
    (CLAUDE.md §3); every copy moves in the same change. No `kitchen_screen.*` code exists today
    (a grep of every `packages/*/src/errors.ts` and `apps/*/src/errors.ts` for codes beginning
    `kitchen`, `screen` or `monitor` found only `kitchen_notice.*`), and the prefix names the
    concept, as `kitchen_notice.*` and `device_profile.*` do. Registered
    in `packages/venue-service/src/errors.ts` beside the `device_profile.*` codes (`:85-108`):
    - `kitchen_screen.required` — a kitchen display with no kitchen screen (replaces
      `device.station_required`, `apps/server/src/errors.ts:743`);
    - `kitchen_screen.not_allowed` `{ screen }` — a kind the device's profile does not offer;
    - `kitchen_screen.zone_not_allowed` `{ zoneId }` — a zone outside the profile's list;
    - `kitchen_screen.invalid` `{ field: "screens" | "stationIds" | "zoneIds"; reason: "empty" |
      "not_found" | "not_for_screen" | "one_only" }` — an explicit empty list, an unknown or
      switched-off station or zone, a zone on a station screen, a kind named twice, or a kitchen
      display given two.
    `station.not_allowed` `{ stationId }` is kept as it is: a station outside the profile's list is
    the refusal it names today. A profile's save is refused under the existing
    `device_profile.access_invalid`, whose `field` loses `stationIds` and `watcherIds` and gains
    `kitchenScreens`, `stationScreenStations`, `passScreenStations`, `passScreenZones`,
    `passMonitorStations` and `passMonitorZones`, and whose `reason` gains `not_shared_display` —
    the counterpart of its existing `shared_display`: a field only a kitchen display may have
    (here, a pass monitor on a profile that is not one). Retired: `device.station_required`,
    `watcher.not_allowed`, `device_profile.station_in_use`, `device_profile.watcher_in_use`.
12. **Routes (owner 2026-10-08 answer 12, renamed).** Device-cookie routes; on any device other
    than a kitchen display each one requires a signed-in session as well (`session.required`):
    - `GET /api/device/station-screen` (the device's stations, each with queue, notices and
      printers down, and what is no longer available) replaces `GET /api/device/station`;
    - `GET /api/device/pass-screen` and `POST /api/device/pass-screen/done` replace
      `/api/device/watcher` and `/api/device/watcher/done`;
    - `GET /api/device/pass-monitor` is new;
    - the kitchen display's levers are new: `POST /api/device/orders/:id/courses/:courseId/fire`,
      `/ready`, `/away`, and `POST /api/device/parties/:id/groups/:gid/fire`, `/ready`, `/away`
      (decisions 19, 23 and 24);
    - `GET /management-api/device-profile-kitchen-screens` replaces
      `.../device-profile-kitchen-lists`; device-profile POST and PUT take `kitchenScreens`, and
      PUT answers `narrowedDevices` (decision 8); device PATCH and join accept take
      `kitchenScreens` instead of `stationId`/`watcherId`; `/api/device/me` and the device list
      gain `kitchenScreens`.
    Removed, answering 404: `/api/watchers`, `/api/watchers/:id/queue`, `/api/watchers/:id/done`
    and the four old routes above.
13. **Demo (owner 2026-10-08 answer 10).** Three kitchen displays: "Pantalla Cocina" runs a station
    screen on the default station; "Pantalla Pase" runs a pass screen on the demo watcher's two
    stations (kitchen and deli) and every zone (`apps/server/scripts/demo-seed/seed-watchers.ts:19-33`,
    `apps/server/scripts/dev-setup.ts:310-325`); **NEW:** "Monitor Pase" runs a pass monitor on
    every station and every zone. The demo no longer seeds a watcher. **NEW (decision 23):** the
    demo gives its kitchen display profile `run-the-pass`, `take-orders` and `hand-over-orders` so
    Pantalla Pase shows its levers; a newly provisioned venue's kitchen display profile keeps
    `act-as-kds` and `prepare-orders` (`device-profile.ts:111`) and lists no kitchen screens, as
    today it lists no stations: `device_profile_stations` is written only by a manager's save
    (`writeLists`, `profile-access.ts:506-529`) and by the test helper (`enrol.ts:12-44`).
14. **Test helper (owner 2026-10-08 answer 12, renamed).** `enrolDeviceForTest`
    (`apps/server/src/testing/enrol.ts:50`) keeps its `stationId` option, meaning a station screen
    on that one station, and gains `kitchenScreen`; its `watcherId` option goes in Task A8. It
    **adds** what it is given to the profile's row of that kind and never removes anything, as
    `listOnProfile` adds to today's lists with `onConflictDoNothing` (`enrol.ts:12-44`): it creates
    the profile's row with an explicit list when the profile has none, adds a station or zone the
    list lacks, and leaves an "every" list alone. Most suites that enrol a kitchen display keep
    their setup.
15. **Configuration transfer (owner 2026-10-08 answer 11).** The three profile kitchen screen
    tables travel with a configuration export, as `device_profile_stations` does today
    (`packages/venue-service/src/configuration-transfer.ts:557`); the three device tables do not,
    as devices do not (`apps/server/src/configuration-transfer.test.ts:1740`).
16. **Guard rows deleted with the tables they describe (owner 2026-10-08 answer 12).** The
    `scripts/schema-constraints.test.ts` rows for `device_profile_stations`,
    `device_profile_watchers`, `devices.station_id` and `devices.watcher_id` (`:97-100`,
    `:109-110`) and `watcher_item_marks` (`:245-247`, `:411`) go in Part A, the watcher tables'
    (`:248-254`, `:399`) in Part B; each new table gets its rows in the task that creates it.
    Slice 1 did the same for its retired tables.
17. **NEW — a pass monitor is a kitchen display's only, and shows what the till's "All stations"
    Pass board shows.** Only a `kds` profile may offer `pass_monitor`
    (`device_profile.access_invalid` `{ field: "kitchenScreens", reason: "not_shared_display" }`
    otherwise). Its read is the every-station pass read (`listExpoQueue`,
    `apps/server/src/working-order.ts:6618-6633`) narrowed to its stations and zones: with no Done
    to clear them, fully-away courses and groups drop off as they do on that board. Why: a till or
    handheld always has someone signed in to work it, and a board with no buttons that kept dishes
    until Done would never empty.
18. **NEW — a kitchen display's sign-in is a backlog entry, not this slice.** The owner: "kitchen
    displays can have a login, but i would not expect them to log off automatically, or at least
    only after an extended logout time (eg 30 minutes)". Evidence it is not small: a kitchen
    display is built as a screen nobody signs in on — the server refuses the sign-in
    (`refuseKitchenSignIn`, `apps/server/src/till-api.ts:982-986`); the profile stores no idle
    logout for it (`validateInactivityTimeout` returns null for `kds`,
    `packages/layouts/src/device-profile.ts:73-82`) and the editor hides the setting
    (`#shownFields`, `apps/dashboard/src/screens/device-profiles-screen.ts:722`); the till boots it
    straight into its screen with no lock screen (`apps/till/src/till-app.ts:2315-2322`), holds
    the screen awake and never runs the idle timer on it (`apps/till/src/session-activity.ts:36-38`,
    `:102-113`); a kitchen display profile carries no admission list and may take only the actions
    a shared screen may (`device-profile.ts:13-24`). The 30-minute timeout itself would be the
    existing per-profile "Auto-logout after (minutes)" setting once sign-in exists; the work is the
    sign-in. Backlog: "A kitchen display with someone signed in, logged out only after a long idle
    time" (The till, devices and table service). This slice is ready for it: the Done route reads
    the signed-in person (decision 5).
19. **NEW — a kitchen display's Fire records the device.** Fire is the one lever that records who
    did it: `order_groups.fired_by` (`packages/db/src/schema/order-groups.ts:26`, written at
    `apps/server/src/order-groups.ts:469`) and an `order_group_events` row whose `actor_id` is not
    null (`schema/order-groups.ts:69`, written at `apps/server/src/order-groups.ts:471`), both plain person ids.
    `order_groups` gains `fired_by_device_id`; `order_group_events` gains `actor_device_id`, its
    `actor_id` becomes nullable, and a check makes exactly one of the two set. A group fired by a
    device shows the device's name where the till shows who sent it (`sentBy`, read at
    `order-groups.ts:1095-1111`; the till already handles a group with no name,
    `apps/till/src/api/client.ts:559`, `till-table-order-screen.ts:3712`). A group a device fired
    that later moves to another bill is fired again in the mover's name, as the move does for a
    line whose group has no person firer (`move-bill.ts:382-383`, `order-groups.ts:1524`).
    Override: no Fire on a kitchen display until one can sign in (Ready and Away only; no
    migration).
20. **NEW — a till's or handheld's choice is optional and narrows only what it shows.** Stated in
    decisions 2, 7 and 9: no choice keeps today's screens; a pass screen choice gives the narrowed
    board with Done; the Station screen keeps its picker, listing the chosen stations; a till's
    choice never counts as a station's screen. Its session routes do not refuse an order or dish
    outside its choice: the signed-in person may act anywhere, as today.
21. **NEW — the device keeps its stored choice and the read works out what is no longer
    available** (decision 8's data design), and a station or zone switched off since the device
    chose it reads as no longer available, by name, like one the profile dropped. The first
    version skipped such a station silently.
22. **NEW — the "New watcher" button leaves the Prep stations screen in Part A.** The owner
    (2026-10-08 ~21:05, on the Prep stations tab row): "i don't think watchers should be here -
    they are devices which take a device profile." This plan retires the watcher UI in Part B
    (Task B2), which waits for slice 4, so the button would otherwise stay for that whole wait.
    Removing only the button in Part A is safe because the button is the only way to make a watcher
    in the dashboard (`prep-stations-screen.ts:3450-3457`; the form's other opener edits an
    existing one), and after Part A a new watcher could only be a printer setting: no screen shows
    one. Cost, stated in the pull request: between Part A and slice 4, a venue with no watcher
    cannot set up a new pass ticket printer; the venue's existing watchers stay editable. The
    form's "new" mode goes with the button. The action area's width cap exists because two buttons
    shared it (`prep-stations-screen.ts:112-115`, A424); with one button left, the cap stays or goes
    by what the look shows (Task A17), and its comment goes either way.
23. **NEW — a kitchen display profile may also hold `take-orders` and `hand-over-orders`.** Today it
    may hold only `prepare-orders` (`SHARED_DISPLAY_ACTIONS`, `packages/layouts/src/device-profile.ts:19`).
    Decision 3 keeps the server checking those actions on every lever, and the kitchen display's
    pass needs Fire and Away. With nobody able to sign in on a kitchen display, its cookie alone
    reaches no check of either action today: `grep -rn "assertProfileAction(\|assertDeviceCapability(" apps/server/src`
    (non-test hits, read 2026-10-08) finds `take-orders` checked only on a session's device
    (`requireSession`'s `action` option, `apps/server/src/till-session.ts:122-124`;
    `till-api.ts:1535`, `:1565`; `department-transfer-api.ts:44`, whose device comes from the
    session, `:34`), `hand-over-orders` only through that option, and on a device cookie alone only
    `prepare-orders` (`device-api.ts:424`, `:440`) and `print-receipt`
    (`assertDeviceCapability`, `orders-api.ts:197`). This slice's lever routes are the only new
    checks. The default kitchen display profile is unchanged; the demo's gains them (decision 13).
24. **NEW — the kitchen display's lever routes check the order's zone, not its stations.** The
    order's or party's zone (read as a watcher's board reads it, `orderWatchZones`,
    `apps/server/src/watch-zones.ts:15`) must be one of the device's pass zones, or the device's
    pass covers every zone; otherwise `service_zone.not_allowed` `{ zoneId }`, as a till's zone
    gate answers. Fire, Ready and Away then act on the whole course or group, as at a till: a course
    can hold dishes from stations the pass does not show.
25. **NEW — the Prep stations read-out lists the devices whose choice covers the station**, of any
    form factor and any kind (station screen, pass screen, pass monitor); a till or handheld with no
    choice is not listed, though its screens show every station.

## Where the code differs from what the spec assumes

- §9.4's first text, "Firing, Ready and Away are a profile action": the three are already gated by
  profile actions — `take-orders`, `prepare-orders`, `hand-over-orders`
  (`till-api.profile-actions.test.ts:61-63`, `:77-79`) — on routes the order screen, the station
  screen and the station queue also call (`till-app.ts:5805`, `till-station-screen.ts:433`, `:447`,
  `widgets/station-queue.ts:656`). The spec's §9.4 is revised to say "Run the pass" is a screen
  setting (decision 3).
- §9.4's first text assumed a kitchen display is the only device with these screens. A till's
  Station screen picks any station today (`till-station-screen.ts:629-640`) and its Pass screen
  picks "All stations" or a watcher (`till-expo-screen.ts:508-529`); decisions 2 and 20.
- §9.4 "today a device binds exactly one station or watcher" holds for kitchen displays only; any
  other device binds neither, enforced by the triggers in `0091_devices_recreate_triggers.sql` and
  by `resolveDeviceBinding` (`apps/server/src/device.ts:359-383`).
- §15 item 3 "a watcher keeps its own Done marks": also at a till, where a person picks a watcher on
  the Pass screen and marks Done as themselves (`/api/watchers/:id/done`, `till-api.ts:1915-1934`).
  Decision 5 keeps the person and moves the marks to the device.
- The owner's model "the device recorded as the actor, as `/api/device/ticket-items/:id/advance`
  works today": that route records no actor; it authenticates the device and checks its profile.
  Only Fire records an actor, a person (decision 19).
- §9.3 "Shown on (the devices whose monitors show it)": today the read-out is the Tickets tab's
  "Screens" column and counts only a kitchen display bound to the station
  (`prep-stations-screen.ts:1995-2011`); the Watchers tab has its own "Screens" column
  (`:2765-2781`).
- §2 "a printer attached to a watcher already prints one combined ticket per send": matches
  `kitchen-print.ts:605-688`. Removing it is Part B.

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`.
- Work in this branch's worktree; never commit to `main`.
- A shipped migration file is never edited. New migrations only; numbers come from
  `pnpm --filter <package> db:generate` (or `db:generate:custom`) at build time, never typed. Slice
  3's branch adds venue-service `0034` and `0035`; whichever lands second regenerates.
- No data-migration code before go-live (CLAUDE.md §3): a migration changes the schema; old rows
  are left to the reset. Part A adds, rebuilds and drops; Part B drops.
- drizzle-kit 0.31.11: a generation that rebuilds a table must not also add a column to it. This
  slice rebuilds two tables: `devices` (Task A10) only drops columns; `order_group_events` (Task
  A4b) gets its new column in one generation and is rebuilt in the next. The expression-index trap
  does not arise for `devices`: its one index is the partial unique index
  `devices_location_label_active_key` over plain columns, which drizzle already re-created after
  the last rebuild (`packages/db/drizzle/0090_devices_lose_till.sql:29`); Task A4b reads
  `order_group_events`' indexes before generating.
- **A drizzle rebuild runs with foreign keys ON (CLAUDE.md §3), and `devices` has children of every
  kind.** Measured 2026-10-08 (first version) with `node:sqlite` on Node v26.7.0, foreign keys on,
  the rebuild's shape (`BEGIN`, `PRAGMA foreign_keys=OFF`, copy into `__new_devices`,
  `DROP TABLE devices`, rename, `PRAGMA foreign_keys=ON`, `COMMIT`) with one child row pointing at
  the one device: an `ON DELETE cascade` child's row was deleted and the rebuild committed; an
  `ON DELETE restrict` child and an `ON DELETE no action` child each made it fail with
  `FOREIGN KEY constraint failed`. At `063fcb5cd`, scanning `packages/*/drizzle/*.sql` for
  `` REFERENCES `devices` `` and reading each hit's table and delete rule finds `restrict` children
  `sessions`, `sales`, `payments`, `registros_facturacion`, `working_orders`, `time_entries`,
  `incidents`, `bill_payments`, `bill_payment_refunds`, `order_amendments`, `unpaid_departures`
  and `device_card_readers`; `no action` children `drawer_opens`, `device_made_here_stations` and
  `watcher_item_marks`; and `cascade` children `device_approved_profiles`, `printer_holders` and
  `card_reader_holders` (it also finds `device_zone_defaults`, which
  `packages/venue-service/drizzle/0025_retire_device_zone_defaults.sql` drops). This slice adds
  `no action` children `device_kitchen_screens`, `pass_item_marks`, `order_groups`
  (`fired_by_device_id`) and `order_group_events` (`actor_device_id`). So on any box that has had a
  sign-in or a sale the migration fails and the box does not start until it is reset. Task A10's
  commit message lists every child with its `ON DELETE` and says this; the pull request's first
  line says the reset is required (see "Venue reset" above).
- Every foreign key and unique index is declared in the TypeScript schema.
- Error codes name the domain concept and are registered in the throwing package's `errors.ts`;
  every file that throws one imports its registry. A code decision 11 retires leaves every registry
  and every translation list in the change that stops throwing it
  (`grep -rn '"<code>"' apps packages`; among them `apps/dashboard/src/i18n/codes.ts`,
  `apps/till/src/i18n/codes.ts`, `devices-screen.ts:108-128`, `profile-dialog.ts:19`, and the
  status maps `device-api.ts:128-144` and `join-api.ts:58-68`). Each task that adds or retires a
  code runs `scripts/errors-reachable.test.ts`.
- venue-service functions take `cfg: VenueScope`. Multi-table writes take one `tx: Transaction`;
  queries on one transaction are awaited in turn.
- New UI reads `--wt-*` tokens only; a screen does not draw its own `<select>`, `<textarea>` or text
  `<input>`; a `wt-*` component's own events are `wt-*`.
- **Save rule (owner, 2026-10-08, every A366 slice).** Each form this slice rewrites — the device
  profile editor's kitchen screens, the device Pair and Edit dialogs — keeps or takes A331's rule as
  it stands on `main` (`docs/developers/design-system.md` → Forms): a draft scope from
  `draftScopeFor`, the action drawn through `saveActionState`, an early return in the save handler
  while `saveActionState(...).unchanged`, a `*.save-state.test.ts` and a `*.unsaved.test.ts` with
  #1422's reconnect case (take the form off the page, put it back, it still asks before
  discarding). The Pair dialog keeps `{ savableAtOpen: true }` (`devices-screen.ts:1961`). Do it
  test-first inside the task; list it under the pull request's changed checks.
- A new device route that fires, readies or sends away adds a row to the route-to-action map atop
  `apps/server/src/till-api.profile-actions.test.ts` and a refusing case, and names its scope in
  the "Not zone-gated" paragraph of `till-api.profile-zones.test.ts` (`:151-153`), whose kitchen
  routes are scoped by the device's screen (CLAUDE.md §3).
- A task that removes or renames a field, function, route client method or exported type also
  removes it from every caller and every test stub that names it in the same commit; the package's
  typecheck lists them, and `grep -rln "<name>" apps packages` confirms. The till's and dashboard's
  suites stub the API client, so a server route can change before the screen that calls it
  without a red suite; the screen's own task then moves it.
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
- **Removing a station or watcher a device shows is refused** (`device_profile.station_in_use`,
  `device_profile.watcher_in_use`, `profile-access.ts:462-503`); now it is allowed (decision 8).
- A profile switch refused because the new profile does not list the device's station
  (`assertProfileBinding` in `switchActiveProfile`, `device.ts:288-330`).
- A kitchen display profile limited to `prepare-orders`, and `run-the-pass` refused on it.
- A device or a Done mark keeping a watcher in use, and a profile's watcher list being cleared
  when a watcher is deleted (`apps/server/src/watchers.test.ts`: `bindDevice :46-62` and its callers
  `:245`, `:417`, `:466`, `:476`, `:495`, `:531`; `:392-412`; `:443`).
- Done marks kept per watcher (`watcher_item_marks`, `markWatcherItems`;
  `packages/db/src/schema/watchers.test.ts:20`, its mark cases `:150-193` and their helper
  `seedTicketAndDevice :78-148`).
- The till Pass screen's watcher chooser and the `till-watcher` address part
  (`apps/till/src/navigation.ts:11`); a pass board's levers depending on the watcher's `runs_pass`;
  the till Pass screen's levers shown to every profile with `show-expo` (they now need
  `run-the-pass`).
- A kitchen display's pass board with no levers (`till-expo-screen.ts:870`, `:1034`).
- `order_group_events.actor_id` always holding a person.
- Creating a watcher from the Prep stations screen (the "New watcher" button and the watcher
  form's new mode; Part B removes the rest).
- The device routes and codes decisions 11 and 12 replace.
- The Prep stations screen's device read-outs reading `devices.stationId` and
  `devices.watcherId`.
- Part B: watcher printers and their copies, the Watchers tab, the watcher management routes,
  `printer.makes_and_watches` if slice 4 has not removed it.

## Review focus

The conditions most likely to bite a person that no single task's happy path exercises. Each has
its test in the task named.

1. **A pass screen or monitor sees only its stations and zones.** A Terrace-only pass does not show
   a Bar order, and does not show a counter sale, which has no zone (as `watcherSees` today,
   `watchers.ts:45-53`) (Task A8).
2. **Two pass screens, one dish.** Marking a dish Done on one leaves it on the other; a dish split
   onto another bill keeps the marks; a till's mark records the signed-in person, a kitchen
   display's records none (Task A8).
3. **A kitchen display cannot bump another station's dish.** An advance on an item at a station
   outside the device's station screen is refused `device.forbidden_station`; an every-station
   screen may advance any (Task A7).
4. **Narrowing a profile under a device.** The save succeeds and names the device; the device
   shows "This station is no longer available: Deli" and nothing else when nothing is left; an
   "every" device follows the profile; editing the device clears the message (Tasks A3a, A6, A12a,
   A14, A15, A16).
5. **No screen is normal.** A venue with no kitchen displays, or with only pass screens and
   monitors, or with a till that chose stations, raises no dark-screen alert however long dishes
   wait (Task A7).
6. **The `devices` rebuild.** After it, `device_profile_form_factor_locked` still refuses a form
   factor change under an active device, and the upgrade walk's casualties are exactly the ones its
   `RESETS` entry names (Task A10).
7. **Levers.** A till without `run-the-pass` shows no Fire, Ready or Away on its Pass screen and
   still fires from its order screen; a kitchen display's pass with it fires as the device, and
   without `take-orders` is refused `device.forbidden_action` (Tasks A1, A8b, A13, A14).
8. **The device as firer.** A group a kitchen display fired shows the device's name as its sender;
   `order_group_events` refuses a row with both or neither of a person and a device, and still
   refuses an update or a delete (Tasks A4b, A8b).

---

## Part A — kitchen screens and monitors (first pull request)

### Task A1: The `run-the-pass` setting; a kitchen display may take and hand over

**Files:**
- Modify: `packages/layouts/src/canvas.ts` (`CAPABILITY_FLAGS :37-50`, `PROFILE_SCREENS :67-72`),
  `packages/layouts/src/device-profile.ts` (the comments `:13`, `:18`, `SHARED_DISPLAY_ACTIONS
  :19`, `DEFAULT_PROFILE_CAPABILITIES.till :90-102`),
  `apps/dashboard/src/screens/canvas-editor/card-contracts.ts` (its mirrors: `CAPABILITY_FLAGS
  :20`, `PROFILE_SCREENS :47`, `SHARED_DISPLAY_ACTIONS :70`), `apps/till/src/layout.ts`
  (`CapabilityFlag :39-51`), `apps/dashboard/src/screens/device-profiles-screen.ts`
  (`#renderCapabilities :2042`, the Screens group `:2058-2063`), `apps/dashboard/src/i18n/strings.ts`
  (`device_profiles.capability.run-the-pass`, EN and ES), `apps/server/src/till-api.profile-actions.test.ts`
  (the shared-display sentence `:105-106`)
- Test: `packages/layouts/src/canvas.test.ts`, `device-profile.test.ts`,
  `apps/dashboard/src/screens/canvas-editor/card-contracts.parity.test.ts` (must pass unchanged),
  `apps/dashboard/src/screens/device-profiles-screen.test.ts`

**Interfaces:** `"run-the-pass"` joins `CAPABILITY_FLAGS` and `PROFILE_SCREENS` (decision 3). It is
not a `PROFILE_ACTIONS` member, so `assertProfileAction` never sees it, and `sharedDisplayMay`
already allows every flag that is not an action (`device-profile.ts:21-24`), so a kitchen display
may hold it with no further change. `SHARED_DISPLAY_ACTIONS` becomes
`["prepare-orders", "take-orders", "hand-over-orders"]` (decision 23); its comment says why: the
pass's levers, the only device routes that check those two. The profile editor's Actions group is
already filtered by `sharedDisplayMay` (`:2044`), so a kitchen display profile then offers the two
switches.

- [ ] **Step 1: Failing tests:** `validateCapabilities(["run-the-pass", "take-orders", "hand-over-orders"], "kds")`
  returns all three; `validateCapabilities(["take-cash"], "kds")` still throws
  `device_profile.invalid` `shared_display_action`; `profileAllows({ formFactor: "kds", capabilities: ["take-orders"] }, "take-orders")`
  is true; `DEFAULT_PROFILE_CAPABILITIES.till` contains `run-the-pass` and `.kds` is unchanged; the
  profile editor shows a "Runs the pass" switch under Screens for a till profile and for a kitchen
  display profile, and "Take orders" and "Hand over orders" under Actions for a kitchen display.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/layouts exec vitest run src/canvas.test.ts src/device-profile.test.ts`
  and `pnpm --filter @waitron/dashboard exec vitest run src/screens/device-profiles-screen.test.ts`.
- [ ] **Step 3: Implement**, the mirrors and the label; reword the profile-actions map's sentence
  to say a shared display may prepare, take orders and hand over, and on its own cookie reaches no
  till route.
- [ ] **Step 4: Run; see them pass;** run the parity test and
  `pnpm --filter @waitron/server exec vitest run src/till-api.profile-actions.test.ts`; typecheck
  layouts, dashboard, till and server.
- [ ] **Step 5: Commit** — `feat(layouts): a profile can run the pass, and a kitchen display can take and hand over (A366)`.

---

### Task A2: Migration — kitchen screen tables (add only)

**Files:**
- Create: `packages/venue-service/src/schema/kitchen-screens.ts`; generated
  `packages/venue-service/drizzle/00NN_*.sql`, snapshot, journal entry
- Modify: `schema/index.ts`, `classification.ts` and its test, `configuration-transfer.ts` (the
  profile tables, decision 15, beside `device_profile_stations` `:557`), `migrations.test.ts`
  (`TABLES`), `scripts/schema-constraints.test.ts`,
  `apps/server/src/testing/clear-provision-fixture.ts` (the six tables join its list beside
  `device_profile_stations` `:27`, before `kitchen_stations` and `floor_zones`, whose keys from the
  station and zone tables have no delete rule)

**Interfaces — produces** (built from `@waitron/db`'s column vocabulary, as `schema/service.ts:1-24`
imports it):

```ts
export const KITCHEN_SCREEN_KINDS = ["station", "pass", "pass_monitor"] as const;
const kitchenScreenKind = enumType(KITCHEN_SCREEN_KINDS);

// device_profile_kitchen_screens: a row means the profile bounds (till, handheld) or offers (kds)
//   that kind. device_profile_id → device_profiles.id ON DELETE cascade; screen; every_station;
//   every_zone. PK (device_profile_id, screen); CHECK screen in KITCHEN_SCREEN_KINDS;
//   CHECK (screen <> 'station' OR every_zone = 0)
// device_profile_kitchen_screen_stations: device_profile_id, screen, station_id
//   PK (all three); FK (device_profile_id, screen) → device_profile_kitchen_screens ON DELETE
//   cascade; FK station_id → kitchen_stations.id
// device_profile_kitchen_screen_zones: device_profile_id, screen, zone_id
//   PK (all three); same parent FK; FK zone_id → floor_zones.id; CHECK screen <> 'station'
// device_kitchen_screens: device_id → devices.id (no action); screen; every_station; every_zone;
//   PK (device_id, screen); the same two CHECKs
// device_kitchen_screen_stations: device_id, screen, station_id; FK (device_id, screen)
//   → device_kitchen_screens ON DELETE cascade; FK station_id → kitchen_stations.id;
//   PK (all three)
// device_kitchen_screen_zones: device_id, screen, zone_id; same parent FK; FK zone_id
//   → floor_zones.id; PK (all three); CHECK screen <> 'station'
```

Which kinds a form factor may hold, and "one per kitchen display", are code rules
(`setProfileKitchenScreens`, `setDeviceKitchenScreens`, Tasks A3a and A3b): a CHECK cannot read
another table. `device_kitchen_screens.device_id` is `no action` rather than `cascade` so that a
later rebuild of `devices` refuses (see Global constraints) instead of silently emptying every
device's choice.

- [ ] **Step 1: Failing test** in `migrations.test.ts`: the six tables exist; deleting a profile
  deletes its kitchen screen rows; a station row with `every_zone = 1`, a zone row on a station
  screen, and an unknown `screen` are refused by the database; deleting a device's
  `device_kitchen_screens` row deletes its station and zone rows. Run
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/migrations.test.ts`.
- [ ] **Step 2: Schema, then generate** — `pnpm --filter @waitron/venue-service db:generate`. Read
  the SQL: only `CREATE TABLE` and indexes.
- [ ] **Step 3:** classify all six `state`; add the three profile tables to
  `VENUE_SERVICE_CONFIGURATION_TRANSFER.tables`; add each table's keys and checks to
  `scripts/schema-constraints.test.ts`.
- [ ] **Step 4: Run** Step 1's test and
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/module-graph-honesty.test.ts`
  (below, "the Task A2 guard list"). Read each run's `Tests` count.
- [ ] **Step 5: Commit** — `feat(venue-service): tables for the kitchen screens profiles offer and devices choose (A366)`.

---

### Task A3a: Profile kitchen screens and what a narrowing changes (venue-service)

**Files:**
- Create: `packages/venue-service/src/kitchen-screens.ts`, `kitchen-screens.test.ts`
- Modify: `packages/module/src/module.ts` (adds the types and the profile members below to
  `VenueServiceContribution`; `readProfileKitchenLists`, `setProfileKitchenLists`,
  `assertProfileBinding` and `readProfileServiceAccess`'s `stationIds`/`watcherIds` stay until
  A10, so the server keeps compiling), `packages/venue-service/src/service.ts`, `index.ts`,
  `errors.ts` (`device_profile.access_invalid`'s new fields and reason)
- Test: `kitchen-screens.test.ts`; `scripts/errors-reachable.test.ts`

**Interfaces** (types in `packages/module/src/module.ts`, implementation in `kitchen-screens.ts`):

```ts
export type KitchenScreenKind = "station" | "pass" | "pass_monitor";
/**
 * null stationIds = every station; null zoneIds = every zone. A station screen never filters by
 * zone: it is stored with every_zone 0 and no zone rows, and read back with zoneIds null. On a
 * device, "every" means every one its profile allows (decision 6).
 */
export interface KitchenScreenScope { readonly stationIds: readonly string[] | null; readonly zoneIds: readonly string[] | null }
export type ProfileKitchenScreens = Readonly<Partial<Record<KitchenScreenKind, KitchenScreenScope>>>;
export interface DeviceKitchenScreen extends KitchenScreenScope { readonly kind: KitchenScreenKind }
export interface Named { readonly id: string; readonly name: string }
/** A device's stored choice of one kind, worked out against its profile and what is switched on. */
export interface ResolvedKitchenScreen {
  readonly kind: KitchenScreenKind;
  /** False when the profile no longer offers (kds) or allows (other form factors) this kind. */
  readonly available: boolean;
  readonly stations: readonly Named[];        // what it shows now, in station order
  readonly zoneIds: readonly string[] | null; // null: no zone filter
  readonly unavailable: { readonly stations: readonly Named[]; readonly zones: readonly Named[] };
}
export interface NarrowedDevice {
  readonly deviceId: string; readonly deviceName: string;
  readonly lost: { readonly screens: readonly KitchenScreenKind[]; readonly stations: readonly Named[]; readonly zones: readonly Named[] };
}

readProfileKitchenScreens(tx, cfg): Promise<{ profileId: string; screens: ProfileKitchenScreens }[]>; // every live profile; switched-off entries included
setProfileKitchenScreens(tx, cfg, profileId: string, screens: ProfileKitchenScreens): Promise<NarrowedDevice[]>; // replaces all of the profile's rows
addProfileKitchenScreen(tx, cfg, profileId: string, screen: DeviceKitchenScreen): Promise<void>; // merges, never removes (decision 14's helper)
```

`kitchen-screens.ts` also holds the pure `resolveKitchenScreen(profile, formFactor, stored,
active)` that Task A3b's device read and this task's narrowing report share.

Rules the tests pin:

- `setProfileKitchenScreens` on a profile that is not `kds` with `pass_monitor` →
  `device_profile.access_invalid` `{ field: "kitchenScreens", reason: "not_shared_display" }`; an
  explicit empty list → `reason: "empty"` on the list's field (`stationScreenStations`,
  `passScreenStations`, `passScreenZones`, `passMonitorStations`, `passMonitorZones`); an unknown
  station or zone, or one switched off and not already stored → `reason: "not_found"` on the same
  field (as `checkLists`, `profile-access.ts:436-460`).
- Narrowing is never refused (decision 8). The answer lists each active device on the profile that
  shows less after the save than before, with what it lost: a stored station, zone or kind the
  profile no longer allows, and, for a device on "every", the stations or zones the profile's list
  dropped. A save that narrows nothing a device shows answers `[]`.
- `addProfileKitchenScreen` creates the profile's row with the given explicit lists when it has
  none, adds stations or zones its explicit lists lack, and changes nothing on an "every" list.

- [ ] **Step 1: Failing tests** in `kitchen-screens.test.ts` (with `useVenueDb`, as
  `profile-access.test.ts` sets up), one per rule; each rule the kitchen-list cases of
  `profile-access.test.ts` pin today, except the in-use refusals decision 8 retires, has its
  counterpart here, at least as strict, before A10 deletes them. For the report, write the device
  rows straight into Task A2's tables.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/kitchen-screens.test.ts`.
- [ ] **Step 3: Implement;** wire the contract in `service.ts`; register the new field values.
- [ ] **Step 4: Run; see them pass;** `pnpm exec vitest run scripts/errors-reachable.test.ts`;
  typecheck venue-service, module and server.
- [ ] **Step 5: Commit** — `feat(venue-service): profiles offer kitchen screens, and a narrowing names the devices it changed (A366)`.

---

### Task A3b: The device's choice (venue-service)

**Files:**
- Modify: `packages/venue-service/src/kitchen-screens.ts` and its test,
  `packages/module/src/module.ts`, `service.ts`, `errors.ts` (decision 11's `kitchen_screen.*`
  codes)
- Test: `kitchen-screens.test.ts`; `scripts/errors-reachable.test.ts`

**Interfaces:**

```ts
readDeviceKitchenScreens(tx, cfg, deviceId: string): Promise<ResolvedKitchenScreen[]>; // one per stored kind, in kind order
setDeviceKitchenScreens(tx, cfg, input: { deviceId: string; profileId: string; screens: readonly DeviceKitchenScreen[] }): Promise<void>; // replaces the device's rows
assertDeviceKitchenScreens(tx, cfg, profileId: string, screens: readonly DeviceKitchenScreen[]): Promise<void>; // setDeviceKitchenScreens' checks without the write
readStationScreens(tx, cfg): Promise<{ deviceId: string; stationIds: string[] }[]>; // active kitchen displays running a station screen; "every" expanded; unavailable dropped (decision 9)
```

Rules the tests pin:

- `setDeviceKitchenScreens` on a `kds` profile: no screen → `kitchen_screen.required`; two →
  `kitchen_screen.invalid` `{ field: "screens", reason: "one_only" }`. On any profile: a kind named
  twice → the same with `reason: "one_only"`; a kind the profile does not offer (a `kds` profile
  with no row for it; `pass_monitor` on any other) → `kitchen_screen.not_allowed` `{ screen }`; a
  station outside the profile's explicit list → `station.not_allowed`; a zone outside →
  `kitchen_screen.zone_not_allowed`; a zone on a station screen → `kitchen_screen.invalid`
  `{ field: "zoneIds", reason: "not_for_screen" }`; an explicit empty list → `reason: "empty"`; a
  switched-off or unknown station or zone → `reason: "not_found"`. "Every" is accepted under any
  profile list. A till or handheld with no screens is accepted.
- `readDeviceKitchenScreens`: an "every" device lists every switched-on station its profile allows
  and has no unavailable stations; an explicit device lists the stored ones still allowed and
  switched on, and names the rest under `unavailable`; a kind the profile no longer offers reads
  `available: false` with its stored stations and zones named under `unavailable`; a station
  screen reads `zoneIds: null`. On a till or handheld whose profile has no row for the kind, the
  profile bounds nothing.
- `readStationScreens` lists kitchen displays only, never a till or handheld.

- [ ] **Step 1: Failing tests** in `kitchen-screens.test.ts`, one per rule.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/kitchen-screens.test.ts`.
- [ ] **Step 3: Implement;** wire the contract; register the codes.
- [ ] **Step 4: Run; see them pass;** `pnpm exec vitest run scripts/errors-reachable.test.ts`;
  typecheck venue-service, module and server.
- [ ] **Step 5: Commit** — `feat(venue-service): a device chooses its kitchen screens, and reads what is no longer available (A366)`.

---

### Task A4: Migrations — pass marks; the binding triggers go

**Files:**
- Create: `packages/db/src/schema/pass-item-marks.ts`; generated `packages/db/drizzle/00NN_*.sql`
  (the table) and a `--custom` one that drops `device_binding_rule_insert` and
  `device_binding_rule_update`; snapshots, journal
- Modify: `packages/db/src/schema/index.ts`, `src/index.ts`, `classification.ts` and its test,
  `trigger-refusals.ts` (delete `MISSING_PROFILE_REFUSAL`, `KDS_BINDING_REFUSAL`,
  `NON_KDS_BINDING_REFUSAL`, `:46-59`), `schema/devices.trigger.test.ts`, `schema/devices.ts`
  (its doc comment's sentence about the triggers, `:11-15`), `scripts/behavioural-triggers.test.ts`
  (decision 10), `scripts/schema-constraints.test.ts`

**Interfaces:** `pass_item_marks`: `device_id` → `devices.id`, `ticket_item_id` → `ticket_items.id`
ON DELETE cascade, `done_at` (`tsString`, not null), `done_by_person_id` (a plain person id, null
when nobody was signed in; people live in identity's set, which core cannot reference, as
`watcher_item_marks.done_by_person_id` says, `schema/watcher-item-marks.ts:15-16`); PK
`(device_id, ticket_item_id)`; index on `ticket_item_id`. Classified `state`, with a reason like
`watcher_item_marks`'. The commit message gives decision 5's reason for the core set.

- [ ] **Step 1: Failing tests:** in `packages/db`, a schema test that a mark is deleted with its
  ticket item, that two devices may mark one item, and that a mark with no person is accepted; in
  `devices.trigger.test.ts`, the schema holds no trigger named `device_binding_rule_insert` or
  `device_binding_rule_update` (`select name from sqlite_master where type = 'trigger'`), replacing
  the cases that exercised them.
- [ ] **Step 2: Generate** — `pnpm --filter @waitron/db db:generate`, then
  `pnpm --filter @waitron/db db:generate:custom` and write the two `DROP TRIGGER` statements.
- [ ] **Step 3:** classification; schema-constraints rows for the new table; remove the two
  trigger names and their `describe` blocks from `scripts/behavioural-triggers.test.ts`.
- [ ] **Step 4: Run** `pnpm --filter @waitron/db exec vitest run src/schema/devices.trigger.test.ts`
  and the Task A2 guard list plus `scripts/behavioural-triggers.test.ts`.
- [ ] **Step 5: Commit** — `feat(db): per-device pass marks; the device binding triggers go (A366)`.

---

### Task A4b: Migrations — a group's firer may be a device

**Files:**
- Modify: `packages/db/src/schema/order-groups.ts` (`orderGroups :16-43`, `orderGroupEvents
  :62-88`, and their doc comments `:13-14`, `:59-60`), `classification.ts` (the event table's
  reason, `:162-166`), `scripts/schema-constraints.test.ts`; generated
  `packages/db/drizzle/00NN_*.sql` (two), snapshots, journal
- Test: `packages/db/src/schema/order-groups.test.ts`

**Interfaces** (decision 19): `order_groups.fired_by_device_id` → `devices.id` (no action),
nullable. `order_group_events.actor_device_id` → `devices.id` (no action), nullable;
`actor_id` becomes nullable; CHECK `order_group_events_actor_ck`:
`(actor_id is null) <> (actor_device_id is null)`, as `watcher_item_marks_done_by_ck` does
(`schema/watcher-item-marks.ts:36-39`).

- [ ] **Step 1: Failing tests** in `order-groups.test.ts`: an event with a device and no person is
  accepted; one with both, and one with neither, are refused by the database; an update and a
  delete of an event are still refused (its append-only triggers, installed by `useVenueDb`); a
  group may record a device as its firer.
- [ ] **Step 2: Generate in two steps** (CLAUDE.md §3: a generation that rebuilds a table must not
  also add a column to it). First add the two columns and generate; read the SQL: it must be
  `ALTER TABLE … ADD` only. If drizzle wrote a rebuild for a column with a key, take the key out of
  this generation and declare it in the next. Then make `actor_id` nullable, add the check (and any
  key moved), and generate; read the SQL: one rebuild of `order_group_events`, no added column.
  Before generating, list `order_group_events`' indexes in the schema: an expression index would
  need the separate generation CLAUDE.md §3 describes.
- [ ] **Step 3:** schema-constraints rows for the two keys and the check.
- [ ] **Step 4: Run** Step 1's tests, the Task A2 guard list, `scripts/append-only-triggers.test.ts`,
  `scripts/append-only-migration-sets.test.ts` and `scripts/behavioural-triggers.test.ts`; if the
  upgrade walk loses or refuses rows at either step, add a `RESETS` entry naming exactly what it
  prints, as `core/0090_devices_lose_till`'s does (`scripts/migration-upgrade.test.ts:384-387`).
- [ ] **Step 5: Commit** — `feat(db): a kitchen display can be recorded as the one who fired a group (A366)`.
  The message says the event table is append-only, that its rebuild is allowed only because every
  box needs a venue reset for this slice, and that the existing rows all hold a person.

---

### Task A5: Accepting, editing and switching a device write its kitchen screens

From here until A8 a device is written **both ways**: its kitchen screen rows, and the old columns
where an old reader still needs them. With the binding triggers gone (A4) the database no longer
refuses either shape.

**Files:**
- Modify: `apps/server/src/device.ts` (`resolveDeviceBinding :337` → `resolveDeviceKitchenScreens`;
  `updateDeviceSettings :84`, `insertDevice :59`, `switchActiveProfile :288`), `join-requests.ts`
  (`acceptDeviceJoinRequest :487`, `returningDevicesOf :257`, which gains `kitchenScreens`),
  `join-api.ts` (`:330-366`; its status map `:58-68` and the comments naming
  `resolveDeviceBinding` `:49-52`, `:95-98`), `device-api.ts` (`PATCH /management-api/devices/:id
  :568`; status map `:128-144`), `errors.ts` (`device.station_required` goes), `testing/enrol.ts`;
  the dashboard's copies of `device.station_required`, renamed to `kitchen_screen.required` in the
  same change (`apps/dashboard/src/screens/devices-screen.ts:110`, `:895`,
  `apps/dashboard/src/i18n/codes.ts:576`, and `devices-screen.test.ts:1467`, `:2167`, `:2215`,
  `:3949`)
- Test: `device.test.ts`, `join-requests.test.ts`, `join-api.test.ts`, `join-api.db.test.ts`,
  `join-e2e.test.ts`, `device-api.test.ts` (the PATCH cases); `scripts/errors-reachable.test.ts`

**Interfaces:**

```ts
// device.ts
export async function resolveDeviceKitchenScreens(
  tx: Transaction, cfg: TillConfig,
  input: { profileId: string; kitchenScreens?: readonly DeviceKitchenScreen[] },
): Promise<{ kitchenScreens: readonly DeviceKitchenScreen[]; stationId: string | null; formFactor: FormFactor }>;
// stationId: on a kitchen display, the one station of a station screen with exactly one explicit
// station, else null — what devices.station_id keeps holding until A8 stops writing it, for the
// readers A7 and A8 move (/api/device/station until A7; device-session's DeviceBinding until A8).
```

The join-accept and PATCH bodies take `kitchenScreens?: DeviceKitchenScreen[]` (absent on PATCH
keeps the stored choice, unavailable entries included) in place of `stationId`/`watcherId`.
`acceptDeviceJoinRequest`'s input gains `kitchenScreens` and keeps `stationId` and `watcherId` until
A8, used only by `enrolDeviceForTest`: a `stationId` is read as a one-station station screen; a
`watcherId` is written to `watcher_id` with today's checks (`resolveDeviceBinding`'s watcher half
and `assertProfileBinding`) and no kitchen screen. That watcher path skips
`setDeviceKitchenScreens`, which would refuse a kitchen display with none
(`kitchen_screen.required`), so the watcher suites keep passing until A8 moves them and deletes
the path. Every other accept, edit and re-enable writes the device row with `station_id` from
`resolveDeviceKitchenScreens` and then calls `setDeviceKitchenScreens` in the same transaction. A
profile switch no longer checks the device's station (decision 8): `switchActiveProfile`'s
`assertProfileBinding` call goes, except on the watcher path above.
`enrolDeviceForTest(db, cfg, { …, stationId?, kitchenScreen?, watcherId? })` adds what it is given
to the profile (decision 14: `addProfileKitchenScreen`, and today's `listOnProfile` for the old
lists) before accepting.

- [ ] **Step 1: Failing tests:** accepting a kitchen display with a station screen on two stations
  stores it (`readDeviceKitchenScreens`) and leaves `station_id` null; with one station it also
  stores `station_id`; a `kds` accept with none → `kitchen_screen.required`; a till accept with a
  station screen and a pass screen stores both; a till accept with a pass monitor →
  `kitchen_screen.not_allowed`; a profile switch to a profile that does not offer the device's
  screen succeeds and the device then reads it `available: false`; a PATCH without
  `kitchenScreens` keeps a stored station switched off since; enrolling twice with different
  stations on one profile leaves both on the profile.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/device.test.ts src/join-requests.test.ts src/join-api.test.ts`.
- [ ] **Step 3: Implement.** Then run the suites that enrol a kitchen display
  (`grep -rln "enrolDeviceForTest" apps/server/src`) and fix only fixtures.
- [ ] **Step 4: Run; see them pass;** `pnpm exec vitest run scripts/errors-reachable.test.ts`;
  typecheck the server and the dashboard.
- [ ] **Step 5: Commit** — `feat(server): a device is given its kitchen screens (A366)`.

---

### Task A6: Profile routes, the device list and the device's own identity

**Files:**
- Modify: `apps/server/src/management-api.ts` (profile POST and PUT `:1466-1535`,
  `saveKitchenLists :525-533`, `ProfileBody :558-578`; new
  `GET /management-api/device-profile-kitchen-screens`), `device-api.ts` (the list
  `GET /management-api/devices :470`, `/api/device/me :261-290`)
- Test: `management-api.device-profiles.test.ts`, `device-api.test.ts`, `management-api.test.ts`

**Interfaces:** profile POST/PUT take `kitchenScreens?: ProfileKitchenScreens` (absent keeps the
stored rows, as an absent `stationIds` does today, `management-api.ts:1473`, `:1508`) in place of
`stationIds`/`watcherIds`. PUT's answer gains `narrowedDevices: NarrowedDevice[]` (decision 8);
POST's is always `[]` and is left out. `GET /management-api/device-profile-kitchen-screens` answers
`readProfileKitchenScreens`. `GET /management-api/device-profile-kitchen-lists` stays until A10,
which drops the tables it reads; the dashboard moves off it in A15, and its tests mock the client,
so they stay green in between. `GET /management-api/devices` rows and `/api/device/me` gain
`kitchenScreens: ResolvedKitchenScreen[]`; their `stationId`, `watcherId` and `binding` fields stay
until A8, which stops writing the columns behind them. The till reads `/api/device/me`'s until
A11, the dashboard reads the list's until A16 and the Prep stations screen until A17
(`routing-client.ts:70-77`); those suites stay green in between because they mock the API client.

- [ ] **Step 1: Failing tests:** `GET /management-api/device-profile-kitchen-screens` answers every
  live profile; a profile PUT naming `kitchenScreens` replaces them and one without leaves them; a
  PUT that drops a station a device shows answers 200 and names the device and the station in
  `narrowedDevices`; a PUT that adds a pass monitor to a till profile answers 400
  `device_profile.access_invalid`; the device list and `/api/device/me` carry the device's
  kitchen screens, an unavailable station named.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/management-api.device-profiles.test.ts src/device-api.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; see them pass;** typecheck the server.
- [ ] **Step 5: Commit** — `feat(server): profile kitchen screens on the management routes; a narrowing names its devices (A366)`.

---

### Task A7: The station screen's routes, station health and dark screens

**Files:**
- Modify: `apps/server/src/device-api.ts` (`/api/device/station :398-416` →
  `/api/device/station-screen`; acknowledge `:420-434`; advance `:437-467`, its station check at
  `:460`), `station-health.ts` (`:112-116`), `station-outputs-down.ts` (`stationScreensDark
  :114-140`)
- Test: `device-api.test.ts`, `station-health.test.ts`, `station-outputs-down.test.ts`,
  `alert-sources.test.ts`, `till-api.profile-zones.test.ts` (its paragraph at `:151-153`)

**Interfaces:**

```ts
// GET /api/device/station-screen → 200
interface DeviceStationScreen {
  stations: { id: string; name: string; queue: StationQueueGroup[]; notices: KitchenNotice[]; printersDown: StationPrinterDown[] }[];
  unavailable: { stations: Named[] };
}
```

Built from `readDeviceKitchenScreens`; an every-station screen lists every switched-on station its
profile allows in `display_order`, then name; each entry uses today's per-station readers
(`listStationQueue`, `listStationNotices`, `stationPrintersDown`, as `device-api.ts:405-413`). A
device with no station screen answers `device.unauthorized`, as a device with no station does today
(`:401-404`); a device whose station screen is no longer offered answers 200 with no stations and
`unavailable` naming what it showed. Any device other than a kitchen display also needs a session
(decision 12). Advance: the item's station must be one the device's station screen shows, else
`device.forbidden_station`. Acknowledge: the notice must be at one of those stations (read its
station, then call `acknowledgeKitchenNotice` with that `stationId`). Station health's "has a
screen" and the dark-screen query read `readStationScreens` (decision 9), expanding "every".
`/api/device/station` answers 404 from here; the till moves to the new route in A12a, and its tests
mock the client, so they stay green.

- [ ] **Step 1: Failing tests:** a two-station screen's read lists both stations with their own
  queues; a dropped station is named under `unavailable` and has no queue; advancing an item at a
  third station → `device.forbidden_station`; an every-station screen advances it; acknowledging a
  notice at a station outside the screen → not found; a station covered only by an every-station
  kitchen display counts as having a screen; one covered only by a pass screen, a pass monitor, or
  a till's station choice does not; a dark station screen raises the dark-screen alert for each of
  its stations. **No screen is normal (decision 9), each with dishes waiting over an hour:** a venue
  with no kitchen displays raises no `station.screens_dark` or `station.default_screens_dark` alert
  and `stationScreensDark` answers `[]`; a venue whose only kitchen displays run pass screens and
  monitors, all silent, raises none; a till whose station choice covers the station and which has
  not checked in for an hour raises none. Before running, say what each failing case would print:
  an alert keyed `station.screens_dark:<station id>` (`alert-sources.ts:356-363`).
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/device-api.test.ts src/station-health.test.ts src/station-outputs-down.test.ts src/alert-sources.test.ts`.
  The no-screen cases pass already (today's behaviour); confirm each fails for the right reason by
  deleting the station-screen filter from `readStationScreens` (a pass screen then counts) and
  watching the pass-screen case fail, then restore it.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; see them pass;** typecheck the server.
- [ ] **Step 5: Commit** — `feat(server): a station screen shows and works its stations; no screen stays normal (A366)`.
  The pull request's description says the no-screen tests exist and that nothing in this slice
  turns "no screen" into a warning.

---

### Task A8: The pass screen, the pass monitor and Done marks; the old columns stop being written

**Files:**
- Create: `apps/server/src/pass-board.ts` and `pass-board.test.ts` (from `watcher-board.ts` and
  `watcher-board.test.ts`, which are deleted), `pass-done-body.ts` (renamed from
  `watcher-done-body.ts`)
- Modify: `device-api.ts` (`/api/device/watcher :363-372`, `/done :374-395` →
  `/api/device/pass-screen`, `/api/device/pass-screen/done`; new `/api/device/pass-monitor`; the
  list and `/api/device/me` lose `stationId`, `watcherId` and `binding`; the PATCH stops reading the
  columns `:594-595`; `/api/dev/devices :681-692` stops selecting `devices.stationId`; the
  `watcher.*` statuses in the map `:128-144` go), `device-session.ts` (`DeviceBinding :91-101` loses
  `stationId` and `watcherId`, and `deviceBindingColumns :109-110` and the row mapping `:158-159`
  stop reading them), `till-api.ts` (delete `/api/watchers`, `/:id/queue`, `/:id/done`,
  `:1898-1934`, and their imports `:74-76`), `working-order.ts` (`:3892-3898` copies
  `pass_item_marks`), `device.ts` (stop writing `station_id` and `watcher_id`;
  `switchActiveProfile`'s reads `:298-299`, `:318-325` go) and `join-requests.ts` (stop writing
  them; drop the `stationId`/`watcherId` inputs; `returningDevicesOf` stops selecting them
  `:267-268`), `join-api.ts` (the `watcher.*` statuses `:65`, `:67` go), `testing/enrol.ts` (its
  `watcherId` option goes), `watchers.ts` (`WATCHER_REFERENCES :165-168` loses `devices` and
  `watcherItemMarks`; `WATCHER_SETTINGS :171-176` loses `deviceProfileWatchers`, and its import
  `:17` goes, since A10 removes that export), `till-api.profile-actions.test.ts` (the "watcher
  done marks" paragraph at `:97-100` describes `/api/device/pass-screen/done` instead),
  `till-api.profile-zones.test.ts` (`:151-153`)
- Test: `pass-board.test.ts`, `till-api.watchers.test.ts` (→ `device-api.pass.test.ts`),
  `working-order.test.ts` (the split case), `in-use-references.test.ts`, `device-session.test.ts`,
  `watchers.test.ts` (with `WATCHER_REFERENCES` empty, nothing keeps a watcher in use, so removing
  one deletes it unless the request asks to disable it: the helper `bindDevice :46-62`, the cases
  that call it at `:245`, `:417`, `:466`, `:476`, `:495` and `:531`, the profile-list case
  `:392-412` and the Done-mark case `:443` change — each that relied on "in use" passes `disable`
  or checks deletion instead; changed checks), every suite that enrolled with `watcherId`
  (`grep -rln "watcherId" apps/server/src --include='*.test.ts'`)

**Interfaces:**

```ts
export interface PassScope { stationIds: readonly string[] | null; zoneIds: readonly string[] | null }
export function passSees(scope: PassScope, dish: { stationId: string; zoneId: string | null }): boolean; // watcherSees' rule
export type PassOrder = WatcherOrder; // today's shape: courses and groups with allReady (watcher-board.ts:11-16)
/** The pass screen: dishes kept until this device marks them Done. */
export async function listPassScreen(tx: Transaction, cfg: TillConfig, deviceId: string, scope: PassScope): Promise<{ orders: PassOrder[] }>;
/** The pass monitor (decision 17): the every-station read narrowed to the scope; no marks. */
export async function listPassMonitor(tx: Transaction, cfg: TillConfig, scope: PassScope): Promise<{ orders: ExpoOrder[] }>;
export async function markPassItems(tx: Transaction, cfg: TillConfig, by: { deviceId: string; personId: string | null }, ticketItemIds: readonly string[], done: boolean, at: Date): Promise<void>;
```

`listPassScreen` keeps `listWatcherQueue`'s selection (`watcher-board.ts:41-116`) with the marks
read for this device. `listPassMonitor` filters `listExpoQueue`'s orders (`working-order.ts:6618-6633`)
to the scope's items, dropping an order left with none. `markPassItems` keeps `markWatcherItems`'
location check (`:131-146`); an undo deletes the device's marks whoever made them. The pass routes
answer `{ orders, unavailable: { stations, zones } }`; a device with no pass screen (or pass
monitor, for that route) answers `device.unauthorized`. `POST /api/device/pass-screen/done` on a
kitchen display records `signedInPersonOn(…)` (null today, decision 18); on any other device a
session is required and its person recorded.

- [ ] **Step 1: Failing tests:** Review focus 1 and 2: a Terrace-only pass screen does not list a
  Bar dish or a counter sale; marking Done on device A leaves the dish on device B; undoing removes
  only A's mark; a dish split onto another bill keeps A's mark; a till's Done without a session →
  `session.required`, with one → the mark records the person; a kitchen display's mark records no
  person; a pass monitor lists the scope's dishes, drops a fully-away course, and has no marks;
  `/api/device/pass-screen` on a station-screen device answers `device.unauthorized`; the removed
  routes answer 404; an accepted device's `station_id` and `watcher_id` are null; afterwards
  `grep -rn "devices\.stationId\|devices\.watcherId\|device\.stationId\|device\.watcherId" apps/server/src --include='*.ts' | grep -v test`
  prints nothing, so A10 can drop the columns.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/pass-board.test.ts src/device-api.pass.test.ts src/working-order.test.ts`.
- [ ] **Step 3: Implement.** Delete `watcher-board.ts`; nothing else should import it
  (`grep -rn "watcher-board" apps/server/src`). Move the `watcherId` fixtures to `kitchenScreen`.
- [ ] **Step 4: Run; see them pass;** typecheck the server.
- [ ] **Step 5: Commit** — `feat(server): pass screens and monitors show their stations and zones; Done marks belong to the device (A366)`.

---

### Task A8b: The kitchen display's pass levers

**Files:**
- Create: `apps/server/src/device-levers.ts` (the six routes, mounted from `device-api.ts`) and
  `device-levers.test.ts`
- Modify: `apps/server/src/order-groups.ts` (`releaseGroup :437-472`, `fireHeldGroupsOfCourse
  :362-407`, `fireGroup :252-274`, the `sentBy` read `:1095-1111`), `working-order.ts`
  (`fireCourse :1871-1893`), `move-bill.ts` (`:360-384`, only if typing forces it),
  `till-api.profile-actions.test.ts` (six rows, `:86-87`'s neighbours, and a refusing case each),
  `till-api.profile-zones.test.ts` (`:151-153`)
- Test: `device-levers.test.ts`, `order-groups.test.ts`, `till-api.profile-actions.test.ts`

**Interfaces:** a firer is `{ personId: string } | { deviceId: string }`: `releaseGroup`,
`fireHeldGroupsOfCourse`, `fireGroup` and `fireCourse` take it where they take `operatorId` today,
and write `fired_by` or `fired_by_device_id`, and the event's `actor_id` or `actor_device_id`
(decision 19). The session routes pass `{ personId }`, unchanged in behaviour. The `sentBy` read
falls back to the device's label when the group has a device firer.

Routes (device cookie; decision 12): `POST /api/device/orders/:id/courses/:courseId/{fire,ready,away}`
and `POST /api/device/parties/:id/groups/:gid/{fire,ready,away}`, each calling today's verb. The
device must run a pass screen, else `device.unauthorized`; any device other than a kitchen display
also needs a session, and then its person is the firer; `assertProfileAction` checks
`take-orders`, `prepare-orders` or `hand-over-orders` as the session route does; the order's or
party's zone must be within the device's pass zones (decision 24). The group routes take the same
body as the session ones (`submissionId`, `expectedPartyRevision`; `groupCommand`,
`till-api.ts:823-829`), with the device in place of the operator.

- [ ] **Step 1: Failing tests:** a kitchen display's pass fires a course and a group, and the
  group's `fired_by_device_id` is the device, its event's `actor_device_id` too, and its `sentBy`
  is the device's name; Ready and Away move the items as the session routes do; without
  `take-orders` Fire → 403 `device.forbidden_action` (likewise Ready without `prepare-orders`, Away
  without `hand-over-orders`); a station-screen device → `device.unauthorized`; an order in a zone
  outside the pass's zones → `service_zone.not_allowed`; an every-zone pass fires a counter
  order; a till's session fire still records the person. Each new map row has its refusing case.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/device-levers.test.ts src/order-groups.test.ts src/till-api.profile-actions.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; see them pass;** typecheck the server.
- [ ] **Step 5: Commit** — `feat(server): a kitchen display runs the pass, recorded as the device (A366)`.

---

### Task A9: Demo seed, dev setup and remaining fixtures

**Files:**
- Modify: `apps/server/scripts/dev-setup.ts` (`:255-325`, and the printed device list `:462-463`,
  "Pantalla Pase (watcher display)"), `demo-seed/seed.ts` (`:18`, `:74`), `demo-seed/data-set.ts`
  (`watcherName :134`), `demo-seed/data-sets/casa-delgado-es.ts` (`:44`)
- Delete: `demo-seed/seed-watchers.ts`, `seed-watchers.test.ts`
- Test: `demo-seed/seed.test.ts`, `demo-seed/data-set.test.ts` (`watcherName :166`),
  `apps/server/scripts/dev-setup.test.ts`,
  `apps/server/src/configuration-transfer.test.ts` (a profile's kitchen screens round-trip;
  decision 15)

- [ ] **Step 1: Failing tests:** decision 13's three kitchen displays and their kitchen screens;
  the demo's kitchen display profile holds `run-the-pass`, `take-orders` and `hand-over-orders`; no
  watcher seeded; the printed list names "Monitor Pase (pass monitor)"; an export holds a
  profile's kitchen screen rows and an import restores them.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.test.ts scripts/dev-setup.test.ts src/configuration-transfer.test.ts`.
- [ ] **Step 3: Implement.** Then, after checking headroom (`memory_pressure | grep free`), run
  `pnpm --filter @waitron/server test:coverage` in the background and fix fixtures only.
- [ ] **Step 4: Run; see them pass.**
- [ ] **Step 5: Commit** — `test: the demo runs a station screen, a pass screen and a pass monitor (A366)`.

---

### Task A10: Migrations — retire the old bindings (venue reset required)

**Files:**
- Modify: `packages/db/src/schema/devices.ts` (drop `stationId`, `watcherId` and their
  `v8 ignore` pairs), delete `schema/watcher-item-marks.ts` and its exports, `classification.ts`,
  `schema/watchers.test.ts` (the import `:20`, the mark cases `:150-193` and their helper
  `seedTicketAndDevice :78-148`, which writes `devices.stationId` at `:142`; they describe the
  dropped table and column; changed checks); `packages/venue-service/src/schema/service.ts` (drop
  `deviceProfileStations`, `deviceProfileWatchers`, `:219-261`), `classification.ts`,
  `configuration-transfer.ts` (`:557-558`), `migrations.test.ts`, `profile-access.ts` (delete the
  kitchen-list half, `readProfileKitchenLists` to `writeLists`, `:311-529`, and the
  `stationIds`/`watcherIds` of `readProfileServiceAccess :51-90`) and the matching cases of its
  test, `service.ts`, `errors.ts` (`station_in_use`, `watcher_in_use`, `watcher.not_allowed`);
  `packages/module/src/module.ts` (the three old members and the two fields);
  `apps/server/src/management-api.ts` (`GET /management-api/device-profile-kitchen-lists
  :1435` goes with the tables it reads); `apps/server/src/testing/enrol.ts` (`listOnProfile`'s old
  half), `testing/clear-provision-fixture.ts` (`device_profile_stations`, `device_profile_watchers`,
  `watcher_item_marks` leave its list); `apps/dashboard/src/api/live-queries.ts`
  (`device_profile_stations` and `device_profile_watchers` leave `listProfileKitchenLists`
  `:285-291`, so no list names a dropped table before A15 replaces the entry); every remaining
  fixture that sets `stationId` or `watcherId` on a `devices` insert — the typechecks of db,
  venue-service and server name them; at `063fcb5cd` among them `receipt-print.test.ts:1437`,
  `management-api.test.ts:379`, `packages/db/src/schema/devices.test.ts`, `devices.fk.test.ts`,
  `device-profiles.trigger.test.ts`, `packages/venue-service/src/profile-access.test.ts`;
  `scripts/schema-constraints.test.ts` (decision 16), `scripts/migration-upgrade.test.ts`
  (`RESETS`)
- Create: core — a `--custom` migration dropping `device_profile_form_factor_locked`; a generated
  one dropping `watcher_item_marks` and rebuilding `devices`; a `--custom` one re-creating
  `device_profile_form_factor_locked` exactly as `0091_devices_recreate_triggers.sql:5-14` has
  it. venue-service — a generated one dropping the two profile list tables.

The `0089`–`0091` precedent explains the order (`0089_devices_drop_triggers.sql:1-3`): a rebuild
drops the triggers on the table silently, and its rename fails while a trigger on another table
names `devices`. **This rebuild fails on any box with a sign-in or a sale** (Global constraints):
that is this slice's required venue reset.

- [ ] **Step 1: Failing tests:** `packages/db` — `devices` has no `station_id` or `watcher_id`;
  `device_profile_form_factor_locked` still refuses a form factor change under an active device
  (`schema/device-profiles.trigger.test.ts` keeps passing); venue-service `TABLES` without the two
  list tables; `/management-api/device-profile-kitchen-lists` answers 404.
- [ ] **Step 2: Generate** in the order above. Read the rebuild SQL.
- [ ] **Step 3: Run** `pnpm exec vitest run scripts/migration-upgrade.test.ts` and add a `RESETS`
  entry for each step it refuses or that loses rows, naming exactly what it prints, as
  `core/0090_devices_lose_till`'s entry does (`scripts/migration-upgrade.test.ts:384-387`).
- [ ] **Step 4: Run** Step 1's tests, the Task A2 guard list, `scripts/append-only-triggers.test.ts`,
  `scripts/behavioural-triggers.test.ts`, `scripts/apply-migrations-callers.test.ts`,
  `scripts/errors-reachable.test.ts` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`; typecheck db,
  venue-service and server.
- [ ] **Step 5: Commit** — `feat(db): devices lose their station and watcher columns (A366) — venue reset required`.
  The message lists every table with a key into `devices` and its `ON DELETE` (rescan
  `packages/*/drizzle/*.sql` for `` REFERENCES `devices` ``), and says that the rebuild refuses on
  any box holding a row in a `restrict` or `no action` child — any box with a sign-in or a sale —
  and deletes the rows of the `cascade` children, so every box needs a venue reset.

---

### Task A11: The till boots a kitchen display on its kitchen screen

**Files:**
- Modify: `apps/till/src/api/client.ts` (`DeviceIdentity :1362-1372` gains `kitchenScreens`, loses
  `stationId` and `watcherId`; `DevDevice :1453-1459` loses `stationId`, as `/api/dev/devices` did
  in A8), `till-app.ts` (boot `:2310-2322`: a kitchen display whose one kitchen screen is a station
  screen reads the station screen, a pass screen the pass screen, a pass monitor the monitor; none,
  or one no longer offered, shows the sentences below), `i18n/strings.ts`
- Test: `till-app-boot-and-counter.test.ts`, `till-app.test.ts`, `api/client.test.ts`

**Behaviour:** a kitchen display with no kitchen screen shows "This screen has nothing to show yet.
Ask a manager to choose a screen for it in Devices." / "Esta pantalla aún no tiene nada que
mostrar. Pide a un responsable que le elija una pantalla en Dispositivos." and no queue. One whose
kind its profile no longer offers shows "This screen is no longer available: Pass screen" / "Esta
pantalla ya no está disponible: Pantalla del pase" (decision 8), and no queue.

- [ ] Steps: failing tests (boot picks the screen by kind; the two sentences; axe in both themes);
  watch them fail (`pnpm --filter @waitron/till exec vitest run src/till-app-boot-and-counter.test.ts src/till-app.test.ts`);
  implement; pass; commit `feat(till): a kitchen display boots on its kitchen screen (A366)`.

---

### Task A12a: The kitchen display's station screen — stacked, and what is no longer available

**Files:**
- Modify: `apps/till/src/api/client.ts` (`DeviceStation :1440` → `DeviceStationScreen`;
  `getDeviceStation :2560` → `getDeviceStationScreen`), `screens/till-station-screen.ts` (device
  mode: `#loadDevice :284-304`, `#adoptDeviceStation :312-318`, `#renderDevice :518-520`; advance
  and acknowledge keep their device verbs), `till-app.ts` (the `DeviceStation` import `:175`,
  `initialDeviceStation :1613`, `getDeviceStation` at boot `:2317`), `widgets/card-grid.ts`
  (the `DeviceStation` import `:24`, `kds-board :394`), `i18n/strings.ts`; the till test suites
  whose API stubs name `getDeviceStation` (`grep -rln getDeviceStation apps/till/src`)
- Test: `till-station-screen.test.ts`, `.a11y.test.ts`, `api/client.test.ts`

**Behaviour:** decision 7's stacked view — one section per station, each headed by its name, with
its own queue, notices and printers-down line, in the order the server sends; one station renders
as today. Above the sections, one line per unavailable station: "This station is no longer
available: Deli" / "Esta estación ya no está disponible: Deli"; with no stations left, only those
lines.

- [ ] Steps: failing tests (two stations render two sections with their own items; bumping in the
  second section calls `deviceAdvance` for that item; a dropped station shows its line; nothing
  left shows only the line; axe in both themes); watch them fail
  (`pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts src/screens/till-station-screen.a11y.test.ts`);
  implement; pass; look at a two-station display at 1280 and 390 in both themes; commit
  `feat(till): a kitchen display's station screen shows each of its stations (A366)`.

---

### Task A12b: The kitchen display's station screen — merged view and the switch

**Files:**
- Modify: `apps/till/src/screens/till-station-screen.ts` (device mode), `widgets/station-queue.ts`
  (an optional station label on each dish), `i18n/strings.ts`
- Test: `till-station-screen.test.ts`, `.a11y.test.ts`, `widgets/station-queue.test.ts`

**Behaviour:** decision 7's merged view and switch: with two or more stations, a switch "Stacked" /
"Merged" ("Por estación" / "Todo junto") beside the existing view toggle; Merged shows one queue,
oldest first, each dish labelled with its station's name, and the stations' notices and
printers-down lines above it, each naming its station. It opens Stacked; the choice is remembered
in local storage under a key holding the device id (read wrapped, as
`till-lock-screen.ts:216-221` wraps its read) and restored on the next load. One station shows no
switch.

- [ ] Steps: failing tests (the switch appears with two stations and not with one; Merged shows
  one queue with labels; bumping in Merged advances that item; the choice survives a reload and is
  per device id; a local storage that throws leaves it Stacked; axe in both themes for both views);
  watch them fail (`pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts src/widgets/station-queue.test.ts`);
  implement; pass; look at both views at 1280 and 390 in both themes, EN and ES; commit
  `feat(till): a kitchen display's station screen can merge its stations into one queue (A366)`.

---

### Task A12c: The till's Station screen follows its device's choice

**Files:**
- Modify: `apps/till/src/screens/till-station-screen.ts` (operator mode: `#load :267-278`,
  `#restoreStation :196-207`, `#body`, `#pick :629-640`), `i18n/strings.ts`
- Test: `till-station-screen.test.ts`

**Behaviour:** decision 20. In operator mode the screen reads the device's kitchen screens
(`getDeviceIdentity`, which Task A11 widened) with the station list when it loads. With a station
screen choice, the picker lists only the chosen stations that are still available, the default
falls back to the first of them, and each unavailable one has its "no longer available" line; with
no choice it lists every station, as today.

- [ ] Steps: failing tests (a till that chose Grill and Fryer shows two picks; a dropped Fryer shows
  its line and one pick; no choice shows every station; an address naming a station outside the
  choice opens the first chosen one); watch them fail
  (`pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts`);
  implement; pass; look at 1280 and 390, both themes; commit
  `feat(till): a till's Station screen shows the stations its device chose (A366)`.

---

### Task A13: The till's Pass screen follows "Run the pass" and the device's choice

**Files:**
- Modify: `apps/till/src/screens/till-expo-screen.ts` (`#loadWatchers :508-515`,
  `#restoreSelection :517-529`, `#select :531-549`, `#reload :564-594`, the chooser markup
  `:717-747`, `#runsPass :975-977`, the lever guards `:870`, `:1034`, `#done` and `#undo
  :609-648`), `navigation.ts` (`"till-watcher" :11`), `till-app.ts` (`:2122`, `:2161`, `:2450`,
  `:8267`, `:8278`; pass `.runsPass=${this.capabilities.includes("run-the-pass")}` to every
  `till-expo-screen` a till draws, `:8616-8620`), `widgets/card-grid.ts` (`expo` case `:388-393`),
  `api/client.ts` (`listWatchers`, `getWatcherQueue`, `markWatcherDone`, `:2694-2709`;
  `WatcherSummary :1560` stays, because `WatcherBoard :1575-1576` and `till-expo-screen.ts:23`,
  `:26` still use it until A14; new `getDevicePassScreen`, `markDevicePassDone`), `i18n/strings.ts`
- Test: `till-expo-screen.test.ts`, `.a11y.test.ts`, `till-app.test.ts`,
  `widgets/card-grid.test.ts`

**Behaviour:** at a till the Pass screen has no chooser and no `till-watcher` in the address (an
old address carrying it is ignored). With a pass screen choice (from the device's identity) it
reads `getDevicePassScreen` and shows Done and Undo on each dish, keeping dishes until Done, with
the "no longer available" lines; without one it reads `getExpoQueue` as today's "All stations"
does. Fire, Ready and Away show only when `runsPass` is true (decision 3). The order screen's and
station screen's Fire are unchanged (Review focus 7). The embedded `expo` card stays on
`getExpoQueue`.

- [ ] Steps: failing tests (no chooser at a till; levers absent without `runsPass` and present with
  it; a till with a pass choice marks Done through `markDevicePassDone` and its Undo reverses it;
  a till without one reads the expo queue and shows no Done; the order screen still offers Fire on
  a profile without `run-the-pass`; axe in both themes); watch them fail
  (`pnpm --filter @waitron/till exec vitest run src/screens/till-expo-screen.test.ts src/till-app.test.ts`);
  implement; pass; look in both themes at 1280 and 390; commit
  `feat(till): the Pass screen follows its device's choice and the profile's "Run the pass" (A366)`.

---

### Task A14: The kitchen display's pass screen, with its levers

**Files:**
- Modify: `apps/till/src/api/client.ts` (`WatcherSummary :1560`, `WatcherBoard :1575`,
  `getDeviceWatcher`, `markDeviceWatcherDone`, `:2564-2569` → `PassScreen`; new device lever
  methods; the screen's imports `till-expo-screen.ts:23-26`), `screens/till-expo-screen.ts`
  (device mode: `connectedCallback :484-496`, `#reload`'s device read, `#isWatcher :774` →
  whether the board keeps dishes until Done, the lever guards `:870`, `:1034` call the device
  lever methods in device mode, `#done` and `#undo :609-648`), `till-app.ts` (the `WatcherBoard`
  import `:176`, `initialDeviceWatcher :1614`, `:2316`, `:8494`, `:8600-8606`; pass `runsPass`
  from the profile's capabilities to the device-mode screen), `widgets/card-grid.ts` (the
  `WatcherBoard` import `:25`, `kds-board :394-411`), the till test suites whose API stubs name
  `getDeviceWatcher` or `markDeviceWatcherDone`, `widgets/profile-dialog.ts` (`:19`, decision
  11's codes), `i18n/codes.ts`
- Test: `till-expo-screen.test.ts`, `.a11y.test.ts`, `widgets/card-grid.test.ts`,
  `widgets/profile-dialog.test.ts`, `i18n/codes.test.ts`

**Behaviour:** on a kitchen display with a pass screen the board is the device's
(`getDevicePassScreen`), with Done and Undo on each dish, the "no longer available" lines, and,
when its profile has "Run the pass", Fire (fire control `expo`), Ready and Away through the device
lever routes; a refusal shows its code's sentence. Its title is the device's name. Reprint stays
off in device mode (`till-expo-screen.ts:812`).

- [ ] Steps: failing tests (a pass screen's Done calls `markDevicePassDone` and Undo reverses it;
  levers present with `runsPass` and absent without; Fire calls the device route; a
  `device.forbidden_action` answer shows its sentence; the title; axe in both themes); watch them
  fail (`pnpm --filter @waitron/till exec vitest run src/screens/till-expo-screen.test.ts src/widgets/card-grid.test.ts src/widgets/profile-dialog.test.ts`);
  implement; pass; look in both themes at 1280 and 390; commit
  `feat(till): a kitchen display runs the pass (A366)`.

---

### Task A14b: The kitchen display's pass monitor

**Files:**
- Create: `apps/till/src/screens/till-pass-monitor-screen.ts`, its `.test.ts` and `.a11y.test.ts`
- Modify: `apps/till/src/api/client.ts` (`getDevicePassMonitor`), `till-app.ts` (the `station`
  case `:8599-8614` draws the monitor for a pass monitor), `i18n/strings.ts`

**Behaviour:** decision 17. A full-screen pass queue — the till's pass cards, read-only — titled
with the device's name, refreshed as the pass screen refreshes, with the "no longer available"
lines. No button of any kind: no Done, no levers, no reprint, no view toggle. Built from
`till-expo-screen`'s card markup with every action left out, or as that screen in a
`monitor` mode if that is smaller; either way a test asserts the screen contains no `button` and
no `wt-button`.

- [ ] Steps: failing tests (the monitor lists the read's orders; it contains no button; a dropped
  zone shows its line; a stale read shows the stale line; axe in both themes); watch them fail
  (`pnpm --filter @waitron/till exec vitest run src/screens/till-pass-monitor-screen.test.ts`);
  implement; pass; look at 1280 and 390, both themes, EN and ES; commit
  `feat(till): a pass monitor shows the pass queue with no buttons (A366)`.

---

### Task A15: Dashboard — the profile editor's kitchen screens

**Files:**
- Modify: `apps/dashboard/src/screens/device-profiles-screen.ts` (`KITCHEN_LISTS :163-187`,
  `FIELDS :238-257`, `FIELD_TARGET :261-278`, `FIELD_BY_PARAM :282-299`, `#shownFields :719-732`,
  `#registerDraft :550-584`, `#onKitchenToggle :1187`, `#kitchenListsToSend :1206-1217`,
  `#duplicate :1418`, `#kitchenChoices :1758`, `#renderKitchenLists :1781`),
  `apps/dashboard/src/screens/devices-screen.ts` (its `listProfileKitchenLists` watch `:617` moves
  to `listProfileKitchenScreens`, with the binding options it feeds read from kitchen screens until
  A16 rewrites them), `apps/dashboard/src/api/client.ts` (`ProfileKitchenLists :757-761`,
  `listProfileKitchenLists :2949` → `ProfileKitchenScreens`, `listProfileKitchenScreens`; the PUT's
  answer gains `narrowedDevices`), `apps/dashboard/src/api/live-queries.ts`
  (`listProfileKitchenLists :283-291` → `listProfileKitchenScreens` over `device_profiles`, the
  three profile kitchen screen tables, `kitchen_stations`, `floor_zones`), `i18n/strings.ts`,
  `i18n/codes.ts` (decision 11)
- Test: `device-profiles-screen.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`,
  `.save-state.test.ts`; and every devices-screen suite that mocks `listProfileKitchenLists`:
  `devices-screen.test.ts` (`:285`, `:1640`, `:3986`, `:4700`), `device-pair.unsaved.test.ts:135`,
  `device-edit.unsaved.test.ts:101`, `devices-screen.a11y.test.ts:222`, `:657`,
  `devices-screen.save-state.test.ts:199`; `scripts/live-subscriptions.test.ts`,
  `scripts/native-form-fields.test.ts` and `scripts/style-token-names.test.ts` must pass

**Behaviour:** for a kitchen display profile, the editor shows "Station screen", "Pass screen" and
"Pass monitor" switches; under each one switched on, "Every station" or one switch per station,
and under the pass screen and the pass monitor "Every zone" or one switch per zone. For a till or
handheld profile, under the Screens group's "Kitchen" and "Pass" switches (`show-station`,
`show-expo`), when on, the same lists, read "Every station" when the profile has no row. A
switched-off entry a list already holds is shown marked, as `#kitchenChoices` marks them today.
A refusal lands under the list its `field` names. An edit sends `kitchenScreens` only when they
changed, as `#kitchenListsToSend` sends the lists today. After a save whose answer names devices,
a status line lists them, for example "Saved. Pantalla Pase no longer shows Deli." / "Guardado.
Pantalla Pase ya no muestra Deli." (decision 8). Duplicate copies the kitchen screens with only
their switched-on stations and zones, as it copies the lists today (`#duplicate`); a kind whose
explicit list would be left empty is not copied. Save rule: the kitchen screens are part of the
editor's draft; Save stays quiet until they change and quiet again when the change is undone;
leaving with a changed list asks; #1422's reconnect case.

- [ ] Steps: failing tests per behaviour, including the save-state, reconnect and narrowed-devices
  cases; watch them fail (`pnpm --filter @waitron/dashboard exec vitest run src/screens/device-profiles-screen.test.ts src/screens/device-profiles-screen.unsaved.test.ts src/screens/device-profiles-screen.save-state.test.ts`);
  implement; pass; look in both themes at 1280 and 390, EN and ES; commit
  `feat(dashboard): a profile lists the kitchen screens its devices may run (A366)`.

---

### Task A16: Dashboard — the device's kitchen screens

**Files:**
- Modify: `apps/dashboard/src/screens/devices-screen.ts` (the "Shows" binding: `PairField :61`,
  `FIELD_BY_CODE :108-116` and `FIELD_BY_PARAM :118-128`, `binding`/`bindingIds` `:174-205`,
  `#activeBinding :1055-1068`, `#bindingName :1011`, the edit draft `#registerEditDraft :551-579`,
  `#renderPairDialog :1924`), `apps/dashboard/src/api/client.ts` (`DeviceRow :640`,
  `ReturningDetails :788-794`, `acceptDeviceJoinRequest`'s body `:2890-2896`, `updateDevice`'s
  body `:3013-3019`), `api/live-queries.ts` (`listDevices :292-307`: drop `watchers`, add the three
  device kitchen screen tables), `i18n/strings.ts`, `i18n/codes.ts`
- Test: `devices-screen.test.ts`, `.a11y.test.ts`, `.save-state.test.ts`,
  `device-edit.unsaved.test.ts`, `device-pair.unsaved.test.ts`;
  `scripts/live-subscriptions.test.ts`, `scripts/native-form-fields.test.ts`

**Behaviour:** Pair and Edit. For a kitchen display: "Screen" (a `wt-combobox` of the kinds the
profile offers), then "Every station" or station switches within the profile's list, and for a
pass screen or pass monitor "Every zone" or zone switches. For a till or handheld: "Kitchen screen
shows" and "Pass screen shows", each optional ("Every station the profile allows" when not set),
offered when the profile shows that screen. Changing the profile clears a choice the new profile
does not offer (as the binding is cleared today, `devices-screen.ts:1176-1182`). In Edit, a stored
station or zone that is no longer available is listed marked "No longer available" ("Ya no está
disponible"), switched off and not editable, and is not part of the draft: opening the dialog does
not make it changed, and Save sends only what is still available (decision 8). The device list
reads "Station screen: Grill, Fryer" / "Pass screen: every station · Terrace" / "Pass monitor:
every station · every zone", with "(Deli no longer available)" after a list that lost one. Save
rule: the kitchen screens are part of both drafts; Edit stays quiet until they change; Pair keeps
`savableAtOpen`; leaving with a changed choice asks; #1422's reconnect case in both
`*.unsaved.test.ts`.

- [ ] Steps: failing tests per behaviour; watch them fail
  (`pnpm --filter @waitron/dashboard exec vitest run src/screens/devices-screen.test.ts src/screens/devices-screen.save-state.test.ts src/screens/device-edit.unsaved.test.ts src/screens/device-pair.unsaved.test.ts`);
  implement; pass; look in both themes at 1280 and 390, EN and ES; commit
  `feat(dashboard): a device chooses its kitchen screens (A366)`.

---

### Task A17: The Prep stations read-out, and the "New watcher" button leaves

**Files:**
- Modify: `packages/venue-service/src/dashboard/prep-stations-screen.ts` (the Tickets tab's
  "Screens" `:1995-2011`, or slice 4's "Shown on" if it has landed; the Watchers tab's "Screens"
  column `:2765-2781` goes; the tab row's "New watcher" button `:3450-3457`; the action area's cap
  and its comment `:112-115`), `dashboard/watcher-form.ts` (its new mode), `routing-client.ts`
  (`devices :70-77`: `kitchenScreens` in place of `stationId`/`watcherId`),
  `dashboard/live-queries.ts` (`routing :17-41`: add the three device kitchen screen tables),
  `dashboard/strings.ts` (`watchers.new` `:68`, `:741`, if nothing else reads it)
- Test: `prep-stations-screen.test.ts` (the cases that open the form through the button, `:195`,
  `:226`, `:2675-2677`, `:5177`, `:5228`, seed a watcher through the mocked API and open it with
  Edit instead; the creation cases are deleted with the behaviour — changed checks),
  `watcher-form.unsaved.test.ts` (`:146-151`, likewise), `dashboard/live-queries.test.ts`;
  `scripts/live-subscriptions.test.ts`

**Behaviour:** the read-out lists the devices whose choice covers the station, of any kind and form
factor, an "every station" choice covering all (decision 25), each with its kind ("Pantalla Cocina
— station screen"). The tab row's actions hold "New station" only (decision 22).

- [ ] Steps: failing tests (a station screen on Grill, a pass screen on every station and a till
  that chose Grill all appear on Grill's row; a till with no choice does not; there is no
  `[data-test="new-watcher"]`; an existing watcher still opens and saves from the Watchers tab);
  watch them fail
  (`pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/prep-stations-screen.test.ts src/dashboard/watcher-form.unsaved.test.ts`);
  implement; pass. **Look at the Prep stations tab row in Spanish at 390 px wide, in both themes:**
  every tab and the "Nueva estación" button must show whole. Try it without the 50% cap first; keep
  the cap only if the look needs it. The pull request says what was looked at and what it showed.
  Commit `feat(venue-service): stations name the devices that show them; watchers can no longer be added (A366)`.

---

### Task A18: Documentation and backlog

**Files:** `docs/developers/conventions-ui.md` (`:258-262`, which describes the station and watcher
lists and the in-use refusals), `docs/developers/design-system.md` (any line naming the device's
"Shows" choice or the profile's station and watcher lists:
`grep -n "watcher list\|Shows" docs/developers/design-system.md`), `docs/backlog.md` and
`docs/backlog/service-periods.md` (A366: slice 5 Part A built; Part B waits for slice 4)

- [ ] Read every claim about kitchen displays, watchers on devices, Done marks and a kitchen
  display's actions across `docs/developers/` (CLAUDE.md §1: a behaviour change retires every
  receipt about the old one), correct each, and commit `docs: devices run kitchen screens and monitors (A366)`.

Then run `/finish-branch` with this worktree and this plan. Pull request's first line: **"venue
reset needed — required: the migration refuses on any box with a sign-in or a sale, and the box
will not start until it is reset"**. Its description also says: the no-screen tests (Task A7) and
that nothing in this slice turns "no screen" into a warning; the Prep stations tab row look (Task
A17); and that between this pull request and slice 4 no new watcher can be added (decision 22).

---

## Part B — watchers retired (second pull request, after slice 4)

These tasks are outlined from today's code. **Slice 4 changes the same printing files**, so before
writing tests, re-ground each one: `grep -rn "watcher\|Watcher" apps/server/src packages/printing/src packages/venue-service/src apps/dashboard/src --include='*.ts' | grep -v test`
and `grep -rn "makes_and_watches" apps packages --include='*.ts'`. If slice 4's combined tickets
are not on `main`, or a pass ticket today still comes only from a watcher printer, STOP and ask.
After Part A no screen shows a watcher and none can be added (decision 22); what is left is the
venue's existing watchers as printer settings.

### Task B1: Kitchen printing without watchers

**Files (today):** `apps/server/src/kitchen-print.ts` (`WatcherCopies :106`, `readWatcherPrinters
:115-140`, the watcher block of `planKitchenTickets :465` at `:475-494` and `:605-688`, the
`watchers` option of `enqueueKitchenTickets :712`, `enqueueWatcherCopies :733`,
`WatcherSlipRule :1034-1095`, `:1140`, `:1256`, `:1311`, `:1466-1471`),
`kitchen-ticket.ts` (`scope: "watcher" :61-62`, `:199`), `working-order.ts` (`:1996-2007`),
`station-move.ts` (`:326-332`); tests `kitchen-print.watchers.test.ts` (deleted; what it proved is
slice 4's combined tickets' job — confirm slice 4 has a test for a printer shared by several
stations printing one ticket per send before deleting it), `station-move.test.ts`,
`split-off-extras.send.test.ts`.

- [ ] Failing test: a send with a dish at each of two stations that share a printer prints the
  combined ticket slice 4 built, and no second copy. Implement by deleting the watcher paths.
  Commit `feat(server): kitchen tickets no longer print watcher copies (A366)`.

### Task B2: Watcher configuration removed

**Files (today):** `apps/server/src/watchers.ts` and `watchers.test.ts` (deleted),
`management-api.ts` (`:130-138`, `:305-306`, `:354-375`, `:1885-1939`), `print-api.ts` (`:79`,
`:117`, `:993-1020`), `station-printers.ts` (`:39-44`, unless slice 4 removed it),
`kitchen-print.ts` (`:49-50`), `errors.ts` (`watcher.*`, `printer.makes_and_watches`),
`in-use-references.test.ts`; `packages/printing/src/printers.ts` (`:116`, `:187-195`);
`packages/venue-service/src/operations.ts` (`:320`), `dashboard/prep-stations-screen.ts`
(`PREP_TABS :78` and the Watchers tab, unless slice 4 removed it), `dashboard/watcher-form.ts`,
`dashboard/watchers-seen.ts` (deleted), `dashboard/routing-client.ts` (`:6`, `:68`, `:74`,
`:78-96`), `dashboard/live-queries.ts` (`:29-32`), `dashboard/strings.ts`;
`apps/dashboard/src/api/client.ts` (`Watcher :615`, `listWatchers :2734`, `setPrinterWatcher
:3118`), `api/live-queries.ts` (`:61`, `:309`), `screens/printers-screen.ts` (`:1380`),
`i18n/codes.ts`.

- [ ] Failing tests: `/management-api/watchers` and `/management-api/printers/:id/watcher` answer
  404; the Prep stations screen has no Watchers tab and an old `view=watchers` address opens
  Stations (as an unknown view does, `prep-stations-screen.ts:293-299`). Implement; commit
  `feat: watchers are removed from configuration (A366)`.

### Task B3: Migration — drop the watcher tables (venue reset)

**Files (today):** `packages/db/src/schema/watchers.ts` and `watchers.test.ts` (deleted),
`schema/index.ts`, `index.ts` (`:127`), `classification.ts` (`:103-106`),
`configuration-transfer.ts` (`:41-43`, `:61`); one generated migration dropping
`watcher_printers`, `watcher_zones`, `watcher_stations`, `watchers`;
`scripts/schema-constraints.test.ts` (`:248-254`, `:399`); `scripts/migration-upgrade.test.ts`
(`RESETS`); `apps/server/src/configuration-transfer.test.ts` (`:1735-1740`);
`apps/server/scripts/demo-seed/` (anything left naming watchers); `docs/developers/design-system.md`
and `products.md` (the lines listed in section 1); `docs/backlog.md` (slice 5 built).

- [ ] Failing test: the four tables are gone and an export no longer names them. Generate; run the
  Task A2 and A10 guard lists; add `RESETS` entries naming what the walk prints; commit
  `feat(db): watchers are retired (A366) — venue reset needed`. Then `/finish-branch`; the pull
  request's first line: **"venue reset needed"**, with the reason the walk printed.

---

## New decisions this revision made

Each is a default the owner may override; the decision it sits in has the detail.

- **17.** Only a kitchen display may run a pass monitor; it shows the till's "All stations" pass
  read narrowed to its stations and zones, so fully-away courses drop off.
- **18.** A kitchen display's sign-in with a long idle logout is a backlog entry, not this slice
  (it needs a sign-in route, a lock screen and an admission list for kitchen displays; the
  30-minute timeout is then the existing profile setting).
- **19.** A kitchen display's Fire records the device: `order_groups.fired_by_device_id`, and
  `order_group_events` gains `actor_device_id` with `actor_id` nullable (a rebuild of an
  append-only audit table, allowed by the venue reset); "sent by" shows the device's name.
  Override: no Fire on a kitchen display until it can sign in.
- **20.** A till's or handheld's choice is optional: with none, its Station and Pass screens work
  as today; with a pass choice its Pass screen keeps dishes until Done; the Station screen keeps
  its picker; a till never counts as a station's screen; its session routes do not refuse dishes
  outside its choice.
- **21.** The device keeps its stored choice and every read works out what is no longer available
  (no extra storage); a station or zone switched off since it was chosen also reads "no longer
  available"; a profile switch is never refused for the choice.
- **6 (refinement).** A device's "Every station" means every station its profile allows, so it
  follows the profile and may be chosen under an explicit profile list.
- **22.** The "New watcher" button (and the form's new mode) leaves in Part A; between Part A and
  slice 4 no new watcher printer can be set up.
- **23.** A kitchen display profile may also hold `take-orders` and `hand-over-orders`, which only
  its pass levers check; new venues' kitchen display profile keeps `prepare-orders` only.
- **13 (additions).** The demo's monitor is named "Monitor Pase" and shows every station and zone;
  the demo's kitchen display profile gets "Run the pass", take orders and hand over so Pantalla
  Pase shows its levers.
- **24.** A kitchen display's lever checks the order's zone against its pass zones, not its
  stations; Fire, Ready and Away act on the whole course or group.
- **25.** The Prep stations read-out lists every device whose choice covers the station, tills
  included; a device with no choice is not listed.
- **Wording.** "Station screen" / "Pantalla de estación", "Pass screen" / "Pantalla del pase",
  "Pass monitor" / "Monitor del pase"; "Stacked" / "Por estación" and "Merged" / "Todo junto" for
  decision 7's switch; the "no longer available" sentences in decision 8.
