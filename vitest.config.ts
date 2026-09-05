import { defineConfig } from "vitest/config";

// The repo-level test project — the one gate that is never narrowed away. It holds the work that
// belongs to no package, which since 2026-08-01 is three kinds:
//
//   the two CLASSIFIERS (`scripts/changed-*.mjs`) that decide what CI and the pre-push hook run;
//   the repo-wide GUARDS (`scripts/*.test.ts`), which read `packages/` and `apps/` whole —
//   guarded-teardowns scans every `*.test.ts` under both, english-only scans the twenty generic
//   packages' `src/`, errors-reachable walks each `packages/*` public barrel's import graph
//   for an `errors.ts` that has gone unreachable, allergen-names-drift pins the 14 EU allergen
//   display names equal across the till and dashboard i18n copies, and module-graph-honesty
//   cross-checks every module descriptor's `requires` against the FK/trigger edges its
//   `packages/*/drizzle` SQL creates against other modules' tables, and coverage-thresholds pins
//   which package holds which coverage bar;
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
    // Scoped deliberately. Vitest's default include is `**/*.{test,spec}.?(c|m)[jt]s?(x)`, which
    // from the repo root sweeps up every package's suite and would run the whole workspace twice —
    // once here and once through `pnpm -r`. Two extensions rather than one glob with a brace:
    // `.mjs` is the classifiers, `.ts` is the guards.
    include: ["scripts/**/*.test.mjs", "scripts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // `include` REPLACES the default rather than merging with it, so a directory that is not
      // named here is not measured at all — and a coverage gate cannot fail on a file it never
      // opened. Read the per-file table, not the exit code.
      //
      // There is deliberately no `exclude`. The obvious one — the two `*.test.mjs` suites — would
      // be dead config: re-measured on 2026-08-01 in three spellings, no `exclude` key at all,
      // `exclude: []`, and `exclude: ["**/*.test.mjs"]`, `pnpm vitest run --coverage` printed the
      // identical table every time — exactly the three files `include` names below,
      // `english-only.ts`, `changed-packages.mjs` and `changed-scope.mjs`, all at 100/100/100/100,
      // and no `*.test.mjs` row. Three spellings all pointing one way, NOT a measurement in both
      // directions; a control would need an `exclude` that does change the table. (The first
      // version of this comment asserted the opposite — that deleting the line would add two rows —
      // and was written before it was run. The version after that described a TWO-row table: true
      // of the `include` it was written against in 6d30ed2, and stale the moment
      // `packages/db/src/english-only.ts` joined that `include` one commit later. CLAUDE.md §1,
      // twice over.)
      //
      // Until 2026-08-01 this config DID need an `exclude`: it spread `coverageConfigDefaults`
      // back in with `**/[.]**` filtered out, because the sources lived under `.github/scripts/`
      // and that one default pattern excludes every dot-prefixed path segment — silently, at zero
      // coverage and exit 0. Moving both classifiers to `scripts/` is what retired it; the lesson
      // it left is in CLAUDE.md §4.
      //
      // What `include` MEANS here, now that the guards have moved in: the code whose only tests
      // are in THIS project. That is the two classifiers, and one file that is not under
      // `scripts/` at all — `packages/db/src/english-only.ts`, the vocabulary guard's module,
      // whose suite is `scripts/english-only.test.ts`. The module stayed behind because two other
      // files in the tree reach for it where it is: `packages/db/src/schema/series.test.ts`
      // imports `findSpanish` from it, and `packages/fiscal-verifactu/src/vocabulary-scope.test.ts`
      // reads its source text by relative path. `packages/db`'s own config excludes it in the same
      // change, so it is measured in exactly one place rather than in two or in none — the failure
      // mode being the last of those, which no threshold anywhere would report.
      //
      // Not `scripts/**/*.ts`: the only `.ts` files under `scripts/` are the guard SUITES, and
      // Vitest leaves a suite out of its own coverage table whatever this says (measured on
      // 2026-08-01: with `include: ["scripts/**/*.mjs", "scripts/**/*.ts"]` the table held the two
      // classifiers and nothing else). It would be a pattern matching nothing, which is what the
      // paragraph above deleted an `exclude` for.
      include: ["scripts/**/*.mjs", "packages/db/src/english-only.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
