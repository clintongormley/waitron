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

  {
    // packages/shared is the leaf of the dependency graph: every other package depends on it,
    // so anything it depends on becomes a transitive dependency of the entire repo. A missing
    // `dependencies` block in its package.json does NOT enforce this — `main` points at TS
    // source with no build step, so a relative escape like `../../db/src/index.js` resolves,
    // typechecks and runs while the manifest still reads as dependency-free. The manifest
    // constrains bare specifiers; only this rule constrains paths.
    files: ["packages/shared/**/*.ts"],
    plugins: { "import-x": importX },
    settings: {
      "import-x/resolver": { typescript: true },
    },
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          basePath: import.meta.dirname,
          zones: [
            {
              target: "./packages/shared/**/*",
              from: ["./packages/**", "./apps/**"],
              // Absolute and literal-prefixed, never a leading `**/`: minimatch globstars
              // refuse to cross a dot-prefixed path segment (e.g. a checkout under
              // `.claude/worktrees/...`), which silently broke the equivalent exception on the
              // verifactu zone and let same-package relative imports false-positive as
              // boundary violations.
              except: [`${import.meta.dirname}/packages/shared/**`],
              message:
                "packages/shared is the leaf every other package depends on and must have zero " +
                "dependencies on any other package in this repo. Anything it imports becomes a " +
                "transitive dependency of the whole repo. If it needs something from another " +
                "package, that thing belongs in packages/shared itself.",
            },
          ],
        },
      ],
    },
  },

  {
    // The generic layer is regime-neutral (spec §2). A second fiscal backend —
    // TicketBAI, Italy, Portugal — brings its own tables and its own
    // vocabulary and touches none of these packages. The moment packages/db
    // imports the Veri*Factu module, "generic" becomes a comment rather than a
    // property, and the English-only guard would be policing the vocabulary of
    // a dependency it cannot see.
    files: ["packages/db/**/*.ts", "packages/core/**/*.ts", "packages/fiscal/**/*.ts"],
    plugins: { "import-x": importX },
    settings: {
      "import-x/resolver": { typescript: true },
    },
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          // As above: resolved from this config's own directory, never a
          // leading `**/` — minimatch globstars refuse to cross a
          // dot-prefixed segment such as `.claude/worktrees/`.
          basePath: import.meta.dirname,
          zones: [
            {
              target: ["./packages/db/**/*", "./packages/core/**/*", "./packages/fiscal/**/*"],
              from: ["./packages/verifactu/**", "./packages/fiscal-verifactu/**"],
              message:
                "The generic layer must not depend on a fiscal module (spec §2). Only the " +
                "FiscalBackend interface crosses that boundary — if this needs something " +
                "from the Veri*Factu module, it belongs behind the interface.",
            },
          ],
        },
      ],
    },
  },

  {
    // packages/scheduler is a duty-NEUTRAL runner: duties are injected and typed structurally, so
    // it must never import a duty's own package (docs/superpowers/specs/
    // 2026-07-25-recurring-work-scheduler-design.md §3). Its package.json does NOT enforce that.
    // `@waitron/payments` is a devDependency there only for the type-fit test and the AppError
    // code augmentation — but there is no build step, `main` points at TS source, and pnpm links a
    // workspace devDependency identically to a runtime one, so `import { reconcilePayments } from
    // "@waitron/payments"` inside src/run.ts would typecheck, lint clean and pass every test. The
    // manifest constrains nothing here; only this rule does.
    //
    // Test files are exempt: the fit test and the AppError-code augmentation both name
    // @waitron/payments deliberately, and neither ships in the runtime path.
    files: ["packages/scheduler/src/**/*.ts"],
    ignores: ["packages/scheduler/src/**/*.test.ts"],
    plugins: { "import-x": importX },
    settings: {
      "import-x/resolver": { typescript: true },
    },
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          // As above: resolved from this config's own directory, never a leading `**/` —
          // minimatch globstars refuse to cross a dot-prefixed segment such as
          // `.claude/worktrees/`.
          basePath: import.meta.dirname,
          zones: [
            {
              target: "./packages/scheduler/src/**/*",
              from: [
                "./packages/payments/**",
                "./packages/fiscal/**",
                "./packages/fiscal-verifactu/**",
                "./packages/verifactu/**",
              ],
              message:
                "packages/scheduler is a duty-neutral runner and must not import a duty's own " +
                "package (see docs/superpowers/specs/" +
                "2026-07-25-recurring-work-scheduler-design.md §3). Duties are injected and " +
                "typed structurally — if the runner needs something from payments or fiscal, it " +
                "belongs on the PeriodDuty seam, not in an import.",
            },
          ],
        },
      ],
    },
  },

  {
    // packages/credentials is a leaf: `PURPOSES` in packages/credentials/src/purposes.ts holds a
    // purpose's field names as plain string data, never a provider's own types or vocabulary (see
    // docs/superpowers/specs/2026-07-26-tenant-credential-vault-design.md §3). Its package.json
    // does NOT enforce that — `main` points at TS source with no build step, so
    // `import { reconcilePayments } from "@waitron/payments"` inside src/store.ts would typecheck,
    // lint clean and pass every test with no manifest dependency declared at all. The manifest
    // constrains nothing here; only this rule does. Brought forward from Task 7 (originally
    // scheduled there) because Tasks 5 and 6 add a CLI and rotation on top of this package before
    // Task 7 lands, and purposes.ts's own comment claims this enforcement exists starting now.
    files: ["packages/credentials/src/**/*.ts"],
    plugins: { "import-x": importX },
    settings: {
      "import-x/resolver": { typescript: true },
    },
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          // As above: resolved from this config's own directory, never a leading `**/` —
          // minimatch globstars refuse to cross a dot-prefixed segment such as
          // `.claude/worktrees/`.
          basePath: import.meta.dirname,
          zones: [
            {
              target: "./packages/credentials/src/**/*",
              from: [
                "./packages/payments/**",
                "./packages/payments-stripe/**",
                "./packages/fiscal/**",
                "./packages/fiscal-verifactu/**",
                "./packages/verifactu/**",
                "./packages/core/**",
              ],
              message:
                "packages/credentials must stay a leaf with zero knowledge of any provider or " +
                "regime package (see docs/superpowers/specs/" +
                "2026-07-26-tenant-credential-vault-design.md §3). A purpose's field list is " +
                "string DATA, never an import — if this needs something from payments or fiscal, " +
                "it belongs behind the purpose registry, not in an import.",
            },
          ],
        },
      ],
    },
  },

  {
    // `js.configs.recommended` defines no environment, so a plain Node script has no `process`
    // global — unlike a `.ts` file, where `tseslint.configs.recommended` turns `no-undef` off
    // entirely (TS's own checker already catches that class of error, per ts(2304)/ts(2552)).
    // `apps/server/scripts/copy-migrations.mjs` was the first `.mjs` in this repo;
    // `packages/provisioning/scripts/copy-migrations.mjs` is its near-copy, shipping the same
    // migration folders beside `waitron-provision`'s own bundle. Both need the same one global.
    // `.github/scripts/changed-scope.mjs` is the third, and the first that is not a build step:
    // it classifies a diff so CI can skip work a change cannot affect. It is also the first to need
    // a SECOND global. The other two only ever announce progress on stdout and reach for
    // `process.stdout.write` to do it (grepped: four calls across the two files, no `console`
    // anywhere); this one has to keep two streams apart, because its stdout is appended straight to
    // `$GITHUB_OUTPUT`, so it must carry `<name>=<value>` lines and nothing else — one for
    // `classify`, three for `gates` — while the reason for each verdict goes to stderr for a human
    // reading the job log. The line COUNT is part of the contract, not just the content: a stray
    // line becomes an extra job output.
    //
    // `scripts/changed-packages.mjs` is the fourth, and needs the same two globals for the same
    // reason: it is the pre-push hook's half of that split — package names on stdout for the shell
    // to turn into `--filter` arguments, the reason on stderr for whoever is watching the push.
    files: [
      "apps/server/scripts/**/*.mjs",
      "packages/provisioning/scripts/**/*.mjs",
      ".github/scripts/**/*.mjs",
      "scripts/**/*.mjs",
    ],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },

  eslintConfigPrettier,
);
