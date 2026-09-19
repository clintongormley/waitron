import { defineConfig } from "vitest/config";

// The repo-level test project — the one gate that is never narrowed away. It holds the work that
// belongs to no package, which since 2026-08-01 is three kinds:
//
//   the two CLASSIFIERS (`scripts/changed-*.mjs`) that decide what CI and the pre-push hook run;
//   the repo-wide GUARDS (`scripts/*.test.ts`), which read `packages/` and `apps/` whole — among
//   them, guarded-teardowns scans every `*.test.ts` under both, english-only scans the generic
//   packages' `src/`, errors-reachable walks each `packages/*` public barrel's import graph
//   for an `errors.ts` that has gone unreachable, allergen-names-drift pins the 14 EU allergen
//   display names equal across the till and dashboard i18n copies, module-graph-honesty
//   cross-checks every module descriptor's `requires` against the FK/trigger edges its
//   `packages/*/drizzle` SQL creates against other modules' tables, module-seams reads every
//   non-test source file under `packages/provisioning/src` and `apps/server/src` for a `from
//   "<regime package>"` prefix, coverage-thresholds pins
//   which package holds which coverage bar, column-vocabulary reads every `.ts` file under both
//   roots for a column builder imported straight from `drizzle-orm/pg-core` — which only
//   `packages/db/src/schema/columns.ts` may do, so that the SQLite switch replaces one file —
//   brand-icons pins each app's `index.html` icon
//   links and `vite.config.ts` publicDir against the one brand directory in `packages/ui`,
//   enum-add-value-safety reads every migration set named by
//   `packages/migrations/migrations.manifest.json` for a migration that NAMES an enum label a
//   migration in the same pending batch ADDED — drizzle applies a set's pending migrations in one
//   transaction, so PostgreSQL rejects that on an existing database while a fresh one passes — and
//   journal-monotonic reads the same sets' `meta/_journal.json` for a `when` value at or below one
//   already recorded, which drizzle's `max(created_at)` watermark skips with no error;
//   `scripts/check-signoff.test.mjs`, which covers the sign-off predicate both gates share and
//   runs licence.yml's `dco` step extracted from the workflow file.
//
// The guards lived in `packages/db` until then, and both gates had stopped running them on most
// pushes: they only load when `packages/db` is in scope, and the scoping ships two shapes that do
// not reach it. Measured on 2026-08-01 in this worktree —
// `pnpm --filter "...@waitron/ui" ls -r --depth -1 --json` lists `@waitron/ui` alone, and
// `--filter "...@waitron/payments"` lists six packages, none of them `@waitron/db`. CI's
// `test-heavy` shard is gated on `@waitron/db` being in scope too, so on such a pull request their
// first run was the unfiltered `main` merge. Here they are ungated in both places: ci.yml's `lint`
// job runs `pnpm vitest run --coverage` on every push, and `.husky/pre-push` runs it on every push
// that is not documentation-only.
//
// WHAT THE MOVE COST, stated because nothing else in the tree says it: the guards under `scripts/`
// are TypeScript and NOTHING TYPECHECKS THEM ANY MORE. The workspace root is outside `pnpm -r`, so
// `pnpm typecheck` never visits it, and there is no root `tsconfig.json` to visit — CLAUDE.md §2
// carries the mutation that measured that. Run here in both directions on 2026-08-01, one line,
// `export const brokenProbe: number = "not a number";`:
//
//   in packages/db/src/<name>.test.ts   `pnpm --filter @waitron/db typecheck` fails,
//                                       `error TS2322: Type 'string' is not assignable to type
//                                       'number'`, `Exit status 2`
//   appended to scripts/guarded-        `pnpm typecheck` exits 0 and the suite still passes 12/12
//   teardowns.test.ts                   — Vitest transpiles without typechecking
//
// So a type error in one of these files is now caught only when it is also a runtime error.
//
// Deliberately not fixed here, for a reason that is about this repository rather than about
// effort: the pre-push hook's typecheck step is SCOPED (`pnpm "$@" typecheck`), so on the
// `packages/ui` push this whole change exists for, a root `tsconfig.json` would not be typechecked
// either. It would buy the property back in CI's unfiltered `typecheck` job alone, at the price of
// `typescript` and `@types/node` as root devDependencies and an inverted CLAUDE.md §2 receipt.
// docs/backlog.md carries it as a follow-up.
export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // Scoped deliberately. Vitest's default include is `**/*.{test,spec}.?(c|m)[jt]s?(x)`, which
    // from the repo root sweeps up every package's suite and would run the whole workspace twice —
    // once here and once through `pnpm -r`. Two extensions rather than one glob with a brace:
    // `.mjs` is the classifiers, `.ts` is the guards.
    include: ["scripts/**/*.test.mjs", "scripts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // `include` REPLACES vitest's default rather than merging with it, so a path not named here is
      // measured NOWHERE — and a coverage gate cannot fail on a file it never opened. Read the
      // per-file table, not the exit code (CLAUDE.md §4).
      //
      // What belongs here: code whose only test suite lives in THIS root project and is covered
      // nowhere else. That is the two classifiers under `scripts/` (their suites are the root
      // `*.test.mjs`) and `packages/db/src/english-only.ts`, the vocabulary guard's module —
      // `@waitron/db`'s typecheck covers it, `packages/db` excludes it from its own coverage, and its
      // suite is `scripts/english-only.test.ts`, so this `include` is the ONE place that measures it.
      //
      // Not `scripts/**/*.ts`: the only `.ts` files under `scripts/` are the guard SUITES, and vitest
      // leaves a suite out of its own coverage table whatever this says, so that glob would match
      // nothing. There is deliberately no `exclude` (a suite is never measured, so naming one changes
      // nothing).
      include: ["scripts/**/*.mjs", "packages/db/src/english-only.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
