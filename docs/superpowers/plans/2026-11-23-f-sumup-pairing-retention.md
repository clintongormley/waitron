# Keep a SumUp reader available after a refused Add

When a manager pairs a reader and a fast SumUp reconnect or provider switch-off prevents
Waitron from saving it, the manager still gets the existing refusal. Reopen Add after reconnecting
the same SumUp account and enabling it. Once SumUp lists the reader as paired, select it from
the available readers and adopt it without entering another pairing code. A refused Add also
leaves the registration in place for another manager who is already adopting it.

The real-client probe recorded two cases where Add's automatic DELETE reached SumUp. A
plain disconnect sent no DELETE. The watcher cleared the fix for the two reproduced paths
on 23 November at 20:06 in Lane F's `questions.md`.

- [ ] In `apps/server/src/payments-api.test.ts`, reuse the probe's SumUp client and fake HTTP
  provider. Have the fake keep the registration from the pair POST, return paired registrations
  on GET and drop the reader on DELETE. Switch SumUp off before giving Add its pair reply.
  Assert the 409 refusal, then enable SumUp and assert the reader is offered as available
  and Adopt returns 201 with one local row. Run the test before the fix and see the available
  list come back empty. The existing fake-provider switch-off case checks zero removals.
  Cite Lane F's `receipts/sumup-pairing-undo/probe-full-file.log` in the PR for the fast-reconnect
  and overlapping Adopt sequence. In the PR, state what is known about retrying Add with a
  fresh code. The watcher cleared this test scope on 23 November at 20:15 in Lane F's
  `questions.md`.
- [ ] In `apps/server/src/payments-api.ts`, drop the automatic provider removal when Add's
  post-pair save check refuses. Keep the checks, refusal codes, and the explicit Unpair and
  Delete paths. The existing available-readers and Adopt routes handle the retained registration.
  Remove the stale comparison to pairing in the Adopt comment.
- [ ] Update the fake-provider disconnect and switch-off cases to expect zero removals and keep
  their refusal and local-state assertions. The old cleanup-failure case loses its trigger.
  Keep its exact 409 body and empty-table check in the remaining fake-provider disconnect case.
  List these changed assertions in the PR.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts` and read the
  count. The same file exercises explicit Unpair, Delete and concurrent adoption. Delete the
  completed backlog bullet in `docs/backlog.md`. Check Lane H's payments-route changes again
  before finishing and resolve overlap on rebase. Run two Claude branch reviews before opening
  the PR because the change concerns overlapping requests.

Expected change is about 1–5 production lines and 50–80 new test lines, with roughly 45
obsolete test lines removed. Existing Add wording and provider interfaces stay as they are.
