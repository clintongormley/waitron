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
  move sets the pending place at once (`#setPending`). The screen re-renders with the table in its new
  place, the ratio changes, the host resizes, and the `ResizeObserver` (`:405`) refits the view
  unless the waiter had panned or zoomed (`#touched`). That is the "grows when let go".

## Decisions this plan makes that the backlog entry does not

1. **During a drag the map behaves as though the held group already stood where it is drawn — but
   only ever GROWS.** The drag's crop is the union of the tables' crop and the crop of every table
   with the held group moved. Dragging the table at the edge inward does not zoom the plan in
   mid-drag; on release the plan settles to the true crop exactly as today. Default chosen because a
   plan that shrinks under the finger zooms in and runs the table away from it, and the owner asked
   for growth only.
2. **Both halves of "the plan" grow: the host's shape and the fitted view.** The map publishes its
   own `--floor-map-ratio` on its host from the effective crop (the drag's crop while a drag is
   drawn, else the tables'); the till screen stops computing it and keeps reading the variable in
   its CSS. The fitted view fits the effective crop. One source for the ratio means the shape the
   screen gives the box and the crop the map fits into it cannot disagree mid-drag.
3. **The grabbed point stays under the finger.** With the view rescaling under a drag, `dx / scale`
   no longer says where the finger is on the plan. The drag is computed in plan squares instead: on
   the drag's first move the map records the plan point under where the press began (from the
   host's `getBoundingClientRect()` and the view at that moment); each move takes the plan point
   under the pointer now, from the current host box and view, and moves the group by the rounded
   difference (through `groupStep`, as today). When the view has not changed this is exactly
   today's `snapToSquare(dx, scale)`, so a drag that never crosses the edge moves as it does now.
   When a move grows the crop and the view is refitted, the squares are recomputed against the new
   view, repeating until they stop changing; growth only ever widens the crop and `groupStep` holds
   the group within 0–999, so the repetition ends.
4. **A waiter's own pan or zoom is kept.** While `#touched` is set the view is not refitted, as on
   release today; only the host's shape follows the drag (and the observer keeps the view on the
   resize, as it does today). Double-tapping the empty floor still refits.
5. **A fixed group does not grow the plan.** Its drag draws a copy that can only be dropped on
   another table (`dropAction`), which is already inside the plan.
6. **Nothing else changes.** No new event, no change to what `wt-table-drag-end` carries, no change
   to the dashboard editor (`wt-floor-plan-canvas`, whose grid already grows during a drag through
   `gridExtent`; the two share `bounds` and `cropToTables` and nothing else that applies here).

## Global constraints

- TDD: each behaviour's test first, watched failing for the right reason.
- Every existing test passes UNEDITED (`wt-floor-map*.test.ts`, the till screen's suites). A fixture
  may gain what it lacks; no assertion changes (queue.md ⚠ THE RULE).
- Browser tests: `packages/ui` and `apps/till` run in real headless Chromium. Check free memory first
  (`memory_pressure | grep free`). Read the `Tests` count, never only the exit status.
- `packages/ui` holds a 90 mutation floor: run Stryker over `wt-floor-map.ts` (and any geometry
  helper added) and kill or explain the surviving mutants of the new code.
- Comments only for an invariant or a non-obvious why (CLAUDE.md §1). Every `wt-*` rule in
  CLAUDE.md §3 holds.

## Review focus

- The drag still lands where it is drawn: the `wt-table-drag-end` x and y are the drawn place.
- No feedback loop: a held pointer near the edge settles; a drag back inward does not shrink the
  plan; release settles to today's fit.
- The fixed-group copy, the drop-target highlight and `#targetAt` still work while the view rescales.
- A table list replaced mid-drag (a live update) still ends the drag when the held table goes, and
  the drag crop uses the new list.

## Tasks

### Task 1 — The map publishes its own ratio (no behaviour change)

Files: `packages/ui/src/components/wt-floor-map.ts`, a new `packages/ui/src/components/wt-floor-map.grow.test.ts`,
`apps/till/src/screens/till-floor-screen.ts`.

- Test first: a map given tables whose crop is W × H squares sets `--floor-map-ratio` on its own host
  to `W / H` (read with `getComputedStyle(map).getPropertyValue("--floor-map-ratio")` or
  `map.style`); a map with no tables sets `1`; replacing `tables` updates it.
- Set it in `willUpdate` from the same crop `#fitView` uses.
- Till screen: remove the `styleMap` ratio and its `cropToTables` call from `#plannedMap`; keep the
  CSS that reads the variable. Its existing suites must pass unedited; add one case in
  `till-floor-screen.map.test.ts` (or the screen suite that renders the plan view) that the rendered
  `wt-floor-map` has the ratio of its zone's tables.
- Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-map` and
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen`.

### Task 2 — The plan grows while a table is dragged past its edge

Files: `packages/ui/src/components/wt-floor-map.ts`, `wt-floor-map.grow.test.ts` (and
`packages/ui/src/floor-plan-geometry.ts` only if a small rectangle-union helper earns its place there,
with its own tests).

Tests first, each in `wt-floor-map.grow.test.ts`, driving the real pointer gesture the other
`wt-floor-map` suites use (read `wt-floor-map.test.ts` for the hold-then-move helpers):

- dragging a table past the right edge, still held: the published ratio grows, the view's scale
  falls (a table's drawn width shrinks), and the held table is drawn wholly inside the host;
- the same past the bottom edge;
- the grabbed point stays under the pointer: after the grow, the pointer is still over the held
  table's drawn box (`elementsFromPoint` or the box's rect);
- on release the `wt-table-drag-end` x and y equal the place drawn on the last move;
- a drag that stays inside the plan moves exactly as before (same squares for the same px; the
  existing suites already pin this — they must stay green unedited);
- dragging the edge table inward does not shrink the plan during the drag; after `#endDrag` with
  the table list unchanged (a refused drop), the plan returns to the tables' fit and ratio;
- after a pan (`#touched`), a drag past the edge changes the ratio but not the view's scale;
- a fixed table's drag (`fixed: true`) changes neither ratio nor scale.

Implementation per decisions 1–5: an effective-crop getter (drag crop while a non-fixed drag is
drawn, else the tables' crop); `#fitView` and the ratio read it; `#onHoldDrag` records the start
plan point on the drag's first move and computes the squares from plan coordinates, refitting
(when untouched) and recomputing until stable; `#endDrag` marks the view for a refit when untouched
so a drag that does not move the table settles back.

Prove the new behaviour by deletion: with the grow removed (effective crop = tables' crop), the grow
cases fail; with the anchoring removed (back to `snapToSquare(dx, scale)`), the under-the-pointer
case fails.

Run the `wt-floor-map` suites, then Stryker on `wt-floor-map.ts` (`pnpm --filter @waitron/ui mutation`
scoped as the package's Stryker config allows — read `packages/ui/stryker*.json` and A672's ledger for
how its canvas run was scoped).

### Task 3 — Look at it, and the docs

- Run the till against a dev stack (`wa-wt demo <worktree-name>`) or the `packages/ui` demo, hold a
  table and drag it past the right and the bottom edge; screenshots mid-drag before (main) and after
  (branch), light and dark, 1280 and 390 wide, saved under `~/waitron-campaign-b/a766-shots/`.
- `docs/backlog.md`: delete the A766 entry; `docs/backlog/till.md`: delete its A766 section.
- `docs/developers/design-system.md`: if it describes `wt-floor-map`'s sizing or the till map's
  ratio, update that sentence; otherwise nothing.
