import { coverageConfigDefaults, defineConfig } from "vitest/config";

// The first repo-level test project. Everything else lives in a package with its own config; this
// one exists for code that belongs to no package — CI scripts today, the git hooks later
// (docs/backlog.md carried "nothing repo-level can be tested" as standing debt until this).
export default defineConfig({
  test: {
    globals: true,
    // Scoped deliberately. Vitest's default include is `**/*.{test,spec}.?(c|m)[jt]s?(x)`, which
    // from the repo root sweeps up every package's suite and would run the whole workspace twice —
    // once here and once through `pnpm -r`.
    include: [".github/scripts/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // `include` and `exclude` both replace rather than merge, so the defaults are spread back in.
      //
      // All of them except `**/[.]**`, which matches any dot-prefixed path segment and so excludes
      // the whole of `.github/` — every file this project exists to measure. Spreading the defaults
      // verbatim was run first and measured nothing at all: `vitest run --coverage` printed
      // `All files | 0 | 0 | 0 | 0`, wrote a coverage-summary.json whose every `pct` was
      // `"Unknown"`, and exited 0 — the thresholds below passed without a line of source being
      // read. Filtering that one entry out, the same command reports changed-scope.mjs at
      // 100/100/100/100; appending an uncovered four-line function to it then reports 95.71% lines
      // and 75% functions and exits 1, so the gate is measured in both directions rather than
      // assumed.
      include: [".github/scripts/**/*.mjs"],
      exclude: [
        ...coverageConfigDefaults.exclude.filter((pattern) => pattern !== "**/[.]**"),
        ".github/scripts/**/*.test.mjs",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
