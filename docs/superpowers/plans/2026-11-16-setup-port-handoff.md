# Setup port handoff implementation plan

**Draft; execute inline with `superpowers:executing-plans` only after Claude plan review and watcher clearance.** Neither has happened in this drafting invocation. No owner design approval is claimed.

**Ask**, verbatim from `/Users/clintongormley/waitron-campaign-i/queue.md`, PORT-HANDOFF-SETUP:
> "The remaining work includes in-process setup/recovery suites outside the migrated `boot*` siblings, such as `setup-tool-download.boot.test.ts`. Audit each case's origin and listener-release assertions before choosing the bind-time fixture." and "`bench/sqlite-failover/src/unreachable-store.ts` still releases a port intended to stay unreachable. Another worker can bind it later."

**Finish line:** setup tests select ports while binding or retain their initial sockets; the bench’s offline endpoint refuses TCP connections without releasing a chosen port. Preserve existing behavioural assertions. Leave `first-fiscal-*`, `handover-*`, `hour-*` and Cloud's external pairing runner untouched. No production parser/server changes, containers, firewall manipulation or deliberately broken CI.

## 1. Convert setup callers, preserving their contracts

- [ ] Refresh the supplied `open-branches.json` and `uncommitted-reservations.json` reservations before editing; reconcile overlapping changes without touching another checkout. Read the TDD skill before code. Record per-case fixture choices in the PR.
- [ ] Reuse `apps/server/src/testing/{ephemeral-listener,ephemeral-server-fixture,retained-http-listener}.ts` and `retained-http-adoption.mjs`. Boot keeps positive environment configuration; only actual Hono binding receives zero. Wait for binding and read `listener.port`; refresh destinations after every restart. Direct `serveRecovery` calls can receive zero and expose `server.address()`, without a global mock. Retain configured sockets when advertised addresses or same-port rebinding matter; close the reservation's copy after adoption so final listener-release assertions remain meaningful. Restore interception and close reservations on failures. Do not use the default last-listener fixture for paired listeners.

All filenames below are under `apps/server/src/`; each retains these properties because they are the case's observable contract:

| File | Choice and preserved properties |
| --- | --- |
| `setup-tool-download.boot.test.ts` | Ephemeral boot; real wizard build, trusted HTTPS, retired-tool 404, unclaimed status, assets. |
| `first-setup-entry.test.ts` | Fixed positive configuration with bind interception; exact `setup.attempt_invalid` and `setup.attempt_uncertain` refusals before binding. |
| `first-setup-workspace.test.ts` | Same refusal-only approach; `setup.start_again_incomplete` and unchanged files. |
| `first-setup-growth.test.ts` | Ephemeral on every start; successful activation, health, setup 404, growth beyond 128 MiB, no whole-database reads, unchanged completed record. |
| `first-setup-key-reissue.boot.test.ts` | Ephemeral each restart; refresh URL; password refusal, unchanged attempt, replacement verifier and old-key rejection. |
| `first-setup-resolution.boot.test.ts` | Supervised injected recovery uses zero directly; direct entry uses bind interception; keep both modes, refusal pages, restart counts and filesystem outcomes. |
| `first-setup-resolution.route.test.ts` | Ephemeral ordinary routes with actual same-origin headers; retain configured loopback-guidance listener so advertised host/port stays exact; preserve HTTPS/forwarded-HTTP refusals and unchanged records. |
| `first-setup-start-again-hour.test.ts` | Direct recovery zero/address; keep HTTPS restart without a register declaration and fiscal assertions. |
| `first-setup-stop.route.test.ts` | Direct Hono zero/address for extra HTTP listener; keep forwarded-HTTPS refusal and no writes. |
| `connection-bootstrap.entry.test.ts` | Direct standalone recovery zero/address; supervised injection likewise. Retain initial paired/configured repair listeners; preserve same-port continuation/retry, advertised destinations, exact valid/forged origins, CA trust and handle-close release of main/landing. Stub-only admission cases need fixed positive configuration, no reservation. |

- [ ] TDD ownership: one converted ordinary boot case holds a competing configured-port listener before boot; observe its current failure, then actual-port success. Existing retained-helper tests own socket adoption. Connection-bootstrap owns repair/rebind/release; do not replace those assertions with fixture assertions. Run each changed suite.

## 2. Hold the bench's refused endpoint

- [ ] First test the smallest candidate in a disposable probe: use literal loopback TCP port zero as the unreachable destination, without allocating or releasing a port. This is a hypothesis, not a verified guarantee. Keep `probeRefusal(0)` and verify that the real pinned Litestream, the store URL/config path and a real SDK request preserve port zero and fail at that endpoint rather than defaulting to another port. Include a live-listener negative control that the refusal probe must reject. If that route fails, return the evidence and a concrete alternative to the watcher before adding infrastructure.
- [ ] If that probe succeeds, add `scripts/unreachable-store.test.ts` first, asserting repeated real ECONNREFUSED answers and that the helper never listens/closes a chosen ephemeral port; observe the old allocation fail this contract, then remove `reservePort` in `bench/sqlite-failover/src/unreachable-store.ts`. Keep `probeRefusal`, return shape, SDK client and stop cleanup. Preserve silent-store behaviour and existing throwing operations. Audit the two callers `src/scenarios/s4_offline_load.ts` and `src/probes/restart-after-foldback.ts`; narrow stale allocation prose and retain the measured scope.
- A bound-but-not-listening Python child was considered; it would add a prerequisite and lifecycle code. It is outside this plan unless the watcher separately clears it after the simpler endpoint is falsified. No private Node internals, new container or firewall rule.

## 3. Verify and narrow the backlog

Run from the checkout, then inspect actual test counts:

```sh
pnpm --filter @waitron/server exec vitest run src/setup-tool-download.boot.test.ts src/first-setup-entry.test.ts src/first-setup-workspace.test.ts src/first-setup-growth.test.ts src/first-setup-key-reissue.boot.test.ts src/first-setup-resolution.boot.test.ts src/first-setup-resolution.route.test.ts src/first-setup-start-again-hour.test.ts src/first-setup-stop.route.test.ts src/connection-bootstrap.entry.test.ts src/testing/retained-http-listener.test.ts
pnpm exec vitest run scripts/unreachable-store.test.ts
pnpm --filter @waitron/bench-sqlite-failover typecheck
```

No full bench/Litestream workload. Narrow `docs/backlog/ci.md`'s A80 entry and `docs/backlog.md`'s index to excluded suites and Cloud. Audit touched prose. Finish one PR through normal hooks, Claude run-it review and current-head CI.

**Forecast:** production 0; bench code +5/−35; tests +180/−160; support +20/−5; docs +80/−15: about 500 changed lines, within 300–700. At most three active hours; report deviation above 750 lines or a material scope change before continuing.
