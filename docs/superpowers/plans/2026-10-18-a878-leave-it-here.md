# A878 "Leave it here": clear a table's Needs moving for today — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Every task is test-first: write the failing test, run it, see it fail
> for the reason stated, then write the least code that passes.
>
> **Existing assertions.** No existing assertion should need to change. If one does, STOP: report
> it, do not edit it. Changing a call's arguments, a fixture's setup, a stub's list of methods or a
> helper's signature is not changing an assertion.
>
> **Size.** Each task is sized for one implementer at medium effort, well under 100 tool calls. An
> implementer past about 150 calls with the task unfinished stops at a passing or cleanly red
> point, commits, and returns a handover: what is done, what is left, the files, each check's state.
>
> **Citations.** Every `file:line` below was read at `main` `24477772b` (2026-10-18). Lines drift;
> search for the named symbol if a line has moved.

**Goal:** a table showing "Needs moving" can be left where it stands for the rest of the day, so
staff can seat it, without changing the saved layout.

**Architecture:** one new till write, `POST /api/tables/:id/today/leave-here`, built exactly like
Mark moved (`take-orders`, the room's revision, the zone check). It moves nothing. It ends every
waiting reset row of the table's joined group as already placed, and clears their Needs moving
marks. "Placed" is the existing state that means "today's map already has this table; only its
name may still change". A row still waiting to give its table a new name stays waiting, placed,
until the name is applied. A row for a joined table that does not exist yet is ended. The floor's
catch-up never moves or marks a placed row, so nothing re-marks the table until the next reset
rewrites the zone's rows. Back to its saved place gains the place check Reset table already has, so
a table left here cannot be sent back on top of the table that blocked it. The till asks "Cancel ·
Leave it here · Mark moved" on a tapped table, shows Leave it here on the list card, and offers it
beside the "another table is in its new place" refusal.

**Tech stack:** TypeScript, drizzle on SQLite (`node:sqlite`), Hono, Lit, Vitest (node project
for `apps/server`, real-Chromium browser mode for `apps/till`).

**Spec:** the owner's decision in the campaign queue (`~/waitron-campaign-b/queue.md`,
"### A878.", decided 2026-10-18 ~20:50: "Leave it here, today only"), on top of
[A504: floor plan sets](../specs/2026-10-17-a504-floor-plans-design.md) §7.3–§7.5 (what Needs
moving is, the joined-group rows, the place check). No backlog entry exists for A878.

**Migration: none.** The state needed already exists as columns: `floor_reset_tables.placed`,
`pending` and `ready_to_move` (`packages/db/src/schema/floor-plans.ts:236-243`). A probe run while
writing this plan, and the plan review's experiments, showed the existing columns are enough.

**Risk path: FULL ceremony** (a new till write route, and a new refusal on an existing one). Per-task reviews run; `/finish-branch` runs
the full wave with two Codex run-it seats.

## Global constraints

- Leave it here needs the device's `take-orders` action and sends the room's revision, like Mark
  moved (`tableRoute`, `apps/server/src/floor-today-api.ts:162-187`; Mark moved at 212-214).
- The saved layout is never written. The next Update layout, Reset to … plan or day's first reset
  tries to move the table again and may mark it Needs moving again.
- No new error code. Leave it here answers only what every `tableRoute` already answers
  (`table.not_found`, `floor_today.out_of_date`, the device-action and zone refusals). Back's new
  refusal reuses `table.place_taken` { tableId, standingId }, which Reset table already throws
  (`floor-today-reset-table.ts:213-215`). So `scripts/alert-codes.test.ts` and
  `scripts/errors-reachable.test.ts` need no change; Tasks 1 and 3 confirm by running both.
- English words: "Leave it here" (button, refusal offer). Spanish: **"Dejar aquí", proposed, NOT
  owner-approved.** It follows "Marcar movida" (`apps/till/src/i18n/strings.ts:2447`), a verb in
  the infinitive. The other choice is "Dejarla aquí". The runner asks the owner in lane B's
  `questions.md` with the Task 6 screenshots before landing, and changes the string if the owner
  picks other words.
- The question's title and body stay as A504 worded them (`floor.move_title`,
  `floor.move_title_named`, `floor.move_body`, `strings.ts:895-898`, `2448-2451`). The
  `table.new_place_taken` sentence stays as worded (`strings.ts:899`, `2452`); the offer is a
  button beside it, not new words in it.
- Product code gets a comment only for an invariant the code cannot show (CLAUDE.md §1, last rule).

## The three questions the brief asked the plan to settle

### 1. Joined groups, and tables taken off for today

Leave it here takes the same shape as Mark moved: it acts on the pressed table's row **and every
waiting row of the joined group holding it** (`pendingGroupRows`,
`apps/server/src/floor-today-mark-moved.ts:214-246`, which Mark moved uses at 58-61). Mark moved
applies the whole group; Leave it here leaves the whole group as it stands today. The A504 §7.3
rows:

| Today | Leave it here on any table of the group |
| --- | --- |
| Free 4 and 5, which the new layout joins as 4+5; 4 had guests, so 4 and 5 show Needs moving | 4 and 5 stay where they stand, apart, both seatable. 4+5 stays off the map. If 4+5 does not exist yet (a joined table still to be made), it is not made. |
| 4+5 standing joined with guests gone, under a layout that stands 4 and 5 apart | 4+5 stays on the map, joined and seatable. 4 and 5 stay out of service as parts of it, as they were (`stillJoinedPart`'s first branch: the joined table is drawn, `packages/db/src/joined-parts.ts:28-32`). |
| A table taken off for today | It never shows Needs moving: `needsMoving` requires the table drawn and not taken off (`resetRowMoves`, `joined-parts.ts:92-104`, which needs today's row not taken off and drawn). So Leave it here cannot be pressed on it. A taken-off member of a group that needs moving stays where it is, still off. Mark moved would put it at its new place, still off (`floor-today-mark-moved.ts:107-109`; `floor-today-store.ts:704-707`). |
| A group member with guests and no place on today's map (the `c9` case in `floor-today-mark-moved.test.ts`) | Its row is ended as placed, like the others, so nothing about it changes. Leave it here is never refused because a table of the group is busy: it moves nothing. |

**How, in rows** (`leaveHere`, Task 1), for every waiting row of the group:

- **The row has a table, and the table already has the row's name:** ended as placed,
  `pending = false, ready_to_move = false, placed = true`. That is the state the catch-up itself
  leaves once it has applied a placed row (`floor-today-store.ts:743-757`).
- **The row has a table and gives it a new name** (a rename from the dashboard):
  `placed = true, ready_to_move = false`, still waiting. The route's own catch-up applies the name
  and ends it, unless another table still holds the name or the table has guests.
- **The row has no table** (`table_id` null: a joined table still to be made): ended,
  `pending = false, ready_to_move = false`. Marking it placed would not do: the catch-up makes a
  table for a waiting row with no table without looking at `placed` (the `plan.create` loop,
  `floor-today-store.ts:681-693`). The plan review ran it (experiment P4): with the row ended, the
  zone kept its 3 dining tables and c4 could be seated (200); with the row marked placed instead,
  the zone went from 3 to 4 tables once the place cleared, and seating c4 was refused 409
  `table.in_joined_table`.

Why a row that already has its name is ended rather than left waiting: a waiting placed row whose
table has guests keeps `catchUpDue` true, and `ensureToday` (`floor-today-store.ts:969-977`) then
runs a full catch-up on every floor read while those guests stay. The plan review saw this happen
(experiment P5, the `c9` setup). Ending the row is safe: `stillJoinedPart` reads `placed = 1` and
`pending = 0` alike (`packages/db/src/joined-parts.ts:34`), and the catch-up reads only waiting
rows (`floor-today-store.ts:380-383`).

### 2. Does a later floor read re-mark it the same day? No. The next reset does.

- The catch-up reads only waiting rows (`floor-today-store.ts:380-383`). A placed row never counts
  as moving, never applies its place, and is never marked: the moving lists skip placed rows
  (568-574), the apply step skips them (699-701), `stillToMove` skips them (785), and
  `readyToMove()` skips them (806, 811). A placed waiting row applies only its name and then stops
  waiting (743-757), and the catch-up never reads a row that has stopped waiting. This state is
  not new. The catch-up writes it itself (754), and splitting a joined table writes it for a part
  that is in use, "so the catch-up does not take it off the map
  when it frees" (`splitInUse`, `floor-today-merges.ts:283-302`).
- Every reset deletes the zone's rows and writes new waiting ones with `placed` false
  (`floor-today-store.ts:244-273`, the delete at 255), then runs the catch-up inside the reset
  (274). A drawn table whose new place is taken is marked again whether or not a reset is running (626-642). The day's
  first reset and Update layout go through the same `resetZoneFor` (990, 180).
- **Probe run while writing this plan** (a throwaway test built on
  `floor-today-mark-moved.test.ts`'s setup, deleted afterwards; `pnpm exec vitest run` in
  `apps/server`, 5 passed then 3 passed). In the "another table stands in table 3's new place"
  scenario, I set table 3's row to `placed = 1, ready_to_move = 0` by hand. Results:
  - The next read showed `needsMoving` false and the row `{pending: false, readyToMove: false,
    placed: true}`.
  - With the blocking table moved away, two more reads still showed table 3 at `x: 0`, not
    needing moving.
  - Table 3 could be seated.
  - With the blocking table holding guests, a reset onto Dinner marked it again:
    `{pending: true, readyToMove: true, placed: false}`.
  - **Control:** with `ready_to_move = 0` alone (row still waiting, not placed), the next read
    marked it again (`needsMoving` true). So Task 1's "a later read does not re-mark it" case does
    tell the two designs apart.
  - The same probe covered both joined-group rows of question 1, the to-be-made joined table
    (ended: no table made; marked placed instead: the row stayed waiting), and a table the
    dashboard renamed and moved (the new name was applied and the place kept).
  - The probe's code was throwaway and is gone. **Task 1's cases are the record:** cases 1–4 and
    6–9 rerun every result above through the real route, and Step 5 reruns the control.

### 3. Spanish

"Dejar aquí", proposed (see Global constraints). Every task that writes it says so. The owner's
answer arrives before landing, not before building.

## Decisions this plan makes that the brief does not

The owner confirms or overrides these when reviewing the plan; each names the default built.

1. **A dashboard rename travels; seats and today's changes stay.** A waiting row can carry a new
   name the dashboard gave the table (`floor-today-mark-moved.test.ts`, "applies a marked table's
   new name with its move"). Leave it here keeps that rename: the table takes its new name at
   once, as Mark moved would have given it. Everything else stays as today's map has it: place,
   turn, size, seats, joined or merged, split off, today's name, taken off. The reason: a table's
   name is the same in every set and is the table's identity, not a fact about today's map, and
   "placed" already means exactly this.
2. **The refusal's offer leaves the table that was pressed**, not the table the refusal names.
   `table.new_place_taken`'s `tableId` is the group member whose place is taken
   (`floor-today-mark-moved.ts:113`), which can be a part that is not on the map. Leave it here on
   such a table does nothing, because it does not show Needs moving. The pressed table always
   does.
3. **The offer appears after Mark moved and after Back to its saved place.** On a table that needs
   moving, Back is Mark moved (`backToSaved`, `floor-today-store.ts:1288`) and is refused the same
   way.
4. **The question draws Cancel quiet** (`variant="ghost"`), Leave it here `secondary` and Mark
   moved `primary`, in that order. This copies the till's other three-button question
   (`apps/till/src/widgets/bill-choice-dialog.ts:59-76`: ghost Cancel, secondary, primary). This
   restyles Cancel, which the owner did not ask for. Needs clearing's two-button question keeps
   its secondary Cancel.
5. **The list card carries both buttons**, Leave it here then Mark moved, both `size="sm"
   variant="secondary"` as Mark moved is today (`till-floor-screen.ts`, `#waitingCard`). If they do
   not fit one line at 390 px they wrap; Task 6 looks.
6. **The question's body still explains only Mark moved** ("Mark it moved once it stands, is put
   away or is taken apart as the new layout has it."). Nothing in the question says what Leave it
   here does or that it lasts only today. Saying so would need new words in two languages, which
   the owner has not given.
7. **Back to its saved place checks what stands there, on every table** (runner's decision on the
   plan review, 2026-10-18). Back refuses `table.place_taken` while a table drawn on today's map,
   other than the table itself and its merge partners, stands in its saved place. A table standing
   exactly at its own saved place blocks nothing. This reuses Reset table's check,
   `refusePlaceTaken` (`floor-today-reset-table.ts:170-216`), with `fromSaved` true. Without it, a
   table left here could be sent back on top of the table that blocked it. The plan review ran
   this on main's code (experiment P1). It also showed Back never checked at all (experiment P2:
   with no Leave it here, Mark moved t3 to x 40, drag t3 to x 0, drag t8 to x 36, Back → 200,
   overlapping). So the check also changes Back after an ordinary drag. A504 §7.5 says no table is
   put down on another.
8. **On the till, Back's `table.place_taken` refusal shows the code's own words**, "Another table
   is in its place. Move it, then try again" / "Otra mesa ocupa su sitio. Muévela y vuelve a
   intentarlo" (`apps/till/src/i18n/codes.ts:232-235`). Today the floor screen names the tables for
   that code with Reset table's sentence, "{table} is standing in {joined}'s place. Move {table},
   then Reset table again." (`till-floor-screen.ts:1284-1291`; `strings.ts:857-858`), which would
   tell staff to press the wrong button. The code's words need no new wording from the owner. A
   sentence naming both tables would need new words in two languages.

## Every reader of the Needs moving mark and the placed flag

House rule: trace every consumer before changing what a flag means. Leave it here writes a state
that already exists, so no reader changes. For the table left, every reader of `needsMoving` now
says "no":

| Reader | What changes for a table left here |
| --- | --- |
| `needsMoving` (`joined-parts.ts:106-114`) → seating (`working-order.ts:1401-1418`) | Seatable. |
| → moving a party's bill to it (`move-bill.ts:253-261`) | Allowed. |
| → merging or joining it (`floor-today-table.ts:114-125`) | Allowed: "joinable again". |
| → the till's tables read, `today.needsMoving` (`working-order.ts:7854`, `7934`) | false: normal chip and card, and Join with… is offered (`apps/till/src/state/floor-today.ts:406`). |
| → Mark moved's exemption (`floor-today-mark-moved.ts:99`) and the catch-up's `placeTaken` (`floor-today-store.ts:1123`) | It now blocks other tables' new places, like any table that stays. A table that needs moving and whose new place it stands in is refused Mark moved (`table.new_place_taken`) and can be left too. |
| The room's revision print, which includes `readyToMove` (`floor-revision.ts:90`) | It changes, so the room's revision moves by one. |
| `catchUpDue` (`floor-today-store.ts:1068-1081`) → `ensureToday` (969-977) | Unchanged for every row Leave it here ends, because it reads only waiting rows. A row still waiting for a rename keeps it true, so each read runs the catch-up until the name is applied. The route's own catch-up applies it at once unless another table holds the name or the table has guests, as main does for any row waiting for its name. Rows whose table already has the row's name are ended so that a group member with guests does not keep it true (plan review, experiment P5). |
| `stillJoinedPart` (`joined-parts.ts:33-47`: `placed = 1 or pending = 0`, and no sibling part drawn) | Applies only when no part of the group stands on the map. At Leave it here at least one does (the pressed table, or the joined table through the first branch), so nothing changes then. The probe seated 4 and 5. If staff later take every part off the map, the parts count as still joined. That is what main does today for any applied row whose joined table is not drawn. |
| `layoutPlacesIn` (`floor-today-store.ts:1006-1024`) | Unchanged: it still gives the table's place in the new layout. The table stands elsewhere, so the "stands at its own place, blocks nothing" exception (`blocksPlace`) does not apply to it. |
| Reset table's saved place (`floor-today-reset-table.ts:47-50`) | Unchanged: reads the row's place whatever `placed` says. |
| `backToSaved` (`floor-today-store.ts:1280-1316`) | No longer passed to Mark moved (the table does not need moving). On main it then puts the table at its reset row's place without checking what stands there. Task 3 adds the check (decision 7). |
| `savedPart` (`packages/db/src/joined-parts.ts:139-179`) → the dashboard's table list (`apps/server/src/tables.ts:54`) and bookings' table check (`packages/bookings/src/bookings.ts:50-73`) | **No change, by decision.** These read the last reset's copy, not today's map. In the "new layout joins 4 and 5" case, after Leave it here the dashboard list still leaves out 4 and 5 and lists the off-map 4+5, and a booking today at 4 is refused `table.in_joined_table` (plan review, experiments P3 and P4). That was already so while 4 and 5 needed moving, so it is not a regression. Task 7 files a backlog entry. |

## Review Focus

1. **Leave it here on one table of a swap.** Dinner puts 2 where 3 stands and 3 where 2 stands.
   Both need moving and either may be marked first (A504 decision 20). After Leave it here on 2,
   Mark moved on 3 is refused `table.new_place_taken` naming 2, and Leave it here on 3 then
   succeeds. Pinned in Task 1.
2. **Back to its saved place on a table left here**, with the table that blocked it still
   standing there, is refused `table.place_taken` naming that table, and writes nothing. Before
   this change, Back on a table that needed moving was Mark moved and was refused; on main, Back on
   a table that does not need moving checks nothing (decision 7). Pinned in Task 3, with the
   ordinary-drag case and the cases Back must still serve. The till says the code's own words
   (Task 5).
3. **Another device got there first.** A Leave it here sent with an old room revision is refused
   `floor_today.out_of_date` and writes nothing. One sent after the table was already left or
   marked moved answers 200 and keeps the revision. Pinned in Task 1.
4. **A device without `take-orders`** sees no Leave it here: not in the question, not on the card,
   not in the refusal offer. The server refuses the route with `device.forbidden_action`. Pinned
   in Tasks 2, 4 and 5.
5. **A joined table still to be made is never made later the same day**, even once its place
   clears. Pinned in Task 1.

---

## Tasks

| # | Task | Size |
| --- | --- | --- |
| 1 | Server: `leaveHere` and its route, with the domain cases | M |
| 2 | Server: the two route maps and their refusing cases | S |
| 3 | Server: Back to its saved place checks what stands there | S |
| 4 | Till: client method, the three-button question, the list card, the words | M |
| 5 | Till: the refusals: Leave it here offered; Back's `table.place_taken` in the code's words | M |
| 6 | LOOK (scripted screenshots) | M |
| 7 | Docs and backlog | S |

Tasks 1 → 2 → 3 in order (3 uses Task 1's route in its first case). Tasks 4 → 5 in order. The till
tasks use stubs and do not wait for the server ones. Task 6 needs 1–5. Task 7 comes last.

### Task 1: Server — `leaveHere` and its route

**Files:**
- Modify: `apps/server/src/floor-today-mark-moved.ts` (add `leaveHere` beside `markMoved`; it
  reuses `tableNeedsMoving` and the private `pendingGroupRows`)
- Modify: `apps/server/src/floor-today-api.ts` (one `tableRoute("leave-here", …)` line after
  `mark-moved`, 212-214)
- Test: `apps/server/src/floor-today-mark-moved.test.ts` (a new `describe("Leave it here")` after
  the Mark moved one, using the file's setup and helpers)

**Interfaces — Produces:**
`leaveHere(tx: Transaction, cfg: TillConfig, removals: readonly TableRemoval[], tableId: string, now: Date): Promise<void>`
and the route `POST /api/tables/:id/today/leave-here`, body `{ zoneRevision }`, answer
`{ zoneId, revision }`, as Mark moved.

- [ ] **Step 1: Write the failing tests.** Add helpers beside the file's own:
  `const leaveHere = (tableId: string) => send("POST", `/api/tables/${tableId}/today/leave-here`, {});`
  and `rowStateOf(tableId)`, which selects `pending`, `readyToMove` and `placed` (leave `readyOf`
  as it is: existing cases compare it with `toEqual`). Then these cases:
  1. **"leaves a table whose Mark moved was refused where it stands, seatable, and the saved
     layout unchanged".** `threeNeedsMoving([{ key: "t8", standard: 120, dinner: 120 }])`,
     `setToday(t8, { x: 36 })`. Expect `refusal(markMoved(t3))` toEqual `newPlaceTaken(t3, t8)`.
     Read the saved Dinner layout (`readLayout(tx, v.cfg, { setId: z.d.dinner, zoneId:
     z.d.zoneId })`) and the zone's revision. Then `expectRevision(v, leaveHere(t3), z.d.zoneId,
     before + 1)`. Expect: `todayRow(t3)` matches `{ x: 0, takenOff: false }`; `needsMoving(t3)`
     false; `rowStateOf(t3)` equals `{ pending: false, readyToMove: false, placed: true }`; the
     saved layout read again toEqual the one read before; `seatAt(t3)` succeeds (it expects 200).
  2. **"a later read does not mark it again, even once the table in its way has gone".** As case
     1 up to Leave it here (no seating). Then `setToday(t8, { x: 120 })`, then `readStates()`
     twice. Expect `needsMoving(t3)` false and `todayRow(t3)` `{ x: 0 }` after each. *Failing
     case:* an implementation that only cleared `ready_to_move` prints `expected true to be false`
     on the first read (the plan's control probe).
  3. **"the next reset tries again, and marks it while a table with guests stands in its new
     place".** As case 1 up to Leave it here; `setToday(t8, { x: 36 })`, `seatAt(t8)`, then
     `z.onto(z.d.dinner)`. Expect `needsMoving(t3)` true, `rowStateOf(t3)` equal to
     `{ pending: true, readyToMove: true, placed: false }` and `todayRow(t3)` `{ x: 0 }`.
  4. **"the next reset with nothing in its way puts it in its new place".** As case 1 up to Leave
     it here; `setToday(t8, { x: 120 })`; `z.onto(z.d.dinner)`. Expect `todayRow(t3)` `{ x: 40 }`
     and `needsMoving(t3)` false.
  5. **"is joinable once left".** As case 1, but with a free table `t5` (standard 80, dinner 80)
     also passed to `threeNeedsMoving`, up to Leave it here. `expectRevision(v, send("POST",
     `/api/tables/${t5}/today/merge`, { targetId: t3, side: "right", seats: 8 }), z.d.zoneId)`
     succeeds.
  6. **"leaves the whole joined group: 4 and 5 stay apart and 4+5 off the map".** The Mark moved
     "moves the whole joined group" setup (4 at 0, 5 at 20, 4+5 at 60 in Dinner, a party at 4,
     reset onto Dinner, finish). `expectRevision(v, leaveHere(t5), s.d.zoneId)`. Expect 4 at
     `x: 0`, 5 at `x: 20`, 4+5 `x: null`; for each of t4, t5, t45 `rowStateOf` is
     `{ pending: false, readyToMove: false, placed: true }`. `seatAt(t4)` and `seatAt(t5)` both
     succeed.
  7. **"leaves 4+5 standing joined and seatable".** `fourPlusFiveSeatedAcrossStandard()`, then
     `leaveHere(t45)`. Expect 4+5 at `x: 60`, `needsMoving(t45)` false, 4 and 5 `x: null`;
     `seatAt(t45)` succeeds; seating at t4 answers 409 `table.in_joined_table` (as before Leave it
     here).
  8. **"ends the row of a joined table still to be made, which is not made later".** The Mark
     moved "names the table pressed when the place taken is a joined table's still to be made"
     setup, up to `setToday(t8, { x: 0, y: 40 })`. Count the zone's `dining_tables` rows. Then
     `leaveHere(c4)`. Then `setToday(t8, { x: 80, y: 0 })` (the place clears) and
     `readStates()`. Expect the same count of dining tables, `needsMoving(c4)` and
     `needsMoving(c3)` false, and the null-table reset row `pending: false`. `seatAt(c4)`
     succeeds. *Failing case, expected from reading the create loop and run in Step 5(b):*
     marking that row placed instead leaves it waiting, so the catch-up makes the joined table
     once the place clears, and the count goes up by one.
  9. **"keeps a rename the dashboard gave it, and its place".** The Mark moved "applies a marked
     table's new name with its move" setup up to `needsMoving` true; `leaveHere(table.a)`. Expect
     `tableRow(v, table.a).label` to be the new name, `todayRow(table.a)` `{ x: 0 }`, and
     `rowStateOf(table.a)` `{ pending: false, readyToMove: false, placed: true }` (the route's
     catch-up applied the name and ended the row).
  10. **"after Leave it here on 2 of a swap, Mark moved on 3 is refused naming 2, and 3 can be
      left too".** The "is not blocked by a table that itself needs moving" setup up to both
      needing moving. `leaveHere(t2)`; expect `refusal(markMoved(t3))` toEqual
      `newPlaceTaken(t3, t2)`; then `leaveHere(t3)` succeeds; both at their old places (t2
      `x: 0`, t3 `x: 40`), neither needing moving.
  11. **"changes nothing on a table that does not need moving".** Copy the Mark moved case of
      that name with `leaveHere`: revision unchanged, `everything()` unchanged.
  12. **"is refused, writing nothing, when the room has moved on".** `threeNeedsMoving()`; send
      `{ zoneRevision: before - 1 }` explicitly (`withFloorRevision` keeps a body that names one).
      Expect status 409, code `floor_today.out_of_date`; `everything()` unchanged;
      `needsMoving(t3)` still true.
  13. **"ends the row of a group member that has guests, so floor reads do not keep running the
      catch-up".** The Mark moved "is refused, writing nothing, while guests sit at a part of the
      group with no place today" setup, up to `seatAt(c9)`. `leaveHere(c4)`. Expect
      `rowStateOf(c9)` `{ pending: false, readyToMove: false, placed: true }`, and c3's and c4's
      the same. *Failing case:* marking every row placed without ending it leaves c9's row
      `pending: true`. Check the row, not `catchUpDue` itself: the plan review found that a drizzle
      select of `catchUpDue` over one table with no join printed `where "zone_id" = "id"`
      unqualified, which is always false. Test it only through a joined select like
      `ensureToday`'s, or through what a reader can see.
- [ ] **Step 2: Run them; they fail.**
  `pnpm --filter @waitron/server exec vitest run src/floor-today-mark-moved.test.ts`.
  Expected: the new cases fail with status 404 (no route). The existing cases pass. Read the
  `Tests` count; a run that shows none is no evidence.
- [ ] **Step 3: Write `leaveHere`.** `zoneOfTable` first (it refuses an unknown table). Return
  doing nothing unless `tableNeedsMoving`. Take the table's waiting row and `pendingGroupRows(tx,
  [own.id])`, deduplicated by id, with each row's `label` and its table's current
  `dining_tables.label`. Write the three row states of question 1: a row whose table already has
  the row's name → `{ pending: false, readyToMove: false, placed: true }`; a row that renames its
  table → `{ placed: true, readyToMove: false }`; a row with no table → `{ pending: false,
  readyToMove: false }`. Then `catchUpZone(tx, cfg, removals, zoneId, now, { inReset: false })`,
  so a rename lands in the same revision. Its doc comment states the invariant in two lines: the
  group is left as today's map has it until the next reset rewrites the rows; a row with no table
  is ended because the catch-up makes such a table without reading `placed`. Add `tableRoute("leave-here", () => ({
  write: (tx, tableId) => leaveHere(tx, deps.cfg, removals, tableId, deps.clock.now().instant)
  }))`.
- [ ] **Step 4: Run the file; every case passes.** Same command. Also run
  `pnpm --filter @waitron/server exec vitest run src/floor-today-store.test.ts src/floor-catch-up.test.ts src/floor-today-state.test.ts`
  (the catch-up's own suites, untouched, still green).
- [ ] **Step 5: Prove the failing cases by deletion**, recording each output for the PR
  description and restoring the code after each. (a) Write only `readyToMove: false` to the rows
  with a table (no `placed`, no ending). Expect cases 1 and 2 to fail: `leaveHere`'s own catch-up
  marks the table again inside the route, so case 1's `needsMoving` already prints `expected true
  to be false`. (b) Mark the null-table row placed instead of ending it. Expect case 8 to fail on
  the count. The plan review already saw this (experiment P4), so a pass here means the case does
  not reach the create loop: fix the case, not the code. (c) Mark every row with a table placed
  without ending any. Expect case 13 to fail on c9's `pending`.
- [ ] **Step 6: Run the code guards.**
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/write-path-tables.test.ts`
  (no new code, so all should stay green); `pnpm --filter @waitron/server typecheck`;
  `pnpm format:check`.
- [ ] **Step 7: Commit** (`git commit -s`), message in plain English, e.g. "Leave it here: a table
  that needs moving stays where it stands for today (A878)".

### Task 2: Server — the route maps and refusing cases

**Files:**
- Modify: `apps/server/src/till-api.profile-actions.test.ts` (the map row at 105, and `ROUTES`
  after the `mark-moved` entry at 426)
- Modify: `apps/server/src/till-api.profile-zones.test.ts` (the map at 142, and the cases after
  the `mark-moved` case at 824-830)

**Interfaces — Consumes:** Task 1's route.

- [ ] **Step 1: Write the refusing cases.** In the action map's row at line 105, add
  `/leave-here` after `/mark-moved`. Add `ordering("POST", `/api/tables/${id}/today/leave-here`)`
  to `ROUTES`. In the zone map add the row `| POST /api/tables/:id/today/leave-here | table |
  refuses POST /api/tables/:id/today/leave-here |`, and add a case shaped like the `mark-moved`
  one (path `/api/tables/${x.deliTable}/today/leave-here`, body `{ zoneRevision: 0 }`,
  `deliTableZone`).
- [ ] **Step 2: Prove they bite.** Both checks live in the shared `tableRoute`
  (`floor-today-api.ts:162-187`), so switch them off for this route only, one at a time.
  (a) Temporarily change the session line to
  `requireSession(deps, c, change === "leave-here" ? {} : { action: "take-orders" })`. Run
  `pnpm --filter @waitron/server exec vitest run src/till-api.profile-actions.test.ts -t leave-here`
  and see the new case fail; restore it and see it pass. (b) Temporarily skip the zone check for
  this route only, wrapping the `checkZones` call in `if (change !== "leave-here")`. Run
  `pnpm --filter @waitron/server exec vitest run src/till-api.profile-zones.test.ts -t leave-here`
  and see it fail; restore it and see it pass.
- [ ] **Step 3: Run both whole files** with the same commands without `-t`. Read the `Tests`
  counts.
- [ ] **Step 4: Commit** (`git commit -s`).

### Task 3: Server — Back to its saved place checks what stands there

**Files:**
- Modify: `apps/server/src/floor-today-reset-table.ts` (export `refusePlaceTaken`, 170-216)
- Modify: `apps/server/src/floor-today-store.ts` (`backToSaved`, 1280-1316)
- Test: `apps/server/src/floor-today-mark-moved.test.ts` (Back's cases already live there, with
  the `back` helper), `apps/server/src/floor-today-api.test.ts` (case 4),
  `apps/server/src/floor-today-changes.test.ts` (the existing Back cases)

**Interfaces — Consumes:** Task 1's route; `refusePlaceTaken(tx, zoneId, tableId, place, own,
fromSaved)`, which throws `table.place_taken` { tableId, standingId } naming the first table in
number order. **Produces:** `backToSaved` refuses `table.place_taken` before writing anything.

- [ ] **Step 1: Write the failing tests** (in `floor-today-mark-moved.test.ts`, a new
  `describe("Back to its saved place checks what stands there")`; add a helper
  `placeTaken(tableId, standingId)` shaped like `newPlaceTaken` with code `table.place_taken`):
  1. **"after Leave it here, Back is refused while the table that blocked it stands there".** As
     Task 1 case 1 up to Leave it here. Take `everything()`. Expect `refusal(back(t3))` toEqual
     `placeTaken(t3, t8)`, and `everything()` unchanged. *Failing case on main:* 200, with t3 at
     `x: 40` overlapping t8 at 36 (plan review, experiment P1).
  2. **"Back after an ordinary drag is refused while another table stands in the saved place".**
     `threeNeedsMoving([{ key: "t8", standard: 120, dinner: 120 }])`; `markMoved(t3)` (t3 to
     x 40); move t3 to `{ x: 0, y: 0 }` and t8 to `{ x: 36, y: 0 }` through the `move` route
     (`send("POST", `/api/tables/${id}/today/move`, { x, y })`). Expect `refusal(back(t3))` toEqual
     `placeTaken(t3, t8)`, writing nothing. *Failing case on main:* 200 and an overlap (plan
     review, experiment P2).
  3. **"Back is still served when nothing stands in the saved place".** As case 2 but leave t8
     at 120. Expect 200 and `todayRow(t3)` `{ x: 40 }`. (A proof by deletion says nothing about
     what a check wrongly refuses, so the allowed path gets a case of its own.)
  4. **"a table standing exactly at its own saved place blocks nothing; one square off it, it
     does".** In `apps/server/src/floor-today-api.test.ts`, beside the Mark moved cases that use
     `overlappingDinner` (1936 onward), whose Dinner layout puts "two" at 40 and "four" at 44,
     overlapping. `overlappingDinner(44)`, `updateToDinner`, then drag "two" to `{ x: 0, y: 0 }`
     with `today(two, "move", …)`, then `today(two, "back")`. Expect 200 and "two" at `x: 40`:
     "four" stands exactly at its own saved place, which `fromSaved` true exempts (`blocksPlace`).
     Then a second case: as before, but move "four" to `{ x: 45, y: 0 }` before Back. Expect 409
     `table.place_taken` naming "four", as "still refuses Mark moved while the overlapping table
     stands one square off its own place" does for Mark moved.
- [ ] **Step 2: Run; cases 1, 2 and the second half of 4 fail** with status 200 instead of 409.
  `pnpm --filter @waitron/server exec vitest run src/floor-today-mark-moved.test.ts src/floor-today-api.test.ts`.
- [ ] **Step 3: Implement.** Export `refusePlaceTaken`. In `backToSaved`, after the `saved` checks
  and before `withMovedSlips`: when `placementOf(saved)` is not null, call
  `refusePlaceTaken(tx, zoneId, tableId, placementOf(saved)!, new Set([tableId, ...members]), true)`,
  with `zoneId` from `todayOf` and `members` the merge's table ids already worked out there. The
  store importing from `floor-today-reset-table.ts`, which imports the store, is the same import
  loop the store already has with `floor-today-mark-moved.ts` (`floor-today-store.ts:50`;
  `floor-today-mark-moved.ts:17-22`). If `pnpm lint` objects, move `refusePlaceTaken` to a new
  file both import, and say so.
- [ ] **Step 4: Run every Back suite.**
  `pnpm --filter @waitron/server exec vitest run src/floor-today-mark-moved.test.ts src/floor-today-api.test.ts src/floor-today-changes.test.ts src/floor-today-reset-table.test.ts src/floor-today-name.test.ts src/floor-today-split.test.ts src/today-names.test.ts`.
  All existing cases pass: "takes a table out of its merge when it goes back, and puts its partner
  back too" (`floor-today-changes.test.ts:308`) is the merge-partner case Back must still serve.
  An existing case that now fails because something stands in a saved place is a STOP: report it.
- [ ] **Step 5: Prove case 1 by deletion:** take the call out, see cases 1 and 2 fail, put it back.
  Run `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`,
  `pnpm --filter @waitron/server typecheck`, `pnpm format:check`.
- [ ] **Step 6: Commit** (`git commit -s`), e.g. "Back to its saved place refuses while another
  table stands there (A878)".

### Task 4: Till — client method, the three-button question, the list card, the words

**Files:**
- Modify: `apps/till/src/api/client.ts` (after `markMovedToday`, 4190-4194)
- Modify: `apps/till/src/screens/till-floor-screen.ts` (`#waitingDialog`, `#waitingCard`,
  a new `#leaveHere` beside `#markMoved` at 931-939)
- Modify: `apps/till/src/i18n/strings.ts` (EN after `floor.mark_moved` at 894; ES after 2447)
- Test: `apps/till/src/api/client.test.ts` (after the Mark moved case at 2741-2754),
  `apps/till/src/screens/till-floor-screen.needs-moving.test.ts`,
  `apps/till/src/screens/till-floor-screen.a11y.test.ts`

**Interfaces — Produces:** `TillApi.leaveHereToday(tableId: string, zoneRevision: number):
Promise<FloorAnswer>`, posting to `/api/tables/:id/today/leave-here` through `#todayChange`. The
string key `floor.leave_here`: EN "Leave it here", ES "Dejar aquí" (pending owner approval).
`data-leave-here` marks the button in the question and on the card.

- [ ] **Step 1: Write the failing tests.**
  - client: "sends Leave it here to its route with the room's revision, and returns the answer",
    a copy of the Mark moved case with path `/api/tables/t1/today/leave-here`.
  - needs-moving file: add `leaveHereToday` to `stubApi()`. Add a helper `footer(el)` giving the
    trimmed text of each `wt-button[slot="footer"]` in the move dialog, in order.
    1. "asks Cancel, Leave it here or Mark moved, in that order, and Leave it here sends the
       room's revision": the footer is `["Cancel", "Leave it here", "Mark moved"]`. Click
       `[data-leave-here]`, then `settle`. Expect `api.leaveHereToday` called with `("t3", 6)`,
       `api.markMovedToday` not called, the dialog closed.
    2. "asks the three in Spanish": with `setLocale("es")` the footer is `["Cancelar", "Dejar
       aquí", "Marcar movida"]`.
    3. "on the list the card offers Leave it here before Mark moved": the card's `wt-button`
       texts are `["Leave it here", "Mark moved"]`. Clicking `[data-leave-here]` calls
       `leaveHereToday("t3", 6)`.
    4. Extend "offers no Mark moved on a device that cannot change today's plan": also expect no
       `[data-leave-here]` in the question and on the card.
    5. "asks the floor to read again once Leave it here is answered": one `floor-refresh` and no
       refusal, as the Mark moved case.
    6. "says the room has moved on when Leave it here is refused": a rejected
       `{ code: "floor_today.out_of_date" }` shows `codeMessage("floor_today.out_of_date")` in
       `[data-floor-refusal]`.
    7. "offers Join with… once the floor read no longer shows the table needing moving": mount
       with `moving("t3", 12)` and `planned("t4", 30)`, then set `el.tables` to `planned("t3",
       12)` and `planned("t4", 30)` (what the read after Leave it here brings). Open the details
       sheet on t3 (`wt-table-details`) and expect `[data-today-action="join-with"]`. This passes
       before the change too: it pins that the till needs no change of its own for "joinable
       again".
  - a11y file: one case inside the `describe.each(["light", "dark"])`, "has no violations with
    the needs-moving question open", mounting a planned zone with a table `needsMoving: true`,
    tapping it, then `expectNoA11yViolations` as the file's other dialog cases do.
- [ ] **Step 2: Run them; they fail.**
  `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts src/screens/till-floor-screen.needs-moving.test.ts src/screens/till-floor-screen.a11y.test.ts`.
  Check free memory first (`memory_pressure | grep free`); this is a real-Chromium run. Expected:
  the new cases fail (`leaveHereToday` is not a function; no `[data-leave-here]`), except case 7.
- [ ] **Step 3: Implement.** Add the client method. Add the strings. In `#waitingDialog`, for
  `kind === "move"` draw Cancel `variant="ghost"`, then Leave it here (`variant="secondary"`,
  `data-leave-here`), then Mark moved `primary`, all `slot="footer"`. Leave it here and Mark moved
  are drawn only when `#actsOn(kind)`. The clear question is unchanged. In `#waitingCard` for
  `"move"`, add Leave it here (`size="sm" variant="secondary"`, `data-leave-here`) before Mark
  moved, under the same `#actsOn` test. `#leaveHere(table)` mirrors `#markMoved`: clear `moving`
  and `refusal`, then `#settle(#send(#revision(table.zoneId), (sent) =>
  api.leaveHereToday(table.id, sent)))`.
- [ ] **Step 4: Run the three files, then the rest of the floor screen's files:**
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen` (every file whose
  name starts so). Then `pnpm --filter @waitron/till typecheck`, because `es` is typed
  `Record<StringKey, string>` (`strings.ts:1586-1587`) and a key without Spanish fails there. Then
  `pnpm format:check`.
- [ ] **Step 5: Commit** (`git commit -s`), saying in the message that "Dejar aquí" awaits the
  owner's approval.

### Task 5: Till — the refusals: Leave it here offered; Back's `table.place_taken` in the code's words

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` (a new `@state() leaveOffer`, beside
  `refusal` at 638; `#settle` at 1254-1268; `#refusalText` and `#namedRefusal` at 1270-1291; the
  refusal line at 1944; `#markMoved`; the sheet's `"back"` case at 1101-1103)
- Test: `apps/till/src/screens/till-floor-screen.needs-moving.test.ts`,
  `apps/till/src/screens/till-floor-screen.reset-table.test.ts` (its Back cases at 673-686 and
  856-870 show how to press Back in the details sheet)

**Interfaces — Consumes:** Task 4's `#leaveHere` and `floor.leave_here`. **Produces:**
`[data-leave-here-offer]`, a `wt-button` drawn just after (not inside) `<p data-floor-refusal>`, so
the refusal's text, which existing cases compare whole, is unchanged. `#settle`'s new optional
fourth parameter, `{ tableId: string; back?: true }`: the table the write was for, and whether
the write was Back.

- [ ] **Step 1: Write the failing tests** (in the needs-moving file):
  1. Extend "names both tables when Mark moved is refused because another stands in the new
     place": the refusal text is unchanged, and `[data-leave-here-offer]` reads "Leave it here".
     Clicking it calls `leaveHereToday("t3", 6)` and clears the refusal and the offer.
  2. "offers Leave it here in Spanish": the Spanish case's offer reads "Dejar aquí".
  3. "offers Leave it here when the list card's Mark moved is refused".
  4. "offers Leave it here when Back to its saved place is refused for the table that needs
     moving": open the details sheet on t3 (`wt-table-details`), click
     `[data-today-action="back"]` with `backToSavedToday` rejecting `table.new_place_taken`. The
     offer leaves t3.
  5. "leaves the table pressed, not a part the refusal names": the rejection names
     `tableId: "t9"` (not on the read) and `standingId: "t4"`; the offer still calls
     `leaveHereToday("t3", 6)`.
  6. "offers nothing for other refusals": `table.booked` and `tab.already_open` show no
     `[data-leave-here-offer]`.
  7. "drops the offer once another refusal replaces it": after the offer shows, a refused drag
     (`mergeToday` rejecting `table.needs_moving`) leaves no `[data-leave-here-offer]`.
  8. "drops the offer once a read no longer has the table needing moving, or the device can no
     longer change today's plan": set `el.tables` to t3 not needing moving → offer gone; on a
     fresh mount, set `el.canChangeToday = false` → offer gone.
  9. **"says Back's place-taken refusal in the code's own words, offering nothing"** (in
     `till-floor-screen.reset-table.test.ts`, beside its Back cases): t3 not needing moving, t4
     on the read; `backToSavedToday` rejects `{ code: "table.place_taken", tableId: "t3",
     standingId: "t4" }`. Expect `[data-floor-refusal]` to read exactly
     `codeMessage("table.place_taken")`, and no `[data-leave-here-offer]`. In Spanish,
     `codeMessage("table.place_taken", "es")`. *Failing case today:* the screen names the tables
     with Reset table's sentence, "4 is standing in 3's place. Move 4, then Reset table again."
  10. **"Reset table's place-taken refusal still names the tables"**: the existing Reset table
      cases that check `floor.place_taken`'s sentence ("in %s, a table standing in the joined
      table's place is named", `till-floor-screen.reset-table.test.ts:606-620`, and the case at
      699-711) keep passing untouched. They are not rewritten; they are run in Step 4.
- [ ] **Step 2: Run; they fail.**
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.needs-moving.test.ts`.
- [ ] **Step 3: Implement.** Add `leaveOffer: { tableId: string; message: string } | null`.
  `#settle` takes the optional fourth parameter. In its catch: when it says `back` and the code is
  `table.place_taken`, set `refusal` to `codeMessage("table.place_taken")` instead of
  `#refusalText` (decision 8). Otherwise set `refusal` as today. Then set `leaveOffer` to
  `{ tableId, message: this.refusal }` when a table id is given and the code is
  `table.new_place_taken`, and to null otherwise. `#markMoved` passes `{ tableId: table.id }`; the
  sheet's `"back"` case passes `{ tableId: table.id, back: true }`. Draw the button only while `leaveOffer.message === this.refusal`,
  `canChangeToday` holds, and `this.tables` has that table with `needsMovingToday`. Any other
  refusal then hides it without anyone resetting the offer. Its click runs `#leaveHere`, which
  also sets `leaveOffer` to null.
- [ ] **Step 4: Run the floor screen's files and typecheck** as in Task 4 Step 4, and
  `pnpm format:check`.
- [ ] **Step 5: Commit** (`git commit -s`).

### Task 6: LOOK (scripted screenshots)

Open the real thing and look. No product code unless a defect is found; a defect is then fixed
test-first in the owning task's files, and the report says so.

- [ ] **Step 1:** Check `lsof +D <venue folder>` and `lsof -i :8080` for holders. Then, in this
  worktree, `wa-wt reset demo waitron-feat-a878-leave-it-here` and
  `wa-wt demo waitron-feat-a878-leave-it-here` (never a bare `pnpm dev*`).
- [ ] **Step 2:** Copy `/Users/clintongormley/waitron-campaign-b/a504-shots/look-till.mjs` to
  `/Users/clintongormley/waitron-campaign-b/a878-shots/look-till.mjs` (outside the repository),
  resolving Playwright through this worktree's `apps/till/package.json`. Adapt it so it reaches a
  table that needs moving whose new place another table stands in: through the dashboard, give the
  demo zone a second set that moves one table, seat a party at a table, update the layout, move a
  free table into the moved table's new place, then finish the party. It captures, each in English
  and Spanish, light and dark, at 1280 and 390 wide, named
  `till-<surface>-<lang>-<theme>-<width>.png`: `question` (the three-button question on the map);
  `card` (the list card with both buttons); `offer` (the `table.new_place_taken` refusal with
  Leave it here beside it); `left` (the map after Leave it here: the table at its old place in its
  free colour); `back-refused` (Back to its saved place pressed on the table left here, refused in
  the code's own words).
- [ ] **Step 3:** Run it with `node`; list each file written in
  `~/waitron-campaign-b/a878-shots/`.
- [ ] **Step 4:** Look at each one. Check that the footer's three buttons fit or wrap cleanly at
  390, that the card's two buttons fit or wrap without overflow, and that the offer sits under the
  refusal line in both themes. List every finding in the ledger, each fixed or stated. Hand the
  Spanish `question`, `card` and `offer` shots to the runner for the owner's wording question.

### Task 7: Docs and backlog

**Files:** `docs/superpowers/specs/2026-10-17-a504-floor-plans-design.md` (§7.4, 528-571),
`docs/developers/conventions-data.md` (1817-1829, and Back at 1934-1936),
`docs/developers/design-system.md` (873-875), `docs/backlog.md` and `docs/backlog/till.md`,
`~/waitron-campaign-b/item-a878-ledger.md`.

- [ ] **Step 1:** In the A504 spec §7.4, after the "Mark moved" bullet, add one dated pointer:
  "**Leave it here (A878, 2026-10-18).** A later owner decision added a third answer to the
  question: Leave it here keeps the table, with its joined group, where today's map has it until
  the next reset, without changing the saved layout. See
  [the A878 plan](../plans/2026-10-18-a878-leave-it-here.md)." Rewrite nothing else in the spec
  (historical docs get a dated pointer).
- [ ] **Step 2:** In conventions-data, after the Mark moved sentence (1822-1824), add what Leave
  it here does (`POST /api/tables/:id/today/leave-here`, `leaveHere`): the group's rows with a
  table become placed and unmarked, a row with no table is ended, and nothing re-marks them until
  the next reset rewrites the rows. Say which rows are ended at once and which wait for a rename,
  and why (question 1). Reword the Back paragraph (1934-1936): Back puts a table at its reset row's
  place, refusing `table.place_taken` while a table drawn on today's map, other than the table and
  its merge partners, stands there, with a table at its own saved place blocking nothing
  (`backToSaved`, `refusePlaceTaken`); on a table that needs moving it is Mark moved. In the "No
  reset puts a table down on another" paragraph (1831-1842), add Back to the paths that check.
  Read the whole floor section for other claims this change makes stale (CLAUDE.md §1, "A
  behaviour change retires every receipt").
- [ ] **Step 3:** In design-system (873-875), the list card carries Leave it here and Mark moved;
  the question's three buttons and their variants (plan decision 4); the Leave it here button
  beside a `table.new_place_taken` refusal.
- [ ] **Step 4:** Backlog. There is no A878 entry to delete. Add new entries to the till area of
  `docs/backlog.md`, each numbered from `~/waitron-campaign-shared/next-item-number` (read it, use
  it, write back the next): (a) "After Leave it here, bookings and the dashboard's table list
  still follow the last reset's copy, not today's map": in the case where the new layout joins 4
  and 5, the dashboard list leaves out 4 and 5 and lists the off-map 4+5, and a booking today at 4
  is refused `table.in_joined_table` (`savedPart`, `packages/db/src/joined-parts.ts:139-179`;
  `apps/server/src/tables.ts:54`; `packages/bookings/src/bookings.ts:50-73`; plan review
  experiments P3 and P4, 2026-10-18). It was already so while they needed moving. Next: decide
  whether those reads should follow today's map once a group is left. (b) Any Task 6 finding left
  open. The Spanish wording is not a backlog entry: the runner settles it before landing.
- [ ] **Step 5:** `pnpm exec vitest run scripts/claude-md-pointers.test.ts`;
  `pnpm exec prettier --file-info docs/developers/conventions-data.md` (it says whether the file
  is ignored; `docs/` is). Commit with the code (`git commit -s`): this branch is not docs-only.
  Update the ledger: what is done, the decisions above, and the next step (`/finish-branch` with
  this worktree, then the owner's Spanish answer). The owner-facing notes (ledger and PR
  description) list decisions 1–8 for the owner to confirm, and backlog entry (a).

---

## Self-review against the brief

- Three buttons, Cancel · Leave it here · Mark moved → Task 4. The refusal offers it → Task 5.
  Clears the mark, keeps the place, seatable and joinable → Task 1 cases 1 and 5, Task 4 case 7.
  Saved layout unchanged → case 1. The next reset tries again and may mark again → cases 3 and 4.
  `take-orders` and the room's revision → Task 1 route, Task 2, case 12. Map and list card →
  Task 4.
- Settle (1) → question 1 and cases 6–8 and 13. Settle (2) → question 2 and cases 2–3 with the
  deletion proof. Settle (3) → "Dejar aquí", flagged in Global constraints and in Tasks 4 and 6.
- Tests the brief lists: refused Mark moved then Leave it here (case 1); a later read does not
  re-mark (case 2); the next reset does (case 3); the profile-action refusal (Task 2); the three
  buttons in EN and ES (Task 4) and light and dark at 390 and 1280 (Task 6).
- Plan review: Back's place check → decision 7, Task 3, Task 5 case 9; rows ended at once →
  question 1, case 13; `savedPart` → reader table, Task 7 entry (a).
- Docs: the A504 spec pointer and backlog → Task 7.
- Migration: none, with the reason, the probe and the plan review's experiments.
