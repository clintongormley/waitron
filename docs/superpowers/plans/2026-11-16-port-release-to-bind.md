# Port release-to-bind — bounded first slice

Sol/high draft; source audit at `213d0ec3bc530a52cecf41b61d74150702d072d1`, no tests/probes run. Request: Lane I `queue.md`, PORT-RELEASE-TO-BIND; verbatim `~/waitron-campaign-i/receipts/port-release-to-bind-20261116/ask.md`. Claude reviewed this proposal once (192 seconds); watcher scope clearance is pending. No build is authorised.

**Proposed finish line:** publish the caller audit and remove the initial free-then-bind gaps at seven allocations in five regular-CI fixtures, keeping every response, origin, collision and cleanup assertion. Bench stays unchanged/open. After Claude reads this plan, ask the watcher to clear this partial server-fixture slice; that scope question does not authorise building before clearance.

**Audit:** 85 operational caller files, 229 allocation expressions: 160 already bind-time, 35 configured, 25 gaps, nine mixed. Nine fiscal-prefix files/13 expressions belong to Lane L. Saved `~/waitron-campaign-i/receipts/port-release-to-bind-20261116/{audit.tsv,direct-bind-audit.tsv,audit-notes.md}` account for aliases, self-tests/imports and 80 direct-bind statements. A literal-call scan checks the saved totals. Classifications are source inferences; uncertain rows are marked unverified.

**Build only this set** (all paths below are under `apps/server/src/`):

| File / current allocation | Smallest fixture change |
| --- | --- |
| `till-device-proof.test.ts:97` | Hono binds zero; login/requests use its actual address. |
| `till-api.deliveries.test.ts:475` | Hono binds zero; await listening inside the existing `try`, then read its actual port for requests. |
| `unpaid-departure-kitchen.test.ts:434` | TCP sink binds zero before its actual port is saved on the printer. |
| `venue-zone-repair-api.test.ts:475` | Serve on zero, open `try`, await listening and derive origin; mount routes before the first request, preserving cookie/GET/POST and closing in `finally`. |
| `landing-listener.test.ts:81,119,155` | Install `adoptRetainedListeners([held])` from `testing/retained-http-adoption.mjs` before start; await `bound`. Always restore in `finally`; close handle, then held listener only if still listening. One-entry adoption restores itself before the second collision bind. Keep `held.port` assertions; zero remains disabled. |

Reuse existing listeners; no new helpers, protocols or guards. Leave `testing/ephemeral-listener.ts` and `ephemeral-server-fixture.ts` unchanged: their default rewrites every Hono listener and reports the last. Selected files run in `test-server` (`ci.yml:1273`); full-disk/stream/AWS cases have separate scheduling/exclusions. Frequency ranking and whole-conversion size remain unverified; this five-file cut is a proposed split, not an established necessity.

**Checks:** caller assertions stay unchanged; `testing/retained-http-listener.test.ts` owns adoption/refusal/release. No permanent occupied-port control. For TDD, propose one disposable ten-second-bounded probe with explicit error handling: the held requested port makes the existing fixture fail with `EADDRINUSE`; the converted fixture's existing cases then pass on its actual port. Watcher must settle review F6's recommendation to drop that extra probe. Run the five named files and helper suite with `pnpm --filter @waitron/server exec vitest run`; read counts, then normal hook/scoped CI. No whole-workspace run.

**Bench remains open:** `bench/sqlite-failover/src/unreachable-store.ts:38` supplies `Store.endpoint` to `litestream.ts:148`, via `scenarios/s4_offline_load.ts:351` and `probes/restart-after-foldback.ts:84`. Keep it unchanged in this slice. Startup refusal at port 1 does not deliver an endpoint that stays refused. Its later design must preserve the existing bounded `probeRefusal` requirement for actual `ECONNREFUSED`; neither port 0 nor an assumed-free fixed port establishes lifetime refusal. No socket-holder/process design or impossibility claim is made here. Ask the watcher to clear leaving this requested outcome open after Claude's plan read.

**Remaining:** fiscal `first-fiscal-*`/`fiscal-*`/`hour-*` to Lane L; all other fiscal behaviour untouched. Other gap files: `boot.conflict-recovery.test.ts`, `handover-browser.e2e.test.ts`, `print-agent-e2e.test.ts`, `promote-endpoint-e2e.test.ts`, `spare-store.test.ts`, `start-full-disk.e2e.test.ts`. Configured/mixed rows keep address/origin/release assertions. Production validation, same-process rebinds and Cloud remain out of scope. During build, publish remaining gap/configured/mixed rows by file:line and every fiscal row in the A80 entry; bind-time rows may be one count. Narrow that entry and the index; retain unresolved bench/Cloud/fiscal work.

**Size estimate, additions/removals:** production and bench source `0/0`; tests/fixture setup `+95–125/−40–60`; shared test support `0/0`; docs including this plan and grouped audit table `+145–175/−15–25`. Total about 295–385 changed lines; estimates are not a measured diff. One PR if the split is cleared; return material growth to the watcher.

**Scope gate from Claude (F1/F2):** this five-file proposal is not cleared. Before build, the watcher settles whether to widen to all regular-CI non-fiscal gaps within about 700 lines, using per-file route/job/size estimates for the six remaining files above, and whether the independent bench outcome gets a separate watcher-owned item. Do not use this unmeasured split as a necessity claim.
