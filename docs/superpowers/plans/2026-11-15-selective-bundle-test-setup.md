# Selective bundle test setup

Lane I draft, 15 November 2026. Separate Sol/high draft, checked and shortened by the driver; Claude review and watcher clearance are pending. No owner design approval is claimed.

**Ask:** “Measure selective shared setup that serves focused runs and shards without building unused fixtures or retaining stale outputs”, including the caller audit (`docs/backlog/ci.md`, Real-source bundle tests; Lane I queue BUNDLE-TEST-SETUP).

**Finish line:** focused runs and shards compile only their needed certificate fixtures, without collecting appliance metadata for generated test wrappers. Real shipped-entry CLI stamps, notices and permission checks remain. Each file owns fresh temporary output and removes it at teardown; no cross-run cache or global setup.

**Measurement:** local source `983a3908ee`, 33/33 profiled tests pass. Nine CLI invocations: descriptor subprocesses 11.646 s, 27 Git reads 0.190 s, eleven compilations 2.048 s. Static entry pairs already batch. These are overlapping work totals, not promised wall-time savings. Full JSON/logs and the caller audit are in Lane I `receipts/bundle-setup-20261115/`.

## Build and tests

- [ ] In `apps/server/src/fiscal-certificate-diagnosis-bundle.test.ts`, lazily build the shipped entry/host through the real CLI only when a case needs them. Keep one build per file and the existing temporary root/cleanup. A run selecting only a local-wrapper case must not build the shipped pair.
- [ ] In that file, `apps/server/src/fiscal-certificate-diagnosis-parent.test.ts` and `apps/server/src/testing/certificate-diagnosis-snapshot.ts`, compile generated test wrappers through the existing `bundle(pairs)` API in bounded Node subprocesses, following `testing/zone-process-matrix.ts`. Keep default notices, request-specific builds after server binding, and existing cleanup. No new shared helper is needed; the bundler API is the reused setup.
- [ ] First run an external trace check requiring zero metadata calls for generated wrappers and zero shipped entries for a dynamic-only selection: current code must fail it. Then make the smallest changes and rerun. Preserve every existing behavioral assertion; no committed timing test or production instrumentation.
- [ ] Certificate bundle tests own shipped entry/no-source-loader/notices and local mTLS/socket/process behavior; parent tests own unchanged persistent state. Run both whole files plus `backup-verification.permission.test.ts` (worker refusal and ordinary-open controls).
- [ ] Exercise the shared snapshot builder through its four consumers: `fiscal-certificate-diagnosis-api.verifactu.test.ts`, `fiscal-certificate-diagnosis-api.abort.test.ts`, `fiscal-certificate-diagnosis-cleanup.test.ts` and `certificate-diagnosis.browser.test.ts`. Retain their authorization, no-write and cleanup checks; check memory before Chromium.

## Caller budgets

The CLI permits three 20 s Git reads and a 60 s descriptor before compilation. Keep production limits; retained CLI builds get 180 s including 60 s compilation headroom, with containing deadlines above their total waits.

| Caller | Current build / container seconds | Planned seconds |
| --- | --- | --- |
| fiscal `recovery-pdf-node.test.ts`, relocated-bundle case | 60 / 120 | 180 / 240; two executions allow 15 s each |
| provisioning `cli-entry.test.ts`, setup hook | 120 / 180 | 180 / 190 |
| server `boot.upgrade.test.ts`, executable-entry case | 120 / 220 | 180 / 320; other child waits total 110 s |
| server permission and shipped certificate builders | 180 / 300 or 190 | unchanged |
| generated certificate parent/snapshot wrappers | 180 / 190; 90 / 100 | unchanged; API avoids metadata |
| fiscal `emergency-attempt-crash.test.ts` | 180 / 240 | unchanged |

- [ ] Before numeric edits, reproduce each short caller's outer timeout with controlled metadata/compile delays; verify individual metadata subprocesses still complete within their own limits. Then pass with revised bounds and original assertions. Remove probe-owned files/children. No production delay switches.
- [ ] Keep fixed-release API builders (`first-fiscal-launch`, `restore-emergency-crash`, provisioning `cli-owned-entry`/`cli-same-hour-entry`) unchanged. Root `backup-verification-runtime.test.mjs` owns real runtime stamps; `generate-hour-release.test.mjs` owns stale-stamp replacement: run their existing real-CLI cases unchanged. Audit `useBuiltServer`; retain its deliberately unstamped, notice-free asset-copying contract.

## Qualification and scope

- [ ] Record setup elapsed time, metadata/compile counts and test results in both baseline/candidate run orders. Run a dynamic-only filter, a full certificate file, a selected server shard and a Vitest watch rerun after a temporary wrapper-source edit; inspect actual built entries, fresh output and teardown. Force one compile refusal to check cleanup. Return to the watcher if repeated work is not removed or a material redesign is needed; no extra hosted dispatch.
- [ ] Update `docs/developers/testing-guide.md` with the wrapper/CLI distinction and delete the finished entry from both `docs/backlog.md` and `docs/backlog/ci.md`. No fiscal implementation, assertion changes, new cache, registry, daemon, production flag, global setup, routing or CI capacity change.

**Expected diff, added/removed:** production 0/0; tests 70/25; support 8/5; docs including this plan 60/20: about 188 physical lines. Outside opinion past 282, before more implementation. Claude reviews the plan first; the watcher clears build. Focused tests, normal hook, finish-branch reviews and current-head CI precede authorised landing.
