# The till, devices and table service — detail

The open entries are listed in [the backlog](../backlog.md), under "The till, devices and table service". This file holds
their full text.

## Loose ends left by A429 slice 1 (#1493).

- Small floor-plan refusals still missing: `dining_tables.plan_table_id` has no unique index (no
  writer makes two live tables follow one master table today); the delivery-release trigger
  accepts an empty label.

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
  form" and aggregate-pair history and a "KDS-1 §3d" pointer. Stale test titles: "recordSale
  UNCHANGED" in `tabs.filing.test.ts`; many "(KDS-…)" and "(A1)"-style plan tags.

## Till widget points from #616 that were read but not run

- Found by #616 (`apps/till/src/widgets`). Read, not run: `ReaderOption.online` is never set
  outside tests; the table screen still needs its redundant exit
  configuration audited; the tab shell and the supervisor dialog emit
  events not named `wt-*` (CLAUDE.md §3; not checked whether the rule reaches till widgets).

## The table-order screen's `#lineGross` comment was not restored

- Found by #614 (`apps/till/src/screens`). Not restored because nothing confirms it: the
  table-order screen's `#lineGross` comment "same arithmetic the server files with".

## Cash handed back for a voided cash sale is recorded nowhere

A void writes no payment or refund row, so if staff give a customer cash back, the void's day shows
a drawer shortfall at cash-up. No till screen or server route calls `recordVoid` yet, so nothing
can do this today. **Owner decision 2026-09-25:** keep it here and decide it when the till's void
screen is designed.

## The till's top bar is one row at every width (A395, #1435): left open

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

Legacy unit maps cover English and Spanish only. The default Kitchen title remains
English when the tab shell is shown in a synthetic Spanish probe; check whether any
real kitchen session shows that bar before widening the standard-tab translation.

## A470 — the till's floor map follow-ups

Left open by A429 slice 3.

- `wt-floor-map` acts on a `click` only when its `detail` is 0 (the keyboard's), leaving a
  pointer's click to the gestures, so a screen reader whose activation sends a `click` with
  `detail` 1 or more and no pointer events would open nothing. Unmeasured; needs a manual
  VoiceOver and TalkBack check.
- A party with an open tab and nothing owed reads "Owes €0.00" in the details sheet
  (`table-details-sheet.ts`); the floor card shows €0.00 the same way.
- The old floor card says "1 listos" in Spanish (`till-floor-screen.ts`, the count followed by
  `floor.ready`); the map's pin and notice say "1 listo".

## A474 — today's floor changes on the till: follow-ups

Left open by A429 slice 4
(#1526).

- `wt-floor-map` works out which table is under the finger on every pointer move. Two cheaper
  versions were tried and each picked a different table (one failed an existing test, the other
  a probe), so the faster version still needs a way that keeps the same answer.
- Back to saved place reports `table.not_on_today_plan` when a table still has today's row but
  the last reset's copy removes it. The real `floor-today-changes.test.ts` case "refuses a
  table whose master table was deleted, and one never on a plan" checks both the existing row and that refusal (A476
  run-it review). Decide whether this needs its own saved-place code and wording; the owner's
  A476 rename is retained for both paths.
- A second drop made while the first is still being sent replaces the first's drawn place.
- When a table is dropped on another to seat a party, the till checks only the dragged table's
  gates; the server's join refusals are believed to cover the target, but that was not run.
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

## A594. Moving a bill to a free table in a group seats only that table

**A594 (2026-10-13).** `moveBill`'s free-table branch opens a party at the one table it was given and
leaves the rest of its group free (`apps/server/src/move-bill.ts`, the `openParty` call), so a party
can hold some of a group's tables. Seating, the party join and Move guests all treat a group whole.
Found by A579 part 3b's review: Split tables… ticking that table would have left the party open with
no table; it is now refused `merge.strands_party`. Next: decide whether the moved bill's party takes the
whole group, as seating at one of its tables does.

Such a party can also lose a group's today's name with no MOVED slip (A581 part 2's review,
reproduced with a throwaway test before A650 Part 1 changed when MOVED slips print; since then
the code has been re-read, not re-run): Move guests onto a table another party holds in the same named
group can end the group (`leaveMergeOf`) after `combineAt` has queued its slips (`moveGuests`,
`apps/server/src/table-actions.ts`). It needs a party holding part of a group, so taking the whole
group should remove it (reasoned, not tested).

## A565. A reset does not wait for food on its way to an ordinary table

**A565 (2026-10-13).** Any reset (Update layout, Reset to {set} plan, the day's first reset, the
dashboard's first save) moves a free table to its place in the layout it applies without asking
about food on its way: a plain table the layout turns into a part of a joined table, or drops, loses
its place on today's map while a kitchen order still names it. #1604 made a split joined table's group wait for
food on its way (`foodComingTo`, `apps/server/src/floor-today-store.ts`); ordinary tables were left
as they were. It was reproduced with a throwaway test in #1604's finish run; the behaviour dates from
`29801d74a` (floor plans, slice 1). Next: decide whether a reset holds such a table back, as it now
holds a split group.

## A566. An open order with nothing sent yet does not hold a split group back at a reset

**A566 (2026-10-13).** A split joined table's group waits at a reset while one of its tables has
guests, needs clearing, has food on its way or is in a guest-holding merge (#1604, and
`splitWithBusy` in `apps/server/src/floor-reset-plan.ts`); an open order at a split-off table with no
food sent yet does not count, so the reset can put the joined table back whole over it. Noted by the
fix worker in #1604's finish run and not changed. Next: decide whether an open order counts as busy
here, and check what the reset does with that order's table.

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
and the server accept a wider range. Pictures were removed from the repository on 2026-11-02. Next: the owner's answer.

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

## A1012. Delivery for online orders

**A1012 (owner, 2026-10-22) — backlog only.** A509's online order, taken to the customer's address
instead of collected. It shares A509's online menu, payment question and need for remote access
(A951), and comes after A509. It is not the till's delivery table (a counter order carried to a
table) nor invoice delivery, which already use the word.

To decide before building:

- Who delivers: the venue's own staff, a delivery company, or both.
- The area served, any delivery charge, and the smallest order taken.
- How the address is taken and checked (Waitron Cloud plans a free address-lookup service).
- Paying when ordering or on delivery, and when the fiscal record is made.
- How staff see an order go out and come back, and how the customer is told it is on its way.

## A436 — a kitchen display with someone signed in, logged out only after a long idle time

- **Owner, 2026-10-08, answering decisions 4 and 5 of the
  [A366 slice 5 plan](https://github.com/clintongormley/waitron/blob/f2e5e9fb5976f4c5f63cf1143b9befa22fe2cd12/docs/superpowers/plans/2026-10-08-a366-slice-5-monitors.md):** "kitchen
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

**2026-10-20, A773-2:** the pass's Done/Undo HTTP route is retired. The sign-in work must use
the remaining preparation actions and planned pass release rather than extend those former marks.

**2026-11-04, A773-2 PR D:** the marks' table was dropped (core 0205).

## Task 11 (#916, cancellations, comps and discounts; B11a–B11g)

Left open:

- **Refunds follow-up. A waiting dish on a paid bill moved to the counter cannot be
  cancelled.** The counter command refuses it with `working_order.not_open`
  (`apps/server/src/line-cancel-context.ts:72`), after the move detaches the bill in
  `apps/server/src/move-bill.ts:342`. On an open bill, remove-charge works for an unstarted
  dish. Keep-charge refuses it with
  `management.request_invalid` (`apps/server/src/line-cancel.ts:226`). The 18 November
  Lane H reproductions on `16a6986d4b` are in `receipts/counter-waiting-dish-paper/red.log`
  and `red-expanded.log`. Route the paid case through the unified refunds work.
- **The adjustment history records who approved, but not whether the bill's comp limit or the refund rule,
  rather than the reason, is why.** Recording it would need a column. **Next action:** decide
  whether to record it.
- **A placed pay-later counter order (a `ticket_then_pay` zone's, sent to the kitchen before
  it is paid) cannot be adjusted:** the placed-order trigger freezes its prices. B16 lets such
  an order be handed over before it is paid but did not decide this. **Next action:** decide
  whether a placed order can be adjusted before it is collected.
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
- For an extra of a held dish whose HOLD ticket was queued, cancelling it tells the kitchen
  (B11g) but the till's cancel dialog still says only that it comes off the bill, because the
  till cannot see whether the HOLD ticket was queued. **Next action:** decide whether the till
  should be told that.
- An extra counts its dish's percentage under a reason's per-line cap, and a dish the largest
  of its extras', which errs toward refusing. **Next action:** none unless staff find it gets
  in the way.
- **Only give-aways and discounts split part of a dish with its extras.** Moving part of a dish to
  another group still refuses a partial move of a line with extras (`tab.transfer_modifier_line`):
  part of a weighed dish.
  **Next action:** decide whether that partial move should split extras too.
- The till's "Amount off (€)" writes the euro sign into the label rather than taking the
  venue's currency. How a comp or discount appears on the invoice was asesor Q29: its discount lines were answered
  from primary sources, and a free item's share of the price by the adviser's answer 1.10 (A445).

## Task 16 (#981, counter handover; with B25, B26, B29, B30)

Open:

- A till profile saved before C130, and one newly created on the Device profiles
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
  wholly off-screen (fixed by lane C's W27, below).
- Left from C133's review, not changed there: the table-order screen's bottom bar still keeps
  a tap target and two gaps clear at its end (`padding-inline-end` on `.bottom-bar`,
  `apps/till/src/screens/till-table-order-screen.ts`) for a floating language button the till
  no longer has — the language button now sits in the tab shell's top bar (A187). Removing the
  space changes the screen's layout, so it is its own change.

## Task 17 (#991, a bill left unpaid)

Asesor Q28 was decided by the owner
without the asesor (2026-10-01): the full simplified invoice is issued when a bill is left unpaid.
Open:

- **A dish never sent, on hold, or waiting for the pass and not fully served blocks the
  departure** (`unpaid_departure.unfired_dishes`); staff cancel it first.
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
- **A bill presented without an invoice keeps the label it was placed with when the departure
  or Print the bill invoices it.** Every other path that invoices such a bill saves the receipt label in the
  update that settles it; the departure leaves the bill placed, and the placed-to-placed clause
  of `working_orders_enforce_transition` (now in `packages/db/drizzle/0000_baseline.sql`) requires
  the label to stay as it is
  (measured 2026-10-01: saving it made the departure answer 500). Not measured: what its
  invoice's reprint and the debt list then show. Fixing it needs that trigger to allow the
  label to change. A bill the departure settles because it owes nothing goes through
  `settleIssuedOwingNothing` (`apps/server/src/till-sale.ts`), which sets no label, although
  the trigger allows one there.

## Tables, parties and bills — the till's table actions

[plan](https://github.com/clintongormley/waitron/blob/f2e5e9fb5976f4c5f63cf1143b9befa22fe2cd12/docs/superpowers/plans/2026-09-28-table-actions.md). What stays open:

- **Task 6 (#818) and C50 (#847): the ticket of a bill collected after a correction still shows
  the original invoice total.** `collectOrder` queues no receipt on this path; the ticket it
  returns, the original receipt the till offers, and any reprint are all built by
  `readSettledTicket` (`apps/server/src/till-sale.ts`) and show the invoice's original total, and
  since C67 the card-reader payment of a bill that owes nothing returns the same. The printed
  receipt and the screen both give the cash line as total plus change
  (`apps/server/src/receipt-document.ts`), so it
  overstates what was handed over. **PARKED (owner, 2026-09-29)** until the product can issue a
  corrective invoice; the owner's points for that design are on the corrective-invoice entry (R5,
  above). Also from C67's review (a probe, not a committed test): for a bill corrected to exactly
  zero, a captured card payment with no sale still takes the recovery branch first, settling at
  the captured amount with all of it recorded as tip; the below-zero case with a capture was not
  run.
- **Task 4 (#832, every paper names all of a party's tables).** Not yet looked at on the pass
  card (`apps/till/src/widgets/pass-board.ts`): whether a wrapping label wraps its "2 min" too. **DECIDED (owner, 2026-09-29): leave it** — after payment, the station queue
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
  can make such a loop was not checked. Left by #906's review: no case pins what a correction slip prints for a counter order delivered
  to a table.
- **Task 9 (#874, dishes arriving in a party get a kitchen group).** P16 is kept (owner,
  2026-10-17; recorded in kitchen.md's Decisions).
  The owner's replacement for C80's earlier course-placement rule is retained under
  [Decisions and deliberate limits](kitchen.md#a-switched-off-course-uses-fire-now-owner-2026-10-17-c80).
- **Task 11 (#881).** Open (found by #905's review, by reading, not reproduced): on a handheld, a
  waiter who taps a free table to seat it, goes back to the order tab (on a handheld, the table's
  bar button since A797 slice 3) while the seating is still under way and starts Move guests can
  have the move set the wrong table on the new party; the suggested fix is to count only table
  opens started in the current operator session; not queued. The till sends `otherPartyId: null`
  when its floor does not list the target table at all (a failed floor read empties the list); a
  table another party holds is then refused as out of date, never combined.
- **Open, from C84's review (#913):** when a void or line change gets no answer,
  `#rereadAmounts()` can put on screen what the party still owes, taken from its bills after its
  own floor read failed, while the revision on screen stays where it was. A later floor read that
  also fails keeps a floor listing the same party at that EQUAL revision, which
  `#retakePartyFromFloor()` takes, and `#followDraft` → `#rememberOrderParty()` after a send with
  no answer takes too, putting the floor's older amount back (`apps/till/src/till-app.ts`). Traced
  in the code, not reproduced.

## Printer identity at enrolment

Printer identity remains sub-project C of the
[device enrolment design](../superpowers/specs/2026-08-30-device-auth-enrolment-fail-closed-design.md).

## Screen faults seen during menus Task 9's look on 2026-09-27

Seen on the dev stack while
checking the till's home page, not investigated, and not checked against `main`, so any of them
may predate that branch:

- on the till at 390 px wide, the header makes the page wider than the screen (measured in
  C130's entry above: 560 px in English and 602 px in Spanish with only Find a bill offered);
- on the till's floor map at 390 px wide, tables overlap one another.

**Next action:** check each against `main`, then fix or file it on its own.

## Build good screens for each kind of device, and retire canvases (A182, owner 2026-10-01)

What remains of A182 part 1 is the Counter's custom item,
[A738 residual](#custom-item-on-the-counter-a738-residual), and the payment window,
[A739](#a739-paying-hold--pay-and-one-payment-window); the screen designer was retired in
[#1800](https://github.com/clintongormley/waitron/pull/1800) without redesigning them. A737 Part 2
adds the separate durable post-invoice payment-refund path.

## What W105b left open (#1248, a disabled device coming back as itself)

Left OPEN by W105b (#1248, a disabled device coming back as itself): (2) If an ask's response is
lost after the server saved it, the browser's next ask joins as a new device and the old row stays
disabled. (4) An ask that replaces
a waiting one always gets a later `createdAt`, but an ask made when no ask is waiting under its
id, whatever ended the previous one (accepting it included, once the device is later disabled),
is not forced later, and nothing in the code rules out the two sharing a millisecond.

## What W106 left open (the battery on the Devices list, #1240)

Left OPEN by W106 (battery, #1240): (1) dashboard places still showing a bare `YYYY-MM-DD HH:MM`
(`formatIsoMinute`), not changed: the Devices "Last seen" column; on Printers, a print agent's join request, an agent's Last seen (its table and Edit), a
printer's Last print and Last seen (its status view) and Last print (the printers table), "Seen on {agent} · {time}" (`printers.seen_at`), and the print
queue's Created and Delivered columns; the menu status and preview's "published {time}"
(`apps/dashboard/src/widgets/menu-preview.ts`); and the adjustments report's time column
(`packages/adjustments/src/dashboard/adjustment-report-screen.ts`). Whether any of them should
use `wt-relative-time` is the owner's call. (2) `wt-relative-time`'s words are an inline button
below `--wt-tap-min`, under criterion 2.5.8's exception for a target in a sentence
([design-system.md](../developers/design-system.md)); whether that may stay is the owner's call.

## What W104 left open (#1225)

Left OPEN by W104, not acted on: (2) the Add a device and Pair dialogs were looked at only through the browser
test harness with a stubbed server, never on a box, so a real QR code drawn from a real box
address has not been looked at.

## A1325. Close the day: count the cash and save the day's close

**Design approved by the owner, 2026-11-06:** [closing a drawer](../superpowers/specs/2026-11-06-a1325-close-a-drawer-design.md).
A close is a counted withdrawal from one drawer, at any time, covering everything since that drawer's
last close. It takes in A239, so the two are built together, and A240 can land after them. It replaces
`daily_closes`, and no plan exists yet.
Sales shows frozen figures once a node's day has a saved close. The closer must decide where a later
write dated to that day goes; A897 does not settle that rule (watcher, 2026-11-11 22:09).

## Recorded cash in and out of a till's drawer (A239) — OPEN, needs a spec before queueing (owner, 2026-10-03)

Now part of [closing a drawer](../superpowers/specs/2026-11-06-a1325-close-a-drawer-design.md) (owner,
2026-11-06). Piece 2 of A238. Each top-up or removal of cash from a till device's drawer is a
recorded entry: who, how much, why, when (topping up change, paying a supplier, a waiter handing
in float cash). The entries replace the two typed totals the daily close takes today (opening float
and payouts, `packages/reporting/src/record-daily-close.ts`). Needs A238 (landed as #1164).
No screen collects cash
counts yet; this is where one belongs.

## Waiter cash floats (A240) — OPEN, needs a spec before queueing (owner, 2026-10-03)

Piece 3 of
A238. Its screen belongs with clocking in and out, under Team (owner, 2026-10-03, A261 §10). Owner decisions so far: a float belongs to the WAITER, not the handheld; a waiter with an
open float may take cash on any handheld, and it adds to their float; the waiter settles the float
at a till before leaving, entering what they hold, the difference is recorded against them and the
cash goes into that till's drawer as an A239 entry; the daily summary email lists any float still open.
Cash taken on a handheld whose profile allows cash, with no float, is counted against the
handheld until then (A238). Open: where a float's opening cash comes from (a till's drawer, or brought in). Needs
A238 (landed as #1164) and A239.

## Other till surfaces have not been checked against the forms rule

Left open by C47 (#838/#839/#840/#841). The till's other surfaces have not been checked against
the rule, and whether a number pad or a choice picker counts as a form under it is open: the payment and weighing steps
(`apps/till/src/widgets/tender-pay.ts`) keep Confirm payment disabled while the cash entered is
below the total and Add disabled while the weight is invalid, before any press, with no message;
the dish options picker (`apps/till/src/widgets/modifier-picker.ts`) keeps Add or Save disabled
until its required choices are made, and shows changed or unavailable choices as `role="alert"`
paragraphs rather than beside a field; and the supervisor override dialog
(`apps/till/src/widgets/supervisor-override-dialog.ts`) keeps Authorize disabled while the PIN is
empty, before any press.

## The profile editor reads people and the venue's departments and zones

Left open by W97 (#1311), found in its review and not fixed on the branch:

- The profile editor also reads people, so it needs `person.manage` beside
  `venue.configure`; no role holds only the latter today. Edit and Duplicate fail with a read error when the departments and zones read
  fails, and its lists do not update while the editor is open.

## The till's menu reads (Task 7, #719)

Every `/api/menu-state` poll waits its turn in the
write queue, because the route and `requireSession` (`apps/server/src/till-session.ts`) read
inside `withTransaction`; reading outside a transaction would skip the queue but give
`menuState`'s queries no single consistent view, and there is no read-only transaction
(`packages/db/src/tenancy.ts`). A
till learns of a change only by polling, because the dashboard's live-update route accepts the
management cookie only; a till-session branch there would let the server tell tills (plan D11), a
later refinement.

## The till's home page (Task 9, #729)

Every `/api/menu-state` read from an enrolled device reads the device, once
per zone it polls (the counter's, and the open table's while its order shows), and each read also
reads the till's setup (`readTillSetup`, `apps/server/src/till-setup.ts`) to name `setupRevision`; the token check is one SHA-256 of the token on every read, with nothing
remembered between reads.

## A893. Owner review of every table state and its look, after A757 lands

**A893 (owner, 2026-10-18).** A757 is built (2026-10-22; it was to wait for the whole of A757:
owner, relayed by the watcher, 2026-10-18); Waiter called (design §4 row 5) cannot be shown until
A508. Show the owner, on the running till:

- every row of [A757 §4](../superpowers/specs/2026-10-17-a757-table-states-design.md#4-one-order-of-precedence),
  Forgotten through Free, on the floor map and on the list card, in light and dark, at 390 and
  1280 px;
- the two pulse speeds (fast for Forgotten, slow for Overdue and Time to fire) and what each looks
  like with reduced motion;
- the zone tabs carrying a hidden zone's most urgent state, and the toolbar edge's "›" for a tab
  scrolled out of sight (A757 §7);
- Nothing needed's calm look (A757 §9).
- the choices slice 4 made where the pictures are silent (its plan's Open points 4, 8 and 11,
  `docs/superpowers/plans/2026-10-20-a757-4-precedence-pulses.md`; Open point 4's ring no longer
  dims "to 30%" — since A757 slice 4b it dims to a colour, `--wt-color-danger-pulse-dim` or
  `--wt-color-warning-pulse-dim`), and one point from its look
  (2026-10-20): at 1280 px every list
  card in a row stretches to its tallest neighbour, so one busy card makes the calm ones beside it
  tall and mostly empty. The grid rule behind it dates from 2026-08-21 (`git blame`) and slice 4 did
  not change it; I believe the stretching predates slice 4.
- the Open points of slice 4's follow-up, the owner's look changes
  (`docs/superpowers/plans/2026-10-20-a757-4b-owner-look-changes.md`).
- the choices slice 6 made where the pictures are silent: its plan's Owner points
  (`docs/superpowers/plans/2026-10-21-a757-6-item-counts-by-state.md`), each built with the default
  named there.
- the choices slice 8 made where the pictures are silent: its plan's Owner points
  (`docs/superpowers/plans/2026-10-22-a757-8-service-steps-floor.md`), each built with the default
  named there.
- the choices slice 5 made where the pictures are silent: its plan's Owner points
  (`docs/superpowers/plans/2026-10-20-a757-5-map-zone-tabs.md`), each built with the default named
  here, plus two found while building it (the last two):
  - **The small-table check was measured on an invented floor.** On Santet's tables, which the
    import script places on a made-up grid (`local/square/import.mjs`), a 390 px map draws Front Bar
    and Saloon's tables at 43.3 px, Main Bar's at 65 px and Terrace's at 32.5 px (41.5, 62.3 and
    31.2 px inside the till page's 8 px margin); a 360 px map draws them at 40, 60 and 30 px (38.2,
    57.3 and 28.7 px). No table is under 28 px, so every name shows, but Terrace's tables are under
    the 36 px a cue needs, so there a table's state is its colour, its outline and its spoken words.
    Default: as built; measuring the owner's real floor once it is drawn is A937.
  - **Waiting's cue on the map says "Waiting", not the minutes** picture 07 draws ("⏱ 6′"), because
    the floor read sends only how late a table is, not its dishes' ages. Default: the word; sending
    the oldest fired dish's age is A936.
  - **An outline on a filled table has a thin line of the background colour inside it**, which the
    pictures do not draw: without it a Waiting outline on a Bill requested table is all but
    invisible in light (1.01:1). Default: the line.
  - **Two tables §4 has no row for:** a counter delivery waiting at a table no party holds is solid
    seated blue with the service-step icon and "2 to deliver"; a table that needs moving is dashed
    like Needs clearing and says "Move". Both also colour a hidden zone's tab, which §7 limits to
    §4's rows 1–11. Default: as built.
  - **The cue shows only on a table at least 36 px across**, above the 28 px at which the name
    shows. Default: 36 px.
  - **Both ends of the zone strip get an edge mark** for a tab scrolled out of sight; picture 08
    draws only the right one. The mark pulses like the tab it stands for. Default: both ends.
  - **The order screen's status pin no longer says "N to serve"**; it says the table's most urgent
    state, so a seated table with dishes in the kitchen and nothing late reads "Nothing needed".
    Default: as built.
  - **New short words on the map:** "Out" («Agotado»), "Fire" («Marchar»), "Bill" («Cuenta»),
    "Clear" («Recoger») and "Move" («Mover»); Not sent reuses the unplaced token's "Unsent" («Sin
    enviar») where the picture says "Not sent". Default: these words.
  - **The pulse ring reaches 6 px out, after a 2 px gap**, where the design says 7 px and picture 09
    draws a halo with no gap; a table listed later on the map covers a neighbour's ring. Default: as
    built.
  - **Icons now show on the chips wherever the till lists a table's signals** — the card, the
    unplaced token, the details sheet, held orders and the order screen — not only on the floor.
    Default: everywhere.
  - **The till bar's Waiting tab keeps «En espera»**: the owner's answer on #1920 named the floor's
    Waiting chip, and the tab counts counter orders, not dishes. Default: «En espera».
  - **Needs clearing's dashes, and its zone tab's bar, are the darker warning amber**, not the
    clearing amber the pictures draw, which in light reads 2.03:1 on the map and 1.55:1 on the tab,
    under the 3:1 a mark needs. Default: the warning amber.
  - **On the map, Time to fire over a waiting order draws no Waiting outline**, as on the card, so
    one table never shows two amber marks — though on the map Time to fire is a fill and an outside
    ring, not an outline, so the owner's "beneath a higher state that draws none" could be read the
    other way. Default: as the card.
  - **A zone tab's Ready words use the largest count at one table, while its delivery words add up
    the zone**: two Terrace tables with 2 and 3 dishes ready read "Terrace, 3 ready". Adding the
    ready counts up would count a merged party twice, since each of its tables carries the party's
    whole count; the plan decides neither way. Default: as built.
  - **When two hidden tabs beyond the same end of the zone strip are equally urgent, the one
    earlier in the tab order gives the edge mark its icon and is scrolled to**: beyond the right
    end, that is the one nearest the strip; beyond the left end, the one farthest from it. The
    alternative is the one nearest the strip at both ends. Default: as built.
- two spacing points from A757 slice 2's look (2026-10-20): in the table drawer, "Still to pay at this
  table" sits right against the "Mark bill requested" button; and at 390 px the floor's list cards
  started flush against the left edge — seen inside a test frame only, so check the running till
  first.

Two owner suggestions are open; settle them here:

- "Dashes should maybe be used for any table which is unoccupied" (owner, 2026-10-18, Q42 notes) —
  Free, Reserved and Needs clearing all dashed, told apart by colour and cue. Weighed in A797's
  revision (2026-10-21, pictures `08-unoccupied-dashes`), asked as Q51 (e); a small slice in
  A757's area if approved.
- "It feels like we need a key of the different states when we click the ?" (owner, 2026-10-18) —
  with help on, the floor shows a badge, “What the colours mean”, that opens a key of every table
  state.

Once A893 settles the look, add the “What the colours mean” badge on the floor; A582 slice 4 left
it, see its plan's decision 8
([2026-10-20-a582-4-till-help.md](../superpowers/plans/2026-10-20-a582-4-till-help.md)).

## A936. Waiting's minutes on the map

**A936 (left open by A757 slice 5).** Picture 07 draws a waiting table's cue on the floor map as
"⏱ 6′", the minutes the order has waited; slice 5 draws the word "Waiting" («Esperando») instead,
because the floor read sends a table only its timing band (`timingBand`, documented at
`apps/till/src/api/client.ts`, and the `long_wait` signal's `band`,
`packages/shared/src/table-signals.ts`), not its dishes' ages. Showing the minutes means the floor
read also carrying the oldest fired dish's age, and the map's cue counting up from it. The owner
reviews the word against the minutes in A893 first.

## A937. Measure the owner's real floor plan once it is drawn

**A937 (left open by A757 slice 5).** The floor map hides a table's cue under 36 px (`CUE_MIN_PX`)
and its name under 28 px (`NAME_MIN_PX`, both in `packages/ui/src/floor-plan-geometry.ts`). Slice 5
measured Santet's plan, whose positions are an invented grid (`local/square/import.mjs`), not the
owner's floor: its Terrace zone, eight tables in one row, draws them at 28.7–32.5 px on a phone, so
they show names but no cue. Once the owner's real floor is drawn, measure each zone's tables at 390
and 360 px in the till page and bring any zone under either limit back to the owner.

## A859. Floor plans and the till's layout banner: looks left to the owner

**A859 (2026-10-18).** A504's LOOK passes kept these as built, as judgement calls: the solid
"Default" badge (the mock-up's is a pale pill); no explanation line in the Add set dialog; the
Delete dialog's "Used by Dinner." reads oddly when a set and a period share a name; the till's
banner is a plain line where the mock-up draws a tinted box (`wt-banner` would be close); the 390 px
floor menu's heading is in sentence case, not small capitals. Mock-ups:
removed from the repository on 2026-11-02. Left open by A504.

## A860. Automatic floor-place checks in TypeScript and SQL

The automatic catch-up decides whether a table's new place is taken in `catchUpPass` and in SQL
`catchUpDue`/`placeTaken` (`apps/server/src/floor-today-store.ts`). Only their geometry is pinned
across the two (`apps/server/src/reset-row-moves.test.ts`). Next: share or test the exclusions too.
Manual actions no longer apply this rule. Left open by A504.

## A1333. A table with no dishes left can still show "Another order?" (left open by A803 slice 4b).

A table that sent its own order keeps those order times after every bill has left, so the step
stays. Run at `c11d7ff0c3`, before 4b's service-step fix, a party moving its one fired bill to a
free table left its old table on "Another order?". Decide whether that is wrong: the people may
still be sitting there. See #2454's "Left open". Since A803 4c, Split anyway (everything ticked
goes) reaches this state more easily; it stays the owner's question. The same holds for a step
that follows a Done ("Coffee?"), including a Done copied with a bill that has since moved on again
(#3507's re-read: a bill moved from table 1 to free table 2, then on to free table 3, left table 2
showing "Coffee?").


## A1421. The Downstairs map drawn tiny at phone width

Seen once on `59be31e3b7` during A1386's investigation, in the demo venue (screenshots in
`~/waitron-campaign-c/a1386-shots/`), and not investigated: at phone width (390 px), the Downstairs
bar's map draws its tables as three 10-pixel dots in a map 29 pixels tall
(`e13-next-signin-390-light-en.png`).


## A1082. At 390 px the counter till's top bar is cut off.

Seen, 2026-10-24 (A789 slice 2's
look, `11-counter-sale-390-light.png` in `~/waitron-campaign-c/a789-2-shots/`): the first tab,
Counter with its zone, reads "Counter: Do", and the buttons after it (Floor, Parked, Waiting)
are out of sight; the bar scrolls inside itself, while the page itself does not scroll sideways.
A handheld's top bar fits at the same width. Slice 2 did not change the top bar,
so I believe it predates it.


## A1235. Parked orders, Waiting and department transfers can still name a table bill by an old table (left open by A803 slice 2).

Parked orders now shows a table bill's stored number and
name, but builds it on `orderLabel` (`apps/till/src/widgets/held-orders.ts`), which joins the
table with the bill's own label. A split bill is labelled with its table when it is made
(`orderTableLabel`, `apps/server/src/bill-actions.ts`) and a move to another table does not
change that label, so by reading, Sam's split bill moved from table 2 to table 4 is listed as
"4 · 2 · Bill 1 · Sam" where the table screen says "Bill 1 · Sam" (not run). A765 keeps a party
bill's own label on purpose (`apps/till/src/widgets/order-table-names.test.ts`), so dropping it
is a decision. The counter's Waiting list and department transfers (`counter-waiting.ts`,
`department-transfers.ts`) show no bill number or name at all.


## A997. An open order's item counts change when its dish's unit is changed (left open by A757 slice 6).

A line freezes its unit's decimal places (`unit_precision`) but not whether the unit
is a measure or a scale's, so `readOrderStateCounts` (`apps/server/src/order-state-counts.ts`)
reads those from the product's current unit. Measured 2026-10-22 with a case added for the run to
`apps/server/src/order-state-counts.test.ts` and not kept: a parked 330 ml dish read `ordered: 1`
before `assignProductUnit` moved its product to a whole-portion unit and `ordered: 330` after. The
plan's owner point 15 names this default. The fix freezes that choice on the line, which takes a
migration.


The affected readers are `readOrderStateCounts`, the floor’s ready and held counts, the
Current orders classification sent to Sent, and Find a bill’s saved item count. Find a bill
excludes open drafts; Parked orders can include them.

## A900. A757 slice 7's open questions, built with defaults (left open by slice 7, 2026-10-19).

For the owner, a candidate question to batch: the words the pictures do not draw — the fifth
start's label ("Repeats after the last order" / "Se repite tras el último pedido"), the Spanish
starter names ("Montar mesa", "Tomar nota", "¿Postre?", "¿Café o la cuenta?"), the Spanish labels, the minutes
field's screen-reader label ("Minutes" / "Minutos") and the required stars on the "Step" and
"Starts" column heads. Deleting a course removes the steps that start from it and, since A1526’s named starts,
their dependent steps too.
Since A918 slice 3 (2026-10-27) the starter names come from
`packages/venue-service/src/starter-content.ts`, in the staff language. Not put to the owner
(plan's question 3): a department created
later in the dashboard gets the starter steps. Also for the owner, from #1891's look and review: the
start box cuts labels short — "Repeats after the last order" at every width (Chromium on macOS:
the text needs 176 px and the box gives 150 on a desktop), and several more at phone width once
the minutes box grew to 120 px — so either a shorter fifth-start wording or the start on its own
line on a phone.
[Open questions](../superpowers/plans/2026-10-19-a757-7-service-step-settings.md#open-questions-each-with-the-default-this-plan-uses)


## A923. The voids and comps list is a plain table (left open by A758-2).

It has no column
chooser, Filters or remembered view, and its own CSS keeps the row menu on a phone's screen,
because the shared reorder helper (`ReorderController`) cannot reach `wt-data-table`'s rows. The other way is to teach
`wt-data-table` to reorder rows (a `packages/ui` change), giving every reorderable list one
table. Owner to choose.


## A1011. The owner looks at the till's Comp words as built (left open by A758-5).

Each works as
built; the owner may want it different. The list, with the built pictures, is under "For the owner
to look at" in [PR #1976](https://github.com/clintongormley/waitron/pull/1976): one Comp… per
dish and per extra at the counter; Free on the bill only under a reason allowing Free and a
percentage; the bill's window opening on %; the words no picture drew; the "Comp…" heading where
picture 04 draws "Comp"; the confirm steps never saying "Free"; the two windows asking in opposite
orders; Comp… still offered on a line already at €0.00 (the server refuses it, 409
`adjustment.no_reduction`); and two English refusals the Comp windows can show still saying
"discount" (`adjustment.exceeds_amount`, `adjustment.no_reduction`).


## A1031. The owner looks at A758-7's choices (left open by A758-7).

Each works as built; the
owner may want it different: held dishes fired on the way to the counter; each bill with food
still to come moved as its own counter order; the order keeping its table's zone, so a till or
pass limited to the counter's zone does not show it; a bill whose food to come has no kitchen
ticket staying with the table; the toast reusing "Moved to the counter"; and the settled-order
freeze now letting any paid table bill not yet handed over leave its party — only the server
limits that to Finish table — an exception `scripts/behavioural-triggers.test.ts` does not yet
hold. [Plan](../superpowers/plans/2026-10-22-a758-7-collect-at-counter.md#owner-points-each-with-the-default-this-pr-builds)


## A1033. A full invoice's later copies change their guests line when a bill moves to the counter (left open by A758-7).

A full invoice reads its guests from the bill's party each time
it prints, and only while the party's family holds exactly one bill (`readReceiptGuests`,
`apps/server/src/receipt-guests.ts`): the moved bill's copies lose the line, and when one of two
paid bills moves, the copies of the bill left behind gain one. A simplified receipt keeps the
count stored at payment.


## A957. The Spanish report still says «anulado» beside «Cancelaciones» (left open by A758-3).

The column «Valor de carta anulado» and the summary figure «Valor de carta de lo
anulado» (`packages/adjustments/src/dashboard/strings.ts`). D10 makes Void «Cancelar» and D22
asks for one word per meaning, but nothing gives these two phrases. The other way: «Valor de
carta cancelado» / «Valor de carta de lo cancelado». Owner to choose.


## A959. By reason's layout (left open by A758-3).

It now takes the whole row, so on a wide
window its numbers stand far apart and the last figure ("List value cancelled") sits right
against the Requested by names; on a phone the table scrolls sideways inside its box, with only
the cut-off last column to say so. Owner to look at the pictures and say whether either wants
changing.

## On a short phone the till's More menu is taller than the room it gets (found by A681's look, 2026-10-17).

On a handheld, since A797 slice 3, Log out follows the Settings group, last in ☰
but for A1096's "Powered by" line (and its rule) under it while a venue logo is in use, which adds
to the height (design §3.1), so with every entry offered it sits below the menu's bottom edge at
360×640 (759 px against a 632 px menu in Spanish, the build plan's slice 3 D6, probe B), and
nothing says the menu scrolls. First seen at 320×568 by A681's look (625 px of content in 552 px).
Since A1123 a handheld's More opens under ☰ rather than over the bar, so it has less room than
those measurements had.
Since TILL-HAPTIC-SWITCH, **Vibrate on button press** adds a row where the device has a touch
screen and its browser supports vibration; with it, a More that lists no screens no longer fits an
844×480 window, though Log out can still be scrolled to.
Decide whether More should show that it scrolls, or hold fewer items on a short screen.


## At 320 px in CI's fonts the till's two Spanish tabs do not fit their strip (found by A681's CI, 2026-10-17).

With a counter-zone menu, `test-till (1)` of run 39069802267 measured the tab
strip's content at 196 px in a 182 px box; locally the same check measured 178 px in 184 px. A681
leaves the bar's markup as it is on `main`, so this is believed to hold on `main` too (not run
there); the bar's design lets the tabs scroll sideways once everything else has moved. Decide
whether 320 px should show both tabs in full, and if so add a 320 px case to the "shows every
tab in full" check in `apps/till/src/widgets/till-shell.test.ts`.


## A787. Profile values on an open till refresh only at a profile switch or a change of zones (left open by A768, 2026-10-17).

Form factor, capabilities, idle logout, starting screen and
whether clocking is offered change the till's layout, so they are applied only where the till
already lays itself out again (A768's default; the owner has not decided). Decide whether any of
them should follow a profile edit made on the dashboard while the till is open.


## An element inside a shadow root attached after a drag starts keeps its own cursor rule during that drag

— left open by A642. The drag's override sheet is added to the document and to every
open shadow root present when the drag starts; in a shadow root attached mid-drag, an
element with a cursor rule of its own keeps it unless that rule reads `--reorder-drag-cursor`.
**Next action:** decide whether it matters; if so, have `holdPageCursor`
(`packages/ui/src/reorder-table.ts`) also reach shadow roots attached while it holds.
[Decision](till.md#decisions-and-deliberate-limits)


## Index the dishes not yet fired, so the pass's reads stop scanning every ticket item ever kept (left open by A773-2 PR C's review).

The coverage warning's read of dishes waiting for the pass
(`readPassCoverage`, `apps/server/src/pass-coverage.ts`) begins `SCAN ticket_items` in
`explain query plan`, measured on a freshly migrated database: no index on `ticket_items` leads on
`fired_at` or `requested_at`, so each refresh reads the venue's whole ticket history. The review
measured the same plan for the pass board's own card read (`scopedItems`,
`apps/server/src/pass-board.ts`), which predates PR C (its `ticket_items` read blames to
073d37ae9b, 2026-10-09). A partial index on unfired items could serve both and the Fire's card
read. This needs a migration.


## The table screen's sent list puts "at the pass" under a "Fired" heading (seen in A773-2 B4b's review; the owner's call).

«en el pase» rows sit under «Marchado», and "at the pass" is lower
case beside capitalised status words. Also: a dish asked for whose extra was recalled says
Fired in the sent list and Held in the dish window, which the review believed predates the
branch.


## Segmented choices still break words when whole words cannot fit (left by A773-2 B4b).

`wt-segmented-control` keeps words whole while they fit and otherwise breaks inside them to stay
in its space: the dashboard's Corners choice at 390 px in Spanish at 130% text and the till's
other-stations choice at 320 px in Spanish at 130% still break mid-word. Decide whether such a
control should stack its choices instead. [Design system](../developers/design-system.md)


## Look at what A773-2 B4b's look at the running app did not reach.

The table screen's «en el
pase» (wait for the owner's table screen redesign) and the closed-station alert on the dashboard's
alerts page.

Found by the look, for the owner to decide: a held dish on the pass has no "state · station" line,
so unless its station is closed the pass does not say which station the dish will go to.


## A857. A booking can take a table the evening's layout puts away (2026-10-18).

Bookings refuse
a part of a joined table, and on the business day a zone has recorded a set for, also a joined
table the last reset's copy leaves off while placing a part; on any other date, or under a record
naming no set, every part and no joined table (`requireActiveTable`,
`packages/bookings/src/bookings.ts`).
Nothing compares the table with the layout due at the booking's time. Spec §11: the editor could warn, or the booking screen refuse. Left open by A504.


## A1101. Short names on the floor map where a full name does not fit, and on printed kitchen tickets.

A797's design proposes both (§3.7, §9) as later choices for the owner; A797 builds
neither. Today the map hides a table's name when the table's shorter side is drawn under 28 px
(`NAME_MIN_PX` and `showsName`, `packages/ui/src/floor-plan-geometry.ts`), and the kitchen ticket
prints the table's name as the floor shows it — its group's or its own name for today, else its
full name — and never its short name (`tableLabel`, from `orderTableLabels` in
`packages/db/src/party-table-labels.ts`). Ask the owner first.


## A1108. The till order screen's Sent panel reads "Sent !" and "Held ·".

Seen, 2026-10-25 (the
A797 slice 1 look, `f-header-window1-1024-light-en.png` and `f-header-window1-1024-dark-es.png` in
`~/waitron-campaign-c/a797-1-shots/`): a space before the "!" ("Sent !", «Enviado !»), and the
Held line ends in a separator with nothing after it, where the Served line above reads
"Served · 0 · €0.00".


## A1211. The Served toast covers the Order screen's Fire / Send all buttons.

Measured
2026-10-29 in A1125's review (the probe was not kept); left open by A1125, #2238. At 1024×768 it
covers the top 26 px of Fire / Send all; on a 390 px phone, all of Move to…. A fixed lift like
the Ready bar's does not fit a bar that is not always at the window's foot; the owner chooses
where the toast goes.

Dropping the till's bottom toasts to one gap above the window's foot was tried on 2026-11-17
(#3588) and not kept: it moves the overlap rather than ending it. Measured then in Chromium (the
probe was not kept): on a 390×844 phone handheld the toast, at 778–832 px down the window, covered
Pay (784–828 px), which it had cleared before; on a till at 1024×768 it covered the bottom 34 px
of the 62 px Fire and Send all buttons. The toasts' present lift, a tap target and two gaps
(`.submitted-toast` in `apps/till/src/till-app.ts`), was room for a language button that A187
moved to the top bar, so it does not bind the owner's choice of where the toast goes.


## A841 slice 6 wording to confirm (2026-10-23).

For the owner: Advanced's heading and opening
line now carry text, as the design words them (slice 11b: "Advanced: set colours and text by
hand", and a sentence that a text size set there grows and shrinks with Text size); the names given to colours outside the 22 (Error colour, Delete buttons
switched off, Warning colour, Google button outline, Search highlight, Floor map tables, Table
card edge) and the folded "zone tab colours"; the two-sentence warning for a colour drawn both
ways, and the one sentence when it has no fix; the row buttons' spoken names, "Use worked-out
colour: Page, light screens"; "Brand colour" on Main buttons with Waitron's; and the light form
of the saved row's "set by hand".


## The counter till's top bar and bill window at 130% (measured 2026-10-27, A841 slice 11b's look check).

The bar's middle strip scrolls sideways (`.till-strip`, `apps/till/src/widgets/till-shell.ts`)
and More repeats its actions, so nothing is lost, but buttons are scrolled out of view. Strip
content / visible width: 1280 × 800 in Spanish, Serif at 130%, 959 / 899 px ("Pase" out of
view); the device's own typeface at 130%, 921 / 917; Waitron's own look at 100%, 940 / 940. At
1024 × 768 the strip overflows in every setup measured, Waitron's own look at 100% included
(724 / 684 English, 789 / 684 Spanish). At 1024 × 768 and 130% the bill's scrolling area is
48–64 px tall, less than one bill line, against 110 px for Waitron's look at 100%. Not measured on
main, so whether the 1024 overflow predates slice 11 is unchecked. Readings:
`~/waitron-campaign/a841-11b-shots/look-report-11b.md` (lane A's machine).


## WebKit in CI for A841's start-up checks (lane A ruling, 2026-10-21).

The dashboard's and the
till's `venue-theme-startup.test.ts` run in Chromium in CI; WebKit was measured once, locally
(`WAITRON_STARTUP_ENGINES=chromium,webkit`; receipt in `docs/developers/testing-guide.md`). To gate
it: install WebKit in those shards under a bounded, retried apt step (CLAUDE.md §2), give the
Playwright cache a key per engine so Chromium-only jobs do not save a cache without WebKit, and set
the variable for those suites. Whether WebKit's Linux libraries are missing from `ubuntu-latest`
is an assumption to check first.


## Uploaded font files for themes (owner, 2026-10-20, A841 Q7 B) — after A841.

A theme's
Typeface may also be a font file the venue uploads, so every screen draws the bar's own face. The
owner asked for it "designed and built after this as their own item". To settle in its own design:
the licence (the venue must be allowed to serve the font to its own screens; Waitron cannot check
that), which formats and what size limit, where the files are stored and served (the image library
takes images only), how a till caches them for a restart without the box, `font-display: swap` so
no screen waits for a file, registering each font for the whole page (a page-level `@font-face`
or `document.fonts.add`) so the theme editor's preview can draw it — an `@font-face` inside a
component's shadow stylesheet does nothing in Chromium 156 (A841 design, section 5a) — and re-running A841's 130% layout cases and hyphenation check in the
uploaded face. It plugs into A841's seam: the typeface list (`TYPEFACES` in
`packages/ui-core/src/theme/text.ts`), `typefaceStack()`, the dashboard's
`appearance.typeface.<value>` words in English and Spanish, and `@font-face` ahead of
`/api/theme`'s blocks (A841 design, section 5a).


## A1013. Online booking for customers (owner, 2026-10-22).

A customer books a table from the
venue's public page. The bookings module serves staff today (A429); this adds the public side:
the times the venue can take, the customer's booking form, confirmation and reminders. Needs
remote access (A951). While the box cannot be reached no booking is taken: Waitron Cloud's D88
proposal keeps no booking queue of its own. Backlog only, not queued to a lane.

A booking larger than any one table joins several small tables (owner, 2026-11-11: "when we do
bookings, if somebody wants to book a table of 10 people then we need to join several small tables
for that purpose"). A joined table is an ordinary group of its tables (owner's answer to R1's
proposal 3, the same day), so a booking for 10 holds a group of tables, and the booking screens
show the group's name. A bar counter's one-person fixed seats are joined the same way.

A deposit for a booking is an advance with its own ticket (the adviser's answer 1.8), and when a
no-show's deposit is kept the venue issues a corrective removing its VAT, though it refunds
nothing ("yes we should issue the corrective", owner, 2026-11-18, question 6 of the
[19 November sheet](../compliance/2026-11-19-adviser-meeting.md); the adviser is still to confirm the details). Waitron issues that corrective by itself, at every venue, when a booking is marked as a no-show and its deposit kept (owner, 2026-11-18). The owner chose prepayment
refunded on arrival ([comparison](../superpowers/specs/2026-11-15-booking-fees-and-no-show-charges.md)).


## On a 390 px phone the floor map cuts table names short at every text size.

It fits twelve
tables in squares about 30 px wide, so a name longer than three or four letters shows "Terr…"
until the map is pinched (the map's `text-overflow: ellipsis`,
`packages/ui/src/components/wt-floor-map.ts`). Left open by A841 slice 10b. At 360 px the labels
read "Uns…" and "Sin …" (A797 slice 3's LOOK, 2026-10-26, `l-floor-360-*.png` in
`~/waitron-campaign-c/a797-3-shots/`).


## Bundle: The owner's yes-or-no read: built defaults that wait only for a nod

39 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A case the content-language decisions leave open, built with the plan's default unless the owner
  says otherwise**: receipts outside Catalonia stay free, Spanish by default.
  [Detail](menu.md#a-case-the-content-language-decisions-leave-open-built-with-the-plans-default-unless-the-owner-says-otherwise)
- **The owner has not yet confirmed the Seasons window's plan defaults** (A721, sent as an FYI,
  2026-10-17): Decisions 2, 12, 13, 14, 15 and 17 of the
  [A721 plan](../superpowers/plans/2026-10-17-a721-seasons-window.md), each in
  [Decisions and deliberate limits](service-periods.md#decisions-and-deliberate-limits).
- **A723's plan defaults sent to the owner as an FYI**
  [Decisions](service-periods.md#a723s-plan-defaults-sent-to-the-owner-as-an-fyi)
- **A762's plan defaults sent to the owner as an FYI**
  [Decisions](service-periods.md#a762s-plan-defaults-sent-to-the-owner-as-an-fyi)
- **A1059. Add station and the station editor draw the late flags differently.** Add draws four
  full-width fields; the editor draws its four two to a row under "Late flags (minutes)"
  (`prep-stations-screen.ts` `#dialog`, `station-editor.ts`). Ask whether Add should match. Left
  open by A756 PR 5.
- **A1060. Ask whether A773's picture 10 replaces the station's three late-flag fields** with its
  one "Late after · 5 · 10 · 15 min" dropdown; A756 PR 5 kept A725's three (owner, 2026-10-15).
- **A1063. Picture 10 lists Identical dishes and Held courses above MOVED slips; the station editor
  puts them after it.** Owner FYI from A756 PR 6; say if the editor should follow the picture.
- **A1067. Owner FYI: the station editor's "Done on the screen" words.** "One item at a time" and
  "Whole ticket at once" (pictures 04 and 10; the old Kitchen tab said "Bump mode", "Per item",
  "Whole ticket"); Spanish «Marcado en la pantalla», «Un plato cada vez», «Toda la comanda a la
  vez», and the kitchen screen's «Toda la comanda». Say if other words read better (A756 PR 7).
- **A1068. Owner FYI: the station editor's "Changes after sending" words.** "Not allowed", "While
  held" and "While held or waiting"; picture 10's "(printer only)" was dropped because the middle
  value suits a printer-only station too. Spanish «Cambios tras el envío», «No permitidos», «Solo
  en espera», «En espera o sin empezar». Say if other words read better (A756 PR 8).
- **A1080. Owner question: which refusal wins when one save holds a started dish and a dish at a "Not allowed" station.**
  [Detail](kitchen.md#a1080-owner-question-which-refusal-wins-when-one-save-holds-a-started-dish-and-a-dish-at-a-not-allowed-station)
- **A1081. Owner FYI: the till's words for `ticket.already_fired`.** Since #2044 they no longer
  blame the station, because the server sends that code in other cases too: "This item has already
  gone to the kitchen and cannot be changed. You can cancel it" («Este plato ya ha ido a cocina y no
  se puede cambiar. Puedes cancelarlo»). Say if other words read better.
- **A1250. The pass marks a late card in the brand colour where the station board marks it amber
  (question for the owner).** Should the pass use amber too?
  [Detail](till.md#a1250-the-pass-marks-a-late-card-in-the-brand-colour-where-the-station-board-marks-it-amber)
- **A1253. A help badge on a button in the brand colour reads as part of the button (question for
  the owner, A582 slice 5's look check).** One answer: a thin ring of page colour round every badge
  in `wt-help-tooltip`, which changes every badge.
  [Detail](till.md#a1253-a-help-badge-on-a-button-in-the-brand-colour-reads-as-part-of-the-button)
- **A893. Owner review of every table state and its look, after A757 lands (owner, 2026-10-18).**
  Show the owner each state on the map and the card, both themes, with the pulses and zone tabs, and
  settle the two suggestions in the detail. A757 is built (slice 8, 2026-10-22); ready to show the
  owner.
  [Detail](till.md#a893-owner-review-of-every-table-state-and-its-look-after-a757-lands)
- **A936. Waiting's minutes on the map (left open by A757 slice 5).** The map's cue for a waiting
  table says "Waiting", not the minutes picture 07 draws, because the floor read carries only the
  timing band; showing minutes needs the oldest fired dish's age in the read.
  [Detail](till.md#a936-waitings-minutes-on-the-map)
- **A900. A757 slice 7's open questions, built with defaults (left open by slice 7, 2026-10-19).**
  Not put to the owner (plan's question 3): a department created later in the dashboard gets the
  starter steps.
  [Detail](till.md#a900-a757-slice-7s-open-questions-built-with-defaults-left-open-by-slice-7-2026-10-19)
- **A923. The voids and comps list is a plain table (left open by A758-2).** It has no column
  chooser, Filters or remembered view, and its own CSS keeps the row menu on a phone's screen,
  because the shared reorder helper (`ReorderController`) cannot reach `wt-data-table`'s rows.
  [Detail](till.md#a923-the-voids-and-comps-list-is-a-plain-table-left-open-by-a758-2)
- **A1011. The owner looks at the till's Comp words as built (left open by A758-5).** Each works as
  built; the owner may want it different.
  [Detail](till.md#a1011-the-owner-looks-at-the-tills-comp-words-as-built-left-open-by-a758-5)
- **A1020. The owner looks at A758-6's words and choices (left open by A758-6).** Each works as
  built; the owner may want it different: among them no Table finished on the pass, Not served
  found by its English name, and a finished table
  checked against all its bills' zones.
  [Detail](till.md#a1020-the-owner-looks-at-a758-6s-words-and-choices).
- **A1031. The owner looks at A758-7's choices (left open by A758-7).** Each works as built; the
  owner may want it different.
  [Detail](till.md#a1031-the-owner-looks-at-a758-7s-choices-left-open-by-a758-7)
- **A924. Void and Comp lozenges are neutral, not red and green as picture 01 draws (left open by
  A758-2).** `wt-lozenge` takes only a hex colour and a screen may not write one, so the word
  carries the meaning. Owner to confirm, or `wt-lozenge` gains token colours.
- **A925. Words on the voids and comps page that no picture drew (left open by A758-2).** The
  Delete question's sentences, the hint shown while searching («Borra la búsqueda para cambiar el
  orden.»), the Spanish intro and the limits («{percent}% por artículo», «{amount} por cuenta»), in
  `packages/adjustments/src/dashboard/strings.ts`. Owner to read them.
- **A952. The report's totals are headed "By action", not "By kind" (left open by A758-3).** Its
  rows are Voids and Comps («Por acción»), D10's names for both kinds and actions; design §3.6
  says "By kind" («Por tipo»). Owner to choose; the other way changes eight heading checks.
- **A953. By reason's column says "Requested by", not "Asked by" (left open by A758-3).** The
  entries list beside it already says "Requested by" («Solicitado por») for the same person; design
  §3.7 writes "Asked by". Owner to choose one word for both places.
- **A954. How the report's Reason filter behaves (left open by A758-3).** It keeps its choice when
  another person's list opens or the days change, and goes back to All reasons when the list
  closes. A deleted reason re-added under the same name shows twice in the field, because the
  report groups by the reason's id. Owner to confirm.
- **A956. The report's new words, for the owner to read (left open by A758-3).** Voids / Comps («Cancelaciones» /
  «Descuentos»), Void («Cancelado»), "Comp {amount}" («Descuento {amount}»), All reasons («Todos
  los motivos») and the reworded intro, in `packages/adjustments/src/dashboard/strings.ts`. The
  PR's pictures show them; owner to read them.
- **A957. The Spanish report still says «anulado» beside «Cancelaciones» (left open by A758-3).**
  The column «Valor de carta anulado» and the summary figure «Valor de carta de lo anulado»
  (`packages/adjustments/src/dashboard/strings.ts`).
  [Detail](till.md#a957-the-spanish-report-still-says-anulado-beside-cancelaciones-left-open-by-a758-3)
- **A958. Choosing a reason narrows the list, not the totals below it (left open by A758-3).** With
  Staff meal chosen, By action, By stage and By reason still count every reason for the person (or
  everyone) shown. Owner to confirm, or the breakdowns follow the chosen reason too.
- **A959. By reason's layout (left open by A758-3).** Owner to look at the pictures and say whether
  either wants changing.
  [Detail](till.md#a959-by-reasons-layout-left-open-by-a758-3)

- **A Ready card on the pass turns red, counts as overdue and says Forgotten, aged from when it was
  sent (question for the owner, seen in A773-2 B4a's look).** The old pass did the same. Should a
  card stop ageing once it is Ready? Relates to A1250's colour question.
  [Detail](till.md#a-ready-card-on-the-pass-turns-red-aged-from-when-it-was-sent)
- **An unpaid table bill showed two "Full invoice" buttons**: the payment panel's own
  (`till-tender-pay`) and the bill's smaller one (`#billChoices`,
  `apps/till/src/screens/till-table-order-screen.ts`), both drawn since A231 (#1256). **Next
  action:** owner to pick between drawing only the bill's own Full invoice button (as built) and the
  payment panel's.
  [Detail](till.md#an-unpaid-table-bill-showed-two-full-invoice-buttons)
- **A292's look is the owner's to judge** (#1310's "Looks for the owner to judge"; screenshots in
  lane C's `a292-shots/`): in the dark theme an available plain tile is only about 1.10:1 lighter
  than a sold-out one, and in the light theme a pale stripe shows mostly through the dark line
  beside it.
- **A856. A table that needs moving looks like one that needs clearing on the till's map
  (2026-10-18).** It takes the `clearing` fill; its words are on the list card, the Mark moved
  question and its accessible name. A marker of its own needs a new token pair or badge in
  `@waitron/ui`, an owner design decision. Left open by A504.
- **A859. Floor plans and the till's layout banner: looks left to the owner (2026-10-18).** A504's
  look passes kept five things as built, as judgement calls.
  Left open by A504.
  [Detail](till.md#a859-floor-plans-and-the-tills-layout-banner-looks-left-to-the-owner)
- **A841 slice 5 differences from the pictures and tidy-ups (2026-10-21).** Optional, for the owner
  to judge.
  [Detail](till.md#a841-slice-5-differences-from-the-pictures-and-tidy-ups-2026-10-21)
- **A841 slice 6 wording to confirm (2026-10-23).** For the owner: Advanced's heading and opening
  line now carry text, as the design words them (slice 11b: "Advanced: set colours and text by
  hand", and a sentence that a text size set there grows and shrinks with Text size).
  [Detail](till.md#a841-slice-6-wording-to-confirm-2026-10-23)
- **A841 slice 11: Waitron's own headings are one step lighter (2026-10-27).** The rule stands
  unless the owner says otherwise.
  [Detail](till.md#a841-slice-11-waitrons-own-headings-are-one-step-lighter-2026-10-27)

## Other till sentences still send the person to somebody else, against the refusal rule

Left open by A1382 (`device.forbidden_action`), #3605 (eight `codes.ts` refusals) and #3604 (the
till's own sentences and notice hints). What is left is fiscal and invoice wording. By code:

- `apps/till/src/i18n/codes.ts`: `fiscal.fingerprint_mismatch`, `series.no_rectificative_for_node`,
  `fiscal.taxpayer_domicile_missing`, `invoice_delivery.receipt_invalid`,
  `invoice_delivery.printer_invalid`, `invoice_delivery.receipt_unavailable`,
  `sale.correction_unsupported`, `department.operation_description_required`,
  `sale.charged_not_recorded`.
- `apps/till/src/i18n/strings.ts`: `sale.refused` and `place.refused`, which word the fiscal refusals
  `fiscal.record_invalid`, `fiscal.foreign_recipient_unsupported` and `sale.number_reused`.
- `apps/till/src/i18n/staff-notices.ts`: the `staff_notice.tell_manager` hint on
  `fiscal.records_unsent` with a held record.

Not listed: the owner's full-disk strip (`storage.disk_full` in `staff-notices.ts`) and the till's
other full-disk words (`storage.disk_full` in `codes.ts`, the `sale.disk_full` group in
`strings.ts`), which the owner's exception also covers (2026-11-06, A1384; see conventions-ui.md);
sentences that take a manager's PIN or choice on the spot; labels such as `approval.title_manager`;
and the joining steps `device.join_name_hint` and `device.join_approval_guide`, which are no refusal.

## Bundle: Printer identity at enrolment

Printer identity is separate from the till route inventory.

- **Qualify printer identity at enrolment.** Complete the device enrolment design's printer track.
  [Detail](till.md#printer-identity-at-enrolment).

## Bundle: Close the day: count the cash, record cash in and out, waiter floats

3 entries, size L. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1325. Close the day: count the cash and save the day's close — OPEN, design approved
  2026-11-06, no plan yet.** The north star's "closing". A close is a counted withdrawal from one
  drawer, built together with A239, and A240 can land after it.
  [Detail](till.md#a1325-close-the-day-count-the-cash-and-save-the-days-close)
- **Recorded cash in and out of a till's drawer (A239) — OPEN, covered by A1325's approved design.**
  Each top-up or removal of cash from a drawer is a recorded entry: who, how much, why, when.
  [Detail](till.md#recorded-cash-in-and-out-of-a-tills-drawer-a239--open-needs-a-spec-before-queueing-owner-2026-10-03)
- **Waiter cash floats (A240) — OPEN, needs a spec before queueing (owner, 2026-10-03).** Piece 3 of
  A238. Open: where a float's opening cash comes from (a till's drawer, or brought in). Needs A238
  (landed as #1164) and A239. Part of A1325's design, to queue soon (owner, 2026-11-04).
  [Detail](till.md#waiter-cash-floats-a240--open-needs-a-spec-before-queueing-owner-2026-10-03)

## Bundle: Joined-table writers keep their rows right

1 entry, size M. Its text is unchanged from the index it came from (backlog review, 2026-11-06).

- **A594. Moving a bill to a free table in a group seats only that table (2026-10-13).** The party
  holds part of the group, and can lose the group's today's name with no MOVED slip. Found by A579
  part 3b's review.
  [Detail](till.md#a594-moving-a-bill-to-a-free-table-in-a-group-seats-only-that-table)
## Bundle: One rule for what holds a table back at a reset

3 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A565. A reset does not wait for food on its way to an ordinary table (2026-10-13).** Dates
  from floor plans slice 1; #1604 made only split groups wait.
  [Detail](till.md#a565-a-reset-does-not-wait-for-food-on-its-way-to-an-ordinary-table)
- **A566. An open order with nothing sent yet does not hold a split group back at a reset
  (2026-10-13).** Left open by #1604.
  [Detail](till.md#a566-an-open-order-with-nothing-sent-yet-does-not-hold-a-split-group-back-at-a-reset)
- **A860. Automatic floor-place checks in TypeScript and SQL.** Share or test their exclusions;
  manual actions no longer apply this rule. Left open by A504.
  [Detail](till.md#a860-automatic-floor-place-checks-in-typescript-and-sql)

## Bundle: Show a table's short name where the full name does not fit

4 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A561. A 2 × 2 table's name is cut short on the till map (2026-10-13).** It shows "Cou…".
  [Detail](till.md#a561-a-2--2-tables-name-is-cut-short-on-the-till-map)
- **A562. A 2 × 2 table shows no name in the floor plan editor (2026-10-13).** Its name waits on
  A561's decision; seen more since tables come back at their kept size (#1604).
  [Detail](till.md#a562-a-2--2-table-shows-no-name-in-the-floor-plan-editor)
- **A1101. Short names on the floor map where a full name does not fit, and on printed kitchen
  tickets.** A797's design proposes both (§3.7, §9) as later choices for the owner; A797 builds
  neither.
  [Detail](till.md#a1101-short-names-on-the-floor-map-where-a-full-name-does-not-fit-and-on-printed-kitchen-tickets)
- **On a 390 px phone the floor map cuts table names short at every text size.** Left open by A841
  slice 10b.
  [Detail](till.md#on-a-390-px-phone-the-floor-map-cuts-table-names-short-at-every-text-size)

## Bundle: One measuring pass over the till at 390 and 1024

1 entry remains outside the order-and-extras pass: the header belongs to its bar decision, and
all floor-map and table-screen changes belong to the owner's redesign.

- **Screen faults seen during menus Task 9's look on 2026-09-27.** Recheck the floor-map overlap;
  the header observation stays with the top-bar bundle.
  [Detail](till.md#screen-faults-seen-during-menus-task-9s-look-on-2026-09-27)

## Bundle: Service steps after a bill moves

1 entry, size S. A1333's text is unchanged from the index it came from (backlog review,
2026-11-06).

- **A1333. A table with no dishes left can still show "Another order?" (left open by A803 slice
  4b).** A table that sent its own order keeps those order times after every bill has left, so the
  step stays.
  [Detail](till.md#a1333-a-table-with-no-dishes-left-can-still-show-another-order-left-open-by-a803-slice-4b)

## Bundle: The till top bar fits at phone width, 1024 and 1280

7 entries, size M. The remaining overflow and owner decisions are below.

- **A1082. At 390 px the counter till's top bar is cut off.** Seen, 2026-10-24 (A789 slice 2's look,
  `11-counter-sale-390-light.png` in `~/waitron-campaign-c/a789-2-shots/`): the first tab, Counter
  with its zone, reads "Counter: Do", and the buttons after it (Floor, Parked, Waiting) are out of
  sight; the bar scrolls inside itself, while the page itself does not scroll sideways.
  [Detail](till.md#a1082-at-390-px-the-counter-tills-top-bar-is-cut-off)
- **A921. On a narrow till, should the person's name give room to the tab strip? (question for the
  owner, left open by A582 slice 4a).** Since 4a the till's bar has the Help switch before the
  person's menu, and nothing else left the bar for it, so at phone width the tab strip, which
  already scrolls sideways, is 52 px narrower: with a long name at 320 px it is 8 px wide, so its
  tabs are reached only by scrolling a sliver. One answer: two tap widths for the name instead of
  three at phone width, which would give back 44 px. That changes A738's look, so it is the owner's
  call. [Detail](till.md#a921-on-a-narrow-till-should-the-persons-name-give-room-to-the-tab-strip)
- **A1219. At 390 px the till header clips «Pedidos aparcados» and hides its count** (Spanish; with
  one counter zone the Floor tab shows as "F" behind the "?" button). Seen in A1208's LOOK.
- **On a short phone the till's More menu is taller than the room it gets (found by A681's look,
  2026-10-17).** Decide whether More should show that it scrolls, or hold fewer items on a short
  screen.
  [Detail](till.md#on-a-short-phone-the-tills-more-menu-is-taller-than-the-room-it-gets-found-by-a681s-look-2026-10-17)
- **At 320 px in CI's fonts the till's two Spanish tabs do not fit their strip (found by A681's CI,
  2026-10-17).** With a counter-zone menu, `test-till (1)` of run 39069802267 measured the tab
  strip's content at 196 px in a 182 px box; locally the same check measured 178 px in 184 px.
  [Detail](till.md#at-320-px-in-cis-fonts-the-tills-two-spanish-tabs-do-not-fit-their-strip-found-by-a681s-ci-2026-10-17)
- **Loose ends left by A395 (#1435) and A425, the till's one-row top bar.**
  Open, decided as built: a change in the pending-transfer count alone never brings items back
  onto the bar, so when the count shrinks or goes away, items can stay in More although they
  would now fit, until the next resize or other change refits the bar.
  [Detail](till.md#the-tills-top-bar-is-one-row-at-every-width-a395-1435-left-open)
- **The counter till's top bar and bill window at 130% (measured 2026-10-27, A841 slice 11b's look
  check).** The bar's middle strip scrolls sideways (`.till-strip`,
  `apps/till/src/widgets/till-shell.ts`) and More repeats its actions, so nothing is lost, but
  buttons are scrolled out of view.
  [Detail](till.md#the-counter-tills-top-bar-and-bill-window-at-130-measured-2026-10-27-a841-slice-11bs-look-check)

Measured 2026-11-17 on `b7e7e5de0d`, normal till boot/sign-in in shared-Mac Chromium,
using `page.viewport` with `innerWidth` checked, Waitron’s own typeface and Ana Fernández.
With two counter zones (Bar/terrace, terrace selected), Pass and Transfers shown and zero counts:
at 390 px, the strip has 109 px against Counter alone at 178/193 px EN/ES and all six controls
at 674/739 px. At 1024 × 768, content is 682/747 px against 675 px at 100%, and 785/867 px
against 650 px at 130%. The measured 1280 × 800 cases fit at both sizes. These are not box
figures; the historical Serif 130% case above remains open. The permanent scrolling-strip
contract stays in force (design-system.md, Till shell). For a future owner review: keep scrolling
as designed, or revisit what stays on the bar? No collapse order is proposed.

## Bundle: One count of items everywhere

1 entry, size M.

- **A997. An open order's item counts change when its dish's unit is changed (left open by A757
  slice 6).** The fix freezes that choice on the line, which takes a migration.
  [Detail](till.md#a997-an-open-orders-item-counts-change-when-its-dishs-unit-is-changed-left-open-by-a757-slice-6)

## Bundle: One rule for a booking when the evening's layout changes

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A550. Making a booked table part of a joined table is not refused (2026-10-12).** The floor
  plan editor's save refuses deleting a booked table (`table.booked`) but not making one a part.
  Next: decide whether the save refuses it, as a delete is refused, or only warns.
  [Detail](till.md#a550-making-a-booked-table-part-of-a-joined-table-is-not-refused)
- **A857. A booking can take a table the evening's layout puts away (2026-10-18).** Nothing compares
  the table with the layout due at the booking's time.
  [Detail](till.md#a857-a-booking-can-take-a-table-the-evenings-layout-puts-away-2026-10-18)

## Bundle: What an open till picks up from a setup change

1 entry, size S. Its text is unchanged from the index it came from (backlog review, 2026-11-06).

- **A787. Profile values on an open till refresh only at a profile switch or a change of zones (left
  open by A768, 2026-10-17).** Form factor, capabilities, idle logout, starting screen and whether
  clocking is offered change the till's layout, so they are applied only where the till already lays
  itself out again (A768's default; the owner has not decided).
  [Detail](till.md#a787-profile-values-on-an-open-till-refresh-only-at-a-profile-switch-or-a-change-of-zones-left-open-by-a768-2026-10-17)

## Bundle: Small till and floor wording fixes

5 entries, size M. Four keep their text from the index they came from (backlog review, 2026-11-06);
the remaining till unit and tab edges joined on 2026-11-12. A470, A1106 and A1107 (the floor) and A1108
(the order screen's Sent panel) wait for the owner's redesign of the table screens (watcher, 2026-11-15).

- **Remaining till unit and tab edges (A379/A385 run-it review).** The Kitchen
  title stays English in a synthetic Spanish probe; legacy unit maps cover English and Spanish only.
  [Detail](till.md#remaining-till-unit-and-tab-edges-open-unqueued-a379a385-run-it-review)
- **A470 — the till's floor map follow-ups (2026-10-10).** Small gaps the till's map left: an
  unmeasured screen-reader activation and two wordings. Left open by A429 slice 3.
  [Detail](till.md#a470--the-tills-floor-map-follow-ups)
- **A1106. The till's List cards say "1 items".** Seen, 2026-10-25 (the A797 slice 1 look,
  `h-list-dining-390-light-en.png` in `~/waitron-campaign-c/a797-1-shots/`): Window 1's card reads
  "€6.50, 1 items". Fix: a singular wording for a count of 1.
- **A1107. Spanish calls a forgotten table «Olvidado» on its details sheet and «Olvidada» on its
  List card.** Seen, 2026-10-25 (the A797 slice 1 look, `g-details-window1-390-light-es.png` and
  `h-list-dining-390-light-es.png` in `~/waitron-campaign-c/a797-1-shots/`), for the same table.
- **A1108. The till order screen's Sent panel reads "Sent !" and "Held ·".** Seen, 2026-10-25 (the
  A797 slice 1 look, `f-header-window1-1024-light-en.png` and `f-header-window1-1024-dark-es.png` in
  `~/waitron-campaign-c/a797-1-shots/`): a space before the "!" ("Sent !", «Enviado !»), and the
  Held line ends in a separator with nothing after it, where the Served line above reads "Served · 0
  · €0.00".
  [Detail](till.md#a1108-the-till-order-screens-sent-panel-reads-sent--and-held-)

## Bundle: Status words on the pass and beside it

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **The table screen's sent list puts "at the pass" under a "Fired" heading (seen in A773-2 B4b's
  review; the owner's call).** «en el pase» rows sit under «Marchado», and "at the pass" is lower
  case beside capitalised status words.
  [Detail](till.md#the-table-screens-sent-list-puts-at-the-pass-under-a-fired-heading-seen-in-a773-2-b4bs-review-the-owners-call)
- **Look at what A773-2 B4b's look at the running app did not reach.** The table screen's «en el
  pase» and the closed-station alert on the dashboard's alerts page.
  [Detail](till.md#look-at-what-a773-2-b4bs-look-at-the-running-app-did-not-reach)

## Bundle: The "Goes with" line

1 entry, size S. Its text is unchanged from the index it came from (backlog review, 2026-11-06).

- **Should a counter order say "Goes with {stations}"? (question for the owner, left open by
  A773-2 PR D, its plan's D120).** A counter order has no groups, so a Bar drink on a counter order
  whose Grill burger waits for the pass prints no "Goes with Grill", and its station card shows
  none. The cue is worked out per group; a counter order would need its own rule.

## Bundle: Guest-facing QR, online ordering, delivery, online booking

4 entries, size L. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A508. A table's QR code: order, call a waiter, ask for the bill or pay (owner, 2026-10-11).**
  When a tab is opened for seated guests, a QR code is printed for them; on their own phone it
  opens the menu to order from, a button to call a waiter, and one to ask for the bill or pay
  online. Backlog only, not queued to a lane.
  [Detail](till.md#a508-a-tables-qr-code-order-call-a-waiter-ask-for-the-bill-or-pay)
- **A509. Online ordering for collection at the counter (owner, 2026-10-11).** A customer orders
  from the venue's online menu and collects at the counter. Needs the internet, as A508 does.
  Backlog only, not queued to a lane.
  [Detail](till.md#a509-online-ordering-for-collection-at-the-counter)
- **A1012. Delivery for online orders (owner, 2026-10-22).** An A509 online order taken to the
  customer's address instead of collected. Needs the internet, as A509 does, and comes after it.
  Backlog only, not queued to a lane.
  [Detail](till.md#a1012-delivery-for-online-orders)
- **A1013. Online booking for customers (owner, 2026-10-22).** Needs remote access (A951). Backlog
  only, not queued to a lane.
  [Detail](till.md#a1013-online-booking-for-customers-owner-2026-10-22)

## Bundle: Table screen panels that do not fit

3 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1359. At 1280 by 800, Split a table's panel opens low (seen in A803 slice 4c's LOOK).** Its
  heading sits at 579 of 800 px with about three rows showing, because the side panel sits below the
  order; Move dishes sits in the same place but is short enough to fit.
- **A1265. The table screen's ⋮ list is taller than the room below it, so Finish table starts below
  the fold (seen in A803 slice 3's LOOK, finding F8).** Nothing is lost, but the whole-table actions
  are easy to miss. Decide whether the list gets shorter (fewer items, or tighter rows) or the table
  section comes first.
  [Detail](till.md#a1265-the-table-screens--list-is-taller-than-the-room-below-it-so-finish-table-starts-below-the-fold)
- **A1290. The table screen's action panel can put Back and its action half below the window, and "+
  New bill" touches Back (seen in A803 slice 4a's LOOK).** Both are the shared action panel's layout
  (`aside.action-panel` in `apps/till/src/screens/till-table-order-screen.ts`).
  [Detail](till.md#a1290-the-table-screens-action-panel-can-put-back-and-its-action-half-below-the-window-and--new-bill-touches-back)

## Bundle: One answer to "where is this order"

3 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1235. Parked orders, Waiting and department transfers can still name a table bill by an old
  table (left open by A803 slice 2).** Parked orders now shows a table bill's stored number and
  name, but builds it on `orderLabel` (`apps/till/src/widgets/held-orders.ts`), which joins the
  table with the bill's own label.
  [Detail](till.md#a1235-parked-orders-waiting-and-department-transfers-can-still-name-a-table-bill-by-an-old-table-left-open-by-a803-slice-2)
- **A1032. Nothing on the pass says an order waits at the counter (left open by A758-7).** A paid
  order a finished table sent to the counter is named on the pass and in Waiting orders by its
  number and the table it was paid at ("#12 Mesa 4"), as Move this bill → The counter names one
  today; only the MOVED slip and the station notice say "counter".
- **A678 — Two readers answer "where is this order" (2026-10-14; open).** `readOrderPlaces`
  (used by MOVED slips) reads a counter order whose delivery table was released as the counter,
  while `orderTableLabels` (used by tickets and correction slips) names it by its kept
  `delivery_table_label`. Once the edge is decided, one reader in
  `packages/db`. Left open by A650 Part 1.
  [Detail](till.md#a678-two-readers-answer-where-is-this-order)

## Bundle: What a row action takes on a grouped row

3 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1193. Choosing which portions of a grouped row an action takes, and Fire now on a grouped
  row (left open by A803 slice 1, D14 and D31).** Actions on a row take a count, never chosen
  portions, and Fire now fires only the row's first portion. Since slice 4a, Move dishes… picks a
  row's first portions too; comp, void and Fire now are unchanged.
  [Detail](till.md#a1193-choosing-which-portions-of-a-grouped-row-an-action-takes-and-fire-now-on-a-grouped-row)
- **A1194. Finish table cancels a grouped row one portion at a time (left open by A803 slice 1).**
  Three identical unserved burgers give three keep-charge cancels of one and three "1 x" slips,
  where one line of three gives one cancel and one "3 x" slip. Pinned as it is by the "Finish
  table" case in `apps/server/src/order-portions.adjustments.test.ts`.
- **A1198. Owner question: should a portion moved to another bill and back rejoin its row? (left
  open by A803 slice 1, D9).** On portions it rejoins its first row and files with it; on one line
  per dish count the part carved off comes back as a row of its own.

## Bundle: Take over offered where it is needed

2 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1349. Take-over rows exist only in Split a table (left open by A803 slice 4c).** The rows that
  let a waiter take over someone else's unsent dishes on a bill not on screen (A773 §6) are drawn by
  `widgets/split-picker.ts` alone; Join tables and the moves still read no `conflicts` from
  `draft.taken_over`.
- **A1289. Moving dishes onto a bill with someone else's unsent dish says "This order belongs to
  someone else. Reload the table to see it" (seen in A803 slice 4a's LOOK).** Decide the words, and
  whether the refusal offers Take over in place.
  [Detail](till.md#a1289-moving-dishes-onto-a-bill-with-someone-elses-unsent-dish-says-this-order-belongs-to-someone-else-reload-the-table-to-see-it)

## Bundle: Part-quantity handling of whole dishes

1 entry, size S.

- **A1197. Is part-quantity handling of a whole dish still reachable outside tests? (left open by
  A803 slice 1, D12 and D26).** New dishes reach an order through `createOpenOrder`, `placeGroups`
  and the whole-order save's new lines, and each of those stores every whole dish (a unit with no
  decimal places, no scale and no measure) as a line of its own. Tests still write one line
  holding several whole dishes: through grouped helpers in `apps/server/src/testing/`
  (`addGroupedTabRound` in `order-writer-fixture.ts` is one), by pricing a round and inserting it
  unexpanded, or by setting a row's quantity by hand. A803 slice 1's D12 kept the part-quantity
  paths (part cancel, part serve, part split and transfer, part adjustment and item payment) for
  measured lines and grouped counter lines. Not traced: which of them a
  measured line still uses, and whether the save's rise of an existing line that is not a portion,
  or a transfer's part row, can still produce a line of several whole dishes. Establish that, then
  remove the rest together with the tests that reach them only through a grouped row a test wrote.

## Bundle: Add a device: loose ends from A268

1 entry, size S.

- **Loose ends left by A268 (add a device, like adding a printer, owner 2026-10-04).**
  - W105b (#1248, a disabled device coming back as itself): an ask whose response is lost comes
    back as a new device, and two asks under one id are not forced to differ in time when no ask is
    waiting.
    [Detail](till.md#what-w105b-left-open-1248-a-disabled-device-coming-back-as-itself)
  - W104 (#1225), not acted on: the dialogs were never looked at on a box.
    [Detail](till.md#what-w104-left-open-1225)
  - W106 (#1240): whether the plain `YYYY-MM-DD HH:MM` times on Devices, Printers, the menu
    preview and the adjustments report should use `wt-relative-time`, and whether its inline
    words may stay below `--wt-tap-min`, are the owner's call.
    [Detail](till.md#what-w106-left-open-the-battery-on-the-devices-list-1240)

## Bundle: Nothing covers the order screen's bar

1 entry, size S. Its text is unchanged from the index it came from (backlog review, 2026-11-06).

- **A1211. The Served toast covers the Order screen's Fire / Send all buttons.** Measured 2026-10-29
  in A1125's review (the probe was not kept); left open by A1125, #2238.
  [Detail](till.md#a1211-the-served-toast-covers-the-order-screens-fire--send-all-buttons)

## Decisions and deliberate limits

- **A table's seats are a guide, never a limit (owner, 2026-10-08, A429 decision 6).** The seat
  count is one number, used as a guide and for bookings; the till seats a larger party without a
  refusal.
- **The till's `TableState.today` stays nullable, wider than what the server sends (watcher,
  2026-11-18, lane A, not the owner; the owner may overrule).** `/api/tables/state` lists only
  on-floor tables in switched-on zones (`packages/db/src/table-in-service.ts`), and
  `readTodayTables` (`apps/server/src/working-order.ts`) reads a row for every one, so the server
  never sends a table without today's row. Making the till's type required would rewrite 69
  fixtures in 55 till test files, most of which would need a placed row rather than a plain swap,
  for no change a venue would see.

- **A sent dish keeps the options answer it was sent with on a whole-order save (owner, 2026-11-17,
  A1416: "Keep what was sent").** `updateHeldOrder` neither checks it against today's menu nor
  rewrites it while the save names no answer the dish does not already hold, so a rename after
  sending cannot block the order. A save naming a different answer is a change, as through Change
  dish (`updateOrderLine`): the kitchen gets a recall and a new ticket, or the save is refused once
  the dish is started or served, or when its station refuses changes after sending.

- **A parked dish not yet sent keeps a recorded options answer the menu no longer matches (lane B,
  2026-11-18, not the owner; the owner may overrule).** The till asks staff to choose only when more
  lists are unanswered than recorded answers went unmatched;
  [the rule](../developers/modifiers.md#ordering-and-stored-facts).

- **The server still works out each pass dish's age colour, which the till does not read (A773-2
  B4 plan, D68, 2026-11-02, not the owner).** "The server's `band` stays correct for any other
  reader and is not read by the till." [Plan](../superpowers/plans/2026-11-02-a773-2b4-pass-screens.md)

- **Saving a device on Devices (Edit or Pair) reads the device list twice while the live connection
  is up (watcher, 2026-11-17, lane B, not the owner; the owner may overrule).** "Follow
  docs/developers/dashboard-live-updates.md:123-128 — call this.api.liveData?.invalidate([{ type:
  "devices" }]) after the Edit save and the Pair accept, so a person always sees their own save
  through the screen's watch." After the write the screen marks the list out of date, so its own watch reads it again, and the
  server's change notice asks once more, so a person sees their own save even when the event stream
  has gone silent ([why](../developers/dashboard-live-updates.md)). Measured in a browser test with
  the notice stood in for after the screen's own read: one read from the save, a second from the
  notice ("… with no live notice, read once, and once more on the notice" in
  `apps/dashboard/src/screens/devices-screen.test.ts`).

- **Editing a device still has to send its name, its profile and, unless the profile is a kitchen
  display, its receipt and payment-slip printer choices (lane B, 2026-11-18, not the owner; the
  owner may overrule).** The edit request (`PATCH /management-api/devices/:id`) does not treat every
  field as optional, as #1235's review suggested: its one caller, the Devices screen's Edit
  (`updateDevice` in `apps/dashboard/src/api/client.ts`), always sends them, so that would add a
  path nothing uses.

- **A copy of a deleted device's cookie can still ask to come back first, and so make the real
  device's cookie stop working (watcher, 2026-11-18, lane B, not the owner; the owner may overrule;
  confirmed the same day after review showed that on a box serving plain HTTP the cookie crosses
  the network unencrypted).** Each ask to come back gives the asking browser a new cookie and makes the old one
  worthless (`createJoinRequest` in `apps/server/src/join-requests.ts`), so the real tablet's next
  ask joins as a new device, and a manager gives it its name and profile again. It stays because a
  copy taken while the device was enabled already let its holder act as the device, and keeping the
  old cookie valid as a second lasting proof would add a credential to guard. A page's scripts
  cannot read the cookie (`httpOnly`, `setDeviceCookie` in `apps/server/src/device-session.ts`). It
  is marked `Secure` only when the box serves the tills over HTTPS (`secureCookies` in
  `apps/server/src/boot.ts`); on a box serving plain HTTP it crosses the venue's network
  unencrypted, where anyone reading that traffic could copy it and act as the device while it is
  enabled: that is the wider exposure, and a second lasting proof would not close it. One function
  decides HTTPS or plain HTTP for both the tills' listener and these cookies (`resolveTradingTls`,
  `apps/server/src/trading-tls.ts:10`, read at `apps/server/src/boot.ts:917` and `:2443`): the
  certificate and key named in `WAITRON_TLS_CERT_FILE` and `WAITRON_TLS_KEY_FILE`
  (`apps/server/src/config.ts:425`), else the box's own certificate in its state folder
  (`mintedBoxLeaf`, `apps/server/src/box-secrets.ts:70`); with neither, plain HTTP. Whether a
  set-up production box can start with neither was tried on 2026-11-18 (lane B). What was run: the
  built `node-entry.js`, the box image's entry (`deploy/Dockerfile:344`), stamped as a release and
  started as its own process on a Mac, not inside the image, on a venue marked production that
  test helpers seeded, not the setup pages. Its state folder held the `tls/` folder and
  `secrets.env` that a setup start writes (`ensureBoxSecrets`) and a `trading.env` naming the node
  and `WAITRON_ENV=production`. Each start was asked for `/health`, `/api/locales`, `/api/staff`
  and `/api/till` over HTTPS and over plain HTTP. Untouched, it answered all four over HTTPS and
  dropped plain HTTP. With `tls/server.pem` deleted, made unreadable or overwritten with other
  text, or with the whole `tls/` folder deleted, it answered all four with 404 over plain HTTP and
  served only the page titled "Waitron — Set up secure connection": the entry checks the
  certificate before it starts the server (`needsConnectionBootstrap`,
  `apps/server/src/node-entry.ts:447`). With `tls/` and `secrets.env` both deleted the start ended
  with `credentials.key_missing`, and with the state folder emptied it ended with
  `deployment.environment_mismatch`; neither listened on the port. One start did answer the four
  over plain HTTP: an emptied state folder, with the node's id, `WAITRON_ENV=production` and the
  box's key (`WAITRON_CREDENTIALS_KEY` and its version) handed to the process as environment
  variables. The box's own install hands the server none of those three (`deploy/compose.yml`,
  `deploy/Dockerfile` and `deploy/waitron.sh`, searched for the three names), so that start is a
  server somebody runs by hand, not an installed box. Not tried: a certificate that goes missing
  while the server is running, what a box serves after several failed starts in a row, and the
  image itself. The probe was a throwaway test file and is
  not in the tree. Outside development mode a copy can ask only while the venue's join window is open,
  "held open by the dashboard dialogs that are open" (`apps/server/src/pairing-mode.ts`); with it
  shut the ask is refused `device.pairing_closed` and replaces nothing ("with no Add a device dialog
  open, a disabled device's knock is refused and changes nothing" in
  `apps/server/src/join-e2e.test.ts`). An ask that is taken only waits: a route that requires the
  device refuses it (`requireDeviceProof`, through `readDeviceProof`, reads only `active` devices,
  `apps/server/src/device-session.ts:197`) until a manager with hardware administration checks the
  number on the device's screen and accepts
  (`POST /management-api/device-join-requests/:id/accept`, `apps/server/src/join-api.ts:334`).
  Pinned by "knocks as itself, is listed as returning, and Pair enables the same row with its
  settings" in `apps/server/src/join-e2e.test.ts`, for the device's own read
  (`GET /api/device/me`). In development mode (`devMode`) an ask is accepted at once (the `auto`
  branch of `POST /api/device/join` in `apps/server/src/device-api.ts`).

- **A sold-out extra stays on a reopened held order, flagged, and only a raise of its line is refused
  (owner, 2026-09-23, lane B Q1, option A: "keep sold-out lines in held work, flag them on the till,
  refuse only a quantity increase").** An extra whose list was deleted or no longer offers it is
  treated the same (lane A's choice, 2026-11-16, not the owner's; the owner may overrule). An
  unsent line stored on a held order keeps its variant after that variant sells out (the watcher's
  choice, 2026-11-17, not the owner's): the server keeps the line when only its note or answers
  change, or when a portion is dropped or an extra removed, and
  refuses a raise, an extra added or changed, or a switch to another sold-out variant with
  `product.variant_unavailable`, which the till words. The counter does not flag such a line.

- **A step done before a bill moves onto a seated table, or before two parties combine, is asked
  again at the receiving table (watcher, 2026-11-16, #3507, not the owner; the owner may
  overrule).** "Asking twice is a small annoyance; a missed step is a lost sale." A Done is copied
  only to the party a move to a free table or a split opens, and only when a dish comes with it
  (`carryDoneWithBill`,
  `apps/server/src/service-step-done.ts`).

- **A dragged table keeps its square when the map refits mid-drag (A766 decision 4, kept by the
  watcher 2026-11-16, not the owner).** After a refit the drawn table is no longer under the
  finger, and later moves do not close the gap. A766's first draft "kept the grabbed point under
  the finger; a model of it ran the table out to x 999 once the finger neared the edge".
  [Plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-17-a766-till-floor-grows-on-drag.md)

- **One person check for every till request that needs a signed-in person (owner, 2026-11-07,
  A1380).** "The till's API client adds the tab's person to every request in one place, and the box
  refuses, once, any session request whose named person is not the session's person. New routes are
  then covered with nothing to remember." Requests made before anyone signs in carry no person and
  are not refused for that. A session request naming nobody is refused too (lane C and the watcher,
  2026-11-08). Built by #2534: [One editor per bill](#one-editor-per-bill-owner-2026-10-17-a773).

- **An order with no service zone is warned about only once one of its dishes waits (A773-2 PR C,
  D101).** In a venue with zones, the Prep stations coverage warning checks each waiting station
  against each active zone; a dish on an order with no service zone needs a pass screen on every
  zone, and the warning names it only once such a dish is waiting at the pass. Reasoned, not
  measured ([plan](https://github.com/clintongormley/waitron/blob/9faf8661ebd08545d96518b1d7d09305dcdd654c/docs/superpowers/plans/2026-11-03-a773-2c-pass-coverage.md), D101).

- **Request-device proof on till writes (A941, A1393,
  device enrolment design).** Authenticate the enrolled device and match it to the PIN session. Keep management order reprints and invoice delivery
  available through their management session without a device cookie. Request-device proof is
  passive; session resolution owns whether the request records activity. The watcher approved
  extending proof to the fourteen session-only writes on 2026-11-07 at 06:11: receipt handover,
  table clearing, service-day choices, device preferences, box-clock confirmation, staff schedule
  writes, locale and simulator cancellation. Their selling-action exceptions remain; reads,
  public bootstrap and logout retain their existing admission.

- **Splitting sent dishes (owner, 2026-09-26).** A partial split gives the cut row its own
  ticket item and reduces the original ticket quantity by that part. A dish the kitchen has
  started may still be split. Moving sent work to another table is allowed and tells the kitchen.
  Since A1196 (2026-11-12) part of a dish is cut only inside its own bill, and only whole dishes
  move to another bill. Covered in `apps/server/src/line-service-split.test.ts` ("financial splits
  with charged service cancellations") and `apps/server/src/split-bill.test.ts` ("moving sent work
  to another table tells the kitchen").

- **No text-size warning in theme dialogs (A841, owner, 2026-10-25).** Switching or deleting a
  theme says nothing about the tills' text size.

- **A theme document missing an optional key reads it as empty (A841 slices 7, 10 and 11).** An
  optional key missing from a stored or copied theme document reads as its empty value (`logo`
  `null`, `textScale` 100 and `text` `{}`), with no configuration format change.

- **Product and bill names in a language Chromium does not hyphenate break inside a long word with
  no hyphen (A841 slice 10b).** English is among those languages. The measurement is under "A
  name's language" in
  [conventions-ui.md](../developers/conventions-ui.md#what-an-open-till-keeps-current).

- **Reductions follow their dish; the price floor and the euro cap read the bill as it stands
  (owner, 2026-10-28; A803 slice 1, closes A910).** The owner's rules: "a dish is never charged
  below its floor … after EVERY reduction on it, whatever the reason, each counted once, and the
  floor follows the dish when it moves bill or course" (1); "a reason's euro-per-bill cap counts
  only what is still off the bill; a reduction on a dish later voided stops counting" (3); "a
  reduction stays with its dish and counts against the reason's euro cap on whichever bill the dish
  is on now; each bill's cap applies to that bill as it stands" (5). What a reason has off a bill
  is what its comps and discounts took off each line now on it, scaled by the line's quantity now
  against its quantity then (`standingOff`, `packages/adjustments/src/policy.ts`), so raising a
  line, in place or by copies that carry its original's rows, counts more than was taken off it
  then. A dish cancelled with its charge kept stays on the bill, so what was taken off it still
  counts (a reading, A803 slice 1; the bill's own comp limit reads every line of the bill too,
  `readRows` in `apps/server/src/adjustments-apply.ts`). Plan:
  [A803 slice 1](https://github.com/clintongormley/waitron/blob/cb1aeeb7b2/docs/superpowers/plans/2026-10-27-a803-1-portions.md), D36 and D37.

- **Every comp or discount line prints what that step took (owner, 2026-10-28; A803 slice 1,
  closes A911).** The owner's rule 4: "each receipt line prints the percentage that step actually
  took off the price before it: €12 burger, 50% then Free / 100% / €6 off → second line
  "Descuento 100% −6,00" in all three cases". Free, and an amount that leaves its item (or, on the
  whole bill, the bill) at zero, print as 100% (`isFullComp`,
  `packages/adjustments/src/full-comp.ts`), on the ticket, the till's ticket and the dashboard
  report alike. On the ticket and the till's ticket any other amount prints its share of the price
  before it, half up to a basis point and never as 0% or 100% (`readBillAdjustments`,
  `packages/adjustments/src/record.ts`); the report still shows such an amount in euros. Two
  places print no share: a full invoice's row that joins several steps (a dish with two of its own,
  or two whole-bill steps), which prints one row, «Descuento», or «Descuento 100%» when every line
  at its rate was filed at zero (A961), and the per-dish fallback used when the records no longer
  add up to the bill. The filed sale is unchanged. A reason without Free refuses 100% too (the rule's first
  half, `adjustment.free_not_allowed`). Plan:
  [A803 slice 1](https://github.com/clintongormley/waitron/blob/cb1aeeb7b2/docs/superpowers/plans/2026-10-27-a803-1-portions.md), Tasks 25a-7a and 25a-7b.

- **A bill keeps its number while it stays with its seated party (owner, 2026-10-19; A803 slice
  2).** Each new seating starts at Bill 1. A number is never given twice on one seated party, so a
  bill that merges away leaves a gap, and a bill that arrives from another table takes the party's
  next number. The next number comes from `parties.last_bill_number`
  (`packages/venue-service/src/bill-identities.ts`). Plan:
  [A803 slice 2](https://github.com/clintongormley/waitron/blob/9faf8661ebd08545d96518b1d7d09305dcdd654c/docs/superpowers/plans/2026-10-30-a803-2-named-bills.md).

- **A bill's name never prints on a kitchen ticket (owner, 2026-10-30; A803 slice 2, answer 1).**

- **Renaming a bill that holds someone else's unsent dishes needs a take-over first (owner,
  2026-10-30; A803 slice 2, answer 4)**, as editing those dishes would. The till's refusal offers
  the take-over in place.

- **A table bill stored with no number is shown unnumbered, not refused (owner, 2026-10-30; A803
  slice 2, answer 5).** It is a fault in Waitron: the floor and the bill list carry on, and the
  server logs `bill.number_missing` naming only the bill and its party.

### A paid bill may leave its party for the counter once (A758-7, 2026-10-22)

The database's freeze on a paid (settled) bill has one exception, added by the core migration
`0185_settled_order_to_counter` (frozen at A760 and deleted with that history on 2026-11-07, A1422;
`git show f519799de0:scripts/fixtures/a760-history/core/0185_settled_order_to_counter.sql` reads it), which
re-created `working_orders_enforce_transition`, now in `packages/db/drizzle/0000_baseline.sql`: a
paid bill not yet handed over may leave its party, once,
with every other column of its row unchanged — its `revision` and `label` included. Nothing else
about a paid bill may change; it cannot join a party, change party, or leave one after handover.
The database allows this for every paid table bill not yet handed over, a party closed days ago
included; only the server code limits it to Finish table's collection at the counter
(`finishPartyService`, `apps/server/src/finish-party-service.ts`). Decision 2 of the
[plan](../superpowers/plans/2026-10-22-a758-7-collect-at-counter.md) has the reasons; A1031 is the
owner's look at it.

### A841 slice 2's review points kept as built (lane A, 2026-10-21, before slice 3)

`custom_themes.in_use` stays a nullable number with a CHECK of 1 and a plain unique index
(now in `packages/db/drizzle/0000_baseline.sql`), the design's deliberate choice, where other
"at most one chosen row" columns are a not-null flag with a partial unique index. A malformed theme
id answers `theme.not_found` (404), not `shared.invalid_id`, so the permission check still runs
first. ui-core's token files stay shipped beside the server bundle rather than built into it. The
optional tidy-ups the same review listed were not recorded individually and are dropped.

### Table states are ones the code understands, switched per department (A757, owner 2026-10-16)

Venue settings' Tables tab is gone. An optional table state is one the code understands, knowing
when it can appear and what clears it, rather than a label a waiter puts on any table; the
statuses a venue made up (`table_service_statuses`) were retired by A757 slice 2 (2026-10-19).
Optional states are switched on or off per department, in the department dialog's Service tab;
Needs clearing is one (`departments.needs_clearing`, A757 slice 1). The lifecycle, the order of
precedence and each state's look are in
[A757's design](../superpowers/specs/2026-10-17-a757-table-states-design.md).

### `timingBand` counts only fired dishes (A757 Q17, owner 2026-10-17; built by A757 slice 3)

A held dish does not make a card, a map table or the order screen's pin Waiting, Overdue or
Forgotten, however long it is held; sending or releasing it restarts its age.

### Counter cleanup choices (A738, owner amendments 2026-10-16 to 2026-10-19)

Park keeps the existing optional name and order number. A blank submission sends no label; it does
not mint a timestamp name. Park, Parked orders and Send are Counter display copy. Course/group
Held, Fire and the table's Send controls retain their own meanings.

Use the existing modifiers window for line details. Sent extras and notes remain read-only; moving
a sent unpaid Counter dish uses its separate current movement facts. A739 owns the payment-window
redesign. Sent-dish removal uses Cancel item. The custom item's permission and
menu/report/invoice identity remain undecided.


### Installed modules release removed tables (A894, owner decision 2026-10-19)

Removing a table uses the table-removal contributions of modules whose schemas have been installed,
including a module switched off later. A module never installed contributes no table-removal step.
The boot cases in `apps/server/src/boot.table-removal.test.ts` cover enabled bookings, retained
cancelled bookings with bookings switched off, and a venue with no bookings table.
A future booking still keeps its table when bookings is switched off; the management deletion
preview names that booking as a refusal.

### One editor per bill (owner, 2026-10-17; A773)

Taking over Bill 1 transfers its saved New order in place. It does not combine it with your
Bill 2, even when the dishes match. This replaces Task 7's earlier takeover-and-merge ruling;
the [ownership design](../superpowers/specs/2026-10-17-a773-one-editor-design.md) gives the version,
local-candidate and refusal contracts. `order-drafts.db.test.ts` checks both bills' identities,
quantities and previous-editor metadata after takeover, plus the old editor's refused save.

Direct group submissions carry the observed bill editing state too. The till client's
`GroupSubmission` type requires `expectedEdit`; its compiler checks reject an omitted observation
and check its exact type. The existing client payload fixtures now include that field.
`bill-editing.group-submit.test.ts` checks the server's refusal for a missing observation and its
use of the observed bill when the redundant `billId` is omitted. The client type and server checks cover that interface.

Closing compares every bill's editing state, including bills retained by a merged party. A
colleague's outbox refuses `draft.taken_over`; stale editing state refuses `draft.out_of_date`;
the editor's remaining saved dishes refuse `bill.unsent_dishes` rather than being discarded.
`apps/server/src/bill-editing.finish.test.ts` checks these refusals and unchanged database rows
through direct Finish/close and authenticated Finish/unpaid-departure requests. It also checks
closing with current empty observations while another party keeps its outbox. The separate paid-food confirmation and cancellation checks are in
`apps/server/src/finish-party-service.test.ts`; the app cases are in
`apps/till/src/till-app-parties.test.ts`.

The floor shows each nonempty bill/editor pair. A compact map badge may remain "Unsent" when its
accessible label names those pairs and the expanded detail shows them, as ownership design §6
allows. `till-floor-screen.parties.test.ts` checks the card rows, compact accessible label and
independent pair updates; `table-details-sheet.test.ts` checks the expanded list. These replace
Task 8's ownerless-floor follow-up, not its other draft or navigation findings.

Your unsent local edits stay separate from the saved order, kept for your person and bill.
`till-app-drafts.test.ts` checks the app's idle sign-out callback, a `session.required` save refusal
followed by that callback, and a second edit while a save awaits its answer. You can review the
complete local copy after signing back in; another person cannot see it. A late save answer leaves
that copy intact, and returning starts no save or Send. These app cases use a controlled API,
not a real server's expiry clock. `state/draft-sync.test.ts` also checks that closing retains the
unsaved dish and starts no save. Recovery lasts only in the current app instance;
[ownership design section 5](../superpowers/specs/2026-10-17-a773-one-editor-design.md)
gives no guarantee across reload or close.

A failed recovery read keeps editing frozen, even if you discard the local copy. Discard restores
the last confirmed saved lines; it cannot make the discarded edits available to a later save.
A successful read restores editing authority, and applying a retained copy still needs your
explicit review. The sync suite checks both a draft refusal and a lost save answer, including a
bill with previously saved dishes. The app suite checks the native Discard action and recovery
on focus. This replaces Task 8's old refusal-and-repeat-send observation.

The takeover-helper cases in `state/draft-editing.test.ts` call `adoptLines`, `removeLines`
and `clear` while a controlled takeover request waits for its answer. None sends a save; the
answer restores the saved dishes and leaves your retained local copy separate and read-only.
After you explicitly discard that copy, a new edit saves with the new editor version. This
replaces Task 8's unrun observation about those internal store helpers; it does not add a blanket
lock to helpers also used to apply server answers.

While the table is visible, drafts refresh every 15 seconds and on window focus. The app's draft
suite checks the interval, an unchanged focus refresh preserving selection and its Move window,
and a failed periodic read preserving confirmed editing authority. This replaces the earlier
manual-next-read observation without adding server push. A failed recovery read and a failed
periodic read have different rules in ownership design section 5.

The bill-merge cases in `bill-editing.bill-moves.test.ts` check a save after its source draft
is combined into another draft, and after it moves intact to an empty destination. The original
request still names the old bill and refuses `management.request_invalid` on `billId`; changing
only the bill to the survivor refuses `draft.out_of_date`. Both the direct command and the
`PUT /api/parties/:id/drafts` route leave every database row unchanged. A new save using the
survivor's current edit state succeeds and retains the separately marked lines. These cases
replace Task 7's unrun consumed-draft observation; they do not establish the till's recovery UI.

Every request through the till's API client (`TillApi`, `apps/till/src/api/client.ts`), except
the sign-in itself (`POST /api/session`), names the person signed in on that tab in an
`x-waitron-person` header (`PERSON_HEADER`, `packages/shared/src/person-header.ts`). The server
probes in `apps/till/src/api/server-router.ts` and the `/api/theme` read (`apps/till/src/main.ts`)
bypass it and name nobody. A tab nobody has signed in on names nobody; after a sign-out a tab keeps naming its last person
until the next sign-in or a move to another server. The server checks the
header where it reads the device's sign-in: `requireSession` and `signedInPersonOn` in
`apps/server/src/till-session.ts`, and the sign-out. While a session is open, a request with no
header, an empty one, one that is not an id, or one naming anyone but that session's person is
refused `session.person_not_signed_in` (409) (owner, 2026-11-07, A1380; see Decisions), before
`requireSession` stamps, checks a permission or a profile action. A request whose cookie names no open session still gets
`session.required`. `GET /api/device/me`, and kitchen-screen requests from a kitchen display, answer
such a request as if nobody were signed in, so a new tab beside a signed-in one still starts; a
kitchen-screen request from any other device is refused.

When a request named a person and comes back with that refusal, whatever its status, the till locks
to the sign-in screen once and keeps that person's unsaved lines for their next sign-in, without
signing out the device's session, which belongs to someone else. The sign-in screen then says "You
have been logged out because somebody else has logged in on this device." (the owner's words,
2026-11-07). While the till is locked this way it shows no error from the refused sign-in's
requests. A refusal for a request sent under an earlier sign-in, the same person's included, or
through a client the till no longer holds, does not lock it: that request fails with its usual
error.

A sign-out (`DELETE /api/session`) is sent once the person's saves have finished, and names, in the
same header, the person signed in on that tab when the sign-out began. None is sent if a later
sign-in was answered meanwhile (`#onLogout`, `apps/till/src/till-app.ts`); the leaving person's
session then stays open on the server, since a sign-in ends no other session (`loginWithPin`,
`packages/identity/src/login.ts`, only adds one). With a session open, a
sign-out naming its person ends it; one naming nobody or anyone else is refused the same way and
ends nothing. A sign-out carrying the header never clears the cookie, because its answer can reach
the browser after the next person's sign-in. With no session open it answers `{ ok: true }`, and
clears the cookie only when it carries no person header.

The server cases are in `apps/server/src/till-session.person.test.ts`, the walk of every till,
device and schedule route in `till-api.session-person.test.ts`, `GET /api/device/me`'s in
`device-api.test.ts`, more sign-out cases in `till-api.test.ts`, and the refusals of a save, a
take-over, a line split and a discard naming someone else in `till-api.drafts.test.ts`,
`till-api.groups.test.ts` and `draft-discard.test.ts`. The till's are in
`apps/till/src/api/client.test.ts` ("TillApi: the tab's person on every request") and
`apps/till/src/till-app-person-refusal.test.ts`, which drives the app through its real client. The
other server tests send the signed-in person's header through
`apps/server/src/testing/tab-person-setup.ts`, as a correct till does
([testing guide](../developers/testing-guide.md#server-tests-send-the-tills-person-header-through-one-setup-file)).

### Permanent group numbers (A773)

A group's display number is separate from its firing position. Reordering held groups keeps
their display numbers; removing or moving groups does not make their original numbers available
again. `apps/server/src/order-group-numbers.test.ts` checks these operations and both group reads.
`apps/till/src/widgets/sent-orders.test.ts` checks that a group at position 5 with display number 7
is shown as Group 7. This replaces Task 4's position-derived-number observation; gaps in the
visible numbers alone do not imply a numbering defect.

### Replacement order controls (A773)

On a paid bill, Cancel item can cancel only the unserved remainder after earlier cancellations.
Served food uses Refund a payment on the receipt, as
[A758 section 3.3](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/specs/2026-10-17-a758-adjustment-reasons-design.md#33-cancel-item-by-where-the-dish-is-picture-03)
specifies. The paid-serving cases in `line-cancel.test.ts` and `line-cancel-api.test.ts` check
fully and partly served dishes, prior cancellations, unchanged rows after refusal and completed
replay after serving. The unpaid served-food case retains its separate cancellation behavior.

The native partial-serving cases in `apps/till/src/till-app-parties.test.ts` open Sent's dish
window and choose two of three remaining portions. They check the quantity buttons' 44 px targets,
one request despite repeated confirmation, unchanged service facts until acceptance, and Undo of
the accepted two portions. They cover English and Spanish, both themes, at 390 and 1280 px.
These app checks use a controlled API boundary; server persistence and the physical-till trial
remain separate. The quantity buttons use the standard size; their previous small setting measured
32 px high in those cases on 2026-10-19.

**2026-11-11:** [R3-owner](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-11-r3-owner-retire-recall.md)
retires the Recall paths in the following historical test receipt.

The [modifiers integration guide](../developers/modifiers.md#ordering-and-stored-facts) distinguishes
fresh table-draft selections, priced on submission, from recalled sources whose modifier changes
are saved to their existing bill rows. The 2026-10-19 documentation check ran the complete
`draft-recall.modifiers`, `draft-recall`, `till-api.drafts` and `order-drafts.db` server suites:
419 cases passed, including the €28.50-to-€32.50 added-extra example, invalid-choice refusals and
submission replay. This is a check of those paths, not completion of the whole-branch prose audit.

The native mixed-dish cases in `apps/till/src/till-app-drafts.test.ts` open the table through the
floor's button, then switch to Menu and back to Order. They retain the four saved dish families,
their extras, recorded source details, placement and selection through a same-revision focus
refresh. The checks cover English and Spanish in both themes at 360 and 390 px and scan both views
for accessibility. Switching views sends no save, submission or takeover request. The API replies
and sign-in are controlled; these checks do not exercise server persistence or a physical till.

The last-added strip follows a saved line's id when that order is refreshed, including weighed
lines and lines kept separate. It clears when that id disappears or another order is loaded;
it does not substitute a similar dish. Without a saved id, the existing draft merge rule still
matches the last tap. `till-table-order-screen.last-added-refresh.test.ts` checks the strip after
replacing saved lines, the exact line changed by +1, and the first-read and other-order boundaries.
Its weighed-dish cases cover both languages at 390 and 1280 px. They retain the stored quantity
`0.375` while showing `0,375` in Spanish. These are component
checks, not a server polling or physical-till trial.

New order's editable and read-only row labels and the basket's measured quantities use the
screen's decimal mark. `till-table-order-screen.new-order-quantities.test.ts` checks English and
Spanish rows at 390 and 1280 px, unit names containing punctuation, unnamed units and retained
trailing zeros. Its native selected Fire checks still emit `0.375` when Spanish shows `0,375`;
names and notes keep their punctuation. These component checks do not exercise server persistence.

Choosing Keep in an unavailable dish's line window survives a refresh of that saved line in the
open screen. The warning stays and the dish still cannot be sent. A different draft, bill, store
or editor, a different warning, a removed line or a cleared warning ends that choice.
`apps/till/src/screens/till-table-order-screen.keep.test.ts` checks the saved-line refresh in both
languages at 390 and 1280 px, local-to-saved identity, and those boundaries. This is an in-memory
choice; it is not saved for another screen or session.

Sent's counters, Served and Held headings, dish slices, companions and extras use the screen's
decimal mark. Extras retain their stored decimal places. The fractional native-browser cases in
`apps/till/src/widgets/sent-orders.test.ts` cover both languages, leave punctuation in names alone
and check that serving still emits the exact dot-decimal quantity.

The group Fire confirmation formats quantities in the screen's language without rewriting dish
names. It uses active dish rows from every bill in the group, subtracting cancelled quantities.
If those rows are incomplete or disagree with the server's summary, it retains the full server
summary, including its decimal spelling. The native held-group and reminder tests in
`apps/till/src/screens/till-table-order-screen.sent.test.ts` cover both languages and the
confirmation's group id; separate cases cover incomplete and stale row reads.

New order keeps its dishes and disables Send all, selected Fire and Move while submission waits
for an answer. `apps/till/src/till-app-drafts.test.ts`, "locked through native repeated presses",
checks native double clicks against a held reply: one submission, unchanged saved and local lines,
then the accepted result. After selected Fire, a new press can send the remaining dish. These
checks exercise the app with a controlled API reply, not the server's transaction or retry logic.

`apps/till/src/screens/till-table-order-screen.direct-send.a11y.test.ts` measures the native
Send all, Fire and Move buttons at 390 and 1280 px in both languages and themes: each is at least
44 px on each axis and stays within the viewport. The main screen suite's "tap target of 44 px"
case measures the replacement held-group controls, Fire confirmation and Move earlier/later.
Its twice-pressed Fire/Move cases use scripted clicks.

The native Sent integration cases in `apps/till/src/till-app-parties.test.ts` double-click a
dish, All served and group Fire on till and phone while the API reply waits. They check one
request, disabled service controls and no premature display change, then the accepted snapshot.
A subsequent dish press or Undo uses the accepted party revision. These are application checks
with controlled API replies, not server transaction or physical-till tests.

A press on a disabled row must not freeze that display while it waits: the button receives
pointer events without a click to release the frozen view.
`apps/till/src/widgets/sent-orders.test.ts` checks both busy and unreleased rows, then checks
updated ready-first ordering, the new quantity and a permitted serve. Its existing enabled-row
case still checks that a real press holds the row's position until released. None of these
checks replaces the physical-till trial.

### Device equipment defaults (W100, #1332; owner kept every default, 2026-10-07)

From the [equipment plan](https://github.com/clintongormley/waitron/blob/f2e5e9fb5976f4c5f63cf1143b9befa22fe2cd12/docs/superpowers/plans/2026-10-04-device-equipment-and-independent-drawers.md).
The owner's answer, 2026-10-07 ~08:50 (lane C's questions file): "Ok", keep every default.

- **Staff cannot switch a device's printing off.** The till's "No printer" choice is gone and the
  dashboard's empty choice means Use default (Q1). A named portable default can be held by
  another device.
- Q1. A device cannot override its profile's default with "none".
- Q2. A card reader serves one device at a time. Saving a free default gives it to the active
  device that held the previous default, or to the only active device on Use default. If several
  devices follow the profile and none held the previous default, choose **Use default** on the
  device that will take the payments.
- Q3. A payment stuck "attempting" (started, outcome unknown) after a crash keeps its reader busy
  until the sweep or a manager resolves it.
- Q4. QR labels are decoded with the `jsqr` package, not the browser's own decoder.
- Q5. Card readers have no location, which does not matter while a venue has one location.
- Q6. "One payment in progress per reader" is not a database rule: the checks stop another device,
  not the holding device starting two payments at once.
- Q7. Disconnected equipment is not shown: the till says an item is switched off when a printer is
  disabled or a reader is disabled or unpaired; nothing stores whether a printer or reader is
  online.
- Also as built: a till's equipment list (`GET /api/device/equipment`) needs only a joined device,
  not a signed-in person, so a locked till can see who holds an item on another device (staff
  names are already public through `/api/staff`).

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
[A740 plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-16-a740-zones-on-device.md).

2026-10-24 (A797 slice 4): a handheld has the same choice, under ☰ → Zones on this device (in ☰'s
Settings group since slice 3). It narrows the handheld's Floor, which keeps every chosen zone,
counter zones included, and blocks work on a hidden zone's tables there as on a till. A handheld
opens on its "Opens first" zone only once a choice is saved (the zones read's `saved`); its
new-order start stays the profile's, from an unchanged `GET /api/default-service-zone/offers`. A
handheld whose zones read fails at sign-in holds no choice and allows every zone until a later read
applies one. A live narrowing held back by the open table's unsent dishes now says "Send or remove
this table's unsent dishes to hide its zone." on both device kinds: that table can still send or
remove them, but takes no new picks, and a table in a zone the device already hides does not hold
the narrowing back. Leaving the table alone does not let the narrowing apply, because leaving keeps
the table's New order on the device (found while building). When this device can no longer serve the
table's zone (the waiting choice's `zones` leave it out, for example because a manager took it off
the profile), the table cannot send or remove them either: the box refuses a party's draft writes
and sends in a zone outside the profile (`service_zone.not_allowed`; the draft route cases in
`apps/server/src/till-api.profile-zones.test.ts`). The line, and the zones dialog's refusal of a
save at that table, say "This device can no longer serve this table's zone. Leave the table to hide
it.", and leaving the table applies the narrowing (found by review). [Build
plan](https://github.com/clintongormley/waitron/blob/cb1aeeb7b2/docs/superpowers/plans/2026-10-24-a797-device-screens-build.md), slice 4.


- **Party allergy answers on a join (owner, 2026-10-16; A669).** Keep Allergies whenever either
  party has that answer. Otherwise an unanswered party leaves the combined party unanswered, so
  the next Send asks again; keep No allergies only when both parties answered No allergies.


### A669. An allergy at the table

Owner-approved [design](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/specs/2026-10-14-a669-allergy-at-the-table-design.md),
2026-10-15: allergy answers belong to a table's party, and a dish belongs to at most one guest.
Only table orders ask about allergies; the counter has no allergy step, and seats are not stored
as data (owner, 2026-10-14).
The [kitchen plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-20-a669-4-kitchen-allergy.md) records the storage
and presentation choices; the [kitchen guide](../../apps/server/src/guide/en/kitchen-service.md)
explains the operator behavior.

Cards and reprints retain the original sent instructions. Changed or removed instructions travel
as separate notices; acknowledging one does not replace the original card. Allergy notices stay
available until acknowledged, outside the ordinary day and fifty-notice limits. HOLD exposure is
station-specific: a queued paper job establishes the copy for that station. A new station receives
an outstanding current-versus-original correction even if the old station acknowledged its copy.
An extra added to or removed from sent work recalculates the current clash and sends a correction
when it changes. Preserve the original block and the already confirmed guest wording; preserving a
whole old current block would hide a newly introduced allergen. The added-extra capture cases
exercise both same-station and separately routed work, removal and unticked controls.

The release requires no outstanding pre-live kitchen work. The migrations retain predecessor rows
but do not invent historical originals; reset a development venue with outstanding work before
using this release. No real venue was reset during implementation.

**A773-2 integration:** preserve `ticket_items.allergy_frozen`, `allergy_original` and
`allergy_current` when rebuilding `ticket_items`.
Keep original/current blocks across ticket replacement and financial splits. Freeze at the first
kitchen exposure, including advance HOLD or future Requested visibility; a later pass release must
not recapture. Carry the original block through station/pass projections and include allergy
identity in paper grouping. Keep service-quantity and exact-station correction checks when replacing
Away/Done. The kitchen capture, lifecycle, reads and atomic suites give the integration controls.

### An order's number is never reset (owner, 2026-10-16)

Order numbers are one venue-wide sequence, starting at 1 and continuing above the highest bill in
this copy of the venue (`allocateOrderNumber`, `packages/db/src/allocate-order-number.ts`). The
unique index refuses a repeat while a bill holds that number. It does not restart each business
day: staff search for orders by number. A restore that loses the latest bills can give their
numbers out again (owner, 2026-11-09, A1308 approval page (recorded in 2337f7a193)).

### Fixed screens instead of a screen designer (A182)

Owner, 2026-09-20: ship screens written in code rather than a designer venues drag and resize
([service design §11](../superpowers/specs/2026-09-20-service-ordering-and-billing-design.md#11-screen-reuse-and-deferred-work)).
Owner, 2026-10-08: "delete the canvases functionality. we provide prebuilt screens with
configuration settings." Delete the designer before redesigning its default workflows. Menu
Device Home Page and its Handheld/Till displays, receipt configuration and the floor-plan editor
remain separate. Part 2 landed in [#1800](https://github.com/clintongormley/waitron/pull/1800) on 2026-10-16; part 1's redesign
remains open.
[Retirement design](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/specs/2026-10-16-a182-2-retire-canvases-design.md) and
[plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-16-a182-2-retire-canvases.md).

### Joined-table seat suggestions (owner, 2026-10-16; A747)

When you join tables, the Seats field starts with their total so you can accept it or change it.
The till uses today's seats and counts an existing group once, using its displayed total.
When a split leaves tables joined, the suggestion adds the remaining tables' individual seats,
as listed in the split window. The dashboard adds the selected tables' saved seats. Suggestions
stay within 1–999; if any contributing count is unknown, the field stays empty. Editing the
suggestion keeps your value when the table selection changes. Accepting a suggestion leaves no
unsaved draft.

A floor join where neither side is a fixed table asks for the seat count before it sends the join,
then sends it once; the server's refusals (table not free, already grouped, different area) show
only after the seats are typed (owner, 2026-10-17; A666).

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
Mockups: nothing selected and
a table selected. The latter's corner
handles belong to A672. (2026-10-16: A672 built those corner handles.) The current contract is in
[design-system.md](../developers/design-system.md#departments-and-zones).


- **A guest count typed in the Guests or Split a table window, or a party name typed in the Name
  window, replaces a count or name another till saved while the window was open, once this till
  has received that change: the last one saved wins, with no warning (A715, owner 2026-10-15;
  the Name window by the owner's answer, 2026-10-15).** Asked whether such a save should be
  refused so the waiter sees the other count first, the owner answered "(a) keep it — the last count
  saved wins", and gave the same answer, (a), for the Name window. The Name window's save sends the
  party revision this till holds (`#onNameParty`, `apps/till/src/till-app.ts`). 2026-11-06, A803 4c:
  Split a table has no window of its own any more; both counts are set in its panel, beside the ticks.
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
  Guests. 2026-11-06, A803 4c: both counts are now set in Split a table's own panel, beside the
  ticks; there is no separate window.
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
  ([plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-14-a650-moved-slips-design.md)). 2026-11-04, A803 4c: Split a
  table no longer tells bills that stay, by spec §3.7, except where a name on their paper has gone:
  a staying dish is told only when no name its paper printed is still one of its places (the owner's
  answer to the 4c plan's Question 3, choice B).
- **The table screen shows no "(was N)" (A650 question A, owner 2026-10-14: the default kept).** A
  party's bills stay named "Ana · Bill 1" with no order number; "(was 28)" shows where numbers
  already show, such as the Pass screen, because a waiter answering a kitchen call looks there
  ([plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-14-a650-moved-slips-design.md) §8).
- **The "needs clearing" window names the one table it clears (A581 part 3, coordinator decision,
  2026-10-14).** A table renamed for today reads "Window needs clearing"; a table in a group, named
  or not, keeps "Table Counter 4 needs clearing", never the group's name, because Mark cleared
  clears only that table (one `tableId`, one row on the server). Owner may overturn it.
- **A refusal not about the name stays in the Rename window (A638, owner 2026-10-14, overturning
  A581 part 4's decision to close the window).** "The floor has changed" or any other refusal shows
  at the window's foot and keeps what the waiter typed, so Save can be pressed again, as Split
  tables… does; a name in use or too long stays under the field. The window still
  closes when its table leaves the floor read, stops offering Rename or its group changes, and a
  refusal shown in it then moves to the floor (`#rename` and `willUpdate`,
  `apps/till/src/screens/till-floor-screen.ts`).
- **Saved joined tables use ordinary groups (owner Proposal 3, watcher 2026-11-11 17:12).**
  A saved big table starts as its real tables in one named group; Split tables and Join tables use
  the ordinary group paths. This supersedes A503's synthetic live parent and Reset table.
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
  Cancel sits beside Save, after Undo and Redo, as the owner's mockup 1 puts it: an
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
  or immediate table write route. Labels remain unique across the venue. Hierarchy Delete is
  separate and removes saved/today/reset state after refusing live work. Only terminal booking
  and delivery table pointers may release with copied labels; recorded fiscal, sale, receipt,
  order/line context and finished transfer facts stay. See the
  [reconciliation](https://github.com/clintongormley/waitron/blob/f2e5e9fb5976f4c5f63cf1143b9befa22fe2cd12/docs/superpowers/plans/2026-10-11-a435-6-tables-zones-departments-delete.md).

- **The old small floor-token work waited (owner, 2026-09-30, C82).** The owner said "wait on
  this" about its cramped labels, party names and chips. A429 slice 5 removes that map and its
  capacity-based sizing. On 2026-10-11 the surviving tray was looked at with `Terrace 123`,
  `The Fernández family`, six seats, twelve To serve and `1234.50`, in EN/ES, both themes,
  at 390 and 1280 px. Those captured tokens held their text and four-digit total; the two old
  layout entries are retired. Screenshots: `~/waitron-campaign/a429-5-shots/final-tray-crowded-*`.

- **Floor plans use two separate plans (A429, owner 2026-10-08).** The dashboard edits the master;
  the till works from today's copy. Service changes affect that copy. Table creation and renaming
  belong to the master editor; reserve tables supply today's spares. See
  [the design](https://github.com/clintongormley/waitron/blob/f2e5e9fb5976f4c5f63cf1143b9befa22fe2cd12/docs/superpowers/specs/2026-10-08-floor-plan-design.md) and
  [the plan](https://github.com/clintongormley/waitron/blob/f2e5e9fb5976f4c5f63cf1143b9befa22fe2cd12/docs/superpowers/plans/2026-10-08-floor-plan.md) for the approved decisions.

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
  [plan](https://github.com/clintongormley/waitron/blob/f2e5e9fb5976f4c5f63cf1143b9befa22fe2cd12/docs/superpowers/plans/2026-09-26-service-ordering-and-billing.md), eighteen tasks;
  Task 0's [bill payments design](../superpowers/specs/2026-09-26-bill-payments-design.md)
  (#698). Every task has landed: Task 1 #706, 2 #715, 3 #733, 4 #748, 5 #750, 6 #761, 7 #789,
  8 #806, 9 #814, 10 #908, 11 #916 (with lane B's B11a–B11g), 12 #923, 13 #903, 14 #721, 15 #956,
  16 #981, 17 #991. "Visit" is "party" everywhere since the table actions plan.

- **Task 10 (#908, the service dashboard's attention signals).** Defaults the branch chose, sent
  to the owner as an FYI (not the owner's rulings):
  - A bill request is cleared only when a PAYMENT leaves the party's family with nothing to pay;
    other ways of leaving nothing owed keep the request until staff press Cancel or Finish table
    closes the party.
  - Combining parties keeps the earlier pending bill request from either party and the receiving
    party's name, falling back to the absorbed party's name (owner decision, 2026-11-11 17:12).
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
  `packages/menu/src/option-default.ts`; `withUnavailable`,
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
is in the [Part 2 plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-15-a737-post-invoice-refund.md).

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
  2026-10-17).**
- **"Ready" and "Fired N min ago" on the table screen stay as built (owner, 2026-10-17).** They
  were the service plan's default (Task 5, #750).
- **A child extras row in the Tab drawer stays on its own indented, muted, smaller line (owner,
  2026-10-17)**, matching A738's approved order layout. (2026-11-01: the Tab drawer is gone since
  A803 slice 3; a child extras row is now drawn on its own muted, smaller line in `till-sent-orders`
  (`apps/till/src/widgets/sent-orders.ts`), and indented as well in the table screen's fallback list
  while `currentOrders` is null (`#sentFallback`, `apps/till/src/screens/till-table-order-screen.ts`).)
- **Void works on every bill, split or not (owner, 2026-10-17, withdrawing the 2026-09-26 decision
  that a split check gets no Void).** It follows A758's cancel rules; the server already allows it.
- **A home-page shortcut whose target a newly read menu version lacks disappears with no notice
  (owner, 2026-10-17: accepted).** The till says "Not found" (menus spec §9) only when a newly read
  version drops the section it has open.
- **Design §1's "the migration deletes switched-off reasons" was not done (2026-10-20, A758-2)**,
  because no data-migration code is written before go-live (CLAUDE.md §3). A venue holding a
  switched-off reason gets it back as a reason; one whose switched-off reason shares a name with
  another reason fails that migration on the unique name index, and is reset.
- **The meal list places each step by its named start, with no dragging; a step not done five minutes after it is due gets an amber outline; colours are fixed by kind, with no colour choice per venue (owner, 2026-11-14 21:09, relayed by the watcher; A1526).** The design's words: "The three accepted choices are placement by named start without dragging, an amber outline five minutes after a step is due, and fixed colours by kind with no per-venue picker."
- **Dishes are not moved, and bills not merged, between an eaten-here order and a takeaway one (`order.dining_differs`): lines follow their order, so a move would quietly change a sent line's VAT rate. A whole bill may move, to another table or from the counter to a table, and keeps its way, even into a department set the other way (owner, 2026-11-14, A1522: "Keep the refusal").**
- **A takeaway order moved to a table stays takeaway, whatever the department (owner, 2026-11-14, A1522: "Stays Take away"; the offered alternative, becoming eaten here on arrival, was not taken).**
- **Seated tables, and the calm and tint table-state colours, keep the old blue rather than the new brand teal (owner, 2026-11-19, in conversation; the new brand, #3840).** The design's words: "The builder check measured the teal as almost as dark as the green of a "ready" table, close enough in hue that staff could confuse "seated" and "ready" at a glance."

## A737–A740: the counter till redesigned (owner, 2026-10-15)

2026-10-20: the Counter cleanup has a current [UI contract](../developers/design-system.md#counter-basket-and-payment-space).
Custom items remain an undecided A738 residual; A739 remains separate. The dated source record below
describes the earlier starting point.

2026-10-17: A740 implements device zones and period-scoped menu memory. The remaining Counter
redesign is A738–A739. The dated design and campaign-order notes below retain their original scope.

2026-10-16: A182 part 2 replaces the authored screens described in this design's source snapshot
with [fixed device screens](../developers/design-system.md#fixed-device-screens). Start A738–A740
from those mounts; the earlier canvas paths below remain part of the original design record.

Owner, 2026-10-15, decided over screenshots of the Santet till and four rounds of mock-ups. The
boards were:
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

### Custom item on the Counter (A738 residual)

The dashed + Custom item tile and its window remain unbuilt. Keep the requested fields together:
name, price, required VAT rate and destination (nowhere or a station). Decide who may use it and
whether it needs an underlying product for the menu, reports and invoice lines. A weighed
product does not supply an arbitrary-price path. The cleanup below does not settle those choices.

### A738. The counter screen: fewer distractions

2026-10-20: the executable cleanup is described in the current
[Counter contract](../developers/design-system.md#counter-basket-and-payment-space) and
[implementation plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-19-a738-counter-cleanup.md). The original boards
and dated requirements below remain as a design record. Later owner amendments preserve the
optional name and order number on Park, replacing the generated timestamp name described below.
The custom-item residual above and A739 remain open.

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
  printer's state. **2026-10-24, A789 slice 2:** there is no period keep-open window any more; the
  service period is plain status text, and the zone's keep-open stays on its own button.
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
  rules send it" dropdown on each line. **2026-10-24, A789 slice 2:** the period's "Keep open" is
  gone; the zone's "Keep {zone} open later" stays on its own button.
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

**2026-11-11 software completion:** the watcher closed the software item at 17:20
following Receipt Email (#2840, `e0fa9c300f7aa43178404461efd3d5e498328650`).
The remaining physical printer, reader and inbox checks are in the existing
[real-box session](printers.md#bundle-one-session-at-the-real-box-printers-paper-tax-qr-the-drawer),
with no new prerequisite for A840/A842/A848. The following records the decisions;
the [current payment-flow plan](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-10-a739-current-payment-flow.md)
and [memory-only slip plan](../superpowers/plans/2026-11-10-a739-memory-only-card-slips.md)
remain historical implementation references.

**2026-10-27 approved update (owner, about 02:01/02:05/02:12 CET).**
Read the [authoritative addendum](../superpowers/specs/2026-10-22-a739-owner-payment-and-receipt-flow.md)
and [implementation plan](../superpowers/plans/2026-10-27-a739-approved-payment-flow.md).
Plan and build are approved; the driver executes inline after E/A948 #2122 lands, preserving F1
in every environment. (19 November 2026: None was removed by ADVISER-NO-NONE; closing the window now
prints the receipt unless an original was emailed or sent to an A4 printer.) Dismissed Receipt / Full invoice / None means None, without pending work,
recovery item, timer or zone fallback. Each reader's “Prints its own slip automatically” setting
defaults false: true excludes Waitron slips; false offers Print card slip initially unticked.
No provider printing control or hardware qualification gate. Cash/manual card have no Waitron slip.
Keep Park · Pay, all four amount modes/journeys, next tender after each part, the settling edit's
own choice, separate Print/Email and table closure, A790/A796 equipment scope and A582 payment help.
Issued F1 delivery stays available; F2-to-F3 replacement stays with A556, with receipt/reprint
options retained. No protected fiscal/guard changes beyond the named 21 October slip-copy EXPECTED
addition. This publishes the plan and updated static boards; product/runtime acceptance remains.
**All earlier notes and body below remain verbatim history; conflicting open questions and
no-rebuild/native-control/pending-choice/F1-off proposals are superseded.**

**2026-11-19 pointer (the owner's answers of 19 November).** "Cash/manual card have no Waitron
slip" above and "No cash slips" below no longer hold: a payment slip, for any method, prints once,
only when the payer asks through **Print payment slip**, and is never reprinted from the till; a
lost one is reprinted from the dashboard's Print Queue. No slip shows a remaining balance. See the
[receipt layout plan's 19 November rework](../superpowers/plans/2026-11-17-receipt-layout-and-payments.md#rework-2026-11-19-payment-slips-are-optional).

**2026-10-27 precedence.** The [current amendment](../superpowers/specs/2026-10-22-a739-owner-payment-and-receipt-flow.md)
and eight four-case boards (removed from the repository on 2026-11-02) supersede conflicting history
below. The owner's 2026-10-26 ~07:00 YES requires an initially unticked native-reader checkbox;
ticking requests the reader's own slip. Effective native control needs proved adapter and hardware
behaviour. The SumUp/Stripe boundary probes did not forward print intent; physical paper is
unverified. The target checkbox stays disabled with an explanation. The new capability fallback
question recommends that boundary, no Waitron duplicate for own-paper/unknown readers, and an
initially off Waitron checkbox for known no-paper readers. The fallback is not owner-approved.

No cash slips; all four journeys, amount modes, recovery and separate table closure stay. After a
part, show the remaining amount and next tender; after settlement/issuance or a settling edit,
show Receipt / Full invoice / None with separate Print and Email. The edit owns its new choice.
Durable Document choice pending, recoverable by authorized staff through even a closed bill/sale,
with no timer or zone delivery, is a separate unapproved proposal. Alternatives are an answer
required before leaving or a five-minute zone fallback; no option is approved. Money/issuance
recovery stays separate. Complete revision approval is another open question. Keep G5's eligible
card slips and manual-card exclusion, A790/A796 settings and separate A556/A948/Q17/Q5(d) fiscal
work; public F1/F3 stays gated. No rebuild before agreement; no new landing gate or build plan.
All earlier body bytes below remain historical.

2026-10-22 proposed revision, awaiting owner decision: [timing A after settlement versus timing B
on Finish, with six-case static mockups](../superpowers/specs/2026-10-22-a739-receipt-timing-revision.md).
The settling edit owns a new receipt decision; partial-slip choice needs an explicit replacement.
All implementation and acceptance work remains open. The historical design below is retained.

2026-10-20: the owner’s 2026-10-18 copy amendment replaces Hold with Park, so the target
bottom row is **Park · Pay**. The earlier board and wording below remain a dated design record.

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
- **Keep the card panel tied to its order.** A767 stores the outcome and Retry's reader and
  tip by order id. Moving the panel into the payment window must preserve that link:
  switching orders hides it, returning restores it, and a Retry control from the previous order
  cannot start a payment on the replacement. Browser cases: `till-app.test.ts`, “A767 card outcome”.
- **No receipt screen after paying** (owner). The counter goes straight to a new order; a strip
  "✓ Paid €30.00 · receipt printed · Reprint" stays until the next product goes in, with the change
  in large type after cash.
- **Parked, not part of this:** A742.

At a table, A803 slice 3 (#2360) left the wide screen's pay controls (Cash, Card, the pay ways,
the bill's Full invoice and receipt language) in the foot under the totals; this window puts them
behind one Pay button, as a handheld already has (its D16, Owner question 7).

### A740. Zones on a device

2026-11-12: fk1 folds zone policies into `floor_zones`; see the current [department and zone service settings](../developers/conventions-data.md#department-and-zone-service-settings) and [permanent hierarchy deletion](../developers/conventions-data.md#permanent-hierarchy-deletion).

2026-11-18: dv6 moves the profile's ordering department, starting zone and zone list onto
`device_profiles`. The two profile scope tables named in the October inventory below are retired.

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


## A773. Courses, groups and the pass

**A773-2**, firing and the pass: its [reviewed implementation plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-19-a773-2-firing-and-pass.md)
was cut into PR B (B1–B4 by a [slice plan](https://github.com/clintongormley/waitron/blob/9faf8661ebd08545d96518b1d7d09305dcdd654c/docs/superpowers/plans/2026-11-01-a773-2b-requested-release.md);
B4 into B4a and B4b by its [task plan](../superpowers/plans/2026-11-02-a773-2b4-pass-screens.md)),
PR C ([task plan](https://github.com/clintongormley/waitron/blob/9faf8661ebd08545d96518b1d7d09305dcdd654c/docs/superpowers/plans/2026-11-03-a773-2c-pass-coverage.md)) and PR D
([task plan](https://github.com/clintongormley/waitron/blob/9faf8661ebd08545d96518b1d7d09305dcdd654c/docs/superpowers/plans/2026-11-04-a773-2d-tickets-and-retirement.md)). B3
([task plan](https://github.com/clintongormley/waitron/blob/9faf8661ebd08545d96518b1d7d09305dcdd654c/docs/superpowers/plans/2026-11-02-a773-2b3-pass-release.md)) built the pass's board
reads (`GET /api/device/pass-board`, `GET /api/device/pass-monitor-board`) and its Fire
(`POST /api/device/pass-screen/release`), which gives a card's waiting dishes to their stations
once, and the HOLD paper corrections for dishes waiting for the pass. B4a put the pass, the pass
monitor and the till's own Pass on that board (`apps/till/src/screens/till-pass-screen.ts`, the
till's every-station view on `GET /api/expo/board`) and retired the old pass reads. B4b put held
cards under a Held heading at the bottom of the station's Waiting and the pass's To fire by default,
made every kitchen column a choice in Columns, gave the waiter's table screen "at the pass", and
added a pass's choice to show or hide other stations' dishes (per profile and per device, migration
0073). What B4 leaves for PR D and later is in [the B4 plan](../superpowers/plans/2026-11-02-a773-2b4-pass-screens.md)'s
"Left for PR C, PR D and later". Old nonempty stamps remain in regression fixtures, outside the till's
public contracts.

**The owner's answers (2026-11-02)** to the nine questions B3 asked (B3's plan, "Owner
questions"): the Spanish copy sheet is approved as written, and B4 may land once its words match
it. A dish the pass already released and a waiter then edits goes to its station at once. A dish
waiting for the pass counts towards the floor's "waiting long" mark, measured from when the waiter
asked for it against its station's limits (B3's D65). The adjustments report calls a cancelled
waiting dish "Unsent". A cook's "rest of the order" keeps "(on hold)" for another station's
waiting dish. A table's first food the pass is asked to cook is its «Nuevo pedido» / New order, so
an all-held first send does not use it up (B3's D57). The release ticket shows the allergy answer
as it was when the dish was asked for, followed by an ALLERGY CHANGED slip if the answer has
changed since. A side at a closed
station is still sent there by the pass's Fire, as a waiter's fire does. A dish that waits for
the pass and was served in full no longer blocks recording an unpaid departure (B2's D41: keep as
built); its refusal's words are on the copy sheet.

**An edit that adds an extra at a waiting station.** If the dish's own station fires at once
(Grill) while the extra's waits for the pass (Fryer), an edit adding onion rings to a burger
already sent prints no `+1 x RINGS` on Fryer's HOLD paper; the pass's release ticket lists
them when it fires. Today's code gives Fryer nothing on this path either. Adding it means a new
read after `fireLines` and reordering slips on a shared printer (B3's plan, "Review answers (H4)",
Minor 3, option (c)).

A773-1 ([plan](https://github.com/clintongormley/waitron/blob/eca67e9dcd4b89ccc3aecb0bdb946eda5f8a4aba/docs/superpowers/plans/2026-10-16-a773-1-unsent-list.md)) built the Sent/New order and, under
the [ownership design](../superpowers/specs/2026-10-17-a773-one-editor-design.md), per-bill
ownership; that design governs the landed ownership behavior. Physical dragging and partial-serving trials remain
separate backlog entries. A803 owns its pass/station presentation tail.

What A797 leaves for the pass (slices 9 and 9b): `apps/till/src/state/kitchen-columns.ts` is the
Columns store to reuse, and a key missing from a stored layout returns to its default place, not
the end (A797 plan, slice 9 D3 and D15). `apps/till/src/widgets/kitchen-columns-dialog.ts` is the
Columns window: it takes a layout and a map of column names and sends `column-move`,
`column-show` and `close`, so the pass can list its own columns in it, and a pass adds an Other stations' dishes section
(`otherStations`). Every column may be hidden and Columns stays in each
board's header row. A key added to `STATION_COLUMNS` must also be drawn and named by
`stationColumnNames`, or "the station registers only columns the board draws" in
`apps/till/src/widgets/station-queue.test.ts` fails.

What A797 leaves for the pass (slice 9c): Overview on the pass calls `overviewRows` from
`apps/till/src/state/kitchen-overview.ts` with its own `OverviewDish`es and builds no second
aggregator (A797 plan, slice 9c D1). Its `OverviewFact` needs `unitName` and `soldInEach`, or a
dish sold by weight counts by its weight rather than as one. Once station dishes carry a
requested phase, `overviewDishes` counts them as held. With Waiting and Held shown apart (five
columns) a kitchen board needs 1148 px at standard text (`columnsFit`), a kitchen display's viewport
about 1228 px; the default layout keeps held cards inside Waiting, so a 1024 px display keeps its
columns. The kitchen's tabs keep
the layout's order and hidden columns but not collapse, which the pass's narrow list keeps (slice 9c D9).


## A Ready card on the pass turns red, aged from when it was sent

Seen in A773-2 B4a's look (2026-11-03). A Ready card's minutes count from when its last dish was
ready, but its edge colour, the overdue count and a dish's Forgotten mark still age each dish from
when it was sent to be cooked (`passItemBand`, `apps/till/src/state/pass-view.ts`), so food waiting at the pass
for its runner turns red and says Forgotten. The old pass did the same, and the guide says so. Should
a dish stop ageing once it is ready, or age from when it was ready? A question for the owner, beside
A1250's colour question.

## A678. Two readers answer "where is this order"

- **A678 — Two readers answer "where is this order" (2026-10-14; open).** `readOrderPlaces`
  (`apps/server/src/order-places.ts`, used by MOVED slips) reads a counter order whose delivery
  table was released as the counter, a known edge A650 Part 1 deferred and has not yet put to
  the owner, while `orderTableLabels` (`packages/db/src/party-table-labels.ts`, used by
  tickets and correction slips) names it by its kept `delivery_table_label`. Once the edge is decided, one reader in `packages/db`. Left open by A650 Part 1.

## A550. Making a booked table part of a joined table is not refused

The floor
plan editor's save refuses deleting a booked table (`table.booked`) but not making one a part; the
booking stays, and seating it is refused `table.in_joined_table` once the reset applies, so staff
must move it by hand. Left open by A503 part 2 (#1601, design gap 2). Next: decide whether the save
refuses it, as a delete is refused, or only warns.

## Refresh the floor without a staff action in a zone's list view — OPEN (3d, W16)

Left open by the product folders work. Since A429 slice 3 the
floor screen re-reads the floor every 15 seconds while a zone's map is on screen
(`#watchFloor`, `apps/till/src/screens/till-floor-screen.ts`). Elsewhere it still reads only on
events handled by `till-app.ts`'s `floor-refresh`. Polling would read `listTablesWithState` every
few seconds on every till; choose the interval and cost first.

## A921. On a narrow till, should the person's name give room to the tab strip?

A question for the owner, left open by A582 slice 4a. On a till (not a handheld) the bar's
session row now holds the Help switch, then the person's menu, then More
(`till-shell`'s `render`, `apps/till/src/widgets/till-shell.ts`). The plan's decision 3 moved nothing else off the bar for
it, because A738 put the person's name and More there on purpose, so the "?" takes 52 px from the tab
strip, which scrolls sideways at every phone width already.

Measured while writing the slice's plan (2026-10-20, `be39179b0`, Vitest 4.1.11 in headless
Chromium, a throwaway test reading `.till-strip`'s widths; M2 in
`docs/superpowers/plans/2026-10-20-a582-4-till-help.md`), what the strip gets with the name
"Alex Morgan Smith Jones", before and after the "?": 60 → 8 px at 320, 100 → 48 at 360, 130 → 78 at
390. With the name "Ana": 166 → 114, 206 → 154, 236 → 184. `till-shell.help-phone.test.ts` pins the
long-name widths as a known limit. Re-measured in slice 4a's look (2026-10-20, the branch's head,
English and Spanish): 8 px at 320 px with the long name.

One answer: at phone width give the name two tap widths instead of three, which M2's numbers say
gives back 44 px. That changes A738's look, so it waits for the owner.

## A1193. Choosing which portions of a grouped row an action takes, and Fire now on a grouped row

On a till row that groups identical portions, Comp and Void take a count and act on the last
portions still active; Mark served (from the row's details) and Move dishes…'s count take the
first. A plain tap on a Sent row serves all of it without
asking (seen in slice 1's LOOK; the guide says so). On the kitchen screen a grouped row's tap and
Move act on every portion, so one of two identical portions cannot be bumped or moved alone there.
Fire now on a grouped row fires only its first portion, because the server's fire route names one
line and firing members one by one would start a fire group and a ticket for each. Choices the
build review left for the owner: accept, word the button differently on a grouped row, or let the
route take a list. Slice 4a's picker (Move dishes…) takes a row's first portions and is for moves
only; comp, void and Fire now are unchanged.

## A1020. The owner looks at A758-6's words and choices

Left open by A758-6. Each works as built, with the default named; the owner may want it different.

1. **No "Table finished" on the pass.** Since A773-2 (#1944) a finished table's food leaves the
   pass, so design §3.8 item 5 has nowhere to show (the plan's Decision 1).
2. **"Not served" is found by its English name.** Finish table starts on the first Void reason
   whose English name is exactly "Not served"; a renamed one stops being the start. The rule's
   "Void" half never decides anything, because a Comp reason cannot carry cancel.
4. **The rest refunded later from a second payment is an ordinary refund**: that window is
   not filled in with the cancelled dishes, so staff enter its amount and reason and get fresh
   approval if needed; it is not linked to the cancel (Decision 16).
5. **New words, ours:** "Refund pending €x" («Devolución pendiente …») and "This refund is more
   than the cancelled dishes' value" («Esta devolución supera el valor de los platos
   cancelados»), which names no amount where the plan's wording did.
6. **A still-charged cancelled dish is counted once in the person's sales**, where it used to be
   counted twice. It still counts as one cancel and still adds its menu price to "List value of
   cancelled items".
7. **A803's English for the till line stays**: "Refund the payment at a till: choose Refund a
   payment on the receipt.", where design §3.9 wrote "Give the money back at a till: Refund a
   payment on the receipt."
8. **A refund in flight across the upgrade**, sent again with its first submission, is refused as
   reused (`submission.id_reused`); checking it by its refund id still works.
9. **A finished table is checked against all its bills' zones**, not the order's zone as design
   §3.8 says: a device limited to zone 1 is refused a finished table that also had a zone-2 bill,
   though it served part of it. On a finished table, a device outside its zones is now also
   refused the table's read routes (403 `service_zone.not_allowed`).
10. **The cancel's note is not carried to the refund**: the refund starts on the cancel's reason,
    so a reason that needs a note (such as Other) asks for the note again.
12. **The refund dialogs keep Refund enabled before a reason is chosen** and explain on press,
    drawing it quiet until a reason is chosen, while Cancel item and Finish table grey their action
    out.
13. **Finish table is simpler than picture 06**: no table and payment line, no amount or status
    per dish.
14. **The Spanish Refund tick reads «Devolución»**, where the picture said «Devolver».
15. **Cancel item on a partly served line does not say one was served.**
16. **The reason drop-down shows a search box** even with the five starter Void reasons.
17. **The report's "Refunded €5.50" cell repeats its column heading.**
18. **On a phone, the report's new columns sit mid-scroll.**

## A1250. The pass marks a late card in the brand colour where the station board marks it amber

**A1250. The pass marks a late card in the brand colour where the station board marks it amber
(question for the owner).** A late card's edge is `--wt-color-warning` on the station board
(`apps/till/src/widgets/station-queue.ts`, `.ticket.age-warm`) and `--wt-color-primary` on the
pass (`apps/till/src/widgets/pass-board.ts`, `.ticket.age-warm`); both then turn red. Should
the pass use amber too? The help texts describe each as it is today.

## A1253. A help badge on a button in the brand colour reads as part of the button

**A1253. A help badge on a button in the brand colour reads as part of the button (question for
the owner, A582 slice 5's look check).** The pass's first Ready keeps its
badge inside its top corner, and both are filled with the brand colour, so the badge's lower half
disappears into the button (shots `pass-1280-*-help-on.png` in `~/waitron-campaign/a582-5-shots/`). Slice 4's
Send all badge has the same clash, less of it because it hangs outside. One answer: a thin ring
of page colour round every badge in `wt-help-tooltip`, which changes every badge.

## A803. Bills and tables: one portion per order line, one bill switcher, one picker

**A803. Bills and tables: one portion per order line, one bill switcher, one picker (owner,
2026-10-18).** Owner-approved design; A773-1 has landed. Slice 1, portions and current
ticket/receipt grouping, has landed. What it leaves open is A1193–A1195, A1197, A1198, A1201 and A1217 under
_Modules, data and code health_. Slice 2, named bills that keep their number at the table, has
landed; it leaves open A1235. Slice 3, one bill switcher with + New bill, one ⋮ menu and no
main bill, has landed (#2360); it leaves open A1261 and A1265. Slice
4a, one dish picker behind the ⋮'s **Move dishes…** in place of Split by item and Transfer items,
has landed (#2372); it leaves open A1287, A1289–A1290 and A1292–A1294. Slice 4b, waiting dishes that leave with their own copy of the course, has landed (#2454). Slice 4c, Split a table through the same picker with any whole bills and single
dishes in one panel, has landed; it leaves open A1349 and A1359. Remaining: pre-bills through A446, not
scheduled for the foreseeable future (owner, 2026-11-17). One payment pays one bill. Station modes, pass naming and grouped cross-bill
firing no longer wait for A773-2; the seams a cross-bill ticket changes are in the A803 plan's
"A773-2 PR D handoff" paragraph. New Spanish wording requires approval
during implementation. Each new seating starts at Bill 1
(owner, 2026-10-19); bills staying at their table retain their numbers.
[Spec](../superpowers/specs/2026-10-18-a803-bills-and-tables-design.md);
[plan](../superpowers/plans/2026-10-19-a803-bills-and-tables.md).

## A1261. A full invoice for a bill already paid, from the table's ⋮

**A1261. A full invoice for a bill already paid, from the table's ⋮ (left open by A803 slice 3,
Owner question 2, #2360).** As built, the ⋮ offers Full invoice only for a bill still to pay and
not yet invoiced; for a paid bill it needs an invoice that replaces the paid ticket, which Correct
invoice (A802) does not issue. Once something does, offer it from the ⋮ for a paid bill. If the owner instead picks "show it
quiet and explain on tap", that needs a new sentence in English and Spanish first.

## A1265. The table screen's ⋮ list is taller than the room below it, so Finish table starts below the fold

**A1265. The table screen's ⋮ list is taller than the room below it, so Finish table starts
below the fold (seen in A803 slice 3's LOOK, finding F8).** At 1280×900 the list holds 743 px
in a 665 px box that scrolls; "Move guests" is cut and Finish table shows only after scrolling;
the same at 390×844 (617 px box). Nothing is lost, but the whole-table actions are easy to miss.
Decide whether the list gets shorter (fewer items, or tighter rows) or the table section comes
first. Pictures `x-t1-menu-open`, `k5-*` in the LOOK's folder
(`~/waitron-campaign-c/a803-3-shots/`, not in the repository). Since slice 4a the bill section is
one item shorter (Move dishes… replaced Split by item and Transfer items). Measured then (slice
4a's LOOK, list content 647 px): at 1280×900 it fits in English and Spanish (649 px); at 390×844
it scrolls by 8 px in English and 78 px in Spanish, where the list starts lower.

## A1287. With no party, the ⋮'s Merge bills does nothing

**A1287. With no party, the ⋮'s Merge bills does nothing (left open by A803 slice 4a, D15).** A
bill with no party at a table still offers Merge bills under "Bill", but the panel lists no other
bill (`#otherBills` answers none without a party, `apps/till/src/screens/till-table-order-screen.ts`)
and `#onMergeBills` returns without a word when `#billComposition` answers `null`, which it does
with no party (`apps/till/src/till-app.ts`). By reading, not run. Slice 4a took Split by item and
Transfer items out of that section for the same reason. Decide whether Merge bills goes too.

## A1289. Moving dishes onto a bill with someone else's unsent dish says "This order belongs to someone else. Reload the table to see it"

**A1289. Moving dishes onto a bill with someone else's unsent dish says "This order belongs to
someone else. Reload the table to see it" (seen in A803 slice 4a's LOOK).** It names neither the
person nor the bill, reloading does not help, and Take over sits on the other bill, where the
waiter has to find it. The panel offered that bill with no sign of the unsent dish. The words are
the approved `draft.taken_over` text the plan chose (D9); after Take over the move works. Decide
the words, and whether the refusal offers Take over in place. Pictures `s7-*`, `s8-*` (`~/waitron-campaign-c/a803-4-shots/`, not in the repository).

## A1290. The table screen's action panel can put Back and its action half below the window, and "+ New bill" touches Back

**A1290. The table screen's action panel can put Back and its action half below the window, and
"+ New bill" touches Back (seen in A803 slice 4a's LOOK).** At 1280×900 Move dishes… opens at the
lower left, the order heading, bill switcher and ⋮ scroll out of view and the space to the right
stays empty; Back measured y 858, 44 px high, in a 900 px window. On a short list "+ New bill" sits
against Back with no gap. Both are the shared action panel's layout (`aside.action-panel` in
`apps/till/src/screens/till-table-order-screen.ts`). Pictures `k2-panel-open`, `k5-move-active`
(`~/waitron-campaign-c/a803-4-shots/`, not in the repository).
Since the grey reason gained ": move fewer dishes" (owner, 2026-11-01) it wraps onto two lines,
so Back and Move sit fully below the window at 1280×900 and are cut at the bottom at 390×844 in
Spanish (re-taken pictures `slice4a-paid-floor-long-names-destination.png`,
`slice4a-spanish-phone.png`).

## An unpaid table bill showed two "Full invoice" buttons

**An unpaid table bill showed two "Full invoice" buttons**: the payment panel's own
(`till-tender-pay`) and the bill's smaller one (`#billChoices`,
`apps/till/src/screens/till-table-order-screen.ts`), both drawn since A231 (#1256). While full
invoices are switched off neither is drawn (A741), so the question is for when they are on.
A803 slice 3 (#2360) draws only the bill's own at a table, its Owner question 3's default; the
counter keeps the panel's. **Next action:** owner to pick between
drawing only the bill's own Full invoice button (as built) and the payment panel's; the pictures
were removed from the repository on 2026-11-02.

## A841 slice 5 differences from the pictures and tidy-ups (2026-10-21)

**A841 slice 5 differences from the pictures and tidy-ups (2026-10-21).** Optional, for the owner
to judge (its screenshots were removed from the repository on 2026-11-02): at a 1280 px window with
the side menu open the form is about 825 px wide, under the 900 px at which the preview sits beside the choices, so it sits
below them (pictures 02, 04, 05 show it beside); the warning and fix lines are plain text and a
plain button, without the pictures' boxes and colour chips; Waitron's choice sits above the swatches
rather than beside Custom; the theme's name in the editing line is not bold; on a phone the
preview's sample keeps its side menu beside it while it fits (picture 03 draws it above); and the
pictures still show Café Limón's light fix as `#9f8b18` and Bar Lucía's dark fix as `#417c59`,
where the code gives `#9d8a15` and `#437e5b` (a dated note in the design says so). Test
gaps its reviews left: an unchanged draft off the page following a newer read on re-attach;
the colour field's refused chip value, disabled code box while saving and same-row placement; the
warning text's colour; the preview's colour-rebuild check (`theme-preview.test.ts`); Bar Lucía and
lemon fixtures repeated across test files.

## A841 slice 11: Waitron's own headings are one step lighter (2026-10-27)

**A841 slice 11: Waitron's own headings are one step lighter (2026-10-27).** For the owner: the
design's rule that every bold, heading and table header reads the Bold weight, so a theme's Bold
reaches them, also moves Waitron's own from the browser's 700 to Bold's 600, on the dashboard, the
tills and the setup screens; the design did not discuss it. The way not taken: a
heading weight held at 700, which no hand-set Bold would reach. The rule stands unless the owner
says otherwise.
