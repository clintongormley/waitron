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
  the fixed handheld mount and table screen still need their redundant exit configuration audited;
  the tab shell and the supervisor dialog emit events not named `wt-*` (CLAUDE.md §3; not checked
  whether the rule reaches till widgets).

## The till always mounts the counter screen `embedded`

- Found by #614 (`apps/till/src/screens`), not fixable in a comments-only change. Read, not run:
  the till always mounts the counter screen `embedded` (`apps/till/src/till-app.ts`, the
  `<till-counter-screen>` in its render), so the screen's own header — its Allergens, Floor,
  Station, Expo, Schedule and Log out buttons and its allergen toggle — is reached only by the
  screen's own tests; its fixed mount passes `embedded` and
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

## A booking or a seated party can count more than 999 guests

- **A booking or a seated party can count more than 999 guests, which a simplified receipt
  recorded since A663 Part 3b never prints (found by Part 3b).** `createBooking` and
  `updateBooking` refuse only a party size of 0 or less (`booking.invalid`,
  `packages/bookings/src/bookings.ts`), and seating a booking hands that size to `seatTable`
  (`apps/server/src/parties.ts`) as the party's guest count without a bound; the `parties` table's
  check asks only for 1 or more. The till's own guest-count fields, and the count stored for a
  simplified receipt (`sale_receipt_guests`), take a whole number from 1 to 999
  (`isValidGuestCount`, `packages/shared/src/guest-count.ts`). A full invoice, and a sale recorded
  before Part 3b, read the party's count with no bound (`readReceiptGuests`). When a sale is
  recorded for a party above 999 with no count chosen, its simplified receipt stores "no line"
  instead of the party's count (`storableDefault` in `recordReceiptGuests`,
  `apps/server/src/receipt-guests.ts`), so that receipt prints no guests line where Part 3a would
  have printed one. Decide whether bookings and parties take the same 1 to 999 bound.

<a id="five-till-handlers-still-leave-a-failed-list-refresh-unhandled-and-one-a11y-file-may-not-render-its-screen"></a>

## Two till handlers still leave a failed list refresh unhandled

**Two till handlers still leave a failed list refresh unhandled — OPEN (found 2026-09-25, review of PR #641).**

- `#onRetrieveOrder` awaits `#refreshHeldOrders()`, and `#onAdvanceTicketItem` awaits
  `#refreshStationQueue()`, in `apps/till/src/till-app.ts`, each after its `try`/`catch` and
  outside it, on both paths, after a success and after a failure. A failed refresh there is an
  unhandled promise rejection and the operator sees nothing. Retrieve writes nothing, so an "X
  succeeded, but…" message does not fit it.

**Next action:** decide whether advance goes through `#refreshAfterWrite` with its own "X
succeeded, but…" string, and what retrieve shows when its refresh fails.

## Cash handed back for a voided cash sale is recorded nowhere

**Cash handed back for a voided cash sale is recorded nowhere — OPEN (found 2026-09-24 by #605).**
A void writes no payment or refund row, so if staff give a customer cash back, the void's day shows
a drawer shortfall at cash-up. No till screen or server route calls `recordVoid` yet, so nothing
can do this today. **Owner decision 2026-09-25:** keep it here and decide it when the till's void
screen is designed.

## A re-sent "place" on an already-placed order answers 409 rather than replaying the original result — leave it, or build the replay?

**Product decisions to take before production:**

- **A re-sent "place" on an already-placed order answers 409 rather than replaying the original
  result — leave it, or build the replay?** Since invoicing at placement was retired (A261-2c,
  #1285), placing files no invoice: `placeOrder` (`apps/server/src/working-order.ts`) marks the
  order placed, sends its dishes to the kitchen and, in a `ticket_then_pay` zone, queues its
  collection ticket. A second place on a placed order is refused `working_order.not_open` (409).
  Leaving it is a real option — the 409 is a defensible state conflict and the till keeps the
  basket and shows `place.error`. The gain if built is that a re-tap after a lost response moves
  the till on as placed instead of showing an error. The place-path comment in
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
  Since A737 Part 1 (2026-10-16), Find a bill stays in More at every width; the other actions
  retain that priority and the current contract is in `design-system.md`.
  - **Open, decided as built:** a change in the pending-transfer count alone never brings items
    back onto the bar, so when the count shrinks or goes away, items can stay in More although they
    would now fit, until the next resize or other change refits the bar.
  - The header implementation and suites now live in `widgets/till-shell.ts` and
    `widgets/till-shell.test.ts`. The measurements and deletion controls below refer to their
    earlier source; re-run each control against the extracted shell before relying on it.
  - **Open: the timing-variation header tests spend most of their time waiting for frames.** The "fits as a fresh bar does when
    …" cases in `apps/till/src/widgets/tab-shell.test.ts` (added by #1435) took 7.9–15.7 s on the
    owner's Mac on 2026-10-10 while other lanes ran, and the "name grows, then the transfer count
    changes" case timed out at 15.4 s both before and after A425's order change. Find what makes
    them slow rather than raising the limit. A737 Part 1 (2026-10-16) measured reset/final waits
    of 70–267 ms in a local probe and splits the same 0–40 microtask cuts into smaller cases,
    retaining the 15 s limit and every layout assertion. The frame-wait cost remains to investigate.
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
on the plan at its kept size, shows no visible name (A503 part 3's look, shots
`8-counter3-put-back-*`). Since #1604 a table comes back at its kept size rather than 8 × 8, so this
is seen more. A672 decided its handles: a selected 2 × 2 shows its four corners and no side dots.
Next: its name waits on the same decision as A561, in `wt-floor-plan-canvas`.

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

2026-10-16: A671 replaces the Add button placement and column arrangement. Their current contract
is in [design-system.md](../developers/design-system.md#departments-and-zones). The remaining open
work here is the inline Made of picker and how its parts wrap.

## A turned floor plan table narrower than its unturned box stops short of the plan's left or top edge

**Left open by A672 (2026-10-16).** A table's saved x and y are its corner before it is turned, and
neither goes below 0 (`stepInside`, `packages/ui/src/floor-plan-geometry.ts`; `checkPlacement`,
`apps/server/src/floor-plan.ts`). So a table that is narrower turned than unturned, such as an 8 × 4
turned 90°, stops with a gap at the plan's left or top edge (2 squares for that table). At that edge
a growth of several squares can end differently from the same growth a square at a time, and a
growth then the same shrink need not put the table back
(`packages/ui/src/floor-plan-geometry.test.ts`, "is not reversible square for square at the edge").
Owner question asked 2026-10-16: (a) keep it so, which is what A672 built; or (b) let a saved
position go below 0 so the turned outline can touch the edge, a separate job in which the database
and the server accept a wider range. Pictures:
[keep the gap](mockups/a672-floor-plan-canvas/q4-a-keep-gap.png),
[below 0](mockups/a672-floor-plan-canvas/q4-b-below-zero.png). Next: the owner's answer.

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

## A504. Floor plan sets, one per service period

**A504 (owner, 2026-10-11; design revised to the owner's answers of 2026-10-17).** Design:
[2026-10-17-a504-floor-plans-design.md](../superpowers/specs/2026-10-17-a504-floor-plans-design.md);
pictures in [mockups/a504-floor-plans/](mockups/a504-floor-plans/).

- **Floor plans get a page of their own (owner, 2026-10-16).** What is edited is a named set of
  floor plans, one layout per zone, per department, and a period picks the set it uses; an empty
  choice means the department's default set. The departments table's per-zone floor-plan link
  (`packages/venue-service/src/dashboard/departments-list.ts:236-240`) goes when that page lands. A504
  adds the Floor plan column to the Periods window and the field to the period dialog.
- **A change of layout is offered, never applied by itself (owner, 2026-10-17).** When a period
  ends, or a dashboard change makes another layout due, the till shows a banner with Update layout;
  tables with guests show "Needs moving" once free, and move on the map when marked moved.
- **On a phone, List goes into the floor's ⋮ menu (owner, 2026-10-17).**
- **No publication dates for layouts** (owner, 2026-10-17, dropping the 2026-10-11 wish). A change
  that comes back every year is done with seasons.

Next: the plan. Build after A719 (landed), and before or after the A760 migration squash, never
across it.

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
  - **A placed pay-later counter order (a `ticket_then_pay` zone's, sent to the kitchen before
    it is paid) cannot be adjusted:** the placed-order trigger freezes its prices. B16 lets such
    an order be handed over before it is paid but did not decide this. **Next action:** decide whether a placed order can be adjusted before it is
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
  - At login the counter's three lists are read one after another, so a read that hangs delays
    the rest (left open by B31, #1018). Load them side by side.
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
  - **Task 7 (#864, move a whole bill).** The move moves the bill's revision on, open or
    presented, without `bumpRevision`'s refusal of money in flight, since a move changes no amount
    (plan P19): a decision, recorded under Decisions and deliberate limits.
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

2026-10-16: A668-5 retires the basket, station queue and expo warning reads and removes their
three guard exceptions. The remaining scope is `apps/till/src/widgets/diet-badges.ts`: warning
and success text tokens at lines 131 and 117, respectively. The paragraph below records the
original finding; its four-surface count and five-entry list no longer describe the current tree.

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

- **Design the fixed screens for each kind of device (A182 part 1, owner 2026-10-01).**
  Start from the screens in `apps/till/src/screens/` and [the fixed-screen contract](../developers/design-system.md#fixed-device-screens).
  Decide how each workflow fits narrow and wide screens and what a venue may choose per device.
  Counter's remaining owner-approved redesign is A738–A739. The handheld, kitchen screen and pass need
  their own designs. Menu Device Home Page, receipt configuration and the floor-plan editor stay
  separate. The owner's screen-designer decision is retained under Decisions and deliberate limits.

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

2026-10-16: A739a's `pnpm --filter @waitron/till exec vitest run src/till-app.test.ts`
reported 961 passing tests and logged the same `#holdIdentity` null-identity rejection. The
triggering case and cause remain unverified. Local receipt: Lane F's
`receipts/a739a-outcome/controller-all.log`. No profile-switch change was made.


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
  per zone it polls (the counter's, and the open table's while its order shows), and each read also
  reads the till's setup (`readTillSetup`, `apps/server/src/till-setup.ts`) to name `setupRevision`; the token's scrypt check (21.1 ms, measured once on a Mac)
  runs off the lock, once per device until its token changes, the server restarts or the device
  falls out of the 256 the server remembers.

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

## A752. Device profile form: an empty starting-zone list and errors that cannot be cleared

**A752 (owner, 2026-10-16).** Seen on the Santet venue: a device profile's "Where it serves" with
department Santet Deli Co and "Every zone in this department" switched on. The Starting zone
dropdown says "No results", and the form shows two errors nobody can clear: "Choose at least one
zone, or switch on Every zone in this department" (the switch is already on) and "Choose the zone
a device starts in" (there is nothing to choose).

In a copy of that venue's database taken on 13 October, all five zones (Counter, Front Bar, Main
Bar, Saloon, Terrace) are active and every one has a `zone_service_policies` row naming that
department, so the list should not be empty. The form lists a department's zones with
`activeZones` (`apps/dashboard/src/screens/device-profiles-screen.ts:271`), filtering the reply of
`GET /management-api/venue-service/departments-and-zones` by `departmentId` and `active`. Which
side loses them was not traced.

1. **Find why the list is empty** — a failing test first, through the real route.
2. **A department with no switched-on zones says so**, and where zones are added, instead of
   asking for a switch that is already on.
3. **The starting zone is not marked as a required error when there is nothing to pick**; the
   department's message covers it.

The form's two "?" buttons, beside Department and Starting zone, are A237 candidates
([setup.md](setup.md#remaining--buttons-that-should-be-hints-a237-owner-2026-10-03)).

## A757. Table states: review the lifecycle, then retire the Tables tab

**A757 (owner, 2026-10-16) — design first; it comes back to the owner before anything is built.**

**Design (2026-10-17, revised the same day after the owner's answers to Q15–Q20):** [the lifecycle,
one order of precedence, how each state is shown on the card, the map and the zone tabs, service
steps, and six new owner questions, Q29–Q34](../superpowers/specs/2026-10-17-a757-table-states-design.md),
with [mock-ups](mockups/a757-table-states/). Nothing is built until Q29–Q34 are answered and A756
has landed.

Today Venue settings' Tables tab (`apps/dashboard/src/screens/service-status-screen.ts`) holds two
things:

- **Needs clearing, on or off for the whole venue** (`service_settings.clearing_workflow`,
  `packages/venue-service/src/schema/settings.ts`). When on, a table a party leaves shows "Needs
  clearing" on the till's floor until someone taps "Mark cleared".
- **Statuses the venue makes up** (`table_service_statuses`,
  `packages/db/src/schema/table-service-statuses.ts`): a label and a colour. A waiter puts one on a
  table from the till's table screen (`apps/till/src/screens/till-table-order-screen.ts:2558`); a
  table carries at most one (`dining_tables.status_id`), and the floor shows its colour. They sit
  beside the lifecycle the till works out itself — Free, Reserved, Seated, Needs clearing — and
  change none of it.

Decided (owner, 2026-10-16):

- **The Tables tab goes.**
- **Optional states are switched on or off per department**, in the department dialog's Service
  tab (A756), "Needs clearing" among them.
- **An optional state is one the code understands** — it knows when the state can appear and what
  clears it — rather than a label a waiter puts on any table. The owner said "maybe", so the review
  confirms it. Example: "Bill requested" could appear only on a seated table and clear when the
  bill is paid.

The review: write down every state a table goes through and what moves it between them, including
the states A508's table QR code would add (call a waiter, bill requested); say which are optional;
decide what becomes of the statuses a venue has already made. It comes back with the lifecycle
drawn out and a recommendation. The open note that the Tables tab's colour field label is cut to
"C…" at 390 px goes with the screen.

**Widened 2026-10-16 (owner): how each state is shown, on the floor and in the order lists.** The
board shows every state as it looks today beside a proposal, for the owner to choose. Today a table
can carry the signals `take_order`, `ready` (per station), `long_wait` (warm, overdue, forgotten),
`held_unavailable`, `bill_requested`, `unsent_draft`, `release_due` and `needs_clearing`
(`apps/server/src/table-signals.ts`, chips in `apps/till/src/widgets/signal-chips.ts`), besides
seated, joined, paid and taken off. Three additions the owner asked for:

- **Items held in the kitchen.** The floor marks a held group only when its release reminder is
  due (`till-floor-screen.ts`, the `reminderDueAt` check); a table with held groups and no due
  reminder looks like one with nothing held. Mark every table with held items; a due reminder keeps
  a stronger mark.
- **Late orders pulse.** Decide which of warm, overdue and forgotten pulse; the same pulse as A738's
  Waiting tab; a colour change instead under reduced motion.
- **Item counts by state in the order lists.** Held orders' rows read "4 · €24.50", where 4 is the
  number of LINES (`itemCount`, `apps/server/src/working-order.ts`), unlabelled. Show instead the
  number of items ordered, then how many are held, waiting, ready and so on — in Held, Waiting and
  the other lists A765 names.

## A758. Adjustment reasons: review the rules, then a page of their own

**A758 (owner, 2026-10-16) — design first; the review comes back to the owner with worked examples
and mock-ups before anything is built.** The owner: the page is ugly, the edit form assumes the
roles are a ranking, and "does the logic work? are we asking the right questions?"

**Design (2026-10-17, revised the same day with the owner's answers):** [the decisions, the rules, the page and the starter list](../superpowers/specs/2026-10-17-a758-adjustment-reasons-design.md),
with [mock-ups](mockups/a758-adjustment-reasons/). No question is open; the build may start. The
notes below are the review as written before the answers: where they differ from the design's
decisions (§1 there) — three kinds, give-away against 100% discount, "Invitación", role lists
"with or after" editable roles — the design wins.

How a reason works today (`packages/adjustments/src/policy.ts`): it allows one or more of cancel
(void), give away (comp), a percentage discount and an amount discount; it may cap the percentage
off one item (counting percentage discounts only) and the total off one bill (counting everything
the reason does on that bill); a person below "lowest role that applies it without approval" needs
someone at or above "lowest role that may approve it"; and it may require a note.

What a cancel, a give-away and a 100% discount do (`apps/server/src/adjustments-apply.ts:804-808`):

| | On the bill and receipt | Kitchen | Counts towards the bill's discount limit |
|---|---|---|---|
| Cancel (void) | The item goes | Told | Only if the cancel raises the discount share of what is left |
| Give away (comp) | Stays at zero, printed "Invitació" | Not told | No |
| 100% discount | Stays at full price with a discount line | Not told | Yes |

**What the review settles**, each with a worked example:

1. **An approver who is never asked.** "Entry error" reads "Staff / Supervisor approves", but staff
   is the lowest role, so nobody ever needs approval for it. The seed writes that pair
   (`packages/adjustments/src/provisioning.ts`).
2. **Going past a reason's limit cannot be approved by anyone** — the limit refuses before approval
   is considered (`evaluateAdjustment`). Deliberate or not.
3. **One kind per reason.** A reason that mixes actions makes the limits unclear, and the form
   offers a percentage cap and a bill cap to a cancel-only reason. Void and give-away stay separate:
   they tell the kitchen different things, and a report separates mistakes from hospitality. The
   till should make the choice plain ("Take it off the bill" or "Give it free").
4. **Role lists, not a ranking** — "Who can apply it without approval" and "Who can approve it" —
   because roles become something an admin defines (the editable-roles entry under _Users, sign-in
   and the dashboard shell_); the role lists are built with or after it. The venue-wide bill limit's
   approver, written into the code as "manager" (`policy.ts:139`), becomes a role list too.
5. **Give-away or 100% discount.** In Square, Santet filed complaints as a void, a comp and a "100%"
   discount depending on the button. As a give-away, a comped coffee alone on a bill goes through;
   as a 100% discount it is 100% of the bill and asks for a manager's PIN. Decide whether a 100%
   discount should exist beside a give-away.
6. **The venue-wide limit on a bill's discounts**: a share of the bill, so a one-item bill reaches
   100% at once. Options: drop it and rely on each reason's own limits; a euro amount per bill; the
   share only above a minimum bill. Its paragraph of explanation goes, for one short hint.
7. **Staff meals** — a give-away or a discount, and whether reports need them apart.
8. **What a Square import does with reasons that are not adjustments.** Every Square reason at
   Santet was made by the venue (owner, 2026-10-16), so the lists show what a venue needs:
   - Square's void reasons: ENTRY ERROR, ITEM NO LONGER AVAILABLE and CUSTOMER CHANGED MIND are
     voids; COMPLAINT is a give-away; CUSTOMER LEFT WITHOUT PAYING is Waitron's "Record unpaid
     departure" (the bill is invoiced and the debt recorded), not a void; PAID SEPARATELY and ALREADY
     PAID mean the item belongs on the bill that was paid; TRAINING is believed to be practice
     mode's job (not checked).
   - Square's comp reasons: Entry error and Customer changed mind are voids (both are on the void
     list too); Customer complaint, Friends and family, Manager special and INVITED BY STAFF are
     give-aways; Employee discount is item 7; CUSTOMER LEFT WITHOUT PAYING again is an unpaid
     departure.
   - Square's discounts came in as percentage reasons: EVENT GUEST 100%, INVITATIONAL ITEM 100%,
     CUSTOMER COMPLAINT 100%, FAMILY DISCOUNT 10%.
9. **A starter list for a new venue** (decided: a venue starts with a list it can delete or change;
   today it gets one, "Entry error"). Draft to settle:

   | Kind | English / Spanish | Who can apply it |
   |---|---|---|
   | Void | Entry error / Error al marcar | Anyone |
   | Void | Item not available / Producto agotado | Anyone |
   | Void | Customer changed mind / Cambio del cliente | Approval once the kitchen has it |
   | Give-away | Complaint / Queja del cliente | Approval |
   | Give-away | On the house / Invitación | Approval |
   | Give-away | Staff meal / Comida de personal | Approval |
   | Discount | Discount / Descuento (percentage) | Approval |

   Whether an approval rule can depend on the item having been sent was not checked.

**Then the page:**

- **Its own page under Service** (owner, 2026-10-16), leaving Venue settings without tabs (A755).
- **The list:** a search bar, drag handles instead of Move up and Move down, a cleaner layout.
- **Delete, not Disable.** The DELETE route only switches a reason off today
  (`deactivateAdjustmentReason`, `packages/adjustments/src/routes.ts:258`). A recorded adjustment
  keeps its own copy of the reason's name and rules (`reason_name`, `policy_snapshot`, no foreign key:
  `packages/adjustments/src/schema/adjustments.ts:60-64`), so deleting leaves history intact. Real
  Delete through `wt-delete-dialog`, as courses and stations; the Status column, Status filter and
  Enable go, and design-system.md's "Switching off versus deleting" stops listing adjustment
  reasons among the things switched off.
- **The edit form** asks only what applies to the reason's kind, with the role lists.

## Decisions and deliberate limits

### Device zones and period menu memory (A740)

Owner, 2026-10-15 and 2026-10-16: a till shows the zones you select from its profile's permitted
zones, and opens a fresh order at its saved starting zone after sign-in. Counter becomes a list
with several counter zones. Floor shows only table zones, with List/Map and its zone menu on the
pills' row. Choose the subset under Settings → Zones on this device; there is no manual default-menu
setting.

Within a service-period occurrence, each device and zone remembers its last selected menu across
operators and restarts. Lunch → Drinks stays on Drinks until the next occurrence, including a
new day's Lunch with the same name. The department's timetable supplies the next default. An order
or payment in progress keeps its context, with the grid/default change deferred until safe.
The implementation choices and acceptance cases are in the
[A740 plan](../superpowers/plans/2026-10-16-a740-zones-on-device.md).


- **Party allergy answers on a join (owner, 2026-10-16; A669).** Keep Allergies whenever either
  party has that answer. Otherwise an unanswered party leaves the combined party unanswered, so
  the next Send asks again; keep No allergies only when both parties answered No allergies.


### An order's number is never reset (owner, 2026-10-16)

A working order's number comes from one counter per node that starts at 1 and only climbs
(`allocateOrderNumber`, `packages/db/src/allocate-order-number.ts`). It does not restart each
business day: staff search for orders by number, so a number must stay unique.

### Fixed screens instead of a screen designer (A182)

Owner, 2026-09-20: ship screens written in code rather than a designer venues drag and resize
([service design §11](../superpowers/specs/2026-09-20-service-ordering-and-billing-design.md#11-screen-reuse-and-deferred-work)).
Owner, 2026-10-08: "delete the canvases functionality. we provide prebuilt screens with
configuration settings." Delete the designer before redesigning its default workflows. Menu
Device Home Page and its Handheld/Till displays, receipt configuration and the floor-plan editor
remain separate. Part 2 landed in [#1800](https://github.com/clintongormley/waitron/pull/1800) on 2026-10-16; part 1's redesign
remains open.
[Retirement design](../superpowers/specs/2026-10-16-a182-2-retire-canvases-design.md) and
[plan](../superpowers/plans/2026-10-16-a182-2-retire-canvases.md).

### Joined-table seat suggestions (owner, 2026-10-16; A747)

When you join tables, the Seats field starts with their total so you can accept it or change it.
The till uses today's seats and counts an existing group once, using its displayed total.
When a split leaves tables joined, the suggestion adds the remaining tables' individual seats,
as listed in the split window. The dashboard adds the selected tables' saved seats. Suggestions
stay within 1–999; if any contributing count is unknown, the field stays empty. Editing the
suggestion keeps your value when the table selection changes. Accepting a suggestion leaves no
unsaved draft. The existing server refusal before the till opens Seats remains A666's decision.

### Touch gestures in the floor plan editor (owner, 2026-10-14; A673)

On a touch screen, tap a table to select it before dragging it. A finger on an unselected table
moves the view, so you can pan a crowded plan without moving a table. Two fingers zoom the view.
A mouse can drag a table straight away. The implementation uses the same `Gestures` helper as
the till's floor map. The current contract is in
[design-system.md](../developers/design-system.md).

### A671. The floor plan editor's side panel: less text, nothing jumps

Owner decisions, 2026-10-14: Add tables and Add joined table sit above the form; the form keeps
its space empty while nothing is selected. Seats, one button showing and switching the current
Shape, and Moveable share one row of equal-height boxes. The subtitle, selection help sentence
and colour key go. The removed explanation of first-save and later-change timing belongs in help
mode (A582). Placement markers are squares: primary filled on the plan, outlined off it,
grey filled for a joined table's parts. Only the square changes placement; a placed table's name
selects it, and an unplaced name does nothing. A new joined table goes straight onto the plan.
Mockups: [nothing selected](mockups/a671-floor-plan-editor-panel/1-nothing-selected.png) and
[a table selected](mockups/a671-floor-plan-editor-panel/2-table-selected.png). The latter's corner
handles belong to A672. (2026-10-16: A672 built those corner handles.) The current contract is in
[design-system.md](../developers/design-system.md#departments-and-zones).


- **A guest count typed in the Guests or Split a table window, or a party name typed in the Name
  window, replaces a count or name another till saved while the window was open, once this till
  has received that change: the last one saved wins, with no warning (A715, owner 2026-10-15;
  the Name window by the owner's answer, 2026-10-15).** Asked whether such a save should be
  refused so the waiter sees the other count first, the owner answered "(a) keep it — the last count
  saved wins", and gave the same answer, (a), for the Name window. The Name window's save sends the
  party revision this till holds (`#onNameParty`, `apps/till/src/till-app.ts`).
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

### A737. Find a bill becomes a page with Bills and Transactions tabs

Owner decision, 2026-10-15: replace the one-box Find a bill dialog with a full page, opened from
☰, with Back to the counter (board 4). [Part 1 (#1778)](https://github.com/clintongormley/waitron/pull/1778) covers the page, lists and receipt printing; the
post-invoice Refund action belongs to Part 2. The approved page contract is:

- **Bills** lists every order still open, newest first: opened, table or name, zone, staff, items,
  total, paid so far, state (unpaid, held, part paid, paid not handed over; an order from an earlier
  day marked). Filters: zone, staff, state. Tapping a row opens the order where it can be paid.
- **Transactions** lists paid sales, full invoices and refunds, newest first, today by default:
  when, invoice number, type, table or name, method (card with its last four digits), staff,
  amount. Filters: dates, method, type, staff. Search reads invoice number, name, table and the
  card's last four digits. Tapping a row opens the receipt with Reprint, print in another language,
  and Refund.
- **The same table as everywhere else** (owner): `wt-data-table`'s toolbar, search, Filters panel
  and Customise. The date range is new: a quick list (Today, Yesterday, This business day, Last 7
  days, This month) plus From and To, as the first control in the Filters panel (its
  `filters-start` slot). Each active filter also shows as a chip above the table, so the chosen
  dates stay visible.
- **Paging, which no table has today** (owner: there could be thousands of rows, never all loaded
  into memory). The server does the search, filters, sort and paging and answers one page (50 rows)
  plus the total count ("51–100 of 2,314"). `wt-data-table` gains a server-paged mode; every other
  table keeps loading everything.

**2026-10-16 — Part 2 extension.** Completed refund rows open a separate payment acknowledgment
with the original invoice reference, Reprint and access to the original invoice. Refund is offered
from the original invoice while supported money remains. The durable attempt and recovery contract
is in the [Part 2 plan](../superpowers/plans/2026-10-15-a737-post-invoice-refund.md).

### A pending card payment does not stop a bill moving (table actions plan P19)

The move moves the bill's revision on, open or presented, without `bumpRevision`'s refusal of
money in flight, since a move changes no amount (plan P19). Stated at its site in
`apps/server/src/move-bill.ts`. From the table actions plan's Task 7 (#864, move a whole bill).

### Owner answers of 2026-10-17 (A774)

- **Where the till cannot know whether an area seats guests, the server's refusal is the backstop
  (owner, 2026-10-17; A691).** The floor offers every two-party join, though the server can refuse
  one whose party stands in an area whose service mode changed after it sat (`refuseUnseatable`,
  `apps/server/src/move-bill.ts`). While a counter-only till's first floor-area read waits or has
  failed, Move to table keeps free tables offered and leaves an unknown area to the server, as the
  order screen does.
- **A counter till is "Caja registradora" in Spanish, on the till and the dashboard alike (owner,
  2026-10-17).** The till's change is A837.
- **"Ready" and "Fired N min ago" on the table screen stay as built (owner, 2026-10-17).** They
  were the service plan's default (Task 5, #750).
- **A child extras row in the Tab drawer stays on its own indented, muted, smaller line (owner,
  2026-10-17)**, matching A738's approved order layout.
- **Void works on every bill, split or not (owner, 2026-10-17, withdrawing the 2026-09-26 decision
  that a split check gets no Void).** It follows A758's reason rules; the server already allows it.
- **A home-page shortcut whose target a newly read menu version lacks disappears with no notice
  (owner, 2026-10-17: accepted).** The till says "Not found" (menus spec §9) only when a newly read
  version drops the section it has open.

## A737–A740: the counter till redesigned (owner, 2026-10-15)

2026-10-17: A740 implements device zones and period-scoped menu memory. The remaining Counter
redesign is A738–A739. The dated design and campaign-order notes below retain their original scope.

2026-10-16: A182 part 2 replaces the authored screens described in this design's source snapshot
with [fixed device screens](../developers/design-system.md#fixed-device-screens). Start A738–A740
from those mounts; the earlier canvas paths below remain part of the original design record.

Owner, 2026-10-15, decided over screenshots of the Santet till and four rounds of mock-ups. The
boards are in [mockups/a737-a740-till-counter-redesign/](mockups/a737-a740-till-counter-redesign/):
1 the counter screen, 2 the windows opened from the order, 3 paying, 4 Find a bill, 5 zones on a
device. Where a board and this text differ, this text wins. This is A182 part 1 for the counter
till (the handheld, kitchen screen and pass are not covered). **A182 part 2, retiring canvases,
runs first** (owner, 2026-10-08), and it was not in any lane's queue on 2026-10-15. A738 also
waits on A668's data shape (allergen icons, cereal and nut kinds, the product info window); A668's
spec was awaiting the owner's review on 2026-10-15.

2026-10-16: the revised campaign order puts the separate A737 Part 1 page
([#1778](https://github.com/clintongormley/waitron/pull/1778)) before canvas retirement.
A738–A740 still follow canvas retirement; A737 Part 2 keeps the post-invoice Refund work.

What the code does today, read on 2026-10-15 (read, not run), so the entries below can be checked
against it: the Counter/Floor header buttons are canvas tabs (`apps/till/src/widgets/tab-shell.ts`);
Kitchen, Pass and My schedule follow the profile's `show-station`, `show-expo` and `show-schedule`;
Find a bill, Allergens and Equipment always show. "Refresh menus" re-sends the zone choice
(`apps/till/src/screens/till-counter-screen.ts`), while `MenuStatePoll` already checks every 15 s
(`apps/till/src/state/menu-state-poll.ts`). A line's Note opens an inline field that closes only
when Note is pressed again (`apps/till/src/widgets/basket.ts`). "Make at…" picks the preparation
station and shows only with two or more stations. "Modifiers" under a line is the button that opens
the modifier picker (`apps/till/src/widgets/modifier-picker.ts`), not a heading. After every sale
the till shows the receipt on screen (`#showTicket`, `apps/till/src/till-app.ts`), which pushes New
order off a short screen.

### A738. The counter screen: fewer distractions

Board 1 is the target; board 2 the windows.

- **Top bar:** Counter, Floor | Held, Waiting, Transfers, Pass | operator name, ☰. Held and
  Waiting become tabs with counts (today they are lists under the menu); Waiting flashes while it
  holds an order. Everything else moves into ☰ for good, not only when the bar runs out of room as
  A395 does today: Find a bill, My schedule, Profile (two or more profiles), Language, Settings
  (Equipment; Zones on this device, A740), Log out. Allergens is deleted (A668 already deletes the
  screen). **Kitchen never shows on a till** (owner: it belongs to the kitchen device), except under
  ☰ → Testing on Demo and Preparation installs, which the owner needs for now.
- **A status bar under the top bar:** the service period ("Open · until 02:00", tapping it opens
  today's keep-open window, replacing the "Keep Open open later" button), the zone, and the
  printer's state.
- **Gone from the screen:** Refresh menus, the zone dropdown (A740), the Vegan/Vegetarian/No
  meat/No fish buttons, Make at…, the Modifiers and Note buttons on each line, "As served",
  "Allergens not fully reviewed" (A668 drops it), Approve/Decline (A739), Full invoice and
  "Receipt: <language>" (A739), and the on-screen receipt after a sale (A739).
- **Filter**, a button beside the search box like the dashboard tables' Filters, showing how many
  are on: "Only show dishes that are" (Vegan, Vegetarian, No meat, No fish: include) and "Hide
  dishes that contain" (the 14 allergens: exclude). Gluten and Nuts open a second step, All or the
  kinds A668 records (wheat, barley…; almonds, walnuts…), so a guest allergic only to walnuts still
  sees the almond dishes. A dish whose nuts are recorded without their kind counts as containing
  every kind.
- **The order:** each line one row (name, allergen icons after it, − n +, price, ⓘ, ×). Its extras
  and its note are their own indented lines under it, each with its quantity, price and ×, and
  every amount in the order lines up in one column (owner). Adding a product scrolls the order to
  it (nothing scrolls today). The order sits on white with a heavier divider so it reads apart from
  the menu. A dashed "+ Custom item" tile sits in the menu grid.
- **The line window** (board 2a) opens from ⓘ, a long press on the line, or a double click with a
  mouse. It is **today's modifiers window, reused** (owner), with the line's quantity, its extras
  lists (choose-one as radio buttons, choose-several with − n + per item inside the item's and the
  list's limits, as the picker does now), plus two sections added: the dish's allergens and diets,
  and its note or "+ Add a note". A sent line shows its extras and note read-only. Tapping a note
  line in the order opens the same window.
- **Product info** (board 2b) opens **only on a long press** of a product button (owner,
  2026-10-15; with a mouse, holding the button down): description, allergens and diets, Close and
  Add to order. A tap anywhere on the button adds the dish, and there is no double click on it.
  Only a dish with an allergen or diet label shows a mark, Material Symbols `allergies`, and the
  mark is not a tap target; board 1's tappable ⓘ on product buttons is superseded. This is A668's
  till slice (its spec, _Owner answers on the till_); build it once.
- **Hold** opens a small window asking for a name (optional; empty names the order "Held 14:32")
  instead of today's inline field.
- **Custom item** (board 2d): name, price, VAT rate (required, the invoice needs it) and where to
  send it (nowhere, or a station). Nothing like it exists today; the nearest is a weighed item. It
  likely needs its own permission, since a typed price is a way to under-charge. **Open:** whether
  it needs a product behind it for reports and the invoice line.

**Added 2026-10-16 (owner):**

- **The table-order screen gets the same clean-up**: no Vegan/Vegetarian/No meat/No fish buttons
  (the Filter replaces them), the status bar instead of "Keep Open open later", and no "Where the
  rules send it" dropdown on each line.
- **The "last added" bar on the counter too.** The table-order screen shows the line the last tap
  added or grew, with −1 and +1 (`#lastAdded`, `till-table-order-screen.ts`); the counter shares
  the store (`WorkingOrderStore.lastAdded`) but draws no bar. On both: the bar takes its own space
  rather than sticking over the last row of product buttons, and a long press on it opens the line
  window.
- **Held and Waiting: tapping an order shows its items** (name, quantity, extras, note), and
  tapping again closes it, so staff can check it before Retrieve. Its buttons act at once and do
  not open the row.
- **No empty "Modifiers" heading** on a line with no modifiers chosen (seen on Bravas de Casa).
- **How a later addition is grouped and sent moved to A773** (owner, 2026-10-16). That design
  replaces the later-addition choice and the first order's four buttons on the table-order screen.
  So A738's table-order clean-up leaves the draft bar to A773.
  [Spec](../superpowers/specs/2026-10-16-a773-courses-and-groups-design.md)

### A739. Paying: Hold · Pay, and one payment window

Board 3 is the target. The order's bottom row becomes **Hold · Pay**.

- **Pay opens one window.** Its top row says how much: An amount | Split equally | Items | Whole
  bill, with Whole bill chosen and on the right (owner, earlier; the owner's last message listed it
  first, so confirm the order when building). Under it, "To pay now", then the devices line and the
  receipt, the same whichever way is chosen, then **Cash** and **Card**. Cash asks for the cash
  handed over with quick amounts and shows the change; Card waits on the reader. The cost, accepted:
  a quick cash sale is one tap longer.
- **Paying part of a counter order is new.** Today the counter takes one payment for the whole
  total (`apps/till/src/widgets/tender-pay.ts`), and the bill payments design said partial payment
  at the counter was not asked for (`docs/superpowers/specs/2026-09-26-bill-payments-design.md` §9).
  Tables already have Pay items, Contribute and Split equally (`apps/till/src/widgets/bill-pay-dialog.ts`);
  the counter takes the same path. What is printed follows that design: a payment that leaves
  something to pay prints nothing of Waitron's (the reader prints its slip) and the window says
  "Receipt: printed when the bill is fully paid"; the last payment issues one receipt for the whole
  bill. Separate receipts need the bill split into two bills first. Asesor Q27 is still open.
- **The receipt choices are on this window** (owner): Print, Email or None; the language (replaces
  the "Receipt: Catalan" button); the printer; and "Full invoice (customer's name and NIF)". They
  are chosen before paying because once paid the sale is filed as a simplified invoice: a full
  invoice afterwards is a replacement (F3), which nothing issues today and asesor Q5(d) has not
  answered. While full invoices are switched off (A741), the Full invoice box is not offered.
- **The reader and the printer:** one line, "💳 Bar reader · 🖨 Bar printer", with **Change**
  (the two dropdowns), **Scan** (the camera; one button for both, the QR sticker says what it is on)
  and **NFC** (with the Pay window open, tapping a device's tag switches to it without opening
  anything). With only one of each, the line just names them. The choice is remembered on the
  device. One printer takes both the receipt and Waitron's card slip (`payment_slip` role,
  `apps/server/src/payment-slip-print.ts`; printed for readers that print nothing), since both go
  to the same guest. **To check before building:** which browsers let a page read NFC; the
  belief, unchecked, is Chrome on Android only.
- **The simulator asks at Card:** on Demo and Preparation installs, Card opens "Test card payment:
  Declined / Approved"; today's Approve/Decline toggle on the screen goes.
- **A739a's outcome panel is separate from this payment-window redesign.** The owner reproduced
  a completed decline offering Keep waiting, which returned to a spinner with no request behind
  it (2026-10-16). The approved panel uses Retry and Cancel, explains a refusal or no answer,
  and shows recognised provider reasons in English and Spanish. The owner-defined lost, stolen
  and pickup cases show a staff-only keep-card instruction without Retry. The current simulator
  toggle stays until A739. [Provider evidence and reproduction](../research/2026-10-16-card-reader-failure-reasons.md).
- **Keep the card panel tied to its order.** A767 stores the outcome and Retry's reader, tip and
  offline choice by order id. Moving the panel into the payment window must preserve that link:
  switching orders hides it, returning restores it, and a Retry control from the previous order
  cannot start a payment on the replacement. Browser cases: `till-app.test.ts`, “A767 card outcome”.
- **Remove the Demo card reader** (owner: not needed for the demo; it is missing from the Santet
  data and nothing on the till says the decision is made on the dashboard). It came from A247
  (#1172): the reader, `apps/dashboard/src/screens/demo-reader-screen.ts`, its reader-picker entry
  and the simulator's ten-minute wait. Its open follow-up in `docs/backlog.md` (a till label on
  each pending amount) goes with it.
- **No receipt screen after paying** (owner). The counter goes straight to a new order; a strip
  "✓ Paid €30.00 · receipt printed · Reprint" stays until the next product goes in, with the change
  in large type after cash.
- **Parked, not part of this:** A742.

### A740. Zones on a device

Board 5. Read on 2026-10-15: a zone's menus, prices, trading name and default menu all come from
its **department** (`zonePeriodMembership`, `packages/venue-service/src/operations.ts`), so every
zone of a department shows the same menus at the same prices. What a zone sets itself: its sale
policy (pay first or after, collection numbers, receipt printing; `zone_sale_policies`), its
kitchen routing (`routing_cells` by zone), and the zone the order records. The device profile
already holds a zone list and a starting zone (`device_profile_service_access`,
`device_profile_zones`). Floor plans hold only table zones, which today's zone dropdown leaves out.

- **The zone dropdown on the counter screen goes.** Counter is a plain tab when the device keeps
  one counter zone, and a list ("Counter: Bar ▾") when it keeps several; switching is refused while
  the order has lines, as today.
- **Floor** shows only when the device keeps a table zone; its floor plans are a row of pills under
  the bar, none with one plan.
- **☰ → Settings → Zones on this device:** which of the zones the profile allows this device shows,
  and which it opens first. A manager who wants to look at the floor plans now and then turns one on
  here (owner: a till is set once and rarely changed).
- **Which menu shows first is not a setting** (owner, after a per-zone menu setting was drawn and
  dropped): at the start of each service period a zone opens on that period's menu, as the
  department's timetable decides today (`resolveDefaultMenu`,
  `packages/venue-service/src/menu-timetable.ts`); within the period the till remembers the last
  menu looked at in each zone on this device. Example: Lunch starts, the Bar counter shows the Lunch
  menu, the bartender switches to Drinks, it stays on Drinks until Afternoon starts at 16:00.
- **Added 2026-10-16 (owner):** Floor's pills today include the Counter zone, which has no floor
  plan (`buildZoneTabs` takes every zone, `till-floor-screen.ts`); only table zones belong there.
  List and the ⋮ menu sit on their own row above the pills; they move onto the pills' row.

## A765. Say which table an order belongs to

**A765 (owner, 2026-10-16).** In Held orders a party's bill is listed as "#2" with its count and
total; it shows no Move to table (`order.partyId !== null`, `apps/till/src/widgets/held-orders.ts`),
but nothing says which table it is. `HeldOrderSummary` (`apps/server/src/working-order.ts`) carries
the party id and no table name. The server sends the table's name (a joined table's combined
name) with each order, and every list that shows orders names it: Held orders first, then Waiting,
Transfers, the Pass and the payment panel — check each. A757's item counts change the same rows;
build after A757's board if it has been decided, else name the table alone.

## A669. An allergy at the table

- **A669 — an allergy at the table (owner, 2026-10-14; spec approved 2026-10-15).** At a table's first Send the waiter answers "Any allergies at this table?"; for
  Allergies, who (free text), what they avoid and a note, then ticks the dishes that guest eats. A
  clash turns red and can still be sent. Kitchen paper prints an allergy block under the guest's
  dish and a heading on the ticket; the screens match. The answer belongs to the party, shows as a
  banner with Change, and is in Actions → Allergies; a change to a dish the kitchen has sends a
  notice; the floor plan marks the table. Every table send path runs it; the counter does not. A
  table leaving the party copies the allergic guests to both parties, and a guest can be deleted.
  After A668's data shape. [Spec](../superpowers/specs/2026-10-14-a669-allergy-at-the-table-design.md),
  [mockups](mockups/a669-allergy-at-the-table/)

## A773. Courses, groups and the pass

- **A773. Courses, groups and the pass (owner, 2026-10-16).** Two parts. **A773-1**, the table
  screen's unsent list, has a [plan](../superpowers/plans/2026-10-16-a773-1-unsent-list.md). **A773-2**,
  firing and the pass, is planned from the spec once A773-1 lands. Each
  course gets "Held until fired". A table's unsent list is laid out as Fire now plus held groups:
  it is arranged by ticking, Move to… and drag, and sent with Send all or Fire. The four draft
  buttons and the check window go. Each bill keeps its own unsent list. Only the waiter fires. Each
  station gets "Waits for the pass": fired food there becomes Requested until the pass fires it.
  Station Fire and the venue's fire control go. Counter orders have no courses. Changes A756.
  **Revised 2026-10-17** (owner): the right-hand panel becomes a Sent box (Served; Fired, ready
  first; Held, folded, flashing when due) above a New order that empties on send; sent dishes have
  no tick boxes and are acted on through A738's line window (Fire now, Recall, Move to station,
  one Discount…, Cancel item with charge or no-charge by the dish's state); Recall returns a dish
  to the New order; Pay waits for unsent dishes; Away and the pass's Done go; each pass fires only
  what it sees. [Panel mockups](mockups/a773-order-panel/).
  Migration. [Spec](../superpowers/specs/2026-10-16-a773-courses-and-groups-design.md),
  [mockups](mockups/a773-courses-and-groups/)

## A678. Two readers answer "where is this order"

- **A678 — Two readers answer "where is this order" (2026-10-14; open).** `readOrderPlaces`
  (`apps/server/src/order-places.ts`, used by MOVED slips) reads a counter order whose delivery
  table was released as the counter, a known edge A650 Part 1 deferred and has not yet put to
  the owner, while `orderTableLabels` (`packages/db/src/party-table-labels.ts`, used by
  tickets and correction slips) names it by its kept `delivery_table_label`; only `orderTableLabels` limits the tables it reads to the venue's
  location. Once the edge is decided, one reader in `packages/db`. Left open by A650 Part 1.

## A666. A floor join that moves tables together is sent once without seats

- **A666 — A floor join that moves tables together is sent once without seats and refused before
  the Seats prompt opens (2026-10-14; owner decided 2026-10-17).** Found by A659's probe (#1699): a floor Join with…
  where neither side is a fixed table (two free tables, or a join involving a party) first sends
  `POST /api/tables/:id/today/merge` or `/api/parties/:id/join` with no seat count, gets
  `400 merge.seats_required` (`writeMerge`, `apps/server/src/floor-today-merges.ts`), then opens
  the Seats prompt and sends again (`#merge`/`#join`, `apps/till/src/screens/till-floor-screen.ts`).
  Since #1598 removed saved joins this happens on every such join (a fixed table sends no merge;
  `dropAction`, `apps/till/src/state/floor-today.ts`): one wasted round trip (for a party, a
  join done and undone in one transaction) and a red 400 in the console; nothing the waiter sees goes
  wrong. Owner, 2026-10-17: ask for the seat count first and send once; the other refusals (table
  not free, already grouped, zone mismatch) then show only after the seats are typed.
  The request log is in #1699.

## Move this bill still offers a closed counter area

- **Move this bill still offers a closed counter area (2026-10-15; open, A697 review).**
  The table picker always offers The counter (`#tablePicker`,
  `apps/till/src/screens/till-table-order-screen.ts`), and the app sends its counter area
  (`#onMoveBill`, `apps/till/src/till-app.ts`). The real-route case "refuses a bill entering a
  closed zone at a counter" in `apps/server/src/till-api.zone-closed.test.ts` returns
  `service_zone.closed` for an open bill entering a different closed area. Give the screen the
  counter area's identity and apply that rule, preserving same-area moves and presented bills.
  A697 covers table destinations only; no screen-to-server counter probe was run.

## Held-order closed-area destinations need the order's source area

- **Held-order closed-area destinations need the order's source area (2026-10-15; open,
  A697 follow-up).** Move to table on a held-order card cannot distinguish a move within a closed
  area from a move into one: neither `HeldOrderSummary` nor `HeldOrder` includes the saved source
  area (`apps/till/src/api/client.ts`). The server permits the former and refuses the latter for
  an open bill (`adoptZone`, `apps/server/src/move-bill.ts`). Include that context in the read
  contract, then filter closed destinations while preserving same-area moves. A697's till-only
  change covers the order screen; the held-order picker still leaves this decision to the server.

## A730. The floor's Rename window may keep comparing against the name it opened with

- **A730 — The floor's Rename window may keep comparing against the name it opened with after the
  name is changed on another till (2026-10-15; open; found by reading in A717's review, not probed).**
  `apps/till/src/widgets/today-name-dialog.ts` takes its baseline from `value` when it opens, and
  after a send through `commit()`, and has no `savedValue` to follow, unlike the order screen's Name window since A717. **Next action:** probe it
  in real Chromium; if Save compares against the old name, follow the stored name as
  `party-name-dialog.ts` does.

## Investigate a null device identity during profile switching

- **Investigate a null device identity during profile switching.** A432’s full till coverage run
  on 2026-10-08 passed 5,951 tests and its thresholds, but the browser logged an unhandled
  rejection at `apps/till/src/till-app.ts:4468` through `#readIdentity` / `#enterSwitchedProfile`.
  Reproduce which profile-switch test answers null and determine whether the fixture or the
  public identity response needs correction; keep the existing profile and login assertions.
  Receipt: Lane D `receipts/a432/task5-ci-till-coverage-green.log`, PR #1463. Cause unverified.

## Loose ends left by A466 (A429 slice 2) / A502 part 3

- **`wt-input` has no visible description.** The Add tables names preview is a polite live region
  after Prefix, so it is not heard when the field takes focus; the fix is a visible description in
  the shared `wt-input`. Left open by A466 (A429 slice 2) / A502 part 3.
- **The Departments list's "Floor plan" link is shown without `venue.configure`.** The floor-plan
  screen needs it (`UNLISTED_SCREENS`, `apps/dashboard/src/dashboard-app.ts`), so a session without
  it that follows the link lands on Overview. Every role with `venue_service.manage` has
  `venue.configure` today, and a module screen's context does not say whether the person holds it
  (`DashboardModuleContext`, `packages/dashboard-kit/src/contract.ts`). Revisit beside the
  permissions review. Left open by A466 (A429 slice 2) / A502 part 3.
- **On computers whose scrollbars take space, a size reading just after a floor plan drop may
  shift the plan by the extra room.** Seen only with a stand-in scrollbar; headless Chromium's
  scrollbars take none, so it is not measurable there. Left open by A466 (A429 slice 2) / A502 part 3.
- **Resizing a floor plan table needs a pointer or a keyboard.** The side dots and corners are
  hidden from assistive technology and Shift+arrow needs a keyboard, so a screen-reader user on a touch screen
  cannot resize a table (accepted by the A502 coordinator, not yet by the owner). Left open by A466 (A429 slice 2) / A502 part 3.
- **Small floor plan canvas details:** `reveal` does not count the side dots or the corners. Left open by A466 (A429 slice 2) / A502 part 3.

## Loose ends left by A672

- **No key moves a floor plan table's top or left side or a corner.** Shift with the arrow keys
  moves only its right and bottom sides. Left open by A672.
- **Turning a floor plan table by key walks it away from the plan's top-left edge.** Each press
  steps a table that would poke past the edge back in from where the last press left it, and
  turning back never steps it out again: one full turn by key takes an 8 × 8 from (0, 0) to (2, 2).
  Part of the owner question in "A turned floor plan table narrower than its unturned box stops
  short of the plan's left or top edge". Left open by A672.
- **Two floor plan keyboard tests do not see the far-edge protection.** An arrow key or Shift+arrow
  change while the canvas is scrolled to its far right or bottom keeps the other tables still on
  screen; with that protection switched off, the zoom-out test and the half-zoom Shift+ArrowLeft
  case in the canvas suite still pass. Make each fail without it. Found by the A672 review. Left
  open by A672.
- **Possibly: zooming out during a keyboard change grows the blank margin above and left of the
  plan.** Not established: the one probe looked the same with and without A672's change, so it
  proves nothing either way. Reproduce first. Left open by A672.

## Loose ends left by A718

- **`wt-floor-plan-preview` has no product user.** It remains in `packages/ui/demo/main.ts`, with
  its `--wt-floor-plan-preview-max-height` token in `packages/ui-core/src/tokens/structure.css` and
  its row in `docs/developers/design-system.md`. Retire it, or record why it is kept. Left open by A718.
- **The zones list's placed-table query has two untested properties.** `zonesWithPlacedTables`
  (`apps/server/src/floor-plan.ts`) reads only the listed zones and makes one query for all of
  them; a review dropped the zone filter and every test still passed. Pin both. Left open by A718.
- **Check "closing the editor returns focus to its originating row menu"** in
  `docs/developers/design-system.md` (Departments and zones) now that Edit receipt opens from the
  Receipt link: a review saw focus return to the link. Left open by A718.
- **The pinned Actions column's left divider showed a gap between two zone rows** in a 1280 px
  light-theme screenshot of Departments and zones (`~/waitron-campaign-c/a718-shots/list-en-light-1280.png`,
  between Bar and Same). Not known whether it predates A718. Left open by A718.

## A550. Making a booked table part of a joined table is not refused

**A550. Making a booked table part of a joined table is not refused (2026-10-12).** The floor
plan editor's save refuses deleting a booked table (`table.booked`) but not making one a part; the
booking stays, and seating it is refused `table.in_joined_table` once the reset applies, so staff
must move it by hand. Left open by A503 part 2 (#1601, design gap 2). Next: decide whether the save
refuses it, as a delete is refused, or only warns.

## The booking form draws its bottom alert and Save slot without the shared actions primitive

**The booking form draws its bottom alert and Save slot without the shared actions primitive
(2026-10-14, A551 review).** `packages/bookings/src/dashboard/booking-form.ts` keeps a
`p.error[role=alert]` and its footer button where the Forms contract in
`docs/developers/design-system.md` names `wt-form-actions`. The base at
`9e40be28237ebdd9eac90a92da9e96b977d8f590` has that same arrangement. Next: use the shared
actions primitive while retaining the single correction sentence, keyboard submission and
draft/save behavior. A551's focused validation and axe cases pass with the retained arrangement.

## Two small phone-width points A414 left (#1495)

**Two small phone-width points A414 left (#1495).** On the Order screen at 390 px the Review
button stops short of the right edge (seen in a screenshot, not compared with before #1495); and
the Schedule and Allergens screens now draw their own copy of the card's border and padding
(`apps/till/src/widgets/screen-card-styles.ts`), so a later change to the card's look will not
reach them.

## Task 3 (#733, order groups)

- Left open from the PR: a cross-party merge can leave a settled check's lines naming a group now on
  the target party; the deleted `moveTabLines` ignored groups, and whether the paths that move lines
  now do the same is not checked; a whole-order save replacing a held dish with another variant
  moves it to a new held group at the end; the counter's whole-order save does not answer the
  party's revision; and the table screen offers no Send on a held no-route dish outside any group
  (its per-line Send needs a kitchen ticket item, `sendsAlone`,
  `apps/till/src/state/held-groups.ts`) — whether one can occur on a party's tab is not established.
  Left open by service Task 3 (#733, order groups).

## Task 10 (#908, the service dashboard's attention signals)

- **Decided by A757 (owner, 2026-10-17); built in A757's slices 3 and 4.** The floor's older
  waiting band (`timingBand`, which colours the card and shows "Forgotten") counts HELD dishes, while
  the long-wait chip counts only dishes sent, so a held course queued long ago shows "Forgotten":
  `timingBand` will count only dishes sent (A757 Q17). "Take order" looks like "Reserved": Reserved
  takes the map's reserved colour and Take order becomes a service step (Q20). "Bill requested" no
  longer looks like "N en camino": it has been filled purple since A472.
  [A757's design](../superpowers/specs/2026-10-17-a757-table-states-design.md).
- The till drops the bill request's late answer, a refusal included, once the waiter has signed out
  or left the party (`#onRequestBill`, `apps/till/src/till-app.ts`), stricter than most of C81's
  table actions. **Next action:** decide whether a late refusal should be said. Left open by service
  Task 10 (#908). For the owner.

## Refresh the floor without a staff action in a zone's list view — OPEN (3d, W16)

- **Refresh the floor without a staff action in a zone's
  list view — OPEN (3d, W16).** — left open by the product folders work. Since A429 slice 3 the
  floor screen re-reads the floor every 15 seconds while a zone's map is on screen
  (`#watchFloor`, `apps/till/src/screens/till-floor-screen.ts`). Elsewhere it still reads only on
  events handled by `till-app.ts`'s `floor-refresh`. Polling would read `listTablesWithState` every
  few seconds on every till; choose the interval and cost first.

## In dark, the till's Cash and Card turn dim blue while a payment is being sent

- **A842. While a payment is being sent, the pressed Cash or Card keeps its colour with a spinner**
  (owner, 2026-10-17; left open by A535, #1617). They are switched off with `disabled` while
  sending, not `loading`, so they now take the dark disabled colours (`--wt-color-primary-disabled`)
  instead of a half-faded full blue; A417 asked for them to keep blue while sending. Follow the
  owner's 2026-10-08 rule: the pressed button keeps its own colour with a spinner while its request
  is sent, and the other goes quiet.
