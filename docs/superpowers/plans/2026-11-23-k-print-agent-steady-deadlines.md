# Print agent deadlines on the steady clock

A system time correction should leave discovery, typed-address checks, self-enrol retries and a
pending reset with the same amount of time left. The setup countdown and `Host.scan` still receive
local wall-clock times. This slice of the [clock backlog](../../backlog/box.md#one-steady-clock-helper-instead-of-hand-written-clock-step-back-guards)
covers the print agent and its network sweep. The backup schedule remains listed there.

## Agent deadlines

- [ ] In `packages/print-agent/src/agent.test.ts`, use independent whole-millisecond clocks with
  distinct starting values, such as wall time `1_700_000_000_000` and steady time `5_000`.
  Replace the backward-step assertions at the former reset, discovery, address-check and scan-spacing
  cases (currently lines 1035, 1642, 1671 and 2712). Before, a backward step ended those waits or made
  the next scan due early. Now a wall step either way leaves the waits in place. Check a failed
  pull retains the discovery cutoff and assert the projected wall deadline handed to `scan`.
  Check both scan and probe spacing while the live loop runs. Once an address expires, assert both
  the next check and the old discovered device are absent. Check that a second Begin keeps the
  reset cutoff, the displayed deadline reflects the time left, and only elapsed expiry clears
  the token. Keep the immediate first self-enrol retry and its 30-second spacing across a wall step.
  Assert one millisecond before and at the relevant cutoffs. Exercise the default clock in a
  behavior case and retain cancellation, reconnect, server-change and late-result assertions.
- [ ] Run `pnpm --filter @waitron/print-agent exec vitest run src/agent.test.ts` and observe the old
  wall-driven behavior fail. Retarget the scan clock-failure fixture to the wall reading made when
  projecting the deadline, with the same warning and no-scan assertions.
- [ ] In `packages/print-agent/src/agent.ts`, use `AgentOptions.steady` for all of those deadlines.
  Compare the steady time directly with each deadline. Remove the backward-step clause in
  `passed()`, `discoveryLength` and the redundant length on found probes. Keep the inclusive cutoff,
  reset and refresh points and wall-clock job timestamps. Use a shared `steadyNow(): number` default
  exported through `packages/print-agent/src/index.ts`. The app already depends on that package,
  which can provide one reader for both without depending on another workspace package.
- [ ] Project the remaining time onto `host.now()` in `setupSnapshot` and inside `discover`'s existing
  error handler before calling `host.scan`. Document the clock domains in `AgentOptions`,
  `AgentSetupSnapshot` and `packages/print-agent/src/host.ts`. Rerun the same agent tests and record
  changed assertions in the PR.

## Network sweep

- [ ] In `apps/print-agent/src/linux-devices.test.ts`, move the wall clock during USB discovery and
  between dial batches in the real scan path. Assert the time that remains at the first dial,
  subsequent bounded timeouts and expiry on the steady clock. In `sweep.test.ts`, replace the
  backward-allowance assertion (currently line 36) with the elapsed cutoff. Keep partial hits
  and the per-dial cap assertions. Run both files against the old behavior.
- [ ] In `apps/print-agent/src/linux-devices.ts`, translate the wall deadline to a steady deadline
  at `scan` entry before asynchronous work. Pass that deadline through the internal scan paths,
  including the test-only injected scan. Name the numeric cutoff `steadyDeadline` and the injected
  reader `steady`. In `apps/print-agent/src/sweep.ts`, use the shared reader by default, remove the
  backward allowance, and give each dial the lesser of its cap and the time remaining. Keep the
  existing no-deadline behavior, mDNS, subnet and concurrency limits, and results already received.
  A wall step between the caller's projection and the host's conversion can shift that scan's
  cutoff. The required wall-clock boundary carries only the projected date.
- [ ] Run `pnpm --filter @waitron/print-agent-app exec vitest run src/linux-devices.test.ts src/sweep.test.ts src/setup-page.test.ts`.
  Typecheck both packages and rerun the held-discovery and typed-address cases in
  `apps/server/src/print-agent-e2e.test.ts`. Record the red and green runs. Update the historical
  print-agent clock row with a dated note in `docs/developers/conventions-data.md`. Drop the completed
  bullets in `docs/backlog/box.md` and their mention in `docs/backlog.md`.

Estimate 50–85 added and 35–60 removed production lines, and 170–240 added and 90–145 removed test
lines. The existing dependency, in-memory state and wire durations are sufficient.
