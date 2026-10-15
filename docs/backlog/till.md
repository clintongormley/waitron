# The till, devices and table service — detail

The open entries are listed in [the backlog](../backlog.md), under "The till, devices and table service". This file holds
their full text.

## Split-off checks may reach the same path as a held-order edit that changes sent lines

- Found by #623 (`apps/server` part b: working-order, tabs, tables), not fixable in a
  comments-only change. Split-off checks may reach the same path as a held-order edit that
  changes sent lines (read, not run). The walk-up concurrent double-pay case in
  `working-order.pay-and-dispatch.test.ts` replays through the settled branch and never reaches
  `payWorkingOrder`'s duplicate-key catch; nothing tests two `openTab` calls racing on one table
  or concurrent rounds landing on consecutive line numbers (the sequential versions are in
  `tabs.test.ts`); nothing checks that a location or status foreign-key refusal in `tables.ts` is
  not reported as a zone fault; `setTablePlacement`'s raw read is typed `boolean | null` where the
  engine returns 1/0/null (it only tests truthiness). The SQL `--` comments inside
  `listTablesWithState`'s template text still carry "measured 2026-09-22", PostgreSQL's "LATERAL
  form" and aggregate-pair history and a "KDS-1 §3d" pointer. "A line with no course fires
  earliest", which #623 cut from `working-order.ts` because a line sent with `hold: true` is held
  whatever its course, is still in `apps/server/src/kitchen.ts:264` and four
  `packages/db/src/schema` files (`catalogue.ts`, `kitchen-courses.ts`, `ticket-items.ts`,
  `orders.ts`). Stale test titles: "lists the node's open orders" in `working-order.test.ts`;
  "(Task B1, …)" in `working-order.pay-and-dispatch.test.ts`; "an UNLOCKED read" in
  `tabs.test.ts`; "recordSale UNCHANGED" in `tabs.filing.test.ts`; many "(KDS-…)" and
  "(A1)"-style plan tags.

## "resets any leftover drill/active tab on login" still passes with login's own clearing line deleted

- Found by #621 (the rest of `apps/till`), not fixable in a comments-only change.
  The review reported that "resets any
  leftover drill/active tab on login" still passes with login's own clearing line deleted, because
  logout clears the same state first (run in review, not re-run here). A question the prune moved
  here from a deleted `menu-filter.ts` comment: should the `no-meat`/`no-fish` lenses also hide a
  dish whose diet is still pending review, as `vegan`/`vegetarian` do? Today they hide only dishes
  known to contain the tag. Comments inside `till-app.ts`'s template text still carry design-doc
  pointers (`cash-drawer-authorization §5`, `device-enrolment §3.1`), and many `till-app.test.ts`
  titles carry plan and review labels ("(Finding 2)", "(P6)", "(FP-1)", "(KDS-1)", "Task 8",
  "(SP-B2.1)"), as do three `session-activity.test.ts` titles ("(C3)").

## Test titles repeat claims the branch corrected (#618)

- Found by #618 (`apps/till` `src/api` + `src/state` + `src/i18n`), not fixable in a
  comments-only change. Test titles repeat claims the branch corrected:
  `apps/till/src/state/working-order.test.ts` "previews the total via priceBasket" (the preview
  sums line totals) and `apps/till/src/api/client.test.ts` "getExpoQueue GETs this node's
  cross-station pass queue" (the queue is venue-wide and includes placed orders).

## Test titles repeat claims the branch corrected (#616)

- Found by #616 (`apps/till/src/widgets`), not fixable in a comments-only change. Test titles
  repeat claims the branch corrected: `apps/server/src/working-order.test.ts` "lists the node's open
  orders" (the list is venue-wide); `station-queue.test.ts` "(nothing to release)" is false for a
  held line with no course, and several `station-queue`, `tender-pay` and `modifier-picker` test
  titles carry task numbers. `css` comments in `apps/till/src/widgets/station-queue.ts` and
  `screens/till-expo-screen.ts` still call the courseless group "auto-fired". `apps/till/README.md`
  says the held list is shared across the registers "on a node". Read, not run: a courseless
  section the server held shows its lines greyed with no fire button (`#fireAction` in
  `station-queue.ts`, from #131); `GET /api/till` never sends `stripe_on_device`, so the
  offline-consent toggle cannot appear; `ReaderOption.online` is never set outside tests;
  `card-grid.ts` passes a `.canExitToCounter=${false}` that `embedded` already makes irrelevant;
  the tab shell and the supervisor dialog emit events not named `wt-*` (CLAUDE.md §3; not checked
  whether the rule reaches till widgets).

## The till always mounts the counter screen `embedded`

- Found by #614 (`apps/till/src/screens`), not fixable in a comments-only change. Read, not run:
  the till always mounts the counter screen `embedded` (`apps/till/src/till-app.ts`, the
  `<till-counter-screen>` in its render), so the screen's own header — its Allergens, Floor,
  Station, Expo, Schedule and Log out buttons and its allergen toggle — is reached only by the
  screen's own tests; the floor screen's only mount (`widgets/card-grid.ts`) passes `embedded` and
  `canExitToCounter=false`, so its standalone header, Back button and that property are likewise
  test-only; and in device mode the station screen's `#reload` swallows a `device.unauthorized`,
  so a device cookie revoked mid-session raises nothing until the next connect. The screens' `css`
  templates still carry task and spec numbers ("Task 7", "KDS-4 §3d"). Unchecked and kept: the
  allergen screen's legal citation (RD 126/2015 Art. 6.5.a.2°). Not restored because nothing
  confirms it: the table-order screen's `#lineGross` "same arithmetic the server files with" (the
  server does not call `grossOf`).

## Two `v8 ignore start` comments in `till-sale.ts` (`finalizeCapture`, `finalizeSettle`) cite `provider.ts:66-83`

- Found by #613 (`apps/server` `till-*`), outside its files or not fixable in a comments-only
  change. Two `v8 ignore start` comments in `till-sale.ts` (`finalizeCapture`,
  `finalizeSettle`) cite `provider.ts:66-83`; the checker compares tool comments character for
  character, so repointing them to `PaymentResult` in `packages/payments/src/provider.ts` is not
  a comments-only change. Test titles #613 could not touch: "lost-T2" in
  `till-sale-integrated.db.test.ts` (a captured card payment whose sale was never filed),
  "Tasks 5 & 6", "7b", "FP-1, Task 6", "FP-2, Task 4", "SP-A.2 cutover", "Task 12 cutover",
  "KDS-2/3" and "(Copilot)" in the `till-api*` and `till-config` suites, and 29 titles
  saying "opaque 500".

## UI package notes left by the comments sweep

- Found by #604, read from the code at the time, not rechecked by A429 slice 5.
  `packages/ui/brand/README.md`'s table omits
  `public/icon-192.png` and `public/icon-512.png`, which the generator writes. A reviewer believes the `demo/**` coverage exclusion matches nothing and
  that `**/ui-core/**` is there because `packages/ui-core` starts with `packages/ui` (CLAUDE.md
  §4's unanchored-include trap); neither was tested.

## Seating a booking at a table in a zone that is not a table-tab zone has no bookings test

- `packages/bookings`, found by #574 and not changed (code, not comments). Seating a booking at a
  table in a zone that is not a table-tab zone has no bookings test: the real `openTab` refuses
  it with `service_zone.mode_incompatible`, the fake core in `src/testing/fake-core.ts` does not,
  and `routes.ts`'s `STATUS` map has no entry for that code, so it answers 400 by default.
  The server accepts an empty contact name; only the dashboard form
  refuses one. `seatBooking`'s `status = 'booked'` condition on its final update cannot fire
  while every caller goes through `withTransaction` (read, not run). Test titles in
  `bookings.test.ts` and `migrations.test.ts` still say "tenant", and `floor.test.ts` inserts
  `booking_time` as `HH:MM` while the write path stores `HH:MM:SS`. #574 moved the Vitest 3
  `groupOrder` measurement on bookings (CLAUDE.md §4) out of its `vitest.config.ts` into its
  commit message; `docs/developers/testing-guide.md` has no paragraph holding it.

## The booking state refusal describes a state move even when editing

- **OPEN, carried from A394-18's run-it review.**
  `packages/bookings/src/dashboard/strings.ts`'s `booking.invalid_transition` says
  "can't move to that state now". An edit of a seated, completed, cancelled or no-show booking
  now uses this code too. Choose wording that covers both edits and lifecycle actions, then
  update English and Spanish and pin both messages in the bookings wording tests.

## The bookings seat picker keeps a table it no longer offers

**The bookings seat picker keeps a table it no longer offers — OPEN (found 2026-09-23, writing
bookings' coverage tests, PR #503).** `packages/bookings/src/dashboard/bookings-screen.ts` stores the
picker's choice when a Seat click arms it. A throwaway browser test armed the picker on `t-1`, then
let a live refresh empty the table list: the dropdown showed no options and the value `""`, and
confirming still called `seatBooking("bk-1", { tableId: "t-1" })`. The same test found no way to
reach the `seatTableId === ""` side of `#onSeatConfirm` from the screen; that branch, and the
`?? ""` in `#onSeatClick` (after its own early return for an empty table list), are two of the
three branches bookings' coverage still leaves uncovered. **Next action:** decide what the picker
does when its tables change under it (re-pick the first, or close) and fix it test-first; the fix
may make one or both of those branches reachable, or show they can go.

## Five till handlers still leave a failed list refresh unhandled, and one a11y file may not render its screen

**Five till handlers still leave a failed list refresh unhandled, and one a11y file may not render
its screen — OPEN (found 2026-09-25, review of PR #641).**

- `#onLoggedIn` awaits `#refreshHeldOrders()` and then `#refreshStationQueue()` outside any `try`,
  and the `logged-in` listener in `render` calls it with `void`, so a failed held-list read at login
  is an unhandled promise rejection that also skips the queue, roster and floor loads.
- `#onRetrieveOrder` and `#onDiscardOrder` await `#refreshHeldOrders()`, and `#onAdvanceTicketItem`
  and `#onMarkCollected` await `#refreshStationQueue()`, in `apps/till/src/till-app.ts`, each after
  its `try`/`catch` and outside it. A failed refresh there is an unhandled promise rejection and the
  operator sees nothing: the test "a plain list refresh that fails starts no retry, leaves a
  countdown alone, and takes over a retry in flight" in `till-app.test.ts` suppresses the rejection
  the discard handler leaves uncaught. All four refresh on both paths, after a success and after a
  failure. Retrieve differs in that it writes nothing, so an "X succeeded, but…" message does not
  fit it.
- The two older cases in `apps/till/src/till-app.a11y.test.ts` titled "…on the composed counter
  screen…" (about lines 128 and 142) do not render the screen their titles name. Their `getTill`
  returns no `canvas`, and the till enters its shell only when it has one (`#inShell`,
  `apps/till/src/till-app.ts`), so in both themes they scan the lock screen (found with a temporary
  assertion on menus Task 9's branch; not re-run on `main`).

**Next action:** decide whether discard, advance and mark-collected go through `#refreshAfterWrite`
with their own "X succeeded, but…" strings, and what login and retrieve show when their refresh
fails. Give both a11y cases' `getTill` a canvas and assert `till-counter-screen` exists before each
scan.

## Cash handed back for a voided cash sale is recorded nowhere

**Cash handed back for a voided cash sale is recorded nowhere — OPEN (found 2026-09-24 by #605).**
A void writes no payment or refund row, so if staff give a customer cash back, the void's day shows
a drawer shortfall at cash-up. No till screen or server route calls `recordVoid` yet, so nothing
can do this today. **Owner decision 2026-09-25:** keep it here and decide it when the till's void
screen is designed.

## A re-sent "place" on an already-placed order answers 409 rather than replaying the original result — leave it, or build the replay?

**Product decisions to take before production:**

- **A re-sent "place" on an already-placed order answers 409 rather than replaying the original
  result — leave it, or build the replay?** In `invoice_first` the place path files a deferred
  invoice through `recordSale`, so replaying would mean reading back the immutable
  `registros_facturacion` row and rebuilding the invoice number, date and QR. That is fiscal core,
  and not work to do unattended. Leaving it is a real option — the 409 is a defensible state
  conflict and the till keeps the basket and shows `place.error`. The gain if built is that a re-tap
  after a lost response returns the invoice already issued instead of an error. Two claims an earlier
  campaign note made are FALSE and must not be reused: that placing files nothing fiscally, and that
  the current answer is an opaque 500. The place-path comment in
  `apps/till/src/till-app.ts` calling an idempotent `placeOrder` "a recorded backlog follow-up"
  refers to this entry.

## The till's top bar is one row at every width (A395, #1435): left open

- **A395 DONE (#1435): the till's top bar is one row at every width.** On a phone nothing changed. Wider,
  the bar moves items into the More menu one at a time, only as many as it needs to stay on one
  row. It draws its actions in priority order (A425) and moves them into More from the right:
  the Waitron name is hidden first, then Transfers (count and button together), Equipment,
  Profile, Allergens, My schedule, Kitchen, Pass, Find a bill, and last the operator's name with
  Log out (`design-system.md`). Tabs and the language chooser never leave; once everything
  else has left, the tabs scroll sideways. The More button is the hamburger (three lines);
  `design-system.md` says which icon means which menu. While More is open nothing moves out of
  it; the bar refits when it closes.
  - **Open, decided as built:** a change in the pending-transfer count alone never brings items
    back onto the bar, so when the count shrinks or goes away, items can stay in More although they
    would now fit, until the next resize or other change refits the bar.
  - **Open: three cases run close to, and sometimes past, their 15 s limit locally.** The "fits as a fresh bar does when
    …" cases in `apps/till/src/widgets/tab-shell.test.ts` (added by #1435) took 7.9–15.7 s on the
    owner's Mac on 2026-10-10 while other lanes ran, and the "name grows, then the transfer count
    changes" case timed out at 15.4 s both before and after A425's order change. Find what makes
    them slow rather than raising the limit.
  - **Open:** three lines in `apps/till/src/widgets/tab-shell.ts` are pinned by no test (deleting
    any one leaves every test passing): the phone-width early return in `#release`, the return
    after re-adding a step in `#fit`, and the unobserve of a replaced language chooser.

## Remaining till unit and tab edges, OPEN, unqueued (A379/A385 run-it review)

- **Remaining till unit and tab edges, OPEN, unqueued (A379/A385 run-it review).**
  A unit with no enabled text has an empty label; the tile and basket-refresh price templates
  still append a slash. Render those empty-label cases before choosing their display.
  Legacy unit maps cover English and Spanish only. The default Kitchen title remains
  English when the tab shell is shown in a synthetic Spanish probe; check whether any
  real kitchen session shows that bar before widening the standard-tab translation.

## A470 — the till's floor map follow-ups

- **A470 — the till's floor map follow-ups (2026-10-10).** Left open by A429 slice 3.
  - `wt-floor-map` acts on a `click` only when its `detail` is 0 (the keyboard's), leaving a
    pointer's click to the gestures, so a screen reader whose activation sends a `click` with
    `detail` 1 or more and no pointer events would open nothing. Unmeasured; needs a manual
    VoiceOver and TalkBack check.
  - A party with an open tab and nothing owed reads "Owes €0.00" in the details sheet
    (`table-details-sheet.ts`); the floor card shows €0.00 the same way.
  - The old floor card says "1 listos" in Spanish (`till-floor-screen.ts`, the count followed by
    `floor.ready`); the map's pin and notice say "1 listo".

## A474 — today's floor changes on the till: follow-ups

- **A474 — today's floor changes on the till: follow-ups (2026-10-11).** Left open by A429 slice 4
  (#1526).
  - A booking seated from the dashboard is believed to skip the taken-off check: the bookings
    module seats through `core.seatTable` (`moduleCoreServices`, `apps/server/src/boot.ts`), while
    the till's seat, join, Move guests and bill-move routes refuse a table taken off for today with
    `table.taken_off` (`refuseTakenOff`, `apps/server/src/floor-today-table.ts`). Found by the
    review reading the code; not run.
  - `wt-floor-map` works out which table is under the finger on every pointer move. Two cheaper
    versions were tried and each picked a different table (one failed an existing test, the other
    a probe), so the faster version still needs a way that keeps the same answer.
  - Back to saved place reports `table.not_on_today_plan` when a table still has today's row but
    the last reset's copy removes it. The real `floor-today-changes.test.ts` case "refuses a
    table whose master table was deleted, and one never on a plan" checks both the existing row and that refusal (A476
    run-it review). Decide whether this needs its own saved-place code and wording; the owner's
    A476 rename is retained for both paths.
  - `leaveMerges` (`apps/server/src/floor-today-merges.ts`) reads tables by id with no location
    filter; every caller checks the location first.
  - A second drop made while the first is still being sent replaces the first's drawn place.
  - When a table is dropped on another to seat a party, the till checks only the dragged table's
    gates; the server's join refusals are believed to cover the target, but that was not run.
  - Tapping a table to seat it is not limited to devices whose profile takes orders, while every
    other floor write is. Believed older than slice 4; not re-checked.
  - From the look pass: at 390 px a fixed stool shows no name; the refusal line is plain text; two
    tables' labels overlap while they line up mid-drag.
  - The new floor test files repeat their setup; shared helpers were left out to avoid churn.

## A561. A 2 × 2 table's name is cut short on the till map

**A561 (2026-10-13).** On the till's floor map a 2 × 2 table shows its name cut to "Cou…" (seen
for Counter 4 after a split, A503 part 3's look, `~/waitron-campaign-c/a503-3-shots`, shots
`7-map-after-counter4-*`). Small tables are more common now that a split-off table keeps its own
size. Next: decide how a small table shows its name (smaller type, number only, or a label outside).

## A562. A 2 × 2 table shows no name in the floor plan editor

**A562 (2026-10-13).** In the dashboard floor plan editor a 2 × 2 table, for example one put back
on the plan at its kept size, shows no visible name, and when selected its resize handles cover it
(A503 part 3's look, shots `8-counter3-put-back-*`). Since #1604 a table comes back at its kept size
rather than 8 × 8, so this is seen more. Next: the same decision as A561, in `wt-floor-plan-canvas`.

## A563. The till says "part of a joined table" for a joined table that has come apart

**A563 (2026-10-13).** Since #1604 `table.in_joined_table` also refuses a joined table with fewer
than two tables still joined, and the till shows the same sentence ("That table is part of a joined
table") for it, which is not accurate. Next: give that case its own wording, or its own code if the
server should say which case it is.

## A590. Splitting a table from the order screen drops the room's new revision

**A590 (2026-10-13).** Since A579 part 2b (#1624) the floor screen keeps the room's revision from
each floor answer until a newer floor read replaces it. The order screen's table split
(`#onSplitTable`, `apps/till/src/till-app.ts`) calls `splitTable` and ignores the `zoneRevisions` the
server answers when the split ends a group, then re-reads the floor (`#reloadTables`). Read, not
run: a floor change sent before that read arrives would carry the old revision and be refused
`floor_today.out_of_date` once, and the re-read fixes it. Next: hand the answer to the floor screen
as its own floor answers are, or confirm the window cannot be hit and close this.

## A591. A split down to one loses a table that had guests when its joined table went live

**A591 (2026-10-13).** A table of a joined table that holds guests when the reset puts the joined
table on the map is not a part still joined (`stillJoinedPart`, `packages/db/src/joined-parts.ts`).
Splitting the joined table down to one (`splitJoinedTable`, `apps/server/src/floor-today-split.ts`)
writes split rows only for the parts still joined, so when that table's guests leave it becomes a
part still joined of a joined table that has come apart: off the map, and seating it is refused
`table.in_joined_table`. Run on main 42ca8b30b and on A579 part 3a's branch (Counter 3 seated before
Long table went live, Counter 4 split off, Counter 3's party finished). Part 3a fixed the same case
for a push into a group (`writeMerge` writes a split row for such a table and marks its reset row
placed). Next: do the same in the split down to one.

## A592. A party that joins a group's table names the group's other tables in random order

**2026-10-14 — A618:** The five reads now break same-time ties by writing order. Number order is
still open: the disposable `a618-writer-probe.test.ts` case called `seatMergeMembers` with table ids
ordered against the labels and read Counter 4 before Counter 3 (one case passed). Both writers
consume `mergeMembers`, whose query orders by table id (`apps/server/src/floor-today-merges.ts:96`).
The original measurement below describes the reads before A618; no writer changed here.

**A592 (2026-10-13).** A party's tables are listed by `joined_at`, then by membership id
(`apps/server/src/parties.ts:207`, `:296`), and `joined_at` defaults to the current millisecond
(`packages/db/src/schema/parties.ts:82`). When a party joins one table of a group,
`joinMergeMembers` (`apps/server/src/floor-today-merges.ts`) adds the group's other tables in the
same millisecond, so their order on the bill falls to the random id. Seen in A579 part 3a: guests
at Long table, Long table dragged onto a Bar and Stool group, read "Bar, Stool, …" 13 times in 15
and "Stool, Bar, …" twice. That joinMergeMembers predates part 3a is read from `git log`, not run
on main. Next: give each table the group adds a later `joined_at` in number order, as `passGuests`
does (`apps/server/src/floor-today-parts.ts`). Seating a party at a group has the same tie
(`seatMergeMembers`, same file as `joinMergeMembers`): A579 part 3b's moved notice read "Counter 4,
Counter 3, Counter 5" in one run.

## A594. Moving a bill to a free table in a group seats only that table

**A594 (2026-10-13).** `moveBill`'s free-table branch opens a party at the one table it was given and
leaves the rest of its group free (`apps/server/src/move-bill.ts`, the `openParty` call), so a party
can hold some of a group's tables. Seating, the party join and Move guests all treat a group whole.
Found by A579 part 3b's review: Split tables… ticking that table would have left the party open with
no table; it is now refused `merge.strands_party`. Reset table (A579 part 4b) keeps a table split off a
joined table apart while a party holds any table of its group, so a group such a party holds only part of
is not ended under it. Next: decide whether the moved bill's party takes the
whole group, as seating at one of its tables does.

Such a party can also lose a group's today's name with no MOVED slip (A581 part 2's review,
reproduced with a throwaway test before A650 Part 1 changed when MOVED slips print; since then
the code has been re-read, not re-run): Move guests onto a table another party holds in the same named
group can end the group (`leaveMergeOf`) after `combineAt` has queued its slips (`moveGuests`,
`apps/server/src/table-actions.ts`). It needs a party holding part of a group, so taking the whole
group should remove it (reasoned, not tested).

## A603. Reset table does not wait for food on its way to a group's other tables, nor for a table a module refuses to remove

**A603 (2026-10-13).** Reset table keeps a split-off table apart for guests at it or anywhere in its
group, and for food on its way to the table itself (`resetTable`,
`apps/server/src/floor-today-reset-table.ts`). From reading, not running: food on its way to another
table of the group does not keep it apart, and neither does a table a module refuses to remove, which
the floor-wide reset counts as waiting (`refusedByAModule` in `apps/server/src/floor-today-store.ts`).
Raised in A579 part 4b's finish review and its fix report; neither changed. Next: reproduce each in a
test, then decide whether Reset table waits as the floor-wide reset does.

## A604. A split-off table the till's read leaves out could make Reset table refuse as out of date

**A604 (2026-10-13).** The till builds Reset table's list from the split-off tables its floor read
holds (`resetTableOf`, `apps/till/src/state/floor-today.ts`), and the read keeps only tables in
service; the server counts every split-off table (`resetTable`,
`apps/server/src/floor-today-reset-table.ts`). A split-off table missing from the read would make the
till send too few and be refused `joined_table.out_of_date` every time. Join again had the same line.
A579 part 4b's review found it by reading; whether a split-off table can be out of service was not
checked. Next: find whether that state can be reached, and if so make the two lists agree.

## A600. The floor-wide reset and its catch-up do not look at what stands in a saved place

**A600 (2026-10-13).** Reset table (A579 part 4a) refuses to put a joined table back over another
table standing in its saved place (`table.place_taken`). Reset to saved plan and the catch-up that
applies it decide each table from its own state only (`planReset`,
`apps/server/src/floor-reset-plan.ts`; `catchUpPass`, `apps/server/src/floor-today-store.ts`). From
reading them, not running them, the A579 design believes a table that waited (guests, or held by a
module) can be put back over a free table moved into its place, and that the reset can put a table
back over one that waits there. Next: reproduce both in a test, then decide what the reset does with
a table in the way.

## A598. A table held by guests when its joined table went live is neither joined nor split off

**A598 (2026-10-13).** Split tables… on a joined table leaves a table that a party held when the
joined table went live out of both its still-joined and its split-off lists, while a merge records
such a table as split off (`splitInUse`, `apps/server/src/floor-today-merges.ts`). A group of the
other split-off tables then never rejoins (`rejoining` needs every part split off), but the till's
data cannot show why, so its Split tables… window asks no Seats and the server refuses
`merge.seats_required`; the window then asks Seats (A579 part 3c). A reviewer's probe on
`counter3HeldAsLongGoesLive` (`apps/server/src/floor-catch-up.test.ts`) showed the refusal. Same shape
as A591. Next: record the held table as split off on that path too, as the merge does.

## A593. A table the reset turns into a joined table inside a waiting group keeps its old outline

**A593 (2026-10-13).** Bar pushed onto an ordinary Long table, guests seated, then the saved plan makes
Long table of Counter 3, 4 and 5: the reset makes Long a joined table while the seated group waits, and
Long keeps today's 8-wide row rather than its joined outline. A split that leaves two counters joined
then lays them side by side from Long's left edge (the case in `apps/server/src/floor-catch-up.test.ts`
matched by `-t "the reset leaves in one"` reads Long 16 wide after the split). Seen by A579 part 3a's
finish-branch worker (#1626) and left as it is. Next: decide whether the reset should apply the joined
outline when the group ends, or the split should lay out from the saved outline.

## A565. "Reset to saved plan" does not wait for food on its way to an ordinary table

**A565 (2026-10-13).** A reset applies a free table's saved place without asking about food on its
way: a plain table the saved plan turns into a part of a joined table, or drops, loses its place on
today's map while a kitchen order still names it. #1604 made a split joined table's group wait for
food on its way (`foodComingTo`, `apps/server/src/floor-today-store.ts`); ordinary tables were left
as they were. It was reproduced with a throwaway test in #1604's finish run; the behaviour dates from
`29801d74a` (floor plans, slice 1). Next: decide whether a reset holds such a table back, as it now
holds a split group.

## A566. An open order with nothing sent yet does not hold a split group back at a reset

**A566 (2026-10-13).** A split joined table's group waits at a reset while one of its tables has
guests, food on its way or a guest-holding merge (#1604); an open order at a split-off table with no
food sent yet does not count, so the reset can put the joined table back whole over it. Noted by the
fix worker in #1604's finish run and not changed. Next: decide whether an open order counts as busy
here, and check what the reset does with that order's table.

## A567. A saved-plan edit to a waiting joined table can shift where its tables land

**A567 (2026-10-13).** A split joined table waits for the reset while one of its tables is busy.
An edit to the saved plan that changes its tables meanwhile can shift where later tables land when
it is split or joined again. #1604 accepted it for now; #1608's plan notes that Join again lays
out from the same slots, and Reset table, which replaced Join again in A579, does too (`slotStart`, `apps/server/src/joined-split-layout.ts`). Left open by A503
(#1604, #1608). Next: decide whether such an edit waits for the reset, or the layout keeps the
tables it split from.

## A568. A part placed on today's map while its joined table waited keeps its place

**A568 (2026-10-13).** A table placed on today's map while its joined table waited for the
reset, and free when the joined table went live, keeps its place on today's map until the next
reset; the till hides it (`outOfServiceJoined`, `apps/till/src/state/floor-today.ts`). Left open by
A503 part 2 (#1601). Next: decide whether putting the joined table back also takes the table off
today's map.

## A569. The floor plan editor's Made of picker and two wraps

**A569 (2026-10-13).** The Add joined table window's Made of is a dropdown (`wt-combobox
multiple`, `apps/dashboard/src/screens/floor-plan-add-joined-table.ts`), not mockup 5's inline
list, because no inline multi-pick primitive exists. #1601's look also saw, at 1280 px, the tables
list's Made of column wrap to two lines, and in Spanish the two Add buttons stack. Left open by
A503 part 2 (#1601). Next: an inline multi-pick primitive, and the owner's call on the two wraps.

## A671. The floor plan editor's side panel: less text, nothing jumps

**A671 (owner, 2026-10-14).** The dashboard floor plan editor's side panel
(`apps/dashboard/src/screens/floor-plan-editor.ts`, `floor-plan-tables-panel.ts`,
`floor-plan-table-panel.ts`). Mockups: [nothing selected](mockups/a671-floor-plan-editor-panel/1-nothing-selected.png),
[a table selected](mockups/a671-floor-plan-editor-panel/2-table-selected.png) (the second also shows
A672's corner handles).

1. **Remove the subtitle** "Your first save goes live now; later changes tomorrow, unless you
   'Reset to saved plan' on the till." Its explanation belongs in help mode (A582).
2. **Remove the help sentence** above the table list ("Select a table on the plan to change it.
   Click a table below to put it on the plan or take it off; it returns to the same spot.").
3. **Remove the colour key** ("on plan / not placed / in a joined table"): the markers are plain
   enough.
4. **The table form always keeps its space.** Today placing or selecting a table opens the form
   above the list and pushes the list down. The space stays reserved and is left empty while no
   table is selected (owner: empty, not greyed-out fields), so the list never moves.
5. **"Add tables" and "Add joined table" move to the top of the panel**, above the form. A569's
   note that in Spanish the two buttons stack applies here too.
6. **Seats, Shape and Moveable share one row of boxes of the same height.** Seats is a little
   narrower; Shape becomes ONE button showing the current shape that switches between square and
   round (today two buttons, which also do not line up with Seats); the Moveable switch follows
   Shape on the same row.
7. **The round markers beside the table names become squares**: filled in the primary colour on
   the plan, an outline when not placed, filled grey in a joined table.
8. **Only the square places a table or takes it off.** Clicking the name no longer toggles
   placement; for a table on the plan it selects the table and opens its form, and for one off the
   plan it does nothing.
9. **A new joined table goes onto the plan as soon as it is defined** in Add joined table, rather
   than waiting to be placed from the list.

## A672. The floor plan editor's canvas: the top-left limit, corner handles, scroll bars on a turn

**A672 (owner, 2026-10-14).** In `wt-floor-plan-canvas` (`packages/ui/src/components/`) and
`packages/ui/src/floor-plan-geometry.ts`.

1. **A table at the plan's top-left limit cannot be moved or resized up or left, although empty grid
   shows there.** Seen with a turned table: dragging its top handle grows it so far and then stops,
   and the table cannot be dragged up or left at all. Likely cause, read and not run: a move clamps
   the table's unturned top-left corner at 0 (`clampToGrid`), `resizeFrom` refuses growth that would
   take it below 0, while the canvas draws a margin of empty grid beyond the plan's corner for the
   turn arrow (`#margin` in `willUpdate`), so the limit looks like free space. Next: reproduce, then
   decide whether the plan grows up and left when a table is taken there, or the margin stops looking
   usable.
2. **Corner resize handles** (owner: yes). Dragging a corner changes width and height together; the
   side dots stay, for stretching one side. The turn arrow moves from outside the top-right corner to
   above the top-centre dot, clear of the corner handle. A small table already has its name covered
   by its handles (A562), so decide with A562 how a small table shows them — corners instead of side
   dots below some size is one option. Shift+arrow resizing and the hit areas
   (`#renderHitAreas`) need the corners too.
3. **A small clockwise turn just after placing a table flashes scroll bars on the grid**, which then
   disappear. Related to the open "a size reading just after a floor plan drop may shift the plan"
   entry in `docs/backlog.md`; not measured whether it is the same cause.

## A673. The floor plan editor on a touch screen: pinch to zoom, tap before drag

**A673 (owner, 2026-10-14).**

1. **Pinch to zoom, and one finger moves the view**, as the till's floor map already does
   (`packages/ui/src/components/wt-floor-map.ts`: pan, pinch and wheel). The editor's canvas draws a
   fixed `GRID_SQUARE_PX` (12) per square and sets `touch-action: none`, so a pinch does nothing
   today. Moving, resizing and turning convert pointer distance to squares through
   `GRID_SQUARE_PX`, so each must divide by the zoom. Reuse the floor map's gesture code rather than
   writing a second one. How the editor lays out at phone width has not been looked at.
2. **On a touch screen a table is tapped to select it before it can be dragged** (owner, agreed).
   A finger on an unselected table moves the view, like empty grid, so panning a crowded plan does
   not move tables by accident. With a mouse, pressing a table still drags it straight away and
   selects it as it goes (today every press starts a move at once, `#onPointerDown`).

## A570. A table split off a joined table whose removal was refused cannot be moved

**A570 (2026-10-13).** When a joined table's removal is refused, its split rows stay
(`deleteWithItsSplit`, `apps/server/src/table-removal.ts`), so a table split off it is refused
Back and Take off (`table.split_off`), and Reset table (Join again before A579) has no joined table on
today's plan to put back.
Review M1 of #1608's tasks 1a–4 found it reached only through a party record left by an older
version. Left open by A503 part 4 (#1608). Next: decide whether a refused removal also ends the
split for the tables split off it.

## A571. A joined table that came apart cannot reach Reset table when its free tables are off the map

**A571 (2026-10-13).** A joined table that has come apart is hidden from the till's map
(`outOfServiceJoined`), and a split-off table that is taken off or has no place is offered no
action (`sheetActions`; both in `apps/till/src/state/floor-today.ts`). When those are its only
free split-off tables, Reset table (Join again before A579) is offered nowhere; the reset still puts it back. #1608's plan
found this state made by Back or Take off on a split-off table, which #1608 now refuses (design gap
7). Left open by A503 part 4 (#1608). Next: decide whether the zone menu offers Reset table.

## A572. Reset table counts a joined table whole while a table added to it still has guests

**A572 (2026-10-13).** A table the saved plan adds to a joined table while guests sit at it is left
separate by the reset, with no split record. Reset table (Join again before A579) then counts the
joined table whole: it gives it its full saved seats and asks for none, while that table still holds
its guests — the same state the reset produces. The case "brings Long table back at its saved place,
not where staff moved it" (`apps/server/src/floor-today-reset-table.test.ts`) expects those 10 seats.
#1608's first Codex review found it again (design gap 8). Left open by A503 part 4 (#1608). Next: decide whether that table counts as staying apart.

## A575. Reset table's window: two things seen in #1608's look

**A575 (2026-10-13).** Wording and layout calls for the owner, seen in #1608's screenshots
(`~/waitron-campaign-c/a503-4-shots`), neither a defect:

- The Spanish `joined_table.out_of_date` sentence ("Sus mesas han cambiado. Revísalo e inténtalo de
  nuevo", `apps/till/src/i18n/codes.ts`) wraps to two lines at 390 px. A579 part 4b's look did not
  shoot it; the three of its four new floor sentences it shot (all but `floor.table_in_group`, the one-table
  form) fit at 390 px in Spanish
  (`~/waitron-campaign-c/a579-4b-shots`).
- In the Reset table window (the Join again window before A579) the lines naming each table that
  stays apart sit below the Seats field (`apps/till/src/widgets/reset-table-dialog.ts`), so the
  reason is read after the field it explains; A579 part 4b's look found them there still.

Take off for today on a joined table with tables split off, the third point, is allowed by the
owner's A579 design and left as it is.

## A504. Floor plans published for a future date, and one per service period

**A504 (owner, 2026-10-11) — backlog only.** Two related wishes, each probably its own job:

- **Publish a layout for a future date**, as menus can (a queued edition goes live at its time:
  `menu_scheduled_publications`, `packages/catalogue/src/schema/publication.ts`). Today a saved plan
  reaches the till at the next reset.
- **Different layouts for different periods** of the day, for example lunch and dinner. This needs
  deciding how a change of layout meets tables that are occupied when the period changes. A506's
  Periods page and period dialog already leave a Floor plan column and field for it.

## A508. A table's QR code: order, call a waiter, ask for the bill or pay

**A508 (owner, 2026-10-11) — backlog only.** When guests sit down and a tab is opened for them, a
QR code is printed for the table. Scanning it opens a page on the guest's own phone where they can:

- read the menu and order from it;
- call a waiter to the table;
- say they want the bill, or pay it online.

This grows the parked [A guest paying from their own phone](payments.md#a-guest-paying-from-their-own-phone),
which holds two owner decisions taken on 2026-09-18 while pricing the payment part: the phone
reaches us over the public internet through the venue's cloud instance, not the restaurant's wifi;
and Waitron runs several payment providers at once.

**It needs the internet (owner, 2026-10-11).** The guest's phone is on mobile data, so the page is
served through the venue's cloud instance, and nothing serves it yet: public hosting and ingress
are open deployment work under _Replication, failover and the cloud_, and Waitron Cloud, which would
host the instance, has not been started. While the venue's internet is down the QR page does not
work; the till and the waiters carry on, because nothing external may block a sale (CLAUDE.md §5).

To decide before building:

- **What the code stands for.** It has to open this tab and no other and stop working when the tab
  closes, so it cannot be the table's number. A code that lets its holder order on a tab works as a
  live login, so CLAUDE.md §3's rule applies: the box stores it only as a hash.
- Whether an order from the phone goes straight to the kitchen or waits for a waiter to accept it.
- How a call or a bill request reaches staff: on the till, on the handhelds, or both.
- Which printer prints the code, and whether it prints when the tab opens or on request.
- What the page shows when the cloud instance is up but the box cannot be reached.

## A509. Online ordering for collection at the counter

**A509 (owner, 2026-10-11) — backlog only.** A customer orders from the venue's online menu and
collects the order at the counter. This was _online ordering (SP15)_ in _Later and parked_; it
shares A508's customer-facing menu, and its online payment is the same provider question as
[A guest paying from their own phone](payments.md#a-guest-paying-from-their-own-phone).

**It needs the internet (owner, 2026-10-11)**, for the same reason as A508: the customer is not in
the venue, so the page is served through the venue's cloud instance, which does not exist yet.
While the box cannot be reached no online order can be taken; sales on the till carry on.

To decide before building:

- Paying when ordering or at collection. The split of an order's service mode
  ([service-periods.md](service-periods.md#split-an-orders-recorded-service-mode-into-two-facts))
  already names "at collection" as one of the times payment can fall due.
- Choosing a collection time, and whether the venue can pause online orders when it is busy.
- How the customer learns the order is ready, and how the counter finds it when they arrive.
- When the fiscal record is made: when the customer pays online, or when the order is handed over.

**Allergens on the online menu (owner, 2026-10-14).** Each dish shows its allergen icons after its
name, with a key on the page naming every icon; the customer can hide dishes containing chosen
allergens, or show only dishes matching a chosen diet. Icons and words as in
[A668](../superpowers/specs/2026-10-14-a668-allergen-info-editor-and-till-design.md).

## Small floor-plan refusals still missing

- **Small floor-plan refusals still missing.** Left open by A429 slice 1 (#1493).
  - `dining_tables.plan_table_id` has no unique index; no writer makes two live tables follow one
    master table today.
  - The delivery-release trigger accepts an empty label.

## A phone's Chrome drew a white page for the box (watch, not a job yet)

- **A phone's Chrome drew a white page for the box (owner's phone, 2026-10-08; watch, not a job
  yet).** The phone's Chrome showed a white page for every box address (`/`, `/dashboard`, the
  box's IP) while the laptop drew it. Read over USB debugging, the page had loaded without errors
  and the join screen's element measured 679 px tall, while the owner still saw white; quitting
  and reopening Chrome fixed it. A browser fault or something of ours covering the page — not told
  apart. If it recurs, attach over USB before restarting Chrome: take a screenshot through the
  debugger and ask `elementFromPoint` what is on top. Seen while reporting A414.

## A436 — a kitchen display with someone signed in, logged out only after a long idle time

- **Owner, 2026-10-08, answering decisions 4 and 5 of the
  [A366 slice 5 plan](../superpowers/plans/2026-10-08-a366-slice-5-monitors.md):** "kitchen
  displays can have a login, but i would not expect them to log off automatically, or at least
  only after an extended logout time (eg 30 minutes)". With nobody signed in, the device is the one
  acting; with someone signed in, that person is recorded.
- **Why it is not small.** A kitchen display is built today as a screen nobody signs in on: the
  server refuses its sign-in (`refuseKitchenSignIn`, `apps/server/src/till-api.ts`); the profile
  stores no idle logout for it (`validateInactivityTimeout` returns none for `kds`,
  `packages/layouts/src/device-profile.ts`) and the profile editor hides the setting
  (`#shownFields`, `apps/dashboard/src/screens/device-profiles-screen.ts`); the till boots it
  straight into its screen with no lock screen and never runs the idle timer on it
  (`apps/till/src/till-app.ts`, `apps/till/src/session-activity.ts`); and a kitchen display
  profile has no list of who may sign in, and only the actions a shared screen may hold
  (`SHARED_DISPLAY_ACTIONS`, `packages/layouts/src/device-profile.ts`).
- **What it needs:** a way to sign in on the kitchen display's screen without hiding the queue;
  the sign-in route allowing it; who may sign in (the profile's admission list); the existing
  "Auto-logout after (minutes)" setting offered for a kitchen display profile, with "never"
  allowed; and, with someone signed in, which actions the person's permissions add.
- **What slice 5 leaves ready.** Its Done route records the signed-in person when there is one
  (`signedInPersonOn`), so a kitchen display's Done marks name the person once one can sign in.
  Its Fire records the device; with someone signed in it should record the person instead. Slice
  3's plan makes a kitchen display's "Close for today" take a manager's PIN because nobody is
  signed in; a signed-in manager could skip it.

## Task 7 (#789, each person's draft kept on the server)

- **Task 7 (#789, each person's draft kept on the server).** Left open:
  - A draft that moves to the other party in a merge, because its owner had none there, records
    no history event: the event kinds have no "moved".
  - The server's own `unavailable` flag (`apps/server/src/order-drafts.ts`) does not flag a line
    whose options list is unanswered (refused at submission `options.label_required`), a
    fractional quantity of a dish sold whole (`quantity.invalid`), or a menu version no longer
    live (`menu.version_changed`).
    For the first two, since Task 8 the till marks such a line `unit_changed` once the table's
    offers are read (`lineBlock`, `apps/till/src/state/menu-refresh.ts`); it moves a line saved
    against an older version to the live one.
  - Only the draft routes fold the ids in the path to lower case (`requireDraftPartyParam`,
    `apps/server/src/till-api.ts`, and `submitDraft`'s `joinGroupId`); the other party routes
    only check that the id is an id, and the group submission passes `joinGroupId` on as sent.
  - After a takeover into the taker's existing draft, or a merge that discards a draft, the
    previous owner's next save of the old draft is answered `draft.not_found`, not
    `draft.taken_over`.
  - A save must carry `draftId` and `revision` even for a new draft. A chosen option whose label
    id is not a UUID is refused `options.invalid` at save, where pricing answers
    `options.label_required`. An options or extras refusal at save names only the field, not the
    line, and the till shows one message for the whole draft (`asRefusal`,
    `apps/till/src/state/draft-sync.ts`), so it names no line.
  - Three rulings made on the branch for the owner to confirm: a line whose quantity is not a
    whole number never adds into another line; Finish table discards the party's open drafts,
    keeping their lines, instead of refusing while one is open; taking over someone's draft when
    you already have one adds their lines to yours and discards theirs, instead of refusing.

## Task 8 (#806, the till works from the server's drafts)

- **Task 8 (#806, the till works from the server's drafts).** Left open:
  - Saving and sending:
    - An edit can be lost at sign-out without a message: one made after the session had
      already ended (an inactivity sign-out), and one made while an earlier save was still
      waiting for its answer when sign-out began.
    - If someone else signs in while a sign-out is still waiting for its save, the till skips
      signing the first person out on the server, so that session lasts until it expires.
    - A send cut off by the 150-second limit is not sent again, and after a reply that never
      came the draft can stay locked for up to two limits: the send, then the re-read.
    - When a send is refused because the menu changed, the re-read of the table's menu runs
      outside that limit.
    - After a draft refusal whose re-read also fails, the till keeps the draft's old revision,
      so the next Send is refused as out of date and re-reads first: a wasted round trip.
    - While the till follows a party onto its next bill, the screen can show no draft for a
      moment; and when a merge or move coincides with a refused save, the save's message can
      replace "another device changed this table".
    - Drafts are not pushed to other tills: Sam's till sees Alex's latest draft only at its next
      read. Taking over an older copy is refused and the table read again.
  - Other people's drafts:
    - When the take-over added Alex's lines into Sam's own draft, Alex sees "Sam has an unsent
      order", not "Taken over by Sam": `takenOverFrom` on Sam's draft is empty.
    - At phone width nothing on the menu view says other people have drafts on the table; the
      button reads "Review (0)". The floor's mark does say so.
    - Three automatic changes to the draft (`adoptLines`, `removeLines` and `clear` on the
      till's store) are not blocked while a take-over is out. Read in the code, not run.
    - The Spanish "has taken over this order" wording has no test.
  - The floor:
    - The map tag says "Unsent" but not whose.
    - At 390 px the map overlaps and clips crowded tables, so a table's tag can hide under a
      neighbour.
    - A token near the plan's top edge is cut off by that edge: each token is centred on its
      position (`translate(-50%, -50%)`, `packages/ui/src/components/wt-floor-canvas.ts`), so a
      chip that grows it ("Time to fire", A117) pushes its label above the map's clipping edge
      on a 390 px map; the Spanish chip also runs past the token's right edge, and a round
      token's "Reservada 22:30" chip was seen doing the same. The owner chose on 2026-09-29 to
      land #891 with the chip inside the token and fix this later. Since service Task 10 the
      token also carries the table's signal chips, one row each; seen in screenshots, not
      measured: at 390 px a floor of six tables with two or three chips each overlapped so much
      that tokens covered each other's chips, and at 1280 px they did not. **Next action:**
      decide whether the map keeps a token inside the plan, or the chip hangs off the token's
      edge like "Unsent".
    - The map gives its "forgotten table" corner marker no spoken name.
  - The table screen:
    - Seating a table whose answer arrives while a newer table is still opening shows the seated
      table briefly before the newer one replaces it.
    - A refused seat leaves the till pointing at the refused table.
    - If the screen widens while Back on the Review view has focus, focus goes to the page.
    - A dish no longer on the menu shows an empty name on its tick button in the person's own
      draft, and in the spoken names of its course picker and Split quantity button (read in
      the code, not run).
    - The last-added bar is empty for a draft read back from the server until the next tap, and
      does not follow a weighed line when the server's answer replaces the lines.
    - While a weight is being entered, the weight entry covers the bottom of the menu and the
      bar.
    - "Review (N)" counts items (Beer ×2 counts 2), while the floor's mark counts lines and
      calls them "items", so the two can differ for one draft.
    - Keep lasts only until the server's answer rebuilds the lines; a kept line then asks
      Remove or Keep again.
    - A dish no longer on the menu, saved at a whole quantity, counts by that quantity on
      Review; its unit is unknown, so a weighed one saved at exactly 2 kg counts 2.
    - The counter's basket also tracks its last-added line, which it does not use.
  - Menu changes:
    - The server's "cannot be sold" mark is dropped once the till's newer menu read passes the
      line. That the two checks agree was read, not run; if they differ, one Send is refused
      `product.unavailable` and the line is marked again, which a test covers.
    - Every line priced under an older menu version is asked about whenever the server's draft
      replaces the till's lines (a reload, a re-read, a take-over), so the question comes more
      often than it would for a person who watched the menu change.
    - A line naming a version the till does not hold costs one more read of the table's menu.
    - The "The menu has changed" dialog shows a focus ring round the whole dialog box.
  - Tests: the accessibility test "has no violations with the round grid, the per-line course
    picker and the open tab drawer" no longer scans the menu grid (a phone test does), but kept
    its name. `repriceRebuilt`'s `menuItemId ?? ""` fallback
    (`apps/till/src/state/menu-refresh.ts`) is not covered. Whether a real till's browser ever
    paints the narrow layout for one frame before going side by side was not measured.
  - Rulings made on the branch for the owner to confirm:
    - after a reload the old price of a line is not known, so the till asks about every line on
      an older menu version, showing the new price alone, instead of storing prices on the
      server;
    - the two layouts are chosen by the screen's width against 720 px, not by the kind of
      device, so a tablet held upright shows the menu and the draft side by side;
    - −1 on the last-added bar at one takes the line out;
    - anyone may take a draft over, including the person it was taken from;
    - a line counts as unsellable when the till's check or the server's says so, and the
      server's mark gives way to a newer menu read on the till;
    - Cancel on the menu-change question holds until the next publish, re-read or Send, not
      the next poll.

## Task 11 (#916, cancellations, comps and discounts; B11a–B11g)

- **Task 11 (#916, cancellations, comps and discounts; B11a–B11g).** Left open:
  - A configuration imported at setup replaces the default "Entry error" cancel reason with the
    imported venue's reasons, so importing from a venue with none leaves the new venue with none,
    and the till's dialog then says so (`adjust.no_reasons`); whether setup should add the default
    after such an import is the owner's to decide. Registering a till
    (`apps/server/scripts/register-till.ts`) runs the same seed, so it would add the default to
    such a venue.
  - **The adjustment history records who approved, but not whether the bill's discount limit,
    rather than the reason, is why.** Recording it would need a column. **Next action:** decide
    whether to record it.
  - **A placed pay-later counter order (`ticket_then_pay` or `invoice_first`) cannot be
    adjusted:** the placed-order trigger freezes its prices, and an `invoice_first` order has
    already filed its invoice. B16 lets such an order be handed over before it is paid but did
    not decide this. **Next action:** decide whether a placed order can be adjusted before it is
    collected.
  - **The server's held-order edit (`PUT /api/working-orders/:id`) still voids a sent dish's
    dropped quantity without a reason** when a client sends it that way, the venue allows changes
    to sent items and the kitchen has not started the dish (`applyLineEdits`,
    `apps/server/src/working-order.ts`). The till's counter hides × and `−` on a sent dish only
    while it has read the order's lines; when they cannot be read, it shows both on every line.
    **Next action:** decide whether the edit should refuse dropping a sent line.
  - **Two basket changes the app makes by itself do not check the edit lock:** the menu poll's
    price-version update of the basket's lines (`adoptLines`) and the order's label
    (`WorkingOrderStore`, `apps/till/src/state/working-order.ts`). What is lost is the basket's
    own copy of the new prices. **Next action:** decide whether the two should wait for the lock.
  - **Nothing on screen shows the lock.** A tap on `+` or on the menu does nothing until the
    order and its lines have been read. How long it lasts on a real network is not measured.
    **Next action:** dim the basket, or show a one-line note, while `editsLocked` is set.
  - **Override PIN limits (C89, #951), for the owner:** the two PIN prompts say "wait a moment"
    rather than counting down the seconds the server sends, as the sign-in screen does, and the
    approver prompt hides the message as soon as someone types; the limit is an optional
    argument, so a future route taking an approver's PIN could leave it off unnoticed; and the
    dashboard's `verifyManagerPin` (`apps/server/src/payments-api.ts`) and the till's sign-in
    route each still repeat the steps `verifyThrottledCredential`
    (`packages/identity/src/credential.ts`) packages. The tests do not check that a refund's
    wrong PINs share the drawer's and adjustments' count, that the sign-in and override counts
    are separate, or that the count is per device. **Next action:** the owner decides whether to
    add the countdown and make the limit required.
  - **A reason's percentage limit can be exceeded** by combining a bill discount with a line
    discount, or two bill discounts under one reason, because a bill discount counts as 0% on
    each line. A row split off by splitting the bill, by a transfer, or by moving part of a line
    to another group starts with no percentage history. B11b's venue limit on a bill's total
    discount can ask for a manager's PIN; this per-reason cap is unchanged. **Next action:**
    decide whether the per-line cap should see bill discounts.
  - For an extra of a held dish whose HOLD ticket was queued, cancelling it tells the kitchen
    (B11g) but the till's cancel dialog still says only that it comes off the bill, because the
    till cannot see whether the HOLD ticket was queued. **Next action:** decide whether the till
    should be told that.
  - An extra counts its dish's percentage under a reason's per-line cap, and a dish the largest
    of its extras', which errs toward refusing. **Next action:** none unless staff find it gets
    in the way.
  - **Only give-aways and discounts split part of a dish with its extras.** Splitting a bill,
    transferring items and moving part of a dish to another group still refuse a partial move
    of a dish with extras (`tab.transfer_modifier_line`). A whole dish moves with its extras.
    **Next action:** decide whether those partial moves should split extras too.
  - **`pressEscape` in `packages/ui/src/components/wt-dialog.test.ts` waits a fixed 50 ms after
    each Escape.** That is deliberate, as its comment says: with `closeReportsDelivered` between
    presses, Chromium 153 let every Escape be refused, and a dialog without `closedby` passed the
    repeated-Escape tests. **Next action:** decide
    whether "closes on a real Escape press" should wait for its `wt-close` instead, keeping the
    timer for the stays-open tests.
  - The till's "Amount off (€)" writes the euro sign into the label rather than taking the
    venue's currency. How a comp or discount appears on the invoice is still asesor Q29.

## Task 16 (#981, counter handover; with B25, B26, B29, B30)

- **Task 16 (#981, counter handover; with B25, B26, B29, B30).** Open:
  - **A collect straight after Place order does not re-read the kitchen queue.** The till
    re-reads it after a collect only when the collect was opened from the waiting list, so the
    prep-queue card can keep showing the order without Collect until the queue is next read
    (read in `#onCollectOrder`, `apps/till/src/till-app.ts`, and `#collectAction`,
    `apps/till/src/widgets/station-queue.ts`; not run). Re-reading after every collect would stop
    the case "a switch to a prepay zone ends a kitchen-queue retry, and that retry's late failure
    does not bring the notice back" (`apps/till/src/till-app.test.ts`) proving what its title
    says, so B16 left it.
  - **The waiting list is drawn only inside the held-orders card**, so a canvas without that
    card shows no waiting list.
  - **Not measured — Pay on a sent `invoice_first` order whose invoice was credited may show the
    wrong total in the basket.** The waiting row shows what collecting charges (the invoice net
    of its credit notes, `readIssuedSales` in `apps/server/src/sale-due.ts`), but Pay loads the
    basket from `GET /api/working-orders/:id/placed`, which carries the order's lines. Reported
    by B16's review fixer from reading; no test shows it.
  - Lane B item B31 (owner, 2026-10-02; #1018): at login each counter list shows its own failure
    with a retry notice, so one list that fails no longer stops the others loading (they are still
    read one after another, so a read that hangs still delays the rest); this changed for tills too.
  - **Done (C130, #1056) — a device shows the screens its profile assigns, and the person's permissions
    decide the rest.**
    Left open: a till profile saved before C130, and one newly created on the Device profiles
    screen, has the three switches off until a manager turns them on; a till with no device reads
    no capabilities, so it shows none of the three buttons. A change to a device profile reaches
    a till only when the till starts again — a page load, a move to another server or a
    re-enrolment, or in dev mode the lock screen's switch-device button (the profile is read in
    `#boot`, `apps/till/src/till-app.ts`, as the layout and the hardware switches already are),
    so signing out and in again does not pick it up. Since W97 (2026-10-06) a profile switch on
    the till reads the device's setup again too (`#onProfileSwitch`). A review measured the header on
    2026-10-02 in real Chromium at 390 px, with the real `till-tab-shell` mounted with two phone
    tabs and an operator signed in: with only Find a bill offered — what main offers every
    handheld; `apps/till/src/widgets/tab-shell.ts` is unchanged by C130 — the page measured
    560 px wide in English and 602 px in Spanish, so the overflow predates C130 (the overflow
    PF6 Task 9 recorded; that entry, near the top of this file, is done under lane C's W27); with
    the three switches on it measured 843 and 867 px, and the Pass and My schedule buttons sat
    wholly off-screen (fixed by lane C's W27, below). On the handheld, the station screen's back
    button says "Back to counter" though a handheld on the built-in phone layout lands on the
    floor plan.
  - **Done (C133, #1045) — the till's tabs fit one screen, with or without a notice above them.**
    A staff list longer than the screen still makes the page scroll to reach the language button
    (since A187, 2026-10-02, the language chooser is at the top right of the lock screen).
    Left from C133's review, not changed there: the table-order screen's bottom bar still keeps
    a tap target and two gaps clear at its end (`padding-inline-end` on `.bottom-bar`,
    `apps/till/src/screens/till-table-order-screen.ts`) for a floating language button the till
    no longer has — the language button now sits in the tab shell's top bar (A187). Removing the
    space changes the screen's layout, so it is its own change. Likewise the till's
    `.submitted-toast` (`apps/till/src/till-app.ts`) still sits one tap target and two gaps
    above the bottom edge, the room the old bottom-right language button (later the footer)
    took; decide whether it should drop to the bottom edge. On the dashboard, the language
    chooser's menu is now a native popover in the top layer (A187), so it paints over the alert
    pop-up (`.alert-toast` in `apps/dashboard/src/dashboard-app.ts`, which hangs below the
    banner's row at its trailing edge, under the update bar while that shows, with `z-index: 40`, a stacking order the top layer ignores): where
    the two overlap, an alert arriving while the menu is open is hidden under it, and its
    countdown keeps running,
    since `wt-toast` (`packages/ui/src/components/wt-toast.ts`) pauses it only while the pointer
    or keyboard focus is on the pop-up. Decide whether an arriving alert should close the menu.
  - **For the owner:** a card taken on a connected machine that also prints a paper merchant
    slip opens no drawer; B30 covers only the machine Waitron does not talk to.

## Task 17 (#991, a table that leaves without paying)

- **Task 17 (#991, a table that leaves without paying).** Asesor Q28 was decided by the owner
  without the asesor (2026-10-01): the full simplified invoice is issued when the table leaves.
  Open:
  - **Known limit, kept by the owner's decision of 2026-10-01 — a bill holding a payment cannot
    be left unpaid** (`unpaid_departure.bill_holds_payment`, even one given back in full): its
    invoice would have to be settled in part, and `settleSale`
    (`packages/core/src/settle-sale.ts`) refuses a settlement whose payments do not add up to
    the amount due. Such a table can only be finished by taking the rest as payment.
  - **Collecting PART of the debt later is not built**, for the same reason. Collecting it in
    full uses `POST /api/working-orders/:id/collect`.
  - **A dish never sent, on hold or recalled blocks the departure**
    (`unpaid_departure.unfired_dishes`); staff cancel it first.
  - **The table screen still reads a credited presented bill at its full amount.** Its per-bill
    "to pay" line (`apps/till/src/screens/till-table-order-screen.ts`, `bill.outstanding`) and
    the party's total (`apps/till/src/till-app.ts`, summing each bill's `outstanding`) read no
    credit note either, so a presented bill whose invoice a credit note has reduced, in part or
    to nothing, without the bill being cancelled, still shows its full total there (read, not
    run). The partly paid bill's "to pay" line and its pay-the-rest button
    (`apps/till/src/screens/till-table-order-screen.ts`, `partlyPaid.outstanding`) read
    `outstanding` too, but that section is drawn only for an open bill holding a payment
    (`paidInPart`, `apps/till/src/state/bill-state.ts`), and an open bill has no invoice, so no
    credit note reaches it today (read, not run). **Next action:** decide whether those read
    `amountDue` too, which W26 (#1136) left out because other screens and the floor read
    `outstanding`.
  - **A 0.00 simplified invoice:** B17's departure, and since B28 (#1005) Pay on a bill whose
    total is zero, file one; whether AEAT accepts it was not tested.
  - **Left by B28's review (#1005), neither acted on.** (1) The reader pay's `tipOf`
    (`apps/server/src/till-sale.ts`) treats a `null` tip as no tip, against CLAUDE.md §3's rule
    that a default applies only when the field is absent; it predates B28, and paying a non-zero
    bill on the reader is believed to accept it the same way (read, not run). Next: a route case
    sending `tip: null` to `POST /api/pay`, then decide refuse or accept. (2) After a free sale
    settles on the reader, a stale card-attempt mark on the order is left in place; manual Pay is
    believed to leave it the same way (read, not run).
  - **A bill presented without an invoice keeps the label it was placed with when the departure
    invoices it.** Every other path that invoices such a bill saves the receipt label in the
    update that settles it; the departure leaves the bill placed, and the placed-to-placed clause
    of `working_orders_enforce_transition` (latest in
    `packages/db/drizzle/0056_placed_order_handover.sql`) requires the label to stay as it is
    (measured 2026-10-01: saving it made the departure answer 500). Not measured: what its
    invoice's reprint and the debt list then show. Fixing it needs that trigger to allow the
    label to change. A bill the departure settles because it owes nothing goes through
    `settleIssuedOwingNothing` (`apps/server/src/till-sale.ts`), which sets no label, although
    the trigger allows one there.

## Tables, parties and bills — the till's table actions

- **Tables, parties and bills — the till's table actions: DONE (2026-09-29, all thirteen tasks).**
  [plan](../superpowers/plans/2026-09-28-table-actions.md); Task 1 #816, 2 #825, 3 #844, 4 #832,
  5 #852, 6 #818, 7 #864, 8 #869, 9 #874, 10 #875, 11 #881, 12 #888, 13 #897. What stays open:
  - **Task 6 (#818) and C50 (#847): the ticket of a bill collected after a correction still shows
    the original invoice total.** `collectOrder` queues no receipt on this path; the ticket it
    returns, the original receipt the till offers, and any reprint are all built by
    `readSettledTicket` (`apps/server/src/till-sale.ts`) and show the invoice's original total, and
    since C67 the card-reader payment of a bill that owes nothing returns the same. The printed
    receipt and the screen both give the cash line as total plus change
    (`apps/server/src/receipt-ticket.ts`, `apps/till/src/screens/till-ticket-view.ts`), so it
    overstates what was handed over. **PARKED (owner, 2026-09-29)** until the product can issue a
    corrective invoice; the owner's points for that design are on the corrective-invoice entry (R5,
    above). Also from C67's review (a probe, not a committed test): for a bill corrected to exactly
    zero, a captured card payment with no sale still takes the recovery branch first, settling at
    the captured amount with all of it recorded as tip; the below-zero case with a capture was not
    run.
  - **Task 4 (#832, every paper names all of a party's tables).** At 390 px a pass card whose
    label wraps also wraps its "2 min" onto two lines (`apps/till/src/screens/till-expo-screen.ts`);
    nothing overflows. **DECIDED (owner, 2026-09-29): leave it** — after payment, the station queue
    card, later kitchen notices and the till's list of a party's bills keep showing the frozen
    receipt label with the party's name ("Ana · Mesa 4, 5"). Not yet checked: the payment API's
    `/management-api/payments/stuck`, `/management-api/payments/bill-payments` and
    `/management-api/payments/bill-refunds` queries (`apps/server/src/payments-api.ts`), which read
    the same column.
  - **Task 7 (#864, move a whole bill).** Open: the move moves the bill's revision on, open or
    presented, without `bumpRevision`'s refusal of money in flight, since a move changes no amount
    (plan P19); and since A143 (#928) paying a pay-first order with a dish no station can take
    files the sale and raises `route.dish_not_sent`, but invoice-first placing still refuses such
    a dish — nobody has decided whether it should take the order and raise the alert instead.
  - **Task 8 (#869, move guests, join and split tables) and C77/C86.** Open: a party with no table
    whose chain of merges never ends (an unknown id, or two parties recorded as merged into each
    other, which the database accepts) is named by the bill's own label; whether any till action
    can make such a loop was not checked. `partyFamilies`, the reverse lookup of `partySurvivors`,
    stayed in `apps/server/src/parties.ts`, while `partySurvivors` is in
    `packages/db/src/party-table-labels.ts`. `party.main_bill_stays`'s till wording says "the table
    has other unpaid bills", which Split a table choosing the main bill need not satisfy. Left by
    #906's review: `computeOverdueOrders` is the one report function that reads its own node's
    location rather than being handed one (adding `locationId` to `OverdueOrdersInput` was
    suggested, not done); no case pins what a correction slip prints for a counter order delivered
    to a table; and a database built on purpose with a delivery table in another location now
    names the order by its own label — no product path creates that state, and whether every
    existing venue database is free of it was not checked.
  - **Task 9 (#874, dishes arriving in a party get a kitchen group).** **A plan default the owner
    may overturn (P16):** spec §15's "leaves with them outside any group" is read as the side the
    bill leaves; the receiving party groups the dishes. Left by C78's review: the earliest fire
    time is picked by comparing the stored times as text, right only while every writer stores the
    same `toISOString()` form (every writer found uses `nowIso()`; not proven for all); and a dish
    recalled and fired again carries its new fire time but its old group's firer. Left by C80
    (read from `draftSections` and `groupArrivingDishes`, not compared with a running till): the
    till files a dish whose course it does not list (an inactive course) under the earliest course
    it lists, while a move keeps it in its own held group; and when a round is SENT,
    `working-order.ts` picks its earliest course without checking whether it is active, so with a
    switched-off course the send path and the move path can file a dish with no course under
    different courses (owner, 2026-09-29: not queued).
    **2026-10-10 update:** A435 step 5's retained metadata now gives saved drafts their recorded
    course section and fired lines their recorded label, including when the active list is empty.
    The earlier C80 reading above is historical; the move/send comparison remains unverified here.
  - **Task 10 (#875).** Unchecked Send to radios are Chromium's own dark-theme control, dim grey on
    the dark dialog (seen in the 390 px Spanish dark screenshot).
  - **Task 11 (#881).** Open (found by #905's review, by reading, not reproduced): on a handheld, a
    waiter who taps a free table to seat it, goes back to the order tab while the seating is still
    under way and starts Move guests can have the move set the wrong table on the new party; the
    suggested fix is to count only table opens started in the current operator session; not
    queued. The till sends `otherPartyId: null` when its floor does not list the target table at
    all (a failed floor read empties the list); a table another party holds is then refused as out
    of date, never combined. On a 390 px phone the bill choice's buttons wrap ("Keep separate
    bills" on three lines).
  - **Open, from C84's review (#913):** when a void or line change gets no answer,
    `#rereadAmounts()` can put on screen what the party still owes, taken from its bills after its
    own floor read failed, while the revision on screen stays where it was. A later floor read that
    also fails keeps a floor listing the same party at that EQUAL revision, which
    `#retakePartyFromFloor()` takes, and `#followDraft` → `#rememberOrderParty()` after a send with
    no answer takes too, putting the floor's older amount back (`apps/till/src/till-app.ts`). Traced
    in the code, not reproduced.

## Four till surfaces ask for a caution colour that is defined nowhere, so all four render as plain text

- **Four till surfaces ask for a caution colour that is defined nowhere, so all four render as plain
  text.** The token is `--wt-color-warning-text`, declared in no theme; what exists in
  `packages/ui-core/src/tokens/colors.css` is `--wt-color-warning` (with `--wt-color-on-warning`),
  which `wt-count-badge` uses. Each of the four call sites writes the fallback form
  `color: var(--wt-color-warning-text, var(--wt-color-text))` — `apps/till/src/widgets/basket.ts`,
  `station-queue.ts`, `diet-badges.ts` and `apps/till/src/screens/till-expo-screen.ts` — so the
  emphasis those rows were written to carry never appears. `diet-badges.ts` also reads
  `--wt-color-success-text`, declared nowhere, the same way. **Next action:** whoever takes the till
  layout pass below decides whether these four want `--wt-color-warning`, a new
  `--wt-color-warning-text` defined in both themes, or the `--wt-color-danger` the dish picker's
  refusals now use. These five reads are the listed exceptions in
  `scripts/style-token-names.test.ts`; fixing them means deleting their entries from its
  `FALLBACK_READS`.

## Five measured till layout defects and one seen in a screenshot, all of them older than the extras-and-options work

- **Five measured till layout defects and one seen in a screenshot, all of them older than the
  extras-and-options work.** Found while looking at the real screens for B1 Task 12. **Next action:**
  take these six as
  one till layout pass over `apps/till`, at 390 and at 1024, measuring rectangles rather than
  reading rules — and set the width with `page.viewport(w, h)`, never `commands.setViewportSize`,
  which resizes the outer page and leaves the components' own iframe alone
  ([testing-guide.md](../developers/testing-guide.md)).
  - **Within one extras list, prices are not a column and names are not a column**
    (`apps/till/src/widgets/modifier-picker.ts`) — a checkbox row and a stepper row misalign both the
    price edges and the name edges, at 1024 and at 390.
  - **The picker's fieldset legend wraps at phone width and its second line crosses the fieldset's own
    top border**, so the required marker (appended as a plain space) can break onto a line of its own
    sitting on the border rule.
  - **Nothing says WHY Add is disabled when a list's minimum is unmet.** The only cues are a `*` on the
    legend and a dimmed Add — and that `*` is also the only thing telling `minPicks: 1` from
    `minPicks: 2`. Wants a sentence beside the list stating the minimum in words.
  - **A long dish name pushes that line's remove control outside the basket**
    (`apps/till/src/widgets/basket.ts`): the unstacked layout's `1fr` column bottoms out at the
    longest word. Measured at phone width before A310. Since A310 a canvas tab's basket at 40rem or
    less (`card-grid.ts`) puts the name on its own row; not re-measured there. Above 40rem the
    unstacked layout and its `1fr` column are unchanged.
  - **A pick's money column sits right of the dish total it belongs under**, further right than the
    dish row's own remove button, because `.line` and `.option` use different column templates.
  - **Product-grid tiles: a long name starts left of its own card border, and a unit price crosses the
    card's right border.** Seen in a screenshot, not measured. That widget was retired on 2026-09-27
    for `till-menu-browser` (`apps/till/src/widgets/menu-browser.ts`), whose tiles wrap their text
    inside the card; in the menus Task 9 screenshots opened at 390 and 1280 px no name or price
    crossed a border. Looked at, not measured: close once someone measures it.

## Unchecked since the service plan's Task 8 (#806): whether a round entered while the floor was being re-read is still hidden when the till follows the party onto its next tab

- **Unchecked since the service plan's Task 8 (#806): whether a round entered while the floor was
  being re-read is still hidden when the till follows the party onto its next tab** (the second
  finding of the retroactive Codex review of #719). The review's probe tested code since rewritten
  — the draft now lives on the party, on the server and in `DraftSync`, so nothing is carried
  between tabs — and was not re-run against the new code.

## Refuse a request from a device that is not enrolled

- **Refuse a request from a device that is not enrolled** (owner design of 2026-08-30, deferred
  until after the demo: [design](../superpowers/specs/2026-08-30-device-auth-enrolment-fail-closed-design.md)).
  Tills enrol, selling needs an enrolled device, and a device profile's capabilities gate some
  actions (`assertDeviceCapability`). But a request that carries NO device still passes
  `assertDeviceCapability` (`apps/server/src/device-session.ts`). Left: refuse a request with no device, one table of which
  device kinds may do what with a guard that walks the routes, and printer identity (the design's
  sub-project C). It sits on the sale and cash path, so it takes the full review. Since B29 (#1011)
  a handheld places, collects and cancels like a till, and since A238 no refusal is for being a
  handheld: taking cash, the drawer, integrated card payment and printing each follow the device
  profile's capability. The design's table is out of date on those rows.

## Screen faults seen during menus Task 9's look on 2026-09-27

- **Screen faults seen during menus Task 9's look on 2026-09-27.** Seen on the dev stack while
  checking the till's home page, not investigated, and not checked against `main`, so any of them
  may predate that branch:
  - on the till at 390 px wide, the header makes the page wider than the screen (measured in
    C130's entry above: 560 px in English and 602 px in Spanish with only Find a bill offered);
  - on the till's floor map at 390 px wide, tables overlap one another;
  - in Spanish, the till's tab names "Counter", "Floor" and "Order" stay in English (traced to
    canvases, see A182 below; fixed by A379 on 2026-10-08);
  - the till's browser console shows Lit's "scheduled an update … after an update completed"
    warning.

  **Next action:** check each against `main`, then fix or file it on its own.

## Build good screens for each kind of device, and retire canvases (A182, owner 2026-10-01)

- **Build good screens for each kind of device, and retire canvases (A182, owner 2026-10-01).**
  The owner decided on 2026-09-20 to ship well-designed built-in screens instead of a screen
  designer that venues drag and resize; customisation beyond that, if it is ever needed, means
  screens written in code that plug in
  ([service design §11](../superpowers/specs/2026-09-20-service-ordering-and-billing-design.md)).
  Nothing has carried that out. Every device's screen is still built from a CANVAS: a stored list
  of tabs, each tab a grid of cards, chosen per device profile. Ranked second under _What to work on next_ (owner,
  2026-10-01). What exists today:
  - A default canvas per form factor, in code (`packages/layouts/src/default-canvases.ts`): the
    till gets a Counter tab (product grid, basket, total, pay, held orders) and a Floor tab; a phone
    or tablet handheld gets Floor and Order; a kitchen screen gets one Kitchen tab. The card types
    are `CARD_TYPES` (`packages/layouts/src/canvas.ts`).
  - Stored canvases in the `canvases` table (`packages/db/src/schema/canvases.ts`); a device
    profile may name one (`device_profiles.canvas_id`), and otherwise gets its form factor's
    default. The till's start-up answer carries the chosen canvas (`apps/server/src/till-api.ts`),
    the till shows its tabs only once it has one (`apps/till/src/till-app.ts`), and it draws each
    tab's cards in `apps/till/src/widgets/card-grid.ts`.
  - The dashboard's canvas editor (`apps/dashboard/src/screens/canvas-editor-screen.ts` and
    `canvas-editor/`), the canvas picker on the device profiles screen, the
    `/management-api/canvases` routes, the `listCanvases` and `getCanvas` live queries, and the
    `canvas.*` error codes (`packages/layouts/src/errors.ts`).
  - A canvas may carry a theme override (`CanvasDef.theme`); a grep of `apps/` for `.theme` finds
    nothing that reads it.

  One fault already traced to canvases: the till draws each tab's name straight from the canvas's
  stored `title` (`apps/till/src/widgets/tab-shell.ts`), and the defaults store English titles,
  which is why "Counter", "Floor" and "Order" stay in English in Spanish (one of the screen faults
  in the entry above).
  **2026-10-08:** A379 translates the standard key/title pairs at render time while preserving
  renamed and custom titles.

  The work, each part its own brainstorm, spec and plan:
  1. **Design the screens for each kind of device** — the till at the counter, the handheld (phone
     and tablet), the kitchen screen and the pass — starting from the till screens that already
     exist (`apps/till/src/screens/`) and [ui-review.md](../ui-review.md)'s walk of the three displays.
     Decide what each one shows, how it fits narrow and wide screens (a responsive grid inside a
     screen is fine, §11), and what a venue may still choose per device, such as its kitchen
     station — set on the device profile, not drawn in an editor. _(2026-10-06: W93 took the home
     layout out of the profile: a menu's Device Home Page has one display per kind of device, and
     the device's form factor picks it.)_
  2. **Retire canvases** once those screens replace them: the till's canvas tabs and card grid, the
     `canvases` table and `device_profiles.canvas_id`, the canvas code in `packages/layouts`, the
     dashboard's editor, its navigation entry and the profile screen's picker, the routes, the live
     queries, the error codes and their translations. No data is carried over (§3's pre-live rule).
     Trace every consumer before deleting; the tests that build a canvas for the till go too.

  **Separate, and staying** (§11): a menu's Device Home Page and its Handheld and Till displays
  (how its shortcuts are arranged), receipt
  configuration, and the floor-plan editor.

  **Owner, 2026-10-08:** "delete the canvases functionality. we provide prebuilt screens with
  configuration settings." **Decided the same day: delete now**, before the redesign. Today's
  default canvases (`packages/layouts/src/default-canvases.ts`) become the fixed built-in screens
  for each kind of device, and part 2 below runs first; part 1's redesign follows, starting from
  those fixed screens rather than from canvases.

  **Until this lands, build no new feature as a canvas card or card setting** — put it in the
  screen itself. Slice 3d already kept its kitchen-group choice off the `expo` card (its P15).

## What W105b left open (#1248, a disabled device coming back as itself)

Left OPEN by W105b (#1248, a disabled device coming back as itself): (1) the slow hash check runs
only when the cookie names a disabled device, so the
response time hints that an id is a disabled device; asks are rate-limited and, outside dev mode,
accepted only while Add a device is open. (2) Someone holding a copy of a disabled device's
current cookie can ask first and so replace that cookie; outside dev mode they still cannot get in
without a manager tapping the number. (3) If an ask's response is lost after the server saved it,
the browser's next ask joins as a new device and the old row stays disabled. (4) A long name in
the waiting list overflows a phone's width. (5) An ask that replaces a waiting one always gets a
later `createdAt`, but an ask made when no ask is waiting under its id, whatever ended the
previous one (accepting it included, once the device is later disabled), is not forced later.
It must first prove the token the previous ask issued, a scrypt check, so sharing a millisecond is
unlikely, but nothing in the code rules it out.

## What W106 left open (the battery on the Devices list, #1240)

Left OPEN by W106 (battery, #1240): (a) the relative-time words (W106a, #1272, `wt-relative-time`)
show the exact time in the BROWSER's time zone: the relative-time widget receives no venue time
zone. Other dashboard places still showing a bare `YYYY-MM-DD HH:MM` (`formatIsoMinute`), not
changed: the Devices "Last
seen" column; on Printers, a print agent's join request, an agent's Last seen (its table and Edit), a
printer's Last print and Last seen (its status view) and Last print (the printers table), "Seen on {agent} · {time}" (`printers.seen_at`), and the print
queue's Created and Delivered columns; the menu status and preview's "published {time}"
(`apps/dashboard/src/widgets/menu-preview.ts`); and the adjustments report's time column
(`packages/adjustments/src/dashboard/adjustment-report-screen.ts`). Whether any of them should
use `wt-relative-time` is the owner's call.

## What W105 left open (#1235)

Review suggestions #1235 did not take, listed in its description: the edit
route checks permission before the device id where revoke checks the id first; its body is the
whole device rather than only the fields named (since W105e, made-here may be left out); it can write the device row up to three times;
`rowClickable` and `rowActivation` could be one option; a save fetches the list twice; Edit and
Pair repeat some request-body building; seven unread `devices.*` strings.

## What W104 left open (#1225)

Left OPEN by W104, not acted on: (1) a Pair save that never answers locks both dialogs, because a
save carries no time limit (`packages/dashboard-kit/src/request.ts` limits GETs only); (2) leaving
the Devices page with Back while a Pair save is in flight still sends a deny for that request
(`#closePair`, `apps/dashboard/src/screens/devices-screen.ts`), and what then happens to the
device is untested; (3) the Add a device and Pair dialogs were looked at only through the browser
test harness with a stubbed server, never on a box, so a real QR code drawn from a real box
address has not been looked at. (4) a device's knock is refused if the window shut while its body was
arriving, but open periods are told apart only by their start time, to the millisecond
(`apps/server/src/device-api.ts`), so a shut and reopen within one millisecond would pass.

## Does "made here" belong to the device or to its profile? (A270, owner 2026-10-04) — OPEN

- **Does "made here" belong to the device or to its profile? (A270, owner 2026-10-04) — OPEN.** It
  is a per-device setting by the 2026-10-01 decision
  ([routing design §5.11](../superpowers/specs/2026-09-30-catalogue-menus-routing-design.md)); under
  the 2026-10-04 profile model a "Bar till" profile could carry it instead. A268 keeps it on the
  device. Needs an owner decision.

## Each browser tab as its own device, in Demo too (A271, owner 2026-10-04) — OPEN, after A268

- **Each browser tab as its own device, in Demo too (A271, owner 2026-10-04) — OPEN, after A268.**
  Only dev mode lets a tab act as a separate device, and it names the device by id alone
  (`x-waitron-dev-device`, `apps/server/src/device-session.ts`); the sign-in cookie is shared by the
  whole browser. Since #269 and #287 pairing also overwrites the browser-wide device cookie, so a
  tab that misses the dev chooser (the chooser's failure is swallowed, `apps/till/src/till-app.ts`)
  lands on the most recently paired device's login. **Next action:** a short spec for per-tab device
  secrets and per-tab sign-ins usable in Demo, and reproduce the owner's report first.

## Recorded cash in and out of a till's drawer (A239) — OPEN, needs a spec before queueing (owner, 2026-10-03)

- **Recorded cash in and out of a till's drawer (A239) — OPEN, needs a spec before queueing (owner,
  2026-10-03).** Piece 2 of A238. Each top-up or removal of cash from a till device's drawer is a
  recorded entry: who, how much, why, when (topping up change, paying a supplier, a waiter handing
  in float cash). The entries replace the two typed totals the daily close takes today (opening float
  and payouts, `packages/reporting/src/record-daily-close.ts`). Needs A238 (landed as #1164).
  No screen collects cash
  counts yet; this is where one belongs.

## Waiter cash floats (A240) — OPEN, needs a spec before queueing (owner, 2026-10-03)

- **Waiter cash floats (A240) — OPEN, needs a spec before queueing (owner, 2026-10-03).** Piece 3 of
  A238. Its screen belongs with clocking in and out, under Team (owner, 2026-10-03, A261 §10). Owner decisions so far: a float belongs to the WAITER, not the handheld; a waiter with an
  open float may take cash on any handheld, and it adds to their float; the waiter settles the float
  at a till before leaving, entering what they hold, the difference is recorded against them and the
  cash goes into that till's drawer as an A239 entry; the daily close lists any float still open.
  Cash taken on a handheld whose profile allows cash, with no float, is counted against the
  handheld until then (A238). Open: where a float's opening cash comes from (a till's drawer, or brought in). Needs
  A238 (landed as #1164) and A239.

## The till's schedule screen does not follow the forms rule yet

  (6) the till's schedule screen (`apps/till/src/screens/till-schedule-screen.ts`) does not follow
  the rule yet: its cover request keeps its button disabled until a shift and a colleague are
  chosen, and its absence request until both dates are filled, before any press; neither shows a
  message beside its fields; and a refusal shows as a `role="alert"` notice at the top of the card.
  Other till surfaces were not checked against the rule either, and whether a number pad or a
  choice picker counts as a form under it is open: the payment and weighing steps
  (`apps/till/src/widgets/tender-pay.ts`) keep Confirm payment disabled while the cash entered is
  below the total and Add disabled while the weight is invalid, before any press, with no message;
  the dish options picker (`apps/till/src/widgets/modifier-picker.ts`) keeps Add or Save disabled
  until its required choices are made, and shows changed or unavailable choices as `role="alert"`
  paragraphs rather than beside a field; and the supervisor override dialog
  (`apps/till/src/widgets/supervisor-override-dialog.ts`) keeps Authorize disabled while the PIN is
  empty and shows a refusal as a `role="alert"` paragraph.

## Three till loading lines may not be announced

- **Three till loading lines may not be announced** (found 2026-10-03 in review of lane C's W23).
  The schedule screen (`apps/till/src/screens/till-schedule-screen.ts`, #1103), the lock screen and
  the device chooser each insert a `role="status"` element already holding the loading text and
  remove it when loading ends. W3C's technique ARIA22
  (https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA22) tests: _"Check that the container destined
  to hold the status message has a role attribute with a value of status before the status message
  occurs."_ The review's run-it seat watched the lock screen's and device chooser's DOM in Chromium:
  each status element was inserted already holding its text and removed when loading ended. The
  schedule screen's was read, not run, and no real screen reader was tried. **Next action:** decide
  whether to keep an empty status region on the page and fill it later, and test that sequence.

## The counter till may start in a zone its service zone dropdown does not list

- **The counter till may start in a zone its service zone dropdown does not list** (found
  2026-09-14; read, not run). The till's zone list drops `table_tab` zones (`listDefaultZoneOffers`
  in `apps/server/src/till-api.ts`), but its starting zone comes from `resolveNewOrderZone`
  (`packages/venue-service/src/operations.ts`): the profile's starting zone when the profile has a
  department, else the zone marked `is_counter_default`, neither filtered by service mode. Since
  A178d the box is a `wt-combobox`, which shows an empty box for a value with no matching option
  (read, not run). W97 retired the per-device default zone and the dashboard control #1004 added
  for it (2026-10-06).
  **Next action:** find whether a `table_tab` zone can be the counter default or a profile's
  starting zone; if it can, decide whether that is refused where it is set or handled by the till.

## Unresolved observation from W101 verification

Left open by W101 (#1351).

**Unresolved observation from W101 verification:** two full local `@waitron/till test:coverage`
runs logged an unhandled rejection in `#holdIdentity` while `#switchProfile` was reading identity:
`Cannot read properties of null (reading 'approvedProfiles')`. Both completed with every test
passing; the second met coverage. Receipts: `~/waitron-campaign-d/receipts/w101/till-full-coverage.log`
and `till-full-coverage2.log`. The triggering test and cause are unverified; isolate the profile-switch
case and its identity response before choosing a fix. Transfer-focused runs did not log this rejection.

2026-10-09: A366-3A's A11 `pnpm --filter @waitron/till exec vitest run` also logged this
rejection from `#switchProfile` and reported 5,897 passing tests. That run does not establish its
cause; retain the investigation above. Local receipt: Lane E's `receipts/a366-3a/a11-till.log`.

2026-10-09: A366-3A's A13 affected-file run (`pnpm --filter @waitron/till exec vitest run`,
with the seven files named in `~/waitron-campaign-e/receipts/a366-3a/a13-final-family.log`)
reported 1,406 passing tests and logged the same rejection from `#switchProfile`. The cause
remains unverified.

2026-10-09: A366-3B's affected-file run reported 1,373 passing tests and logged the same
`#holdIdentity` rejection. Receipt: Lane D `receipts/a366-3b/b4-consumers.log`; no profile-switch
fix or new cause is claimed.

## A card payment stuck `attempting` holds its device's profile switch

Left open by W97 (#1311), found in its review and not fixed on the branch:

- A card payment stuck `attempting` holds its device's profile switch until a manager resolves
  it on Payments; an `initiated` one has no production writer today, and once hosted payments
  are wired a missed `checkout.session.expired` webhook would hold it for good
  (`assertNoPaymentInProgress`, `apps/server/src/device.ts`). The till only says to switch
  once it finishes; point it at the Payments screen.

## The till's Profile button shows whenever the device has more than one approved profile

Left open by W97 (#1311), found in its review and not fixed on the branch:

- The till's Profile button shows whenever the device has more than one approved profile, read
  at boot: neither approvals added later nor the signed-in person's admission hide or show it
  until the dialog reads `/api/device/me` again. Approvals stored on a disabled device come
  back when it is enabled again through a join (unchecked whether that is wanted).

## The profile editor reads people and the venue's departments and zones

Left open by W97 (#1311), found in its review and not fixed on the branch:

- The profile editor reads people and the venue's departments and zones, so it needs
  `person.manage` and `venue_service.manage` beside `layout.configure`; no role holds only the
  last today. Edit and Duplicate fail with a read error when the departments and zones read
  fails, and its lists do not update while the editor is open.

## Owner questions, each with the default built (answer when convenient)

Left open by W100 (#1332), the [equipment plan](../superpowers/plans/2026-10-04-device-equipment-and-independent-drawers.md):

- **Removed: staff can no longer switch a device's printing off.** The till's "No printer"
  choice is gone and the dashboard's empty choice now means Use default, so a device is without
  a printer, reader or drawer only when its profile's default is None (owner question Q1
  below).
- **Not shown: whether equipment is disconnected.** The till says an item is switched off when
  a printer is disabled or a reader is disabled or unpaired; nothing stores whether a printer or
  reader is online (Q7).
- Owner questions, each with the default built (answer when convenient):
  - Q1. A device cannot override its profile's default with "none" — owner question, default
    built.
  - Q2. A card reader is never shared by several devices at once; every reader has one holder —
    owner question, default built.
  - Q3. A payment stuck "attempting" (started, outcome unknown) after a crash keeps its reader
    busy until the sweep or a manager resolves it — owner question, default built.
  - Q4. QR labels are decoded with the `jsqr` package, not the browser's own decoder — owner
    question, default built.
  - Q5. Card readers have no location, which does not matter while a venue has one location —
    owner question, default built.
  - Q6. "One payment in progress per reader" is not a database rule: the checks stop another
    device, not the holding device starting two payments at once — owner question, default
    built.
  - Q7. Disconnected equipment is not shown (above) — owner question, default built.
  - Also as built: a till's equipment list (`GET /api/device/equipment`) needs only a joined
    device, not a signed-in person, so a locked till can see who holds an item on another
    device (staff names are already public through `/api/staff`).

## Table states and signals (A267)

- **Table states and signals (A267) — OPEN, needs a design session (owner, 2026-10-03).** Which
  states and signals a table has that Waitron sets itself (today Free, Occupied, Reserved from a
  booking, Needs clearing, Bill requested and the kitchen signals), which a venue can switch off,
  which customers can trigger (asking for the bill or calling a waiter from a QR code), whether
  marking a table reserved by hand becomes a built-in action, and whether the hand-set labels on
  Venue settings › Tables are still needed after that — the owner expects they may not be, and if
  they stay, they sit beside a table's state as labels rather than being states. From A261 §10.

## The till's menu reads (Task 7, #719)

- **The till's menu reads (Task 7, #719).** Every `/api/menu-state` poll waits its turn in the
  write queue, because the route and `requireSession` (`apps/server/src/till-session.ts`) read
  inside `withTransaction`; reading outside a transaction would skip the queue but give
  `menuState`'s queries no single consistent view, and there is no read-only transaction
  (`packages/db/src/tenancy.ts`). A
  till learns of a change only by polling, because the dashboard's live-update route accepts the
  management cookie only; a till-session branch there would let the server tell tills (plan D11), a
  later refinement. The basket comparison does not notice a publish that adds a required options
  list to a dish in the basket, or lowers a list's picks limit, so the till takes the new version
  silently and the server then refuses `options.label_required` (or `extras.limit_exceeded`): staff
  see a refusal where the dialog should have asked.

## Every remembered round is marked again against the open table's menu

- **Every remembered round is marked again against the open table's menu**, so opening a table in
  another service zone can mark another table's round wrongly or clear its mark. Read, not run:
  `#markedRounds` in `apps/till/src/till-app.ts` holds every store refused sold out or after a menu
  change, drafts included, and `#markRounds` marks each against the open table's offers; whether a
  store from an earlier table is ever shown again was not checked. Remember each round's zone, or
  keep rounds on the app, one per order.

## The till's home page (Task 9, #729)

- **The till's home page (Task 9, #729).** Search matches the staff name only, not a customer name;
  Matching displayed section names is included (A461). Every `/api/menu-state` read from an enrolled device reads the device, once
  per zone the till holds at each poll; the token's scrypt check (21.1 ms, measured once on a Mac)
  runs off the lock, once per device until its token changes, the server restarts or the device
  falls out of the 256 the server remembers.

## The till says "Not found" (menus spec §9) only when a newly read version drops the section it has open

**The till says "Not found" (menus spec §9) only when a newly read version drops the section it has
open.** §9 asks that a tap on a home tile whose target is no longer in the version the device should
be showing say the item was not found and reload the home screen. As built, the till puts a newly
read version on screen as soon as it has read it (pinned by "a device behind the live version (§9)"
in `apps/till/src/till-app-menu-refresh.test.ts`). Before then — up to one 15-second poll, longer on
the counter while a sale, hold or place is in flight or the review dialog is open, and longer again
when a reload fails — a tap acts on the version it holds, and the basket refresh lists the product
as "no longer on this menu". A shortcut whose target a newly read version lacks simply disappears,
with no notice. **Next action:** the owner confirms this meets §9, or asks for a notice when a
shortcut disappears.


## The owner decided a split check gets no Void; the server now allows one

**The owner decided a split check gets no Void; the server now allows one.** Since table-actions
Task 2 (#825) the cancel path checks `assertPartyBillOpen` (today in `applyAdjustment`,
`apps/server/src/adjustments-apply.ts`, which replaced `voidTabLine` in B11a), which lets through
an open bill that belongs to a party whether or not a table points at it, and a split check carries
its party. **Decided (owner, 2026-09-26):** a check
gets no Void; a change of mind between "Add bill" and paying was covered by the till merging the
check back. Since table actions Task 10 the till no longer merges it back on its own; a change of
mind is undone by Merge bills on the party's table screen, by hand. **Next action:** the owner
decides whether that still covers the no-Void decision.

## A custom-unit extra still shows a dot in Spanish, and its kitchen unit can use the English abbreviation

- **A custom-unit extra still shows a dot in Spanish, and its kitchen unit can use the English
  abbreviation** (observed during A333, 2026-10-08). On the real Spanish-seeded till, the salad
  picker reads `1.00 rac`; its queued receipt reads `1.000 rac`, and its queued kitchen ticket
  reads `1.000 srv`. **Next action:** trace the portion formatting and kitchen-unit language
  choice in `apps/till/src/widgets/modifier-picker.ts`, `apps/server/src/receipt-lines.ts` and
  `apps/server/src/kitchen-print.ts`; establish the intended kitchen wording, then test-first
  localize the affected quantities. No change to those renderers in A333.

## Reopening the picker on a line whose dish has VARIANTS _and_ at least one offered list loses the variant, and says it saved

- **Reopening the picker on a line whose dish has VARIANTS _and_ at least one offered list loses
  the variant, and says it saved.** Measured with a throwaway browser test: no variant radio is
  selected, because `willUpdate` never seeds `variantId`, and when the operator picks one,
  `setLineModifiers` (`apps/till/src/state/working-order.ts`) discards it. Needs a decision first
  about whether a basket edit may change a variant AT ALL: if no, stop offering the variant control
  on a reopened line; if yes, `setLineModifiers` has to carry the product.

## Reopening a held order still removes a sold-out extra on the first edit

From **Variants as products (#511–#556) — what is left open.** How the model works is in
[products.md](../developers/products.md), under _Variants_.

- **Reopening a held order still removes a sold-out extra on the first edit.** The owner chose
  option A on 2026-09-23 (lane B question Q1): keep a sold-out line in held work, flag it on the
  till, and refuse only a quantity increase. The till now keeps such a line marked "Not offered
  now"; a line with no stored snapshot whose product the till no longer offers is still dropped with
  `held.product_gone`, and the first edit of the order removes such an extra.

## Decisions and deliberate limits

- **A guest count typed in the Guests or Split a table window replaces a count another till saved
  while the window was open, once this till has received that change: the last count saved wins,
  with no warning (A715, owner 2026-10-15).** Asked whether such a save should be refused so the
  waiter sees the other count first, the owner answered "(a) keep it — the last count saved wins".
- **Guests: the waiter changes the count at any time, joined tables add their counts, and only Split
  a table asks again (A713, owner 2026-10-15).** Owner's words: "add joined counts. the waiter should
  always be able to update the number of people sitting at a table. when they split, the waiter
  should update each table's seats as well", then, asked which split: "only splitting a table". So the
  order screen's Guests sets or clears a party's count (`PUT /api/parties/:id/guests`); when one
  party combines into another (Join, or Move guests onto a seated table) the survivor's count becomes
  the two added together, or none when either is unknown or the sum is over 999 (`combineParties`,
  `apps/server/src/table-actions.ts`); and Split a table opens a window asking each side's count
  before the split goes through. A bill split by item has no count of its own, so it prints no guests
  line. A bill moved to a free table still starts a party with no count; the waiter sets it with
  Guests.
- **An emptied name field says what it goes back to only as its placeholder (A665, owner
  2026-10-14: "leave it").** Owner 2026-10-14: the name windows show what an emptied field goes back
  to as the placeholder only; no hidden description for screen readers. The windows are the till's
  party Name window and the floor's Rename window (since A643, #1692, and A658, #1698); what a
  cleared field goes back to is the table list, or the group's normal name.
- **Back to saved place and a rename for today tell the kitchen only when an order lost a place
  (A606 and A650, owner 2026-10-14, overturning A581 part 2's default).** The owner ruled that a
  table sent back from a group a party sits at tells the kitchen (A606), and that a rename for
  today does too (A650 ruling 1). After finding a slip for Bar leaving a named group misleading,
  the owner ruled the same day on what counts (A650): a MOVED slip only when an order left one of
  its tables, a place name on its kitchen paper is no longer one of its places, or its dishes are
  on an order with another number (`kitchenToBeTold`, `apps/server/src/kitchen-print.ts`). So
  Table 9 back to its saved place, ending the group of two named "García birthday", prints
  `From: García birthday` / `To: Counter 6, Table 9`; Bar back to its saved place inside a named
  group prints nothing, as the party keeps every table and the name; and an unnamed group of two
  ended the same way prints nothing
  ([plan](../superpowers/plans/2026-10-14-a650-moved-slips-design.md)).
- **The table screen shows no "(was N)" (A650 question A, owner 2026-10-14: the default kept).** A
  party's bills stay named "Ana · Bill 1" with no order number; "(was 28)" shows where numbers
  already show, such as the Pass screen, because a waiter answering a kitchen call looks there
  ([plan](../superpowers/plans/2026-10-14-a650-moved-slips-design.md) §8).
- **The "needs clearing" window names the one table it clears (A581 part 3, coordinator decision,
  2026-10-14).** A table renamed for today reads "Window needs clearing"; a table in a group, named
  or not, keeps "Table Counter 4 needs clearing", never the group's name, because Mark cleared
  clears only that table (one `tableId`, one row on the server). Owner may overturn it.
- **A refusal not about the name stays in the Rename window (A638, owner 2026-10-14, overturning
  A581 part 4's decision to close the window).** "The floor has changed" or any other refusal shows
  at the window's foot and keeps what the waiter typed, so Save can be pressed again, as Split
  tables… and Reset table do; a name in use or too long stays under the field. The window still
  closes when its table leaves the floor read, stops offering Rename or its group changes, and a
  refusal shown in it then moves to the floor (`#rename` and `willUpdate`,
  `apps/till/src/screens/till-floor-screen.ts`).
- **A joined table replaces a saved join (A503, owner 2026-10-11).** A table made of other tables
  is set up in the floor plan editor and starts each day as one table; the till splits it and joins
  it again, and the reset puts it back whole once its tables are free
  ([design](../superpowers/specs/2026-10-12-a503-joined-tables-design.md)).
- **The floor plan editor's booked reason stays in the dashboard's own strings (owner,
  2026-10-10).** "Booked 12 Oct, 21:00" is worded in the dashboard's core strings, not the bookings
  module's, because the module code-message route takes no parameters.
- **A floor plan seat error keeps showing while the person types (owner, 2026-10-10).**
- **A taken-off table's place is kept only while the editor is open (A502, coordinator decision).** Pressed again, a
  table taken off the plan goes back to the same place for as long as the editor stays open on
  that zone; the place is not saved.
- **Shift+arrow keys resize the selected table on the editor's plan (A502, coordinator decision).** Only the
  selected table resizes, so only it carries the keys' description
  ([design-system.md](../developers/design-system.md)).
- **The floor plan editor's header runs Undo, Redo, Cancel, Save (A502, owner, 2026-10-11).**
  Cancel sits beside Save, after Undo and Redo, as the owner's [mockup 1](mockups/a502-a503-floor-plan-editor/1-editor-table-selected.png) puts it: an
  exception to Cancel on the left ([design-system.md](../developers/design-system.md)).
- **A turned table's size dots stay on its own sides (A548, owner, 2026-10-12).** At every angle the
  dots sit on the table's own sides, diagonal on a 30° table; only each dot's cursor follows the way
  it drags on screen.
- **A drag's cursor overrides the page's own cursor rules until release, short of the limits below
  (A642, owner 2026-10-14, overturning A580's limit that an element with a cursor rule of its own
  kept it).**
  A dragged size dot's arrow and row reordering's grabbing hand both go through one shared seam
  (`holdPageCursor` and `releasePageCursor`, `packages/ui/src/reorder-table.ts`). The first hold adds
  a style sheet that sets its cursor `!important` on every element to the document and to every
  open shadow root on the page at that moment; the last release takes it out of each again. A
  shadow root attached after the drag starts does not get the sheet: an element there with a cursor
  rule of its own keeps it unless that rule reads `--reorder-drag-cursor`. An element's own
  `!important` cursor rule can still win over the sheet.
- **Individual tables keep the later floor contract (A435 step 6, 2026-10-11).** Delete is a master
  draft edit with Undo until Save; today's release remains deferred. There is no table active flag
  or immediate table write route. Labels remain unique across the location. Hierarchy Delete is
  separate and removes saved/today/reset state after refusing live work. Only terminal booking
  and delivery table pointers may release with copied labels; recorded fiscal, sale, receipt,
  order/line context and finished transfer facts stay. See the
  [reconciliation](../superpowers/plans/2026-10-11-a435-6-tables-zones-departments-delete.md).

- **The old small floor-token work waited (owner, 2026-09-30, C82).** The owner said "wait on
  this" about its cramped labels, party names and chips. A429 slice 5 removes that map and its
  capacity-based sizing. On 2026-10-11 the surviving tray was looked at with `Terrace 123`,
  `The Fernández family`, six seats, twelve To serve and `1234.50`, in EN/ES, both themes,
  at 390 and 1280 px. Those captured tokens held their text and four-digit total; the two old
  layout entries are retired. Screenshots: `~/waitron-campaign/a429-5-shots/final-tray-crowded-*`.

- **Floor plans use two separate plans (A429, owner 2026-10-08).** The dashboard edits the master;
  the till works from today's copy. Service changes affect that copy. Table creation and renaming
  belong to the master editor; reserve tables supply today's spares. See
  [the design](../superpowers/specs/2026-10-08-floor-plan-design.md) and
  [the plan](../superpowers/plans/2026-10-08-floor-plan.md) for the approved decisions.

- **A presented bill moved to the counter keeps its recorded zone (A440, 2026-10-09, chosen in
  the branch's plan review, not an owner ruling).** A presented bill takes the new zone when it
  moves with its party, into another party or to a free table, but moving a bill to the counter
  re-zones only an open bill (`moveBill` in
  `apps/server/src/move-bill.ts`). A bill moved to the counter has no party, and with no delivery
  table the kitchen side (`orderWatchZones`, `apps/server/src/watch-zones.ts`) reads its recorded
  zone, as the till's zone limit does (`findOrderZones` via `apps/server/src/zone-access.ts`), so
  the two agree. Re-zoning a presented table bill into a counter zone whose orders are paid after
  sending (`ticket_then_pay`) would also let it be handed over before payment, as a counter order
  sent and unpaid is (`sentUnpaidCounterOrder`, `apps/server/src/working-order.ts`).

- **Part of a weighed line stays refused (Task 11, owner 2026-09-30).** Part of a weighed line
  stays refused for a give-away or a discount (`adjustment.weighed_partial`); staff discount the
  whole line instead.

**What the till shows the NEXT operator when the previous one's request answers late; no
change (owner decision 2026-09-23; PR #536).** The ticket belongs to the TILL, not to the operator
who started it, so a late result shown on that device after a change of operator is right; the
payment belongs to the table, so no payment is lost.

- **Service, ordering and billing.**
  [Design](../superpowers/specs/2026-09-20-service-ordering-and-billing-design.md) (#693);
  [plan](../superpowers/plans/2026-09-26-service-ordering-and-billing.md), eighteen tasks;
  Task 0's [bill payments design](../superpowers/specs/2026-09-26-bill-payments-design.md)
  (#698). Every task has landed: Task 1 #706, 2 #715, 3 #733, 4 #748, 5 #750, 6 #761, 7 #789,
  8 #806, 9 #814, 10 #908, 11 #916 (with lane B's B11a–B11g), 12 #923, 13 #903, 14 #721, 15 #956,
  16 #981, 17 #991. "Visit" is "party" everywhere since the table actions plan.

- **Task 10 (#908, the service dashboard's attention signals).** Defaults the branch chose, sent
  to the owner as an FYI (not the owner's rulings):
  - A bill request is cleared only when a PAYMENT leaves the party's family with nothing to pay;
    other ways of leaving nothing owed keep the request until staff press Cancel or Finish table
    closes the party.
  - Merging a party that asked for the bill into another drops its request.
  - The long-wait chip counts only dishes sent to the kitchen, not held ones.
  - The floor's to-serve, ready and long-wait figures include paid bills and the bills of
    parties merged in, so a venue that never records serving sees a paid table's dishes as
    waiting until Finish table.

- **Task 15 (#956, several payments on the till).** Open:
  - **Owner call on wording:** the table's button is labelled with the whole sentence "Part of
    this bill is already paid: take the rest as a bill payment", while the counter's says "Take
    the rest". Left as it is.
  - Giving money back after the invoice stays out of scope for `BillPaymentView` (bill payments
    design §6).

Owner decisions (2026-09-26), each in the spec where it applies:
- groups replace named courses, and who may release a held group stays a venue setting;
- a party record ties a party's orders and bills (joined tables and merged parties included) and
  keeps the table occupied until Finish table;
- a bill's invoice is issued when it is fully paid, several payments may come before it, and lines
  can still be split off after a contribution;
- discounts reduce the line, comps show at €0.00 with the original price, and weighed items take
  discounts to the nearest cent; _(2026-09-30, C90, #932: the receipt now prints the dish at its full
  price with the comp or discount on a line of its own beneath it.)_
- an item is credited to whoever owns the draft when it is submitted, and adjustment rates are
  measured against those credits.

Out of scope for this plan: guest access, inventory, seat and staff assignment, changing the floor
layout during service, screen plugins and Bizum.

- **Task 3 (#844, a table needs clearing, not its party). DECIDED (owner, 2026-09-29): keep the
  plan's P9** — a stale Mark cleared from a floor screen that had not refreshed is accepted, even
  when it frees a table a LATER party has left.

- **Two modifier-picker states, and how far each is actually out of reach** — a fact worth having
  before anyone writes a test claiming to cover them. An options label marked unavailable never
  reaches the picker at all: the served offer and the till's menu-state poll replace a default that
  is missing or names an unavailable label with the first available label in the published
  version's order, or with null (`effectiveDefaultLabelId`,
  `packages/catalogue/src/option-default.ts`; `withUnavailable`,
  `apps/till/src/state/menu-refresh.ts`), and the till filters unavailable labels out before the
  picker is given them (`sellableModifiers`, `apps/till/src/api/client.ts`) — traced through the
  code, not run. An over-cap count is different: stepping cannot produce one, because `#step`
  clamps, but a REOPENED line is seeded straight from `initialSelections` with no clamp, so
  `#allSatisfied`'s `total <= entry.maxPicks` arm is reachable (run in the till's browser harness on
  2026-09-21: a picker seeded with 5 of one product on a list whose `maxPicks` is 2 renders a count
  of 5 and a disabled Add). The real-world shape is a parked line whose list had its cap reduced
  under it.

- **A profile switch or a zone move that commits while a till write is in flight does not stop
  that write** (found by the finish-branch run-it review, 2026-10-06; for the owner, not fixed
  on the branch). (i) A till write route checks the profile's action before its write
  transaction opens (most routes before reading the body, too), so the request writes under the old profile's
  actions: with a delayed request body, a switch to a profile without `take-orders` still
  saved the order, answered 200. Checking outside the write transaction predates W97 for the
  older checks: on `main`, `assertTakesCash` and `assertDeviceCapability` also run before the
  route's write transaction, and on `POST /api/pay` before the body read. (ii) The routes whose
  work runs in a helper that opens its own transaction call `gateZones`
  (`apps/server/src/zone-access.ts`) before that transaction — chosen in Task 4 to avoid a
  second turn in the write queue — so a zone moved to another department in between is still
  written: with a delayed order-update body, a zone moved to Deli still answered 200. **Owner
  decision (2026-10-06 ~23:50): accepted, not to be fixed** — a write already reaching the
  server when the switch or move commits is treated as having arrived first, so the checks stay
  outside the write transaction. A307 (#1319) checked what a zone move or profile switch decides from
  the state present when it commits. A zone move (`configureZone`,
  `packages/venue-service/src/operations.ts`) decides nothing from it. Ending the sessions a new
  profile does not admit, every one on a kitchen screen (A298), holds: the PIN sign-in re-checks
  the device and the person's admission inside its own transaction, and
  `apps/server/src/join-e2e.test.ts` pins a sign-in overtaken by a move and by the till's own
  switch. The refusal while a card payment is in progress did not hold: a payment could start
  after the switch committed. Now the provider's write of the `attempting` row refuses
  `device.profile_changed`, charging nothing, when the device is no longer on the profile the
  request was checked under (`insertAttempting`, `packages/payments/src/store.ts`; SumUp and
  Stripe terminal only). A bill reader payment refused this way is marked failed at once
  (`takeReaderBillPayment`, `apps/server/src/bill-payments.ts`), so its amount is not held, and
  the till's next confirm sends a new request id, which the server checks under the device's
  new profile.

- **As built by W101 (departmental tab transfers, #1351):** Unsent counter edits and standalone
  table drafts are retained as read-only local copies for explicit review and dismissal, rather
  than silently lost or resubmitted. These copies remain in browser memory across sign-out;
  reloading the page loses them. Removing a sending direction prevents new requests and leaves
  existing pending intent actionable; it does not revoke requests already sent. Party-linked bills
  are refused before queuing, and again at acceptance, rather than moving shared table/group links.

**A section a diet filter empties keeps its place on the till (A297, #1317, owner 2026-10-06) — DONE.**
**Decided (owner, 2026-10-06):** such a section stays, faded and not openable, in the structure, as
a shortcut and inside an open section; if it is the section that is open, the till still says "Not
found" and shows home. A section left with nothing because every product in it was Inactive when
the menu was published or is published as not sold separately still leaves the structure, and a
shortcut to it draws an empty slot (`indexMenu`, `apps/till/src/widgets/menu-browser.ts`). A section
whose products are all sold out keeps its place, and its tile is not greyed; the products inside it
are.
