# Prep stations, slice 4 — combined tickets, period choices in routing, and no station hours (A366)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation.
>
> **Existing assertions.** The campaign queue's owner decision of 2026-10-05 governs: a check that
> pins behaviour this plan removes (listed under "Behaviour this slice removes") is changed to check
> the new behaviour at least as strictly, in a separate commit whose message begins
> `Changed test checks (A366 slice 4):` and lists each `file:line` with its before and after, and
> the pull request repeats the list under "Changed test checks". Any other assertion that turns out
> to need changing is a STOP: report it, do not edit it. Adding fixture rows, or a key to a
> whole-shape pin, is allowed.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> **Green between tasks.** Before its commit, every task runs its package's whole node project
> (`pnpm --filter @waitron/venue-service exec vitest run --project node`;
> `pnpm --filter @waitron/server exec vitest run` for `apps/server`, which has one project), the
> browser files it touched, and the typecheck of every package it touched. A task touching a
> browser package checks headroom first (`memory_pressure | grep free`). Read each run's `Tests`
> count.
>
> **What this plan was read against.** `main` at `ce8185e82` (marked **M**). Slice 1's unlanded
> branch `feat/service-periods-slice-1` at commit **`bdf64d9cd8b0a6527cc9110aa9a2b09988f608fd`**
> (marked **S1**; `git rev-parse feat/service-periods-slice-1` on 2026-10-08). A file that slice 1
> does not change has the same lines at M and S1; `git diff --stat ce8185e82 bdf64d9cd -- <path>`
> is empty for `routing.ts`, `routing-store.ts`, `schema/routing.ts`, `schema/hours.ts`,
> `schema/station-times.ts`, `station-times.ts`, `dashboard/prep-stations-screen.ts`,
> `dashboard/routing-grid.ts`, `dashboard/routing-client.ts`, `dashboard/station-health-table.ts`,
> `apps/server/src/kitchen-print.ts`, `kitchen-ticket.ts`, `station-printers.ts`, `watchers.ts`,
> `station-move.ts`, `dead-ends.ts` and `packages/ui/src/components/wt-tabs.ts`. It does change
> `hours.ts`, `routes.ts`, `errors.ts`, `classification.ts`, `configuration-transfer.ts`,
> `dashboard/strings.ts`, `dashboard/live-queries.ts`, `dashboard/hours-*.ts`,
> `packages/module/src/module.ts`, `apps/server/src/working-order.ts`, `till-api.ts`, and it adds
> `menu-timetable.ts`'s resolver, `service-day.ts` and the Opening hours screen
> (`dashboard/opening-hours-*.ts`, `service-grid.ts`); lines in those files are S1 lines.
>
> It builds on the [slice 1 plan](2026-10-07-a366-slice-1-service-periods.md), the unbuilt
> [slice 2 plan](2026-10-08-a366-slice-2-zone-closed-times-and-named-days.md) and
> [slice 3 plan](2026-10-08-a366-slice-3-station-controls.md), and reads the
> [slice 5 plan](2026-10-08-a366-slice-5-monitors.md) for what its Part B needs from this slice.
>
> **Start Part A only after slice 1 has merged; Part B only after slices 2 and 3 (Part A) have
> merged.** Before each part, re-read every line cited from a slice it waits on, and diff what that
> slice changed after the commit or plan read here.

**Goal:** a printer that several stations print on gets one ticket per send, with a section per
station, so a printer on every station is the pass ticket. A routing cell can send dishes to a
different station during named periods ("Upstairs bar; during Breakfast–Afternoon: Downstairs
bar"). Prep stations lose their hours and their fallbacks: a station is open unless someone closed
it for today, and the Opening hours page shows, read-only, when something it makes can be
ordered. The Prep stations page becomes configuration only: Stations (with their printers and the
screens that show them), Routing and Settings.

**Architecture:** combined tickets are a change inside `planKitchenTickets`: routes are grouped by
printer, not by station, and a ticket covering several stations uses the section-per-station layout
a watcher ticket already has. Period choices are a new table beside `routing_cells`, one row per
cell and period; the routing snapshot reads them, and the routing moment carries each department's
running period, read once per call from slice 1's `resolveDepartmentService`. With hours gone, a
station's status is switched off, the default, closed for today, or open; a closed or switched-off
station's work goes where "Close for today" sent it (slice 3), else to the default station. The
worked-out times are one reader that walks each department's day ranges, each period's menus and
the routing, and feeds a read-only view in the Opening hours Week tab.

**Tech stack:** TypeScript, drizzle on SQLite (`node:sqlite`), Hono, Lit, Vitest (node and real
Chromium browser projects).

**Spec:** [Service times, departments, zones and prep stations](../specs/2026-10-07-service-times-departments-and-stations-design.md)
§2 (kitchen tickets), §3 (Prep station), §8, §9.2 (the prep station view), §9.3, §12 (station
hours, the station fallback setting, the tester, the Tickets tab), §13 item 4. Backlog: A366, and
the phone-width points under "On the Routing tab, the label above the 'Where is this made?' time
choice is cut" and "At 390 px the routing grid's fixed first column takes about 140 of the grid's
roughly 310 px" (`docs/backlog.md:1432-1443`, M; detail `docs/backlog/kitchen.md:84-99`, M).

**Risk path:** FULL ceremony, two run-it reviews per pull request: migrations (Part A adds a
table; Part B drops five), routing that decides where a dish is made, kitchen printing, and a
changed cross-package contract (`stationStates`, `MakerResolver` and the routing types in
`packages/module/src/module.ts`).

**Venue reset: not needed** for either part, expected. Part A adds one table. Part B drops
`station_fallbacks` and the four station-hours tables, whose rows are deleted with them (pre-live:
CLAUDE.md §3, no data is carried forward). Nothing outside them points at them except their own
children (Task B7 lists the keys before generating). Each pull request's first line says "no venue
reset needed" (Part B's adds "station hours and fallbacks are deleted"), and the upgrade walk
(`scripts/migration-upgrade.test.ts`) must show no casualty; if it shows one, the first line
becomes "venue reset needed" with the reason it printed.

---

## What this slice needs from slices 2 to 3

### 1. Every file this slice changes

**Part A (Tasks A1–A13; A4, A8 and A11 in two halves each).**

- `apps/server/src/`: `kitchen-print.ts`, `kitchen-ticket.ts`, `rest-of-order.ts` (if the filter
  moves there), `kitchen.ts` (`updateStation`), `management-api.ts` (`PATCH /management-api/stations/:id`,
  `:2025`, M), and their tests (`kitchen-print.test.ts`, `kitchen-print.watchers.test.ts`,
  `kitchen-ticket.test.ts`, `print-problems.test.ts`, a new `kitchen-print.shared-printers.test.ts`,
  `management-api.test.ts` or the station route's suite); `testing/clear-provision-fixture.ts`;
  `configuration-transfer.test.ts`; `catalogue-api.ts` (`/management-api/products/made-at`
  `:1305-1344`, M) if its answer gains the period note
- `packages/venue-service/src/`: `schema/routing.ts`, `schema/index.ts`, `classification.ts` and its
  test, `configuration-transfer.ts` and its test, `migrations.test.ts`, `service.test.ts`,
  `routing.ts`, `routing-types.ts`, `routing-store.ts` and their tests, `menu-timetable.ts`
  (`deleteMenuPeriod`, `periodUses`), `routes.ts`, `routes.test.ts`, `errors.ts`, `index.ts`,
  `dashboard/routing-grid.ts`, `dashboard/routing-grid-model.ts`, `dashboard/routing-cell-editor.ts`
  (new), `dashboard/prep-stations-screen.ts`, `dashboard/station-editor.ts` (new),
  `dashboard/routing-client.ts`, `dashboard/opening-hours-screen.ts`,
  `dashboard/opening-hours-client.ts`, `dashboard/live-queries.ts`, `dashboard/strings.ts`, and their
  tests; `drizzle/` (one generated migration)
- `packages/module/src/module.ts`
- `packages/ui/src/components/wt-tabs.ts` and its tests (decision 17)
- `apps/dashboard/src/widgets/folder-made-at.ts` and its test; `apps/dashboard/src/api/live-queries.ts`
  (`listMadeAt`, `getFolderRouting`, `:231-255`, S1)
- `packages/venue-service/src/operations.ts` (`configureZone`, `:433-469`, S1)
- `scripts/schema-constraints.test.ts`
- `docs/developers/design-system.md`, `docs/developers/products.md` (`:223`, M),
  `docs/backlog.md`, `docs/backlog/kitchen.md`, `docs/backlog/service-periods.md`

**Part B (Tasks B1–B12; B1 in two halves).**

- `packages/venue-service/src/`: `routing.ts`, `routing-types.ts`, `routing-store.ts`,
  `station-times.ts`, `hours.ts`, `hours-types.ts`, `hours-rules.ts`, `routes.ts`, `errors.ts`,
  `index.ts`, `service.ts`, `configuration-transfer.ts`, `classification.ts`, `schema/hours.ts`,
  `schema/station-times.ts`, `schema/index.ts`, `migrations.test.ts`, `service.test.ts`,
  `station-service-times.ts` (new), `testing/station-week.ts` (deleted), and their tests;
  `dashboard/prep-stations-screen.ts`, `dashboard/station-health-table.ts`,
  `dashboard/routing-explanation.ts` (deleted, if only the tester uses it),
  `dashboard/routing-client.ts`, `dashboard/hours-screen.ts`, `hours-client.ts`, `hours-view.ts`,
  `hours-dates-list.ts`, `hours-cell-editor.ts` (each deleted once nothing imports it),
  `dashboard/index.ts`, `dashboard/live-queries.ts`, `dashboard/strings.ts`,
  `dashboard/opening-hours-screen.ts`, `dashboard/opening-hours-station.ts` (new),
  `dashboard/opening-hours-client.ts`, and their tests; `drizzle/` (one generated migration)
- `packages/module/src/module.ts`
- `apps/server/src/`: `kitchen.ts` (`assertDefaultCanStepDown`, `:83-95`, S1), `dead-ends.ts` (only
  if a `why` it reads goes), `till-api.ts` (`GET /api/stations`), `alert-sources.ts`
  (`stationOutputAlertSource`, `:322-370`, M, reads `open`), `testing/clear-provision-fixture.ts`,
  `configuration-transfer.test.ts`, `scripts/demo-seed/seed-floor.ts` (`:154-161`, S1) and
  `seed.test.ts`
- `apps/till/src/` only where a `why` string it shows goes (slice 3's station status line)
- `apps/dashboard/src/navigation.ts` (the `hours` entry, `:10`, S1),
  `apps/dashboard/src/widgets/folder-made-at.ts` (`timed`, `:116-125`, S1),
  `apps/dashboard/src/api/live-queries.ts` (`:231-255`, S1: its lists name `station_fallbacks` and
  the hours tables), `packages/venue-service/src/dashboard/routing-grid.ts` (`#fallbackSentence`,
  `:268-282`, M)
- `scripts/schema-constraints.test.ts`, `scripts/migration-upgrade.test.ts`
- `docs/developers/design-system.md`, `conventions-data.md`, `public-holidays.md`,
  `docs/backlog.md`, `docs/backlog/*.md`

### 2. Does this slice need slice 2 or slice 3?

| What (spec) | Needs | What was checked |
| --- | --- | --- |
| Combined tickets on shared printers (§8, last paragraph) | **Neither — and not slice 1.** | It changes `planKitchenTickets` and the ticket document only (`kitchen-print.ts:445-603`, `kitchen-ticket.ts:46-68`, M). `git diff --stat ce8185e82 bdf64d9cd -- apps/server/src/kitchen-print.ts apps/server/src/kitchen-ticket.ts apps/server/src/station-printers.ts` is empty, and neither the slice 2 nor the slice 3 plan names either file. |
| Period choices in routing cells (§8) | **Slice 1 only.** | A choice names a department's period (`menu_periods`, `schema/menus.ts:21-46`, S1, with the composite key `menu_periods_department_key (id, department_id)`, `:42`, S1) and is applied by asking which period runs now (`resolveDepartmentService`, `menu-timetable.ts:193-314`, S1). Slice 2 changes which period runs on a named day inside that resolver (slice 2 Task 3), and slice 3 extends a period inside it (slice 3 Task A9); routing asks the same resolver, so it follows both whenever they land, in either order. Neither slice 2 nor slice 3 adds a routing input. |
| The Stations page slimmed (§9.3): the Tickets tab merged into Stations, the station editor, "Shown on" | **Slice 1 only (for the link, slice 2).** | The printers and screens columns move from the Tickets tab (`prep-stations-screen.ts:1972-2035`, M); the editor replaces Rename (`:1282-1337`, M). Nothing in slices 2–3 changes these. The Stations tab's link to Opening hours needs the prep station entries this slice adds to slice 2's picker, so it is in Part B (Task B11). |
| Phone-width points (lane D's queue note on A366-4) | **Neither.** | The routing grid's widths are `routing-grid.ts:69-123` (M); the tab row is `wt-tabs.ts:28-42` (M) with the screen's actions at `prep-stations-screen.ts:3444-3458` (M). The "W…" label is the tester's, which Part B removes. |
| Station hours and fallbacks removed (§8, §12) | **Slices 2 and 3.** | Slice 3's "Close for today" asks where the work goes and stores it (`station_day_states.sends_to_station_id`, slice 3 Task A1), which is what replaces the fallback for a closed station; slice 3 decision 9 keeps the configured fallback for out-of-hours closures and rows with no destination "until slice 4" (slice 3 plan, section "What slice 4 will change that this slice touches"). The Station hours screen (`dashboard/hours-screen.ts`, S1) still holds the special dates, the local holidays and the calendar until slice 2 moves them to Opening hours → Calendar (slice 2 Tasks 24–26); deleting the screen before slice 2 would leave named days with no editor. Slice 2 Task 4 also changes `readStationSchedules` and `stationsRestrictedFrom` (`hours.ts:1118`, `:1195`, S1), which Part B deletes. |
| Worked-out times in the Week view (§8, §9.2) | **Slice 2.** | The prep station entries go in slice 2's picker (slice 2 Task 16, `opening-hours-all.ts`) and its real weeks apply named days (slice 2 Task 22); a station's times honour zone closed times (decision 21, slice 2 Tasks 8 and 15). At S1 the Week tab has a department chooser only (`opening-hours-screen.ts:350-372`, S1). |
| The tester removed, with its extras note moved into the grid (§9.3) | **Slices 2 and 3 (through Part B).** | The tester's station-closed explanations (`prep-stations-screen.ts:1634-1655`, M) keep arising until station hours go (decision 13), so it goes with them. |

**Conclusion.** **Part A** (Tasks A1–A13: combined tickets, period choices in routing cells, the
Stations page's configuration columns and editor, the phone-width points) needs slice 1 only and
can be built as soon as slice 1 lands, beside slices 2 and 3. Its first two tasks (combined
tickets) need nothing from slice 1 at all and could be built on `main` today. **Part B** (Tasks
B1–B12: station hours, fallbacks, the Station hours screen and the tester removed; the worked-out
times and their view) needs slice 2 and slice 3's Part A, and must not start until both land; its
tasks are written against those plans, not their code, and must be re-grounded then. Slice 3's
Part B (the zone extension) is not needed. Building Part A ahead of slices 2 and 3 departs from
the spec's order (decision 1).

### 3. Files shared with other slices (same files, different areas)

- **Slice 1** (Part A builds on it): `menu-timetable.ts` (Task A6 extends `deleteMenuPeriod`'s
  answer, `:482-491`, S1), `opening-hours-screen.ts` (the Periods tab's delete dialog, `:422-455`,
  S1), `opening-hours-client.ts`, `routes.ts`, `errors.ts`, `classification.ts`,
  `migrations.test.ts`, `configuration-transfer.ts`, `module.ts`, the venue-service drizzle
  journal, `scripts/schema-constraints.test.ts`, `clear-provision-fixture.ts`.
- **Slice 2** (unbuilt): `hours.ts` (Task 4 changes the two station readers Part B deletes; Tasks 5
  and 25 change the named-day writer and the Station hours editor), `dashboard/hours-screen.ts`
  and `hours-dates-list.ts` (Tasks 24–25), `opening-hours-screen.ts` (Task 16's picker; Part B adds
  the station entries), `routing-store.test.ts` (Task 4's cases, which Part B deletes with the
  readers they test), `configuration-transfer.ts`, `classification.ts`, `errors.ts`, the journal
  (a number collision is fixed by regenerating, never by hand — CLAUDE.md §3).
- **Slice 3** (unbuilt): `routing.ts` (`StationTiming.todaySendsTo`, `walkFallbacks`,
  `closedSendsTo` — Task A3), `routing-store.ts` (`snapshot`'s day-state read, `stationStates`,
  `scheduledStationStatus` — Tasks A2–A3), `station-times.ts` (`openStationForToday`,
  `closeStationForToday` — Task A2), `module.ts` (`StationTodayState`), `prep-stations-screen.ts`
  (Task A8 removes the today buttons and relabels `prep.when_closed`; Part B removes the field and
  the status sentence), `dashboard/strings.ts`. Part A's routing change (period lines in
  `selectRoutingCell`) and slice 3's (the walk) are in different functions of the same files:
  whichever lands second rebases.
- **Slice 5** (Part A may land first): `prep-stations-screen.ts` (slice 5 Task A17 changes the
  Tickets tab's "Screens" read-out "or slice 4's 'Shown on' if it has landed"), `routing-client.ts`
  (`devices`), `dashboard/live-queries.ts`, `module.ts`. If slice 5 Part A lands before Task A11b,
  "Shown on" reads the device monitors (slice 5 decision 7's shape) instead of
  `devices.stationId`/`watcherId`.
- **Slice 6** (planned later): the Departments page; nothing here.

### 4. What slice 5 Part B relies on from this slice

Slice 5 Part B removes watcher printers once "a shared printer gets one combined ticket per send"
exists (slice 5 plan decision 1; its Task B1 says to confirm slice 4 has "a test for a printer
shared by several stations printing one ticket per send" before deleting
`kitchen-print.watchers.test.ts`). This slice provides, for it:

- `planKitchenTickets` grouping by printer (Task A1), so a printer listed on every station prints
  one ticket per send covering the whole send — the pass ticket.
- Named tests in `apps/server/src/kitchen-print.shared-printers.test.ts` (Tasks A1–A2): one
  combined ticket per send on a shared printer; a printer on every station gets the whole send; a
  reprint and a HOLD ticket follow the same grouping; a correction slip prints once on a shared
  printer; a failed combined ticket shows a printing problem on each station it covers.
- The limit of decision 5a: one ticket per planning call, so a send with dishes moved off a
  closed station prints more than one ticket on the pass printer.
- The `printer.makes_and_watches` rule **kept** (decision 4): slice 5 Part B removes it with
  watchers, as its "Behaviour this slice removes" already lists ("`printer.makes_and_watches` if
  slice 4 has not removed it").
- The Watchers tab **kept** on the Prep stations page (decision 16): slice 5 Part B Task B2 removes
  it ("unless slice 4 removed it").

---

## Decisions this plan makes that the spec does not

Each is the DEFAULT to build; the owner may override any when reviewing the plan.

1. **Two pull requests.** Part A (combined tickets, period choices, the Stations page's
   configuration, the phone-width points) after slice 1; Part B (hours and fallbacks gone, the
   worked-out times) after slices 2 and 3. Why: Part A needs nothing from slices 2 and 3 (section
   2), and slice 5 Part B waits on the combined tickets. Override: one pull request after slice 3,
   in the spec's order.
2. **A combined ticket groups by printer, per send.** For each printer, the stations in this send
   whose printers include it are that printer's ticket; printers whose station set and paper
   layout (`groupByLayout`, `kitchen-print.ts:170`, M) are equal share one rendered ticket, one job
   per printer, as twin printers do today. A printer with one station prints exactly today's
   station ticket (`scope: "station"`). A printer with two or more prints one ticket with a section
   per station, in the order the send already sorts stations (by name, `:504-531`, M), using the
   watcher ticket's section layout (`kitchen-ticket.ts:220-225`, M) under a header naming the
   stations ("Grill · Bar"). Each combined job links to every station it covers
   (`kitchen_print_jobs` is already unique on `(print_job_id, working_order_id, station_id)`,
   `packages/db/src/schema/kitchen-print-jobs.ts:15-49`, M), so a failed one shows a printing
   problem on each of those stations' cards, as the backlog's pass-printer entry describes
   (`docs/backlog.md:1350-1355`, M).
3. **"Show the rest of the order" on a combined ticket.** It is printed when any station on the
   ticket has the setting on, and lists the order's other dishes at stations NOT on this ticket.
   Today the filter assumes one station (`item.stationId !== route.station`,
   `kitchen-print.ts:571`, M); it becomes "not one of the ticket's stations". Override: only when
   every station on the ticket has it.
4. **The rule against one printer both making and watching stays until watchers go.** Spec §8 says
   it goes; while watchers still print (until slice 5 Part B), a printer that was both a station's
   and a watcher's would print the same dish twice per send. So `printer.makes_and_watches`
   (`station-printers.ts:44`, `watchers.ts:324`, M) stays, and slice 5 Part B removes it with
   watchers. Override: remove it here and accept the double print until slice 5 Part B.
5. **Correction slips stay one per dish.** Spec §8: "Reprints and correction slips follow the same
   grouping." A slip is already one per dish on its station's printers (`printCorrectionSlips`,
   `kitchen-print.ts:1040-1113`, M), so a printer shared by several stations gets each slip once;
   nothing prints twice and no slip covers another station's dish. A reprint follows the grouping
   fully (Task A2): `reprintOrderTickets` merges HOLD and fired work into one job **per printer**
   (`:1474-1486`, M, merges per printer and station today), joining their station lists, because
   separate jobs on one printer would let a later one clear an earlier one's printing problem (the
   reason the merge exists, `:1450-1456`, M); and `readReprintTargets` reads the same groups
   (`:1419-1444`, M). For a combined HOLD ticket, "the rest of the order" is left out when ANY of
   its stations is in `restOfOrderExcept` (`:541`, `:1472`, M).
5a. **"One ticket per send" is one ticket per planning call — a stated limit.** One send can plan
   tickets more than once: `finishRelease` plans the ordinary dishes, then once per station whose
   dishes were moved off it (with "From X", `working-order.ts:1996-2006`, S1); a HOLD advance
   ticket (`order-groups.ts:1253`, M) and a station move (`station-move.ts:324-332`, M) plan on
   their own. In those sends a printer on every station prints one ticket per call — one for the
   ordinary dishes and one per "From" station. Slice 5 Part B's pass ticket inherits this limit.
   Override: merge `finishRelease`'s calls into one plan with a "From" label per dish (its own
   task).
6. **A period choice is stored per cell and period**: `routing_cell_periods` (cell, period, the
   period's department, and a target — a station or No preparation, as the cell's own). Unique on
   `(cell_id, period_id)`, which is the spec's "a period can be in one line only". The editor
   groups rows with the same target into one line; two lines that name the same station are saved
   as one. The cell row's own target is "Any other time". A cell keeps its id on update
   (`setRoutingCell` updates in place, `routing-store.ts:170-193`, M), so its period rows survive
   a change of its plain station; clearing the cell deletes the row and, by cascade, its periods.
7. **Which period applies.** A dish's station is decided when it goes on the order, as today:
   sent, or sent held (a held dish's `ticket_items` row and its station are written then, in
   `fireLines`, `working-order.ts:1615-1643`, `:1667`, S1, and its HOLD ticket prints there). The
   extras of a held dish that are split off to their own station are routed at release
   (`finishRelease` calls `insertSplitExtras` with the release's routing, `:1980-1992`, S1), so
   they follow the period running then. At that moment its zone's
   department's running period is read (`resolveDepartmentService(…, at).periodId`, S1) — lazily,
   once per department per routing call, remembered for the rest of the call (`routingAt`
   already resolves the zone's department through `resolveZoneContext`, `routing-store.ts:667`,
   `:685`, M). A dish with no zone uses "Any other time". A held dish keeps its
   station at release: `rerouteHeldAtRelease` re-routes only dishes whose station is not open
   (`station-move.ts:22-60`, S1), and a period ending does not close a station. At slice 1's
   offset of 0 a new dish is only accepted while its period runs (slice 1 decision 1), so an
   unsent dish is always routed inside the period that offered it; once A432 lets dishes be sent
   after the end, they are routed by the period running at the send, or "Any other time" when
   none runs. A period kept open (slice 3) or a named day with its own hours (slice 2) changes the
   answer because the resolver does. Untimed reads (the preview, `describeMakers`, the Products
   screen's folder read-out) use "Any other time". Override: re-route held dishes at release by
   the period then running.
8. **Cells that can have period choices.** Every stored cell can, and so can a zone's All
   categories cell. The All categories × Every zone cell cannot: it is the default station and is
   never a row (`schema/routing.ts:15`, `routing_cells_coordinate_ck :58-61`, M). A period line on
   it would need a second way to store the default. Override: store the default cell's period
   lines with a null cell id.
9. **A cell with period choices needs a plain choice.** "Any other time" is required; the editor
   fills it with what the cell shows now (its own choice, or the inherited one). A cell that sets
   nothing inherits the whole cell above it, period lines included (spec §8); a cell that sets
   anything is its own, with no lines merged from above.
10. **What the server refuses.** An unknown period: `route.subject_not_found { subject: "period",
    id }` (404, the code an unknown category or product already gets, `routes.ts:115`, S1). A
    period of another department on a zone's cell, or a period named twice:
    `route.period_invalid { periodId, reason: "other_department" | "repeated" }` (409; sibling
    `route.station_inactive`, `routes.ts:116`, S1). A period line naming a switched-off or unknown
    station: `route.station_inactive`, as the cell's own station is checked
    (`routing-store.ts:136-150`, M). The default cell's address is already refused before anything else
    (`management.request_invalid { field: "address" }`, `routing-store.ts:97-98`, M), and stays
    so with periods; period choices on a cell being cleared:
    `management.request_invalid { field: "periods" }` (400, as the route's other malformed fields).
    The configuration import refuses the same rows (Task A3). The spec's "limited to those whose
    menus include the row's products" is the editor's offer list only: menus change after a choice
    is made, and a choice whose period no longer offers the row's products is harmless (it never
    applies). A zone moved to another department (`configureZone`, `operations.ts:433-469`, S1) loses
    its cells' period rows for the old department's periods in the same transaction (Task A5).
11. **What a period offers.** The routing read (`routingModel`, `routing-store.ts:802`, M) gains
    `periods: { id, departmentId, departmentName, name, colour, productIds }[]`, `productIds` being
    the products reachable from the period's customer menu and staff-only menus
    (`reachableProducts`, `packages/catalogue/src/section-graph.ts:175`, M, from each menu's root),
    variants by their parent's id as routing does (`ProductFacts.routedProductId`,
    `routing.ts:77-81`, M). The editor offers a period when any product the row covers is in its
    `productIds`.
12. **Deleting a period that a cell names warns first.** Slice 1 refuses deleting a period that
    any day still places (`menu_period.in_use`, `menu-timetable.ts:489`, S1). A period that passes
    that check but is named by routing cells is deleted with a warning: the Periods tab's delete
    dialog (`opening-hours-screen.ts:422-455`, S1) lists the cells by row and column ("Cocktails ·
    Every zone") and says their choices for this period go; confirming deletes the period, and the
    cells' rows for it go by cascade. The list comes from a read added to the opening hours model
    per period (`routingUses: { rowLabel, zoneName }[]`). Override: refuse the delete until the
    cells drop it.
13. **The tester goes in Part B, not Part A.** Spec §9.3 removes it because "the station-closed
    explanations it gave no longer arise"; they arise until station hours go. Until then it keeps
    working and shows the period choice that applied (Task A4b: `explainRoute` reads the periods as
    routing does; its "Weekday and time" mode reads the department's normal week). Its "W…" label
    goes with it.
14. **The cell becomes a button that opens its editor** (spec §8: "Clicking a cell opens its
    editor"), replacing the inline combobox (`routing-grid.ts:361-378`, M). The button shows the
    station, inherited choices in italics as today, and the period line beneath it. The editor is
    a `wt-modal`: one line per target (a `wt-combobox multiple` of periods, grouped by department in
    an Every zone column, and a station `wt-combobox`), a Remove per line, "Any other time" with
    its station `wt-combobox`, "+ Different station during some periods", Clear (for a stored
    cell), Cancel and Save. Save runs the existing preview (`#previewDialog`,
    `prep-stations-screen.ts:3230-3291`, M) and writes only once confirmed, as a combobox choice
    does today; the preview's moves say "during Lunch" when `periodIds` is set. With no arrow
    beside the name, the "Downstairs bar" text no longer meets one. **Its starting state:** a
    stored cell opens with its own choice and lines and its Save quiet until the draft changes; an
    inherited cell opens with the inherited choice and lines as its draft, marked "from Every zone"
    (or the row above), and with Save available at once (`{ savableAtOpen: true }`), so a person
    can still pin the inherited choice as the cell's own, as choosing it in today's combobox does.
15. **The period line's words.** One or two periods: their names joined by ", " ("Lunch, Afternoon:
    Downstairs bar"). Three or more: "first–last" when the line holds every period between them in
    the department's period order ("Breakfast–Afternoon: Downstairs bar"), else the first name and
    a count ("Breakfast +3: Downstairs bar"). `menu_periods` has no order column
    (`schema/menus.ts:21-46`, S1), so the order is each period's earliest start in the normal week
    (Monday first, from the changeover — `weekdayOf` numbers Sunday 0, `hours-rules.ts:56-58`, S1,
    so the sort moves Sunday last), a period placed nowhere last, the name breaking ties; the
    routing model sends `periods` in that order. Several lines: one line each. The full text is the
    button's accessible name.
16. **The page's tabs.** Part A: Stations, Routing, Watchers, Settings — the Tickets tab goes, its
    printers and screens columns move to Stations, and "Show the rest of the order" moves from
    Settings to the station editor (spec §9.3). The Watchers tab stays until slice 5 Part B, which
    removes it. An old `view=tickets` address opens Stations, as an unknown view does
    (`prep-stations-screen.ts:289-295`, M). Part B: the Settings tab loses the fallback column.
17. **The tab row at phone width.** Each header action shows only on its own tab ("New station" on
    Stations, "New watcher" on Watchers). When the tab strip is wider than the row, `wt-tabs` fades
    its cut end (a mask on the strip's scrolling side, set from its scroll position), so a person
    sees that it scrolls. This is a shared-primitive change: every tabbed screen gains the fade
    when, and only when, its tabs overflow. Override: fix only this screen, by moving the actions
    into the panels.
18. **The routing grid at phone width.** Under the grid's existing 40rem container query
    (`routing-grid.ts:75-79`, M) the row-label column is `calc(var(--wt-space-6) * 3)` (96 px) and
    a zone column `calc(var(--wt-space-6) * 3.25)` (104 px), so at a 390 px viewport the labels
    and two zone columns (Every zone and one zone) are wholly visible without scrolling; row labels
    wrap. Above 40rem nothing changes.
19. **The station editor.** "Edit" replaces "Rename" in the ⋮ menu and sets the name, the printers
    and "Show the rest of the order" (spec §9.3), in one request: `PATCH
    /management-api/stations/:id` gains `printerIds`, applied with `replaceStationPrinters`
    (`station-printers.ts:64`, M) in the same transaction as the rest of the patch (CLAUDE.md §3:
    one transaction per request). **Permissions:** the PATCH needs `venue.configure`
    (`management-api.ts:420-428`, `:2081`, M), while setting a station's printers needs
    `printer.manage` (`print-api.ts:101`, `:402-412`, M); a PATCH carrying `printerIds` checks
    both, in the same transaction, and is refused `authorization.not_permitted` without
    `printer.manage` (nothing written). The editor shows Printers as a read-out to a person
    without `printer.manage`, and sends no `printerIds`. The old `PUT
    /management-api/stations/:id/printers` route stays (the Printers screen may use it; Task A11b
    removes the dashboard client method only if `grep` finds no other caller). "New station" keeps
    its fields (name, order, timings) and gains the printers, under the same rule.
    The Stations tab's table gains "Printed on" and "Shown on" read-outs, and keeps the
    live kitchen numbers (decision 20).
20. **The live kitchen numbers stay — departs from spec §9's "nothing on them shows live state".**
    The Stations tab's Waiting, Preparing, Ready, Late and Oldest columns
    (`station-health-table.ts:138-159`, M) are the only dashboard view of a kitchen's load, and
    the only thing a supervisor without configuration rights sees on this page
    (`prep-stations-screen.ts:293-298`, `:3421`, M). The spec moves live CONTROLS to the till and
    kitchen display (§10) but names no new home for these numbers. Part B removes the Today column
    (its state is now closed-for-today or switched off, which the Stations table shows as a short
    note beside the name). Override: remove the live numbers too.
21. **What the worked-out times are.** For a date, a station's times are the union, over active
    departments, of the department's ranges whose period offers at least one product that the
    routing sends to this station in at least one of the department's active zones, during that
    period — each zone's share cut by that zone's closed times that date (slice 2). Dishes only:
    an extra makes no station "open" (extras are not on menus). A period kept open today (slice 3)
    is not shown: the view is for planning. The default station shows no grid, only "Always open:
    the default station takes what no other station makes." A switched-off station shows
    "Switched off". The times are a read-out: routing never asks them (decision 22).
22. **Routing without hours.** A station's status is `switched_off`, `default`, `closed_by_hand` or
    `open`. A station closed for today sends its work where "Close for today" said (slice 3); a
    closed row with no destination (stored before slice 3, or by a test fixture) and a switched-off
    station send it to the default station; a walk continues past a destination that is itself
    closed or switched off, as slice 3's does, and ends at the default station. Only a venue whose
    default station is switched off or missing still reaches `noReplacement` (`selectRoutingCell`
    returns the default only while it is active, `routing.ts:184-189`, M), so `station.no_replacement`
    and the till's dead-end prompt stay. A dish routed to a station whose worked-out times are over
    (a held Lunch dish sent at 16:00) goes there anyway: the spec's "open whenever something it
    makes can be ordered" describes when work arrives, not a closure.
23. **"Open for today" without hours.** Slice 3's `openStationForToday` deletes today's row when
    the station would be open without it and stores "open" otherwise (slice 3 decision 11); with
    hours gone a station is always open without it, so it always deletes. A stored `open: true` row
    reads as no row. The `opened_by_hand` reason goes.
24. **Disabling a station no longer asks where its work goes.** Today Disable opens the fallback
    choice (`#openFallback(id, "switch_off")`, `prep-stations-screen.ts:1235-1241`, M). In Part B it
    confirms instead: "Its dishes go to {default}, the default station, until you change the
    routing", listing the routing cells that name it. Override: make Disable clear or rewrite those
    cells.
25. **Where a station's times are seen.** The Opening hours picker gains a "Prep stations" group
    after the departments (slice 2 Task 16's picker), one entry per active station, and the URL a
    `station` key (`opening-hours?view=week&station=<id>`). A station's view is All departments'
    layout (slice 2 Task 16: one narrow column per department per day), showing only the counted
    ranges in their period's colours, in the normal week or a real week (slice 2 Task 22). The
    Stations tab's row links "When it gets orders" there.
26. **The Station hours screen goes whole.** Its dashboard entry (`hours`, `dashboard/index.ts:53-70`,
    S1), its navigation key (`apps/dashboard/src/navigation.ts:10`, S1), the client and the views
    only it uses. An old `/manage/hours` link lands where any unknown dashboard address lands; no
    redirect (pre-live). Its API routes go with the station-hours writers.
27. **The demo shows a period choice.** The demo seed's Upstairs bar hours and its fallback to the
    Downstairs bar (`seed-floor.ts:154-161`, S1) go; in their place one cell of the demo's drinks
    rows gets a period line for the demo's evening period → Upstairs bar, with Downstairs bar at
    any other time — the spec's §8 example the other way round. If the demo has no evening period
    at that time, the task says so and adds no line.
28. **Error codes** (pre-live, named for the concept — CLAUDE.md §3; siblings in
    `packages/venue-service/src/errors.ts`, S1):
    - New: `route.period_invalid` (decision 10), 409. Reused: `route.subject_not_found` with
      `subject: "period"` (404) and `route.station_inactive` (venue-service's);
      `authorization.not_permitted` (identity's, `packages/identity/src/errors.ts:71`);
      `printer.makes_and_watches` (the server's, newly mapped in `management-api.ts`, Task A10).
    - Retired in Part B: `station.fallback_loop` (`errors.ts:83`, S1) and every code only station
      hours throw (Task B6 lists them with `grep`), each removed from every copy in the tree in one
      change (`apps/dashboard/src/i18n/codes.ts` and any till copy); `station.always_open` stays
      (slice 3 reuses it).
    None is a recorded incident, so none needs alert wording.

## Where the code differs from what the spec assumes

- §2 says "each station's ticket prints on each of its printers separately". True, and no test
  pins the two-tickets case for two stations firing in one send onto one printer: the only
  one-printer-on-two-stations setups are mapping tests (`station-printers.test.ts:173-187`,
  `print-api.printer-wiring.test.ts:887`, M) and `kitchen-print.watchers.test.ts:709` (M), where
  only one of the two stations fires. So Task A1 changes no existing assertion about it.
- §8 says the rule against making and watching goes; decision 4 keeps it until slice 5 Part B.
- §8 says "the default station is always open". Today a venue can switch its default station off
  (`deactivateStation`, `apps/server/src/kitchen.ts:256-269`, S1, has no default check), and the
  routing then returns no default (`routing.ts:184-189`, M). Decision 22 keeps today's answer for
  that case.
- §9.3 lists the Stations tab's columns without the live numbers; decision 20 keeps them.
- §9.3 says "Editing a station sets its name, its printers and 'Show the rest of the order'".
  Today there is no station editor: Rename (name only), the Tickets tab (printers) and the Settings
  tab ("Show the rest of the order") each edit one (`prep-stations-screen.ts:1282-1337`,
  `:1878-1971`, `:2712-2715`, M).
- §9.3's Stations tab: "the printers its tickets print on". A station's printers are stored in
  `station_printers` (`packages/db/src/schema/station-printers.ts:10-30`, M), a core table, not
  venue-service's: Task A10 changes the core route.

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`.
- Work in this branch's worktree; never commit to `main`.
- A shipped migration file is never edited. New migrations only, generated with
  `pnpm --filter @waitron/venue-service db:generate`, never hand-numbered or hand-edited.
- drizzle-kit 0.31.11: a generation that rebuilds a table must not also add a column to it. A
  drop or a rebuild runs with foreign keys on, so list the keys that point at a table first
  (`grep -rln 'REFERENCES \`<table>\`' packages/*/drizzle/`).
- No data-migration code before go-live (CLAUDE.md §3).
- Every foreign key and unique index is declared in the TypeScript schema; every new table is
  classified in `VENUE_SERVICE_CLASSIFICATION` (`classification.ts`).
- Error codes are registered in `packages/venue-service/src/errors.ts`, with a status in the route
  map that answers them (`routes.ts` `STATUS`, S1), and wording in English and Spanish wherever a
  screen shows them (`dashboard/strings.ts` or `apps/dashboard/src/i18n/codes.ts`).
- venue-service functions take `cfg: VenueScope`; multi-table writes take one `tx: Transaction`;
  queries on one transaction are awaited in turn. **Departments' periods are read in turn, once per
  routing call**, never per dish (CLAUDE.md §3: resolve shared data once before a line loop).
- **Kitchen printing changes keep every existing printing test passing unedited** except those
  listed under "Behaviour this slice removes". A printing change is checked through the real
  planner and the outbox, never a stubbed printer list.
- The dashboard's routing live query (`dashboard/live-queries.ts:17-41`, S1) gains
  `routing_cell_periods` and `menu_periods` (Part A) and loses the dropped tables (Part B); a
  misspelled name breaks the whole tab's stream, so run `scripts/live-subscriptions.test.ts`.
- **Save rule (A331).** Each form this slice creates or rewrites — the routing cell editor, the
  station editor, the New station dialog (gains printers), the Disable confirmation is not a form
  — takes its scope from `draftScopeFor`, draws its action through `saveActionState`, returns early
  in its save handler while `saveActionState(scope).unchanged`, and has a `*.save-state.test.ts`
  and a `*.unsaved.test.ts` with #1422's reconnect case (edit, take the form off the page, put it
  back: it still asks before discarding). A button that is not a save is drawn quiet while it
  waits, and in its own colour once it can act (CLAUDE.md §3; design-system.md → Forms).
- A screen does not draw its own `<select>`: every choice is a `wt-combobox`.
- New UI reads `--wt-*` tokens only. Strings in English and Spanish. Coverage stays at
  98/98/98/95 in every package touched. Comments only for an invariant or a non-obvious why.
- **LOOK** at every changed screen in English and Spanish, light and dark themes, 1280 and 390 CSS
  pixels wide, and say in the task's report what was looked at.

## Behaviour this slice removes

Tests pinning these may change, under the rule at the top, in the task named.

**Part A**

- A station's printers edited in the Tickets tab's "Printed on" cell, and the Tickets tab itself
  (`prep-stations-screen.ts:1972-2035`, `:1878-1971`, M; `prep-stations-screen.printers-unsaved.test.ts`
  whole, and the Tickets cases in `prep-stations-screen.test.ts` and `.a11y.test.ts`). Task A11b.
- "Show the rest of the order" in the Settings tab (`:2712-2715`, `:2551-2556`, M; its cases in
  `prep-stations-screen.settings.test.ts` and `.settings-unsaved.test.ts`). Task A11b.
- Rename in the station ⋮ menu (`:1205-1220`, `#renameDialog :1282-1337`, M). Task A11a.
- The routing cell's inline combobox (`routing-grid.ts:361-378`, `#defaultCell :392-426`, M; its
  cases in `routing-grid.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`). Task A8b.
- The row-label column's width at phone width: `routing-grid.test.ts:751` ("row label column is
  capped", at most 140) narrows to 96. Task A9.
- The header actions on every tab (`prep-stations-screen.ts:3444-3458`, M) and
  "keeps half of a $width px tab row" (`prep-stations-screen.test.ts:2844-2851`, M), which keeps
  its 50% cap but sees one action per tab. Task A12.

**Part B**

- Station hours, special-date station cells, fallbacks, and every status that reads them: the
  `in_hours`, `no_hours`, `out_of_hours`, `time_not_applied` and `opened_by_hand` reasons; a
  closed or switched-off station following its configured fallback; `station.fallback_loop`;
  `assertDemotedStationHours` refusing a new default. Tasks B1a–B7.
- **A switched-off station with no fallback, or two closed stations falling back to each other,
  being a dead end** (`noReplacement`, `station.no_replacement`): under decision 22 their work goes
  to the default station. Pinned at least at `apps/server/src/catalogue-api.test.ts:1508-1520` and
  `working-order.test.ts:3255-3280` (M); Task B1a's grep finds the rest. Tasks B1a–B1b.
- The Prep stations Today column, its status sentences and the fallback field in the Settings tab
  and the Disable dialog. Task B3.
- The "Where is this made?" tester and its route. Task B4.
- The Station hours screen and its routes. Tasks B5–B6.
- The demo's station hours and fallback. Task B10.

## Review focus

The conditions most likely to bite a person that no single task's happy path exercises.

1. **A shared printer prints one ticket per send.** X on PX; Y on PY and P; Z on PZ and P. A send
   with one dish at each prints X's on PX, Y's on PY, Z's on PZ, and ONE ticket on P with a Y
   section and a Z section; a printer on all three prints one ticket with three sections. A send
   with only Y's dish prints on P the plain station ticket. (Task A1.)
2. **Reprints and HOLD follow the grouping.** A reprint of the order above prints one ticket on P,
   not two — also when the fired work on P covers Y and Z and the held work only Y; the reprint
   targets and print problems read `P|Y` and `P|Z` (Task A2).
3. **The period when the dish goes on the order decides.** Cocktails' Every zone cell: Upstairs
   bar; Lunch → Downstairs bar. A cocktail sent at 13:00 during Lunch goes Downstairs; one sent
   held at 13:55 is at Downstairs bar and stays there when released at 14:10 after Lunch ended
   (decision 7); a cocktail sent at 14:10 from a period with no line goes Upstairs; a Terrace cell
   that sets nothing inherits the Lunch line; a Terrace cell set to Pastry has no line, so a
   Terrace cocktail at 13:00 goes to Pastry (Tasks A4a–A5).
4. **Periods are department-scoped.** A zone cell refuses another department's period
   (`route.period_invalid`); an Every zone cell holding two departments' Lunches applies each in
   its own department (Task A5).
5. **Deleting a period takes its routing lines with it, after a warning** (Task A6).
6. **Without hours, nothing is dropped.** In Part B: a station closed for today with no recorded
   destination sends work to the default station; a switched-off station's work goes to the
   default station; a held Lunch dish sent after its station's worked-out times goes to that
   station; with the default switched off, the till still asks (`station.no_replacement`) (Task B1a).
7. **The worked-out times match the routing.** A station that makes only Cocktails, routed to it
   during Lunch only, shows Lunch's ranges and nothing else; on a named day with own hours it shows
   that day's Lunch; with the Terrace closed at 15:00 and Cocktails routed there only on the
   Terrace, it shows Lunch up to 15:00 (Task B8).

---

## Part A — combined tickets, period choices, the Stations page (first pull request)

### Task A1: Kitchen tickets group by printer

**Files:**
- Modify: `apps/server/src/kitchen-print.ts` (`KitchenRoute :414`, `routeKitchenTickets :445-455`,
  `planKitchenTickets :465-603` — the station-ticket part, not the watcher block `:605-688`; the
  rest-of-order filter `:539-542`, `:571`, M), `apps/server/src/kitchen-ticket.ts`
  (`KitchenTicket :46-68`, `formatKitchenTicket :178-225`, M)
- Create: `apps/server/src/kitchen-print.shared-printers.test.ts`
- Test: also `kitchen-ticket.test.ts`

**Interfaces:**

```ts
// kitchen-print.ts — a route now covers the stations sharing its printers:
interface KitchenRoute { stationIds: string[]; printers: PrinterMapping[] } // `station` goes
// kitchen-ticket.ts — the station scope gains a multi-station form:
| { scope: "stations"; stations: KitchenTicketStation[]; tableLabel; orderNumber; firedAt;
    alsoOnOrder?: { locale: string; items: OtherStationItem[] } }
```

`routeKitchenTickets(stationIds, mappings)` builds, per printer, the set of this send's stations
that list it; then groups printers by (station set, layout). A one-station group renders today's
`scope: "station"` ticket byte for byte; a larger one renders `scope: "stations"` (header: the
station names joined " · "; a section per station as the watcher ticket's). `KitchenJob.station`
becomes the first station of the group only where a caller needs one name; `stationIds` carries
all, and `linkKitchenJob` already writes one link per station (`:754-764`, M).

- [ ] **Step 1: Failing tests** in the new file, through `planKitchenTickets` and the outbox on a
  `useVenueDb` venue with real printers: review focus 1 (the X/Y/Z case: four jobs, P's bytes
  contain both station headers and both dishes, P's job links to Y and Z); a printer on every
  station prints one ticket with every section; a send with only Y's dish prints the plain station
  ticket on P (its bytes equal what `scope: "station"` renders); two printers of different widths
  shared by Y and Z get one ticket each. "Show the rest of the order" (decision 3): on with Y only,
  P's ticket lists X's dish under "Also on this order" and not Y's or Z's. In `kitchen-ticket.test.ts`:
  the `stations` scope renders both headers and sections. (Fails today: P gets two jobs.)
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/server exec vitest run src/kitchen-print.shared-printers.test.ts src/kitchen-ticket.test.ts`.
- [ ] **Step 3: Implement.** Jobs are queued in today's order — stations by name, then layout —
  with a combined group placed at its first station's turn. Every existing printing test passes
  unedited
  (`pnpm --filter @waitron/server exec vitest run src/kitchen-print src/kitchen-ticket src/print-problems src/station-move src/split-off-extras`).
- [ ] **Step 4: Run; see them pass;** the server package; `pnpm --filter @waitron/server typecheck`.
- [ ] **Step 5: Commit** — `feat(server): a printer shared by stations prints one ticket per send (A366)`.

---

### Task A2: Reprints, HOLD tickets and printing problems follow the grouping

**Files:**
- Modify: `apps/server/src/kitchen-print.ts` (`reprintOrderTickets :1458-1489`,
  `readReprintTargets :1419-1444`, `readPrintProblems :1519-1548`, `readUncoveredLinks :1588`, M)
- Test: `kitchen-print.shared-printers.test.ts`, `print-problems.test.ts` (new cases only)

**Behaviour:** decision 5. A reprint of the X/Y/Z order prints one ticket on P; fired and HOLD
work on one printer merge into one job whatever their station sets (fired {Y, Z} and HOLD {Y} on P
make one job linked to Y and Z); the reprint
targets are the same printer groups; a failed combined job on P shows a printing problem on Y's
and Z's cards, and a reprint that prints on P clears both. A correction slip (VOID) for Y's dish
prints once on P and once on PY, and nothing for Z (decision 5).

- [ ] Steps: failing tests for each sentence above (fails today: two jobs on P per reprint);
  watch them fail (`pnpm --filter @waitron/server exec vitest run src/kitchen-print.shared-printers.test.ts src/print-problems.test.ts`);
  implement; the server package; typecheck; commit
  `feat(server): reprints and printing problems follow shared printers (A366)`.

---

### Task A3: Migration — period choices on routing cells (add only)

**Files:**
- Modify: `packages/venue-service/src/schema/routing.ts`, `schema/index.ts`, `classification.ts`
  and its test, `configuration-transfer.ts` (beside `routing_cells`, `:562`, S1) and its test,
  `migrations.test.ts` (`TABLES`), `scripts/schema-constraints.test.ts` (routing keys beside
  `:183-187`, checks beside `:570-573`, S1), `apps/server/src/testing/clear-provision-fixture.ts`
  (before `routing_cells`)
- Create: generated `packages/venue-service/drizzle/00NN_*.sql`, snapshot, journal entry

**Interfaces — produces:** `routingCellPeriods` (table `routing_cell_periods`): `id` (primary key,
`newId`), `cellId` not null → `routing_cells.id` **on delete cascade**
(`routing_cell_periods_cell_fk`), `periodId` and `departmentId` not null, composite foreign key
`(period_id, department_id)` → `menu_periods (id, department_id)` **on delete cascade**
(`routing_cell_periods_period_fk`, over `menu_periods_department_key`, `schema/menus.ts:42`, S1 —
slice 1's pattern, `menu_slots_period_fk :130-134`), `stationId` → `kitchen_stations.id`
(`routing_cell_periods_station_fk`), `noPreparation` boolean; check
`routing_cell_periods_target_ck` written as `routing_cells_target_ck` (`schema/routing.ts:62-65`,
M); unique `routing_cell_periods_cell_period_key (cell_id, period_id)`. Class `state`; the
configuration transfer carries it with its cell (`locationColumns` none: it has no location column;
the export validator rejects a row whose cell is not in the export).

- [ ] **Step 1: Failing test** in `migrations.test.ts`: the table is in `TABLES`; a second row for
  one cell and period is refused; a row with both a station and No preparation is refused; a row
  naming one department and another department's period is refused; deleting the cell deletes its
  rows; deleting the period deletes its rows. Run
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/migrations.test.ts`;
  expected: fails (no such table).
- [ ] **Step 2: Schema, then generate** (`pnpm --filter @waitron/venue-service db:generate`). Read
  the SQL: expected one `CREATE TABLE` and its indexes, no rebuild.
- [ ] **Step 3: Classification, transfer, guard lists, clear list.** A configuration export and
  import round-trips a cell's period rows (`configuration-transfer.test.ts`, a new case beside the
  routing cases); the import's routing validator (`validateRoutingConfiguration`,
  `configuration-transfer.ts:444`, S1) refuses a row whose cell is missing, a zone cell's row
  naming another department's period, and a row naming a station the export does not carry.
- [ ] **Step 4: Run** Step 1's test, the package's node project, the server package, and
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/module-graph-honesty.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/live-subscriptions.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`.
- [ ] **Step 5: Commit** — `feat(venue-service): period choices on routing cells (A366)`.

---

### Task A4a: Routing applies the running period

**Files:**
- Modify: `packages/venue-service/src/routing.ts` (`RoutingRules :31-38`, `RoutingMoment :63-68`,
  `selectRoutingCell :149-191`, `chooseMaker :284-309`, `chooseExtraMaker :317-336`, M),
  `routing-store.ts` (`snapshot :235-299`, `routingAt :607`, `resolveMakers :702`,
  `resolveExtraMakers :713`, M), `routing-types.ts` (`decidedBy`), `packages/module/src/module.ts`
  (only if a routing type it names changes, `:293-319`, S1)
- Test: `routing.test.ts`, `routing-store.test.ts`, and one case in the server's send suite (real
  route)

**Interfaces:**

```ts
// RoutingRules gains, both OPTIONAL so the ~68 rule literals in routing.test.ts stand:
readonly cellPeriods?: ReadonlyMap<string /* cell key */, ReadonlyMap<string /* periodId */, RouteTarget>>;
readonly zoneDepartment?: ReadonlyMap<string /* zoneId */, string /* departmentId */>;
// RoutingMoment gains: readonly periods?: ReadonlyMap<string /* departmentId */, string | null>;
// selectRoutingCell gains a last parameter: moment: RoutingMoment | null (null: Any other time).
// decidedBy gains: periodId?: string — set when a period line chose the target.
```

`selectRoutingCell` finds the cell as today, then, when the moment carries the dish's zone's
department's period and the cell has a row for it, returns that row's target with `periodId` set;
otherwise the cell's own target. `routingAt(tx, cfg, at)` reads a department's period the first
time a dish in one of its zones is resolved (`resolveZoneContext` already gives `departmentId`,
`routing-store.ts:667`, `:685`, M) and remembers it for the rest of the call (decision 7). With an
unreadable clock the resolver answers open with every menu orderable and a null period (slice 1
decision 5, `menu-timetable.ts:228-233`, S1): routing then uses "Any other time".

- [ ] **Step 1: Failing tests** — `routing.test.ts` (pure): review focus 3's cases and focus 4's
  second; an extra on a cell with a Lunch line follows the line during Lunch. `routing-store.test.ts`:
  `routingAt` at 13:00 inside Lunch routes a Cocktail Downstairs, at 14:10 inside Afternoon (no
  line) Upstairs; two dishes of one department in one call read its period once (count through a
  wrapper of the seat the test injects). Server: a till send at 13:00 puts the Cocktail's ticket
  item at Downstairs bar (`ticket_items.station_id`); a Cocktail sent held at 13:55 and released at
  14:10 (Afternoon, no line) keeps its ticket item and its printed ticket at Downstairs bar
  (`station-move.ts:59-62`, S1, re-routes only closed or switched-off stations). (Fails today: no
  `cellPeriods`.)
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/routing.test.ts src/routing-store.test.ts`.
- [ ] **Step 3: Implement.** Pass the moment to every `selectRoutingCell` caller
  (`grep -rn "selectRoutingCell(" packages apps`; the dashboard's callers pass `null`).
- [ ] **Step 4: Run; see them pass;** the venue-service node project, the server package; typecheck
  `@waitron/module`, `@waitron/venue-service`, `@waitron/server`, `@waitron/dashboard`.
- [ ] **Step 5: Commit** — `feat(venue-service): a routing cell can send dishes elsewhere during a period (A366)`.

---

### Task A4b: The tester names the period that chose

**Files:** `packages/venue-service/src/routing-store.ts` (`explainRoute :312`, M), `routing-types.ts`
(`RouteExplanation :63-72`, M), `dashboard/prep-stations-screen.ts` (the tester's result,
`:1634-1655`, M), `dashboard/strings.ts`; tests `routing-store.test.ts`, `prep-stations-screen.test.ts`.

**Behaviour:** decision 13. `explainRoute` reads the periods as `routingAt` does for "Now" and
"Date and time"; for "Weekday and time" it reads the department's normal-week range in force at
that minute (`rangeInForce`, `service-day.ts:84`, S1). Its answer carries `decidedBy.periodId`, and
the tester says "during Lunch" beside "Made at".

- [ ] Steps: failing tests (Monday 13:00 names Lunch and Downstairs bar; Monday 16:00 names no
  period and Upstairs bar); watch them fail; implement; the node project and the screen's browser
  file; commit `feat(venue-service): the routing tester names the period (A366)`.

---

### Task A5: Writing period choices, and the preview

**Files:**
- Modify: `packages/venue-service/src/operations.ts` (`configureZone :433-469`, S1: a zone moved to
  another department deletes its cells' period rows for the old department, decision 10),
  `packages/venue-service/src/routing-store.ts` (`validateRoutingCell :90-153`,
  `setRoutingCell :170-193`, `previewRoutingChange :406-470`, `routingModel :802-845`, M),
  `routing-types.ts` (`RoutingChange`, `RoutingMove`, `RoutingModel`), `routes.ts` (`PUT
  /routing/cell :532`, `POST /routing/preview :524`, `STATUS`, S1), `errors.ts`
  (`route.period_invalid`)
- Test: `routing-store.test.ts`, `routes.test.ts`

**Interfaces:**

```ts
// RoutingChange (the cell route's and the preview's body) gains:
readonly periods?: readonly { periodId: string; target: RouteTarget }[]; // omitted = keep stored rows
// RoutingModel gains: periods (decision 11) and, per cell, `periods: { periodId; target }[]`.
// RoutingMove gains: periodIds: string[] | null — null: at any other time.
```

`setRoutingCell` validates (decision 10: the zone's department from `zone_service_policies`, as
`validateRoutingCell` already reads it, `routing-store.ts:100-115`, M), writes the cell, then
replaces its period rows in the same transaction (delete, then insert — nothing outside points at
these rows). `previewRoutingChange` compares before and after untimed, as today, and once for each
period that the old or the new cell names, reporting a move with `periodIds` (moves equal across
periods are merged into one entry).

- [ ] **Step 1: Failing tests:** saving Cocktails · Every zone with Upstairs bar and a Lunch line →
  the model shows both; saving it again without `periods` keeps the line; with `periods: []` clears
  it; clearing the cell deletes its rows; a zone cell naming another department's period → 409
  `route.period_invalid` `other_department`; an unknown period → 404 `route.subject_not_found`
  `subject: "period"`; the same period twice → `repeated`; a line naming a switched-off station →
  409 `route.station_inactive`; moving the Terrace to another department drops its cells' Lunch
  rows and keeps their plain choices; `periods` on the default cell → 400 `field: "address"` (today's refusal); `periods` with a
  null target → 400 `field: "periods"`; the preview of adding
  the Lunch line lists the Cocktails moving to Downstairs bar with `periodIds: [lunch]` and lists
  no untimed move; the model's `periods` gives Lunch's product ids, a variant by its parent.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/routing-store.test.ts src/routes.test.ts`.
- [ ] **Step 3: Implement**; run `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`.
- [ ] **Step 4: Run; see them pass;** the node project; typecheck.
- [ ] **Step 5: Commit** — `feat(venue-service): save and preview a cell's period choices (A366)`.

---

### Task A6: Deleting a period that routing names warns first

**Files:**
- Modify: `packages/venue-service/src/menu-timetable.ts` (`readOpeningHoursModel :624`; the
  period entries of `OpeningHoursModel`, `menu-timetable-types.ts:37-64`, S1),
  `dashboard/opening-hours-screen.ts` (the delete `wt-dialog`, `:422-455`, S1), `dashboard/strings.ts`
- Test: `menu-timetable.test.ts` (or the opening hours model's suite), `opening-hours-screen.test.ts`,
  `.a11y.test.ts`

**Behaviour:** each period in the model carries `routingUses: { rowLabel: string; zoneName:
string | null }[]`. The delete dialog, when the list is not empty, says "Routing names this period
in {n} cells. Their choices for it will be removed:" and lists them ("Cocktails · Every zone");
confirming deletes, and the cells keep their other lines (decision 12).

- [ ] Steps: failing tests (the model lists the uses; the dialog lists them; after confirming the
  cell's Lunch row is gone and its Afternoon row stays — fails today: no `routingUses`); watch them
  fail; implement; the node project and the screen's browser files; LOOK at the dialog in EN and
  ES, both themes, 1280 and 390; commit
  `feat(venue-service): deleting a period warns about the routing that names it (A366)`.

---

### Task A7: The routing read-outs show period lines

**Files:**
- Modify: `packages/venue-service/src/dashboard/routing-grid-model.ts` (the model the grid draws
  from), `apps/dashboard/src/widgets/folder-made-at.ts` (`folderMadeAt :70-130`, `timed :116-125`,
  S1), `packages/venue-service/src/routing-store.ts` (`describeMakers :746`, M) if its answer gains
  `periodLines: boolean`, `apps/server/src/catalogue-api.ts` (`:1305-1344`, M) only to pass it on,
  `apps/dashboard/src/api/live-queries.ts` (`listMadeAt`, `getFolderRouting`, `:231-255`, S1: add
  `routing_cell_periods`, which is all these untimed reads newly depend on)
- Test: `routing-grid-model.test.ts`, `apps/dashboard/src/widgets/folder-made-at.test.ts`,
  `apps/dashboard/src/api/live-queries.test.ts` if it pins the lists

**Behaviour:** the grid model gives each cell its period lines in decision 15's words, and marks
an inherited cell's lines as inherited. The Products screen's folder read-out treats a category
whose applying cell has period lines as "timed" (its existing marker for a station with hours,
`:116-125`, S1), so it shows that the answer changes during the day.

- [ ] Steps: failing tests (decision 15's three cases; an inherited zone cell carries the Every
  zone line; a folder whose cell has a Lunch line reads as timed — fails today: no lines); watch
  them fail; implement; `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/routing-grid-model.test.ts`
  and `pnpm --filter @waitron/dashboard exec vitest run src/widgets/folder-made-at.test.ts`;
  typecheck both; commit `feat: routing read-outs show period lines (A366)`.

---

### Task A8a: The routing cell editor

**Files:**
- Create: `packages/venue-service/src/dashboard/routing-cell-editor.ts` (`wt-modal`, element
  `routing-cell-editor`), its `.test.ts`, `.a11y.test.ts`, `.save-state.test.ts`,
  `.unsaved.test.ts`; `dashboard/strings.ts`

**Interfaces:** properties `cell` (the address, its stored choice and lines, or the inherited ones
with where they come from), `periods` (the model's, decision 11, in decision 15's order), `stations`,
`rowProductIds`, `zoneDepartmentId` (null for Every zone), `isDefaultCell`; events (app-owned, plain
names, bubbling and composed) `routing-cell-save` `{ target, periods }`, `routing-cell-clear`,
`routing-cell-cancel`.

**Behaviour:** decision 14. "Any other time" (required); each line: a periods `wt-combobox
multiple` offering the column's periods (a zone column its department's; Every zone all, grouped by
department) whose `productIds` meet `rowProductIds`, and not a period already in another line; a
station `wt-combobox` with the cell's own choices; Remove. "+ Different station during some
periods" (absent when `isDefaultCell`, decision 8). Clear only for a stored cell. A refusal set on
the editor lands under the line whose period it names, else at the bottom. A331 rule, with
decision 14's starting state.

- [ ] Steps: failing tests (the offers for a zone column and for Every zone; a period whose
  products miss the row is not offered; a period in one line is not offered in another; adding a
  line and saving emits `routing-cell-save` with `periods`; Remove; Clear; an inherited cell's Save
  is available at open and a stored cell's is not; the reconnect case; axe for empty, two lines and
  a refusal, both themes); watch them fail
  (`pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/routing-cell-editor`);
  implement; commit `feat(venue-service): a routing cell editor with period choices (A366)`.

---

### Task A8b: The grid's cells open the editor

**Files:**
- Modify: `dashboard/routing-grid.ts` (the cell `:361-378` and `#defaultCell :392-426`, M; events
  `routing-cell-change :376`, `routing-make-default :426`), `prep-stations-screen.ts` (the handlers
  that run the preview, `#previewDialog :3230-3291`, M — the moves say "during Lunch"),
  `routing-client.ts` (`setCell :285`, `preview :190`, M: pass `periods`),
  `dashboard/live-queries.ts` (`routing`, `:17-41`, S1: add `routing_cell_periods`, `menu_periods`,
  `menu_period_staff_menus`, `menu_slots`, `menu_day_timetables`, `departments`,
  `zone_service_policies` and the section and catalogue tables `reachableProducts` reads — taken
  from the model's queries, not from memory)
- Test: `routing-grid.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`, `prep-stations-screen.test.ts`
  (the preview cases), `routing-client.test.ts`

**Behaviour:** the cell is a button: the station (italic when inherited), the period lines beneath
(Task A7). Clicking opens Task A8a's editor on that cell; Save runs the preview, then `setCell`
with `periods` once confirmed; the default cell saves through `routing-make-default` as today. A
refusal from the write is handed to the editor.

- [ ] **Step 1: Changed test checks commit** for the inline combobox's cases (listed under
  "Behaviour this slice removes"): each case that chose through the combobox now opens the editor
  and saves through it, asserting the same write and the same preview.
- [ ] **Step 2: Failing tests:** the cell is a button whose accessible name holds station and lines;
  saving a Lunch line previews, then writes `periods`; a `route.period_invalid` refusal lands under
  its line; a live update to `routing_cell_periods` redraws the cell.
- [ ] **Step 3: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/routing-grid src/dashboard/prep-stations-screen.test.ts`.
- [ ] **Step 4: Implement;** the venue-service node project and `pnpm exec vitest run scripts/live-subscriptions.test.ts`.
- [ ] **Step 5: LOOK** at the grid and the editor in EN and ES, both themes, 1280 and 390; confirm
  the long station name no longer meets an arrow.
- [ ] **Step 6: Commit** — `feat(venue-service): routing cells open their editor (A366)`.

---

### Task A9: The routing grid at phone width

**Files:** modify `dashboard/routing-grid.ts` (`:69-79`, `:115-123`, M); test
`routing-grid.test.ts` (`:751`, `:773`, M).

**Behaviour:** decision 18.

- [ ] Steps: the changed check first (`:751`'s cap of 140 becomes 96, in the separate commit);
  failing test in Chromium at a 390 px viewport: the row-label column is at most 96 px and the
  Every zone column and the first zone column lie wholly inside the grid's visible width with
  `scrollLeft` 0; `:773`'s sticky labels still hold; watch them fail; implement; LOOK in EN and ES,
  both themes, 390 and 1280; commit `fix(venue-service): two routing columns fit a phone (A366)`.

---

### Task A10: Server — one request edits a station's name, printers and rest of order

**Files:**
- Modify: `apps/server/src/management-api.ts` (`PATCH /management-api/stations/:id :2025-2084`,
  `POST /management-api/stations`, M), `apps/server/src/kitchen.ts` (`updateStation`,
  `createStation :103`, S1), `apps/server/src/station-printers.ts` (`replaceStationPrinters :64`,
  M); `management-api.ts`'s `STATUS` (`:251`, M) gains `"printer.makes_and_watches": 409` (today
  only `print-api.ts` maps it; an unlisted code answers 400, `packages/server-kit/src/error-boundary.ts`)
- Test: the station routes' suite (`grep -rln "management-api/stations" apps/server/src --include='*.test.ts'`)

**Behaviour:** decision 19. Both routes accept `printerIds?: string[]`; the station row and its
printers are written in one transaction; with `printerIds` the route also checks `printer.manage`
(`print-api.ts:101`, M, the permission today's printers route needs) and refuses
`authorization.not_permitted` without it, writing nothing; a refused printer (switched off, or a
watcher's — `printer.makes_and_watches`, decision 4) leaves the name unchanged too. The route's
early "nothing to change" answer (`:2070-2080`, M, a 204 before any check) counts `printerIds` as a
change. The editor sends `printerIds` only when they changed, since `replaceStationPrinters` refuses
a switched-off station (`station.not_found`, `station-printers.ts:70-74`, M): a switched-off
station's name can still be edited.

- [ ] Steps: failing tests (a PATCH with a new name and two printers stores both; the same by a
  person with `venue.configure` but not `printer.manage` → 403 `authorization.not_permitted` and
  nothing stored, while a PATCH of the name alone by that person succeeds; one with a watcher's
  printer → 409 `printer.makes_and_watches` and the old name kept; a POST with printers
  creates the station with them — fails today: the field is ignored or refused); watch them fail;
  implement; the server package; typecheck; commit
  `feat(server): a station's printers save with the station (A366)`.

---

### Task A11a: Dashboard — the station editor replaces Rename

**Files:**
- Create: `packages/venue-service/src/dashboard/station-editor.ts` (`wt-modal`) and its `.test.ts`,
  `.a11y.test.ts`, `.save-state.test.ts`, `.unsaved.test.ts`
- Modify: `dashboard/prep-stations-screen.ts` (`#stationMenu :1177-1243`, `#renameDialog
  :1282-1337`, the New station dialog `:3156-3193`, M), `routing-client.ts` (`updateStation :235`,
  `createStation :212`, M: `printerIds`), `dashboard/strings.ts`
- Test: `prep-stations-screen.test.ts`, `.a11y.test.ts`

**Behaviour:** decision 19. ⋮: Edit, Make default, Disable/Enable. The editor: name (required),
printers (`wt-combobox multiple`, active printers; a read-out without `printer.manage`), "Show the
rest of the order" (a switch); one `updateStation` call. The New station dialog gains printers.

- [ ] **Step 1: Changed test checks commit** for Rename's cases: each renames through Edit.
- [ ] **Step 2: Failing tests** — Edit saves name, printers and the switch in one call; without
  `printer.manage` the printers are a read-out and the call carries none; a refusal lands under
  Printers; New station with printers; the editor's save-state, unsaved and reconnect cases; axe in
  both themes.
- [ ] **Step 3: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/station-editor src/dashboard/prep-stations-screen.test.ts`.
- [ ] **Step 4: Implement;** the node project; LOOK at the editor in EN and ES, both themes, 1280
  and 390.
- [ ] **Step 5: Commit** — `feat(venue-service): a station editor sets name, printers and rest of order (A366)`.

---

### Task A11b: Dashboard — the Stations tab's read-outs; the Tickets tab and the Settings column go

**Files:**
- Modify: `dashboard/prep-stations-screen.ts` (`PREP_TABS :78`, the Tickets panel `:3516` and
  `#tickets :1972-2035`, `#printerCell :1878-1971`, `#saveStationPrinters :1841`, the Settings
  column `:2712-2715`, M), `dashboard/station-health-table.ts` (two read-out columns),
  `routing-client.ts` (`setStationPrinters :246`, M, only if `grep` finds no other caller),
  `dashboard/strings.ts`
- Test: `prep-stations-screen.test.ts`, `.a11y.test.ts`, `.printers-unsaved.test.ts` (deleted: its
  subject goes, and the editor's reconnect case is Task A11a's), `.settings.test.ts`,
  `.settings-unsaved.test.ts`, `station-health-table.test.ts`

**Behaviour:** decision 16. The Stations table: name, "Printed on" (printer names, or "No
printer"), "Shown on" (the kitchen displays bound to the station and those bound to a watcher that
follows it — today's two read-outs merged, `:1994-2025`, M; if slice 5 Part A has landed, the
monitors that show it, slice 5 Task A17), then the live numbers as today (decision 20). The
Settings tab keeps timing and the fallback column (until Part B).

- [ ] **Step 1: Changed test checks commit** for the Tickets tab and the Settings "Show the rest of
  the order" column (under "Behaviour this slice removes"): a case that edited printers in the
  Tickets cell now edits them in the editor; the Settings case now checks the editor's switch.
- [ ] **Step 2: Failing tests** — the tab list is Stations, Routing, Watchers, Settings; the two
  read-outs show; `view=tickets` opens Stations; axe in both themes.
- [ ] **Step 3: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/prep-stations-screen src/dashboard/station-health-table`.
- [ ] **Step 4: Implement;** the node project; LOOK at Stations in EN and ES, both themes, 1280
  and 390.
- [ ] **Step 5: Commit** — `feat(venue-service): stations show their printers and screens; the Tickets tab goes (A366)`.

---

### Task A12: The tab row at phone width

**Files:** modify `packages/ui/src/components/wt-tabs.ts` (`:28-42`, `:117`, `:147-156`, M) and
its tests (`wt-tabs.test.ts`, `wt-tabs.a11y.test.ts`; a token-painting case if the fade reads a
token), `packages/venue-service/src/dashboard/prep-stations-screen.ts` (`:3444-3458`, M); tests
`prep-stations-screen.test.ts` (`:2844-2851`, M).

**Behaviour:** decision 17. `wt-tabs` sets `data-overflow` to `start`, `end`, `both` or nothing from
its strip's scroll position and size (on scroll and on resize), and masks the cut end
(`mask-image` with a transparent stop `var(--wt-space-6)` from the edge). The screen shows "New
station" on Stations and "New watcher" on Watchers only.

- [ ] Steps: the changed check first (`:2844-2851` keeps the 50% cap and asserts one action);
  failing tests: in `wt-tabs.test.ts`, a strip narrower than its tabs reports `end` at the start,
  `both` after scrolling a little, `start` at the end, and nothing when it fits; in the screen, at
  390 px in ES (the longest labels) the strip reports `end` and the selected tab is fully visible;
  watch them fail (`pnpm --filter @waitron/ui exec vitest run src/components/wt-tabs` and the
  screen's file); implement; axe for `wt-tabs` overflowing in both themes; LOOK at Prep stations
  and one other tabbed screen in EN and ES, both themes, 390 and 1280; run
  `pnpm --filter @waitron/ui exec vitest run src/no-hardcoded-chrome.test.ts`; commit
  `feat(ui): a tab row shows that it scrolls (A366)`.

---

### Task A13: Documentation and backlog (Part A)

**Files:** `docs/developers/design-system.md` (the Prep stations paragraph `:2982-2995`, S1; the
save-editor list `:1718-1723`, S1; add the cell editor and the station editor; the tab fade under
`wt-tabs`), `docs/developers/products.md` (`:223`, M, if a combined ticket's names need a line),
`docs/backlog.md` (A366: slice 4 Part A built; delete the bullet "At 390 px the routing grid's
fixed first column…" `:1439-1443`, M, and its detail `docs/backlog/kitchen.md:93-99`; in "On the
Routing tab, the label… is cut" `:1432-1437`, M, delete the tab-row half and keep the "W…" half,
which Part B closes), `docs/backlog/service-periods.md` (the A366 detail).

- [ ] Read every claim about kitchen tickets per station, station printers, the Tickets tab and
  Rename across `docs/developers/` (CLAUDE.md §1: a behaviour change retires every receipt about
  the old one: `grep -rn -i "tickets tab\|each of its printers\|Printed on\|Rename" docs/developers`),
  correct each, and commit `docs: shared printers, period choices and the station editor (A366)`.

Then run `/finish-branch` with this worktree and this plan. Pull request's first line: **"no venue
reset needed"**. Its body lists the changed test checks.

---

## Part B — no station hours or fallbacks; worked-out times (second pull request, after slices 2 and 3)

Re-ground first. Slices 2 and 3 change the files below; read what landed:
`git log --oneline <slice-2 merge>^..<slice-3 merge> -- packages/venue-service/src/routing.ts packages/venue-service/src/routing-store.ts packages/venue-service/src/station-times.ts packages/venue-service/src/hours.ts packages/venue-service/src/dashboard/hours-screen.ts packages/venue-service/src/dashboard/prep-stations-screen.ts packages/venue-service/src/dashboard/opening-hours-screen.ts`,
then `grep -rn "fallbackId\|todaySendsTo\|readStationSchedules\|stationsRestrictedFrom\|out_of_hours\|opened_by_hand\|station_fallbacks\|hours_week_cells\|special_date_hours" apps packages --include='*.ts'`
for the current readers. If slice 3 has not stored a destination with "Close for today", or slice 2
has not moved named days off the Station hours screen, STOP and ask.

### Task B1a: Routing without hours or fallbacks (pure)

**Files:**
- Modify: `packages/venue-service/src/routing.ts` (`StationTiming :53-61`, `stationStatus
  :193-220`, `stationDayHours :226-235`, `walkFallbacks :244-260`, `followFallbacks :262-268`,
  `closedSendsTo :270-282`, the `why` unions `:70-75`, `:85`, M, as slice 3 left them),
  `routing-types.ts`
- Test: `routing.test.ts`

**Behaviour:** decision 22. `StationTiming` keeps `today` and `todaySendsTo` only. `stationStatus`
answers `switched_off`, `default`, `closed_by_hand` or `open`. The walk from a closed or
switched-off station goes to `todaySendsTo` when recorded, else to the default station; it ends at
`noReplacement` only when no active default exists.

- [ ] **Step 1: Changed test checks commit**, listed with
  `grep -rn "fallbackId\|stationFallbacks\|setStationFallback\|setStationToday\|hours:\|out_of_hours\|in_hours\|no_hours\|opened_by_hand\|time_not_applied\|nextTransition\|no_replacement\|noReplacement\|switched_off" <file>`
  over `routing.test.ts` here and, for Task B1b, `routing-store.test.ts`, `station-times.test.ts`,
  `hours-routes.test.ts`, `apps/server/src/catalogue-api.test.ts` (`:1508-1520`, M),
  `working-order.test.ts` (`:3255-3280`, M), `station-move.test.ts`, the `dead-ends` suites, and
  the dashboard's `product-list` and `folder-made-at` tests: a case whose station was closed by
  its hours becomes one closed for today with the same expected destination where it named one,
  else the default station; a case expecting `noReplacement` for a switched-off station or a
  closed loop now expects the default station (decision 22); a case whose whole subject was hours
  is deleted and listed.
- [ ] **Step 2: Failing tests:** review focus 6's pure cases.
- [ ] **Step 3: Run; watch them fail;** implement; the venue-service node project; typecheck.
- [ ] **Step 4: Commit** — `feat(venue-service): a station is open unless closed for today (A366)`.

---

### Task B1b: Routing without hours — the store, the seats and the server

**Files:**
- Modify: `routing-store.ts` (`snapshot`'s hours and fallback reads `:258-265`; `routingModel`'s
  `stationTimes :826-838`; `nextChangeFinder :855-`; `stationStates`; slice 3's
  `scheduledStationStatus`, M), `station-times.ts` (slice 3's `openStationForToday`, decision 23),
  `packages/module/src/module.ts` (`StationTodayState.why`, slice 3; the `ExtraMakerOutcome` why
  comment), `apps/dashboard/src/widgets/folder-made-at.ts` (`timed :116-125`, S1: a station is
  "timed" only through period lines now), `dashboard/routing-grid.ts` (`#fallbackSentence
  :268-282`, M)
- Test: `routing-store.test.ts`, `station-times.test.ts`, the server suites Task B1a's grep listed

**Behaviour:** `routingModel`'s station times lose `hours`, `weekSet`, `specialDateRestricts`,
`fallbackStationId` and `nextTransition`; opening a station closed for today deletes its row; a
slice 3 row with no destination lands at the default station; review focus 6's server cases.

- [ ] Steps: failing tests; watch them fail; implement; the venue-service node project, the server
  package, the dashboard's folder read-out file, and the till's suite (Chromium, headroom first);
  typecheck every package the typecheck names; commit
  `feat(venue-service): routing reads no station hours (A366)`.

---

### Task B2: The till and the kitchen display without hours

**Files:** `apps/till/src/` where slice 3's status line shows `out_of_hours` or `opened_by_hand`
(`grep -rn "out_of_hours\|opened_by_hand" apps/till/src`), `i18n/strings.ts`; `apps/server/src/`
`till-api.ts` (`GET /api/stations`), `device-api.ts` (slice 3's `today`), `alert-sources.ts`
(`:337-344`, M: a printer-down alert is suppressed for a closed station — now only a station closed
for today), and their tests.

- [ ] Steps: failing tests (the kitchen display's status line never reads "outside its hours"; a
  printer-down alert for a station closed for today is suppressed and for an open one is raised —
  fails today on the removed `why` values' strings and types); watch them fail; implement; the
  server package and the till's suite; commit `feat: the till and kitchen display drop station hours (A366)`.

---

### Task B3: Dashboard — the Today column, status sentences and fallback field go

**Files:** `dashboard/prep-stations-screen.ts` (`#stationStatus :1670-1695`, `#todayCell
:1696-1715`, `#destination :1661-1665`, the Settings fallback cell `:2487-2609`, `#fallbackOptions
:1716-1728`, the Station action dialog's fallback `:3349-3368`, `#fallbackConfirmation
:1770-1789`, the Disable flow `:1235-1241`, the Disabled section's `prep.off_*` cards in the
Routing tab, M, as slice 3 left them), `station-health-table.ts` (the Today column `:141`, M),
`routing-client.ts` (`setStationFallback :258`, M), `dashboard/strings.ts` (`prep.when_closed`
and the status keys `:115-160`, S1, once unused); tests `prep-stations-screen*.test.ts`,
`station-action.unsaved.test.ts`, `station-health-table.test.ts`.

**Behaviour:** decisions 20 and 24. The Stations table shows "Closed for today → {destination}" or
"Switched off" beside a station's name instead of a Today column. Disable confirms with the cells
that name the station and where their dishes go.

- [ ] Steps: the changed-checks commit (each Today, fallback and Disable-asks case, with
  `file:line`, before and after); failing tests (no Today column; the note beside a closed
  station; Disable lists the naming cells and sends no fallback; the Settings tab has no fallback
  column); watch them fail; implement; LOOK in EN and ES, both themes, 1280 and 390; commit
  `feat(venue-service): Prep stations drops hours and fallbacks (A366)`.

---

### Task B4: The tester goes; empty and No preparation cells say what extras do

**Files:** `dashboard/prep-stations-screen.ts` (`#tester :1471-1657`, `#explain :1418`, `.tester-when`
CSS `:170-191`, the `test` URL key `:290`, M), `dashboard/routing-explanation.ts` and its test
(deleted if nothing else imports it), `routing-client.ts` (`explain :197-211`, M), `routes.ts` (`GET
/routing/explain :486`, S1), `routing-store.ts` (`explainRoute :312`, M), `routing-types.ts`
(`RouteExplanation`), `apps/dashboard/src/navigation.ts` (`"prep-stations": { view, test }`, `:9`,
S1), `dashboard/routing-grid.ts`, `dashboard/strings.ts` (`prep.test_*`); tests
`prep-stations-screen.test.ts`, `.a11y.test.ts` (`:550-552`, M), `routing-client.test.ts`,
`routes.test.ts`, `routing-grid.test.ts`.

**Behaviour:** spec §9.3. The route answers 404. An empty cell, and a No preparation cell, show
"{station} (default) — as an extra, follows its dish" (empty) or "No preparation — as an extra,
follows its dish"; a cell naming a station, even the default one, does not (owner, A371).

- [ ] Steps: the changed-checks commit (every tester case, deleted and listed; the backlog's
  `#fallbackReason` gap, `docs/backlog.md:1323-1327`, M, goes with its subject); failing tests (no
  tester; the two notes; a cell naming the default station has no note); watch them fail;
  implement; LOOK at Routing in EN and ES, both themes, 1280 and 390; commit
  `feat(venue-service): the routing tester goes; cells say how extras follow (A366)`.

---

### Task B5: The Station hours screen goes

**Files:** `dashboard/hours-screen.ts`, `hours-client.ts`, `hours-view.ts`, `hours-dates-list.ts`,
`hours-cell-editor.ts` and their tests (each deleted once `grep -rn "<file stem>" packages apps`
finds no importer outside the deleted set — slice 2 may have moved the calendar component to
Opening hours), `dashboard/index.ts` (the `hours` entry, `:53-70`, S1), `dashboard/live-queries.ts`
(`hours :42-56`, S1), `apps/dashboard/src/navigation.ts` (`hours`, `:10`, S1) and its test,
`dashboard/strings.ts` (`nav.hours`, `hours.*` once unused); every link to `/manage/hours` (`grep -rn
"manage/hours\|dashboard: \"hours\"" packages apps docs`).

- [ ] Steps: the changed-checks commit (the deleted suites, by file; `navigation.test.ts`'s `hours`
  case); failing tests (the dashboard registers no `hours` screen; navigation has no `hours` key;
  `scripts/live-subscriptions.test.ts` passes); watch them fail; implement; commit
  `feat(venue-service): the Station hours screen goes (A366)`.

---

### Task B6: Server — station-hours writers, readers, routes and codes go

**Files:** `packages/venue-service/src/hours.ts` (`replaceWeekHours`, `readWeekHours`,
`readStationSchedules`, `stationsRestrictedFrom`, `assertDemotedStationHours`, `readHoursModel`,
the station parts of the named-day writer — as slice 2 left them), `hours-types.ts`,
`hours-rules.ts`, `station-times.ts` (`setStationFallback :25-64`, M), `routes.ts` (the `/hours`,
`/hours/week`, special-date station-cell and `/stations/:stationId/fallback` routes, S1, as slice 2
left them), `errors.ts` (`station.fallback_loop` and each code `grep` shows only hours threw),
`index.ts`, `service.ts`, `configuration-transfer.ts` (the hours tables and `station_fallbacks`,
`:561-572`, S1, and `validateHoursConfiguration`), `testing/station-week.ts` (deleted);
`apps/server/src/kitchen.ts` (`assertDefaultCanStepDown :83-95`, S1);
`apps/dashboard/src/i18n/codes.ts` (retired codes); tests `hours.test.ts`, `hours-routes.test.ts`,
`hours-station-model.test.ts`, `station-times.test.ts`, `configuration-transfer.test.ts` (both),
`routes.test.ts`, `kitchen.test.ts` or the default-station suite.

- [ ] Steps: the changed-checks commit (deleted suites by file; changed cases with `file:line`; a
  configuration export no longer carries the five tables — `apps/server/src/configuration-transfer.test.ts`'s
  hours cases, `:3932-3944`, `:4011-4012`, `:4112`, `:4135-4138`, `:4187`, S1); failing tests (Make
  default no longer refuses on a demoted station's hours; the removed routes answer 404; an export
  has no `station_fallbacks` or hours tables); watch them fail; implement; run
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`; the
  venue-service node project, the server package; typecheck; commit
  `feat(venue-service): station hours and fallbacks leave the server (A366)`.

---

### Task B7: Migration — drop the station-hours and fallback tables

**Files:** `packages/venue-service/src/schema/hours.ts` (`hours_week_cells`, `hours_week_periods`,
`special_date_hours`, `special_date_hours_periods`, `:30-168`, M), `schema/station-times.ts`
(`station_fallbacks :5-24`, M), `schema/index.ts`, `classification.ts` and its test,
`migrations.test.ts`, `service.test.ts` (`:93-94`, M: the configuration transfer's table list),
`scripts/schema-constraints.test.ts` (`:59-69`, `:306-317`, `:461-471`, S1), `scripts/migration-upgrade.test.ts`,
`apps/server/src/testing/clear-provision-fixture.ts` (`:15-24`, S1),
`packages/venue-service/src/dashboard/live-queries.ts` and `apps/dashboard/src/api/live-queries.ts`
(`:231-255`, S1: both name `station_fallbacks` and the hours tables); generated drizzle files.

- [ ] **Step 1:** list the keys pointing at each table (`grep -rln 'REFERENCES \`hours_week_cells\`\|REFERENCES \`special_date_hours\`\|REFERENCES \`station_fallbacks\`' packages/*/drizzle/`);
  expected: only the two `*_periods` children, dropped in the same generation. If any other table
  points at one, STOP.
- [ ] **Step 2: Failing test** in `migrations.test.ts`: the five tables are absent.
- [ ] **Step 3:** remove them from the schema and generate; read the SQL (five `DROP TABLE`, children
  first). Remove them from classification, the guard lists, the clear list and `service.test.ts`.
- [ ] **Step 4: Run** the Task A3 guard list, `scripts/live-subscriptions.test.ts`, and the
  upgrade walk; if it reports a casualty, add the `RESETS` entry it names and change the pull
  request's first line to "venue reset needed" with that reason.
- [ ] **Step 5: Commit** — `feat(venue-service): drop station hours and fallbacks (A366)`.

---

### Task B8: The worked-out times

**Files:**
- Create: `packages/venue-service/src/station-service-times.ts` and its test
- Modify: `routes.ts` (`GET /management-api/venue-service/stations/:stationId/service-times?from=&to=`),
  `index.ts`

**Interfaces:**

```ts
export interface StationServiceDay {
  readonly date: LocalDate;
  readonly departments: readonly { departmentId: string; ranges: readonly ServiceRange[] }[]; // ranges carry periodId
}
export async function stationServiceTimes(
  tx: Transaction, cfg: VenueScope, stationId: string, from: LocalDate, to: LocalDate,
): Promise<{ always: "default" | "switched_off" | null; days: readonly StationServiceDay[] }>;
```

Decision 21, reading each date's department ranges as slice 2's real week does (named days
applied), each zone's closed ranges as slice 2's Task 8 reader gives them, each period's products
(decision 11's reader, shared, not copied), and the routing rules once (`loadRoutingRules`,
`routing-store.ts:302`, M) with the moment's period set to the period being tested. At most 42
days per call (`management.request_invalid` beyond).

- [ ] Steps: failing tests (review focus 7's three cases; the default station answers `always:
  "default"`; a switched-off one `switched_off`; a station no routing reaches has no ranges);
  watch them fail (`pnpm --filter @waitron/venue-service exec vitest run --project node src/station-service-times.test.ts`);
  implement; the node project; typecheck; commit
  `feat(venue-service): when a prep station gets orders, worked out (A366)`.

---

### Task B9: Opening hours — the prep station view

**Files:**
- Create: `dashboard/opening-hours-station.ts` and its `.test.ts`, `.a11y.test.ts`
- Modify: `dashboard/opening-hours-screen.ts` (slice 2 Task 16's picker; the URL's `station` key),
  `opening-hours-client.ts`, `apps/dashboard/src/navigation.ts` (`opening-hours` children),
  `dashboard/strings.ts`; tests `opening-hours-screen.test.ts`, `navigation.test.ts`

**Behaviour:** decision 25. Read-only; the default station and a switched-off one show their
sentence instead of a grid.

- [ ] Steps: failing tests (the picker's Prep stations group lists active stations; choosing one
  writes `station=` and shows its columns; the real week's ‹ › reloads; the default's sentence;
  axe in both themes); watch them fail; implement; LOOK in EN and ES, both themes, 1280 and 390;
  commit `feat(venue-service): Opening hours shows when each prep station gets orders (A366)`.

---

### Task B10: The demo

**Files:** `apps/server/scripts/demo-seed/seed-floor.ts` (`:154-161`, S1), `seed.test.ts`
(`:301-311`, S1).

- [ ] Steps: the changed check (the seed test's hours and fallback assertions become the period
  line's); failing test (the demo's drinks cell has the evening line, decision 27); watch it fail;
  implement; `pnpm --filter @waitron/server exec vitest run scripts/demo-seed`; commit
  `feat(demo): the demo routes drinks upstairs in the evening (A366)`.

---

### Task B11: The Stations tab links to Opening hours

**Files:** `dashboard/prep-stations-screen.ts` (the Stations table), `dashboard/strings.ts`; test
`prep-stations-screen.test.ts`.

- [ ] Steps: failing test (each active, non-default station's row links "When it gets orders" to
  `/manage/opening-hours?view=week&station=<id>`); watch it fail; implement; commit
  `feat(venue-service): a station links to when it gets orders (A366)`.

---

### Task B12: Documentation and backlog (Part B)

**Files:** `docs/developers/design-system.md` (Prep stations and Station hours paragraphs,
`:2982-3017`, S1, as slices 2–3 left them), `docs/developers/conventions-data.md` (`:402`, `:1203`,
S1), `docs/developers/public-holidays.md` (`:4`, S1), `docs/backlog.md` (A366: slice 4 built;
delete "For a non-default station with no hours…" `:1282-1283`, the "W…" half of `:1432-1437`, and
the `#fallbackReason` entry `:1323-1327`, M, each only if Part B removed its subject),
`docs/backlog/kitchen.md` (`:84-92`, M), `docs/backlog/setup.md` (`:174-176`, M: station hours and
an unreadable zone), `docs/backlog/service-periods.md`.

- [ ] Read every claim about station hours, fallbacks, "When closed, work goes to", the tester and
  the Station hours page across `docs/developers/` and the backlog (`grep -rn -i "station hours\|fallback\|Where is this made\|manage/hours\|out of hours" docs/developers docs/backlog.md docs/backlog`),
  correct each, and commit `docs: prep stations have no hours (A366)`.

Then run `/finish-branch` with this worktree and this plan. Pull request's first line: **"no venue
reset needed — station hours and fallbacks are deleted"** (or Task B7's reset line).

---

## After the last task of each part

- The focused suites the tasks named, then `/finish-branch` (it lets the pre-push hook run the
  local checks once; CI runs the package suites, coverage, mutation and bundles).
- Before calling either part green, read every CI job on the current head
  (`gh run view <id> --json jobs`), including the licence run.
- The pull request lists, under "Changed test checks", every check changed with `file:line`, before
  and after, and the decision or spec line that changed it, and adds one FYI to the lane's
  `questions.md`.
