# A763 — The Rota view redesigned: one Show menu, no button per cell, an empty week that says why

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Calendar → Rota gets one Show menu (Everyone or one area) in place of the Area picker and the By area | By person switch, one bar of controls, no "Add shift" button in every cell, a picker that opens beside the slot that was clicked, an empty week that says why, and one day at a time on a phone.

**Architecture:** Almost all of the work is in the browser, in `packages/staffing/src/dashboard/`. One small server change comes first (Task 1, below). The rota screen keeps its one live read and its warnings read. New pure helpers in `rota-model.ts` work out what the bar, the headers, the strip and the menus show. A package-local `rota-popup` element (Task 5) holds the slot picker and the new open-slots menu, beside their anchor on a wide screen and as a sheet from the bottom on a phone. No shared `wt-*` primitive changes. `staffing-month.ts` does not change.

**Tech stack:** Lit 3, `@waitron/ui` (`wt-button`, `wt-combobox`, `visuallyHiddenStyles`), `@waitron/venue-service/dashboard/fixed-title`, `@waitron/venue-service/painter` (`placePopover`, `periodColourStyles`), Vitest 4 in browser mode (real headless Chromium) for `src/dashboard/**`, node for the rest (`packages/staffing/vitest.config.ts`: the `browser` project includes `src/dashboard/**/*.test.ts`, the `node` project excludes it).

**Worktree:** `/Users/clintongormley/workspace/worktrees/waitron-feat-a763-rota-redesign`, branch `feat/a763-rota-redesign`, based on main `45ce9e66d`.

---

## THE SERVER CHANGES — read this first

**One server read changes shape; nothing stored changes; no migration.** Two of the spec's points need facts the rota read does not carry today:

- Point 5: "A day with no paint and no hours reads 'Closed'". The rota read knows only that a *special day* is closed all day (`closedAllDay: plan.special.get(businessDay)?.closedAllDay ?? false`, `packages/staffing/src/rota.ts:86`). A weekday on which the season has no opening hours (a venue closed on Mondays, as on boards 1–3 and 5) is not marked at all, and the browser has no read of opening hours to work it out from.
- Point 6: "Paint {season}'s standard week (the painter for that area, or the special day's editor on a special day)". The rota read carries no season or special day (`RotaWeek`, `packages/staffing/src/staffing-types.ts:111-135`).

Task 1 adds to `readRotaWeek`, for each day, `hasHours`, `seasonId` and `specialDay`, and for the week, `seasons` (id and name). They come from what `readRotaWeek` already reads (`readDayPlan` at `rota.ts:41`), the venue's seasons read once and handed to `readDayPlan` (which already takes them as its optional fourth argument, `packages/venue-service/src/day-resolver.ts:35-47`), plus one call to venue-service's exported `resolveDepartmentsDays` (`packages/venue-service/src/index.ts:91-95`) given that same day plan. The route (`GET /management-api/staffing/rota`) and its permission are unchanged. Its live dependencies already include every table that call reads (`QUERY_DEPENDENCIES.rota`, `packages/staffing/src/dashboard/live-queries.ts:26-42`, spreads `CALENDAR_MONTH_PLAN_READS`, which lists `department_days` and `department_day_ranges`; `departments` is listed itself; `readDepartmentSeasonWeeks` reads `departmentDays` at `packages/venue-service/src/season-weeks.ts:214`); Task 1 Step 4 checks the claim.

Task 7 then removes `closedAllDay` from the rota read, once its only two readers (the cells' "Closed", `rota-by-area.ts:163`, `rota-by-person.ts:84`) are gone; `hasHours` covers a special day closed all day.

**No shared `wt-*` primitive changes or is added.** The picker's popover and phone sheet are a package-local element (`rota-popup`, Task 5) placed with venue-service's existing exported `placePopover`. It still gets a token-painting check and an axe test in both themes.

## Review path: FULL

The brief for this item sets the rule that a server change takes the full path, and Task 1 changes what a server read returns (Task 7 removes one field from it). None of the CLAUDE.md risk triggers is touched otherwise: no fiscal code, no tenant or by-id read, no migration, no grant or permission change, no concurrency change. So: a per-task reviewer on Tasks 1 and 7 at least (and on the others as the driver judges), the full `/finish-branch` wave, the Codex run-it seat. The simplify seat is wanted here, because the branch restructures the rota's files.

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

The boards' own notes (read from the images, 2026-10-17) add detail the plan builds to: board 1 — the slot reads "19:00–00:00 · Fill"; the picker is headed "Fri 30 · Sous chef · 19:00–00:00", under it "Kitchen · holders of the staff role first", each person "Sous chef · free · 30 / 40 h", "would go over 40 h contract" in red, a person already working drawn muted ("working 18:00–00:00"), then "Show everyone"; the bar's labour count is "⚠ 1 labour warning". Board 2 — under each name its staff roles and "39 / 40 h", orange when over; each card its staff role's colour, its time, "Kitchen · Head chef"; the open-slots menu is headed "Fri 30 · Ibra", then "OPEN SLOTS IN IBRA'S STAFF ROLES", "OTHER OPEN SLOTS THIS DAY" (each marked "outside staff role"), then "Another shift…"; the focused empty part reads "+ Add shift". Board 3 — "No staffing is painted for Kitchen this week", "Slots come from the staffing you paint: who Kitchen needs, and when. Paint Winter's standard week once and every week of the season gets its slots. You can still add shifts by person.", [Paint Winter's standard week] drawn primary, [Show everyone] drawn secondary; the bar reads "Draft · Nothing to fill · [Publish week]" quiet; Everyone reads "Draft · No shifts yet · [Publish week]" quiet and the line "No shifts this week yet. Click a day in someone's row to fill a slot or add a shift."; under each name "Head chef · 0 / 40 h". Board 4 — Draft with counts (orange, dotted underline) and "⚠ 1 labour warning" (red); "Draft · All slots filled" (green); "Draft · 2 unfilled · No labour rules to check against"; "Published" (a green pill) "· All slots filled · [Change this week]"; "Draft · Staff still see the published week · 1 unfilled · [Publish changes]", with "2 open swap requests moved to the new draft. Check them before you publish." in a box under the bar. Board 5 — title (plain text, no link underline), then the strip (Fri marked), then Show, then state and counts, "1 labour warning" on its own line, the day's role groups, Publish week full width at the foot; the picker sheet ends with "Show everyone" and [Cancel].

**Scope:** points 1–8. **Point 9 is out of scope**: it waits for lane F's A724 Part 2, which has not landed. Task 17 leaves it as its own backlog entry. `staffing-month.ts` is not changed: no point 1–8 needs it.

---

## Decisions this plan makes that the spec does not

Each has the default to build. The owner is away; none of these is a question for them.

1. **The Show menu is the address word `area`.** An area key (`department:<id>` or `station:<id>`, as today) shows that area; `everyone` shows Everyone. With no `area`, or an unknown one, the Rota shows its first area, as today (`rota-view.ts:293`). **With no active area at all, the Rota shows Everyone whatever `area` says** (driver's ruling): the Show menu offers only Everyone, the grid lists people, and the line above it reads "No active areas." (the existing `staffing.rota.empty`); no day offers to add, because a shift needs an active area (`staffing.shift.invalid_area`). Why: the Staffing month's links already send `area` or nothing (`staffing-month.ts:556`, `:600`), and keeping the default means a plain Rota tab opens as it does today. An area key always holds a colon, so `everyone` cannot collide. The `mode` word is retired, with no compatibility for old `mode/person` addresses (pre-live rule).
2. **Search destinations:** the Rota's two (`by-area` with `{ mode: "area" }`, `by-person` with `{ mode: "person" }`, `packages/staffing/src/dashboard/index.ts:66-69`) become one: `{ id: "everyone", labelKey: "staffing.rota.everyone_search", params: { area: "everyone" } }`, label "Everyone's rota" / "Turnos de todo el equipo". "By area" was the default view and the Rota tab's own destination (`calendar:rota`) already reaches it.
3. **Show's options:** "Everyone" first, then every area in the read's order. The combobox reuses `name="area"` and the label key `staffing.month.area` ("Show" / "Mostrar"), with `search="never"`, as the Staffing month's Show does (`staffing-month.ts:425-440`).
4. **The week title is the range "26 Jan – 1 Feb 2026"** (`Intl.DateTimeFormat#formatRangeToParts` with day, short month and year, staffing's own `dateFormat`). The formatted range puts U+2009 thin spaces around the dash (measured 2026-10-17 in Node v26.11.1: `formatRange` of 30 Nov and 6 Dec 2026 gave `30 Nov – 6 Dec 2026`), so every test reads the title with whitespace normalised (`replace(/\s+/g, " ")`, as `text` does at `packages/venue-service/src/dashboard/opening-hours-week.test.ts:43-44`). As in the Calendar Week (`opening-hours-week.ts:577-600`), **on a wide screen each month name in it is a link** to Staffing → Month for that month: `open("staffing", { month, ...(area ? { area } : {}) })`, carrying the shown area and leaving it out for Everyone. The year is plain text, since Staffing has no Year. **On a phone the title is plain text, with no link and no underline, as board 5 draws it** — unlike the Calendar Week's phone title, which keeps its underlined `.title-link` buttons (`opening-hours-week.ts:179-187`, `:669-700`); this follows the board. The title keeps one width with `fixedTitle` (`@waitron/venue-service/dashboard/fixed-title`), sized against every week whose Monday falls in 2026 in both languages, the Week's rule. The month names are links only when the person may open the Staffing view (`ctx.calendarViews`, as `canOpenRota` is worked out at `index.ts:37`); otherwise they are plain text. The parts function is a local `weekTitleParts` in `format.ts`, because venue-service's `formatWeekTitleParts` is in `hours-view.ts:128-141`, outside its `exports` map; Task 17 adds this copy to backlog A699's list.
5. **The bar, left to right:** ‹, title, ›, Show; then, pushed to the end: the state; "Staff still see the published week" when the week is being changed; the attention counts or their summary; the labour count, **or in its place** the quiet "No labour rules to check against", joined to the counts by " · " as board 4's third row draws it; and the one action. (Board 4: row 3 "Draft · 2 unfilled · No labour rules to check against"; row 5 "Draft · Staff still see the published week · 1 unfilled · [Publish changes]".) The state is a small pill (local CSS, tokens only): "Draft" in `--wt-color-text-muted` on `--wt-color-surface-sunken`; "Published" in `--wt-color-success` with a `--wt-color-success` border on `--wt-color-surface` (board 4 draws it green). With no version yet the state reads "Draft". The counts are drawn in `--wt-color-warning` with a dotted underline; "All slots filled" in `--wt-color-success`; the labour count in `--wt-color-danger`, led by a "⚠" text glyph marked `aria-hidden="true"` (board 1 and 4). There is no warning icon to reuse: `apps/dashboard/src/icons.ts` has none, and `wt-icon` draws only what an app registers; the glyph as text has a precedent at `apps/dashboard/src/screens/department-receipt-dialog.ts:767`. Every one of these passes axe in both themes (Task 3's a11y states).
6. **The summary when no count is left** (counts are scoped as the grid: the shown area, or every area for Everyone):
   - any of unfilled, partly uncovered or over above zero: those counts, as buttons, joined by " · " text;
   - else, if the scope has at least one slot that week: "All slots filled";
   - else, for Everyone with no shifts in the week: "No shifts yet";
   - else: "Nothing to fill".
7. **What a count button steps to.** Each press focuses the next target after the one that button last focused, wrapping, in reading order: by day, then by the grid's row order, then by start time. The target scrolls into view (`scrollIntoView({ block: "nearest", inline: "nearest" })`). In an area: unfilled steps to an unfilled slot, partly uncovered to its shift's card, over to an over shift's card. **In Everyone** (driver's ruling) an unfilled slot has no card, so the unfilled count steps to the next **day header** that carries "N unfilled" (Decision 8); it does not switch Show. Partly uncovered and over step to cards in Everyone too. On a phone a step first shows the target's day (in Everyone, the unfilled count selects the next day with unfilled slots and focuses its strip button). A target that is not a button (a published week's card, a day header) is given `tabindex="-1"` so focus can land. The labour count stays text, as drawn on boards 1 and 4 (no dotted underline there), because a warning is not a slot.
8. **A day's header** names its attention below the date, with the bar's words and only non-zero counts ("2 unfilled", "1 unfilled · 1 over"), not as buttons. **"Closed"** shows in the header when the day has no opening hours in any active department (`hasHours === false`, Task 1, which also covers a special day closed all day) **and** no slot in the shown scope that day. **"Closed" is venue-wide on purpose** (driver's ruling): `hasHours` asks whether *any* active department opens that day, so with a Restaurant closed on Mondays and a Bar open on them, Monday is not Closed in the Restaurant's rota either; an area's own hours are not used, because a station has no hours of its own and staff may work on a day their department does not trade. Cells no longer write "Closed" (`rota-by-area.ts:163`, `rota-by-person.ts:84`).
9. **Rows.** In an area: a staff role row appears when the area has a slot or a shift with that staff role that week; "Not in a slot" appears only when some day has such a shift. In Everyone: one row per active person, ordered by the lowest `position` among their staff roles, then name, then person id; a person with no staff role comes after those with one.
10. **Person-level labour warnings without a shift** (a weekly breach, a daily breach) lived in the people panel too (`rota-view.ts:401`). After it goes: in Everyone they stay under the name and in the day cell, as today (`rota-by-person.ts:74`, `:85`); in an area a daily warning is drawn on that person's cards on that date in the area; **a weekly warning has no place in the area grid** — the bar's labour count and the publish dialog still include it. This is the one narrowing; Task 17 records it as a deliberate limit.
11. **The picker and the open-slots menu** sit in a package-local `rota-popup` element, an auto popover:
    - Wide: beside the anchor, on its inline-end side and top-aligned, when it fits in the window; else on its start side; else below it through `placePopover(popup, anchor, false, true)`. Kept inside the window with an 8 px margin (`POPOVER_MARGIN`'s value, `packages/venue-service/src/dashboard/paint-grid-parts.ts:103`; venue-service does not export the constant, so the helper takes the same number and says where it came from).
    - **It follows its anchor** as `calendar-day-box` does (`packages/venue-service/src/dashboard/calendar-day-box.ts:109-204`): while open, on each window resize and each scroll of the page or of a box the anchor is drawn inside (the area grid's `.scroll` scrolls sideways), it places itself again, or closes when no part of the anchor is left inside the window and every clipping ancestor. **Why a copy rather than `calendar-day-box` itself:** that element places below its anchor, or above it when only there it fits (`calendar-day-box.ts:123`, `paint-grid-parts.ts:104-128`), never beside it, has a fixed body (heading, name, line, rows, message) with its buttons in an `.actions` row, a compact maximum width and no sheet; making it place beside and draw a sheet would change an element the Calendar's Month and Week and the Staffing month share, wider than this item. Its helpers `flatParent` and `scrollTargets` live in `flat-tree.ts`, which venue-service's `exports` map does not list (`packages/venue-service/package.json:7-21`), so `rota-popup.ts` copies them too, each copy's comment naming its source; Task 17 adds the copy to A699's list.
    - Phone (the rota's own width below 560 px, Decision 14): a sheet fixed to the bottom of the window, full width, its height capped at 70% of the window with its own scroll, the page behind dimmed through `::backdrop`, ending with Cancel (`staffing.role.cancel`). A sheet does not follow its anchor.
    - It closes on Escape, a click outside (light dismiss) or Cancel, and sends `rota-popup-close`; focus returns to the anchor when it was inside the popup, as `calendar-day-box.ts:190-204` does. It moves focus to its heading on open.
    - **Closing clears only the pick it was opened for.** A click on a second slot while the first picker is open light-dismisses the popup, and its `toggle` event (queued, so it can arrive after the second slot's click has set the new pick) must not wipe the new pick. The view remembers which pick (slot key, or person and day for the open-slots menu) the popup was shown for, and its `rota-popup-close` handler clears `picked` only while it is still that pick.
    - **Where the picker sits in the tree:** the view renders `<rota-popup>` in its own shadow root with the `slot-picker` (or `rota-open-slots`) as its direct light-DOM child, slotted into the popup's default slot, and renders the child only while there is a pick. So `el.shadowRoot.querySelector("slot-picker")` still finds it while open and finds nothing once closed, and these checks run unchanged: `rota-view.test.ts:124`, `:129`, `:230`, `:233`, `:240`, `:249`, `:267`; `rota-planning.test.ts:164`, `:246`, `:249`; `rota-view.a11y.test.ts:47`. Task 6 runs every one of them; a check among them that fails is reported, not edited.
    - The slot picker loses its "Close picker" button (`slot-picker.ts:156-161`) on a wide screen: board 1 draws none, and light dismiss closes it.
    - A fill refused after the popup was dismissed shows its sentence as an alert under the bar; while the popup is open it stays in the popup, as today.
12. **The picker's hours.** Each person keeps "{status} · {planned} / {contract} h". New: when the slot's length would take their planned hours over a contract, a line "would go over {contract} h contract" in `--wt-color-danger` (board 1). The open-slots menu shows "would make {planned} / {contract} h" in the same colour under such a slot (board 2). Hours keep today's decimal form ("32.5", `rota-format.ts:11-18`), not board 2's "32½". A person already working at that time keeps their button, drawn muted.
13. **Card words in Everyone:** a partly uncovered shift reads "uncovered 14:00–17:00", the area's words (`rota-by-area.ts:145`), not board 2's "slot runs to 17:00", which covers only a gap at the end.
14. **Phone width is the rota's own width below 560 px**, the Calendar Week's breakpoint (`PHONE_WIDTH`, `opening-hours-week.ts:40`), measured the same way (on connect and by a `ResizeObserver`, `opening-hours-week.ts:506-516`, `:545-555`). The rota keeps its own `PHONE_WIDTH = 560` because that file is outside venue-service's `exports`; the constant's comment points at the Week's. **Vitest's browser viewport defaults to 414 px wide** (vitest 4.1.11 sets `resolved.browser.viewport.width ??= 414`, `node_modules/.pnpm/vitest@4.1.11*/node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js:501`), and neither the staffing nor the dashboard Vitest config sets a viewport, so a test that mounts the rota in an unsized frame draws the phone layout once Task 13 lands; Task 13 sizes those frames.
15. **The phone's shown day** is component state, not part of the address: **the venue's today** — the date in the read's `timeZone` (`RotaWeek.timeZone`), not the browser's clock — when it falls in the week, else Monday; ‹ › keep the same weekday. A strip button selects a day. **A swipe across the day steps a day** (driver's ruling), as the Calendar Week's does (`opening-hours-week.ts:745-786`): touch and pen only, not a mouse; at least `SWIPE_PX` = 48 px across and more than twice as far across as down; a second finger cancels it; listeners on the window so a lift the day does not hear still ends it; `touch-action: pan-y` on the swiped box, as the Week's `.card` (`opening-hours-week.ts:356-357`). The constant and the logic are copied, because `opening-hours-week.ts` is outside venue-service's `exports` and `SWIPE_PX` is not exported (`:42`); Task 17 adds the copy to A699's list. A swipe past Sunday opens the next week showing its Monday, and past Monday the previous week showing its Sunday, as the Week steps a day across a week's edge. Strip buttons carry `aria-pressed`; a day that needs attention (any non-zero count in scope) shows a dot and adds "needs attention" to its accessible name; a Closed day (Decision 8) is drawn muted.
16. **On a phone, in an area** the day's staff role groups list its slots and cards, with dashed slots to fill; there is no per-role "+ Add shift" (board 5 has none). A shift beyond the paint is added on a phone from Show: Everyone. A role group appears when it has a slot or a shift that day. **In Everyone**, each person is a block: a button with their name, staff roles and hours, which opens the open-slots menu, then that day's cards.
17. **"+ Add shift" in an area cell** is a button filling the empty part of the cell below its cards, its text shown only on `:hover` or `:focus-visible`, its accessible name always set ("Add a {role} shift on {day}"). It opens the shift editor with the day, the area and the row's staff role already chosen and no person. `rota-shift-dialog` gains `area` and `staffRoleId` properties for that, and both join its draft's subject key (`shift-edit-dialog.ts:87`, today `${week}:${shiftId ?? `${businessDay}:${personId}`}`), so a second cell's editor seeds afresh; its baseline is the seeded draft, so Save stays quiet until a person is chosen. In Everyone the empty part is the same kind of button, named "Fill a slot or add a shift for {name} on {day}", and opens the open-slots menu (board 2 shows its "+ Add shift" text on focus).
18. **The empty-area message's paint button:** the first day of the week that is not a special day and has a season gives "Paint {season}'s standard week" (`painter: "season"`); if every day of the week is a special day, the first one's editor ("Edit {name} staffing", `painter: "special-day"`). On a phone, a shown day that is a special day offers its editor. With no season and no special day, the message has no paint button. The button opens `open("staffing", { month: <Monday's month>, area: <shown area>, painter, season | "special-day" })`, the parameters `staffing-month.ts:308-316` uses. It is offered only when the person may open the Staffing view; its label is "Show {season}'s standard week" / "Show {name} staffing" (existing keys) when they may not write it. The paint button is `primary` and "Show everyone" `secondary` (board 3); "Show everyone" calls `open("rota", { week, area: "everyone" })`.
19. **"Publish"** is in the bar of every week that is not published, for a person who may write: `secondary` and disabled while the week has no shifts (`read.shifts.length === 0`, which includes no version at all) or while the warnings have not loaded (today's rule, `rota-view.ts:341-342`); `primary` otherwise. It reads "Publish changes" when `version.changedSincePublished`. A published week shows "Change this week" (`secondary`, as board 4 draws it). On a phone the action sits in a bar stuck to the foot of the rota.
20. **The swap notice** stays where it is set today (`swapNotice`, `rota-view.ts:116`, `:257`) and is drawn as a box under the bar: `--wt-color-surface-raised` with a `--wt-color-border` border (the colour tokens have no info tone, `packages/ui-core/src/tokens/colors.css`).
21. **What is announced.** Today `[data-test=attention]` is a `role="status"` span holding the counts as text (`rota-view.ts:321`); once it holds buttons, a live region there would read controls aloud. So `[data-test=attention]` loses the role, and a visually hidden `<span role="status" data-test="attention-status">` (`visuallyHiddenStyles`, `@waitron/ui`) carries the same words as plain text ("1 unfilled · 1 partly uncovered · 1 over", or the summary). The no-rules note, the labour count and the swap notice stay `role="status"` text as today (`rota-view.ts:327-333`); the loading line too (`:426`).
22. **Strings.** New and changed keys, English then Spanish, live in `strings.ts`; each task lists its own. A count that reads differently at 1 in either language gets a `_one` key, as `staffing.rota.labour_one` / `labour_count` do (`strings.ts:44-45`, `:235-236`), chosen by a helper beside `peopleNeeded` (`strings.ts:444-448`): `partly_one` and `over_one` (Task 3). `unfilled_count` needs none ("{count} unfilled" / "{count} sin cubrir" read the same at 1). Retired keys are deleted once nothing reads them: `staffing.rota.by_area`, `by_person`, `view`, `people`, `attention`, `close`, `unfilled`, `area`, `changed`, after a grep shows no reader.
23. **File and element names stay** (`rota-by-area`, `rota-by-person`): `rota-by-person` draws Show: Everyone. Renaming would add churn to every test file for no behaviour.

## Assumptions (not tested)

- The `::backdrop` of an auto popover dims the page in Chromium; other browsers are not tested in this repo.
- Chromium's `formatRangeToParts` puts the same thin spaces around the dash as Node's (Decision 4 measured Node only); the tests normalise whitespace, so they pass either way.
- Santet's Mondays are a season with no hours (boards 1–3 draw them "Closed"); the plan does not depend on it, but the LOOK task checks it on the demo venue.

---

## Global constraints

- **TDD.** Every task writes its failing tests first and watches them fail for the expected reason, then implements. The dashboard tests run in real headless Chromium (the `browser` project, `packages/staffing/vitest.config.ts:28-43`); Task 1's server tests run in the `node` project.
- **Commands** (the package is `@waitron/staffing`):
  - focused: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/staffing exec vitest run <files>`
  - after each task: `pnpm --filter @waitron/staffing typecheck`, `pnpm exec eslint packages/staffing/src`, `pnpm exec prettier --check <changed files>` (also `pnpm format:check` once before committing).
  - Before a browser run, `memory_pressure | grep free` must show well above 15%. Read the `Tests` count, never the exit status of a pipe.
  - Baseline, 2026-10-17, 66% memory free: `pnpm --filter @waitron/staffing exec vitest run src/dashboard/rota-view.test.ts src/dashboard/rota-by-person.test.ts src/dashboard/rota-planning.test.ts src/dashboard/rota-races.test.ts src/dashboard/slot-picker.test.ts src/dashboard/rota-view.a11y.test.ts src/dashboard/slot-picker.a11y.test.ts src/dashboard/rota-by-person.a11y.test.ts src/dashboard/index.test.ts` gave `Test Files 9 passed (9)`, `Tests 80 passed (80)` in 12 s.
- **Viewport in layout and placement checks.** A check that measures where a box sits or whether a row wraps sets the window with a `useViewport(width, height)` helper copied from `packages/staffing/src/dashboard/staffing-month.test.ts:93-98` (it calls `page.viewport`, waits for `innerWidth`, and restores the old size in `onTestFinished`): 1280×900 for wide checks, 390×844 for phone checks. It measures only after the content that sizes the box has rendered (wait for it first), and leaves room for CI's larger fonts on the side it expects the box (`docs/developers/testing-guide.md` → "A placement check measures a box at its final size, with room for CI's fonts"). Applies to Tasks 3, 4, 5, 6, 10, 12, 13, 14 and 15 (the helper is a local function, so each new test file carries its own copy).
- **Tokens:** every colour, space, radius and font reads a `--wt-*` token; no hex, no named colour, no `rem`/`em`, no raw px except the documented 8 px popover margin, the 560 px breakpoint and the 48 px swipe distance (all constants in TypeScript, not CSS).
- **Strings:** every visible or announced string is a key in `strings.ts`, in English and Spanish, as short as the meaning allows; counts follow Decision 22.
- **Fields:** the Show menu is `wt-combobox`; no native `<select>`, `<input>` or `<textarea>` (`scripts/native-form-fields.test.ts`).
- **Buttons:** a button that is not a save is drawn `secondary` while it waits for a load or its state rules it out, and its own variant once it can act (design-system.md → Forms, A416/A427). Plain `<button>`s in grids and menus keep today's card styling.
- **Reads:** no new browser read. The two existing reads stay passive (`client.ts:124-174`). The fill, change-week and publish writes stay non-passive.
- **Events:** the rota's own elements keep plain event names (they are app-owned, not `wt-*`), dispatched `bubbles: true, composed: true` as today.
- **Accessibility:** each changed or new element gets axe states in both themes in its `*.a11y.test.ts`; a popup state is run with the popup open (`:popover-open`), never hidden, or axe passes on nothing.
- **Coverage:** the package holds `98/98/98/95`. Every new branch has a test. Read CI's per-file rows for the changed files.
- **Changed test checks:** an existing assertion may change only where the spec deliberately changes what it checks; its new form must be at least as strict; never delete or loosen one. Every task reports each changed check in a table (file:line, before, after); the PR carries the merged table. The planned changes are listed in each task. The one that narrows what is checked (Task 6, the weekly warning in an area) is called out for review.
- **Commits:** `git commit -s`, explicit paths, never `--no-verify`, never `git stash`.
- **Size:** each task is written to finish well under 100 tool calls. An implementer passing about 150 stops at a passing or cleanly failing point, commits, and returns a handover (done, left, files, each check's state).
- **CI time:** after the first push, the driver reads the `test-staffing` shard times on the PR's run against the ~4-minute target (CLAUDE.md §2); a shard over it is fixed at the cause (a slow file, too few shards, slow setup), never by cutting a check.

---

## Current code map (read 2026-10-17 at `45ce9e66d`)

- `packages/staffing/src/rota.ts` — `readRotaWeek` (`:36-162`) builds `RotaWeek`: the day plan (`:41`, `readDayPlan(tx, scope, days)`, which reads the seasons itself when not given them, `day-resolver.ts:42`), areas (`:42`), resolved paint (`:43`), roles, rota rows; `closedAllDay` is a special day's closure only (`:86`); `people[].plannedMinutes` sums the week's shifts (`:154-156`). `addRotaShift` creates the week's draft version on its first shift (`:228-232`).
- `packages/staffing/src/staffing-types.ts:111-135` — `RotaWeek`. No season, special day or hours.
- `packages/staffing/src/dashboard/index.ts:64-87` — the Rota calendar view; search destinations `by-area`/`by-person` with `mode` (`:66-69`); `validWeek`/`monday` (`:101-115`). The Staffing view works out `canOpenRota` from `ctx.calendarViews` (`:37`).
- `packages/staffing/src/dashboard/rota-view.ts` (`staffing-rota`) —
  - state: `picked`, `editor`, `busy`, `warnings`, `swapNotice`, `publishing` and errors (`:108-119`); area/mode change clears the picker (`:153-158`); week change resets everything and re-watches (`:159-176`).
  - `#watch` (`:177-206`) applies the rota and starts the warnings read; closes the picker when its slot is gone or the week is published (`:194-203`).
  - `#go` keeps `area` and `mode` (`:207-213`). `#fill` (`:214-248`), `#changeWeek` (`:249-265`), `#publish` (`:266-290`).
  - render: row 1 ‹ title › area combobox, attention text `[data-test=attention]` (a `role="status"` span) and state (`:303-322`); row 2 the By area/By person switch (`:323`); labour notice or count on their own line (`:324-332`); swap notice (`:333`); Change this week (`:335`); Publish only when `version.status === "draft"` (`:337-350`); the grid and the `aside` people panel holding the picker (`:352-427`); the shift dialog (`:428-446`); the publish dialog (`:447-457`).
  - The title is `${dateLabel(week)} – ${dateLabel(sunday)}` (`:312`), not a link, not fixed width.
- `rota-by-area.ts` (`rota-by-area`) — the grid scrolls in `.scroll` `[data-test=grid-scroll]` (`overflow: auto`, `:23-28`) over a table at least `calc(var(--wt-tap-min) * 20)` wide (`:31`; `--wt-tap-min` is 44px, `packages/ui-core/src/tokens/structure.css:29`); a row per staff role, always (`:192-202`); "Not in a slot", always (`:203-219`); a cell writes "Closed" on `closedAllDay` (`:163`); a slot's card is `[data-slot=<slot key>]` with `data-kind` its status, filled or not (`:150-159`), and an unfilled one reads "+ unfilled" (`:149`) and sends `pick-slot` (`:113-117`); over and not-in-slot cards are `[data-shift=<shift id>]` (`:126-139`) and send `edit-shift` (`:118-122`); a card's notes show only breaches carrying its `shiftId` (`:123-125`).
- `rota-by-person.ts` (`rota-by-person`) — reuses the area's styles (`:13`); a row per person in read order (`:67`); under the name, roles, hours and week warnings (`:70-75`); every editable cell has an "Add shift" button `[data-test=add-shift]` sending `add-shift` (`:86`).
- `slot-picker.ts` (`slot-picker`) — holders, then everyone after Show everyone (`:103-111`); status free / on leave / working (`:74-100`); hours (`:137`); candidate warnings (`:139`); a "Close picker" button (`:156-161`). Sends `choose` and `close-picker`.
- `shift-edit-dialog.ts` (`rota-shift-dialog`) — seeds a new shift with `personId` alone (`:106`); subject key `${week}:${shiftId ?? businessDay:personId}` (`:87`).
- `rota-format.ts` — `shiftTime`, `minuteTime`, `hours` (decimal).
- `format.ts` — `dateFormat`, `utc`, `dateLabel`.
- `strings.ts` — rota keys at `:13-95` (English) and `:204-289` (Spanish); "Labour rules are not set up" at `:46`/`:237`; `peopleNeeded` (`:444-448`) is the `_one` pattern.
- `packages/staffing/src/testing/rota-fixture.ts` — `rotaWeek()` (Kitchen station; day 0 closed with no slots; on day 1 a filled slot `filled` (Ana, Head chef) and a partly uncovered slot `part` (Joan); an outside-role fill `outside` on day 2; an over shift `over` on day 3; an unfilled slot `empty` on day 4; an unlinked previous-week shift) and `rotaApi()`.
- `packages/venue-service/src/dashboard/opening-hours-week.ts` — the Week: `PHONE_WIDTH = 560` (`:40`), `SWIPE_PX = 48` (`:42`, not exported), month links in the title (`:577-600`), `fixedTitle` (`:616`), narrow measurement (`:506-516`, `:545-555`), the swipe (`:745-786`), `.card { touch-action: pan-y }` (`:356-357`). Its swipe tests use the `touchGesture` browser command (`opening-hours-week.test.ts:988-994`), registered in venue-service's Vitest config (`packages/venue-service/vitest.config.ts:4`, `:42`), typed by `packages/venue-service/src/dashboard/pointer-gestures.d.ts`, with `commands.parkTouch()` after each test (`opening-hours-week.test.ts:22`). `fixed-title.ts` is exported as `@waitron/venue-service/dashboard/fixed-title`; `placePopover` as part of `@waitron/venue-service/painter` (`painter.ts:15`); `calendar-day-box` as `@waitron/venue-service/dashboard/calendar-day-box`, already imported by `staffing-month.ts:11`.
- Tests that mount `staffing-rota` (grep `staffing-rota\|RotaView\|rota-view` over `packages` and `apps`): sized to 1280 px by default — `rota-view.test.ts:23-38`, `rota-by-person.test.ts:22-49`; **unsized** (so 414 px wide in Vitest's default window) — `rota-planning.test.ts:78-93`, `rota-races.test.ts:75-85`, `rota-view.a11y.test.ts:15-41` (the `host` from `@waitron/ui/src/test-helpers.js`), `index.test.ts:255-305` and `:308-337`, `apps/dashboard/src/dashboard-app.test.ts:1635-1681`; sized by its own `mount` (a 1280×800 window, `page.viewport` at `:131`, restored in `afterEach` at `:11-16`) — `apps/dashboard/src/dashboard-app.search-modules.test.ts:172-195`. `shift-edit-dialog.test.ts:8` only imports `rota-view.js`.
- Tests that pin today's shape outside the rota files: `packages/staffing/src/dashboard/index.test.ts:308-337` (search destinations), `apps/dashboard/src/dashboard-app.search-modules.test.ts:172-211` (searches "by person", opens `calendar:rota:by-person`, path `/view/rota/mode/person`) and its rota fake at `:85-98` (`areas: []`, `days: []`).

---

## Tasks

| # | Task | Server? |
|---|---|---|
| 1 | The rota read names each day's hours, season and special day | yes |
| 2 | One Show menu replaces the area picker and the By area / By person switch | no |
| 3 | One bar: the state, the counts, the labour count and the one action | no |
| 4 | The week title: the range, one width, month links | no |
| 5 | The `rota-popup` element alone | no |
| 6 | The people panel goes; the picker opens beside its slot in `rota-popup` | no |
| 7 | The count buttons step to the next target; the day headers say what needs attention or Closed; `closedAllDay` goes | yes (a field removed) |
| 8 | The area grid: rows only when used, "Fill", and "+ Add shift" in the empty part of a cell | no |
| 9 | Everyone: rows in staff-role order, cards with colour, area and role | no |
| 10 | Everyone: clicking an empty day offers that day's open slots, then "Another shift…" | no |
| 11 | Empty weeks say why | no |
| 12 | Phone: the `rota-day` element alone | no |
| 13 | Phone: the view switches to one day, with the strip and the foot action; test frames sized | no |
| 14 | Phone: a swipe steps a day | no |
| 15 | Phone: the picker and the open-slots menu as sheets | no |
| 16 | LOOK (driver) | — |
| 17 | Docs (driver) | — |

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

- [ ] **Step 1: Failing tests** in `rota.test.ts`, under `describe("the rota week")` (`:133`). Seed hours and special days directly: a department's season hours as `packages/staffing/src/paint.test.ts:275-292` does (a `menuPeriods` row, a `departmentDays` row with `seasonId` and `weekday`, a `departmentDayRanges` row); a special day and its dates as `packages/staffing/src/month.test.ts:55-80` does; a special day's own department hours as a `departmentDays` row carrying `specialDayDateId` with its range (the shape `occurrencesOf` reads, `packages/venue-service/src/special-days.ts:261-290`). Weekdays count Sunday 0 (`weekdayOf`, `packages/venue-service/src/hours-rules.ts:71-75`). `seedVenue` (`packages/staffing/test/seed.ts`) makes one season, "Summer" from `06-01`, so it holds the week of 2026-11-30.
  - `"names each day's season and special day, and the seasons the week touches"`: add a special day "Fiesta" with the date 2026-12-02. Expect `days[0].seasonId` to be `v.seasonId`, `days[2].specialDay` to equal `{ id, name: "Fiesta" }`, every other `specialDay` null, and `seasons` to equal `[{ id: v.seasonId, name: "Summer" }]`.
  - `"lists the seasons in the order the week first touches them when one starts mid-week"`: add a season "Winter" starting `12-03` (Thursday 2026-12-03). Expect `days[0..2].seasonId` Summer's id, `days[3..6].seasonId` Winter's, and `seasons` `[{ Summer }, { Winter }]` in that order. The failing case would list them by `startsOn` or not at all; Summer (06-01) sorts before Winter (12-03) by date too, and `readSeasons` itself returns rows ordered by `startsOn` (`seasons.ts:27-33`), so this case alone cannot tell the two apart. Add a second case that can: the week of 2026-12-28 with Summer at `06-01` and a season "Winter" at `01-01` — 28–31 Dec take Summer and 1–3 Jan take Winter (`seasonOnSorted`, `season-rules.ts:37-45`), so expect `[Summer, Winter]`; a sort by `startsOn` (or keeping the read's order) gives `[Winter, Summer]`.
  - `"says which days have opening hours: a season weekday with a range, not one without, and not a special day closed all day"`: give the department a range on weekday 2 (Tuesday) and weekday 4 (Thursday) of the season; make Thursday 2026-12-03 a special-day date closed all day. Expect `hasHours` true on 2026-12-01 only. The failing case would print `true` for Thursday; the control is Tuesday's `true`.
  - `"a special day that adds hours on a weekday the season has none has hours"`: no season range on weekday 3 (Wednesday); a special-day date 2026-12-02 whose department paint has a range. Expect `hasHours` true on 2026-12-02 and false on the other days. The control is the same week with the special day's range removed: false on 2026-12-02.
  - `"an inactive department's hours do not count"`: give the department a range on Tuesday, then switch it off (`t.update(departments).set({ active: false })`, as `rota.test.ts:200-214` does); every `hasHours` is false.
  - `"a location with no season names none"`: `seedVenue(suite.db)` alone (no staffing paint, unlike `venue()`), then delete its one `seasons` row. Expect every `seasonId` null, every `hasHours` false and `seasons` `[]`.
- [ ] **Step 2: Run** `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/staffing exec vitest run src/rota.test.ts` and watch the new cases fail on the missing fields.
- [ ] **Step 3: Implement.** In `readRotaWeek`: read the seasons once with venue-service's exported `readSeasons(tx, scope)` (`index.ts:96`) and pass them to `readDayPlan` as its fourth argument (`readDayPlan(tx, scope, days, seasons)`; the parameter exists, `day-resolver.ts:35-47`, so neither `readDayPlan`'s signature nor its other callers change). Call `resolveDepartmentsDays(tx, scope, departmentIds, days, clock, plan)` with the ids of the `department` areas from `listStaffingAreas` (`packages/staffing/src/paint.ts:42-63`, which lists active departments only), giving it that `plan` so it reads no second day plan (`planFor`, `day-resolver.ts:89-100`); `hasHours` is true when any department's `ranges` is non-empty that day (with no active department, the call returns an empty map and every `hasHours` is false). `seasonId` from `plan.seasonIdOn`, `specialDay` from `plan.special` (`{ id: special.specialDayId, name: special.name }`, as `readCalendarMonthPlan` maps it, `packages/venue-service/src/opening-hours-calendar.ts:200-205`). `seasons`: the read seasons whose ids the days name, in the order the days first name them. Keep `closedAllDay` for now (Task 7 removes it).
- [ ] **Step 4: Run** the server test, then the whole node project once (`… exec vitest run --project node`), then the browser baseline list above (the fixture changed). Expected: all pass. Then confirm the claim that the live dependencies already cover the reads: list the tables `resolveDepartmentsDays`, `readSeasons` and `specialDaysOn` read (`packages/venue-service/src/day-resolver.ts:134-170`, `season-weeks.ts`, `seasons.ts`, `special-days.ts`) and check each is in `QUERY_DEPENDENCIES.rota`; add any that is missing, with a case in `live-queries.test.ts`, and run `pnpm exec vitest run scripts/live-subscriptions.test.ts`.
- [ ] **Step 5: typecheck, lint, prettier; commit** `feat(staffing): the rota read names each day's hours, season and special day (A763)`.

### Task 2: One Show menu replaces the area picker and the By area / By person switch

**Files:**
- Modify `rota-view.ts` (the area combobox and `:323`'s switch become one Show combobox; `#go`; `willUpdate`'s reset key; `render`'s choice between grids; the no-areas line), `index.ts` (search destinations), `strings.ts`.
- New `packages/staffing/src/dashboard/rota-model.ts` and `rota-model.test.ts` (browser project, pure functions).
- Tests: `rota-view.test.ts`, `rota-by-person.test.ts`, `index.test.ts`, `rota-view.a11y.test.ts`, `apps/dashboard/src/dashboard-app.search-modules.test.ts`.

**Interfaces (produces):**
```ts
// rota-model.ts
export const EVERYONE = "everyone";
export type Show = { kind: "everyone" } | { kind: "area"; area: AreaRef; key: string; name: string };
export function chosenShow(read: RotaWeek, asked: string | undefined): Show; // Everyone when there is no active area (Decision 1)
export function matchesFor(read: RotaWeek, show: Show, businessDay?: string): AreaDayMatch[];
```
Strings: `staffing.rota.everyone` "Everyone" / "Todo el equipo"; `staffing.rota.everyone_search` "Everyone's rota" / "Turnos de todo el equipo". Show's label reuses `staffing.month.area`.

- [ ] **Step 1: Failing tests:**
  - `rota-model.test.ts`: `chosenShow` gives the first area for `undefined`, `""` and an unknown key; the named area for its key; Everyone for `"everyone"`; **Everyone for `undefined`, `"everyone"` and an area key when `read.areas` is empty**. `matchesFor` gives one area's matches for an area and every area's for Everyone, optionally for one day.
  - `rota-view.test.ts`, new `"one Show menu offers Everyone then each area, and sends the choice as the area word"`: exactly one `wt-combobox` (`name="area"`, label "Show"); its options are `["everyone", "station:kitchen", "department:restaurant"]` with labels `["Everyone", "Kitchen", "Restaurant"]`; choosing Everyone calls `open("rota", { week: "2026-11-30", area: "everyone" })`; no `[data-test=by-area]` or `[data-test=by-person]`; with `params = { area: "everyone" }` the view draws `rota-by-person` and the menu's value is `"everyone"`.
  - `rota-view.test.ts`, `"a week step keeps Everyone"`: with `area: "everyone"`, next week calls `open("rota", { week: "2026-12-07", area: "everyone" })`.
  - `rota-view.test.ts`, new `"with no active area it shows Everyone: Show offers only Everyone, the grid lists people, and no day offers to add"`: a read with `areas: []` and the fixture's people; with `params` `{}` and again with `{ area: "station:kitchen" }`: the menu's options are `["everyone"]` and its value `"everyone"`, `rota-by-person` lists five `[data-person]` rows, the view's text contains "No active areas.", and `rota-by-person` holds no `[data-test=add-shift]` (Task 10 renames it `[data-test=day-add]` and keeps this check).
  - `rota-view.a11y.test.ts`: add an `"everyone"` state (params `{ area: "everyone" }`, waits for `rota-by-person`).
- [ ] **Step 2: Changed test checks:**

  | Test (file:line) | Before | After |
  |---|---|---|
  | `rota-by-person.test.ts:39` (mount) | `params = { mode: "person", area: "station:kitchen" }` | `params = { area: "everyone" }` (setup only) |
  | `rota-by-person.test.ts:133-138` | next week opens `{ week, area: "station:kitchen", mode: "person" }` | opens `{ week: "2026-12-07", area: "everyone" }` |
  | `rota-by-person.test.ts:154-157` "keeps the area filter out of the all-areas person view" | no `[name="area"]` | exactly one `wt-combobox`, the Show menu, valued `"everyone"`; no `[data-test=by-area]`/`by-person` (stricter) |
  | `rota-view.a11y.test.ts:20-24`, `:39-40` (`"empty"` state) | `areas`, `people` and `staffRoles` emptied; waits for "No active areas" | only `areas` emptied (Decision 1's ruling: the grid lists people); waits for "No active areas" **and** `rota-by-person` (stricter) |
  | `index.test.ts:308-337` | destinations `[{ mode: "area" }, { mode: "person" }]`; the matching switch button `aria-pressed="true"` | destinations `[{ area: "everyone" }]`; the real view's Show value is `"everyone"` and `rota-by-person` is drawn |
  | `apps/dashboard/src/dashboard-app.search-modules.test.ts:172-211` | searches "by person", opens `calendar:rota:by-person`, `[data-test=by-person]` pressed, path `/manage/opening-hours/view/rota/mode/person`; then the same id disappears without the permission | searches "everyone", opens `calendar:rota:everyone`, Show valued `"everyone"`, path `/manage/opening-hours/view/rota/area/everyone`; the same id disappears without the permission. Test name "Rota person view" → "Rota for everyone". The app's rota fake has `areas: []` (`:85-98`), so this also passes through Decision 1's no-area rule |

- [ ] **Step 3: Run and watch fail:** `… exec vitest run src/dashboard/rota-model.test.ts src/dashboard/rota-view.test.ts src/dashboard/rota-by-person.test.ts src/dashboard/index.test.ts src/dashboard/rota-view.a11y.test.ts`.
- [ ] **Step 4: Implement** Decisions 1–3 and 23: `render` uses `chosenShow(read, this.params.area)`; with no active area the Show menu offers only Everyone and the line "No active areas." sits above the grid, and `rota-by-person` gets a flag that hides its add buttons; `#go(week, area)` sends `area` only (no `mode`); `willUpdate` resets the picker when `params.area` changes (drop `#mode`); search destinations per Decision 2. Delete `staffing.rota.by_area`, `by_person`, `view` once unread.
- [ ] **Step 5: Run** the files above, plus `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.search-modules.test.ts`. Typecheck both packages; lint; prettier. **Commit** `feat(staffing): one Show menu for the rota — Everyone or an area (A763)`.

### Task 3: One bar — the state, the counts, the labour count and the one action

**Files:** `rota-view.ts`, `index.ts` (pass `canWriteStaffing` from `ctx.calendarViews`; Task 4 adds `canOpenStaffing`), `rota-model.ts` (`weekCounts`, `summary`), `strings.ts` (and the count helper, Decision 22). Tests: `rota-view.test.ts`, `rota-planning.test.ts`, `rota-model.test.ts`, `rota-view.a11y.test.ts`, `index.test.ts`, `strings.test.ts`.

**Interfaces:**
```ts
// rota-model.ts
export function weekCounts(read: RotaWeek, show: Show): { unfilled: number; partly: number; over: number };
export type Summary = "counts" | "all_filled" | "no_shifts" | "nothing_to_fill";
export function summary(read: RotaWeek, show: Show): Summary;   // Decision 6
// strings.ts
export function countWords(kind: "unfilled" | "partly" | "over", count: number, locale?: string): string;
// rota-view.ts
@property({ type: Boolean }) canWriteStaffing = false;
```
Strings (EN / ES): `staffing.rota.partly_count` "{count} partly uncovered" / "{count} parcialmente cubiertos"; `staffing.rota.partly_one` "1 partly uncovered" / "1 parcialmente cubierto"; `staffing.rota.over_count` "{count} over" / "{count} sobrantes"; `staffing.rota.over_one` "1 over" / "1 sobrante" (`unfilled_count` exists and needs no `_one`); `staffing.rota.all_filled` "All slots filled" / "Todos los puestos cubiertos"; `staffing.rota.nothing_to_fill` "Nothing to fill" / "Nada que cubrir"; `staffing.rota.no_shifts` "No shifts yet" / "Aún no hay turnos"; `staffing.rota.no_rules` changes to "No labour rules to check against" / "No hay reglas laborales con las que comprobar"; `staffing.rota.still_published` "Staff still see the published week" / "El equipo sigue viendo la semana publicada"; `staffing.rota.publish_changes` "Publish changes" / "Publicar cambios". Delete `staffing.rota.attention` and `staffing.rota.changed` once unread.

- [ ] **Step 1: Failing tests:**
  - `rota-model.test.ts`: `weekCounts` for Kitchen and for Everyone (an extra Restaurant unfilled slot counts only for Everyone); `summary` gives each of its four answers, one fixture each.
  - `strings.test.ts`: `countWords` at 1 and at 3 for each kind in both languages ("1 parcialmente cubierto", "3 parcialmente cubiertos", "1 sobrante", "3 sobrantes", "1 sin cubrir", "3 sin cubrir", and the English).
  - `rota-view.test.ts`, `"the bar holds the week, Show, then the state, the counts, the labour count and Publish, in that order, on one row at 1280"`: `useViewport(1280, 900)`, a 1280 px frame, warnings loaded with one breach and a ruleset (so the labour count shows); wait for `[data-test=labour-count]` before measuring. The elements' vertical centres are within 1 px of each other, their `left`s increase in that order, and the counts are three `button`s reading "1 unfilled", "1 partly uncovered", "1 over". Room for CI's fonts: the gap between Show's right edge and the state pill's left edge is at least 64 px (5% of 1280). If that bound fails on macOS the bar is too tight for CI: report it to the driver, who decides (shorter words, a narrower Show); the bound is not lowered.
  - `"the labour count leads with a warning sign and is drawn in the danger colour"`: its first child is a `⚠` marked `aria-hidden="true"`; its colour equals a probe's `--wt-color-danger` (as `rota-view.test.ts:78-94` measures a swatch).
  - `"with no labour rules the note takes the labour count's place, after the counts"`: ruleset `null` → no `[data-test=labour-count]`; the bar's text reads, whitespace normalised, "… 1 unfilled · 1 partly uncovered · 1 over · No labour rules to check against …"; the note's `left` is greater than the last count's.
  - `"Publish is in the bar of every unpublished week: quiet with no shifts or no version, loud once a shift exists"`: a read with `version: null, shifts: []` → `[data-test=publish-week]` `secondary` and disabled; a draft with `shifts: []` → the same; the fixture → `primary` and enabled once warnings load.
  - `"a week being changed says staff still see the published week, before the counts, and offers Publish changes"`: fixture (`changedSincePublished: true`) → "Staff still see the published week" in the bar, its `left` between the state pill's and the first count's; the button reads "Publish changes"; with `changedSincePublished: false` neither.
  - `"a published week shows Published in the success colour, its summary and Change this week"`: the pill reads "Published" and its colour equals `--wt-color-success`; "All slots filled" (with a read whose slots are all filled) in `--wt-color-success`; `[data-test=change-week]` `secondary`.
  - `"zero counts are left out; with none it reads All slots filled"` (one fixture with only filled slots).
  - `"the counts are not a live region; their words are announced from a hidden status"`: `[data-test=attention]` has no `role`; `[data-test=attention-status]` has `role="status"` and its text, normalised, is "1 unfilled · 1 partly uncovered · 1 over"; with all filled it reads "All slots filled".
  - `"the open-swaps notice sits under the bar"` (its box's `top` ≥ the bar's `bottom`, measured at `useViewport(1280, 900)`).
  - `index.test.ts`: the Rota contribution passes `canWriteStaffing` from `ctx.calendarViews` (true when the Staffing entry is there with its `canWrite`; false without it).
  - `rota-view.a11y.test.ts`: add states `"no-version"`, `"changing"` (changed since published, swap notice shown), `"all-filled"`, `"published-all-filled"`, `"no-rules"`, `"labour-count"` (a breach and a ruleset).
- [ ] **Step 2: Changed test checks:**

  | Test (file:line) | Before | After |
  |---|---|---|
  | `rota-planning.test.ts:242` | text contains "Labour rules are not set up" | text contains "No labour rules to check against", inside the bar |
  | `rota-planning.test.ts:327` | text does not contain "Labour rules are not set up" | does not contain "No labour rules to check against" |
  | `rota-view.test.ts:70-72` | `[data-test=attention]` text contains "1 unfilled · 1 partly uncovered · 1 over" | the three buttons are joined by " · " text nodes inside `[data-test=attention]`; the check reads the text with whitespace normalised (lit's template whitespace may sit between them), same words, and adds that each of the three is a `button` (stricter) |

- [ ] **Step 3: Run and watch fail**, then **implement** Decisions 5, 6, 19, 20 and 21: the two rows (`.head` wraps on narrow widths; Task 13 handles the phone), the state pill, the counts as `<button class="count" data-kind=…>` (Task 7 makes them step; here they do nothing yet but are focusable), the hidden status, the labour count `[data-test=labour-count]` or the no-rules note in its place, Change this week / Publish in the bar, errors and the swap notice under it. The title is untouched here (Task 4).
- [ ] **Step 4: Run** `rota-view.test.ts rota-planning.test.ts rota-races.test.ts rota-model.test.ts rota-view.a11y.test.ts index.test.ts strings.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): the rota's one bar — state, counts and Publish (A763)`.

### Task 4: The week title — the range, one width, month links

**Files:** `rota-view.ts` (the title), `format.ts` (`weekTitleParts`), `index.ts` (pass `canOpenStaffing`), `strings.ts`. Tests: `rota-view.test.ts`, `index.test.ts`, `rota-view.a11y.test.ts`.

**Interfaces:**
```ts
// format.ts
export function weekTitleParts(monday: string, language?: string): { text: string; month?: string }[];
// rota-view.ts
@property({ type: Boolean }) canOpenStaffing = false;
```
Strings: `staffing.rota.month_hint` "Opens this month's staffing" / "Abre el personal de este mes".

- [ ] **Step 1: Failing tests** (`rota-view.test.ts`; a `title` helper reads `[data-test=week]`'s text with `replace(/\s+/g, " ").trim()`, Decision 4):
  - `"the title is the week's range"`: `title(el)` is exactly "30 Nov – 6 Dec 2026"; in Spanish "30 nov – 6 dic 2026".
  - `"the title keeps one width across weeks"`: at `useViewport(1280, 900)`, the title box (`.fixed-title`) has the same width for weeks 2026-11-30 and 2026-12-28 (±0.5 px), measured after each week's read has drawn.
  - `"each month name opens that month's Staffing"`: with `canOpenStaffing`, the "Nov" link calls `open("staffing", { month: "2026-11", area: "station:kitchen" })` and "Dec" `open("staffing", { month: "2026-12", area: "station:kitchen" })`; with Everyone, no `area`; each link has `aria-describedby` naming the hint; without `canOpenStaffing` the title has no `button`.
  - `index.test.ts`: the Rota contribution passes `canOpenStaffing` from `ctx.calendarViews` (true when the Staffing entry is there, false without it).
  - `rota-view.a11y.test.ts`: the `"draft"` state is mounted with `canOpenStaffing`, so axe sees the links.
- [ ] **Step 2: Changed test checks:**

  | Test (file:line) | Before | After |
  |---|---|---|
  | `rota-view.test.ts:188` | `[data-test=week]` text contains "7 Dec" | `title(el)` equals "7 – 13 Dec 2026" (stricter: the whole range; the old substring "7 Dec" is not in a range that shares its month, with any spaces) |

- [ ] **Step 3: Run, watch fail, implement** Decision 4 (wide half; Task 13 draws the phone's plain title).
- [ ] **Step 4: Run** `rota-view.test.ts rota-view.a11y.test.ts index.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): the rota's week title links to the month and keeps one width (A763)`.

### Task 5: The `rota-popup` element alone

**Files:** New `packages/staffing/src/dashboard/rota-popup.ts`, `rota-popup.test.ts`, `rota-popup.a11y.test.ts`. Nothing else changes in this task.

**Interfaces:**
```ts
// rota-popup.ts — <rota-popup>; its content is its default slot
@property({ type: Boolean, reflect: true }) sheet = false;  // phone: Task 15 draws it
@property() heading = "";                                    // read by screen readers, focused on open
show(anchor: HTMLElement): void;  // places beside (Decision 11) and follows the anchor; called again after content changes, it places again without moving focus
hide(): void;
get shown(): boolean;
// sends "rota-popup-close" (detail {}) when it closes for any reason
```

- [ ] **Step 1: Failing tests** (`rota-popup.test.ts`; content of a fixed size, e.g. a 300 × 200 px `div`, so no measurement depends on fonts; anchors are absolutely placed 120 × 40 px boxes):
  - At `useViewport(1280, 900)`: an anchor at left 100 puts the popup's left at the anchor's right (±1 px) and its top at the anchor's top (±1 px); an anchor at left 1100 puts the popup's right at the anchor's left (±1 px); the popup stays inside the window by 8 px.
  - At `useViewport(390, 844)` with `sheet` false and an anchor in the middle, there is no room on either side, so it sits below the anchor (its top at the anchor's bottom ±1 px).
  - **It follows its anchor:** the anchor inside a 400 px-wide `overflow: auto` box whose content is 1200 px wide; scroll the box by 40 px → the popup moves with the anchor (left at the anchor's right ±1 px); scroll until no part of the anchor is inside the box → the popup closes and sends `rota-popup-close` once; with a tall spacer, scrolling the window until the anchor is above the top also closes it; a window resize re-places it. Mirrors `calendar-day-box.ts:126-175`.
  - Escape and a `userEvent.click` outside close it and send `rota-popup-close` once; focus moves to the heading on open and returns to the anchor on close when it was inside, and stays where it went when the click outside landed on another button.
  - Token-painting: its background equals `--wt-color-surface` and its border colour `--wt-color-border`, measured against a probe as `rota-view.test.ts:78-94` does.
  - `rota-popup.a11y.test.ts`: states `"open beside"` and `"open with a list of buttons"`, both themes, popup open (`:popover-open` checked before axe).
- [ ] **Step 2: Changed test checks:** none (new files only).
- [ ] **Step 3: Run, watch fail, implement** the wide half of Decision 11: an auto popover with `role="dialog"` labelled by its heading, `#place` (beside, else start side, else `placePopover(popup, anchor, false, true)`), the follow-and-close methods and the `flatParent`/`scrollTargets` copies with comments naming `calendar-day-box.ts` and `flat-tree.ts`, `beforetoggle` noting whether focus was inside and stopping the follow, `toggle` returning focus and sending `rota-popup-close`. Place in `show()` after the slotted content has rendered, before the first paint (CLAUDE.md §4: "Position a native popover before its first paint").
- [ ] **Step 4: Run** `rota-popup.test.ts rota-popup.a11y.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): a rota popup that opens beside its anchor and follows it (A763)`.

### Task 6: The people panel goes; the picker opens beside its slot in `rota-popup`

**Files:**
- Modify `rota-view.ts` (drop the `aside` and `.layout`'s side column, `:353-423`; the grid takes the full width; the picker goes into a `rota-popup` as Decision 11 places it in the tree; the close handler clears only its own pick), `rota-by-area.ts` (`pick-slot` detail gains `anchor`; daily warnings on cards, Decision 10), `slot-picker.ts` (no Close button unless `sheet`; "would go over" line; subheading), `strings.ts`.
- Tests: `rota-view.test.ts`, `rota-planning.test.ts`, `slot-picker.test.ts`, `slot-picker.a11y.test.ts`, `rota-view.a11y.test.ts`.

**Interfaces:**
```ts
// slot-picker.ts
@property({ type: Boolean }) sheet = false;   // draws Cancel (staffing.role.cancel) and sends close-picker
// rota-by-area.ts: "pick-slot" detail { slot: Slot; anchor: HTMLElement }
```
Strings: `staffing.rota.picker_sub` "{area} · holders of the staff role first" / "{area} · primero quienes tienen el rol"; `staffing.rota.would_go_over` "would go over {contract} h contract" / "superaría su contrato de {contract} h". Delete `staffing.rota.people` and `staffing.rota.close` once unread.

- [ ] **Step 1: Failing tests:**
  - `rota-view.test.ts`, `"the picker opens beside the slot that was clicked, not in a side panel, and the grid takes the full width"`: `useViewport(1280, 900)`; `userEvent.click` on `[data-slot=empty]`; wait for the picker's `[data-person=marc]`, then: `rota-popup` is `:popover-open`, its top is at the slot's top (±1 px) and it sits beside the slot on either side (its left at the slot's right ±1 px, or its right at the slot's left ±1 px) without overlapping it — which side is `rota-popup.test.ts`'s business, and the Friday column at 1280 is near enough the right edge that a wider font can flip it; no `aside`; the grid's `[data-test=grid-scroll]` width equals the view's width (±1 px).
  - `rota-view.test.ts`, `"the picker moves with its slot when the grid scrolls, and closes once the slot leaves the window"`: `useViewport(1280, 900)` and a 700 px frame (above the phone width); first assert `[data-test=grid-scroll]`'s `scrollWidth` > `clientWidth` (the table is at least 880 px wide, so it scrolls; this keeps the check from passing on a grid that cannot move). Open the picker on `[data-slot=empty]`, scroll the grid sideways by 40 px → the popup's edge is still at the slot's edge (±1 px); then append a tall spacer and scroll the window until the slot is above the top → `slot-picker` is gone (`picked` cleared).
  - `rota-view.test.ts`, `"clicking a second slot while a picker is open opens the second slot's picker"`: a read with a second unfilled slot `empty2` on Thursday (2026-12-03); `useViewport(1280, 900)`; `userEvent.click` `[data-slot=empty]`, wait for the popup; `userEvent.click` `[data-slot=empty2]` (CLAUDE.md §4: a click whose outcome depends on update order is tested with `userEvent.click`); after the old popup's `toggle` has fired (`await` one animation frame and `el.updateComplete`), `slot-picker`'s `pickedSlot.key` is `"empty2"` and `rota-popup` is `:popover-open`. The failing case is a picker that is gone, because the first popup's close cleared the new pick.
  - `rota-view.test.ts`, `"a fill refused after the picker was dismissed shows under the bar"`: hold the POST, choose Marc, press Escape, refuse the POST → a `role="alert"` under the bar with the sentence; focus is on the slot, not the body.
  - `slot-picker.test.ts`, `"says when the slot would take someone over their contract"`: give Laia `plannedMinutes: 2100` (35 h of 40) and an 8 h slot → "would go over 40 h contract"; Marc at 2340 with a 1 h slot does not.
  - `slot-picker.test.ts`, `"has no Close button beside a slot, and Cancel in a sheet"`.
  - `rota-planning.test.ts`, `"draws a daily warning on that person's cards on that date in the area, and the bar counts the weekly one"` (see the table).
  - `rota-view.a11y.test.ts`: the `"picker"` state now opens it with `userEvent.click` and checks `:popover-open` before axe.
- [ ] **Step 2: Changed test checks:**

  | Test (file:line) | Before | After |
  |---|---|---|
  | `rota-view.test.ts:73-76` | the people panel's `[data-person=joan]` reads "41 / 40 h" and has `data-over-contract` | switched to `params = { area: "everyone" }`: `rota-by-person`'s `[data-person=joan] th` reads "41 / 40 h" and has `data-over-contract`; and in the area view no `[data-person]` panel exists |
  | `rota-view.test.ts:257-260` "lists staff roles in the people panel" | the panel's `[data-person=ana]` contains "Head chef" | renamed "lists staff roles under each name in Everyone": `rota-by-person`'s `[data-person=ana] th` contains "Head chef" |
  | `rota-planning.test.ts:346-376` "shows daily and weekly warnings beside the named person in the area view" | the panel's `[data-person=ana]` shows the daily warning and `[data-person=joan]` the weekly one | in the area grid, Ana's filled slot card `rota-by-area [data-slot=filled]` (a filled slot's card carries `data-slot`, `rota-by-area.ts:150-159`; the fixture's slot key is `filled`, `rota-fixture.ts:53`) shows "2026-12-01: 10 h planned; daily maximum 9 h"; `[data-test=labour-count]` reads "2 labour warnings" with both breaches set, so the weekly one is still counted in the area; then with `area: "everyone"`, `rota-by-person [data-person=joan] th` shows "weekly maximum 40 h". **For review:** the weekly warning is no longer shown in an area (Decision 10); the labour-count assertion pins that the bar still counts it |
  | `slot-picker.a11y.test.ts:13-30` | the picker mounted alone | unchanged (the picker is still a plain element; the popup is tested separately) |

  The picker checks Decision 11 lists (`rota-view.test.ts:124`, `:129`, `:230`, `:233`, `:240`, `:249`, `:267`; `rota-planning.test.ts:164`, `:246`, `:249`; `rota-view.a11y.test.ts:47`) are expected to pass unchanged; if one fails, report it rather than edit it.
- [ ] **Step 3: Run and watch fail**, then **implement** Decisions 10–12 and the popup's use. The fill path stays `#fill`; a refusal after the popup closed shows under the bar (Decision 11).
- [ ] **Step 4: Run** `rota-popup.test.ts rota-view.test.ts rota-planning.test.ts rota-races.test.ts slot-picker.test.ts slot-picker.a11y.test.ts rota-view.a11y.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): the rota picker opens beside its slot and the people panel goes (A763)`.

### Task 7: The count buttons step to the next target; the day headers say what needs attention or Closed; `closedAllDay` goes

**Files:** `rota-model.ts` (`attentionTargets`, `dayCounts`, `isClosed`), `rota-view.ts` (count clicks), `rota-by-area.ts` and `rota-by-person.ts` (headers; `focusTarget`), `strings.ts`; then `packages/staffing/src/staffing-types.ts`, `rota.ts:86` and `testing/rota-fixture.ts:42` (`closedAllDay` removed). Tests: `rota-model.test.ts`, `rota-view.test.ts`, `rota-by-person.test.ts`, `rota.test.ts` (run only).

**Interfaces:**
```ts
export type Target = { businessDay: string; area?: AreaRef; slotKey?: string; shiftId?: string; header?: true };
export function attentionTargets(read: RotaWeek, show: Show, kind: "unfilled" | "partly" | "over"): Target[];
// Everyone + unfilled: one { businessDay, header: true } per day with unfilled slots (Decision 7)
export function dayCounts(read: RotaWeek, show: Show, businessDay: string): { unfilled: number; partly: number; over: number };
export function isClosed(read: RotaWeek, show: Show, businessDay: string): boolean; // Decision 8
// rota-by-area / rota-by-person
focusTarget(target: Target): boolean; // focuses [data-slot], [data-shift] or the day's header; tabindex -1 when not a button; false when absent
```

- [ ] **Step 1: Failing tests:**
  - `rota-model.test.ts`: `attentionTargets` in reading order (two unfilled slots on Tue and Fri, in two rows); in Everyone, unfilled gives day-header targets only; `dayCounts`; `isClosed` true for `hasHours: false` with no slot in scope, false for `hasHours: false` with a slot, false for `hasHours: true` with none.
  - `rota-view.test.ts`, `"each count button focuses the next such slot, wrapping"`: two unfilled slots → first press focuses slot 1, second slot 2, third slot 1 (`area(el).shadowRoot!.activeElement`). Partly uncovered and over focus their cards.
  - `"in a published week a count focuses a card that is not a button"` (`tabindex="-1"`, focused).
  - `"in Everyone the unfilled count steps to the next day header that says it has unfilled slots"`: `params = { area: "everyone" }`, unfilled slots on Tuesday and Friday → presses focus Tuesday's header, then Friday's, then Tuesday's; each focused header's text contains "unfilled"; `open` is never called (Show does not switch).
  - `"a day header names its attention and a closed day reads Closed once"`: the fixture's Friday header contains "1 unfilled"; Monday (`hasHours: false`, no slot) reads "Closed" in its header and no cell holds "Closed".
- [ ] **Step 2: Changed test checks:** `rota-view.test.ts:67` ("Closed" in the list read by `text(el)`) — unchanged in what it reads: "Closed" is now in the header, which is inside `rota-by-area`'s shadow root. `rota-by-person.test.ts`'s per-cell "Closed" (`rota-by-person.ts:84`) is not asserted anywhere (grep `Closed` in the test files before changing it).
- [ ] **Step 3: Run, watch fail, implement** Decisions 7–8, run again.
- [ ] **Step 4: Remove `closedAllDay` from the rota read.** `/usr/bin/grep -rn "closedAllDay" packages/staffing/src apps` must show no reader of `RotaWeek`'s field left (the Staffing month's own `closedAllDay` in `month.ts` and `staffing-month.ts` is another type and stays); then delete it from `RotaWeek` (`staffing-types.ts:119`), `rota.ts:86` and the fixture (`rota-fixture.ts:42`). Run `rota.test.ts` and the whole node project once.
- [ ] **Step 5: Run** `rota-model.test.ts rota-view.test.ts rota-by-person.test.ts rota-view.a11y.test.ts rota-by-person.a11y.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): rota counts step to the next target; headers say what needs attention (A763)`.

### Task 8: The area grid — rows only when used, "Fill", and "+ Add shift" in the empty part of a cell

**Files:** `rota-by-area.ts`, `rota-model.ts` (`rolesShown`), `shift-edit-dialog.ts` (`area`, `staffRoleId` seeds, and both in the subject key), `rota-view.ts` (handles `add-shift` with area and role), `strings.ts`. Tests: `rota-view.test.ts`, `rota-model.test.ts`, `shift-edit-dialog.test.ts`, `shift-edit-dialog.save-state.test.ts`, `rota-view.a11y.test.ts`.

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
  - `shift-edit-dialog.test.ts`, `"a new shift opened from a cell starts with its area and staff role"`; and `"a second cell's editor on the same day starts afresh with its own staff role"`: open with `businessDay` 2026-12-04, `staffRoleId` "sous", change the start time, then set `staffRoleId` "head" while open → the draft's staff role is "head" and the start time is back to the seed (the subject key now carries area and staff role, `shift-edit-dialog.ts:87`). The failing case keeps "sous" and the edited time.
  - `shift-edit-dialog.save-state.test.ts`, `"…and its Save stays quiet until a person is chosen"`.
  - `rota-view.a11y.test.ts`: add a `"cell-add focused"` state.
- [ ] **Step 2: Changed test checks:**

  | Test (file:line) | Before | After |
  |---|---|---|
  | `rota-view.test.ts:65` | area text contains "+ unfilled" | contains "Fill", and `[data-slot=empty]` reads "09:00–17:00 · Fill" (stricter) |
  | `rota-view.test.ts:55-59` | row headers `["Head chef","Sous chef","Not in a slot"]` | unchanged (the fixture has slots for both roles and an unlinked shift) |

- [ ] **Step 3: Run, watch fail, implement** Decisions 9 and 17 (area half). The add button fills the cell's remaining height (`flex: 1` in a column flex cell) so "the empty part" is the target.
- [ ] **Step 4: Run** the files above plus `shift-edit-dialog.unsaved.test.ts shift-edit-dialog.a11y.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): the area rota draws only used rows, Fill slots and an Add shift in each cell's empty part (A763)`.

### Task 9: Everyone — rows in staff-role order, cards with colour, area and role

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

### Task 10: Everyone — clicking an empty day offers that day's open slots, then "Another shift…"

**Files:**
- New `packages/staffing/src/dashboard/open-slots-menu.ts` (`rota-open-slots`), `open-slots-menu.test.ts`, `open-slots-menu.a11y.test.ts`.
- Modify `rota-by-person.ts` (the empty-part button replaces `[data-test=add-shift]`, `:86`), `rota-view.ts` (opens the menu in a `rota-popup`; `#fill(slot, personId)`; closes the menu when its week is published or its last offered slot is filled), `rota-model.ts` (`openSlots`), `strings.ts`.
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
  - `rota-by-person.test.ts`, `"clicking the empty part of a day opens that day's open slots beside it, and choosing one fills it for that person"`: `useViewport(1280, 900)`; `userEvent.click` Marc × Friday's `[data-test=day-add]` → `rota-popup` open beside it (top at the button's top ±1 px, either side), holding `rota-open-slots`; clicking the `empty` slot POSTs `/management-api/staffing/rota/shifts` with `personId: "marc"` and the slot's fields (as `rota-view.test.ts:130-138`), and the menu closes.
  - `rota-by-person.test.ts`, `"Another shift… opens the shift editor for that person and day"`.
  - `rota-by-person.test.ts`, `"closes the open-slots menu when its week is published on another screen"`: as `rota-view.test.ts:219-234` — open Marc × Friday's menu, publish through the live read (`live.invalidate([{ type: "roster_versions" }])`), wait for `rota-open-slots` to be gone.
  - `rota-by-person.test.ts`, `"closes the open-slots menu when its last offered slot is filled on another screen, and keeps a menu that offered none"`: open Marc × Friday's menu (one slot, `empty`); the read now has `empty` filled; `live.invalidate([{ type: "shifts" }])` → `rota-open-slots` gone. Control: open Marc × Wednesday's menu (no open slot, only "Another shift…"); after the same refresh it is still open.
  - `rota-by-person.test.ts`, `"clicking another day while a menu is open opens that day's menu"`: `userEvent.click` Marc × Friday, then Ana × Thursday → the menu's heading is Ana's Thursday (the close-clears-its-own-pick rule, Decision 11).
  - `open-slots-menu.a11y.test.ts`: states own-and-other, none, busy, refusal; both themes; inside an open `rota-popup`.
  - `rota-view.a11y.test.ts`: an `"open-slots"` state.
- [ ] **Step 2: Changed test checks:**

  | Test (file:line) | Before | After |
  |---|---|---|
  | `rota-by-person.test.ts:118-132` "opens prefilled new shifts…" | `[data-test=add-shift]` in Ana × 2026-12-04 opens the editor with that day and person | `[data-test=day-add]` in Ana × 2026-12-04 opens the open-slots menu; its "Another shift…" opens the editor; `businessDay` "2026-12-04", `personId` "ana", `shiftId` undefined (same assertions) |
  | `rota-by-person.test.ts:140-144` | a published week has no `button[data-shift]` and no `[data-test=add-shift]` | no `button[data-shift]` and no `[data-test=day-add]` |
  | `rota-view.test.ts` (Task 2's no-area case) | no `[data-test=add-shift]` | no `[data-test=day-add]` |

- [ ] **Step 3: Run, watch fail, implement** Decisions 11–12 and 17 (Everyone half). The empty-part button is drawn in every editable Everyone cell while there is an active area, revealed as in Task 8.
- [ ] **Step 4: Run** the files above plus `rota-races.test.ts rota-planning.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): fill the rota from Everyone — a day's open slots, then Another shift (A763)`.

### Task 11: Empty weeks say why

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
  - `rota-view.test.ts`, `"an area with no paint this week says why and offers its season's painter and Show everyone"`: Kitchen with no slots on any day → the title and the season sentence with "Kitchen" and "Winter"; no staff-role rows; "Paint Winter's standard week" (`canWriteStaffing`) is `primary` and calls `open("staffing", { month: "2026-11", area: "station:kitchen", painter: "season", season: "winter" })`; "Show everyone" is `secondary` and calls `open("rota", { week: "2026-11-30", area: "everyone" })`; the bar reads "Nothing to fill" and Publish is quiet when there are no shifts.
  - `"…shifts it already has show beneath, marked not needed"`: Kitchen with no slots and one shift (over) → the message and, under it, the Sous chef row with that card reading "not needed".
  - `"…a week of special days offers the special day's editor"`; `"…without the Staffing view it offers no paint button"`; `"…a person who may only read Staffing gets Show {season}'s standard week"`.
  - `"Everyone with no shifts keeps everyone's rows with one line saying how to add one"`: `shifts: []` → the line above the grid, five `[data-person]` rows, the bar "No shifts yet", Publish quiet.
  - `"Everyone with no active area keeps No active areas in place of the hint"`: `areas: []`, `shifts: []` → the line reads "No active areas." and the no-shifts hint is absent (no add is possible, Decision 1).
  - `rota-view.a11y.test.ts`: states `"unpainted"` and `"everyone-empty"`.
- [ ] **Step 2: Changed test checks:** none expected. The `"empty"` a11y state (no active areas) is Task 2's form — Everyone with people listed and "No active areas." — and stays as Task 2 left it; run it.
- [ ] **Step 3: Run, watch fail, implement** Decision 18 and point 6. **Step 4: Run** `rota-view.test.ts rota-model.test.ts rota-view.a11y.test.ts index.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): an empty rota week says why and offers the painter (A763)`.

### Task 12: Phone — the `rota-day` element alone

**Files:** New `packages/staffing/src/dashboard/rota-day.ts` (`rota-day`: the phone's one day, area groups or person blocks), `rota-day.test.ts`, `rota-day.a11y.test.ts`, `strings.ts` if it needs a key. Nothing in `rota-view.ts` changes in this task.

**Interfaces:**
```ts
// <rota-day> .week .show .businessDay .breaches .editable
// sends the grids' events: pick-slot (with anchor), edit-shift, open-day (from a person's button)
focusTarget(target: Target): boolean;
```

- [ ] **Step 1: Failing tests** (`rota-day.test.ts`, mounted alone in a 390 px frame at `useViewport(390, 844)`):
  - For Kitchen on Tuesday: the role groups Head chef then Sous chef (only roles with a slot or shift that day), the filled card, the partly uncovered card, no group for a role without either; a dashed slot sends `pick-slot` with its anchor; a card sends `edit-shift`.
  - For Everyone on Friday: five person blocks in `peopleInOrder`, each a button with name, roles and hours that sends `open-day` with its anchor, then that day's cards.
  - A Closed day (Decision 8) reads "Closed" once.
  - `focusTarget` focuses a slot, a card, or (Everyone, unfilled) the day's heading.
  - Nothing is wider than 390 px (`scrollWidth` ≤ `clientWidth` on the element), measured after the read has drawn.
  - `rota-day.a11y.test.ts`: `"area"`, `"everyone"`, `"closed day"`, `"published"`, both themes.
- [ ] **Step 2: Changed test checks:** none (new files only).
- [ ] **Step 3: Run, watch fail, implement** Decision 16. **Step 4: Run** `rota-day.test.ts rota-day.a11y.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): the rota's one-day element for phones (A763)`.

### Task 13: Phone — the view switches to one day, with the strip and the foot action; test frames sized

**Files:**
- Modify `rota-view.ts` (narrow measurement, Decision 14; the strip; the shown day, Decision 15 without the swipe; the plain title on a phone, Decision 4; the foot bar, Decision 19; count steps choose the day first), `strings.ts`.
- Modify the unsized test mounts (Decision 14), setup only: `rota-planning.test.ts:78-81` (the frame `f`), `rota-races.test.ts:75-78` (the `frame`), `rota-view.a11y.test.ts` (the wide states set `host.style.width = "1280px"` after `mountThemed`), `index.test.ts:308-337` (each `container`).
- Tests: `rota-view.test.ts`, `rota-by-person.test.ts`, `rota-view.a11y.test.ts`, and the files above.

**Interfaces:**
```ts
// rota-view.ts
export const PHONE_WIDTH = 560; // the Calendar Week's (opening-hours-week.ts:40)
@state() narrow = false;
@state() private day = "";       // the phone's shown business day
```
Strings: `staffing.rota.days` "Days" / "Días" (the strip's label); `staffing.rota.needs_attention` "needs attention" / "requiere atención".

- [ ] **Step 1: Failing tests:**
  - `rota-view.test.ts`, `"below 560 px it draws one day: the strip, Show, the bar's words, the day, and the action at the foot"`: `useViewport(390, 844)`, a 390 px frame; wait for `rota-day`; no `rota-by-area`; the strip has seven buttons, Friday marked (`data-attention`, name contains "needs attention"), Monday muted; the title is plain text (no `button` in `[data-test=week]`, and its computed `text-decoration-line` is `none`); Publish is the last child, full width, its bottom at the view's bottom when scrolled (sticky); nothing is wider than 390 px (`scrollWidth` ≤ `clientWidth` on the view).
  - `"a strip button shows its day; the week arrows step a week and keep the weekday"`: pick Thursday → `rota-day.businessDay` 2026-12-03; next week → `open("rota", { week: "2026-12-07", area })` and, once the host sets `week`, Thursday 2026-12-10 shown.
  - `"the shown day starts on the venue's today when it is in the week, else Monday"`: with `vi.useFakeTimers({ toFake: ["Date"] })` only around the mount (real timers otherwise), the clock at `2026-12-03T23:30:00Z` — Friday 00:30 in the read's `Europe/Madrid`, Thursday in UTC — shows Friday 2026-12-04; a clock in another week shows Monday. The failing case (the browser's clock or UTC) would show Thursday.
  - `"on a phone a count shows the target's day before focusing it"`; and in Everyone the unfilled count selects the next day with unfilled slots and focuses its strip button (Decision 7).
  - `"growing past 560 px goes back to the week grid"` (resize the frame).
  - `rota-view.a11y.test.ts`: `"phone area"`, `"phone everyone"`, `"phone closed day"`, both themes, at `useViewport(390, 844)`.
- [ ] **Step 2: Changed test checks:**

  | Test (file:line) | Before | After |
  |---|---|---|
  | `rota-view.test.ts:205-215` (`390px` case) | `rota-by-area`'s scroller fits the page and may scroll | at 390, `rota-day` is drawn and nothing in the view is wider than 390 px (`scrollWidth` ≤ `clientWidth`); the 900 and 1280 cases unchanged |
  | `rota-view.test.ts:23-38` (mount, waits for `rota-by-area` at `:36`) and the 390 px case at `:205-215` | the mount waits for `rota-by-area` at every width | the mount waits for `rota-day` when the width is below 560 px, else `rota-by-area` (setup); the 390 px case's own assertions unchanged |
  | `rota-by-person.test.ts:22-49` (mount) and `:145-152` (`390px` case) | the mount waits for `rota-by-person` at every width; `rota-by-person` fits at 390 | the mount waits for `rota-day` when the width is below 560 px, else `rota-by-person` (setup); at 390, Everyone's `rota-day` fits within 390 px; the 1280 case unchanged |
  | `rota-planning.test.ts:78-81` | the frame has no width (414 px in Vitest's default window) | `f.style.width = "1280px"` (setup only; every check unchanged) |
  | `rota-races.test.ts:75-78` | the frame has no width | `frame.style.width = "1280px"` (setup only) |
  | `rota-view.a11y.test.ts:15-41` | the wide states run in the unsized `host` | the wide states set `host.style.width = "1280px"` (setup only); the phone states are new |
  | `index.test.ts:308-337` | each `container` has no width | `container.style.width = "1280px"` (setup only; Task 2's checks unchanged) |

  Run without change, and report if any fails: `index.test.ts:255-305` (asserts only the requests, which a phone makes too), `apps/dashboard/src/dashboard-app.search-modules.test.ts:172-211` (after Task 2 it reads only the Show menu's value and the path; the phone draws Show too, board 5), `apps/dashboard/src/dashboard-app.test.ts:1635-1681` (asserts only that `staffing-rota` mounts). If one of them fails because it now draws the phone, size its frame as above and add it to the table.
- [ ] **Step 3: Run, watch fail, implement.** Measure the width on connect, as the Week does (`opening-hours-week.ts:545-555`), so a phone's first paint is already its day.
- [ ] **Step 4: Run** `rota-day.test.ts rota-view.test.ts rota-by-person.test.ts rota-view.a11y.test.ts rota-planning.test.ts rota-races.test.ts index.test.ts`, plus `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.search-modules.test.ts src/dashboard-app.test.ts -t "rota|Rota|search"`; typecheck, lint, prettier. **Commit** `feat(staffing): the rota on a phone — one day at a time with the week's strip (A763)`.

### Task 14: Phone — a swipe steps a day

**Files:** `rota-view.ts` (or `rota-day.ts`, wherever the day's body is drawn: the swipe, Decision 15), `packages/staffing/vitest.config.ts` (the browser project's `commands` gains `...pointerGestureCommands` from `@waitron/ui/src/vitest-pointer-gestures.js`, as `packages/venue-service/vitest.config.ts:4`, `:42`), new `packages/staffing/src/dashboard/pointer-gestures.d.ts` (a copy of venue-service's, typing the commands). Tests: `rota-view.test.ts` (or a new `rota-view.swipe.test.ts`).

- [ ] **Step 1: Failing tests** (at `useViewport(390, 844)`, a 390 px frame, using `commands.touchGesture` as `opening-hours-week.test.ts:988-994` does, and `await commands.parkTouch()` after each test as `:22` does — `scripts/park-pointer-registered.test.ts` requires both the config spread and a `parkTouch` call in any file that calls `touchGesture`):
  - `"a swipe left shows the next day and a swipe right the day before"`: Tuesday shown; `touchGesture({ at: "staffing-rota rota-day", moveBy: { x: -150, y: 0 } })` → Wednesday; `{ x: 150 }` → Tuesday.
  - `"a swipe past Sunday opens the next week on its Monday"`: Sunday shown; swipe left → `open("rota", { week: "2026-12-07", area })`, and once the host sets `week`, Monday 2026-12-07 shown. And past Monday the previous week on its Sunday.
  - `"a short, slanted or mouse move steps nothing"`: `{ x: -30, y: 0 }`, `{ x: -60, y: -50 }` and `commands.mouseDrag` across the day change nothing (as `opening-hours-week.test.ts:1011-1031`).
  - `"a second finger cancels the swipe"`: synthetic `PointerEvent`s of two touch pointers, as `fingersOn` at `opening-hours-week.test.ts:1032-1048` sends them → nothing steps.
- [ ] **Step 2: Changed test checks:** none.
- [ ] **Step 3: Run, watch fail, implement** the swipe as Decision 15 describes, with `touch-action: pan-y` on the swiped box and a `SWIPE_PX = 48` constant whose comment names `opening-hours-week.ts:42`. Run `pnpm exec vitest run scripts/park-pointer-registered.test.ts` (root project).
- [ ] **Step 4: Run** the swipe tests and `rota-view.test.ts`; typecheck, lint, prettier. **Commit** `feat(staffing): swipe between days of the rota on a phone (A763)`.

### Task 15: Phone — the picker and the open-slots menu as sheets

**Files:** `rota-popup.ts` (sheet mode), `rota-view.ts` (sets `sheet` when narrow), `slot-picker.ts` and `open-slots-menu.ts` (Cancel in a sheet). Tests: `rota-popup.test.ts`, `rota-popup.a11y.test.ts`, `rota-view.test.ts`.

- [ ] **Step 1: Failing tests:**
  - `rota-popup.test.ts`, `"as a sheet it sits at the bottom of the window at full width, scrolls within 70% of its height, and dims the page"`: `useViewport(390, 844)`, content taller than the window (a list of 40 rows, so the cap is reached whatever the font); after it renders: its left 0, width 390, bottom 844 (±1 px), height ≤ 591 (70% of 844 is 590.8) and `overflow-y` auto; `::backdrop` background is not transparent (`getComputedStyle(popup, "::backdrop")`); a scroll of the page does not move it.
  - `"a sheet's Cancel closes it and returns focus to what opened it"`.
  - `rota-view.test.ts`, `"on a phone a slot's picker and a person's open slots open as sheets"`: `useViewport(390, 844)`; tap a dashed slot → sheet with the picker heading "Fri 4 Dec · Sous chef · 09:00–17:00" (today's heading, `slot-picker.ts:114-117`), "Show everyone" and Cancel; Everyone: tap a person → the open-slots sheet; choosing a slot fills it as on a wide screen.
  - `rota-popup.a11y.test.ts`: a `"sheet"` state, both themes.
- [ ] **Step 2: Changed test checks:** none expected.
- [ ] **Step 3: Run, watch fail, implement** Decision 11's sheet. **Step 4: Run** the files above plus `slot-picker.test.ts open-slots-menu.test.ts`; then the whole browser project once: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/staffing exec vitest run --project browser`, and `pnpm --filter @waitron/staffing test:coverage` to read the per-file rows of every changed file against `98/98/98/95`. Typecheck, lint, prettier. **Commit** `feat(staffing): the rota's picker and open slots as sheets on a phone (A763)`.

### Task 16: LOOK (the driver, not an implementer)

- [ ] Check `wa-wt ls` and `memory_pressure | grep free`. Run `wa-wt demo waitron-feat-a763-rota-redesign`; record its process group in the ledger so you stop only what you started.
- [ ] In the demo venue, prepare: a season with staffing paint for one area and none for another; a weekday with no hours; a special day in one week; a draft week with unfilled, partly uncovered and over slots; a published week; a changed published week with an open swap. Add staff roles, people and contracts if the demo lacks them.
- [ ] Screenshots with the workspace's Playwright Chromium; script in `~/waitron-campaign-b/a763-look-dir/`, images in `~/waitron-campaign-b/a763-shots/`. Light and dark, 1280×900 and 390×844, English; Spanish at 1280 light and 390 light. States: one area (board 1) with the picker open; Everyone (board 2) with the open-slots menu open and one empty part focused; an unpainted area and Everyone with no shifts (board 3); the five bar states (board 4); the phone day for an area and for Everyone, and the picker sheet (board 5).
- [ ] Compare each with its board and write down for each: the bar is one row at 1280 and nothing in it wraps; the title's width does not change between two weeks; the picker sits beside its slot, stays inside the window near the right edge, and moves with its slot when the grid scrolls; "+ Add shift" appears only on hover or focus; Closed reads once, in the header; at 390 nothing is wider than the window, the title is plain text and Publish sits at the foot; a swipe on the phone day steps a day (Chromium's device emulation); Spanish fits.
- [ ] Stop the stack with `wa-wt down <name>`.

### Task 17: Docs (the driver)

**Files:** `docs/backlog.md`, `docs/backlog/workforce.md`, `docs/developers/design-system.md`, `docs/superpowers/specs/2026-10-13-a585-staffing-and-rota-design.md`.

- [ ] **Backlog.** Delete the A763 entry in `docs/backlog.md` (lines 4234-4239) and the `## A763.` section in `docs/backlog/workforce.md` (`:137-190`, up to `## A699.` at `:191`). Add in their place, in the same area, a short entry for point 9, with its detail section in `workforce.md`:
  - `docs/backlog.md`: "**A763 point 9. The Staffing month's Monday "Rota for this week" link goes, and the Rota tab opens the week last picked (owner, 2026-10-16).** Waits for lane F's A724 Part 2. Monday's box becomes the height of the others; the day box's Rota for this week states where that week's rota stands. [Detail](…), [mockup](backlog/mockups/a763-rota/06-staffing-month.png)."
  - `workforce.md`: the spec's point 9 quoted in full, the `rota-week` button's place (`staffing-month.ts:600`), and the board 6 link.
  - Add to A699's entry in `workforce.md` (`:191-202`) the copies this branch made of venue-service code outside its `exports` map: `weekTitleParts` in `packages/staffing/src/dashboard/format.ts` (of `formatWeekTitleParts`, `hours-view.ts`); `rota-popup.ts`'s follow-and-close logic with `flatParent` and `scrollTargets` (of `calendar-day-box.ts` and `flat-tree.ts`); the rota's swipe and `SWIPE_PX` (of `opening-hours-week.ts`); and `PHONE_WIDTH`.
  - Update the "Decisions and deliberate limits → A585. Staff roles and rota planning" entry in `workforce.md` (`:231-237`): "Plan shifts in Calendar → Rota, by area or by person" becomes "for one area or for everyone (A763, 2026-10-17)", and add the deliberate limit: "In one area the rota no longer shows a person's weekly labour warning, which has no cell there; the bar's labour count and the publish dialog still include it, and Everyone shows it under the name (A763, 2026-10-17)." Also record Decision 8's choice: "'Closed' in a rota day's header means no active department opens that day, whichever area is shown (A763)."
  - Check: `/usr/bin/grep -rn "A763\|a763" docs/backlog.md docs/backlog/` prints only the point 9 entry, its detail, the A699 and A585 lines and the mock-up folder links.
- [ ] **A585 spec.** Its 2026-10-16 pointer (`:3-5`) links to the backlog section this task deletes. Replace that link with one to this plan, and add above it a dated pointer: "> 2026-10-17: A763 points 1–8 are built (see the [plan](../plans/2026-10-17-a763-rota-redesign.md)); point 9 waits for A724 Part 2." Do not rewrite the spec's body.
- [ ] **design-system.md.** Rewrite the Rota view paragraphs (`:4062-4081`): the address (`/view/rota/week/<monday>[/area/<area>|/area/everyone]`); Show, and Everyone with no active area; the bar and its states (Decisions 5–7, 19–21); the title's month links and fixed width, and the plain phone title; the area grid (rows only when used, Fill, "+ Add shift" on hover or focus); Everyone (row order, cards, the empty part's open-slots menu, Another shift…); the picker beside its slot, following it; Closed and the headers (venue-wide); the empty-week messages; the phone's one day, strip, swipe, sheets and foot action. Remove the people panel and By person sentences. Keep "Every day's box ends with Rota for this week" (`:4054`), which point 9 has not changed. Run `pnpm exec prettier --file-info docs/developers/design-system.md` (expect `"ignored": true`).
- [ ] Commit `docs: A763 points 1–8 done — the Rota view redesigned; point 9 left open`.

### After the tasks

The driver runs `/finish-branch` with the worktree path, on the FULL path (Tasks 1 and 7). The PR body carries: the server change (Task 1, and Task 7's removed field) in its first lines; the merged "Changed test checks" table, with Task 6's weekly-warning row called out; Decisions 1, 2, 7, 8, 10, 11, 15 and 18 with their reasons; the LOOK findings. After the first push the driver reads the staffing test shards' times against the ~4-minute target (Global constraints → CI time).

---

## Review focus

1. **Task 1's `hasHours`** must match what the Calendar shows as a day with no hours, including a special day closed all day and a special day that adds hours on a weekday the season has none. Check `resolveDepartmentsDays` is given the day plan `readRotaWeek` already read (no second read of special days), the seasons are read once and handed to `readDayPlan`, and only active departments count.
2. **The popup's light dismiss during a fill and across picks.** A click outside while a fill is in flight closes the popup; the write still lands; a refusal then shows under the bar, not lost (Decision 11). A click on a second slot leaves the second slot's picker open. Check focus returns to the slot, not the page body.
3. **The popup follows its anchor** (Decision 11): it re-places on a sideways scroll of the grid and closes once its slot leaves the window; a sheet does not follow.
4. **Step buttons** (Decision 7): in Everyone the unfilled count focuses day headers and never switches Show; on a phone a step shows the target's day first.
5. **Publish's state** (Decision 19): quiet and disabled with no shifts or no version, quiet while warnings load, loud otherwise; "Publish changes" only on a changed published week; the existing guards in `#publish` (`rota-view.ts:269-276`) unchanged.
6. **The weekly warning in an area** (Task 6's changed check): the only place a check narrows. Confirm the bar's labour count and the publish dialog still include it.
7. **Phone width** measured on the rota's own width, not the window's, so a narrow Calendar column on a wide window also gets the day view; the first paint at 390 is already the day view; every test mount that is meant to be wide is sized.
8. **Strings:** every new key in both languages, `_one` forms where a count reads differently at 1; no retired key still read (`grep -rn "staffing.rota.<key>" packages/staffing/src`).
