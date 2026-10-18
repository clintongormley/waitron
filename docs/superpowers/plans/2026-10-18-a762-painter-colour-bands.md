# A762 — every painter says what it edits in its colour, and the Staffing month marks special days — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** All four painters (Opening hours' season painter and special-day editor, Staffing's season
and special-day painters) draw a coloured band along the top of their bar — the season's stored
colour for a standard week, the special-day purple for a special day; both special-day painters are
titled "<name>: special day, <dates>"; the staffing season painter gets A723's line under the bar;
the staffing Spanish strings say "semana estándar"; and the Staffing month marks a special day's
dates as one purple run along their tops.

**Architecture:** (1) `painter-frame` (venue-service, shared with staffing through
`@waitron/venue-service/painter`) gains a `band` property — a calendar colour name, `"special"` or
`""` — and draws an `aria-hidden` strip above its bar, painted with `seasonTintStyles`'
`--season-tint-line` or with the new `SPECIAL_DAY_LINE` (`season-tint.ts`). (2) A new browser-safe
`date-runs.ts` writes a special day's dates as runs ("14–15 Dec, 25 Dec"); both special-day painters
use it in their heading. (3) `staffing-month.ts` draws an absolutely placed strip at the top of each
special date that bridges the table's gap to the next date of the same special day in the same week.
No server, schema or wire change.

**Tech Stack:** TypeScript, Lit, Vitest in real headless Chromium. Tests under
`packages/venue-service/src/dashboard/` run in `--project browser`
(`packages/venue-service/vitest.config.ts`); staffing's dashboard tests likewise
(`packages/staffing/vitest.config.ts`, the `browser` project).

**Review path: LIGHT.** No shared `wt-*` primitive in `packages/ui` changes and no server route
changes. `painter-frame` and `date-runs` are browser-side venue-service exports staffing consumes;
the change to them is additive (a new property, a new function) plus the `actions` slot's position
(Task 2), whose only user is the special-day painter (`git grep 'slot="actions"'` over `packages`
finds `special-day-painter.ts:1725` alone; the other hits are other components' own slots). No
per-task reviewer; the fresh-context plan-vs-spec read and `/finish-branch`'s Codex run-it seat still
run.

**Migration: none.** Season colours are stored since A721 (`seasons.colour`,
`packages/venue-service/src/schema/seasons.ts:31`); special days store no colour and this plan adds
none (Decision 2). Nothing is written to the database and no read changes shape: the staffing reads
already carry what the painters need (`SeasonStaffing.seasons[].colour`,
`SpecialDayStaffing.areas[].dates`, `StaffingMonth.days[].specialDay.id`,
`packages/staffing/src/staffing-types.ts:38-110`).

---

## Spec (quoted in full)

`docs/backlog.md:1432-1436`:

> **A762. Every painter says what it edits in its colour, and the Staffing month marks special days
> (owner, 2026-10-16).** All four painters get a band in the season's or the special day's colour;
> the staffing painters take A723's "Winter: standard week" wording; the Staffing month marks a
> special day's dates as one coloured run. After A723.

`docs/backlog/service-periods.md:288-309`, "## A762. …":

> **A762 (owner, 2026-10-16).** Owner: "we need to make it more obvious that we're editing a standard
> week vs a special range. maybe through the use of colour. even on the month view the special day is
> not shown". Files: `packages/venue-service/src/dashboard/season-painter.ts`,
> `special-day-painter.ts`, `painter-frame.ts`; `packages/staffing/src/dashboard/staffing-season-painter.ts`,
> `staffing-special-day-painter.ts`, `staffing-month.ts`. After A723 (the opening-hours painters'
> wording); the stored season colours it paints with landed in A721.
>
> 1. **All four painters — opening hours and staffing, standard week and special day — carry the
>    colour of what they edit** (owner chose all four, 2026-10-16): a band along the top bar in the
>    season's colour for a standard week, in the special day's own colour for a special day.
> 2. **The staffing painters take A723's wording too:** "Winter: standard week" or "Foo: special day,
>    12–15 Feb", with A723's line under the top bar saying which dates it covers. Today the staffing
>    special-day painter shows only "Foo" and a department.
>    A723 kept the special-day editor's heading as the day's name with no dates line (A723 plan,
>    Decision 9). The staffing Spanish strings still say "semana habitual" (`staffing.rota.paint_week`,
>    `staffing.day.edit_week`, `staffing.day.show_week` and `staffing.rota.unpainted_season`,
>    `packages/staffing/src/dashboard/strings.ts`) where Opening hours and the staffing painter's own
>    title now say "semana estándar".
> 3. **The Staffing month marks a special day's dates in its colour**, as one run the way the season
>    bar marks a season. Today each date only carries the name in coloured text.

The spec points to no mockups. Context looked at (not spec): `docs/backlog/mockups/a718-a727-calendar-and-stations/10-staffing-month.png`
and `03-month-view.png` (each day's top border is its season's line — the "season bar" of point 3),
and `a763-rota/06-staffing-month.png`.

Owner context from the queue: all four painters get the band; the staffing painters take A723's
wording ("Winter: standard week", "<name>: special day, <dates>") and A723's line under the bar; the
Staffing month marks a special day's dates as one coloured run. House rule (owner 2026-10-16,
`docs/developers/design-system.md:2648-2651`, Forms): a destructive action in an action row goes after
Cancel, keeping its danger look, so Save stands alone: `[Cancel] [Delete] … [Save]`.

## What the code does today (checked by reading, 2026-10-18 at `c9c4fe554`)

- `painter-frame.ts:164-232`: `<header>` holds `.bar` (✕, `h2` heading, `picker`, `link`,
  `actions` slot, Cancel, Save) and the refusal line; below it the `row` slot and the content. No
  colour. The `actions` slot renders **before** Cancel (`:196-219`). The modal's background is
  `--wt-color-surface-raised` (`packages/ui/src/components/wt-dialog.ts:57`; `wt-modal` extends it).
- `season-tint.ts`: `SEASON_TINT_TOKENS[colour] = { tint: station fill, onTint: --wt-color-text,
  line: station dot }`; `seasonTintStyles` sets `--season-tint`, `--season-on-tint`,
  `--season-tint-line` on `[data-tint="<colour>"]`; `seasonTints` reads an unknown stored colour as
  grey. A721's answer to text on a user-chosen colour: text on the tint is `--wt-color-text`, held
  at 4.5:1 by `season-tint.test.ts:82-103`, which also holds the line 3:1 from the tint and from
  `--wt-color-surface` — **not** from `--wt-color-surface-raised`, the modal's background.
- Special days have no colour of their own. The Calendar marks them with `--wt-color-palette-purple`
  (Year outline `opening-hours-year.ts:161-163`; Month name `opening-hours-month.ts:254-256`;
  Staffing month name `staffing-month.ts:160-167`; the special-day editor's date chips
  `special-day-painter.ts:312`).
- `season-painter.ts:685-745`: heading `painter.week` ("Winter: standard week"), the `covers` line
  in the `row` slot (`:713-718`), the tinted season chip in `picker`.
- `special-day-painter.ts:1512-1516`: heading = trimmed draft name, else `special.new` /
  `special.edit`; `:1722-1733` Delete (`variant="secondary"`) in the frame's `actions` slot.
  `runsOf` (`:216-224`) is private.
- `staffing-season-painter.ts:436-483`: heading `staffing.painter.week` (already "Winter: standard
  week" / "Winter: semana estándar"); no line under the bar.
- `staffing-special-day-painter.ts:383-422`: heading `read.name`, `staffing.painter.heading`
  ("Staffing") while loading. Dates per area at `read.areas[i].dates` (`{ dateId, date }`).
- `staffing-month.ts:111-132`: each `.day` has a `--wt-space-1` top border, `--season-tint-line` on a
  tinted `td`; `border-spacing: var(--wt-space-1)` (`:63`), halved below 560 px (`:213`). A special
  date only gets its name in purple text (`:621-630`).

### Receipts for the contrast decisions (hand-computed 2026-10-18, Node v26.11.1, WCAG relative luminance over the hex values in `packages/ui-core/src/tokens/colors.css`; the browser test in Task 1 is what holds them)

- Each season line (station dot; grey's is `--wt-color-palette-grey`) against
  `--wt-color-surface-raised`: lowest light amber 3.89:1 (`#a67a00` on `#ffffff`), lowest dark red
  4.09:1 (`#e15656` on `#22262e`). All thirteen ≥ 3:1 in both themes.
- `--wt-color-palette-purple` against the surface / raised surface: light 6.38:1, dark 7.53:1 /
  6.69:1.
- `--wt-color-palette-purple` against `--wt-color-station-purple-dot` (a purple season's line and
  band): 1.26:1 light, 1.63:1 dark — they look alike, in the painters' bands and in the Staffing
  month (Decisions 2 and 8, open point).
- `--wt-color-palette-purple` against `--wt-color-bg` (the page under the month's bridges): 5.96:1
  light, 8.27:1 dark (the plan review's calculation).

## Decisions this plan makes (defaults; each may be overruled)

1. **The band is a strip, not a tinted bar.** `--wt-space-2` tall, the bar's full width, rounded
   ends, above the bar inside the header, `aria-hidden`, painted with the season's line colour.
   Why: nothing but colour sits on it, so it needs only 3:1 against the modal, which Task 1's token
   test holds for every colour; a tinted bar would put Cancel, Save, the picker and the season chip
   on a user-chosen colour whose contrast nothing tests.
2. **A special day's colour is the Calendar's special-day purple, `--wt-color-palette-purple`,
   exported as `SPECIAL_DAY_LINE`.** Why: special days store no colour (`seasons.colour` and
   `menu_periods.colour` are the only colour columns, `schema/seasons.ts:31`, `schema/menus.ts:16`);
   a colour per special day needs a migration and a chooser the spec does not ask for, and purple is
   what every Calendar view already marks special days with. Cost: a purple season's band looks
   like the special-day band (1.26:1 light, 1.63:1 dark) — the words in the heading tell them apart;
   filed as an open point with the month's look-alike (Task 9 (b)). Owner FYI.
3. **Both special-day painters — the Opening hours editor too — are titled "<name>: special day,
   <dates>"; a named day with no dates "<name>: special day"; an unnamed new day keeps "New special
   day".** Why: the spec calls this A723's wording, the owner's complaint is telling a standard week
   from a special range, and A723 left its Decision 9 ("keeps the day's name as its heading") for
   A762 to decide; one twin saying it and the other not would disagree. In the editor the heading
   follows the draft's name and dates as they are edited. Supersedes A723 Decision 9. Owner FYI.
4. **Dates are written as runs:** one date "24 Dec"; a run inside one month "12–15 Feb" (en dash, no
   spaces); a run across months "30 Jan – 2 Feb"; runs in date order, each date once, joined by
   ", "; every date carries its year only when the dates span more than one year (as the editor's
   date chips do, `special-day-painter.ts:1574`). Every run is listed; a long heading wraps, as the
   frame already lets it (`painter-frame.ts:78-84`). **A run never breaks after its dash:** a
   U+2060 WORD JOINER follows the en dash in a run inside one month ("14–\u206015 Dec"), so the
   line-break rules see "14–15" as one word (an en dash otherwise allows a break after it). Chosen
   over a styled span because the heading is a plain string the frame writes into its `h2` and the
   modal's accessible name; the joiner is invisible and is not spoken. A run across months
   ("30 Jan – 2 Feb") may break at its spaces, between words. Whether Chromium honours it under the
   `h2`'s `overflow-wrap: anywhere` is what Task 5's narrow case checks (not yet measured).
5. **Only the season painters get a line under the bar.** A special-day heading already names its
   dates. Staffing's line: "Every week from {from} to {to} needs this staffing, except on special
   days."
6. **The staffing special-day painter reads its dates from `read.areas[0].dates`** (every area
   carries the same dates, `special-day-staffing-fixture.ts`); with no areas the heading is
   "<name>: special day". Why: no server read changes.
7. **When the band shows:** a special-day painter from the moment it opens (it is a special day
   even while loading); a staffing season painter once its read names the season's colour; a viewer
   sees the band too.
8. **The Staffing month's run:** on every date of a special day a `--wt-space-1` strip in
   `SPECIAL_DAY_LINE` covers the day's top border (so the season line is hidden there — the special
   day replaces the season's staffing on that date, as the day box already says); it bridges the
   table's gap to the next date of the same special day in the same week row; its ends are rounded
   at the run's first and last date and at a week's end. Two special days on neighbouring dates are
   two runs. Days outside the month and closed days are drawn the same. The join is what tells a
   special run from a purple season's line (which keeps its gaps); the look-alike is filed as an
   open point.
9. **Spanish "semana estándar"** in the four staffing strings the spec names.
   `staffing.day.standard` ("Personal habitual de {season}") and `staffing.day.replaces` name the
   staffing, not a week, and stay — as A723 Decision 8 kept `day.standard`
   (`staffing-month.test.ts:1204` pins `replaces` and is unchanged).
10. **The special-day editor's Delete moves after Cancel, with the danger look, and Save stands
    alone at the end:** the frame renders Cancel, the `actions` slot, then Save — after a fixed
    `--wt-space-4` gap only while the `actions` slot holds something (`.bar[data-actions]`, the
    frame's `hasActions`); without an action Cancel and Save keep today's `--wt-space-2` gap and the
    heading its room. Why: this **extends** the owner's 2026-10-16 house rule, whose words cover a
    form's bottom row (`wt-form-actions`, `design-system.md:2646-2651`), to a painter's top bar —
    the one destructive action in a painter's bar, in a header this branch is changing anyway. An
    extension, not an application: Owner FYI.
11. **The Opening hours Month is not changed** (point 3 names the Staffing month); filed as an open
    point, since the owner's quote ("even on the month view the special day is not shown") may mean
    it too.

## Global constraints

- **Worktree:** `/Users/clintongormley/workspace/worktrees/waitron-feat-a762-painter-colour-bands`,
  branch `feat/a762-painter-colour-bands`. Every commit `git commit -s`; stage explicit paths. Never
  push from a task.
- **Test first.** Each task writes its failing tests, runs them, sees them fail for the stated
  reason, then writes the code.
- **Task size.** Each task is meant to finish well under 100 tool calls. An implementer past about
  150 with its task unfinished stops at a passing or cleanly red point, commits, and hands over:
  done, left, files, each check's state.
- **Focused runs** (check `memory_pressure | grep free` first):

  ```bash
  pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/<file>.test.ts
  pnpm --filter @waitron/staffing exec vitest run --project browser src/dashboard/<file>.test.ts
  pnpm exec vitest run scripts/style-token-names.test.ts        # root guard, from the worktree root
  ```

  Read the `Tests` count; a run without one proves nothing. CI runs package suites and coverage
  (98/98/98/95); no whole-workspace local run (CLAUDE.md §2).
- **Every dispatch** also runs `pnpm format:check`, and `pnpm --filter @waitron/venue-service
  typecheck` / `lint` and `pnpm --filter @waitron/staffing typecheck` / `lint` (staffing imports
  `@waitron/venue-service/painter` and `…/dashboard/season-tint`). Every commit leaves both green.
- **Changing an existing test check** is allowed only where the spec or a Decision above changes
  what it checks (owner decision 2026-10-05), to check the new behaviour at least as strictly. Each
  task lists them under "Existing checks that change"; the PR description repeats the union under
  **"Changed test checks"**. A failing assertion a task does not list is a STOP: report it, do not
  change it.
- **UI rules:** colour through declared `--wt-*` tokens only, spelt out as `var(--wt-…)` strings
  (`scripts/style-token-names.test.ts`); no hex. Each new visual state gets a case in the component's
  `*.a11y.test.ts`, in both themes. Browser tests: widths by `page.viewport(w, h)` with
  `window.innerWidth` asserted; a test setting Spanish restores English in `afterEach`; colours
  compared by computing a probe element's style, as `season-tint.test.ts:82-103` and
  `season-painter.test.ts:103-106` do.
- **Products' names** are not touched (no product surface here).

## Strings (English, then Spanish — exact)

`packages/venue-service/src/dashboard/strings.ts`:

| Key | English | Spanish |
| --- | --- | --- |
| `painter.special_day` (new) | `{name}: special day, {dates}` | `{name}: día especial, {dates}` |
| `painter.special_day_undated` (new) | `{name}: special day` | `{name}: día especial` |

`packages/staffing/src/dashboard/strings.ts`:

| Key | English | Spanish |
| --- | --- | --- |
| `staffing.painter.special_day` (new) | `{name}: special day, {dates}` | `{name}: día especial, {dates}` |
| `staffing.painter.special_day_undated` (new) | `{name}: special day` | `{name}: día especial` |
| `staffing.painter.week_covers` (new) | `Every week from {from} to {to} needs this staffing, except on special days.` | `Cada semana del {from} al {to} necesita este personal, salvo los días especiales.` |
| `staffing.rota.paint_week` (`:333`) | unchanged | `Pintar la semana estándar de {season}` |
| `staffing.day.edit_week` (`:412`) | unchanged | `Editar la semana estándar de {season}` |
| `staffing.day.show_week` (`:413`) | unchanged | `Ver la semana estándar de {season}` |
| `staffing.rota.unpainted_season` (`:329-330`) | unchanged | `Los puestos salen del personal que pintas: a quién necesita {area} y cuándo. Pinta una vez la semana estándar de {season} y cada semana de la temporada tendrá sus puestos. Puedes seguir añadiendo turnos en Todo el equipo.` |

Date runs (Decision 4), English / Spanish — every run inside one month carries a U+2060 after its
dash, shown here as `\u2060` and spelled so in test literals: `24 Dec` / `24 dic`;
`12–\u206015 Feb` / `12–\u206015 feb`;
`30 Jan – 2 Feb` / `30 ene – 2 feb`; `14–\u206015 Dec, 25 Dec` / `14–\u206015 dic, 25 dic`. The Spanish short
months are as Chromium wrote them for A723 (`season-painter.test.ts:115-117`: "1 dic", "28 feb");
"ene" was seen only in Node v26.11.1's ICU — if Chromium writes another form, the test takes
Chromium's and the task report says so.

## Review Focus

1. **Stepping to another season with ‹ ›.** Expected: the band takes the new season's colour.
   Pinned in Tasks 4 and 6.
2. **A season stored with a colour no calendar colour names** (`seasons.colour` has no CHECK).
   Expected: a grey band, as its chip. Held by `seasonTints`' own case
   (`season-tint.test.ts:28-38`), which both season painters take their band from (Tasks 4 and 6).
3. **A special day of five scattered dates at 390 px.** Expected: the heading wraps between words,
   and ✕, Cancel, Delete and Save stay on screen. Pinned in Tasks 5 and 7.
4. **In the Staffing month, a special day crossing a week's end, and two special days on
   neighbouring dates.** Expected: the run breaks at the row's end; the two days are two runs with a
   gap. Pinned in Task 8.
5. **Dates across a year's end** (30 Dec – 2 Jan). Expected: "30 Dec 2026 – 2 Jan 2027". Pinned in
   Task 3.
6. **The dark theme's band against the modal's raised surface.** Expected: ≥ 3:1 for every colour
   and for the special-day purple. Pinned in Task 1.

---

## Task 1: `painter-frame` draws a band in what it edits

**Files:** Modify `packages/venue-service/src/dashboard/season-tint.ts`, `painter-frame.ts`; Test
`season-tint.test.ts`, `painter-frame.test.ts`, `painter-frame.a11y.test.ts`.

**Interfaces — Produces:**

```ts
// season-tint.ts
/** The Calendar's special-day colour, as a band or a run's line. */
export const SPECIAL_DAY_LINE = "var(--wt-color-palette-purple)";

// painter-frame.ts
/** What the painter edits: a season's calendar colour, "special" for a special day, "" for none. */
export type PainterBand = CalendarColour | "special" | "";
@property() band: PainterBand = "";
```

`PainterBand` is also exported from `painter.ts`. The frame adds `seasonTintStyles` to its styles
and renders, first inside `<header>`, when `band` is not `""`:
`<div class="band" data-test="band" aria-hidden="true" data-tint=… ?data-special=…></div>` —
`data-tint` carries the colour for a season, `data-special` marks a special day. `.band` is
`block-size: var(--wt-space-2)`, `border-radius: var(--wt-radius-full)`, `margin-block-end:
var(--wt-space-2)`; `.band[data-tint]` paints `var(--season-tint-line)`, `.band[data-special]`
paints `SPECIAL_DAY_LINE` (through `unsafeCSS`). Shown read-only too.

- [ ] **Step 1: failing tests.**
  - `season-tint.test.ts`, inside `describe.each(["light","dark"])("season paints (%s)")`, a new
    case **"each season's line and the special-day line read on the painter's raised surface"**:
    a probe painted `var(--wt-color-surface-raised)`; for every `CALENDAR_COLOURS` value
    `contrast(line, raised) >= 3`; `SPECIAL_DAY_LINE` against `--wt-color-surface` and
    `--wt-color-surface-raised` and `--wt-color-bg` (the page under the Staffing month's bridges,
    Task 8) `>= 3`; and `SPECIAL_DAY_LINE` computes to the same colour as a probe painted
    `var(--wt-color-palette-purple)`.
  - `painter-frame.test.ts`: **"draws no band unless told what it edits"** (`.band` null by
    default); **"a season's band runs the header's full width above the bar, in that season's line
    colour"** — for each `CALENDAR_COLOURS` colour set `band`, the band's computed background equals
    a probe painted `SEASON_TINT_TOKENS[colour].line`, `aria-hidden="true"`, its width equals
    `.bar`'s within 1 px, its bottom ≤ `.bar`'s top; **"a special day's band is the special-day
    purple"**; **"the band stays put while the grid scrolls, and a viewer sees it too"**
    (`content.scrollTop = 150` leaves the band's top unchanged; `readOnly = true` keeps it);
    **"at 390 px a band leaves ✕, the heading, Cancel and Save on screen"** (each box width > 0,
    left ≥ 0, right ≤ 391; assert `window.innerWidth === 390`).
  - `painter-frame.a11y.test.ts`: add states `"season band"` (`band = "blue"`) and `"special band"`
    (`band = "special"`) to the `test.each` list (both themes).
- [ ] **Step 2:** run the three files — the new cases FAIL (`.band` missing; `SPECIAL_DAY_LINE` not
  exported).
- [ ] **Step 3:** implement.
- [ ] **Step 4:** the three files PASS; `pnpm exec vitest run scripts/style-token-names.test.ts`;
  typecheck, lint (venue-service, staffing); `pnpm format:check`.
- [ ] **Step 5:** `git commit -s -m "The painters' frame can draw a band in the colour of what it edits (A762)"`

**Existing checks that change:** none.

## Task 2: Delete goes after Cancel in the special-day editor's bar, and Save stands alone

Decision 10.

**Files:** Modify `painter-frame.ts:193-219` (the `actions` slot moves between Cancel and Save;
Save gets `margin-inline-start: var(--wt-space-4)` only under `.bar[data-actions]`, the attribute
the frame already sets from `hasActions`, `:180`), `special-day-painter.ts:1722-1733`
(`variant="danger"`); Test `painter-frame.test.ts`, `special-day-painter.test.ts`.

- [ ] **Step 1: failing tests.** `painter-frame.test.ts`: the changed case below.
  `special-day-painter.test.ts`, under "a stored special day": **"Delete sits after Cancel with the
  danger look, and Save stands alone at the end"** — at 1280 and 390 px: `delete.variant ===
  "danger"`; `cancel.right ≤ delete.left`; `save.left − delete.right ≥ 16`; all three on one line
  (`top < other.bottom` both ways) and on screen. `painter-frame.test.ts`: **"without an action,
  Cancel and Save keep their usual gap and the heading its room"** — no `actions` child, at 390
  and 1280 px: `save.left − cancel.right` within 0.5 px of the `.actions` group's computed
  `column-gap` (8 px, `--wt-space-2`); at 390 px the heading shares the first row with ✕, Cancel
  and Save (same-line check, as `:327-331`). This case passes before and after the change; it is
  the control that fails if the gap is made unconditional (check that once by removing the
  `[data-actions]` condition, then put it back).
- [ ] **Step 2:** run both files — the Delete-order cases FAIL (Delete before Cancel; variant
  secondary).
- [ ] **Step 3:** implement.
- [ ] **Step 4:** PASS for both files and `painter-frame.a11y.test.ts`,
  `special-day-painter.a11y.test.ts`; typecheck, lint; `pnpm format:check`.
- [ ] **Step 5:** `git commit -s -m "In the special-day editor's bar Delete comes after Cancel, and Save stands alone (A762)"`

**Existing checks that change:**
- `painter-frame.test.ts:372-402` "an actions slot sits in the bar between the link and Cancel, and
  stays put while the grid scrolls" → "…sits in the bar between Cancel and Save, apart from Save,
  and stays put while the grid scrolls": `:394-395` `at.left ≥ link.right` / `at.right ≤
  quit.left` become `at.left ≥ quit.right` and `save.left − at.right ≥ 16`; the same-line and
  scroll checks stay. Reason: Decision 10 (owner's house rule) changes the order this case pins.
- `painter-frame.test.ts:295-345` "a heading beside an action in the bar": no assertion pins the
  order; expected to pass unchanged — a failure is a STOP.

## Task 3: `formatDateRuns` writes a special day's dates as runs

**Files:** Create `packages/venue-service/src/dashboard/date-runs.ts`; Modify
`special-day-painter.ts` (import `runsOf` from it; delete its private copy, `:216-224`),
`painter.ts` (export `formatDateRuns`); Test new `date-runs.test.ts`.

**Interfaces — Produces:**

```ts
/** Sorted dates as runs of consecutive dates, each its first and last date. (Moved unchanged.) */
export function runsOf(dates: readonly LocalDate[]): [LocalDate, LocalDate][];
/** The dates as Decision 4 writes them, in the dashboard's language; "" for none. Sorts a copy
 *  and drops repeats first. */
export function formatDateRuns(dates: readonly LocalDate[]): string;
```

Built on `formatShortDate(date, years)` (`hours-view.ts:47`); a run inside one month is the first
date's day number, "–", then `formatShortDate(last, years)`.

- [ ] **Step 1: failing tests** (`date-runs.test.ts`): **"writes one date, a run in one month and a
  run across months"** — `["2027-12-24"]` → `24 Dec`; 12–15 Feb 2027 → `12–\u206015 Feb` (the word
  joiner of Decision 4); 30 Jan – 2 Feb 2027 → `30 Jan – 2 Feb` (no joiner); **"joins runs with commas in date order, each date once, whatever order
  they come in"** — `["2026-12-25","2026-12-14","2026-12-15","2026-12-14"]` →
  `14–\u206015 Dec, 25 Dec`;
  **"a run over a leap day is one run"** — 28 Feb – 1 Mar 2028 → `28 Feb – 1 Mar`; **"writes each
  date's year when the dates span two years"** — 30 Dec 2026 – 2 Jan 2027 → `30 Dec 2026 – 2 Jan
  2027`; `["2026-12-30","2026-12-31","2027-01-06"]` → `30–\u206031 Dec 2026, 6 Jan 2027`; **"no dates
  is the empty string"**; **"in Spanish"** — `12–\u206015 feb`, `30 ene – 2 feb`,
  `14–\u206015 dic, 25 dic` (restoring English).
- [ ] **Step 2:** run `src/dashboard/date-runs.test.ts` — FAIL (no module).
- [ ] **Step 3:** implement; move `runsOf`.
- [ ] **Step 4:** PASS, and `special-day-painter.test.ts` (the date chips use `runsOf`) and
  `painter.test.ts` (the entry point's export list) PASS; typecheck, lint (venue-service,
  staffing); `pnpm format:check`.
- [ ] **Step 5:** `git commit -s -m "A special day's dates written as runs, '14–15 Dec, 25 Dec' (A762)"`

**Existing checks that change:**
- `painter.test.ts:24-45` "exposes the painter frame and the helpers another module's painter draws
  with" pins the entry point's whole export list with `toEqual`; it gains the one key
  `formatDateRuns` (imported from `./date-runs.js`), every existing key and value unchanged (owner
  2026-09-27: a whole-shape pin may gain the new field's key). Reason: a new export staffing uses
  (Task 7). Task 1's `PainterBand` is a type and does not touch it.

## Task 4: The Opening hours painters show their band

**Files:** Modify `season-painter.ts:695-707`, `special-day-painter.ts:1692-1704`; Test
`season-painter.test.ts`, `special-day-painter.test.ts`.

**Interfaces — Consumes:** Task 1's `band`. The season painter passes
`seasonTints(this.model.seasons).get(season.id) ?? "grey"`; the special-day painter passes
`"special"` always (new, stored, loading, read-only — Decision 7).

- [ ] **Step 1: failing tests.** `season-painter.test.ts`: **"the band takes the season's stored
  colour, and follows the painter to another season"** — Winter → `band === "blue"` and the frame's
  `.band` paints the computed `--wt-color-station-blue-dot`; set `seasonId = "spring"` → `"green"`
  (Review Focus 1); **"the band is the colour the season stores, not one fixed per season"** —
  `painterModel()` with Winter's `colour: "purple"` (a `CalendarColour`, `season-rules.ts:7`; no
  cast) → `band === "purple"`, painting the computed `--wt-color-station-purple-dot`; **"a viewer
  sees the band too"**. An unknown stored colour cannot be written through the `Season` type; the
  painter takes its band from `seasonTints`, whose "reads an unknown colour as grey" case
  (`season-tint.test.ts:28-38`) holds the grey (Review Focus 2). `special-day-painter.test.ts`: **"a stored day and a new one both carry the
  special-day band, a viewer's too"** (`frame(painter).band === "special"`, and before the stored
  read answers).
- [ ] **Step 2:** run both files — FAIL (`band` is `""`).
- [ ] **Step 3:** implement.
- [ ] **Step 4:** PASS for both, plus `season-painter.a11y.test.ts`, `special-day-painter.a11y.test.ts`,
  `opening-hours-screen.painter.test.ts`, `opening-hours-screen.special-day.test.ts` and the 390 px
  bar cases `season-painter.test.ts:964-1015` (the band adds height above the bar); typecheck, lint;
  `pnpm format:check`.
- [ ] **Step 5:** `git commit -s -m "The season painter's band takes its season's colour, the special-day editor's the special-day purple (A762)"`

**Existing checks that change:** none expected; any failure is a STOP.

## Task 5: The Opening hours special-day editor is titled "<name>: special day, <dates>"

Spec point 2 and Decision 3.

**Files:** Modify `special-day-painter.ts:1512-1516` (`heading()`), `strings.ts` (two keys, both
languages); Test `special-day-painter.test.ts`, then the changed checks below.

`heading()`: a trimmed name with dates → `format("painter.special_day", { name, dates:
formatDateRuns(draft dates) })`; with no dates → `painter.special_day_undated`; no name → as today.

- [ ] **Step 1: failing tests** (`special-day-painter.test.ts`): **"titles a stored day '<name>:
  special day, <dates>' and follows the draft's dates"** — `storedDay()` →
  `Christmas dinners: special day, 14–15 Dec, 25 Dec`; remove the 25 Dec chip →
  `Christmas dinners: special day, 14–15 Dec`; rename to "Fair" → `Fair: special day, 14–15 Dec`;
  **"a named day with no dates is '<name>: special day', an unnamed new day 'New special day'"**;
  **"in Spanish"** → `Christmas dinners: día especial, 14–15 dic, 25 dic`; **"a day of five
  scattered dates at 390 px wraps its heading and keeps ✕, Cancel, Delete and Save on screen"**
  (dates 1, 3, 5, 7 and 9 Dec 2026; the heading breaks only between words, as
  `painter-frame.test.ts:281-294`'s `brokenWords`; Review Focus 3); **"a new day with a name and
  dates at 390 px keeps its heading beside ✕, Cancel and Save, breaking only between words and never
  after a run's dash"** — a new day (no Delete, so the heading shares the first row) named
  "Christmas company dinners" with 14, 15, 16, 22 and 23 Dec 2026, in English and Spanish:
  `brokenWords` finds nothing, and no line of the `h2` ends in "–" (read each line's text from a
  `Range` over the heading, as `brokenWords` does); ✕, Cancel and Save on screen.
- [ ] **Step 2:** run `special-day-painter.test.ts` — the new cases FAIL (the heading is the name).
- [ ] **Step 3 — change `heading()`, then look:** run every `special-day-painter*.test.ts` and
  `opening-hours-screen.special-day.test.ts`; write down every failure (file:line, test name, old
  and new value). Expected: the heading pins listed below and any check of the modal's accessible
  name, each where only the name gained ": special day[, <dates>]". Update those to the exact new
  literal. A failure of any other kind is a STOP.
- [ ] **Step 4:** PASS for every `special-day-painter*.test.ts`,
  `opening-hours-screen.special-day.test.ts`, `special-day-painter.a11y.test.ts`; typecheck, lint;
  `pnpm format:check`.
- [ ] **Step 5:** `git commit -s -m "The special-day editor is titled '<name>: special day, <dates>' (A762)"`

**Existing checks that change** (each heading pin becomes the exact literal for that case's name
and dates, the name part unchanged; reason: Decision 3 changes the heading):
`special-day-painter.test.ts:132, :183, :193, :866, :935, :1121, :1348, :1400, :1439`;
`special-day-painter.save.test.ts:693, :698, :1025, :1046`; plus Step 3's list. `:260`
("New special day") stays.

## Task 6: The staffing season painter: band, the line under the bar, and "semana estándar"

Spec point 1, point 2 (the line, the Spanish strings) and Decisions 5, 7, 9.

**Files:** Modify `packages/staffing/src/dashboard/staffing-season-painter.ts:436-483`,
`strings.ts` (the staffing rows of the table above); Test `staffing-season-painter.test.ts`,
`staffing-season-painter.a11y.test.ts`, `strings.test.ts`.

`painter-frame` gets `.band=${read ? seasonTints(read.seasons).get(this.seasonId) ?? "grey" : ""}`.
Once read, `<p slot="row" class="covers" data-test="covers">` reads `staffing.painter.week_covers`
with the chip's own `from`/`to` (`monthDay(season.startsOn)`,
`monthDay(seasonLastDay(read.seasons, season.startsOn))`), before the paint row, shown to a viewer
too, in `--wt-color-text-muted`, `--wt-font-size-sm`, no margin (as `season-painter.ts:162-166`).

- [ ] **Step 1: failing tests.** `staffing-season-painter.test.ts`: **"the band takes the season's
  stored colour and follows the address to another season"** (Winter `blue`; `seasonId = "autumn"`
  → `orange`; no band while the read is out); **"says which weeks it edits under the bar, before the
  paint row, in English and Spanish"** — `Every week from 1 Dec to 28 Feb needs this staffing,
  except on special days.`, the first `[slot=row]`, muted; Spanish `Cada semana del 1 dic al 28 feb
  necesita este personal, salvo los días especiales.`; **"a viewer sees the band and the line"**.
  `strings.test.ts`: **"names a season's week 'semana estándar' in Spanish"** — the four keys'
  Spanish values equal the table's, and no Spanish string contains "semana habitual".
  `staffing-season-painter.a11y.test.ts`: run as is (the line shows in every loaded state).
- [ ] **Step 2:** run the three files — FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** PASS for every `staffing-season-painter*.test.ts`, `strings.test.ts`,
  `rota-view.test.ts` and `staffing-month.test.ts` (both read the changed Spanish strings);
  typecheck, lint; `pnpm format:check`.
- [ ] **Step 5:** `git commit -s -m "The staffing season painter shows its season's band, says which weeks it edits, and Spanish says 'semana estándar' (A762)"`

**Existing checks that change:** none expected — no test pins the four Spanish strings
(`git grep "semana habitual"` over `packages/**/*.test.ts` finds none). **Checks at risk from the
added height** (the band and the new line take height from the grid; worked out by reading, not
measured): `staffing-season-painter.test.ts:788-801` (the grid's slot over 600 px at 1280×900) and
the A724 LOOK cases `:843-930` (each `.day` over 300 px at 390×900, Spanish included). If one fails,
STOP and report the measured heights; do not edit the check or shrink the band or line to fit.

## Task 7: The staffing special-day painter: band and "<name>: special day, <dates>"

Spec points 1 and 2; Decisions 3, 6, 7.

**Files:** Modify `staffing-special-day-painter.ts:383-394`, `strings.ts`; Test
`staffing-special-day-painter.test.ts`, `staffing-special-day-painter.a11y.test.ts`.

**Interfaces — Consumes:** `formatDateRuns` from `@waitron/venue-service/painter` (Task 3).
Heading once read: `staffing.painter.special_day` with `formatDateRuns(read.areas[0].dates.map(({
date }) => date))`, or `staffing.painter.special_day_undated` when there are no areas or no dates;
`staffing.painter.heading` while loading, as today. `band` is `"special"` from the start.

- [ ] **Step 1: failing tests:** **"titles the special day '<name>: special day, <dates>'"** →
  `Christmas: special day, 24–25 Dec`, Spanish `Christmas: día especial, 24–25 dic`; **"with no
  areas or no dates the heading is '<name>: special day'"**; **"carries the special-day band from
  the moment it opens, while loading, and to a viewer"**; **"a day of five scattered dates at 390 px
  wraps its heading and keeps ✕, Cancel and Save on screen"** (Review Focus 3). a11y: the
  existing states, `loading` (`staffing-special-day-painter.a11y.test.ts:204`) included, now carry
  the band; run them in both themes.
- [ ] **Step 2:** FAIL. **Step 3:** implement and update the changed checks.
- [ ] **Step 4:** PASS for every `staffing-special-day-painter*.test.ts`; typecheck, lint;
  `pnpm format:check`.
- [ ] **Step 5:** `git commit -s -m "The staffing special-day painter is titled '<name>: special day, <dates>' and shows the special-day band (A762)"`

**Existing checks that change** (`staffing-special-day-painter.test.ts`; reason: spec point 2):
- `:120` `"Christmas"` → `"Christmas: special day, 24–25 Dec"`.
- `:436` `"New Year"` → `"New Year: special day, 24–25 Dec"` (the fixture's dates).
- `:585` (no areas) and `:662` (no dates) `"Christmas"` → `"Christmas: special day"`.
- `:739` → `locale === "es" ? "Christmas: día especial, 24–25 dic" : "Christmas: special day, 24–25 Dec"`.
- `:415` ("Staffing" while loading) stays.

## Task 8: The Staffing month marks a special day's dates as one run

Spec point 3; Decision 8.

**Files:** Modify `packages/staffing/src/dashboard/staffing-month.ts` (styles `:39-236`, `#cell`
`:565-603`); Test `staffing-month.test.ts`, `staffing-month.a11y.test.ts`.

The table's gap becomes a custom property (`--staffing-month-gap: var(--wt-space-1)`, halved in the
`< 560px` query) used by `border-spacing` and the bridge. `.cell` is `position: relative`. On a
special date, first in `.cell`: `<span class="run" data-test="special-run" aria-hidden="true"
?data-joins-previous ?data-joins-next></span>` — absolute, `inset-block-start: 0`, `inset-inline:
0`, `block-size: var(--wt-space-1)`, background `SPECIAL_DAY_LINE` (imported from
`@waitron/venue-service/dashboard/season-tint`), `border-radius: var(--wt-radius-sm)`,
`pointer-events: none`; `data-joins-next` extends `inset-inline-end` by `-1 *
var(--staffing-month-gap)` and squares its end corners; `data-joins-previous` squares its start
corners. Joins are decided per week row: the neighbour at index ± 1 in the same row of seven has the
same `specialDay.id`.

- [ ] **Step 1: failing tests** (`staffing-month.test.ts`, a new `describe("a special day's run")`,
  each read built from `staffingMonth()` with `specialDay` set on the named dates):
  - **"marks a special day's dates in the special-day colour along their tops, as one run"** —
    `sd-fair` on 15–17 Dec 2026 (Tue–Thu): each date has one `special-run` whose computed
    background equals a probe painted `var(--wt-color-palette-purple)`; `run(15).right` within
    0.5 px of `run(16).left`, `run(16).right` of `run(17).left`; `run(17).right ≤ day(17).right +
    0.5`; `run(15).left ≥ day(15).left − 0.5`; each run's top equals its `.day`'s top and its
    height ≥ the `.day`'s `border-top-width`; no run on 14 or 18 Dec.
  - **"a run breaks at a week's end"** — 19–22 Dec (Sat–Tue): `run(20).right ≤ day(20).right +
    0.5`, `run(21).left ≥ day(21).left − 0.5` (Review Focus 4).
  - **"two special days on neighbouring dates are two runs"** — `sd-eve` 24 Dec, `sd-xmas` 25 Dec:
    `run(25).left − run(24).right ≥ 1` (Review Focus 4).
  - **"at a phone's width the run still joins its dates"** — the first case's geometry at 390 px
    (`window.innerWidth === 390`).
  - **"a day of no special day keeps its season's line"** — 23 Dec's `.day` `border-top-color`
    equals a probe painted `var(--wt-color-station-blue-dot)`, and it has no run.
  - `staffing-month.a11y.test.ts`: a new state **"a special-day run"** (15–17 Dec), both themes.
- [ ] **Step 2:** run both files — FAIL (no `special-run`).
- [ ] **Step 3:** implement.
- [ ] **Step 4:** PASS for both files; `pnpm exec vitest run scripts/style-token-names.test.ts`;
  typecheck, lint; `pnpm format:check`.
- [ ] **Step 5:** `git commit -s -m "The Staffing month marks a special day's dates as one purple run (A762)"`

**Existing checks that change:** none expected — "names a special day on its date" (`:158-164`) and
"draws no seasons row and no legend" (`:166-172`, the `td`'s `data-tint`) stay; any failure is a
STOP.

## Task 9: Docs and backlog

**Files:** `docs/developers/design-system.md`, `docs/backlog.md`, `docs/backlog/service-periods.md`.

- [ ] First `git grep -n "special-day painter\|special day's name\|day's name as heading\|Delete on a stored day\|top border\|actions slot\|semana habitual"`
  over `docs/developers` and `docs/backlog*`; fix every hit describing the current behaviour of the
  four painters, `painter-frame` or the Staffing month (CLAUDE.md §1, "A behaviour change retires
  every receipt"). Historical plans and specs stay.
- [ ] `design-system.md:253-271` (season paints): the painters' band takes a season's line, a
  special day's is `SPECIAL_DAY_LINE` (`--wt-color-palette-purple`, the Calendar's special-day
  colour); the Staffing month's special dates take a purple run over the season line; the
  "season paints" cases now also hold every line and the special-day line 3:1 from
  `--wt-color-surface-raised`.
- [ ] `:2248-2253` (season painter): a band in the season's colour along the top of the bar.
  `:2288-2290` (special-day painter): the band in the special-day purple; heading "<name>: special
  day, <dates>" (Decision 4's runs; "<name>: special day" with no dates; "New special day" before a
  name), following the draft; the bar's order ✕, heading, picker, Cancel, Delete (danger), Save.
  `:2339-2345` (staffing painters): both bands; the season painter's line "Every week from <first
  day> to <last day> needs this staffing, except on special days."; the special-day heading.
- [ ] `:2648-2651` (Forms, the `[Cancel] [Delete] … [Save]` rule): name the special-day editor's bar
  as following it.
- [ ] `:4196-4210` (Staffing → Month): a special day's dates carry a purple run along their tops,
  joined across the gaps within a week, in place of the season's line.
- [ ] `docs/backlog.md:1432-1436`: delete the A762 entry; `service-periods.md:288-309`: delete the
  A762 section. In "A723's plan defaults sent to the owner as an FYI" (`backlog.md:1492-1493`,
  `service-periods.md:270-286`) remove Decision 9 (superseded by this plan's Decision 3) and say so
  in one line naming A762's PR.
- [ ] New entries in the Service periods area (one line each in `backlog.md`, detail in
  `service-periods.md` when past four lines), each naming "left open by A762, #<PR>":
  (a) **A762's plan defaults sent to the owner as an FYI** — Decisions 1, 2, 3, 8 and 10;
  (b) **A purple season looks like a special day** — its band in the painters and its line in the
  Staffing month against the special-day band and run (1.26:1 light, 1.63:1 dark, receipt above);
  (c) **The Opening hours Month marks a special day only by its name** (Decision 11);
  (d) **Special days have no colour of their own** (Decision 2: one purple for all).
- [ ] `service-periods.md` "## Decisions and deliberate limits": Decisions 4, 5, 6, 7 and 9, one
  line each, "(A762 plan, Decision N; plan default)".
- [ ] `git commit -s -m "docs: every painter's band, the special-day headings and the Staffing month's special-day runs (A762)"`

## Task 10: LOOK

- [ ] `lsof` the first slot's venue folder and ports 8080, 5190–5192 (another worktree's stack may
  hold them); start with `wa-wt demo waitron-feat-a762-painter-colour-bands` (never a bare
  `pnpm dev*`), recording its process group.
- [ ] Copy `~/waitron-campaign/a721-script/common.mjs` to `~/waitron-campaign/a762-script/`,
  pointing its Playwright import at this worktree's `node_modules` and `out` at
  `~/waitron-campaign/a762-shots/`; drive with it (login, `setTheme`, `snap`, rejecting a pair
  whose page and dialog backgrounds match). At **390 px with touch and 1280 px, light and dark,
  English and Spanish**, capture: the Opening hours season painter on two seasons of different
  colours (band, title, line); the special-day editor on a stored multi-date day (purple band,
  "<name>: special day, <dates>", Cancel · Delete · Save) and on a new day before and after naming
  it; both staffing painters (bands, the season line, the special-day heading); the Staffing month
  with a special day of three or more dates in one week and one crossing a week's end — looking
  in particular at the month's staffing bars, which are the same `--wt-color-palette-purple` as the
  run, beside it. If the demo
  venue has no such special day, make one through the dashboard and delete it afterwards; say what
  was changed and restored.
- [ ] `wa-wt down waitron-feat-a762-painter-colour-bands`; check by the recorded process group and
  the ports that nothing is left. Write `~/waitron-campaign/a762-look-report.md`: what was looked
  at, each shot's path, what is wrong. The PR's "LOOK" section summarises it.

---

## PR description must carry

- First line in plain words: every painter now shows a band in the colour of what it edits, both
  special-day painters say "<name>: special day, <dates>", and the Staffing month marks a special
  day's dates as one purple run.
- **Migration:** none, and why (header). **Review path:** LIGHT, and why (header).
- The plan defaults sent to the owner as an FYI (Decisions 1, 2, 3, 8, 10), Decision 3 superseding
  A723's Decision 9.
- **"Changed test checks":** the union of every task's list, each with its reason.
- **"LOOK":** what Task 10 captured.
