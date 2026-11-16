# A1092 — keep the latest kitchen queue across a Spanish switch

Lane F queue, KITCHEN-SCREEN-MISSING-ORDERS: the kitchen screen switched to Spanish must keep every queued order; reproduce first, find which read/redraw drops them, fix with a failing test first.
Authority: watcher 2026-11-16 23:08 cleared the fix route after reproduction, requiring this smallest existing-read/snapshot replacement, one Claude re-read, then watcher clearance. No owner design approval is claimed; no product code is written yet.
The sole Claude read rejected the docs-only proposal (`~/waitron-campaign-f/receipts/kitchen-screen-missing-orders-20261116/plan-review.md`); discard its unreproduced qualification.

Reproduction supplied by the driver, base `8d65` after #3575: scratch real Chromium app test booted [2,4], refreshed to [1,2,4,7], then ES restored [2,4]; `arriving-red.log`: 1 failed, 1179 skipped. Scratch probe removed.
Own `wa-wt` demo, native Station screen: load [1,2], send two orders, wait for [1,2,3,4], switch ES → [1,2]; fresh API still [1,2,3,4], reload restores all four, no page errors. Retained outside repo: `live-arriving.cjs` / `live-arriving-results.json` in the same receipts directory.
This reproduces the historical shape, not its exact cause. Earlier fixed-queue probes could not expose arrivals; the held request was cancelled on remount and proved no late delivery.

Trace: `till-app.ts` clears `initialDeviceStation` at reboot, sets it from the boot read, and passes it through the kitchen body and station drill; each screen consumes it once. The locale-keyed shell remount therefore reuses the boot-only snapshot.
Reuse that field as the latest successfully adopted raw `DeviceStationScreen`; preserve the cold-boot fast path, failures and newest-read checks. No new persistence, timer, read or queue model, nor extra read on locale change.
Files: `apps/till/src/screens/till-station-screen.ts`, `apps/till/src/till-app.ts`, existing `apps/till/src/till-app.test.ts`, `docs/backlog.md`, this plan only.
Out of scope: layout, words, other-language behaviour changes, pass screens and dark-screen alert. Guide actions are unchanged; no guides or new backlog detail.

- [ ] After the Claude re-read and watcher clearance, add one real-app browser regression named `keeps the latest station queue across Spanish and English switches` in `till-app.test.ts`; mock only the server API boundary, never emit a synthetic snapshot event.
- [ ] Boot queue [2,4], change the API reply to [1,2,7] (arrivals plus completed #4), advance the existing refresh and assert exactly [1,2,7] on rendered cards; switch ES then EN and assert that same set directly after each flush, before another refresh; record the read count before each switch and assert it stays unchanged.
- [ ] Reuse the interval pattern near `till-app.test.ts:24099`: fake only `setInterval`/`clearInterval`, advance 15,000 ms, flush updates, restore timers and language. Run `pnpm --filter @waitron/till exec vitest run src/till-app.test.ts -t 'keeps the latest station queue across Spanish and English switches'`; require the card assertion to fail with stale [2,4] before production edits.
- [ ] In `#adoptDeviceStation`, retain the raw answer and dispatch app-owned `station-screen-snapshot` with raw `DeviceStationScreen` detail, `bubbles: true`, `composed: true`, for adopted snapshots. Delete the misleading “later re-connect ... never reuses a stale initial” comment.
- [ ] In `till-app.ts`'s existing outer `.app` delegation, handle `CustomEvent<DeviceStationScreen>`, stop propagation and assign its detail to `initialDeviceStation`. Detached old screens cannot bubble to that wrapper; keep existing newest-read admission unchanged.
- [ ] Run the focused regression green. In a disposable copy, delete snapshot propagation and rerun it: require failure at the owning card assertion, then discard only that copy. No duplicate event microtest.
- [ ] Keep existing station-screen cold-boot/no-extra-read, failed-refresh retention and older-response assertions. Run both full files: `pnpm --filter @waitron/till exec vitest run src/till-app.test.ts src/screens/till-station-screen.test.ts`; inspect test counts and failures.
- [ ] LOOK at the real own-demo screen in EN/ES, light/dark, widths 390/1280, with newly arrived and removed cards; compare rendered sets with fresh API reads across switches. Keep screenshots outside git.
- [ ] After the fix passes, delete A1092 from `docs/backlog.md`; `docs/backlog/kitchen.md` has no A1092 detail to remove or create. Check `git diff --check` and changed paths.

Forecast: production +12–25/−2–5, tests +45–75/−0, docs +25–40/−30–40 including this replacement and backlog deletion; support/generated 0. Stop for the watcher if a larger model is needed.
Execution/landing: RUNNER already authorises finish/land. After clearance and implementation, use normal `finish-branch` whole-branch reviews (concurrency risk), hooks, scoped types, current-head CI and the lane landing lock; no extra owner approval. Claude’s one corrected-plan re-read is complete; the driver has accepted the direct/read-count assertion. Watcher clearance remains pending; no implementation yet.

Watcher clearance 2026-11-16 23:24: build as corrected, no further read or boot-clash guard. Add one source-only, unrun pass/pass-monitor seed note to the existing kitchen bundle; change no pass screen.

Run-it correction 2026-11-16: publish the adopted display board, including its acknowledged-notice filter, and publish again after acknowledgement; raw replies can otherwise reintroduce a notice on remount. The existing app regression now clicks the native acknowledgement before switching language.

Watcher clearance 2026-11-16 23:57 explicitly includes the displayed-board/acknowledgement correction and the extra stale-notice refresh assertion.
