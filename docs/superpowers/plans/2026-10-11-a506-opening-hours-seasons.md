# Opening hours rebuilt around seasons and special days — implementation plan (A506)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Every task is test-first: write the failing behavioural test, run it,
> watch it fail for the reason the step states, then write the smallest code that passes.

**Status:** plan, 2026-10-11. Not started. Nothing here is built.

**Spec:** [Opening hours rebuilt around seasons and special days](../specs/2026-10-11-opening-hours-seasons-design.md)
(A506). The spec is the source of truth; each task names the spec section it builds. Mockups:
[`docs/backlog/mockups/a506-opening-hours-seasons/`](../../backlog/mockups/a506-opening-hours-seasons/).
Backlog: `docs/backlog.md` (the A506 entry) and
[`docs/backlog/service-periods.md`](../../backlog/service-periods.md#a506-opening-hours-rebuilt-around-seasons-and-special-days).

**Audited base.** Every pointer below was READ on main `1f321faa8` (2026-10-11); none was run.
Pointers name files and functions, never line numbers, because lane D's A495 is rewriting the same
files (see the gate below). Pointers into A495 were read on its unpushed local branch
`feat/a495-business-day-history` at `3c7f8bfc1` (its spec
`docs/superpowers/specs/2026-10-11-a495-business-day-history-design.md` and its new files); that work
has not landed and may change.

**Goal:** a venue's hours become four (or more) repeating seasons, each with its own week per
department and zone, with special days painted over the season a stretch at a time; the till sells
what the season-then-special-day resolver says; the Opening hours page opens on a year, has a month
view and two full-screen painters; periods get their own page; prep stations get a Times view.

**Architecture:** seven new venue-service tables in their final shape land in the first pull request
(`seasons`, `special_days`, `special_day_dates`, `department_days`, `department_day_ranges`,
`zone_days`, `zone_day_ranges`). One server function family, the day resolver
(`packages/venue-service/src/day-resolver.ts`), works out a department's and a zone's day; every
reader in spec section 12 moves onto it, PR by PR. The old week rows are written beside the new
ones while the server readers move (write both, then stop writing the old — the pattern A366 slice 6
used for its service-style columns), and the old tables (`menu_day_timetables`, `menu_slots`,
`zone_closed_times`, `special_dates`) are dropped once special days replace named days. Browser-safe
rules (which season a date is in; laying paint over a season) live in small pure files the dashboard
may import for drawing, never for deciding what is open.

**Tech stack:** TypeScript, drizzle on SQLite (`node:sqlite`), Hono routes, Lit, Vitest (node
project and real-Chromium browser project).

---

## Three owner questions — answered 2026-10-11 (lane A `questions.md`, ~22:45 and ~22:50)

**Answers, written into the spec and this plan by A506-4 (2026-10-12):** question 1 — the default
(nothing changes). Question 2 — **(b): "Every year" follows the holiday's official name, and the
venue is warned when a year's list has no holiday of that name** (spec §5). A506-4 builds the
same-month-and-day repeat, which stays the rule for a date that is not a public holiday; A506-5
adds `special_day_dates.holiday_name` in its migration and makes a repeating holiday date follow
the name (Task 5.1b); A506-6's year view and A506-5's readiness line show the warning; the
dialog's and painter's note changes (Tasks 5.3, 9.3). Question 3 — **(c): a fourth Prep stations
tab, "Times", with a station picker** (spec §9; Task 12.2 rewritten). The table below is the
question as it was put.

The spec's section 16 put three defaults to the owner (lane A `questions.md`, heading
"A506 — spec written (main 1f321faa8): three defaults for you to confirm or change (2026-10-11
20:10)"). The default is built unless the owner has answered otherwise. Before starting a PR named
below, read that heading and anything under it.

| # | Question | Default built | PRs it changes |
| --- | --- | --- | --- |
| 1 | Can a venue add and remove seasons? | Yes: "+ Season" copies the weeks of the season it splits; deleting gives the days to the season before; one always remains. | A506-6 (server and year view). Answer (b) "exactly four": drop `addSeason`/`deleteSeason` and their routes and UI from A506-6. Answer (c) "new season starts empty": `addSeason` copies nothing. |
| 2 | "Every year" on a public holiday's special day | Repeats the same date. The spec's note "beside the switch on a moving holiday" cannot be targeted: only 2026's list ships (`packages/country-es/src/data/es-2026.ts`) and its rows carry no mark saying a holiday moves. So the plan's rule: the note shows beside "Every year" on EVERY special day that holds a public-holiday date: "Every year repeats this date; a holiday that moves needs next year's date added." | A506-5 (the special-day dialog's note) and A506-9 (the painter's note). Answer (c) "hide it": hide the switch on public-holiday dates instead of the note. Answer (b) needs a spec change — STOP and ask. |
| 3 | Where prep station times live | "Times" in the station's row menu opens a full month page. | A506-12 only. Answer (b) or (c) changes that PR's UI task. |

---

## The pull requests

Every PR leaves `main` green and the product working on its own. A PR is not started until the
same-files gate below is clear for its files.

| PR | Title | Depends on | Files touched, in outline | Review path | Migration |
| --- | --- | --- | --- | --- | --- |
| **A506-1** | Seasons are stored and the till reads the season of the business day | A495 and A435-6 landed | `schema/seasons.ts` (new), `season-rules.ts` (new), `seasons.ts` (new), `season-weeks.ts` (new), `day-resolver.ts` (new), `menu-timetable.ts`, `zone-closed-times.ts`, `provisioning.ts`, `classification.ts`, `configuration-transfer.ts`, `dashboard/live-queries.ts`, A435-6's `service-delete-settings.ts` and `dashboard/service-delete-copy.ts`, `department-receipts.upgrade.test.ts`; `apps/server` till tests, `clear-provision-fixture.ts`; `scripts/schema-constraints.test.ts`, `scripts/migration-upgrade.test.ts` | FULL (storage, migration, sale path, the contract's `resolveDepartmentService`/`closedZoneIdsAt`/`routingAt` behaviour) | **Yes** — venue reset |
| **A506-2** | The server's other readers read seasons | A506-1 | `menu-timetable.ts` (`readOpeningHoursModel`, `endOffsetClash`), `menu-timetable-types.ts`, `period-end-offset.ts`, `hours.ts` (`calendarDays`, `switchNamedDayHours`), `station-service-times.ts`, `routing-periods.ts` (`inPeriodOrder`), `operations.ts` (`listVenueReadiness`), `configuration-transfer.ts` (season end offsets on import), A495's `business-day-schedule.ts`, `packages/module/src/module.ts` (`BusinessDayClockConflict` gains `seasonId`), `apps/server/src/setup-opening-hours.ts`, `apps/dashboard/src/api/live-queries.ts`, fixture moves in `apps/server/scripts/demo-seed/seed.test.ts`, `apps/server/src/provision.test.ts`, `apps/server/src/testing-zone-offers.test.ts` | FULL (end-offset check the till relies on; period order; readiness; cross-package type) | No |
| **A506-3** | The dashboard reads seasons; the Week tab gets a season picker | A506-2; A493 and A435-6 landed if they touch `department-zones.ts` | `routes.ts` (week routes take `seasonId`), `opening-hours-client.ts`, `opening-hours-screen.ts`, `opening-hours-week.ts`, `opening-hours-zone-week.ts`, `opening-hours-all.ts`, `opening-hours-day.ts`, `real-week.ts`, `department-zones.ts` (zone summary), `menu-timetable-types.ts`, `strings.ts`, `apps/dashboard/src/navigation.ts` | FULL (the week routes now write one season, which the till reads) | No |
| **A506-4** | Special days on the server, painted over the season | A506-3 | `special-days.ts` (new), `day-paint.ts` (new), `day-resolver.ts`, `period-end-offset.ts`, `menu-timetable.ts` (`endOffsetClash`), `hours.ts` (bridge refusal), A495's `business-day-schedule.ts`, `packages/module/src/module.ts` (`BusinessDayClockConflict` gains `specialDayId`), `routes.ts`, `errors.ts`, `configuration-transfer.ts`, `dashboard/live-queries.ts` | FULL (sale path, cross-package contract) | No (tables exist since A506-1) |
| **A506-5** | The Calendar edits special days; named days and the old tables go | A506-4 | `hours.ts`, `named-days.ts`, `holidays.ts`, `named-day-rules.ts` → `repeat-rules.ts` (with `named-day-rules.test.ts` → `repeat-rules.test.ts` and its importers `hours-rules.ts`, `hours-types.ts`, `holiday-types.ts`, `special-days.ts`, `day-paint.ts`), `calendar-participants.ts`, `menu-timetable.ts`, `zone-closed-times.ts`, `station-service-times.ts`, `routes.ts`, `index.ts`, `errors.ts`, `schema/hours.ts`, `schema/menus.ts`, `schema/zone-closed-times.ts`, `classification.ts`, `configuration-transfer.ts`, `service-delete-settings.ts`, A495's `business-day-schedule.ts`, `packages/module/src/module.ts` (`specialDateId` leaves `BusinessDayClockConflict`), dashboard `hours-calendar.ts`, `named-day-editor.ts`, `named-day-copy.ts`, `named-days-client.ts`, `opening-hours-day.ts`, `opening-hours-week.ts`, `opening-hours-zone-week.ts`, `opening-hours-all.ts`, `real-week.ts`, `strings.ts`, both live-query lists, demo seed, `clear-provision-fixture.ts`, `apps/server/src/testing-zone-offers.test.ts`, `scripts/schema-constraints.test.ts`, `scripts/migration-upgrade.test.ts` | FULL (storage, migration, sale path, cross-package type) | **Yes** — venue reset |
| **A506-6** | Seasons can be edited; Opening hours opens on the year | A506-5 | `seasons.ts`, `season-rules.ts`, `opening-hours-calendar.ts` (new server read), `routes.ts`, `errors.ts`, dashboard `opening-hours-year.ts` (new), `season-chips.ts` (new), `season-dialog.ts` (new), `opening-hours-screen.ts`, `hours-calendar.ts` (removed), `strings.ts`, `apps/setup/src/screens/done-screen.ts`, `apps/dashboard/src/navigation.ts` | FULL (moving a season's start changes what the till sells from the next request) | No |
| **A506-7** | The month view replaces the Day tab and the Real week switch | A506-6 | `opening-hours-calendar.ts` (month read), `routes.ts`, dashboard `opening-hours-month.ts` (new), `ordinary-date-dialog.ts` (new), `opening-hours-screen.ts`, `opening-hours-week.ts`, `opening-hours-zone-week.ts`, `opening-hours-all.ts`, `opening-hours-station.ts` (its dated-column mode removed), `real-week.ts` (removed), `strings.ts` | LIGHT (read-only server route; dashboard only) | No |
| **A506-8** | The paint grid and the season painter replace the Week tab | A506-7 | `paint-model.ts` (new, browser-safe), `season-weeks.ts` (`saveSeasonWeeks`), `routes.ts`, dashboard `paint-grid.ts` (new), `painter-frame.ts` (new), `season-painter.ts` (new), `opening-hours-screen.ts`, `opening-hours-week.ts` and `opening-hours-zone-week.ts` (removed), `service-grid.ts`, `zone-edit-dialog.ts` (link; the summary is `zone-closed-week.ts`), `strings.ts` | FULL (a new route writing every edited department's and zone's season week in one transaction) | No |
| **A506-9** | The special-day painter; refusals beside Save; links re-pointed | A506-8 | `opening-hours-calendar.ts` (season-days read), `routes.ts`, dashboard `special-day-painter.ts` (new), `add-dates-calendar.ts` (new), `opening-hours-screen.ts`, `opening-hours-month.ts`, `opening-hours-year.ts`, `ordinary-date-dialog.ts`, `opening-hours-day.ts` and `special-day-dialog.ts` (removed), `department-page.ts`, `departments-list.ts`, `strings.ts` | LIGHT (uses A506-4's save route unchanged) | No |
| **A506-10** | Deleting a period with a replacement; where a period is painted | A506-9 | `period-delete.ts` (new), `menu-timetable.ts`, `routes.ts`, `errors.ts` | FULL (rewrites painted hours, routing lines and today's extension the till reads) | No |
| **A506-11** | The Periods page and the period dialog | A506-10; A493 landed (grouping pattern) | dashboard `periods-screen.ts` (new), `period-dialog.ts` (new), `period-delete-dialog.ts` (new), `period-editor.ts` (removed), `index.ts`, `opening-hours-screen.ts` (Periods tab removed), `season-painter.ts`, `special-day-painter.ts`, `department-page.ts`, `departments-list.ts`, `routes.ts` and `menu-timetable.ts` (old DELETE and `menu_period.in_use` retired), `errors.ts`, `strings.ts`, `apps/dashboard/src/navigation.ts` | FULL (the dashboard switches to the delete route that rewrites painted hours, routing lines and today's extension) | No |
| **A506-12** | Prep station Times; the last of the old tabs goes | A506-11; **A507 landed** | `station-service-times.ts`, `routes.ts`, dashboard `station-times-screen.ts` (new), `station-table.ts`, `prep-stations-screen.ts`, `opening-hours-station.ts` and `opening-hours-all.ts` (removed, with the read-only `view=week&station=` and `view=week&department=all` views A506-8 keeps), `service-grid.ts` (removed if unused), `opening-hours-screen.ts`, `opening-hours-client.ts`, `strings.ts`; backlog entries deleted | LIGHT (read-only) | No |

All `packages/venue-service/src/` paths are shortened to the file name. "FULL" means per-task
reviews plus the full `/finish-branch` wave with two run-it reviews (global CLAUDE.md, risk
triggers); "LIGHT" means no per-task reviewer, and `/finish-branch`'s plan-vs-spec read and Codex
run-it seat still run.

**Backlog.** Each PR before the last adds one progress line under the A506 section of
`docs/backlog/service-periods.md` ("A506-n landed in #NNNN: …"). The PR that lands LAST (A506-12,
unless A507 holds it back and A506-11 lands last) deletes the A506 entry from `docs/backlog.md` and
its detail section, moving any decision a comment or doc cites to that file's
`## Decisions and deliberate limits`, and turns each point left open into its own short entry.

### The same-files gate (run before starting each PR, and again before `/finish-branch`)

Other lanes are changing these files now. For each branch below that has not landed, compare its
changed files with the PR's file list; any overlap means wait for it to land, then rebase.

```bash
cd /Users/clintongormley/workspace/repos/waitron && git fetch origin
for b in feat/a495-business-day-history feat/a494-venue-settings-page \
         $(git branch -a --format='%(refname:short)' | rg -i 'a507|a493|a435-6|a504'); do
  echo "== $b"; git diff --name-only main...$b 2>/dev/null
done
```

- **A495** (`feat/a495-business-day-history`, lane D) changes `menu-timetable.ts`,
  `zone-closed-times.ts`, `hours.ts`, `named-days.ts`, `holidays.ts`, `routes.ts`, `keep-open.ts`,
  `station-service-times.ts`, `period-end-offset.ts`, `service-day.ts` and adds
  `service-day-context.ts` and `business-day-schedule.ts` (`git diff --stat main...feat/a495-business-day-history`,
  read 2026-10-11). **No A506 PR starts until A495 has landed.**
- **A494** changes `apps/server/src/venue-details.ts` (the caller of `assertPeriodEndOffsets`) and
  `docs/backlog/service-periods.md`. No A506 PR edits `venue-details.ts`; rebase over it for the
  backlog file.
- **A435 step 6** (`feat/a435-6-service-delete`, lane E; read at `9917d0d26`) adds
  `service-delete-settings.ts` and `service-delete.ts`, which on deleting a department delete
  `menu_slots`, then `menu_day_timetables`, then `menu_periods`, before the department is marked
  inactive (`clearServiceDeleteSettings`; departments are never deleted — `remove()` in
  `service-delete.ts` sets `active: false`, so nothing cascades from the department row), and count `timetables` and `slots` in the delete impact. It also
  changes `menu-timetable.ts`, `zone-closed-times.ts`, `provisioning.ts`, `configuration-transfer.ts`,
  `dashboard/live-queries.ts`, `department-page.ts` and `routes.ts`, and adds venue-service migration
  `0049`. **A506-1 does not start until A435-6 has landed** (A506-1's new ranges point at
  `menu_periods` with no delete rule, so A435-6's delete order would fail on a painted department —
  Task 1.7 fixes that on top of the landed code).
- **A493** changes the Departments and zones screens (`department-zones.ts`, `departments-list.ts`,
  `department-page.ts`); A506-3, A506-8, A506-9 and A506-11 wait for it.
- **A507** (lane C, no branch yet on 2026-10-11) rebuilds the Prep stations page
  (`station-table.ts`, `prep-stations-screen.ts`); A506-12 waits for it to land and builds on it.

### How each PR is worked

- **Re-check on the base (the first step of every PR).** On the current `main`, re-run the
  follow-the-call-chain search of spec section 12 and diff its result against this PR's file list:

  ```bash
  rg -n 'menuDayTimetables|menuSlots|zoneClosedTimes|specialDates|departmentDays|departmentDayRanges|zoneDays|zoneDayRanges|specialDays|specialDayDates|seasons\b' packages apps scripts --glob '!**/drizzle/**'
  # raw SQL and table-name lists (fixtures, live queries, seeds) that the camelCase search misses
  rg -n 'menu_slots|menu_day_timetables|zone_closed_times|special_dates|department_days|department_day_ranges|zone_days|zone_day_ranges|special_day_dates|special_days' packages apps scripts --glob '!**/drizzle/**'
  rg -n 'departmentDay\b|zoneClosureDay|closedZoneIdsAt|namedDaysOn|readOpeningHoursModel|readCalendarDays|readNamedDaysModel|stationServiceTimes|inPeriodOrder|endOffsetClash|findScheduleEndOffsetClash|businessDayClockConflicts|placeOpenPeriod|replaceMenuWeek|replaceZoneClosedWeek|resolveDepartmentDays|resolveZoneClosedDays' packages apps --glob '!**/*.test.*'
  ```

  Follow each hit's callers up to an entry point (a route in `routes.ts` or `apps/server`, a seat of
  `VENUE_SERVICE` in `service.ts`, a seed, a provisioning step). A caller this plan does not name
  is added to the PR's task that owns its file, and listed in the PR description under "Readers
  found on the base". Then read what A495 landed: `packages/venue-service/src/service-day-context.ts`
  (`serviceDayContext`, `serviceDayWallContext`), `service-day.ts` (`serviceMomentAt` now takes a
  `BusinessDayClock`; `rangeSpanInDay`, `clockTimeSkippedInDay`), `business-day-schedule.ts`
  (`businessDayClockConflicts`, `assertBusinessDayScheduleWrite`, `expectedClockRevision`). Where
  this plan writes `cutover`, use the day's own `serviceDayContext(clock, day)`.
- **The clock revision is never optional.** A495 (branch head `eee0f0128`) makes
  `expectedClockRevision: number` a required argument of `replaceMenuWeek(tx, cfg, departmentId,
  days, at, expectedClockRevision)`, `replaceZoneClosedWeek(tx, cfg, zoneId, days,
  expectedClockRevision, at)`, `saveMenuPeriod` and `updateMenuPeriod`, and its week, period and
  special-date routes read it from the body. So EVERY time-affecting write this plan adds takes
  `expectedClockRevision: number` as a required argument, calls A495's
  `assertBusinessDayScheduleWrite` inside the transaction, and its route lists `"expectedClockRevision"`
  in `onlyKeys` and requires it: season weeks (`replaceMenuWeek`/`replaceZoneClosedWeek` with a
  season, `saveSeasonWeeks`), special days (`saveSpecialDay`, `deleteSpecialDay`), seasons
  (`saveSeason`, `addSeason`, `deleteSeason`) and period deletion (`deletePeriod`). In-process
  writers with no client draft (`placeOpenPeriod`, provisioning, seeds) pass the revision they read
  inside their own transaction, as A495 does for its own internal writers. The dashboard sends the
  revision from the model it loaded. Each interface below names the argument.
- **Existing assertions.** The campaign rule (`~/waitron-campaign/RUNNER.md`, owner 2026-09-27)
  holds: a test that must be EDITED to pass is a STOP, except for (a) a check pinning behaviour the
  PR's "Behaviour this PR removes" list names, which is changed to check the new behaviour at least as
  strictly, in a separate commit whose message begins `Changed test checks (A506-n):` listing each
  `file` and test name with its before and after, repeated in the PR under "Changed test checks";
  (b) adding what a fixture lacks (a season, a seeded row, a key a whole-shape pin gains). Anything
  else is reported, not edited.
- **Guards under `scripts/`.** Each change to a guard file is marked **ASK** below, with the exact
  diff and one plain sentence on what the guard checks after the change and why. Before the PR lands, write the diff into lane A's `~/waitron-campaign/questions.md` under a
  heading naming the PR, and land only after the owner's answer. The one standing exception
  (owner rule of 2026-10-11 in lane A's queue): `scripts/migration-upgrade.test.ts` may gain
  `CANDIDATES` sample values for new tables and columns without asking.
- **Green between tasks.** Run the task's focused files and read the `Tests` count (a run with no
  count proves nothing). Check headroom first (`memory_pressure | rg free`). Commands:
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/<file>`,
  `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/<file>`,
  `pnpm --filter @waitron/server exec vitest run src/<file>`,
  `pnpm exec vitest run scripts/<guard>.test.ts`. Package suites and coverage are CI's.
- **Guard suites per change.** A schema change runs `scripts/schema-constraints.test.ts
  scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts
  scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts
  scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts
  scripts/journal-monotonic.test.ts scripts/id-columns-are-references.test.ts
  scripts/module-graph-honesty.test.ts`. A new or retired error code runs `scripts/alert-codes.test.ts
  scripts/errors-reachable.test.ts`. A changed live-query list runs `scripts/live-subscriptions.test.ts`.
  A new form field runs `scripts/native-form-fields.test.ts`; new styles run
  `packages/ui/src/no-hardcoded-chrome.test.ts` (via `pnpm --filter @waitron/ui exec vitest run
  src/no-hardcoded-chrome.test.ts`) and `scripts/style-token-names.test.ts`.
- **LOOK.** Every task that changes a screen ends with one LOOK: the dev stack from the worktree
  (`wa-wt demo <worktree-name>`; after a migration PR first `wa-wt reset demo <worktree-name>`,
  checking venue holders with `lsof` on the venue folder and port 8080 first), the workspace's
  Playwright Chromium, screenshots in EN and ES, light and dark, at 1280 and 390 px wide, saved to
  `~/waitron-campaign/a506-<n>-shots/` (outside the tree). Name what you looked at in the PR.
- **Migrations.** Numbers come from `pnpm --filter @waitron/venue-service db:generate`; never type
  one. Read the generated SQL before committing. A number clash on rebase is fixed by resetting
  `packages/venue-service/drizzle/` to main's and regenerating — never by editing a snapshot or
  `_journal.json` — then running the schema guard list above plus
  `packages/fiscal-verifactu/src/inmutabilidad.test.ts`. A PR with a migration opens its description
  with **"venue reset needed — required: …"** and rebuilds the demo venue with `wa-wt reset demo`.
- **Product text** is as short as the meaning allows, EN and ES in
  `packages/venue-service/src/dashboard/strings.ts`, and says "variants", never "sizes".

---

## Global constraints (copied from the spec)

- Business day: changeover to changeover (`locations.day_cutover`, 06:00 by default); a date's
  season is decided by its BUSINESS day, never the clock date (§4).
- Default seasons, created by provisioning for every venue: Winter from `12-01`, Spring `03-01`,
  Summer `06-01`, Autumn `09-01` (§4, §11). A season is a name and a start (`MM-DD`, never `02-29`);
  it ends the day before the next start; seasons always cover the whole year.
- Paint is a range on one day in 15-minute steps naming a period or Closed; unpainted time in a
  season week is closed; there is no fallback period (§3, §6).
- A special day stores only its own paint, never a copy of the season; the season shows through
  unpainted time (§5). The Closed tick is one per date and closes the whole venue, every department
  and zone, including one added later (§5).
- A date belongs to at most one special day; a repeating special day covers its first year and
  later ones, never earlier; a repeating 29 February applies in leap years only (§5).
- Touching stretches of the same period are stored and drawn as one block (§6 step 5, §10.3).
- A range cannot cross the changeover; an end equal to the changeover is the full day (§6).
- Skipped clock times are refused on save for dated days only (special-day dates, keep-open,
  import), never for a season week (§6).
- New error codes: `season.invalid`, `season.not_found`, `special_day.invalid`,
  `special_day.not_found`, `special_day.date_taken`. Retired: `special_date.date_taken`,
  `special_date.keeps_week`, `special_date.not_found`, `menu_period.in_use` (§13).
- Routes stay under today's Opening hours permissions: writes through `gated`
  (`MANAGE_VENUE_SERVICE`, `"venue_service.manage"`, `permissions.ts`), reads through `viewed`
  (`"venue.view"`), both defined in `VENUE_SERVICE_ROUTES.mount` (`routes.ts`).
- Forms follow A331: `draftScopeFor` and `saveActionState` (`packages/ui/src/leave-controller.ts`),
  Save quiet and disabled until the draft changes, an early return in the save handler; a button that
  is not a save is quiet until it can act (CLAUDE.md §3).
- Every new or changed screen: LOOK in EN/ES, both themes, 390 and 1280 px (§14).

## Decisions this plan makes that the spec does not

1. **All seven new tables land in A506-1, in their final shape**, including the special-day tables
   nothing writes until A506-4. `department_days` and `zone_days` must reference
   `special_day_dates`; adding that column later would make drizzle rebuild `department_days`, and a
   rebuild's `DROP TABLE` with foreign keys on deletes every cascading child's rows (CLAUDE.md §3:
   "A drizzle table rebuild on this engine runs with foreign keys ON…"). Creating them once avoids
   the rebuild.
2. **Write both, then stop writing the old (A506-1 → A506-2).** In A506-1 a week save with no season
   named (today's routes, `placeOpenPeriod`, seeds, tests) writes the same week into every season AND
   the old weekday rows, so every reader not yet moved still reads the right hours. No route can
   write one season until A506-3. A506-2 moves the remaining server readers and stops writing the
   old weekday rows. The old tables keep only named-day rows until A506-5 drops them.
3. **`ensureDefaultSeasons` runs in every week writer, not only in provisioning.** Many suites
   (`useVenueDb` plus `seedNode`) never run provisioning; without seasons a week save would write
   nothing and the venue would be closed. The writer creates the four defaults when a location has
   none, exactly once. Provisioning calls it too, which is the spec's "unconditionally".
4. **Default season names are English** ("Winter", "Spring", "Summer", "Autumn"), as provisioning's
   other seeded names are (`VENUE_SERVICE_PROVISIONING` names the zone "Counter";
   `placeOpenPeriod` names the period "Open"). A venue renames them in A506-6.
5. **Special days run beside named days for one PR (A506-4).** A506-4 adds the special-day server and
   resolver while the Calendar still edits named days; each refuses a date the other holds
   (`special_day.date_taken` and `special_date.date_taken`), so the two never meet on a date. A506-5
   removes named days and the cross-check together.
6. **A special-day save replaces paint per (department, date) and (zone, date)**, the finest grain
   the spec's "a department's or zone's paint is replaced only when the draft edited it" allows.
7. **The per-date hours editor survives until its painter lands.** A506-5 keeps the Day tab's date
   editor working on special days by turning an edited day into paint (`paintFromEdit`, the
   smallest paint that turns the season's day into the edited one, so the season still shows
   through); A506-7 removes the Day TAB but keeps that editor reachable from the month view; A506-9
   replaces it with the special-day painter. Otherwise a venue could not change a date's hours
   between A506-7 and A506-9.
8. **The painters' full screen is a module-local frame** (`painter-frame.ts`, a native `<dialog>`
   opened with `showModal()`, which covers the dashboard's banner and side menu), not a new `wt-*`
   primitive and not a dashboard-shell change. If an implementer finds a shared primitive is
   needed, it gets its token-painting test and its `*.a11y.test.ts` in both themes (CLAUDE.md §3).
9. **Deleting a period with a replacement gets a new route first** (A506-10,
   `POST …/menu-periods/:periodId/delete`), while today's `DELETE` keeps refusing `menu_period.in_use`
   until the Periods page uses the new route (A506-11), so the old Periods tab never deletes a
   painted period without its warning.
10. **Range-shape refusals keep their codes on the week routes**: season weeks still refuse with
    `menu_timetable.invalid` (`parseServiceDay`) and zone weeks with `zone_closed_time.invalid`
    (`parseClosedRanges`), so both stay (§13 lets the plan decide). The special-day route refuses
    with `special_day.invalid`. `hours.invalid` is retired in A506-5 if `errors-reachable` shows no
    throw site left.
11. **Seasons are ordered by `starts_on`** everywhere they are listed.
12. **The station view and the All departments view outlive the Week tab.** Both live inside the
    Week tab today (`view=week&station=…` and `view=week&department=all`, handled in
    `opening-hours-screen.ts`'s picker code; the station link is in `station-table.ts`). A506-8
    removes the Week tab's editing but keeps those two read-only views rendering at the same
    addresses until A506-12 replaces them (A506-12 waits for A507).
13. **Department deletion clears season days before periods.** Once A435-6 has landed, its
    department delete removes old timetable rows before `menu_periods`, before the department is
    marked inactive (departments are never deleted, so the `department_days` cascade on the
    department never fires); A506-1 makes it remove
    `department_day_ranges` and `department_days` (and `zone_days`, `zone_day_ranges`) first too,
    and counts them in the delete impact; A506-5 removes the old `timetables` and `slots` counts.

## Review focus

The five cases the spec implies but no slice states, most likely to bite first; each has its test
in the task named.

1. **Deleting a period painted in a season week before A506-10.** It must still answer
   `menu_period.in_use`, not a raw foreign-key error (the new ranges reference the period without
   cascade). Test: A506-1 Task 1.3. The same key makes deleting a painted department fail unless
   its day rows go first: A506-1 Task 1.7.
2. **Importing a configuration bundle** must leave exactly the exported seasons, not the exported
   ones plus four defaults from `ensureDefaultSeasons`. Test: A506-1 Task 1.6.
3. **A clock that cannot be read** keeps today's behaviour (`resolveDepartmentService` opens every
   period's menus when `serviceMomentAt` is null); the resolver must not turn it into "closed".
   Test: A506-1 Task 1.5.
4. **A special-day save naming a department or zone that no longer exists** (another manager
   deleted it) is refused by code and writes nothing, the draft kept. Test: A506-4 Task 4.3.
5. **Deleting a period with a replacement whose end offset clashes** where the deleted one did not
   is refused by code with nothing changed. Test: A506-10 Task 10.2.

---

# A506-1 — Seasons are stored and the till reads the season of the business day

**Spec:** §4 (seasons), §6 steps 1–3 and "the day before", §11 (storage), §12 rows for the sale
path, `placeOpenPeriod`, configuration transfer, demo seed, `clear-provision-fixture.ts`,
`schema-constraints`, live queries, §14 (the 2030 test and the till-route test), §15 slice 1.

**Review path:** FULL. **Migration:** yes. PR first line: **"venue reset needed — required: a
venue's week now lives in seasons; a box upgraded without a reset has no seasons and is closed
until reset."**

**Behaviour this PR removes:** none visible. A week saved through today's routes now also lands in
every season; the till reads the season week.

### Task 1.0: Re-check on the base

- [ ] Run the gate and the re-check of "How each PR is worked". Confirm A495 has landed. Record in
  the PR description which A495 names the resolver uses (expected from its branch:
  `serviceDayContext(clock, day)` and `serviceMomentAt(at, clock: BusinessDayClock)`).

### Task 1.1: The seven tables (migration, add only)

**Files:**
- Create: `packages/venue-service/src/schema/seasons.ts`
- Modify: `schema/index.ts`, `classification.ts`, `classification.test.ts`, `migrations.test.ts`
  (its table list); the guards are Task 1.1b's
- Create (generated): `packages/venue-service/drizzle/<n>_*.sql`, `meta/<n>_snapshot.json`, journal entry

**Interfaces — produces** (all exported from `schema/index.ts`):

```ts
// packages/venue-service/src/schema/seasons.ts
import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, day, enumCheck, enumType, flag, id, label, locations, newId, table, timeOfDay } from "@waitron/db";
import { menuPeriods } from "./menus.js";
import { departments, zoneServicePolicies } from "./service.js";

export const ZONE_PAINT_KINDS = ["closed", "open"] as const;

export const seasons = table("seasons", {
  id: id("id").primaryKey().$defaultFn(newId),
  locationId: id("location_id").notNull(),
  name: label("name").notNull(),
  startsOn: label("starts_on").notNull(), // MM-DD
}, (t) => [
  foreignKey({ columns: [t.locationId], foreignColumns: [locations.id], name: "seasons_location_fk" }),
  uniqueIndex("seasons_location_starts_key").on(t.locationId, t.startsOn),
  uniqueIndex("seasons_location_name_key").on(t.locationId, t.name),
  check("seasons_name_ck", sql`trim(${t.name}) <> ''`),
  check("seasons_starts_on_ck",
    sql`${t.startsOn} glob '[01][0-9]-[0-3][0-9]' and ${t.startsOn} <> '02-29'`),
]);

export const specialDays = table("special_days", {
  id: id("id").primaryKey().$defaultFn(newId),
  locationId: id("location_id").notNull(),
  name: label("name").notNull(),
  repeatsYearly: flag("repeats_yearly").notNull().default(false),
}, (t) => [
  foreignKey({ columns: [t.locationId], foreignColumns: [locations.id], name: "special_days_location_fk" }),
  check("special_days_name_ck", sql`trim(${t.name}) <> ''`),
]);

export const specialDayDates = table("special_day_dates", {
  id: id("id").primaryKey().$defaultFn(newId),
  specialDayId: id("special_day_id").notNull(),
  locationId: id("location_id").notNull(),
  date: day("date").notNull(),
  closedAllDay: flag("closed_all_day").notNull().default(false),
}, (t) => [
  foreignKey({ columns: [t.specialDayId], foreignColumns: [specialDays.id],
    name: "special_day_dates_day_fk" }).onDelete("cascade"),
  foreignKey({ columns: [t.locationId], foreignColumns: [locations.id],
    name: "special_day_dates_location_fk" }),
  uniqueIndex("special_day_dates_location_date_key").on(t.locationId, t.date),
  check("special_day_dates_date_ck",
    sql`${t.date} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
]);

export const departmentDays = table("department_days", {
  id: id("id").primaryKey().$defaultFn(newId),
  departmentId: id("department_id").notNull(),
  seasonId: id("season_id"),
  weekday: count("weekday"), // 0 = Sunday, as weekdayOf
  specialDayDateId: id("special_day_date_id"),
}, (t) => [
  foreignKey({ columns: [t.departmentId], foreignColumns: [departments.id],
    name: "department_days_department_fk" }).onDelete("cascade"),
  foreignKey({ columns: [t.seasonId], foreignColumns: [seasons.id],
    name: "department_days_season_fk" }).onDelete("cascade"),
  foreignKey({ columns: [t.specialDayDateId], foreignColumns: [specialDayDates.id],
    name: "department_days_date_fk" }).onDelete("cascade"),
  check("department_days_one_day_ck",
    sql`(${t.seasonId} is null) <> (${t.specialDayDateId} is null) and (${t.seasonId} is null) = (${t.weekday} is null)`),
  check("department_days_weekday_ck", sql`${t.weekday} is null or ${t.weekday} between 0 and 6`),
  uniqueIndex("department_days_season_key").on(t.departmentId, t.seasonId, t.weekday)
    .where(sql`${t.seasonId} is not null`),
  uniqueIndex("department_days_date_key").on(t.departmentId, t.specialDayDateId)
    .where(sql`${t.specialDayDateId} is not null`),
  // The target of department_day_ranges' composite key (a key with no unique index is refused
  // at the first write, CLAUDE.md §3).
  uniqueIndex("department_days_department_key").on(t.id, t.departmentId),
]);

export const departmentDayRanges = table("department_day_ranges", {
  id: id("id").primaryKey().$defaultFn(newId),
  dayId: id("day_id").notNull(),
  departmentId: id("department_id").notNull(),
  periodId: id("period_id"), // null: Closed, written on special-day dates only (the writers check)
  startsAt: timeOfDay("starts_at").notNull(),
  endsAt: timeOfDay("ends_at").notNull(),
}, (t) => [
  foreignKey({ columns: [t.dayId, t.departmentId],
    foreignColumns: [departmentDays.id, departmentDays.departmentId],
    name: "department_day_ranges_day_fk" }).onDelete("cascade"),
  foreignKey({ columns: [t.periodId, t.departmentId],
    foreignColumns: [menuPeriods.id, menuPeriods.departmentId],
    name: "department_day_ranges_period_fk" }),
  check("department_day_ranges_step_ck",
    sql`substr(${t.startsAt}, 4, 2) in ('00', '15', '30', '45') and substr(${t.endsAt}, 4, 2) in ('00', '15', '30', '45')`),
  index("department_day_ranges_day_idx").on(t.dayId, t.startsAt),
]);

// zoneDays: as departmentDays with zoneId → zoneServicePolicies.zoneId (cascade), names
//   zone_days_zone_fk, zone_days_season_fk, zone_days_date_fk, zone_days_one_day_ck,
//   zone_days_weekday_ck, zone_days_season_key, zone_days_date_key.
// zoneDayRanges: id, dayId → zoneDays.id (cascade, zone_day_ranges_day_fk),
//   kind enumType(ZONE_PAINT_KINDS)("kind").notNull().default("closed") with
//   zone_day_ranges_kind_ck = enumCheck(kind) ("open" only on special-day dates — the writers check),
//   startsAt, endsAt, zone_day_ranges_step_ck, index zone_day_ranges_day_idx.
```

- [ ] **Step 1: Failing test.** In `migrations.test.ts`, add the seven tables to its table list and a
  case "a season's week rows go with the season, and a special day's dates with the special day":
  insert a location's season, a department, a `department_days` row for (season, weekday 6) and a
  range; delete the season; expect both rows gone. Insert a special day, a date, a `department_days`
  row for that date and a Closed range (`periodId: null`); delete the special day; expect the date,
  the day and the range gone. Insert a second date with the same `(location, date)`; expect the
  insert to throw a message containing
  `UNIQUE constraint failed: special_day_dates.location_id, special_day_dates.date` (a unique INDEX
  violation on `node:sqlite` names the columns, not the index — the reviewer's probe on Node
  v26.7.0 printed `UNIQUE constraint failed: t.loc, t.date`). Run
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/migrations.test.ts`.
  Expected: fails, `seasons` is not exported / no such table.
- [ ] **Step 2: Schema, then generate.** Write `schema/seasons.ts` as above, export it, run
  `pnpm --filter @waitron/venue-service db:generate`. Read the SQL: seven `CREATE TABLE` and their
  indexes only; nothing rebuilt, nothing dropped. If any `__new_` table appears, stop.
- [ ] **Step 3: Classify** all seven `classify(..., "state", STATE)` in `classification.ts`; update
  `classification.test.ts`'s expected list (adding rows is a fixture growth, not an assertion change).
- [ ] **Step 3b: Run** Step 1's test and `pnpm exec vitest run scripts/classification-complete.test.ts
  scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts`. **Commit** —
  `git commit -s -m "feat(venue-service): store seasons, special days and their day rows (A506-1)"`.

### Task 1.1b: The guards that pin the new tables

**Files:** `scripts/schema-constraints.test.ts` (**ASK**), `department-receipts.upgrade.test.ts`,
`scripts/migration-upgrade.test.ts` (CANDIDATES only)

- [ ] **Step 4: Guards.** Add to `scripts/schema-constraints.test.ts` — **ASK**, proposed diff:

  ```diff
  +  ["seasons", ["location_id"], "locations"],
  +  ["special_days", ["location_id"], "locations"],
  +  ["special_day_dates", ["special_day_id"], "special_days"],
  +  ["special_day_dates", ["location_id"], "locations"],
  +  ["department_days", ["department_id"], "departments"],
  +  ["department_days", ["season_id"], "seasons"],
  +  ["department_days", ["special_day_date_id"], "special_day_dates"],
  +  ["department_day_ranges", ["day_id", "department_id"], "department_days"],
  +  ["department_day_ranges", ["period_id", "department_id"], "menu_periods"],
  +  ["zone_days", ["zone_id"], "zone_service_policies"],
  +  ["zone_days", ["season_id"], "seasons"],
  +  ["zone_days", ["special_day_date_id"], "special_day_dates"],
  +  ["zone_day_ranges", ["day_id"], "zone_days"],
  ```
  in `EXPECTED_FOREIGN_KEYS` (alphabetical placement as the list keeps it), and the unique indexes
  `seasons_location_starts_key`, `seasons_location_name_key`, `special_day_dates_location_date_key`,
  `department_days_season_key`, `department_days_date_key`, `department_days_department_key`,
  `zone_days_season_key`, `zone_days_date_key`, and the checks `seasons_name_ck`,
  `seasons_starts_on_ck`, `special_days_name_ck`, `special_day_dates_date_ck`,
  `department_days_one_day_ck`, `department_days_weekday_ck`, `department_day_ranges_step_ck`,
  `zone_days_one_day_ck`, `zone_days_weekday_ck`, `zone_day_ranges_kind_ck`,
  `zone_day_ranges_step_ck` in their lists. What the guard checks after the change: that the
  migrations really build every foreign key, unique index and check the seven new tables are
  meant to have, so a later regeneration that loses one fails here instead of passing unseen.
- [ ] **Step 4b: The receipts upgrade probe** (`department-receipts.upgrade.test.ts`). It copies
  the venue-service migrations, POPS the last journal entry assuming it is
  `0048_department_receipts`, and installs the change feed for every classified table except
  `department_receipts`. After this task's migration (and A435-6's `0049`) the popped entry is the
  wrong one and `installChangeFeed` throws "no table named seasons". Planned change, in the
  "Changed test checks (A506-1)" commit: cut the copied journal at the entry tagged
  `0048_department_receipts` (drop it and every later entry and their `.sql` files) instead of
  `pop()`, and install the change feed only for classified tables that exist in the predecessor
  database (read `sqlite_master`). Its assertions stay as they are. **Re-read the test as A435-6
  landed it first**: A435-6's own `0049` already makes the unchanged `pop()` remove the wrong entry
  (at A435-6's tip `cd23f5aad` the unchanged test fails `expected [ { name: 'department_receipts' } ]
  to deeply equal []`), so lane E may have changed it, and the "before" failure may be that one or
  "no table named seasons". Run
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/department-receipts.upgrade.test.ts`
  before and after (passes). The plan's third-check reviewer ran this change in a throwaway
  worktree: with a simulated A506-1 migration it passed 1/1 with no assertion changed, and again
  after a simulated A506-5 drop.
- [ ] **Step 5: Upgrade walk.** Run `pnpm exec vitest run scripts/migration-upgrade.test.ts`. If it
  cannot fill a new table because a CHECK refuses its generic values, add `CANDIDATES` for the
  column it names (allowed without asking), e.g.
  `"seasons.starts_on": ["03-01", "06-01"]`, `"special_day_dates.date": ["2026-01-01", "2026-01-02"]`,
  and for the one-day checks `"department_days.weekday"` / `"zone_days.weekday"` if the walk names
  them. Paste the walk's own words into the PR.
- [ ] **Step 6: Run** Task 1.1's test and the whole schema guard list. Read each `Tests` count.
- [ ] **Step 7: Commit** — `git commit -s -m "test: pin the season tables' constraints (A506-1)"`
  (the receipts probe's edit in its own "Changed test checks (A506-1)" commit).

### Task 1.2: Seasons for every venue

**Files:**
- Create: `packages/venue-service/src/season-rules.ts` (browser-safe, no database import),
  `season-rules.test.ts`, `packages/venue-service/src/seasons.ts`, `seasons.test.ts`
- Modify: `provisioning.ts` (`VENUE_SERVICE_PROVISIONING.seed.run`), `provisioning.test.ts`

**Interfaces — produces:**

```ts
// season-rules.ts
export interface Season { id: string; name: string; startsOn: string } // MM-DD
export const DEFAULT_SEASONS: readonly { name: string; startsOn: string }[] = [
  { name: "Spring", startsOn: "03-01" }, { name: "Summer", startsOn: "06-01" },
  { name: "Autumn", startsOn: "09-01" }, { name: "Winter", startsOn: "12-01" },
];
/** The season holding `businessDay`: the latest start on or before its MM-DD, wrapping from the
 *  year's last season into the first. Null when there are no seasons. */
export function seasonOn<T extends { startsOn: string }>(seasons: readonly T[], businessDay: string): T | null;
/** The MM-DD before the next season's start, for showing a season's range. */
export function seasonLastDay(seasons: readonly { startsOn: string }[], startsOn: string): string;

// seasons.ts (server)
export async function readSeasons(tx: Transaction, cfg: VenueScope): Promise<Season[]>; // by startsOn
export async function ensureDefaultSeasons(tx: Transaction, cfg: VenueScope): Promise<Season[]>;
```

- [ ] **Step 1: Failing tests.** `season-rules.test.ts` (node project):

  ```ts
  const four = DEFAULT_SEASONS.map((s, i) => ({ ...s, id: String(i) }));
  it.each([
    ["2030-11-30", "Autumn"], ["2030-12-01", "Winter"], ["2031-01-15", "Winter"],
    ["2031-02-28", "Winter"], ["2032-02-29", "Winter"], ["2031-03-01", "Spring"],
    ["2031-08-31", "Summer"],
  ])("puts %s in %s", (day, name) => expect(seasonOn(four, day)?.name).toBe(name));
  it("wraps a lone season over the whole year", () =>
    expect(seasonOn([{ id: "a", name: "All", startsOn: "05-01" }], "2031-01-01")?.id).toBe("a"));
  it("answers null with no seasons", () => expect(seasonOn([], "2031-01-01")).toBeNull());
  it("ends Winter on the last day of February", () =>
    expect(seasonLastDay(four, "12-01")).toBe("02-28"));
  ```
  `seasons.test.ts` (`useVenueDb` with core, catalogue and venue-service migrations, as
  `menu-timetable.test.ts` sets it up): `ensureDefaultSeasons` twice on one location → four rows,
  names and starts as above; on a location that already has one season → still that one.
  `provisioning.test.ts`: after the seed runs, `readSeasons` answers the four. Run both files;
  expected: fail, modules missing.
- [ ] **Step 2: Implement.** `seasonOn` compares `businessDay.slice(5)` with `startsOn` as text.
  `ensureDefaultSeasons` reads, and inserts the four only when the location has none. Call it from the
  provisioning seed after the default department exists, before `placeOpenPeriod`.
- [ ] **Step 3: Run** the three files; read the counts.
- [ ] **Step 4: Commit** — `feat(venue-service): every venue has four seasons (A506-1)`.

### Task 1.3: Week writers write season weeks (and, for now, the old rows)

**Files:**
- Create: `packages/venue-service/src/season-weeks.ts`, `season-weeks.test.ts`
- Modify: `menu-timetable.ts` (`replaceMenuWeek`, `placeOpenPeriod`, `periodUses`,
  `deleteMenuPeriod`), `zone-closed-times.ts` (`replaceZoneClosedWeek`), `errors.ts`
  (`season.not_found`), `menu-timetable.test.ts`, `zone-closed-times.test.ts`

**Interfaces — produces:**

```ts
// season-weeks.ts
export async function writeDepartmentSeasonWeek(tx: Transaction, departmentId: string,
  seasonId: string, week: readonly (readonly ServiceRange[])[] /* index = weekday */): Promise<void>;
export async function writeZoneSeasonWeek(tx: Transaction, zoneId: string, seasonId: string,
  week: readonly (readonly ClosedRange[])[]): Promise<void>;
export async function readDepartmentSeasonWeeks(tx: Transaction, cfg: VenueScope,
  departmentIds?: readonly string[]): Promise<Map<string /*departmentId*/, Map<string /*seasonId*/, ServiceRange[][]>>>;
export async function readZoneSeasonWeeks(tx: Transaction, cfg: VenueScope,
  zoneIds?: readonly string[]): Promise<Map<string, Map<string, ClosedRange[][]>>>;
/** Touching ranges of the same period become one; input sorted from the changeover. */
export function joinTouching<T extends { startsAt: string; endsAt: string }>(
  ranges: readonly T[], same: (a: T, b: T) => boolean): T[];

// menu-timetable.ts — A495's signature, plus an optional last argument
export async function replaceMenuWeek(tx, cfg, departmentId, days: unknown, at: Date,
  expectedClockRevision: number, options?: { seasonId?: string }): Promise<void>;
// zone-closed-times.ts — A495's signature, plus an optional last argument
export async function replaceZoneClosedWeek(tx, cfg, zoneId, days: unknown,
  expectedClockRevision: number, at: Date, options?: { seasonId?: string }): Promise<void>;
```
`"season.not_found": { seasonId: string }` joins `ErrorParams` in `errors.ts`.

- [ ] **Step 1: Failing tests.**
  - `season-weeks.test.ts`: `replaceMenuWeek` with no season on a venue without seasons → four
    seasons exist and each season's Tuesday reads `[{Lunch 13:00–16:00}]`; with
    `{ seasonId: winter }` only Winter changes, the other three keep their Tuesday; two touching
    Lunch ranges 13:00–14:00 and 14:00–16:00 read back as one 13:00–16:00; an unknown `seasonId`
    rejects with `AppError` code `season.not_found` (assert `code`, not the class).
  - Same for `replaceZoneClosedWeek`.
  - `menu-timetable.test.ts`, new case "refuses deleting a period painted in one season only":
    paint Lunch into Winter only (`{ seasonId }`), `deleteMenuPeriod` → `menu_period.in_use` with a
    `uses` entry `{ kind: "week", weekday: 2 }`; the period row is still there.
  Run the three files; expected: the season cases fail (no season rows), the delete case fails with
  a foreign-key error instead of `menu_period.in_use`.
- [ ] **Step 2: Implement.** In `replaceMenuWeek`: parse as today; resolve the target seasons
  (`ensureDefaultSeasons`, then all of them, or the named one checked against the location →
  `season.not_found`); for each, `writeDepartmentSeasonWeek` with `joinTouching` (same period). With
  no season named, ALSO keep today's write of the old weekday rows (`writeDay` / the `emptied`
  delete), unchanged. The end-offset check stays as it is in this PR (A506-2 moves it). Same shape in
  `replaceZoneClosedWeek`. `placeOpenPeriod` keeps calling `replaceMenuWeek` without a season, so it
  paints every season. `periodUses` also reads `department_day_ranges` joined to `department_days`
  where `season_id` is not null, returning `{ kind: "week", weekday }` once per weekday.
- [ ] **Step 3: Run** the three files plus `provisioning.test.ts`.
- [ ] **Step 4: Commit** — `feat(venue-service): a saved week lands in every season (A506-1)`.

### Task 1.4: The day resolver's season step

**Files:**
- Create: `packages/venue-service/src/day-resolver.ts`, `day-resolver.test.ts`

**Interfaces — produces:**

```ts
export interface ResolvedDepartmentDay {
  businessDay: LocalDate;
  seasonId: string | null;
  ranges: ServiceRange[]; // sorted from the day's changeover, touching same-period runs joined
}
export async function resolveDepartmentDays(tx: Transaction, cfg: VenueScope,
  departmentId: string, businessDays: readonly LocalDate[], cutover: string)
  : Promise<Map<LocalDate, ResolvedDepartmentDay>>;
export async function resolveZoneClosedDays(tx: Transaction, cfg: VenueScope,
  zoneIds: readonly string[] | undefined, businessDays: readonly LocalDate[], cutover: string)
  : Promise<Map<string /*zoneId*/, Map<LocalDate, ClosedRange[]>>>;
```
In this PR each day is: a named day with `closeWholeVenue` → no ranges; a named day with
`ownHours` → its old special-date rows (as `departmentDay`'s `timetableOn` and `zoneClosureDay` do
today); otherwise the week of `seasonOn(readSeasons, day)` on `weekdayOf(day)`. Each day finds its
own season, so "yesterday" never borrows today's. After A495, `cutover` becomes the day's own
`serviceDayContext(clock, day).dayCutover` (re-check step).

- [ ] **Step 1: Failing test — the resolver's own answers.** In `day-resolver.test.ts`
  (`useVenueDb`), set the location to `Europe/Madrid`, changeover `06:00`. Periods Dinner, Late bar,
  Breakfast. Autumn's Saturday (weekday 6): Dinner 20:00–02:00. Winter's Saturday: Late bar
  20:00–02:00. Winter's Sunday (weekday 0): Breakfast 09:00–12:00 (closed until 09:00). Cases of
  `resolveDepartmentDays` for `["2030-11-30", "2030-12-01"]` asserting each day's `seasonId`
  (Autumn, Winter) and ranges by value (30 November: Dinner 20:00–02:00; 1 December: Breakfast
  09:00–12:00); Sunday 29 February 2032 (a Sunday by `date -j -f %Y-%m-%d 2032-02-29 +%A`)
  resolves to Winter's Sunday; a venue with one season only resolves every date to it. Run it;
  expected: fails, `day-resolver.js` missing. (The `resolveDepartmentService` case at 00:15 by the
  clock is Task 1.5's, because `departmentDay` is only rewired there.)
- [ ] **Step 2: Implement** `day-resolver.ts`: one read of the seasons, one of the department's
  season days for the needed (season, weekday) pairs, one `namedDaysOn` for the dates, one read of
  the old special-date timetables for own-hours dates; no read per day in a loop (the shape
  `departmentDay` already uses).
- [ ] **Step 3: Run** the file.
- [ ] **Step 4: Commit** — `feat(venue-service): the day resolver picks the business day's season (A506-1)`.

### Task 1.5: The sale path reads the resolver

**Files:**
- Modify: `menu-timetable.ts` (`departmentDay`), `zone-closed-times.ts` (`zoneClosureDay`,
  `closedZoneIdsAt`), `day-resolver.test.ts`, `keep-open.test.ts`, `zone-closed-times.test.ts`
- Create: `apps/server/src/till-api.seasons.test.ts`
- Modify (fixture move): `apps/server/src/till-api.zone-closed.test.ts`

**Interfaces — consumes:** Task 1.4. **Produces:** unchanged signatures of `departmentDay`,
`zoneClosureDay`, `closedZoneIdsAt`; therefore unchanged `VenueServiceContribution` seats
(`resolveDepartmentService`, `resolveDefaultMenu`, `routingAt`, `closedZoneIdsAt`,
`assertZoneTakesNewOrders`, `readKeepOpen`, `keepPeriodOpen`, `keepZoneOpen`, `readZoneKeepOpenState`,
`menuState`, `listZoneOffers`, `packages/module/src/module.ts`) whose answers now come from seasons.

**2026-10-12, at A506-1's finish:** the review's performance fixes added one seat,
`readZoneClosingStates` (`packages/module/src/module.ts`), so `GET /api/zones` reads every zone's
closed state and closing summary in one call; the seats above keep their signatures.

- [ ] **Step 1: Failing tests.**
  - `day-resolver.test.ts`, **the 2030 boundary exactly as spec §14**, on Task 1.4's data:

    ```ts
    it("runs Autumn's Saturday Dinner at 00:15 on Sunday 1 December 2030 by the clock", async () => {
      const at = new Date("2030-11-30T23:15:00Z"); // 00:15 in Madrid (UTC+1 in December)
      const service = await scoped((tx) => resolveDepartmentService(tx, cfg, restaurant, at));
      // Season by clock date gives Winter's Saturday: "Late bar".
      // Season and weekday by clock date give Winter's Sunday, closed until 09:00: null.
      expect({ at: "2030-12-01 00:15", period: service.periodName })
        .toEqual({ at: "2030-12-01 00:15", period: "Dinner" });
    });
    ```
    Expected before Step 2: fails, printing the period today's `departmentDay` finds in the old
    weekday rows (none for Saturday in this data: `null`).
  - `day-resolver.test.ts`: "yesterday's grace uses yesterday's season" — Autumn's Saturday Dinner
    20:00–05:45 with an end offset of +30 minutes, so sending runs to 06:15, past the 06:00
    changeover; Winter's Saturday has Late bar instead. At 06:05 on Sunday 1 December 2030 (business
    day Sunday, Winter) the Dinner menu is in `sendableMenuIds`. Had yesterday been read with
    today's season, Dinner would be missing and Late bar's menu would be there instead.
  - "an unreadable clock still opens every period's menus" (review focus 3): set the location's time
    zone to a value `readLocationClock` cannot use (as `menu-timetable.test.ts` does for its
    "unreadable clock" case — find it by `clockReadable` / `moment === null`), expect
    `open: true` and every period's menu orderable.
  - `zone-closed-times.test.ts`: Winter's zone closure 22:00–23:30 on Fridays; Autumn's none; at
    22:30 on Friday 29 November 2030 the zone is open, on Friday 6 December it is in
    `closedZoneIdsAt`.
  - `keep-open.test.ts`: "keeps Lunch open on a season day" — keep-open extends the season week's
    Lunch end as before (reuse that file's setup).
  - `apps/server/src/till-api.seasons.test.ts`, through the till routes as spec §14 now says
    (pricing reads no hours; what the hours decide is whether a dish may be ordered). Copy the setup
    of `till-api.service-periods.test.ts` (fake `Date` with `vi.setSystemTime`, its `send` helper).
    At 00:15 on 1 December 2030, `POST /api/working-orders` with a dish from Autumn's Dinner menu is
    accepted; with a dish only Winter's Late bar offers it answers the error code
    `menu_period.not_running` and writes no order; `GET /api/menu-state?zoneId=…` names Dinner.
  - **Fixture move:** `apps/server/src/till-api.zone-closed.test.ts` inserts weekday rows straight
    into `zoneClosedTimes` (its setup, the `[0, 1, 2, 3, 4, 5, 6].map((weekday) => …)` insert);
    once the till reads seasons those rows are never read and its closures vanish. Replace the
    insert with `replaceZoneClosedWeek` with no season (every season), keeping every assertion.
    Listed in the PR under fixtures that changed.
  Run all six; expected: the season-sensitive cases fail (the resolver is not yet called).
- [ ] **Step 2: Implement.** `departmentDay` keeps its period, staff and extension reads and takes
  `ranges`/`previousRanges` from `resolveDepartmentDays(tx, cfg, departmentId, [yesterday, today], …)`.
  `zoneClosureDay` and `closedZoneIdsAt` take closures from `resolveZoneClosedDays`. Delete the
  replaced `timetableOn` code.
- [ ] **Step 3: Run** the five files and `routing-store.test.ts`, `operations.test.ts`
  (`--project node`), `apps/server` `till-api.service-periods.test.ts`, `till-api.keep-open.test.ts`,
  `till-api.zone-closed.test.ts`, `working-order.test.ts`.
- [ ] **Step 4: Commit** — `feat(venue-service): the till sells the business day's season (A506-1)`.

### Task 1.6: Transfer, fixtures, live queries, docs

**Files:**
- Modify: `configuration-transfer.ts` (`VENUE_SERVICE_CONFIGURATION_TRANSFER.tables`, a new
  `validateSeasonWeeks` called from `validateVenueServiceConfiguration`), `configuration-transfer.test.ts`,
  `apps/server/src/configuration-transfer.test.ts`, `apps/server/src/testing/clear-provision-fixture.ts`,
  `dashboard/live-queries.ts` (+ test), `apps/server/scripts/demo-seed/seed.test.ts` (read only
  unless it pins table lists), `docs/developers/conventions-data.md`, `docs/backlog/service-periods.md`

- [ ] **Step 1: Failing tests.**
  - `apps/server/src/configuration-transfer.test.ts`: export a venue whose Winter Saturday differs
    from Autumn's, import it into a fresh venue, and expect `readSeasons` to equal the exported
    seasons by name and start — exactly four, not eight (review focus 2) — and Winter's and Autumn's
    Saturdays by value.
  - `configuration-transfer.test.ts`: a bundle whose `department_day_ranges` row has `starts_at`
    `"13:10:00"` is refused `setup.request_invalid` with field `department_day_ranges`; a
    `seasons.starts_on` of `"02-29"` is refused with field `seasons.starts_on`; a season week whose
    period's end offset clashes with the next day's placement in the same season (today's
    `validateMenuTimetables` refuses that for the old week rows; spec §6 and §12 keep the check on
    import) is refused with field `department_day_ranges`. No skipped-clock check on season weeks:
    they have no date (spec §6). A506-2 Task 2.3 widens this to the season-boundary pairs.
  - `dashboard/live-queries.test.ts`: `opening-hours`, `operations`, `routing` and `named-days`
    name `seasons`, `department_days`, `department_day_ranges`, `zone_days`, `zone_day_ranges`.
  Expected: the round trip fails (tables not transferred); the refusals do not happen.
- [ ] **Step 2: Implement.** Transfer `seasons` (`locationColumns: ["location_id"]`),
  `department_days`, `department_day_ranges`, `zone_days`, `zone_day_ranges`, listed after
  `menu_periods` and `zone_service_policies` (parents first, as the list orders today). Validation
  reuses `parseServiceDay` / `parseClosedRanges` through `parsedAs`, as `validateMenuTimetables`
  does, and runs `findScheduleEndOffsetClash` (`period-end-offset.ts`) over each imported season's
  week per department, with the bundle's periods' offsets. If the import path's provisioning also runs `ensureDefaultSeasons`, confirm by the test
  that it runs before rows are replaced, or after on a location that already has seasons. Add the
  five tables to `clear-provision-fixture.ts` beside the old ones and to the live-query lists.
- [ ] **Step 3: Guards.** `pnpm exec vitest run scripts/live-subscriptions.test.ts
  scripts/id-columns-are-references.test.ts`.
- [ ] **Step 4: Docs.** `conventions-data.md`: a short section "Seasons and season weeks" stating
  the tables, that a week saved with no season goes into every season, and that the old weekday
  rows are written beside them until A506-2 (a sentence the next PR deletes). Backlog progress line.
- [ ] **Step 5: Commit** — `feat(venue-service): seasons travel with a configuration (A506-1)`.

### Task 1.7: Deleting a department or zone clears its season days

**Files** (as A435-6 landed them; re-read before starting): `service-delete-settings.ts`
(`clearServiceDeleteSettings` and the impact builder that lists `{ key: "timetables" }` and
`{ key: "slots" }`), `service-delete-settings.test.ts`, `dashboard/service-delete-copy.ts` (+ test),
`strings.ts`

- [ ] **Step 1: Failing tests.** In `service-delete-settings.test.ts` (or A435-6's
  `service-delete.test.ts`, whichever holds the department-delete cases): a department with a
  painted season week (written with `replaceMenuWeek` naming a season, so no old rows exist) is
  deleted, and afterwards `department_days`, `department_day_ranges` and its `menu_periods` hold no
  rows for it; the delete impact counts its season days and ranges under two new keys (follow the
  landed naming, e.g. `season_days` and `season_ranges`); a zone with a season closure is deleted
  and its `zone_days`/`zone_day_ranges` are gone. Expected before Step 2: the department delete
  fails with `FOREIGN KEY constraint failed` (the ranges' period key has no delete rule), and the
  impact has no such keys.
- [ ] **Step 2: Implement.** In `clearServiceDeleteSettings`, before the `menuPeriods` delete,
  delete the department's `department_day_ranges` then `department_days`; beside the
  `zoneClosedTimes` delete, delete the zones' `zone_day_ranges` then `zone_days`. Count them in the
  impact; add EN/ES copy for the new keys in `service-delete-copy.ts`.
- [ ] **Step 3: Run** the two test files and `apps/server/src/service-delete.integration.test.ts`.
- [ ] **Step 4: Commit**, then the demo LOOK at the Week tab (unchanged look; saving still works)
  and the department delete dialog after `wa-wt reset demo`, and `/finish-branch`.

---

# A506-2 — The server's other readers read seasons

**Spec:** §6 (the end-offset set for seasons), §12 rows `findScheduleEndOffsetClash`,
`stationServiceTimes`, `inPeriodOrder`, `listVenueReadiness`, `readOpeningHoursModel`,
`readCalendarDays`, named-day copy, `placeOpenPeriod`/setup check, live queries; §17 (A495's check).

**Review path:** FULL. **Migration:** no ("no venue reset needed").

**Behaviour this PR removes:** the old weekday rows are no longer written or read (named-day rows
in the old tables are untouched).

### Task 2.0: Re-check on the base — as in "How each PR is worked".

### Task 2.1: The model carries seasons

**Files:** `menu-timetable-types.ts` (`OpeningHoursModel`), `menu-timetable.ts`
(`readOpeningHoursModel`), `menu-timetable.test.ts`, `hours-routes.test.ts` or
`menu-timetable-routes.test.ts` (whichever pins the `GET …/opening-hours` body), dashboard test
fixtures `testing/real-week-model.ts`, `testing/department-hours-fixture.ts` (grow keys only)

**Interfaces — produces:**

```ts
interface OpeningHoursModel {
  // … unchanged keys …
  seasons: readonly { id: string; name: string; startsOn: string }[]; // by startsOn
  currentSeasonId: string | null; // the season of today's business day; null if the clock is unreadable
  departments: readonly {
    // … unchanged keys …
    seasonWeeks: readonly { seasonId: string;
      week: readonly { weekday: number; slots: readonly ServiceRange[] }[] }[];
    week: …; // the current season's week (the first season's when the clock is unreadable); gone in A506-3
    zones: readonly { …; seasonWeeks: readonly { seasonId: string;
      week: readonly { weekday: number; ranges: readonly ClosedRange[] }[] }[];
      week: …; /* current season's; gone in A506-3 */ }[];
    periods: readonly { …; weekdays: readonly number[] /* any season */ }[];
  }[];
}
```

- [ ] **Step 1: Failing test.** In `menu-timetable.test.ts`: Winter's Friday has Dinner, the other
  seasons none; at a moment in December, the model's `currentSeasonId` is Winter's, `week[5]` has
  Dinner, `seasonWeeks` holds four entries by value; at a moment in July `week[5]` is empty. Expected:
  fails — `seasons` undefined, `week` read from the old rows.
- [ ] **Step 2: Implement** from `readDepartmentSeasonWeeks`/`readZoneSeasonWeeks`; `week` picks
  `currentSeasonId`'s. Fixtures gain `seasons`, `currentSeasonId`, `seasonWeeks`.
- [ ] **Step 3: Run** the test files and every dashboard test that builds a model from those
  fixtures: `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/opening-hours-week.test.ts src/dashboard/opening-hours-day.test.ts src/dashboard/opening-hours-screen.test.ts`.
- [ ] **Step 4: Commit** — `feat(venue-service): the opening-hours model lists seasons and their weeks (A506-2)`.

### Task 2.2: Dated readers pick the date's season

**Files:** `hours.ts` (`calendarDays`, `switchNamedDayHours`), `station-service-times.ts`
(`stationServiceTimes`), `hours-service-calendar.test.ts`, `hours-station-model.test.ts`,
`station-service-times.test.ts`, `hours.test.ts`

- [ ] **Step 1: Failing tests.** Winter's Monday has Lunch; Autumn's Monday none.
  `readCalendarDays` for Monday 25 November 2030 → `tone: "closed"`, for Monday 2 December →
  open; `stationServiceTimes` over 25 November–2 December shows the station's Lunch on 2 December
  only; turning on a named day's own hours on Monday 2 December copies Winter's Monday (Lunch), on
  25 November copies nothing. In `"normal"` mode `stationServiceTimes` shows the current season's
  week (state this in the test name). Expected: all read the old weekday rows and fail.
  **Fixture move:** `hours.test.ts` inserts weekday rows straight into `zoneClosedTimes` (the case
  that inserts `{ zoneId, weekday: 5, startsAt: "13:00:00", endsAt: "14:00:00" }`); once
  `calendarDays`/station times read seasons those rows are invisible. Write them with
  `replaceZoneClosedWeek` (every season) instead, assertions unchanged, listed in the PR.
- [ ] **Step 2: Implement.** `calendarDays` and `stationServiceTimes` take each date's
  `seasonWeeks` entry via `seasonOn(model.seasons, date)` (named-day own hours unchanged).
  `switchNamedDayHours` copies from `readDepartmentSeasonWeeks`/`readZoneSeasonWeeks` for
  `seasonOn(date)` on `weekdayOf(date)` into the old special-date rows.
- [ ] **Step 3: Run** the four files. **Step 4: Commit** — `feat(venue-service): calendar, station times and named-day copies read the date's season (A506-2)`.

### Task 2.3: The end-offset check runs on season weeks

**Files:** `period-end-offset.ts`, `period-end-offset.test.ts`, `menu-timetable.ts`
(`endOffsetClash`, `assertPeriodEndOffsets`, `replaceMenuWeek`'s refusal), `menu-timetable-rules.ts`
(`invalidTimetable`'s clash type gains `seasonId`), `errors.ts` (`menu_timetable.invalid` params
gain `seasonId?: string`)

**Interfaces — produces:**

```ts
export interface SeasonSchedule { seasonId: string; startsOn: string;
  week: readonly (readonly ServiceRange[])[] /* index = weekday */ }
export interface DatedSchedule { date: LocalDate; closeWholeVenue: boolean;
  slots: readonly ServiceRange[] | null /* null: follows its season */ }
export function findSeasonEndOffsetClash(seasons: readonly SeasonSchedule[],
  dated: readonly DatedSchedule[], offsets: ReadonlyMap<string, number>, cutover: string)
  : { periodId: string; slotIndex: number; seasonId?: string; weekday?: number; date?: LocalDate } | null;
```
Pairs (spec §6): each season's seven weekday→next-weekday pairs; at each season boundary the seven
pairs from the last day of one season on weekday w to the first day of the next on w+1; each dated
day with the day before and after, each neighbour resolved from its own season.

- [ ] **Step 1: Failing tests** (`period-end-offset.test.ts`, pure): Autumn's Saturday Dinner
  20:00–05:45 with offset +30 (sending until 06:15); Autumn's Sunday is empty, Winter's Sunday has
  Breakfast from 06:00. Inside Autumn there is no clash; at the Autumn→Winter boundary pair
  (Saturday → Sunday) the sending cutoff 06:15 reaches Winter's 06:00 Breakfast, so the function
  answers Dinner's `periodId` with `seasonId` of Autumn and `weekday: 6`; a dated named day whose neighbour
  lies in another season reads that season's week. `menu-timetable.test.ts`: `replaceMenuWeek` with
  `{ seasonId }` that creates such a clash is refused `menu_timetable.invalid` with
  `reason: "end_offset"` and `seasonId`. Expected: fail.
- [ ] **Step 2: Implement** `findSeasonEndOffsetClash`, have `endOffsetClash` build its inputs from
  `readDepartmentSeasonWeeks` and the named-day rows, and switch Task 1.6's import check
  (`configuration-transfer.ts`) to it so an imported bundle is checked across season boundaries too
  (add that import case to `configuration-transfer.test.ts`: two seasons whose boundary pair clashes
  → `setup.request_invalid` field `department_day_ranges`). Keep `findScheduleEndOffsetClash` only
  if something else still calls it (re-check grep); otherwise delete it with its tests listed under
  "Changed test checks".
- [ ] **Step 3: Run** the two files plus `apps/server` `venue-details.test.ts` (it reaches
  `assertPeriodEndOffsets`). **Step 4: Commit** — `feat(venue-service): end offsets are checked across seasons (A506-2)`.

### Task 2.4: Period order, readiness, setup, A495's check; stop writing the old rows

**Files:** `routing-periods.ts` (`inPeriodOrder`), `operations.ts` (`listVenueReadiness`),
`apps/server/src/setup-opening-hours.ts` (+ test), A495's `business-day-schedule.ts`
(`businessDayClockConflicts`, + its test), `packages/module/src/module.ts`
(`BusinessDayClockConflict` gains `seasonId?: string`, so a conflict in a season week names its
season), `menu-timetable.ts` and `zone-closed-times.ts` (drop the old weekday write and every
remaining old-weekday read), `apps/dashboard/src/api/live-queries.ts` (`getFolderRouting` gains the
five season tables), `docs/developers/conventions-data.md`; fixture moves (Step 1b)

**Fixture moves** — tests that read or count the old weekday rows by raw SQL, which stop being
written in this task. Each query moves to the season tables with the expected values unchanged
(the week is the same in every season); listed in the PR under fixtures that changed:
`apps/server/scripts/demo-seed/seed.test.ts` (four queries: zone closures from `zone_closed_times`,
department periods from `menu_slots` joined to `menu_day_timetables` by weekday, a weekday's ranges,
and the count of distinct weekdays per department), `apps/server/src/provision.test.ts` (its count
`slots: 5` from `menu_slots` → the same count over one season's `department_day_ranges`; or `20` over
all four seasons — choose one season and say so in the query), `apps/server/src/testing-zone-offers.test.ts`
(its `timetables`/`slots` counts → the season tables).

- [ ] **Step 1: Failing tests.** `routing.test.ts` or `routing-store.test.ts` (whichever pins
  `inPeriodOrder`): Lunch painted only in Summer at 12:00, Breakfast only in Winter at 08:00 →
  Breakfast first. `operations.test.ts`: a department painted only in Summer has no
  `department.no_periods`; one painted nowhere has it. `setup-opening-hours.test.ts`: a venue whose
  Winter differs from the "Open Mon–Fri 09:00–17:00" shape is no longer recognised. The A495 test:
  a Winter range crossing the proposed new changeover is reported as a conflict carrying Winter's
  `seasonId`. A `season-weeks.test.ts` case: after `replaceMenuWeek` with no season,
  `menu_day_timetables` holds no weekday rows. Expected: fail.
- [ ] **Step 1b: Fixture moves** listed above; run each moved file before (passes on the old
  rows) and after Step 2 (passes on the season rows).
- [ ] **Step 2: Implement.** Earliest start across every season week (spec default); readiness from
  `department_day_ranges` with a period on a season day; setup check over `model.seasonWeeks`;
  A495's conflicts read season weeks plus old special-date rows. Remove the dual write.
- [ ] **Step 3: Grep proof.** `rg -n 'isNotNull\(menuDayTimetables.weekday\)|zoneClosedTimes.weekday|menuDayTimetables.weekday' packages apps --glob '!**/*.test.*'`
  answers nothing. Paste it in the PR.
- [ ] **Step 4: Run** the files, `scripts/live-subscriptions.test.ts`; docs sentence from A506-1
  replaced by "the old tables hold named-day rows only". **Commit** — `feat(venue-service): period order, readiness and setup read seasons; old week rows retire (A506-2)`.

---

# A506-3 — The dashboard reads seasons; the Week tab gets a season picker

**Spec:** §15 slice 1's last sentence; §12 "the five dashboard copies … each read the date's
season"; §7's zone summary.

**Review path:** FULL (the week routes start writing a single season). **Migration:** no.

**2026-10-12, at A506-3's finish:** Task 3.5 (the zone summary) and the removal of a zone's `week`
moved to A506-3b, which waits for A493 (see "Left open by A506-3" in
`docs/backlog/service-periods.md`). A department's `week` is gone; a zone's stays, and the only reader
of it Task 3.4's search finds is the `department-zones.ts` summary line.

**Behaviour this PR removes:** `OpeningHoursModel.week` and a zone's `week`; the week routes'
every-season write (the routes now require `seasonId`; in-process callers keep the every-season
form).

### Task 3.0: Re-check on the base, including A493 and A435-6 for `department-zones.ts`.

### Task 3.1: Routes and client take a season

**Files:** `routes.ts` (`PUT …/departments/:departmentId/menu-week`, `PUT …/zones/:zoneId/closed-week`),
`menu-timetable-routes.test.ts`, `routes.test.ts`, `dashboard/opening-hours-client.ts`
(`saveWeek`, `saveZoneWeek`), `opening-hours-client.test.ts`

- [ ] **Step 1: Failing tests.** A body `{ days, seasonId, expectedClockRevision }` writes only that
  season; a body without `seasonId` is refused `management.request_invalid` with field `seasonId`;
  an unknown one `season.not_found`; a body without `expectedClockRevision` is refused as A495's
  route refuses it today; a stale revision is refused with A495's code. The client sends both.
  Expected: fail.
- [ ] **Step 2: Implement** (`onlyKeys(body, ["days", "seasonId", "expectedClockRevision"])`,
  `requireBodyUuid` for `seasonId`, A495's revision parsing unchanged), passing
  `{ seasonId }` as the writers' last argument.
- [ ] **Step 3: Run**, **Commit** — `feat(venue-service): week saves name their season (A506-3)`.

### Task 3.2: The Week tab edits the chosen season

**Files:** `apps/dashboard/src/navigation.ts` (`"opening-hours"` gains `season: "season"`),
`opening-hours-screen.ts` (picker beside the department picker), `opening-hours-week.ts`,
`opening-hours-zone-week.ts`, their `*.test.ts`, `*.unsaved.test.ts`, `*.a11y.test.ts`, `strings.ts`

- [ ] **Step 1: Failing browser tests.** The Week tab opens on `currentSeasonId`'s week; choosing
  Summer in the picker redraws Summer's week and puts `season=<id>` in the address; Save sends that
  `seasonId`; with Winter edited and unsaved, choosing Summer asks the unsaved-changes question
  first (the existing draft scope); Save is quiet until a change (existing `saveActionState`). The
  picker shows "Winter · 1 Dec – 28 Feb" (`seasonLastDay`). Expected: fail.
- [ ] **Step 2: Implement** with the same field primitive the department picker already uses in
  `opening-hours-screen.ts` (no native `<select>`; `scripts/native-form-fields.test.ts`), reading
  `seasonWeeks`, not `week`.
- [ ] **Step 3: Run** the browser files; LOOK. **Commit** — `feat(venue-service): the Week tab edits one season (A506-3)`.

### Task 3.3: Which season a date shows — the Day tab and the All view

**Files:** `real-week.ts` (a shared `seasonWeekOn(model, departmentId, date)` helper beside
`namedOn`, browser-safe, using `seasonOn`), `opening-hours-day.ts`, `opening-hours-all.ts`, their
`*.test.ts` and `opening-hours-day-zones.test.ts`

- [ ] **Step 1: Failing browser tests.** The Day tab on Monday 2 December 2030 shows Winter's
  Monday and on 25 November Autumn's; the All view's real week from Monday 25 November shows
  Autumn's Monday–Saturday and Winter's Sunday 1 December. Expected: fail (they read
  `department.week`).
- [ ] **Step 2: Implement** with `seasonWeekOn` (these copies go in A506-7; keep it minimal).
- [ ] **Step 3: Run**, LOOK, **Commit** — `feat(venue-service): the Day tab and All view follow the date's season (A506-3)`.

### Task 3.4: The real week of the Week tab; the model's `week` goes

**Files:** `opening-hours-week.ts` and `opening-hours-zone-week.ts` (real-week mode), their tests,
`menu-timetable-types.ts` and `menu-timetable.ts` (`week` removed from `OpeningHoursModel` and from
each zone), dashboard fixtures `testing/real-week-model.ts`, `testing/department-hours-fixture.ts`

- [ ] **Step 1: Failing browser tests.** The Week tab's real week from Monday 25 November 2030
  shows Autumn's Monday–Saturday and Winter's Sunday, for a department and for a zone. Expected:
  fail.
- [ ] **Step 2: Implement** with `seasonWeekOn`; then delete `week` from the model and fixtures
  (a pinned whole-shape test loses the key: "Changed test checks").
  `rg -n '\.week\b' packages/venue-service/src/dashboard --glob '!*.test.ts'` answers nothing.
- [ ] **Step 3: Run** every browser file touched in this PR, LOOK, **Commit** —
  `feat(venue-service): real weeks follow their season; the model's single week goes (A506-3)`.

### Task 3.5: The zone summary names its season

**Files:** `department-zones.ts` (the closed-times summary), `department-zones-hours.test.ts`,
`department-zones-hours.a11y.test.ts`, `strings.ts`, `docs/developers/design-system.md` (the
Opening hours and zone-summary paragraphs)

- [ ] **Step 1: Failing test.** In December a zone closed after 23:30 Monday–Thursday in Winter
  reads "Winter: closed after 23:30 Mon–Thu" (spec §7), and in ES the summary's existing ES
  wording with the season's name and a colon in front. Expected: fail.
- [ ] **Step 2: Implement**; update design-system.md's affected sentences (every claim about
  "the normal week" in those paragraphs). **Step 3:** LOOK; backlog progress line;
  **Commit**, `/finish-branch`.

---

# A506-4 — Special days on the server, painted over the season

**Spec:** §5, §6 steps 4–6 and "Clock changes", the end-offset bullets for special dates, §7 (zone
paint on special days), §11 (special-day tables, configuration import), §13 (routes, codes), §14
(across midnight, repeating, 29 February, the owner's worked example, "save keeps what was not
edited").

**Review path:** FULL. **Migration:** no.

**Behaviour this PR removes:** none (named days still work; the two refuse each other's dates).

**Repeating, in this PR:** the same month and day every year from the first year (owner's
question 2 adds holiday-name following in A506-5, Task 5.1b). Keep "does this special-day date
occur on this day, and where does it fall in year Y" in ONE helper in `special-days.ts`, used by
the resolver, the date-taken check, the bridge and the end-offset set, so A506-5 changes one place.

### Task 4.0: Re-check on the base.

### Task 4.1: Laying paint over a season (pure)

**Files:** Create `packages/venue-service/src/day-paint.ts` (browser-safe), `day-paint.test.ts`

**Interfaces — produces:**

```ts
export interface PaintRange { periodId: string | null /* null: Closed */; startsAt: string; endsAt: string }
export interface ZonePaint { kind: "closed" | "open"; startsAt: string; endsAt: string }
/** The season's day with each painted stretch replacing what was there; touching same-period runs joined. */
export function layerPaint(season: readonly ServiceRange[], paint: readonly PaintRange[], cutover: string): ServiceRange[];
/** The zone's season closures with "closed" paint added and "open" paint cut out. */
export function layerZonePaint(season: readonly ClosedRange[], paint: readonly ZonePaint[], cutover: string): ClosedRange[];
/** The smallest paint that turns `season` into `edited` (used by A506-5's date editor). */
export function paintFromEdit(season: readonly ServiceRange[], edited: readonly ServiceRange[], cutover: string): PaintRange[];
/** The same for a zone: "closed" where the edit closes time the season left open, "open" where it
 *  opens time the season closed (used by A506-5's date editor for zones). */
export function zonePaintFromEdit(season: readonly ClosedRange[], edited: readonly ClosedRange[], cutover: string): ZonePaint[];
```

- [ ] **Step 1: Failing tests — the owner's worked example (spec §5, §14):**

  ```ts
  const winter = [{ periodId: DINNER, startsAt: "20:00", endsAt: "23:30" }];
  it("keeps the season's Dinner after a shorter painted Dinner, joined", () =>
    expect(layerPaint(winter, [{ periodId: DINNER, startsAt: "19:00", endsAt: "22:00" }], "06:00"))
      .toEqual([{ periodId: DINNER, startsAt: "19:00", endsAt: "23:30" }]));
  it("ends the night at 22:00 under painted Closed", () =>
    expect(layerPaint(winter, [
      { periodId: DINNER, startsAt: "19:00", endsAt: "22:00" },
      { periodId: null, startsAt: "22:00", endsAt: "23:30" }], "06:00"))
      .toEqual([{ periodId: DINNER, startsAt: "19:00", endsAt: "22:00" }]));
  ```
  plus: a Lunch painted over part of Dinner splits Dinner; paint across midnight (23:00–02:00)
  against changeover 06:00; `layerZonePaint` "open" cuts a season closure; `paintFromEdit(season,
  layerPaint(season, p))` gives paint that `layerPaint` turns back into the same day, for three
  hand-picked cases, and `paintFromEdit(s, s)` is `[]`; the same round trip for
  `zonePaintFromEdit`/`layerZonePaint` (a season closure 22:00–23:30 edited to 23:00–23:30 gives
  `[{ kind: "open", startsAt: "22:00", endsAt: "23:00" }]`). Expected: module missing.
- [ ] **Step 2: Implement** on 15-minute steps from the changeover (`rangeSpan`; after A495 the
  day's own span, so a 26-hour day's tail is not replayed), then `joinTouching`.
- [ ] **Step 3: Run**. **Commit** — `feat(venue-service): paint lies over the season (A506-4)`.

### Task 4.2: The resolver lays special-day paint

**Files:** `day-resolver.ts`, `day-resolver.test.ts`, `special-days.ts` (read helpers only in this
task)

- [ ] **Step 1: Failing tests** (`useVenueDb`; rows inserted directly with the schema in this task):
  - **Across midnight, special day on the first night only:** Winter Friday Dinner 20:00–23:30; a
    special day on Friday 13 December 2030 painting Dinner 20:00–02:00. At 01:00 on Saturday by the
    clock (business day Friday) → Dinner; at 01:00 the next night (business day Saturday 14th,
    Winter Saturday has nothing after 23:30) → closed.
  - **Closed tick:** a date with `closed_all_day` → every department closed and every zone answer
    ignores zone paint; a department created AFTER the tick was set is closed that day too.
  - **Repeating:** a repeating special day first dated 2030-12-24: applies on 2031-12-24, not on
    2029-12-24.
  - **29 February:** repeating from 2028-02-29 applies 2032-02-29 and not in 2031.
  - **Zone "Open":** Winter closes the Terrace after 22:00; a special date paints Terrace "open"
    22:00–23:30 → `closedZoneIdsAt` at 22:30 omits the Terrace; the department closed at 22:30 that
    day → nothing can be ordered there (the department answer is closed).
  - **A season start moved while a special date lies under it:** move Winter's start (update the row)
    from 12-01 to 11-15; the special date's unpainted time now follows Winter on 20 November.
  Expected: fail — the resolver reads no special days.
- [ ] **Step 2: Implement**: one read of the special-day dates for the requested days (one-off by
  `date`, repeating by month-day with the first year ≤ the day's year, using `occurrenceIn`'s rule,
  `named-day-rules.ts`), their department paint and zone paint, then `layerPaint` /
  `layerZonePaint`; `closed_all_day` empties the day for every department and zone.
- [ ] **Step 3: Run** with Task 1.5's sale-path files. **Commit** — `feat(venue-service): special-day paint lies over the season on the till (A506-4)`.

### Task 4.3: Saving a special day

**Files:** `special-days.ts`, `special-days.test.ts`, `errors.ts`

**Interfaces — produces:**

```ts
export interface SpecialDayInput {
  name: string;
  repeatsYearly: boolean;
  dates: readonly { date: LocalDate; closedAllDay: boolean }[];
  paint?: readonly { departmentId: string; date: LocalDate; ranges: readonly PaintRange[] }[];
  zonePaint?: readonly { zoneId: string; date: LocalDate; ranges: readonly ZonePaint[] }[];
}
export interface SpecialDayDetail extends Omit<SpecialDayInput, "paint" | "zonePaint"> {
  id: string;
  paint: { departmentId: string; date: LocalDate; ranges: PaintRange[] }[];
  zonePaint: { zoneId: string; date: LocalDate; ranges: ZonePaint[] }[];
}
export async function readSpecialDay(tx, cfg, id: string): Promise<SpecialDayDetail>;
export async function saveSpecialDay(tx, cfg, id: string | null, input: unknown, at: Date,
  expectedClockRevision: number): Promise<SpecialDayDetail>;
export async function deleteSpecialDay(tx, cfg, id: string, at: Date,
  expectedClockRevision: number): Promise<void>;
```
Codes (in `errors.ts`): `"special_day.invalid": { field: string; date?: string; reason?: "empty" | "order" | "step" | "overlap" | "clock_skips" | "end_offset" | "closed_in_season"; departmentId?: string; zoneId?: string; periodId?: string }`,
`"special_day.not_found": { specialDayId: string }`,
`"special_day.date_taken": { date: string; specialDayId: string; name: string }`.

- [ ] **Step 1: Failing tests.**
  - **Saving keeps what was not edited (spec §10.4, §14):** a special day over 14–23 December with
    Restaurant and Bar paint on every date; save again with dates 14–24 December (one added, none
    removed) and `paint` naming only Restaurant on 20 December → Bar's paint on all ten original
    dates equals what it was, by value, and the original dates' row ids are unchanged; Restaurant's
    paint on the other dates unchanged.
  - Removing a date deletes its paint; a date another special day holds → `special_day.date_taken`
    naming the other's id and name; a repeating 24 December colliding with a one-off 2031-12-24 only
    from its first year; names need not be unique (two "Viernes Santo" save).
  - Shapes: overlap / step / empty refused `special_day.invalid` with a `field` like
    `paint.0.ranges.1.startsAt`; a period of another department → field `paint.0.ranges.0.periodId`;
    a zone "open" in a season week is impossible here, but a `periodId: null` range on a season week
    is refused in `writeDepartmentSeasonWeek` (`menu_timetable.invalid`, reason
    `closed_in_season`) — test that too.
  - **Review focus 4:** a `paint` entry for a department that does not exist → `department.not_found`;
    for a zone → `service_zone.not_found`; nothing written (the special day reads as before).
  - **Clock skips:** paint starting 02:15 on 29 March 2026 (Europe/Madrid) → `special_day.invalid`
    reason `clock_skips` with that `date`; a repeating one checked at its next occurrence from `at`.
  Expected: module missing.
- [ ] **Step 2: Implement** in one transaction (the caller's `tx`), starting with A495's
  `assertBusinessDayScheduleWrite(tx, cfg, "time", at, expectedClockRevision)` (a stale revision is
  refused before anything is written — add that case to Step 1): compare dates by value (insert
  added, delete removed, update `closed_all_day` on kept), then replace paint per (department,
  date) and (zone, date) given. Parse with `parseRanges`' rules (`service-day.ts`), mapping refusals
  to `special_day.invalid`. Clock skip via `clockTimeSkipped` (after A495, `clockTimeSkippedInDay`).
- [ ] **Step 3: Run**, guards `scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`.
  **Commit** — `feat(venue-service): save a special day without touching what was not edited (A506-4)`.

### Task 4.3b: A named day and a special day never share a date (the bridge)

**Files:** `hours.ts` (`assertNamedDayAvailable` also refuses a date a special day holds),
`special-days.ts` (`saveSpecialDay` also refuses a date a named day holds), `hours.test.ts`,
`special-days.test.ts`

- [ ] **Step 1: Failing tests:** a named day on 2030-12-25 makes `saveSpecialDay` on that date
  answer `special_day.date_taken`; a special day there makes `saveSpecialDate` answer
  `special_date.date_taken`; a repeating named day on 25 December refuses a special day on
  2031-12-25 but not on 2029-12-25 (before its first year). Expected: both saves succeed.
- [ ] **Step 2: Implement** both checks with `occursOn` (repeat rules), refusals by code.
- [ ] **Step 3: Run** the two files. **Commit** — `feat(venue-service): named days and special days never share a date (A506-4)`.
  (Task 5.5 removes both checks with named days.)

### Task 4.4: The end-offset set for special days

**Files:** `period-end-offset.ts`, `period-end-offset.test.ts`, `menu-timetable.ts`
(`endOffsetClash` builds special-day inputs), `special-days.ts` (runs it after a save and a delete),
`special-days.test.ts`; A495's `business-day-schedule.ts` (`businessDayClockConflicts` also reads
special-day paint — spec §17: the slice that moves the readers moves that check) and its test;
`packages/module/src/module.ts` (`BusinessDayClockConflict` gains `specialDayId?: string`)

- [ ] **Step 1: Failing tests** (spec §6 bullets, §14): a one-off special date paired with the day
  before and after; a repeating special date checked under each of the seven weekdays it can fall
  on (a clash that only appears when 24 December is a Sunday is found); a refusal from
  `saveSpecialDay` is `special_day.invalid` with `reason: "end_offset"`, the `date` and the
  `periodId`, and nothing is written; deleting a special day that leaves a clash is refused the same
  way. A495's check: a special day painting Dinner 22:00–04:30 is reported as a conflict for a
  proposed changeover of 03:00, carrying its `specialDayId` and `date`. Expected: fail.
- [ ] **Step 2: Implement** by extending `findSeasonEndOffsetClash`'s `dated` input with special-day
  dates resolved by `layerPaint`, and the repeating case by synthesising the date's neighbours for
  each weekday (season of the neighbour's month-day, its weekday's week, any special day on the
  neighbour).
- [ ] **Step 3: Run**. **Commit** — `feat(venue-service): end offsets are checked around special days (A506-4)`.

### Task 4.5: Routes

**Files:** `routes.ts`, `routes.test.ts` (or a new `special-days-routes.test.ts`)

Routes (writes `gated`, reads `viewed`):
- `GET /management-api/venue-service/special-days/:id` → `SpecialDayDetail`
- `POST /management-api/venue-service/special-days` → 201 `SpecialDayDetail`
- `PUT /management-api/venue-service/special-days/:id` → `SpecialDayDetail`
- `DELETE /management-api/venue-service/special-days/:id` → 204

- [ ] **Step 1: Failing tests:** each route's success by value, an unknown key refused
  (`onlyKeys`), a viewer refused writes, `special_day.not_found` for an unknown id, a write without
  `expectedClockRevision` refused. Expected: 404s.
- [ ] **Step 2: Implement.** POST and PUT read `onlyKeys(body, ["name", "repeatsYearly", "dates",
  "paint", "zonePaint", "expectedClockRevision"])`; DELETE reads `{ expectedClockRevision }` from
  its body, as A495's special-date DELETE does today.
- [ ] **Step 3: Run**. **Commit** — `feat(venue-service): special-day routes (A506-4)`.

### Task 4.6: Transfer and live queries

**Files:** `configuration-transfer.ts`, its tests (package and `apps/server`),
`dashboard/live-queries.ts` (+ test), `apps/server/src/testing/clear-provision-fixture.ts`

- [ ] **Step 1: Failing tests:** a venue with a repeating special day, a Closed tick and Bar paint
  exports and imports by value; a bundle with two special-day dates on one date is refused
  `setup.request_invalid` field `special_day_dates.date`; one with a Closed paint row on a season
  day is refused field `department_day_ranges`; and the two dated checks today's
  `validateMenuTimetables` makes on imported named-day slots move to special-day paint (spec §6,
  §12): paint starting at a time the clock skips on its date (02:15 on 29 March 2026,
  Europe/Madrid; a repeating date checked at its next occurrence from the bundle's `createdAt`, using
  `localTimeOccurrences` as `validateMenuTimetables` does) is refused field `department_day_ranges`,
  and paint whose period's end offset clashes with the next day is refused the same way. Live-query
  lists `opening-hours`, `operations`, `routing`, `named-days`, `holidays` name `special_days` and
  `special_day_dates`.
- [ ] **Step 2: Implement**; transfer `special_days` and `special_day_dates` (`locationColumns`)
  before `department_days`. **Step 3:** guards `scripts/live-subscriptions.test.ts
  scripts/id-columns-are-references.test.ts`; docs (`conventions-data.md`: special days, the
  bridge); backlog progress line; **Commit**; `/finish-branch`.

---

# A506-5 — The Calendar edits special days; named days and the old tables go

**Spec:** §5 (two kinds; the kind's three readers), §10.1's local-holiday sentence and "no longer a
holiday source", §11 (old tables go; FK listing), §12 rows for the named-day copy and duplicate,
`holidays`, `named-days`, `calendarDays`, demo seed, `clear-provision-fixture`, `schema-constraints`,
live queries; §13 retired codes; §15 slice 2.

**Review path:** FULL. **Migration:** yes. PR first line: **"venue reset needed — required: named
days and the old hours tables are dropped; special days replace them."**

**Behaviour this PR removes:** named days and their kinds (own holiday / working day), own hours,
"copy to other dates", the old special-date routes (`POST/PUT/DELETE …/special-dates…`,
`…/duplicate`, `…/menu-timetables/:departmentId`, `…/zone-closed-times/:zoneId`), the Calendar's
"Own holiday" and "Named working day" marks, the venue as a holiday source, and the codes
`special_date.date_taken`, `special_date.keeps_week`, `special_date.not_found` (and `hours.invalid`
if nothing throws it any more). Each test pinning one of these goes in the "Changed test checks"
commit or is deleted with its file, listed in the PR.

### Task 5.0: Re-check on the base. List every caller of the old routes and functions found.

**How the old tests are split across the tasks.** On the audited base, `rg -c` over `*.test.ts`
for the named-day names (`saveSpecialDate|duplicateSpecialDate|deleteSpecialDate|specialDates\b|special_dates|ownHours|own_hours|saveSpecialDateMenus|saveZoneClosedDate|namedDaysOn|readNamedDaysModel|closeWholeVenue|NamedDay\b|special-dates`)
counted 833 matching lines in 58 files on main at `1f321faa8` (on A495's `eee0f0128` the reviewer
counted 881 in 59 files — re-measure on the base before splitting the work); `hours.test.ts` (125), `menu-timetable.test.ts` (80) and
`hours-routes.test.ts` (78) hold the most. Two rules decide each case: a case whose SUBJECT is retired
behaviour (named-day CRUD, kinds, own hours, copy, duplicate) is DELETED with its function, named in
the PR under "Behaviour this PR removes"; a case whose subject survives (what the till sells on a
date, the calendar, station times, transfer) is MOVED onto an equivalent special day, its
assertions unchanged (a fixture change). Each task below owns the test files named in it and no
others; a task that reaches about 100 tool calls stops at a passing point and hands over.

### Task 5.1: The sale path reads special days only

**Files:** `day-resolver.ts` (the named-day branches go), `menu-timetable.ts` (`endOffsetClash`
reads special days only), `zone-closed-times.ts`; tests moved: the resolver and sale-path cases of
`menu-timetable.test.ts`, `zone-closed-times.test.ts`, `keep-open.test.ts`, `routing-store.test.ts`,
`period-end-offset.test.ts`, `station-times.test.ts`, `service.test.ts`,
`apps/server/src/working-order.test.ts`

- [ ] **Step 1: Failing test.** `day-resolver.test.ts`: a named day with own hours on a date no
  longer changes what that date resolves to (the season's week answers). Expected: fails (the
  branch is still there). Move the listed files' own-hours cases onto special days first, all green.
- [ ] **Step 2: Implement** — delete the branches. **Step 3: Run** the listed files.
  **Commit** — `feat(venue-service): the till reads special days only (A506-5)`.

### Task 5.1b: A repeating holiday date follows the holiday's name (owner, question 2)

**Files:** `schema/special-days.ts` (or wherever A506-1 declared `special_day_dates`:
`holiday_name`, nullable label, no CHECK — a plain added column, so drizzle adds it without a
table rebuild; read the generated SQL and confirm there is no `DROP TABLE`), Task 5.8's generated
migration (one migration for the PR), `special-days.ts` (the occurrence helper; the save records
the name), `day-resolver.ts`, `period-end-offset.ts`, `holidays.ts` (a read of the venue's list for
one year), `operations.ts` (`listVenueReadiness`), `configuration-transfer.ts`, `errors.ts` if a
code is needed, and their tests.

- [ ] **Step 1: Failing tests** (spec §5): saving a special day on a date that is a public holiday
  in the venue's list stores that holiday's official name, and on an ordinary date stores none; a
  repeating date named "Viernes Santo" on 2026-04-03 applies on the date the 2027 list gives
  "Viernes Santo" (a test pack or list with a 2027 year) and not on 2027-04-03; a repeating
  25 December named "Natividad del Señor" applies on 2027-12-25; a 2027 list without the name, and
  a year with no list, apply nothing that year and produce the warning line (readiness, current or
  next year only); a date with no holiday name repeats on its month and day as before; the
  date-taken check and the end-offset set use each year's resolved date. Expected: fail.
- [ ] **Step 2: Implement** in the one occurrence helper A506-4 left; the resolver reads the venue's
  list for a year only when a repeating date carries a holiday name, once per request.
- [ ] **Step 3: Run**, guards for the schema change. **Commit**.

### Task 5.2: The Calendar's model over special days; holidays

**Files:** `holidays.ts` (`readHolidays`: no `ownHolidays`, no `owner:named-days` source, local
coverage no longer `owner_entered`), `holiday-types.ts`, `named-days.ts` (`readNamedDaysModel`
becomes `readSpecialDaysModel`: each day carries `specialDay: { id, name } | null`, `holidays`,
`closed`; tones `public_holiday | special_day | closed | standard`), `hours.ts` (`calendarDays`,
`readCalendarDays` read special days), `routes.ts` (`GET …/named-days` serves the new model; keep the
path, the client reads it in 5.3), `named-day-rules.ts` → `repeat-rules.ts` and
`named-day-rules.test.ts` → `repeat-rules.test.ts` with the importers `hours-rules.ts`,
`hours-types.ts`, `holiday-types.ts`, `special-days.ts`, `day-paint.ts`; tests: `holidays.test.ts`, `holidays-routes.test.ts`,
`named-days.test.ts`, `named-day-detail.test.ts`, `hours-service-calendar.test.ts`,
`calendar-without-station-hours.test.ts`, `hours.live.test.ts`

- [ ] **Step 1: Failing tests.** A venue whose official list has no local holidays gets coverage
  `local: "none_entered"` even with a special day named "Fiesta mayor" (spec §10.1: no longer a
  source); the model's tone for a special day is `special_day`; a public holiday edited into a
  special day keeps `public_holiday` with its special day attached (spec §5 drawing default).
  Expected: fail.
- [ ] **Step 2: Implement.** Keep `occurrenceIn`/`occursOn`/`nextOccurrence` (special days use
  them) and delete `NAMED_DAY_KINDS` and the kind types from `named-day-rules.ts`; rename the file
  `repeat-rules.ts` and its test `named-day-rules.test.ts` → `repeat-rules.test.ts`, and update its
  importers: `hours-rules.ts`, `hours-types.ts`, `holiday-types.ts`, and A506-4's `special-days.ts`
  and `day-paint.ts` (re-check with `rg -n named-day-rules packages apps`). **Step 3: Run**. **Commit**.

### Task 5.3: The Calendar's dialog edits a special day

**Files:** dashboard `named-day-editor.ts` → `special-day-dialog.ts` (renamed; `.test`, `.unsaved`,
`.a11y` renamed with it), `named-day-copy.ts` (+ tests, deleted), `named-days-client.ts` →
`special-days-client.ts` (+ `.lifecycle`, `-retirement` tests moved or deleted), `named-day-save-retirement.test.ts`,
`hours-calendar.ts` (+ tests), `strings.ts`

The dialog holds: Name (required), Dates (chips, "+ Add dates…" with single dates or a range from
two date fields), Every year (No / Yes) with, on a special day holding a public-holiday
date, the note "Every year follows the holiday's name to its date each year." (owner's question 2,
spec §5), and one Closed tick per date ("Closed all day"). A public holiday
opens it pre-filled with the holiday's name and date, and when a special day of that name exists,
first offers "Add to <name>" (spec §5). The dialog sends the A495 revision.

- [ ] **Step 1: Failing browser tests:** create with two dates and a Closed tick sends
  `SpecialDayInput` by value; editing the name only sends the dates unchanged and no `paint`; the
  holiday pre-fill and the "Add to <name>" offer (choosing it saves the existing special day with
  the date added, nothing else changed); the note shows on a holiday date and not on an ordinary
  one; Save quiet until a change (`saveActionState`); `special_day.date_taken` shows under the
  Dates field naming the other special day; leaving with an edit asks first (`*.unsaved.test.ts`);
  a11y in both themes. Expected: fail.
- [ ] **Step 2: Implement** with field primitives only. **Step 3:** run, LOOK, **Commit**.

### Task 5.4: The Day tab edits a special date's paint

**Files:** `opening-hours-day.ts` (+ `.test`, `.unsaved`, `.a11y`, `opening-hours-day-zones.test.ts`,
`opening-hours-date.test.ts`, `.unsaved`, `.a11y`), `opening-hours-week.ts` and
`opening-hours-zone-week.ts` (real-week dated columns become read-only, each linking to that date's
Day view; + `opening-hours-real-week.test.ts`), `opening-hours-all.ts`, `real-week.ts`,
`opening-hours-client.ts`

- [ ] **Step 1: Failing browser tests:** on a special date, editing Restaurant's Dinner end from
  23:30 to 22:00 saves `paint: [{ departmentId: restaurant, date, ranges: [{ periodId: null,
  startsAt: "22:00", endsAt: "23:30" }] }]` — `paintFromEdit`'s answer — and nothing for Bar; editing
  the Terrace's closed time from 22:00–23:30 to 23:00–23:30 saves `zonePaint: [{ zoneId: terrace,
  date, ranges: [{ kind: "open", startsAt: "22:00", endsAt: "23:00" }] }]` — `zonePaintFromEdit`'s
  answer; on an ordinary date the editor offers "Make this a special day…" and no Save; a refusal
  naming a `date` shows beside that department's or zone's Save only. Expected: fail.
- [ ] **Step 2: Implement**. **Step 3:** run, LOOK, **Commit**.

### Task 5.5: Named-day writers and their routes go

**Files:** `hours.ts` (`saveSpecialDate`, `renameSpecialDate`, `deleteSpecialDate`,
`duplicateSpecialDate`, `switchNamedDayHours`, `assertNamedDayAvailable` with A506-4's bridge,
`SpecialDateParticipant`, `readSpecialDate` deleted), `holidays.ts`
(`duplicateHolidayNamedSpecialDates` deleted), `calendar-participants.ts` (deleted), `index.ts`
(their exports, including `duplicateHolidayNamedSpecialDates` and
`VENUE_SERVICE_CALENDAR_PARTICIPANTS`), `routes.ts` (the four special-date routes: `POST
…/special-dates`, `PUT …/special-dates/:id`, `POST …/special-dates/:id/duplicate`, `DELETE
…/special-dates/:id`), `special-days.ts` (A506-4's bridge check goes); tests: `hours.test.ts`,
`hours-routes.test.ts`, `named-day-input.test.ts`, `apps/server/src/management-api.test.ts`,
`apps/server/src/provision.test.ts`, the `apps/server/src/configuration-transfer.test.ts` cases that
build named days (moved to special days)

- [ ] **Step 1:** a route test that `POST …/special-dates` answers 404; moved cases green first.
- [ ] **Step 2: Implement** the deletions; `pnpm --filter @waitron/venue-service exec tsc --noEmit`
  (or the package's `typecheck` script) is clean. **Step 3: Run** the listed files. **Commit**.

### Task 5.6: Dated timetables, dated zone closures and station times

**Files:** `menu-timetable.ts` (`MENU_TIMETABLE_CALENDAR_PARTICIPANT`, `saveSpecialDateMenus`,
`requireSpecialDate`, `assertPlaced`, `dateTimetables`, `assertCalendarEndOffsets` deleted),
`zone-closed-times.ts` (`saveZoneClosedDate` deleted), `routes.ts` (`PUT
…/special-dates/:id/menu-timetables/:departmentId` and `PUT
…/special-dates/:id/zone-closed-times/:zoneId` removed), `index.ts` (`saveSpecialDateMenus` export),
`station-service-times.ts` (special days through `day-paint.ts`, no named days); tests:
`menu-timetable-routes.test.ts`, `menu-timetable.test.ts` (dated-timetable cases), `hours-station-model.test.ts`,
`station-service-times.test.ts`, `station-reopening-without-hours.test.ts`

- [ ] **Step 1: Failing test:** `stationServiceTimes` on a special date painting Dinner
  19:00–01:00 for a Dinner-only station shows 19:00–01:00; the two routes answer 404.
- [ ] **Step 2: Implement**, typecheck clean. **Step 3: Run**. **Commit**.

### Task 5.7: A495's changeover check reads special days only

**Files:** A495's `business-day-schedule.ts` (no old-table reads), its test,
`packages/module/src/module.ts` (`specialDateId` leaves `BusinessDayClockConflict`; A506-4 added
`specialDayId`), every reader of that field (`rg -n specialDateId packages apps`)

- [ ] Failing test: a conflict on special-day paint carries `specialDayId` and no `specialDateId`
  key → implement → `pnpm --filter @waitron/module exec tsc --noEmit` (or its typecheck script) and
  the server tests that pin the conflict shape → **Commit**.

### Task 5.8: Drop the old tables

**Files:** `schema/hours.ts`, `schema/zone-closed-times.ts`, `schema/menus.ts` (`menuDayTimetables`,
`menuSlots` removed), `schema/index.ts`, `classification.ts` (+ test), `migrations.test.ts`,
generated migration, `configuration-transfer.ts` (old tables, `validateNamedDaysConfiguration`,
the old-table parts of `validateMenuTimetables`, `validateZoneClosedTimes` removed — A506-1 and
A506-4 already put their checks on the new tables), `service-delete-settings.ts` (the old
`timetables` and `slots` deletes and impact counts removed, + its test and copy),
both live-query lists (`packages/venue-service/src/dashboard/live-queries.ts`;
`apps/dashboard/src/api/live-queries.ts`, whose `getFolderRouting` names `special_dates`, replaced by
`special_days` and `special_day_dates`), `apps/server/src/testing/clear-provision-fixture.ts`,
`apps/server/src/testing-zone-offers.test.ts` (any old-table count left), `provisioning.test.ts`,
`scripts/schema-constraints.test.ts` (**ASK**), `scripts/migration-upgrade.test.ts` (see Step 4)

- [ ] **Step 1: Foreign keys pointing at the dropped tables.** From the schema read on the audited
  base: `menu_slots → menu_day_timetables` (cascade), `menu_day_timetables → special_dates`
  (cascade), `zone_closed_times → special_dates` (cascade); no table outside the four points at
  them (the review of the spec read the same, not run). Re-check on the base:
  `rg -n 'REFERENCES .(special_dates|menu_day_timetables|menu_slots|zone_closed_times).' packages/*/drizzle/*.sql`
  and the latest snapshots. A new referrer is a STOP.
- [ ] **Step 2: Failing test.** `migrations.test.ts`'s table list loses the four; a case asserts
  `sqlite_master` has none of them. Expected: fails until the migration exists.
- [ ] **Step 3: Generate.** Read the SQL: four `DROP TABLE`, children before parents
  (`menu_slots`, `zone_closed_times`, `menu_day_timetables`, `special_dates`). If drizzle orders a
  parent first, generate in two steps (children first) rather than editing the SQL.
- [ ] **Step 4: Guards.** **ASK** — `scripts/schema-constraints.test.ts`, proposed diff:

  ```diff
  -  ["special_dates", ["location_id"], "locations"],
  -  ["menu_day_timetables", ["department_id"], "departments"],
  -  ["menu_day_timetables", ["special_date_id"], "special_dates"],
  -  ["menu_slots", ["timetable_id", "department_id"], "menu_day_timetables"],
  -  ["menu_slots", ["period_id", "department_id"], "menu_periods"],
  -  ["zone_closed_times", ["zone_id"], "zone_service_policies"],
  -  ["zone_closed_times", ["special_date_id"], "special_dates"],
  -  "special_dates_location_date_key",
  -  "special_dates_location_repeat_key",
  -  "menu_day_timetables_week_key",
  -  "menu_day_timetables_date_key",
  -  "menu_day_timetables_department_key",
  -  "special_dates_date_ck", "special_dates_name_ck", "special_dates_kind_ck", "special_dates_repeat_ck",
  -  "menu_day_timetables_one_day_ck", "menu_day_timetables_weekday_ck", "menu_slots_step_ck",
  -  "zone_closed_times_one_day_ck", "zone_closed_times_weekday_ck", "zone_closed_times_step_ck",
  ```
  What the guard checks after the change: the same thing for every table that still exists; the
  removed lines describe tables this PR drops, and a listed constraint of a missing table would
  fail the guard for the wrong reason.
  Then run `scripts/migration-upgrade.test.ts`. Its `CANDIDATES` entry `"special_dates.date"` stays
  (earlier steps still create the table). If the walk fails at the new step for lost rows, the fix
  is a `RESETS` entry with exactly the walk's printed words, e.g.
  `"venue-service/<n>_<tag>": { lost: ["menu_day_timetables", "menu_slots", "special_dates", "zone_closed_times"] }` —
  **ASK** with the measured text. What the guard checks after the change: that every migration
  step still carries the rows it is given, except this one, which is recorded as losing exactly
  those tables' rows because the venue is reset (pre-live, CLAUDE.md §3) rather than carried across.
  Run the whole schema guard list and `packages/fiscal-verifactu/src/inmutabilidad.test.ts`.
- [ ] **Step 5: Commit** — `feat(venue-service): drop named days and the old hours tables (A506-5)`.

### Task 5.9: Codes, seed, docs

**Files:** `errors.ts` (retire the three `special_date.*` codes, and `hours.invalid` if
`errors-reachable` finds no throw site), `strings.ts` (their messages), `apps/server/scripts/demo-seed/seed.ts`
(one special day: "Christmas Day", 25 December, repeats, Closed tick; `seed.test.ts` gains it),
`docs/developers/conventions-data.md` (the "Earlier W98 menu timetable model" bullets that describe
special dates and `menu_period.in_use` reading old slots — rewrite to the new tables; a dated
pointer if the section is historical), `docs/developers/design-system.md` (Calendar paragraphs)

- [ ] Steps: failing `seed.test.ts` case → implement → guards `scripts/errors-reachable.test.ts
  scripts/alert-codes.test.ts scripts/live-subscriptions.test.ts` → docs → LOOK of the Calendar and
  the Day tab → backlog progress → **Commit**, `wa-wt reset demo`, `/finish-branch`.

---

# A506-6 — Seasons can be edited; Opening hours opens on the year

**Spec:** §4 (moving, adding, removing, renaming; codes), §6 (end-offset rerun on season changes),
§10.1, §12 (setup Done link → year).

**Review path:** FULL. **Migration:** no.

**Behaviour this PR removes:** the Calendar tab (its holiday-area chooser and special-day dialog
move into the year view).

### Task 6.0: Re-check on the base. Q1 is answered: the default.

### Task 6.1: Editing seasons on the server

**Files:** `season-rules.ts` (`parseSeasonStart`), `seasons.ts`, `seasons.test.ts`, `errors.ts`
(`"season.invalid": { field: "name" | "startsOn" | "seasonId"; reason?: "taken" | "last" | "end_offset"; date?: string; departmentId?: string; periodId?: string }`)

**Interfaces — produces:**

```ts
export async function saveSeason(tx, cfg, id: string, input: { name: string; startsOn: string }, at: Date,
  expectedClockRevision: number): Promise<Season>;
export async function addSeason(tx, cfg, input: { name: string; startsOn: string }, at: Date,
  expectedClockRevision: number): Promise<Season>; // Q1
export async function deleteSeason(tx, cfg, id: string, at: Date,
  expectedClockRevision: number): Promise<void>; // Q1
export async function seasonDeleteImpact(tx, cfg, id: string): Promise<{ departments: { id: string; name: string }[] }>;
```

- [ ] **Step 1: Failing tests.** `02-29` and an invalid `13-01` → `season.invalid` field
  `startsOn`; a start another season holds → field `startsOn`, reason `taken`; a name taken → field
  `name`; moving Winter to 11-15 makes 20 November resolve to Winter at once (the next
  `resolveDepartmentService` call); `addSeason("Christmas weeks", "12-20")` copies Winter's weeks
  (department and zone) by value; `deleteSeason(Christmas)` gives 20 December back to Winter and
  removes its weeks; deleting the last season → `season.invalid` field `seasonId` reason `last`;
  a move that creates an end-offset clash at the new boundary → `season.invalid` reason
  `end_offset` with `date`/`departmentId`/`periodId`, nothing changed; **a delete that creates a
  clashing boundary** (spec §14: added, deleted and moved): seasons Autumn (09-01), Late autumn
  (11-01), Winter (12-01); Autumn's Saturday Dinner 20:00–05:45 with end offset +30 (sending until
  06:15); Late autumn's Sunday empty; Winter's Sunday Breakfast from 06:00. Deleting Late autumn
  gives its days to Autumn, so Autumn's last Saturday now borders Winter's first Sunday and Dinner's
  sending reaches Breakfast: refused `season.invalid` reason `end_offset`, Late autumn still there;
  **an add** copies the weeks of the season it splits, so its new boundaries pair copies of one
  week: `addSeason("Late autumn", "11-01")` on Autumn's data above succeeds; a stale
  `expectedClockRevision` is refused before anything changes. Expected: fail.
- [ ] **Step 2: Implement**, end-offset check after each change. **Step 3:** run; guards for codes.
  **Commit**.

### Task 6.2: The year read and the season routes

**Files:** Create `opening-hours-calendar.ts` (+ test); `routes.ts` (+ tests)

**Interfaces — produces:**

```ts
export interface OpeningHoursYear {
  year: number; timeZone: string; today: LocalDate | null;
  seasons: readonly (Season & { lastDay: string })[];
  days: readonly { date: LocalDate; seasonId: string | null;
    specialDay: { id: string; name: string } | null; holidays: readonly HolidayFact[];
    closed: boolean /* Closed tick, or every active department closed all day */ }[];
  publicHolidaysAvailable: boolean; // false: "Public holidays for 2027 are not available yet"
  holidayCoverage: …; area: …; // as the Calendar's model carries them today
}
export async function readOpeningHoursYear(tx, cfg, year: number, at: Date): Promise<OpeningHoursYear>;
```
Routes: `GET …/opening-hours/year?year=` (viewed); `PUT …/seasons/:seasonId`
(`onlyKeys(body, ["name", "startsOn", "expectedClockRevision"])`), `POST …/seasons` (same keys),
`DELETE …/seasons/:seasonId` (body `{ expectedClockRevision }`) — all gated;
`GET …/seasons/:seasonId/delete-impact` viewed.

- [ ] **Step 1: Failing tests:** 2030's days by value for a handful of dates (a Winter day, a
  special day with a Closed tick, a public holiday from the pack's 2026 list in a 2026 read, a date
  where every department is closed all day); 2027 read gives `publicHolidaysAvailable: false`
  (2026 is the only shipped year, `packages/country-es/src/data/es-2026.ts`); routes by value; one
  query per kind of data, not per day (resolve all departments' days in one `resolveDepartmentDays`
  call per department). Expected: fail.
- [ ] **Step 2: Implement**. **Step 3:** run. **Commit**.

### Task 6.3: Season chips and the season dialog

**Files:** Create dashboard `season-chips.ts` and `season-dialog.ts`, with `.test`, `.unsaved`
(dialog) and `.a11y`; modify `opening-hours-client.ts` (season writes, sending the revision),
`strings.ts`

Chips "Winter · 1 Dec – 28 Feb ✎" (`seasonLastDay`); ✎ opens `season-dialog` (name, start;
Delete season when more than one, confirming with the impact's department names — Q1); "+ Season"
opens it empty (Q1). The component is used by the year view (Task 6.4) and, later, the month view.

- [ ] **Step 1: Failing browser tests:** rename and move send the right body; Save quiet until a
  change; `season.invalid` shown under the field it names (`name` or `startsOn`); a refusal with
  reason `end_offset` shown beside Save naming the date and keeping the draft; Delete absent with
  one season; the delete confirmation names the departments; unsaved-leave question; axe both
  themes. Expected: fail.
- [ ] **Step 2: Implement** with field primitives. **Step 3:** run, LOOK. **Commit**.

### Task 6.4: The year view; the Calendar tab goes

**Files:** Create dashboard `opening-hours-year.ts` (+ `.test`, `.a11y`); modify
`opening-hours-screen.ts` (Year is the default view; Calendar tab removed; the holiday-area chooser
moves here), `navigation.ts` (`"opening-hours"` gains `year: "year"`), `hours-calendar.ts` (+ tests,
deleted), `strings.ts`

Mockup 1: twelve months, days coloured by season (season colours from `--wt-*` tokens; add tokens
if none fit and say so), marks for Public holiday, Special day, Closed with a legend; ‹ › step
years; the chips of Task 6.3; "+ Special day" opening A506-5's special-day dialog; the
local-holiday sentence "Town holidays are not in the official lists — add them as special days."
when the pack has no local holidays; the warning line for a repeating holiday date with no match in the shown year (spec §5:
"Viernes Santo (Every year) has no public holiday of that name in 2027"); the "Public holidays for 2027 are not available yet" line
under the legend; a month name opens the Day tab for that month's first day until A506-7.

- [ ] **Step 1: Failing browser tests** for each behaviour above (by the days' marks and classes,
  not by pixel colour). Expected: fail.
- [ ] **Step 2: Implement** drawing from `OpeningHoursYear` only. **Step 3:** run, LOOK (mockup 1
  beside the screenshots), `no-hardcoded-chrome` and `style-token-names` guards. **Commit**.

### Task 6.5: Links and docs

**Files:** `apps/setup/src/screens/done-screen.ts` (+ test: link → `/manage/opening-hours/view/year`),
`docs/developers/design-system.md` (Opening hours: the year), backlog progress.
- [ ] Failing test → implement → `pnpm --filter @waitron/setup exec vitest run src/screens/done-screen.test.ts` →
  **Commit**, `/finish-branch`.

---

# A506-7 — The month view replaces the Day tab and the Real week switch

**Spec:** §10.2, §5 ("Every change to a single date is a special day"; mockup 5), §12 ("the five
dashboard copies … gone" for the dated copies).

**Review path:** LIGHT. **Migration:** no.

**Behaviour this PR removes:** the Day tab, the Real week switch and its `week=` address, the dated
columns of the Week and All views (`real-week.ts` deleted). The per-date editor of Task 5.4 stays,
reached from the month at `view=date&date=…`.

### Task 7.0: Re-check on the base.

### Task 7.1: The month read

**Files:** `opening-hours-calendar.ts` (`readOpeningHoursMonth`), test, `routes.ts`
(`GET …/opening-hours/month?month=YYYY-MM`, viewed)

```ts
export interface OpeningHoursMonth {
  month: string; today: LocalDate | null;
  seasons: readonly (Season & { lastDay: string })[]; // those the month touches
  days: readonly { date: LocalDate; seasonId: string | null;
    specialDay: { id: string; name: string } | null; holidays: readonly HolidayFact[];
    closedAllDay: boolean;
    departments: readonly { departmentId: string; ranges: readonly ServiceRange[];
      zones: readonly { zoneId: string; closed: readonly ClosedRange[] }[] }[] }[];
}
```
- [ ] Failing test: December 2030 by value for three dates (Autumn's last Saturday, Winter's first
  Sunday, a painted special day); one resolver call per department for the month → implement →
  run → **Commit**.

### Task 7.2: The month view and the ordinary-date dialog

**Files:** Create dashboard `opening-hours-month.ts`, `ordinary-date-dialog.ts` (+ `.test`,
`.a11y`); modify `opening-hours-screen.ts` (Day tab and Real week switch removed, `view=month`),
`opening-hours-year.ts` (a month name opens it), `navigation.ts` (`date: "date"`), `strings.ts`

Mockup 2: a bar per department per day (or, with one department chosen, its bar and one per zone
with the zone's closed time drawn as a gap); "‹ year", ‹ › months; season chips for the seasons the
month touches; special-day names and "Closed" on their dates; a date heading never repeats its
weekday (the column heading carries it); Today marker. Clicking a special date opens A506-5's
special-day dialog with an "Edit hours on this date" action (→ `view=date`); a public holiday not in
a special day opens the dialog pre-filled; an ordinary date opens mockup 5's dialog: "Follows the
Winter week", "Edit the Winter week" (→ Week tab with `season=`), "Make this a special day…",
"Add to a special day…".

- [ ] **Step 1: Failing browser tests** for each click target, the picker, the zone gap, and the
  headings: no weekday name inside a date heading (assert the heading's text), the Today marker
  present on today's cell. Expected: fail.
- [ ] **Step 2: Implement** drawing from `OpeningHoursMonth` only (no hours worked out in the
  dashboard). **Step 3:** run, LOOK — the real-week headings check is this PR's: the date and the
  Today marker readable in EN/ES, both themes, 1280 and 390 px. **Commit**.

### Task 7.3: Remove the dated copies; docs

**Files:** `real-week.ts` (deleted; its `seasonIdOn` helper (the date's season, read with `seasonWeek` from `season-choice.ts`) moves to a small
`season-week-view.ts`, which the Week tab and the read-only station and All departments views keep
using for the current season's week), dated modes of `opening-hours-week.ts`,
`opening-hours-zone-week.ts`, `opening-hours-all.ts` and `opening-hours-station.ts` (it imports
`realDayLabel` from `real-week.ts`; its dated-column mode goes and it keeps the current season's
week until A506-12) removed with their tests (listed under
"Behaviour this PR removes"), `design-system.md`, backlog progress
- [ ] Grep proof `rg -n 'weekStart|realDayLabel|namedOn' packages/venue-service/src/dashboard`
  answers nothing → run → **Commit**, `/finish-branch`.

---

# A506-8 — The paint grid and the season painter replace the Week tab

**Spec:** §10.3 (all of it), §7 (zone painting in the season painter), mockups 3 and 9, §12 links
(zone → the season painter on that zone).

**Review path:** FULL (Task 8.1's route). **Migration:** no.

**Behaviour this PR removes:** the Week tab's editing and its editors (`opening-hours-week.ts`,
`opening-hours-zone-week.ts` with their tests). **Kept until A506-12** (decision 12): the read-only
station view at `view=week&station=…` (linked from `station-table.ts`) and the All departments view
at `view=week&department=all`, both still drawn by `opening-hours-screen.ts` with
`opening-hours-station.ts`, `opening-hours-all.ts` and `service-grid.ts`, showing the current
season's week.

### Task 8.0: Re-check on the base, A493 and A435-6 for `department-zones.ts`.

### Task 8.1: Saving a season's weeks in one request

**Files:** `season-weeks.ts` (`saveSeasonWeeks`), test, `routes.ts`
(`PUT …/seasons/:seasonId/weeks`, gated), routes test

```ts
export async function saveSeasonWeeks(tx, cfg, seasonId: string, input: {
  departments?: readonly { departmentId: string; days: readonly MenuWeekDay[] }[];
  zones?: readonly { zoneId: string; days: readonly { weekday: number; ranges: readonly ClosedRange[] }[] }[];
}, at: Date, expectedClockRevision: number): Promise<void>;
```
Route body: `onlyKeys(body, ["departments", "zones", "expectedClockRevision"])`.
- [ ] Failing tests: a stale `expectedClockRevision` refused with nothing written; Restaurant and Terrace saved together; a refusal on the Terrace (overlap)
  leaves Restaurant's week as it was (one transaction); a department not listed is untouched; the
  end-offset check runs once over the result → implement on `replaceMenuWeek`/`replaceZoneClosedWeek`
  with `{ seasonId }` → run → **Commit**.

### Task 8.2: The paint model (pure)

**Files:** Create `packages/venue-service/src/paint-model.ts` (browser-safe; node tests)

```ts
export type Paint = { periodId: string | null; startsAt: string; endsAt: string }; // null: Closed
/** Paint a stretch over a day's ranges, replacing what is under it; joins touching same-period runs.
 *  `closedErases`: in a season week, painting Closed removes ranges. */
export function paintStretch(day: readonly Paint[], stretch: Paint, cutover: string, closedErases: boolean): Paint[];
export function deleteBlock(day: readonly Paint[], index: number): Paint[];
export function changeBlockPeriod(day: readonly Paint[], index: number, periodId: string | null, cutover: string): Paint[];
export function copyDay(days: ReadonlyMap<string, readonly Paint[]>, from: string, to: readonly string[]): Map<string, Paint[]>;
export function stepAt(offsetPx: number, rowPx: number, cutover: string): string; // 15-minute rows
```
- [ ] Failing node tests: dragging Afternoon 15:00–20:00 over Lunch 13:00–16:00 leaves Lunch
  13:00–15:00 (mockup 3's "replaces the end of Lunch"); two Breakfast drags 08:00–10:00 and
  10:00–12:00 become one block; Closed in a season week erases; Closed on a special day is stored;
  copy Tuesday to Wednesday–Saturday by value → implement → run → **Commit**.

### Task 8.3: The paint grid — drawing, dragging, selecting

**Files:** Create dashboard `paint-grid.ts`, `paint-grid.test.ts`, `paint-grid.a11y.test.ts`

Columns (weekdays or dates) with the day name and its ⋮ on one line; 15-minute rows about 5 px tall
from the changeover; dragging down a column paints the chosen chip (`paintStretch`); clicking a
block selects it (change period from a list, Delete); faded underlay (season under a special day;
the department's periods under a zone). The grid emits `paint-change` with the new day.

- [ ] Failing browser tests: drag (dispatch pointer events, as other drag tests in `packages/ui`
  do), replace, join, select and change period, Delete from the block's menu; colours read
  `--wt-*` tokens (period colours via the existing `CALENDAR_COLOURS` token mapping); axe in both
  themes → implement → run → `no-hardcoded-chrome` and `style-token-names` guards → **Commit**.

### Task 8.4: The paint grid — Copy to…, Clear, autoscroll, keyboard

**Files:** `paint-grid.ts` and its tests

- [ ] Failing browser tests: the column ⋮ "Copy to…" ticking several days copies by value
  (`copyDay`), Clear empties the column; while a drag is held below the bottom edge `scrollTop`
  grows, and stops when the pointer comes back; a focused block answers Delete and Backspace; the
  ⋮ menu is reachable by keyboard → implement → run → **Commit**.

### Task 8.5: The painter frame

**Files:** Create dashboard `painter-frame.ts` with `.test` and `.a11y`

A native `<dialog>` opened with `showModal()` covering the dashboard; one bar holding close ✕, a
title slot, a picker slot, a link slot, Cancel and Save, staying visible however the content
scrolls; Save quiet until its host says the draft changed (`saveActionState`); close and Cancel go
through the host's draft scope (`draftScopeFor`), so leaving with edits asks first.

- [ ] Failing browser tests: the bar stays in view after scrolling the content; Esc and ✕ ask
  first when the draft changed and close at once when not; focus returns to the opener; axe both
  themes → implement → run → **Commit**.

### Task 8.6: The season painter — seasons, picker and one draft

**Files:** Create dashboard `season-painter.ts` with `.test`, `.unsaved`, `.a11y`; `strings.ts`

Mockup 3 on `painter-frame.ts` and `paint-grid.ts`: title "Winter week", ‹ season chip › stepping
seasons, the department picker including its zones ("Dining room and Terrace follow Restaurant";
choosing a zone paints Closed over the department's periods drawn faded), a link to the Periods tab
(re-pointed to the Periods page in A506-11). Paint row: periods with ✎, Closed, "+ New period"
(opens today's `period-editor.ts` dialog as "Add and paint with it" until A506-11; a period saves
on its own; the painting stays). One draft across departments and zones (spec default): switching
the picker keeps edits.

- [ ] Failing browser tests: stepping seasons; the picker lists the department's zones; "draft
  kept across the picker" (spec §14); "+ New period" leaves the painting in place; Save quiet until
  a change; stepping seasons with edits asks first (the unsaved-leave question, spec §14); axe both
  themes → implement → run → **Commit**.

### Task 8.6b: The season painter — saving and refusals

**Files:** `season-painter.ts` and its tests, `opening-hours-client.ts` (`saveSeasonWeeks`, sending
the revision)

Save sends every edited department and zone in one request (Task 8.1's route); a refusal keeps the
draft and shows beside Save, or on the column heading too when it names a `weekday` (§10.6).

- [ ] Failing browser tests: one request holding exactly the edited department and zone; a
  refusal naming no field shows beside Save only, keeps the draft and a working retry; a refusal
  naming a `weekday` also marks that column's heading (both §10.6 cases pinned) → implement → run →
  LOOK against mockups 3 and 9 → **Commit**.

### Task 8.7: The Week tab goes; links

**Files:** `opening-hours-screen.ts` (the Week tab's editing → the painter at
`view=season&season=…&department=…&zone=…`; the year view's season chip and the ordinary-date
dialog's "Edit the Winter week" open it; `view=week&station=…` and `view=week&department=all` keep
rendering read-only), `navigation.ts`, `zone-edit-dialog.ts` (zone link → painter on that zone,
+ test), deleted week editors and their tests, `design-system.md`, backlog progress
- [ ] Failing tests for the links, and a test that `view=week&station=<id>` still draws the
  station's read-only week (the `station-table.ts` link) → implement → run → LOOK → **Commit**,
  `/finish-branch`.

---

# A506-9 — The special-day painter; refusals beside Save; links re-pointed

**Spec:** §10.4, §10.6, §5 (public holiday → special day; "Every year" note — Q2), §10.2's click
targets, mockup 4, §12 links (readiness).

**Review path:** LIGHT. **Migration:** no.

**Behaviour this PR removes:** the special-day dialog (`special-day-dialog.ts`) and the per-date
editor (`opening-hours-day.ts`) with their tests, including `opening-hours-day-zones.test.ts` and
`opening-hours-date.test.ts`, `opening-hours-date.unsaved.test.ts`, `opening-hours-date.a11y.test.ts`.
What the dialog did that the spec keeps — the public-holiday pre-fill, the "Add to <name>" offer
and the "Every year" note — moves into the painter (Tasks 9.3 and 9.3b).

### Task 9.0: Re-check on the base. Q2 is answered (b): see Task 5.1b and spec section 5.

### Task 9.1: Season days for any dates (server read)

**Files:** `opening-hours-calendar.ts` (`readSeasonDays(tx, cfg, dates)` → per date its season and
each department's season ranges and each zone's season closures, without special-day paint),
`routes.ts` (`GET …/opening-hours/season-days?dates=YYYY-MM-DD,…`, viewed, at most 62 dates →
`management.request_invalid` field `dates`), tests
- [ ] Failing test by value for two dates in different seasons → implement → run → **Commit**.

### Task 9.2: The add-dates calendar

**Files:** Create dashboard `add-dates-calendar.ts` (+ `.test`, `.a11y`): a small month grid;
click a date to add it, shift-click (and a "Range" toggle for touch) to add a range; dates another
special day holds are marked (from the month read) but not blocked (the server refuses).
- [ ] Failing browser tests → implement → run → **Commit**.

### Task 9.3: The special-day painter — the side panel and the dates

**Files:** Create dashboard `special-day-painter.ts` (+ `.test`, `.unsaved`, `.a11y`); modify
`opening-hours-client.ts`, `strings.ts`

Mockup 4, on `painter-frame.ts`: one column per date (the grid comes in Task 9.4); under each date
heading its Closed tick (whole venue, whichever department is shown); side panel: Name (required),
Dates (chips, "+ Add dates…" with `add-dates-calendar.ts`), Every year (No / Yes) with
the note "Every year follows the holiday's name to its date each year." on a special day holding a
public-holiday date (owner's question 2, spec §5), and the "season shows through" explanation;
Delete in the bar (confirm; its dates follow their seasons again).

- [ ] **Failing browser tests:** adding and removing dates; the Closed tick; the note on a holiday
  date and not on an ordinary one; Delete with its confirmation; Save quiet until a change;
  unsaved-leave question; axe both themes → implement → run → **Commit**.

### Task 9.3b: Opening the painter on a public holiday

**Files:** `special-day-painter.ts` and its tests, `strings.ts`

Opened on a public holiday not in a special day, the painter is pre-filled with the holiday's
official name and date; when a special day of that name exists it first offers "Add to <name>",
which opens that special day with the date added to its draft (spec §5; carried over from A506-5's
dialog).

- [ ] **Failing browser tests:** the pre-fill by value; the offer shown only when a same-name
  special day exists; choosing it opens the existing special day with the date in its draft and
  nothing else changed; declining it keeps the pre-filled new special day → implement → run →
  **Commit**.

### Task 9.4: The special-day painter — painting and saving

**Files:** `special-day-painter.ts` and its tests

The paint grid per date with the season (from `season-days`) drawn faded under the paint; zone rows
paint Closed and Open. Save sends `SpecialDayInput` (with the revision) whose `paint`/`zonePaint`
hold only the (department, date) and (zone, date) pairs the draft changed.

- [ ] **Failing browser tests:** a draft that edits only Restaurant on one date sends exactly one
  `paint` entry (the spec's "save keeps what was not edited", client half); a zone "Open" stretch;
  a refusal naming no field shows beside Save only and keeps the draft and a working retry; a
  refusal naming a `date` also marks that column's heading (spec §10.6, both cases pinned) →
  implement → run → LOOK against mockup 4 → **Commit**.

### Task 9.5: Entry points and links

**Files:** `opening-hours-screen.ts` (`view=special-day&special-day=<id>`; new special day
`view=special-day` with `date=` pre-fill), `opening-hours-month.ts` and `opening-hours-year.ts`
(clicks; "+ Special day"), `ordinary-date-dialog.ts` ("Make this a special day…" and "Add to a
special day…" open the painter), deleted dialog and per-date editor, `department-page.ts` and
`departments-list.ts` (readiness "set up periods" → the season painter on that department, until
A506-11 re-points it to the Periods page), `navigation.ts`, `design-system.md`, backlog progress
- [ ] Failing tests for each link → implement → run → LOOK → **Commit**, `/finish-branch`.

---

# A506-10 — Deleting a period with a replacement; where a period is painted

**Spec:** §8 ("Painted in"; deleting with and without a replacement; past one-off special days;
one transaction), §14 ("Deleting a period, with and without a replacement … by value; refusals by
code").

**Review path:** FULL. **Migration:** no.

**Behaviour this PR removes:** none (today's `DELETE` still refuses `menu_period.in_use`; A506-11
retires it).

### Task 10.0: Re-check on the base.

### Task 10.1: Painted in and the delete impact

**Files:** Create `period-delete.ts`, `period-delete.test.ts`

```ts
export interface PaintedIn { seasons: { id: string; name: string }[];
  specialDays: { id: string; name: string }[] /* a date today or later, or repeating */ }
export async function readPaintedIn(tx, cfg, at: Date): Promise<Map<string /*periodId*/, PaintedIn>>;
export async function periodDeleteImpact(tx, cfg, periodId: string, at: Date): Promise<{
  seasons: number; specialDays: number; routingUses: PeriodRoutingUse[]; keptOpenToday: boolean;
  replacements: { id: string; name: string }[] /* the department's other periods */ }>;
```
- [ ] Failing tests: a past one-off special day is not listed or counted; a repeating one is; a
  period painted nowhere has empty lists; `routingUses` equals what `readRoutingUses`
  (`menu-timetable.ts`) gives → implement → run → **Commit**.

### Task 10.2: Delete with or without a replacement

**Files:** `period-delete.ts` (`deletePeriod(tx, cfg, periodId, replacementId: string | null, at, expectedClockRevision: number)`),
test, `errors.ts` (if a new field is needed on `menu_period.invalid`: `field: "replacementPeriodId"`)

- [ ] **Step 1: Failing tests, each asserted by value:**
  - Without: Lunch's season ranges gone (that time closed); a special day's Lunch paint gone (the
    season shows through on that date — assert the resolved day); routing lines naming Lunch gone;
    today's "keep Lunch open" extension gone.
  - With Afternoon: every Lunch range is Afternoon, and a Lunch 13:00–15:00 touching Afternoon
    15:00–20:00 becomes one Afternoon 13:00–20:00; a cell with a Lunch line names Afternoon; a cell
    with both keeps its Afternoon line and loses Lunch's; today's extension names Afternoon; a past
    one-off special day's Lunch paint becomes Afternoon too.
  - Refusals by code: a replacement of another department → `menu_period.invalid` field
    `replacementPeriodId`; the period itself → same; **review focus 5:** a replacement whose end
    offset clashes with the next placement → `menu_timetable.invalid` reason `end_offset`, and
    nothing changed (read all four places back).
  Expected: fail.
- [ ] **Step 2: Implement** in the caller's transaction: routing lines — delete the deleted
  period's line where the cell already has the replacement's, THEN update the rest (the order keeps
  `routing_cell_periods_cell_period_key` satisfied at every statement, CLAUDE.md §3); ranges updated
  then re-joined per day; extension updated (`period_extensions_day_key` is per department and day,
  so it is an update); then delete the period; then the end-offset check. **Step 3:** run.
  **Commit**.

### Task 10.3: Routes

**Files:** `routes.ts` (`GET …/menu-periods/painted-in`, `GET …/menu-periods/:periodId/delete-impact`
viewed; `POST …/menu-periods/:periodId/delete` with `{ replacementPeriodId: string | null, expectedClockRevision: number }`
gated), tests, `docs/developers/conventions-data.md` (delete semantics), backlog progress
- [ ] Failing route tests → implement → run → **Commit**, `/finish-branch`.

---

# A506-11 — The Periods page and the period dialog

**Spec:** §8, §10.5, mockups 6–9, §12 links (readiness → the Periods page).

**Review path:** FULL (the dashboard switches to A506-10's delete route, which rewrites painted
hours, routing lines and today's extension that the till reads). **Migration:** no.

**Behaviour this PR removes:** the Opening hours Periods tab, `period-editor.ts`, today's
`DELETE …/menu-periods/:periodId` route, `deleteMenuPeriod`, `periodUses`, `MenuPeriodUse` and the
code `menu_period.in_use` (with its `strings.ts` message `menu.period_in_use`).

### Task 11.0: Re-check on the base; A493's grouping pattern landed.

### Task 11.1: The period dialog

**Files:** Create dashboard `period-dialog.ts` (+ `.test`, `.unsaved`, `.a11y`): name, colour,
customer menu (with what it includes — the model's `menus[].includes`), staff-only menus, floor
plan (greyed until A504), Painted in (each opens its painter). Opened as "Edit" or as "Add and paint
with it" (mockup 9). Save quiet until a change; saves on its own.
- [ ] Failing browser tests → implement → run → **Commit**.

### Task 11.2: The delete dialog

**Files:** Create `period-delete-dialog.ts` (+ tests): mockup 8 — where it is painted (counts),
which routing cells name it, a replacement choice from the same department ("None"), the sentence
about today's extension when `keptOpenToday`; calls `POST …/delete`.
- [ ] Failing browser tests (with and without replacement; a refusal shown beside the action) →
  implement → run → **Commit**.

### Task 11.3: The Periods page

**Files:** Create `periods-screen.ts` (+ `.test`, `.a11y`); `dashboard/index.ts` (a `moreScreens`
entry `id: "periods"`, `navLabelKey: "nav.periods"`, `group: "operations"`, order between Opening
hours (15) and Prep stations (30), `requiresPermission: "venue_service.manage"`,
`readPermission: "venue.view"`); `apps/dashboard/src/navigation.ts`; `strings.ts`

Mockup 6: one `wt-data-table`, periods grouped under their department as A493 groups zones;
columns Period (colour and name), Customer menu, Staff-only menus, Floor plan (greyed), Painted in
("Not painted anywhere" flagged); the row menu column keyed `actions`, `pinned: "end"` (Edit, Open in
Opening hours, Delete); cell markup styled with `part=`/`::part()`.
- [ ] Failing browser tests → implement → `scripts/pinned-actions-column.test.ts` → run → LOOK →
  **Commit**.

### Task 11.4: Wire up and retire

**Files:** the painters' ✎ and "+ New period" open `period-dialog.ts`; the painter bar links to
the Periods page; `department-page.ts`/`departments-list.ts` readiness links → the Periods page;
Opening hours' Periods tab removed; old route, `deleteMenuPeriod`, `periodUses`, `MenuPeriodUse`,
`menu_period.in_use` retired (tests listed under "Changed test checks"); guards
`scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`; `design-system.md`; backlog
progress → **Commit**, `/finish-branch`.

---

# A506-12 — Prep station Times; the last of the old tabs goes

**Spec:** §9 (Q3), §12 rows `stationServiceTimes` and the station link, §15 slice 6.

**Review path:** LIGHT. **Migration:** no. **Waits for A507 to land.**

**Behaviour this PR removes:** the station view inside Opening hours (`opening-hours-station.ts`),
the All departments week view (`opening-hours-all.ts`) if anything is left of it, the `week=normal`
mode of `GET …/stations/:stationId/service-times`, `service-grid.ts` if now unused.

### Task 12.0: Re-check on the base; read A507 as landed. Q3 is answered (c): a Prep stations tab.

### Task 12.1: Station times per date from the resolver

**Files:** `station-service-times.ts` (each date via `resolveDepartmentDays`/`resolveZoneClosedDays`
and routing; the `week` parameter removed; at most 42 days as today), tests, `routes.ts`
- [ ] Failing test: on a special date painting Dinner 19:00–01:00 for a station that makes only
  Dinner dishes, the station's day reads 19:00–01:00 (Q3's worked example); `week=normal` refused
  `management.request_invalid` → implement → run → **Commit**.

### Task 12.2: The Times page

**Files:** Create dashboard `station-times-screen.ts` (+ `.test`, `.a11y`); modify
`prep-stations-screen.ts` (a fourth tab, "Times"), the dashboard address for that tab
(`apps/dashboard/src/navigation.ts` if the Prep stations tabs are named there),
`opening-hours-client.ts` or `routing-client.ts` (whichever A507 left the station reads in),
`strings.ts`
- [ ] Failing browser tests: the "Times" tab shows a station picker at the top (owner, question 3
  (c)) and, for the chosen station, the month view of A506-7's layout, read-only, one bar per day,
  ‹ › months; changing the station redraws the month; the tab and station survive a reload through
  the address → implement → run → LOOK → **Commit**.

### Task 12.3: Remove what is left; close the backlog

**Files:** deleted views and their tests; `opening-hours-screen.ts`; `docs/developers/design-system.md`
(every remaining claim about the Week, Day, Calendar, Real week or station view); `docs/backlog.md`
(delete the A506 entry); `docs/backlog/service-periods.md` (delete the A506 section; decisions cited
elsewhere move to `## Decisions and deliberate limits`; open points become short entries — at least
"A504's floor plan per period" from spec §17)
- [ ] Grep proof `rg -n 'opening-hours-(station|all|week|day|zone-week|date)|real-week|hours-calendar|named-day-(editor|copy)|named-days-client|named-day-rules' packages apps docs/developers`
  (A506-5 renamed `named-day-rules.ts` to `repeat-rules.ts`, so no live name is caught)
  answers nothing → run → LOOK → **Commit**, `/finish-branch`. If A507 holds this PR back and
  A506-11 lands last, A506-11 carries the backlog deletion instead and A506-12 adds its own entry's
  removal.

---

## Self-review against the spec

- §1–3: context only. §4 → A506-1 (storage, defaults, business-day season), A506-6 (move, add,
  remove, rename, codes, immediate effect). §5 → A506-4 (storage use, layering, Closed tick, date
  ownership, repeats, 29 February), A506-5 (two kinds, Calendar), A506-9 (painter, holiday
  pre-fill, Q2 note). §6 → A506-1 (steps 1–3, day before), A506-4 (steps 4–6, clock skips), A506-2
  and A506-4 (end-offset set), A506-6 (rerun on season changes). §7 → A506-1, A506-3 (summary),
  A506-4 (zone Open), A506-8 (zone painting). §8 → A506-10, A506-11. §9 → A506-12. §10.1 → A506-6;
  §10.2 → A506-7; §10.3 → A506-8; §10.4 → A506-4 (server half), A506-9; §10.5 → A506-11; §10.6 →
  A506-8 and A506-9. §11 → A506-1, A506-5. §12 → every row is owned by a task (table in "The pull
  requests"). §13 → A506-4, A506-6, A506-10, A506-11 (routes); codes in A506-1, A506-4, A506-5,
  A506-6, A506-11. §14 → the 2030 test (resolver days Task 1.4; `resolveDepartmentService` and the
  till routes Task 1.5), the §14 list (Tasks 4.1–4.4), save-keeps (Tasks 4.3, 9.4), period delete
  (Task 10.2), end offsets (Tasks 2.3, 4.4, 6.1 — added, deleted, moved), browser and LOOK (every UI
  task). §15 → the PR order. §16 → the questions table. §17 → A495's check moved in Tasks 2.4
  (seasons), 4.4 (special-day paint) and 5.7 (old tables gone). Import checks on dated paint and
  end offsets (§6, §12) → Tasks 1.6, 2.3, 4.6.
