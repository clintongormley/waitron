# A1611. Wait for the old handover listener before restarting the fixture

The controlled-handover test should restart each simulated box on its saved HTTPS origin. Keep its
existing handover, trading, filing and genuinely-offline checks. The watcher assigned A1611 on
26 November 2026 at 17:58 in Lane I’s queue and `questions.md` under the owner’s 31 October CI rule.

In [#4428’s shard 15](https://github.com/clintongormley/waitron/actions/runs/45860897596/job/140052138966),
M1’s port 34157 was still taken after the eight-second stepdown deadline. Requests still reached the
stepped-down M1 after the failed bind. A local control held one shutdown step open. The second
`close()` returned, M1’s `/api/node` still reported its previous state, and reserving its port failed
with `EADDRINUSE`. The CI log identifies the listener. The shutdown step that overran is unknown.

- [ ] In `apps/server/src/handover-controlled.e2e.test.ts`, use `vi.mock` with `importOriginal` to
  wrap the real `stepDown`. Pass through its dependencies, including the original gate. Record its
  actual close promise by node id and attach a rejection handler while retaining the original result.
  After M1’s restart signal, await that promise before reading its closed store or rebinding. Give
  the wait a named 40-second fixture deadline and budget it in `STEPDOWN_MS`. Use the same bound in
  teardown. Remove the scratch folder only after shutdown settles. Keep the production deadline.
- [ ] In that file, keep the first-start holders and give each later start a fresh holder on the
  saved port. Adopt it with `startWithRetainedListeners` during boot. Keep the holders in fixture
  cleanup and leave M1’s port empty for the existing offline check. The port can still be taken
  between shutdown and reservation. Keep all current assertions and leave the other A80 callers.
- [ ] Replay the delayed-shutdown control, releasing the held step after the restart signal. Check
  that M1 rebinds and reports restricted. Run all cases in `handover-controlled.e2e.test.ts`,
  `handover-stepdown.test.ts` and `testing/retained-http-listener.test.ts`. Also run the unchanged
  fiscal `write-path.e2e.test.ts` and `inmutabilidad.test.ts` for Lane I’s rule on handover tests that
  exercise filing. Check the Server shard that includes this fixture in PR CI.
- [ ] Update the A80 entry in `docs/backlog/ci.md` with the occurrence, the remaining rebind gap and
  the unknown slow shutdown step. CI’s ordinary run checks the handover and listener behavior. The
  deliberate late-close replay is a local check. Put the replay command and result in the PR.

Expected change is zero production lines, about 35–55 fixture lines added and 5–10 removed, and a
short backlog edit. The local control lives in Lane I’s `receipts/a1611-handover-rebind-20261126/`.
