# A720 — the Calendar's Year and Month views: one toolbar, a day box, days picked on the grid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** Make the Calendar's Year and Month views read as the owner drew them on 2026-10-15: one
toolbar row with a Year / Month switch instead of a tab row, nothing above the months but what needs
action, a floating box that explains a clicked day instead of a panel that pushes the page down,
days picked on the grid by click, drag, shift-click and double-click, closed rows drawn as empty
grey bars, and a zone's bar showing the zone's own hours. Staffing's month follows with the same day
box.

**Architecture:** The Calendar page is one screen, `dashboard-opening-hours-screen`
(`packages/venue-service/src/dashboard/opening-hours-screen.ts`), which reads the address and draws
either the Year view (`opening-hours-year.ts`), the Month view (`opening-hours-month.ts`), a
painter on top of one of them, or another module's view such as Staffing
(`packages/staffing/src/dashboard/staffing-month.ts`). The work adds four small pieces and changes
the two views and the screen to use them:

- a **Year / Month switch** the screen draws and hands to the shown view to place in its own
  toolbar row (Part 1);
- **`zoneOwnHours`**, a pure function that works out a zone's own opening hours from its
  department's hours less the zone's closures, with the closures clipped to the department's hours
  (Part 2) — the Month view, the day box and later A722's Week view all draw from it;
- **`calendar-day-box`**, a presentational floating box (a native popover) that Opening hours and
  Staffing each fill with their own lines and buttons (Part 3, reused in Part 5);
- **`DayPicker`**, a reusable controller for picking days on a grid of date buttons by click, drag,
  shift-click, double-click, long press and keyboard (Part 4) — A723 point 7 puts the special-day
  editor's date picker on it.

Nothing on the server changes. No read gains a field: the day box takes everything it shows from
the month read the Month view already uses (`readOpeningHoursMonth`,
`packages/venue-service/src/opening-hours-calendar.ts:210-262`) and from Staffing's month read
(`readStaffingMonth`, `packages/staffing/src/month.ts:9-55`).

**Tech Stack:** TypeScript, Lit, the shared `wt-*` primitives, Vitest — real headless Chromium for
everything under `src/dashboard/` (the `browser` project in both packages' `vitest.config.ts`), and
the `node` project for the one pure module outside it.

**Spec:** backlog entry A720 in `docs/backlog.md` and its detail section "A720. The Calendar's Year
and Month views…" in `docs/backlog/service-periods.md`, plus the A719, A721, A722 and A723
sections beside it (they build on this one) and A724 point 3 in `docs/backlog/workforce.md` (the
same as A720 point 7). Mockups: `docs/backlog/mockups/a718-a727-calendar-and-stations/01-year-view.png`,
`03-month-view.png` and, for Part 5, `10-staffing-month.png`; read that folder's `README.md`.
Line numbers are against `main` at `3b1a13010`, before Part 1; Parts 2–5 find each place by the function or selector named beside it.
Look at the three pictures before starting any task. The owner reviewed every item and its mockups;
there are no open owner questions. Where this plan departs from a drawing, it says so and why
("Decisions" below).

**Migration: no.** No table, column or stored value changes: the views are redrawn from reads that
already exist. The Week view is A722 and a stored colour per season is A721 (whose landing deletes
the open note "Season colours differ between Opening hours' Year and its month").

---

## How the work is cut

Five pull requests. Each leaves `main` green and the Calendar fully usable on its own: nothing is
removed before what replaces it has landed.

| Part | Branch | What it delivers | Spec points | Tasks | Can start |
| ---- | ------ | ---------------- | ----------- | ----- | --------- |
| 1 | `feat/a720-1-calendar-toolbar` | Year / Month switch instead of the tab row; month names drawn as links; the colour key, the "included" and "Town holidays" sentences, "+ Special day", the Month's "‹ 2026" row, its "Rows:" line and its season chips go | 1, 2 | 4 | Now |
| 2 | `feat/a720-2-zone-hours` | A zone's bar shows the zone's own hours, its closures only inside the department's hours; a closed department or zone is an empty grey bar | 5, 6 | 4 | After Part 1 (same files) |
| 3 | `feat/a720-3-day-box` | Clicking a day in the Year or the Month opens a floating day box; the Year's date panel, its Delete confirmation and the Month's ordinary-date dialog go | 3 | 7 | After Part 2 (the box's zone lines use `zoneOwnHours`) |
| 4 | `feat/a720-4-day-picking` | Days picked on the grid: click, drag, shift-click, double-click or long press, arrows, Shift+arrows, Enter; the special-day editor opens on a run of dates | 4 | 4 | After Part 3 (a click both picks and opens the box) |
| 5 | `feat/a720-5-staffing-day-box` | Staffing's month: no seasons row or legend; every day opens the same day box with "Edit {special day} staffing" or "Edit {season}'s standard week" | 7 | 2 | After Part 3; can run beside Part 4 |

Part 4 and Part 5 touch different packages apart from `docs/`, so they can be built at the same
time. **Whichever of Parts 4 and 5 lands second deletes the A720 entry** (Global constraints,
"Backlog").

### Decisions this plan makes (the owner may overrule any of them at review)

1. **No Week button until A722.** The switch offers Year and Month only. A disabled Week would be a
   button that does nothing; leaving it out is the most conservative choice, and today's
   `/view/week` addresses keep opening the season painter (`opening-hours-screen.ts:221-231`,
   pinned by "offers no Real week switch and ignores a week in the address",
   `opening-hours-screen.test.ts:1700`). Seam: the switch is drawn from a list of views; A722 adds
   `week` to it.
2. **No "Open this week" button in the day box until A722**, for the same reason. Seam: the box's
   buttons are whatever the host puts in its slot; A722 adds one more. The screen remembers the last
   day whose box opened (`lastDay`, Part 3), which is A722 point 3's "the day last clicked".
3. **No "Seasons…" button until A721, and the chips keep their ✎ and "+ Season" until then.**
   Point 2's "no ✎" and "Seasons…" describe the state after A721: today the ✎ and "+ Season"
   (`season-chips.ts:246-268`) are the only way to rename, move, add or delete a season, and A721
   point 1 already says "The separate season editor and the chips' ✎ go". Removing them here would
   leave the venue with no season editor. Seam: the Year view draws the chips in a row of their
   own (`season-chips` at `opening-hours-year.ts:582-588`); A721 adds "Seasons…" at the end of that
   row, and A719 adds "Periods…" beside it.
4. **Month from Year opens:** the month of the day whose box last opened in the shown year (from
   Part 3); otherwise the month holding the venue's today when the shown year holds it; otherwise
   January of the shown year. **Year from Month opens** the shown month's year — what "‹ 2026"
   does today (`opening-hours-month.ts:585-597`, written at `opening-hours-screen.ts:978-986`).
5. **Holiday-coverage warnings stay.** Point 2 removes the sentence "{year}: official national and
   regional holidays are included." and the "Town holidays…" line, and keeps "Public holidays for
   {year} are not available yet". The other coverage sentences say something is wrong (the
   province is not recognised, the country has no list, the holiday area must be chosen, coverage
   could not be read — `strings.ts:653-663`, `calendar.area_required` at `strings.ts:57-58`), and the
   mockup's note A says "If a year's official holiday list is missing, a warning still shows here".
   So only the "complete" sentence and the town line go. The holiday-area chooser
   (`opening-hours-year.ts:438-478`) is not named by the spec and stays.
6. **Station mode is untouched.** The Month view also draws the Times tab of Prep stations
   (`stationMode`, `opening-hours-month.ts:307`; used by `station-times-tab.ts:250-260`), which A725
   retires. Its "No orders" lines, its "Rows:" legend and its key-only season chips stay, its days
   stay plain (no box), and the station-times tests are not changed.
7. **A viewer gets the day box too.** The spec gives no viewer exception, and the Year already lets
   a viewer open its date panel (pinned by "sends nothing and offers no actions when read-only",
   `opening-hours-year.test.ts:415`). A viewer's box has no special-day button and offers "Show
   {season}'s standard week", which opens the read-only painter as a viewer's chip does today
   (`season.week_shown`, `season-chips.ts:235`). In the Month view a viewer's days become
   buttons (today they are plain, `opening-hours-month.ts:514-523`). In Staffing a viewer's box
   offers "Show {special day} staffing" and "Show {season}'s standard week", which keeps what a
   viewer can open today (a special day's date and the season chips, `staffing-month.ts:434-435`).
8. **Make a special day / Edit special day replace the ordinary-date dialog and the Year's Delete
   confirmation.** The dialog (`ordinary-date-dialog.ts`) also offered "Or add it to an existing
   special day"; the box does not, as drawn. A date is added to an existing special day from that
   day's editor, whose date picker already does it (`add-dates-calendar.ts`). A special day is
   deleted from its editor, which has its own confirmation (`deleteDialog`, `special-day-painter.ts:1418-1455`); the
   screen's copy (`namedDialog`, `opening-hours-screen.ts:853-893`) goes.
9. **Pointing at a holiday or special day in the Year shows its name through the button's `title`**
   (the browser's own tooltip), as the editor's date picker already does for a date another day
   holds (`add-dates-calendar.ts:340`). The mockup's styled tooltip would be a new shared primitive;
   the button's spoken name already carries the name (`opening-hours-year.ts:407-414`).
10. **Keyboard:** the arrows move and pick one day, Shift with an arrow extends the run, **Enter opens
    the special-day editor** (the double-click), and **Space opens the day box** (the click). For a
    viewer, Enter and Space both open the box, as on any button. Enter is taken only from a real
    `keydown`; the day's `click` (however it arrives) always opens the box. **Side effect for a
    screen-reader user:** in a screen reader's reading mode, Enter on a button is sent to the page as
    a click, not a key press, so it opens the day box, not the editor. From the box they reach the
    editor for that one day ("Make a special day" / "Edit special day"); a run is picked and opened
    with Shift+arrows and Enter in the screen reader's focus mode, where keys reach the page. The
    design-system.md update in Task 4.4 says so.
11. **A run on a phone** (the coordinator is also putting this to the owner as a question). Spec
    point 4 has a long press open the editor "with those dates", so a phone user must be able to
    pick a run, but a drag that starts at once would stop the page scrolling under a finger. So, on
    a touch screen: a tap picks one day and opens its box; a finger that moves before the long press
    fires scrolls the page as usual and picks nothing; **a long press starts picking at that day**;
    moving the finger after the long press has fired extends the run (only from that moment is the
    page's scroll blocked); lifting the finger after a long press with no move opens the editor on
    that day, or on the picked run when the pressed day is inside it; lifting it after a move leaves
    the run picked, and a long press inside the run then opens the editor on it. The owner may
    overrule this.
12. **A run that crosses another special day's date** opens a new special day holding every date of
    the run; the editor's Save is then refused for the held date, naming it beside Save as today
    (`special_day.date_taken`, `special-day-painter.ts:844-851`). A double-click or long press **on**
    a date a special day holds opens that special day instead, whatever is picked.
13. **Staffing's box lists each area with the number of people the month already reads**
    (`StaffingMonthArea.needed`, `packages/staffing/src/staffing-types.ts:78-82`). The mockup's role
    names and times ("Head chef ×1 16:00–01:30") need the month read to carry each block; that read
    change is A724's (Part 5 adds a one-line backlog entry for it). The Staffing month gets no
    Year / Month switch: Staffing has no Year or Week view to switch to, though board 10 draws one.
14. **Staffing's "Bars: people needed per area" legend goes with the seasons row**
    (`staffing-month.ts:440-453`): it sits in that row and board 10 has no legend.

---

## Global constraints

- **Work in a worktree:** `python3 ~/workspace/tools/worktree.py new waitron <branch> --headless`,
  one per part, branch names in the table above. Every commit `git commit -s`.
- **Test first.** Every task writes its failing test, runs it, and sees it fail for the reason the
  task states, then writes the code. A test that passes before the code exists is not a test of the
  change.
- **Which tests run where.** `src/dashboard/**` runs in real headless Chromium. Before a browser run,
  check memory (`memory_pressure | grep free`) and run beside another session's browser run only
  when free memory is well above 15%. Focused runs:

  ```bash
  pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/<file>.test.ts
  pnpm --filter @waitron/venue-service exec vitest run --project node src/zone-own-hours.test.ts
  pnpm --filter @waitron/staffing exec vitest run --project browser src/dashboard/<file>.test.ts
  ```

  Read the `Tests` count; a run without one proves nothing (CLAUDE.md §4). Each part ends with
  `pnpm --filter @waitron/venue-service test:coverage` (and `@waitron/staffing` for Part 5) while
  chasing the 98/98/98/95 bar for new files; CI owns the package suites.
- **Every implementer dispatch** also runs `pnpm format:check` and `pnpm --filter <pkg> typecheck`
  and `lint` for the packages it touched.
- **Changing an existing test check.** The owner's rule of 2026-10-05: a check may change when this
  item's spec changes what it checks, and every such change is listed. Each task below lists the
  checks it changes and why ("Existing checks that change"). A check that is not listed is not
  touched. Where only HOW a test reaches a screen changes (a tab helper becomes a switch helper, a
  click on the date panel's button becomes a click on the day box's button), the behavioural
  assertions after it stay word for word.
- **Strings.** Every new string goes in both `en` and `es` in the screen's own `strings.ts`
  (`packages/venue-service/src/dashboard/strings.ts`, `packages/staffing/src/dashboard/strings.ts`).
  The Spanish table is typed `Record<keyof typeof en, string>` (`venue-service strings.ts:855`), so a
  missing Spanish string fails the typecheck. Product text is as short as the meaning allows (owner
  standing rule). A key the change leaves unread is deleted in the same task, after
  `git grep '"<key>"' -- packages apps` shows no reader.
- **Events** follow design-system.md → Event discipline: a shared component's events are named
  `wt-*` only in `packages/ui`; these are app-owned, named plainly, `bubbles: true, composed: true`.
- **Tokens only.** Every colour, spacing and radius reads a `--wt-*` token
  (`scripts/style-token-names.test.ts`).
- **A popover is placed before its first paint** (CLAUDE.md §4): show it and position it in the same
  task, as `placePopover` does (`paint-grid-parts.ts:103-110`), never from the `toggle` event.
- **A click whose outcome depends on update order is tested with `userEvent.click`**, not
  `element.click()` (CLAUDE.md §4). **Drags and long presses are driven by the real browser**, never
  by hand-made `PointerEvent`s, which skip what a real drag does (pointer capture, `pointercancel`,
  the click the browser sends after it, a scroll taking the gesture). Task 4.1 adds browser
  commands for this, as `parkPointer` drives the real mouse with `page.mouse`
  (`packages/ui/src/vitest-park-pointer.ts:15-18`).
- **No task leaves the branch's suites red.** A task that removes something removes, in the same
  task, every test that reached it, and a task that changes what a view sends adds the screen's
  listener for it in the same task. Each task names the test files it must run before its commit;
  "the screen test files" means all five of `opening-hours-screen.test.ts`,
  `opening-hours-screen.painter.test.ts`, `opening-hours-screen.special-day.test.ts`,
  `opening-hours-screen.unsaved.test.ts` and `opening-hours-screen.a11y.test.ts`.
- **Review path: FULL for every part** — the queue sets it for this item. The switch, the day box
  and the picker are a dashboard contract that A719, A721, A722, A723 and A724 build on, and Part 3
  adds a cross-package export that Part 5 consumes. Per-task reviews, then `/finish-branch` with the
  Codex run-it seat twice (the second told to set this plan aside and test what it does not name).
- **Ledger.** Keep `docs/handoffs/2026-10-15-a720-calendar.md` (gitignored; never in a pull request)
  opening with `Status: in progress`: what is done, decisions taken, and the exact next step with
  its worktree and branch. Update it at the end of every task; set `Status: done` when the last part
  lands.
- **Backlog.** Each part edits `docs/backlog.md` and `docs/backlog/service-periods.md` in the same
  pull request:
  - Parts 1–3 and the first of Parts 4/5 to land leave the A720 entry in place and rewrite its last
    sentence to name the points still open, e.g. "Points 1–2 landed in #NNNN; 3–7 remain." They
    delete their own points' paragraphs from the detail section's numbered list, keeping the other
    points' numbers.
  - A sibling that cites a deleted point is rewritten in the same change to name the code instead
    (listed per part below), so no entry points at nothing.
  - The second of Parts 4/5 to land deletes the A720 entry from `docs/backlog.md` and the A720
    section from `service-periods.md`, moves the decisions above that a later item relies on into
    that file's "Decisions and deliberate limits" (Task 4.4 / 5.2 say which), and rewrites every
    other mention of A720 so none points at a deleted entry: in `service-periods.md`, A719's "Lands
    after A720, whose toolbar holds the button." (`:246`, becomes "Its button goes on the Year
    view's season row."), A721 point 1's "opened from the Calendar (A720)" (`:296`, becomes "opened
    from a Seasons… button on the Year view's season row"), A722's "Depends on A720." (`:309`,
    deleted); in `docs/backlog.md`, the "After A720." in the A719 and A722 entries (`:1531`,
    `:1545`, deleted). The mockups README's job table (`README.md:11`) is an index of what was
    drawn and keeps its A720 row.
- **LOOK, every part** (CLAUDE.md §4 "A page asserted as a STRING… has nothing checking that it
  renders"). Use the dev stack from the part's worktree: `wa-wt demo <worktree-name>` (never a bare
  `pnpm dev*`; check `lsof` on the venue folder and port 8080 before any `wa-wt reset`). Open the
  pages the task names at 390 px and 1280 px wide, in the light and dark themes, with the
  workspace's Playwright Chromium. Set `data-theme` on `document.documentElement` (not `#app`),
  read and record `window.innerWidth` and the computed background of the page and of the day box,
  and reject a capture whose light and dark colours are the same (testing-guide.md, "A page asserted
  as a STRING"). Save pictures outside the repository or under an ignored `__screenshots__/look/`
  folder. If the demo venue lacks a case the part draws (a zone closed past its department's close,
  a special day, a public holiday), paint it in the dashboard first and say so in the PR.
- **Coordinate with A585.** `feat/a585-6-rota-by-area` (worktree
  `waitron-feat-a585-6-rota-by-area`) was at `4166579d5` on 2026-10-15; its diff against `main`
  changes `packages/staffing/src/month.ts`, `staffing-types.ts` and `dashboard/staffing-month.ts`
  (`git diff --stat main...HEAD` in that worktree), adding `unfilled` counts to the month and
  Monday "Rota for this week" links. Part 5 rebases over it if it lands first, and then its day box
  also shows each area's unfilled count and offers the Rota link as one more button.

---

# Part 1 — one toolbar row, less on top (points 1 and 2)

Branch `feat/a720-1-calendar-toolbar`, from `main`.

**Today:** the Year and the Month are drawn inside a `wt-tabs` holding one tab, "Year"
(`opening-hours-screen.ts:1000-1053`, imported at `:19`); the Month draws inside that same tab's
slot. The Year's own row holds ‹ year › and "+ Special day" (`opening-hours-year.ts:565-581`), then
the season chips (`:582-588`), the colour key (`:589-600`), "not available yet" (`:601-607`), the
missing-holiday warnings and the holiday area (`:608`), and the coverage and town-holiday sentences
(`#notes`, `:506-522`). Month names are plain bold buttons (`.month-name`, `:134-145`,
`:369-377`). The Month draws a "‹ 2026" button on a row of its own (`opening-hours-month.ts:585-597`),
then ‹ month ›, the Show picker and "+ Special day" (`#tools`, `:624-639`), then the season chips and
the "Rows:" line (`:653-670`).

### Task 1.1: The Year / Month switch replaces the tab row

**Files:**
- Modify: `packages/venue-service/src/dashboard/opening-hours-screen.ts` (`render`, `:993-1057`;
  drop the `wt-tabs` import, `:19`)
- Modify: `opening-hours-year.ts`, `opening-hours-month.ts` (a `<slot name="switch">` after › in
  `.head`; the month's goes before the Show picker)
- Test: `opening-hours-screen.test.ts`, `opening-hours-screen.a11y.test.ts`, and the mount helpers
  of `opening-hours-screen.painter.test.ts`, `opening-hours-screen.special-day.test.ts`,
  `index.test.ts`, `service-delete-editors.test.ts`

**Interfaces:**
- The screen draws, as a light-DOM child of the shown view,
  `<div slot="switch" class="segmented" role="radiogroup" aria-label=${t("opening.view")} data-test="view-switch">`
  holding one radio per view, `name="calendarSpan"`, values `year` and `month`, styled by the
  screen's existing `segmentedStyles` (`segmented-styles.ts`, already in the screen's styles at
  `opening-hours-screen.ts:74`). The views list is a constant `SHOWN_VIEWS = ["year", "month"]` that
  A722 extends.
- Choosing Year writes `{ view: "year", year: <shown month's year>, month: null, date: null }`;
  choosing Month writes `{ view: "month", month: <Decision 4>, year: null }`, both through
  `this.url.write` then `followUrl`, as `openMonth` does (`opening-hours-screen.ts:535-545`). The
  address keeps its other words (`department`, `?keep=yes`).

- [ ] **Step 1: Failing tests** in `opening-hours-screen.test.ts` (new `describe("the Year / Month switch")`):
  1. "offers Year and Month, Year chosen, in the Year's toolbar row": on
     `/manage/opening-hours/view/year`, `[data-test=view-switch]` exists, its radios' values are
     `["year", "month"]`, labels `["Year", "Month"]`, `year` checked; it is assigned to
     `opening-hours-year`'s `slot[name=switch]` (`assignedSlot.name === "switch"`); at 1280 px its
     box's vertical middle lies between the top and bottom of the `[data-test=next-year]` button.
     Fails today: no `[data-test=view-switch]`.
  2. "Month from the Year opens the month holding today, or January": with the clock at
     2026-10-12, choosing Month on `/view/year/year/2026?keep=yes` writes
     `/manage/opening-hours/view/month/month/2026-10` and keeps `?keep=yes`, and
     `opening-hours-month` shows `2026-10` with Month checked; on `/view/year/year/2027` it writes
     `/view/month/month/2027-01`. Fails today: no switch.
  3. "Year from the Month opens that month's year, keeping the department":
     `/view/month/department/bar/month/2026-12` → Year writes
     `/view/year/department/bar/year/2026` (the department word is kept, as `month-year-open` keeps
     it today). Fails today: no switch.
  4. "fits a phone's width": at 390 px (`page.viewport(390, 800)`, read `window.innerWidth` and
     assert it is 390), on the Month with All departments, every child of the month's `.head`
     (‹, the heading, ›, the switch, Show) ends inside the screen's right edge. Fails today: no
     switch (the query for it returns null).
  In `opening-hours-screen.a11y.test.ts`, add to the `describe.each(["light", "dark"])` block two
  states: "the Year / Month switch on the Year" and "the Year / Month switch on the Month", each
  waiting for `[data-test=view-switch]` and running `expectNoA11yViolations`. Fails today: the
  switch is never drawn, so the wait times out.

- [ ] **Step 2: Run** them; see each fail on the missing switch.

- [ ] **Step 3: Implement.** Remove the `wt-tabs` block (`opening-hours-screen.ts:1000-1053`) and its
  `[slot=year]` wrapper; draw the read-error lines and the view directly. Pass the switch as a
  slotted child of whichever view is shown (not in station mode, which the screen never draws).
  Add `<slot name="switch"></slot>` after the › button in both views' `.head`. Strings:
  `opening.view` "View" / "Vista", `opening.view.year` "Year" / "Año", `opening.view.month`
  "Month" / "Mes"; delete `opening.tab.year` (`strings.ts:167`, `:1022`).

- [ ] **Step 4: Existing checks that change** — the tab row they read is gone (point 1); each
  becomes the same assertion about the switch:
  - The mount helpers that wait for `wt-tabs` wait for `[data-test=view-switch]` instead:
    `opening-hours-screen.test.ts:149`, `opening-hours-screen.painter.test.ts:97` and `:110`,
    `opening-hours-screen.special-day.test.ts:154`, `index.test.ts:274`,
    `service-delete-editors.test.ts:203`. The switch is drawn exactly when the tab row was (once the
    model has loaded and Opening hours, not a module view, is shown).
  - "the tab is Year" (`tabs(el).value === "year"`) becomes "the switch's checked value is year" at
    `opening-hours-screen.test.ts:156`, `:168`, `:346`, `:995`, `:1015`, `:1167`, `:1175`;
    `opening-hours-screen.painter.test.ts:155`; `opening-hours-screen.special-day.test.ts:195`,
    `:320`. The `tabs` helpers (`opening-hours-screen.test.ts:990-991`, `:1334-1335`,
    `painter.test.ts:126-127`, `special-day.test.ts:182-183`) become a `checkedView(el)` helper.
  - "the tab list is just Year" becomes "the switch offers Year and Month":
    `opening-hours-screen.test.ts:996-997`, `:1366`, `:1720-1729`, `:1732-1741`;
    `painter.test.ts:363`, `:380`. The point of the last four (a retired view word opens no extra
    view) is kept: the list stays `["year", "month"]`.
  - On the Month, the tab read Year; the switch reads Month (point 1, "Year in the switch goes
    back"): `opening-hours-screen.test.ts:1223` ("opens that month when a month's name is chosen"),
    `:1365`, `:1655`.
  - `"drops the year from the address when a tab is chosen, as a month's name does"`
    (`opening-hours-screen.test.ts:1156`) is deleted: choosing the already-checked Year fires no
    change, so the case it pinned cannot happen. Its replacement is Step 1's test 3.
  - `"[slot=year] …"` selectors lose the `[slot=year]` part (the wrapper is gone):
    `opening-hours-screen.test.ts:1255`, `:1367`, `:1430`, `:1465`.
  - `opening-hours-screen.test.ts:1426` dispatches a `wt-tab-change` only to move to the Year before
    a `popstate`; the step is dropped (the `popstate` that follows sets the address).
  - Module views: "no own tab row while a module view shows" (`wt-tabs` null/not null at
    `opening-hours-screen.test.ts:1814`, `:1821`, `:1830`, `:1835`, `:1881`, `:1895`, `:1921`,
    `:1990`) reads `[data-test=view-switch]` instead.
  - `index.test.ts:279` and `:284` use "+ Special day" absent / present as the sign that
    `render(true)` and `render(false)` gave a read-only and a writable screen. The button goes in
    Task 1.2, so they read `opening-hours-year`'s `readOnly` (`true`, then `false`) instead.

- [ ] **Step 5: Run** the screen test files, `index.test.ts`, `service-delete-editors.test.ts`
  and the screen's a11y file; all pass. Commit `"A720-1: a Year / Month switch replaces the tab row"`.

### Task 1.2: The Year's top: no colour key, no "included" or town sentence, no "+ Special day"; month names look like links

**Files:** Modify `opening-hours-year.ts`, `strings.ts`. Test `opening-hours-year.test.ts`,
`opening-hours-screen.test.ts`, `opening-hours-screen.special-day.test.ts`, `index.test.ts`.

**"Every hint line" (point 2), counted on `main`:** the lines above the months that explain rather
than report are the colour key (`opening-hours-year.ts:589-600`), the "included" coverage sentence
and the town-holiday line (`#notes`, `:506-522`) in the Year, and the "Rows:" line in the Month
(`opening-hours-month.ts:662-669`). After Part 1 none of them is drawn outside station mode. What
stays reports something to act on: "not available yet" (`:601-607`), the missing-holiday warnings
(`#warnings`, `:524-537`), the coverage sentences that say something is wrong (Decision 5), and the
holiday-area address message (`area-address`, `:439-442`). The holiday-area chooser's own hint,
"Choose the area" (`holidays.area_hint`, `:452`), is a field's hint, not a hint line, and stays.

- [ ] **Step 1: Failing tests** in `opening-hours-year.test.ts`:
  1. "draws no colour key, no + Special day and no sentence for a complete official list": with
     the fixture's complete coverage, `.legend`, `[data-test=add-special-day]`,
     `[data-test=coverage]` and `[data-test=town-holidays]` are all absent. Fails today: all four
     are drawn (`opening-hours-year.ts:569-600`, `:514-521`).
  2. "still warns when the official list is not complete": for each of `missing_year`,
     `unknown_region`, `unsupported_country`, `area_required` and no coverage entry, a
     `[data-test=coverage]` line is drawn with that state's sentence (`missing_year` only when
     `publicHolidaysAvailable` is true, as today, `:509-513`). This passes today; it is written
     first so Step 3 cannot drop the warnings with the "complete" sentence. Make it fail once by
     hand (render nothing in `#notes`) to see it catch that, then restore.
  3. "draws each month's name as a link": `[data-test=month-name]`'s computed `color` equals the
     computed value of `--wt-color-primary-text` read from a probe element, its `::after` content
     is `" ›" / ""` (read with `getComputedStyle(el, "::after").content`; the `/ ""` gives the
     arrow empty alternative text, and a browser that refused the syntax would drop the whole
     declaration, which this check would see), and its `textContent` stays the month's name
     ("January"). Fails today: the name is `--wt-color-text` (`:138`) with no `::after`.

- [ ] **Step 2: Run** and see 1 and 3 fail.

- [ ] **Step 3: Implement.** Delete the `.legend` list and its CSS (`:76-105`, `:589-600`), the
  "+ Special day" button (`:569-580`, `.head .add` CSS `:70-72`), the town line (`:516-520`) and
  `listLacksLocalHolidays` (`:29-37`); draw the coverage line only when
  `coverage?.nationalRegional !== "complete"`. Style `.month-name` with
  `color: var(--wt-color-primary-text)` and `::after { content: " ›" / ""; }`. Delete the keys
  `year.add_special`, `year.town_holidays`, and `calendar.public` if Task 1.3 leaves no reader
  (`calendar.special_day` is still read by `ordinary-date-dialog.ts:119-122` until Part 3).

- [ ] **Step 4: Existing checks that change** (point 2 removes what they read):
  - `"marks public holidays, special days and closed days, with a legend of the three"`
    (`opening-hours-year.test.ts:247`): the three-item legend assertion (`:266-270`) is deleted and
    the title loses ", with a legend of the three". The marks, tones and spoken names stay.
  - `"opens an empty special day from + Special day"` (`:323`) is deleted with the button.
  - `"sends nothing and offers no actions when read-only"` (`:415`): its
    `add-special-day` absent line (`:418`) is deleted (no one gets the button now); the rest stays.
  - `"states what the official lists cover, and that town holidays are not in them"` (`:445`) is
    rewritten as Step 1's test 1 (the "complete" sentence and the town line are what point 2
    removes); its two "no warning" lines (`:453-454`) stay in it.
  - `"says town holidays are not in the official lists for each way the list lacks them"` (`:457`)
    is deleted: the line no longer exists in any case.
  - `"says when the year's public holidays are not available yet, under the legend"` (`:472`): the
    sentence check stays; "under the legend" (`previousElementSibling` is `.legend`, `:478` and
    `:488`) becomes "it is the first line under the season chips" and the title loses "under the
    legend". The check that the warnings follow it (`:489`) stays.
  - `"warns once per repeating date with no public holiday of its name this year"` (`:493`): "directly
    under the legend" (`:514-517`) becomes "directly under the season chips"; of the two things it
    checks follow the warnings (`:518-522`), the holiday-area chooser stays and the coverage line is
    dropped, because the fixture's coverage is `complete` (`:92`) and that sentence is no longer
    drawn.
  - `"speaks Spanish"` (`:612`): the `add-special-day`, `town-holidays` and legend assertions
    (`:623`, `:630-637`) are deleted; "enero", the unavailable line and the missing-holiday line
    stay.
  - Screen tests that click the Year's "+ Special day", deleted in this task so the branch stays
    green: `opening-hours-screen.test.ts` `"+ Special day opens an empty special-day painter"`
    (`:1264`), and the Year row of `opening-hours-screen.special-day.test.ts` `"+ Special day in the
    %s opens a new empty special day"` (`:527`; the Month row goes in Task 1.3). Opening an empty
    new day by address stays pinned by `"opens a new empty special day when the address names
    none"` (`special-day.test.ts:203`).
  - `index.test.ts:279` and `:284`, if Task 1.1 has not already changed them.

- [ ] **Step 5: Run** `opening-hours-year.test.ts`, `opening-hours-year.a11y.test.ts`,
  `opening-hours-screen.test.ts`, `opening-hours-screen.special-day.test.ts` and `index.test.ts`.
  Commit
  `"A720-1: the Year shows only what needs action above its months"`.

### Task 1.3: The Month's top: switch and Show in one row; no "‹ 2026", "+ Special day", "Rows:" or season chips

**Files:** Modify `opening-hours-month.ts`, `opening-hours-screen.ts` (in `month()`, `:952-992`:
the `month-year-open` listener `:978-986` goes, and so do `.api`, `.specialDays` and the
`season-dialog-open`, `season-week-open` and `season-changed` listeners `:963-973`, which only the
Month's chips used), `strings.ts`. Test `opening-hours-month.test.ts`,
`opening-hours-month.a11y.test.ts`, `opening-hours-screen.test.ts`,
`opening-hours-screen.special-day.test.ts`, `station-times-tab.test.ts`,
`station-times-tab.a11y.test.ts`, `prep-stations-screen.a11y.test.ts`.

Once the chips leave the Month outside station mode, the Month's `api` and `specialDays` properties
(`opening-hours-month.ts:302-304`) have no reader: station mode draws the chips `keyOnly`
(`:660`), which writes nothing and needs neither, and `station-times-tab.ts:250-260` passes
neither. Delete both properties and stop handing the chips `api` and `specialDays` in station mode.

- [ ] **Step 1: Failing tests** in `opening-hours-month.test.ts`:
  1. "draws only ‹ month ›, the switch's slot and Show above the dates": outside station mode,
     `[data-test=year-back]`, `[data-test=add-special-day]`, `[data-test=rows]` and `season-chips`
     are absent, and `.head` holds, in order, `[data-test=previous-month]`, `[data-test=month]`,
     `[data-test=next-month]`, `slot[name=switch]`, `wt-combobox[name=departmentId]`. Fails today:
     the year-back row, the button, the Rows line and the chips are drawn.
  2. "keeps station mode as it was": with `stationMode`, `season-chips` is present with `keyOnly`,
     and with two rows the `[data-test=rows]` line reads "Rows: Restaurant · Bar". Passes today;
     written first to hold Decision 6 while Step 3 deletes code beside it.

- [ ] **Step 2: Run** and see test 1 fail.

- [ ] **Step 3: Implement.** Delete the "‹ year" button and its CSS (`.year-back` at `:80-88` and the `.year-back:focus-visible` selector at `:168`, beside `button.day`'s, which stays), and the button at `:585-597`,
  the "+ Special day" button (`:627-638`), and, outside station mode, the `.sub` row
  (`:653-670`). In station mode keep the chips and the Rows line exactly as they are. Delete the
  screen's `@month-year-open` listener. Delete `month.year_back`, and `year.add_special` if Task
  1.2 has not. Keep `month.rows` (station mode reads it).

- [ ] **Step 4: Existing checks that change:**
  - `"draws a bar per department…"` (`opening-hours-month.test.ts:219`): the `"Rows: Restaurant · Bar"`
    line (`:237`) is deleted (point 2 removes the Rows line); bars, colours and positions stay.
  - `"with one department chosen, draws it and a bar per zone…"` (`:268`): the Rows line (`:279`) is
    deleted; the rest stays (Part 2 changes it again).
  - `"steps a month either way from the requested month, and goes back to the year"` (`:302`): the
    year-back half (`:308-312`) is deleted and the title loses ", and goes back to the year"; the
    Year's way back is the switch, pinned by Task 1.1's test 3.
  - `'sends "+ Special day" as the year view does'` (`:411`) is deleted with the button.
  - `"read-only, hides the write actions and opens nothing from a date"` (`:420`): the
    `add-special-day` line (`:422`) is deleted, and `season-chips`' `readOnly` (`:423`) becomes
    "no `season-chips` is drawn". The day-button and name checks stay (Part 3 changes them).
  - `"passes the seasons the month touches to the chips"` (`:539`): rewritten to mount in station
    mode (`stationModel()`, `STATION`), where the chips still draw; the season ids and clock
    revision checks stay.
  - `opening-hours-month.a11y.test.ts`: unchanged (it asserts no removed part outside station mode).
  - `opening-hours-screen.test.ts` `"steps months through the address, goes back to the year, and
    writes the chosen department"` (`:1382`): the `year-back` click (`:1416`) becomes a choice of
    Year on the switch; the address it checks (`/view/year/year/2026`) and the rest stay.
  - `opening-hours-screen.special-day.test.ts` `"+ Special day in the %s opens a new empty special
    day"` (`:526-549`): its Month row (`:528`) is deleted with the button, and with it the whole
    `it.each` (Task 1.2 deleted the Year row).
  - `opening-hours-screen.test.ts` `"draws the month the address names from that month's read…"`
    (`:1354`): `expect(month.api).toBe(el.api)` (`:1364`) is deleted with the property it read,
    which fed only the chips point 2 removes.

- [ ] **Step 5: Run** the month files, `station-times-tab.test.ts`, `station-times-tab.a11y.test.ts`,
  `prep-stations-screen.a11y.test.ts` and the screen test files.
  Commit `"A720-1: the Month keeps ‹ month ›, the switch and Show on one row"`.

### Task 1.4: Part 1's docs, backlog and LOOK

- [ ] `docs/developers/design-system.md`: rewrite the Opening hours paragraph that says "with a Year
  tab; the month (`/view/month`) shows under the Year tab" (`:3734-3735`) and "A chosen view
  replaces the Year tab" (`:3741-3742`) to describe the switch; in the **Year** bullet
  (`:3775-3784`) drop "+ Special day"; in the **Month** bullet (`:3787-3800`) drop "‹ and the year
  go back to the Year", "+ Special day", the season chips and the Rows legend; in **Local
  holidays** (`:3815-3820`) drop the coverage and town-holiday sentences and say only what is
  wrong is reported.
- [ ] `docs/backlog.md`: the open note "Opening hours' create texts say 'New …' and '+ …'"
  (`backlog.md:4543-4547`) loses `year.add_special` ("+ Special day"). The note "Season colours
  differ between Opening hours' Year and its month" (`:1716-1719`) cites
  `opening-hours-month.ts:645` for the month's chips (on `main` they are drawn at `:654-661`),
  which this part removes outside station mode; point it at
  `seasonTints(model.seasons)` in `#grid` instead (the month's top borders still use it; A721
  deletes the note).
- [ ] A720 entry: "Points 1–2 landed in #NNNN; 3–7 remain." Delete points 1 and 2 from the detail
  section.
- [ ] LOOK: `/manage/opening-hours/view/year` and `/view/month/month/<this month>`, both themes,
  390 and 1280 px: one toolbar row (wrapping at 390 without sideways scroll), month names blue with
  "›", nothing between the chips and the months on a year with a complete list.

---

# Part 2 — a zone's own hours, closed rows as grey bars (points 5 and 6)

Branch `feat/a720-2-zone-hours`, from `main` after Part 1.

**Today:** a zone's row is drawn from its department's ranges with the zone's closures laid over
them as gaps (`#rows`, `opening-hours-month.ts:370-379`: `ranges: department.ranges, gaps:
zone.closed`), so each segment's tooltip and the date's spoken name give the department's times
(`#title`, `:407-413`; `#describe`, `:415-433`), and a closure past the department's close is drawn
where the department is already closed. A row with no hours draws the text "{name} closed" instead
of a bar (`:475-482`, `month.department_closed`), and at a phone's width a date closed all day hides
those lines (`:269-271`), so dates differ in height.

### Task 2.1: `zoneOwnHours`, a pure function

**Files:** Create `packages/venue-service/src/zone-own-hours.ts` and `zone-own-hours.test.ts` (the
`node` project). It imports only types and pure helpers, so the dashboard can import it as it
imports `../hours-rules.js`; A722's Week view and A723 point 5's server check can reuse it.

**Interfaces:**

```ts
export interface ZoneOwnHours {
  /** The department's ranges less the zone's closures, each piece keeping its period. */
  ranges: ServiceRange[];
  /** The zone's closures cut to the times its department is open, in day order. */
  closed: ClosedRange[];
}
export function zoneOwnHours(
  department: readonly ServiceRange[],
  closures: readonly ClosedRange[],
  day: { dayCutover: string; endMinute: number },
): ZoneOwnHours;
```

Times are compared as minutes after the day's changeover, a time at or before a start being on the
next clock day, exactly as the Month places them (`#placer`, `opening-hours-month.ts:384-395`), and
capped at `endMinute`. Every edge of a result piece is an edge of a range or of a closure, so the
result carries those `"HH:MM"` strings as written and never formats a minute back into a time.

- [ ] **Step 1: Failing tests** (`zone-own-hours.test.ts`), changeover 06:00, `endMinute` 1440
  unless stated:
  1. No closures: `ranges` equals the department's, `closed` is empty.
  2. A closure inside a block splits it: Dinner 20:00–23:00 less 21:00–22:00 → Dinner 20:00–21:00
     and Dinner 22:00–23:00; `closed` 21:00–22:00.
  3. A closure covering a block removes it.
  4. **The spec's Terrace case:** Open 18:15–02:00 less a closure 23:00–05:00 → Open 18:15–23:00,
     `closed` 23:00–02:00 (`service-periods.md`, A720 point 6).
  5. A closure spanning two blocks: Lunch 13:00–16:00 and Dinner 20:00–23:00 less 15:00–21:00 →
     Lunch 13:00–15:00, Dinner 21:00–23:00; `closed` 15:00–16:00 and 20:00–21:00.
  6. A closure wholly outside the hours (03:00–05:00 on a 10:00–23:00 day) → no `closed` piece.
  7. A range ending at the changeover (18:00–06:00) less 05:00–06:00 → 18:00–05:00.
  8. A 25-hour day (`endMinute` 1500): 22:00–07:00 less 05:00–07:00 → 22:00–05:00, `closed`
     05:00–07:00.
  9. A closed department (no ranges) → both lists empty, whatever the closures.
  10. **A zone closed for its department's whole day:** Open 10:00–23:00 less a closure 09:00–00:00
      (starting before opening, ending after closing) → `ranges` empty, `closed` 10:00–23:00. With
      Lunch 13:00–16:00 and Dinner 20:00–23:00 instead → `ranges` empty, `closed` 13:00–16:00 and
      20:00–23:00.
  Fails today: the module does not exist (import error).

- [ ] **Step 2: Run**, see the import fail. **Step 3: Implement** (subtract each closure from each
  span, as the server's private `subtract` does in `station-service-times.ts:37-54`, keeping the
  original strings). **Step 4: Run**, 10 pass. Commit `"A720-2: work out a zone's own hours"`.

### Task 2.2: The Month draws a zone's own blocks, and its closures only inside the department's hours

**Files:** Modify `opening-hours-month.ts` (`#rows`, `#title`, `#describe`, the gap drawing
`:493-505`). Test `opening-hours-month.test.ts`, `opening-hours-month.a11y.test.ts`.

- [ ] **Step 1: Failing tests** in `opening-hours-month.test.ts`:
  1. "draws a zone's blocks with the zone's own times": with Restaurant chosen, on 1 December
     (Terrace closed 20:00–22:00 in the fixture), the Terrace track's segment titles are
     `["Breakfast 08:00–11:00", "Lunch 13:00–16:00", "Dinner 22:00–23:00"]` and the Dinner segment
     starts at 16/24 of the bar. Fails today: the third title is "Dinner 20:00–23:00" and the
     segment starts at 14/24.
  2. "draws a closure only where the department is open": a model whose Terrace on 2 December is
     closed 22:00–03:00 draws one gap titled "Terrace closed 22:00–23:00", left 16/24, width 1/24,
     and the Dinner segment 20:00–22:00. Fails today: the gap is titled 22:00–03:00 and runs to
     21/24.
  3. "says a zone's own hours to a screen reader": with test 2's model and Restaurant chosen, the
     2 December button's `aria-label` contains
     "Terrace: Breakfast 08:00–11:00, Lunch 13:00–16:00, Dinner 20:00–22:00, Terrace closed
     22:00–23:00". Fails today: it reads "Dinner 20:00–23:00" and "closed 22:00–03:00".

- [ ] **Step 2: Run**, see the three fail. **Step 3: Implement:** `#rows` gives a zone row
  `zoneOwnHours(department.ranges, zone.closed, day)`'s `ranges` and `closed`; the track draws a
  zone's segments from those and its gaps from `closed` — but only while the zone has at least one
  open piece. **A zone closed for the whole of its department's hours draws no hatching**: it is a
  closed row, drawn as Task 2.3's empty grey bar and spoken "{zone} closed" (Task 2.3 test 5).

- [ ] **Step 4: Existing checks that change:** `"with one department chosen, draws it and a bar per
  zone with the zone's closed time as a gap"` (`opening-hours-month.test.ts:268`) — the gap's title,
  position and width (`:274-276`) and the segment count (`:277`, still 3) stay true and stay
  unchanged; nothing in it is edited. List here only so the reviewer knows it was checked.

- [ ] **Step 5: Run** `opening-hours-month.test.ts`, `opening-hours-month.a11y.test.ts`, the
  station-times-tab files and the screen test files. Commit
  `"A720-2: a zone's bar shows the zone's own hours"`.

### Task 2.3: A closed department or zone is an empty grey bar

**Files:** Modify `opening-hours-month.ts` (`:475-482`; `.closed-row` out of the selector lists it shares with `.name` at `:202-210`
and `:284-287`, and its own rules at `:257-259` and `:269-271`). Test `opening-hours-month.test.ts`, `opening-hours-month.a11y.test.ts`.

- [ ] **Step 1: Failing tests:**
  1. "draws a department closed that date as an empty bar": on Sunday 6 December, the cell holds
     two `.track`s (`data-row` `rest` and `bar`), the `rest` one with no `.segment`, and no
     `[data-test=department-closed]` text. Fails today: one track and the text "Restaurant closed".
  2. "keeps every date of a row the same height": Sunday 6 and Monday 7 December's `.day` heights
     are equal at 900 px, with no `min-height` doing the work — assert both cells hold the same
     number of `.track`s too. Fails today: Sunday has one track and a text line.
  3. "draws a date closed all day with a bar per row, at a phone's width too": on 25 December at
     302 px (the test file's `PHONE`), the cell holds two empty tracks with a non-zero height, and its
     name reads "Christmas Day · Closed". Fails today: two text lines, hidden at that width.
  4. "still says a closed department in words": the 6 December button's `aria-label` contains
     "Restaurant closed" (point 5 changes what is drawn, not what is spoken). Passes today (it is
     `opening-hours-month.test.ts:802`'s check); kept as the guard that Step 3 does not drop it.
  5. "a zone closed for its department's whole day is an empty grey bar, spoken closed": with
     Restaurant chosen and a model whose Terrace on 2 December is closed 07:00–05:00 (before
     breakfast to after dinner), the Terrace track has no `.segment` and no `[data-test=gap]`, and
     the date's `aria-label` contains "Terrace closed" with no time after it. Fails today: the
     department's three blocks are drawn with one hatched gap 07:00–05:00 over them, and the label
     reads the department's times then "Terrace closed 07:00–05:00".

- [ ] **Step 2: Run**, see 1–3 and 5 fail. **Step 3: Implement:** outside station mode, a row with no
  ranges draws an empty `.track` with its `data-row`; delete the `department-closed` span and the
  phone-width rule that hid it. Station mode's "No orders" lines (`:476-481` when `stationMode`)
  stay as they are. `#describe` keeps `month.department_closed` for the spoken name.

- [ ] **Step 4: Existing checks that change** (point 5 replaces the text with a bar):
  - `'reads "<department> closed" in place of the bar of a department with no hours that date'`
    (`opening-hours-month.test.ts:207`) is rewritten as Step 1's test 1.
  - `"shows special-day, holiday and closed names whole at a phone's width, wrapping them"`
    (`:632`): its loop over `department-closed` lines (`:640-644`) is deleted; the names loop stays.
  - `'reads "<name> · Closed" and one closed line per department on a date closed all day'`
    (`:647`): the name checks stay; the two `department-closed` text checks (`:658-661`,
    `:667-670`) become "two empty tracks, `rest` and `bar`" and, with Restaurant chosen, "`rest` and
    `terrace`". Title: "…and an empty bar per row…".
  - `"leaves out a closed date's department lines at a phone's width, where its name says Closed"`
    (`:673`) is deleted; Step 1's test 3 pins the opposite, which point 5 asks for.
  - `opening-hours-month.a11y.test.ts:101` requires a `[data-test="department-closed"]` in every
    state; it becomes a `.track` with no `.segment` (the empty bar) — the state still shows a closed
    row, now drawn the new way. The "draws a bar's empty track apart from its date" contrast case
    (`:55`) is what keeps the empty bar visible in dark; it stays.
  - Not changed: `station-times-tab.test.ts` and `.a11y.test.ts` (station mode keeps "No orders").

- [ ] **Step 5: Run** the month files, the station-times-tab files, the prep-stations a11y file and
  the screen test files.
  Commit `"A720-2: a closed row is an empty grey bar"`.

### Task 2.4: Part 2's docs, backlog and LOOK

- [ ] design-system.md **Month** bullet (`:3791-3793`): "a bar for it and one per zone with the
  zone's closed time drawn as a gap. A row with no hours that day says '<name> closed'" becomes the
  zone's own hours, its closures only inside the department's hours, and an empty bar for a closed
  row; "at phone width shows its names alone" goes.
- [ ] Backlog: A720 entry "Points 1, 2, 5 and 6 landed…"; delete points 5 and 6 from the detail
  section. A722 point 1 ends "A zone's own hours as A720 point 6"; rewrite it to "A zone's own hours
  from `zoneOwnHours` (`packages/venue-service/src/zone-own-hours.ts`)".
- [ ] LOOK: the Month with a department that has a zone, both themes, 390 and 1280 px; a zone
  closed past its department's close (paint "Terrace closed 23:00–03:00" if the demo has none)
  shows its hatched part stop at the department's close; a closed Monday's cell is the same height
  as Tuesday's.

---

# Part 3 — the day box (point 3)

Branch `feat/a720-3-day-box`, from `main` after Part 2.

**Today:** clicking a day in the Year adds a panel under its month (`#choose`,
`opening-hours-year.ts:285-295`; `#panel`, `:326-355`, drawn at `:430-434`), which grows that month
and pushes the next row of months down. The panel offers Make, or Edit and Delete; Delete asks in the
screen's own confirmation (`askDeleteSpecial` and `namedDialog`, `opening-hours-screen.ts:800-893`).
In the Month, a special day's or public holiday's date opens the special-day painter at once, and any
other date opens the ordinary-date dialog (`#open`, `opening-hours-month.ts:342-353`;
`ordinaryDialog`, `opening-hours-screen.ts:913-951`). A viewer's Month days are not buttons
(`:514-523`).

**After:** every day of the Year and the Month (outside station mode) is a button that sends
`calendar-day-open` with `{ date, returnTo }`. The screen draws one `calendar-day-box` for that
date, filled from the month read of the date's month — the Month's own read, or, from the Year, a
read the screen opens for that month — and anchored to the clicked button.

### Task 3.1: `calendar-day-box`, a floating box

**Files:** Create `packages/venue-service/src/dashboard/calendar-day-box.ts`, `.test.ts`,
`.a11y.test.ts`. Modify `packages/venue-service/package.json` `exports`: add
`"./dashboard/calendar-day-box": "./src/dashboard/calendar-day-box.ts"` (Part 5 imports it, as
staffing already imports `./dashboard/season-tint`).

**Interfaces:**

```ts
export interface DayBoxRow { name: string; text: string; strong?: boolean }
/** Presentational: the host formats every word. Buttons go in the default slot. */
@customElement("calendar-day-box")
export class CalendarDayBox extends LitElement {
  @property() heading = "";                 // "Fri, 16 Oct 2026"
  @property() name = "";                    // the special day's or holiday's name, or ""
  @property() nameKind: "special" | "holiday" | "" = "";
  @property() line = "";                    // "Special day — replaces Autumn's standard hours"
  @property({ attribute: false }) rows: readonly DayBoxRow[] = [];
  @property() message = "";                 // a loading or failed-read line instead of the rows
  show(anchor: HTMLElement): void;          // opens below the anchor, kept on screen, focus to heading
  hide(): void;
}
// Sends `calendar-day-box-close` (bubbles, composed) whenever it closes, however it closed.
```

The box is a native `popover="auto"` element, so Escape and a click outside close it without
code; it is shown and placed in one task with `placePopover` (imported from `./painter.js`, which
re-exports it from `paint-grid-parts.ts:103-110`). It has `role="dialog"` and
`aria-labelledby` its heading; on open, focus moves to the heading (`tabindex="-1"`); on close,
focus goes back to the anchor **only if focus was inside the box**, so a click on another part of
the page keeps its own focus. Rows are a `<dl>`: name in `<dt>` (bold when `strong`), text in `<dd>`.
At most `min(var(--wt-modal-compact-width), calc(100vw - 2 * var(--wt-space-2)))` wide — the
compact modal's width token (`packages/ui-core/src/tokens/structure.css:51`), already read by the
Year (`opening-hours-year.ts:123`) — and a long name wraps (`overflow-wrap: anywhere`). The host
calls `show(anchor)` again after the box's content changes, which places it again.

- [ ] **Step 1: Failing tests** (`calendar-day-box.test.ts`, a host page with an anchor button):
  1. "opens below its anchor, on top of the page, moving nothing": after `show(anchor)`, the box
     matches `:popover-open`, its top is at the anchor's bottom (±1 px) and a sibling element below
     the anchor has the same `getBoundingClientRect().top` as before. Fails: no element.
  2. "draws its heading, name, line and rows": `heading`, `name` with `data-kind`, `line`, and a
     `dl` of the rows in order, the strong row's `dt` bold.
  3. "closes on Escape and returns focus to its anchor": `userEvent.keyboard("{Escape}")` →
     not `:popover-open`, `calendar-day-box-close` sent once, `document.activeElement` is the anchor
     (through the shadow roots).
  4. "closes on a click elsewhere and leaves focus where the click put it": `userEvent.click` on an
     input outside → closed, one close event, focus on the input.
  5. "stays inside a phone's width": at 390 px (measured `innerWidth`), anchored to a button at the
     right edge, the box's right is ≤ 390 − 8 and its left ≥ 8.
  6. "stays on screen near the bottom, and when it grows": anchored to a button 20 px above the
     viewport's bottom, the whole box is inside the viewport; after rows are added and `show(anchor)`
     is called again, it still is.
- [ ] **Step 1b: a11y** (`calendar-day-box.a11y.test.ts`), light and dark: "a special day with
  buttons", "a plain day with a long name", "a loading message". Fails: no element.
- [ ] **Steps 2–4:** run (fail), implement, run (pass) `calendar-day-box.test.ts` and
  `calendar-day-box.a11y.test.ts`; nothing else uses the box yet. Commit `"A720-3: a floating day box"`.

### Task 3.2: What the Opening hours day box says

**Files:** Create `packages/venue-service/src/dashboard/opening-hours-day.ts` and `.test.ts`. Modify
`strings.ts`.

**Interfaces:**

```ts
/** What the day box shows for one date of a month read. `departmentId` "" lists every department,
 *  each followed by its zones; a department id lists that department and its zones. */
export function openingHoursDay(
  day: OpeningHoursMonth["days"][number],
  seasons: OpeningHoursMonth["seasons"],
  departments: readonly MonthDepartment[],
  departmentId: string,
): { name: string; nameKind: "special" | "holiday" | ""; line: string; rows: DayBoxRow[];
     seasonId: string | null; specialDayId: string | null };
```

Rules: a special day's name, else the holiday's name (`holidayDateName`, as the Month's cell,
`opening-hours-month.ts:446`); line "Special day — replaces {season}'s standard hours" on a special
day with a season, "Special day" with none, "{season} standard hours" on any other day with a
season, nothing without one. A department row (bold) lists its ranges "Lunch 16:00–17:00 · Open
17:00–02:00", or "Closed". A zone row reads "as {department}" when `zoneOwnHours` returns no closed
piece; "Closed" when it returns no open range although the department is open; else its own ranges
then "closed 23:00–02:00" for each closed piece. A row whose department
has no ranges reads "Closed" for the department and "as {department}" for its zones.

New strings (en / es): `day.standard` "{season} standard hours" / "Horario habitual de {season}";
`day.replaces` "Special day — replaces {season}'s standard hours" / "Día especial: sustituye el
horario habitual de {season}"; `day.as_department` "as {name}" / "como {name}"; `day.closed_range`
"closed {start}–{end}" / "cerrado {start}–{end}"; `day.make_special` "Make a special day" / "Crear
un día especial"; `day.edit_week` "Edit {season}'s standard week" / "Editar la semana habitual de
{season}"; `day.show_week` "Show {season}'s standard week" / "Ver la semana habitual de {season}";
`day.loading` "Loading…" / "Cargando…". Reused: `special.edit` ("Edit special day" / "Editar día
especial", `strings.ts:60`, `:914`), `calendar.special_day`, `hours.closed`, `month.range`.

- [ ] **Step 1: Failing tests** (`opening-hours-day.test.ts`, fixture `monthModel()` from
  `src/testing/opening-hours-month-fixture.ts`):
  1. A plain Winter Tuesday, every department: no name; line "Winter standard hours"; rows
     Restaurant "Breakfast 08:00–11:00 · Lunch 13:00–16:00 · Dinner 20:00–23:00", Terrace "as
     Restaurant", Bar "All day 10:00–02:00".
  2. 1 December: Terrace "Breakfast 08:00–11:00 · Lunch 13:00–16:00 · Dinner 22:00–23:00 · closed
     20:00–22:00".
  3. 14 December: name "Company dinners" (`special`), line "Special day — replaces Winter's
     standard hours", `specialDayId` "company".
  4. 8 December: name "Immaculate Conception" (`holiday`), line "Winter standard hours".
  5. 25 December, closed all day: Restaurant "Closed", Terrace "as Restaurant", Bar "Closed".
  6. Sunday 6 December with `departmentId` "bar": rows Bar only.
  7. A day no season holds: line "".
  8. Spanish: test 3's line reads "Día especial: sustituye el horario habitual de Winter".
  9. A Terrace closure covering all of Restaurant's hours on a date (07:00–05:00): Terrace reads
     "Closed", with no "closed 08:00–11:00" pieces (Review focus 4; its Month bar is Task 2.3
     test 5).
  Fails today: the module does not exist.
- [ ] **Steps 2–4:** run, implement, run `opening-hours-day.test.ts`; nothing else reads it yet.
  Commit `"A720-3: what a day's box says"`.

### Task 3.3a: The Month opens the day box

Kept as one task, though large, because the Month's events and the screen's listener for them must
change together or the branch's screen suites go red (Global constraints). Task 3.3b then removes
what this task leaves unreachable.

**Files:** Modify `opening-hours-month.ts` (`#open`, `#action`, the read-only `div` at `:514-523`)
and `opening-hours-screen.ts` (the Month's `special-day-action` and `ordinary-date-open` listeners at
`:966-967` become one `calendar-day-open` listener; a new `dayBox` state and box template). Test
`opening-hours-month.test.ts`, `opening-hours-screen.test.ts`,
`opening-hours-screen.special-day.test.ts`, `opening-hours-screen.a11y.test.ts`. Run also
`station-times-tab.test.ts` and `prep-stations-screen.a11y.test.ts`.

The screen's box template: heading `formatDate(date)` (`hours-view.ts:27-31`, "Mon, 12 Oct 2026"),
the rest from `openingHoursDay(...)` with the Month's Show choice. Buttons, in this order:
- not read-only: "Edit special day" (`data-test="special-edit"`) on a special day, else "Make a
  special day" (`data-test="special-add"`), opening the special-day painter as the dialog and the
  Month did (`openSpecialPainter`, `opening-hours-screen.ts:616-623`, with the month read's holidays
  for a new day's name);
- with a season: "Edit {season}'s standard week" (`data-test="edit-week"`), or for a viewer
  "Show {season}'s standard week", opening the season painter (`openPainter`, `:593-604`, which
  already carries the Month's department).
A button closes the box first, then acts. A `calendar-day-box-close` for a box that is no longer the
current one is ignored (a click on a second day closes the first box and opens the second).

- [ ] **Step 1: Failing tests:**
  - `opening-hours-month.test.ts`: "sends calendar-day-open for every date, neighbours too":
    clicking 14 December (special), 8 December (holiday), 9 December and 30 November each sends one
    `calendar-day-open` whose `date` is the date and whose `returnTo()` is the button; no
    `special-day-action` and no `ordinary-date-open`. "a viewer's dates are buttons too": with
    `readOnly`, `button.day` count equals the cells' count and a click sends `calendar-day-open`.
    "station mode keeps plain dates": unchanged expectation of zero buttons
    (`opening-hours-month.test.ts:431-445`), re-run. Fails today: the events differ, and a viewer
    gets no buttons.
  - `opening-hours-screen.test.ts` (Month view):
    - "a date opens its box over the real Month": clicking 10 December on
      `/view/month/month/2026-12` opens a `calendar-day-box` in the **screen's** shadow root while
      the clicked button is in `opening-hours-month`'s shadow root; the box's top is at that
      button's bottom (±1 px, or above it when there is no room below) and the box is inside the
      viewport. It shows heading `formatDate("2026-12-10")`, line "Winter standard hours", and
      buttons "Make a special day" and "Edit Winter's standard week" (with the `withWinter` model,
      `:1538-1544`). Fails today: the dialog opens instead.
    - "Make a special day opens a new special day holding the date" (the painter's `date` is
      `2026-12-10`, no write). "Edit Winter's standard week keeps the Month's department" (address
      `/view/season/season/winter/department/bar`). "a special date's box offers Edit special day,
      which opens its painter over the month" (`/view/special-day/special-day/company`). "a
      viewer's box offers only Show Winter's standard week, which opens the read-only painter".
      "Escape closes the box and focus returns to the date". "a second date's click shows that
      date's box". "the box near the bottom of the screen": at 390 × 640 (measured), clicking a
      date of the last week keeps the whole box inside the viewport.
  - `opening-hours-screen.a11y.test.ts`: states "the day box over the Month, a plain day" and "…, a
    special day", light and dark.

- [ ] **Steps 2–4:** run (fail), implement, run.

- [ ] **Step 5: Existing checks that change** (point 3 replaces the dialog and the immediate
  painter with the box; each behaviour the dialog had and the box keeps is re-asserted through the
  box's button, word for word after the click):
  - `opening-hours-month.test.ts`: `"opens the special day on a special date, as the year view
    does"` (`:365`), `"asks to open a new special day on a public holiday…"` (`:385`) and `"opens an
    ordinary date with its season…"` (`:394`) become the one `calendar-day-open` test above.
    `"read-only, hides the write actions and opens nothing from a date"` (`:420`): "no `button.day`"
    (`:424`) becomes "every date is a button" (Decision 7). `"returns focus to the date's button
    while it is drawn, and to nothing once it is gone"` (`:744`) removed the buttons by switching to
    read-only; it now removes them by handing the view a different month's model. `"names each date
    in full…"` stays.
  - `opening-hours-screen.test.ts` Month view: the `ordinary()` helper (`:1346-1352`) opens the box
    instead. `"an ordinary date opens its dialog with the date's season and the venue's special
    days"` (`:1521`) becomes "a date opens its box over the real Month" above (the special-day list
    it read fed only the "add to existing" row, which goes — Decision 8). `"Edit the Winter
    week…"` (`:1545`, `:1564`): the click is on the box's `edit-week`; the addresses they check
    stay. `"Make this a special day opens a new special day holding the date"` (`:1598`): the click
    is on the box's `special-add`. `"a special date opens the painter on its special day, over the
    month"` (`:1648`): the date opens the box, then `special-edit`; the painter and address checks
    stay. `"passes read-only to the month and opens nothing from it"` (`:1668`) dispatched the two
    old events by hand; it now dispatches `calendar-day-open` and checks that the box has no
    `special-add`/`special-edit` and that no painter opened. The `it.each` "does nothing with %s
    when the screen has gone before the dialog sends it" (`:1470-1495`) becomes the same case for
    the box's buttons (screen removed between the click and the act: no painter, no address
    change).
    **Deleted** with the dialog's "add to existing special day" row (Decision 8):
    `"does nothing with Add to a special day when the screen has gone…"` (`:1497`) and `"Add to a
    special day opens that special day with the date added, written only on Save"` (`:1608`).
    Adding a date to a stored day by address stays pinned by `opening-hours-screen.special-day.test.ts`
    `"opens a stored special day with the address's date added to its draft, saving nothing"`
    (`:269`).
  - `opening-hours-screen.special-day.test.ts`: `"the Month's special date opens the painter…"`
    (`:551`) and `"the ordinary date's Make this a special day opens a new day on that date"`
    (`:569`) click through the box; their address and painter checks stay. `"the ordinary date's
    Add to a special day…"` (`:585`) is deleted (Decision 8).

- [ ] **Step 6: Run** the month files, the screen test files, `station-times-tab.test.ts` and
  `prep-stations-screen.a11y.test.ts`. Commit `"A720-3: a Month date opens the day box"`.

### Task 3.3b: The ordinary-date dialog goes

**Files:** Delete `ordinary-date-dialog.ts`, `ordinary-date-dialog.test.ts`,
`ordinary-date-dialog.a11y.test.ts`, the `OrdinaryDateOpen` type (`opening-hours-month.ts:29-34`)
and its import (`opening-hours-screen.ts:27-28`), and the screen's `ordinary` state,
`openOrdinary` and `ordinaryDialog` (`:899-951`), which Task 3.3a left unreachable. Modify
`strings.ts`.

- [ ] **Step 1:** Before deleting, show the code is unreachable: `git grep -n "ordinary-date-open\|ordinary-date-dialog" -- packages apps` lists only the files this task deletes and the
  screen's dead listener. No new test: this task changes no behaviour.
- [ ] **Step 2:** Delete them. Delete the strings no one reads any more, each after a `git grep`:
  `ordinary.title`, `ordinary.follows`, `ordinary.edit_week`, `ordinary.add_to_existing`, and
  `special.add` if no other reader. `ordinary.close` stays (`painter-frame.ts:185` reads it), and
  so does `calendar.special_day` (Task 3.2's line reads it).
- [ ] **Step 3: Existing checks that change:** the two deleted test files, with their component.
- [ ] **Step 4: Run** the month files and the screen test files, then
  `pnpm --filter @waitron/venue-service test:coverage` to see no file fell below the bar. Commit
  `"A720-3: the ordinary-date dialog goes"`.

### Task 3.4: The Year opens the day box

The Year's change and the screen's listener for it land together (Global constraints).

**Files:** Modify `opening-hours-year.ts` (`#choose`, `#panel`, `#action`, `selected`, the panel CSS
`:217-233`, the day button's `title`) and `opening-hours-screen.ts` (a `calendar-day-open` listener
on the Year; a watch of the box date's month when the shown view does not already hold it, beside
`watchMonth`, `:452-477`, through `this.api.watchMonth`; until it answers, the box shows "Loading…"
and the buttons the year read already allows; a failed read and re-placing the box are Task 3.5). Test `opening-hours-year.test.ts`,
`opening-hours-year.a11y.test.ts`, `opening-hours-screen.test.ts`,
`opening-hours-screen.special-day.test.ts`, `opening-hours-screen.unsaved.test.ts`,
`opening-hours-screen.a11y.test.ts`.

- [ ] **Step 1: Failing tests:**
  - `opening-hours-year.test.ts`:
    1. "sends calendar-day-open for a date, a viewer's too": clicking 12 May 2027 sends one event
       with `date` "2027-05-12" and `returnTo()` the button; the same with `readOnly`; no
       `special-day-action`. Fails today: no such event.
    2. "moves nothing on the page when a date is clicked": the `top` of the
       `[data-month="2027-06"]` section is the same before and after clicking 12 May. Fails today:
       the panel pushes June down (`opening-hours-year.ts:430-434`).
    3. "names a holiday or special day when pointed at": `title` is "Epiphany" on 6 January,
       "Town fair" on 12 May, "Christmas market" on 8 December (special day over a holiday names
       the special day first, as the spoken name does, `:407-414`) and absent on 3 August. Fails
       today: no `title`.
  - `opening-hours-screen.test.ts` ("Year view"):
    4. "a date opens its box over the real Year, from that date's month": clicking 10 December 2026
       opens the box in the screen's shadow root, anchored below the button in
       `opening-hours-year`'s shadow root, and, once the month read for `2026-12` answers, shows the
       line and rows; one month read is made, and 11 December makes none. (The `yearMount` helper
       answers every month with `monthModel()`, whose days are December 2026's,
       `opening-hours-screen.test.ts:958-961`, so pick December dates.) Fails today: the panel opens.
    5. "Edit special day and Make a special day open the painter as the panel did": through the box,
       with the checks of `"Edit opens the stored special day in the painter…"` (`:587`) and `"Make
       on a plain date creates a special day in the painter and refreshes the year"` (`:731`).
    6. "a holiday's box names it and Make pre-fills it": 2026-12-08 → name "Immaculate Conception",
       Make opens a new day named after it (the check of `:613`).
    7. "shows Loading… until the date's month answers": mount with `heldMount`
       (`opening-hours-screen.test.ts:1046`) holding `/opening-hours/month?month=2026-12`; click 10
       December; the box shows `day.loading` and, from the year read, "Make a special day"; release
       the held read; the box shows the line and rows. Fails today: no box.
  - `opening-hours-screen.a11y.test.ts`: "the day box over the Year" (loaded) and "… while its
    month loads", light and dark.
- [ ] **Steps 2–4:** run (fail), implement, run.
- [ ] **Step 5: Existing checks that change** (point 3 removes the panel; what it offered moves to
  the screen's box):
  - `opening-hours-year.test.ts`: `"offers Edit and Delete on a special day's date…"` (`:335`),
    `"offers a public holiday's date as a special day…"` (`:358`), `"offers an ordinary date as a
    special day; the panel closes on the same date"` (`:387`) and `"drops a chosen date the next
    year does not hold"` (`:406`) are replaced by test 1; their Edit/Make/holiday checks move to
    tests 5 and 6. Delete has no replacement here (Decision 8). `"names the public holiday beside a
    special day on the same date, in the panel and the day's name"` (`:375`): the spoken-name half
    stays; the panel half (`:381-385`) is deleted, and the title loses "in the panel and". `"sends
    nothing and offers no actions when read-only"` (`:415`): the panel checks (`:421-424`) become "a
    click sends `calendar-day-open`" (Decision 7).
  - `opening-hours-year.a11y.test.ts`: the state "the date panel open" (`:97`, `:108-112`) is
    deleted; the box's states are in Task 3.1 and this task.
  - `opening-hours-screen.test.ts`: the "Year special-day actions" `action()` helper (`:561-572`)
    clicks the date, then the box's `[data-test=special-<kind>]` in the screen's shadow root instead
    of the year's. The tests that use it keep every assertion after the click: `:587`, `:613`,
    `:636`, `:671`, `:679`, `:695`, `:712`, `:731`, `:819`, `:854`.
  - **Deleted, because the button they press is gone** (the Year's Delete; Decision 8 — deleting a
    special day stays pinned by the painter's own delete, `opening-hours-screen.special-day.test.ts:439`
    and `special-day-painter.test.ts`): `opening-hours-screen.test.ts` `"says when the special day to
    delete cannot be read, and clears it on another view"` (`:719`), `"Delete names the repeating
    special day, warns that every year goes and refreshes"` (`:753`), `"a refused Delete says so and
    stays open…"` (`:775`), `"Delete names a one-off special day with no every-year warning"`
    (`:794`), `"closing the Delete confirmation from the dialog itself deletes nothing"` (`:803`);
    and `opening-hours-screen.special-day.test.ts` `"the Year's Delete still asks in its own
    confirmation and opens no painter"` (`:516`). The screen code behind them goes in Task 3.5.
  - `opening-hours-screen.special-day.test.ts`: the `yearPanel` helper (`:469-477`) and `"a deleted
    special day closes the painter once…"` (`:447-449`) click the box's button; their checks stay.
    `opening-hours-screen.unsaved.test.ts:192-194` the same.
- [ ] **Step 6: Run** the year files, the screen test files. Commit
  `"A720-3: a Year date opens the day box"`.

### Task 3.5: The Year's box re-placed, a failed month read, Month after a box; the Year's Delete confirmation goes

**Files:** Modify `opening-hours-screen.ts`: `lastDay` (Decision 4) used by the switch's Month
choice; the box is placed again whenever its content changes (`show(anchor)` again after the
update, so a box that grows when its month arrives stays on screen); delete `openNamedDay`,
`askDeleteSpecial`, `closeNamedDay`, `deleteNamedDay`, `namedDialog`, `namedAction` and
`namedDeleteError` (`:777-893`), unreachable since Task 3.4, and `special-day-action.ts` once
`git grep -n special-day-action -- packages apps` shows no importer; delete `special.make` once
`git grep` shows no reader (the panel and the dialog read it, `opening-hours-year.ts:350`,
`ordinary-date-dialog.ts:201`; both gone). Test `opening-hours-screen.test.ts`,
`opening-hours-screen.special-day.test.ts`, `opening-hours-screen.unsaved.test.ts`,
`opening-hours-screen.a11y.test.ts`.

- [ ] **Step 1: Failing tests** in `opening-hours-screen.test.ts` ("Year view"):
  1. "keeps a box near the bottom on screen when its month arrives": at 390 × 640 (measured), hold
     the month read with `heldMount`, click 28 December (the last row), release; after the rows
     arrive the whole box is inside the viewport. Fails while the box is placed only when first
     shown (its rows push it past the bottom).
  2. "says when the date's month cannot be read": a failing month read shows `opening.load_error`
     in the box, and the buttons the year read allows (Make / Edit special day, Edit week) still
     show. Fails while a failed read leaves "Loading…".
  3. "Month after a date's box opens that date's month": with the clock at 2026-10-12, a box on 10
     December 2026, then Month on the switch → `/view/month/month/2026-12` (without the box it would
     be `2026-10`, Decision 4). Fails until `lastDay` exists.
- [ ] **Steps 2–4:** run, implement, run.
- [ ] **Step 5: Existing checks that change:** none (the Delete tests went in Task 3.4).
- [ ] **Step 6: Run** the screen test files and
  `pnpm --filter @waitron/venue-service test:coverage`. Commit
  `"A720-3: the Year's box keeps its place and its day; the Delete confirmation goes"`.

### Task 3.6: Part 3's docs, backlog and LOOK

- [ ] design-system.md: the **Year** bullet (`:3775-3784`) and **Month** bullet (`:3793-3800`)
  describe the box (what it says, its buttons, a viewer's box, Escape and a click elsewhere); delete
  the ordinary-date dialog's description and "The Year's Delete asks in its own confirmation";
  "In Opening hours, a period stays on one line in the week grid and date panel" (`:3822`) loses
  "and date panel". Add a short **Day box** paragraph naming `calendar-day-box.ts` as the shared
  box (Staffing uses it from Part 5; A722 opens it from the Week).
- [ ] Backlog: A720 entry "Points 1, 2, 3, 5 and 6 landed…"; delete point 3. A722 point 5 says
  "opens A720's day box"; rewrite to "opens the Calendar's day box (`calendar-day-box.ts`)".
  A724 point 3 (`workforce.md:145-147`) says "The month gets A720's day box"; rewrite to "the
  Calendar's day box (`calendar-day-box.ts`)".
- [ ] LOOK: the Year and the Month, both themes, 390 and 1280 px: click a plain day, a holiday, a
  special day and a day near the right and bottom edges; the box stays on screen, the months below
  do not move, Escape and a click elsewhere close it; a viewer's box (a venue-viewer login).

---

# Part 4 — days picked on the grid (point 4)

Branch `feat/a720-4-day-picking`, from `main` after Part 3.

**Today:** the Year and the Month move focus with the arrow keys (`#keydown`,
`opening-hours-year.ts:297-306`, `opening-hours-month.ts:319-328`) and pick nothing. The special-day
editor's date picker has its own click, shift-click and Range button (`add-dates-calendar.ts:186-244`,
`:304-315`), which A723 point 7 replaces with this part's code. The special-day painter's address
names one date (`specialDayPainterPath`, `opening-hours-paths.ts:28-37`) and a new day starts with
that date alone (`special-day-painter.ts:548-553`).

### Task 4.1: `DayPicker`, a controller for picking days, tested with real gestures

**Files:**
- Create `packages/ui/src/vitest-pointer-gestures.ts`: browser commands that drive the real mouse
  and a real touch, in the spirit of `parkPointer` (`packages/ui/src/vitest-park-pointer.ts:15-18`),
  exported as `pointerGestureCommands` and spread into `packages/venue-service/vitest.config.ts`'s
  `browser.commands` beside `parkPointerCommands` (and into `packages/staffing/vitest.config.ts`
  only if Part 5 needs them; it does not). Find, before writing it, which coverage report measures
  `vitest-park-pointer.ts` (the root `vitest.config.ts`'s `coverage` block, or `packages/ui`'s), and
  put the new file in the same one. `scripts/park-pointer-registered.test.ts` checks, as text, that
  every package calling `parkPointer` registers it; add the same check for `pointerGestureCommands`
  there, so a package calling `commands.mouseDrag` without registering it fails a root guard rather
  than a browser job.
- Create `packages/venue-service/src/dashboard/day-picking.ts`, `day-picking.test.ts` (a test-only
  Lit host drawing `td[data-date] > button` for October 2026 with `monthGrid`,
  `calendar-grid.ts:16-24`, inside a page made taller than the viewport so it can scroll).

**The commands.** `@vitest/browser-playwright` 4.1.11 gives a command `frame()` and `iframe` (its
`dist/index.d.ts:88-89`), so a command can find an element of the test page with
`(await context.frame()).locator(selector)` (Playwright's CSS reaches into open shadow roots) and
read its `boundingBox()` in the outer page's coordinates, which is what `page.mouse` uses.
- `mouseDrag(selectors: string[])`: move the mouse to the first element's centre, press, move to
  each next centre in several steps, release.
- `touchGesture({ at: selector, holdMs?: number, moveTo?: selector, moveBy?: { x, y } })`: through
  a Chromium DevTools session (`page.context().newCDPSession(page)`), `Input.dispatchTouchEvent`
  `touchStart` at the element's centre, wait `holdMs` of real time, `touchMove` in steps to the
  target, `touchEnd`.
- **First step, before any picker test:** a probe test that runs each command over one button and
  records the `pointerType`, `pointerdown` / `pointermove` / `pointerup` / `pointercancel` and
  `click` events the test page receives. This has not been tried. If `touchGesture` cannot produce
  `pointerType: "touch"` events in the test frame, stop and report it; do not fall back to
  hand-made `PointerEvent`s (Global constraints).

**Interfaces:**

```ts
export interface DayRun { from: LocalDate; to: LocalDate }   // from <= to
export interface DayPickerOptions {
  /** The button for a date, for focus and for finding the day under a pointer; null when the grid
   *  does not draw it. */
  button(date: LocalDate): HTMLElement | null;
  /** Every drawn date, in order, for hit-testing a pointer's position. */
  dates(): readonly LocalDate[];
  /** False: a click and Space still choose; nothing picks a run and nothing opens. */
  canPick(): boolean;
  /** A touch drag picks a run at once, with no long press (A723's dialog). Default false. */
  dragOnTouch?: boolean;
  holdMs?: number;                  // long press; default 500
  choose(date: LocalDate, trigger: HTMLElement): void;   // a click, a tap, Space
  picked(run: DayRun | null): void;                       // the run changed (host redraws)
  open?(date: LocalDate, run: DayRun, trigger: HTMLElement): void; // double-click, long press, Enter
}
export class DayPicker implements ReactiveController {
  constructor(host: ReactiveControllerHost & HTMLElement, options: DayPickerOptions);
  readonly run: DayRun | null;
  readonly focusDate: LocalDate | null;    // the grid's one Tab stop
  isPicked(date: LocalDate): boolean;
  clear(): void;
  /** Bound on the grid element: pointerdown, click, dblclick, keydown, contextmenu. */
  readonly handlers: { … };
}
```

> 2026-10-16, as built: `dates()` is gone and `picked` is optional; the day under a pointer is found
> with `pointerElementsAt` (`@waitron/ui/src/reorder-table.ts`), and only a click carrying the
> gesture's pointerId is swallowed (`day-picking.ts`).

**Behaviour**, following the two pointer drags already in this package —
`paint-grid-parts.ts:241-260` and `departments-zones-drag.ts:40-60`, `:138-170`, `:289-300`:
- **Styles the host applies:** `touch-action: manipulation` on the day buttons (a finger still
  scrolls and zooms the page; only double-tap zoom is off), `user-select: none` on the grid, and
  `-webkit-touch-callout: none` on the buttons so a long press selects no number and opens no phone
  menu. (`paint-grid-parts.ts:567` sets `touch-action: none` on a paint column, which must never
  scroll; a calendar page must.)
- **Mouse or pen:** a press on a day starts a gesture; `pointermove`, `pointerup` and
  `pointercancel` are listened for on `window` (as `paint-grid-parts.ts:249-251`). Once the pointer
  has moved `DRAG_THRESHOLD_PX` (`@waitron/dashboard-kit`, as `departments-zones-drag.ts:142-146`)
  the pointer is captured on the grid (`capturePointer`, as `paint-grid-parts.ts:258-259`). Captured
  events all name the grid, so the day under the pointer is found from `clientX`/`clientY` by
  hit-testing the drawn day buttons' rectangles, as `departments-zones-drag.ts:240-248` finds the
  row under the pointer; a point between buttons keeps the last day. Release on `pointerup`
  (`releasePointer`) picks the run; the click the browser sends after a drag is swallowed once (as
  `blockClick`, `departments-zones-drag.ts:289-300`). `pointercancel` ends the gesture and puts back
  the run as it was before it started.
- **Touch (Decision 11):** a press starts a `holdMs` timer. A move of more than
  `DRAG_THRESHOLD_PX`, a `pointercancel` (the browser has taken the finger for a scroll) or a lift
  before it fires cancels it, and a lift is a tap (→ `choose`). When it fires, the pressed day
  starts the run, `contextmenu` is prevented, and from then on a non-passive `touchmove` listener on
  the grid calls `preventDefault`, so the page no longer scrolls (`touch-action` cannot change in
  the middle of a gesture). Later moves extend the run by hit-testing, as for the mouse. A lift with
  no move since the timer fired calls `open(date, run)` — the picked run when the pressed day was
  already inside it, else that one day; a lift after a move leaves the run picked and opens
  nothing. The click after a long press is swallowed. This relies on Chromium not starting a pan
  once the first `touchmove` after the hold is cancelled; test 6 is what checks it. With
  `dragOnTouch`, a touch drag behaves as a mouse drag.
- **Clicks:** a click picks that one day and calls `choose`; a shift-click with a run picks from
  the run's first-picked day to here (either direction) and does not call `choose`; a double-click
  calls `open(date, run)` with the picked run when the date is inside it, else a one-day run.
- **Keys (Decision 10):** an arrow moves focus one day (±1, ±7) and picks that one day; Shift with
  an arrow extends the run from its first-picked day; **Enter on a real `keydown`** calls `open` and
  prevents the button's own click; a `click` that no Enter `keydown` preceded — what a screen
  reader's reading mode sends for Enter — calls `choose`; Space is left to the button (its click →
  `choose`). An arrow with no button beyond the edge leaves focus and the run as they are.
- With `canPick()` false, only `choose` ever runs.

- [ ] **Step 1: The probe test** for the commands (above). Run it; read what it recorded.
- [ ] **Step 2: Failing tests** (`day-picking.test.ts`), each also checking the run the host drew
  (`aria-pressed="true"` on exactly the run's buttons); the host uses `holdMs: 300` so the real-time
  holds stay short:
  1. `userEvent.click` on 20 October picks 20–20 and calls `choose("2026-10-20")`.
  2. Holding Shift (`userEvent.keyboard("{Shift>}")`), a click on 23 picks 20–23 without `choose`; a
     shift-click on 17 then picks 17–20.
  3. `commands.mouseDrag` from 20 over 21 and 22 to 23 picks 20–23 and calls no `choose` (the click
     after the drag is swallowed); 20 → 23 → back to 21 picks 20–21; a drag from 20 that ends
     outside the grid keeps 20 to the last day it crossed.
  4. **A finger that moves before the hold scrolls and picks nothing:** `touchGesture` at 15 moving
     up 200 px with no hold → `window.scrollY` has grown, no run, no `choose`, no `open`; the page's
     `pointercancel` was handled (the gesture state is clear: a following click on 9 picks 9–9).
  5. **A long press with no move opens:** `touchGesture` at 15 holding 400 ms → `open("2026-10-15",
     {15–15})`, the `contextmenu` (if Chromium sends one) is prevented, and no `choose`.
  6. **A long press, then a drag, picks a run without scrolling:** `touchGesture` at 15 holding
     400 ms then moving to 17 → run 15–17, `window.scrollY` unchanged, no `open`; then a long press
     at 16 (inside the run) → `open("2026-10-16", {15–17})`.
  7. `userEvent.dblClick` on 22 inside a picked 20–23 calls `open("2026-10-22", {20–23})`; on 27
     outside it, `open("2026-10-27", {27–27})`.
  8. Keys: on 20, `{ArrowRight}` focuses 21 and picks 21–21; `{Shift>}{ArrowRight}{ArrowRight}{/Shift}`
     picks 21–23; `{Enter}` calls `open("2026-10-23", {21–23})` and no `choose`; `{ }` (Space)
     calls `choose("2026-10-23")`; `{ArrowDown}` from 31 October (no button beyond) leaves focus on
     31.
  9. **Enter is taken only from a real `keydown`:** with 23 focused, `button.click()` (a click with
     no key press before it, as a screen reader's reading mode sends for Enter) calls `choose` and
     no `open`.
  10. `canPick()` false: a shift-click, a mouse drag and a long press-then-drag pick only one day;
     double-click, Enter and a long press call no `open`; a click still calls `choose`.
  11. `dragOnTouch: true`: `touchGesture` from 15 to 17 with no hold picks 15–17 and the page does
     not scroll.
  Fails today: the module does not exist.
- [ ] **Steps 3–4:** implement, run. Run also `pnpm exec vitest run scripts/park-pointer-registered.test.ts`
  from the repository root (read its `Tests` count) and the venue-service a11y files, which load the
  commands. Commit `"A720-4: a day picker for calendar grids"`.

### Task 4.2: The Year and the Month pick days

**Files:** Modify `opening-hours-year.ts` and `opening-hours-month.ts`: replace `#keydown` and
`focusDate` with a `DayPicker`; draw a picked day (`aria-pressed="true"`); send
`calendar-day-open` from `choose`, and a new `calendar-days-open` with `{ date, from, to }` from
`open`. The grid and buttons take Task 4.1's styles (`touch-action: manipulation`,
`user-select: none`, `-webkit-touch-callout: none`). Picked look: the Year's day filled
with `--wt-color-primary` and its text `--wt-color-on-primary` (as `add-dates-calendar.ts:103-108`);
the Month's day ringed outside in `--wt-color-text`, distinct from today's inner primary ring
(`opening-hours-month.ts:164-166`) and the focus outline. `canPick` is `!readOnly`; the run is
cleared when the model's year or month changes. The screen's `calendar-day-open` listener is
unchanged, and `calendar-days-open` has no listener until Task 4.3, so nothing opens yet on a
double-click — no existing screen test presses one. Test the two view test files and their a11y
files; run also the screen test files.

- [ ] **Step 1: Failing tests:**
  - `opening-hours-year.test.ts`: "a drag picks a run and a double-click asks to open it":
    `commands.mouseDrag` from 20 October 2027 over 21 and 22 to 23; the four buttons are
    `aria-pressed="true"`; a
    double-click on 22 sends `calendar-days-open` `{ date: "2027-10-22", from: "2027-10-20", to:
    "2027-10-23" }`. "a viewer picks nothing": the same with `readOnly` → no `aria-pressed="true"`
    beyond the clicked day and no `calendar-days-open`. "Enter opens, Space shows the day box".
  - `opening-hours-month.test.ts`: the same three on December 2026, plus "a run crosses into the
    next month's faint dates" (from 30 December to 2 January).
  - a11y (both files): a state "a picked run" in light and dark.
  Fails today: no `aria-pressed` is set on drag, and no `calendar-days-open` exists.
- [ ] **Steps 2–4:** run, implement, run.
- [ ] **Step 5: Existing checks that stay unchanged and must pass:** `"keeps one Tab stop in the year
  and moves it with the arrow keys"` (`opening-hours-year.test.ts:427`), `"moves between dates with
  the arrow keys, holding one Tab stop"` (`opening-hours-month.test.ts:546`), `"keeps focus where it
  is on a key that does not move, and at the grid's edge"` (`:756`), `"holds the Tab stop on today's
  date in a new month…"` (`:765`), `"draws nothing before its first read, and puts the Tab stop on
  the 1st…"` (`:785`). They pin the focus behaviour `#keydown` had; the controller must keep it. No
  existing check changes in this task.
- [ ] **Step 6: Run** the year and month test and a11y files, `day-picking.test.ts`, the
  station-times-tab files and the screen test files. Commit
  `"A720-4: the Year and the Month pick days on the grid"`.

### Task 4.3: The special-day editor opens on a run

**Files:** Modify `opening-hours-paths.ts` (`specialDayPainterPath` gains `to`),
`opening-hours-screen.ts` (`SpecialAddress` gains `to`, `:60`; the URL controller's
`opening-hours` keys gain `to: "to"` right after `date`, `:163-172`, so the address reads
`…/date/<from>/to/<to>` — the controller writes pairs in its config's order (`url-state.ts:94-105`); `followUrl` reads it, `:198-206`; a
`calendar-days-open` listener on both views), `special-day-painter.ts` (a `lastDate` property beside
`date`, `:374-376`; `seedKey`, `:491-496`, includes it; a new day's draft holds every date from
`date` to `lastDate`, `:548-553`). Test `opening-hours-paths.test.ts`,
`opening-hours-screen.special-day.test.ts`, `special-day-painter.test.ts`.

Rules (Decision 12): on `calendar-days-open`, a date a special day holds opens that day
(`/view/special-day/special-day/<id>`); otherwise a new day on the run
(`/view/special-day/date/<from>/to/<to>`, `to` left out when it equals `from`), pre-filled from the
first date's public holiday as today. The box closes first.

- [ ] **Step 1: Failing tests:**
  - `opening-hours-paths.test.ts`: `specialDayPainterPath({ specialDayId: null, date:
    "2026-10-20", to: "2026-10-23" })` is `/manage/opening-hours/view/special-day/date/2026-10-20/to/2026-10-23`;
    with `to` equal to `date` the `to` pair is left out.
  - `special-day-painter.test.ts`: "a new day on a run holds every date of it": `date` 2026-10-20,
    `lastDate` 2026-10-23 → four date chips, Save quiet until a name is typed (its existing
    draft rule). "a new day on a run takes the first date's holiday name".
  - `opening-hours-screen.special-day.test.ts`: "a double-click on a run in the Year opens a new day
    holding it" (the run picked with `commands.mouseDrag`, then a real `userEvent.dblClick`;
    address and four chips; no `calendar-day-box` left open; nothing written); "a double-click on a special day's date
    opens that day, whatever is picked"; "Back from the painter returns to the Year with the address
    it had"; "a direct load of a run's address opens it".
  Fails today: `to` is not written or read; the painter takes one date.
- [ ] **Steps 2–4:** run, implement, run.
- [ ] **Step 5: Existing checks that stay unchanged and must pass:** every case in
  `opening-hours-screen.special-day.test.ts` "the special-day painter's address" (`:185-333`) and
  "Back and Forward under the app's leave guard" (`:335-397`) — a single-date address must behave
  exactly as before.
- [ ] **Step 6: Run** `opening-hours-paths.test.ts`, the special-day-painter test files
  (`special-day-painter*.test.ts`) and the screen test files. Commit
  `"A720-4: the special-day editor opens on the days picked"`.

### Task 4.4: Part 4's docs, backlog and LOOK

- [ ] design-system.md: the Year and Month bullets say how days are picked (click, drag, shift-click,
  double-click; on a phone a long press, then a drag for a run; arrows, Shift+arrows, Enter; Space
  for the box), and say plainly that in a screen reader's reading mode Enter arrives as a click and
  opens the day box, from which the editor opens for that day, while Shift+arrows and Enter in
  focus mode open it on a run (Decision 10). The special-day painter's address paragraph
  (`:3764-3770`) adds `/to/<date>`.
- [ ] Backlog: A723 point 7 ends "The same picking code as A720 point 4"; rewrite to "`DayPicker`
  (`day-picking.ts`), with `dragOnTouch` on inside the dialog". Delete point 4 from A720's detail.
  If Part 5 has already landed, this part deletes the A720 entry and section (Global constraints,
  "Backlog") and moves Decisions 1, 2, 3, 7, 10, 11 and 12 into "Decisions and deliberate limits"
  in `service-periods.md` (Decisions 1–3 until A721 and A722 land, which then delete them).
- [ ] LOOK: both views, both themes, 390 and 1280 px: a picked run's look against today's mark and
  the focus ring; on a phone-sized touch emulation (Playwright `hasTouch`), a long press opens the
  editor and selects no number, a long press then a drag picks a run, and a quick swipe scrolls the
  page.

---

# Part 5 — Staffing's month follows (point 7)

Branch `feat/a720-5-staffing-day-box`, from `main` after Part 3. If `feat/a585-6-rota-by-area`
(at `4166579d5` on 2026-10-15) has landed by then, start from a `main` that holds it; if it lands
while Part 5 is open, rebase over it. Line numbers below are `main`'s at `85274de1d`; A585-6 moves
them, so find each place again after the rebase (Global constraints, "Coordinate with A585").

**Today:** the Staffing month draws a row of season chips and a legend above its days
(`staffing-month.ts:440-453`); a writer's day opens its special day's painter or its season's
painter at once (`#openDay`, `:322-326`); a viewer's day is a button only on a special day
(`opens`, `:435`); the arrow keys skip plain days (`#keydown`, `:333-349`).

### Task 5.1: No seasons row; every day opens the day box

**Files:** Modify `packages/staffing/src/dashboard/staffing-month.ts` (delete the `.sub` row,
the `.seasons`, `.seasons-label`, `.legend` and `.chip` rules `:60-85`, the `.chip button` selector at `:137` and its rule `:141-150`, `#seasonLabel` `:538-544`; every in-grid day a button;
`#openDay` opens a `calendar-day-box` imported from `@waitron/venue-service/dashboard/calendar-day-box`;
`#keydown` moves day by day), `strings.ts`. Test `staffing-month.test.ts`, `staffing-month.a11y.test.ts`.

Box (Decision 13): heading `dateFormat({ weekday: "short", day: "numeric", month: "short", year:
"numeric" })`; name the special day's (`special`); line "Special day — replaces {season}'s standard
staffing" on a special day with a season, "{season} standard staffing" on another day with one;
rows each shown area's name and number (as the cell, `:492-494`), or `staffing.month.closed` when
closed all day. Buttons: a writer gets "Edit {name} staffing" on a special day, and "Edit {season}'s
standard week" on a day a season holds that is not a special day; a viewer gets "Show {name}
staffing" and "Show {season}'s standard week" in the same places. Each calls `#openPainter`
(`:312-320`) as the day did, keeping month and area. **If A585-6 is on `main`:** each area row
also gives its `unfilled` count as the cell shows it, and a day that has A585-6's "Rota for this
week" link offers it as one more button after the painter buttons; Step 1 adds a test for each.

New strings (en / es): `staffing.day.standard` "{season} standard staffing" / "Personal habitual de
{season}"; `staffing.day.replaces` "Special day — replaces {season}'s standard staffing" / "Día
especial: sustituye el personal habitual de {season}"; `staffing.day.edit_special` "Edit {name}
staffing" / "Editar el personal de {name}"; `staffing.day.show_special` "Show {name} staffing" / "Ver
el personal de {name}"; `staffing.day.edit_week` "Edit {season}'s standard week" / "Editar la semana
habitual de {season}"; `staffing.day.show_week` "Show {season}'s standard week" / "Ver la semana
habitual de {season}". Deleted: `staffing.month.seasons`, `staffing.month.season`,
`staffing.month.legend`.

- [ ] **Step 1: Failing tests** in `staffing-month.test.ts`:
  1. "draws no seasons row and no legend": `[data-test=seasons]` and `.legend` absent. Fails today.
  2. "a writer's season day opens its box with Edit Winter's standard week, which opens the season
     painter keeping month and area": the `open` call of `"makes each season day a button…"`
     (`:477-499`) after the box's button.
  3. "a writer's special day offers Edit Christmas Eve staffing" with the `open` call of `:515-537`.
  4. "a viewer's box offers Show Christmas Eve staffing and Show Winter's standard week", each
     opening its painter.
  5. "every day of the grid is a button, and the arrows move one day at a time".
  6. "the box names the season it follows and each shown area's number" (line "Winter standard
     staffing", rows "Bar 2"); on a special day "Special day — replaces Winter's standard staffing".
  7. "the box wraps a long unbroken season name inside a phone's width" (the risk the chips' case
     at `:377` covered moves to the box): at 390 px measured, an 80-character name stays inside.
  8. Spanish: test 6's line in Spanish.
  9. a11y (`staffing-month.a11y.test.ts`): states "the day box, a writer" and "the day box, a
     viewer", light and dark.
- [ ] **Steps 2–4:** run (fail), implement, run.
- [ ] **Step 5: Existing checks that change** (point 7: no seasons row, the day box instead of a
  direct painter):
  - `"shows the month's seasons as chips, each opening its season's week even for a person who may
    only look"` (`staffing-month.test.ts:108`): replaced by tests 1 and 4 (the viewer's way to the
    season's week moves from the chip to the box).
  - `"wraps a long unbroken season name inside a phone's width…"` (`:377`): replaced by test 7.
  - `"makes each season day a button for a person who may write, opening its season"` (`:477`),
    `"makes a special day a button for a person who may write, opening its special day…"` (`:515`),
    `"opens a special day without an area when the month shows every area"` (`:573`), `"opens a
    special day's staffing from its date for a person who may only look"` (`:592`): each click is
    followed by the box's button; every `open` call they check stays.
  - `"opens a season from its chip, keeping the month and area"` (`:608`) and `"opens a season without
    an area when the month shows every area"` (`:627`): the chip becomes a day's box button; the
    `open` calls stay.
  - `"keeps a day no season holds as a plain day"` (`:501`), `"draws a day button for a person who
    may only look only on a special day"` (`:583`), `"gives the days one Tab stop, today, and moves
    it with the arrow keys past plain days"` (`:637`) and `"puts a person who may only look's Tab
    stop on a special day shown from the next month…"` (`:681`): there are no plain days now (every
    day opens the box), so each is rewritten to "every day is a button", the Tab stop on today, or
    the month's first day without one (`:672`'s rule), and the arrows moving one day.
  - `"reads the same whether or not the person may write, a season day only becoming a button for a
    person who may write"` (`:328`): the "only for a writer" half becomes "for everyone"; the "reads
    the same" half stays.
  - `staffing-month.a11y.test.ts:59` requires a chip button; it becomes a day button, and the box
    states above are added.
  - Not changed: `index.test.ts` (the painters by address), `strings.test.ts`.
- [ ] **Step 6: Run** `staffing-month.test.ts`, `staffing-month.a11y.test.ts`, `index.test.ts`
  and `strings.test.ts` in `packages/staffing/src/dashboard/`, and venue-service's
  `calendar-day-box.test.ts` (the shared box it now uses). Commit
  `"A720-5: Staffing's month opens the day box"`.

### Task 5.2: Part 5's docs, backlog and LOOK

- [ ] design-system.md, the Staffing view paragraph (`:3743-3752`): no season chips; every day opens
  the day box; what a writer's and a viewer's box offer.
- [ ] Backlog: delete A724 point 3 (`workforce.md:145-147`, delivered here) and trim A724's summary
  in `docs/backlog.md` ("special days reached from the day box"). Add under A724 one line: "The
  Staffing day box lists each area's number; the mockup's role names and times need the month read
  to carry each block (Decision 13 of the A720 plan)." If Part 4 has already landed, this part
  deletes the A720 entry and section as Task 4.4 describes; otherwise delete point 7.
- [ ] LOOK: `/manage/opening-hours/view/staffing`, both themes, 390 and 1280 px, as a writer and as
  a viewer: no seasons row; the box on a plain day and on a special day.

---

## Seams left for later items

- **A721 (Seasons…):** the Year view's season row (the `<season-chips>` in `opening-hours-year.ts`'s render
  after Part 1). A721 adds "Seasons…" at its end and removes the chips' ✎ and "+ Season" with the
  season dialog (Decision 3).
- **A719 (Periods…):** beside A721's "Seasons…" on the same row; if A719 lands first it starts the
  row's end with "Periods…".
- **A722 (Week):** add `week` to the switch's `SHOWN_VIEWS` (Task 1.1) and to `followUrl`'s shown
  views (`opening-hours-screen.ts:222-227`, which today sends `/view/week` to the painter); the Week
  opens on `lastDay` (Task 3.5); its day names open the same `calendar-day-box`; "Open this week"
  becomes one more button in the screen's box slot; its zone rows use `zoneOwnHours`.
- **A723 (the editor's date picker):** replace `add-dates-calendar.ts`'s `#click`, `#range`,
  `#toggleRange` and `#keydown` (`:186-244`) and the Range button (`:304-315`) with a `DayPicker`
  whose `choose` toggles a date, whose `picked` adds the run, with `dragOnTouch: true`. The picker
  already refuses a run over 366 dates (`HOURS_RANGE_MAX_DAYS`, `add-dates-calendar.ts:197-200`);
  A723 keeps that cap around the run `DayPicker` hands it. The Year's and Month's grids cannot
  exceed it (one year, or six weeks), so `DayPicker` itself has no cap.
- **A724:** the Staffing box's rows can show each block once the month read carries them (Task 5.2's
  backlog line).

## Review focus

Inputs most likely to go wrong for a person using this, which no single task's main test exercises:

1. **A double-click on the Year.** The first click opens the box and moves focus into it; the second
   click lands on the day while the box is open. Expected: one editor opens, the box is closed, and
   no second box flashes. Test in Task 4.3 (a real `userEvent.dblClick` on the Year, then one
   painter address and no open box).
2. **A click on another day while a box is open.** The light dismiss closes the first box and its
   close event arrives around the second box's opening. Expected: the second date's box is open.
   Test in Task 3.3a.
3. **The day box near the bottom of a phone screen.** Expected: on screen whole, not hiding the
   day's own number under it more than `placePopover`'s clamp forces. LOOK in Task 3.6.
4. **A zone whose closure starts before the department opens and ends after it closes.** Expected:
   the zone's bar is empty grey with no hatching, spoken "{zone} closed", and the box reads
   "Closed". `zoneOwnHours` test 10, Task 2.3 test 5 and Task 3.2 test 9.
5. **A viewer pressing Enter on a day.** Expected: the box opens (no editor). Task 4.1 test 7 and
   Task 4.2.

## Self-review (done while writing)

- Every spec point has a part: 1–2 Part 1, 3 Part 3, 4 Part 4, 5–6 Part 2, 7 Part 5.
- Nothing is removed before its replacement lands: "+ Special day" goes in Part 1 while the panel and
  the ordinary-date dialog still make a special day; the panel and the dialog go only in Part 3 with
  the box; the season chips leave the Month in Part 1 while the Year's chips and the ordinary-date
  dialog still open a season's week; the ✎ stays until A721.
- Every existing test this plan changes is listed in its task with the reason; the behavioural
  assertions after a changed click are kept.
- No task leaves its branch's suites red: each removal takes the tests that reached it, and each
  change to what a view sends comes with the screen's listener (Tasks 1.2, 1.3, 3.3a, 3.4).
