import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import type { BrowserCommand } from "vitest/node";

type ColorScheme = "light" | "dark" | null;

interface PlaywrightPage {
  emulateMedia(options: { colorScheme?: ColorScheme }): Promise<void>;
}

/**
 * Emulates the OS `prefers-color-scheme` media feature for the current test.
 * Only the playwright provider's command context carries a `page` (see
 * `provider.getCommandsContext` in @vitest/browser), which is why this isn't
 * typed on `BrowserCommandContext` itself — cast narrowly at the boundary.
 */
const emulateColorScheme: BrowserCommand<[colorScheme: ColorScheme]> = async (
  context,
  colorScheme,
) => {
  const { page } = context as unknown as { page: PlaywrightPage };
  await page.emulateMedia({ colorScheme });
};

export default defineConfig({
  // axe-core is imported only by the a11y suites, so Vite discovers it mid-run and re-optimises —
  // which reloads the in-flight test file and prints a "Vite unexpectedly reloaded a test" warning
  // that can flake CI. Pre-bundling it up front removes the mid-run discovery. Mirrors apps/dashboard.
  optimizeDeps: { include: ["axe-core"] },
  test: {
    globals: true,
    // A crashed Stryker run leaves .stryker-tmp holding mutated copies of the
    // source. Without this exclude Vitest discovers them as real test files, so
    // one interrupted mutation run makes every later test run fail confusingly.
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      instances: [{ browser: "chromium" }],
      commands: {
        emulateColorScheme,
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // `coverage.exclude` REPLACES (does not merge with) Vitest's own default exclude list —
      // omitting the spread lets vite.config.ts, vitest.config.ts, and vite-env.d.ts reappear in the
      // report. Spread the defaults (test files, *.d.ts, config files) and add this app's own
      // non-source surface: src/main.ts is the browser entry point that wires the app together at
      // startup (tokens, the mount) and is exercised only in a real browser, not under the runner;
      // src/widgets/test-helpers.ts is test-only mount/axe support (mirrors apps/dashboard).
      exclude: [...coverageConfigDefaults.exclude, "src/main.ts", "src/widgets/test-helpers.ts"],
      // The workspace floor (CLAUDE.md §2; pinned by scripts/coverage-thresholds.test.ts). Global, not
      // `perFile`: a browser package is a handful of files, where one hard-to-reach branch swings a
      // per-file percentage far more than the aggregate.
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
