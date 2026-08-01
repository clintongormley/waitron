import { defineConfig } from "vitest/config";

// The repo-level test project. Everything else lives in a package with its own config; this one
// exists for the code that belongs to no package: `scripts/`, which holds the two classifiers that
// decide what CI and the pre-push hook run.
export default defineConfig({
  test: {
    globals: true,
    // Scoped deliberately. Vitest's default include is `**/*.{test,spec}.?(c|m)[jt]s?(x)`, which
    // from the repo root sweeps up every package's suite and would run the whole workspace twice —
    // once here and once through `pnpm -r`.
    include: ["scripts/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // `include` REPLACES the default rather than merging with it, so a directory that is not
      // named here is not measured at all — and a coverage gate cannot fail on a file it never
      // opened. Read the per-file table, not the exit code.
      //
      // There is deliberately no `exclude`. The obvious one — the two `*.test.mjs` suites — would
      // be dead config: measured on 2026-08-01 in three spellings, no `exclude` key at all,
      // `exclude: []`, and `exclude: ["**/*.test.mjs"]`, `pnpm vitest run --coverage` printed the
      // identical table every time — exactly `changed-packages.mjs` and `changed-scope.mjs` at
      // 100/100/100/100, and no `*.test.mjs` row. Three spellings all pointing one way, NOT a
      // measurement in both directions; a control would need an `exclude` that does change the
      // table. (The first version of this comment asserted the opposite — that deleting the line
      // would add two rows — and was written before it was run. CLAUDE.md §1.)
      //
      // Until 2026-08-01 this config DID need an `exclude`: it spread `coverageConfigDefaults`
      // back in with `**/[.]**` filtered out, because the sources lived under `.github/scripts/`
      // and that one default pattern excludes every dot-prefixed path segment — silently, at zero
      // coverage and exit 0. Moving both classifiers to `scripts/` is what retired it; the lesson
      // it left is in CLAUDE.md §4.
      include: ["scripts/**/*.mjs"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
