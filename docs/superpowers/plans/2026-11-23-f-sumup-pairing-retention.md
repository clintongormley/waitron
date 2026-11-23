# Keep a SumUp reader available after a refused Add

When a manager pairs a reader and a fast SumUp reconnect or provider switch-off prevents
Waitron from saving it, the manager still gets the existing refusal. Once SumUp is connected
and enabled, the manager can select the existing registration in Add and adopt it. If another
manager is already adopting that registration, the refused Add leaves it in place.

The real-client probe recorded two cases where Add's automatic DELETE reached SumUp. A
plain disconnect sent no DELETE. The watcher cleared the fix for the two reproduced paths
on 23 November at 20:06 in Lane F's `questions.md`.

- [ ] In `apps/server/src/payments-api.test.ts`, reuse the probe's real routes, SumUp client and
  fake HTTP provider. Hold the reconnect response until Add reaches its save check, so the check
  sees the disconnected state and the old cleanup would use the replacement credential.
  Check the existing 409 code, the absent local row, zero provider DELETEs, and a successful
  Adopt from the retained registration. In the switch-off case, switch off before the pair
  reply and check its 409 code, no local row, and zero DELETEs. Enable SumUp again and show
  that the registration can be listed and adopted. Record that the two new cases fail on
  registration retention before touching the route. Use the existing overlap probe as evidence
  that a DELETE can invalidate another manager's successful Adopt.
- [ ] In `apps/server/src/payments-api.ts`, drop the automatic provider removal when Add's
  post-pair save check refuses. Keep the checks, refusal codes, and the explicit Unpair and
  Delete paths. The existing available-readers and Adopt routes handle the retained registration.
- [ ] Update the fake-provider disconnect and switch-off cases to expect zero removals and keep
  their refusal and local-state assertions. The old cleanup-failure case loses its trigger.
  Keep its exact 409 body and empty-table check in the remaining fake-provider disconnect case.
  List these changed assertions in the PR.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts` and read the
  count. The same file exercises explicit Unpair, Delete and concurrent adoption. Delete the
  completed backlog bullet in `docs/backlog.md` and run the two Claude branch reviews before
  opening the PR because the change concerns overlapping requests.

Expected change is about 1–5 production lines and 100–150 new test lines, with roughly 45
obsolete test lines removed. Existing Add wording and provider interfaces stay as they are.
