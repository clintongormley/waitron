# A783 — sixteen calendar colours, in a four-by-four chooser

**Owner decision (2026-10-17, lane B queue `~/waitron-campaign-b/queue.md:518-524`):** sixteen
colours — today's thirteen plus yellow, sky and magenta — "The user can choose the colours that
work for them. Also 16 breaks over 4 rows." One palette for service periods, staff roles, seasons
AND prep stations. The chooser shows them four to a row. The values and pictures:
`docs/backlog/mockups/a783-sixteen-colours/` (committed eb3e791e9; values in `shoot.mjs`).

Branch `feat/a783-sixteen-colours`, worktree
`~/workspace/worktrees/waitron-feat-a783-sixteen-colours`. Review path: FULL (two migrations, and
a shared `wt-*` primitive changes). Template: the A753 plan,
`docs/superpowers/plans/2026-10-17-a753-calendar-palette.md` (landed as #1833, squash 3e1f0a0d5).

## Decisions

- **D1 — order, in rows of four:** red, orange, amber, yellow / lime, green, teal, cyan / sky,
  blue, indigo, purple / magenta, pink, brown, grey (owner). Today's list is
  `packages/shared/src/calendar-colours.ts:1-15` (thirteen, no yellow, sky or magenta);
  `STATION_COLOURS = CALENDAR_COLOURS` (`packages/shared/src/station-colours.ts:3`). Consequence,
  to state in the PR: every "first unused colour" walk still gives red, orange, amber on an empty
  venue, but the FOURTH is now yellow (was lime). The walks: a new period on the server
  (`packages/venue-service/src/menu-timetable.ts:575-578`) and in the dialog
  (`firstUnusedCalendarColour`, `packages/venue-service/src/dashboard/calendar-colours.ts:43-47`,
  used at `period-dialog.ts:50,319`), a new staff role (`packages/staffing/src/dashboard/staff-role-dialog.ts:45`),
  a new season row (`packages/venue-service/src/dashboard/season-draft.ts:85`), and a new station
  (`firstUnusedStationColour`, `packages/shared/src/station-colours.ts:6-9`, used at
  `packages/db/src/station-colour.ts:14`, `prep-stations-screen.ts:791` and
  `apps/server/src/configuration-transfer.ts:639`).
- **D2 — the values are the mock-up's**, `shoot.mjs:27` (yellow), `:32` (sky), `:36` (magenta),
  checked against the brief on 2026-10-18:

  | Colour  | Theme | `--wt-color-palette-` / `on-palette-` | `--wt-color-station-` / `-dot` |
  | ------- | ----- | ------------------------------------- | ------------------------------ |
  | yellow  | light | `#fbdf1d` / `#231c00`                 | `#f7f2a8` / `#827800`          |
  | yellow  | dark  | `#f6e04a` / `#221c00`                 | `#3e3c0c` / `#dcd43c`          |
  | sky     | light | `#0a8fd6` / `#04121f`                 | `#cce6fe` / `#1f77cf`          |
  | sky     | dark  | `#3cb4f2` / `#041422`                 | `#0a2c43` / `#3a9fe8`          |
  | magenta | light | `#c0139f` / `#ffffff`                 | `#fcd7fa` / `#b8259f`          |
  | magenta | dark  | `#ec6ae6` / `#2a0628`                 | `#4d1d4b` / `#dc5ad6`          |

  The thirteen existing values do not change. Run 2026-10-18 from a temporary copy of `shoot.mjs`
  (outputs redirected outside the repo): it printed "Every check colors.test.ts makes passes for
  the sixteen, in both themes." Closest light station fills stay indigo/purple (4.73, the existing
  pair; the test's floor is 4); closest dark pair amber/yellow 6.22.
- **D3 — names:** EN Yellow, Sky, Magenta; ES Amarillo, Celeste, Magenta (`shoot.mjs:27,32,36`).
  The live colour-name maps (grep `Turquesa` over `packages/*/src apps/*/src`, 2026-10-18):
  `hours.colour.*` in `packages/venue-service/src/dashboard/strings.ts:614-626` (EN) and
  `:1516-1528` (ES) — read by the period dialog (`period-dialog.ts:238`), the station choices
  (`station-colour-choices.ts:18`) and the Seasons window (`seasons-window.ts:468,586`); and
  staffing's `COLOUR_NAMES`, `packages/staffing/src/dashboard/strings.ts:521-535`.
- **D4 — the dead `prep.colour.<colour>` strings are deleted, not extended.** The twelve keys at
  `strings.ts:249-260` (EN) and `:1141-1152` (ES) have no reader: grep `prep\.colour\.[a-z]` over
  `packages apps scripts` finds only their definitions, and A725 (#1837, 6a4331b4d) deleted their
  last reader (`station-colour-picker.ts`, `` t(`prep.colour.${colour}`) ``). Keep `prep.colour`,
  `prep.colour_used_by` and `prep.colour_invalid`, which are read
  (`station-editor.ts:182,307,559`, `prep-stations-screen.ts:868,1026,1030`).
- **D5 — the column defaults stay**: `grey` for periods, staff roles and seasons
  (`packages/venue-service/src/schema/menus.ts:26`, `packages/staffing/src/schema/staffing.ts:29`,
  `packages/venue-service/src/schema/seasons.ts:31`), `red` for stations
  (`packages/db/src/schema/kitchen-stations.ts:28`). No stored value changes: every stored colour
  is one of the thirteen, all still valid.
- **D6 — the two CHECKs widen and the two rebuilds need a VENUE RESET (A753's D4, verbatim).**
  `menu_periods_colour_ck` (`menus.ts:52`) and `staff_roles_colour_ck` (`staffing.ts:40`) are
  built from `CALENDAR_COLOURS` through `enumType`/`enumCheck` (`menus.ts:17`, `staffing.ts:20`).
  Changing them makes drizzle-kit 0.31.11 rebuild both tables. A rebuild runs with foreign keys ON
  (CLAUDE.md §3; `docs/developers/conventions-data.md:1467`), and both tables have cascading and
  `no action`/`restrict` children (`packages/staffing/drizzle/0000_baseline.sql:6`,
  `0001_staffing_days_blocks_assignments.sql:9,21`; `packages/venue-service/drizzle/0028_menu_timetables.sql:35,47`,
  `0032_orange_blob.sql:7`, `0033_aromatic_slapstick.sql:32`,
  `0035_station_destinations_and_period_extensions.sql:9`, `0046_routing_cell_periods.sql:9`,
  `0050_perfect_sue_storm.sql:9`). So on a venue holding those rows the step is refused or loses
  rows; before go-live that is a reset, not data-migration code (CLAUDE.md §3, last rule). New since
  A753: `menu_periods` now carries `floor_plan_set_id REFERENCES floor_plan_sets(id)` (A504,
  `menus.ts:36`, added by `venue-service/drizzle/0059_floor_plan_sets.sql:13`), so the rebuilt
  table must carry that key too; A504's own comment (`menus.ts:29-35`) records that it avoided a
  rebuild for exactly this reason, which this item cannot. Generated SQL is never hand-edited.
  **The PR's first line says a venue reset is needed.** `scripts/migration-upgrade.test.ts` gets a
  `RESETS` entry (`:361`, keyed `<set>/<tag>`) for each new step, stating exactly what the walk
  printed. A753's entries are at `:531-540`.
- **D7 — `kitchen_stations.colour` and `seasons.colour` carry no CHECK, and every write path reads
  the shared constant.** Columns: `label("colour").$type<…>()` at `kitchen-stations.ts:28` (its
  comment at `:27` says why: a CHECK would rebuild the table) and `seasons.ts:31`. Validation: the
  station routes (`parseStationColour`, `apps/server/src/management-api.ts:377-381`, through
  `isStationColour`), the core configuration import (`packages/db/src/configuration-transfer.ts:11-13`),
  the import's colour allocation (`apps/server/src/configuration-transfer.ts:630-639`), the season
  save (`packages/venue-service/src/seasons.ts:104`), and venue-service's import of periods and
  seasons (`packages/venue-service/src/configuration-transfer.ts:152,293`), plus the period route
  (`routes.ts:246`), the period write (`menu-timetable.ts:538`) and the staff role write
  (`packages/staffing/src/staff-roles.ts:33`). That is a reading; Task 3 runs one accepted
  new-colour case per path to make it a measurement. The station paint is NOT automatic:
  `stationTints` (`packages/venue-service/src/dashboard/station-colour-styles.ts:6-19`) is a
  `Partial` map, and a colour missing from it silently falls back to a 15% mix of the palette fill
  (`:21-28`), which is how grey is drawn. Its test
  (`station-colour-styles.test.ts:5-18`) expects `var(--wt-color-station-<colour>)` for every colour
  but grey, so it goes red until the three entries exist.
- **D8 — the chooser's column count is chosen in code each time the panel is placed: four, or two
  in a window `40rem` wide or less.** Evidence for the HOW:
  - No primitive in `packages/ui/src/components` switches layout with a width media or container
    query: grep `@media|@container|matchMedia` there finds only `prefers-reduced-motion` and
    `hover` (2026-10-18).
  - The `no-hardcoded-chrome` guard refuses any `rem`/`em` and any `px` over 1 in a primitive's
    `styles` (`packages/ui/src/no-hardcoded-chrome.test.ts:50-56`), so a CSS
    `@media (max-width: 40rem)` inside the component fails it; design-system.md:728 and :1776-1778
    say the same and point the app at its own `::part` rule or a `clamp()` instead.
  - The precedent for a primitive switching at a width is JS: `wt-data-table` holds px constants
    (`wt-data-table.ts:74,91`) and sets `narrow`/`sideFilters` from measured widths (`:1041,1063`).
    The guard reads only `styles` (`no-hardcoded-chrome.test.ts:27-30`), so a JS constant passes it.
  - The chooser already places and sizes its panel in JS from the window, on open, on every
    re-render while open and on resize (`positionPopup`, `wt-colour-chooser.ts:203-215`, called at
    `:171,189,217`).
  - The house's phone width is `40rem`: `apps/dashboard/src/dashboard-app.ts:812`,
    `apps/setup/src/setup-app.ts:453`, `packages/venue-service/src/dashboard/routing-grid.ts:119,143`,
    and design-system.md:728 (the language chooser's phone switch).

  So `positionPopup` sets the radio group's column count from
  `matchMedia("(max-width: 40rem)").matches` BEFORE it measures, as it already sets the width
  before measuring (`:206`). `matchMedia` with the same query evaluates exactly as the dashboard's
  CSS rule does. Rejected: choosing four columns whenever the four-column panel fits. The panel is
  `max-content` wide (`:207`), which includes each tile's `usedBy` names unwrapped, so a tile with
  long names would (by that reading, not measured) push a desktop panel to two columns; the a11y
  suite deliberately mounts tiles with twenty long names each (`wt-colour-chooser.a11y.test.ts:77-89`).
- **D9 — the panel's width logic needs nothing.** Measured 2026-10-18 by the temporary copy of
  `shoot.mjs` (real `wt-modal` + `wt-colour-chooser`, four columns forced before `show()`): at 1280
  wide the four-column panel is 484 px (EN) and 518 px (ES) against a 398 px field, inside the
  1264 px cap, every name on one line; at 390 wide four columns are clamped to 374 px and 8 English
  and 10 Spanish names break onto two lines; two columns at 390 give a 356 px panel (the field's
  width) with every name on one line. Computed, not measured: just above the breakpoint (641 px) a
  clamped panel's columns are about (641 − 16 − 16 − 24 − 2) / 4 ≈ 145 px, wider than the 119 px
  the widest Spanish tile took at 1280 — Task 2 measures it.
- **D10 — arrow keys stay linear.** `onPanelKeydown` (`wt-colour-chooser.ts:232-262`) moves to the
  next tile on Right or Down and the previous on Left or Up, wrapping; it never assumes two columns.
  That is the radio group pattern (one tab stop, `role="radiogroup"` at `:365-369`); a row-aware
  Up/Down would be a grid pattern with a different role. The existing case
  (`wt-colour-chooser.test.ts:373-399`) pins it; Task 2 adds a case across a row of four.
- **D11 — the "invalid colour" example becomes `"beige"`.** A753 used `"magenta"`, which this item
  makes valid. `beige` is in neither list (`calendar-colours.ts:1-15`; `STATION_COLOURS` is the same
  array). `"yellow"` and `"sky"` appear in no `.ts`/`.mjs` under `packages apps scripts`
  (grep, 2026-10-18). Other invalid examples already in use stay: `"mauve"` and `"invalid-colour"`.
- **D12 — no A783 entry exists in `docs/backlog.md`.** The item lives in lane B's queue
  (`~/waitron-campaign-b/queue.md:518`); under `docs/` A783 is named only in the A725/A783 decision
  note (`docs/backlog/kitchen.md:391-393`), the A725 plan (`2026-10-17-a725-prep-stations.md:186-187`)
  and the mock-ups. Decision notes are never deleted (CLAUDE.md §6): Task 6 adds dated lines.
- **D13 — A760 changes nothing in this plan.** A760 (the squash of every migration set) is approved
  but not started (`docs/backlog.md:5714-5720`); its plan starts only after migration branches
  finish or are withdrawn (`docs/superpowers/plans/2026-10-16-a760-migration-squash.md:13-14,49,108`).
  This branch is one of those: land it (or withdraw it) before the squash begins; if the squash
  lands first, regenerate both migrations on top of it.

## Global constraints

- TDD: each task writes its failing test first and watches it fail for the stated reason.
- Never edit a shipped migration file. Never hand-edit a generated migration, snapshot or
  `_journal.json`; on a number clash, reset the folder to `main` and regenerate (CLAUDE.md §3).
- Comments: none that restate code; cut stale ones you touch (CLAUDE.md §1, last rule). Prefer
  deleting a count ("twelve", "thirteen") to replacing it with another count.
- Every commit `git commit -s`. Never `git stash`. Run `pnpm format:check` (or
  `pnpm exec prettier --check <files>`) before each commit.
- Changed test checks (owner, 2026-10-05): a check may change only where this item changes what it
  checks. The task report lists every changed check with file:line, old → new.
- Golden huella (`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`)
  and `inmutabilidad` must pass UNEDITED (Task 4 runs both).
- Implementers are dispatched as `subagent_type: "implementer"` (medium effort). Each task is cut to
  finish well under 100 tool calls; past about 150 calls, stop at a passing (or cleanly red) point,
  commit, and hand over.
- Browser runs: check `memory_pressure | grep free` first; run beside another session's browser run
  only when free memory is well above 15%. Stop only processes you started, by pid.
- Read each run's `Tests` count; a blank result or an exit status alone is no evidence.

## Task 1 — the three new colour tokens (`packages/ui-core`)

Files: `packages/ui-core/src/tokens/colors.css`, `packages/ui-core/src/tokens/colors.test.ts`.

1. Test first: `PALETTE` (`colors.test.ts:421-435`) becomes the sixteen in D1 order, and
   `STATION_FILLS` (`:511-524`) gains yellow, sky and magenta in D1 order (fifteen; grey has no
   station token — D7). Run `pnpm --filter @waitron/ui-core exec vitest run src/tokens/colors.test.ts`
   and see it fail on the missing tokens.
2. In each of the four theme blocks (`colors.css`: light `:1-110`, dark media query `:112-216`,
   explicit light `:218-320`, explicit dark `:322-424`), add `--wt-color-palette-<key>` and
   `--wt-color-on-palette-<key>` beside the other palette tokens (after the brown pair: `:68`,
   `:174`, `:279`, `:383`), and `--wt-color-station-<key>` and `-dot` after the brown station pair
   (`:97`, `:202`, `:307`, `:411`), with D2's values: light values in the two light blocks, dark in
   the two dark ones.
3. Stale counts: the comment at `colors.css:73` ("twelve fills a station picks from") and the test's
   comment and title at `colors.test.ts:510` and `:563` ("twelve") lose the count. The comment at
   `colors.css:41-42` says periods and staff roles pick the palette; seasons pick it too
   (`seasons-window.ts:468`) — cut the "periods and staff roles pick from" clause rather than
   listing users.
4. Run the whole file, and `pnpm exec vitest run scripts/style-token-names.test.ts` from the root.
   Commit.

## Task 2 — the chooser shows four columns, two at phone width (`packages/ui`)

After Task 1 (its fixtures paint with the new tokens). Files:
`packages/ui/src/components/wt-colour-chooser.ts`, `wt-colour-chooser.test.ts`,
`wt-colour-chooser.a11y.test.ts`.

1. Tests first, in `wt-colour-chooser.test.ts`. Add a `SIXTEEN` fixture: the sixteen in D1 order,
   `fill: var(--wt-color-palette-<key>)`, with English and Spanish labels from D3, and `usedBy` on
   two of them (as `shoot.mjs:286-287` does). Every case sets its viewport with `page.viewport` and
   restores the old one in `finally`, as `:571-587` does. Before writing them, record the suite's
   default `window.innerWidth` once (a throwaway `console.log` under `AI_AGENT= CLAUDECODE=`), so
   the report says whether the existing cases ran at two or four columns.
   - At 1280×800, open: the radio group's computed `gridTemplateColumns` has four tracks; tiles
     1-4 share a top and tile 5 starts a new row. Fails today (two tracks, `:89`).
   - At 390×844: two tracks.
   - The boundary: 640 wide gives two, 641 gives four. This and the 1280 case are what kill the
     nightly mutants of the query and its comparison (`ui` mutation bites nightly,
     `docs/developers/ci-and-gates.md:325`).
   - Resizing an open panel from 1280 to 390 gives two tracks and keeps the panel inside the window
     (the placement half is already held by `:640-660`; add the column assertion there or beside it).
   - At 641 wide and at 1280, in Spanish and English: every `.colour-name` takes one line (count the
     distinct tops of a `Range`'s client rects, as `shoot.mjs:measurePanel` does), and the panel is
     at least the trigger's width and at most the window's less 16 px.
   - Keys across a row of four, at 1280: from yellow (4th) ArrowRight chooses lime (5th); from red
     ArrowDown chooses orange, not lime; from lime ArrowUp chooses yellow. This passes before and
     after the change: it pins D10.
   - Tokens (beside `:869-921`): `--wt-space-2` set on the host sets the radio group's `columnGap`
     and `rowGap` at four columns.
   In `wt-colour-chooser.a11y.test.ts`, per theme: "open, sixteen colours in four columns" at 1280
   and "open, sixteen colours in two columns" at 390, each with `usedBy` marks.
   Watch the new layout cases fail for the stated reason.
2. Implement D8: the radio group's default is four columns (`:87-91`); in `positionPopup`, before
   `popup.style.width = "max-content"` (`:207`), set an attribute on the radio group (for example
   `data-columns="2"` when `matchMedia("(max-width: 40rem)").matches`, removed otherwise) that a
   rule switches to `repeat(2, minmax(0, 1fr))`. Hold the query in one module constant; its
   comment, if any, names why the query is in code rather than CSS (the guard) in one line.
   Nothing else in `positionPopup` changes (D9).
3. Run both files plus `src/no-hardcoded-chrome.test.ts`:
   `pnpm --filter @waitron/ui exec vitest run src/components/wt-colour-chooser.test.ts src/components/wt-colour-chooser.a11y.test.ts src/no-hardcoded-chrome.test.ts`.
   Read the counts. Commit.

## Task 3 — the palette, its names and the two migrations (one commit)

Files: `packages/shared/src/calendar-colours.ts`, `packages/shared/src/station-colours.test.ts`,
`packages/venue-service/src/dashboard/period-colour-styles.ts`,
`packages/venue-service/src/dashboard/station-colour-styles.ts`,
`packages/venue-service/src/dashboard/strings.ts`, `packages/staffing/src/dashboard/strings.ts`,
the two migration folders, and the server-side tests named below.

1. Tests first:
   - `packages/shared/src/station-colours.test.ts`: the order list (`:14-30`) becomes the sixteen in
     D1 order; "allocates grey after the other shared colours are occupied" (`:40-56`) lists the
     fifteen others. Both fail today.
   - Staffing names: the `it.each` table in `packages/staffing/src/dashboard/strings.test.ts:73-87`
     gains `["yellow", "Yellow", "Amarillo"]`, `["sky", "Sky", "Celeste"]`,
     `["magenta", "Magenta", "Magenta"]` in D1 order.
   - The CHECK loops already iterate the constant (`packages/staffing/src/schema/constraints.test.ts:93`,
     `packages/venue-service/src/menu-timetable.test.ts:628`); after step 2 they fail on
     `staff_roles_colour_ck` / `menu_periods_colour_ck` until step 3 generates the migrations.
   - The period colour walk (`menu-timetable.test.ts:634-672`, title "repeating red after all
     thirteen"): seventeen periods, expecting the sixteen in D1 order then `red`; the title loses
     its count.
   - One accepted new-colour case per write path that has an accepted-colour case today (D7's
     measurement): staff role (`packages/staffing/src/staff-roles.test.ts:162-170`, beside teal),
     period route (`packages/venue-service/src/menu-timetable-routes.test.ts:618`, beside
     indigo/teal), period and season import (`packages/venue-service/src/configuration-transfer.test.ts:1016-1019`,
     and a season beside the refusal at `:1381-1384`), season save
     (`packages/venue-service/src/seasons.test.ts:625-629`, beside teal), and the station route
     (`apps/server/src/management-api.test.ts:1183` "PATCH changes only the colour", beside indigo).
     Use a different new colour in each (yellow, sky, magenta). The core import already iterates
     `STATION_COLOURS` (`packages/db/src/configuration-transfer.test.ts:92`).
   - **"magenta" as the invalid example → `"beige"` (D11):**
     `packages/staffing/src/staff-roles.test.ts:151`, `packages/staffing/src/routes.test.ts:237`,
     `packages/staffing/src/schema/constraints.test.ts:94`,
     `packages/venue-service/src/menu-timetable.test.ts:488` and `:629`,
     `packages/venue-service/src/menu-timetable-routes.test.ts:641`,
     `packages/venue-service/src/configuration-transfer.test.ts:1025`. (The dashboard ones are in
     Task 5a/5b.) Re-run `grep -rn '"magenta"' packages apps scripts --include='*.ts'` after.
   - `apps/server/src/kitchen.test.ts:213-236` ("A725 reuses red when every station colour is
     occupied") lists thirteen; make it every station colour (the sixteen, or `STATION_COLOURS`).
   Watch each fail for the stated reason. The dashboard browser tests that pin thirteen go red
   after this task; Tasks 5a and 5b fix them straight after (this commit is expected red there, and
   only there).
2. `CALENDAR_COLOURS` becomes the sixteen in D1 order. Add the three to `PERIOD_COLOUR_TOKENS`
   (`period-colour-styles.ts:5-19`, a full `Record`, so the type checker demands them) and to
   `stationTints` (`station-colour-styles.ts:6-19`, `Partial` — D7), in D1 order. Add
   `hours.colour.yellow|sky|magenta` to EN (`strings.ts:614-626`) and ES (`:1516-1528`), and the
   three to staffing's `COLOUR_NAMES` (`staffing/src/dashboard/strings.ts:521-535`), all in D1
   order. Delete the dead `prep.colour.<colour>` keys (D4) in EN and ES. Run
   `pnpm --filter @waitron/shared typecheck`, `@waitron/venue-service`, `@waitron/staffing`,
   `@waitron/db` and `@waitron/server` (apps/server's package name: check its `package.json`), and
   note in the report whether venue-service's typecheck named the missing `hours.colour.*` keys
   before you added them (`t` is `makeT<keyof typeof en>()`, `strings.ts:1803`; ES is
   `Record<keyof typeof en, string>`, `:890`).
3. Generate: `pnpm --filter @waitron/venue-service db:generate` and
   `pnpm --filter @waitron/staffing db:generate`. Expected: venue-service `0060_<tag>` and staffing
   `0003_<tag>` (journals end at `0059_floor_plan_sets` and `0002_charming_black_widow`). Read every
   generated file. Expected content, as in `0057_black_shadow_king.sql` and
   `0002_charming_black_widow.sql`: a rebuild of `menu_periods` and of `staff_roles` with the
   sixteen-value CHECK, the rebuilt `menu_periods` also carrying `floor_plan_set_id` and its key to
   `floor_plan_sets` (D6), and re-creating each table's unique indexes
   (`menu_periods_department_name_key`, `menu_periods_department_key`,
   `staff_roles_location_name_key`) — nothing else. If drizzle generates anything more (another
   table, a dropped index or key), stop and report. Neither table has an expression index
   (`menus.ts:49-50`, `staffing.ts:38`), so the 0.31.11 expression-index trap
   (`conventions-data.md:2652`) does not apply. Triggers: grep every `CREATE TRIGGER` under
   `packages/*/drizzle` for `menu_periods` or `staff_roles` — none on 2026-10-18 (only
   `packages/db/drizzle` has triggers, none naming either table); re-run that grep.
4. Run, reading each `Tests` count:
   `pnpm --filter @waitron/shared exec vitest run src/station-colours.test.ts`;
   `pnpm --filter @waitron/staffing exec vitest run --project node`;
   `pnpm --filter @waitron/venue-service exec vitest run --project node` (the whole node side: the
   palette order is a value several suites pin, and A753's rebuild broke three upgrade tests here);
   `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/station-colour-styles.test.ts src/dashboard/season-tint.test.ts src/dashboard/calendar-colours.test.ts`
   (the last is expected red until Task 5a only for its pinned maps);
   `pnpm --filter @waitron/db exec vitest run src/configuration-transfer.test.ts`;
   and in `apps/server`, `src/kitchen.test.ts src/management-api.test.ts src/configuration-transfer.test.ts`.
   Commit (code and migrations in ONE commit: the CHECK refuses the new colours until the migration
   exists).

## Task 4 — the upgrade walk and the guard suites

1. `pnpm exec vitest run scripts/migration-upgrade.test.ts` from the root. For each new step it
   fails on, add a `RESETS` entry keyed by the step label it prints, with the refusal parts or lost
   tables EXACTLY as printed, and a one-line comment in the house style (`:531-540`). Re-run until
   green.
2. Guard suites, from the root:
   `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/module-graph-honesty.test.ts scripts/migration-upgrade.test.ts scripts/style-token-names.test.ts`,
   then `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad` and
   `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`, both
   UNEDITED. Read each count. Commit.

## Task 5a — venue-service dashboard tests: periods, seasons, colour choices

Run these first and record which fail after Task 3 and why; then update each to the sixteen in D1
order, keeping every check's shape (labels checked in both languages where the file checks both; a
"first unused" check still proves the skip). Never weaken a check to a length or a subset.

- `packages/venue-service/src/dashboard/period-dialog.test.ts`: the EN labels (`:397-413`, title
  "thirteen" loses its count), the tab-stop list and `[0, -1, …]` (`:486-503`, sixteen entries),
  the two `usedBy` maps (`:1141-1155`, `:1161-1175`), the ES labels (`:1207-1221`); `"magenta" as never`
  → `"beige"` at `:377`, `:477`, `:525`.
- `period-dialog.a11y.test.ts:40`: the colour-invalid state's `"magenta"` → `"beige"` (left alone it
  silently tests a valid colour).
- `calendar-colours.test.ts`: the `usedBy` map (`:33-47`); the "Odd" user's `"magenta"` (`:51`) →
  `"beige"`. `:57` (red, orange → amber) is unchanged by D1.
- `periods-list.editing.test.ts:467-485`: the all-taken list → the sixteen (or `[...CALENDAR_COLOURS]`).
- `seasons-window.test.ts:161`: the second new season's colour `lime` → `yellow` (D1: green, amber,
  orange, blue and red are used, so the first free is now yellow).
- `season-draft.test.ts:99`: title "all thirteen" loses its count (the body iterates the constant).

Run each touched file (`pnpm --filter @waitron/venue-service exec vitest run <files>`), read the
counts. Commit.

## Task 5b — station and staff role dashboard tests

- `packages/venue-service/src/dashboard/prep-stations-screen.test.ts:696-715` (all taken → red):
  every station colour.
- `station-table.test.ts:185-215` and `prep-stations-screen.a11y.test.ts:466-480`: the per-colour
  lists gain the three (or iterate `STATION_COLOURS`), so the new swatches are painted and checked.
- `routing-grid.a11y.test.ts:135-148`: `COLOURS` (twelve, grey left out) gains the three; the
  hard-coded `% 12` (`:176`) becomes `% COLOURS.length`; the comment "Twelve stations, one per colour" (`:151`)
  and "against the twelve fills" (`:498`) lose the count.
- `routing-grid.test.ts:2139-2143`: title "not one of the twelve" → "not a station colour";
  `"magenta"` → `"beige"`. The source comment it mirrors, `routing-grid.ts:482` ("a colour outside
  the twelve"), becomes "a colour outside `STATION_COLOURS`".
- `packages/staffing/src/dashboard/staff-role-dialog.test.ts`: the labels (`:111-132`, title
  "thirteen" loses its count), the two `usedBy` maps (`:667-681`, `:732-746`), the all-taken list
  (`:684-706`). `:666` (red and blue used → orange) is unchanged by D1.

Then `grep -rn "thirteen\|twelve" packages/*/src apps/*/src --include='*.ts'` for any colour count
left (2026-10-18 the colour hits were the ones listed in this plan). Run each touched file, read the
counts. Commit.

## Task 6 — LOOK and documents (driver)

1. LOOK. The dev venue needs a reset for the rebuilds (D6). Check holders first:
   `lsof +D ~/workspace/.waitron-dev/box/venue` and `lsof -nP -iTCP:8080 -sTCP:LISTEN` (the slot-0
   folder, per the memory note on resets; use this worktree's slot if `wa-wt` gives another), then
   `wa-wt reset demo waitron-feat-a783-sixteen-colours` and `wa-wt demo waitron-feat-a783-sixteen-colours`.
   Create periods, staff roles, seasons and stations in yellow, sky and magenta. Shoot, both themes,
   390 and 1280 wide, EN and ES, to `~/waitron-campaign-b/a783-shots/`: the period dialog's,
   staff role dialog's, station editor's and Seasons window's open chooser (sixteen tiles: four
   columns at 1280, two at 390); the Staff roles list swatches; the Calendar Month view segments;
   the rota by area swatches; the Prep stations Routes grid. Check the Seasons window's colour
   button at 390 (backlog "At phone width the Seasons window cuts longer colour names",
   `docs/backlog.md:1400`): if Amarillo, Celeste or Magenta is cut, add it to that entry's examples
   as measured.
2. Docs:
   - `docs/developers/design-system.md`: the token list (`:140`, the `palette-{…}` brace list); the
     A753 paragraph (`:224-226`, "grew to thirteen") gains a dated 2026-10-18 A783 sentence and its
     pointer moves to `packages/shared/src/calendar-colours.ts`; the palette table (`:228-244`) and
     the station table (`:285-298`) gain the three rows with D2's values in D1 order; "one of the
     thirteen" (`:253`) and "the twelve fills differ and so do the twelve dots" (`:303`) lose their
     counts; the `wt-colour-chooser` row (`:727`, "tiles in two columns") says four columns, or two
     in a window `40rem` wide or less, chosen each time the panel is placed, and that the arrow keys
     move tile by tile in reading order.
   - `docs/backlog/service-periods.md:438-443` (the A753 decision, never deleted): add a dated line —
     2026-10-18, A783: sixteen, in rows of four, the order of D1; a fourth new period or role now
     takes yellow.
   - `docs/backlog/kitchen.md:391-393` (the A725/A783 decision): add a dated line that A783 landed,
     with the PR number.
   - Grep `docs/` for "thirteen" and "twelve" near colour, palette, station or chooser, and for
     "two columns" near the chooser; fix each claim this change retires (2026-10-18 the hits beyond
     the above were unrelated: `conventions-data.md:2541`, `testing-guide.md:431,1612`,
     `till.md:873`). No `docs/backlog.md` entry to delete (D12); the lane queue entry is the
     driver's to mark.
   - `packages/ui/demo/main.ts:498-508` stays: it demonstrates the chooser, not the palette.
3. PR: first line says a venue reset is needed (D6); the body names the yellow-fourth consequence
   (D1), the column rule (D8) and the deleted dead strings (D4). After landing, the Santet
   real-data venue and the owner's box need the reset too (Santet through its own rebuild script,
   never `wa-wt reset`).
