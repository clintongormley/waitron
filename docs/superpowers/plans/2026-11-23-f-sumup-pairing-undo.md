# Keep a SumUp reader registered when Waitron cannot finish Add

**Finish line.** If SumUp registers a reader but the manager disconnects SumUp before Waitron can save it, Add still reports that Waitron did not save it. After reconnecting, the manager can adopt the same registration. An adoption already in flight can succeed with a reader that is still registered.

**Scope.** The Lane F queue item SUMUP-PAIRING-UNDO and the unchecked SumUp pairing bullet in the backlog. Reuse Add, Disconnect, Connect and Adopt, the real SumUp client, the existing database fixture and the HTTP stub used by the reader-unpair suite. Existing explicit Unpair and Delete actions keep their behavior.

## 1. Reproduce in `apps/server/src/payments-api.test.ts`

- [ ] Add “keeps a SumUp reader registered when reconnect and adoption overtake a refused add.” The fake HTTP provider records the pair POST, pauses its reply, and lists the new reader until a DELETE removes it. Disconnect through the management route while that POST is pending. Let the add's next real database transaction finish finding the credential absent, then pause its continuation outside the write lock. Reconnect through the management route and hold an adoption's successful list reply while Add finishes. Use promise signals for both pauses and release them in teardown.
- [ ] Assert the Add returns 409 `reader.provider_disconnected`, there is no local row before adoption, and after both requests finish there was no provider DELETE, adoption returned 201, and the saved reference still exists at the provider. Run `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts -t "reconnect and adoption overtake"`. Before a fix, expect the provider to record a DELETE and adoption to save a reference that the provider no longer lists. Check the disconnect-only order too, with no reconnect before Add returns. If the alleged removal cannot be reproduced, record the observed HTTP calls in Lane F's progress log and pause for the watcher.

## 2. Keep the provider registration if Add cannot save it

- [ ] If the test reproduces the race, remove the automatic provider removal from the post-provider refusal in `apps/server/src/payments-api.ts`. Keep the existing guarded local write and refusal codes. Adoption can then rely on its current provider verification. The Stripe seat only looks up existing registrations and its remove method is empty. No new state, retry, provider contract or dashboard action is needed.
- [ ] Keep checks for the disconnected refusal and absence of a Waitron row. Update the fake-seat cases that expect the automatic removal to assert the new behavior with the real client, preserving the disconnect-only and overlap cases above. Leave the explicit Unpair and Delete assertions in place. List changed assertions in the PR.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts` and confirm the real-client tests, including the explicit unpair/delete cases, pass. Remove the finished bullet in `docs/backlog.md` and sign off the change.

**Size.** About 5–15 production lines touched, around 100–160 test lines added and 60–100 replaced or removed, plus the backlog bullet. The test controls request timing with the existing database and no external calls. Concurrency calls for the two run-it reviews at finish-branch.
