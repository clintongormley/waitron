# Server child loader implementation and measurement plan

**Goal:** Keep a native TypeScript child loader only if real test files show repeatable savings over `tsx`, preserving every assertion.
**Authority/status:** CHILD-LOADER, `/Users/clintongormley/waitron-campaign-i/queue.md`, started 2026-11-16 20:25. Separate Sol/high planning artifact per `RUNNER.md`: driver checks/signs, obtains Claude plan review and watcher clearance before building. No owner design approval or new measurement is claimed.

## Scope and source map

Evaluate exactly one candidate: Node native type stripping plus a synchronous `registerHooks` resolver. No bundling, production startup changes, fiscal invariant edits, first-fiscal-hour double-boot work, fixed-secret work, recovery-key memo work, or changes to what children test.

| Target | Responsibility |
| --- | --- |
| New `apps/server/src/testing/native-child-loader.ts` | Test-only preload registering the small resolver; no application imports or transforms. |
| New `apps/server/src/testing/native-child-loader.test.ts` | Focused real-subprocess compatibility tests, using temporary fixture files. |
| `apps/server/src/handover-stepdown.crash.test.ts:244` | Replace only the `tsx` preload argument after measurement; preserve retained-listener preload, IPC, markers and substitution hooks. |
| `apps/server/src/handover-activation-repair.test.ts:132` | Replace only the preload; retain `src/testing/handover-activation-kill-child.ts` unchanged. |
| `apps/server/src/hour-recovery-placement-1.test.ts:885` | Replace only the preload; retain allocation/time-service/release replacements and both frozen clocks. |
| `apps/server/src/hour-recovery-placement-2.test.ts` | Run unchanged as the requested behavioral control; it currently has no child launch. |
| `docs/backlog.md`, `docs/backlog/ci.md` | Update index and detail together with measured outcome and remaining work. |

Placement-2 shares `apps/server/test/hour-recovery-host.ts`; retain it unchanged as the requested in-process control.

## Execute after review and clearance

- [ ] **RED/GREEN:** Add “loads missing relative and file .js imports from TypeScript”, following `src/testing/child-process-death.test.ts` (bounded `execFile`, temporary files, cleanup). Observe `ERR_MODULE_NOT_FOUND` with an empty preload; implement the resolver; require exact values and exit 0, preserving assertions.
- [ ] **Resolver:** `registerHooks({ resolve(specifier, context, nextResolve) })` delegates first. Retry only a missing requested relative/file `.js` URL as `.ts`, preserving URL components. Keep real `.js`, bare packages/exports and unrelated errors unchanged; failed fallback retains the original refusal.
- [ ] Add subprocess controls for distinct real `.js`/`.ts` twins, workspace exports/private-subpath refusal, later replacement-hook precedence and missing-module/unrelated refusals. Run `pnpm --filter @waitron/server exec vitest run src/testing/native-child-loader.test.ts --maxWorkers=1`; read the count. Existing suites own crash, clock, kill, counter and replay assertions.
- [ ] **Compatibility/measurement:** A local driver outside the repo intercepts only the three launches' `tsx` argument to select A (`tsx`) or B (candidate), logging replacements. Preserve sources, parent Vitest and all other launch details. If B cannot run the real files, retain diagnostics and return to watcher; no second candidate or product repair.
- [ ] Run each of the four whole files separately with `pnpm --filter @waitron/server exec vitest run src/<file>.test.ts --maxWorkers=1`. Three pairs/file, AB/BA/AB; first compatible pair counts. Require identical test names/counts, no new skips, successful exits. Failed runs are not timing samples.
- [ ] Record six durations/file, medians and paired savings; separate command wall time and Vitest file time. Retain SHA/diff, exact commands, runtime/tool versions, OS/CPU, timestamps, load/headroom and existing cache settings around pairs. Clear no shared caches. State Mac-only, warming and contention limits.
- [ ] **Decision:** Keep code only for consistent paired savings and no material control regression. Noisy/conflicting results return to watcher without more runs. Replace only the three preload arguments on success; discard candidate code/tests otherwise. Update both backlog files with the measured outcome, removing only this open point and preserving remaining work.

## Finish line and limits

Rerun the focused test and four whole files with final arguments, no interception. Preserve existing assertions, retained listeners, clocks, timeouts and diagnostics. No whole-package run or new CI/cache machinery. Code: `finish-branch` and current-head CI; rejected candidate: docs-only measurement receipt, no code shipped.

Expected: 100–250 code/support lines, 50–120 test lines, concise docs; one code PR if accepted. Count additions/removals separately; growth beyond 1.5× returns to watcher. Finish with a measured faster loader preserving behavior, or a documented rejection shipping no code.

| API provenance (documentation read 2026-11-16; reference v26.13.1, local runtime to measure v26.13.0) | Quote, then implication for this candidate |
| --- | --- |
| [Node TypeScript](https://nodejs.org/api/typescript.html#type-stripping) | “only erasable TypeScript syntax”; “no type checking is performed.” Treat native execution as a compatibility hypothesis; keep package typechecking and stop on unsupported syntax. |
| [Node registerHooks](https://nodejs.org/api/module.html#moduleregisterhooksoptions), [hook chaining](https://nodejs.org/api/module.html#convention-of-hooks-and-chaining) | “these chains run last-in, first-out (LIFO).” Register the fallback preload before child code registers its existing replacements; verify replacement output in subprocesses. |
