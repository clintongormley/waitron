# Root guards under load

Lane I queue, watcher 16 November 15:53: “Root guard deadlines under extreme external load (left open by A751).” The ask names three concurrent root Vitest runs (one coverage), eight spinning loops, and, for each failure, “what the bound waits for, its worst case under this load with the bound lifted, and whether the case can be made cheaper.” Historical receipts are absent.

Claude reviewed the initial plan in one completed 186-second read. The watcher cleared the following narrower method at 17:02 on 16 November, recorded in Lane I's questions.md: “One deciding run on this Mac”; “a file that passes the scaled run is reported with its receipts, left unchanged, and its part of the backlog entry deleted”; “If a file fails: stop after the measurement and write the cause and a cheaper-test proposal, with numbers, as WATCHER-NEEDED before building.” The watcher replaced the initial container proposal because the failures were observed on macOS. No owner design approval is claimed.

**Result:** one measured Mac outcome for each named file. Passing files stay unchanged and their backlog work is deleted. A failure returns to the watcher before any fix. Reuse existing CLI entry points, root worker estimator and deadline diagnostics. No package test campaign, new framework, worker policy or changed limit.

1. Restore frozen dependencies in three isolated writable copies of the same committed tree. Record source SHA, macOS/Node/Vitest versions, estimator inputs and environment overrides. Measure headroom with `memory_pressure` and `uptime`; scale the eight shell busy loops down to available processor headroom, leaving room for the three estimated root worker groups and other lanes. Do not override the root worker estimator.
2. Run three concurrent complete root suites, two plain and one with `--coverage`. Keep separate logs and reports. Use the existing 45-minute diagnostic outer deadline; take external snapshots every two seconds, retaining only owned process trees with PID/parent, state, elapsed/CPU/RSS and command, plus host load. Record launched process ids, stop only those processes, and retain unfinished operations before cleanup. A diagnostic deadline is partial evidence, not completion. Do not retry for a preferred result.

| File | Starting point; measurements decide the outcome |
| --- | --- |
| `scripts/guarded-teardowns.test.ts` | Cached inventory and source scan, no child process; root 30 s case limit. |
| `scripts/mutation-shard.test.mjs` | Sequential synchronous Node CLI calls without child deadlines; root 30 s case limit. |
| `scripts/pre-push.test.mjs` | Git setup, stub and real hook/classifiers; 15 s per hook and 25 s per case. |

3. Read all three results, actual Tests counts, per-file outcomes and coverage output. Record load reached and worker counts in `docs/developers/ci-and-gates.md`. A passing file's part of the backlog entry is deleted, per the watcher's clearance; do not describe this scaled measurement as proof at every load or as a repair.
4. If a named file fails, identify its case, limiting layer and unfinished operation from logs/snapshots. Keep the hook constant and elapsed assertion intact. Report measured cause and a cheaper-test proposal to the watcher, before changing code, test assertions, bounds or measurement method. A follow-on fix can be a separate PR. Unrelated root failures are reported without expanding this item.
5. Keep raw receipts in `~/waitron-campaign-i/receipts/root-guards-under-load-20261116/`; quote deciding figures in committed docs. Update only this item's completed or remaining work in `docs/backlog.md` and `docs/backlog/ci.md`. Remove owned temporary copies and all installed dependencies before the firing ends. A documentation-only result uses the repository's direct docs workflow; code changes require a separately cleared fix and normal finish-branch/current-head CI.

Expected measurement change: production 0, tests/support 0, docs about +40–100/-0–60 including the plan. No implementation is authorised by this measurement clearance.
