# A766 — The till's floor plan grows while a table is dragged past its edge

Backlog: `docs/backlog.md` "A766" and `docs/backlog/till.md#a766-the-tills-floor-plan-grows-while-a-table-is-dragged-past-its-edge`
(owner, 2026-10-16): "Dragging a table beyond the plan's edge on the till's floor leaves the plan its
old size until the table is let go, so the waiter cannot see where it will land. Grow it as the
table moves."

Branch `feat/a766-till-floor-grows-on-drag`. Review path: FULL (`wt-floor-map` is a shared `wt-*`
primitive in `packages/ui`, which is mutation-tested). No migration, no route, no stored record.

## How it works today (read from the code, 2026-10-17; Task 3 looks at it running)

- `wt-floor-map` (`packages/ui/src/components/wt-floor-map.ts`) draws the tables fitted to its own
  box: `#fitView` (`:744`) fits `cropToTables(tables)` — the tables' bounds plus a 2-square margin —
  into the host. The host is `overflow: clip` (`:215`), so a table drawn outside the box is cut off.
- The host's SHAPE comes from the till screen: `#plannedMap` (`apps/till/src/screens/till-floor-screen.ts:1818`)
  computes the same crop and sets `--floor-map-ratio` on the element; the screen's CSS (`:265–272`)
  gives the map `aspect-ratio: var(--floor-map-ratio)` and a width bounded by the page.
- A hold-and-drag moves the held group by `snapToSquare(dx, scale)` squares (`#onHoldDrag`, `:536`),
  with `dx` the pointer's px since the press and `scale` the view's px per square. The drawn group
  moves; the crop, the fit and the host's shape do not.
- On release, `wt-table-drag-end` (`:575`) reaches `#onDrop` (`till-floor-screen.ts:934`), which for a
  move sets the pending place at once (`#setPending`, `:897`). The screen re-renders with the table in
  its new place, the ratio changes, the host resizes, and the `ResizeObserver` (`:405`) refits the
  view unless the waiter had panned or zoomed (`#touched`). A new `tables` list alone never refits
  (`willUpdate`, `:731–742`; `design-system.md:809`): the "grows when let go" happens only because
  the ratio, and so the host's size, changes.

## Decisions this plan makes that the backlog entry does not

Revised after the plan review (2026-10-17): a first draft refitted the view on every drag move and
kept the grabbed point under the finger; a model of it ran the table out to x 999 once the finger
neared the edge, and it changed assertions in `wt-floor-map.view.test.ts` (modelled) and
`wt-floor-map.today.test.ts` (reasoned), whose fixed-size hosts drag tables past the crop.

1. **During a drag the map behaves as though the held group already stood where it is drawn — but
   only ever GROWS.** The drag's crop is the union, over every move of this drag, of the tables'
   crop and the crop of the tables with the held group moved. When `tables` is replaced mid-drag (a
   live update) the drag's crop restarts from the new tables' crop united with the moved group's.
   Dragging the edge table inward does not shrink the plan mid-drag.
2. **The map publishes its own `--floor-map-ratio` on its host**, from the effective crop: the
   drag's crop while a non-fixed drag is drawn and the view is untouched, else the tables' crop (1
   with no tables). The till screen stops computing the ratio (its `styleMap` and `cropToTables`
   imports go with it) and keeps reading the variable in its CSS. The map owns the variable; a
   parent only reads it (a parent binding `style` as a plain attribute would wipe it — say so in
   design-system.md).
3. **The view is refitted only by a resize, as on release today.** `#fitView` fits the effective
   crop. A host whose CSS reads the ratio (the till) is resized when the ratio changes, and the
   `ResizeObserver` refits it unless the view was touched. A host of fixed size — every existing
   suite's box, fixed in both dimensions (600 × 300, 480 × 240, 400 × 200) — is never refitted during a drag, so those suites keep their assertions.
4. **The drag follows the finger's travel, never a view the drag itself caused.** Today the squares
   are `snapToSquare(dx, view.scale)`; with the scale changing under a drag that would feed back.
   The map banks the travel each time the scale changes: it keeps the squares travelled at the scale
   in force (`banked`, exact, unrounded), the `dx`, `dy` at which that scale took over, and the
   scale; a move whose scale differs from the kept one first adds the previous move's travel at the
   kept scale to `banked`. The squares are `banked + (dx − dxAtBank) / scale`, rounded, through
   `groupStep` as today. While the scale never changes `banked` is 0 and `dxAtBank` is 0, so the
   squares are exactly today's `round(dx / scale)`. A still finger moves nothing after a refit; the
   table keeps moving at finger speed on screen. A wheel zoom during a drag is banked the same way
   (today it rescales the travel already made; no existing test covers it).
5. **A waiter's own pan or zoom is kept, and turns the growth off.** While `#touched` is set the map
   publishes the tables' ratio, so nothing changes during the drag; release behaves as today.
6. **A fixed group does not grow the plan.** Its drag draws a copy that can only be dropped on
   another table (`dropAction`), which is already inside the plan.
7. **Release refits nothing itself.** `#endDrag` only ends the drag. Where the new tables' crop
   equals the drag's crop, the ratio does not change and the view stays fitted to it; where it
   differs (a refused drop, a drag out and back, a move off the opposite edge), the ratio changes
   and the observer refits.
8. **Residuals, recorded as short backlog entries in Task 5:** a crop that grows in proportion (a
   diagonal drag, 12 × 8 to 15 × 10) changes no ratio, so nothing refits — as on release today; and
   after the view has rescaled during a drag the drawn table lags the finger, while the drop target
   and its highlight stay the table under the finger (`#targetAt`, unchanged); the highlight is
   worked out on each move and the drop's target again at release, so after a refit that follows
   the last move the highlight can lag by that one refit.
9. **Nothing else changes.** No new event, no change to what `wt-table-drag-end` carries, no change
   to the dashboard editor (`wt-floor-plan-canvas`, whose grid already grows during a drag through
   `gridExtent`; the two share `bounds` and `cropToTables` and nothing else that applies here).

## Global constraints

- TDD: each behaviour's test first, watched failing for the right reason.
- Every existing test passes UNEDITED (`wt-floor-map*.test.ts`, the till screen's suites). A fixture
  may gain what it lacks; no assertion changes (queue.md ⚠ THE RULE).
- Browser tests: `packages/ui` and `apps/till` run in real headless Chromium. Check free memory first
  (`memory_pressure | grep free`). Read the `Tests` count, never only the exit status.
- New grow tests mount the map in a host that reads the ratio, e.g.
  `style="display: block; width: 600px; aspect-ratio: var(--floor-map-ratio)"`, so a ratio change
  resizes it as the till's CSS does; a fixed-size host cannot show growth.
- `packages/ui`'s mutation floor of 90 bites on the nightly merged score
  (`docs/developers/ci-and-gates.md`); a local run gates nothing but is how survivors are found:
  `pnpm --filter @waitron/ui exec stryker run --mutate src/components/wt-floor-map.ts`.
- Comments only for an invariant or a non-obvious why (CLAUDE.md §1). Every `wt-*` rule in
  CLAUDE.md §3 holds.

## Review focus

- The drag lands where it is drawn: the `wt-table-drag-end` x and y are the drawn place.
- No feedback loop: a still pointer after a refit moves nothing; a drag back inward does not shrink
  the plan; release settles to today's fit.
- The fixed-group copy, the drop-target highlight and `#targetAt` still work while the view rescales.
- A table list replaced mid-drag still ends the drag when the held table goes, and the drag's crop
  restarts from the new list.

## Tasks

### Task 1 — The map publishes its own ratio (no behaviour change)

Files: `packages/ui/src/components/wt-floor-map.ts`, a new `packages/ui/src/components/wt-floor-map.grow.test.ts`,
`apps/till/src/screens/till-floor-screen.ts`.

- Test first: a map given tables whose crop is W × H squares sets `--floor-map-ratio` on its own host
  to `W / H` (`map.style.getPropertyValue("--floor-map-ratio")`); a map with no tables sets `1`;
  replacing `tables` updates it.
- Set it in `willUpdate` from the tables' crop.
- Till screen: remove the `styleMap` ratio binding from `#plannedMap`, and the `styleMap` and
  `cropToTables` imports if nothing else uses them; keep the CSS that reads the variable. The
  existing case `till-floor-screen.map.test.ts:345` ("sizes the map to a W by H zone") must pass
  unedited — it is the till-side test; add none.
- Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-map` and
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen src/screens/device-screens.phone-margin`
  (the phone-margin case at `:149–176` measures the map's box straight after mounting).

### Task 2 — The drag banks its travel when the scale changes

Files: `packages/ui/src/components/wt-floor-map.ts`, `wt-floor-map.grow.test.ts`.

- Test first: hold a table, move it (say 2 squares), Ctrl+wheel to double the scale, send the same
  pointer position again: the table does not move (today it jumps back to 1 square); move a further
  `2 × newScale` px: it moves 2 more squares; release sends that place.
- Implement decision 4. Record the move's travel on EVERY move, before `#onHoldDrag`'s early
  return for an unchanged place (`:553–562`), or travel since the last stored move is banked at the
  wrong scale. The existing suites (every drag at one scale) pass unedited.

### Task 3 — The plan grows while a table is dragged past its edge

Files: `packages/ui/src/components/wt-floor-map.ts`, `wt-floor-map.grow.test.ts` (and
`packages/ui/src/floor-plan-geometry.ts` only if a small rectangle-union helper earns its place there,
with its own tests).

Tests first, in a ratio-reading host, driving the real pointer gesture the other suites use (read
`wt-floor-map.test.ts` / `wt-floor-map.view.test.ts` for the hold-then-move helpers):

- dragging a table past the right edge, still held: the published ratio grows, the host resizes, the
  view refits (a table's drawn width shrinks), and the held table is drawn wholly inside the host;
- the same past the bottom edge;
- dragging the edge table inward does not change the ratio during the drag;
- releasing an outward move whose new `tables` (the parent sets the moved place, as the till's
  pending place does) has the drag's crop — another table holds the opposite edge, so the crops
  really are equal: the table stays drawn wholly inside the host;
- a drag out and back, then release with `tables` unchanged (a refused drop): the ratio and the fit
  return to the tables';
- after a pan, a drag past the edge changes neither the ratio nor the scale;
- a fixed table's drag changes neither;
- `tables` replaced mid-drag with the held table still in it: the drag's crop restarts from the new
  list (a table removed from the edge in the new list no longer holds the plan wide).

Implement decisions 1, 2, 3, 5, 6 and 7. Prove by deletion: with the effective crop set back to the
tables' crop, the grow cases fail; with the banking removed (back to `snapToSquare(dx, scale)`), a
grow case asserting the drop place fails or the Task 2 case does — say which.

### Task 4 — Mutation survivors

Run `pnpm --filter @waitron/ui exec stryker run --mutate src/components/wt-floor-map.ts`; kill the
survivors in the new code with tests that assert behaviour, or name each one left and why it is
equivalent. Record the score in the ledger.

### Task 5 — Look at it, and the docs

- Run the till against a dev stack (`wa-wt demo <worktree-name>`), hold a table and drag it past the
  right and the bottom edge; screenshots mid-drag before (main) and after (branch), light and dark,
  1280 and 390 wide, saved under `~/waitron-campaign-b/a766-shots/`.
- `docs/developers/design-system.md`: the `wt-floor-map` API row (`:679`) gains that the map sets
  `--floor-map-ratio` on its own host (width ÷ height of what it fits) for the parent to read and
  must not be overwritten; the prose at `:806–810` ("Its size is its parent's choice", the fit
  rules) says that during a drag it fits as if the held table already stood where it is drawn,
  growing only, and that a pan turns that off.
- `docs/backlog.md`: delete the A766 entry; `docs/backlog/till.md`: delete its A766 section, and add
  decision 8's two residuals as short points under A474's follow-ups.
