# A753 point 1 — thirteen calendar colours

**Owner decision (2026-10-17, relayed by the watcher):** option (a) of the swatch question — today's
six calendar colours plus orange, lime, teal, cyan, indigo, pink and brown (Spanish: Naranja, Lima,
Turquesa, Cian, Índigo, Rosa, Marrón), "with the migration that widens the two CHECK rules". The
question and pictures: `docs/backlog/mockups/a753-calendar-colours/` (values in `shoot.mjs`).
Backlog: `docs/backlog.md` "A753" and `docs/backlog/service-periods.md#a753-calendar-colours-more-of-them`.

Branch `feat/a753-calendar-palette`, worktree
`~/workspace/worktrees/waitron-feat-a753-calendar-palette`. Review path: FULL (two migrations).

## Decisions

- **D1 — palette order is the swatch board's rainbow order**: red, orange, amber, lime, green, teal,
  cyan, blue, indigo, purple, pink, brown, grey. The board the owner answered shows (a) "in rainbow
  order". The order is what the chooser panel shows and what `firstUnusedCalendarColour` and
  `menu-timetable.ts`'s new-period colour walk (`CALENDAR_COLOURS.find(...)`, line ~574) pick
  first, so a new period or staff role on an empty venue still starts red, the second now orange
  (was amber). Say so in the PR.
- **D2 — the colour values are the board's**, copied from `shoot.mjs`'s `COLOURS` (fill, text on it),
  light and dark. The six existing values do not change.
- **D3 — the column default stays `grey`.**
- **D4 — the two rebuilds need a venue reset.** Changing a CHECK makes drizzle-kit 0.31.11 rebuild
  `menu_periods` (venue-service) and `staff_roles` (staffing). A rebuild runs with foreign keys ON
  (CLAUDE.md §3; `docs/developers/conventions-data.md`, "A drizzle table rebuild runs with foreign
  keys ON"), and both tables have cascading AND `no action`/`restrict` children
  (`packages/staffing/drizzle/0000_baseline.sql:6`, `0001_staffing_days_blocks_assignments.sql:9,21`;
  `packages/venue-service/drizzle/0028_menu_timetables.sql:35,47`, `0033…:32`, `0050…:9` and
  others). So on a venue holding those rows the step is refused or loses rows. Before go-live that is
  a reset, not data-migration code (CLAUDE.md §3, last rule). The generated SQL is NOT hand-edited.
  The PR's first line says a venue reset is needed. The upgrade guard
  (`scripts/migration-upgrade.test.ts`) gets a `RESETS` entry for each new step, stating exactly
  what the walk printed (refused message parts, or lost tables) — never guessed.
- **D5 — no stored value changes**: every colour stored today is one of the six, all still valid.

## Global constraints

- TDD: each task writes its failing test first and watches it fail for the stated reason.
- Never edit a shipped migration file. Never hand-edit a generated migration, snapshot or
  `_journal.json`; on a number clash, reset the folder to `main` and regenerate (CLAUDE.md §3).
- Comments: none that restate code; cut stale ones you touch (CLAUDE.md §1, last rule).
- Every commit `git commit -s`. Never `git stash` in the worktree.
- Run `pnpm format:check` (or `pnpm exec prettier --check <files>`) before each commit.
- Changed test checks: a test that pins the six colours changes because this item changes what it
  checks (owner, 2026-10-05). List every one in the task report with file:line, old → new.
- Golden huella (`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`)
  and `inmutabilidad` must pass UNEDITED (Task 2a runs both).

## Task 1 — the seven new colour tokens (`packages/ui-core`)

Files: `packages/ui-core/src/tokens/colors.css`, `packages/ui-core/src/tokens/colors.test.ts`.

1. Test first: in `colors.test.ts`, the `PALETTE` list (line ~403) that drives the calendar colour
   contrast checks becomes the thirteen keys. Run
   `pnpm --filter @waitron/ui-core exec vitest run src/tokens/colors.test.ts` and see it fail on the
   missing tokens.
2. Add `--wt-color-palette-<key>` and `--wt-color-on-palette-<key>` for orange, lime, teal, cyan,
   indigo, pink, brown in EVERY block of `colors.css` that declares `--wt-color-palette-red` (light,
   dark media query, and both explicit theme blocks — `grep -n palette-red` lists them), with D2's
   values: light values in the light blocks, dark values in the dark ones. Keep the blocks' existing
   order of the six and add the seven after purple.
3. The comment above the block (line ~40, "six colours a special date picks from") is stale (special
   dates store no colour since venue-service `0038`). Replace it with one line naming what is true:
   the calendar colours periods and staff roles pick from, each with its text colour, and the two
   day colours. Same edit in every block that carries it.
4. If `colors.test.ts` (line ~550) or another ui-core test pins the palette token list elsewhere,
   extend it the same way. Run the whole file plus `pnpm exec vitest run scripts/style-token-names.test.ts`
   from the root. Commit.

## Task 2a — the palette, its labels and the two migrations

Files: `packages/venue-service/src/hours-types.ts`, `packages/venue-service/src/dashboard/period-colour-styles.ts`,
`packages/venue-service/src/dashboard/strings.ts` (`hours.colour.*`, EN and ES),
`packages/staffing/src/dashboard/strings.ts` (the colour-name map near line 450), the two migration
folders, `scripts/migration-upgrade.test.ts`, and the server-side tests named below.

1. Tests first (server side, `useVenueDb`):
   - staffing: a staff role saved with `teal` (a new colour) is stored and read back, through
     `createStaffRole` (`packages/staffing/src/staff-roles.test.ts`) — fails today at
     `invalid("colour")`; and the existing refusal of an unknown colour still holds.
   - staffing schema: in `packages/staffing/src/schema/constraints.test.ts`, a direct insert of a
     new colour passes the CHECK and an unknown one (`"magenta"`) is refused — the first fails today
     on `staff_roles_colour_ck`.
   - venue-service: a period created or updated with a new colour (`indigo`) through the
     menu-timetable write path is stored; find the existing colour cases in
     `packages/venue-service/src/menu-timetable.test.ts` and the route's colour validation
     (`routes.ts:244`) and configuration transfer (`configuration-transfer.ts:132`) tests, and add a
     new-colour case beside each that exists. A direct insert passing `menu_periods_colour_ck`
     belongs wherever venue-service tests its schema constraints (grep `menu_periods_colour_ck`).
   - `menu-timetable.test.ts:616` (the walk that gives each new period the first unused colour,
     wrapping to the first): make it create fourteen periods and expect the thirteen in D1 order then
     `red`, so the wrap is still checked.
   Watch each fail for the stated reason.
2. `CALENDAR_COLOURS` becomes the thirteen in D1 order. Fill `PERIOD_COLOUR_TOKENS` for the seven
   (same shape as the six) and the label maps: EN Orange, Lime, Teal, Cyan, Indigo, Pink, Brown; ES
   Naranja, Lima, Turquesa, Cian, Índigo, Rosa, Marrón. `pnpm --filter @waitron/venue-service typecheck`
   and `pnpm --filter @waitron/staffing typecheck` must pass.
3. Generate: `pnpm --filter @waitron/venue-service db:generate` and
   `pnpm --filter @waitron/staffing db:generate`. Read every generated file. Expected: a rebuild of
   `menu_periods` and of `staff_roles` with the widened CHECK and nothing else. If drizzle generates
   anything more (another table, a dropped index), stop and report. Check the rebuilt tables'
   triggers: list `sqlite_master` triggers whose table is, or whose SQL names, `menu_periods` or
   `staff_roles` on a migrated venue (a throwaway script against a `useVenueDb` database, or the
   upgrade test's output) and report them; a rebuild drops a trigger ON the table silently, and one
   whose BODY names it fails the rename on upgrade (CLAUDE.md §2, migrations bullet).
4. Run `pnpm exec vitest run scripts/migration-upgrade.test.ts` from the root. For each new step it
   fails on, add a `RESETS` entry keyed by the step label it prints, with the refusal parts or lost
   tables EXACTLY as the walk printed them, and a one-line comment in the house style ("Rebuilds
   `staff_roles` to widen its colour CHECK; …"). Re-run until green.
5. Guard suites, from the root:
   `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/module-graph-honesty.test.ts`,
   then `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad` and the golden huella
   file. Then the focused server tests:
   `pnpm --filter @waitron/staffing exec vitest run src/staff-roles.test.ts src/schema/constraints.test.ts`
   and `pnpm --filter @waitron/venue-service exec vitest run src/menu-timetable.test.ts` plus the
   route/transfer test files you touched. Read each `Tests` count. Commit.

## Task 2b — dashboard tests that pin the six

Files: the browser tests that list the six, found by
`grep -rn '"red", "amber", "grey", "blue", "green", "purple"\|purple: \[\]' packages/venue-service/src/dashboard packages/staffing/src/dashboard`
— at least `period-dialog.test.ts` (~412, ~486, ~1097, ~1104), `periods-screen.editing.test.ts`
(~444), `calendar-colours.test.ts` (~39), `staff-role-dialog.test.ts` (~124, ~666, ~672, ~708),
`staff-roles-screen.a11y.test.ts` (~18) and `packages/staffing/src/dashboard/strings.test.ts`.

1. Run those files first and record which fail after Task 2a and why (they pin six choices, six
   labels or the old order).
2. Update each to the thirteen in D1 order, keeping every check's shape: a check over the labels
   checks all thirteen in both languages (add the Spanish names where the file checks Spanish); a
   "first unused" check still proves the skip (e.g. with red and orange used, the next is amber).
   Do not weaken a check to a length or a subset.
3. Run each touched file (`pnpm --filter <pkg> exec vitest run <file>`), read the counts. Commit.

## Task 3 — the hand-written colour lists paint every colour

Three places list the six by hand and would leave a new colour unpainted:
`packages/venue-service/src/dashboard/opening-hours-month.ts` (`.segment[data-colour=…]`, ~265),
`packages/staffing/src/dashboard/rota-by-area.ts` (`.swatch[data-colour=…]`, ~100) and
`packages/staffing/src/dashboard/staff-roles-screen.ts` (`wt-data-table::part(swatch-…)`, ~70).
Grep `palette-amber` across `packages/*/src` and `apps/*/src` for any other per-colour list.

1. Tests first: for each place, a browser test renders an item whose colour is a NEW one (e.g.
   `brown`) and asserts the painted background equals the token's computed value — use the probe
   pattern at `packages/staffing/src/dashboard/staffing-grid.test.ts:~165` (a probe element styled
   with `var(--wt-color-palette-<key>)`, compare `getComputedStyle(...).backgroundColor`). Watch
   each fail (transparent background).
2. Replace each hand list with one generated from `PERIOD_COLOUR_TOKENS`, the way
   `periodColourStyles` (`period-colour-styles.ts`) does for `[data-colour]`: reuse
   `periodColourStyles` where the selector shape fits (a `[data-colour]` element reading
   `--period-fill`), otherwise generate the selector list from `PERIOD_COLOUR_TOKENS` with
   `unsafeCSS`. Staffing reaches venue-service's dashboard code only through the subpath exports in
   `packages/venue-service/package.json`; if a new subpath is needed, add it there (and check
   `scripts/` guards that pin export maps). Token names must stay greppable for
   `scripts/style-token-names.test.ts` — the `PERIOD_COLOUR_TOKENS` literal already spells them.
3. Run the touched test files and their `*.a11y.test.ts` siblings; run
   `pnpm --filter @waitron/staffing exec vitest run src/dashboard` only if a file outside the three
   changed. Commit.

## Task 4 — LOOK and documents (driver)

1. LOOK: the period dialog's and staff role dialog's colour panel with thirteen colours, the
   Staff roles list swatches, the Month view segments and the rota-by-area swatches with new
   colours, both themes, 390 and 1280 wide, EN and ES. The dev venue needs a reset for the rebuilds
   (D4): check holders first (`lsof` on the slot's venue folder and port 8080), then
   `wa-wt reset demo waitron-feat-a753-calendar-palette`. Shots to `~/waitron-campaign-b/a753p-shots/`.
2. Docs: `docs/developers/design-system.md` wherever it lists the calendar colours; delete the
   A753 entry in `docs/backlog.md` and its detail in `docs/backlog/service-periods.md` (A753 is
   then fully done), leaving any open point as its own short entry. Grep docs for "six colours"
   / "six calendar" and fix each claim the change retires.
