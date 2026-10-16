# A672 — The floor plan editor's canvas: corner handles, and the turn arrow at top centre

Spec: backlog entry A672 (`docs/backlog.md`) and its detail in `docs/backlog/till.md`
("## A672."), points 1–3; A562 in the same file (a 2 × 2 table's name hidden under its handles)
and A561 which it points to. Mockup: `docs/backlog/mockups/a671-floor-plan-editor-panel/2-table-selected.png`
(square corner handles, round side dots, the turn arrow above the top-centre dot; owner-approved
look, its corners left to A672).

Review path: FULL, as queued (`packages/ui`'s canvas and geometry, mutation-tested). No server
change, no stored record, no migration. The canvas's events keep their shapes: a corner drag sends
the existing `wt-table-resize` (`{ key, x, y, width, height }`), which the dashboard editor already
handles (`#onResize`, `apps/dashboard/src/screens/floor-plan-editor.ts` ~926), so nothing in
`apps/dashboard` changes.

**This plan builds only point 2's decision-free part.** Point 1 (the top-left limit), the A562
small-table rule and point 3 (scroll bars after a small turn) are owner questions, drafted with
drawings in `docs/backlog/mockups/a672-floor-plan-canvas/`. Each answer becomes its own follow-up
plan; nothing below may anticipate one.

## What the reproductions found (2026-10-16, real headless Chromium, `packages/ui`)

Throwaway probes, kept outside the repository in `~/waitron-campaign-b/a672-probe/`.

- **Point 1.** A 600 × 360 canvas, one selected table at x 0, y 0. Unturned 8 × 8: it is drawn
  72 px (6 squares, the turn arrow's `#margin`) from the grid's top and left, and the point 6 px
  inside the grid's corner is the bare grid. A drag of 60 px up and left draws it 0 px further and
  sends nothing; the top and left dots dragged 3 squares outwards send nothing; the plain Left and
  Up arrows send nothing; Shift+ArrowLeft and Shift+ArrowUp only shrink (they move the right and
  bottom sides, as designed). An 8 × 4 table turned 90° at x 0, y 0 is drawn 96 px from the left
  (two squares short of where an unturned table can go) and 72 px from the top; **all four of its
  dots dragged outwards send nothing, and so do Shift+ArrowRight and Shift+ArrowDown**: at that
  turn every growth moves the unturned corner below 0 (`resizeFrom`,
  `packages/ui/src/floor-plan-geometry.ts:108–120`, refuses at line 116). The same table turned 270°
  answers the same; turned 180° its top and left dots grow it but its right and bottom do not. The
  cause is the one the entry guessed: moves clamp the UNTURNED corner at 0 (`clampToGrid`,
  `floor-plan-geometry.ts:37–39`, called at `wt-floor-plan-canvas.ts:783–784` and `:917–918`), while
  the canvas draws `#margin` squares of plain grid beyond it (`wt-floor-plan-canvas.ts:451–500`,
  the margin at `:457–466`). The server and the database hold x and y to 0–999
  (`checkPlacement`, `apps/server/src/floor-plan.ts:173–189`; `packages/db/src/schema/floor-plans.ts:58–59`),
  so a table cannot simply be given a negative position: every fix is a choice → owner question 1.
- **Point 3.** A table placed at x 0, y 0 on an empty plan and turned 15° clockwise by dragging its
  turn arrow: the grid scroll box overflows by 12 px across and 12 px down from the first frame
  after the pointer moved, scrolled 12 px each way, and still overflows 10 frames after the release (a table placed at x 9,
  y 0 beside another: 12 px down only). The same turn by ArrowRight on the arrow: no overflow. A
  control that drew one far table for one frame was seen by the same sampler (864 px across).
  Cause: during a drag, `willUpdate`'s `hold === "drag"` branch (`wt-floor-plan-canvas.ts:472–477`)
  grows `#origin` and the grid by the square the turned table now pokes past the plan's edge, and
  `updated` scrolls that square away (`:717–722`) so nothing moves under the pointer; after the
  release the hold keeps the room until the next change (`#holding`, `:504–516`; pinned by the test
  "a turned table dropped at the corner is let go where it is drawn; its scroll room goes at the
  next change"). Changing that branch to skip a turn drag removed the overflow in the probe (the
  on-screen shift that would replace it was not measured). It shows with scrollbars that take no
  room, so it is not the mechanism of the open "a size reading just after a floor plan drop may
  shift the plan" entry. That the owner saw the bars "disappear" by macOS hiding overlay
  scrollbars, rather than by a next change, is an inference, not measured. The keyboard path
  trades the scroll for moving the whole plan a square — the open "An arrow-key turn that makes a
  corner table poke further out still shifts the other tables a square" entry. Which trade the
  canvas should make is a choice → owner question 3.

## Decisions taken here (recorded in the PR)

- **Names.** `PlanCorner = "top-left" | "top-right" | "bottom-right" | "bottom-left"`, drawn in that
  order. The drawn corner is part `resize-corner`; its hit area is part `resize-corner-handle`; each
  carries `data-corner`. The side parts keep their names (`resize-dot`, `resize-handle`), so every
  existing `[part~="resize-handle"]` selector still finds exactly the four sides.
- **Look, from the mockup.** A corner is a filled `--wt-color-primary` square `--wt-space-3`
  across (the side dot's size), turned with the table, with no border and no change while dragged
  (it is already filled). Its hit area is the side dots' `--wt-space-5` round area, centred on the
  corner and drawn under the table's button with the side hit areas, so where it overlaps the table
  the table takes the press. Every size reads a token and scales by `--wt-plan-control-scale`, as
  the side dots do.
- **Which tables get corners: those where they fit beside today's side dots.** A corner's hit area
  and its neighbouring side dot's do not overlap when the side between them is at least two hit
  areas long. So corners are drawn when the table's shorter side, at the original 12 px per square,
  is at least `2 × --wt-space-5` (48 px at the shipped tokens, so 4 squares), read from the host's
  computed style where `willUpdate` already reads `--wt-tap-min` for the margin. Judged at the
  original scale, as `showsName` judges a name, and from the table's placement when a drag began,
  never the draft, so a corner being dragged never disappears under the pointer.
- **The small-table rule stays as it is today (A562 is the owner's).** A table whose shorter side
  is under that size is drawn exactly as today: four side dots (`resize-dot`, `--wt-space-3`) over
  `--wt-space-5` hit areas at its side midpoints, no corners, and its name only when its shorter side
  is at least 28 px (`showsName`, `NAME_MIN_PX`), so never on a 2 × 2. Only its turn arrow moves
  (next point), because the arrow move is the owner's for every table.
- **The turn arrow sits above the top-centre dot.** Centred on the table's own top side (turning
  with it), its bottom edge `--wt-space-5 / 2 + --wt-space-1` above that side, so it is clear of the
  top dot's hit area and of both top corners' hit areas at every table size. Same `--wt-tap-min`
  square, icon, focus ring, name and behaviour.
- **The margin follows the arrow.** `#margin` keeps "the arrow's furthest reach past the table's
  turned box, in whole squares, enlarged when zoomed out". The furthest point of the arrow from the
  top side's midpoint is `hypot(--wt-space-5 / 2 + --wt-space-1 + --wt-tap-min, --wt-tap-min / 2)`
  (63.9 px at the shipped tokens; 6 squares, as today), and that midpoint is never outside the
  turned box. Rewrite the comment at `wt-floor-plan-canvas.ts:459–460` to that reason.
- **A corner drag** moves the two sides that meet at the corner by how far the pointer went along
  each side's own outward direction (`outward`, with the table's turn), snapped to squares as a side
  drag is, and keeps the opposite corner's x and y each within half a square of where it is drawn.
  Width and height stay 1–99. At the grid's edge each growth stops where x and y still fit (of the
  sizes up to the one asked, the largest that fits: most squares added, a tie keeping more width);
  a shrink is always taken, its x and y clamped, as `resizeFrom` does for one side. The release
  sends one `wt-table-resize` if the box changed; the size badge shows while it is dragged; a
  pointer cancel, a second pointer and a disconnect behave as for a side dot.
- **The keyboard does not change.** There is no corner pattern to follow: Shift+arrow resizing
  moves the table's own right side (ArrowRight/ArrowLeft) and bottom side (ArrowDown/ArrowUp) and
  nothing else (`RESIZE_KEYS`, `wt-floor-plan-canvas.ts:106–111`). Shift+ArrowRight then
  Shift+ArrowDown already moves the same two sides as the bottom-right corner; no key moves the top
  or left side, before or after this branch. `copy.keys` keeps its words. The gap stays a backlog
  point (Task 5).
- **Cursors.** `outward` and `resizeCursor` take a side or a corner; a corner's outward direction is
  the sum of its two sides' outward directions, normalised, so an unturned top-left or bottom-right
  corner gives `nwse-resize` and the other two `nesw-resize`, turning with the table.

## Task 1 — Geometry: a corner's direction, cursor and resize

Files: `packages/ui/src/floor-plan-geometry.ts`, `packages/ui/src/floor-plan-geometry.test.ts`.

Test first (`pnpm --filter @waitron/ui exec vitest run src/floor-plan-geometry.test.ts`):

1. `outward(corner, 0)` for the four corners is `(∓√½, ∓√½)` as named; turned 90° the top-left
   corner faces where the top-right did unturned, `(√½, −√½)` (within 1e-9).
2. `resizeCursor` for each corner at 0°, 45° and 90°: unturned top-left and bottom-right
   `nwse-resize`, top-right and bottom-left `nesw-resize`; at 45° the top-left corner points straight
   up, so `ns-resize`. The existing side cases pass unchanged.
3. `resizeFromCorner(p, corner, across, down)` on an unturned 8 × 4 table at (20, 20): bottom-right
   (2, 1) → 10 × 5 at (20, 20); top-left (2, 1) → 10 × 5 at (18, 19); top-right and bottom-left
   likewise; (0, 0) answers `p` itself.
4. For every rotation 0–345 in 15° steps, every corner, and every `across`, `down` in −3…3 on an
   8 × 4 table at (20, 20): the opposite corner's x and y (computed from the placement and its turn,
   as the test file's existing midpoint helpers do) are each within 0.5 of where they were. Watch it
   fail first against a stub that returns `p` with only the size changed.
5. A growth and its reverse cancel: `resizeFromCorner(resizeFromCorner(p, c, 2, 1), c, -2, -1)` equals
   `p` for every rotation and corner (the "half away from zero" rounding `roundShift` gives sides).
6. Sizes hold to 1–99 (shrinking a 1 × 1 and growing a 99 × 99 send back the clamped size).
7. At the grid's edge: an unturned table at (0, 5) dragged by its top-left corner (2, 2) grows
   height only (y 3, x 0, width unchanged); at (0, 0) turned 90°, the bottom-right corner (2, 2) answers
   the largest growth whose x and y fit (write the expected value from the rule, then check it);
   a shrink at the edge is taken with x and y clamped.

Then implement `PlanCorner`, widen `outward` and `resizeCursor` to `PlanSide | PlanCorner`, and add
`resizeFromCorner` beside `resizeFrom`, with its rule in one doc comment as `resizeFrom` has. Export
nothing new from `packages/ui/src/index.ts` (the canvas imports the module directly). Prove 4 and 7
by deletion (drop the rounding, drop the edge search; each fails; restore).

Mutation, once: `gtimeout 900 pnpm --filter @waitron/ui exec stryker run --mutate src/floor-plan-geometry.ts`.
A survivor on a new line gets a test, or a line in the PR saying why no test can tell it apart.

## Task 2 — Canvas: draw the corners and give them hit areas (no dragging yet)

Files: `packages/ui/src/components/wt-floor-plan-canvas.ts`, `wt-floor-plan-canvas.test.ts`.

Test first (`pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-plan-canvas.test.ts`):

1. A selected 8 × 8 table draws four `resize-corner` parts and four `resize-corner-handle` parts, in
   the order top-left, top-right, bottom-right, bottom-left, in the same frames as the side dots and
   side hit areas (aria-hidden, no tab stop, drawn corners `pointer-events: none`); an unselected
   table draws none; `dots(el)` still finds exactly four.
2. Each corner and its hit area is centred on the table's own corner (within 1 px) turned 0° and
   30° — follow the existing "centres each side dot on its side's midpoint" case.
3. Token painting: extend "paints the side dots, the size badge and the turn arrow from tokens":
   the corner's background is `--wt-color-primary`; with `--wt-space-3` and `--wt-space-5` set on the
   host (as "draws each side dot a hit area…" does), the corner is `--wt-space-3` square and its hit
   area `--wt-space-5`.
4. The size rule: with the shipped tokens a 4 × 6 and a 6 × 4 table draw corners; a 3 × 8, an 8 × 3
   and a 2 × 2 draw none and keep their four side dots exactly as today (the existing 2 × 2 cases
   ~1599–1655 pass unchanged); with `--wt-space-5` set to 30 px on the host and the tables set again,
   a 4 × 4 draws none and a 5 × 5 draws them. Watch the size cases fail with corners drawn always.
5. The cursor of each corner hit area and drawn corner is `resizeCursor(corner, rotation)` at 0°, 30°
   and 90° (extend the existing cursor table near ~1162).
6. A press just outside a corner of a selected 8 × 8 table, on the corner's diagonal, lands on that
   corner's hit area (`elementFromPoint`); a press just inside the corner lands on the table's button.
7. Every corner hit area of a corner table turned 0–345° in 15° steps stays inside the grid: extend
   the it.each at ~2455 and the "draws the turn arrow of a selected table at the grid's corner"
   case (~2391) to the corners. Extend "writes a selected refused table's reason below every side dot
   at every turn" (~1565) to the corners.

Then implement: a `#cornersFit(t)` decision as in "Decisions", read once with the margin, and the
corners rendered in `#renderHitAreas` and `#renderHandles`, with CSS that reads tokens only
(`packages/ui/src/no-hardcoded-chrome.test.ts` must stay green). Rewrite the comments above
`.resize-handle` and `#renderHitAreas` only if they become untrue.

Also run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-plan-canvas.a11y.test.ts
src/no-hardcoded-chrome.test.ts`. The a11y file's "a selected table with its handles" and "a
selected table at the top-left corner with its handles" cases must cover a table that draws corners
in both themes — if their fixtures are under 4 squares either way, add one at 8 × 8 rather than
changing theirs.

## Task 3 — Canvas: dragging a corner

Files: as Task 2, plus `wt-floor-plan-canvas.view.test.ts`.

Test first:

1. Dragging the bottom-right corner of an unturned 8 × 4 table at (10, 10) by (24, 12) px sends one
   `wt-table-resize` at release equal to `resizeFromCorner(p, "bottom-right", 2, 1)`, nothing before
   it, and no `wt-table-move`; the table is drawn at the new size before release (follow "dragging the
   right dot sends one resize at release, from resizeFrom").
2. On a table turned 90° the corner follows the table's own sides: a drag along the screen's x that is
   along the table's own height changes only the height (follow "a turned table's dot resizes along
   the table's own side").
3. The size badge shows under the table while a corner is dragged; the viewport and page cursor
   are the corner's `resizeCursor` during the drag and are put back after it, and after a disconnect
   mid-drag (follow the side-dot cursor cases ~1220–1260).
4. A corner drag that ends where it began sends nothing; a pointer cancel puts the size back and
   sends nothing; a second pointer cannot take it over (follow ~1657–1720).
5. A corner drag whose table shrinks below the corner size keeps its four corners drawn until the
   release (the decision is taken from the placement the drag began with), and the next draw after
   the parent applies the change shows side dots only.
6. View (`wt-floor-plan-canvas.view.test.ts`): at twice the zoom a corner drag of 48 screen px changes
   two squares each way (follow "at twice the zoom a resize changes two squares for 48 screen
   pixels"); a touch on a selected table's corner hit area resizes, and on an unselected table's
   place pans (follow the side-dot touch cases there, if any; otherwise the move-drag ones).

Then implement: `Grab` gains `{ kind: "corner"; corner: PlanCorner }` (or a `handle` that is a side
or a corner — whichever touches fewer lines), `resizing` holds that handle, and `#onPointerMove`
projects the movement onto the corner's two sides' `outward` directions and calls
`resizeFromCorner`. Keyboard handling does not change (Decisions).

## Task 4 — Canvas: the turn arrow above the top-centre dot, and the margin it needs

Files: as Task 3.

Test first:

1. With `--wt-tap-min` 50 px and `--wt-space-1` 6 px on the host, the arrow is at least 50 px square,
   centred horizontally on the table's top side (within 1 px), its bottom edge
   `--wt-space-5 / 2 + --wt-space-1` above that side, turned with the table at 0°, 30°, 90° and 180°.
   This replaces "draws the handle at least a tap target square, off the table's top-right corner"
   (~708) and "draws the handle at the table's own top-right corner turned %i°" (~727): replace the
   `turnedCorner` helper with one for the top-centre position and keep every other assertion those
   cases make (tap size, icon drawn).
2. The arrow's box overlaps no corner hit area and no side hit area of an 8 × 8 and of a 2 × 2 table
   at 0° and 30° (rectangles compared in the frame's own axes, or by sampling `elementFromPoint`
   across the arrow's box: every sample is the arrow).
3. Margin from the tokens ("keeps room round the grid's corner for the turn arrow, from the tokens",
   ~2446): still 72 px at the shipped tokens; with `--wt-tap-min` 68 px, 96 px (was 108 px:
   `ceil(hypot(12 + 4 + 68, 34) / 12) = 8` squares). Watch it fail first.
4. The it.each at ~2455 ("keeps the whole turn arrow of a corner table turned %i° inside the grid")
   and "draws room for a turned table at the grid's origin, so reveal brings all of it into view"
   (~1888, its `turnedCorner(…, 26)` → the new position) pass with the new arrow; the zoomed-out
   view cases ("zoomed-out handles at the plan's corner remain inside the grid", ~469) too.
5. Dragging the arrow still turns the table round its own centre ("the handle turns by how far the
   pointer goes round, wherever it was pressed" passes unchanged).

Then move the arrow in CSS (`left: 50%`, a `translate` of −50% on its own axis, `bottom` as above,
all in `--wt-plan-control-scale`) and change the `reach` computation in `willUpdate`
(`wt-floor-plan-canvas.ts:457–466`) to the new formula with its comment.

Changed test checks expected in Tasks 2–4 (list each in the PR's "Changed test checks", before →
after, with "A672 point 2" as the reason): the two arrow-position cases at ~708 and ~727 and their
`turnedCorner` helper; the arrow expectation in ~1888; the 108 px margin in ~2446; the tokens case at
~372 gaining the corner. Any other existing check that fails is a STOP: report it, do not edit it.

Mutation, once after this task:
`gtimeout 2700 pnpm --filter @waitron/ui exec stryker run --mutate src/components/wt-floor-plan-canvas.ts`.
A survivor on a line this branch added or changed gets a test, or a PR line saying why none can
tell it apart.

## Task 5 — LOOK, docs, backlog

1. LOOK, in real Chromium through the dashboard editor: a throwaway test beside
   `apps/dashboard/src/screens/floor-plan-editor.a11y.test.ts`, mounting the editor with its `open`
   helper and stub api, a plan holding an 8 × 8 table, an 8 × 4 table turned 30° and a 2 × 2 table.
   For each of light and dark and each of `page.viewport(390, 844)` and `page.viewport(1280, 800)`:
   select each of the three in turn and `page.screenshot` the canvas to
   `__screenshots__/look/a672-<table>-<theme>-<width>.png` (a path relative to the test file;
   `/tmp` is refused). Read `window.innerWidth` inside the test and put the widths measured in the
   report. Copy the 12 pictures to `~/waitron-campaign-b/a672-shots/` and delete the throwaway test.
   Check against the A671 mockup: square corners, round side dots, the arrow above the top dot and
   clear of everything; the 2 × 2 exactly as today but for its arrow.
2. `docs/developers/design-system.md`: the `wt-floor-plan-canvas` row of the component table (~677)
   gains the parts `resize-corner` and `resize-corner-handle`; the paragraph at ~682 changes the
   margin's formula to the new reach; the paragraph at ~705–717 moves the turn arrow to "centred
   above the table's own top side, past the top dot's hit area by `--wt-space-1`", adds the corners
   (look, hit area, the size from which they show and that smaller tables keep four side dots and no
   corners, what a corner drag does at the grid's edge), and says the keyboard has no corner: Shift
   with the arrow keys still moves only the right and bottom sides.
3. `docs/backlog/till.md` A672: delete point 2. Points 1 and 3 stay, each with its reproduction in
   one or two sentences and "owner question asked 2026-10-16". Move the open small-table handles
   decision into A562's entry ("…and how a small table shows its handles: today, and after A672,
   a table under 4 squares either way has four side dots and no corners; drawings in
   `mockups/a672-floor-plan-canvas/`"). `docs/backlog.md`: shorten A672's index line to points 1 and
   3, and A562's to mention handles. Add a short entry beside "Resizing a floor plan table needs a
   pointer or a keyboard": "No key moves a floor plan table's top or left side or a corner; Shift
   with the arrow keys moves its right and bottom sides. Left open by A672." Change "Small floor plan
   canvas details: `reveal` does not count the side dots" to "…the side dots or the corners" if
   `reveal` still counts neither.

Checks for the branch: the four focused files above;
`pnpm --filter @waitron/ui exec vitest run src/no-hardcoded-chrome.test.ts src/tap-target-and-focus.test.ts`;
`pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-editor.test.ts src/screens/floor-plan-editor.a11y.test.ts`
(the canvas inside the editor); `pnpm exec vitest run scripts/style-token-names.test.ts
scripts/screenshot-paths.test.ts`; `pnpm --filter @waitron/ui typecheck`; `pnpm --filter @waitron/ui lint`;
`pnpm format:check`. Package coverage (98/98/98/95) and the ui mutation floor are CI's
(`test-ui` coverage on the PR; the nightly `mutation-ui` matrix): read that job's result on the
head before calling the branch green.
