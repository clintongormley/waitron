# Selective bundle test setup

Lane I draft, 15 November 2026: separate Sol/high draft, driver corrections, Claude review (282 s), cleared by the watcher on 15 November at 07:03 CET (Lane I questions.md), with the shared snapshot trace below. No owner design approval is claimed.

**Ask:** “Measure selective shared setup that serves focused runs and shards without building unused fixtures or retaining stale outputs”, including the caller audit (docs/backlog/ci.md, Real-source bundle tests; Lane I queue BUNDLE-TEST-SETUP).

**Result:** focused runs/shards build their needed certificate fixtures without appliance metadata for generated test wrappers. Keep per-file temporary output and cleanup. No cross-file shared build/cache: static pairs already batch, while wrappers repeat metadata; Claude recommends this smaller route.

**Measurement:** local source 983a3908ee; 33/33 profiled tests pass. Nine CLI invocations spend 11.646 s in descriptors, 0.190 s in 27 Git reads and 2.048 s in eleven compilations. These overlapping work totals predict no wall-time saving. Lane I receipts/bundle-setup-20261115/ holds raw logs/JSON. A retained PDF control fails the existing build-status assertion after 60.008 s with all three Git reads completing (19–20 s each); its first, invalid control exhausted Git's own deadline and is not evidence for the outer limit.

## Implementation and behavioral checks

- [ ] In apps/server/src/fiscal-certificate-diagnosis-bundle.test.ts, put the shipped pair's CLI build and its three shipped-entry cases in their own describe/beforeAll. Keep root creation/cleanup file-wide and local-wrapper cases outside that build group; avoid reindenting unrelated cases. Preserve the 190 s hook and all assertions.
- [ ] For generated wrappers in that file, apps/server/src/fiscal-certificate-diagnosis-parent.test.ts, apps/server/src/testing/certificate-diagnosis-snapshot.ts and packages/fiscal-verifactu/src/recovery-pdf-node.test.ts, retain their bounded subprocess calls but replace CLI arguments with --input-type=module --eval importing the existing bundle(pairs) by absolute URL. Retain pnpm exec node where used, compiler PATH, default notices and existing deadlines.
- [ ] These test-only API builds are unstamped; no wrapper assertion reads a stamp. Keep the real CLI for shipped certificate entry/host, permission verifier/control, provisioning entry and upgrade entry. Keep TLS-wrapper compilation in a child so synchronous bundling cannot block its already-running test server. Add no symlinks or helper.
- [ ] Before changes, the retained trace control fails: five generated certificate builds each collect a descriptor instead of zero. Repeat the trace on the candidate, including one shared snapshot-helper consumer (fiscal-certificate-diagnosis-api.abort.test.ts), requiring zero runtime-check and Git calls from its build, plus a dynamic-only filter: require zero wrapper metadata and no shipped-pair build. Run the certificate bundle/parent files and permission file unchanged; their original mTLS, no-write, notices, worker refusal and ordinary-open assertions remain.
- [ ] Run snapshot consumers fiscal-certificate-diagnosis-api.verifactu.test.ts, fiscal-certificate-diagnosis-api.abort.test.ts, fiscal-certificate-diagnosis-cleanup.test.ts and certificate-diagnosis.browser.test.ts (check memory first). Run recovery-PDF's complete Node file: its relocated font/attachment assertions must pass under the same slow-Git control through the API.

## Caller audit and configuration bounds

Production stays at three 20 s Git reads plus a 60 s descriptor before compilation. Retained CLI calls allow 180 s with compilation headroom; containing bounds clear their total waits. Numeric maintenance is justified by this audit, not a claim those callers have failed.

| Caller | Build / containing seconds: before → after |
| --- | --- |
| provisioning cli-entry.test.ts (the package's real CLI build) | 120/180 → 180/190 hook |
| server boot.upgrade.test.ts, executable-entry case | 120/220 → 180/320 case; other child waits total 110 |
| server certificate-diagnosis.browser.test.ts | snapshot 90 + Vite 90 + Chromium 15: hook 120 → 210 |
| fiscal recovery-PDF generated runner | API removes metadata; retain 60 build / 120 case |
| permission, shipped certificate, parent and snapshot | retain 180/300, 180/190, 180/190 and 90/100 respectively |
| fiscal emergency-attempt-crash.test.ts | retain 180/240 |

- [ ] Run both changed numeric-bound suites with their original assertions; no additional per-caller delay experiment. Root scripts/backup-verification-runtime.test.mjs owns real runtime stamps and scripts/generate-hour-release.test.mjs owns stale-stamp replacement: run their existing real-CLI cases unchanged.
- [ ] Keep fixed-release API builders (first-fiscal-launch, restore-emergency-crash, provisioning cli-owned-entry/cli-same-hour-entry) and useBuiltServer's unstamped, notice-free asset-copying contract unchanged.
- [ ] Retain setup elapsed time, trace counts, exact test counts and exits; qualify the filtered run and full consumer files only. Existing fresh mkdtemp/cleanup assertions stay. No watch-mode, reverse-order timing or forced-refusal matrix, no extra hosted dispatch.
- [ ] Record the measured API/CLI distinction in docs/developers/testing-guide.md and the commit; remove the completed entry from both backlog files. No fiscal implementation, expected-value change, registry, cache, daemon, flag, global setup, routing or capacity change.

**Expected added/removed lines:** production 0/0; tests 85/55; support 8/5; docs including plan 50/20: about 223 physical lines, outside opinion past 335. Claude reviewed the approach; watcher clearance precedes building. Focused checks, normal hook, finish-branch reviews and current-head CI precede authorised landing.
