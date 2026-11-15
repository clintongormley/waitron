# Observer burst flake implementation plan

**Goal:** Make the burst test prove that the observer consumes every event while worker 1 is held, then completes exactly two starts and reaches an idle loop.

**Authority:** `~/waitron-campaign-k/queue.md`, OBSERVER-BURST-FLAKE, requests one small PR without loosening the count. The watcher cleared the test-only route at 15:20 on 15 November. Claude's 244-second plan read accepts the cause and event barrier but asks for less synchronization. The driver recommends an idle endpoint, with scheduling pauses confined to disposable controls; that scope question is with the watcher at 15:26. No owner design approval is claimed; build waits for that answer.

## Evidence and reuse

The supplied `receipts/observer-burst-flake/paused-observer.trace` shows one event consumed before worker 2 starts and two during worker 2, leaving a third pass pending. The watcher-needed entry reports the matching expected-two/received-three reproduction; this planning session has not rerun it. Writing the FIFO does not establish consumption (`scripts/waitron-box-sh.test.mjs:731`).

History: `git show 983a3908ee -- scripts/waitron-box-sh.test.mjs` shows #3291 added the burst case and send-then-finish ordering; #3224 (`b43852bf05`) added forget forwarding, without an observer test. Reuse `observing()` (`scripts/waitron-box-sh.test.mjs:649`), its FIFO, captured stderr, held-worker `finish(n)` files, child handle and cleanup. Trace the real Bash observer only for this case. Keep the existing worker stub and all behavioral assertions.

## Exact files and responsibilities

- Modify only `scripts/waitron-box-sh.test.mjs`: optional trace support in `observing()` and the case “starts after the grace and retains a burst while the worker is running” (currently lines 723–758).
- Read only `deploy/box/waitron-box.sh:155–200`: `network_monitor()` defines event consumption, worker completion and the idle loop. Production changes: none.
- Add only this plan, `docs/superpowers/plans/2026-11-15-observer-burst-flake.md`; no other documentation changes in this task.

## One implementation task, after review and clearance

- [ ] Establish the failing control first: pause only the owned observer shell after worker 1 starts, enqueue the burst, finish worker 1 while paused, then resume. Retain a trace and the expected-two/received-three failure before correcting the handoff.
- [ ] Enable only the observer with `bash -x`. Set `PS4` in the existing helper's test-only `BASH_ENV` file, defaulting the current event as `${line-}` and ending with `unset BASH_ENV` so child stubs do not inherit it. Keep manual-clock setup composable. Bound waits and include accumulated stderr on failure; no general trace framework.
- [ ] Await the final `profile removed` event's `dirty=1` trace with worker 1 still outstanding before calling `finish(1)`. Scan accumulated stderr, not individual chunks. A successful FIFO write or a trace of the pending `read` is insufficient. The same controlled scheduling pause proves red/green in a disposable checkout; it need not remain in the landed case, subject to the watcher's scope answer.
- [ ] Keep the elapsed-grace check, exact two `systemctl start waitron-network-change.service` calls, worker-2 exit check and final `observer.count() === 2` assertion. Replace only the final `sleep(2200)` with the idle-state wait below.
- [ ] Define idle after worker 2 as: its successful `wait` has completed, `waiter_pid` is empty, `dirty=0`, and the next loop has skipped launching work and entered the timed FIFO `read`. Match this ordered sequence after worker 2, never an earlier read or worker exit alone; assert the final count then.
- [ ] Disposable pause controls resume the owned shell in `finally` before the existing stop path. No pause cleanup is needed in the landed test if the watcher accepts that cut.
- [ ] In disposable copies, force `dirty=0` after a successful worker wait and require the second-start assertion to fail at one; force `dirty=1` after success and require the final idle/count check to fail. Restore and require the focused case to pass. Keep traces only in local campaign receipts and summarized in the PR, never in product state.
- [ ] Run `pnpm exec vitest run scripts/waitron-box-sh.test.mjs -t 'starts after the grace and retains a burst while the worker is running'`, then the same file without `-t`. Require reported passing counts and both controls, not repeated lucky passes. Record timing changes in the PR's “Changed test checks” section. No backlog entry describes this queue-only test defect; B3 product/qualification state remains unchanged.

## Exclusions and size

No product behavior, debounce, grace/retry policy, production trace hook, dependencies, assertion weakening, unrelated cleanup or new test suite. No tests run, agents started, model changes or commits in this documentation-only task.

Expected implementation diff: production **+0/−0**, tests/support **about +40/−5**, documentation **about +35/−0**, total **about 80 changed lines**. Seek an outside opinion at **120 changed lines** before expanding scope.
