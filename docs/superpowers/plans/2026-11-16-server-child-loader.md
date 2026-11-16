# Server child-loader measurement plan

**Goal:** Evaluate one native-stripping loader against `tsx`; keep code only after measured savings with unchanged assertions.
**Authority:** CHILD-LOADER in `/Users/clintongormley/waitron-campaign-i/queue.md`, started 2026-11-16 20:25. Separate Sol/high draft checked by Codex; Claude reviewed the approach. Watcher clearance is pending. No owner design approval is claimed.

## Smallest experiment first

- [ ] In disposable baseline/candidate checkouts of the same signed head, install pinned dependencies. The baseline stays unchanged; candidate edits replace only the three `tsx` preload arguments below. Keep all module-replacement hooks, clocks, IPC, retained listeners, diagnostics and assertions.
- [ ] Before writing a scratch resolver, run one bounded subprocess assertion that a typed fixture imported as `.js` exports a known value; an empty preload must fail with `ERR_MODULE_NOT_FOUND`. Add only a scratch `registerHooks` resolver and observe that assertion pass. Delegate normal resolution first; retry missing `.js` as `.ts`, including workspace deep imports, retaining query/hash. Preserve real JavaScript and `ERR_PACKAGE_PATH_NOT_EXPORTED`; propagate unrelated errors.
- [ ] Run the candidate's real child paths through the unchanged activation, stepdown and placement-1 tests, recording exits/output. The hypothesis is incompatibility: imports reach constructor parameter properties (`payments-sumup/src/provider.ts:126`, `spare-copy.ts:78`, `mirror-bundle-fetch.ts:336`); a native failure should name `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Do not edit product code or add a transformer. If incompatible, record the observed refusal and keep a docs-only rejection, with no successful timing or saving claim. Ask the watcher to clear this rejection branch before the experiment.

## Only if compatible

- [ ] Run each whole file below separately with `pnpm --filter @waitron/server exec vitest run src/<file>.test.ts --maxWorkers=1`: three pairs/file, AB/BA/AB. Compatibility runs are not timing samples. Require identical test names/counts, no new skips and successful exits. Placement-2 has no child launch and is the unchanged control.
- [ ] Record all six durations/file, medians, paired differences and seconds/percent saved; distinguish command wall time and Vitest file time. Retain exact commands, SHAs/diffs, runtime/tool versions, timestamps, OS/CPU, load/headroom and cache settings. No shared-cache clearing. Require all three child-file median savings to exceed the control's largest absolute paired difference; mixed/noisy results go to the watcher without more runs/candidates. State Mac-only, cache/host-noise limits and differing native class-field semantics.
- [ ] Only then build the permanent preload and one focused subprocess test, test-first. It checks `.js`/`.ts` resolution including workspace deep imports, real-JS precedence, exports refusal and existing replacement-hook precedence. Run it and all four original files with final arguments; no existing assertion changes.

| Files | Change |
| --- | --- |
| `apps/server/src/handover-stepdown.crash.test.ts`, `handover-activation-repair.test.ts`, `hour-recovery-placement-1.test.ts` | Only child preload arguments; activation-kill child stays unchanged. |
| `apps/server/src/hour-recovery-placement-2.test.ts` | Unchanged control. |
| New `apps/server/src/testing/native-child-loader.ts` and sibling `.test.ts` | Ship only on demonstrated gain. |
| `docs/backlog.md`, `docs/backlog/ci.md` | Remove only the loader open point; retain a dated result and remaining work. |

No bundles, production/fiscal edits, restart-test double boots, fixed-secret/memo work or CI machinery. Expected permanent code/support 20–60 lines, tests 60–120, docs 30–60; report additions/removals separately. Beyond 1.5 times the estimate returns to watcher. Code outcome uses `finish-branch` and current-head CI; rejected prototype uses docs-only workflow and deletes scratch code/runtime state.

| Provenance, read 2026-11-16; docs v26.13.1, local runtime v26.13.0 | Quote and implication |
| --- | --- |
| [Node TypeScript](https://nodejs.org/api/typescript.html#typescript-features) | “parameter properties” require transformation; native compatibility must be run, not assumed. Node 26 removed `--experimental-transform-types`; changing candidate is excluded. |
| [Node hooks](https://nodejs.org/api/module.html#convention-of-hooks-and-chaining) | “in LIFO order”; retain child replacements after registering the preload. |
