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
in "Self-review".

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
   marks it held (`apps/server/src/rest-of-order.ts:72`). The dark-pass alert leaves it out
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
    `requested_at` set. `rg` over `apps/server/src/*.test.ts` finds nine such fixtures; each one a
    B2 reader change reaches is listed in "Changed test checks" with the one-word fix
    (`requestedAt: null`), which makes the row genuinely held, as D20 defines held.

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
arrival carrying a Requested dish; group readiness, floor counts, the printed rest of the order and
the dark-pass alert counting Requested work as initiated; the edit's VOID skipping a Requested
dish; `releaseHeld` returning nothing.

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
  its station's setting now; a record that was Requested comes back Requested, stamped with the
  edit's time (as B1's Task 4 review decided for an edit's extras: the time of the write that adds
  it). New `fireLines` option `keepReleased?: ReadonlySet<string>` (line ids, dish or extra),
  filled at the "change" path from each deleted item whose `firedAt` was set and passed on to
  `insertSplitExtras`; for those lines `requestStamps` gets `waits: false`. A "raise" (one more of a
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
  stamps null, D20) keeps today's behaviour. **Handed to B3:** a Requested record whose station
  still holds HOLD paper from before the fire is today corrected only by that keep-charge branch;
  draft recall, the remove-charge branch and a station move send it nothing (they test
  `group.state === "held"`). B3.4 must already learn which stations hold a fired group's HOLD paper
  (`heldPaperStations`, `order-groups.ts:2142`) to mark the release's FIRE ticket, so the HOLD
  CANCELLED for those three paths is built there, once, on the same answer. Unreachable until
  PR C.

- **D27 A cancelled Requested dish's adjustment stage stays as today.** `cancelItem` records
  "unsent" for it (`line-cancel.ts:433-443`: no fired component, group not held), and so does
  `adjustments-apply.ts`' `stageOf` (`:335-339`), which B2 may not edit. Both stages need no refund
  approval (`packages/adjustments/src/policy.ts:213-224` asks for it only at "fired" or "served"),
  so the stage changes no permission; it shows in the adjustments report's "By stage". Owner
  question 3 asks whether it should read "Held"; B2 pins "unsent".

- **D28 Finish table needs no change for Requested dishes.** `finishPartyService` already includes
  every unserved paid dish, any phase, and compares each context exactly; its "preparation started"
  question applies only when a component is fired (`finish-party-service.ts:198-203`), so it is not
  asked for a Requested dish. B2.4 pins held, Requested, waiting and ready dishes in one Finish,
  one transaction, and the refund hand-off, and a race that D25's fields alone catch.

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
  group, dated by its `ticketFiredAt ?? ticketRequestedAt ?? sentAt`; it is never put in a held
  group, never re-requested and never printed. `moveLinesToGroup` keeps refusing a line whose
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
  right (pins). The printed rest of the order marks a dish held only when it is not initiated. The
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
  work; that query's index pin (`station-outputs-down.test.ts:176`) is untouched.

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

- **D39 A fixture that makes an item held clears both stamps.** D20 defines held as both stamps
  null. Where a B2 reader change turns an existing fixture's `.set({ firedAt: null })` row from
  "held" into "Requested", the fixture gains `requestedAt: null` and no assertion changes
  ("Changed test checks"). A fixture whose reader B2 does not change is left alone.

## Departures from the outline and the master plan

| Outline or master says | This plan | Why |
| --- | --- | --- |
| B2.6 "correction slips skip requested items" | Requested gets no cooking slip and no HOLD correction without HOLD paper; HOLD paper printed before the fire is corrected only where today's code already does, the rest in B3 | D26: "skip" would delete the keep-charge branch's correct HOLD CANCELLED for a group whose HOLD paper printed; the master's "including printed HOLD" needs `heldPaperStations` for fired groups, which B3.4 builds for the release |
| Master T8 "current-order presentation" in B2; outline puts `readCurrentOrders` in B3.3 | B2.1 changes only `released` and `heldExtras` (the Serve gate); B3.3 adds the fields | D21: the server must not accept a Serve the till never offers; the new fields have no reader before B4 |
| Outline B2.3 "a release racing the dialog refuses" as new behaviour | a pin: `firedAt` already changes at release | finding 5 (probe P5 shows what is *not* caught: held → Requested) |
| Outline B2.4 "includes held, requested, waiting and ready" as a change | pins only | D28, finding 9 |
| Outline B2.5 one task, B2.6 one task, B2.2 and B2.3 one each | B2.2a/b, B2.3a/b, B2.5a/b, B2.6a/b | each stays well under 100 calls |
| Outline B2.6 `station-outputs-down.ts:122` "include requested pass demand" | the dark-pass read (`pass-board.ts:180`) changes; the dark-station read does not | D34 |
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

## Task B2.1: serving a Requested dish (about 50 calls)

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
- [ ] **Money gates (pin, `unpaid-departure.test.ts`, new `describe("A773 requested lifecycle")`
  beside `:1396`, reusing its venue, `seatedWith` and `depart` helpers):** every station of the
  venue waits (`setStationsWaitForPass` over the venue's `kitchen_stations` ids, read in the test);
  a seated party whose dish is sent through the file's own send route becomes Requested (assert its
  item's stamps first); the unpaid departure answers 409
  `{ code: "unpaid_departure.unfired_dishes", params: { workingOrderId: party.tabId } }` and
  `expectNothingWritten` holds, as `:1396-1417` asserts for a recalled dish. Passes from the start.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.serve.test.ts`:
  cases 1, 3, 4, 5 and 7's first two rows fail on `group.line_held` or `released: false`; 2's serve
  half fails with case 1; 6 and 8 pass and stay as pins. Then
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
  `ticketFiredAt` alone → cases 1, 3 red; `extraHeld` back on `isNull(extraItem.firedAt)` → cases
  4, 5 red; `extraHeld` testing `isNull(requestedAt)` alone → case 6 red; `readCurrentOrders`'
  `released` back on `isReleased` → case 7 red; `isReleased` changed to read initiation (the
  tempting shortcut) → the unpaid-departure pin red; `stampSent` given only the ticketed lines in
  `fireLines` → case 8 red; `requestHeldItems`' second update without `heldItem()` → case 2's sweep
  half red.
- [ ] **Commit.** `git commit -s -m "Let a waiter serve a dish that waits for the pass, keeping the money checks on what the kitchen has"`
  (body: serving and the till's Serve button read whether the waiter has asked for the dish; the
  unpaid-departure and adjustment checks still read whether the kitchen has it; the one fixture
  line added and why).

## Task B2.2a: recalling a Requested dish to the draft (pins, about 35 calls)

**Files.** Create `apps/server/src/kitchen-request.recall.test.ts`. No product change is planned;
if a case goes red, stop and report (D24 would be wrong).

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
  3. **Another editor refuses before any write.** As case 1, but another person has taken the bill
     (`takeOverDraftForTest`, `apps/server/src/testing/draft-command-fixture.ts:53`): recall refuses
     `draft.taken_over` (caught outside `withTransaction`); the item is still Requested and
     identical, no reservation row.
  4. **Started refuses.** Grill waits, Fryer does not; a Fire now burger with chips; the chips'
     item advanced to `preparing` (`advanceTicketItem`): recalling the burger refuses
     `ticket.already_started`, nothing written.
  5. **Paid refuses.** A Requested burger on a bill paid in full
     (`payWorkingOrder`, `apps/server/src/testing/whole-payment-fixture.ts`): recall refuses
     `bill.paid`, nothing written.
  6. **Changes after sending reads Requested as held.** Grill waits; Grill's changes-after-sending
     set to `"held"` (`setChangesAfterSending`, `testing/changes-after-sending.ts:5`): a Requested
     burger recalls. Set to `"never"`: recall refuses `ticket.already_fired`, nothing written.
  (Legacy `recallLines` of a Requested dish is already pinned by B1:
  `kitchen-request.send.test.ts:377`.)
- [ ] **RED (all pins).** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.recall.test.ts`:
  every case passes; say so in the commit.
- [ ] **GREEN.** Unfiltered `src/draft-recall.test.ts`, `src/draft-recall-legacy.test.ts`,
  `src/draft-recall-split.test.ts`, `src/draft-recall-adjustments.test.ts`,
  `src/draft-recall.modifiers.test.ts`, `src/changes-after-sending.test.ts`,
  `src/kitchen-request.send.test.ts`; typecheck; format check.
- [ ] **Mutation controls:** `draft-recall.ts`' RECALLED filter widened to every item
  (`items` instead of `items.filter((item) => item.firedAt !== null)`) → case 1 red;
  `requestStamps` ignoring `waits` → case 2 red; `requireBillEditor` moved after the item delete →
  case 3 red; the started check removed → case 4 red; `requireBillOfParty` skipped → case 5 red;
  `refuseChangesAfterSending` passing `firedAt: item.firedAt ?? "x"` → case 6's `"held"` half red.
- [ ] **Commit.** `git commit -s -m "Pin recalling a dish that waits for the pass: no kitchen slip, and the same refusals"`.

## Task B2.2b: an edit keeps each record's phase (about 50 calls)

**Files.** Modify `apps/server/src/working-order.ts`: `fireLines` options (`:2106-2112`) and its
call into `insertSplitExtras`, `insertSplitExtras` (search the name; it stamps extras with
`requestStamps`), `applyLineEdits`' "change" path (`:6337-6362`) and, only if case 4 goes red,
`readEditableOrder`'s `firedCourseIds` (`:5746-5753`). Create
`apps/server/src/kitchen-request.edit.test.ts`.

**Interfaces.**

```ts
// fireLines(…, options) gains:
keepReleased?: ReadonlySet<string>; // line ids whose re-sent record keeps its release (D22)
```

At the "change" path, for the parent and each kept child whose deleted `ticket.firedAt` is set,
add its line id to `keepReleased`; pass it to `fireLines`. Inside, a line in `keepReleased` is
stamped with `waits: false`; `insertSplitExtras` does the same for an extra in the set. Nothing
else reads it.

- [ ] **Failing tests and pins** (`describe("A773 requested lifecycle: edit")`;
  `setupSplitExtrasVenue`; copy the `line`, `slips` and `edit` helpers of
  `src/split-off-extras.edit.test.ts:46-55,82-112`):
  1. **A released dish's change edit keeps its release.** Nothing waits; `addTabRound` a burger;
     then Grill waits; `edit(tx, venue, 1, { note: "No salt" })`: the new item has `firedAt` =
     `requestedAt` = the edit's time and `passControlled` false; Grill's printer gains a RECALLED
     slip and then a ticket for the burger, as with nothing waiting. Fails today (probe P3: the new
     item Requested, no new ticket).
  2. **Each record keeps its own phase.** Grill waits, Fryer does not; `addTabRound` a burger with
     chips (burger Requested, chips released); then Fryer waits too; edit the burger's note: the
     edit takes "change" (the chips' record is fired); the burger comes back Requested at the
     edit's time; the chips come back released (`firedAt` set) and print at Fryer after a RECALLED
     slip; no Grill or Pass job for the burger. Fails today on the chips (Requested).
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
  too) → case 2's burger red (released); the "free" path routed through "change" for Requested
  records → case 3 red; if D23 landed, `firedCourseIds` back on `firedAt` → case 4 red.
- [ ] **Commit.** `git commit -s -m "Keep a released dish released when an edit sends it again"`
  (body: D22 and that Owner question 1 asks the owner; D23's measured outcome).

## Task B2.3a: the cancellation context and cancelling a Requested dish (server, about 55 calls)

**Files.** Modify `apps/server/src/line-cancel-context.ts` (type `:12-25`, builder `:72-112`),
`apps/server/src/line-cancel-input.ts` (`:29-38`), `apps/server/src/line-cancel.ts` (keep-charge
corrections `:466-512`). Tests: `apps/server/src/line-cancel-context.test.ts` (two whole-shape pins
gain the fields; new cases), `apps/server/src/line-cancel-api.test.ts` (malformed list `:1426-1458`
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
and its select; its other callers ignore the new field).

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
  caller), `src/move-dishes.test.ts`; the fiscal pair, unedited;
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

## Task B2.4: finishing a table with dishes in every phase (pins, about 35 calls)

**Files.** Add a `describe("A773 requested lifecycle")` to
`apps/server/src/finish-party-service.test.ts`, reusing its `fixture` (`:59`), `snapshot` (`:105`)
and `confirm` (`:131`) helpers. No product change planned; a red case is a stop (D28 would be
wrong). Depends on B2.3a (case 2 needs `requestedAt` in the context).

- [ ] **Pins:**
  1. **Held, Requested, waiting and ready, in one Finish.** A paid party with four unserved dishes:
     one in a held group; one Requested (its station waiting before a Fire now); one released and
     queued; one released and advanced to `ready`. `finishPartyService` with the four contexts
     read at confirmation: answers once; the four lines are cancelled keeping the charge; the party
     is closed; the answer's refund links equal what the same Finish with nothing waiting answers
     (run that twin in the case, on a second party); every component in the read contexts carries
     `requestedAt` and `stationId`; jobs: for the waiting, ready and held dishes exactly what the
     twin prints for them, and nothing for the Requested one (B2.3a's fix); the
     "preparation started" answer is not required (no component of the Requested dish is fired).
  2. **A race only the new field catches.** Read the Finish contexts while a dish is held; fire its
     group with its station waiting (Requested); confirm with the old contexts: refused
     `party.unserved_dishes` (`finish-party-service.ts:191-193`), and `snapshot` identical before
     and after.
  3. **One transaction.** As case 1, with the fourth dish's context made stale between read and
     confirm by a direct update: refused, and none of the first three dishes cancelled (the
     snapshot identical).
- [ ] **RED (all pins).** `pnpm --filter @waitron/server exec vitest run src/finish-party-service.test.ts -t 'A773 requested lifecycle'`:
  all pass; say so in the commit.
- [ ] **GREEN.** Unfiltered `src/finish-party-service.test.ts`, `src/finish-party-collect.test.ts`,
  `src/kitchen-request.cancel.test.ts`; the fiscal pair, unedited; typecheck; format check.
- [ ] **Mutation controls:** Finish's dish query also requiring `ticketItems.firedAt` not null →
  case 1 red; the context builder dropping `requestedAt` (B2.3a's field) → case 2 red; cancelling
  each dish in its own `withTransaction` inside `finish` → case 3 red.
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
     job.
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

## Task B2.5b: bill moves and arrival (about 55 calls)

**Files.** Modify `apps/server/src/working-order.ts` (`carveLines`' `refuseHeld` test
`:4679-4687`, and the line select feeding it `:4627-4628`, which gains `ticketRequestedAt`) and
`apps/server/src/order-groups.ts` (`groupArrivingDishes` `:2463-2561`: its select `:2480` gains
`ticketRequestedAt`, its classification `:2505-2513` uses `serviceRequested`, its `firing` list
`:2515-2518` dates a Requested dish by `ticketFiredAt ?? ticketRequestedAt ?? sentAt`). Create
`apps/server/src/kitchen-request.bill-move.test.ts`. Fixture fixes listed in "Changed test checks"
(arrival rows).

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
  5. **An arriving Requested dish in a course held until fired.** Use the arrival setup of
     `party-arriving-dishes.test.ts:332` ("puts sent dishes in a fired group and a dish waiting for
     its course in a held group") with Print held groups in advance on, as `:931` sets it, and the
     dish's station waiting: make the moving bill's dish Requested (Fire now before the move), then
     move the bill: the dish's line joins the arrival's **fired** group (state `fired`, `firedAt` =
     its `requestedAt`), its item identical (still Requested), and no HOLD ticket or other job at
     any printer. Fails today: the dish lands in a held group and a HOLD ticket prints (finding 7;
     first measured here).
  6. **Arrival outside a held course (pin, cite).** B1's `party-move-bill.test.ts` "A773 waiter
     request" cases (`:1187-1281`) already pin that it stays Requested; run them in GREEN.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.bill-move.test.ts`:
  1, 2 and 5 fail as described; 3 and 4 pass (pins; 3's existing-bill moves already keep stamps).
- [ ] **Minimal implementation** as "Files". Then run the arrival suites: the three fixtures that
  clear only `firedAt` before an arrival (`party-arriving-dishes.test.ts:760`,
  `attendance-arriving-groups.test.ts:172`, `order-groups.request-kind.test.ts:241`) may go red
  because their row now reads Requested; for each that does, add `requestedAt: null` to its `.set`
  (D39) and record which in the commit. A red assertion anywhere else is a stop.
- [ ] **GREEN.** RED unfiltered; unfiltered `src/move-dishes.test.ts`, `src/till-api.move-dishes.test.ts`,
  `src/split-bill.test.ts`, `src/split-off-extras.split.test.ts`, `src/party-move-bill.test.ts`,
  `src/till-api.move-bill.test.ts`, `src/party-arriving-dishes.test.ts`,
  `src/party-arriving-inactive-course.test.ts`, `src/attendance-arriving-groups.test.ts`,
  `src/order-groups.request-kind.test.ts`, `src/kitchen-delete.integration.test.ts` (master T8),
  `src/kitchen-request.release.test.ts`; typecheck; format check.
- [ ] **Mutation controls:** `refuseHeld` back on `ticketFiredAt === null` → cases 1, 2 red;
  `refuseHeld` dropped entirely → case 4 red; `groupArrivingDishes` back on `isReleased` → case 5
  red; the arrival's `firing` date for a Requested dish taken from the routing time → case 5's
  `firedAt` red.
- [ ] **Commit.** `git commit -s -m "Let a dish that waits for the pass move to another bill or party without being held again"`.

## Task B2.6a: group readiness and the floor's counts (about 50 calls)

**Files.** Modify `apps/server/src/order-groups.ts` (`listOrderGroups`' kitchen count
`:1513-1529`), `apps/server/src/order-state-counts.ts` (`KitchenPart.ticket` gains `requestedAt`,
its select near `:124`, `dishCounts` `:49-84`), `apps/server/src/rest-of-order.ts` (`:41-48`
select, `:72`). Create `apps/server/src/kitchen-request.readers.test.ts`. Fixture fixes in
`order-state-counts.test.ts` and `kitchen-print.test.ts` ("Changed test checks").

**Interfaces.** No exported signature changes beyond `KitchenPart.ticket.requestedAt:
string | null`. Readiness: `remaining` counts items matching `initiatedItem()`; `ready` keeps
`madeHere or state = 'ready'`, and a Requested item's state is `queued`, so it never counts ready.
`dishCounts`: held when a part is genuinely held (`initiatedAt(ticket) === null`) or the group is
held (made-here dish excepted, as today); waiting when a not-made-here part is initiated and queued
or preparing. Rest of the order: `held: initiatedAt(row) === null`.

- [ ] **Failing tests and pins** (`describe("A773 requested lifecycle: readers")`;
  `setupSplitExtrasVenue`; Bar routing as in B2.1 case 3):
  1. **A Requested part keeps its group out of ready (D32).** Grill waits; a Fire now group of a
     burger (Requested) and a Bar drink (released); advance the drink to ready
     (`advanceTicketItem`): `listOrderGroups` (`order-groups.ts:1470`) gives the group
     `ready: false`. Then a direct update standing in for B3's release, and the burger advanced to
     ready: `ready: true`. Fails today on the first half.
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
  6. **Rest of the order.** `readRestOfOrder` (`rest-of-order.ts:52`) for an order with a released
     Bar drink and a Requested burger: the burger's entry `held: false`; a burger in a held group
     `held: true`. Fails today on the first.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.readers.test.ts`:
  1, 2 and 6 fail as described; 3, 4 and 5 pass (pins).
- [ ] **Minimal implementation** as "Interfaces". Then `src/order-state-counts.test.ts` and
  `src/kitchen-print.test.ts`: "counts a ready dish waiting while its extra is queued …, and held
  while the extra is unfired" (`order-state-counts.test.ts:727`, fixture `:738`) and "A803 portion
  grouping: Also on order keeps a held portion apart from a fired one …"
  (`kitchen-print.test.ts:2984`, fixture `:3022`) are expected to go red because each fixture clears
  only `firedAt`; add `requestedAt: null` (D39). `order-state-counts.test.ts`' `dish()` builder
  (`:228`) and its `unfired`/`readyHere` fixtures (`:244-245`) gain `requestedAt` to satisfy the
  type (`null` for held parts, the fire time for released ones); no expected count changes.
- [ ] **GREEN.** RED unfiltered; unfiltered `src/order-groups.test.ts` (its readiness table
  `:3627-3745` unchanged: none of its rows is Requested), `src/order-state-counts.test.ts`,
  `src/table-signals.test.ts`, `src/table-signals.service-lifetime.test.ts`,
  `src/current-orders.test.ts`, `src/rest-of-order.test.ts`, `src/kitchen-print.test.ts`,
  `src/kitchen-request.send.test.ts`; typecheck; format check.
- [ ] **Mutation controls:** readiness `remaining` back on `isNotNull(firedAt)` → case 1 red;
  `ready` also accepting `requestedItem()` → case 1's first half red;
  `dishCounts` held test back on `firedAt === null` → case 2 red; waiting requiring `firedAt` → case
  2 red (the Requested burger falls to `ready`); `readHeldCounts` counting fired groups → case 3
  red; reminders ignoring fired groups' unserved dishes → case 4 red; `readKitchenLines` on
  `initiatedItem()` → case 5 red; rest of the order back on `firedAt === null` → case 6 red.
- [ ] **Commit.** `git commit -s -m "Count a dish that waits for the pass as asked for, not held, in group readiness and floor counts"`.

## Task B2.6b: output alerts, station deletion and an edit's slips (about 45 calls)

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
     `printedHeldGroups`, state `held`).
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/kitchen-request.alerts.test.ts`:
  1 and 4 fail; 2, 3 and 5 pass (pins).
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
  case 5 red.
- [ ] **Commit.** `git commit -s -m "Count a dish that waits for the pass in the dark-pass alert, and print no void for it"`.

## Task B2.7: whole-branch run, backlog and the PR (no product change, about 35 calls)

- [ ] Rebase on current main (Task 0's command). Every B2 test file unfiltered, then each task's
  GREEN list once more; the B1 files (`kitchen-phase`, `kitchen-request.{send,extras,release,tab-send}`);
  the guard suites below; the fiscal pair. Read each `Tests` count and exit status.
- [ ] Re-run the controls a later task could have weakened: B2.1's `serviceRequested` and `extraHeld`
  controls (B2.5b reuses `serviceRequested`), B2.3a's builder controls (B2.4 depends on them), and
  B2.5b's arrival control; record each red-then-reverted run in the ledger.
- [ ] Settings-off comparison (what B1's reviews did): on one table service with every station's
  setting false — Fire now, serve, recall to draft and resend, cancel, finish, split, arrival — the
  `ticket_items`, `print_jobs` and kitchen-notice rows equal those of the same script run at
  `2631b7bcc2` in a throwaway worktree (`git worktree add --detach … 2631b7bcc2`, removed after).
  Expected difference: none. A difference is a stop.
- [ ] Re-run the consumer audit; confirm every hit B2 did not touch is assigned to B3, B4 or PR D,
  and add to the slice plan's "Left for B2 and B3" (renamed "Left for B3 and B4") this plan's
  hand-offs (see "Left for B3" below).
- [ ] Docs: no guide changes (nothing visible). Backlog: rewrite the A773-2 entry
  (`docs/backlog.md:88-94`; `docs/backlog/till.md` near `:2495`) to say B1 and B2 landed and B3–B4
  remain, linking this plan; add the three owner questions if unanswered.
- [ ] PR through `/finish-branch` with the worktree path and a note naming this plan and the ledger,
  FULL path, two Codex run-it reviews. Title: "A dish that waits for the pass can be served,
  recalled, cancelled and moved like any sent dish (A773-2 PR B2)". First line: "No venue reset and
  no migration." Body in plain English: nothing can switch a station's waiting on until PR C; the
  cancellation context's two new fields (till and server change together); D22's default and the
  three owner questions; D26's and D36's hand-offs to B3; every changed test check.
- [ ] Ledger `Status: done` for B2; next step: B3's task plan.

## Changed test checks (expected; the implementer confirms each)

| Check | Task | Change | Why it is allowed |
| --- | --- | --- | --- |
| `split-off-extras.release.test.ts` "refuses serving a sent water while its chips are held again" (`:214`), fixture `:220-225` | B2.1 | `.set({ firedAt: null })` gains `requestedAt: null` | D39: since B1 the chips carry a request time, so clearing `firedAt` alone makes them Requested, which D21 lets the water be served past; the case means "held again" and its assertion (`group.line_held`) is unchanged |
| `line-cancel-context.test.ts` "captures every dish component in stable kitchen-id order…" (`:118`, expected `:137-162`) and "captures a no-preparation dish and treats actual serving as started" (`:183`, expected `:185-200`) | B2.3a | each expected component gains `requestedAt` and `stationId` | a whole-shape pin gaining the master T8 contract fields (slice plan's "Changed test checks" row for B2); every other value unchanged |
| `line-cancel-api.test.ts` "refuses malformed component %s" (`:1426-1458`) | B2.3a | two new table rows | new cases; existing rows unchanged |
| Till hand-built cancellation contexts (13 files, B2.3b "Files") | B2.3b | each component literal gains `requestedAt: null, stationId: …` | adding what a fixture lacks so it typechecks; no assertion changes (`api/line-cancel-client.test.ts:76` echoes the same literal) |
| `apps/till/src/widgets/cancel-item-dialog.test.ts` "a changed %s refresh requires fresh money consent" (`:416-447`) | B2.3b | two new table rows | new cases |
| `party-arriving-dishes.test.ts:744` (fixture `:760`), `attendance-arriving-groups.test.ts:156` (fixture `:172`), `order-groups.request-kind.test.ts:224` (fixture `:241`) | B2.5b | `requestedAt: null` added where the case goes red | D39: each makes an arriving dish held by clearing `firedAt`; under D31 a leftover request time makes it arrive initiated. Only those that go red are edited; the commit names them |
| `order-state-counts.test.ts:727` (fixture `:738`) | B2.6a | `requestedAt: null` | D39 |
| `order-state-counts.test.ts` `dish()`, `unfired`, `readyHere` (`:228-245`) | B2.6a | the ticket objects gain `requestedAt` | adding a field the type now requires; no expected count changes |
| `kitchen-print.test.ts:2984` (fixture `:3022`) | B2.6a | `requestedAt: null` | D39 |
| `station-outputs-down.test.ts:642` (fixture `:647`) | B2.6b | `requestedAt: null` | D39: "does not count a held dish" must use a held dish once D34 counts Requested |
| none else found | — | — | the remaining `firedAt: null` fixtures (`till-api.station-today.test.ts:241`, `management-api.station-disable.test.ts:265`, `attendance-kitchen-service.test.ts:113`, `line-service-operations.test.ts:301,321`) feed readers B2 does not change, or set a group's state, not an item's |

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
  groups beside B3.4's FIRE marking. Today only the keep-charge cancel corrects it.
- **The made-here extras mapping** (D36): which pass card and column shows the Requested extras of
  a made-here dish in a held group, and whether HOLD paper lists them (`printHoldTickets`,
  `heldItemsOf`, `correctJoin`, `readOnHoldTickets`, `enqueueOrderKitchenNoteChange` all read
  `isNull(firedAt)`).
- **`applyLineEdits`' late read of the next fire's kind** (D38), with B3.1's `request_kind` reader.
- **Showing "waiting for the pass"** in department transfers (D37) and current orders' `firedAt`
  for a Requested row (still null; `order-groups.ts:2017`), with B3.3's fields.
- **`stampSentOrderNumber` skips Requested items** (`working-order.ts:4127-4158`: no paper, no
  number); the pass's release must stamp the order number when it prints.
- **Owner questions 1–3** go with B3's copy sheet.

## Task list and sizes

Estimates are read, not measured.

| Task | What | Calls | Commit |
| --- | --- | --- | --- |
| 0 | Preflight | 15 | none |
| B2.1 | Serving a Requested dish; money gates pinned | 50 | yes |
| B2.2a | Recall to the draft (pins) | 35 | yes |
| B2.2b | An edit keeps each record's phase | 50 | yes |
| B2.3a | Cancellation context on the server; no paper for Requested | 55 | yes |
| B2.3b | The till's twin | 40 | yes |
| B2.4 | Finish table (pins) | 35 | yes |
| B2.5a | Station moves and closing (pins) | 35 | yes |
| B2.5b | Bill moves and arrival | 55 | yes |
| B2.6a | Group readiness and floor counts | 50 | yes |
| B2.6b | Output alerts, deletion, an edit's slips | 45 | yes |
| B2.7 | Whole-branch run, backlog, PR | 35 | docs only |

Order: B2.1 first (B2.5b and B2.6a use `serviceRequested`); B2.3a before B2.3b and B2.4; the rest
in the order listed. About 500 calls in all, against the outline's 300: the outline's B2.5 and
B2.6 each held two independent readers' worth of work, and B2.2 and B2.3 each a server and a
client half.

## Self-review

- **Coverage of the outline and master T8.** Serving, Undo, All served, split extras, `extraHeld`,
  money gates and D3's shift → B2.1. Draft recall, source resend round trip, another editor,
  started/paid, changes-after-sending → B2.2a; an edit's recall-and-resend → B2.2b (D22, Owner
  question 1); `firedCourseIds` → B2.2b (D23). Cancellation context, parser, till twin, release race,
  same-id station move, Requested cancels with not-started choices → B2.3a/b. Finish → B2.4. Station
  move to waiting and immediate stations, released never re-held, station closing → B2.5a; split,
  move dishes, arrival, `moveLinesToGroup`, `kitchen-delete.integration` → B2.5a/b. Readiness,
  reminders, held counts, floor marks, output alerts, station deletion, correction slips, the edit's
  VOID and HOLD CHANGED, `releaseHeld`'s count → B2.6a/b. Master T8 items moved to B3 are in
  "Departures" with reasons.
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
- **Read, not run** (each task's RED is where it is first measured): finding 6 (keep-charge HOLD
  CANCELLED), finding 7 (arrival into a held group and its HOLD ticket), the readiness half of
  finding 8, the drop VOID (`:6236`), and which of the arrival fixtures go red in B2.5b.
- **What this plan does not know yet.** Whether D23's case can reach a difference (B2.2b measures
  it and lands the change only on red); whether a two-burger line exists in the split-extras
  fixture under A803 (B2.6b case 4 says how to adapt); whether A1301's S10–S12 land in these files
  first (Task 0 rebase).
