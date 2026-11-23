# Check whether disconnecting SumUp undoes an in-flight reader pairing

**Finish line.** Find out whether disconnecting SumUp leaves the reader registered there when
Waitron refuses to save it. If it does, give the watcher the test and its result before deciding
whether the backlog item needs a fix.

- [ ] In `apps/server/src/payments-api.test.ts`, add “keeps the SumUp registration when disconnected
  before the pair response.” Reuse `mountApp`, `seedVenueWithStaff`, the real SumUp seat and the
  existing HTTP fixture used by the SumUp unpair tests. Have the stub record the new registration
  on the pair POST and call the real Disconnect route before returning the pair response. Record
  provider DELETE calls and clear the fake registration on DELETE.
- [ ] Assert Disconnect returned 204, Add returned 409 `reader.provider_disconnected`, Waitron
  saved no reader row, and the provider retained the registration with zero DELETEs once Add
  returned. A DELETE and a missing registration reproduce the backlog report. Run
  `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts -t "keeps the SumUp registration when disconnected"`.
- [ ] Save the test and run output in Lane F's receipts and record the result in `progress.log`.
  If the test reproduces the report, take the evidence and a small fix plan to the watcher. If the
  provider keeps the reader, take that result to the watcher before any backlog or product change.

**Scope and size.** About 40–70 test lines and no product changes in this probe. A reconnect could
replace the credential between Add's local refusal and the undo's credential read. Switching
the provider off also reaches that undo while keeping its credential. Claude identified both
paths in the plan review. They need separate watcher clearance before any fix.
