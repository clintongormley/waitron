# Floor plans — implementation plan (A429)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation.
>
> **Existing assertions.** A task may change an existing assertion only where it pins behaviour
> this plan removes (listed under "Behaviour this plan removes"), and only in a separate commit
> whose message begins `Changed test checks (A429 slice N):` and lists each `file:line` with its
> before and after. Any other assertion that turns out to need changing is a STOP: report it, do
> not edit it. Adding fixture rows, or a key to a whole-shape pin, is allowed.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer
> past about 150 calls with the task unfinished stops at a passing or cleanly red point,
> commits, and returns a handover: done, left, files, each check's state.
>
> **How the slices are written.** Slice 1 is written to step level below. Slices 2–5 are listed
> as tasks with their files, interfaces and tests; each is expanded to step level in this file,
> on that slice's own branch, after the slice before it lands, and the expansion gets one
> fresh-context review before dispatch. Their steps would otherwise be written against code
> slice 1 has not built yet. Slice 2 was expanded on 2026-10-10, after slice 1 landed (#1493),
> slice 3 on the same day, after slice 2 landed (#1506), slice 4 on the same day, after slice 3
> landed (#1517), and slice 5 on 2026-10-11, after slice 4 landed (#1526).
>
> **Revised 2026-10-08**, twice: after a fresh-context review against the spec and the code
> (which ran the behavioural trigger guard, drizzle-kit and the engine's foreign-key codes), and
> after the owner's answer that the master plan and today's plan are separate plans (decision 3).
> Slice 1's tasks 1.1, 1.2 and 1.8–1.16 were rewritten for the second revision, reviewed fresh
> (which ran the planner's rules as code, drizzle-kit and the foreign-key code), and revised again
> on its findings. Every `file:line` below was read at `main` `16b280dc0`,
> except `management-api.ts`, read at `25cd6d599`.

**Goal:** a zone's tables are laid out in a master floor plan edited freely on the dashboard; at
each day's reset the master is copied into today's plan, which the till shows and staff change
during service, as a map whose job is status and rearranging, with the details one tap away.

**Architecture:** two separate plans. The **master plan** is its own set of tables
(`floor_plans`, `floor_plan_tables`, `floor_plan_joins`), edited only by the dashboard and read
by nothing live. **Today's plan** is the live tables — `dining_tables`, which parties, orders and
bookings already point at — each with a row of today's state (`floor_today_tables`: position,
size, shape, seats, fixed, taken off) and today's merges (`floor_today_joins`). A reset copies the
master into today's plan: at the first floor read or write of a new business day (nothing runs at
the cutover itself) and on the Reset button. A table a party sits at waits, and catches up with
the master when its tab closes. A pure planner (`apps/server/src/floor-reset-plan.ts`) decides
what a reset does. Table names are copied as text when a party closes, and onto past orders and
bookings when a live table is removed, so a table the master no longer has can really go. The
dashboard gets a full-page editor; the till gets a new map primitive with pinch, pan and
long-press; today's changes are till routes gated like joining. The old placement columns,
routes, tabs and the till's layout-editor card go last.

**Tech stack:** TypeScript, drizzle on SQLite (`node:sqlite`), Hono, Lit, Vitest (node and real
Chromium browser projects).

**Spec:** [Floor plans](../specs/2026-10-08-floor-plan-design.md). Backlog: A429.

**Risk path:** FULL ceremony on every slice: migrations (slices 1, 4 and 5), a module-contract change
and a changed cross-package contract (the till's table-state answer, slice 1), and new till
routes behind profile and zone checks (slice 4).

## Decisions this plan makes that the spec does not

The owner confirms or overrides these when reviewing the plan.

1. **Today's-plan changes check what joining checks today: the device profile's `take-orders`
   action and the zone.** The spec (§6, §10, §13) also names "the person's ordering permission";
   there is no such permission (`PERMISSIONS`, `packages/identity/src/permissions.ts:5-37`), and
   seat, join, move and split check only the profile and the zone
   (`apps/server/src/till-api.ts:2250-2379`). The spec's "the same checks as joining today" is
   what this plan builds, and §13's "without the ordering permission" case is dropped.
2. **The old columns go in slice 5, not slice 1.** Dropping `pos_x`, `pos_y`, `shape`, `rotation`,
   `capacity` and `active` while the old floor screen and the till's layout editor still read them
   would break both for three slices. Slices 1–4 only ADD; slice 5 removes the old pieces and
   rebuilds `dining_tables` (`zone_id` required). Only slice 5 needs a venue reset. Until slice 5 a
   zone with no master plan works the old way.
3. **The master plan and today's plan are separate plans** (owner, 2026-10-08, replacing spec
   §6.3's "the owner's edits show through" and §9's "saved plan plus today's changes"). The master
   is edited freely and affects nothing live until a reset copies it into today's plan; everything
   live (parties, orders, bookings, the till's map) points only at today's tables. A reset happens
   at the first floor read or write of a new business day, and on Reset to saved plan. A table a
   party sits at keeps everything about today, a merge included, until its tab closes, then
   catches up. Each reset records what it copied, table by table (`floor_reset_tables`), and a
   table catches up to THAT record, so a master edit saved after the reset waits for the next one
   even when a party finishes in between.
4. **Delete is part of the editor's draft, covered by Undo.** Saving removes the master table. Its
   live table stays on today's plan until the next reset, or, if a party sits there then, until the
   party leaves; it is removed for good once nothing ties it — no open party holds it or used it
   earlier in its meal (the names are copied at close, so the row must last until then), and no
   order to it is unpaid or has food on its way. Its name is free on today's plan from then.
   **An upcoming booking assigned to the table refuses the delete** (`table.booked`; owner,
   2026-10-08: the booking is moved first). Bookings are otherwise later work.
5. **A counter order delivered to a table keeps its link until the table is removed**, not until
   it is issued. Removal then copies the table's name into a new
   `working_orders.delivery_table_label` and drops the link, and every reader of an order's table
   falls back to that copy (Task 1.5 lists them). Spec §8 says "when it is issued", but the
   floor's pending-delivery count, the watcher board, the expo queue, kitchen headers and overdue
   orders read the link after the bill is settled, until the food is collected
   (`apps/server/src/working-order.ts:7015-7024`, `:6652`; `watcher-board.ts:41-58`;
   `packages/reporting/src/overdue-orders.ts:57`); a delivery can be collected before it is paid,
   and the receipt's table name is frozen at payment from the link (`till-sale.ts:815`,
   `packages/db/src/party-table-labels.ts:82-114`); and an order with no kitchen items can never
   be marked collected (`working-order.ts:5836-5843`). The transition trigger gains one branch
   that allows exactly that release, on any status (Task 1.4).
6. **A party's table names are kept as a list** (`parties.table_names`, the `labelList` column
   builder, `packages/db/src/schema/columns.ts:169`), because the order list returns `tables:
   string[]` (`apps/server/src/orders-list.ts:360-365`). The party's `party_tables` rows are deleted
   in the same transaction that closes it.
7. **A past booking keeps its table's name when the live table is removed**: removal asks every
   enabled module, through a new module seat, to let go of the table (bookings copies the name into
   a new `bookings.table_label`); the same seat's refusal is what decision 4's booking rule uses.
8. **A name waits for its table.** Names are unique across the venue. A master name may not be one
   a live table outside every plan uses (the save refuses it). At a reset, a table whose new name
   a waiting live table still uses — in any zone — keeps its old name, and a new table is not yet
   created, until the name is free; a table being removed frees its name only once its removal has
   succeeded. Staff never add or rename tables on today's plan; they keep spares in reserve
   (owner, 2026-10-08).
9. **Plan coordinates are whole grid squares**, `x` and `y` naming the top-left corner of the
   unrotated table, which rotates about its centre: `x` and `y` 0–999, width and height 1–99,
   rotation 0–345 in steps of 15. A table cannot be dragged past the top or left edge; the grid
   grows only right and down. New tables are 8 × 8.
10. **The save check compares a revision number**, not the time of the save, because two saves in
    one millisecond would compare equal. `saved_at` stays, for display.
11. **A table's name hides when its drawn token's shorter side is under 28 CSS pixels** (the spec
    leaves the size to this plan).
12. **The editor opens from the Departments and zones screen**: "Edit floor plan" (or "Add a floor
    plan" for a zone with no tables) in the zone row's menu
    (`packages/venue-service/src/dashboard/venue-operations-screen.ts:1536-1574`). Lane D's A366-6
    rebuilds that screen into the department page and carries the action across. The plan's
    preview on the zone page arrives with A366-6, not here. (Amended 2026-10-10 at slice 2's
    expansion: A366-6A, #1488, landed first and left `venue-operations-screen.ts` an 11-line shell,
    and the departments spec keeps the zone's ⋮ menu to Rename, Move and Disable, so slice 2 puts an
    "Edit floor plan" link on the zone's panel beside its Opening hours link,
    `packages/venue-service/src/dashboard/department-zones.ts:390-404`, with no "Add a floor plan"
    variant: that and the preview are A366 Part C's; slice 2 decision 17.)
13. **The till's map still re-reads rather than being pushed to**: on tab select, after its own
    actions, as today (`apps/till/src/till-app.ts:4823`), and now also every 15 seconds while a
    map is showing, so two waiters see each other's moves. A push stream like the department
    transfers' (`apps/server/src/department-transfer-api.ts:65`) is later work. (Amended
    2026-10-10 at slice 3's expansion: the tab-select read is now `till-app.ts:4979`; the 15-second
    read is the floor screen's, only for a zone on the new map, slice 3 decision 13.)
14. **A join of fixed tables is a party join only**: it uses today's join route and leaves no
    merge, so the link ends when the party leaves (spec §6.1).
15. **The configuration export carries the master plan** (`floor_plans`, `floor_plan_tables`,
    `floor_plan_joins`, `floor_plan_join_tables`), not today's state.
16. **A zone's first master plan starts from its live tables, and its first save builds today's
    plan at once.** The editor opening a zone with no master offers the zone's current tables as
    the draft; saving links each to its live table and runs a reset for that zone. A table seated
    at that first reset gets its place on today's plan from the master at once, so the till can
    draw it, and keeps its current name until it is free.
17. **Until slice 5, a live table with no master table that was never in one is left alone by
    resets** — the old floor screen can still add tables to any zone, and a reset must not delete
    them overnight; the editor offers them for adoption. A live table whose master table was
    deleted is marked (`dining_tables.planned` stays true, `plan_table_id` goes null), so the reset
    knows to remove it. The old screen may no longer rename, rezone or switch on or off a planned
    table (`table.in_floor_plan`), or a reset would revert it or bring back a table it hid. Slice 5
    removes the old screen and the distinction.
18. **A merge with anyone seated at it waits as a whole** at a reset, every member included.
    Seating a party at a free merge seats it at every member (slice 4).
19. **Catching up happens at the next floor read or change**, not inside every path that frees a
    table: the till's table-state read and its seat, finish, move, join and split routes run the
    catch-up (and the day's reset) first. The till re-reads after its own actions and every 15
    seconds, and a delivery being paid or collected frees a table without any table route
    running.
20. **A merge's seats come from today's copy of the master's joins** (slice 4 decision 7, Tasks
    4.3e and 4.3f). Owner override, 2026-10-10, of the default slice 4's expansion wrote here, which
    read the master's saved join as it is now: each reset copies the master's saved joins into
    today's plan (`floor_reset_joins`, `floor_reset_join_tables`), and a join saved, changed or
    deleted in the editor mid-service waits for the next reset, as decision 3 has every other master
    edit wait.
21. **A fixed spare cannot be placed from the till** (added at slice 4's expansion, slice 4 decision
    11; the owner may override): a fixed table never moves on today's plan, so a spare stool is set
    out in the editor.
22. **Take off for today needs a free table** (added at slice 4's expansion, slice 4 decision 12;
    the owner may override): refused while a party sits there (the spec), while it needs clearing,
    while food is on its way to it, and while it is in a merge.

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`.
- Work in the slice's worktree (`python3 ~/workspace/tools/worktree.py new waitron <branch>
  --headless`); never commit to `main`.
- A shipped migration file is never edited. New migrations only. Slice 5's pull request's first
  line says **"venue reset needed"**.
- No data-migration code before go-live (CLAUDE.md §3).
- drizzle-kit 0.31.11: a generation that rebuilds a table must not also add a column to it.
  Slices 1–4 generate no rebuild: after each `db:generate`, `grep -l '__new_' <new files>` prints
  nothing.
- Every foreign key and unique index is declared in the TypeScript schema; no `ON DELETE cascade`
  on a key into `dining_tables` (slice 5's rebuild would empty the child, CLAUDE.md §3).
- Tables are core (`packages/db`), classified `state` with the `STATE` reason
  (`packages/db/src/classification.ts:6`). The commit adding them says why they are core: tables
  and zones are core, and the till's live floor reads them on every screen.
- Error codes name the domain concept; a code thrown in `apps/server` is declared in
  `apps/server/src/errors.ts`, given an HTTP status in each `STATUS` map that can surface it
  (`management-api.ts:251`, `till-api.ts:370`) and wording in English and Spanish in
  `apps/dashboard/src/i18n/codes.ts` (and the till's equivalent where the till shows it).
- `AppError` carries `code` and `params` (`packages/shared/src/errors.ts:57`). Rejected writes in
  tests assert the domain code.
- Multi-table writes take one `tx: Transaction`; queries on one transaction are awaited in turn.
- New UI reads `--wt-*` tokens only; a screen does not draw its own `<select>`, `<textarea>` or text
  `<input>`; forms follow `docs/developers/design-system.md` → Forms (Save quiet and disabled until
  the draft changes: `draftScopeFor`, `saveActionState`, an early return in the save handler); a
  page holding staged input has a `*.unsaved.test.ts`; a new `wt-*` primitive has a token-painting
  test and a sibling `*.a11y.test.ts` covering each state in both themes; `wt-*` events are named
  `wt-*`, carry `detail`, bubble and are composed.
- Strings in English and Spanish.
- Coverage stays at 98/98/98/95 in every package touched.
- Comments only for an invariant or a non-obvious why; no history.

## Behaviour this plan removes

Tests pinning these may change, under the commit rule above.

**Slice 1:**
- A closed party's `party_tables` rows surviving the close, and the order list reading closed
  parties' tables through them (`orders-list.ts:230`, `:243`, `:409-425`).
- A finished delivery order keeping `delivery_table_id` once its table is removed (it keeps the
  name instead).

**Slice 3** (added at its expansion):
> Owner override, 2026-10-10 (A472): Guests now has no placeholder. This supersedes the seats /
> "Covers" replacement recorded below.
- The seat dialog's hint "Optional. Leave it empty if you don't know yet." / "Opcional. Déjalo
  vacío si aún no lo sabes." (`seat.guest_count_hint`, `apps/till/src/i18n/strings.ts:546`, `:1679`),
  replaced by the table's seats or "Covers" (slice 3 decision 12). No test named it at `28f150197`
  (a grep of `apps/` and `packages/` for the key and both sentences found only `strings.ts` and
  `seat-dialog.ts:151`).

**Slice 4** (proposed at its expansion; not changed until the owner says yes to slice 4 decision 20 — the owner said yes on 2026-10-10):
- The editor's note "Your changes will go live tomorrow." / "Tus cambios se aplicarán mañana."
  (`floor_plan_editor.note`, `apps/dashboard/src/i18n/strings.ts:990`, `:3599`), pinned by
  `apps/dashboard/src/screens/floor-plan-editor.test.ts:133` and
  `apps/dashboard/src/screens/floor-plan-editor.save.test.ts:251`, gains "or sooner with Reset to
  saved plan on the till" (slice 2 decision 16).

**Slice 5:**
- The floor screen's Config tab, per-zone tabs and Disable/Enable, and
  `DELETE /management-api/tables/:id` switching a table off (`management-api.ts:1883`,
  `tables.ts:218`); the placement routes on the dashboard and the till (`management-api.ts:1895`,
  `:1931`; `till-api.ts:3079`, `:3120`); the till's `table-layout-editor` card
  (`apps/till/src/widgets/card-grid.ts:479-482`, `apps/till/src/layout.ts:104-106`,
  `packages/layouts/src/card-contract.ts:80-87`); `sizeForCapacity`, `FLOOR_ASPECT` and the
  permille placement (`packages/ui/src/floor.ts`); a table's `active` flag, `capacity` and every
  reader of them (listed in Tasks 5.2g and 5.2h). (Line numbers re-read at `main` `5afb32342`,
  2026-10-11.)

**Slice 5, added at its expansion (2026-10-11; proposed, slice 5 decision 22).** The entry above was
written before slices 1–4 landed. These are the existing tests a grep of `apps/`, `packages/` and
`scripts/` at `main` `5afb32342` found pinning something slice 5 removes that the entry above does
not name, or names only in general (found by reading, not by running). Each sub-task lists the
cases it changes; a case found while running that is on neither list is a STOP.
- **The Floor nav item and the `floor` screen** (slice 5 decision 1, an owner question):
  `apps/dashboard/src/dashboard-app.test.ts:322` (`NAV_SCREENS` holds `"floor"`), `:5934` (the
  Operations group's pages), `:6179` (a search for "venue" finds Floor plan);
  `apps/dashboard/src/dashboard-app.a11y.test.ts:433-447`; and the mechanism only it used,
  `itemsAmongModules`: `apps/dashboard/src/dashboard-app.module-order.test.ts:87-120`.
- **The old floor screen's create, rename, capacity, zone and placement writes**, beyond Disable,
  and the three codes they alone throw, `table.zone_inactive`, `table.in_floor_plan` and
  `placement.invalid` (slice 5 decision 5): `apps/server/src/management-api.test.ts`
  `describe("/management-api/tables")` `:794-1704` — the cases that test `POST`, `PATCH`, `DELETE`
  or a placement route are deleted; the refusal cases `:1641-1655`, `:1672-1692` and `:1694-1710`
  lose their write rows and keep their `GET` rows, which still assert 403 for a staff session and
  401 with none on `GET /management-api/tables`; the GET list case `:1092-1100` stays with a
  `switchOff` setup; setups that made a table with `POST /tables` (`tableInServiceZone`,
  `:1167-1189`; the occupied-zone case `:586-609`, at `:591`) use `createTable` — and
  `describe("/management-api/tables/:id/placement")` `:1741-1933`; `apps/server/src/tables.test.ts:132-148`,
  `:150-250`, `:252-329`, `:331-385`, `:691-797`; `apps/server/src/tables.location-scope.test.ts:68-119`;
  `apps/server/src/served-at-huella.test.ts:389-416` (placement is not part of the fiscal hash);
  `apps/server/src/till-api.test.ts:3717-4029`; `apps/server/src/till-api.tables.test.ts:233-262`
  (its row read selects `capacity` and `active`) and `:264-272` (`active: true` in the list);
  `apps/server/src/errors.test.ts:25-31`; `apps/dashboard/src/api/client.test.ts:1604-1746`;
  `apps/till/src/api/client.test.ts:2689-2746`; `apps/server/scripts/demo-seed/seed-floor.test.ts:144-194`
  (it reads `capacity`, `pos_x`, `pos_y` and `shape` off the live tables);
  `apps/server/src/till-api.profile-zones.test.ts:689-709` (the `ROUTES` rows that refuse the till's
  placement routes outside the profile's zones, and the map's rows `:104-105`).
- **`listTables`' old fields** (the entry above, made concrete): `apps/server/src/tables.test.ts:110-130`
  pins `capacity: 4`, `active: true` and `posX`, `posY`, `shape`, `rotation` null on a listed table;
  in Task 5.2k all those keys leave the matcher and `planTableId: null` joins it, and in Task 5.3 the
  `capacity: 4` argument to `createTable` goes. `apps/server/src/management-api.test.ts:1287-1327` and `:1328-1348`
  read `active` back through `listAll` (`active: state === "active"`, `active: true`): in Task 5.2h
  each instead asserts that the table is in the plain `GET /management-api/tables` list (the tables
  in service) exactly when its zone stays switched on. `:1092-1100` loses its `active: false` key in
  Task 5.2g, when `switchOff` stops writing `active` (the table still appears with `includeDisabled`
  and not in the plain list). `:1654`'s `toMatchObject({ active: true })` is deleted in Task 5.2k,
  when `active` leaves the answer (its `PATCH` row went in Task 5.2c).
- **The till's seat fallback** (the entry above): `apps/till/src/state/floor-map.test.ts:306`
  (`seatsFor(table({ capacity: 4 }))` is 4) expects `null` in Task 5.2m.
- **The card's permission lock** (slice 5 decision 12): `packages/layouts/src/card-contract.test.ts:22-24`;
  `apps/dashboard/src/screens/canvas-editor/card-contracts.parity.test.ts:80` (the
  `requiredPermission` line of the parity case `:73-86`, which goes with the field);
  `apps/till/src/layout.test.ts:38-41`; `apps/till/src/widgets/card-grid.test.ts:382-387` (its
  editor tab), the `canEdit` assertion in `:626-640`, `:674-712`;
  `apps/till/src/widgets/card-grid.a11y.test.ts:20-26` (its fixture), `:51-59`;
  `apps/till/src/till-app.test.ts` the `canEdit` assertion in `:6414-6432`, and `:6434-6476`;
  `apps/dashboard/src/screens/canvas-editor-screen.test.ts:594-601`;
  `apps/dashboard/src/screens/canvas-editor/card-preview.test.ts:31` (the card's row).
- **A zone with no master plan working the old way** (the plan's decision 2, "until slice 5"), on
  the till: every case, or the half of a case, that draws, taps or edits `wt-floor-canvas`, reads a
  token on it, or presses Edit plan — `apps/till/src/screens/till-floor-screen.test.ts:361-372`,
  `:541-547`, `:549-855`, `:929-941`; `till-floor-screen.map.test.ts:138-142`, `:247-278`;
  `till-floor-screen.a11y.test.ts` the map halves of `:323-367`, `:369-411` and `:413-467`, and
  `:564-583`; `till-floor-screen.refresh.test.ts` the old-capacity half of `:123-166` and the
  old-map half of `:189-203`; `till-floor-screen.signals.test.ts:119-132`;
  `till-floor-screen.parties.test.ts:140-153`, `:227-245`, the map halves of `:254-270`,
  `:278-284` and `:286-300`, `:352-427`, `:525-555`, `:660-675`;
  `apps/till/src/state/floor-map.test.ts:178-182` (`isPlannedZone`); on the server
  `apps/server/src/floor-today-state.test.ts:139-143`. The closed-zone matrix's map arm
  (`till-floor-screen.a11y.test.ts:586-630`) and the tray cases (`till-floor-screen.signals.test.ts:134-142`,
  `till-floor-screen.parties.test.ts:557-600`, `:677-684`, `till-floor-screen.a11y.test.ts:469-484`)
  keep their assertions; only their fixtures move to today's rows.
- **The no-zone tab** (slice 5 decision 13): `apps/till/src/screens/till-floor-screen.test.ts:467-517`,
  `:880-899`; `till-floor-screen.map.test.ts:290-293`; `packages/ui/src/floor.test.ts:95-139`,
  `:153-160`, `:170-173`.
- **A table in no zone** (slice 5 decision 24), deleted in Task 5.2d because such a table cannot
  exist once `zone_id` is required: `apps/server/src/floor-plan.test.ts:392-409` (a name a table
  with no zone holds); `apps/server/src/till-api.zone-required.test.ts:257-269`, `:270-282`,
  `:283-297` (a tab at a table in no zone; their table is the zoneless one made at `:134`);
  `apps/server/src/party-move-bill.test.ts:337-352`, `:798-811`, `:1054-1068`, `:1112-1123`,
  `:1125-1136` (a bill moved to, or paid at, a table with no zone; the last two through the helper
  `partyBillInTicketZone`, `:1073-1110`, whose table at `:1099` has no zone);
  `apps/server/src/floor-today-merges.test.ts:164-180`, `:182-217` (a merge refusing a table with no
  zone); `apps/server/src/made-here.routes.test.ts:1675-1687`, `:1689-1707` (a zone-less party's
  unsent drink, through `bareParty()`, `:235-246`, whose table gets a zone for its other users,
  `:1710`, `:1776`); and the half of `apps/server/src/watch-zones.test.ts:126-170` at `:164-169`
  that sets a delivery table's zone to null.
- **`planned` and adoption** (the plan's decisions 16 and 17, slice 2 decision 20; slice 5
  decision 6): `apps/server/src/floor-plan.test.ts:218-281`, `:306-325`, `:339-350`, `:425-453`,
  the `liveTableId` arm of `:495-510`, `:587-619`, `:652-668`, `:870-889` (its `planned` and
  `active` keys), the `planned` keys of `:1119-1135` and `:1136-1154`, and `:1155-1185` (its
  setup writes `planned`); `apps/server/src/management-api.test.ts:3782-3817` (keeps checking that a
  plan read is accepted back unchanged, without the adopted spare it made with `POST /tables`; its
  `[true, true]` row for that spare goes), `:3819-3838` (a save naming another table's live table as
  `liveTableId`, deleted: a save no longer reads the field) and the `tables.0.liveTableId` row
  `:3863-3866` of the body checks `:3853-3881`; `apps/server/src/floor-reset-plan.test.ts:210-225`;
  `apps/server/src/floor-today-store.test.ts:495-510`, `:720-737`;
  `apps/server/src/table-removal.test.ts:96-99` (setup); the `planned` keys of
  `packages/db/src/schema/floor-plans.test.ts:357` onwards (`:368`, `:419`, `:427`);
  `apps/dashboard/src/screens/floor-plan-draft.test.ts:51-73`, `:345-352`;
  `apps/dashboard/src/screens/floor-plan-table-panel.test.ts:278-287`.
- **Zone switch-off switching tables off, and switching back on bringing them back** (slice 5
  decision 4): `packages/venue-service/src/operations.test.ts` the table halves of `:1622-1673`
  and `:1675` onwards (`:1661-1666`, `:1733-1738`), and of `:2116-2165` (`:2146-2152`);
  `apps/server/src/tables.test.ts:549-572`; `apps/server/src/management-api.test.ts:1350-1366` (renamed in
  its changed-test commit: its name, "…without enabling its tables", contradicts its new assertion),
  and `:1287-1327`, `:1328-1348`, above;
  `apps/server/src/floor-today-store.test.ts:754-797`; `apps/server/src/floor-today-api.test.ts:219-231`.
- **`active` read back as a column** (the entry above, made concrete): the `active` key beside a
  today's-row assertion in `apps/server/src/floor-today-store.test.ts:308`, `:315`, `:341`, `:394`
  (and that case's setup, `:384-395`), `:705`; `apps/server/src/table-removal.test.ts:296`, `:339`,
  `:398`; `packages/db/src/schema/dining-tables.test.ts:49-59` (the placement columns).
- **The tray token's shape and seat words** (slice 5 decision 11):
  `packages/ui/src/components/wt-table-token.test.ts:368-381` (`capacity` becomes `seats`),
  `:390-406` (shapes); `packages/ui/src/components/wt-table-token.a11y.test.ts:63-66` (its
  fixture); the whole of `packages/ui/src/components/wt-floor-canvas.test.ts` and
  `wt-floor-canvas.a11y.test.ts`; `packages/ui/src/floor.test.ts:17-57`, `:79-93` (the permille
  helpers; `:41-44` keeps its `ROTATION_STEP` half), `:175-204` and `:268-286` (`toFloorTable`'s
  placement half).

## Review focus

The five conditions most likely to bite a person that no single task's happy path exercises. Each
has its test in the task named.

1. **A table still seated at the cutover.** At 07:00, after a 06:00 cutover, a table seated last
   night that a waiter moved keeps its moved place, its merge and its name while the party sits
   there; every free table is back to the master; when the tab closes the table catches up
   (Tasks 1.8 and 1.12).
2. **A table deleted from the master while a party sits at it.** It stays on today's plan through
   the next reset, can take no new party once its master is gone and the reset has run, and goes —
   its name free, its history kept on the party, the delivered order and the booking — when the
   party leaves (Tasks 1.3–1.6, 1.9, 1.12).
3. **A name moving between tables.** The master renames "Terrace 4" to "Terrace 9" and adds a new
   "Terrace 4" while the old one is occupied at the reset: the new one appears when the old one is
   free, and nothing is refused (Tasks 1.2 and 1.12).
4. **A master edit saved mid-service.** The owner renames, moves, adds and deletes tables while a
   party is seated elsewhere in the zone; the party finishes; nothing on the till changes until
   the next reset (Task 1.8), a saved join's seats included (Task 4.3f).
5. **A fixed table sent a move anyway.** A move request for a fixed table, sent straight to the
   route, is refused and nothing moves (Task 4.3d).

## File map

| File | Slice | Responsibility |
| --- | --- | --- |
| `packages/db/src/schema/floor-plans.ts` | 1, 4 | the master plan's and today's tables; today's copy of the master's joins (4) |
| `packages/db/drizzle/01xx_*.sql` | 1, 4, 5 | generated and custom migrations |
| `apps/server/src/floor-reset-plan.ts` | 1 | the pure reset planner |
| `apps/server/src/floor-today-store.ts` | 1, 4 | building today's plan from the master (1), today's writes (4) |
| `apps/server/src/floor-plan.ts` | 1 | read, check and save a zone's master plan |
| `apps/server/src/table-removal.ts` | 1 | removing a live table the master no longer has |
| `packages/module/src/module.ts` | 1 | the `tableRemoval` seat |
| `packages/bookings/src/table-removal.ts` | 1 | bookings' part in a removal |
| `packages/ui/src/floor-plan-geometry.ts` | 2 | grid, crop, fit, automatic names |
| `packages/ui/src/history.ts` | 2 | undo/redo over draft snapshots (moved from `packages/ui-core` at slice 2's expansion, slice 2 decision 11) |
| `packages/ui/src/components/wt-floor-plan-canvas.ts` | 2 | the editor's canvas |
| `packages/ui/src/components/wt-sheet.ts` | 2 | a sheet docked at the bottom of a narrow screen |
| `apps/dashboard/src/screens/floor-plan-draft.ts` | 2 | the editor's draft: what it sends, when it changed, each edit |
| `apps/dashboard/src/screens/floor-plan-editor.ts` | 2 | the full-page editor |
| `apps/dashboard/src/screens/floor-plan-tables-panel.ts` | 2 | the tables list and Add tables |
| `apps/dashboard/src/screens/floor-plan-table-panel.ts` | 2 | the selected table's panel |
| `packages/ui/src/gestures.ts` | 3 | tap, double-tap, long-press, drag, pinch |
| `packages/ui-core/src/tokens/colors.css` | 3 | the table fill colours (added at slice 3's expansion) |
| `packages/ui/src/floor-map-fills.ts` | 3 | the map's fill and dot names and their style sheet (added at slice 3's expansion) |
| `packages/ui/src/components/wt-floor-map.ts` | 3 | the till's map |
| `apps/till/src/state/floor-map.ts` | 3 | the stand-in statuses and which tables a planned zone shows (added at slice 3's expansion) |
| `apps/till/src/widgets/table-details-sheet.ts` | 3, 4 | the long-press details sheet |
| `apps/till/src/widgets/table-status.ts` | 3 | the order screen's flash notice and status pin (added at slice 3's expansion) |
| `apps/server/src/floor-today-api.ts` | 4 | the till's today's-plan routes |
| `apps/server/src/floor-today-merges.ts` | 1, 4 | leaving merges (1); writing, growing and splitting them (4, added at slice 4's expansion) |
| `packages/shared/src/floor-join.ts` | 4 | which side a joined table touches, and where it goes (added at slice 4's expansion) |
| `apps/server/src/testing/floor-today-venue.ts` | 4 | a planned zone for the server's today's-plan tests (added at slice 4's expansion) |
| `apps/till/src/state/floor-today.ts` | 4 | what a drop does, spares, taken-off tables, the sheet's actions (added at slice 4's expansion) |
| `apps/till/src/widgets/today-seats-dialog.ts` | 4 | a merge's seats and Change seats (added at slice 4's expansion) |
| `apps/till/src/widgets/join-with-dialog.ts` | 4 | Join with… (added at slice 4's expansion) |
| `apps/till/src/widgets/floor-zone-menu.ts` | 4 | the zone menu: spares, taken off, reset (added at slice 4's expansion) |
| `packages/db/src/table-in-service.ts` | 5 | whether a live table is on today's plan in a switched-on zone (added at slice 5's expansion) |
| `apps/server/src/testing/live-table.ts` | 5 | a live table for tests, with its today's row (added at slice 5's expansion) |

---

## Slice 1 — storage and reads

Branch `feat/floor-plan-storage`. Lands on its own: the till and dashboard look the same after it
(the order list reads copied names, and the old screen refuses to rename a planned table); zones
get master plans and today's plans from the seed, and the server answers the master plan's routes
and today's state.

### Task 1.1: The master plan's tables, today's tables, and the new columns

**Files:**
- Create: `packages/db/src/schema/floor-plans.ts`, `packages/db/src/schema/floor-plans.test.ts`
- Modify: `packages/db/src/schema/index.ts` and `packages/db/src/index.ts` (exports, beside
  `dining-tables`), `packages/db/src/schema/dining-tables.ts` (`plan_table_id`, `planned`),
  `packages/db/src/schema/parties.ts` (`table_names`), `packages/db/src/classification.ts` (nine
  `classify` rows after `dining_tables`, `:92`), `packages/db/src/configuration-transfer.ts` (the
  four master-plan tables after `dining_tables`, `:36-40`), `scripts/schema-constraints.test.ts`
  (the new keys and unique indexes, as the file lists `dining_tables`' at `:115-117`)
- Generated: one new core migration under `packages/db/drizzle/` with its snapshot and journal entry

**Interfaces:**
- Produces (all exported from `@waitron/db`):

```ts
export const floorPlanShape = enumType(["rect", "round"]);
// The master plan — edited by the dashboard only.
export const floorPlans;          // floor_plans: id, zone_id (unique, FK floor_zones), revision count not null default 0, saved_at ts not null
export const floorPlanTables;     // floor_plan_tables: id, plan_id (FK), label not null, seats count (nullable), fixed flag not null default false, x, y, width, height, shape, rotation (nullable; all null = a spare); unique (plan_id, label)
export const floorPlanJoins;      // floor_plan_joins: id, plan_id (FK), seats count not null
export const floorPlanJoinTables; // floor_plan_join_tables: id, join_id (FK), plan_table_id (FK floor_plan_tables); unique (join_id, plan_table_id)
// What the zone's last reset copied (decision 3): one row per planned live table, plus one per table it is to create.
export const floorResetTables;    // floor_reset_tables: id, zone_id (FK floor_zones), table_id (FK dining_tables, nullable: a table to create), label not null, seats count (nullable), fixed flag not null default false, the six placement columns (nullable), remove flag not null default false, pending flag not null default false; unique (table_id)
// Today's plan — the live tables' state for the day.
export const floorTodayZones;     // floor_today_zones: id, zone_id (unique, FK floor_zones), business_day day not null, generation count not null default 0
export const floorTodayTables;    // floor_today_tables: id, table_id (unique, FK dining_tables), seats count (nullable), fixed flag not null default false, the six placement columns (nullable; all null = an unplaced spare), taken_off flag not null default false
export const floorTodayJoins;     // floor_today_joins: id, zone_id (FK floor_zones), seats count not null
export const floorTodayJoinTables;// floor_today_join_tables: id, join_id (FK), table_id (unique, FK dining_tables), before_x, before_y, before_rotation not null
// dining_tables.plan_table_id: id (nullable), FK floor_plan_tables — the master table this live table follows
// dining_tables.planned: flag not null default false — true once the table has followed a master table (decision 17)
// parties.table_names: labelList (nullable)
```

As built, `floor_reset_tables` also has `plan_table_id` (nullable, a plain no-action foreign key to
`floor_plan_tables`: the master table the target was copied from; `saveZonePlan` sets it null before
deleting a master table) and `placed` (flag not null default false: today's row has been set from
the target, so a later catch-up only retries its name). Migration 0130 adds indexes on
`floor_reset_tables (zone_id, pending)` and `floor_today_joins (zone_id)` (amended 2026-10-10, as
built in slice 1).

`dining-tables.ts` and `floor-plans.ts` reference each other: declare `plan_table_id`'s key with
a lazy column, as `parties.ts` does for `main_bill_id` (`(): AnySQLiteColumn => floorPlanTables.id`).

Checks, each named `<table>_<what>_ck`: `x` and `y` between 0 and 999; `width` and `height`
between 1 and 99; `rotation` between 0 and 345 and `rotation % 15 = 0` (and `before_rotation`);
`shape` by `enumCheck`; on `floor_plan_tables`, `floor_reset_tables` and `floor_today_tables` the
six placement columns all null or all set; `seats` null or between 0 and 999 on tables, and `>= 1`
on both join tables.

- [ ] **Step 1: Write the failing tests.** In `floor-plans.test.ts`, set up as
`dining-tables.test.ts:13-30` does (`useVenueDb({ migrations: [CORE_MIGRATIONS] })`, a tenant, a
location), plus one zone, a plan and two live tables. Each refusal is caught outside the
transaction (CLAUDE.md §3) and asserted the way the sibling schema tests assert a check, with their
`checkFailed` helper (`packages/db/src/schema/bill-payments.test.ts:321-325`); the `toThrow` lines
below show intent.

```ts
it.each([
  ["rotation 20", { rotation: 20 }, "floor_plan_tables_rotation_ck"],
  ["rotation 360", { rotation: 360 }, "floor_plan_tables_rotation_ck"],
  ["x -1", { x: -1 }, "floor_plan_tables_x_ck"],
  ["width 0", { width: 0 }, "floor_plan_tables_width_ck"],
  ["shape square", { shape: "square" }, "floor_plan_tables_shape_ck"],
  ["a position without a size", { width: null }, "floor_plan_tables_placement_ck"],
])("refuses a master table with %s", async (_name, patch, constraint) => {
  await expect(insertMasterTable({ ...GOOD_MASTER_TABLE, ...patch })).rejects.toThrow(constraint);
});
it("accepts a master spare with no position at all", async () => { /* all six null */ });
it("keeps names unique within a plan", async () => { /* second "T1" on the plan refused */ });
it("keeps one plan, and one today's row, per zone", async () => { /* … */ });
it("keeps one today's row and one reset row per live table, and a table in one merge at a time", async () => { /* … */ });
it("round-trips a plan, reset rows, today's rows and the new columns", async () => {
  /* incl. a reset row with table_id null; dining_tables.planned default false, plan_table_id,
     parties.table_names ['T1','T2'] */
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/db exec vitest run src/schema/floor-plans.test.ts`. Expected: cannot import `./floor-plans.js`.
- [ ] **Step 3: Implement** the schema with the column vocabulary from `./columns.js` only
(CLAUDE.md §3), export it, add the columns, the nine `classify(..., "state", STATE)` rows and the
four transfer entries. Generate: `pnpm --filter @waitron/db db:generate`. Read the SQL: nine
`CREATE TABLE`s, three `ALTER TABLE … ADD` (the review's run of the earlier draft produced
`ADD plan_table_id text REFERENCES floor_plan_tables(id)` and no rebuild), the indexes, and no
`__new_`.
- [ ] **Step 4: Run the tests and the guards** —
`pnpm --filter @waitron/db exec vitest run src/schema/floor-plans.test.ts` and
`pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/migrations-match-schema.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/migration-upgrade.test.ts scripts/behavioural-triggers.test.ts`. Expected: all pass; read each `Tests` count.
- [ ] **Step 5: Commit** — message states why the tables are core (Global constraints).

### Task 1.2: The reset planner

**Files:**
- Create: `apps/server/src/floor-reset-plan.ts`, `apps/server/src/floor-reset-plan.test.ts`

**Interfaces:**
- Produces:

```ts
export type PlanShape = "rect" | "round";
export interface Placement { x: number; y: number; width: number; height: number; shape: PlanShape; rotation: number }
/** What a reset copies for one table: the master's values, or that the table goes. */
export interface Target { tableId: string | null; label: string; seats: number | null; fixed: boolean; placement: Placement | null; remove: boolean }
export interface LiveTable {
  id: string;
  label: string;
  held: boolean;        // an open party sits there now
  tied: boolean;        // held, or used earlier by a party still open, or an order to it unpaid or with food on its way
  hasToday: boolean;    // it has a today's row
  mergedWithHeld: boolean; // it is in a today's merge with a held table
}
export interface ResetPlan {
  apply: { target: Target; label: string | null }[];  // label null: keep the current name, the target's is still in use
  seed: Target[];       // held tables with no today's row: today's row from the target, name kept; the target stays pending
  create: Target[];     // tables to create, whose names are free
  remove: string[];     // to remove for good (Task 1.9)
  hide: string[];       // to take off today's plan, tied, removed once free
  pending: Target[];    // still to do at a later catch-up: waiting tables, names in use, creates not made, tied removals
}
export function planReset(input: { targets: readonly Target[]; live: readonly LiveTable[]; takenElsewhere: ReadonlySet<string> }): ResetPlan;
export function targetsFromMaster(master: readonly { id: string; label: string; seats: number | null; fixed: boolean; placement: Placement | null }[], live: readonly { id: string; planTableId: string | null; planned: boolean }[]): Target[];
```

`targetsFromMaster` (the reset's targets): one per planned live table — its master table's values,
or `remove: true` when its `planTableId` is null or names no master table; none for a live table
not `planned` (decision 17); one with `tableId: null` per master table no live table follows.

`planReset`, rules, for one zone:
- A target whose table is `held`, or `mergedWithHeld`, waits: it is in `pending`. A held table
  with no today's row also goes in `seed` (decision 16).
- A `remove` target whose table is not `tied` goes in `remove`; if tied but not held, in `hide`
  and `pending`.
- Every other target with a `tableId` goes in `apply`; with no `tableId`, in `create`.
- **Names.** A name is in use when a live table keeps it after this plan: a waiting table, a
  table in `remove` or `hide` (a removal frees its name only once it has succeeded, so its name is
  free at the next pass), an `apply` that keeps its current name, and every name in
  `takenElsewhere` (the venue's live tables outside the zone). Start with every `apply` taking its
  target's name and every `create` made; then, repeatedly, an `apply` whose target name is in use
  or taken by another entry keeps its current name (`label: null`, and its target also goes in
  `pending`), and such a `create` is dropped to `pending`; when two entries want one free name,
  the one listed first in `targets` keeps it. Stop when a pass changes nothing; it ends, because an
  entry only ever moves from "new name" to "keeps its name" or "not created".

- [ ] **Step 1: Write the failing tests:**

```ts
const t = (tableId: string | null, label: string, over: Partial<Target> = {}): Target => ({ tableId, label, seats: 4, fixed: false, placement: { x: 0, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 }, remove: false, ...over });
const l = (id: string, label: string, over: Partial<LiveTable> = {}): LiveTable => ({ id, label, held: false, tied: false, hasToday: true, mergedWithHeld: false, ...over });
const none = new Set<string>();
const sorted = <T>(xs: T[]) => [...xs].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

it("copies the target onto every free table", () => {
  expect(planReset({ targets: [t("a", "T1")], live: [l("a", "T1")], takenElsewhere: none }).apply).toEqual([{ target: t("a", "T1"), label: "T1" }]);
});
it("leaves a seated table, and the free table merged with it, pending", () => {
  const plan = planReset({ targets: [t("a", "T1"), t("b", "T2")], live: [l("a", "T1", { held: true, tied: true }), l("b", "T2", { mergedWithHeld: true })], takenElsewhere: none });
  expect(plan.apply).toEqual([]);
  expect(plan.pending.map((x) => x.tableId)).toEqual(["a", "b"]);
});
it("seeds a seated table that has no today's row, keeping its name", () => {
  const plan = planReset({ targets: [t("a", "Patio 1")], live: [l("a", "T1", { held: true, tied: true, hasToday: false })], takenElsewhere: none });
  expect(plan.seed).toEqual([t("a", "Patio 1")]);
  expect(plan.pending).toEqual([t("a", "Patio 1")]);
});
it("creates a table the target adds", () => {
  expect(planReset({ targets: [t(null, "T2")], live: [], takenElsewhere: none }).create).toEqual([t(null, "T2")]);
});
it("removes a free table, and hides one still tied", () => {
  const plan = planReset({ targets: [t("a", "T1", { remove: true }), t("b", "T2", { remove: true })], live: [l("a", "T1"), l("b", "T2", { tied: true })], takenElsewhere: none });
  expect(plan).toMatchObject({ remove: ["a"], hide: ["b"] });
});
it("swaps two names in one plan", () => {
  const plan = planReset({ targets: [t("a", "T2"), t("b", "T1")], live: [l("a", "T1"), l("b", "T2")], takenElsewhere: none });
  expect(plan.apply.map((x) => x.label)).toEqual(["T2", "T1"]);
});
it("makes a new table wait for a name a seated table still uses", () => {
  const plan = planReset({ targets: [t("a", "Terrace 9"), t(null, "Terrace 4")], live: [l("a", "Terrace 4", { held: true, tied: true })], takenElsewhere: none });
  expect(plan.create).toEqual([]);
  expect(plan.pending.map((x) => x.label)).toEqual(["Terrace 9", "Terrace 4"]);
});
it("does not hand a removed table's name on in the same pass", () => {
  const plan = planReset({ targets: [t("a", "T1", { remove: true }), t("b", "T1"), t(null, "T3"), t("c", "T3", { remove: true })], live: [l("a", "T1"), l("b", "T2"), l("c", "T3")], takenElsewhere: none });
  expect(plan.remove).toEqual(["a", "c"]);
  expect(plan.apply).toEqual([{ target: t("b", "T1"), label: null }]);
  expect(plan.create).toEqual([]);
});
it("never gives two tables one name", () => {
  // b is seated as T2, so a keeps T1; c may not then take T1
  const plan = planReset({ targets: [t("a", "T2"), t("b", "T3"), t("c", "T1")], live: [l("a", "T1"), l("b", "T2", { held: true, tied: true }), l("c", "T4")], takenElsewhere: none });
  expect(sorted(plan.apply.map((x) => [x.target.tableId, x.label]))).toEqual(sorted([["a", null], ["c", null]]));
});
it("treats a name used in another zone as in use", () => {
  expect(planReset({ targets: [t(null, "Bar 1")], live: [], takenElsewhere: new Set(["Bar 1"]) }).create).toEqual([]);
});
it("builds targets from the master, leaving out a table the master never had", () => {
  const master = [{ id: "m1", label: "T1", seats: 4, fixed: false, placement: null }, { id: "m2", label: "T2", seats: 2, fixed: false, placement: null }];
  const live = [{ id: "a", planTableId: "m1", planned: true }, { id: "b", planTableId: null, planned: true }, { id: "c", planTableId: null, planned: false }];
  expect(targetsFromMaster(master, live).map((x) => [x.tableId, x.label, x.remove])).toEqual([["a", "T1", false], ["b", expect.any(String), true], [null, "T2", false]]);
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/floor-reset-plan.test.ts`. Expected: cannot import `./floor-reset-plan.js`.
- [ ] **Step 3: Implement.** No database access in this file. A `remove` target carries the live
table's current label.
- [ ] **Step 4: Run** the same command. Expected: PASS, 11 tests.
- [ ] **Step 5: Commit.**

### Task 1.3: A party keeps its table names when it closes

**Files:**
- Modify: `apps/server/src/parties.ts` (`closeParty`, `:605-639`), `apps/server/src/table-actions.ts`
  (`combineParties`, `:164-236`), `apps/server/src/orders-list.ts` (`:228-231` search, `:241-244`
  table filter, `:409-425` `readPartyTables`)
- Test: `apps/server/src/party-table-names.test.ts` (new), plus the existing
  `apps/server/src/orders-list.test.ts` cases for tables (run, not edited)
- Existing assertions this empties: `apps/server/src/parties.test.ts:479`, `:1030`, `:1049` and
  `:1396` assert `membershipsOf(…).every((m) => m.leftAt !== null)`, which an empty list passes.
  In the `Changed test checks` commit each becomes: the party has no `party_tables` rows, and its
  `tableNames` is the expected list.

**Interfaces:**
- Produces: `export async function closePartyTables(tx: Transaction, partyId: string): Promise<void>`
  in `parties.ts` — writes the labels of every table the party ever held (`party_tables` joined to
  `dining_tables`, ordered by `joined_at`, `id`; each label once) into `parties.table_names`, then
  deletes the party's `party_tables` rows. Called by `closeParty` after `leaveForClearing` (the
  `parties_clear_table_status` trigger reads the rows when the state changes, so they must still
  exist then) and by `combineParties` for the closed `from` party after its rows are left.

- [ ] **Step 1: Write the failing tests** (set up as `party-table-actions.test.ts` does:
`useVenueDb` + `setupPartyVenue`; helpers `seat`, `join`, `inTx`, `partyRow` from
`./testing/party-venue.js`):

```ts
it("copies the names of every table the party held, in order, and lets go of the tables", async () => {
  const t4 = await v.table("Terrace 4"), t5 = await v.table("Terrace 5");
  const { partyId } = await seat(v, t4);
  await join(v, partyId, t5);
  await finish(v, partyId); // finishTable through inTx, as till-api's route does
  expect((await partyRow(v, partyId)).tableNames).toEqual(["Terrace 4", "Terrace 5"]);
  expect(await inTx(v, (tx) => tx.select().from(partyTables).where(eq(partyTables.partyId, partyId)))).toEqual([]);
});
it("keeps the old name on the closed party and its reprinted receipt after the table is renamed", async () => {
  /* seat, order, pay and issue, finish, then updateTable(label "Patio 4"); partyRow.tableNames
     still ["Terrace 4"]; listOrders' row for the party's bill has tables ["Terrace 4"];
     readReceiptOrder (receipt-order.ts) for the bill still names "Terrace 4" */
});
it("copies the names of a party merged into another when the merge closes it", async () => {
  /* seat A at t1 and B at t2, joinTables(A, t2, {bills:"separate"}) — B closes into A;
     partyRow(B).tableNames equals ["T2"] and B has no party_tables rows */
});
it("finds a closed party in the order list by an old table name and filters by it", async () => {
  /* listOrders with search "Terrace" and with table "Terrace 4" both return the closed party's bill */
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/party-table-names.test.ts`. Expected: `tableNames` is `null`.
- [ ] **Step 3: Implement** `closePartyTables`; call it from both paths. In `orders-list.ts`, read
a closed party's tables from `parties.table_names` and an open party's from `party_tables` as now;
the search and table-filter clauses also match `exists (select 1 from json_each(p.table_names)
where value like … )` (and `= … collate nocase`) — add the `parties` join to the row query if
`r` does not carry `table_names` yet.
- [ ] **Step 4: Run** the new file, then `pnpm --filter @waitron/server exec vitest run src/orders-list.test.ts src/party-table-actions.test.ts src/till-api.table-actions.test.ts src/unpaid-departure.test.ts`. Expected: all pass.
- [ ] **Step 5: Commit.**

### Task 1.4: An order delivered to a table can let go of it, keeping its name

**Files:**
- Modify: `packages/db/src/schema/orders.ts` (`deliveryTableLabel: label("delivery_table_label")`
  beside `deliveryTableId`, `:88`)
- Generated: a core migration adding the column (`pnpm --filter @waitron/db db:generate`; one
  `ALTER TABLE … ADD`, no `__new_`), THEN a custom one
  (`pnpm --filter @waitron/db db:generate:custom --name delivery_table_release`) that drops and
  re-creates `working_orders_enforce_transition` as `0117_bill_invoice_delivery_transition.sql`
  has it, with exactly these changes:
  - the presented-bill branch (`0117:17-37`) and the two collection branches (`0117:38-59`,
    `:60-81`) each also require `new.delivery_table_label IS old.delivery_table_label`;
  - one new branch, the release: `old.delivery_table_id IS NOT NULL AND new.delivery_table_id IS
    NULL AND old.delivery_table_label IS NULL AND new.delivery_table_label IS NOT NULL AND` every
    other column of `working_orders` `IS old` (any status). Take the column list from the schema;
    `scripts/behavioural-triggers.test.ts:793` builds the same list for its own checks.
- Create: `apps/server/src/delivery-release.ts`, `apps/server/src/delivery-release.test.ts`
- Run: `scripts/behavioural-triggers.test.ts`, `packages/db/src/schema/orders.transition.test.ts`

**Interfaces:**
- Produces: `export async function releaseDeliveries(tx: Transaction, tableId: string, label: string): Promise<void>`
  — one update: every `working_orders` row with `delivery_table_id` = the table gets
  `delivery_table_id = null, delivery_table_label = label`. It decides nothing; `removeLiveTables` (Task 1.9) calls it
  only for a table nothing ties any more, so no live order is ever released.

- [ ] **Step 0: STOP check.** Spec §8 stops the work if a table involved is append-only. Run
`git grep -n "appendOnly(" -- 'packages/*/src/*classification*.ts'` and confirm `working_orders`,
`parties`, `party_tables`, `dining_tables` and `bookings` are not among them (they are `state`:
`packages/db/src/classification.ts:92`, `:119`, `:146-151`; `packages/bookings/src/classification.ts:10`).
If any is, stop and report.
- [ ] **Step 1: Write the failing tests.** Make delivered orders through the walk-up sale path
that sets `delivery_table_id` (`createOpenOrder`, called from `till-sale.ts:540`; `counterOrder`
in `testing/party-venue.ts:398` goes through `parkOrder`, which takes no table — extend the helper
with an optional table, or add a sibling, whichever reads better):

```ts
it("lets go of the table on a settled, collected order and keeps its name", async () => {
  /* deliver to "Terrace 4", settle, handOverOrder; releaseDeliveries(t4, "Terrace 4");
     billRow: deliveryTableId null, deliveryTableLabel "Terrace 4" */
});
it("lets go of the table on a settled order never collected, and on an abandoned one", async () => { /* … */ });
it.each([
  ["the name alone", { delivery_table_label: "X" }],
  ["the link without a name", { delivery_table_id: null }],
  ["the release with another column", { delivery_table_id: null, delivery_table_label: "X", order_number: 99 }],
])("refuses %s on a settled order", async (_name, set) => {
  /* raw update, caught OUTSIDE withTransaction; message 'working order cannot make that transition' */
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/delivery-release.test.ts`. Expected: cannot import `./delivery-release.js`.
- [ ] **Step 3: Implement** both migrations and the helper. Diff the custom migration's trigger
against `0117` by eye: only the three added `IS` clauses and the new branch.
- [ ] **Step 4: Run** the file; `pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/migration-upgrade.test.ts scripts/migrations-match-schema.test.ts`; `pnpm --filter @waitron/db exec vitest run src/schema/orders.transition.test.ts`. Expected: all pass (the review measured the behavioural guard at 2 failures with the column and no trigger change; this task's trigger change is what makes it pass).
- [ ] **Step 5: Commit.**

### Task 1.5: Everything that reads an order's table falls back to the kept name

**Files:**
- Modify: `packages/db/src/party-table-labels.ts` (`LabelledOrder` gains `deliveryTableLabel:
  string | null`; `orderTableLabels`, `:82-114`, answers the live table's label while
  `deliveryTableId` is set, else `deliveryTableLabel`, else `order.label`), and every caller that
  builds a `LabelledOrder` selects the new column: `apps/server/src/receipt-order.ts:29`, `:46`,
  `:52`; `kitchen-print.ts:385`, `:390`, `:1281`, `:1305`; `working-order.ts:6691`, `:7129`;
  `move-bill.ts:271`; `packages/reporting/src/overdue-orders.ts:57`, `:140`;
  `apps/server/src/orders-list.ts:150-160` (`delivery_label` =
  `coalesce(dd.label, wo.delivery_table_label)`)
- Read, and say in the commit why each needs no change: `department-transfer-api.ts:200`,
  `watch-zones.ts:37-53`, the floor's pending count (`working-order.ts:7015-7024`), the expo queue
  (`:6652`) — each reads only live orders, and removal (Task 1.9) happens only to a table with
  no live order, so a released order never reaches it. If one does reach released orders, give it the same fallback.
- Test: `apps/server/src/delivery-release.test.ts` (extend), `packages/db/src/party-table-labels.test.ts` if it exists (else the server test)

- [ ] **Step 1: Write the failing tests** — after `releaseDeliveries` on a settled delivered
order: `readReceiptOrder` for it names "Terrace 4"; `listOrders` shows `tables: ["Terrace 4"]`
and `counter: false`; a kitchen ticket reprint header for it names "Terrace 4"; and, the case
the review found, an order delivered and collected BEFORE payment, then settled, freezes
"Terrace 4" into its label even when the table is released between collection and payment
(`orderTableLabels` with `deliveryTableId` null and `deliveryTableLabel` set).
- [ ] **Step 2: Run and watch them fail.** Expected: `tables: []`, `counter: true`, the receipt
without the table.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and `pnpm --filter @waitron/server exec vitest run src/receipt-order.test.ts src/kitchen-print.test.ts src/orders-list.test.ts src/move-bill.test.ts`, `pnpm --filter @waitron/reporting exec vitest run src/overdue-orders.test.ts`. Expected: pass.
- [ ] **Step 5: Commit.**

### Task 1.6: The table-removal module seat, and bookings' part in it

**Files:**
- Modify: `packages/module/src/module.ts` (beside `FloorAnnotator`, `:62`, and the descriptor's
  `floorAnnotations`, `:855`), `packages/module/src/index.ts`, `apps/server/src/modules.ts`
  (`enabledTableRemovals`, beside `enabledFloorAnnotators`, `:20`),
  `packages/composition/src/modules.ts:265` (the bookings descriptor gains `tableRemoval`),
  `packages/bookings/src/schema/bookings.ts` (`tableLabel: label("table_label")`),
  `packages/bookings/src/bookings.ts` (`listBookings`, `getBooking` return `tableLabel`),
  `packages/bookings/src/errors.ts` (`table.booked { tableId }`; note 2026-10-10: since slice 2 it
  also carries `date` (YYYY-MM-DD) and `time` (HH:MM) of the earliest upcoming booking)
- Create: `packages/bookings/src/table-removal.ts`, `packages/bookings/src/table-removal.test.ts`
- Generated: a bookings migration (`pnpm --filter @waitron/bookings db:generate`), one `ALTER TABLE … ADD`

**Interfaces:**
- Produces:

```ts
// packages/module/src/module.ts
export interface TableRemoval {
  /** The refusal for each of `tableIds` this module still needs; a table it lets go of has no entry. A throw is not a refusal: it fails the caller, the till's floor read included. */
  refuse(tx: Transaction, cfg: { locationId: LocationId }, tableIds: readonly string[], now: Date): Promise<ReadonlyMap<string, AppError>>;
  /** Lets go of every row naming the table, keeping `label` as text where history needs it. */
  release(tx: Transaction, cfg: { locationId: LocationId }, tableId: string, label: string): Promise<void>;
}
// WaitronModule: readonly tableRemoval?: TableRemoval;
// apps/server/src/modules.ts
export function enabledTableRemovals(modules: readonly WaitronModule[]): readonly TableRemoval[];
// packages/bookings/src/table-removal.ts
export const BOOKINGS_TABLE_REMOVAL: TableRemoval;
// booking JSON gains tableLabel: string | null
```

`refuse` answers `table.booked { tableId }` for each table a `booked` booking names on the venue's
today or later (amended 2026-10-10: as built, the seat takes a list of tables and answers a map, so
bookings reads the venue's day once and asks about every table in one query) (today from the venue's wall clock, as `floor.ts`'s `venueWallClock` computes it —
move `venueWallClock` and `safeTimeZone` into a shared file in the package rather than copying
them). `release` sets `table_label = label, table_id = null` on every booking naming the table.

- [ ] **Step 1: Write the failing tests** in `table-removal.test.ts` (set up as
`packages/bookings/src/floor.test.ts` does):

```ts
it("refuses while a booking from today on is booked at the table", async () => {
  const refused = await inTx((tx) => BOOKINGS_TABLE_REMOVAL.refuse(tx, cfg, [tableId], now));
  expect(refused.get(tableId)).toMatchObject({ code: "table.booked", params: { tableId } });
});
it("does not refuse for yesterday's booking, or a cancelled or completed one today", async () => { /* … */ });
it("keeps the table's name on past bookings when it lets go", async () => {
  /* release(tableId, "Terrace 4"); getBooking returns tableId null, tableLabel "Terrace 4" */
});
```

and beside `enabledFloorAnnotators`' test: a module without the seat contributes nothing; the
bookings module contributes `BOOKINGS_TABLE_REMOVAL`.

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/bookings exec vitest run src/table-removal.test.ts`. Expected: cannot import.
- [ ] **Step 3: Implement**; generate the bookings migration and check it has no `__new_`.
- [ ] **Step 4: Run** the file, `pnpm --filter @waitron/bookings test:coverage`, `pnpm exec vitest run scripts/module-seams.test.ts scripts/module-graph-honesty.test.ts`, `pnpm --filter @waitron/composition exec vitest run`. Expected: pass; coverage at its bar.
- [ ] **Step 5: Commit.**

### Task 1.7: The bookings screen shows a deleted table's kept name

**Files:**
- Modify: `packages/bookings/src/dashboard/client.ts:45-52` (booking type gains `tableLabel`),
  `packages/bookings/src/dashboard/bookings-screen.ts:258` (a booking whose `tableId` is null and
  `tableLabel` set shows the label)
- Test: the bookings screen's browser test file

- [ ] **Step 1: Write the failing test** (Chromium): a past booking with `tableId: null,
tableLabel: "Terrace 4"` shows "Terrace 4" in its table cell; a booking with neither shows the
screen's existing "no table" text.
- [ ] **Step 2: Run and watch it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the screen's tests. Expected: pass.
- [ ] **Step 5: Commit.**

### Task 1.8: Building today's plan from the master

**Files:**
- Create: `apps/server/src/floor-today-store.ts`, `apps/server/src/floor-today-store.test.ts`

**Interfaces:**
- Consumes: `planReset`, `targetsFromMaster` and their types (Task 1.2); `venueMomentAt` and
  `readLocationClock` from `@waitron/reporting` (`business-day.ts:202`, `:220`; both exported —
  `businessDayOf` is not, and its callers must check the clock first, `:166-169`).
- Produces:

```ts
export async function todayBusinessDay(tx: Transaction, cfg: TillConfig, now: Date): Promise<string | null>; // venueMomentAt(now, clock)?.businessDay; null for a clock it cannot read
/** Copies the zone's master into today's plan: replaces the zone's reset rows with targetsFromMaster, then catches up. */
export async function resetZone(tx: Transaction, cfg: TillConfig, removals: readonly TableRemoval[], zoneId: string, now: Date): Promise<void>;
/** Applies the zone's PENDING reset rows that can be applied now, repeating while a pass changes something. */
export async function catchUpZone(tx: Transaction, cfg: TillConfig, removals: readonly TableRemoval[], zoneId: string, now: Date): Promise<void>;
/** For each zone with a master plan: resetZone when its today's plan is for an earlier business day (or it has none), else catchUpZone when it has pending rows. */
export async function ensureToday(tx: Transaction, cfg: TillConfig, removals: readonly TableRemoval[], now: Date): Promise<void>;
```

`removals` is an argument, never optional, so no caller can skip the modules' part (Task 1.9 uses
it; until then pass it through). A clock that cannot be read leaves today's plan as it is.
`catchUpZone` takes `now` too, for the modules' `refuse` (Task 1.9). The reset's `Target`
(`floor-reset-plan.ts`) carries `planTableId`, the master table it was copied from (amended
2026-10-10, as built in slice 1).

`resetZone`: write `floor_today_zones` (business day, generation + 1); replace the zone's
`floor_reset_tables` rows with `targetsFromMaster` (every row pending); `catchUpZone`.

`catchUpZone`: read the zone's pending reset rows as targets, its live tables (`held` from
`party_tables` rows whose `left_at` is null; `tied` from `tablesTied`, Task 1.9 — until then
`tied = held`; `hasToday`; `mergedWithHeld` from `floor_today_join_tables`), and
`takenElsewhere` (labels of every live table of the venue outside the zone); call `planReset`;
apply it in this order:
1. `remove`: Task 1.9 (until then treated as `hide`);
2. `hide`: the table leaves its today's merge (a merge left with fewer than two members goes with
   its members), its today's row is deleted, and `active` is set false, so every existing reader
   that skips an inactive table skips it (`openTab`, `working-order.ts:1201`; `readTargetTable`,
   `move-bill.ts:225`; the floor read, `:7027`; `listTables`) until slice 5;
3. every `apply` whose label changes, to a spare name from `spareLabels` (the id, numbered until no
   current or final name in the location holds it) (first pass; amended 2026-10-10);
4. `create`: a `dining_tables` row (`location_id` = `cfg.locationId`, `zone_id`, label,
   `plan_table_id` = the target's `planTableId`, so a new table links to its master by id, not by
   name, `planned` true) and its today's row (amended 2026-10-10, as built in slice 1);
5. every `apply`: the final label (second pass); then, only when the reset row is not yet `placed`,
   today's row set from the target (seats, fixed, placement, `taken_off` false), `active` true, the
   table leaves any today's merge (a merge left with fewer than two members goes with its
   members), and the row is marked `placed`. A reset places a table once; a later catch-up of a
   row still pending for its name only retries the name, keeping the day's moves and merges
   (amended 2026-10-10, as built in slice 1);
6. `seed`: a today's row from the target, label unchanged;
7. reset rows: a target not in `pending` stops being pending; a created one gets its new
   `table_id`.
Then run again while the pass changed anything (a removal frees names for the next pass).

The reset rows keep the targets of the last reset, applied or not, so nothing later than the reset
reaches the till until the next one (decision 3; slice 4's Back to its saved place reads them).

- [ ] **Step 1: Write the failing tests** (`setupPartyVenue`; write a master plan by inserting
rows directly — Tasks 1.10 and 1.11 build the save; a helper `masterOf(v, zoneId, tables)` in the
test):

```ts
it("builds today's plan from the master on the first reset", async () => {
  /* master T1 at (0,0) 8×8, T2 a spare; resetZone: T1's today's row placed at (0,0), T2's
     unplaced; floor_today_zones generation 1; no reset row pending */
});
it("leaves a seated table and its merge alone, and catches them up once free", async () => {
  /* reset; seat T1; join the party to T2 (both held); merge T1+T2 by hand; change both in the
     master (T1 x 20, renamed "Patio 1"); resetZone: T1 and T2 keep today's places, names and merge,
     their rows pending; finish the party; catchUpZone: T1 at x 20 named "Patio 1", the merge gone */
});
it("does not bring a mid-service master edit to the till before the next reset", async () => {
  /* reset; rename and move T1 in the master, add T3, delete T2; seat and finish a party at T1;
     catchUpZone: nothing changed — T1 as before, no T3, T2 still there; resetZone: all three apply */
});
it("adds a table the master gained, and hides one it lost", async () => { /* active false, no today row */ });
it("seeds a table seated at the first reset, keeping its name until it is free", async () => { /* … */ });
it("does not reset a zone with no master plan", async () => { /* ensureToday: no floor_today_zones row */ });
it("resets at the first read of a new business day, and only once", async () => {
  /* cutover 04:00 (update locations.day_cutover); ensureToday at 2026-10-09 03:30 venue time,
     then at 05:00: generation goes 1 → 2; again at 06:00: still 2 */
});
it("leaves a table the master never had untouched", async () => { /* planned false: no today row, active unchanged */ });
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/floor-today-store.test.ts`. Expected: cannot import.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 1.9: Removing a live table the master no longer has

**Files:**
- Create: `apps/server/src/table-removal.ts`, `apps/server/src/table-removal.test.ts`
- Modify: `apps/server/src/floor-today-store.ts` (`catchUpZone` removes `remove` tables; `tied`
  from `tablesTied`)

**Interfaces:**
- Consumes: `TableRemoval` (Task 1.6), `releaseDeliveries` (Task 1.4), `closePartyTables` on every
  close (Task 1.3).
- Produces:

```ts
/** The tables of `tableIds` an open party holds or used earlier in its meal, or an order to which is unpaid or has food on its way. */
export async function tablesTied(tx: Transaction, tableIds: readonly string[]): Promise<Set<string>>;
/** Removes the live tables for good, returning those it kept: each a module refuses, having changed nothing, and each something unknown still names, having kept its reset row and the table itself. (Amended 2026-10-10: one call for the whole list, asking the modules once.) */
export async function removeLiveTables(tx: Transaction, cfg: Pick<TillConfig, "locationId">, removals: readonly TableRemoval[], tableIds: readonly string[], now: Date): Promise<Set<string>>;
```

`tablesTied` (amended 2026-10-10: one call answers for every candidate table): a `party_tables` row of an OPEN party names the table (held, or left earlier while
the party is still open); or an order names it in `delivery_table_id` and either its `status` is
`open` or `placed`, or the floor's pending-delivery test holds — the floor's own condition,
`foodOnItsWay` (`apps/server/src/delivery-release.ts`), which both queries read (not abandoned, `collected_at` null, and a ticket item with
`made_here = 0`).

(amended 2026-10-10, as built in slice 1) `removeLiveTables` first asks every module's `refuse`; if
any refuses (bookings: an upcoming booking), it changes nothing for that table and returns it among those kept. `catchUpZone`
asks the same before planning, and treats a refused table as it treats a held one, except that it
never seeds it (the planner's `refused` flag): it waits whole, on today's plan
with its reset row pending, until the refusal clears.

`removeLiveTables`: each removal's `release`; `releaseDeliveries(tx, id, label)`; delete its
`floor_today_join_tables` row (a merge left with fewer than two members goes with its members),
its `floor_today_tables` row and its `floor_reset_tables` row; then the `dining_tables` row. A
foreign-key refusal at that last delete (rows of a module switched off since, or of a party closed
before slice 1) is caught by `isRefusal(error, FOREIGN_KEY_VIOLATION)`
(`packages/db/src/sql-state.ts:24`; every key into `dining_tables` is `no action`, which this engine
refuses with code 787 — measured twice by the plan reviews on Node v26.7.0 `node:sqlite`;
`restrictRefused` matches only 1811) and the table is returned among those kept; `catchUpZone` then hides the table and
keeps its reset row pending, so it is tried again. A refused statement backs out only itself
(CLAUDE.md §3), so the releases before it stand: orders and bookings keep the table's name and no
longer point at it, and the table is off today's plan, which `catchUpZone` then hides anyway. Any
other error is rethrown.

- [ ] **Step 1: Write the failing tests:**

```ts
it("removes a free table the master lost, keeping its name on the history", async () => {
  /* a party seated and finished at it (Task 1.3 copied the name); a delivered order to it, settled
     and collected; a settled delivered order never collected that had no ticket items; delete its
     master table; resetZone: the row is gone, both orders keep deliveryTableLabel "T4", the party
     keeps tableNames ["T4"] */
});
it("frees the name for a table created in the same catch-up", async () => {
  /* master deletes T1 and renames T2 to "T1": after resetZone, T2 is named "T1" (second pass) */
});
it.each([
  ["a party that moved away and is still open"],
  ["an unpaid order to it"],
  ["food still on its way to it"],
])("hides rather than removes a table tied by %s, and removes it once free", async () => { /* … */ });
it("asks each module to let go", async () => { /* a fake TableRemoval records release(tableId, label) */ });
it("leaves a table something unknown still names, hidden and pending, without failing", async () => {
  /* insert a party_tables row for a CLOSED party by hand (as before slice 1); resetZone resolves;
     the row remains, inactive; delete the stray row; catchUpZone: the row is gone */
});
```

- [ ] **Step 2: Run and watch them fail** — `pnpm --filter @waitron/server exec vitest run src/table-removal.test.ts`. Expected: cannot import.
- [ ] **Step 3: Implement**; wire it into `catchUpZone`.
- [ ] **Step 4: Run** the file and `src/floor-today-store.test.ts`. Expected: pass.
- [ ] **Step 5: Commit.**

### Task 1.10: Reading the master plan, and checking a save

**Files:**
- Create: `apps/server/src/floor-plan.ts`, `apps/server/src/floor-plan.test.ts`
- Modify: `apps/server/src/errors.ts` (`floor_plan.out_of_date { zoneId, revision }`, the plan's
  current revision, `floor_plan.invalid { field }`)

**Interfaces:**
- Consumes: `Placement`, `PlanShape` (Task 1.2).
- Produces:

```ts
export interface PlanTable { id: string | null; liveTableId: string | null; label: string; seats: number | null; fixed: boolean; placement: Placement | null }
export interface PlanJoin { id: string; seats: number; tableIds: string[] }
export interface ZonePlan { zoneId: string; revision: number; savedAt: string | null; tables: PlanTable[]; joins: PlanJoin[] }
export interface ZonePlanSave {
  revision: number; // the copy's revision; 0 when the zone had no master plan
  tables: { id?: string; liveTableId?: string; key: string; label: string; seats: number | null; fixed: boolean; placement: Placement | null }[];
  joins: { seats: number; tableKeys: string[] }[];
}
export async function readZonePlan(tx: Transaction, cfg: TillConfig, zoneId: string): Promise<ZonePlan>;
/** Every check of a save; throws the first refusal, writes nothing. */
export async function checkZonePlanSave(tx: Transaction, cfg: TillConfig, removals: readonly TableRemoval[], zoneId: string, input: ZonePlanSave): Promise<void>;
```

`readZonePlan`: the zone's master tables and joins, plus the zone's active live tables that follow
no master and were never planned (`plan_table_id` null, `planned` false), offered for the editor
to adopt (`id` null, `liveTableId` set, seats from `capacity`, unplaced). A zone with no master
plan reads `revision: 0, savedAt: null` and only those (decision 16).

`checkZonePlanSave`, in order: zone exists (`zone.not_found`); `input.revision` equals the stored
revision (else `floor_plan.out_of_date`); each entry, naming the field as `tables.<index>.<name>`
or `joins.<index>.<name>` (`floor_plan.invalid`): label trimmed and non-empty, seats null or a whole
number 0–999, placement ranges as Task 1.1's checks, not both `id` and `liveTableId` (unless the `liveTableId` is that master table's own live table, as
`readZonePlan` sends it; amended 2026-10-10), a join has
two or more distinct keys all in `tables` and seats ≥ 1; an `id` that is not a master table of
this zone, or a `liveTableId` that is not an adoptable live table of this zone, is
`table.not_found`; a duplicate label within the input, one used by a master table of another zone,
or one used by any live table of the venue that follows no master and is not adopted by this
input, is `table.label_taken { label }` (decision 8); a master table of the zone missing from the
input is a delete, and when its live table exists each removal's `refuse` is asked (bookings:
`table.booked`).

- [ ] **Step 1: Write the failing tests** (`setupPartyVenue`; its tables zone):

```ts
it("offers a zone's live tables as the first draft", async () => { /* revision 0, liveTableId set, ids null */ });
it("offers a table the old screen added to a planned zone for adoption", async () => { /* … */ });
it("refuses a save from an older copy", async () => { /* floor_plan.out_of_date */ });
it("refuses a name a master table of another zone uses, naming it", async () => { /* table.label_taken {label} */ });
it("refuses a name a live table outside the plan uses", async () => { /* … */ });
it.each([
  ["tables.0.label", { label: "  " }],
  ["tables.0.placement.rotation", { placement: { x: 0, y: 0, width: 8, height: 8, shape: "rect", rotation: 10 } }],
  ["tables.0.placement.x", { placement: { x: 1000, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 } }],
  ["tables.0.seats", { seats: -1 }],
  ["tables.0.id", { id: "<a master id>", liveTableId: "<a live id>" }],
])("refuses %s", async (field, patch) => { /* floor_plan.invalid {field} */ });
it("refuses a join of one table", async () => { /* joins.0.tableKeys */ });
it("refuses deleting a table a module still needs", async () => { /* a fake TableRemoval whose refuse answers table.booked for the table */ });
it("accepts deleting a table a party sits at", async () => { /* seat at T1; a save without T1 passes the checks */ });
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/floor-plan.test.ts`. Expected: cannot import.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 1.11: Saving the master plan

**Files:**
- Modify: `apps/server/src/floor-plan.ts`, `apps/server/src/floor-plan.test.ts`

**Interfaces:**
- Consumes: `checkZonePlanSave` (Task 1.10), `resetZone` (Task 1.8).
- Produces: `export async function saveZonePlan(tx: Transaction, cfg: TillConfig, removals: readonly TableRemoval[], zoneId: string, input: ZonePlanSave, now?: Date): Promise<{ revision: number; ids: Record<string, string> }>; // ids: key → master table id`

After `checkZonePlanSave`, write in this order: the plan's saved joins and their members are
deleted (a member row points at a master table, so a master table in a join cannot be deleted
before them — the review's probe of such a delete answered 787); deleted master tables (their live
table's `plan_table_id` set null; `planned` stays true, so the next reset removes it); master labels
in two passes, new master tables between them; seats, fixed and placement; the joins and members
inserted; `liveTableId` entries link their live table (`plan_table_id`, `planned` true); `revision`
bumped, `saved_at` set. Last: when the zone has no today's plan yet, `resetZone` (decision 16).
Nothing else live changes.

- [ ] **Step 1: Write the failing tests:**

```ts
it("saves a first plan, links the live tables and builds today's plan", async () => {
  /* save the draft with T1 placed and a new "Bar 1" fixed: revision 1; T1 follows its master;
     Bar 1 has a live row; both have today's rows */
});
it("changes nothing live when a later save moves, renames or deletes a table", async () => {
  /* after the first save: save T1 at x 30 renamed "Patio 1", Bar 1 deleted; live T1 still at x 0
     named "T1"; Bar 1 still on today's plan; after resetZone: T1 at 30 "Patio 1", Bar 1 gone */
});
it("deletes a table that is in a saved join", async () => { /* join T1+T2+T3, delete T3: the join has T1+T2 */ });
it("swaps two tables' names in one save", async () => { /* T1↔T2 */ });
it("renames T1 to T9 and adds a new T1 in one save", async () => { /* … */ });
it("writes nothing when a check refuses", async () => { /* a stale revision: the plan reads as before */ });
it("deletes a table a party sits at, and the party stays", async () => {
  /* seat at T1; save without T1: revision 2; live T1 unchanged and still seated */
});
```

- [ ] **Step 2: Run and watch it fail.** Expected: `saveZonePlan` is not exported.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/floor-plan.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 1.12: The till catches today's plan up on every floor read and change

**Files:**
- Modify: `apps/server/src/till-api.ts` (deps type, `:231`, gains `tableRemovals?: readonly
  TableRemoval[]`, read as `deps.tableRemovals ?? []` at each call; `GET /api/tables/state`,
  `:2216`, and the seat, finish, move, join and split routes, `:2250-2379`, call `ensureToday`
  first in their transaction), `apps/server/src/boot.ts` (the till API's deps, beside
  `floorAnnotators`, `:1420`: `tableRemovals: enabledTableRemovals(setsToMigrate)`)
- Test: `apps/server/src/floor-catch-up.test.ts` (new)

**Interfaces:**
- Consumes: `ensureToday` (Tasks 1.8, 1.9); `enabledTableRemovals` (Task 1.6).

`ensureToday` resets or catches up only ACTIVE zones, so a switched-off zone's tables stay off, and
finds the zones with work due (no today's plan, an earlier business day, or a pending reset row) in
one query (amended 2026-10-10, as built in slice 1).

Catching up happens at the next floor read or change, not inside each path that frees a table
(decision 19): the till re-reads the floor after its own actions and, from slice 3, every 15
seconds, and a delivery being paid or collected frees a table without any table route running.

- [ ] **Step 1: Write the failing tests** (through the routes, as `till-api.tables.test.ts` mounts
them, with the server's real `ensureToday`):

```ts
it("brings a table back to the master on the first floor read after its party finishes", async () => {
  /* reset; seat T1; move T1 today; change T1 in the master; reset (T1 waits); finish;
     GET /api/tables/state: T1 at the master's place */
});
it("removes a table deleted from the master once its party finishes", async () => {
  /* seat T4; delete T4 from the master; reset (T4 waits, still on the map); finish; read: T4 gone */
});
it("creates a new table that was waiting for its name once the old one is free", async () => {
  /* Review focus 3: master renames "Terrace 4" (seated) to "Terrace 9" and adds a new "Terrace 4";
     reset; finish; read: "Terrace 9" and a new "Terrace 4" both on the map */
});
it("frees a table when its delivery is collected, at the next read", async () => { /* … */ });
it("resets before seating on a new business day", async () => { /* POST seat at 05:00 after a 04:00 cutover: generation went up first */ });
it("does nothing when no reset happened while the table was taken", async () => {
  /* seat, move today, finish, read: the table keeps today's place until the next reset */
});
```

- [ ] **Step 2: Run and watch them fail.** Expected: the table keeps today's place after the party.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and `pnpm --filter @waitron/server exec vitest run src/till-api.tables.test.ts src/till-api.table-actions.test.ts src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts`. Expected: pass.
- [ ] **Step 5: Commit.**

### Task 1.13: The old floor screen cannot change a table the master owns

**Files:**
- Modify: `apps/server/src/tables.ts` (`updateTable`, `:138-186`: a name, zone or `active` change
  on a `planned` table is refused `table.in_floor_plan { tableId }`; capacity still changes),
  `apps/server/src/errors.ts`, `STATUS` (`management-api.ts:251`: `table.in_floor_plan: 409`),
  `apps/dashboard/src/i18n/codes.ts` (EN and ES: "This table is in a floor plan; change it in the
  floor plan editor.")
- Test: `apps/server/src/tables.test.ts`

(amended 2026-10-10, as built in slice 1) The same refusal covers the old screen's Disable
(`deactivateTable`) and a placement into a different zone (`setTablePlacement`); a change is refused
only when the value actually differs from the stored one, because the old screen resends the
unchanged name and zone; and in `updateTable` a missing zone answers `zone.not_found` before the
floor-plan check.

Until slice 5 removes the old screen, this keeps decision 17's promise: a reset never reverts a
change made there, and a table a reset hid cannot be switched back on behind the master's back. The
old screen still adds tables; `readZonePlan` offers them for adoption (Task 1.10).

- [ ] **Step 1: Write the failing tests**: on a planned table, renaming, moving to another zone,
and switching on or off are each refused `table.in_floor_plan`; changing capacity succeeds; on a
table never planned, all four succeed as today.
- [ ] **Step 2: Run and watch them fail.** **Step 3: Implement.** **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/tables.test.ts src/management-api.test.ts`. **Step 5: Commit.**

### Task 1.14: The master plan's dashboard routes

**Files:**
- Modify: `apps/server/src/management-api.ts` (deps type, `:167`, gains `tableRemovals?:
  readonly TableRemoval[]`, read as `deps.tableRemovals ?? []`; two routes beside the zone routes,
  `:1663-1720`; `STATUS` at `:251`: `floor_plan.out_of_date: 409`, `floor_plan.invalid: 400`,
  `table.booked: 409`), `apps/server/src/boot.ts` (the management API mount, `:1541`, passes
  `tableRemovals`), `apps/dashboard/src/api/client.ts` (types `FloorPlan`, `FloorPlanSave` mirroring
  Task 1.10's, and `getFloorPlan(zoneId)`, `saveFloorPlan(zoneId, body)`),
  `apps/dashboard/src/api/live-queries.ts` (`getFloorPlan: ["floor_plans", "floor_plan_tables",
  "floor_plan_joins", "floor_plan_join_tables", "dining_tables"]`), `apps/dashboard/src/i18n/codes.ts`
  (`floor_plan.out_of_date`, `floor_plan.invalid`, EN and ES; `table.booked`'s in bookings'
  `BOOKINGS_CODE_MESSAGES`, `packages/bookings/src/dashboard/strings.ts`)
- Test: `apps/server/src/management-api.test.ts` (a new `describe("floor plans")`), the dashboard
  client test file

**Interfaces:**
- Produces: `GET /management-api/zones/:id/floor-plan` → 200 `ZonePlan`;
  `PUT /management-api/zones/:id/floor-plan` with `ZonePlanSave` → 200 `{ revision, ids }`. Both
  through `withVenueAuth` (`venue.configure`, `management-api.ts:420`) and `requireZoneId`
  (`:339`). The body is shape-checked in the route (`management.request_invalid { field }` for a
  non-object, a non-array `tables`/`joins`, a non-string `label`/`key`, a non-boolean `fixed`), and
  value-checked by `checkZonePlanSave`.
- (amended 2026-10-10, as built in slice 1) The route checks the body's shape (`revision`, `tables`,
  `joins`, each table's `key`, `label`, `fixed`, `placement`, `id` and `liveTableId`, each join's
  `tableKeys`) before it checks permission, as its sibling routes do. A GET answer is not a valid
  save as it stands: the editor adds a `key` to each table and turns each join's `tableIds` into
  `tableKeys` first (slice 2's editor does this).

- [ ] **Step 1: Write the failing tests**: manager reads a first draft (200, revision 0); saves
(200, revision 1) and reads it back; an older copy is 409 `floor_plan.out_of_date`; a bad rotation is
400 `floor_plan.invalid {field: "tables.0.placement.rotation"}`; `tables` not an array is 400
`management.request_invalid {field: "tables"}`; a refusing removal is 409 `table.booked`; staff is
403; no session is 401; an unknown zone is 404 `zone.not_found`. Use the file's `req`,
`managerCookie`, `staffCookie` and `createZone` helpers.
- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/management-api.test.ts -t "floor plans"`. Expected: 404 for the route.
- [ ] **Step 3: Implement** the routes, the wiring, the client methods and the strings.
- [ ] **Step 4: Run** that command, `pnpm exec vitest run scripts/live-subscriptions.test.ts`, and the dashboard client test. Expected: pass.
- [ ] **Step 5: Commit.**

### Task 1.15: Today's plan in the till's table-state answer

**Files:**
- Create: `apps/server/src/floor-today-state.test.ts`
- Modify: `apps/server/src/working-order.ts` (`TableState`, `:6852`; `listTablesWithState`,
  `:6900`), `apps/till/src/api/client.ts` (`TableState`, `:1748`, gains the same field)

**Interfaces:**
- Produces — `TableState` gains:

```ts
today: {
  placement: Placement | null; // null: an unplaced spare, or taken off
  seats: number | null;
  fixed: boolean;
  takenOff: boolean;
  joinId: string | null;
  joinSeats: number | null;
} | null; // null: the table has no today's row
```

`listTablesWithState` reads today's rows and merges; it never writes (Task 1.12's route runs
`ensureToday` before it).

- [ ] **Step 1: Write the failing tests**: a zone with a master plan — each table's `today`
matches its today's row, a spare has `placement: null`, a merge's tables share `joinId`; a zone
with no master plan — `today` is null.
- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/floor-today-state.test.ts`. Expected: `today` is undefined.
- [ ] **Step 3: Implement.** Keep `posX`… on `TableState` until slice 5.
- [ ] **Step 4: Run** the file and `pnpm --filter @waitron/server exec vitest run src/till-api.tables.test.ts src/working-order.test.ts src/till-api.profile-zones.test.ts`. Whole-shape pins of `TableState` (`toEqual`) gain the `today` key (allowed: adding a key to a whole-shape pin). Expected: pass.
- [ ] **Step 5: Commit.**

### Task 1.16: The demo seed writes master plans

**Files:**
- Modify: `apps/server/scripts/demo-seed/floor.ts` (`DEMO_TABLES`: a grid placement and `fixed`
  for bar stools beside today's permille placement), `apps/server/scripts/demo-seed/seed-floor.ts`
  (`:211-231`: after creating the tables, one `saveZonePlan` per zone from its first draft, which
  links the tables and builds today's plan), the demo seed's test
- Test: the demo seed's existing test file (find it: `git grep -l seedFloor -- '*.test.ts'`)

**Interfaces:**
- Consumes: `readZonePlan`, `saveZonePlan` (Tasks 1.10, 1.11).

The grid placement keeps the demo's layout. The old `posX`/`posY` is the table's CENTRE in
thousandths (`wt-floor-canvas.ts:276-278` draws it with `translate(-50%,-50%)`), and the new `x`/`y`
is the corner (decision 9): `x = round(posX / 1000 * 120 - width / 2)`, `y = round(posY / 1000 *
80 - height / 2)`, clamped at 0 (a 120 × 80 grid, the old canvas's 3:2), size from today's
`sizeForCapacity` equivalents (S 6 × 6, M 8 × 8, L 10 × 8, XL 14 × 8), `shape` round for `round`,
else rect. The bar seats become 2 × 2 round fixed tables.

- [ ] **Step 1: Write the failing test**: after the demo seed, every demo zone with tables has a
master plan and a today's plan, every table is placed in both, the bar stools are `fixed`, and no
two tables in one zone overlap (compare their rectangles; rotation ignored).
- [ ] **Step 2: Run and watch it fail.** Expected: no master plan.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the seed test; start the demo stack (`wa-wt demo <worktree-name>`) and
`GET /management-api/zones/<terrace>/floor-plan` once to see the seed's plan read back.
  (amended 2026-10-10, as built in slice 1) The live demo-stack check was replaced by a read-back
  with `readZonePlan` inside the seed test (`seed-floor.test.ts`), because the shared dev venue
  holds the owner's real data. The overlap check measures each table by the box around it once
  turned about its centre, not the unturned rectangle; measured that way, dining tables 5, 7 and 8
  overlapped neighbours, so their `posY` moved down slightly to clear.
- [ ] **Step 5: Commit.**

**Slice 1 done when:** focused tests above pass; `/finish-branch` runs the full wave; CI is green on
the head; the backlog's A429 entry says slice 1 landed and what it left.

---

## Slice 2 — the dashboard editor (spec §4)

Branch `feat/floor-plan-editor`, after slice 1 (landed as #1493). Expanded to step level on
2026-10-10, unattended, and revised the same day on a fresh-context review's findings; every
`file:line` in this slice was read at `main` `29801d74a`.

What the slice builds: two pure helpers in `packages/ui` (plan geometry, an undo history), two new
primitives (`wt-floor-plan-canvas`, `wt-sheet`), and a full-page dashboard editor at
`/manage/floor-plan/zone/<zoneId>` that reads and saves through slice 1's routes
(`GET`/`PUT /management-api/zones/:id/floor-plan`, `apps/server/src/management-api.ts:1813-1835`),
opened from a link on the zone's panel on the department page. Nothing on the till changes in this
slice except what a zone's first save already does (decision 16 of the plan).

**What slice 1 built that the editor works with** (read, not run):

- `readZonePlan` answers the master tables, each with its live table (`liveTableId`), then the
  zone's active live tables that follow no master table and never did, as entries with `id: null`
  and `placement: null` (`apps/server/src/floor-plan.ts:114-174`, the adoptable ones at
  `:157-166`). So a zone with no master plan opens with every table unplaced. A join reads as
  `{ id, seats, tableIds }` with master ids (`:139-155`).
- A save is `{ revision, tables: [{ id?, liveTableId?, key, label, seats, fixed, placement }],
  joins: [{ seats, tableKeys }] }` (`floor-plan.ts:47-60`; the dashboard's copies are `FloorPlan`
  and `FloorPlanSave`, `apps/dashboard/src/api/client.ts:611-645`). The route checks the shape
  before permission (`management-api.ts:468-504`, called at `:1827`), then `checkZonePlanSave`
  (`floor-plan.ts:283-350`). A GET answer is not a valid save as it stands (Task 1.14's amendment).
- A save cannot delete a table offered for adoption: one the save leaves out stays a live table
  outside the plan, its name blocks the save's names (`floor-plan.ts:260-262`), and the next read
  offers it again (`:157-166`).
- Refusals the editor must place, with their params: `floor_plan.out_of_date { zoneId, revision }`
  (`floor-plan.ts:305-307`); `floor_plan.invalid { field }` naming `tables.<i>.<name>` or
  `joins.<i>.<name>`, `<i>` being the entry's index in the save (`:176-232`); `table.label_taken
  { label }`, the trimmed label (`:334-340`); `table.not_found { tableId }` (`:322-331`);
  `table.booked { tableId }`, where `tableId` is the deleted master table's LIVE table
  (`packages/bookings/src/table-removal.ts:29`, through `floor-plan.ts:342-348`). The dashboard's
  wording for the first three is at `apps/dashboard/src/i18n/codes.ts:509-532`, and
  `table.booked`'s at `packages/bookings/src/dashboard/strings.ts:98-101`, registered when that
  module loads (`:104-105`). A rejected dashboard request carries `{ code, params, status }`
  (`packages/dashboard-kit/src/request.ts:119-125`).
- `saveZonePlan` answers `{ revision, ids }`, `ids` mapping each key to its master id
  (`floor-plan.ts:360-466`); the dashboard client's `saveFloorPlan` and `getFloorPlan` are at
  `client.ts:2790-2803`.

### Slice 2 decisions (added at expansion)

Each is the default this slice builds; the owner may override any at review.

1. **The editor's address is `/manage/floor-plan/zone/<zoneId>`, not `/manage/floor-plan/<zoneId>`.**
   The dashboard's path codec reads each value after a label (`packages/ui/src/url-state.ts:58-76`,
   labels per screen in `apps/dashboard/src/navigation.ts:3-27`), so a bare id after the screen is
   never read. A `back` query names the page Close returns to.
2. **Close goes to `back` when it is a `/manage/` path on this origin, else to `/manage`.** Close is
   a link, so the dashboard's own link handling (`apps/dashboard/src/dashboard-app.ts:1541-1571`)
   takes it through the leave question. The editor is core code and never names a module's screen;
   the department page passes its own address as `back` (Task 2.7).
3. **Keys.** A master table's key is its id; an adoptable live table's is `live:<liveTableId>`; a
   new table's is `new:<n>`, `n` counting from 1 per editor visit. A saved join's draft key is its
   id, a new one's `join:<n>`. The save sends `id` only for an entry that has a master id and
   `liveTableId` only for an adoptable one (the server also accepts a master entry carrying its own
   live table, `floor-plan.ts:313-317`, but nothing needs it), and each join's `tableKeys` through
   the same keys.
4. **A successful save marks what was sent as saved at once, and keeps what was edited since.** The
   editor re-keys the sent draft from the answer's `ids` (key → master id; an adopted table keeps its
   `liveTableId`) and commits it as the saved state; it re-keys the current draft the same way,
   which keeps an edit made while the save was pending, and resets Undo and Redo to it, because the
   old keys are gone; Save stays active when the current draft differs from what was sent. The
   selection and a field's refusal are re-keyed too, and the answer's `revision` is taken. Only then
   does it read the plan again, to refresh; the read replaces the draft only while nothing has
   changed since the save. A failed read is shown as a read's failure, not a failed save (CLAUDE.md
   §3): the next change or Save clears it, and it never replaces an action's message. A later Save
   sends master ids, never `new:` or `live:` keys again.
5. **On `floor_plan.out_of_date`** the code's sentence shows with a "Load newer plan" button;
   pressing it replaces the draft with a fresh read and empties Undo and Redo, writing nothing. The
   press is the person's choice to drop their draft, so it does not ask again. Save stays enabled.
   _Note 2026-10-10: the button shipped as "Reload" / "Recargar", to match the English code
   sentence; this plan's later mentions of "Load newer plan" mean it._
6. **`table.booked` names a table the draft has deleted, so there is no field to put it beside.** The
   message is "<name>: <the code's sentence>", the name taken from the plan as opened (matched by
   `liveTableId`). Undo brings the table back. This replaces the task list's "beside it in the panel".
   Owner 2026-10-10: replaced — the table comes back as last saved, outlined, with 'Booked 12 Oct,
   21:00' beside it and in the tables list; no message above the buttons.
7. **A refusal that names a table selects it.** `table.label_taken { label }` selects the draft table
   whose trimmed name is that label; `floor_plan.invalid { field: "tables.<i>.<name>" }` selects the
   table whose key is `tables[i].key` in the body that was SENT (not the draft's `<i>`th table at
   answer time, which may have changed); when the draft no longer has that key, nothing is selected
   and the refusal's own sentence shows. When the panel shows the field named (`label`, `seats`,
   `fixed`, `placement.shape`, `placement.width`, `placement.height`, `placement.rotation`), the
   sentence goes under it and the generic "Correct the highlighted fields to continue."
   (`form.fix_fields`, `apps/dashboard/src/i18n/strings.ts:592`) above the buttons; for a field it
   does not show (`placement.x`, `id`, `key` …) the table is still selected and the refusal's own
   sentence goes above the buttons. A `joins.<i>.…` refusal, and any other, shows its own sentence
   above the buttons and selects nothing. It clears at the next change to that field or the next
   Save. The editor's own checks at Save — every name non-empty once trimmed, and unique in the
   draft — mark a field the same way and keep Save disabled until fixed (design-system.md → Forms).
   At phone width a refusal that selects a table also opens the sheet (decision 13).
8. **Names used elsewhere.** The editor reads the venue's tables once when it opens
   (`listTables({ includeDisabled: true })`, `client.ts:2806`) and counts as taken, for Add tables'
   check and its automatic numbering, every name of a table in another zone, and of a switched-off
   table in this zone that no draft table follows (`liveTableId`). The server blocks this zone's
   never-planned tables a save does not adopt (`floor-plan.ts:260-262`); the dashboard's table list
   does not say which tables were ever planned (`client.ts:586-597`), so a switched-off table
   waiting for its removal is counted too, which only ever refuses more. A master name of another
   zone that is not yet on today's plan is caught by the server at Save (decision 7).
9. **The editor reads its plan on opening, after a save, on Load newer plan and when its address
   names another zone; it subscribes to no live updates.** `getFloorPlan`'s live-query entry
   (`apps/dashboard/src/api/live-queries.ts:324-330`) stays unused in this slice; another person's
   save reaches the editor as `floor_plan.out_of_date`. The zone's name comes from `listZones()`
   (`client.ts:2775-2777`), which lists active zones only; for a zone it does not list the heading
   is "Floor plan".
10. **Undo covers every change since the editor opened or last saved, with no limit.** This departs
    from spec §4's "every change since the editor opened": a save gives new tables their master ids
    and adopts live tables, so a step from before it would bring back keys the server no longer
    knows (decision 4). Typing into one field of one table is one step: the history merges
    consecutive pushes that carry the same merge key.
11. **The undo history lives in `packages/ui/src/history.ts`, not `packages/ui-core`.**
    `@waitron/ui-core` is the account-controls package shared with Waitron Cloud
    (`packages/ui-core/README.md:1-6`); `packages/ui` is mutation-tested at the same bar of 90. The
    file map is amended to match.
12. **The editor draws one grid square as 12 CSS pixels** (`GRID_SQUARE_PX`). The grid fills the
    visible area and reaches at least 8 squares past the furthest table right and down. Names hide
    below 28 px as decision 11 says, in the editor too (a 2 × 2 stool is 24 px); every table keeps
    its name as its accessible name, and the tables list is the tap-sized way to select a table drawn
    smaller than `--wt-tap-min`.
13. **The side panel sits beside the canvas while the editor is 600 px wide or more; below that it
    is a new `wt-sheet` docked at the bottom.** No sheet primitive exists (`packages/ui/src/components/`
    holds none). Collapsed, the sheet shows its heading (the selected table's name, else "Tables");
    expanded, its content scrolls within 60% of the viewport's height. Slice 3's details sheet may
    reuse it.
14. **Add tables opens in a `wt-modal` with 1 table, 4 seats, automatic naming with the zone's name
    as the prefix, and Fixed in place off.** Add is enabled at open, as Duplicate is
    (`saveActionState(…, { savableAtOpen: true })`, `apps/dashboard/src/screens/canvas-editor-screen.ts:1059`).
    1 to 100 tables at once. The list sorts names with numbers in numeric order ("Terrace 2" before
    "Terrace 10"). The editor's strings are its own keys, not the old floor screen's, which slice 5
    removes.
15. **Placing an unplaced table puts it at `firstFreeSpot` as an 8 × 8 rectangle, not rotated**
    (decision 9's new-table size, fixed or not). Remove from plan forgets its place and size.
16. **The line under the header** says when the till's TABLES follow, not where they are drawn (the
    till draws today's places only from slice 3): before a zone's first save, "Your first save
    updates the till's tables. After that, saved changes wait for the next business day."; after,
    "Saved changes reach the till's tables when the next business day starts." (owner 2026-10-10:
    now "Your first save goes live now; later changes, tomorrow." and "Your changes will go live
    tomorrow.", the owner's 2026-10-10 overrides, built as an extra task after 2.5b.) A table a party sits
    at waits for its tab to close either way (the plan's decision 3). The task list's "with Reset on
    the till for sooner" names a till button slice 4 builds; Task 4.5 adds those words when it does
    (noted there).
17. **The entry point is a link on the zone's panel, beside its Opening hours link, labelled "Edit
    floor plan" for every active zone, and it reads nothing.** The departments spec keeps the zone's
    ⋮ menu to Rename, Move and Disable and puts "Edit floor plan" on the zone
    (`docs/superpowers/specs/2026-10-07-service-times-departments-and-stations-design.md:267-271`),
    and A366 slice 6's plan says A429's Task 2.7 adds it to the zone panel
    (`docs/superpowers/plans/2026-10-08-a366-slice-6-departments.md:203-207`). The panel draws that
    block only for an active zone (`packages/venue-service/src/dashboard/department-zones.ts:390-404`).
    "Add a floor plan" for a zone with no tables, and the preview, are A366 Part C's (Task C1),
    which reads the plan for the preview anyway; a fixed label here saves a read on every zone
    shown. The module checks no permission: a module's dashboard context carries none
    (`packages/dashboard-kit/src/contract.ts:14-17`); the Departments screen needs
    `venue_service.manage`, granted from manager up (`packages/venue-service/src/permissions.ts:5-7`),
    and the role map gives `venue.configure` to manager and admin (`packages/identity/src/permissions.ts:55-80`,
    read, not run); the editor screen and its routes check `venue.configure` themselves. This
    replaces the task list's "hide it otherwise".
18. **The header's Close, Undo, Redo and Save sit in a `wt-form-actions`, whose `error` carries the
    editor's one message**, so it shows on its own line above the buttons. That is the Forms rule's
    "bottom message", at the top here because the editor's Save is in its header (spec §4).
19. **The look pass (Task 2.8) photographs the editor from a Vitest browser file that is never
    committed**, with fixture plans, not from a dev stack: the shared dev venue holds the owner's
    real data (Task 1.16's amendment).
20. **A table offered for adoption has no Delete**, only Remove from plan when placed: a save cannot
    delete it (see "What slice 1 built"), so Delete would vanish from the draft and come back at the
    next read. Removing it stays a job for the old floor screen until slice 5.

**Mutation runs.** `packages/ui`'s floor of 90 bites only in the weekly run
(`docs/developers/ci-and-gates.md:323`), so each task that adds a `packages/ui` file runs Stryker on
that file once, as one bounded step: `gtimeout 900 pnpm --filter @waitron/ui exec stryker run
--mutate <file>`. Read the score it prints for the file (at least 90; a surviving mutant gets an
exact-value assertion, not an exclude). If it cannot start under the browser setup or runs out of
time, try nothing else: say so in the commit message, and the weekly run is the check.

### Task 2.1: Plan geometry

**Files:**
- Create: `packages/ui/src/floor-plan-geometry.ts`, `packages/ui/src/floor-plan-geometry.test.ts`
- Modify: `packages/ui/src/index.ts` (export the module beside the floor exports, `:46-73`)

`@waitron/ui` already exports a `Placement` type, the old permille one (`packages/ui/src/index.ts:66`,
from `floor.ts`), so the grid placement here is `PlanPlacement`, the same shape as the dashboard
client's `PlanPlacement` (`apps/dashboard/src/api/client.ts:599-609`). Every test in `packages/ui`
runs in real Chromium (`packages/ui/vitest.config.ts`, `browser.enabled: true`); there is no Node
project, so "node tests" in the earlier task list meant pure tests.

**Interfaces:**
- Produces:

```ts
export const GRID_SQUARE_PX = 12;          // slice 2 decision 12
export const NEW_TABLE_SIZE = 8;           // decision 9
export const NAME_MIN_PX = 28;             // decision 11
export type PlanShape = "rect" | "round";
export interface PlanPlacement { x: number; y: number; width: number; height: number; shape: PlanShape; rotation: number }
/** An axis-aligned box in grid squares; may be fractional and, for a crop, negative. */
export interface PlanRect { x: number; y: number; width: number; height: number }
export function snapToSquare(px: number, squarePx?: number): number;      // Math.round(px / squarePx)
export function clampToGrid(value: number): number;                       // whole, 0–999
export function rotationFromAngle(degrees: number): number;                // nearest 15, 0–345
// Note 2026-10-10: removed in slice 2's finish; the canvas uses floor.ts's snapRotation.
export function rotatedRect(p: PlanPlacement): PlanRect;                   // box around the table turned about its centre
export function bounds(placements: readonly PlanPlacement[]): PlanRect | null;
export function cropToTables(placements: readonly PlanPlacement[], margin?: number): PlanRect | null; // margin 2, not clamped at 0
export function fitScale(crop: PlanRect, viewport: { width: number; height: number }): number;       // px per square
export function gridExtent(placements: readonly PlanPlacement[], visible: { columns: number; rows: number }, margin?: number): { columns: number; rows: number }; // margin 8
export function firstFreeSpot(placed: readonly PlanPlacement[], size?: { width: number; height: number }, columns?: number): { x: number; y: number }; // size 8 × 8, columns 40
export function showsName(p: Pick<PlanPlacement, "width" | "height">, squarePx: number): boolean;      // shorter side × squarePx ≥ 28
export function automaticNames(prefix: string, existing: Iterable<string>, count: number): string[];
```

`rotatedRect` swaps width and height exactly at 90° and 270° and keeps them at 0° and 180° (no
trigonometry there: `Math.cos(Math.PI / 2)` is not 0, so a turned 8 × 4 would come out 4.000…01
wide); other angles use `|cos|` and `|sin|`. `firstFreeSpot` scans rows from `y = 0` down and, in
each row, `x` from 0 to `max(columns, ceil(bounds.right)) - size.width`; a spot is free when the
candidate, grown by one square on every side, overlaps no placed table's `rotatedRect`. Two boxes
overlap when each starts more than `1e-9` before the other ends, so touching edges, and edges a
rounding error apart, do not overlap. Below every table a spot is always free. `automaticNames`
trims the prefix; a label counts when it is exactly the prefix, one space and digits (an empty
prefix: digits alone), compared character for character as the server compares names
(`floor-plan.ts:278-282`); it numbers on from the highest such number.

- [ ] **Step 1: Write the failing tests** in `floor-plan-geometry.test.ts`. Every case asserts exact
  values (`toEqual`, not `toBeCloseTo`, except the 45° case), because `packages/ui` is
  mutation-tested and a loose assertion lets mutants live:

```ts
it("snaps pixels to the nearest whole square", () => { /* 17 → 1, 18 → 2, -7 → -1, with squarePx 12; 25 with squarePx 10 → 3 (2.5 rounds up) */ });
it("clamps a coordinate to 0–999 in whole squares", () => { /* -3 → 0, 1000 → 999, 12.4 → 12, 0 → 0, 999 → 999 */ });
it("turns an angle into a 15° step from 0 to 345", () => { /* 7 → 0, 8 → 15, 90 → 90, -10 → 345, 352 → 345, 353 → 0, 720 → 0 */ });
it("leaves an unturned table's box as it is", () => { /* x 10 y 5 w 8 h 4 rot 0 → { x: 10, y: 5, width: 8, height: 4 } */ });
it("turns a table about its centre, exactly at right angles", () => {
  /* x 10 y 10 w 8 h 4: rot 90 → { x: 12, y: 8, width: 4, height: 8 }; rot 270 → the same; rot 180 → { x: 10, y: 10, width: 8, height: 4 } (toEqual) */
});
it("boxes a table turned 45° around its corners", () => { /* x 0 y 0 w 8 h 4 rot 45: width and height 12·√2/2 ≈ 8.4853 (toBeCloseTo 4 places); centre stays at (4, 2) */ });
it("bounds nothing as null and several tables as their union", () => { /* [] → null; (0,0,8,8) and (20,10,4,4) → { x: 0, y: 0, width: 24, height: 14 } */ });
it("crops to the tables with a two-square margin, below 0 when a table touches the edge", () => { /* one table x 10 y 5 w 8 h 4 → { x: 8, y: 3, width: 12, height: 8 }; at (0,0,8,8) → { x: -2, y: -2, width: 12, height: 12 }; [] → null */ });
it("crops a rotated table by its turned box", () => { /* x 10 y 10 w 8 h 4 rot 90 → { x: 10, y: 6, width: 8, height: 12 } */ });
it("fits a crop to the space by its tighter side", () => { /* crop 12 × 8 in 600 × 300 → 37.5; in 600 × 800 → 50 */ });
it("keeps the grid the visible size with no tables, and 8 squares past the furthest table", () => {
  /* [] with visible 50 × 30 → 50 × 30; a table at x 200 y 3 w 8 h 4 → { columns: 216, rows: 30 };
     a table at x 0 y 40 w 8 h 4 → { columns: 50, rows: 52 } */
});
it("finds the top-left spot of an empty plan", () => { /* [] → { x: 0, y: 0 } */ });
it("leaves a one-square gap beside a table", () => { /* (0,0,8,8) → { x: 9, y: 0 } */ });
it("moves to the next free row when a row is full", () => { /* (0,0,40,8) → { x: 0, y: 9 } */ });
it("avoids a turned table's whole box", () => {
  /* (0,0,8,2) rot 90 occupies x 3–5, y -3–5 → { x: 6, y: 0 } (its unturned box would give 9); the same at rot 270 → { x: 6, y: 0 } */
});
it("treats a spot exactly a gap away as free", () => { /* (0,0,8,8) rot 180 → { x: 9, y: 0 }, the same as unturned */ });
it("shows a name at 28 px and hides it below", () => { /* 2 × 2 at 14 px → true; at 13.9 → false; 2 × 9 at 12 → false (shorter side 24 px); 3 × 3 at 12 → true */ });
it("numbers on from the highest name with the prefix", () => {
  /* ("Terrace", ["Terrace 1", "Terrace 5", "Terrace bar 3", "Terraces 9", "terrace 7"], 3)
     → ["Terrace 6", "Terrace 7", "Terrace 8"] */
});
it("starts at 1 when no name has the prefix, and trims the prefix", () => { /* (" Bar ", ["T1"], 2) → ["Bar 1", "Bar 2"] */ });
it("reads a leading zero as its number", () => { /* ("Terrace", ["Terrace 05"], 1) → ["Terrace 6"] */ });
it("numbers bare digits when the prefix is empty", () => { /* ("", ["4", "T1", "12a"], 2) → ["5", "6"] */ });
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/ui exec vitest run src/floor-plan-geometry.test.ts`.
  Expected: the test file fails to load, because `./floor-plan-geometry.js` does not exist.
- [ ] **Step 3: Implement** the module and its export. No DOM: these are plain functions.
- [ ] **Step 4: Run** the same command (expected: PASS, read the `Tests` count); then
  `pnpm --filter @waitron/ui typecheck`, `pnpm --filter @waitron/ui lint` and
  `pnpm exec prettier --check packages/ui/src/floor-plan-geometry.ts packages/ui/src/floor-plan-geometry.test.ts packages/ui/src/index.ts`.
- [ ] **Step 5: Mutation** — the bounded run under "Mutation runs" above, on
  `src/floor-plan-geometry.ts`.
- [ ] **Step 6: Commit** — `git commit -s`, e.g. "Floor plan editor: grid geometry — snapping,
  turned boxes, crop and fit, free spots and automatic names (A429 slice 2)".

### Task 2.2: Undo and redo

**Files:**
- Create: `packages/ui/src/history.ts`, `packages/ui/src/history.test.ts`
- Modify: `packages/ui/src/index.ts` (export `UndoHistory`)

Named `UndoHistory`, not `History`, which is the DOM's type for `window.history`. Snapshots are
stored as given; the editor passes immutable values, so nothing is copied here.

**Interfaces:**
- Produces:

```ts
export class UndoHistory<T> {
  constructor(initial: T);
  get current(): T;
  get canUndo(): boolean;
  get canRedo(): boolean;
  /** Makes `state` current and empties Redo. When `mergeKey` equals the previous push's, and no
   * undo, redo or reset came between, `state` replaces the current one instead of adding a step. */
  push(state: T, mergeKey?: string): void;
  /** The new current state, or undefined (and nothing changes) when there is nothing to undo. */
  undo(): T | undefined;
  redo(): T | undefined;
  /** One state, no Undo, no Redo. */
  reset(state: T): void;
}
```

- [ ] **Step 1: Write the failing tests** in `history.test.ts`:

```ts
it("starts with its first state and nothing to undo or redo", () => { /* current "a"; canUndo false; canRedo false; undo() undefined; redo() undefined; current still "a" */ });
it("undoes and redoes in order", () => { /* push b, push c; undo → "b"; undo → "a"; undo → undefined, current "a", canUndo false; redo → "b"; redo → "c"; canRedo false */ });
it("a new push after Undo empties Redo", () => { /* push b; undo; push c: canRedo false; undo → "a" */ });
it("merges pushes that carry the same key", () => { /* push(b, "label:t1"); push(c, "label:t1"): current "c"; undo → "a" */ });
it("does not merge different keys, or a push with no key", () => { /* push(b, "k"); push(c, "x"); undo → "b". push(d); push(e): undo → "d" */ });
it("does not merge across an undo", () => { /* push(b, "k"); undo; push(c, "k"); undo → "a" (a wrong merge would replace "a" and leave nothing to undo) */ });
it("does not merge across a redo or a reset", () => { /* push(b, "k"); undo; redo; push(c, "k"); undo → "b". reset("z"); push(y, "k"); undo → "z" */ });
it("resets to one state", () => { /* push b, push c, undo; reset("z"): current "z", canUndo false, canRedo false */ });
it("keeps every step", () => { /* 500 pushes of 1…500 on 0; 500 undos reach 0; the 501st answers undefined */ });
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/ui exec vitest run src/history.test.ts`.
  Expected: the file fails to load; `./history.js` does not exist.
- [ ] **Step 3: Implement** two arrays (past, future) and the last merge key, cleared by `undo`,
  `redo` and `reset`.
- [ ] **Step 4: Run** the same command (PASS, read the count); typecheck, lint and `prettier --check`
  on the three files as in Task 2.1.
- [ ] **Step 5: Mutation** — the bounded run on `src/history.ts`.
- [ ] **Step 6: Commit** — e.g. "Floor plan editor: an undo history that keeps every step and merges
  typing (A429 slice 2)".

### Task 2.3a: The canvas — drawing and selecting

**Files:**
- Create: `packages/ui/src/components/wt-floor-plan-canvas.ts`,
  `packages/ui/src/components/wt-floor-plan-canvas.test.ts`,
  `packages/ui/src/components/wt-floor-plan-canvas.a11y.test.ts`
- Modify: `packages/ui/src/index.ts` (export the class and its types), `packages/ui/demo/main.ts`
  (the workbench), `docs/developers/design-system.md` (a row in the primitives table, `:534-563`,
  and a short paragraph: what it draws, its three events, that names hide below 28 px)

**Interfaces:**
- Consumes: Task 2.1's `PlanPlacement`, `GRID_SQUARE_PX`, `gridExtent`, `showsName`.
- Produces:

```ts
export interface PlanCanvasTable { key: string; label: string; fixed: boolean; placement: PlanPlacement }
export interface FloorPlanCanvasCopy { label: string; fixed: string; rotate: string } // rotate: "Rotate {name}"
export interface TableSelect { key: string | null }
export interface TableMove { key: string; x: number; y: number }      // Task 2.3b
export interface TableRotate { key: string; rotation: number }         // Task 2.3b
@customElement("wt-floor-plan-canvas")
export class WtFloorPlanCanvas extends LitElement {
  @property({ attribute: false }) tables: PlanCanvasTable[] = [];   // placed tables only
  @property() selected: string | null = null;
  @property({ attribute: false }) copy: Partial<FloorPlanCanvasCopy> = {}; // English defaults "Floor plan", "Fixed", "Rotate {name}"
}
// Events, each a CustomEvent named as below, carrying `detail`, bubbles: true, composed: true:
// wt-table-select (TableSelect), wt-table-move (TableMove, Task 2.3b), wt-table-rotate (TableRotate, Task 2.3b)
```

Behaviour: a scrolling viewport (`part="viewport"`) holds the grid (`part="grid"`), sized
`gridExtent(placements, visible) × GRID_SQUARE_PX`, where `visible` is the viewport's size in whole
squares rounded up (a `ResizeObserver`); its lines are a background drawn from `--wt-color-border`.
Each table is a `<button type="button" part="table">` positioned at `x × 12`, `y × 12`, sized
`width × 12` by `height × 12`, turned with `rotate(<rotation>deg)` about its centre; round tables
get `border-radius: 50%`, rectangles `--wt-radius-sm`. Its background reads
`--wt-color-surface-lifted`, its border `--wt-color-border`, a selected table's border
`--wt-color-primary`, and `aria-pressed` says which is selected. Its accessible name is its label,
plus ", Fixed" (`copy.fixed`) for a fixed table, which also draws a corner marker
(`part="fixed-marker"`). The visible name shows only when `showsName(placement, 12)`. The tables sit
in a `role="group"` named `copy.label`. A click on a table stops the click and sends
`wt-table-select { key }`; a click on empty grid sends `{ key: null }`. Selection is the parent's
to keep: the canvas sends, the parent sets `selected`. The canvas reflects no `disabled`, and its
tables are drawn at the plan's true size, below `--wt-tap-min` when small (slice 2 decision 12).

- [ ] **Step 1: Write the failing tests.** Mount with `mount`/`mountInShadowRoot` from
  `packages/ui/src/test-helpers.ts:11-48`; a token test as `wt-choice-row.test.ts:56-69` does (set
  the token on `host`, read the computed style); the a11y file as
  `wt-floor-canvas.a11y.test.ts:1-71` does, with `mountThemed` and `expectNoA11yViolations` in
  both themes.

```ts
// wt-floor-plan-canvas.test.ts
it("draws each table at its grid place and size", async () => { /* t1 at x 2 y 3 w 8 h 4: offset from the grid's corner 24, 36 px; 96 × 48 px */ });
it("turns a table about its centre", async () => { /* rotation 90: transform matrix of rotate(90deg); transform-origin "48px 24px" */ });
it("draws a round table as a circle when its sides match", async () => { /* round 8 × 8: border-radius 50%; rect: border-radius equals --wt-radius-sm */ });
it("marks a fixed table and says so in its name", async () => { /* fixed t2: fixed-marker present; aria-label "T2, Fixed"; t1: no marker, aria-label "T1" */ });
it("hides a name drawn under 28 px and keeps it as the accessible name", async () => { /* 2 × 2 "Bar 1": no visible text; aria-label "Bar 1"; 3 × 3: text "Bar 1" shows */ });
it("fills the visible area with grid when there are no tables", async () => { /* host 600 × 360 px: grid 600 × 360 */ });
it("draws 8 squares past the furthest table", async () => { /* host 600 px wide, a table at x 100 w 8: grid 1392 px wide */ });
it("a click on a table asks to select it and stops the click", async () => {
  /* mountInShadowRoot; document listener gets wt-table-select { key: "t1" }, bubbles, composed;
     a click listener on the shadow host's parent sees no click */
});
it("a click on empty grid asks to clear the selection", async () => { /* detail { key: null } */ });
it("Enter on a focused table selects it", async () => { /* focus t1's button; userEvent.keyboard("{Enter}") → { key: "t1" } */ });
it("draws the selected table as pressed", async () => { /* selected "t1": aria-pressed "true" on t1, "false" on t2 */ });
it("paints from tokens", async () => {
  /* host sets --wt-color-surface-lifted rgb(1, 2, 3) → table background; --wt-color-primary
     rgb(4, 5, 6) → the selected table's border colour; --wt-color-border rgb(7, 8, 9) appears in
     the grid's computed background-image */
});
it("names the group from its copy", async () => { /* copy { label: "Plano" } → role group named "Plano" */ });

// wt-floor-plan-canvas.a11y.test.ts — describe.each(["light", "dark"])
test("no tables", …); test("tables, none selected", …); test("a table selected, one fixed, one too small for its name", …);
```

- [ ] **Step 2: Run and watch it fail** —
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-plan-canvas.test.ts src/components/wt-floor-plan-canvas.a11y.test.ts`.
  Expected: both files fail to load.
- [ ] **Step 3: Implement** (design-system.md → "Adding a primitive", `:2995-3023`: `baseStyles`
  first, `delegatesFocus`, tokens only), add it to the workbench and the primitives table. Before
  trusting the a11y test, remove the tables' `aria-label` and watch it fail, then restore it.
- [ ] **Step 4: Run** the same command and then `pnpm --filter @waitron/ui exec vitest run src/no-hardcoded-chrome.test.ts`
  (it finds new components itself), `pnpm exec vitest run scripts/style-token-names.test.ts`,
  typecheck, lint and `prettier --check` on the changed files. Expected: all pass.
- [ ] **Step 5: Mutation** — the bounded run on `src/components/wt-floor-plan-canvas.ts`.
- [ ] **Step 6: Commit** — e.g. "Floor plan editor: a canvas primitive that draws the plan's tables
  on a grid and selects them (A429 slice 2)".

### Task 2.3b: The canvas — dragging, nudging, turning and growing

**Files:**
- Modify: `packages/ui/src/components/wt-floor-plan-canvas.ts`, its `.test.ts` and `.a11y.test.ts`,
  the design-system paragraph from Task 2.3a

**Interfaces:**
- Consumes: Task 2.1's `snapToSquare`, `clampToGrid`, `rotationFromAngle`, `gridExtent`.
- Produces: the `wt-table-move` and `wt-table-rotate` events (Task 2.3a's types).

Behaviour: pointerdown on a table starts a drag owned by that pointer (listeners on `window`, as
`wt-floor-canvas.ts:385-434` does); while it moves, the table is drawn at
`clampToGrid(start + snapToSquare(pointer delta))` on each axis, and the grid's extent is worked out
from that drawn place, so the grid grows as the table goes right or down. Release sends one
`wt-table-move { key, x, y }` when the place changed, and nothing when it did not. A pointer cancel
puts the table back and sends nothing; a second pointer is ignored during a drag. Fixed tables move
in the editor like any other (fixed is about today's plan). The arrow keys on a focused table send a
move of one square (prevented and stopped), and nothing at an edge. The selected table shows a
rotation handle (`part="rotate-handle"`, a `<button>` at least `--wt-tap-min` square, named
`copy.rotate` with the table's name), drawn as a SIBLING of the table's `<button>` — a button inside
a button is invalid HTML — and placed above the table's top edge; dragging it sends, on release,
`wt-table-rotate { key, rotation: rotationFromAngle(angle) }`, the angle measured clockwise from
straight up around the table's centre (`atan2(dx, -dy)`); ArrowRight and ArrowLeft on the handle
send ±15, wrapping at 0 and 345.

- [ ] **Step 1: Write the failing tests**, with pointer events dispatched as
  `wt-floor-canvas.test.ts:456-476` does (down on the token, move and up on `window`, one
  `pointerId`) and keys pressed with `userEvent.keyboard` on a focused button:

```ts
it("a drag snaps to whole squares and moves on release", async () => {
  /* t1 at (2, 3): down, move by (+30, +13) px, up → one wt-table-move { key: "t1", x: 5, y: 4 } (30/12 = 2.5 rounds to 3) */
});
it("draws the table where the drag has it before release", async () => { /* after the move, before up: t1's left offset 60 px, top 48 px; no event yet */ });
it("a drag past the top or left edge stops at 0", async () => { /* move by (-100, -100) → { x: 0, y: 0 } */ });
it("a drag that ends where it began sends nothing", async () => { /* move by (+5, +5) px → no wt-table-move */ });
it("the grid grows while a table is dragged right and down", async () => { /* host 600 px; drag t1 by +1440 px → before release the grid is (122 + 8 + 8) × 12 = 1656 px wide */ });
it("a pointer cancel puts the table back and sends nothing", async () => { /* … t1 back at 24, 36 px */ });
it("a second pointer cannot take over a drag", async () => { /* down id 1, down id 2 on t2, move id 2: t2 does not move; up id 1 moves t1 */ });
it("the arrow keys move a focused table one square", async () => { /* t1 (2, 3): ArrowRight → (3, 3); ArrowLeft → (1, 3); ArrowDown → (2, 4); ArrowUp → (2, 2); each keydown defaultPrevented */ });
it("an arrow key at an edge sends nothing", async () => { /* table at (0, 0): ArrowLeft and ArrowUp → no event; at (999, 999): ArrowRight and ArrowDown → none */ });
it("other keys do nothing", async () => { /* "a" → no event, not prevented */ });
it("shows the rotation handle on the selected table only, beside its button", async () => {
  /* selected "t1": one handle, named "Rotate T1", not inside t1's button (button.contains(handle) false); copy.rotate "Girar {name}" → "Girar T1" */
});
it("dragging the handle turns the table in 15° steps", async () => {
  /* release right of the centre → rotation 90; below → 180; at 50° from up → 45; left → 270 */
});
it("the arrow keys on the handle turn by 15° and wrap", async () => { /* rotation 0: ArrowRight → 15, ArrowLeft → 345; rotation 345: ArrowRight → 0 */ });
it("each event bubbles out of a shadow root", async () => { /* mountInShadowRoot; document hears wt-table-move and wt-table-rotate with their details */ });
// a11y file: add "a selected table with its rotation handle" in both themes
```

- [ ] **Step 2: Run and watch them fail** — the Task 2.3a command. Expected: the new cases fail (no
  move or rotate event is sent; no handle is drawn); the 2.3a cases still pass.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the Task 2.3a command, then the same guards as in Task 2.3a. Expected: all pass.
- [ ] **Step 5: Mutation** — the bounded run on `src/components/wt-floor-plan-canvas.ts`.
- [ ] **Step 6: Commit** — e.g. "Floor plan editor: drag a table to the grid, nudge it with the
  arrow keys and turn it with a handle (A429 slice 2)".

### Task 2.4a: The editor's draft

**Files:**
- Create: `apps/dashboard/src/screens/floor-plan-draft.ts`,
  `apps/dashboard/src/screens/floor-plan-draft.test.ts`

Pure functions over the editor's draft; every edit returns a new draft and leaves its input
unchanged, so Task 2.2's history can keep each one.

**Interfaces:**
- Consumes: `FloorPlan`, `FloorPlanSave`, `PlanPlacement` (`apps/dashboard/src/api/client.ts:599-645`);
  `firstFreeSpot`, `NEW_TABLE_SIZE` (Task 2.1).
- Produces:

```ts
export interface DraftTable { key: string; id: string | null; liveTableId: string | null; label: string; seats: number | null; fixed: boolean; placement: PlanPlacement | null }
export interface DraftJoin { key: string; seats: number; tableKeys: string[] }
export interface FloorPlanDraft { tables: DraftTable[]; joins: DraftJoin[] }
export function draftFromPlan(plan: FloorPlan): FloorPlanDraft;                      // keys per slice 2 decision 3
export function saveFromDraft(revision: number, draft: FloorPlanDraft): FloorPlanSave;
/** After a save: each key the answer names becomes that master id, as key and id (decision 4). */
export function rekeyDraft(draft: FloorPlanDraft, ids: Readonly<Record<string, string>>): FloorPlanDraft;
/** Same tables by key with the same values, and the same joins as sets of members with their seats. */
export function sameDraft(a: FloorPlanDraft, b: FloorPlanDraft): boolean;
export function checkDraft(draft: FloorPlanDraft): { key: string; problem: "label_missing" | "label_repeated" } | null;
export function isAdoptable(table: DraftTable): boolean;                                                // id null and liveTableId set (decision 20)
export function patchTable(draft: FloorPlanDraft, key: string, patch: Partial<Pick<DraftTable, "label" | "seats" | "fixed" | "placement">>): FloorPlanDraft;
export function moveTable(draft: FloorPlanDraft, key: string, x: number, y: number): FloorPlanDraft;   // keeps size, shape and rotation; an unplaced table: unchanged
export function rotateTable(draft: FloorPlanDraft, key: string, rotation: number): FloorPlanDraft;
export function placeTable(draft: FloorPlanDraft, key: string): FloorPlanDraft;                         // slice 2 decision 15
export function deleteTable(draft: FloorPlanDraft, key: string): FloorPlanDraft;                        // also from every join; a join left with fewer than 2 goes; an adoptable table: unchanged
export function addTables(draft: FloorPlanDraft, tables: { label: string; seats: number | null; fixed: boolean }[], nextKey: () => string): FloorPlanDraft; // appended, unplaced
export function addJoin(draft: FloorPlanDraft, tableKeys: string[], seats: number, key: string): FloorPlanDraft;
export function removeJoin(draft: FloorPlanDraft, joinKey: string): FloorPlanDraft;
```

- [ ] **Step 1: Write the failing tests** (fixture: master `m1` "T1" placed at (2, 3) 8 × 8 rect
  with live `l1`, master `m2` "T2" unplaced with live `l2`, adoptable `{ id: null, liveTableId: "l9",
  label: "T9" }`, join `j1` of `m1`, `m2` seats 6, revision 3):

```ts
it("keys master tables by id, adoptable ones by their live table, joins by id", () => {
  /* keys ["m1", "m2", "live:l9"]; T9 has id null, liveTableId "l9"; joins [{ key: "j1", seats: 6, tableKeys: ["m1", "m2"] }] */
});
it("sends a save with a key per table and each join as keys", () => {
  /* saveFromDraft(3, draft) toEqual { revision: 3, tables: [{ id: "m1", key: "m1", … }, { id: "m2", key: "m2", … },
     { liveTableId: "l9", key: "live:l9", label: "T9", … }], joins: [{ seats: 6, tableKeys: ["m1", "m2"] }] };
     "liveTableId" in the m1 entry is false; "id" in the l9 entry is false */
});
it("sends a new table with neither id nor live table", () => { /* after addTables: { key: "new:1", label, seats, fixed, placement: null }, no id key, no liveTableId key */ });
it("re-keys a saved draft from the answer's ids", () => {
  /* add "T5" (new:1), join m1 + new:1 as join:1; rekeyDraft(d, { m1: "m1", m2: "m2", "live:l9": "m9", "new:1": "m5" }) →
     T9 { key: "m9", id: "m9", liveTableId: "l9" }; T5 { key: "m5", id: "m5", liveTableId: null }; join:1's tableKeys ["m1", "m5"];
     saveFromDraft of it sends { id: "m9", key: "m9", … } with no liveTableId and { id: "m5", key: "m5", … } */
});
it("counts a draft moved and moved back as unchanged", () => { /* sameDraft(open, moveTable(moveTable(open, "m1", 5, 4), "m1", 2, 3)) true */ });
it("counts a seat, a name, a turn or Fixed as a change", () => { /* each patch → false */ });
it("compares joins as sets", () => { /* j1 with tableKeys ["m2", "m1"] → true; seats 7 → false; a join removed → false */ });
it("counts a deleted table added back as new as a change", () => { /* delete m1, add "T1" with the same values: key "new:1" → false */ });
it("finds an empty or repeated name, first in table order", () => {
  /* T2 "  " → { key: "m2", problem: "label_missing" }; T9 " T1 " → { key: "live:l9", problem: "label_repeated" }; fine → null */
});
it("moves a placed table and keeps its size, shape and turn", () => { /* moveTable(m1, 5, 4) → { x: 5, y: 4, width: 8, height: 8, shape: "rect", rotation: 0 }; input draft unchanged */ });
it("leaves an unplaced table where it is when asked to move it", () => { /* moveTable(m2, 5, 4) → same draft value */ });
it("places a table at the first free spot as an 8 × 8 rectangle", () => { /* placeTable(m2) → m2.placement { x: 11, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 } (m1 spans x 2–10) */ });
it("deletes a table from its joins, and a join left with one table goes", () => {
  /* join m1+m2+new:1: delete new:1 → join m1+m2; join m1+m2: delete m2 → no joins */
});
it("does not delete a table offered for adoption", () => { /* isAdoptable(T9) true, isAdoptable(T1) false; deleteTable(d, "live:l9") → same draft value */ });
it("adds tables unplaced with fresh keys", () => { /* nextKey yields new:1, new:2 → two tables, placement null, id null, liveTableId null, in that order after T9 */ });
it("adds and removes a join", () => { /* addJoin(["m1", "live:l9"], 4, "join:1"); removeJoin("j1") → joins [{ key: "join:1", seats: 4, tableKeys: ["m1", "live:l9"] }] */ });
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-draft.test.ts`.
  Expected: the file fails to load.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command (PASS, read the count); `pnpm --filter @waitron/dashboard typecheck`,
  `pnpm --filter @waitron/dashboard lint`, `prettier --check` on the two files.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: the draft — what it sends, how a save re-keys it,
  when it has changed, and each edit (A429 slice 2)".

### Task 2.4b: The editor page — opening, editing and undo

**Files:**
- Create: `apps/dashboard/src/screens/floor-plan-editor.ts` (`dashboard-floor-plan-editor`),
  `apps/dashboard/src/screens/floor-plan-editor.test.ts`,
  `apps/dashboard/src/screens/floor-plan-editor.a11y.test.ts`
- Modify: `apps/dashboard/src/navigation.ts` — `"floor-plan": { zone: "zone" }` in `children`
  (`:6-27`), which the page needs to read its zone; `apps/dashboard/src/navigation.test.ts` (one
  case); `apps/dashboard/src/i18n/strings.ts` (EN and ES)

**Interfaces:**
- Consumes: `getFloorPlan`, `listZones`, `listTables` (`client.ts:2790`, `:2775`, `:2806`);
  `UndoHistory` (Task 2.2); `wt-floor-plan-canvas` (Tasks 2.3a, 2.3b); Task 2.4a's functions;
  `draftScopeFor`, `saveActionState` (`packages/ui/src/leave-controller.ts:115-147`);
  `UrlStateController` with `dashboardPath`.
- Produces: the page, and the contract its panels use (Tasks 2.5b, 2.5c, 2.6a, 2.6b) — they
  dispatch, bubbling and composed:

```ts
// floor-plan-change: { draft: FloorPlanDraft; mergeKey?: string } — the page pushes it onto its history
// floor-plan-select: { key: string | null }
```

Behaviour: the page reads `zone` from its URL and `back` from the query (slice 2 decisions 1, 2),
then loads the plan, the zone list and the table list; a load failure shows the code's sentence
(`codeMessage(codeOf(error))`) in place of the canvas, with Close. It keeps an
`UndoHistory<FloorPlanDraft>` and the opened draft. Its draft scope is taken in `willUpdate` while
`isConnected` and the plan has loaded, as `canvas-editor-screen.ts:314-337` takes one
(`equal: sameDraft`, `restore` resets the history to the restored draft and clears the selection),
disposed on disconnect, with `requestUpdate()` on reconnect. When its URL controller reports
another zone (the dashboard asks about unsaved changes before the address changes, Task 2.4c), it
disposes the scope, clears the draft, the history and the selection, and loads the new zone; an
answer for the old zone that arrives later is dropped. The heading is the zone's name (decision 9).
The header's `wt-form-actions` holds Close (an `<a href=${back}>` drawn like a secondary button, as
`wt-row-actions.ts:50-78` draws a slotted link), Undo and Redo (secondary, disabled while there is
nothing to undo or redo) and Save (`saveActionState`; this task gives Save its look only, and Task
2.4d its handler). Under the header, decision 16's line. The canvas gets the draft's placed tables
and the selection; `wt-table-move` and `wt-table-rotate` push `moveTable` and `rotateTable`;
`wt-table-select` sets the selection. Undo or Redo that removes the selected table clears the
selection. Strings (EN / ES): `floor_plan_editor.title` "Floor plan" / "Plano de sala";
`floor_plan_editor.undo` "Undo" / "Deshacer"; `floor_plan_editor.redo` "Redo" / "Rehacer";
`floor_plan_editor.first_note` "Your first save updates the till's tables. After that, saved
changes wait for the next business day." / "El primer guardado actualiza las mesas de la caja.
Después, los cambios guardados esperan al siguiente día de actividad."; `floor_plan_editor.note`
"Saved changes reach the till's tables when the next business day starts." / "Los cambios
guardados llegan a las mesas de la caja al empezar el siguiente día de actividad." (owner
2026-10-10: now "Your first save goes live now; later changes, tomorrow." / "Tu primer guardado se
aplica ya; los cambios posteriores, mañana." and "Your changes will go live tomorrow." / "Tus
cambios se aplicarán mañana.", the owner's 2026-10-10 overrides, built as an extra task after 2.5b); Close and Save
reuse `action.close` and `action.save` (`strings.ts:475`, `:548`).

- [ ] **Step 1: Write the failing tests.** Mount with `mountWidget` and a stubbed API, the URL set
  first with `history.replaceState`. A change of address is driven as the dashboard's URL
  controller hears one with no guard installed: `history.pushState` then a `popstate` event
  (`packages/ui/src/navigation-guard.ts:49-60`).

```ts
// floor-plan-editor.test.ts
it("opens the zone the URL names, headed with its name", async () => { /* getFloorPlan("z1"); h1 "Terrace" */ });
it("heads a zone the zone list lacks as Floor plan", async () => { /* listZones → [] → h1 "Floor plan" */ });
it("draws placed tables and leaves unplaced ones off the canvas", async () => { /* canvas.tables keys ["m1"] */ });
it("says what a first save does, and when a saved plan's changes reach the till", async () => { /* revision 0 → first_note text; revision 3 → note text */ });
it("a move from the canvas changes the draft and wakes Save", async () => { /* dispatch wt-table-move { key: "m1", x: 5, y: 4 } from the canvas → canvas.tables[0].placement.x 5; Save variant "primary", enabled */ });
it("Undo puts the move back and quiets Save; Redo brings it back", async () => { /* Undo → x 2, Save "secondary" and disabled, Redo enabled; Redo → x 5, Save "primary" */ });
it("a change after Undo empties Redo", async () => { /* move, Undo, rotate → Redo disabled */ });
it("a turn from the canvas turns the table", async () => { /* wt-table-rotate { key: "m1", rotation: 90 } → placement.rotation 90 */ });
it("selecting a table is not a change", async () => { /* wt-table-select { key: "m1" } → canvas.selected "m1"; Save quiet; Undo disabled */ });
it("takes a panel's change and merges typing", async () => {
  /* dispatch floor-plan-change { draft: patchTable(d, "m1", { label: "T1a" }), mergeKey: "label:m1" } then
     { label: "T1ab" } with the same key; one Undo → label "T1" */
});
it("Undo that removes the selected table clears the selection", async () => { /* select a table added by a floor-plan-change; Undo → canvas.selected null */ });
it("another zone in the address loads that zone afresh", async () => {
  /* move m1, select it; pushState /manage/floor-plan/zone/z2 + popstate → getFloorPlan("z2"); h1 "Bar"; canvas.selected null; Undo disabled; Save quiet */
});
it("a late answer for the zone it left is dropped", async () => { /* z1's read deferred; move to z2 (answers); resolve z1's: h1 still "Bar", canvas shows z2's tables */ });
it("a load failure shows its sentence and no canvas", async () => { /* getFloorPlan rejects { code: "zone.not_found" } → "That zone no longer exists"; no wt-floor-plan-canvas */ });
it("Close links to the way back, or to /manage when it is not a dashboard path", async () => { /* back "/manage/overview" → href "/manage/overview"; back "https://evil.example/" → "/manage"; no back → "/manage" */ });

// navigation.test.ts, as :93-103
it("reads the floor plan editor's zone from its path", () => { /* /manage/floor-plan/zone/z1 → read("zone") "z1" */ });

// floor-plan-editor.a11y.test.ts — describe.each(["light", "dark"]): a loaded plan; a table selected; a load failure
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-editor.test.ts src/screens/floor-plan-editor.a11y.test.ts src/navigation.test.ts`.
  Expected: the two new files fail to load; the navigation case fails (`read("zone")` is null).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts`,
  the dashboard's typecheck and lint, and `prettier --check` on the changed files. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: the page opens a zone's plan and moves and turns
  tables with Undo and Redo (A429 slice 2)".

### Task 2.4c: The editor in the dashboard — its screen and leaving it

**Files:**
- Create: `apps/dashboard/src/screens/floor-plan-editor.unsaved.test.ts`
- Modify: `apps/dashboard/src/dashboard-app.ts` — import beside `canvas-editor-screen.js` (`:70`);
  `"floor-plan"` in `CORE_SCREENS` (`:98-130`); `{ screen: "floor-plan", requiresPermission:
  "venue.configure" }` in `UNLISTED_SCREENS` (`:243-247`); `fill` for `"floor-plan"` as for the
  catalogue (`:1406`; the `.body.fill` rule is at `:596-600`); a `case "floor-plan"` in
  `#renderScreen` beside `case "canvas-editor"` (`:2016-2019`).
  `apps/dashboard/src/dashboard-app.test.ts` (one case). `apps/dashboard/src/screens/floor-plan-editor.ts`
  only if a leave case below finds a fault.

**Interfaces:**
- Consumes: Task 2.4b's page.
- Produces: the screen `floor-plan`, open to a session holding `venue.configure`.

The leave cases mount the whole `dashboard-app` as
`apps/dashboard/src/dashboard-app.backup-unsaved.test.ts:13-60` does, at
`/manage/floor-plan/zone/z1?back=%2Fmanage%2Foverview`, with `venue.configure`, and use an `unload()`
helper as `canvas-editor-screen.unsaved.test.ts:95-99` does.

- [ ] **Step 1: Write the failing tests:**

```ts
// dashboard-app.test.ts, as the "/manage/email" case at :2918-2938
it.each([["manager", "dashboard-floor-plan-editor"], ["supervisor", "dashboard-overview-screen"]])("opens the floor plan editor at /manage/floor-plan/zone/z1 as %s, only with venue.configure", …);

// floor-plan-editor.unsaved.test.ts (whole app)
it("an untouched editor closes without asking", async () => { /* click Close → pathname "/manage/overview"; no question */ });
it("Close asks after a move, and Keep stays with the move", async () => { /* pathname unchanged; m1 still at x 5 */ });
it("Discard on Close leaves and writes nothing", async () => { /* pathname "/manage/overview"; saveFloorPlan not called */ });
it("undoing every change closes without asking", async () => { /* move, Undo, Close → no question */ });
it("a sidebar link asks before leaving a changed plan", async () => { /* … */ });
it("opening another zone's editor asks first, and Discard opens it fresh", async () => {
  /* move; navigationGuardFor(window)!.write(new URL("/manage/floor-plan/zone/z2", location.origin)) → question; Discard → getFloorPlan("z2"); Undo disabled */
});
it("the browser's unload prompt holds a changed plan", async () => { /* unload() true after a move; false after Undo */ });
it("put back after a detached update, the editor still asks before Close discards a change", async () => {
  /* reattachAfterDetachedUpdate(editor) (apps/dashboard/src/widgets/test-helpers.ts:88-97), then move, then Close → question
     — #1422's reconnect case, modelled on recipe-screen.unsaved.test.ts:397-407 */
});
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-editor.unsaved.test.ts src/dashboard-app.test.ts -t "floor plan"`.
  Expected: the path opens the overview, so every case fails.
- [ ] **Step 3: Implement** the registration. With the reconnect case passing, delete the
  `isConnected` check in the page's `willUpdate` and watch that case fail, then restore it.
- [ ] **Step 4: Run** the same command without `-t`, plus `src/screens/floor-plan-editor.test.ts`,
  the dashboard's typecheck and lint, and `prettier --check` on the changed files. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: a dashboard screen for managers that asks before
  leaving unsaved changes (A429 slice 2)".

### Task 2.4d: Saving, and the newer plan

**Files:**
- Modify: `apps/dashboard/src/screens/floor-plan-editor.ts`, `apps/dashboard/src/i18n/strings.ts`
  (EN and ES), `apps/dashboard/src/screens/floor-plan-editor.unsaved.test.ts`,
  `apps/dashboard/src/screens/floor-plan-editor.a11y.test.ts`,
  `docs/developers/design-system.md` (name the editor in the Forms list of pages that follow the
  save rule, `:1759`)
- Create: `apps/dashboard/src/screens/floor-plan-editor.save.test.ts`

**Interfaces:**
- Consumes: `saveFloorPlan` (`client.ts:2795-2803`); `saveFromDraft`, `rekeyDraft` (Task 2.4a).
- Produces, for Task 2.4e: the body last sent (`sent: FloorPlanSave | null`) and the page's one
  message slot, which remembers whether a read or an action set it.

Behaviour: Save returns at once while `saveActionState(scope).unchanged` or while saving (Task 2.4e
adds the editor's own checks before sending). Otherwise it keeps the draft and the body it sends,
`saveFromDraft(revision, draft)`, and sends it. Editing stays open while the save is pending. On
success (decision 4): the saved state is `rekeyDraft(sentDraft, ids)` and is committed as the
scope's baseline; the current draft becomes `rekeyDraft(currentDraft, ids)` and the history is reset
to it, so an edit made while the save was pending is kept and Save stays active when the current
draft differs from what was sent; the selection, and Task 2.4e's `fieldError.key`, are mapped
through `ids` too (a selected `new:1` becomes its master id); `revision` becomes the answer's. Then a
re-read, whose answer replaces the draft only while the scope is not dirty. On
`floor_plan.out_of_date`: decision 5. Any other refusal is Task 2.4e's. A save's answer that arrives
after the page has left, or after another load began, is ignored (a request counter, as
`canvas-editor-screen.ts:832-871` keeps).

The header's message slot (decision 18) carries both a read's failure and an action's, and
remembers which one set it (CLAUDE.md §3; `docs/developers/dashboard-live-updates.md`): a failed
re-read shows its sentence as a read's message, which the next change or the next Save clears; a
read's failure never replaces an action's message; and a read's success clears only a read's
message. Save stays quiet after a failed re-read, since the write succeeded.

New strings: `floor_plan_editor.load_newer` "Load newer plan" / "Cargar el plano más reciente". (Note 2026-10-10: shipped as `floor_plan_editor.reload`, "Reload" / "Recargar", in Task 2.8's look pass.)

- [ ] **Step 1: Write the failing tests** in `floor-plan-editor.save.test.ts` (Task 2.4a's fixture
  plan; a change is made by dispatching `floor-plan-change` from inside the page):

```ts
it("a press that reaches an untouched Save's handler sends nothing and shows nothing", async () => { /* host .click() on Save, as canvas-editor-screen.save-state.test.ts:172-180 */ });
it("Save sends the draft with a key per table and joins as keys", async () => {
  /* move m1 to (5, 4); Save → saveFloorPlan("z1", saveFromDraft(3, the moved draft)) toEqual, with tables[0].placement.x 5 and joins [{ seats: 6, tableKeys: ["m1", "m2"] }] */
});
it("a save marks the sent draft saved at once and reads the plan again", async () => {
  /* answer { revision: 4, ids: { m1: "m1", m2: "m2", "live:l9": "m9" } }; the re-read deferred: Save "secondary", disabled; Undo disabled;
     then the re-read answers: getFloorPlan called twice */
});
it("an edit made while the save is pending is kept, and Save stays active", async () => {
  /* move m1 to (5, 4); Save (deferred); move m1 to (7, 4); the save answers: m1 at x 7; Save "primary" and enabled; Undo disabled;
     Close asks (the scope is dirty against the sent draft) */
});
it("a selected new table keeps its selection under its master id", async () => {
  /* add "T5" (new:1), select it; Save answers ids { …, "new:1": "m5" } → canvas.selected "m5" */
});
it("a failed re-read after a save shows as a read's failure, and the next Save sends master ids", async () => {
  /* add "T5" (new:1); save answers { revision: 4, ids: { …, "live:l9": "m9", "new:1": "m5" } }; the re-read rejects { code: "server.internal" }:
     message "Something went wrong, try again"; Save quiet. Move m5 → the message goes; Save → body revision 4, tables include
     { id: "m5", key: "m5", … } and { id: "m9", key: "m9", … }; no key starts with "new:" or "live:" */
});
it("a read's failure does not replace an action's message", async () => {
  /* a save refused { code: "server.internal" } shows its sentence; a later Load newer plan read that fails leaves the action's sentence in place */
});
it("a re-read answer does not replace a draft changed since the save", async () => { /* re-read deferred; move m1 to x 7; re-read answers x 5: m1 stays at 7, Save loud */ });
it("a save in progress keeps a second press from sending", async () => { /* deferred save; two presses; one call */ });
it("an older copy offers the newer plan, keeping Save available", async () => {
  /* reject { code: "floor_plan.out_of_date", params: { zoneId: "z1", revision: 4 } } → message "Someone else changed this floor plan. Reload it and try again";
     Load newer plan shown; Save enabled */
});
it("Load newer plan replaces the draft and writes nothing", async () => { /* second read has m1 at x 7 → canvas m1 x 7; Save quiet; Undo disabled; saveFloorPlan called once */ });
// floor-plan-editor.unsaved.test.ts (whole app):
it("a departed save's answer cannot change a reconnected editor", async () => {
  /* as recipe-screen.unsaved.test.ts:408 on: deferred save; remove and re-add the editor; resolve; Save still "primary"; the question still opens on Close */
});
it("an accepted save leaves without asking", async () => { /* move, Save, Close → no question */ });
// a11y file: add "an older copy's message with Load newer plan" in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-editor.save.test.ts src/screens/floor-plan-editor.unsaved.test.ts src/screens/floor-plan-editor.a11y.test.ts`.
  Expected: the new cases fail (Save sends nothing).
- [ ] **Step 3: Implement**, and add the editor to design-system.md's Forms list.
- [ ] **Step 4: Run** the same command plus `src/screens/floor-plan-editor.test.ts`, the dashboard's
  typecheck and lint, and `prettier --check` on the changed files. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: Save sends the plan, keeps edits made while it
  was sending, and offers the newer plan when someone else saved first (A429 slice 2)".

### Task 2.4e: Placing a refusal, and the editor's own name checks

**Files:**
- Modify: `apps/dashboard/src/screens/floor-plan-editor.ts`, `apps/dashboard/src/i18n/strings.ts`
  (EN and ES)
- Create: `apps/dashboard/src/screens/floor-plan-editor.refusals.test.ts`

**Interfaces:**
- Consumes: Task 2.4d's `sent` body and message slot; `checkDraft` (Task 2.4a).
- (Note 2026-10-10: the panel takes a list, `fieldErrors`, one per refused field, since slice 2's finish.)
- Produces, for Task 2.6a's panel: the page's `fieldError: { key: string; field: "label" | "seats" |
  "fixed" | "width" | "height" | "shape" | "rotation"; message: string } | null` (a server field
  `tables.<i>.placement.width` becomes `width`, and so on).

Behaviour: before sending, if `checkDraft` fails, the page selects the table, sets `fieldError` on
`label` ("Enter a name." / "Escribe un nombre." for `label_missing`; `table.label_taken`'s sentence
for `label_repeated`) and the generic sentence above the buttons, and sends nothing; Save then stays
disabled while `checkDraft` still fails. On a refusal from the server: decisions 6 and 7,
`tables.<i>` read through Task 2.4d's `sent` body; a `table.label_taken` whose label no draft table
carries, and any refusal not named there, shows its own sentence above the buttons. These are
action messages (Task 2.4d's slot). New strings: `floor_plan_editor.name_missing` "Enter a name." /
"Escribe un nombre."; `floor_plan_editor.booked` "{name}: {message}" (both languages). (Owner
2026-10-10: a `table.booked` refusal now puts the table back, marked, with no message above the
buttons, and the string is now "Booked {date}, {time}" / "Reservada el {date}, {time}" (the owner's
2026-10-10 overrides, built as an extra task after 2.5b).)

- [ ] **Step 1: Write the failing tests** in `floor-plan-editor.refusals.test.ts` (Task 2.4a's
  fixture plan; changes by dispatching `floor-plan-change`). The file imports
  `@waitron/dashboard-modules`, as `apps/dashboard/src/dashboard-app.test.ts` does, so that bookings'
  code sentences, `table.booked`'s among them, are registered
  (`packages/bookings/src/dashboard/strings.ts:104-105`):

```ts
it("a taken name selects its table and shows the generic sentence", async () => {
  /* rename m2 to "Patio 1"; reject { code: "table.label_taken", params: { label: "Patio 1" } } → canvas.selected "m2";
     page fieldError { key: "m2", field: "label", message: "A table with that name already exists" }; message "Correct the highlighted fields to continue."; Save enabled */
});
it("an invalid field selects the table that was sent at its index", async () => {
  /* save deferred (sent tables: m1, m2, live:l9); meanwhile a floor-plan-change deletes m1, so the draft's index 1 is now live:l9;
     reject { code: "floor_plan.invalid", params: { field: "tables.1.seats" } } → selected "m2" (sent tables[1]), fieldError.field "seats" */
});
it("an invalid field of a table deleted since sending selects nothing", async () => {
  /* add "T5" (new:1, sent at index 3); save deferred; delete new:1; reject field "tables.3.label" → no selection; message "Check the floor plan's tables and try again" */
});
it("an invalid field the panel does not show selects the table and shows the refusal's own sentence", async () => { /* field "tables.0.placement.x" → selected "m1"; fieldError null; message "Check the floor plan's tables and try again" */ });
it("a refusal about a join selects nothing and shows its own sentence", async () => { /* field "joins.0.tableKeys" → selection unchanged; message "Check the floor plan's tables and try again" */ });
// Note 2026-10-10: stale — decision 6's owner replacement (the table comes back marked, no message) applies.
it("a booked table the draft deleted is named, and Undo brings it back", async () => {
  /* delete m2; reject { code: "table.booked", params: { tableId: "l2" } } → message "T2: This table has an upcoming booking. Move the booking first"; Undo → m2 back */
});
it("a failure with no field shows the server's sentence and leaves Save enabled", async () => { /* reject { code: "server.internal" } */ });
it("an empty name stops the save, selects its table and keeps Save disabled until fixed", async () => {
  /* m2 label "  "; Save → no call; selected "m2"; fieldError { field: "label", message: "Enter a name." }; Save disabled;
     label "T2b" → Save enabled; fieldError null */
});
it("a repeated name stops the save the same way", async () => { /* l9 renamed "T1" → selected "live:l9"; message under label "A table with that name already exists" */ });
it("the next change to the refused field clears its sentence", async () => { /* after the taken-name refusal, rename m2 → fieldError null; the generic sentence goes */ });
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-editor.refusals.test.ts`.
  Expected: the file's cases fail (a refusal selects nothing and marks no field).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus `src/screens/floor-plan-editor.save.test.ts` and
  `src/screens/floor-plan-editor.test.ts`, the dashboard's typecheck and lint, and `prettier --check`
  on the changed files. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: each refusal points at its table, and a missing
  or repeated name stops Save (A429 slice 2)".

### Task 2.5a: `wt-sheet`

**Files:**
- Create: `packages/ui/src/components/wt-sheet.ts`, `packages/ui/src/components/wt-sheet.test.ts`,
  `packages/ui/src/components/wt-sheet.a11y.test.ts`
- Modify: `packages/ui/src/index.ts`, `packages/ui/demo/main.ts`, `docs/developers/design-system.md`
  (primitives table, `:534-563`, and a short paragraph)

**Interfaces:**
- Produces:

```ts
@customElement("wt-sheet")
export class WtSheet extends LitElement {
  @property() heading = "";
  @property({ type: Boolean, reflect: true }) expanded = false;
}
// Event wt-sheet-toggle: { expanded: boolean }, bubbles: true, composed: true; the toggle's click is stopped.
```

Behaviour: a block with a top border (`--wt-color-border`) and the surface colour
(`--wt-color-surface`). Its toggle (`part="toggle"`, a `<button>` at least `--wt-tap-min` tall,
`aria-expanded`, `aria-controls` naming the body) shows the heading; pressing it flips `expanded`
and sends `wt-sheet-toggle`. The body (`part="body"`, default slot) is hidden while collapsed;
expanded, it scrolls within `60dvh`. Where it docks is its parent's choice. Every spacing reads a
`--wt-space-*` token.

- [ ] **Step 1: Write the failing tests:**

```ts
it("shows only its heading while collapsed", async () => { /* slotted text not visible; toggle text "Tables"; aria-expanded "false" */ });
it("pressing the toggle opens it and tells the page", async () => {
  /* mountInShadowRoot; document hears wt-sheet-toggle { expanded: true }; host.expanded true; aria-expanded "true"; a click listener on the host's parent sees no click */
});
it("pressing it again closes it", async () => { /* { expanded: false } */ });
it("the page can open it", async () => { /* el.expanded = true → body visible; attribute "expanded" reflected */ });
it("names the body it controls", async () => { /* toggle's aria-controls equals the body's id */ });
it("scrolls a long body within 60% of the viewport's height", async () => { /* page.viewport(390, 800); 2000 px of content → body clientHeight 480; scrollHeight > clientHeight */ });
it("its toggle is at least the tap size", async () => { /* toggle height ≥ 44 px (--wt-tap-min) */ });
it("paints from tokens", async () => { /* host sets --wt-color-surface rgb(1, 2, 3) → background; --wt-color-border rgb(4, 5, 6) → top border colour */ });
// a11y file — describe.each(["light", "dark"]): collapsed; expanded with content
```

- [ ] **Step 2: Run and watch it fail** —
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-sheet.test.ts src/components/wt-sheet.a11y.test.ts`.
  Expected: both files fail to load.
- [ ] **Step 3: Implement**; break the toggle's name on purpose and watch the a11y test fail, then
  restore it.
- [ ] **Step 4: Run** the same command, `src/no-hardcoded-chrome.test.ts`, `scripts/style-token-names.test.ts`,
  typecheck, lint, `prettier --check`. Expected: pass.
- [ ] **Step 5: Mutation** — the bounded run on `src/components/wt-sheet.ts`.
- [ ] **Step 6: Commit** — e.g. "A sheet primitive that docks at the bottom of a phone screen and
  opens from its heading (A429 slice 2)".

### Task 2.5b: The tables list, tap to place, and the sheet on a phone

**Files:**
- Create: `apps/dashboard/src/screens/floor-plan-tables-panel.ts` (`floor-plan-tables-panel`),
  `apps/dashboard/src/screens/floor-plan-tables-panel.test.ts`
- Modify: `apps/dashboard/src/screens/floor-plan-editor.ts` (the panel beside the canvas at 600 px
  and over, inside a `wt-sheet` below, decided from the page's own width with a `ResizeObserver`),
  `floor-plan-editor.test.ts`, `floor-plan-editor.refusals.test.ts`, `floor-plan-editor.a11y.test.ts`,
  `apps/dashboard/src/i18n/strings.ts`

**Interfaces:**
- Consumes: Task 2.4a's `placeTable`; `wt-sheet` (Task 2.5a); `wt-button`.
- Produces:

```ts
@customElement("floor-plan-tables-panel")
export class FloorPlanTablesPanel extends LitElement {
  @property({ attribute: false }) draft!: FloorPlanDraft;
  @property() selected: string | null = null;
  @property() zoneName = "";                                                        // Task 2.5c
  @property({ attribute: false }) takenElsewhere: ReadonlySet<string> = new Set(); // Task 2.5c, slice 2 decision 8
  @property({ attribute: false }) nextKey!: () => string;                          // Task 2.5c, the page's new:<n>
}
// sends floor-plan-change and floor-plan-select (Task 2.4b's contract)
```

Behaviour: a heading "Tables", then each draft table as a row button, sorted with numbers in order
(`Intl.Collator(locale, { numeric: true })`), a placed table's row drawn muted and marked
`data-placed`. Pressing an unplaced table sends `placeTable` and selects it; pressing a placed one
selects it. Below 600 px the page puts the panel in a `wt-sheet` whose heading is the selected
table's name, else "Tables"; a refusal that selects a table (Task 2.4e) also expands the sheet.
Strings (EN / ES): `floor_plan_editor.tables` "Tables" / "Mesas".

- [ ] **Step 1: Write the failing tests:**

```ts
// floor-plan-tables-panel.test.ts — draft: m1 "Terrace 1" placed (0, 0) 8 × 8, m2 "Terrace 10" unplaced, m3 "Terrace 2" unplaced, "Terrace bar 3" unplaced
it("lists the tables in numeric order, placed ones muted", async () => { /* rows "Terrace 1", "Terrace 2", "Terrace 10", "Terrace bar 3"; data-placed only on Terrace 1 */ });
it("pressing an unplaced table places it at the first free spot and selects it", async () => {
  /* floor-plan-change: m3.placement { x: 9, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 }; floor-plan-select { key: "m3" } */
});
it("pressing a placed table selects it and changes nothing", async () => { /* select { key: "m1" }; no change event */ });

// floor-plan-editor.test.ts
it("puts the panel beside the canvas at 1280 px and in a collapsed sheet at 390 px", async () => {
  /* page.viewport(1280, 800): aside holds floor-plan-tables-panel, no wt-sheet; page.viewport(390, 844): wt-sheet holds it, expanded false, heading "Tables"; restore the viewport */
});
it("the sheet's heading names the selected table", async () => { /* select m1 → heading "T1" */ });
// floor-plan-editor.refusals.test.ts
it("at 390 px a refusal that selects a table opens the sheet", async () => { /* table.label_taken for m2 → wt-sheet expanded true */ });
// floor-plan-editor.a11y.test.ts: add "the tables list" and "the sheet collapsed and expanded at 390 px", in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-tables-panel.test.ts src/screens/floor-plan-editor.test.ts src/screens/floor-plan-editor.refusals.test.ts src/screens/floor-plan-editor.a11y.test.ts`.
  Expected: the new file fails to load; the page's new cases fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, the dashboard's typecheck and lint, `prettier --check`.
  Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: the tables list, tap to place, and a bottom sheet
  on a phone (A429 slice 2)".

### Task 2.5c: Add tables

**Files:**
- Modify: `apps/dashboard/src/screens/floor-plan-tables-panel.ts`,
  `floor-plan-tables-panel.test.ts`, `floor-plan-editor.ts` (passes `zoneName`, `takenElsewhere`,
  `nextKey`), `floor-plan-editor.a11y.test.ts`, `apps/dashboard/src/i18n/strings.ts`
- Create: `apps/dashboard/src/screens/floor-plan-tables-panel.unsaved.test.ts`

**Interfaces:**
- Consumes: Task 2.4a's `addTables`; Task 2.1's `automaticNames`; `wt-modal`, `wt-number-stepper`,
  `wt-combobox`, `wt-input`, `wt-switch`, `wt-form-actions`.

Behaviour: "Add tables" opens a `wt-modal` (decision 14) with: Tables (`wt-number-stepper`,
`name="table-count"`, 1–100, required), Seats (`wt-number-stepper`, `name="seats"`, 0–999,
clearable, empty meaning none), Names (`wt-combobox`, `name="naming"`, Automatic or Custom, no
search), then for Automatic a Prefix (`wt-input`, `name="prefix"`, the zone's name to start, its
hint the names it will give: "Terrace 11" for one table, "Terrace 11 to Terrace 15" for more), for
Custom one `wt-input` per table (`name="table-name"`, required), and Fixed in place (`wt-switch`,
`name="fixed"`). Add checks each custom name: empty is "Enter a name.", and one repeated in the
batch, already in the draft, or in `takenElsewhere` is `table.label_taken`'s sentence, beside its
field, with the generic sentence in the dialog's `wt-form-actions`; Add then stays disabled until
they are fixed. Automatic names count the draft's names and `takenElsewhere` as used. Add sends
`addTables` and closes; Cancel and Escape add nothing. The dialog's input is its own draft scope,
child of the page's (`savableAtOpen: true`). The page builds `takenElsewhere` from its table list
as decision 8 says. Strings (EN / ES), all `floor_plan_editor.*`: "Add tables" / "Añadir mesas";
"Number of tables" / "Número de mesas"; "Seats" / "Plazas" (its own key, decision 14); "Names" /
"Nombres"; "Automatic" / "Automáticos"; "Custom" / "Personalizados"; "Prefix" / "Prefijo"; "{first}
to {last}" / "De {first} a {last}"; "Name {n}" / "Nombre {n}"; "Fixed in place" / "Fija en su sitio".

- [ ] **Step 1: Write the failing tests** (Task 2.5b's draft, zone "Terrace"):

```ts
// floor-plan-tables-panel.test.ts
it("Add tables opens with one table, four seats and the zone's name as prefix", async () => { /* count "1", seats "4", naming "automatic", prefix "Terrace", hint "Terrace 11", Add primary and enabled */ });
it("the hint gives the first and last names for more than one table", async () => { /* count 5 → "Terrace 11 to Terrace 15" */ });
it("automatic names number on from the highest with the prefix", async () => {
  /* count 3 → added labels "Terrace 11", "Terrace 12", "Terrace 13", seats 4, fixed false, placement null, keys new:1–3 */
});
it("a name used in another zone counts for the numbering", async () => { /* takenElsewhere {"Terrace 40"} → "Terrace 41" */ });
it("custom naming shows one name field per table", async () => { /* count 3, Custom → three wt-input name="table-name", labelled "Name 1"–"Name 3" */ });
it("a custom name in use is refused beside its field", async () => {
  /* names "Patio 1", "Terrace 2" → second field's error "A table with that name already exists"; form message "Correct the highlighted fields to continue."; no change event; Add disabled;
     second name "Patio 2" → error gone, Add enabled */
});
it("a custom name used in another zone, or twice in the batch, is refused the same way", async () => { /* … */ });
it("an empty custom name asks for a name", async () => { /* "Enter a name." */ });
it("Fixed in place adds fixed tables", async () => { /* fixed true on every added table */ });
it("an empty seat count adds tables with no seats", async () => { /* seats null */ });
it("Cancel adds nothing", async () => { /* no change event */ });
// floor-plan-editor.test.ts
it("counts this zone's switched-off tables no draft table follows as taken", async () => {
  /* listTables answers { id: "l7", label: "Terrace 30", zoneId: "z1", active: false } → Add tables' hint "Terrace 31" */
});

// floor-plan-tables-panel.unsaved.test.ts — inside a LeaveController test app, as canvas-editor-screen.unsaved.test.ts:31-44
it("an untouched Add tables closes on Escape without asking", async () => { /* … */ });
it("typed custom names ask before Escape, and Keep keeps them", async () => { /* … */ });
it("a changed count asks before Cancel, and Discard closes without adding", async () => { /* … */ });

// floor-plan-editor.a11y.test.ts: add "Add tables open, automatic" and "Add tables open, custom, with a refused name", in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-tables-panel.test.ts src/screens/floor-plan-tables-panel.unsaved.test.ts src/screens/floor-plan-editor.test.ts src/screens/floor-plan-editor.a11y.test.ts`.
  Expected: the new file fails to load; the new cases fail (no Add tables).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, `scripts/native-form-fields.test.ts`, the dashboard's
  typecheck and lint, `prettier --check`. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: Add tables with automatic or custom names
  (A429 slice 2)".

### Task 2.6a: The selected table's panel — its fields, Place, Remove from plan and Delete

**Files:**
- Create: `apps/dashboard/src/screens/floor-plan-table-panel.ts` (`floor-plan-table-panel`),
  `apps/dashboard/src/screens/floor-plan-table-panel.test.ts`
- Modify: `floor-plan-editor.ts` (the panel above the tables list while a table is selected, given
  `fieldError`), `floor-plan-editor.refusals.test.ts`, `floor-plan-editor.test.ts`, `floor-plan-editor.a11y.test.ts`, `strings.ts`

**Interfaces:**
- Consumes: Task 2.4a's `patchTable`, `placeTable`, `deleteTable`, `isAdoptable`; Task 2.4e's
  `fieldError`.
- Produces:

```ts
@customElement("floor-plan-table-panel")
export class FloorPlanTablePanel extends LitElement {
  @property({ attribute: false }) draft!: FloorPlanDraft;
  @property() tableKey = "";
  @property({ attribute: false }) fieldError: { field: string; message: string } | null = null;
  @property({ attribute: false }) nextJoinKey!: () => string;   // the page's join:<n>, Task 2.6b
}
// sends floor-plan-change (merge keys "<field>:<tableKey>" for typed fields) and floor-plan-select { key: null } after Delete
```

Behaviour, for the selected table: Name (`wt-input`, `name="table-name"`, required); Seats
(`wt-number-stepper`, `name="seats"`, 0–999, clearable); Fixed in place (`wt-switch`,
`name="fixed"`); for a placed table, Shape (`wt-combobox`, `name="shape"`, Rectangle or Round, no
search), Width and Height (`wt-number-stepper`, `name="width"`, `name="height"`, 1–99) and Rotation
(`wt-combobox`, `name="rotation"`, 0° to 345° in 15° steps, no search) — the canvas handle is the
pointer's way, this the keyboard's; Place (an unplaced table) or Remove from plan (a placed one,
`patchTable(placement: null)`); Delete (danger, no question: Undo brings it back, spec §4), not
shown for a table offered for adoption (decision 20). `fieldError` shows under the field it names.
Strings (EN / ES), all `floor_plan_editor.*`: "Name" / "Nombre"; "Seats" (Task 2.5c's key); "Shape" /
"Forma"; "Rectangle" / "Rectángulo"; "Round" / "Redonda"; "Width" / "Ancho"; "Height" / "Largo";
"Rotation" / "Giro"; "Place" / "Colocar"; "Remove from plan" / "Quitar del plano".

- [ ] **Step 1: Write the failing tests:**

```ts
// floor-plan-table-panel.test.ts — Task 2.4a's fixture, m1 selected
it("shows the selected table's values", async () => { /* name "T1", seats "4", fixed off, shape "rect", width "8", height "8", rotation "0" */ });
it("typing a name sends one merged change", async () => { /* typing "a" then "b" → two floor-plan-change events, mergeKey "label:m1", last label "T1ab" */ });
it("an empty seat count sends no seats", async () => { /* clear → seats null */ });
it("Fixed in place, shape, width, height and rotation each send their change", async () => { /* fixed true; shape "round"; width 10; height 6; rotation 45 */ });
it("an unplaced table offers Place and no shape or size", async () => { /* select m2: no shape/width/height/rotation fields; Place → m2 placed at the first free spot */ });
it("Remove from plan makes the table a spare", async () => { /* placement null */ });
it("Delete removes the table and clears the selection", async () => { /* change: no m1, j1 gone (it had two tables); select { key: null } */ });
it("a table offered for adoption has Remove from plan but no Delete", async () => {
  /* live:l9 placed by a change: Remove from plan shown, no [data-test=delete]; unplaced: Place shown, still no Delete */
});
it("shows a refusal under the field it names", async () => { /* fieldError { field: "seats", message: "…" } → seats stepper error; name field none */ });
// floor-plan-editor.refusals.test.ts
it("a taken name from Save shows under the table's name field", async () => { /* completes Task 2.4e's case: the panel's name field shows "A table with that name already exists" */ });
// floor-plan-editor.test.ts
it("Undo of a Delete brings back the table and its join", async () => { /* … */ });
// floor-plan-editor.a11y.test.ts: add "a placed table's panel", "an unplaced table's panel", "a refusal under a field", in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-table-panel.test.ts src/screens/floor-plan-editor.refusals.test.ts src/screens/floor-plan-editor.test.ts src/screens/floor-plan-editor.a11y.test.ts`.
  Expected: the new file fails to load; the new page cases fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus `src/screens/floor-plan-editor.test.ts`,
  `scripts/native-form-fields.test.ts`, the dashboard's typecheck and lint, `prettier --check`.
  Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: the selected table's name, seats, shape, size,
  turn, Place, Remove from plan and Delete (A429 slice 2)".

### Task 2.6b: The selected table's joins

**Files:**
- Modify: `apps/dashboard/src/screens/floor-plan-table-panel.ts`, `floor-plan-table-panel.test.ts`,
  `floor-plan-editor.ts` (passes `nextJoinKey`), `floor-plan-editor.a11y.test.ts`, `strings.ts`
- Create: `apps/dashboard/src/screens/floor-plan-table-panel.unsaved.test.ts`

**Interfaces:**
- Consumes: Task 2.4a's `addJoin`, `removeJoin`; `wt-modal`, `wt-combobox`, `wt-number-stepper`.

Behaviour: under the selected table's fields, Joins: each join this table is in as "with T2 ·
seats 6" and Remove, then Add join, which opens a `wt-modal` with Tables (`wt-combobox multiple`,
`name="join-tables"`, the zone's other draft tables) and Seats (`wt-number-stepper`,
`name="join-seats"`, 1–999, required); its Add waits, quiet and disabled, until at least one table
and the seats are chosen, and its input is a draft scope of its own. Strings (EN / ES), all
`floor_plan_editor.*`: "Joins" / "Uniones"; "with {tables} · seats {seats}" / "con {tables} ·
{seats} plazas"; "Add join" / "Añadir unión".

- [ ] **Step 1: Write the failing tests:**

```ts
// floor-plan-table-panel.test.ts — m1 selected
it("lists the table's joins and removes one", async () => { /* "with T2 · seats 6"; Remove → joins [] */ });
it("Add join waits for a table and the seats", async () => {
  /* open: Add "secondary", disabled; choose T9 → still disabled; seats 4 → "primary", enabled; Add → join { tableKeys: ["m1", "live:l9"], seats: 4, key: "join:1" } */
});
it("Add join offers the zone's other tables only", async () => { /* options T2, T9; not T1 */ });
// floor-plan-table-panel.unsaved.test.ts — inside a LeaveController test app: Add join untouched Escape closes; a chosen table asks first, Keep keeps it
// floor-plan-editor.a11y.test.ts: add "a table with a join" and "Add join open", in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-table-panel.test.ts src/screens/floor-plan-table-panel.unsaved.test.ts src/screens/floor-plan-editor.a11y.test.ts`.
  Expected: the new file fails to load; the join cases fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus `src/screens/floor-plan-editor.test.ts` and
  `src/screens/floor-plan-editor.refusals.test.ts`, `scripts/native-form-fields.test.ts`, the
  dashboard's typecheck and lint, `prettier --check`. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: a table's saved joins, with Add join and Remove
  (A429 slice 2)".

### Task 2.7: The entry point

**Files:**
- Modify: `packages/venue-service/src/dashboard/department-zones.ts` (the zone panel's link block,
  `:390-404`), `packages/venue-service/src/dashboard/strings.ts` (EN beside
  `venue.zone_opening_hours`, `:42`; ES beside `:733`),
  `packages/venue-service/src/dashboard/department-zones.test.ts`,
  `packages/venue-service/src/dashboard/department-zones.a11y.test.ts`,
  `docs/developers/design-system.md` (one sentence under "Departments and zones", `:3498`)

**Interfaces:**
- Produces: a link on the zone panel; no new read.

Behaviour (slice 2 decision 17): in the active zone's block, beside the Opening hours link
(`department-zones.ts:396-402`), a second link
`<a data-test="zone-floor-plan" href="/manage/floor-plan/zone/<zoneId>?back=<this page's address>">`
reading "Edit floor plan" / "Editar plano de sala". The way back is the department page's zone
address (`/manage/venue-operations/department/<departmentId>/view/zones/zone/<zoneId>`, the form
`department-settings.ts:533` builds). A module links to a core screen by address, as
`prep-stations-screen.ts:1139` links to `/manage/devices`. It reads nothing, so the request-recording
assertions — `department-zones.test.ts:87-89` with its `toEqual` at `:116-124`, and
`department-zones-hours.test.ts:148-163` — stay as they are; the review that asked to stub the plan
read for them did so for a menu that read the plan, which this task no longer builds.

- [ ] **Step 1: Write the failing tests** in `department-zones.test.ts`, choosing the zone by setting
  `el.zone` (pressing a zone button only sends `zone-change`, `department-zones.ts:217-228`):

```ts
it("the zone panel links Edit floor plan to the editor with the way back", async () => {
  /* mount("z2") → [data-test=zone-floor-plan] href "/manage/floor-plan/zone/z2?back=%2Fmanage%2Fvenue-operations%2Fdepartment%2Fd1%2Fview%2Fzones%2Fzone%2Fz2"; text "Edit floor plan" */
});
it("follows the zone the page names", async () => { /* el.zone = "z1"; await update → href names z1 in both places */ });
it("a disabled zone shows no floor plan link", async () => { /* as the disabled-zone case at :165 on: no [data-test=zone-floor-plan] */ });
it("the zone's ⋮ menu stays Rename, Move and Disable", async () => { /* wt-row-actions holds no floor plan link */ });
it("names the link in Spanish", async () => { /* setLocale("es") → "Editar plano de sala" */ });
// department-zones.a11y.test.ts: the active zone's panel with both links, in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/department-zones.test.ts src/dashboard/department-zones.a11y.test.ts`.
  Expected: no `[data-test=zone-floor-plan]` link.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, `src/dashboard/department-zones-hours.test.ts`,
  `src/dashboard/department-zones.unsaved.test.ts`, `pnpm exec vitest run scripts/module-seams.test.ts`,
  the package's typecheck and lint, `prettier --check`. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Departments: a zone's panel links to its floor plan editor (A429
  slice 2)".

### Task 2.8: Look

**Files:** none committed. A throwaway `apps/dashboard/src/screens/floor-plan-editor.look.test.ts`
is written, run and deleted (slice 2 decision 19). Screenshots go to
`/Users/clintongormley/waitron-campaign/a429-2-shots/`, outside the repository: `page.screenshot`
is given that literal absolute path (a `~` is not expanded), or, if Vitest refuses a path outside
the package, the screenshots land in the package's git-ignored `__screenshots__` folder and are
copied there with `cp`, then removed from the package.

Mount the editor as Task 2.4b's tests do, with fixture plans: an empty zone (no tables at all), a
zone like the demo seed's terrace (a dozen placed tables, two fixed 2 × 2 stools, one turned 45°,
a join), a table selected, Add tables open in custom naming, and a refusal shown (`table.label_taken`
under a name, and `floor_plan.out_of_date` with Load newer plan). Take each in English and Spanish
(`setLocale`), light and dark (`mountWidget`'s `theme`), at 1280 × 800 and 390 × 844
(`page.viewport`), the sheet both collapsed and expanded at 390, named
`<state>-<lang>-<theme>-<width>.png`. Also take the department page's zone panel with its link, in
both languages and themes, from a venue-service test file written and deleted the same way.

- [ ] **Step 1:** Write the throwaway files and run them
  (`pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-editor.look.test.ts`).
  Expected: every screenshot exists (`ls /Users/clintongormley/waitron-campaign/a429-2-shots/ | wc -l`
  equals the count taken).
- [ ] **Step 2:** Open each screenshot and look: text cut off or overlapping, a name drawn on a
  token too small for it, the header's buttons wrapping badly at 390 px, the sheet covering the
  selected table, contrast in dark, Spanish strings longer than their space, product text that could
  be shorter where its meaning is plain (owner rule).
- [ ] **Step 3:** Fix what the look found, each fix test-first in the task file it belongs to (a
  failing assertion, then the change), and rerun that file.
- [ ] **Step 4:** Delete the throwaway files and any screenshots left in the package (`git status`
  shows none of them) and run every slice 2 test file named above, the guards named above, and the
  three packages' typecheck and lint.
- [ ] **Step 5: Commit** the fixes, if any — e.g. "Floor plan editor: fixes from looking at it in
  both languages, both themes, on a phone and a laptop (A429 slice 2)", the message listing what was
  looked at and where the screenshots are.

**Slice 2 done when:** the focused tests above pass; `/finish-branch` runs the full wave; CI is green
on the head (`ui`'s mutation floor runs only weekly, so the per-file Stryker runs above are the
check); design-system.md names both primitives and the editor; the backlog's A429 entry says slice
2 landed and what it left.

## Slice 3 — the till's map (spec §5)

> Owner overrides, 2026-10-10 (A472): the floor screen sizes the map to the zone's cropped
> proportions, with a viewport height cap; Bill requested chips use the map's purple; the pin's
> swatch follows its displayed signal; a single-table sheet says "Table 9" / "Mesa 9"; Guests has
> no placeholder. The 4-second notice stays as built. These supersede the corresponding slice 3
> defaults below.


Branch `feat/floor-plan-till-map`, after slice 2 (landed as #1506). Expanded to step level on
2026-10-10, unattended, and revised the same day on a fresh-context review's findings; every
`file:line` in this slice was read at `main` `28f150197` and checked again at `f18ff0767` (#1507,
which changed none of the cited code files; only the backlog's line numbers moved).

What the slice builds: a gesture recogniser and a map primitive in `packages/ui`
(`gestures.ts`, `wt-floor-map`), the table fill colours as tokens, and, on the till, the floor screen
drawing a planned zone on the new map, the seat dialog's seats placeholder, a 15-second re-read, a
details sheet, and on the order screen a flash notice and a status pin. A zone with no today's plan
keeps the old map, tray and Edit plan (the plan's decision 2); three changes reach every zone: the
seat dialog's new placeholder (decision 12), the app's rule for which table read wins (decision 13),
and the order screen's status pin and flash notice, which show for any party the floor read lists
(decision 16).
Nothing on the server changes.

**A182** (retire canvases) had not started at `f18ff0767`: the backlog says "Nothing has carried
that out" (`docs/backlog.md:2403-2404`). The floor stays a card in the canvas grid
(`apps/till/src/widgets/card-grid.ts:470-480`). If A182 has started when this slice is dispatched,
the driver reads that branch first and moves this slice's floor-screen tasks onto it.

**A414.** The floor screen's `.screen` drops its side padding at phone width
(`apps/till/src/screens/till-floor-screen.ts:80-91`), and
`apps/till/src/screens/device-screens.phone-margin.test.ts:74-86` (the floor row) and `:137-155`
(the loop) hold it. This slice keeps the `.screen` selector and adds a planned-zone row to that
file (Task 3.3b), so the case stays where it is.

**What earlier slices built that this slice works with** (read, not run):

- The till's table-state answer carries `today` (`apps/till/src/api/client.ts:1831-1849` for
  `TodayPlacement` and `TableToday`, `:1899-1900` on `TableState`; the server's twin at
  `apps/server/src/working-order.ts:6986-6994`). A taken-off table's `placement` is null
  (`readTodayTables`, `working-order.ts:7245-7283`, at `:7274`), and its `takenOff` is true.
- `GET /api/tables/state` runs the day's reset and the catch-up before it reads, and answers only
  the device profile's zones (`apps/server/src/till-api.ts:2186-2198`). `listTablesWithState` lists
  only tables whose `dining_tables.active` is true (`working-order.ts:7166`), so a table a reset hid
  is not in the answer at all.
- A live table that was never in a plan gets no reset row (`targetsFromMaster` skips it,
  `apps/server/src/floor-reset-plan.ts:141`), so in a zone with a master plan such a table has
  `today: null` beside tables that have rows (the plan's decision 17).
- A reset copies no merges: today's joins are written only by slice 4's merge routes, and
  `floor-today-store.ts` only reads and deletes them (`:370-376`; `leaveMerges`,
  `apps/server/src/floor-today-merges.ts:9`). So until slice 4, a merge reaches the map only from a
  test fixture; the map draws it anyway (spec §5), and slice 4's look pass sees a real one.
- Every existing floor-screen fixture sets `today: null` (`till-floor-screen.test.ts:40`,
  `.parties.test.ts:29`, `.signals.test.ts:52`, `.a11y.test.ts:40`, `.unsaved.test.ts:29`), so the
  existing cases keep exercising the old view.
- Slice 2's geometry gives `cropToTables` (two-square margin), `fitScale`, `rotatedRect`,
  `snapToSquare`, `clampToGrid` and `showsName` (`packages/ui/src/floor-plan-geometry.ts:39-95`,
  `:154-156`). `wt-floor-plan-canvas` follows a drag with listeners on `window`
  (`packages/ui/src/components/wt-floor-plan-canvas.ts:534-611`). `wt-sheet` is a bar drawn in the
  page's flow, docked by its parent (`packages/ui/src/components/wt-sheet.ts:7`), not an overlay.
- The till re-reads the floor on tab select (`#onTabSelect`, `apps/till/src/till-app.ts:4979`) and on
  the floor screen's `floor-refresh` event (`:5014-5027`, listener `:9026`); `#refreshFloor` assigns
  whatever answer comes back, in any order. The station and expo screens already re-read every 15
  seconds from their own `setInterval` (`till-station-screen.ts:55`, `:332`; `till-expo-screen.ts:63`).
- The till's idle logout restarts on a `pointerdown` or `keydown` that reaches the app's host
  (`#onInteraction`, `till-app.ts:1380`, listened for at `:1401-1402`, calling
  `SessionActivity.noteInteraction`, `apps/till/src/session-activity.ts:93-95`), and when
  `SessionActivity.configure` re-arms it (`session-activity.ts:72-78`, called through
  `#configureSessionActivity` at `till-app.ts:2428`, `:2566` and `:8619`); no table read restarts
  it. On the server, the till's session lookup has no idle expiry (it matches the token and an
  unended session, `apps/server/src/till-session.ts:113`), and a request not marked passive records
  a device sighting at most once a minute (`:117-118`; `sightingDue` and `recordSighting`,
  `apps/server/src/device-session.ts:276-300`). So the 15-second re-read keeps no waiter signed in,
  and **the map must never stop a `pointerdown` or `keydown`**: the `wt-*` rule's "stop the
  triggering event" applied to them would log out a waiter who only uses the map.
- `wt-toast` closes itself after `duration` ms, or when its message or close button is pressed, and
  pauses while hovered or focused (`packages/ui/src/components/wt-toast.ts:62`, `:94-101`, `:123-134`).

### Slice 3 decisions (added at expansion)

Each is the default this slice builds; the owner may override any at review. Each says what it costs
if it is wrong.

1. **A zone is drawn on the new map when any table the till lists in it has a today's row**
   (`today !== null`); otherwise the floor screen draws the old canvas, tray and Edit plan as today.
   Cost if wrong: none expected; a zone with a master plan always has rows once its first save ran.
2. **In a planned zone, the map draws the tables with a place on today's plan; the list lists those
   plus every table that must stay reachable** — one a party holds, one with a delivery on its way,
   one needing clearing, even without a place, and a never-planned table (`today: null`, decision
   17). Taken-off tables and free spares appear in neither. In map view the listed tables without a
   place sit in the existing tray under the map ("Unplaced", `floor.unplaced`). Cost: a free spare
   is out of reach until slice 4's Add a spare table.
3. **Edit plan is hidden while a planned zone shows.** Its placement writes move the old columns,
   which the new map does not read. Cost: none; slice 5 removes the editor.
4. **The stand-in status set.** Fill, most urgent first: needs clearing; bill requested (a
   `bill_requested` signal); seated (a party holds it, or a delivery is on its way); reserved (free,
   with a booking today); free. Dot, at most one: forgotten (`timingBand` forgotten) before ready
   (`readyToServe > 0`, which counts dishes the pass has sent too). A merge shows its most urgent
   member's fill and dot. Cost: none lasting; A267 replaces the set.
5. **The fills are ten new tokens in `packages/ui-core/src/tokens/colors.css`**,
   `--wt-color-table-<fill>` and `--wt-color-on-table-<fill>` for `free`, `seated`, `bill`,
   `clearing` and `reserved`, beside the calendar's day colours. The dots read
   `--wt-color-success` (ready) and `--wt-color-danger` (forgotten) on a `--wt-color-surface` ring,
   and every table's outline is `--wt-color-field-line`. Starting values are in Task 3.2a; its
   contrast test decides. Cost: a retheme later, in one file.
6. **The map's fill and dot names (`FloorMapFill`, `FloorMapDot`) live in `packages/ui`**, and the
   till maps its table state onto them (`apps/till/src/state/floor-map.ts`). Cost: A267 renames
   them in two places.
7. **Gestures.** A touch or pen tap acts on release at once. A mouse click on a table waits 300 ms
   for a second click; a double-click opens the details sheet instead. Two taps count as a double
   tap within 300 ms and 24 px. A press held 500 ms, moving under 8 px, marks the table held, and
   its release opens the details sheet: details open on release, not at 500 ms, so that slice 4 can
   turn a hold into a drag. A press that moves 8 px or more before the hold pans the map, wherever
   it started. Once two fingers have pinched, nothing else happens until every finger lifts.
   Right-click, the ContextMenu key and Shift+F10 also open details (the keyboard's way; slice 4's
   Join with… is in that sheet), each exactly once: Shift+F10 is handled on `keydown`, because macOS
   sends no `contextmenu` for it (the review's probe). Whether a `contextmenu` still follows a
   prevented Shift+F10 `keydown` on Linux was not measured (the review saw a prevented ContextMenu
   key suppress it on macOS), so swallowing the next `contextmenu` after Shift+F10 is a safeguard. A mouse press with Ctrl held starts no gesture, so on macOS, where Ctrl+click
   sends `contextmenu`, it opens details; elsewhere a Ctrl+click does nothing. Cost: mouse users wait
   300 ms for a table to open.
8. **The view.** The map fits the zone's crop when it first draws tables, when `fitKey` (the zone)
   changes, on a double tap on empty space, and on a resize unless the person has panned or zoomed
   since. A re-read keeps the view. Zoom runs from half to four times the fitted size; a pan stops
   with the crop's centre at the map's edge. The mouse wheel pans; Ctrl+wheel, which is also what a
   laptop trackpad's pinch sends, zooms ×2 per 100 of `deltaY` about the pointer. A focus a press
   gives pans nothing; keyboard movement between tables is decision 18's. There is no Fit button.
   Cost: a keyboard user cannot zoom.
9. **Drawing.** No grid lines on the till's map. A single table shows its name when its own
   shorter side (width or height, before turning) is 28 px or more, the plan's decision 11. A merge
   is one button covering its members' turned boxes, its name shown when that union box's shorter
   side is 28 px or more, labelled with its tables in number order joined by "+", naming a first
   word the tables share once, as `partyTablesName` does with ", "
   (`packages/shared/src/party-name.ts:7-17`): "Terrace 4+5", "4+10", "Bar 1+Stool 2". The map has
   no `delegatesFocus`, unlike design-system.md → "Adding a primitive" item 4 (`:3053-3056`): it is a
   container of table buttons, and the review's probe in headless Chromium 153 found that a click on
   empty space in a `delegatesFocus` host focused its first button. Its host is `overflow: clip`, not
   `hidden`, which the same probe found the browser scrolled when an off-screen table took focus.
   Pressing a merge sends the first member's id (seating every
   member is slice 4's, the plan's decision 18). Tables smaller than `--wt-tap-min` stay their true
   size, as in the editor (slice 2 decision 12); the list is the tap-sized way in. Cost: a small
   stool is hard to hit on a phone until zoomed.
10. **The map's height on the floor screen is `65dvh`, never under six tap heights.** Cost: the look
    pass may change one rule.
11. **`wt-table-drag-end` is built here, and nothing listens until Task 4.4.** During a hold-drag
    the table is drawn under the finger, snapped to whole squares; release sends
    `{ tableId, x, y, targetId }` and the table is drawn back where `tables` puts it. Cost: a held
    table that is dragged springs back with no message until slice 4.
12. **The seat dialog's placeholder** is the table's seats for today ("6 seats"; a merge's
    `joinSeats`), else the old `capacity` in a zone with no plan, else "Covers". It replaces the
    current hint "Optional. Leave it empty if you don't know yet." wherever the dialog is used
    (listed under "Behaviour this plan removes"); the label stays "Guests" and the field stays
    optional and unmarked. Cost: the word "optional" is no longer said.
13. **The 15-second re-read is the floor screen's**, only while a planned zone's map shows (not the
    old map, not the list), and it asks through the existing `floor-refresh` event. In the app every
    table read takes a number as it starts, and an answer is applied only when its number is higher
    than the last applied one; `#refreshFloor` answers true when its own answer or a newer one was
    applied, because the two callers that use its answer read `this.tables` straight after
    (`#retakePartyFromFloor`, `till-app.ts:5308`; Move a bill, `:7074-7076`); its other seven calls
    (`:4907`, `:4998`, `:5015`, `:5172`, `:7401`, `:7973`, `:8595`) ignore the answer. So a poll that answers late never replaces
    an action's newer read, and an action's read is never dropped because an older poll answered
    first. Cost: a list view and the old map go on reading only on tab select and after actions.
14. **The details sheet is a `wt-dialog`** (the till's dialogs all are; `wt-sheet` is an in-flow bar),
    opened from the map and from the order screen's status pin. It saves nothing, so it takes no
    draft scope and has no `*.unsaved.test.ts`. The list view's cards keep their details inline, as
    today, and do not open it. Cost: none.
15. **The flash notice is a `wt-toast`** (4 s) at the top of the window, placed by the equipment
    toast's own rule (`till-app.ts:1078-1083`: fixed, `--wt-space-3` from the sides, below the safe
    area, `z-index: 10`), shown when the order screen draws a party whose table has dishes ready, a
    forgotten order or a bill requested, and again only when the party changes. When the equipment
    toast is open too, the two sit in the same place at the same `z-index`, and the notice, later in
    the page (the toasts are drawn at `till-app.ts:9111-9131`, the tab shell holding the order screen
    at `:9299-9340`, and neither the shell's `.region` nor its `.drill`, `tab-shell.ts:182-207`, sets
    a `z-index` or a transform), is painted over it for its 4 s; the equipment toast stays until
    dismissed (`.duration=${0}`, `:9125`) and shows again when the notice goes (read, not run; the
    look pass photographs both open). Cost: where the order screen stays mounted (the canvas
    layout's order card), reopening the same party shows no second notice.
16. **The status pin and the notice live in one new till widget, `till-table-status`**, placed in the
    order screen's `.head-actions` before the Tab button, so the 5,036-line order screen gains one
    element. The pin is hidden when the order has no party or the floor read has no row for it. The
    pin is as fresh as the app's last table read: the 15-second re-read runs only while a planned
    map shows, so on an order screen the pin changes after the order screen's own actions re-read
    the floor, not while it sits open. Cost: a status that changed while the order was open (a dish
    made ready) shows only after the next action.
17. **The look pass photographs from Vitest browser files that are never committed**, with fixtures,
    as slice 2 decision 19 did.
18. **One table is in the Tab order; the arrow keys move between tables** (a roving tab stop, the
    controller's ruling on the re-check). The tab stop is the table last focused, while the map still
    draws it, else the first in reading order (by the top of its box, then its left). ArrowRight and
    ArrowDown move to the next table in reading order, ArrowLeft and ArrowUp to the previous one,
    Home and End to the first and last; each move pans the target into view by the least distance
    and then focuses it with `focus({ preventScroll: true })`. The reason: with `overflow: clip` the
    map cannot scroll, so Tab-focusing an off-edge table scrolled the nearest scrolling parent
    instead (the review's probe in Chromium 153: the map's box stayed at 0 and the outer div moved
    300; panning inside `focusin` did not undo it), and the till's tab shell body is such a parent
    (`overflow: auto`, `apps/till/src/widgets/tab-shell.ts:190-194`). Cost if wrong: keyboard users
    move between tables with the arrow keys, not Tab; and Tab into the map lands on the tab-stop
    table wherever the view has left it, so after a pan that put it off-screen, Tab can still scroll
    the parent, which an arrow key never does; and because the arrow keys focus with
    `preventScroll`, a table arrowed to in a part of the map the tab shell's body has scrolled out
    of view stays off-screen.

**As built (2026-10-10).** The controller's rulings during the build; where one differs from a
decision above or a task's text, the ruling is what was built. Where a task cites these by line
number, read them by name: the till's idle listeners are `till-app.ts`'s `#onInteraction`
pointerdown and keydown listeners; design-system.md → "Adding a primitive", item 4
(`delegatesFocus`); the backlog's "Nothing has carried that out" sentence.

- Decision 2 reads "reachability wins": a taken-off table a party holds, with a delivery on its way
  or needing clearing is listed, not drawn.
- Decision 8's double tap refits only when both taps land on empty space, for touch and mouse
  alike.
- Decision 12's "old capacity" applies to any table with no today's row, a never-planned table in
  a planned zone included (`seatsFor`).
- Decision 18's arrow-key pan stays within the pan limit (decision 8), so at high zoom the focused
  table can stay off-screen; the map has no composite-widget role, and each table stays a button.
- A merge's words take the fill's words from the member that supplied the fill and the dot's count
  from the member that supplied the dot; nothing is summed (`statusWords`, `statusPin`). Its members
  are grouped over every table in the zone, drawn or not.
- `mergeLabel` is exported from `@waitron/ui`, and `mapLabel` only from the component's file; the
  details sheet's heading is `mergeLabel` over the labels of the table's merge, the map's own
  naming, so both read "Terrace 4+10".
- The sheet's kitchen line counts each dish once (to serve, ready, en route), and leaves out the
  ready count when a station's ready chip shows. It drops the party-name line when the name is null
  or equals the heading, adds a "Needs clearing" line, says "Free" only with no lines and no chips,
  and shows a forgotten wait's chip.
- The status pin keeps its sheet open across re-reads, passing it the party's first row, and closes
  it on `details-close`.
- The floor screen also starts the 15-second re-read on re-attach when its last render drew a
  planned map; a table read's answer is applied unless a read that started after it was applied
  first (`#applyTables`).
- `wt-floor-map` finds a table with `closest("[part=table]")`; any button other than 0 starts no
  gesture; a reused pointer id is handled. A touch or pen double tap on the table already tapped
  sends nothing; one on a different table counts as a tap on it.
- When a table is wider or taller than the map, an arrow key's pan moves nothing if the table
  already covers the map that way, else the least distance that leaves no gap.
- The notice and the pin say "<n> ready", not "<n> ready to serve".
- Decision 8's wheel reads `deltaMode`: a line is 16 px, a page the map's width or height.
- A finger pressed during a pinch, or once it is spent, keeps the gesture active until it lifts,
  and its cancel sends no `cancel`.
- Decision 13's re-read sends `floor-refresh` with `{ poll: true }`. The app skips a tick while
  the last poll's read is out, cuts that read off at `FLOOR_POLL_LIMIT_MS` (25 s, as
  `menu-state-poll.ts`'s `READ_LIMIT_MS`), and cancels it when the operator session ends or the app's api is replaced. An answer
  equal, as JSON, to the last applied one counts as applied but keeps the shown list.
- Stryker ran on every new `packages/ui` file, `floor-map-fills.ts` included; the ten fill tokens
  were added to design-system.md's colour list; the design-system paragraph for `wt-floor-map` names
  its events `wt-table-tap`, `wt-table-details` and `wt-table-drag-end`.

**Mutation runs.** As slice 2: each task that adds a `packages/ui` file runs
`gtimeout 900 pnpm --filter @waitron/ui exec stryker run --mutate <file>` once, and a survivor gets
an exact-value assertion. If it cannot start or runs out of time, say so in the commit message.

**Fake timers.** Every browser test here that fakes time fakes only the timers it needs
(`vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })`, or `setInterval`/`clearInterval`
for the re-read), as `packages/ui/src/components/wt-toast.test.ts:279` and
`apps/till/src/screens/till-station-screen.test.ts:1839` do, so `requestAnimationFrame` stays
real, and calls `vi.useRealTimers()` in `afterEach`. A case that waits for a resize or a dialog's
close awaits a real animation frame (`await new Promise(requestAnimationFrame)`) or the dialog's
`wt-close` event, never a sleep (`docs/developers/testing-guide.md:1055`, and the dialog-close
rule after it). `gestures.ts` and `wt-floor-map.ts` schedule nothing with `requestAnimationFrame`.

**Forms.** Nothing this slice draws saves anything: the details sheet, the status pin and the flash
notice only show and send events, and the seat dialog keeps its draft scope and
`seat-dialog.unsaved.test.ts` unchanged (only its hint changes). So A331's save rule
(`draftScopeFor`, `saveActionState`, an early return, an `*.unsaved.test.ts` with #1422's reconnect
case) applies to no form here; slice 4's Change seats for today is the first that will need it.

**Pointer events** are dispatched as `wt-floor-plan-canvas.test.ts` dispatches them: `pointerdown`
on the element pressed (`bubbles: true, composed: true`, a `pointerId`, `pointerType`,
`clientX`/`clientY`, `button: 0`), then `pointermove`, `pointerup` and `pointercancel` on `window`.
Synthetic events cannot show what the browser does with focus or scrolling after a real press, so
the cases about those use `userEvent.click` (a real Playwright click) instead.

### Task 3.1: Gestures

**Files:**
- Create: `packages/ui/src/gestures.ts`, `packages/ui/src/gestures.test.ts`
- Modify: `packages/ui/src/index.ts` (export beside the floor exports, `:44-99`)

**Interfaces:**
- Produces:

```ts
export const LONG_PRESS_MS = 500;
export const DOUBLE_TAP_MS = 300;
export const SLOP_PX = 8;
export const DOUBLE_TAP_PX = 24;
export interface GesturePoint { target: EventTarget | null; x: number; y: number; pointerType: string } // client px; target = composedPath()[0] of the pointerdown
export interface GestureHandlers {
  tap?(at: GesturePoint): void;
  /** The second of two taps within DOUBLE_TAP_MS and DOUBLE_TAP_PX; sent instead of a second tap. */
  doubleTap?(at: GesturePoint): void;
  /** The press has stayed within SLOP_PX for LONG_PRESS_MS. */
  holdStart?(at: GesturePoint): void;
  /** A hold released without moving SLOP_PX. */
  longPress?(at: GesturePoint): void;
  /** A hold that then moved; dx, dy from where the press began. */
  holdDrag?(at: GesturePoint & { dx: number; dy: number }): void;
  holdDrop?(at: GesturePoint & { dx: number; dy: number }): void;
  /** A press that moved SLOP_PX or more before the hold; dx, dy since the last call (the first call: since the press). */
  pan?(by: { dx: number; dy: number }): void;
  /** Two pointers: their distance's ratio since the last call, their midpoint now (client px), and how far it moved. */
  pinch?(change: { ratio: number; x: number; y: number; dx: number; dy: number }): void;
  /** The gesture ended without its own end: a pointercancel at any point, or a second pointer
   * arriving during a hold or a hold's drag. */
  cancel?(): void;
}
export class Gestures {
  constructor(host: HTMLElement, handlers: GestureHandlers);
  /** True from a pointerdown until every pointer of the gesture lifts or cancels. */
  get active(): boolean;
  disconnect(): void;
}
```

Behaviour: `pointerdown` on `host` starts tracking (a mouse's non-primary buttons, and a mouse
press with Ctrl held, start nothing; slice 3 decision 7); the module only listens, and never stops
or prevents a pointer event, so the app's idle logout still hears every press;
`pointermove`, `pointerup` and `pointercancel` are heard on `window` while a gesture is active, and
removed when it ends. The hold is a `setTimeout(LONG_PRESS_MS)`; the double-tap window is a
`setTimeout(DOUBLE_TAP_MS)` started by a tap, so a second tap while it is pending is a double tap.
No clock is read, so fake timers drive both. A third pointer is ignored. `disconnect()` removes the
host's listener, any window listeners, and both timers.

- [ ] **Step 1: Write the failing tests** in `gestures.test.ts`. Host:
  `mount('<div style="width: 600px; height: 300px"><button id="b">B</button></div>')`
  (`packages/ui/src/test-helpers.ts:11`); handlers are `vi.fn()`s; points are client px.

```ts
it("a press released in place is a tap, at once", () => { /* touch down/up on #b → tap once with { target: b, pointerType: "touch" } and the release's x, y; no other handler */ });
it("a second tap within 300 ms and 24 px is a double tap, not a tap", () => { /* tap; advance 299; tap 20 px away → tap once, doubleTap once */ });
it("two taps 300 ms apart are two taps", () => { /* advance 300 between → tap twice, doubleTap never */ });
it("two taps 25 px apart are two taps", () => { /* tap at (10, 10); tap at (35, 10) within 300 ms → tap twice, doubleTap never */ });
it("a press held 500 ms marks the hold, and its release is a long-press, not a tap", () => {
  /* advance 499 → holdStart not called; advance 1 → holdStart({ target: b }); up → longPress once; tap never */
});
it("moving 7 px still holds", () => { /* move +7, 0; advance 500 → holdStart; up → longPress */ });
it("moving 8 px before the hold pans, from where the press began", () => {
  /* move to +8, 0 → pan { dx: 8, dy: 0 }; to +30, +5 → pan { dx: 22, dy: 5 }; advance 500 → no holdStart; up → no tap, no longPress */
});
it("a hold that moves drags, measured from the press", () => {
  /* hold; move +40, 0 → holdDrag { dx: 40, dy: 0, target: b }; up at +50, +10 → holdDrop { dx: 50, dy: 10 }; longPress never */
});
it("two pointers pinch about their midpoint", () => {
  /* down 1 at (200, 150), down 2 at (300, 150); move 2 to (400, 150) → pinch { ratio: 2, x: 300, y: 150, dx: 50, dy: 0 } */
});
it("a second pointer during a hold cancels it", () => { /* hold #b; down 2 → cancel once; up both → no longPress, no tap */ });
it("after a pinch nothing happens until every pointer lifts", () => { /* pinch; up 2; move 1 by 60 → no pan; up 1 → no tap; active false */ });
it("a third pointer is ignored", () => { /* pinching with 1, 2; down 3 and move 3 → no further pinch */ });
it("pointercancel ends the press", () => { /* down; pointercancel → cancel once; up → no tap; active false */ });
it("a mouse's right button starts nothing", () => { /* mouse down/up with button 2 → no tap; active false throughout */ });
it("a mouse press with Ctrl held starts nothing", () => { /* mouse button 0, ctrlKey true, down/up → no tap; active false */ });
it("never stops or prevents a press", () => { /* dispatch the press on #b with cancelable: true → a document pointerdown listener hears it, and defaultPrevented is false */ });
it("another pointer's moves do not move a one-finger press", () => { /* down 1; move pointerId 9 by 50 → no pan */ });
it("disconnect stops listening and clears the hold", () => { /* down; disconnect(); advance 500 → no holdStart; down/up → no tap */ });
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/ui exec vitest run src/gestures.test.ts`.
  Expected: the file fails to load; `./gestures.js` does not exist.
- [ ] **Step 3: Implement** the state machine (idle → pressed → held | panning; pressed or held →
  pinching on a second pointer; pinching → spent until every pointer lifts; any → idle on the last
  up or cancel) and its export.
- [ ] **Step 4: Run** the same command (PASS, read the `Tests` count); `pnpm --filter @waitron/ui typecheck`,
  `pnpm --filter @waitron/ui lint`, `pnpm exec prettier --check packages/ui/src/gestures.ts packages/ui/src/gestures.test.ts packages/ui/src/index.ts`.
- [ ] **Step 5: Mutation** — the bounded run on `src/gestures.ts`.
- [ ] **Step 6: Commit** — e.g. "Floor map: a gesture recogniser that tells tap, double tap, hold,
  hold-and-drag, pan and pinch apart (A429 slice 3)".

### Task 3.2a: The table fill colours

**Files:**
- Modify: `packages/ui-core/src/tokens/colors.css` (all four blocks: the light default, the dark
  preference, explicit light, explicit dark, each after `--wt-color-on-day-closed`),
  `packages/ui-core/src/tokens/colors.test.ts` (a `describe.each` beside the calendar's,
  `:325-366`)
- Create: `packages/ui/src/floor-map-fills.ts`, `packages/ui/src/floor-map-fills.test.ts`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces:

```ts
export type FloorMapFill = "free" | "seated" | "bill" | "clearing" | "reserved";
export type FloorMapDot = "ready" | "forgotten";
export const FLOOR_MAP_FILLS: readonly FloorMapFill[];
/** `[data-fill="<fill>"]` paints background `--wt-color-table-<fill>` and colour `--wt-color-on-table-<fill>`. */
export const floorMapFillStyles: CSSResult;
```

Starting values (fill / text), from the existing palette where one fits:

| Fill | Light | Dark |
| --- | --- | --- |
| `free` | `#dff3e8` / `#16181d` | `#183626` / `#eceef2` |
| `seated` | `#1f6feb` / `#ffffff` | `#4c8dff` / `#06101f` |
| `bill` | `#7e3fb8` / `#ffffff` | `#c39bf0` / `#1d0b33` |
| `clearing` | `#f5a623` / `#241500` | `#f5b34a` / `#241500` |
| `reserved` | `#fde7c8` / `#16181d` | `#4a3a1c` / `#eceef2` |

A node script on 2026-10-10 computed each pair's contrast with the formula `colors.test.ts:14-24`
uses: 4.63 (`seated`, light) is the lowest. That is arithmetic on the hex values, not a run of the
test; the test in Step 1 is the check.

- [ ] **Step 1: Write the failing tests.**

```ts
// colors.test.ts — describe.each(["light", "dark"])("table fill colours (%s)")
test("each fill has its own text colour, readable on it at 4.5:1 or more", …); /* for each of the five, ratio(on, fill) ≥ 4.5 */
test("the five fills are different colours", …);                                /* new Set(values).size === 5 */
test("the dots are readable on the surface ring at 3:1 or more", …);            /* ratio(success, surface) and ratio(danger, surface) ≥ 3 */
test("the OS preference gives them the same values as the explicit theme", …);  /* as the calendar's case at :355-366 */

// floor-map-fills.test.ts — mount a div styled with floorMapFillStyles in a shadow root
it("paints each fill from its tokens", async () => {
  /* for each fill: host sets --wt-color-table-<fill> rgb(1, 2, 3) and --wt-color-on-table-<fill> rgb(4, 5, 6) →
     [data-fill=<fill>] background-color rgb(1, 2, 3), color rgb(4, 5, 6) */
});
it("lists the five fills", () => { /* FLOOR_MAP_FILLS toEqual ["free", "seated", "bill", "clearing", "reserved"] */ });
```

- [ ] **Step 2: Run and watch them fail** — `pnpm --filter @waitron/ui-core exec vitest run src/tokens/colors.test.ts`
  (the new cases read empty tokens and fail on `luminance`'s hex check) and
  `pnpm --filter @waitron/ui exec vitest run src/floor-map-fills.test.ts` (fails to load).
- [ ] **Step 3: Implement.** If a contrast case fails, change that value and say which in the commit.
- [ ] **Step 4: Run** both commands, `pnpm exec vitest run scripts/style-token-names.test.ts`, both
  packages' typecheck and lint, `prettier --check` on the changed `.ts` files (`colors.css` too).
- [ ] **Step 5: Commit** — e.g. "Floor map: table colours for free, seated, bill requested, needs
  clearing and reserved, in both themes (A429 slice 3)". (No mutation run: the new `packages/ui`
  file is a style sheet and a list.)

### Task 3.2b: `wt-floor-map` — drawing and fitting

**Files:**
- Create: `packages/ui/src/components/wt-floor-map.ts`, `packages/ui/src/components/wt-floor-map.test.ts`,
  `packages/ui/src/components/wt-floor-map.a11y.test.ts`
- Modify: `packages/ui/src/index.ts`, `packages/ui/demo/main.ts` (the workbench, beside
  `wt-floor-plan-canvas`, `:30`, `:126`), `docs/developers/design-system.md` (a row in the
  primitives table after `wt-sheet`, `:565`, and a paragraph after `wt-sheet`'s, `:589-594`)

**Interfaces:**
- Consumes: `PlanPlacement`, `cropToTables`, `fitScale`, `rotatedRect`, `bounds`, `showsName`
  (Task 2.1); `FloorMapFill`, `FloorMapDot`, `floorMapFillStyles` (Task 3.2a).
- Produces:

```ts
export interface FloorMapTable {
  id: string; label: string; placement: PlanPlacement;
  fill: FloorMapFill; dot: FloorMapDot | null;
  joinId: string | null;
  /** Read after the name: "Seated, 2 ready". A merge's members carry the same value. */
  description: string;
}
export interface FloorMapCopy { label: string } // the tables' group name; English default "Tables"
export interface FloorMapTap { tableId: string }
export interface FloorMapDetails { tableId: string }                                        // Task 3.2c
export interface FloorMapDrop { tableId: string; x: number; y: number; targetId: string | null } // Task 3.2d
@customElement("wt-floor-map")
export class WtFloorMap extends LitElement {
  @property({ attribute: false }) tables: FloorMapTable[] = [];   // placed tables only
  @property() fitKey = "";                                         // a change fits the view again
  @property({ attribute: false }) copy: Partial<FloorMapCopy> = {};
  /** `undefined` reads `prefers-reduced-motion` on every render; a test sets it. */
  @property({ attribute: false }) reducedMotion?: boolean;
}
```

Behaviour: the host is `display: block; position: relative; overflow: clip; touch-action: none;
user-select: none; -webkit-touch-callout: none` (the last two keep an iPad's long-press from
selecting text or offering its callout) on `--wt-color-surface`; its size is the parent's. It sets
no `shadowRootOptions` (no `delegatesFocus`, slice 3 decision 9). The view is `{ scale, x, y }`: a grid point
`(gx, gy)` is drawn at `(x + gx × scale, y + gy × scale)` px from the host's corner. Fitting sets
`scale = fitScale(crop, size)` and centres the crop. The host's size comes from a `ResizeObserver`.
Tables are grouped by `joinId` (no join: a group of one). Each group is one
`<button type="button" part="table" data-table-id=<first member's id>>` placed at the union of its
members' `rotatedRect`s and transparent itself (`pointer-events: none`), holding one
`<span part="shape" data-fill data-shape>` per member (`pointer-events: auto`), sized
`width × scale` by `height × scale` and turned `rotate(<rotation>deg)` about its centre, round shapes
`border-radius: 50%`, every shape outlined 1 px `--wt-color-field-line`, painted by
`floorMapFillStyles`. Members are ordered by `label` with `Intl.Collator(undefined, { numeric: true })`;
the group's label is `mapLabel(labels)`: when every label has a first word and they all share it,
that word once and then the rest of each joined by "+" ("Terrace 4+5"), else the labels joined by
"+" ("4+10"), the rule of `partyTablesName` (`packages/shared/src/party-name.ts:7-17`) with "+" for
its ", "; `mapLabel` is exported from the component's file. The visible name (`part="name"`,
centred, in the fill's text colour) shows only when `showsName(placement, scale)` for a single
table, which reads the table's own width and height, and `showsName(<the union box>, scale)` for a
merge. The accessible name is
`<label>, <description>`. A group's dot (`part="dot" data-dot`) sits at the box's top-right, a
`--wt-space-3` circle in `--wt-color-success` (ready) or `--wt-color-danger` (forgotten) with a
`calc(var(--wt-space-1) / 2)` `--wt-color-surface` ring (a literal width over 1 px is refused by
`packages/ui/src/no-hardcoded-chrome.test.ts:50-55`); it flashes (a 1 s opacity animation) unless motion is reduced, with the
same `@media (prefers-reduced-motion: reduce)` guard the floor's cards use
(`till-floor-screen.ts:213-217`). The groups sit in a `role="group"` named `copy.label`. The view
fits when tables are first drawn, when `fitKey` changes, and on every resize (Task 3.2d narrows
that). Changing `tables` alone keeps the view.

- [ ] **Step 1: Write the failing tests.** Host `<wt-floor-map style="width: 600px; height: 300px">`;
  `t(id, label, placement, over?)` builds a free table with no dot, no join and description "Free".
  The fitted view of one table at x 10, y 5, 8 × 4 is scale 37.5 (crop 12 × 8 in 600 × 300), drawn
  at left 150, top 75, 300 × 150 px.

```ts
it("fits the zone's tables to the map when it first draws them", async () => { /* t1's [part=table] box relative to the host: { left: 150, top: 75, width: 300, height: 150 } */ });
it("turns a table about its centre", async () => { /* rotation 90: the shape's transform is matrix(0, 1, -1, 0, 0, 0); the crop is now 8 × 12, scale 25, and the button's box 100 × 200 */ });
it("draws a round table as a circle", async () => { /* shape "round": border-radius 50% */ });
it("draws a merge as one button named with its tables in number order", async () => {
  /* "10" at (8, 0) 8 × 8 and "4" at (0, 0) 8 × 8, both joinId "j1": one [part=table], two [part=shape], data-table-id is "4"'s id,
     name text "4+10", aria-label "4+10, Free" */
});
it("names a merge's shared first word once", () => { /* mapLabel(["Terrace 4", "Terrace 5"]) → "Terrace 4+5"; ["4", "10"] → "4+10"; ["Bar 1", "Stool 2"] → "Bar 1+Stool 2" */ });
it("hides a turned table's name by its own size, not its turned box", async () => {
  /* the crop of the next case plus "L" at (20, 8) 2 × 8 turned 45°, kept inside it: its turned box is about 7 squares wide (≈ 92 px), its own shorter side 2 (≈ 26 px) → no [part=name] */
});
it("hides a name drawn under 28 px and keeps it as the accessible name", async () => {
  /* "B1" at (0, 0) 2 × 2 and "B2" at (36, 16) 3 × 3: crop 43 × 23 → scale 300/23 ≈ 13.04; B1 (26.1 px): no [part=name], aria-label "B1, Free"; B2 (39.1 px): name "B2" */
});
it("paints a table from its fill's tokens", async () => { /* fill "bill"; host sets --wt-color-table-bill rgb(1, 2, 3), --wt-color-on-table-bill rgb(4, 5, 6) → shape background rgb(1, 2, 3), name colour rgb(4, 5, 6) */ });
it("outlines every table in the field-line colour", async () => { /* host sets --wt-color-field-line rgb(7, 8, 9) → shape border-color */ });
it("shows one dot in its colour", async () => {
  /* dot "ready", host --wt-color-success rgb(1, 1, 1) → [part=dot][data-dot=ready] background rgb(1, 1, 1); "forgotten" reads --wt-color-danger; null → no dot */
});
it("flashes the dot unless motion is reduced", async () => { /* reducedMotion false → animation-name not "none"; true → "none" */ });
it("names the tables' group from its copy", async () => { /* default "Tables"; copy { label: "Mesas" } → role group named "Mesas" */ });
it("keeps the view when the tables change", async () => { /* add an 8 × 4 table at (60, 5): t1 still 300 px wide at left 150 */ });
it("fits again when fitKey changes", async () => { /* then fitKey "z2" → both tables fitted: crop 62 × 8, scale 600/62 → t1 width ≈ 77.4 (toBeCloseTo 1) */ });
it("fits again when the map is resized", async () => { /* host width 300 px, await a real animation frame twice → scale 25: t1 200 × 100 */ });
it("draws an empty group with no tables", async () => { /* tables [] → no [part=table]; no error */ });

// wt-floor-map.a11y.test.ts — describe.each(["light", "dark"]), mountThemed as wt-floor-plan-canvas.a11y.test.ts:1-40
test("one table in each fill", …); test("a ready dot and a forgotten dot", …); test("a merge, and a name too small to draw", …);
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-map.test.ts src/components/wt-floor-map.a11y.test.ts`.
  Expected: both files fail to load.
- [ ] **Step 3: Implement** (design-system.md → "Adding a primitive", `:3046`: `baseStyles` first,
  tokens only; not its `delegatesFocus`, slice 3 decision 9), the workbench entry and the design-system row and paragraph (what
  it draws, its three events, names below 28 px, the dot and reduced motion, that `fitKey` refits,
  and why it has no `delegatesFocus` and clips rather than hides its overflow; Task 3.2e adds its
  one tab stop and arrow keys).
  Before trusting the a11y file, drop the buttons' `aria-label` and watch it fail, then restore it.
- [ ] **Step 4: Run** the same command, `pnpm --filter @waitron/ui exec vitest run src/no-hardcoded-chrome.test.ts`,
  `pnpm exec vitest run scripts/style-token-names.test.ts`, typecheck, lint, `prettier --check`.
- [ ] **Step 5: Mutation** — the bounded run on `src/components/wt-floor-map.ts`.
- [ ] **Step 6: Commit** — e.g. "Floor map: a primitive that draws today's tables fitted to the
  screen, with a colour and a dot each and merges as one shape (A429 slice 3)".

### Task 3.2c: `wt-floor-map` — taps and details

**Files:**
- Modify: `packages/ui/src/components/wt-floor-map.ts`, its `.a11y.test.ts`, the design-system
  paragraph from Task 3.2b
- Create: `packages/ui/src/components/wt-floor-map.taps.test.ts`

**Interfaces:**
- Consumes: `Gestures`, `DOUBLE_TAP_MS` (Task 3.1).
- Produces: `wt-table-tap` (`FloorMapTap`) and `wt-table-details` (`FloorMapDetails`), each a
  `CustomEvent` with `bubbles: true, composed: true`.

Behaviour (slice 3 decision 7): the map owns one `Gestures` on its host, made in
`connectedCallback` and disconnected in `disconnectedCallback`. A gesture's target is a table when
its composed path holds a `[part=table]` button; its id is that button's `data-table-id`.
- `tap` on a table: touch and pen send `wt-table-tap` at once; a mouse waits `DOUBLE_TAP_MS` and
  sends it unless a `doubleTap` on the same table came first, which sends `wt-table-details`.
- `holdStart` on a table sets `data-held` on its button; `longPress` clears it and sends
  `wt-table-details`; `cancel` clears it.
- `contextmenu` on the map is always prevented; on a table, while no gesture is active (a mouse's
  right button, a macOS Ctrl+click, the ContextMenu key), it sends `wt-table-details`, unless a
  Shift+F10 `keydown` came just before it.
- `keydown` of Shift+F10 on a table is prevented and sends `wt-table-details` (macOS sends no
  `contextmenu` for it), and, as a safeguard (decision 7), notes that the next `contextmenu` is swallowed; the
  note is cleared by the next `keydown` or `pointerdown`, so a macOS right-click after it still
  works.
- A `click` on a table with `detail === 0` (Enter or Space on a focused button) sends
  `wt-table-tap`; a pointer's own click is ignored, since the gesture already acted.
- Events: the map stops a `click` or `contextmenu` it re-emits as a `wt-*` event, as the `wt-*`
  event rule asks, and never stops a `pointerdown` or `keydown`, which the app's idle logout listens
  for at its host (see "What earlier slices built"; the Shift+F10 `keydown` is prevented, not
  stopped).

- [ ] **Step 1: Write the failing tests** in `wt-floor-map.taps.test.ts`, with Task 3.2b's host and
  one table t1 (fitted at left 150, top 75, 300 × 150), points relative to the host, fake
  `setTimeout`/`clearTimeout`:

```ts
it("a touch tap on a table asks to open it, at once", async () => { /* mountInShadowRoot; document hears wt-table-tap { tableId: "t1" }, bubbles, composed */ });
it("a mouse click on a table waits for a second click", async () => { /* mouse down/up → nothing; advance 300 → wt-table-tap */ });
it("a mouse double-click on a table asks for its details instead", async () => { /* two clicks 100 ms apart → wt-table-details { tableId: "t1" }; advance 300 → no wt-table-tap */ });
it("a real mouse click opens a table once", async () => { /* userEvent.click on t1's shape (a real click, detail 1); advance 300 → exactly one wt-table-tap */ });
it("a hold on a table marks it, and its release asks for details", async () => { /* advance 500 → t1 [data-held]; up → wt-table-details; no wt-table-tap; data-held gone */ });
it("a right-click asks for details once and stops the browser's menu", async () => {
  /* dispatch a cancelable contextmenu on t1's shape → defaultPrevented true; exactly one wt-table-details { tableId: "t1" } */
});
it("Shift+F10 asks for details exactly once, whether or not the platform sends a contextmenu", async () => {
  /* focus t1; userEvent.keyboard("{Shift>}{F10}{/Shift}") → one wt-table-details, whether or not the platform follows it with a contextmenu;
     then dispatch keydown Shift+F10 followed by a synthetic contextmenu on t1 → one more, not two */
});
it("a right-click after a Shift+F10 that sent no contextmenu still works", async () => {
  /* keydown Shift+F10 alone (one event); then pointerdown with button 2 and a contextmenu → a second wt-table-details */
});
it("the ContextMenu key asks for details once", async () => { /* focus t1; userEvent.keyboard("{ContextMenu}") → exactly one wt-table-details */ });
it("a press on a table still reaches the page", async () => { /* a document pointerdown and keydown listener each hear a press and a key on t1 (the idle logout's events) */ });
it("a contextmenu during a touch hold sends nothing more", async () => { /* touch down on t1, contextmenu at 400 ms → prevented; no wt-table-details until release */ });
it("Enter on a focused table asks to open it", async () => { /* userEvent.keyboard("{Enter}") → wt-table-tap */ });
it("a merge sends its first member's id", async () => { /* tap on "10"'s shape in the merge of 4 and 10 → { tableId: <4's id> } */ });
it("a tap on empty space sends nothing", async () => { /* touch tap at (20, 20) → neither event */ });
it("a second finger during a hold cancels it", async () => { /* hold t1; second pointer down → data-held gone; release both → no wt-table-details */ });
// wt-floor-map.a11y.test.ts: add "a table held" in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-map.taps.test.ts src/components/wt-floor-map.test.ts src/components/wt-floor-map.a11y.test.ts`.
  Expected: the new cases fail (no event is sent); Task 3.2b's cases pass.
- [ ] **Step 3: Implement.** Then delete the `detail === 0` check and watch "a real mouse click
  opens a table once" count two taps, then restore it.
- [ ] **Step 4: Run** the same command and Task 3.2b's guards. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor map: tap a table to open it, hold or double-click it for its
  details (A429 slice 3)". (The mutation run is Task 3.2d's, once the file is whole.)

### Task 3.2d: `wt-floor-map` — pan, pinch, wheel and the held table's drag

**Files:**
- Modify: `packages/ui/src/components/wt-floor-map.ts`, the design-system paragraph from Task 3.2b
- Create: `packages/ui/src/components/wt-floor-map.view.test.ts`

**Interfaces:**
- Consumes: Task 3.2c's `Gestures`; `snapToSquare`, `clampToGrid` (Task 2.1).
- Produces: `wt-table-drag-end` (`FloorMapDrop`), `bubbles: true, composed: true`.

Behaviour (slice 3 decisions 8 and 11):
- `pan` moves the view; `pinch` scales it about the midpoint (`x' = m − (m₀ − x) × ratio`, with `m₀`
  the old midpoint and `m` the new one, both relative to the host); scale is clamped to
  `[fit / 2, fit × 4]`, and then the view so that the crop's centre stays within the host.
- `doubleTap` on empty space fits the view.
- `wheel`: Ctrl held zooms by `2 ** (−deltaY / 100)` about the pointer, else pans by `−deltaX`,
  `−deltaY`; prevented either way.
- A pan, pinch or wheel marks the view touched; a resize then keeps it (narrowing Task 3.2b's
  "every resize"), and a fit clears the mark.
- `holdDrag` draws the held group moved by `snapToSquare(d, scale)` squares, its first member
  clamped by `clampToGrid` (slice 4, 2026-10-11: the whole group is held with `groupStep`); `holdDrop` sends `wt-table-drag-end` with that member's new `x`, `y`,
  and `targetId`: the `data-table-id` of the first other table under the release point
  (`this.shadowRoot.elementsFromPoint`), else null; then the drawn place returns to `tables`'.
  `cancel` drops a drawn drag.

- [ ] **Step 1: Write the failing tests** in `wt-floor-map.view.test.ts`, with Task 3.2b's host and
  fitted view (t1 at left 150, top 75, 300 × 150; a second table t2 at x 20, y 5, 4 × 4 where a case
  needs one, the expected numbers worked out afresh for that crop), points relative to the host,
  fake `setTimeout`/`clearTimeout`:

```ts
it("dragging empty space pans the map", async () => { /* touch at (20, 20), move to (120, 40) → t1 left 250, top 95 */ });
it("a drag that starts on a table pans too, before the hold", async () => { /* down on t1, advance 100, move 20 px → panned 20; up → no wt-table-tap */ });
it("a pan stops with the plan's centre at the map's edge", async () => { /* move by +1000, 0 → t1 left 450 */ });
it("a double tap on empty space fits again", async () => { /* pan, then two taps at (20, 20) → t1 left 150 */ });
it("a double tap on a table does not fit", async () => { /* pan +50; touch double tap on t1 → t1 left 200 still */ });
it("pinching zooms about the fingers", async () => { /* (200, 150) and (300, 150), second to (400, 150) → t1 { left: 100, top: 0, width: 600, height: 300 } */ });
it("zoom stops at half and at four times the fitted size", async () => { /* pinch to a tenth → t1 width 150; then far out → width 1200 */ });
it("the wheel pans, and Ctrl+wheel zooms about the pointer", async () => {
  /* wheel deltaY 100 → t1 top -25; refit; Ctrl+wheel deltaY -100 at (300, 150) → t1 { left: 0, top: 0, width: 600 }; each defaultPrevented */
});
it("a resize after a pan keeps the person's view, and one after a fit fits", async () => {
  /* pan +50; host width 500, two real animation frames → t1 still 300 wide; double tap empty; host width 300, two frames → t1 200 wide */
});
it("a real click on empty space after a pan moves nothing and focuses nothing", async () => {
  /* real timers; pan +50; note document.activeElement; userEvent.click on the host at an empty point → t1 left unchanged; document.activeElement unchanged
     (with delegatesFocus the review's probe saw the first table take focus and the view jump to it) */
});
it("a real click on a table focuses it without panning", async () => {
  /* real timers; pan t1 half off the left edge; userEvent.click on its visible part → t1 left unchanged; t1 is the shadow root's activeElement */
});
it("a hold then a drag draws the table under the finger in whole squares, and drops it", async () => {
  /* hold t1, move +75, 0 → t1 left 225 (2 squares); up over empty → wt-table-drag-end { tableId: "t1", x: 12, y: 5, targetId: null }; then t1 left 150 */
});
it("a drop over another table names it", async () => { /* with t2 drawn: hold t1, move until the pointer is over t2's shape, release → targetId "t2" */ });
it("a drag past the top or left stops at 0", async () => { /* only t at (1, 1) 8 × 4: hold, move -200, -200 → drop x 0, y 0 */ });
it("a cancelled drag sends nothing and puts the table back", async () => { /* hold, move +75, pointercancel → no wt-table-drag-end; t1 left 150 */ });
it("the drop event bubbles out of a shadow root", async () => { /* mountInShadowRoot; document hears wt-table-drag-end */ });
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-map.view.test.ts src/components/wt-floor-map.taps.test.ts src/components/wt-floor-map.test.ts`.
  Expected: the new cases fail (nothing pans, no drop is sent); the others pass.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, `src/components/wt-floor-map.a11y.test.ts` and Task 3.2b's
  guards. Expected: pass.
- [ ] **Step 5: Mutation** — the bounded run on `src/components/wt-floor-map.ts`.
- [ ] **Step 6: Commit** — e.g. "Floor map: pinch, drag and the wheel to look around, and a held
  table's drop (A429 slice 3)".

### Task 3.2e: `wt-floor-map` — one tab stop and the arrow keys

**Files:**
- Modify: `packages/ui/src/components/wt-floor-map.ts`, `wt-floor-map.a11y.test.ts`, the
  design-system paragraph from Task 3.2b
- Create: `packages/ui/src/components/wt-floor-map.keys.test.ts`

**Interfaces:**
- Consumes: Task 3.2d's view (offset and scale) and its moved mark; this task builds the
  least-distance pan.
- Produces: nothing new for other tasks; keyboard behaviour only (slice 3 decision 18).

Behaviour: every table button has `tabindex="-1"` except the tab stop, which has `tabindex="0"`:
the table last focused (by key or by press) while the map still draws it, else the first in reading
order (sorted by the top of its box, then its left). On a focused table, ArrowRight and ArrowDown
move to the next table in reading order, ArrowLeft and ArrowUp to the previous, Home and End to the
first and last, stopping at the ends; each is prevented (never stopped: the idle logout listens for
`keydown`), pans the target into view by the least distance, makes it the tab stop, and focuses it
with `focus({ preventScroll: true })`. A pan an arrow key makes counts as the person moving the view:
it sets Task 3.2d's moved mark, so a later resize keeps the view. Other keys pass through, so Task 3.2c's Enter, Space and
Shift+F10 still work.

- [ ] **Step 1: Write the failing tests** in `wt-floor-map.keys.test.ts` (real timers; t1, t2 and
  t3 in reading order, t3 placed so that the fitted view, zoomed by a pinch, leaves it below the
  bottom edge):

```ts
it("puts exactly one table in the Tab order, the first in reading order", async () => { /* tabindex 0 on t1 only; -1 on t2, t3 */ });
it("Tab enters the map once and leaves it on the next Tab", async () => {
  /* a button before and after the map; focus the first, userEvent.keyboard("{Tab}") → t1 focused; "{Tab}" again → the button after the map */
});
it("the arrow keys move between tables in reading order, Home and End to the ends", async () => {
  /* focus t1; ArrowRight → t2; ArrowDown → t3; ArrowDown → t3 still; ArrowLeft → t2; Home → t1; End → t3; each keydown defaultPrevented */
});
it("the table last focused is the tab stop", async () => { /* arrow to t2 → tabindex 0 on t2 only; tables re-set without t2 → t1 again */ });
it("arrowing to a table below the edge pans it in without scrolling the map or its parent", async () => {
  /* the 600 × 300 px map inside <div style="height: 200px; overflow: auto"> with 400 px of content after the map, so the map's lower 100 px lie below the
     parent's visible part; zoom so t3 is below the map's bottom edge; focus t2, ArrowDown → t3 focused; t3's box inside the map's (the pan brings it in
     at the map's bottom edge, so it lies below the parent's visible part); the parent's scrollTop unchanged (0); the map's scrollLeft and scrollTop 0 */
});
it("an arrow key's pan survives a resize", async () => { /* zoom so t3 is off-screen; arrow to t3 (pans it in); host width 500, two real animation frames → t3's box still inside the map's */ });
it("a keydown on a table still reaches the page", async () => { /* a document keydown listener hears ArrowRight from t1 */ });
// wt-floor-map.a11y.test.ts: the existing states now carry one tab stop; add "focus on the second table after an arrow key" in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-map.keys.test.ts src/components/wt-floor-map.a11y.test.ts`.
  Expected: the new cases fail (every table is in the Tab order; arrows do nothing), except two
  that pass before the change: "a keydown on a table still reaches the page", a guard, and the
  a11y case "focus on the second table after an arrow key", which axe passes either way.
- [ ] **Step 3: Implement.** Then replace `preventScroll: true` with a plain `focus()` and watch the
  parent's `scrollTop` case fail, then restore it.
- [ ] **Step 4: Run** every `wt-floor-map` test file and Task 3.2b's guards. Expected: pass.
- [ ] **Step 5: Mutation** — the bounded run on `src/components/wt-floor-map.ts` (Task 3.2d's run,
  repeated now that the file has grown).
- [ ] **Step 6: Commit** — e.g. "Floor map: one tab stop, and the arrow keys move between tables
  without scrolling the page (A429 slice 3)".

### Task 3.3a: The till's stand-in statuses and map tables

**Files:**
- Create: `apps/till/src/state/floor-map.ts`, `apps/till/src/state/floor-map.test.ts`
- Modify: `apps/till/src/i18n/strings.ts` (EN after `floor.open_station`, `:534`; ES in the same
  place of the `es` block)

**Interfaces:**
- Consumes: `TableState` (`apps/till/src/api/client.ts:1861-1904`); `signalOf`
  (`apps/till/src/state/table-signals.ts`); `FloorMapTable`, `FloorMapFill`, `FloorMapDot`
  (Tasks 3.2a, 3.2b).
- Produces:

```ts
export interface StandInStatus { fill: FloorMapFill; dot: FloorMapDot | null }
export function standInStatus(table: TableState): StandInStatus;         // slice 3 decision 4
export function combinedStatus(statuses: readonly StandInStatus[]): StandInStatus;
export function statusWords(table: TableState, status: StandInStatus): string; // "Seated, 2 ready"
export function pinText(table: TableState, status: StandInStatus): string;     // "2 ready", Task 3.5
export function isPlannedZone(zoneTables: readonly TableState[]): boolean;      // decision 1
export function mapTables(zoneTables: readonly TableState[]): FloorMapTable[]; // placed, not taken off; a merge's members share one status and its words
export function listedTables(zoneTables: readonly TableState[]): TableState[]; // decision 2
export function seatsFor(table: TableState): number | null;                     // decision 12: joinSeats ?? seats; no today's row: capacity
```

Words (`statusWords` is the fill's word, then the dot's, joined by ", "): free `floor.free`;
reserved `floor.reserved` and the time ("Reserved 20:30"); seated `floor.status_seated`; bill
`signal.bill_requested` ("Bill requested" / "Cuenta pedida", `apps/till/src/i18n/strings.ts:543`, `:1676`, already the bill chip's words); clearing `floor.needs_clearing`; dot ready "<n> " + `floor.ready`; forgotten
`floor.forgotten`. `pinText` is the dot's words if there is a dot, else for seated with
`pendingToServe > 0` "<n> " + `floor.to_serve`, else the fill's word.

New strings (EN / ES): `floor.status_seated` "Seated" / "Ocupada"; `floor.map_label` "Tables" / "Mesas" (Task 3.3b); `floor.seats` "{n} seats" /
"{n} plazas" and `floor.seats_one` "1 seat" / "1 plaza" (Tasks 3.3c, 3.4).

- [ ] **Step 1: Write the failing tests** (a `table(over)` fixture like
  `till-floor-screen.test.ts:20-45`, with `today` set where a case needs it; `setLocale` restored in
  `afterEach`):

```ts
it("a free table is free, a booked free one reserved", () => { /* { fill: "free", dot: null }; nextReservation { time: "20:30" } → "reserved" */ });
it("a party or a delivery on its way makes it seated, even when booked", () => { /* state open-tab → "seated"; delivery-pending → "seated"; open-tab + reservation → "seated" */ });
it("a bill requested beats seated, and needs clearing beats both", () => { /* signals [bill_requested] → "bill"; condition needs_clearing + bill signal → "clearing" */ });
it("a forgotten order's dot beats ready dishes'", () => { /* readyToServe 2 → "ready"; + timingBand forgotten → "forgotten"; timingBand overdue alone → null */ });
it("a merge shows its most urgent member", () => { /* [seated/ready, free/null] → seated/ready; [bill/null, seated/forgotten] → bill/forgotten */ });
it("says the status in words", () => {
  /* "Free"; "Reserved 20:30"; seated + 2 ready → "Seated, 2 ready"; bill + forgotten → "Bill requested, Forgotten"; "Needs clearing"; es: "Ocupada, 2 listos" */
});
it("gives the pin its shortest word", () => { /* forgotten → "Forgotten"; ready 2 → "2 ready"; bill → "Bill requested"; seated, pendingToServe 3 → "3 to serve"; seated, nothing → "Seated" */ });
it("calls a zone planned when any of its tables has a today's row", () => { /* [today null, today {…}] → true; all null → false; [] → false */ });
it("maps placed tables, leaving out spares and taken-off ones", () => {
  /* t1 placed; t2 placement null (spare); t3 takenOff → [t1] with { id, label, placement, fill, dot, joinId, description } toEqual */
});
it("gives a merge's members one status and one description", () => {
  /* t4 seated with 2 ready, t5 free, both joinId "j1" → both fill "seated", dot "ready", description "Seated, 2 ready" */
});
it("lists what is on today's plan and what must stay reachable", () => {
  /* placed free t1; free spare t2; taken-off t3; seated unplaced t4; needs-clearing unplaced t5; delivery-pending unplaced t6; never planned (today null) t7
     → [t1, t4, t5, t6, t7] in the order given */
});
it("reads a table's seats for today, a merge's for the merge, and the old capacity without a plan", () => {
  /* today.seats 6 → 6; joinSeats 10 → 10; today null, capacity 4 → 4; today.seats null → null */
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/till exec vitest run src/state/floor-map.test.ts`.
  Expected: fails to load.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, `pnpm --filter @waitron/till typecheck`,
  `pnpm --filter @waitron/till lint`, `prettier --check` on the three files. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Till floor: the stand-in table statuses and which tables a planned
  zone shows (A429 slice 3)".

### Task 3.3b: The floor screen on the new map

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` (render's zone filter and view choice,
  `:633-656`; `#map`, `:727-752`; the Edit plan toggle, `:682-693`, and its state, `editing`,
  `:428`, `#toggleEdit`, `:534-537`, and `#onTrayTap`, `:775-781`; the card's seat count,
  `:899-905` and the clearing card's, `:873-877`; styles), `apps/till/src/screens/till-floor-screen.a11y.test.ts`,
  `apps/till/src/screens/device-screens.phone-margin.test.ts` (one row in `screens`, `:73-135`)
- Create: `apps/till/src/screens/till-floor-screen.map.test.ts`

**Interfaces:**
- Consumes: Task 3.3a's functions; `wt-floor-map` and its `wt-table-tap` (Tasks 3.2b–3.2e).

Behaviour: after the zone filter (`visible`, `:646-648`), when `isPlannedZone(visible)` the screen
uses `listedTables(visible)` for the list, `mapTables(visible)` for the map, and the listed tables
without a place for the tray; the view defaults to the map when the map has a table, else the list
(as `:656`). The map is `<wt-floor-map data-floor-map .tables .fitKey=${activeKey ?? ""}
.copy=${{ label: t("floor.map_label") }}>`, styled `height: 65dvh; min-height: calc(var(--wt-tap-min) * 6)`,
with the tray below it drawn by the existing `#trayItem` in view mode only. `wt-table-tap` stops
and runs `#openTable` on the table it names, as `#onCanvasOpen` does (`:543-548`), so a closed zone
still refuses a free table and a table needing clearing still offers Mark cleared. Edit plan is
not drawn while the active zone is planned, and `editing`, which today outlives a change of zone
(`:428`, set only by `#toggleEdit`, `:534-537`), is set false whenever the active zone is planned,
so `#onTrayTap` (`:775-781`), which places a tray table while editing, opens it instead. A planned
table's list card shows `seatsFor(table)` in the place of `capacity`. A zone with no today's rows
takes today's path.

- [ ] **Step 1: Write the failing tests** in `till-floor-screen.map.test.ts` (fixtures as
  `till-floor-screen.test.ts:7-45`, plus `today(over)` building a placed `TableToday`):

```ts
it("draws a planned zone on the new map, not the old canvas", async () => {
  /* t1 today placed → wt-floor-map present, no wt-floor-canvas; map.tables toEqual mapTables([t1]); map.fitKey "z1"; map.copy.label "Tables" */
});
// A guard that passes before the change too, so it is not one of Step 2's failures:
it("keeps the old canvas for a zone with no today's rows", async () => { /* placed("t1") with today null → wt-floor-canvas, no wt-floor-map */ });
it("a tap on a free table asks for its guests", async () => { /* dispatch wt-table-tap { tableId: "t1" } from the map → till-seat-dialog with tableLabel "1" */ });
it("a tap on a seated table opens its order", async () => { /* open-table { tableId: "t1", seated: true } */ });
it("a tap on a table needing clearing offers Mark cleared", async () => { /* [data-clear-dialog] open */ });
it("a closed zone refuses the map's free table", async () => { /* as till-floor-screen.test.ts:928-940, through the new map */ });
it("a tap naming a table the floor no longer has does nothing", async () => { /* no dialog, no event */ });
it("leaves taken-off tables and free spares out of the map and the list", async () => { /* t2 spare, t3 taken off beside placed t1: map.tables ids ["t1"], no tray item for either; toggle to list: no [data-table] for either */ });
it("puts a seated table with no place under the map, and in the list", async () => { /* tray [data-tray-table=t4]; list card t4 */ });
it("lists a never-planned table of a planned zone", async () => { /* t7 today null beside planned t1 → list card t7; tray t7 */ });
it("shows today's seats on a planned table's card", async () => { /* today.seats 6, capacity 4 → ".capacity" text "6 pax" */ });
it("hides Edit plan while a planned zone shows", async () => {
  /* canEdit; planned z1 active → no [data-edit-toggle]; select unplanned z2's tab → [data-edit-toggle] shown */
});
it("an Edit plan left on in another zone does not place a planned zone's tray table", async () => {
  /* canEdit, api with setTablePlacement as a vi.fn(); in unplanned z2 press Edit plan; select planned z1 (with seated unplaced t4 in its tray);
     tap [data-tray-table=t4] → open-table { tableId: "t4", seated: true }; setTablePlacement not called */
});
it("gives the map the active zone as its fitKey", async () => { /* two planned zones; select z2 → fitKey "z2" and z2's tables */ });
it("opens on the list when a planned zone has nothing placed", async () => { /* only a seated unplaced table → list view */ });

// device-screens.phone-margin.test.ts — a case beside the loop (:137-155): at 411 px a planned zone with one placed table draws its
// wt-floor-map inside the screen's content box: the map's box has left 8 and right 403 (8 + 395); at 1280 px left 40 and right 1240.
// (A row in `screens` would read only .screen's padding, which the map cannot change.)
// till-floor-screen.a11y.test.ts — "a planned zone's map" and "a planned zone's list" in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.map.test.ts src/screens/device-screens.phone-margin.test.ts src/screens/till-floor-screen.a11y.test.ts`.
  Expected: the new file's cases fail (no `wt-floor-map`), except the old-canvas guard, which
  passes before and after; the phone-margin case fails because there is no map to measure.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus every existing floor file
  (`src/screens/till-floor-screen.test.ts src/screens/till-floor-screen.parties.test.ts src/screens/till-floor-screen.signals.test.ts src/screens/till-floor-screen.unsaved.test.ts`),
  `pnpm exec vitest run scripts/style-token-names.test.ts scripts/native-form-fields.test.ts`, the
  till's typecheck and lint, `prettier --check`. Expected: pass, with no existing case changed; one
  that needs changing is a STOP (the plan's header rule).
- [ ] **Step 5: Commit** — e.g. "Till floor: a zone with a floor plan shows today's plan as a map
  of coloured tables (A429 slice 3)".

### Task 3.3c: The seats placeholder and the 15-second re-read

**Files:**
- Modify: `apps/till/src/widgets/seat-dialog.ts` (a `seats` property beside `tableLabel`, `:38`;
  the hint, `:151`), `apps/till/src/widgets/seat-dialog.test.ts`,
  `apps/till/src/screens/till-floor-screen.ts` (`#seatDialog`, `:824-835`; the re-read timer beside
  the reminder timer, `:444-465`), `apps/till/src/till-app.ts` (`#refreshFloor`, `:5018-5027`, and
  every assignment of `this.tables`: `:1323`, `:4939`, `:5022`, `:6980`, `:6982`),
  `apps/till/src/till-app.test.ts` (beside the floor-refresh cases, `:6486-6526`),
  `apps/till/src/till-app-parties.test.ts` (one case),
  `apps/till/src/i18n/strings.ts` (`seat.covers`; `seat.guest_count_hint` deleted, EN `:546` and ES
  `:1679`, once nothing reads it)
- Create: `apps/till/src/screens/till-floor-screen.refresh.test.ts`

**Interfaces:**
- Produces: `TillSeatDialog.seats: number | null` (default null); the floor screen sends
  `floor-refresh` every 15 s while a planned zone's map shows.

Behaviour: the dialog's hint is `countText(seats, "floor.seats", "floor.seats_one")` when `seats`
is a number, else `t("seat.covers")` ("Covers" / "Cubiertos"). The floor passes
`seatsFor(table)`. The floor's re-read is a `setInterval(15_000)` started in `updated` when the map
view of a planned zone is drawn and cleared when it is not, and in `disconnectedCallback`; each tick
sends `floor-refresh`, as the placement writes do (`:576-578`).
The interval is started only when none is running, so a render while the map stays up leaves the
running one alone. In the app (slice 3 decision 13), every table read takes a number as it starts
(`const read = ++this.#tablesRead`), at each place that reads and writes `this.tables` (`:1321-1323`,
`:4934-4939`, `:5020-5022`, `:6978-6982`), and applies its answer, an empty list from
`#reloadTables`'s failure included, only when `read` is higher than `#tablesApplied`, then sets
`#tablesApplied = read`. `#refreshFloor` answers true when `#tablesApplied >= read` after its own
answer or failure, that is when its own answer or a newer one was applied.

The dialog keeps its draft scope and its `seat-dialog.unsaved.test.ts` as they are: only the hint
changes, so A331's save rule is not reopened here.

- [ ] **Step 1: Write the failing tests:**

```ts
// seat-dialog.test.ts
it("shows the table's seats as the placeholder", async () => { /* seats 6 → native input placeholder "6 seats"; seats 1 → "1 seat"; es → "6 plazas" */ });
it("says Covers when the table has no seats", async () => { /* seats null → "Covers"; es "Cubiertos" */ });

// till-floor-screen.refresh.test.ts — fake setInterval/clearInterval
it("gives the seat dialog today's seats, a merge's, or the old capacity", async () => { /* tap planned t1 (seats 6) → dialog.seats 6; merge member (joinSeats 10) → 10; unplanned zone, capacity 4 → 4 */ });
it("asks for the floor every 15 s while a planned zone's map shows", async () => { /* advance 14_999 → 0 floor-refresh; +1 → 1; +15_000 → 2 */ });
// A guard that passes before the change too:
it("does not ask while the list shows, or for the old map", async () => { /* toggle to list → none in 30 s; an unplanned zone's map → none */ });
it("a redraw while the map stays up keeps the running interval", async () => { /* advance 10_000; set tables (a re-read); advance 5_000 → 1 floor-refresh, not 0 */ });
it("starts again when the map comes back, and stops when the screen leaves", async () => { /* list → map → 1 after 15 s; remove the element → none; re-add → 1 after 15 s */ });

// till-app.test.ts, as :6486
it("an older poll that answers after the action's refresh began does not replace it", async () => {
  /* two floor-refresh events, A then B, both deferred; resolve B with [tableB], then A with [tableA] → floor(el).tables toEqual [tableB] */
});
// A guard that passes before the change too (today assigns every answer); Step 3 uses it:
it("an action's refresh is applied when an older poll answers first", async () => {
  /* A then B deferred; resolve A with [tableA] → tables [tableA]; resolve B with [tableB] → tables [tableB] (a "drop when the counter moved" rule would drop B here) */
});
// till-app-parties.test.ts, with its Move a bill stubs (its api fixture stubs moveBill at :295):
it("Move a bill's floor read is not replaced by an older poll that answers later", async () => {
  /* a floor-refresh poll deferred; move a bill (till-app.ts:7068-7076), whose floor read answers with the party at its new revision; then the poll answers with the old revision →
     in the order screen's `tables` (it is given the app's this.tables, :8851), the row whose id is the app's activeTableId (the table the move ran from, till-app.ts:7037-7047) holds the new revision. (Its `party` would pass today too:
     #rememberOrderParty, :5388-5394, copies the party from the move's own read into orderParty, which the screen reads, :8856; the table row is what the late poll overwrites today.) */
});
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/till exec vitest run src/widgets/seat-dialog.test.ts src/screens/till-floor-screen.refresh.test.ts src/till-app.test.ts -t "seats|Covers|15 s|list shows|map stays up|map comes back|older poll"`
  and `pnpm --filter @waitron/till exec vitest run src/till-app-parties.test.ts -t "older poll"`.
  Expected: each new case fails (the old hint shows; no `floor-refresh` is sent; the late answer
  wins), except two guards that pass before the change: "does not ask while the list shows, or for
  the old map" and "an action's refresh is applied when an older poll answers first".
- [ ] **Step 3: Implement.** With the app cases passing, replace "higher than the last applied" by
  "no read started since" and watch "an action's refresh is applied when an older poll answers
  first" fail, then restore it.
- [ ] **Step 4: Run** the four files without `-t`, `src/widgets/seat-dialog.unsaved.test.ts`,
  `src/widgets/seat-dialog.a11y.test.ts`, `src/screens/till-floor-screen.map.test.ts`, the till's
  typecheck and lint, `prettier --check`. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Till floor: the seat dialog suggests the table's seats, and a
  floor plan map re-reads every 15 seconds (A429 slice 3)".

### Task 3.4: The details sheet

**Files:**
- Create: `apps/till/src/widgets/table-details-sheet.ts` (`till-table-details-sheet`),
  `apps/till/src/widgets/table-details-sheet.test.ts`, `apps/till/src/widgets/table-details-sheet.a11y.test.ts`,
  `apps/till/src/screens/till-floor-screen.details.test.ts`
- Modify: `apps/till/src/screens/till-floor-screen.ts` (a `#details` state holding a table id and
  heading; the sheet beside `#seatDialog` and `#clearDialog`, `:722`), `apps/till/src/i18n/strings.ts`

**Interfaces:**
- Consumes: `seatsFor` (Task 3.3a); `signalChips`, `signalChipStyles` (`apps/till/src/widgets/signal-chips.ts:20`, `:62`),
  `renderFloorChips` (`packages/ui/src/floor-chips.ts:43`); `trackDialog`.
- Produces:

```ts
@customElement("till-table-details-sheet")
export class TillTableDetailsSheet extends LitElement {
  @property({ attribute: false }) table: TableState | null = null; // null: closed
  @property() heading = "";                                         // the name as drawn: "Terrace 4+5", or the party's name on the order screen
  /** Injectable clock for Time to fire; unset reads Date.now() on each render. */
  @property({ attribute: false }) now?: number;
}
// details-close: no detail, bubbles, composed — on Close, Escape and after Mark cleared
// mark-cleared: { tableId }, bubbles, composed — the app's existing event (till-app.ts:9076)
```

Behaviour (spec §5, slice 3 decision 14): a `wt-dialog` with `trackDialog()`, open while `table` is
set, headed `heading`. Lines, each only when it applies: today's seats ("6 seats"); the party's
name when it differs from the table's (as `shownPartyName`, `till-floor-screen.ts:51-54`);
"Guests: 4" (`floor.guests`); what is owed (`floor.details_owed`, the party's `outstanding`
through `formatMoney`) or "Paid" (`floor.paid`) when nothing is; "Bills: 2" when more than one;
kitchen progress, each count above zero joined by " · " ("3 to serve · 2 ready · 1 en route",
`floor.to_serve`, `floor.ready`, `floor.en_route`); the unsent drafts (as `#unsent`, `:991-997`);
the signal chips; "Time to fire" (`floor.fire_due`) when the party's held group is due, judged as the
floor's card judges it (`reminderDueAt(table.party?.reminder) <= now`, `#fireDue`,
`till-floor-screen.ts:467-469`, shown on the card at `:921-925`), so a planned zone, whose map has no
room for it, keeps it one press away; "Reserved 20:30"; "2 to deliver" (`floor.pending_delivery`);
"Free" when none of these apply. The floor passes the clock it last drew with (`#drawnAt`, set in
`willUpdate`, `till-floor-screen.ts:459-461`), so when its reminder timer redraws the floor at the
due time (`#watchReminders`, `:471-482`) the open sheet is drawn again with the later clock and
shows Time to fire. Opened from the order screen's pin (Task 3.5) it is given no clock and reads
`Date.now()` when it draws, which happens when its `table` changes, so there it shows Time to fire
only after the next table read one of the order screen's actions brings. Footer: Close (`floor.details_close`, secondary) and, for a table needing clearing,
Mark cleared (`floor.mark_cleared`, primary), which sends `mark-cleared` and then `details-close`.
The floor screen opens it on the map's `wt-table-details`, with the heading of the map group the
table belongs to, and closes it on `details-close`. It reads the table by id from `tables` on each
render, so a re-read updates it, and a re-read that no longer has the table closes it.

New strings (EN / ES): `floor.details_owed` "Owes {amount}" / "Debe {amount}"; `floor.details_close`
"Close" / "Cerrar".

- [ ] **Step 1: Write the failing tests:**

```ts
// table-details-sheet.test.ts — mountWidget, a fixed locale
it("is closed with no table", async () => { /* wt-dialog open false */ });
it("heads itself with the name it is given and shows today's seats", async () => { /* heading "Terrace 4+5"; "6 seats" */ });
it("shows a seated party: its name, guests, what it owes, its bills and its kitchen progress", async () => {
  /* party name "Ana" (displayName ≠ label), "Guests: 4", "Owes " + formatMoney("47.50", currentLocale()), "Bills: 2",
     pendingToServe 3, readyToServe 2, enRoute 1 → "3 to serve · 2 ready · 1 en route" */
});
it("says Paid when the party owes nothing", async () => { /* outstanding "0.00", no open tab */ });
it("says Time to fire when the held group is due, and not before", async () => {
  /* party.reminder.dueAt 12:00:00Z; now 11:59:59Z → no [data-fire-due]; now 12:00:00Z → "Time to fire" */
});
it("shows the signal chips, the booking and a delivery", async () => { /* a bill_requested chip [data-chip]; "Reserved 20:30"; "2 to deliver" */ });
it("says Free for a free table with nothing on it", async () => { /* free, no booking, no seats → the only line is "Free"; no [data-mark-cleared] */ });
it("offers Mark cleared only for a table needing clearing, and closes after it", async () => {
  /* mountInShadowRoot-style host listener hears mark-cleared { tableId: "t1" } then details-close; a free table has no [data-mark-cleared] */
});
it("Close asks to close", async () => { /* details-close once */ });
it("Escape asks to close", async () => { /* keyboard Escape; await the wt-dialog's wt-close event, then expect details-close */ });

// till-floor-screen.details.test.ts
it("opens the sheet on the map's request, headed as the map draws the table", async () => { /* wt-table-details { tableId: "t4" } on a merge of "Terrace 4" and "Terrace 5" → sheet.table.id "t4", heading "Terrace 4+5" */ });
it("the open sheet shows Time to fire when the floor redraws at the due time", async () => {
  /* the floor's `now` left unset (with it set, #watchReminders returns at once, till-floor-screen.ts:474, and the case could not tell #drawnAt from this.now);
     vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }) at 11:59:59Z; t4's reminder due 12:00:00Z; open the sheet → no [data-fire-due];
     advance 1000 ms; await the floor's then the sheet's updateComplete → "Time to fire". Restore real timers before awaiting any animation frame wt-dialog needs.
     Control: pass this.now to the sheet instead of #drawnAt and watch the case fail, then restore it. */
});
it("a re-read updates the open sheet", async () => { /* set tables with t4's readyToServe 2 → sheet shows "2 ready" */ });
it("a re-read without the table closes the sheet", async () => { /* open for t4; set tables without t4 → no open till-table-details-sheet (table null) */ });
it("Mark cleared in the sheet reaches the app and closes the sheet", async () => { /* document hears mark-cleared { tableId }; sheet closed */ });

// table-details-sheet.a11y.test.ts — describe.each(["light", "dark"]): a free table; a seated party with everything; a table needing clearing
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/till exec vitest run src/widgets/table-details-sheet.test.ts src/widgets/table-details-sheet.a11y.test.ts src/screens/till-floor-screen.details.test.ts`.
  Expected: the files fail to load.
- [ ] **Step 3: Implement.** Before trusting the a11y file, remove the dialog's heading and watch it
  fail, then restore it.
- [ ] **Step 4: Run** the same command, `src/screens/till-floor-screen.map.test.ts`, the till's
  typecheck and lint, `prettier --check`. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Till floor: hold a table, or double-click it, for its details
  sheet (A429 slice 3)".

### Task 3.5: The flash notice and the status pin

**Files:**
- Create: `apps/till/src/widgets/table-status.ts` (`till-table-status`),
  `apps/till/src/widgets/table-status.test.ts`, `apps/till/src/widgets/table-status.a11y.test.ts`
- Modify: `apps/till/src/screens/till-table-order-screen.ts` (`.head-actions`, markup
  `:2549-2577`: the widget before the Tab button, given `.tables=${this.tables}` and
  `.party=${this.party}`, props at `:1166-1168`), `apps/till/src/screens/till-table-order-screen.test.ts`
  (one case), `apps/till/src/i18n/strings.ts`

**Interfaces:**
- Consumes: `standInStatus`, `combinedStatus`, `pinText` (Task 3.3a); `floorMapFillStyles`
  (Task 3.2a); `till-table-details-sheet` (Task 3.4); `wt-toast`.
- Produces:

```ts
@customElement("till-table-status")
export class TillTableStatus extends LitElement {
  @property({ attribute: false }) tables: TableState[] = [];
  @property({ attribute: false }) party: TableParty | null = null;
}
```

Behaviour (slice 3 decisions 15 and 16): the party's rows are the tables whose `party.id` is the
party's, in `party.tableIds` order; with none, the widget draws nothing. The pin is a
`<button class="status-pin" data-status-pin>` at least `--wt-tap-min` tall: a swatch
(`<span data-fill=<fill>>` painted by `floorMapFillStyles`) and `pinText` of the first row with
the combined status; its accessible name is `table.status_pin` with the text. Pressing it opens the
details sheet for the first row, headed `party.displayName`. The flash notice is a
`<wt-toast data-flash-notice tone="info" .duration=${4000}>` fixed to the top of the window by a
copy of the equipment toast's rule (`till-app.ts:1078-1083`: `position: fixed; inset-inline:
var(--wt-space-3); top: calc(var(--wt-space-3) + env(safe-area-inset-top)); z-index: 10`; what
happens when both are open is in slice 3 decision 15), whose message is,
joined by " · ", what applies of: ready dishes (`countText(readyToServe, "table.flash_ready",
"table.flash_ready_one")`), a forgotten order (`table.flash_forgotten`), a bill requested
(`signal.bill_requested`). It is shown (`show()`) on the first render with a party that has any of them,
and again only when `party.id` changes; the widget remembers the last party id it judged while
connected.

New strings (EN / ES): `table.flash_ready` "{n} ready to serve" / "{n} listos para servir";
`table.flash_ready_one` "1 ready to serve" / "1 listo para servir"; `table.flash_forgotten`
"Forgotten order" / "Pedido olvidado"; `table.flash_close` "Close" / "Cerrar";
`table.status_pin` "Table details: {status}" / "Detalles de la mesa: {status}".

- [ ] **Step 1: Write the failing tests** (fake `setTimeout`/`clearTimeout` where a case waits):

```ts
// table-status.test.ts
it("draws nothing without a party or without its table", async () => { /* party null → empty; party with no row in tables → empty */ });
it("pins the table's status in its colour and shortest word", async () => {
  /* row seated, readyToServe 2 → pin text "2 ready", swatch data-fill "seated", aria-label "Table details: 2 ready" */
});
it("paints the pin's swatch from the fill's token", async () => { /* host sets --wt-color-table-seated rgb(1, 2, 3) → swatch background */ });
it("the pin opens the details sheet, headed with the party's name", async () => { /* party { name: null, displayName: "Terrace 4, 5" } (the floor read's displayName is partyDisplayName, apps/server/src/working-order.ts:7330, joining with ", ", packages/shared/src/party-name.ts:3, :18-20) → click → till-table-details-sheet table.id "t4", heading "Terrace 4, 5" */ });
it("flashes what the waiter must see when the order opens", async () => {
  /* readyToServe 2 and a bill_requested signal → wt-toast[data-flash-notice] open, message "2 ready to serve · Bill requested" */
});
it("says a forgotten order", async () => { /* timingBand forgotten → "Forgotten order" */ });
it("flashes nothing when nothing is urgent", async () => { /* seated, nothing ready → toast not open */ });
it("the notice goes on its own after 4 s", async () => { /* advance 3_999 → open; +1 → closed */ });
it("the notice goes with a tap", async () => { /* click the toast's message button → closed */ });
it("the notice blocks nothing", async () => {
  /* while open: no dialog[open] in the widget; document.elementFromPoint at a button placed mid-page beside the widget returns that button */
});
it("does not flash again for the same party, and does for another", async () => {
  /* close it; set party to a new object with the same id → not reopened; party with another id and an urgent row → open */
});

// till-table-order-screen.test.ts
it("shows the table's status in its head actions", async () => { /* mount with tables [row of party p1] and party p1 → .head-actions till-table-status with .party p1 */ });

// table-status.a11y.test.ts — describe.each(["light", "dark"]): the pin for each fill; the notice open; the sheet open from the pin
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/till exec vitest run src/widgets/table-status.test.ts src/widgets/table-status.a11y.test.ts`
  and `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.test.ts -t "head actions"`.
  Expected: the new files fail to load; the order-screen case finds no `till-table-status`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the three files without `-t`, `src/screens/till-table-order-screen.a11y.test.ts`,
  `src/screens/device-screens.phone-margin.test.ts`, the till's typecheck and lint, `prettier --check`.
  Expected: pass, no existing case changed.
- [ ] **Step 5: Commit** — e.g. "Till order: a notice for dishes ready, a forgotten order or a bill
  asked for, and a status pin that opens the table's details (A429 slice 3)".

### Task 3.6: Look

**Files:** none committed. Throwaway files `packages/ui/src/components/wt-floor-map.look.test.ts`
and `apps/till/src/screens/till-floor-screen.look.test.ts` are written, run and deleted (slice 3
decision 17). Screenshots go to `/Users/clintongormley/waitron-campaign/a429-3-shots/`, by that
literal absolute path, or, if Vitest refuses a path outside the package, through the package's
git-ignored `__screenshots__` folder and `cp`, then removed from the package (as Task 2.8).

States, each in English and Spanish (`setLocale`), light and dark (`mountWidget`'s `theme`), on the
handheld at 390 × 844 and the till at 1280 × 800 (`page.viewport`), named
`<state>-<lang>-<theme>-<width>.png`: a planned zone like the demo seed's terrace (a dozen tables,
two 2 × 2 fixed stools, one turned 45°) with every fill and both dots; a merge; the map zoomed in
and panned; a table held; the list view of a planned zone with the tray; the seat dialog with
"6 seats" and with "Covers"; the details sheet for a free table, a seated party with everything,
and a table needing clearing; the order screen with its status pin and the flash notice showing,
and once more with the equipment toast open too (slice 3 decision 15 says the notice is drawn over
it; the screenshot is the check, from `till-app` mounted whole, since the equipment toast is the
app's).

- [ ] **Step 1:** Write the throwaway files and run them
  (`pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.look.test.ts`, and the
  `packages/ui` one). Expected: `ls /Users/clintongormley/waitron-campaign/a429-3-shots/ | wc -l`
  equals the count taken.
- [ ] **Step 2:** Open each screenshot and look: a name on a token too small for it, a dot hidden by
  a neighbour, fills hard to tell apart in either theme, the map too tall or too short beside the
  zone tabs at 1280 or at 390, the tray crowding the map, the sheet's lines wrapping badly, the pin
  pushing the Tab button off a 390 px row, the notice covering the order's first line, Spanish
  longer than its space, product text that could be shorter (owner rule).
- [ ] **Step 3:** Fix what the look found, each fix test-first in the task file it belongs to (a
  failing assertion, then the change), and rerun that file.
- [ ] **Step 4:** Delete the throwaway files and any screenshots left in the packages (`git status`
  shows none), then run every slice 3 test file named above, the guards named above, and the three
  packages' typecheck and lint.
- [ ] **Step 5: Commit** the fixes, if any — e.g. "Till floor map: fixes from looking at it in both
  languages, both themes, on a phone and a till (A429 slice 3)", the message listing what was looked
  at and where the screenshots are.

**Slice 3 done when:** the focused tests above pass; `/finish-branch` runs the full wave; CI is green
on the head (`ui`'s and `ui-core`'s mutation floors run only weekly, so the per-file Stryker runs
above are the check); design-system.md names `wt-floor-map`; the backlog's A429 entry says slice 3
landed and what it left.

## Slice 4 — today's plan on the till (spec §6)

Branch `feat/floor-plan-today`, after slice 3 (landed as #1517). Expanded to step level on
2026-10-10, unattended; every `file:line` in this slice was read at `main` `87a2741f2`.

What the slice builds: on the server, today's writes (move, turn, take off, put back, place a spare,
seats for today, back to its saved place, reset a zone), today's merges (two free tables, a party
extending onto a table, two parties combining) and splitting them, behind new till routes gated like
joining, and today's own copy of the master's joins, written at each reset, from which a merge takes
its seats (decision 7); on the till, the map's drag turned into moves and joins, the details sheet's actions, a
seats prompt, Join with…, and the zone menu (⋮) with Add a spare table, Taken off today and Reset to
saved plan. A zone with no today's plan keeps everything as it is.

**One migration, Task 4.3e's, added by the owner's override of decision 7 (2026-10-10).** As first
expanded the slice needed none, and every other task still touches no schema. Every table and column
the other writes need already exists at `87a2741f2`: a table's
place, size, shape, turn, seats, fixed and taken-off flag (`floorTodayTables`,
`packages/db/src/schema/floor-plans.ts:215-234`), a merge's zone and seats (`floorTodayJoins`,
`:236-252`), each member with where it stood before (`floorTodayJoinTables`, `before_x`, `before_y`,
`before_rotation`, `:255-281`), what the last reset copied (`floorResetTables`, `:161-193`) and the
master's saved joins (`floorPlanJoins`, `floorPlanJoinTables`, `:118-155`). The shipped migration
`packages/db/drizzle/0126_fuzzy_stepford_cuckoos.sql` creates all of them (its `CREATE TABLE` lines
1, 10, 18, 42, 51, 79, 94, 102, 126; `before_rotation` at :85, `taken_off` at :113). Run on
2026-10-10 in this worktree: `pnpm exec vitest run scripts/migrations-match-schema.test.ts` passed
18 of 18, so the schema and the migrations agree. That the writes need no other column is read from
the code, not run. Only Task 4.3e touches the schema, and it runs the schema guard list; any other
task that finds it needs a column is a STOP.

**Existing tests that pin behaviour this slice changes** (a grep of `apps/` and `packages/` test
files, 2026-10-10):

- `apps/dashboard/src/screens/floor-plan-editor.test.ts:133` and
  `apps/dashboard/src/screens/floor-plan-editor.save.test.ts:251` pin the editor's note "Your changes
  will go live tomorrow." Task 4.5c changes that text (slice 2 decision 16), which "Behaviour this
  plan removes" did not list: slice 4 decision 20, a STOP for the owner.
- `apps/till/src/state/floor-map.test.ts:188-198` and `:212-224` pin `mapTables`' whole answer; Task
  4.4d adds two keys (`fixed`, `linkId`) to each row, which the header's rule allows. Their fixtures'
  `seated` sets no party (`:57`), so no row's colour or words change (read, not run).
- `apps/till/src/till-app-parties.test.ts:426`, `:488` and `apps/till/src/till-app-table-service.test.ts:2390`
  pin `seatTable` called with two arguments; `apps/till/src/till-app-parties.test.ts:457` and
  `apps/till/src/till-app.test.ts:7622` pin `joinTables` called with four;
  `apps/till/src/api/client.test.ts:2425` and `:2997` pin those two methods' bodies. This slice
  leaves every one of those calls as it is (decision 15), so none changes.
- No existing server test seats a party after inserting a today's merge (merges are inserted only in
  `apps/server/src/floor-today-store.test.ts`, `floor-today-state.test.ts`,
  `apps/server/src/table-removal.test.ts:444` and `packages/db/src/schema/floor-plans.test.ts:175`;
  read, not run), so seating every member of a merge (Task 4.3c) changes none of them.
- Every existing server case that takes a merge's seats from a saved join saves that join on the
  zone's FIRST save (`plannedZone`'s `joins`, `apps/server/src/testing/floor-today-venue.ts:81-93`),
  which runs a reset (`apps/server/src/floor-plan.ts:468`) after writing the joins (`:443-450`), so
  the reset copies it and Task 4.3f's reader finds it (read at `877c3f1b0`, not run). One that fails
  after Task 4.3f is a STOP.

**What earlier slices built that this slice works with** (read, not run):

- **Today's state.** Each live table of a planned zone has one `floor_today_tables` row; a spare has
  all six placement columns null; a taken-off table keeps its place in the row and is answered with
  `placement: null` and `takenOff: true` (`readTodayTables`, `apps/server/src/working-order.ts:7246-7283`,
  at `:7274`). `placementOf` and `placementColumns` read and write the six columns
  (`apps/server/src/floor-today-store.ts:37-51`). The till's `TableToday` carries `placement`,
  `seats`, `fixed`, `takenOff`, `joinId` and `joinSeats` (`apps/till/src/api/client.ts:1841-1849`),
  enough for every decision this slice's till code makes; the answer's shape does not change.
- **Resets and catch-ups.** `ensureToday(tx, cfg, removals, now)` resets each active zone with a
  master plan whose today's plan is for an earlier business day, else catches up its waiting rows
  (`floor-today-store.ts:381-423`); `resetZone(tx, cfg, removals, zoneId, now)` resets one zone
  (`:71-80`); a reset rewrites the zone's `floor_reset_tables` rows from the master
  (`:103-131`), one per planned live table (`table_id`) with what it copied (label, seats, fixed,
  place, `remove`), and a table catches up to that row, not to the master as it is now. The till
  routes run `catchUpFloor` (`ensureToday` with the deps' removals and clock,
  `apps/server/src/till-api.ts:1020-1021`) before they read or change the floor (seat `:2253`, finish
  `:2272`, move and join `:2344`, split `:2374`, the floor read `:2190`).
- **Today's merges.** Nothing writes one yet. `leaveMerges(tx, tableIds)` takes tables out of their
  merges and, when a merge is left with one member, puts that member back where it stood before and
  deletes the merge (`apps/server/src/floor-today-merges.ts:9-34`); it does not move the tables that
  left. A reset leaves a merge with anyone seated at it whole (`mergesOf`,
  `floor-today-store.ts:364-378`, the plan's decision 18) and ends every other merge it touches
  (`:296`, `:335`).
- **The join and split routes.** `POST /api/tables/:id/seat` (`till-api.ts:2243-2259`) runs
  `seatTable` (`apps/server/src/parties.ts:78-98`), which seats one table. `POST /api/parties/:id/join`
  and `/move` share one handler (`till-api.ts:2329-2351`): `requireSession(… { action: "take-orders" })`,
  then in one transaction `catchUpFloor`, `checkZones` on the party and the body table, then
  `joinTables` (`apps/server/src/table-actions.ts:112-139`). `joinTables` refuses two tables in
  different zones of any kind, `service_zone.join_mismatch` (`:122-128`, comparing the party's first
  table's zone, `partyZone`, `apps/server/src/parties.ts:173-187`, with the table's), so a party never
  holds tables in two zones through a join; a table another party holds combines the two parties
  (`combineAt`, `table-actions.ts:142-162`). `readTargetTable` refuses `table.not_found`,
  `table.inactive` and `table.needs_clearing` (`apps/server/src/move-bill.ts:223-234`).
  `POST /api/parties/:id/split-table` (`till-api.ts:2353-2383`) runs `splitTable`
  (`table-actions.ts:253-297`), which starts a new party at the table.
- **The checks.** `requireSession` checks the profile action before anything else
  (`apps/server/src/till-session.ts:92-133`); `checkZones(tx, cfg, session, subjects)` refuses
  `service_zone.not_allowed` for a subject outside the profile's zones, and lets a subject with no
  zone through (`apps/server/src/zone-access.ts:43-67`). The route maps: the action map is the
  comment atop `apps/server/src/till-api.profile-actions.test.ts:45-96` and its `ROUTES` list at
  `:274-394`, whose `ordering(method, path)` rows (`:252-258`) each get a "refuses … without
  take-orders" case (`:434-444`); the zone map is the comment atop
  `apps/server/src/till-api.profile-zones.test.ts:67-143` and its `ROUTES` list at `:448`, run by "a
  Restaurant profile on another department's zone" (`:1122-1126`) against the Deli fixtures
  (`Fixtures`, `:187-211`: `deliTable`, `deliTables`, `restFreeTable` and the rest).
- **Codes.** `apps/server/src/errors.ts` declares the table codes at `:310-339` (`table.in_floor_plan`
  `:320`, `table.needs_clearing` `:325`, `tab.already_open` `:339`) and `floor_plan.invalid
  { field }` at `:632`, documented as a master-plan save's; the till API's `STATUS` map is at
  `till-api.ts:369` (table codes `:487-496`; `floor_plan.invalid` is not in it, so it answers 400 by
  the map's own rule, `:368`). The till shows a code's words from `apps/till/src/i18n/codes.ts`
  (EN and ES in one table, `:5`; a missing code reads the generic sentence) and the app lists the
  codes its banner says in their own words in `TABLE_REFUSALS` (`apps/till/src/till-app.ts:361-386`).
  `management.request_invalid { field }` is the till routes' malformed-body code (`invalid`,
  `apps/server/src/bill-allocation.ts:72-74`). `foodOnItsWay()` is the condition for an order whose
  food is still on its way (`apps/server/src/delivery-release.ts:25`), which `tablesTied` already uses
  (`apps/server/src/table-removal.ts:20-45`).
- **The map.** `wt-floor-map` sends `wt-table-drag-end` `{ tableId, x, y, targetId }` when a held
  table is dragged and released: `tableId` and the new `x`, `y` are the dragged group's first member's
  in label order, a merge moving as one, and `targetId` is the `data-table-id` of the first other
  table under the release point (`packages/ui/src/components/wt-floor-map.ts:435-471`); the table is
  then drawn back where `tables` puts it (`#endDrag`, `:429-433`). The hold's feedback is `data-held`
  (`:349-352`, styles `:194-210`). Nothing listens to the drop yet. A re-read that drops the held
  table during a drag still lets the drop send (backlog A470). The map listens for `pointerdown` and
  `keydown` and never stops them (`:330-331`, `:534-552`, `:598-602`): **the till's idle logout restarts
  on a `pointerdown` or `keydown` that reaches the app's host, so nothing this slice adds to the map
  or the floor screen may stop either one** (slice 3's note).
- **The floor screen.** `till-floor-screen` has the app's `api` (`apps/till/src/screens/till-floor-screen.ts:413`,
  passed by the card grid, `apps/till/src/widgets/card-grid.ts:478-488`) and calls it itself for the
  old placement writes, sending `floor-refresh` after (`:628-655`). It works out the zone on screen in
  `#zoneOnScreen` (`:710-751`: `planned`, `listed`, `onMap`, `unplaced`), draws a planned zone's map
  in `#plannedMap` (`:854-872`), seats a free table through `till-seat-dialog` and `open-table`
  (`#openTable` `:532-548`, `#onSeatConfirm` `:550-555`, `#seatDialog` `:954-966`), and opens the
  details sheet on `wt-table-details` (`#onDetails` `:557-561`, `#detailsSheet` `:572-589`, headed
  by `#detailsHeading`, `:564-570`). Its action row (the List/Map toggle and Edit plan) is
  `<div class="actions">` at `:780-801`; the closed-zone message is a `<p data-zone-closed
  role="status">` (`:809`).
- **The details sheet** (`apps/till/src/widgets/table-details-sheet.ts`) is a `wt-dialog` showing a
  table's lines (`#lines`, `:105-142`) with Close and, for a table needing clearing, Mark cleared in
  its footer (`:160-179`). It saves nothing. The order screen's status pin opens it too
  (`apps/till/src/widgets/table-status.ts`).
- **The app** seats through `open-table` (`#openTableFromEvent`, `apps/till/src/till-app.ts:5101-5105`,
  `api.seatTable` at `:5207`, the party's `tableIds` at `:5223`), and handles `join-tables` and
  `split-table` from the order screen with `this.orderParty` (`:7207-7228`, `:7247-7274`). Its
  `otherPartyRead` (`:425-432`) builds what a join sends about the party read at the target table;
  `seatedRead` is already exported from `apps/till/src/widgets/table-targets.ts`, beside
  `tableTarget` (`:64`), which draws one table of a picker with its condition. The order screen asks
  which bills to keep with `till-bill-choice-dialog` (`apps/till/src/widgets/bill-choice-dialog.ts:17`,
  `scope` and `question`, events `bill-choice-confirm` with `{ bills }` and `bill-choice-cancel`).
- **Forms.** `till-party-name-dialog` (`apps/till/src/widgets/party-name-dialog.ts`) is the till's
  model of design-system.md → Forms (`docs/developers/design-system.md:1828-1906`): `draftScopeFor`
  taken only while connected (`:57-59`), `saveActionState` binding Save (`:145`) and the early
  return (`:102`), with `party-name-dialog.save-state.test.ts` and `party-name-dialog.unsaved.test.ts`
  (its reconnect case at `:132`). `saveActionState(scope, { savableAtOpen })`
  (`packages/ui/src/leave-controller.ts:141-145`) never reads a form opened with a value to confirm
  as unchanged.

### Slice 4 decisions (added at expansion)

Each is the default this slice builds; the owner may override any at review. Each says what it costs
if it is wrong.

1. **Every new route answers 204 and the till re-reads the floor**, as Mark cleared does. The
   floor screen calls `api` itself for every today's change it starts, the party joins and splits
   included, and shows a refusal in its own status line (`<p data-floor-refusal role="status">`,
   beside `data-zone-closed`), in the code's words (`codeMessage`), cleared by its next action or a
   change of zone; then it sends `floor-refresh`. Only seating goes through the app, which opens the
   order. Cost: a floor join refused `party.out_of_date` says that code's own words
   (`apps/till/src/i18n/codes.ts:47`) and re-reads, not the app's sentence naming what changed
   (`#onPartyOutOfDate`, `till-app.ts:5685`).
2. **The routes and their bodies.** All are `POST`, `requireSession(deps, c, { action: "take-orders" })`,
   then one `withTransaction` that runs `checkZones` first, then `catchUpFloor`, then the write:
   - `/api/tables/:id/today/move` `{ x, y }`, whole numbers 0–999: the table's new top-left corner.
     For a table in a merge, every member moves by the same distance, held so that none passes 0 or
     999.
   - `/api/tables/:id/today/rotate` `{}`: 15° more, clockwise, about the table's centre (`x`, `y`
     unchanged, the plan's decision 9).
   - `/api/tables/:id/today/take-off` and `/put-back` `{}`. Taking off an already taken-off table,
     or putting back one that is not, changes nothing and answers 204.
   - `/api/tables/:id/today/place` `{ x, y }`: a spare goes on the map at that corner, 8 × 8 squares,
     `rect`, not turned (a spare has no size anywhere: the master stores a spare with all six
     placement columns null). A table that already has a place is left as it is, 204.
   - `/api/tables/:id/today/seats` `{ seats }`, a whole number 1–999: the table's seats for today,
     or its merge's.
   - `/api/tables/:id/today/back` `{}`: the table's row is set from its `floor_reset_tables` row
     (seats, fixed, place, not taken off), after it leaves any merge.
   - `/api/tables/:id/today/merge` `{ targetId, side, seats? }`: two free tables (no party holds
     either) become one merge; `seats` 1–999.
   - `/api/tables/:id/today/split` `{}`: a free merge ends; every member goes back to where it stood
     before. A table in no merge: 204, nothing changes.
   - `/api/zones/:id/today/reset` `{}`: `resetZone` for that zone. A zone with no master plan, or a
     disabled one, is left alone and answers 204, as `ensureToday` skips them (`floor-today-store.ts:389-398`).
   - `POST /api/tables/:id/seat` gains an optional `withTableIds: string[]`: each table joins the new
     party in the same transaction, through `joinTables`, so a party sits at two fixed tables in one
     request (decision 9). The route zone-checks those tables too.
   - `POST /api/parties/:id/join` gains an optional `merge: { moving, target, side, seats? }`, where
     `{ moving, target }` are the body's `tableId` and one table the path party holds, in either
     order; after the join, `moving` is merged against `target`. The whole request is one
     transaction, so a refused merge undoes the join.
   - `POST /api/parties/:id/split-table` puts the split table back where it stood before its merge.
   Cost: the till makes one more read after each change than an answer carrying the floor would.
3. **What each route refuses, in this order, with existing codes where one fits.** A malformed path
   id is `table.not_found` (as the seat route, `till-api.ts:2249`); a malformed body field is
   `management.request_invalid { field }`; a table in another venue or none is `table.not_found`;
   then, for the table the change names, in the order listed here, on every today route and the
   merge route (on the join route carrying `merge`, `joinTables`' own refusals come first —
   `service_zone.join_mismatch`, `table.needs_clearing`, `table-actions.ts:123-132` — and
   `writeMerge`'s follow in this order):
   - **`table.not_in_floor_plan { tableId }`** (new): it has no today's row; or, for a move, turn or
     merge, it has no place (a spare); or, for Back to its saved place, its reset row is missing or
     says the table goes (its master table was deleted).
   - **`table.taken_off { tableId }`** (new): a move, turn, place, seats or merge of a taken-off table,
     and (finish-branch review, 2026-10-11) a seat, join, Move guests or bill move onto one.
   - **`table.fixed { tableId }`** (new): a move, turn or merge of a fixed table, either side of a
     merge, and placing a fixed spare (decision 11). This is Review focus 5.
   - **`table.merged { tableId }`** (new): turning or taking off a table in a merge, or merging a
     table that is already in one as the table that moves (a table already in a merge may be the
     target, decision 6).
   - `tab.already_open` (existing): taking off, or merging through the merge route, a table a party
     holds, and the today split of a merge a party holds.
   - `table.needs_clearing` (existing): taking off or merging a table that needs clearing.
   - **`table.delivery_pending { tableId }`** (new): taking off a table with food on its way to it
     (decision 12).
   - `service_zone.join_mismatch` (existing): a merge of tables in two zones.
   - `floor_plan.invalid { field: "seats" }` (existing; its comment widens): a merge whose tables
     have no join with exactly them in today's copy of the master's joins (Task 4.3f), sent without
     `seats`. The till answers it by asking (decision 7).
   Each new code gets its `apps/server/src/errors.ts` entry beside `table.in_floor_plan`, 409 in the
   till's `STATUS` (and `floor_plan.invalid` 400 there), English and Spanish in
   `apps/till/src/i18n/codes.ts` and `apps/dashboard/src/i18n/codes.ts` (the Global constraints'
   rule), and a place in `TABLE_REFUSALS`. Cost: five new codes; each names one thing a person can
   act on.
4. **Which way a joined table touches its target.** The till picks the side from where the dragged
   table was dropped (for Join with…, where it stands): the vector from the target's centre to the
   dropped table's centre is turned back by the target's rotation, and the side is right or left
   when `|dx| / (target width + moving width) ≥ |dy| / (target height + moving height)`, else
   bottom or top; a tie goes left–right, and centres that coincide give `right`. The server places
   the moving table so that, in the target's turned frame, the two boxes share that edge and their
   centres line up across it; the moving table takes the target's rotation; its corner is the nearest
   whole square (`Math.round`), held to 0–999. Where that place would cover a member of the target's
   merge, the target included, by a square or more both ways (each box's extents in the target's
   turned frame), the next side is tried: the two sides across the chosen one, top before bottom
   and left before right, then its opposite (`freeSide`); with all four covered the chosen side
   stands. The till sends the side `joinSide` picked and the server applies `freeSide` to the
   merge's members as they stand, so a stale or hand-made side is checked like any other. All
   of it lives in one pure module, `packages/shared/src/floor-join.ts` (`joinSide`, `touchingPlace`,
   `freeSide`), so the till can draw the merge before the server answers (decision 14) and the
   server places it the same way. Cost: at a rotation that is not a multiple of 90°, or with an odd
   difference of sizes, rounding leaves a gap or an overlap under one square; a member turned
   another way than the target counts by its extents, which can cover more than it does; a table
   overlaps a member by a whole square or more only when all four sides are covered.
5. **Who joins whom on a drop.** The dragged table goes to the target, so a join's path party is the
   TARGET's party when both are seated (the dragged party combines into it, the bill choice asked
   first, as the order screen asks), else whichever party sits there; the body's `tableId` is the
   other table. The target member is the member of the target group whose centre is nearest the
   dragged table's centre. Cost: a waiter who means the other direction drags the other table.
6. **A merge is dragged as a whole, and only a single table joins anything.** A merge dropped on
   empty space moves (decision 2); a merge dropped on another table springs back and the status line
   says "Drag the other table onto it" (`floor.drop_merge`). A single table dropped on a merge joins
   it, placed against the member nearest the drop. Joining a free table to a seated merge, or a
   seated table to a free merge, makes the party hold every member (decision 8), and so does Move
   guests to a table of a free merge (`moveGuests` adds only the table it names,
   `table-actions.ts:96-99`, so the move route runs `joinMergeMembers` for it too, Task 4.3d). A
   merge's members are all held by one party or all free: seating, joining, moving and splitting
   keep it so (reasoned, not run). Cost: dragging a merge onto a table does nothing; the waiter drags the table instead.
7. **Seats for a merge.** From the join in today's copy of the master's joins whose members are
   exactly the merge's tables (Tasks 4.3e and 4.3f). **Overridden by the owner on 2026-10-10**
   (`~/waitron-campaign/questions.md`, "OWNER ANSWER 2026-10-10 ~23:16"): "today's floor plans should
   be independent of the ones that will be published tomorrow." The default this replaced read the
   master's saved join as it is now, because a reset copied no joins. Now every reset of a zone (the
   day's first floor read or change, Reset to saved plan, and the zone's first save) replaces the
   zone's copy with the master's saved joins, in the reset's transaction, and the merge reads only
   the copy. A join saved, changed or deleted in the editor during the day waits for the next reset.
   The owner's example: a join of 4+5 with 6 seats saved in the editor at 13:00, and a waiter merging
   4 and 5 at 13:30, does NOT get 6 seats; today's copy has no such join, so the till asks. Without a
   join in the copy the route refuses `floor_plan.invalid { field: "seats" }` before anything changes,
   and the till opens the seats prompt with the members' seats for today added up (a table without
   seats counts 0) and sends again with `seats`. The same holds when a merge grows: its seats are
   worked out again for all its members. Cost: a join saved mid-service is not used until the next
   reset; growing a merge asks again even when the waiter set its seats; and a today's plan built
   before Task 4.3e's migration has no copy until its zone's next reset, so its merges ask until then
   (pre-production, so nothing fills the copy in for it: CLAUDE.md §3, no data-migration code before
   go-live).
8. **Seating at a merge seats every member** (the plan's decision 18), in `seatTable`, so a booking
   seated through the core seam does too (`moduleCoreServices`, `parties.ts:101-104`). A member a
   party holds refuses `tab.already_open { tableId: <member> }`, one needing clearing
   `table.needs_clearing`. A table joined to a party (the join route, and the seat route's
   `withTableIds`) brings every free member of its merge into the party too. Cost: none expected.
9. **A join involving a fixed table moves nothing and writes no merge** (spec §6.1). Two free tables,
   one fixed: the seat dialog opens for the dragged table, headed with both names as `mergeLabel` names them ("Bar 1+2", `packages/ui/src/components/wt-floor-map.ts:96-97`; "Bar" is shown once by the shared-first-word rule, `packages/shared/src/party-name.ts:16-17`),
   and its confirm seats the party at the dragged table with `withTableIds` naming the target's
   members, in one request. One seated: the join route without `merge`. Both seated: the bill choice,
   then the join route. Cost: none expected; the plan's Task 4.3 had two requests (seat, then join),
   which could leave a party at one table when the second failed.
10. **A party at several groups on one map is drawn linked**: every group whose tables one party
    holds (outside one merge) carries that party's id as `linkId`; the map draws a 1 px line between
    the groups' centres in label order, the name once, on the first group, as `mergeLabel` of all
    their labels when it fits, and gives every group the combined status, as a merge's members get
    one. Each group stays its own button. Cost: a party joined through the order screen across two
    movable tables (which writes no merge) is drawn linked too; that is the same party, so it reads
    right.
11. **A fixed spare cannot be placed from the till** (`table.fixed`), and Add a spare table lists
    only movable spares: a fixed table never moves, so a stool put down in the middle could not be
    moved to its place. Cost: a spare stool is set out in the editor, and goes live at the next reset.
12. **Take off for today needs a free table**: no party (`tab.already_open`, the spec), not needing
    clearing (`table.needs_clearing`), no food on its way (`table.delivery_pending`), not in a merge
    (`table.merged`). This answers A470's first slice 4 note: the till lists a taken-off table that
    needs clearing or has a delivery on its way (`listedTables`, `apps/till/src/state/floor-map.ts:168-175`),
    and such a take-off would hide nothing, so it is refused. A free table with a booking today may
    be taken off. Seating at a taken-off table is not refused: a stale till that does so makes the
    table held, and the list shows it. Cost: a waiter clears the table first. (Finish-branch review,
    2026-10-11: seating, joining, Move guests and moving a bill onto a taken-off table are now
    refused, `table.taken_off` through `refuseTakenOff`; the dashboard's bookings still seat through
    `seatTable` without that check.)
13. **A470's second slice 4 note** (a merge's members in different zones, while the map reads one
    zone): the join route already refuses tables in two zones (`table-actions.ts:122-128`) and the
    merge route refuses them too (decision 3), so a merge's members always share its zone. Cost: none.
14. **A dropped table stays where it was dropped until the next floor read**, so it does not spring
    back while the server answers: the floor screen keeps the dropped group's new place (for a merge,
    `touchingPlace`) in `#pending` and draws it in the map's `tables`, until the app next assigns
    `tables` or the write is refused or cancelled, when it goes back. Cost: if a poll that began
    before the drop answers after the move was written but before the move's own re-read, the table
    flickers back once (the app applies a read only when it is newer, slice 3 decision 13).
15. **The till client keeps its existing calls as they are**: `seatTable(tableId, guestCount)` and
    the app's four-argument `joinTables` calls stay byte for byte (the pins above); the new shapes are
    a new method `seatAtTables(tableId, guestCount, withTableIds)` and an optional fifth argument,
    `merge`, on `joinTables`, sent only when given. Cost: two ways to seat.
16. **The details sheet shows today's actions only on the floor** (a new `actions` property, false by
    default; the status pin leaves it off), each only where it applies (Task 4.5a's table). Rotate
    keeps the sheet open, so it can be pressed again; every other action closes it. Split on a free
    merge ends it; on a seated merge it splits off the merge's last member in label order with no bill
    (`billId: null`, a new empty bill), one table a press. Join with… is offered for a single placed
    table, not a merge (decision 6). Cost: from the sheet a waiter cannot choose which table of a
    seated merge leaves, or move a bill with it; the order screen's Split a table still can.
17. **The zone menu** is a `wt-row-actions` ("Today's plan", `floor.zone_menu`) in the floor screen's
    action row, shown while the active zone is planned, in both views (finish-branch review,
    2026-10-11: or while the zone has a saved plan, `hasPlan` on `/api/zones`, so a saved plan with
    no tables still offers Reset). Add a spare table and Taken
    off today open a list in a `wt-dialog`; each row acts at once. A spare is put in the middle of
    the zone's crop as the map first fits it (`cropToTables` of the placed tables; with none, at 0,
    0), not the middle of a zoomed view: the map does not tell the screen its view. Reset to saved plan
    asks first, its Reset button `danger`. Cost: a spare placed while zoomed into a corner can land
    off screen, and the crop's middle can fall on a table already there, so the spare is drawn over
    it until dragged away. The editor's free-spot search, `firstFreeSpot`
    (`packages/ui/src/floor-plan-geometry.ts:123-134`), scans row by row from the top-left corner, not
    out from a point, so it is not used here.
18. **Forms.** The seats prompt and Change seats are one new dialog, `till-today-seats-dialog`, which
    holds a typed number, so A331's rule applies: `draftScopeFor`, `saveActionState`, the early
    return, and a `*.unsaved.test.ts` with a reconnect case. The prompt opens with the suggested sum
    and `{ savableAtOpen: true }` when the sum is above 0 (its Join is ready at once), empty and
    unchanged when it is 0; Change seats opens at today's seats and its Save waits for a change. Join
    with…, Add a spare table, Taken off today and Reset to saved plan hold nothing typed, take no
    draft scope and have no `*.unsaved.test.ts`; their buttons act at once, so none waits quiet. The
    seat dialog and the bill choice dialog are used as they are. Cost: none.
19. **Words.** Short, where the meaning shows (owner, 2026-10-09). New till strings, EN / ES:
    `floor.join_with` "Join with…" / "Unir con…"; `floor.split` "Split" / "Separar"; `floor.rotate`
    (existing, "Rotate" / "Girar", `apps/till/src/i18n/strings.ts:518`, `:1665`; slice 5 keeps it);
    `floor.change_seats` "Change seats" / "Cambiar plazas"; `floor.back_to_saved` "Back to saved place"
    / "Volver a su sitio"; `floor.take_off` "Take off for today" / "Quitar por hoy"; `floor.zone_menu`
    "Today's plan" / "Plano de hoy"; `floor.add_spare` "Add a spare table" / "Añadir mesa de
    reserva"; `floor.no_spares` "No spare tables — add some in the floor plan editor" / "No hay mesas
    de reserva: añádelas en el editor del plano"; `floor.taken_off` "Taken off today" / "Quitadas
    hoy"; `floor.none_taken_off` "None" / "Ninguna"; `floor.put_back` "Put back" / "Volver a poner";
    `floor.reset_plan` "Reset to saved plan" / "Volver al plano guardado"; `floor.reset_title`
    "Reset {zone}?" / "¿Restablecer {zone}?"; `floor.reset_body` "Free tables go back now, occupied
    ones once free." / "Las libres vuelven ya; las ocupadas, al quedar libres."; `floor.reset_confirm`
    "Reset" / "Restablecer"; `floor.seats_title` "Seats for {table}" / "Plazas para {table}";
    `floor.seats_label` "Seats" / "Plazas"; `floor.seats_invalid` "Enter 1 to 999" / "Escribe de 1 a
    999"; `floor.seats_join` "Join" / "Unir"; `floor.seats_save` "Save" / "Guardar";
    `floor.join_with_title` "Join {table} with" / "Unir {table} con"; `floor.drop_merge` "Drag the
    other table onto it" / "Arrastra la otra mesa encima". The five codes' words: `table.fixed`
    "That table is fixed in place" / "Esa mesa está fija"; `table.merged` "That table is joined to
    another. Split it first" / "Esa mesa está unida a otra. Sepárala primero"; `table.taken_off`
    "That table is off today's plan. Put it back first" / "Esa mesa está quitada hoy. Vuelve a
    ponerla primero"; `table.not_in_floor_plan` "That table is not on today's plan" / "Esa mesa no
    está en el plano de hoy"; `table.delivery_pending` "Food is on its way to that table" / "Hay
    comida en camino a esa mesa". Cost: the look pass may shorten more. (The look pass shortened `floor.no_spares`
    to "No spare tables" / "No hay mesas de reserva", 2026-10-11.)
20. **STOP for the owner: the editor's note changes an assertion "Behaviour this plan removes" does
    not list.** Slice 2 decision 16 has `floor_plan_editor.note` ("Your changes will go live
    tomorrow." / "Tus cambios se aplicarán mañana.", `apps/dashboard/src/i18n/strings.ts:990`,
    `:3599`) gain "or sooner with Reset to saved plan on the till" once that button exists, and two
    existing assertions pin the old sentence: `apps/dashboard/src/screens/floor-plan-editor.test.ts:133`
    and `apps/dashboard/src/screens/floor-plan-editor.save.test.ts:251`. Proposed: "Your changes go
    live tomorrow, or sooner with Reset to saved plan on the till." / "Tus cambios se aplican mañana, o
    antes con Volver al plano guardado en el TPV." The entry is added to "Behaviour this plan removes"
    as proposed; Task 4.5c changes the note and those two assertions only after the owner says yes.
    Task 4.5c builds everything else either way. Cost: the editor's note stays unchanged until the
    owner answers. The owner said yes on 2026-10-10.
21. **The map's fixed drag.** While a fixed table is held and dragged, a copy (`part="ghost"`, the
    table's shape at half opacity) follows the finger in whole squares and the table stays; over
    another table the target is marked (`data-drop-target`) and a 1 px line (`part="drag-link"`)
    joins the two centres; on release the copy goes at once (no animation) and the drop is sent as
    for any table. A movable table's drag marks its target the same way, without the line. Cost: the
    spring back is a jump, not a motion; the look pass may ask for one.
22. **A re-read that removes the held table ends its drag and sends no drop** (A470's drop note);
    a re-read that keeps it keeps the drag, as now (`wt-floor-map.view.test.ts:402-412`). Cost: none.

**Mutation runs.** As slices 2 and 3: each task that adds a `packages/ui` or `packages/shared` file,
or grows `wt-floor-map.ts`, runs
`gtimeout 900 pnpm --filter <package> exec stryker run --mutate <file>` once, and a survivor gets an
exact-value assertion. If it cannot start or runs out of time, say so in the commit message.

**Fake timers, pointer events and dialogs** are as slice 3 states them: fake only the timers a case
needs, restore real timers in `afterEach`, dispatch pointer events as `wt-floor-plan-canvas.test.ts`
does, and wait for a dialog's `wt-close` event, never a sleep.

**Server tests** use a real database (`useVenueDb` with `migrationOptionsFor(manifestSets(), null)`)
and build a planned zone through `saveZonePlan` (whose first save builds today's plan), as
`apps/server/src/floor-catch-up.test.ts:148-152` does. Task 4.1a moves that setup into a helper the
later tasks share, `apps/server/src/testing/floor-today-venue.ts`, which `apps/server`'s coverage
leaves out (`apps/server/vitest.config.ts:30`). Rejected writes assert the domain code.

### Task 4.1a: Today's moves — move, turn and place a spare

**Files:**
- Create: `apps/server/src/testing/floor-today-venue.ts`, `apps/server/src/floor-today-moves.test.ts`
- Modify: `apps/server/src/floor-today-store.ts` (today's writes after `ensureToday`, `:423`),
  `apps/server/src/errors.ts` (four codes after `table.in_floor_plan`, `:320`)

**Interfaces:**
- Produces:

```ts
// testing/floor-today-venue.ts
export interface PlannedEntry { key: string; label?: string; seats?: number | null; fixed?: boolean;
  place?: { x: number; y: number; width?: number; height?: number; rotation?: number } | null }
/** A fresh table-service zone (as floor-catch-up.test.ts:113-131), its live tables, and a first saved
 * master holding `entries` and `joins`, which builds today's plan. Labels are made unique. */
export async function plannedZone(v: PartyVenue, entries: PlannedEntry[],
  joins?: { seats: number; keys: string[] }[], now?: Date):
  Promise<{ zoneId: string; table: Record<string, string>; master: Record<string, string>; revision: number }>;
export async function todayRow(v: PartyVenue, tableId: string): Promise<typeof floorTodayTables.$inferSelect | undefined>;
export async function mergeOf(v: PartyVenue, tableId: string): Promise<{ joinId: string; seats: number; members: { tableId: string; beforeX: number; beforeY: number; beforeRotation: number }[] } | null>;

// floor-today-store.ts
export async function moveToday(tx: Transaction, cfg: TillConfig, tableId: string, at: { x: number; y: number }): Promise<void>;
export async function rotateToday(tx: Transaction, cfg: TillConfig, tableId: string): Promise<void>;
export async function placeSpareToday(tx: Transaction, cfg: TillConfig, tableId: string, at: { x: number; y: number }): Promise<void>;
```

- New codes in `errors.ts` (each with a one-line comment saying when it is thrown, as its
  neighbours have): `table.not_in_floor_plan { tableId }`, `table.taken_off { tableId }`,
  `table.fixed { tableId }`, `table.merged { tableId }`.

Behaviour (decisions 2, 3, 11): one private reader, `todayOf(tx, cfg, tableId)`, reads the table's
`dining_tables` row in `cfg.locationId` (none: `table.not_found`), its `floor_today_tables` row (none:
`table.not_in_floor_plan`) and its merge's id and members; each write refuses in decision 3's order.
`moveToday` refuses a spare (`table.not_in_floor_plan`), `table.taken_off`, `table.fixed`; for a
merged table it moves every member by `(at.x − x, at.y − y)`, that distance first held so that every
member's `x` and `y` stay within 0–999. `rotateToday` refuses a spare, taken off, fixed and
`table.merged`, then sets `rotation = (rotation + 15) % 360`. `placeSpareToday` refuses
`table.taken_off` and `table.fixed`; a placed table is left alone; a spare gets `{ x, y, width: 8,
height: 8, shape: "rect", rotation: 0 }`. Queries on the transaction are awaited one after another.

- [ ] **Step 1: Write the helper and the failing tests** in `floor-today-moves.test.ts`
  (`setupPartyVenue` and `useVenueDb` as `floor-catch-up.test.ts:45-52`; `NOW` as there):

```ts
it("moves a table on today's plan and leaves the master alone", async () => { /* place (0,0) → moveToday {x: 12, y: 3} → todayRow x 12, y 3; the master table's x, y unchanged */ });
it("moves a merge as one, held at the edge", async () => {
  /* a merge written straight into floor_today_joins/_join_tables of A (0,0) and B (8,0); move A to {x: 4, y: 2} → A (4,2), B (12,2);
     move B to {x: 2, y: 0}, a step of (-10, -2) → held at the left edge: A (0, 0), B (8, 0) */
});
it("turns a table 15° about its centre, from 345° back to 0", async () => { /* rotation 0 → 15, x and y unchanged; set 345 → 0 */ });
it("refuses to move or turn a fixed table, and nothing moves", async () => { /* fixed entry: moveToday and rotateToday reject table.fixed { tableId }; todayRow unchanged */ });
it("refuses to turn a table in a merge", async () => { /* table.merged */ });
it("refuses a spare, a taken-off table and a table never on a plan", async () => {
  /* spare: move/rotate → table.not_in_floor_plan; taken off (set taken_off true): move → table.taken_off; a live table of the zone with no today's row → table.not_in_floor_plan */
});
it("refuses a table of another venue as not found", async () => { /* random uuid → table.not_found */ });
it("places a spare 8 × 8 at the corner it is given, and leaves a placed table where it is", async () => {
  /* spare → placeSpareToday {x: 20, y: 10} → { x: 20, y: 10, width: 8, height: 8, shape: "rect", rotation: 0 }; a placed table at (0,0) → unchanged */
});
it("refuses to place a fixed spare or a taken-off one", async () => { /* table.fixed; table.taken_off */ });
it("puts a placed spare back among the spares at the next reset", async () => { /* placeSpareToday {x: 20, y: 10} → todayRow x 20 (so the case cannot pass on a write that did nothing); then resetZone → placement columns all null (spec §13) */ });
```

- [ ] **Step 2: Run and watch them fail** — `pnpm --filter @waitron/server exec vitest run src/floor-today-moves.test.ts`.
  Expected: the file fails to load (`moveToday` is not exported).
- [ ] **Step 3: Implement** the three writes and the four codes.
- [ ] **Step 4: Run** the same command (read the `Tests` count), `pnpm --filter @waitron/server typecheck`,
  `pnpm --filter @waitron/server lint`, `pnpm exec prettier --check` on the changed files,
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts` (neither reads
  `apps/server/src/errors.ts` for a refusal code, by their headers; run as the brief asks).
- [ ] **Step 5: Commit** — e.g. "Till floor: move, turn and place a spare on today's plan, never a
  fixed table (A429 slice 4)".

### Task 4.1b: Today's changes — take off, put back, seats and back to its saved place

**Files:**
- Create: `apps/server/src/floor-today-changes.test.ts`
- Modify: `apps/server/src/floor-today-store.ts`, `apps/server/src/errors.ts` (`table.delivery_pending`)

**Interfaces:**
- Consumes: Task 4.1a's `todayOf` and helper; `foodOnItsWay` (`delivery-release.ts:25`);
  `leaveMerges` (`floor-today-merges.ts:9`).
- Produces:

```ts
export async function takeOffToday(tx: Transaction, cfg: TillConfig, tableId: string): Promise<void>;
export async function putBackToday(tx: Transaction, cfg: TillConfig, tableId: string): Promise<void>;
export async function seatsToday(tx: Transaction, cfg: TillConfig, tableId: string, seats: number): Promise<void>;
export async function backToSaved(tx: Transaction, cfg: TillConfig, tableId: string): Promise<void>;
```

Behaviour (decisions 2, 3, 12): `takeOffToday` refuses in decision 3's order: `table.not_in_floor_plan` (no today's row), `table.merged`, then
`tab.already_open` (an open `party_tables` row), `table.needs_clearing` (`needs_clearing_since` set),
`table.delivery_pending` (an order delivered to it matching `foodOnItsWay()`); an already taken-off
table is left as it is; else `taken_off = true`, keeping its place. `putBackToday` sets `taken_off = false`.
`seatsToday` sets the merge's `floor_today_joins.seats` for a merged table, else the table's own
seats; a taken-off table is `table.taken_off`. `backToSaved` reads the table's `floor_reset_tables`
row (by `table_id`); none, or `remove` true, is `table.not_in_floor_plan`; it then runs
`leaveMerges(tx, [tableId])` and sets the today's row's seats, fixed, six placement columns (null
for a row that copied a spare) and `taken_off = false` from it. It never renames: names change only
at a reset or a catch-up.

- [ ] **Step 1: Write the failing tests** in `floor-today-changes.test.ts`, with Task 4.1a's helper:

```ts
it("takes a free table off for today, keeping its place, and puts it back there", async () => { /* taken_off true, x/y kept; putBack → taken_off false, same x/y */ });
it("taking off twice, or putting back a table on the plan, changes nothing", async () => { /* no throw; rows unchanged */ });
it("refuses to take off a seated table, one needing clearing, one with food on its way and one in a merge", async () => {
  /* (each table has one cause only) seat(v, t) → tab.already_open; needs_clearing_since set → table.needs_clearing;
     a counter order delivered to it with food on its way (as floor-catch-up.test.ts's counterOrder) → table.delivery_pending; a merged table → table.merged */
});
it("sets a table's seats for today, and a merge's for a member", async () => { /* seatsToday(t, 6) → today seats 6, master unchanged; merged member → floor_today_joins.seats */ });
it("refuses seats for a taken-off table", async () => { /* table.taken_off */ });
it("puts a table back as the last reset copied it, not as the master is now", async () => {
  /* move, turn, seats 9, take off; then edit the master (move it, seats 2) without a reset; backToSaved → the reset's place, seats and fixed, taken_off false */
});
it("takes a table out of its merge when it goes back, and puts its partner back too", async () => { /* merge A+B; backToSaved(A) → no merge; B at its before place */ });
it("sends a table the last reset copied as a spare back to the spares", async () => { /* placeSpareToday → todayRow has a place (x not null); backToSaved → placement columns null */ });
it("refuses a table whose master table was deleted, and one never on a plan", async () => {
  /* reset row remove true (delete the master table, reset while a party sits there) → table.not_in_floor_plan; a zone table with no reset row → table.not_in_floor_plan */
});
it("does not rename a table going back to its saved place", async () => { /* a pending reset row with a new label: label unchanged */ });
```

- [ ] **Step 2: Run and watch them fail** — `pnpm --filter @waitron/server exec vitest run src/floor-today-changes.test.ts`.
  Expected: fails to load.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, `src/floor-today-moves.test.ts`, `src/floor-today-store.test.ts`,
  the server's typecheck and lint, `prettier --check`, the two error guards.
- [ ] **Step 5: Commit** — e.g. "Till floor: take a table off for today, put it back, change its seats
  and send it back to its saved place (A429 slice 4)".

### Task 4.2a: Today's routes

**Files:**
- Create: `apps/server/src/floor-today-api.ts`, `apps/server/src/floor-today-api.test.ts`
- Modify: `apps/server/src/till-api.ts` (mount beside `mountDepartmentTransferApi`, `:1091`; `STATUS`,
  `:369`: the five codes 409 and `floor_plan.invalid` 400), `apps/till/src/i18n/codes.ts` (the five
  codes' words, decision 19, beside `table.needs_clearing`, `:75`), `apps/dashboard/src/i18n/codes.ts`
  (the same, beside `table.in_floor_plan`, `:525`), `apps/till/src/till-app.ts` (`TABLE_REFUSALS`,
  `:361-386`)

**Interfaces:**
- Consumes: Tasks 4.1a and 4.1b; `resetZone` (`floor-today-store.ts:71`); `requireSession`,
  `checkZones`, `run`/`Run`, `requireRevision`, `asObject` (`bill-payments-api.js`, as
  `department-transfer-api.ts` imports it), `readRawJsonBody`, `invalid` (`bill-allocation.ts:72`).
- Produces: `export function mountFloorTodayApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void`,
  with the eight routes of decision 2 that are not merges (move, rotate, take-off, put-back, place,
  seats, back, and the zone reset). Each answers 204.

Behaviour: each route is `run(c, log, async () => { const session = await requireSession(deps, c,
{ action: "take-orders" }); … })`; a non-UUID `:id` is `table.not_found` (`zone.not_found` for the
zone route); the body is read before the transaction (`x`, `y` whole 0–999, `seats` whole 1–999, each
else `management.request_invalid` naming the field); then `withTransaction(deps.db, async (tx) => {
await checkZones(tx, deps.cfg, session, [{ tableId: id }]); await ensureToday(tx, deps.cfg,
deps.tableRemovals ?? [], deps.clock.now().instant); await <write>(…); })`. The zone route checks
`[{ zoneId: id }]`, refuses a zone not in the venue `zone.not_found`, and resets only a zone that is
active and has a master plan (decision 2).

- [ ] **Step 1: Write the failing tests** in `floor-today-api.test.ts` (an app mounted as
  `floor-catch-up.test.ts:54-82` mounts one, a signed-in cookie, Task 4.1a's helper):

```ts
it("moves, turns, takes off, puts back, places and sets seats through the routes, answering 204", async () => {
  /* each route → 204; GET /api/tables/state then shows the change in `today` */
});
it("sends a table back to its saved place", async () => { /* move and turn a free table; POST …/today/back → 204; the floor read shows the place the reset copied */ });
it("resets a zone to the saved plan", async () => {
  /* move a free table and a seated one; POST /api/zones/:id/today/reset → the free one back to the master, the seated one where it was */
});
it("catches today's plan up before a change, so the change survives the next read", async () => {
  /* T seated at a reset that moved its master table (its reset row waits); finish T's party; POST …/T/today/move { x: 30, y: 0 } → 204;
     GET /api/tables/state (which catches up too, till-api.ts:2190) → T still at x 30. Control: delete the route's ensureToday call and watch T come back at the master's place */
});
it("leaves a disabled planned zone's tables off on a reset", async () => {
  /* a planned zone switched off (deactivateZone): POST …/today/reset → 204; its tables' dining_tables.active stays false (a reset switches tables on: `resetZoneFor` ends with `catchUpZone`, floor-today-store.ts:132, :295)
     and its floor_today_zones generation is unchanged (its first save wrote the row, so the row itself exists) */
});
it("answers a refusal with its code and status", async () => {
  /* a fixed table's move → 409 table.fixed { tableId }; a spare's rotate → 409 table.not_in_floor_plan; taken off → 409 table.taken_off */
});
it("refuses a malformed id or body", async () => {
  /* /api/tables/not-a-uuid/today/move → 404 table.not_found; { x: 1.5, y: 0 } → 400 management.request_invalid { field: "x" }; seats 0 → { field: "seats" }; /api/zones/not-a-uuid/today/reset → 404 zone.not_found */
});
it("leaves a zone with no master plan alone on a reset", async () => { /* a zone with tables, no plan → 204; no floor_today_zones row for it */ });
```

- [ ] **Step 2: Run and watch them fail** — `pnpm --filter @waitron/server exec vitest run src/floor-today-api.test.ts`.
  Expected: every route answers 404 (none is mounted).
- [ ] **Step 3: Implement**, the `STATUS` entries, the words and `TABLE_REFUSALS`.
- [ ] **Step 4: Run** the same command, `src/device-levers.test.ts` (it walks the till's `STATUS`,
  `:567`), the server's and till's typecheck and lint, `prettier --check`, the two error guards.
- [ ] **Step 5: Commit** — e.g. "Till floor: routes for today's moves, seats, take-offs and the zone
  reset, gated like joining (A429 slice 4)".

### Task 4.2b: Today's routes in both route maps

**Files:**
- Modify: `apps/server/src/till-api.profile-actions.test.ts` (the comment's table, `:45-96`, and
  `ROUTES`, `:274-394`), `apps/server/src/till-api.profile-zones.test.ts` (the comment's table,
  `:67-143`, and `ROUTES`, `:448`)

Behaviour: CLAUDE.md §3 — a new till route adds a row to both maps and a refusing case. The action
map gains one comment row, `POST /api/tables/:id/today/move, /rotate, /take-off, /put-back, /place,
/seats, /back; POST /api/zones/:id/today/reset | take-orders | take-orders`, and one
`ordering("POST", …)` row per route (each refused `device.forbidden_action` before its body is
read, `till-session.ts:122-124`). The zone map gains comment rows (`table` for the seven table routes,
`path zone` for the reset) and one `Row` per route against the Deli fixtures: path
`/api/tables/${x.deliTable}/today/<verb>` with a valid body (`{ x: 1, y: 1 }` for move and place,
`{ seats: 2 }` for seats, `{}` otherwise) and zone `deliTableZone`; the reset
`/api/zones/${x.deliTables}/today/reset`, zone `deliTableZone`. The Deli table has no today's row (its zone has no master plan; reasoned, not run), so
a route that checked anything before the zone would answer `table.not_in_floor_plan`, not
`service_zone.not_allowed`.

- [ ] **Step 1: Add the rows** (they are the failing tests until Task 4.2a's routes exist; with them
  in place they pass at once, so prove each gate by deletion in Step 2).
- [ ] **Step 2: Prove the gates** — delete the `action: "take-orders"` from the move route and watch
  "refuses POST /api/tables/:id/today/move without take-orders" fail; delete the `checkZones` call
  from the reset route and watch "refuses POST /api/zones/:id/today/reset" fail; restore both.
- [ ] **Step 3: Run** `pnpm --filter @waitron/server exec vitest run src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts`,
  `prettier --check`.
- [ ] **Step 4: Commit** — e.g. "Till floor: today's routes in the profile-action and zone maps
  (A429 slice 4)".

### Task 4.3a: The join geometry and today's merge writes

**Files:**
- Create: `packages/shared/src/floor-join.ts`, `packages/shared/src/floor-join.test.ts`,
  `apps/server/src/floor-today-merges.test.ts`
- Modify: `packages/shared/src/index.ts` (export beside `party-name`), `apps/server/src/floor-today-merges.ts`,
  `apps/server/src/errors.ts` (`floor_plan.invalid`'s comment, `:631`, adds today's merge)

**Interfaces:**
- Produces:

```ts
// packages/shared/src/floor-join.ts — whole grid squares; x, y the unturned top-left corner
export type JoinSide = "left" | "right" | "top" | "bottom";
export interface JoinPlace { x: number; y: number; width: number; height: number; rotation: number }
export const JOIN_SIDES: readonly JoinSide[];
/** Decision 4: the side of `target` nearest `moving`'s centre, in the target's turned frame. */
export function joinSide(target: JoinPlace, moving: JoinPlace): JoinSide;
/** Decision 4: where `moving` sits touching `target` on `side`, at the target's rotation, rounded to whole squares and held to 0–999. */
export function touchingPlace(target: JoinPlace, moving: Pick<JoinPlace, "width" | "height">, side: JoinSide): { x: number; y: number; rotation: number };

// apps/server/src/floor-today-merges.ts
/** The seats of the master's saved join with exactly these tables' master tables, or null. */
export async function savedJoinSeats(tx: Transaction, tableIds: readonly string[]): Promise<number | null>;
/** `moving` joins `target`'s merge (or a new one), touching it on `side`; with `free`, neither table may be held or need clearing. */
export async function writeMerge(tx: Transaction, cfg: TillConfig, args: { movingId: string; targetId: string; side: JoinSide; seats: number | null; free: boolean }): Promise<void>;
/** Each table leaves its merge and goes back to where it stood before; a merge left with one member ends as leaveMerges ends it. */
export async function leaveMergesRestoring(tx: Transaction, tableIds: readonly string[]): Promise<void>;
/** Every member of `tableId`'s merge, `tableId` included, or [] when it is in none. */
export async function mergeMembers(tx: Transaction, tableId: string): Promise<string[]>;
```

Behaviour: `writeMerge` refuses `management.request_invalid { field: "targetId" }` when the two are
one table, reads both as Task 4.1a's `todayOf` does, and refuses in decision 3's order:
`table.not_in_floor_plan` (no row or no place), `table.taken_off`, `table.fixed` (either),
`table.merged` (the moving one), then, with `free`, `tab.already_open` and `table.needs_clearing`
(either), then `service_zone.join_mismatch { orderZoneId: <target's zone>, tableZoneId: <moving's
zone> }` (two zones). It works out the merge's members after the join (the target's members, or
the target, plus the moving table); the seats are `args.seats`, else `savedJoinSeats(members)`, else
`floor_plan.invalid { field: "seats" }`, thrown before anything is written. It then records the
moving table's `before_x`, `before_y`, `before_rotation` as it stands (and the target's, for a new
merge), places the moving table at `touchingPlace(target, moving, freeSide(target, moving, <the
target's members>, side))` (decision 4), and writes or updates the
merge (`floor_today_joins` with the target's zone and the seats; `floor_today_join_tables` rows).

- [ ] **Step 1: Write the failing tests:**

```ts
// floor-join.test.ts
it("picks the side the moving table is nearest, in the target's own frame", () => {
  /* target (10,10) 8×8 at 0°: moving centred right → "right", left → "left", below → "bottom", above → "top";
     a tie (dx/16 = dy/16) → "right"; same centre → "right"; target at 90°: a table drawn to its right is on its "top" (the turned frame) */
});
it("weighs each axis by both tables' sizes", () => { /* target 16×4: a moving 4×4 centre at (+6, +5) from its centre → "bottom" (6/20 < 5/8) */ });
it("puts the moving table against the side, centred across it, at the target's rotation", () => {
  /* target (10,10) 8×8 0°, moving 8×8: right → (18,10,0); left → (2,10,0); top → (10,2,0); bottom → (10,18,0); moving 4×2 right → (18,13,0) */
});
it("turns the place with the target", () => { /* target (10,10) 8×8 at 90°, right → centre (14,22) → (10,18,90); at 45° rounds to whole squares (state the expected corner) */ });
it("holds the place within 0 to 999", () => { /* target (2,0) 8×8, left → x 0 (would be -6) */ });

// floor-today-merges.test.ts — Task 4.1a's helper
it("merges two tables, the moving one against the target, with each one's place before", async () => {
  /* A (0,0), B (20,0) 8×8; writeMerge B onto A "right", seats 8 → B (8,0); mergeOf(A).members: A before (0,0,0), B before (20,0,0); seats 8 */
});
it("takes the seats from the saved join with exactly these tables", async () => { /* a master join of A, B with seats 6, no seats sent → 6 */ });
it("refuses a merge with no saved join and no seats, and writes nothing", async () => {
  /* floor_plan.invalid { field: "seats" }; B still at (20,0); no merge. A saved join of A, B, C does not count for A + B */
});
it("grows a merge with a third table, working its seats out again", async () => { /* A+B (seats 8), C onto B "bottom" with seats 12 → three members, seats 12; without seats and no saved join of three → floor_plan.invalid */ });
it("refuses a fixed table either way, a merged moving table, two zones and one table twice", async () => {
  /* table.fixed (moving fixed; target fixed); table.merged (moving in a merge); service_zone.join_mismatch; management.request_invalid { field: "targetId" } */
});
it("refuses a spare and a taken-off table", async () => { /* table.not_in_floor_plan; table.taken_off */ });
it("puts each table that leaves back where it stood before, and ends a merge left with one", async () => {
  /* A+B+C merged: leaveMergesRestoring([C]) → C at its before place, A+B still merged; leaveMergesRestoring([A, B]) → both back, no merge */
});
```

- [ ] **Step 2: Run and watch them fail** — `pnpm --filter @waitron/shared exec vitest run src/floor-join.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/floor-today-merges.test.ts`. Expected: both
  fail to load.
- [ ] **Step 3: Implement.** Then change `joinSide`'s `≥` to `>` and watch the tie case fail; restore.
- [ ] **Step 4: Run** both commands, `src/floor-today-store.test.ts` (it exercises `leaveMerges`),
  both packages' typecheck and lint, `prettier --check`.
- [ ] **Step 5: Mutation** — `gtimeout 900 pnpm --filter @waitron/shared exec stryker run --mutate src/floor-join.ts`.
- [ ] **Step 6: Commit** — e.g. "Till floor: where a joined table goes against its target, and
  today's merges with their seats (A429 slice 4)".

### Task 4.3b: Merging and splitting free tables

**Files:**
- Create: `apps/server/src/floor-today-merge-api.test.ts`
- Modify: `apps/server/src/floor-today-api.ts` (the merge and split routes), `apps/server/src/floor-today-merges.ts`,
  both route maps (as Task 4.2b)

**Interfaces:**
- Consumes: Task 4.3a.
- Produces: `POST /api/tables/:id/today/merge` `{ targetId: uuid, side: JoinSide, seats?: 1–999 }`
  → 204; `POST /api/tables/:id/today/split` `{}` → 204; `export async function splitFreeMerge(tx:
  Transaction, cfg: TillConfig, tableId: string): Promise<void>` in `floor-today-merges.ts`.

Behaviour (decisions 2, 3): the merge route reads its body before the transaction (a non-UUID
`targetId` is `table.not_found`, the path table again is `management.request_invalid { field:
"targetId" }`, a `side` outside `JOIN_SIDES` is `{ field: "side" }`, `seats` outside 1–999 is
`{ field: "seats" }`), zone-checks `[{ tableId: id }, { tableId: targetId }]`, catches up, then
runs `writeMerge(…, { free: true })`, which refuses in decision 3's order. The split route ends a
free merge with `leaveMergesRestoring(members)`; a merge a party holds is `tab.already_open`; a table
in no merge is left alone.

- [ ] **Step 1: Write the failing tests** in `floor-today-merge-api.test.ts` (the app and cookie as Task
  4.2a's):

```ts
it("merges two free tables and splits them back", async () => {
  /* POST …/A/today/merge { targetId: B, side: "right", seats: 8 } → 204; floor read: A and B share a joinId, joinSeats 8, A against B;
     POST …/A/today/split → 204; each back where it stood, no joinId */
});
it("asks for seats when no saved join has exactly these tables", async () => { /* no seats → 400 floor_plan.invalid { field: "seats" }; with a saved join → 204 and its seats */ });
it("refuses to merge a seated table or one needing clearing, and to split a seated merge here", async () => {
  /* tab.already_open; table.needs_clearing; split of a merge a party holds → tab.already_open */
});
it("refuses a malformed merge", async () => { /* targetId "nope" → 404 table.not_found; targetId = the path id → 400 { field: "targetId" }; side "up" → { field: "side" } */ });
// till-api.profile-actions.test.ts: ordering rows for /today/merge and /today/split; the comment row
// till-api.profile-zones.test.ts: rows "POST /api/tables/:id/today/merge (table)" (path deliTable, { targetId: restFreeTable, side: "right" }),
//   "(target)" (path restFreeTable, { targetId: deliTable, side: "right" }) and "POST /api/tables/:id/today/split" (path deliTable, {}),
//   each refused naming the Deli tables zone; a body without a valid side would answer 400 before the zone check
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/server exec vitest run src/floor-today-merge-api.test.ts src/till-api.profile-zones.test.ts src/till-api.profile-actions.test.ts`.
  Expected: the merge and split routes answer 404; the new map rows fail.
- [ ] **Step 3: Implement.** Then delete the merge route's zone check of `targetId` and watch the
  "(target)" row fail; restore.
- [ ] **Step 4: Run** the same command, `src/floor-today-merges.test.ts`, the server's typecheck and
  lint, `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Till floor: merge two free tables and split them back (A429 slice 4)".

### Task 4.3c: Seating at a merge, and one party at several tables

**Files:**
- Create: `apps/server/src/floor-today-seat-api.test.ts`
- Modify: `apps/server/src/parties.ts` (`seatTable`, `:78-98`), `apps/server/src/till-api.ts` (the seat
  route, `:2243-2259`), `apps/server/src/floor-today-merges.ts`, the zone map (as Task 4.2b)

**Interfaces:**
- Consumes: Task 4.3a.
- Produces: the seat route's optional `withTableIds: string[]` (each a UUID, else `table.not_found`
  as `requireTargetTable` refuses one, `till-api.ts:812-818`; not an array, or naming the path table,
  is `management.request_invalid { field: "withTableIds" }`). In `floor-today-merges.ts`: `export
  async function seatMergeMembers(tx: Transaction, partyId: string, tableId: string): Promise<void>`
  (for `seatTable`, with its own checks) and `export async function joinMergeMembers(tx: Transaction,
  cfg: OriginConfig, partyId: string, tableId: string, operatorId: string): Promise<void>` (every
  member of `tableId`'s merge that no party holds joins the party, through `joinTables`, decision 8;
  Task 4.3d's join and move routes use it too).

Behaviour (decisions 8, 9): `seatTable` runs `seatMergeMembers` after its own `party_tables` row
(`parties.ts:95`): every other member of the table's merge joins the party, refused `tab.already_open
{ tableId: <member> }` if a party holds it and `table.needs_clearing` if it needs clearing. The seat
route, with `withTableIds`, zone-checks each, and after `seatTable` runs, for each `otherId` of
`withTableIds` in turn, `joinTables(tx, sendCfg, partyId, otherId, { bills: "merge",
expectedPartyRevision: <the party's revision now>, operatorId, otherPartyId: null })` and then
`joinMergeMembers` for it, reading the revision again before each, all in the one transaction. The
seat route has no `sendCfg` today (it uses `requestCfg` alone, `till-api.ts:2246-2257`); it takes
`sendingCfg(cfg, c, session.device)` as the join route does (`apps/server/src/made-here.ts:37-41`).
A member another party holds is answered as `joinTables` answers it (by decision 6's rule no merge
has one; reasoned, not run).

- [ ] **Step 1: Write the failing tests** in `floor-today-seat-api.test.ts` (as Task 4.3b's):

```ts
it("seats a party at every table of a free merge", async () => {
  /* merge A+B; POST /api/tables/A/seat → party_tables rows for A and B; the floor read shows both held by one party */
});
it("refuses to seat a merge one of whose tables needs clearing, and seats nobody", async () => { /* table.needs_clearing { tableId: B }; no party_tables row for A */ });
it("seats one party at two tables in one request", async () => {
  /* fixed F1, F2: POST /api/tables/F1/seat { guestCount: 2, withTableIds: [F2] } → 200; both held by the answered party; no merge written */
});
it("seats nobody when one of the other tables cannot be joined", async () => { /* F2 needs clearing → 409 table.needs_clearing; F1 free */ });
it("refuses a malformed list of other tables", async () => { /* "x" → management.request_invalid { field: "withTableIds" }; [F1] (the path table) → same; ["nope"] → table.not_found */ });
// till-api.profile-zones.test.ts: a row "POST /api/tables/:id/seat (other tables)" (path restFreeTable, { withTableIds: [deliTable] }), refused naming the Deli tables zone
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/server exec vitest run src/floor-today-seat-api.test.ts src/till-api.profile-zones.test.ts`.
  Expected: the seat cases seat one table; `withTableIds` is ignored; the new map row fails.
- [ ] **Step 3: Implement.** Then delete the seat route's zone check of `withTableIds` and watch the
  "(other tables)" row fail; restore.
- [ ] **Step 4: Run** the same command, `src/till-api.table-actions.test.ts`, `src/party-table-actions.test.ts`,
  `src/floor-catch-up.test.ts`, `src/till-api.profile-actions.test.ts`, the server's typecheck and
  lint, `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Till floor: seat a party at every table of a merge, or at two tables
  at once (A429 slice 4)".

### Task 4.3d: A join that merges, a split that puts the table back, and the fixed table sent a move

**Files:**
- Create: `apps/server/src/till-api.today-joins.test.ts`
- Modify: `apps/server/src/till-api.ts` (the move and join routes, `:2329-2351`, and the split-table
  route, `:2353-2383`), `apps/server/src/floor-today-merges.ts`

**Interfaces:**
- Consumes: Tasks 4.3a–4.3c (`writeMerge`, `leaveMergesRestoring`, `joinMergeMembers`).
- Produces: the join route's optional `merge: { moving: uuid, target: uuid, side: JoinSide, seats?:
  1–999 }`, refused `management.request_invalid { field: "merge" }` unless `{ moving, target }` is
  the body's `tableId` and a table the path party holds.

Behaviour (decisions 2, 5, 6, 8): the shared move/join handler keeps its shape. For `move`, after
`moveGuests` it runs `joinMergeMembers` for the table moved to, so a party moved to a table of a
free merge holds all of it (`moveGuests` adds only that table, `table-actions.ts:96-99`). For
`join`, after `joinTables` (`table-actions.ts:112`) it runs `joinMergeMembers` for the body table and, with
`merge`, `writeMerge` with `movingId`, `targetId`, `side` and `seats` from the body and `free: false`, so a party
joined to a table of a free merge holds all of it; a refusal anywhere rolls the whole request back. The split-table route runs `leaveMergesRestoring(tx,
[tableId])` after `splitTable`.

- [ ] **Step 1: Write the failing tests** in `till-api.today-joins.test.ts` (as Task 4.3b's):

```ts
it("a seated table dragged onto a free one: the party extends and the two merge", async () => {
  /* P at A; POST /api/parties/P/join { tableId: B, expectedPartyRevision, otherPartyId: null, merge: { moving: A, target: B, side: "left", seats: 8 } } → 200;
     P holds A and B; A against B's left; one merge, seats 8 */
});
it("a free table dragged onto a seated one joins the party", async () => { /* merge { moving: B, target: A } with tableId B → B against A */ });
it("two seated tables combine, keeping the bills apart when asked, and merge", async () => {
  /* P at A, Q at B; POST /api/parties/Q/join { tableId: A, bills: "separate", otherPartyId: P, expectedOtherPartyRevision, merge: { moving: A, target: B, … } } → one party, two bills, one merge */
});
it("a party joined to a table of a free merge holds every table of it", async () => { /* merge B+C free; P at A joins B (no merge body) → P holds A, B, C */ });
it("a party moved to a table of a free merge holds every table of it", async () => { /* merge C+D free; P at A moves to C → P holds C and D, A left for clearing as the move leaves it */ });
it("refuses a merge that names neither the party's table nor the body's, and joins nothing", async () => {
  /* merge { moving: X, target: B } → management.request_invalid { field: "merge" }; P still at A only */
});
it("undoes the join when the merge is refused", async () => { /* no saved join, no seats → floor_plan.invalid { field: "seats" }; P still at A only, B free */ });
it("a split table goes back to where it stood before the merge", async () => {
  /* P at A+B, merged with A the target (B moved against it); POST /api/parties/P/split-table { tableId: B, billId: null } → B at its before place,
     no merge, A where it stands (the merge's last table goes back to its before place, floor-today-merges.ts:24-30, which for the target is where it stood) */
});
it("a fixed table sent a move anyway is refused by every route, and nothing moves", async () => {
  /* Review focus 5: fixed F placed, P at a movable M.
     /today/move → 409 table.fixed; /today/rotate → table.fixed; /today/merge as moving and as target → table.fixed;
     /api/parties/P/join { tableId: F, merge: { moving: F, target: M, … } } → table.fixed, and F is not in P;
     F's today's row unchanged after all of them */
});
it("joining a fixed table without a merge links the party and moves nothing, and the link ends when it leaves", async () => {
  /* P at fixed F1; join F2 (no merge) → P holds both, both rows unchanged; finish P → both free, no merge */
});
```

- [ ] **Step 2: Run and watch them fail** — `pnpm --filter @waitron/server exec vitest run src/till-api.today-joins.test.ts`.
  Expected: the merge body is ignored (no merge; no positions change), the free merge's other member
  stays free, the moved party holds C alone, the split table keeps its merged place; the fixed-table
  case fails on its join line (the route ignores `merge`, and `joinTables` adds F to P,
  `table-actions.ts:136`); the last case passes before the change (a guard).
- [ ] **Step 3: Implement.** Then delete `writeMerge`'s fixed check for the target and watch the fixed
  case fail; restore.
- [ ] **Step 4: Run** the same command, `src/till-api.table-actions.test.ts`, `src/party-table-actions.test.ts`,
  `src/till-api.profile-actions.test.ts`, `src/till-api.profile-zones.test.ts`, the server's
  typecheck and lint, `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Till floor: a join that merges the tables, a split that puts the
  table back, and no route moves a fixed table (A429 slice 4)".

### Task 4.3e: Today's copy of the master's joins — the tables

Added 2026-10-11 for the owner's override of decision 7, after Tasks 4.4a–4.4e were built; it and
Task 4.3f change no till code. Every `file:line` in Tasks 4.3e and 4.3f was read at `877c3f1b0`
(the branch rebased on `main` `f56a2d096`). Split from Task 4.3f to keep each task well under 100
tool calls: this one is the schema, its migration and the guards; 4.3f writes and reads the copy.

**Files:**
- Modify: `packages/db/src/schema/floor-plans.ts` (two tables after `floorResetTables`, `:161-193`),
  `packages/db/src/index.ts` (the export list, `:85-96`), `packages/db/src/classification.ts` (two
  `classify` rows after `floor_reset_tables`, `:97`), `scripts/schema-constraints.test.ts` (three
  foreign keys beside `floor_reset_tables`' at `:139-141`, one unique index beside
  `floor_reset_tables_table_key` at `:356`, one check beside the `floor_reset_tables_*_ck` names at
  `:540-547`), `packages/db/src/schema/floor-plans.test.ts`
- Generated: one new core migration under `packages/db/drizzle/` with its snapshot and journal entry

**Interfaces:**
- Produces (exported from `@waitron/db`), with the column vocabulary of `./columns.js` only (`id`,
  `count`, as the sibling tables in this file use them):

```ts
/** The master's saved joins as the zone's last reset copied them; a merge takes its seats from here. */
export const floorResetJoins;      // floor_reset_joins: id, zone_id id not null (FK floor_zones, floor_reset_joins_zone_fk), seats count not null;
                                   //   check floor_reset_joins_seats_ck (seats >= 1, as floor_today_joins_seats_ck); index floor_reset_joins_zone_idx (zone_id)
/** One table of a copied join: the reset row the zone's last reset wrote for it. */
export const floorResetJoinTables; // floor_reset_join_tables: id, join_id id not null (FK floor_reset_joins, floor_reset_join_tables_join_fk),
                                   //   reset_table_id id not null (FK floor_reset_tables, floor_reset_join_tables_table_fk);
                                   //   unique floor_reset_join_tables_join_table_key (join_id, reset_table_id); index floor_reset_join_tables_table_idx (reset_table_id)
```

The names: `floor_today_joins` is taken (today's merges, `floor-plans.ts:236-252`), and these rows
are what the last reset copied, beside `floor_reset_tables` ("What the zone's last reset copied",
`:157-160`).

**Why each key points where it does.** Every key is a plain `foreignKey(...)` with no `onDelete`,
so each is NO ACTION, as every key in this file is.
- `zone_id` → `floor_zones`, as `floor_reset_tables.zone_id` (`:181-185`) and
  `floor_today_joins.zone_id` (`:245-249`): the reset replaces one zone's copy, found by this column.
- A member points at the RESET ROW (`floor_reset_tables.id`, its primary key), not at the master and
  not at `dining_tables`:
  - Not at `floor_plan_joins` or `floor_plan_tables`: `saveZonePlan` deletes and rewrites every
    master join on every save (`apps/server/src/floor-plan.ts:384-393`, `:443-450`) and deletes
    master tables (`:397-408`), so a key into either would refuse the save, and the copy must outlive
    both until the next reset.
  - Not at `dining_tables`: a reset can record a table it has not created yet (`table_id` null until
    a catch-up creates it, `apps/server/src/floor-today-store.ts:279-293`), and the reset row keeps
    its id when that catch-up fills its `table_id` in (`:318-325`). It also keeps this task clear of
    the Global constraints' rule on keys into `dining_tables`, which slice 5 rebuilds.
  - The two places that delete a reset row: `resetZoneFor` deletes all the zone's rows
    (`floor-today-store.ts:125`), and Task 4.3f deletes the zone's copy first; `removeLiveTables`
    deletes one table's row (`apps/server/src/table-removal.ts:96-99`), only for a table the reset
    marked `remove`, whose row has `plan_table_id` null (`targetsFromMaster`,
    `apps/server/src/floor-reset-plan.ts:155-164`), and Task 4.3f copies a member only through a
    row's `plan_table_id`, so no copied join names it (reasoned, not run; Task 4.3f's case (f) runs
    the path).
  - No `ON DELETE CASCADE`: a cascade would quietly shrink a copied join when one of its rows went,
    and the smaller join would then match a smaller merge with the larger join's seats. NO ACTION
    refuses that delete instead.
- Both tables are `state`, with the `STATE` reason (Global constraints); both are state like every
  table they key into, so CLAUDE.md §3's local-to-ledger/state rule is not touched.

**What else reads a table list** (a grep of `apps/`, `packages/` and `scripts/` for
`floor_reset_tables` and `floor_today_join_tables`, 2026-10-11):
- Change feed: every core-classified table becomes a change source (`CORE_CHANGE_SOURCES`,
  `packages/db/src/classification.ts:236-244`), so the two `classify` rows put both tables in the
  feed boot installs (`apps/server/src/boot.ts:1325-1326`), as they put slice 1's today's and reset
  tables there. No live subscription names any today's or reset table (the dashboard's
  `floor-plan` list is the master tables and `dining_tables`,
  `packages/venue-service/src/dashboard/live-queries.ts:74-80`; the till re-reads, the plan's
  decision 13), so no subscription list changes.
- Configuration transfer: not added. The export carries the master plan only (the plan's decision
  15; `packages/db/src/configuration-transfer.ts:43-53`), so `scripts/id-columns-are-references.test.ts`,
  which reads only the declared transferred tables (`:63-65`), does not see these columns.
- `packages/migrations/migrations.manifest.json`: not append-only, so no entry.
- `scripts/schema-constraints.test.ts` lists keys, unique indexes and checks: the rows named under
  Files.
- Slice 5: `floor_reset_tables` gains a NO ACTION child here, so a rebuild of `floor_reset_tables`
  would fail while copied rows exist (CLAUDE.md §3, "list the foreign keys that point at the table").

**The migration.** `pnpm --filter @waitron/db db:generate --name floor_reset_joins`. drizzle-kit
picks the number: the highest under `packages/db/drizzle/` at `877c3f1b0` is `0135`, so expect
`0136`, but use the file it writes. Expected SQL: two `CREATE TABLE`, the three keys inside them, one
`CREATE UNIQUE INDEX`, two `CREATE INDEX`, and no `ALTER TABLE` or rebuild of an existing table:
`grep -l '__new_' <the new .sql>` prints nothing. CLAUDE.md §2's trap (a box with a trigger naming
what a migration changes) does not apply: the migration only creates tables, which no existing
trigger can name, and `applyMigrations` removes the change feed before migrating anyway. A number
collision at rebase is fixed by regenerating (CLAUDE.md §3), never by editing the journal.

- [ ] **Step 1: Write the failing tests** in `floor-plans.test.ts` (its existing setup: `ZONE`,
  `OTHER_ZONE`, `TABLE_1`, `captureError` outside the transaction, `refusalOn` for a unique key,
  `checkFailed` in the `it.each` of checks at `:224-312`):

```ts
it("keeps a reset row in one copied join only once", async () => {
  /* a floor_reset_tables row in ZONE; a floor_reset_joins row (ZONE, seats 6); one member row; a second identical member row →
     refusalOn(error, UNIQUE_VIOLATION, { table: "floor_reset_join_tables", columns: ["join_id", "reset_table_id"] }) */
});
it("refuses to delete a reset row a copied join names", async () => {
  /* the same rows; deleting the reset row → isRefusal(error, FOREIGN_KEY_VIOLATION) (packages/db/src/unique-violation.ts:15,
     sql-state.ts:24) */
});
// in the it.each of checks:
["a copied join with no seats", () => inTx((tx) => tx.insert(floorResetJoins).values({ zoneId: ZONE, seats: 0 })), "floor_reset_joins_seats_ck"],
// and the round trip at :313 gains one copied join with one member, read back
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/db exec vitest run src/schema/floor-plans.test.ts`.
  Expected: the new cases fail with a `TypeError` (on Vitest 4.1.11 an import of a name the module
  does not export arrives as `undefined`, so the file loads; the review ran this);
  `pnpm --filter @waitron/db typecheck` names the missing exports.
- [ ] **Step 3: Implement** the two tables, the exports, the two `classify("…", "state", STATE)` rows
  and the `schema-constraints.test.ts` rows; generate the migration and read its SQL as above.
- [ ] **Step 4: Run the tests and the guards** —
  `pnpm --filter @waitron/db exec vitest run src/schema/floor-plans.test.ts src/classification.test.ts`,
  then from the root
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/id-columns-are-references.test.ts scripts/migration-upgrade.test.ts scripts/column-vocabulary.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`; then
  `pnpm --filter @waitron/db typecheck`, `pnpm --filter @waitron/db lint`, `pnpm exec prettier --check`
  on the changed files. Read each `Tests` count. Expected: all pass. Then delete one of the new
  `classify` rows and watch `scripts/classification-complete.test.ts` and `src/classification.test.ts` fail; restore.
- [ ] **Step 5: Commit** — e.g. "Floor: tables for today's own copy of the master's joins (A429 slice
  4, owner override)". The body says why the tables are core (Global constraints: tables and zones
  are core, and the till's live floor reads them), names the migration file, and quotes the owner's
  answer.

### Task 4.3f: Today's copy of the master's joins — each reset writes it, and a merge reads it

**Files:**
- Modify: `apps/server/src/floor-today-store.ts` (`resetZoneFor`, `:88-139`; imports `:2-14`),
  `apps/server/src/floor-today-merges.ts` (`savedJoinSeats`, `:164-206`; imports `:2-11`),
  `apps/server/src/testing/floor-today-venue.ts` (a helper), `apps/server/src/floor-today-merges.test.ts`,
  `apps/server/src/floor-today-merge-api.test.ts` (the owner's example through the routes; its
  `twoTables`, `:90-100`, also returns `zoneId` and `master`)

**Interfaces:**
- Consumes: Task 4.3e's tables.
- Produces: `savedJoinSeats(tx, tableIds)` keeps its signature; it now reads today's copy. In the test
  helper:

```ts
/** Saves the zone's master again as `readZonePlan` reads it, without `drop`, with exactly `joins` (by master table id). Runs no reset (the zone has a today's plan). */
export async function resaveMaster(v: PartyVenue, zoneId: string,
  change: { joins: { seats: number; masterIds: string[] }[]; drop?: string[] }, now?: Date): Promise<number>; // the new revision
```

**Every path that builds or resets a zone's today's plan** goes through `resetZoneFor`
(`floor-today-store.ts:88-139`), so the copy is written there and nowhere else:
- `resetZone` (`:77-86`), from the zone reset route (Task 4.2a, the till's Reset to saved plan) and
  from a zone's first master save (`floor-plan.ts:468`);
- `ensureToday` (`:387-429`, the call at `:424`), the day's reset at the first floor read or change,
  which every till floor route runs first (`catchUpFloor`).
A grep for `floorResetTables` outside tests finds no other wholesale writer of a zone's reset rows:
`table-removal.ts:96-105` deletes, and on a refused delete puts back, one `remove` row, and
`floor-plan.ts:403-406` sets `plan_table_id` null on the rows of a deleted master table. A catch-up
(`catchUpZone`, `:154-162`) leaves the copy alone: a table it creates later keeps the reset row the
copy names.

**Behaviour.** In `resetZoneFor`, in the reset's own transaction, queries awaited in turn:
1. Before the zone's reset rows are deleted (`:125`): delete the `floor_reset_join_tables` rows of the
   zone's `floor_reset_joins`, then those joins. (Rows that still named a reset row would make that
   delete refuse, Task 4.3e.)
2. Insert the reset rows as now (`:126-137`), with `.returning({ id, planTableId })`.
3. Read the zone's master joins (`floor_plan_joins` through `floor_plans.zone_id`) and their members
   (`floor_plan_join_tables.plan_table_id`). For each join, map each member to the new reset rows
   with that `plan_table_id`. When every member maps to exactly one row, insert a `floor_reset_joins`
   row (the zone, the join's seats) and one `floor_reset_join_tables` row per member. A join with a
   member that maps to no row or to two is not copied (decision below).
4. `catchUpZone`, as now (`:138`).

`savedJoinSeats(tx, tableIds)`: the `floor_reset_tables` rows whose `table_id` is one of `tableIds`
(at most one each, `floor_reset_tables_table_key`); fewer rows than distinct ids, or the same id
twice, is null; then the copied joins with a member among those rows; the one whose members are
exactly those rows gives its `seats`, else null. Its comment becomes "The seats of the join the
zone's last reset copied with exactly these tables, or null. Reads by id alone: the caller checks
the venue first." It stops importing `diningTables`, `floorPlanJoins` and `floorPlanJoinTables` if
nothing else in the file uses them.

**Every reader of the master's joins** (a grep of `apps/` and `packages/` outside tests for
`floorPlanJoins`, `floorPlanJoinTables`, `floor_plan_join` and `savedJoinSeats`):
- `savedJoinSeats` (`floor-today-merges.ts:169-206`) — **moves** to today's copy. Its one caller is
  `writeMerge` (`:238`), which serves the merge route (Task 4.3b) and the join route's `merge`
  (Task 4.3d); both follow it unchanged.
- `readZonePlan` (`floor-plan.ts:139-151`) and `saveZonePlan` (`:384-393`, `:443-450`) — stay: they
  are the dashboard editor's read and save of the master itself.
- The dashboard's live subscription lists (`apps/dashboard/src/api/live-queries.ts:388-389`,
  `packages/venue-service/src/dashboard/live-queries.ts:77-78`), the classification and the
  configuration transfer — stay: the master's own tables.
- Nothing in `apps/till` reads a join; the till acts on the refusal `floor_plan.invalid { field:
  "seats" }` (Tasks 4.4f, 4.4g, 4.5b), so no till task changes.

**At upgrade time.** A box's today's plans built before this task have no copy until their zone's
next reset (the next business day's first floor read or change, or Reset to saved plan); until then
`savedJoinSeats` answers null and the till asks for the seats. Nothing fills the copy in: no
data-migration code before go-live (CLAUDE.md §3). Cost: at most one day of asking.

**Decision this task makes that the owner did not** (the conservative default): a master join one of
whose master tables two live tables follow is not copied, so a merge of those tables asks. Nothing
makes `dining_tables.plan_table_id` unique (`floor-today-merges.ts:178`), so such a reset has two
rows for one master table, and today's reader already answers null for that case (`:179-181`).

An implementer past about 150 tool calls with this task unfinished stops at a passing or cleanly red
point, commits, and hands over (done, left, files, each check's state).

- [ ] **Step 1: Write the helper and the failing tests.** `floor-today-merges.test.ts` uses its
  `threeTables` (`:56-67`, which returns `plannedZone`'s `zoneId`, `table` and `master`), `NOW`, and
  `resetZone(tx, v.cfg, REMOVALS, zoneId, NOW)` inside `inTx`. That file has no `REMOVALS` yet: add
  `const REMOVALS = enabledTableRemovals(ALL_MODULES);` with its import from `./modules.js`, as
  `floor-today-merge-api.test.ts:9` and `:21` do.

```ts
// floor-today-merge-api.test.ts — the owner's example (case a)
it("a join saved in the editor waits for the next reset", async () => {
  /* twoTables() with no join; resaveMaster(zoneId, { joins: [{ seats: 6, masterIds: [master.a, master.b] }] });
     POST …/a/today/merge { targetId: b, side: "right" } → 400 floor_plan.invalid { field: "seats" }, mergeOf(a) null;
     POST /api/zones/:zoneId/today/reset → 204; the same merge → 204 and floorToday(a).joinSeats 6.
     First check that the routes' catch-up cannot reset the zone between the save and the merge: build the zone and resave
     it with the instant the app's clock answers, so both fall on one business day; a reset there would copy the new join and hide the case. */
});
// floor-today-merges.test.ts
it("a join deleted from the master mid-day still gives today's merge its seats, until the next reset", async () => {
  /* (b) threeTables([{ seats: 6, keys: ["a", "b"] }]); resaveMaster(zoneId, { joins: [] }) → savedJoinSeats([a, b]) 6;
     resetZone → null */
});
it("a join whose master table was deleted mid-day still gives today's merge its seats", async () => {
  /* (b) threeTables([{ seats: 6, keys: ["a", "b"] }]); resaveMaster(zoneId, { joins: [], drop: [master.b] }) → savedJoinSeats([a, b]) 6
     (the save only sets the reset row's plan_table_id null, floor-plan.ts:403-406; the copy names the row) */
});
it("a reset replaces the zone's copy rather than adding to it", async () => {
  /* (c) threeTables([{ seats: 6, keys: ["a", "b"] }, { seats: 9, keys: ["a", "c"] }]); resaveMaster(zoneId, { joins: [{ seats: 7, masterIds: [master.a, master.b] }] });
     resetZone → savedJoinSeats([a, b]) 7, ([a, c]) null; the zone has exactly one floor_reset_joins row with two members */
});
it("resetting one zone leaves another zone's copy alone", async () => {
  /* (d) two threeTables zones, each with a join of a, b at 6 seats; resaveMaster(zone2, { joins: [] }); resetZone(zone1) →
     zone 2's savedJoinSeats([a2, b2]) still 6; resetZone(zone2) → null */
});
it("copies no join whose master table two live tables follow", async () => {
  /* (e) threeTables([{ seats: 6, keys: ["a", "b"] }]); set c's dining_tables.plan_table_id to b's, as "finds no saved join when two
     tables stand on one master table" (:137-153) does; resetZone → no floor_reset_joins row for the zone; savedJoinSeats([a, b]) null */
});
it("a reset after a copied member's master table was deleted replaces the copy without a refusal", async () => {
  /* (f) threeTables([{ seats: 6, keys: ["a", "b"] }]); resaveMaster(zoneId, { joins: [], drop: [master.b] }); resetZone →
     b's dining_tables row is gone (b is free, so the catch-up removes it), no floor_reset_join_tables row for the zone, savedJoinSeats([a, b]) null */
});
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/server exec vitest run src/floor-today-merges.test.ts src/floor-today-merge-api.test.ts`.
  Expected, before the change:
  - (a) the first merge answers 204 and takes 6 seats where 400 is expected (the reader reads the
    master as it is now, `floor-today-merges.ts:173-205`).
  - (b) both cases print null where 6 is expected (the join, or its member, is gone from the master).
  - (c) the copied-join count is 0 where 1 is expected. Its seat lines alone would pass before the
    change (the master as it is now answers 7 and null too), which is why the case counts rows.
  - (d) zone 2's first read is null where 6 is expected.
  - (e) `savedJoinSeats([a, b])` prints 6 where null is expected: the old reader refuses two tables
    on one master table only when both are passed (`floor-today-merges.ts:179`), and here only b is.
  - (f) passes before the change (b is removed; no copy exists): a guard on the order of step 1.
- [ ] **Step 3: Implement** `resaveMaster`, the copy in `resetZoneFor` and the new `savedJoinSeats`.
  Then prove each part by deletion, restoring each after:
  - put back the old `savedJoinSeats` body (the read of `floor_plan_join_tables`) and watch (a) and
    (b) fail;
  - delete the insert of the copy and watch (a)'s last merge refuse `floor_plan.invalid` and (c) fail;
  - move step 1's delete after the reset rows' delete and watch every case that resets a zone with a
    copy fail on a foreign-key refusal (`isRefusal(error, FOREIGN_KEY_VIOLATION)`), (c) and (f) among
    them;
  - drop the zone filter from step 1's delete and watch (d) fail;
  - copy a join whose member maps to two rows (take the first) and watch (e) fail.
- [ ] **Step 4: Run** the same command, then
  `pnpm --filter @waitron/server exec vitest run src/floor-today-store.test.ts src/floor-catch-up.test.ts src/floor-plan.test.ts src/table-removal.test.ts src/floor-today-state.test.ts src/floor-today-api.test.ts src/floor-today-changes.test.ts src/floor-today-moves.test.ts src/floor-today-seat-api.test.ts src/till-api.today-joins.test.ts`,
  `pnpm --filter @waitron/server typecheck`, `pnpm --filter @waitron/server lint` and `pnpm exec
  prettier --check` on the changed files. Read each `Tests` count. Expected: all pass with no
  existing assertion changed; one that needs changing is a STOP (the Existing tests list above).
- [ ] **Step 5: Commit** — e.g. "Till floor: each reset copies the master's joins into today's plan,
  and a merge takes its seats from that copy (A429 slice 4, owner override)". The body quotes the
  owner's answer and states that a today's plan built before the migration asks for seats until its
  next reset.

### Task 4.4a: `wt-floor-map` — fixed tables, the drop target and a drop after a re-read

**Files:**
- Modify: `packages/ui/src/components/wt-floor-map.ts`, `wt-floor-map.a11y.test.ts`,
  `docs/developers/design-system.md` (the table row, `:594`, and the paragraph, `:625-674`)
- Create: `packages/ui/src/components/wt-floor-map.today.test.ts`

**Interfaces:**
- Produces: `FloorMapTable` gains `fixed?: boolean` (unset is movable); new parts `ghost` and
  `drag-link`; `data-drop-target` on the button under the pointer during a drag. Events unchanged.

Behaviour (decisions 21, 22): during a hold-drag, each `holdDrag` also finds the first other
table under the pointer (`elementsFromPoint`, as `#sendDrop` does, `:459-463`) and marks its button
`data-drop-target` (an outline in `--wt-color-primary`, as `data-held`'s ring), cleared when the
pointer leaves it and on release or cancel. A held group with a fixed member stays where it is; a
`<span part="ghost">` of its shapes, at half opacity, is drawn at the moved place instead, and over a
target a `<svg part="drag-link">` line joins the group's centre and the target's centre, 1 px,
`--wt-color-primary`. On release the ghost and the line go; the drop is sent as today. When `tables`
changes during a drag and no longer has the held table, the drag ends with no drop. The map still
never stops a `pointerdown` or `keydown`.

- [ ] **Step 1: Write the failing tests** in `wt-floor-map.today.test.ts` (slice 3's host, fixtures
  and pointer helpers, `wt-floor-map.view.test.ts:1-140`; fake `setTimeout`/`clearTimeout`):

```ts
it("marks the table under a dragged table as the drop target, and clears it on release", async () => { /* t1 dragged over t2 → t2 [data-drop-target]; up → none */ });
it("a fixed table stays put while its copy follows the finger", async () => {
  /* t1 fixed: hold, move +75 → t1's button left 150 still; [part=ghost] left 225; no [part=drag-link] over empty space */
});
it("a fixed table's copy over another table draws a line to it", async () => { /* over t2 → [part=drag-link] with a line from t1's centre to t2's; t2 [data-drop-target] */ });
it("a fixed table's copy goes on release, and the drop is still sent", async () => { /* up over t2 → no ghost, no line; wt-table-drag-end { tableId: "t1", targetId: "t2", … } */ });
it("a re-read without the held table ends the drag and sends no drop", async () => { /* hold t1, move; el.tables = [t2]; up → no wt-table-drag-end; no [data-held] */ });
it("a drag over a target still lets a press reach the page", async () => { /* document pointerdown listener hears the press on t1; nothing defaultPrevented */ });
// wt-floor-map.a11y.test.ts: "a fixed table's copy over a target" in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-map.today.test.ts`. Expected: the
  new cases fail, except "a drag over a target still lets a press reach the page", a guard.
- [ ] **Step 3: Implement**, and the design-system row (the new key, two parts) and paragraph (the
  drop target, the fixed copy and its line, a re-read ending a drag).
- [ ] **Step 4: Run** every `wt-floor-map` test file (`wt-floor-map.test.ts`, `.taps.test.ts`,
  `.view.test.ts`, `.keys.test.ts`, `.today.test.ts`, `.a11y.test.ts`),
  `pnpm --filter @waitron/ui exec vitest run src/no-hardcoded-chrome.test.ts`,
  `pnpm exec vitest run scripts/style-token-names.test.ts`, typecheck, lint, `prettier --check`.
  Expected: pass, no existing case changed.
- [ ] **Step 5: Mutation** — the bounded run on `src/components/wt-floor-map.ts`.
- [ ] **Step 6: Commit** — e.g. "Floor map: a fixed table's copy follows the finger and links to its
  target, and a re-read ends a drag (A429 slice 4)".

### Task 4.4b: `wt-floor-map` — a party's tables linked

**Files:**
- Modify: `packages/ui/src/components/wt-floor-map.ts`, `wt-floor-map.today.test.ts`,
  `wt-floor-map.a11y.test.ts`, `docs/developers/design-system.md` (the row and paragraph of Task 4.4a)

**Interfaces:**
- Produces: `FloorMapTable` gains `linkId?: string | null` (decision 10); a new part `links`.

Behaviour (decision 10): groups sharing a `linkId` get one `<svg part="links">` under the buttons
with a 1 px `--wt-color-field-line` line between consecutive groups' centres, in label order of their
first members; only the first draws `part="name"`, as `mergeLabel` of all their labels, by
`showsName` of its own box; every one's accessible name starts with that label. Each group stays its
own button, and a drag of one of them is a drag of that group alone.

- [ ] **Step 1: Write the failing tests** in `wt-floor-map.today.test.ts`:

```ts
it("links a party's tables with a line and names them once", async () => {
  /* t1 "Bar 1", t2 "Bar 2" with linkId "p1", t3 alone: one [part=links] line between t1's and t2's centres; t1 shows "Bar 1+2", t2 no name;
     aria-labels "Bar 1+2, …" on both; t3 unchanged */
});
it("draws no link for a party at one table", async () => { /* t1 alone with linkId "p1" → no [part=links] line; its own name */ });
it("a linked table is dragged alone", async () => { /* hold t1 and move → only t1's button moves; t2 stays */ });
// wt-floor-map.a11y.test.ts: "a linked party" in both themes
```

- [ ] **Step 2: Run and watch them fail** — the Task 4.4a command. Expected: the link cases fail;
  "a linked table is dragged alone" and "draws no link for a party at one table" pass before the
  change (guards).
- [ ] **Step 3: Implement**, with the design-system row and paragraph (the key, the part, one name).
- [ ] **Step 4: Run** Task 4.4a's Step 4 list.
- [ ] **Step 5: Mutation** — the bounded run on `src/components/wt-floor-map.ts`.
- [ ] **Step 6: Commit** — e.g. "Floor map: a party's tables are linked by a line and named once
  (A429 slice 4)".

### Task 4.4c: The till client's today's methods, and seating at two tables

**Files:**
- Modify: `apps/till/src/api/client.ts` (after `joinTables`, `:3536-3547`), `apps/till/src/api/client.test.ts`,
  `apps/till/src/till-app.ts` (`#openTableFromEvent`, `:5101-5105` and `:5207`, `:5223`; `otherPartyRead`,
  `:425-432`, moved), `apps/till/src/widgets/table-targets.ts` (`otherPartyRead` exported beside
  `seatedRead`), `apps/till/src/till-app-parties.test.ts` (one case)

**Interfaces:**
- Produces:

```ts
export type { JoinSide } from "@waitron/shared";
export interface JoinMerge { moving: string; target: string; side: JoinSide; seats?: number }
// TillApi
moveToday(tableId: string, at: { x: number; y: number }): Promise<void>;
rotateToday(tableId: string): Promise<void>;
takeOffToday(tableId: string): Promise<void>;
putBackToday(tableId: string): Promise<void>;
placeSpareToday(tableId: string, at: { x: number; y: number }): Promise<void>;
setSeatsToday(tableId: string, seats: number): Promise<void>;
backToSavedToday(tableId: string): Promise<void>;
mergeToday(tableId: string, merge: { targetId: string; side: JoinSide; seats?: number }): Promise<void>;
splitToday(tableId: string): Promise<void>;
resetZoneToday(zoneId: string): Promise<void>;
seatAtTables(tableId: string, guestCount: number | null, withTableIds: readonly string[]): Promise<SeatResult>;
joinTables(partyId: string, tableId: string, bills: "merge" | "separate", revisions: TableActionRevisions, merge?: JoinMerge): Promise<TableActionResult>;
// open-table's detail gains withTableIds?: string[]
```

Behaviour (decision 15): `joinTables` sends `merge` only when it is given, so its four-argument body
stays `{ tableId, bills, ...revisions }`. The app's open-table seat calls `seatTable(tableId,
guestCount)` when the detail has no `withTableIds`, as now, and `seatAtTables` otherwise, and then
holds for the party until its reload every table the server seated: the members of the seated
table's merge (`today.joinId` in `this.tables`; today it holds `[tableId]`, `till-app.ts:5223`) and
each of `withTableIds` with its merge's members.

- [ ] **Step 1: Write the failing tests:**

```ts
// client.test.ts, beside :2425 and :2997
it("sends each of today's changes to its route", async () => { /* each method: the path, POST, the body; 204 resolves undefined */ });
it("joinTables sends a merge only when it is given", async () => { /* with merge → body has merge; the four-argument call's body is as :2425 pins it */ });
it("seatAtTables sends the other tables with the guest count", async () => { /* { guestCount: 2, withTableIds: ["t2"] } */ });
// till-app-parties.test.ts, beside :426
it("seats a party at two tables when the floor asks for both", async () => {
  /* open-table { tableId: "t9", seated: false, guestCount: 2, withTableIds: ["t10"] } → seatAtTables("t9", 2, ["t10"]); seatTable not called */
});
it("holds every table of a merge it seats", async () => { /* t9 and t11 share a joinId; seat t9 → orderParty.tableIds ["t9", "t11"] */ });
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts -t "today|merge only|seatAtTables"`
  and `pnpm --filter @waitron/till exec vitest run src/till-app-parties.test.ts -t "two tables|merge it seats"`.
  Expected: the methods do not exist; "holds every table of a merge it seats" fails because
  `tableIds` is `["t9"]` (`till-app.ts:5223`).
- [ ] **Step 3: Implement**, moving `otherPartyRead` with no change to what it answers.
- [ ] **Step 4: Run** both files without `-t`, `src/till-app-table-service.test.ts`, the till's
  typecheck and lint, `prettier --check`. Expected: pass, the pins named at the top unchanged.
- [ ] **Step 5: Commit** — e.g. "Till: client calls for today's plan, and seating one party at two
  tables (A429 slice 4)".

### Task 4.4d: What a drop does

**Files:**
- Create: `apps/till/src/state/floor-today.ts`, `apps/till/src/state/floor-today.test.ts`
- Modify: `apps/till/src/state/floor-map.ts` (`mapTables`, `:137-162`: `fixed` and `linkId`),
  `apps/till/src/state/floor-map.test.ts` (the keys added to `:188-198` and `:212-224`; one case)

**Interfaces:**
- Consumes: `FloorMapDrop` (`wt-floor-map.ts:45-50`), `joinSide`, `touchingPlace` (Task 4.3a),
  `cropToTables`, `clampToGrid`, `mergeLabel` (`@waitron/ui`).
- Produces:

```ts
export type DropAction =
  | { kind: "none" }
  | { kind: "say"; message: string }                       // decision 6's words, or table.fixed's
  | { kind: "move"; tableId: string; x: number; y: number }
  | { kind: "merge"; tableId: string; targetId: string; side: JoinSide; seatsGuess: number; heading: string }
  | { kind: "seat"; tableId: string; withTableIds: string[]; heading: string }
  | { kind: "join"; party: TableParty; tableId: string; other: TableParty | null;
      merge: { moving: string; target: string; side: JoinSide } | null; seatsGuess: number; heading: string };
export function dropAction(zoneTables: readonly TableState[], drop: FloorMapDrop): DropAction;
/** The placement the floor draws until the next read (decision 14): the moved group's members, or the merged table. */
export function pendingPlaces(zoneTables: readonly TableState[], action: DropAction): Map<string, TodayPlacement>;
export function sparesOf(zoneTables: readonly TableState[]): TableState[];   // a today's row, no place, not taken off, not fixed
export function takenOffOf(zoneTables: readonly TableState[]): TableState[];
export function spareSpot(zoneTables: readonly TableState[]): { x: number; y: number }; // decision 17
```

Behaviour (decisions 5, 6, 9, 10): a group is the tables sharing a `today.joinId` (else one table);
a group is fixed when a member's `today.fixed`; its party is its members' `party`. `dropAction`:
no target — a fixed group says `codeMessage("table.fixed")`, else `move`; a target in the same group,
or held by the same party — `none`; a dragged merge — `say` `floor.drop_merge`; a fixed side — `seat`
when both are free (the target's members as `withTableIds`), else `join` with no merge; both movable —
`merge` when both are free, else `join` with `merge`, the side from `joinSide(<target member>, <the
dragged table at x, y>)`. The target member is the target group's member whose centre is nearest the
dragged table's. `seatsGuess` adds up today's seats of every table of both groups (null counts 0).
`heading` is `mergeLabel` of both groups' labels. `mapTables` sets `fixed: today.fixed` and `linkId`:
the party's id when the party holds two or more of the zone's drawn groups, else null; tables sharing a
`linkId` take one status and description, as a merge's members do.

- [ ] **Step 1: Write the failing tests** in `floor-today.test.ts` (fixtures as `floor-map.test.ts:15-57`,
  with `today` and `party` where a case needs them):

```ts
it("a movable table dropped on empty space moves there", () => { /* → { kind: "move", tableId, x, y } */ });
it("a fixed table dropped on empty space says it is fixed", () => { /* → say, the table.fixed words */ });
it("two free movable tables merge, against the side nearest the drop", () => { /* B dropped just right of A → merge { tableId: B, targetId: A, side: "right", seatsGuess: 8, heading: "4+5" } */ });
it("a seated table dropped on a free one extends the party and merges", () => { /* join { party: P, tableId: target, other: null, merge: { moving: dragged, target, side } } */ });
it("a free table dropped on a seated one joins that party", () => { /* join { party: Q, tableId: dragged } */ });
it("two seated tables join into the target's party, after the bill choice", () => { /* join { party: Q (target's), tableId: dragged, other: P } */ });
it("a table dropped on a merge goes against its nearest member", () => { /* target group A+B, drop near B → targetId/merge.target B */ });
it("a merge dropped on a table does nothing but say so", () => { /* say "Drag the other table onto it" */ });
it("two free tables, one fixed, seat one party at both", () => { /* seat { tableId: F1, withTableIds: [F2], heading: "Bar 1+2" } */ });
it("a fixed table and a seated one join without a merge", () => { /* join { merge: null } */ });
it("a drop on the same party's other table does nothing", () => { /* none */ });
it("keeps a moved merge's members together until the next read", () => { /* pendingPlaces for a merge moved by (4, 2) → both members moved by (4, 2) */ });
it("lists movable spares and taken-off tables", () => { /* sparesOf leaves out placed, taken off and fixed; takenOffOf */ });
it("puts a spare in the middle of the zone's crop", () => { /* tables (0,0) and (20,0) 8×8 → crop -2..30 → middle 14 → (10, 0); none placed → (0, 0) */ });
// floor-map.test.ts
it("links a party's tables on the map and gives them one status", () => { /* P at t1 and t2 (not merged) → both linkId P, one fill and description; P at one table → linkId null */ });
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/till exec vitest run src/state/floor-today.test.ts src/state/floor-map.test.ts`.
  Expected: the new file fails to load; the two whole-shape pins fail until their rows carry `fixed:
  false, linkId: null` (add the keys, as the header allows); the new floor-map case fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, `src/screens/till-floor-screen.map.test.ts`, the till's typecheck
  and lint, `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Till floor: what dropping one table on another does, and a party's
  tables linked on the map (A429 slice 4)".

### Task 4.4e: The seats dialog

**Files:**
- Create: `apps/till/src/widgets/today-seats-dialog.ts` (`till-today-seats-dialog`) and its
  `.test.ts`, `.save-state.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts`
- Modify: `apps/till/src/i18n/strings.ts` (decision 19's seats strings; EN after `floor.seats_one`,
  `:541`, ES after `:1687`), `docs/developers/design-system.md` (the dialog's Change seats in the
  "batch 5, the till" line of the forms that follow the rule, `:1957`, and the prompt with a
  suggestion in "These open already savable", `:1965-1990`)

**Interfaces:**
- Produces:

```ts
@customElement("till-today-seats-dialog")
export class TillTodaySeatsDialog extends LitElement {
  @property() heading = "";                               // "Seats for 4+5"
  @property({ attribute: false }) seats: number | null = null; // the opened value
  @property() action: "join" | "save" = "save";           // Join with savableAtOpen when seats > 0
}
// today-seats-confirm: { seats: number }; today-seats-cancel — both bubble, composed
```

Behaviour (decision 18, design-system.md → Forms): a `wt-dialog` with `trackDialog()`, one
`<wt-input name="seats" inputmode="numeric" required>` labelled `floor.seats_label`, and
`wt-form-actions` with Cancel (`action.cancel`) and the action (`floor.seats_join` or
`floor.seats_save`). The draft scope is taken with `draftScopeFor` only while connected, as
`party-name-dialog.ts:57-59`; the action is bound to `saveActionState(scope, { savableAtOpen: action
=== "join" && seats !== null && seats > 0 })`; its handler returns early while that is unchanged. A
value that is not a whole number 1–999 shows `floor.seats_invalid` beside the field and
`form.fix_fields` above the buttons after the first press, and keeps the action disabled until fixed.

- [ ] **Step 1: Write the failing tests** (modelled on `party-name-dialog.save-state.test.ts` and
  `party-name-dialog.unsaved.test.ts`):

```ts
// .test.ts
it("opens with the suggested seats and sends the number confirmed", async () => { /* seats 8, action join → value "8"; Join → today-seats-confirm { seats: 8 } */ });
it("refuses a number outside 1 to 999 beside the field and below the form", async () => { /* "0" → "Enter 1 to 999" and "Correct the highlighted fields to continue."; no event */ });
it("Cancel asks to close", async () => { /* today-seats-cancel once */ });
it("speaks Spanish", async () => { /* es: "Plazas", "Unir" */ });
// .save-state.test.ts
it("Join is ready at once when there is a suggestion", async () => { /* primary, enabled */ });
it("Join waits for a number when there is no suggestion", async () => { /* seats null → secondary, disabled; type "6" → primary */ });
it("Save waits for a change and goes quiet again when it is undone", async () => { /* action save, seats 6 → quiet; "7" → primary; "6" → quiet */ });
it("a press that reaches Save's handler with nothing changed sends nothing", async () => { /* host .click() on the action → no event */ });
// .unsaved.test.ts
it("leaving with a changed number asks first", async () => { /* coordinator stub as party-name-dialog.unsaved.test.ts; Escape → the question; Discard → today-seats-cancel */ });
it("disconnect aborts a leave decision; reconnect keeps the opened number as the baseline", async () => { /* as party-name-dialog.unsaved.test.ts:132 */ });
// .a11y.test.ts — describe.each(["light", "dark"]): opened with a suggestion; a refused number
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/till exec vitest run src/widgets/today-seats-dialog.test.ts src/widgets/today-seats-dialog.save-state.test.ts src/widgets/today-seats-dialog.unsaved.test.ts src/widgets/today-seats-dialog.a11y.test.ts`.
  Expected: the files fail to load.
- [ ] **Step 3: Implement.** Then delete the early return and watch "a press that reaches Save's
  handler…" fail; restore it. Delete the `isConnected` check before taking the scope and watch the
  reconnect case fail; restore it.
- [ ] **Step 4: Run** the same command, `pnpm exec vitest run scripts/native-form-fields.test.ts`, the
  till's typecheck and lint, `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Till floor: a dialog for a merge's seats and for changing seats today
  (A429 slice 4)".

### Task 4.4f: Dragging on the floor screen — moves, free merges and the status line

**Files:**
- Create: `apps/till/src/screens/till-floor-screen.today.test.ts`
- Modify: `apps/till/src/screens/till-floor-screen.ts` (`#plannedMap`, `:854-872`; `#zoneOnScreen`,
  `:710-751`, and its cached inputs, `:711-719`; the status line beside `data-zone-closed`, `:809`),
  `apps/till/src/screens/till-floor-screen.a11y.test.ts`

**Interfaces:**
- Consumes: Tasks 4.4a–4.4e; `codeMessage`.
- Produces: the floor's `wt-table-drag-end` handler for `none`, `say`, `move` and `merge`; `#pending`
  (decision 14); the `data-floor-refusal` line (decision 1); `#settle(call)`, which every floor write
  of this slice uses (show a refusal's words, drop `#pending`, send `floor-refresh`).

Behaviour: on `wt-table-drag-end` (stopped, as the map's events are re-emitted; the screen adds no
`pointerdown` or `keydown` listener) the screen runs `dropAction(<the active zone's tables>, detail)`:
`none` does nothing; `say` shows the words in the status line; `move` sets `#pending` and calls
`api.moveToday`; `merge` sets `#pending` and calls `api.mergeToday` with no seats. A merge refused
`floor_plan.invalid` with `field: "seats"` opens `till-today-seats-dialog` (action `join`, `seats` the
guess, heading `floor.seats_title` with `heading`), whose confirm sends the same call again with the
seats, and whose cancel drops `#pending`. Any other refusal drops `#pending` and shows its words;
every settled call sends `floor-refresh`. `#pending` overrides the active zone's map placements in
`#zoneOnScreen`, joins that method's cached inputs (`:711-719`) so a change to it redraws the map,
and is cleared in `willUpdate` when `tables` is a new array. Task 4.4g handles `seat` and `join`.

- [ ] **Step 1: Write the failing tests** in `till-floor-screen.today.test.ts` (the map fixtures of
  `till-floor-screen.map.test.ts`; an `api` stub of `vi.fn()`s; drops dispatched from the map as
  `wt-table-drag-end`):

```ts
it("a drop on empty space moves the table and draws it there until the next read", async () => {
  /* moveToday("t1", { x: 12, y: 5 }); map.tables' t1 at x 12 before the answer; floor-refresh sent; set tables (a read) → the read's place */
});
it("a refused move puts the table back and says why", async () => { /* moveToday rejects { code: "table.fixed" } → t1 at its old place; [data-floor-refusal] "That table is fixed in place" */ });
it("two free tables merge, asking for seats when the server wants them", async () => {
  /* mergeToday rejects { code: "floor_plan.invalid", field: "seats" } → till-today-seats-dialog with seats 8; confirm 10 → mergeToday(t2, { targetId: t1, side, seats: 10 }) */
});
it("cancelling the seats puts the table back", async () => { /* today-seats-cancel → #pending dropped; nothing sent */ });
it("a merge dropped on a table says to drag the other one", async () => { /* [data-floor-refusal] "Drag the other table onto it"; no api call */ });
it("the status line clears on the next drop and on a change of zone", async () => {});
it("a press on the map still reaches the page", async () => { /* a document pointerdown and keydown listener hear a press and a key on a table (the idle logout's events) */ });
// till-floor-screen.a11y.test.ts — "a refusal said on the floor" in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.today.test.ts src/screens/till-floor-screen.a11y.test.ts`.
  Expected: the new cases fail (nothing listens to the drop), except "a press on the map still reaches
  the page", a guard.
- [ ] **Step 3: Implement.** Then stop clearing `#pending` on a refusal and watch "a refused move puts
  the table back" fail; restore. Then leave `#pending` out of the cached inputs and watch "draws it
  there until the next read" fail; restore.
- [ ] **Step 4: Run** the same command and every existing floor file
  (`src/screens/till-floor-screen.test.ts src/screens/till-floor-screen.map.test.ts src/screens/till-floor-screen.details.test.ts src/screens/till-floor-screen.refresh.test.ts src/screens/till-floor-screen.parties.test.ts src/screens/till-floor-screen.signals.test.ts src/screens/till-floor-screen.unsaved.test.ts src/screens/device-screens.phone-margin.test.ts`),
  `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts`, the
  till's typecheck and lint, `prettier --check`. Expected: pass, no existing case changed; one that
  needs changing is a STOP.
- [ ] **Step 5: Commit** — e.g. "Till floor: drag a table to move it, or onto a free one to merge
  them (A429 slice 4)".

### Task 4.4g: Dragging on the floor screen — joins and seating

**Files:**
- Create: `apps/till/src/screens/till-floor-screen.today-joins.test.ts`
- Modify: `apps/till/src/screens/till-floor-screen.ts` (`#seatDialog`, `:954-966`; `#onSeatConfirm`,
  `:550-555`; Task 4.4f's drop handler)

**Interfaces:**
- Consumes: Task 4.4f's handler and `#settle`; `till-bill-choice-dialog`; `otherPartyRead` (Task 4.4c).
- Produces: the drop handler's `seat` and `join`; the seat dialog seating several tables (its
  `open-table` detail carries `withTableIds`).

Behaviour: `seat` opens the seat dialog headed with `heading`, whose confirm sends `open-table {
tableId, seated: false, guestCount, withTableIds }`; `join` asks the bill choice first when `other`
is not null (scope `table.combine_scope` from the dragged party into the target's), then calls
`api.joinTables(party.id, tableId, bills, { expectedPartyRevision: party.revision,
...otherPartyRead(<seated read at tableId>, party.id) }, merge ?? undefined)` through `#settle`, a
join refused `floor_plan.invalid` with `field: "seats"` asking for seats as Task 4.4f's merge does.
The seat dialog for a free merge is headed with the merge's name (`#detailsHeading`).

- [ ] **Step 1: Write the failing tests** in `till-floor-screen.today-joins.test.ts` (as Task 4.4f's):

```ts
it("a seated table dropped on a free one joins and merges", async () => { /* joinTables(P, t2, "merge", { expectedPartyRevision, otherPartyId: null }, { moving: t1, target: t2, side }) */ });
it("a join that needs seats asks for them and sends them", async () => { /* rejects floor_plan.invalid seats → dialog; confirm 9 → joinTables(…, { …merge, seats: 9 }) */ });
it("two seated tables ask which bills to keep, then join", async () => { /* till-bill-choice-dialog; confirm separate → joinTables(Q, t1, "separate", { …, otherPartyId: P, expectedOtherPartyRevision }, merge) */ });
it("two free fixed tables open the seat dialog for both, and seat them in one go", async () => {
  /* drop F1 on F2 → till-seat-dialog headed "Bar 1+2"; confirm 2 → open-table { tableId: F1, seated: false, guestCount: 2, withTableIds: [F2] } */
});
it("a fixed table and a seated one join without a merge", async () => { /* joinTables(P, F2, "merge", revisions) with no fifth argument */ });
it("a free merge's seat dialog is headed with the merge's name", async () => { /* tap a merge of 4 and 5 → tableLabel "4+5" */ });
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.today-joins.test.ts`.
  Expected: the new cases fail (the handler ignores `seat` and `join`; the dialog shows the first
  table's label).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, Task 4.4f's Step 4 list, the till's typecheck and lint,
  `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Till floor: drag a table onto a seated one to join them, and seat a
  party at two fixed tables (A429 slice 4)".

### Task 4.5a: The details sheet's actions

**Files:**
- Modify: `apps/till/src/widgets/table-details-sheet.ts` (`#body`, `:144-180`), `table-details-sheet.a11y.test.ts`,
  `apps/till/src/state/floor-today.ts` (`sheetActions`), `apps/till/src/i18n/strings.ts`
- Create: `apps/till/src/widgets/table-details-sheet.actions.test.ts`

**Interfaces:**
- Produces:

```ts
export type SheetAction = "join-with" | "split" | "rotate" | "seats" | "back" | "take-off";
export function sheetActions(table: TableState): SheetAction[]; // in this order, those that apply
// TillTableDetailsSheet
@property({ type: Boolean }) actions = false;
// today-action: { action: SheetAction; tableId: string }, bubbles, composed; then details-close, except after rotate
```

Which apply (decisions 12, 16): only with a today's row, a place and not taken off. Join with… — a
table in no merge. Split — a table in a merge. Rotate — movable and in no merge. Change seats —
always. Back to saved place — always. Take off for today — free (no party, `condition` free, no
`pendingDeliveries`) and in no merge. The buttons are `variant="secondary"` in a column under the lines
(`data-today-action=<action>`), each acting at once; Mark cleared stays in the footer.

- [ ] **Step 1: Write the failing tests** in `table-details-sheet.actions.test.ts`:

```ts
it("shows no actions unless asked", async () => { /* actions false (the status pin's sheet) → no [data-today-action] */ });
it("offers a free single table every action but Split", async () => { /* join-with, rotate, seats, back, take-off, in that order */ });
it("offers a merge Split, seats and back, and no Join with…, Rotate or Take off", async () => {});
it("does not offer Rotate for a fixed table, nor Take off for a seated one or one needing clearing", async () => {});
it("offers nothing for a table with no today's row", async () => {});
it("sends the action and asks to close, except after Rotate", async () => {
  /* Split → today-action { action: "split", tableId } then details-close; Rotate → today-action only */
});
it("names the actions in Spanish", async () => { /* "Unir con…", "Separar", "Girar", "Cambiar plazas", "Volver a su sitio", "Quitar por hoy" */ });
// table-details-sheet.a11y.test.ts — "a free table's actions" and "a merge's actions" in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/till exec vitest run src/widgets/table-details-sheet.actions.test.ts src/widgets/table-details-sheet.a11y.test.ts`.
  Expected: the new cases fail, except "shows no actions unless asked", a guard.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, `src/widgets/table-details-sheet.test.ts`,
  `src/widgets/table-status.test.ts`, the till's typecheck and lint, `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Till floor: the details sheet offers today's changes for the table
  (A429 slice 4)".

### Task 4.5b: Join with…, and the sheet's actions on the floor

**Files:**
- Create: `apps/till/src/widgets/join-with-dialog.ts` (`till-join-with-dialog`), its `.test.ts` and
  `.a11y.test.ts`, `apps/till/src/screens/till-floor-screen.sheet.test.ts`
- Modify: `apps/till/src/screens/till-floor-screen.ts` (`#detailsSheet`, `:572-589`)

**Interfaces:**
- Produces:

```ts
@customElement("till-join-with-dialog")
export class TillJoinWithDialog extends LitElement {
  @property({ attribute: false }) table: TableState | null = null;   // null: closed
  @property({ attribute: false }) targets: TableState[] = [];        // the zone's other placed groups' first members, not the table's own party's
  @property() heading = "";                                          // "Join 4 with"
}
// join-with-pick: { tableId, targetId }; join-with-close — both bubble, composed
```

Behaviour (decision 16): the floor leaves out of `targets` the table's own group and every group
its own party holds, for which `dropAction` answers `none`. The dialog lists `targets` with
`tableTarget` (`table-targets.ts:64`), each group named as the map names it; a pick sends `join-with-pick` and closes. The floor passes
`.actions=${true}` to its sheet and answers `today-action`: `join-with` opens the dialog, whose pick
runs the drop path of Tasks 4.4f and 4.4g with `dropAction(zone, { tableId, x, y, targetId })`, `x` and `y` the
table's current corner; `split` calls `api.splitToday` for a free merge, else `api.splitTable(party.id,
<the merge's last member in label order>, null, party.revision)`; `rotate` calls `api.rotateToday`;
`seats` opens `till-today-seats-dialog` (action `save`, `seats` `seatsFor(table)`) whose confirm calls
`api.setSeatsToday`; `back` calls `api.backToSavedToday`; `take-off` calls `api.takeOffToday`. Each
settles through Task 4.4f's `#settle` (status line, `floor-refresh`).

- [ ] **Step 1: Write the failing tests:**

```ts
// join-with-dialog.test.ts
it("lists the zone's other tables with their condition and sends the pick", async () => {});
// till-floor-screen.sheet.test.ts also: "Join with… leaves out the table's own party's other tables" (P at t1 and t2 → t2 not among targets)
it("closes on Escape", async () => { /* await wt-close, then join-with-close */ });
// till-floor-screen.sheet.test.ts
it("passes the sheet its actions", async () => { /* till-table-details-sheet .actions true */ });
it("Join with… joins the chosen table as a drop on it would", async () => { /* free t1 with free t2 → mergeToday(t1, { targetId: t2, side }) */ });
it("Split ends a free merge, and splits the last table off a seated one", async () => {
  /* free → splitToday(t4); seated P at 4+5 → splitTable(P, t5, null, revision) */
});
it("Rotate, Back and Take off call their routes; Change seats asks first", async () => {
  /* rotateToday, backToSavedToday, takeOffToday; seats → dialog opened at 6, confirm 8 → setSeatsToday(t1, 8) */
});
it("a refused action is said on the floor", async () => { /* takeOffToday rejects tab.already_open → its words */ });
// join-with-dialog.a11y.test.ts — the list in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/till exec vitest run src/widgets/join-with-dialog.test.ts src/widgets/join-with-dialog.a11y.test.ts src/screens/till-floor-screen.sheet.test.ts`.
  Expected: the new files fail to load or find no actions.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, the floor files of Tasks 4.4f and 4.4g, the till's typecheck and lint,
  `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Till floor: Join with… for keyboard and screen readers, and the
  sheet's changes on today's plan (A429 slice 4)".

### Task 4.5c: The zone menu, and the editor's note

**Files:**
- Create: `apps/till/src/widgets/floor-zone-menu.ts` (`till-floor-zone-menu`), its `.test.ts` and
  `.a11y.test.ts`, `apps/till/src/screens/till-floor-screen.zone-menu.test.ts`
- Modify: `apps/till/src/screens/till-floor-screen.ts` (the action row, `:780-801`),
  `apps/till/src/i18n/strings.ts`; only after the owner's yes to decision 20:
  `apps/dashboard/src/i18n/strings.ts` (`:990`, `:3599`),
  `apps/dashboard/src/screens/floor-plan-editor.test.ts:133`,
  `apps/dashboard/src/screens/floor-plan-editor.save.test.ts:251`

**Interfaces:**
- Produces:

```ts
@customElement("till-floor-zone-menu")
export class TillFloorZoneMenu extends LitElement {
  @property({ attribute: false }) zone: FloorZone | null = null;
  @property({ attribute: false }) tables: TableState[] = [];  // the zone's tables
}
// zone-place-spare: { tableId }; zone-put-back: { tableId }; zone-reset: { zoneId } — bubble, composed
```

Behaviour (decision 17): a `wt-row-actions` labelled `floor.zone_menu` holding three `wt-button`s:
Add a spare table, Taken off today, Reset to saved plan. The first two open a `wt-dialog` with one
button per table (`sparesOf`, `takenOffOf`; Put back for each taken-off table) or, with none, the
words `floor.no_spares` / `floor.none_taken_off`; a press sends its event and closes. Reset opens a
`wt-dialog` headed `floor.reset_title` with `floor.reset_body`, Cancel and Reset (`danger`), which
sends `zone-reset`. The floor draws the menu in its action row while the active zone is planned (finish-branch
review, 2026-10-11: or while the zone has a saved plan, `hasPlan` on `/api/zones`; see decision
17), and
answers the events with `api.placeSpareToday(tableId, spareSpot(zone))`, `api.putBackToday` and
`api.resetZoneToday`, settling through Task 4.4f's `#settle`.

- [ ] **Step 1: Write the failing tests:**

```ts
// floor-zone-menu.test.ts
it("lists the movable spares, and places the one picked", async () => { /* zone-place-spare { tableId } */ });
it("says there are no spares, and where to add them", async () => { /* "No spare tables — add some in the floor plan editor" */ });
it("lists the tables taken off today, each with Put back", async () => { /* zone-put-back; with none, "None" */ });
it("asks before resetting the zone, and sends nothing on Cancel", async () => { /* heading "Reset Terrace?"; Reset → zone-reset { zoneId }; Cancel → none */ });
it("speaks Spanish", async () => { /* "Plano de hoy", "Añadir mesa de reserva", "Quitadas hoy", "Volver al plano guardado" */ });
// till-floor-screen.zone-menu.test.ts
it("shows the zone menu for a planned zone only, in both views", async () => {});
it("places a spare in the middle of the zone, puts a table back and resets the zone", async () => {
  /* placeSpareToday(t9, spareSpot(zone)); putBackToday(t3); resetZoneToday(z1); each followed by floor-refresh */
});
// floor-zone-menu.a11y.test.ts — the menu open, each dialog, in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/till exec vitest run src/widgets/floor-zone-menu.test.ts src/widgets/floor-zone-menu.a11y.test.ts src/screens/till-floor-screen.zone-menu.test.ts`.
  Expected: fail to load.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: The editor's note (decision 20).** With the owner's yes recorded: change
  `floor_plan_editor.note` in both languages, then, in a separate commit titled "Changed test checks
  (A429 slice 4):", the two assertions, listing each `file:line` with its before and after; run
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-editor.test.ts src/screens/floor-plan-editor.save.test.ts`.
  If no answer has arrived by then, leave the note and both assertions untouched, add a line to
  A470's detail in `docs/backlog/till.md` ("The editor's note still says changes go live tomorrow;
  Reset to saved plan is waiting on the owner's answer to slice 4 decision 20"), and say so in the
  handover.
- [ ] **Step 5: Run** Step 2's command, the floor files of Tasks 4.4f and 4.4g, the till's (and, after Step 4, the
  dashboard's) typecheck and lint, `prettier --check`.
- [ ] **Step 6: Commit** — e.g. "Till floor: the zone menu adds a spare, puts a table back and resets
  the zone to its saved plan (A429 slice 4)".

### Task 4.6: Look

**Files:** none committed. Throwaway files `packages/ui/src/components/wt-floor-map.look.test.ts`,
`apps/till/src/screens/till-floor-screen.look.test.ts` and, after decision 20's yes,
`apps/dashboard/src/screens/floor-plan-editor.look.test.ts` are written, run and deleted. Screenshots
go to `/Users/clintongormley/waitron-campaign/a429-4-shots/`, by that literal absolute path, or, if
Vitest refuses a path outside the package, through the package's git-ignored `__screenshots__`
folder and `cp`, then removed from the package (as Tasks 2.8 and 3.6).

States, each in English and Spanish, light and dark, on the handheld at 390 × 844 and the till at
1280 × 800, named `<state>-<lang>-<theme>-<width>.png`: a movable table dragged over another, its
target marked; a fixed stool's copy over a target with its line; a merge of two tables and one of
three; a party linked across two fixed stools; the details sheet with its actions for a free table,
a free merge and a seated merge; Join with…; the seats prompt with a suggestion and Change seats;
the zone menu open; Add a spare table with spares and with none; Taken off today; the reset
question; a refusal in the status line; and the editor's new note on the dashboard.

- [ ] **Step 1:** Write the throwaway files and run them. Expected: `ls
  /Users/clintongormley/waitron-campaign/a429-4-shots/ | wc -l` equals the count taken.
- [ ] **Step 2:** Open each screenshot and look: a ghost or a line hard to see in either theme, a
  target mark lost against the seated fill, a merge's seam, a linked party's name crowding a stool,
  the sheet's actions pushing Close off a 390 px screen, the zone menu's ⋮ beside the List toggle at
  390, a list dialog too long for a phone, Spanish longer than its button, product text that could be
  shorter (owner rule).
- [ ] **Step 3:** Fix what the look found, each fix test-first in the task file it belongs to, and
  rerun that file.
- [ ] **Step 4:** Delete the throwaway files and any screenshots left in the packages (`git status`
  shows none), then run every slice 4 test file named above, the guards named above, and the touched
  packages' typecheck and lint.
- [ ] **Step 5: Commit** the fixes, if any — e.g. "Till floor: fixes from looking at today's plan in
  both languages, both themes, on a phone and a till (A429 slice 4)", the message listing what was
  looked at and where the screenshots are.

**Slice 4 done when:** the focused tests above pass; `/finish-branch` runs the full wave (new till
routes behind profile and zone checks are a risk trigger, so the run-it seat runs twice); CI is green
on the head (`ui`'s and `shared`'s mutation floors run only weekly, so the per-file Stryker runs above
are the check); design-system.md describes the map's fixed copy and linked parties; the backlog's
A429 entry says slice 4 landed and what it left, and A470 loses its two slice 4 notes and the
drop-after-re-read point, which this slice settles. The PR description states the owner's override of
decision 7 (today's plan keeps its own copy of the master's joins, copied at each reset) and that a
today's plan built before Task 4.3e's migration asks for a merge's seats until its zone's next reset.

## Slice 5 — removing the old pieces (spec §11)

Branch `feat/floor-plan-retire-old`, after slice 4 (landed as #1526). PR first line: **"venue reset
needed"**. Expanded to step level on 2026-10-11, unattended; every `file:line` in this slice was read
at `main` `5afb32342` (most of them through two read-only searches, each spot-checked against the
file; the ranges of existing tests were read case by case). A fresh-context review's 19 findings
were folded in the same day; each line number it gave was re-read against the file before use.

What the slice does: the dashboard's old Floor screen, its nav item, the old table write routes and
the placement routes on both APIs go; the till's layout-editor card, Edit plan, the old canvas and
the no-zone tab go; `wt-floor-canvas` and the permille helpers go; a table's `active`, `capacity`
and `planned` columns and its old placement columns go, and `zone_id` becomes required. A live
table is now created only by a reset from its zone's master plan, and a table is usable ("in
service") when it has a today's row and its zone is switched on. The editor stops offering live
tables for adoption.

**What earlier slices built that this slice works with** (read, not run):

- **Hiding a table.** A reset takes a table off today's plan by deleting its today's row and
  setting `active` false (`hideTable`, `apps/server/src/floor-today-store.ts:384-389`), and puts one
  back by writing its row and setting `active` true (`:345-351`); it skips a table already hidden
  using `active` (`:301-306`). A table a reset marks `remove` that something still ties is hidden
  and stays pending (`planReset`, `apps/server/src/floor-reset-plan.ts:85-93`); its removal deletes
  the live row once nothing ties it (`removeLiveTables`, `apps/server/src/table-removal.ts:71`).
- **Who reads `active`** (a grep of `apps/`, `packages/`, `scripts/` and `bench/`; `bench/` has
  none): `openTab` (`apps/server/src/working-order.ts:1246-1258`, `table.inactive`);
  `readTargetTable` (`apps/server/src/move-bill.ts:217-228`, `table.inactive`); the till's floor
  read (`listTablesWithState`, `apps/server/src/working-order.ts:7176`, `dt.active = true`);
  `countOpenTables` (`apps/server/src/report-api.ts:159-175`, `:172`); `listTables`
  (`apps/server/src/tables.ts:111-137`, `:133`); `setTableStatus` (`tables.ts:574-592`, `:587-588`,
  answering `table.not_found`); `refuseFloorPlanChange`, `deactivateTable`, `setTablePlacement` and
  `reopenTodaysTables` (`tables.ts:193-216`, `:218-232`, `:238-278`, `:395-411`); the reset
  (`floor-today-store.ts:245-252`, `:301`, `:346`, `:388`); adoption (`apps/server/src/floor-plan.ts:97-110`,
  `:105`); `requireActiveTable` (`packages/bookings/src/bookings.ts:48-66`, `:60`) and its test
  stand-in (`packages/bookings/src/testing/fake-core.ts:32-40`); `departmentRemovalImpact`
  (`packages/venue-service/src/operations.ts:253-286`, `:280`); `zoneRemovalImpact` (`:288-302`,
  `:301`); `deactivateServiceZone`, which writes it false for the whole zone (`:342-370`, `:368`);
  a transfer's destination table (`packages/venue-service/src/department-transfers.ts:406-419`,
  `:416`); and the editor's name rule (`apps/dashboard/src/screens/floor-plan-editor.ts:837-849`,
  `:845`). No SQL trigger reads any of the seven columns (the triggers that name `dining_tables`
  only clear `status_id`).
- **Who reads `capacity`**: the till's `seatsFor` falls back to it when a table has no today's row
  (`apps/till/src/state/floor-map.ts:199-200`); the tray token draws it (`packages/ui/src/components/wt-table-token.ts:292-294`)
  through `toFloorTable` (`packages/ui/src/floor.ts:172-196`); adoption offers it as a draft's
  seats (`floor-plan.ts:99`, `:162`); the wire answers carry it (`TableState`,
  `apps/server/src/working-order.ts:7011`, mapped at `:7205`; `DiningTable`, `tables.ts:63-75`;
  the till's `TableState`, `apps/till/src/api/client.ts:1879`; the dashboard's `DashboardTable`,
  `apps/dashboard/src/api/client.ts:599-610`; bookings' copy, `packages/bookings/src/dashboard/client.ts:46-53`,
  which nothing reads).
- **Who reads `planned`**: `targetsFromMaster` skips a live table that was never planned
  (`floor-reset-plan.ts:127-175`, `:135`, `:141`); the reset's zone read (`floor-today-store.ts:193-202`)
  and its create (`:326-336`, `:333`); adoption and its name rule (`floor-plan.ts:97-110`,
  `:243-268`, `:452-459`); `refuseFloorPlanChange` and `reopenTodaysTables` (`tables.ts:202`,
  `:402`). No wire type carries it.
- **Who reads the placement columns** (`pos_x`, `pos_y`, `shape`, `rotation`): the till's floor
  read (`working-order.ts:7097-7098`, mapped at `:7221-7224`) and `TableState`
  (`working-order.ts:7035-7039`; till `client.ts:1905-1912`); `listTables` (`tables.ts:121-127`);
  the placement verbs and routes; the till's old canvas path and tray (`apps/till/src/screens/till-floor-screen.ts:1152-1160`,
  `:1263-1278`, `:1345-1361`); the dashboard's old floor screen; `wt-floor-canvas`; and the demo
  seed (`apps/server/scripts/demo-seed/seed-floor.ts:220-237`).
- **Adoption.** `readZonePlan` offers the zone's never-planned live tables as draft entries with
  `id: null` (`floor-plan.ts:156-165`), and a save may name one by `liveTableId`, which the save
  links to its new master (`floor-plan.ts:317-335`, `:452-459`; parsed at
  `apps/server/src/management-api.ts:445-448`). The dashboard keys such an entry `live:<id>`
  (`apps/dashboard/src/screens/floor-plan-draft.ts:53-54`), sends it back (`:78-79`), and gives it
  no Delete (`:176`). The test helper `plannedZone` builds its zone by adoption
  (`apps/server/src/testing/floor-today-venue.ts:64`), and so does the demo seed
  (`seed-floor.ts:239-262`). `liveTableId` on a master entry is that table's live table
  (`floor-plan.ts:132`), which the editor uses to place a booked refusal (`floor-plan-editor.ts:658`).
- **The first save runs a reset** for the zone when it has no today's plan yet (`floor-plan.ts:464-468`),
  which creates a live table and its today's row for every master table (`floor-today-store.ts:326-338`).

**The foreign keys and triggers the rebuild meets.** Measured 2026-10-11 by applying every set's
shipped migrations, in `packages/migrations/migrations.manifest.json` order, to an empty
`node:sqlite` database (Node v26.7.0) and reading `sqlite_master` and `pragma foreign_key_list`
(40 triggers in all; the change feed and the append-only triggers, which `applyMigrations` and boot
install, were not installed). The last column was measured for `party_tables` (below); the other five
are the same no-action key and were not each tried:

| Child | Column | Key | On delete | What the rebuild's `DROP TABLE dining_tables` does |
| --- | --- | --- | --- | --- |
| `party_tables` | `table_id` | `party_tables_table_fk` (`packages/db/src/schema/parties.ts:91-95`) | no action | refused (`FOREIGN KEY constraint failed`) while a row exists |
| `working_orders` | `delivery_table_id` | unnamed (`packages/db/src/schema/orders.ts:91`) | no action | refused while a row names a table |
| `bookings` | `table_id` | `bookings_table_fk` (`packages/bookings/src/schema/bookings.ts:62-66`) | no action | refused while a row names a table |
| `floor_reset_tables` | `table_id` | `floor_reset_tables_table_fk` (`packages/db/src/schema/floor-plans.ts:186-190`) | no action | refused while a row names a table |
| `floor_today_tables` | `table_id` | `floor_today_tables_table_fk` (`floor-plans.ts:273-277`) | no action | refused while a row exists |
| `floor_today_join_tables` | `table_id` | `floor_today_join_tables_table_fk` (`floor-plans.ts:318-322`) | no action | refused while a row exists |

No key into `dining_tables` cascades, so no child is emptied silently (CLAUDE.md §3); the Global
constraints already forbid adding one. Every child refuses the drop while it holds a row, which is
the loud failure this slice accepts: the precedent is `0044_drop_table_bill_pointer`, which rebuilt
`dining_tables` with the same children and is listed in `scripts/migration-upgrade.test.ts`'s
`RESETS` (`:301-304`) as refused, with a venue reset (#897). No data is carried across (CLAUDE.md §3,
no data-migration code before go-live). A fresh database has no rows, so the rebuild runs there.

| Trigger | On | Names `dining_tables` | How it survives |
| --- | --- | --- | --- |
| `parties_clear_table_status` (last created by `packages/db/drizzle/0045_recreate_triggers_after_rebuild.sql:4-13`) | `parties` | in its body (`UPDATE dining_tables SET status_id = NULL …`) | dropped by a custom migration before the rebuild and re-created unchanged by one after it, as `0043`/`0045` did; left in place, the rebuild's rename fails (measured below) |
| the change feed's triggers on `dining_tables` | `dining_tables` | ON clause | `applyMigrations` removes the whole change feed before migrating (`packages/migrations/src/apply.ts:65`) and boot installs it again (`installChangeFeed`, `apps/server/src/boot.ts`); `dining_tables` is a change source because it is classified (`packages/db/src/classification.ts:92`) |
| append-only triggers | — | none: `dining_tables` is `state`, not append-only (`classification.ts:92`) | not affected |

No other trigger in any set names `dining_tables` (the measurement above); slices 1–4 added none
(`0126`–`0136` mention it only in foreign keys and `0126:136`'s `ALTER TABLE … ADD planned`).

**The rebuild, measured.** On 2026-10-11, in a scratch copy of `packages/db` outside the repository
(nothing committed), with this slice's schema change made (the seven columns removed, `zone_id`
`.notNull()`, `dining_tables_shape_ck` removed), `drizzle-kit generate` (0.31.11) wrote one file
whose statements were only the rebuild of `dining_tables` — `CREATE TABLE __new_dining_tables` with
`id`, `location_id`, `label`, `zone_id NOT NULL`, `created_at`, `status_id`, `needs_clearing_since`
and `plan_table_id` and the four foreign keys to `floor_plan_tables`, `locations`,
`table_service_statuses` and `floor_zones`; an `INSERT … SELECT` naming only those eight columns,
all of which the old table has; `DROP TABLE`; the rename — and `CREATE UNIQUE INDEX
dining_tables_location_label_key`. So neither drizzle-kit 0.31.11 trap applies: the generation
adds no column (the copy selects nothing the old table lacks), and `dining_tables` has no expression
index (its indexes are its primary key and that unique index). Applied after every set's shipped
migrations inside `BEGIN … COMMIT` on `node:sqlite` (Node v26.7.0): with `parties_clear_table_status`
left in place it failed `error in trigger parties_clear_table_status: no such table: main.dining_tables`;
with that trigger dropped first and re-created after, it committed on an empty venue and the
trigger was there afterwards; with one table whose `zone_id` is null it failed `NOT NULL constraint
failed: __new_dining_tables.zone_id`; with one table in a zone and one `party_tables` row pointing at
it, it failed `FOREIGN KEY constraint failed`.

### Slice 5 decisions (added at expansion)

Each is the default this slice builds; the owner may override any at review. Each says what it costs
if it is wrong.

1. **OWNER QUESTION — default: the Floor nav item is removed, and nothing replaces it.** The task
   list left "opens the departments screen's zone list, or is removed" to the owner, who was not
   available. There is no venue-wide zone list to open: zones are listed per department
   (`/manage/venue-operations/department/<id>/view/zones`, `packages/venue-service/src/dashboard/department-zones.ts:255`),
   and Departments and zones is already the first page of the same Operations group
   (`packages/venue-service/src/dashboard/index.ts:14-19`, order 10; Floor plan is order 20,
   `apps/dashboard/src/dashboard-app.ts:203`), where every zone's panel carries Edit floor plan or
   Add a floor plan. So the `floor` screen id, its render case, its URL keys and its nav row go, and
   with them `itemsAmongModules`, whose only row it is (`dashboard-app.ts:161`, `:167`, `:1776-1788`);
   `/manage/floor` becomes an unknown address, which opens Overview, as the retired Sections address
   does (`apps/dashboard/src/dashboard-app.test.ts:5857-5866`). **To switch to the other answer
   later** (Task 5.1a keeps it small): add one core row to the Operations group's `itemsAfterModules`,
   `{ screen: "floor", labelKey: "nav.floor" }`, put `"floor"` back in `CORE_SCREENS`, and make its render
   case send the browser to `/manage/venue-operations` (the departments list), with one case in
   `dashboard-app.test.ts`; `nav.floor`'s two strings are kept in git history at this slice's
   commit. Cost of the default: a nav search for "floor" or "sala" (the item's labels, "Floor plan" /
   "Sala", `apps/dashboard/src/i18n/strings.ts:733`, `:3380`) finds nothing (the departments
   page's label is "Departments and zones" / "Departamentos y zonas"); an old bookmark opens
   Overview.
2. **`table.inactive` stays, with a wider meaning**: the table is not in service — it has no
   today's row, or its zone is switched off. Every assertion on it stays as it is
   (`apps/server/src/tabs.test.ts:290-305`, `party-table-actions.test.ts:492`,
   `party-move-bill.test.ts:495`, `apps/till/src/i18n/codes.test.ts:262`, `:279-282`,
   `apps/till/src/till-app-parties.test.ts:1959`, `apps/till/src/till-app.test.ts:14152`), and so
   do its words ("That table is no longer in use. Choose another table" / "Esa mesa ya no está en
   uso. Elige otra mesa", `apps/till/src/i18n/codes.ts:103-106`). Only its comment in
   `apps/server/src/errors.ts:327-328` changes. Cost: one code for two causes.
3. **"In service" is one predicate in `@waitron/db`**, `tableInService(tableId)`: the table has a
   today's row and its zone is switched on. Every reader of `active` reads it instead (the list
   above). A taken-off table is in service (it keeps its today's row), because the floor read must
   still return it (the zone menu's Taken off today, slice 4) and the seat routes refuse it
   themselves (`refuseTakenOff`, `apps/server/src/floor-today-table.ts:78`). Cost: none new. The
   overview's table total counts a taken-off table, as it does today: taking a table off never wrote
   `active` (the reset's two writes, `apps/server/src/floor-today-store.ts:346` and `:388`, are the
   only writers of `active` in `floor-today-store.ts`).
4. **Switching a zone off leaves its tables alone.** `deactivateServiceZone` stops writing
   `dining_tables`; a switched-off zone's tables are out of service through decision 3's zone half,
   and come back as today's plan has them when the zone is switched back on, so
   `reopenTodaysTables` (`apps/server/src/tables.ts:390-411`) goes. `zone.table_in_use` (a party
   still seated) stays. Cost: none expected. The backlog line "Enabling a zone or a department leaves
   what disabling switched off as it is" loses its "a zone's tables stay disabled" clause.
5. **A live table is created only by a reset from its zone's master plan.** `POST`, `PATCH` and
   `DELETE /management-api/tables[/:id]` and both APIs' placement routes go, with `createTable`,
   `updateTable`, `refuseFloorPlanChange`, `deactivateTable`, `setTablePlacement`, `clearPlacement`,
   `requireZoneInService` and `requirePlacementInt` (`apps/server/src/tables.ts`), and the codes
   only they throw: `table.zone_inactive`, `table.in_floor_plan`, `placement.invalid`.
   `GET /management-api/tables` stays (the editor and bookings read it). The tests' table maker moves
   to `apps/server/src/testing/live-table.ts` under the same name, `createTable`, so the 62 files that
   import it change one import line; from Task 5.2d it needs a zone, and from Task 5.2f it writes a
   today's row for the table (a spare) unless asked not to. Tests that switched a table off with
   `deactivateTable` use a test-only `switchOff(v, tableId)` instead, and tests that renamed one, or moved it
   to another zone, with `updateTable` update the row directly. Cost: a table can no longer be created, renamed or moved
   to another zone outside the editor. Spec §11 removes the Config tab, the placement routes and the
   card; removing the create and rename routes goes beyond it, so the PR description names this
   decision.
6. **Adoption goes with `planned`, and no code converts old venues** (this departs from the task
   list's "zones still without one get one from their live tables, as decision 16's first draft").
   Without `planned` nothing tells a never-planned live table from one whose master table was deleted
   (both have `plan_table_id` null), and after this slice's venue reset no live table without a
   master can exist: the seeds save master plans (Task 5.2a) and only a reset creates live tables
   (decision 5). CLAUDE.md §3 forbids data-migration code before go-live. So `readZonePlan` offers no
   live tables, `PlanTable.id` becomes `string`, a save entry no longer carries `liveTableId` (the
   route stops reading it), and every live table of a zone with a master plan is a reset target: one
   that follows no master table goes, as a deleted master table's does. `liveTableId` on a read
   entry stays. Cost: none expected after the reset; a configuration import is decision 9.
7. **The editor's automatic names keep skipping a name a waiting table still holds**, now read from a
   new `planTableId` on `GET /management-api/tables` (null for a table whose master table was
   deleted) instead of `active` (`floor-plan-editor.ts:845`). The case pinning the rule
   (`apps/dashboard/src/screens/floor-plan-editor.test.ts:666-673`) keeps its assertion; only its
   fixture changes. Cost: one field added to the table list's answer, which the plan did not ask for.
8. **`TableState.today` is never null from the server; the till's type still allows null.** The
   floor read answers only tables in service, so the server's `TableState.today` becomes
   `TableToday`. The till's copy stays `TableToday | null` and still lists such a table
   (`listedTables`, `apps/till/src/state/floor-map.ts:188-196`), which spares the fixtures of 34 till
   test files; `isPlannedZone` goes and every zone takes today's path. Cost: the till's type admits a
   value the server no longer sends; a backlog line asks for it to be tightened.
9. **The configuration export keeps version 2.** An export taken before this slice carries
   `dining_tables` columns that no longer exist, and import refuses it with
   `setup.request_invalid { field: "table:dining_tables" }` (`apps/server/src/configuration-transfer.ts:648-652`,
   read, not run). The task list's item to give the configuration fixture
   `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json` a zone is
   dropped: that file is a real version-1 export, refused for its version before any row is read
   (`configuration-transfer.ts:473`; the case is `apps/server/src/configuration-import.test.ts:96-187`,
   which expects `setup.configuration_outdated`). Cost: before go-live, an export from before this
   slice cannot be imported.
10. **`listTables`' `includeDisabled` keeps its name**, now meaning "tables not in service too".
    Cost: a name a reader has to translate; renaming it touches the dashboard client and its tests
    for no behaviour.
11. **The tray's token shows seats and no shape.** The till's Unplaced tray (slice 3 decision 2)
    keeps `wt-table-token`; `FloorTable` loses `posX`, `posY`, `shape`, `rotation` and `zoneId`, and
    its `capacity` becomes `seats`, fed from `seatsFor` (today's seats, or a merge's). Every tray
    token is the rounded rectangle the token already draws for a shapeless table
    (`wt-table-token.ts:284`). Cost: a round table's tray token is not round.
12. **The card permission lock goes with the layout-editor card**: `requiredPermission` in the
    layouts contract (`packages/layouts/src/card-contract.ts:14`), `CARD_REQUIRED_PERMISSION`
    (`apps/till/src/layout.ts:104-106`), the grid's locked cell and its `permissions` property
    (`apps/till/src/widgets/card-grid.ts:74`, `:193`, `:315-318`, `:327-332`) and the canvas editor's permission note
    (`apps/dashboard/src/screens/canvas-editor-screen.ts:1221-1227`, `canvas_editor.permission_note`)
    have no other card. Cost: a later permission-gated card adds the lock back. Spec §11 removes the
    card, not the lock, so the PR description names this decision.
13. **The till's no-zone tab goes.** `zone_id` is required and the floor read answers only tables
    in switched-on zones within the profile's scope, the same scope and the same "switched on" test
    as `/api/zones` (`apps/server/src/till-api.ts:2233-2283`; `listZones`, `tables.ts:303-322`), so
    every table the till gets has a tab. `isTableZoneless`, `buildZoneTabs`' `tables` and
    `noZoneLabel` parameters, `ZoneTab.key`'s null and the till's `floor.no_zone` go. Cost: if the two
    scopes ever differ, a table would be missing from every tab instead of gathered under No zone
    (reasoned from the code, not run).
14. **A table a module refuses to let go, and that has no today's row, is out of service.** Before,
    it stayed `active` (`apps/server/src/floor-today-store.test.ts:720-737`). A zone's first save
    runs a reset at once (`floor-plan.ts:464-468`), which gives every live table a today's row, so
    such a table is believed to arise only in that test's direct setup (reasoned, not run). Cost: if
    it does arise, its booking cannot be seated until it is moved, which decision 4 of the plan
    already asks for.
15. **The till's `GET /api/tables` stays.** No code in `apps/till` calls it (a grep for
    `api/tables` there finds none); only `apps/server/src/till-api.tables.test.ts` and
    `till-api.profile-zones.test.ts:1262`, `:1317` do. It is not an old placement piece; its answer
    loses the old columns with `listTables`' (Task 5.2k), and a backlog line asks whether to retire it.
16. **The migration is three files**: a custom one that drops `parties_clear_table_status`, the
    generated rebuild, and a custom one that re-creates the trigger unchanged, as `0043`, `0044` and
    `0045` did — so a later regeneration cannot drop the hand-written SQL with the generated file. It
    is refused on a venue holding a table with no zone, or any row pointing at a table (a party's
    table, a delivery, a booking, a today's row, a today's merge member in `floor_today_join_tables`,
    or a reset row — and every table of a zone with a saved plan has a today's row); a venue whose tables all have zones and that holds no such row migrates (run by
    the plan's review, 2026-10-11); `RESETS` records the refusal the walk prints (expected
    `NOT NULL constraint failed: __new_dining_tables.zone_id`, because the walk's filler leaves a
    nullable column outside every unique index null, `scripts/migration-upgrade.test.ts:38-41`).
    drizzle-kit picks the numbers. Cost: every venue is reset (the PR's first line).
17. **The demo seed saves its master plans directly** — new master tables with the seed's labels,
    seats, fixed flags and placements, whose first save creates the live tables — instead of
    creating live tables and adopting them. The seed keeps its own layout data (`capacity`, `shape`,
    `posX`, `posY` in `apps/server/scripts/demo-seed/floor.ts`), from which `onGrid` works out each
    grid placement; they are seed input, not columns, and `FloorTableShape` is replaced there by the
    seed's own union. So `seed-floor.test.ts:299-307` keeps its assertions. Cost: the seed's input
    still speaks thousandths of a canvas.
18. **The server's SPA-path cases keep `/manage/floor/...`** (`apps/server/src/boot.spa-mount.test.ts:53`,
    `apps/server/src/boot.test.ts:2474`): they check that any dashboard path serves the app, which
    stays true. Cost: none.
19. **A stored canvas naming `table-layout-editor`** meets a card grid with no case for it (its
    switch has no `default`, by design, `apps/till/src/widgets/card-grid.ts:405-407`; what the grid
    draws for such a card was not run) and is refused `unknown_card` at its next save
    (`packages/layouts/src/validate-canvas.ts:64-66`); no seed or default layout names it (a grep of
    every file type). The venue reset covers it. Cost: none before go-live.
20. **The owner's Santet venue breaks at its next rebuild, and this plan does not change it.** The
    local-only real-data worktree (`/Users/clintongormley/workspace/worktrees/waitron-local-santet-data`,
    the owner's, not in the repository) is rebuilt by `local/square/reset.sh`, which runs
    `local/square/import.mjs` (`reset.sh:33`), and that import creates each table with
    `POST /management-api/tables` and places it with `PUT /management-api/tables/:id/placement`
    (`import.mjs:324`, `:326`), both of which Task 5.2c removes. Before the next Santet rebuild the
    import has to save each zone's master plan instead (`PUT` of the zone's floor plan, which creates
    the live tables). That is the owner's job: no sub-task touches that worktree. The PR description
    says so, and the owner gets an FYI.
21. **Order of the sub-tasks.** Removals come first (5.1a–g, 5.2a–c), then a zone for every test
    table (5.2d–e), then the readers (5.2f–h), then adoption, `planned` and the answers (5.2i–m), and
    the migration last (5.3), so the schema change finds nothing still reading a dropped column.
    Where a test-only step can go first and keep every suite green, it is its own sub-task (5.1d,
    5.2b, 5.2i). Each sub-task leaves the suites it touches green, except as Task 5.2d states for
    branch coverage. Cost: some test fixtures are touched twice (the `switchOff` helper is written in
    Task 5.2b and changed in Task 5.2g).
22. **Proposed: the assertion changes listed under "Behaviour this plan removes → Slice 5, added at
    its expansion".** The task list's "Behaviour this plan removes" entry named the old screen, the
    placement routes, the card, the permille helpers and `active`/`capacity`, but not the Floor nav
    item, the old create/rename/capacity routes and the three codes, the card's permission lock, a
    zone without a master plan on the till, the no-zone tab, a table in no zone, `planned` and
    adoption, zone switch-off writing tables, `listTables`' old fields, the till's seat fallback, or
    the tray token's shape. They are added there as proposed, with `file:line`; each sub-task changes
    them in its own `Changed test checks (A429 slice 5):` commit.
23. **Two live queries gain today's rows and zones as dependencies.** Once "in service" reads
    `floor_today_tables` and `floor_zones` (Tasks 5.2g and 5.2h), a dashboard query that counts or
    lists tables in service must refresh when either changes, or it shows a stale answer until
    something else changes: bookings' `tables` query (`packages/bookings/src/dashboard/live-queries.ts:1`,
    which lists the tables in service through `GET /management-api/tables`) and the overview's
    `getSalesOverview` (`apps/dashboard/src/api/live-queries.ts:124-134`, whose open-table count is
    `countOpenTables`). The dependency lists are client-side; the server's side is the change feed,
    which already sources both tables (every core-classified table is a change source,
    `CORE_CHANGE_SOURCES`, `packages/db/src/classification.ts:240-246`; both are classified,
    `:91`, `:101`), so `scripts/live-subscriptions.test.ts` accepts them. Read, not run. The other
    queries naming `dining_tables` — `getOverdueOrders`, `listOrderPages`, `getOrder`,
    `getStationDeleteImpact` (`apps/dashboard/src/api/live-queries.ts:357`; venue-service's
    `station-delete-impact`, `packages/venue-service/src/dashboard/live-queries.ts:7`) and
    `getFloorPlan` (`:390`; venue-service's `floor-plan`, `:79`) — read no table's `active` (the "Who
    reads `active`" list above), so they change nothing here; the dashboard's `listTables` (`:383`) is
    watched only by the old floor screen, which Task 5.1a removes. The zone and department removal
    counts are one-off reads in no dependency list. Cost: the two queries refresh on every
    today's-plan change.
24. **A table in no zone stops existing, and so do the branches that handled one.** `zone_id`
    becomes required, so the cases that build a table with no zone are deleted (Task 5.2d; the
    Behaviour list names them), and the code paths for a table's null zone go in Task 5.3, where the
    schema change makes them unreachable. The typecheck does not find them (measured 2026-10-11 with
    `apps/server`'s tsc 7.0.2, `--strict`, on a scratch file: `!== null`, `=== null` and `?? "x"` on a
    plain `string` raised no error, while the control comparing a `string` with a `number` raised
    TS2367; and `eslint.config.js` is not type-aware);
    they are found by grep and by the per-file coverage table. Found by grep:
    `apps/server/src/floor-today-merges.ts:210-213`; `apps/server/src/working-order.ts:1138`, `:1264`,
    `:1282`; `apps/server/src/move-bill.ts:239`; `apps/server/src/table-actions.ts:81`, `:101`,
    `:123` (the table halves of those conditions). (`move-bill.ts:110` is not one: its zone is a
    counter request's, `MoveTarget` `:37`, copied at `:169`, which may be null; covered by
    `party-move-bill.test.ts:837`.) This answers the backlog's "A table in no zone still opens a tab, and nothing can be
    added to it" (`docs/backlog.md:2684-2688`), which Task 5.4 deletes. Cost: between Tasks 5.2d and
    5.3, `apps/server`'s branch coverage counts those branches as uncovered.

**Mutation runs.** As slices 2–4: Task 5.1g, which changes `packages/ui/src/floor.ts` and
`packages/ui/src/components/wt-table-token.ts`, runs
`gtimeout 900 pnpm --filter @waitron/ui exec stryker run --mutate <file>` once per file, and a
survivor gets an exact-value assertion. `packages/db`'s floor is not package-wide
(`docs/developers/ci-and-gates.md`); Task 5.2f runs the same command for
`packages/db/src/table-in-service.ts` with `--filter @waitron/db`. If a run cannot start or runs out
of time, say so in the commit message.

**Server tests** use a real database (`useVenueDb`), as slices 1–4 do. Rejected writes assert the
domain code. Browser tests follow slice 3's rules on fake timers, pointer events and dialogs.

**The changed-test commits.** Every sub-task that changes or deletes an existing case does it in a
separate commit whose message begins `Changed test checks (A429 slice 5):` and lists each
`file:line` with its before and after (the plan header's rule). Fixture rows, a table's zone, a
today's row, and a key added to a whole-shape pin are allowed without that commit.

### Task 5.1a: The dashboard's old Floor screen, its nav item and its write calls

**Files:**
- Delete: `apps/dashboard/src/screens/floor-screen.ts`, `floor-screen.test.ts`,
  `floor-screen.a11y.test.ts`, `floor-screen.unsaved.test.ts`, `floor-screen.save-state.test.ts`
- Modify: `apps/dashboard/src/dashboard-app.ts` (import `:60`; `"floor"` in `CORE_SCREENS` `:113`;
  `itemsAmongModules` `:161`, `:167`, the Operations row `:203`, the sort `:1776-1788`; the URL keys
  `"floor-view"` and `"floor-zone"` `:1176`; the render case `:2005-2006`),
  `apps/dashboard/src/navigation.ts:30`, `apps/dashboard/src/api/client.ts` (`TablePlacement`
  `:591-597`; `createTable`, `updateTable`, `deactivateTable`, `setTablePlacement`, `clearPlacement`
  `:2823-2848`), `apps/dashboard/src/api/live-queries.ts:383` (the `listTables` entry, which only the
  old screen watches — keep it if `scripts/live-subscriptions.test.ts` or
  `apps/dashboard/src/api/live-queries.test.ts` fails without it, and say why),
  `apps/dashboard/src/i18n/strings.ts` (`nav.floor` `:733`, `:3380`; the `floor.*` keys at
  `:950`, `:992-1018` and `:3602`, `:3645-3671` — grep each key in `apps/dashboard/src` first and
  keep any another file uses)
- Test: `apps/dashboard/src/dashboard-app.test.ts`, `dashboard-app.a11y.test.ts`,
  `dashboard-app.module-order.test.ts`, `apps/dashboard/src/api/client.test.ts`

Behaviour (decision 1): the dashboard has no `floor` screen and no Floor plan nav item; Departments
and zones is the way to a zone's floor plan. `/manage/floor` and `/manage/floor/view/plano/zone/<id>`
open Overview, as an unknown address does.

Existing tests that change (the Behaviour list): `dashboard-app.test.ts:322` (`"floor"` leaves
`NAV_SCREENS`), `:5934` (the Operations group's pages lose `"nav-floor"`), `:6179` (the search
finds `["nav-venue-settings"]`); `dashboard-app.a11y.test.ts:433-447` (deleted);
`dashboard-app.module-order.test.ts:87-120` (deleted with `itemsAmongModules`);
`apps/dashboard/src/api/client.test.ts:1604-1746` (deleted with the five methods).

- [ ] **Step 1: Write the failing test** in `dashboard-app.test.ts`, beside the retired Sections
  address (`:5857-5866`):

```ts
it("handles the retired Floor plan address as an unknown screen", async () => {
  /* history.replaceState(null, "", "/manage/floor/view/plano/zone/z1"); mount as :5857-5866 →
     no dashboard-floor-screen, location.pathname "/manage/overview" */
});
```

- [ ] **Step 2: Run and watch it fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t "retired Floor plan"`.
  Expected: fails, `dashboard-floor-screen` is drawn.
- [ ] **Step 3: Implement**, then, in the separate changed-test commit, the cases listed above.
- [ ] **Step 4: Run** `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts src/dashboard-app.a11y.test.ts src/dashboard-app.module-order.test.ts src/api/client.test.ts src/api/live-queries.test.ts src/navigation.test.ts`,
  `pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/native-form-fields.test.ts`,
  `pnpm --filter @waitron/dashboard typecheck`, `pnpm --filter @waitron/dashboard lint`,
  `pnpm exec prettier --check` on the changed files. Read each `Tests` count.
- [ ] **Step 5: Commit** — e.g. "Dashboard: the old Floor screen and its nav item are gone; zones'
  floor plans open from Departments and zones (A429 slice 5)". The body names the owner question
  (decision 1) and how to switch to the other answer.

### Task 5.1b: The table layout editor card and its permission lock

**Files:**
- Modify: `packages/layouts/src/card-contract.ts` (`Permission` import `:1`, `requiredPermission`
  `:14`, the card `:80-87`), `packages/layouts/src/canvas.ts:27`; `apps/till/src/layout.ts` (`:66`,
  `CARD_REQUIRED_PERMISSION` `:104-106`), `apps/till/src/widgets/card-grid.ts` (import `:19`,
  `permissions` `:193`, `.cell.locked` `:74`, `#locked` `:315-318`, the cell's `locked` `:327-332`,
  the card's case and `canEdit` `:479-482`), `apps/till/src/till-app.ts` (`#tabNeedsFloorData`
  `:4998-5002`; the grid's `.permissions` binding `:8838`);
  `apps/dashboard/src/screens/canvas-editor/card-contracts.ts` (`:13`, `requiredPermission?` `:103`,
  the card `:167-174`), `canvas-editor/card-preview.ts:58-62`, `canvas-editor/canvas-grid-preview.ts`
  (`:249-252`, `.cp-edit-handle` `:263-271`), `apps/dashboard/src/screens/canvas-editor-screen.ts:1221-1227`,
  `apps/dashboard/src/i18n/strings.ts` (`canvas_editor.card.table-layout-editor` `:1899`, `:4554`;
  `canvas_editor.permission_note` `:1912`, `:4567`)
- Test: `packages/layouts/src/card-contract.test.ts`, `apps/till/src/layout.test.ts`,
  `apps/till/src/widgets/card-grid.test.ts`, `card-grid.a11y.test.ts`, `apps/till/src/till-app.test.ts`,
  `apps/dashboard/src/screens/canvas-editor-screen.test.ts`, `canvas-editor/card-preview.test.ts`

Behaviour (decision 12): no card type `table-layout-editor` exists in either app or the layouts
contract, and no card carries a required permission. The floor card's floor screen is never told it
may edit (its `canEdit` goes in Task 5.1c). The card grid's `permissions` property (`card-grid.ts:193`)
has no reader but the lock (`:317`, a grep of the file), so it goes too, with the till app's binding
(`apps/till/src/till-app.ts:8838`); the app's own `permissions` state stays.

Existing tests that change: `card-contract.test.ts:22-24`;
`apps/dashboard/src/screens/canvas-editor/card-contracts.parity.test.ts:80` (the case `:73-86`
loses its `requiredPermission` line with the field); `layout.test.ts:38-41`;
`card-grid.test.ts:382-387` (its editor tab), the `canEdit` assertion in `:626-640`, `:674-712`;
`card-grid.a11y.test.ts:20-26` (its fixture), `:51-59`; `till-app.test.ts` the `canEdit` assertion
in `:6414-6432`, and `:6434-6476`; `canvas-editor-screen.test.ts:594-601`; `card-preview.test.ts:31`.

- [ ] **Step 1: Write the failing tests:**

```ts
// packages/layouts/src/card-contract.test.ts
it("has no table layout editor card, and no card that needs a permission", () => {
  /* expect(CARD_TYPES).not.toContain("table-layout-editor");
     expect(Object.values(CARD_CONTRACTS).some((c) => "requiredPermission" in c)).toBe(false) */
});
// apps/dashboard/src/screens/canvas-editor-screen.test.ts
it("does not offer the table layout editor card", async () => { /* the add-card picker's options hold no "table-layout-editor" */ });
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/layouts exec vitest run src/card-contract.test.ts` and
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/canvas-editor-screen.test.ts -t "table layout editor"`.
- [ ] **Step 3: Implement**, then the changed-test commit for the cases above.
- [ ] **Step 4: Run** `pnpm --filter @waitron/layouts exec vitest run`,
  `pnpm --filter @waitron/till exec vitest run src/layout.test.ts src/widgets/card-grid.test.ts src/widgets/card-grid.a11y.test.ts src/till-app.test.ts`,
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/canvas-editor-screen.test.ts src/screens/canvas-editor`
  (which holds `card-contracts.parity.test.ts`),
  each touched package's typecheck and lint, `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Canvases: the till's table layout editor card is gone; the floor
  plan is edited only on the dashboard (A429 slice 5)".

### Task 5.1c: The till's Edit plan and its placement writes

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` (`api`'s comment `:464-465`, `canEdit`
  `:466-468`, `editing` `:496`, the planned-zone reset of `editing` `:563-565`, `#toggleEdit`
  `:719-723`, `#onPlacementChange` and `#onPlacementClear` `:736-760`, the Edit plan button
  `:1213-1224`, `#onTrayTap`'s editing branch `:1337-1343`, `#placeFromTray` `:1345-1361`, the
  `PlacementChange`, `PlacementClear` and `defaultTraySlot` imports), `apps/till/src/widgets/card-grid.ts`
  (the floor card's `.canEdit` binding, if Task 5.1b left one), `apps/till/src/api/client.ts`
  (`TableShape` `:1921`, `TablePlacement` `:1923-1934`, `setTablePlacement` and `clearPlacement`
  `:3720-3739`), `apps/till/src/i18n/strings.ts` (`floor.edit_plan` `:517`, `:1688`)
- Test: `apps/till/src/screens/till-floor-screen.test.ts`, `till-floor-screen.map.test.ts`,
  `till-floor-screen.a11y.test.ts`, `apps/till/src/api/client.test.ts`

Behaviour: the floor screen has no Edit plan button, no editing state and no placement writes; a
tray table tapped always opens (or seats) the table. The old canvas itself goes in Task 5.1e.

Existing tests that change: `till-floor-screen.test.ts:541-547` (the embedded screen keeps its
view toggle, and no `.edit-toggle`), the Edit plan and placement cases of `:549-855` (`:619-665`,
`:706-855`), the `EDIT_ROLES`/`canEdit` helpers `:60-80`; `till-floor-screen.map.test.ts:247-278`;
`till-floor-screen.a11y.test.ts:564-583`; `apps/till/src/api/client.test.ts:2689-2746`.

- [ ] **Step 1: Write the failing test** in `till-floor-screen.map.test.ts`:

```ts
it("offers no Edit plan, and a tray table tapped opens it", async () => {
  /* a planned zone with a seated unplaced t4 in the tray, the screen given canEdit-free props;
     no [data-edit-toggle]; click [data-tray-table=t4] → open-table { tableId: "t4", seated: true };
     `"canEdit" in el` is false */
});
```

- [ ] **Step 2: Run and watch it fail** —
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.map.test.ts -t "offers no Edit plan"`.
  Expected: fails on `"canEdit" in el`.
- [ ] **Step 3: Implement**, then the changed-test commit.
- [ ] **Step 4: Run** `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.test.ts src/screens/till-floor-screen.map.test.ts src/screens/till-floor-screen.a11y.test.ts src/api/client.test.ts src/widgets/card-grid.test.ts`,
  the till's typecheck and lint, `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Till floor: no Edit plan; the floor plan is edited only on the
  dashboard (A429 slice 5)".

### Task 5.1d: The old canvas's cases leave the till's floor tests

Split from Task 5.1e. This one changes tests only, and goes first, so both tasks stay green: while
the old canvas still exists, deleting the cases that pin it and moving the tray cases' fixtures to
today's rows breaks nothing. No failing test first: no product code changes here.

**Files:**
- Test: `apps/till/src/screens/till-floor-screen.test.ts`, `till-floor-screen.a11y.test.ts`,
  `till-floor-screen.refresh.test.ts`, `till-floor-screen.signals.test.ts`,
  `till-floor-screen.parties.test.ts`

Existing tests that change (the Behaviour list), each deleted, or its half deleted: every case or
half-case that draws, taps or reads `wt-floor-canvas` — `till-floor-screen.test.ts:361-372`,
`:549-618` and `:668-705` (the old canvas, and the old map's tray, which the new map's tray cases,
`till-floor-screen.map.test.ts:202-227`, and Task 5.1c's case cover), `:929-941`;
`till-floor-screen.a11y.test.ts` the map halves of `:323-367`, `:369-411`, `:413-467`;
`till-floor-screen.refresh.test.ts` the old-capacity half of `:123-166` and the old-map half of
`:189-203`; `till-floor-screen.signals.test.ts:119-132`; `till-floor-screen.parties.test.ts:140-153`,
`:227-245`, the map halves of `:254-270`, `:278-284`, `:286-300`, `:352-427`, `:525-555`,
`:660-675`. The new map already has its own cases for each kind of thing
(`till-floor-screen.map.test.ts:113-300`, slice 3; slice 4's floor files), and the totals, names and
marks the old tokens drew live in the details sheet now (spec §5). Fixtures only, assertions
unchanged: the closed-zone matrix's map arm (`till-floor-screen.a11y.test.ts:586-630`, which then
taps the new map with `wt-table-tap` on a table given a today's place) and the tray cases
(`till-floor-screen.signals.test.ts:134-142`, `till-floor-screen.parties.test.ts:557-600`, `:677-684`;
their placed neighbour gets a today's place instead of `posX`, so the map, and so the tray, still
shows).

- [ ] **Step 1:** The changed-test commit (deletions and halves), then the fixture commit.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.test.ts src/screens/till-floor-screen.a11y.test.ts src/screens/till-floor-screen.refresh.test.ts src/screens/till-floor-screen.signals.test.ts src/screens/till-floor-screen.parties.test.ts`,
  the till's typecheck and lint, `prettier --check`. Expected: all pass, the old canvas still in
  the code.
- [ ] **Step 3: Commit** — e.g. "Till floor tests: the old canvas's cases go before it does (A429
  slice 5)".

### Task 5.1e: Every zone on today's map — the till's old canvas goes

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` (`PlacedTable` `:96`; `ZoneOnScreen.placed`
  `:120`; the comments and styles for the old map `:17-18`, `:179-200`; `#canvasCopy` `:1101-1118`;
  `#zoneOnScreen` `:1120-1176`: `planned` is always true, so `placed` and the old `unplaced` split
  go; render's view switch `:1250-1256`; `#map` `:1263-1278`; `#tray`'s `placed` argument and
  `#trayItem` `:1307-1335`; the `FloorCanvasCopy` import),
  `apps/till/src/state/floor-map.ts` (`isPlannedZone` `:127-129` goes), `apps/till/src/i18n/strings.ts`
  (`floor.zone` `:519`, `:1690`; `floor.remove` `:538`, `:1709`; `floor.shape`, `floor.shape_round`,
  `floor.shape_square`, `floor.shape_rect` `:539-542`, `:1710-1713` — keep `floor.rotate`, which the
  details sheet uses, `apps/till/src/widgets/table-details-sheet.ts:51`, and `floor.unplaced`, the tray's)
- Test: `apps/till/src/screens/till-floor-screen.map.test.ts`, `apps/till/src/state/floor-map.test.ts`

Behaviour (the plan's decision 2 ends): the floor screen draws every zone's map with `wt-floor-map`
from today's rows; a zone whose tables have no today's row (which the server stops sending in Task
5.2g, decision 8) shows them in the list and the tray, and the view defaults to the list when the
map has no table, as now. The 15-second re-read runs whenever the map shows (`#watchFloor`, `:576-587`,
loses its `planned` test).

Existing tests that change (the Behaviour list): `till-floor-screen.map.test.ts:138-142`;
`apps/till/src/state/floor-map.test.ts:178-182`.

- [ ] **Step 1: Write the failing test** in `till-floor-screen.map.test.ts`:

```ts
it("never draws the old canvas, even for a zone with no today's rows", async () => {
  /* placed("t1") with today null → no wt-floor-canvas; the view is the list; t1 is listed */
});
```

- [ ] **Step 2: Run and watch it fail** —
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.map.test.ts -t "never draws the old canvas"`.
  Expected: fails, the old canvas is drawn.
- [ ] **Step 3: Implement**, then the changed-test commit.
- [ ] **Step 4: Run** every till floor file:
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen src/state/floor-map.test.ts src/screens/device-screens.phone-margin.test.ts`,
  `pnpm exec vitest run scripts/style-token-names.test.ts`, the till's typecheck and lint,
  `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Till floor: every zone is drawn from today's plan; the old canvas
  is gone (A429 slice 5)".

### Task 5.1f: No more No zone tab

**Files:**
- Modify: `packages/ui/src/floor.ts` (`isTableZoneless` `:109-118` goes; `ZoneTab.key` becomes
  `string` `:121-124`; `buildZoneTabs(zones)` loses `tables` and `noZoneLabel` `:126-137`;
  `resolveActiveTabKey` `:140-146` takes and returns `string | undefined`), `packages/ui/src/index.ts`
  (the barrel, `:66-93`), `apps/till/src/screens/till-floor-screen.ts` (`#zoneOnScreen`'s tabs and
  filter `:1131-1146`; `activeZone`'s null, which meant the no-zone tab, and the URL's empty zone
  segment it wrote), `apps/till/src/i18n/strings.ts` (`floor.no_zone` `:496`, `:1670`)
- Test: `packages/ui/src/floor.test.ts`, `apps/till/src/screens/till-floor-screen.test.ts`,
  `till-floor-screen.map.test.ts`

Behaviour (decision 13): the till's zone tabs are the zones it was given, in display order, and
nothing else; the active zone is one of them, or the first. An address naming the empty zone segment
(`/tabs/floor/zone/~`) opens the first zone.

Existing tests that change: `packages/ui/src/floor.test.ts:95-139`, `:153-160`, `:170-173`;
`till-floor-screen.test.ts:467-517`, `:880-899`; `till-floor-screen.map.test.ts:290-293`.

- [ ] **Step 1: Write the failing tests:**

```ts
// packages/ui/src/floor.test.ts
test("buildZoneTabs is the zones in display order, and nothing else", () => {
  /* buildZoneTabs([{ id: "b", name: "B", displayOrder: 2 }, { id: "a", name: "A", displayOrder: 1 }]) →
     [{ key: "a", name: "A" }, { key: "b", name: "B" }] (a second argument is not accepted) */
});
// till-floor-screen.test.ts
it("opens the first zone for an address with an empty zone segment", async () => { /* /tabs/floor/zone/~ → z1 active, no [data-zone="none"] */ });
```

- [ ] **Step 2: Run and watch them fail** — `pnpm --filter @waitron/ui exec vitest run src/floor.test.ts`
  and `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.test.ts -t "empty zone segment"`.
- [ ] **Step 3: Implement**, then the changed-test commit.
- [ ] **Step 4: Run** the two files above and `src/screens/till-floor-screen.map.test.ts`, both
  packages' typecheck and lint, `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Till floor: zone tabs are the zones; no No zone tab (A429 slice 5)".

### Task 5.1g: `wt-floor-canvas` and the permille helpers go; the tray token shows seats

**Files:**
- Delete: `packages/ui/src/components/wt-floor-canvas.ts`, `wt-floor-canvas.test.ts`,
  `wt-floor-canvas.a11y.test.ts`
- Modify: `packages/ui/src/floor.ts` (`FLOOR_ASPECT` `:3`, `GRID_STEP` `:6`, `TableShape` `:15`,
  `Placement` `:64-70`, `PlacementChange` `:73-75`, `PlacementClear` `:78-80`, `sizeForCapacity`
  `:82-88`, `snapToGrid` `:90-92`, `clampPermille` `:99-101`, `defaultTraySlot` `:105-107` go;
  `ROTATION_STEP` and `snapRotation` stay for the editor; `FloorTable` `:37-61` loses `posX`, `posY`,
  `shape`, `rotation`, `zoneId`, and `capacity` becomes `seats`; `FloorPlacementInput` `:148-157`
  becomes `{ id; label; seats? }`), `packages/ui/src/index.ts` (barrel `:45-46`, `:66-93`),
  `packages/ui/src/components/wt-table-token.ts` (`shape-*` class `:284` and its rules; `seats` at
  `:292-294`), `apps/till/src/screens/till-floor-screen.ts` (`#toFloorTable` `:1072-1099` passes
  `seats: seatsFor(table)`)
- Test: `packages/ui/src/floor.test.ts`, `packages/ui/src/components/wt-table-token.test.ts`,
  `wt-table-token.a11y.test.ts`, `apps/till/src/screens/till-floor-screen.parties.test.ts` (the tray
  cases)

Behaviour (decision 11): the tray token draws the table's label, its seats for today with the
covers suffix ("6 pax"), and its occupancy, as a rounded rectangle; nothing in the tree draws a
table from permille coordinates.

Existing tests that change: `floor.test.ts:17-57` (keeping the `ROTATION_STEP` half of `:41-44`),
`:79-93`, `:175-204`, `:268-286`; `wt-table-token.test.ts:368-381` (`capacity` → `seats`, same
text), `:390-406`; `wt-table-token.a11y.test.ts:63-66` (fixture).

- [ ] **Step 1: Write the failing tests:**

```ts
// wt-table-token.test.ts
test("shows the table's seats with the covers suffix", async () => { /* table { seats: 6 }, labels { covers: "pax" } → ".capacity" text "6 pax" */ });
// till-floor-screen.parties.test.ts (a tray case)
it("shows today's seats on a tray token", async () => { /* a seated unplaced t4 with today.seats 6 beside a placed t1 → tray token text contains "6 pax" */ });
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-table-token.test.ts` and
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.parties.test.ts -t "tray token"`.
- [ ] **Step 3: Implement**, then the changed-test commit. Grep `apps/` and `packages/` for each
  removed export before deleting it (Task 5.1a removed the dashboard's last users); none may remain.
- [ ] **Step 4: Run** `pnpm --filter @waitron/ui exec vitest run src/floor.test.ts src/components/wt-table-token.test.ts src/components/wt-table-token.a11y.test.ts src/base-styles.test.ts src/no-hardcoded-chrome.test.ts`,
  the till's floor files (`src/screens/till-floor-screen`), `pnpm exec vitest run scripts/style-token-names.test.ts`,
  both packages' typecheck and lint, `prettier --check`, and the two Stryker runs (`floor.ts`,
  `wt-table-token.ts`).
- [ ] **Step 5: Commit** — e.g. "UI: the old floor canvas and its permille helpers are gone; the
  tray token shows today's seats (A429 slice 5)". Rewrite the backlog's "A four-digit total does not
  fit a small round table on the till's floor map" for the tray token in Task 5.4, not here.

### Task 5.2a: The demo seed saves master plans

**Files:**
- Modify: `apps/server/scripts/demo-seed/seed-floor.ts` (imports `:23-24`; the comments `:37`, `:51`;
  the table loop and the adoption `:220-263`), `apps/server/scripts/demo-seed/floor.ts` (`:2`
  comment; `FloorTableShape` import `:5` replaced by a local `"round" | "square" | "rect"`)
- Test: `apps/server/scripts/demo-seed/seed-floor.test.ts`

Behaviour (decision 17): for each seeded zone with tables, `seedFloor` calls `saveZonePlan(tx, cfg,
[], zoneId, { revision: 0, tables, joins: [] })` with one entry per seed table — `key` and `label`
the table's label, `seats` its `capacity`, `fixed`, `placement` — and nothing else; that first save
creates the live tables and today's plan (`floor-plan.ts:464-468`). `createTable` and
`setTablePlacement` are no longer called. Before its first save, for every seeded zone (not only
those with seed tables, as `seed-floor.ts:240-251` loops today), the seed reads the zone's live
tables and throws, naming the first one's label, if there is any: the error it raises today through
the adoption draft (`:248-252`), so a table the seed did not create is still refused.

No failing test first: the seed's result — zones, master plans, today's plan, labels, seats, fixed
flags and places — is the same, and is pinned by `seed-floor.test.ts:196-297` and `:299-307`, which
must pass unchanged, and so must `:309-328` (the seed refuses, naming it, a table in a seeded zone it
did not create; its setup's `createTable` comes from the test helper after Task 5.2b). Existing test that changes: `seed-floor.test.ts:144-194` stops reading
`capacity`, `pos_x`, `pos_y` and `shape` off `dining_tables` and reads each table's master table
instead (`floor_plan_tables.seats`, `x`, `y`, `shape`), so it still checks every restaurant table is
placed and has seats.

- [ ] **Step 1: Change `seed-floor.test.ts:144-194`** (the changed-test commit) and run it against
  the old seed: `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed-floor.test.ts`
  — it passes (the old seed also writes master tables), which shows the new read is not vacuous only
  if Step 3's mutation fails it.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** `pnpm --filter @waitron/server exec vitest run scripts/demo-seed`, then, as a
  control, delete the `placement` from one seed entry's save and watch `:196-297` fail; restore.
  `pnpm --filter @waitron/server typecheck`, lint, `prettier --check`.
- [ ] **Step 4: Commit** — e.g. "Demo seed: each zone's tables come from its saved floor plan (A429
  slice 5)".

### Task 5.2b: The tests' table maker moves to `src/testing`

Split from Task 5.2c, which was likely to pass 100 tool calls as one task: this one only moves test
code, so every suite stays green with no assertion changed.

**Files:**
- Create: `apps/server/src/testing/live-table.ts`
- Modify: the test files under `apps/server` that import `createTable` from `./tables.js` or
  `../../src/tables.js` — about 60: `grep -rln "createTable" apps/server/src apps/server/scripts`
  finds 63, less `apps/server/src/tables.ts` (the definition), `apps/server/src/management-api.ts`
  (product code that needs `tables.ts`' `createTable` until Task 5.2c),
  `apps/server/scripts/demo-seed/seed-floor.ts` (its import went in Task 5.2a) and
  `apps/server/src/tables.test.ts`, which stays on `./tables.js` because its cases at `:157`, `:165`
  and `:220` test refusals the moved helper drops (`zone.not_found`, `table.label_taken`, an
  unrelated database error re-thrown) and Task 5.2c deletes them; and the test files that use
  `deactivateTable` as setup (`party-table-actions.test.ts:23`, `:481`; `party-move-bill.test.ts:23`,
  `:487`), `updateTable` to rename a table (`party-table-names.test.ts:10`, `:105`, `:149`), or
  `updateTable` to move one to another zone (`tabs.test.ts:48`, `:1026`)

**Interfaces:**

```ts
// apps/server/src/testing/live-table.ts — tests only; apps/server's coverage leaves src/testing out (vitest.config.ts:30)
/** A live table, as a reset would leave one. */
export async function createTable(
  tx: Transaction, cfg: TillConfig, input: { label: string; zoneId?: string; capacity?: number },
): Promise<{ id: string }>;
/** Takes the table out of service, as a reset hides one. */
export async function switchOff(v: HasDb, tableId: string): Promise<void>; // for now: active = false (Task 5.2g changes it)
```

Behaviour: none in the product. The moved `createTable` writes the same row as `tables.ts`'s does
(it keeps `capacity` until the column goes in Task 5.3), without the zone checks and the
`table.label_taken` translation, which belong to the route Task 5.2c removes. `tables.ts`' own
`createTable` stays until Task 5.2c, for the routes that still call it.

- [ ] **Step 1:** Write `live-table.ts`; point those imports at it with a scripted replace of the
  import line (the typecheck then lists any file left); replace the `deactivateTable` setups with
  `switchOff`, the `updateTable` renames with `update(diningTables).set({ label })` and the zone move
  in `tabs.test.ts:1026` with `update(diningTables).set({ zoneId })`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/tabs.test.ts src/party-table-actions.test.ts src/party-move-bill.test.ts src/party-table-names.test.ts`,
  then `pnpm --filter @waitron/server test:coverage` once (check free memory first,
  `memory_pressure | grep free`), the server's typecheck and lint, `prettier --check`. Expected:
  everything passes with no assertion changed; an assertion that would have to change is a STOP.
- [ ] **Step 3: Commit** — e.g. "Server tests: tables for tests are made by a test helper (A429
  slice 5)".

### Task 5.2c: The old table write routes and verbs go

Marked large: it removes routes from both APIs and trims nine test files. If it passes about 100
tool calls, stop at a green point after the till API's half, commit, and hand over.

**Files:**
- Modify: `apps/server/src/management-api.ts` (imports `:94-109`; `STATUS` `table.zone_inactive`
  `:298`, `table.in_floor_plan` `:299`, `placement.invalid` `:303`; `requireTableId` `:346` and
  `parseCapacity` `:512` if nothing else uses them; `POST` `:1798-1823`, `PATCH` `:1836-1881`,
  `DELETE` `:1883-1891`, the placement routes `:1893-1939`), `apps/server/src/till-api.ts` (imports
  `:101`, `:105`, `:107`; `STATUS` `:504`, `:505`, `:513`; the placement routes `:3077-3134`),
  `apps/server/src/tables.ts` (`COORD_MAX`, `ROTATION_MAX`, `requirePlacementInt` `:25-33`,
  `requireZoneInService` `:50-60`, `createTable` `:77-109`, `updateTable` `:139-186`,
  `refuseFloorPlanChange` `:187-216`, `deactivateTable` `:218-232`, `setTablePlacement` `:234-278`,
  `clearPlacement` `:280-294`), `apps/server/src/errors.ts` (`table.zone_inactive` `:329`,
  `table.in_floor_plan` `:330-334`, `placement.invalid` `:729-733`; `table.inactive`'s comment
  `:327`, decision 2), `apps/dashboard/src/i18n/codes.ts` (`:521-528`, `:565-568`),
  `apps/server/src/till-api.profile-zones.test.ts` (the map's rows `:104-105` and the `ROUTES` rows
  `:689-709`), `apps/server/src/till-api.profile-actions.test.ts` (the header's "and table placement,
  which needs `venue.configure`", `:105`)
- Test: `apps/server/src/management-api.test.ts`, `tables.test.ts`, `tables.location-scope.test.ts`,
  `served-at-huella.test.ts`, `till-api.test.ts`, `till-api.tables.test.ts`, `errors.test.ts`,
  `till-api.profile-zones.test.ts`

Behaviour (decision 5): the dashboard and the till can no longer create, rename, re-zone, size,
switch off or place a table; `GET /management-api/tables` is unchanged, and so are its refusals (403
for a staff session, 401 with none).

Existing tests that change (the Behaviour list):
- `management-api.test.ts`: the cases of `describe("/management-api/tables")` `:794-1704` that test
  `POST`, `PATCH`, `DELETE` or a placement route are deleted, except: the mixed refusal cases
  `:1641-1655`, `:1672-1692` and `:1694-1710` lose their `POST`/`PATCH`/`DELETE` rows and keep their
  `GET` rows (trim the write rows; keep the GET rows, which still assert 403 and 401 for
  `GET /management-api/tables`); the zone-only cases `:1237-1286` stay as they are; `:1287-1327`,
  `:1328-1348` and `:1350-1366` keep their assertions here and change in Task 5.2h; the GET list case
  `:1092-1100` stays, its `DELETE` setup becoming `switchOff`; `:815-848` (GET projects a placed
  table's placement columns) is deleted. Setup only: the tables the kept cases need —
  `tableInServiceZone` (`:1167-1189`), `newTable()` (`:1078-1084`, used by the kept `:1092` and
  `:1641`), the "occupied zone" case (`:586-609`, its `POST /tables` at `:591`), and the plan cases'
  `POST /tables` at `:3787-3792` and `:3823-3828` (until Task 5.2j changes those two cases) — are
  made with `createTable` instead of `POST /tables`.
  `describe("/management-api/tables/:id/placement")` `:1741-1933` is deleted.
- `tables.test.ts:132-148`, `:150-250`, `:252-329`, `:331-385`, `:691-797` (the remaining cases'
  `createTable` import moves to the test helper);
  `tables.location-scope.test.ts:68-119`; `served-at-huella.test.ts:389-416`;
  `till-api.test.ts:3717-4029`; `till-api.tables.test.ts:233-262` (the row read stops selecting
  `capacity` and `active`; the 404 answers stay); `errors.test.ts:25-31`;
  `till-api.profile-zones.test.ts:689-709` (the three placement rows of `ROUTES`, which refuse the
  placement routes outside the profile's zones).

- [ ] **Step 1: Write the failing tests** in `apps/server/src/management-api.test.ts` and
  `till-api.tables.test.ts`:

```ts
it.each([
  ["POST", "/tables"], ["PATCH", "/tables/<id>"], ["DELETE", "/tables/<id>"],
  ["PUT", "/tables/<id>/placement"], ["DELETE", "/tables/<id>/placement"],
])("answers %s %s 404 for a manager, and the table is unchanged", async (method, path) => { /* manager cookie; a table made with createTable; status 404; its row unchanged */ });
// till-api.tables.test.ts
it.each(["PUT", "DELETE"])("answers %s /api/tables/:id/placement 404, and the table is unchanged", async (method) => { /* manager session */ });
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/server exec vitest run src/management-api.test.ts src/till-api.tables.test.ts -t "answers"`.
  Expected: the routes answer 201/204.
- [ ] **Step 3: Implement**: remove the routes, verbs, codes, `STATUS` rows, wording and route-map
  rows; move the setups above to `createTable`. Then the changed-test commit.
- [ ] **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/management-api.test.ts src/tables.test.ts src/tables.location-scope.test.ts src/served-at-huella.test.ts src/till-api.test.ts src/till-api.tables.test.ts src/errors.test.ts src/till-api.profile-zones.test.ts src/till-api.profile-actions.test.ts`,
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n`, and
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`. Those two
  are run because `apps/server/src/errors.ts` changes, but by their own headers neither reads that
  file for a refusal code (one checks that a package's `errors.ts` is reachable from its barrel, the
  other the codes of recorded incidents), so a pass shows only that nothing they do check broke.
  Then the server's and dashboard's typecheck and lint, `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Server: tables are no longer created, renamed, switched off or
  placed outside the floor plan editor (A429 slice 5)".

### Task 5.2d: Every test table gets a zone — apps/server

Before the predicate (Task 5.2f): a table in no zone will be out of service, since its zone cannot be
switched on, so every test table needs a zone first.

**Files:**
- Modify: `apps/server/src/testing/live-table.ts` (`zoneId` becomes required), and every
  `apps/server` call site and insert that makes a table with no zone: `createTable` calls with no
  `zoneId` (35 one-line calls counted by
  `grep -rn "createTable(tx, [a-zA-Z.]*, { label[^}]*})" apps/server | grep -v zoneId`, plus multi-line
  ones the typecheck finds), and the direct inserts with no zone (`configuration-transfer.test.ts:495`,
  `:1839`; `floor-today-changes.test.ts:386`; `floor-today-merge-api.test.ts:297`;
  `floor-today-moves.test.ts:222`; `floor-today-seat-api.test.ts:263`; `kitchen-print.test.ts:707`;
  `live-api.test.ts:312`; `report-api.overdue-orders.test.ts:101`; `report-api.overview.test.ts:111`;
  `venue-details.test.ts:921`; `working-order-reads.sqlite.test.ts:94`; `working-order.test.ts:5860`)
- Test: those files, and the cases that need a table with no zone, deleted here (decision 24; the
  Behaviour list): `apps/server/src/floor-plan.test.ts:392-409`;
  `apps/server/src/till-api.zone-required.test.ts:257-269`, `:270-282`, `:283-297` (their venue's
  table, made at `:134`, gets a zone; the parked-order and open-order cases `:243-256` and `:299`
  onwards stay); `apps/server/src/party-move-bill.test.ts:337-352`, `:798-811`, `:1054-1068`,
  `:1112-1123`, `:1125-1136` (with the helper `partyBillInTicketZone`, `:1073-1110`, if nothing else
  uses it); `apps/server/src/floor-today-merges.test.ts:164-180`, `:182-217`;
  `apps/server/src/made-here.routes.test.ts:1675-1687`, `:1689-1707` (deleted; `bareParty()`,
  `:235-246`, gives its table a zone for its other users, `:1710`, `:1776`); and the half of
  `apps/server/src/watch-zones.test.ts:126-170` at `:164-169` that sets a delivery table's zone to
  null (deleted; the rest of the case stays)

Behaviour: none in the product. Each table gets the zone its test already uses for its other tables
(`v.tables.zoneId`, `venue.zoneId`, the zone the case made), or, where the case has none, a zone made
with the package's own zone helper. Where a case relied on its table having no zone to skip a zone
check (service mode, opening hours, a profile's zones), an assertion that would change is a STOP.
`active:`, `capacity:` and `planned:` keys on inserts are left for their own tasks.

- [ ] **Step 1: Find the sites.** First make `createTable`'s `zoneId` required in
  `apps/server/src/testing/live-table.ts` and run `pnpm --filter @waitron/server typecheck`: it
  lists every caller with no zone. Then, in the worktree only, make `zoneId` `.notNull()` in
  `packages/db/src/schema/dining-tables.ts`, run the typecheck again for the direct inserts, keep
  the list, and restore the schema file (`git checkout packages/db/src/schema/dining-tables.ts`).
  Raw SQL inserts are not typed: grep `insert into dining_tables` too.
- [ ] **Step 2: Fix each site** as Behaviour says; delete the no-zone cases above.
- [ ] **Step 3: Run** each changed file, then `pnpm --filter @waitron/server test:coverage` once
  (check free memory first, `memory_pressure | grep free`). Expected: every test passes; the branch
  threshold (95) may fail, and if it does, the per-file report must show as newly uncovered only the
  null-zone branches decision 24 names, which Task 5.3 deletes — anything else uncovered is a STOP.
  The server's typecheck and lint, `prettier --check`.
- [ ] **Step 4: Commit** — e.g. "Server tests: every table is in a zone (A429 slice 5)", then the
  changed-test commit for the deleted no-zone cases.

### Task 5.2e: Every test table gets a zone — packages and scripts

**Files:**
- Modify: `packages/db/src/party-table-labels.test.ts:61`, `:206`;
  `packages/db/src/schema/delivery-table-link.test.ts:63`; `dining-tables.test.ts:42`;
  `floor-zones.test.ts:63`; `parties.test.ts:46`; `table-service-statuses.test.ts:52`;
  `packages/bookings/src/bookings-cas.test.ts:43`; `bookings.test.ts:63`; `floor.test.ts:43`;
  `routes.test.ts:96`; `schema/bookings.test.ts:69`; `table-removal.test.ts:39`;
  `packages/reporting/test/fixtures.ts:496`, `:541`; `scripts/behavioural-triggers.test.ts:271`
  (raw SQL: add `zone_id`, and a `floor_zones` row if foreign keys are on there)
- Test: those files

Behaviour: none in the product; as Task 5.2d.

- [ ] **Step 1: Find the sites** as Task 5.2d's Step 1, with the typecheck of each package that
  imports `diningTables` (`db`, `bookings`, `reporting`, `venue-service`:
  `pnpm --filter @waitron/<pkg> typecheck`), and a grep of `scripts/` and `bench/` for `dining_tables`.
- [ ] **Step 2: Fix each site.**
- [ ] **Step 3: Run** each changed file (`pnpm --filter <pkg> exec vitest run <file>`;
  `pnpm exec vitest run scripts/behavioural-triggers.test.ts`), the packages' typecheck and lint,
  `prettier --check`.
- [ ] **Step 4: Commit** — e.g. "Package tests: every table is in a zone (A429 slice 5)".

### Task 5.2f: "In service" — the predicate, and a today's row for every test table

Split from Task 5.2g to keep each under 100 tool calls: this task adds the predicate and gives every
test table a today's row; Task 5.2g switches the readers. No reader of `active` reads today's rows, so
the rows change no refusal yet; they do change what the floor read's `today` and the reset's
`hasToday` see for those tables, which is why the floor files that write their own today's row pass
`{ today: false }`, and why `apps/server/src/floor-today-state.test.ts:139-143` (a table of a zone with
no master plan answers `today: null`) is deleted here, in this task's changed-test commit.

**Files:**
- Create: `packages/db/src/table-in-service.ts`, `packages/db/src/table-in-service.test.ts`
- Modify: `packages/db/src/index.ts` (export), `apps/server/src/testing/live-table.ts` (`createTable`
  writes a today's row, a spare, unless `{ today: false }`), `apps/server/src/testing/party-venue.ts`
  (`tableAt` `:186-193` writes one too), and the server tests that insert a table straight into
  `dining_tables` and then seat it, open a tab at it, move guests or a bill to it, or read the floor
  (candidates, from the insert sites a grep found: `kitchen-print.test.ts:651`, `:707`, `:1019`;
  `till-sale.test.ts:1832`, `:1888`, `:1917`, `:2322`; `vat-class-at-line-add.test.ts:284`;
  `vat-rate-at-issue.test.ts:236`; `issuance-pass.test.ts:294`; `working-order.test.ts:1028-1222`,
  `:2688`, `:3341`, `:5835`, `:5860`; `working-order.pay-and-dispatch.test.ts:2690`;
  `live-api.test.ts:312`; `venue-details.test.ts:921`; `report-api.overdue-orders.test.ts:101`;
  `report-api.overview.test.ts:111-115` (its two tables that stay in service, not the "inactive"
  one); `working-order-reads.sqlite.test.ts:94`; `configuration-transfer.test.ts:495`, `:1839`)
- Test: `packages/db/src/table-in-service.test.ts`, `apps/server/src/floor-today-state.test.ts`

**Interfaces:**

```ts
// packages/db/src/table-in-service.ts
/**
 * A table staff can use: it has a today's row, and its zone is switched on. A reset takes a table it
 * is removing off today's plan by deleting that row.
 */
export function tableInService(tableId: SQLWrapper): SQL; // exists (today's row of tableId, its zone active)
```

Behaviour (decision 3): `tableInService` is true for a table with a today's row, taken off or not,
whose zone is switched on, and false otherwise; it reads nothing else. A test that inserts its own
today's row for a table it made with `createTable` passes `{ today: false }` (the floor files do:
`grep -rn "insert(floorTodayTables)" apps/server/src --include='*.test.ts'`).

- [ ] **Step 1: Write the failing tests** (`useVenueDb` with the core migrations, as
  `packages/db/src/schema/floor-plans.test.ts` does):

```ts
it("calls a table with a today's row in a switched-on zone in service, a taken-off one too", async () => {});
it("calls a table with no today's row out of service, though `active` is true", async () => {});
it("calls a table out of service while its zone is switched off, and in again when it is on", async () => {});
it("is usable in a raw select as a column", async () => { /* select ${tableInService(sql`dt.id`)} as in_service from dining_tables dt */ });
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/db exec vitest run src/table-in-service.test.ts`. Expected: the file fails
  to load, because `./table-in-service.js` does not exist yet.
- [ ] **Step 3: Implement** the predicate; then the test tables: `createTable`, `tableAt`, and a
  today's row (`insert(floorTodayTables).values({ tableId })`) after each candidate insert. Commit the
  fixtures separately.
- [ ] **Step 4: Run** `pnpm --filter @waitron/db exec vitest run src/table-in-service.test.ts`, the
  Stryker run for `table-in-service.ts`, each changed server test file
  (`pnpm --filter @waitron/server exec vitest run <file>`), the floor files
  (`pnpm --filter @waitron/server exec vitest run src/floor src/table-removal.test.ts`), both
  packages' typecheck and lint, `prettier --check`, `pnpm exec vitest run scripts/module-seams.test.ts scripts/english-only.test.ts`.
  Expected: everything passes, with only the deletion and the `{ today: false }` setups above; any
  other assertion that changes is a STOP.
- [ ] **Step 5: Commit** — e.g. "Tables: one test for whether a table is in service — on today's
  plan, in a switched-on zone (A429 slice 5)".

### Task 5.2g: "In service" replaces `active` in apps/server

**Files:**
- Modify: `apps/server/src/working-order.ts` (`openTab` `:1246-1258`; the floor read's `where`
  `:7176`; `TableState.today` `:7041` becomes `TableToday` and its mapping uses the map's row,
  decision 8), `apps/server/src/move-bill.ts` (`readTargetTable` `:217-228`),
  `apps/server/src/report-api.ts` (`countOpenTables` `:159-175`), `apps/server/src/tables.ts`
  (`listTables` `:111-137`; `setTableStatus` `:574-592`), `apps/server/src/floor-today-store.ts`
  (`venueTables` drops `active` `:245-252`; the hide test `:301-306` keeps `withToday` and `merged`
  only; the apply stops setting `active` `:346`; `hideTable` `:384-389` stops setting it),
  `apps/server/src/testing/live-table.ts` (`switchOff` deletes the today's row)
- Test: `apps/server/src/tabs.test.ts`, the floor read's suite
  (`apps/server/src/working-order-reads.sqlite.test.ts`, or the file that holds the floor read's
  cases), `apps/server/src/report-api.overview.test.ts`, `apps/server/src/set-table-status.test.ts`,
  `apps/server/src/party-move-bill.test.ts`, `apps/server/src/floor-today-store.test.ts`,
  `apps/server/src/table-removal.test.ts`

Behaviour (decisions 2, 3, 8): every reader in the "Who reads `active`" list under apps/server reads
`tableInService` instead: `openTab` and `readTargetTable` refuse `table.inactive`; `setTableStatus`
answers `table.not_found`, as for an inactive table now; the floor read and `listTables` (unless
`includeDisabled`) answer only tables in service; `countOpenTables` counts them. The reset hides a
table by deleting its today's row alone, and a table with no today's row that is in no merge counts
as already hidden. Queries on one transaction are awaited in turn.

Existing tests that change (the Behaviour list): the `active` keys beside a today's-row assertion in
`floor-today-store.test.ts:308`, `:315`, `:341`, `:394` (and that case's setup, `:384-395`, which
deletes the today's row instead of setting `active` false), `:705`; `table-removal.test.ts:296`,
`:339`, `:398`; `floor-today-store.test.ts:720-737` (decision 14, the `active` key goes); and
`management-api.test.ts:1092-1100`, whose `active: false` key goes when `switchOff` stops writing
`active` (the table still appears with `includeDisabled` and not in the plain list).
Setup only, assertions unchanged: `tabs.test.ts:290-305` (a table taken out of service by deleting
its today's row instead of `active = false` at `:299`), `set-table-status.test.ts:147` (likewise),
`report-api.overview.test.ts:111-115` (the "inactive" table gets no today's row).

- [ ] **Step 1: Write the failing tests:**

```ts
// apps/server/src/tabs.test.ts
it("refuses opening a tab at a table with no today's row, table.inactive, while `active` is still true", async () => {});
it("refuses opening a tab at a table whose zone is switched off, table.inactive, with its today's row kept", async () => { /* update floor_zones.active = false directly */ });
// the floor read's suite
it("answers no table that has no today's row, nor a switched-off zone's tables", async () => {});
// party-move-bill.test.ts
it("refuses moving guests to a table with no today's row, table.inactive", async () => {});
// set-table-status.test.ts
it("answers table.not_found for a table with no today's row", async () => {});
// report-api.overview.test.ts
it("counts only tables on today's plan", async () => {});
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/server exec vitest run src/tabs.test.ts src/party-move-bill.test.ts src/set-table-status.test.ts src/report-api.overview.test.ts <the floor read's file>`.
  Expected: each new case fails because `active` is still true.
- [ ] **Step 3: Implement**, then the changed-test commit.
- [ ] **Step 4: Run** the files named above plus `src/floor-catch-up.test.ts src/floor-today-api.test.ts src/till-api.tables.test.ts`
  and then the whole server package once, to find a setup Task 5.2f missed:
  `pnpm --filter @waitron/server test:coverage` (check free memory first, `memory_pressure | grep free`;
  a missing today's row is fixed as a fixture; a case whose ASSERTION would have to change is a
  STOP). The server's typecheck and lint, `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Tables: in service means on today's plan in a switched-on zone,
  not a switch on the table (A429 slice 5)".

### Task 5.2h: Venue-service, bookings and department transfers read "in service"; zone switch-off leaves tables alone

**Files:**
- Modify: `packages/venue-service/src/operations.ts` (`departmentRemovalImpact` `:272-281`,
  `zoneRemovalImpact` `:298-301`, `deactivateServiceZone` `:368` goes),
  `packages/venue-service/src/department-transfers.ts:406-419`, `packages/bookings/src/bookings.ts:48-66`,
  `packages/bookings/src/testing/fake-core.ts:32-40`, `apps/server/src/tables.ts` (`updateZone`
  `:324-388` loses `reopening`; `reopenTodaysTables` `:390-411` goes)
- Modify also: `packages/bookings/src/dashboard/live-queries.ts:1`, `apps/dashboard/src/api/live-queries.ts:124-134`
- Test: `packages/venue-service/src/operations.test.ts`, `routes.test.ts`,
  `department-transfers.test.ts`, `packages/bookings/src/bookings.test.ts`,
  `packages/bookings/src/dashboard/bookings-screen.test.ts`,
  `apps/dashboard/src/screens/dashboard-overview-screen.test.ts`, `routes.test.ts`,
  `bookings-cas.test.ts`, `floor.test.ts`, `table-removal.test.ts`, `apps/server/src/tables.test.ts`,
  `apps/server/src/management-api.test.ts`, `apps/server/src/floor-today-store.test.ts`,
  `apps/server/src/floor-today-api.test.ts`

Behaviour (decisions 3, 4): the department and zone removal counts (`activeTableCount`, its wire name
unchanged) count tables in service; a transfer to a table not in service is refused
`department_transfer.destination_invalid { field: "tableId" }` as now; a booking at a table not in
service is refused `table.not_found` as now; switching a zone off writes nothing to its tables, and
switching it back on brings them back as today's plan has them.

Existing tests that change (the Behaviour list): `operations.test.ts` the table halves of
`:1622-1673` (`:1661-1666`), `:1675` onwards (`:1733-1738`) and `:2116-2165` (`:2146-2152`);
`apps/server/src/tables.test.ts:549-572`; `management-api.test.ts:1350-1366`;
`floor-today-store.test.ts:754-797`; `floor-today-api.test.ts:219-231`. Setup only: the inserts
with `active: false` in `packages/venue-service/src/routes.test.ts:1040`, `:1065` and
`department-transfers.test.ts:1103-1108` (that table gets no today's row; the others get one), and
the bookings inserts that set `active` — through drizzle in `routes.test.ts:96-97` and
`bookings-cas.test.ts:43-44`, and in raw SQL, which the typecheck cannot see, in
`floor.test.ts:43-44`, `table-removal.test.ts:39-40` and `bookings.test.ts:63-64` (whose
`${active ? 1 : 0}` makes an out-of-service table on request: that one gets no today's row, the
rest get one). Each loses its `active` column or key here. A grep of `apps/`, `packages/`,
`scripts/` and `bench/` for SQL templates naming `dining_tables` beside a dropped column found no
other raw insert; the raw reads and updates it found are in files earlier tasks change
(`seed-floor.test.ts:166`, Task 5.2a; `management-api.test.ts:1735`, `tables.location-scope.test.ts:99`,
`:110`, `:115`, `till-api.test.ts:3786`, `:3825`, Task 5.2c; `till-api.tables.test.ts:240`,
Task 5.2c; `tabs.test.ts:299`, `set-table-status.test.ts:147`, Task 5.2g).
`apps/server/src/management-api.test.ts:1287-1327` and `:1328-1348` read `active` back through
`listAll` and break here, because switching a zone off no longer writes it: each instead asserts the
table is in the plain `GET /management-api/tables` list exactly when its zone stays switched on
(`:1287`'s "active" arm and `:1328`) and absent from it otherwise; `:1350-1366`'s last line likewise
asserts the table is back in the plain list once its zone is switched on again, and the case is
renamed, since its name ("…without enabling its tables") contradicts that.

Live updates (decision 23): add `"floor_today_tables"` and `"floor_zones"` to bookings' `tables`
dependencies (`packages/bookings/src/dashboard/live-queries.ts:1`) and to `getSalesOverview`'s
(`apps/dashboard/src/api/live-queries.ts:124-134`).

- [ ] **Step 1: Write the failing tests:**

```ts
// packages/venue-service/src/operations.test.ts
it("counts a zone's tables on today's plan, not a table with no today's row", async () => {});
it("leaves a switched-off zone's tables on today's plan, so they come back with the zone", async () => { /* deactivateServiceZone, then floor_zones.active = true: tableInService true, today's rows kept */ });
// packages/venue-service/src/department-transfers.test.ts
it("refuses a destination table with no today's row", async () => {});
// packages/bookings/src/bookings.test.ts
it("refuses booking a table with no today's row, table.not_found", async () => {});
// packages/bookings/src/dashboard/bookings-screen.test.ts
it("reads the tables again when today's plan changes", async () => { /* a floor_today_tables change on the live data source → listTables called again */ });
// apps/dashboard/src/screens/dashboard-overview-screen.test.ts
it("reads the overview again when today's plan or a zone changes", async () => { /* a floor_today_tables change, then a floor_zones change → getSalesOverview called again each time */ });
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/venue-service exec vitest run src/operations.test.ts src/department-transfers.test.ts`,
  `pnpm --filter @waitron/bookings exec vitest run src/bookings.test.ts src/dashboard/bookings-screen.test.ts`
  and `pnpm --filter @waitron/dashboard exec vitest run src/screens/dashboard-overview-screen.test.ts`.
  The two refresh cases change the data source as their files already do (`liveData.invalidate`,
  `packages/bookings/src/dashboard/bookings-screen.test.ts:491-499`,
  `apps/dashboard/src/screens/dashboard-overview-screen.test.ts:417-426`) and fail because neither
  query lists those tables yet.
- [ ] **Step 3: Implement**, then the fixture commit and the changed-test commit.
- [ ] **Step 4: Run** every test file named under Files, `pnpm --filter @waitron/venue-service test:coverage`
  and `pnpm --filter @waitron/bookings test:coverage` (browser packages: check free memory first),
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/dashboard-overview-screen.test.ts src/api/live-queries.test.ts`,
  the four packages' typecheck and lint, `prettier --check`,
  `pnpm exec vitest run scripts/module-seams.test.ts scripts/live-subscriptions.test.ts`.
- [ ] **Step 5: Commit** — e.g. "Zones: switching a zone off no longer switches its tables off;
  counts, bookings and transfers read today's plan (A429 slice 5)".

### Task 5.2i: The floor tests build their zones without adoption

Split from Task 5.2j, which was likely to pass 100 tool calls as one task. Saving new master tables
already works, so this task changes only test setup, and every suite stays green.

**Files:**
- Modify: `apps/server/src/testing/floor-today-venue.ts` (`plannedZone` `:44-96` saves new master
  tables and reads each live table back from `readZonePlan`'s `liveTableId`, instead of making live
  tables and adopting them at `:64`), and the other helpers and setups that adopt: `masterOf` in
  `apps/server/src/floor-today-store.test.ts`, and the first-save setups in `floor-plan.test.ts`,
  `floor-catch-up.test.ts`, `floor-today-state.test.ts`, `boot.test.ts`, `management-api.test.ts`,
  `floor-today-api.test.ts:200` and `floor-today-changes.test.ts:264`
  (`grep -rln liveTableId apps/server/src`), except the cases Task 5.2j deletes because adoption is
  what they test

Behaviour: none in the product. A helper that took a live table's id now gets it back from the
first save, which creates it.

- [ ] **Step 1:** Rewrite the helpers and setups.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/floor src/table-removal.test.ts src/management-api.test.ts src/boot.test.ts`.
  Expected: everything passes with no assertion changed; one that would have to change is a STOP.
  The server's typecheck and lint, `prettier --check`.
- [ ] **Step 3: Commit** — e.g. "Floor tests: zones are built from saved plans, not adopted tables
  (A429 slice 5)".

### Task 5.2j: `planned` and adoption go

**Files:**
- Modify: `apps/server/src/floor-reset-plan.ts` (`targetsFromMaster` `:127-175`: `live` loses
  `planned`; every live table of the zone is a target), `apps/server/src/floor-today-store.ts`
  (`zoneTables` `:193-202`; the create `:326-336` stops writing `planned`),
  `apps/server/src/floor-plan.ts` (`PlanTable.id` `string` `:22-30`; `ZonePlanSave` loses
  `liveTableId` `:45-60`; `adoptableOf` `:95-110` and its loop in `readZonePlan` `:156-165` go;
  `checkEntries` `:203`; `namesTaken` `:243-268` loses `adopted` and counts no table of this
  zone; `checkSave` `:317-345`; the adoption writes `:452-459` go),
  `apps/server/src/management-api.ts:445-448` (the parser stops reading `liveTableId`); the test
  helpers were moved off adoption in Task 5.2i
- Test: `apps/server/src/floor-reset-plan.test.ts`, `floor-plan.test.ts`, `floor-today-store.test.ts`,
  `table-removal.test.ts`, `management-api.test.ts`, `packages/db/src/schema/floor-plans.test.ts`

Marked large: if it passes about 100 tool calls, stop at a green point after the server code and
`floor-plan.test.ts`, commit, and hand over.

Behaviour (decision 6): a zone with no master plan reads an empty draft; a save names a table by its
master `id` or as new; a reset removes a live table of the zone that follows no master table, as it
removes one whose master table was deleted (tied ones wait); a save's names are refused when another
zone's master table or another zone's live table holds them, as now.

Existing tests that change (the Behaviour list): `floor-plan.test.ts:218-281`, `:306-325`,
`:339-350`, `:425-453`, the `liveTableId` arm of `:495-510`, `:587-619`, `:652-668`, `:870-889`
(its `planned` and `active` keys), the `planned` keys of `:1119-1135` and `:1136-1154`, `:1155-1185`'s
setup; `floor-reset-plan.test.ts:210-225`; `floor-today-store.test.ts:495-510`;
`table-removal.test.ts:96-99` (setup); `packages/db/src/schema/floor-plans.test.ts` the `planned`
keys at `:368`, `:419`, `:427`; `management-api.test.ts:3782-3817` (still checks that a plan read is
accepted back unchanged, each master entry keeping its own `liveTableId`, without the adopted spare
it made with `POST /tables` at `:3788-3792` and its `[true, true]` row), `:3819-3838` (deleted: a
save no longer reads `liveTableId`; Step 1's route case below replaces it), and the
`tables.0.liveTableId` row `:3863-3866` of the body checks `:3853-3881` (deleted).

- [ ] **Step 1: Write the failing tests:**

```ts
// floor-reset-plan.test.ts
it("makes every live table of the zone a target: one that follows no master table goes", () => {
  /* live c { planTableId: null } (no `planned`) → ["c", "Old 3", true] among the targets */
});
// floor-plan.test.ts
it("reads a zone with live tables and no master plan as an empty draft", async () => {});
it("does not read a save entry's liveTableId", async () => { /* an entry naming another zone's live table by liveTableId and no id → accepted as a new table */ });
// management-api.test.ts — the route's parser (management-api.ts:445-448)
it("accepts a save whose master entry carries another table's liveTableId, and ignores it", async () => {
  /* as :3819-3838's setup; today the route answers 400 floor_plan.invalid { field: "tables.0.id" } */
});
// floor-today-store.test.ts
it("removes a free live table of a planned zone that follows no master table, at the next reset", async () => {});
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/server exec vitest run src/floor-reset-plan.test.ts src/floor-plan.test.ts src/floor-today-store.test.ts src/management-api.test.ts`.
- [ ] **Step 3: Implement** (the helpers already build their zones without adoption, Task 5.2i),
  then the changed-test commit. `planned` stays in the schema until
  Task 5.3; nothing reads or writes it after this task (`grep -rn "planned" apps/server/src packages/db/src`
  finds only the schema and its tests).
- [ ] **Step 4: Run** every floor file: `pnpm --filter @waitron/server exec vitest run src/floor src/table-removal.test.ts src/management-api.test.ts src/boot.test.ts`,
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed-floor.test.ts`,
  `pnpm --filter @waitron/db exec vitest run src/schema/floor-plans.test.ts`, the server's typecheck
  and lint, `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Floor plans: every live table follows its zone's saved plan; the
  editor no longer adopts tables (A429 slice 5)".

### Task 5.2k: The answers lose the old columns

**Files:**
- Modify: `apps/server/src/working-order.ts` (`TableState` `:7011`, `:7035-7039`; the floor read's
  row type `:7070`, `:7083-7086`, select `:7097-7098`, mapping `:7205`, `:7221-7224`; the
  `FloorTableShape` import `:157`), `apps/server/src/tables.ts` (`FloorTableShape` `:23`;
  `DiningTable` `:63-75` loses `capacity`, `active`, `posX`, `posY`, `shape`, `rotation`, gains
  `planTableId: string | null`; `listTables`' select `:121-127`), `apps/dashboard/src/api/client.ts`
  (`TableShape` `:588`, `DashboardTable` `:599-610`, its `zoneId` becomes `string`),
  `apps/dashboard/src/screens/floor-plan-editor.ts` (`#takenElsewhere` `:837-849`, decision 7),
  `packages/bookings/src/dashboard/client.ts:46-53`
- Test: `apps/server/src/till-api.tables.test.ts`, the floor read's suites,
  `apps/dashboard/src/screens/floor-plan-editor.test.ts`, `apps/dashboard/src/api/client.test.ts`,
  `packages/bookings/src/dashboard/*.test.ts`

Behaviour: `GET /api/tables/state`, `GET /api/tables` and `GET /management-api/tables` no longer
carry `capacity`, `active` or the placement columns; the table list carries `planTableId`. The
editor's automatic names skip this zone's tables whose `planTableId` is null and that no draft table
follows, and every other zone's tables.

Existing tests that change: `till-api.tables.test.ts:264-272` (`active: true` leaves the matcher);
`apps/server/src/tables.test.ts:110-130` (`capacity`, `active`, `posX`, `posY`, `shape` and
`rotation` leave the matcher and `planTableId: null` joins it; its `capacity: 4` argument to
`createTable` stays until Task 5.3 drops the column); `management-api.test.ts:1654` (its
`toMatchObject({ active: true })` is deleted, `active` having left the answer; the case's `PATCH` row
went in Task 5.2c, so nothing is left for that line to guard);
any `/api/tables/state` or table-list case pinning a whole row with `toEqual` (grep the server
suites for `"/api/tables/state"`, `listTablesWithState(` and `"/management-api/tables"`; a key
removed from such a pin is listed in the changed-test commit). Fixture only:
`floor-plan-editor.test.ts:657-694` (`venueTable` takes a `planTableId` instead of `active`; the
two cases' assertions stay); the bookings fixtures `dashboard/bookings-screen.test.ts:13-14`,
`booking-form.test.ts:11-12`, `booking-form.unsaved.test.ts:72-73`, `client.test.ts:162-163`.

- [ ] **Step 1: Write the failing tests:**

```ts
// apps/server/src/till-api.tables.test.ts
it("answers a table's state without the old columns, and the table list with planTableId", async () => {
  /* GET /api/tables/state row: no capacity, posX, posY, shape, rotation keys; today non-null.
     GET /management-api/tables row (manager): no capacity, active, posX…; planTableId present */
});
```

- [ ] **Step 2: Run and watch it fail** —
  `pnpm --filter @waitron/server exec vitest run src/till-api.tables.test.ts -t "without the old columns"`.
- [ ] **Step 3: Implement**, then the fixture commit and the changed-test commit.
- [ ] **Step 4: Run** the server's floor and table suites (`src/till-api.tables.test.ts src/till-api.test.ts src/floor-today-state.test.ts src/working-order-reads.sqlite.test.ts src/management-api.test.ts`),
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-editor.test.ts src/screens/floor-plan-editor.refusals.test.ts src/api/client.test.ts`,
  `pnpm --filter @waitron/bookings exec vitest run src/dashboard`, the three packages' typecheck and
  lint, `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Tables: the answers stop carrying seats, placement and the on/off
  switch the floor plan replaced (A429 slice 5)".

### Task 5.2l: The editor without adoption

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`PlanTable.id` `string`, the save entry loses
  `liveTableId`, `:620-640`), `apps/dashboard/src/screens/floor-plan-draft.ts` (`keyOf` `:53-54`,
  the send `:62`, `:78-79`, the rebinding `:111-117`, the adoption test `:176`),
  `apps/dashboard/src/screens/floor-plan-table-panel.ts` (Delete for every table),
  `apps/dashboard/src/screens/floor-plan-editor.ts` (any `id === null` branch)
- Test: `apps/dashboard/src/screens/floor-plan-draft.test.ts`, `floor-plan-table-panel.test.ts`, and
  the editor files whose fixtures hold an `id: null` entry (`grep -rn "id: null" apps/dashboard/src/screens/floor-plan*`)

Behaviour (decision 6): every table in a draft is a master table or a new one; every table's panel
offers Delete; a save sends `id` for a master table and no `liveTableId`.

Existing tests that change: `floor-plan-draft.test.ts:51-73`, `:345-352`;
`floor-plan-table-panel.test.ts:278-287`.

- [ ] **Step 1: Write the failing test** in `floor-plan-table-panel.test.ts`:

```ts
it("offers Delete for every table, one read with a live table and no master id included", async () => {
  /* a draft table { id: null, liveTableId: "l1" } selected → the panel shows Delete; today
     `isAdoptable` (floor-plan-draft.ts:175-177) hides it (floor-plan-table-panel.ts:334) */
});
```

  A case that the save sends a master table by its `id` alone is not a failing test: `saveFromDraft`
  already does (`floor-plan-draft.ts:72-81`); it only loses its adoption arm.
- [ ] **Step 2: Run and watch it fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-table-panel.test.ts -t "offers Delete for every table"`.
- [ ] **Step 3: Implement**, then the changed-test commit.
- [ ] **Step 4: Run** every editor file: `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan`,
  the dashboard's typecheck and lint, `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: every table is the plan's own; no tables to
  adopt (A429 slice 5)".

### Task 5.2m: The till's tables lose the old columns

**Files:**
- Modify: `apps/till/src/api/client.ts` (`TableState` `:1879`, `:1905-1912`; `today` stays nullable,
  decision 8), `apps/till/src/state/floor-map.ts` (`seatsFor` `:198-202`: no `capacity` fallback),
  and the `TableState` fixtures of 42 till test files (the list is the `posX` fixture count above:
  `grep -rln "posX:" apps/till/src --include='*.test.ts'`)
- Test: those files

Behaviour: the till reads a table's seats only from today's row (or its merge's); a table with no
today's row shows no seats.

Existing test that changes: `apps/till/src/state/floor-map.test.ts:306`
(`seatsFor(table({ capacity: 4 }))` is 4) — the fallback this task removes — expects `null`, and the
case's name (`:303`) loses "and the old capacity without a plan". Beyond that, fixtures only; a
fixture that set `capacity` to show a seat count on a table with no today's row elsewhere is a STOP.

- [ ] **Step 1: The failing test** is that change: in the changed-test commit, `:306` expects `null`.
- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/till exec vitest run src/state/floor-map.test.ts`.
  Expected: 4, not `null`.
- [ ] **Step 3: Implement**: change the type and `seatsFor`, then let the typecheck list each
  fixture's excess keys (`pnpm --filter @waitron/till typecheck`) and remove exactly those lines with
  a script that reads that output (a `shape` or `rotation` inside a `placement` object is today's and
  stays).
- [ ] **Step 4: Run** the whole till package once, `pnpm --filter @waitron/till test:coverage`
  (browser: check free memory first), the till's typecheck and lint, `prettier --check`.
- [ ] **Step 5: Commit** — e.g. "Till: tables carry only today's seats and place (A429 slice 5)".

### Task 5.3: The migration

**Files:**
- Modify: `packages/db/src/schema/dining-tables.ts` (drop `capacity` `:41`, `active` `:42`, `posX`,
  `posY`, `shape`, `rotation` `:45-48`, `planned` `:53`, the check `:73`, `floorTableShape` `:25`;
  `zoneId` `.notNull()` `:39`; prune the imports), `packages/db/src/index.ts:84` (`floorTableShape`
  leaves the export), `scripts/migration-upgrade.test.ts` (`RESETS`, `:256-363`),
  `packages/db/src/schema/dining-tables.test.ts`, `docs/developers/conventions-data.md` (the list of
  hand-written custom migrations, `:1887-1968`), and the `active:`, `capacity:` and `planned:` keys
  still on test inserts into `dining_tables`, which the typecheck lists once the schema changes. The
  ones a grep found are `active: true`, the old default, and the key simply goes:
  `till-sale.test.ts:1837`, `:1893`, `:1922`, `:2327`, `vat-class-at-line-add.test.ts:289`,
  `vat-rate-at-issue.test.ts:241`, `issuance-pass.test.ts:299`; `working-order-reads.sqlite.test.ts:94`
  sets `capacity`, which goes too. An `active: false` still present at this point is a setup Tasks
  5.2g and 5.2h missed, and is a STOP. Also: the test helper `createTable`'s `capacity` parameter
  goes (`apps/server/src/testing/live-table.ts`, with its callers, `grep -rn "createTable(" apps/server | grep capacity`,
  and the `capacity: 4` argument at `apps/server/src/tables.test.ts:110-130`, whose matcher key went
  in Task 5.2k)
- Modify also, for decision 24: the null-zone branches the schema change makes unreachable —
  `apps/server/src/floor-today-merges.ts:210-213`; `apps/server/src/working-order.ts:1138`, `:1264`,
  `:1282`; `apps/server/src/move-bill.ts:239`; `apps/server/src/table-actions.ts:81`, `:101`,
  `:123` (their table halves) — found by grep, and any other the per-file coverage table shows
  newly uncovered (the typecheck does not find them, decision 24)
- Generated: three core migrations under `packages/db/drizzle/` with their snapshots and journal
  entries (drizzle-kit picks the numbers; the highest at `5afb32342` is `0136`)

Behaviour (decision 16): the venue's `dining_tables` has `id`, `location_id`, `label`, `zone_id`
(required), `created_at`, `status_id`, `needs_clearing_since` and `plan_table_id`;
`parties_clear_table_status` is unchanged; every venue already migrated must be reset.

Existing test that changes: `dining-tables.test.ts:49-59` (the placement columns; deleted).

- [ ] **Step 1: Write the failing tests** in `packages/db/src/schema/dining-tables.test.ts`:

```ts
it("refuses a dining table with no zone", async () => {
  /* insert { locationId, label } with no zoneId, caught OUTSIDE the transaction (CLAUDE.md §4) →
     a NOT NULL refusal naming dining_tables.zone_id */
});
it("has only the columns today's plan needs", async () => {
  /* pragma_table_info('dining_tables') names → ["created_at", "id", "label", "location_id",
     "needs_clearing_since", "plan_table_id", "status_id", "zone_id"] (sorted) */
});
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/db exec vitest run src/schema/dining-tables.test.ts`. Expected: the insert
  is accepted, and the column list has seven more.
- [ ] **Step 3: Generate, in this order.**
  1. `pnpm --filter @waitron/db db:generate:custom --name floor_retire_drop_table_triggers`; write
     `DROP TRIGGER parties_clear_table_status;` under a header in the shape of `0043`'s (what the next
     migration rebuilds, and that the trigger comes back after it). No trailing
     `--> statement-breakpoint` (conventions-data.md, "A migration file's last statement…").
  2. Change the schema as under Files. `pnpm --filter @waitron/db db:generate --name floor_retire_old_table_columns`.
     Read the SQL: it must be the rebuild measured above and nothing else —
     `grep -o '__new_[a-z_]*' <file> | sort -u` prints only `__new_dining_tables`, the
     `INSERT … SELECT` names only the eight kept columns, and there is no
     `ALTER TABLE … ADD` and no index other than `dining_tables_location_label_key`. Anything else is
     a STOP.
  3. `pnpm --filter @waitron/db db:generate:custom --name floor_retire_recreate_table_triggers`; paste
     `CREATE TRIGGER parties_clear_table_status …` exactly as `0045_recreate_triggers_after_rebuild.sql:4-13`
     has it, under a header naming the drop migration.
  4. Check each custom file's snapshot equals the one before it once `id` and `prevId` are removed and
     keys sorted, as conventions-data.md records for the others, and add both files to that list.
- [ ] **Step 4: The upgrade guard.** Run `pnpm exec vitest run scripts/migration-upgrade.test.ts`: it
  fails at the rebuild step. Add a `RESETS` entry keyed `core/<the rebuild's tag>` with the refusal
  the walk prints (expected `refused: ["NOT NULL constraint failed: __new_dining_tables.zone_id"]`,
  decision 16), and a one-line comment as its neighbours have ("Rebuilds `dining_tables` with
  `zone_id` required; a carried row's zone is null"). Run it again.
- [ ] **Step 4b: The null-zone branches** (decision 24). Delete them, then run
  `pnpm --filter @waitron/server test:coverage` (check free memory first) and read the per-file
  table: branch coverage is at or above its floor of 95, and no line decision 24 names is left.
- [ ] **Step 5: Run the guards** —
  `pnpm --filter @waitron/db exec vitest run src/schema/dining-tables.test.ts src/schema/floor-plans.test.ts src/classification.test.ts`,
  then from the root
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/column-vocabulary.test.ts scripts/module-graph-honesty.test.ts scripts/apply-migrations-callers.test.ts`,
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`, and the typecheck of every
  package that imports `diningTables` (`pnpm -r typecheck` is the simplest; the hook does the same
  for a schema change), then the suites whose tests insert tables in raw SQL, which the typecheck
  cannot see: `pnpm --filter @waitron/bookings test:coverage` and
  `pnpm --filter @waitron/venue-service test:coverage` (browser packages: check free memory first).
  Read each `Tests` count. Then, as a control, replace the drop migration's
  statement with `SELECT 1;` and watch `scripts/migration-upgrade.test.ts` fail with `error in trigger
  parties_clear_table_status: no such table: main.dining_tables` (the walk rebuilds an empty database
  at a `RESETS` step, and the measurement above says that fails the same way); restore.
- [ ] **Step 6: Commit** — e.g. "Tables: the old seat, switch and placement columns are dropped and
  every table is in a zone (A429 slice 5)". The body names the three files, lists the six foreign
  keys into `dining_tables` and the trigger with what the rebuild does to each (the tables above),
  quotes the generated SQL's statement list, and says every venue must be reset. Then the
  changed-test commit for `dining-tables.test.ts:49-59`.

### Task 5.4: Docs and backlog

**Files:**
- Modify: `docs/developers/design-system.md` (`:1978`: the floor plan's table rows and Add table
  leave the list of forms; `:2655-2659`: the `itemsAmongModules` sentence goes, decision 1; `:3557`:
  "a table" leaves the things switched off with Disable; `:3684`: the example path becomes
  `/manage/floor-plan/zone/<id>`; `:625-640`: every zone's map is today's plan, the tray's token
  shows seats); `docs/developers/conventions-data.md` (a new section, "A zone's floor plan: the
  master plan and today's plan", after "Multi-table writes share ONE transaction": the two plans;
  the reset at the first floor read or write of a business day and on Reset to saved plan; the
  catch-up when a tab closes; each reset copying the master's joins into `floor_reset_joins` and
  `floor_reset_join_tables`; names copied as text when a party closes and when a table is removed;
  removal through the module seat; a live table created only by a reset; "in service" is
  `tableInService`, never a column on the table; the six foreign keys into `dining_tables` and why
  none may cascade, with this slice's measurement as the receipt); `docs/developers/testing-guide.md:1120-1127`
  (a dated pointer: the file named there was removed with the old floor screen, A429 slice 5);
  `docs/backlog.md` and `docs/backlog/till.md`; `CLAUDE.md` only if a rule was paid for during the slice
- Test: `pnpm exec vitest run scripts/claude-md-pointers.test.ts`; `pnpm exec prettier --file-info`
  on each changed doc (docs/ is ignored by prettier, so `--check` proves nothing there)

Backlog (`docs/backlog.md` → _How to keep this file honest_): A429 is finished, so its entry and its
detail in `docs/backlog/till.md` are deleted; each point it leaves open becomes its own short entry
in the same area: the owner question (decision 1) if unanswered; the till's `TableState.today` type
to tighten (decision 8); the till's `GET /api/tables`, which nothing in the till calls (decision 15).
Also: "Enabling a zone or a department leaves what disabling switched off as it is" loses its
tables clause (decision 4); "Should switching a planned zone back on rebuild today's plan from the
master?" says tables now come back with their zone, not through `updateZone`; "A four-digit total
does not fit a small round table on the till's floor map" is rewritten for the tray's token
(`wt-floor-canvas` and `sizeForCapacity` are gone) or deleted if the look pass shows it fixed;
"Later: change the working floor layout during service" is deleted (A429 covered it); "A table in
no zone still opens a tab, and nothing can be added to it" (`docs/backlog.md:2684-2688`) is deleted,
answered by decision 24; "A table with no shape is drawn as a rectangle and saved as round on its
first edit" (`docs/backlog.md:1722-1727`, and its detail in `docs/backlog/till.md`) is deleted, since
`wt-floor-canvas` is gone; the note that a token for four seats or fewer is too narrow
(`docs/backlog.md:2322-2327`, naming `sizeForCapacity` and `wt-floor-canvas`) is rewritten for the
tray's token or deleted if the look pass shows it fixed; "Refresh the
floor without a staff action, for a zone with no floor plan or a planned zone's list view" loses
"a zone with no floor plan". A decision a comment or doc cites moves to its area's
`## Decisions and deliberate limits` rather than being deleted.

- [ ] **Step 1:** Write the docs and backlog changes; every claim in them about the code names its
  `file:line` or is marked as read, not run (CLAUDE.md §1).
- [ ] **Step 2:** Run `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] **Step 3: Commit** — e.g. "Docs: the floor plan's two plans, the reset and in-service tables;
  the backlog's A429 entry is done (A429 slice 5)".

### Task 5.5: Look

**Files:** none committed. Throwaway files `apps/dashboard/src/dashboard-app.look.test.ts`,
`apps/dashboard/src/screens/floor-plan-editor.look.test.ts`,
`apps/dashboard/src/screens/canvas-editor-screen.look.test.ts` and
`apps/till/src/screens/till-floor-screen.look.test.ts` are written, run and deleted. Screenshots go to
`/Users/clintongormley/waitron-campaign/a429-5-shots/`, by that literal absolute path, or, if Vitest
refuses a path outside the package, through the package's git-ignored `__screenshots__` folder and
`cp`, then removed from the package (as Tasks 2.8, 3.6 and 4.6).

States, each in English and Spanish, light and dark, at 390 × 844 and 1280 × 800, named
`<state>-<lang>-<theme>-<width>.png`: the dashboard's nav with the Operations group open (no Floor
plan) and a nav search for "floor"; the canvas editor's add-card list (no table layout editor);
the floor plan editor with Add tables open on a zone where a table waits for its removal (the
suggested name skips its name); the till's floor screen on a zone's map with the Unplaced tray
showing a seated spare's token with its seats; the zone tabs of a till with two zones (no No zone);
the list view; and the till's floor tab in its card grid (no locked cell).

- [ ] **Step 1:** Write the throwaway files and run them. Expected: `ls
  /Users/clintongormley/waitron-campaign/a429-5-shots/ | wc -l` equals the count taken.
- [ ] **Step 2:** Open each screenshot and look: a gap left where a removed item or button was; the
  Operations group's order; the tray token's seat words crowding its label, or Spanish longer than
  the token; anything the old pieces drew that is now missing and still needed; product text that
  could be shorter (owner rule).
- [ ] **Step 3:** Fix what the look found, each fix test-first in the task file it belongs to, and
  rerun that file.
- [ ] **Step 4:** Delete the throwaway files and any screenshots left in the packages (`git status`
  shows none), then run every slice 5 test file named above, the guards named above, and the touched
  packages' typecheck and lint.
- [ ] **Step 5: Commit** the fixes, if any — e.g. "Floor: fixes from looking at the slice without
  the old pieces, in both languages, both themes, on a phone and a till (A429 slice 5)", the message
  listing what was looked at and where the screenshots are.

**Slice 5 done when:** the focused tests above pass; `/finish-branch` runs the full wave (a
migration and a cross-package contract change are risk triggers, so the run-it seat runs twice);
CI is green on the head; the PR's first line is **"venue reset needed"** and its description lists
the foreign keys and the trigger the rebuild meets, the owner question (decision 1) with its
default, the decisions that depart from the task list (6, 7, 9 and 22) or remove a capability
beyond spec §11 (5: no table created or renamed outside the editor; 12: the card permission lock),
and that the owner's Santet import breaks until it saves master plans (decision 20; the owner gets
an FYI); the backlog no longer
holds A429; and `wa-wt reset demo <name>` has been run on the slice's dev venue after a check that
nothing else holds it (a dev server another lane started is not listed by `wa-wt ls`: run `lsof`
on the venue folder and on port 8080 first).
