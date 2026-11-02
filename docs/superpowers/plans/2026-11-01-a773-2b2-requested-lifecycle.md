# A773-2 PR B2: a requested dish through every service action — task plan

**Goal.** Since PR B1 (#2381), a waiter's fire can leave a kitchen item **Requested**: the waiter
has asked for it (`ticket_items.requested_at` set) but no pass has released it to its station yet
(`fired_at` still null, `pass_controlled` true). B2 makes every other service action treat such a
dish correctly: serving it, recalling it to the draft, editing it, cancelling it, finishing the
table, moving it between stations and bills, a bill arriving at another party, and the readers that
count, alert on or correct kitchen work. Every station's "waits for the pass" setting stays false
and unexposed until PR C, so no venue changes behaviour; the only way to reach a Requested item is a
test's `setStationsWaitForPass` (`apps/server/src/testing/pass-waiting.ts:4`).

**Words used here.** *Held*: both stamps null — the waiter has not fired it. *Requested*:
`requested_at` set, `fired_at` null. *Released*: `fired_at` set — the station has it.
*Initiated*: Requested or released (`initiatedAt(item) = requestedAt ?? firedAt`,
`apps/server/src/kitchen-phase.ts:19-24`). *HOLD paper*: the advance ticket a station that prints
held work gets for a held group. *Pin*: a test of behaviour that is already right, kept so a later
change cannot break it unnoticed; every pin here has a mutation that turns it red.

**Implements.** The [slice plan](2026-11-01-a773-2b-requested-release.md)'s "## B2 (outline)" and
its "Left for B2 and B3 by B1's per-task reviews", under that plan's "Owner decisions this plan
applies" and Decisions D1–D20, which bind here unchanged; the [master plan](2026-10-19-a773-2-firing-and-pass.md)'s
Task 8 and Task 9's floor, reminder and output-alert readers, Contracts 1–2, and its "Shared
verification contract". Where this plan departs from either, "Departures" says so and why.

**Researched at** `2631b7bcc2` (main, 2026-11-01, B1 landed at `05fdd7c009`). Every file and line
below was read at that commit; the commands that were run are named where they are used and listed
in "Self-review". **Revised the same day** to answer review 1
(`~/waitron-campaign-c/a773-2b2-plan-review/review-1.md`); "Revision 2 (review-1)" at the end lists
each finding, its answer and the experiment behind it.

**Branch and worktree.** `feat/a773-2b2-requested-lifecycle` in
`/Users/clintongormley/workspace/worktrees/waitron-feat-a773-2b2-requested-lifecycle`, created off
`2631b7bcc2`, `pnpm install` done.

**Review weight: FULL.** B2 changes the serving gate, the cancellation context the till sends back
(a cross-package contract with the till), cancellation and Finish hand-offs that end in a refund,
bill moves and arrival, and kitchen readers other lanes depend on (master "Review Focus" 3 and 4).
Per-task reviews run; `/finish-branch` runs its full wave with two Codex run-it reviews.

**No location (owner, 2026-11-01, A1301).** Nothing here adds a `location_id` column, a
`locationId` parameter, or a per-location rule, setting, fixture or translation. Every new read is
keyed by item, line, group, party or station id. Existing reads that already pass `cfg.locationId`
(for example `passScreensDark`, `apps/server/src/station-outputs-down.ts:204-220`) are left as
they are; A1301's slices remove them.

**No migration and no venue reset.** B2 adds no column: everything it needs (`requested_at`,
`pass_controlled`, `request_kind`, `waits_for_pass`) landed in B1's `0204_requested_release`. If an
implementer finds a migration is needed, that is a stop: report it, do not generate one.

**Fiscal.** `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and
`src/inmutabilidad.test.ts` run unedited after B2.1, B2.3a, B2.4 and B2.7. No task touches
`computeHuella`, the hash chain, invoice numbering, `registros_facturacion` or the alta builders.
`apps/server/src/adjustments-apply.ts` is read-only throughout.

**Execution.** Every implementer is dispatched as `subagent_type: "implementer"` (medium effort),
one task per dispatch, in the worktree above. An implementer that passes about 150 calls with the
task unfinished stops at a passing or cleanly red point, commits, and hands over (done, left,
files, each check's state). Each task ends with `pnpm --filter @waitron/server typecheck` clean
(and `@waitron/till`'s when it touched the till), its focused suites green, `pnpm format:check`
clean, and a signed commit (`git commit -s`, explicit paths staged). No task is planned to end red.

**The test-change rule (owner, 2026-10-05).** A test that has to be edited to pass is a stop,
except the edits listed in "Changed test checks": adding what a fixture lacks, with no assertion
changed, or a whole-shape pin gaining the new contract fields. Prefer a new case to an edit.

## What the planning pass found (at `2631b7bcc2`)

Read by me or by four read-only research passes whose citations I re-read where a task rests on
them; the probes were run (see "Self-review" for the commands).

1. **Serving refuses a Requested dish today.** `refuseUnreleased`
   (`apps/server/src/working-order.ts:3772-3776`) throws `group.line_held` unless `isReleased`
   (`:3715-3727`), which reads `ticketFiredAt !== null` for a line with a kitchen item. A split
   extra that is Requested also blocks its dish, because `servableLines`' `extraHeld` subquery
   tests only `isNull(extraItem.firedAt)` (`:3669-3675`). **Probe P1** (a Fire now burger at a
   waiting Grill, then `markServed`): answered `group.line_held`. The till offers Serve only for
   rows whose `released` is true, and `readCurrentOrders` computes it from the same `isReleased`
   plus its own `heldExtras` set (`apps/server/src/order-groups.ts:1942-1949`, `:2035-2036`); the
   till reads it at `apps/till/src/widgets/sent-orders.ts:428,466,550,789-791` and
   `apps/till/src/screens/till-table-order-screen.ts:2735,3043,4404,4513,4531`.
2. **The money gates must keep reading `fired_at`** (D3). `isReleased` also feeds
   `ordersWithUnfiredDish` (`working-order.ts:3734-3769`, used only by `unpaid-departure.ts:99`)
   and `adjustments-apply.ts`' `stageOf` (`:335-339`). So B2 adds a second predicate for serving
   rather than changing `isReleased`.
3. **Splitting or moving a Requested dish to a new bill is refused.** `carveLines`' `refuseHeld`
   branch (`working-order.ts:4679-4687`) refuses any line outside a held group whose item has
   `ticketFiredAt === null`. **Probe P2** (`splitBill` of a Requested burger): answered
   `tab.split_held_line`. `splitBill` passes `refuseHeld: true`
   (`apps/server/src/bill-actions.ts:195-198`), `moveDishes` to a new bill too (`:453-456`).
4. **An edit that recalls and re-sends an already-released dish brings it back Requested.**
   `applyLineEdits`' "change" path (`working-order.ts:6337-6362`) deletes the dish's item, prints
   RECALLED, and re-sends it through `fireLines` with `release: true`, which stamps by the
   station's current setting (`kitchen-release.ts:26-37`). **Probe P3** (a released burger, Grill
   then set to wait, a note change through `updateOrderLine`): the new item had `firedAt: null`,
   `requestedAt` set, `passControlled: true`; Grill's printer had the first ticket and a RECALLED
   slip, and no new ticket. So the kitchen loses a dish it already had until the pass fires again.
5. **The cancellation context cannot see a waiter's fire that makes a held dish Requested, nor a
   station move.** Its components carry `id, lineId, state, firedAt, quantity, kitchenQuantity,
   servedQuantity, cancelledQuantity` (`apps/server/src/line-cancel-context.ts:12-25`, built at
   `:72-112`), compared by `isDeepStrictEqual` (`:137`). **Probe P5** (read the context of a held
   burger, fire its group with Grill waiting, read again): the two contexts were deep-equal.
   A pass release would change `firedAt`, so that race is already caught; held → Requested and a
   same-id station move are not. The parser rebuilds components from known keys and rejects a
   missing one (`line-cancel-input.ts:29-38`). The till's twin (`apps/till/src/api/line-cancel-types.ts:3-16`)
   is compared by two hand-written field lists, `consentKey`
   (`apps/till/src/widgets/cancel-item-dialog.ts:55-78`) and `sameFinishContext`
   (`apps/till/src/till-app.ts:1091-1115`). No guard compares server and till types.
6. **Cancelling a paid Requested dish while keeping the charge prints a HOLD CANCELLED slip for
   work that never printed.** `cancelItem`'s keep-charge branch sends every unfired correction of
   a grouped dish to `enqueueHoldCorrections` whatever its group's state
   (`apps/server/src/line-cancel.ts:495-512`), adding `holdGroupId` only when the group's HOLD
   ticket printed. A Requested dish's group is fired (`releaseGroup`, `order-groups.ts:878-888`).
   Read, not run; first measured by B2.3a's RED. The remove-charge branch prints HOLD CANCELLED only
   for groups `printedHeldGroups` returns, which requires state `held` (`order-groups.ts:2164-2180`),
   so a Requested dish gets nothing there.
7. **A Requested dish arriving at another party can land in a held group and print HOLD paper.**
   `groupArrivingDishes` (`order-groups.ts:2463-2561`) classifies with
   `isReleased({ ...line, groupState: null })` (`:2508`): a Requested dish is "not released", so
   in a live course held until fired it joins `heldByCourse` (`:2510-2512`), `groupArrived(...,
   "hold")` makes a held group, and the caller's `printHoldTickets` lists it (its filter is
   `isNull(firedAt)`, `order-groups.ts:2101`). Read, not run; first measured by B2.5b's RED. In a
   course that is not held until fired it goes to `immediate`, `fireOrderLines` skips it
   (`requestHeldItems` touches only `heldItem()` rows, `kitchen-release.ts:51-82`), and it stays
   Requested — B1 pins that (`party-move-bill.test.ts` "A773 waiter request", `:1187-1281`).
8. **Readers that misread a Requested part.** Group readiness ignores it
   (`listOrderGroups`' kitchen count filters `isNotNull(ticketItems.firedAt)`,
   `order-groups.ts:1513-1529`), so a group whose released parts are ready reads ready while a part
   waits for the pass. The floor's order-state counts call it held (`dishCounts`,
   `apps/server/src/order-state-counts.ts:68-84`); **probe P6** (one Requested burger) printed
   `{"ordered":1,"unsent":0,"held":1,"waiting":0,"ready":0}`. The printed "rest of the order"
   marks it held (`apps/server/src/rest-of-order.ts:72`), which D33 now keeps pending Owner
   question 4 (review 1, I5). The dark-pass alert leaves it out
   (`firedPassDishes`, `apps/server/src/pass-board.ts:180`, `gte(ticketItems.firedAt, since)`). An
   edit lowering a Requested dish's quantity, when one of its extras is released, prints a VOID for
   the dish (`working-order.ts:6236`, no `firedAt` check on `parent.ticket`; read).
9. **Readers already right for a Requested part.** `readHeldCounts` counts lines of held groups only
   (`order-groups.ts:1715-1740`); `readReleaseReminders` waits for unserved dishes of earlier groups
   whatever their phase (`:1583-1600`); `bumpGroupReady` skips unfired items (`:671-675`, pinned by
   B1); station deletion counts `isNull(firedAt)` work (`apps/server/src/station-delete.ts:76`);
   the station-dark alert counts released work only (`station-outputs-down.ts:106-122`), which D34
   keeps; reprints and MOVED slips read released items only (`kitchen-print.ts:1462,1925-1931`);
   `refuseChangesAfterSending` treats a record with `firedAt` null as held
   (`apps/server/src/changes-after-sending.ts:32`), as the master asks ("Requested is unreleased
   for 'while held'"); draft recall prints RECALLED only for records with `firedAt` set and deletes
   every item of the dish (`apps/server/src/draft-recall.ts:351-359,377-382`); a station move
   prints a FIRE ticket at the destination only for `firedAt !== null` rows and leaves the stamps
   alone (`apps/server/src/station-move.ts:418-433,474-478`); `moveOrderLines` moves items in place
   (`working-order.ts:4106-4109`) and `splitTicketItem` copies the whole row (`:5003-5019`);
   `finishPartyService` takes every unserved paid dish whatever its kitchen phase
   (`apps/server/src/finish-party-service.ts:125-163`).
10. **`releaseHeld`'s count is read by nobody.** It returns `firedItems.length + requested.length +
    noRoute.lines.length` (`working-order.ts:2576-2621`); its only caller `fireOrderLines`
    (`:2557-2574`) returns `void` and drops it (`rg -n 'releaseHeld\(' apps/server/src` names the
    call and the definition only).
11. **Tests that "un-fire" an item by clearing `fired_at` alone now make a Requested-shaped row.**
    Since B1, every fire stamps `requested_at` too (D2), so `.set({ firedAt: null })` leaves
    `requested_at` set. The search is `rg -n 'firedAt: null' apps/server/src -g '*.test.ts'`, read
    by hand: a pattern on `.set({ firedAt: null })` misses the conditional form
    `.set(x ? { firedAt: null } : { state })` (review 1, I1). At `2631b7bcc2` it finds seventeen
    updates that clear `fired_at` (no multi-line `.set({` form exists: `rg -n -B4 '^\s+firedAt:
    null,$'` piped to a `.set(`/`update(ticketItems)` match printed nothing), one of which,
    `kitchen-request.send.test.ts:467`, makes a Requested row on purpose; each other one a B2 reader change reaches is listed in "Changed test checks" with the
    one-word fix (`requestedAt: null`), which makes the row genuinely held, as D20 defines held, and
    the rest are named in that table's last row with why they stay green.

**Baseline.** The 60 server test files named in this plan, run unfiltered together at
`2631b7bcc2`: `Test Files 60 passed (60)`, `Tests 2886 passed (2886)`, exit 0. B1's own five files:
49 passed.

## Scope

**In B2.** Serving (Serve, Undo, All served) of a Requested dish and of a dish with Requested
extras, and the till's `released` flag that offers it; the money gates pinned unchanged; draft
recall, source resend and changes-after-sending pinned for a Requested dish; an edit's re-send
keeping each record's phase; the cancellation context's two new fields on the server, its parser
and the till's twin; no HOLD CANCELLED slip for Requested work without HOLD paper; Finish table
pinned across every phase; station moves and station closing pinned; split, move dishes and
arrival carrying a Requested dish; group readiness, floor counts and the dark-pass alert counting
Requested work as initiated; the printed rest of the order pinned unchanged (Owner question 4); the
edit's VOID skipping a Requested dish; an order-note change pinned; `releaseHeld` returning
nothing.

**Out of B2.** The pass's release and everything it prints (B3). The pass board and the station
queue's new fields (`phase`, `requestedAt`, `passControlled`) and current orders' new kitchen
fields (B3.3). Any screen, word or guide (B4). HOLD paper that printed before a fire for work that
then became Requested, and the made-here extras mapping's HOLD paper and pass placement (B3; D26,
D36). The station editor and coverage warning (PR C).

**Backlog.** B2.7 rewrites the A773-2 entry (`docs/backlog.md:88-94`, and `docs/backlog/till.md`
"A773-2" near `:2495`) to say B1 and B2 landed and B3–B4 remain, and adds the owner questions
below to the entry's open points if they are still unanswered.

## Decisions

D1–D20 are the slice plan's and bind unchanged. These are B2's, dated 2026-11-01.

- **D21 Serving reads initiation; the money gates keep reading release.** New internal
  `serviceRequested(line)` in `working-order.ts`, beside `isReleased`, with the master's signature
  (`Pick<ServableLine, "groupState"|"ticketItemId"|"ticketFiredAt"|"ticketRequestedAt"|"ticketMadeHere"|"sentAt">`):
  made here → true; held group → false; a line with a kitchen item → `initiatedAt({ requestedAt:
  ticketRequestedAt, firedAt: ticketFiredAt }) !== null`; otherwise `groupState !== null ||
  sentAt !== null` (the same ticketless rule as `isReleased`). `ServableLine` gains
  `ticketRequestedAt`; `refuseUnreleased` uses it; `extraHeld` means a *genuinely* held extra
  (both stamps null). `readCurrentOrders`' `released` and `heldExtras` follow the same rule, so the
  till offers Serve exactly where the server accepts it (master T8: "Serving/current-order/relocation
  reads use this initiation predicate"). `isReleased`, `ordersWithUnfiredDish` and
  `adjustments-apply.ts` are unchanged (D3). Serving a Requested dish does not release it; the
  pass's release (B3) excludes served quantity (master Contract 7).

- **D22 An edit's re-send keeps each record's phase.** When a "change" edit recalls and re-sends a
  dish (`working-order.ts:6337-6362`), a record that was released comes back released, whatever
  its station's setting now; a record that was Requested comes back Requested **with its first
  request time**, so a note change does not send a dish that has waited ten minutes to the back of
  the pass's To fire column (master Contract 10 sorts it by request time), and the "change" path
  agrees with the "free" path, which edits a Requested record in place and keeps its
  `requestedAt` (B2.2b case 3). B1's Task 4 decision ("the time of the write that adds it") was
  about **new** extras an edit adds, which keep that rule; a re-sent record is not new (review 1,
  M3). New `fireLines` options `keepReleased?: ReadonlySet<string>` (line ids, dish or extra,
  filled at the "change" path from each deleted item whose `firedAt` was set; for those lines
  `requestStamps` gets `waits: false`) and `keepRequestedAt?: ReadonlyMap<string, string>` (line
  id → the deleted item's `requested_at`, filled from each deleted item that was Requested; when
  that line's new stamps come back Requested, their `requestedAt` is the kept time instead of the
  edit's). Both are passed on to `insertSplitExtras`. If the station stopped waiting in between, the
  re-sent Requested record follows today's rule and is released at the edit's time. A "raise" (one more of a
  released dish, `:6436`, `:6496`) is new kitchen work and follows the station's setting. Why: the
  master's Contract 2 says moving released work never re-holds it and only the pass turns
  Requested into released; an edit of released work is the same dish corrected, not a new request,
  and the station already has it. Owner question 1 asks whether the owner agrees; the build uses
  this default.

- **D23 The edited order's course test reads initiation.** `readEditableOrder`'s
  `firedCourseIds` (`working-order.ts:5746-5753`, read at `:6453` and `:6516`) is built from
  `ticket.firedAt != null`. Under D19 it reads `initiatedAt(line.ticket) !== null`, as `fireLines`'
  own `initiatedCourseIds` already does (`:2241-2243`). The difference is reachable only when one
  edit deletes the course's last Requested record and adds a dish to that course; B2.2b case 4
  measures it first, and the change lands only if that case goes red (see the case).
  **Measured (2026-11-02, Task 2.2 review I1, run E3):** case 4 never reads `firedCourseIds`. On a
  party the edit's new dish goes into a new fired group, so its `release` is true before the course
  term is reached; emptying `firedCourseIds` left all four cases green. The case pins `fireLines`'
  own course rule instead, and `firedCourseIds` is left on `firedAt`.

- **D24 Draft recall of a Requested dish needs no change.** Today it prints nothing for it (no
  RECALLED: `draft-recall.ts:351-359` keeps `firedAt !== null`; no HOLD CANCELLED: the group is
  fired, `:360-376`), deletes its item (`:377-382`) and reserves the source as for any sent dish.
  That is the master's "no fictitious FIRE/RECALLED cooking slip". B2.2a pins it, the source resend
  round trip, the other-editor, started and paid refusals, and changes-after-sending's "held"
  reading.

- **D25 The cancellation context carries `requestedAt` and `stationId` on every component**
  (master T8), on the server type, its builder (from `ticket_items.requested_at` and
  `ticket_items.station_id`; null with no item), the parser (both required, like `firedAt`:
  `null` or a value, never absent), the till's twin and both till field lists. A waiter's fire that
  makes a held dish Requested and a station move that keeps the item's id both now refuse
  `tab.cancel_context_changed` (and `party.unserved_dishes` in Finish). A pass's release racing the
  dialog changes `firedAt` and is already refused; B2.3a pins it with a direct update standing in
  for B3's release.

- **D26 Requested work never gets a cooking correction, and gets a HOLD correction only where HOLD
  paper printed.** No VOID, RECALLED, TO STATION or FIRE for a Requested record (nothing printed
  for it). B2 fixes the one place that prints a HOLD correction for a Requested dish with no HOLD
  paper: `cancelItem`'s keep-charge branch (`line-cancel.ts:495-512`) skips a Requested record
  (`requestedAt !== null && firedAt === null`) whose group's `holdPrintedAt` is null; where the
  group's HOLD ticket printed it keeps today's HOLD CANCELLED. A legacy-recalled record (both
  stamps null, D20) keeps today's behaviour. **Narrowed to the station (2026-11-02, Task 2.3
  review Minor 1):** the group test still sent a `void` kitchen notice to a station that never had
  the group's HOLD paper (a Requested dish moved there from the station that did), because
  `enqueueHoldCorrections` records notices before `printCorrectionSlips` filters by station. The
  branch now keeps a Requested record only when `heldPaperStations` lists its own station for its
  group. Receipt: `kitchen-request.cancel.test.ts` "keeps the charge on a Requested dish moved away
  from its group's HOLD paper…" failed on the group test and passes; control: the group test back
  turns it red. **Handed to B3:** a Requested record whose station
  still holds HOLD paper from before the fire is today corrected only by that keep-charge branch;
  draft recall, the remove-charge branch and a station move send it nothing (they test
  `group.state === "held"`). `heldPaperStations` (`order-groups.ts:2142-2160`) already answers for
  any group, fired included (it reads `order_group_hold_stations` with no state filter), and B3.4
  reuses it to mark the release's FIRE ticket; the HOLD CANCELLED for those three paths is built
  there, once, beside that use, rather than three times here. Unreachable until PR C.

- **D27 A cancelled Requested dish's adjustment stage stays as today.** `cancelItem` records
  "unsent" for it (`line-cancel.ts:433-443`: no fired component, group not held), and so does
  `adjustments-apply.ts`' `stageOf` (`:335-339`), which B2 may not edit. Both stages need no refund
  approval (`packages/adjustments/src/policy.ts:213-224` asks for it only at "fired" or "served"),
  so the stage changes no permission; it shows in the adjustments report's "By stage". Owner
  question 3 asks whether it should read "Held"; B2 pins "unsent".

- **D28 Finish table needs no change for Requested dishes.** `finishPartyService` already includes
  every unserved paid dish, any phase, and compares each context exactly; its "preparation started"
  question applies only when a component is fired (`finish-party-service.ts:198-203`), so it is not
  asked for a Requested dish. B2.4 pins held, Requested, waiting and ready dishes in one Finish
  and the refund hand-off, and a race that D25's fields alone catch. That Finish is one transaction
  is not a B2 pin: `finish` receives the caller's `tx` and opens none of its own, and
  `withTransaction` runs the whole body under the database's write lock
  (`packages/db/src/tenancy.ts:30-36`), so a refusal after some dishes were cancelled rolls them all
  back whatever their phase. The existing case "rolls back earlier dish cancellations if a later
  reason is refused" (`finish-party-service.test.ts:218`) pins that; B2.4 runs it in GREEN.

- **D29 A station move keeps a Requested dish Requested and pass-controlled, with no paper, to any
  station** (master Contract 2: "even to an immediate station"). Today's `moveDishesToStation`
  already does (finding 9); it re-stamps `queued_at` to the move (`station-move.ts:418-433`), which
  is harmless because the pass's release sets `queued_at` (D2, B3.4). Released work stays released
  and gets its FIRE "from" ticket as today. B2.5a pins both, and station closing's "send".

- **D30 Split and Move dishes to a new bill accept a Requested dish.** `carveLines`' `refuseHeld`
  test (`working-order.ts:4683-4685`) refuses only genuinely held items (`ticketFiredAt === null &&
  ticketRequestedAt === null`). The moved item keeps its stamps (in place, or copied whole by
  `splitTicketItem`).

- **D31 An arriving Requested dish arrives as initiated.** `groupArrivingDishes` classifies with
  `serviceRequested` (D21), so a Requested dish goes to `released` and joins the arrival's fired
  group; it is never put in a held group, never re-requested and never printed. The `firing` date
  stays today's `ticketFiredAt ?? sentAt`: a Requested line's `sent_at` is stamped with its request
  time (`stampSent(…, firedAt)`, `working-order.ts:2344`), so the group is dated by the request
  without a new term (measured: a Flan sent at a waiting station had `requestedAt` and `sentAt` both
  `…16.634Z`; review 1, I4). `groupArrived` dates a fired group by its **earliest** line
  (`order-groups.ts:2576-2579`), so a Requested dish arriving beside an earlier released one joins
  a group dated by the released one. `moveLinesToGroup` keeps refusing a line whose
  group is not held (`group.not_held`, `order-groups.ts:1084-1088`), so a Requested dish (always in
  a fired group, or none, once D31 lands) never moves into a held group, and D14's "no HOLD CHANGED
  for a Requested extra" premise holds. The one exception is D36's made-here extras, handed to B3.

- **D32 A group reads ready only when every initiated part is ready.** `listOrderGroups`' kitchen
  count (`order-groups.ts:1513-1529`) counts initiated items (`initiatedItem()`) as remaining and
  counts as ready only released ready or made-here ones, so a Requested part keeps the group out of
  ready (master "Global Constraints": "A group reads ready only when every station's part of it is
  ready").

- **D33 Floor readers: a Requested dish is fired work, not held.** `dishCounts` counts a Requested
  dish or extra as **waiting** (held only when genuinely held; waiting when a not-made-here part
  is queued or preparing and initiated). `readHeldCounts` and the release reminders are already
  right (pins). **The rest of the order is not changed in B2** (review 1, I5): `readRestOfOrder`
  keeps `held: firedAt === null`, so another station's dish waiting for the pass still prints "(on hold)"
  after it on a cook's ticket (`kitchen-ticket.ts:395`) and reads `held: true` in the station
  queue's `rest` entries (`working-order.ts:8235`), its two consumers. That is kitchen paper a cook
  reads, so it is Owner question 4; the default keeps today's mark, which says what the cook needs
  (that station does not have the dish yet) and matches the station's Held column, where the slice
  plan puts Requested work ("Waiting for the pass", B4.6). B2.6a pins it. The
  floor's long-wait band (`table-signals.ts:74`, and the floor read's `unserved_lines`,
  `working-order.ts:8838-8852`) stays on released work, measured from the station's `queued_at`
  with the station's thresholds; a dish waiting for the pass does not age there. Owner question 2
  asks whether it should; B2 pins the default.

- **D34 The dark-pass alert counts Requested work; the dark-station alert does not.**
  `firedPassDishes` (`pass-board.ts:160-185`) also takes Requested items whose `requested_at` is
  within the window (master T9: "Output-down alerts include requested pass demand without requiring
  `firedAt`"): a dark pass with dishes waiting for its Fire is exactly what the alert is for. The
  station-dark query (`waitingDishesQuery`, `station-outputs-down.ts:106-122`) stays on released
  work: a station cannot act on a Requested dish until the pass releases it, as it cannot on held
  work; that query's index pin (`station-outputs-down.test.ts:176`) is untouched. The same query
  has a second consumer (review 1, M6): through `stationsWithWaitingDishes`
  (`station-outputs-down.ts:127`), it decides whether a **closed** station's printer-down alert is
  raised (`alert-sources.ts:694-697`: a closed station's alert shows only while it has waiting
  work). Under D34 a closed station whose printer is down raises no alert for a dish still waiting
  for the pass; the alert appears when the pass releases the dish, which is the moment the station
  first has it. Until then the pass sees the dish in its To fire column, and the dark-pass alert
  covers a pass nobody is watching. A warning before the release would mean the station-side query
  reading Requested work, which this decision declines for the reason above. Whether the pass
  should be warned before releasing to a station whose output is down is handed to B3.4 ("Left for
  B3"), which owns the release.

- **D35 `releaseHeld` returns nothing.** Its count was never read (finding 10); B2.6b makes it
  `Promise<void>`. No test can see it; the typecheck is its check.

- **D36 The made-here extras mapping stays; its pass placement and HOLD paper are B3's.** B1 Task 4
  left extras of a made-here dish in a held group Requested at a waiting station while the group is
  held (`kitchen-request.extras.test.ts:270`). That is consistent with D21: a made-here dish is
  initiated at its send even in a held group (`isReleased`, `working-order.ts:3723`), so its extras
  were initiated with it and wait for the pass. B2 pins only that such extras do not block serving
  the dish (B2.1 case 5). Which pass card and column shows them, and whether HOLD paper lists them
  (`printHoldTickets`, `heldItemsOf`, `correctJoin`, `readOnHoldTickets` and
  `enqueueOrderKitchenNoteChange`'s held branch all test `isNull(firedAt)`, so today they would),
  is decided where the pass first reads them: B3.1/B3.4.

- **D37 Department transfers list Requested work already; no field is added in B2.**
  `outstandingWork` (`apps/server/src/department-transfer-api.ts:293-314`) includes every
  unserved not-made-here item and the till shows only its state
  (`apps/till/src/widgets/department-transfers.ts:523`). Showing "waiting for the pass" there
  needs a phase field, which goes with B3.3's station and current-order fields and B4's screens.
  B2.5a pins that a Requested item is listed.

- **D38 `applyLineEdits`' late read of the next fire's kind stays B3's.** B1's Task 2 review found
  no case that reaches it and none shown impossible. `request_kind` has no reader until B3's pass
  card (D8), so B3.1, which reads it, is where a wrong kind becomes visible and testable.

- **D40 Races are tested as two orders; the pass's races are B3.5's** (review 1, M4). Every
  service command here runs inside one `withTransaction`, which runs its whole body under the
  venue database's write lock (`packages/db/src/tenancy.ts:30-36`), and each predicate B2 changes
  is read inside the same transaction as the write it gates (`servableLines` inside
  `changeServed`, `carveLines` inside the split, the context compare inside `cancelItem` and
  `finish`). So two writers never interleave inside one command, and each race reduces to which
  commits first. The dangerous order for the dialogs is the other write committing between the
  till's read and its confirm: B2 tests it for cancel against a waiter's fire (B2.3a case 1, B2.4
  case 2), cancel against a station move (B2.3a case 2) and cancel against a stand-in release
  (B2.3a case 3), each by a direct write between read and confirm. The reverse order is the plain
  sequential case. Races with the pass's own release (Serve, cancel, Recall, move against Fire) need
  the release, so they are B3.5's, with promise barriers as the master's verification contract
  asks.

- **D39 A fixture that makes an item held clears both stamps.** D20 defines held as both stamps
  null. Where a B2 reader change turns an existing fixture's `.set({ firedAt: null })` row from
  "held" into "Requested", the fixture gains `requestedAt: null` and no assertion changes
  ("Changed test checks"). A fixture whose reader B2 does not change is left alone.

- **D41 A Requested dish served whole does not block an unpaid departure** (2026-11-01, driver's
  answer to B2.1 review Important 1; the driver's brief called it D40, a number this plan already
  uses). After B2.1 a waiter can serve a Requested dish, and nothing then gives it a fire time:
  the waiter's fire skips it and the pass's release excludes served work
  (`2026-10-19-a773-2-firing-and-pass.md:94`). So `ordersWithUnfiredDish` refused the bill for
  ever, with a refusal that asks staff to cancel food the guests ate. The rule: a line with a
  kitchen item that is not released (`isReleased`), has a request time, and whose active
  quantity (`serviceQuantities`, `line-service-state.ts:20`, as `finish-party-service.ts:149`
  uses it) is fully served, is not counted. A line served only in part still refuses, and so does
  every other unreleased line: D3 is otherwise unchanged and `isReleased` still reads `fired_at`.
  The rule names the request time on purpose. Without it, a dish served whole and then recalled
  with every pass setting off (`recallLines` clears both stamps and does not look at served
  quantity) would stop refusing too, which `unpaid-departure.test.ts` "with no station waiting,
  still refuses a dish served whole and then recalled to held" pins. A Requested item exists only
  where a station waits (`requestStamps`, `kitchen-release.ts:34`), so with every pass setting
  off nothing changes: the whole `unpaid-departure.test.ts` (68 passed, all but three cases with
  every setting off) and B2.1's GREEN list plus `kitchen-request.cancel.test.ts` (11 files, 778
  passed) are green. Controls: dropping the served condition turns "records a bill whose waiting
  dish was served whole" red; loosening it to any served quantity turns "refuses a bill whose
  waiting dish was served only in part" red; dropping the request-time condition turns the
  recalled pin red.

- **D42 Raising a Requested whole-portion dish adds copies that follow their station** (2026-11-02,
  driver's answer to Task 2.2 review Important 2). A Requested dish has nothing released, so an
  edit that raises its quantity takes the "free" path, and a whole portion rises by copies of
  itself. The copies took `kitchenStateOf(parent)`, which answered "hold" for any line with a
  kitchen item, so a Fire now burger raised from 1 to 2 gained a held copy inside its fired group,
  which the till could not serve (D21). Under D22 (an edit keeps each
  kitchen item's phase, and added units are new kitchen work) and the slice plan's D2 and D19,
  `kitchenStateOf` now answers "fire" for a line whose item is initiated. The copy then goes
  through `requestStamps` like a dish newly fired in a fired group: Requested at the edit's time at
  a waiting station (B1 Task 4's rule for edit-added extras), released at one that does not wait,
  never held. The same change reaches units added beside an adjusted Requested line (the "joins"
  path), which now arrive Requested in the line's fired group instead of held. A held or recalled
  item still answers "hold". With no station waiting nothing changes: a released dish is raised
  through the "raise" path, which never reads `kitchenStateOf`. Receipts:
  `kitchen-request.edit.test.ts` "raises a waiting burger by a waiting copy…" and "…by a released
  copy once Grill has stopped waiting" failed before the change (the copy had both stamps null)
  and pass after; "with no station waiting, raises a fired burger by a released burger and a
  Grill ticket" passed both before and after; `adjustments-apply.test.ts` "sends the Burger added
  to a comped waiting one as waiting too…" pins the "joins" path. Control: `kitchenStateOf` back
  to "hold" for every item turns all three of those red.

- **D43 A dish waiting for the pass cannot change course** (2026-11-02, driver's answer to the
  Task 2.5 review's Important 1). `setLineCourse` refused only a dish with a fire time, so a
  Requested dish could be moved into another course while it waited at the pass. It now refuses
  any dish whose item, or an extra's item, is initiated (`initiatedItem()`), with the same
  `ticket.already_fired` a released dish gets: the pass already has the dish, and its own doc says
  such a dish is corrected by a recall, never re-coursed underneath the pass. A held dish still
  changes course. A made-here dish was already refused (its item has a fire time from the send),
  so D36's Requested extras of one change nothing here; no till widget dispatches the
  `set-line-course` event its listener handles (`grep -rn line-course apps/till/src`). With no
  station waiting nothing changes, because every initiated item then has a fire time. Receipts:
  `kitchen-request.bill-move.test.ts` "refuses to change the course of a Requested dish…" failed
  before the change (the call resolved) and passes after; "still lets a held dish change course"
  and the ten suites that call `setLineCourse` (903 tests) pass. Control: the check back on
  `fired_at` alone turns the Requested case red.

## Departures from the outline and the master plan

| Outline or master says | This plan | Why |
| --- | --- | --- |
| B2.6 "correction slips skip requested items" | Requested gets no cooking slip and no HOLD correction without HOLD paper; HOLD paper printed before the fire is corrected only where today's code already does, the rest in B3 | D26: "skip" would delete the keep-charge branch's correct HOLD CANCELLED for a group whose HOLD paper printed; the master's "including printed HOLD" is built on `heldPaperStations`, which already answers for fired groups and which B3.4 reuses for the release |
| Master T8 "current-order presentation" in B2; outline puts `readCurrentOrders` in B3.3 | B2.1 changes only `released` and `heldExtras` (the Serve gate); B3.3 adds the fields | D21: the server must not accept a Serve the till never offers; the new fields have no reader before B4 |
| Outline B2.3 "a release racing the dialog refuses" as new behaviour | a pin: `firedAt` already changes at release | finding 5 (probe P5 shows what is *not* caught: held → Requested) |
| Outline B2.4 "includes held, requested, waiting and ready" as a change | pins only | D28, finding 9 |
| Outline B2.5 one task, B2.6 one task, B2.2 and B2.3 one each | B2.2a/b, B2.3a/b, B2.5a/b, B2.6a/b | each stays well under 100 calls |
| Outline B2.6 `station-outputs-down.ts:122` "include requested pass demand" | the dark-pass read (`pass-board.ts:180`) changes; the dark-station read, and with it a closed station's printer-down alert, does not | D34 |
| Outline B2.6 lists `rest-of-order.ts:72` | unchanged in B2 and pinned; Owner question 4 | D33: it is kitchen paper a cook reads, so the owner decides (review 1, I5) |
| Master T8 "Automatic rerouting cannot let a pass cook outside scope" | B3 | it is the release's scope check (master Contracts 7–8, B3.4–B3.5); `rerouteHeldAtRelease` already skips Requested work (B1 D6) |
| Master T8 "Move requested … its destination pass releases it once" | B2.5a pins the move; "releases it once" is B3.5's | needs the release |
| Master T8 "suppress later fire jobs for already served components" | B2.1 pins that a served Requested dish stays Requested and is never swept by a later waiter's fire; the release's exclusion of served quantity is B3.4's | needs the release |
| "B2 or B3" made-here extras mapping | kept; B2 pins serving; placement and HOLD paper B3 | D36 |

## Owner questions

None blocks B2: each has a default the build uses, and nothing here is reachable until PR C
exposes the setting. They go to `~/waitron-campaign-c/questions.md` with B3's copy sheet (slice plan
"Owner question 1"), one at a time, each with a worked example.

1. **Editing a dish the pass has already released.** A waiter changes the note on a burger the
   Grill already has ("no salt"); today that recalls it (RECALLED slip) and sends it again. At a
   station that waits for the pass: should the Grill get the corrected ticket at once (**default,
   D22**), or should the pass have to press Fire again first?
2. **A dish waiting for the pass on the floor plan.** Should a table whose dishes have waited a
   long time for the pass show the floor's "waiting long" mark, as a dish waiting at a station does?
   **Default: no** (D33): the floor's bands measure kitchen time with each station's thresholds;
   pass delay shows on the pass's To fire column, oldest first (B3/B4).
3. **The adjustments report's stage for a cancelled dish that was waiting for the pass.** It
   records "Unsent" today (D27); "Held" would say more exactly that the waiter sent it and the pass
   had not released it. Either needs no refund approval. **Default: "Unsent"**, unchanged.
4. **Another station's dish waiting for the pass, on a cook's ticket** (review 1, I5). A table
   orders a burger with chips; the Grill does not wait, the Fryer does. The Grill's ticket lists
   the rest of the order: "1 x Chips — Fryer". The chips are waiting for the pass to send them to
   the Fryer. Should the Grill's ticket print **"1 x Chips — Fryer (on hold)"** ("(en espera)" on
   a Spanish ticket; **default**, today's wording: the Fryer does not have them yet) or
   **"1 x Chips — Fryer"** with no mark (the waiter has asked for them)? The same answer applies to
   the station screen's "rest of the order" list. Today's Grill ticket for one Fire now round of a
   burger and chips (round 3's run E22): `Kitchen` / `P1` / `1` / `23:05` / `1.000 x Burger` /
   `-- Also on this order --` / `1.000 x Chips — Fryer (on hold)`; the word comes from
   `kitchenTicketWords().onHold` (`apps/server/src/i18n/kitchen-ticket.ts:14,49`).
   **How the build proceeds:** B2 keeps the mark (D33) and pins it (B2.6a case 6), so nothing waits on
   the answer; if the owner chooses no mark, the change is one line in `rest-of-order.ts:72` plus
   inverting that pin, made in B3.3 (which owns the station queue's fields) or B4 (wording).

## Task 0: preflight (no commit, about 15 calls)

- [ ] `git -C <worktree> fetch && git log --oneline 2631b7bcc2..origin/main -- apps/server/src/working-order.ts apps/server/src/order-groups.ts apps/server/src/line-cancel*.ts apps/server/src/finish-party-service.ts apps/server/src/station-move.ts apps/server/src/bill-actions.ts apps/server/src/order-state-counts.ts apps/server/src/pass-board.ts apps/till/src/api/line-cancel-types.ts apps/till/src/widgets/cancel-item-dialog.ts apps/till/src/till-app.ts`.
  If anything landed, rebase and re-read the lines this plan cites before B2.1; implementers search
  by function name, never by line alone.
- [ ] In flight elsewhere at planning time (`git worktree list`): A1301's
  `refactor/a1301-s2-invoice-inputs` (lane E), `refactor/a1301-s9-staffing-bookings` and
  `refactor/a1301-f1-seed-helpers`; lane C's own A1301 S10–S12 (orders, kitchen, stations,
  devices) are queued. A rebase may meet them in `working-order.ts`, `order-groups.ts`,
  `station-move.ts` and `pass-board.ts`. That is a reason to rebase often, never to wait.
- [ ] Re-run the consumer audit search of the slice plan
  (`rg -n 'firedAt|fired_at|awayAt|away_at|passItemMarks|pass_item_marks|fireControl|fire_control|fireHeldGroupsOfCourse|fireCourse' apps packages scripts -g '!*.test.ts' -g '!**/drizzle/**'`;
  at `2631b7bcc2`, `rg -c … | wc -l` counts 59 files: the slice plan's audit table assigns every
  one, apart from B1's own `kitchen-phase.ts` and `kitchen-release.ts`). Add any new file to the
  ledger.
- [ ] Ledger: lane C's campaign ledger (`~/waitron-campaign-c/item-a773-2b-ledger.md`) stands in for
  `docs/handoffs/`, as it did for B1; add a "B2" section (`Status: in progress`).

## Task B2.1: serving a Requested dish (about 80 calls)

**Files.** Modify `apps/server/src/working-order.ts` (`ServableLine` `:3628-3642`, `servableLines`
`:3648-3706`, new `serviceRequested` beside `isReleased` `:3715`, `refuseUnreleased` `:3772-3776`)
and `apps/server/src/order-groups.ts` (`readCurrentOrders` `:1848`: its line select `:1915`,
`heldExtras` `:1942-1949`, `released` `:2035-2036`). Create
`apps/server/src/kitchen-request.serve.test.ts`. Add one `describe` to
`apps/server/src/unpaid-departure.test.ts`. Fixture fix in
`apps/server/src/split-off-extras.release.test.ts:220-225` ("Changed test checks").

**Interfaces.**

```ts
// working-order.ts
interface ServableLine { /* … */ ticketFiredAt: string | null; ticketRequestedAt: string | null; /* … */ }
/** Whether the waiter has initiated a dish line, which is what serving needs (D21). The money
 *  gates read {@link isReleased} instead. */
export function serviceRequested(
  line: Pick<ServableLine, "groupState" | "ticketItemId" | "ticketFiredAt" | "ticketRequestedAt" | "ticketMadeHere" | "sentAt">,
): boolean;
```

`extraHeld`'s subquery becomes `and(isNull(extraItem.firedAt), isNull(extraItem.requestedAt))`
(`heldItem()` names `ticketItems`, not the alias). `readCurrentOrders` selects
`ticketRequestedAt`, builds `heldExtras` from extras whose item is genuinely held, and sets
`released` from `serviceRequested`. `serviceRequested` is exported because `order-groups.ts` needs
it (here and in B2.5b). `isReleased`, `ordersWithUnfiredDish` and `adjustments-apply.ts` are not
touched.

**If it runs long.** Estimated at about 80 calls (round 3, M5; read, not measured). Split point:
cases 1–7 and 9 with their mutation controls first; then case 8, case 10, the money-gate pin and the
remaining controls.

- [ ] **Failing tests and pins** (`kitchen-request.serve.test.ts`, `describe("A773 requested
  lifecycle: serving")`; `setupSplitExtrasVenue` with its seated `party`; lines with no `extras`
  unless a case names chips; serve with `markServed`/`unmarkServed`/`markGroupServed` from
  `working-order.ts`, taking the party revision as `kitchen-request.release.test.ts:96-110` does;
  write the helpers first so each case fails on an assertion, never an import):
  1. **Serve a Requested dish.** Grill waits; a Fire now burger (`placeGroups`, `release: "fire"`):
     `markServed` of its whole line answers a revision, the line's `servedQuantity` is 1, and its
     item's row (`requestedAt`, `firedAt`, `passControlled`, `state`, `queuedAt`) is identical
     before and after. Fails today with `group.line_held` (probe P1).
  2. **Undo, and a served Requested dish is never swept.** After case 1's serve, `unmarkServed`
     takes it back (`servedQuantity` 0, item identical); serve again, then `fireOrderLines` naming
     the line with a routing a minute later (as `kitchen-request.release.test.ts:329` does): the
     item identical and no job at any printer. The sweep half is a pin of B1's `heldItem()` guard.
  3. **All served.** Grill waits; a Fire now group of a burger and a dish routed to Bar (route
     bottled water there with `setRoutingCell`, as `kitchen-request.release.test.ts:177-182`
     does): `markGroupServed` serves both lines. Fails today with `group.line_held`.
  4. **A released dish whose extra is Requested is servable, and its extra is served with it.**
     Fryer waits, Grill does not; a Fire now burger with chips (burger released, chips Requested,
     as B1's `kitchen-request.extras.test.ts:145` shows): `markServed` of the burger serves it and
     the chips line's `servedQuantity` follows (`writeServed`, `working-order.ts:3801-3836`). Fails
     today: `extraHeld` is true.
  5. **The made-here mapping (D36).** B1's setup at `kitchen-request.extras.test.ts:270` (a burger
     made here in a held group, its chips Requested at a waiting Fryer): `markServed` of the burger
     succeeds. Fails today: `extraHeld`.
  6. **A genuinely held extra still blocks.** Grill and Fryer not waiting; a burger with chips in
     a held group fired with `fireGroup`, then the chips' item set back to held by a direct update
     clearing **both** stamps: `markServed` of the burger refuses `group.line_held` (caught outside
     `withTransaction`), nothing written. A pin of the existing refusal under D21's narrower
     `extraHeld`.
  7. **The till offers what the server accepts.** `readCurrentOrders` on case 1's party before the
     serve: the Requested burger's row `released: true`; in case 4's setup the burger's row
     `released: true`; in case 6's setup `released: false`; a burger in a held group
     `released: false`. Fails today on the first two.
  8. **D3's shift, both paths (pins).** Grill waits. (a) One Fire now group holding a burger and a
     no-preparation water in the same course: the water's line `sentAt` equals the burger's
     `requestedAt`, and `isReleased` over the water's row as `servableLines` would read it
     (`groupState` of its group, no item, its `sentAt`) is true. (b) A course with one Requested
     burger (`addTabRound` with `release: true` and a `courseId`), then a later `addTabRound` of a
     water in that course: the water is stamped sent at once and reads released by `isReleased`.
     Both run through B1 code (`fireLines` `:2274-2276`, `stampSent` `:2344`) and pass from the
     start.
  9. **A dish and its extra released before the column (pin; review 1, I2).** Grill and Fryer not
     waiting; a Fire now burger with chips (`placeGroups`, `release: "fire"`), then one direct
     update setting `requested_at` null on both items (`fired_at` kept), the shape of a row written
     before `0204_requested_release` (D19); assert the two items' stamps first. `markServed` of the
     burger serves both lines (`servedQuantity` 1000 each), and `readCurrentOrders` gives the
     burger's row `released: true`. Passes today and after (the `markServed` half measured, below;
     the current-orders row read, not run); it is the only case
     whose row has `fired_at` set and `requested_at` null, so it is where a predicate that forgot
     `firedAt` shows.
  10. **Partial serving of a Requested dish (review 1, I6; master T8 "Whole-line/partial serving",
      "Review Focus" 4).** Grill waits, Fryer does not; `addTabRound` one line of two burgers with
      one chips each (`quantity: "2"`, as `split-off-extras.edit.test.ts:179` does): the burger
      Requested, the chips released, each line's `quantity` 2000. `markServed` with
      `quantity: "1"`: the burger line's `servedQuantity` 1000 and `servedAt` null, the chips line's
      `servedQuantity` 1000 (half its quantity, `writeServed`'s scaling), the burger's item row
      identical; then `unmarkServed` with `quantity: "1"`: both lines back to 0, the item identical.
      Fails today with `group.line_held` (measured).
- [ ] **Money gates (pin, `unpaid-departure.test.ts`, new `describe("A773 requested lifecycle")`
  beside `:1396`, reusing its venue, `seatedWith` and `depart` helpers):** every station of the
  venue waits (`setStationsWaitForPass` over the venue's `kitchen_stations` ids, read in the test);
  a seated party whose dish is sent through the file's own send route becomes Requested (assert its
  item's stamps first); the unpaid departure answers 409
  `{ code: "unpaid_departure.unfired_dishes", params: { workingOrderId: party.tabId } }` and
  `expectNothingWritten` holds, as `:1396-1417` asserts for a recalled dish. Passes from the start.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.serve.test.ts`:
  cases 1, 3, 4, 5, 10 and 7's first two rows fail on `group.line_held` or `released: false`; 2's
  serve half fails with case 1; 6, 8 and 9 pass and stay as pins. Then
  `pnpm --filter @waitron/server exec vitest run src/unpaid-departure.test.ts -t 'A773 requested lifecycle'`:
  passes (pin). Read the `Tests` count of each run.
- [ ] **Minimal implementation** as "Interfaces". Then run
  `src/split-off-extras.release.test.ts`: "refuses serving a sent water while its chips are held
  again" (`:214`) goes red because its fixture clears only `firedAt` (`:220-225`); add
  `requestedAt: null` to that `.set` (D39). No assertion changes.
- [ ] **GREEN.** RED commands unfiltered; unfiltered `src/served.test.ts`,
  `src/split-off-extras.release.test.ts`, `src/current-orders.test.ts`,
  `src/unpaid-departure.test.ts`, `src/adjustments-apply.test.ts`, `src/till-api.groups.test.ts`,
  `src/kitchen-request.send.test.ts`, `src/kitchen-request.extras.test.ts`,
  `src/working-order.test.ts`; the fiscal pair, unedited; typecheck; format check.
- [ ] **Mutation controls** (each reverted after it goes red): `serviceRequested` reading
  `ticketFiredAt` alone → cases 1, 3 red; `serviceRequested` reading `ticketRequestedAt` alone
  (ignoring `firedAt`) → case 9 red; `extraHeld` back on `isNull(extraItem.firedAt)` → cases 4, 5
  red; `extraHeld` testing `isNull(extraItem.requestedAt)` alone → case 9 red; `writeServed`
  writing the line's whole active quantity instead of `served` → case 10 red; `readCurrentOrders`'
  `released` back on `isReleased` → case 7 red; `readCurrentOrders`' `released` reading
  `ticketRequestedAt` alone → case 9's current-orders row red (not run at planning);
  `isReleased` changed to read initiation (the tempting shortcut) → the unpaid-departure pin red;
  `stampSent` given only the ticketed lines in `fireLines` → case 8 red; `requestHeldItems`' second
  update without `heldItem()` → case 2's sweep half red. **Removed** (review 1, I2): "`extraHeld`
  testing `isNull(requestedAt)` alone → case 6 red" — case 6's chips have both stamps cleared, so
  that mutant refuses exactly as the real predicate does; measured green (below).
- [ ] **Measured at planning** (a throwaway test file in `apps/server/src`, a minimal
  `serviceRequested` and `extraHeld` applied to `working-order.ts`, all reverted and deleted;
  `git status` clean afterwards): case 9 passed on the unmodified tree and with the change; with the
  change, `serviceRequested` reading `ticketRequestedAt` alone → case 9 `AppError: group.line_held`;
  `extraHeld` as `isNull(extraItem.requestedAt)` alone → case 9 `group.line_held`, while case 6
  under the same mutant stayed green (`Tests 1 passed`); case 10 failed on the unmodified tree with
  `group.line_held` and passed with the change; `writeServed` writing `line.activeQuantity` → case
  10 red (the burger line read `servedQuantity` 2000).
- [ ] **Commit.** `git commit -s -m "Let a waiter serve a dish that waits for the pass, keeping the money checks on what the kitchen has"`
  (body: serving and the till's Serve button read whether the waiter has asked for the dish; the
  unpaid-departure and adjustment checks still read whether the kitchen has it; the one fixture
  line added and why).

## Task B2.2a: recalling a Requested dish to the draft (pins, about 45 calls)

**Files.** Create `apps/server/src/kitchen-request.recall.test.ts`; add one case to
`apps/server/src/bill-editing.commands.test.ts` (case 3, which needs that file's second person).
No product change is planned; if a case goes red, stop and report (D24 would be wrong).

- [ ] **Pins** (`describe("A773 requested lifecycle: recall")`; `setupSplitExtrasVenue`; recall
  with `recallToDraft` (`draft-recall.ts:294`), its `expectedEdit` from `readBillEditState`, as
  `src/draft-recall.test.ts:124` (`recall`) does; submit with `submitDraft`
  (`apps/server/src/order-drafts.ts:1124`) as that file's resend cases do; read every printer's job
  count before and after each write):
  1. **Recall a Requested dish into the draft.** Grill waits; a Fire now burger; recall it: its
     ticket item is gone, an `order_draft_recalled_lines` row names its line, the line's price,
     discount and allergy ticks are identical (compare whole with the `frozen` helper's shape,
     `draft-recall.test.ts:131`), no job at any printer and no kitchen notice
     (`VENUE_SERVICE` notices read as `draft-recall.test.ts:1277` reads them).
  2. **Source resend round trip** (master T9 "source resend"). After case 1, submit the draft with
     Fire now: one ticket item for the line, Requested (stamps as D2), no job at Grill or Pass; the
     reservation row gone. B1 Task 3b case 9 pinned only the resend's write.
  3. **Another editor refuses** (in `bill-editing.commands.test.ts`, beside "Recall loses to a
     rival first save" `:509`, reusing its `fixture`, `sentDish`-style send, `save` and `rows`
     helpers on `provisionBillVenue`, whose `adminId` is a second person; review 1, I3). Every
     station waits (`setStationsWaitForPass` over the `kitchen_stations` ids) before the send, so
     the dish is Requested (assert its item's stamps); the admin takes the bill with a first save;
     then the operator's recall, with an `expectedEdit` read **fresh** by `readBillEditState`
     (so only the other-editor check can refuse, not a stale edit state), refuses
     `draft.taken_over` (caught outside the transaction) and `rows()` is identical. The case sets
     every station back to not waiting in a `finally`, as B2.5b case 5 does (the file's venue is
     shared, `resetPerTest: false`, `bill-editing.commands.test.ts:35-43`).
  4. **Started refuses.** Grill waits, Fryer does not; a Fire now burger with chips; the chips'
     item advanced to `preparing` (`advanceTicketItem`): recalling the burger refuses
     `ticket.already_started`, nothing written.
  5. **Paid refuses.** A Requested burger on a bill paid in full
     (`payWorkingOrder`, `apps/server/src/testing/whole-payment-fixture.ts`): recall refuses
     `bill.paid`, nothing written.
  6. **Changes after sending reads Requested as held.** Grill waits; Grill's changes-after-sending
     set to `"held"` (`setChangesAfterSending`, `testing/changes-after-sending.ts:5`): a Requested
     burger recalls. Set to `"never"`: recall refuses `ticket.already_fired`, nothing written.
  7. **A recalled source cannot be served or fired by a sent-group action** (review 1, I7; master
     T8's second test bullet; B1 pinned only the legacy-recall half, D20). Bottled water routed to
     Bar (`setRoutingCell`, as `kitchen-request.release.test.ts:177-182`), Grill waits; one Fire now
     group of a burger (Requested) and a water (released at Bar); recall the burger into the draft
     (assert its `order_draft_recalled_lines` row). Then `markGroupServed` of the group, and
     `fireOrderLines` naming both lines: the burger's line `servedQuantity` 0 and no ticket item for
     it; the water's line served (1000), which shows the group action ran; every printer's job
     count unchanged. Uses a released water so the case does not depend on B2.1. The
     `fireOrderLines` half covers the master's T8 wording and has no failing mutation: a recalled
     dish has no ticket item and its `sent_at` is set, so neither `releaseHeld` nor
     `heldNoRouteLines` (`working-order.ts:2494-2495`) picks it up (round 3, M2; read, not run).
     Only the serving half has a control.
  (Legacy `recallLines` of a Requested dish is already pinned by B1:
  `kitchen-request.send.test.ts:377`.)
- [ ] **RED (all pins).** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.recall.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/bill-editing.commands.test.ts -t 'A773'`
  (name case 3 with "A773 requested lifecycle" so the filter selects it alone): every case passes;
  say so in the commit.
- [ ] **GREEN.** Unfiltered `src/draft-recall.test.ts`, `src/draft-recall-legacy.test.ts`,
  `src/draft-recall-split.test.ts`, `src/draft-recall-adjustments.test.ts`,
  `src/draft-recall.modifiers.test.ts`, `src/changes-after-sending.test.ts`,
  `src/kitchen-request.send.test.ts`, `src/bill-editing.commands.test.ts`; typecheck; format check.
- [ ] **Mutation controls:** `draft-recall.ts`' RECALLED filter widened to every item
  (`items` instead of `items.filter((item) => item.firedAt !== null)`) → case 1 red;
  `requestStamps` ignoring `waits` → case 2 red; the other-editor check in `requireBillEditor`
  removed (`bill-editing.ts:218`, `if (edit.editorId !== null && edit.editorId !== operatorId)
  throw editorConflict(edit)`) → case 3 red; the started check removed → case 4 red;
  `requireBillOfParty` skipped → case 5 red; `refuseChangesAfterSending` passing
  `firedAt: item.firedAt ?? "x"` → case 6's `"held"` half red; `servableLines` without
  `not(isRecalledDish(tx))` (`working-order.ts:3685`) → case 7 red.
- [ ] **Measured at planning** (throwaway test files, mutations reverted, files deleted): case 3 on
  the unmodified tree passed with `draft.taken_over`. **Neither suggested control for it can fail**:
  "`requireBillEditor` moved after the item delete" (the plan's first version) leaves the case green
  because a refused write is rolled back whatever its order (review 1's derivation; not run here),
  and "`requireBillEditor` removed from
  `recallToDraft`" (review 1's suggestion) also stayed green (`Tests 1 passed`) because
  `acquireBillEditor`, which the recall calls before any delete, calls `requireBillEditor` again
  (`bill-editing.ts:23`). Removing the check inside `requireBillEditor` turned case 3 red: the recall
  went on and failed with `UNIQUE constraint failed: order_drafts.bill_id`, not an `AppError`. Case
  7 passed on the unmodified tree (burger line `servedQuantity` 0, water 1000, no new job); with
  `not(isRecalledDish(tx))` removed it went red (`expected 1000 to be +0`: the recalled burger was
  served).
- [ ] **Commit.** `git commit -s -m "Pin recalling a dish that waits for the pass: no kitchen slip, and the same refusals"`.

## Task B2.2b: an edit keeps each record's phase (about 55 calls)

**Files.** Modify `apps/server/src/working-order.ts`: `fireLines` options (`:2106-2112`) and its
call into `insertSplitExtras`, `insertSplitExtras` (search the name; it stamps extras with
`requestStamps`), `applyLineEdits`' "change" path (`:6337-6362`) and, only if case 4 goes red,
`readEditableOrder`'s `firedCourseIds` (`:5746-5753`). Create
`apps/server/src/kitchen-request.edit.test.ts`.

**Interfaces.**

```ts
// fireLines(…, options) gains:
keepReleased?: ReadonlySet<string>; // line ids whose re-sent record keeps its release (D22)
keepRequestedAt?: ReadonlyMap<string, string>; // line id → a re-sent Requested record's first request time (D22)
```

At the "change" path, for the parent and each kept child whose deleted `ticket.firedAt` is set,
add its line id to `keepReleased`; for each whose deleted ticket was Requested (`requestedAt` set,
`firedAt` null), add line id → that `requestedAt` to `keepRequestedAt`; pass both to `fireLines`.
Inside, a line in `keepReleased` is stamped with `waits: false`; a line in `keepRequestedAt` whose
new stamps come back Requested takes the kept `requestedAt`; `insertSplitExtras` does the same for
an extra in either. Nothing else reads them.

- [ ] **Failing tests and pins** (`describe("A773 requested lifecycle: edit")`;
  `setupSplitExtrasVenue`; copy the `line`, `slips` and `edit` helpers of
  `src/split-off-extras.edit.test.ts:46-55,82-112`):
  1. **A released dish's change edit keeps its release.** Nothing waits; `addTabRound` a burger;
     then Grill waits; `edit(tx, venue, 1, { note: "No salt" })`: the new item has `firedAt` =
     `requestedAt` = the edit's time and `passControlled` false; Grill's printer gains a RECALLED
     slip and then a ticket for the burger, as with nothing waiting. Fails today (probe P3: the new
     item Requested, no new ticket).
  2. **Each record keeps its own phase.** Fake `Date` at `AT` (as `kitchen-request.release.test.ts`
     does); Grill waits, Fryer does not; `addTabRound` a burger with chips (burger Requested at
     `AT`, chips released); then Fryer waits too; `vi.setSystemTime(LATER)`; edit the burger's
     note: the edit takes "change" (the chips' record is fired); the burger comes back Requested
     with `requestedAt` = `AT`, its first request time (review 1, M3), not `LATER`; the chips come
     back released (`firedAt` = `LATER`) and print at Fryer after a RECALLED slip; no Grill or Pass
     job for the burger. Fails today on the chips (Requested, probe P3's shape) and, derived from
     `requestStamps` stamping the write's time (`kitchen-release.ts:34`), on the burger's
     `requestedAt` (`LATER`).
  3. **A Requested dish's edit is in place (pin).** Grill waits; `addTabRound` a burger
     (Requested); edit its note: same ticket item id, still Requested with its first
     `requestedAt`, its `note` updated, no job at any printer (the "free" path, `:6363-6368`).
  4. **The edited order's course test (D23; measured here first).** Starters and Mains courses
     (`createCourse`, Starters first), Grill waits; `addTabRound` a Starters burger and a Mains
     burger, both `release: true` (both Requested); then one `updateHeldOrder`
     (`testing/order-writer-fixture.ts:107`) that keeps the Starters burger, removes the Mains
     burger and adds a new Mains burger: the new burger is Requested, not held. Read the
     `updateHeldOrder` contract first; if no single call can both remove and add, or the case
     passes before the change, record which in the commit, keep it as a pin, and leave
     `firedCourseIds` unchanged (D23 lands only on a red case).
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.edit.test.ts`:
  cases 1 and 2 fail as described; 3 passes (pin); 4 as measured.
- [ ] **Minimal implementation** as "Interfaces" (and D23 if case 4 was red).
- [ ] **GREEN.** RED unfiltered; unfiltered `src/split-off-extras.edit.test.ts` (`:128` and `:150`
  keep RECALLED then re-send with nothing waiting), `src/kitchen-request.extras.test.ts` (`:306`,
  `:332`), `src/kitchen-request.send.test.ts`, `src/bill-editing.order-writers.test.ts`,
  `src/tabs.test.ts`, `src/working-order.test.ts`; typecheck; format check.
- [ ] **Mutation controls:** `keepReleased` ignored in `fireLines` → case 1 red; ignored in
  `insertSplitExtras` → case 2's chips red; `keepReleased` filled for every deleted record (Requested
  too) → case 2's burger red (released); `keepRequestedAt` ignored → case 2's burger `requestedAt`
  red (`LATER`; this control can fail only because the edit runs at a later time than the send);
  the "free" path routed through "change" for Requested records → case 3 red (on the item id,
  which "change" replaces); if D23 landed, `firedCourseIds` back on `firedAt` → case 4 red. These
  controls are on code B2.2b writes and were not run at planning; the implementer runs each.
- [ ] **Commit.** `git commit -s -m "Keep a released dish released when an edit sends it again"`
  (body: D22, including that a re-sent dish keeps its first request time, and that Owner question 1
  asks the owner; D23's measured outcome).

## Task B2.3a: the cancellation context and cancelling a Requested dish (server, about 55 calls)

**Files.** Modify `apps/server/src/line-cancel-context.ts` (type `:12-25`, builder `:72-112`),
`apps/server/src/line-cancel-input.ts` (`:29-38`), `apps/server/src/line-cancel.ts` (keep-charge
corrections `:466-512`), `apps/server/src/dish-kitchen.ts` (`requestedAt` on `DishKitchenItem`).
Tests: `apps/server/src/line-cancel-context.test.ts` (two whole-shape pins gain the fields; new
cases), `apps/server/src/dish-kitchen.test.ts` (one whole-record pin gains `requestedAt`), `apps/server/src/line-cancel-api.test.ts` (malformed list `:1426-1458`
gains rows), create `apps/server/src/kitchen-request.cancel.test.ts`.

**Interfaces.**

```ts
// line-cancel-context.ts, each component
requestedAt: string | null; // ticket_items.requested_at; null with no item
stationId: string | null;   // ticket_items.station_id; null with no item
```

The parser requires both, as it requires `firedAt` (null or an ISO time; `stationId` null or a
UUID through the same `requireBodyUuid`-style check it uses for `id`), and rejects a missing one
with `invalid("expectedContext")`. `cancelItem`'s keep-charge HOLD correction list leaves out a
record whose item is Requested (`requestedAt !== null && firedAt === null`) when its group's
`holdPrintedAt` is null (D26); that needs `requestedAt` on the `work` rows the branch reads (from
`dishKitchenItems`, `apps/server/src/dish-kitchen.ts:6-46`: add `requestedAt` to `DishKitchenItem`
and its select; its other callers ignore the new field, but its own suite pins whole records:
`dish-kitchen.test.ts` "returns own work before extras and a dish served only by an extra"
(`:134-176`) compares with `toEqual`, so each expected record gains `requestedAt: null` — its
items are held — as a whole-shape pin gaining a field ("Changed test checks"; review 1, I1, whose
scratch run E2 saw it fail with `expected [ { …(12) }, { …(12) } ] to deeply equal [ { …(11) },
{ …(11) } ]`).

- [ ] **Failing tests and pins:**
  - `line-cancel-context.test.ts`, new `describe("A773 requested lifecycle")`, reusing the file's
    `fixture`/`read` helpers (`:68`, `:94`):
    1. **Held → Requested refuses.** Read the context of a held grouped dish; set the dish's
       station waiting (`setStationsWaitForPass`) and fire its group; `requireCancellationContext`
       (`line-cancel-context.ts:117`) with the old context, as the file's refusal cases call it
       (`line-cancel-context.test.ts:274-276`), refuses
       `tab.cancel_context_changed`. Fails today (probe P5).
    2. **A same-id station move refuses.** Read the context of a fired dish; move its item to
       another station with `moveDishesToStation` (`testing/order-writer-fixture.ts:192`), which
       keeps the item's id: the old context refuses. Fails today.
    3. **A release racing the dialog refuses (pin).** Read the context of a Requested dish; a
       direct update stands in for B3's release (`fired_at` = `queued_at` = a later time); the old
       context refuses. Passes today through `firedAt`.
    4. **The read carries the fields.** The two whole-shape pins (`:137-162`, `:185-200`) gain
       `requestedAt` and `stationId` on every component ("Changed test checks"); a Requested
       component reads `requestedAt` = its request time, `firedAt` null.
  - `line-cancel-api.test.ts` "refuses malformed component %s" (`:1426-1458`): two new rows,
    `requestedAt` missing and `stationId` missing, each refused `management.request_invalid`
    `{ field: "expectedContext" }` as the existing rows are.
  - `kitchen-request.cancel.test.ts`, `describe("A773 requested lifecycle: cancel")`, on
    `provisionAdjustmentVenue` (`testing/adjustment-venue.ts:312`) with `billWith(…, { release:
    "fire", shape: "grouped" })` (`:561`) and its station set waiting before the send; pay with
    `payWorkingOrder` as `line-cancel.test.ts:95-110` does; build the ask as `askFor`
    (`line-cancel.test.ts:115-133`):
    5. **Keep the charge on a paid Requested dish: no paper.** `cancelItem` with
       `outcome: "keep_charge"`: answers as today; no job at any printer and no kitchen notice.
       Fails today with a HOLD CANCELLED slip (finding 6; first measured here).
    6. **Keep the charge where the group's HOLD paper printed (pin).** The dish placed in a held
       group whose HOLD ticket printed at its station (the station prints held work:
       `testing/station-printing.ts`), then fired with the station waiting (Requested), paid, then
       cancelled keeping the charge: one HOLD CANCELLED slip at that station naming the group, as
       today.
    7. **Remove the charge on an unpaid Requested dish (pin).** `outcome: "remove_charge"`: the
       line's active quantity drops, nothing prints, no notice.
    8. **The adjustment's stage (pin, D27).** Case 5's adjustment row records stage `"unsent"`.
    9. **"Preparation started" cannot be claimed for a Requested dish (pin).** `preparationStarted:
       true` on case 7's dish refuses as `line-cancel.ts:141-146` does for a dish with no fired
       component.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/line-cancel-context.test.ts -t 'A773 requested lifecycle'`
  (1, 2 fail; 3 passes); the two edited whole-shape pins, run unfiltered, fail on the missing
  fields before the builder changes; `pnpm --filter @waitron/server exec vitest run src/line-cancel-api.test.ts -t 'malformed component'`
  (the two new rows fail: today's parser knows neither key, so a body without one is accepted
  rather than refused); `pnpm --filter @waitron/server exec vitest run src/kitchen-request.cancel.test.ts`
  (5 fails; 6–9 pass).
- [ ] **Minimal implementation** as "Interfaces".
- [ ] **GREEN.** RED unfiltered; unfiltered `src/line-cancel.test.ts`, `src/line-cancel-api.test.ts`,
  `src/split-off-extras.cancel.test.ts`, `src/order-portions.adjustments.test.ts`,
  `src/collect-at-counter.test.ts`, `src/tender-refund-links.test.ts`,
  `src/finish-party-service.test.ts`, `src/draft-recall.test.ts` (another `dishKitchenItems`
  caller), `src/dish-kitchen.test.ts` (the whole-record pin above), `src/move-dishes.test.ts`; the
  fiscal pair, unedited;
  `pnpm exec vitest run scripts/personal-log-params.test.ts` (its `CancellationContext` entry,
  `:42-45`, already omits `firedAt`; no edit expected — an edit there is a stop); typecheck; format
  check.
- [ ] **Mutation controls:** builder drops `requestedAt` (always null) → case 1 red; drops
  `stationId` → case 2 red; builder drops `firedAt` → case 3 red; parser defaults a missing
  `requestedAt` to null → its malformed row red; keep-charge filter removed → case 5 red; filter
  also dropping records whose group's HOLD printed → case 6 red.
- [ ] **Commit.** `git commit -s -m "Refuse a stale cancel when a dish starts waiting for the pass or changes station, and print nothing for it"`
  (body: the two context fields are a contract the till must send back, landing in B2.3b; the
  HOLD CANCELLED slip that was printed for work that never printed).

## Task B2.3b: the till's twin of the cancellation context (about 40 calls)

**Files.** Modify `apps/till/src/api/line-cancel-types.ts` (`:3-16`),
`apps/till/src/widgets/cancel-item-dialog.ts` (`consentKey` `:55-78`), `apps/till/src/till-app.ts`
(`sameFinishContext` `:1091-1115`). Fixtures gain the two fields (typecheck): the hand-built
contexts in `widgets/cancel-item-dialog.test.ts` (`read` helper `:32-54`, and `:380-387`,
`:703-716`), `widgets/cancel-item-dialog.unsaved.test.ts:13-33`,
`widgets/cancel-item-reasons.test.ts:22`, `widgets/cancel-item-dialog.a11y.test.ts:25`,
`widgets/cancel-item-preparation.test.ts:25`, `widgets/finish-table-dialog.test.ts:24`,
`widgets/finish-table-dialog.unsaved.test.ts:15-38`, `widgets/finish-table-dialog.a11y.test.ts:35-55`,
`api/line-cancel-client.test.ts:5-20`, `api/client.test.ts:3774-3797`,
`till-app-adjustments.test.ts:1480-1498`, `till-app-handheld-pay.test.ts:3507-3523`,
`till-app-parties.test.ts:12666-12683` (all under `apps/till/src/`; the list is the research
pass's, so let `pnpm --filter @waitron/till typecheck` find any it missed).

- [ ] **Failing tests:**
  1. `widgets/cancel-item-dialog.test.ts` "a changed %s refresh requires fresh money consent"
     (`:416-447`): two new rows, `requestedAt` and `stationId`. They fail until `consentKey` lists
     the fields.
  2. A new case beside the file that covers Finish consent (`rg -n sameFinishContext
     apps/till/src` names only `till-app.ts:1091,16135,16253`; find the test that reaches `:16135`
     with `rg -n 'finish' apps/till/src/till-app-parties.test.ts | head`): a refreshed Finish read
     whose only change is one component's `requestedAt` (then, separately, `stationId`) asks for
     consent again. Fails until `sameFinishContext` lists them. If no existing test reaches
     `:16135`, write the case in `till-app-parties.test.ts` beside the nearest Finish case and say
     so.
- [ ] **Memory first.** `memory_pressure | grep free`; run the browser suites only well above 15%
  free and not beside another browser run.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/widgets/cancel-item-dialog.test.ts -t 'fresh money consent'`
  and the Finish case's file with `-t` on its name.
- [ ] **Minimal implementation:** the type's two fields; both field lists.
- [ ] **GREEN.** `pnpm --filter @waitron/till typecheck`; unfiltered
  `src/widgets/cancel-item-dialog.test.ts`, `src/widgets/cancel-item-dialog.unsaved.test.ts`,
  `src/widgets/cancel-item-dialog.a11y.test.ts`, `src/widgets/cancel-item-preparation.test.ts`,
  `src/widgets/cancel-item-reasons.test.ts`, `src/widgets/finish-table-dialog.test.ts`,
  `src/widgets/finish-table-dialog.unsaved.test.ts`, `src/widgets/finish-table-dialog.a11y.test.ts`,
  `src/api/line-cancel-client.test.ts`; the file holding case 2 unfiltered; format check.
- [ ] **Mutation controls:** `consentKey` without `requestedAt` → its row red; without `stationId` →
  its row red; `sameFinishContext` without either → case 2 red.
- [ ] **Commit.** `git commit -s -m "Send back the station and request time with a cancel, so the till asks again when either changed"`.

## Task B2.4: finishing a table with dishes in every phase (pins, about 30 calls)

**Files.** Add a `describe("A773 requested lifecycle")` to
`apps/server/src/finish-party-service.test.ts`, reusing its `fixture` (`:59`), `snapshot` (`:105`)
and `confirm` (`:131`) helpers. No product change planned; a red case is a stop (D28 would be
wrong). Depends on B2.3a (case 2 needs `requestedAt` in the context).

- [ ] **Pins:**
  1. **Held, Requested, waiting and ready, in one Finish.** A paid party with four unserved dishes:
     one in a held group; one Requested (its station waiting before a Fire now); one released and
     queued; one released and advanced to `ready`. `finishPartyService` with the four contexts
     read at confirmation: answers once; the four lines are cancelled keeping the charge; the party
     is closed; the answer's refund links match what the same Finish with nothing waiting answers
     (run that twin in the case, on a second party), compared by count and by the cancelled line's
     position on its bill, since each party's `adjustmentId`s differ (review 1, M9); every component in the read contexts carries
     `requestedAt` and `stationId`; jobs: for the waiting, ready and held dishes exactly what the
     twin prints for them, and nothing for the Requested one (B2.3a's fix); the
     "preparation started" answer is not required (no component of the Requested dish is fired).
  2. **A race only the new field catches.** Read the Finish contexts while a dish is held; fire its
     group with its station waiting (Requested); confirm with the old contexts: refused
     `party.unserved_dishes` (`finish-party-service.ts:191-193`), and `snapshot` identical before
     and after.
  (The first version's case 3, "one transaction", is dropped (review 1, I3): `finish` compares
  every context before cancelling any dish (`finish-party-service.ts:181-193`, then the cancel loop
  `:194-226`), so a stale fourth context refuses before any write and the case duplicated case 2;
  and its control, "each dish cancelled in its own `withTransaction` inside `finish`", cannot be
  written, because `finish` receives `tx` and holds no database handle. Atomicity is the
  transaction's, whatever a dish's phase (D28), and the existing case "rolls back earlier dish
  cancellations if a later reason is refused" (`finish-party-service.test.ts:218`) pins it; GREEN
  runs it.)
- [ ] **RED (all pins).** `pnpm --filter @waitron/server exec vitest run src/finish-party-service.test.ts -t 'A773 requested lifecycle'`:
  all pass; say so in the commit.
- [ ] **GREEN.** Unfiltered `src/finish-party-service.test.ts`, `src/finish-party-collect.test.ts`,
  `src/kitchen-request.cancel.test.ts`; the fiscal pair, unedited; typecheck; format check.
- [ ] **Mutation controls:** `finish` leaving out of `dishes` every dish none of whose context
  components has `firedAt` set (a filter before the compare, the tempting "only released work"
  reading) → case 1 red (the confirmation then lists more dishes than `dishes` and is refused); the
  context builder dropping `requestedAt` (B2.3a's field) → case 2 red.
- [ ] **Commit.** `git commit -s -m "Pin finishing a table whose dishes wait for the pass"`.

## Task B2.5a: station moves and closing (pins, about 35 calls)

**Files.** Create `apps/server/src/kitchen-request.move.test.ts`. No product change planned; a red
case is a stop.

- [ ] **Pins** (`describe("A773 requested lifecycle: station move")`; `setupSplitExtrasVenue`;
  moves through `moveDishesToStation` (`testing/order-writer-fixture.ts:192`); every printer's job
  count before and after):
  1. **Requested moved to a station that waits and to one that does not.** Grill waits; a Fire now
     burger; move it to Kitchen with Kitchen waiting: `stationId` Kitchen, `requestedAt` unchanged,
     `firedAt` null, `passControlled` true, a `ticket_item_moves` row; no job anywhere. Then move it
     to Bar, which does not wait: the same, still Requested (master Contract 2: "even to an
     immediate station").
  2. **Released work is never re-held.** Nothing waits; a released burger; Kitchen set to wait;
     move it to Kitchen: `firedAt` kept, never Requested, and Kitchen gets its FIRE ticket "from
     Grill" as today.
  3. **Station closing's "send" moves Requested work (D29).** Grill waits; a Requested burger; close
     Grill choosing to send its open dishes to Kitchen (`withStationDishes`,
     `apps/server/src/station-closing.ts:42-100`, choice `send`, as
     `till-api.station-today.test.ts:307` drives it): the burger at Kitchen, still Requested, no
     job. Closing's "leave" choice is not pinned here: it sets `stationRetainedAtRelease` on the
     item (`station-closing.ts:92`), which only the pass's release reads, so it is handed to B3
     (review 1, M9; "Left for B3").
  4. **Department transfer lists Requested work (D37).** `GET /api/department-transfers/:id`
     (`department-transfer-api.ts:245`, its `outstandingWork` read `:293-314`), driven as
     `department-transfer-api.test.ts` drives it (read its setup first), lists the Requested item
     with state `queued`.
  5. **A Requested dish never moves into a held group (D31).** `moveLinesToGroup`
     (`order-groups.ts:1036`) naming a Requested burger's line and a held group refuses
     `group.not_held`, nothing written.
- [ ] **RED (all pins).** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.move.test.ts`:
  all pass.
- [ ] **GREEN.** Unfiltered `src/station-move.test.ts`, `src/till-api.station-move.test.ts`,
  `src/device-api.station-move.test.ts`, `src/till-api.station-today.test.ts`,
  `src/management-api.station-disable.test.ts`, `src/department-transfer-api.test.ts`,
  `src/order-groups.test.ts`; typecheck; format check.
- [ ] **Mutation controls:** the move's update also setting `firedAt: at` → case 1 red; the
  destination FIRE ticket printed for every moved row → case 1 red; the update clearing
  `firedAt` for a destination that waits → case 2 red; `withStationDishes` filtering
  `isNotNull(firedAt)` → case 3 red; `outstandingWork` filtering `isNotNull(firedAt)` → case 4 red;
  `moveLinesToGroup`'s source-group check removed → case 5 red.
- [ ] **Commit.** `git commit -s -m "Pin moving a dish that waits for the pass between stations"`.

## Task B2.5b: bill moves and arrival (about 60 calls)

**Files.** Modify `apps/server/src/working-order.ts` (`carveLines`' `refuseHeld` test
`:4679-4687`, and the line select feeding it `:4627-4628`, which gains `ticketRequestedAt`) and
`apps/server/src/order-groups.ts` (`groupArrivingDishes` `:2463-2561`: its select `:2480` gains
`ticketRequestedAt`, its classification `:2505-2513` uses `serviceRequested`; its `firing` list
`:2515-2518` is unchanged, D31). Create `apps/server/src/kitchen-request.bill-move.test.ts`
(cases 1–4); add a `describe("A773 requested lifecycle: arrival")` to
`apps/server/src/party-arriving-dishes.test.ts` (cases 5 and 5b, which need its courses and
`move` helper). Fixture fixes listed in "Changed test checks" (arrival rows).

- [ ] **Failing tests and pins** (`describe("A773 requested lifecycle: bill move")`;
  `setupSplitExtrasVenue`; bill actions through `testing/bill-action-fixture.ts`):
  1. **Split bill takes a Requested dish.** Grill waits; a Fire now group of two burgers;
     `splitBill` line 2 to a new bill: answers; the new bill's item has the old item's
     `requestedAt`, `firedAt` null, `passControlled` true, and its station; no job. Fails today
     (`tab.split_held_line`, probe P2).
  2. **Move dishes to a new bill takes a Requested dish.** As case 1 through `moveDishes` with no
     target bill. Fails today the same way.
  3. **Moves to an existing bill keep the stamps (pins).** `moveDishes` to an existing bill of the
     party, `transferItems` and `mergeBills`: each moved Requested item keeps its stamps, no job.
  4. **A genuinely held dish outside a held group is still refused (pin).** `addTabRound` a burger
     with `hold: true` on the party's tab; `splitBill` it: `tab.split_held_line`, as
     `move-dishes.test.ts:1151-1161` asserts for `moveDishes`.
  5. **An arriving Requested dish in a course held until fired, on its own** (in
     `party-arriving-dishes.test.ts`, whose venue is shared across cases, `resetPerTest: false`, so
     the case restores every setting it changes in a `finally`, as B1's `everyStationWaiting` does at
     `party-move-bill.test.ts:1188`; review 1, I4 and M9). Every station waits, prints held work
     (`setStationPrinting(tx, { printHeldWork: true })`) and has one printer attached (a printer is
     what makes "no job" able to fail: without one, today's HOLD ticket has nowhere to print). Seat
     Ana; `addTabRound` one Flan in Postres (a course held until fired; `createCourse` defaults
     `heldUntilFired` to true, `kitchen.ts:312`): with no earlier course it is sent at once and,
     its station waiting, comes back Requested (assert `firedAt` null, `passControlled` true).
     Seat Luis at another table; `nextMillisecond()`; move Ana's bill to Luis's table. Luis's party
     has exactly one group, `{ state: "fired", firedAt: <the Flan's requestedAt> }`; the Flan's item
     is identical; no new print job. Fails today (measured): one group `{ state: "held", firedAt:
     null }` and one job, `*** EN ESPERA ***` (HOLD).
  5b. **Beside an earlier released dish (pin of the dating rule, D31).** Same file and restoring
     rule. Nothing waits; Ana's tab gets a Burger in Entrantes and a Flan in Postres (`addTabRound`:
     the Burger released, the Flan held behind its course); `nextMillisecond()`; every station waits;
     `fireOrderLines` naming the Flan's line (a waiter's fire: Requested; assert its `requestedAt`
     is later than the Burger's `firedAt`); move the bill to Luis's table: one group, `{ state:
     "fired", firedAt: <the Burger's firedAt> }`, holding both lines — the earliest line dates it
     (`order-groups.ts:2576-2579`). Fails today (the Flan lands in a held group); with D31 it
     passes.
  6. **Arrival outside a held course (pin, cite).** B1's `party-move-bill.test.ts` "A773 waiter
     request" cases (`:1187-1281`) already pin that it stays Requested; run them in GREEN.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.bill-move.test.ts`:
  1 and 2 fail as described; 3 and 4 pass (pins; 3's existing-bill moves already keep stamps). Then
  `pnpm --filter @waitron/server exec vitest run src/party-arriving-dishes.test.ts -t 'A773 requested lifecycle'`:
  5 and 5b fail (held group).
- [ ] **Minimal implementation** as "Files". Then run the arrival suites: the three fixtures that
  clear only `firedAt` before an arrival (`party-arriving-dishes.test.ts:760`,
  `attendance-arriving-groups.test.ts:172`, `order-groups.request-kind.test.ts:241`) are expected to
  go red, because their row now reads Requested (review 1's scratch run E3 saw all three go red);
  add `requestedAt: null` to each `.set` (D39) and record them in the commit. A red assertion
  anywhere else is a stop.
- [ ] **GREEN.** RED unfiltered; unfiltered `src/move-dishes.test.ts`, `src/till-api.move-dishes.test.ts`,
  `src/split-bill.test.ts`, `src/split-off-extras.split.test.ts`, `src/party-move-bill.test.ts`,
  `src/till-api.move-bill.test.ts`, `src/party-arriving-dishes.test.ts`,
  `src/party-arriving-inactive-course.test.ts`, `src/attendance-arriving-groups.test.ts`,
  `src/order-groups.request-kind.test.ts`, `src/kitchen-delete.integration.test.ts` (master T8),
  `src/kitchen-request.release.test.ts`; typecheck; format check.
- [ ] **Mutation controls:** `refuseHeld` back on `ticketFiredAt === null` → cases 1, 2 red;
  `refuseHeld` dropped entirely → case 4 red; `groupArrivingDishes` back on `isReleased` → cases 5
  and 5b red; the arrival's `firing` date for a released-or-Requested line taken from the write's
  time (`new Date().toISOString()`) instead of `ticketFiredAt ?? sentAt` → case 5 red on the
  group's `firedAt` assertion (case 5 has the Requested dish as its only arriving line, so the
  group's earliest time is the Flan's own; review 1, I4; round 3's E16). Case 5 has no routing
  time: nothing in it is immediate, so `routing` is `undefined`. A `TypeError` (for example from
  `routing!.at`, round 3's E17) does not count as this control going red; `groupArrived` choosing
  its **latest** line instead of its earliest (`>` for `<` at `order-groups.ts:2578`) → case 5b
  red while case 5 stays green (measured in round 3, E18).
- [ ] **Measured at planning** (a throwaway test file on `setupPartyVenue` with Entrantes and
  Postres, a minimal D31 applied to `order-groups.ts` and a minimal `serviceRequested` to
  `working-order.ts`, all reverted and the file deleted): with the change, case 5 passed (the
  Flan's `requestedAt` and `sentAt` both `2026-11-01T21:45:16.634Z`, the group `fired` at that
  time, no job) and case 5b passed (group `firedAt` `…16.674Z` = the Burger's fire time, the Flan
  requested at `…16.681Z`); the date taken from `new Date()` → case 5 red; on the unmodified tree
  case 5 was red with a `held` group and one `*** EN ESPERA ***` job. The first version's control
  (routing time against the plan's two-dish setup) could not fail: the earlier Burger set the
  group's time either way.
- [ ] **Commit.** `git commit -s -m "Let a dish that waits for the pass move to another bill or party without being held again"`.

## Task B2.6a: group readiness and the floor's counts (about 50 calls)

**Files.** Modify `apps/server/src/order-groups.ts` (`listOrderGroups`' kitchen count
`:1513-1529`), `apps/server/src/order-state-counts.ts` (`KitchenPart.ticket` gains `requestedAt`,
its select near `:124`, `dishCounts` `:49-84`). `rest-of-order.ts` is **not** changed (D33, Owner
question 4). Create `apps/server/src/kitchen-request.readers.test.ts`. Fixture fixes in
`order-state-counts.test.ts` and `department-transfer-api.test.ts` ("Changed test checks").

**Interfaces.** No exported signature changes beyond `KitchenPart.ticket.requestedAt:
string | null`. Readiness: `remaining` counts items matching `initiatedItem()`; `ready` keeps
`madeHere or state = 'ready'`, and a Requested item's state is `queued`, so it never counts ready.
`dishCounts`: held when a part is genuinely held (`initiatedAt(ticket) === null`) or the group is
held (made-here dish excepted, as today); waiting when a not-made-here part is initiated and queued
or preparing. The rest of the order keeps `held: firedAt === null` (D33).

- [ ] **Failing tests and pins** (`describe("A773 requested lifecycle: readers")`;
  `setupSplitExtrasVenue`; Bar routing as in B2.1 case 3):
  1. **A Requested part keeps its group out of ready (D32).** Grill waits; a Fire now group of a
     burger (Requested) and a Bar drink (released); advance the drink to ready
     (`advanceTicketItem`): `listOrderGroups` (`order-groups.ts:1470`) gives the group **no
     `ready` key** — the wire adds `ready: true` only when ready and never sends `ready: false`
     (`order-groups.ts:1560`; review 1, M1). Then a direct update standing in for B3's release, and
     the burger advanced to ready: `ready: true`. Fails today on the first half.
  2. **Floor counts (D33).** `readOrderStateCounts` (`order-state-counts.ts:98`): a Requested burger
     → `waiting: 1, held: 0`; a released burger whose chips are Requested → `waiting: 1`; a burger in
     a held group → `held: 1`. Fails today on the first two (probe P6 printed `held: 1`).
  3. **Held counts (pin).** `readHeldCounts` (`order-groups.ts:1715`) for case 1's party counts no
     held line.
  4. **Release reminder waits for a Requested dish to be served (pin).** A fired group holding a
     Requested burger, then a held group; `readReleaseReminders` (`order-groups.ts:1637`) gives the
     held group `dueAt: null` until the burger is served (B2.1's serving), then a due time.
  5. **Floor signals (pin, D33, Owner question 2).** `readPartySignals`
     (`apps/server/src/table-signals.ts:172`) for a party whose only dish is a Requested burger,
     its request time an hour ago (frozen clock): no `ready` and no `long_wait` signal.
  6. **Rest of the order keeps HELD for a Requested dish (pin, D33, Owner question 4; review 1,
     I5).** Bar routing as above, Grill waits; a Fire now group of a burger (Requested) and a water
     (released at Bar): `readRestOfOrder` (`rest-of-order.ts:52`) gives the burger's entry
     `held: true` and the water's `held: false`. Passes today (measured, below). Its two consumers
     are the printed ticket's "Also on order" (`kitchen-ticket.ts:395`, via `kitchen-print.ts:659`)
     and the station queue's `rest` entries (`working-order.ts:8235`); both read this one field.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.readers.test.ts`:
  1 and 2 fail as described; 3, 4, 5 and 6 pass (pins).
- [ ] **Minimal implementation** as "Interfaces". Then:
  - `src/order-state-counts.test.ts` "counts a ready dish waiting while its extra is queued …, and
    held while the extra is unfired" (`:727`, fixture `:738`) is expected to go red because its
    fixture clears only `firedAt`; add `requestedAt: null` (D39). Every ticket literal in that file
    gains `requestedAt` to satisfy the type, equal to its `firedAt` (`null` for held parts, the fire
    time for released ones): the `dish()` builder's ticket (`:240`), `unfired` (`:245`),
    `readyHere` (`:246`), and the in-case literals `preparing` (`:307`), `ready` and `queued`
    (`:316-317`) and `ready` (`:326`) (review 1, M2; `rg -n "madeHere:"` in the file lists exactly
    these, plus the `.set` at `:750`, which is an update, not a literal); no expected count changes.
  - `src/department-transfer-api.test.ts`: the fixture at `:1974`
    (`.set(item.name === "Burger" ? { firedAt: null } : { state: "ready" })`) makes the Burger
    "held" by clearing `firedAt` alone, which since B1 leaves it Requested, so `dishCounts` now
    counts it waiting and `HELD_AND_READY` (`:1954`) fails in three cases — "carries counts for the
    tab's dishes on the receiving desk's incoming row", "carries counts on the source's sent and
    per-tab rows while pending and after a decline", "drops counts from a sent row whose tab left
    the viewer's zones" (review 1's scratch run E2) — at `:1986`, `:1996` and the third; the
    `.set`'s Burger branch gains `requestedAt: null` (D39). No assertion changes.
  - `src/kitchen-print.test.ts:2984` ("A803 portion grouping: Also on order keeps a held portion
    apart…") is **not** expected to change any more: its red in E2/E3 came from the rest of the
    order's `held`, which B2 no longer changes; a red there is a stop.
- [ ] **GREEN.** RED unfiltered; unfiltered `src/order-groups.test.ts` (its readiness table
  `:3627-3745` unchanged: none of its rows is Requested), `src/order-state-counts.test.ts`,
  `src/department-transfer-api.test.ts` (review 1, I1: B2.6a is the task that turns it red),
  `src/table-signals.test.ts`, `src/table-signals.service-lifetime.test.ts`,
  `src/current-orders.test.ts`, `src/rest-of-order.test.ts`, `src/kitchen-print.test.ts`,
  `src/kitchen-request.send.test.ts`; typecheck; format check.
- [ ] **Mutation controls:** readiness `remaining` back on `isNotNull(firedAt)` → case 1 red;
  `ready` also accepting `requestedItem()` → case 1's first half red;
  `dishCounts` held test back on `firedAt === null` → case 2 red; waiting requiring `firedAt` → case
  2 red (the Requested burger falls to `ready`); `readHeldCounts` counting fired groups → case 3
  red; reminders ignoring fired groups' unserved dishes → case 4 red; `readKitchenLines` on
  `initiatedItem()` → case 5 red; the rest of the order reading initiation
  (`held: (row.requestedAt ?? row.firedAt) === null`, with `requestedAt` selected) → case 6 red.
- [ ] **Measured at planning** (throwaway test file, mutation reverted, file deleted): case 6 passed
  on the unmodified tree (`[["H2O",false],["BURG",true]]`); with the rest of the order reading
  initiation it went red (`expected false to be true`).
- [ ] **Commit.** `git commit -s -m "Count a dish that waits for the pass as asked for, not held, in group readiness and floor counts"`.

## Task B2.6b: output alerts, station deletion and an edit's slips (about 50 calls)

**Files.** Modify `apps/server/src/pass-board.ts` (`firedPassDishes`, the `gte(firedAt, since)` at
`:180`), `apps/server/src/station-outputs-down.ts` (only `passScreensDark`'s doc comment,
`:200-203`, which says "A held dish has no firing time, so it never counts"; keep it true of held,
say Requested counts), `apps/server/src/working-order.ts` (`applyLineEdits`' "drop" VOID `:6236`;
`releaseHeld`'s return `:2584`, `:2621`). Create `apps/server/src/kitchen-request.alerts.test.ts`.
Fixture fix in `station-outputs-down.test.ts:647`.

- [ ] **Failing tests and pins** (`describe("A773 requested lifecycle: alerts and slips")`):
  1. **The dark-pass alert counts a Requested dish (D34).** Reuse `station-outputs-down.test.ts`'
     `passScreensDark` setup (`:557-592`, read it first; its `waitingItem` places an order at
     `:130`): with the dish's station waiting, a Requested dish requested within the window makes an
     unseen pass screen listed. Fails today. A Requested dish requested over an hour ago does not
     count (as `:635` for a fired one).
  2. **The dark-station alert does not count it (pin, D34).** The same Requested dish at a station
     whose screen is dark (`station-outputs-down.test.ts:272`'s setup): no station alert.
  3. **Station deletion counts Requested work (pin).** `readStationDeleteImpact`
     (`station-delete.ts:150`, whose rules read `:60-78`) for Grill holding a Requested burger counts
     the burger as open work, as it counts a held one (`station-delete.test.ts:186` shows how the
     impact is read and asserted).
  4. **An edit's VOID skips a Requested dish.** Grill waits, Fryer does not; `addTabRound` a line of
     two burgers with chips (burgers Requested, chips released); edit the line's quantity down to
     one (`updateOrderLine`): no VOID at Grill or Pass; Fryer gets its correction for the chips as
     today. Fails today with a Grill VOID (`:6236`). If A803's one-dish-per-line rule makes a
     two-burger line impossible in this fixture, use the quantity form the edit suite uses for a
     drop (`rg -n '"drop"|quantity: "1"' src/split-off-extras.edit.test.ts`) and say so.
  5. **No HOLD CHANGED for a Requested dish in a fired group (pin).** Grill waits; a held group
     whose HOLD ticket printed at Grill (Grill prints held work), fired (burger Requested); edit the
     burger's note: no HOLD CHANGED job (`planHeldCorrections`, `working-order.ts:6666`, gates on
     `printedHeldGroups`, state `held`). D26 leaves this group's earlier HOLD paper uncorrected;
     when B3 builds the fired-group HOLD corrections on `heldPaperStations`, it may change this pin,
     and says so (review 1, M9; "Left for B3").
  6. **An order-note change sends nothing for a Requested dish (pin; review 1, M7).** The audit gave
     `enqueueOrderKitchenNoteChange` (`kitchen-print.ts:892-949`) to B2. Grill waits **and prints
     held work** (`setStationPrinting(tx, { printHeldWork: true }, [grill])`); bottled water routed
     to Bar; a Fire now group of a burger (Requested) and a water (released at Bar). Call
     `enqueueOrderKitchenNoteChange(tx, cfg, [tabId], { before: "Old", after: "New" })` directly:
     Bar gains one job and one kitchen notice (the released water's correction, which shows the
     call ran); Grill and Pass gain **no job and no kitchen notice** (read `kitchenNotices` from
     `@waitron/venue-service` and compare the new rows' `stationId`s with `[bar]`). The notice
     assertion is the one that can fail: measured, a widened filter sends the Requested burger as a
     HOLD-flavoured correction (its `firedAt` is null and it has a group, so `holdGroupId` is set at
     `:937`), which prints nothing at Grill because the group's HOLD ticket never printed, but does
     record a Grill notice. A jobs-only assertion stayed green under that mutation.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.alerts.test.ts`:
  1 and 4 fail; 2, 3, 5 and 6 pass (pins).
- [ ] **Minimal implementation:** `firedPassDishes` also takes `and(isNull(firedAt),
  gte(requestedAt, since))`; the drop VOID needs `parent.ticket.firedAt != null`; `releaseHeld`
  returns `Promise<void>` (D35). Then `src/station-outputs-down.test.ts` "does not count a held
  dish" (`:642`) goes red because its fixture clears only `firedAt` (`:647`); add
  `requestedAt: null` (D39).
- [ ] **GREEN.** RED unfiltered; unfiltered `src/station-outputs-down.test.ts` (its index-plan pin
  `:176` covers the station query, which is unchanged), `src/alert-sources.test.ts`,
  `src/pass-board.test.ts`, `src/station-delete.test.ts`, `src/management-api.kitchen-delete.test.ts`,
  `src/split-off-extras.edit.test.ts`, `src/order-kitchen-note.corrections.test.ts`,
  `src/kitchen-request.extras.test.ts`, `src/working-order.test.ts`; typecheck; format check.
- [ ] **Mutation controls:** `firedPassDishes` without the Requested branch → case 1 red; the
  Requested branch without the window → case 1's old-dish half red; `waitingDishesQuery` widened to
  Requested → case 2 red; `station-delete.ts:76` narrowed to `isNotNull(firedAt)` → case 3 red;
  drop VOID check removed → case 4 red; `planHeldCorrections` gating on `holdPrintedAt` alone →
  case 5 red; `enqueueOrderKitchenNoteChange`'s `isNotNull(ticketItems.firedAt)` widened to
  `or(isNotNull(firedAt), isNotNull(requestedAt))` (`kitchen-print.ts:924`) → case 6 red.
- [ ] **Measured at planning** (throwaway test file, mutation reverted, file deleted): case 6 passed
  on the unmodified tree (Bar jobs 1 → 2, new notices `[bar]`); with the widened filter it went red
  on the notices (`[grill, bar]`), while the job counts were identical to the unmodified run.
- [ ] **Commit.** `git commit -s -m "Count a dish that waits for the pass in the dark-pass alert, and print no void for it"`.

## Task B2.7: whole-branch run, backlog and the PR (no product change, about 45 calls)

- [ ] Rebase on current main (Task 0's command). Every B2 test file unfiltered, then each task's
  GREEN list once more; the B1 files (`kitchen-phase`, `kitchen-request.{send,extras,release,tab-send}`);
  the guard suites below; the fiscal pair. Read each `Tests` count and exit status.
- [ ] Re-run the controls a later task could have weakened: B2.1's `serviceRequested` and `extraHeld`
  controls, cases 9 and 10's included (B2.5b reuses `serviceRequested`), B2.3a's builder controls
  (B2.4 depends on them), and B2.5b's arrival controls on cases 5 and 5b; record each
  red-then-reverted run in the ledger.
- [ ] Settings-off comparison (what B1's reviews did): one throwaway test file scripts a table
  service with every station's setting false — Fire now, serve, recall to draft and resend, cancel,
  finish, split, arrival — and prints the `ticket_items`, `print_jobs` and kitchen-notice rows; the
  same file runs on this branch and at `2631b7bcc2` in a throwaway worktree
  (`git worktree add --detach "$(mktemp -d)/wt" 2631b7bcc2`, `pnpm install --frozen-lockfile`,
  `git worktree remove` after), and the two printouts must be equal. **Normalisation** (review 1,
  M5), because raw rows are never equal across runs: the script freezes `Date` at a fixed start
  and advances it by fixed steps, and seats fixed table labels, so times and labels repeat; then,
  before printing, every row id is replaced by `<table>#<n>`, its insertion order (`rowid`), and
  every column holding one of those ids is mapped through the same table; any remaining ISO time is
  masked as `<t>`; print payloads are decoded with `printedLines` and, in them, `hh:mm` times and
  `M-xxxxxxxx` table labels are masked. **What a failing comparison prints:** Vitest's `toEqual`
  diff on the two normalised printouts (the reference run's printout saved as a JSON file and read
  by the branch run), naming the first row and column that differ — an extra or missing
  `print_jobs` row, or a stamp such as `firedAt: "<t>"` against `null`. **Control** (§1: a
  measurement where both answers look alike measures nothing): run the branch side once more with
  one station's setting true; the diff must show that station's dish with `firedAt: null` and its
  ticket missing. Expected difference with every setting false: none. A difference is a stop.
- [ ] Re-run the consumer audit; confirm every hit B2 did not touch is assigned to B3, B4 or PR D,
  and add to the slice plan's "Left for B2 and B3" (renamed "Left for B3 and B4") this plan's
  hand-offs (see "Left for B3" below).
- [ ] Docs: no guide changes (nothing visible). Backlog: rewrite the A773-2 entry
  (`docs/backlog.md:88-94`; `docs/backlog/till.md` near `:2495`) to say B1 and B2 landed and B3–B4
  remain, linking this plan; add the four owner questions if unanswered.
- [ ] PR through `/finish-branch` with the worktree path and a note naming this plan and the ledger,
  FULL path, two Codex run-it reviews. Title: "A dish that waits for the pass can be served,
  recalled, cancelled and moved like any sent dish (A773-2 PR B2)". First line: "No venue reset and
  no migration." Body in plain English: nothing can switch a station's waiting on until PR C; the
  cancellation context's two new fields (till and server change together); D22's default and the
  four owner questions; D26's and D36's hand-offs to B3; every changed test check.
- [ ] Ledger `Status: done` for B2; next step: B3's task plan.

## Changed test checks (expected; the implementer confirms each)

| Check | Task | Change | Why it is allowed |
| --- | --- | --- | --- |
| `split-off-extras.release.test.ts` "refuses serving a sent water while its chips are held again" (`:214`), fixture `:220-225` | B2.1 | `.set({ firedAt: null })` gains `requestedAt: null` | D39: since B1 the chips carry a request time, so clearing `firedAt` alone makes them Requested, which D21 lets the water be served past; the case means "held again" and its assertion (`group.line_held`) is unchanged |
| `line-cancel-context.test.ts` "captures every dish component in stable kitchen-id order…" (`:118`, expected `:137-162`) and "captures a no-preparation dish and treats actual serving as started" (`:183`, expected `:185-200`) | B2.3a | each expected component gains `requestedAt` and `stationId` | a whole-shape pin gaining the master T8 contract fields (slice plan's "Changed test checks" row for B2); every other value unchanged |
| `line-cancel-api.test.ts` "refuses malformed component %s" (`:1426-1458`) | B2.3a | two new table rows | new cases; existing rows unchanged |
| `dish-kitchen.test.ts` "returns own work before extras and a dish served only by an extra" (`:134-176`) | B2.3a | each expected record gains `requestedAt: null` | a whole-shape pin (`toEqual`) gaining the field B2.3a adds to `DishKitchenItem`; the fixture's items are held, so `null`; every other value unchanged (review 1, I1; its run E2 saw this case fail on the key count) |
| Till hand-built cancellation contexts (13 files, B2.3b "Files") | B2.3b | each component literal gains `requestedAt: null, stationId: …` | adding what a fixture lacks so it typechecks; no assertion changes (`api/line-cancel-client.test.ts:76` echoes the same literal) |
| `apps/till/src/widgets/cancel-item-dialog.test.ts` "a changed %s refresh requires fresh money consent" (`:416-447`) | B2.3b | two new table rows | new cases |
| `party-arriving-dishes.test.ts:744` (fixture `:760`), `attendance-arriving-groups.test.ts:156` (fixture `:172`), `order-groups.request-kind.test.ts:224` (fixture `:241`) | B2.5b | `requestedAt: null` | D39: each makes an arriving dish held by clearing `firedAt`; under D31 a leftover request time makes it arrive initiated. All three are expected red (review 1's run E3 saw all three fail); one that stays green is left unedited and named in the commit |
| `order-state-counts.test.ts:727` (fixture `:738`) | B2.6a | `requestedAt: null` | D39 |
| `order-state-counts.test.ts` ticket literals: `dish()`'s ticket (`:240`), `unfired` (`:245`), `readyHere` (`:246`), and the in-case `preparing` (`:307`), `ready`/`queued` (`:316-317`), `ready` (`:326`) | B2.6a | each gains `requestedAt` equal to its `firedAt` | adding a field `KitchenPart.ticket` now requires, so the file typechecks; no expected count changes (review 1, M2) |
| `department-transfer-api.test.ts` fixture `:1974` (`.set(item.name === "Burger" ? { firedAt: null } : { state: "ready" })`), read by "carries counts for the tab's dishes on the receiving desk's incoming row", "carries counts on the source's sent and per-tab rows while pending and after a decline" and "drops counts from a sent row whose tab left the viewer's zones" (`HELD_AND_READY`, `:1954`) | B2.6a | the Burger branch gains `requestedAt: null` | D39: the Burger is meant held; since B1 clearing `firedAt` alone leaves it Requested, which D33 counts waiting (review 1, I1; its run E2 saw the three fail) |
| `station-outputs-down.test.ts:642` (fixture `:647`) | B2.6b | `requestedAt: null` | D39: "does not count a held dish" must use a held dish once D34 counts Requested |
| none else found | — | — | the remaining updates that clear `fired_at` (finding 11's search): `till-api.station-today.test.ts:166,241,281` and `management-api.station-disable.test.ts:168,265` (`:166`, `:281` and `:168` the conditional form `state === "held" ? { firedAt: null } : { state }`) feed station closing and station disabling's open-dish counts, whose readers no B2 task changes (read); `attendance-kitchen-service.test.ts:113` and `line-service-operations.test.ts:301,321` set `state: "held"` with it, for readers B2 does not change; `kitchen-request.send.test.ts:467` makes a Requested row on purpose. B2.5a runs the first two files and B2.7 every GREEN list again, so a surprise there is met, not assumed away; no longer listed: `kitchen-print.test.ts:2984`, whose only B2 cause was the rest-of-order change D33 now declines |

Not changed, contrary to the slice plan's guess: `finish-party-service.test.ts` and the other server
cancel suites take every context from `readCancellationContext`, never a hand-built literal, so
they pass the new fields through untouched. Run: `rg -n 'expectedContext:' apps/server/src --glob '*.test.ts'`
with the lines that call a read filtered out leaves four sites, each spreading or reading a
context (`line-cancel.test.ts:786,794`, `bill-editing.adjustments.test.ts:110`,
`line-cancel-api.test.ts:1416,1444`). `scripts/personal-log-params.test.ts` needs no edit (B2.3a GREEN runs it;
an edit there would be a stop: a guard under `scripts/`).

## Guard suites

Each run separately; read exit status and a nonzero `Tests` count.

- **Fiscal pair (B2.1, B2.3a, B2.4, B2.7), unedited:**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- **Code guards (B2.7):** `pnpm exec vitest run scripts/module-seams.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts scripts/write-path-tables.test.ts scripts/personal-log-params.test.ts`.
- **Schema guards: not needed** (no schema change). If any task touches `packages/db`, run the slice
  plan's "S" list and stop: that is outside this plan.

## Left for B3 by this plan

- **HOLD paper printed before the fire for work that became Requested** (D26): HOLD CANCELLED on
  draft recall, the remove-charge cancel and a station move, built on `heldPaperStations` for fired
  groups beside B3.4's FIRE marking. Today only the keep-charge cancel corrects it. When B3 builds
  the fired-group HOLD corrections it may change B2.6b case 5's "no HOLD CHANGED" pin, and says so.
- **The made-here extras mapping** (D36): which pass card and column shows the Requested extras of
  a made-here dish in a held group, and whether HOLD paper lists them (`printHoldTickets`,
  `heldItemsOf`, `correctJoin`, `readOnHoldTickets`, `enqueueOrderKitchenNoteChange` all read
  `isNull(firedAt)`).
- **`applyLineEdits`' late read of the next fire's kind** (D38), with B3.1's `request_kind` reader.
- **Showing "waiting for the pass"** in department transfers (D37) and current orders' `firedAt`
  for a Requested row (still null; `order-groups.ts:2017`), with B3.3's fields.
- **`stampSentOrderNumber` skips Requested items** (`working-order.ts:4127-4158`: no paper, no
  number); the pass's release must stamp the order number when it prints.
- **Station closing's "leave"** for a Requested item: it sets `stationRetainedAtRelease`
  (`station-closing.ts:92`), which only the pass's release reads (beside Contract 8's scope
  check); B3.4/B3.5 pin what the release does with it.
- **A release to a station whose output is down** (D34): whether the pass is warned before
  pressing Fire, since the closed-station printer-down alert rises only once the dish is released.
- **The rest of the order's wording** (D33, Owner question 4): if the owner chooses no "(on hold)" mark
  for a dish waiting for the pass, B3.3 or B4 changes `rest-of-order.ts:72` and inverts B2.6a
  case 6.
- **Races with the pass's release** (D40): Serve, cancel, Recall and moves against Fire, with
  promise barriers, in B3.5.
- **Owner questions 1–4** go with B3's copy sheet.

## Task list and sizes

Estimates are read, not measured.

| Task | What | Calls | Commit |
| --- | --- | --- | --- |
| 0 | Preflight | 15 | none |
| B2.1 | Serving a Requested dish (partial serving and pre-column rows included); money gates pinned | 80 | yes |
| B2.2a | Recall to the draft, and a recalled source left alone (pins) | 45 | yes |
| B2.2b | An edit keeps each record's phase and request time | 55 | yes |
| B2.3a | Cancellation context on the server; no paper for Requested | 55 | yes |
| B2.3b | The till's twin | 40 | yes |
| B2.4 | Finish table (pins) | 30 | yes |
| B2.5a | Station moves and closing (pins) | 35 | yes |
| B2.5b | Bill moves and arrival | 60 | yes |
| B2.6a | Group readiness and floor counts; rest of the order pinned | 50 | yes |
| B2.6b | Output alerts, deletion, an edit's slips, order-note change | 50 | yes |
| B2.7 | Whole-branch run, settings-off comparison, backlog, PR | 45 | docs only |

Order: B2.1 first (B2.5b and B2.6a use `serviceRequested`); B2.3a before B2.3b and B2.4; the rest
in the order listed. About 555 calls in all, against the outline's 300; every task but B2.1 is at
or below 60, and B2.1 (about 80) names its split point; all are under the 100-call limit: the outline's B2.5 and
B2.6 each held two independent readers' worth of work, and B2.2 and B2.3 each a server and a
client half.

## Self-review

- **Coverage of the outline and master T8.** Serving, Undo, All served, partial serving, split
  extras, `extraHeld`, rows from before the column, money gates and D3's shift → B2.1. Draft
  recall, source resend round trip, another editor, started/paid, changes-after-sending, a recalled
  source untouched by a sent-group action → B2.2a; an edit's recall-and-resend → B2.2b (D22, Owner
  question 1); `firedCourseIds` → B2.2b (D23). Cancellation context, parser, till twin, release race,
  same-id station move, Requested cancels with not-started choices → B2.3a/b. Finish → B2.4. Station
  move to waiting and immediate stations, released never re-held, station closing → B2.5a; split,
  move dishes, arrival, `moveLinesToGroup`, `kitchen-delete.integration` → B2.5a/b. Readiness,
  reminders, held counts, floor marks, output alerts, station deletion, correction slips, the edit's
  VOID and HOLD CHANGED, an order-note change, `releaseHeld`'s count → B2.6a/b. Races → D40.
  Master T8 items moved to B3 are in "Departures" with reasons.
- **Decisions asked for by the brief.** Recall-and-resend of released work → D22 (+ Owner question
  1). A Requested dish moved into a held-until-fired course and `moveLinesToGroup` → D31 (arrival
  goes to the fired group; `moveLinesToGroup` keeps refusing). `releaseHeld`'s count → D35. The
  made-here extras mapping → D36 (kept; placement and HOLD paper to B3, with reason).
- **Claims checked by running** (all in this worktree at `2631b7bcc2`):
  - B1's five test files: `pnpm exec vitest run src/kitchen-request.send.test.ts src/kitchen-request.release.test.ts src/kitchen-request.extras.test.ts src/kitchen-request.tab-send.test.ts src/kitchen-phase.test.ts`
    in `apps/server` → `Test Files 5 passed (5)`, `Tests 49 passed (49)`.
  - Every existing server test path this plan names (60) exists and is selected:
    `pnpm exec vitest list --filesOnly <the 60 paths>` printed 60 unique files, compared path by
    path with the named list (none missing). All 60 run together:
    `Test Files 60 passed (60)`, `Tests 2886 passed (2886)`, exit 0. The till paths were checked to
    exist with `test -f` (13 named) and were not run (browser suites; B2.3b measures memory first).
  - Probes P1–P3, P5, P6, in a scratch file `apps/server/src/zz-b2-probe.test.ts` run with
    `pnpm exec vitest run src/zz-b2-probe.test.ts` and deleted before this commit: P1 `markServed`
    of a Requested burger → `group.line_held`; P2 `splitBill` of a Requested burger →
    `tab.split_held_line`; P3 a note edit of a released burger after Grill was set to wait → the
    new item `{"firedAt":null,"passControlled":true}` with `requestedAt` set, Grill's jobs
    `['other','RECALLED']`; P5 contexts read before and after a waiter's fire that made a held
    burger Requested → `isDeepStrictEqual` true; P6 `readOrderStateCounts` for one Requested burger
    → `{"ordered":1,"unsent":0,"held":1,"waiting":0,"ready":0}`. What a failing probe would have
    printed, in each case, is the opposite answer (served; split; a released item; false; waiting
    1), so each probe could tell the two apart. A sixth probe of `readGroups` did not run
    (`readGroups` is not exported; the exported reader is `listOrderGroups`), so finding 8's
    readiness claim is read, not run.
  - The fiscal pair, `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
    → `Tests 20 passed (20)`, exit 0; the code guards of "Guard suites", run as listed there →
    `Test Files 5 passed (5)`, `Tests 6183 passed (6183)`, exit 0.
  - `rg -c 'A773 requested lifecycle' apps packages scripts` matched nothing, so every `-t` filter
    in this plan selects only the new cases.
  - `rg -n 'releaseHeld\(' apps/server/src` names the definition and one caller (finding 10).
- **Read, not run** (each task's RED is where it is first measured): the readiness half of finding
  8 and the drop VOID (`:6236`). Finding 6 was since run by review 1 (E1: one `*** EN ESPERA
  CANCELADO ***` slip and one void notice), finding 7 by revision 2 (B2.5b's "Measured at planning":
  a `held` group and one `*** EN ESPERA ***` job), and the arrival fixtures by review 1 (E3: all
  three red).
- **What this plan does not know yet.** Whether D23's case can reach a difference (B2.2b measures
  it and lands the change only on red); whether A1301's S10–S12 land in these files
  first (Task 0 rebase). A two-burger line with chips does exist in the split-extras fixture: revision 2's
  probe for B2.1 case 10 made one with `addTabRound` (`quantity: "2"`, both lines 2000), so B2.6b
  case 4 needs no fallback.

## Revision 2 (review-1)

Review 1 (`~/waitron-campaign-c/a773-2b2-plan-review/review-1.md`, 0 Critical, 7 Important, 9
Minor) is answered in the task text above. Every experiment below ran in `apps/server` of this
worktree with `AI_AGENT`/`CLAUDECODE` unset and `TESTCONTAINERS_RYUK_DISABLED=true`, through
throwaway files `src/zz-b2r2-probe{,2,3,4}.test.ts`; product mutations and the minimal scratch
versions of D21/D31 were applied to `working-order.ts`, `order-groups.ts`, `draft-recall.ts`,
`bill-editing.ts`, `kitchen-print.ts` and `rest-of-order.ts` one at a time, each reverted with
`git checkout -- <file>`; the probe files were deleted and `git status` showed only this plan.

**Important**

- **I1** (two suites missing from "Changed test checks" and the GREEN lists): agreed. Rows added
  for `dish-kitchen.test.ts:134-176` (B2.3a) and `department-transfer-api.test.ts:1974` with its
  three cases (B2.6a); `src/dish-kitchen.test.ts` added to B2.3a's GREEN and
  `src/department-transfer-api.test.ts` to B2.6a's; the "none else found" row names every other
  update that clears `fired_at`, the three conditional ones included; finding 11's search is now
  `rg -n 'firedAt: null' … -g '*.test.ts'` read by hand. Receipt: review 1's E2 (the five failures);
  revision 2's rerun of that search (seventeen updates, no multi-line form).
- **I2** (`extraHeld` control on case 6 unfailable; no pre-column row): agreed. New B2.1 case 9
  (both items `fired_at` set, `requested_at` null) with controls `serviceRequested` reading
  `ticketRequestedAt` alone and `extraHeld` as `isNull(extraItem.requestedAt)` alone; the case 6
  control is removed. Receipt: with a scratch D21, case 9 green, and red (`group.line_held`) under
  each control; case 6 stayed green under the old control (`Tests 1 passed`).
- **I3** (two controls that cannot fail): agreed on both, and **disagreed with the suggested
  replacement for B2.2a**: "`requireBillEditor` removed from `recallToDraft`" also stayed green,
  because `acquireBillEditor` calls `requireBillEditor` again before any write
  (`bill-editing.ts:23`). Case 3 now lives in `bill-editing.commands.test.ts` (a second person),
  reads its edit state fresh, and its control removes the other-editor check inside
  `requireBillEditor` (`bill-editing.ts:218`) → red (`UNIQUE constraint failed:
  order_drafts.bill_id`). B2.4's case 3 is dropped with its reason; the existing rollback case
  (`finish-party-service.test.ts:218`) is cited in D28 and run in GREEN.
- **I4** (wrong group time; date control unfailable): agreed. B2.5b case 5 is now a single
  Requested Flan as the only arriving dish (asserting the group's `firedAt` = its `requestedAt`),
  case 5b keeps the earlier Burger and asserts the group is dated by the Burger; the
  `ticketRequestedAt` term is dropped from D31 and "Files" as having no effect. Receipt: with a
  scratch D31, the Flan's `requestedAt` = `sentAt` (`…16.634Z`), case 5 green, 5b green (group
  `…16.674Z` = the Burger's), the routing-time control red on case 5; unmodified tree: a `held`
  group and one `*** EN ESPERA ***` job (finding 7, now measured). The case also attaches a printer,
  without which "no job" could not fail (a first probe without one printed 0 jobs today too).
- **I5** (rest-of-order wording is the owner's): agreed. D33 keeps `held: firedAt === null`; Owner
  question 4 added with a worked example and the default (HELD, today's), and how the build proceeds
  without the answer; `working-order.ts:8235` named as the second consumer; B2.6a case 6 inverted
  to a pin. Receipt: case 6 green unmodified (`[["H2O",false],["BURG",true]]`), red with the rest
  of the order reading initiation.
- **I6** (partial serving): agreed. New B2.1 case 10 (two burgers with chips, serve one, Undo one)
  with control "`writeServed` writing the whole active quantity". Receipt: red today
  (`group.line_held`), green with the scratch D21, red under the control (burger line 2000).
- **I7** (a recalled source and sent-group actions): agreed. New B2.2a case 7 with control
  `servableLines` without `not(isRecalledDish(tx))`. Receipt: green unmodified (burger 0, water
  1000, no job), red under the control (`expected 1000 to be +0`).

**Minor**

- **M1:** B2.6a case 1 asserts no `ready` key, then `ready: true` (`order-groups.ts:1560`, read).
- **M2:** the `order-state-counts.test.ts` row names every ticket literal (`:240`, `:245`, `:246`,
  `:307`, `:316-317`, `:326`); `rg -n "madeHere:"` in the file lists exactly these plus one update.
- **M3:** D22 now keeps a re-sent Requested record's first request time (`keepRequestedAt`), so the
  "change" and "free" paths agree; B2.2b case 2 runs the edit at a later fake time so its control
  can fail. Chosen over an owner question because B1's decision covered new extras, not re-sent
  records; the control is on code B2.2b writes and was not run at planning.
- **M4:** D40 states how races reduce to two orders under the write lock
  (`packages/db/src/tenancy.ts:30-36`, read), which orders B2 tests, and that the pass's races are
  B3.5's with barriers.
- **M5:** B2.7's settings-off comparison has a normalisation rule, says what a failing comparison
  prints, and adds a control run with one station waiting.
- **M6:** D34 names the closed-station printer-down consumer (`alert-sources.ts:694-697`,
  `station-outputs-down.ts:127`, read), keeps its reasoning, and hands a pre-release warning to
  B3.4 ("Left for B3").
- **M7:** new B2.6b case 6 pins that an order-note change sends nothing for a Requested dish.
  **Correction to the suggested control's reach:** widening the filter to `initiatedItem()` printed
  nothing more (the Requested burger becomes a HOLD-flavoured correction and its group's HOLD
  ticket never printed), so a jobs-only pin stayed green; it went red only on kitchen notices
  (`[grill, bar]` against `[bar]`), so the case asserts notices too.
- **M8:** D26 and the Departures row now say B3.4 reuses `heldPaperStations`, which already
  answers for fired groups (`order-groups.ts:2142-2160`, read).
- **M9:** B2.5b case 5 says which call makes the dish Requested (`addTabRound` at a waiting
  station; 5b `fireOrderLines`); B2.4 case 1 compares refund links by count and line position;
  station closing's "leave" is handed to B3 beside the Contract 8 note; B2.6b case 5 says B3 may
  change its pin.

**Disagreements, in short:** the review's replacement control for B2.2a case 3 cannot fail
(measured; replaced by the check inside `requireBillEditor`); and M7's control turns the pin red
only through kitchen notices, not paper (measured; the pin asserts both). No finding was declined.

## Revision 3 (round-3)

Round 3 (`~/waitron-campaign-c/a773-2b2-plan-review/round-3.md`, 0 Critical, 2 Important, 5 Minor)
is answered in the task text above; the evidence is the report's runs, named per line. No new
experiment ran for this revision.

- **I1:** B2.5b's date control now takes the write's time (`new Date().toISOString()`, round 3's
  E16, revision 2's measurement) and says case 5 has no routing time and that a `TypeError` (E17)
  does not count as red. Revision 2's I4 line above calls this "the routing-time control"; what it
  measured was `new Date()`.
- **I2:** Owner question 4 and D33 quote the ticket as it prints today, `1.000 x Chips — Fryer (on
  hold)` and "(en espera)" in Spanish (E22, `kitchen-ticket.ts:14,49`), with E22's ticket as the
  worked example; "Left for B3" says "(on hold)" too.
- **M1:** B2.2a case 3 sets every station back to not waiting in a `finally`.
- **M2:** B2.2a case 7 says its `fireOrderLines` half is a pin with no failing mutation (read, not
  run, as the report says).
- **M3:** B2.5b gains the control "`groupArrived` choosing its latest line" → 5b red, 5 green (E18).
- **M4:** B2.6b case 6 cites `kitchen-print.ts:937`.
- **M5:** B2.1 re-estimated at about 80 calls with the report's split point; the task list and total
  updated. Not split, since the report suggests a split point to use if it runs long, not a split.
