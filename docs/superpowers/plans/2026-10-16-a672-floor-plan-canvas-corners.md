# A672 — The floor plan editor's canvas: the top-left edge, corner handles, and turning at the edge

Spec: backlog entry A672 (`docs/backlog.md`) and its detail in `docs/backlog/till.md`
("## A672."), points 1–3; A562 in the same file (a 2 × 2 table's name hidden under its handles)
and A561 which it points to. Mockups: `docs/backlog/mockups/a671-floor-plan-editor-panel/2-table-selected.png`
(square corner handles, round side dots, the turn arrow above the top-centre dot; the owner-approved
look) and the drawings the owner answered from, `docs/backlog/mockups/a672-floor-plan-canvas/`
(`q2-b-corners-always.png`, `q3-b-table-steps-in.png`).

**This plan builds all three points as the owner decided on 2026-10-16** (answers below). It
replaces the first version of this plan (f7b137591), which built only point 2's part that needed
no decision.

Review path: FULL. `packages/ui`'s canvas and geometry are mutation-tested, and the `wt-table-rotate`
event that `apps/dashboard` reads gains two fields (a contract between packages). No server
change, no stored record, no migration: every x and y the canvas sends stays a whole number from
0 to 999, which is what `checkPlacement` (`apps/server/src/floor-plan.ts:173–189`) and the
database checks (`packages/db/src/schema/floor-plans.ts:58–59`) accept.

## The owner's answers (2026-10-16; decisions, not to be asked again)

- **Q1, the top-left edge** (the owner's own variant of option b): no grid is drawn in the margin
  above and left of the plan, so the plan's edge is where the grid ends; no shading either. The
  handles and the turn arrow may sit in that blank margin. A turned table stops at, and grows
  from, its DRAWN (turned) outline, not its unturned corner: it goes right up to the edge and can
  grow in every direction that does not cross it. Saved positions do not shift, the plan does not
  grow up or left, and x and y stay within 0–999.
- **Q2, handles on a small table: (b).** Every table gets the four corner handles, and a side keeps
  its dot only if that side is at least 4 squares long. A 2 × 2 shows just its four corners; a
  2 × 6 keeps the dots on its long sides. Handles sit on the table as drawn in
  `q2-b-corners-always.png`, not outside it.
- **Q3, turning a table at the top-left edge: (b).** The turned table steps in from the edge by the
  part that poked out; nothing else moves; no scroll bars. The same rule settles the open backlog
  entry "An arrow-key turn that makes a corner table poke further out still shifts the other
  tables a square": only the turned table moves.

## Words used below

- **Placement**: a table's stored x, y, width, height, shape and turn, in whole grid squares. x and
  y are the table's UNTURNED top-left corner.
- **Drawn outline**: the upright box round the table as drawn, turn included — `rotatedRect`
  (`packages/ui/src/floor-plan-geometry.ts:41–61`). It is fractional for most turns.
- **Pokes out**: the drawn outline's left is below 0 or its top is below 0.
- **Starting placement**: the table's placement when a gesture began — `drag.table.placement`
  for a pointer drag, `t.placement` for a key press. The canvas never changes it during a gesture
  (`#onPointerMove` reads it at `wt-floor-plan-canvas.ts:914`).
- **Step in**: move a table right and down by whole squares so it no longer pokes out.

## What the reproductions found

Throwaway probes, kept outside the repository in `~/waitron-campaign-b/a672-probe/`.

**Before the answers (2026-10-16, real headless Chromium, `packages/ui`).**

- **Point 1.** A 600 × 360 canvas, one selected table at x 0, y 0. Unturned 8 × 8: drawn 72 px
  (6 squares, the turn arrow's `#margin`) from the grid's top and left; the point 6 px inside the
  grid's corner is bare grid. A drag of 60 px up and left draws it 0 px further and sends nothing.
  An 8 × 4 table turned 90° at x 0, y 0 is drawn 96 px from the left and 72 px from the top; all
  four of its dots dragged outwards send nothing, and so do Shift+ArrowRight and Shift+ArrowDown:
  at that turn every growth moves the unturned corner below 0 (`resizeFrom`,
  `floor-plan-geometry.ts:108–120`, refuses at line 116). Cause: moves clamp the UNTURNED corner at
  0 (`clampToGrid`, `floor-plan-geometry.ts:37–39`, called at `wt-floor-plan-canvas.ts:783–784`
  and `:917–918`), while the canvas draws `#margin` squares of grid beyond it
  (`wt-floor-plan-canvas.ts:451–500`, the margin at `:457–466`).
- **Point 3.** A table at x 0, y 0 on an empty plan turned 15° clockwise by dragging its turn arrow:
  the grid's scroll box overflows by 12 px across and 12 px down from the first frame after the
  pointer moved, and still overflows 10 frames after the release. Cause: during a drag,
  `willUpdate`'s `hold === "drag"` branch (`wt-floor-plan-canvas.ts:472–477`) grows `#origin` and
  the grid by the square the turned table now pokes out, and `updated` scrolls that square away
  (`:717–722`); after the release the hold keeps the room until the next change (`#holding`,
  `:504–516`). The keyboard path instead moves the whole plan a square (the open backlog entry).

**For this revision (2026-10-16).**

- **P-A, the blank margin, real Chromium** (`a672-probe-rev.test.ts`). A canvas with an 8 × 8
  table at (2, 3) and an 8 × 8 turned 30° at (20, 0). Measured, then measured again after adding
  to the shadow root `.grid { padding: 72px 0 0 72px; background-origin: content-box;
  background-clip: content-box }` and `.viewport { background-color: var(--wt-color-surface) }`:
  both tables' offsets from the grid's corner (`96,132` and `294.43,78.43`), the grid's size
  (`600x360`), the overflow (`0,0`), the grid's computed `background-size` (`12px 12px, 12px 12px`)
  and `background-color` (`rgb(255, 255, 255)`) were the same before and after; the computed
  `background-clip` changed from `border-box, border-box` to `content-box, content-box`; the point
  6 px inside the grid's corner was still the grid element (so a click there still clears the
  selection). The picture (`rev-shots/margin-blank.png`) shows a blank margin and grid lines
  starting at the plan's edge. The canvas's base styles make every element `border-box`
  (`packages/ui-core/src/base-styles.ts:5–9`), which is why padding did not grow the grid.
- **P-B1, a turn drag, real Chromium.** An 8 × 8 table beside T2 at (9, 0), turned 0° → 15° by
  dragging its arrow, with the parent applying the turn. Started at (0, 0) (the control, today's
  case): overflow `12,12` scrolled `12,12` during the drag. Started at (1, 1), where the turned
  table is wholly inside: no overflow in any frame, T2 moved 0 px. The draft's origin room depends
  only on the drafts' drawn outlines (`willUpdate`, `:468–469`), and a table stepped in from
  (0, 0) to (1, 1) has the same drafted outline as one that started at (1, 1).
- **P-B2, an arrow-key turn, real Chromium.** An 8 × 8 at (1, 1) turned 15°, T2 at (20, 0);
  ArrowRight on the turn arrow. Parent applies the turn only (today, the control): T2 moved
  12 px right and 12 px down — the backlog entry. Parent applies the turn with x 2, y 2 (what this
  plan sends): T2 moved 0 px, no overflow.
- **The edge rule, computed** (`edge-rule.mjs`, `corner-rule2.mjs`, Node, outside the repo). A model
  of the rule in Decisions 1–2 beside a copy of today's `resizeFrom`:
  - Of today's ten `resizeFrom` checks in `floor-plan-geometry.test.ts`, one changes (listed under
    "Changed test checks expected"); every table at (10, 10) at 0°, 30°, 45°, 90°, 180°, 225° and
    270°, every side, ±1–3 squares, gives today's answer, and away from the edge each growth's
    reverse puts it back.
  - The lowest place an unturned-start move can reach, by turn: 8 × 8 at 15° → (1, 1), drawn left
    0.10; at 30° → (2, 2), 0.54; at 45° → (2, 2), 0.34. 8 × 4 at 75° → (0, 3), drawn left 1.03
    (x is already 0). 8 × 4 at 90° → (0, 2), drawn left 2.00 (the gap). 99 × 99 at 45° → (21, 21),
    0.50.
  - A one-square growth from a table placed as near the top-left edge as whole squares allow (8 × 4,
    4 × 8, 3 × 5, 6 × 6 and 2 × 7, every 15°, every side): 290 growths are taken with the step-in
    rule; 116 of those would be refused if a growth whose ROUNDED outline pokes out were refused (a
    dead first square). With step-in, the largest move of the opposite side's midpoint was
    0.933 squares (a 6 × 6 at 30°, top side).
  - At the edge a growth and its reverse need not cancel, and one growth of n squares need not equal
    n growths of one. An 8 × 4 turned 90° at (0, 5), its left-facing (bottom) side: +3 in one go
    gives (0, 4) 8 × 6; three +1 growths give (0, 2) 8 × 7, drawn left 0.5; a fourth (8 × 8, which
    rounding would place touching the edge exactly) is refused because its exact outline crosses;
    +3 then −3 gives (2, 6) 8 × 3, not the start. The fresh-context plan review found these
    (`~/waitron-campaign-b/a672-plan-review/`) and this plan's model gives the same numbers
    (`review-check.mjs`).
  - Turning by the arrow keys walks a corner table away from the edge: one full turn, 24 presses of
    ArrowRight with each change applied, from (0, 0) ends an 8 × 8 at (2, 2), a 20 × 4 at (1, 9) and
    an 8 × 4 at (1, 3), all back at 0° (`review-check.mjs`; the plan review found the same).
  - At the 999 limit (`review-check.mjs`, `corner-rule2.mjs`): `resizeFrom(T(999, 10, 8, 4, 90),
    "top", 1)` answers it unchanged (x would be 999.5, rounded to 1000); the shrink
    `resizeFrom(T(999, 10, 8, 4, 90), "right", −1)` answers (999, 9) 7 × 4 (x would be 1000, held to
    999); `resizeFromCorner(T(999, 10, 8, 4, 90), "top-left", 0, 1)` answers it unchanged; the
    shrink `resizeFromCorner(T(999, 10, 8, 4, 90), "bottom-right", 0, −1)` answers (999, 11) 8 × 3.
  - The corner rule at (20, 20), every 15°, every corner, −3…3 each way: the opposite corner moved
    at most 0.500 squares, and every growth's reverse put the table back (away from the edge).
- **Hit areas, computed** (`hit-areas.mjs`, Node; not a browser measurement). In the table's own
  frame (a turn moves every control together), with the shipped tokens (`--wt-space-1` 4 px,
  `--wt-space-3` 12 px, `--wt-space-5` 24 px, `--wt-tap-min` 44 px:
  `packages/ui-core/src/tokens/structure.css:2–29`) and the drawing order in Decision 5, the area
  where each control is the topmost: 1 × 1 — corners 162, 249, 249 and 335 px²; 2 × 2 — each corner
  335 px²; 2 × 6 — left and right dots 222 px² each, each corner 335 px²; 4 × 4 and 8 × 8 — each dot
  222, each corner 335. At twice the control size (zoomed out to half), every control still has an
  area (smallest: a 4 × 4's dots, 198 px² each). The turn arrow overlaps no hit area at either size.

## Decisions taken here (recorded in the PR)

### 1. One placement rule for the drawn outline

- **The helper.** `stepInside(p, from = p)` in `floor-plan-geometry.ts`, beside `clampToGrid`:
  `p` moved right and down by the fewest whole squares that put x and y at 0 or more and its drawn
  outline's left and top at or past the **floor**, where the floor is 0, or, for a table that
  already poked out at its starting placement `from`, how far it poked out then
  (`floor.x = min(0, rotatedRect(from).x)`, the same for y). In numbers:
  `x' = max(0, p.x + max(0, ceil(floor.x − rotatedRect(p).x − 1e-9)))`, the same for y. The 1e-9
  is the tolerance `willUpdate` already uses for a corner computed to land exactly on the edge
  (`wt-floor-plan-canvas.ts:467–469`), so the two agree on what "inside" means.
- **Why the floor is not always 0.** A table can arrive already poking out: one saved before this
  branch (the canvas let a turn push a corner table out, the reproduction above), or one written
  by another path, since the server accepts any turn at x and y 0–999 (`checkPlacement`,
  `floor-plan.ts:173–189`). The owner said saved positions do not shift. With a floor of 0, a
  1-pixel wobble of a mouse click on such a table would move it up to 21 squares (99 × 99 at 45°,
  computed). So no gesture takes a table further out than it was when the gesture began, and a
  table that was inside stays inside. The canvas keeps drawing room for a table that arrives
  poking out (the overhang term of `#origin`, `:468–469`), unchanged.
- **Never above 999.** `stepInside` raises x only while the drawn left is below 0, which needs
  x below half the difference between the drawn and unturned widths, at most 21 (99 × 99 at 45°,
  computed). So it needs no upper clamp; do not add one (a mutant there could never be killed).
- **"Right up to the edge", exactly.** x is the least whole number of 0 or more at which the drawn
  left is at or past the floor. So the drawn left ends up less than one square from the edge
  whenever x is above 0 (8 × 8 at 30°: x 2, drawn left 0.54). When x is 0 the drawn left is
  whatever the turn leaves: the **gap** of a table whose turned outline is narrower than its
  unturned box (8 × 4 turned 90°: drawn left = x + 4 − 2 = x + 2, so 2 squares at x 0; 8 × 4 at
  75°: 1.03). Reaching the edge there needs x below 0, which the owner ruled out ("x and y stay
  within 0–999"). The canvas keeps the gap; no migration, no server change. An owner question
  offering a later follow-up is drafted at the end of this plan.
- **Moves** (pointer drag, `wt-floor-plan-canvas.ts:917–918`, and the plain arrow keys,
  `:783–784`): `stepInside({ ...p, x: clampToGrid(…), y: clampToGrid(…) }, p)`, with `p` the
  starting placement. `clampToGrid` itself does not change: the dashboard
  (`apps/dashboard/src/screens/floor-plan-draft.ts:219–220`) and the till
  (`apps/till/src/state/floor-today.ts:310–311`) call it too.
- **Resizes** (`resizeFrom`, and the new `resizeFromCorner`): Decision 2.
- **Turns** (pointer drag on the arrow, `:931–935`, and its arrow keys, `#onHandleKey`,
  `:809–818`): Decision 3.
- **Right and bottom.** Unchanged: there is no drawn edge there. The grid always reaches 8 squares
  past the furthest drawn outline (`gridExtent`, `floor-plan-geometry.ts:157–168`) and grows while a
  table is dragged right or down (test "the grid grows while a table is dragged right and down");
  x and y stop at 999 through `clampToGrid` and through `resizeFrom`'s range check, as today.

### 2. Growth at the drawn edge: taken, then stepped in

- **The rule** (`resizeFrom` and `resizeFromCorner`). For each candidate growth, from the size
  asked down towards no change, as today: compute the **ideal** placement (the exact, fractional
  x and y that keep the opposite side's midpoint, or the opposite corner, exactly where it is
  drawn) and the **rounded** one (today's `roundShift`, half a square going away from zero, so a
  growth and its reverse cancel). Refuse the candidate if the ideal placement's drawn outline
  crosses the floor (that growth crosses the edge), or if the rounded x or y is above 999.
  Otherwise answer `stepInside(rounded, p)`. A shrink is always taken: its x and y are held to 999
  and then stepped in.
- **Why not refuse a growth whose rounded outline pokes out.** With whole-square positions, a
  turned table growing by an odd number of squares moves its centre half a square, and rounding can
  leave the outline poking out by up to half a square even though the growing side moves away from
  the edge. Refusing those would leave a dead first square: 116 of 290 one-square growths at the
  edge (computed, above). Stepping in takes every one.
- **The promise, as now worded** (the doc comment on `resizeFrom` and `docs/developers/design-system.md`):
  "keeps the opposite side's midpoint's x and y each within half a square of where it is drawn;
  where that would put the table past the plan's top or left edge, or x or y below 0, the table
  steps right or down by the fewest whole squares that keep it inside." In practice: under one
  square at the drawn edge (largest computed 0.933); and for a table with a gap at x 0 (or y 0),
  a slide away from the edge whose size depends on the table's size and turn, because x cannot go
  below 0. Measured 2026-10-16 with `resizeFrom`, each beside the same growth away from the edge:
  an 8 × 4 turned 90° at (0, 5), its down-facing side grown 3, gives (0, 7) and its drawn left
  moves from 2 to 3.5, where at (10, 5) it gives (8, 7) and moves from 12 to 11.5; a 10 × 1 turned
  45° at (0, 10), its right side grown 4, gives (0, 11) and its drawn left moves from 1.11 to 1.70,
  where at (20, 10) it gives (19, 11) and moves from 21.11 to 20.70.
  Today the 8 × 4 could not grow its down-facing side at all (the reproduction above).
- **At the edge, growth is not reversible square for square.** Away from the edge a growth and its
  reverse put the table back (today's `roundShift` promise, kept). At the edge they need not, and
  one growth of n squares need not equal n growths of one: the 8 × 4 turned 90° at (0, 5) numbers
  above (+3 at once gives 8 × 6, three +1 give 8 × 7, +3 then −3 gives (2, 6) 8 × 3). Task 1 pins
  both; the owner question says so.
- **The corner drag** keeps the first plan's rule — it moves the two sides that meet at the corner
  by how far the pointer went along each side's own outward direction, and keeps the opposite
  corner's x and y each within half a square — with the edge part replaced by the rule above: of
  the growths up to the one asked, the largest whose ideal outline does not cross the floor (most
  squares added, a tie keeping more width), then stepped in. A side that shrinks is always taken.

### 3. The turn at the edge (Q3)

- **The rule.** A turn's placement is `stepInside({ ...p, rotation }, p)`, with `p` the starting
  placement. A pointer drag works it out again from `p` at every pointer move (`#onPointerMove`
  already does so for the turn, `:931–935`), so the step-in shows LIVE during the drag, the table
  does not jump on release, and turning back within the same drag puts it back where it began. The
  arrow keys use the same rule from `t.placement`. Examples (computed): an 8 × 8 at (0, 0) turned to
  15° → (1, 1); then to 30° → (2, 2); a 20 × 4 at (0, 0) turned to 90° → (0, 8); an 8 × 8 at
  (10, 10) → unchanged.
- **Turning by key walks a corner table away from the edge, and turning back never steps it out
  again.** This follows from the owner's Q3 answer (b), "the turned table steps in … nothing else
  moves": each press steps in from where the last one left it, and a step is only ever inwards, so
  a table at the edge drifts away as it is turned round: one full turn of 24 presses from (0, 0)
  ends an 8 × 8 at (2, 2), a 20 × 4 at (1, 9) and an 8 × 4 at (1, 3) (computed, above). A pointer
  drag works from the place the press began, so turning back within one drag puts the table back.
  Task 4 pins the key case; the owner question at the end says so.
- **The angle** is still measured round the table's centre where the press began
  (`drag.centreX/centreY`, `:888–889`), so the turn depends only on where the pointer is, and a
  step-in cannot feed back into the angle. The table, and its arrow with it, moves under the
  pointer by the step (8 squares for the 20 × 4 above); the LOOK task checks how that reads.
- **The event.** `wt-table-rotate` carries `{ key, rotation }` today (`TableRotate`,
  `wt-floor-plan-canvas.ts:64–67`; sent at `:992–997`). It grows to `{ key, rotation, x, y }`, always
  — the table's place after the turn — so a reader never has to ask whether the fields are there.
  Two events (a turn and a move) would make two Undo steps in the editor, the first undo leaving the
  table poking out. The dashboard's handler spreads the detail into `changePlacement`
  (`floor-plan-editor.ts:920–924`; `changePlacement` merges a `Partial<PlanPlacement>`,
  `floor-plan-draft.ts:193–201`), so **no dashboard source changes**; one dashboard test is added
  (Task 4). `#keyHold` is given the stepped placement, so its "after" layout is the one the parent
  applies.
- **Nothing else moves, no scroll bars.** No code in `willUpdate`, `#holding` or `updated` needs to
  change for this: a draft that never pokes out further than its starting placement never grows the
  origin room (P-B1, P-B2). The `hold === "drag"` branch stays, because it still keeps the grid from
  shrinking under a table dragged back from the right or bottom, and still holds the room of a table
  that arrived poking out. **That path is kept (the driver's call) and gets a required test in
  Task 4.** The plan review replaced the drag branch's `x = Math.max(this.#origin.x, x)` with
  `this.#origin.x` in a throwaway apply of Tasks 1, 3, 4 and 5: all 18 room-related checks still
  passed with this plan's new values, because no canvas gesture grows the room any more, so neither
  coverage nor those checks would notice the path breaking. The one way left to reach it is a parent
  setting a poking-out table while a drag is under way.
- **Overlap.** Stepping in can put the turned table over another; it is drawn overlapping, as a move
  can be today. Nothing in the editor refuses or avoids overlap: canvas moves never look at other
  tables (`:916–922`), `placeTable` places "as given, overlaps included"
  (`floor-plan-draft.ts:203–204`), and the server checks only ranges (`floor-plan.ts:173–189`).
  The owner's drawing `q3-b-table-steps-in.png` shows the stepped-in table touching T2.

### 4. No grid in the margin (Q1)

- The margin stays (the arrow and handles need room to draw in it) and keeps today's size rule
  (Decision 7). It is drawn blank: `.grid` gets `background-origin: content-box;
  background-clip: content-box`, and its inline style gets `padding-top` and `padding-left` equal to
  `#origin` (the margin plus any overhang), in px of the unzoomed grid as `#frameStyle` uses. The
  surface colour is also set on `.viewport` (`background-color: var(--wt-color-surface)`); keep it
  on `.grid`. The clipped margin then still shows the surface. The grid lines then start at the plan's x 0 and y 0, and
  the first line is the plan's visible edge (P-A). Tables, handles and reasons are positioned from
  the grid's padding edge as before, so none moves (P-A).
- **Tests pinning the margin's drawing:** none fails. "fills the visible area with grid when there
  are no tables" reads the grid's `background-size`, and "paints from tokens" its
  `background-color` and `background-image`; P-A measured those unchanged. The view test "a
  zoomed-out grid keeps a screen pixel for each line and a full-size turn symbol" reads the
  `background-image` stroke, which does not change.
- **Docs.** `docs/developers/design-system.md` describes the margin (~682–686: "keeps a margin … so
  a selected table's handles stay inside the grid at x 0 and y 0 … A turned table reaching past the
  top or left edge gets extra squares") and the move rule ("never below 0", ~690): both change
  (Task 9). The A671 mockup (`2-table-selected.png`) draws no margin at all; it is left as it is.

### 5. Corners on every table (Q2)

- **Names, unchanged from the first plan.** `PlanCorner = "top-left" | "top-right" |
  "bottom-right" | "bottom-left"`, drawn in that order. The drawn corner is part `resize-corner`;
  its hit area is part `resize-corner-handle`; each carries `data-corner`. The side parts keep their
  names (`resize-dot`, `resize-handle`), so every `[part~="resize-handle"]` selector still finds
  only sides.
- **Look, unchanged.** A corner is a filled `--wt-color-primary` square `--wt-space-3` across,
  turned with the table, on the table's own corner (as `q2-b-corners-always.png` draws it), with no
  border and no change while dragged. Its hit area is a `--wt-space-5` round area centred on the
  corner. Every size reads a token and scales by `--wt-plan-control-scale`. A round table's
  corners sit on its box's corners, as its side dots sit on its box's sides.
- **Which handles.** Every selected table draws four corners. A side draws its dot and hit area only
  when that side is at least 4 squares long: the top and bottom when the width is at least 4, the
  left and right when the height is. Judged in squares (the owner's words), from the starting
  placement (`t.placement`, never the draft), so a dot never disappears under the pointer during a
  drag. A constant `SIDE_DOT_MIN_SQUARES = 4` in the canvas. Nothing is read from styles for this,
  so the first plan's `#cornersFit` and its read of `--wt-space-5` are not built.
- **Who takes a press where things overlap.** Bottom to top: the side hit areas, then the corner
  hit areas (both in the frame drawn before the table's button, as the side hit areas are today,
  `#renderHitAreas`, `:667–682`), then the table's button, then the turn arrow (in the frame drawn
  after the button). So inside the table the table takes the press; outside it a corner beats a side
  where the two overlap. At the shipped tokens they never overlap at the original zoom: a side with
  a dot is at least 48 px long, so its dot is at least 24 px from each corner, the two radii added.
  Zoomed out they can, and the corner wins there. Corners of a 1 × 1 overlap each other; the later
  one wins, and each keeps its own outward quarter (computed areas, above).
- **Every handle is still pressable** (computed, above): each corner of a 1 × 1, 2 × 2 and 2 × 6 has
  at least 162 px² where it is topmost; a 2 × 6's dots 222 px² each. The turn arrow (Decision 6)
  sits `--wt-space-1` beyond the furthest any hit area reaches, at every size and turn.
- **The refused-reason and size badge stay where they are** (`--wt-space-5 / 2 + --wt-space-1`
  below the drawn outline, `:617–633`, `:685–694`), which clears every corner's round hit area:
  the lowest corner is on the outline's bottom, and its circle reaches `--wt-space-5 / 2` below it. A
  test of that must compare with the circle (the corner's centre plus half `--wt-space-5`), NOT the
  hit area's `getBoundingClientRect`: the hit area's box turns with the table, so at 30° and 45° its
  upright bounding box reaches 16.4 px and 17.0 px below the corner (24 px × (cos + sin) / 2), past
  the reason's 16 px.

### 6. The turn arrow above the top-centre dot (unchanged from the first plan)

Centred on the table's own top side (turning with it), its bottom edge `--wt-space-5 / 2 +
--wt-space-1` above that side, so it is clear of the top dot's hit area and both top corners' hit
areas at every table size. Same `--wt-tap-min` square, icon, focus ring, name and behaviour.

### 7. The margin follows the arrow (unchanged from the first plan)

`#margin` keeps "the arrow's furthest reach past the table's turned box, in whole squares, enlarged
when zoomed out". The furthest point of the arrow from the top side's midpoint is
`hypot(--wt-space-5 / 2 + --wt-space-1 + --wt-tap-min, --wt-tap-min / 2)` (63.9 px at the shipped
tokens; 6 squares, as today), and that midpoint is never outside the turned box. Rewrite the comment
at `wt-floor-plan-canvas.ts:459–460` to that reason.

### 8. Cursors, and no keyboard corner

- `outward` and `resizeCursor` take a side or a corner; a corner's outward direction is the sum of
  its two sides' outward directions, normalised, so an unturned top-left or bottom-right corner gives
  `nwse-resize` and the other two `nesw-resize`, turning with the table.
- **No keyboard corner is built here (the driver's decision, 2026-10-16).** Spec point 2 says
  "Shift+arrow resizing … need[s] the corners too"; this branch defers that part, and the PR says so.
  Shift+arrow resizing keeps moving the table's own right side (ArrowRight/ArrowLeft) and bottom side
  (ArrowDown/ArrowUp) only (`RESIZE_KEYS`, `:106–111`), now following the edge rule through
  `resizeFrom`. Shift+ArrowRight and Shift+ArrowDown already reach every size a bottom-right corner
  drag reaches. No key moves the top or left side or a corner, before or after this branch; that gap
  becomes a backlog entry (Task 9).

## Task 1 — Geometry: the edge rule for moves and side resizes

Files: `packages/ui/src/floor-plan-geometry.ts`, `packages/ui/src/floor-plan-geometry.test.ts`.
Rough size: 30–50 tool calls.

Test first (`pnpm --filter @waitron/ui exec vitest run src/floor-plan-geometry.test.ts
src/components/wt-floor-plan-canvas.test.ts src/components/wt-floor-plan-canvas.view.test.ts` —
the canvas files too, because the canvas calls `resizeFrom`):

1. `stepInside` on a table already inside (8 × 8 at (10, 10), any turn) answers it unchanged.
2. From an unturned start, the lowest place by turn: `stepInside({ ...T(0, 0, 8, 8), rotation: r },
   T(0, 0, 8, 8))` gives (0, 0), (1, 1), (2, 2), (2, 2) for 0°, 15°, 30°, 45°; 8 × 4 at 90° gives
   (0, 2) (the gap: drawn left 2); 99 × 99 at 45° gives (21, 21). Assert the drawn left and top are
   at least 0 and less than 1 wherever x (or y) is above 0.
3. A table that arrived poking out (8 × 8 at (0, 0) turned 45°): `stepInside` of it moved right one
   square, from itself, answers (1, 0) — it may stay as far out as it began, no further; the same
   placement from an unturned start answers (2, 2).
4. A negative x or y from a resize candidate is raised to 0.
5. `resizeFrom` at the drawn edge: a table placed by test 2's rule at 6 × 6 turned 30° (2, 2), top
   side +1 → 6 × 7 at (2, 2) (it stepped in; without the step-in the rounded answer pokes out). An
   8 × 4 turned 90° at (0, 5): bottom +1 → (0, 4) 8 × 5, bottom +3 → (0, 4) 8 × 6 (stops where the
   ideal outline would cross), right +3 → (0, 7) 11 × 4. Write each expected value from the rule
   first, then check it against the model numbers above.
6. Over 8 × 4, 4 × 8, 3 × 5, 6 × 6 and 2 × 7 placed by test 2's rule, every 15°, every side, +1: the
   answer never pokes out, x and y are never below 0, and whenever the ideal outline does not cross
   the edge the size grew (no dead first square). Watch it fail against a version that refuses a
   poking rounded answer.
7. Growing towards the edge is still refused: unturned at (0, 0), left +2 and top +2 answer the table
   unchanged (the existing case); turned 180° at (0, 10), right +1 answers it unchanged.
8. At the edge, not reversible square for square (Decision 2): 8 × 4 turned 90° at (0, 5), bottom +3
   → (0, 4) 8 × 6; bottom +1 three times → (0, 2) 8 × 7 (drawn left 0.5), and a fourth +1 answers
   it unchanged; bottom +3 then −3 → (2, 6) 8 × 3. Rename the existing "undoes a resize with the
   opposite one at %i°" only if its name claims more than "away from the edge" (it runs at (10, 10)).
9. The 999 limit, each expected value written from the rule first: `resizeFrom(table(999, 10, 8, 4,
   90), "top", 1)` → unchanged (x would round to 1000); `resizeFrom(table(999, 10, 8, 4, 90),
   "right", -1)` → (999, 9) 7 × 4 (a shrink is taken, x held to 999).

Then implement `stepInside` (exported, with its rule in one doc comment) and change `resizeFrom` as
in Decision 2, rewording its doc comment to the promise there. Prove tests 2 and 6 by deletion
(drop the step; drop the ideal-outline check; each fails; restore). The existing `resizeFrom` cases
pass except the one listed under "Changed test checks expected".

## Task 2 — Geometry: a corner's direction, cursor and resize

Files: as Task 1. Rough size: 40–60 tool calls.

Test first (same command):

1. `outward(corner, 0)` for the four corners is `(∓√½, ∓√½)` as named; turned 90° the top-left
   corner faces where the top-right did unturned, `(√½, −√½)` (within 1e-9).
2. `resizeCursor` for each corner at 0°, 45° and 90°: unturned top-left and bottom-right
   `nwse-resize`, top-right and bottom-left `nesw-resize`; at 45° the top-left corner points straight
   up, so `ns-resize`. The existing side cases pass unchanged.
3. `resizeFromCorner(p, corner, across, down)` on an unturned 8 × 4 at (20, 20), each (2, 1):
   bottom-right → 10 × 5 at (20, 20); top-left → 10 × 5 at (18, 19); top-right → (20, 19);
   bottom-left → (18, 20); (0, 0) answers `p` itself.
4. For every rotation 0–345 in 15° steps, every corner and every `across`, `down` in −3…3 on an
   8 × 4 at (20, 20): the opposite corner's x and y are each within 0.5 of where they were. Watch it
   fail first against a stub that returns `p` with only the size changed.
5. A growth and its reverse cancel at (20, 20), every rotation and corner.
6. Sizes hold to 1–99.
7. At the edge: unturned at (0, 5), top-left (2, 2) → (0, 3) 8 × 6 (height only; growing left would
   cross); 8 × 4 turned 90° at (0, 2), bottom-right (2, 2) → (0, 2) 10 × 6; top-left (2, 2) → (1, 1)
   8 × 6 (its unturned left side faces up and the drawn top is 0, so only the other side grows);
   unturned at (0, 0), top-left (−2, −1) → (2, 1) 6 × 3 (a shrink is taken). Write each from the
   rule, then check.
8. The 999 limit: `resizeFromCorner(table(999, 10, 8, 4, 90), "top-left", 0, 1)` → unchanged (x would
   round to 1000); `resizeFromCorner(table(999, 10, 8, 4, 90), "bottom-right", 0, -1)` → (999, 11)
   8 × 3 (a shrink is taken, x held to 999).

Then add `PlanCorner`, widen `outward` and `resizeCursor` to `PlanSide | PlanCorner`, and add
`resizeFromCorner` beside `resizeFrom`, sharing the edge step with it. Export nothing new from
`packages/ui/src/index.ts` (the canvas imports the module directly). Prove 4 and 7 by deletion.

Mutation, once, after this task:
`gtimeout 900 pnpm --filter @waitron/ui exec stryker run --mutate src/floor-plan-geometry.ts`.
A survivor gets a test, or a line in the PR saying why no test can tell it apart, when it is on a line
this branch added or changed, OR when the tests that used to catch it were changed by this branch to
new values (re-pointed).

## Task 3 — Canvas: moves stop at the drawn outline

Files: `packages/ui/src/components/wt-floor-plan-canvas.ts`, `wt-floor-plan-canvas.test.ts`,
`wt-floor-plan-canvas.view.test.ts`. Rough size: 40–60 tool calls.

Test first (`pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-plan-canvas.test.ts
src/components/wt-floor-plan-canvas.view.test.ts`):

1. An 8 × 8 turned 45° at (5, 10) dragged 60 px left stops at x 2 (drawn 36 px left of where it
   began) and sends `{ x: 2, y: 10 }`; its drawn left is inside the grid and within one square of
   the plan's edge.
2. The plain ArrowLeft on an 8 × 8 turned 30° at (2, 5) sends nothing (it is at its lowest x); at
   (3, 5) it sends x 2.
3. An 8 × 4 turned 90° at (1, 5): ArrowLeft sends x 0; at x 0 it sends nothing (the gap).
4. A table that arrived poking out (8 × 8 at (0, 0) turned 45°): a mouse press with a 1 px wobble
   and release sends nothing; ArrowRight sends `{ x: 1, y: 0 }` only.
5. No drag in this task's tests changes the viewport's scroll or the grid's size beyond what the
   right/bottom growth gives.

Then change the two move call sites (`:783–784`, `:917–918`) to Decision 1's form. Side drags and
Shift+arrows already follow the rule through `resizeFrom`; add one canvas case: the top dot of a
6 × 6 turned 30° at (2, 2), dragged 12 px along its own outward direction, sends 6 × 7 at (2, 2)
(`resizeFrom(p, "top", 1)`: it stepped in), and the drawn outline never pokes out during the drag.

Update the checks listed under "Changed test checks expected" for Task 3, with their comments; any
other failing check is a STOP: report it, do not edit it.

## Task 4 — Canvas: a turn steps the table in; the event carries x and y

Files: as Task 3, plus `packages/ui/src/components/wt-floor-plan-canvas.ts`'s `TableRotate`,
`apps/dashboard/src/screens/floor-plan-editor.test.ts`. Rough size: 50–70 tool calls.

Test first (the canvas command above, and `pnpm --filter @waitron/dashboard exec vitest run
src/screens/floor-plan-editor.test.ts`):

1. An 8 × 8 at (0, 0) beside T2 at (9, 0), turned 15° by dragging its arrow, with a parent applying
   each change as the editor does (the test file's `applyChanges`, extended to apply x and y): the
   table is drawn at (1, 1) turned 15° before release; release sends `{ rotation: 15, x: 1, y: 1 }`;
   in no frame from the press to 10 frames after the release does the viewport overflow; T2 does not
   move on screen. (P-B1 is this case's measurement.) Watch it fail on today's code.
2. The same drag turned on to 30° and back to 0° within one press: drawn at (2, 2), then back at
   (0, 0); a release at 0° sends nothing.
3. ArrowRight on the arrow of an 8 × 8 at (1, 1) turned 15° sends `{ rotation: 30, x: 2, y: 2 }`; with
   the parent applying it, T2 does not move and nothing overflows (P-B2). This settles the backlog
   entry "An arrow-key turn that makes a corner table poke further out still shifts the other tables
   a square".
4. A 20 × 4 at (0, 0) turned to 90° by one drag is drawn, and sent, at (0, 8). (Six ArrowRight
   presses with the parent applying each end elsewhere — each step starts from the last stepped-in
   place and never steps back out — so this case uses one drag.)
5. A turn of a table that arrived poking out (8 × 8 at (0, 0) turned 30°) back to 15° sends x 0, y 0
   (no step: it is less far out than it began).
6. Stepping in over another table is allowed: an 8 × 8 at (0, 0) beside T2 at (8, 0) turned 15° is
   sent at (1, 1), overlapping T2.
7. **Required — the drag branch's room still grows** (Decision 3), at zoom 1 and at twice the zoom:
   while a table is being dragged, the parent sets another table that pokes out past the plan's top
   or left edge (an 8 × 8 at (0, 0) turned 45°). Keep the assertions the re-pointed cases used to
   make: the room grows, it is scrolled away, the dragged table stays under the pointer, the grid's
   height stays steady in a box that takes its height from the plan (as "a turned table dragged to
   the top keeps a steady height…" checked), and after an undo (the parent setting the earlier layout
   back) no extra room is left (as "%s leaves no extra room once the earlier layout comes back"
   checked). Prove it by the plan review's deletion: replace `x = Math.max(this.#origin.x, x)` (and
   the same for y) in the drag branch with `this.#origin.x`; this test must fail; restore.
8. One full turn by key walks a corner table away from the edge (Decision 3): an 8 × 8 at (0, 0),
   ArrowRight on its arrow 24 times with the parent applying each change, ends at 0° at (2, 2).
9. Shift+ArrowRight on a turned table near the corner (an 8 × 8 at (1, 1) turned 15°), with the
   parent applying the change and T2 at (20, 0): it sends exactly
   `{ key: "t1", x: 1, y: 2, width: 9, height: 8 }`, T2 does not move on screen and nothing
   overflows ("Shift+ArrowRight on a turned table near the corner steps it in, and moves no other
   table"). This and the key-turn tests (test 3 among them) are the evidence for deleting the
   backlog entry "An arrow-key turn that makes a corner table poke further out still shifts the
   other tables a square" in Task 9. (Built in place of a first version, Shift+ArrowDown on an
   8 × 8 at (2, 2) turned 30°, which could not fail.)
10. Dashboard: "a turn from the canvas that steps the table in keeps its x and y, and one Undo puts
   all three back": `fromCanvas(el, "wt-table-rotate", { key: "m1", rotation: 15, x: 1, y: 1 })` then
   `placed(el, "m1")` has rotation 15, x 1, y 1; one Undo restores the earlier placement.

Then: `TableRotate` gains `x: number; y: number`; the turn branch of `#onPointerMove` drafts
`stepInside({ ...p, rotation }, p)` (still comparing only the rotation to decide whether to draw);
`#onPointerUp` sends the draft's x and y with the rotation; `#onHandleKey` computes the stepped
placement once and passes it to `#keyHold` and `#rotate`. `willUpdate`, `#holding` and `updated` do
not change (Decision 3). Update the `#origin` comment (`:362–363`) to say its overhang is for a table
that arrives poking out.

Update the checks listed under "Changed test checks expected" for Task 4; any other failing check
is a STOP.

## Task 5 — Canvas: no grid in the margin

Files: `packages/ui/src/components/wt-floor-plan-canvas.ts`, `wt-floor-plan-canvas.test.ts`.
Rough size: 25–40 tool calls.

Test first (the canvas command above):

1. With a table at x 0, y 0, the grid's computed `padding-left` and `padding-top` equal the table's
   offset from the grid's corner (72 px at the shipped tokens), and its `background-clip` and
   `background-origin` are `content-box, content-box`. Watch it fail first.
2. With a table that arrived poking out (8 × 8 at (0, 0) turned 45°), the padding is the larger
   origin (the margin plus its overhang), so the grid lines still start at the plan's x 0.
3. Token painting: with `--wt-color-surface` set on the host, the viewport's `background-color` is
   that colour (beside the grid's, which "paints from tokens" already checks).
4. A click 6 px inside the grid's corner (in the blank margin) still asks to clear the selection.
5. Zoomed to half (the view test file's `wheel`): the padding still equals the drawn offset of a table
   at x 0.

Then add the two `background-*` lines to `.grid`, the padding to `render()`'s `gridStyle` from
`#origin`, and the surface colour to `.viewport`. Prove 1 by deletion (drop the clip; it fails).
`pnpm --filter @waitron/ui exec vitest run src/no-hardcoded-chrome.test.ts` stays green.

## Task 6 — Canvas: draw the corners, the side-dot rule, and the hit areas (no corner dragging yet)

Files: `packages/ui/src/components/wt-floor-plan-canvas.ts`, `wt-floor-plan-canvas.test.ts`.
Rough size: 50–70 tool calls.

Test first (the canvas command above):

1. A selected 8 × 8 draws four `resize-corner` and four `resize-corner-handle` parts, in the order
   top-left, top-right, bottom-right, bottom-left, in the same frames as the side dots and side hit
   areas (aria-hidden, no tab stop, drawn corners `pointer-events: none`); an unselected table draws
   none; `dots(el)` still finds exactly four on an 8 × 8.
2. Each corner and its hit area is centred on the table's own corner (within 1 px), turned 0° and 30°
   (follow "centres each side dot on its side's midpoint turned %i°").
3. Token painting: extend "paints the side dots, the size badge and the turn arrow from tokens": the
   corner's background is `--wt-color-primary`; with `--wt-space-3` and `--wt-space-5` set on the host
   (as "draws each side dot a hit area of --wt-space-5 round a dot --wt-space-3 across" does), the
   corner is `--wt-space-3` square and its hit area `--wt-space-5`.
4. The rule (Q2): a 2 × 2 draws four corners and no side dot or side hit area; a 2 × 6 draws corners
   and the left and right dots only; a 6 × 2 the top and bottom only; a 4 × 4 all four dots; a 3 × 8
   the left and right only. Watch it fail against side dots drawn always.
5. A side drag that shrinks a 6 × 6's height to 3 keeps its left and right dots drawn until release
   (judged from the starting placement); the next draw after the parent applies it has none.
6. The cursor of each corner hit area and drawn corner is `resizeCursor(corner, rotation)` at 0°,
   30° and 90° (extend the cursor table "shows the dragged dot's arrow over the whole canvas until
   the %s" / the cursor cases beside it).
7. Presses, by `elementFromPoint` on a selected table at 0° and 30°: just outside each corner on its
   diagonal → that corner's hit area; just inside a corner → the table's button; for a 1 × 1, 2 × 2
   and 2 × 6, a point 10 px out along each corner's diagonal and each remaining dot's outward normal
   → that handle (the computed areas above say each exists).
8. Every corner hit area of a corner table turned 0–345° in 15° steps stays inside the grid: extend
   "keeps the whole turn arrow of a corner table turned %i° inside the grid" and "draws the turn
   arrow of a selected table at the grid's corner inside the grid, and reveal shows it" to the
   corners. Extend "writes a selected refused table's reason below every side dot at every turn" to
   the corners, comparing with each corner's circle (its centre plus half `--wt-space-5`), not its
   bounding box (Decision 5).

Then implement: corners rendered in `#renderHitAreas` (after the side hit areas) and `#renderHandles`,
the side-dot rule from `t.placement`, CSS that reads tokens only. Replace "a press just outside a
side of a selected 2 × 2 table turned %i° resizes that side" as listed below. Rewrite the comments
above `.resize-handle` and `#renderHitAreas` only if they become untrue.

Also run `pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-plan-canvas.a11y.test.ts
src/no-hardcoded-chrome.test.ts`. The a11y cases "a selected table with its handles" and "a selected
table at the top-left corner with its handles" now draw corners in both themes (every selected table
does); the two cases select the 2 × 2 fixture `b1`, which covers a table with corners and no side dots,
and the side dots stay covered by the case that selects the 8 × 4.

## Task 7 — Canvas: dragging a corner

Files: as Task 6, plus `wt-floor-plan-canvas.view.test.ts`. Rough size: 40–60 tool calls.

Test first:

1. Dragging the bottom-right corner of an unturned 8 × 4 at (10, 10) by (24, 12) px sends one
   `wt-table-resize` at release equal to `resizeFromCorner(p, "bottom-right", 2, 1)`, nothing before
   it, and no `wt-table-move`; the table is drawn at the new size before release (follow "dragging
   the right dot sends one resize at release, from resizeFrom").
2. On a table turned 90° the corner follows the table's own sides (follow "a turned table's dot
   resizes along the table's own side, not the screen's").
3. The size badge shows under the table while a corner is dragged; the viewport and page cursor are
   the corner's `resizeCursor` during the drag and are put back after it, and after a disconnect
   mid-drag (follow the side-dot cursor cases, "puts the page's cursor back when the canvas is
   removed mid size-dot drag" and the it.each beside it).
4. A corner drag that ends where it began sends nothing; a pointer cancel puts the size back and
   sends nothing; a second pointer cannot take it over (follow "a dot drag that ends where it began
   sends nothing" and the two cases after it).
5. At the drawn edge: the top-left corner of a 6 × 6 turned 30° at (2, 2) dragged outwards sends
   only what `resizeFromCorner` answers, and the drawn outline never pokes out during the drag.
6. A 2 × 2's corner drag works (its only handles); a 2 × 6's top-left corner drag that shrinks its
   height below 4 keeps the side dots until release.
7. View: at twice the zoom a corner drag of 48 screen px changes two squares each way (follow "at
   twice the zoom a resize changes two squares for 48 screen pixels"); a touch on a selected
   table's corner hit area resizes, and on an unselected table's place pans (follow "a finger on an
   unselected table pans without moving or selecting it").

Then: `Grab` gains `{ kind: "corner"; corner: PlanCorner }` (or a `handle` that is a side or a corner
— whichever touches fewer lines), `resizing` holds that handle, and `#onPointerMove` projects the
movement onto the corner's two sides' `outward` directions and calls `resizeFromCorner` with the
starting placement. Keyboard handling does not change.

## Task 8 — Canvas: the turn arrow above the top-centre dot, and the margin it needs

Files: as Task 7. Rough size: 40–60 tool calls.

Test first:

1. With `--wt-tap-min` 50 px and `--wt-space-1` 6 px on the host, the arrow is at least 50 px
   square, centred on the table's own top side (within 1 px), its bottom edge `--wt-space-5 / 2 +
   --wt-space-1` above that side, turned with the table at 0°, 30°, 90° and 180°. Replace the
   `turnedCorner` helper with one for the top-centre position and keep every other assertion the
   replaced cases make (tap size, icon drawn).
2. The arrow's box overlaps no corner hit area and no side hit area of an 8 × 8, a 2 × 2 and a 1 × 1
   at 0° and 30° (sample `elementFromPoint` across the arrow's box: every sample is the arrow).
3. Margin from the tokens: still 72 px at the shipped tokens; with `--wt-tap-min` 68 px, 96 px
   (`ceil(hypot(12 + 4 + 68, 34) / 12) = 8` squares). Watch it fail first.
4. "keeps the whole turn arrow of a corner table turned %i° inside the grid", "draws room for a
   turned table at the grid's origin, so reveal brings all of it into view" (its expected arrow
   position → the new one) and the view case "zoomed-out handles at the plan's corner remain inside
   the grid" pass with the new arrow.
5. "the handle turns by how far the pointer goes round, wherever it was pressed" passes (its event
   detail as changed in Task 4).

Then move the arrow in CSS (`left: 50%`, a `translate` of −50% on its own axis, `bottom` as above,
all in `--wt-plan-control-scale`) and change the `reach` computation in `willUpdate` (`:457–466`) to
Decision 7's formula with its comment.

Mutation, once after this task:
`gtimeout 2700 pnpm --filter @waitron/ui exec stryker run --mutate src/components/wt-floor-plan-canvas.ts`.
A survivor gets a test, or a PR line saying why none can tell it apart, when it is on a line this
branch added or changed, OR when the tests that used to catch it were changed by this branch to new
values (re-pointed) — in particular the room-growing lines of `willUpdate`'s drag branch, whose old
catching tests Tasks 3 and 4 re-point.

## Task 9 — LOOK, docs, backlog

Rough size: 40–60 tool calls.

1. **LOOK**, in real Chromium through the dashboard editor: a throwaway test beside
   `apps/dashboard/src/screens/floor-plan-editor.a11y.test.ts`, mounting the editor with its `open`
   helper and stub api, a plan holding an 8 × 8 at (10, 10), an 8 × 4 turned 30° at (24, 10), a
   2 × 2, a 2 × 6, and an 8 × 8 at (0, 0). For each of light and dark and each of
   `page.viewport(390, 844)` and `page.viewport(1280, 800)`: select each table in turn and
   `page.screenshot` the canvas to `__screenshots__/look/a672-<table>-<theme>-<width>.png` (a path
   relative to the test file; `/tmp` is refused); then, for the (0, 0) table, shoot it after a 15°
   turn by its arrow key and in the middle of a 45° arrow drag. Read `window.innerWidth` inside the
   test and put the widths measured in the report. Copy the pictures to
   `~/waitron-campaign-b/a672-shots/` and delete the throwaway test. Check against the A671 mockup
   and `q2-b-corners-always.png` / `q3-b-table-steps-in.png`: square corners on every table, round
   dots only on sides of 4 squares or more, the arrow above the top side and clear of everything,
   the margin blank with the grid starting at the plan's edge, the turned table stepped in, nothing
   else moved, no scroll bars.
2. **`docs/developers/design-system.md`**: the `wt-floor-plan-canvas` row of the component table
   (~677) gains the parts `resize-corner` and `resize-corner-handle`, and `wt-table-rotate` becomes
   `{ key, rotation, x, y }`. The paragraph at ~682 says the margin is drawn blank (no grid), gives
   its formula (Decision 7), and replaces "never below 0" with the edge rule (Decision 1, including
   the gap and a table that arrived poking out). The paragraph at ~705–717 moves the turn arrow to
   "centred above the table's own top side, past the top dot's hit area by `--wt-space-1`", says a
   turn steps the table in and sends its x and y, adds the corners (look, hit area, drawn on every
   table; a side's dot only when the side is at least 4 squares; who takes a press where they
   overlap) and the reworded resize promise (Decision 2), and says the keyboard has no corner.
3. **`docs/backlog/till.md`**: delete the A672 entry (all three points are built). Add, in the same
   area, a short entry for the stored-position follow-up: "A turned floor plan table narrower than
   its unturned box stops short of the plan's left or top edge … owner question asked <date>"
   (copy the question below). A562: change "when selected its resize handles cover it" to say A672
   decided the handles (a selected 2 × 2 shows four corners and no dots) and that its name remains
   A561's decision. **`docs/backlog.md`**: delete A672's index line, add the follow-up's, update A562's
   ("Its handles cover it when selected" → "its name waits on A561's decision"); delete "An arrow-key
   turn that makes a corner table poke further out still shifts the other tables a square" (settled
   by Q3; its open half, "A Shift+arrow resize of a turned corner table was not tested for the same
   shift", is settled too: a resize never pokes a table out, so no room is added); add beside
   "Resizing a floor plan table needs a pointer or a keyboard": "No key moves a floor plan table's
   top or left side or a corner; Shift with the arrow keys moves its right and bottom sides. Left
   open by A672." Change "Small floor plan canvas details: `reveal` does not count the side dots" to
   "…the side dots or the corners" if `reveal` still counts neither. The entry "On computers whose scrollbars take
   space, a size reading just after a floor plan drop may shift the plan by the extra room" stays
   open: it was seen only with a stand-in scrollbar and is not what Q3 fixed.

## Changed test checks expected

Each is listed in the PR's "Changed test checks", before → after, with its reason. Any other
existing check that fails during implementation is a STOP: report it, do not edit it.

**Task 1 — `packages/ui/src/floor-plan-geometry.test.ts`**

- "grows a side at the grid's edge only as far as fits, keeping the opposite side":
  `resizeFrom(table(10, 1, 8, 4, 90), "left", 4)` → `table(9, 0, 10, 4, 90)` becomes
  `table(10, 1, 8, 4, 90)` (unchanged). That table's drawn top is already −1, and its left side faces
  up, so any growth takes it further out (Q1: a table grows only in directions that do not cross the
  edge, and no gesture takes a table further out than it began). Rewrite the comment above it; add a
  turned case that does grow at the edge (Task 1 test 5).

**Task 3 — `packages/ui/src/components/wt-floor-plan-canvas.test.ts` and `.view.test.ts`** (reason:
Q1, a turned table stops at its drawn outline)

- "a turned table dragged to the origin stays under the pointer and inside the grid": the drawn left
  during the drag `≈ before.left − 60` → `≈ before.left − 36`; sent `{ key: "t1", x: 0, y: 10 }` →
  `{ key: "t1", x: 2, y: 10 }`. Its name changes to say it stops where its drawn outline meets the
  plan's edge.
- "a turned table dropped at the corner is let go where it is drawn; its scroll room goes at the next
  change": placement `{ x: 0, y: 0 }` → `{ x: 2, y: 2 }`; `scrollLeft` 24 → 0 (no room is added, so
  none is kept). The rest passes; rewrite its comment.
- "a turned table dragged to the top keeps a steady height in a box that takes its height from the
  plan": placement `{ x: 20, y: 0 }` → `{ x: 20, y: 2 }`; `heights.at(-1)` and `Math.max(...heights)`
  `start + 24` → `start`. `below` stays `[0, 0, 0, 0, 0, 0, 0, 0, 12, 24]`, now because the table stops
  at y 2 after 8 frames while the pointer goes on; rewrite both comments.
- "%s leaves no extra room once the earlier layout comes back", the "an undo after a corner drop"
  case: placement `{ x: 0, y: 0 }` → `{ x: 2, y: 2 }`. The "a refused corner drop" case is unchanged.
- View, "grid growth at twice zoom leaves a corner-bound table under the pointer": the centre's x and
  y `≈ at − 240` → `≈ at − 192` (the 8 × 8 turned 45° stops at (2, 2), 8 squares of 24 screen px
  from (10, 10)); rename to say where it stops.

**Task 4 — the same two files** (reason: Q3, `wt-table-rotate` now carries the table's x and y)

- "dragging the handle turns the table in 15° steps": each of the four entries gains `x: 10, y: 10`.
- "the handle turns from the table's own angle, not from straight up": `{ key: "t1", rotation: 180 }`
  gains `x: 10, y: 10`.
- "the handle turns by how far the pointer goes round, wherever it was pressed": gains `x: 10, y: 10`.
- "a real drag of the handle turns the table and keeps the selection": gains `x: 10, y: 10`.
- "the arrow keys on the handle turn by 15° and wrap": each of the three entries gains `x: 10, y: 10`.
- "each event bubbles out of a shadow root": the turn's detail gains `x: 10, y: 10`.
- "the handle of a turned table at the origin turns it round its own centre": gains `x: 0, y: 0`
  (45° → 135° does not poke it further out).
- View, "at twice the zoom a turn still follows the table's visible centre": gains `x: 10, y: 10`.
- Helpers, not checks: `applyChanges` in the canvas test file and the rotate listener in the view
  case "a keyboard turn at twice zoom gives back only the corner margin already scrolled away" apply
  x and y as well as the turn.

**Task 6 — `wt-floor-plan-canvas.test.ts`** (reason: Q2, a side keeps its dot only if at least 4
squares long)

- "a press just outside a side of a selected 2 × 2 table turned %i° resizes that side" (both 0° and
  30°): four resizes, one per side → none (a 2 × 2 has no side dots). Replace it with "a press just
  outside a corner of a selected 2 × 2 table turned %i° resizes from that corner", expecting
  `resizeFromCorner` for each corner — it can only pass once Task 7 lands, so in Task 6 write it
  with `it.todo` naming Task 7, and Task 7 makes it real.
- "a selected 2 × 2 table turned %i° is dragged by a press at its centre or just inside a side's dot":
  its checks are unchanged; its name may say "a side's midpoint".
- "draws the turn arrow of a selected table at the grid's corner inside the grid, and reveal shows
  it": its loop over `dots(el)` for a 1 × 1 finds four side dots today and none after Q2, so it would
  check nothing. Replace that loop with one over the corner hit areas (each inside the grid).

**Task 8 — `wt-floor-plan-canvas.test.ts`** (reason: A672 point 2, owner yes 2026-10-14: the turn
arrow moves to top centre)

- "draws the handle at least a tap target square, off the table's top-right corner": the position
  checks (`h.x > box.right`, `h.y < box.top`, within 50 px of the top-right corner) → centred on the
  top side, `--wt-space-5 / 2 + --wt-space-1` above it.
- "draws the handle at the table's own top-right corner turned %i°" (90°, 30°, 180°): `turnedCorner`
  (31 px off the top-right corner) → the top-centre position.
- "the handle stays at its corner while the table is dragged round": `turnedCorner(…, 31)` → the
  top-centre position.
- "draws room for a turned table at the grid's origin, so reveal brings all of it into view":
  `turnedCorner(…, 26)` → the top-centre position.
- "keeps room round the grid's corner for the turn arrow, from the tokens": with `--wt-tap-min`
  68 px, `{ left: 108, top: 108 }` → `{ left: 96, top: 96 }`.
- "paints the side dots, the size badge and the turn arrow from tokens": gains the corner's colour
  (an addition, not a change).

**Checks that look affected but are not** (each checked against the rule; if one fails, STOP): the
turned tables that START poking out and move or turn less far out — "in %s, a turned corner table
dragged away is let go where it is drawn, and nothing else moves" (to (5, 5)), "a corner table turned
straight by its handle is let go where it is drawn", "in a plan that fits, %s of a turned corner
table by its keys moves no other table" (the nudge sends `{ x: 1, y: 0 }`; 30° → 15° does not step),
"in a scrolled plan, a turn back of a big corner table by its key gives back only the room scrolled
away", the view case "a keyboard turn at twice zoom gives back only the corner margin already
scrolled away", and every parent-set poking table ("drops the room for a turned corner table once it
is turned back, moved or replaced", "the first tables drawn after an empty plan show a turned corner
table unscrolled", "a plan that fits shows no scrollbars with a turned table at the corner, and all
of that table", "centres a turned table's refused reason under it at the origin"); "Shift+ArrowLeft
shrinks a table turned 90° at the grid's top edge" ((11, 0) 7 × 4, computed); "Shift+ArrowRight sends,
announces and badges nothing when its side cannot grow on the grid" (computed); "shrinks a side at
the grid's edge, moving the opposite side instead" (computed); the dashboard tests that dispatch
`wt-table-rotate` with `{ key, rotation }` only (`changePlacement` merges what is given).

## Checks for the branch

The focused files above; `pnpm --filter @waitron/ui exec vitest run src/no-hardcoded-chrome.test.ts
src/tap-target-and-focus.test.ts`; `pnpm --filter @waitron/dashboard exec vitest run
src/screens/floor-plan-editor.test.ts src/screens/floor-plan-editor.a11y.test.ts` (the canvas inside
the editor); `pnpm exec vitest run scripts/style-token-names.test.ts scripts/screenshot-paths.test.ts`;
`pnpm --filter @waitron/ui typecheck`; `pnpm --filter @waitron/dashboard typecheck`;
`pnpm --filter @waitron/ui lint`; `pnpm format:check`. Package coverage (98/98/98/95) and the ui
mutation floor are CI's (`test-ui` and `test-dashboard` coverage on the PR; the nightly
`mutation-ui` matrix): read those jobs' results on the head before calling the branch green.

## Owner question to post (the driver makes the drawing)

> **A672 follow-up: a turned table that can't quite reach the left or top edge**
>
> A table's saved position is its corner before it is turned, and that corner can't go below 0.
> So a table that gets narrower when turned — an 8 × 4 table turned on its end, for example — stops
> with a gap of 2 squares at the plan's left edge, and when you lengthen it along that edge it
> slides a little away from the edge (half of what you add). Lengthening it a square at a time also
> ends differently from lengthening it in one go, and lengthening then shortening may not put it
> back where it was.
>
> Every other table goes right up to the edge, as close as whole squares allow: up to just under a
> square away (an 8 × 8 turned 30° stops about half a square off).
>
> Turning a table at the edge with the arrow keys walks it away from the edge, and turning it back
> does not bring it back: one full turn moves an 8 × 8 from the corner to 2 squares across and 2
> down. Dragging the arrow does the same over separate drags; only turning back within the same
> drag puts the table back.
>
> (a) Keep it like this. This is what is being built now.
>
> (b) Let a saved position go below 0, so a narrow turned table's outline can touch the edge and
> grow without sliding away from it. That is a separate job: the database and the server would
> accept a wider range. It would not change the other two effects: positions stay whole squares,
> and a table still steps in when turned.
>
> Reply a or b.
