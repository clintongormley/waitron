# A722 — a Week view in the Calendar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** Add the Calendar's Week: one real week of opening hours (holidays, special days and closed
days included), opened from the day box's "Open this week", one day at a time on a phone, and a
Show picker that also lists prep stations, in the Week and in the Month.

**Architecture:** The Calendar is one screen, `dashboard-opening-hours-screen`
(`packages/venue-service/src/dashboard/opening-hours-screen.ts`), which reads the address and draws
the Year (`opening-hours-year.ts`), the Month (`opening-hours-month.ts`) or a painter over one of
them. The work adds a third view, `opening-hours-week` (`opening-hours-week.ts`), drawn from the
month read the Month already uses: `readOpeningHoursMonth` returns "the whole Monday-to-Sunday
weeks that cover `month`" (`packages/venue-service/src/opening-hours-calendar.ts:110`), so the read
of the month holding a week's Monday holds the whole week, a week across two months or two years
included. The rows come from a pure helper (`week-rows.ts`) built on `zoneOwnHours`
(`packages/venue-service/src/zone-own-hours.ts`). The day box (`calendar-day-box.ts`) gains "Open
this week". Prep stations in Show reuse the read the Times tab already makes
(`watchStationTimes`, `opening-hours-client.ts:143-170`, over
`GET /management-api/venue-service/stations/:stationId/service-times`, `routes.ts:419-431`), whose
server side is `readPlannedServiceGuides` (`planned-service-guides.ts`) — the same reading as the
staffing painters' prep-station guides (`packages/staffing/src/paint.ts:276`, `:351`).

**Tech Stack:** TypeScript, Lit, the shared `wt-*` primitives, Vitest in real headless Chromium
(the `browser` project of `packages/venue-service/vitest.config.ts` runs everything under
`src/dashboard/`).

**Spec** (quoted, never paraphrased, wherever a task needs a value):
- The A722 entry in `docs/backlog.md` ("Service periods, opening hours and departments", `:1423-1425`).
- "## A722. A Week view in the Calendar" in `docs/backlog/service-periods.md` (`:234-261`).
- That file's "Decisions and deliberate limits" entries naming A722/A759 (`:347-354`).
- Mockups `docs/backlog/mockups/a718-a727-calendar-and-stations/04-week-view.png` and
  `05-week-view-phone.png` (and `03-month-view.png`: where "Open this week" sits in the box, and its
  note 3, "A closed department or zone is just an empty grey track"). Both Week boards predate A759:
  their Year | Month | Week switch, and board 4's note 4 ("Which week the Week button opens"), are
  superseded by spec point 3 — there is no Week button. Look at the pictures before starting any
  task.

Background plans: `docs/superpowers/plans/2026-10-15-a720-calendar-year-month.md` (the Year, the
Month, the day box, `zoneOwnHours`, test style). A759 landed as #1812 (`f294fa18e`) with no plan file
in `docs/superpowers/plans/`; its commit message records the fixed-width title
(`fixed-title.ts`) and the Month's year link. Line numbers below are against `main` at `82e8a9127`;
later parts find each place by the function or selector named beside it.

**Migration: no, in every part.** No table, column or stored value changes. Every part draws from
reads that already exist (the month read, the station-times read, and `GET /management-api/stations`,
`apps/server/src/management-api.ts:1768-1775`). No route, no server code, no schema.

---

## How the work is cut

Three pull requests. Each leaves `main` green and the Calendar fully usable.

| Part | Branch | What it delivers | Spec points | Tasks | Can start |
| ---- | ------ | ---------------- | ----------- | ----- | --------- |
| 1 | `feat/a722-1-week-view` | The Week at its address, drawn at desktop width; full label on a sliver; day names open the day box; the box's "Open this week"; the Week in page search | 1, 2, 3, 5 | 9 | Now |
| 2 | `feat/a722-2-week-phone` | One day at a time below 560 px: rows as words over a thin bar, ‹ › and a swipe step a day | 4 | 4 | After Part 1 |
| 3 | `feat/a722-3-show-stations` | Show lists prep stations in the Week and the Month, to whoever may open the Times tab today; a station draws one row per department that sends it dishes | 6 | 7 | After Part 2 (same files) |

Part 3 is last because lane F's A725 waits for it (Global constraints, "Lane F"). If that wait
matters more than the phone layout, Parts 2 and 3 can swap; the station view must then also cover
the phone layout when Part 2 lands, and the lane F note moves with Part 3 wherever it lands.

### Decisions this plan makes (sent to the owner as an FYI with these defaults; any may be overruled)

1. **The Week's address is `/manage/opening-hours/view/week[/department/<id>][/week/<yyyy-mm-dd>]`**
   (Part 3 adds `/station/<id>`). `view/week` stops meaning the season painter and means the Week.
   Why: spec "A727 deliberately keeps `/view/week` out of search **while it still means** the old
   season painter" anticipates the word changing hands; the Calendar's other views read
   `view/year/year/<yyyy>` and `view/month/month/<yyyy-mm>`, and Staffing's Rota reads
   `week/<monday>`; nothing in the product writes a `view/week` address today (`git grep -n
   "view/week"` finds only tests); and CLAUDE.md §3 "No backwards-compatibility or data-migration
   code until Waitron is in production". **The painter is not broken:** its own addresses
   (`/view/season/…`, `/view/special-day/…`) are untouched, an address with no view naming a
   season, department, zone or `?station=` still opens it (`namesWeek`,
   `opening-hours-screen.ts:494-499`), and so does an unknown view word. What changes is that an old
   `view/week/…` bookmark opens the Week instead of the painter. Alternative if the owner refuses:
   a new view word (`view/days`), which changes no existing test but leaves `week` a dead word.
2. **The `week` pair holds the shown date, not a Monday.** At desktop width the Week shows the
   Monday-to-Sunday week holding it; on a phone (Part 2) it shows that day. So "Open this week" on
   16 October writes `week/2026-10-16`, a phone's ‹ › change it by one day, a desktop's by seven,
   and resizing a window keeps the same address. A value is out of range when its week's Monday
   falls in a month the month read does not serve (before `FIRST_MONTH` "0100-02" or after
   `LAST_MONTH` "9998-12", `opening-hours-month.ts:46-47`). A missing, malformed or out-of-range
   value shows the week (or day) holding the venue's business date, else the browser's date, and the
   address is left as written — as a bad month already is (`parseCalendarMonth(this.url.read("month"))
   ?? ""`, `opening-hours-screen.ts:320`, then `shownMonth()` falls back to today's month).
3. **The title links back:** each month name and each year in "12 – 18 Oct 2026" is a link button,
   so "28 Sept – 4 Oct 2026" offers September and October, and "28 Dec 2026 – 3 Jan 2027" offers
   both months and both years. A month opens that Month, a year that Year. The title's parts come
   from `Intl.DateTimeFormat.formatRangeToParts` through `hours-view.ts`'s own `dateFormat` locale
   mapping (`:14-19`: "en" becomes en-GB, "es" es-ES — raw "en" would give "Oct 12 – 18, 2026"); each
   month and year part's `source` says whether it belongs to the week's first day, its last, or both
   ("shared", as in a one-month week). Pressing a link while the day box is open closes the box,
   which does not come back over the Month or the Year.
4. **A label in full on pointing or tapping (point 2) is shown for every block**, not only the
   clipped ones: telling which are clipped would need measuring text, and a fitting label shown
   again in full says nothing wrong. It is one small box (a native `popover="manual"`), hidden from
   screen readers because every row's whole text is already read out (Decision 6). As board 4
   draws it, the box sits **above** the block, and below it only when there is no room above.
   `placePopover` (`paint-grid-parts.ts:104-124`) cannot do that — it places below and flips above
   only when below does not fit — so the Week places the tip with its own small function, keeping
   the same rule: show and place in one call. States: pointing shows the tip; a click (a tap
   included) pins it; a click on the pinned block unpins and hides it; leaving the block or the tip
   hides only an unpinned tip; a click elsewhere, Escape (caught on `window` in the capture phase,
   going no further) and a scroll hide and unpin it. (Added in review: the unpinned hide waits
   `TIP_LEAVE_DELAY`, and a change of the Week's size also hides and unpins it.)
5. **Tracks and ruler share one scale: the longest day in the week.** Every block is placed on its
   own business day (`placeOnDay`, that day's own `dayCutover`), at `start / longest` and
   `(end − start) / longest` of the track, where `longest` is the largest `endMinute` of the seven
   days; a shorter day's track ends early. The ruler runs from Monday's changeover, a label every
   two hours, to `longest` minutes, so on a week holding a 25-hour day the ruler and the bars agree.
   Left as a deliberate limit: a week whose days have *different changeovers* (a scheduled
   business-day change) labels the ruler from Monday's.
6. **What a screen reader hears:** each row has a visually hidden line with its whole text — the
   day box's words for that row ("Terrace: Breakfast 08:00–11:00 · Lunch 13:00–16:00 · Dinner
   22:00–23:00 · closed 20:00–22:00", "Front Bar: as Santet Deli Co") — and the drawn track is
   `aria-hidden`. Blocks are not focus stops (a week would have well over a hundred). The day's
   name is the one button per day.
7. **No painting and no long press in the Week.** Board 5's note "Long-press the day to make it a
   special day" is not in the spec, and spec point 5 says "No painting here". A day's name opens
   the day box, whose "Make a special day" is one press further.
8. **"Open this week" is offered in the Year's and the Month's box, to a viewer too** (it changes
   nothing), last after the box's other buttons, as board 3 draws it; it is not offered in a box
   opened from the Week. After it, focus goes to that date's name in the Week when the box held
   focus.
9. **The Week holds no staged input**, so it takes no draft scope and has no `*.unsaved.test.ts`
   (CLAUDE.md §3). A painter opened from its day box keeps its own scope and closes back onto the
   Week's address.
10. **A station shown in Show (Part 3):** one row per department that sends it dishes on any date of
    the read, named by the department — even when only one does (spec: "one row per department
    that sends it dishes"; the Times tab names a lone row after the station and keeps doing so). A
    date none sends on reads "No orders" once; the default station (the read's `always: "default"`,
    `station-service-times.ts:45`, as the Times tab reads it at `station-times-tab.ts:246`) reads
    "Always open: this is the default station" (`prep.always_open_default`) instead of the grid. The
    day box keeps listing every department's opening hours (the box is about the day; the station
    is a way of looking at the grid). A failed station list leaves Show offering departments only,
    with no alert; a failed station-times read shows `prep.times.load_error` above the view. A
    station id the list does not hold is never read.
11. **The phone layout starts below 560 px of the Week's own width**, the Month's breakpoint
    (`@container month (width < 560px)`, `opening-hours-month.ts:275`), read with a
    `ResizeObserver` because the layout changes what is drawn and what ‹ › do, not only how it looks.
12. **Who sees prep stations in Show: today's exposure, no wider.** The Times tab lives on the Prep
    stations screen, which needs `venue_service.manage` and has no read permission
    (`packages/venue-service/src/dashboard/index.ts:63-69`; the app opens a screen to its write or
    read permission, `apps/dashboard/src/dashboard-app.ts:1433-1437`). The Calendar opens to
    `venue.view` too, and is drawn read-only exactly when the person lacks `venue_service.manage`
    (`dashboard-app.ts:2426`). Supervisors hold `venue.view` (`packages/identity/src/permissions.ts:46-55`)
    but not `venue_service.manage`. So **a read-only Calendar offers no stations in Show, reads no
    station list and no station times, and ignores a `station` pair in its address.** Whether a
    supervisor should get a read-only station view is the owner's open question (`docs/backlog.md`,
    "Supervisors have no dashboard path to a prep station's times"; `docs/backlog/kitchen.md:152-154`,
    "who may open the Calendar's station view"); this plan does not answer it, and Task 3.5 rewrites
    both notes to say where it now stands.

---

## Global constraints

- **Worktree per part:** `python3 ~/workspace/tools/worktree.py new waitron <branch> --headless`
  (Part 1 may use this plan's worktree, `waitron-feat-a722-calendar-week-view`, whose branch is
  `feat/a722-calendar-week-view`). Every commit `git commit -s`.
- **Test first.** Each task writes its failing test, runs it, sees it fail for the stated reason,
  then writes the code.
- **Task size.** Each task is meant to finish well under 100 tool calls. An implementer past about
  150 with its task unfinished stops at a passing or cleanly red point, commits, and hands over:
  done, left, files, each check's state.
- **Focused runs** (check `memory_pressure | grep free` first; beside another session's browser run
  only when free memory is well above 15%):

  ```bash
  pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/<file>.test.ts
  ```

  Read the `Tests` count; a run without one proves nothing. "The screen test files" means
  `opening-hours-screen.test.ts`, `opening-hours-screen.painter.test.ts`,
  `opening-hours-screen.special-day.test.ts`, `opening-hours-screen.unsaved.test.ts`,
  `opening-hours-screen.a11y.test.ts` and (from Task 1.4a) `opening-hours-screen.week.test.ts`.
  Each part ends with `pnpm --filter @waitron/venue-service test:coverage` while new files chase
  the 98/98/98/95 bar; CI owns the package suites.
- **Every implementer dispatch** also runs `pnpm format:check`, and `pnpm --filter <pkg> typecheck`
  and `lint` for each package it touched.
- **Changing an existing test check** needs the spec to have changed what it checks; each task lists
  the checks it changes and why ("Existing checks that change"). A check not listed is not touched.
  Mock and setup changes are allowed and listed too; assertions after them stay word for word.
- **Strings:** every new string goes in `en` and `es` in `packages/venue-service/src/dashboard/strings.ts`
  (the Spanish table is typed `Record<keyof typeof en, string>`, so a missing one fails the
  typecheck). Product text as short as the meaning allows.
- **CLAUDE.md §3/§4 rules that apply here:**
  - Tokens only: every colour, spacing, radius and font reads a `--wt-*` token; no hex, no `rem`/`em`
    (`scripts/style-token-names.test.ts`). Period colours come from `periodColourStyles`
    (`--period-fill`, `--period-on-fill`, `period-colour-styles.ts`); closed time is `closedHatch`;
    a faded zone piece is `opacity: var(--wt-opacity-disabled)`; the tooltip reads
    `--wt-color-text` on `--wt-color-bg`, as `.icon-tooltip` does (`packages/ui/src/icon-button.ts:50-63`).
  - No native form field: Show is a `wt-combobox`, ‹ › are `wt-button`s; the title's links are plain
    `<button>`s styled as links, as the Month's year link is (`opening-hours-month.ts:96-109`).
  - Events: app-owned, named plainly, `{ bubbles: true, composed: true }`, payload in `detail`; the
    screen's listener calls `event.stopPropagation()` first, as `month()` does
    (`opening-hours-screen.ts:1177-1202`).
  - A click whose outcome depends on update order (a day box button, a day's name, a block) is
    tested with `userEvent.click`, not `element.click()`; a touch tap with
    `commands.touchGesture({ at })`, as `day-picking.test.ts` does.
  - A popover is placed before its first paint: show and place in the same call, never from `toggle`.
  - A history assertion spies on `history.pushState`/`replaceState` (`pushedPaths()`,
    `opening-hours-screen.painter.test.ts:115`), never `history.length`.
  - A close is waited for by its event (`calendar-day-box-close`, `painter-close`), never a bare timer.
  - A width is set with `page.viewport(w, h)` and `window.innerWidth` is read and asserted.
  - A test that sets Spanish restores the language in `finally`.
  - A placement check waits for the content that sizes the box and leaves room for CI's larger
    fonts on the side it expects the box (testing-guide.md, "A placement check measures a box at its
    final size").
  - Automatic reads are passive; a new live read declares its tables in `QUERY_DEPENDENCIES`
    (`live-queries.ts`, guarded by `scripts/live-subscriptions.test.ts`).
- **Review path: FULL for every part** (the queue sets it). Per-task reviews, then `/finish-branch`
  with the Codex run-it seat twice on each part (the second told to set this plan aside and test
  what it does not name). Part 3 also changes who sees what in the Calendar (Decision 12), which is
  a permissions trigger in its own right.
- **LOOK, every part** (testing-guide.md, "A page asserted as a STRING…"). Start the dev stack from
  the part's worktree with `wa-wt demo <worktree-name>` (never a bare `pnpm dev*`; `lsof` the venue
  folder and port 8080 before any `wa-wt reset`). Open the pages each part names with the
  workspace's Playwright Chromium at 390 px and 1280 px wide, light and dark: set `data-theme` on
  `document.documentElement`, record `window.innerWidth` and the computed background of the page
  and of the Week's card, and reject a capture whose light and dark colours are the same. Save
  pictures outside the repository or under an ignored `__screenshots__/look/` folder. If the demo
  venue lacks a case the part draws (a zone closed past its department's close, a special day, a
  public holiday, a sliver of under an hour, a station two departments feed), paint it in the
  dashboard first and say so in the PR.
- **Ledger:** `docs/handoffs/2026-10-17-a722-calendar-week.md` (gitignored), opening
  `Status: in progress`; update it at the end of every task; `Status: done` when Part 3 lands.
- **Backlog, per part, in the same pull request:** Parts 1 and 2 leave the A722 entry, rewriting its
  last sentence to name what remains ("Points 1–3 and 5 landed in #NNNN; 4 and 6 remain."), and
  delete their own points' paragraphs from the detail section, keeping the other points' numbers.
  Each part also rewrites, in the same change, every other backlog line that cites a point it
  deletes (named in its docs task). Part 3 deletes the entry and the section (Task 3.5).
- **Lane F.** When Part 3 has merged, append to `~/waitron-campaign-f/questions.md` a section headed
  `## A722 Part 3 (#NNNN) landed — FYI for A725, no answer needed`, saying in plain words that the
  Calendar's Show picker now lists prep stations in the Week and the Month (one row per department
  that sends the station dishes, from each period's start to last orders), to the same people who
  may open the Times tab today, so A725 point 2 can retire the Times tab; that the supervisor
  question stays the owner's; and naming the merge commit.

## Review Focus

Inputs the spec implies that no point names, most likely to bite first; each has its test in the
task named.

1. **A week across two months or two years** (28 Sept – 4 Oct; 28 Dec 2026 – 3 Jan 2027): one read
   draws all seven days, the title offers both months (and years), ‹ › cross over, and the year
   link hands focus to a month of the pressed year. Tests in Tasks 1.1, 1.2c, 1.4a and 1.4b.
2. **A zone closed past its department's close, or for the department's whole day**: the zone row
   shows only the closed time inside the department's hours; a whole-day zone closure is an empty
   grey track with no text, as the Month draws it (`opening-hours-month.ts:373`, `:464-487`), while
   its words (and the day box) say "Closed". Task 1.1.
3. **A 25-hour day** (the October clock change) inside the shown week: its bars run to the end of
   its 25 hours, and the ruler agrees with them (Decision 5). Tasks 1.1 and 1.2b.
4. **A bad or out-of-range `week` value** (`2026-13-40`, `abc`, `0099-12-28`): the week holding today
   is shown and nothing is rewritten; ‹ is disabled at the first week the month read serves.
   Tasks 1.2b and 1.4a.
5. **A department in the address the read does not carry** (deleted or made inactive): the Week
   shows All departments, as the Month does (`#chosen`, `opening-hours-month.ts:347-351`); the same
   for a station id no active station has, and for any station on a read-only Calendar (Part 3).
   Tasks 1.2b, 1.4a and 3.4a.

---

# Part 1 — the Week, at desktop width (points 1, 2, 3, 5)

Branch `feat/a722-1-week-view`.

**Today:** `followUrl` (`opening-hours-screen.ts:216-321`) shows the Year for `view/year`, `view/calendar`
or no view, the Month for `view/month`, and replaces every other address with the season
painter's (`:303-312`), `view/week` among them. The day box (`dayBoxTemplate`, `:1055-1108`) offers
"Make a special day"/"Edit special day" and "Edit/Show {season}'s standard week". Search declares
Year, Month and Seasons (`packages/venue-service/src/dashboard/index.ts:24-48`).

### Task 1.1: The week's rows, worked out (`week-rows.ts`)

**Files:**
- Create: `packages/venue-service/src/dashboard/week-rows.ts`, `week-rows.test.ts`
- Modify: `packages/venue-service/src/dashboard/hours-view.ts` (two formatters),
  `opening-hours-day.ts` (export the row-words helper, if you share code that way), `strings.ts`

**Interfaces — produces:**

```ts
// week-rows.ts
type Day = OpeningHoursMonth["days"][number];
/** Monday to Sunday of the week holding `date`. */
export function weekDates(date: LocalDate): LocalDate[];
/** The `YYYY-MM` of that week's Monday: the month read that holds the whole week. */
export function weekMonth(date: LocalDate): string;
/** The week's seven days from `model`, or undefined when the read does not hold all seven. */
export function weekDays(model: OpeningHoursMonth, date: LocalDate): Day[] | undefined;
export interface WeekBlock {
  kind: "open" | "closed";
  periodId: string | null;          // null for a closed piece
  start: number; end: number;       // minutes after the day's changeover, as placeOnDay gives
  startsAt: string; endsAt: string; // "HH:MM" as written
  text: string;                     // "Dinner 22:00–23:00", "Closed 20:00–22:00"; "" when faded
  label: string;                    // "Terrace · Dinner 22:00–23:00": the tooltip's words
  faded: boolean;                   // a zone piece that only follows its department
}
export interface WeekRow {
  key: string;            // department or zone id
  name: string;
  zone: boolean;
  strong: boolean;        // as DayBoxRow.strong: a department, or a zone with hours of its own
  blocks: WeekBlock[];
  empty: string;          // text inside an empty track: "Closed all day" or ""
  words: string;          // the row in words: the day box's text for the same row
}
/** `chosen` "" (or an id the day's read lacks): one row per department. A department id: it,
 *  then its zones. */
export function weekRows(day: Day, chosen: string, names: MonthNames): WeekRow[];

// hours-view.ts, both through the module's own `dateFormat` (its en → en-GB, es → es-ES mapping)
/** "Mon 12 Oct", in the dashboard's language. */
export function formatDayHeading(date: LocalDate): string;
/** The week title's parts, from formatRangeToParts over `from`–`to` with day, short month and
 *  year; a month or year part carries the YYYY-MM or year it names — `from`'s for a "startRange"
 *  or "shared" part, `to`'s for an "endRange" part. */
export function formatWeekTitleParts(
  from: LocalDate, to: LocalDate, language?: string,
): { text: string; month?: string; year?: number }[];
```

Rules: department blocks are its ranges, labelled `month.range` ("{name} {start}–{end}"). A zone's
pieces are `zoneOwnHours(department.ranges, zone.closed, day)`: an open piece whose period, start
and end equal one of the department's ranges is `faded` with `text` ""; any other open piece is
full strength and labelled; each closed piece is `kind: "closed"`, labelled with the new
`week.closed_range`. A zone with no closed piece is all faded. **Empty tracks follow the boards
exactly:** board 3's note 3 ("A closed department or zone is just an empty grey track — no
'Santet Deli Co closed / Front Bar closed…' text") and board 4, which labels only "Closed all day".
So a row with no blocks has `empty` `week.closed_all_day` only when it is a department row on a
date closed all day (`day.closedAllDay`); every other empty row — a department closed on an
ordinary day, a zone whose department is closed, a zone closed for its department's whole day
(`own.ranges` empty, `own.closed` not), any zone on a date closed all day — has `empty` "". `words`
is exactly the `text` `openingHoursDay` gives the same row, so it still says "Closed" where the
track says nothing (share the code by exporting a helper from `opening-hours-day.ts`; the test pins
equality, not the sharing).

New strings: `week.closed_range` "Closed {start}–{end}" / "Cerrado {start}–{end}";
`week.closed_all_day` "Closed all day" / "Cerrado todo el día"; `week.block_label` "{name} · {text}"
/ "{name} · {text}".

- [ ] **Step 1: Failing tests** (`week-rows.test.ts`, fixture `monthModel()` and `DEPARTMENTS` from
  `src/testing/opening-hours-month-fixture.ts`; changeover 06:00):
  1. `weekDates("2026-12-02")` is `2026-11-30` … `2026-12-06`; `weekDates("2027-01-03")` starts
     `2026-12-28`; `weekMonth("2027-01-02")` is `"2026-12"`; `weekDays(monthModel(), "2027-01-02")`
     has seven days ending `2027-01-03`; `weekDays(monthModel(), "2027-01-04")` is undefined.
  2. 1 December, Restaurant chosen: rows `rest`, `terrace`. Restaurant's block texts
     `["Breakfast 08:00–11:00", "Lunch 13:00–16:00", "Dinner 20:00–23:00"]`, none faded. Terrace:
     Breakfast and Lunch faded with text ""; "Dinner 22:00–23:00" not faded, `start` 960; a closed
     block "Closed 20:00–22:00" with label "Terrace · Closed 20:00–22:00"; `strong` true; `words`
     "Breakfast 08:00–11:00 · Lunch 13:00–16:00 · Dinner 22:00–23:00 · closed 20:00–22:00".
  3. 2 December, Restaurant chosen: every Terrace block faded; `words` "as Restaurant"; `strong` false.
  4. Sunday 6 December, Restaurant chosen: Restaurant no blocks, `empty` "", `words` "Closed";
     Terrace no blocks, `empty` "", `words` "as Restaurant".
  5. 25 December, All departments: two rows, `rest` and `bar`, no zone rows, each `empty`
     "Closed all day"; with Restaurant chosen, Terrace's `empty` is "".
  6. Bar on 2 December: one block, `start` 240, `end` 1200, label "Bar · All day 10:00–02:00".
  7. **Review Focus 2:** a model whose Terrace on 2 December is closed 22:00–05:00 → closed block
     "Closed 22:00–23:00" only (`end` 1020); one closed 07:00–05:00 → no blocks, `empty` "",
     `words` "Closed".
  8. **Review Focus 3:** a 2 December with `endMinute` 1500 and Bar 22:00–07:00 → Bar block
     `start` 960, `end` 1500.
  9. For every date of `monthModel()`, both with `""` and with `"rest"`, each row's `words` equals
     the `text` of the row of the same name in `openingHoursDay(day, seasons, DEPARTMENTS, chosen)`.
  10. `formatWeekTitleParts`, measured with Node's ICU on 2026-10-17 through the same en-GB / es-ES
      mapping:
      - `("2026-10-12", "2026-10-18", "en")` joins to "12 – 18 Oct 2026"; its one month part is
        `{ text: "Oct", month: "2026-10" }` (a "shared" part), its one year part `{ year: 2026 }`.
      - `("2026-10-12", "2026-10-18", "es")` joins to "12–18 oct 2026" — no spaces round the dash.
      - `("2026-09-28", "2026-10-04", "en")` joins to "28 Sept – 4 Oct 2026", month parts `2026-09`
        then `2026-10`.
      - `("2026-12-28", "2027-01-03", "es")` joins to "28 dic 2026 – 3 ene 2027", years 2026 then 2027.
      If Chromium's own ICU gives other spaces or spellings, keep Chromium's strings in the test and
      say so in the commit; the parts' `month`/`year` assertions are what matter.
      `formatDayHeading("2026-10-12")` is "Mon 12 Oct".
  Fails today: the module does not exist.
- [ ] **Step 2: Run** `week-rows.test.ts`; see the import fail.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run** it, then `opening-hours-day.test.ts` (unchanged, must stay green). Commit
  `"A722-1: work out a week's rows"`.

### Task 1.2a: Show moves into `calendar-show.ts`

**Files:** Create `packages/venue-service/src/dashboard/calendar-show.ts`. Modify
`opening-hours-month.ts` (`#picker`, `:519-542`, calls it; export `FIRST_MONTH` and `LAST_MONTH`).

**Interfaces — produces:**

```ts
/** The Show picker the Month and the Week share. */
export function showPicker(options: {
  model: OpeningHoursMonth; chosen: string; names: MonthNames;
  onDepartment: (departmentId: string) => void;   // "" for All departments
}): TemplateResult;
```

- [ ] **Step 1:** No new test: this task moves code without changing behaviour. Run
  `opening-hours-month.test.ts` and `opening-hours-month.a11y.test.ts` first and record the
  `Tests` counts.
- [ ] **Step 2:** Move the picker. **No existing check changes.**
- [ ] **Step 3: Run** the same two files plus `station-times-tab.test.ts`; same counts, all green.
  Commit `"A722-1: the Show picker becomes shared"`.

### Task 1.2b: `opening-hours-week`, the Week drawn at desktop width

**Files:** Create `packages/venue-service/src/dashboard/opening-hours-week.ts`,
`opening-hours-week.test.ts`, `opening-hours-week.a11y.test.ts`. Modify `strings.ts`.

**Interfaces:**
- Consumes Task 1.1's helpers, `showPicker`, `monthNames` (`opening-hours-day.ts`).
- Produces:

```ts
@customElement("opening-hours-week")
export class OpeningHoursWeekView extends LitElement {
  @property({ attribute: false }) model?: OpeningHoursMonth; // the read of weekMonth(date)
  @property() date = "";                                     // the shown date (Decision 2)
  @property() departmentId = "";
  @property({ attribute: false }) departments: readonly MonthDepartment[] = [];
}
// Sends (bubbles, composed): week-change {date}, week-department-change {departmentId},
// calendar-day-open {date, returnTo} (CalendarDayOpen); Task 1.2c adds week-month-open {month}
// and week-year-open {year}.
```

Drawing (board 4, less its switch): `.head` holds ‹ (`data-test="previous-week"`, `week.previous`),
the title (`<h2 data-test="week" aria-live="polite">`, plain text from `formatWeekTitleParts` in
this task), › (`next-week`, `week.next`) and Show. ‹ › send `week-change` with `date` ∓ 7 days,
disabled when that week is out of range (Decision 2). Until `weekDays(model, date)` holds the week,
only the head's ‹ title › is drawn. Under the head: an `aria-hidden` ruler (Decision 5: from
Monday's changeover, every two hours, over the week's longest `endMinute`), then per day a
`<section>` holding an `<h3>` with a `<button data-test="day-name" data-date>` (`formatDayHeading`)
and the special day's and holiday's names as the Month draws them (`.name.special`,
`.name.holiday`, the holiday once when both are the same), then one `.row[data-row]` per `WeekRow`:
the name (bold when not a zone), a visually hidden line "<name>: <words>", and an `aria-hidden`
`.track` with a `.block` per `WeekBlock` (`data-colour`, `data-kind`, `?data-faded`; `left` and
`width` over the week's longest `endMinute`; its `text` inside, clipped with an ellipsis) or, with
no blocks, the row's `empty` text inside the track. The name column is
`calc(var(--wt-tap-min) * 4)` wide.

New strings: `week.previous` "Previous week" / "Semana anterior"; `week.next` "Next week" /
"Semana siguiente".

- [ ] **Step 1: Failing tests** (`opening-hours-week.test.ts`, host page at 1280 px measured):
  1. "draws the week holding its date, a day per section": `date` "2026-12-02", `monthModel()`:
     seven `[data-test=day-name]` reading "Mon 30 Nov" … "Sun 6 Dec"; All departments gives each
     day rows `rest` and `bar`.
  2. "draws the chosen department and its zones, a zone faded where it follows": `departmentId`
     "rest", 1 December: Terrace's faded blocks have no text and computed `opacity` equal to
     `--wt-opacity-disabled`; its "Dinner 22:00–23:00" block's `left` is 66.67% (±0.1) of the
     track; its closed block's computed `background-image` is a `repeating-linear-gradient`.
  3. "names a special day and a holiday; only a date closed all day says so in its track": 8 Dec's
     section names "Immaculate Conception" (`.name.holiday`); 14 Dec "Company dinners"
     (`.name.special`); 25 Dec shows "Christmas Day" once and its Restaurant track reads
     "Closed all day"; Sunday 6 Dec's Restaurant track is empty grey with no text
     (`textContent.trim()` is "", computed background `--wt-color-border`), as board 3 note 3 asks.
  4. "speaks each row whole": with "rest" on 1 December the Terrace row's hidden line reads
     "Terrace: Breakfast 08:00–11:00 · Lunch 13:00–16:00 · Dinner 22:00–23:00 · closed 20:00–22:00";
     Sunday 6 Dec's Restaurant line reads "Restaurant: Closed"; every `.track` has
     `aria-hidden="true"`.
  5. "steps a week each way": › sends `week-change` `2026-12-09`, ‹ `2026-11-25`. With `date` the
     first Monday falling in 0100-02 (work it out with `weekdayOf`, and assert it in the test) ‹ is
     disabled and › is not (**Review Focus 4**).
  6. "a day's name sends calendar-day-open": `userEvent.click` on 9 Dec's name → one event, `date`
     "2026-12-09", `returnTo()` is that button.
  7. "Show changes the department": choosing Bar sends `week-department-change` `{ departmentId:
     "bar" }`; All departments sends `""`; a `departmentId` the read lacks shows All departments
     (**Review Focus 5**).
  8. "draws only the head until its week's read arrives": `model` undefined, `date` set → ‹ title ›
     present, no `section`.
  9. "a 25-hour day's bars and the ruler share one scale" (**Review Focus 3**): a model whose
     2 December has `endMinute` 1500 and Bar 10:00–07:00 → on that week, Bar's block ends at the
     track's right edge (±1 px); on 3 December (1440 minutes) Bar's 10:00 block starts where the
     ruler's "10:00" label is (±2 px); the ruler's last label sits at 1440/1500 of the width.
  `opening-hours-week.a11y.test.ts`, light and dark: "All departments", "a department and its zones
  with a closure", "a day closed all day", "Spanish" — `expectNoA11yViolations` each.
  Fails today: no element.
- [ ] **Step 2: Run** both new files; see them fail on the missing element.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the two new files. Commit `"A722-1: draw a week of opening hours"`.

### Task 1.2c: The Week's title links back, and keeps one width

**Files:** Modify `opening-hours-week.ts`, `strings.ts`. Test `opening-hours-week.test.ts`,
`opening-hours-week.a11y.test.ts`.

The title is drawn inside `fixedTitle` (`fixed-title.ts`). Each month part is a
`<button class="title-link" data-test="week-month" data-month>` described by a hidden
`week.month_view_hint` line, each year part a `<button class="title-link" data-test="week-year"
data-year>` described by `month.year_view_hint`; they send `week-month-open` `{ month }` and
`week-year-open` `{ year }`. The fixed width's candidates are the titles of every week whose Monday
falls in 2026 (which includes 28 Dec 2026 – 3 Jan 2027), in each interface language, each shaped
as the visible title (links as inline-block spans — A759's lesson, its commit message).

New string: `week.month_view_hint` "Whole month" / "Todo el mes".

- [ ] **Step 1: Failing tests:**
  1. "the title links to its months and years" (**Review Focus 1**): `date` "2027-01-02" → title
     "28 Dec 2026 – 3 Jan 2027" (Chromium's own string, Task 1.1 test 10); two `week-month`
     buttons, clicking the second sends `week-month-open` `{ month: "2027-01" }`; two `week-year`
     buttons, the first sends `week-year-open` `{ year: 2026 }`; a one-month week ("2026-10-14") has
     one of each, naming `2026-10` and 2026.
  2. "the title keeps one width": in English and in Spanish (restored in `finally`), for every
     Monday of 2026 plus 2011-05-02 and 2088-05-03, the › button's left edge is the same (±0.5 px).
     Make it fail once by drawing the title without `fixedTitle`, then restore.
  a11y: "a week across two years, with its four links", light and dark.
- [ ] **Steps 2–4:** run (fail: no links), implement, run the Week's two files. Commit
  `"A722-1: the Week's title links back and keeps one width"`.

### Task 1.3: A block's label in full when pointed at or tapped (point 2)

**Files:** Modify `opening-hours-week.ts`. Test `opening-hours-week.test.ts`,
`opening-hours-week.a11y.test.ts`.

The Week holds one `<div popover="manual" class="tip" data-test="block-tip" aria-hidden="true">`
and a `pinned` flag, behaving as Decision 4 says:
- a block's `pointerenter` from a mouse shows the tip with that block's `label`, unpinned;
- a `click` on a block (mouse or touch) shows it with that block's label and pins it — or, when it
  is already pinned to that block, unpins and hides it;
- the block's and the tip's `pointerleave` hide the tip only while it is unpinned (moving onto the
  tip keeps it, WCAG 1.4.13);
- a `click` anywhere outside a block and the tip, an Escape `keydown` caught on `window` in the
  capture phase (stopped and its default prevented while the tip is open), and a page scroll hide it
  and unpin it.

`placeTip(tip, block)` shows the tip and places it in the same call: above the block (its bottom
`var(--wt-space-1)` above the block's top) when that fits inside the window, else below; its left
lined up with the block's and kept 8 px inside the window's edges.

- [ ] **Step 1: Failing tests:**
  1. "a sliver's label shows whole when pointed at, above it": a model whose Restaurant serves
     Lunch 16:00–17:00 on 2 Dec; that block's `scrollWidth` > `clientWidth` (it is clipped) while its
     `textContent` is "Lunch 16:00–17:00"; `userEvent.hover` on it → the tip is `:popover-open`,
     reads "Restaurant · Lunch 16:00–17:00", and its bottom is above the block's top; a block in the
     first row, scrolled to the window's top edge, gets the tip below it instead;
     `commands.parkPointer()` → hidden (unpinned).
  2. "a click pins it, and leaving does not hide a pinned tip": `userEvent.click` on the block →
     open; `commands.parkPointer()` → still open; `userEvent.click` on the same block → closed.
  3. "a click elsewhere hides a pinned tip": pin it, `commands.parkPointer()` (still open, so what
     follows tests the click and not the pointer leaving), then `userEvent.click` on the Week's
     title → closed.
  4. "Escape hides it and goes no further": pin it, `userEvent.keyboard("{Escape}")` → closed, and a
     `keydown` listener on `document` saw nothing.
  5. "a tap shows it and it stays after the tap's own pointerleave": `commands.touchGesture({ at:
     <block selector> })` → open after the gesture ends (a touch tap in Chromium sends
     pointerenter, pointerdown, pointerup, pointerleave, then click; check that order in the test
     with listeners and record it in the commit); a second tap → closed; a tap, then
     `commands.touchGesture({ at: <title selector> })` → closed.
  6. "a faded zone piece names its zone": hovering Terrace's faded Lunch on 2 Dec → "Terrace · Lunch
     13:00–16:00".
  7. "stays on a phone's screen": at 390 px (measured), the tip of a block at the right edge has
     right ≤ 390 − 8 and left ≥ 8.
  a11y: "the tip shown over a sliver", light and dark.
- [ ] **Steps 2–4:** run (fail: no tip), implement, run the Week's two files. Commit
  `"A722-1: a block's label in full on pointing or tapping"`.

### Task 1.4a: The Week at its address

**Files:**
- Modify: `opening-hours-screen.ts` — `View` gains `"week"`; the URL controller's children gain
  `week: "week"` after `month` (before `window`); `followUrl` shows the Week for `view/week` and adds
  `requestedView === "week"` to the `?station=` query clean-up (`:226-235`); a `requestedWeekDate`
  state; `shownWeekDate()` (Decision 2); the month read follows `readMonth()` — `shownMonth()` on
  the Month, `weekMonth(shownWeekDate())` on the Week — so `watchMonth` serves both;
  `chooseCalendarView` carries the Week's month (the Monday's; Part 2 makes it the shown day's on a
  phone); `render()` draws `this.week()`; `placeDayBox` also waits for `opening-hours-week`.
- Modify: `packages/dashboard-kit/src/contract.ts:62-63` — the comment's "and `week` is an old
  address that opens the season painter" becomes "and `week` is the Week's". The list is unchanged.
- Create: `opening-hours-screen.week.test.ts` (its own `mount`, modelled on
  `opening-hours-screen.special-day.test.ts`, answering month reads with `monthModel()`).
- Modify (tests): `opening-hours-screen.test.ts`, `opening-hours-screen.painter.test.ts`.

**Interfaces:** the screen writes Week addresses with `this.url.write` then `followUrl`, as
`openMonth` does: `week-change` → `{ view: "week", week: date }` (a push);
`week-department-change` → `{ department: id || null, zone: null }`.

- [ ] **Step 1: Failing tests** (`opening-hours-screen.week.test.ts`, clock at 2026-12-02):
  1. "`/view/week/week/2026-12-09` draws that week from December's read": one month read with
     `month=2026-12`; `opening-hours-week` has `date` "2026-12-09"; no `season-painter`.
  2. "`/view/week` alone draws the week holding the venue's today", and
     "`/view/week/week/2026-13-40`, `/week/abc` and `/week/0099-12-28` draw it too and leave the
     address as written" (**Review Focus 4**).
  3. "a week across two years reads the month of its Monday": `/view/week/week/2027-01-02` reads
     `2026-12` only (**Review Focus 1**).
  4. "› pushes the next week": `pushedPaths()` gains `/manage/opening-hours/view/week/week/2026-12-16`,
     and the Week shows it; Back returns to `…/week/2026-12-09`.
  5. "Show writes the department and keeps the week": Bar → `/manage/opening-hours/view/week/department/bar/week/2026-12-09`;
     All departments removes the pair. `/view/week/department/gone/week/2026-12-09` draws All
     departments (**Review Focus 5**).
  6. "an old Week address naming a department, a zone, a season or All departments opens the Week":
     `/view/week/department/d3`, `/view/week/department/d1/zone/z1/season/spring` and
     `/view/week/department/all` each draw `opening-hours-week` and no painter, with no push.
  7. "`/view/week?station=s1` drops the query and draws the Week": `location.search` becomes "",
     by a replace (no push), and `opening-hours-week` is drawn.
  8. "a module view's switch from the Week carries the week's month": with a stub calendar view
     (as `opening-hours-screen.test.ts`'s module-view cases build one), choosing it from
     `/view/week/week/2027-01-02` at 1280 px writes `/view/<id>/month/2026-12`.
- [ ] **Step 2: Run**; see them fail (today each address becomes the painter's).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Existing checks that change** (Decision 1: `view/week` now names the Week):
  - `opening-hours-screen.test.ts` `"ignores a zone belonging to another department"` (`:319`):
    its address `/view/week/department/bar/zone/terrace` becomes
    `/view/season/department/bar/zone/terrace`; the checks (address becomes
    `/view/season/department/bar`, painter `["bar", ""]`) stay — the test is about the zone, and
    the season painter's own address still corrects it.
  - `opening-hours-screen.test.ts` `"offers no Real week switch and ignores a week in the address"`
    (`:2262`) is **rewritten, not deleted**: `/view/week?week=2026-10-12` now draws the week holding
    the venue's today (not 12 October: the query is not the `week` pair) and keeps the query
    (`location.search` stays "?week=2026-10-12"); its `[name=realWeek]` absent check stays; its
    painter and `previous-week`-absent checks go, because they pin the retired meaning. Title "draws
    the week holding today for `/view/week?week=…`, ignoring the query". Its describe `"no Day tab
    and no real week"` is retitled `"no Day tab, and a week query ignored"`; `"opens the Year when
    the address names only a week"` (`:2271`) stays word for word. The comment above the
    `CALENDAR_OWN_VIEW_IDS` `it.each` (`:2531-2533`) drops "and the old `week` address that opens the
    season painter"; the assertion stays.
  - `opening-hours-screen.painter.test.ts`:
    - `"closing a painter reached by Back to an old Week address replaces it with the view it drew
      over"` (`:299`): the address pushed first, `/view/week/department/d1`, becomes
      `/manage/opening-hours/department/d1` (no view, naming a department — still replaced by the
      painter's); title "…reached by Back to an address naming a department…"; every check stays.
    - `"a Week address naming %s opens the painter in its place"` (`:352-370`): the first two rows'
      view word `week` becomes `old` (an unknown view, which still opens the painter —
      design-system.md, "and an unknown view"), with the same painted targets; title "an address
      naming %s…"; the third row stays. Test 6 above pins what those `week` addresses do now.
    - `"an old Week address naming %s opens the painter in its place"` (`:372-387`): the query row
      (`?view=week&station=s1`, no `view` pair) stays; the `"a station's path"` and `"All
      departments"` rows are deleted — both are now Week addresses (test 6; Part 3 reads `station`).
    - `"an old department Week address opens a painter with no Save…"` (`:745`): its address becomes
      `/manage/opening-hours/department/d1`; title "a department address with no view opens…";
      the checks stay.
  - Not changed, checked: `"reads no prep-station list, on the Year or on an old station address"`
    (`opening-hours-screen.test.ts:237`) uses `?view=week&station=bar` with no `view` pair, which
    still opens the painter; `apps/dashboard/src/navigation.test.ts`'s `view/week` strings test the
    app's URL controller only.
- [ ] **Step 5: Run** the screen test files. Commit `"A722-1: the Week at /view/week"`.

### Task 1.4b: From the Week to the Month, the Year and the day box

**Files:** Modify `opening-hours-screen.ts`:
- `week-month-open`, `week-year-open` and `calendar-day-open` listeners on the Week;
- `openMonthFromYear` and `openYearFromMonth` (`:1116-1153`) take the pressed link's selector and,
  for the Year, the month to focus, so the Week reuses their focus hand-off. **The month handed to
  the Year is the first day of the shown week that falls in the pressed year** — for "28 Dec 2026 –
  3 Jan 2027", 2026 hands off `2026-12` and 2027 hands off `2027-01` — because `focusPendingMonth`
  gives up when the Year shown is not that month's year (`:1158-1167`, the check at `:1163`);
- `openMonth` and `openYear` (`:708-724`) also write `week: null`, since the screen's URL
  controller keeps every pair it is configured with;
- a title link pressed while the day box is open: the box closes and its `dayBox` state is dropped
  before the address changes, so it is not drawn again over the Month or the Year;
- `dayBoxTemplate` leaves "Open this week" out on the Week (Task 1.5).

Test `opening-hours-screen.week.test.ts`, `opening-hours-screen.a11y.test.ts`.

- [ ] **Step 1: Failing tests:**
  1. "a month link opens that Month, keeping the department": from
     `/view/week/department/rest/week/2027-01-02`, the "Jan" link pushes
     `/manage/opening-hours/view/month/department/rest/month/2027-01`.
  2. "a year link opens that Year": the "2026" link pushes
     `/manage/opening-hours/view/year/department/rest/year/2026`.
  3. "the year link pressed with the keyboard leaves focus on the week's month name once the Year
     has drawn it" (as `opening-hours-screen.test.ts:2083` does for the Month), for both years of
     the two-year week: from `…/week/2027-01-02`, Enter on the "2026" link → focus on
     `[data-month="2026-12"] [data-test=month-name]`; Enter on the "2027" link → focus on
     `[data-month="2027-01"] [data-test=month-name]` (**Review Focus 1**).
  4. "a month link pressed with the keyboard leaves focus on the Month's year link".
  5. "a title link pressed with the day box open closes it for good": open 30 Dec's box, then
     `userEvent.click` on the "Jan" link → wait for `calendar-day-box-close`; once the Month is
     drawn, `dayBox(el)` is null and stays null after the Month's read answers; the same from the
     "2026" year link onto the Year.
  6. "a day's name opens the day box over the Week, with the Week's department": `userEvent.click`
     on 9 Dec's name with Restaurant shown → box anchored to that button, rows Restaurant then
     Terrace, buttons "Make a special day", "Edit Winter's standard week" — no "Open this week".
  7. "a painter opened from the Week's box closes back onto the Week": "Edit Winter's standard
     week", then the painter's Cancel → wait for `painter-close`; address
     `/view/week/department/rest/week/2026-12-09`, the Week drawn.
  `opening-hours-screen.a11y.test.ts`: states "the Week" and "the day box over the Week", light and dark.
- [ ] **Steps 2–4:** run (fail), implement, run the screen test files. Commit
  `"A722-1: the Week's title and day names lead on"`.

### Task 1.5: "Open this week" in the day box; the Week in page search

**Files:** Modify `opening-hours-screen.ts` (`dayBoxTemplate`: a last button
`<wt-button variant="secondary" data-test="open-week">` labelled `day.open_week`, drawn whenever the
shown view is the Year or the Month, for a viewer too; its action writes `{ view: "week", week:
date, month: null, year: null, date: null, to: null }` and then, if focus fell to the page, focuses
that date's `[data-test=day-name]` in the Week), `index.ts` (search destination), `strings.ts`.
Test `opening-hours-screen.test.ts`, `opening-hours-screen.week.test.ts`, `index.test.ts`.

New strings: `day.open_week` "Open this week" / "Abrir esta semana"; `opening.view.week` "Week" /
"Semana". Destination, after Month:
`{ id: "venue-service:week", screen: "opening-hours", labelKey: "opening.view.week", path: "/manage/opening-hours/view/week" }`.

- [ ] **Step 1: Failing tests:**
  - `opening-hours-screen.week.test.ts`:
    1. "Open this week from the Month opens that date's week, keeping the department": on
       `/view/month/department/rest/month/2026-12`, open 10 Dec's box, `userEvent.click`
       `open-week` → after `calendar-day-box-close`, `pushedPaths()` ends
       `/manage/opening-hours/view/week/department/rest/week/2026-12-10`; the Week shows 7–13 Dec;
       focus is on 10 Dec's `day-name`.
    2. "Open this week from the Year, while the box's month still loads": with the month read held
       (`heldMount` pattern, `opening-hours-screen.test.ts:1046`), the Loading box already offers
       `open-week`; pressing it opens `/view/week/week/2026-12-10`.
    3. "a viewer's box offers Open this week too".
  - `index.test.ts`: "declares the Calendar's Week as a search destination": the destinations
    whose `screen` is `opening-hours` have paths `["/manage/opening-hours/view/year/window/seasons",
    "/manage/opening-hours/view/year", "/manage/opening-hours/view/month",
    "/manage/opening-hours/view/week"]`, and mounting the Calendar at the last draws
    `opening-hours-week`.
- [ ] **Step 2: Run**; see them fail (no button, no destination).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Existing checks that change** (point 5: "The day box gains an Open this week
  button"): the exact button lists in `opening-hours-screen.test.ts` each gain `"Open this week"`
  last — `:1086` (`["Make a special day"]`), `:1133`, `:1266`, `:1270`, `:1818`, `:1934`.
  Nothing else in them changes. `:1887` (`[0]`) is unchanged.
- [ ] **Step 5: Run** the screen test files and `index.test.ts`; check
  `apps/dashboard/src/dashboard-app.search-modules.test.ts` still passes
  (`pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.search-modules.test.ts`).
  Commit `"A722-1: Open this week, and the Week in page search"`.

### Task 1.6: Part 1's docs, backlog and LOOK

- [ ] `docs/developers/design-system.md`, Opening hours (`:3878-4040`):
  - `:3885-3886` "choosing a view from Opening hours' month carries that month into its address"
    also covers the Week (its Monday's month at desktop width).
  - The painter sentence at `:3931-3933` ("Every other week address opens the painter in its
    place: `/view/week`, with or without a department, a station or All departments, …") loses
    `/view/week` and its "with or without…" clause; the rest of the list stays.
  - Add a **Week** bullet after **Month**: the address and the `week` pair, Decision 2's fallback,
    the title's links and fixed width, the ruler on the longest day's scale (Decision 5, and its
    limit), faded and labelled zone pieces, empty grey tracks with only "Closed all day" written,
    the tooltip on pointing or tapping (Decision 4's states), a day's name opening the day box, no
    painting.
  - In **Day box** (`:3996-4013`) replace "and A722's Week is to open it too (backlog A722)" with the
    Week, and add "Open this week" (Year and Month, viewers too, not from the Week).
- [ ] `docs/backlog/dashboard.md:922-923`: "the real Week view is A722. Each registers its
  destination when it exists" → the Week is registered as `venue-service:week`, and the others
  register theirs when they exist.
- [ ] `docs/backlog/workforce.md:186`: "as A722's Week title is to (service-periods.md, A722 point 3)"
  → "as the Calendar Week's title does (`opening-hours-week.ts`)" — this part deletes point 3.
- [ ] `docs/backlog/service-periods.md`: delete points 1, 2, 3 and 5 from the A722 section (keep 4
  and 6 with their numbers; the paragraph about search becomes "Registered as `venue-service:week`
  (Part 1)", or goes); delete the Decisions note "No Week button and no 'Open this week' in the day
  box until A722" (`:347-349`) — it becomes false the moment this part lands (CLAUDE.md §1, "A
  behaviour change retires every receipt"); in the A759 note (`:351-354`) "A722's Week is to open
  from the day box's 'Open this week', with no Week button" becomes "the Week opens from the day
  box's 'Open this week'; there is no Week button". Add to "Decisions and deliberate limits":
  Decisions 1 (the address, and that old `view/week` bookmarks now open the Week), 4 (every block's
  label, above the block) and 5 (one scale; the changeover limit).
- [ ] `docs/backlog.md` A722 entry: "Points 1–3 and 5 landed in #NNNN; 4 and 6 remain."
- [ ] LOOK: `/manage/opening-hours/view/week` (All departments and one department with a zone),
  a week with a special day and a public holiday, a cross-month week, both themes, 1280 px (and
  390 px to see it stays usable before Part 2 — it may be cramped), hover, click and pin a sliver;
  open the Month's day box and press Open this week.

---

# Part 2 — one day at a time on a phone (point 4)

Branch `feat/a722-2-week-phone`, from `main` after Part 1.

### Task 2.1a: The phone layout

**Files:** Modify `opening-hours-week.ts`, `strings.ts`. Test `opening-hours-week.test.ts`,
`opening-hours-week.a11y.test.ts`.

**Interfaces:**
- `export const PHONE_WIDTH = 560;` in `opening-hours-week.ts`; a `ResizeObserver` on the host sets
  `@state() narrow` when its content box is narrower (Decision 11).
- A public getter `get shownMonth(): string` — the shown date's `YYYY-MM` when narrow, else
  `weekMonth(date)` — for the screen (Task 2.3).

Narrow drawing (board 5, less its switch): ‹ (`data-test="previous-day"`, `week.previous_day`) the
day title (`<h2 data-test="week">`, plain `formatDayHeading(date)` in this task, "Fri 16 Oct") ›
(`next-day`, `week.next_day`), then Show; under the head the day's special-day/holiday names; then
one card holding, per `WeekRow`, the name (bold when `strong`), `words` on its own line, and the
thin `aria-hidden` track with the row's blocks unlabelled (faded and hatched as at desktop width).
‹ › send `week-change` with `date` ∓ 1, disabled when that day's week is out of range
(Decision 2). No ruler, no tooltip.

New strings: `week.previous_day` "Previous day" / "Día anterior"; `week.next_day` "Next day" /
"Día siguiente".

- [ ] **Step 1: Failing tests** (`page.viewport(390, 800)`, `innerWidth` asserted 390):
  1. "below 560 px it shows the address's day alone": `date` "2026-12-01", `departmentId` "rest" →
     one day; rows Restaurant (bold) "Breakfast 08:00–11:00 · Lunch 13:00–16:00 · Dinner
     20:00–23:00" and Terrace (bold) with Task 1.1 test 2's words; a 2 Dec model's Terrace reads
     "as Restaurant", not bold.
  2. "‹ › step a day": › sends `2026-12-02`, ‹ `2026-11-30`; `shownMonth` is "2026-12" for
     `date` "2026-12-01" when narrow and "2026-11" at 1280 px.
  3. "back above 560 px it shows the whole week again" (`page.viewport(1280, 800)`; poll).
  4. "nothing runs off the side": every child of the head and the card ends inside 390 px.
  a11y: "a day on a phone", "a day on a phone with a closed zone", light and dark.
- [ ] **Steps 2–4:** run (fail), implement, run the Week's files. Commit
  `"A722-2: one day at a time on a phone"`.

### Task 2.1b: The phone's day title: links and one width

**Files:** Modify `opening-hours-week.ts`, `hours-view.ts`. Test `opening-hours-week.test.ts`,
`opening-hours-week.a11y.test.ts`.

**Interfaces:** `formatDayTitleParts(date, language?)` in `hours-view.ts`, through `dateFormat`:
board 5's "Fri 16 Oct" — weekday, day and short month, **no year** — with the month part carrying
its `YYYY-MM`. The weekday-and-day part ("Fri 16") is a link button `data-test="day-name"` that
sends `calendar-day-open`; the month part is a `week-month` link. There is no year link on a phone,
following the board; the Year is one press further, through the Month's own year link. The title
sits in `fixedTitle`, whose candidates are every weekday × every month with day 28, per interface
language, shaped as the visible title. The two links are tap targets of at least 24 × 24 px
(WCAG 2.2, 2.5.8), with `var(--wt-space-1)` or more between them.

- [ ] **Step 1: Failing tests** (at 390 px measured):
  1. "the day's name opens the day box": `userEvent.click` on "Tue 1" → `calendar-day-open`
     `2026-12-01`, `returnTo()` that button; the "Dec" link sends `week-month-open`
     `{ month: "2026-12" }`; the title has no `week-year` button.
  2. "the day title keeps one width": the › left edge is equal across the seven days of
     30 Nov – 6 Dec and 1 Sep, 28 Feb, in English and Spanish (restored in `finally`); fails without
     `fixedTitle`.
  3. "the title's links are big enough to tap and apart": each link's box is at least 24 px wide
     and tall, and the gap between them is at least the computed `--wt-space-1`.
  a11y: "a day on a phone, Spanish", light and dark.
- [ ] **Steps 2–4:** run (fail), implement, run. Commit `"A722-2: the phone's day title"`.

### Task 2.2: A swipe for the next day

**Files:** Modify `opening-hours-week.ts`. Test `opening-hours-week.test.ts`.

The card has `touch-action: pan-y`. A `pointerdown` from touch or pen on it records where; its
`pointerup` sends `week-change` with `date` + 1 when the finger moved left at least
`SWIPE_PX = 48` and more than twice as far across as down, `date` − 1 when it moved right;
`pointercancel` (the browser took a vertical scroll) forgets it. A mouse never swipes.

- [ ] **Step 1: Failing tests** (driven by the real browser, as `day-picking.test.ts` does):
  1. "a swipe left shows the next day": `commands.touchGesture({ at: "<card selector>", moveBy:
     { x: -150, y: 0 } })` → one `week-change` `2026-12-02`; `moveBy: { x: 150, y: 0 }` →
     `2026-11-30`.
  2. "a finger moving down scrolls and steps nothing": `moveBy: { x: 0, y: -200 }` in a page taller
     than the viewport → no `week-change`, `scrollY` changed.
  3. "a short or slanted move steps nothing": `{ x: -30, y: 0 }` and `{ x: -60, y: -50 }` → none.
  4. "a mouse drag steps nothing": `commands.mouseDrag` across the card → none.
- [ ] **Steps 2–4:** run (fail), implement, run. Commit `"A722-2: a swipe for the next day"`.

### Task 2.3: The phone Week in the screen; docs, backlog and LOOK

**Files:** Modify `opening-hours-screen.ts` (`chooseCalendarView` reads the Week's `shownMonth`).
Test `opening-hours-screen.week.test.ts`, `opening-hours-screen.a11y.test.ts`; docs.

- [ ] **Step 1: Tests** (at 390 px measured):
  1. "at a phone's width › pushes the next day": `/view/week/week/2026-12-09` → `…/week/2026-12-10`.
  2. "a day crossing into the next month's read reads it": from `/view/week/week/2027-01-03`, ›
     pushes `…/week/2027-01-04` and makes one `month=2027-01` read.
  3. "Open this week from a Month box at a phone's width shows that day".
  4. "a module view's switch from a phone's day carries that day's month": from
     `/view/week/week/2026-12-01` (Monday 30 Nov) the stub view's address gets `month/2026-12`, where
     at 1280 px it gets `month/2026-11` (Task 1.4a test 8). Fails until `chooseCalendarView` reads
     `shownMonth`.
  a11y: "the Week on a phone", light and dark.
  Tests 1–3 may pass once Task 2.1a lands; if one passes before the code it tests exists, say so in
  the commit, and make it fail once by hand (send `date` + 7 in narrow mode) to see it catch that.
- [ ] **Step 2: Implement** test 4's change; run the screen test files.
- [ ] **Step 3: Docs:** design-system.md **Week** bullet gains the phone layout, the day title
  without a year, ‹ › and the swipe. `docs/backlog/workforce.md:211` "as A722's Week view" → "as the
  Calendar's Week on a phone" — this part deletes point 4. Backlog: delete A722 point 4; the entry
  reads "Points 1–5 landed (#NNNN, #NNNN); 6 remains."
- [ ] **Step 4: LOOK** at 390 px, both themes: a plain day, a special day, a day with a zone
  closure, swipe on the dev stack's page with Chromium's touch emulation; at 1280 px the Week is
  unchanged.
- [ ] **Step 5:** Commit `"A722-2: the phone Week in the Calendar"`.

---

# Part 3 — Show lists prep stations, in the Week and the Month (point 6)

Branch `feat/a722-3-show-stations`, from `main` after Part 2. Review path FULL, and a permissions
trigger (Decision 12).

**Today:** the Times tab (`station-times-tab.ts`) composes a station's month in its private
`#compose` (`:162-218`): a row per department that sends the station orders on any shown date (one
row named after the station when one or none does), each date's ranges from the station-times
read, matched by date to the month read. Show in the Month lists departments only. The screen reads
no station list (`opening-hours-screen.test.ts:237`). The Times tab is reachable only with
`venue_service.manage` (Decision 12).

### Task 3.1: A station's rows, worked out once (`station-show.ts`)

**Files:** Create `packages/venue-service/src/dashboard/station-show.ts`, `station-show.test.ts`.
Modify `station-times-tab.ts` (its `#compose` calls the new function with `lone: "station"`; its
`monthWeeks` moves here and is exported).

**Interfaces — produces:**

```ts
export interface ShowStation { id: string; name: string }
export type StationShow =
  | { id: string; state: "loading" }
  | { id: string; state: "always" }   // the read answered `always: "default"`
  | { id: string; state: "ready"; model: OpeningHoursMonth; departments: readonly MonthDepartment[] };
/** The whole Monday-to-Sunday weeks covering `month`, as readOpeningHoursMonth works them out. */
export function monthWeeks(month: string): [LocalDate, LocalDate];
/** The month read's days with one row per department that sends `station` orders on any of them;
 *  `lone: "station"` names a single row after the station (the Times tab), `"department"` after
 *  its department (the Calendar). Undefined unless both reads cover the same dates. The caller
 *  turns `times.always` into the "always" state before calling. */
export function stationShowModel(
  meta: OpeningHoursMonth, times: StationServiceTimes, station: ShowStation,
  periods: readonly TimesPeriod[], lone: "station" | "department",
): { model: OpeningHoursMonth; departments: MonthDepartment[] } | undefined;
```

- [ ] **Step 1: Failing tests** (`station-show.test.ts`, December's `monthModel()` and a
  station-times answer over the same 35 dates): two senders → rows `rest`, `bar` in the month read's
  department order, each date's ranges sorted from the changeover; one sender with `lone:
  "department"` → one row keyed and named after the department; with `lone: "station"` → keyed and
  named after the station; dates that differ by one → undefined; `monthWeeks("2026-12")` is
  `["2026-11-30", "2027-01-03"]`.
- [ ] **Step 2: Run** (fail: no module). **Step 3: Implement** by moving `#compose`'s body.
- [ ] **Step 4: Run** `station-show.test.ts`, `station-times-tab.test.ts`,
  `station-times-tab.a11y.test.ts`, `prep-stations-screen.test.ts` — **no existing check changes**.
  Commit `"A722-3: work out a station's rows once"`.

### Task 3.2: The station list, read live

**Files:** Modify `opening-hours-client.ts` (`watchStations`), `live-queries.ts`
(`"prep-stations-list": ["kitchen_stations"]` in `QUERY_DEPENDENCIES`). Test
`opening-hours-client.test.ts`.

```ts
/** The venue's stations, passive, on `QUERY_DEPENDENCIES["prep-stations-list"]`. */
watchStations(apply: (stations: PrepStation[]) => void, failed: (error: unknown) => void,
  recovered: () => void): () => void;   // GET /management-api/stations
```

- [ ] **Step 1: Failing test:** "watches the station list passively": one GET of
  `/management-api/stations` with `{ passive: true }`; a `kitchen_stations` change notice re-reads
  it (as the client file's other watch cases check).
- [ ] **Steps 2–4:** run (fail), implement, run it and
  `pnpm vitest run scripts/live-subscriptions.test.ts` from the root. Commit
  `"A722-3: read the station list for Show"`.

### Task 3.3a: Show's station group; the Month draws a station

**Files:** Modify `calendar-show.ts`, `opening-hours-month.ts`, `strings.ts`. Test
`opening-hours-month.test.ts`, `opening-hours-month.a11y.test.ts`.

**Interfaces:**
- `showPicker` gains `stations: readonly ShowStation[]`, `stationId: string`,
  `onStation: (stationId: string) => void`. Options: All departments, then group
  `opening.show_departments` ("Departments" / "Departamentos") with each department, then group
  `nav.prep_stations` with each station given, values `station:<id>`. No stations → no second
  group and no first-group heading, so today's options are unchanged.
- The Month gains `@property({ attribute: false }) stations: readonly ShowStation[] = []` and
  `@property({ attribute: false }) station?: StationShow`, and sends `month-station-change`
  `{ stationId }`. `model` stays the raw month read (Show's options come from it); with `station`
  set, the grid draws `station.model` and `station.departments`: rows read as orders — titles
  "{period} ({department})" (`month.period_department`), a date none sends on reads "No orders" once
  (`month.no_orders`), an empty row is an empty track spoken "{department}: No orders" — while the
  dates stay buttons that open the day box and Show stays (unlike `stationMode`, which the Times tab
  keeps). `"loading"` draws the head only; `"always"` draws `prep.always_open_default` in place of
  the dates.

- [ ] **Step 1: Failing tests** (Month): "Show lists stations in their own group, after the
  departments"; "choosing a station sends month-station-change"; "a station draws a row per sending
  department, its dates still buttons that open the box" (`calendar-day-open` on a click); "a date
  no department sends on reads No orders once"; "the default station reads Always open in place of
  the dates"; "loading draws only the head"; "with no stations Show is as before" (today's options,
  word for word). a11y: "a station's Month", light and dark.
- [ ] **Step 2: Run** (fail). **Step 3: Implement.**
- [ ] **Step 4: Existing checks that change:** none. `stationMode` cases stay as they are.
- [ ] **Step 5: Run** the Month's and the Times tab's files. Commit
  `"A722-3: Show offers prep stations in the Month"`.

### Task 3.3b: The Week draws a station

**Files:** Modify `opening-hours-week.ts`, `week-rows.ts`. Test `opening-hours-week.test.ts`,
`opening-hours-week.a11y.test.ts`, `week-rows.test.ts`.

**Interfaces:** the Week gains `stations`, `station` and `week-station-change` exactly as the Month
did in Task 3.3a. `weekRows` gains a station reading, `weekStationRows(day, names)`: one row per
department in the composed day, blocks labelled "Lunch 13:00–15:30", label "Restaurant · Lunch
13:00–15:30", no zones, `empty` "", `words` the blocks' texts joined by " · ", or `month.no_orders`.

- [ ] **Step 1: Failing tests:** `week-rows.test.ts` — the station reading's texts, labels and
  words. Week — the Month's five station cases, for the Week; at 390 px the day's words for a
  station row; the tooltip over a station block reads "Restaurant · Lunch 13:00–15:30". a11y: "a
  station's Week", desktop and phone, light and dark.
- [ ] **Steps 2–4:** run (fail), implement, run the Week's files and `week-rows.test.ts`. Commit
  `"A722-3: the Week draws a prep station"`.

### Task 3.4a: The screen shows a station, to whoever may open the Times tab

**Files:** Modify `opening-hours-screen.ts`:
- the URL controller's children gain `station: "station"` after `department`; a `stationId` state
  read in `followUrl`;
- **only when the screen is not read-only** (Decision 12) and the Month or the Week is shown: the
  station list is watched; the station-times read runs over `monthWeeks(readMonth())` for the shown
  station, if the list holds it — one watch serving the Month and the Week of that month;
- a `StationShow` built from `times.always` ("always") or `stationShowModel(…, "department")` with
  the model's departments' periods, else "loading";
- listeners write `{ station: id, department: null, zone: null }`, and `month-/week-department-change`
  also clear `station`; a read-only screen hands the views no stations and no station.

Test `opening-hours-screen.week.test.ts` (its mount answers `/management-api/stations` with two
stations and the service-times read with a two-sender answer).

- [ ] **Step 1: Failing tests:**
  1. "choosing a station in the Week's Show writes it and draws its rows":
     `/manage/opening-hours/view/week/station/s1/week/2026-12-09`; rows `rest`, `bar`.
  2. "the Month keeps the station": the "Dec" link from it opens
     `/view/month/station/s1/month/2026-12`, drawn as the station's month, with no second
     service-times read (same weeks).
  3. "choosing a department clears the station"; "an unknown station shows All departments and is
     never read" (no request to `/stations/<unknown>/service-times`) (**Review Focus 5**).
  4. "the day box over a station still lists every department's hours".
  5. "the default station reads Always open"; "a failed station-times read shows the load error
     above the view"; "a failed station list leaves Show with departments only, and the page works".
  6. **Decision 12:** "a read-only Calendar offers no stations and reads none": mounted read-only on
     `/view/week/station/s1/week/2026-12-09`, Show has no station group, the Week draws All
     departments, and no request starts with `/management-api/stations` or contains
     `/service-times`.
  7. "the Year reads no station list" — `opening-hours-screen.test.ts:237` already pins it; re-run.
- [ ] **Step 2: Run** (fail). **Step 3: Implement.**
- [ ] **Step 4: Run** `opening-hours-screen.week.test.ts` and `opening-hours-screen.test.ts`. Other
  files' mocks may now fail on the new read; Task 3.4b fixes them. If a file outside these two fails
  here, record which, and leave it for 3.4b rather than widening this task. Commit
  `"A722-3: the Calendar shows a prep station"`.

### Task 3.4b: Mocks answer the station list

**Files (tests only):** every helper that mounts the Calendar for a writer and answers any unknown
path with the opening-hours model now meets `GET /management-api/stations` when it shows a Month or
a Week. Run, in `packages/venue-service`: the screen test files, `index.test.ts`,
`service-delete-editors.test.ts`, `zone-edit-dialog-policy.test.ts`,
`periods-screen.editing.test.ts`, `venue-departments-shell.unsaved.test.ts`; in `apps/dashboard`
(`pnpm --filter @waitron/dashboard exec vitest run <file>`): `src/nav-destinations.test.ts`,
`src/dashboard-app.test.ts`, `src/dashboard-app.search-modules.test.ts`,
`src/screens/business-day-start-editor.test.ts`.

- [ ] **Step 1:** Run them; list each failure on the new path.
- [ ] **Step 2:** In each failing helper, answer `/management-api/stations` with `[]`. **No
  assertion changes**; list every helper changed in the PR.
- [ ] **Step 3:** Run them all again, green. Commit `"A722-3: test helpers answer the station list"`.

### Task 3.5: Part 3's docs, the backlog's end of A722, lane F, LOOK

- [ ] design-system.md: **Month** and **Week** bullets say Show lists prep stations, to whoever may
  open Prep stations (`venue_service.manage`), and what a station draws (Decision 10); "Worked-out
  prep-station times" (`:3678-3696`) says the Calendar's Show offers the same reading.
- [ ] Backlog, so nothing points at a deleted entry:
  - Delete the A722 entry from `docs/backlog.md` and the `## A722` section from
    `docs/backlog/service-periods.md`. Decisions 2, 7, 8, 10, 11 and 12 that a later item could
    relitigate move to that file's "Decisions and deliberate limits" (Decisions 1, 4 and 5 went
    there in Part 1).
  - `docs/backlog.md`, "Supervisors have no dashboard path to a prep station's times" (`:1692-1695`):
    rewrite to say the times now also show in the Calendar's Show picker, offered like the Times tab
    only with `venue_service.manage`, while the service-times route still lets `venue.view` read
    them; the owner's question stays — whether a supervisor gets a read-only station view, which
    would now mean offering stations in a read-only Calendar's Show.
  - `docs/backlog/kitchen.md:152-154` (A725 point 2): "What the tab showed moves to the Calendar's
    Show picker (A722 point 6)" → "has moved to the Calendar's Show picker (`calendar-show.ts`),
    offered to the same people as the Times tab"; keep its sentence that the second note's question
    becomes who may open the Calendar's station view.
  - `docs/developers/design-system.md`: no "A722" left (`git grep -n A722 -- docs/developers`).
  - The mockups README's job table (`README.md:13`) is an index of what was drawn and keeps its row.
  - Check with `git grep -n "A722" -- docs/backlog.md docs/backlog docs/developers CLAUDE.md packages apps`;
    only the README row and dated plans may remain.
- [ ] LOOK: the Week and the Month with a station two departments feed, the default station, a
  station with no orders on some dates, both themes, 390 and 1280 px; a viewer login sees no
  stations in Show.
- [ ] After merge: the lane F note (Global constraints, "Lane F"); set the ledger to `Status: done`.
