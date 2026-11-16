# Setup port handoff implementation plan

**Goal:** stop the named setup suites releasing their intended listening ports before binding, preserving configured addresses and listener-release checks. The bench gets the smallest verified refused endpoint, or retains its current gap if the port-zero probe fails. Codex drafted this plan; Claude read it, and the watcher cleared the conditional bench cut at 07:27 on 16 November in Lane I questions.md. The watcher cleared the corrected setup-only build and stopping the falsified HTTP candidate at 08:12 on 16 November in Lane I questions.md; no owner design approval is claimed.

**Ask**, verbatim from Lane I queue.md, PORT-HANDOFF-SETUP:
> "The remaining work includes in-process setup/recovery suites outside the migrated `boot*` siblings, such as `setup-tool-download.boot.test.ts`. Audit each case's origin and listener-release assertions before choosing the bind-time fixture." and "`bench/sqlite-failover/src/unreachable-store.ts` still releases a port intended to stay unreachable. Another worker can bind it later."

## Setup callers and their contracts

- Refresh branch/uncommitted reservations before every edit; skip the queue's held/excluded `first-fiscal-*`, `handover-*`, `hour-*` and Cloud files. Reuse `testing/{ephemeral-listener,ephemeral-server-fixture,retained-http-listener}.ts` and `retained-http-adoption.mjs`, without a new fixture framework or production parser/server change.
- Keep positive configured ports entering boot. Intercept only actual binding to use port zero, reset/wait for the listener and refresh destinations at each restart. A supervised wrapper asserts its received configured port before substituting zero. Use one interception mechanism per file. Disable unused landing listeners with `WAITRON_HTTP_LANDING_PORT="0"` so the single-listener fixture observes the main listener.
- When advertised origins, configured-port refusal or same-port rebinding matter, retain the configured sockets. In-process, close the adopted listener before closing its reservation; a child-process handoff alone releases the parent's duplicate after adoption. Existing helper tests own adoption/release behaviour. Do not add another permanent competing-port test: retain one disposable pre-change failure/post-change success receipt.

All paths below are under `apps/server/src/`. Preserve every existing assertion; the PR records the fixture choice, preserved assertions and why each case needs them, per file:

| File | Choice and preserved behaviour |
| --- | --- |
| `setup-tool-download.boot.test.ts` | Ephemeral boot; real wizard build, trusted HTTPS, retired-tool 404, unclaimed status and assets. |
| `first-setup-entry.test.ts`, `first-setup-workspace.test.ts` | Fixed positive literals for refusal-only cases that never bind; exact attempt/start-again refusals and unchanged files. |
| `first-setup-growth.test.ts` | Ephemeral each start; activation, health, setup 404, growth beyond 128 MiB, no whole-database reads, unchanged completed record. |
| `first-setup-key-reissue.boot.test.ts` | Ephemeral each restart; refresh URL, password refusal, unchanged attempt, replacement verifier and old-key rejection. |
| `first-setup-resolution.boot.test.ts` | One file-wide binding interception, including supervised recovery; keep both boot modes, refusal pages, restart counts and files. |
| `first-setup-resolution.route.test.ts` | Disable unused landing listeners in all five ordinary-start cases; ephemeral ordinary routes with real same-origin headers. Retain configured guidance listener for exact advertised host/port; preserve HTTPS/forwarded-HTTP refusals and unchanged records. |
| `first-setup-start-again-hour.test.ts` | Direct recovery zero/address; keep HTTPS restart without a register declaration and all fiscal assertions. |
| `first-setup-stop.route.test.ts` | Direct Hono zero/address for extra HTTP listener; forwarded-HTTPS refusal and no writes. |
| `connection-bootstrap.entry.test.ts` | Ephemeral only for non-bootstrap recovery; retain paired/configured bootstrap and repair listeners so trust-page links and exact origins never contain `:0`. Preserve continuation/retry on the same ports, valid/forged origins, CA trust and main/landing release checks. Stub-only admission cases use fixed positive configuration. |

## Bench: probe before changing it

- First read Node’s HTTP port selection and exercise it without a network connection. The driver’s macOS Node 26.13.0 control passes port 1 through but turns port 0 into 80; the completed command/output is in Lane I `receipts/setup-port-handoff-20261116/node-zero-port-probe.log`. This falsifies the HTTP route, so the corrected plan stops that candidate here and retains the bench gap, as the watcher cleared at 08:12. Only if a candidate passes this gate, probe it on real macOS and Linux with TCP, the pinned real S3 SDK and pinned Litestream 0.5.18. Record actual attempted ports and errors; require the store URL/config and clients to preserve zero rather than default to 80. Keep `probeRefusal(0)` and a live-listener control that refusal must reject. No full benchmark workload, new container, firewall rule, keeper process or dependency.
- If any required probe fails, change no bench code and retain its backlog gap with the evidence, as the watcher cleared. If all pass, replace only allocation in `bench/sqlite-failover/src/unreachable-store.ts`, preserving `probeRefusal`, return shape, real SDK client, stop cleanup and silent-store behaviour. A small `bench/sqlite-failover/test/` suite run manually by `node --test` owns repeated real refusal and its live-listener control; bench CI does not run it. No root source-shape test. Do not try to prove refusal by binding port zero: `listen(0)` requests a different ephemeral port and does not compete for that destination.
- Audit both callers (`src/scenarios/s4_offline_load.ts`, `src/probes/restart-after-foldback.ts`), source allocation comments and `bench/sqlite-failover/README.md`'s unreachable-store explanation near lines 737/1049. Keep measured scope explicit.

## Validation, backlog and finish

Run every changed setup suite above with `pnpm --filter @waitron/server exec vitest run src/<file>` and the existing `src/testing/retained-http-listener.test.ts`, reading counts. The existing retained-listener suite owns adoption/release; the disposable conversion control above checks that the actual main listener answers through the chosen fixture. Ordinary fixtures must expose that listener's actual address. Run the bench behaviour suite/typecheck only if its implementation changes. Keep all configured-port, origin, fiscal and release assertions unchanged.

Narrow only delivered A80 points in `docs/backlog/ci.md` and its `docs/backlog.md` index. Retain excluded suites/Cloud, `fiscal-readiness-first-setup`, `start-full-disk`, `start-from-spare`, configured-port boot cases and unused-peer ports; this PR does not audit them. Preserve the bench gap if its probe fails. Use signed commits, normal hook, finish-branch and current-head CI; authorisation to land comes from this campaign's owner request.

**Forecast:** production 0; bench code +5/−35 only if the probe passes; tests about +210/−190; support +20/−5; docs about +10/−25, plus this plan: about 550 physical changed lines. One PR within 3 active hours, excluding outside waits; outside opinion before 825 or any material change.
