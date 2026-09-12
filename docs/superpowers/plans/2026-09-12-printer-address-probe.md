# A3 execution plan

1. Reproduce the absent dashboard-to-agent address-check path with a failing route test.
2. Add bounded transient probe targets and the authenticated agent wire field, with expiry and input
   checks. Keep the existing discovery and registration contracts.
3. Add the byte-free TCP host operation and agent reporting; test real sockets and isolated failures.
4. Add the localized dashboard form and fresh-result feedback; test lifecycle and accessibility.
5. Run affected coverage, build the print agent/dashboard, run the repository gate and update backlog.

Design: [Check a printer address](../specs/2026-09-12-printer-address-probe-design.md).

## Verification receipts (2026-09-12)

- The new route test first received 404; its implemented route returns a bounded target which an
  approved agent receives on its next job pull.
- `pnpm --filter @waitron/server test src/print-agent-e2e.test.ts` passed both tests. The added test
  queues a loopback address, runs the real agent wire client and TCP probe, checks that the listener
  received zero bytes, reads the discovery result and registers it through the existing route.
- Removing the fresh-timestamp comparison changed the browser's Waiting result to Address reachable
  on stale inventory. Removing the generation check from the old poll's `finally` started an extra
  request while the new poll remained pending. Each corresponding regression failed, then passed
  with its guard restored.
- Removing the probe route's `gated` call made the real-PostgreSQL staff-permission assertion fail
  (expected 403). The restored route passed the unauthenticated, staff and manager cases.
- TCP tests cover a real listener and refused port, a silent socket deadline, zero bytes, bounded
  fan-out and isolation of individual connection failures. These are software/loopback receipts;
  the venue's routed network and physical paper output have not been exercised by this branch.

- All affected package coverage suites passed: `@waitron/print-agent` (91 tests),
  `@waitron/print-agent-app` (116), `@waitron/server` (3,086) and `@waitron/dashboard` (1,672).
  Their configured coverage thresholds passed. Dashboard accessibility checks include the new
  form's empty and invalid states in light and dark themes.
- `TESTCONTAINERS_RYUK_DISABLED=true pnpm test` passed for the root project and the entire workspace.
  Dashboard and print-agent application builds passed. Lint passed across the repository, and the
  final dashboard edits also passed focused lint. The root `pnpm typecheck` and
  `pnpm format:check` passed after all implementation changes.

## Finish-branch review

Rebased onto `5a0bcb28` (#332); resolved the comment-only print-agent test-config conflict using
main's wording and retained its development-launcher coverage exclusion.

The Claude run-it review reproduced a clock-skew defect: an agent 100 seconds ahead skipped a
request, while one 100 seconds behind retained it past its intended lifetime. Both driver regressions
failed before the fix and pass with server-supplied remaining durations translated to local agent
deadlines. The agent still drops expired cached requests even when a subsequent pull fails.

The permission test now sends a valid address body for staff as well as managers. Deleting the
probe route's permission check returns 200 instead of the expected 403. The real TCP-refusal test
freezes deadline timers; swallowing its socket-error event now fails by timeout, so deadline expiry
cannot satisfy the refusal assertion. Registry ownership is explicit, and the stale route-count
comment is removed. The existing active/disabled browser regression covers the review's unverified
Add again concern; whole-workspace type checking covers required Host implementations.

The post-rebase whole-repository gate passed. Review corrections passed the 93-test agent package
(with coverage), 102 server/helper/route/integration tests and five TCP tests. Both server and print-agent application builds passed. The initial server typecheck failed, as recorded below. The normal pre-push hook supplies
the final affected-package coverage gate before the PR.

The first push was correctly refused: all affected coverage suites passed, but the local `PullReply`
type in `print-api.test.ts` omitted `networkProbes`. A cast added during review fixes produced
TS2352. The earlier shell sequence ran the build after that typecheck failed, masking its exit
status; its apparent success was not a passing typecheck. The response type now includes the
shared `NetworkProbe` type, and the cast is removed. The fail-fast command
`pnpm --filter @waitron/server typecheck && TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/print-api.test.ts`
passed, including all 50 route tests. The normal hook is retried without bypassing any step.

## Review after the dashboard restyle

Main advanced with an overlapping dashboard strings change (#333), so the branch was rebased onto
`b16bd492` and reviewed again in a fresh isolated candidate. The second review identified a missing
failover test: removing the server-binding guard still passed the previous agent suite. A new test
first probes through A, promotes B, and asserts that B receives no old probe or scanned row. Deleting
the guard now fails at the unexpected probe call; the intact 38-test agent suite passes.

A real-input browser test now checks Enter, repeated submission while pending and retry after a
rejection. Removing the Enter handler fails at zero requests instead of one. The design explicitly
states the permitted unicast address space, and the route retains a concise error-registry invariant.
The review's requested host-level deduplication was declined: the server queue already normalizes and
deduplicates its eight targets; malformed injected arrays remain bounded but are not promised to be
salvaged beyond the cap. The historical Epson/dns-sd receipt remains in the cited central-printer design.
