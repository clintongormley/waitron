# A1433: keep process test ports bound until the real server owns them

**Goal:** Remove the released-port window from process-started Waitron fixtures, keeping every behavioral assertion and production port parsing unchanged.

**Authority:** Lane E queue, watcher 2026-11-08 05:09: fix this class in every process-started fixture, test-first with a deletion control; keep configured-port requirements on real boxes. The unattended runner authorises implementation, finish-branch and land-branch. No fiscal writer or protected fiscal test changes.

**Approach (driver choice):** Use Node’s existing server-handle support. A parent reserves a real TCP listener and passes it to the child over Node IPC. A test-only preload receives that handle before the entry runs and redirects only the matching HTTP bind to `server.listen(heldServer, callback)`. All other listen calls use the original method. Close the parent’s copy after transfer; the child retains the bound socket. The standalone Cloud fixture can adopt its own held handle in the same process. No production parser, new environment switch or deployment behavior changes. A local Node probe served HTTP on the held port and closed both server objects successfully; cross-process transfer still needs qualification.

## Build and verification

- [ ] Reproduce `party-allergy.restart.test.ts` with a competing listener on its released port. Retain the original CI log (42442673676/job128617500147) and local failing output. Keep original assertions.
- [ ] Test the shared fixture with real child HTTP and HTTPS listeners: a competitor cannot bind the reserved port before transfer; the child answers on exactly that port; parent and child copies close; unrelated binds retain their requested behavior. Watch failures before implementing. Put reservation, handle adoption and bounded child handoff in `apps/server/src/testing/`; reuse existing child lifecycle cleanup.
- [ ] Inventory every spawned server and its callers, including bundled entries, hour-entry workspaces, party/kitchen restart fixtures, handover crash fixtures, and `scripts/cloud-integration-fixture.ts`. Replace each released HTTP-port handoff with a retained handle; preserve restart, PID, cookie, TLS, advertised-origin and release assertions. Audit process helpers that never open HTTP separately. The bench unreachable-store endpoint is an unused-peer case, not a child HTTP listener, and stays in the existing backlog point.
- [ ] Run the migrated suites and shared helper checks. Run unchanged protected fiscal suites if the fixture paths reach their boot boundaries. In a disposable copy, remove handle adoption and observe the collision/control fail; retain the receipt, not a permanent self-mutation test.
- [ ] Update the A80 process-fixture backlog point and testing-guide instructions to match the audited result; keep genuinely separate in-process and unused-peer work. Finish the branch with the normal Claude run-it review, pre-push hook and exact-head CI, then land under the shared lock and check merge CI.

**Review focus:** Is this the simplest route that preserves fixed ports and origins? Check the cross-process descriptor lifetime, early exits, failed send/bind, partial stdout lines, HTTPS, bundled entries, and the complete spawned-listener inventory. No retries may disguise a lost-port failure. Do not close or kill another lane’s resources.
