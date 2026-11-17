import js from "@eslint/js";
import tseslint from "typescript-eslint";
import litPlugin from "eslint-plugin-lit";
import wcPlugin from "eslint-plugin-wc";
import { importX } from "eslint-plugin-import-x";
import eslintConfigPrettier from "eslint-config-prettier";

// Exception globs must be absolute: a `./` form does not match, and a leading `**`
// does not cross a dot-prefixed folder.
export default tseslint.config(
  {
    // Interrupted mutation runs can leave mutated source in .stryker-tmp.
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/__screenshots__/**",
      "**/coverage/**",
      "**/.stryker-tmp/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  litPlugin.configs["flat/recommended"],
  wcPlugin.configs["flat/recommended"],

  {
    // A dependency-free manifest does not prevent relative imports of another package's source.
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
    files: ["packages/contract/src/**/*.ts"],
    plugins: { "import-x": importX },
    settings: { "import-x/resolver": { typescript: true } },
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          basePath: import.meta.dirname,
          zones: [
            {
              target: "./packages/contract/src/**/*",
              from: ["./packages/**", "./apps/**"],
              except: [`${import.meta.dirname}/packages/contract/**`],
              message: "The published contract has no dependencies on other Waitron packages.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/print-agent/**/*.ts"],
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
              target: "./packages/print-agent/**/*",
              from: ["./packages/**", "./apps/**"],
              except: [`${import.meta.dirname}/packages/print-agent/**`],
              message:
                "packages/print-agent runs as a standalone process on the venue's LAN with no " +
                "database and no repo dependencies — it talks to a Waitron server over HTTP only. " +
                "@waitron/printing depends on this package, never the reverse; anything it needs " +
                "belongs in packages/print-agent itself.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["packages/db/**/*.ts", "packages/core/**/*.ts", "packages/fiscal/**/*.ts"],
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
              target: ["./packages/db/**/*", "./packages/core/**/*", "./packages/fiscal/**/*"],
              from: ["./packages/fiscal-verifactu/**"],
              message:
                "The generic layer must not depend on a fiscal module. Only the " +
                "FiscalBackend interface crosses that boundary — if this needs something " +
                "from the Veri*Factu module, it belongs behind the interface.",
            },
          ],
        },
      ],
      // External regime packages need a name-based boundary as well as the path boundary.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@waitron/verifactu", "@waitron/verifactu/*"],
              message:
                "The generic layer must not depend on the Veri*Factu regime. Only the " +
                "FiscalBackend interface crosses that boundary — if this needs something from the " +
                "Veri*Factu module, it belongs behind the interface.",
            },
          ],
        },
      ],
    },
  },

  {
    // Duties are injected; only the runner's schema import may reach the rest of payments.
    files: ["packages/payments/src/reconciliation-schedule/**/*.ts"],
    ignores: ["packages/payments/src/reconciliation-schedule/**/*.test.ts"],
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
              target: "./packages/payments/src/reconciliation-schedule/**/*",
              from: ["./packages/payments/**"],
              except: [
                import.meta.dirname + "/packages/payments/src/reconciliation-schedule/**",
                import.meta.dirname + "/packages/payments/src/schema/reconciliation-runs.*",
              ],
              message:
                "packages/payments/src/reconciliation-schedule is a duty-neutral runner and must " +
                "not import the rest of payments. Duties are injected and typed structurally — if " +
                "the runner needs something from payments, it belongs on the PeriodDuty seam, not " +
                "in an import.",
            },
            {
              target: "./packages/payments/src/reconciliation-schedule/**/*",
              from: ["./packages/fiscal/**", "./packages/fiscal-verifactu/**"],
              message:
                "packages/payments/src/reconciliation-schedule is a duty-neutral runner and must " +
                "not import a duty's own package. Duties are injected and typed structurally — if " +
                "the runner needs something from fiscal, it belongs on the PeriodDuty seam, not " +
                "in an import.",
            },
          ],
        },
      ],
      // External regime packages need a name-based boundary as well as the path boundary.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@waitron/verifactu", "@waitron/verifactu/*"],
              message:
                "packages/payments/src/reconciliation-schedule is a duty-neutral runner and must " +
                "not import a duty's own package. Duties are injected and typed structurally — if " +
                "the runner needs something from the Veri*Factu duty, it " +
                "belongs on the PeriodDuty seam, not in an import.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["packages/credentials/src/**/*.ts"],
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
              target: "./packages/credentials/src/**/*",
              from: [
                "./packages/payments/**",
                "./packages/payments-stripe/**",
                "./packages/payments-sumup/**",
                "./packages/fiscal/**",
                "./packages/fiscal-verifactu/**",
                "./packages/core/**",
              ],
              message:
                "packages/credentials must stay a leaf with zero knowledge of any provider or " +
                "regime package. A purpose's field list is " +
                "string DATA, never an import — if this needs something from payments or fiscal, " +
                "it belongs behind the purpose registry, not in an import.",
            },
          ],
        },
      ],
      // External regime packages need a name-based boundary as well as the path boundary.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@waitron/verifactu", "@waitron/verifactu/*"],
              message:
                "packages/credentials must stay a leaf with zero knowledge of any provider or " +
                "regime package. A purpose's field list is " +
                "string DATA, never an import — if this needs something from the Veri*Factu " +
                "regime, it belongs behind the purpose registry, not in an import.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["apps/server/scripts/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },

  {
    files: ["packages/country-es/scripts/gen-demo-media.mjs"],
    languageOptions: {
      globals: { Buffer: "readonly", console: "readonly", process: "readonly" },
    },
  },

  eslintConfigPrettier,
);
