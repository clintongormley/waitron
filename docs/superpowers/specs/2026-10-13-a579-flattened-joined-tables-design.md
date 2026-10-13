# A579: a joined table pushed into a group, Reset table, and out-of-date floor changes

A short design asked for by the owner before a plan (campaign queue, A579). It follows on from the
joined-tables design, [2026-10-12-a503-joined-tables-design.md](2026-10-12-a503-joined-tables-design.md),
and replaces parts of it (listed under "What this replaces"). Points marked **Default** are the
driver's choice and stand unless the owner overrides them; each one that changes what gets built is
asked under "Questions for the owner".

The example used throughout:

- **Long table** is a joined table (a table on the saved plan made of other tables): **Counter 3**
  (2 seats), **Counter 4** (6 seats) and **Counter 5** (4 seats), each 2 × 2 squares. Long table is
  saved as one 6 × 2 rectangle at its saved place by the window, with 10 seats.
- **Bar** is an ordinary table, 2 × 2, 4 seats, standing by the bar counter.
- A **group** is what the till makes when staff push tables together during service (the code calls
  it a merge: `floor_today_joins` and `floor_today_join_tables`). It lasts for the day, until it is
  split or the plan is reset.
- In every example a waiter **drags Bar onto Long table**, so Long table and its tables do not move
  when the group is made; Bar does.

Read on `77fabcfa3` (main, after #1608), not run unless a line says so.

## The owner's words

From the campaign queue, A579 (2026-10-13):

> "Maybe this becomes similar if, when joining long and bar, the joined table consists of all the
> constituent tables instead, ie they get flattened."

Confirmed with the worked example: Long table pushed together with Bar during service makes ONE
group of the four real tables — Counter 3, Counter 4, Counter 5, Bar — with no joined table inside
a group; the till has ONE action, "Split tables…", where staff tick which tables come off.

> "I think it is not join again, but reset table, which joins it and moves it to its original place
> (unless there is a table already in its place which isn't also going to be reset?)"

> "Either way if the screen is outdated then changes should be refused."

And on "Reset to saved plan" and a split-off table that needs clearing: "Clear the mark".

The owner kept these as built (2026-10-13 ~09:05): Back to saved place hidden on a joined table
until it is whole; a table put back on the plan keeps its old size; guests passing to a table marked
"needs clearing" split it and clear the mark; "Reset to saved plan" ends a group nobody sits at; a
table taken back gets its saved seats; one tap, no confirming window, when every table comes back.

## How it works today

- **Pushing Bar onto Long table** makes a group of two members, Long table and Bar (`writeMerge`,
  `apps/server/src/floor-today-merges.ts:154-201`). The till asks the group's seats, starting empty
  (`merge.seats_required`, :176). The map names a group by its tables in number order joined by
  "+" (`mergeLabel`, `packages/ui/src/components/wt-floor-map.ts:102-107`); bills and kitchen
  tickets join a party's tables with ", " (`TABLE_SEPARATOR`, `packages/shared/src/party-name.ts:3`).
  The shared first word is written once only when EVERY name shares it (`partyTablesName`, :7-20;
  the till's group heading uses the same, `#mergeName`, `till-floor-screen.ts:678-684`): "Counter
  3+4+5" and "Counter 3, 4, 5", but "Bar+Counter 3+Counter 4+Counter 5".
- **Two Split actions.** Long table's details sheet then offers both the group's **Split** and
  the joined table's **Split tables…** (`sheetActions`, `apps/till/src/state/floor-today.ts:280-301`).
  This is the pair of labels the owner's answer removes.
- **A table leaving a group** goes back to where it stood before the group was made, and a group
  left with one table ends, that table going back too (`leaveMergesRestoring` and `leaveMerges`,
  `floor-today-merges.ts:28-80`). The group's Split on a free group sends every table back
  (`splitFreeMerge`, :83-93). On a seated group the till takes the last table, in number order, off
  the party with a new empty bill (`apps/till/src/screens/till-floor-screen.ts:851-860`).
- **A table split off a joined table** is recorded in `floor_today_split_parts`. While fewer than two
  of Long table's tables are still joined to it, Long table is off the map and nobody can be
  seated at it (`joinedTableApart`, `packages/db/src/joined-parts.ts:32-44`;
  `outOfServiceJoined`, `floor-today.ts:184-189`). A booking can still name it: bookings refuse
  only a table that is part of a joined table on the saved plan
  (`packages/bookings/src/bookings.ts:55-69`). A table in a group, or with guests, does not count
  as still joined (`stillJoinedPart`, `joined-parts.ts:9-30`).
- **Join again** takes back every split-off table that is free. A table counts as not free when it
  has guests, needs clearing, is in a group or has food on its way (`freeOf`,
  `apps/server/src/floor-today-join-again.ts:21-43`). It is offered only when that leaves two or
  more tables joined (`joinAgainOf`, `floor-today.ts:240-264`). Long table keeps where it stands
  and grows back from its left edge; it goes to its saved place only when it was off the map or
  taken off (`joinedPlaceAfter`, `apps/server/src/joined-split-layout.ts:94-120`).
- **Reset to saved plan** waits for a split joined table and its split-off tables while any of them
  has guests, food on its way or is in a group with guests (`waitingTogether`,
  `apps/server/src/floor-today-store.ts:459-481`). It then takes the split-off tables back by
  deleting their split records (:373-378), and does not touch a "needs clearing" mark.
- **Out-of-date checks.** Only Join again names what the screen showed, and is refused
  `joined_table.out_of_date` when that differs (`floor-today-join-again.ts:76-79`). Every other
  floor change is applied to whatever the server holds; the full list is in "Out-of-date screens",
  below. After any floor change, refused or not, the till reads the floor again (`#settle`,
  `till-floor-screen.ts:979-992`). While the map is shown it also reads it every 15 seconds
  (:593-601).

## The flattened group

### What the server does when Bar is pushed onto Long table

1. **Long table's tables are split off it**, every one still joined to it, and recorded in
   `floor_today_split_parts`. Each stands in its place inside Long table's outline at its own size,
   with its saved seats, as Split tables… lays them out today (`partPlaces`,
   `joined-split-layout.ts:57-66`). Long table is now off the map.
2. **The group is made of the real tables**: Counter 3, 4, 5 and Bar, each with where it stood
   before (for the counters, their places inside Long table's outline). Bar snaps against the
   nearest counter, as it would against any table. The seats question opens empty, as built.
   Example: 12.
3. **Guests at Long table pass to its three tables**, as they pass to the last table when a split
   leaves one (`passGuestsTo`, `floor-today-split.ts:74-91`), and the group's guests then hold all
   four tables.

Dragging Long table onto Bar does the same, except that the three counters move together, keeping
their places side by side, until the nearest touches Bar. A joined table with tables already split
off brings only the tables still joined to it: Long table with Counter 5 split off brings Counter 3
and Counter 4.

Because the split records stay, the floor-wide reset's waiting rules apply unchanged: Long table and
all its tables wait while guests sit at the group, and a group nobody sits at is ended and Long table
put back whole (as built).

```
  Terrace                                                         ⋮
  ┌────────────────────────────────────────────────────────────────┐
  │   ┌──────┬──────┬──────┬──────┐                                │
  │   │ Bar  │  C3  │  C4  │  C5  │                                │
  │   └──────┴──────┴──────┴──────┘                                │
  │   Bar+Counter 3+Counter 4+Counter 5 · 12 seats                 │
  └────────────────────────────────────────────────────────────────┘
  Bar was dragged against Counter 3; the counters did not move.

  ┌ Bar+Counter 3+Counter 4+Counter 5 ───────┐
  │ 12 seats · free                          │
  │ [ Split tables… ]   [ Seats for today ]  │
  └──────────────────────────────────────────┘
```

The map name is what the till prints for these four tables today. A shorter "Bar+Counter 3+4+5"
would need new naming code; whether it should say Long table instead is owner question 1. The bill and kitchen tickets for guests here say "Bar, Counter 3, Counter 4, Counter 5"
(`partyTablesName` writes the shared word once only when every name shares it).

### What it costs

- **A booking at Long table can be made but cannot be seated while its tables are in a group.** Long
  table is off the map until the group lets its tables go and Long table is put back (question 3,
  only when nobody sits at the group), or Reset table or Reset to saved plan brings it back once its
  tables are free.
- **The same one "moved" kitchen slip as today.** Pushing Bar onto Long table's guests already sends
  one when food was sent, because their bill's table name changes (`joinTables`,
  `apps/server/src/table-actions.ts:134-137`; `enqueueMovedSlipsFor` sends only for a bill with
  items sent whose table name changed, `apps/server/src/kitchen-print.ts:1182-1194`). Here the name
  changes from "Long table" to the four tables instead. The plan reads what was sent once, before
  both the join and the guests passing to the counters, so it stays one slip.
- **Long table's name is gone from the map, the bill and the kitchen tickets** while its tables are
  in the group (question 1).
- **Four tables to clear.** When the guests finish, each of the four tables they held needs clearing
  where the venue uses that, where Long table alone would have. Mark cleared acts on one table
  (`/api/tables/:id/cleared`, `apps/server/src/till-api.ts:2405-2416`). I did not check whether the
  till marks a whole group at once.
- **New server work**: the push has to split, move the guests and, when Long table is dragged, move
  three tables together. Today `writeMerge` moves one table.

### Split tables… on the group

The details sheet of any table in the group has one action to separate it: **Split tables…**
("Separar mesas…"). The group's old **Split** goes. It lists the group's tables in number order.

```
  ┌ Split Bar+Counter 3+Counter 4+Counter 5 ─┐
  │ Tables to split off                      │
  │   [ ] Bar          4 seats               │
  │   [ ] Counter 3    2 seats               │
  │   [ ] Counter 4    6 seats               │
  │   [ ] Counter 5    4 seats               │
  │ Seats for what stays  [        ]  *      │
  │                     [Cancel]  [Split]    │
  └──────────────────────────────────────────┘
```

The rules:

- At least one table stays.
- **Each ticked table leaves the group as a table leaves a group today**: it goes back to where it
  stood before the group was made, and a group left with one table ends, that table going back too
  (`floor-today-merges.ts:28-80`). In these examples the counters never moved, so they stay where
  they are, and Bar goes back by the bar counter. Had Long table been dragged onto Bar instead, a
  ticked counter would go back to its place in Long table's outline by the window.
- **Seats.** When two or more tables stay in the group, the window asks their seats (empty,
  required, 1 to 999). One table left on its own keeps its own seats for today.
- **When the tables that stay are all from Long table, nothing else is left in the group, and
  nobody sits at it**: **Default** (owner question 3), the group ends and they are joined to Long
  table again where they stand. With all three, Long table is whole, in its saved 6 × 2 shape and
  its saved 10 seats, and no seats are asked. With some of them, it covers those, as Join again
  lays it out today, and the window asks its seats.
- **The same, with guests seated**: the counters stay a group, with the guests (question 2's
  default keeps them there), and the window asks its seats. Long table comes back later, through
  Reset table or Reset to saved plan once its tables are free: neither ever moves guests, and a
  table with guests does not count as still joined (`joined-parts.ts:19-22`).
- **Guests** stay with what stays (the owner's A503 answer 1). What a ticked table does when guests
  sit at the group is owner question 2. **Default:** it comes off without guests. It is marked
  "needs clearing" where the venue uses that, as Move guests leaves tables (`leaveForClearing`,
  `apps/server/src/parties.ts:598-609`). The kitchen gets a "moved" slip when a bill with food sent
  changes its table name, as above.
- Split tables… on Long table alone, when it is whole on the map, is unchanged.

**Bar ticked, nobody seated.** What stays is Counter 3, 4 and 5, all Long table's, so under
question 3's default Long table is put back, whole, and nothing is asked. With guests seated, the
three counters stay a group with them instead, and its seats are asked.

```
  ┌──────────────────┐                ┌──────┐
  │    Long table    │  10 seats      │ Bar  │  4 seats
  └──────────────────┘                └──────┘
  by the window, where its tables stood    back by the bar counter
```

Under the alternative, the three counters stay a group, "Counter 3+4+5", and the window asks its
seats. Long table comes back only with Reset to saved plan, or after its tables are split apart with
Split tables… and then put back with Reset table.

**Counter 5 ticked.** What stays is Counter 3, Counter 4 and Bar, a group, so its seats are asked.
Example: 10.

```
  ┌──────┬──────┬──────┐┌──────┐
  │ Bar  │  C3  │  C4  ││  C5  │
  └──────┴──────┴──────┘└──────┘
   Bar+Counter 3+Counter 4 · 10   Counter 5 · 4
```

Counter 5 stands on its own where it was, with its saved 4 seats, still recorded as split off Long
table.

**Bar and Counter 5 ticked, nobody seated.** What stays is Counter 3 and Counter 4, both Long
table's, so under question 3's default Long table is put back over them and its seats are asked. Example: 8.

```
  ┌────────────┐┌──────┐            ┌──────┐
  │ Long table ││  C5  │            │ Bar  │
  └────────────┘└──────┘            └──────┘
   8 seats      4 seats              back by the bar counter
```

This is the same state as Split tables… with Counter 5 ticked on Long table alone, and Reset table
brings Long table back whole.

**Counter 4 and Counter 5 ticked.** What stays is Counter 3 and Bar, a group, "Bar+Counter 3", and its
seats are asked. Counter 4 and Counter 5 stand on their own where they were, with their saved
seats. Guests at the group stay, at Bar and Counter 3.

### Pushing, moving and taking off a group

- **Pushing another table onto the group** adds it, as today. Pushing two joined tables together
  splits both, and Split tables… lists every real table of both.
- **Dragging a whole group onto another table** is refused, as today ("floor.drop_merge",
  `floor-today.ts:87`).
- **Moving** the group moves every table in it, as today (`moveToday`, `floor-today-store.ts:536-556`).
- **Rotate** and **Take off for today** are not offered on a table in a group, and the server
  refuses them (`table.merged`, `floor-today-store.ts:566, 638`). Unchanged.
- **Back to saved place** on a table in a group takes it out of the group, as built
  (`floor-today-store.ts:701`; offered by `floor-today.ts:298`). A counter split off Long table is
  still refused it (`table.split_off`, below).
- **Put back** brings back a table taken off. It never applies to a group, whose tables cannot be
  taken off. Unchanged, apart from the out-of-date check below.

## Reset table, in place of Join again

### What it does

"Reset table" replaces Join again, offered where Join again is: on Long table while it stands on
the map with tables split off, and on each of its split-off tables that is free. It is also offered
on a free split-off table whose fellow tables are in a group with guests, where it is refused with
a message (see "When Long table's tables are in a group with guests", below). It takes back the
free split-off tables and moves Long table to its **saved place**, turned as saved. With every table
back it has its saved seats. With some still apart it is laid out over the tables now joined, from its
saved place's left end, and asks its seats, as Join again asks today. Tables taken back get their
saved seats and leave the map. One tap, no confirming window, when every table comes back. It keeps
Join again's check on the tables it expects back (`joined_table.out_of_date`), and also sends the
room's revision (below).

A whole joined table, and every ordinary table, keep **Back to saved place** exactly as built; the
owner kept it on 2026-10-13.

What counts as free, so that Reset table takes it back, is owner question 4. **Default:** what the
floor-wide reset takes back:

- a table that needs clearing comes back and its mark is cleared;
- a table in a group nobody sits at comes back. That group ends, and its other tables go back to
  where they stood before it was made (Bar goes back by the bar counter);
- a table with guests, or with food on its way, stays apart.

**Example, every table free.** Counter 5 was split off. Staff then moved Long table (now 4 × 2) to
the middle of the room.

```
  before                                   after Reset table

  window ┆                                  window ┆┌──────────────────┐
         ┆                                         ┆│    Long table    │ 10 seats
         ┆   ┌────────────┐┌──────┐                ┆└──────────────────┘
         ┆   │ Long table ││  C5  │                ┆
         ┆   └────────────┘└──────┘                ┆
```

Long table is 6 × 2 again at its saved place by the window, with its saved 10 seats. Counter 5
leaves the map. Under #1608's Join again it would have stayed in the middle.

**Example, one table stays apart.** Counter 4 and Counter 5 were split off. Guests sit at Counter 5,
which stands at the right end of Long table's saved outline. Reset table takes Counter 4 back. Long
table goes to its saved place, laid out over Counter 3 and 4 (the left 4 × 2), and asks its seats.
Counter 5 stays where it is, beside it.

### When Long table's tables are in a group with guests

Counter 3 and Counter 4 are in a group with Bar where guests sit; Counter 5 stands alone, free. Today
the till offers nothing on Counter 5, because taking it back would leave fewer than two tables
joined (`joinAgainOf`, `floor-today.ts:258`). **Default:** Counter 5 offers Reset table, and pressing
it is refused, with a new code `joined_table.tables_in_group` naming them, and changes nothing:

```
  ┌ Terrace ──────────────────────────────────────────────────┐
  │ Counter 3 and Counter 4 are in Bar+Counter 3+Counter 4.    │
  │ Split them off first, then Reset table.                    │
  └────────────────────────────────────────────────────────────┘
```

When nobody sits at that group, question 4's default applies instead: the group ends and Long
table comes back whole.

### When another table stands in the saved place

The place checked is the one Long table would take: the whole saved 6 × 2, or with tables still
apart, the part of it over the tables now joined. Something stands in it when a table drawn on
today's map overlaps it. Tables that only touch its edge, the tables this Reset table takes back,
and Long table itself do not count. A table staying apart does count when it overlaps.

**Example.** Counter 5 was split off and Long table moved to the middle, as above. Then staff moved
Bar into the window spot. Bar overlaps Long table's saved place and is not being reset.

```
  ┌ Terrace ───────────────────────────────────────┐
  │ Bar is standing in Long table's place.          │
  │ Move Bar, then Reset table again.               │
  └─────────────────────────────────────────────────┘
```

**Default** (owner question 5): **refused**, with a new code, `table.place_taken`, naming the table
in the way. Nothing changes: Counter 5 stays split off and Long table stays where it is.
Alternative: Long table joins where it stands, as #1608's Join again does today. It takes Counter 5
back and grows from its left end in the middle of the room. When it is not on the map (fewer than
two of its tables were joined, or it was taken off), it goes to its saved place anyway, over Bar.

### Reset table and Reset to saved plan

**Reset to saved plan** (the zone menu, which asks first) does what Reset table does, for every
table in the zone at once, with three differences, all as built:

- It waits for a split joined table while any of its tables has guests, rather than taking back only
  the free ones.
- It ends every group nobody sits at, and a group with guests waits.
- It does not check what stands in a saved place: `planReset` decides each table from its own state
  only (`apps/server/src/floor-reset-plan.ts:76-102`). Reading it and the catch-up that applies it
  (`floor-today-store.ts:217-330`), I believe a table that waited (guests, or held by a module) can
  be put back over a free table that was moved into its place, and the reset can put a table back
  over one that waits there. Not run; proposed as a backlog entry rather than a change here.

**Reset to saved plan clears the mark** (owner, "Clear the mark"). When it takes a split-off table
back into its joined table, it also clears that table's "needs clearing" mark
(`dining_tables.needs_clearing_since`), where it deletes the split records
(`floor-today-store.ts:373-378`). This closes A573.

### A split-off table and the other actions

- **A table split off** (Counter 5): the server keeps refusing Back to saved place and Take off for
  today (`table.split_off`, `floor-today-store.ts:620-628`), as the owner's "refused either way"
  keeps. The refusal's wording becomes "That table was split off. Reset Long table first".
- **Long table with Counter 5 split off** can be taken off for today when it is free, as today
  (`floor-today.ts:299`). Reset table on Counter 5 later brings it back to its saved place (#1608
  already clears "taken off", `floor-today-join-again.ts:119-122`). This settles the third point of
  A575.

## Out-of-date screens: a standing rule for the till's floor

**Every floor change from the till sends the revision of the room its screen was drawn from. The
server refuses it when the room has changed since, before writing anything.** The till then says so
and reads the floor again (it already re-reads after every refusal, `till-floor-screen.ts:979-992`).

### The revision

**Default** (owner question 6): one **revision** per room (zone), a count that goes up by one at every
change to that room's plan for the day. Because one count covers the whole room, there is no way for
a change to slip through by forgetting to update some table's count.

- **Where it is kept.** The existing `floor_today_zones.generation` column
  (`packages/db/src/schema/floor-plans.ts:230-247`) is reused, so there is no migration. Product code
  only ever adds one to it at a reset (`floor-today-store.ts:106-116`); nothing else reads it. The
  plan names the TypeScript property `revision` over the unchanged column name `generation`. I
  believe drizzle generates no migration for that; the plan confirms by running the generator.
- **Tests that assert on it.** These change with it, because the spec changes what the column
  counts (the owner's decision of 2026-10-05: a test check may change when the item's spec changes
  what it checks; each change is listed in the PR, and each keeps what it was there to show):
  - `apps/server/src/floor-catch-up.test.ts` (:165-169, :427-438, :496-532) uses it to tell whether
    a reset ran. Those cases switch to a probe they already check beside it: the renamed label
    (:502, :532) and the kept place (:436).
  - `apps/server/src/floor-today-store.test.ts` (:249, :461-465, :484, :807-808, :993) pins its
    value after one or two resets.
  - `apps/server/src/floor-today-api.test.ts` (:139-143, :249-255, :343-350, :363) pins it at 1
    and unchanged after a reset of an inactive zone.
  - `packages/db/src/schema/floor-plans.test.ts` (:307-375, :787-801) writes it and pins that it
    starts at 0.
  - `apps/server/src/floor-delete.test.ts` (:168-169) writes it as setup.
- **What moves it.** Each table action, the zone reset, a guest action that starts or ends a group,
  and the catch-up. The catch-up "changed the room" when it makes ANY write to the room. Its own
  `changed` flag (`floor-today-store.ts:380-394`) is not enough: it counts only reset rows that stop
  waiting, and misses, for example, a table it hides (:321-327).
- **By how much.** By exactly one for each request that changes the room, however many writes it
  makes. A reset plus the catch-up it runs in the same request is one change, and goes up by one,
  as the reset's own +1 does today (:115).
- **The code.** A stale revision is refused `floor_today.out_of_date { zoneId, revision }` in one new
  code: "The floor has changed. Check and try again" ("La sala ha cambiado. Revísala y vuelve a
  intentarlo"). Its shape follows `floor_plan.out_of_date { zoneId, revision }`
  (`apps/server/src/errors.ts:663`), and its word follows the other `*.out_of_date` codes (:293, :386,
  :429). No code starts `floor_today.` today; the plan greps again before adding it.

### Order of events

- **Reading.** The floor read runs the catch-up and then reads the tables, in one transaction
  (`apps/server/src/till-api.ts:2291-2299`), and returns the revision as it stands after the catch-up.
- **Where it travels.** `GET /api/tables/state` answers a bare array of tables
  (`apps/till/src/api/client.ts:3049-3051`), and only the till reads it. To keep that shape, each
  table's `today` carries its room's revision, `zoneRevision`, the same number on every table of the
  room.
- **Writing.** A floor change compares the revision it sent first. It then runs its own catch-up
  (`ensureToday`, `floor-today-api.ts:104`); if that changes the room, the change is refused out of
  date too, since the screen did not show what the catch-up just did. The refusal undoes the
  catch-up with everything else, and the till's re-read runs it again and keeps it.
- **Answering.** Each floor change answers with the room's new revision (today the table routes
  answer 204, `floor-today-api.ts:107`), and the till carries it forward. A waiter's quick second
  drag is then not refused because of their own first.
- **Windows.** Split tables…, Reset table's seats window and Reset to saved plan's confirm window
  send the revision of the floor their contents were last drawn from.

### Every till floor action

| Till action                                         | Request                                    | Refused when stale today?                                                                                                                                  | Will send                                       |
| --------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Move (drag to empty space)                          | `POST /api/tables/:id/today/move`          | No (`floor-today-api.ts:111-114`)                                                                                                                          | revision                                        |
| Rotate                                              | `…/today/rotate`                           | No (:115)                                                                                                                                                  | revision                                        |
| Take off for today                                  | `…/today/take-off`                         | No (:116); refuses only what the server sees now (guests, clearing, group, food, split off; `floor-today-store.ts:631-647`)                                 | revision                                        |
| Put back                                            | `…/today/put-back`                         | No (:117; `putBackToday`, `floor-today-store.ts:649-656`, checks nothing more)                                                                             | revision                                        |
| Add a spare table                                   | `…/today/place`                            | No (:118-121)                                                                                                                                              | revision                                        |
| Seats for today                                     | `…/today/seats`                            | No (:122-125)                                                                                                                                              | revision                                        |
| Back to saved place                                 | `…/today/back`                             | No (:126)                                                                                                                                                  | revision                                        |
| Push two free tables together                       | `…/today/merge`                            | No; refuses a dragged table already in a group (`table.merged`, `floor-today-merges.ts:167`)                                                               | revision                                        |
| Split (a group, nobody seated) — goes               | `…/today/split`                            | No (:135)                                                                                                                                                  | (Split tables…)                                 |
| Split (a group, guests seated) — goes               | `POST /api/parties/:id/split-table`        | Party only: `party.out_of_date` (`till-floor-screen.ts:859`; `apps/server/src/table-actions.ts:261`)                                                       | (Split tables…)                                 |
| Split tables…                                       | `…/today/split-off`                        | No: it checks that each ticked table is still joined (`floor-today-split.ts:109-114`), not that what stays is what the screen showed. This is A564         | revision                                        |
| Join again (becomes Reset table)                    | `…/today/join-again`                       | **Yes**: names the tables it expects back, `joined_table.out_of_date` (`floor-today-join-again.ts:76-79`)                                                  | revision, and the tables it expects back        |
| Push a table onto one with guests, or Join with…    | `POST /api/parties/:id/join` with a merge  | Party only: `party.out_of_date` (`table-actions.ts:119`; the till sends what it read, `till-floor-screen.ts:924-930`). The group it makes is not checked   | revision, and the party revisions as today      |
| Reset to saved plan                                 | `POST /api/zones/:id/today/reset`          | No (`floor-today-api.ts:157-178`); the till asks first (`apps/till/src/widgets/floor-zone-menu.ts:121-129`)                                                | revision                                        |

Line numbers without a file name are `apps/server/src/floor-today-api.ts`. Seating a party at a
table, Move guests and Split a table on the order screen change guests, not the floor. They keep
their party check, move the room's revision when they end a group, and answer with it.

## Storage

- **A group stores real tables only.** A joined table is never a member of a group. Pushing it splits
  every table still joined to it, recorded in the existing `floor_today_split_parts`, and puts those
  tables in the group (existing `floor_today_join_tables`). No new table or column.
- **The revision** reuses `floor_today_zones.generation`; no migration (see above). Before go-live no
  data is carried over (CLAUDE.md §3, last data rule).
- **A group that already holds a joined table when this ships** (made by today's code) is a shape the
  new code never makes. A group nobody sits at needs nothing: Reset to saved plan or the next day's
  reset ends it (`floor-today-store.ts:364`), and Long table comes back whole. Only a group with
  guests seated at ship time stays. **Default:** a venue reset all the same, said in that PR's first
  line. That is acceptable before go-live, and simpler than teaching the new code the old shape.
- **A till still showing the old page** sends no revision. The server accepts a missing revision until
  the till part lands (see "Build"), so nothing breaks in between.

## What this replaces

From the A503 design and its owner answers:

1. **"A joined table is drawn and used as one table" inside a group, and the Default for a joined
   table in a service merge** (A503 design, "The till": parts split off while the merge is untouched;
   a split down to one first undoes the merge, refused while seated). Pushing a joined table now
   splits it, and the group holds its real tables.
2. **Two actions on a joined table in a group** (A503 part 3 question 1's default: "Split tables…"
   beside the group's "Split"). It becomes one Split tables… over the group's real tables, and the
   group's Split goes. The floor plan spec §6.2's "Split on a free merge separates it; with a party
   seated it runs today's split a table" goes with it (see question 2).
3. **Join again** (A503 design, "Join again"; part 4 question 1's default, "keeps where it stands").
   It becomes Reset table, which moves the joined table to its saved place, with the place check and
   the refusal when its tables are in a group with guests. Its check on the tables it expects back
   (`joined_table.out_of_date`) stays, with the room's revision beside it.
4. **Join again leaves apart a table that needs clearing or is in a group** (A503 design, "free").
   Under question 4's default it takes them back, clearing the mark and ending a group nobody sits
   at, which sends that group's other tables (Bar) back to where they stood.
5. **The reset leaves a split-off table's "needs clearing" mark** (part 4's default, A573). The
   reset clears it.

Kept as built: Back to saved place, hidden on a joined table until it is whole and unchanged on every
other table; a table put back on the plan keeps its old size; guests passing to a table that needs
clearing clear the mark; the reset ends a group nobody sits at; tables taken back get their saved
seats; one tap when every table comes back; the server refuses Back and Take off on a split-off table.

## Backlog entries A561–A575

| Entry                                                          | What this design does                                                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A561, A562 — a small table's name on the map and in the editor | Leaves them. More small tables appear on the map: every push splits a joined table.                                           |
| A563 — wording for a joined table off the map                  | Leaves it.                                                                                                                    |
| A564 — a stale second till splits down to one                  | **Closes it** (the revision).                                                                                                 |
| A565, A566 — what holds a reset back                           | Leaves them.                                                                                                                  |
| A567, A568 — a saved-plan edit or an early placement           | Leaves them.                                                                                                                  |
| A569 — the editor's Made of picker                             | Leaves it.                                                                                                                    |
| A570 — a refused removal leaves split records                  | Leaves it; its "Join again" becomes "Reset table".                                                                            |
| A571 — Long table off the map, with its free tables off the map | Leaves it; the zone menu would offer Reset table rather than Join again.                                                     |
| A572 — a table the saved plan added while guests sat at it     | Leaves it; Reset table inherits Join again's counting.                                                                        |
| A573 — the reset and "needs clearing"                          | **Closes it** (the reset clears the mark).                                                                                    |
| A574 — `joined_table.parts_split_off` could say what to do     | **Changes it**: its sentence becomes "Reset the table first".                                                                 |
| A575 — three things from #1608's look                          | **Changes it**: the out-of-date sentence is new (kept short for 390 px); the Join again window becomes Reset table's; Take off on Long table with tables split off is settled (allowed). |

New entry proposed: the floor-wide reset and its catch-up do not look at what stands in a saved
place, so a table can be put back over another (reading `planReset` and the catch-up; not run).

## Build

Path: **FULL** (two tills changing one group at once). Each PR leaves `main` working on its own; the
server part of each lands first with the old till still working, then the till. Tests first;
joined-table cases use three tables, not a pair.

1. **Reset to saved plan clears the mark** on a split-off table it takes back. Server only; can land
   first. Closes A573.
2. **The revision.**
   - 2a, server: `generation` reused as the revision, `zoneRevision` on the floor read, every floor
     change answering with the new revision, and a sent revision that differs refused
     `floor_today.out_of_date`. A missing one is still accepted, so the old till works.
   - 2b, till: sends it on every action and window in the table above and carries the answers
     forward; the server then refuses a missing revision. Closes A564.

   Tests: for each action, a second till acting from the old revision is refused and nothing is
   written. Control: with the comparison deleted, the stale case is applied.
3. **The flattened group.**
   - 3a, server: Bar dragged onto Long table and Long table dragged onto Bar store the real tables,
     Long table's tables recorded as split off, the guests passing to them with one "moved" slip.
     The old till's group Split and Split tables… still work on a group of real tables. The PR's
     first line asks for a venue reset.
   - 3b, server: Split tables… on a group (the route takes ticked tables from anywhere in the
     group, with the seats rule and question 2's guests rule) and Long table put back when only its
     tables stay and nobody sits there (question 3). The old till keeps its own actions.
   - 3c, till: one Split tables… on a group listing real tables; the group's Split goes.
4. **Reset table.**
   - 4a, server: the saved place, the place check (`table.place_taken`, or question 5's
     alternative), what counts as free (question 4), the refusal for tables in a group with guests
     (`joined_table.tables_in_group`), keeping the tables-expected check.
   - 4b, till: the action's name, its window and wording, offered on Counter 5 in the group case.

Docs in the same changes: dated pointers in the floor plan spec §6.1–§6.3 and in the A503 design,
and the backlog entries above.

## Questions for the owner

The example for all six: Long table = Counter 3 (2 seats), Counter 4 (6 seats), Counter 5 (4 seats),
saved as one 6 × 2 rectangle by the window with 10 seats; Bar is a 4-seat table by the bar counter.
A waiter drags Bar onto Long table, which makes one group of Bar, Counter 3, 4 and 5.

1. **What the group is called, and what the bill and kitchen tickets say.** A party of 12 sits at the
   group. **Default:** the real tables everywhere, exactly as the till names any group today: the
   map says "Bar+Counter 3+Counter 4+Counter 5 · 12 seats", the bill and kitchen tickets say "Bar,
   Counter 3, Counter 4, Counter 5". Alternative: Long table's name while all its tables are in the
   group: "Bar+Long table" on the map, "Bar, Long table" on the bill and tickets. This needs new
   naming code on the map, the bill and the kitchen tickets.
2. **A table ticked off while guests sit at the group.** The party of 12 sits at the group; the
   waiter opens Split tables… and ticks Bar. **Default:** Bar comes off without guests and the party
   stays at Counter 3, 4 and 5. Bar is marked "needs clearing" where the venue uses that, as Move
   guests leaves tables, and the kitchen gets a "moved" slip if food was already sent. For a bill of
   its own at Bar, staff use the order screen's Split a table instead, which already gives Bar its
   own guests and takes it out of the group (`apps/server/src/till-api.ts:2503-2533`). Alternative:
   Bar keeps guests of its own with a new empty bill, as Split on a seated pushed-together pair does
   today.
3. **When Bar comes off and only Long table's tables are left.** The waiter ticks Bar.
   **Default:** with nobody seated, Counter 3, 4 and 5 become Long table again where they stand,
   whole, 6 × 2, with its saved 10 seats, and nothing is asked (with only Counter 3 and 4 left, Long
   table covers those and its seats are asked). With the party of 12 seated, they stay a group,
   "Counter 3+4+5", with the party, and its seats are asked; Long table comes back later, through
   Reset table or Reset to saved plan once the party has left, because neither ever moves guests.
   Alternative: they always stay a group, "Counter 3+4+5", and its seats are asked; Long table comes
   back only with Reset to saved plan, or after splitting the counters apart and pressing Reset
   table.
4. **What Reset table takes back.** Counter 4 was split off and is marked "needs clearing". Counter 5
   was split off and pushed together with Bar, with nobody seated. The waiter presses Reset table.
   **Default:** it takes both back, as Reset to saved plan would: Counter 4's mark is cleared, the
   Counter 5 + Bar group ends and Bar goes back by the bar counter. Long table is whole at its saved
   place with 10 seats. A table with guests or food on its way still stays apart. Alternative, as
   Join again does today: both stay apart. Long table would then have only Counter 3, so Reset table
   is not offered.
5. **Reset table when another table stands in the saved place.** Counter 5 is split off, Long table
   was moved to the middle of the room, and Bar now stands by the window in Long table's saved
   place. **Default:** refused, and nothing changes: "Bar is standing in Long table's place. Move
   Bar, then Reset table again." Alternative: Long table takes Counter 5 back and joins where it
   stands, in the middle, as Join again does today.
6. **How much has to change before a screen counts as out of date.** Till A shows the Terrace. Till
   B moves Table 7 in the far corner. Ten seconds later, before Till A's next read, Till A presses
   Take off on Table 2. **Default:** refused, "The floor has changed. Check and try again"; Till A
   re-reads at once and the waiter presses again. One count covers the whole room and goes up at
   every change in it, so no change can slip past it. Alternative: only a change to the tables an
   action touches counts, so Table 2 is taken off at once. Every change then has to update the count
   of each table it touches, including every table of a group or joined table, and a change that
   misses one lets an out-of-date action through.
