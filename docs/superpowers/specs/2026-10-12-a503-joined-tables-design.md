# A503: joined tables replace saved joins

> Added 2026-10-13 by A579 ([design](2026-10-13-a579-flattened-joined-tables-design.md)): that
> design replaces, under "The till", the Default for a joined table in a service merge (pushing a
> joined table into a group now splits it, and the group holds its real tables), **Join again**
> (now Reset table, which moves the joined table to its saved place and keeps the check on the
> tables it expects back, beside a new revision for the room), what Join again counts as free, and
> the reset's handling of a split-off table that needs clearing; its "What this replaces" lists each.

A short design, asked for by the owner before a plan (`docs/backlog/till.md`, "A503"). It replaces
the floor plan's saved joins with **joined tables**: a table, set up in the editor, that is made of
other tables. Points marked **Default** are the driver's choice and stand unless the owner overrides
them; points marked **Owner** follow the owner's answers of 2026-10-12 to the four questions this
design first raised (summed up under "Owner answers", below).

The example used throughout: **Long table** (10 seats) is made of **Counter 3** (2 seats, 2 × 2),
**Counter 4** (6 seats, 2 × 2) and **Counter 5** (4 seats, 2 × 2), drawn as one 6 × 2 rectangle by
the window. A joined table has two or more parts; three is the example because a pair hides the
cases where some parts stay joined.

Two words used below: the **till's copy** is what each day's reset copies from the saved plan into
today's plan on the till (a plan saved during the day reaches the till only at the next reset, spec
§6.3); a **live table** is the table the till seats, bills and books (`dining_tables`), one per table
on the saved plan.

## The owner's text

Quoted from `docs/backlog/till.md` (A503, owner 2026-10-11):

> - **Add joined table** in the editor asks for a name, a seat count, and the tables it is made of,
>   chosen from tables not on the plan ([mockup 5]; the tables list in [mockup 2]). The joined table
>   is placed on the plan as one table; its parts are marked "in <joined table>" in the tables list
>   and cannot be placed on their own. The list's last column shows what a joined table is made of.
>   The made-of picker lists tables in number order, as the tables list does.
> - **On the till a joined table can be split.** Its parts go side by side inside the outline the
>   joined table took up, each with its own seats.
> - **Two separate tables dragged together during service ask for the seat count.** Adding the two
>   tables' seats is wrong: two four-seat tables pushed together seat six.
> - Saved joins and the editor's Joins section go. Before go-live no data needs carrying over. "A
>   saved join's seats have no upper bound" (Small floor-plan refusals, below) goes with them; a
>   joined table's seats need their own bound.

Mockups: `docs/backlog/mockups/a502-a503-floor-plan-editor/5-add-joined-table.png` (the dialog) and
`2-tables-list-nothing-selected.png` (the list: an "in a joined table" marker, a "Made of" column,
and "+ Add joined table" beside "+ Add tables").

## How joins work today

Read on main `037643105`, not run. Three sets of join tables, all in the core migration set and
classified `state` (`packages/db/src/classification.ts:97-105`):

- **Saved joins**: `floor_plan_joins` (seats at least 1, no upper bound) and `floor_plan_join_tables`
  (`packages/db/src/schema/floor-plans.ts:118-155`), written by the editor's Joins section and its
  "Join {name}" dialog (`apps/dashboard/src/screens/floor-plan-add-join.ts`,
  `floor-plan-table-panel.ts:172-207`) and checked by `checkEntries`
  (`apps/server/src/floor-plan.ts:195-210`).
- **The till's copy of them**: `floor_reset_joins` and `floor_reset_join_tables`
  (`floor-plans.ts:195-239`), written by `copyJoins` at each reset
  (`apps/server/src/floor-today-store.ts:158-193`).
- **Today's merges**, the tables staff push together during service: `floor_today_joins` and
  `floor_today_join_tables` (`floor-plans.ts:282-327`), with where each table stood before.

A merge takes its seats from the request or, failing that, from the copied saved join with exactly
those tables (`savedJoinSeats`, `apps/server/src/floor-today-merges.ts:159-196, 224`); with neither it
refuses `merge.seats_required` (:225). Two till paths reach it — dropping one free table on another
(`#merge`, `apps/till/src/screens/till-floor-screen.ts:896-915`) and a join that seats or extends a
party (`#join`, :884-891; server `apps/server/src/till-api.ts:2477`) — and both then open the seats
prompt, starting from the tables' seats added together (`apps/till/src/state/floor-today.ts:93`).

Every table on the saved plan becomes a live table at the reset, placed or not
(`targetsFromMaster`, `apps/server/src/floor-reset-plan.ts:126-178`): an unplaced one is a **spare**
the till can put on the map (`placeSpareToday`, `floor-today-store.ts:520-542`), and a booking can
be made at any table in today's plan, spares included (`tableInService`,
`packages/db/src/table-in-service.ts:4-12`, used by `packages/bookings/src/bookings.ts:60`). The
reset treats each table on its own: one with a party, one merged with a held table, one a module
refuses or one in an unknown state waits; a free one is put back at once (`planReset`,
`floor-reset-plan.ts:76-96`).

## What changes

### Storage

- **Saved joins and the till's copy of them go**: the four tables above, with `savedJoinSeats` and
  `copyJoins`. Dropped by migration, children first; no data is carried over (CLAUDE.md §3, last
  rule).
- **Today's merges stay** (`floor_today_joins`, `floor_today_join_tables`): they are what a service
  merge is.
- **A joined table is a table**: a `floor_plan_tables` row with its own name, seats, shape and place,
  and its own live table, so a party, its bills and a booking sit at it as at any table.
- **What it is made of is a new table, `floor_plan_table_parts`**: the joined table's id and one
  part's id, both into `floor_plan_tables`, the part unique, so a table is part of at most one
  joined table (**Owner**: no table is in two joined tables). **Default:** a separate table rather than a column on
  `floor_plan_tables`. Whether adding a column with a foreign key would make the migration generator
  rebuild `floor_plan_tables` (which `floor_reset_tables` and `dining_tables` reference) was not
  measured; the separate table avoids the question. It goes in the core set because every floor
  table it references is there.
- **The till's copy carries the parts** (`floor_reset_table_parts`, the same shape over
  `floor_reset_tables`), so a joined table saved during the day changes the till at the next reset.
- **A split is recorded for the day**: one row per part split off a joined table, so the till knows
  which parts stand on their own and the reset or Join again can put them back. The plan names the
  columns. The seats of a joined table that has lost some parts are today's seats, which today's
  plan already holds per table (`floor_today_tables.seats`,
  `packages/db/src/schema/floor-plans.ts:266`), so they need no new column.
- **A part's size** has nowhere to live today: a part is a table not on the plan, and a table not on
  the plan has no size (`floor_plan_tables`' placement check sets all six of x, y, width, height,
  shape and rotation or none, `packages/db/src/schema/floor-plans.ts:52-73`). Owner question 5,
  below, decides where it comes from; the split waits for the answer, nothing before it does.
  > Added 2026-10-13 by A503 part 3: the split record is `floor_today_split_parts`; a part's size is
  > read from the saved plan when Split runs: the size the plan places it at, else its
  > `floor_plan_table_sizes` row, else 8 × 8.
- New tables are classified `state`. `floor_plan_table_parts` joins configuration transfer
  (`packages/db/src/configuration-transfer.ts:48-51`, which carries the saved plan only); all of them
  join the zone and department delete (`apps/server/src/floor-delete.ts`), the live-subscription
  lists (`apps/dashboard/src/api/live-queries.ts`, `packages/venue-service/src/dashboard/live-queries.ts`)
  and the schema guards (`scripts/schema-constraints.test.ts`). The plan lists the foreign keys into
  every dropped table before writing the migration (CLAUDE.md §3).
  > Added 2026-10-12 by A503 part 2: `packages/venue-service/src/dashboard/live-queries.ts` was left
  > unchanged; the plan found nothing it reads that the parts change.
- Other places the dropped tables are named, all to change: `packages/db/src/index.ts:87-93`,
  `apps/server/src/floor-plan.ts` (read and save, :126-136, :323-387),
  `apps/server/src/floor-delete.ts:76-85`, `apps/server/src/floor-today-merges.ts`, their tests and
  `floor-delete.bookings.test.ts`, `packages/db/src/schema/floor-plans.test.ts`, both
  `live-queries.test.ts`,
  `apps/server/src/service-delete.integration.test.ts`, `packages/venue-service/src/dashboard/client.test.ts`,
  the editor draft's joins (`apps/dashboard/src/screens/floor-plan-draft.ts`), and
  `apps/server/src/testing/floor-today-venue.ts`.

### Parts on the till

**Default** (following the owner's "cannot be placed on their own"): a part that is still joined
cannot stand on its own today. It is not offered as a spare and cannot be seated, joined to a party,
moved to, given a bill or added to the map; a request naming it is refused with a new code,
`table.in_joined_table`. A part split off stands on its own, as any table. The joined table stands
while two or more of its parts are still joined, and not once fewer are (the same refusal names it
then). `tableInService` (`packages/db/src/table-in-service.ts:4-12`) keeps its meaning, "on today's
plan in an active zone"; the new check sits beside it on the paths that put a party, a bill or an
order at a table. Its callers today are `apps/server/src/tables.ts:48, 288`,
`apps/server/src/move-bill.ts:222`, `apps/server/src/working-order.ts:1292, 7324`,
`apps/server/src/report-api.ts:156`, `packages/bookings/src/bookings.ts:60` and
`packages/venue-service/src/department-transfers.ts:426`; the plan says for each whether it takes
the new check.

**Bookings follow the saved plan, not today's split. Default:** a booking can never name a part
(refused `table.in_joined_table`, for any date) and can always name a joined table, whatever is
split today. A split decides only who sits where today.

### The editor (dashboard)

- **"+ Add joined table"** sits beside "+ Add tables" at the foot of the tables list (mockup 2) and
  opens the Add joined table dialog (mockup 5): Name, Seats and Made of, all three required and
  marked (mockup 5 shows no mark on Seats; the house rule marks every required field). Made of lists
  tables not on the plan and in no joined table, in number order, each with its seats, at least two
  chosen. It follows the save rule and the quiet-until-it-can-act rule (CLAUDE.md §3).
- **Seats. Default:** 1 to 999, starting empty — not the parts' seats added together, by the owner's
  own reasoning. That bound is the one today's merges and the till's seats prompt use
  (`apps/server/src/floor-today-api.ts:65`, `apps/till/src/widgets/today-seats-dialog.ts:21`). The
  server holds it; the database check stays the plain table's 0 to 999 or empty (`floor-plans.ts:57`).
- The new joined table starts **not placed**, as tables made by Add tables do
  (`apps/dashboard/src/screens/floor-plan-draft.ts:265-285`); clicking it in the list places it.
- **The tables list** shows a part greyed, with the "in a joined table" marker and "in Long table" in
  the Made of column; clicking a part does nothing. A joined table's Made of lists its parts in
  number order. **Default:** where every part's name is the same word and a number, the word is
  written once ("Counter 3, 4", mockup 2); otherwise names are written in full ("Window 1, Stool 2").
- **Changing what a joined table is made of. Default:** the selected joined table's form gains the
  same Made of picker.
- **Deleting. Default:** deleting a joined table frees its parts. Deleting a part takes it out of its
  joined table, and the delete question says so; a joined table left with fewer than two parts is
  refused at Save, beside the joined table.
- **The Joins section and the "Join {name}" dialog go**, with their strings and tests.
- **Server checks** (`checkEntries`), each refusing `floor_plan.invalid` with the field: at least two
  parts; each part a table of this plan, not placed, not a joined table itself; seats 1 to 999. The
  editor shows them beside the field (today only `tables.N.*` refusals are,
  `apps/dashboard/src/screens/floor-plan-editor.ts:781-785`).

### The till

- **A joined table is drawn and used as one table**, under its own name, with its own seats.
- **Split takes tables off a joined table** (**Owner**). It asks which parts to split off, listed in
  number order: one or more, never all. The parts split off become tables of their own, free. The
  rest stay together: two or more stay one joined table under its own name; a single one left is just
  that table, recorded as split off too. Split needs the joined table on today's map (not taken
  off). **Default** for a joined table in a service merge: parts may be split off while two or more
  stay joined, and the merge is untouched. A split down to one part first undoes the merge, which is
  refused while a party holds it (`tab.already_open`, `refuseHeld`,
  `apps/server/src/floor-today-table.ts:63-67`), as a merge's Split is today.
- **A party stays with what remains** (**Owner**). Split is allowed while a party is seated: the party
  and its bills stay at the joined table while two or more parts remain. When one part remains, the
  party's hold on the joined table passes to that part and nothing else changes: any other table the
  party holds stays held, and the joined table is not left needing clearing. (`moveGuests`,
  `apps/server/src/table-actions.ts:71-108`, is not the model: it moves a party off ALL its tables
  and leaves them needing clearing, :91-93.) **Default:** the kitchen is told the new table name, as
  a move tells it. A party that wants to spread over a split-off table takes it as any other table
  (seat it or join it, then split the bill if they want), and each table's seats for the day change
  with the till's existing Seats action (`apps/server/src/floor-today-api.ts:107`); Split itself
  never puts a party on a split-off part.
- **Seats** (**Owner**: a table's seats are the most seats that can be assigned there, not a cap on
  the party). Nothing is refused or warned because a party is larger than what remains. A split-off
  part has its own saved seats. **Default:** when two or more parts remain, Split also asks the
  remaining joined table's seats (empty, required, 1 to 999), as a merge asks, and they are today's
  seats for it; the saved seats come back when it is whole again.
- **A booking** at the joined table stays where it is. **Default:** the split dialog names a booking
  due today ("Booked at 21:00"), and once the joined table is out of service the booking is seated
  after Join again or the reset brings it back.
- **Where the parts go** (**Owner**): each part keeps its own size (Owner question 5), laid side by
  side from the joined table's left edge along its width, in number order, each centred on the
  outline's middle line, with the joined table's rotation and shape and the part's own Moveable
  setting. **Default:** the outline is where the joined table stands on today's map, turned about
  its centre as the till turns any table; each part's place is worked out over the whole joined
  table, whichever parts are split off, and kept in the part's own row of today's plan once it is
  split off, so a part split off later does not move one already standing. Long table (6 × 2) gives
  Counter 3 the left 2 × 2, Counter 4 the middle and Counter 5 the right.
- **An overflow is drawn as it falls.** Parts wider in total than the outline run past its right
  edge, and parts deeper than it stick out above and below; the till draws them there, over whatever
  they reach, and staff move a Moveable part if it is in the way. Parts narrower in total leave the
  rest of the outline empty. Nothing refuses either case, in the editor or on the till. **Default:**
  a place that would fall off the map (past 0 or 999) is pulled back inside it.
- **The joined table that remains is drawn over its remaining parts' places**: from the left edge of
  the first to the right edge of the last, at the joined table's own depth. **Default:** when the
  parts left are not next to each other (Counter 4 split off from between 3 and 5), the split-off
  part is drawn on top of the remaining joined table until staff move it.
- A part split off offers neither "Back to its saved place" (it has none) nor "Take off for today":
  it goes back through Join again or the reset.
  > Added 2026-10-13 by A503 part 4: the server refuses both on a table split off
  > (`table.split_off`, `refuseSplitOff`, `apps/server/src/floor-today-store.ts`); Put back is not
  > refused.
- **Join again** (**Owner**), on the joined table itself or on any of its free split-off parts, puts
  back that one joined table and touches no other table in the zone. **Default:** it takes back every
  split-off part that is free (no party, not needing clearing, in no merge), with no choosing, and
  is offered only when that leaves two or more parts joined. A part that is not free stays split
  off, and the action says which ("Counter 4 stays apart: guests seated"); Join again never moves a
  party. A part taken back leaves today's map wherever staff had moved it. The joined table, if it is
  on the map, keeps where it stands (a merge it is in is untouched); if it was not, it comes back to
  its saved place. When every part is back it has its saved seats; when some are still apart, Join
  again asks its seats as Split does. A party already at the joined table keeps it. Pushing the same
  tables together by hand makes an ordinary service merge instead, which never comes back under the
  joined table's name.
  > Added 2026-10-13 by A503 part 4: "free" also means no food on its way. When the joined table
  > stands on today's map, it keeps its turn and is laid out from where it stands, over the places
  > its tables had there: from the first to the last of those joined once more and those still
  > joined, or, when every table is back, from the first at its saved size. When it had come apart,
  > was taken off or has no place today, it is laid out the same way from its saved place, when it
  > has one (whole: its saved place). A table taken back gets its own saved seats. The request names the tables the
  > till expects back and is refused `joined_table.out_of_date` when they differ from those the
  > server finds free. It ends with the zone's catch-up (`catchUpZone`), so tables taken back after
  > "Reset to saved plan" count as joined again at once (`joinAgain`,
  > `apps/server/src/floor-today-join-again.ts`; `joinedPlaceAfter`,
  > `apps/server/src/joined-split-layout.ts`).
- **The reset puts a split joined table back whole only when it and every split-off part are free**
  and in no merge; until then everything stays as it is and the joined table waits, as a held table
  waits today (`planReset`, `apps/server/src/floor-reset-plan.ts:80-96`).
  > Added 2026-10-13 by A503 part 3 (review 5–9): a merge holds the group back only while one of its
  > tables waits (guests seated, or a module refusing); a merge nobody sits at is ended by the reset
  > as any free merge is, and the joined table is put back whole. Food on its way to any table of the
  > group holds it back too, and with it any merge one of the group's tables is in, until the food is
  > collected or its order is abandoned.
  >
  > Added 2026-10-13 by A579 part 1: when the reset puts the joined table back whole, it also clears
  > the "needs clearing" mark of each table split off it that the reset's copy of the saved plan still makes one of its
  > parts (owner, "Clear the mark").

### Service merges ask for seats

With saved joins gone a merge's seats come only from the request. **Default:** on both merge paths
the till's seats prompt opens **empty** (required, 1 to 999) instead of starting from the tables'
seats added together, which reverses spec §6.1's "suggesting the tables' seats added together" by
the owner's A503 text. Where the bills question comes first (`#join`), the seats prompt follows it.
Adding a third table to a merge asks again, empty. The server keeps refusing a merge without seats
with `merge.seats_required`.

### Docs

- The floor plan spec (`docs/superpowers/specs/2026-10-08-floor-plan-design.md` §3, §4, §6.1–§6.3,
  §7, §9, §13) gets dated pointers to this design rather than rewrites.
- `docs/developers/conventions-data.md`'s sentence that the reset copies joins changes with the code.
- The "A saved join's seats have no upper bound" bullet goes from `docs/backlog/till.md` and
  `docs/backlog.md`.

## Owner answers (2026-10-12)

The four questions this design first raised, answered in the campaign's questions file
(`~/waitron-campaign-c/questions.md`, "OWNER ANSWER … A503"):

1. **Split while a party is seated: allowed, by splitting tables off.** The owner's words: "ask the
   waiter which table(s) to split off from the joined table; the remaining table(s) remain joined (if
   there are more than one); the party remains with the remaining (possibly joined) table; if the
   party wants to split over more than one table, then they could take another table, assign the
   seats for each of the two tables, and optionally split the bill". And on seats: "the seat number
   is just the max full seats that can be assigned".
2. **One table in two joined tables: no.**
3. **Join again: yes, "specific to just that table".** Without it, pushing the same tables together
   makes a service merge that does not come back under the joined table's name. (The first draft
   said "Reset to saved plan" resets the whole zone; it does not: a held table waits and free ones
   are put back, `planReset`, `apps/server/src/floor-reset-plan.ts:80-96`.)
4. **Where the parts go: each keeps its own saved size, side by side from the left**, so the parts
   may not fill the outline, or may overflow it.

## Owner question

5. **Where a part's own size comes from.** A part is a table not on the plan, and a table not on the
   plan has no size today (see Storage). **Default (recommended):** a table keeps its width and
   height when it is taken off the plan, and a table made by Add tables starts at the new-table size
   (`NEW_TABLE_SIZE`, `packages/shared/src/floor-join.ts:15`), so a part's size is the size it last
   had on the plan. To resize a part, staff take it out of the joined table, place and resize it, and
   put it back. Alternative: the joined table's Made of list gives each part a Width and a Height of
   its own, set in the dialog and the form. Parts 1 and 2 of the build do not depend on the answer;
   the split (part 3) does.
   > Added 2026-10-13 by A503 part 3: the owner chose the default; the saved plan keeps a table's size
   > in `floor_plan_table_sizes` when it leaves the plan, and the editor puts it back at that size.

## Path, migrations and testing

- **Full path**: a migration dropping and adding core tables, and a contract between the server, the
  dashboard and the till. Parties and bills change only in a party moving to the one part left by a
  split, as Move guests moves it; bookings change only in refusing a part still joined.
- **Upgrade**: the migration drops any saved joins a box holds; before go-live that is accepted, and
  the PR says so in its first line if it needs a venue reset.
- **Tests first** for each refusal (asserting the code and its field), the till's copy of the parts,
  parts out of service, the split layout (an overflow and a gap among them), splitting off some parts
  with a party seated and the party moving when one part remains, Join again with a part held, the
  reset waiting for free parts, and the empty seats prompt on both merge paths. Joined-table tests
  use three or more parts, not only a pair. The golden huella test and `inmutabilidad` pass unedited.
- **Rough cut** (the plan decides; each part leaves `main` working):
  1. Saved joins removed everywhere — storage, server, the editor's Joins section, the copy — and the
     seats prompt opening empty on both merge paths.
  2. Joined tables: storage, server checks, the till's copy, parts out of service, and the editor's
     Add joined table, list and form. A joined table works as one table; it cannot yet be split.
  3. The till's Split: splitting parts off, the party staying or moving, the layout (after owner
     question 5).
  4. Join again and the reset waiting for free parts.
     > Added 2026-10-13 by A503 part 4: built; the reset half was built in part 3.
