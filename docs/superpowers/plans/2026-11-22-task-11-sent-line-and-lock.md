# Task 11 held-order edit and basket lock

When a till finishes a locked basket edit, its next menu poll can apply the new version to the basket
that is then open. The label setter applies a label once the current edit releases its lock.
The whole-order save already refuses a lower sent-dish quantity through the normal endpoint.

## Verify the server behavior already on main

PR #2870 added the check in `saveHeldOrderIn` and its HTTP tests. The three
`working-order.test.ts` cases for whole-basket saves and all nine cases in
`sent-dish-change.served.test.ts` passed on `a7c4f7e555`. The HTTP suite checks omitted and lowered
quantities with and without kitchen preparation, the 409 domain codes, and the unchanged dish and
kitchen work. Reuse these checks and retire the corresponding backlog bullet.

## Wait for the basket edit

- In `apps/till/src/till-app.ts`, reuse the menu poll's existing lock check and recheck it when the
  asynchronous counter offers read returns, before loading the offers or reconciling the basket.
  Leave a deferred update for the next ordinary poll, which reads the current offers and compares
  them with the current basket. Apply this to the two automatic refresh entry points in
  `#onMenuState` and `#followDefault`. Preserve explicit refresh and send-refusal retry behavior.
  Keep `adoptLines` synchronous for callers that apply their own server answers, including
  `DraftSync`'s quiet display updates.
- In `apps/till/src/state/working-order.ts`, let the existing label setter retain the latest value
  while `lockEdits` is held, including a request to clear the label. Apply it when the current lock
  is released. `clear` and `loadFrom` discard the waiting value because they replace the basket
  copy. A search found the setter exercised in the store tests. The current park action renames
  through the server and clears the basket after success. Keep that path as it is.

## Tests and finish

1. In `apps/till/src/till-app-menu-refresh.test.ts`, pause an offers read started by the poll,
   acquire the basket lock, and let the answer finish. Check that the basket still uses the old
   version. Release the lock, poll again and check adoption of the new version. Reuse the existing
   silent-adoption fixture and keep its pay request assertion in the existing test.
2. In `apps/till/src/state/working-order.test.ts`, check that a label waits for the current lock
   and applies without making the basket dirty. Check that a same-order reload discards a waiting
   label. Run the new cases before the fixes and the complete changed test files afterwards.
3. Delete the two Task 11 bullets in `docs/backlog/till.md`. The existing refusal, Cancel item,
   pricing rules, and screen wording stay as they are. Run the queue's unchanged fiscal and
   menu checks and then finish the branch.

Expected additions are 20–45 production lines and 45–85 test lines. No test support file is planned.
