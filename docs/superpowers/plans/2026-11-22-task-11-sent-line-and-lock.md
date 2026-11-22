# Task 11 held-order edit and basket lock

The counter menu poll checks the edit lock before reading offers. If someone starts an edit while
that read is out, the answer can still change the basket. After the edit releases the lock, the next
poll should apply the current menu version to the basket then open.

## Reconcile the two backlog entries

PR #2870 already makes `PUT /api/working-orders/:id` refuse an omitted or reduced sent dish.
The existing `sent-dish-change.served.test.ts` HTTP cases cover the refusal codes, the unchanged
dish and the unchanged kitchen work. The `working-order.test.ts` whole-basket cases also cover
no-preparation dishes and saved extras. Keep the existing endpoint and cancellations.

A search for label assignments in non-test till code found no caller of the store's label setter.
The park action saves the label through the server and clears that basket on success. Keep the
setter and park path as they are. Both Task 11 bullets go from `docs/backlog/till.md` in this PR.

## Keep an automatic refresh behind the edit

In `apps/till/src/till-app.ts`, identify automatic counter refreshes from `#onMenuState` and
`#followDefault`. Reuse the poll's busy check (`#requestsOut()` or store edits locked) after
the offers read, before loading or reconciling the offers. On deferral, set `#counterOffersDue`
and return the existing failed result to the automatic caller.
The prior menu version stays loaded so the next poll knows to read again. Check the edit lock in
`#followDefault` before starting a read for an empty basket.

Keep the existing shared in-flight request. When an explicit refresh or a send-refusal retry
joins that read, treat it as explicit, so the poll's busy check does not frustrate the retry.
`adoptLines` stays synchronous for display updates and callers applying their own server answers.

## Test first and finish

1. In `apps/till/src/till-app-menu-refresh.test.ts`, pause the offers read started by a poll,
   take the edit lock, and let the answer finish. The line should still name the old version.
   Release the lock, poll again and check that the line takes the new version. Cover the empty
   basket separately: while locked, a poll should make no offers read.
2. In the same file, have a send refused for its menu version join a poll's in-flight offers read.
   Check that the send retries once with the new version. Reuse the silent-adoption and send-retry
   fixtures. The retry already works on the old code. In a disposable checkout of the fix,
   remove the joining caller's explicit mark and verify that the retry fails, then restore it.
3. Run the full till menu-refresh test file and finish the branch. The HTTP refusal suite already
   passed on the branch base. CI owns the fiscal runs.

Estimate 20–35 production lines and 45–80 test lines added. No new support file.
