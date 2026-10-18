# A723 — the season painter and the special-day editor say what they are, close on Save, and keep a zone's closures inside opening hours — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** The season painter is titled "Autumn: standard week" with a line saying which weeks it
edits, loses the "… follow Santet Deli Co" note, and offers "✎ Edit" on each period chip; Save closes
both painters; a zone's Closed paint is cut to the times its department is open, and the server
refuses a zone closure outside its department's hours from every route that writes one; the
special-day editor's Range button goes, a click adding or removing a date and a drag or a
shift-click adding a run.

**Architecture:** (1) **One pure rule** in the browser-safe `zone-own-hours.ts`:
`closureOutsideHours` (server) and `closuresInHours` (browser). (2) **Server:** a new
`zone-closure-hours.ts` reads the department's hours after the write, inside the same transaction,
and throws the new reason `outside_hours` (`zone_closed_time.invalid` on the season routes,
`special_day.invalid` on the special-day routes); the three write routes call it, and the configuration import runs the pure rule in `validateSeasonWeeks`. The demo seed's
Terrace closure moves inside the Restaurant's hours. (3) **Browser:** `paint-grid` gains
`closedWithin`, cutting every Closed block it emits to the column's open blocks, and
`closedBehind`, a "<department> closed all day" block drawn behind a zone's paint; both painters
pass their department's hours there, cut a zone's day when its department's day changes, and show
the new refusal beside the day. The screen closes a painter
when it reports a clean save. `add-dates-calendar` drops its own click and arrow handling for
`DayPicker` (with `dragOnTouch`), which gains a `ranged` callback.

**Tech Stack:** TypeScript, Lit, Hono routes, drizzle-orm on SQLite (`node:sqlite`), Vitest. Tests
under `packages/venue-service/src/dashboard/` run in real headless Chromium (`--project browser`);
every other venue-service test runs in `--project node` (`packages/venue-service/vitest.config.ts:12-31`).

**Spec** (read all of it before any task):

- `docs/backlog.md:1459-1463`, the A723 entry: "'Autumn: standard week' with a line saying what it
  edits; Save closes; a zone's Closed paint is clipped to its department's hours; a visible Edit on
  period chips; no Range button."
- `docs/backlog/service-periods.md:166-192`, "## A723. …", its seven points (quoted in the tasks).
- Mockups — open and look at both: `docs/backlog/mockups/a718-a727-calendar-and-stations/06-season-painter.png`
  (notes A–E) and `07-special-day-editor.png` (notes 1–2).
- `docs/developers/design-system.md:2158-2223` (the season painter and special-day painter
  paragraphs; point 4 changes the sentence "the painter stays open and the answer becomes the saved
  state", `:2205`).
- Not this item: A762 (`docs/backlog/service-periods.md:194-210`) — colour bands and the staffing
  painters.

**Files:**

| File | Change |
| --- | --- |
| `packages/venue-service/src/zone-own-hours.ts` (+ `.test.ts`) | `closureOutsideHours`, `closuresInHours` |
| `packages/venue-service/src/zone-closure-hours.ts` (new, + `.test.ts`) | the server check, two entry points |
| `packages/venue-service/src/errors.ts:182-193` | `zone_closed_time.invalid` gains `outside_hours`, `zoneId`, `weekday`; `special_day.invalid` gains `outside_hours` |
| `packages/venue-service/src/routes.ts:582-622`, `:1285-1336` | the three write routes call the check |
| `packages/venue-service/src/configuration-transfer.ts:258-358` | the import refuses an out-of-hours zone closure |
| `apps/server/scripts/demo-seed/seed.ts:143-153` | Terrace closes 23:00–00:00 |
| `packages/venue-service/src/dashboard/paint-grid.ts` | `closedWithin`, `closedBehind`, `paint-outside` |
| `packages/venue-service/src/dashboard/season-painter.ts` | title, line, no follows note, `closedWithin`, saved event |
| `packages/venue-service/src/dashboard/special-day-painter.ts` | `closedWithin`, refusal, saved event's `clean`, `remove-dates` |
| `packages/venue-service/src/dashboard/painter-labels.ts:63-71` | the `outside_hours` wording |
| `packages/venue-service/src/dashboard/paint-row.ts:155-168` | "✎ Edit" |
| `packages/venue-service/src/dashboard/opening-hours-screen.ts:1066-1135` | closes a painter on a clean save |
| `packages/venue-service/src/dashboard/day-picking.ts` | `ranged` option |
| `packages/venue-service/src/dashboard/add-dates-calendar.ts` | `DayPicker`, toggle, runs, hint; no Range |
| `packages/venue-service/src/dashboard/strings.ts` | the strings below |
| `packages/venue-service/src/testing/season-painter-fixture.ts` | exports `withDays` (moved from `season-painter.save.test.ts:772-794`) |
| `docs/developers/design-system.md`, `docs/backlog.md`, `docs/backlog/service-periods.md` | Task 13 |

**Review path: FULL.** The branch adds a server refusal to three write routes and the
configuration import (a cross-package contract: `apps/server` provisions through
`validateSeasonWeeks`), and changes how two editors close. Per-task reviews, then `/finish-branch`
with the Codex run-it seat twice (the second told to set this plan aside and test what it does not
name).

**Migration: no.** The rule compares a zone's ranges with its department's ranges for the same
season and weekday, or for a special date resolved through its season — rows of
`zone_day_ranges`, `zone_days`, `department_days`, `department_day_ranges`, `special_day_dates` and
`seasons` (`packages/venue-service/src/schema/seasons.ts:67-229`). A CHECK constraint sees one row
only, and a trigger would have to repeat the season and special-day resolution
(`resolveDepartmentsDays`, `day-resolver.ts:134-172`) in SQL. Every other paint rule (15-minute
steps, overlaps, end offsets) already lives in the write path, not the schema. No stored data is
rewritten: before go-live a venue may be reset (CLAUDE.md §3, "No backwards-compatibility or
data-migration code until Waitron is in production"), and Task 4 corrects the one seeded closure
that breaks the rule.

---

## What the code does today (checked)

- **Every server writer of zone closure paint** (traced with `git grep` for `zone_day_ranges`,
  `zoneDayRanges`, `replaceZoneClosedWeek`, `saveSeasonWeeks`, `saveSpecialDay`, `zonePaint`):
  - A. `saveSeasonWeeks` (`season-weeks.ts:306-373`), via `stageZoneClosedWeek`
    (`zone-closed-times.ts:55-115`), behind `PUT /management-api/venue-service/seasons/:seasonId/weeks`
    (`routes.ts:1285-1315`). Body `{ departments?, zones?: [{ zoneId, days: [{ weekday, ranges }] ×7 }],
    expectedClockRevision }`; departments are staged before zones but the staged week is not
    returned. A refusal's `field` is `zones.<i>.days.<j>…`, `<j>` the index in `days`
    (`within`, `:289-302`).
  - B. `replaceZoneClosedWeek` (`zone-closed-times.ts:30-51`) behind
    `PUT /management-api/venue-service/zones/:zoneId/closed-week` (`routes.ts:1317-1336`; the route
    requires `seasonId`). No dashboard screen calls it; the demo seed does (F).
  - C. `saveSpecialDay` (`special-days.ts:1033-1189`; zone rows `:1168-1186`, `kind` `closed` or
    `open`) behind `POST …/special-days` and `PUT …/special-days/:id` (`routes.ts:582-622`). Each
    (owner, date) entry sent is replaced whole; entries not sent are kept.
  - D. The configuration import: `validateSeasonWeeks` (`configuration-transfer.ts:258-358`)
    checks `zone_day_ranges` rows' shape only; `apps/server/src/configuration-transfer.ts:618`
    inserts them. Its refusals are `setup.request_invalid { field: <table> }` (`:38-55`).
  - E. A season split copies stored zone weeks (`seasons.ts:174-187`) — copies only what is stored,
    so it writes nothing new.
  - F. The demo seed (`apps/server/scripts/demo-seed/seed.ts:143-153`) closes Terrace 23:00 → the
    changeover on all seven days; Terrace's department is open 09:00–00:00
    (`apps/server/scripts/demo-seed/seed-floor.ts:213-222`), so 00:00 → changeover is outside it.
  - Clears and deletes (`writeZoneSeasonWeeks` delete-then-insert, `deleteSpecialDay`,
    `clearServiceDeleteSettings`, cascades) cannot create a closure.
  - Paths that change a department's hours and leave its zone closures as stored (Decision 3):
    the department side of A and C, `replaceMenuWeek` (`routes.ts:1264`), period delete
    (`period-delete.ts:222-227`, `:346`), and moving a zone to another department (`configureZone`,
    `operations.ts:382-430`).
- **A zone's department:** `zone_service_policies.department_id` (`schema/service.ts:51-75`);
  `readServiceZones` (`zone-closed-times.ts:118-137`) returns `{ id, name, departmentId }` for active
  zones of active departments.
- **Department hours after a write:** `readDepartmentSeasonWeeks(tx, cfg, departmentIds, cutover)`
  (`season-weeks.ts:196-244`) → `Map<departmentId, Map<seasonId, ServiceRange[][]>>` indexed by
  weekday; `resolveDepartmentsDays(tx, cfg, departmentIds, dates, clock)` (`day-resolver.ts:134-172`)
  → each date's ranges, the special-day paint laid over the season (a Closed department paint cuts,
  `layerPaint`), `[]` on a date closed all day.
- **Displays already cut closures to department hours:** `zoneOwnHours`
  (`zone-own-hours.ts:36-73`, "the zone's closures cut to the times its department is open"), used by
  `opening-hours-day.ts:89`, `opening-hours-month.ts:376`, `week-rows.ts:119`. Its `placeOnDay`
  places a range in minutes after the changeover (an end at or before the start falls a day later;
  an end past `endMinute` is cut).
- **Today nothing refuses a zone closure where its department is closed**, and the painters do not
  cut one: `paintStretch` (`paint-model.ts:23-36`) layers the stroke over the day as drawn.
- **Refusal display:** the season painter maps `field` `^(departments|zones)\.(\d+)(?:\.days\.(\d+))?`
  to an owner and weekday, switches the picker, marks the column and says "<name>, <day>: <reason>"
  beside Save (`season-painter.ts:516-551`); the reason comes from `refusalReason`
  (`painter-labels.ts:63-71`, which gives `zone_closed_time.invalid` the 15-minute/overlap sentence).
  The special-day painter handles only `special_day.invalid` paint fields (`refusePaint`,
  `special-day-painter.ts:1007-1057`).
- **Save today:** the season painter commits the sent weeks as its baseline and stays open
  (`season-painter.ts:458-514`); the special-day painter adopts the answer, fires
  `special-day-saved` `{ detail }` and stays open (`special-day-painter.ts:876-937`). Delete closes
  the special-day painter by setting `open = false` (`:1084-1085`). Only `opening-hours-screen.ts`
  hosts either painter (`:1066-1135`); `closePainter()` (`:1059-1064`) goes back to a pushed entry or
  replaces the address with the view it drew over. `painter-frame` is shared with the staffing
  painters (`packages/staffing/src/dashboard/staffing-*-painter.ts`).
- **`add-dates-calendar`** (`add-dates-calendar.ts`) handles its own clicks, shift-clicks, a Range
  toggle (`special.range`, `special.range_last`) and arrow keys; it only ever sends `add-dates`.
  `DayPicker` (`day-picking.ts`) has `dragOnTouch` (a touch drag picks a run with no long press),
  added by A720 Part 4 and used by no host yet; the Year and Month use it without
  (`opening-hours-year.ts:208`, `opening-hours-month.ts:335`).

### Receipts for the decisions below (measured 2026-10-18, throwaway worktree at `519899579`, since removed)

- **Check inside the three writer functions:** a crude after-write check added to
  `replaceZoneClosedWeek`, `saveSeasonWeeks` and `saveSpecialDay` failed **83 of 1421** tests in the
  39 venue-service test files naming them (11 files: `keep-open` 24, `zone-closed-times` 23,
  `season-weeks` 9, `station-service-times` 7, `day-resolver` 7, `menu-timetable-routes` 5,
  `business-day-schedule` 3, `service-delete-settings` 2, `special-days`, `menu-timetable`,
  `department-transfers` 1 each) and **40 of 714** in 14 `apps/server` files (`till-api.keep-open` 18,
  the demo seed's suites, `demo-clock-profiles`). Every failure printed the probe's
  `PROBE_OUTSIDE` line: test set-ups that close a zone where its department has no hours.
- **The same check at the three routes instead** failed **5 of 405** in the 9 venue-service files
  that call those routes, all in `menu-timetable-routes.test.ts` (a 23:00–06:00 closure on a
  department open 09:00–12:00 or not at all); `apps/server/src/management-api.test.ts` passed 159
  of 159.
- **The import, season weeks only:** 8 failures in
  `packages/venue-service/src/configuration-transfer.test.ts` ("season weeks in a configuration
  bundle", its fixture closing 23:00–04:00 against 22:00–02:00); `apps/server`
  `configuration-transfer.test.ts` and `setup-api.test.ts` passed 391 of 391.
- **Save closing inside the painters** (`open = false` after a clean save) failed **32 of 413** in
  15 painter and screen files: 14 in `season-painter.save.test.ts`, 8 in
  `season-painter.races.test.ts`, 8 in `special-day-painter.races.test.ts`, 2 in
  `special-day-painter.save.test.ts` — every one a case about what a painter does after a save
  while it stays open.

## Decisions this plan makes (defaults; each may be overruled)

1. **The server check runs at the three write routes and in the import, not inside
   `saveSeasonWeeks`, `replaceZoneClosedWeek` and `saveSpecialDay`.** Each route calls it in the
   same transaction, right after the writer. Spec point 5 says "from any route"; the receipts show
   the writer-level check breaking 123 test set-ups that use the writers to build zone states, against
   5 route tests. A direct caller of the writers (tests, the demo seed) is not checked; Task 4 still
   corrects the seed.
2. **One reason, `outside_hours`, on each route's own code.** The season-week and closed-week
   routes throw `zone_closed_time.invalid` (the code they already use for closures) with `field`
   (the refused range's request path), `reason: "outside_hours"`, `zoneId` and `weekday`. The
   special-day routes throw `special_day.invalid` with `reason: "outside_hours"`, `field:
   "zonePaint.<i>.ranges.<k>"`, `zoneId` and `date` — the code and params every other special-day
   paint refusal already carries, so the special-day painter's `refusePaint` reads it as it is
   (Task 9a). The import keeps its convention, `setup.request_invalid { field: "zone_day_ranges" }`.
3. **On the server, only the zone closures a request writes are checked**, against the
   department's hours as that request leaves them. A write that changes only a department's hours
   — the menu-week route, period delete, moving a zone to another department, an API call sending
   only a department — is not refused and does not cut stored zone closures; such a stretch stays
   stored, the views already cut it, and a later save of that zone is refused naming that day until
   the stretch is removed or repainted. Owner FYI; filed as an open point (Task 13). **Inside the
   painters this does not arise:** when a department's draft day changes, each of its zones' draft
   days is cut to it, so one Save sends the department and the cut zones together (Tasks 8b, 9b).
4. **A special-day zone's Open paint is not bounded, and a date ticked closed all day is not
   checked** — the resolver ignores zone paint there (`day-resolver.ts:209-213`).
5. **The painters cut the days you change, and nothing on Save.** `paint-grid` cuts the whole day
   it emits (so any stroke, block change, copy or clear on a zone's day also cuts an older
   out-of-hours stretch there), and a department's changed day cuts its zones' same day (Decision
   3); a day nobody changed is never cut, so a stored out-of-hours stretch on it (from a server-side
   department change) is still refused at Save, marking that day. A stroke cut to nothing says why
   beside Save (`opening.closed_outside`).
6. **The screen closes a painter, not the painter itself.** After a successful save each painter
   reports `clean` — true when nothing was painted while the save was in flight — and the screen
   calls `closePainter()` on a clean save. A paint made during the save keeps the painter open,
   unsaved. Receipt: closing inside the painters broke the 32 after-save cases listed above, and
   `painter-frame` is shared with the staffing painters, whose Save stays as it is (A762's).
7. **A zone's day when its department is closed is drawn as the mockup's Monday: a full-day
   hatched block "<department> closed all day" BEHIND the zone's paint.** Not paint-grid's
   `closedAllDay`, which hides the day's paint: any stored stretch stays drawn on top, so a stretch
   a Save is refused for can be seen and deleted. Strokes there are cut to nothing (and say so,
   Decision 5).
8. **Wording.** English "standard" everywhere a season's week is named. Spanish "semana estándar",
   the staffing painter's title (`packages/staffing/src/dashboard/strings.ts:423`), in every Spanish
   string naming a season's week — `day.edit_week`, `day.show_week` and `hours.delete_confirm`'s
   "semana habitual" included. `day.standard` ("Horario habitual de {season}") names hours, not a
   week, and stays.
9. **The special-day editor keeps its heading (the day's name) and gets no "which dates" line**:
   point 2 names the season painter, and mockup 07 shows neither. A762's "Foo: special day,
   12–15 Feb" is A762's to decide. (2026-10-18: superseded by A762's plan, Decision 3: the editor
   is titled "<name>: special day, <dates>".)
10. **The line sits in the painter's `row` slot**, above the paint row, not in a new `painter-frame`
    slot, so the frame the staffing painters share does not change.
11. **"+ Add dates…" stays a toggle.** Point 7 removes only Range.
12. **Shift+arrow adds the run too** (the keyboard's shift-click); arrows alone only move. A drag
    adds its run when released, the run under way drawn marked; a run of more than 366 dates adds
    nothing and says so, as today.
13. **The demo seed closes Terrace 23:00–00:00**, the Restaurant's close.
14. **The chip's edit control reads "✎ Edit"**; its accessible name stays "Edit <period>".

## Global constraints

- **Worktree:** `/Users/clintongormley/workspace/worktrees/waitron-feat-a723-painters-standard-week`,
  branch `feat/a723-painters-standard-week`. Every commit `git commit -s`; stage explicit paths. One
  pull request.
- **Test first.** Each task writes its failing test, runs it, sees it fail for the stated reason,
  then writes the code.
- **Task size.** Each task is meant to finish well under 100 tool calls. An implementer past about
  150 with its task unfinished stops at a passing or cleanly red point, commits, and hands over:
  done, left, files, each check's state.
- **Focused runs** (check `memory_pressure | grep free` first):

  ```bash
  pnpm --filter @waitron/venue-service exec vitest run --project node src/<file>.test.ts
  pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/<file>.test.ts
  pnpm --filter @waitron/server exec vitest run <path>.test.ts
  ```

  Read the `Tests` count; a run without one proves nothing. Unset `AI_AGENT` and `CLAUDECODE` to see
  a passing test's console output. CI runs the package suites and coverage (98/98/98/95); no
  whole-workspace local run (CLAUDE.md §2).
- **Every dispatch** also runs `pnpm format:check`, and `pnpm --filter <pkg> typecheck` and `lint`
  for each package it touched and each package that imports what it changed (`@waitron/server`
  imports venue-service; `@waitron/staffing` imports `@waitron/venue-service/painter`). **Every commit
  leaves typecheck green across the workspace.**
- **Changing an existing test check** is allowed only where the spec changes what it checks (owner
  decision 2026-10-05). Each task lists them under "Existing checks that change"; the PR description
  repeats the union under **"Changed test checks"**. A failing assertion a task does not list is a
  STOP: report it, do not change it. Set-up added to put a department's hours under a zone's
  closure is setup, listed too, with the assertions after it unchanged. No golden, fiscal or
  `scripts/` guard test is touched.
- **Database tests** use `useVenueDb`; a refusal is caught outside the `withTransaction`; a refused
  write asserts the domain code and its params (CLAUDE.md §3, §4).
- **Browser tests:** history through a `pushState`/`replaceState` spy; a close awaited by its event;
  widths by `page.viewport(w, h)` with `window.innerWidth` asserted; a test setting Spanish restores
  English in `afterEach`; a click whose outcome depends on listener order uses `userEvent.click`;
  drags through `commands.mouseDrag` / `commands.touchGesture` as `day-picking.test.ts` does.
- **UI rules:** tokens only (`scripts/style-token-names.test.ts`); app events named plainly,
  `{ bubbles: true, composed: true }`, payload in `detail`, the listener calls
  `event.stopPropagation()` first.
- **Ledger:** `docs/handoffs/2026-10-18-a723-painters-standard-week.md` (gitignored), opening
  `Status: in progress`; updated at the end of every task; `Status: done` when the PR lands.

## Strings (`packages/venue-service/src/dashboard/strings.ts`, English then Spanish)

| Key | English | Spanish |
| --- | --- | --- |
| `painter.week` (`:182`, `:1023`) | `{season}: standard week` | `{season}: semana estándar` |
| `painter.week_covers` (new) | `Every week from {from} to {to} opens these hours, except on special days.` | `Cada semana del {from} al {to} abre con este horario, salvo los días especiales.` |
| `painter.edit` (new) | `Edit` | `Editar` |
| `opening.closed_outside` (new) | `A zone can only close while its department is open.` | `Una zona solo puede cerrar mientras su departamento está abierto.` |
| `special.pick_hint` (new) | `Click a date to add or remove it. Drag, or shift-click, to add several.` | `Haz clic en una fecha para añadirla o quitarla. Arrastra, o haz clic con Mayús, para añadir varias.` |
| `opening.follow_week` (`:154`, `:995`) | `Follow the standard week` | `Seguir la semana estándar` |
| `menu.normal_week` (`:767`, `:1626`) | `Standard week` | `Semana estándar` |
| `hours.menu_delete_clash` (`:594`, `:1447`) | "…{department}'s standard menu week…" | "…la semana estándar de cartas de {department}…" |
| `season.week_named` / `season.week_shown` (`:94-95`, `:935-936`) | `…, edit the standard week` / `…, show the standard week` | `…, editar la semana estándar` / `…, ver la semana estándar` |
| `day.edit_week` / `day.show_week` (`:978-979`) | unchanged | `Editar la semana estándar de {season}` / `Ver la semana estándar de {season}` |
| `hours.delete_confirm` (Spanish `:1492`) | unchanged | `¿Borrar {name} del {date}? Su horario vuelve a ser el de la semana estándar.` |
| `painter.department_closed` (new) | `{department} closed all day` | `{department} cerrado todo el día` |
| deleted | `painter.zone_follows`, `painter.zones_follow`, `special.range`, `special.range_last` | |

`opening.follow_week` and `menu.normal_week` have no reader (`git grep` finds only `strings.ts`);
they are reworded per point 1 and filed as unread (Task 13). No test pins "semana habitual" or
"semana normal" (`git grep` over `packages/**/*.test.ts` and `apps/**/*.test.ts`).

## Review Focus

1. **A closure dragged across midnight past the department's close** (Terrace 23:30 → 03:00,
   Restaurant to 02:00, changeover 06:00 and 05:00). Expected: 23:30–02:00 kept. Pinned in Task 1
   and Task 5.
2. **A closure across two touching periods** (Lunch 13:00–16:00, Dinner 16:00–23:00, closure
   15:00–17:00). Expected: one block 15:00–17:00, accepted by the server. Pinned in Tasks 1, 2a and 5.
3. **A stroke wholly where the department is closed** (a zone's Monday on a closed Monday).
   Expected: no `paint-change`, Save stays quiet, and beside Save "A zone can only close while its
   department is open." Pinned in Task 5 and Task 8a.
4. **A new special day saved from a run picked on the Month.** Expected: the editor closes, the
   address returns to the Month it opened over, and Back does not reopen the editor. Pinned in
   Task 10b.
5. **Paint made while a save is in flight.** Expected: the painter stays open, that paint unsaved;
   nothing painted is lost. Pinned in Task 10a.
6. **Shrinking a department's day under a zone's closure, then Save.** Expected: one request
   sending the department and the zone cut to it; no refusal. Pinned in Tasks 8b and 9b.

---

## Task 1: The rule, once — `closureOutsideHours` and `closuresInHours`

**Files:** Modify `packages/venue-service/src/zone-own-hours.ts`; Test `zone-own-hours.test.ts`.

**Interfaces — Produces** (browser-safe: type imports only, as the file says at `:1`):

```ts
/** The index of the first closure not wholly inside the department's ranges, or -1. */
export function closureOutsideHours(
  department: readonly ClosedRange[],
  closures: readonly ClosedRange[],
  day: { dayCutover: string; endMinute: number },
): number;
/** The closures cut to the department's ranges: what lies outside is dropped, and pieces that
 *  touch join. In day order. */
export function closuresInHours(
  department: readonly ClosedRange[],
  closures: readonly ClosedRange[],
  day: { dayCutover: string; endMinute: number },
): ClosedRange[];
```

Both place ranges with `placeOnDay`; a closure inside the union of touching department ranges is
inside (Review Focus 2).

- [ ] **Step 1: failing tests** in `zone-own-hours.test.ts`, `day = { dayCutover: "06:00", endMinute: 1440 }`:
  - "closureOutsideHours: -1 when every closure lies in the hours, the index of the first that does not":
    `[dinner 20:00–02:00]`, `[21:00–22:00, 23:30–03:00]` → `1`; `[21:00–22:00]` → `-1`; any closure
    with no department ranges → `0`; no closures → `-1`.
  - "a closure across two touching periods is inside": `[13:00–16:00, 16:00–23:00]`,
    `[15:00–17:00]` → `-1`; `closuresInHours` → `[{ 15:00–17:00 }]` (one block).
  - "closuresInHours keeps 23:30–02:00 of 23:30–03:00" (dept 19:30–02:00), and with
    `dayCutover: "05:00"` the same; a closure ending at the changeover (`23:00–06:00`, dept
    `09:00–00:00`) → `[{ 23:00–00:00 }]`; a closure wholly outside → `[]`.
  - "a closure split by a gap in the hours comes back as two pieces": dept `[12:00–15:00,
    19:00–23:00]`, closure `14:00–20:00` → `[14:00–15:00, 19:00–20:00]`.
- [ ] **Step 2:** `pnpm --filter @waitron/venue-service exec vitest run --project node src/zone-own-hours.test.ts` — FAIL (not exported).
- [ ] **Step 3:** implement both beside `zoneOwnHours`.
- [ ] **Step 4:** run again — PASS; `typecheck`, `lint`.
- [ ] **Step 5:** `git commit -s -m "A zone closure's rule against its department's hours, in one place (A723)"`

**Existing checks that change:** none.

## Task 2a: The season-week and closed-week routes refuse an out-of-hours closure

**Files:** Create `packages/venue-service/src/zone-closure-hours.ts`; Modify `errors.ts:193`,
`routes.ts:1285-1336`; Test `menu-timetable-routes.test.ts`, new `zone-closure-hours.test.ts`.

**Interfaces — Consumes:** Task 1. **Produces:**

```ts
/** After a season-week write, inside its transaction: each listed zone's closures against its
 *  department's week in `seasonId` as now stored. `field` is the request path up to `days.`
 *  ("" or "zones.<i>."). Throws zone_closed_time.invalid
 *  { field: `${field}days.${j}.ranges.${k}`, reason: "outside_hours", zoneId, weekday }. */
export async function assertSeasonClosuresInHours(
  tx: Transaction,
  cfg: VenueScope,
  seasonId: string,
  zones: readonly {
    zoneId: string;
    field: string;
    days: readonly { weekday: number; ranges: readonly ClosedRange[] }[];
  }[],
): Promise<void>;
```

`errors.ts`: `"zone_closed_time.invalid": { field: string; reason?: "empty" | "order" | "step" |
"overlap" | "outside_hours"; zoneId?: string; weekday?: number }`. The department of
each zone comes from `readServiceZones`; its week from `readDepartmentSeasonWeeks(tx, cfg, ids,
clock.dayCutover)`; `day = { dayCutover: clock.dayCutover, endMinute: 1440 }`. In `routes.ts` the
season-weeks handler calls it after `saveSeasonWeeks` with `zones.map((z, i) => ({ zoneId: z.id,
field: \`zones.${i}.\`, days }))`; the closed-week handler after `replaceZoneClosedWeek` with
`[{ zoneId, field: "", days: body.days }]` and the body's `seasonId`. Both inside the one `gated`
transaction, so a refusal stores nothing.

- [ ] **Step 1: failing tests**
  - `menu-timetable-routes.test.ts`, new under "the season weeks route":
    **"refuses a zone closure outside its department's hours, naming the range, and stores
    nothing"** — department Monday 09:00–12:00 and zone Monday `[10:00–11:00, 11:30–13:00]` in one
    body → 400 `{ code: "zone_closed_time.invalid", params: { field: "zones.0.days.1.ranges.1",
    reason: "outside_hours", zoneId: r.barra, weekday: 1 } }`, model unchanged (`days` index 1 is
    weekday 1 in `closedWeek`); **"checks the zone against the department week the same request
    sends"** — the stored week is closed; the body opens Monday 09:00–12:00 and closes the zone
    10:00–11:00 → 204; **"accepts a closure across two touching periods"** (Review Focus 2).
  - under "zone closed-time routes": **"refuses a closed week outside its department's hours"** →
    400 with `field: "days.1.ranges.0"`, `weekday: 1`, `zoneId`.
  - `zone-closure-hours.test.ts` (node, `useVenueDb`), calling `assertSeasonClosuresInHours`
    directly after storing a department week: a closure inside passes; one running past the close
    throws with `field`, `zoneId` and `weekday`; a weekday the department has no hours on throws;
    the department of a zone moved to another department is the one now stored.
- [ ] **Step 2:** run `src/menu-timetable-routes.test.ts` and `src/zone-closure-hours.test.ts` — the
  new cases FAIL (204 where 400 expected).
- [ ] **Step 3:** implement; update the five set-ups below.
- [ ] **Step 4:** both files PASS; `typecheck`, `lint` for venue-service and `@waitron/server`.
- [ ] **Step 5:** `git commit -s -m "The season-week and zone closed-week routes refuse a zone closure outside its department's hours (A723)"`

**Existing checks that change** (all in `packages/venue-service/src/menu-timetable-routes.test.ts`;
each sends a 23:00–06:00 closure on a department closed then or open 09:00–12:00, which point 5
makes a refusal — receipt above):
- `:785-821` "writes a week and reads its zone ranges": add a department Monday 09:00–12:00 write
  before it (setup); `:787` ranges → `10:00–11:00`. The assertions compare with `days`, unchanged.
- `:876-893` "a zone week writes the season it names and no other": department Monday 09:00–12:00 in
  `named` first (setup); `:879` → `10:00–11:00`.
- `:902` (`writes(r)`, used by `:939-955` "refuses a changing week save…" and the refusal cases at
  `:905-937`): `23:00–06:00` → `10:00–11:00` (inside the 09:00–12:00 written just before it).
- `:963` (`closed`, used by `:969-989` and `:1108-1133`): `23:00–06:00` → `10:00–11:00`.

## Task 2b: The special-day routes refuse an out-of-hours zone closure

**Files:** Modify `zone-closure-hours.ts`, `routes.ts:582-622`, `errors.ts:182-189` (`special_day.invalid`'s
`reason` union gains `"outside_hours"`; it already carries `zoneId` and `date`); Test
`special-days-routes.test.ts`.

**Interfaces — Produces:**

```ts
/** After a special-day write, inside its transaction: each sent zone entry's closed ranges
 *  against its department's resolved day on that date. Dates `closedAllDay` names are skipped.
 *  Throws special_day.invalid
 *  { field: `zonePaint.${i}.ranges.${k}`, reason: "outside_hours", zoneId, date } (Decision 2). */
export async function assertDatedClosuresInHours(
  tx: Transaction,
  cfg: VenueScope,
  zonePaint: readonly { zoneId: string; date: LocalDate; ranges: readonly { kind: string; startsAt: string; endsAt: string }[] }[],
  closedAllDay: ReadonlySet<LocalDate>,
): Promise<void>;
```

Hours from `resolveDepartmentsDays(tx, cfg, departmentIds, dates, clock)`; `day =
serviceDayContext(clock, date)` (its `dayCutover`, `endMinute`). `k` indexes the entry's
`ranges` as sent (Open ranges are skipped, not renumbered). Both handlers call it after
`saveSpecialDay`, with `input.zonePaint ?? []` and the set of `input.dates` ticked
`closedAllDay`.

- [ ] **Step 1: failing tests** in `special-days-routes.test.ts`: **"refuses a zone closure
  outside its department's hours on that date, storing nothing"** — `christmas(r)` with the zone
  range `18:00–20:00` (department 19:00–23:00) → 400 `{ code: "special_day.invalid", params:
  { field: "zonePaint.0.ranges.0", reason: "outside_hours", zoneId: r.sala, date: "2030-12-24" } }`,
  no special day stored (`countDays`), for POST and PUT; **"measures against the department paint
  the same request sends"** (the department paint widened to 18:00–23:00 → 201); **"leaves Open
  zone paint and a date closed all day unchecked"** (an Open 06:00–07:00 range → 201; zone
  paint on `2030-12-25`, ticked closed all day → 201).
- [ ] **Step 2:** run `src/special-days-routes.test.ts` — the new cases FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** PASS; `typecheck`, `lint`.
- [ ] **Step 5:** `git commit -s -m "The special-day routes refuse a zone closure outside its department's hours (A723)"`

**Existing checks that change:** none expected (the route-level probe passed this file). Any
failure is a STOP.

## Task 3: The configuration import refuses an out-of-hours zone closure

**Files:** Modify `packages/venue-service/src/configuration-transfer.ts:258-358`; Test
`configuration-transfer.test.ts`.

In `validateSeasonWeeks`, after the shape checks: map each zone to its department through
`tables.zone_service_policies` (`zone_id` → `department_id`). For each zone season day, the
department's day with the same `season_id` and `weekday` (none → no hours) is passed with the
zone's ranges to `closureOutsideHours` (`endMinute: 1440`, the bundle's `dayCutover`). For each
zone special-day row's `closed` ranges, on a date whose `special_day_dates` row is not
`closed_all_day`: the department's hours are its season day for that date (season by
`seasonOn(seasons, date)`, `season-rules.ts:50`, over the bundle's `seasons` rows as
`{ id, startsOn: starts_on }`; weekday by `weekdayOf`, `hours-rules.ts`; the stored date as the
bundle holds it) with the department's own paint for that `special_day_date_id` laid over it (`layerPaint`,
`day-paint.ts`). Any closure outside → `refuse("zone_day_ranges")`.

- [ ] **Step 1: failing tests** in "season weeks in a configuration bundle": **"refuses a zone
  closure outside its department's hours at zone_day_ranges"** (`seasonTables()` with the zone
  closure `23:00–04:00` against `22:00–02:00`), **"refuses zone season weeks closed where the
  department has no hours"** (replacing `:1411`, below), and in the special-day bundle cases
  (`painted(…)`, around `:1700-1740`): **"refuses a zone's special-date closure outside the
  department's hours on that date"**, and two cases that fail if the department's special-date
  paint is ignored — **"accepts a zone closure outside the season week but inside the
  department's special-date paint"** (season Friday 20:00–23:00, the date's department paint
  Dinner 18:00–23:00, zone closed 18:00–19:00 → accepted) and **"refuses a zone closure inside the
  season week but under the department's Closed special-date paint"** (season 20:00–23:00, the
  date's department paint Closed 21:00–22:00, zone closed 21:00–22:00 → `zone_day_ranges`).
- [ ] **Step 2:** `--project node src/configuration-transfer.test.ts` — the new cases FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** PASS; then `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts src/setup-api.test.ts` (both passed the season-week probe); `typecheck`, `lint` for both packages.
- [ ] **Step 5:** `git commit -s -m "A configuration import refuses a zone closure outside its department's hours (A723)"`

**Existing checks that change** (`packages/venue-service/src/configuration-transfer.test.ts`):
- `:1243-1244`, the shared `seasonTables()` zone closure: `ends_at: "04:00:00"` →
  `"02:00:00"` (inside `w-fri` 22:00–02:00, `:1225`). Setup: the season-week probe failed 8
  season-bundle cases on the old value; that the new one makes them pass was not run.
- `:1411-1417` "accepts zone season weeks in a bundle with no periods": the bundle closes a zone
  where its department has no hours, which point 5 refuses; it becomes "refuses zone season weeks
  closed where the department has no hours" (`toThrowError(refusal("zone_day_ranges"))`), and a
  new case keeps the old intent — "accepts a zone season week with no closures in a bundle with no
  periods" (`zone_day_ranges: []`).
- Special-day bundle fixtures around `:1700-1740` were not probed; any that closes a zone outside
  its department's hours on that date is listed in the task report, with the fixture moved inside.

## Task 4: The demo seed closes Terrace inside the Restaurant's hours

**Files:** Modify `apps/server/scripts/demo-seed/seed.ts:143-153`; Test `seed.test.ts`.

- [ ] **Step 1:** change the test (below) first; run
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.test.ts` — FAIL.
- [ ] **Step 2:** `ranges: [{ startsAt: "23:00", endsAt: "00:00" }]` (Decision 13); drop the
  now-unused clock read if nothing else uses it.
- [ ] **Step 3:** PASS; also run `scripts/demo-seed/seed.integration.test.ts` and
  `src/demo-clock-profiles.test.ts` (both read the seed) and say what they printed.
- [ ] **Step 4:** `git commit -s -m "The demo Terrace closes from 23:00 to the Restaurant's midnight close (A723)"`

**Existing checks that change:** `apps/server/scripts/demo-seed/seed.test.ts:54-99`, "closes only
the Terrace from 23:00 to the %s changeover after its sales": title → "closes only the Terrace
from 23:00 to the Restaurant's midnight close, after its sales, with a %s changeover"; `:95`
`ends_at` → `"00:00:00"` for both changeovers. The seeded closure ran past the department's
close, which point 5 refuses.

## Task 5: `paint-grid` cuts Closed paint to the hours it is given

**Files:** Modify `packages/venue-service/src/dashboard/paint-grid.ts`; Test `paint-grid.test.ts`.

**Interfaces — Produces:**

```ts
/** Per column, the blocks Closed paint must lie inside: every day the grid emits has its Closed
 *  blocks cut to these (closuresInHours), other blocks untouched. A column the map does not name,
 *  or no map, is not bounded. */
@property({ attribute: false }) closedWithin: ReadonlyMap<string, readonly Paint[]> | undefined = undefined;
```

```ts
/** Per column, a label for a full-day Closed block drawn BEHIND the column's paint, as the
 *  underlay is: unlike `closedAllDay`, the column's paint stays drawn on top and strokes still run
 *  (`closedWithin` cuts them). */
@property({ attribute: false }) closedBehind: ReadonlyMap<string, string> = new Map();
```

and the event `paint-outside`, `CustomEvent<{ key: string }>` (bubbles, composed), sent when a
stroke's Closed paint lay wholly outside its column's `closedWithin`, so the stroke changes nothing.

`closedWithin` is applied in `#emit` (so a stroke, a block changed to Closed, Copy to… and Clear all
go through it), with `{ dayCutover: this.cutover, endMinute: 1440 }`; periodless open blocks of
`closedWithin` are not expected (filter `periodId !== null`). An emitted day `samePaint` with the
current day is not emitted. `closedBehind` draws the hatched `all-closed` look with its label, under
the column's blocks (z-order below them, `pointer-events: none`).

- [ ] **Step 1: failing tests** (`paint-grid.test.ts`, with `closedErases = false`,
  `chosen = null`):
  - "with closedWithin, a Closed stroke keeps only what lies in the column's hours" — hours
    `19:30–02:00`, a drag 23:30 → 03:00 emits `[{ null, 23:30–02:00 }]` (mockup note E; Review
    Focus 1).
  - "a stroke wholly outside the hours emits nothing" (Review Focus 3).
  - "a block changed to Closed and a day copied to another column are cut to that column's hours".
  - "Open paint (a period id) is not cut, and a column closedWithin does not name is not bounded".
  - "a Closed stroke wholly outside the column's hours sends paint-outside with its column, and a
    stroke that keeps something does not".
  - "closedBehind draws its label across the whole day behind the column's paint, which stays
    drawn and clickable, and a stroke there still runs" (a stored block on that column stays in
    the DOM above the label; `closedAllDay` unset).
- [ ] **Step 2:** `--project browser src/dashboard/paint-grid.test.ts` — FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** PASS; `typecheck`, `lint` (venue-service, staffing).
- [ ] **Step 5:** `git commit -s -m "The paint grid cuts Closed paint to the hours it is given, and can draw a closed day behind the paint (A723)"`

**Existing checks that change:** none (unset by default).

## Task 6: The season painter says what it edits

Spec points 1–3: "**'Standard', not 'normal'**, wherever a season's week is named: the painter's
title becomes 'Autumn: standard week', and strings such as 'Follow the normal week'
(`opening.follow_week`) follow." "**A line under the top bar says what is being edited:** 'Every week
from 5 Sept to 30 Nov opens these hours, except on special days.'" "**The '… follow Santet Deli Co'
note leaves the top bar**".

**Files:** Modify `season-painter.ts`, `strings.ts`; Test `season-painter.test.ts`,
`season-painter.unsaved.test.ts`, `season-painter.save.test.ts`, `season-chips.test.ts`.

The heading reads `painter.week`; `<p slot="row" class="covers" data-test="covers">` reads
`painter.week_covers` with `from = formatMonthDay(season.startsOn)` and `to =
formatMonthDay(seasonLastDay(seasons, season.startsOn))` (as the chip, `:568-572`), before the paint
row, shown to a viewer too, muted (`--wt-color-text-muted`). The `follows` span (`:607-615`), its
`.follows` style and its two strings go. Every string row of the table above changes here except
the new `painter.edit` (Task 7), `opening.closed_outside` and `painter.department_closed` (Task 8a)
and `special.pick_hint` (Task 12b), and the deletion of `special.range` and `special.range_last`
(Task 12b).

- [ ] **Step 1: failing tests** (`season-painter.test.ts`): "titles the painter '<season>: standard
  week' and says which weeks it edits, in English and Spanish" (`Winter: standard week`; covers
  `Every week from 1 Dec to 29 Feb opens these hours, except on special days.` — the chip's
  own dates, `season-chips.test.ts:127`; Spanish `Winter: semana estándar`, restoring English);
  "a viewer sees the line too"; and the changed checks below.
- [ ] **Step 2:** run the four files — FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** PASS; also `--project browser src/dashboard/opening-hours-screen.painter.test.ts`
  (no heading assertion there was found; any failure is listed or a STOP); `typecheck`, `lint`.
- [ ] **Step 5:** `git commit -s -m "The season painter is titled '<season>: standard week' and says which weeks it edits (A723)"`

**Existing checks that change:**
- Headings "Winter week" / "Spring week" → "Winter: standard week" / "Spring: standard week":
  `season-painter.test.ts:54, :71, :78, :495, :539, :601, :676, :879`;
  `season-painter.unsaved.test.ts:91, :98, :104`; `season-painter.save.test.ts:352, :595`.
- `season-painter.test.ts:85-104` "lists each active department with its zones beneath, and says
  the zones follow it": title drops "and says the zones follow it"; `:95-97` (the follows text)
  becomes `expect(chip(painter, "follows")).toBeNull()` (point 3).
- `season-painter.test.ts:718-753`, the 390 px bar case: `chip(painter, "follows")` in `shown`
  (`:741`) → `chip(painter, "covers")`, held to the same on-screen and no-overlap checks.
- `season-painter.test.ts:755-765` "at 1280px the zones' sentence reads on one line" → "at 1280px
  the line saying which weeks it edits reads on one line" (`lines(chip(painter, "covers"))` is 1).
- `season-chips.test.ts:127, :142, :157`: "…, edit the week" → "…, edit the standard week";
  "…, editar la semana" → "…, editar la semana estándar"; "…, show the week" → "…, show the standard
  week".
- Any test pinning `hours.menu_delete_clash`'s "normal menu week" text: none found by `git grep`.

## Task 7: A period chip's edit control is a visible "✎ Edit"

Spec point 6: "**A period chip's edit control is a visible '✎ Edit' button** (`paint-row.ts:165`),
not a bare ✎."

**Files:** Modify `paint-row.ts:155-168`, `strings.ts`; Test `season-painter.test.ts`,
`season-painter.a11y.test.ts`, `special-day-painter.a11y.test.ts`.

The button holds `<span aria-hidden="true">✎</span>` and `t("painter.edit")`; `aria-label` stays
`painter.edit_period`. Style `.pot .edit` in declared tokens (primary text colour, as the mockup's
blue), still `--wt-tap-min` tall.

- [ ] **Step 1: failing test** (`season-painter.test.ts`): "each period chip offers a visible
  '✎ Edit', named 'Edit <period>'" — text `✎ Edit` (Spanish `✎ Editar`), `aria-label` `Edit Lunch`.
- [ ] **Step 2–4:** FAIL, implement, PASS with the two a11y files (both themes); `typecheck`, `lint`.
- [ ] **Step 5:** `git commit -s -m "Period chips offer a visible ✎ Edit (A723)"`

**Existing checks that change:** none expected (tests find the button by `data-test="edit-…"`).

## Task 8a: The season painter cuts a zone's Closed paint, draws a closed department, and explains a refusal

Spec point 5: "**A zone's Closed paint covers only times its department is open.** Dragging
Terrace's Closed from 23:30 to 03:00 keeps 23:30–02:00, when Santet Deli Co closes; the server
refuses a zone closure outside its department's hours from any route."

**Files:** Modify `season-painter.ts:673-690`, `painter-labels.ts:63-71`, `strings.ts`,
`testing/season-painter-fixture.ts`; Test `season-painter.test.ts`, `season-painter.save.test.ts`
and the set-ups listed below.

For a zone, `paint-grid` gets `.closedWithin=` the department's draft week (the map already passed
as `underlay`) and `.closedBehind=` each weekday whose department draft day is empty, labelled
`format("painter.department_closed", { department })` (Decision 7; the mockup's Monday). Its
`paint-outside` sets the notice beside Save to `t("opening.closed_outside")`; the next paint clears
it as `paint()` already clears `notice`. `refusalReason` returns `t("opening.closed_outside")` for
reason `outside_hours` (before the `zone_closed_time.invalid` line). `withDays(model, departmentId,
days, seasonId = "winter")` and `slot()` move from `season-painter.save.test.ts:772-794` to the
fixture, exported, unchanged.

- [ ] **Step 1: failing tests:** `season-painter.test.ts` — "a zone's Closed stroke keeps only the
  times its department is open" (Restaurant **Friday** 19:30–02:00 via `withDays`; Terrace drag
  23:30 → 03:00 on Friday → day `[{ null, 23:30–02:00 }]`. Friday, because the fixture's Terrace
  holds a stored Tuesday 15:00–17:00 closure where Restaurant is closed, and a Tuesday stroke would
  also cut that stretch (Decision 5)); "a zone stroke on a day its department is closed paints
  nothing, leaves Save quiet and says 'A zone can only close while its department is open.' beside
  Save"; "a zone's day with its department closed shows 'Restaurant closed all day' behind its
  paint" (Wednesday: the label alone; Tuesday: the label with the stored 15:00–17:00 block drawn
  over it; a department's own view shows no such label). `season-painter.save.test.ts` — "an
  outside_hours refusal shows the zone, marks the day and says why" (`{ code:
  "zone_closed_time.invalid", params: { field: "zones.0.days.3.ranges.0", reason: "outside_hours" }
  }` → picker on Terrace, Thursday's heading marked "A zone can only close while its department is
  open.", beside Save "Terrace, Thursday: A zone can only close while its department is open.").
- [ ] **Step 2:** FAIL. **Step 3:** implement and update the set-ups. **Step 4:** run
  `season-painter.test.ts`, `.save`, `.races`, `.unsaved`, `.a11y` (add the closed-behind state, both
  themes), `clock-revision-editors.test.ts`, `service-delete-editors.test.ts`,
  `opening-hours-screen.painter.test.ts` — PASS; `typecheck`, `lint`.
- [ ] **Step 5:** `git commit -s -m "The season painter keeps a zone's Closed paint inside its department's hours (A723)"`

**Existing checks that change** (from reading, not run: each paints a zone's Closed where the
fixture's Restaurant is closed — Wednesday or Thursday, Restaurant's winter week being Monday
13:00–16:00 only — so the stroke is now cut to nothing):
- Set-up only — mount on `withDays(withBar(), "d1", { 4: [slot("p1", "06:00", "12:00")] })` (or
  weekday 3 where the stroke is on Wednesday), assertions unchanged:
  `season-painter.test.ts:134-161` (stroke `:147`), `:183-200` (`:185`), `:502-…` (`:506`),
  `:802-…` (`:805` Wednesday, `:807` Thursday); `season-painter.save.test.ts:267-…` (`:270`),
  `:669-…` (`:706`), `:750-770` (`:755`); `season-painter.unsaved.test.ts:141-…` (`:144`);
  `clock-revision-editors.test.ts:36` for its `zone` kind only (its department kind must keep a
  model where Wednesday 07:00–09:00 is a change).
- `season-painter.save.test.ts:64-70` (`paintRestaurantAndTerrace`, used by `:74`, `:149`, `:222`,
  `:245`): those four mount with Restaurant open Thursday 06:00–12:00. In `:74-121` the sent
  department body's `:90` `empty(4)` becomes `{ weekday: 4, slots: [{ periodId: "p1", startsAt:
  "06:00", endsAt: "12:00" }] }` — the only assertion value that changes; the zone body is
  unchanged.
- `season-painter.races.test.ts:131, :163, :190, :223` paint Thursday; the scan found them to be
  department strokes (no change). If any is a zone stroke, treat it as the set-up case above.
- `service-delete-editors.test.ts:263` (a zone stroke on Monday 12:00–16:00, Restaurant 13:00–16:00)
  is now cut to 13:00–16:00; its assertions are about discarding, so none is expected to change.

## Task 8b: Changing a department's day cuts its zones' same day in the season painter

Decision 3, inside the painter: the zone closed-week stage takes all seven days
(`zone-closed-times.ts:64`), so a zone left outside a shrunk department day would be refused at a
later Save over a day nobody touched.

**Files:** Modify `season-painter.ts` (`paint`, `:448-457`); Test `season-painter.save.test.ts`,
`season-painter.test.ts`.

When `paint(key, event)` changes a department's day, each of that department's zones whose draft
day for the same weekday changes under `closuresInHours(<the new department day>, <the zone's
day>, { dayCutover: model.dayCutover, endMinute: 1440 })` takes the cut day, in the same draft
update (one `scope.changed()`), so `edited()` names those zones and one Save sends them with the
department. A zone day already inside the new hours is left as it is (not marked edited).

- [ ] **Step 1: failing tests** (`season-painter.save.test.ts`): **"shrinking Restaurant's Tuesday
  cuts Terrace's Tuesday in the same Save"** — mount on `withDays(withBar(), "d1", { 2: [slot("p1",
  "13:00", "18:00")] })` (Terrace's stored Tuesday 15:00–17:00 inside it); paint Restaurant's Closed
  16:00 → 18:00; Save → one request whose `departments[0].days` Tuesday is `[p1 13:00–16:00]` and
  whose `zones` holds exactly `{ zoneId: "z2" }` with Tuesday `[15:00–16:00]` and every other day as
  stored (both bodies asserted whole). (`season-painter.test.ts`): "widening a department's day
  leaves its zones unedited"; "a department change on a day its zone has no closure leaves the zone
  unedited".
- [ ] **Step 2–4:** FAIL, implement, PASS for every `season-painter*` file; `typecheck`, `lint`.
- [ ] **Step 5:** `git commit -s -m "Shrinking a department's day in the season painter cuts its zones' closures that day (A723)"`

**Existing checks that change:** none expected — the one winter department stroke on Tuesday
(`season-painter.save.test.ts:427`) runs after stepping to Spring, where Terrace has no closures.
Any `edited()` or body assertion that now gains a zone is a STOP: report it.

## Task 9a: The special-day editor cuts a zone's Closed paint, draws a closed department, and explains a refusal

**Files:** Modify `special-day-painter.ts` (`paintArea` `:1276-1375`, `refusePaint`
`:1007-1057`); Test `special-day-painter.paint.test.ts`, `special-day-painter.save.test.ts`.

For a zone, `closedWithin` maps each date not ticked closed all day, whose season day is known
(`this.seasonDays`), to the department's open blocks: `layerPaint(season.ranges, draft paint of the
department on that date, cutover)`. Memoise as `underlay` does (`:1196-1245`); a date with no season
day is left out (not bounded). `closedBehind` labels each such date whose department open blocks
are empty `painter.department_closed` (a date ticked closed all day keeps `closedAllDay`, as
today). `paint-outside` sets the notice beside Save to `t("opening.closed_outside")`. `refusePaint`
already reads `special_day.invalid` with a `zonePaint…` field (Decision 2); its reason for
`outside_hours` becomes `t("opening.closed_outside")`.

- [ ] **Step 1 — wire first, then look:** add `closedWithin` alone; run every
  `special-day-painter*.test.ts` and `opening-hours-screen.special-day.test.ts`; write down every
  failure (file:line, test name, what it painted). These are the changed checks: each paints a zone's
  Closed where the fixture's department has no season hours on that date, and gets those hours
  through the fixture's `season` answer (setup), its assertions unchanged. A failure of any other
  kind, or one that needs an assertion value changed, is a STOP.
- [ ] **Step 2: failing tests:** `special-day-painter.paint.test.ts` — "a zone's Closed stroke keeps
  only the times its department is open on that date" (season Restaurant 20:00–23:30, a Terrace
  drag 19:00 → 21:00 → `[{ null, 20:00–21:00 }]`); "Open paint is not cut"; "a stroke wholly
  outside says why beside Save"; "a date whose department has no hours shows '<department> closed
  all day' behind the zone's paint". `.save.test.ts` — "an outside_hours refusal shows that zone,
  marks the date and says why" (`{ code: "special_day.invalid", params: { field:
  "zonePaint.0.ranges.0", reason: "outside_hours", zoneId: "z2", date: DEC_15 } }` → picker on
  Terrace, `DEC_15`'s column marked "A zone can only close while its department is open.").
- [ ] **Step 3–4:** FAIL, implement and update the set-ups from Step 1, PASS for the same files;
  `typecheck`, `lint`.
- [ ] **Step 5:** `git commit -s -m "The special-day editor keeps a zone's Closed paint inside its department's hours (A723)"`

**Existing checks that change:** the Step 1 list (setup only), copied into the task report and the
PR's "Changed test checks".

## Task 9b: Changing a department's paint on a date cuts its zones' paint that date

**Files:** Modify `special-day-painter.ts` (`paint`, `:1179-1184`); Test
`special-day-painter.save.test.ts`.

When `paint(owner, event)` changes a department's paint on a date that has a known season day and
is not ticked closed all day, each of that department's zones whose draft paint on that date
changes under `closuresInHours` (Closed blocks only; Open blocks kept) against the department's new
open blocks takes the cut paint in the same `change(...)`, so `changedPaint()` sends it beside the
department's entry.

- [ ] **Step 1: failing tests:** **"shrinking Restaurant on a date cuts Terrace's closure that
  date in the same Save"** — stored Terrace Closed 21:00–23:00 on `DEC_15`, season Restaurant
  20:00–23:30; paint Restaurant Closed 22:00 → 23:30 on `DEC_15`; Save → `paint` holds Restaurant's
  `DEC_15` entry and `zonePaint` exactly `[{ zoneId: "z2", date: DEC_15, ranges: [{ kind: "closed",
  startsAt: "21:00", endsAt: "22:00" }] }]` (both arrays asserted whole); "Terrace's Open paint that
  date is kept"; "a department change that leaves the zone inside sends no zone entry".
- [ ] **Step 2–4:** FAIL, implement, PASS for every `special-day-painter*` file; `typecheck`,
  `lint`.
- [ ] **Step 5:** `git commit -s -m "Changing a department's special-day paint cuts its zones' closures that date (A723)"`

**Existing checks that change:** none expected; a sent body that now gains a zone entry is a STOP.

## Task 10a: Save closes the season painter

Spec point 4: "**Save closes.** One Save sends every department and zone changed, then closes the
painter; a refused save keeps it open with its message beside Save. The same in the special-day
editor."

**Files:** Modify `season-painter.ts:458-514`, `opening-hours-screen.ts:1066-1090`; Test
`opening-hours-screen.painter.test.ts`, `season-painter.save.test.ts`.

**Interfaces — Produces:** `season-painter` dispatches `season-week-saved`,
`CustomEvent<{ clean: boolean }>` (bubbles, composed) after a successful save it still owns, once
its baseline is committed; `clean = !this.scope?.isDirty()`. The screen, on that event from the
current painter (`currentPainter(event)`) with `clean`, calls `closePainter()`; not clean, nothing
(Decision 6).

- [ ] **Step 1: failing tests:** `opening-hours-screen.painter.test.ts`: "Save closes the painter
  and returns to the view it opened over" (open from a season chip, paint, Save → the painter is
  gone, `history.back` taken, the Year shown); "Save on a painter loaded directly closes onto the
  Year by replacement"; "a refused Save keeps the painter open with its message beside Save"; "a
  paint made while the save is in flight keeps the painter open, unsaved" (Review Focus 5).
  `season-painter.save.test.ts`: "a save sends season-week-saved, clean unless painted during the
  save".
- [ ] **Step 2–4:** FAIL, implement, PASS for those files and every `season-painter*` file (the
  after-save cases stay as they are: the painter does not close itself); `typecheck`, `lint`.
- [ ] **Step 5:** `git commit -s -m "Save closes the season painter (A723)"`

**Existing checks that change:** none expected.

## Task 10b: Save closes the special-day editor

**Files:** Modify `special-day-painter.ts:876-937`, `opening-hours-screen.ts:1092-1135`; Test
`opening-hours-screen.special-day.test.ts`, `special-day-painter.save.test.ts`.

**Interfaces — Produces:** `special-day-saved`'s detail becomes `{ detail: SpecialDayDetail;
clean: boolean }`, `clean = !this.scope?.isDirty()` after `adopt`. The screen, on a clean save from
the current painter, calls `closePainter()` — for a new day without first replacing the address
with its id; not clean, as today (a new day's address takes its id).

- [ ] **Step 1: failing tests:** `opening-hours-screen.special-day.test.ts`: "Save on a new special
  day picked on the Month closes the editor back to the Month, and Back does not reopen it" (Review
  Focus 4); "Save on a stored day closes the editor"; "a refused save keeps it open"; "a paint made
  while the save is in flight keeps it open, and a new day's address takes its id".
  `special-day-painter.save.test.ts`: "special-day-saved says clean unless painted during the save".
- [ ] **Step 2–4:** FAIL, implement, PASS for those files and every `special-day-painter*` file;
  `typecheck`, `lint`.
- [ ] **Step 5:** `git commit -s -m "Save closes the special-day editor (A723)"`

**Existing checks that change:** an assertion that pins `special-day-saved`'s whole detail gains
the `clean` key (owner, 2026-09-27: a whole-shape pin may gain the new field's key, every existing
value unchanged) — check `special-day-painter.test.ts:59`, `:552`, `:867` and
`special-day-painter.save.test.ts:74`; list each that changes.

## Task 11: `DayPicker` tells its host when a gesture picks a run

**Files:** Modify `day-picking.ts`; Test `day-picking.test.ts`.

**Interfaces — Produces:** `DayPickerOptions.ranged?(run: DayRun): void` — "A run picked by a
gesture that has ended: a drag's release, a shift-click, a Shift+arrow." Not called for a plain
click, a plain arrow, a cancelled gesture, or a long press that opens.

- [ ] **Step 1: failing tests** (`day-picking.test.ts`, the test host passing `ranged`): "a mouse
  drag reports its run once, on release"; "with dragOnTouch, a touch drag reports its run on lift";
  "a shift-click reports the run from the anchor"; "Shift+arrow reports the run so far"; "a click,
  an arrow and a cancelled drag report nothing".
- [ ] **Step 2–4:** FAIL, implement, PASS; also `opening-hours-year.test.ts` and
  `opening-hours-month.test.ts` (they pass no `ranged`); `typecheck`, `lint`.
- [ ] **Step 5:** `git commit -s -m "DayPicker reports a run a gesture picked (A723)"`

**Existing checks that change:** none.

## Task 12a: A click on a chosen date removes it

Spec point 7: "**The special-day editor's Range button goes.** A click adds or removes a date; a
drag or a shift-click adds a run; one hint line says so. `DayPicker` (`day-picking.ts`), with
`dragOnTouch` on inside the dialog."

**Files:** Modify `add-dates-calendar.ts` (`#click`, `:209-226`; the pressed button's
`cursor: default`, `:107`), `special-day-painter.ts:1121-1143`, `:1495-1504`; Test
`add-dates-calendar.test.ts`, `special-day-painter.test.ts`.

**Interfaces — Produces:** `export interface RemoveDates { dates: LocalDate[] }`; the calendar sends
`remove-dates` (bubbles, composed) for a plain click on a chosen date, still `add-dates` for a
plain click on any other. The painter's `@remove-dates` stops it and calls `removeDates(date,
date)` for each date (the date and its paint leave the draft, as the chip's ✕ does).

- [ ] **Step 1: failing tests:** `add-dates-calendar.test.ts` — "a click on a chosen date sends
  remove-dates with that date"; `special-day-painter.test.ts` — "remove-dates takes the date and its
  paint out of the draft".
- [ ] **Step 2–4:** FAIL, implement, PASS for both files and `add-dates-calendar.a11y.test.ts`;
  `typecheck`, `lint`.
- [ ] **Step 5:** `git commit -s -m "A click on a chosen date in the special-day editor removes it (A723)"`

**Existing checks that change:** `add-dates-calendar.test.ts:159-172` "draws chosen dates pressed
and sends nothing for them, leaving them out of a range": the pressed state and the range leaving
chosen dates out stay; "sends nothing" for a click on a chosen date → sends `remove-dates` with
that date (point 7: "A click adds or removes a date").

## Task 12b: The calendar picks through `DayPicker`; Range goes; one hint line

**Files:** Modify `add-dates-calendar.ts`, `strings.ts`; Test `add-dates-calendar.test.ts`,
`add-dates-calendar.a11y.test.ts`.

`DayPicker` with `{ button, canPick: () => true, dragOnTouch: true, choose, ranged }` replaces
`#click`, `#keydown`, `anchor`, `ranging` and `focusDate`; its handlers bind on the table. `choose`
adds or removes the date (Task 12a's rule); `ranged` adds the run's dates not already chosen, or,
over `HOURS_RANGE_MAX_DAYS`, adds nothing and shows `special.range_long`. A date inside
`picker.run` while a gesture is under way is drawn with the old anchor ring (`data-picked`);
`pointed` still follows focus and click. The Range button, its style and the two strings go;
`<p class="hint" data-test="hint">` reads `special.pick_hint`; the message line stays.
**`DayPicker` ignores the second click of a fast double-click** (`day-picking.ts:299`,
`event.detail > 1`), so a double-click on a date toggles it once, not twice; the calendar passes no
`open`, so the double-click itself does nothing.

- [ ] **Step 1: failing tests** (`add-dates-calendar.test.ts`): "a mouse drag across dates adds the
  run on release, drawn marked while dragging"; "a touch drag adds the run and does not scroll the
  page" (`dragOnTouch`, as `day-picking.test.ts:482`); "Shift+arrow adds the run" (Decision 12);
  "a double-click on a date adds it once" (`userEvent.dblClick`: one `add-dates`, no
  `remove-dates`); "shows one hint line and no Range button, in English and Spanish".
- [ ] **Step 2–4:** FAIL, implement, PASS for both files, `special-day-painter.a11y.test.ts` and
  `special-day-painter.test.ts`; `typecheck`, `lint`.
- [ ] **Step 5:** `git commit -s -m "The special-day editor's calendar: a drag or shift-click adds a run, and Range goes (A723)"`

**Existing checks that change** (`add-dates-calendar.test.ts`; Range is removed by point 7):
- `:70` `text(testId(el, "range"))` "Intervalo" → the hint's Spanish text.
- `:125-142` "makes the next two clicks a range while Range is on, then turns it off" — removed with
  Range; replaced by the drag and Shift+arrow cases above.
- `:144-157` "turning Range off before the second click forgets its first" — removed with Range;
  the shift-click anchor it relied on stays covered by `:93-106` and `:115-123`, unchanged.
- `:275-292` "keeps Range on with its first date when its range is too long" — removed with Range;
  `:259-273` (a too-long shift-click keeps its first date) still covers the limit.
- `:294-315` (arrow keys, one Tab stop) and `:221-231` (the holder named on arrows) should pass
  through `DayPicker` unchanged; a needed change is a STOP.

## Task 13: Docs and backlog

**Files:** `docs/developers/design-system.md`, `docs/backlog.md`, `docs/backlog/service-periods.md`.

- [ ] First `git grep -n "Range\|follows\|<season> week\|normal week\|stays open\|✎"` across
  `docs/developers` and `docs/backlog*`; fix every hit describing current behaviour of these two
  painters (CLAUDE.md §1, "A behaviour change retires every receipt"). Historical plans and specs
  stay.
- [ ] `design-system.md:2158-2183` (season painter): heading "<season>: standard week"; the line
  under the bar; no follows note; "(✎ Edit edits one)"; a zone paints Closed only where its
  department is open, a stroke cut to those hours; Save writes the edited weeks in one request and
  closes the painter, a refusal keeping it open (an `outside_hours` refusal named); a zone's day
  whose department is closed shows "<department> closed all day" behind its paint; changing a
  department's day cuts its zones' closures that day. `:2184-2223`
  (special-day painter): the calendar sentence (click adds or removes, a drag or shift-click adds a
  run, at most 366, one hint line; no Range); a zone's Closed paint cut to its department's hours on
  that date, and a department's changed paint cutting its zones' closures that date; **`:2205` "the painter stays open and the answer becomes the saved state" → "Save
  closes the painter; a refused save keeps it open with its message beside Save; paint made while a
  save is in flight keeps it open, unsaved."**
- [ ] `docs/backlog.md:1459-1463`: delete the A723 entry. `docs/backlog/service-periods.md:166-192`:
  delete the A723 section. A762 (`:194-210`) stays; its point 2 gains one line: "A723 kept the
  special-day editor's heading as the day's name with no dates line (A723 plan, Decision 9)."
- [ ] Open points, each its own short entry in the Service periods area (one line in
  `docs/backlog.md`, detail in `service-periods.md`): (a) a server-side department-hours change
  (the menu-week route, period delete, moving a zone to another department, an API call sending
  only a department) leaves a stored zone closure outside the new hours, and the next save of that
  zone is refused naming that day (Decision 3); (b) the route-level placement of the check: a
  direct caller of the writers is not checked (Decision 1); (c) unticking a special date's "closed
  all day" makes the zone paint stored on it count again, unchecked against the department's hours
  (Decision 4); (d) moving or deleting a season changes which season week a special date falls in,
  so a zone closure checked against one week can end up outside the next, unchecked; (e) a yearly
  special day's zone paint is checked only against its stored date's season and weekday, not each
  year's; (f) `opening.follow_week` and `menu.normal_week` have no reader; (g) the plan defaults
  sent to the owner as an FYI (Decisions 1, 3, 6, 7, 9).
- [ ] `service-periods.md` "## Decisions and deliberate limits": Decisions 2, 4, 5 and 8, one line
  each, "(A723 plan, Decision N; plan default)".
- [ ] `git commit -s -m "docs: the painters say what they edit, close on Save, and keep a zone's closures inside opening hours (A723)"`

## Task 14: LOOK

- [ ] `lsof` the slot's venue folder and ports 8080, 5190–5192; start with
  `wa-wt demo waitron-feat-a723-painters-standard-week` (never a bare `pnpm dev*`), recording its
  process group; `wa-wt reset demo …` only if the venue still holds the old Terrace closure and
  nothing else holds the slot (memory: check holders first) — say which.
- [ ] Drive it with the worktree's Playwright Chromium as `~/waitron-campaign/a721-script/common.mjs`
  does (login, `snap` in light and dark, rejecting a pair whose page and dialog backgrounds match);
  scripts in `~/waitron-campaign/a723-script/`, PNGs in `~/waitron-campaign/a723-shots/`. At 390 px
  (touch) and 1280 px, light and dark, English and Spanish, capture: the season painter on a
  department (title, line, "✎ Edit" chips), on Terrace (no follows note), Terrace's Tuesday after a
  drag past the Restaurant's close (cut, as mockup note E), a zone's day with its department closed
  ("Restaurant closed all day" behind the paint), a refused save beside Save; the
  special-day editor (calendar with the hint and no Range, a run being dragged, a date removed by a
  click, a touch drag at 390 px not scrolling the page); after Save, each painter closed onto the
  view it opened over. Put back anything changed in the demo venue through the dashboard, and say
  what was changed and restored.
- [ ] `wa-wt down …`; check by the recorded process group and ports that nothing is left. Write
  `~/waitron-campaign/a723-look-report.md` (what was looked at, what is wrong); the PR's "LOOK"
  section summarises it. Update the ledger; tell the owner the branch is ready for `/finish-branch`.

---

## PR description must carry

- First line in plain words: the season painter says it edits a season's standard week, both
  painters close on Save, and a zone can be closed only while its department is open — the
  dashboard cuts the paint and the server refuses the rest.
- **Migration:** none, and why (header).
- The new refusal: `zone_closed_time.invalid` reason `outside_hours` on the three routes, and the
  import's `setup.request_invalid { field: "zone_day_ranges" }`; the demo seed's Terrace closure.
- **"Changed test checks":** the union of every task's list, each with its reason.
- The plan defaults sent to the owner as an FYI (Decisions 1, 3, 6, 7, 9), with the receipts.
- The Spanish wording change ("semana estándar", Decision 8).
- **"LOOK":** what Task 14 captured.
