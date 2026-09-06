# Task 9 measurements (plan Task 9 Steps 1 and 3)

Pattern: `grep -rlE "useRealPostgres|describeEachTarget|startMigratedPostgres|useTemplateDb|REQUIRE_DOCKER|startPostgresContainer" packages apps --include='*.test.ts' | grep -v node_modules | wc -l`

| when | where | real-PG test files |
| --- | --- | --- |
| before (base 464b3711 = origin/main at the rebase) | /tmp/waitron-base | 212 |
| at 8e0749a6 (Task 6 closed; Tasks 3–6 already deleted/renamed RLS suites) | worktree | 175 |
| after Task 9 (24279d3) | worktree | 159 |

Wall clock BEFORE: **352 s** (main checkout at f81edf2a = origin/main after SP-3d, `pnpm install --frozen-lockfile` + `pnpm reap` first; `pnpm vitest run --coverage` rc 0 then `TESTCONTAINERS_RYUK_DISABLED=true pnpm -r --workspace-concurrency=2 test:coverage` rc 0; logs task-9-before-{root,packages,timing}.log; 2026-09-06). The branch is rebased onto f81edf2a (Task 8e), so before/after compare like with like. Original ruling: the "before" timing runs on the main checkout after `pnpm install`, alone on the machine — never beside a Codex seat or a browser-mode gate — and the "after" timing on the worktree at Task 9's head, same conditions. Commands (plan Task 9): `time (pnpm vitest run --coverage && TESTCONTAINERS_RYUK_DISABLED=true pnpm -r --workspace-concurrency=2 test:coverage)`.


Step 3 file-count receipt (2026-09-06, implementation head `24279d3`):

```sh
grep -rlE "useRealPostgres|describeEachTarget|startMigratedPostgres|useTemplateDb|REQUIRE_DOCKER|startPostgresContainer" packages apps --include='*.test.ts' | grep -v node_modules | wc -l
```

```text
     159
```

Recorded pair: **real-PG files 212 → 159**. Task 9 itself moves 19 files: 17 matched this grep and two server suites used `cloneTemplate` directly. The candidate table and package/check receipts are in `task-9-report.md`.

Wall clock AFTER: **controller pending**. The implementer did not run the whole-workspace timing. Leave `full suite <before> → <after>` for the controller to fill in the PR body after its isolated run (the recorded before value is 352 s).
