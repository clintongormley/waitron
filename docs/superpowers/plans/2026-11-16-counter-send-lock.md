# Counter Send lock implementation plan

Authority: watcher queue, 2026-11-16 14:09, `/Users/clintongormley/waitron-campaign-f/queue.md`; Lane F `RUNNER.md` requires this separate Sol-high draft.
This records the queued request, not owner design approval. Implement inline only after Claude review and watcher clearance.

## Finish line and scope

After a lost Send reply, staff can retry the same basket but cannot change its dishes while the answer is unknown.
Park cannot silently discard an attempted edit. At sign-in, a hanging held-orders read leaves the kitchen queue,
waiting list and roster free to appear. Collecting an order already shown in the queue refreshes its card to offer Collect.

Reuse `#unconfirmedPlace` and its order/session/visit/server checks in `apps/till/src/till-app.ts:8363`,
`WorkingOrderStore.lockEdits()` in `apps/till/src/state/working-order.ts:395`, and `#refreshList` at `till-app.ts:6283`.
The store already ends locks on clear/load and protects a later lock from an earlier unlock; keep its meaning unchanged.
Reuse `placeCounter`, `retrieved`, `emit` and `flush` in `apps/till/src/till-app-counter-adjustments.test.ts`, and login/queue/retry helpers in `apps/till/src/till-app.test.ts`.
Leave out generic controllers, new records, new application wording, server/API changes and fiscal or payment changes.
Leave invoice/receipt metadata editable. No store or widget change is expected. Deliver one PR and remove completed backlog entries.

## Three test-first steps

1. **Keep the unknown Send basket unchanged.** In `apps/till/src/till-app-counter-adjustments.test.ts`, first add
   “keeps a lost-Send basket unchanged when a dish is added”, “keeps a lost-Send basket unchanged when a sent dish is raised”,
   and “Park after a lost Send clears only the unchanged basket”. Attempt the edits, assert unchanged lines and quantities,
   no update carrying those edits, and a retry reaching collect; Park may harmlessly clear this unchanged basket.
   Watch these fail before changing `#onPlaceOrder` in `apps/till/src/till-app.ts`; retain a scoped unlock with the pending
   attempt before calling Place. Keep it through repeated network failures; release on a definite answer or clear/load.
   Trace edit gates and menu reconciliation; keep Send usable and prevent old completions unlocking a newer basket.
   Exercise definite refusal, clear and reload in this app suite, reusing the existing cases where available.
   Replace “does not replay an uncertain placement after the basket changes”: the attempted change now does nothing,
   no update is sent, Place is called twice, collect appears and `place.error` does not.
   Revise “saves an edited basket to a replacement server before placing there”: the attempted edit stays blocked;
   keep assertions that the old server is not replayed and the replacement receives a fresh preparation and placement.
   Preserve recipient replay, receipt-language and definite-refusal checks; add lock release assertions to existing cases.

2. **Start the sign-in reads together.** In `apps/till/src/till-app.test.ts`, first add “a held-orders read that never
   answers still shows the station queue, waiting list and roster at sign-in”. Hold that request with a promise gate;
   assert the other rows and staff are installed before releasing it, then release it for cleanup. Watch it fail.
   In `apps/till/src/till-app.ts:6218`, start all three existing `#refreshList` calls together and start the existing
   staff read before awaiting them. Keep each list's failure wording, session checks and newest-result checks unchanged.
   This app suite owns coordination: retain the “on a %s, a failed read of the held orders…” cases and existing
   older-refresh success/failure cases, without duplicating their assertions.

3. **Refresh a collected order already on the queue.** In `apps/till/src/till-app.test.ts`, first add “collect straight
   after Place refreshes its queue card to offer Collect”: show the placed unpaid card, collect, return to the queue,
   and assert the refreshed settled card has its Collect button. Watch the missing refresh fail, then broaden
   `#onCollectOrder` in `apps/till/src/till-app.ts:8539` to refresh for `fromWaitingList` or an id in `this.stationQueue`.
   Keep “a switch to a prepay zone ends a kitchen-queue retry, and that retry's late failure does not bring the notice back”
   unchanged, including its empty queue and three-call assertion. Keep waiting-list collect coverage; add no widget test.

## Verification, documentation and size

For each step, run its named cases with `pnpm --filter @waitron/till exec vitest run <test-file> -t '<case>'` before and after the fix.
Then run the two changed test files. Store lock mechanics remain owned by `apps/till/src/state/working-order.test.ts`'s existing `WorkingOrderStore.lockEdits` cases; run those without duplicating them. Use the pre-push hook and current-head scoped CI for the remaining checks.
In `apps/server/src/guide/en/kitchen-service.md` and `apps/server/src/guide/es/kitchen-service.md`, replace obsolete edit-after-Send advice in `counter-send-retry` with one short locked-basket retry instruction. Delete A1417 and the two completed Task 16 bullets from `docs/backlog/till.md`, remove A1417's index entry and update Task 16's stale summary in `docs/backlog.md` to the remaining issue.
Expected production changes: add 50–90 lines, remove 15–35. Tests: add 330–490, remove 30–60, reusing fixtures. About 400–700 changed code/test lines overall, with a much smaller source diff; documentation adds only the short guide instruction and removes completed entries.
