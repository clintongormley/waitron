# A721 — a Seasons window edited in its table, and a stored colour for each season — Implementation Plan

> 2026-10-18, A788: `hours.clock_change_pending` is retired; a clash with a waiting start is refused `hours.clock_change_conflict` — see `docs/superpowers/specs/2026-10-18-a788-business-day-next-changeover-design.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** Each season stores its own colour, so every view paints a season the same, and the
Calendar's `window/seasons` address opens a Seasons window — opened from a "Seasons…" button on the
Year's season row — in which every season's colour, name and start are edited in place and one
Save sends every change.

**Architecture:** Three layers. (1) **Storage:** `seasons` gains a `colour` column (one of the
thirteen `CALENDAR_COLOURS`), read by `readSeasons` and so carried by every read model that already
spreads a season. (2) **One write:** a new `saveSeasons` writer behind
`PUT /management-api/venue-service/seasons` applies a list of added, changed and deleted seasons in
one transaction, replacing the three single-season writes. (3) **Screens:** `seasonTints` returns the
stored colour instead of a place in start order; a new `seasons-window` element (draft rows in
`season-draft.ts`) replaces the season chips' ✎, "+ Season" and the `season-dialog`; the Year's
season row gains "Seasons…" before A719's "Periods…".

**Tech Stack:** TypeScript, drizzle-orm / drizzle-kit 0.31.11 on SQLite (`node:sqlite`), Hono
routes, Lit and the shared `wt-*` primitives, Vitest. Tests under `src/dashboard/` run in **real
headless Chromium** (`packages/venue-service/vitest.config.ts:27-31`,
`packages/staffing/vitest.config.ts:28-32`); everything else in each package runs in its `node`
project (`packages/venue-service/vitest.config.ts:12-18`).

**Spec** (read all of it before any task):

- `docs/backlog.md:1400-1402`, the A721 entry: "Name, colour and start date edited in place with one
  Save; a stored colour ends Winter turning yellow in February's month. Migration."
- `docs/backlog/service-periods.md:184-201`, "## A721. Seasons: a Seasons window edited in its
  table, and a stored colour for each season", quoted:

  > 1. **A "Seasons…" window**, opened from a "Seasons…" button on the Calendar Year's season row,
  >    replaces the existing addressable chooser at `window/seasons` and lists every season in the
  >    order it starts in the year. Each row edits its colour (`wt-colour-chooser`, choices from
  >    `calendarColourChoices`, `packages/venue-service/src/dashboard/calendar-colours.ts`), name and
  >    start date in place; "Runs until" is worked out from the next season and is not typed; a bin
  >    removes the row. "+ Season" adds a row offered the next unused colour. One Save sends every
  >    change and closes the window; Cancel discards. The separate season editor and the chips' ✎
  >    go. The row's "Periods…" (A719) is placed into `season-chips`' default slot by the Year view;
  >    keep it after "Seasons…".
  > 2. **Each season stores its colour.** Today `seasonTints` colours a season by its place in the
  >    list it is handed, so February's Month view, handed only Winter and Spring, paints Winter
  >    yellow while the Year paints it blue. A stored colour is the same on every view. Landing
  >    deletes the open note "Season colours differ between Opening hours' Year and its month (and
  >    the Times tab)".

- `docs/backlog/service-periods.md:368-370`, the decision note this item retires: "No 'Seasons…'
  button until A721; the season chips keep their ✎ and '+ Season' until then (A720, 2026-10-15).
  … A721 replaces them, and then deletes this note."
- Mockups in `docs/backlog/mockups/a718-a727-calendar-and-stations/`: `02-seasons-window.png` (the
  window; its notes: "Name, colour and start date are edited in the row itself; 'Runs until' is
  worked out from the next season and cannot be typed. There is no separate season editor any
  more." / "The bin deletes a row from the draft; nothing is stored until Save, which sends every
  change at once and closes the window. '+ Season' adds an empty row offered the next unused
  colour." / "The colour is stored with the season, so Winter is the same blue on the Year, Month
  and Week views." / "Painting a season's week stays on its chip on the Calendar."), `01-year-view.png`
  (note B: "Season chips are a key only (clicking one opens its week, as today); no ✎. 'Seasons…'
  opens the seasons window"), and that folder's `README.md` (A721 = jobs 8 and 18).
- `docs/developers/design-system.md` → Forms (`:2063` onwards), "Protect an edited dialog before
  closing it" (`:2605-2678`), "Periods window" (`:4733-4803`).

The open note the spec names is at `docs/backlog.md:1570-1573` ("Season colours differ between
Opening hours' Year and its month"); its "(and the Times tab)" no longer appears there, since A725
retired the Times tab. Line numbers below are against `main` at `30498070b`.

**Migration: yes** — one column, `seasons.colour`, no CHECK (Decision 1), existing rows take the
column default `'grey'`, no data migration (CLAUDE.md §3, "No backwards-compatibility or
data-migration code until Waitron is in production").

**Review path: FULL.** The branch adds a migration, changes a cross-package read contract (the
season wire shape read by `packages/staffing`), and replaces three write routes with one that
rewrites several rows under two unique indexes in one transaction. Per-task reviews, then
`/finish-branch` with the Codex run-it seat twice (the second told to set this plan aside and test
what it does not name).

---

## What the code does today (checked)

- **Table.** `seasons` (`packages/venue-service/src/schema/seasons.ts:21-43`): `id`, `location_id`,
  `name` (label), `starts_on` (label, `MM-DD`); unique indexes `seasons_location_starts_key` and
  `seasons_location_name_key`; CHECKs `seasons_name_ck` and `seasons_starts_on_ck`
  (`glob '[01][0-9]-[0-3][0-9]' and <> '02-29'`). Owned by the venue-service migration set
  (`packages/venue-service/src/migrations.ts:5-9`, folder `packages/venue-service/drizzle`, last
  entry `0057_black_shadow_king`), classified `state` (`classification.ts:44`), carried by a
  configuration transfer (`configuration-transfer.ts:678`) and validated there
  (`validateSeasonWeeks`, `:258-270`). The set **opts into schema conformance**
  (`packages/venue-service/src/schema/schema-conformance.test.ts:9-18`, with
  `declaresClosedVocabularies: true`). Generation: `pnpm --filter @waitron/venue-service db:generate`
  (`package.json:31`, `drizzle-kit generate`; `drizzle.config.ts` points at `./src/schema/index.ts`).
- **Children that cascade.** `department_days.season_id` and `zone_days.season_id` (`ON DELETE
  CASCADE`, `schema/seasons.ts:107-111`, `:178-182`) and staffing's `staffing_days`
  (`packages/staffing/src/schema/staffing.ts:87`, cascade at
  `packages/staffing/drizzle/0001_staffing_days_blocks_assignments.sql:36`). A drizzle rebuild of
  `seasons` would empty them: "A drizzle table rebuild runs with foreign keys ON, so its `DROP
  TABLE` acts on every row that points at the table" — measured, `docs/developers/conventions-data.md:1423-1445`.
  Adding a CHECK to an existing table makes drizzle rebuild it (`conventions-data.md:258-260`; the
  two-generation pattern `0005_kitchen_ticket_grouping.sql` + `0006_…_check.sql` rebuilt
  `service_settings`, which has no children). `0005` also shows drizzle-kit writing a new
  `text DEFAULT … NOT NULL` column as a plain `ALTER TABLE … ADD`.
- **Schema conformance and vocabularies.** A column declared with `enumType`/`enumText` must have a
  built CHECK holding its values, or `describeSchemaConformance` fails
  (`packages/db/src/testing/schema-conformance.ts:448-471`). `menu_periods.colour` is
  `calendarColour("colour").notNull().default("grey")` with `menu_periods_colour_ck`
  (`schema/menus.ts:7`, `:16`, `:34`).
- **Reads.** `Season` is `{ id, name, startsOn }` (`season-rules.ts:1-5`); `DEFAULT_SEASONS` are
  Spring 03-01, Summer 06-01, Autumn 09-01, Winter 12-01 (`:7-12`). `readSeasons` selects the three
  columns (`seasons.ts:27-33`), `ensureDefaultSeasons` inserts the defaults (`:35-44`). The Year and
  Month reads spread each season (`opening-hours-calendar.ts:80-83`, `:186-191`), the opening-hours
  model passes `readSeasons` through (`menu-timetable.ts:931`, `:957`; its type
  `menu-timetable-types.ts:56`). Staffing maps explicit fields: `packages/staffing/src/month.ts:42-47`,
  `packages/staffing/src/paint.ts:271-284`, types `packages/staffing/src/staffing-types.ts:42`,
  `:76-83`. No till, reporting or apps/server reader of seasons exists (`git grep -ln "seasons\b"` in
  `apps/till/src`, `apps/server/src`, `packages/reporting/src`, `packages/workforce/src` finds only
  `apps/server/src/testing/clear-provision-fixture.ts`; `apps/dashboard/src/api/live-queries.ts`
  lists the table).
- **Writes.** `saveSeason`, `addSeason`, `deleteSeason`, `seasonDeleteImpact` (`seasons.ts:77-161`)
  behind `PUT …/seasons/:id`, `POST …/seasons`, `DELETE …/seasons/:id` (all `gated`, i.e.
  `venue_service.manage`) and `GET …/seasons/:id/delete-impact` (`viewed`, `venue.view`)
  (`routes.ts:477-529`; `gated`/`viewed` at `:398-416`). A rename alone skips the stale-clock check
  (`seasons.ts:76`, `:88-94`); an add copies the department and zone weeks of the season it starts
  inside (`:100-127`); a delete gives the season's days to the one before and refuses the last
  (`:129-143`). Codes `season.not_found` (404) and `season.invalid` (400) (`routes.ts:135-136`),
  params at `errors.ts:167-179`. Nothing outside `season-chips.ts` calls the client's
  `saveSeason`/`addSeason`/`deleteSeason`/`readSeasonDeleteImpact`
  (`opening-hours-client.ts:262-273`). (`packages/staffing/src/dashboard/client.ts:205`'s
  `saveSeason` is staffing's week write, unrelated.)
- **Tints.** `seasonTints` maps each season to `"1"`–`"4"` by place in start order
  (`season-tint.ts:36-45`), painting `--wt-color-season-<n>` tokens (`:7-31`;
  `packages/ui-core/src/tokens/colors.css:73-84` and its three other theme blocks; cases
  `packages/ui-core/src/tokens/colors.test.ts:474-532`). Readers: `season-chips.ts:220`,
  `opening-hours-year.ts:471`, `opening-hours-month.ts:635`, `season-painter.ts:567`,
  `period-dialog.ts:363`, `periods-list.ts:44-51`, `:189`, `:207` (fallback `"1"`),
  `packages/staffing/src/dashboard/staffing-month.ts:449`, `staffing-season-painter.ts:391`. The
  Week view paints no season (`git grep -n -i "season\|tint" opening-hours-week.ts` finds nothing).
- **Station tints**, the palette this plan reuses: `STATION_COLOUR_TOKENS` gives every calendar
  colour a light `fill` and a `dot` (`station-colour-styles.ts:6-29`; grey is a `color-mix`
  fallback). `colors.test.ts:587-625` holds, in both themes, that text, muted text, warning and
  danger read at 4.5:1 or more on every station fill, and each dot stands 3:1 or more from every
  fill and from the surface — the season chip's needs (text on tint, line against tint and
  surface), except grey, which no token case covers.
- **The window today.** The screen draws `window/seasons` as a compact `wt-modal`
  (`data-test=calendar-window`, `data-window=seasons`) holding `season-chips` with a footer Close
  (`opening-hours-screen.ts:451-473`), from `this.yearModel?.seasons ?? this.monthModel?.seasons`.
  The window draft root is `windowDraftRoot` (`:154`), offered by `navigationScopes` whenever a
  window is open (`:386-397`); `beforeWindowClose` writes the address without the window pair and
  returns false (`:399-402`); `calendar-window-open` is heard on the screen (`:403-410`, `:570`).
  Special days for an end-offset refusal are read on `season-dialog-open` (`:885-895`, `:1527`).
  Chips' writes end in `season-changed` → `api.rereadWithSpecialDays()` (`:467-470`, `:1529-1532`).
- **The Year's row.** `season-chips` gets `.seasons`, `.clockRevision`, `.api`, `.specialDays`,
  `.readOnly`, with "Periods…" (`data-test=open-periods`) in its default slot
  (`opening-hours-year.ts:485-503`); the Year's `api` and `specialDays` props feed nothing else
  (`:204-208`). The Month draws key-only chips (`opening-hours-month.ts:648-653`).
- **Permissions.** The Calendar screen needs `venue_service.manage` to edit and `venue.view` to read
  (`packages/venue-service/src/dashboard/index.ts`, the `opening-hours` entry's
  `requiresPermission`/`readPermission`). A viewer's window today shows the chips with week
  buttons, no ✎ and no "+ Season" (`opening-hours-screen.painter.test.ts:852-877`).
- **Live data.** The screen's model is `watchOpeningHours`, subscription
  `venue-service:opening-hours` (`opening-hours-client.ts:41-56`), whose dependencies include
  `seasons` (`live-queries.ts:186-201`); `scripts/live-subscriptions.test.ts` is unaffected (no new
  subscription).
- **In-row editing precedent:** the Extras list edits rows of a plain `<table>` with `hide-label`
  fields named `item-<i>-<field>` and one Save (`apps/dashboard/src/widgets/extra-list-form.ts:790-880`);
  the option list wraps its table in a scrolling region (`option-list-form.ts:672-690`).
  `wt-input` and `wt-combobox` have `hide-label` (`packages/ui-core/src/components/wt-input.ts:65`,
  `packages/ui/src/components/wt-combobox.ts:403`); `wt-colour-chooser` has not
  (`wt-colour-chooser.ts:136-150`).
- **Footer layout:** `wt-form-actions` draws its `cancel` slot at the start and the primary slots at
  the end (`packages/ui-core/src/components/wt-form-actions.ts:82-83`); the house row is
  `[Cancel] [Delete] … [Save]` (design-system.md → Forms, owner 2026-10-16).

## Decisions this plan makes (defaults; each may be overruled)

1. **`seasons.colour` is a plain `label("colour").$type<CalendarColour>().notNull().default("grey")`,
   with no CHECK and no trigger.** `$type` gives `readSeasons` the `CalendarColour` type without a
   vocabulary, so schema conformance passes (a plan reviewer's probe in a throwaway worktree,
   2026-10-17: the venue-service conformance suite passed 67 of 67 with that column, failed with
   `enumType` and no CHECK, and a CHECK made drizzle-kit write a rebuild). A CHECK makes drizzle rebuild `seasons`, and that rebuild's `DROP TABLE` empties
   `department_days`, `zone_days` and `staffing_days` (above). `enumType` without a CHECK fails
   schema conformance, so the column is a plain label. A trigger pair (the `products.ordering`
   precedent, `packages/db/drizzle/0047_product_ordering_check.sql`) was rejected: it adds refusal
   words to register and match for a value whose only harm when wrong is a grey chip
   (Decision 11). Where the refusal moved to is said at the column, as CLAUDE.md §3 asks: the one
   writer (`saveSeasons`, `season.invalid` field `save.<i>.colour`) and the import validator
   (`validateSeasonWeeks`, refusal `seasons.colour`). Every other insert in the tree takes the
   default (`seasons.ts:39` defaults carry explicit colours; `packages/staffing/test/seed.ts:39`
   and test inserts take `'grey'`).
2. **Existing rows become grey; the defaults are Spring green, Summer amber, Autumn orange,
   Winter blue.** No data migration (CLAUDE.md §3). The four defaults keep today's default look:
   the retired tints run green, amber, peach, blue from Spring (`colors.test.ts:498-520`), and
   mockup 01 draws Spring green, Summer yellow, Autumn salmon, Winter blue.
3. **Colours need not be unique.** Like periods, the chooser marks which other seasons use each
   colour (`calendarColourChoices`' `usedBy`, with `hours.colour_used_by`).
4. **The server never picks a colour.** Every saved entry carries one; "the next unused colour" is
   decided once, in the browser, by the existing `firstUnusedCalendarColour`
   (`calendar-colours.ts:43-48`) over the window's rows.
5. **One request, carrying only what changed.** `PUT /management-api/venue-service/seasons` with
   `{ save: SeasonEntry[], delete: string[], expectedClockRevision: number }`, where a saved entry
   with an `id` changes that season and one without adds a season. Unchanged seasons are not sent,
   so a season another session added while the window was open is neither overwritten nor
   deleted. One `withTransaction` (through `gated`). Changed names and starts are written in two
   passes — first to temporary values no real season can hold, then to their final values — so a
   swap of two names or two starts does not trip a unique index the final state satisfies
   (CLAUDE.md §3, "Rewriting rows one at a time inside a transaction can break a unique index the
   final state satisfies"); ids are kept, so each season's weeks stay with it. Answers 200 with the
   venue's seasons by start.
6. **The single-season write routes and functions are retired** (`POST /seasons`,
   `PUT /seasons/:id`, `DELETE /seasons/:id`; `addSeason`, `saveSeason`, `deleteSeason`), with
   every behavioural assertion moved onto `saveSeasons` and its route. `GET
   /seasons/:id/delete-impact` and `seasonDeleteImpact` stay: the window reads them. Pre-live, no
   compatibility route (CLAUDE.md §3).
7. **A refusal names the request path**, as `saveSeasonWeeks` does (`conventions-data.md:650-656`):
   `season.invalid` `field` becomes a string — `save.<i>.name`, `save.<i>.startsOn`,
   `save.<i>.colour` (with `reason: "taken"` for a duplicate), `delete` (with `reason: "last"`), and
   `seasons` (with `reason: "end_offset"` and today's clash params). `season.not_found { seasonId }`
   for an id the venue does not hold, in `save` or `delete`.
8. **Clock.** A call that only renames or recolours is a `"metadata"` write and skips the stale
   revision, as a rename does today; any add, delete or moved start is a `"time"` write. The window
   sends the clock revision its draft was last clean at, as the chips' dialog sent the revision it
   opened at (`season-chips.ts:20-22`). **The check order changes for an add:** today `addSeason`
   checks the clock revision before it validates the input (`seasons.ts:109-111`), while
   `saveSeason` validates first (`:86-94`); `saveSeasons` validates everything first, then checks the
   clock. No existing case pins the order (each refusal case sends one fault at a time).
9. **A new season copies the weeks of the season that held its start before the call** — read
   before any delete, so splitting a season deleted in the same call still copies its weeks. Today's
   `addSeason` rule, with "before the call" made explicit.
10. **Seasons are painted with the station tints.** A season of colour `c` paints
    `STATION_COLOUR_TOKENS[c].fill` as its tint, `STATION_COLOUR_TOKENS[c].dot` as its line and
    `var(--wt-color-text)` as its text. The `--wt-color-season-1`…`-4` tokens (with their `on-` and
    `-line` tokens) and their "season colours" cases go. A new venue-service test measures all
    thirteen season paints, grey included, in both themes, to the same bars the retired cases held
    (text 4.5:1 on the tint; line 3:1 from the tint and from the surface). Thirteen new season
    tokens per theme were rejected as duplication of the station fills, which already meet those
    bars.
11. **`seasonTints` keeps its name and module** and returns `Map<seasonId, CalendarColour>` read
    from each season's stored `colour`; a colour outside `CALENDAR_COLOURS` (impossible through the
    writers, possible in the database, Decision 1) reads `"grey"`. `[data-tint]` values become
    colour names.
12. **Row order:** the season in force on 1 January first, then the rest by start — mockup 02 lists
    Winter, Spring, Summer, Autumn. Read "the order it starts in the year" as calendar order from
    January. Rows do not re-sort while editing (the mockup's hint: "The list re-sorts by start date
    when you save"); "+ Season" appends.
13. **"Starts on" is a Day and a Month combobox side by side**, as today's dialog has
    (`season-dialog.ts:321-358`, including its clamp of the day to the month and February's 28),
    not the single field mockup 02 draws: no primitive picks a month-day, and a 365-option list
    was rejected.
14. **The window draws its own `wt-modal`**, unlike the Periods window, because its footer holds the
    draft's Save and its bottom message. The host `seasons-window` carries
    `data-test="calendar-window" data-window="seasons"`, takes the screen's `beforeClose`, and the
    inner modal's composed `wt-close` reaches the screen's existing handler. Unsized (wide) like the
    Periods window, `heading` "Seasons". Footer `[Cancel] … [Save]` (house rule); "+ Season" sits in
    the body under the table, at the start, followed by the hint line — mockup 02 draws "+ Season"
    in the footer, but it predates the 2026-10-16 house rule (the reasoning of A719 Decision 5).
    Cancel, Escape and Back go through the leave question like every edited dialog
    (design-system.md:2615-2622): with no changes the window closes; with changes it asks, and
    Discard discards — the spec's "Cancel discards" with the house's protection in front of it.
15. **The bin removes a row from the draft.** A stored season's bin also reads its delete impact
    (the existing GET) and adds a note under the table: "Saving deletes {name}; its days join
    {previous}." followed by today's "The hours of {departments} in it are lost." or "No department
    has hours in it.", or, when the read fails, "Which departments lose hours could not be read."
    This keeps today's warning (the dialog's confirmation, `season-dialog.ts:255-297`) without an
    extra step. The last remaining row's bin is disabled. Cancel is the only undo.
16. **A viewer** sees "Seasons…" and a read-only window: each row's colour swatch with its colour
    name, name, start and "Runs until" as text; no inputs, no bins, no "+ Season", no Save; a footer
    Close; no draft scope.
17. **A snapshot arriving while the window is open** (`mergeSeasonDraft`, Task 6): with a clean draft
    the rows follow the new list and the clock revision is taken again. With a dirty draft, per
    stored season and per field, as the house's `DraftRows` does (`packages/dashboard-kit/src/merge-draft.ts:1-21`,
    named by `docs/developers/dashboard-live-updates.md:29-32`): a field the person has not changed
    takes the new value, a field they changed keeps theirs, and the baseline moves to the new list;
    a season new to the list is appended untouched; a season gone from the list is dropped if
    untouched or binned, and kept with "This season no longer exists." under its name if touched —
    Save stays disabled until that row is binned (binning a gone row sends no delete). New draft
    rows are never affected. `DraftRows` itself is not reused: its `merge` maps over the incoming
    rows only (`merge-draft.ts:6-17`), so a changed row whose season was deleted elsewhere vanishes
    with the person's edits, and it has no notion of new rows (no id) or of binned ones.
18. **The window does not open a season's week**; the chips keep that (mockup 02 note 4).
19. **`wt-colour-chooser` gains `hide-label`:** the label is kept in the DOM, visually hidden, so the
    trigger's name is still label then colour name; no asterisk drawn; the field draws no label
    space. The trigger keeps showing the colour's name beside the swatch, so the window never relies
    on colour alone.
20. **A configuration transfer refuses a season row whose `colour` is not a calendar colour**,
    absent included, as it does for `menu_periods.colour` (`configuration-transfer.ts:132`).
21. **Strings** (en / es), new: `season.open_window` "Seasons…" / "Temporadas…";
    `season.column_name` "Season" / "Temporada"; `season.runs_until` "Runs until" / "Hasta el";
    `season.window_hint` "A season runs until the next one starts. The list re-sorts by start date
    when you save." / "Una temporada dura hasta que empieza la siguiente. La lista se ordena por
    fecha de inicio al guardar."; `season.delete_named` "Delete {name}" / "Eliminar {name}";
    `season.delete_new` "Delete this new season" / "Eliminar esta temporada nueva";
    `season.delete_pending` "Saving deletes {name}; its days join {previous}." / "Al guardar se
    elimina {name}; sus días pasan a {previous}."; `season.delete_loses_unknown` "Which departments
    lose hours could not be read." / "No se pudo saber qué departamentos pierden horarios." Reused:
    `season.seasons`, `season.add`, `season.starts`, `season.day`, `season.month`, `season.name_taken`,
    `season.start_taken`, `season.start_required`, `season.last`, `season.not_found`,
    `season.offset_*`, `season.delete_loses`, `season.delete_loses_none`, `hours.colour`,
    `hours.colour.*`, `hours.colour_used_by`, `hours.colour_required`, `hours.clock_changed`,
    `hours.clock_change_pending`, `prep.name`, `prep.name_required`, `prep.save`, `prep.cancel`,
    `prep.save_error`, `prep.fix_fields`, `calendar.window.close`. Removed once nothing reads them
    (re-grep first): `season.edit_named`, `season.new`, `season.edit`, `season.delete`,
    `season.delete_question`, `season.back`.

---

## Global constraints

- **Worktree:** `/Users/clintongormley/workspace/worktrees/waitron-feat-a721-seasons-window`,
  branch `feat/a721-seasons-window`. Every commit `git commit -s`; stage explicit paths. **One pull
  request.**
- **Test first.** Each task writes its failing test, runs it, sees it fail for the stated reason,
  then writes the code.
- **Task size.** Each task is meant to finish well under 100 tool calls. An implementer past about
  150 with its task unfinished stops at a passing or cleanly red point, commits, and hands over:
  done, left, files, each check's state.
- **Focused runs** (check `memory_pressure | grep free` first; beside another session's browser run
  only when free memory is well above 15%):

  ```bash
  pnpm --filter @waitron/venue-service exec vitest run --project node src/<file>.test.ts
  pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/<file>.test.ts
  pnpm --filter @waitron/staffing exec vitest run --project node src/<file>.test.ts
  pnpm --filter @waitron/staffing exec vitest run --project browser src/dashboard/<file>.test.ts
  pnpm --filter @waitron/ui exec vitest run src/components/<file>.test.ts
  pnpm --filter @waitron/ui-core exec vitest run src/tokens/colors.test.ts
  pnpm --filter @waitron/dashboard exec vitest run --project browser src/<file>.test.ts
  ```

  Read the `Tests` count; a run without one proves nothing. CI runs the package suites and coverage
  (new files hold 98/98/98/95); no whole-workspace local run (CLAUDE.md §2).
- **Every implementer dispatch** also runs `pnpm format:check`, and `pnpm --filter <pkg> typecheck`
  and `lint` for each package it touched **and each package that imports what it changed**
  (`@waitron/staffing` imports venue-service's season types and `season-tint`). **Every commit in
  task order leaves typecheck green across the workspace** — the task order below is built for it;
  a task that cannot commit green stops and reports.
- **Changing an existing test check** is allowed only where the spec changes what it checks (owner
  decision 2026-10-05). Each task lists them under "Existing checks that change"; the PR description
  repeats the union under **"Changed test checks"**. A check deleted without an equally strict
  replacement is a STOP: report it. A moved check names its replacement. Fixture data (a `colour` on
  a season fixture, a selector) is setup, listed too, with the assertions after it unchanged.
- **Database tests** use `useVenueDb`; a refusal is caught outside the `withTransaction` (CLAUDE.md
  §3); a rejected write asserts the domain code (§4).
- **Browser tests:** history through a `pushState`/`replaceState` spy, never `history.length`; a
  close awaited by its event; widths by `page.viewport(w, h)` with `window.innerWidth` asserted; a
  test setting Spanish restores English in `finally`/`afterEach`; a click whose outcome depends on
  listener order uses `userEvent.click`.
- **UI rules:** `wt-*` field primitives only (`scripts/native-form-fields.test.ts`); tokens only
  (`scripts/style-token-names.test.ts`); app events named plainly, `{ bubbles: true, composed: true }`,
  payload in `detail`, the listener calls `event.stopPropagation()` first; every input has a
  semantic `name`.
- **Ledger:** `docs/handoffs/2026-10-17-a721-seasons-window.md` (gitignored), opening
  `Status: in progress`; updated at the end of every task; `Status: done` when the PR lands.

## Review Focus

1. **Swapping two seasons' starts (Summer ↔ Autumn) and two names in one Save.** Expected: saved,
   no unique-index refusal, each id keeps its weeks. Pinned in Task 2 (writer) and Task 7b (the
   window sends one request holding both).
2. **Another session deletes, renames or adds a season while the window has edits.** Expected: an
   untouched row follows; a touched row keeps the person's values; a touched row whose season is
   gone is marked under its name and blocks Save until binned; an added season appears. Pinned in
   Task 6 (rule) and Task 7c (element).
3. **A viewer opens `window/seasons`.** Expected: a read-only table, a Close, nothing to change.
   Pinned in Tasks 7a and 8a.
4. **A phone (390 px), English and Spanish.** Expected: the table scrolls inside its region, the
   page does not scroll sideways, Cancel and Save are on screen, a colour panel opens on screen.
   Pinned in Task 7a.
5. **A refused Save** (a name a season added elsewhere already holds; an end-offset clash).
   Expected: the window stays open with the draft, the row's field or the bottom says why, Save stays
   enabled. Pinned in Task 7b.

---

## Task 1: Store a colour per season (schema, migration, reads, fixtures)

**Files:**
- Modify: `packages/venue-service/src/schema/seasons.ts:21-28` (the column and its one-line note,
  Decision 1)
- Create (generated): `packages/venue-service/drizzle/0058_<generated>.sql`,
  `drizzle/meta/0058_snapshot.json`, `drizzle/meta/_journal.json` entry
- Modify: `packages/venue-service/src/season-rules.ts:1-12` (`Season.colour`; `DEFAULT_SEASONS`
  colours, Decision 2)
- Modify: `packages/venue-service/src/seasons.ts:27-44`, `:95-97`, `:113-116` (select and return
  `colour`; `saveSeason` returns the stored colour, `addSeason` inserts `"grey"` until Task 3
  retires both)
- Modify: `packages/venue-service/src/menu-timetable-types.ts:56` (`seasons: readonly Season[]`)
- Modify: `packages/venue-service/src/configuration-transfer.ts:258-270` (refuse `seasons.colour`,
  Decision 20)
- Fixtures (setup — add a `colour` to each season): `packages/venue-service/src/testing/department-hours-fixture.ts`,
  `hours-models.ts`, `opening-hours-month-fixture.ts:119-121`, `season-painter-fixture.ts:29-31`;
  and in `packages/venue-service/src/dashboard/`: `opening-hours-screen.painter.test.ts:25-28`,
  `opening-hours-screen.test.ts:878`, `:1802-1805`, `opening-hours-year.test.ts:20-25`, `:215`,
  `opening-hours-year.a11y.test.ts:16-21`, `opening-hours-screen.week.test.ts:35-36`,
  `periods-list.test.ts:52-53`, `:203-207`, `:531-535`, `periods-list.a11y.test.ts:65-68`,
  `periods-list.delete.test.ts:44`, `periods-list.editing.test.ts:68`,
  `service-delete-editors.test.ts:126`, `season-choice.test.ts:5-8`, `season-week-view.test.ts:4-6`,
  `season-chips.test.ts:9-13`, `:91`, `season-chips.a11y.test.ts:13-18`; and the season rows of
  `packages/venue-service/src/configuration-transfer.test.ts` (`:245`, `:1200-1203`, `:1625`, and any
  other `seasons` row it builds — grep). Colours by name: Spring `green`, Summer `amber`, Autumn
  `orange`, Winter `blue`; `season-chips.test.ts:91`'s "Late summer" `teal`;
  `opening-hours-year.test.ts:215`'s "Late" `purple`; any other season a colour none of its
  siblings in that fixture has (`opening-hours-month-fixture.ts`'s two seasons must differ:
  `opening-hours-month.test.ts:134-140`).
- Test: `packages/venue-service/src/seasons.test.ts`, `migrations.test.ts`,
  `menu-timetable.test.ts`, `opening-hours-calendar.test.ts`, `configuration-transfer.test.ts`,
  `season-routes.test.ts`

**Interfaces:**
- Produces: `interface Season { id: string; name: string; startsOn: string; colour: CalendarColour }`
  (`CalendarColour` from `@waitron/shared`). `DEFAULT_SEASONS: readonly { name; startsOn; colour }[]`.
  `readSeasons(tx, cfg): Promise<Season[]>` now with `colour`. `OpeningHoursModel["seasons"]`,
  `OpeningHoursYear["seasons"]`, `OpeningHoursMonth["seasons"]` carry `colour`.

- [ ] **Step 1: Write the failing tests.**
  - `seasons.test.ts`, new **"gives a new location Spring green, Summer amber, Autumn orange and
    Winter blue"**: after `ensureDefaultSeasons`, `readSeasons` mapped to `[name, colour]` is
    `[["Spring","green"],["Summer","amber"],["Autumn","orange"],["Winter","blue"]]`.
  - `seasons.test.ts:82-90`: the `toEqual` at `:89` becomes
    `[{ id: own!.id, name: "All year", startsOn: "01-01", colour: "grey" }]` — a season inserted with
    no colour reads `"grey"` (Decision 2).
  - `migrations.test.ts`, new **"a season row written without a colour takes grey, and the table
    takes any text there"**: a raw `insert into seasons (id, location_id, name, starts_on)` then
    `select colour` → `"grey"`; a raw insert with `colour = 'mauve'` succeeds (the column has no
    CHECK: this pins Decision 1 so a later CHECK — and its rebuild — is a visible decision).
  - `menu-timetable.test.ts:1444-1449`, `opening-hours-calendar.test.ts:143-148` and `:348-351`:
    each expected season gains its default colour.
  - `season-routes.test.ts:329-345` and `:347-364`: the whole-body answers gain `colour` (Summer
    `"amber"`; the added Feria `"grey"`, `addSeason`'s interim insert) — a plan reviewer ran Task 1's
    read change and the venue-service node suite failed these two beside the eight named here.
  - `configuration-transfer.test.ts`, new **"refuses a season whose colour is not a calendar
    colour, or has none"**: with the shared valid tables, `colour: "mauve"` and a deleted `colour`
    each throw `refusal("seasons.colour")`; `"teal"` passes.
- [ ] **Step 2: Run them, see them fail** (no column; `colour` missing from reads):
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/seasons.test.ts src/migrations.test.ts src/menu-timetable.test.ts src/opening-hours-calendar.test.ts src/configuration-transfer.test.ts src/season-routes.test.ts`
- [ ] **Step 3: Implement.** The column (`label("colour").$type<CalendarColour>().notNull().default("grey")`, one comment
  line: no CHECK because adding one rebuilds `seasons` and the rebuild's DROP cascades its weeks;
  refused by `saveSeasons` and `validateSeasonWeeks`). Then generate:
  `pnpm --filter @waitron/venue-service db:generate`. **Read the SQL:** it must be the single
  statement ``ALTER TABLE `seasons` ADD `colour` text DEFAULT 'grey' NOT NULL;`` — if it creates
  `__new_seasons` or holds anything else, STOP and report. Never hand-edit the SQL, snapshot or
  journal. Then the reads, types, defaults, the transfer refusal and the fixtures.
- [ ] **Step 4: Run** the six files, then the whole venue-service node project
  (`pnpm --filter @waitron/venue-service exec vitest run --project node`) to catch any other
  whole-shape pin, adding any it finds to this task's list; then `pnpm --filter @waitron/venue-service typecheck`
  (the fixtures are what it catches) and `pnpm --filter @waitron/staffing typecheck` (unchanged
  until Task 1b, still green: staffing maps explicit fields); then the guards from the repository root:
  `pnpm exec vitest run scripts/migrations-match-schema.test.ts scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts scripts/column-vocabulary.test.ts`,
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/schema/schema-conformance.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`
  (unedited). All pass.
- [ ] **Step 5: Run the browser files whose fixtures changed** (`season-chips.test.ts`,
  `opening-hours-year.test.ts`, `opening-hours-month.test.ts`, `periods-list.test.ts`,
  `period-dialog.test.ts`, `season-painter.test.ts`): unchanged counts, all pass (tints are still by
  place until Task 4a).
- [ ] **Step 6: Commit** — `git commit -s -m "Seasons store a colour; new venues start Spring green, Summer amber, Autumn orange, Winter blue (A721)"`

**Existing checks that change:** `seasons.test.ts:89` (gains `colour: "grey"`),
`menu-timetable.test.ts:1444-1449`, `opening-hours-calendar.test.ts:143-148`, `:348-351`,
`season-routes.test.ts:338`, `:340`, `:356` (each whole-shape pin gains the season's colour; the
owner rule allows a check to change when the spec changes the shape it pins) — spec point 2. Setup: the fixtures listed above; in
`seasons.test.ts:266-280`, `:341-346`, `:375-384` the season `saveSeason`/`addSeason` return gains its
colour (those cases are moved in Task 2 and deleted in Task 3).

## Task 1b: Staffing carries each season's colour

**Files:**
- Modify: `packages/staffing/src/staffing-types.ts:42`, `:76-83` (`colour: CalendarColour`),
  `packages/staffing/src/month.ts:42-47`, `packages/staffing/src/paint.ts:284`
- Fixtures (setup): `packages/staffing/src/testing/season-staffing-fixture.ts:54-57`,
  `staffing-month-fixture.ts:58-60` (Winter `blue`, Summer `amber`, any other a colour its
  siblings lack)
- Test: `packages/staffing/src/month.test.ts:136-138`, `paint.test.ts:331-334`,
  `routes.test.ts:575-577`

- [ ] **Step 1: Write the failing tests.** The three node expectations gain each season's colour
  (`paint.test.ts:325`'s inserted Winter reads `"grey"`).
- [ ] **Step 2: Run, see them fail**:
  `pnpm --filter @waitron/staffing exec vitest run --project node src/month.test.ts src/paint.test.ts src/routes.test.ts`
- [ ] **Step 3: Implement** the types and the two projections.
- [ ] **Step 4: Run** them, and `--project browser src/dashboard/staffing-month.test.ts
  src/dashboard/staffing-season-painter.test.ts` (unchanged counts: tints are still by place until
  Task 4a); staffing `typecheck`, `lint`.
- [ ] **Step 5: Commit** — `git commit -s -m "Staffing carries each season's colour (A721)"`

**Existing checks that change:** `month.test.ts:136-138`, `paint.test.ts:331-334`,
`routes.test.ts:575-577` (whole-shape pins gain `colour`) — spec point 2.

## Task 2: `saveSeasons`, the one writer for season changes

**Files:**
- Modify: `packages/venue-service/src/seasons.ts` (add `saveSeasons` and `temporaryStart`; keep the
  old three until Task 3)
- Modify: `packages/venue-service/src/season-rules.ts` (the request types, browser-safe)
- Modify: `packages/venue-service/src/errors.ts:170-179` (`season.invalid.field: string`, documented
  as the request path, Decision 7)
- Test: `packages/venue-service/src/seasons.test.ts` (new describe "saveSeasons")

**Interfaces:**
- Produces (in `season-rules.ts`):
  `interface SeasonEntry { id?: string; name: string; startsOn: string; colour: CalendarColour }`,
  `interface SeasonChange { save: readonly SeasonEntry[]; delete: readonly string[] }`.
- Produces (in `seasons.ts`):
  `saveSeasons(tx: Transaction, cfg: VenueScope, change: SeasonChange, at: Date, expectedClockRevision: number): Promise<Season[]>`
  and `temporaryStart(index: number): string`.

- [ ] **Step 1: Write the failing tests** (`describe("saveSeasons")`, with the retiring cases' venue
  helper `autumnVenue` and readers, `seasons.test.ts:115-222`). Moved from the retiring cases, each assertion kept, expressed as
  one change:
  - from `:226` (it.each bad starts) → `save: [{ id: winter, …, startsOn: bad }]` refused
    `season.invalid { field: "save.0.startsOn" }`;
  - from `:236` → a start another season holds: `{ field: "save.0.startsOn", reason: "taken" }`;
  - from `:247` → a taken name (also when sent padded, `"  Winter "`) `{ field: "save.0.name",
    reason: "taken" }`, an empty name `{ field: "save.0.name" }`;
  - from `:266` → a rename trims and keeps the start (the returned list holds `{ id, name:
    trimmed, startsOn, colour }`);
  - from `:274` → moving Winter to 11-15 makes 20 November resolve to Winter on the next read;
  - from `:285` → a move clashing with a special day's sending is refused `{ field: "seasons",
    reason: "end_offset", … }` with the same clash params the old case asserts, and nothing changed;
  - from `:329` → a move under a stale revision is refused `hours.clock_changed` before anything
    changes; from `:341` → a rename (and, new, a recolour) under the same stale revision is saved;
  - from `:361` and `:502` → another venue's season id in `save` or `delete` is refused
    `season.not_found { seasonId }`;
  - from `:375` → adding Christmas from 12-20 copies Winter's department and zone weeks; from `:393`
    → Mid autumn from 10-01 borders cleanly; from `:406` → a venue with no seasons gets its four
    before the add; from `:421` → an add's bad start, taken start, taken name and stale revision are
    each refused (paths `save.0.*`, `hours.clock_changed`);
  - from `:446` and `:460` → a deleted season's days join the one before (the last, for the first)
    and its weeks go; from `:474` → deleting every season is refused `{ field: "delete", reason:
    "last" }`; from `:486` → a delete making Autumn's Saturday Dinner send into Winter's Sunday
    Breakfast is refused `end_offset`.
  New:
  - **"swaps Summer's and Autumn's starts and their names in one call, each id keeping its
    weeks"** (Review Focus 1): ids unchanged, names and starts exchanged, each id's
    `department_days` rows unchanged in count and content.
  - **"stores each entry's colour, and refuses one outside the calendar colours"**: a recolour to
    `teal` reads back `teal`; `"mauve"` is refused `{ field: "save.0.colour" }`.
  - **"adds, moves, recolours and deletes in one call, answering the venue's seasons by start"**.
  - **"refuses a duplicate between two sent entries naming the later one"**: two new entries named
    `Feria` → `{ field: "save.1.name", reason: "taken" }`; same for starts.
  - **"a refusal anywhere writes nothing"**: a call whose last entry is invalid, run in its own
    `withTransaction` caught outside it, leaves `readSeasons` and every week as before.
  - **"a new season inside a season deleted in the same call copies the deleted season's weeks"**
    (Decision 9).
  - **"temporaryStart gives 365 distinct values no real start can equal and the table accepts"**:
    for `i` in `0..364`, values distinct, `parseSeasonStart(value) === null`, value matches
    `/^[01][0-9]-[0-3][0-9]$/`, value `!== "02-29"`.
- [ ] **Step 2: Run, see them fail** (`saveSeasons` not defined):
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/seasons.test.ts`
- [ ] **Step 3: Implement `saveSeasons`.** Order: `all = ensureDefaultSeasons`; every `delete` id and
  every saved `id` must be in `all` (`season.not_found`); parse each entry (trimmed name non-empty;
  `parseSeasonStart`; colour in `CALENDAR_COLOURS`); build the final set (stored, less deletes, with
  saved values, plus new) and refuse a duplicate name or start naming the entry that brings it
  (`taken`), an empty final set (`delete`, `last`); `assertBusinessDayScheduleWrite` with `"time"`
  unless the call only renames or recolours (Decision 8); read the weeks of every split season
  (`seasonOn(all, "2001-" + startsOn)` per new entry) with `readDepartmentSeasonWeeks` /
  `readZoneSeasonWeeks` before writing; delete; pass 1 sets each existing entry whose name or start
  changes to name `" " + id` (a final name is trimmed, so never starts with a space) and start
  `temporaryStart(k)`; pass 2 sets final name, start and colour; insert the new seasons and write
  their copied weeks (`writeDepartmentSeasonWeeks` / `writeZoneSeasonWeeks`, as `seasons.ts:117-124`);
  if a `"time"` write, `scheduleEndOffsetClash` once (refusal field `seasons`); return `readSeasons`.
  `temporaryStart` enumerates `MM-DD` for MM `00`–`19`, DD `00`–`39`, skipping every value
  `parseSeasonStart` accepts and `02-29` (434 values).
- [ ] **Step 4: Run** `seasons.test.ts` (old and new cases pass), `season-routes.test.ts`,
  and `scripts/errors-reachable.test.ts` from the root; `typecheck`, `lint`.
- [ ] **Step 5: Commit** — `git commit -s -m "saveSeasons writes every season change in one transaction (A721)"`

**Existing checks that change:** none yet (the moved cases are added beside the old; Task 3 deletes
the old).

## Task 3: The `PUT /seasons` route; the single-season writes retire

**Files:**
- Modify: `packages/venue-service/src/routes.ts:349`, `:477-522` (remove the three routes and
  `seasonInput`; add `PUT /management-api/venue-service/seasons`)
- Modify: `packages/venue-service/src/seasons.ts` (delete `saveSeason`, `addSeason`, `deleteSeason`,
  `parseSeasonInput` once nothing calls them)
- Modify: `packages/venue-service/src/dashboard/opening-hours-client.ts` (add `saveSeasons`; the
  three old methods stay until Task 8b removes their only caller)
- Test: `packages/venue-service/src/season-routes.test.ts` (describe "the season routes"),
  `seasons.test.ts`, `packages/venue-service/src/dashboard/opening-hours-client.test.ts`

**Interfaces:**
- Consumes: Task 2's `saveSeasons`, `SeasonChange`.
- Produces: `PUT …/seasons` body `{ save, delete, expectedClockRevision }` → 200 `Season[]`.
  `OpeningHoursApi.saveSeasons(change: SeasonChange, expectedClockRevision: number): Promise<Season[]>`
  (`this.request(\`${BASE}/seasons\`, "PUT", { ...change, expectedClockRevision })`).

- [ ] **Step 1: Write the failing tests** in `season-routes.test.ts`, each moved from the retiring
  case it names, same venue helper (`routed()`), same assertions on stored rows:
  - from `:329` **"PUT /seasons renames and moves a season, answering the seasons"**: `save: [{ id:
    Summer, name: " Verano ", startsOn: "06-15", colour: "amber" }]` → 200, body contains
    `{ id: Summer, name: "Verano", startsOn: "06-15", colour: "amber" }`, stored likewise;
  - from `:347` **"…adds a season"**: an entry with no id → 200, stored names in order Spring, Feria,
    Summer, Autumn, Winter;
  - from `:366` **"…deletes a season"**: `delete: [Autumn]` → 200, stored Spring, Summer, Winter;
  - from `:386` **"refuses a viewer, writing nothing"**: the supervisor's PUT → 403
    `authorization.not_permitted`, stored unchanged;
  - from `:405` **"answers season.invalid with 400, naming the path"**: `save.0.name` `taken`,
    `save.0.startsOn` for `02-29`, `save.0.name` for `name: 7`;
  - from `:436` **"answers season.not_found with 404 for an id it does not hold"**, in `save` and in
    `delete`; the delete-impact GET part (`:454`) stays word for word;
  - from `:464` **"refuses a key it does not take"**: a top-level `name` → `management.request_invalid
    { field: "name" }`; an entry key `lastDay` → `{ field: "save.0.lastDay" }` (`colour` is now
    taken: spec point 2);
  - from `:472` **"refuses a call with no clock revision, a rename included, writing nothing"** →
    409 `hours.clock_changed`;
  - from `:497` **"refuses a stale clock revision on a move, an add and a delete, writing nothing"**;
  - new **"refuses a malformed body"**: `save` not an array → `{ field: "save" }`; an entry not an
    object → `{ field: "save.0" }`; a malformed id → the code `requireBodyUuid` throws, naming
    `save.0.id`; an id in both `save` and `delete`, or twice → `management.request_invalid` naming
    the later place.
  - `opening-hours-client.test.ts`, new **"sends the season changes in one request with the clock
    revision"**: `saveSeasons({ save: [entry], delete: ["s/1"] }, 3)` calls
    `[\`${base}/seasons\`, "PUT", { save: [entry], delete: ["s/1"], expectedClockRevision: 3 }]`.
- [ ] **Step 2: Run, see them fail** (no such route; 404):
  `pnpm --filter @waitron/venue-service exec vitest run --project node src/season-routes.test.ts`
  and `--project browser src/dashboard/opening-hours-client.test.ts`.
- [ ] **Step 3: Implement** the route (`gated`, `onlyKeys(body, ["save", "delete",
  "expectedClockRevision"])`, the shape checks in the `requireWeekList` style, `routes.ts:372-396`,
  `requireClockRevision`), the client method; delete the three routes, `seasonInput`, the three
  functions and `parseSeasonInput`; delete the old cases in `season-routes.test.ts` (`:329`, `:347`,
  `:366`, `:386`, `:405`, `:436`'s PUT and DELETE parts, `:464`, `:472`, `:497`) and in
  `seasons.test.ts` (describes `saveSeason` `:225-372`, `addSeason` `:374-443`, `deleteSeason`
  `:445-515`), each replaced by the case named above or in Task 2.
- [ ] **Step 4: Run** both node files and the client file; `git grep -n "addSeason\|deleteSeason\|saveSeason(" packages/venue-service/src apps`
  finds only the client's three old methods, `season-chips.ts` and their tests (Task 8b); root
  `scripts/errors-reachable.test.ts`; `typecheck`, `lint`.
- [ ] **Step 5: Commit** — `git commit -s -m "One PUT /seasons route replaces the three season writes (A721)"`

**Existing checks that change:** `season-routes.test.ts:329`, `:347`, `:366`, `:386`, `:405`, `:436`
(PUT and DELETE parts), `:464` (colour now accepted), `:472`, `:497`; `seasons.test.ts:226-515`
(the `saveSeason`, `addSeason`, `deleteSeason` describes) — each moved to the case named in Task 2
or above (Decisions 5, 6, 7).

## Task 4a: Tint seasons by their stored colour, on every view

**Files:**
- Modify: `packages/venue-service/src/dashboard/season-tint.ts` (Decisions 10, 11)
- Modify: `packages/venue-service/src/dashboard/periods-list.ts:44-51`, `:207` (parts
  `tint-<colour>`, fallback `"grey"`); `period-dialog.ts:127` (`seasons: readonly { id: string;
  colour: string }[]`)
- Create: `packages/venue-service/src/dashboard/season-tint.test.ts`
- Test: `season-chips.test.ts`, `opening-hours-year.test.ts`, `period-dialog.test.ts`,
  `period-dialog.a11y.test.ts` (fixture), `periods-list.test.ts`, `season-painter.test.ts`, and in
  staffing `src/dashboard/staffing-month.test.ts`, `src/dashboard/staffing-season-painter.test.ts`
  (staffing's readers, `staffing-month.ts:449` and `staffing-season-painter.ts:391`, need no code
  change: their seasons carry `colour` since Task 1b, so this commit leaves staffing typechecking
  and only its expected tint values move)

**Interfaces:**
- Produces: `seasonTints(seasons: readonly { id: string; colour: string }[]): Map<string, CalendarColour>`;
  `SEASON_TINT_TOKENS: Record<CalendarColour, { tint: string; onTint: string; line: string }>`;
  `seasonTintStyles` sets the three custom properties on `[data-tint="<colour>"]` for every calendar
  colour.

- [ ] **Step 1: Write the failing tests.**
  - `season-tint.test.ts`: **"tints each season by its stored colour, whatever the list"**: the
    same season in a four-season list and alone maps to the same colour (the February case the spec
    names); **"reads an unknown colour as grey"**; **"paints every calendar colour's tint, text and
    line with the station tokens"**: for each colour, `SEASON_TINT_TOKENS[c]` equals `{ tint:
    STATION_COLOUR_TOKENS[c].fill, onTint: "var(--wt-color-text)", line: STATION_COLOUR_TOKENS[c].dot }`
    and `seasonTintStyles.cssText` holds its rule; **"each season paint reads in both themes"**
    (the replacement for the token cases Task 4b deletes): in a themed root (light, then dark), a
    probe painted with each colour's tint, text and line resolves (parse both `rgb(…)` and
    `color(srgb …)`, which Chromium gives a `color-mix`) to text ≥ 4.5:1 on the tint, line ≥ 3:1
    from the tint and from `--wt-color-surface`, for all thirteen colours.
  - `season-chips.test.ts:90-104`: tints become `["green", "amber", "teal", "orange", "blue"]` (the
    fixture's colours in start order; the ✎ parts of this case are Task 8b's).
  - `season-chips.test.ts:106-126` **"paints each chip with its season's stored colour"**: each chip's
    background, text and top border equal the probe of `SEASON_TINT_TOKENS[colour]`'s three values;
    the Set of backgrounds has the fixture's number of distinct colours.
  - `opening-hours-year.test.ts:206-228` becomes **"tints each day and chip by its season's stored
    colour"** (dates of each season read that season's colour; with the fifth season "Late" from
    12-20, 2027-12-20 reads `purple` and its chip `purple`, not a recycled first tint); `:230-253`
    **"paints each tinted day with its season's colour"** against `SEASON_TINT_TOKENS`.
  - `period-dialog.test.ts:773-777` and `period-dialog.a11y.test.ts:48` fixture seasons gain
    colours (`winter` blue, `summer` amber; setup, for the prop's new type);
    `:821`, `:828`, `:848` expect `"blue"`, `"amber"`, `["blue", "amber", null]`.
  - `periods-list.test.ts:235-241`: unchanged in shape — it already reads `seasonTints(data.seasons)`
    and finds each `tint-<value>` part painted; with the fixture's colours it now proves colour
    parts.
  - `season-painter.test.ts:333` stays `tinted: true` (fixture colour from Task 1).
  - `staffing-month.test.ts:170-171` expect the fixture's colours instead of `"1"`/`"2"`; new
    **"the season chip takes the season's stored colour"** in `staffing-season-painter.test.ts`
    (`[data-test=season]`'s `data-tint` equals the fixture season's colour).
- [ ] **Step 2: Run, see them fail** (tints are still `"1"`–`"4"`).
- [ ] **Step 3: Implement** `season-tint.ts` and the two venue-service consumers' types and parts.
  The `--wt-color-season-*` tokens stay declared until Task 4b; nothing reads them after this task.
- [ ] **Step 4: Run** the venue-service browser files above, `opening-hours-month.test.ts` (its
  `:134-140` autumn ≠ winter holds by fixture colour), `opening-hours-year.a11y.test.ts`,
  `season-chips.a11y.test.ts`, `periods-list.a11y.test.ts`, `period-dialog.a11y.test.ts`,
  `opening-hours-month.a11y.test.ts` (axe contrast now on station tints); the two staffing browser
  files; venue-service and staffing `typecheck`, `lint`. All pass.
- [ ] **Step 5: Commit** — `git commit -s -m "Seasons paint their stored colour on every view (A721)"`

**Existing checks that change:** `season-chips.test.ts:100`, `:106-126`; `opening-hours-year.test.ts:206-228`,
`:230-253`; `period-dialog.test.ts:821`, `:828`, `:848`; `staffing-month.test.ts:170-171` (place →
stored colour, spec point 2).

## Task 4b: The four season tokens go

**Files:**
- Modify: `packages/ui-core/src/tokens/colors.css` (delete every `--wt-color-season-<n>`,
  `--wt-color-season-<n>-line` and `--wt-color-on-season-<n>` declaration in its four theme blocks:
  48 lines — `grep -c color-season` counts 32, `grep -c color-on-season` 16)
- Modify: `packages/ui-core/src/tokens/colors.test.ts:474-532` (delete `SEASON_FILLS` and the
  "season colours" describe)

- [ ] **Step 1:** `git grep -n "color-season\|color-on-season" -- packages apps scripts` finds only
  the two files above (Task 4a removed the readers).
- [ ] **Step 2: Delete** the declarations and the describe.
- [ ] **Step 3: Run** `pnpm --filter @waitron/ui-core exec vitest run src/tokens/colors.test.ts`
  (the count drops by the deleted cases, the rest pass) and root `scripts/style-token-names.test.ts`;
  the grep in Step 1 now finds nothing; `ui-core` `typecheck`, `lint`.
- [ ] **Step 4: Commit** — `git commit -s -m "Retire the four position-based season tokens (A721)"`

**Existing checks that change:** `colors.test.ts:474-532` (deleted with the tokens; replaced by Task
4a's season-paint contrast case, which holds all thirteen paints to the same bars, Decision 10 — the
hue-order case `:498-520` has no replacement because no order exists any more, and the default
seasons' colours are pinned in Task 1).

## Task 5: `wt-colour-chooser` takes `hide-label`

**Files:**
- Modify: `packages/ui/src/components/wt-colour-chooser.ts` (`:136-150`, render `:317-360`)
- Test: `packages/ui/src/components/wt-colour-chooser.test.ts`, `wt-colour-chooser.a11y.test.ts`

**Interfaces:**
- Produces: `@property({ type: Boolean, attribute: "hide-label" }) hideLabel = false` (Decision 19).

- [ ] **Step 1: Write the failing tests.** **"hide-label draws no label and no asterisk, keeps the
  trigger named by its label and colour, and makes the field compact"**: with `label="Colour"
  hide-label required value="blue"`, the label element's box is at most 1 px square (visually
  hidden), no visible `*`, the trigger's `aria-labelledby` ids resolve to text "Colour" then "Blue",
  the field's height is less than the same chooser without `hide-label`; the panel still opens and
  `wt-change` still fires. a11y: a `hide-label` state in both themes passes axe.
- [ ] **Step 2: Run, see them fail.** `pnpm --filter @waitron/ui exec vitest run src/components/wt-colour-chooser.test.ts src/components/wt-colour-chooser.a11y.test.ts`
- [ ] **Step 3: Implement** in the `wt-combobox` way (`wt-combobox.ts:970-980`), keeping the label
  element with a visually-hidden class.
- [ ] **Step 4: Run** both files; `ui` `typecheck`, `lint`. `ui`'s mutation floor of 90 is checked
  only by the nightly merged run (`docs/developers/ci-and-gates.md:318-325`), so check the new lines
  here: `pnpm --filter @waitron/ui exec stryker run --mutate src/components/wt-colour-chooser.ts`
  (a local run prints a score and gates nothing; it runs the suites Vitest finds related to the
  file). Every mutant on the lines this task added must be killed; add the assertion that kills a
  survivor, and list any equivalent mutant left, with why, in the commit message.
- [ ] **Step 5: Commit** — `git commit -s -m "wt-colour-chooser takes hide-label for use in a table row (A721)"`

**Existing checks that change:** none.

## Task 6: The window's draft rules (`season-draft.ts`)

**Files:**
- Create: `packages/venue-service/src/dashboard/season-draft.ts`
- Create: `packages/venue-service/src/dashboard/season-draft.test.ts`

**Interfaces:**
- Consumes: `Season`, `SeasonChange` (Tasks 1–2); `seasonOn`, `seasonLastDay`, `byStart`
  (`season-rules.ts`); `firstUnusedCalendarColour`.
- Produces:
  - `interface SeasonRow { key: string; id?: string; name: string; day: string; month: string; colour: CalendarColour }`
    (`key` is the id for a stored season, `new-<n>` for a new one; `day` unpadded, `month` `MM`).
  - `interface SeasonDraft { rows: readonly SeasonRow[]; deleted: readonly string[] }`
  - `draftOf(seasons: readonly Season[]): SeasonDraft` — Decision 12's order.
  - `sameDraft(a: SeasonDraft, b: SeasonDraft): boolean`
  - `addRow(draft: SeasonDraft): SeasonDraft` — appends `{ key: "new-<n>", name: "", day: "", month: "", colour: firstUnusedCalendarColour(rows) }`.
  - `removeRow(draft: SeasonDraft, key: string, stored: readonly Season[]): SeasonDraft` — a stored row
    still in `stored` joins `deleted`; a new or gone row just leaves.
  - `daysIn(month: string): number` (moved from `season-dialog.ts:34-35`).
  - `runsUntil(rows: readonly SeasonRow[], key: string): string | null` — `MM-DD` from
    `seasonLastDay` over the rows with a complete start; null for an incomplete row.
  - `rowErrors(rows: readonly SeasonRow[]): Map<string, Partial<Record<"name" | "startsOn", "required" | "taken">>>`
    — blank name `required`; missing day or month `required`; a trimmed name or a start another row
    shares `taken` on every row sharing it.
  - `seasonChange(draft: SeasonDraft, baseline: SeasonDraft): { change: SeasonChange; keys: string[] }`
    — `save` holds new rows and stored rows differing from their baseline row (trimmed name, padded
    start, colour), `keys[i]` the row key of `save[i]`; `delete` the draft's `deleted`.
  - `mergeSeasonDraft(draft: SeasonDraft, baseline: SeasonDraft, latest: readonly Season[]): { draft: SeasonDraft; baseline: SeasonDraft; gone: string[] }`
    — Decision 17.

- [ ] **Step 1: Write the failing tests**, one per behaviour: order (Winter-from-12-01 first; a
  season starting 01-01 first; no seasons → no rows); `addRow`'s colour (first unused; first
  calendar colour when all thirteen are taken); `removeRow` (stored → deleted; new → gone; removing
  a row whose id is not in `stored` sends no delete); `daysIn("02") === 28`, `daysIn("04") === 30`;
  `runsUntil` (Spring 03-01 runs until 05-31 beside Summer 06-01; the last runs until the day before
  the first; an incomplete row null; a one-season list runs until the day before its own start);
  `rowErrors` (blank, missing month, duplicate name `" Winter"`/`"Winter"`, duplicate start, both
  rows marked); `seasonChange` (unchanged → empty; a rename, a recolour, a move, a new row, a delete;
  keys line up); `mergeSeasonDraft`: clean → follows latest; dirty with an untouched row renamed
  elsewhere → follows; a row whose name the person changed, renamed elsewhere → keeps the person's
  name, baseline takes the new one; a row whose colour the person changed, renamed elsewhere → takes
  the new name and keeps the person's colour; a season added elsewhere → appended to both; an untouched season deleted elsewhere →
  dropped from both; a touched one → kept, its key in `gone`; a binned one deleted elsewhere →
  removed from `deleted`; new rows untouched.
- [ ] **Step 2: Run, see them fail**:
  `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/season-draft.test.ts`
- [ ] **Step 3: Implement** the module (pure functions, no DOM).
- [ ] **Step 4: Run** it; `typecheck`, `lint`.
- [ ] **Step 5: Commit** — `git commit -s -m "The Seasons window's draft rules (A721)"`

**Existing checks that change:** none.

## Task 7a: `seasons-window` — the table, editing, adding and removing rows, read-only

**Files:**
- Create: `packages/venue-service/src/dashboard/seasons-window.ts`
- Modify: `packages/venue-service/src/dashboard/strings.ts` (Decision 21's new strings, en and es)
- Create: `seasons-window.test.ts`, `seasons-window.a11y.test.ts` (under `src/dashboard/`)

**Interfaces:**
- Consumes: Task 6's module; Task 5's `hide-label`; `calendarColourChoices` /
  `rememberedColourChoices`, `formatMonthDay`, `formatMonthName`, `MONTHS`.
- Produces: `@customElement("seasons-window") export class SeasonsWindow` with properties
  `seasons: OpeningHoursModel["seasons"]`, `clockRevision: number`, `specialDays: readonly { id: string; name: string }[]`,
  `readOnly: boolean`, `draftParent?: object`, `api?: Pick<OpeningHoursApi, "saveSeasons" | "readSeasonDeleteImpact">`,
  `beforeClose?: (reason: LeaveReason) => Promise<boolean>`. It draws `wt-modal` (unsized, `heading`
  `season.seasons`, `.beforeClose` forwarded). Selectors later tasks use: `tr[data-row=<key>]`;
  fields `name="season-<i>-colour|name|day|month"` (`i` the shown row's index); `[data-test=add-season]`;
  `[data-test=delete-season]` per row; `[data-test=runs-until]` per row; `[data-test=cancel-seasons]`;
  `[data-test=save-seasons]`; `[data-test=close-seasons]` (read-only).

- [ ] **Step 1: Write the failing tests** (`seasons-window.test.ts`, mounted with the four default
  seasons and a fake api):
  - **"lists every season from the one in force on 1 January, with colour, name, start and Runs
    until"**: rows Winter, Spring, Summer, Autumn; Winter's colour chooser `blue`, name `Winter`,
    day `1` month `12`, Runs until "28 Feb"; headings Colour, Season, Starts on (with `*`), Runs until.
  - **"edits a name, a colour and a start in place, and Runs until follows the draft"**: moving
    Summer to 15 Jun makes Spring's Runs until "14 Jun"; a month change clamps a day past its end
    (31 → 30 for April); February offers 28 days.
  - **"+ Season adds an empty row at the end, offered the first calendar colour no row uses"**:
    beside the defaults (green, amber, orange, blue) the new row is `red`; a second press offers
    `lime` (`CALENDAR_COLOURS` order, `packages/shared/src/calendar-colours.ts:1-15`).
  - **"the bin removes a row; the last row's bin is disabled"**.
  - **"a viewer sees the table as text with Close and nothing to change"** (Review Focus 3): no
    `wt-input`, `wt-combobox`, `wt-colour-chooser`, bin, add or Save; each row shows its colour name
    beside a swatch; `[data-test=close-seasons]` present.
  - **"fits the window at 1280 and scrolls only its table at 390, in English and Spanish"** (Review
    Focus 4): at 1280 the table region has no horizontal overflow; at 390 `document.documentElement.scrollWidth`
    ≤ 390, the region scrolls, Cancel and Save are inside the viewport, and an opened colour panel's
    box is inside the viewport.
  - **"Spanish"**: headings Color, Temporada, Empieza el, Hasta el; hint and bin name in Spanish.
  - a11y (`seasons-window.a11y.test.ts`), both themes: editable, read-only, with an added row, and
    at 390.
- [ ] **Step 2: Run, see them fail** (no element).
- [ ] **Step 3: Implement** the element's render and row editing: a native `<table>` inside a
  `div.table-wrap` (`tabindex="0" role="region"`, `aria-label` `season.seasons`, `overflow-x: auto`,
  as `option-list-form.ts:672-690`); fields with `hide-label`, labels `hours.colour`, `prep.name`,
  `season.day`, `season.month`; a bin as `periods-list.ts:221-227` with `season.delete_named` (or
  `season.delete_new` for a nameless new row); "+ Season" (`variant="secondary"`) and the hint under
  the table; footer `wt-form-actions` with Cancel (`slot="cancel"`, `requestClose("cancel")` on the
  modal) and Save (no saving yet: Task 7b). Read-only footer: Close in the `cancel` slot.
- [ ] **Step 4: Run** both files; `typecheck`, `lint`; root `scripts/native-form-fields.test.ts` and
  `scripts/style-token-names.test.ts`.
- [ ] **Step 5: Commit** — `git commit -s -m "The Seasons window: every season edited in its row (A721)"`

**Existing checks that change:** none.

## Task 7b: `seasons-window` — Save and its refusals

**Files:**
- Modify: `packages/venue-service/src/dashboard/seasons-window.ts`
- Create: `packages/venue-service/src/dashboard/season-refusal.ts` (the refusal wording moved from
  `season-dialog.ts:181-222`; the dialog keeps its own copy until Task 8b deletes it)
- Test: `seasons-window.test.ts`, `seasons-window.a11y.test.ts`

**Interfaces:**
- Produces: `seasonRefusalText(refusal: Refusal, seasons: readonly { id: string; name: string }[], specialDays: readonly { id: string; name: string }[]): string`.
  The window dispatches `seasons-saved` (`CustomEvent<{ seasons: Season[] }>`, bubbles, composed)
  after a successful Save, having committed its draft scope first. Each opening (connect, or a new
  `seasons` baseline taken while clean after a reconnect) gets a fresh generation object; a Save's
  answer acts only if the generation it was sent under is still current.

- [ ] **Step 1: Write the failing tests** (`seasons-window.test.ts`; each moved check names the
  `season-chips.test.ts` case it replaces — Task 8b deletes the originals):
  - **"Save is quiet and disabled until the draft changes, and an undone edit makes it quiet
    again"** (from `season-chips.test.ts:128-143`'s disabled and variant checks).
  - **"one Save sends every change with the clock revision the draft was clean at, then says it
    saved"** (from `:128`, `:145`, `:163`, `:478`, `:489`): rename Winter, recolour Spring, move
    Summer, add Feria, bin Autumn → exactly one `saveSeasons` call with
    `{ save: [Winter, Spring, Summer, Feria], delete: [autumn] }` and the revision given at mount
    even after a later `clockRevision` arrives with the draft dirty; on success one `seasons-saved`.
  - **"swapping two starts sends one request holding both"** (Review Focus 1).
  - **"asks for a name and a start before sending, beside each row, with one message at the bottom"**
    (from `:178`, `:430`): a new row left empty → after Save, its name says "Enter a name.", its
    start group "Choose a day and a month." once (day and month both `invalid`, the group described
    by the message), the bottom says "Correct the highlighted fields to continue.", focus on the first
    invalid field, nothing sent, Save disabled until fixed.
  - **"marks two rows that share a name or a start"**.
  - **"puts a refused field under its row, and keeps Save enabled"** (from `:226`, every row of its
    `it.each`, and `:346`; Review Focus 5): `season.invalid { field: "save.1.name", reason: "taken" }`
    marks the row whose key is `keys[1]` "Another season has this name."; `save.0.startsOn` with
    `reason: "taken"` → "Another season starts on this day."; **`save.0.startsOn` with no reason →
    "Choose a day and a month." under that row's start** (the `:226` row that refuses a start with no
    reason); `save.0.name` with no reason → "Enter a name."; `save.0.colour` → "Choose a colour.";
    Save stays enabled; editing that field clears its message.
  - **"says an end-offset clash, a changed or pending business-day start and the last season at the
    bottom"** (from `:249`, every row of its `it.each`, `:286`, `:301`): `end_offset` with a season
    and weekday → `season.offset_season`; with a special day the window knows → `season.offset_day`;
    **with a `specialDayId` the window does not know and a date → the date-only wording
    `season.offset_date`, no field marked, the draft kept, the window still open** (the `:249` row
    naming an unknown special day); `hours.clock_changed`, `hours.clock_change_pending`;
    `delete`/`last` → "A venue keeps at least one season."; anything else → "The change could not
    be saved.".
  - **"while saving, Save shows busy, nothing else acts, and Escape does not close"** (from `:376`,
    `:399`): a second Save press sends nothing.
  - **"a save's answer that arrives after the window was closed and reopened neither closes the new
    window nor commits its draft"** (moved from `:501`, "keeps a save busy when an earlier save…",
    whose intent — an answer from an earlier opening must not end a later one's state — this keeps):
    Save with a held answer; remove the element and add it again (a new opening), edit a name; resolve
    the held answer → no `seasons-saved`, the new opening's Save is not busy, its draft is still
    dirty (`saveActionState` not `unchanged`), and its edit is still shown. Control: the same answer
    resolved without the reopen does fire `seasons-saved`. A refusal from the earlier opening
    likewise shows nothing in the new one.
  - a11y (`seasons-window.a11y.test.ts`): a refused state, both themes.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement**: `draftScopeFor(this, { id, parent: this.draftParent, current, snapshot,
  equal: sameDraft, restore })` (none when read-only); `saveActionState`; `focusFirstInvalid` on the
  modal; `submitOnEnter` on Save; the refusal mapping (path `save.<i>.<field>` → `keys[i]`);
  `seasonRefusalText`; the opening generation (reset in `disconnectedCallback`, as
  `season-dialog.ts:119-125` does); on success, still current, `scope.commit(submitted)` then
  `seasons-saved`. The modal is not dismissible while saving.
- [ ] **Step 4: Run** both files; `typecheck`, `lint`.
- [ ] **Step 5: Commit** — `git commit -s -m "The Seasons window saves every change at once and explains a refusal (A721)"`

**Existing checks that change:** none in this task (the moved cases' originals go in Task 8b).

## Task 7c: `seasons-window` — the delete note, live data, leaving

**Files:**
- Modify: `packages/venue-service/src/dashboard/seasons-window.ts`
- Test: `seasons-window.test.ts`, new `seasons-window.unsaved.test.ts`, `seasons-window.a11y.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - **"binning a stored season says where its days go and what is lost"** (from
    `season-chips.test.ts:194`, `:211`, `:361`): binning Autumn reads its impact once and shows
    "Saving deletes Autumn; its days join Summer. The hours of Restaurant in it are lost."; with no
    departments "…No department has hours in it."; a failed read "…Which departments lose hours
    could not be read."; a newer read's answer wins over an older one.
  - **"Spanish"** (from `:445`): bin "Eliminar Otoño", note "Al guardar se elimina Otoño; sus días
    pasan a Verano."
  - **"a season another session deleted is marked under a row the person changed"** (from `:318`,
    `:529`; Review Focus 2): new `seasons` without Spring after Spring's name changed → "This season
    no longer exists." under Spring's name, Save disabled until its bin is pressed, and the Save then
    sends no delete for it; a refusal `season.not_found { seasonId }` marks that row the same way; a
    binned season deleted elsewhere loses its note and sends no delete.
  - **"a snapshot while clean follows it; while dirty keeps the person's changed fields"**
    (Decision 17, through the element; includes a season added elsewhere appearing as a row).
  - `seasons-window.unsaved.test.ts` (moved from `season-dialog.unsaved.test.ts:67`, `:86`, `:96`):
    inside a leave app with the draft parented to a root, **"asks before closing a changed draft,
    and Keep keeps the rows"**; **"restoring the opened values closes without asking"**; **"a close
    asked in the turn a Save starts is refused"**; **"a draft parented to the window root is asked
    about only for that root"**.
  - a11y: a deleting state (the note shown), both themes.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement**: impact reads per binned stored row (a request token per row, the newest
  wins); `willUpdate` runs `mergeSeasonDraft` when `seasons` changes, commits the moved baseline to
  the scope, and retakes `clockRevision` only while clean.
- [ ] **Step 4: Run** the three files; `typecheck`, `lint`.
- [ ] **Step 5: Commit** — `git commit -s -m "The Seasons window warns before deleting and follows other sessions' changes (A721)"`

**Existing checks that change:** none in this task.

## Task 8a: The screen opens the Seasons window; the Year offers "Seasons…"

The chips and the season dialog are left as they are in this task (the Year briefly offers both ✎
and "Seasons…"), so every file still typechecks; Task 8b removes them.

**Files:**
- Modify: `packages/venue-service/src/dashboard/opening-hours-screen.ts` (`:21`, `:434-474` the
  seasons branch draws `<seasons-window data-test="calendar-window" data-window="seasons">` with
  `.seasons=${this.model.seasons}`, `.clockRevision`, `.specialDays=${this.knownSpecialDays}`,
  `.readOnly`, `.draftParent=${this.windowDraftRoot}`, `.api`, `.beforeClose=${this.beforeWindowClose}`,
  `@wt-close=${this.windowClosed}`; `:258-275` read the special days when the window becomes
  `seasons`; a `seasons-saved` listener calls `this.api.rereadWithSpecialDays()` then
  `closeWindow()`)
- Modify: `opening-hours-year.ts:485-503` (add "Seasons…" before "Periods…" in the slot)
- Modify: `strings.ts` (`season.open_window` if Task 7a did not add it)
- Test: `opening-hours-screen.painter.test.ts`, `opening-hours-screen.a11y.test.ts`,
  `opening-hours-year.test.ts`, `apps/dashboard/src/dashboard-app.search-modules.test.ts`

**Interfaces:**
- Produces: `wt-button[data-test=open-seasons]` (text `season.open_window`) in the Year's slot, just
  before `open-periods`, dispatching `calendar-window-open` with `{ window: "seasons" }`.

- [ ] **Step 1: Write the failing tests.**
  - `opening-hours-year.test.ts:478` case becomes **"the season row offers Seasons… then Periods…,
    also for a viewer, each asking for its window"**: `open-seasons` is the slotted element just
    before `open-periods`; a `userEvent.click` on it dispatches one composed `calendar-window-open`
    with `{ window: "seasons" }`; Spanish "Temporadas…".
  - `opening-hours-screen.painter.test.ts:828-850` **"opens Seasons after loading and Cancel closes
    only its window pair"**: `[data-test=calendar-window][data-window=seasons]` is a `seasons-window`
    whose rows are the model's seasons; its modal's heading "Seasons"; `cancel-seasons` returns to
    `/manage/opening-hours/view/year/year/2027` with the Year drawn.
  - `:852-877` **"a viewer's Seasons window lists the seasons with nothing to change"**: read-only
    rows, `close-seasons` closes it (the window offers no week: Decision 18).
  - New **"Seasons… on the Year pushes window/seasons, and Back closes it"**: `pushedPaths()` records
    `/manage/opening-hours/view/year/window/seasons`; `history.back()` → `/manage/opening-hours/view/year`,
    no window.
  - `:1081-1096` **"draws Periods and Seasons as wide windows"**: the Seasons window's modal has no
    `size` (Decision 14).
  - `:1097-1142` and `:1145-1194`: the draft is made by changing the first row's name in the window
    (`[name=season-0-name]`); every Keep/Discard/painter assertion stays word for word.
  - New **"a Save re-reads the hours and closes the window, keeping the painter's paint"**: painter
    with paint → window → rename → Save → one `PUT …/seasons`, then the re-read requests, the address
    back to the painter's, `painter.edited()` unchanged.
  - New **"opening the Seasons window reads the special days once and hands them to it"** (takes
    over from `season-chips.test.ts:458` and the dialog trigger of
    `opening-hours-screen.test.ts:981-1003`, both changed in Task 8b).
  - `opening-hours-screen.a11y.test.ts`: `window/seasons`, editable and read-only, both themes.
  - `dashboard-app.search-modules.test.ts:235-251`, `:291-305`: wait for the window's rows to show
    "Spring" (`calendar(el).shadowRoot` → `seasons-window` → its shadow root); the dialog box is the
    inner `wt-modal`'s; every fit and axe assertion stays. `:343`: the close press is the window's
    `cancel-seasons` (setup).
- [ ] **Step 2: Run, see them fail**:
  `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/opening-hours-screen.painter.test.ts src/dashboard/opening-hours-screen.a11y.test.ts src/dashboard/opening-hours-year.test.ts`
  and `pnpm --filter @waitron/dashboard exec vitest run --project browser src/dashboard-app.search-modules.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** those files plus `opening-hours-screen.test.ts`, `opening-hours-screen.unsaved.test.ts`,
  `opening-hours-screen.special-day.test.ts`, `opening-hours-screen.week.test.ts`, `index.test.ts`,
  `season-chips.test.ts` (unchanged); venue-service and dashboard `typecheck`, `lint`.
- [ ] **Step 5: Commit** — `git commit -s -m "window/seasons opens the Seasons window, and the Year offers Seasons… (A721)"`

**Existing checks that change:** `opening-hours-year.test.ts:478`; `opening-hours-screen.painter.test.ts:828-850`,
`:852-877`, `:1081-1096` (compact → wide, Decision 14), `:1097-1142` and `:1145-1194` (how the draft
is made; assertions kept); `dashboard-app.search-modules.test.ts:243`, `:295-297`, `:343`
(selectors) — spec point 1.

## Task 8b: The chips lose ✎ and "+ Season"; the season dialog goes

**Files:**
- Modify: `packages/venue-service/src/dashboard/season-chips.ts` (keep `seasons`, `readOnly`,
  `keyOnly`, the week button and the slot; delete `clockRevision`, `api`, `specialDays`,
  `draftParent`, the dialog, its state and `SeasonWrites`)
- Delete: `season-dialog.ts`, `season-dialog.unsaved.test.ts`
- Modify: `opening-hours-year.ts:13-15`, `:203-208`, `:485-490` (drop `api`, `specialDays` and their
  bindings); `opening-hours-month.ts:650` (drop `.clockRevision`); `opening-hours-screen.ts:1515-1532`
  (the Year loses `.api`, `.specialDays`, `@season-dialog-open`, `@season-changed`)
- Modify: `opening-hours-client.ts:15-19`, `:262-270` (delete `SeasonInput` and the three old
  methods; `SeasonDeleteImpact` and `readSeasonDeleteImpact` stay)
- Modify: `strings.ts` (remove the unread season strings, Decision 21)
- Test: `season-chips.test.ts`, `season-chips.a11y.test.ts`, `opening-hours-year.test.ts`,
  `opening-hours-screen.painter.test.ts`, `opening-hours-screen.test.ts`,
  `opening-hours-client.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `season-chips.test.ts:90-104`: labels without " ✎"; no `[data-test=season-edit]`;
    `:611-629` becomes **"slotted content follows the last chip"** (no "+ Season");
    `:335-344` becomes **"read-only chips offer their weeks and nothing else"**; `:557`, `:586`
    (`season-dialog` null) become `wt-modal` null — the chips draw no window at all.
  - `season-chips.a11y.test.ts:104-112`: the states become `chips`, `read-only`, `empty`
    (`editing`, `refused`, `end-offset`, `delete` are covered by `seasons-window.a11y.test.ts`,
    Tasks 7a–7c).
  - `opening-hours-year.test.ts:407-430` becomes **"hands the seasons and read-only to the chips"**:
    `chips.seasons` is the model's, `chips.readOnly` follows; no `season-changed` is re-dispatched
    (spec: the chips write nothing).
  - `opening-hours-screen.painter.test.ts:358-370` ("a season chip's ✎ still opens the season dialog
    and not the painter") is deleted — the spec removes ✎ — and Task 8a's "Seasons… on the Year
    pushes window/seasons" is its replacement; `:261`, `:763` (`season-dialog` null) become
    `[data-window=seasons]` null.
  - `opening-hours-screen.test.ts:981-1003` becomes **"hands the Year its model and read-only"** (the
    special-day read is Task 8a's window case); `:1351-1370`: the trigger becomes opening, closing
    and reopening the Seasons window; the newest-list assertions stay. `:1440-1450` becomes
    **"re-reads the year and the opening hours after the window saves"** (a `seasons-saved` from the
    window).
  - `opening-hours-client.test.ts:142-158` becomes **"reads a season delete's impact"** (the three
    write calls go with their methods; the impact GET assertion stays).
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement**; delete the dialog-driven cases of `season-chips.test.ts` (`:128`, `:145`,
  `:163`, `:178`, `:188`, `:194`, `:211`, `:226`, `:249`, `:286`, `:301`, `:318`, `:346`, `:361`,
  `:376`, `:399`, `:430`, `:445`, `:458`, `:478`, `:489`, `:501`, `:529`) and its `fakeApi`, each
  replaced by the Task 7a–7c or 8a case that names it (`:188` → 7a's "the last row's bin is
  disabled"; `:458` → 8a's special-day read on opening the window).
- [ ] **Step 4: Run** the six test files plus `season-chips.a11y.test.ts`, `opening-hours-year.a11y.test.ts`,
  `opening-hours-month.test.ts`, `seasons-window.test.ts`; venue-service, staffing and dashboard
  `typecheck`, `lint`. `git grep -n "season-dialog\|season-changed\|season-dialog-open\|SeasonWrites\|SeasonInput\|addSeason\|deleteSeason"`
  in `packages` and `apps` finds nothing.
- [ ] **Step 5: Commit** — `git commit -s -m "Season chips become a key; the season dialog goes (A721)"`

**Existing checks that change:** `season-chips.test.ts:90-104` (no ✎), `:335-344`, `:557`, `:586`,
`:611-629`, and the dialog cases listed in Step 3 (moved to Tasks 7a–7c and 8a);
`season-chips.a11y.test.ts:105` (states move); `season-dialog.unsaved.test.ts` (whole file, moved to
`seasons-window.unsaved.test.ts`); `opening-hours-year.test.ts:407-430`;
`opening-hours-screen.painter.test.ts:261`, `:358-370` (deleted; replaced in 8a), `:763`;
`opening-hours-screen.test.ts:981-1003`, `:1351-1370`, `:1440-1450`;
`opening-hours-client.test.ts:142-158` — spec point 1 ("The separate season editor and the chips' ✎
go").

## Task 9: Docs and backlog

**Files:** `docs/developers/design-system.md`, `docs/developers/conventions-data.md`,
`docs/backlog.md`, `docs/backlog/service-periods.md`.

- [ ] Before editing, `git grep -n "season-dialog\|season dialog\|✎\|+ Season\|seasonTints\|wt-color-season\|addSeason\|saveSeason\b\|deleteSeason\|window/seasons"`
  across `docs/developers`, `docs/backlog*`, `packages/*/README.md`, `apps/*/README.md`, and fix
  every hit that describes current behaviour (CLAUDE.md §1, "A behaviour change retires every
  receipt"). Historical plans and specs are left alone.
- [ ] `design-system.md`: `:127` and `:196-198` (the Year fills with its season's stored colour,
  painted with the station tints); replace `:239-256` (the season token table and its cases) with
  the stored-colour paragraph and the `season-tint.test.ts` contrast case; `:3208-3213` (the
  `window/seasons` pair opens the Seasons window; drop "A721 replaces…"); `:4104-4106` ("Seasons…"
  opens the window; chips open weeks); rewrite the "Seasons" bullet `:4220-4233` (chips are a key
  opening weeks; the row ends "Seasons…", "Periods…"; the window as Decisions 12–17 describe it,
  for a viewer too); add **"### Seasons window"** after "### Periods window" (`:4733-4803`): address,
  what opens it, its own `wt-modal`, the table and its fields, Runs until, "+ Season", the bin and
  its note, the footer, Save and its refusals, the live-data rule, the viewer's view, its cases.
- [ ] `conventions-data.md`: after the A506-6 paragraph (`:636-648`) add **"2026-10-17, A721."**:
  `saveSeasons` behind `PUT …/seasons` replaced the three writes (Decisions 5–9), and
  `seasons.colour` has no CHECK and why (Decision 1).
- [ ] `docs/backlog.md:1400-1402`: delete the A721 entry. `:1570-1573`: delete "Season colours
  differ…". `:1577-1579`: delete "A season dialog whose season another session deletes stays open…"
  (the dialog is gone; Decision 17 handles the case). `:4121-4124` ("Opening hours' create texts
  say 'New …' and '+ …'"): `season.new` is gone with the dialog — reword to name only
  `special.new` and `season.add` (the window keeps "+ Season", Decision 21). `:4352-4354` (A702,
  season chips widening the page on a long name): the chips lost ✎, so recheck at 390 px in Task 10
  and either delete the entry with what was measured or keep it with the new measurement.
  `docs/backlog/service-periods.md:184-201`:
  delete the A721 section; `:368-370`: delete the "No 'Seasons…' button until A721" note; `:95`:
  point at `saveSeasons` in place of `deleteSeason`. Add to its "## Decisions and deliberate limits"
  Decisions 1, 3, 12, 13, 14, 15 and 17, each one line with "(A721 plan, Decision N; plan default)".
- [ ] File each point left open as its own short backlog entry in the Service periods area: the
  owner's sign-off on the plan defaults sent as an FYI (Decisions 2, 12, 13, 14, 15); "existing
  seasons on a running box read grey until recoloured" if the owner's box needs a note.
- [ ] Commit — `git commit -s -m "docs: the Seasons window and stored season colours (A721)"` (docs
  are prettier-ignored; check a root file with `pnpm exec prettier --file-info` only if one changed).

## Task 10: LOOK

- [ ] `lsof` the venue folder and port 8080; start the stack with
  `wa-wt demo waitron-feat-a721-seasons-window` (never a bare `pnpm dev*`); `wa-wt reset demo
  waitron-feat-a721-seasons-window` only if the slot's venue predates the migration's defaults and
  you need the default colours (existing rows read grey: Decision 2 — say which you saw).
- [ ] With the workspace's Playwright Chromium, at 390 and 1280 px, light and dark (record
  `window.innerWidth` and the computed page and dialog backgrounds; reject a capture whose two
  themes match), English and Spanish, capture: the Year's season row with "Seasons…" then
  "Periods…"; the Seasons window (rows, a colour panel open, Runs until); a binned season's note; a
  refused Save (a duplicate name); February's Month in station view beside the Year, showing Winter
  the same colour on both; a viewer's window.
- [ ] Save under an ignored `__screenshots__/look/` folder or outside the repo; list what was looked
  at, and anything wrong, in the PR under "LOOK". Update the ledger; tell the owner the branch is
  ready for `/finish-branch`.

---

## PR description must carry

- First line in plain words: each season now stores its own colour, and seasons are edited in one
  Seasons window opened from the Calendar's Year.
- **Migration:** `0058_*` adds `seasons.colour` (text, default `grey`, no CHECK and why); existing
  seasons read grey until recoloured; new venues get the four default colours. No data migration.
- The retired routes (`POST /seasons`, `PUT /seasons/:id`, `DELETE /seasons/:id`) and the new one.
- **"Changed test checks":** the union of every task's "Existing checks that change", each with its
  reason.
- The plan defaults sent to the owner as an FYI (Decisions 2, 12, 13, 14, 15, 17).
- **"LOOK":** what Task 10 captured.
