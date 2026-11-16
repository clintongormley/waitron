# A1092 — document the unreproduced partial kitchen queue

Reference: Lane F `~/waitron-campaign-f/queue.md`, KITCHEN-SCREEN-MISSING-ORDERS, watcher feed 2026-11-16 22:24; `RUNNER.md` governs execution.
Queued fallback: “If several honest attempts do not reproduce it, write down exactly what was run and narrow the entry to what is left, docs-only, rather than guessing a fix.”
Status: written by the separate GPT-6.1 Sol high-effort plan writer; awaits the sole Claude plan read and watcher clearance. No backlog edits before clearance; neither is owner approval.

Finish line: readers can distinguish the historical report from the dated attempts that did not reproduce it. Keep A1092 open, with a short index entry linking to its evidence and remaining unknowns; claim no product improvement.
Reuse the existing backlog index/detail structure and retained driver experiments; change no application code, tests, support or generated files.
Files: this plan, `docs/backlog.md`, and `docs/backlog/kitchen.md` only. Forecast, including plan: documentation +35–55/−3–5 lines; production/tests/support/generated +0/−0 each.

Retained evidence (driver experiments, 2026-11-16):
- Base: clean main `8d65e53f22211cfc6eab8ddceda963b6b94d8873`, after #3575 landed; this does not establish what caused the historical report.
- Temporary real Chromium redraw probe: fixed API queue [1,2,4,7], en-GB→es-ES→en-GB→es-ES at widths 390/1280; 2 passed. Probe removed, production/test tree clean. The first selector counted cards while Overview showed four dishes; selecting Waiting on each redraw corrected that control error.
- Live own `wa-wt` demo slot 1, fresh isolated state: table parties 1/2/4/7, Bravas/Croquettes/Prawns/Omelette fired through public till API, no payment; actual order numbers [1,2,3,4]. Dedicated Station screen and real server, native language chooser, same switches and reload at 1280/390: all ten rendered card sets matched fresh `/api/device/station-screen` queue reads.
- Held-refresh repeat: hold the existing 15-second refresh response from the real server, switch to Spanish before releasing it, then English/Spanish/reload at 1280/390; all ten card/API snapshots matched [1,2,3,4]. Driver opened Spanish desktop/phone captures: four cards present, lower cards scroll. This does not explain the historical loss.
- Local receipts: `~/waitron-campaign-f/receipts/kitchen-screen-missing-orders-20261116/`, files `redraw-probe.txt`, `redraw-probe-final.log`, `live-probe.cjs`, `live-probe-results.json`, `held-probe.cjs`, `held-probe-results.json`; keep scripts/results outside the repository.

- [ ] After clearance, add `## A1092. Historical partial queue after Spanish switch` in `docs/backlog/kitchen.md`. Preserve the original 2026-10-25 observation: #2/#4 shown while the queue also held #1/#7; reload restored them; a second switch did not lose them; cause unknown and A789 slice 4 did not change the kitchen screen.
- [ ] Add the dated experiments above, their exact scope and receipt paths. Record that `test -d ~/waitron-campaign-c/a789-4-shots/` returned status 1; original screenshots 60/61 are unavailable, and exact original station configuration, state and timing are unknown.
- [ ] Name the evidence still needed: a repeatable mismatch, paired screen and station API queue at that moment, station/device configuration and dish states, selected view, and language/refresh/reload timing. Do not add instrumentation to obtain it in this item.
- [ ] Shorten `docs/backlog.md` A1092 to the historical unreproduced partial queue and link to `backlog/kitchen.md#a1092-historical-partial-queue-after-spanish-switch`. Keep the report open; the queued deletion applies only to a completed fix.

Verification and landing (driver, after clearance):
- [ ] Run `git diff --check`; inspect the full changed prose against retained scripts/results and the original report. Use `git diff --name-only` plus `git status --short` to confirm only these docs paths changed; check that A1092 remains open and its detail link resolves.
- [ ] No new test suite, browser rerun, instrumentation, speculative fix, layout, wording or language behaviour change; make no claim of “fixed”, “impossible” or “no current bug”, and do not attribute the historical report to scrolling or tab selection.
- [ ] Use the docs-only workflow: signed `git commit -s`, acquire the lane's own landing lock, update main and fast-forward/push with normal hooks, run main's `pnpm install`, release only the acquired lock, and verify the landing's own CI result. No PR or built-code reviews.
- [ ] Remove only this item's worktree/branch and own runtime state/processes; retain small text receipts and record the landed SHA and remaining open A1092 in lane progress.
