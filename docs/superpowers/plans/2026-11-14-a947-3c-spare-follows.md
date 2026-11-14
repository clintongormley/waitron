# A947 3c: the spare follows

**Measurement stopped; runtime building awaits a revised comparison decision.** Sol drafted; H checked; Claude reviewed `7a53d5fe1f`. H queue assignment: watcher, 14 November 2026 12:21. No owner approval of this plan is claimed. [A947](../specs/2026-10-21-a947-two-box-failover-design.md), top A1018/3b amendments, §5 and §11 3c, states the requested outcome. Inspection base: `5b5fe0f820`. The watcher cleared the corrected plan on 14 November at 12:48, explicitly keeping promotion in 4b. The [measurement](../../research/2026-11-14-a947-follow-mode.md) then failed its exact-byte gate; the tasks below remain unbuilt.

**Finish line:** your joined spare continuously applies the main box's stream; Box status, Servers and the bell show its measured delay, unreachability and disagreeing clocks. Switching names its actual copy; promotion stays manual.
**Reuse:** mirror read/write gates and `/health` already exist (`boot.ts:1433,2346–2404`); `waiting-start.ts` is the non-mirror peer wait. Reuse pair-store/link, `spare-copy.ts` trust checks, Litestream helpers, signed peer status. Keep private reads closed. Never follow into open `venue.db`.
**Boundaries:** no new table, durable record or promotion protocol; no fiscal hash/chain/series/alta, `registerSif` or `restoreFiscal` changes. Following under `SCRATCH_DIR` restarts from a full restore, with unknown status until caught up; this deliberately replaces the spec's persisted position/last-heard proposal. Keep `PAIR_COPY_DIR`'s checked-copy restart exception, A1018 final-copy priority and selected-backup priority. Joining, new switch UI and 5e copy-up/fallback stay out; joining currently refuses bucket-streaming venues.

## Decisions for the watcher

1. **Recommend keeping promotion from the followed copy in 4b**, as A947 §11 and its A1018 amendment assign it. On both Box status and Servers, label follower freshness separately: “Switching still uses the copy taken when this spare joined.” Explain that limit in the EN/ES guides. The watcher must settle this scope before building; 3c must not imply its scratch copy already reaches switching.
2. **Recommend retuning the two relevant spare warnings**, leaving ordinary buckets unchanged: `backup.stream_behind` changes from 15 minutes of upload delay to >60 seconds of pending upload/apply delay, with a phase parameter and EN/ES wording; report one warning using the worse delay. `backup.stream_bucket_unusable` waits two continuous minutes instead of firing immediately; reason changes preserve the outage start. Add `clock.peer_disagrees` for >15-second single-device/peer comparisons naming both clocks. Keep existing `clock.disagrees` (two agreeing devices, >one minute) unchanged; prefer it over a duplicate early warning. Neither warning confirms, sets or stops time.

## First: measure, then record it directly in docs

No unused-library PR. Reuse `bench/sqlite-failover/src/probes/restore-time.ts`; put the probe beside it and results in `docs/research/2026-11-14-a947-follow-mode.md`. Estimate: probe +120/−0, docs +80/−0 lines; three hours.

- [ ] Run pinned 0.5.18 `restore -f` into isolated output. Freeze writes, confirm upload, catch up/stop, direct-restore that same generation and compare complete buffers without rewriting either. Record commands/hashes/bytes/exits.
- [ ] Measure commit-to-apply lag with distinct commits and monotonic time; identify applied position versus uploaded position and safe observation. Exercise disconnection/reconnection, generation change, clean stop/restart and full-restore startup duration. Upload time/size does not prove application.
- [ ] Stop for the watcher if exact bytes, reliable progress or clean stop fail. Check the measured API/size before building; growth or new mechanisms return to the watcher.

## Runtime PR: follow with its first caller and visible delay

**Usable result:** the spare follows; the main box shows measured/unknown progress, explicitly separate from its existing switch copy. Estimate production +450/−40, tests +450/−20, support +80/−0; one three-hour PR; report growth before exceeding its limit.
**Files:** `packages/stream/src/{follow.ts,follow.test.ts,index.ts}`; server `spare-follow.ts`, `spare-follow.test.ts`, `boot.spare-follow.test.ts`, `boot.ts`, `background-duties.ts`, `spare-copy.ts`, `peer-status-api.ts`, `boot-peer-check.ts`, `box-health.ts`, `box-status.ts`; dashboard `api/client.ts`, `screens/{box-status-rows,box-status-screen}.ts` and owning tests. Promotion/staging changes stay with 4b, including `handover-copy-selection.ts` and `handover-emergency-check.ts`; 3c writes no ready marker.

- [ ] TDD measured follower API/exit-before-stop in `follow.test.ts`; retain existing trust assertions. `spare-follow.ts` owns follower lifecycle plus the primary's serialized five-second signed-status read/cache, bound to peer/term/generation. Route/client tests own validated progress/clock fields, signer and nonce; dashboard reads stay cached.
- [ ] Boot tests own mirror start, failed-start/shutdown cleanup, and no selling, filing, printing or drawer work. Keep existing mirror-surface/A1018/fiscal assertions. Stop the follower through background duties; do not claim 4b's promotion handoff is built. Avoid live handles by following only scratch output.
- [ ] Screen tests own seconds/last-applied/unknown/no-pair; Spare box replaces the to-spare bucket row and receives its alerts; retain actual-bucket rows. Extend/run `testing/stream-loop-spare.ts` through `stream-loop.e2e.test.ts`: a post-join non-fiscal change reaches the spare without changing the switch copy; close cleanly.

## Alerts and Servers PR

**Usable result:** bell, Box status and Servers share measured warnings. Estimate production +200/−40, tests +250/−20, support +100/−0; three hours.
**Files:** server `alert-sources.ts`, `errors.ts`, `spare-pipe.ts`, `clock-witnesses.ts`, `membership-removal-api.ts`, their owning tests; dashboard `screens/{box-status-rows,servers-screen}.ts`, `i18n/{strings,alert-messages}.ts`, existing test/a11y siblings; EN/ES box-status/servers guides and A947's backlog entry.

- [ ] TDD the decision-2 boundaries/recovery once, including phase wording, quiet caught-up copies, continuous outages and unchanged ordinary-bucket thresholds.
- [ ] Test the cleared 15-second clock policy and existing-warning precedence. Report spare comparisons through signed status, without a spare bell/public API.
- [ ] Preserve passive refresh, handover/retire menus and permissions. Inspect EN/ES, both themes, phone/desktop. Mock-up reference: `git show '3ef533f4fe^:docs/backlog/mockups/a947-two-box-failover/3-servers-screen.png'`; roles, seconds of delay, amber warning, last-applied time and Servers link apply; its offsite-copy caption waits for 5e.

Each PR: TDD, changed-file tests, real-binary tests with `WAITRON_REQUIRE_TEST_TOOLS=1`, unedited fiscal gates, normal hook, sign-offs, current-head CI and Claude finish-branch reviews. No runtime implementation is claimed; measured results are in the linked research note.
