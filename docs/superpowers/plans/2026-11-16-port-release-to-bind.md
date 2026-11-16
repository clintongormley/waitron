# Port release-to-bind — bounded first slice

Sol/high draft; source audit at `213d0ec3bc530a52cecf41b61d74150702d072d1`, no tests/probes run. Request: Lane I `queue.md`, PORT-RELEASE-TO-BIND; verbatim `~/waitron-campaign-i/receipts/port-release-to-bind-20261116/ask.md`. Claude plan review and watcher clearance precede inline TDD; neither has happened.

**Proposed finish line:** publish the caller audit and remove the initial free-then-bind gaps at seven allocations in five regular-CI fixtures, keeping every response, origin, collision and cleanup assertion. Bench stays unchanged/open. After Claude reads this plan, ask the watcher to clear this partial server-fixture slice; that scope question does not authorise building before clearance.

**Audit:** 85 operational caller files, 229 allocation expressions: 160 already bind-time, 35 configured, 25 gaps, nine mixed. Nine fiscal-prefix files/13 expressions belong to Lane L. Saved `~/waitron-campaign-i/receipts/port-release-to-bind-20261116/{audit.tsv,direct-bind-audit.tsv,audit-notes.md}` account for aliases, self-tests/imports and 80 direct-bind statements. A literal-call scan checks the saved totals. Classifications are source inferences; uncertain rows are marked unverified.

**Build only this set** (all paths below are under `apps/server/src/`):

| File / current allocation | Smallest fixture change |
| --- | --- |
| `till-device-proof.test.ts:97` | Hono binds zero; login/requests use its actual address. |
| `till-api.deliveries.test.ts:475` | Hono binds zero; await listening before constructing requests. |
| `unpaid-departure-kitchen.test.ts:434` | TCP sink binds zero before its actual port is saved on the printer. |
| `venue-zone-repair-api.test.ts:475` | Bind Hono first; its actual origin supplies route configuration, cookie and browser GET/POST. |
| `landing-listener.test.ts:81,119,155` | Reuse `retainHttpListener` and same-process `adoptRetainedListeners` from `testing/retained-http-adoption.mjs`; retain the positive configured port. Await adoption; restore interception before the collision's second bind; close both resources. Zero remains disabled. |

Reuse existing listeners; no new helpers, protocols or guards. Leave `testing/ephemeral-listener.ts` and `ephemeral-server-fixture.ts` unchanged: their default rewrites every Hono listener and reports the last. Selected files run in `test-server` (`ci.yml:1273`); full-disk/stream/AWS cases have separate scheduling/exclusions. Frequency ranking and whole-conversion size remain unverified; this five-file cut is a proposed split, not an established necessity.

**Checks:** first take `retainHttpListener().port` as the requested port in `till-device-proof` setup, keeping that holder open; observe the existing Hono bind fail with `EADDRINUSE`. After conversion, existing login/device-proof checks pass at a different actual port. Keep this single occupied-port control. Callers retain domain assertions; unchanged `testing/retained-http-listener.test.ts` owns exclusion, adoption, address refusal and release—no duplicate cases. Run `pnpm --filter @waitron/server exec vitest run` naming these five files and that helper suite; read counts. Normal hook/current-head scoped CI follow; no whole-workspace run.

**Bench remains open:** `bench/sqlite-failover/src/unreachable-store.ts:38` supplies `Store.endpoint` to `litestream.ts:148`, via `scenarios/s4_offline_load.ts:351` and `probes/restart-after-foldback.ts:84`. Keep it unchanged in this slice. Startup refusal at port 1 does not deliver an endpoint that stays refused. Its later design must preserve the existing bounded `probeRefusal` requirement for actual `ECONNREFUSED`; neither port 0 nor an assumed-free fixed port establishes lifetime refusal. No socket-holder/process design or impossibility claim is made here. Ask the watcher to clear leaving this requested outcome open after Claude's plan read.

**Remaining:** fiscal `first-fiscal-*`/`fiscal-*`/`hour-*` to Lane L; all other fiscal behaviour untouched. Other gap files: `boot.conflict-recovery.test.ts`, `handover-browser.e2e.test.ts`, `print-agent-e2e.test.ts`, `promote-endpoint-e2e.test.ts`, `spare-store.test.ts`, `start-full-disk.e2e.test.ts`. Configured/mixed rows keep address/origin/release assertions. Production validation, same-process rebinds and Cloud remain out of scope. During build, publish the three-class table with mixed calls split in `docs/backlog/ci.md`'s A80 entry; narrow it and the `docs/backlog.md` index, retaining unresolved bench/Cloud/fiscal work.

**Size estimate, additions/removals:** production and bench source `0/0`; tests/fixture setup `+95–125/−40–60`; shared test support `0/0`; docs including this plan and grouped audit table `+145–175/−15–25`. Total about 295–385 changed lines; estimates are not a measured diff. One PR if the split is cleared; return material growth to the watcher.
