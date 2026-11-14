# A1398-2: parties test task waits

Codex plan reviewed by Claude on 14 November (139 s initial read, 58 s corrections read). Watcher clearance is pending; implement inline and land the plan docs only after it. No owner design approval is claimed.

Ask, quoted from `~/waitron-campaign-i/queue.md` A1398-2: “every CI test job finishes in about four minutes (owner, 2026-10-09 and 2026-10-11; CLAUDE.md §2: "Fix the cause, never cut a check"). Measure the cause before a performance plan; at most one page, Claude review and watcher clearance.” Watcher `questions.md`, 2026-11-14 06:51, directs till next.

## Measured evidence and its limits

Receipts below are under `~/waitron-campaign-i/receipts/`; reuse them without another baseline run.

- `a1398-next-cut-20261114/measurement-summary.md`: scheduled coverage-on `43545365252` (`58d3c38bdd`) has till2 job/test-step/parties 271/236/223.5 s. Watcher 03:51 qualified its 11 s maximum checkout and clean 5xx/incident checks. Coordinated `43544246652` (`03313e5cb2`) gives 221/194/185 s; 12 s checkout remains corroboration, not independently qualified.
- Retained hosted `43555982953` attempt 2 (`a61d1f9303`): till2 264 s, parties 218.1 s. Watcher 06:51 qualified dashboard specifically, not till.
- `till-profile-20261114/{baseline,instrumented,profile-summary}.json`: unchanged baseline 680/680 in 377.22 s; timing-only instrumentation 680/680 in 368.31 s (367.25 s tests), both local and coverage-off at main `ca0495b3da36d9df21a2083d719530bbde17ebb9`. Parties/helpers/config blobs match scheduled main. The instrumentation was removed before this draft.
- The instrumented helper made 4,515 calls and 14,680 real timer turns, spending 179.328 s awaiting those timers (48.8% of test time), versus 627 fake advances taking 9.920 s and updates taking 0.029 s. Wait intervals include other browser work, not guaranteed removable idle time. `measurement-summary.md` and `instrumentation.patch` retain the method.
- `browser-turn-probe.json`: on an independent idle Chromium 158 page, 1,000 zero-delay timer turns took 22,445.6 ms versus 7.1 ms for MessageChannel turns. That measures mechanics, not a file saving. CI case profiles show distributed work across all 680 cases; batched hook reports do not establish an afterEach cause.

Expected saving is tens of seconds from replacing repeated timer waits; this is an inference, not a timed candidate. Scaling the local wait share to the 223.5 s CI file gives a roughly 109 s ceiling only if the share transfers and all interval time is removable, neither established. The useful budget is at least 31 s off the 271 s job; qualify the actual result rather than treating that optimistic ceiling as a forecast.

## Smallest useful change

In `apps/till/src/till-app-parties.test.ts:435`, replace only flush's real-time `setTimeout(0)` yield with local `nextTask(): Promise<void>`. Reuse `apps/dashboard/src/screens/payments-screen.test.ts:155`'s MessageChannel pattern, closing both ports inside the message handler before resolving. Keep actual task boundaries; fast turns do not promise a rendering frame between rounds.

Preserve default three rounds, explicit round counts, fake-timer advance and `el.updateComplete`. Inspect dependencies on real due timers: `apps/till/src/state/draft-sync.ts` owns 400 ms autosave, 500 ms retries and abort-driven pauses; retain their waits.

Keep all 680 cases/assertions, explicit autosave/retry waits, native `userEvent` interactions, animation settlement, screenshots/accessibility checks, workers, seven shards, weights, coverage, diagnostics and routing. No product change, shared UI helper, helper framework, timer service, file split, shard increase or assertion rewrite.

## Build and verify after clearance

1. First remove only the real-task yield in a disposable snapshot. Run `pnpm --filter @waitron/till test src/till-app-parties.test.ts -t 'closing its success notice dismisses Undo without changing service'`. Record an original assertion failing: native close must dismiss Undo without sending a service change. Also run unchanged 1280-wide rows in "uses readable controls and a native Undo in %s at %s" and "at $width × $height px, after someone else's unsent dishes refuse the name, their order and its Take over button are on view" (the latter polls `wide`). Filter these matrices with `-t 'uses readable controls and a native Undo'` and `-t "after someone else's unsent dishes refuse the name"`. A no-yield failure proves a task boundary, not a frame. Audit frame-dependent negative checks for an existing definite frame/observer endpoint and list them in the build report; a green file alone cannot rule out a skipped frame effect. If these controls cannot establish the boundary or need new waits/assertion changes, return to the watcher; add no helper suite or elapsed-time assertion.
2. Substitute the helper, excluding instrumentation. Run `pnpm --filter @waitron/till test src/till-app-parties.test.ts`; require original 680/680 and unchanged assertions. Record this run's file/test times against retained 377.22 s / 367.25 s local measurements; this costs no extra baseline run. Require a local gain clearly larger than the 9 s difference between retained runs before requesting hosted qualification; it is not a hosted saving. No package suite. Changed behavior, compensating sleeps or assertion changes mean return to watcher, not repairs elsewhere.
3. Update only A1398's own entries in `docs/backlog.md` and `docs/backlog/ci.md`. Keep the archiver wait and any remaining four-minute gap open. Avoid historical rewrites.

Expected size: production +0/-0; parties test support roughly +12/-1; other docs roughly +10/-3, plus this plan. No other file edits.

## Finish line and hosted check

Deliver the parties-only helper with unchanged checks. Target till2 whole job ≤240 s in a healthy hosted full run; all seven till shards pass, and merge preserves complete file/project/status inventory and 98/98/98/95 coverage. Compare coverage-on on the same runner class; report job/file times separately from forecasts.

At clearance, request exactly one candidate full run from the watcher; no dispatch is authorised now. Keep normal finish-branch Claude reviews, hook and scoped PR CI. Leave the archiver wait and any remaining four-minute gap open.
