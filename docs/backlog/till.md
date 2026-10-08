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

## A table with no shape is drawn as a rectangle and saved as round on its first edit

- Found by #604 (`packages/ui`), not fixable in a comments-only change. **A table with no shape
  is drawn as a rectangle and saved as round on its first edit**: `wt-table-token.ts` draws
  `shape-${t.shape ?? "rect"}`, while `wt-floor-canvas.ts` marks Round as pressed and sends
  `shape: t.shape ?? "round"` from `#placementOf`, so dragging, nudging or rotating a shapeless
  table changes it (read from the code, not run). `packages/ui/brand/README.md`'s table omits
  `public/icon-192.png` and `public/icon-512.png`, which the generator writes.
  `packages/ui/vitest.config.ts` and `stryker.config.json` still exclude
  `src/tokens/token-test-helpers.ts`, which moved to `packages/ui-core` in #519 (the
  entry "`packages/ui/src/vitest-park-pointer.ts` is mutated and has no tests" in Track C still
  names it there too). A reviewer believes the `demo/**` coverage exclusion matches nothing and
  that `**/ui-core/**` is there because `packages/ui-core` starts with `packages/ui` (CLAUDE.md
  §4's unanchored-include trap); neither was tested.

## Seating a booking at a table in a zone that is not a table-tab zone has no bookings test

- `packages/bookings`, found by #574 and not changed (code, not comments). Seating a booking at a
  table in a zone that is not a table-tab zone has no bookings test: the real `openTab` refuses
  it with `service_zone.mode_incompatible`, the fake core in `src/testing/fake-core.ts` does not,
  and `routes.ts`'s `STATUS` map has no entry for that code, so it answers 400 by default.
  Editing a booking that is already seated answers `booking.not_found`, which the dashboard shows
  as "could not be found". The server accepts an empty contact name; only the dashboard form
  refuses one. `seatBooking`'s `status = 'booked'` condition on its final update cannot fire
  while every caller goes through `withTransaction` (read, not run). Test titles in
  `bookings.test.ts` and `migrations.test.ts` still say "tenant", and `floor.test.ts` inserts
  `booking_time` as `HH:MM` while the write path stores `HH:MM:SS`. #574 moved the Vitest 3
  `groupOrder` measurement on bookings (CLAUDE.md §4) out of its `vitest.config.ts` into its
  commit message; `docs/developers/testing-guide.md` has no paragraph holding it.

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

## Two more till lookups read inherited object properties

**Two more till lookups read inherited object properties — OPEN (found by W24's review,
2026-10-03, by reading, not run).** Both look a string key up in a plain object, so a key such as
`constructor` finds an inherited property — the defect `deviceKindLabel` had.

- `allergenName` (`apps/till/src/i18n/allergen-names.ts:30`) finds `Object` for `constructor`, so
  it returns `undefined` instead of the code itself.
- The station dialog's refusal (`apps/till/src/widgets/station-choice-dialog.ts:74`) finds
  `Object` in `moveRefusals` for a `constructor` code, so it passes that to `t` and shows an empty
  alert instead of the code's own message (by reading).

**Next action:** look both keys up on own properties only (`Object.hasOwn`, as
`apps/till/src/i18n/codes.ts` does), with a test each.

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
  row, in this order: the Waitron name is hidden first, then Allergens, Equipment, Profile, My
  schedule, Pass, Kitchen, Find a bill, Department transfers (count and button together), and last
  the operator's name with Log out. Tabs and the language chooser never leave; once everything
  else has left, the tabs scroll sideways. The More button is the hamburger (three lines);
  `design-system.md` says which icon means which menu. While More is open nothing moves out of
  it; the bar refits when it closes.
  - **Open, for the owner:** because items leave strictly in that order, a wide item can take
    narrower ones with it. In screenshots of the demo counter in Spanish at 1024 px, and in both
    languages at 800 px, the transfer count and its button do not fit, so Find a bill, Kitchen and
    Pass are in More too, though the bar has empty room for some of them. Option: after the bar fits, bring back any item that left earlier and now fits, so the
    order is no longer strict. Not done. Screenshots: `~/waitron-campaign/a395-shots/`.
  - **Open, decided as built:** a change in the pending-transfer count alone never brings items
    back onto the bar, so when the count shrinks or goes away, items can stay in More although they
    would now fit, until the next resize or other change refits the bar.
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

## Decisions and deliberate limits

**What the till shows the NEXT operator when the previous one's request answers late — CLOSED, no
change (owner decision 2026-09-23; PR #536).** The ticket belongs to the TILL, not to the operator
who started it, so a late result shown on that device after a change of operator is right; the
payment belongs to the table, so no payment is lost.
