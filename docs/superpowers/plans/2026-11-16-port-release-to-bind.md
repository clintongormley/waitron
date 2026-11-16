# Port ownership in server test fixtures

**Finish line:** remove the initial released-port gaps in ten fixtures and publish the caller audit. Reuse existing helpers; change no production, shared support, fiscal assertions or CI. Sol/high drafted; Claude initial read 192 seconds. Watcher direction on 16 November 23:24 permits widened scope, one disposable control and a separate bench backlog entry. The real-Go remainder below awaits watcher settlement; no build yet.

**Audit:** source base `213d0ec3bc`; 85 operational files/229 expressions: 160 bind-time, 35 configured, 25 gaps, nine mixed. Nine fiscal-prefix files/13 expressions stay with Lane L. Saved `audit.tsv`, `direct-bind-audit.tsv` and `audit-notes.md` in `~/waitron-campaign-i/receipts/port-release-to-bind-20261116/` give source inferences, not runtime verification. Publish remaining configured/mixed/gap call lines and every fiscal row; group bind-time rows. Preserve address, origin, listener-release and saved-row assertions.

Fixture paths below are under `apps/server/src/`. S = ordinary `test-server`; T = ordinary `test-server-stream` (`ci.yml:1274–1290,1436–1451`). Separate scheduling does not defer a file. Estimates count additions/removals, not net growth.

| File / allocation line(s) | Change using existing fixtures | Job | + / − estimate |
| --- | --- | --- | --- |
| `till-device-proof.test.ts:97` | Hono binds zero; login/requests use its bound address. | S | 8–12 / 3–5 |
| `till-api.deliveries.test.ts:475` | Bind zero, wait/read actual address inside existing `try`. | S | 6–10 / 3–5 |
| `unpaid-departure-kitchen.test.ts:434` | TCP sink binds zero before its port is saved. | S | 5–8 / 3–5 |
| `venue-zone-repair-api.test.ts:475` | Serve zero, open `try`, wait, derive origin, mount before first request. | S | 10–16 / 6–10 |
| `landing-listener.test.ts:81,119,155` | Retain/adopt positive socket before start; await `bound`. Restore always; close handle then holder. Adoption restores before intentional collision. | S | 36–48 / 9–15 |
| `boot.conflict-recovery.test.ts:72` | Existing `ephemeralHttpMock`/`ephemeralServerFixture`; request actual `httpPort()`. | S | 12–18 / 4–6 |
| `handover-browser.e2e.test.ts:218` | Retain/adopt immediately before first boot; restore and close holder after first shutdown, before unchanged same-origin restart. Outer cleanup handles failure. | S | 22–32 / 2–4 |
| `print-agent-e2e.test.ts:1014` | Bind recording sink zero before saved-row query; close/retry named candidates (20 attempts), close on query failure. HTTP binds zero; derive base inside cleanup scope. | S | 36–50 / 14–24 |
| `promote-endpoint-e2e.test.ts:387,474,591,719` | Existing ephemeral mock/fixture; capture base after each boot, preserving arguments/seams and fiscal checks. | S | 28–42 / 8–14 |
| `spare-store.test.ts:275` | Unresolved: Go gets configured `--port` and URL (`spare-store.ts:84–134`); existing Node adoption cannot supply its socket. No demonstrated fixture-only route. | T | Undesigned |
| `start-full-disk.e2e.test.ts:1115,2263` | Retain/adopt positive sockets before `runEntry`, explicit loopback host, await bind. Restore always; close served listener then holder. | T | 28–40 / 4–8 |

**Scope settlement:** ask the watcher to leave the real-Go gap explicit in the existing server-port backlog; do not fake Go, rename the gap configured, or invent a socket protocol. All ten supported conversions fit, so there is no size-based cut. Leave fiscal prefixes, production validation, later same-process rebinds and Cloud untouched. Split the requested bench lifetime-refused endpoint into its own CI backlog line/index pointer, preserving bounded `probeRefusal` for actual `ECONNREFUSED` and the SDK/Litestream consumers.

**Sequence/checks:** settle that remainder, take the sole Claude correction read, then build. First run one disposable occupied-port control under a ten-second outer deadline, with an explicit error handler before binding; observe old `EADDRINUSE`, then converted behavior on its actual port. It does not establish the historical race's cause/frequency. Delete it before commit. Run the ten changed files plus `src/testing/retained-http-listener.test.ts` with `pnpm --filter @waitron/server exec vitest run`; existing helper tests own handoff/refusal/release, callers keep their assertions. Use the real small-filesystem harness for full-disk cases and measured browser headroom. Then normal finish review, hook, selected current-head S/T CI and authorised landing; no local whole-package run.

**Size:** fixtures +191–276/−56–96; docs (new plan, audit/backlog/index) +129–169/−16–27; production/shared support/bench/CI 0. Total 392–568 repository changed lines, estimated. Per-file rationale is in `scope-estimates.md` beside the saved audit. Return a new mechanism or material growth to the watcher before building it.
