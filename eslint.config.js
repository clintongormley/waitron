import js from "@eslint/js";
import tseslint from "typescript-eslint";
import litPlugin from "eslint-plugin-lit";
import wcPlugin from "eslint-plugin-wc";
import { importX } from "eslint-plugin-import-x";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/__screenshots__/**", "**/coverage/**"],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Catches real web-component bugs plain TS lint does not: invalid lit templates,
  // incorrect property/attribute usage, missing custom-element definitions.
  litPlugin.configs["flat/recommended"],
  wcPlugin.configs["flat/recommended"],

  {
    // packages/verifactu (docs/superpowers/specs/2026-07-18-pos-architecture-design.md §8) does
    // not exist yet, but the constraint it will carry is written down there verbatim:
    //
    //   "Zero dependencies on any other package in this repo. Enforced by lint rule, not
    //   discipline. If it imports packages/core, it is no longer a library."
    //
    // This zone fires the moment any file under packages/verifactu imports anything that
    // resolves outside packages/verifactu — a workspace package via its `@waitron/*` specifier
    // or a relative path that escapes the package directory. Imports that resolve to a sibling
    // *node_modules* dependency (e.g. `lit`) are unaffected: only paths that resolve inside this
    // repo's own `packages/*` or `apps/*` trees are restricted.
    files: ["packages/verifactu/**/*.ts"],
    plugins: { "import-x": importX },
    settings: {
      "import-x/resolver": { typescript: true },
    },
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          // Resolved from this config file's own location, not `process.cwd()` — the rule must
          // fire the same way whether ESLint is invoked from the repo root or from inside a
          // package (e.g. a future `pnpm --filter @waitron/verifactu lint`).
          basePath: import.meta.dirname,
          zones: [
            {
              target: "./packages/verifactu/**/*",
              from: ["./packages/**", "./apps/**"],
              // Rooted at this config's own directory rather than a leading `**/` — `minimatch`
              // globstars refuse to cross a dot-prefixed path segment (e.g. a checkout under
              // `.claude/worktrees/...`), which silently broke a `**/packages/verifactu/**`
              // exception under exactly that kind of path and let same-package relative imports
              // false-positive as boundary violations. An absolute, literal-prefixed glob has no
              // such crossing to do.
              except: [`${import.meta.dirname}/packages/verifactu/**`],
              message:
                "packages/verifactu is a standalone, publishable library and must have zero " +
                "dependencies on any other package in this repo (see " +
                "docs/superpowers/specs/2026-07-18-pos-architecture-design.md §8). If it needs " +
                "something from another package, that thing belongs in packages/verifactu " +
                "itself or verifactu should not depend on it.",
            },
          ],
        },
      ],
    },
  },

  eslintConfigPrettier,
);
