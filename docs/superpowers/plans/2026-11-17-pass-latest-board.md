# Keep the latest pass board through language switches

Authority: watcher-queued `PASS-SCREEN-LATEST-BOARD`, recorded verbatim in `/Users/clintongormley/waitron-campaign-f/queue.md`. No owner design approval. Claude plan review and watcher build clearance remain required; the driver submits PLAN FOR APPROVAL after review.

Smallest usable result: pass and pass-monitor displays keep the latest rendered orders immediately after Spanish and English switches, including arrivals and removals, without another read.
Base `219332af72` includes #3591 (`49eb1b6b15`); reuse its screen-to-app snapshot pattern and the existing `DevicePassBoard`, boot seeds and refresh.

Driver-supplied reproduction: `pnpm --filter @waitron/till exec vitest run src/till-app.test.ts -t 'keeps the latest pass'` exited 1: two failed, 1181 skipped. Both modes booted [2,4], refreshed to [1,2,7], then Spanish restored [2,4] at line 2585. Failing tests remain uncommitted; no production edit yet.

Files to change:

- `apps/till/src/screens/till-pass-screen.ts`: publish the adopted board.
- `apps/till/src/till-app.ts`: retain it in the matching existing device seed.
- `apps/till/src/till-app.test.ts`: retain the driver's real-browser regressions.
- `docs/backlog/kitchen.md`: delete only the completed pass-board bullet.

- [ ] After Claude review and watcher clearance, rerun reproduction: both card assertions must fail for stale [2,4] before production edits.
- [ ] In `#adoptBoard(read: DevicePassBoard): void`, after adoption, dispatch `CustomEvent<DevicePassBoard>("pass-board-snapshot")` for `deviceMode` only (the app-owned kiosk, not a standalone monitor), with `detail: read`; the event need not bubble because the listeners are on that element. Pass adoption has no station-notice filtering to copy.
- [ ] In each device pass template, handle that event and assign its detail to that template's `initialDevicePass` or `initialDevicePassMonitor`. No listener on the standalone operator `expo` template; it cannot set either device seed. No extra event wrapper or generic abstraction.
- [ ] Preserve both adoption callers: connection consumes `initialBoard`; reload admits replies only after its existing request/current-screen checks. Keep disconnect cancellation and `#boot`'s seed resets. Trace all seed readers, including `#sayIfSwitched`; retain their board-kind selection.
- [ ] App tests own arrival/removal preservation: real app and rendered cards, fake API transport, fake only interval timers. Assert exactly [1,2,7] after refresh and immediately after ES/EN switches, before another refresh, with unchanged read counts. Restore timers, locale and viewport; keep every existing assertion.
- [ ] Existing screen tests own cold-boot read counts, failed-refresh retention, response ordering and operator choice. No duplicate event microtests or new test support.
- [ ] Run the reproduction green, then `pnpm --filter @waitron/till exec vitest run src/till-app.test.ts src/screens/till-pass-screen.test.ts`; inspect counts. Delete snapshot propagation in a disposable copy and require the app card assertions to fail.
- [ ] LOOK at both displays with changed orders in EN/ES, light/dark, phone/desktop. Keep screenshots outside git. Remove the backlog bullet; run `git diff --check`.

Exclusions: layout, words, station screen, other language behaviour, dark-screen alert; no new read, timer, storage or model. Reviewed EN/ES `kitchen-service.md#pass-screen`: staff actions stay unchanged, so add no guide sentence, following `conventions-ui.md`'s guide-content rule.

Estimate: production +15–30/−0–3 lines; tests +82–115/−1 including existing uncommitted tests; docs +30–35/−3–4. One slice. Normal hook and current-head CI own broader checks. Use finish-branch's two parallel Claude run-it reviews for response-ordering concurrency, then one fixes read. #3594 (`5115a01f22`) is already in the base; resolve later collisions under H13 and rerun focused checks.

Claude plan read (206 s, 17 November): accepted the smaller direct non-bubbling event and corrected #3594’s base note. Its proposed new backlog line for already-lost stale/action state concerns excluded language behaviour; watcher disposition is pending before build. Existing guide wording stays.
