# A1398 — pack the other packages' test shards by measured time

Codex draft, 11 November 2026. Claude review and watcher clearance pending; no owner approval claimed.
Request: Lane I `queue.md`, A1398, “Pack the other packages' test shards by measured time”; source: `docs/backlog/ci.md` → Bundle A1398.
Finish line: six more packages use the server's existing duration packing, with committed refreshable tables and unchanged checks. One PR; about three hours of active work to open it.

## Evidence and limits

Receipts: `/Users/clintongormley/waitron-campaign-i/receipts/a1398-duration-20261111/{measurement-input,packing-summary}.json`.
Latest nightly 42944859790 (11 November, `e8be31c2f9037edb97fe42fde9f920b9c0717eed`): all 28 affected shards succeeded with coverage, checkout ≤9 seconds, no matched download HTTP 5xx or overlapping GitHub incident in the retained evidence.
Replay trains on nightly 42741652586 (10 November, `2ba87ae891df578098596d9d67f0c000e0c88024`), excluding till because its checkout reached 11 seconds; the other 21 affected jobs qualified.
Both heads follow A1427 (`3513782033`), checked with `git merge-base --is-ancestor` returning 0 for each. Compare coverage-on runs only.

| Package | Latest job range, seconds | Busiest reported file-seconds, old → packed |
| --- | --- | --- |
| dashboard | 208–291 | 630.6 → 547.0 (13% estimated reduction) |
| till | 162–273 | 577.6 → 378.3 (35%, within-sample only) |
| venue-service | 179–202 | 129.7 → 123.3 (5% estimated reduction) |
| fiscal-verifactu | 127–162 | 172.9 → 175.8 (2% worse) |
| provisioning | 70–98 | 63.3 → 56.8 (10% estimated reduction) |
| db | 62–69 | 57.7 → 47.1 (18% estimated reduction) |

Dashboard and till are slowest. Browser end timings can include queued pages: these sums estimate packing balance, not job wall time or measured speedup. Till has no qualified independent replay.
Packing leaves long files unchanged: dashboard `src/screens/menus-screen.test.ts` reports 135.5 seconds; till drafts/parties report 147.4/146.4 seconds. Do not promise four-minute jobs; report remaining slow files for deeper intervention.

## Build after review and clearance

1. **Test first.** Extend `scripts/vitest-duration-sequencer.test.mjs` with six config-wiring cases and real Vitest list/collect APIs: pass selected spec objects through the configured sequencer; assert their exact identities occur once across shards, project membership survives, and each config reads its own table. Do not infer sharding from `--filesOnly`, which does not apply `--shard`.
   Keep existing packing, fallback, warning and identity assertions; do not duplicate algorithm tests. Keep project `groupOrder` and worker settings; installed Vitest's `groupSpecs` applies grouping independently of sequencer sorting.
   Extend `scripts/changed-scope.test.mjs` to require all seven consumers when the shared sequencer changes. Run these new assertions and record their expected failures before changing wiring or selection.
2. **Reuse, without a new scheduler.** Add outer `test.sequence.sequencer: durationSequencer(...)`, reading package-local `test-durations.json` with `readFileSync` as server does, in these `vitest.config.ts` files:
   `apps/till` (7 shards), `apps/dashboard` (4), `packages/db` (3), `packages/provisioning` (6), `packages/venue-service` (4), `packages/fiscal-verifactu` (4).
   Preserve projects, group order, worker caps, includes, timeouts, coverage thresholds and coverage merging. Leave `scripts/vitest-duration-sequencer.mjs` algorithm, fallback and warning unchanged; make server-specific script comments generic only where needed.
   Extend `scripts/changed-scope.mjs` → `ROOT_SCOPE_CONSUMERS` for the shared sequencer to include these six alongside server.
3. **Generate six tables.** Run `node scripts/test-durations.mjs <package>/test-durations.json <qualified-package-logs...>` using all 28 latest qualified logs, grouped by package; keep logs outside the checkout.
   The input has 1,859 timed paths (dashboard 519, till 596, db 122, provisioning 96, venue-service 238, fiscal 288). Prune retired paths against Vitest's current selected inventory; retain existing mean fallback and warning for new paths. No inventory files or runtime inventory framework.
4. **Prove and document.** Run `pnpm exec vitest run scripts/vitest-duration-sequencer.test.mjs scripts/test-durations.test.mjs scripts/changed-scope.test.mjs scripts/ci-workflow.test.mjs`; require passing assertions and a nonzero Tests count. Leave workflow expectations and shard counts unchanged; verify counts remain below selected file counts.
   In a disposable candidate checkout, remove sequencer wiring and confirm its wiring assertion fails for that reason; restore it. Do not alter product/fiscal assertions or golden data.
   Update `docs/developers/ci-and-gates.md`: retire current server-only packing claims, explain each table's refresh, unchanged fallback, qualification rules and estimation limits; keep dated receipts historical.
   Remove completed A1398 packing entries from `docs/backlog.md` and `docs/backlog/ci.md`; retain the conditional inventory point only if the backlog rule warrants it. No same-count wrong-files incident has been observed. Do not edit `CLAUDE.md`; notify the watcher of its server-only wording.

## Actual CI evidence and boundary

After focused checks, the parent owns finish-branch review, normal push hook, PR and clearance/landing work. Run one full feature-branch `workflow_dispatch` with `server_probe=false`, using existing runner routing without controller changes; PR CI tests selected packages without enforcing package coverage.
Require all 28 affected shards, their coverage/merge gates and current-head required CI checks to pass. Retain run/head/job identities, selected-file counts, setup/test/job timings and coverage results beside the existing receipts.
Before claiming gains, qualify the new run against the same coverage mode, incident history, download errors and checkout criterion. Compare actual wall times; disclose fiscal regressions and till's missing independent baseline. If jobs still exceed about four minutes, inspect the slowest files and setup, report the remaining limit, and seek watcher direction before widening scope.
No shard-count, coverage-policy, controller/routing or product changes; no test rewrites, slow-file splitting or new inventory system.
Expected change: about 60 code/config lines, 120 test lines, 1,900 generated JSON lines (counted separately), and 50 documentation lines, plus this plan.
