# A947 3c: the spare follows

**Proposed, not cleared.** Sol drafted this plan; the H driver checked it. Claude reviews it before the watcher clears building. Assignment: H queue, watcher 14 November 2026 12:21. The owner's 21 October words, “For go live I want one box with failover to another local box,” authorise the outcome, not this new plan.
**Spec:** [A947](../specs/2026-10-21-a947-two-box-failover-design.md), top A1018/3b amendments, §5 and §11 3c. Base: `5b5fe0f820`.

**Finish line:** your joined spare continuously applies the main box's stream. Box status, Servers and the bell show measured delay, unreachability and disagreeing clocks. No automatic switch.
**Reuse:** inspection of `apps/server/src/boot.ts:2346–2404` finds mirror read/write gates already present; `waiting-start.ts` instead serves non-mirror peer waits. Keep those paths separate. Reuse pair-store, the mirror link, signed pointer/generation/key checks, Litestream config/child helpers and signed peer-status queries. `restoreGeneration` is one-shot; following is unmeasured. The existing spare gate blocks health/status too: admit only safe own-box facts, preserving private-read refusals and no anonymous management session.
**Limits:** no new table, durable record or promotion protocol. Work under the existing state-folder hold and `SCRATCH_DIR`; use `PAIR_COPY_DIR` only for its existing checked-copy restart exception. Never follow into open `venue.db`. Preserve A1018's signed final-copy comparison, acceptance, relinquishment and placement. Stop/await following before promotion writes. Exclude joining, copy-up/bucket fallback (5e), new switch UI and fiscal algorithms; golden huella/inmutabilidad remain unedited. Mock-up 3's roles, delay, amber warning and Servers link apply; its offsite-copy caption waits for 5e.

## 3c-1: measure and expose following

A real-binary rehearsal and callable follower; server behavior stays unchanged. Estimate added/removed lines: production +230/−0, tests +300/−0, support +120/−0. One PR, within three hours.
**Files:** `packages/stream/src/{follow.ts,follow.test.ts,index.ts}`; `apps/server/src/stream-follow.e2e.test.ts`, reusing existing S3/stream-box fixtures.

- [ ] First run pinned 0.5.18 `restore -f` into isolated output. Freeze writes, confirm upload, catch up/stop, direct-restore the same generation, and assert complete byte buffers equal without rewriting either. Record commands, hashes, counts and exits. Measure commit-to-apply lag with distinct commits and monotonic time. Exercise disconnect/reconnect, generation change and restart; establish applied position and safe observation, rather than infer progress from uploads. These are experiments, not results.
- [ ] If exact bytes, reliable progress or clean stop fail, stop for the watcher. Otherwise TDD `startFollowing(args)` returning `stop(): Promise<void>` and `status(): FollowerView`, with measured generation/position/time and explicit unknown/failure. `follow.test.ts` owns verified key/arguments, exit-before-stop resolves and no late progress after stop. No persisted follower state.
- [ ] Run the focused stream file red then green; run `WAITRON_REQUIRE_TEST_TOOLS=1 pnpm --filter @waitron/server exec vitest run src/stream-follow.e2e.test.ts --reporter=verbose`, with actual tests and no skips. Install the pinned tools using the existing setup scripts during build.

## 3c-2: connect the joined spare

A joined spare follows and reports progress without serving restaurant data. Estimate: production +370/−30, tests +400/−20, support +80/−0. Needs 3c-1's successful measurement; one three-hour PR.
**Server files:** new `spare-follow.ts`, `spare-follow.test.ts`, `boot.spare-follow.test.ts`; modify `boot.ts`, `background-duties.ts`, `spare-read-gate.ts`, `peer-status-api.ts`, `boot-peer-check.ts`, `stream-host.ts`, `spare-pipe.ts`, and `spare-copy-placement.ts` plus their owning tests and `testing/stream-loop-spare.ts`.

- [ ] TDD the follower's signed-generation selection, invalid-pointer/key refusal and stop-before-generation-change once in `spare-follow.test.ts`. Start only on a joined mirror after its store; register failed-start cleanup immediately.
- [ ] `boot.spare-follow.test.ts` owns boot wiring, safe health/status, retained trading refusal and stop-before-promotion-write. `spare-copy-placement.test.ts` owns stopped-copy placement with all old handles closed; retain final-copy/selected-backup priority. If this needs a marker or wider promotion redesign, stop for plan correction.
- [ ] Extend existing nonce-signed peer status with optional measured follower state and clock, validating it without breaking handover status. Its route/client suites own signer, nonce and malformed-state cases. Cache by peer/term/generation, clearing on pair/chart changes. Reuse the five-second spare-check cadence. `spare-pipe.test.ts` owns continuous-outage timing across changed failure reasons and recovery on an answer.
- [ ] Run every changed test file red/green as appropriate, retaining mirror-surface assertions. Extend/run the real `stream-loop.e2e.test.ts`: one post-join non-fiscal change reaches the spare, then clean shutdown. This owns integration, not policy thresholds.

## 3c-3: show freshness and the three alerts

Bell, Box status and Servers share the measured view. Estimate: production +320/−30, tests +350/−20, support +120/−0; one three-hour PR.
**Server files:** `alert-sources.ts`, `errors.ts`, `boot.ts`, `box-health.ts`, `box-status.ts`, `membership-removal-api.ts` and owning tests. **Dashboard files:** `api/client.ts`, `screens/{box-status-rows,box-status-screen,servers-screen}.ts`, `i18n/{strings,alert-messages}.ts`, existing test/a11y siblings. Update EN/ES box-status/servers guides and A947's existing backlog entry.

- [ ] TDD policy once in `alert-sources.test.ts`: behind only above 60 seconds with unapplied writes, quiet is not stale, unreachable at two minutes clears on answer, clocks disagree above 15 seconds naming both clocks. Check boundaries/recovery and wall-clock changes. Unknown never means current.
- [ ] Add ongoing box-area warnings `mirror.behind`, `mirror.unreachable`, `clock.peer_disagrees`, with EN/ES wording. Reuse fresh device witnesses and signed peer samples on both boxes, without feeding fiscal confirmation/setting or changing existing drift rules.
- [ ] Routes own permissions/shape; cached reads do no network work. Screens own seconds/last-applied display, explicit unknown/no-pair, amber warnings and Servers link. Preserve handover/retire menus and passive refreshes. Run changed files, existing a11y suites, alert/guide guards; inspect EN/ES, both themes, phone/desktop.

Every PR retains TDD receipts, normal hook, current-head selected CI, signed-off commits and the required Claude finish-branch reviews. Note changed assertions explicitly. Overlap is resolved against landed work, not waited on. No runtime measurement was performed during planning. These slices do not complete go-live failover or 5e.
