# A504 Floor plan sets, one per service period — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Every task is test-first: write the failing test, run it, see it fail
> for the reason stated, then write the least code that passes.
>
> **Existing assertions.** A task may change an existing assertion only where it pins behaviour
> this plan removes (listed under "Behaviour this plan removes"), and only in a separate commit
> whose message begins `Changed test checks (A504):` and lists each `file:line` with its before and
> after. Any other assertion that turns out to need changing is a STOP: report it, do not edit it.
> Changing a call's arguments, a fixture's setup or a helper's signature is not changing an
> assertion.
>
> **Size.** Each task is sized for one implementer at medium effort well under 100 tool calls. An
> implementer past about 150 calls with the task unfinished stops at a passing or cleanly red
> point, commits, and returns a handover: done, left, files, each check's state.
>
> **Citations.** Every `file:line` below was read at `main` `9d6ccd7b8` (2026-10-17). Lines drift;
> search for the named symbol if a line has moved.

**Goal:** each department keeps named sets of floor plans, a period picks the set its zones use,
and the till offers the period's layout with an Update layout banner, moving occupied tables only
when someone marks them moved.

**Architecture:** a zone's tables become shared by every set (`floor_plan_tables` keyed by zone);
each set holds one layout per zone (`floor_plans` keyed by set and zone, places in a new
`floor_plan_placements`). Venue-service owns which sets a department has, their names and default,
and which set each period picks; it answers, through the venue-service seat, which layout is due
for each zone at a moment. Core keeps the editor, the resets and today's plan: every reset reads
one set's layout, records what it was made from on `floor_today_zones`, and leaves a waiting table
marked `ready_to_move` ("Needs moving") instead of moving it later by itself. The Floor plans page
is a venue-service dashboard screen; the editor stays a core screen.

**Tech stack:** TypeScript, drizzle on SQLite (`node:sqlite`), drizzle-kit 0.31.11, Hono, Lit,
Vitest (node and real-Chromium browser projects).

**Spec:** [A504: floor plan sets, one per service period](../specs/2026-10-17-a504-floor-plans-design.md)
(Revision 2, owner-answered). Its "Decisions this revision makes" 1–22 are built as written unless
a decision below says otherwise. Owner answers: lane B `questions.md`, "OWNER ANSWERS 2026-10-17
~10:45 … A504". Mock-ups: `docs/backlog/mockups/a504-floor-plans/`.

**Risk path: FULL ceremony.** It has a migration in two sets, and changes a cross-package contract
(`VenueServiceContribution` and `CoreServices` in `packages/module/src/module.ts`, the till's
`GET /api/zones` and `GET /api/tables/state` answers). Per-task reviews run; `/finish-branch` runs
the full wave with two Codex run-it seats.

## Decisions this plan makes that the spec does not

The owner confirms or overrides these when reviewing the plan; each names the DEFAULT built.

1. **A set's name and default live in venue-service, not core.** Core `floor_plan_sets` holds only
   `id` and `location_id`. Venue-service `department_floor_plan_sets` holds `set_id` (primary
   key), `department_id`, `name` and `is_default`, with a unique index on `(department_id, name)`
   and a partial unique index on `department_id` where `is_default`. The spec's sketch (§9) put the
   name in core; there no index could hold "unique within the department", and CLAUDE.md §3 wants
   every unique rule declared in the schema.
2. **A layout row is made on first save or copy.** A set with no `floor_plans` row for a zone reads
   as that zone's layout with every table put away, at revision 0. A save that changes the zone's
   shared tables (adds, deletes or renames a table, or changes its seats, "Moveable" or a joined
   table's parts) moves the revision of every layout of the zone in its department's sets,
   writing the missing rows; a save that only moves tables moves its own layout's revision. Spec
   §9 left this open with "the proposal is yes". Without it, an editor open on another set could
   save a stale table list and delete a table the first editor added (`checkSave` deletes every
   table missing from the draft, `apps/server/src/floor-plan.ts:301-302`, `352`).
3. **The Floor plans page is venue-service's** (screen `floor-plans`, Operations group, order 13,
   after Prep stations at 12 and before the Calendar at 15, so Prep stations still follows
   Departments and zones as A725 decided (ruling 2026-10-18, Task 20),
   `packages/venue-service/src/dashboard/index.ts:16-21`, `75-79`), needing `venue.configure` with
   `venue.view` reading it. Its routes are venue-service's; the layout rows they make and copy go
   through a new core port, `CoreServices.floorPlanSets`, and every removal of a set goes through
   one verb on the existing deletion port, `FloorDeletion.removeSets`, as zone deletion already
   goes through `CoreServices.floorDeletion` (`packages/module/src/module.ts:36-43`, `94-101`).
4. **The editor keeps its own address word:** `/manage/floor-plan/set/{set}/zone/{zone}?back=…`,
   not the spec's `/manage/floor-plans/set/…` (§5). The page is a module screen and the editor a
   core screen, and each screen owns the first word of its address (`dashboardPath.children`,
   `apps/dashboard/src/navigation.ts:3-36`).
5. **A zone in no department has no floor plan** until it is assigned: no map, no banner, not on the
   Floor plans page. A zone moved to another department keeps its old layouts unseen and starts
   with every table put away in the new department's sets (decision 2 makes that the reading of a
   missing row). Spec §11 left both open.
6. **Deleting a department deletes its sets and their layouts**, and its delete dialog counts them
   under the impact key `floor_plan_sets`. Its periods' Floor plan fields are emptied first.
7. **A zone's own closed times and its own "keep open" do not change which layout is due**; only
   the department's periods do (spec §11 left it open).
8. **A joined table and its tables wait together** at every reset, as a split group already does
   (`waitingTogether`, `apps/server/src/floor-today-store.ts:500-517`). When they become free, each
   of them drawn on today's map whose change moves it shows "Needs moving", and Mark moved on any of
   them applies the whole group's change (spec §11's proposal).
9. **Whether a joined table holds its tables is read from today's map, not from the saved
   plan.** Today a part is "still joined" whenever its joined table has a live table, wherever
   either stands (`stillJoinedPart`, `packages/db/src/joined-parts.ts:9-29`), so a layout that
   stands 4 and 5 and leaves 4+5 off would leave 4 and 5 out of service and 4+5 offered as a spare
   — the reverse of spec §4.2. The rule becomes two branches (Task 7b): a part is still joined
   while its joined table is drawn on today's map, whether or not the part's own reset row still
   waits; or, when the joined table is not drawn, while the part's reset row has been applied (as
   today) and none of the joined table's parts that were not split off today is drawn. So under Standard (4 and 5 drawn, 4+5 off) 4 and 5 are free tables
   and 4+5 has "come apart" (`joinedTableApart`, `joined-parts.ts:32-44`), which keeps it out of
   every spare list and picker (`sparesOf`, `apps/till/src/state/floor-today.ts:288-297`); under
   Dinner (4+5 drawn) 4 and 5 are out of service as today; with 4+5 and its tables all off, 4+5
   stays a spare that can be placed, as today. Reading the map rather than the new layout is what
   keeps 4 and 5 out of service while 4+5 still has guests waiting to be taken apart. `copyParts`
   keeps copying every shared part (the link is shared; whether it holds is the map's question).
   `savedPart` (`joined-parts.ts:52-58`), which hides parts from `GET /api/tables`
   (`apps/server/src/tables.ts:51`) and makes bookings refuse them (`packages/bookings/src/bookings.ts:55-69`),
   reads the zone's recorded layout, and only a record of the business day asked about (spec
   decision 2): a part is a saved part when that layout places its joined table, or places none
   of its parts; a joined table that layout leaves off while placing one of its parts is a saved
   part too, so under Standard 4+5 is neither listed nor bookable, as the till cannot seat it.
   With no usable record the pre-A504 reading holds. A part's place in a layout that places its joined table
   reads as off, so a change of parts saved in one set never makes another set's layout invalid.
10. **A table off today's map never shows "Needs moving".** A table in store, or taken off for
    today, is not drawn, so there is nothing to carry. Such a table whose new place is taken waits
    for that place, and a later read puts it on the map once nothing stands there that does not
    itself need moving. Update layout keeps a taken-off table off, at its new place.
11. **Mark moved on a table that does not need moving changes nothing** and answers the room's
    revision, as Put back on a table not taken off does (`putBackToday`,
    `apps/server/src/floor-today-store.ts:693-700`). No new code.
12. **On a day with no period, the banner says "A newer layout is ready."** Decision 5 of the spec
    would otherwise print "{period} layout is ready." with no period to name.
13. **Reset to … plan when the recorded set is gone** (a till that read the menu before the set
    was deleted) is refused `floor_today.layout_changed`, so the till reads again and shows the
    banner. On a zone with no record yet, it resets onto the due layout as the day's first reset
    would.
14. **`ready_to_move` is part of the room's print** (`roomPrints`,
    `apps/server/src/floor-revision.ts:62-104`), so a read that marks a table "Needs moving" moves
    the room's revision, and a change sent from an older map is refused `floor_today.out_of_date`.
15. **Codes beyond the spec's four:** `floor_plan_set.not_found` { setId },
    `floor_plan_set.name_taken` { departmentId, name }, `floor_plan_set.is_default` { setId }
    (deleting the default), and `menu_period.invalid`'s `field` gains `"floorPlanSetId"` (a set of
    another department). `floor_plan_set.invalid` keeps the spec's { field } and is also used for
    `"name"`, `"departmentId"`, `"fromSetId"` and `"replaceWith"`.
16. **The zones read works the due layout out at `deps.clock.now().instant`**, so tests can fix
    the moment; its closing states keep their `new Date()` (`apps/server/src/till-api.ts:2614`).
    (2026-10-18, finish review: the closing states now read the same `deps.clock.now().instant`,
    once per request, sharing one clock and day plan with the due layout.)
17. **The grey default is a new `muted` flag on `wt-combobox` options** (`ComboboxOption`,
    `packages/ui/src/components/wt-combobox.ts:11-34`): a muted option is drawn in
    `--wt-color-text-muted` in the list and, when chosen, on the closed field. Its value is `""`.
18. **On the Floor plans page a department lists its default set first, then the others by name;**
    zone rows follow the department's zone order. Copy… and Add set start with an empty name.
19. **A zone "has a plan" on the till** (`FloorZone.hasPlan`, `apps/till/src/api/client.ts:1835-1836`)
    **when its department has a set.**
20. **The phone switch follows `matchMedia(PHONE_WIDTH)`**, as the counter screen does
    (`apps/till/src/screens/till-counter-screen.ts:250-262`).
21. **Seeds:** the demo seed gives each department one set named "Standard" ("Estándar" in a
    Spanish seed) holding the zones' current tables. Provisioning makes none (spec decision 18:
    "A department starts with no sets").
22. **A "keep open" that pushes the next run's start later does not make that run a new
    occurrence.** `withExtension` cuts a range that overlaps the extension and restarts it at the
    extension's end (`packages/venue-service/src/service-day.ts:161-184`), which changes the run's
    occurrence key. Without a rule, Update layout at 16:05 records Dinner 20:00, Lunch kept open
    at 16:10 until 20:30 turns Dinner into a 20:30 run, the recorded occurrence counts as gone, and
    Lunch's layout is offered again — which answer 7(a) rules out. **This amends the spec's
    definition of "gone"** (spec decision 1, "A key whose period has been deleted, or that has no
    run starting at that time today, counts as 'the recorded occurrence is gone'", and §7.1, "its
    period deleted, or no run of it starting at that time today after a repaint"). DEFAULT, kept
    as narrow as `withExtension` itself: when no run of the recorded period R starts at the
    recorded time S today, the record still matches a run when, and only when, today's stored
    keep open (`period_extensions`, `packages/venue-service/src/schema/period-extensions.ts:7`,
    one per department and business day) runs from E1 to E2 with E1 ≤ S < E2, the day's PAINTED
    ranges (before `withExtension`) hold a range of R starting at S and ending after E2, and the
    runs hold a run of R starting at E2 — exactly the run `withExtension` made by cutting that
    range at the keep open's end (`service-day.ts:180`). It matches that run. Every other missing
    start is gone, as the spec says: a repaint that moves or removes the run, with no keep open
    covering it, makes it gone (Task 4's control: Bar 10:00 recorded, the morning Bar run repainted
    away and Lunch painted from 10:00 → gone, and the running Lunch is due).
23. **"Back to its saved place" on a table that needs moving is Mark moved**: the same place
    check (`table.new_place_taken`), the whole joined group's change, and the mark cleared. Today
    it would put the table at its new place and leave the mark (`backToSaved` reads the reset row,
    `apps/server/src/floor-today-store.ts:740-758`).
24. **At the day's first read, a zone is reset only onto a SAVED layout.** A zone whose due
    layout is null (its department has no set, or it is in none — decision 5), or whose due
    `(set, zone)` has no `floor_plans` row yet, is left as it is: no reset, no new record. Without
    the second condition, a zone moved into a department and read just after that department's
    first set is made (which starts empty, spec decision 18) would put every free table in store
    before anyone has drawn the zone. The first read after a layout row exists for the due set
    resets it. The rows exist once any save of the zone in that department (decision 2 writes the
    other sets' rows on a shared change) or a copy has run. A zone with a record whose due set has
    a row is reset as normal.
25. **Bookings judge a part by the recorded layout of the booking's own date, when there is one**
    (decision 9's `savedPart`). A booking for today is judged by today's recorded layout, whatever
    its time: one for tonight made while Lunch's layout is recorded is judged by Lunch's. A
    booking for another day, or for today before the day's first till read, gets the pre-A504
    reading (every part refused, a joined table bookable). Spec §11 leaves bookings across layouts
    to the bookings work.

## Global constraints

- Branch `feat/a504-floor-plan-sets`, one pull request. Create the worktree with
  `python3 ~/workspace/tools/worktree.py new waitron feat/a504-floor-plan-sets --headless`, after
  syncing `main`. Every task ends green on its focused tests and is committed with `git commit -s`.
  Never `--no-verify`.
- Keep the ledger `docs/handoffs/2026-10-17-a504-floor-plan-sets.md` (gitignored) current at the
  end of every task.
- **Nothing fiscal changes.** No invoice, bill, sale or fiscal record is written or read by a
  change of layout. `packages/fiscal-verifactu/src/inmutabilidad.test.ts` and the golden huella
  case ("files the same huella, ImporteTotal and CuotaTotal as main did for the same basket",
  `packages/fiscal-verifactu/src/write-path.e2e.test.ts:633`) must pass unedited.
- **Migrations:** new migrations only, numbered by `drizzle-kit generate` against the tree
  (`pnpm --filter @waitron/db db:generate`, `pnpm --filter @waitron/venue-service db:generate`);
  never hand-number or hand-edit SQL, snapshots or `_journal.json`. A number collision on rebase is
  fixed by resetting the set's `drizzle/` to `main` and regenerating. A generation that rebuilds a
  table must not also add a column to it, and must not rebuild a table with an expression index
  (there is none on the floor tables). Read every generated SQL file before committing it.
- **No data-migration code** (CLAUDE.md §3). **A venue reset is certain** (Task 23 rebuilds
  `floor_plan_tables`, which live tables point at). The pull request's first line reads:
  "Venue reset needed: the owner's box, every `wa-wt` dev venue (demo and onboarding, every
  slot) and the Santet real-data venue." (owner answer 10(a)). Nobody starts the dev stack on the
  branch before Task 23 lands, so no venue holds rows of the branch's interim shape; Tasks 29a
  and 29b reset theirs first. The build lands before the A760 squash freeze or starts after the
  squash lands, never across it.
- Tables are classified in their module's list: core in `packages/db/src/classification.ts`
  (floor tables at lines 108-120), venue-service in
  `packages/venue-service/src/classification.ts` (beside `menu_periods`, line 18). All new tables
  are `state`; none is `appendOnly()`.
- Columns come from `packages/db/src/schema/columns.ts` only; every foreign key and unique index is
  declared in the TypeScript schema.
- One `withTransaction` per request; write-path functions take `tx: Transaction`; queries on one
  transaction are awaited in turn, never `Promise.all`.
- Error codes name the domain concept and live in the throwing package's registry
  (`apps/server/src/errors.ts`, `packages/venue-service/src/errors.ts`); a code thrown by both is
  declared in both with identical params, as `service_zone.mode_incompatible` is
  (`apps/server/src/errors.ts:1453`, `packages/venue-service/src/errors.ts:101`). Every file that
  throws one imports its registry. HTTP statuses follow `docs/developers/conventions-data.md`, "A
  refusal's HTTP status says what was wrong".
- New till routes take `take-orders` and the room's revision, and add a row to the route maps atop
  `apps/server/src/till-api.profile-actions.test.ts` (line 105 lists today's floor routes) and
  `apps/server/src/till-api.profile-zones.test.ts` (lines 131-146), each with a refusing case.
- UI: every colour, spacing and font reads a `--wt-*` token; screens use `wt-*` field primitives,
  never a native `<select>`, `<textarea>` or text `<input>`; a cell styled inside `wt-data-table`
  uses `part=`; a row-menu column is keyed `actions` and `pinned: "end"`; dialogs that save follow
  design-system.md → Forms (`draftScopeFor`, `saveActionState`, an early return in the save
  handler, a sibling `*.unsaved.test.ts`); custom events of a shared `wt-*` component are `wt-*`,
  composed and bubbling.
- Every user-facing string in English and Spanish, worded as spec §8 has it; strings the spec does
  not give are listed in the task that adds them.
- Coverage holds 98/98/98/95 in every package touched; no exclude or ignore comment is added.
- Comments only for an invariant or a non-obvious why; no history.
- Focused commands: `pnpm --filter <pkg> exec vitest run <file>`; root guards
  `pnpm exec vitest run scripts/<guard>.test.ts`. Read the `Tests` count; a run that prints none
  proved nothing. Set `TESTCONTAINERS_RYUK_DISABLED=true`. Before a browser run, check
  `memory_pressure | grep free`.

## Behaviour this plan removes

Tests pinning these may change, under the commit rule above:

- One saved plan per zone (`floor_plans_zone_key`, `packages/db/src/schema/floor-plans.ts:87`) and
  places stored on `floor_plan_tables` (`floor-plans.ts:97-116`).
- A joined table's parts never placed on the saved plan (`checkParts`,
  `apps/server/src/floor-plan.ts:222`; the editor's guard, `apps/dashboard/src/screens/floor-plan-tables-panel.ts:191`).
- A part out of service whenever its joined table has a live table, wherever either stands
  (`stillJoinedPart`, `packages/db/src/joined-parts.ts:9-29`), and a table counted a saved part
  whatever the layout (`savedPart`, `joined-parts.ts:52-58`) — Task 7b.
- A waiting table moving by itself on a later read (`catchUpZone`,
  `apps/server/src/floor-today-store.ts:219-227`).
- A table that only needs clearing moving at a reset, and a reset clearing "needs clearing" on the
  split-off tables it takes back (`floor-today-store.ts:386-413`).
- "Reset to saved plan" and its question line "Free tables go back now, occupied ones once free."
  (`apps/till/src/i18n/strings.ts:872`, `874`).
- The editor's address `/manage/floor-plan/zone/{zone}` and its routes
  `GET`/`PUT /management-api/zones/:id/floor-plan` (`apps/server/src/management-api.ts:1666-1690`).
- The Departments list's per-zone floor plan link and the zones list's `hasPlacedTables`
  (`packages/venue-service/src/dashboard/departments-list.ts:232-242`,
  `apps/server/src/management-api.ts:1580-1593`).

## Review focus

The five conditions most likely to bite a person that no task's happy path covers. Each has its
test in the task named.

1. **"Keep open" after the period ended, both orders.** Update layout pressed at 16:05 then Lunch
   kept open at 16:10: no banner while Lunch runs again. Lunch kept open first, nobody pressed:
   the banner goes while Lunch runs and comes back when it ends (Task 4).
2. **A table that frees up after Update layout never jumps.** Table 3 seated at Update layout,
   then its party finishes: the next tables read shows it "Needs moving" in its old place, and
   only Mark moved puts it in the new one (Task 13).
3. **Two tables swapping places, and a chain.** Dinner puts 2 where 3 stands and 3 where 2 stands:
   both are carried and marked in either order. Table 3 waits, so 2 (whose new place is 3's) and
   1 (whose new place is 2's) keep their places too (Task 15).
4. **An editor on another set saves a stale table list.** Editor A adds table 13 in Dinner; editor
   B, opened earlier on Standard, saves: refused `floor_plan.out_of_date`, table 13 survives
   (Task 6).
5. **A party seated across Update layout keeps everything.** Its table, bills and kitchen tickets
   are untouched, and seating a table that needs moving is refused `table.needs_moving` (Tasks 13
   and 14).

---

## Task overview

Listed in DISPATCH ORDER. Task numbers keep the subjects together, so they are not in sequence.

| Order | Task | Subject | Size |
| --- | --- | --- | --- |
| 1 | 1 | Core schema, first generation (additive) | S |
| 2 | 2 | Shared tables and placements: core reads and writes the new columns, one layout per zone | M |
| 3 | 3 | Venue-service schema: department sets and a period's set | S |
| 4 | 4 | The due-occurrence rule (pure) | M |
| 5 | 5 | The due-layout seat | M |
| 6 | 6 | Editor read and save per set | M |
| 7 | 7 | Resets onto a chosen layout, and the record | M |
| 8 | 7b | Joined tables follow today's map; saved parts follow the recorded layout | M |
| 9 | 8 | Move the test helpers, seeds and floor-plan tests to sets | M |
| 10 | 25a | Editor: address, API, title, shared-tables line, Close | M |
| 11 | 25b | Editor: a joined table's parts per layout | S |
| 12 | 9a | Move the first group of server test callers to sets | M |
| 13 | 9b | Move the rest; remove the zone-only functions and routes | M |
| 14 | 23 | Core rebuild generation | M |
| 15 | 10 | Core `FloorPlanSets` port; `FloorDeletion.removeSets`; department delete removes sets | M |
| 16 | 11 | Venue-service set routes | M |
| 17 | 12 | Reset waiting rules: clearing waits, joined groups wait together, taken-off stays | M |
| 18 | 13 | "Needs moving": later reads mark, tables state reports | M |
| 19 | 14 | `table.needs_moving` refusals | S |
| 20 | 15 | No table put down on another, at every reset (A600) | M |
| 21 | 16 | Mark moved (and Back to saved place on a table that needs moving) | M |
| 22 | 17 | The zones read offers the due layout | M |
| 23 | 18 | Update layout, and Reset to … plan onto the recorded set | M |
| 24 | 19 | `wt-combobox` muted option | S |
| 25 | 20 | Floor plans page: the list | M |
| 26 | 21 | Floor plans page: Add set, Rename, Copy | M |
| 27 | 22 | Floor plans page: Make default and Delete | M |
| 28 | 24 | Period dialog field and Periods column | M |
| 29 | 26 | Till: banner and Update layout | M |
| 30 | 27 | Till: Needs moving on the map and the list | M |
| 31 | 28 | Till: zone menu wording, and List/Map in the menu on a phone | M |
| 32 | 29a | LOOK, dashboard (scripted) | M |
| 33 | 29b | LOOK, till (scripted) | M |
| 34 | 30 | Docs and backlog; the Santet importer (local, not in the PR) | S |

Why this order: 9a/9b remove the old editor routes, so the editor (25a) moves first. Task 23
drops `floor_plan_tables.plan_id`, which until then ties every table to one layout row: a set's
layout row cannot be deleted while a table names it (`floor_plan_tables_plan_fk`,
`packages/db/src/schema/floor-plans.ts:109-113`), so 23 runs before 10 deletes sets, and after
every task that reads or writes the old columns (2, 6, 7, 7b, 8, 9a, 9b).

---

### Task 1: Core schema, first generation (additive)

**Files:**
- Modify: `packages/db/src/schema/floor-plans.ts`, `packages/db/src/classification.ts:108-120`,
  `packages/db/src/configuration-transfer.ts:52-55`
- Create: `packages/db/drizzle/<generated>.sql` and its snapshot (by `db:generate`)
- Test: `packages/db/src/schema/floor-plans.test.ts`

**Interfaces — Produces** (exported from `@waitron/db` through `schema/index.ts:9`):

```ts
export const floorPlanSets;        // floor_plan_sets: id, location_id (FK locations)
export const floorPlanPlacements;  // floor_plan_placements: id, plan_id (FK floor_plans), plan_table_id (FK floor_plan_tables),
                                   //   x, y, width, height, shape, rotation — all NOT NULL, with the place checks (not the seats check);
                                   //   unique floor_plan_placements_table_key (plan_id, plan_table_id)
// New nullable columns, each with its foreign key:
//   floor_plans.set_id → floor_plan_sets.id
//   floor_plan_tables.zone_id → floor_zones.id
//   floor_plan_table_sizes.plan_id → floor_plans.id
//   floor_today_zones.set_id → floor_plan_sets.id (no action; the set delete nulls it, Task 10)
// New columns: floor_today_zones.layout_revision count NOT NULL default 0,
//   floor_today_zones.occurrence label (nullable, venue-service's occurrence key),
//   floor_reset_tables.ready_to_move flag NOT NULL default false.
// Unique indexes: floor_plans_zone_key (zone_id) is REPLACED by floor_plans_set_zone_key (set_id, zone_id);
//   floor_plan_table_sizes_table_key (plan_table_id) is REPLACED by
//   floor_plan_table_sizes_plan_table_key (plan_id, plan_table_id) — kept beside it, a second
//   layout's kept size for the same table would be refused from Task 6 on;
//   ADDED beside the old one: floor_plan_tables_zone_label_key (zone_id, label).
// Between this task and Task 2, size rows written with a null plan_id are not held to one per
// table (null never equals null in a unique index); Task 2 writes plan_id on every size row.
```

- [ ] **Step 1: Write the failing tests** in `floor-plans.test.ts` (it already opens a venue with
  `useVenueDb`):
  - "keeps one placement per table in a layout": a second `floorPlanPlacements` insert for the same
    `(planId, planTableId)` is refused; the assertion reads the refusal's message for
    `floor_plan_placements_table_key`.
  - "refuses a placement out of range": `x: 1000` is refused naming `floor_plan_placements_x_ck`.
  - "allows a zone a layout in each set": two `floorPlans` rows for one zone with different
    `setId`s both insert; a third with a repeated `setId` is refused naming
    `floor_plans_set_zone_key`.
  - "starts a reset row not ready to move": a `floorResetTables` insert without `readyToMove`
    reads back `false`.
  - "keeps a table's off-plan size in each layout": two `floorPlanTableSizes` rows for one table
    with different `planId`s both insert; a repeat of `(planId, planTableId)` is refused naming
    `floor_plan_table_sizes_plan_table_key`.
  Failing run prints: `floorPlanPlacements` / `floorPlanSets` is not exported (TypeError reading
  `undefined`).
- [ ] **Step 2:** `pnpm --filter @waitron/db exec vitest run src/schema/floor-plans.test.ts` — FAIL.
- [ ] **Step 3:** Declare the tables and columns above. `placementChecks`
  (`packages/db/src/schema/floor-plans.ts:54-75`) starts with a seats check
  (`${name}_seats_ck`, line 57) that `floor_plan_placements` has no column for: split it into
  `seatsCheck(name, seats)` and `placeChecks(name, t)`, have the three existing callers (lines
  114, 198, 269) use both so their generated constraint names do not change (the generation must
  not touch them), and give `floor_plan_placements` `placeChecks` alone, with its columns
  `notNull()`. Classify `floor_plan_sets` and
  `floor_plan_placements` as `state` beside the floor tables. Add `{ name: "floor_plan_sets",
  locationColumns: ["location_id"] }` before `floor_plans` and `{ name: "floor_plan_placements" }`
  after `floor_plan_tables` to the core configuration export.
- [ ] **Step 4:** `pnpm --filter @waitron/db db:generate`. Read the SQL: it must be CREATE TABLE,
  `ALTER TABLE … ADD`, `DROP INDEX` and `CREATE UNIQUE INDEX` only, with no `__new_` table (the
  two index swaps are plain index drops and creates). If drizzle chose a rebuild for any table,
  stop and report.
- [ ] **Step 5:** Run the test file (PASS), then the guards:
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/id-columns-are-references.test.ts scripts/column-vocabulary.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migration-upgrade.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`. All
  pass with no `RESETS` entry (an additive generation carries every row).
- [ ] **Step 6:** Commit: "Floor plan sets, step 1: tables for sets and per-layout places".

### Task 2: Shared tables and placements, one layout per zone

Behaviour does not change: each zone still has one saved plan. Core code stops reading places from
`floor_plan_tables` and stops finding a zone's tables through `plan_id`.

**Files:**
- Modify: `apps/server/src/floor-plan.ts` (`mastersOf` 80-93, `readZonePlan` 105-148,
  `zonesWithPlacedTables` 151-162, `namesTaken` 231-243, `saveZonePlan` 319-428),
  `apps/server/src/floor-today-store.ts` (`resetZoneFor`'s master read 128-143, `copyParts`
  177-202), `apps/server/src/floor-delete.ts` (the plan reads at 63-68, the deletes at 225-235),
  `apps/server/src/testing/floor-today-venue.ts` (`giveKeptSize` 98-105); and the fixtures that
  insert `floorPlanTables` rows directly (`grep -rln "insert(floorPlanTables)" apps packages --include='*.test.ts'`
  at `9d6ccd7b8`): `apps/server/src/floor-today-store.test.ts` (`masterRow` 99-107, used at 120 and 149),
  `apps/server/src/floor-plan.test.ts`, `apps/server/src/floor-delete.test.ts`,
  `apps/server/src/table-removal.test.ts`, `apps/server/src/service-delete.integration.test.ts`,
  `apps/server/src/management-api.service-delete.test.ts`, `packages/bookings/src/bookings.test.ts`,
  `packages/db/src/joined-parts.test.ts` (`planId: PLAN`, 307-310) and
  `packages/db/src/schema/floor-plans.test.ts`. Those that write a place on the table row move it to a
  `floorPlanPlacements` row and add `zoneId`; setup only, no assertion changes. (Without this the
  code, which now reads places from `floor_plan_placements`, finds none of their places.)
- Test: `apps/server/src/floor-plan.test.ts`, `apps/server/src/floor-delete.test.ts`

**Interfaces:** none new. `ZonePlan` and `ZonePlanSave` (`floor-plan.ts:22-56`) keep their shape.

- [ ] **Step 1: Write the failing tests** in `floor-plan.test.ts`:
  - "stores a placed table's place in floor_plan_placements and none on the table": save one
    placed and one spare table; read the rows: one `floorPlanPlacements` row for the placed table
    with the sent x/y/width/height/shape/rotation, none for the spare; both `floorPlanTables` rows
    carry the zone's id in `zoneId`, and their old placement columns are all null.
  - "keeps a table's off-plan size in its layout": take a placed table off; its
    `floorPlanTableSizes` row carries the plan's id in `planId`.
  In `floor-delete.test.ts`: "deleting a zone removes its placements": after `floor.clear`, no
  `floorPlanPlacements` row names the zone's plan.
  Failing run: `zoneId` is null / no placement rows.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/floor-plan.test.ts src/floor-delete.test.ts` — FAIL.
- [ ] **Step 3:** Change the code:
  - `saveZonePlan` writes `zoneId` (and still `planId`, which is NOT NULL until Task 23) on every
    created table, writes placements as one delete-then-insert of the plan's placement rows (the
    `REFERENCES` grep: nothing points at `floor_plan_placements`), writes `placementColumns(null)`
    to the old columns, and writes `planId` on the size rows. `namesTaken` reads
    `floorPlanTables.zoneId` with no join to `floor_plans`.
  - `mastersOf`, `readZonePlan`, `zonesWithPlacedTables` and the reset's master read join
    `floorPlanPlacements` on `(plan_id, plan_table_id)` for the place, and read the zone's tables by
    `floorPlanTables.zoneId`. Export a helper used by all three:
    `export async function layoutTables(tx: Transaction, zoneId: string, planId: string | null): Promise<(MasterRow & { placement: Placement | null; keptSize: … ; partOf: string | null })[]>`.
  - `copyParts` reads `floor_plan_table_parts` through `floorPlanTables.zoneId`.
  - `floor-delete.ts` deletes placements and sizes of the zones' plans before the tables and plans.
  - `giveKeptSize` takes the plan id too (find it by zone in the helper).
- [ ] **Step 4:** Run the two files (PASS), then every floor suite to show behaviour held:
  `pnpm --filter @waitron/server exec vitest run src/floor- src/joined src/table-removal src/configuration-transfer src/service-delete src/booking-seat src/tables.test.ts src/till-api.today-joins.test.ts`.
  Then `pnpm exec vitest run scripts/schema-constraints.test.ts`.
- [ ] **Step 5:** Commit: "Floor plan sets, step 2: a zone's tables are shared, places live in their layout".

### Task 3: Venue-service schema — a department's sets and a period's set

**Files:**
- Create: `packages/venue-service/src/schema/floor-plan-sets.ts`,
  `packages/venue-service/src/floor-plan-set-store.ts`, `…/floor-plan-set-store.test.ts`
- Modify: `packages/venue-service/src/schema/menus.ts:10-36` (menu_periods),
  `packages/venue-service/src/schema/index.ts`, `packages/venue-service/src/classification.ts:18`,
  `packages/venue-service/src/configuration-transfer.ts` (the table list near line 659 and
  `validateMenuTimetables` from line 120), `packages/venue-service/src/index.ts`

**Interfaces — Produces:**

```ts
// department_floor_plan_sets: set_id PK FK floor_plan_sets.id; department_id FK departments.id;
//   name label NOT NULL, check trim(name) <> ''; is_default flag NOT NULL default false;
//   uniqueIndex department_floor_plan_sets_name_key (department_id, name);
//   uniqueIndex department_floor_plan_sets_one_default_key (department_id) where is_default.
// menu_periods.floor_plan_set_id: nullable, references floor_plan_sets.id (a plain column
//   reference, so drizzle adds it with ALTER TABLE and does not rebuild menu_periods).
//   CLAUDE.md §3 comment AT THE COLUMN, saying what the key cannot hold and where the refusal
//   lives: "A set of this period's own department. The key names core's floor_plan_sets, so the
//   database takes any department's set; the period routes refuse another department's with
//   menu_period.invalid (floorPlanSetId) and the configuration import with
//   menu_periods.floor_plan_set_id. A composite key to department_floor_plan_sets would rebuild
//   menu_periods, whose rebuild empties menu_period_staff_menus (its key cascades)." 
export interface FloorPlanSetSummary {
  setId: string; departmentId: string; name: string; isDefault: boolean;
  /** The department's zones, in display order. */
  zoneIds: readonly string[];
}
export async function linkFloorPlanSet(
  tx: Transaction, cfg: VenueScope,
  input: { setId: string; departmentId: string; name: string },
): Promise<void>; // the department's first set becomes its default; a taken name → floor_plan_set.name_taken
export async function readFloorPlanSets(
  tx: Transaction, cfg: VenueScope,
  filter?: { setIds?: readonly string[]; departmentId?: string },
): Promise<FloorPlanSetSummary[]>; // active departments only; default first, then by name
```

- [ ] **Step 1: Write the failing tests** in `floor-plan-set-store.test.ts` (`useVenueDb` with the
  core and venue-service sets):
  - "makes a department's first set its default": link "Standard" then "Dinner"; read back:
    Standard `isDefault: true`, Dinner `false`, Standard listed first.
  - "refuses a name the department already has": linking "Dinner" twice rejects with code
    `floor_plan_set.name_taken` and params `{ departmentId, name: "Dinner" }`.
  - "allows the same name in two departments": Restaurant's and Bar's "Standard" both link.
  - "lists a set with its department's zones": `zoneIds` equals the department's zones in display
    order.
  - "holds one default per department in the database": a raw second `is_default` insert is
    refused naming `department_floor_plan_sets_one_default_key`.
  Failing run: module `./floor-plan-set-store.js` not found.
- [ ] **Step 2:** `pnpm --filter @waitron/venue-service exec vitest run src/floor-plan-set-store.test.ts` — FAIL.
- [ ] **Step 3:** Declare the table and column, classify `department_floor_plan_sets` as `state`,
  register `floor_plan_set.name_taken` in `packages/venue-service/src/errors.ts`, write the two
  functions. Add `{ name: "department_floor_plan_sets" }` to venue-service's configuration export,
  and extend `validateMenuTimetables`: a link's `department_id` names an exported department; names
  are unique per department; each department with a link has exactly one default; a period's
  `floor_plan_set_id`, when set, names a link of the period's own department (refuse
  `menu_periods.floor_plan_set_id`). Add a case for each refusal to the existing
  `configuration-transfer.test.ts` in venue-service.
- [ ] **Step 4:** `pnpm --filter @waitron/venue-service db:generate`. The SQL must be one CREATE
  TABLE, its indexes and one `ALTER TABLE menu_periods ADD floor_plan_set_id … REFERENCES
  floor_plan_sets(id)`; no `__new_menu_periods`. If drizzle rebuilds `menu_periods`, stop and
  report: a rebuild would silently empty `menu_period_staff_menus`, whose key cascades
  (`menus.ts:48-52`).
- [ ] **Step 5:** Run the test file and `src/configuration-transfer.test.ts` (PASS), then
  `pnpm exec vitest run scripts/module-graph-honesty.test.ts scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/id-columns-are-references.test.ts scripts/errors-reachable.test.ts`.
- [ ] **Step 6:** Commit: "Floor plan sets, step 3: a department's sets and a period's set".

### Task 4: The due-occurrence rule (pure)

**Files:**
- Create: `packages/venue-service/src/floor-layout-due.ts`, `…/floor-layout-due.test.ts`

**Interfaces:**
- Consumes: `serviceRuns` (`menu-timetable.ts:327-336`), `withExtension`
  (`service-day.ts:161-184`), `rangeInForce`, `rangeSpanInDay`, `ServiceDayContext`
  (`service-day.ts`).
- Produces:

```ts
export interface RecordedRun { periodId: string; startsAt: string } // parsed from today's occurrence key
/** The day as the rule reads it. `painted` is the business day's ranges as painted (what
 *  `departmentDay` answers, `menu-timetable.ts:264`); `extension` is today's stored keep open or
 *  null; `runs` is `serviceRuns(withExtension(painted, extension, cutover))` — the JOINED form, so
 *  Lunch 13:00–16:00 kept open 16:00–20:30, which `withExtension` returns as two Lunch ranges
 *  (13:00–16:00 and the extension 16:00–20:30), is one run 13:00–20:30. */
export interface DueDay { painted: readonly ServiceRange[]; extension: ServiceRange | null; runs: readonly ServiceRange[] }
/** The run whose layout is due at `minute`: running ("keep open" included) → next later today →
 *  last that ran today → null. Never one starting earlier in the service day than the run
 *  `recorded` matches (spec decision 4); when `recorded` matches none, the rule does not apply. */
export function dueRun(input: {
  day: DueDay; minute: number; context: ServiceDayContext; recorded: RecordedRun | null;
}): ServiceRange | null;
/** Parses venue-service's occurrence key; null for another department, another business day, or not a key. */
export function recordedRun(key: string | null, departmentId: string, businessDay: string): RecordedRun | null;
/** The run today that `recorded` is: the run of its period starting at its time; else, only when
 *  today's keep open covers that time and cut a painted range of the period that started there,
 *  the run of the period starting at the keep open's end (plan decision 22); else null (gone). */
export function matchRecorded(
  day: DueDay, recorded: RecordedRun, context: ServiceDayContext,
): ServiceRange | null;
export function occurrenceKey(departmentId: string, businessDay: string, run: ServiceRange): string;
// Same format as resolveDepartmentService's periodOccurrenceKey (menu-timetable.ts:455-462);
// resolveDepartmentService switches to this helper so the two never drift.
```

- [ ] **Step 1: Write the failing tests**, one per worked example of spec §7.1, all with a 06:00
  changeover, Lunch (L) 13:00–16:00 and Dinner (D) 20:00–23:30 unless the case says otherwise:
  - "is the running run": at 14:00, no record → L 13:00.
  - "is the next run once one ends": at 16:00, record L 13:00 → D 20:00.
  - "follows keep open made before the end": L kept open until 16:45 (an extension 16:00–16:45
    passed through `withExtension`), at 16:30 → L 13:00; at 16:45 → D 20:00.
  - "never goes back to a period reopened after its end": record D 20:00 at 16:05; L kept open
    16:00–17:00 read at 16:10 → D 20:00 (Review focus 1).
  - "comes back after a reopened period ends when nobody updated": record L 13:00; L kept open
    16:00–17:00: at 16:10 → L 13:00; at 17:00 → D 20:00 (Review focus 1).
  - "takes a later run of the same period": Bar 10:00–13:00 and 16:00–23:00, L 13:00–16:00;
    record L 13:00; at 16:00 → Bar 16:00.
  - "counts a run past midnight as late": Night 22:00–02:00 recorded; at 01:00 → Night 22:00, not
    an earlier run.
  - "is the last run after the day's last ends": at 23:45 → D 20:00.
  - "is null on a day with no period": runs empty → null.
  - "ignores a record whose run is gone": record L 14:00 after a repaint made Lunch 13:00–16:00
    (no Lunch run starts at or after 14:00) at 14:30 → L 13:00, the exception not applying.
  - "keeps a run whose start a keep open pushed later" (plan decision 22): record D 20:00 at
    16:05; L kept open 16:00–20:30 (`withExtension` returns L 13:00–16:00, L 16:00–20:30 and D
    20:30–23:30; the runs are L 13:00–20:30 and D 20:30–23:30); at 16:10 → D 20:30, not L;
    `matchRecorded` returns D 20:30. Control: with `matchRecorded`'s keep-open branch removed the
    same case returns L 13:00 — run it once that way and see it fail.
  - "a repaint is not a keep open" (the narrowing's control): Bar painted 10:00–13:00 and
    16:00–23:00; record Bar 10:00 at 10:30; then the day is repainted to Lunch 10:00–13:00 and Bar
    16:00–23:00, no keep open; at 11:00 → L 10:00 (`matchRecorded` returns null: gone, so the
    exception does not apply). A rule matching "any later run of the same period" would return
    Bar 16:00 here and keep the running Lunch from ever being due (spec decision 3).
  - `recordedRun` cases: another department's key → null; yesterday's key → null; `"[1,2"` → null;
    today's key → `{ periodId, startsAt }`.
  - `occurrenceKey` equals `resolveDepartmentService`'s `periodOccurrenceKey` for a running run.
  Failing run: module not found.
- [ ] **Step 2:** `pnpm --filter @waitron/venue-service exec vitest run src/floor-layout-due.test.ts` — FAIL.
- [ ] **Step 3:** Implement. Compare starts with `rangeSpanInDay(run, context).start`.
- [ ] **Step 4:** Run the file and `src/menu-timetable.test.ts` — PASS.
- [ ] **Step 5:** Commit: "Floor plan sets, step 4: which period's layout is due".

### Task 5: The due-layout seat

**Files:**
- Modify: `packages/module/src/module.ts` (`VenueServiceContribution`, from line 611),
  `packages/venue-service/src/service.ts` (the `VENUE_SERVICE` object, from line 124),
  `packages/venue-service/src/floor-layout-due.ts`
- Test: `packages/venue-service/src/floor-layout-due.db.test.ts`

**Interfaces — Produces** on `VenueServiceContribution`:

```ts
dueFloorLayouts(
  tx: Transaction, cfg: { locationId: LocationId },
  zones: readonly { zoneId: string; recordedOccurrence: string | null }[], at: Date,
): Promise<ReadonlyMap<string, DueFloorLayout>>; // one entry per zone named
readFloorPlanSets(
  tx: Transaction, cfg: { locationId: LocationId },
  filter?: { setIds?: readonly string[]; departmentId?: string },
): Promise<readonly FloorPlanSetSummary[]>; // Task 3's function; FloorPlanSetSummary moves to packages/module
export interface DueFloorLayout {
  /** Null: the zone is in no active department, or its department has no set. */
  setId: string | null;
  setName: string | null;
  /** The due run's occurrence key; null on a day with no period, or when the clock names no day. */
  occurrence: string | null;
  /** The due run's period name; null with no occurrence. */
  periodName: string | null;
}
```

- [ ] **Step 1: Write the failing tests** (`useVenueDb`, a department with Lunch and Dinner
  painted for today, sets Standard (default) and Dinner; Dinner period's field = Dinner; Lunch's
  empty):
  - "is the default set while Lunch runs": at 14:00 → Standard, Lunch's occurrence key, "Lunch".
  - "is Dinner's set once Lunch ends": at 16:00 → Dinner, Dinner 20:00's key, "Dinner".
  - "follows a changed default": make Dinner the default (update the flags directly) → at 14:00
    Lunch → Dinner.
  - "is the default with no occurrence on a day with no period": a weekday with no ranges → set
    Standard, `occurrence: null`, `periodName: null`.
  - "is null for a zone in no department and for a department with no set".
  - "reads each department's day once": spy on the day reader; three zones of one department and
    one of another → two reads.
- [ ] **Step 2:** `pnpm --filter @waitron/venue-service exec vitest run src/floor-layout-due.db.test.ts` — FAIL (`dueFloorLayouts` not a function).
- [ ] **Step 3:** Implement with `departmentDay` (`menu-timetable.ts:264`), building Task 4's
  `DueDay` from its `ranges` and `extension` (`menu-timetable.ts:296-321`), and the clock reading
  `resolveDepartmentService` uses (`menu-timetable.ts:373-386`); group zones by department
  through `zone_service_policies`. Add both methods to the contract and the seat object.
- [ ] **Step 4:** Run the file; then `pnpm --filter @waitron/module exec vitest run` and
  `pnpm exec vitest run scripts/module-seams.test.ts`. Typecheck the server, which imports the type: `pnpm --filter @waitron/server typecheck`.
- [ ] **Step 5:** Commit: "Floor plan sets, step 5: the venue-service seat answers which layout is due".

### Task 6: Editor read and save per set

Expand only: the zone-only `readZonePlan`/`saveZonePlan` keep working on the set-less row until
Task 9b.

**Files:**
- Modify: `apps/server/src/floor-plan.ts`, `apps/server/src/errors.ts` (beside
  `floor_plan.invalid`, line 716), `apps/server/src/management-api.ts` (beside the old routes,
  1666-1690), `apps/server/src/till-api.ts` status map (522-547) or the management API's own, as
  the existing `floor_plan.invalid` entry is placed
- Test: `apps/server/src/floor-plan-layouts.test.ts` (new), `apps/server/src/management-api.floor-plan-sets.test.ts` (new)

**Interfaces — Produces:**

```ts
export interface LayoutRef { setId: string; zoneId: string }
export interface ZonePlan { …existing; setId: string; setName: string } // read answer gains both
export async function readLayout(tx, cfg: TillConfig, at: LayoutRef): Promise<ZonePlan>;
export async function saveLayout(
  tx, cfg: TillConfig, removals: readonly TableRemoval[], at: LayoutRef, input: ZonePlanSave, now?: Date,
): Promise<{ revision: number; ids: Record<string, string> }>;
// GET /management-api/floor-plan-sets/:setId/zones/:zoneId/floor-plan → ZonePlan
// PUT  same path, body ZonePlanSave → { revision, ids }
```

- [ ] **Step 1: Write the failing tests** in `floor-plan-layouts.test.ts` (a department with zone
  Inside, sets Standard and Dinner linked with Task 3's `linkFloorPlanSet` after inserting
  `floorPlanSets` rows):
  - "shares tables and keeps places per set": save tables 1–3 placed in Standard; read Dinner:
    the same three ids, every `placement` null, revision 1 (Standard's first save added tables,
    a shared change, so decision 2 writes Dinner's row at revision 1).
  - "moves only its own layout for a move": move table 1 in Dinner → Dinner revision 2, Standard
    revision still 1.
  - "moves every layout of the department for a shared change": add table 4 in Dinner → Standard's
    revision moves too, and a Standard row for a set that had none is written (decision 2).
  - "refuses a stale save from another set's editor" (Review focus 4): read Standard (revision r);
    add table 13 in Dinner; save Standard's old draft with revision r → `floor_plan.out_of_date`;
    table 13 still exists.
  - "lets a layout stand a joined table's parts while it leaves the joined table off": Standard
    places 4 and 5 and leaves 4+5 off → saves; Dinner places 4+5 and 4 → `floor_plan.invalid`
    with `field` `tables.N.partKeys`.
  - "reads a part as off in a layout that places its joined table": a placement row for 4 left in
    Dinner while Dinner places 4+5 reads `placement: null`.
  - "refuses a zone outside the set's department": `floor_plan_set.invalid` { field: "zoneId" }.
  - "refuses an unknown set": `floor_plan_set.not_found` { setId }.
  - "answers the set's name": `setName: "Dinner"`.
  In `management-api.floor-plan-sets.test.ts`: GET and PUT round-trip through the new path; a
  person without `venue.configure` is refused as the old route refuses.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/floor-plan-layouts.test.ts src/management-api.floor-plan-sets.test.ts` — FAIL.
- [ ] **Step 3:** Implement. `planOf` takes a `LayoutRef` (the zone-only path keeps `setId IS
  NULL`). `checkSave` reads the department's sets once through
  `VENUE_SERVICE.readFloorPlanSets(tx, cfg, { setIds: [setId] })` and refuses a missing set or a
  zone not in its `zoneIds`. `checkParts` refuses a part placed only when its joined table is
  placed in the same save. After the writes, when the save changed a shared column, update
  `floor_plans.revision = revision + 1` for every row of the zone whose set is in the department
  and insert the missing rows at revision 1. Register `floor_plan_set.not_found` and
  `floor_plan_set.invalid` in `apps/server/src/errors.ts` (and `not_found` in venue-service's,
  identical) with their statuses (404 and 400).
- [ ] **Step 4:** Run the two files, then `src/floor-plan.test.ts` (unchanged, still PASS).
- [ ] **Step 5:** Commit: "Floor plan sets, step 6: the editor reads and saves a set's layout".

### Task 7: Resets onto a chosen layout, and the record

**Files:**
- Create: `apps/server/src/floor-layout-due.ts`, `…/floor-layout-due.test.ts`
- Modify: `apps/server/src/floor-today-store.ts` (`resetZone` 93-103, `resetZoneFor` 106-174,
  `copyParts` 177-202, `ensureToday` 533-579), `apps/server/src/floor-plan.ts` (first-save reset,
  422-426), `apps/server/src/floor-today-parts.ts` (`partsOf`, 31-66)

**Interfaces — Produces:**

```ts
export interface LayoutRecord { setId: string | null; revision: number; occurrence: string | null }
export interface ZoneLayoutState {
  zoneId: string;
  /** Null when today's record is missing or from an earlier business day. */
  recorded: LayoutRecord | null;
  /** Null when the zone's department has no set (or it is in none). */
  due: { setId: string; setName: string; revision: number; occurrence: string | null; periodName: string | null } | null;
}
export async function zoneLayouts(tx, cfg: TillConfig, zoneIds: readonly string[], now: Date): Promise<Map<string, ZoneLayoutState>>;
/** The banner's facts, or null when the recorded layout is the due one (spec decision 5; plan decision 12). */
export function layoutOffer(state: ZoneLayoutState): { setId: string; revision: number; periodName: string | null } | null;
// floor-today-store.ts:
export async function resetZone(
  tx, cfg, removals, zoneId: string, now: Date,
  onto: { setId: string | null; occurrence: string | null } | "due", // setId null = the set-less row, until Task 9b
): Promise<number | null>;
```

- [ ] **Step 1: Write the failing tests:**
  - `floor-layout-due.test.ts` (pure, for `layoutOffer`): same set and revision → null; same set,
    newer revision → `periodName: null`; other set, other occurrence → the due period's name; other
    set, same occurrence → `periodName: null`; due occurrence null → `periodName: null`; recorded
    set null (deleted) and due Standard → `periodName: null`; recorded null → null; due null → null.
  - In `floor-today-store.test.ts`, new describe "resets onto a set's layout": "the day's first
    read resets onto the due set and records it": a zone with Standard (default) and Dinner, at
    14:00 the first tables read writes `floor_today_zones.setId` = Standard, `layoutRevision` = its
    revision, `occurrence` = Lunch's key, and today's rows carry Standard's places; "a reset reads
    only the chosen set's places" (Dinner differs; reset onto Dinner → Dinner's places, spec
    decision 19); "the dashboard's first save resets onto the due layout, not the set saved"
    (save Dinner at 14:00 for a zone with no today's plan → recorded set Standard).
  - In `floor-today-split.test.ts` (it exercises `partsOf` through Split): "a part's size comes
    from the recorded layout": Standard keeps part 4 off-plan at 8×8 and Dinner at 12×6; with
    Dinner recorded, splitting 4 off 4+5 lays it out 12 wide, and Split lists 4 once (with sizes
    per layout, today's join by table alone, `floor-today-parts.ts:53-54`, would list it twice).
  Failing run: `layoutOffer` not exported; `setId` null on the record; 4 listed twice.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/floor-layout-due.test.ts src/floor-today-store.test.ts` — FAIL.
- [ ] **Step 3:** Implement. `zoneLayouts` reads the records (`floorTodayZones` with
  `todayBusinessDay`, `floor-today-store.ts:80-86`), asks `VENUE_SERVICE.dueFloorLayouts` with each
  live record's occurrence, then reads each due `(set, zone)` revision (0 when no row).
  `resetZoneFor` reads the chosen layout with Task 2's `layoutTables`, writes the record's three
  columns with the room's revision, and `copyParts` copies the zone's parts (shared). `ensureToday`
  starts from active zones with a table or a layout row (not from `floor_plans` alone,
  `floor-today-store.ts:541-545`), asks `zoneLayouts` only for the zones it will reset, and resets
  onto the due layout when that `(set, zone)` has a `floor_plans` row (plan decision 24; a zone
  whose due layout has no row is left as it is); a zone whose due is null keeps today's behaviour on its set-less row until
  Task 9b removes it. `saveLayout` and `saveZonePlan` reset with `"due"`. `partsOf` stops
  reading `floor_plan_tables`' old place columns (lines 36-37) and reads the part's place and
  kept size from the zone's recorded layout: `floor_plan_placements` and `floor_plan_table_sizes`
  joined on the recorded `(set_id, zone_id)` layout row's id as well as the table.
- [ ] **Step 4:** Run the files; then every floor suite as in Task 2 Step 4 (behaviour for
  set-less zones unchanged).
- [ ] **Step 5:** Commit: "Floor plan sets, step 7: every reset reads one set's layout and records it".

### Task 7b: Joined tables follow today's map; saved parts follow the recorded layout

Builds spec §4.2 and owner answer 2 ("Dinner places 4+5, Standard has 4 and 5 apart") on the
till and for bookings, by plan decision 9. Runs after Task 7, before Task 8 (so before Task 12).

**Files:**
- Modify: `packages/db/src/joined-parts.ts` (`stillJoinedPart` 9-29, `savedPart` 52-58),
  `apps/server/src/tables.ts:51` and `packages/bookings/src/bookings.ts:50-69` (`savedPart`'s two
  callers pass the business day, below)
- Test: `packages/db/src/joined-parts.test.ts`, `apps/server/src/joined-parts.test.ts` (its
  "a part still in a joined table" cases, from line 70, stay unchanged: they describe a layout
  that places the joined table), `packages/bookings/src/bookings.test.ts` (beside the
  `table.in_joined_table` cases at 812 and 834), `apps/server/src/floor-today-state.test.ts`
- Sets in these tests are made by hand — a `floorPlanSets` row and Task 3's `linkFloorPlanSet` —
  because Task 8's `defaultLayout` helper does not exist yet.

**Interfaces — Produces:**

```ts
export function stillJoinedPart(tableId: SQLWrapper): SQL; // signature unchanged, rule below
/** Reads the zone's record only when its business day is `businessDay` (spec decision 2); else,
 *  and with no recorded set, every part of a joined table is a saved part, as before A504. */
export function savedPart(tableId: SQLWrapper, businessDay: string | null): SQL;
```

**The rule `stillJoinedPart` adopts** (replacing the "the reset has applied that row" condition,
`joined-parts.ts:16`, with two branches; every other condition — a live joined table, not split
off, no open party at the part, in no merge — stays):
- **Branch A, the joined table holds its tables:** its today's row is drawn (`floor_today_tables`
  with `x` not null and `taken_off = 0`) — whether or not the part's own reset row still waits.
  This is what keeps 4 and 5 out of service while 4+5 has guests and waits to be taken apart.
- **Branch B, as today, for a joined table not drawn:** the part's reset row has been applied
  (`placed = 1 or pending = 0`, today's condition) and no part of the same joined reset row
  (other than one split off today) has a drawn today's row. The waiting exception stays here, for
  the other direction: "taking 4 into 4+5 waits while 4 has guests" (Task 12) leaves 4+5 off the
  map, so 4 and 5 stay usable.
`packages/db/src/joined-parts.test.ts:99-105` ("names no part whose reset row still waits to be
applied") keeps its assertion: its fixture writes no today's rows (`joined-parts.test.ts:1-40`,
no `floorTodayTables` import), so its joined table is not drawn and branch B decides, as today.
If running it shows otherwise, STOP.

**`savedPart`** (hidden from `GET /api/tables`, refused by bookings) reads the zone's recorded
layout `(floor_today_zones.set_id, zone_id)`, used only when `floor_today_zones.business_day`
equals the `businessDay` passed. A table is a saved part when it is a part of a joined table and
that layout places the joined table or places none of its parts; **and also when it is a joined
table that layout leaves off while placing one of its parts** (minor-item default: under
Standard, 4+5 is neither listed nor bookable, matching the till, which cannot seat it). With no
usable record, the pre-A504 reading holds: every part is a saved part, a joined table is not.
Callers: `listTables` (`tables.ts:51`) passes `todayBusinessDay(tx, cfg, now)`
(`floor-today-store.ts:80-86`), taking `now` from each of its callers (`grep -rn "listTables(" apps/server/src`); the
existing test call at `packages/db/src/joined-parts.test.ts:352` passes `null`, which keeps its
pre-A504 reading and its assertion;
bookings pass the booking's date (`CreateBookingInput.bookingDate`,
`packages/bookings/src/bookings.ts:19`; for `updateBooking`, the patch's `bookingDate` when it has
one, else the stored booking's), so a booking for another day gets the pre-A504 reading (plan
decision 25). `bookingDate` is a calendar date, not a business day: a booking after midnight and
before the changeover is judged as the next day's, which is the pre-A504 reading — accepted.

- [ ] **Step 1: Write the failing tests.** Zone Inside, tables 4, 5 and the joined table 4+5
  made of them; Standard places 4 and 5 and leaves 4+5 off; Dinner places 4+5 and leaves 4 and 5
  off; a third set "All off" places none of the three.
  - `packages/db/src/joined-parts.test.ts`, with today's rows written as each reset leaves them:
    "under Standard 4 and 5 are free and 4+5 has come apart" (`stillJoinedPart(4)` false,
    `joinedTableApart(4+5)` true); "under Dinner 4 and 5 are still joined" (true, false, as
    today); "a part whose row still waits is joined while its joined table is drawn" (4+5 drawn,
    4's reset row `pending: true, placed: false`, 4 free → true; the control with 4+5's today's
    row taken off the map → false); "with all three off, 4+5 is a spare and 4 and 5 are still
    joined" (today's behaviour kept); "a part split off today does not count as standing"
    (Dinner, 4 split off and drawn: 5 is still joined); `savedPart(4, today)`: false with
    Standard recorded today, true with Dinner, true with no recorded set, and true with Standard
    recorded for YESTERDAY; `savedPart(4+5, today)`: true with Standard recorded today, false with
    Dinner.
  - `apps/server/src/joined-parts.test.ts`, new describe "a layout that stands a joined table's
    tables": after a reset onto Standard, seating a party at 4 succeeds; joining 5 to that party
    succeeds; `GET /api/tables` lists 4 and 5 and not 4+5; `GET /api/tables/state` reads 4+5 with
    `today.joined.apart: true`, so the till's `sparesOf` leaves it out
    (`apps/till/src/state/floor-today.ts:288-297`); placing 4+5 on today's map is refused
    `table.in_joined_table`.
  - `packages/bookings/src/bookings.test.ts`: "books table 4 while today's recorded layout stands
    it": with Standard recorded today a booking for today at 4 is accepted and one at 4+5 is
    refused `table.in_joined_table`; with Dinner recorded, 4 is refused as today; a booking for
    tomorrow at 4 is refused (pre-A504 reading).
  Failing run: seating 4 under Standard refused `table.in_joined_table`; `GET /api/tables` leaves
  4 and 5 out and lists 4+5; the booking at 4 refused.
  (The take-apart wait — 4+5 with guests, 4 and 5 kept off the map — cannot be tested here:
  before Task 12 nothing makes the group wait, so 4 and 5 take their Standard places at once. It
  is tested in Task 12.)
- [ ] **Step 2:** `pnpm --filter @waitron/db exec vitest run src/joined-parts.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/joined-parts.test.ts src/floor-today-state.test.ts`,
  `pnpm --filter @waitron/bookings exec vitest run src/bookings.test.ts` — FAIL.
- [ ] **Step 3:** Implement the two rules above. Read the emitted SQL with `.toSQL()` for one call
  of each (CLAUDE.md §3: a scalar subquery correlated to the outer table breaks silently).
- [ ] **Step 4:** Run the files above, then every joined and split suite:
  `pnpm --filter @waitron/server exec vitest run src/joined src/floor-today-split src/floor-today-reset-table src/floor-today-merges src/floor-today-flatten src/floor-catch-up src/tables.test.ts src/booking-seat.test.ts`.
  Branch A newly counts as joined a FREE part whose row waits while its joined table is drawn; an
  existing assertion that changes because of that, or for any other reason, is a STOP (report the
  file, line and case). The only assertions this task may change are ones pinning a part out of
  service, or a joined table bookable, under a layout that stands the parts.
- [ ] **Step 5:** Commit: "Floor plan sets, step 7b: a layout that stands a joined table's tables makes them usable".

### Task 8: Move the test helpers, seeds and floor-plan tests to sets

**Files:**
- Modify: `apps/server/src/testing/floor-today-venue.ts` (`tableServiceZone` 30-49,
  `plannedZone` 55-96), `apps/server/src/testing/party-venue.ts`,
  `apps/server/scripts/demo-seed/seed-floor.ts:255-268`, `…/seed-floor.test.ts`,
  `apps/server/src/floor-plan.test.ts`
- Create: `apps/server/src/testing/floor-sets.ts`

**Interfaces — Produces:**

```ts
/** The default set of the zone's department, made ("Standard") when the department has none. */
export async function defaultLayout(tx: Transaction, cfg: TillConfig, zoneId: string): Promise<LayoutRef>;
```

- [ ] **Step 1:** Write the failing test in `seed-floor.test.ts`: "gives each department a
  Standard set holding its zones' tables": after the seed, `readFloorPlanSets` lists one default
  "Standard" per department, and `readLayout` of each seeded zone in it places the seeded tables.
  Run `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed-floor.test.ts` — FAIL.
- [ ] **Step 2:** Write `defaultLayout`; seed with it and `saveLayout`; move `plannedZone` and every
  `saveZonePlan`/`readZonePlan` call in `floor-plan.test.ts` to `defaultLayout` + `saveLayout`/
  `readLayout`. No assertion changes.
- [ ] **Step 3:** Run `src/floor-plan.test.ts`, `scripts/demo-seed/seed-floor.test.ts` and every
  suite that uses `plannedZone` (`grep -l plannedZone apps/server/src`) — PASS.
- [ ] **Step 4:** Commit: "Floor plan sets, step 8: tests and the demo seed use sets".

### Task 9a: Move the first group of server test callers to sets

Can run any time after Task 8 (only 9b removes the old routes); the dispatch order puts it after
25a/25b only to keep the list simple. Arguments only; no assertion changes.

**Files** (call counts of `saveZonePlan`/`readZonePlan` at `9d6ccd7b8`, `apps/server/src/`):
`service-delete.integration.test.ts` (11), `floor-catch-up.test.ts` (7), `joined-parts.test.ts`
(6), `floor-today-store.test.ts` (5), `floor-today-state.test.ts` (5), `floor-today-api.test.ts`
(4), `configuration-transfer.test.ts` (4).

- [ ] **Step 1:** Move each call to Task 8's `defaultLayout` with `saveLayout`/`readLayout`.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run` on the seven files: the same
  `Tests` count as before the change, all passing. `grep -c "saveZonePlan\|readZonePlan"` on each
  prints 0.
- [ ] **Step 3:** Commit: "Floor plan sets, step 9a: more tests use sets".

### Task 9b: Move the rest; remove the zone-only functions and routes

**Files:** `apps/server/src/` `table-removal.test.ts` (3), `management-api.service-delete.test.ts`
(3), `floor-today-split.test.ts` (3), `floor-today-reset-table.test.ts` (3),
`floor-revision.test.ts` (3), `booking-seat.test.ts` (3), `till-api.today-joins.test.ts` (2),
`tables.test.ts` (2), `floor-today-split-group.test.ts` (2), `floor-today-changes.test.ts` (2);
`apps/server/src/floor-plan.ts`; `apps/server/src/management-api.ts` (old routes 1666-1690,
`parseZonePlanSave` stays); `apps/server/src/floor-today-store.ts` (the set-less fallback,
`ensureToday`); `apps/dashboard/src/api/live-queries.ts:481-488`.

- [ ] **Step 1: Write the failing tests.** In `management-api.floor-plan-sets.test.ts`: "no longer
  serves the zone-only floor plan routes": `GET /management-api/zones/:id/floor-plan` answers
  404. In `floor-today-store.test.ts` (plan decision 24): "leaves a zone with tables but no saved
  due layout as it is at the day's first read": a zone moved into a department with no set keeps
  yesterday's today's rows and record after the first read of a new business day; after its
  department gains its first set (empty, no layout row), the next read STILL leaves it as it is,
  every free table where it stood; after a layout of that set is saved for the zone, the next
  read resets it onto that set and records it. Run — FAIL (the
  route answers 200; the zone is reset from its set-less row).
- [ ] **Step 2:** Move the ten files' calls as in 9a. Delete `readZonePlan`, `saveZonePlan`,
  `checkZonePlanSave`, the set-less `planOf` branch, the set-less reset fallback and the two old
  routes; `ensureToday` skips a zone whose due layout is null. `resetZone`'s `onto.setId` becomes
  `string`. Add `floor_plan_placements` and `floor_plan_sets` to the dashboard live query
  `getFloorPlan`'s list.
- [ ] **Step 3:** `grep -rn "saveZonePlan\|readZonePlan\|checkZonePlanSave" apps packages scripts`
  prints nothing. Run every file the task touched, by name, and
  `pnpm exec vitest run scripts/live-subscriptions.test.ts`. CI runs the package's coverage.
- [ ] **Step 4:** Commit: "Floor plan sets, step 9b: one layout per set everywhere".

### Task 10: Core `FloorPlanSets` port; `FloorDeletion.removeSets`; a department's delete removes its sets

**Files:**
- Create: `apps/server/src/floor-plan-sets.ts`, `…/floor-plan-sets.test.ts`
- Modify: `packages/module/src/module.ts` (`CoreServices` 36-43, `FloorDeletion` 94-101),
  `apps/server/src/parties.ts:119-129` (`moduleCoreServices`), `apps/server/src/floor-delete.ts`
  (`floorDeletionFor`, 150), `packages/venue-service/src/service-delete.ts` (`remove`, 309-331),
  `packages/venue-service/src/service-delete-settings.ts` (the removes list, 282-325),
  `packages/venue-service/src/dashboard/service-delete-copy.ts` (`itemKeys`, 5-28),
  `packages/venue-service/src/dashboard/strings.ts` (beside `venue.delete_item_department_periods`,
  31 and 853)

**Interfaces — Produces:**

```ts
export interface FloorPlanSets {
  /** A new empty set of the location (no layout rows); answers its id. */
  create(tx: Transaction): Promise<string>;
  /** Copies every layout row, placement and kept size of `fromSetId` into `toSetId`, each layout at revision 1. */
  copyLayouts(tx: Transaction, fromSetId: string, toSetId: string): Promise<void>;
  /** Each zone's table count, and each (set, zone) layout's revision and counts, a missing row as 0/0/all spare. */
  readLayouts(tx: Transaction, setIds: readonly string[], zoneIds: readonly string[]): Promise<{
    tableCounts: ReadonlyMap<string, number>;
    layouts: readonly { setId: string; zoneId: string; revision: number; onPlan: number; spare: number }[];
  }>;
  /** The zones whose today's record names the set, for the delete dialog's line. */
  zonesShowing(tx: Transaction, setId: string): Promise<string[]>;
}
// CoreServices gains `floorPlanSets: FloorPlanSets`.
// FloorDeletion gains the ONE verb for removing sets, used by the department delete and the set
// delete route (Task 11) alike:
/** Deletes the sets' placements, sizes, layouts and rows; a today's record naming one keeps its
 *  today's rows and loses its set. */
removeSets(tx: Transaction, setIds: readonly string[]): Promise<void>;
// Spares counted by layoutCounts: an unplaced plain table; an unplaced joined table none of whose
// parts is placed. Not spares: a part of a placed joined table; an unplaced joined table with a
// placed part (it has come apart, decision 9); a part of an unplaced joined table none of whose
// parts is placed (still joined).
/** Pure: a table counts once (spec §3). */
export function layoutCounts(tables: readonly { id: string; placed: boolean; partOf: string | null }[]): { onPlan: number; spare: number };
```

- [ ] **Step 1: Write the failing tests** in `floor-plan-sets.test.ts`:
  - `layoutCounts`, spec §3's Inside: Standard (1–12 placed, 4+5 off) → `{ onPlan: 12, spare: 0 }`;
    Dinner (4+5 placed, 4 and 5 off, others placed) → `{ 11, 0 }`; Private party (4+5, 1, 2, 3
    placed) → `{ 4, 7 }`. Terrace Standard (T1–T10 of 16) → `{ 10, 6 }`.
  - "copies a set's layouts": Dinner copied to "Late" reads the same places, revision 1.
  - "removes a set and nulls today's record": after `floorDeletionFor(…).removeSets`, no layout row of the set exists and
    the zone's `floor_today_zones.setId` is null while its today's rows are unchanged.
  - In `apps/server/src/service-delete.integration.test.ts`, which runs venue-service's delete
    with the real core port: "deleting a department
    removes its sets": its periods' `floorPlanSetId` become null, its links and sets are gone, and
    the impact read lists `{ key: "floor_plan_sets", count: 2 }`.
  - `packages/venue-service/src/dashboard/service-delete-copy.test.ts`: the item reads "Removes 2
    floor plan sets." / "Quita 2 conjuntos de planos de sala.".
- [ ] **Step 2:** Run the files — FAIL.
- [ ] **Step 3:** Implement; wire `floorPlanSets` into `moduleCoreServices` and `removeSets` into
  `floorDeletionFor`; in `remove()` for a department, read its links, empty its periods' field,
  delete the links, then `floor.removeSets`. Add `floor_plan_sets:
  "venue.delete_item_floor_plan_sets"` to `itemKeys`, with "Removes {count} floor plan sets." /
  "Quita {count} conjuntos de planos de sala.".
- [ ] **Step 4:** Run the files, `src/service-delete.integration.test.ts`,
  `src/management-api.service-delete.test.ts`, and `pnpm --filter @waitron/venue-service exec vitest run src/service-delete`.
- [ ] **Step 5:** Commit: "Floor plan sets, step 10: core copies and removes a set's layouts".

### Task 11: Venue-service set routes

**Files:**
- Create: `packages/venue-service/src/floor-plan-set-routes.ts`, `…/floor-plan-set-routes.test.ts`
- Modify: `packages/venue-service/src/floor-plan-set-store.ts`, `packages/venue-service/src/routes.ts`
  (call the new mount inside `VENUE_SERVICE_ROUTES.mount`, 397; `STATUS`, 92),
  `packages/venue-service/src/errors.ts`

**Interfaces — Produces** (all under `/management-api/venue-service`; reads need `venue.view`,
writes `venue.configure`):

```ts
// GET  /floor-plan-sets → FloorPlanSetsModel
// POST /floor-plan-sets { departmentId, name, fromSetId? } → 201 { setId }   (fromSetId required once the department has a set; refused on its first)
// PATCH /floor-plan-sets/:setId { name } → 204
// POST /floor-plan-sets/:setId/copy { name } → 201 { setId }
// POST /floor-plan-sets/:setId/make-default → 204
// GET  /floor-plan-sets/:setId/delete-impact → { periods: { id, name }[]; zonesShowing: { id, name }[] }
// POST /floor-plan-sets/:setId/delete { replaceWith: string | null } → 204   (null = the default; refused on the default)
export interface FloorPlanSetsModel {
  departments: {
    id: string; name: string;
    zones: { id: string; name: string; tableCount: number }[];
    sets: {
      id: string; name: string; isDefault: boolean;
      usedBy: { id: string; name: string; colour: CalendarColour }[]; // the default's includes periods whose field is empty
      layouts: { zoneId: string; onPlan: number; spare: number }[];
    }[];
  }[];
}
```

- [ ] **Step 1: Write the failing tests** in `floor-plan-set-routes.test.ts` (the route-test
  harness other venue-service route tests use): the model for Casa Marina's Restaurant (three
  sets, Lunch's field empty, Dinner's Dinner) lists Standard first with `isDefault`, Lunch in
  Standard's `usedBy`, Dinner in Dinner's; a first set with `fromSetId` → `floor_plan_set.invalid`
  { field: "fromSetId" }; a second set without it → the same; a `fromSetId` of another department →
  the same; a taken name → `floor_plan_set.name_taken`; delete of the default →
  `floor_plan_set.is_default`; delete Dinner with `replaceWith: null` empties the Dinner period's
  field; delete Dinner with `replaceWith` Private party sets the Dinner period's field to Private
  party; a `replaceWith` of Bar's set → `floor_plan_set.invalid` { field: "replaceWith" } and
  nothing deleted; a `replaceWith` naming the set being deleted → the same; make-default swaps the flags in one request; a `venue.view` person reads the model and is
  refused every write.
- [ ] **Step 2:** Run `pnpm --filter @waitron/venue-service exec vitest run src/floor-plan-set-routes.test.ts` — FAIL.
- [ ] **Step 3:** Implement with `ctx.core.floorPlanSets` (create, copy, counts) and
  `ctx.core.floorDeletion.removeSets` (delete). Make default clears the old flag before setting
  the new one (the partial unique index, Task 3). Delete writes the periods first, then the link,
  then `removeSets`. Register `floor_plan_set.is_default`,
  `floor_plan_set.invalid` (identical to the server's) and statuses (409, 409, 400, 404).
- [ ] **Step 4:** Run the file, then `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/module-seams.test.ts`.
- [ ] **Step 5:** Commit: "Floor plan sets, step 11: routes to add, rename, copy, default and delete a set".

### Task 12: Reset waiting rules

**Files:**
- Modify: `apps/server/src/floor-reset-plan.ts` (`LiveTable` 24-39, `planReset` 62-129),
  `apps/server/src/floor-today-store.ts` (`catchUpPass` 230-431, `todayColumns` 433-441)
- Test: `apps/server/src/floor-reset-plan.test.ts`, `apps/server/src/floor-catch-up.test.ts`

**Interfaces — Produces:**

```ts
// LiveTable gains:
clearing: boolean;          // needs clearing: waits like a held table (spec decision 10)
joinedWithWaiting: boolean; // in a joined group (a reset row's joined table and its parts) with a waiting member (plan decision 8)
// catchUpZone gains an options argument, used by Tasks 13 and 18:
export interface CatchUp { inReset: boolean; keepTakenOff: boolean }
export async function catchUpZone(tx, cfg, removals, zoneId, now, options?: CatchUp): Promise<void>; // default { inReset: false, keepTakenOff: false }
// resetZone (Task 7) gains a last argument passed through to the catch-up, so this task can test
// it before Task 18 gives it a route:
export async function resetZone(tx, cfg, removals, zoneId, now, onto, options?: { keepTakenOff: boolean }): Promise<number | null>;
```

- [ ] **Step 1: Write the failing tests:**
  - `floor-reset-plan.test.ts`: "a table that needs clearing waits" (its target lands in
    `pending`, not `apply`); "a joined group waits whole" (`joinedWithWaiting` → pending).
  - `floor-catch-up.test.ts`: "a free table needing clearing stays where it is at Reset to saved
    plan"; "the zone reset no longer clears needs clearing on split-off tables it takes back" — a
    split group with a part needing clearing waits at Reset to saved plan, and the mark stays
    (Reset table's own clearing, `floor-today-reset-table.ts:114-117`, is unchanged); "taking 4 into
    4+5 waits while 4 has guests": Dinner places 4+5, a party at 4 → 4, 5 and 4+5 all keep today's
    rows, and 4 and 5 stay usable (branch B of Task 7b: 4+5 is not drawn); "4+5 with guests waits
    joined under a layout that leaves it off" (spec §7.3's take-apart row, up to the wait; moved
    here from Task 7b, which runs before anything makes a group wait): Dinner recorded, a party at
    4+5, reset onto Standard → 4+5 keeps its place, 4 and 5's reset rows wait (`pending: true`,
    `placed: false`) and their today's rows stay off the map, and seating either is refused
    `table.in_joined_table` (branch A of Task 7b: 4+5 is drawn); the control, the same reset
    without the joined group in `waitingTogether`, puts 4 and 5 at their Standard places; "a reset with keepTakenOff keeps table 9 off at its new place" — table 9 taken off
    today, then `resetZone(…, onto Dinner, { keepTakenOff: true })` called directly: 9's today's
    row reads `takenOff: true` with Dinner's place; the control, the same call without the option,
    reads `takenOff: false`.
  Failing run: the table moved / the mark cleared / 5 vanished.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run src/floor-reset-plan.test.ts src/floor-catch-up.test.ts` — FAIL.
- [ ] **Step 3:** Read `needs_clearing_since` for the zone's tables in `catchUpPass`; add the
  reset rows' joined groups to `waitingTogether`'s closure beside the split groups; delete the
  `needsClearingSince: null` update at `floor-today-store.ts:402-405` (nothing reaches it now: a
  group with a member needing clearing waits); `todayColumns` takes `keepTakenOff` and the today's
  row's `takenOff`.
- [ ] **Step 4:** Run the two files and all floor suites (Task 2 Step 4's command).
- [ ] **Step 5:** Commit the behaviour; commit any changed assertion separately under the rule.

### Task 13: "Needs moving": later reads mark, the tables state reports

**Files:**
- Modify: `apps/server/src/floor-today-store.ts` (`catchUpPass`), `apps/server/src/floor-reset-plan.ts`,
  `apps/server/src/floor-revision.ts` (`roomPrints` 62-104),
  `apps/server/src/working-order.ts` (`TableToday` 7567-7589, its build near 7915)
- Test: `apps/server/src/floor-catch-up.test.ts`, `apps/server/src/floor-today-state.test.ts`

**Interfaces — Produces:**

```ts
/** Pure: whether applying `target` would carry a table drawn on today's map somewhere else. */
export function movesTable(
  today: { placement: Placement | null; takenOff: boolean; inMerge: boolean; splitOff: boolean } | null,
  target: Target,
): boolean; // null today, or not drawn (placement null or takenOff) → false (plan decision 10)
// TableToday gains: needsMoving: boolean
```

- [ ] **Step 1: Write the failing tests:**
  - `floor-reset-plan.test.ts`: `movesTable` true for a new place, into store, a table in a merge,
    a split-off table; false for a seats-only change, a table not drawn, a taken-off table.
  - `floor-catch-up.test.ts` (Review focus 2): "a table that frees up after a reset needs moving
    and stays put", with the clearing setting OFF, stated in the test by
    `writeClearingWorkflow(tx, false)` (`packages/venue-service/src/kitchen-notices.ts:340-345`;
    Finish table marks the table needing clearing only when it is on, `leaveForClearing`,
    `apps/server/src/parties.ts:657-668`): party at 3; reset onto Dinner; finish the party; tables
    read → 3's today's row keeps its lunch place, its reset row has `readyToMove: true`,
    `pending: true`; "with clearing on, a table shows Needs clearing first and Needs moving once
    cleared" (spec decision 10's server path): the same with `writeClearingWorkflow(tx, true)` →
    after Finish the tables read leaves 3's row pending with `readyToMove: false` and 3 reads
    `condition: "needs_clearing"`; `POST /api/tables/:id/cleared`; the next tables read sets
    `readyToMove: true` and 3 reads `today.needsMoving: true`, still at its lunch place; "a
    seats-only change still applies by itself"; "a row waiting for its name still applies"; "a
    removal of a deleted table still applies"; "a table seated with no today's row is still
    seeded"; "Reset table's and Split's catch-up mark other tables, not move them".
  - `floor-today-state.test.ts`: "reports needsMoving": the table above reads
    `today.needsMoving: true`; others `false`; "marking moves the room's revision"; "4+5 with
    guests is marked once free under a layout that leaves it off" (continuing Task 7b's take-apart
    wait): after its party finishes, 4+5 reads `needsMoving: true` at its place and 4 and 5 stay
    off the map.
- [ ] **Step 2:** Run the three files — FAIL.
- [ ] **Step 3:** In `catchUpPass`, when `options.inReset` is false, an `apply` entry whose table
  `movesTable` (or any member of its joined group does) is not applied: its row and its group's
  rows get `readyToMove: true` and stay pending. Rows with `readyToMove` are skipped by later
  passes. `resetZoneFor` now calls the catch-up with `{ inReset: true, keepTakenOff: false }`;
  `ensureToday`'s catch-up, Reset table's (`floor-today-reset-table.ts:141`) and Split's
  (`floor-today-split-group.ts:192`) keep the default. `roomPrints` selects the reset row's `readyToMove`. The tables state reads it.
- [ ] **Step 4:** Run the files and all floor suites.
- [ ] **Step 5:** Commit.

### Task 14: `table.needs_moving` refusals

**Files:**
- Modify: `packages/db/src/joined-parts.ts` (add the helper beside `joinedOutOfService`, 47-49),
  `apps/server/src/working-order.ts:1407-1409`, `apps/server/src/move-bill.ts:247-260`,
  `apps/server/src/floor-today-table.ts:97-109`, `apps/server/src/errors.ts:383-386`,
  `apps/server/src/till-api.ts:547`, `packages/bookings/src/routes.ts:51`,
  `apps/dashboard/src/i18n/codes.ts` (beside `table.needs_clearing`, 638-641)
- Test: `apps/server/src/floor-today-seat-api.test.ts`, `apps/server/src/party-move-bill.test.ts`,
  `apps/server/src/parties.test.ts` (the join path), `apps/server/src/floor-today-merges.test.ts`,
  `apps/server/src/booking-seat.test.ts` — each already tests `table.needs_clearing`

**Interfaces — Produces:**

```ts
/** The table's reset row waits for Mark moved. */
export function needsMoving(tableId: SQLWrapper): SQL;
// "table.needs_moving": { tableId: string } — 409, checked right after table.needs_clearing on each path.
```

- [ ] **Step 1: Write the failing tests:** seating a table that needs moving → `table.needs_moving`
  with its id; moving a party to it → the same; joining it to a party → the same; merging it on
  today's map → the same; booking-seat (seating a booking's party) → the same. (A table cannot
  need clearing and moving at once: needing clearing keeps its row waiting, Task 12, so it is not
  marked until cleared — Task 13 tests that order.)
- [ ] **Step 2:** Run — FAIL (seated).
- [ ] **Step 3:** Implement and register; add the status in both maps. Dashboard copy beside
  `table.needs_clearing`: "That table needs moving first. Mark it moved on the till, then try
  again" / "Esa mesa está por mover. Márcala como movida en la caja e inténtalo de nuevo", with a
  case in the dashboard's codes test if `table.needs_clearing` has one.
- [ ] **Step 4:** Run the files; `pnpm exec vitest run scripts/errors-reachable.test.ts`.
- [ ] **Step 5:** Commit.

### Task 15: No table put down on another, at every reset (A600)

**Files:**
- Modify: `apps/server/src/floor-reset-plan.ts`, `apps/server/src/floor-today-store.ts`
- Test: `apps/server/src/floor-reset-plan.test.ts`, `apps/server/src/floor-catch-up.test.ts`

**Interfaces:**
- Consumes: `standsIn` (`apps/server/src/joined-split-layout.ts:152-164`).
- Produces:

```ts
/** The moving tables that must keep their place: repeated until a pass blocks nothing new; a
 *  blocked table's current place joins `staying` (spec decision 13). Tables moving together never block each other. */
export function blockedMoves(input: {
  moving: readonly { tableId: string; from: Placement | null; to: Placement | null }[];
  staying: readonly { tableId: string; place: Placement }[];
}): Set<string>;
```

- [ ] **Step 1: Write the failing tests** (Review focus 3):
  - `blockedMoves`: 2's new place is where waiting 3 stands → {2}; then 1's new place is 2's
    current place → {1, 2}; 2 and 3 swapping, both moving → {}; a table moving into store never
    blocked; a staying table that only touches the edge does not block.
  - `floor-catch-up.test.ts`: "Update to Dinner keeps 2 and 1 in place while 3 waits" → after
    the reset 1 and 2 read `needsMoving: true` at their lunch places; "a stored table whose new
    place is taken waits off the map, and a later read places it once the place is clear"
    (plan decision 10); "a taken-off table blocks nothing"; "a part out of service inside a
    joined table blocks nothing".
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** In `catchUpPass` inside a reset, before applying: `staying` = the zone's tables
  drawn on today's map (placed, not taken off, not `joinedOutOfService`) not in `plan.apply`;
  `moving` = `plan.apply` targets of drawn tables. Blocked drawn tables (and their joined groups)
  get `readyToMove`; a blocked table not drawn stays pending without `readyToMove`. On a later read,
  a pending table not drawn is applied only if its new place is clear of staying tables that do
  not need moving.
- [ ] **Step 4:** Run the files and all floor suites.
- [ ] **Step 5:** Commit: "Floor plan sets, step 15: no reset puts a table down on another (A600)".

### Task 16: Mark moved (and Back to saved place on a table that needs moving)

**Files:**
- Create: `apps/server/src/floor-today-mark-moved.ts`, `…/floor-today-mark-moved.test.ts`
- Modify: `apps/server/src/floor-today-api.ts` (a `tableRoute("mark-moved", …)` beside the others,
  167-224), `apps/server/src/floor-today-store.ts` (extract the apply half of `catchUpPass` into
  `applyResetRows(tx, cfg, removals, zoneId, rows, now)`; `backToSaved` 727-760),
  `apps/server/src/errors.ts` (beside
  `table.place_taken`, 381), `apps/server/src/till-api.ts:527`,
  `apps/server/src/till-api.profile-actions.test.ts:105`, `:428-430`,
  `apps/server/src/till-api.profile-zones.test.ts:131-146`, `:852-875`

**Interfaces — Produces:**

```ts
export async function markMoved(tx, cfg: TillConfig, removals, tableId: string, now: Date): Promise<void>;
// POST /api/tables/:id/today/mark-moved { zoneRevision } → { zoneId, revision }   take-orders
// "table.new_place_taken": { tableId: string; standingId: string } — 409
```

- [ ] **Step 1: Write the failing tests** in `floor-today-mark-moved.test.ts`: "puts a table
  needing moving in its new place and clears its mark"; "moves the whole joined group" (4 and 5
  ready, Mark moved on 5 → 4 and 5 off, 4+5 at its dinner place); "takes 4+5 apart" (spec
  §7.3's row, finishing Tasks 7b and 13: Dinner recorded, 4+5 with guests, reset onto Standard,
  party finished, Mark moved on 4+5 → 4+5 off the map and out of service, 4 and 5 at their
  Standard places and seatable; refused `table.new_place_taken` instead while a table that does
  not need moving stands in 4's place); "Back to its saved place on a table that needs moving is
  Mark moved" (plan decision 23: placed, mark cleared, and refused `table.new_place_taken` in the
  same case Mark moved is); "is refused while a table that
  does not need moving stands in the new place" (`table.new_place_taken` naming it); "is not
  blocked by a table that itself needs moving" (2 and 3 swap: mark 2 first, then 3; the map
  overlaps between); "changes nothing on a table that does not need moving" (plan decision 11).
  Route cases in `floor-today-api.test.ts`: a stale revision → `floor_today.out_of_date`. In the
  two route maps: "refuses POST /api/tables/:id/today/mark-moved" without `take-orders` and outside
  the profile's zones.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement on `applyResetRows`, checking each moving member's new place with
  `standsIn` against drawn tables that neither need moving nor belong to the group.
  `backToSaved` calls `markMoved` when the table's reset row is `readyToMove`, before its own
  checks.
- [ ] **Step 4:** Run the files and the two route-map files.
- [ ] **Step 5:** Commit.

### Task 17: The zones read offers the due layout

**Files:**
- Modify: `apps/server/src/till-api.ts:2607-2643`
- Test: `apps/server/src/till-api.zones-layout.test.ts` (new)

**Interfaces — Produces** (each zone of `GET /api/zones`):

```ts
hasPlan: boolean;               // the zone's department has a set (plan decision 19)
layoutSetName: string | null;   // the recorded set's name; null when none recorded or the set is gone
layoutDue: { setId: string; revision: number; periodName: string | null } | null; // layoutOffer(...)
```

- [ ] **Step 1: Write the failing tests** with the server clock fixed: Lunch running → no
  `layoutDue`, `layoutSetName: "Standard"`; at 16:00 → `layoutDue` Dinner with
  `periodName: "Dinner"`; an edit saved to Standard at 14:00 → `periodName: null`; Dinner's field
  changed to Private party at 17:00 after an update to Dinner → `periodName: null` (spec's 17:00
  example); the set deleted → `layoutSetName: null` and `layoutDue` the default; a record from
  yesterday → `layoutDue: null`; the read writes nothing (`floor_today_zones` unchanged);
  "hasPlan says the department has a set" (plan decision 19): a zone of a department with a set
  but no tables reads `hasPlan: true`; a zone with tables whose department has no set, and a zone
  in no department, read `hasPlan: false`.
- [ ] **Step 2:** Run `pnpm --filter @waitron/server exec vitest run src/till-api.zones-layout.test.ts` — FAIL.
- [ ] **Step 3:** Implement with `zoneLayouts` and `layoutOffer` at `deps.clock.now().instant`.
- [ ] **Step 4: Measure** the read's cost (spec §7.1, "which the plan measures"): in a throwaway
  case (not committed) time 100 reads on a venue of three departments, four periods each and
  three zones per department, before and after the change; record both medians and the command in
  the ledger and the PR description.
- [ ] **Step 5:** Run the file and `src/till-api.profile-zones.test.ts`; commit.

### Task 18: Update layout, and Reset to … plan onto the recorded set

**Files:**
- Modify: `apps/server/src/floor-today-api.ts` (the zone reset 226-253; a new route beside it),
  `apps/server/src/errors.ts` (beside `floor_today.out_of_date`, 722), `apps/server/src/till-api.ts:542`,
  both route-map test files
- Test: `apps/server/src/floor-today-api.test.ts`

**Interfaces — Produces:**

```ts
// POST /api/zones/:id/today/update-layout { zoneRevision, setId, layoutRevision } → { zoneId, revision }   take-orders
// "floor_today.layout_changed": { zoneId: string } — 409
// POST /api/zones/:id/today/reset now resets onto the recorded set at its current revision and keeps the occurrence.
```

- [ ] **Step 1: Write the failing tests:** "Update layout applies the offered layout and records
  it" (16:20, the owner's example: free tables move, 4 and 5 become 4+5, 9 taken off stays off, 3
  with guests stays and later needs moving; the record names Dinner and Dinner 20:00); "refuses a
  layout no longer due" → `floor_today.layout_changed`; "checks the room first" → stale revision is
  `floor_today.out_of_date` even when the layout also changed; "keeps a party's table, bills and
  tickets" (Review focus 5: the party's `party_tables`, bills and ticket items are equal before and
  after); "Reset to … plan resets onto the recorded set, brings its edit, keeps the occurrence, and
  undoes taken-off"; "Reset to … plan never brings another set" (Dinner due, Standard recorded →
  resets onto Standard, banner still offered); "is refused when the recorded set is gone"
  (plan decision 13). Route-map rows and refusing cases for update-layout.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement: both routes run `ensureToday`, check the room's revision, then
  (Update layout) compare the sent set and revision with `zoneLayouts`' due and reset with
  `{ inReset: true, keepTakenOff: true }`; the zone reset uses the record and
  `{ inReset: true, keepTakenOff: false }`.
- [ ] **Step 4:** Run the file and the two route-map files; `pnpm exec vitest run scripts/errors-reachable.test.ts`.
- [ ] **Step 5:** Commit.

### Task 19: `wt-combobox` muted option

**Files:**
- Modify: `packages/ui/src/components/wt-combobox.ts` (`ComboboxOption` 11-34, the closed value
  around 1034 and 1070, the list rows)
- Test: `packages/ui/src/components/wt-combobox.test.ts`, `…/wt-combobox.a11y.test.ts`

**Interfaces — Produces:** `ComboboxOption.muted?: true` — "Drawn in `--wt-color-text-muted` in
the open list and on the closed field when chosen." The default set is an option with value `""`,
so its callers (Tasks 22 and 24) also set `showEmptyOption`, without which an empty value shows
no text at all (`showEmptyOption`, `wt-combobox.ts:382-384`; `selectedText`, `493-504`). This is a
change to a shared `wt-*` primitive: it carries a token-painting test and the a11y test's new
state in both themes.

- [ ] **Step 1: Write the failing tests:** the token-painting case: a muted option's row and the
  closed field's text (with `showEmptyOption` and the muted `""` option chosen) compute to
  `--wt-color-text-muted` in light and dark; a non-muted chosen option does not; the a11y file
  adds two states, the closed field showing the muted choice and the open list with a muted first
  option, each in both themes, axe clean.
- [ ] **Step 2:** `pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox.test.ts src/components/wt-combobox.a11y.test.ts` — FAIL.
- [ ] **Step 3:** Implement with a `part` or class on the row and on `.value`; no new token.
- [ ] **Step 4:** Run the files; `pnpm exec vitest run scripts/style-token-names.test.ts`;
  `pnpm --filter @waitron/ui exec vitest run src/no-hardcoded-chrome.test.ts`.
- [ ] **Step 5:** Commit.

### Task 20: Floor plans page — the list

**Files:**
- Create: `packages/venue-service/src/dashboard/floor-plans-screen.ts`, `…/floor-plans-screen.test.ts`,
  `…/floor-plans-screen.a11y.test.ts`
- Modify: `packages/venue-service/src/dashboard/index.ts` (`moreScreens`, 72-114; search
  destinations 23-60), `…/client.ts`, `…/live-queries.ts` (lists 1-45 and 209-243), `…/strings.ts`,
  `…/departments-list.ts:232-242` (the link goes), `apps/server/src/management-api.ts:1580-1593`
  and `apps/server/src/floor-plan.ts:151-162` (`hasPlacedTables` and `zonesWithPlacedTables` go:
  their only reader was that link), `apps/dashboard/src/api/client.ts:658`,
  `packages/venue-service/src/dashboard/client.ts:92`

**Interfaces — Produces:** screen `floor-plans` (`navLabelKey: "nav.floor_plans"`, group
`operations`, order 13, `requiresPermission: "venue.configure"`, `readPermission: "venue.view"`);
`VenueServiceApi.floorPlanSets(): Promise<FloorPlanSetsModel>` subscribed as
`getFloorPlanSets` on `floor_plan_sets`, `floor_plans`, `floor_plan_placements`,
`floor_plan_tables`, `floor_plan_table_parts`, `department_floor_plan_sets`, `menu_periods`,
`departments`, `zone_service_policies`, `floor_zones`.

- [ ] **Step 1: Write the failing tests** (browser): with Casa Marina's model, rows read
  Restaurant; Standard "Default", chips Lunch; Inside "12 on the plan", Terrace "10 on the plan ·
  6 spare"; Dinner: Inside "11 on the plan", Terrace "8 on the plan · 8 spare"; Private party:
  Inside "4 on the plan · 7 spare", Terrace "No tables on the plan · 16 spare"; a zone with no
  tables "No tables yet"; a department with no set "No sets yet"; a set used by nothing "Not used";
  each zone row's link is `/manage/floor-plan/set/{set}/zone/{zone}?back=%2Fmanage%2Ffloor-plans`;
  a `venue.view` reader sees no "+ Add set" and no row menus; zone rows have no menu. Spanish
  strings for the same. The Departments list no longer renders `floor-plan-zone-*` links.
- [ ] **Step 2:** `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/floor-plans-screen.test.ts` — FAIL.
- [ ] **Step 3:** Implement with `wt-data-table` grouped as the Periods list is
  (`periods-list.ts:240-292`); the set row menu column `actions`, `pinned: "end"` (menu items come
  in Tasks 21-22). Strings from spec §8, keys under `floor_plans.*`.
- [ ] **Step 4:** Run the files, `src/dashboard/departments-list.test.ts`,
  `pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/pinned-actions-column.test.ts scripts/native-form-fields.test.ts scripts/style-token-names.test.ts`.
- [ ] **Step 5:** Commit.

### Task 21: Floor plans page — Add set, Rename, Copy

**Files:**
- Create: `packages/venue-service/src/dashboard/floor-plan-set-dialog.ts`, `….test.ts`,
  `….unsaved.test.ts`, `….a11y.test.ts`
- Modify: `floor-plans-screen.ts`, `client.ts`, `strings.ts`

**Interfaces — Produces:** `<dashboard-floor-plan-set-dialog>` with
`mode: "add" | "rename" | "copy"`. Add asks Department (a `wt-combobox`), Name, and Start from
only once the chosen department has a set (default first); Rename and Copy ask Name.

- [ ] **Step 1: Write the failing tests:** Department and Name are marked required, and so is
  Start from whenever it shows (design-system.md → Forms: required fields visibly marked); Save
  is quiet and disabled until the draft changes and the required fields are filled (A331); "+ Add set" for a department with no set shows no Start
  from and sends no `fromSetId`; for Restaurant it shows Start from preselected to the default;
  a `floor_plan_set.name_taken` refusal marks Name with "Another set of this department already
  has this name." / "Otro conjunto de este departamento ya tiene este nombre." and the bottom
  message; the unsaved test: closing with a changed draft asks before leaving.
- [ ] **Step 2:** Run the files — FAIL.
- [ ] **Step 3:** Implement with `draftScopeFor`, `saveActionState` and an early return in save,
  as `period-dialog.ts:192-205`, `300` do.
- [ ] **Step 4:** Run the files and the screen's tests.
- [ ] **Step 5:** Commit.

### Task 22: Floor plans page — Make default and Delete

**Files:**
- Create: `packages/venue-service/src/dashboard/floor-plan-set-delete-dialog.ts`, `….test.ts`,
  `….a11y.test.ts`
- Modify: `floor-plans-screen.ts`, `client.ts`, `strings.ts`

- [ ] **Step 1: Write the failing tests:** the default's row menu offers Rename… and Copy… only;
  another set's offers Make default and Delete… too; Make default sends one request and the list
  follows its live read; Delete… reads the impact, titles "Delete Dinner?", lists the periods
  using it, says the tables stay, offers Replace with preselected to "Standard (default)" drawn
  muted (Task 19: the `""` option with `muted`, and `showEmptyOption` on the field), adds "On the floor, Inside keep today's layout until someone presses Update
  layout." only while a zone shows the set today, and the danger button reads "Delete Dinner".
  Spanish for each from spec §8.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement, following the period delete dialog's Replace with
  (`strings.ts:748-749`, `1603-1604`).
- [ ] **Step 4:** Run the files.
- [ ] **Step 5:** Commit.

### Task 23: Core rebuild generation

Dispatched right after Task 9b and before Task 10: nothing reads or writes
`floor_plan_tables.plan_id` or its place columns any more, and until this lands a set's layout
row cannot be deleted while a table names it (`floor_plan_tables_plan_fk`,
`packages/db/src/schema/floor-plans.ts:109-113`).

**Files:**
- Modify: `packages/db/src/schema/floor-plans.ts`, `scripts/migration-upgrade.test.ts` (`RESETS`,
  from line 361), and every reader or writer of the dropped columns found by
  `grep -rnE "floorPlanTables\.(planId|x|y|width|height|shape|rotation)\b|planId: plan|floor_plan_tables\.(plan_id|x|y|width|height|shape|rotation)" apps packages scripts --include='*.ts'`
  (at `9d6ccd7b8` that includes `apps/server/src/floor-plan.ts`, `floor-today-store.ts`,
  `floor-today-parts.ts:36-37` and `floor-delete.ts`; Tasks 2, 7 and 9b should have emptied it;
  anything left is moved here), AND every test fixture still writing `planId` on a table row:
  `grep -rn "insert(floorPlanTables)" apps packages --include='*.test.ts'` and read each hit's
  values — at `9d6ccd7b8` the hits are `apps/server/src/floor-today-store.test.ts` (`masterRow` 99-107, used at 120 and 149),
  `apps/server/src/floor-plan.test.ts`, `apps/server/src/floor-delete.test.ts`,
  `apps/server/src/table-removal.test.ts`, `apps/server/src/service-delete.integration.test.ts`,
  `apps/server/src/management-api.service-delete.test.ts`, `packages/bookings/src/bookings.test.ts`,
  `packages/db/src/joined-parts.test.ts` (`planId: PLAN`, 307-310) and
  `packages/db/src/schema/floor-plans.test.ts` (the first grep cannot see `planId: PLAN` or
  `masterRow(plan!.id, …)`). Each drops `planId` here.
- Create: the generated SQL and snapshot

The generation changes, with no column added: `floor_plan_tables` drops `plan_id`, its six place
columns, the place checks and `floor_plan_tables_plan_label_key`, keeps
`floor_plan_tables_seats_ck` (seats stay on the shared table; Task 1's `seatsCheck`), and makes
`zone_id` NOT NULL; `floor_plan_table_sizes` makes `plan_id` NOT NULL; `floor_plans` makes
`set_id` NOT NULL.

**Foreign keys pointing at the tables it rebuilds** (read in the schema at `9d6ccd7b8` plus Task 1;
all `no action`, so a `DROP TABLE` is refused while a child row exists — CLAUDE.md §3):
- `floor_plan_tables`: `dining_tables.plan_table_id` (`packages/db/src/schema/dining-tables.ts:26`),
  `floor_reset_tables.plan_table_id` (`floor-plans.ts:181`), `floor_plan_table_parts.joined_table_id`
  and `.part_table_id` (`floor-plans.ts:130-139`), `floor_plan_table_sizes.plan_table_id`
  (`floor-plans.ts:156-160`), `floor_plan_placements.plan_table_id` (Task 1).
- `floor_plans`: `floor_plan_placements.plan_id` and `floor_plan_table_sizes.plan_id` (Task 1),
  and `floor_plan_tables.plan_id` until this generation drops it.
- `floor_plan_table_sizes`: none.
Before generating, confirm the list on a database migrated to Task 1's generation:
`select m.name, p."from", p."table", p.on_delete from sqlite_master m join pragma_foreign_key_list(m.name) p where p."table" in ('floor_plan_tables','floor_plans','floor_plan_table_sizes')`.
Also confirm no trigger body names the three tables: `select name from sqlite_master where type = 'trigger' and sql like '%floor_plan%'` prints nothing but change-feed triggers (which `applyMigrations` removes first, CLAUDE.md §2).

**What happens to rows — and why the answer is a venue reset, not a cleverer migration.** A
database holding floor tables cannot carry them through this generation, whoever wrote them:
- Rows written by `main`'s code have no `zone_id`, so drizzle's copy into
  `__new_floor_plan_tables` fails `NOT NULL constraint failed: __new_floor_plan_tables.zone_id`
  (the reviewer's probe, 2026-10-17).
- Rows written by the branch before this task have `zone_id`, so the copy succeeds, and then
  `DROP TABLE floor_plan_tables` is refused `FOREIGN KEY constraint failed`, because live tables
  (`dining_tables.plan_table_id`) and reset rows point at it and the migrator runs inside a
  transaction where `PRAGMA foreign_keys=OFF` does nothing (CLAUDE.md §3; the reviewer's probe).
No order of rebuilds avoids the second: every rebuild of a table that live tables point at drops
it. A backfill would fix only the first. Deleting the dependent rows deliberately would mean
deleting live tables, parties' table links and reset rows — data-migration code CLAUDE.md §3
forbids before go-live, and a loss of live state on a venue. So: the step is declared in
`RESETS` (every installation is reset, Global constraints), nobody runs the dev stack on the branch
before this task (so no venue holds the branch's interim shape), and the guard proves the rest.

- [ ] **Step 1:** Write the failing test in `packages/db/src/schema/floor-plans.test.ts`:
  "floor_plan_tables has no place columns and needs a zone": the table's `pragma_table_info` lists
  none of `plan_id, x, y, width, height, shape, rotation`, still has `seats` with its check, and
  an insert without `zone_id` is refused `NOT NULL constraint failed: floor_plan_tables.zone_id`.
  Run — FAIL.
- [ ] **Step 2:** Change the schema; `pnpm --filter @waitron/db db:generate`; read the SQL: three
  `__new_` rebuilds, no `ADD` column, no other table touched.
- [ ] **Step 3: The data path, proved two ways.**
  - `pnpm exec vitest run scripts/migration-upgrade.test.ts` FAILS first at the new step, naming
    it. Add a `RESETS` entry, `refused`, with the message parts the walk printed (with its
    synthetic rows, either of the two messages above; `zone_id` sits in a unique index, so the
    walk may not leave it null), and a one-line comment: "Rebuilds floor_plan_tables, which live
    tables point at; every venue needs a reset (A504)." Rerun: PASS. This guard proves three
    things: the step fails exactly as declared, an EMPTY database migrates through it, and the
    steps after it carry rows (the walk refills after a listed step).
  - A throwaway probe, not committed: a `useVenueDb`-style case that applies the chain up to the
    step before this one, writes a zone, a set, a layout, two tables (one placed), and lets a
    reset make their live tables and reset rows as the branch's code does, then applies this
    generation: it must reject with `FOREIGN KEY constraint failed` and leave the database
    unchanged (a `select count(*)` of each floor table equal before and after). Record the
    command and the counts in the ledger and the PR description.
- [ ] **Step 4:** Run every guard of Global constraints' migration list, the inmutabilidad file, the
  golden case (`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts -t "as main did for the same basket"`),
  `pnpm --filter @waitron/db exec vitest run`, `pnpm --filter @waitron/server exec vitest run src/floor- src/joined src/table-removal src/service-delete src/management-api.service-delete`,
  `pnpm --filter @waitron/bookings exec vitest run src/bookings.test.ts`, and the typechecks
  `pnpm --filter @waitron/db typecheck`, `pnpm --filter @waitron/server typecheck` and
  `pnpm --filter @waitron/bookings typecheck` (a dropped
  column a test still names is a type error vitest does not report).
- [ ] **Step 5:** Commit: "Floor plan sets, step 23: a zone's tables keep no place of their own (venue reset needed)".

### Task 24: Period dialog field and Periods column

**Files:**
- Modify: `packages/venue-service/src/dashboard/period-dialog.ts` (fields 443-573; the draft
  34-60), `…/periods-list.ts` (columns 250-292), `…/client.ts`, `…/strings.ts`,
  `…/live-queries.ts` (the Periods window's reads), `packages/venue-service/src/menu-timetable-types.ts:6-12`,
  `packages/venue-service/src/routes.ts` (period create 1149-1178 and patch from 1226),
  `packages/venue-service/src/menu-timetable.ts` (`saveMenuPeriod` 499, `updateMenuPeriod` 612),
  `packages/venue-service/src/errors.ts:76-85`
- Test: `period-dialog.test.ts`, `period-dialog.unsaved.test.ts`, `periods-list.test.ts`, the
  period route tests

**Interfaces — Produces:** `MenuPeriodInput.floorPlanSetId?: string | null` (absent keeps,
`null` empties); the period read gains `floorPlanSetId: string | null`.

- [ ] **Step 1: Write the failing tests:** the route stores and empties the field; a set of another
  department → `menu_period.invalid` { field: "floorPlanSetId" }; the dialog shows Floor plan after
  Period end offset and before Painted in only when the department has a zone with tables; an
  empty field shows "Standard (default)" muted; choosing the default sends `null`; the field is
  not marked required; the Periods column shows the set's name, or "Standard (default)" with
  "(default)" muted through `part=`, and nothing for a department without tables; the column shows
  only when some department has a zone with tables.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement. The field's first option is `{ value: "", label: "Standard
  (default)", muted: true }` and the field sets `showEmptyOption` (Task 19), so an empty field
  shows that text muted rather than nothing. The column cell's muted part is styled with
  `::part()`.
- [ ] **Step 4:** Run the files; `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/live-subscriptions.test.ts`.
- [ ] **Step 5:** Commit.

### Task 25a: Editor — address, API, title, shared-tables line, Close

Dispatched after Task 8 and before Task 9a.

**Files:**
- Modify: `apps/dashboard/src/navigation.ts:34`, `apps/dashboard/src/dashboard-app.ts:295`,
  `apps/dashboard/src/api/client.ts:3095-3110` (and the `FloorPlan` type, 671-700),
  `apps/dashboard/src/screens/floor-plan-editor.ts` (address read 550-582, title near 1107 and
  1185), `apps/dashboard/src/i18n` strings
- Test: `apps/dashboard/src/screens/floor-plan-editor.test.ts`,
  `…/floor-plan-editor.deleted-zone.test.ts`, `…/floor-plan-editor.save.test.ts`

**Interfaces — Produces:** `DashboardApi.getFloorPlan(setId, zoneId)`,
`saveFloorPlan(setId, zoneId, body)`; `dashboardPath.children["floor-plan"] = { set: "set", zone: "zone" }`;
`FloorPlan` gains `setId` and `setName` (Task 6's read answer).

- [ ] **Step 1: Write the failing tests:** the editor opened at
  `/manage/floor-plan/set/S/zone/Z?back=%2Fmanage%2Ffloor-plans` reads
  `GET /management-api/floor-plan-sets/S/zones/Z/floor-plan` and saves with `PUT` to the same
  path; its title reads "Inside · Dinner"; the line "Tables are shared by every set. Adding,
  renaming or deleting one here does it in every set." / "Las mesas son comunes a todos los
  conjuntos. Añadir, renombrar o eliminar una aquí lo hace en todos." shows under it; Close goes
  to `/manage/floor-plans`; a `floor_plan_set.not_found` or `floor_plan_set.invalid` load shows
  the not-found state the deleted-zone case shows.
- [ ] **Step 2:** `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-editor` — FAIL.
- [ ] **Step 3:** Implement. Header buttons stay Undo, Redo, Cancel, Save (design-system.md, "The
  floor plan editor's header is the owner's exception").
- [ ] **Step 4:** Run every `floor-plan-editor*` test file, `floor-plan-editor.unsaved.test.ts` and
  `floor-plan-editor.a11y.test.ts` included; `pnpm exec vitest run scripts/live-subscriptions.test.ts`.
- [ ] **Step 5:** Commit: "Floor plan sets, step 25a: the editor opens a set's layout".

### Task 25b: Editor — a joined table's parts per layout

**Files:**
- Modify: `apps/dashboard/src/screens/floor-plan-tables-panel.ts:189-191` (the guard that ignores
  a press on a part), `apps/dashboard/src/screens/floor-plan-draft.ts` (`placeTable`;
  `freeTables` 322-331 is unchanged: a new joined table is still made of tables off this layout)
- Test: `floor-plan-tables-panel.test.ts`, `floor-plan-draft.test.ts`

**Interfaces — Produces:** `placeTable` on a joined table also takes its standing parts off this
layout in the same change; on a part whose joined table stands, it changes nothing.

- [ ] **Step 1: Write the failing tests:** pressing a part of a joined table that is off this
  layout places it; pressing a part of a placed joined table does nothing (as today); placing a
  joined table whose parts stand takes them off, and one Undo puts all three back; the draft sent
  never places both a joined table and one of its parts (the server's rule, Task 6).
- [ ] **Step 2:** `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-tables-panel.test.ts src/screens/floor-plan-draft.test.ts` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the two files and `floor-plan-editor.test.ts`.
- [ ] **Step 5:** Commit: "Floor plan sets, step 25b: a layout may stand a joined table's tables".

### Task 26: Till — banner and Update layout

**Files:**
- Modify: `apps/till/src/api/client.ts` (`FloorZone` 1828-1839; a method beside `resetZoneToday`,
  4241-4246), `apps/till/src/screens/till-floor-screen.ts` (under the toolbar, 1772-1790;
  `FloorRefreshDetail`, 117), `apps/till/src/till-app.ts` (`#onFloorRefresh` 8487-8491, the
  `@floor-refresh` handler near 13154), `apps/till/src/i18n/strings.ts`, `apps/till/src/i18n/codes.ts`
- Test: `apps/till/src/screens/till-floor-screen.layout.test.ts` (new), `till-floor-screen.a11y.test.ts`, `apps/till/src/i18n/codes.test.ts`

**Interfaces — Produces:** `TillApi.updateLayoutToday(zoneId, offer: { setId: string; revision: number }, zoneRevision: number | null): Promise<FloorAnswer>`;
strings `floor.layout_ready` "{period} layout is ready." / "El plano de {period} está listo.",
`floor.layout_newer` "A newer layout is ready." / "Hay un plano más reciente.",
`floor.update_layout` "Update layout" / "Actualizar plano"; code
`floor_today.layout_changed`: "The layout has changed. Check the floor and try again" / "El plano ha
cambiado. Revisa la sala e inténtalo de nuevo".

- [ ] **Step 1: Write the failing tests:** a zone with `layoutDue.periodName: "Dinner"` shows
  "Dinner layout is ready." with Update layout under the tabs, above the map and above the list;
  `periodName: null` shows "A newer layout is ready."; no banner without `canChangeToday`; no
  close button; pressing sends the offered set and revision with the room's revision through
  `#onZoneChange` (`till-floor-screen.ts:1649-1659`); after the press, whether it succeeded or
  was refused, the till re-reads the ZONES as well as the tables — today a floor refresh re-reads
  the tables only (`#onFloorRefresh` → `#refreshFloor`, `till-app.ts:8487-8491`) and the banner's
  facts come from the 15-second zones read (`#refreshFloorZones`, 8477); "the banner goes after a
  successful press": with a mocked api whose second `listZones` answers no `layoutDue`, the banner
  is gone straight after the press, without waiting for a tick; a `floor_today.layout_changed`
  refusal re-reads both and shows what is due; axe clean in both themes.
- [ ] **Step 2:** `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.layout.test.ts` — FAIL.
- [ ] **Step 3:** Implement. The banner is a `role="status"` line in the floor screen.
  `FloorRefreshDetail` (today `{ poll: true }`) becomes `{ poll?: true; zones?: true }`; the floor screen sends `{ zones: true }` after Update layout (and,
  in Task 28, after Reset to … plan); `till-app` then runs `#refreshFloorZones` beside
  `#refreshFloor`.
- [ ] **Step 4:** Run the files and `src/screens/till-floor-screen.zone-menu.test.ts`.
- [ ] **Step 5:** Commit.

### Task 27: Till — Needs moving on the map and the list

**Files:**
- Modify: `apps/till/src/api/client.ts` (`TableToday`, 1962), `apps/till/src/screens/till-floor-screen.ts`
  (`#openTable` 734-760, the status chip 1677-1684, `#clearDialog` 1920-1952, `#clearingCard`
  1954-1969, `#card` 1990-1991, `#namedRefusal` 1215-1230), `apps/till/src/state/floor-today.ts`
  (`sheetActions` 375-395), `apps/till/src/widgets/table-targets.ts:99-124`, strings, codes
- Test: `apps/till/src/screens/till-floor-screen.needs-moving.test.ts` (new), `codes.test.ts`

**Interfaces — Produces:** strings `floor.needs_moving` "Needs moving" / "Por mover",
`floor.mark_moved` "Mark moved" / "Marcar movida", `floor.move_title` "Table {table} needs moving" /
"La mesa {table} está por mover", `floor.move_title_named` "{table} needs moving" / "{table} está por
mover", `floor.move_body` (spec decision 22's words), `floor.new_place_taken` "{other} is standing in
{table}'s new place. Move {other} first." / "{other} ocupa el nuevo sitio de {table}. Mueve {other}
primero."; codes `table.needs_moving` "That table needs moving. Mark it moved first" / "Esa mesa está
por mover. Márcala como movida primero" and `table.new_place_taken` "Another table is in its new
place. Move it first" / "Otra mesa ocupa su nuevo sitio. Muévela primero";
`TillApi.markMovedToday(tableId, zoneRevision)`.

- [ ] **Step 1: Write the failing tests:** a table with `today.needsMoving` draws in its old place
  with a "Needs moving" chip in `--wt-color-warning`; a table needing clearing shows "Needs
  clearing" even when it also needs moving; tapping it opens the Mark moved question (title,
  body, Cancel, Mark moved) and Mark moved sends `mark-moved` with the room's revision; on the list
  it is the plain card with "Needs moving" and a Mark moved button; Join with… and the seat
  pickers leave it out; `table.new_place_taken` names both tables.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement beside the needs-clearing code paths.
- [ ] **Step 4:** Run the file, `till-floor-screen.signals.test.ts`, `till-floor-screen.sheet.test.ts`, `codes.test.ts`.
- [ ] **Step 5:** Commit.

### Task 28: Till — zone menu wording, and List/Map in the menu on a phone

**Files:**
- Modify: `apps/till/src/widgets/floor-zone-menu.ts` (render 133-169, `#reset` 120-131),
  `apps/till/src/screens/till-floor-screen.ts` (`#zoneMenu` 1620-1647, the toolbar 1772-1790),
  strings (`floor.reset_plan` 872/2410, `floor.reset_body` 874/2412)
- Test: `apps/till/src/screens/till-floor-screen.zone-menu.test.ts`, `…/till-floor-screen.a11y.test.ts`

**Interfaces — Produces:** `floor.reset_plan` becomes "Reset to {set} plan" / "Volver al plano
{set}"; `floor.reset_body` "Free tables go back now; occupied ones show Needs moving once free." /
"Las libres vuelven ya; las ocupadas quedan por mover al quedar libres."; new
`floor.zone_menu_heading` "Today's plan · {zone}" / "Plano de hoy · {zone}". The menu takes
`phone: boolean`, `view: "map" | "list"`, `canChangeToday: boolean` and emits
`zone-toggle-view`.

- [ ] **Step 1: Write the failing tests:** at 1280 wide the toolbar keeps List and ⋮, the menu has
  no heading and reads "Reset to Dinner plan"; the item is absent when `layoutSetName` is null; the
  question's second line is the new one; at 390 wide (`page.viewport(390, 844)`) the List button
  is gone, the ⋮ shows List first, then the muted heading "Today's plan · Inside", then the three
  items; on the list it shows Map; someone without `take-orders`, and a zone with no plan, get a ⋮
  holding only List or Map; axe clean at both widths in both themes.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement with `matchMedia(PHONE_WIDTH)` as `till-counter-screen.ts:250-262`.
  Reset to … plan sends Task 26's `floor-refresh` with `zones: true` after it settles, success or
  refusal, with a test: after a successful Reset to … plan that brings the edit the banner offered,
  the "A newer layout is ready." banner is gone without waiting for a tick.
- [ ] **Step 4:** Run the files and `till-floor-screen.test.ts`.
- [ ] **Step 5:** Commit.

### Task 29a: LOOK, dashboard (scripted)

Open the real thing and look; no product code unless a defect is found, which is then fixed
test-first in the owning task's files and said so.

- [ ] **Step 1:** Check `lsof +D <venue folder>` and `lsof -i :8080` for holders, then in the
  branch worktree `wa-wt reset demo <worktree-name>` and `wa-wt demo <worktree-name>` (never a
  bare `pnpm dev*`; `docs/developers/workflow-guide.md:192-235`).
- [ ] **Step 2:** Write the script `/Users/clintongormley/waitron-campaign-b/a504-shots/look-dashboard.mjs`
  (outside the repository), resolving Playwright from the worktree with
  `createRequire("<worktree>/apps/dashboard/package.json")("playwright")`. It signs in, then
  through the dashboard itself: adds a "Dinner" set to the Restaurant starting from Standard,
  opens its Inside layout, moves two tables, places the joined table if the seed has one, saves;
  sets the Dinner period's Floor plan to Dinner. It then captures, each in English and Spanish,
  light and dark, at 1280 and 390 wide, named `dash-<surface>-<lang>-<theme>-<width>.png`: the
  Floor plans page; its Add set dialog (first set of a department, and a later one); a set's row
  menu open; the Delete dialog; the period dialog with the field empty and chosen; the Periods
  window's column; the editor's title and line.
- [ ] **Step 3:** Run it with `node`; list each file written.
- [ ] **Step 4:** Compare with mock-ups 1 and 2 in `docs/backlog/mockups/a504-floor-plans/`; list
  every difference in the ledger and the PR description, each fixed or stated.

### Task 29b: LOOK, till (scripted)

- [ ] **Step 1:** On the same running stack, repaint today (through the dashboard, in the script)
  so Lunch ends two minutes from the run's start and Dinner follows; seat a party at one table
  that Dinner moves.
- [ ] **Step 2:** Write `/Users/clintongormley/waitron-campaign-b/a504-shots/look-till.mjs` the same
  way (resolving Playwright through `apps/till/package.json`). It waits for the banner (polling the
  page, bounded at three minutes), then captures, each in English and Spanish, light and dark, at
  1280 and 390 wide, named `till-<surface>-<lang>-<theme>-<width>.png`: the map with the banner;
  the list with the banner; after Update layout, the seated table still at its old place; after
  finishing its party, its "Needs moving" chip on the map and its card on the list, and the Mark
  moved question; the ⋮ menu open on the map and on the list (at 390 wide with List or Map first
  and the heading).
- [ ] **Step 3:** Run it with `node`; list each file written.
- [ ] **Step 4:** Compare with mock-ups 3 and 4; list every difference in the ledger and the PR
  description, each fixed or stated.

### Task 30: Docs and backlog; the Santet importer (local, not in the PR)

**Files:** `docs/backlog.md` (A504 at 91-92 and 2412-2418; A600 at 2349-2352),
`docs/backlog/till.md` (A600 at 377-…; A504 at 516-535), `docs/developers/conventions-data.md`
("A zone's floor plan: the master plan and today's plan", 1688-1838),
`docs/developers/conventions-ui.md` and `docs/developers/design-system.md` where a floor or form
rule changed, `CLAUDE.md` only if a new rule was paid for.

- [ ] **Step 1:** Delete the A504 and A600 entries from `docs/backlog.md` and their sections from
  `docs/backlog/till.md`. Each point left open becomes its own short entry in the same area with
  the next item number from `~/waitron-campaign-shared/next-item-number` (read, use, write back):
  at least bookings on a table the evening's set puts away (spec §11), Help mode explaining the
  banner and Needs moving (A582's entry gains a line), history of past layouts, and any LOOK
  difference left open.
- [ ] **Step 2:** Rewrite the conventions-data section to the new model: sets and layouts, the
  record on `floor_today_zones`, the waiting rules (needs clearing, joined groups), `ready_to_move`
  and Mark moved, the place check at every reset, when a joined table holds its tables (today's
  map) and when a table is a saved part (the recorded layout), and the incoming foreign keys of
  the rebuilt tables. Read every claim in the section across the whole base-to-tip range (CLAUDE.md §1, "A
  behaviour change retires every receipt").
- [ ] **Step 3:** `pnpm exec vitest run scripts/claude-md-pointers.test.ts`; commit with the code
  (this is not a docs-only change).
- [ ] **Step 4: The Santet importer — local, untracked, NOT in the pull request.**
  `local/square/import.mjs` in the `waitron-local-santet-data` worktree (excluded through
  `.git/info/exclude`, so git never sees it) saves each zone with
  `` put(`/zones/${created.id}/floor-plan`, …) `` (line 344), a route Task 9b removes. Change it to
  make a "Standard" set for each department it creates
  (`POST /venue-service/floor-plan-sets` with `departmentId` and `name`, no `fromSetId`), then save
  each zone with `PUT /floor-plan-sets/{setId}/zones/{zoneId}/floor-plan`, keeping its `ids`
  answer. Run `node --check` on it. Rebuilding the Santet venue with `local/square/reset.sh` is
  the landing step (owner answer 10(a)), not this task. Say in the ledger and the PR description
  that the importer was changed outside the repository.

---

## Self-review against the spec

- Decisions 1–4 → Tasks 4, 5, 7, 17. Decision 5 → 7 (`layoutOffer`), 26. Decision 6 → 18.
  Decisions 7, 9 → 12, 18. Decision 8 → 13. Decision 10 → 12, 13. Decision 11 → 14. Decision 12
  → 27. Decisions 13, 20 → 15, 16. Decision 14 → 18, 28. Decision 15 → 7. Decision 16 → 28.
  Decision 17 → 19, 24. Decision 18 → 11, 21. Decision 19 → 7. Decision 21 → 16. Decision 22 → 27.
- §5 page → 20–22; §6 field → 24; §4.2 shared tables and joined tables → 2, 6, 7b, 25b and plan
  decision 9; §7.3's joined rows → 7b, 12, 13, 16; §9 storage → 1, 3, 23; live reads and export →
  1, 3, 9b, 20, 24; §11 gaps → plan decisions 5–8 and 24–25; A600 → 15, 16, 30; the till's
  re-read after a press → 26, 28; LOOK → 29a, 29b.
