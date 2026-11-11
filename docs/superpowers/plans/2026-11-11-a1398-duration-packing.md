# A1398: pack the other packages’ test shards by measured time

Codex draft, 11 November 2026; Claude reviewed the first draft in 252 seconds. Watcher cleared this plan on 11 November at 14:36 (Lane I questions.md), including one/two-run initial tables and the two named consumer-check changes; no owner approval of this design claimed.
Ask: Lane I queue.md, A1398 (watcher 14:17), and docs/backlog/ci.md, “Bundle A1398”. Finish line, narrowed by watcher 14:53: dashboard and till use the existing duration packer and refreshable timing tables. One PR, about three active hours to open it.

## Measured starting point

Full coverage nightly 42944859790, head e8be31c2f9037edb97fe42fde9f920b9c0717eed: all 28 affected shards passed, slowest checkout 9 seconds, no matched download HTTP 5xx or overlapping relevant GitHub incident in retained evidence. Both sampled heads descend from A1427 (3513782033); compare coverage-on runs only.

| Package | Latest job range; slowest shard | Busiest reported file-seconds, old to packed |
| --- | --- | --- |
| dashboard | 208–291 s; shard 2 | 630.6 to 547.0 (13% estimated reduction) |
| till | 162–273 s; shard 4 | 577.6 to 378.3 (35%, within-sample only) |
| venue-service | 179–202 s; shard 1 | 129.7 to 123.3 (5%) |
| fiscal-verifactu | 127–162 s; shard 2 | 172.9 to 175.8 (2% worse) |
| provisioning | 70–98 s; shard 1 | 63.3 to 56.8 (10%) |
| db | 62–69 s; shard 3 | 57.7 to 47.1 (18%) |

Replay uses previous nightly 42741652586, head 2ba87ae891df578098596d9d67f0c000e0c88024, for five packages (21 affected jobs, checkout at most 10 seconds). Till is excluded because checkout reached 11 seconds. Browser timings can include queued pages; sums estimate balance, not wall-time savings. Packing redistributes work; it does not remove slow-test work or establish lower total runner-minutes or queue latency. Dashboard menus reports 135.5 seconds; till drafts/parties 147.4/146.4 seconds.
Receipts: ~/waitron-campaign-i/receipts/a1398-duration-20261111/{measurement-input,packing-summary,discovery-probe}.json (discovery probe is .log); Claude report: plan-review.md in that folder.

## Build after watcher clearance

**Watcher 14:53 scope correction (Lane I questions.md):** “pack dashboard and till by measured time only”. This replaces the 14:36 six-package clearance. The four other packages stay on the file-count split while their jobs meet the four-minute target. Withdraw the db sandbox repair and regression case; retain the stale-doc correction and nonempty timing-key overlap check. One fresh fixes read follows the existing two run-it reviews; no owner design approval is claimed.

1. **Fail first.** Extend scripts/vitest-duration-sequencer.test.mjs: createVitest then globTestSpecifications for dashboard and till, instantiate its configured sequencer, and assert original spec identities occur once across shards with projects retained and the package’s own table loaded. Read shard counts from ci.yml. Close every Vitest instance; allow 30 seconds for discovery (six current configs took 0.35 seconds in the recorded probe). Keep existing algorithm/fallback/warning assertions; no duplicate per-package algorithm or consumer guard.
   Update the two server-only expectations in scripts/changed-packages.test.mjs to the three actual consumers. Record expected failures before implementation. Existing scripts/root-scope-consumers.test.mjs already checks the complete reader list.
2. **Reuse.** Add outer test.sequence.sequencer: durationSequencer(...), reading local test-durations.json with readFileSync as server does, to vitest.config.ts in apps/till (7 shards) and apps/dashboard (4). Extend scripts/changed-scope.mjs ROOT_SCOPE_CONSUMERS for the sequencer to those two plus server. Preserve project groups, workers, includes, timeouts, coverage and merge behavior. Leave the shared sequencer behavior unchanged and prune its obsolete header; generalize scripts/test-durations.mjs’s server-specific usage comment.
3. **Generate.** Use node scripts/test-durations.mjs <package>/test-durations.json <qualified logs>: both nightlies for dashboard, latest nightly only for till. The watcher cleared these initial one/two-run tables instead of the documented six-run server refresh. About 1,130 retained timed paths; retain older rows and existing fallback for new files, avoiding hand-pruning or a new inventory tool.
4. **Verify and document.** Run pnpm exec vitest run with scripts/vitest-duration-sequencer.test.mjs, scripts/test-durations.test.mjs, scripts/changed-packages.test.mjs, scripts/root-scope-consumers.test.mjs, scripts/changed-scope.test.mjs and scripts/ci-workflow.test.mjs. Require a nonzero Tests count and passing results. The observed pre-wiring failure supplies the deletion control; do not repeat it in another checkout. Name the two deliberately broadened consumer checks in the PR. No product/fiscal assertion or golden-data edits.
   Update docs/developers/ci-and-gates.md’s current server-only claims, package refresh commands/triggers and expected absent-file warnings; preserve historical receipts. Update docs/backlog.md and docs/backlog/ci.md’s A1398 entries for what is delivered, keeping any measured unmet four-minute work in that existing bundle. No inventory work without a same-count wrong-files incident; none observed. Leave CLAUDE.md to the watcher.
5. **Measure the result.** Finish-branch reviews, normal hook, PR CI, and one full feature-branch workflow_dispatch (server_probe=false) using existing routing. Require all 11 affected shards, coverage merges and current-head required checks. Qualify setup/incident/download health and compare coverage-on wall/test times with named run/head/job receipts. Fiscal packing is outside this narrowed change; add no weighted scheduler. Inspect any remaining four-minute overrun and seek watcher direction before expanding into slow-file fixes.

Expected final change after the cleared cut: about 30 code/config lines, 60 test lines, 1,133 generated JSON lines counted separately, and 60 documentation lines plus this plan. No shard-count, coverage-policy, controller/routing, product, slow-file-splitting or runtime-inventory changes.
