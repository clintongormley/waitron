# Prep stations, slice 4 — combined tickets, period choices in routing, and no station hours (A366)

> **Revised 2026-10-09.** The owner answered all 28 decisions on 2026-10-09
> (`~/waitron-campaign-d/questions.md`, "OWNER ANSWERS … slice 4 decisions"). Every default stands
> except four, and this revision applies them: the server also refuses a period line whose
> period's menus include none of the row's products (decision 10, with new decisions 29–31); the
> "Where is this made?" tester goes in Part A, not Part B (decision 13: old Task A4b is gone, old
> Task B4 moves to Part A as Tasks A3b–A3d, new decisions 32–33); the Stations tab loses its live
> kitchen numbers and the server read only it used (decision 20: new Tasks A11b and A11d, old
> A11b becomes A11c and also renames the table, new decisions 34–36); and closing a station that
> still has open dishes always asks what to do with them (decisions 22–24, Part B's, with new
> decision 37). Part A was also re-read on the new `main`,
> where slices 1, 2 and 3 Part A have landed (see "What this plan was read against").

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
> **What this plan was read against.** **Part A** was re-read on `main` at `46c1333f0` (marked
> **N**), which holds slice 1 (#1460), slice 2 (#1470), slice 3 Part A (#1469), A432's end offsets
> (#1463) and A438's "Move to station" on a paid counter order (#1472). Every `file:line` in Part
> A's tasks, in its file list, in "Behaviour this slice removes" (Part A) and in the review focus
> was opened on N. Files the plan cites that did not change between the first reading and N
> (`git diff --stat ce8185e82 46c1333f0 -- <path>` is empty): `apps/server/src/kitchen-print.ts`,
> `kitchen-ticket.ts`, `station-printers.ts`, `watchers.ts`, `station-move.ts`, `order-groups.ts`,
> `packages/venue-service/src/routing-types.ts`, `schema/routing.ts`,
> `dashboard/routing-grid.ts` and its tests, `dashboard/station-health-table.ts`,
> `packages/catalogue/src/section-graph.ts`. **Part B** still carries the lines read on 2026-10-08:
> `main` at `ce8185e82` (marked **M**) and slice 1's branch at `bdf64d9cd` (marked **S1**). Part B
> must be re-grounded on `main` when it is started.
>
> It builds on the [slice 1 plan](2026-10-07-a366-slice-1-service-periods.md), the
> [slice 2 plan](2026-10-08-a366-slice-2-zone-closed-times-and-named-days.md) and the
> [slice 3 plan](2026-10-08-a366-slice-3-station-controls.md), all three now built (slice 3's
> Part B, keeping a zone open later, is not needed here), and reads the
> [slice 5 plan](2026-10-08-a366-slice-5-monitors.md) for what its Part B needs from this slice.
>
> **Either part may start now:** slices 1, 2 and 3 Part A have merged. Part B re-grounds first.

**Goal:** a printer that several stations print on gets one ticket per send, with a section per
station, so a printer on every station is the pass ticket. A routing cell can send dishes to a
different station during named periods ("Upstairs bar; during Breakfast–Afternoon: Downstairs
bar"). Prep stations lose their hours and their fallbacks: a station is open unless someone closed
it for today, and the Opening hours page shows, read-only, when something it makes can be
ordered. The Prep stations page becomes configuration only: Stations (with their printers and the
screens that show them), Routing and Settings — no live kitchen numbers and no "Where is this
made?" tester.

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
§2 (kitchen tickets), §3 (Prep station), §8, §9 ("Nothing on them shows live state"), §9.2 (the
prep station view), §9.3, §12 (station hours, the station fallback setting, the tester, the
Tickets tab), §13 item 4. Backlog: A366, and the phone-width entries "On the Routing tab, the
label above the 'Where is this made?' time choice is cut" and "At 390 px the routing grid's fixed
first column takes about 140 of the grid's roughly 310 px" (`docs/backlog.md`, detail under the
same titles in `docs/backlog/kitchen.md`).

**Risk path:** FULL ceremony, two run-it reviews per pull request: migrations (Part A adds a
table; Part B drops five), routing that decides where a dish is made, kitchen printing, a removed
management route (`GET /management-api/stations/health`, Part A), and a changed cross-package
contract (`stationStates`, `MakerResolver` and the routing types in
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

**Part A (Tasks A1–A13; A3 with three follow-ons, A4a, A8 in two halves, A11 in four).**

- `apps/server/src/`: `kitchen-print.ts`, `kitchen-ticket.ts`, `rest-of-order.ts` (if the filter
  moves there), `kitchen.ts` (`updateStation :205`, `createStation :103`, N), `management-api.ts`
  (`PATCH /management-api/stations/:id`, `:2026-2085`, N; `POST /management-api/stations`,
  `:1943`, N; `GET /management-api/stations/health`, `:2002-2011`, N, deleted),
  `station-health.ts` (deleted, with `station-health.test.ts`), and their tests
  (`kitchen-print.test.ts`, `kitchen-print.watchers.test.ts`, `kitchen-ticket.test.ts`,
  `print-problems.test.ts`, a new `kitchen-print.shared-printers.test.ts`, `management-api.test.ts`
  (the station routes' cases), `kitchen-timing-consumers.test.ts`);
  `testing/clear-provision-fixture.ts`; `configuration-transfer.test.ts`; `catalogue-api.ts`
  (`/management-api/products/made-at`, `:1349-1397`, N) if its answer gains the period note
- `packages/venue-service/src/`: `schema/routing.ts`, `schema/index.ts`, `classification.ts` and its
  test, `configuration-transfer.ts` and its test, `migrations.test.ts`, `service.test.ts`,
  `routing.ts`, `routing-types.ts`, `routing-store.ts` and their tests, `menu-timetable.ts`
  (`readOpeningHoursModel`, `menu-timetable-types.ts`), `routes.ts` (the cell and preview routes;
  `GET /routing/explain`, `:442-478`, N, deleted), `routes.test.ts`, `errors.ts`, `index.ts`,
  `dashboard/routing-grid.ts`, `dashboard/routing-grid-model.ts`, `dashboard/routing-cell-editor.ts`
  (new), `dashboard/prep-stations-screen.ts`, `dashboard/station-editor.ts` (new),
  `dashboard/station-health-table.ts` (renamed `dashboard/station-table.ts`, decision 36),
  `dashboard/routing-explanation.ts` (deleted, with its test), `dashboard/routing-client.ts`,
  `dashboard/opening-hours-screen.ts`, `dashboard/opening-hours-client.ts`,
  `dashboard/live-queries.ts`, `dashboard/strings.ts`, and their tests (including
  `prep-stations-overview.a11y.test.ts` and `live-queries.test.ts`); `drizzle/` (one generated
  migration)
- `packages/module/src/module.ts`
- `packages/ui/src/components/wt-tabs.ts` and its tests (decision 17)
- `apps/dashboard/src/`: `widgets/folder-made-at.ts` and its test; `api/live-queries.ts`
  (`listMadeAt :231-239`, `getFolderRouting :240-255`, N); `navigation.ts` (the `test` key of
  `"prep-stations"`, `:9`, N) and `navigation.test.ts`; `dashboard-app.test.ts` (the tester case)
- `packages/venue-service/src/operations.ts` (`configureZone`, `:434-470`, N)
- `scripts/schema-constraints.test.ts`
- `docs/developers/design-system.md`, `docs/developers/products.md` (`:223`, N),
  `docs/backlog.md`, `docs/backlog/kitchen.md`, `docs/backlog/service-periods.md`

**Part B (Tasks B1–B12; B1 in two halves; B4 moved to Part A). Lines are M or S1; re-ground.**

- `packages/venue-service/src/`: `routing.ts`, `routing-types.ts`, `routing-store.ts`,
  `station-times.ts`, `hours.ts`, `hours-types.ts`, `hours-rules.ts`, `routes.ts`, `errors.ts`,
  `index.ts`, `service.ts`, `configuration-transfer.ts`, `classification.ts`, `schema/hours.ts`,
  `schema/station-times.ts`, `schema/index.ts`, `migrations.test.ts`, `service.test.ts`,
  `station-service-times.ts` (new), `testing/station-week.ts` (deleted), and their tests;
  `dashboard/prep-stations-screen.ts`, `dashboard/station-table.ts` (Part A's name),
  `dashboard/routing-client.ts`, `dashboard/hours-screen.ts`, `hours-client.ts`, `hours-view.ts`,
  `hours-dates-list.ts`, `hours-cell-editor.ts` (each deleted once nothing imports it),
  `dashboard/index.ts`, `dashboard/live-queries.ts`, `dashboard/strings.ts`,
  `dashboard/opening-hours-screen.ts`, `dashboard/opening-hours-station.ts` (new),
  `dashboard/opening-hours-client.ts`, and their tests; `drizzle/` (one generated migration)
- `packages/module/src/module.ts`
- `apps/server/src/`: `kitchen.ts` (`assertDefaultCanStepDown`, `:83-95`, S1), `dead-ends.ts` (only
  if a `why` it reads goes), `till-api.ts` (`GET /api/stations`), `station-today-api.ts` (slice 3's
  close and open routes, decisions 22–24), `alert-sources.ts`
  (`stationOutputAlertSource`, `:322-370`, M, reads `open`), `testing/clear-provision-fixture.ts`,
  `configuration-transfer.test.ts`, `scripts/demo-seed/seed-floor.ts` (`:154-161`, S1) and
  `seed.test.ts`
- `apps/till/src/`: where a `why` string it shows goes (slice 3's station status line), and slice
  3's `widgets/station-today-dialog.ts` and `widgets/station-today.ts` (closing with open dishes,
  decisions 22–24)
- `apps/dashboard/src/navigation.ts` (the `hours` entry, `:10`, S1),
  `apps/dashboard/src/widgets/folder-made-at.ts` (`timed`, `:116-125`, S1),
  `apps/dashboard/src/api/live-queries.ts` (`:231-255`, S1: its lists name `station_fallbacks` and
  the hours tables), `packages/venue-service/src/dashboard/routing-grid.ts` (`#fallbackSentence`,
  `:268-282`, M)
- `scripts/schema-constraints.test.ts`, `scripts/migration-upgrade.test.ts`
- `docs/developers/design-system.md`, `conventions-data.md`, `public-holidays.md`,
  `docs/backlog.md`, `docs/backlog/*.md`

### 2. Does this slice need slice 2 or slice 3?

All three earlier slices have now landed (#1460, #1470, #1469); the table records why the work is
split as it is.

| What (spec) | Needs | What was checked |
| --- | --- | --- |
| Combined tickets on shared printers (§8, last paragraph) | **Neither — and not slice 1.** | It changes `planKitchenTickets` and the ticket document only (`kitchen-print.ts:445-603`, `kitchen-ticket.ts:46-68`, N). Neither file changed between M and N. |
| Period choices in routing cells (§8) | **Slice 1 only.** | A choice names a department's period (`menu_periods`, `schema/menus.ts:21-47`, N, with the composite key `menu_periods_department_key (id, department_id)`, `:43`, N) and is applied by asking which period runs now (`resolveDepartmentService`, `menu-timetable.ts:432-508`, N). That resolver already applies slice 2's named days and slice 3's kept-open periods (`withExtension`, `:469`, N), so routing follows both. |
| The Stations page slimmed (§9.3): the Tickets tab merged into Stations, the station editor, "Shown on", no live numbers | **Slice 1 only (for the link, slice 2).** | The printers and screens columns move from the Tickets tab (`prep-stations-screen.ts:1958-2021`, N); the editor replaces Rename (`:1281-1337`, N); the live numbers are `station-health-table.ts:142-158` (N). Slice 3 Part A took the Today buttons out of this screen (`#todayCell :1695-1702`, N, now a status line only). The Stations tab's link to Opening hours needs the prep station entries this slice adds to slice 2's picker, so it is in Part B (Task B11). |
| Phone-width points (lane D's queue note on A366-4) | **Neither.** | The routing grid's widths are `routing-grid.ts:69-123` (N); the tab row is `wt-tabs.ts:31-45` (N) with the screen's actions at `prep-stations-screen.ts:3410-3426` (N). The "W…" label is the tester's, which Part A now removes (decision 13). |
| Station hours and fallbacks removed (§8, §12) | **Slices 2 and 3.** | Slice 3's "Close for today" stores where the work goes (`station_day_states.sends_to_station_id`; read as `todaySendsTo`, `routing.ts:57`, N, and followed by `walkFallbacks`, `:245-270`, N). The Station hours screen still exists (`dashboard/index.ts:53-71`, N). Part B, re-grounded. |
| Worked-out times in the Week view (§8, §9.2) | **Slice 2.** | Slice 2's picker and real weeks (`opening-hours-all.ts`, `real-week.ts`, landed in #1470). Part B, re-grounded. |
| The tester removed, with its extras note moved into the grid (§9.3) | **Neither (owner, 2026-10-09).** | The owner moved it into Part A, so the tester never has to name a period (decision 13). |

**Conclusion.** **Part A** (Tasks A1–A13: combined tickets, period choices in routing cells, the
tester gone and its extras note in the grid, the Stations page's configuration columns and editor
with no live numbers, the phone-width points) can be built now. **Part B** (Tasks B1–B12: station
hours, fallbacks and the Station hours screen removed, closing a station with open dishes, the
worked-out times and their view) can also start now that slices 2 and 3 Part A have landed, but its
tasks were written against those slices' plans, not their code, and must be re-grounded.

### 3. Files shared with other work (same files, different areas)

- **Slice 5 Part A** (lane A, branch `feat/service-periods-slice-5-monitors`, not landed, no pull
  request): `prep-stations-screen.ts` (its Task A17 changes the Tickets tab's "Screens" read-out
  "or slice 4's 'Shown on' if it has landed"), `dashboard/live-queries.ts`, `module.ts`, and
  `apps/server/src/station-health.ts` with `station-health.test.ts` (its Task A7, slice 5 plan
  "Task A7: The station screen's routes, station health and dark screens", edits both; this
  slice's Task A11d deletes both). Whoever lands second rebases and reconciles: if slice 5 lands
  first, Task A11d deletes its edits with the file once its search shows no other caller; if this
  slice lands first, slice 5 drops its edits to the deleted files. Task A11d's
  stop-if-another-caller search stays either way. If slice 5 Part A lands before Task A11c, "Shown on" reads the
  device monitors (slice 5 decision 7's shape) instead of `devices.stationId`/`watcherId`.
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

Decisions 1–28 were answered by the owner on 2026-10-09; each heading says how. Decisions 29–37
were added in this revision to carry out the owner's changes; each is the DEFAULT to build, and the
owner may override any when reviewing the plan.

1. **Two pull requests.** _OWNER 2026-10-09: stands._ Part A (combined tickets, period choices,
   the tester, the Stations page's configuration, the phone-width points); Part B (hours and
   fallbacks gone, closing a station with open dishes, the worked-out times). Why: slice 5 Part B
   waits on the combined tickets, and Part B's removals are a separate review. Override: one pull
   request, in the spec's order.
2. **A combined ticket groups by printer, per send.** _OWNER 2026-10-09: stands._ For each
   printer, the stations in this send whose printers include it are that printer's ticket;
   printers whose station set and paper layout (`groupByLayout`, `kitchen-print.ts:170`, N) are
   equal share one rendered ticket, one job per printer, as twin printers do today. A printer with
   one station prints exactly today's station ticket (`scope: "station"`). A printer with two or
   more prints one ticket with a section per station, in the order the send already sorts
   stations (by name, `:504-531`, N), using the watcher ticket's section layout
   (`kitchen-ticket.ts:220-225`, N) under a header naming the stations ("Grill · Bar"). Each
   combined job links to every station it covers (`kitchen_print_jobs` is already unique on
   `(print_job_id, working_order_id, station_id)`, `kitchen_print_jobs_job_order_station_key`,
   `packages/db/src/schema/kitchen-print-jobs.ts:43`, N), so a failed one shows a printing problem
   on each of those stations' cards, as the backlog entry "A failed ticket on a pass printer (one
   ticket for the whole order) shows on the card of every station it covered" describes.
3. **"Show the rest of the order" on a combined ticket.** _OWNER 2026-10-09: stands._ It is
   printed when any station on the ticket has the setting on, and lists the order's other dishes
   at stations NOT on this ticket. Today the filter assumes one station
   (`item.stationId !== route.station`, `kitchen-print.ts:571`, N); it becomes "not one of the
   ticket's stations". Override: only when every station on the ticket has it.
4. **The rule against one printer both making and watching stays until watchers go.** _OWNER
   2026-10-09: stands._ Spec §8 says it goes; while watchers still print (until slice 5 Part B), a
   printer that was both a station's and a watcher's would print the same dish twice per send. So
   `printer.makes_and_watches` (`station-printers.ts:44`, `watchers.ts:324`, N) stays, and slice 5
   Part B removes it with watchers. Override: remove it here and accept the double print until
   slice 5 Part B.
5. **Correction slips stay one per dish.** _OWNER 2026-10-09: stands._ Spec §8: "Reprints and
   correction slips follow the same grouping." A slip is already one per dish on its station's
   printers (`printCorrectionSlips`, `kitchen-print.ts:1040-1113`, N), so a printer shared by
   several stations gets each slip once; nothing prints twice and no slip covers another station's
   dish. A reprint follows the grouping fully (Task A2): `reprintOrderTickets` merges HOLD and fired
   work into one job **per printer** (`:1474-1486`, N, merges per printer and station today),
   joining their station lists, because separate jobs on one printer would let a later one clear an
   earlier one's printing problem (the reason the merge exists, the comment at `:1450-1456`, N);
   and `readReprintTargets` reads the same groups (`:1419-1444`, N). For a combined HOLD ticket,
   "the rest of the order" is left out when ANY of its stations is in `restOfOrderExcept`
   (`:541`, `:1472`, N).

   5a. **"One ticket per send" is one ticket per planning call — a stated limit.** _OWNER
   2026-10-09: stands (limit accepted)._ One send can plan tickets more than once:
   `finishRelease` plans the ordinary dishes, then once per station whose dishes were moved off it
   (with "From X", `working-order.ts:2006-2016`, N); a HOLD advance ticket (`order-groups.ts:1253`,
   N) and a station move (`station-move.ts:324-332`, N) plan on their own. In those sends a printer
   on every station prints one ticket per call — one for the ordinary dishes and one per "From"
   station. Slice 5 Part B's pass ticket inherits this limit.
6. **A period choice is stored per cell and period.** _OWNER 2026-10-09: stands._
   `routing_cell_periods` (cell, period, the period's department, and a target — a station or No
   preparation, as the cell's own). Unique on `(cell_id, period_id)`, which is the spec's "a period
   can be in one line only". The editor groups rows with the same target into one line; two lines
   that name the same station are saved as one. The cell row's own target is "Any other time". A
   cell keeps its id on update (`setRoutingCell` updates in place, `routing-store.ts:176-199`, N),
   so its period rows survive a change of its plain station; clearing the cell deletes the row
   and, by cascade, its periods.
7. **Which period applies.** _OWNER 2026-10-09: stands._ A dish's station is decided when it goes
   on the order, as today: sent, or sent held (a held dish's `ticket_items` row and its station are
   written then, in `fireLines`, `working-order.ts:1454`, its insert at `:1677`, N, and its HOLD
   ticket prints there). The extras of a held dish that are split off to their own station are
   routed at release (`finishRelease` calls `insertSplitExtras` with the release's routing,
   `:1990-2002`, N), so they follow the period running then. At that moment its zone's
   department's running period is read (`resolveDepartmentService(…, at).periodId`) — lazily, once
   per department per routing call, remembered for the rest of the call (`routingAt` already calls
   `resolveZoneContext`, whose answer carries `departmentId`, `routing-store.ts:687`, `:705`;
   `operations.ts:522-556`, N). A dish with no zone uses "Any other time". A held dish keeps its
   station at release: `rerouteHeldAtRelease` re-routes only dishes whose station is switched off
   or not open (`station-move.ts:22-62`, the test at `:61`, N), and a period ending does not close a
   station. A new dish is only accepted until its period's end or earlier last orders (A432's
   offset, `menu-timetable.ts:477-489`, N, takes `min(offset, 0)` for choosing, `:482`); with a positive
   offset it may be SENT after the period ends, and is then routed by the period running at the
   send, or "Any other time" when none runs. A period kept open (slice 3) or a named day with its
   own hours (slice 2) changes the answer because the resolver does. Untimed reads (the preview,
   `describeMakers`, the Products screen's folder read-out) use "Any other time". Override:
   re-route held dishes at release by the period then running.
8. **Cells that can have period choices.** _OWNER 2026-10-09: stands._ Every stored cell can, and
   so can a zone's All categories cell. The All categories × Every zone cell cannot: it is the
   default station and is never a row (`schema/routing.ts:15`, `routing_cells_coordinate_ck
   :58-61`, N). A period line on it would need a second way to store the default. Override: store
   the default cell's period lines with a null cell id.
9. **A cell with period choices needs a plain choice.** _OWNER 2026-10-09: stands._ "Any other
   time" is required; the editor fills it with what the cell shows now (its own choice, or the
   inherited one). A cell that sets nothing inherits the whole cell above it, period lines included
   (spec §8); a cell that sets anything is its own, with no lines merged from above.
10. **What the server refuses.** _OWNER 2026-10-09: CHANGED — the server also refuses a period line
    whose period's menus (customer and staff-only) include none of the row's products, checked
    when the line is saved; a later menu change does not invalidate existing lines._ An unknown
    period: `route.subject_not_found { subject: "period", id }` (404, the code an unknown category
    or product already gets, `routes.ts:108`, N). A period of another department on a zone's cell,
    a period named twice, or a period whose menus hold none of the row's products:
    `route.period_invalid { periodId, reason: "other_department" | "repeated" | "not_offered" }`
    (409; sibling `route.station_inactive`, `routes.ts:109`, N; the reason is decision 30, which
    lines are checked is decision 29). "The row's products" are the active products the row
    covers, variants by their parent's id: a product row's product, a category row's products in
    that category and its subcategories, the No category row's products with no category, and All
    categories' every product; the period's products are decision 11's `productIds`, from the same
    reader. A period line naming a switched-off or unknown station: `route.station_inactive`, as
    the cell's own station is checked (`routing-store.ts:143-158`, N). The default cell's address
    is already refused before anything else (`management.request_invalid { field: "address" }`,
    `routing-store.ts:103-104`, N), and stays so with periods; period choices on a cell being
    cleared: `management.request_invalid { field: "periods" }` (400, as the route's other malformed
    fields). The configuration import refuses the same rows except the menu check (Task A3,
    decision 31). A zone moved to another department (`configureZone`, `operations.ts:434-470`, N)
    loses its cells' period rows for the old department's periods in the same transaction (Task
    A5).
11. **What a period offers.** _OWNER 2026-10-09: stands._ The routing read (`routingModel`,
    `routing-store.ts:838`, N) gains `periods: { id, departmentId, departmentName, name, colour,
    productIds }[]`, `productIds` being the products reachable from the period's customer menu and
    staff-only menus (`reachableProducts`, `packages/catalogue/src/section-graph.ts:175`, N, from
    each menu's root), variants by their parent's id as routing does
    (`ProductFacts.routedProductId`, `routing.ts:78-82`, N). The editor offers a period when any
    product the row covers is in its `productIds`; the server's check (decision 10) reads the same
    reader.
12. **Deleting a period that a cell names warns first.** _OWNER 2026-10-09: stands._ Slice 1
    refuses deleting a period that any day still places (`menu_period.in_use`,
    `menu-timetable.ts:698`, N). A period that passes that check but is named by routing cells is
    deleted with a warning: the Periods tab's delete dialog (the `wt-dialog` at
    `opening-hours-screen.ts:812-845`, N; `deletePeriod :371-400`, which shows the `in_use`
    refusal after the request) lists the cells by row and column ("Cocktails · Every zone") and
    says their choices for this period go; confirming deletes the period, and the cells' rows for
    it go by cascade. The list comes from a read added to the opening hours model per period
    (`routingUses: { rowLabel, zoneName }[]`). Override: refuse the delete until the cells drop
    it.
13. **The tester goes in Part A.** _OWNER 2026-10-09: CHANGED — remove the "Where is this made?"
    tester in Part A, not kept until Part B, so it never needs to name the period._ The whole of
    old Task B4 moves here: the tester, its route and its "W…" label (Task A3b for the screen, A3c
    for the server), and the extras note spec §9.3 moves into the grid (Task A3d, decision 33). It
    goes before the period work (Task A4a), so `explainRoute` is never taught about periods. What
    goes with it is decision 32. Nothing of it is left for Part B.
14. **The cell becomes a button that opens its editor.** _OWNER 2026-10-09: stands (the cell is a
    button opening an editor; an inherited cell can be pinned)._ Spec §8: "Clicking a cell opens
    its editor"; it replaces the inline combobox (`routing-grid.ts:361-378`, N). The button shows
    the station, inherited choices in italics as today, the period line beneath it, and the extras
    note (Task A3d) where the cell has one. The editor is a `wt-modal`: one line per target (a
    `wt-combobox multiple` of periods, grouped by department in an Every zone column, and a station
    `wt-combobox`), a Remove per line, "Any other time" with its station `wt-combobox`, "+
    Different station during some periods", Clear (for a stored cell), Cancel and Save. Save runs
    the existing preview (`#previewDialog`, `prep-stations-screen.ts:3216-3278`, N) and writes only
    once confirmed, as a combobox choice does today; the preview's moves say "during Lunch" when
    `periodIds` is set. With no arrow beside the name, the "Downstairs bar" text no longer meets
    one. **Its starting state:** a stored cell opens with its own choice and lines and its Save
    quiet until the draft changes; an inherited cell opens with the inherited choice and lines as
    its draft, marked "from Every zone" (or the row above), and with Save available at once
    (`{ savableAtOpen: true }`), so a person can still pin the inherited choice as the cell's own,
    as choosing it in today's combobox does. **An inherited draft keeps only what a pinned cell
    here could hold** (added 2026-10-09 with decision 29, not yet answered): of the inherited
    lines, the draft keeps the periods a cell at this address may store — in a zone column only
    its department's periods, and only periods whose `productIds` meet the row's products — and
    leaves out the rest, so pinning never sends a line the person did not add and the server would
    refuse. Three cases this covers: a Terrace cell inheriting Every zone's Lunch lines for two
    departments keeps only the Terrace department's; an inherited line whose period's menus later
    dropped the row's products is left out; a product row inheriting its category's Lunch line,
    where Lunch offers that category but not this product, leaves it out. One line under the lines
    says which inherited periods were left out and why ("Not copied: Lunch (Bar) — another
    department's; Brunch — offers none of these products"). The grid keeps showing the inherited
    lines until the cell is pinned.
15. **The period line's words.** _OWNER 2026-10-09: stands._ One or two periods: their names
    joined by ", " ("Lunch, Afternoon: Downstairs bar"). Three or more: "first–last" when the line
    holds every period between them in the department's period order ("Breakfast–Afternoon:
    Downstairs bar"), else the first name and a count ("Breakfast +3: Downstairs bar").
    `menu_periods` has no order column (`schema/menus.ts:21-47`, N), so the order is each period's
    earliest start in the normal week (Monday first, from the changeover — `weekdayOf` numbers
    Sunday 0, `hours-rules.ts:55-57`, N, so the sort moves Sunday last), a period placed nowhere
    last, the name breaking ties; the routing model sends `periods` in that order. Several lines:
    one line each. The full text is the button's accessible name.
16. **The page's tabs.** _OWNER 2026-10-09: stands._ Part A: Stations, Routing, Watchers, Settings
    — the Tickets tab goes, its printers and screens columns move to Stations, and "Show the rest
    of the order" moves from Settings to the station editor (spec §9.3). The Watchers tab stays
    until slice 5 Part B, which removes it. An old `view=tickets` address opens Stations, as an
    unknown view does (`prep-stations-screen.ts:288-301`, N). Part B: the Settings tab loses the
    fallback column.
17. **The tab row at phone width.** _OWNER 2026-10-09: stands (the shared `wt-tabs` fades on
    overflow, on every screen)._ Each header action shows only on its own tab ("New station" on
    Stations, "New watcher" on Watchers). When the tab strip is wider than the row, `wt-tabs` fades
    its cut end (a mask on the strip's scrolling side, set from its scroll position), so a person
    sees that it scrolls. Every tabbed screen gains the fade when, and only when, its tabs
    overflow.
18. **The routing grid at phone width.** _OWNER 2026-10-09: stands._ Under the grid's existing
    40rem container query (`routing-grid.ts:75-79`, N) the row-label column is
    `calc(var(--wt-space-6) * 3)` (96 px) and a zone column `calc(var(--wt-space-6) * 3.25)`
    (104 px), so at a 390 px viewport the labels and two zone columns (Every zone and one zone) are
    wholly visible without scrolling; row labels wrap. Above 40rem nothing changes.
19. **The station editor.** _OWNER 2026-10-09: stands._ "Edit" replaces "Rename" in the ⋮ menu and
    sets the name, the printers and "Show the rest of the order" (spec §9.3), in one request:
    `PATCH /management-api/stations/:id` gains `printerIds`, applied with `replaceStationPrinters`
    (`station-printers.ts:64`, N) in the same transaction as the rest of the patch (CLAUDE.md §3:
    one transaction per request). **Permissions:** the PATCH needs `venue.configure`
    (`withVenueAuth`, `management-api.ts:421-430`, used at `:2082`, N), while setting a station's
    printers needs `printer.manage` (`print-api.ts:101`, `gated :402-413`, N); a PATCH carrying
    `printerIds` checks both, in the same transaction, and is refused `authorization.not_permitted`
    without `printer.manage` (nothing written). The editor shows Printers as a read-out to a person
    without `printer.manage`, and sends no `printerIds`. The old `PUT
    /management-api/stations/:id/printers` route stays (`print-api.ts:1288-1304`, N; Task A11c
    removes the dashboard client method only if `grep` finds no other caller). "New station" keeps
    its fields (name, order, timings) and gains the printers, under the same rule. The Stations
    tab's table gains "Printed on" and "Shown on" read-outs and has no live numbers (decision 20).
20. **The Stations tab shows no live kitchen numbers.** _OWNER 2026-10-09: CHANGED — remove the
    live kitchen numbers (Waiting, Preparing, Ready, Late, Oldest) from the Stations tab, as the
    spec says: Prep stations is configuration only; the live view is the kitchen screens and the
    till's pass board. Remove any server read that only that tab used, and say so in the pull
    request._ The five columns and their dish drill-down (`station-health-table.ts:142-158`,
    `#details :160-200`, N) go, and the table's rows come from the stations list instead of the
    health snapshot (today they come from the snapshot, `render :201-222`, N). The only caller of
    `GET /management-api/stations/health` (`management-api.ts:2002-2011`, N) is this tab
    (`readStationHealth`, `routing-client.ts:264-273`, N, called only at
    `prep-stations-screen.ts:848`, N), and the server reader behind it, `readStationHealth` with
    `stationHealthItemsQuery` (`apps/server/src/station-health.ts`), is called only by that route
    and by tests; so the route and the file go (Tasks A11b and A11d), and the pull request names
    the route as removed. The receipts are the `grep` commands in Task A11d. The printer-down and
    dark-screen notes beside a station's name go too (decision 34); what a supervisor sees is
    decision 35. Part B still replaces the Today column with a short note beside the name (its
    state is then closed for today or switched off). Override: none — the owner chose.
21. **What the worked-out times are.** _OWNER 2026-10-09: stands._ For a date, a station's times
    are the union, over active departments, of the department's ranges whose period offers at
    least one product that the routing sends to this station in at least one of the department's
    active zones, during that period — each zone's share cut by that zone's closed times that date
    (slice 2). Dishes only: an extra makes no station "open" (extras are not on menus). A period
    kept open today (slice 3) is not shown: the view is for planning. The default station shows no
    grid, only "Always open: the default station takes what no other station makes." A switched-off
    station shows "Switched off". The times are a read-out: routing never asks them (decision 22).
22. **Routing without hours.** _OWNER 2026-10-09: CHANGED — the routing default stands; closing
    a station that still has open dishes always warns and asks (the last part of this decision)._
    A station's status is `switched_off`, `default`, `closed_by_hand` or `open`. A station closed for
    today sends its NEW work where "Close for today" said (slice 3); a closed row with no
    destination (stored before slice 3, or by a test fixture) and a switched-off station send it to
    the default station; a walk continues past a destination that is itself closed or switched
    off, as slice 3's does, and ends at the default station. Only a venue whose default station is
    switched off or missing still reaches `noReplacement` (`selectRoutingCell` returns the default
    only while it is active, `routing.ts:185-190`, N), so `station.no_replacement` and the till's
    dead-end prompt stay. A dish routed to a station whose worked-out times are over (a held Lunch
    dish sent at 16:00) goes there anyway: the spec's "open whenever something it makes can be
    ordered" describes when work arrives, not a closure. **Closing with open dishes (owner
    2026-10-09):** closing a station that still has open dishes — by "Close for today" on the till
    or kitchen display (slice 3's station today dialog) or by Disable on the dashboard — always
    warns and asks what to do with them: send them to a station the person picks, or leave them
    there to finish (as slice 5's answer "b" has a switched-off station keep showing its waiting
    dishes until done). After closing, NEW dishes go to the chosen destination, else the default
    station (the owner's words). The person is asked once, in the closing dialog itself, not in a
    second dialog afterwards (decision 37 says how the one dialog holds both choices).
23. **"Open for today" without hours.** _OWNER 2026-10-09: CHANGED — the default stands for a
    station with no open dishes; with open dishes, closing asks first (decision 22)._ Slice 3's
    `openStationForToday` deletes today's row when the station would be open without it and
    stores "open" otherwise (slice 3 decision 11); with hours gone a station is always open
    without it, so it always deletes. A stored `open: true` row reads as no
    row. The `opened_by_hand` reason goes. "Close for today" on a station with no open dishes
    behaves as slice 3 built it; with open dishes it first asks as decision 22 says.
24. **Disabling a station no longer asks for a fallback.** _OWNER 2026-10-09: CHANGED — with open
    dishes it asks as decision 22 says._ Today Disable opens the fallback choice
    (`#openFallback(id, "switch_off")`, `prep-stations-screen.ts:1238`, N). In Part B, for a
    station with no open dishes it confirms: "Its dishes go to {default}, the default station,
    until you change the routing", listing the routing cells that name it. For a station with open
    dishes the same dialog also asks what happens to them (send to a station the person picks, or
    leave them to finish), once; NEW dishes then go to the default station (decision 37).
    Override: make Disable clear or rewrite those cells.
25. **Where a station's times are seen.** _OWNER 2026-10-09: stands._ The Opening hours picker
    gains a "Prep stations" group after the departments (slice 2's picker), one entry per active
    station, and the URL a `station` key (`opening-hours?view=week&station=<id>`). A station's view
    is All departments' layout (slice 2: one narrow column per department per day), showing only
    the counted ranges in their period's colours, in the normal week or a real week. The Stations
    tab's row links "When it gets orders" there.
26. **The Station hours screen goes whole.** _OWNER 2026-10-09: stands._ Its dashboard entry
    (`hours`, `dashboard/index.ts:53-70`, S1), its navigation key
    (`apps/dashboard/src/navigation.ts:10`, S1), the client and the views only it uses. An old
    `/manage/hours` link lands where any unknown dashboard address lands; no redirect (pre-live).
    Its API routes go with the station-hours writers.
27. **The demo shows a period choice.** _OWNER 2026-10-09: stands._ The demo seed's Upstairs bar
    hours and its fallback to the Downstairs bar (`seed-floor.ts:154-161`, S1) go; in their place
    one cell of the demo's drinks rows gets a period line for the demo's evening period → Upstairs
    bar, with Downstairs bar at any other time — the spec's §8 example the other way round. If the
    demo has no evening period at that time, the task says so and adds no line.
28. **Error codes.** _OWNER 2026-10-09: stands; decision 10's change adds a reason, not a code._
    (Pre-live, named for the concept — CLAUDE.md §3; siblings in
    `packages/venue-service/src/errors.ts`, N.)
    - New: `route.period_invalid { periodId, reason: "other_department" | "repeated" |
      "not_offered" }` (decisions 10 and 30), 409, registered beside `route.station_inactive`
      (`errors.ts:93`, N) with its status beside `routes.ts:109` (N). Reused:
      `route.subject_not_found` with `subject: "period"` (404) and `route.station_inactive`
      (venue-service's); `authorization.not_permitted` (identity's,
      `packages/identity/src/errors.ts:71`, N); `printer.makes_and_watches` (the server's, newly
      mapped in `management-api.ts`'s `STATUS`, `:251`, N, Task A10).
    - Retired in Part B: `station.fallback_loop` (`errors.ts:99`, N) and every code only station
      hours throw (Task B6 lists them with `grep`), each removed from every copy in the tree in one
      change (`apps/dashboard/src/i18n/codes.ts` and any till copy); `station.always_open` stays
      (slice 3 reuses it).
    None is a recorded incident, so none needs alert wording.
29. **The menu check exempts only what the cell already stores, unchanged.** _Added 2026-10-09,
    not yet answered._ The owner's rule is that a line is checked when it is saved and a later
    menu change does not invalidate it. A cell's routing request sends all its lines, so a stale
    line would otherwise block every later edit of that cell. So the server checks every (period,
    target) pair in the request except one the cell already stores with the same target: that
    pair is kept unchecked. A stored period whose station changes is a new choice and is checked.
    An inherited line is not stored on the cell, so pinning an inherited cell checks every line it
    sends; decision 14 keeps the editor from sending one that would fail. The editor offers, in
    each line, the periods whose `productIds` meet the row's products, plus a period the cell
    already stores in the line that holds its stored target; if that line's station changes, the
    server's `not_offered` refusal shows under the line. Override: check every period in the
    request, so a stale line must be removed before the cell can be saved.
    _Owner override 2026-10-09: save, but flag it — the check stays as above, and a stored line
    whose period's menus no longer offer the row is marked "Not on … menus"; built in [A455](2026-10-10-a455-prep-stations-owner-answers.md)._
30. **The new refusal is a reason, not a new code.** _Added 2026-10-09, not yet answered._
    `route.period_invalid` gains `reason: "not_offered"`, beside its other two, as the house's
    siblings carry a `reason` union under one code (`station.destination_invalid`,
    `errors.ts:94-98`; `device_profile.access_invalid`, `:101-118`, N). It names `periodId`, so the
    editor puts it under that period's line. Override: a separate code, `route.period_not_offered
    { periodId }`.
    _Owner 2026-10-09: the default stands._
31. **The configuration import does not apply the menu check.** _Added 2026-10-09, not yet
    answered._ An export can hold a line whose period's menus changed after it was saved, which
    decision 29 keeps valid, so refusing it on import would make a good export unimportable. The
    import still refuses the rows decision 10 lists otherwise (Task A3). Override: refuse such a
    row on import as well.
    _Owner 2026-10-09: the default stands; an imported line its period's menus no longer offer
    shows decision 29's mark, built in [A455](2026-10-10-a455-prep-stations-owner-answers.md)._
32. **What goes with the tester.** _Added 2026-10-09, not yet answered._ The route `GET
    /management-api/venue-service/routing/explain` (`routes.ts:442-478`, N) answers 404;
    `explainRoute` and `ExplainWhen` (`routing-store.ts:332-426`, N), `RouteExplanation` and
    `ExtraExplanation` (`routing-types.ts:63-79`, N, re-exported at `routing.ts:17`),
    `dashboard/routing-explanation.ts` and its test (only the screen imports it,
    `prep-stations-screen.ts:49-54`, N), the client's `explain` (`routing-client.ts:197-211`, N),
    the screen's tester state, `#explain`, `#testNames` and `#tester` (`:257-267`, `:1416-1656`, N),
    its `.tester-when` styles (`:169-190`, N), its `test` URL key (`:288-305`, `:766-770`, `:889`,
    N) and `navigation.ts`'s `test` key (`apps/dashboard/src/navigation.ts:9`, N), the
    `prep.test_*` strings, and the view's `testProducts` list (`PrepStationsView.testProducts`,
    `routing-client.ts:67`, filled at `:139` and `:173`, N), which only the tester reads
    (`prep-stations-screen.ts:1465-1513`, N). `chooseExtraMakerBeside` stays: the preview uses it
    (`routing-store.ts:567`, N). A test in `routing-store.test.ts` that uses `explainRoute` only to
    read where something is made is moved to `resolveMakers`/`resolveExtraMakers`, or to the pure
    `chooseMaker`/`chooseExtraMakerBeside` where it checks fallback steps, with the same
    expectations — unless an existing case in `routing.test.ts` or `station-times.test.ts`
    already pins the same behaviour, in which case it is deleted and the pin is cited. A case
    whose subject is the tester itself (its `when` parsing, a time the clock skips, the shape of
    its answer, its sentences) is deleted. An old tester link
    (`/manage/prep-stations/view/routing/test/<id>`) opens the tab its `view` names, else Stations:
    the URL controller ignores a segment its config does not name (`packages/ui/src/url-state.ts:58-75`,
    N) and drops it at its next write. Override: keep the route for a later tool.
    _Owner 2026-10-09: nothing to build — no old tester links exist ([A455](2026-10-10-a455-prep-stations-owner-answers.md))._
33. **The extras note belongs to the cell's plain choice.** _Added 2026-10-09, not yet answered._
    Spec §9.3: an empty cell (nothing set at it or above it, so it falls through to the default
    station) shows "{station} (default) — as an extra, follows its dish", and a No preparation
    cell (its own or inherited) shows "No preparation — as an extra, follows its dish"; a cell that
    names a station, even the default one, shows nothing (owner, A371). The note reads the cell's
    "Any other time" choice only: a period line naming No preparation already says so in its own
    words and gets no second note. The All categories × Every zone cell, which sets the default
    station, shows the default note too: what it decides is `decidedBy` kind `default`, which
    `chooseExtraMaker` turns into "follows the dish" (`routing.ts:340-341`, N), and it is where
    every empty cell falls through to. It is built with the tester's removal (Task A3d), so no
    commit leaves the grid without what only the tester showed. Override: also note a No
    preparation period line; leave the default cell without the note.
    _Owner override 2026-10-09: no note; the note is removed in [A455](2026-10-10-a455-prep-stations-owner-answers.md)._
34. **The printer-down and dark-screen notes leave the Stations tab too.** _Added 2026-10-09, not
    yet answered._ They come from the same live read (`#name`, `station-health-table.ts:114-130`,
    N) and are live state, which spec §9 keeps off these pages. The dashboard still raises both as
    alerts for a person with `venue_service.manage` (`stationOutputAlertSource`,
    `apps/server/src/alert-sources.ts:322-370`, N), and those alerts still link to Prep stations
    (`:353`, `:365`, N), where the station's printers can be changed; the till and the kitchen
    display show a station's down printers (`till-api.ts:1841`, `device-api.ts:425`, N).
    Override: keep the notes, read from the existing `GET /management-api/stations/outputs-down`
    (`management-api.ts:2013-2024`, N), which the screen's client already wraps
    (`listOutputsDown`, `routing-client.ts:274-278`, N) but nothing calls. This slice does not
    remove that route or method — the owner asked for the read only the Stations tab used, and
    this one it never used; Task A13 records them as a backlog entry instead.
    _Owner 2026-10-09: the default stands._
35. **A supervisor still gets the page, read-only.** _Added 2026-10-09, not yet answered._ The
    page is offered to `venue.view` read-only (`readPermission: "venue.view"`,
    `packages/venue-service/src/dashboard/index.ts:38-39`, N), as Opening hours and the Station
    hours screen are (`:80`, `:60`, N); a supervisor holds `venue.view` and not
    `venue_service.manage` (`packages/identity/src/permissions.ts:45-54`, N;
    `packages/venue-service/src/permissions.ts:6`, N, grants it from manager). Today that person
    sees only the Stations tab, whose rows and numbers come from the health read
    (`prep-stations-screen.ts:288-297`, `:3436-3446`, N). After this slice they see the same tab
    with each station's name, its Default and Disabled marks and the Today column — no ⋮ menus,
    no numbers, and no Printed on or Shown on, because their read-only load carries no printers or
    devices (`routing-client.ts:116-145`, N) and the printers and devices reads need
    `printer.manage` and `device.manage` (`print-api.ts:898-901`, `device-api.ts:106`, `:164-170`,
    N). This keeps the existing permission pattern and adds no read. Override: stop offering the
    page to `venue.view` (remove its `readPermission`).
    _Owner override 2026-10-09: hide the page — it is offered only with `venue_service.manage`, and
    the read-only overview route is gone; built in [A455](2026-10-10-a455-prep-stations-owner-answers.md)._
36. **The table is renamed for what it shows.** _Added 2026-10-09, not yet answered._ With no
    health in it, `prep-station-health-table` in `dashboard/station-health-table.ts` would misname
    itself, so it becomes `prep-station-table` in `dashboard/station-table.ts` (`git mv`, with its
    tests), as Task A11c's first, mechanical commit; selectors in other suites and the
    `healthRow` helper (`prep-stations-screen.test.ts:1260`, N) follow in the same commit, which
    changes no assertion. Override: keep the name.
    _Owner 2026-10-09: the default stands._
37. **Closing with open dishes asks once.** _Added 2026-10-09 to carry out the owner's change to
    decisions 22–24, not yet answered; Part B designs it after re-grounding._ "Close for today" on
    a station with open dishes keeps one dialog: the person picks one station (the default
    first, as slice 3 offers) and says whether the open dishes go there too or stay to finish;
    NEW dishes after closing go to the picked station (the owner's "chosen destination"), else
    the default station. Disable on a station with open dishes asks, in its one confirmation,
    whether the open dishes go to a station the person picks or stay to finish; NEW dishes go to
    the default station, because a switched-off station stores no destination (decision 22).
    Override: two separate questions, one for open dishes and one for new dishes.
    _Owner 2026-10-09: the default stands._

## Where the code differs from what the spec assumes

- §2 says "each station's ticket prints on each of its printers separately". True, and no test
  pins the two-tickets case for two stations firing in one send onto one printer: the only
  one-printer-on-two-stations setups are mapping tests (`station-printers.test.ts:173-187`,
  `print-api.printer-wiring.test.ts:887`, N) and `kitchen-print.watchers.test.ts:709` (N), where
  only one of the two stations fires. So Task A1 changes no existing assertion about it.
- §8 says the rule against making and watching goes; decision 4 keeps it until slice 5 Part B.
- §8 says "the default station is always open". Today a venue can switch its default station off
  (`deactivateStation`, `apps/server/src/kitchen.ts:256-269`, N, has no default check), and the
  routing then returns no default (`routing.ts:185-190`, N). Decision 22 keeps today's answer for
  that case.
- §8 says the periods offered are "limited to those whose menus include the row's products". The
  editor limits its offer and, since the owner's answer to decision 10, the server refuses a newly
  added period that fails it; a period already stored on the cell is not re-checked (decision 29).
- §9 says nothing on these pages shows live state. Besides the live numbers (decision 20) and the
  printer-down notes (decision 34), the Stations tab's Today column shows today's state until Part
  B turns it into a note beside the name.
- §9.3 says "Editing a station sets its name, its printers and 'Show the rest of the order'".
  Today there is no station editor: Rename (name only), the Tickets tab (printers) and the Settings
  tab ("Show the rest of the order") each edit one (`prep-stations-screen.ts:1281-1337`,
  `:1864-1957`, `:2697-2701`, N).
- §9.3's Stations tab: "the printers its tickets print on". A station's printers are stored in
  `station_printers` (`packages/db/src/schema/station-printers.ts:10`, N), a core table, not
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
  map that answers them (`routes.ts` `STATUS`, `:81`, N), and wording in English and Spanish
  wherever a screen shows them (`dashboard/strings.ts` or `apps/dashboard/src/i18n/codes.ts`).
- venue-service functions take `cfg: VenueScope`; multi-table writes take one `tx: Transaction`;
  queries on one transaction are awaited in turn. **Departments' periods are read in turn, once per
  routing call**, never per dish (CLAUDE.md §3: resolve shared data once before a line loop). **A
  period's products are read once per write**, not per line.
- **Kitchen printing changes keep every existing printing test passing unedited** except those
  listed under "Behaviour this slice removes". A printing change is checked through the real
  planner and the outbox, never a stubbed printer list.
- The dashboard's routing live query (`dashboard/live-queries.ts:17-41`, N) gains
  `routing_cell_periods` and the tables the period reader reads (Part A) and loses the dropped
  tables (Part B); its `health` list (`:2-15`, N) goes in Task A11b. A misspelled name breaks the
  whole tab's stream, so run `scripts/live-subscriptions.test.ts`.
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

**Part A** (lines N)

- The "Where is this made?" tester on the Routing tab, its route and its URL key (decisions 13
  and 32): the tester cases in `prep-stations-screen.test.ts` (find them with
  `grep -n "route-tester\|testProduct\|testWhen\|explain" packages/venue-service/src/dashboard/prep-stations-screen.test.ts`),
  `prep-stations-screen.a11y.test.ts:540` ("timed routing tester"), `routing-explanation.test.ts`
  whole, `routing-client.test.ts:175-210` and `:483-495` (the `explain` paths),
  `apps/dashboard/src/navigation.test.ts:18` ("preserves the Prep stations tab and tester when the
  dashboard rewrites its destination"), `apps/dashboard/src/dashboard-app.test.ts:3885`
  ("preserves a prep station tester product when the dashboard restores the screen"), and the
  view's `testProducts` list: `routing-client.test.ts:106` (its `testProducts` half: "keeps
  top-level product names, and offers active variants only to the tester") and `:144` ("offers an
  active product to the tester when it has no variants"), plus the `testProducts` fixture key in
  the suites that set it (`grep -rn "testProducts" packages/venue-service/src/dashboard --include='*.test.ts'`;
  a fixture edit, not an assertion). Task A3b.
- The explain route and `explainRoute`: `routes.test.ts`'s explain cases (`:2241-2467`, the
  describe "routing explanation route" at `:2241`, N), and the `explainRoute` cases in `routing-store.test.ts` (`grep -n "explainRoute" packages/venue-service/src/routing-store.test.ts`),
  each moved to the routing reads with the same expectations or, where its subject is the tester,
  deleted and listed (decision 32). Task A3c.
- A station's printers edited in the Tickets tab's "Printed on" cell, and the Tickets tab itself
  (`prep-stations-screen.ts:1958-2021`, `#printerCell :1864-1957`; `prep-stations-screen.printers-unsaved.test.ts`
  whole, and the Tickets cases in `prep-stations-screen.test.ts` and `.a11y.test.ts`). Task A11c.
- "Show the rest of the order" in the Settings tab (the `rest` column `:2697-2701` and
  `#settingsCell`'s `rest` branches `:2473-2595`; its cases in `prep-stations-screen.settings.test.ts`
  and `.settings-unsaved.test.ts`). Task A11c.
- Rename in the station ⋮ menu (`:1204-1218`, `#renameDialog :1281-1337`). Task A11a.
- The live kitchen numbers, their dish drill-down and the printer-down and dark-screen notes on the
  Stations tab (decisions 20 and 34; `station-health-table.ts:114-200`). Every check that reads
  them, found with
  `grep -n "healthRow\|part=\"problem\"\|has ever checked in\|prep-station-health-table\|readStationHealth\|StationHealth" packages/venue-service/src/dashboard/*.test.ts`
  (on N; a `healthRow` hit that reads only the Today text is not one of them and keeps its
  assertion). Task A11b:
  - `station-health-table.test.ts` and `.a11y.test.ts`: their number, drill-down and problem-note
    cases.
  - `prep-stations-screen.test.ts`: `:492` "Routing handover renders in $locale $theme at $width
    px" (its Stations half, the problem-note checks `:567-580`; its Routing half stays);
    `:1201` "keeps station status and output problems in Stations instead of repeating them in
    Routing" (the `Printer Epson` and `has ever checked in` checks `:1226-1227`; the Routing and
    "Closed now" checks stay); `:1231` "uses the health snapshot for output problems without a
    second management read"; `:2029` "switches an inactive station on and keeps its dark-screen
    warning in its Stations row" (the warning checks `:2047-2048`; the switch-on checks stay);
    `:2055` "shows each output warning only on its station"; `:2087` "refreshes output warnings
    every fifteen seconds and clears the timer when removed"; `:2434` "subscribes dish health to
    ticket changes…"; `:2459` "refreshes elapsed health…"; `:2495` "a health read failure
    stays…"; `:2526` "a health snapshot ahead of routing metadata…"; `:4585` "keeps supervisor
    numbers and drilldowns live…".
  - `prep-stations-screen.a11y.test.ts:468-475` (the `warnings` state's two note checks).
  - `prep-stations-overview.a11y.test.ts` (the read-only screen's axe case, which waits for and
    presses a number, `:129-145`).
  - `routing-client.test.ts:518-522` (`readStationHealth`); `live-queries.test.ts:4-5` (the
    `health` list pin, "declares the health sources…").
  - Mock-only edits (a `readStationHealth` stub or a `StationHealth*` type in a fixture, no
    assertion): `routing-grid.unsaved.test.ts:118`, `watcher-form.unsaved.test.ts:120`,
    `prep-stations-screen.settings.test.ts:84`, `.settings-unsaved.test.ts:127`,
    `.printers-unsaved.test.ts:144`, `.unsaved.test.ts:104`, `station-action.unsaved.test.ts:121`,
    `prep-stations-screen.a11y.test.ts:94`, `:382`, `:554`, and the stubs in
    `prep-stations-screen.test.ts` the grep lists.
  - The `prep-station-health-table` selectors and the `healthRow` helper move to the new name in
    Task A11c's mechanical rename commit (decision 36): `station-action.unsaved.test.ts:186`,
    `prep-stations-screen.unsaved.test.ts:145`, `prep-stations-screen.test.ts:1260`, `:2431`,
    `:4622`, `:4855`, `prep-stations-screen.a11y.test.ts:499`, and whichever selectors in
    `prep-stations-overview.a11y.test.ts` (`:135`, `:140` on N) and the `warnings` state
    (`prep-stations-screen.a11y.test.ts:469`) Task A11b's rewrite of those cases keeps.
- `GET /management-api/stations/health` and its reader: `apps/server/src/station-health.test.ts`
  whole, and the `"health"` row of "refuses the %s read with a named configuration error"
  (`kitchen-timing-consumers.test.ts:235`, `:248-249`). Task A11d.
- The routing cell's inline combobox (`routing-grid.ts:361-378`, `#defaultCell :392-426`; its
  cases in `routing-grid.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`). Task A8b.
- The row-label column's width at phone width: `routing-grid.test.ts:751` ("at phone width the row
  label column is capped…", at most 140) narrows to 96. Task A9.
- The header actions on every tab (`prep-stations-screen.ts:3410-3426`) and
  "keeps half of a $width px tab row for the tabs…" (`prep-stations-screen.test.ts:2715-2746`,
  its two-actions check at `:2741`), which keeps its 50% cap but sees one action per tab. Task A12.

**Part B** (lines M or S1; re-ground)

- Station hours, special-date station cells, fallbacks, and every status that reads them: the
  `in_hours`, `no_hours`, `out_of_hours`, `time_not_applied` and `opened_by_hand` reasons; a
  closed or switched-off station following its configured fallback; `station.fallback_loop`;
  `assertDemotedStationHours` refusing a new default. Tasks B1a–B7.
- **A switched-off station with no fallback, or two closed stations falling back to each other,
  being a dead end** (`noReplacement`, `station.no_replacement`): under decision 22 their work goes
  to the default station. Pinned at least at `apps/server/src/catalogue-api.test.ts:1508-1520` and
  `working-order.test.ts:3255-3280` (M); Task B1a's grep finds the rest. Tasks B1a–B1b.
- **Closing a station without asking about its open dishes** (decisions 22–24): slice 3's
  station today dialog closes at once (`apps/till/src/widgets/station-today-dialog.ts` and its
  tests, `apps/server/src/till-api.station-today.test.ts`), and Disable asks for a fallback. The
  pull request names each slice 3 check that changes. Tasks B2–B3.
- The Prep stations Today column, its status sentences and the fallback field in the Settings tab
  and the Disable dialog. Task B3.
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
4. **Periods are department-scoped and must offer the row.** A zone cell refuses another
   department's period (`route.period_invalid`, `other_department`); an Every zone cell holding two
   departments' Lunches applies each in its own department; a Lunch line on Cocktails is refused
   (`not_offered`) when no Lunch menu, customer or staff-only, holds a cocktail; after a Lunch menu
   drops its cocktails, re-saving that cell with its stored Lunch line and a new plain station
   succeeds (decision 29) (Task A5).
5. **Deleting a period takes its routing lines with it, after a warning** (Task A6).
6. **The tester is gone and nothing it alone showed is lost.** The explain route answers 404; an
   old `/test/<id>` link opens a tab without error; an empty cell and a No preparation cell say how
   an extra is made, a cell naming the default station does not; every routing behaviour an
   `explainRoute` case pinned is still pinned through the routing reads (Tasks A3b–A3d).
   _(2026-10-09: no cell says how an extra is made — decision 33, A455.)_
7. **The Stations tab is configuration only.** No Waiting, Preparing, Ready, Late or Oldest, no
   drill-down and no printer-down note; `GET /management-api/stations/health` answers 404; a
   supervisor still opens Prep stations and sees the station list read-only, and a manager's
   station reorder still works with rows from the stations list (Tasks A11b, A11d).
   _(2026-10-09: a supervisor is not offered Prep stations — decision 35, A455.)_
8. **Without hours, nothing is dropped.** In Part B: a station closed for today with no recorded
   destination sends work to the default station; a switched-off station's work goes to the
   default station; a held Lunch dish sent after its station's worked-out times goes to that
   station; with the default switched off, the till still asks (`station.no_replacement`); closing
   or disabling a station with open dishes asks what to do with them (Tasks B1a–B3).
9. **The worked-out times match the routing.** A station that makes only Cocktails, routed to it
   during Lunch only, shows Lunch's ranges and nothing else; on a named day with own hours it shows
   that day's Lunch; with the Terrace closed at 15:00 and Cocktails routed there only on the
   Terrace, it shows Lunch up to 15:00 (Task B8).

---

## Part A — combined tickets, period choices, the Stations page (first pull request)

### Task A1: Kitchen tickets group by printer

**Files:**
- Modify: `apps/server/src/kitchen-print.ts` (`KitchenRoute :414`, `routeKitchenTickets :445-455`,
  `planKitchenTickets :465-603` — the station-ticket part, not the watcher block `:605-688`; the
  rest-of-order filter `:539-542`, `:571`, N), `apps/server/src/kitchen-ticket.ts`
  (`KitchenTicket :46-68`, `formatKitchenTicket :178-225`, N)
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
all, and `linkKitchenJob` already writes one link per station (`:754-764`, N).

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
- Modify: `apps/server/src/kitchen-print.ts` (`reprintOrderTickets :1458-1487`,
  `readReprintTargets :1419-1444`, `readPrintProblems :1519`, `readUncoveredLinks :1588`, N)
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
  (beside `routing_cells`, `:28`, N) and its test, `configuration-transfer.ts` (the table list
  beside `routing_cells`, `:639`; `validateRoutingConfiguration :483`, N) and its test,
  `migrations.test.ts` (`TABLES`, beside `:47`, N), `scripts/schema-constraints.test.ts` (routing
  keys beside `:185-189`, unique keys beside `:364-370`, checks beside `:579-582`, N),
  `apps/server/src/testing/clear-provision-fixture.ts` (before `routing_cells`, `:23`, N)
- Create: generated `packages/venue-service/drizzle/00NN_*.sql`, snapshot, journal entry

**Interfaces — produces:** `routingCellPeriods` (table `routing_cell_periods`): `id` (primary key,
`newId`), `cellId` not null → `routing_cells.id` **on delete cascade**
(`routing_cell_periods_cell_fk`), `periodId` and `departmentId` not null, composite foreign key
`(period_id, department_id)` → `menu_periods (id, department_id)` **on delete cascade**
(`routing_cell_periods_period_fk`, over `menu_periods_department_key`, `schema/menus.ts:43`, N —
the pattern of slice 1's `menu_slots_period_fk`, `:131-135`, N), `stationId` →
`kitchen_stations.id` (`routing_cell_periods_station_fk`), `noPreparation` boolean; check
`routing_cell_periods_target_ck` written as `routing_cells_target_ck` (`schema/routing.ts:62-65`,
N); unique `routing_cell_periods_cell_period_key (cell_id, period_id)`. Class `state`; the
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
  routing cases); the import's routing validator refuses a row whose cell is missing, a zone
  cell's row naming another department's period, and a row naming a station the export does not
  carry, and accepts a row whose period's menus hold none of the row's products (decision 31).
- [ ] **Step 4: Run** Step 1's test, the package's node project, the server package, and
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/module-graph-honesty.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/live-subscriptions.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`.
- [ ] **Step 5: Commit** — `feat(venue-service): period choices on routing cells (A366)`.

---

### Task A3b: The "Where is this made?" tester leaves the dashboard

**Files:**
- Modify: `packages/venue-service/src/dashboard/prep-stations-screen.ts` (tester state `:257-267`,
  the URL controller's `test` handling `:288-305`, `:766-770`, `:889`, `#explain :1416-1453`,
  `#testNames :1459-1469`, `#tester :1470-1656`, the `routing-explanation.js` import `:49-54`,
  `.tester-when` styles `:169-190`, the Routing panel's `${this.#tester()}` `:3452`, N),
  `dashboard/routing-client.ts` (`explain :197-211`; `PrepStationsView.testProducts :67`, filled at
  `:139` and `:173`, N), `dashboard/strings.ts` (`prep.test_*`), `apps/dashboard/src/navigation.ts`
  (`"prep-stations": { view, test }`, `:9`, N)
- Delete: `dashboard/routing-explanation.ts` and `routing-explanation.test.ts` (only the screen
  imports it: `grep -rn "routing-explanation" packages apps --include='*.ts'`)
- Test: `prep-stations-screen.test.ts`, `.a11y.test.ts` (`:540`), `routing-client.test.ts`
  (`:106`, `:144`, and the `explain` paths), `apps/dashboard/src/navigation.test.ts` (`:18`),
  `apps/dashboard/src/dashboard-app.test.ts` (`:3885`); fixture-only edits dropping the
  `testProducts` key in every suite `grep -rn "testProducts" packages/venue-service/src/dashboard --include='*.test.ts'`
  lists

**Behaviour:** decisions 13 and 32. The Routing tab shows the grid with no tester above it. An old
tester link opens the tab its `view` names, else Stations, and the `test` part is dropped at the
screen's next URL write.

- [ ] **Step 1: Changed test checks commit** for the tester's cases (listed under "Behaviour this
  slice removes", Part A): each is deleted and listed with `file:line`; `navigation.test.ts:18`
  keeps its tab check and drops the tester half; `dashboard-app.test.ts:3885` becomes "an old
  tester link opens the Routing tab" with the same restore steps; `routing-client.test.ts:106`
  keeps its top-level product names check and drops its `testProducts` half, and `:144` is
  deleted (its whole subject is the tester's list).
- [ ] **Step 2: Failing tests:** the Routing tab has no `[data-test="route-tester"]`;
  `/manage/prep-stations/view/routing/test/lager` opens Routing and the next tab change writes no
  `test` segment; `/manage/prep-stations/test/lager` opens Stations; axe on the Routing tab in both
  themes.
- [ ] **Step 3: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/prep-stations-screen src/dashboard/routing-client.test.ts`
  and `pnpm --filter @waitron/dashboard exec vitest run src/navigation.test.ts src/dashboard-app.test.ts`.
- [ ] **Step 4: Implement;** the venue-service node project; typecheck `@waitron/venue-service` and
  `@waitron/dashboard`; LOOK at Routing in EN and ES, both themes, 1280 and 390.
- [ ] **Step 5: Commit** — `feat(venue-service): the routing tester leaves Prep stations (A366)`.

---

### Task A3c: The tester's route and `explainRoute` go

**Files:**
- Modify: `packages/venue-service/src/routes.ts` (`GET /management-api/venue-service/routing/explain`
  `:442-478`, the `explainRoute`/`ExplainWhen` import `:58-59`, N), `routing-store.ts`
  (`ExplainWhen :332`, `explainRoute :334-426`, N, and any import only it used), `routing-types.ts`
  (`RouteExplanation`, `ExtraExplanation`, `:63-79`, N), `routing.ts` (the re-export `:17`, N),
  `index.ts` if it exports them
- Test: `routes.test.ts` (`:2241-2467`, N), `routing-store.test.ts`, `routing.test.ts` (cases
  moved there)

**Behaviour:** decision 32. The route answers 404; `chooseExtraMakerBeside` stays (the preview,
`routing-store.ts:567`, N).

- [ ] **Step 1: Changed test checks commit.** For each `explainRoute` case in
  `routing-store.test.ts` (`grep -n "explainRoute" packages/venue-service/src/routing-store.test.ts`):
  a case that reads where a dish or extra is made moves to `resolveMakers`/`resolveExtraMakers`
  (or `routingAt`) with the same expected station; a case that checks fallback steps moves to the
  pure `chooseMaker`/`chooseExtraMakerBeside` in `routing.test.ts` with the same steps; a case
  whose subject is the tester (its `when` parsing, `clockReadable`, `stations` list, an unknown
  product's refusal through the explain path, "refuses to preview a local time the clock skips on
  that date" `:2774`) is deleted. Before moving a case that checks only station hours (such as
  `:2170` "uses Friday hours and names the fallback, while now honors today's open" and `:2744`
  "previews a date and local time with its special hours…"), look for a case in
  `routing.test.ts` or `station-times.test.ts` that already pins the same behaviour; if one does,
  delete the case and cite that pin instead of moving it. The route's cases in `routes.test.ts`
  are deleted. Each is listed with `file:line`, before and after. If a case pins something no
  routing read exposes, STOP and report it.
- [ ] **Step 2: Failing test:** `GET /management-api/venue-service/routing/explain?productId=…`
  answers 404 (fails today: 200).
- [ ] **Step 3: Run; watch it fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/routes.test.ts`.
- [ ] **Step 4: Implement;** `grep -rn "explainRoute\|ExplainWhen\|RouteExplanation\|ExtraExplanation\|routing/explain" apps packages --include='*.ts'`
  finds nothing outside the moved tests; the venue-service node project, the server package;
  typecheck `@waitron/venue-service`, `@waitron/server`, `@waitron/dashboard`.
- [ ] **Step 5: Commit** — `feat(venue-service): the routing explain route goes (A366)`.

---

### Task A3d: Empty and No preparation cells say how extras are made

_(2026-10-09: removed by the owner's answer to decision 33, A455.)_

**Files:**
- Modify: `packages/venue-service/src/dashboard/routing-grid.ts` (the cell `:361-378`, N, and
  the inherited-choice lookup it already makes), `dashboard/strings.ts`
- Test: `routing-grid.test.ts`, `routing-grid.a11y.test.ts`

**Behaviour:** decision 33 and spec §9.3. A cell whose choice falls through to the default station
shows "{station} (default) — as an extra, follows its dish", and so does the All categories ×
Every zone cell, which sets the default; a cell whose choice, its own or inherited, is No
preparation shows "No preparation — as an extra, follows its dish"; a cell that names a station,
even the default one, shows nothing. The note is part of the cell's accessible
name. Task A8b keeps it inside the cell's button.

- [ ] Steps: failing tests (an empty Every zone cell carries the default note; the All
  categories × Every zone cell carries the default note; a zone cell that inherits No preparation
  carries the No preparation note; a cell naming the default station carries none; axe for the
  four in both themes — fails today: no note); watch them fail
  (`pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/routing-grid`);
  implement; LOOK at Routing in EN and ES, both themes, 1280 and 390; commit
  `feat(venue-service): routing cells say how extras are made (A366)`.

---

### Task A4a: Routing applies the running period

**Files:**
- Modify: `packages/venue-service/src/routing.ts` (`RoutingRules :31-38`, `RoutingMoment :64-69`,
  `selectRoutingCell :150-192`, `chooseMaker :298-323`, `chooseExtraMaker :331-350`, N),
  `routing-store.ts` (`snapshot :242-311`, `routingAt :629-720`, `resolveMakers :722`,
  `resolveExtraMakers :733`, N), `routing-types.ts` (`RoutingDecision :22`, N),
  `packages/module/src/module.ts` (only if a routing type it names changes, `:310-370`, N)
- Test: `routing.test.ts`, `routing-store.test.ts`, and one case in the server's send suite (real
  route)

**Interfaces:**

```ts
// RoutingRules gains, both OPTIONAL so the existing rule literals in routing.test.ts stand:
readonly cellPeriods?: ReadonlyMap<string /* cell key */, ReadonlyMap<string /* periodId */, RouteTarget>>;
readonly zoneDepartment?: ReadonlyMap<string /* zoneId */, string /* departmentId */>;
// RoutingMoment gains: readonly periods?: ReadonlyMap<string /* departmentId */, string | null>;
// selectRoutingCell's options object gains: periods?: RoutingMoment["periods"] (absent: Any other time).
// The cell decision gains: periodId?: string — set when a period line chose the target.
```

`selectRoutingCell` (today `(rules, row, zoneId, categoryId, { skipOwn })`) finds the cell as
today, then, when it is given the dish's zone's department's period and the cell has a row for it,
returns that row's target with `periodId` set; otherwise the cell's own target. `routingAt(tx, cfg,
at)` reads a department's period the first time a dish in one of its zones is resolved (it already
calls `resolveZoneContext`, which answers `departmentId`, `routing-store.ts:687`, `:705`, N) and
remembers it for the rest of the call (decision 7). With an unreadable clock the resolver answers
open with every menu orderable and a null period (`menu-timetable.ts:461-467`, N): routing then
uses "Any other time". Slice 3's closed-for-today walk (`walkFallbacks :245-270`, `closedSendsTo
:280-296`, N) runs after the cell is chosen and is not changed: a period line naming a station
closed for today follows that station's recorded destination like any other choice.

- [ ] **Step 1: Failing tests** — `routing.test.ts` (pure): review focus 3's cases and focus 4's
  second; an extra on a cell with a Lunch line follows the line during Lunch; a Lunch line naming
  a station closed for today with a destination sends the dish to that destination.
  `routing-store.test.ts`: `routingAt` at 13:00 inside Lunch routes a Cocktail Downstairs, at
  14:10 inside Afternoon (no line) Upstairs; two dishes of one department in one call read its
  period once (count through a wrapper of the seat the test injects). Server: a till send at 13:00
  puts the Cocktail's ticket item at Downstairs bar (`ticket_items.station_id`); a Cocktail sent
  held at 13:55 and released at 14:10 (Afternoon, no line) keeps its ticket item and its printed
  ticket at Downstairs bar (`station-move.ts:61`, N, re-routes only switched-off or not-open
  stations). (Fails today: no `cellPeriods`.)
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/routing.test.ts src/routing-store.test.ts`.
- [ ] **Step 3: Implement.** Pass the periods to every `selectRoutingCell` caller
  (`grep -rn "selectRoutingCell(" packages apps --include='*.ts'`; the dashboard's callers pass
  none).
- [ ] **Step 4: Run; see them pass;** the venue-service node project, the server package; typecheck
  `@waitron/module`, `@waitron/venue-service`, `@waitron/server`, `@waitron/dashboard`.
- [ ] **Step 5: Commit** — `feat(venue-service): a routing cell can send dishes elsewhere during a period (A366)`.

---

### Task A5: Writing period choices, and the preview

**Files:**
- Modify: `packages/venue-service/src/operations.ts` (`configureZone :434-470`, N: a zone moved to
  another department deletes its cells' period rows for the old department, decision 10),
  `packages/venue-service/src/routing-store.ts` (`validateRoutingCell :96-160`,
  `setRoutingCell :176-199`, `clearRoutingCell :201-209`, `previewRoutingChange :428-497`,
  `routingModel :838-880`, N), `routing-types.ts` (`RoutingChange`, `RoutingMove :84`,
  `RoutingModel :96`, N), `routes.ts` (`PUT /routing/cell :488-502`, whose `onlyKeys(body,
  ["address", "target"])` gains `periods`; `POST /routing/preview :480-486`; `STATUS :81`, N),
  `errors.ts` (`route.period_invalid`, beside `:93`, N)
- Test: `routing-store.test.ts`, `routes.test.ts`

**Interfaces:**

```ts
// RoutingChange (the cell route's and the preview's body) gains:
readonly periods?: readonly { periodId: string; target: RouteTarget }[]; // omitted = keep stored rows
// RoutingModel gains: periods (decision 11) and, per cell, `periods: { periodId; target }[]`.
// RoutingMove gains: periodIds: string[] | null — null: at any other time.
// errors.ts: "route.period_invalid": { periodId: string; reason: "other_department" | "repeated" | "not_offered" };
```

`setRoutingCell` validates (decision 10: the zone's department from `zone_service_policies`, the
join `validateRoutingCell` already makes, `routing-store.ts:106-122`, N; the row's products and
each new period's products read once per write through decision 11's reader; the menu check for
every (period, target) pair except one the cell already stores with the same target, decision
29), writes the cell, then replaces its
period rows in the same transaction (delete, then insert — nothing outside points at these rows).
`previewRoutingChange` compares before and after untimed, as today, and once for each period that
the old or the new cell names, reporting a move with `periodIds` (moves equal across periods are
merged into one entry).

- [ ] **Step 1: Failing tests:** saving Cocktails · Every zone with Upstairs bar and a Lunch line →
  the model shows both; saving it again without `periods` keeps the line; with `periods: []` clears
  it; clearing the cell deletes its rows; a zone cell naming another department's period → 409
  `route.period_invalid` `other_department`; an unknown period → 404 `route.subject_not_found`
  `subject: "period"`; the same period twice → `repeated`; a Lunch line on Cocktails when neither
  Lunch's customer menu nor its staff-only menus reach a cocktail → 409 `not_offered`, nothing
  written; the same line when only a staff-only menu reaches one → saved; a stored Lunch line
  whose menus later drop every cocktail survives a re-save of the cell with a new plain station
  (decision 29), but moving that Lunch to another station is refused `not_offered`; pinning an
  inherited cell, sent with the lines decision 14 says the editor leaves out, is refused: a
  Terrace cell sent both departments' Lunches from Every zone → `other_department`, an inherited
  Lunch whose menus have since dropped every cocktail → `not_offered`, a product row (one
  cocktail) sent its category's Lunch line where Lunch's menus reach other cocktails but not this
  one → `not_offered`; a line naming a switched-off station → 409 `route.station_inactive`; moving the
  Terrace to another department drops its cells' Lunch rows and keeps their plain choices;
  `periods` on the default cell → 400 `field: "address"` (today's refusal); `periods` with a null
  target → 400 `field: "periods"`; the preview of adding the Lunch line lists the Cocktails moving
  to Downstairs bar with `periodIds: [lunch]` and lists no untimed move; the model's `periods`
  gives Lunch's product ids, a variant by its parent.
- [ ] **Step 2: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project node src/routing-store.test.ts src/routes.test.ts`.
- [ ] **Step 3: Implement**; run `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`.
- [ ] **Step 4: Run; see them pass;** the node project; typecheck.
- [ ] **Step 5: Commit** — `feat(venue-service): save and preview a cell's period choices (A366)`.

---

### Task A6: Deleting a period that routing names warns first

**Files:**
- Modify: `packages/venue-service/src/menu-timetable.ts` (`readOpeningHoursModel :840`, N; the
  period entries of `OpeningHoursModel`, `menu-timetable-types.ts:63-71`, N),
  `dashboard/opening-hours-screen.ts` (the delete `wt-dialog`, `:812-845`, and `askDelete`/
  `deletePeriod :366-400`, N), `dashboard/strings.ts`, `dashboard/live-queries.ts` (the
  `"opening-hours"` list, `:67-80`, N)
- Test: `packages/venue-service/src/menu-timetable.test.ts` (the model's `routingUses`),
  `dashboard/opening-hours-screen.test.ts` and `.a11y.test.ts` (the dialog),
  `dashboard/live-queries.test.ts:69-84` ("refreshes Opening hours from its periods, ranges, dates
  and menu names", a `toEqual` pin of the list: adding the new names is an allowed whole-shape
  addition), `dashboard/opening-hours-client.test.ts` (the refresh)

**Behaviour:** each period in the model carries `routingUses: { rowLabel: string; zoneName:
string | null }[]`. The delete dialog, when the list is not empty, says "Routing names this period
in {n} cells. Their choices for it will be removed:" and lists them ("Cocktails · Every zone");
confirming deletes, and the cells keep their other lines (decision 12). The dialog's existing
refusal for a period a day still places (`menu_period.in_use`, shown after the request,
`opening-hours-screen.ts:380-391`, N) is unchanged. **The warning stays current:** the Opening
hours screen refreshes only from its `"opening-hours"` live list (`opening-hours-client.ts:31-33`,
N), which names no routing table today, so the list gains `routing_cells`, `routing_cell_periods`,
and the tables `routingUses` reads its labels from — `categories` (a category row's name) and
`products` (a product row's name); `floor_zones` (the zone's name) is already there. If the read
names a category by its path, `category_details` is added too: the list names exactly the tables
the read's queries name.

- [ ] Steps: failing tests (the model lists the uses; the dialog lists them; after confirming the
  cell's Lunch row is gone and its Afternoon row stays; a `routing_cell_periods` change delivered
  through the live list re-reads the model so an open screen's `routingUses` changes — fails
  today: no `routingUses`); watch them fail
  (`pnpm --filter @waitron/venue-service exec vitest run --project node src/menu-timetable.test.ts`
  and `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/opening-hours-screen src/dashboard/opening-hours-client.test.ts src/dashboard/live-queries.test.ts`);
  implement; `pnpm exec vitest run scripts/live-subscriptions.test.ts`; the node project and the
  screen's browser files; LOOK at the dialog in EN and
  ES, both themes, 1280 and 390; commit
  `feat(venue-service): deleting a period warns about the routing that names it (A366)`.

---

### Task A7: The routing read-outs show period lines

**Files:**
- Modify: `packages/venue-service/src/dashboard/routing-grid-model.ts` (the model the grid draws
  from), `apps/dashboard/src/widgets/folder-made-at.ts` (`folderMadeAt :67`, `timed :116-125`,
  N), `packages/venue-service/src/routing-store.ts` (`describeMakers :782-836`, N) if its answer
  gains `periodLines: boolean`, `apps/server/src/catalogue-api.ts` (`:1349-1397`, N) only to pass
  it on, `apps/dashboard/src/api/live-queries.ts` (`listMadeAt :231-239`, `getFolderRouting
  :240-255`, N: add `routing_cell_periods`, which is all these untimed reads newly depend on)
- Test: `routing-grid-model.test.ts`, `apps/dashboard/src/widgets/folder-made-at.test.ts`,
  `apps/dashboard/src/api/live-queries.test.ts` if it pins the lists

**Behaviour:** the grid model gives each cell its period lines in decision 15's words, and marks
an inherited cell's lines as inherited. The Products screen's folder read-out treats a category
whose applying cell has period lines as "timed" (its existing marker for a station with hours,
`:116-125`, N), so it shows that the answer changes during the day.

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
department) whose `productIds` meet `rowProductIds`, plus a period the cell already stores, in
the line holding its stored target (decision 29), and not a period already in another line; a station `wt-combobox` with the cell's
own choices; Remove. "+ Different station during some periods" (absent when `isDefaultCell`,
decision 8). Clear only for a stored cell. A refusal set on the editor lands under the line whose
period it names (`route.period_invalid`, any reason), else at the bottom. A331 rule, with decision
14's starting state: an inherited cell's draft holds only the inherited lines a pinned cell here
could store, and one line says which inherited periods were left out and why.

- [ ] Steps: failing tests (the offers for a zone column and for Every zone; a period whose
  products miss the row is not offered; a stored line's period is still offered after its menus
  drop the row's products; a period in one line is not offered in another; adding a line and
  saving emits `routing-cell-save` with `periods`; Remove; Clear; a `not_offered` refusal shows
  under its line; an inherited cell's Save is available at open and a stored cell's is not;
  decision 14's three inherited cases — a Terrace cell inheriting two departments' Lunches from
  Every zone opens with only the Terrace department's, an inherited Lunch whose menus have dropped
  the row's products is left out, a product row inheriting its category's Lunch where Lunch
  offers other products of the category but not this one leaves it out — each naming the
  left-out period in the one line, and Save on each sends only what was kept; the reconnect case; axe for empty, two lines and a refusal, both themes); watch them fail
  (`pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/routing-cell-editor`);
  implement; commit `feat(venue-service): a routing cell editor with period choices (A366)`.

---

### Task A8b: The grid's cells open the editor

**Files:**
- Modify: `dashboard/routing-grid.ts` (the cell `:361-378` and `#defaultCell :392-426`, N; events
  `routing-cell-change :376`, `routing-make-default :426`), `prep-stations-screen.ts` (the handlers
  that run the preview, `#previewDialog :3216-3278`, N — the moves say "during Lunch"),
  `routing-client.ts` (`setCell :283-285`, `preview :190-196`, N: pass `periods`),
  `dashboard/live-queries.ts` (`routing`, `:17-41`, N: add `routing_cell_periods`, `menu_periods`,
  `menu_period_staff_menus`, `menu_slots`, `menu_day_timetables`, `departments`,
  `zone_service_policies` and the section and catalogue tables `reachableProducts` reads — taken
  from the model's queries, not from memory)
- Test: `routing-grid.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`, `prep-stations-screen.test.ts`
  (the preview cases), `routing-client.test.ts`, `live-queries.test.ts:21-67` ("refreshes the
  routing grid and the operations screen on a routing cell change", the `toEqual` pin of the
  `routing` list at `:22`: adding the new names is an allowed whole-shape addition)

**Behaviour:** the cell is a button: the station (italic when inherited), the period lines beneath
(Task A7) and the extras note where it has one (Task A3d, kept as it is). Clicking opens Task A8a's
editor on that cell; Save runs the preview, then `setCell` with `periods` once confirmed; the
default cell saves through `routing-make-default` as today. A refusal from the write is handed to
the editor.

- [ ] **Step 1: Changed test checks commit** for the inline combobox's cases (listed under
  "Behaviour this slice removes"): each case that chose through the combobox now opens the editor
  and saves through it, asserting the same write and the same preview.
- [ ] **Step 2: Failing tests:** the cell is a button whose accessible name holds station, lines
  and any extras note; saving a Lunch line previews, then writes `periods`; a `route.period_invalid`
  refusal lands under its line; a live update to `routing_cell_periods` redraws the cell.
- [ ] **Step 3: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/routing-grid src/dashboard/prep-stations-screen.test.ts src/dashboard/routing-client.test.ts src/dashboard/live-queries.test.ts`.
- [ ] **Step 4: Implement;** the venue-service node project and `pnpm exec vitest run scripts/live-subscriptions.test.ts`.
- [ ] **Step 5: LOOK** at the grid and the editor in EN and ES, both themes, 1280 and 390; confirm
  the long station name no longer meets an arrow.
- [ ] **Step 6: Commit** — `feat(venue-service): routing cells open their editor (A366)`.

---

### Task A9: The routing grid at phone width

**Files:** modify `dashboard/routing-grid.ts` (`:69-79`, `:115-123`, N); test
`routing-grid.test.ts` (`:751`, `:773`, N).

**Behaviour:** decision 18.

- [ ] Steps: the changed check first (`:751`'s cap of 140 becomes 96, in the separate commit);
  failing test in Chromium at a 390 px viewport: the row-label column is at most 96 px and the
  Every zone column and the first zone column lie wholly inside the grid's visible width with
  `scrollLeft` 0; `:773`'s sticky labels still hold; watch them fail
  (`pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/routing-grid.test.ts`);
  implement; LOOK in EN and ES,
  both themes, 390 and 1280; commit `fix(venue-service): two routing columns fit a phone (A366)`.

---

### Task A10: Server — one request edits a station's name, printers and rest of order

**Files:**
- Modify: `apps/server/src/management-api.ts` (`PATCH /management-api/stations/:id :2026-2085`,
  `POST /management-api/stations :1943`, N), `apps/server/src/kitchen.ts` (`updateStation :205`,
  `createStation :103`, N), `apps/server/src/station-printers.ts` (`replaceStationPrinters :64`,
  N); `management-api.ts`'s `STATUS` (`:251`, N) gains `"printer.makes_and_watches": 409` (today
  only `print-api.ts:116` maps it; an unlisted code answers 400,
  `packages/server-kit/src/error-boundary.ts`)
- Test: `apps/server/src/management-api.test.ts`, new cases inside the describe
  "/management-api/stations (KDS-1 config)" (`:2087`, N), which holds the station routes' cases

**Behaviour:** decision 19. Both routes accept `printerIds?: string[]`; the station row and its
printers are written in one transaction; with `printerIds` the route also checks `printer.manage`
(`print-api.ts:101`, N, the permission today's printers route needs) and refuses
`authorization.not_permitted` without it, writing nothing; a refused printer (switched off, or a
watcher's — `printer.makes_and_watches`, decision 4) leaves the name unchanged too. The route's
early "nothing to change" answer (`:2071-2081`, N, a 204 before any check) counts `printerIds` as a
change. The editor sends `printerIds` only when they changed, since `replaceStationPrinters` refuses
a switched-off station (`station.not_found`, `station-printers.ts:70-74`, N): a switched-off
station's name can still be edited.

- [ ] Steps: failing tests (a PATCH with a new name and two printers stores both; the same by a
  person with `venue.configure` but not `printer.manage` → 403 `authorization.not_permitted` and
  nothing stored, while a PATCH of the name alone by that person succeeds; one with a watcher's
  printer → 409 `printer.makes_and_watches` and the old name kept; a POST with printers
  creates the station with them — fails today: the field is ignored or refused); watch them fail
  (`pnpm --filter @waitron/server exec vitest run src/management-api.test.ts -t "management-api/stations"`);
  implement; the server package; typecheck; commit
  `feat(server): a station's printers save with the station (A366)`.

---

### Task A11a: Dashboard — the station editor replaces Rename

**Files:**
- Create: `packages/venue-service/src/dashboard/station-editor.ts` (`wt-modal`) and its `.test.ts`,
  `.a11y.test.ts`, `.save-state.test.ts`, `.unsaved.test.ts`
- Modify: `dashboard/prep-stations-screen.ts` (`#stationMenu :1176-1242`, its Rename item
  `:1204-1218`, `#renameDialog :1281-1337`, the New station dialog `#dialog :3142-3178`, N),
  `routing-client.ts` (`updateStation :235-245`, `createStation :212`, N: `printerIds`),
  `dashboard/strings.ts`
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

### Task A11b: Dashboard — the Stations table drops the live kitchen numbers

**Files:**
- Modify: `dashboard/station-health-table.ts` (renamed in Task A11c, not here): rows from its
  `stations` property (`:83`, N) instead of `snapshot.stations`
  (`render :201-222`, N); the `snapshot` property, the number columns `:142-158`, `#number :89`,
  `#items :104`, `#details :160-200` and the problem notes in `#name :114-130` go
- Modify: `dashboard/prep-stations-screen.ts` (the `health` state and `#loadHealth :282-284`,
  `:777-779`, `:835`, `:840-857`; `#healthTable :1078`; the table at `:3436-3446`; the import
  `:61`, `:69`, N), `dashboard/routing-client.ts` (`readStationHealth :264-273` and the
  `StationHealth*` types `:19-46`, N — `OutputsDown` and `listOutputsDown` stay, decision 34),
  `dashboard/live-queries.ts` (the `health` list `:2-15`, N), `dashboard/strings.ts`
  (`prep.health.*` keys no longer read, the `prep.printer_down`/`prep.screen_*` keys once unused)
- Test: `prep-stations-screen.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`,
  `prep-stations-overview.a11y.test.ts`, `station-action.unsaved.test.ts`, `routing-client.test.ts`,
  `live-queries.test.ts`, `station-health-table.test.ts` and `.a11y.test.ts`; mock-only edits (a
  `readStationHealth` stub or `StationHealth*` type dropped, no assertion) in
  `routing-grid.unsaved.test.ts`, `watcher-form.unsaved.test.ts`,
  `prep-stations-screen.settings.test.ts`, `.settings-unsaved.test.ts`, `.printers-unsaved.test.ts`.
  The full list, by `file:line`, and the search that finds it are under "Behaviour this slice
  removes", Part A.

**Behaviour:** decisions 20, 34, 35. The Stations table shows each station's name with its
Default and Disabled marks, the Today column (until Part B), and the ⋮ menu and reorder grip for a
manager; nothing live. A supervisor gets the same table read-only, with no menus. The screen
makes no health read.

- [ ] **Step 1: Changed test checks commit** for the live numbers' cases (listed under "Behaviour
  this slice removes", Part A): number and drill-down cases are deleted and listed; the supervisor
  case `:4585` becomes "a supervisor sees the stations read-only" with its no-configuration-controls
  checks kept; the read-failure case `:2495` keeps its routing-recovery half; each case in the
  list that also checks something else keeps that half. The element keeps its old name until
  Task A11c.
- [ ] **Step 2: Failing tests** — the table renders its rows before any health read and with
  `readStationHealth` absent from the client; it has no Waiting, Preparing, Ready, Late or Oldest
  column; a manager's drag reorder still saves the new order; a supervisor's table has no ⋮ and
  no number; the screen subscribes to no `health` query; axe for the manager's and the
  supervisor's table in both themes.
- [ ] **Step 3: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/prep-stations src/dashboard/station-health-table src/dashboard/station-action src/dashboard/routing-client.test.ts src/dashboard/live-queries.test.ts src/dashboard/routing-grid.unsaved.test.ts src/dashboard/watcher-form.unsaved.test.ts`
  (`src/dashboard/prep-stations` covers the screen's `.settings`, `.settings-unsaved`,
  `.printers-unsaved` and overview suites).
- [ ] **Step 4: Implement;** the node project; `pnpm exec vitest run scripts/live-subscriptions.test.ts`;
  typecheck `@waitron/venue-service` and `@waitron/dashboard`. No LOOK here: Task A11c looks at
  the finished table.
- [ ] **Step 5: Commit** — `feat(venue-service): Prep stations shows no live kitchen numbers (A366)`.

---

### Task A11c: Dashboard — the Stations tab's read-outs; the Tickets tab and the Settings column go

**Files:**
- Rename first (decision 36), as this task's first commit, mechanical and changing no assertion:
  `git mv` `dashboard/station-health-table.ts` → `dashboard/station-table.ts` (element
  `prep-station-health-table` → `prep-station-table`, class `StationHealthTable` → `StationTable`),
  with `station-health-table.test.ts` and `.a11y.test.ts`; the import in
  `prep-stations-screen.ts:69` (N) and its `querySelector`s `:1080`, `:1101`, `:3436`, `:3446`
  (N); and the selectors and helper Task A11b left (`grep -rn "prep-station-health-table\|station-health-table" packages apps --include='*.ts'`,
  listed by `file:line` under "Behaviour this slice removes", Part A). Commit
  `refactor(venue-service): the stations table is named for what it shows (A366)`.
- Modify: `dashboard/prep-stations-screen.ts` (`PREP_TABS :77`, the Tickets panel `:3483` and
  `#tickets :1958-2021`, `#printerCell :1864-1957`, `#saveStationPrinters :1827-1863`, the
  Settings `rest` column `:2697-2701` and `#settingsCell`'s `rest` branches, N),
  `dashboard/station-table.ts` (two read-out columns), `routing-client.ts` (`setStationPrinters
  :246-248`, N, only if `grep -rn "setStationPrinters" packages apps --include='*.ts'` finds no
  other caller), `dashboard/strings.ts`
- Test: `prep-stations-screen.test.ts`, `.a11y.test.ts`, `.printers-unsaved.test.ts` (deleted: its
  subject goes, and the editor's reconnect case is Task A11a's), `.settings.test.ts`,
  `.settings-unsaved.test.ts`, `station-table.test.ts`

**Behaviour:** decision 16. The Stations table for a manager: name, "Printed on" (printer names, or
"No printer"), "Shown on" (the kitchen displays bound to the station and those bound to a watcher
that follows it — today's two read-outs merged, `#tickets`' `screens` and `watchers` columns
`:1980-2009`, N; if slice 5 Part A has landed, the monitors that show it, slice 5 Task A17), then
Today. A supervisor's table has neither read-out (decision 35). The Settings tab keeps timing and
the fallback column (until Part B).

- [ ] **Step 1: Changed test checks commit** for the Tickets tab and the Settings "Show the rest of
  the order" column (under "Behaviour this slice removes"): a case that edited printers in the
  Tickets cell now edits them in the editor; the Settings case now checks the editor's switch.
- [ ] **Step 2: Failing tests** — the tab list is Stations, Routing, Watchers, Settings; the two
  read-outs show for a manager and not for a supervisor; `view=tickets` opens Stations; axe in
  both themes.
- [ ] **Step 3: Run; watch them fail** — `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/prep-stations-screen src/dashboard/station-table`.
- [ ] **Step 4: Implement;** the node project; LOOK at the finished Stations tab (Tasks A11b and
  A11c together) as a manager and as a supervisor, in EN and ES, both themes, 1280 and 390.
- [ ] **Step 5: Commit** — `feat(venue-service): stations show their printers and screens; the Tickets tab goes (A366)`.

---

### Task A11d: Server — the station health read goes

**Files:**
- Modify: `apps/server/src/management-api.ts` (`GET /management-api/stations/health`
  `:2002-2011` and its import `:12`, N)
- Delete: `apps/server/src/station-health.ts` and `station-health.test.ts`
- Test: `apps/server/src/management-api.test.ts` (a new case in the describe
  "/management-api/stations (KDS-1 config)", `:2087`, N: the route answers 404),
  `kitchen-timing-consumers.test.ts` (the `"health"` row, `:235`, `:248-249`, and its import
  `:15`, N)

**Behaviour:** decision 20. The route answers 404. The receipts that only the Stations tab used it,
run on N and re-run here before deleting:
`grep -rn "stations/health\|readStationHealth\|stationHealthItemsQuery\|station-health.js" apps packages scripts --include='*.ts' --include='*.mjs'`
— on N its only non-test hits were the route (`management-api.ts:2002`), its import (`:12`), the
file itself and the dashboard client (`routing-client.ts:264-273`), whose only caller is
`prep-stations-screen.ts:848`; Task A11b removed the client side. If the grep shows any other
caller (slice 5 Part A may have landed: its Task A7 edits `station-health.ts`), STOP and report.

- [ ] Steps: the changed-checks commit (`station-health.test.ts` deleted, by file; the
  `kitchen-timing-consumers.test.ts` `"health"` row removed, the other six rows kept); failing test
  (the route answers 404 — fails today: 200); watch it fail
  (`pnpm --filter @waitron/server exec vitest run src/management-api.test.ts -t "management-api/stations"`);
  implement; `pnpm --filter @waitron/server exec vitest run src/management-api.test.ts src/kitchen-timing-consumers.test.ts`; the server package;
  typecheck `@waitron/server`; commit `feat(server): the station health read goes (A366)`.

---

### Task A12: The tab row at phone width

**Files:** modify `packages/ui/src/components/wt-tabs.ts` (the strip `:31-38`, the actions area
`:39-45`, `#stripObserver :127-132`, `#showSelected :146-163`, N) and its tests
(`wt-tabs.test.ts`, `wt-tabs.a11y.test.ts`; a token-painting case if the fade reads a token),
`packages/venue-service/src/dashboard/prep-stations-screen.ts` (the actions slot `:3410-3426`,
N); tests `prep-stations-screen.test.ts` (`:2715-2746`, N).

**Behaviour:** decision 17. `wt-tabs` sets `data-overflow` to `start`, `end`, `both` or nothing from
its strip's scroll position and size (on scroll and on resize), and masks the cut end
(`mask-image` with a transparent stop `var(--wt-space-6)` from the edge). The screen shows "New
station" on Stations and "New watcher" on Watchers only. A marked tab (`marked`, added since the
plan was first written, `wt-tabs.ts:10-12`, N) keeps its colour under the fade.

- [ ] Steps: the changed check first (`:2741`'s two actions become one; the 50% cap is kept);
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

**Files:**
- `docs/developers/design-system.md`: the Prep stations paragraph (`:3073-3095`, N: it says
  "Stations shows live health and opens read-only dish drilldowns", "Routing shows the route
  tester above the routing grid", "Tickets and Watchers own their printer selections" and "Station
  Rename"); the tab-row paragraph's Prep stations sentence (`:3213-3216`, N: "shows both its add
  buttons … on every tab"); the Save editors line (`:1797-1799`, N: "New and Rename station,
  station printers, … Settings rest/fallback/timing"); add the cell editor and the station editor;
  the tab fade under `wt-tabs`
- `docs/developers/products.md` (`:223`, N, if a combined ticket's names need a line)
- `docs/backlog.md`: in the A366 entry ("Service times, departments, zones and prep stations
  (A366, owner 2026-10-07)"), say slice 4 Part A is built; delete "On the Routing tab, the label
  above the 'Where is this made?' time choice is cut" (both halves are now closed: the tab row by
  Task A12, the "W…" label with the tester) and "At 390 px the routing grid's fixed first column
  takes about 140 of the grid's roughly 310 px"; delete "`#fallbackReason` … turns the server's
  `switched_off` reason into `prep.test_disabled`…" (its subject, `fallbackReason` in
  `routing-explanation.ts:57`, N, is deleted with the tester); and add, under "The kitchen and
  preparation", a short entry titled "`GET /management-api/stations/outputs-down` and the
  dashboard's `listOutputsDown` have no caller" — found while removing the health read
  (decision 34): the route (`apps/server/src/management-api.ts:2013-2024`, N) and the client
  method (`routing-client.ts:274-278`, N) are called only by their own tests; decide whether to
  remove them or use them.
  This slice leaves both in place
- `docs/backlog/kitchen.md`: delete the two sections with the same titles as the two phone-width
  entries
- `docs/backlog/service-periods.md`: the A366 detail's slice 4 sentence (it describes the plan's
  two pull requests as not yet built): say Part A is built, with its pull request number

- [ ] Read every claim about kitchen tickets per station, station printers, the Tickets tab,
  Rename, the tester and live station health across `docs/developers/` and the backlog (CLAUDE.md
  §1: a behaviour change retires every receipt about the old one:
  `grep -rn -i "tickets tab\|each of its printers\|Printed on\|Rename\|route tester\|Where is this made\|live health\|drilldown\|stations/health" docs/developers docs/backlog.md docs/backlog`),
  correct each, and commit `docs: shared printers, period choices and the station editor (A366)`.

Then run `/finish-branch` with this worktree and this plan. Pull request's first line: **"no venue
reset needed"**. Its body lists the changed test checks, and names the removed routes `GET
/management-api/stations/health` (the only server read the Stations tab's live numbers used,
decision 20) and `GET /management-api/venue-service/routing/explain` (the tester's, decision 32).

---

## Part B — no station hours or fallbacks; worked-out times (second pull request)

**Re-ground before starting.** Part B was written on 2026-10-08 against slices 2 and 3's plans,
not their code; its lines are M or S1. Slices 2 and 3 Part A have since landed (#1470, #1469) and
Part A of this plan changes some of the same files. Re-read every line it cites on `main`, and
re-check its tasks against what landed:
`git log --oneline 974f7170e^..origin/main -- packages/venue-service/src/routing.ts packages/venue-service/src/routing-store.ts packages/venue-service/src/station-times.ts packages/venue-service/src/hours.ts packages/venue-service/src/dashboard/hours-screen.ts packages/venue-service/src/dashboard/prep-stations-screen.ts packages/venue-service/src/dashboard/opening-hours-screen.ts apps/till/src/widgets/station-today-dialog.ts apps/server/src/station-today-api.ts`,
then `grep -rn "fallbackId\|todaySendsTo\|readStationSchedules\|stationsRestrictedFrom\|out_of_hours\|opened_by_hand\|station_fallbacks\|hours_week_cells\|special_date_hours" apps packages --include='*.ts'`
for the current readers. If slice 3 does not store a destination with "Close for today", or slice 2
did not move named days off the Station hours screen, STOP and ask.

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

- [x] **Step 1: Changed test checks commit**, listed with
  `grep -rn "fallbackId\|stationFallbacks\|setStationFallback\|setStationToday\|hours:\|out_of_hours\|in_hours\|no_hours\|opened_by_hand\|time_not_applied\|nextTransition\|no_replacement\|noReplacement\|switched_off" <file>`
  over `routing.test.ts` here and, for Task B1b, `routing-store.test.ts`, `station-times.test.ts`,
  `hours-routes.test.ts`, `apps/server/src/catalogue-api.test.ts` (`:1508-1520`, M),
  `working-order.test.ts` (`:3255-3280`, M), `station-move.test.ts`, the `dead-ends` suites, and
  the dashboard's `product-list` and `folder-made-at` tests: a case whose station was closed by
  its hours becomes one closed for today with the same expected destination where it named one,
  else the default station; a case expecting `noReplacement` for a switched-off station or a
  closed loop now expects the default station (decision 22); a case whose whole subject was hours
  is deleted and listed.
- [x] **Step 2: Failing tests:** review focus 8's pure cases.
- [x] **Step 3: Run; watch them fail;** implement; the venue-service node project; typecheck.
- [x] **Step 4: Commit** — `feat(venue-service): a station is open unless closed for today (A366)`.

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
slice 3 row with no destination lands at the default station; review focus 8's server cases.

- [x] Steps: failing tests; watch them fail; implement; the venue-service node project, the server
  package, the dashboard's folder read-out file, and the till's suite (Chromium, headroom first);
  typecheck every package the typecheck names; commit
  `feat(venue-service): routing reads no station hours (A366)`.

---

### Task B2: The till and the kitchen display without hours; closing with open dishes

**Files:** `apps/till/src/` where slice 3's status line shows `out_of_hours` or `opened_by_hand`
(`grep -rn "out_of_hours\|opened_by_hand" apps/till/src`), slice 3's station today dialog
(`apps/till/src/widgets/station-today-dialog.ts`, `station-today.ts`), `i18n/strings.ts`;
`apps/server/src/` `till-api.ts` (`GET /api/stations`), `device-api.ts` (slice 3's `today`),
`station-today-api.ts` (the close routes), `alert-sources.ts` (`:337-344`, M: a printer-down alert
is suppressed for a closed station — now only a station closed for today), and their tests. Re-ground
first; this task may need splitting once the open-dishes move is designed.

**Behaviour:** decisions 22, 23 and 37. "Close for today" on a station with open dishes warns and
asks once, in its one dialog: the person picks a station (the default first, as slice 3 offers)
and says whether the open dishes go there or stay to finish. NEW dishes after closing go to the
picked station, else the default station. With no open dishes it closes as slice 3 built it. The pull request lists each
slice 3 check this changes.

- [x] Steps: failing tests (the kitchen display's status line never reads "outside its hours"; a
  printer-down alert for a station closed for today is suppressed and for an open one is raised;
  closing a station with an open dish asks about it, sending moves it, leaving keeps it there
  until done — fails today on the removed `why` values and on closing without asking); watch them
  fail; implement; the server package and the till's suite; commit
  `feat: the till and kitchen display drop station hours and ask about open dishes (A366)`.

---

### Task B3: Dashboard — the Today column, status sentences and fallback field go; Disable asks

**Implementation decision, 2026-10-09:** `ticket_items.station_retained_at_release` records the
explicit "leave to finish" choice. It survives Disable at held-group release;
`station_chosen_at` alone still protects a manual choice only while the station is active.
Moving the dish clears its old retention choice. The core migration adds only this column;
Task B7 still removes the separate station-hours and fallback tables.

**Checkpoint, 2026-10-09:** The screen now opens `dashboard/station-disable-dialog.ts`,
passing the routing cells that name the station. The one-request disposition flow carries the
old cancellation, draft, pending-write, replacement and departed-control checks. Its required
choice uses the shared field's visible and semantic marker. Connected EN/ES, light/dark,
phone/desktop captures and focused screen checks pass. B3 remains incomplete: retire the
remaining server/table fallback contract, then reconcile with Part A's table
and run the whole-task gates. The Settings fallback column and editor have been removed
test-first. Its mixed draft, retry, native-control and accessibility checks exercise the
remaining rest setting; the assertion changes are in a separate signed commit.

**Files:** `dashboard/prep-stations-screen.ts` (`#stationStatus :1670-1695`, `#todayCell
:1696-1715`, `#destination :1661-1665`, the Settings fallback cell `:2487-2609`, `#fallbackOptions
:1716-1728`, the Station action dialog's fallback `:3349-3368`, `#fallbackConfirmation
:1770-1789`, the Disable flow `:1235-1241`, the Disabled section's `prep.off_*` cards in the
Routing tab, M, as slice 3 left them), `station-table.ts` (Part A's name; the Today column),
`routing-client.ts` (`setStationFallback :258`, M), `dashboard/strings.ts` (`prep.when_closed`
and the status keys `:115-160`, S1, once unused); tests `prep-stations-screen*.test.ts`,
`station-action.unsaved.test.ts`, `station-table.test.ts`.

**Behaviour:** decisions 20 and 24. The Stations table shows "Closed for today → {destination}" or
"Switched off" beside a station's name instead of a Today column. Disable on a station with open
dishes asks once, in its one confirmation, what happens to them (send to a station the person
picks, or leave them to finish), beside the cells that name the station; NEW dishes then go to
the default station (decisions 24 and 37). With no open dishes it confirms as decision 24 says.

- [x] Steps: the changed-checks commit (each Today, fallback and Disable-asks case, with
  `file:line`, before and after); failing tests (no Today column; the note beside a closed
  station; Disable with an open dish asks about it; Disable lists the naming cells and sends no
  fallback; the Settings tab has no fallback column); watch them fail; implement; LOOK in EN and
  ES, both themes, 1280 and 390; commit `feat(venue-service): Prep stations drops hours and fallbacks (A366)`.

---

### Task B4: moved to Part A

The tester and its extras note are Tasks A3b–A3d (owner, decision 13). The number is kept so the
later Part B tasks keep theirs.

---

### Task B5: The Station hours screen goes

**Files:** `dashboard/hours-screen.ts`, `hours-client.ts`, `hours-view.ts`, `hours-dates-list.ts`,
`hours-cell-editor.ts` and their tests (each deleted once `grep -rn "<file stem>" packages apps`
finds no importer outside the deleted set — slice 2 may have moved the calendar component to
Opening hours, and `prep-stations-screen.ts` imports `format`/`formatDate` from `hours-view.ts`),
`dashboard/index.ts` (the `hours` entry, `:53-70`, S1), `dashboard/live-queries.ts` (`hours :42-56`,
S1), `apps/dashboard/src/navigation.ts` (`hours`, `:10`, S1) and its test,
`dashboard/strings.ts` (`nav.hours`, `hours.*` once unused); every link to `/manage/hours` (`grep -rn
"manage/hours\|dashboard: \"hours\"" packages apps docs`).

- [x] Steps: the changed-checks commit (the deleted suites, by file; `navigation.test.ts`'s `hours`
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

- [x] Steps: the changed-checks commit (deleted suites by file; changed cases with `file:line`; a
  configuration export no longer carries the five tables — `apps/server/src/configuration-transfer.test.ts`'s
  hours cases, `:3932-3944`, `:4011-4012`, `:4112`, `:4135-4138`, `:4187`, S1); failing tests (Make
  default no longer refuses on a demoted station's hours; the removed routes answer 404; an export
  has no `station_fallbacks` or hours tables); watch them fail; implement; run
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`; the
  venue-service node project, the server package; typecheck; commit
  `feat(venue-service): station hours and fallbacks leave the server (A366)`.

---

### B6 fixture check inventory — provisioning and department scope

The following test changes implement B6's retirement of station-week writers. They do not retire
any department refusal or named-day preservation check.

- `operations.test.ts`, the mixed station-hours/department-deactivation case: remove the fixture
  writer's `hours.invalid` refusals, stored weekly modes/ranges and unset-week checks. Keep the
  exact `department.not_found` refusal for both a foreign and unknown department and the foreign
  department's active-row check. The retired writer exists only in test support at this checkpoint.
- `provisioning.test.ts`, the mixed hours/named-date seed case: replace the old week's unset,
  stored-Closed and five-table count checks with venue-scoped named-date checks. Keep the named
  date's exact preservation across another seed, and explicitly check its authored fields and id.
  Provisioning of service-period ranges remains covered by the separate Open-period seed cases.

Before adapting these fixtures, run both cases in a disposable installed checkout after dropping
the five retired tables, children first. Retain that failing output, then rerun the adapted cases
under the same table absence. This rehearsal checks these two consumers only; B7 still owns the
schema deletion and the complete upgrade walk.

---

### B6 fixture check inventory — routing and station day seats

In `service.test.ts`, `routes.test.ts` and `routing-store.test.ts`, remove only calls that seed
retired weekly hours or configured fallbacks, their imports and the local fallback fixture writer.
Keep every existing result assertion, including daily destinations, reopening, venue isolation,
clock handling and prepared-query bounds. Update titles that describe the removed setup.
Before editing, run the old complete service and routing-store files, plus the explain-route case,
in an independently installed checkout with the five retired tables dropped in the database
helper's setup callback. Run the adapted cases under the same absence and retain sources/output.
The route suite's separate stored-fallback retirement case still awaits B7 adaptation.
This rehearsal covers these three consumers;
the remaining fixture consumers and B7's generated migration are separate work.

---

### B6 fixture check inventory — station times

In `station-times.test.ts`, remove retired week/fallback fixture writes, keeping the current
station-status, daily close/reopen, destination, cutover, clock-change and venue refusal checks.
Keep all cases. The two mixed week-storage cases keep their routing-result assertions; their
fixture-only weekly replacement/unset rows and `hours.invalid` fixture-writer refusal checks
retire with the writer under B6. Rename cases that describe the removed setup.
Named-date setup keeps its date and whole-venue closure, without station cells.
Run the old full file in an independently installed checkout with the five tables dropped in
`useVenueDb` setup, then run the adapted full file under the same absence. Retain the before
sources and exact diff. Table deletion, remaining hours/transfer/server consumers and upgrade
verification remain B7 work; this inventory does not claim the whole retirement is complete.

---

### B6 fixture check inventory — Calendar model and live changes

In `hours-station-model.test.ts`, retain named-day facts, venue clock fields, local/foreign
station filtering, edits, copies, original preservation and Opening hours department names.
Remove seeding and direct row checks of the retired week/date station tables. Retire only the
two cases that exercise the temporary station-week fixture reader/writer's department refusal;
those fixture functions are removed by B6. Keep public-export removal checks. Rename mixed
cases to describe the supported Calendar behavior.

In `hours.live.test.ts`, retain named-day create/copy/delete, clock, department, daily station,
holiday geography, address, country and unrelated-write assertions. Remove committed writes to
the five retired tables and the assertions on notifications from those fixture-only writes.
The third mixed case keeps its daily station and named-day notification assertions.

Before adaptation, run both complete files in an independently installed checkout with the five
retired tables dropped children first in `useVenueDb` setup and their change sources removed
in that disposable checkout, rehearsing B7. Repeat the adapted files under the same conditions. Record exact retired assertions and before/after sources for the final PR.
This rehearsal does not replace B7's generated migration and upgrade walk.

---

### B6 fixture check inventory — server station moves, printing and today controls

In `apps/server/src/station-move.test.ts`, `kitchen-print.test.ts` and
`till-api.station-today.test.ts`, remove only configured-fallback seed calls, the local
fixture writers and their table imports. Keep every existing result assertion and case,
including held-dish destinations, printing, refusing moves and authenticated today controls.
Rename the split-off chips case to describe the closed fryer without a configured fallback.

Before adapting, run all three complete files in an independently installed checkout with
the five retired tables dropped children first before `useVenueDb` runs its setup callback.
Repeat the adapted files under the same absence. Retain exact sources, output and an assertion
comparison for the final PR. This rehearsal covers these consumers; it does not complete B6
or replace B7's generated migration and upgrade walk.

---

### B6 fixture check inventory — server configuration transfer

In `apps/server/src/configuration-transfer.test.ts`, remove station-week and fallback seeds
and readers from the mixed named-day fixtures. Retire only their stored-row counts and
unset-week checks; keep named-day fields, fresh ids, Calendar/default-station results,
zone closed-time round trips, refused retired-table imports and transaction rollback.
The source/target named-day comparison drops its obsolete station-cell projection on both
sides and compares the remaining fields exactly. The rejected-import persisted-row shape
loses only the retired `cells` count and keeps `tenants: 0`.

Run the original complete file in an independently installed checkout with the five tables
dropped children first before setup, omitting them from that candidate's fixture clear list.
Then run the adapted file under the same absence and retain the before sources and exact
changed-check inventory. B7 still owns the generated migration and upgrade walk.

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

- [x] **Step 1:** list the keys pointing at each table (`grep -rln 'REFERENCES \`hours_week_cells\`\|REFERENCES \`special_date_hours\`\|REFERENCES \`station_fallbacks\`' packages/*/drizzle/`);
  expected: only the two `*_periods` children, dropped in the same generation. If any other table
  points at one, STOP.
- [x] **Step 2: Failing test** in `migrations.test.ts`: the five tables are absent.
- [x] **Step 3:** remove them from the schema and generate; read the SQL (five `DROP TABLE`, children
  first). Remove them from classification, the guard lists, the clear list and `service.test.ts`.
- [x] **Step 4: Run** the Task A3 guard list, `scripts/live-subscriptions.test.ts`, and the
  upgrade walk; if it reports a casualty, add the `RESETS` entry it names and change the pull
  request's first line to "venue reset needed" with that reason.
- [x] **Step 5: Commit** — `feat(venue-service): drop station hours and fallbacks (A366)`.

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
applied), each zone's closed ranges as slice 2's reader gives them, each period's products
(decision 11's reader, shared, not copied), and the routing rules once (`loadRoutingRules`,
`routing-store.ts:302`, M) with the moment's period set to the period being tested. At most 42
days per call (`management.request_invalid` beyond).

- [x] Steps: failing tests (review focus 9's three cases; the default station answers `always:
  "default"`; a switched-off one `switched_off`; a station no routing reaches has no ranges);
  watch them fail (`pnpm --filter @waitron/venue-service exec vitest run --project node src/station-service-times.test.ts`);
  implement; the node project; typecheck; commit
  `feat(venue-service): when a prep station gets orders, worked out (A366)`.

---

### Task B9: Opening hours — the prep station view

**Files:**
- Create: `dashboard/opening-hours-station.ts` and its `.test.ts`, `.a11y.test.ts`
- Modify: `dashboard/opening-hours-screen.ts` (slice 2's picker; the URL's `station` key),
  `opening-hours-client.ts`, `apps/dashboard/src/navigation.ts` (`opening-hours` children),
  `dashboard/strings.ts`; tests `opening-hours-screen.test.ts`, `navigation.test.ts`

**Behaviour:** decision 25. Read-only; the default station and a switched-off one show their
sentence instead of a grid.

- [x] Steps: failing tests (the picker's Prep stations group lists active stations; choosing one
  writes `station=` and shows its columns; the real week's ‹ › reloads; the default's sentence;
  axe in both themes); watch them fail; implement; LOOK in EN and ES, both themes, 1280 and 390;
  commit `feat(venue-service): Opening hours shows when each prep station gets orders (A366)`.

---

### Task B10: The demo

**Files:** `apps/server/scripts/demo-seed/seed-floor.ts` (`:154-161`, S1), `seed.test.ts`
(`:301-311`, S1).

- [x] Steps: the changed check (the seed test's hours and fallback assertions become the period
  line's); failing test (the demo's drinks cell has the evening line, decision 27); watch it fail;
  implement; `pnpm --filter @waitron/server exec vitest run scripts/demo-seed`; commit
  `feat(demo): the demo routes drinks upstairs in the evening (A366)`.

---

### Task B11: The Stations tab links to Opening hours

**Files:** `dashboard/prep-stations-screen.ts` (the Stations table), `dashboard/strings.ts`; test
`prep-stations-screen.test.ts`.

- [x] Steps: failing test (each active, non-default station's row links "When it gets orders" to
  `/manage/opening-hours?view=week&station=<id>`); watch it fail; implement; commit
  `feat(venue-service): a station links to when it gets orders (A366)`.

---

### Task B12: Documentation and backlog (Part B)

**Files:** `docs/developers/design-system.md` (Prep stations and Station hours paragraphs, as
slices 2–3 and Part A left them), `docs/developers/conventions-data.md` (`:402`, `:1203`, S1),
`docs/developers/public-holidays.md` (`:4`, S1), `docs/backlog.md` (A366: slice 4 built; delete
"For a non-default station with no hours, Hours says 'No hours restriction' and Prep stations…"
only if Part B removed its subject), `docs/backlog/kitchen.md` (`:84-92`, M), `docs/backlog/setup.md`
(`:174-176`, M: station hours and an unreadable zone), `docs/backlog/service-periods.md`.

- [x] Read every claim about station hours, fallbacks, "When closed, work goes to", closing a
  station and the Station hours page across `docs/developers/` and the backlog (`grep -rn -i "station hours\|fallback\|close for today\|manage/hours\|out of hours" docs/developers docs/backlog.md docs/backlog`),
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


#### B6 Calendar and server clock fixture retirement inventory (2026-10-10)

Approved B6/B7 remove the five station-hours/fallback tables. In
`packages/venue-service/src/hours-service-calendar.test.ts`, remove the old week/department-hour
fixture writes; keep all six cases and their Calendar/Named Days result assertions. Rename
the two case titles to describe the retained service-period checks.
In `apps/server/src/venue-details.test.ts`, remove the obsolete station-week seed and its two
stored-week snapshot fields, plus the fixture-only `[21, 3]` row-count assertion. Keep both daily
override and booking snapshots and all clock-change result assertions. In
`apps/server/src/working-order.test.ts`, remove the single old station-week seed and its import;
keep the unreadable-clock routing assertion. No fiscal, permission, money or root-guard assertion
changes. Before/after sources and the absence rehearsal live in Lane D's local
`receipts/a366-4b/calendar-server-fixtures/`.


#### B6 provisioning and management fixture retirement inventory (2026-10-10)

In `apps/server/src/provision.test.ts`, the mixed clear-fixture case keeps its named date,
stations, departments and location cleanup checks. Its old weekly/date station-cell seeds
and four retired-table counts leave under B6/B7. Rename it for the retained named-date cleanup.
In `apps/server/src/management-api.test.ts`, keep default switching, HTTP status, station
state, list, deactivation and named-date preservation checks in all three expanded cases.
Remove retired weekly writes/reads and their stored-Closed, stale-editor `station.always_open`,
unchanged-week and kept-week assertions. Those assert only the temporary fixture writer,
which B6 removes. Named dates keep their authored facts without station cells.

Before adaptation, run both full files in an independently installed checkout after dropping
the five retired tables, children first, before `useVenueDb` setup. In that disposable copy
only, remove the five entries from `clearProvisionFixture` as B7 will, so cleanup does not mask
the fixture failures. Repeat the adapted files under the same absence, retain exact sources
and changed-check inventory, and run deletion controls on the retained default and
named-date behaviors. This is a rehearsal for these consumers; B7 still owns schema deletion
and the complete upgrade walk. No login, fiscal, money or permission assertion changes.

#### B6 named-day route fixture retirement inventory (2026-10-10)

In `hours-routes.test.ts`, remove temporary station-week seeds/readbacks and direct
`special_date_hours` reads. Retire only their stored-week, unset-week and retained-cell
assertions; keep every route status, named-day field/preservation/refusal, permission,
participant rollback, clock and manual-closure assertion. Former station fields in HTTP
bodies remain as ignored-input controls. Rename descriptions that promise stored hours.

Before adaptation, run the full file in an independently installed checkout with the
five retired tables removed children-first before `useVenueDb` setup. Repeat the adapted
file under identical absence and record the retired assertions and retained statements.
Run deletion controls on the named-day authorization and participant rollback paths.
B7 still owns schema removal and the complete upgrade walk.


#### B6 remaining calendar fixture retirement inventory (2026-10-10)

The remaining `hours.test.ts` fixture checks leave with the station-week writer and the five
B7 tables. Retire the standard-week fixture suite, six cases that only call that writer,
and the case reading retained late station rows beside a repeating closure. Mixed cases keep
calendar saves, edits, ownership refusals, duplication, deletion, station states, holiday facts,
repeat keys, department/zone own-hours switching and participant rollback assertions. Remove
only the station-row snapshots and the `standardCell`, `specialCell` and `targetCells`
projections from those mixed checks. Calendar snapshots continue to read the actual stored
named-day fields. Two clock-change save cases also assert the dates read back.

`named-days.test.ts` removes the obsolete station-cell seed while keeping all its assertions.
The table-writing `testing/station-week.ts`, `legacy-station-week.ts` and
`legacy-station-rules.ts` fixtures and their package export leave after a caller scan. The
pure legacy wire types remain for tests that deliberately send ignored former fields.

The local before/after inventory records every removed or replaced assertion and renamed case
for the final PR's Changed test checks section. Test under five-table absence in an installed
disposable checkout, then delete the participant copy and before-delete calls separately;
the corresponding copy and delete/rollback cases must fail, and pass after restoration.
B7 still owns generated schema deletion, current migration/schema inventories, change-source
lists, the clear list and the route suite's stored-fallback case.


#### B7 generated retirement receipt (2026-10-10)

`0040_retire_station_hours_fallbacks.sql` is newly generated; both `*_periods` tables drop before
parents, then `station_fallbacks`. The referencing-key scan found only the two period children
in venue-service's historical `0021_hours_calendar.sql`. No shipped SQL or snapshot was edited.
The absence test failed with all five names before generation. Current schema/classification,
constraint inventories and provisioning cleanup omit those five tables. The old fallback-route
test keeps every 404 and routing snapshot check, dropping only its obsolete stored-fallback
seed and three storage assertions. The named-day detail test keeps all calendar and ownership
assertions; its temporary DROP/rollback wrapper is unnecessary after the migration.

The service-schema inventory removes the fallback table entry and changes its size from 16 to
15; migrations keep the surviving primary-key/foreign-key shapes and check `special_dates`
instead of the removed week-cell table. The package export test continues refusing all five
retired names. Current change-source lists derive from classification; the two query dependency
maps already omitted the retired tables. The populated upgrade walk passes; its
`carryRows` compares counts only for tables that still exist, so this receipt does not claim
that it detects a dropped table or validates row contents. No new RESETS entry was added.
The final PR retains its required "venue reset needed" first line.

B8 needs Part A's `routing-periods.ts` reader and period-aware routing selection, currently on
`feat/service-periods-slice-4-part-a`. Reconcile after that branch lands; do not duplicate its
reader or cherry-pick another lane's unlanded work. If migration numbering collides on rebase,
regenerate from the new main schema/journal and repeat the specified guards.

### Part B reconciliation and B8 checkpoint — 2026-10-10

Part A #1489 is on the branch's base. The reconciliation retains its station editor, period
choices and monitor tables. Station-hours retirement is regenerated as venue-service 0047;
core 0126 adds the retained-at-release flag. Reconciliation checks ran 1,704 node, 557 browser
and 213 server cases, the schema/upgrade/subscription suites (357) and unedited fiscal suites
(20); the five affected packages typechecked.

B8 adds `station-service-times.ts` and the read-only station service-times route. Its 26 reader
cases cover Lunch-only routing, own and repeating named days, zone subtraction and unions,
multiple departments, staff menus and parent routing for variants, overnight ranges, inactive
content, daily override/extension exclusion, venue isolation and the date bound. The route
cases check manager/supervisor reads, staff/anonymous refusals, invalid ranges and actual
non-default period ranges. `pnpm --filter @waitron/venue-service exec vitest run --project node`
ran 1,738 cases; affected-package types and focused lint/format passed. In an installed
throwaway checkout, removing the station's venue predicate failed its foreign-station case;
removing this route's read authorization failed its staff case (200 instead of 403). Restoring
both passed the two reader cases and seven route cases selected for those controls.

The dashboard Disable/send path also needs an audit representation for an authenticated manager
with no registered device. Core 0127 is a proposal: a nullable device foreign key and a CHECK
requiring a device or person. The former device-required schema case becomes a person-only
write plus refusal of a write naming neither actor. This proposal waits for the owner under the
campaign's controversial-test-change rule. It must be approved or revised before landing.

Remaining: B9, B12's full prose audit, B1/B2 cross-package qualification, final visual inspection,
two whole-branch Claude reviews, normal push hook and current-head CI. This checkpoint is not
ready for finish-branch.


### Part B station view checkpoint — 2026-10-10

B9 adds the read-only station picker and department/day grid. The planning reader accepts
`week=normal` to ignore named-day overrides for a normal week; dated requests retain their
previous behavior. This closes the normal-week half of decision 25, which B8's dated interface
did not represent. Station reads use the shared passive live/timed watcher. Changing the station
or week detaches the preceding read; default and switched-off stations show their status sentence.

The owner approved person-only dashboard move audits on 2026-10-10. Reconciliation with main's
core 0126–0130 regenerated the candidate as core 0131; it retains A455's hidden supervisor page
and removal of extras notes. Lane D's local `receipts/a366-4b/resume-owner/` holds the red/green
logs, fixture inventory, schema upgrade run and presentation captures. B12, B1/B2 qualification,
whole-branch review and current-head CI remain; this checkpoint is not branch readiness.


### Part B cross-package qualification — 2026-10-10

B12 audits the current developer docs and backlog prose and adds dated pointers to historical
plans and specs, preserving their original bodies. B1/B2 qualification ran the venue-service
node project (1,748 cases), affected venue-service browser suites (866), server suites (1,163),
till suites (411), and the unedited fiscal pair (20). After rebasing onto A414, the affected till
screens and phone checks ran 292 cases and the dashboard folder/navigation files ran 62.

Two inherited fixtures needed the intentional contract carried forward: the folder's period-line
case now supplies the active default instead of a configured fallback, retaining its result
assertion; the navigation whole-shape pin gains the station child while retaining its other keys.
The original runs failed at those assertions; the corrected files pass. Both changes belong in
the final PR's Changed test checks list.

Current captures inspected include the read-only station Week view's six states, the Stations
list and editor, routing/settings, the till close dialog and the Disable dialog, in English and
Spanish, light and dark, at phone and desktop widths. The final Disable capture run also ran
12 accessibility cases; temporary screenshot instrumentation was restored byte for byte. Old
Tickets-tab and Rename captures in the same folders are excluded from final visual evidence.
The Opening hours tab-strip points still tracked in the backlog are not closed by
these captures. Lane D keeps the command logs and image inventory locally under
`receipts/a366-4b/qualification/`.

Two whole-branch Claude run-it reviews, accepted fixes, the normal push hook, current-head CI
and authorised landing remain. No CI or branch-readiness claim follows from local qualification.


### Review qualification note — 2026-10-10

The earlier B7/B8 checkpoints name migrations before regeneration; their current replacements
are venue-service `0047_retire_station_hours_fallbacks.sql` and core
`0131_station_retention_and_dashboard_moves.sql`. Their reset-warning instructions are superseded:
the populated upgrade walk passes without a reset entry, so Tasks B7/B12's conditional rule
selects "no venue reset needed — station hours and fallbacks are deleted" for the PR's first line.
That result counts surviving synthetic rows; it does not compare every stored value or promise
that deleted settings can be recovered.


### Part B review outcomes — 2026-10-10

Both required Claude run-it reviews completed in independent installed candidates (565 and
560 seconds). Review qualification corrected the remaining import/seed checks that queried
retired tables, added device/person move-audit and passive-read assertions, and removed the
remaining fallback wire field and unused status text. The wire absence test failed before the
field removal. Adversarial retired inputs remain in test-only fixture types.

A browser test reproduced the read-only station view retaining old times after a same-element
reattach with unchanged properties. Requesting an update on connection restarts its read.
Affected server cases pass 145, node cases 315, view/client/accessibility cases 27, and the final
client/view files 22. Removing actor identities, passive activity or menu-table subscriptions in
a disposable candidate fails the added checks. A two-order Disable probe with a trigger refusing
the second audit insert rolled back the station change, both ticket changes and the first audit
row; a migrated-schema probe found no foreign key into the rebuilt audit table.

The upgrade walk still compares row counts rather than every stored value. The backlog keeps a
specific comparison to run between the planning reader and live routing for an own-hours named
day without a zone override. Normal push-hook validation, current-head CI and landing remain.
