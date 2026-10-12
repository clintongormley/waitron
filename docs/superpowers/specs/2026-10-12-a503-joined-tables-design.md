# A503: joined tables replace saved joins

A short design, asked for by the owner before a plan (`docs/backlog/till.md`, "A503"). It replaces
the floor plan's saved joins with **joined tables**: a table, set up in the editor, that is made of
other tables. Points marked **Default** are the driver's choice and stand unless the owner overrides
them; points marked **Owner question** wait for an answer before the build starts, because they
change what is stored or how the till splits tables.

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
reset treats each table on its own: one with a party waits, a free one is put back at once
(`planReset`, `floor-reset-plan.ts:80-96`).

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
  joined table (Owner question 2). **Default:** a separate table rather than a column on
  `floor_plan_tables`. Whether adding a column with a foreign key would make the migration generator
  rebuild `floor_plan_tables` (which `floor_reset_tables` and `dining_tables` reference) was not
  measured; the separate table avoids the question. It goes in the core set because every floor
  table it references is there.
- **The till's copy carries the parts** (`floor_reset_table_parts`, the same shape over
  `floor_reset_tables`), so a joined table saved during the day changes the till at the next reset.
- **A split is recorded for the day**: one row per split joined table, so the till draws the parts in
  its place and the reset or Join again (Owner question 3) can put it back. The plan names the
  columns.
- New tables are classified `state`. `floor_plan_table_parts` joins configuration transfer
  (`packages/db/src/configuration-transfer.ts:48-51`, which carries the saved plan only); all of them
  join the zone and department delete (`apps/server/src/floor-delete.ts`), the live-subscription
  lists (`apps/dashboard/src/api/live-queries.ts`, `packages/venue-service/src/dashboard/live-queries.ts`)
  and the schema guards (`scripts/schema-constraints.test.ts`). The plan lists the foreign keys into
  every dropped table before writing the migration (CLAUDE.md §3).
- Other places the dropped tables are named, all to change: `packages/db/src/index.ts:87-93`,
  `apps/server/src/floor-plan.ts` (read and save, :126-136, :323-387),
  `apps/server/src/service-delete.integration.test.ts`, `packages/venue-service/src/dashboard/client.test.ts`,
  the editor draft's joins (`apps/dashboard/src/screens/floor-plan-draft.ts`), and
  `apps/server/src/testing/floor-today-venue.ts`.

### Parts on the till

**Default** (following the owner's "cannot be placed on their own"): while a joined table is whole,
its parts are out of service on the till. They are not offered as spares, cannot be seated, booked
or added to the map, and a request naming one is refused with a new code, `table.in_joined_table`.
After a split the joined table is out of service and its parts are in service. The rule lives where
"in service" is decided today (`tableInService`, `placeSpareToday`), so bookings and the till follow
it without their own copies.

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
- **Split** is the action's name, as the owner wrote it. On a joined table that is also in a service
  merge, Split first undoes the merge; pressed again, it splits the joined table. Split needs the
  joined table on today's map (not taken off) and is subject to Owner question 1.
- **Where the parts go** (Owner question 4): **default**, the outline is cut into equal slices along
  its longer side, one per part, in number order, each with the joined table's rotation and shape
  and the part's own saved seats and Moveable setting.
- A part of a split joined table offers neither "Back to its saved place" (it has none) nor "Take off
  for today": it goes back through Join again or the reset.
- **The reset puts a split joined table back only when every part is free** and in no merge; until
  then the parts stay and the joined table waits, as an occupied table waits today.

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

## Owner questions

These change what is stored or how the till splits, so the build waits for them. Each is in
`~/waitron-campaign-c/questions.md` with a worked example.

1. **Splitting a joined table with a party seated, or booked later today.** Default: refused while
   a party is seated (as a free merge's Split is refused today while one of its tables is held,
   `tab.already_open` from `refuseHeld`, `apps/server/src/floor-today-merges.ts:85-95` and
   `apps/server/src/floor-today-table.ts:63-67`); allowed when it is only
   booked, after a question naming the booking, and the booking can be seated once the joined table
   is back.
2. **One table in two joined tables** (Long table = Counter 3 + 4 and Big table = Counter 3 + 4 + 5,
   one on the plan at a time). Default: no; the owner's "in <joined table>" already reads singular.
3. **Putting a split joined table back during service.** Default: a **Join again** action on any of
   its parts while every part is free and in no merge, putting the joined table back where it stood
   with its saved seats. Without it, staff use "Reset to saved plan" (spec §6.2), which resets the
   whole zone, or wait for the next day.
4. **Where the parts go on a split.** Default: equal slices of the outline along its longer side.

## Path, migrations and testing

- **Full path**: a migration dropping and adding core tables, and a contract between the server, the
  dashboard and the till. Parties and bills do not change; bookings change only in refusing a part
  of a whole joined table.
- **Upgrade**: the migration drops any saved joins a box holds; before go-live that is accepted, and
  the PR says so in its first line if it needs a venue reset.
- **Tests first** for each refusal (asserting the code and its field), the till's copy of the parts,
  parts out of service, the split layout and its refusals, the reset waiting for free parts, and the
  empty seats prompt on both merge paths. The golden huella test and `inmutabilidad` pass unedited.
- **Rough cut** (the plan decides; each part leaves `main` working):
  1. Saved joins removed everywhere — storage, server, the editor's Joins section, the copy — and the
     seats prompt opening empty on both merge paths.
  2. Joined tables: storage, server checks, the till's copy, parts out of service, and the editor's
     Add joined table, list and form. A joined table works as one table; it cannot yet be split.
  3. The till's Split, the reset waiting for free parts, and Join again.
