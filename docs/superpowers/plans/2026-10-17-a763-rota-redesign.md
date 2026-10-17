# A763 — The Rota view redesigned: one Show menu, no button per cell, an empty week that says why

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Calendar → Rota gets one Show menu (Everyone or one area) in place of the Area picker and the By area | By person switch, one bar of controls, no "Add shift" button in every cell, a picker that opens beside the slot that was clicked, an empty week that says why, and one day at a time on a phone.

**Architecture:** Almost all of the work is in the browser, in `packages/staffing/src/dashboard/`. One small server change comes first (Task 1, below). The rota screen keeps its one live read and its warnings read. New pure helpers in `rota-model.ts` work out what the bar, the headers, the strip and the menus show. A package-local `rota-popup` element holds the slot picker and the new open-slots menu, beside their anchor on a wide screen and as a sheet from the bottom on a phone. No shared `wt-*` primitive changes. `staffing-month.ts` does not change.

**Tech stack:** Lit 3, `@waitron/ui` (`wt-button`, `wt-combobox`), `@waitron/venue-service/dashboard/fixed-title`, `@waitron/venue-service/painter` (`placePopover`, `periodColourStyles`), Vitest 4 in browser mode (real headless Chromium) for `src/dashboard/**`, node for the rest (`packages/staffing/vitest.config.ts`: the `browser` project includes `src/dashboard/**/*.test.ts`, the `node` project excludes it).

**Worktree:** `/Users/clintongormley/workspace/worktrees/waitron-feat-a763-rota-redesign`, branch `feat/a763-rota-redesign`, based on main `45ce9e66d`.

---

## THE SERVER CHANGES — read this first

**One server read changes shape; nothing stored changes; no migration.** Two of the spec's points need facts the rota read does not carry today:

- Point 5: "A day with no paint and no hours reads 'Closed'". The rota read knows only that a *special day* is closed all day (`closedAllDay: plan.special.get(businessDay)?.closedAllDay ?? false`, `packages/staffing/src/rota.ts:86`). A weekday on which the season has no opening hours (a venue closed on Mondays, as on boards 1–3 and 5) is not marked at all, and the browser has no read of opening hours to work it out from.
- Point 6: "Paint {season}'s standard week (the painter for that area, or the special day's editor on a special day)". The rota read carries no season or special day (`RotaWeek`, `packages/staffing/src/staffing-types.ts:111-135`).

Task 1 adds to `readRotaWeek`, for each day, `hasHours`, `seasonId` and `specialDay`, and for the week, `seasons` (id and name). They come from what `readRotaWeek` already reads (`readDayPlan` at `rota.ts:41`) plus one call to venue-service's exported `resolveDepartmentsDays` (`packages/venue-service/src/index.ts:91-95`). The route (`GET /management-api/staffing/rota`) and its permission are unchanged. Its live dependencies already include every table that call reads (`QUERY_DEPENDENCIES.rota`, `packages/staffing/src/dashboard/live-queries.ts:26-42`, spreads `CALENDAR_MONTH_PLAN_READS`, which lists `department_days` and `department_day_ranges`; `departments` is listed itself; `readDepartmentSeasonWeeks` reads `departmentDays` at `packages/venue-service/src/season-weeks.ts:214`).

**No shared `wt-*` primitive changes or is added.** The picker's popover and phone sheet are a package-local element (`rota-popup`, Task 4) placed with venue-service's existing exported `placePopover`. It still gets a token-painting check and an axe test in both themes.

## Review path: FULL

The brief for this item sets the rule that a server change takes the full path, and Task 1 changes what a server read returns. None of the CLAUDE.md risk triggers is touched otherwise: no fiscal code, no tenant or by-id read, no migration, no grant or permission change, no concurrency change. So: a per-task reviewer on Task 1 at least (and on the others as the driver judges), the full `/finish-branch` wave, the Codex run-it seat. The simplify seat is wanted here, because the branch restructures the rota's files.

**Migration:** none.

---

## The spec, as written

`docs/backlog.md` (line 4234):

> **A763. The Rota view redesigned (owner, 2026-10-16).** One Show menu (Everyone or an area) replaces the Area picker and the By area | By person switch; two rows of controls; no "Add shift" in every cell — click an empty day for its open slots; the people panel goes; an empty week says why and offers the painter; one day at a time on a phone; the Staffing month's Monday rota link goes, since its day box already offers it. Before A586–A588. [Detail](backlog/workforce.md#a763-the-rota-view-redesigned-one-show-menu-no-button-per-cell-an-empty-week-that-says-why), [mockups](backlog/mockups/a763-rota/)

`docs/backlog/workforce.md` → "A763. The Rota view redesigned: one Show menu, no button per cell, an empty week that says why":

> **A763 (owner, 2026-10-16).** The owner, on the Santet venue: "the rota screen is completely unusable". Approved [mockups](mockups/a763-rota/) (canvas: https://claude.ai/artifact/AoJHtjzj7j4wiPKFWuy5Rw). What the owner saw on Calendar → Rota, week of 26 Jan 2026: By person was a wall of 7 × N "Add shift" buttons; By area showed staff role rows with nothing in them and did not say the week had no staffing painted; "People this week (all areas)" repeated the By person rows and squeezed the grid; three rows of controls came before any content, with "Labour rules are not set up" on a line of its own. Files: `packages/staffing/src/dashboard/rota-view.ts`, `rota-by-area.ts`, `rota-by-person.ts`, `slot-picker.ts`, `staffing-month.ts` and `strings.ts`. Before A586–A588, which build on this screen.
>
> 1. **One Show menu replaces both the Area picker and the By area | By person switch** ([board 1](mockups/a763-rota/01-show-one-area.png)). "Everyone" draws one row per person; an area draws its staff roles and their slots. This retires the A585 spec's decision 9. A staff role row appears only when the area has slots or shifts for it that week.
> 2. **Two rows of controls.** The Calendar switch stays; one bar holds `‹ week ›`, Show, then on the right the week's state, what needs attention and the one action. The week title keeps a fixed width and links back to Staffing → Month for that month, as the Calendar Week's title does (`opening-hours-week.ts`).
> 3. **"People this week" goes.** Hours show where a choice is made — in the picker — and under each name in Show: Everyone. The picker opens beside the slot that was clicked, not in a side panel.
> 4. **No "Add shift" in every cell.** In an area, a dashed slot is the place to fill; a shift beyond the paint is added from the empty part of a cell, where "+ Add shift" appears on hover or focus. In Show: Everyone ([board 2](mockups/a763-rota/02-show-everyone.png)), clicking the empty part of a day offers that day's open slots, those in the person's staff roles first and the rest marked outside staff role, then "Another shift…" (the shift editor), so the rota can be filled from either view.
> 5. **The bar's counts are buttons that step to the next such slot**; zero counts are left out, and with none left it reads "All slots filled". A day needing attention says so under its date ("2 unfilled"). A day with no paint and no hours reads "Closed" once, in its header.
> 6. **Empty weeks say why** ([board 3](mockups/a763-rota/03-empty-week.png)). An area with no paint for the week explains that slots come from staffing paint and offers "Paint {season}'s standard week" (the painter for that area, or the special day's editor on a special day) and "Show everyone"; shifts it already has show beneath, marked not needed. Show: Everyone with no shifts keeps everyone's rows with one line saying how to add one.
> 7. **The bar in each state** ([board 4](mockups/a763-rota/04-toolbar-states.png)). "Labour rules are not set up" becomes a quiet "No labour rules to check against" in the bar. A published week shows "Change this week"; a week being changed says "Staff still see the published week" and its button reads "Publish changes"; the open-swaps notice sits under the bar. Publish is always in the bar of a week that is not published, drawn quiet while the week has no shifts. Today it shows only once the week has a draft version, which its first shift creates (`packages/staffing/src/rota.ts:231-232`), and a draft whose shifts were all deleted still offers it. The warnings dialog is unchanged.
> 8. **Phone width: one day at a time** ([board 5](mockups/a763-rota/05-phone.png)), as the Calendar's Week on a phone, but with a seven-day strip marking days that need attention and the week arrows still stepping a week; the picker as a sheet from the bottom, Publish at the foot. Show: Everyone lists each person with that day's shifts; a tap opens the same open-slots menu.
> 9. **Staffing month: the Monday "Rota for this week" link goes** ([board 6](mockups/a763-rota/06-staffing-month.png); today the `rota-week` button in `staffing-month.ts`), so Monday's box is the same height as the others. The day box already offers "Rota for this week" on every day (A720 Part 5); it is still to state where that week's rota stands. The Rota tab opens the week of the day last picked in the month, else the current week.

The boards' own notes (read from the images, 2026-10-17) add detail the plan builds to: board 1 — the slot reads "19:00–00:00 · Fill"; the picker is headed "Fri 30 · Sous chef · 19:00–00:00", under it "Kitchen · holders of the staff role first", each person "Sous chef · free · 30 / 40 h", "would go over 40 h contract" in red, a person already working drawn muted ("working 18:00–00:00"), then "Show everyone". Board 2 — under each name its staff roles and "39 / 40 h", orange when over; each card its staff role's colour, its time, "Kitchen · Head chef"; the open-slots menu is headed "Fri 30 · Ibra", then "OPEN SLOTS IN IBRA'S STAFF ROLES", "OTHER OPEN SLOTS THIS DAY" (each marked "outside staff role"), then "Another shift…"; the focused empty part reads "+ Add shift". Board 3 — "No staffing is painted for Kitchen this week", "Slots come from the staffing you paint: who Kitchen needs, and when. Paint Winter's standard week once and every week of the season gets its slots. You can still add shifts by person.", [Paint Winter's standard week] [Show everyone]; the bar reads "Draft · Nothing to fill · [Publish week]" quiet; Everyone reads "Draft · No shifts yet · [Publish week]" quiet and the line "No shifts this week yet. Click a day in someone's row to fill a slot or add a shift."; under each name "Head chef · 0 / 40 h". Board 4 — Draft with counts and "⚠ 1 labour warning"; "Draft · All slots filled"; "Draft · 2 unfilled · No labour rules to check against"; "Published · All slots filled · [Change this week]"; "Draft · Staff still see the published week · 1 unfilled · [Publish changes]", with "2 open swap requests moved to the new draft. Check them before you publish." in a box under the bar. Board 5 — title, then the strip (Fri marked), then Show, then state and counts, "1 labour warning" on its own line, the day's role groups, Publish week full width at the foot; the picker sheet ends with "Show everyone" and [Cancel].

**Scope:** points 1–8. **Point 9 is out of scope**: it waits for lane F's A724 Part 2, which has not landed. Task 12 leaves it as its own backlog entry. `staffing-month.ts` is not changed: no point 1–8 needs it.

---

## Decisions this plan makes that the spec does not

Each has the default to build. The owner is away; none of these is a question for them.

1. **The Show menu is the address word `area`.** An area key (`department:<id>` or `station:<id>`, as today) shows that area; `everyone` shows Everyone. With no `area`, or an unknown one, the Rota shows its first area, as today (`rota-view.ts:293`). Why: the Staffing month's links already send `area` or nothing (`staffing-month.ts:556`, `:600`), and keeping the default means a plain Rota tab opens as it does today. An area key always holds a colon, so `everyone` cannot collide. The `mode` word is retired, with no compatibility for old `mode/person` addresses (pre-live rule).
2. **Search destinations:** the Rota's two (`by-area` with `{ mode: "area" }`, `by-person` with `{ mode: "person" }`, `packages/staffing/src/dashboard/index.ts:66-69`) become one: `{ id: "everyone", labelKey: "staffing.rota.everyone_search", params: { area: "everyone" } }`, label "Everyone's rota" / "Turnos de todo el equipo". "By area" was the default view and the Rota tab's own destination (`calendar:rota`) already reaches it.
3. **Show's options:** "Everyone" first, then every area in the read's order. The combobox reuses `name="area"` and the label key `staffing.month.area` ("Show" / "Mostrar"), with `search="never"`, as the Staffing month's Show does (`staffing-month.ts:425-440`).
4. **The week title is the range "26 Jan – 1 Feb 2026"** (`Intl.DateTimeFormat#formatRangeToParts` with day, short month and year, staffing's own `dateFormat`). As in the Calendar Week (`opening-hours-week.ts:577-600`), **each month name in it is a link** to Staffing → Month for that month: `open("staffing", { month, ...(area ? { area } : {}) })`, carrying the shown area and leaving it out for Everyone. The year is plain text, since Staffing has no Year. The title keeps one width with `fixedTitle` (`@waitron/venue-service/dashboard/fixed-title`), sized against every week whose Monday falls in 2026 in both languages, the Week's rule. The month names are links only when the person may open the Staffing view (`ctx.calendarViews`, as `canOpenRota` is worked out at `index.ts:37`); otherwise they are plain text. The parts function is a local `weekTitleParts` in `format.ts`, because venue-service's `formatWeekTitleParts` is in `hours-view.ts`, outside its `exports` map; Task 12 adds this copy to backlog A699's list.
5. **The bar, left to right:** ‹, title, ›, Show; then, pushed to the end: the state, a quiet note when there is one, the attention counts or their summary, the labour count, and the one action. The state is a small pill (local CSS, tokens only): "Draft" or "Published". With no version yet the state reads "Draft".
6. **The summary when no count is left** (counts are scoped as the grid: the shown area, or every area for Everyone):
   - any of unfilled, partly uncovered or over above zero: those counts, as buttons, joined by " · " text;
   - else, if the scope has at least one slot that week: "All slots filled";
   - else, for Everyone with no shifts in the week: "No shifts yet";
   - else: "Nothing to fill".
7. **What a count button steps to.** Each press focuses the next target after the one that button last focused, wrapping, in reading order: by day, then by the grid's row order, then by start time. The target scrolls into view (`scrollIntoView({ block: "nearest", inline: "nearest" })`). Unfilled steps to an unfilled slot, partly uncovered to its shift's card, over to an over shift's card. In Everyone an unfilled slot has no card, so that button switches Show to the slot's area (`open("rota", { week, area })`) and focuses the slot once the area is drawn. On a phone a step first shows the target's day. A target that is not a button (a published week's card) is given `tabindex="-1"` so focus can land. The labour count stays text, as drawn on boards 1 and 4 (no dotted underline there), because a warning is not a slot.
8. **A day's header** names its attention below the date, with the bar's words and only non-zero counts ("2 unfilled", "1 unfilled · 1 over"), not as buttons. **"Closed"** shows in the header when the day has no opening hours in any active department (`hasHours === false`, Task 1, which also covers a special day closed all day) **and** no slot in the shown scope that day. Cells no longer write "Closed" (`rota-by-area.ts:163`, `rota-by-person.ts:84`).
9. **Rows.** In an area: a staff role row appears when the area has a slot or a shift with that staff role that week; "Not in a slot" appears only when some day has such a shift. In Everyone: one row per active person, ordered by the lowest `position` among their staff roles, then name, then person id; a person with no staff role comes after those with one.
10. **Person-level labour warnings without a shift** (a weekly breach, a daily breach) lived in the people panel too (`rota-view.ts:401`). After it goes: in Everyone they stay under the name and in the day cell, as today (`rota-by-person.ts:74`, `:85`); in an area a daily warning is drawn on that person's cards on that date in the area; a weekly warning has no place in the area grid, and the bar's labour count and the publish dialog still include it.
11. **The picker and the open-slots menu** sit in a package-local `rota-popup` element, an auto popover:
    - Wide: beside the anchor, on its inline-end side and top-aligned, when it fits in the window; else on its start side; else below it through `placePopover(popup, anchor, false, true)`. Kept inside the window with an 8 px margin (`POPOVER_MARGIN`'s value; venue-service does not export the constant, so the helper takes the same number and says where it came from).
    - Phone (the rota's own width below 560 px, Decision 14): a sheet fixed to the bottom of the window, full width, its height capped at 70% of the window with its own scroll, the page behind dimmed through `::backdrop`, ending with Cancel (`staffing.role.cancel`).
    - It closes on Escape, a click outside (light dismiss) or Cancel, and sends `rota-popup-close`; focus returns to the anchor when it was inside the popup, as `calendar-day-box.ts` does. It moves focus to its heading on open.
    - The slot picker loses its "Close picker" button (`slot-picker.ts:156-161`) on a wide screen: board 1 draws none, and light dismiss closes it.
    - A fill refused after the popup was dismissed shows its sentence as an alert under the bar; while the popup is open it stays in the popup, as today.
12. **The picker's hours.** Each person keeps "{status} · {planned} / {contract} h". New: when the slot's length would take their planned hours over a contract, a line "would go over {contract} h contract" in `--wt-color-danger` (board 1). The open-slots menu shows "would make {planned} / {contract} h" in the same colour under such a slot (board 2). Hours keep today's decimal form ("32.5", `rota-format.ts:11-18`), not board 2's "32½". A person already working at that time keeps their button, drawn muted.
13. **Card words in Everyone:** a partly uncovered shift reads "uncovered 14:00–17:00", the area's words (`rota-by-area.ts:145`), not board 2's "slot runs to 17:00", which covers only a gap at the end.
14. **Phone width is the rota's own width below 560 px**, the Calendar Week's breakpoint (`PHONE_WIDTH`, `opening-hours-week.ts:40`), measured the same way (on connect and by a `ResizeObserver`, `opening-hours-week.ts:545-555`). The rota keeps its own `PHONE_WIDTH = 560` because that file is outside venue-service's `exports`; the constant's comment points at the Week's.
15. **The phone's shown day** is component state, not part of the address: the browser's today when it falls in the week, else Monday; ‹ › keep the same weekday. A strip button selects a day. No swipe (the spec does not ask for one). Strip buttons carry `aria-pressed`; a day that needs attention (any non-zero count in scope) shows a dot and adds "needs attention" to its accessible name; a Closed day (Decision 8) is drawn muted.
16. **On a phone, in an area** the day's staff role groups list its slots and cards, with dashed slots to fill; there is no per-role "+ Add shift" (board 5 has none). A shift beyond the paint is added on a phone from Show: Everyone. A role group appears when it has a slot or a shift that day. **In Everyone**, each person is a block: a button with their name, staff roles and hours, which opens the open-slots menu, then that day's cards.
17. **"+ Add shift" in an area cell** is a button filling the empty part of the cell below its cards, its text shown only on `:hover` or `:focus-visible`, its accessible name always set ("Add a {role} shift on {day}"). It opens the shift editor with the day, the area and the row's staff role already chosen and no person. `rota-shift-dialog` gains `area` and `staffRoleId` properties for that; its baseline is the seeded draft, so Save stays quiet until a person is chosen. In Everyone the empty part is the same kind of button, named "Fill a slot or add a shift for {name} on {day}", and opens the open-slots menu (board 2 shows its "+ Add shift" text on focus).
18. **The empty-area message's paint button:** the first day of the week that is not a special day and has a season gives "Paint {season}'s standard week" (`painter: "season"`); if every day of the week is a special day, the first one's editor ("Edit {name} staffing", `painter: "special-day"`). On a phone, a shown day that is a special day offers its editor. With no season and no special day, the message has no paint button. The button opens `open("staffing", { month: <Monday's month>, area: <shown area>, painter, season | "special-day" })`, the parameters `staffing-month.ts:308-316` uses. It is offered only when the person may open the Staffing view; its label is "Show {season}'s standard week" / "Show {name} staffing" (existing keys) when they may not write it. The second button is "Show everyone" (`open("rota", { week, area: "everyone" })`).
19. **"Publish"** is in the bar of every week that is not published, for a person who may write: `secondary` and disabled while the week has no shifts (`read.shifts.length === 0`, which includes no version at all) or while the warnings have not loaded (today's rule, `rota-view.ts:341-342`); `primary` otherwise. It reads "Publish changes" when `version.changedSincePublished`. A published week shows "Change this week" (`secondary`, as board 4 draws it). On a phone the action sits in a bar stuck to the foot of the rota.
20. **The swap notice** stays where it is set today (`swapNotice`, `rota-view.ts:116`, `:257`) and is drawn as a box under the bar, info tone, tokens only.
21. **Strings.** New and changed keys, English then Spanish, live in `strings.ts`; each task lists its own. Retired keys are deleted once nothing reads them: `staffing.rota.by_area`, `by_person`, `view`, `people`, `attention`, `close`, `unfilled`, `area`, after a grep shows no reader.
22. **File and element names stay** (`rota-by-area`, `rota-by-person`): `rota-by-person` draws Show: Everyone. Renaming would add churn to every test file for no behaviour.

## Assumptions (not tested)

- The `::backdrop` of an auto popover dims the page in Chromium; other browsers are not tested in this repo.
- Santet's Mondays are a season with no hours (boards 1–3 draw them "Closed"); the plan does not depend on it, but the LOOK task checks it on the demo venue.

---

## Global constraints

- **TDD.** Every task writes its failing tests first and watches them fail for the expected reason, then implements. The dashboard tests run in real headless Chromium (the `browser` project, `packages/staffing/vitest.config.ts:28-43`); Task 1's server tests run in the `node` project.
- **Commands** (the package is `@waitron/staffing`):
  - focused: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/staffing exec vitest run <files>`
  - after each task: `pnpm --filter @waitron/staffing typecheck`, `pnpm exec eslint packages/staffing/src`, `pnpm exec prettier --check <changed files>` (also `pnpm format:check` once before committing).
  - Before a browser run, `memory_pressure | grep free` must show well above 15%. Read the `Tests` count, never the exit status of a pipe.
  - Baseline, 2026-10-17, 66% memory free: `pnpm --filter @waitron/staffing exec vitest run src/dashboard/rota-view.test.ts src/dashboard/rota-by-person.test.ts src/dashboard/rota-planning.test.ts src/dashboard/rota-races.test.ts src/dashboard/slot-picker.test.ts src/dashboard/rota-view.a11y.test.ts src/dashboard/slot-picker.a11y.test.ts src/dashboard/rota-by-person.a11y.test.ts src/dashboard/index.test.ts` gave `Test Files 9 passed (9)`, `Tests 80 passed (80)` in 12 s.
- **Tokens:** every colour, space, radius and font reads a `--wt-*` token; no hex, no named colour, no `rem`/`em`, no raw px except the documented 8 px popover margin and the 560 px breakpoint (both constants in TypeScript, not CSS).
- **Strings:** every visible or announced string is a key in `strings.ts`, in English and Spanish, as short as the meaning allows.
- **Fields:** the Show menu is `wt-combobox`; no native `<select>`, `<input>` or `<textarea>` (`scripts/native-form-fields.test.ts`).
- **Buttons:** a button that is not a save is drawn `secondary` while it waits for a load or its state rules it out, and its own variant once it can act (design-system.md → Forms, A416/A427). Plain `<button>`s in grids and menus keep today's card styling.
- **Reads:** no new browser read. The two existing reads stay passive (`client.ts:124-174`). The fill, change-week and publish writes stay non-passive.
- **Events:** the rota's own elements keep plain event names (they are app-owned, not `wt-*`), dispatched `bubbles: true, composed: true` as today.
- **Accessibility:** each changed or new element gets axe states in both themes in its `*.a11y.test.ts`; a popup state is run with the popup open (`:popover-open`), never hidden, or axe passes on nothing.
- **Coverage:** the package holds `98/98/98/95`. Every new branch has a test. Read CI's per-file rows for the changed files.
- **Changed test checks:** an existing assertion may change only where the spec deliberately changes what it checks; its new form must be at least as strict; never delete or loosen one. Every task reports each changed check in a table (file:line, before, after); the PR carries the merged table. The planned changes are listed in each task. The one that narrows what is checked (Task 4, the weekly warning in an area) is called out for review.
- **Commits:** `git commit -s`, explicit paths, never `--no-verify`, never `git stash`.
- **Size:** each task is written to finish well under 100 tool calls. An implementer passing about 150 stops at a passing or cleanly failing point, commits, and returns a handover.

---

## Current code map (read 2026-10-17 at `45ce9e66d`)

- `packages/staffing/src/rota.ts` — `readRotaWeek` (`:36-162`) builds `RotaWeek`: the day plan (`:41`), areas (`:42`), resolved paint (`:43`), roles, rota rows; `closedAllDay` is a special day's closure only (`:86`); `people[].plannedMinutes` sums the week's shifts (`:154-156`). `addRotaShift` creates the week's draft version on its first shift (`:228-232`).
- `packages/staffing/src/staffing-types.ts:111-135` — `RotaWeek`. No season, special day or hours.
- `packages/staffing/src/dashboard/index.ts:64-87` — the Rota calendar view; search destinations `by-area`/`by-person` with `mode` (`:66-69`); `validWeek`/`monday` (`:101-115`). The Staffing view works out `canOpenRota` from `ctx.calendarViews` (`:37`).
- `packages/staffing/src/dashboard/rota-view.ts` (`staffing-rota`) —
  - state: `picked`, `editor`, `busy`, `warnings`, `swapNotice`, `publishing` and errors (`:108-119`); area/mode change clears the picker (`:153-158`); week change resets everything and re-watches (`:159-176`).
  - `#watch` (`:177-206`) applies the rota and starts the warnings read; closes the picker when its slot is gone or the week is published.
  - `#go` keeps `area` and `mode` (`:207-213`). `#fill` (`:214-248`), `#changeWeek` (`:249-265`), `#publish` (`:266-290`).
  - render: row 1 ‹ title › area combobox, attention text `[data-test=attention]` and state (`:303-322`); row 2 the By area/By person switch (`:323`); labour notice or count on their own line (`:324-332`); swap notice (`:333`); Change this week (`:335`); Publish only when `version.status === "draft"` (`:337-350`); the grid and the `aside` people panel holding the picker (`:352-427`); the shift dialog (`:428-446`); the publish dialog (`:447-457`).
  - The title is `${dateLabel(week)} – ${dateLabel(sunday)}` (`:312`), not a link, not fixed width.
- `rota-by-area.ts` (`rota-by-area`) — a row per staff role, always (`:192-202`); "Not in a slot", always (`:203-219`); a cell writes "Closed" on `closedAllDay` (`:163`); an unfilled slot reads "+ unfilled" (`:149`) and sends `pick-slot` (`:113-117`); filled and over cards send `edit-shift` (`:118-122`).
- `rota-by-person.ts` (`rota-by-person`) — reuses the area's styles (`:13`); a row per person in read order (`:67`); under the name, roles, hours and week warnings (`:70-75`); every editable cell has an "Add shift" button `[data-test=add-shift]` sending `add-shift` (`:86`).
- `slot-picker.ts` (`slot-picker`) — holders, then everyone after Show everyone (`:103-111`); status free / on leave / working (`:74-100`); hours (`:137`); candidate warnings (`:139`); a "Close picker" button (`:156-161`). Sends `choose` and `close-picker`.
- `shift-edit-dialog.ts` (`rota-shift-dialog`) — seeds a new shift with `personId` alone (`:106`); subject key `${week}:${shiftId ?? businessDay:personId}` (`:87`).
- `rota-format.ts` — `shiftTime`, `minuteTime`, `hours` (decimal).
- `format.ts` — `dateFormat`, `utc`, `dateLabel`.
- `strings.ts` — rota keys at `:13-95` (English) and `:204-289` (Spanish); "Labour rules are not set up" at `:46`/`:237`.
- `packages/staffing/src/testing/rota-fixture.ts` — `rotaWeek()` (Kitchen station; day 0 closed with no slots; a filled and a partly uncovered slot on day 1; an outside-role fill on day 2; an over shift on day 3; an unfilled slot `empty` on day 4; an unlinked previous-week shift) and `rotaApi()`.
- `packages/venue-service/src/dashboard/opening-hours-week.ts` — the Week: `PHONE_WIDTH = 560` (`:40`), month links in the title (`:577-600`), `fixedTitle` (`:616`), narrow measurement (`:545-555`). `fixed-title.ts` is exported as `@waitron/venue-service/dashboard/fixed-title`; `placePopover` as part of `@waitron/venue-service/painter` (`painter.ts:15`).
- Tests that pin today's shape outside the rota files: `packages/staffing/src/dashboard/index.test.ts:308-337` (search destinations), `apps/dashboard/src/dashboard-app.search-modules.test.ts:172-211` (searches "by person", opens `calendar:rota:by-person`, path `/view/rota/mode/person`) and its rota fake at `:85-98`.

---

## Tasks

| # | Task | Server? |
|---|---|---|
| 1 | The rota read names each day's hours, season and special day | yes |
| 2 | One Show menu replaces the area picker and the By area / By person switch | no |
| 3 | One bar: the title links to the month, the state, the counts and the one action | no |
| 4 | The people panel goes; the picker opens beside its slot in `rota-popup` | no |
| 5 | The count buttons step to the next slot; the day headers say what needs attention or Closed | no |
| 6 | The area grid: rows only when used, "Fill", and "+ Add shift" in the empty part of a cell | no |
| 7 | Everyone: rows in staff-role order, cards with colour, area and role | no |
| 8 | Everyone: clicking an empty day offers that day's open slots, then "Another shift…" | no |
| 9 | Empty weeks say why | no |
| 10 | Phone: one day at a time, with the strip and the foot action | no |
| 11 | Phone: the picker and the open-slots menu as sheets | no |
| 12 | LOOK (driver) | — |
| 13 | Docs (driver) | — |

### Task 1: The rota read names each day's hours, season and special day

**Files:**
- Modify `packages/staffing/src/rota.ts` (`readRotaWeek`), `packages/staffing/src/staffing-types.ts` (`RotaWeek`).
- Modify `packages/staffing/src/testing/rota-fixture.ts`: day `n` gets `hasHours: n !== 0`, `seasonId: "winter"`, `specialDay: null`; the week gets `seasons: [{ id: "winter", name: "Winter" }]`.
- Modify `apps/dashboard/src/dashboard-app.search-modules.test.ts:85-98`: add `seasons: []` to the rota fake (no assertion changes).
- Test `packages/staffing/src/rota.test.ts`.

**Interfaces (produces):**
```ts
// RotaWeek
seasons: { id: string; name: string }[];   // the seasons the week's days fall in, in first-touched order
days: {
  …today's fields…
  hasHours: boolean;            // some active department has opening hours that business day
  seasonId: string | null;
  specialDay: { id: string; name: string } | null;
}[];
```

- [ ] **Step 1: Failing tests** in `rota.test.ts`, under `describe("the rota week")`. Seed hours and special days directly, as `packages/staffing/src/paint.test.ts:284-291` (department hours) and `packages/staffing/src/month.test.ts:61-80` (a special day with a date closed all day) do:
  - `"names each day's season and special day, and the seasons the week touches"`: seedVenue's season ("Summer", from 06-01) holds the week of 2026-11-30. Add a special day "Fiesta" with the date 2026-12-02. Expect `days[0].seasonId` to be `v.seasonId`, `days[2].specialDay` to equal `{ id, name: "Fiesta" }`, every other `specialDay` null, and `seasons` to equal `[{ id: v.seasonId, name: "Summer" }]`.
  - `"says which days have opening hours: a season weekday with a range, not one without, and not a special day closed all day"`: give the department a range on weekday 2 (Tuesday) and weekday 4 (Thursday) of the season; make Thursday 2026-12-03 a special-day date closed all day. Expect `hasHours` true on 2026-12-01 only. The failing case would print `true` for Thursday; the control is Tuesday's `true`.
  - `"an inactive department's hours do not count"`: switch the department off (as `paint.test.ts`'s `switchOff` does); every `hasHours` is false.
- [ ] **Step 2: Run** `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/staffing exec vitest run src/rota.test.ts` and watch the three fail on the missing fields.
- [ ] **Step 3: Implement.** In `readRotaWeek`: read the clock as today (`:39`); call `resolveDepartmentsDays(tx, scope, departmentIds, days, clock, plan)` with the department ids from `areas` (active only, `listStaffingAreas`), reusing the `plan` from `:41`; `hasHours` is true when any department's `ranges` is non-empty that day. `seasonId` from `plan.seasonIdOn`, `specialDay` from `plan.special` (`{ id: special.specialDayId, name: special.name }`, as `readCalendarMonthPlan` maps it, `packages/venue-service/src/opening-hours-calendar.ts:200-205`). `seasons` from `readSeasons` (exported, `index.ts:96`), filtered to the ids the days name, in first-touched order. Keep `closedAllDay`.
- [ ] **Step 4: Run** the server test, then the whole node project once (`… exec vitest run --project node`), then the browser baseline list above (the fixture changed). Expected: all pass. Then confirm the claim that the live dependencies already cover the new reads: list the tables `resolveDepartmentsDays` and `readSeasons` read (`packages/venue-service/src/day-resolver.ts:134-170`, `season-weeks.ts`, `seasons.ts`) and check each is in `QUERY_DEPENDENCIES.rota`; add any that is missing, with a case in `live-queries.test.ts`, and run `pnpm exec vitest run scripts/live-subscriptions.test.ts`.
- [ ] **Step 5: typecheck, lint, prettier; commit** `feat(staffing): the rota read names each day's hours, season and special day (A763)`.

### Task 2: One Show menu replaces the area picker and the By area / By person switch

**Files:**
- Modify `rota-view.ts` (the area combobox and `:323`'s switch become one Show combobox; `#go`; `willUpdate`'s reset key; `render`'s choice between grids), `index.ts` (search destinations), `strings.ts`.
- New `packages/staffing/src/dashboard/rota-model.ts` and `rota-model.test.ts` (browser project, pure functions).
- Tests: `rota-view.test.ts`, `rota-by-person.test.ts`, `index.test.ts`, `rota-view.a11y.test.ts`, `apps/dashboard/src/dashboard-app.search-modules.test.ts`.

**Interfaces (produces):**
```ts
// rota-model.ts
export const EVERYONE = "everyone";
export type Show = { kind: "everyone" } | { kind: "area"; area: AreaRef; key: string; name: string };
export function chosenShow(read: RotaWeek, asked: string | undefined): Show | null; // null: no active areas
export function matchesFor(read: RotaWeek, show: Show, businessDay?: string): AreaDayMatch[];
```
Strings: `staffing.rota.everyone` "Everyone" / "Todo el equipo"; `staffing.rota.everyone_search` "Everyone's rota" / "Turnos de todo el equipo". Show's label reuses `staffing.month.area`.

- [ ] **Step 1: Failing tests:**
  - `rota-model.test.ts`: `chosenShow` gives the first area for `undefined`, `""` and an unknown key; the named area for its key; Everyone for `"everyone"`; null when `read.areas` is empty. `matchesFor` gives one area's matches for an area and every area's for Everyone, optionally for one day.
  - `rota-view.test.ts`, new `"one Show menu offers Everyone then each area, and sends the choice as the area word"`: exactly one `wt-combobox` (`name="area"`, label "Show"); its options are `["everyone", "station:kitchen", "department:restaurant"]` with labels `["Everyone", "Kitchen", "Restaurant"]`; choosing Everyone calls `open("rota", { week: "2026-11-30", area: "everyone" })`; no `[data-test=by-area]` or `[data-test=by-person]`; with `params = { area: "everyone" }` the view draws `rota-by-person` and the menu's value is `"everyone"`.
  - `rota-view.test.ts`, `"a week step keeps Everyone"`: with `area: "everyone"`, next week calls `open("rota", { week: "2026-12-07", area: "everyone" })`.
  - `rota-view.a11y.test.ts`: add an `"everyone"` state (params `{ area: "everyone" }`, waits for `rota-by-person`).
- [ ] **Step 2: Changed test checks:**

  | Test (file:line) | Before | After |
  |---|---|---|
  | `rota-by-person.test.ts:39` (mount) | `params = { mode: "person", area: "station:kitchen" }` | `params = { area: "everyone" }` (setup only) |
  | `rota-by-person.test.ts:133-139` | next week opens `{ week, area: "station:kitchen", mode: "person" }` | opens `{ week: "2026-12-07", area: "everyone" }` |
  | `rota-by-person.test.ts:154-157` "keeps the area filter out of the all-areas person view" | no `[name="area"]` | exactly one `wt-combobox`, the Show menu, valued `"everyone"`; no `[data-test=by-area]`/`by-person` (stricter) |
  | `index.test.ts:308-337` | destinations `[{ mode: "area" }, { mode: "person" }]`; the matching switch button `aria-pressed="true"` | destinations `[{ area: "everyone" }]`; the real view's Show value is `"everyone"` and `rota-by-person` is drawn |
  | `apps/dashboard/src/dashboard-app.search-modules.test.ts:172-211` | searches "by person", opens `calendar:rota:by-person`, `[data-test=by-person]` pressed, path `/manage/opening-hours/view/rota/mode/person`; then the same id disappears without the permission | searches "everyone", opens `calendar:rota:everyone`, Show valued `"everyone"`, path `/manage/opening-hours/view/rota/area/everyone`; the same id disappears without the permission. Test name "Rota person view" → "Rota for everyone" |

- [ ] **Step 3: Run and watch fail:** `… exec vitest run src/dashboard/rota-model.test.ts src/dashboard/rota-view.test.ts src/dashboard/rota-by-person.test.ts src/dashboard/index.test.ts`.
- [ ] **Step 4: Implement** Decisions 1–3 and 22: `render` uses `chosenShow(read, this.params.area)`; `#go(week, area)` sends `area` only (no `mode`); `willUpdate` resets the picker when `params.area` changes (drop `#mode`); search destinations per Decision 2. Delete `staffing.rota.by_area`, `by_person`, `view` once unread.
- [ ] **Step 5: Run** the files above, plus `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.search-modules.test.ts`. Typecheck both packages; lint; prettier. **Commit** `feat(staffing): one Show menu for the rota — Everyone or an area (A763)`.

### Task 3: One bar — the title links to the month, the state, the counts and the one action

**Files:** `rota-view.ts`, `format.ts` (`weekTitleParts`), `index.ts` (pass `canOpenStaffing` and `canWriteStaffing` from `ctx.calendarViews`), `rota-model.ts` (`weekCounts`, `summary`), `strings.ts`. Tests: `rota-view.test.ts`, `rota-planning.test.ts`, `rota-model.test.ts`, `rota-view.a11y.test.ts`, `index.test.ts`.

**Interfaces:**
```ts
// rota-model.ts
export function weekCounts(read: RotaWeek, show: Show): { unfilled: number; partly: number; over: number };
export type Summary = "counts" | "all_filled" | "no_shifts" | "nothing_to_fill";
export function summary(read: RotaWeek, show: Show): Summary;   // Decision 6
// format.ts
export function weekTitleParts(monday: string, language?: string): { text: string; month?: string }[];
// rota-view.ts
@property({ type: Boolean }) canOpenStaffing = false;
@property({ type: Boolean }) canWriteStaffing = false;
```
Strings (EN / ES): `staffing.rota.partly_count` "{count} partly uncovered" / "{count} parcialmente cubiertos"; `staffing.rota.over_count` "{count} over" / "{count} sobrantes" (`unfilled_count` exists); `staffing.rota.all_filled` "All slots filled" / "Todos los puestos cubiertos"; `staffing.rota.nothing_to_fill` "Nothing to fill" / "Nada que cubrir"; `staffing.rota.no_shifts` "No shifts yet" / "Aún no hay turnos"; `staffing.rota.no_rules` changes to "No labour rules to check against" / "No hay reglas laborales con las que comprobar"; `staffing.rota.still_published` "Staff still see the published week" / "El equipo sigue viendo la semana publicada"; `staffing.rota.publish_changes` "Publish changes" / "Publicar cambios"; `staffing.rota.month_hint` "Opens this month's staffing" / "Abre el personal de este mes". Delete `staffing.rota.attention` and `staffing.rota.changed` once unread.

- [ ] **Step 1: Failing tests:**
  - `rota-model.test.ts`: `weekCounts` for Kitchen and for Everyone (an extra Restaurant unfilled slot counts only for Everyone); `summary` gives each of its four answers, one fixture each.
  - `rota-view.test.ts`, `"the bar holds the week, Show, then the state, the counts, the labour count and Publish, in that order, on one row at 1280"`: at a 1280 px frame, the elements' `top`s are within 1 px of each other, their `left`s increase in that order, and the counts are three `button`s reading "1 unfilled", "1 partly uncovered", "1 over".
  - `"the title is the week's range, keeps one width across weeks, and each month name opens that month's Staffing"`: title text contains "30 Nov – 6 Dec 2026"; the title box's width is the same for weeks 2026-11-30 and 2026-12-28 (measure `.fixed-title`); with `canOpenStaffing`, the "Nov" link calls `open("staffing", { month: "2026-11", area: "station:kitchen" })` and "Dec" `open("staffing", { month: "2026-12", area: "station:kitchen" })`; with Everyone, no `area`; without `canOpenStaffing` the title has no `button`.
  - `"Publish is in the bar of every unpublished week: quiet with no shifts or no version, loud once a shift exists"`: a read with `version: null, shifts: []` → `[data-test=publish-week]` `secondary` and disabled; a draft with `shifts: []` → the same; the fixture → `primary` and enabled once warnings load.
  - `"a week being changed says staff still see the published week and offers Publish changes"`: fixture (`changedSincePublished: true`) → "Staff still see the published week" in the bar and the button reads "Publish changes"; with `changedSincePublished: false` neither.
  - `"a published week shows Published, its summary and Change this week"`.
  - `"zero counts are left out; with none it reads All slots filled"` (one fixture with only filled slots).
  - `"the open-swaps notice sits under the bar"` (its box's `top` ≥ the bar's `bottom`).
  - `index.test.ts`: the Rota contribution passes `canOpenStaffing`/`canWriteStaffing` from `ctx.calendarViews` (true when the Staffing entry is there, with its `canWrite`; false without it).
  - `rota-view.a11y.test.ts`: add states `"no-version"`, `"changing"` (changed since published, swap notice shown), `"all-filled"`, `"no-rules"`.
- [ ] **Step 2: Changed test checks:**

  | Test (file:line) | Before | After |
  |---|---|---|
  | `rota-planning.test.ts:242` | text contains "Labour rules are not set up" | text contains "No labour rules to check against", inside the bar |
  | `rota-planning.test.ts:327` | text does not contain "Labour rules are not set up" | does not contain "No labour rules to check against" |
  | `rota-view.test.ts:70-72` | `[data-test=attention]` text contains "1 unfilled · 1 partly uncovered · 1 over" | unchanged: the three buttons are joined by " · " text nodes inside `[data-test=attention]` |
  | `rota-view.test.ts:188` | `[data-test=week]` contains "7 Dec" | unchanged ("7 – 13 Dec 2026") |

- [ ] **Step 3: Run and watch fail**, then **implement** Decisions 4–6 and 19–20: the two rows (`.head` wraps on narrow widths; Task 10 handles the phone), the state pill, the counts as `<button class="count" data-kind=…>` (Task 5 makes them step; here they do nothing yet but are focusable), the labour count `[data-test=labour-count]` and the no-rules note in the bar, Change this week / Publish in the bar, errors and the swap notice under it.
- [ ] **Step 4: Run** `rota-view.test.ts rota-planning.test.ts rota-races.test.ts rota-model.test.ts rota-view.a11y.test.ts index.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): the rota's one bar — linked title, state, counts and Publish (A763)`.

### Task 4: The people panel goes; the picker opens beside its slot in `rota-popup`

**Files:**
- New `packages/staffing/src/dashboard/rota-popup.ts`, `rota-popup.test.ts`, `rota-popup.a11y.test.ts`.
- Modify `rota-view.ts` (drop the `aside` and `.layout`'s side column, `:353-423`; the grid takes the full width; the picker goes into a `rota-popup`), `rota-by-area.ts` (`pick-slot` detail gains `anchor`; daily warnings on cards, Decision 10), `slot-picker.ts` (no Close button unless `sheet`; "would go over" line; subheading), `strings.ts`.
- Tests: `rota-view.test.ts`, `rota-planning.test.ts`, `slot-picker.test.ts`, `slot-picker.a11y.test.ts`, `rota-view.a11y.test.ts`.

**Interfaces:**
```ts
// rota-popup.ts — <rota-popup>
@property({ type: Boolean, reflect: true }) sheet = false;  // phone: Task 11 sets it
@property() heading = "";                                    // read by screen readers, focused on open
show(anchor: HTMLElement): void;  // places beside (Decision 11), or bottom sheet when `sheet`
hide(): void;
get shown(): boolean;
// sends "rota-popup-close" (detail {}) when it closes for any reason
// slot-picker.ts
@property({ type: Boolean }) sheet = false;   // draws Cancel (staffing.role.cancel) and sends close-picker
// rota-by-area.ts: "pick-slot" detail { slot: Slot; anchor: HTMLElement }
```
Strings: `staffing.rota.picker_sub` "{area} · holders of the staff role first" / "{area} · primero quienes tienen el rol"; `staffing.rota.would_go_over` "would go over {contract} h contract" / "superaría su contrato de {contract} h". Delete `staffing.rota.people` and `staffing.rota.close` once unread.

- [ ] **Step 1: Failing tests:**
  - `rota-popup.test.ts`: at 1280×900, `show(anchor)` with an anchor at the left of the window puts the popup's left at the anchor's right (±1 px) and its top at the anchor's top; with the anchor at the right edge it sits on the anchor's start side; at 390 px wide with `sheet` false and no room on either side it sits below the anchor; the popup stays inside the window by 8 px; Escape and a `userEvent.click` outside close it and send `rota-popup-close` once; focus moves to the heading on open and returns to the anchor on close when it was inside. Token-painting: its background equals `--wt-color-surface` and its border colour `--wt-color-border`, measured against a probe as `rota-view.test.ts:78-94` does.
  - `rota-popup.a11y.test.ts`: states `"open beside"` and `"open with a list of buttons"`, both themes, popup open.
  - `rota-view.test.ts`, `"the picker opens beside the slot that was clicked, not in a side panel, and the grid takes the full width"`: `userEvent.click` on `[data-slot=empty]`; `rota-popup` is `:popover-open` and its left is at the slot's right (±1 px); no `aside`; the grid's `[data-test=grid-scroll]` width equals the view's width (±1 px) at 1280.
  - `slot-picker.test.ts`, `"says when the slot would take someone over their contract"`: give Laia `plannedMinutes: 2100` (35 h of 40) and an 8 h slot → "would go over 40 h contract"; Marc at 2340 with a 1 h slot does not.
  - `slot-picker.test.ts`, `"has no Close button beside a slot, and Cancel in a sheet"`.
  - `rota-planning.test.ts`, `"draws a daily warning on that person's cards on that date in the area"` (see the table).
  - `rota-view.a11y.test.ts`: the `"picker"` state now opens it with `userEvent.click` and checks `:popover-open` before axe.
- [ ] **Step 2: Changed test checks:**

  | Test (file:line) | Before | After |
  |---|---|---|
  | `rota-view.test.ts:73-76` | the people panel's `[data-person=joan]` reads "41 / 40 h" and has `data-over-contract` | switched to `params = { area: "everyone" }`: `rota-by-person`'s `[data-person=joan] th` reads "41 / 40 h" and has `data-over-contract`; and in the area view no `[data-person]` panel exists |
  | `rota-view.test.ts:256-260` "lists staff roles in the people panel" | the panel's `[data-person=ana]` contains "Head chef" | renamed "lists staff roles under each name in Everyone": `rota-by-person`'s `[data-person=ana] th` contains "Head chef" |
  | `rota-planning.test.ts:346-376` "shows daily and weekly warnings beside the named person in the area view" | the panel's `[data-person=ana]` shows the daily warning and `[data-person=joan]` the weekly one | the area's `[data-shift=filled]` (Ana's shift on 2026-12-01) shows "2026-12-01: 10 h planned; daily maximum 9 h"; then with `area: "everyone"`, `rota-by-person [data-person=joan] th` shows "weekly maximum 40 h". **For review:** the weekly warning is no longer shown in an area (Decision 10); the bar's labour count still counts it |
  | `slot-picker.a11y.test.ts:13-30` | the picker mounted alone | unchanged (the picker is still a plain element; the popup is tested separately) |

- [ ] **Step 3: Run and watch fail**, then **implement** Decisions 10–12 and the popup. Place the popup in `updated()` after the picker's content renders, before its first paint (CLAUDE.md §4: "Position a native popover before its first paint"). The fill path stays `#fill`; a refusal after the popup closed shows under the bar (Decision 11).
- [ ] **Step 4: Run** `rota-popup.test.ts rota-popup.a11y.test.ts rota-view.test.ts rota-planning.test.ts rota-races.test.ts slot-picker.test.ts slot-picker.a11y.test.ts rota-view.a11y.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): the rota picker opens beside its slot and the people panel goes (A763)`.

### Task 5: The count buttons step to the next slot; the day headers say what needs attention or Closed

**Files:** `rota-model.ts` (`attentionTargets`, `dayCounts`, `isClosed`), `rota-view.ts` (count clicks, pending focus across a Show switch), `rota-by-area.ts` and `rota-by-person.ts` (headers; `focusTarget`), `strings.ts`. Tests: `rota-model.test.ts`, `rota-view.test.ts`, `rota-by-person.test.ts`.

**Interfaces:**
```ts
export type Target = { businessDay: string; area: AreaRef; slotKey?: string; shiftId?: string };
export function attentionTargets(read: RotaWeek, show: Show, kind: "unfilled" | "partly" | "over"): Target[];
export function dayCounts(read: RotaWeek, show: Show, businessDay: string): { unfilled: number; partly: number; over: number };
export function isClosed(read: RotaWeek, show: Show, businessDay: string): boolean; // Decision 8
// rota-by-area / rota-by-person
focusTarget(target: Target): boolean; // focuses [data-slot] or [data-shift], tabindex -1 when not a button; false when absent
```

- [ ] **Step 1: Failing tests:**
  - `rota-model.test.ts`: `attentionTargets` in reading order (two unfilled slots on Tue and Fri, in two rows); `dayCounts`; `isClosed` true for `hasHours: false` with no slot in scope, false for `hasHours: false` with a slot, false for `hasHours: true` with none.
  - `rota-view.test.ts`, `"each count button focuses the next such slot, wrapping"`: two unfilled slots → first press focuses slot 1, second slot 2, third slot 1 (`area(el).shadowRoot!.activeElement`). Partly uncovered and over focus their cards.
  - `"in a published week a count focuses a card that is not a button"` (`tabindex="-1"`, focused).
  - `"in Everyone the unfilled count switches Show to that slot's area and focuses it"`: `open` is called with the area; the test then sets `params` as the host would and expects the slot focused.
  - `"a day header names its attention and a closed day reads Closed once"`: the fixture's Friday header contains "1 unfilled"; Monday (`hasHours: false`, no slot) reads "Closed" in its header and no cell holds "Closed".
- [ ] **Step 2: Changed test checks:** `rota-view.test.ts:67` (`text(el)` contains "Closed") — unchanged in what it reads: "Closed" is now in the header, which is inside `rota-by-area`'s shadow root. `rota-by-person.test.ts:84`'s per-cell "Closed" is not asserted anywhere (grep `Closed` in the test files before changing it).
- [ ] **Step 3: Run, watch fail, implement** Decisions 7–8, run again.
- [ ] **Step 4: Run** `rota-model.test.ts rota-view.test.ts rota-by-person.test.ts rota-view.a11y.test.ts rota-by-person.a11y.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): rota counts step to the next slot; headers say what needs attention (A763)`.

### Task 6: The area grid — rows only when used, "Fill", and "+ Add shift" in the empty part of a cell

**Files:** `rota-by-area.ts`, `rota-model.ts` (`rolesShown`), `shift-edit-dialog.ts` (`area`, `staffRoleId` seeds), `rota-view.ts` (handles `add-shift` with area and role), `strings.ts`. Tests: `rota-view.test.ts`, `rota-model.test.ts`, `shift-edit-dialog.test.ts`, `shift-edit-dialog.save-state.test.ts`, `rota-view.a11y.test.ts`.

**Interfaces:**
```ts
export function rolesShown(read: RotaWeek, show: Show & { kind: "area" }): StaffRole[]; // Decision 9
// rota-by-area: "add-shift" detail { businessDay: string; area: AreaRef; staffRoleId: string }
// rota-shift-dialog
@property() area = "";        // an area key
@property() staffRoleId = "";
```
Strings: `staffing.rota.fill` "Fill" / "Cubrir"; `staffing.rota.add_here` "+ Add shift" / "+ Añadir turno"; `staffing.rota.add_label_area` "Add a {role} shift on {day}" / "Añadir un turno de {role} el {day}". Delete `staffing.rota.unfilled` once unread.

- [ ] **Step 1: Failing tests:**
  - `rota-model.test.ts`: `rolesShown` drops a role with no slot and no shift that week, keeps one with only an over shift.
  - `rota-view.test.ts`, `"a staff role row appears only when the area has slots or shifts for it that week; Not in a slot only when it has a shift"`: add a third role with neither → not drawn; drop the unlinked shift → no "Not in a slot" row.
  - `"an unfilled slot reads its time and Fill, dashed"`: `[data-slot=empty]` text "09:00–17:00 · Fill"; computed `border-style` dashed.
  - `"the empty part of a cell shows + Add shift on hover or focus and opens the editor with the day, area and staff role"`: the `[data-test=cell-add]` in Sous chef × Friday has `opacity` 0 at rest, 1 under `userEvent.hover` and after `userEvent.tab` reaches it; its accessible name is "Add a Sous chef shift on Fri 4 Dec" (`{day}` from `dateLabel`, as the picker heading uses); `userEvent.click` opens `rota-shift-dialog` with `businessDay` "2026-12-04", `area` "station:kitchen", `staffRoleId` "sous", no `personId`. None in a published week.
  - `shift-edit-dialog.test.ts`, `"a new shift opened from a cell starts with its area and staff role"`; `shift-edit-dialog.save-state.test.ts`, `"…and its Save stays quiet until a person is chosen"`.
  - `rota-view.a11y.test.ts`: add a `"cell-add focused"` state.
- [ ] **Step 2: Changed test checks:**

  | Test (file:line) | Before | After |
  |---|---|---|
  | `rota-view.test.ts:65` | area text contains "+ unfilled" | contains "Fill", and `[data-slot=empty]` reads "09:00–17:00 · Fill" (stricter) |
  | `rota-view.test.ts:55-59` | row headers `["Head chef","Sous chef","Not in a slot"]` | unchanged (the fixture has slots for both roles and an unlinked shift) |

- [ ] **Step 3: Run, watch fail, implement** Decisions 9 and 17 (area half). The add button fills the cell's remaining height (`flex: 1` in a column flex cell) so "the empty part" is the target.
- [ ] **Step 4: Run** the files above plus `shift-edit-dialog.unsaved.test.ts shift-edit-dialog.a11y.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): the area rota draws only used rows, Fill slots and an Add shift in each cell's empty part (A763)`.

### Task 7: Everyone — rows in staff-role order, cards with colour, area and role

**Files:** `rota-by-person.ts` (own styles extending the area's; header; rows; cards), `rota-model.ts` (`peopleInOrder`). Tests: `rota-by-person.test.ts`, `rota-model.test.ts`, `rota-by-person.a11y.test.ts`.

**Interfaces:** `export function peopleInOrder(read: RotaWeek): RotaWeek["people"];` (Decision 9).

- [ ] **Step 1: Failing tests:**
  - `rota-model.test.ts`: order by lowest staff-role position, then name, then id; no-role people last (Ibra last in the fixture; Ana and Marc (head, position 0) before Joan and Laia (sous)).
  - `rota-by-person.test.ts`, `"rows follow each person's first staff role, then name"`: `[data-person]` order `["ana","marc","joan","laia","ibra"]`.
  - `"each card carries its staff role's colour, its time, its area and staff role, and keeps its warnings"`: `[data-shift=filled] .swatch` has `data-colour="purple"` and paints `--wt-color-palette-purple`; text "09:00–17:00" and "Kitchen · Head chef"; the over card "not needed"; the partly uncovered card (`[data-shift=part]`) "uncovered 14:00–17:00" (Decision 13).
  - `"under each name its staff roles and the week's hours, marked when over contract"` (Joan: "41 / 40 h", `data-over-contract`, warning colour).
  - `rota-by-person.a11y.test.ts`: add a `"partly uncovered"` card state.
- [ ] **Step 2: Changed test checks:** none expected (`rota-by-person.test.ts:51-61` counts rows and reads texts that stay).
- [ ] **Step 3: Run, watch fail, implement; Step 4: run** `rota-by-person.test.ts rota-model.test.ts rota-by-person.a11y.test.ts rota-view.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): Everyone's rota rows in staff-role order with coloured cards (A763)`.

### Task 8: Everyone — clicking an empty day offers that day's open slots, then "Another shift…"

**Files:**
- New `packages/staffing/src/dashboard/open-slots-menu.ts` (`rota-open-slots`), `open-slots-menu.test.ts`, `open-slots-menu.a11y.test.ts`.
- Modify `rota-by-person.ts` (the empty-part button replaces `[data-test=add-shift]`, `:86`), `rota-view.ts` (opens the menu in a `rota-popup`; `#fill(slot, personId)`), `rota-model.ts` (`openSlots`), `strings.ts`.
- Tests: `rota-by-person.test.ts`, `rota-view.test.ts`, `rota-model.test.ts`, `rota-view.a11y.test.ts`.

**Interfaces:**
```ts
export function openSlots(read: RotaWeek, personId: string, businessDay: string):
  { own: { slot: Slot; areaName: string }[]; other: { slot: Slot; areaName: string }[] };
// <rota-open-slots> .week .personId .businessDay .busy .error
// sends "choose-slot" { slot: Slot } and "another-shift" { personId, businessDay }
// rota-by-person sends "open-day" { personId: string; businessDay: string; anchor: HTMLElement }
```
Strings: `staffing.rota.open_heading` "{day} · {name}" in both languages, `{day}` from `dateLabel`; `staffing.rota.open_in_roles` "Open slots in {name}'s staff roles" / "Puestos libres en los roles de {name}"; `staffing.rota.open_other` "Other open slots this day" / "Otros puestos libres este día"; `staffing.rota.no_open` "No open slots this day" / "No hay puestos libres este día"; `staffing.rota.another_shift` "Another shift…" / "Otro turno…"; `staffing.rota.would_make` "would make {planned} / {contract} h" / "pasaría a {planned} / {contract} h"; `staffing.rota.add_label_person` "Fill a slot or add a shift for {name} on {day}" / "Cubrir un puesto o añadir un turno para {name} el {day}".

- [ ] **Step 1: Failing tests:**
  - `rota-model.test.ts`: `openSlots` puts the person's staff-role slots first, the rest in `other`, every area's slots, only `unfilled` ones, only that day.
  - `open-slots-menu.test.ts`: the heading "Fri 4 Dec · Marc"; the two section headings; a slot row "09:00–17:00 · Kitchen · Sous chef"; an `other` row marked "outside staff role"; "would make … h" when it would go over (Decision 12); "No open slots this day" with none; clicking a row sends `choose-slot` with the slot; "Another shift…" sends `another-shift`; busy disables the rows; a refusal shows as an alert.
  - `rota-by-person.test.ts`, `"clicking the empty part of a day opens that day's open slots beside it, and choosing one fills it for that person"`: `userEvent.click` Marc × Friday's `[data-test=day-add]` → `rota-popup` open beside it, holding `rota-open-slots`; clicking the `empty` slot POSTs `/management-api/staffing/rota/shifts` with `personId: "marc"` and the slot's fields (as `rota-view.test.ts:130-138`), and the menu closes.
  - `rota-by-person.test.ts`, `"Another shift… opens the shift editor for that person and day"`.
  - `open-slots-menu.a11y.test.ts`: states own-and-other, none, busy, refusal; both themes; inside an open `rota-popup`.
  - `rota-view.a11y.test.ts`: an `"open-slots"` state.
- [ ] **Step 2: Changed test checks:**

  | Test (file:line) | Before | After |
  |---|---|---|
  | `rota-by-person.test.ts:118-132` "opens prefilled new shifts…" | `[data-test=add-shift]` in Ana × 2026-12-04 opens the editor with that day and person | `[data-test=day-add]` in Ana × 2026-12-04 opens the open-slots menu; its "Another shift…" opens the editor; `businessDay` "2026-12-04", `personId` "ana", `shiftId` undefined (same assertions) |
  | `rota-by-person.test.ts:140-144` | a published week has no `button[data-shift]` and no `[data-test=add-shift]` | no `button[data-shift]` and no `[data-test=day-add]` |

- [ ] **Step 3: Run, watch fail, implement** Decisions 11–12 and 17 (Everyone half). The empty-part button is drawn in every editable Everyone cell, revealed as in Task 6.
- [ ] **Step 4: Run** the files above plus `rota-races.test.ts rota-planning.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): fill the rota from Everyone — a day's open slots, then Another shift (A763)`.

### Task 9: Empty weeks say why

**Files:** `rota-view.ts` (the message box), `rota-model.ts` (`paintTarget`, `hasSlots`), `strings.ts`. Tests: `rota-view.test.ts`, `rota-model.test.ts`, `rota-view.a11y.test.ts`.

**Interfaces:**
```ts
export function hasSlots(read: RotaWeek, show: Show): boolean;
export function paintTarget(read: RotaWeek, day?: string):
  { painter: "season"; id: string; name: string } | { painter: "special-day"; id: string; name: string } | null; // Decision 18
```
Strings: `staffing.rota.unpainted_title` "No staffing is painted for {area} this week" / "No hay personal pintado para {area} esta semana"; `staffing.rota.unpainted_season` "Slots come from the staffing you paint: who {area} needs, and when. Paint {season}'s standard week once and every week of the season gets its slots. You can still add shifts by person." / "Los puestos salen del personal que pintas: a quién necesita {area} y cuándo. Pinta una vez la semana habitual de {season} y cada semana de la temporada tendrá sus puestos. Puedes seguir añadiendo turnos por persona."; `staffing.rota.unpainted_plain` (the first sentence and the last) / its Spanish; `staffing.rota.paint_week` "Paint {season}'s standard week" / "Pintar la semana habitual de {season}"; `staffing.rota.no_shifts_hint` "No shifts this week yet. Click a day in someone's row to fill a slot or add a shift." / "Aún no hay turnos esta semana. Haz clic en un día de la fila de alguien para cubrir un puesto o añadir un turno."; `staffing.rota.no_shifts_hint_phone` "No shifts this week yet. Tap a person to fill a slot or add a shift." / "Aún no hay turnos esta semana. Toca a una persona para cubrir un puesto o añadir un turno.".

- [ ] **Step 1: Failing tests:**
  - `rota-model.test.ts`: `paintTarget` gives the season of the first day that is not a special day; a week of only special days gives the first special day; a given special `day` gives that special day; no season and no special day gives null.
  - `rota-view.test.ts`, `"an area with no paint this week says why and offers its season's painter and Show everyone"`: Kitchen with no slots on any day → the title and the season sentence with "Kitchen" and "Winter"; no staff-role rows; "Paint Winter's standard week" (`canWriteStaffing`) calls `open("staffing", { month: "2026-11", area: "station:kitchen", painter: "season", season: "winter" })`; "Show everyone" calls `open("rota", { week: "2026-11-30", area: "everyone" })`; the bar reads "Nothing to fill" and Publish is quiet when there are no shifts.
  - `"…shifts it already has show beneath, marked not needed"`: Kitchen with no slots and one shift (over) → the message and, under it, the Sous chef row with that card reading "not needed".
  - `"…a week of special days offers the special day's editor"`; `"…without the Staffing view it offers no paint button"`; `"…a person who may only read Staffing gets Show {season}'s standard week"`.
  - `"Everyone with no shifts keeps everyone's rows with one line saying how to add one"`: `shifts: []` → the line above the grid, five `[data-person]` rows, the bar "No shifts yet", Publish quiet.
  - `rota-view.a11y.test.ts`: states `"unpainted"` and `"everyone-empty"`.
- [ ] **Step 2: Changed test checks:** none expected (the `"empty"` a11y state for no active areas stays).
- [ ] **Step 3: Run, watch fail, implement** Decision 18 and point 6. **Step 4: Run** `rota-view.test.ts rota-model.test.ts rota-view.a11y.test.ts index.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): an empty rota week says why and offers the painter (A763)`.

### Task 10: Phone — one day at a time, with the strip and the foot action

**Files:**
- New `packages/staffing/src/dashboard/rota-day.ts` (`rota-day`: the phone's one day, area groups or person blocks), `rota-day.test.ts`, `rota-day.a11y.test.ts`.
- Modify `rota-view.ts` (narrow measurement, Decision 14; the strip; the shown day, Decision 15; the foot bar, Decision 19; count steps choose the day first), `strings.ts`.
- Tests: `rota-view.test.ts`, `rota-by-person.test.ts`, `rota-view.a11y.test.ts`.

**Interfaces:**
```ts
// rota-view.ts
export const PHONE_WIDTH = 560; // the Calendar Week's (opening-hours-week.ts:40)
@state() narrow = false;
@state() private day = "";       // the phone's shown business day
// <rota-day> .week .show .businessDay .breaches .editable
// sends the grids' events: pick-slot, edit-shift, open-day (from a person's button)
focusTarget(target: Target): boolean;
```
Strings: `staffing.rota.days` "Days" / "Días" (the strip's label); `staffing.rota.needs_attention` "needs attention" / "requiere atención".

- [ ] **Step 1: Failing tests:**
  - `rota-day.test.ts`: for Kitchen on Tuesday, the role groups Head chef then Sous chef (only roles with a slot or shift that day), the filled card, the partly uncovered card, no group for a role without either; a dashed slot sends `pick-slot` with its anchor; for Everyone on Friday, five person blocks in `peopleInOrder`, each a button with name, roles and hours that sends `open-day`, then that day's cards; a Closed day reads "Closed" once.
  - `rota-view.test.ts`, `"below 560 px it draws one day: the strip, Show, the bar's words, the day, and the action at the foot"`: at 390 px, `rota-day` is drawn and no `rota-by-area`; the strip has seven buttons, Friday marked (`data-attention`, name contains "needs attention"), Monday muted; Publish is the last child, full width, its bottom at the view's bottom when scrolled (sticky); nothing is wider than 390 px (`scrollWidth` ≤ `clientWidth` on the view).
  - `"a strip button shows its day; the week arrows step a week and keep the weekday"`: pick Thursday → `rota-day.businessDay` 2026-12-03; next week → `open("rota", { week: "2026-12-07", area })` and, once the host sets `week`, Thursday 2026-12-10 shown.
  - `"the shown day starts on today when it is in the week, else Monday"` (fake `Date` only around the read, real timers otherwise).
  - `"on a phone a count shows the target's day before focusing it"`.
  - `"growing past 560 px goes back to the week grid"` (resize the frame).
  - `rota-day.a11y.test.ts` and `rota-view.a11y.test.ts`: `"phone area"`, `"phone everyone"`, `"phone closed day"`, both themes.
- [ ] **Step 2: Changed test checks:**

  | Test (file:line) | Before | After |
  |---|---|---|
  | `rota-view.test.ts:205-215` (`390px` case) | `rota-by-area`'s scroller fits the page and may scroll | at 390, `rota-day` is drawn and nothing in the view is wider than 390 px (`scrollWidth` ≤ `clientWidth`); the 900 and 1280 cases unchanged |
  | `rota-by-person.test.ts:145-152` (`390px` case) | `rota-by-person` fits at 390 | at 390, Everyone's `rota-day` fits within 390 px; the 1280 case unchanged |

- [ ] **Step 3: Run, watch fail, implement.** Measure the width on connect, as the Week does, so a phone's first paint is already its day.
- [ ] **Step 4: Run** `rota-day.test.ts rota-day.a11y.test.ts rota-view.test.ts rota-by-person.test.ts rota-view.a11y.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): the rota on a phone — one day at a time with the week's strip (A763)`.

### Task 11: Phone — the picker and the open-slots menu as sheets

**Files:** `rota-popup.ts` (sheet mode), `rota-view.ts` (sets `sheet` when narrow), `slot-picker.ts` and `open-slots-menu.ts` (Cancel in a sheet). Tests: `rota-popup.test.ts`, `rota-popup.a11y.test.ts`, `rota-view.test.ts`.

- [ ] **Step 1: Failing tests:**
  - `rota-popup.test.ts`, `"as a sheet it sits at the bottom of the window at full width, scrolls within 70% of its height, and dims the page"`: at 390×844, its left 0, width 390, bottom 844 (±1 px), height ≤ 591 with a long list and `overflow-y` auto; `::backdrop` background is not transparent (`getComputedStyle(popup, "::backdrop")`).
  - `"a sheet's Cancel closes it and returns focus to what opened it"`.
  - `rota-view.test.ts`, `"on a phone a slot's picker and a person's open slots open as sheets"`: tap a dashed slot → sheet with the picker heading "Fri 4 Dec · Sous chef · 09:00–17:00" (today's heading, `slot-picker.ts:114-117`), "Show everyone" and Cancel; Everyone: tap a person → the open-slots sheet; choosing a slot fills it as on a wide screen.
  - `rota-popup.a11y.test.ts`: a `"sheet"` state, both themes.
- [ ] **Step 2: Changed test checks:** none expected.
- [ ] **Step 3: Run, watch fail, implement** Decision 11's sheet. **Step 4: Run** the files above plus `slot-picker.test.ts open-slots-menu.test.ts`; then the whole browser project once: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/staffing exec vitest run --project browser`, and `pnpm --filter @waitron/staffing test:coverage` to read the per-file rows of every changed file against `98/98/98/95`. Typecheck, lint, prettier. **Commit** `feat(staffing): the rota's picker and open slots as sheets on a phone (A763)`.

### Task 12: LOOK (the driver, not an implementer)

- [ ] Check `wa-wt ls` and `memory_pressure | grep free`. Run `wa-wt demo waitron-feat-a763-rota-redesign`; record its process group in the ledger so you stop only what you started.
- [ ] In the demo venue, prepare: a season with staffing paint for one area and none for another; a weekday with no hours; a special day in one week; a draft week with unfilled, partly uncovered and over slots; a published week; a changed published week with an open swap. Add staff roles, people and contracts if the demo lacks them.
- [ ] Screenshots with the workspace's Playwright Chromium; script in `~/waitron-campaign-b/a763-look-dir/`, images in `~/waitron-campaign-b/a763-shots/`. Light and dark, 1280×900 and 390×844, English; Spanish at 1280 light and 390 light. States: one area (board 1) with the picker open; Everyone (board 2) with the open-slots menu open and one empty part focused; an unpainted area and Everyone with no shifts (board 3); the five bar states (board 4); the phone day for an area and for Everyone, and the picker sheet (board 5).
- [ ] Compare each with its board and write down for each: the bar is one row at 1280 and nothing in it wraps; the title's width does not change between two weeks; the picker sits beside its slot and stays inside the window near the right edge; "+ Add shift" appears only on hover or focus; Closed reads once, in the header; at 390 nothing is wider than the window and Publish sits at the foot; Spanish fits.
- [ ] Stop the stack with `wa-wt down <name>`.

### Task 13: Docs (the driver)

**Files:** `docs/backlog.md`, `docs/backlog/workforce.md`, `docs/developers/design-system.md`, `docs/superpowers/specs/2026-10-13-a585-staffing-and-rota-design.md`.

- [ ] **Backlog.** Delete the A763 entry in `docs/backlog.md` (lines 4234-4239) and the `## A763.` section in `docs/backlog/workforce.md` (`:137-190`, up to `## A699.` at `:191`). Add in their place, in the same area, a short entry for point 9, with its detail section in `workforce.md`:
  - `docs/backlog.md`: "**A763 point 9. The Staffing month's Monday "Rota for this week" link goes, and the Rota tab opens the week last picked (owner, 2026-10-16).** Waits for lane F's A724 Part 2. Monday's box becomes the height of the others; the day box's Rota for this week states where that week's rota stands. [Detail](…), [mockup](backlog/mockups/a763-rota/06-staffing-month.png)."
  - `workforce.md`: the spec's point 9 quoted in full, the `rota-week` button's place (`staffing-month.ts:600`), and the board 6 link.
  - Add to A699's entry in `workforce.md` (`:191-202`) that `weekTitleParts` in `packages/staffing/src/dashboard/format.ts` is another copy of `formatWeekTitleParts`.
  - Update the "Decisions and deliberate limits → A585. Staff roles and rota planning" entry in `workforce.md` (`:231-237`): "Plan shifts in Calendar → Rota, by area or by person" becomes "for one area or for everyone (A763, 2026-10-17)".
  - Check: `/usr/bin/grep -rn "A763\|a763" docs/backlog.md docs/backlog/` prints only the point 9 entry, its detail and the mock-up folder links.
- [ ] **A585 spec.** Its 2026-10-16 pointer (`:3-5`) links to the backlog section this task deletes. Replace that link with one to this plan, and add above it a dated pointer: "> 2026-10-17: A763 points 1–8 are built (see the [plan](../plans/2026-10-17-a763-rota-redesign.md)); point 9 waits for A724 Part 2." Do not rewrite the spec's body.
- [ ] **design-system.md.** Rewrite the Rota view paragraphs (`:4062-4081`): the address (`/view/rota/week/<monday>[/area/<area>|/area/everyone]`); Show; the bar and its states (Decisions 5–7, 19–20); the title's month links and fixed width; the area grid (rows only when used, Fill, "+ Add shift" on hover or focus); Everyone (row order, cards, the empty part's open-slots menu, Another shift…); the picker beside its slot; Closed and the headers; the empty-week messages; the phone's one day, strip, sheets and foot action. Remove the people panel and By person sentences. Keep "Every day's box ends with Rota for this week" (`:4054`), which point 9 has not changed. Run `pnpm exec prettier --file-info docs/developers/design-system.md` (expect `"ignored": true`).
- [ ] Commit `docs: A763 points 1–8 done — the Rota view redesigned; point 9 left open`.

### After the tasks

The driver runs `/finish-branch` with the worktree path, on the FULL path (Task 1). The PR body carries: the server change (Task 1) in its first lines; the merged "Changed test checks" table, with Task 4's weekly-warning row called out; Decisions 1, 2, 10, 11 and 18 with their reasons; the LOOK findings.

---

## Review focus

1. **Task 1's `hasHours`** must match what the Calendar shows as a day with no hours, including a special day closed all day and a special day that adds hours on a weekday the season has none. Check `resolveDepartmentsDays` is given the day plan `readRotaWeek` already read (no second read of special days), and only active departments.
2. **The popup's light dismiss during a fill.** A click outside while a fill is in flight closes the popup; the write still lands; a refusal then shows under the bar, not lost (Decision 11). Check focus returns to the slot, not the page body.
3. **Step buttons across a Show switch** (Decision 7): the pending focus must survive `willUpdate`'s reset on an `area` change and must not focus a slot in a week the person has since left.
4. **Publish's state** (Decision 19): quiet and disabled with no shifts or no version, quiet while warnings load, loud otherwise; "Publish changes" only on a changed published week; the existing guards in `#publish` (`rota-view.ts:269-276`) unchanged.
5. **The weekly warning in an area** (Task 4's changed check): the only place a check narrows. Confirm the bar's labour count and the publish dialog still include it.
6. **Phone width** measured on the rota's own width, not the window's, so a narrow Calendar column on a wide window also gets the day view; and the first paint at 390 is already the day view.
7. **Strings:** every new key in both languages; no retired key still read (`grep -rn "staffing.rota.<key>" packages/staffing/src`).
