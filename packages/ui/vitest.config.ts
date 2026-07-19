import { coverageConfigDefaults, defineConfig } from "vitest/config";
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
  test: {
    globals: true,
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
      // `coverage.exclude` replaces (does not merge with) Vitest's own default exclude
      // list — verified empirically: omitting the spread lets vite.config.ts,
      // vitest.config.ts, and vite-env.d.ts reappear in the report. Spread the
      // defaults (test files, *.d.ts, config files) and add this package's own
      // non-source surfaces: the demo/workbench app and the test-only helpers that
      // exist purely to support *.test.ts files (mount/cleanup, axe assertions).
      exclude: [
        ...coverageConfigDefaults.exclude,
        "demo/**",
        "src/test-helpers.ts",
        "src/a11y-helpers.ts",
        "src/tokens/token-test-helpers.ts",
      ],
      // Floors measured, then set just below current levels (see
      // docs/developers/ or the coverage-mutation report for the measured numbers).
      // Global thresholds, not `perFile` — this is a ~10-file package where per-file
      // 100% would block legitimate work on any one component. Statements/lines get
      // the tightest floor (204 units measured, so 1% is coarse-grained already);
      // functions and branches get more slack because they're counted over far fewer
      // units (22 and 45 respectively), so a single hard-to-reach function or branch
      // swings the percentage a lot more.
      thresholds: {
        statements: 95,
        lines: 95,
        functions: 90,
        branches: 88,
      },
    },
  },
});
