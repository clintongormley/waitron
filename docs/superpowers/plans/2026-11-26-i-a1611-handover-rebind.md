# A1611. Wait for the old handover listener before restarting the fixture

The controlled-handover test should restart each simulated box on its saved HTTPS origin. Keep its
existing handover, trading, filing and genuinely-offline checks. The watcher assigned this fixture
on 26 November 2026 at 17:58 in Lane I’s queue and `questions.md`.

In [#4428’s shard 15](https://github.com/clintongormley/waitron/actions/runs/45860897596/job/140052138966),
M1 listened on port 34157. Its shutdown hit the eight-second stepdown deadline, the restart failed
to bind that port, and requests still reached the stepped-down M1. A local control held one shutdown
step open. The test’s second `close()` returned, M1 still answered `/api/node` with its old state,
and an attempt to reserve that port failed with `EADDRINUSE`.

- [ ] In `apps/server/src/handover-controlled.e2e.test.ts`, wrap the real `stepDown` in the test to
  capture the actual close promise for the old start. Wait for it after M1’s restart signal and
  before reserving its port or reading its closed store. Reuse the fixture’s stage deadlines and
  also await that close in teardown. Keep the real stepdown deadline and server shutdown code.
- [ ] In the same file, keep the first-start holders and give each later `start` a fresh holder on
  the box’s saved port, then use `startWithRetainedListeners` for the real HTTPS bind. Keep holders
  in fixture cleanup, and keep M1’s port closed during the existing offline check. Keep setup,
  origins, certificates and all current assertions. Leave other A80 callers for their own work.
- [ ] Replay the delayed-shutdown control. The old fixture failed to reserve M1’s port while the
  previous server still answered. Release the held shutdown step after the restart signal in the
  replay and check that M1 rebinds and reports restricted. Run all cases in
  `handover-controlled.e2e.test.ts`, `handover-stepdown.test.ts` and
  `testing/retained-http-listener.test.ts`. Run the unchanged fiscal `write-path.e2e.test.ts` and
  `inmutabilidad.test.ts` suites. The retained-listener suite owns socket release and adoption
  checks. The controlled-handover suite owns the same-origin restart and its offline period.
- [ ] Record the occurrence and its resolution in the A80 section of `docs/backlog/ci.md`. Keep the
  remaining saved-origin audit there. Check the Server shard that includes this fixture in PR CI.

Expected size is zero production lines, about 35–55 added fixture lines with about 5–10 removed,
and one short backlog edit. The temporary delayed-shutdown control stays with the campaign receipts.
