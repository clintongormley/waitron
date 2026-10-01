# What a station's ticket shows: the rest of the order, and dishes made at the till (slice 3c-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Update (2026-10-02, B29, branch `feat/service-handheld-permissions`):** `deviceSaleCfgOf` in
> `apps/server/src/bill-payments-api.ts`, which this plan cites, moved to
> `apps/server/src/device-session.ts` as the exported `deviceSaleCfg`, and `POST /api/sales` and the
> collect route now build their configuration through it too — anything this plan adds to it reaches
> them as well.

**Goal:** Two kitchen-ticket settings from the routing design. First, a station can be set to "Show
the rest of the order": its printed tickets and its kitchen screen then also list the order's other
dishes, each with the station making it. Second, a till or handheld can be told "items for these
stations are made here": when that device sends such an item, the item gets no ticket and appears on
no kitchen screen, while its station is still recorded as the place it is made. Such an item is
never held: it is made the moment it is sent, and the till that sent it shows a "Make now" list of
what to make until the waiter dismisses it (owner, 2026-10-01, after approval).

**Architecture:** Both settings are core data. "Show the rest" is a yes/no column on
`kitchen_stations`, written through core's existing station route and switched on Prep Stations
(3a's screen). One new reader, `readRestOfOrder` (`apps/server/src/rest-of-order.ts`), lists an
order's kitchen items with their stations; the ticket planner (`planKitchenTickets`,
`apps/server/src/kitchen-print.ts`) prints it under each station-scope ticket of a station that has
the setting, and the station queue (`listStationQueue`, `apps/server/src/working-order.ts`) hands it
to the kitchen screen inside each order's card, refreshed by the screen's existing 15-second poll.
"Made here" is a new core table, `device_made_here_stations`, edited on the Devices screen. A till
route that knows its device puts the device's id on the request's `TillConfig`; `fireLines` reads
that device's made-here stations once and, for each item whose FINAL station is one of them, writes
the kitchen record with a new `made_here` mark, fired and ready at once — never held (T12). The
request's answer carries the made-here items it recorded, and the till shows them as "Make now"
until dismissed (T13). A dish an edit
sends again keeps the mark its first send gave it, whichever device edits it. A made-here record is
never printed, gets no correction slip or kitchen notice, and is left out of the kitchen and expo
screens, the floor's kitchen counts, the overdue report and "Show the rest"; the till's own order
views still show it, as Ready (Task 11).

**Tech Stack:** TypeScript, Hono (server routes), drizzle-orm + drizzle-kit on `node:sqlite`, Lit web
components (dashboard and till; their suites run in real headless Chromium), Vitest.

**Spec:** [docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md](../specs/2026-09-30-catalogue-menus-routing-design.md),
§5.10's second bullet ("Show the rest of the order") and §5.11 ("Made here, no ticket"), and §5.12's
"Show the rest of the order" line on the station card. The owner split slice 3 into four plans on
2026-10-01, and 3c into three. This is 3c-1. **Not in this plan:** split-off extras and the
cross-references between a dish and its extras (§5.10's first bullet, §5.8 — 3c-2, branch
`feat/split-off-extras`); "Make at…" on any dish, moving a dish to another station after it is sent,
and re-routing a held dish whose station closed (3c-3, branch `feat/move-dish-station`); watchers and
what the whole-order "PASE" printer becomes (3d, design §8). The kitchen screen's column (kanban)
view gets no "rest of the order" (T3, a stated gap).

**Builds after slice 3a** (`docs/superpowers/plans/2026-10-01-prep-station-rules-slice-3a.md`,
branch `feat/prep-station-rules`), which creates the Prep Stations screen this plan adds a switch to.
Start this branch, `feat/rest-of-order-made-here`, from a `main` that holds 3a. **It is built
alongside slice 3b** (`docs/superpowers/plans/2026-10-01-station-hours-fallbacks-slice-3b.md`):
whoever lands second rebases. Where this plan says "3a's X" or "3b's X", read X in the code, not in
the 3a or 3b plan: the code is what landed. Line numbers below were read on `main` at `8aa9a4bfe`
(2026-10-01), BEFORE 3a, and rechecked at `f8850049f` for the files that moved since
(`apps/dashboard/src/api/client.ts`, `apps/dashboard/src/i18n/strings.ts`; the rest of the gap is
printing and backlog files this plan does not cite). The owner's amendment of 2026-10-01 (T12, T13,
Tasks 9b and 10) was read at `e6c46531f`, where `apps/server/src/working-order.ts` sits a few lines
lower than at `8aa9a4bfe` from about `fireLines` on (B24 landed between); its new citations are to
`e6c46531f`. 3a and 3b move most of them in
`working-order.ts`, so find each place by the function named beside the number. PR #974 (ticket text drawn as pictures) is merged, and every
citation of `kitchen-ticket.ts` and `kitchen-print.ts` below is to the code after it
(`formatKitchenTicket(ticket, layout: EscSetting)`, `emitItem(b, item, columns, sign)`).

**What 3b changes that this plan touches.** The rules below hold in BOTH directions. **When 3b is
on `main` first,** this branch rebases onto it and applies them, and adds Task 9's fallback case
before pushing (Task 9 Step 6 is a rebase-time step). **When this lands first,** 3b's builder must
apply them while rebasing 3b: at finish time Task 12 Step 5 writes them, as a dated rebase step, into
3b's committed plan file (its header and its Task 4), and the supervising session copies them into
3b's campaign queue item.

- 3b's Task 4 makes the first statement of `fireLines` its one clock reading, before any `await`,
  routes through `resolveMakers(..., at)`, reads each line's `make_at_station_id`, and takes
  `options.keepStations`. **The made-here read comes after the clock reading, never before it, and
  the made-here check (`made = …`, Task 9) comes after the line's station is final** — after the
  make-at station, the kept station and the fallback outcome (T9).
- 3b's `keepStations` and this plan's `keepMadeHere` (Task 9) are filled side by side in
  `applyLineEdits`, and they hold the SAME keys: each changed line sent again, AND each new line that
  carries units added to a sent dish (3b's S18 puts that new line in `keepStations` with the sent
  dish's ticket station, 3b plan `:1005-1011`; this plan puts it in `keepMadeHere` with the sent
  dish's decision — coordinator ruling 2 under T8). `keepStations` says which station the line keeps
  when the rules find no replacement; `keepMadeHere` says which made-here decision it keeps. Neither
  replaces the other; when resolving a conflict, keep both maps' entries for both kinds of line.
- 3b's Task 5 adds a core index `ticket_items_waiting_idx` in its own migration, and 3b's Task 4 adds
  `make_at_station_id` columns and a re-created freeze trigger. This plan's Task 1 migration
  collides with them by number. Fix it by regeneration, never by hand-editing the SQL, the snapshots
  or `_journal.json` (CLAUDE.md §3): `git checkout origin/main -- packages/db/drizzle` (save this
  branch's schema edits first — they live in `packages/db/src/schema`, which this does not touch),
  delete this branch's generated file if it survived, run
  `pnpm --filter @waitron/db db:generate --name rest_of_order_made_here`, READ it against Task 1's
  measured output, then run
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`.
- 3b's Tasks 5 and 7 add `printersDown` to the two station routes and a warning line on the kitchen
  screen; this plan adds `elsewhere` inside each order card. Both survive a rebase side by side.
- 3b's Task 6 adds a status line, hours and a fallback to each Prep Stations card; this plan adds one
  switch to the same card.
- 3b's waiting-dish query (`stationsWithWaitingDishes`) counts `queued` and `preparing` items fired
  in the last hour. A made-here item is always fired and `ready` (T12 below), so it never counts.

**3c-2** (`feat/split-off-extras`, after 3b) rewrites `fireLines` again and adds cross-references to
the ticket item shape; its X13 says an extra whose final station is made here gets no ticket and the
dish's ticket still names it. 3c-1 may land before or after 3c-2.

## Decisions for the owner (T1–T13)

None of T1–T11 was answered by the owner directly: each is a default from the slice 3c decisions
sheet (2026-10-01), and approving this plan approves them. The split of 3c into three plans is the
owner's. Two of them are applied with a correction, marked **Correction**, because the code works
differently from what the sheet assumed; each says what was found.

- **T1. "Show the rest of the order" is a yes/no on the station itself,** a new column on core's
  `kitchen_stations`, off by default. It is switched on 3a's Prep Stations card and saved through
  core's existing `PATCH /management-api/stations/:id`. It travels in configuration export with no
  change to the export list, because core copies `kitchen_stations` whole (`select *`,
  `apps/server/src/configuration-transfer.ts:237`; the list is
  `packages/db/src/configuration-transfer.ts:5`). Task 2 adds a test that it does.
- **T2. What the list holds:** every item of the ORDER (one bill, the same unit a ticket's order
  number names) that is now with ANOTHER station, from any send, each with its station's name. Left
  out: items whose line is served (`working_order_lines.served_at` set), items already sent away from
  the pass (`ticket_items.away_at` set: they are with the runner, no longer with a station — D6),
  "made here" items, lines that need no preparation (they have no kitchen record), and dishes not yet
  sent. A held item is listed as "on hold" (a recalled one too: it is held again). A line served in
  part lists its whole fired quantity (D7). The list is ordered by station name, then by the order's
  line number.
- **T3. On a kitchen screen** the list sits in the order's card in the card (rail) view, below this
  station's own lines, each line with its progress — New, Preparing, Ready (the screen's existing
  words for those states) or On hold. **Gap:** the column (kanban) view has no per-order card and
  shows nothing; a backlog entry records it. It refreshes with the screen's existing 15-second poll
  (`apps/till/src/screens/till-station-screen.ts:34`): the list rides on `listStationQueue`'s answer,
  and no live channel is added.
- **T4. On paper,** a plain list after the station's own items, under the heading
  "-- Also on this order (not for this station) --", one line per item: "2 x Burger — Grill", with
  " (on hold)" added for a held one. It is what is known when the ticket prints: a later send at
  another station does not reprint this ticket. The heading and "(on hold)" follow the till's
  language — Spanish when it is Spanish, otherwise English — as the cancelled-extra slip's words do
  (`extraCancelledWords`, `apps/server/src/kitchen-ticket.ts:227-236`). Dishes print by their
  kitchen names (CLAUDE.md §3; `docs/developers/products.md`).
- **T5. It applies to a station's own copy only,** never to the whole-order "PASE" ticket, which
  already lists every station in the send. Every station-scope ticket carries it: a first send, a
  FIRE ticket for released work, a HOLD ticket printed in advance, and a reprint. Correction slips
  (VOID, RECALLED, MOVED, HOLD CHANGED, CHANGED) do not. A reprint shows the order as it stands at the
  reprint, once per station: when a reprint joins a station's fired ticket and its HOLD ticket into
  one job (`reprintOrderTickets`, `apps/server/src/kitchen-print.ts:1089-1100`), only the fired
  ticket carries the block.
- **T6. The list's database read is checked for a full scan.** "This order's items at other
  stations" reads `ticket_items` by `working_order_id`, which has no index today. **Measured
  2026-10-01** (`node:sqlite`, Node v26.7.0, a database built from core's migrations at `8aa9a4bfe`
  plus this plan's, with no table statistics): `explain query plan` on that read printed
  `SCAN ti` without an index, and `SEARCH ti USING INDEX ticket_items_order_idx (working_order_id=?)`
  once `ticket_items_order_idx (working_order_id)` existed. The scan comes from the read's shape: the
  review measured the same read filtered on `working_order_lines.working_order_id` using existing
  indexes. The index is kept because existing reads filter `ticket_items` by order and scan it
  today, among them `readReprintParts`, `readSentWork` and `readTicketItemsOn`
  (`apps/server/src/kitchen-print.ts:987`, `:773`, `:814-841`), which the reviews measured with
  `node:sqlite` on `main`'s core migrations — `SCAN ticket_items` without the index,
  `SEARCH … USING INDEX ticket_items_order_idx` with it (no table statistics; for `readSentWork` and
  `readTicketItemsOn` on the SQL drizzle itself emits, for `readReprintParts` on a hand-written
  equivalent). Others of the same shape (`releaseHeld`, `releasedCourses`, `markCollected` in
  `working-order.ts`) were read, not measured. Task 1 adds
  it, with that reason in the commit, and Task 5 pins the plan with a test.
- **T7. "Made here, no ticket" is a per-DEVICE list of stations,** in a new core table
  `device_made_here_stations (device_id, station_id)`, keyed to `devices` and `kitchen_stations` and
  classified `state`. It is edited on the core Devices screen through a new
  `PUT /management-api/devices/:id/made-here` beside the hardware route. It is not on the device
  profile, because a profile is shared: two tills with one profile would both claim the bar's drinks.
  **Cost:** it does not travel in configuration export, because devices do not (the export list,
  `packages/db/src/configuration-transfer.ts:1-37`, has no `devices`); a venue set up from an export
  sets it again. A backlog entry records it.
- **T8. "Here" is the device that sends the item, when the item is first sent** (on hold included).
  Paths with no device have no "here", and the item gets a ticket as usual: a card payment a manager
  resolves from the dashboard (`apps/server/src/payments-api.ts:713-720`, which passes `deps.cfg`
  with a till id and no device), a card bill payment a manager attests from the dashboard
  (`apps/server/src/payments-api.ts:890`), and a bill payment completed later by the background loop
  (`apps/server/src/bill-payments-loop.ts:129`). `POST /api/working-orders/:id/prep`
  (`apps/server/src/till-api.ts:1289-1296`) is left unwired too, because no till screen calls it: the
  till's client defines `sendToPrep` (`apps/till/src/api/client.ts:2064`) and
  `grep -rn sendToPrep apps/till/src` finds no caller (D8).
  **"First sent" holds through an edit (coordinator ruling 1, 2026-10-01):** when a change to a dish
  the kitchen has makes the edit path delete its record and send the dish again
  (`applyLineEdits`, `apps/server/src/working-order.ts:4168-4178`), the new record keeps the deleted
  record's made-here decision, whichever device made the edit. Units added to a dish the kitchen
  has, which the edit path puts on a NEW line, follow the dish they join, as 3b makes their station
  do (coordinator ruling 2, 2026-10-01). A dish added to the order for the first time, and units
  on a new line whose dish has no kitchen record, are decided by the editing device: there is no
  earlier decision to follow (review 3, I2).
  **Correction (how, not what):** the sheet says the device's stations reach `fireLines` "as a
  `fireLines` option". The device is known at the route, but `fireLines` is reached from there
  through `recordTillSale`, `payWorkingOrderIntegrated`, `placeOrder`, `submitGroups`, `submitDraft`,
  `updateHeldOrder`, `updateOrderLine`, `moveBill`, `moveGuests`, `joinTables`, `combineParties`,
  `splitTable`, `takeIntoParty` → `adoptZone`, `issueIfFullyPaid`, `takeBillPayment`,
  `takeReaderBillPayment` and `completeBillPayment`, none of which takes such an option. This plan carries the device's id on the
  request's own `TillConfig` instead, as a new optional `sendingDeviceId`, exactly as the
  request-derived `allowCashDrawer` already rides there (`apps/server/src/till-config.ts:37-38`, set
  from the device in `deviceSaleCfgOf`, `apps/server/src/bill-payments-api.ts:198-208`). `fireLines`
  reads it from `cfg`. The behaviour is the sheet's; only the carrier differs. Which routes carry it
  is derived from the call graph up from `fireLines` (Task 9 Step 3), not from this list. Also
  found: the integrated-card recovery (`apps/server/src/till-sale.ts:1256` at `efb0ebf9d`) runs inside the
  `/api/pay` request (`payIntegrated` calls `finalizeRecovery`, `apps/server/src/till-sale.ts:891`),
  so it DOES know its device and is treated as a device path.
- **T9. Made here is checked against the station the item finally goes to:** after the rules (3a)
  and, once 3b is in, after fallbacks, a station kept on an edit and the waiter's Make at. If the bar
  is closed and its work goes to the downstairs bar, the bar till is not making it, so the downstairs
  bar gets a ticket.
- **T10. A made-here item is kept as a kitchen record with a made-here mark** (a new not-null
  `ticket_items.made_here`, default false), so its station stays its maker and cancels, splits and
  moves keep working through the existing paths (it is never held, T12). Every kitchen-facing reader leaves it out: printing (first send, release, HOLD
  tickets, reprint, correction slips), kitchen notices, the station and expo screens, the table
  signals, the tables-with-state read, the overdue-orders report and "Show the rest". The till's own
  order views keep it, as Ready (Task 11's "Not changed, on purpose"). Nothing fiscal reads kitchen
  records. **Correction:** the sheet says the record is "born ready" so that "edits
  keep working through the existing paths". They would not: the edit path refuses any item whose
  state is `preparing` or `ready` (`kitchenHas`, `apps/server/src/working-order.ts:3816-3826`), recall
  refuses one too (`apps/server/src/working-order.ts:1718-1720`), and the till hides Change and Recall
  for it (`#canChange` and `#canRecall`, `apps/till/src/screens/till-table-order-screen.ts:1679-1692`) —
  all three read in the code, not run; Task 10's tests pin the server's two refusals. So this plan
  does this instead:
  - **fired now:** the record is born `ready` (`ready_at` = the fire time). By default, like any
    dish the kitchen has started, it can be cancelled but not changed or recalled: it was made on the
    spot. The owner chooses between this and an alternative at approval (D1).
  - **never held:** see T12 (owner, 2026-10-01, after approval). _The approved plan had a held
    made-here record wait as `queued` and turn `ready` at release; the owner replaced that: such an
    item printed nowhere when released, so nothing told the waiter to make it._
- **T11. A made-here item gets no slip and no notice:** cancelling it (in whole or in part),
  cancelling one of its extras, or moving its bill to another table prints nothing at its station and
  records no kitchen notice.
- **T12. A made-here item is never held (owner, 2026-10-01, after approval: "a made-here item should
  never be held, it must be made in the moment otherwise the waiter will forget").** Whenever a send
  would put an item on hold — a course not yet started, a held group, a round sent on hold, units
  added beside a held dish — and the item's final station is one its sending device makes here, the
  item is not held: `fireLines` records it fired at the send's one clock reading, `ready`, made here.
  **The owner accepts that a made-here drink ordered for a later course, or in a held group, is made
  at once.** So a made-here record ALWAYS has a fire time and is `ready` (Task 10 pins it after every
  path below). What each hold path does with it (read on `main` at `e6c46531f`, not run; Task 10's
  tests pin each):
  - **The course hold in `fireLines`** (`fired`, `apps/server/src/working-order.ts:1295-1300`): a
    made-here line fires whatever its course. It still COUNTS for its course when the order's first
    course is worked out (`courseRows`' `itemCount` and the round's `orderCourseIds`,
    `:1250-1279`), so a course holding only a made-here aperitif is still the first course and a
    burger in course 2 waits for course 2 (D10, owner). It does NOT count as the course having
    started (`anyFired`), so a later dish of its course is not fired at once because of it.
  - **`hold: true` lines** — a held group's lines from `placeGroups` (`apps/server/src/order-groups.ts:194`),
    a held round from `addTabRound` (`working-order.ts:1849`; only tests and `testing/party-venue.ts`
    call it), an edit's new work held beside a held dish (`hold: as.kitchen === "hold"`,
    `working-order.ts:4240`): fired now, the same way. `insertTabRound` (`:1903`) writes order lines
    only; its caller's `fireLines` decides.
  - **Its group.** The line keeps its `group_id`, so a held group can hold a made-here line.
    `isReleased` (`working-order.ts:2264-2272`) counts a line whose record is made here as released,
    so it can be served at once (`servableLines`, `:2220`), the till's current orders show it released
    (`readCurrentOrders`, `order-groups.ts:1149`), an adjustment reads it as fired (`stageOf`,
    `apps/server/src/adjustments-apply.ts:260-264`), and a bill moved into a party puts it in the
    fired group (`groupArrivingDishes`, `order-groups.ts:1434`). A held group whose only line is a
    made-here drink stays "held", and the till's release reminder will still ask the waiter to fire
    it; firing it changes nothing in the kitchen. Accepted. `refuseHeldLeavingParty` (`working-order.ts:3060`)
    still keys on the group's state, so the line's bill stays in the party until the group fires, like
    every line of that group (unchanged).
  - **HOLD tickets and HOLD corrections.** `printHoldTickets` (`order-groups.ts:1175-1209`) prints
    records with no fire time, so a made-here record is never on one. `correctJoin`
    (`order-groups.ts:1283-1308`) reads joining lines' records with no fire-time filter; the made-here
    filter in `enqueueHoldCorrections` (Task 10) drops it. `planHeldCorrections` concerns held records
    only.
  - **`readGroups`' counts** (`order-groups.ts:802-877`) are NOT changed (coordinator ruling,
    2026-10-01): a made-here record is fired and `ready`, so it counts as a ready dish. A fired group
    of made-here drinks alone reads Ready, as its rows do. A held group holding one could read
    "ready" in the API, but the till never shows it: `#groupProgress` answers "held" for a held group
    before it looks at `ready` (`apps/till/src/screens/till-table-order-screen.ts:3188`). _(The
    amendment's first draft left made-here records out of these counts; that left a fired group of
    drinks never reading Ready, and was dropped.)_
  - **Releases** — `releaseGroup` (`order-groups.ts:420-452`) → `fireOrderLines` → `releaseHeld`,
    `fireCourse`, and `sendLines`: each stamps records with no fire time (`working-order.ts:1532`,
    `:1624`), so it finds nothing of a made-here item and prints nothing of it.
  - **B21's sent stamp on a presented or paid bill** (`stampSent`, `working-order.ts:1359-1385`, run
    again when a group or course fires): a made-here line was stamped sent at its own send, and
    `stampSent` stamps only lines with no `sent_at` (`:1376`), so a later fire leaves it alone.
  - **Recall** un-fires only `queued` records (`working-order.ts:1744`), so it never un-fires a
    made-here one; the started check refuses it first anyway (D1).
  - **An edit's view of the bill** (`readEditableOrder`, `working-order.ts:3771-3780`; coordinator
    ruling, 2026-10-01): for `newWork`, a made-here line counts as SENT work (its `sent_at` is set),
    unless its group is held, where it counts as held work — so a burger added by an edit to a bill
    whose only sent work is a made-here drink is fired, or held by its course, as before; leaving the
    drink out would have answered `"none"` (`:3530-3534`), and the burger would have got no kitchen
    record at all (`:4085`, `:4231`). `firedCourseIds` leaves made-here records out, as `anyFired`
    does (D10).
  - **3b's `keepStations` and this plan's `keepMadeHere` on held lines:** no made-here record is
    held, and a change or raise of a fired made-here dish is refused (D1), so neither map meets one;
    `keepMadeHere`'s `madeHere: true` entries arise only under D1's alternative.
- **T13. The waiter is told what to make (owner, 2026-10-01, after approval: "what happens when a
  held made-here item gets sent? it doesn't get printed anywhere. how does the waiter know to make
  it?").** Every till request whose work records a made-here item answers with those items, and the
  till shows them in a "Make now" / "Preparar ahora" list — "2 × Lager, 1 × Mojito", each with its
  options, extras and note — that stays until the waiter dismisses it, and grows if another send
  adds more. It names each item by its **staff name** (`staffPresentationName`,
  `packages/catalogue/src/product-presentation.ts:16`), as the till's basket and the tab's line list
  do (`docs/developers/products.md:158-159`; options read the staff wording there too, `:162`): the
  list is a till surface, read by the person who just rang the item up under that name, not a kitchen
  ticket read by a cook; and CLAUDE.md §3 gives each surface one name. Extras print as their frozen
  staff names with " x<n>", as the kitchen paper labels them (`extraLabel`,
  `apps/server/src/kitchen-print.ts:80-83`). Task 9b builds it.

**Further defaults this plan takes (D1–D11)** — approved with the plan:

- **D1. A made-here dish that has fired can be cancelled, not changed — or the owner may choose the
  alternative.** Default: it counts as started, so the edit route refuses a change to it
  `ticket.already_started` and the till offers only Cancel, which prints nothing (T10, T11). **Or:**
  allow a change — the edit and recall refusals treat a made-here record as not started, and a change
  re-records it as made here, with no slip (the review notes this is possible in the code; it would
  also need the till's `#canChange` to stop treating such a line as started, which needs the line's
  made-here mark sent to the till). The plan builds the default; choosing the alternative at approval
  adds a task.
- **D2.** The Prep Stations switch saves the moment it is flipped, as the Devices screen's card-reader
  choice does; it has no Save button. So do the Devices screen's made-here boxes.
- **D3.** The made-here boxes are offered only for devices that send work (tills and handhelds),
  never for a kitchen screen. The route itself does not refuse a kitchen screen.
- **D4.** The made-here route accepts only switched-on stations of this venue (`station.not_found`,
  through the existing `requireLiveStation`, `apps/server/src/kitchen.ts:34-52`). A station switched
  off later stays in the list but should never be an item's final station (3a's R2 skips a rule
  naming one, and 3b's S3 sends its work to its fallback — read in their plans, not run), and it
  drops out the next time the list is saved: the screen builds the list it saves from the boxes it
  shows, which are the switched-on stations only (Task 8), never from the stored list — a stored
  switched-off id sent back would be refused `station.not_found` and block every later save.
- **D5.** No new error code: refusals reuse `management.request_invalid`, `device.not_found`,
  `station.not_found` and `ticket.already_started`.
- **D6.** "Show the rest" leaves out items already sent away from the pass (`away_at` set): they are
  with the runner, not with another station.
- **D7.** "Show the rest" lists each item at the quantity the kitchen is now asked for
  (`firedQuantity`, `apps/server/src/kitchen-print.ts:519`), not at what is left to serve, so a line
  served in part lists that whole quantity. That quantity can differ from what the item's own ticket
  printed: a partial cancel lowers it (`working-order.ts:2131`) and a held line changed in place
  rewrites it (`:4182`).
- **D8.** `POST /api/working-orders/:id/prep` is not given the device, because no till screen calls it
  (T8). If a screen starts calling it, it joins Task 9's wiring.
- **D9. Reading the device on the routes that put it off.** `sendingCfg` adds a device read to the
  edit and group routes, which today read the device only when an invoice is due
  (`withSaleTillWhenIssuing`, `apps/server/src/bill-payments-api.ts:210-228`). After a token's first
  check, a read is one row plus a remembered-digest comparison (`alreadyVerified`,
  `apps/server/src/device-session.ts:209-225`), and at most one sighting write a minute — read in
  the code, not measured. The read must run BEFORE the route opens its transaction: a sighting opens
  a transaction of its own, which the write queue refuses inside another (the same file's comment,
  `bill-payments-api.ts:213-215`).
- **D10. A made-here item counts for its course when the first course is worked out (owner,
  2026-10-01: "Burger waits for course 2, otherwise the waiter should have sent them together").** A
  round of a made-here aperitif in course 1 and a burger in course 2: the aperitif is made now (T12),
  course 1 is the order's first course, and the burger is held until course 2 is fired — as it would
  be with a Bar ticket for the aperitif. A made-here record does not, however, mark its course as
  started (`anyFired`): a dish of that course sent in a later round is held or fired by the course's
  other dishes, never because a drink was made at the till. _(The amendment's first draft left
  made-here items out of the first-course choice too; the owner reversed that.)_
- **D11. The "Make now" list survives a reload (owner, 2026-10-01).** The till keeps it in the
  device's own storage (`localStorage`), under a key naming the device —
  `waitron.makeNow.<deviceId>`, the shape of the lock screen's `waitron.lastOperator.<deviceId>`
  (`apps/till/src/screens/till-lock-screen.ts:12`) — so another device in the same browser (the dev
  stack's device switcher) never shows it; with no device known it lives in memory only. Every read
  and write is wrapped in `try`/`catch`, as the lock screen's are (`:184-192`), and when storage
  throws the list still works in memory. "Done" empties it and removes the key. _(The amendment's
  first draft kept it in memory only; the owner reversed that.)_

## Global Constraints

- Every commit: `git commit -s`, message in plain English (owner rule; name files and codes once as
  pointers).
- Coverage `98/98/98/95` in every package touched; never close a gap with an exclude or an ignore
  comment. Mutation-tested package touched: `db` (Task 1's columns, table and index). A thinned test
  there reddens the weekly mutation run.
- Every colour, spacing, radius and font reads a `--wt-*` token: no hex, no named colour, no
  `rem`/`em`.
- Forms follow `docs/developers/design-system.md` → Forms: every input has a semantic `name`; a
  refusal goes on its own line at the BOTTOM of the group it belongs to, never beside a button
  (owner 2026-09-30).
- Every new string in English AND Spanish: Prep Stations in
  `packages/venue-service/src/dashboard/strings.ts`, the Devices screen in
  `apps/dashboard/src/i18n/strings.ts`, the kitchen screen in `apps/till/src/i18n/strings.ts`
  (`station.*`, English at `:104-146`, Spanish at `:908-945`), printed words in
  `apps/server/src/kitchen-ticket.ts`.
- Each surface shows ONE of a product's three names (CLAUDE.md §3): the rest of the order is a
  kitchen surface and reads `kitchenPresentationName`. Every test fixture for it gives the staff, the
  customer-facing and the kitchen name DIFFERENT text, so a test fails if the wrong one shows.
- Migrations: never edit a shipped migration file. Generate with
  `pnpm --filter @waitron/db db:generate --name <name>` and READ the file: a `__new_<table>`
  rebuild is a STOP (CLAUDE.md §3) — then this plan's landing rule becomes "needs the owner's
  review". The migration number here is illustrative; the generator picks the next free one.
- The one place a station is chosen and a kitchen record is written stays `fireLines`
  (`apps/server/src/working-order.ts`). A rule change never moves work already sent.
- Module boundary: core code reaches venue-service only through the `VENUE_SERVICE` seat
  (`apps/server/src/modules.ts`); core dashboard code never calls `/management-api/venue-service/*`.
  This plan's data is core's, so it adds no seat method.
- Queries on one transaction are awaited in turn, never `Promise.all` (CLAUDE.md §3).
- Browser suites: check `memory_pressure | grep free` and `ps -axo rss,command | sort -nr | head`
  before a browser run; do not start one beside a whole-workspace `pnpm -r test:coverage`.
- Run focused tests while implementing; CI runs the package suites. Do not hand-run the pre-push
  checks before pushing.

## Review Focus

These are the inputs likeliest to hurt a venue. Each is pinned by a test in the task named:

1. **A made-here drink still reaches paper or a screen.** The bar till lists Bar as made here, and Bar
   has a printer and a kitchen screen. A lager sent from the bar till: no print job at Bar, nothing
   on Bar's queue, on the expo board, in the table's "ready" count or in the overdue report; the line
   is still stamped sent and still servable. The same lager sent in a held group, in a course not yet
   started, and in a round sent on hold: made at once (fired, `ready`), no HOLD ticket, and releasing
   the group, the course or the round later prints nothing at Bar.
   A reprint of the order: no lager. Cancelling it, cancelling its extra, and moving its bill to
   another table: no slip, no notice. (Tasks 9, 10, 11)
2. **The station the item finally goes to decides, not the device.** The bar till lists Bar; a rule
   sends the lager to Downstairs bar: Downstairs bar gets a ticket. A burger sent from the bar till
   goes to Grill with a ticket. (Task 9; with 3b in, also a closed Bar whose fallback is Downstairs
   bar — Task 9 step 6)
3. **A device without the setting, and a path with no device, still print.** Two tills share one
   device profile; only the one whose own list names Bar makes Bar's items here. `fireLines` with no
   `sendingDeviceId` prints at Bar. (Tasks 8, 9)
4. **Every route that can send work carries its device, and an edit keeps the first send's
   decision.** Each wired place — `POST /api/sales`, `POST /api/pay`, both edit routes,
   place, group submit, draft submit, the three party table moves, bill move, and `deviceSaleCfgOf`
   (bill payments, splits, adjustments) — has a case that fails when its device id is removed. A lager
   first sent from a handheld and then changed or raised on the bar till gets a ticket at Bar (after a
   RECALLED slip, for the change).
   (Task 9)
5. **Show the rest says only what is known, and only where it is asked for.** Grill shows the rest,
   Fryer does not, and a PASE printer hangs off Grill. First send of a burger (Grill) and chips
   (Fryer): Grill's ticket lists "Chips — Fryer"; Fryer's and the PASE ticket have no block. A later
   salad to Cold prints nothing new at Grill. A reprint at Grill lists chips and salad. A served line,
   a made-here line, a line sent away from the pass and a no-preparation line are never listed; a
   held dessert is "(on hold)". A reprint of a station with fired and held-in-advance work prints the
   block once. A Spanish till prints the Spanish heading. (Tasks 4, 5)
6. **A made-here item is never held, and never disturbs what is held** (owner, 2026-10-01). A
   made-here aperitif in a held group with a burger: the aperitif is made now and can be served now;
   the till still shows the group as held (the API answers `ready: true` for it, which the till
   ignores for a held group, T12), and its HOLD ticket names only the burger. A made-here
   drink in course 2 does not make a later course-2 dish fire at once, and a made-here aperitif in
   course 1 still keeps a course-2 burger waiting (D10, owner). The "Make now" list survives a reload
   on the same device and is gone after Done (D11, owner). A change is refused
   `ticket.already_started`; Cancel still works silently. (Task 10)
7. **The kitchen screen's list never confuses the cook.** The card lists other stations' items with
   their progress and "On hold", by kitchen name; a station with the setting off shows nothing; the
   column view shows nothing. (Tasks 6, 7)
8. **The read does not scan.** `explain query plan` on the rest-of-order read names
   `ticket_items_order_idx` and no `SCAN` of `ticket_items`. (Task 5)
9. **The waiter is told what to make** (owner, 2026-10-01). After a table Send and after a counter Pay
   from the bar till, the till shows "Make now" with each made-here item by its staff name, until the
   waiter dismisses it; a send with no made-here item shows nothing. (Task 9b)

---

## File structure

**Created**

- `packages/db/src/schema/device-made-here-stations.ts` + `device-made-here-stations.test.ts` — the
  per-device list.
- `packages/db/src/schema/kitchen-stations.test.ts` — the new flag's default.
- `packages/db/drizzle/00NN_rest_of_order_made_here.sql` (generated).
- `apps/server/src/rest-of-order.ts` + `rest-of-order.test.ts` — `readRestOfOrder`.
- `apps/server/src/made-here.ts` + `made-here.test.ts` — `readMadeHereStations`,
  `listMadeHereStations`, `setMadeHereStations`, `readMadeHereItems`, the `madeHereAnswer`
  middleware, and the send-path tests.
- `apps/till/src/widgets/make-now.ts` + `make-now.test.ts` + `make-now.a11y.test.ts` — the "Make now"
  list (T13).

**Modified (main ones)** — each task lists its own exactly.

- `packages/db/src/schema/{kitchen-stations,ticket-items,index}.ts`, `packages/db/src/classification.ts`,
  `packages/db/src/schema/ticket-items.test.ts`, `scripts/schema-constraints.test.ts`
- `apps/server/src/{till-config,kitchen,management-api,device-api,kitchen-ticket,kitchen-print,
  working-order,order-groups,table-signals,till-api,bill-payments-api}.ts`,
  `apps/server/src/testing/clear-provision-fixture.ts`
- `packages/reporting/src/overdue-orders.ts`
- `apps/dashboard/src/{api/client,api/live-queries,screens/devices-screen,i18n/strings}.ts`
- `packages/venue-service/src/dashboard/{prep-stations-screen,routing-client,strings}.ts` (3a's)
- `apps/till/src/{api/client,widgets/station-queue,i18n/strings,till-app}.ts`
- `docs/backlog.md`, the design, `docs/developers/products.md`

---

### Task 1: Storage — the station's switch, the made-here mark, the device's list, and an index

**Files:**
- Modify: `packages/db/src/schema/kitchen-stations.ts` — after `active` (`:22`):
  `showsRestOfOrder: flag("shows_rest_of_order").notNull().default(false),`
- Modify: `packages/db/src/schema/ticket-items.ts` — import `flag` from `./columns.js` (the import
  list at `:2-12`); after `quantity` (`:66`):
  `madeHere: flag("made_here").notNull().default(false),`; beside `ticket_items_queue_idx` (`:72`):
  `index("ticket_items_order_idx").on(t.workingOrderId),`. The table's doc comment (`:24-27`) says the
  item is "inserted when a line is sent to the kitchen"; add one sentence of invariant: "A `made_here`
  item was made on the spot at the device that sent it (design §5.11): it is never printed, it is
  left out of the kitchen and expo screens, the floor's kitchen counts and the overdue report, and it
  is `ready` from the moment it fires."
- Create: `packages/db/src/schema/device-made-here-stations.ts`; export it from
  `packages/db/src/schema/index.ts` beside `devices` (`:15`)
- Modify: `packages/db/src/classification.ts` — `classify("device_made_here_stations", "state", STATE),`
  beside `devices` (`:69`). That also makes it a change source (`CORE_CHANGE_SOURCES`, `:198`), which
  Task 8's live query needs.
- Create (generated): `packages/db/drizzle/00NN_rest_of_order_made_here.sql`
- Modify: `scripts/schema-constraints.test.ts` — two rows in `EXPECTED_FOREIGN_KEYS`, in its
  alphabetical place (near `device_card_readers`, `:60-61`):
  `["device_made_here_stations", ["device_id"], "devices"]`,
  `["device_made_here_stations", ["station_id"], "kitchen_stations"]`
- Modify: `apps/server/src/testing/clear-provision-fixture.ts` — `"device_made_here_stations"` in the
  list before `"kitchen_stations"` (a row there would block deleting a station).
- Create: `packages/db/src/schema/device-made-here-stations.test.ts`,
  `packages/db/src/schema/kitchen-stations.test.ts`
- Modify: `packages/db/src/schema/ticket-items.test.ts`

**Schema** (`device-made-here-stations.ts`; the column vocabulary comes from `./columns.js`,
CLAUDE.md §3):

```ts
import { foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { id, table } from "./columns.js";
import { devices } from "./devices.js";
import { kitchenStations } from "./kitchen-stations.js";

/** The stations whose items a device makes on the spot when it sends them (design §5.11). */
export const deviceMadeHereStations = table(
  "device_made_here_stations",
  {
    deviceId: id("device_id").notNull(),
    stationId: id("station_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.stationId], name: "device_made_here_stations_pk" }),
    foreignKey({ columns: [t.deviceId], foreignColumns: [devices.id], name: "device_made_here_stations_device_fk" }),
    foreignKey({ columns: [t.stationId], foreignColumns: [kitchenStations.id], name: "device_made_here_stations_station_fk" }),
  ],
);
```

Devices are never deleted (revoked by `active = false`, `packages/db/src/schema/devices.ts:13-14`) and
stations never deleted (switched off, `apps/server/src/kitchen.ts:169-170`), so neither key needs a
cascade. Both tables are `state`, so `scripts/two-file-foreign-keys.test.ts` allows the keys.

**Measured 2026-10-01** on a detached throwaway worktree of `main` at `8aa9a4bfe` (removed after):
with exactly these schema changes, `pnpm --filter @waitron/db db:generate --name probe` emitted

```sql
CREATE TABLE `device_made_here_stations` (
	`device_id` text NOT NULL,
	`station_id` text NOT NULL,
	PRIMARY KEY(`device_id`, `station_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `kitchen_stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `kitchen_stations` ADD `shows_rest_of_order` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ticket_items` ADD `made_here` integer DEFAULT false NOT NULL;
```

and, with the index added on top, one `CREATE INDEX \`ticket_items_order_idx\` ON \`ticket_items\`
(\`working_order_id\`);` — no `__new_` rebuild in either. Applied with `node:sqlite` (Node v26.7.0)
to a database that already held one `kitchen_stations` row and one `ticket_items` row, both existing
rows read `0` (an integer) in the new column afterwards. No trigger in `packages/*/drizzle/*.sql`
names `ticket_items` or `kitchen_stations` (`grep -ln 'ticket_items\|kitchen_stations'
packages/*/drizzle/*.sql | xargs grep -ln 'CREATE TRIGGER'` printed nothing). Your generated file
must read the same, with its own number; anything else is a STOP.

- [ ] **Step 1: Write the failing tests.** Copy the setup of `packages/db/src/schema/devices.test.ts:1-60`
  (`useVenueDb({ migrations: [CORE_MIGRATIONS] })`, a tenant, a location, a station, a device profile)
  and add a till device.

  `device-made-here-stations.test.ts`:

```ts
it("stores a device's made-here station once", async () => {
  await inTx((tx) => tx.insert(deviceMadeHereStations).values({ deviceId: TILL, stationId: STATION_A }));
  const duplicate = await captureError(() =>
    inTx((tx) => tx.insert(deviceMadeHereStations).values({ deviceId: TILL, stationId: STATION_A })),
  );
  expect(isUniqueViolation(duplicate)).toBe(true);
});

it("refuses a device or a station that does not exist", async () => {
  for (const row of [
    { deviceId: GHOST_DEVICE, stationId: STATION_A },
    { deviceId: TILL, stationId: GHOST_STATION },
  ]) {
    const error = await captureError(() => inTx((tx) => tx.insert(deviceMadeHereStations).values(row)));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true); // as devices.test.ts asserts its keys
  }
});
```

  `kitchen-stations.test.ts`: a station inserted without the column reads
  `showsRestOfOrder: false`.

  `ticket-items.test.ts` (read its setup first): an item inserted without the column reads
  `madeHere: false`; and the index exists by name:

```ts
it("indexes the items of an order", async () => {
  const { rows } = await suite.db.execute<{ name: string }>(sql`select name from pragma_index_list('ticket_items')`);
  expect(rows.map((r) => r.name)).toContain("ticket_items_order_idx");
});
```

- [ ] **Step 2: Run to verify they fail.**
  `pnpm --filter @waitron/db exec vitest run src/schema/device-made-here-stations.test.ts src/schema/kitchen-stations.test.ts src/schema/ticket-items.test.ts`
  Expected: FAIL (the table, the columns and the index do not exist).

- [ ] **Step 3: Implement** the schema edits, then
  `pnpm --filter @waitron/db db:generate --name rest_of_order_made_here` and READ the file against the
  measured output above. Then the classification row, the constraint guard rows and the fixture list.

- [ ] **Step 4: Run to verify they pass** (same command), then
  `pnpm --filter @waitron/db exec vitest run src/classification.test.ts` and
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migration-upgrade.test.ts scripts/behavioural-triggers.test.ts scripts/append-only-triggers.test.ts`.
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`
  (CLAUDE.md §3's regeneration set). Expected: PASS. The fresh-context review ran the first five root
  guards on exactly this schema on 2026-10-01 (unset `AI_AGENT` and `CLAUDECODE`): all 33 passed, and
  the upgrade walk needed no `CANDIDATES` entry. If, after a rebase, it fails with
  `could not write row N of device_made_here_stations`, the fix is usually a `CANDIDATES` entry giving
  the filler a real device and station, never a `RESETS` one (read the test's header).

- [ ] **Step 5: Mutation check by hand** (`packages/db` holds a mutation floor of 90 over `src/**`,
  `packages/db/stryker.config.json`). One at a time, change `default(false)` to `default(true)` on
  each new flag, and rename the index; run
  `pnpm --filter @waitron/db exec vitest run src/schema/ticket-items.test.ts src/schema/kitchen-stations.test.ts`
  after each and confirm it fails; restore each from a copy saved to `/tmp` first (CLAUDE.md memory:
  `git checkout <path>` discards uncommitted work). Record the three failures in the commit message.

- [ ] **Step 6: Commit** — `git add packages/db apps/server/src/testing/clear-provision-fixture.ts scripts/schema-constraints.test.ts && git commit -s -F <message file>` with this message (CLAUDE.md §3: no new table enters the core
  migration set without a stated reason in the commit):

```
Kitchen data: a station can show the rest of the order, a kitchen record can be marked made
here, a device lists the stations it makes on the spot, and an order's kitchen records are
indexed (core migration; plain column adds, one new table, one index, no table rebuild).

Why device_made_here_stations is a CORE table: both its keys point at core tables (devices and
kitchen_stations), it is edited on the core Devices screen, and fireLines, which is core, reads
it on every send; in a module it would need a new seat call on the send path, and core
dashboard code may not call a module's routes.

Why ticket_items_order_idx: the new rest-of-order read filters ticket_items by order, and so do
existing reads that scan the table today, among them readReprintParts, readSentWork and
readTicketItemsOn (each measured: SCAN without the index, SEARCH with it).
```

---

### Task 2: The station's switch is listed, saved and exported

**Files:**
- Modify: `apps/server/src/kitchen.ts` — `Station` (`:21-32`) gains `showsRestOfOrder: boolean`;
  `listStations` (`:99-118`) selects `kitchenStations.showsRestOfOrder`; `updateStation`
  (`:121-168`) takes `showsRestOfOrder?: boolean` in both its `patch` and `set` shapes.
- Modify: `apps/server/src/management-api.ts` — `PATCH /management-api/stations/:id`
  (`:1656-1735`): read `showsRestOfOrder`; a value that is not a boolean is refused
  `management.request_invalid { field: "showsRestOfOrder" }`, as `active` is (`:1688-1692`). **The
  "nothing to change" early return (`:1722-1731`) must also test `patch.showsRestOfOrder ===
  undefined`**, or a PATCH carrying only the switch answers 204 and saves nothing.
- Modify: `apps/dashboard/src/api/client.ts` — `Station` (`:416-425`) gains
  `showsRestOfOrder: boolean`.
- Test: `apps/server/src/management-api.test.ts` (the station cases), `apps/server/src/configuration-transfer.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `management-api.test.ts`, beside the existing station PATCH cases: `PATCH` with
    `{ showsRestOfOrder: true }` alone answers 204 and `GET /management-api/stations` then shows
    `showsRestOfOrder: true` for that station (this is the case the early return would break);
    `{ showsRestOfOrder: "yes" }` answers 400 with `code: "management.request_invalid"` and
    `params: { field: "showsRestOfOrder" }`; a new station lists `showsRestOfOrder: false`.
  - `configuration-transfer.test.ts`, in the style of "transfers the venue's limit on a bill's total
    discount" (`:986`): a station with `shows_rest_of_order` set is exported and imported into a fresh
    venue, and the imported station has it set (T1's claim, measured).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/management-api.test.ts src/configuration-transfer.test.ts -t "rest of the order"`
  (name the cases so `-t` finds them). Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command and `pnpm --filter @waitron/server typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — "Stations: the Show the rest of the order switch is listed, saved through the station route and carried by configuration export".

---

### Task 3: Prep Stations — the switch on each station card

**Files:**
- Modify: 3a's `packages/venue-service/src/dashboard/prep-stations-screen.ts`, its `.test.ts` and
  `.a11y.test.ts`; 3a's `routing-client.ts` (its station type gains `showsRestOfOrder`, and its
  station write sends it to core's `PATCH /management-api/stations/:id` — find the method 3a wrote for
  that route); `packages/venue-service/src/dashboard/strings.ts` (both languages)

**Behaviour (the tests pin each):**
- Every station card (the default's included) shows a `wt-switch` with `name="showsRestOfOrder"` —
  the API field's name, as the sibling switch is named `editSentLines`
  (`packages/venue-service/src/dashboard/venue-operations-screen.ts:782`) — label "Show the rest of
  the order" / "Mostrar el resto del pedido", bound
  `.checked=${live(station.showsRestOfOrder)}` (`import { live } from "lit/directives/live.js"`, as
  the sibling does at `:784`: a plain `.checked=` is compared with Lit's last rendered value, not the
  DOM, so it could not put the switch back after a refusal), and
  under it one line of explanation: "Its tickets and kitchen screen also list the order's dishes at
  other stations." / "Sus comandas y su pantalla de cocina también muestran los platos del pedido en
  otras estaciones."
- Flipping it (`wt-change`) saves at once through the station write with
  `{ showsRestOfOrder: <checked> }`; the switch is `disabled` while the request runs.
- A refusal puts the switch back to the stored value (re-render; `live()` makes that reach the DOM).
  `management.request_invalid { field: "showsRestOfOrder" }` names the switch, so its message shows
  on its own line directly under the switch (CLAUDE.md §3: a refusal naming a shown field goes under
  that field); any other refusal shows on its own line at the bottom of that card. Both
  `role="alert"`, through the screen's existing code-to-message mapping.
- No colour, size or spacing that is not a `--wt-*` token.

- [ ] **Step 1: Write the failing tests** with 3a's stub `PrepStationsApi`: the switch reads the
  station's value; flipping it calls the station write with `{ showsRestOfOrder: true }`; while the
  call is pending the switch is disabled; a rejected call snaps it back — assert the inner native
  control's `checked` reads false, not only the host's property (CLAUDE.md §4: a host can report the
  right value while its inner control is wrong) — and shows the message at the card's bottom; a
  `management.request_invalid { field: "showsRestOfOrder" }` shows under the switch instead. Then
  remove `live()` and confirm the snap-back case fails; restore it. In the a11y test, add the card with the switch on and off, in both themes.
- [ ] **Step 2: Run** — check memory first (Global Constraints) —
  `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/prep-stations-screen.test.ts src/dashboard/prep-stations-screen.a11y.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command and `pnpm --filter @waitron/venue-service exec vitest run --project node src/dashboard/routing-client.test.ts`.
  Expected: PASS. Then open Prep Stations with the dev stack (`wa-wt demo <worktree-name>`), at
  desktop and phone width, in both themes, flip the switch, reload, and see it stay.
- [ ] **Step 5: Commit** — "Prep stations: each station has a Show the rest of the order switch".

---

### Task 4: The printed block — "Also on this order (not for this station)"

Pure formatting. No database.

**Files:**
- Modify: `apps/server/src/kitchen-ticket.ts`, `apps/server/src/kitchen-ticket.test.ts`

**Interfaces:**

```ts
/** One item of the order at another station, as a station's own ticket lists it. */
export interface OtherStationItem {
  qty: number | string;
  unit?: string;
  name: string; // the kitchen name
  stationName: string;
  held: boolean;
}

// KitchenTicket's `station` variant (`:40-47`) GAINS:
//   alsoOnOrder?: { locale: string; items: OtherStationItem[] };
// The `order` variant does not (T5).
```

**Behaviour:**
- In `formatKitchenTicket`'s station branch, after `emitList(ticket.items)` (`:190-191`): when
  `alsoOnOrder` is present and has items, print the heading line `-- <heading> --` (ASCII markers
  stand in for emphasis, `:7`), then one line per item:
  `${qty}${unit ? ` ${unit}` : ""} x ${name} — ${stationName}` followed by ` ${held}` for a held item.
  Wrap each line to the paper as `emitItem` does (`:132-150`), continuing under the text after
  `"{qty}[ unit] x "`. An empty list prints nothing, not even the heading. Items are printed in the
  order given and never merged (T4: one line per item).
- The words, chosen as `extraCancelledWords` chooses (`:232-236`); factor the language pick into one
  helper both use:

```ts
const ALSO_ON_ORDER_WORDS = {
  en: { heading: "Also on this order (not for this station)", held: "(on hold)" },
  es: { heading: "También en este pedido (no para esta estación)", held: "(en espera)" },
} as const;
```

  (The glyph table draws "—", "é" and "ó": `packages/printing/src/glyphs.ts` has `0x2014`, `0x00e9`
  and `0x00f3`; read, not printed on paper.)
- Update the file header (`:1-8`) to say a station ticket may end with the rest of the order.

- [ ] **Step 1: Write the failing tests** (`kitchen-ticket.test.ts`, a new `describe("the rest of the
  order on a station's ticket")`, with `decodeTicket`/`printedLines` from
  `apps/server/src/testing/decode-ticket.ts`):
  - an English till: the station's own items, then `-- Also on this order (not for this station) --`,
    `2 x Burger — Grill`, `1 x Chips — Fryer (on hold)`, in that order, after the last own item;
  - `locale: "es-ES"` prints `-- También en este pedido (no para esta estación) --` and
    `(en espera)`; `locale: "fr-FR"` prints the English words;
  - a unit prints between quantity and name (`0.350 kg x Steak — Grill`);
  - `items: []` prints no heading;
  - on `KITCHEN_58` a long name wraps and its continuation line starts with spaces;
  - an order-scope ticket is unchanged (the existing order-scope cases keep passing).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/kitchen-ticket.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** — "Kitchen tickets: a station's ticket can end with the rest of the order, in the till's language".

---

### Task 5: Paper — a station that shows the rest gets it on its own tickets

**Files:**
- Create: `apps/server/src/rest-of-order.ts`, `apps/server/src/rest-of-order.test.ts`
- Modify: `apps/server/src/kitchen-print.ts` — `readStationNames` (`:223-232`) also reads
  `showsRestOfOrder` (rename it `readStations`, returning `{ name, showsRestOfOrder }`, and keep
  `printCorrectionSlips`, `:701-755`, reading only the name); `planKitchenTickets` (`:354-456`)
  builds `alsoOnOrder`
- Test: `apps/server/src/kitchen-print.test.ts`

**Interfaces** (`rest-of-order.ts`):

```ts
export interface RestOfOrderItem {
  ticketItemId: string;
  orderId: string;
  workingOrderLineId: string;
  stationId: string;
  stationName: string;
  /** The kitchen name, through `kitchenPresentationName`. */
  name: string;
  /** The quantity the kitchen was asked for (`firedQuantity`), as a decimal string. */
  quantity: string;
  unitName: Record<string, string> | null;
  unitPrecision: number | null;
  state: TicketState;
  /** `fired_at` is null: held, or recalled. */
  held: boolean;
}

/** Every kitchen record of these orders that is not made here, not sent away from the pass, and
 *  whose line is not served, by order, each ordered by station name, then line number, then record id. A caller leaves out its
 *  own station. Lines with no kitchen record (no preparation, not yet sent) are never here. */
export async function readRestOfOrder(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Map<string, RestOfOrderItem[]>>;
```

The query: `ticket_items` (the `.from()` base) inner-joined to `working_order_lines` on the line and
to `kitchen_stations` on the station, where `inArray(ticketItems.workingOrderId, orderIds)`,
`eq(ticketItems.madeHere, false)`, `isNull(ticketItems.awayAt)` (D6) and
`isNull(workingOrderLines.servedAt)`; select the four name
columns `kitchenPresentationName` reads (as `listStationQueue` selects them,
`apps/server/src/working-order.ts:5045-5048`), `firedQuantity` (`apps/server/src/kitchen-print.ts:519`)
and the rest. An empty `orderIds` answers an empty map without a query.

**`planKitchenTickets`:** after `stations` is built, when any `route.station` of a station-scope
route names a station whose `showsRestOfOrder` is set: read `readRestOfOrder(tx, [orderId])` once,
then `VENUE_SERVICE.readLinesSoldInEach(tx, <their line ids>)` once (awaited in turn), and give that
route's `formatKitchenTicket` call
`alsoOnOrder: { locale: cfg.locale, items: rest.filter((i) => i.stationId !== route.station).map(…) }`,
where each item is `{ qty: quantity, unit, name, stationName, held }` and `unit` follows
`buildTicketItems`' rule (`:200-203`): none when `unitName` is null or the line is sold in Each, else
`ticketName(unitName, cfg.locale)`. An order-scope route gets no `alsoOnOrder` (T5). A station
without the setting gets none. `planKitchenTickets` gains an option
`restOfOrderExcept?: ReadonlySet<string>` (station ids whose station-scope ticket gets no block);
`reprintOrderTickets` (`:1074-1102`) passes, for the held part, the stations its fired part already
covers, so a reprint that joins a station's fired and HOLD tickets into one job (`:1089-1100`) prints
the block once, on the fired ticket (T5). Nothing else in the plan's flow changes: a fire reads after its own
insert, a release after its own update, and a reprint at the reprint, so each ticket lists the order
as it stands when it prints (T4, T5). The extra read happens only when a ticket goes to a station
that shows the rest.

- [ ] **Step 1: Write the failing tests.**
  `rest-of-order.test.ts` (real database through `useVenueDb`, core migrations, an order with items at
  two stations; build the rows directly, as `apps/server/src/working-order-reads.sqlite.test.ts`
  does, or through 3a's `routeProductTo` and `fireLines`):
  - lists every record of the order with its station name and state, ordered by station name then
    line number; a held one has `held: true`; the kitchen name shows, not the staff or customer one
    (give all three different text);
  - leaves out a record marked `made_here`, a record with `away_at` set, a record whose line has
    `served_at` set, and another order's records;
  - **the query plan (T6, Review Focus 8)**, as `packages/reporting/src/counts.test.ts:105-122` reads
    one: build the read's query, run `tx.execute(sql\`explain query plan ${query.getSQL()}\`)`, and
    assert some `detail` contains `ticket_items_order_idx` and none starts with `SCAN ticket_items`.
    (Export the query builder from `rest-of-order.ts` for this, or build the statement in a function
    both the reader and the test call.)

  `kitchen-print.test.ts`, a new `describe("show the rest of the order")` (read the file's own
  helpers first; it builds venues, stations, printers and fires through them). Grill (with the
  setting) and Fryer (without) each have a station-scope printer, and a PASE printer
  (`ticket_scope = 'order'`) is attached to Grill:
  - first send of a burger to Grill and chips to Fryer: Grill's job decodes with the heading and
    `` `${thousandthsToDecimal(1000)} x Chips — Fryer` `` — a fired quantity prints through
    `thousandthsToDecimal`, so write every expected line as the siblings do
    (`kitchen-print.test.ts:936-941`); Fryer's job and the PASE job have no heading (Review Focus 5);
  - a later send of a salad to Cold: no new job at Grill's printer;
  - `reprintOrderTickets` for the order: Grill's REPRINT lists chips and salad;
  - on a party with the venue printing held work in advance, Grill holding one fired dish and one
    held in a group whose HOLD ticket was queued, and chips fired at Fryer (so Grill's rest of the
    order is not empty — an empty list prints no heading, Task 4): `reprintOrderTickets` makes one
    job for Grill's printer whose decoded lines hold the heading exactly once, and `Chips — Fryer`
    once;
  - a dessert held at Pastry (`hold: true`) shows `(on hold)` on Grill's next ticket;
  - chips marked served: gone from the next reprint; chips bumped to ready and then sent away from
    the pass (`markCourseAway` or `markGroupAway`, which stamp `away_at` on `ready` items only,
    `working-order.ts:1782-1790`, `order-groups.ts:305-313`): gone from the next reprint; a
    no-preparation line never listed;
  - a till whose `cfg.locale` is `es-ES` prints the Spanish heading.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/rest-of-order.test.ts src/kitchen-print.test.ts -t "rest of the order"`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS. Then the control for the plan test: in
  `rest-of-order.test.ts`, temporarily run `drop index ticket_items_order_idx` before the
  `explain`, confirm the test FAILS on a `SCAN ticket_items` detail, and remove the drop. Then
  `pnpm --filter @waitron/server exec vitest run src/kitchen-print.test.ts src/kitchen-ticket.test.ts src/order-groups.test.ts src/till-api.reprint.test.ts`
  (the existing print suites stay green).
- [ ] **Step 5: Commit** — "Kitchen tickets: a station that shows the rest of the order lists the order's dishes at other stations on its own tickets, as they stand when it prints".

---

### Task 6: Screen data — each order card carries the rest of the order

**Files:**
- Modify: `apps/server/src/working-order.ts` — `StationQueueGroup` (`:4902-4916`) gains
  `elsewhere?: ElsewhereItem[]`; `listStationQueue` (`:5034-5160`) reads the station's
  `showsRestOfOrder` and fills it; its doc comment (`:5030-5033`) says what the card now carries
- Modify: `apps/till/src/api/client.ts` — `StationQueueGroup` (`:1187-1205`) gains the same field,
  and the `ElsewhereItem` type beside it
- Test: `apps/server/src/working-order-reads.sqlite.test.ts` (or a new
  `apps/server/src/station-queue-rest.test.ts` beside it), `apps/server/src/device-api.test.ts`

**Interfaces:**

```ts
/** One item of the order at another station, shown in this station's card. */
export interface ElsewhereItem {
  id: string; // the kitchen record's id
  name: string; // the kitchen name
  quantity: string;
  unitName: Record<string, string> | null;
  unitPrecision: number | null;
  soldInEach: boolean;
  stationName: string;
  state: TicketState;
  held: boolean;
}
// StationQueueGroup GAINS:
//   /** Present only when this station shows the rest of the order: the order's items at other
//    *  stations, possibly none. */
//   elsewhere?: ElsewhereItem[];
```

**Behaviour:** `listStationQueue` already joins this station's row for its thresholds (`:5072`); add
`showsRestOfOrder: kitchenStations.showsRestOfOrder` to that select. When it is set and there are
groups: one `readRestOfOrder(tx, <the groups' order ids>)`, then one
`VENUE_SERVICE.readLinesSoldInEach` over those items' lines, and every group gets
`elsewhere: <its order's items whose stationId is not this station>` (an empty array when none).
When it is not set, no group carries the key (use the file's `optional` helper, `:5026-5028`). Both
station routes return `listStationQueue` unchanged (`apps/server/src/device-api.ts:198-212`,
`apps/server/src/till-api.ts:1309-1320`), so both screens get it. **Cost on the poll:** each kitchen
screen re-reads every 15 seconds inside its route's transaction; the two extra reads run only for a
station with the setting, and the first is indexed by order (Task 5's plan test).

- [ ] **Step 1: Write the failing tests:** with the setting off, no group has `elsewhere`; with it on,
  a card lists the order's records at other stations with `stationName`, `state` and `held`, ordered
  by station name, by kitchen name (three different names in the fixture), and leaves out a served
  line, a record sent away from the pass and a `made_here` record; an order with nothing elsewhere has `elsewhere: []`. In
  `device-api.test.ts`, `GET /api/device/station` for a kitchen screen whose station shows the rest
  carries `elsewhere` in its queue.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/working-order-reads.sqlite.test.ts src/device-api.test.ts -t "rest of the order"`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, then `pnpm --filter @waitron/server typecheck` and
  `pnpm --filter @waitron/till typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — "Kitchen screens: an order's card carries its dishes at other stations when the station shows the rest of the order".

---

### Task 7: The kitchen screen shows it in the order's card

**Files:**
- Modify: `apps/till/src/widgets/station-queue.ts`, `apps/till/src/widgets/station-queue.test.ts`,
  `apps/till/src/widgets/station-queue.a11y.test.ts`, `apps/till/src/i18n/strings.ts`

**Behaviour:**
- In `#rail()` (`:783-812`), between the sections and `${this.#collectAction(group)}
  ${this.#reprintAction(group)}` (`:808`), render `#elsewhere(group)` when `group.elsewhere` has at
  least one item:

```html
<section class="elsewhere" data-elsewhere=${group.orderId}>
  <h3 class="elsewhere-head">${t("station.elsewhere")}</h3>
  <ul class="elsewhere-lines">
    <li data-elsewhere-item=${item.id}>
      <span class="elsewhere-name">${dishLine(item, item.name)}</span>
      <span class="elsewhere-station">${item.stationName}</span>
      <span class="elsewhere-state">${item.held ? t("station.elsewhere_held") : t(`station.state.${item.state}`)}</span>
    </li>
  </ul>
</section>
```

  It is information, not a control: no button, nothing to bump. `dishLine`
  (`apps/till/src/widgets/dish-format.ts:16-29`) formats the quantity and unit as the card's own
  lines do.
- The column view (`#kanban`, `:917`) shows nothing of it (T3's gap).
- Strings, both languages: `"station.elsewhere": "Also on this order (not for this station)"` /
  `"También en este pedido (no para esta estación)"`; `"station.elsewhere_held": "On hold"` /
  `"En espera"`. The states reuse `station.state.queued|preparing|ready` (New / Preparing / Ready).
- Styles read `--wt-*` tokens only: the heading and lines in the muted text colour and the small
  font size, a top border in the border colour, spacing from the space scale.

- [ ] **Step 1: Write the failing tests:** a rail card whose group has two `elsewhere` items renders
  the heading, `2× Burger`, `Grill` and `Preparing`, and `On hold` for a held one; a group with
  `elsewhere: []` or none renders no `.elsewhere`; the kanban view renders none; Spanish strings
  under the Spanish locale. In the a11y test, the card with the section, in both themes.
- [ ] **Step 2: Run** — check memory first —
  `pnpm --filter @waitron/till exec vitest run src/widgets/station-queue.test.ts src/widgets/station-queue.a11y.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command and
  `pnpm --filter @waitron/till exec vitest run src/screens/till-station-screen.test.ts src/screens/till-station-screen.a11y.test.ts`.
  Expected: PASS. Then look at it in the dev stack (`wa-wt demo <worktree-name>`): switch the
  setting on for one station on Prep Stations, send an order with dishes at two stations, open the
  till's station view at `localhost:5190` (enrol the browser with the code `DEMO` first), choose the
  card view, and look in both themes and at phone width.
- [ ] **Step 5: Commit** — "Kitchen screen: an order's card lists its dishes at other stations, with each one's progress".

---

### Task 8: A device's made-here stations are stored and set on the Devices screen

**Files:**
- Create: `apps/server/src/made-here.ts`, `apps/server/src/made-here.test.ts`
- Modify: `apps/server/src/device-api.ts` — `GET /management-api/devices` (`:265-289`) returns
  `madeHereStationIds` per device; a new `PUT /management-api/devices/:id/made-here` beside the
  hardware route (`:337-379`)
- Modify: `apps/dashboard/src/api/client.ts` — `DeviceRow` (`:436-445`) gains
  `madeHereStationIds: string[]`; a new `setDeviceMadeHere(id, stationIds)` beside
  `patchDeviceHardware` (`:2263-2273`)
- Modify: `apps/dashboard/src/api/live-queries.ts` — `listDevices` (`:157`) gains
  `"device_made_here_stations"`
- Modify: `apps/dashboard/src/screens/devices-screen.ts`, `.test.ts`, `.a11y.test.ts`,
  `apps/dashboard/src/i18n/strings.ts` (both languages)

**Interfaces** (`made-here.ts`; the writer takes a `tx` and opens none):

```ts
/** The stations whose items `deviceId` makes on the spot; empty when `deviceId` is undefined (no query). */
export async function readMadeHereStations(
  tx: Transaction,
  deviceId: string | undefined,
): Promise<ReadonlySet<string>>;

/** Every device's made-here stations, keyed by device id, each list ordered by station id. */
export async function listMadeHereStations(tx: Transaction): Promise<Map<string, string[]>>;

/** Replace `deviceId`'s list. Each station must be a switched-on station of `cfg.locationId`
 *  (`requireLiveStation`, else `station.not_found { stationId }`); duplicates are dropped. Deletes the
 *  device's rows, then inserts the new set (CLAUDE.md §3: rewriting rows one at a time can break a
 *  unique index). */
export async function setMadeHereStations(
  tx: Transaction,
  cfg: TillConfig,
  deviceId: string,
  stationIds: readonly string[],
): Promise<void>;
```

**Route:** `PUT /management-api/devices/:id/made-here`, body `{ stationIds: string[] }` → 204,
behind `device.manage` through the file's `gated` helper (`:104-111`). A malformed id →
`device.not_found` (as the hardware route, `:341`); `stationIds` missing, not an array, or holding a
value that is not a UUID → `management.request_invalid { field: "stationIds" }`; an unknown device →
`device.not_found` (read the device first, inside the transaction); a station that is not a
switched-on station of this venue → `station.not_found` (already 404 in the file's `STATUS`, `:82`).

**Screen** (`devices-screen.ts`): in `#renderDevice` (`:531`), for an active device whose `kind` is not
`kds_station`, a group under the hardware row:

```html
<fieldset class="made-here" data-test="made-here-${device.id}">
  <legend>${t("devices.made_here")}</legend>
  <p class="hint">${t("devices.made_here_hint")}</p>
  ${this.stations.map((station) => html`<label class="check">
      <input type="checkbox" name="stationIds" value=${station.id}
        .checked=${live(device.madeHereStationIds.includes(station.id))}
        @change=${() => void this.#onMadeHereChange(device, station.id)} />
      ${station.name}</label>`)}
  ${refusal === undefined ? nothing : html`<p class="error" role="alert">${codeMessage(refusal)}</p>`}
</fieldset>
```

A change saves the whole new list at once (`setDeviceMadeHere`), built from the boxes the group
SHOWS — the ticked switched-on stations after this change — never by toggling
`device.madeHereStationIds`, which may still hold a station switched off since (D4). It saves at once,
as the reader choice saves at once
(`#onReaderChange`, `:462-471`). A refusal shows on its own line at the bottom of that device's group
(not the screen's shared error line) and the boxes return to the stored list. The box is bound
through `live()` (`import { live } from "lit/directives/live.js"`), as the printing rules screen's
station boxes are (`apps/dashboard/src/screens/printing-rules-screen.ts:206`): a plain `.checked=`
is compared with Lit's last rendered value, not the DOM, so after a refusal it would write nothing
and the ticked box would stay ticked. The checkboxes are named after the API field, `stationIds`, as
the sibling switch is (`editSentLines`). `this.stations` is the
switched-on station list the screen already watches (`:238-240`).

Strings, both languages: `"devices.made_here": "Made here, no ticket"` / `"Se prepara aquí, sin
comanda"`; `"devices.made_here_hint": "When this device sends an item for a ticked station, the item
gets no ticket and does not appear on kitchen screens. That station is still where it is made."` /
`"Cuando este dispositivo envía un artículo de una estación marcada, el artículo no lleva comanda ni
aparece en las pantallas de cocina. Esa estación sigue constando como donde se prepara."`.

- [ ] **Step 1: Write the failing tests.**
  `made-here.test.ts` (real database): `setMadeHereStations` replaces the list and drops duplicates;
  it refuses a switched-off station and another venue's station `station.not_found` (assert the
  code); `readMadeHereStations(tx, undefined)` is empty; **two tills sharing one device profile**:
  setting Bar on one leaves the other's list empty (Review Focus 3).
  `device-api.test.ts`: the PUT answers 204 and the GET list then carries `madeHereStationIds`; the
  three refusals with their codes and statuses; 401 without a management session; 403 without
  `device.manage`.
  `devices-screen.test.ts`: a till shows the group with its stored boxes ticked; a kitchen screen
  shows none; ticking a box calls `setDeviceMadeHere(id, [bar])`; a rejected call shows the message
  at the bottom of that device's group and unticks the box (assert the native input's `checked`);
  a device whose stored list holds Bar and a station since switched off (absent from `stations`)
  ticking Grill sends `[bar, grill]`, not the switched-off id.
  Then remove `live()` and confirm that case fails; restore it. The a11y test covers the group in both
  themes.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/made-here.test.ts src/device-api.test.ts`
  and — check memory first —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/devices-screen.test.ts src/screens/devices-screen.a11y.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same commands and `pnpm exec vitest run scripts/live-subscriptions.test.ts`.
  Expected: PASS. Then open the Devices screen in the dev stack at desktop and phone width, both
  themes, tick a station for the demo till, reload, and see it stay.
- [ ] **Step 5: Commit** — "Devices: a till or handheld can be told which stations' items it makes on the spot".

---

### Task 9: Sending from a device writes made-here records, which print nothing

**Files:**
- Modify: `apps/server/src/till-config.ts` — `TillConfig` (`:18-44`) gains, beside `allowCashDrawer`:

```ts
/** The device this request came from, set by the till routes that can send work to the kitchen;
 *  absent on every path with no device. `fireLines` makes its made-here stations' items there. */
sendingDeviceId?: string;
```

- Modify: `apps/server/src/working-order.ts` — `fireLines` (`:1142-1343`, after 3a and 3b):
  - its options GAIN
    `keepMadeHere?: ReadonlyMap<string, { madeHere: boolean; stationId: string }>` — a
    `working_order_lines` id to the made-here decision and station a line follows: for a changed
    line an edit sends again, those of the record the edit deleted (coordinator ruling 1); for a new
    line carrying units added to a dish the kitchen has, those of that dish's record (coordinator
    ruling 2: the added units follow the dish they join, as 3b's `keepStations` makes their station
    do). It sits beside 3b's `keepStations`, with the same keys; neither replaces the other ("What
    3b changes that this plan touches");
  - read `const madeHere = await readMadeHereStations(tx, cfg.sendingDeviceId);` once per call,
    AFTER 3b's first-statement clock reading;
  - in the value builder, once the line's `stationId` is final (after 3a's route, and 3b's make-at,
    `keepStations` and fallback outcome — T9), compute
    `const kept = options.keepMadeHere?.get(line.id);`
    `const made = kept === undefined ? madeHere.has(stationId) : kept.madeHere && kept.stationId === stationId;`
    A kept decision whose station has changed is not applied: the item gets a ticket at its new
    station, whatever the sending device lists (T9). **A made-here line is never held (T12):** its
    fire decision becomes `const fired = made || <today's rule>` (`working-order.ts:1295-1300`), so the
    builder must decide the station and `made` BEFORE it decides `fired` and pushes the line to
    `sentLineIds` (`:1302`) — today the station is decided after (`:1304-1307`); a no-preparation line
    still returns before any station. Write `madeHere: made`, `firedAt: fired ? firedAt : null`,
    `state: made ? "ready" : "queued"`, `readyAt: made ? firedAt : null`;
  - the course test (`courseRows`, `:1250-1264`): `anyFired` leaves made-here records out —
    `max(${ticketItems.firedAt} is not null and not ${ticketItems.madeHere})` — while `itemCount`
    keeps counting them, and the round's earliest course (`orderCourseIds`, `:1268-1279`) keeps this
    round's made-here lines, so a made-here item still makes its course the first one (D10, owner);
    a made-here line's own `fired` is `true` whatever that test says (T12);
  - each made-here record's line id is added to `cfg.madeHereSink` when present (Task 9b);
  - the insert's `.returning(...)` (`:1323-1327`) gains `madeHere: ticketItems.madeHere`, and the
    items handed to `enqueueKitchenTickets` (`:1338-1341`) leave out `row.madeHere`. The line is still
    stamped sent (`stampSent`, unchanged);
  - rewrite `fireLines`' doc comment's sentence about printing to say a made-here item is recorded
    and never printed, and the two comments T12 makes false: "`hold: true` inserts the line unfired
    whatever its course" (`working-order.ts:1155`) and "A line not fired now is HELD" (`:1294`) — each
    gains "unless it is made here" (keep it to that).
- Modify: `apps/server/src/working-order.ts` — `readEditableOrder` (`:3658-3751`) selects
  `madeHere: ticketItems.madeHere` beside `ticketCourseId` (`:3685`) and puts it on
  `EditableLine.ticket`; `applyLineEdits` (`:3802`) fills `keepMadeHere`:
  - for every change whose `action === "change"`: `parent.id → { madeHere: parent.ticket!.madeHere,
    stationId: parent.ticket!.stationId }`, the record deleted at `:4169`;
  - for every new line carrying units added to a dish that has a record — a raise, or a change with
    a raise, of a fired dish (both push the `pricedAs` entry `{ kind: "line", kitchen: "fire" }`,
    `:3970-3978`, the second when `action === "change" && rise > 0`) and `addedApart`
    (`{ kind: "line", kitchen: kitchenStateOf(parent), joins: parent }`, `:3977`): the new line's id
    → the same pair from its dish's record. The `{ kind: "line", kitchen: "fire" }` entry carries no
    dish today, and 3b must reach the dish from it too (3b plan `:1005-1011` says only "put the new
    line in `keepStations` with the sent dish's ticket station"): if 3b's code already carries the
    dish on that entry, use its field; otherwise add one (`follows: parent`), and on a rebase keep ONE
    such field, not two. A dish with no record adds no entry, so the sending device decides the new
    line (T8): a no-preparation dish, or a discounted dish held in a group with no record of its own
    — the zone-less setup below, where `addedApart` writes the added units a first, held record
    (review 3 measured it on `main`, probe F);
  and passes `{ keepMadeHere }` to its `fireLines` call (`:4227`), beside 3b's `keepStations` when 3b
  is in. Under D1's default a made-here record never reaches either case (`kitchenHas` refuses a
  `ready` one, `:3823-3825`, and no made-here record is held, T12), so every entry today carries
  `madeHere: false` and the re-sent or added units get a ticket. Under D1's alternative a changed or
  raised made-here dish would keep its mark.
- Modify: `apps/server/src/till-api.ts` — every route the call-graph walk (Step 3) finds passes a cfg
  carrying its device. Add one helper beside the routes:

```ts
/** `deps.cfg` with the request's device, for a write that can send work to the kitchen (made here, T8).
 *  Call it BEFORE opening the route's transaction (D9). */
async function sendingCfg(deps: TillApiDeps, c: Context, device?: DeviceBinding | null): Promise<TillConfig> {
  const resolved = device === undefined ? await tryReadDevice(deps, c) : device;
  return resolved === null ? deps.cfg : { ...deps.cfg, sendingDeviceId: resolved.deviceId };
}
```

  and use it (the walk's expected answer, checked on `main` at `f8850049f` by reading each caller):
  - `POST /api/sales` (`:1091-1120`) and `POST /api/pay` (`:1124-1172`): add
    `sendingDeviceId: device?.deviceId` to the `saleCfg` they already build (`:1107`, `:1150`);
  - `PUT /api/working-orders/:id` (`:1226-1256`): pass `await sendingCfg(deps, c)` as
    `updateHeldOrder`'s cfg in place of `deps.cfg`;
  - `POST /api/working-orders/:id/place` (`:1267-1287`): pass `await sendingCfg(deps, c, device)`
    (the device is already read at `:1272`) in place of `deps.cfg`;
  - `POST /api/parties/:id/move` and `/join` (one registration, `:1697-1714`, which calls
    `act(tx, deps.cfg, …)` at `:1709`) and `POST /api/parties/:id/split-table` (`:1716-1741`, which
    calls `splitTable(tx, deps.cfg, …)` at `:1734`): these reach `fireLines` through
    `moveGuests` → `retargetOpenBills` (called at `apps/server/src/table-actions.ts:93`, which calls
    `takeIntoParty` at `:344`) or → `combineAt` → `combineParties` (which calls `takeIntoParty` at
    `:192`), `joinTables` → `combineAt` → `combineParties`, and `splitTable` (which calls
    `takeIntoParty` at `:277`); `takeIntoParty` (`apps/server/src/move-bill.ts:334`) → `adoptZone`
    (`:346`) → `fireLines` (`:413`), when a bill of unsent dishes enters table service. Pass
    `await sendingCfg(deps, c)`;
  - `POST /api/parties/:id/groups` (`:1781-1797`), `POST /api/parties/:id/drafts/:did/submit`
    (`:1966-1984`) and `POST /api/bills/:id/move` (`:2181-2193`): pass `await sendingCfg(deps, c)`
    in place of `deps.cfg`.
  - `PUT /api/working-orders/:id/lines/:lineNo` (`:2002-2018`): pass `await sendingCfg(deps, c)`
    as `updateOrderLine`'s cfg in place of `deps.cfg`. It edits one stored dish (`updateOrderLine`,
    `apps/server/src/working-order.ts:4433-4475`, passes `fresh: []`), but that does not rule out a
    first record: units added to a discounted dish that has no record of its own, held in a group,
    become `addedApart` (`:3949`) with `kitchenStateOf(parent)` answering `"hold"` (`:3514-3518`), and
    `fireLines` writes them a new held record (review 3, probe F, on `main`). Without the device this
    route and `PUT /api/working-orders/:id` would decide the same edit differently.
  - `POST /api/working-orders/:id/prep` (`:1289-1296`) stays on `deps.cfg` (D8).
- Modify: `apps/server/src/bill-payments-api.ts` — `deviceSaleCfgOf` (`:198-208`) adds
  `sendingDeviceId: device?.deviceId`. Every till path that issues a bill through a device's sale cfg
  gets it from there: `POST /api/working-orders/:id/payments` (cash and manual card, `:266-268`, and
  the reader, `:278`), and the invoice step of `PUT /api/working-orders/:id`, `PUT …/lines/:lineNo`,
  `POST /api/bills/:id/split` and `POST /api/working-orders/:id/adjustments`
  (`withSaleTillWhenIssuing`, `:217-228`).
- Test: `apps/server/src/made-here.test.ts` (the send path), and the route suites named below.

- [ ] **Step 1: Write the failing tests.** In `made-here.test.ts` (real database, 3a's
  `routeProductTo`/`claimFolderFor` from `apps/server/src/testing/zone-offers.ts` to route, a Bar
  printer and a Grill printer attached through `station_printers`, a till device whose list is
  `[Bar]`), calling `fireLines` with `{ ...cfg, sendingDeviceId: barTill }`:
  - a lager routed to Bar: its record has `madeHere: true`, `state: "ready"`, `readyAt` equal to its
    `firedAt`, the line has `sent_at` set, and NO print job exists for Bar's printer (count
    `print_jobs` by printer before and after);
  - a burger in the same send, routed to Grill: an ordinary record and a Grill print job;
  - the lager with `hold: true`, and the lager in a course not yet started (course 2, with a course-1
    burger in the round): `madeHere: true`, `state: "ready"`, `firedAt` the send's time, the line
    stamped sent, no print job (T12); the course-1 burger fires;
  - **D10 (owner):** a round of a made-here aperitif in course 1 and a burger in course 2 → the
    aperitif made now, the burger HELD (course 1 is the first course); `fireCourse` for course 2 then
    fires the burger. Control: drop the made-here lines from `orderCourseIds` and see the burger fire
    at once. And: a first round of a burger in course 1 and a made-here drink in course 2, then a
    later round with a course-2 steak → the steak is held, because the drink did not mark course 2
    started (`anyFired`); control: count the drink in `anyFired` and see the steak fire at once;
  - **T9 (Review Focus 2):** with an exception or claim sending the lager to Downstairs bar instead,
    the record is at Downstairs bar, `madeHere: false`, with a ticket;
  - **Review Focus 3:** the same lager with `cfg` carrying another device's id (empty list), and
    with no `sendingDeviceId` at all: an ordinary record and a Bar print job;
  - `keepMadeHere`: a line kept `{ madeHere: false, stationId: bar }` sent with the bar till's cfg →
    an ordinary record and a Bar ticket; kept `{ madeHere: true, stationId: downstairs }` while the
    rules now send it to Bar → an ordinary record and a Bar ticket (the station changed); and kept
    `{ madeHere: true, stationId: bar }`, routed to Bar, sent with a cfg whose device lists nothing
    → `madeHere: true`, no Bar job (review 2, M1: the kept decision applies, not the device's list).
    Replacing the kept branch of the formula with `false` must fail this last case.

  **One case per wired place (coordinator ruling 3).** Each sends with a device cookie from
  `enrolDeviceForTest` (`apps/server/src/testing/enrol.ts:9-27`) whose list is `[Bar]` and asserts
  the named result; each must fail when ITS wiring alone is removed. Put them in one parametrised
  suite, `apps/server/src/made-here.routes.test.ts`, or each beside its route's existing suite (find
  them with `grep -rln '"/api/sales"\|/api/pay"\|/place"\|/groups"\|/drafts/\|/lines/\|/bills/\|/split-table\|/payments"' apps/server/src/*.test.ts`):

  | Wired place | Request | Asserted |
  | --- | --- | --- |
  | `/api/sales`' `saleCfg` | a pay-first counter sale with a lager | lager record `madeHere: true`, no Bar job |
  | `/api/pay`'s `saleCfg` | the same sale paid by the simulator reader (`simulationOutcome: "captured"`) | the same |
  | `PUT /api/working-orders/:id` | an open bill the kitchen has work on (`newWork` "fire"), a NEW lager line added | the new lager line's record `madeHere: true`, no Bar job |
  | `/place` | a placed counter order with a lager | `madeHere: true`, no Bar job |
  | `/api/parties/:id/groups` | a group submitted with a lager, fired | `madeHere: true`, no Bar job |
  | `/drafts/:did/submit` | a draft with a lager submitted | the same |
  | `/api/bills/:id/move` | a pay-first counter bill with an unsent lager moved into a table-service party | the same |
  | `/api/parties/:id/move` (shared registration, `till-api.ts:1697-1714`) | the zone-less setup below; that party moves to a free table-service table (`moveGuests` → `retargetOpenBills` → `takeIntoParty` → `adoptZone`) | the same |
  | `/api/parties/:id/join` (the same registration) | the zone-less setup below; a table-service party, seated at a table-service table, asks to join the zone-less party's table — the request is made on the TABLE-SERVICE party's id, so the zone-less party's bills are taken into it with its zone (`joinTables` → `combineAt` → `combineParties` → `takeIntoParty`, `table-actions.ts:121`, `:189-192`). With the default `bills: "merge"` the lager's bill merges into the table-service party's main bill (`table-actions.ts:197-208`; review 3, probe E2), so find the record BY THE LAGER'S LINE ID, never by its first bill | the same |
  | `/api/parties/:id/split-table` (`:1716-1741`) | the split setup below; split onto the joined table-service table with the lager's bill (`splitTable` → `takeIntoParty`, `:277`) | the same |
  | `PUT /api/working-orders/:id/lines/:lineNo` | the zone-less setup (the lager, unsent, in a held group with no record), the lager given a discount through the adjustments route, then raised by 1 through this route with the bar till's cookie (`addedApart`) | the NEW line's record `madeHere: true`, `ready`, fired at the edit (it is not held, T12); the lager's own line still has no record. On `deps.cfg` it would be `madeHere: false`, held |
  | `deviceSaleCfgOf` | a pay-first bill holding a lager paid in full in cash through `POST /api/working-orders/:id/payments` (the busiest case: it runs `issueWhenFullyPaid` → `firePrepayOrder`, `apps/server/src/bill-payments.ts:717`) | the same |

  **The zone-less setup** (the only way a party holds a pay-first bill with unsent dishes; read, not
  run). No party can sit at a pay-first zone's table: seating, moving and joining onto a free table
  refuse any zone that is not table service (`refuseUnseatable`, `apps/server/src/move-bill.ts:236-250`,
  called at `table-actions.ts:80` and `:123`). So: a pay-first counter bill holding an unsent lager is
  moved, with no device cookie, to a table with NO zone (`POST /api/bills/:id/move`), as
  `apps/server/src/party-move-bill.test.ts:1023-1036` does; it keeps its pay-first context there and
  sends nothing (`takeIntoParty` skips `adoptZone` when the zone is null, `move-bill.ts:346`). A bill
  moved into a party puts its unsent dishes in a HELD group (`groupArrivingDishes`,
  `order-groups.ts:1400-1454`; an unsent dish with no record is not released, `isReleased`,
  `working-order.ts:2257-2265`) — review 3, probe A.

  **The split setup** (measured by review 3, probe C2, on `main` at `5471552a8`, with a
  throwaway test that was not committed; the steps below are that test's setup). Move a first counter bill to the
  zone-less table (it becomes the main bill). Move the lager's counter bill onto the same table with
  `bills: "separate"` — the default `merge` would merge it into the main bill (`requireBillChoice`,
  `till-api.ts:549-552`; probe B). Fire the lager's held group (`POST /api/parties/:id/groups/:gid/fire`
  → `fireGroup` → `releaseGroup` → `fireOrderLines`, which never calls `fireLines`): for a dish with
  no record it writes nothing and leaves `sent_at` null, but the group is now fired — without this,
  the split is refused `group.held_leaves_party` (`refuseHeldLeavingParty` via `leaveParty`; probe
  C). Then join a free table-service table — joining a free table adds it and re-targets no bill
  (`joinTables`, `table-actions.ts:123-129`), and `partyZone` keeps reading the earliest-joined,
  zone-less table (`apps/server/src/parties.ts:139-153`). The lager's bill is not the main bill, so
  `refuseUnsplittableBill` (`table-actions.ts:307`) lets it go. Probe C2 shows the split then sends
  the dish.

  In every one of these
  rows, assert BEFORE the request that the lager's line has no kitchen record, so a setup that
  already sent it cannot pass. `adoptZone` sends only when the bill leaves another mode for table
  service (`move-bill.ts:405-412`).

  **Edits keep the dish's decision (coordinator rulings 1 and 2).** Through `PUT /api/working-orders/:id`
  — the edit route that carries the bar till's device, so a missing `keepMadeHere` would show:

  | Case | Request | Asserted |
  | --- | --- | --- |
  | ruling 1 | a lager first sent from a handheld whose list is empty (a Bar ticket printed), its note changed from the bar till | a RECALLED slip at Bar, then a new Bar ticket; the new record `madeHere: false` |
  | ruling 2, a raise | the same first send, its quantity raised by 1 from the bar till | the added units' new line has a record at Bar with `madeHere: false` and a Bar ticket for them |

  For the two edit cases, remove each `keepMadeHere` entry kind from `applyLineEdits` in turn
  (the changed lines', then the new lines') and see its case fail: each would be made here with no
  new ticket. (The approved plan's third case, a held made-here dish raised from a handheld, is gone:
  no made-here dish is held, T12.) And one no-device path through its
  real route: a bill paid by the background loop (`bill-payments-loop.ts:129`) or resolved from the
  dashboard (`payments-api.ts:713-720`) — whichever existing suite already drives one
  (`grep -rln 'completeBillPayment\|payment.not_stuck' apps/server/src/*.test.ts`) — prints at Bar.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/made-here.test.ts` and the
  route suite(s). Expected: FAIL.
- [ ] **Step 3: Implement**, then **walk the call graph** to prove no route was missed (coordinator
  ruling 2). Start a worklist with `fireLines`. For each name, run
  `grep -rnw '<name>' apps/server/src | grep -v '\.test\.ts' | grep -v '/testing/'`, open every call
  site, and READ which function or route handler encloses it — a crude enclosing-function script
  tried for this plan produced false matches on short names (`lines`, `quantity`) and missed
  `joinTables`, so read each hit. Add each enclosing function to the worklist; stop at a route
  handler (`app.<verb>(…)`), a background loop or a boot step. A function passed by value (as
  `moveGuests` and `joinTables` are in the `[path, act, field]` loop at `till-api.ts:1697-1700`) is
  found by grepping its name without `(`. Write the resulting route list in the commit message, each
  marked "device" (its cfg now carries `sendingDeviceId`) or "no device" (with why). The walk on
  `main` at `f8850049f` gives the routes listed above under **Files** (the review's re-check walked
  it by hand and found the same list), plus these with no device:
  `POST /management-api/payments/stuck/:id/resolve` (`payments-api.ts:713-720`),
  `POST /management-api/payments/bill-payments/:id/attest` (`:890`),
  `POST /management-api/payments/bill-payments/:id/resolve` (`settleFromProviderRow`, `:805`),
  the background bill-payment loop (`settlePendingBillPayments`, `boot.ts:1980`), and
  `POST /api/working-orders/:id/prep` (D8). Releases (`fireCourse`, `fireGroup`, `sendLines`) never
  call `fireLines`: they stamp records already written. Any route your walk finds that is not in
  either list is a finding: wire it and give it a row in the table above.
- [ ] **Step 4: Prove each case.** For each row of the table, remove that wiring alone (copy the file
  to `/tmp` first and restore from the copy), run the suite, and confirm exactly its row or rows
  fail — `/move` and `/join` share one wiring site, so removing it fails both rows. Then
  run `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts src/till-sale.test.ts src/order-groups.test.ts src/kitchen-print.test.ts src/till-api.drafts.test.ts src/party-move-bill.test.ts src/party-table-actions.test.ts src/bill-payments-api.test.ts`
  and `pnpm --filter @waitron/server typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — "Sending: an item whose final station is one its sending device makes on the spot is recorded as made here and gets no ticket; a dish an edit sends again keeps its first decision" (with the route list from Step 3 in the body).
- [ ] **Step 6: The fallback case (Review Focus 2, T9 with 3b) — a REBASE-TIME step.** Whenever this
  branch is built on, or rebased onto, a `main` that holds 3b
  (`git log --oneline origin/main -- packages/venue-service/src/station-times.ts` prints a commit),
  add to `made-here.test.ts` BEFORE pushing: Bar closed by hand with Downstairs bar as its fallback,
  the bar till's list `[Bar]`, a lager claimed by Bar → its record is at Downstairs bar,
  `madeHere: false`, with a ticket; and check the made-here read and check sit where "What 3b changes
  that this plan touches" says. Run it, and commit with "Sending: a made-here station that is closed
  passes its work to its fallback, which gets a ticket". **If 3b lands while this pull request is
  open** (after Task 12 Step 5 wrote the pointer): drop that pointer commit from this branch while
  rebasing, so 3b's plan file is left as 3b landed it, and tell the supervising session to remove
  the copy from lane D's PF4 queue item. If this lands BEFORE 3b, Task 12 Step 5 puts
  the same instructions into 3b's plan file for 3b's builder.

---

### Task 9b: The till tells the waiter what to make (owner, 2026-10-01, after approval)

T13. Every till request whose work records a made-here item answers with those items, and the till
keeps them on screen as "Make now" until the waiter dismisses them.

**Files:**
- Modify: `apps/server/src/till-config.ts` — `TillConfig` gains, beside `sendingDeviceId`:

```ts
/** Where `fireLines` notes the line ids of the made-here records this request writes (T13);
 *  absent where nothing is to be told. */
madeHereSink?: Set<string>;
```

- Modify: `apps/server/src/working-order.ts` — `fireLines` adds each made-here record's
  `working_order_line_id` to `cfg.madeHereSink` (Task 9's builder knows `made` per line).
- Modify: `apps/server/src/made-here.ts`:

```ts
/** One made-here item as the till shows it (T13): the staff name, as the basket names it. */
export interface MadeHereItem {
  lineId: string;
  /** `staffPresentationName` of the line (`packages/catalogue/src/product-presentation.ts:16`). */
  name: string;
  /** The record's quantity (`firedQuantity`), as a decimal string. */
  quantity: string;
  unitName: Record<string, string> | null;
  soldInEach: boolean;
  optionSnapshots: OptionSnapshot[];
  /** Each extra's frozen staff name, ` x<n>` when the dish has more than one each (`extraLabel`). */
  extras: string[];
  note: string | null;
}

/** The made-here records of these lines that EXIST, in line order. A line id from an attempt that
 *  rolled back names nothing and is dropped. Read outside any transaction: committed rows only. */
export async function readMadeHereItems(db: Database, lineIds: ReadonlySet<string>): Promise<MadeHereItem[]>;

/** The sink for this request, made on first use and kept per request. */
export function madeHereSinkFor(c: Context): Set<string>;

/** Hono middleware: after the handler, when the request's sink holds line ids and the answer is a
 *  2xx JSON object, answer the same object with `madeHere: readMadeHereItems(…)` added, keeping the
 *  status and every header (the session cookie included). Any other answer is left as it is. */
export function madeHereAnswer(db: Database): MiddlewareHandler;
```

  `extraLabel` (`apps/server/src/kitchen-print.ts:80-83`) is private: export it, or move it beside
  `staffPresentationName`'s users, rather than copying it.
- Modify: `apps/server/src/till-api.ts` — `sendingCfg` (Task 9) also sets
  `madeHereSink: madeHereSinkFor(c)`; `/api/sales`' and `/api/pay`'s `saleCfg` do too; register
  `app.use("/api/*", madeHereAnswer(deps.db))` as the FIRST statement of `mountTillApi` (`:796`),
  before it mounts the bill-payment (`:801`) and adjustment (`:802`) routes and its own, because a
  Hono middleware wraps only routes registered after it.
- Modify: `apps/server/src/bill-payments-api.ts` — `deviceSaleCfgOf` (`:198-208`) also sets
  `madeHereSink: madeHereSinkFor(c)`, so a bill payment, a split, an adjustment or a line edit that
  completes a pay-first bill tells the waiter too.
- **A replay reports the original facts (coordinator ruling, 2026-10-01; CLAUDE.md §3).** A repeated
  request — the retry after a lost answer, exactly when the waiter never saw the list — runs no
  `fireLines`, so the sink would stay empty. So the made-here line ids are stored with each sending
  write's recorded result and put back into the sink on a repeat:
  - `runServiceCommand` (`apps/server/src/parties.ts:590-631`) gains an optional last parameter
    `sink?: Set<string>`. It notes the sink's contents before `run()`, and stores the ids `run()`
    added beside the result — `result: { value, madeHere: [...] }`, written ONLY when ids were added,
    so every other command's stored result stays `{ value }` exactly (`parties.test.ts:1261-1270`
    asserts it by equality; keep that assertion as it is); the column is JSON
    (`packages/db/src/schema/parties.ts:119`; widen its type), so no migration — and on a replay adds
    the stored ids to the sink before returning the recorded value. Every caller with a `cfg` in
    scope passes `cfg.madeHereSink` (`grep -n 'runServiceCommand(' apps/server/src` lists them; the
    sending ones are the group submit, `order-groups.ts:107`, and the draft submit,
    `order-drafts.ts:293`).
  - `firePrepayOrder` (`apps/server/src/till-sale.ts:1306` at `efb0ebf9d`), through which the cash
    sale, the integrated card's capture and recovery, and a bill payment that completes a pay-first
    bill (`apps/server/src/bill-payments.ts:717`) all send, takes the ids its `fireLines` added from
    the difference in `cfg.madeHereSink` before and after the call (the sink cannot already hold
    them: a rolled-back first attempt under `withSaleTillWhenIssuing` is refused at
    `bill-payments.ts:660`, before `firePrepayOrder` runs at `:717`), and, ONLY when there are some,
    stores them as a `service_commands` row on the bill — `scope_kind` `bill`, `scope_id` the order,
    `submission_id` `made-here:prepay`, `kind` `made_here`, `fingerprint` empty,
    `result: { value: <line ids> }`. No row is written when nothing was made here, so the existing
    counts of a bill's command rows (`adjustments-apply.test.ts:785`, `:3344`) are untouched. It
    merges only into an existing row whose `kind` is `made_here`; any other row under that id is
    refused (`submission.id_reused`). The till mints UUIDs for submission ids, which contain no `:`
    (`apps/till/src/till-app.ts:2421`, `:3748`, `:3867`, `:4203`), but the server does not check
    this — it accepts any string of 1 to 200 characters (`submissionIdOf`,
    `apps/server/src/bill-payments-api.ts:95-104`) — so the kind check is what keeps a client's
    command and this row apart. `readSettledTicket` (`till-sale.ts:534`), which every sale and pay
    replay answers through, and a bill payment's replay, through `resultOf` → `readSettledTicket`
    when the bill is settled (`bill-payments.ts:929-932`), add that row's ids to `cfg.madeHereSink`.
    A first answer adding them again changes nothing: the sink is a set. **A replayed partial
    payment** repeated after a later payment settled the bill answers through `readSettledTicket`
    too, so it carries the completing payment's `madeHere`, which its own first answer never had —
    as its `invoice` field already does. Accepted: it re-shows items still to make; it is not
    strictly the original facts.
  - **The adjustment route** (`POST /api/working-orders/:id/adjustments`,
    `apps/server/src/adjustments-api.ts:120-127`) runs `applyAdjustment` with `deps.cfg` and its
    `runServiceCommand`, then `issueIfFullyPaid` outside that command; on a repeat the command
    replays, and `issueWhenFullyPaid` returns early because the bill is no longer open
    (`bill-payments.ts:648`), so nothing reads the stored row. After `issueIfFullyPaid`, the route
    calls `replayPrepayMadeHere(tx, { madeHereSink: madeHereSinkFor(c) }, id)` — harmless on a first
    answer. `POST /api/bills/:id/split` and `PUT …/lines/:lineNo` have no replay (a repeat is refused,
    a stale revision), so they need nothing.
  - Write the helpers once in `made-here.ts`: `storePrepayMadeHere(tx, orderId, lineIds)` (no row
    for an empty list) and `replayPrepayMadeHere(tx, cfg, orderId)`.
  - Update the two descriptions the `made-here:prepay` row makes false: `service_commands`' schema
    comment, "One row per service command, keyed by the submission id its device made for it"
    (`packages/db/src/schema/parties.ts:102-108`), and its classification text, "the recorded result
    of each service command" (`packages/db/src/classification.ts:122-126`) — each gains that a bill
    may also hold one `made_here` row the server writes, recording a pay-first send's made-here
    items for a replay.
- Modify: `apps/till/src/api/client.ts` — export `MadeHereItem` (the server's shape); `TillApi`
  (`:1701`) gains `onMadeHere(listener: (items: MadeHereItem[]) => void): void`, and `#request`
  (`:2799-2831`), after a successful answer is parsed, calls the listener when the answer is an
  object whose `madeHere` is a non-empty array. One place covers every sending route, including any
  added later.
- Create: `apps/till/src/widgets/make-now.ts` (`till-make-now`, an app widget, not a shared `wt-*`
  primitive), `make-now.test.ts`, `make-now.a11y.test.ts`.
- Modify: `apps/till/src/till-app.ts` — subscribe to `api.onMadeHere` whenever `api` is set (in
  `willUpdate` on a change of `api`: the property's default, `:895`, is replaced by `main.ts:31` and
  by the tests), keep the items in a
  `@state()` list (appending; the same `lineId` once), and render `<till-make-now>` in `render()`
  (`:5700`) beside the other shell-level notices (the `wt-toast` at `:5793`), so it stays whatever
  screen is shown; its `dismiss` event empties the list. It keeps the list in `localStorage` under
  `waitron.makeNow.<deviceId>` (D11, owner): restored when the device's identity is known
  (`this.deviceId`, set at `apps/till/src/till-app.ts:1464`), written on every change, removed on
  Done; every access in `try`/`catch` — reaching the bare `localStorage` global included, which
  itself throws when site data is blocked (`apps/till/src/api/server-router.ts:22-27`, the closer
  precedent) — falling back to memory; no device → memory only.
- Modify: `apps/till/src/i18n/strings.ts`, both languages: `"make_now.title": "Make now"` /
  `"Preparar ahora"`; `"make_now.dismiss": "Done"` / `"Hecho"`.

**The widget:** a region labelled by its heading "Make now", one line per item —
`dishLine(item, item.name)` (`apps/till/src/widgets/dish-format.ts:16-29`), so "2× Lager" — then the
options in the staff wording (`optionAnswers(item.optionSnapshots, { reads: "staff" })`,
`apps/till/src/widgets/option-snapshot.ts:25`, as the basket reads them), each extra as "+ name", the
note — and one "Done" button that dispatches `dismiss`. It is not a toast: it never closes by itself
and is not `role="alert"` (it would re-announce on every render); its heading is announced when it
first appears through a polite live region. It renders nothing when the list is empty. Every colour,
spacing and font reads a `--wt-*` token; it fits a phone-width handheld without a sideways scroll.

- [ ] **Step 1: Write the failing tests.**
  - Server (`made-here.test.ts` or the route suite Task 9 made): `POST /api/sales` from the bar till
    with a lager and a burger answers `madeHere` holding one item, the lager, named by its STAFF
    name — give the lager different staff, customer and kitchen names, and assert the staff one
    (CLAUDE.md §3) — with the quantity `thousandthsToDecimal` gives for it; a draft submit (table Send) with a made-here lager answers it; a send with no made-here item
    answers no `madeHere` key; a route that answers a non-object is untouched; the session cookie set
    by a route survives the middleware (assert the `Set-Cookie` header on a response that sets one).
  - `readMadeHereItems` drops a line id with no made-here record.
  - Till client (`apps/till/src/api/client.test.ts` or beside it): a stubbed answer carrying
    `madeHere` calls the listener once with the items; one without it calls nothing.
  - Till widget: renders "Make now", "2× Lager", the staff option answer and "+ Lime"; "Done"
    dispatches `dismiss`; an empty list renders nothing. Its a11y test covers it in both themes.
  - Till app (`ls apps/till/src/till-app*.test.ts` for the suites driving Send and counter Pay): after
    a table Send whose answer carries a made-here item, and after a counter cash Pay whose answer
    does, the list shows the item; after "Done" it is gone; it is still shown after the screen
    changes; a send whose answer has none shows nothing.
  - **D11 (owner), a reload:** with a device identity, a list shown, then a new `till-app` mounted
    (the reload) with the same device → the list is restored from `waitron.makeNow.<deviceId>`; after
    Done the key is gone from `localStorage`; a different device id restores nothing; with
    `localStorage.getItem`/`setItem` stubbed to throw, and with the `localStorage` global itself
    throwing (as `apps/till/src/api/server-router.test.ts:173` stubs it), the list still shows and
    Done still clears it.
  - **Replays (coordinator ruling):** `POST /api/parties/:id/groups` sent twice with one
    `submissionId` from the bar till → both answers carry the lager in `madeHere`; `POST /api/sales`
    sent twice for one order → both answers carry it; a bill payment that completes a pay-first bill,
    repeated with its `submissionId` → both carry it; an adjustment that completes a pay-first bill,
    repeated with its `submissionId` → both carry it; a pay-first send with nothing made here writes
    no `made_here` row; a client command sent with the submission id `made-here:prepay` before the
    payment → the payment's store is refused `submission.id_reused` rather than writing into it. Control for each: drop the replay's restore and
    see the second answer lose `madeHere`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/made-here.test.ts` and — check
  memory first — `pnpm --filter @waitron/till exec vitest run src/widgets/make-now.test.ts src/widgets/make-now.a11y.test.ts src/api/client.test.ts`
  and the till-app suites. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS. Then in the dev stack (`wa-wt demo <worktree-name>`):
  tick Bar for the demo till on the Devices screen, sell a drink at the counter and send a drink
  from a table, and look at the list in both themes and at phone width.
- [ ] **Step 5: Commit** — "Till: after a send, the till lists the items it must make on the spot, by the names on its basket, until the waiter dismisses them".

---

### Task 10: A made-here item is never held, never prints and records no notice — holds, releases, reprints, slips

_Amended 2026-10-01 (owner, after approval): the approved task turned a held made-here record `ready`
at release; no made-here record is held any more (T12), so those changes are gone and the hold paths
below are pinned instead._

**Files:**
- Modify: `apps/server/src/working-order.ts`:
  - `isReleased` (`:2264-2272`) gains `ticketMadeHere: boolean | null` in its `Pick` and answers
    `true` first when it is true: a made-here line is released work, in a held group or not (T12).
    Every caller (`grep -n isReleased apps/server/src`) selects `madeHere: ticketItems.madeHere`
    beside `ticketFiredAt`: at `efb0ebf9d`, `servableLines` (`:2237`), `readCurrentOrders`
    (`apps/server/src/order-groups.ts:1099`), `groupArrivingDishes` (`order-groups.ts:1406-1414`,
    called at `:1434`) and the adjustments read (`apps/server/src/adjustments-apply.ts:209`, used by
    `stageOf`, `:260-264`). Rewrite `isReleased`' doc (`:2260`: "a line in a held group … is not")
    to name the made-here exception.
  - `readEditableOrder` (`:3689`) also reads each line's group state (left join `order_groups` on
    `group_id`); `newWork` (`:3771-3775`) counts a made-here line as sent work unless its group is
    held, where it counts as held work (T12, coordinator ruling); `firedCourseIds` (`:3776-3780`)
    leaves made-here records out (D10). Task 9 already put `madeHere` on `EditableLine.ticket`.
    Update `newWork`'s doc comment (`:3528-3534`, "`fire` where some line of the order was sent"):
    a sent made-here line in a held group counts as held work.
  - The comments T12 makes false: `sendLines`' "A held group's lines are released only by firing the
    group" (`:1587`) and `refuseHeldLeavingParty`'s "held work leaves only once fired" (`:3058`) —
    each narrowed to say a made-here line in the group was made at its send; keep it to that.
  - NOT changed: `releaseHeld` (`:1520`), `sendLines` (`:1580`), `finishRelease`, `fireCourse`,
    `recallLines` — each touches only records with no fire time (`:1532`, `:1624`) or `queued` ones
    (`:1744`), and a made-here record always has a fire time and is `ready` (T12). Write that
    invariant in one sentence on `ticket_items.made_here`'s doc comment (Task 1's sentence already
    says "it is `ready` from the moment it fires"; make it "it is fired and `ready` from the moment it
    is recorded: it is never held").
- NOT changed: `apps/server/src/order-groups.ts` — `readGroups` (T12: a made-here record counts as a
  ready dish), and `printHoldTickets` (`:1175-1209`), which reads records with no fire time (`:1192`),
  which a made-here record never is.
- Modify: `apps/server/src/kitchen-print.ts`:
  - `readReprintParts` (`:975-1028`): its FIRED query (`:987`) adds `eq(ticketItems.madeHere, false)`,
    so a reprint never prints one and `readReprintTargets` (`:1034-1064`) never names one. Its held
    query (`:999-1004`) reads records with no fire time and needs nothing;
  - a helper used at the TOP of `enqueueCorrectionSlips` (`:557-574`), `enqueueHoldCorrections`
    (`:581-598`) and `enqueueExtraCancelled` (`:666-689`), BEFORE each records its notices, and in
    `notifyMoved` (`:844-882`) before its notices:

```ts
/** `items` less those whose line's kitchen record is made here: it has no paper to correct and no
 *  screen line to tell (T11). One read by line id; an empty list reads nothing. */
async function withoutMadeHere<T extends { workingOrderLineId: string }>(
  tx: Transaction,
  items: readonly T[],
): Promise<T[]>;
```

  (Each of those helpers is called before the line or record it corrects is deleted —
  `enqueueCorrectionSlips`' own doc says a void calls it first, `:554-555` — so the record is still
  there to read. For `notifyMoved`, reading `madeHere` in `readTicketItemsOn`, `:814-841`, and
  filtering there does the same with no extra read. `enqueueHoldCorrections` needs it for
  `correctJoin`, `order-groups.ts:1283-1308`, which reads a joining line's record whatever its fire
  time.)

**Behaviour:** the paths T12 lists, plus a reprint (`reprintOrderTickets`), a cancel
(`removeFromLine`, from the adjustments route), an extra cancelled off a made-here dish
(`tellKitchenOfCancelledExtra`), and a bill moved to another table (`enqueueMovedSlips`,
`enqueueMovedSlipsFor`). A made-here line can be cancelled but not changed or recalled:
`kitchenHas` (`working-order.ts:3848`) and `recallLines` already refuse a `ready` item
`ticket.already_started`, and the till already hides Change and Recall for one (T10's correction) —
this task changes neither; its tests pin it.

- [ ] **Step 1: Write the failing tests** in `made-here.test.ts` (Bar has a printer; Grill has one;
  the bar till's list is `[Bar]`; every send uses the bar till's cfg; count Bar's print jobs and its
  kitchen notices — the notices through `VENUE_SERVICE.listStationNotices` — before and after each
  step). After every step, also assert the invariant: every `made_here` record has `fired_at` set and
  `state = 'ready'`.
  - **course hold:** a round of a burger in course 1 and a lager in course 2 → the lager is made now
    (`ready`, fired); then `fireCourse` for course 2 → no Bar job, the lager's record unchanged, and
    it is not in `listStationQueue(tx, bar)`. A later round with a course-2 burger: that burger is
    still held (the drink did not mark course 2 started, D10);
  - **D10 (owner):** a made-here aperitif in course 1 and a burger in course 2 in one round: the
    aperitif made now, the burger held until `fireCourse` for course 2;
  - **a round on hold** (`hold: true`), then `sendLines` with no line numbers (Send all): the lager
    was made at the send; Send all prints nothing at Bar;
  - **a held group** on a party (`apps/server/src/testing/party-venue.ts`) holding a lager and a burger
    (Grill), the venue printing held work in advance: the lager is made now; a HOLD job at Grill
    naming only the burger, none at Bar; the
    lager can be marked served at once (`markServed`), while the burger is refused `group.line_held`;
    the till's current orders (`readCurrentOrders`) show the lager released; firing the group
    (`fireGroup`) → a FIRE job at Grill for the burger, nothing at Bar, and the lager's `sent_at`
    unchanged;
  - **a held group of only the lager** → no HOLD job, `hold_printed_at` stays null; and a FIRED
    group of only made-here drinks reads `ready` in `listOrderGroups` (`readGroups` unchanged);
  - **an edit after a made-here send (coordinator ruling):** an open bill whose only line is a lager
    made here (sent, `ready`), then a burger added through `PUT /api/working-orders/:id` → the burger
    has a kitchen record at Grill, fired (no course) and printed; control: leave the made-here line out
    of `newWork` and see the burger get no record;
  - **a burger joining that held group by an edit** whose HOLD ticket was queued (`correctJoin`):
    HOLD CHANGED at Grill only, no notice at Bar;
  - `reprintOrderTickets` on an order with a made-here lager and a burger: Grill's REPRINT, nothing at
    Bar;
  - cancelling the lager through the adjustments route (as
    `apps/server/src/adjustments-extra-cancel.test.ts` cancels a line), whole and in part: no Bar
    job, no notice; cancelling an extra off a made-here dish: no Bar job, no notice;
  - **D1's default:** changing the lager through the edit route is refused `ticket.already_started`,
    and so is recalling it (`recallLines`); assert the codes;
  - a party's bill holding the made-here lager and a fired burger moved to another table: a MOVED
    slip at Grill, nothing at Bar, no `moved` notice at Bar;
  - splitting a bill holding a made-here lager (`carveOffLines`): the split-off part's record is
    still `madeHere: true` (`splitTicketItem` copies the whole row, `working-order.ts:3115-3139`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/made-here.test.ts`.
  Expected: FAIL (the lager is refused serving in a held group; each slip and notice above still
  happens).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, then
  `pnpm --filter @waitron/server exec vitest run src/kitchen-print.test.ts src/order-groups.test.ts src/adjustments-extra-cancel.test.ts src/print-problems.test.ts src/till-api.reprint.test.ts src/kitchen-print.concurrency.test.ts src/party-move-bill.test.ts src/split-bill.test.ts src/working-order.test.ts src/served.test.ts src/current-orders.test.ts`.
  Expected: PASS.
- [ ] **Step 5: Commit** — "Kitchen paper: a made-here item is never held, is served and read as released at once, and is never on a reprint, a correction slip or a kitchen notice".

---

### Task 11: Screens, table signals and the overdue report leave made-here items out

**Files:**
- Modify: `apps/server/src/working-order.ts`:
  - `listStationQueue` (`:5034`): its where (`:5077-5083`) adds `eq(ticketItems.madeHere, false)`;
  - `listExpoQueue` (`:5232`): its where adds `eq(ticketItems.madeHere, false)`, and its `exists`
    subquery (`:5289-5292`) adds `and tix.made_here = 0` — read in the code, not run: otherwise an order holding only
    made-here items would stay on the board until a course or group is sent away, and Task 11's
    test pins that it leaves. That subquery correlates to `working_orders`, a JOIN here, not the `.from()` base, but READ
    the emitted SQL with `.toSQL()` all the same (CLAUDE.md §3);
  - `listTablesWithState` (`:5517`): the `left join ticket_items ti on ti.working_order_line_id =
    wol.id` (`:5616-5617`) adds `and ti.made_here = 0`, so a made-here line counts as a line with no
    kitchen record in `ready_to_serve`, `en_route` and `unserved_lines`; `pending_to_serve`, which
    counts lines, is unchanged. The `pending_deliveries` subquery's `exists` (`:5633-5636`) adds
    `and ti.made_here = 0`. Keep the comment block above those counters true.
- Modify: `apps/server/src/table-signals.ts` — `readKitchenLines` (`:34-67`): its where (`:57-64`)
  adds `eq(ticketItems.madeHere, false)`.
- Modify: `packages/reporting/src/overdue-orders.ts` — `computeOverdueOrders` (`:35`): its where
  (`:59-65`) adds `eq(ticketItems.madeHere, false)`.
- Modify each function's doc comment where it says which items it reads.
- Test: `apps/server/src/working-order-reads.sqlite.test.ts` (or `made-here.test.ts`),
  `apps/server/src/table-signals.test.ts`, `packages/reporting/src/overdue-orders.test.ts`

**Not changed, on purpose:** the till's own order views (`readTabLines`, `working-order.ts:2663`;
`readCurrentOrders`, `order-groups.ts:1054`) show a made-here line as Ready — it was made on the spot.
A made-here line is servable at once, even in a held group (T12, Task 10), and a group's roll-up
(`readGroups`) counts it as a ready dish (T12).

- [ ] **Step 1: Write the failing tests:** with a fired made-here lager and a queued burger on one
  table's bill: Bar's `listStationQueue` is empty; `listExpoQueue` has the burger and no lager; an
  order holding only the made-here lager is not on the expo board at all; `listTablesWithState`'s
  `ready_to_serve` is 0 for the table and its unserved lines hold only the burger;
  `readPartySignals` (table-signals) shows no "ready at Bar"; `computeOverdueOrders` with the clock
  past Bar's forgotten threshold names no lager (it names the burger once the burger is old enough).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/working-order-reads.sqlite.test.ts src/table-signals.test.ts src/made-here.test.ts`
  and `pnpm --filter @waitron/reporting exec vitest run src/overdue-orders.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same commands, then
  `pnpm --filter @waitron/server exec vitest run src/party-table-actions.test.ts src/floor-annotations.test.ts src/current-orders.test.ts src/tabs.test.ts`.
  Expected: PASS.
- [ ] **Step 5: Commit** — "Kitchen screens, the expo board, the floor's ready counts and the overdue report leave made-here items out".

---

### Task 12: The documents catch up

**Files:**
- Modify: `docs/backlog.md`:
  - the design entry (`:182-218`): name this plan in the 3c sentence (`:214-216`) —
    "3c-1, what a station's ticket shows: the rest of the order, and dishes made at the till
    ([plan](superpowers/plans/2026-10-01-rest-of-order-made-here-slice-3c1.md))" — and, when it lands,
    "built (#PR)". Another 3c plan may have edited the same sentence: merge, do not overwrite;
  - NEW: "The kitchen screen's column view does not show the rest of the order" (T3: the column view
    has no per-order card; a station that needs it uses the card view);
  - NEW: "Units added to a discounted pay-first dish held in a group get a held kitchen record of
    their own while the dish has none" — seen by review 3 on `main` (probe F: `updateOrderLine`
    raising such a line wrote a new line with a `queued`, unfired record, while the dish's own line
    had none); its history was not checked, and whether it is wanted is open;
  - NEW: "A device's made-here stations do not travel in configuration export" (T7: devices are not
    exported, `packages/db/src/configuration-transfer.ts:1-37`; a venue set up from an export sets
    them again on the Devices screen);
- Modify, ONLY if 3b is not on `main` when this branch is FINISHED (coordinator rulings 4 and 3, review
  2's I3 and M8): `docs/superpowers/plans/2026-10-01-station-hours-fallbacks-slice-3b.md`. Write this
  at finish time, as the last commit before the pull request is opened, not earlier: if 3b lands
  before then, this branch rebases onto it instead (Task 9 Step 6) and writes nothing in 3b's plan.
  Put the same dated pointer in TWO places, so a builder who has already read the header still meets
  it: at the end of 3b's "Builds after slice 3a" paragraph (`:33-37`), and at the top of 3b's Task 4,
  where `fireLines` is edited (its heading is at `:931`). 3b's plan has no rebase step today
  (`grep -n -i rebase` on it finds nothing), so the pointer IS that step:

  > _2026-10-01 (slice 3c-1, "made here", landed first — `docs/superpowers/plans/2026-10-01-rest-of-order-made-here-slice-3c1.md`):
  > **When you rebase 3b onto a `main` that holds 3c-1, resolve the conflicts like this, and do not
  > push until step 6 passes.**
  > 1. **`fireLines`:** its first statement stays the one clock reading. 3c-1's
  >    `readMadeHereStations(tx, cfg.sendingDeviceId)` call comes AFTER it.
  > 2. **`fireLines`' value builder:** 3c-1's check
  >    (`const kept = options.keepMadeHere?.get(line.id); const made = …`) goes AFTER the line's
  >    station is final — after the make-at station, `keepStations` and the fallback outcome. A
  >    check placed before the fallback would mark a lager whose closed Bar falls back to Downstairs
  >    bar as made here, and nobody would get a ticket for it.
  > 3. **`applyLineEdits`:** `keepStations` and 3c-1's `keepMadeHere` hold the same keys — each
  >    changed line sent again AND each new line carrying units added to a sent dish (a raise, a
  >    change with a raise, and `addedApart`). Keep every entry of both maps; neither replaces the
  >    other. If both branches gave the `{ kind: "line", kitchen: "fire" }` entry a field naming its
  >    dish, keep ONE of them.
  > 4. **Migrations — regenerate, never hand-edit (CLAUDE.md §3).** 3c-1 added one generated CORE
  >    migration (`*_rest_of_order_made_here.sql`); it touched no venue-service set, so only 3b's
  >    core migrations collide. BEFORE starting the rebase, copy 3b's hand-written trigger SQL
  >    (`*_line_make_at_station_trigger.sql`) to `/tmp`. At EACH commit where the rebase stops on
  >    `packages/db/drizzle`, take `main`'s copy of that folder
  >    (`git checkout origin/main -- packages/db/drizzle`), so the commit carries none of 3b's core
  >    migration files — the `.sql` files AND their `meta/*_snapshot.json` files and journal entries
  >    — and continue the rebase. At the tip, with every schema edit in place, regenerate the core set
  >    once, in one commit: `pnpm --filter @waitron/db db:generate --name line_make_at_station` (it
  >    now carries both make-at columns AND `ticket_items_waiting_idx`; READ it: two
  >    `ALTER TABLE … ADD … REFERENCES` and one `CREATE INDEX`, no `__new_` rebuild), then
  >    `pnpm --filter @waitron/db db:generate:custom --name line_make_at_station_trigger` and paste
  >    its body from the `/tmp` copy. Then run
  >    `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts`
  >    and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`.
  > 5. **Run** `pnpm --filter @waitron/server exec vitest run src/made-here.test.ts src/made-here.routes.test.ts`
  >    and every other file holding 3c-1's route cases (`grep -rln madeHere apps/server/src/*.test.ts`).
  > 6. **Add the failing case** to `apps/server/src/made-here.test.ts`: Bar closed by hand with
  >    Downstairs bar as its fallback, a till whose made-here list is `[Bar]`, a lager claimed by
  >    Bar, sent from that till → its record is at Downstairs bar with `madeHere: false`, and
  >    Downstairs bar's printer has a ticket for it. Move 3c-1's check before the fallback outcome
  >    and confirm this case fails; put it back._

  **The campaign queue (coordinator ruling 3).** The plan's builder does NOT edit campaign queues.
  When this lands while 3b is not on `main`, the SUPERVISING session copies the pointer above into
  lane D's PF4 queue item (3b's), so a 3b session already running reads it there too; say so in the
  PR body's first lines, and in the final report to the supervising session.
- Modify: the design, `docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md` — a dated
  note at §5.10's second bullet: "_2026-10-01 (slice 3c-1): a station's own tickets — first send,
  FIRE, HOLD and reprint — and its kitchen screen's card view list it; the whole-order PASE ticket and
  correction slips do not, and neither does the column view. It lists items now with other stations,
  held ones as on hold; served, sent-away, made-here and no-preparation lines and dishes not yet sent
  are left out._"; and at §5.11: "_2026-10-01 (slice 3c-1): set per device on the Devices screen, not per
  profile, and not carried by configuration export. "Here" is the device that first sends the item;
  paths with no device give it a ticket. It is checked against the station the item finally goes to.
  A made-here item is never held: it is made the moment it is sent, even for a later course or in a
  held group, and the sending till shows a "Make now" list until the waiter dismisses it (owner,
  2026-10-01). Once made it can be cancelled, not changed (D1). A dish an edit sends again keeps its
  first send's decision._"
- Modify: `docs/developers/products.md` — in the surfaces table (`:152-165`), a row: "Also on this
  order (not for this station), on a station's own ticket and in its kitchen screen's order card |
  the kitchen names, through `kitchenPresentationName` | `readRestOfOrder`,
  `apps/server/src/rest-of-order.ts`"; and a second row: "Make now, on the till that sent made-here
  items | the staff names (`staffPresentationName`), each option answer's staff wording, and each
  extra's frozen staff name with ` x<n>` | `readMadeHereItems`, `apps/server/src/made-here.ts`, shown
  by `apps/till/src/widgets/make-now.ts`" (T13); and in the paragraph after it ("A cook sees the same name
  whether the order arrives on paper or on a screen", `:169`) nothing changes unless the sentence
  lists the surfaces, in which case add this one.
- Claims this slice retires (CLAUDE.md §1: a behaviour change retires every receipt about the old
  behaviour, wherever it lives). Run, over the WHOLE tree:
  `grep -rn "every ticket item\|each ticket item\|one ticket item per\|items are not filtered by state\|gathered across all stations\|flat list under the station\|still to serve\|Only the items fired here print\|inserted when a line is sent" CLAUDE.md docs/developers docs/superpowers/specs apps packages --include='*.ts' --include='*.md'`
  and `grep -rn "ticket item\|ticket_items" CLAUDE.md docs/developers apps/*/README.md packages/*/README.md`,
  read every hit, and fix each sentence a made-here record or the new block makes false (for
  example, a claim that every kitchen record is printed or shown, or that a station ticket holds only
  its own items). Keep each fix to the narrowest true sentence; a correction is a new claim.

- [ ] **Step 1:** the backlog, design and products edits.
- [ ] **Step 2:** the two greps, and a fix for each hit that is now false (list the hits you left in
  the commit message, with why each stays true).
- [ ] **Step 3:** `pnpm exec vitest run scripts/claude-md-pointers.test.ts` (if root `CLAUDE.md` or a
  pointer changed). Expected: PASS.
- [ ] **Step 4: Commit** — "Documents: the backlog, the design and the product-names guide record what a station's ticket now shows and what made here means".
- [ ] **Step 5 (finish time, only when 3b is not on `main`):** write the 3b pointer above in both
  places, commit — "3b's plan: how to rebase over slice 3c-1's made here (a dated rebase step)" —
  and tell the supervising session to copy it into lane D's PF4 queue item. If 3b is on `main` by
  now, skip this step and run Task 9 Step 6 instead.

---

## Self-review notes

- Design §5.10, "Show the rest of the order": stored (Tasks 1, 2), switched (Task 3), on paper
  (Tasks 4, 5), on a screen (Tasks 6, 7). §5.11, "Made here, no ticket": stored and set (Tasks 1, 8),
  applied at send (Task 9), left out of printing, slips and notices (Task 10), and of screens and
  reports (Task 11). §5.12's station card line: Task 3. Watchers (§5.11's last sentence) are 3d's;
  made-here items are left out of every reader a watcher would build on.
- T1 Tasks 1–3; T2 Tasks 5, 6; T3 Tasks 6, 7, 12; T4 Tasks 4, 5; T5 Task 5; T6 Tasks 1, 5; T7 Tasks 1,
  8, 12; T8 Task 9; T9 Task 9; T10 Tasks 1, 9, 10, 11; T11 Task 10; T12 Tasks 9, 10; T13 Task 9b.
- Interfaces changed: `kitchen_stations.shows_rest_of_order`, `ticket_items.made_here`,
  `ticket_items_order_idx`, `device_made_here_stations`; `Station.showsRestOfOrder` (server, dashboard);
  `TillConfig.sendingDeviceId`; `fireLines`' option `keepMadeHere` (changed lines and added-units
  lines); a raise's `pricedAs` entry gains `follows`; `EditableLine.ticket.madeHere`;
  `planKitchenTickets`' option `restOfOrderExcept`; `TillConfig.madeHereSink`, `MadeHereItem`,
  `readMadeHereItems`, the `madeHereAnswer` middleware and every till answer's optional `madeHere`;
  `TillApi.onMadeHere`; `isReleased`'s `ticketMadeHere`; `KitchenTicket`'s station variant `alsoOnOrder`;
  `StationQueueGroup.elsewhere` and `ElsewhereItem` (server, till); `DeviceRow.madeHereStationIds`;
  new routes `PUT /management-api/devices/:id/made-here`; `PATCH /management-api/stations/:id` takes
  `showsRestOfOrder`.
- Codes: none new. Reused: `management.request_invalid`, `device.not_found`, `station.not_found`,
  `ticket.already_started`.
- Migration: one core migration, measured as plain column adds, a new table and a new index; no
  rebuild, so the landing rule is "lands when green".
- 3b interactions are listed under "Builds after"; 3c-2's X13 reads `made_here` as this plan writes
  it.

## Review 1 applied (2026-10-01)

A fresh-context review (`plan-3c1-review.md`, 6 Important, 9 Minor) and the coordinator's six rulings
were applied in place. I1 / ruling 1: an edit that sends a dish again keeps the deleted record's
made-here decision (`keepMadeHere`, beside 3b's `keepStations`; T8, Task 9, with the handheld-then-bar-till
case). I2 / ruling 2: the party move, join and split-table routes (`takeIntoParty` → `adoptZone`) are
wired, and Task 9 Step 3 derives the route list by walking the call graph up from `fireLines`, with
the expected answer. I3 / ruling 3: a table of one failing case per wired place, each proven by
removing its wiring. I4 / ruling 4: the 3b rules are stated for both directions, Task 9 Step 6 runs at
rebase, Task 12 adds a dated pointer to 3b's plan when 3c-1 lands first, and the regeneration steps
name CLAUDE.md §3's whole guard set, `inmutabilidad` included. I5 / ruling 5: Task 1's commit states
why the table is core (and why the index exists, M5). I6: `live()` on both the switch and the boxes,
with a removal check. Ruling 6: D1 states the default and its alternative. M1 expected print text via
`thousandthsToDecimal`; M2 the reprint block once (`restOfOrderExcept`); M3 narrower wording; M4 → D7;
M5 the index's reason; M6 → D8 with its receipt; M7 the switch named `showsRestOfOrder`, its field
refusal under it; M8 → D6 (sent-away items left out); M9 → D9 (read, not measured). No finding was
left unapplied.

## Review 2 applied (2026-10-01)

A narrow re-check of review 1's replacement text (`plan-3c1-recheck.md`, 3 Important, 9 Minor, plus
one note on D4) and the coordinator's four rulings were applied in place. I1 / ruling 1: the
`/move`, `/join` and `/split-table` rows are rebuilt on the zone-less setup (a pay-first counter bill
moved to a table with no zone, as `party-move-bill.test.ts:1023` does; `/join` asked on the
table-service party's id; split on a non-main bill), each derived by reading its route, each
asserting the lager unsent before the request. I2 / ruling 2: `keepMadeHere` now holds the same keys
as 3b's `keepStations` — the changed lines and the new lines carrying units added to a sent dish,
which follow that dish — with a raise case and a held-made-here `addedApart` case. Following from
that, `PUT …/lines/:lineNo` no longer carries the device for its edit: it sends no dish for the
first time (`updateOrderLine` passes `fresh: []`), so the wiring could never be seen by a test, and
ruling 3's failing case for it cannot exist; its invoice step keeps the device through
`deviceSaleCfgOf`, and the edit cases moved to `PUT /api/working-orders/:id`. I3 / ruling 3: the 3b
pointer is an explicit, numbered rebase step with the full migration sequence (3b's custom trigger
migration re-created) and the fallback case as the test 3b's rebase must add; it is written at finish
time in both 3b's header and its Task 4, and the supervising session copies it into lane D's PF4
queue item. Minors: M1 a kept `madeHere: true` case; M2 "not applied" wording; M3 D7 narrowed to
`firedQuantity`; M4 "every kitchen-facing reader"; M5 a Fryer dish in the reprint-once case; M6 the
chips bumped to ready before being sent away; M7 "its row or rows"; M8 the pointer written at finish
time, dropped when 3b is on `main`; M9 the T8 function list and the `table-actions.ts` citations. The
D4 note: the Devices screen saves the list from the boxes it shows, with a test. T6's two
unmeasured reads are now measured (the re-check's receipts).

## Review 3 applied (2026-10-01)

A second re-check (`plan-3c1-recheck2.md`, 2 Important, 7 Minor), with probes run on `main` at
`5471552a8` (`scratchpad/rc2-3c1/`), was applied in place. I1: the `/split-table` row now uses the
setup the checker ran and saw work (probe C2) — the lager's bill moved in with `bills: "separate"`,
its held group fired, the table-service table joined, then the split — and "The zone-less setup"
says a bill moved into a party puts its unsent dishes in a held group. I2: `PUT …/lines/:lineNo` CAN
write a first kitchen record (a raise of a discounted dish held in a group with no record of its own
→ `addedApart` → a new held record, probe F), so it carries the device again and has its own row;
`keepMadeHere` adds no entry there because the dish has no earlier decision, and T8 now says the
editing device decides such units. This supersedes the "Review 2 applied" note's claim that the
route could not write one. Minors: M1 the `/join` row finds the record by line id; M2 the 3b
rebase step takes `main`'s core migrations at each stopped commit (snapshots and journal included),
saves the trigger SQL to `/tmp` first, and regenerates the core set once at the tip; M3 Task 9 Step 6
drops the pointer if 3b lands while this pull request is open, and the supervising session drops
the PF4 copy; M4 the `follows` field is no longer said to be 3b's, and the pointer keeps one such
field; M5 a change with a raise is named beside a raise; M6 T6 and Task 1's commit describe the
reads that scan as "among them", not a count; M7 the pointer's grep finds route cases by `madeHere`.
The re-check's aside became a backlog entry in Task 12.

## Amended 2026-10-01 (owner, after approval)

The owner corrected the approved plan: "a made-here item should never be held, it must be made in
the moment otherwise the waiter will forget. what happens when a held made-here item gets sent? it
doesn't get printed anywhere. how does the waiter know to make it?" Two decisions were added, both
the owner's: **T12**, a made-here item is never held — `fireLines` fires it at the send whatever
would have held it, and the owner accepts that a made-here drink ordered for a later course, or in a
held group, is made at once; T12 traces what every hold path then does with it — and **T13**, every
till request that records made-here items answers with them, and the till keeps a "Make now" list,
by staff name, until the waiter dismisses it (new Task 9b). Removed with the old rule: the approved
T10's "sent on hold" bullet; Review Focus 6's "a held made-here dish stays editable until it is
released"; Task 9's held-record test assertions and the held made-here `addedApart` row; Task 10's
release-time state change in `releaseHeld` and `sendLines`, its `finishRelease` filter, its
`printHoldTickets` filter and its held-dish edit case. Added: `isReleased` counts a made-here line
as released, `readGroups` was to leave made-here records out (dropped, below), and the course test's "already started"
check (`anyFired`) and an edit's view of the bill leave them out. The amendment's first draft took two defaults the owner then reversed
(2026-10-01): **D10** — a made-here item still counts for its course when the order's first course is
worked out ("Burger waits for course 2, otherwise the waiter should have sent them together"), though
it never marks its course started; and **D11** — the "Make now" list survives a reload, kept in the
device's own storage under a key naming the device, and cleared by Done. A cross-plan check the same
day (`made-here-amend-check.md`) and the coordinator's rulings changed three more things: an edit
counts a made-here line as sent work unless its group is held, so a dish added to a bill whose only
sent work is a made-here drink is still sent (the first draft left it out and stranded the dish);
`readGroups` is not changed after all (the first draft's filter left a fired group of drinks never
reading Ready, and the till already shows a held group as held, `till-table-order-screen.ts:3188`);
and a replayed send reports the made-here items the original recorded (`runServiceCommand` stores
them with its result; `firePrepayOrder` stores them on the bill for the sale, pay and bill-payment
replays). Also: every `isReleased` caller, `groupArrivingDishes` included; the five code comments T12
makes false; a `products.md` row for "Make now"; the till subscribing when `api` is set; the bare
`localStorage` global throwing. Those citations were read at `efb0ebf9d`. A second check
(`made-here-amend-check2.md`) then fixed: Task 10's commit message and Review Focus 6, which still
leaned on the dropped `readGroups` change (the API answers `ready: true` for a held group holding a
made-here drink; the till shows "held" first); the adjustment route, which now restores the stored
made-here ids on a repeat, with a replay test; the stored row, written only when there are ids,
merged only into a `made_here` row, and described truthfully (the server does not check that
submission ids are UUIDs); `firePrepayOrder` taking its ids from the sink's difference; the
`newWork` doc comment and `service_commands`' schema comment and classification text added to the
descriptions to update; and the accepted partial-payment replay behaviour. Under D1's default an edit cannot
add units to a made-here dish (a fired, `ready` record refuses a change), so "an edit that adds
units to a made-here dish" reaches "Make now" only under D1's alternative; ordering more as a new
line does reach it. Citations added here were read at `e6c46531f`.
