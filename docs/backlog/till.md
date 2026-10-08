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

## A429 — floor plans: a master plan per zone, today's plan on the till

- **A429 — floor plans: a master plan per zone, today's plan on the till (owner, 2026-10-08; spec
  approved; plan written; being queued).** A Square-style editor on the dashboard for each zone's
  master plan (tables created in bulk, saved joins, Undo/Redo), and a till map whose job is status
  and rearranging. The master and today's plan are separate plans (owner, 2026-10-08): the master
  is edited freely and is copied into today's plan at the day's reset or on a button; everything
  live points at today's plan; staff move, join, split and take off tables on today's plan but
  never add or rename one (they keep spares in reserve); a table a party sits at waits and catches
  up when its tab closes. Table names are copied as text when a party closes, and onto past orders
  and bookings when a table is removed, so a table the master no longer has can really go. Five
  slices, each its own pull request; only slice 5 (removing the old floor screen tabs, placement
  routes and columns) needs a venue reset. [Spec](../superpowers/specs/2026-10-08-floor-plan-design.md),
  [plan](../superpowers/plans/2026-10-08-floor-plan.md). Overlaps: A366-6 rebuilds the Departments
  and zones screen the editor opens from; A182 (canvases retired) and A414 touch the till's floor
  screen that slice 3 replaces.

## A414 — device screens on a phone

- **A414 — device screens on a phone (owner, 2026-10-08; open; campaign lane A, after A366-1 lands).**
  1. **A fifth of a phone's width is margin.** Measured on the owner's Android phone (Chrome 154,
     411 CSS px wide) on the handheld's Floor tab: the page's body padding is 24px a side
     (`apps/till/index.html`), and the floor screen adds 16px a side inside it, leaving 331 of 411
     px before the floor plan's own frame. Cut the body padding on narrow screens and stop screens
     adding a second layer; check the Order tab and the other device screens too. The floor plan
     itself is out of scope — the owner will redo it later.
  2. **No demo bar on device screens.** A venue set up as a demo (or "prepare") shows the
     Demo / Dashboard / Device / Email inbox bar on the till and handheld too
     (`apps/till/src/till-app.ts`, `onboardingIntent`). Keep it in the dashboard only.
  - **Watch, not a job yet:** on 2026-10-08 the phone's Chrome showed a white page for every box
    address (`/`, `/dashboard`, the box's IP) while the laptop drew it. Read over USB debugging,
    the page had loaded without errors and the join screen's element measured 679 px tall, while
    the owner still saw white; quitting and reopening Chrome fixed it. A browser fault or something
    of ours covering the page — not told apart. If it recurs, attach over USB before restarting
    Chrome: take a screenshot through the debugger and ask `elementFromPoint` what is on top.

## Splitting a held line's quantity on the till takes one request per unit

- **Splitting a held line's quantity on the till takes one request per unit.** Splitting a
  quantity of N sends N−1 move requests in turn (`#onSplitGroupLine`,
  `apps/till/src/till-app.ts`), because the move route refuses a request naming the same line
  twice (`moveLinesToGroup`, `apps/server/src/order-groups.ts`). A refusal part-way leaves the
  units already split. **Next action:** a server command that splits a line into single units in
  one transaction.

## Task 7 (#789, each person's draft kept on the server)

- **Task 7 (#789, each person's draft kept on the server).** Left open:
  - A draft that moves to the other party in a merge, because its owner had none there, records
    no history event: the event kinds have no "moved".
  - The server's own `unavailable` flag (`apps/server/src/order-drafts.ts`) does not flag a line
    whose options list is unanswered (refused at submission `options.label_required`), a
    fractional quantity of a dish sold whole (`quantity.invalid`), a course switched off since
    the save (`course.not_found`), or a menu version no longer live (`menu.version_changed`).
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
  - **Settled (owner, 2026-09-30):** part of a weighed line stays refused for a give-away or a
    discount (`adjustment.weighed_partial`); staff discount the whole line instead.
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

## A till request's `frozenExtras` and `frozenOptions` are taken as already settled, prices included

- **A till request's `frozenExtras` and `frozenOptions` are taken as already settled, prices
  included** (found in #903's review; I believe it predates that branch). `priceOrderLines`
  (`apps/server/src/working-order.ts`) trusts them as sent: a unit-level `parkOrder` call given
  an extra priced `"0.00"` at quantity 7 stored it at price 0, over its list's limit of 2. Read,
  not run: the park and held-order edit routes in `apps/server/src/till-api.ts` appear to pass
  `body.lines` through unchanged. **Next action:** send such a line through `POST` park and the
  held-order edit route; if it is stored, re-price or refuse client-sent frozen selections at the
  route boundary.

## Task 16 (#981, counter handover; with B25, B26, B29, B30)

- **Task 16 (#981, counter handover; with B25, B26, B29, B30).** Open:
  - **The kitchen queue's Collect sends no submission id**, on the station screen and on the
    counter's prep-queue card, so a Collect resent after a lost reply is refused
    `working_order.already_collected`. The waiting list's Hand over sends one. Assertions pin
    the no-id call in `apps/till/src/till-app.test.ts`,
    `apps/till/src/screens/till-station-screen.test.ts` and `apps/till/src/api/client.test.ts`.
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
    banner at its trailing edge with `z-index: 40`, a stacking order the top layer ignores): where
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

## Decisions and deliberate limits

**What the till shows the NEXT operator when the previous one's request answers late — CLOSED, no
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
