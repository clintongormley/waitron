# A1398-2: shorten the slow dashboard and till files

**Finish line.** Keep every check and make the four dashboard and seven till CI jobs finish in about 240 seconds on qualified coverage-on measurements.
Start with menus and drafts; change product files only for a small, measured saving. This conditional plan awaits Claude's review and the watcher's clearance.

**Evidence.** HEAD is A1398's merge `b36fabffd0c65bc9ebf7efc2907633f28c6b914b` (#2837). Receipts:
`/Users/clintongormley/waitron-campaign-i/receipts/a1398-duration-20261111/after-target-summary.json` and `after-job-*.log`.
Coverage-on run 43034947887 records dashboard jobs 282–311 s, till 182–266 s; menus 163.3 s, editor 80.8 s, list 46.6 s, drafts 171.3 s.
Its receipts record checkouts ≤9 s and no relevant incident/download 5xx; image apt failure is separate. Earlier run 42944859790 and this run are both post-A1427.
File totals and line counts do not diagnose setup, waits or rendering costs.

## 1. Bounded diagnosis before choosing the edit

Use existing `scripts/vitest-file-progress.mjs` with `WAITRON_TEST_TRACE_FILES` selecting the four candidate paths below, relative to each package.
Run each package's candidates once via its existing `test:shard --coverage.enabled=true <files> --reporter=<absolute progress-reporter path>`.
Keep its default/blob reporters and wrap the command with `node scripts/run-with-deadline.mjs 360 --diagnostics --`.
Retain expanded cases and case/hook times; compare setup, body, real-wait and browser-call costs. Allow one targeted follow-up per package, then choose a demonstrated test-only fix or the split fallback. No new profiler/harness.
Inspect menus' `mount`/`mountLunch`, till's `flush`/`settle`/`openTable`, editor's `openSection` and list's viewport hook. These are investigation targets, not diagnosed causes.

## 2. Exact edit surface and fallback

Here `D` means `apps/dashboard` and `T` means `apps/till`. Use only needed splits; move whole groups with assertions, parameter rows, local hooks and names intact. Originals retain other groups.

| File | Responsibility |
| --- | --- |
| `D/src/screens/menus-screen.test.ts` | Primary diagnosis/fix; retain list, forms, home and other cases. |
| `D/src/screens/menus-screen.structure.test.ts` (new if needed) | Existing “the Structure tree” and “an include's Edit dialog” groups. |
| `D/src/screens/menus-screen.prices.test.ts` (new if needed) | Existing Price overrides tab cases, currently between `prices` and “publishing”. |
| `D/src/screens/menus-screen.publishing.test.ts` (new if needed) | Existing “publishing” and “patching the live menu” groups. |
| `T/src/till-app-drafts.test.ts` | Primary diagnosis/fix; retain remaining draft lifecycle cases. |
| `T/src/till-app-drafts.send.test.ts` (new if needed) | Groups from “sending the draft” through “how long a send may take”, inclusive. |
| `T/src/till-app-drafts.recalled.test.ts` (new if needed) | Existing “recalled draft source splitting” group. |
| `T/src/till-app-drafts.authority.test.ts` (new if needed) | Groups from “direct line editing authority” to the end, including routing and phone view. |
| `D/src/widgets/product-editor.test.ts`, `D/src/widgets/product-list.test.ts` | Diagnose; only a localized, measured setup/wait fix, with original interaction assertions retained. No speculative split. |
| `D/test/menus-screen-fixture.ts`, `T/test/drafts-app-fixture.ts` (new only for splits) | Move only shared existing fixtures/helpers; no new mounting or API abstraction. Keep group-only helpers beside their cases. |
| `D/test-durations.json`, `T/test-durations.json` | Refresh changed paths from qualified coverage-on logs with `scripts/test-durations.mjs`; never invent weights. |

Reuse both `src/widgets/test-helpers.ts` modules (`mountWidget`, cleanup, pointer reset), till's `draftServer` and existing screen helpers.
Follow `T/test/allergy-app-fixture.ts` and `D/test/*-fixtures.ts` for moved support outside `src`; do not widen coverage excludes or import tests as support.
Preserve fresh per-case API/server state, locale/storage/history resets, viewport restoration, custom-element registration and deferred-response cleanup.
For helper behavior changes, reproduce a failing behavioral assertion before fixing it. For pure moves, compare expanded case inventories instead of adding mirror tests.

## 3. Verification, measurement and size

Run affected originals/new files together with `pnpm --filter <package> exec vitest run <explicit files>`, separately for `@waitron/dashboard` and `@waitron/till`.
Repeat with `--sequence.shuffle --sequence.seed=1398 --maxWorkers=1 --no-file-parallelism` to expose shared-page leaks. Require equal expanded cases and unchanged assertions.
Run `pnpm exec vitest run scripts/vitest-duration-sequencer.test.mjs scripts/ci-workflow.test.mjs` for discovery/packing and wiring. Let the normal push hook and scoped CI run.
Measure before edits at this base and after the candidate using identical coverage settings; local pairs establish mechanism only. Keep reports outside the packages, running serially with browser memory headroom.
After publication, run `gh workflow run ci.yml --ref <branch>`; retain qualified coverage-on target jobs at the final SHA, with relevant incident overlap checked, no download 5xx and checkout ≤about 10 s.
Compare with 43034947887: per-file/case time, test-step and complete job wall time, setup time, maximum/median and summed target-job seconds. Never mix pre/post-A1427 modes or use coverage-off PR times as the comparison.
Read both current-head browser coverage merges and `98/98/98/95` results; verify every original expanded case ran exactly once across shards, allowing only its file path to change.
Refresh measured weights and remeasure when estimates affect packing. A split alone proves no four-minute success. If bounded work misses the finish line, report the measured remainder to the watcher before expanding; do not mark A1398-2 complete.

Expected size, moved lines counted on both sides: production +0/−0; tests +11,500–13,000/−12,500–14,500 for full fallback (localized fixes instead: ≤80 added/removed).
Support: +800–1,800 fixture lines/−0, plus up to ~1,150 added/removed duration rows. Estimates include fixture moves out of tests; build only needed changes.
Exclude app behavior changes, shared harness/sequencer changes, more workers/shards, threshold/timeout reductions, skipped checks, broad cleanup and campaign edits. Larger changes return to Claude and the watcher first.
