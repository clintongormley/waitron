# Kitchen screens and monitors, slice 5 — implementation plan (A366)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation.
>
> **Existing assertions.** The campaign queue's owner decision of 2026-10-05 governs: a check that
> pins behaviour this plan removes (listed under "Behaviour this slice removes") is changed to check
> the new behaviour at least as strictly, and listed in the pull request's "Changed test checks"
> section with `file:line`, before and after. The checks this plan already knows it changes are
> listed under "Changed test checks (planned)". Anything else is a STOP. The guard rows this plan
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
> `063fcb5cd41181abcbb3a5671da9b83566eb8622`, after slice 1 landed as `685a6074b` (#1460); revised
> again the same day to a fresh-context review's findings.** Every `file:line` below holds at
> `063fcb5cd`: a line in a file unchanged since `1f95b0c44` (`git diff --numstat 1f95b0c44
> 063fcb5cd -- <file>` prints nothing) keeps the first version's reading; every cited line in a
> changed file was mapped with `git diff -U0 1f95b0c44 063fcb5cd` and re-read; every line new to
> these revisions was read at `063fcb5cd`. **Revised again 2026-10-09 to the owner's answers of
> that morning** (decisions 17, 21, 23, 24 and 26, and a question asked during the build about a
> switched-off station's waiting dishes; summary under "Owner answers of 2026-10-09"). By then Part
> A was built through Task A14b on `feat/service-periods-slice-5-monitors`, so each task the
> answers touch carries an **"AS BUILT → CHANGE"** note: what the branch does, and the test-first
> change it must make. Lines new to this revision cite `main` at `974f7170e` unless they name the
> branch. What the re-grounding found: of the fifteen files the
> first version listed as shared with slice 1, `git diff 79bffeca9 685a6074b -- <those files>`
> changes only `apps/server/src/working-order.ts` (a quantity-raise marker removed, around
> `:394-491` and `:4809-4831`, lines this plan does not cite) and `apps/till/src/till-app.ts` (an
> icon and two comments). Other commits on `main` since `1f95b0c44` moved cited lines in the
> dashboard and till API clients, screens and tests, `till-app.ts`, `till-api.ts`,
> `working-order.ts`, venue-service's `errors.ts` and transfer list, two guard suites and two
> developer docs. One citation was off by one at the old base too (`#adoptDeviceStation`, now
> `till-station-screen.ts:312`).

**Goal:** any device can run a kitchen **working screen** — a station screen or a pass screen,
each with its buttons — within the stations and zones its profile allows; a kitchen display runs
exactly one, or a view-only **monitor**. Watchers go: first as something a screen shows (Part A),
then as something a printer follows (Part B, after slice 4's combined tickets replace them).

**Architecture:** the choices live in venue-service, beside the profile's department and zone
access (`packages/venue-service/src/profile-access.ts`): three tables say which kitchen screens a
profile offers and with which stations and zones, three say which ones a device chose, and one
records, per device, what a profile narrowing took away. A profile save that narrows rewrites each
affected device's choice and records what it lost, so the device can name it. The server stops
reading `devices.station_id` and `devices.watcher_id`. Done marks move from the watcher to the
device, with the signed-in person when there is one (`pass_item_marks`, core). A kitchen display's
pass gets device-cookie lever routes, and its Fire records the device. Once nothing reads them, the
device binding triggers go, `devices` is rebuilt without its two binding columns, and the profile's
station and watcher lists are dropped. Part B removes watchers' printers and configuration.

**Tech stack:** TypeScript, drizzle on SQLite (`node:sqlite`), Hono, Lit, Vitest (node and real
Chromium browser projects).

**Spec:** [Service times, departments, zones and prep stations](../specs/2026-10-07-service-times-departments-and-stations-design.md)
§3 (Kitchen display, kitchen screens, Monitor), §9.4 (revised 2026-10-08 to this plan's owner
answers), §12 (watchers and the Watchers tab), §13 item 5, §15 items 2 and 3; §8 and §9.3 for what
Part B waits on. Backlog: A366.

**Risk path:** FULL ceremony with two run-it reviews: migrations (a `devices` rebuild, and rebuilds
of `order_groups` and of the append-only `order_group_events`), a changed cross-package contract
(`VenueServiceContribution`, `packages/module/src/module.ts`), what a device's profile allows (new
device routes that fire, ready and send away), and an audit table (`order_group_events`).

**Venue reset: required, not optional.** Part A's `devices` rebuild fails on any box that has ever
had a sign-in, a sale, a payment or a fiscal record (Task A10b says why), so that box would not
start until it is reset. Each pull request's first line reads: **"venue reset needed — required:
the migration refuses on any box with a sign-in or a sale, and the box will not start until it is
reset"** (Part B's first line keeps "venue reset needed" and gives its own reason).

---

## Words this plan uses

Plain meanings first; the code names follow.

- **Kitchen display** — a device whose profile has the `kds` form factor: a screen on a kitchen or
  pass wall. Nobody signs in on one today: the server refuses its sign-in (`refuseKitchenSignIn`,
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
    for example a wall screen showing the pass queue. Any device whose profile offers it: a
    kitchen display runs it as its one screen, a till or handheld shows it as its Pass screen
    (decision 17, owner 2026-10-09).
- **Working screen** — a station screen or a pass screen: it has buttons.
- **Monitor** — a view-only screen. The pass monitor is the only one this slice builds; the spec's
  floor plan and sales monitors (§14) are later work.
- **Run the pass** — a profile setting (`run-the-pass`) that shows Fire, Ready and Away on a pass
  screen (decision 3).
- **No longer available** — a station, zone or kitchen screen a device showed that a profile
  narrowing took from it (recorded), or a station or zone switched off since (worked out on read)
  (decision 21). On a kitchen display's station screen, a station switched off on its own page
  keeps showing the dishes still waiting there, below the line, until they are done (owner
  2026-10-09).

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
| — | `device_kitchen_screen_removals` | decision 21 |
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

- `packages/layouts/src/canvas.ts`, `device-profile.ts`, `canvas.test.ts`, `device-profile.test.ts`,
  `device-profile-store.db.test.ts`
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
  `till-api.profile-zones.test.ts`, `management-api.device-profiles.test.ts`, and the tests listed
  in each task
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
- `docs/developers/conventions-ui.md` (`:246-249`, `:258-262`), `docs/developers/design-system.md`,
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

Landed: #1470 (slice 2) and #1469 (slice 3), 2026-10-09; Part A rebased onto both.

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

Landed: #1470 (slice 2) and #1469 (slice 3), 2026-10-09; Part A rebased onto both.

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
  `hand-over-orders`, and the default one new venues get holds both (decision 23, owner
  2026-10-09), which slice 3's kitchen display route does not check, and
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
accepted, an owner answer of 2026-10-09 (marked **"(owner 2026-10-09)"**), or **NEW** — a default
a revision had to choose, which the owner may override. Every NEW one is also listed under "New
decisions this revision made" at the end.

### Owner answers of 2026-10-09

Given in the campaign watcher's session, about 09:20–09:40, to the build's question of 02:25 and to
the new decisions 17–26 (source: the campaign questions file, "2026-10-09 ~09:20 — OWNER ANSWERS
… to A366-5A", and the 02:25 question above it). Decisions 19, 20, 22, 25 and 13's additions keep their
defaults.

| Answer | What changes | Tasks with an "AS BUILT → CHANGE" note | Tasks not yet built whose text changed |
| --- | --- | --- | --- |
| 02:25 question → "b" | A station switched off on its own page keeps showing the dishes still waiting there on a kitchen display's station screen, under its "no longer available" line, until they are done; its dishes can still be started, readied and finished (decision 21, "Switched off elsewhere") | A3b, A7, A12a, A12b | — |
| 17 overridden | Any profile may offer the pass monitor; it shows the till's "All stations" pass board limited to the stations and zones chosen within the profile's | A3a, A3b, A5a, A6, A8a, A13 | A15, A16 |
| 21 overridden | A narrowing still records what each device lost and shows the line; adding the station back gives it back to a device still showing that line, and not to one where someone has picked since | A3c, A5b | A15, A16 |
| 23 overridden | The default kitchen display profile new venues get holds `take-orders` and `hand-over-orders` | A1, A9 | — |
| 24 clarified | Counter orders are judged by the zone they were rung up in, which is what `main` already does; only an order that never recorded a zone is zone-less | A8a, A8c | — |
| 26 dropped | Changing a profile's form factor keeps its pass monitor; nothing is refused | A3a, A6 | A15 |

1. **Two pull requests (owner 2026-10-08 answer 1).** Departs from §13 ("each slice is its own plan
   and pull request, in this order"). Part A (Tasks A1–A18) is its own pull request, buildable now
   that slice 1 has landed; Part B (Tasks B1–B3) is a second pull request after slice 4 lands.
   Why: until slice 4's combined tickets exist, a watcher printer is the only way one printer gets
   one ticket for several stations (`kitchen-print.ts:115`, `:465`, `:605`), so watcher printers
   cannot go before slice 4. Between the two pull requests a watcher is a printer setting only: the
   Watchers tab keeps editing the venue's existing watchers for their printers, its "Runs the
   pass" cell stays but nothing reads it (decision 3 moves that job to the profile), and the
   dashboard can no longer add one (decision 22).
2. **Any device can run a working screen (owner 2026-10-08 answer 2).** A profile of any form
   factor may offer a station screen, a pass screen and a pass monitor, each with its stations
   (and, for the pass screen and the monitor, zones) (decision 17, owner 2026-10-09).
   - **A kitchen display runs exactly one kitchen screen** — station screen, pass screen or pass
     monitor — and must have one when it is accepted or edited (`kitchen_screen.required`). Its
     profile's rows are the screens it may choose; a kind with no row is not offered.
   - **A till or handheld may choose a station screen, a pass screen or a pass monitor, or none;
     the choice narrows its Station and Pass screens.** Its profile's rows bound what its devices
     may choose; a station or pass screen kind with no row bounds nothing (every station, every
     zone), while a pass monitor is offered only by a profile row, as on a kitchen display (**NEW,
     2026-10-09 revision**: a monitor is something a manager sets up, so a profile that never named
     one does not offer it to every till). **NEW (decision 20):** with no
     choice, a till's Station screen lists every station and its Pass screen is today's "All
     stations" board (`/api/expo/queue`: no Done, fully-away courses hidden,
     `till-expo-screen.ts:46`); with a pass screen choice its Pass screen is that board with Done
     marks, as choosing a watcher gives today (`till-expo-screen.ts:609-648`); **NEW (2026-10-09
     revision, decision 17):** with a pass monitor choice its Pass screen is the monitor — the
     "All stations" board limited to the choice, with no button of any kind — and a device may
     choose a pass screen or a pass monitor, not both, since each would be its Pass screen; the
     Station screen keeps its picker, listing only the chosen stations.
   - **On a till the signed-in person acts**: its levers stay on today's session routes, which
     record the person (`operatorId`, `apps/server/src/till-api.ts:950-956`) and keep the profile's
     zone gate (`till-api.profile-zones.test.ts:84`, `:109`); the device lever routes refuse it
     (decision 12). Its Done goes through the device route, which on any device other than a
     kitchen display requires a session and records its person (decision 5).
3. **"Run the pass" is a screen setting (owner 2026-10-08 answer 3, as first planned).** Departs
   from §9.4's first text ("Firing, Ready and Away are a profile action"). `run-the-pass` ("Runs
   the pass" / "Lleva el pase", the watcher switch's words, `packages/venue-service/src/dashboard/strings.ts:75`,
   `:748`) joins `PROFILE_SCREENS`, not `PROFILE_ACTIONS`, and any form factor may hold it. It
   decides only whether a pass screen draws Fire (when fire control is `expo`), Ready and Away; a
   pass monitor draws none of them, on any device, whatever it says (decision 17). The
   server keeps checking the action each lever takes on every lever route, the kitchen display's
   new ones included: fire against `take-orders`, ready against `prepare-orders`, away against
   `hand-over-orders` (`apps/server/src/till-api.profile-actions.test.ts:61-63` for courses,
   `:77-79` for groups). Why not a server-checked action: the same session routes serve other
   screens — the order screen fires a group (`apps/till/src/till-app.ts:5805`), the station screen
   fires a course and a group (`till-station-screen.ts:433`, `:447`), and the station queue offers
   a group's Fire (`widgets/station-queue.ts:656`). The default till profile gets the flag
   (`DEFAULT_PROFILE_CAPABILITIES.till`, `packages/layouts/src/device-profile.ts:90-102`); the
   default kitchen display profile does not (`:111`) — the owner's answer to decision 23 gives it
   `take-orders` and `hand-over-orders` and does not name this flag (see decision 23's open
   point).
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
   "every" means every station (zone) its profile allows, less what a narrowing recorded as taken
   from it (decision 21); a device may choose "every" under an explicit profile list.
7. **A kitchen display's station screen with several stations offers two views and a switch (owner
   2026-10-08 answer 7).** **Stacked:** one section per station in station order (`display_order`,
   then name), each with its name, queue, notices and printers-down line. **Merged:** one queue of
   every station's dishes, each dish labelled with its station's name, oldest first; the stations'
   notices and printers-down lines above it, each naming its station. Defaults (proposed by the
   campaign's watching session while the owner answered; the owner may override them): it opens
   stacked; the device remembers the last view chosen, in the browser's local storage keyed by the
   device id, as the lock screen remembers the last person
   (`apps/till/src/screens/till-lock-screen.ts:216-221`, `:304`); a screen with one station looks
   as it does today and shows no switch. A till's Station screen keeps its one-station picker
   (decision 20).
8. **Narrowing a profile is allowed and narrows its devices (owner 2026-10-08 answer 8, as the
   owner corrected it): "allow the save, narrow the device, and on the device show 'This <station
   / zone> is no longer available' where the removed one was … No silent fallback to the profile's
   list: a device left with nothing shows that message until someone picks again. The dashboard
   save still warns which devices it changed."** No refusal: `device_profile.station_in_use` and
   `device_profile.watcher_in_use` go, and no new refusal replaces them. How it is stored and shown
   is decision 21.
9. **Station health and dark screens count kitchen displays' station screens only; a station with
   no screen, or a venue with none, is normal (owner 2026-10-08 answer 9).** A station "has a
   screen" when an active kitchen display runs a station screen that shows it ("every" shows all
   but its recorded removals). Pass screens and monitors do not count, as a watcher display does
   not today (`apps/server/src/station-health.ts:112-116`, `apps/server/src/station-outputs-down.ts:127`).
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
    with none or more than one, and a till or handheld given both a pass screen and a pass monitor
    (decision 17, owner 2026-10-09; it no longer refuses a pass monitor on a device that is not a
    kitchen display). This deletes the
    `device_binding_rule_*` rows of `scripts/behavioural-triggers.test.ts` (`:143-144`, the
    `describe` blocks at `:1527` and `:1626`), the cases in
    `packages/db/src/schema/devices.trigger.test.ts`, and the three refusal texts in
    `packages/db/src/trigger-refusals.ts:46-59`. `device_profile_form_factor_locked` stays (dropped
    and re-created around the rebuild, as `0089`–`0091` did).
11. **Error codes, one prefix (owner 2026-10-08 answer 12, renamed).** Pre-live, renamed freely
    (CLAUDE.md §3); every copy moves in the same change. No `kitchen_screen.*` code exists today
    (a grep of every `packages/*/src/errors.ts` and `apps/*/src/errors.ts` for codes beginning
    `kitchen`, `screen` or `monitor` found only `kitchen_notice.*`), and the prefix names the
    concept, as `kitchen_notice.*` and `device_profile.*` do. Registered in
    `packages/venue-service/src/errors.ts` beside the `device_profile.*` codes (`:85-108`), and
    thrown only from venue-service:
    - `kitchen_screen.required` — a kitchen display with no kitchen screen (replaces
      `device.station_required`, `apps/server/src/errors.ts:743`);
    - `kitchen_screen.not_allowed` `{ screen }` — a kind the device's profile does not offer;
    - `kitchen_screen.zone_not_allowed` `{ zoneId: string | null }` — a zone outside the profile's
      list on a device's save, or an order outside the device's pass zones on a lever (decision
      24); `null` means an order that never recorded a zone (a counter order records the zone it
      was rung up in, decision 24);
    - `kitchen_screen.invalid` `{ field: "screens" | "stationIds" | "zoneIds"; reason: "empty" |
      "not_found" | "not_for_screen" | "one_only" }` — an explicit empty list, an unknown or
      switched-off station or zone, a zone on a station screen, a kind named twice, a kitchen
      display given two, or a till or handheld given both a pass screen and a pass monitor
      (decision 17, owner 2026-10-09).
    `station.not_allowed` `{ stationId }` is kept as it is: a station outside the profile's list is
    the refusal it names today. A profile's save is refused under the existing
    `device_profile.access_invalid`, whose `field` loses `stationIds` and `watcherIds` and gains
    `kitchenScreens`, `stationScreenStations`, `passScreenStations`, `passScreenZones`,
    `passMonitorStations` and `passMonitorZones`. **Owner 2026-10-09:** its `reason` does not gain
    `not_shared_display`: that reason existed only to refuse a pass monitor on a profile that is
    not a kitchen display (decision 17) and a form factor change away from one (decision 26), and
    both refusals are gone. Retired: `device.station_required` (Task A5a),
    `device_profile.station_in_use` and `device_profile.watcher_in_use` (Task A6),
    `watcher.not_allowed` (Task A10a).
12. **Routes (owner 2026-10-08 answer 12, renamed).** Device-cookie routes:
    - `GET /api/device/station-screen` (the device's stations in display order, each with queue,
      notices and printers down, or marked no longer available) replaces `GET /api/device/station`;
    - `GET /api/device/pass-screen` and `POST /api/device/pass-screen/done` replace
      `/api/device/watcher` and `/api/device/watcher/done`;
    - `GET /api/device/pass-monitor` is new;
    - **the kitchen display's levers** are new: `POST /api/device/orders/:id/courses/:courseId/fire`,
      `/ready`, `/away`, and `POST /api/device/parties/:id/groups/:gid/fire`, `/ready`, `/away`.
      They serve kitchen displays only: any other device answers `device.unauthorized`, so a till
      cannot use them to step outside its profile's zone gate (decisions 2, 19, 23, 24). Decision
      17's answer (owner 2026-10-09) does not change this: a pass monitor has no buttons, so a till
      running one has no lever to send;
    - on any device other than a kitchen display, the station-screen, pass-screen, pass-monitor and
      Done routes require a signed-in session as well (`session.required`);
    - `GET /management-api/device-profile-kitchen-screens` replaces
      `.../device-profile-kitchen-lists`; device-profile POST and PUT take `kitchenScreens`, and
      PUT answers `narrowedDevices` (decision 21); device PATCH and join accept take
      `kitchenScreens` instead of `stationId`/`watcherId`; `/api/device/me` and the device list
      gain `kitchenScreens`.
    Removed, answering 404: `/api/watchers`, `/api/watchers/:id/queue`, `/api/watchers/:id/done`
    and the four old routes above.
13. **Demo (owner 2026-10-08 answer 10).** Three kitchen displays: "Pantalla Cocina" runs a station
    screen on the default station; "Pantalla Pase" runs a pass screen on the demo watcher's two
    stations (kitchen and deli) and every zone (`apps/server/scripts/demo-seed/seed-watchers.ts:19-33`,
    `apps/server/scripts/dev-setup.ts:310-325`); **NEW:** "Monitor Pase" runs a pass monitor on
    every station and every zone. The demo no longer seeds a watcher. **NEW (decision 23):** the
    demo's kitchen display profile holds `run-the-pass`, `take-orders` and `hand-over-orders` so
    Pantalla Pase shows its levers. **Owner 2026-10-09 (decision 23):** a newly provisioned
    venue's kitchen display profile holds `act-as-kds`, `prepare-orders`, `take-orders` and
    `hand-over-orders` (today `act-as-kds` and `prepare-orders`, `device-profile.ts:111`), so of
    the three the demo needs only `run-the-pass` beyond the default. It lists no kitchen screens,
    as today it lists no stations: `device_profile_stations` is written only by a manager's save
    (`writeLists`, `profile-access.ts:506-529`) and by the test helper (`enrol.ts:12-44`).
14. **Test helper (owner 2026-10-08 answer 12, renamed).** `enrolDeviceForTest`
    (`apps/server/src/testing/enrol.ts:50`) keeps its `stationId` option, meaning a station screen
    on that one station, and gains `kitchenScreen`; its `watcherId` option goes in Task A8b. It
    **adds** what it is given to the profile's row of that kind and never removes anything, as
    `listOnProfile` adds to today's lists with `onConflictDoNothing` (`enrol.ts:12-44`): it creates
    the profile's row with an explicit list when the profile has none, adds a station or zone the
    list lacks, and leaves an "every" list alone. It never narrows a device. Most suites that enrol
    a kitchen display keep their setup.
15. **Configuration transfer (owner 2026-10-08 answer 11).** The three profile kitchen screen
    tables travel with a configuration export, as `device_profile_stations` does today
    (`packages/venue-service/src/configuration-transfer.ts:557`); the four device tables do not,
    as devices do not (`apps/server/src/configuration-transfer.test.ts:1740`).
16. **Guard rows deleted with the tables they describe (owner 2026-10-08 answer 12).** The
    `scripts/schema-constraints.test.ts` rows for `device_profile_stations`,
    `device_profile_watchers`, `devices.station_id` and `devices.watcher_id` (`:97-100`,
    `:109-110`) and `watcher_item_marks` (`:245-247`, `:411`) go in Part A, the watcher tables'
    (`:248-254`, `:399`) in Part B; each new table gets its rows in the task that creates it.
    Slice 1 did the same for its retired tables.
17. **(owner 2026-10-09) — any profile may offer a pass monitor, and it shows what the till's "All
    stations" Pass board shows, limited to its stations and zones.** The owner overrode this
    plan's default (a kitchen display's only): a till, handheld or kitchen display profile may
    offer `pass_monitor`, and no profile is refused for holding one. The monitor's read is the
    every-station pass read (`listExpoQueue`, `apps/server/src/working-order.ts:6618-6633`)
    narrowed to the stations and zones the device chose within its profile's: with no Done to
    clear them, fully-away courses and groups drop off as they do on that board, where a board that
    kept dishes until Done would never empty. **NEW (2026-10-09 revision)**, where the answer does
    not say how a till or handheld shows it: a pass monitor choice makes that device's Pass screen
    the monitor — no Done, no Fire, Ready or Away (whatever "Run the pass" says), no reprint, no
    view toggle — and is offered only when the profile has a pass monitor row (decision 2); a till
    or handheld may choose a pass screen or a pass monitor, not both (`kitchen_screen.invalid`
    `{ field: "screens", reason: "one_only" }`); `GET /api/device/pass-monitor` on such a device
    needs a signed-in session (decision 12). The device lever routes still refuse every device
    that is not a kitchen display (decision 24): the monitor has no buttons.
18. **NEW — a kitchen display's sign-in is backlog entry A436, not this slice.** The owner:
    "kitchen displays can have a login, but i would not expect them to log off automatically, or at
    least only after an extended logout time (eg 30 minutes)". Evidence it is not small: a kitchen
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
    sign-in. Backlog: A436, "A kitchen display with someone signed in, logged out only after a long
    idle time" (The till, devices and table service). This slice is ready for it: the Done route
    reads the signed-in person (decision 5). For A436's entry: new venues' default kitchen display
    profile now holds `take-orders` and `hand-over-orders` (decision 23), which become reachable
    through session routes (for example `apps/server/src/department-transfer-api.ts`) once a
    kitchen display can sign in.
19. **NEW — a kitchen display's Fire records the device.** Fire is the one lever that records who
    did it: `order_groups.fired_by` (`packages/db/src/schema/order-groups.ts:26`, written at
    `apps/server/src/order-groups.ts:469`) and an `order_group_events` row whose `actor_id` is not
    null (`schema/order-groups.ts:69`, written at `apps/server/src/order-groups.ts:471`), both plain
    person ids. `order_groups` gains `fired_by_device_id` and a check that at most one of
    `fired_by` and `fired_by_device_id` is set (a held group has neither); `order_group_events`
    gains `actor_device_id`, its `actor_id` becomes nullable, and a check makes exactly one of the
    two set. A group fired by a device shows the device's name where the till shows who sent it
    (`sentBy`, read at `apps/server/src/order-groups.ts:1095-1111`; the till already handles a
    group with no name, `apps/till/src/api/client.ts:559`, `till-table-order-screen.ts:3712`). A
    group a device fired that later moves to another bill is fired again in the mover's name, as
    the move does for a line whose group has no person firer (`move-bill.ts:382-383`,
    `apps/server/src/order-groups.ts:1524`). Override: no Fire on a kitchen display until one can
    sign in (Ready and Away only; no migration).
20. **NEW — a till's or handheld's choice is optional and narrows only what it shows.** Stated in
    decisions 2, 7 and 9: no choice keeps today's screens; a pass screen choice gives the narrowed
    board with Done; the Station screen keeps its picker, listing the chosen stations; a till's
    choice never counts as a station's screen. Its session routes do not refuse an order or dish
    outside its choice: the signed-in person may act anywhere the profile's zones allow, as today.
21. **(owner 2026-10-09) — a narrowing records what each device lost, and adding it back restores
    it where the device still shows the line** (decision 8's design). What the owner's words ask
    for: the save succeeds; each affected device is narrowed; the device shows "This station is no
    longer available: Deli" where Deli was; nothing falls back to the profile's list; a device left
    with nothing shows only those lines until someone picks again; the dashboard says which
    devices changed. The owner's 2026-10-09 answer adds: "If the station is later added back to
    the profile: a device STILL showing that message for it (nobody has picked anything else
    since) gets the station back and the message clears; a device where someone has since picked a
    different screen or station is NOT switched back — the station simply reappears as an option
    it can pick. Nothing more." This plan reads "station" there as each thing a narrowing records —
    a station, a zone or a kind of screen. **NEW** where this design goes further than those words:
    - **Stored.** When `setProfileKitchenScreens` takes a station, a zone or a kind off a profile,
      it also, in the same transaction, for every device on the profile (active or switched off,
      so re-enabling one does not bring anything back), inserts one row per lost station, zone or
      kind into `device_kitchen_screen_removals` (device, kind, station or zone or neither, time).
      **(2026-10-09 revision)** It leaves the device's own choice — its kind rows and explicit
      lists — as it was: every read shows the device's choice less its removal rows, each of which
      reads as no longer available in its place. Why the choice is kept: a restore must give back
      exactly what the device had, and once a narrowing has deleted a kind row or an emptied list
      the stations and zones it held are gone. A device on "every" keeps "every" and gets the same
      removal rows, because its list was the profile's.
    - **Re-adding restores where the line still shows (owner 2026-10-09).** A profile save that
      lets a device have again what one of its removal rows names (the station or zone is back in
      the profile's list for that kind, or the kind is offered again) deletes that removal row in
      the same transaction: the device shows it again, from the choice it kept, and the line
      clears. A device someone has picked on since has no removal rows (the pick deleted them), so
      nothing comes back to it; the station reappears among what it can pick. An "every" choice
      made since follows the profile, as "every" always does. One save can both restore and
      narrow. The PUT's `narrowedDevices` still names only the devices a save narrowed ("Nothing
      more").
    - **Cleared by a pick.** `setDeviceKitchenScreens` (accept, Pair, Edit) replaces the device's
      choice and deletes all its removal rows: the device shows what was picked and no message.
    - **Switched off elsewhere.** A station or zone switched off on its own page is not recorded:
      every read works it out, shows it as no longer available in the same place, and shows it
      again when it is switched back on, as today's lists keep a switched-off entry
      (`checkLists`, `profile-access.ts:436-460`). **(owner 2026-10-09, the build's 02:25
      question, answer "b")** On a kitchen display's station screen a switched-off station keeps
      showing the dishes still waiting there, with "This station is no longer available: <name>"
      above them, until they are done; new work goes elsewhere, as routing already decides. Its
      dishes can still be started, readied and finished there, and its notices and printers-down
      line stay with them. A station a narrowing took (a removal row) still shows only the line.
      **NEW (2026-10-09 revision):** on a station screen whose list is "every" under a profile
      list that is also "every", a switched-off station is listed, line and dishes, only while
      dishes are waiting at it, so an "every" screen does not collect a line for every station
      ever switched off. The answer was about the kitchen display's station screen; a till's
      Station screen (Task A12c, its picker) and a pass screen or monitor (Task A8a, scoped to
      available stations and zones) keep this plan's earlier rule, unasked.
    - **Where the line shows.** The station screen's read sends the device's stations in display
      order (`display_order`, then name), each either with its queue or marked no longer available,
      so the stacked view draws the line in that station's own section; the merged view draws the
      lines above its one queue, in station order. A pass screen, a pass monitor and a till's
      Station screen draw them above the board or the picker, stations in station order then zones
      in zone order; a kind the profile no longer offers reads "This screen is no longer available:
      Pass screen".
    - **A profile switch** (`POST /api/device/active-profile`, a signed-in person on a till)
      narrows that device against the new profile in the same way, never refuses. **NEW
      (2026-10-09 revision):** it also restores in the same way — switching back to a profile that
      allows a recorded removal again deletes that removal row, since the device still shows the
      line.
    - **The dashboard.** The PUT answers `narrowedDevices` (each device, with the screens,
      stations and zones it lost), and the editor shows them after saving, for example "Saved.
      Pantalla Pase no longer shows Deli." The device's Edit dialog lists the recorded removals,
      marked, outside the draft.
22. **NEW — the "New watcher" button leaves the Prep stations screen in Part A.** The owner
    (2026-10-08 ~21:05, on the Prep stations tab row): "i don't think watchers should be here -
    they are devices which take a device profile." This plan retires the watcher UI in Part B
    (Task B2), which waits for slice 4, so the button would otherwise stay for that whole wait.
    Removing only the button in Part A is safe because it is the dashboard's only way to make a
    watcher (`prep-stations-screen.ts:3450-3457`; the form's other opener edits an existing one),
    and after Part A a new watcher could only be a printer setting: no screen shows one. A
    configuration import still carries watchers and their printers
    (`packages/db/src/configuration-transfer.ts:41-43`, `:61`), so until Part B a venue being set
    up can still start with one by importing a configuration that has one (the import runs only at
    setup, `apps/server/src/boot.ts:1017-1046`); Part A does not close that path. The cost, stated in the pull request: between Part A and slice 4, a venue cannot add a
    pass-ticket printer from the dashboard; its existing watchers stay editable. The form's "new"
    mode goes with the button. The action area's width cap exists because two buttons shared it
    (`prep-stations-screen.ts:112-115`, A424); with one button left, the cap stays or goes by what
    the look shows (Task A17), and its comment goes either way.
23. **(owner 2026-10-09) — a kitchen display profile may also hold `take-orders` and
    `hand-over-orders`, and the default one new venues get holds both.** Today it
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
    checks. **Owner 2026-10-09:** the default kitchen display profile
    (`DEFAULT_PROFILE_CAPABILITIES.kds`, `device-profile.ts:111`, which `DEFAULT_DEVICE_PROFILES`
    and through it provisioning's venue plan, `packages/provisioning/src/venue-plan.ts:177`, give
    every new venue) gains `take-orders` and `hand-over-orders`, so its pass's Fire and Away pass
    the server's checks out of the box; the demo's has them too (decision 13). This plan's default
    was "unchanged". No existing venue's profile is rewritten: the slice already needs a venue
    reset, and no data migration is written before go-live (CLAUDE.md §3). **Open question for
    the owner, with a worked example under "New decisions this revision made":** a pass screen draws Fire, Ready and Away only when its
    profile has "Run the pass" (decision 3), and the answer did not name that flag, so the default
    kitchen display profile still draws none of them until a manager switches it on; until the
    owner says otherwise the default does not get `run-the-pass`. Several tests and strings say a
    kitchen display may only prepare; Task A1 changes them (see "Changed test checks (planned)").
24. **(owner 2026-10-09, clarified) — the kitchen display's lever routes check the order's zone
    against the pass screen's zones, not its stations, and a counter order's zone is the zone it
    was rung up in.** The order's or party's zone (read as a watcher's board reads it,
    `orderWatchZones`, `apps/server/src/watch-zones.ts:15`) must be one of the device's pass zones,
    or the device's pass covers every zone; otherwise `kitchen_screen.zone_not_allowed`
    `{ zoneId }`, thrown by venue-service (`assertPassScreenZone`, Task A3b). **A counter order
    has a zone.** `orderWatchZones` takes the seated table's zone, then a delivery table's, then
    the zone the order recorded when it opened (`watch-zones.ts:50-61`, the last through
    `findOrderZones`, which reads `order_service_contexts`: it is `findOrderServiceZones`,
    `packages/venue-service/src/operations.ts:1091-1110`, exposed as `findOrderZones` at
    `packages/venue-service/src/service.ts:93`). Measured 2026-10-09 by backlog item
    A437 on `main`: deleting that recorded-zone fallback failed 3 of 19 kitchen tests; restored,
    19 of 19 passed. The till's zone limits read differently: `subjectZone`
    (`apps/server/src/zone-access.ts:22-25`) reads only the recorded zone for an order, while
    `orderWatchZones` takes the seated table's first, so the two differ after a party moves (A437's
    open question to the owner). So a pass limited to named zones
    shows and fires counter orders rung up in those zones, and refuses those from others with
    `kitchen_screen.zone_not_allowed` `{ zoneId }` naming the counter's zone. Only an order that
    never recorded a zone and has no table is zone-less: on a pass with an explicit zone list it
    is refused with `zoneId: null`, matching the board, which does not show it (`watcherSees`,
    `watchers.ts:45-53`). The owner asked why a counter was not treated as a zone; the answer is
    that it already is, and the earlier text here saying a counter sale had no zone was wrong. The
    profile's zone gate for tills, `service_zone.not_allowed` `{ zoneId: string }`
    (`packages/venue-service/src/errors.ts:80`), lets a zone-less order through
    (`apps/server/src/zone-access.ts:54`, `:91-92`) and has no way to say "no zone", so it is not
    reused. Fire, Ready and Away then act on the whole course or group, as at a till: a course can
    hold dishes from stations the pass does not show. The rest stands: the lever routes refuse
    every device that is not a kitchen display, and decision 17's answer does not change that,
    because a pass monitor has no buttons.
25. **NEW — the Prep stations read-out lists the devices whose choice shows the station**, of any
    form factor and any kind (station screen, pass screen, pass monitor); a till or handheld with no
    choice is not listed, though its screens show every station.
26. **DROPPED (owner 2026-10-09) — changing a profile's form factor keeps its kitchen screens,
    pass monitor included; nothing is refused.** It followed from decision 17: once any profile may
    offer a pass monitor, there is nothing to re-check. The trigger
    `device_profile_form_factor_locked` still refuses a form factor change while an active device
    uses the profile (`packages/db/drizzle/0091_devices_recreate_triggers.sql:5-14`). A change
    towards `kds` keeps the stored rows, which then say which kinds it offers; a change away from
    it keeps them as bounds. `checkProfileKitchenScreens` and the `not_shared_display` reason go
    (decision 11), and the dashboard editor drops nothing from its draft when the form factor
    changes.

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
  Part A's venue-service migrations, after the rebase onto slices 2 and 3, are `0039` and `0040`.
- No data-migration code before go-live (CLAUDE.md §3): a migration changes the schema; old rows
  are left to the reset. Part A adds, rebuilds and drops; Part B drops.
- drizzle-kit 0.31.11: a generation that rebuilds a table must not also add a column to it. This
  slice rebuilds three tables: `devices` (Task A10b) only drops columns; `order_groups` and
  `order_group_events` (Task A4b) get their new columns in one generation and are rebuilt, for
  their checks and `actor_id`'s nullability, in the next. The expression-index trap does not arise:
  `devices`' one index is the partial unique index `devices_location_label_active_key` over plain
  columns, which drizzle already re-created after the last rebuild
  (`packages/db/drizzle/0090_devices_lose_till.sql:29`); `order_groups` has one plain index
  (`order_groups_party_idx`, `packages/db/src/schema/order-groups.ts:39`) and `order_group_events`
  two (`:84-85`).
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
  `no action` children `device_kitchen_screens`, `device_kitchen_screen_removals`,
  `pass_item_marks`, `order_groups` (`fired_by_device_id`) and `order_group_events`
  (`actor_device_id`). So on any box that has had a sign-in or a sale the migration fails and the
  box does not start until it is reset. Task A10b's commit message lists every child with its
  `ON DELETE` and says this; the pull request's first line says the reset is required (see "Venue
  reset" above). The same holds for Task A4b's `order_groups` rebuild: `order_group_events.group_id`
  and `working_order_lines.group_id` are `no action` keys into it
  (`packages/db/drizzle/0028_order_groups.sql:10`, `0092_positive_price_quantity.sql:35`).
- Every foreign key and unique index is declared in the TypeScript schema.
- Error codes name the domain concept and are registered in the throwing package's `errors.ts`;
  every file that throws one imports its registry (a server file throwing a server code imports
  `./errors.js`, as `watcher-board.ts:1` does; the `kitchen_screen.*` codes are thrown inside
  venue-service only). A code decision 11 retires leaves every registry, status map and
  translation list in the change that stops throwing it. **The check for a retirement is a grep,
  not a guard:** `scripts/errors-reachable.test.ts` checks only that each package's `errors.ts`
  stays reachable from its barrel (`:7-17`), not whether a code is still used or still listed, so
  the retiring task runs `grep -rn '"<code>"' apps packages docs/developers` and leaves no copy
  outside history.
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
- **The route maps (CLAUDE.md §3).** Each new device lever route adds a row to the route-to-action
  map atop `apps/server/src/till-api.profile-actions.test.ts` with a refusing case, and a row to
  the route-to-zone map atop `till-api.profile-zones.test.ts` ("order" or "party", read against
  the device's pass zones, decision 24) with a refusing case. The station-screen, pass-screen,
  pass-monitor and Done routes are scoped by the device's kitchen screen, not a zone of the
  profile, and are named in that map's "Not zone-gated" paragraph (`:151-153`).
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
  `device_profile.watcher_in_use`, `profile-access.ts:462-503`); now it is allowed and narrows the
  device (decisions 8 and 21).
- A profile switch refused because the new profile does not list the device's station
  (`assertProfileBinding` in `switchActiveProfile`, `device.ts:288-330`).
- A kitchen display profile limited to `prepare-orders`.
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

## Changed test checks (planned)

The pull request's "Changed test checks" section starts from this list and adds whatever else a
task changes, each with `file:line`, before and after.

| Task | Check | Before | After |
| --- | --- | --- | --- |
| A1 | `packages/layouts/src/device-profile.test.ts:53-70` | a kitchen display is refused `take-orders` among five actions | refused `take-cash`, `integrated-card-payment`, `hand-keyed-card-payment`, `open-cash-drawer`; a new case accepts `take-orders`, `hand-over-orders` and `run-the-pass` |
| A1 | `packages/layouts/src/device-profile-store.db.test.ts:940-977` (`take-orders` in its loop at `:953`) | create refuses `take-orders` on a kitchen display | the loop drops `take-orders`; a create with `take-orders` and `hand-over-orders` stores them |
| A1 | `apps/server/src/management-api.device-profiles.test.ts:1742-1787` (`take-orders` at `:1744`) | POST refuses `take-orders` on a kitchen display | the loop drops `take-orders`; a POST with `take-orders` and `hand-over-orders` answers 201 |
| A1 | `apps/dashboard/src/screens/device-profiles-screen.test.ts:1631-1666` | screens group without "Runs the pass" (`:1648-1653`); a kitchen display's actions `["cap-prepare-orders"]` (`:1657`); saved `["act-as-kds", "prepare-orders"]` (`:1663-1666`) | screens group gains `cap-run-the-pass`; a kitchen display's actions are take, prepare and hand over; the saved capabilities keep the profile's `take-orders` |
| A1 (owner 2026-10-09, decision 23) | `packages/layouts/src/device-profile.test.ts:211` (at `main` `974f7170e`) | `DEFAULT_PROFILE_CAPABILITIES.kds` is `["act-as-kds", "prepare-orders"]` | it also holds `take-orders` and `hand-over-orders`, and not `run-the-pass` |
| A1 (owner 2026-10-09, decision 23) | `packages/provisioning/src/venue-plan.test.ts:105`, `packages/provisioning/src/venue-apply.test.ts:360` (at `974f7170e`) | the provisioned "Cocina" profile's capabilities are `["act-as-kds", "prepare-orders"]` | the same four as the default |
| A5a | `apps/dashboard/src/screens/devices-screen.test.ts:1467`, `:2167`, `:2215`, `:3949` | `device.station_required` | `kitchen_screen.required` |
| A5a | `apps/server/src/device.test.ts:71-77` (code at `:77`) | a kitchen display with no station target is refused `device.station_required` | a kitchen display with no kitchen screen is refused `kitchen_screen.required` |
| A5a | `apps/server/src/device.test.ts:273-278` | "a kds profile with NO station is device.station_required" | a kitchen display accepted with no kitchen screen is `kitchen_screen.required` |
| A5a | `apps/server/src/device-api.test.ts:1493-1503` | a PATCH leaving a kitchen display without a station or watcher answers `device.station_required` | a PATCH with `kitchenScreens: []` answers 400 `kitchen_screen.required` |
| A5a | `apps/server/src/join-api.db.test.ts:805-824` | a join accept on a kitchen display profile with no station answers 400 `device.station_required`, the request survives | the same with no kitchen screen answers 400 `kitchen_screen.required`, the request survives |
| A5a | `apps/server/src/join-requests.test.ts:900-911` (code at `:911`) | a returning kitchen display accepted without a station is refused `device.station_required` | refused `kitchen_screen.required` |
| A10a | `apps/server/src/device.test.ts:248-267` (code at `:267`) | accepting a kitchen display with a watcher its profile does not list is refused `watcher.not_allowed` | the watcher half is deleted with the code; the station half (`station.not_allowed`) stays; Task A3b's `kitchen_screen.not_allowed` and `station.not_allowed` cases cover the new choice |
| A10a | `apps/server/src/device-api.test.ts:1671-1711` (code at `:1711`) | a PATCH giving a screen an unlisted watcher answers `watcher.not_allowed` | deleted with watchers on devices (Task A8b); the PATCH's refusals are A5a's `kitchen_screen.*` cases |
| A10a | `apps/server/src/join-api.db.test.ts:829-845` (pair at `:845`) | a join accept naming an unlisted watcher answers 400 `watcher.not_allowed` | the watcher pair is deleted; the station pair (`station.not_allowed`) stays |
| A10a | `apps/till/src/i18n/codes.test.ts:433-436` | the till words `watcher.not_allowed` in both languages | the `watcher.not_allowed` row is deleted with the code; `station.not_allowed` stays |
| A10a | `apps/till/src/widgets/profile-dialog.test.ts:74-78` | a `watcher.not_allowed` refusal shows under the profile | `watcher.not_allowed` leaves the `it.each` list; the other three codes stay |
| A10a | `packages/venue-service/src/profile-access.test.ts:900-910`, `:915-924` | `assertProfileBinding` refuses an unlisted watcher, and any watcher on an empty list, `watcher.not_allowed` | deleted with `assertProfileBinding`; Task A3b's device-choice cases are at least as strict |
| A6 | `apps/server/src/management-api.device-profiles.test.ts:1224-1265` (code at `:1255`) | removing a shown station answers 409 `device_profile.station_in_use` and keeps the save | answers 200, the save kept, the device named in `narrowedDevices` with the station |
| A6 | `packages/venue-service/src/profile-access.test.ts:945-965` (codes at `:949`, `:961`) | removing a shown station or watcher is refused | deleted with the in-use blocks; Task A3c's narrowing cases are at least as strict |
| A6 | `apps/dashboard/src/screens/device-profiles-screen.test.ts:1318-1355` (`:1321`, `:1345`); `device-profiles-screen.a11y.test.ts:375` | the editor names the device under the list on an in-use refusal | deleted with the codes; Task A15's narrowed-devices status line case replaces them |
| A4 | `packages/db/src/schema/devices.trigger.test.ts`; `scripts/behavioural-triggers.test.ts:143-144`, `:1527`, `:1626` | the binding triggers refuse | the triggers are absent (decision 10) |
| A8b | `apps/server/src/watchers.test.ts:46-62`, `:245`, `:392-412`, `:417`, `:443`, `:466`, `:476`, `:495`, `:531` | a device or mark keeps a watcher in use | each passes `disable` or checks deletion |
| A10b | `packages/db/src/schema/watchers.test.ts:20`, `:78-148`, `:150-193` | watcher marks | deleted with the table; Task A8a's mark cases replace them |
| A13 | `apps/till/src/screens/till-expo-screen.test.ts` (the chooser and watcher cases) | a till picks a watcher | a till's Pass screen follows its device's choice |
| A17 | `packages/venue-service/src/dashboard/prep-stations-screen.test.ts:195`, `:226`, `:2675-2677`, `:5177`, `:5228`; `watcher-form.unsaved.test.ts:146-151` | the "New watcher" button opens the form | a watcher is seeded through the mocked API and opened with Edit; the creation cases are deleted with the behaviour; one case checks the button is absent |

## Review focus

The conditions most likely to bite a person that no single task's happy path exercises. Each has
its test in the task named.

1. **A pass screen or monitor sees only its stations and zones.** A Terrace-only pass does not show
   a Bar order, nor a counter order rung up in the counter's zone, nor an order that never recorded
   a zone (as `watcherSees` today, `watchers.ts:45-53`); a pass limited to the counter's zone shows
   and fires that counter's orders (decision 24, owner 2026-10-09) (Tasks A8a, A8c).
2. **Two pass screens, one dish.** Marking a dish Done on one leaves it on the other; a dish split
   onto another bill keeps the marks; a till's mark records the signed-in person, a kitchen
   display's records none (Task A8a).
3. **A kitchen display cannot bump another station's dish.** An advance on an item at a station
   outside the device's station screen is refused `device.forbidden_station`; an every-station
   screen may advance any (Task A7).
4. **Narrowing a profile under a device.** The save succeeds and names the device; the device's
   choice loses the station and records it; the device shows "This station is no longer
   available: Deli" in Deli's own section, and only such lines when nothing is left; an "every"
   device records the loss too; adding Deli back to the profile brings it back, and clears the
   line, on a device still showing that line, and not on one someone has picked on since, where
   Deli is only offered again; a kind taken off and offered again comes back with the stations and
   zones the device had; editing the device clears the lines (decision 21, owner 2026-10-09)
   (Tasks A3c, A5b, A6, A12a, A15, A16).
5. **No screen is normal.** A venue with no kitchen displays, or with only pass screens and
   monitors, or with a till that chose stations, raises no dark-screen alert however long dishes
   wait (Task A7).
6. **The rebuilds.** After the `devices` rebuild, `device_profile_form_factor_locked` still refuses
   a form factor change under an active device; after the `order_group_events` rebuild, a row
   written before it survives and its update and delete are still refused; the upgrade walk's
   casualties are exactly the ones its `RESETS` entries name (Tasks A4b, A10b).
7. **Levers.** A till without `run-the-pass` shows no Fire, Ready or Away on its Pass screen and
   still fires from its order screen; a till's cookie on the device lever routes is refused
   `device.unauthorized`; a kitchen display's pass with "Run the pass" fires as the device, and
   without `take-orders` is refused `device.forbidden_action` (Tasks A1, A8c, A13, A14).
8. **The device as firer.** A group a kitchen display fired shows the device's name as its sender;
   `order_group_events` refuses a row with both or neither of a person and a device, and
   `order_groups` a group with both (Tasks A4b, A8c).
9. **A switched-off station's waiting dishes (owner 2026-10-09).** A station switched off on its
   own page keeps its dishes on a kitchen display's station screen, stacked and merged, under its
   "no longer available" line, and they can be started, readied and finished until none is left; a
   station a narrowing took shows only the line, and advancing its dish is still refused
   `device.forbidden_station` (Tasks A3b, A7, A12a, A12b).
10. **A pass monitor on a till (owner 2026-10-09).** A till or handheld whose device chose a pass
    monitor shows it as its Pass screen with no button of any kind, even when its profile has "Run
    the pass"; its read needs a signed-in session; its cookie on the device lever routes is still
    refused `device.unauthorized` (Tasks A3b, A8a, A13).

---

## Part A — kitchen screens and monitors (first pull request)

**Rebase onto slices 2 and 3 (built, 2026-10-09).** The branch was rebased onto `main` `974f7170e`
as one commit, `5f925a618`. Its venue-service migrations are now `0039_curved_magdalene.sql` and
`0040_illegal_wolfsbane.sql`. Slice 3's kitchen display station-day routes
(`GET` and `PUT /api/device/stations/:stationId/today`, `apps/server/src/station-today-api.ts`)
checked the device's own station, a column Part A drops; on the branch they accept a station the
device's station screen shows as available (`assertScreenShowsStation`, `:27-41`) and refuse any
other with `device.forbidden_station`.

### Task A1: The `run-the-pass` setting; a kitchen display may take and hand over

**Files:**
- Modify: `packages/layouts/src/canvas.ts` (`CAPABILITY_FLAGS :37-50`, `PROFILE_SCREENS :67-72`),
  `packages/layouts/src/device-profile.ts` (the comments `:13`, `:18`, `SHARED_DISPLAY_ACTIONS
  :19`, `DEFAULT_PROFILE_CAPABILITIES.till :90-102`),
  `apps/dashboard/src/screens/canvas-editor/card-contracts.ts` (its mirrors: `CAPABILITY_FLAGS
  :20`, `PROFILE_SCREENS :47`, `SHARED_DISPLAY_ACTIONS :70`), `apps/till/src/layout.ts`
  (`CapabilityFlag :39-51`), `apps/dashboard/src/screens/device-profiles-screen.ts`
  (`#renderCapabilities :2042`, the Screens group `:2058-2063`), `apps/dashboard/src/i18n/strings.ts`
  (`device_profiles.capability.run-the-pass`, EN and ES; rewrite
  `device_profiles.shared_display_actions_hint` `:1882-1883`, `:4383-4384` and
  `device_profiles.err_shared_display_action` `:1907-1908`, `:4409-4410`, which say a kitchen
  display can only prepare — draft EN "A kitchen display has nobody signed in, so it can only
  prepare orders, and take and hand them over from a pass screen." / "A kitchen display can only
  take, prepare and hand over orders. Switch the other actions off."),
  `apps/server/src/device-session.ts` (the comment `:353-354`, "a shared display may only
  prepare"), `apps/server/src/till-api.profile-actions.test.ts` (the shared-display sentence
  `:105-106`)
- Test: `packages/layouts/src/canvas.test.ts`, `device-profile.test.ts` (`:53-70`),
  `device-profile-store.db.test.ts` (`:940-977`),
  `apps/server/src/management-api.device-profiles.test.ts` (`:1742-1787`),
  `apps/dashboard/src/screens/canvas-editor/card-contracts.parity.test.ts` (must pass unchanged),
  `apps/dashboard/src/screens/device-profiles-screen.test.ts` (`:1631-1666`) — the four changed
  checks are listed under "Changed test checks (planned)"

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
  is true; `DEFAULT_PROFILE_CAPABILITIES.till` contains `run-the-pass` and `.kds` gains
  `take-orders` and `hand-over-orders` (decision 23, owner 2026-10-09); the
  profile editor shows a "Runs the pass" switch under Screens for a till profile and for a kitchen
  display profile, and "Take orders" and "Hand over orders" under Actions for a kitchen display;
  change the four existing checks as planned.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/layouts exec vitest run src/canvas.test.ts src/device-profile.test.ts src/device-profile-store.db.test.ts`,
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/device-profiles-screen.test.ts` and
  `pnpm --filter @waitron/server exec vitest run src/management-api.device-profiles.test.ts`.
- [ ] **Step 3: Implement**, the mirrors, the label and the rewritten strings and comments; reword
  the profile-actions map's sentence to say a shared display may prepare, take orders and hand
  over, and on its own cookie reaches no till route.
- [ ] **Step 4: Run; see them pass;** run the parity test and
  `pnpm --filter @waitron/server exec vitest run src/till-api.profile-actions.test.ts`; typecheck
  layouts, dashboard, till and server.
- [ ] **Step 5: Commit** — `feat(layouts): a profile can run the pass, and a kitchen display can take and hand over (A366)`.

**AS BUILT → CHANGE (owner 2026-10-09, decision 23).** AS BUILT: the branch left
`DEFAULT_PROFILE_CAPABILITIES.kds` as `["act-as-kds", "prepare-orders"]` and pins it twice in
`packages/layouts/src/device-profile.test.ts` (the existing defaults case, and the new "running the
pass" case). → CHANGE, test first: change both pins, and the provisioning pins in
`packages/provisioning/src/venue-plan.test.ts` and `venue-apply.test.ts`, to expect `take-orders`
and `hand-over-orders` as well (and still no `run-the-pass`); run
`pnpm --filter @waitron/layouts exec vitest run src/device-profile.test.ts` and
`pnpm --filter @waitron/provisioning exec vitest run src/venue-plan.test.ts src/venue-apply.test.ts`
and watch them fail; then add the two actions to `DEFAULT_PROFILE_CAPABILITIES.kds`
(`packages/layouts/src/device-profile.ts`) and see them pass. Then grep for other pins of the old
default (`grep -rn '"act-as-kds", "prepare-orders"\]' apps packages`) and change only those that
read the default rather than build their own profile; each changed pin goes in the pull request's
"Changed test checks".

---

### Task A2: Migration — kitchen screen tables (add only)

**Files:**
- Create: `packages/venue-service/src/schema/kitchen-screens.ts`; generated
  `packages/venue-service/drizzle/00NN_*.sql`, snapshot, journal entry
- Modify: `schema/index.ts`, `classification.ts` and its test, `configuration-transfer.ts` (the
  profile tables, decision 15, beside `device_profile_stations` `:557`), `migrations.test.ts`
  (`TABLES`), `scripts/schema-constraints.test.ts`,
  `apps/server/src/testing/clear-provision-fixture.ts` (the seven tables join its list beside
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
// device_kitchen_screen_removals (decision 21): id PK; device_id → devices.id (no action); screen;
//   station_id → kitchen_stations.id, nullable; zone_id → floor_zones.id, nullable;
//   removed_at (tsString, not null); CHECK (station_id IS NULL OR zone_id IS NULL); index on
//   device_id. A row with neither names the kind itself. No unique index: one would have to be an
//   expression over the nullable columns (CLAUDE.md §3's drizzle trap), so the writer inserts only
//   what is not already recorded.
```

Which kinds a device may choose — "one per kitchen display", and on a till or handheld a pass
screen or a pass monitor, not both (decision 17, owner 2026-10-09) — are code rules
(`setDeviceKitchenScreens`, Task A3b): a CHECK cannot read another table. (No form factor is
refused a kind at the profile any more: decision 17.) `device_kitchen_screens.device_id` and the removals' `device_id` are `no action`
rather than `cascade` so that a later rebuild of `devices` refuses (see Global constraints) instead
of silently emptying every device's choice. The removals are keyed to the device, not to its
kitchen screen row: the key was chosen when a narrowing deleted rows, and is kept to avoid another
migration.

- [ ] **Step 1: Failing test** in `migrations.test.ts`: the seven tables exist; deleting a profile
  deletes its kitchen screen rows; a station row with `every_zone = 1`, a zone row on a station
  screen, an unknown `screen`, and a removal with both a station and a zone are refused by the
  database; deleting a device's `device_kitchen_screens` row deletes its station and zone rows and
  leaves its removals. Run
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/migrations.test.ts`.
- [ ] **Step 2: Schema, then generate** — `pnpm --filter @waitron/venue-service db:generate`. Read
  the SQL: only `CREATE TABLE` and indexes.
- [ ] **Step 3:** classify all seven `state`; add the three profile tables to
  `VENUE_SERVICE_CONFIGURATION_TRANSFER.tables`; add each table's keys and checks to
  `scripts/schema-constraints.test.ts`.
- [ ] **Step 4: Run** Step 1's test and
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/module-graph-honesty.test.ts`
  (below, "the Task A2 guard list"). Read each run's `Tests` count.
- [ ] **Step 5: Commit** — `feat(venue-service): tables for the kitchen screens profiles offer and devices choose (A366)`.

---

### Task A3a: Profile kitchen screens (venue-service)

**Files:**
- Create: `packages/venue-service/src/kitchen-screens.ts`, `kitchen-screens.test.ts`
- Modify: `packages/module/src/module.ts` (adds the types and the profile members below to
  `VenueServiceContribution`; `readProfileKitchenLists`, `setProfileKitchenLists`,
  `assertProfileBinding` and `readProfileServiceAccess`'s `stationIds`/`watcherIds` stay until
  A10a, so the server keeps compiling), `packages/venue-service/src/service.ts`, `index.ts`,
  `errors.ts` (`device_profile.access_invalid`'s new fields and reason)
- Test: `kitchen-screens.test.ts`

**Interfaces** (types in `packages/module/src/module.ts`, implementation in `kitchen-screens.ts`):

```ts
export type KitchenScreenKind = "station" | "pass" | "pass_monitor";
/**
 * null stationIds = every station; null zoneIds = every zone. A station screen never filters by
 * zone: it is stored with every_zone 0 and no zone rows, and read back with zoneIds null. On a
 * device, "every" means every one its profile allows less its recorded removals (decisions 6, 21).
 */
export interface KitchenScreenScope { readonly stationIds: readonly string[] | null; readonly zoneIds: readonly string[] | null }
export type ProfileKitchenScreens = Readonly<Partial<Record<KitchenScreenKind, KitchenScreenScope>>>;
export interface DeviceKitchenScreen extends KitchenScreenScope { readonly kind: KitchenScreenKind }
export interface Named { readonly id: string; readonly name: string }
export interface NarrowedDevice {
  readonly deviceId: string; readonly deviceName: string;
  readonly lost: { readonly screens: readonly KitchenScreenKind[]; readonly stations: readonly Named[]; readonly zones: readonly Named[] };
}

readProfileKitchenScreens(tx, cfg): Promise<{ profileId: string; screens: ProfileKitchenScreens }[]>; // every live profile; switched-off entries included
setProfileKitchenScreens(tx, cfg, profileId: string, screens: ProfileKitchenScreens): Promise<NarrowedDevice[]>; // replaces all of the profile's rows; narrows devices from A3c, answers [] until then
// checkProfileKitchenScreens: dropped with decision 26 (owner 2026-10-09)
addProfileKitchenScreen(tx, cfg, profileId: string, screen: DeviceKitchenScreen): Promise<void>; // merges, never removes, never narrows (decision 14's helper)
```

Rules the tests pin:

- `setProfileKitchenScreens` stores `pass_monitor` on a profile of any form factor (decision 17,
  owner 2026-10-09); an explicit empty list → `device_profile.access_invalid`
  `{ reason: "empty" }` on the list's field (`stationScreenStations`,
  `passScreenStations`, `passScreenZones`, `passMonitorStations`, `passMonitorZones`); an unknown
  station or zone, or one switched off and not already stored → `reason: "not_found"` on the same
  field (as `checkLists`, `profile-access.ts:436-460`).
- `addProfileKitchenScreen` creates the profile's row with the given explicit lists when it has
  none, adds stations or zones its explicit lists lack, and changes nothing on an "every" list.

- [ ] **Step 1: Failing tests** in `kitchen-screens.test.ts` (with `useVenueDb`, as
  `profile-access.test.ts` sets up), one per rule; each rule the kitchen-list cases of
  `profile-access.test.ts` pin today, except the in-use refusals decision 8 retires, has its
  counterpart here, at least as strict, before A10a deletes them.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/kitchen-screens.test.ts`.
- [ ] **Step 3: Implement;** wire the contract in `service.ts`; register the new field values.
- [ ] **Step 4: Run; see them pass;** typecheck venue-service, module and server.
- [ ] **Step 5: Commit** — `feat(venue-service): profiles offer kitchen screens (A366)`.

**AS BUILT → CHANGE (owner 2026-10-09, decisions 17 and 26).** AS BUILT:
`setProfileKitchenScreens` refuses `pass_monitor` on a profile that is not `kds`
(`device_profile.access_invalid` `{ field: "kitchenScreens", reason: "not_shared_display" }`), and
`checkProfileKitchenScreens` refuses a stored `pass_monitor` row once the profile is no longer
`kds`; `kitchen-screens.test.ts` pins both, and `packages/venue-service/src/errors.ts` lists the
reason. → CHANGE, test first: turn those two cases round — a till profile and a handheld profile
each store a pass monitor with explicit stations and zones and read it back; a kitchen display
profile changed to `till` keeps its `pass_monitor` row — and watch them fail
(`pnpm --filter @waitron/venue-service exec vitest run --project node src/kitchen-screens.test.ts`);
then delete the refusal, delete `checkProfileKitchenScreens` from `kitchen-screens.ts`, `service.ts`
and the `VenueServiceContribution` in `packages/module/src/module.ts`, and take `not_shared_display`
out of `errors.ts`. Make this change and Task A6's in one commit, since the server calls the
deleted function; after both, `grep -rn "not_shared_display\|checkProfileKitchenScreens" apps
packages` prints nothing.

---

### Task A3b: The device's choice, and what it shows (venue-service)

**Files:**
- Modify: `packages/venue-service/src/kitchen-screens.ts` and its test,
  `packages/module/src/module.ts`, `service.ts`, `errors.ts` (decision 11's `kitchen_screen.*`
  codes)
- Test: `kitchen-screens.test.ts`

**Interfaces:**

```ts
/** One slot of a device's kitchen screen, in display order: shown, or no longer available. */
export type ScreenSlot = {
  readonly id: string; readonly name: string; readonly available: boolean;
  /** (owner 2026-10-09) True when it is unavailable only because it was switched off on its own
   * page, so a station screen still shows its waiting dishes; false for a recorded removal. */
  readonly switchedOff: boolean;
};
export interface ResolvedKitchenScreen {
  readonly kind: KitchenScreenKind;
  /** False when the profile no longer offers this kind and a narrowing recorded it. */
  readonly available: boolean;
  readonly stations: readonly ScreenSlot[]; // display order; available false = recorded removal or switched off
  readonly zones: readonly ScreenSlot[] | null; // null: no zone filter; otherwise zone order
}
readDeviceKitchenScreens(tx, cfg, deviceId: string): Promise<ResolvedKitchenScreen[]>; // stored kinds, then kinds recorded as removed
setDeviceKitchenScreens(tx, cfg, input: { deviceId: string; profileId: string; screens: readonly DeviceKitchenScreen[] }): Promise<void>; // replaces the device's rows; deletes its removal rows
assertDeviceKitchenScreens(tx, cfg, profileId: string, screens: readonly DeviceKitchenScreen[]): Promise<void>; // setDeviceKitchenScreens' checks without the write
assertPassScreenZone(tx, cfg, deviceId: string, zoneId: string | null): Promise<void>; // decision 24
readStationScreens(tx, cfg): Promise<{ deviceId: string; stationIds: string[] }[]>; // active kitchen displays running a station screen; available stations only (decision 9)
```

Rules the tests pin:

- `setDeviceKitchenScreens` on a `kds` profile: no screen → `kitchen_screen.required`; two →
  `kitchen_screen.invalid` `{ field: "screens", reason: "one_only" }`. On any profile: a kind named
  twice → the same; a till or handheld given both `pass` and `pass_monitor` → the same (decision
  17, owner 2026-10-09); a kind the profile does not offer (a profile of any form factor with no
  `pass_monitor` row; a `kds` profile with no row for the kind) → `kitchen_screen.not_allowed`
  `{ screen }`; a station outside the
  profile's explicit list → `station.not_allowed`; a zone outside →
  `kitchen_screen.zone_not_allowed` `{ zoneId }`; a zone on a station screen →
  `kitchen_screen.invalid` `{ field: "zoneIds", reason: "not_for_screen" }`; an explicit empty
  list → `reason: "empty"`; a switched-off or unknown station or zone → `reason: "not_found"`.
  "Every" is accepted under any profile list. A till or handheld with no screens is accepted. A
  save deletes the device's removal rows.
- `readDeviceKitchenScreens`: an "every" device lists every station its profile allows, in display
  order, less its recorded removals, which it lists `available: false` in their own places; an
  explicit device lists its stored stations and its recorded removals in display order; a
  station switched off since reads `available: false`, `switchedOff: true`, in its place and
  `true` again once switched back on, and a recorded removal reads `switchedOff: false`; a kind
  recorded as removed reads `available: false`; a station screen reads
  `zones: null`. On a till or handheld whose profile has no row for the kind, the profile bounds
  nothing.
- `assertPassScreenZone`: a device without a pass screen → `kitchen_screen.not_allowed`
  `{ screen: "pass" }`; a zone outside an explicit zone list → `kitchen_screen.zone_not_allowed`
  `{ zoneId }`; `null` on an explicit list → the same with `zoneId: null`; anything on an
  every-zone pass passes.
- `readStationScreens` lists kitchen displays only, never a till or handheld.

- [ ] **Step 1: Failing tests** in `kitchen-screens.test.ts`, one per rule; write removal rows
  straight into Task A2's table.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/kitchen-screens.test.ts`.
- [ ] **Step 3: Implement;** wire the contract; register the codes.
- [ ] **Step 4: Run; see them pass;** `pnpm exec vitest run scripts/errors-reachable.test.ts`;
  typecheck venue-service, module and server.
- [ ] **Step 5: Commit** — `feat(venue-service): a device chooses its kitchen screens, and reads what it no longer shows (A366)`.

**AS BUILT → CHANGE (owner 2026-10-09).**
- **Decision 17.** AS BUILT: `checkChoice` in `kitchen-screens.ts` refuses `pass_monitor` on any
  device whose profile is not `kds` with `kitchen_screen.not_allowed` (`boundOf` already treats a
  till's or handheld's pass monitor with no profile row as not offered). → CHANGE, test first in
  `kitchen-screens.test.ts`: a till and a handheld whose profile has a pass monitor row each save
  and read back a pass monitor within that row's stations and zones; a station or zone outside the
  row is refused as for a pass screen; a profile with no pass monitor row still answers
  `kitchen_screen.not_allowed` `{ screen: "pass_monitor" }`; a till given `pass` and
  `pass_monitor` together answers `kitchen_screen.invalid` `{ field: "screens", reason:
  "one_only" }`. Watch them fail, then let `checkChoice` decide a pass monitor by the profile's
  row on every form factor and add the one-of-the-two rule.
- **The 02:25 question, answer "b".** AS BUILT: `ScreenSlot` has no way to tell a switched-off
  station from a recorded removal. → CHANGE, test first: a device whose explicit Deli is switched
  off on its own page reads Deli `available: false, switchedOff: true`; a device whose Deli a
  narrowing took reads `switchedOff: false`; a station both switched off and narrowed away reads
  `switchedOff: false`; a zone likewise. Watch them fail, then add the field.
  Task A7 uses it.

---

### Task A3c: A profile save narrows its devices and records what they lost (venue-service)

**Files:**
- Modify: `packages/venue-service/src/kitchen-screens.ts` (`setProfileKitchenScreens`, and a
  `narrowDeviceKitchenScreens(tx, cfg, deviceId, profileId)` the profile switch reuses in Task
  A5b) and its test, `packages/module/src/module.ts`
- Test: `kitchen-screens.test.ts`

**Interfaces:**

```ts
narrowDeviceKitchenScreens(tx, cfg, deviceId: string, profileId: string): Promise<NarrowedDevice | null>; // null: it lost nothing; NarrowedDevice is A3a's
```

Decision 21's "Stored" and "Re-adding restores" rules (owner 2026-10-09). Rules the tests pin:

- Taking Deli off a profile's station-screen list: a device that chose Grill and Deli now shows
  Grill and reads Deli `available: false`, keeps Deli in its stored choice, and has one removal row
  for Deli; a device on "every" stays "every" and has one removal row for Deli; a switched-off
  device on the profile is narrowed too; a device on another profile is untouched. The answer
  names each active and switched-off device changed, with Deli.
- A device whose explicit list held only Deli keeps its row and records Deli; a kitchen display so
  emptied is not refused (the narrowing bypasses `kitchen_screen.required`) and reads one
  `available: false` slot.
- Turning a profile's "every station" into [Grill]: an "every" device records every other
  switched-on station it showed.
- Taking the pass monitor off a profile: its pass-monitor devices keep the row, record the kind,
  and read the kind `available: false`.
- **Adding Deli back (owner 2026-10-09):** the device that chose Grill and Deli and has not been
  picked on since shows Deli again, and its Deli removal row is gone; the "every" device likewise;
  a device someone picked on after the narrowing (so it has no removal row) is not given Deli, and
  a pick naming Deli is accepted again. The save's answer names neither as narrowed.
- **A kind offered again:** a kitchen display whose pass screen on [Grill] × [Terrace] was taken
  off its profile and is then offered again on every station and zone shows its pass screen on
  [Grill] × [Terrace] again, with no line.
- **One save restores and narrows:** offering the pass screen again on [Deli] only gives it back to
  that device with Grill recorded as a removal.
- A save that narrows nothing a device shows answers `[]` and writes no removal.
- Saving the device afterwards (`setDeviceKitchenScreens`) leaves no removal row.

- [ ] **Step 1: Failing tests** in `kitchen-screens.test.ts`, one per rule.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/kitchen-screens.test.ts`.
- [ ] **Step 3: Implement** in the same transaction as the profile's write; read each device's
  existing removals before inserting, so nothing is recorded twice.
- [ ] **Step 4: Run; see them pass;** typecheck venue-service, module and server.
- [ ] **Step 5: Commit** — `feat(venue-service): a narrowed profile narrows its devices, and each remembers what it lost (A366)`.

**AS BUILT → CHANGE (owner 2026-10-09, decision 21).** AS BUILT: `narrowDevices` in
`kitchen-screens.ts` deletes the lost stations and zones from each device's explicit lists, and
deletes the device's row of a kind the profile no longer offers or whose explicit list it emptied,
then records removal rows; nothing ever deletes a removal row except a pick; the case "restores
nothing when a station is added back" in `kitchen-screens.test.ts` pins that. → CHANGE, test
first: replace that case with the "Adding Deli
back", "A kind offered again" and "One save restores and narrows" cases above, and change the
emptied-list and pass-monitor cases to expect the device's row kept; watch them fail
(`pnpm --filter @waitron/venue-service exec vitest run --project node src/kitchen-screens.test.ts`).
Then: the narrowing stops deleting from the device's choice and only records; every reader of a
device's choice (`readDeviceKitchenScreens`, `readDevicesKitchenScreens`, `readStationScreens`,
`assertPassScreenZone`, `assertKitchenDisplayHasScreen`, and the narrowing's own "what it
showed before") takes the stored choice
less the device's removal rows, an entry both stored and recorded reading once, `available:
false`; and `setProfileKitchenScreens` deletes, after writing the profile's rows, each removal row
of a device on the profile whose station, zone or kind the profile now allows for that kind. The
`kitchen-screens.test.ts` cases that read a device's stored rows straight from the tables after a
narrowing change to read through `readDeviceKitchenScreens`; list them in the pull request's
notes. Task A5b's switch uses the same restore.

`assertPassScreenZone` still refuses `kitchen_screen.not_allowed` `{ screen: "pass" }` when the
pass screen shows no available station, or its explicit zone list has no available zone: with the
row kept, and `zoneIds: null` meaning every zone, an emptied pass would otherwise accept every
zone. In "refuses a kitchen display whose pass screen a narrowing emptied, for any zone or none"
(`kitchen-screens.test.ts`), change only the `storedKindsOf` line; keep both refusals.

Also written before the change: a kitchen display on [Grill, Deli] whose Deli a narrowing took:
`readStationScreens({ withSwitchedOff: true })` lists only Grill. It passes on the branch today,
because the narrowing deletes Deli from the explicit list, and fails if `readStationScreens` is not
made to leave out recorded removals. The comments this change makes false, to cut: in
`kitchen-screens.ts` at `5f925a618`, `narrowDevices`' doc comment (`:661-665`, "an explicit list
loses what `after` leaves out, a kind … or a list left empty goes"), `assertPassScreenZone`'s
(`:836-839`) and `readStationScreens`' (`:859-861`, "A narrowing deletes what it takes from an
explicit list"); in `schema/kitchen-screens.ts`, the removals table's (`:193-196`, "the narrowing
may delete that row").

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
  reason, `:162-166`), `scripts/schema-constraints.test.ts`, `scripts/migration-upgrade.test.ts`
  (`RESETS`, if the walk needs one); generated `packages/db/drizzle/00NN_*.sql` (two), snapshots,
  journal
- Test: `packages/db/src/schema/order-groups.test.ts`, and a rebuild test (Step 1)

**Interfaces** (decision 19): `order_groups.fired_by_device_id` → `devices.id` (no action),
nullable; CHECK `order_groups_firer_ck`: `fired_by IS NULL OR fired_by_device_id IS NULL`.
`order_group_events.actor_device_id` → `devices.id` (no action), nullable; `actor_id` becomes
nullable; CHECK `order_group_events_actor_ck`: `(actor_id IS NULL) <> (actor_device_id IS NULL)`,
as `watcher_item_marks_done_by_ck` does (`schema/watcher-item-marks.ts:36-39`).

**What the rebuilds meet** (checked 2026-10-08 at `063fcb5cd`):
- No migration names a key into `order_group_events`: `grep -ln 'REFERENCES \`order_group_events\`' packages/*/drizzle/*.sql`
  prints nothing. `order_groups` has two `no action` children,
  `order_group_events.group_id` (`packages/db/drizzle/0028_order_groups.sql:10`) and
  `working_order_lines.group_id` (`0092_positive_price_quantity.sql:35`), so its rebuild fails on
  a box with a party's groups: covered by this slice's venue reset.
- Only two migrations name `order_group_events` (`grep -ln order_group_events packages/*/drizzle/*.sql`:
  `0028_order_groups.sql` and `0036_party_rename.sql`), and the one trigger among them,
  `parties_clear_table_status` (`0036_party_rename.sql:29-38`), reads `dining_tables` and
  `party_tables`, not either table this task rebuilds.
- Its indexes are plain: `order_group_events_party_idx` and `order_group_events_group_idx`
  (`schema/order-groups.ts:84-85`); `order_groups_party_idx` (`:39`).
- Its append-only triggers are not migrations: `applyMigrations` installs them after each set is
  applied (`installAppendOnlyTriggers`, `packages/migrations/src/apply.ts:74`, inside the loop at
  `:69-75`), so a rebuild that drops them is followed by their re-install on the same start.
- Drizzle has added a keyed column with a plain `ADD` before:
  `0028_order_groups.sql:32` (`working_order_lines.group_id REFERENCES order_groups(id)`) and
  `0065_line_make_at_station.sql:1`.

- [ ] **Step 1: Failing tests.** In `order-groups.test.ts`: an event with a device and no person is
  accepted; one with both, and one with neither, are refused by the database; a group with both a
  person and a device firer is refused; a group may record a device as its firer. **A rebuild
  test** that proves the rebuild kept the refusal on old rows: apply the core set up to the
  migration before this task's rebuild (with the upgrade walk's step helper in
  `scripts/migration-upgrade.test.ts`, or drizzle's migrator on a journal cut at that entry,
  whichever is smaller), write an event whose `group_id` is null (a reorder event names no group,
  `schema/order-groups.ts:59`), apply the rest through `applyMigrations`, then check the event
  survived and an update and a delete of it are refused. The event must not point at a group:
  `order_group_events.group_id` is a `no action` key into `order_groups`
  (`packages/db/drizzle/0028_order_groups.sql:10`), so a row pointing at a group makes this task's
  `order_groups` rebuild fail, which on a real box is the venue reset's job, not this test's.
  Before running, say what the failing case prints: the update succeeds (no `RAISE(ABORT)`), the
  event is gone, or a `FOREIGN KEY constraint failed` error.
- [ ] **Step 2: Generate in two steps** (CLAUDE.md §3). First add the two columns and generate; read
  the SQL: it must be `ALTER TABLE … ADD` only, as the precedents above are. If drizzle writes a
  rebuild of `order_groups` for this generation, STOP and ask: a rebuild there also adds a column.
  Then make `actor_id` nullable, add the two checks, and generate; read the SQL: one rebuild of
  each table and no added column.
- [ ] **Step 3:** schema-constraints rows for the two keys and the two checks.
- [ ] **Step 4: Run** Step 1's tests, the Task A2 guard list, `scripts/append-only-triggers.test.ts`,
  `scripts/append-only-migration-sets.test.ts` and `scripts/behavioural-triggers.test.ts`; if the
  upgrade walk loses or refuses rows at either step, add a `RESETS` entry naming exactly what it
  prints, as `core/0090_devices_lose_till`'s does (`scripts/migration-upgrade.test.ts:384-387`).
- [ ] **Step 5: Commit** — `feat(db): a kitchen display can be recorded as the one who fired a group (A366)`.
  The message says the event table is append-only, that its rebuild is allowed only because every
  box needs a venue reset for this slice, and what the rebuild test shows.

---

### Task A5a: Accepting and editing a device write its kitchen screens

From here until A8b a device is written **both ways**: its kitchen screen rows, and the old columns
where an old reader still needs them. With the binding triggers gone (A4) the database no longer
refuses either shape.

**Files:**
- Modify: `apps/server/src/device.ts` (`resolveDeviceBinding :337` → `resolveDeviceKitchenScreens`;
  `updateDeviceSettings :84`, `insertDevice :59`), `join-requests.ts` (`acceptDeviceJoinRequest
  :487`, `returningDevicesOf :257`, which gains `kitchenScreens`), `join-api.ts` (`:330-366`; its
  status map `:58-68` and the comments naming `resolveDeviceBinding` `:49-52`, `:95-98`),
  `device-api.ts` (`PATCH /management-api/devices/:id :568`; status map `:128-144`), `errors.ts`
  (`device.station_required` goes); the dashboard's copies of `device.station_required`, renamed to
  `kitchen_screen.required` in the same change (`apps/dashboard/src/screens/devices-screen.ts:110`,
  `:895`, `apps/dashboard/src/i18n/codes.ts:576`, and `devices-screen.test.ts:1467`, `:2167`,
  `:2215`, `:3949`)
- Test: `device.test.ts`, `join-requests.test.ts`, `join-api.test.ts`, `join-api.db.test.ts`,
  `join-e2e.test.ts`, `device-api.test.ts` (the PATCH cases)

**Interfaces:**

```ts
// device.ts
export async function resolveDeviceKitchenScreens(
  tx: Transaction, cfg: TillConfig,
  input: { profileId: string; kitchenScreens?: readonly DeviceKitchenScreen[] },
): Promise<{ kitchenScreens: readonly DeviceKitchenScreen[]; stationId: string | null; formFactor: FormFactor }>;
// stationId: on a kitchen display, the one station of a station screen with exactly one explicit
// station, else null — what devices.station_id keeps holding until A8b stops writing it, for the
// readers A7 and A8b move (/api/device/station until A7; device-session's DeviceBinding until A8b).
```

The join-accept and PATCH bodies take `kitchenScreens?: DeviceKitchenScreen[]` (absent on PATCH
keeps the stored choice and its removals) in place of `stationId`/`watcherId`.
`acceptDeviceJoinRequest`'s input gains `kitchenScreens` and keeps `stationId` and `watcherId` until
A8b, used only by `enrolDeviceForTest` (Task A5b). Every accept, edit and re-enable that sends
`kitchenScreens` writes the device row with `station_id` from `resolveDeviceKitchenScreens` and then
calls `setDeviceKitchenScreens` in the same transaction.

- [ ] **Step 1: Failing tests:** accepting a kitchen display with a station screen on two stations
  stores it (`readDeviceKitchenScreens`) and leaves `station_id` null; with one station it also
  stores `station_id`; a `kds` accept with none → `kitchen_screen.required`; a till accept with a
  station screen and a pass screen stores both; a till accept with a pass monitor on a profile
  that offers one stores it, and on one that does not → `kitchen_screen.not_allowed` (decision 17,
  owner 2026-10-09); a PATCH without `kitchenScreens` keeps a stored station switched
  off since and the device's removals; a PATCH with them clears the removals.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/device.test.ts src/join-requests.test.ts src/join-api.test.ts src/device-api.test.ts`.
- [ ] **Step 3: Implement;** retire `device.station_required` from every copy
  (`grep -rn '"device.station_required"' apps packages docs/developers` prints nothing after).
- [ ] **Step 4: Run; see them pass;** typecheck the server and the dashboard.
- [ ] **Step 5: Commit** — `feat(server): a device is given its kitchen screens (A366)`.

**AS BUILT → CHANGE (owner 2026-10-09, decision 17).** AS BUILT: `apps/server/src/device.test.ts`
has "a till accepted with a pass monitor is kitchen_screen.not_allowed", on a till profile that
offers kitchen screens. → CHANGE, test first: give that profile a pass monitor row and expect the
accept to store the pass monitor (`readDeviceKitchenScreens`); keep the refusal as a second case on
a till profile with no pass monitor row; add a till accept naming both a pass screen and a pass
monitor → `kitchen_screen.invalid` `{ field: "screens", reason: "one_only" }`. Run
`pnpm --filter @waitron/server exec vitest run src/device.test.ts` and watch the first and third
fail; Task
A3b's change makes it pass.

---

### Task A5b: The test helper, the profile switch, and the fixtures

**Files:**
- Modify: `apps/server/src/testing/enrol.ts`, `device.ts` (`switchActiveProfile :288-330`: its
  `assertProfileBinding` call becomes `narrowDeviceKitchenScreens`, except on the watcher path
  below), `join-requests.ts` (the `stationId`/`watcherId` inputs' handling)
- Test: `device.test.ts`, `device-api.test.ts` (the switch cases), and every suite that enrols a
  kitchen display (`grep -rln "enrolDeviceForTest" apps/server/src`), fixtures only

**Behaviour:** `enrolDeviceForTest(db, cfg, { …, stationId?, kitchenScreen?, watcherId? })` adds
what it is given to the profile (decision 14: `addProfileKitchenScreen`, and today's
`listOnProfile` for the old lists) before accepting. A `stationId` is read as a one-station station
screen; a `watcherId` is written to `watcher_id` with today's checks (`resolveDeviceBinding`'s
watcher half and `assertProfileBinding`) and no kitchen screen. That watcher path skips
`setDeviceKitchenScreens`, which would refuse a kitchen display with none
(`kitchen_screen.required`), so the watcher suites keep passing until A8b moves them and deletes
the path. A profile switch narrows the device against the new profile and records what it lost
(decision 21), never refusing.

- [ ] **Step 1: Failing tests:** enrolling twice with different stations on one profile leaves both
  on the profile; a profile switch to a profile that does not offer the device's station succeeds
  and the device then reads the station `available: false`.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/device.test.ts src/device-api.test.ts`.
- [ ] **Step 3: Implement.** Then run the suites that enrol a kitchen display and fix only fixtures.
- [ ] **Step 4: Run; see them pass;** typecheck the server.
- [ ] **Step 5: Commit** — `test(server): the enrol helper gives kitchen screens; a profile switch narrows (A366)`.

**AS BUILT → CHANGE (owner 2026-10-09, decision 21; the switch-back restore is this revision's
NEW reading).** AS BUILT: `switchActiveProfile` calls `narrowDeviceKitchenScreens`, which narrows
and records but never restores. → CHANGE, test first in `apps/server/src/device-api.test.ts` (the
switch cases): a till that chose Grill and Deli switches to a profile without Deli (reads Deli
`available: false`) and back to the first profile, and then reads Deli `available: true` with no
removal row; a till someone re-picked on in between does not get Deli back. Watch it fail
(`pnpm --filter @waitron/server exec vitest run src/device-api.test.ts`); Task A3c's restore,
called from `narrowDeviceKitchenScreens` as well, makes it pass. The dashboard's device update that
changes the profile also calls `narrowDeviceKitchenScreens` (`apps/server/src/device-api.ts:687` at
`5f925a618`), so add the same restore case there: a PATCH moving a till that chose Grill and Deli to a profile without Deli
and a second PATCH moving it back, neither naming `kitchenScreens`, leaves Deli `available: true`
with no removal row.

---

### Task A6: Profile routes, the device list and the device's own identity; the in-use codes go

**Files:**
- Modify: `apps/server/src/management-api.ts` (profile POST and PUT `:1466-1535`,
  `saveKitchenLists :525-533`, `ProfileBody :558-578`, the status map's in-use rows `:315-316`;
  new `GET /management-api/device-profile-kitchen-screens`), `device-api.ts` (the list
  `GET /management-api/devices :470`, `/api/device/me :261-290`);
  **retiring `device_profile.station_in_use` and `device_profile.watcher_in_use`** (decision 11),
  every copy: `packages/venue-service/src/errors.ts:107-108`, the throwing blocks in
  `profile-access.ts` (`checkLists`, `:462-503`), `packages/module/src/module.ts` (the comment
  `:568`), `apps/dashboard/src/screens/device-profiles-screen.ts` (`inUse`/`inUseSentence`
  `:169-178`), `apps/dashboard/src/i18n/strings.ts` (`device_profiles.station_in_use`,
  `.watcher_in_use`, `:1846-1849`, `:4348-4351`), `apps/dashboard/src/i18n/codes.ts`
  (`:600-607`), `docs/developers/conventions-ui.md` (`:258-262`, which names both codes at
  `:261-262`; Task A18 rereads it for the rest of the slice)
- Test: `management-api.device-profiles.test.ts` (its in-use case `:1224-1265`, code at `:1255`,
  turns red and changes as planned), `device-api.test.ts`, `management-api.test.ts`;
  `packages/venue-service/src/profile-access.test.ts` (`:945-965`, codes at `:949`, `:961`);
  `apps/dashboard/src/screens/device-profiles-screen.test.ts` (`:1318-1355`) and
  `device-profiles-screen.a11y.test.ts` (`:375`) — all listed under "Changed test checks (planned)"

**Interfaces:** profile POST/PUT take `kitchenScreens?: ProfileKitchenScreens` (absent keeps the
stored rows, as an absent `stationIds` does today, `management-api.ts:1473`, `:1508`) in place of
`stationIds`/`watcherIds`; a PUT without them leaves the stored rows alone whatever its form
factor (decision 26 dropped, owner 2026-10-09). PUT's answer gains `narrowedDevices:
NarrowedDevice[]` (decision
21); POST's is always `[]` and is left out. `GET /management-api/device-profile-kitchen-screens`
answers `readProfileKitchenScreens`. `GET /management-api/device-profile-kitchen-lists` stays until
A10a, which drops the tables it reads; the dashboard moves off it in A15, and its tests mock the
client, so they stay green in between. `GET /management-api/devices` rows and `/api/device/me` gain
`kitchenScreens: ResolvedKitchenScreen[]`. The fields that stay until A8b stops writing the columns
behind them: `/api/device/me`'s `stationId` and `watcherId` (`device-api.ts:280-289`; it has no
`binding`) and the list's `binding` (`:525`). The till reads `/api/device/me`'s until A11, the
dashboard reads the list's until A16 and the Prep stations screen until A17
(`routing-client.ts:70-77`); those suites stay green in between because they mock the API client.

- [ ] **Step 1: Failing tests:** `GET /management-api/device-profile-kitchen-screens` answers every
  live profile; a profile PUT naming `kitchenScreens` replaces them and one without leaves them; a
  PUT that drops a station a device shows answers 200, narrows the device and names it and the
  station in `narrowedDevices`; a PUT that adds a pass monitor to a till profile answers 200 and
  stores it (decision 17, owner 2026-10-09); a PUT that changes a device-less kitchen display
  profile with a pass monitor row to `till` without `kitchenScreens` answers 200 and keeps the pass
  monitor row (decision 26 dropped); the device list and
  `/api/device/me` carry the device's kitchen screens, a removed station `available: false`.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/management-api.device-profiles.test.ts src/device-api.test.ts`.
- [ ] **Step 3: Implement;** retire the two codes from every copy above
  (`grep -rn 'station_in_use\|watcher_in_use' apps packages docs/developers` prints nothing after).
- [ ] **Step 4: Run; see them pass;** run the dashboard's two device-profile suites and
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/profile-access.test.ts`;
  typecheck the server, venue-service, module and dashboard.
- [ ] **Step 5: Commit** — `feat(server): profile kitchen screens on the management routes; narrowing a profile is no longer refused (A366)`.

**AS BUILT → CHANGE (owner 2026-10-09, decisions 17 and 26).** AS BUILT:
`apps/server/src/management-api.ts`'s profile PUT calls `checkProfileKitchenScreens` when the body
has no `kitchenScreens`, and `management-api.device-profiles.test.ts` pins two refusals — a PUT
adding a pass monitor to a till profile answers 400 `device_profile.access_invalid`, and "refuses
moving a kitchen display profile with a pass monitor to a till unless the PUT names its kitchen
screens" answers 400 `not_shared_display`. → CHANGE, test first: turn both into acceptances — the
first answers 200 and `GET /management-api/device-profile-kitchen-screens` then holds the till
profile's pass monitor; the second answers 200, the profile reads `formFactor: "till"`, and its
pass monitor row is still there. Watch them fail
(`pnpm --filter @waitron/server exec vitest run src/management-api.device-profiles.test.ts`), then
delete the PUT's call to `checkProfileKitchenScreens` in the same commit as Task A3a's change.

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
  /** Display order. A station a narrowing took has no queue, notices or printers; one switched off
   * on its own page keeps them, so its waiting dishes can be finished (owner 2026-10-09). */
  stations: ({ id: string; name: string; available: true; queue: StationQueueGroup[]; notices: KitchenNotice[]; printersDown: StationPrinterDown[] }
    | { id: string; name: string; available: false; switchedOff: true; queue: StationQueueGroup[]; notices: KitchenNotice[]; printersDown: StationPrinterDown[] }
    | { id: string; name: string; available: false; switchedOff: false })[];
}
```

Built from `readDeviceKitchenScreens`; each available station uses today's per-station readers
(`listStationQueue`, `listStationNotices`, `stationPrintersDown`, as `device-api.ts:405-413`). A
device with no station screen and no recorded station-screen removal answers `device.unauthorized`,
as a device with no station does today (`:401-404`). Any device other than a kitchen display also
needs a session (decision 12). Advance: the item's station must be one the device's station
screen shows — available, or switched off on its own page (owner 2026-10-09) — else
`device.forbidden_station`; a station a narrowing took is refused. Acknowledge: the notice must be
at one of those stations (read its station, then call `acknowledgeKitchenNotice` with that
`stationId`). **NEW (2026-10-09 revision, decision 21):** on a screen whose list and whose
profile's list are both "every", the read also lists, in its display-order place, each
switched-off station whose queue still holds dishes, as `available: false, switchedOff: true`,
until its queue is empty, and Advance accepts its dishes.
Station health's "has a screen" and the dark-screen query read `readStationScreens` (decision 9).
`/api/device/station` answers 404 from here; the till moves to the new route in A12a, and its tests
mock the client, so they stay green.

- [ ] **Step 1: Failing tests:** a two-station screen's read lists both stations with their own
  queues; a narrowed station comes back `available: false` in its display-order place; advancing
  an item at a third station → `device.forbidden_station`; an every-station screen advances it;
  acknowledging a notice at a station outside the screen → not found; a station shown only by an
  every-station kitchen display counts as having a screen; one shown only by a pass screen, a pass
  monitor, or a till's station choice does not; a dark station screen raises the dark-screen alert
  for each of its stations. **No screen is normal (decision 9), each with dishes waiting over an
  hour:** a venue with no kitchen displays raises no `station.screens_dark` or
  `station.default_screens_dark` alert and `stationScreensDark` answers `[]`; a venue whose only
  kitchen displays run pass screens and monitors, all silent, raises none; a till whose station
  choice covers the station and which has not checked in for an hour raises none. Before running,
  say what each failing case would print: an alert keyed `station.screens_dark:<station id>`
  (`alert-sources.ts:356-363`).
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/device-api.test.ts src/station-health.test.ts src/station-outputs-down.test.ts src/alert-sources.test.ts`.
  The no-screen cases pass already (today's behaviour); confirm each can fail by deleting the
  kitchen-display filter from `readStationScreens` (a till then counts) and watching the till case
  fail, then restore it.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; see them pass;** typecheck the server.
- [ ] **Step 5: Commit** — `feat(server): a station screen shows and works its stations; no screen stays normal (A366)`.
  The pull request's description says the no-screen tests exist and that nothing in this slice
  turns "no screen" into a warning.

**AS BUILT → CHANGE (owner 2026-10-09, the 02:25 question, answer "b").** AS BUILT:
`GET /api/device/station-screen` (`apps/server/src/device-api.ts`) reads queues, notices and
printers down only for available stations and sends every unavailable one as `{ id, name,
available: false }`; Advance and Acknowledge accept only available stations (`availableStations`).
The dark-screen alert already counts a switched-off station a kitchen display stores (the A7 fix,
`readStationScreens(…, { withSwitchedOff })`), and must leave out recorded removals once Task A3c
keeps the device's choice. → CHANGE, test first in
`device-api.test.ts`: a kitchen display on Grill and Deli with a dish waiting at Deli; Deli is
switched off on its own page; the read sends Deli `available: false, switchedOff: true` with that
dish in its queue; starting, readying and finishing the dish are accepted; acknowledging a notice
at Deli is accepted; once the dish is done Deli's queue is empty and its entry stays. Controls in
the other direction: Deli taken by a narrowing instead is sent `switchedOff: false` with no queue,
and advancing its dish answers `device.forbidden_station`, and acknowledging a notice at it is
refused as Advance is (Acknowledge follows Advance's rule for a switched-off station's dishes and
notices); an every-station screen under an
every-station profile lists a switched-off station only while its queue holds dishes. Before
running, say what the failing case prints: Deli with no `queue`, and `device.forbidden_station` on
the advance. Watch them fail (`pnpm --filter @waitron/server exec vitest run src/device-api.test.ts`),
then read queues for switched-off shown stations too and let Advance and Acknowledge accept them.

**Slice 3's today state, with answer "b".** A switched-off station the read lists is sent with
slice 3's `today` state, like any other station. Slice 3's `apps/server/src/till-api.station-today.test.ts`
case "shows an assigned station switched off since enrollment" expects that; run 2026-10-09 at
`5f925a618` (`pnpm --filter @waitron/server exec vitest run src/till-api.station-today.test.ts -t
"switched off since enrollment"`), it fails, Grill arriving with no `today`. After this change it
passes with no edit beyond the route and response shape the rebase already moved. A 5A case in
`device-api.test.ts` that pins a switched-off station's station-screen entry as no longer available
with no `today` changes with this answer and goes under "Changed test checks"; at `5f925a618` a
read of the cases calling `switchStationOff` found none reading `/api/device/station-screen`, so
the implementer greps again before calling the list empty.

---

### Task A8a: The pass screen, the pass monitor and Done marks

**Files:**
- Create: `apps/server/src/pass-board.ts` and `pass-board.test.ts` (from `watcher-board.ts` and
  `watcher-board.test.ts`, which stay until A8b), `pass-done-body.ts` (renamed from
  `watcher-done-body.ts`; `till-api.ts:76` and `device-api.ts`' import follow)
- Modify: `device-api.ts` (`/api/device/watcher :363-372`, `/done :374-395` →
  `/api/device/pass-screen`, `/api/device/pass-screen/done`; new `/api/device/pass-monitor`),
  `working-order.ts` (`:3892-3898` also copies `pass_item_marks`), `till-api.profile-actions.test.ts`
  (the "watcher done marks" paragraph at `:97-100` describes `/api/device/pass-screen/done`),
  `till-api.profile-zones.test.ts` (`:151-153`)
- Test: `pass-board.test.ts`, `device-api.pass.test.ts` (new), `working-order.test.ts` (the split
  case)

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
read for this device, scoped to the available stations and zones. `listPassMonitor` filters
`listExpoQueue`'s orders (`working-order.ts:6618-6633`) to the scope's items, dropping an order
left with none. `markPassItems` keeps `markWatcherItems`' location check (`:131-146`); an undo
deletes the device's marks whoever made them. The pass routes answer `{ orders, stations, zones }`,
the last two the `ScreenSlot` lists from `readDeviceKitchenScreens`, so the screen can draw its
"no longer available" lines; a device with no pass screen (or pass monitor, for that route) and no
recorded removal of that kind answers `device.unauthorized`. `POST /api/device/pass-screen/done` on
a kitchen display records `signedInPersonOn(…)` (null today, decision 18); on any other device a
session is required and its person recorded. The watcher routes still answer until A8b.

- [ ] **Step 1: Failing tests:** Review focus 1 and 2: a Terrace-only pass screen does not list a
  Bar dish or a counter sale rung up in the counter's zone; a pass screen limited to the counter's
  zone lists that counter sale (decision 24, owner 2026-10-09); marking Done on device A leaves
  the dish on device B; undoing removes
  only A's mark; a dish split onto another bill keeps A's mark; a till's Done without a session →
  `session.required`, with one → the mark records the person; a kitchen display's mark records no
  person; a pass monitor lists the scope's dishes, drops a fully-away course, and has no marks;
  `/api/device/pass-screen` on a station-screen device answers `device.unauthorized`.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/pass-board.test.ts src/device-api.pass.test.ts src/working-order.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; see them pass;** typecheck the server.
- [ ] **Step 5: Commit** — `feat(server): pass screens and monitors show their stations and zones; Done marks belong to the device (A366)`.

**AS BUILT → CHANGE (owner 2026-10-09).**
- **Decision 24.** AS BUILT: the pass board judges a counter order by its recorded zone already,
  through `orderWatchZones`; `pass-board.test.ts` checks that a Terrace-only pass leaves a counter
  sale out, and `device-api.pass.test.ts` that a pass limited to the counter's zone leaves a table
  order out, but no case checks that a pass limited to the counter's zone shows a counter sale. → CHANGE: add that case to `device-api.pass.test.ts` (a kitchen display
  whose pass screen names only the counter's zone reads the counter sale's dish, and its Done is
  accepted) and to the pass monitor read's cases in `pass-board.test.ts`. It passes on arrival, so prove it can fail: delete the
  recorded-zone fallback in `orderWatchZones` (`apps/server/src/watch-zones.ts`, the
  `findOrderZones` step), watch the new case fail with the dish missing, and restore it.
- **Decision 17.** AS BUILT: `GET /api/device/pass-monitor` already serves any device with a pass
  monitor and asks a device that is not a kitchen display for a session (`kitchenScreenOf`), but no
  case reaches it from a till, which could not hold one. → CHANGE, test first in
  `device-api.pass.test.ts`: a till whose device chose a pass monitor reads the monitor with a
  session (its scope's dishes, no marks) and answers `session.required` without one; Task A3b's
  change makes the first pass.

---

### Task A8b: The old columns stop being written; the watcher routes and references go

**Files:**
- Delete: `apps/server/src/watcher-board.ts`, `watcher-board.test.ts`
- Modify: `device-api.ts` (the old `/api/device/watcher` routes go; the list and `/api/device/me`
  lose `stationId`, `watcherId` and the list's `binding`; the PATCH stops reading the columns
  `:594-595`; `/api/dev/devices :681-692` stops selecting `devices.stationId`; the `watcher.*`
  statuses in the map `:128-144` go), `device-session.ts` (`DeviceBinding :91-101` loses
  `stationId` and `watcherId`, and `deviceBindingColumns :109-110` and the row mapping `:158-159`
  stop reading them), `till-api.ts` (delete `/api/watchers`, `/:id/queue`, `/:id/done`,
  `:1898-1934`, and their imports `:74-76`), `device.ts` (stop writing `station_id` and
  `watcher_id`; `switchActiveProfile`'s reads `:298-299`, `:318-325` go; the watcher path of A5b
  goes) and `join-requests.ts` (stop writing them; drop the `stationId`/`watcherId` inputs;
  `returningDevicesOf` stops selecting them `:267-268`), `join-api.ts` (the `watcher.*` statuses
  `:65`, `:67` go), `testing/enrol.ts` (its `watcherId` option goes), `watchers.ts`
  (`WATCHER_REFERENCES :165-168` loses `devices` and `watcherItemMarks`; `WATCHER_SETTINGS
  :171-176` loses `deviceProfileWatchers`, and its import `:17` goes, since A10a removes that
  export)
- Test: `till-api.watchers.test.ts` (deleted; its cases now live in `device-api.pass.test.ts`),
  `in-use-references.test.ts`, `device-session.test.ts`, `watchers.test.ts` (with
  `WATCHER_REFERENCES` empty, nothing keeps a watcher in use, so removing one deletes it unless the
  request asks to disable it: the helper `bindDevice :46-62`, the cases that call it at `:245`,
  `:417`, `:466`, `:476`, `:495` and `:531`, the profile-list case `:392-412` and the Done-mark case
  `:443` change — each that relied on "in use" passes `disable` or checks deletion instead; changed
  checks), every suite that enrolled with `watcherId`
  (`grep -rln "watcherId" apps/server/src --include='*.test.ts'`)

- [ ] **Step 1: Failing tests:** the removed routes answer 404; an accepted device's `station_id`
  and `watcher_id` are null; deleting a watcher no device names deletes it; afterwards
  `grep -rn "devices\.stationId\|devices\.watcherId\|device\.stationId\|device\.watcherId" apps/server/src --include='*.ts' | grep -v test`
  prints nothing, so A10b can drop the columns.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/device-api.test.ts src/watchers.test.ts src/device-session.test.ts`.
- [ ] **Step 3: Implement.** Nothing should import `watcher-board` (`grep -rn "watcher-board" apps/server/src`).
  Move the `watcherId` fixtures to `kitchenScreen`.
- [ ] **Step 4: Run; see them pass;** typecheck the server.
- [ ] **Step 5: Commit** — `refactor(server): devices stop writing their station and watcher (A366)`.

---

### Task A8c: The kitchen display's pass levers

**Files:**
- Create: `apps/server/src/device-levers.ts` (the six routes, mounted from `device-api.ts`, whose
  error-to-status table `device-api.ts:96-150` gains `kitchen_screen.zone_not_allowed` and
  `kitchen_screen.not_allowed` at 403, as `till-api.ts:466` answers `service_zone.not_allowed`,
  beside its existing `device.forbidden_action` 403; it
  imports `./errors.js`, and throws only server codes — `device.unauthorized`, and
  `device.forbidden_action` through `assertProfileAction`; the zone refusal is venue-service's
  `assertPassScreenZone`) and `device-levers.test.ts`
- Modify: `apps/server/src/order-groups.ts` (`releaseGroup :437-472`, `fireHeldGroupsOfCourse
  :362-407`, `fireGroup :252-274`, the `sentBy` read `:1095-1111`), `working-order.ts`
  (`fireCourse :1871-1893`), `move-bill.ts` (`:360-384`, only if typing forces it),
  `till-api.profile-actions.test.ts` (six rows beside `:86-87`, and a refusing case each),
  `till-api.profile-zones.test.ts` (two rows — "order" and "party", against the device's pass
  zones — and a refusing case each)
- Test: `device-levers.test.ts`, `order-groups.test.ts`, `till-api.profile-actions.test.ts`,
  `till-api.profile-zones.test.ts`

**Interfaces:** a firer is `{ personId: string } | { deviceId: string }`: `releaseGroup`,
`fireHeldGroupsOfCourse`, `fireGroup` and `fireCourse` take it where they take `operatorId` today,
and write `fired_by` or `fired_by_device_id`, and the event's `actor_id` or `actor_device_id`
(decision 19). The session routes pass `{ personId }`, unchanged in behaviour. The `sentBy` read
falls back to the device's label when the group has a device firer.

Routes (device cookie; decision 12): `POST /api/device/orders/:id/courses/:courseId/{fire,ready,away}`
and `POST /api/device/parties/:id/groups/:gid/{fire,ready,away}`, each calling today's verb, in this
order of checks: a device that is not a kitchen display → `device.unauthorized` (a till keeps its
session routes and their zone gate); `assertProfileAction` with `take-orders`, `prepare-orders` or
`hand-over-orders` as the session route does; `assertPassScreenZone` with the order's or party's
zone (decision 24). The group routes take the same body as the session ones (`submissionId`,
`expectedPartyRevision`). They build `PartyCommandArgs` (`till-api.ts:823-829`) with
`operatorId` set to the **device's id**: for Ready and Away that value feeds only the replay
fingerprint (`passStep`, `order-groups.ts:339`; compared at `parties.ts:739-742`), so a retry from
the same device replays and the same submission id from another device or a person is refused
`submission.id_reused`. Fire passes the firer `{ deviceId }` alongside.

- [ ] **Step 1: Failing tests:** a kitchen display's pass fires a course and a group, and the
  group's `fired_by_device_id` is the device, its event's `actor_device_id` too, and its `sentBy`
  is the device's name; Ready and Away move the items as the session routes do; a retried Ready
  with the same submission id replays; without `take-orders` Fire → 403 `device.forbidden_action`
  (likewise Ready without `prepare-orders`, Away without `hand-over-orders`); **a till's cookie on
  each route → `device.unauthorized`**, even with a pass screen choice and a session; a
  station-screen kitchen display → `kitchen_screen.not_allowed`; an order in a zone outside the
  pass's zones → `kitchen_screen.zone_not_allowed` `{ zoneId }`, a counter order on a pass limited
  to other zones included, with the counter's zone; a pass limited to the counter's zone fires that
  counter's order (decision 24, owner 2026-10-09); an order that never recorded a zone on an
  explicit zone list → the same refusal with `zoneId: null`; an every-zone pass fires a counter
  order; a till's session fire still records the person. Each new map row has its refusing case.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/device-levers.test.ts src/order-groups.test.ts src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; see them pass;** typecheck the server.
- [ ] **Step 5: Commit** — `feat(server): a kitchen display runs the pass, recorded as the device (A366)`.

**AS BUILT → CHANGE (owner 2026-10-09, decision 24).** AS BUILT: `device-levers.ts` judges an
order by `orderWatchZones`, so a counter order already carries the counter's zone;
`device-levers.test.ts` has a pass limited to the tables' zone refusing a counter order with the
counter's zone, and an order inserted with no table and no recorded zone refused with `zoneId:
null`; no case fires a counter order from a pass limited to the counter's zone. → CHANGE: add
that case — a kitchen display whose pass screen names only the counter's zone fires, readies and
sends away a counter order's course (200 each). It passes on arrival, so prove it can fail as in
Task A8a (delete the recorded-zone fallback in `orderWatchZones`; the failing case should answer
403 `kitchen_screen.zone_not_allowed` `{ zoneId: null }`; restore). Then reread every comment and test
name in the branch that calls a counter sale zone-less (`grep -rn "counter" apps/server/src
packages/venue-service/src | grep -i "zone"`) and correct any left.

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

**AS BUILT → CHANGE (owner 2026-10-09, decision 23).** AS BUILT: `giveKitchenDisplaysThePass`
(`apps/server/scripts/demo-seed/seed.ts`) adds `run-the-pass`, `take-orders` and
`hand-over-orders` to every kitchen display profile, and `demo-seed/seed.test.ts` and
`dev-setup.test.ts` pin the Kitchen profile's five capabilities in order. → CHANGE, after Task A1's
change to the default, as optional cleanup (`validateCapabilities` drops a duplicate,
`packages/layouts/src/device-profile.ts:56`, so the seed's profile is the same either way): the seed
adds only `run-the-pass`; rerun
`pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.test.ts scripts/dev-setup.test.ts`;
the profile must still hold the same five, and a pin that fails only on their order changes to the
order the store now gives, listed in the pull request's notes.

---

### Task A10a: The profile's station and watcher lists go (venue-service)

**Files:**
- Modify: `packages/venue-service/src/schema/service.ts` (drop `deviceProfileStations`,
  `deviceProfileWatchers`, `:219-261`), `classification.ts`, `configuration-transfer.ts`
  (`:557-558`), `migrations.test.ts`, `profile-access.ts` (delete the kitchen-list half,
  `readProfileKitchenLists` to `writeLists`, `:311-529`, and the `stationIds`/`watcherIds` of
  `readProfileServiceAccess :51-90`) and the matching cases of its test, `service.ts`,
  `errors.ts` (`watcher.not_allowed`); `packages/module/src/module.ts` (the three old members and
  the two fields); `apps/server/src/management-api.ts` (`GET /management-api/device-profile-kitchen-lists
  :1435` goes with the tables it reads); `apps/server/src/testing/enrol.ts` (`listOnProfile`'s old
  half), `testing/clear-provision-fixture.ts` (`device_profile_stations` and
  `device_profile_watchers` leave its list); `apps/dashboard/src/api/live-queries.ts`
  (`device_profile_stations` and `device_profile_watchers` leave `listProfileKitchenLists`
  `:285-291`, so no list names a dropped table before A15 replaces the entry);
  **retiring `watcher.not_allowed`** (decision 11), every copy: `device-api.ts:142`,
  `join-api.ts:67` (if A8b left them), `apps/till/src/widgets/profile-dialog.ts:19`,
  `apps/till/src/i18n/codes.ts:451-454`, `apps/dashboard/src/screens/devices-screen.ts:113`,
  `apps/dashboard/src/i18n/codes.ts:596`; `scripts/schema-constraints.test.ts` (decision 16:
  `:97-100`)
- Create: venue-service — a generated migration dropping the two profile list tables.

- [ ] **Step 1: Failing tests:** venue-service `TABLES` without the two list tables;
  `/management-api/device-profile-kitchen-lists` answers 404; `readProfileServiceAccess` has no
  `stationIds` or `watcherIds`.
- [ ] **Step 2: Generate** — `pnpm --filter @waitron/venue-service db:generate`. Read the SQL: two
  `DROP TABLE`s.
- [ ] **Step 3:** retire `watcher.not_allowed`
  (`grep -rn '"watcher.not_allowed"' apps packages docs/developers` prints nothing after).
- [ ] **Step 4: Run** Step 1's tests, the Task A2 guard list, `scripts/errors-reachable.test.ts`, the
  till's profile-dialog suite and the dashboard's devices-screen suite; typecheck venue-service,
  module, server, till and dashboard.
- [ ] **Step 5: Commit** — `feat(venue-service): profiles lose their station and watcher lists (A366)`.

---

### Task A10b: Migrations — devices lose their binding columns (venue reset required)

**Files:**
- Modify: `packages/db/src/schema/devices.ts` (drop `stationId`, `watcherId` and their
  `v8 ignore` pairs), delete `schema/watcher-item-marks.ts` and its exports, `classification.ts`,
  `schema/watchers.test.ts` (the import `:20`, the mark cases `:150-193` and their helper
  `seedTicketAndDevice :78-148`, which writes `devices.stationId` at `:142`; they describe the
  dropped table and column; changed checks); `apps/server/src/testing/clear-provision-fixture.ts`
  (`watcher_item_marks` leaves its list); every remaining fixture that sets `stationId` or
  `watcherId` on a `devices` insert — the typechecks of db, venue-service and server name them; at
  `063fcb5cd` among them `receipt-print.test.ts:1437`, `management-api.test.ts:379`,
  `packages/db/src/schema/devices.test.ts`, `devices.fk.test.ts`,
  `device-profiles.trigger.test.ts`, `packages/venue-service/src/profile-access.test.ts`;
  `scripts/schema-constraints.test.ts` (decision 16: `:109-110`, `:245-247`, `:411`),
  `scripts/migration-upgrade.test.ts` (`RESETS`)
- Create: core — a `--custom` migration dropping `device_profile_form_factor_locked`; a generated
  one dropping `watcher_item_marks` and rebuilding `devices`; a `--custom` one re-creating
  `device_profile_form_factor_locked` exactly as `0091_devices_recreate_triggers.sql:5-14` has
  it.

The `0089`–`0091` precedent explains the order (`0089_devices_drop_triggers.sql:1-3`): a rebuild
drops the triggers on the table silently, and its rename fails while a trigger on another table
names `devices`. **This rebuild fails on any box with a sign-in or a sale** (Global constraints):
that is this slice's required venue reset.

- [ ] **Step 1: Failing tests:** `packages/db` — `devices` has no `station_id` or `watcher_id`;
  `device_profile_form_factor_locked` still refuses a form factor change under an active device
  (`schema/device-profiles.trigger.test.ts` keeps passing).
- [ ] **Step 2: Generate** in the order above. Read the rebuild SQL.
- [ ] **Step 3: Run** `pnpm exec vitest run scripts/migration-upgrade.test.ts` and add a `RESETS`
  entry for each step it refuses or that loses rows, naming exactly what it prints, as
  `core/0090_devices_lose_till`'s entry does (`scripts/migration-upgrade.test.ts:384-387`).
- [ ] **Step 4: Run** Step 1's tests, the Task A2 guard list, `scripts/append-only-triggers.test.ts`,
  `scripts/behavioural-triggers.test.ts`, `scripts/apply-migrations-callers.test.ts` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`; typecheck db,
  venue-service and server.
- [ ] **Step 5: Commit** — `feat(db): devices lose their station and watcher columns (A366) — venue reset required`.
  The message lists every table with a key into `devices` and its `ON DELETE` (rescan
  `packages/*/drizzle/*.sql` for `` REFERENCES `devices` ``), and says that the rebuild refuses on
  any box holding a row in a `restrict` or `no action` child — any box with a sign-in or a sale —
  and deletes the rows of the `cascade` children, so every box needs a venue reset.

---

### Task A11: The till boots a kitchen display by its kind of screen

**Files:**
- Modify: `apps/till/src/api/client.ts` (`DeviceIdentity :1362-1372` gains `kitchenScreens`, loses
  `stationId` and `watcherId`; `DevDevice :1453-1459` loses `stationId`, as `/api/dev/devices` did
  in A8b), `till-app.ts` (boot `:2310-2322`), `i18n/strings.ts`
- Test: `till-app-boot-and-counter.test.ts`, `till-app.test.ts`, `api/client.test.ts`

**Behaviour:** the boot chooses by the kind of the device's one kitchen screen and **keeps today's
two client calls**: a station screen reads `getDeviceStation` and a pass screen `getDeviceWatcher`,
as the boot does today (`till-app.ts:2316-2317`); a pass monitor shows a placeholder line, "This
screen will show the pass queue." / "Esta pantalla mostrará los pedidos del pase.", and no queue.
Each later task swaps in its own branch: A12a the station screen's call, A14 the pass screen's,
A14b the monitor in place of the placeholder. (Those old routes answer 404 on the server from A7
and A8b; the till's suites mock the client, so every commit stays green, and the swaps land before
the pull request.) A kitchen display with no kitchen screen shows "This screen has nothing to show
yet. Ask a manager to choose a screen for it in Devices." / "Esta pantalla aún no tiene nada que
mostrar. Pide a un responsable que le elija una pantalla en Dispositivos." and no queue; one whose
kind a narrowing removed shows "This screen is no longer available: Pass screen" / "Esta pantalla
ya no está disponible: Pantalla del pase" (decision 21), and no queue.

- [ ] Steps: failing tests (boot picks the call by kind; the placeholder; the two sentences; axe in
  both themes); watch them fail (`pnpm --filter @waitron/till exec vitest run src/till-app-boot-and-counter.test.ts src/till-app.test.ts`);
  implement; pass; commit `feat(till): a kitchen display boots by its kind of screen (A366)`.

---

### Task A12a: The kitchen display's station screen — stacked, and what is no longer available

**Files:**
- Modify: `apps/till/src/api/client.ts` (`DeviceStation :1440` → `DeviceStationScreen`;
  `getDeviceStation :2560` → `getDeviceStationScreen`), `screens/till-station-screen.ts` (device
  mode: `#loadDevice :284-304`, `#adoptDeviceStation :312-318`, `#renderDevice :518-520`; advance
  and acknowledge keep their device verbs), `till-app.ts` (the `DeviceStation` import `:175`,
  `initialDeviceStation :1613`, the boot's station branch `:2317`), `widgets/card-grid.ts`
  (the `DeviceStation` import `:24`, `kds-board :394-411`), `i18n/strings.ts`; the till test suites
  whose API stubs name `getDeviceStation` (`grep -rln getDeviceStation apps/till/src`)
- Test: `till-station-screen.test.ts`, `.a11y.test.ts`, `api/client.test.ts`

**Behaviour:** decision 7's stacked view — one section per station, in the order the server sends,
each headed by its name with its own queue, notices and printers-down line; a station that is no
longer available keeps its section, holding "This station is no longer available: Deli" /
"Esta estación ya no está disponible: Deli" (decision 21) — only that line for a station a
narrowing took, and the line above its waiting dishes, which work as any others, for a station
switched off on its own page (owner 2026-10-09). One station renders as today. With no available
station and no waiting dish, only those sections.

- [ ] Steps: failing tests (two stations render two sections with their own items; bumping in the
  second section calls `deviceAdvance` for that item; a narrowed station's line sits between its
  neighbours' sections; nothing left shows only the lines; axe in both themes); watch them fail
  (`pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts src/screens/till-station-screen.a11y.test.ts`);
  implement; pass; look at a two-station display at 1280 and 390 in both themes; commit
  `feat(till): a kitchen display's station screen shows each of its stations (A366)`.

**AS BUILT → CHANGE (owner 2026-10-09, the 02:25 question, answer "b").** AS BUILT: in
`till-station-screen.ts`'s device mode every unavailable station's section holds only its line,
and when no station is available the screen hides its view toggles and shows the
`kitchen_screen.choose_again` guidance (the look-pass fix). → CHANGE, test first in
`till-station-screen.test.ts`: with the client stub answering Deli `available: false,
switchedOff: true` with one waiting dish, Deli's section shows the line and then that dish, and
bumping it calls `deviceAdvance` for it; a `switchedOff: false` Deli still shows only the line; a
screen whose only station is switched off with a dish waiting keeps its toggles and shows the dish,
not the guidance, and shows the guidance again once that queue is empty; axe in both themes for the
section with dishes. Watch them fail
(`pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts src/screens/till-station-screen.a11y.test.ts`),
then draw a switched-off station's queue below its line. Look at it at 1280 and 390, both themes,
EN and ES; client type `DeviceStationScreen` follows Task A7's.

---

### Task A12b: The kitchen display's station screen — merged view and the switch

**Files:**
- Modify: `apps/till/src/screens/till-station-screen.ts` (device mode), `widgets/station-queue.ts`
  (an optional station label on each dish), `i18n/strings.ts`
- Test: `till-station-screen.test.ts`, `.a11y.test.ts`, `widgets/station-queue.test.ts`

**Behaviour:** decision 7's merged view and switch: with two or more stations, a switch "Stacked" /
"Merged" ("Por estación" / "Todo junto") beside the existing view toggle; Merged shows one queue,
oldest first, each dish labelled with its station's name, with the stations' notices,
printers-down lines and "no longer available" lines above it in station order. It opens Stacked;
the choice is remembered in local storage under a key holding the device id (read wrapped, as
`till-lock-screen.ts:216-221` wraps its read) and restored on the next load. One station shows no
switch.

- [ ] Steps: failing tests (the switch appears with two stations and not with one; Merged shows
  one queue with labels; bumping in Merged advances that item; the choice survives a reload and is
  per device id; a local storage that throws leaves it Stacked; axe in both themes for both views);
  watch them fail (`pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts src/widgets/station-queue.test.ts`);
  implement; pass; look at both views at 1280 and 390 in both themes, EN and ES; commit
  `feat(till): a kitchen display's station screen can merge its stations into one queue (A366)`.

**AS BUILT → CHANGE (owner 2026-10-09, the 02:25 question, answer "b").** AS BUILT: the merged
view's one queue holds available stations' dishes only. → CHANGE, test first: a switched-off
station's waiting dishes join the merged queue, labelled with its name, oldest first among the
rest, while its line stays above the queue with the others, and its notices sit there with the
line, as in the stacked view; bumping one advances it. Watch it fail
(`pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts`), then
implement; look at it in Merged at 1280 and 390.

---

### Task A12c: The till's Station screen follows its device's choice

**Files:**
- Modify: `apps/till/src/screens/till-station-screen.ts` (operator mode: `#load :267-278`,
  `#restoreStation :196-207`, `#body`, `#pick :629-640`), `i18n/strings.ts`
- Test: `till-station-screen.test.ts`

**Behaviour:** decision 20. In operator mode the screen reads the device's kitchen screens
(`getDeviceIdentity`, which Task A11 widened) with the station list when it loads. With a station
screen choice, the picker lists only its available stations, the default falls back to the first
of them, and the "no longer available" lines sit above the picker in station order; with no choice
it lists every station, as today.

- [ ] Steps: failing tests (a till that chose Grill and Fryer shows two picks; a narrowed Fryer
  shows its line and one pick; no choice shows every station; an address naming a station outside
  the choice opens the first chosen one); watch them fail
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
the "no longer available" lines above the board; with a pass monitor choice (decision 17, owner
2026-10-09) it reads `getDevicePassMonitor` and is the monitor — no Done, no Fire, Ready or Away
whatever `runsPass` says, no reprint, the lines above it; without either it reads `getExpoQueue` as
today's "All stations" does. Fire, Ready and Away show only when `runsPass` is true (decision 3)
and call today's session routes. The order screen's and station screen's Fire are unchanged (Review focus
7). The embedded `expo` card stays on `getExpoQueue`.

- [ ] Steps: failing tests (no chooser at a till; levers absent without `runsPass` and present with
  it; a till with a pass choice marks Done through `markDevicePassDone` and its Undo reverses it;
  a till without one reads the expo queue and shows no Done; the order screen still offers Fire on
  a profile without `run-the-pass`; axe in both themes); watch them fail
  (`pnpm --filter @waitron/till exec vitest run src/screens/till-expo-screen.test.ts src/till-app.test.ts`);
  implement; pass; look in both themes at 1280 and 390; commit
  `feat(till): the Pass screen follows its device's choice and the profile's "Run the pass" (A366)`.

**AS BUILT → CHANGE (owner 2026-10-09, decision 17).** AS BUILT: at a till, `#loadChoice` in
`till-expo-screen.ts` looks only for a `pass` kitchen screen and shows the device's pass screen or
All stations; the `monitor` mode (Task A14b) is set only for a kitchen display. → CHANGE, test first
in `till-expo-screen.test.ts`: a till whose identity carries a `pass_monitor` choice reads
`getDevicePassMonitor` and draws the monitor — no `button` and no `wt-button`, even with
`runsPass` — with its "no longer available" lines; a narrowed-away monitor shows its line and no
board, as a narrowed-away pass screen does; a till with a `pass` choice is unchanged. Watch it fail
(`pnpm --filter @waitron/till exec vitest run src/screens/till-expo-screen.test.ts`), then let
`#loadChoice` select the monitor mode for a `pass_monitor` choice. Look at it at 1280 and 390, both
themes. The till's Pass screen must draw no levers when its choice is the monitor: on the branch
`#drawsLevers()` and `#onDevice()` (`till-expo-screen.ts:785-791` at `5f925a618`) read the
`monitor` property, not the chosen board, and the no-button case above catches a till that draws
them.

---

### Task A14: The kitchen display's pass screen, with its levers

**Files:**
- Modify: `apps/till/src/api/client.ts` (`WatcherSummary :1560`, `WatcherBoard :1575`,
  `getDeviceWatcher`, `markDeviceWatcherDone`, `:2564-2569` → `PassScreen`; new device lever
  methods; the screen's imports `till-expo-screen.ts:23-26`), `screens/till-expo-screen.ts`
  (device mode: `connectedCallback :484-496`, `#reload`'s device read, `#isWatcher :774` →
  whether the board keeps dishes until Done, the lever guards `:870`, `:1034` call the device
  lever methods in device mode, `#done` and `#undo :609-648`), `till-app.ts` (the `WatcherBoard`
  import `:176`, `initialDeviceWatcher :1614`, the boot's pass branch `:2316`, `:8494`,
  `:8600-8606`; pass `runsPass` from the profile's capabilities to the device-mode screen),
  `widgets/card-grid.ts` (the `WatcherBoard` import `:25`, `kds-board :394-411`), the till test
  suites whose API stubs name `getDeviceWatcher` or `markDeviceWatcherDone`, `i18n/codes.ts` (the
  `kitchen_screen.*` codes a lever can answer)
- Test: `till-expo-screen.test.ts`, `.a11y.test.ts`, `widgets/card-grid.test.ts`,
  `i18n/codes.test.ts`

**Behaviour:** on a kitchen display with a pass screen the board is the device's
(`getDevicePassScreen`), with Done and Undo on each dish, the "no longer available" lines above
it, and, when its profile has "Run the pass", Fire (fire control `expo`), Ready and Away through
the device lever routes; a refusal shows its code's sentence. Its title is the device's name.
Reprint stays off in device mode (`till-expo-screen.ts:812`).

- [ ] Steps: failing tests (a pass screen's Done calls `markDevicePassDone` and Undo reverses it;
  levers present with `runsPass` and absent without; Fire calls the device route; a
  `device.forbidden_action` answer and a `kitchen_screen.zone_not_allowed` answer each show their
  sentence; the title; axe in both themes); watch them fail
  (`pnpm --filter @waitron/till exec vitest run src/screens/till-expo-screen.test.ts src/widgets/card-grid.test.ts src/i18n/codes.test.ts`);
  implement; pass; look in both themes at 1280 and 390; commit
  `feat(till): a kitchen display runs the pass (A366)`.

---

### Task A14b: The kitchen display's pass monitor

**Files:**
- Create: `apps/till/src/screens/till-pass-monitor-screen.ts`, its `.test.ts` and `.a11y.test.ts`
- Modify: `apps/till/src/api/client.ts` (`getDevicePassMonitor`), `till-app.ts` (the boot's
  placeholder from A11, and the `station` case `:8599-8614`, draw the monitor for a pass monitor),
  `i18n/strings.ts` (the placeholder line goes)

**Behaviour:** decision 17. A full-screen pass queue — the till's pass cards, read-only — titled
with the device's name, refreshed as the pass screen refreshes, with the "no longer available"
lines above it. No button of any kind: no Done, no levers, no reprint, no view toggle. Built from
`till-expo-screen`'s card markup with every action left out, or as that screen in a `monitor` mode
if that is smaller; either way a test asserts the screen contains no `button` and no `wt-button`.

- [ ] Steps: failing tests (the monitor lists the read's orders; it contains no button; a narrowed
  zone shows its line; a stale read shows the stale line; the boot draws it instead of the
  placeholder; axe in both themes); watch them fail
  (`pnpm --filter @waitron/till exec vitest run src/screens/till-pass-monitor-screen.test.ts src/till-app-boot-and-counter.test.ts`);
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
`show-expo`), when on, the same lists, read "Every station" when the profile has no row; and under
"Pass" a "Pass monitor" switch which, when on, shows the monitor's own station and zone lists, off
by default (a pass monitor is offered only by a row; decisions 2 and 17, owner 2026-10-09). A
switched-off entry a list already holds is shown marked, as `#kitchenChoices` marks them today.
Changing the form factor drops nothing from the draft (decision 26 dropped, owner 2026-10-09). A
refusal lands under the list its `field` names. An edit sends `kitchenScreens` only when they
changed, as `#kitchenListsToSend` sends the lists today.
After a save whose answer names devices, a status line lists them, for example "Saved. Pantalla
Pase no longer shows Deli." / "Guardado. Pantalla Pase ya no muestra Deli." (decision 21). Duplicate
copies the kitchen screens with only their switched-on stations and zones, as it copies the lists
today (`#duplicate`); a kind whose explicit list would be left empty is not copied. Save rule: the
kitchen screens are part of the editor's draft; Save stays quiet until they change and quiet again
when the change is undone; leaving with a changed list asks; #1422's reconnect case.

- [ ] Steps: failing tests per behaviour, including the save-state, reconnect and narrowed-devices
  cases, a till profile saving a pass monitor, and a form factor change that keeps the pass
  monitor in the draft and in what is sent; watch them fail (`pnpm --filter @waitron/dashboard exec vitest run src/screens/device-profiles-screen.test.ts src/screens/device-profiles-screen.unsaved.test.ts src/screens/device-profiles-screen.save-state.test.ts`);
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
  body `:3013-3019`), `api/live-queries.ts` (`listDevices :292-307`: drop `watchers`, add the four
  device kitchen screen tables), `i18n/strings.ts`, `i18n/codes.ts`
- Test: `devices-screen.test.ts`, `.a11y.test.ts`, `.save-state.test.ts`,
  `device-edit.unsaved.test.ts`, `device-pair.unsaved.test.ts`;
  `scripts/live-subscriptions.test.ts`, `scripts/native-form-fields.test.ts`

**Behaviour:** Pair and Edit. For a kitchen display: "Screen" (a `wt-combobox` of the kinds the
profile offers), then "Every station" or station switches within the profile's list, and for a
pass screen or pass monitor "Every zone" or zone switches. For a till or handheld: "Kitchen screen
shows" and "Pass screen shows", each optional ("Every station" when not set),
offered when the profile shows that screen. **Owner 2026-10-09 (decision 17):** the Pass choice is
a pass screen or a pass monitor, one or the other, the monitor offered only when the profile
offers one; choosing it shows its station and zone lists within the profile's monitor row.
Changing the profile clears a choice the new profile does not offer (as the binding is cleared
today, `devices-screen.ts:1176-1182`). In Edit, each recorded removal is listed marked "No longer
available" ("Ya no está disponible"), not editable and not part of the draft, while a switched-off
entry stays in the choice, marked as switched off: opening the dialog does not make it changed; a
save that changes the kitchen choice clears the removals, and a save that does not touch it sends
no kitchen screens and leaves them (decision 21). Because a narrowing now keeps the device's stored
choice (decision 21, owner 2026-10-09), the draft must be built only from the entries the read
marks available or switched off, never from the stored rows, so a save cannot send back an entry
the profile took away. The device list reads "Station
screen: Grill, Fryer" / "Pass screen: every station · Terrace" / "Pass monitor: every station ·
every zone", with "(Deli no longer available)" after a list that lost one; after a profile save
gives Deli back to the device, the list shows Deli with no such note. Save rule: the kitchen
screens are part of both drafts; Edit stays quiet until they change; Pair keeps `savableAtOpen`;
leaving with a changed choice asks; #1422's reconnect case in both `*.unsaved.test.ts`.

- [ ] Steps: failing tests per behaviour, including a till paired with a pass monitor, a till
  offered no monitor by its profile, and an Edit whose read holds a removal that the save does not
  send back; watch them fail
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
  `dashboard/live-queries.ts` (`routing :17-41`: add the device kitchen screen tables),
  `dashboard/strings.ts` (`watchers.new` `:68`, `:741`, if nothing else reads it)
- Test: `prep-stations-screen.test.ts` and `watcher-form.unsaved.test.ts` (as planned under
  "Changed test checks (planned)"), `dashboard/live-queries.test.ts`;
  `scripts/live-subscriptions.test.ts`

**Behaviour:** the read-out lists the devices whose choice shows the station, of any kind and form
factor, an "every station" choice showing all but its recorded removals (decision 25), each with
its kind ("Pantalla Cocina — station screen"). The tab row's actions hold "New station" only
(decision 22).

- [ ] Steps: failing tests (a station screen on Grill, a pass screen on every station and a till
  that chose Grill all appear on Grill's row; a till with no choice does not; a device whose
  removal names Grill does not; there is no `[data-test="new-watcher"]`; an existing watcher still
  opens and saves from the Watchers tab); watch them fail
  (`pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/prep-stations-screen.test.ts src/dashboard/watcher-form.unsaved.test.ts`);
  implement; pass. **Look at the Prep stations tab row in Spanish at 390 px wide, in both themes:**
  every tab and the "Nueva estación" button must show whole. Try it without the 50% cap first; keep
  the cap only if the look needs it. The pull request says what was looked at and what it showed.
  Commit `feat(venue-service): stations name the devices that show them; watchers can no longer be added (A366)`.

---

### Task A18: Documentation and backlog

**Files:** `docs/developers/conventions-ui.md` (`:246-249`, "A kitchen display may only prepare",
which decision 23 makes false; `:258-262`, the station and watcher lists, whose in-use sentence
Task A6 already corrected), `docs/developers/design-system.md` (any line naming the device's "Shows" choice or the
profile's station and watcher lists: `grep -n "watcher list\|Shows" docs/developers/design-system.md`),
`docs/backlog.md` and `docs/backlog/service-periods.md` (A366: slice 5 Part A built; Part B waits
for slice 4)

- [ ] Read every claim about kitchen displays, watchers on devices, Done marks and a kitchen
  display's actions across `docs/developers/` (CLAUDE.md §1: a behaviour change retires every
  receipt about the old one), correct each, and commit `docs: devices run kitchen screens and monitors (A366)`.

Then run `/finish-branch` with this worktree and this plan. Pull request's first line: **"venue
reset needed — required: the migration refuses on any box with a sign-in or a sale, and the box
will not start until it is reset"**. Its description also says: the no-screen tests (Task A7) and
that nothing in this slice turns "no screen" into a warning; the Prep stations tab row look (Task
A17); that between this pull request and slice 4 the dashboard cannot add a watcher, while a
venue being set up can still start with one by importing a configuration that has one (the import
runs only at setup, `apps/server/src/boot.ts:1017-1046`; decision 22); and the changed test checks.

---

## Part B — watchers retired (second pull request, after slice 4)

These tasks are outlined from today's code. **Slice 4 changes the same printing files**, so before
writing tests, re-ground each one: `grep -rn "watcher\|Watcher" apps/server/src packages/printing/src packages/venue-service/src apps/dashboard/src --include='*.ts' | grep -v test`
and `grep -rn "makes_and_watches" apps packages --include='*.ts'`. If slice 4's combined tickets
are not on `main`, or a pass ticket today still comes only from a watcher printer, STOP and ask.
After Part A no screen shows a watcher and the dashboard cannot add one (decision 22); what is left
is the venue's existing watchers as printer settings, and those a new venue imports at setup.

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
  Task A2 and A10b guard lists; add `RESETS` entries naming what the walk prints; commit
  `feat(db): watchers are retired (A366) — venue reset needed`. Then `/finish-branch`; the pull
  request's first line: **"venue reset needed"**, with the reason the walk printed.

---

## New decisions this revision made

Each is a default the owner may override; the decision it sits in has the detail. The owner
answered all but 18 on 2026-10-09: 19, 20, 22, 25 and 13's additions stand; 17, 21, 23 and 24
changed and 26 was dropped, as marked below. The 2026-10-09 revision added the few defaults marked
"2026-10-09 revision", which the owner may still override.

- **17 (owner 2026-10-09: overridden).** Any profile may offer a pass monitor; it shows the
  till's "All stations" pass read limited to its stations and zones, so fully-away courses drop
  off. **2026-10-09 revision:** on a till or handheld the monitor is its Pass screen, offered only
  by a profile row, and it is a pass screen or a pass monitor, not both.
- **18.** A kitchen display's sign-in with a long idle logout is backlog entry A436, not this slice
  (it needs a sign-in route, a lock screen and an admission list for kitchen displays; the
  30-minute timeout is then the existing profile setting).
- **19.** A kitchen display's Fire records the device: `order_groups.fired_by_device_id` (at most
  one firer, by a check) and `order_group_events.actor_device_id` with `actor_id` nullable (exactly
  one actor) — rebuilds of both tables, one of them append-only, allowed by the venue reset;
  "sent by" shows the device's name. Override: no Fire on a kitchen display until it can sign in.
- **20.** A till's or handheld's choice is optional: with none, its Station and Pass screens work
  as today; with a pass choice its Pass screen keeps dishes until Done; the Station screen keeps
  its picker; a till never counts as a station's screen; its session routes keep the profile's
  zone gate and do not refuse dishes outside its choice.
- **21 (owner 2026-10-09: overridden).** A narrowing records what each device on the profile
  lost (switched-off devices and "every" devices included) and the device shows the line; adding
  the station back gives it back, and clears the line, on a device still showing it, and not on
  one someone has picked on since; a pick clears the record; a station or zone switched off on its
  own page is worked out on read instead; the line shows in the station's own section of the
  stacked view, and above the queue, board or picker elsewhere; a profile switch on a till narrows
  the same way. **2026-10-09 revision:** the narrowing keeps the device's stored choice so a
  restore is exact; a kind or zone comes back by the same rule; a switch back to a profile restores
  as a save does.
- **The build's 02:25 question (owner 2026-10-09: "b").** A station switched off on its own page
  keeps its waiting dishes on a kitchen display's station screen, under its line, workable until
  done. **2026-10-09 revision:** an every-station screen under an every-station profile lists a
  switched-off station only while dishes wait there.
- **6 (refinement).** A device's "Every station" means every station its profile allows less its
  recorded removals, and may be chosen under an explicit profile list.
- **22.** The "New watcher" button (and the form's new mode) leaves in Part A; between Part A and
  slice 4 the dashboard cannot add a pass-ticket printer, though a venue being set up can still
  start with one by importing a configuration that has one (the import runs only at setup,
  `apps/server/src/boot.ts:1017-1046`).
- **23 (owner 2026-10-09: overridden).** A kitchen display profile may also hold `take-orders`
  and `hand-over-orders`, which only its pass levers check, and new venues' kitchen display
  profile holds both.
- **OPEN QUESTION — does "Run the pass" come switched on (decision 23)?** Worked example: a new
  venue's kitchen display profile offers no screen at all, so a manager adds a pass screen to the
  Kitchen profile before any pass works. With "Run the pass" on by default for a new pass screen,
  Fire, Ready and Away appear at once; otherwise the manager must also tick it. Default as built:
  not ticked.
- **OPEN QUESTION — a switched-off station on a pass screen or monitor.** Answer "b" was about the
  station screen; a pass screen or pass monitor still drops a switched-off station's dishes.
  Default: as written (they drop).
- **2026-10-09 revision, around answer "b" and decision 21** (the owner may override each):
  - "b" applies only on a kitchen display's station screen; a till's Station screen and the pass
    keep the old rule.
  - A device re-picked as "Every station" gets Deli back when Deli is re-added to the profile,
    because "every" follows the profile.
  - A till that chooses a pass monitor loses Fire, Ready and Away on its Pass screen.
  - A switch back to a profile restores what the first switch took, as a re-add does.
- **24 (owner 2026-10-09: clarified).** A kitchen display's lever checks the order's zone against
  its pass zones, not its stations, refusing `kitchen_screen.zone_not_allowed`; a counter order's
  zone is the one it was rung up in, as `main` already reads it, and only an order that never
  recorded a zone is refused with `zoneId: null` on an explicit zone list; Fire, Ready and Away act
  on the whole course or group. The device lever routes refuse every device that is not a kitchen
  display.
- **25.** The Prep stations read-out lists every device whose choice shows the station, tills
  included; a device with no choice is not listed.
- **26 (owner 2026-10-09: dropped).** Changing a profile's form factor keeps its pass monitor;
  nothing is refused.
- **13 (additions).** The demo's monitor is named "Monitor Pase" and shows every station and zone;
  the demo's kitchen display profile gets "Run the pass", take orders and hand over so Pantalla
  Pase shows its levers.
- **Wording.** "Station screen" / "Pantalla de estación", "Pass screen" / "Pantalla del pase",
  "Pass monitor" / "Monitor del pase"; "Stacked" / "Por estación" and "Merged" / "Todo junto" for
  decision 7's switch; the "no longer available" sentences in decision 21; the kitchen display
  action hints rewritten in Task A1.
