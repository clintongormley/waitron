import { coverageConfigDefaults, defineConfig } from "vitest/config";

// The repo-level test project. Everything else lives in a package with its own config; this one
// exists for code that belongs to no package — the CI classifier under `.github/scripts/`, and the
// pre-push hook's own path-to-package classifier under `scripts/`.
export default defineConfig({
  test: {
    globals: true,
    // Scoped deliberately. Vitest's default include is `**/*.{test,spec}.?(c|m)[jt]s?(x)`, which
    // from the repo root sweeps up every package's suite and would run the whole workspace twice —
    // once here and once through `pnpm -r`.
    include: [".github/scripts/**/*.test.mjs", "scripts/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // `include` and `exclude` both replace rather than merge, so the defaults are spread back in.
      //
      // All of them except `**/[.]**`, which matches any dot-prefixed path segment and so excludes
      // the whole of `.github/` — half the files this project exists to measure. Spreading the
      // defaults verbatim was run first and measured nothing at all: `vitest run --coverage` printed
      // `All files | 0 | 0 | 0 | 0`, wrote a coverage-summary.json whose every `pct` was
      // `"Unknown"`, and exited 0 — the thresholds below passed without a line of source being
      // read. Filtering that one entry out, the same command reports changed-scope.mjs at
      // 100/100/100/100; appending an uncovered four-line function to it then reports 95.71% lines
      // and 75% functions and exits 1, so the gate is measured in both directions rather than
      // assumed.
      //
      // `scripts/` is not dot-prefixed and so was never caught by that entry — it is listed here
      // only because `include` REPLACES the default rather than merging with it, so a directory
      // that is not named is not measured. Checked in this workspace on 2026-07-31: with
      // `scripts/**/*.mjs` absent from `include`, `vitest run --coverage` reports only
      // `.github/scripts/changed-scope.mjs` and passes the thresholds below without reading a line
      // of `scripts/changed-packages.mjs`.
      include: [".github/scripts/**/*.mjs", "scripts/**/*.mjs"],
      exclude: [
        ...coverageConfigDefaults.exclude.filter((pattern) => pattern !== "**/[.]**"),
        ".github/scripts/**/*.test.mjs",
        "scripts/**/*.test.mjs",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
