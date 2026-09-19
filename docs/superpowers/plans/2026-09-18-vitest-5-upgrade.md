# Plan — upgrade Vitest 3.2.7 → 5.0.1 across the workspace

Status: executed, but against a DIFFERENT target — see the retarget note below.
Branch: `chore/vitest-4-upgrade`
Worktree: `/Users/clintongormley/workspace/worktrees/waitron-chore-vitest-4-upgrade`

> **Retargeted 2026-09-19 — the workspace went to Vitest 4.1.11, not 5.0.1.** Everything below was
> written on 2026-09-18 and is kept as the record of what was planned then. What changed: under
> Vitest 5, Stryker kills no mutants. Upstream reports the cause as a mismatch in how Stryker's
> per-mutant test filter and Vitest 5 spell a test's full name (stryker-js#6210, fix PR #6214 open,
> not released); that mechanism was taken from the issue and is NOT re-verified here. What was
> measured here is the outcome: `packages/fiscal` 98.33% on Vitest 3 and 0.00% on Vitest 5,
> `packages/shared` 92.72% and 8.14%. The owner's decision
> was to take 4.1.11, which has the worker-RPC fix this plan is for and keeps the mutation gate
> working: `packages/fiscal` 98.33% and `packages/shared` 92.72% under 4.1.11, both equal to
> Vitest 3. Section A below is still accurate — `poolOptions` was removed in Vitest 4, not 5 — and so
> is section B: `@vitest/browser-playwright` is published for 4.1.11 too. Section D is the one that
> changed meaning: `clearMocks` defaults to `false` in 3.2.7 and in 4.1.11 and only flips to `true` in
> 5.0.1, so the `clearMocks: false` line every config now carries changes nothing on 4.1.11 and is
> carried deliberately for the next upgrade. Vitest 5 stays open as a later item.

> **Stryker was taken separately, 2026-09-19** (branch `chore/stryker-10`)**.** This plan makes the
> `@stryker-mutator/*` 9 → 10 bump conditional — the scope line below ("ONLY if 9.6.1 will not run
> under vitest 5 (verify first)"), section F ("If it breaks … in this branch, because mutation is a
> gate"), and Execution step 5, which defers to F. None of that gates anything any more.
> 9.6.1 does run under Vitest 4.1.11, which is what shipped, so the bump was never forced; it was
> then taken on its own branch as an ordinary maintenance item, against Vitest 4 rather than 5. Read
> those passages as the record of what was planned on 2026-09-18, not as work still outstanding here.
> What this does NOT settle is Vitest 5: Stryker 10 was not run under it here, and stryker-js#6210 is
> not mentioned in the 10.0.0 release notes, so a future Vitest 5 attempt must measure mutation
> again rather than assume the major fixed it.

## Why

The `test-server` shard fails intermittently with `[vitest-worker]: Timeout calling "onTaskUpdate"`
even when every test passes: the worker's report-to-main call has a hard 60-second limit in vitest
3.2.7, and under the oversubscribed shard (4 workers + the main process + a PostgreSQL container on a
4-core runner) that round trip can exceed it. **Vitest fixed this in 4.0.0** by setting the worker RPC
timeout to `-1` (no limit); 3.2.x never got the fix. We are on `^3.0.0`, which cannot cross a major, so
we never picked it up — the version is drift, not a decision. Upgrading to the current major (5.0.1)
removes the flake at its root and stops us being two majors behind.

Full root-cause receipt: `docs/developers/ci-and-gates.md` → "A shard can exit 1 with every one of its
tests passing".

## Scope

IN: `vitest`, `@vitest/coverage-v8`, and the browser stack (`@vitest/browser` → `@vitest/browser-playwright`)
from `^3` to `^5` in every workspace project; the `vitest.config.ts` migrations these force; the guard
tests and comments that name the old pool vocabulary; the CLAUDE.md / docs paragraphs the change makes
stale. `@stryker-mutator/*` 9 → 10 ONLY if 9.6.1 will not run under vitest 5 (verify first).

OUT (each its own branch): TypeScript 5.9 → 7, vite 6 → 8, `@hono/node-server` 1 → 2,
`@simplewebauthn/*` 13 → 14, `fast-xml-parser` 4 → 5, `qrcode-generator` 1 → 2, and every minor/patch
bump. Folding any of these in would make one unreviewable change.

## Breaking changes, mapped to our exposure

### A. `poolOptions` removed (v4) — the largest mechanical change
v4 deletes `poolOptions`; its contents move to the top level, and the fork/thread vocabulary unifies:
- `poolOptions: { forks: { singleFork: true } }` → `maxWorkers: 1, isolate: false`. **~30 packages.**
- `poolOptions: { forks: { maxForks: N } }` → `maxWorkers: N`. apps/server=4, packages/db=4,
  packages/fiscal-verifactu=4, packages/media=2.
- Several browser packages nest `poolOptions` inside a project/browser block (bookings,
  payments-stripe, payments-sumup, venue-service) — migrate in place.
- The single-fork setting is **load-bearing**: `@vitest/coverage-v8` under-merges branch coverage
  across forks under `pnpm -r` contention, which is why payments/scheduler/etc. pin one fork. The
  documented v4 equivalent of one fork with shared state is `maxWorkers: 1, isolate: false` — preserve
  that exact behaviour, and keep each config's WHY comment, rewritten to the new option names (CLAUDE.md
  §1: a behaviour change retires the old receipt).
- Guard: `scripts/fiscal-test-budget.test.ts` pins `maxForks` for fiscal-verifactu and media by reading
  the config TEXT — update it to `maxWorkers`. Grep for any other guard that reads pool text.

### B. Browser provider is now a separate package (v4/v5) — 9 packages
bookings, media, payments-stripe, payments-sumup, venue-service, ui, dashboard, till, setup.
- Remove `@vitest/browser`; add `@vitest/browser-playwright`.
- Config changes from a string to a factory:
  ```ts
  // before (v3)
  browser: { provider: "playwright", headless: true, instances: [{ browser: "chromium" }] }
  // after (v5) — verify the exact import path during execution
  import { playwright } from "@vitest/browser-playwright";
  browser: { provider: playwright({}), headless: true, instances: [{ browser: "chromium" }] }
  ```
- Import browser utilities from `vitest/browser` (was `@vitest/browser/context` / `/utils`).
- Matcher/behaviour changes to fix in the browser tests: `toHaveTextContent` is strict now
  (`toMatchTextContent` for partial/regex); locators match text exactly by default; `render()` returns
  a promise; UI page needs token auth (does not affect headless CI runs, but note it).

### C. Coverage remapping rewritten (v4) — the fiscal-threshold risk
- `@vitest/coverage-v8` v4 is AST-based, so **coverage numbers will move**. The gated packages sit at
  98/98/98/95 (verifactu, fiscal-verifactu, core, db, sync, payments) and 90/90/85/85 elsewhere; a
  small remap shift can cross a line.
- v4 reports only COVERED files unless `coverage.include` is set. Our configs rely on the old
  include-everything default, so a zero-coverage file would silently drop OUT of the denominator and
  inflate the percentage. Add an explicit `coverage.include` (the package's source globs) to every
  gated package so the denominator stays honest.
- Recalibration rule: run each gated package's coverage under v5, compare to its threshold. If a number
  DROPS, find why (a genuinely newly-uncounted branch) before touching anything. **Never lower a fiscal
  threshold to make the bar green** — that is the §1 defect class. A threshold only moves with a stated,
  reviewed reason.

### D. Mock/spy + assertion behaviour (v4/v5)
- `clearMocks` default flips to `true` in v5 (was `false`). See Decisions.
- `mock.invocationCallOrder` starts at 1 (was 0); automocked getters return `undefined`;
  `restoreAllMocks` only restores `vi.spyOn` spies; `vi.mock`/`vi.hoisted` must be top-level. Audit and
  fix the handful of sites that depend on the old behaviour.
- v5: an unawaited async assertion now FAILS the test (was auto-awaited with a warning); `expect.poll`
  rejects on timeout. These surface latent test bugs — fix the test, do not paper over.
- `test()`/`describe()` no longer take options as a third argument (v4): `test(name, () => {}, {retry})`
  → `test(name, {retry}, () => {})`. Grep and fix.
- `testNamePattern` matches with ` > ` separators (v5) — check any `-t` use in scripts (CI uses
  `--shard`, so low risk).

### E. Reporters / output (v4/v5)
- `json`/`junit` reporters write to files by default now; CI uses `--reporter=blob` explicitly, so
  verify the shard + merge jobs still produce and consume `blob-N.json`.
- Worker/pool ids start at 1 (was 0); the `.vitest` artifact dir is consolidated. Grep source for
  `VITEST_POOL_ID` / worker-id assumptions (e.g. container naming) before trusting.

### F. Stryker mutation compatibility
- `@stryker-mutator/vitest-runner` peers `vitest >=2.0.0`, so 9.6.1 MAY run under vitest 5. Verify by
  running `pnpm --filter @waitron/ui mutation` early. If it breaks, bump `@stryker-mutator/core` and
  `@stryker-mutator/vitest-runner` to 10 together (a stryker major — read its config breaking changes)
  in this branch, because mutation is a gate.

## Execution (subagent-driven, TDD not applicable — this is make-it-green)

1. Bump `vitest` + `@vitest/coverage-v8` to `^5.0.0` in every package.json + root; in the 9 browser
   packages swap `@vitest/browser` → `@vitest/browser-playwright`; `pnpm install`.
2. Mechanical `vitest.config.ts` migration: `poolOptions` → top-level `maxWorkers`/`isolate`, preserving
   each WHY comment in the new vocabulary; migrate browser configs to the factory provider; add
   `coverage.include` per gated package.
3. Get the whole workspace to typecheck and every config to load.
4. Per group, run `test:coverage`, fix breakages, confirm thresholds — order by risk and RAM:
   non-browser/non-fiscal first; then fiscal (db, fiscal-verifactu, core, sync, payments, verifactu);
   then the browser packages in real Chromium, sized to measured headroom (CLAUDE.md §2/§4).
5. Mutation on the five stryker packages; fix or bump stryker per F.
6. Update guards (`fiscal-test-budget` and any config-text guard) and run the root guard suite.
7. Update the stale prose: CLAUDE.md §2 (the onTaskUpdate 60s writeup — now fixed by the upgrade) and
   §4 (`singleFork`/`maxForks` vocabulary), the `singlefork-is-load-bearing` reasoning, and
   `docs/developers/ci-and-gates.md`. Record the coverage-number moves and any threshold decision.
8. `/finish-branch`.

## Validation
- Every gated package green at its threshold under v5; browser suites pass in real Chromium.
- Mutation green on the five packages.
- Root guard suite green.
- Confirm the fix landed: the installed v5's worker rpc chunk sets `timeout: -1` (grep node_modules).
- Full CI green on the PR head.

## Decisions for the owner
1. **`clearMocks` default flip.** DECIDED (owner, 2026-09-18): preserve v3 behaviour — set
   `clearMocks: false` so this branch stays strictly about the upgrade; adopt the new `true` default
   later as its own cleanup.
2. **Coverage threshold moves.** If the v8 remap shifts a fiscal package below its bar for a legitimate
   reason, do we hold the bar and add tests, or record a reviewed adjustment? Recommendation: hold the
   bar; investigate every drop before considering a change.
3. **Landing amid the campaigns.** This touches every package.json + the lockfile, so it rebases against
   both campaign lanes. Proceed in parallel and absorb the rebases (standing preference), or pause the
   lanes for the land.
