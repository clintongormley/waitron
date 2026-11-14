# A947 3c: the spare follows

**Proposed; building waits for watcher clearance and the decisions below.** Sol drafted; H checked; Claude reviewed `7a53d5fe1f`. H queue assignment: watcher, 14 November 2026 12:21. No owner approval of this plan is claimed. [A947](../specs/2026-10-21-a947-two-box-failover-design.md), top A1018/3b amendments, §5 and §11 3c, states the requested outcome. Inspection base: `5b5fe0f820`.

**Finish line:** your joined spare continuously applies the main box's stream; Box status, Servers and the bell show its measured delay, unreachability and disagreeing clocks. Switching names its actual copy; promotion stays manual.
**Reuse:** mirror read/write gates and `/health` already exist (`boot.ts:1433,2346–2404`); `waiting-start.ts` is the non-mirror peer wait. Reuse pair-store/link, `spare-copy.ts` trust checks, Litestream helpers, signed peer status and cold placement. Keep private reads closed. Never follow into open `venue.db`.
**Boundaries:** no new table, durable record or promotion protocol; no fiscal hash/chain/series/alta, `registerSif` or `restoreFiscal` changes. Following under `SCRATCH_DIR` restarts from a full restore, with unknown status until measured; this deliberately replaces the spec's persisted position/last-heard proposal. Keep `PAIR_COPY_DIR`'s checked-copy restart exception, A1018 final-copy priority and selected-backup priority. Joining, new switch UI and 5e copy-up/fallback stay out; joining currently refuses bucket-streaming venues.

## Decisions for the watcher

1. **Recommend using the followed copy during 3c's existing emergency-copy check.** Stop/apply/check, stage through existing `pair-copy/ready.json`, and use the existing restart/placement flow before sign-in and activation continue. Alternative: leave placement to 4b and label the follower unavailable to switching, which still uses the joining copy.
2. **Recommend reusing the two existing `toSpare` stream alerts**, distinguishing upload delay from followed-copy delay, and retaining the spec's non-blocking 15-second peer/device clock warning beside the existing one-minute device rule. The warning never confirms, sets or stops time; existing refusals take precedence.

## First: measure, then record it directly in docs

No unused-library PR. Reuse `bench/sqlite-failover/src/probes/restore-time.ts`; put the probe beside it and results in `docs/research/2026-11-14-a947-follow-mode.md`. Estimate: probe +120/−0, docs +80/−0 lines; three hours.

- [ ] Run pinned 0.5.18 `restore -f` into isolated output. Freeze writes, confirm upload, catch up/stop, direct-restore that same generation and compare complete buffers without rewriting either. Record commands/hashes/bytes/exits.
- [ ] Measure commit-to-apply lag with distinct commits and monotonic time; identify applied position versus uploaded position and safe observation. Exercise disconnection/reconnection, generation change, clean stop/restart and full-restore startup duration. Upload time/size does not prove application.
- [ ] Stop for the watcher if exact bytes, reliable progress or clean stop fail. Check the measured API/size before building; growth or new mechanisms return to the watcher.

## Runtime PR: follow with its first caller and visible delay

**Usable result:** the joined spare follows; the main box's Spare box row shows actual progress and unknown/rebuilding states. If decision 1 is cleared, emergency checking uses that stopped copy. Estimate production +450/−40, tests +450/−20, support +80/−0; one three-hour PR; report growth before exceeding its limit.
**Files:** `packages/stream/src/{follow.ts,follow.test.ts,index.ts}`; server `spare-follow.ts`, `spare-follow.test.ts`, `boot.spare-follow.test.ts`, `boot.ts`, `background-duties.ts`, `spare-copy.ts`, `spare-copy-placement.ts`, `peer-status-api.ts`, `boot-peer-check.ts`, `box-health.ts`, `box-status.ts`; dashboard `api/client.ts`, `screens/{box-status-rows,box-status-screen}.ts` and owning tests. The chosen handoff also names server `handover-emergency-api.ts`, `handover-copy-from-backup.ts`, `handover-destination-duty.ts`, `handover-activation.ts`, `promote-api.ts`, and the existing emergency page/restart tests.

- [ ] TDD measured follower API/exit-before-stop in `follow.test.ts`; retain existing trust assertions. `spare-follow.ts` owns follower lifecycle plus the primary's serialized five-second signed-status read/cache, bound to peer/term/generation. Route/client tests own validated progress/clock fields, signer and nonce; dashboard reads stay cached.
- [ ] Boot tests own mirror start, failed-start cleanup and stop-before-promotion-write. Placement tests own closed old handles, mirror-only placement of plain `{}` ready records, clearing staged follower output before activation, and serialization with backup selection. Keep A1018/fiscal assertions.
- [ ] Screen tests own seconds/last-applied/unknown/no-pair; Spare box replaces the to-spare bucket row and receives its alerts; retain actual-bucket rows. Extend/run `testing/stream-loop-spare.ts` through `stream-loop.e2e.test.ts`: a post-join non-fiscal change reaches the spare and, if cleared, the checked switch copy; close cleanly.

## Alerts and Servers PR

**Usable result:** bell, Box status and Servers share measured warnings. Estimate production +200/−40, tests +250/−20, support +100/−0; three hours.
**Files:** server `alert-sources.ts`, `errors.ts`, `spare-pipe.ts`, `clock-witnesses.ts`, `membership-removal-api.ts`, their owning tests; dashboard `screens/{box-status-rows,servers-screen}.ts`, `i18n/{strings,alert-messages}.ts`, existing test/a11y siblings; EN/ES box-status/servers guides and A947's backlog entry.

- [ ] TDD boundaries/recovery: behind >60 seconds with unapplied writes, caught-up quiet stays current, unreachable at two minutes; reason changes retain outage start. Reuse `backup.stream_behind` and `backup.stream_bucket_unusable` for `toSpare`; preserve ordinary-bucket behavior and avoid duplicate fault alerts.
- [ ] Test the cleared peer/device clock policy above 15 seconds, naming both clocks without choosing the wrong one. Retain fiscal/one-minute assertions. Report spare comparisons through signed status, without a spare bell/public API.
- [ ] Preserve passive refresh, handover/retire menus and permissions. Inspect EN/ES, both themes, phone/desktop. Mock-up reference: `git show '3ef533f4fe^:docs/backlog/mockups/a947-two-box-failover/3-servers-screen.png'`; roles, seconds of delay, amber warning, last-applied time and Servers link apply; its offsite-copy caption waits for 5e.

Each PR: TDD, changed-file tests, real-binary tests with `WAITRON_REQUIRE_TEST_TOOLS=1`, unedited fiscal gates, normal hook, sign-offs, current-head CI and Claude finish-branch reviews. No implementation or measurement is claimed here.
