import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import type { BrowserCommand } from "vitest/node";

type ColorScheme = "light" | "dark" | null;

interface PlaywrightPage {
  emulateMedia(options: { colorScheme?: ColorScheme }): Promise<void>;
}

/**
 * Emulates the OS `prefers-color-scheme` media feature for the current test.
 * Only the playwright provider's command context carries a `page` (see
 * `provider.getCommandsContext` in @vitest/browser-playwright), which is why this isn't
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
    clearMocks: false,
    // A crashed Stryker run leaves .stryker-tmp holding mutated copies of the
    // source. Without this exclude Vitest discovers them as real test files, so
    // one interrupted mutation run makes every later test run fail confusingly.
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    browser: {
      enabled: true,
      provider: playwright({}),
      headless: true,
      instances: [{ browser: "chromium" }],
      commands: {
        emulateColorScheme,
      },
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // `coverage.exclude` replaces rather than merges, but Vitest 4's own default list is EMPTY
      // (`coverageConfigDefaults.exclude` is `[]`), so the spread adds nothing today — keep it so a
      // later non-empty default is not silently dropped. What scopes the report now is `include`
      // above; the test files the runner ran are left out by the runner itself, not by this list.
      // This app's own non-source surface: src/main.ts is the browser entry point that wires the app together at
      // startup (tokens, the mount) and is exercised only in a real browser, not under the runner;
      // src/widgets/test-helpers.ts is test-only mount/axe support (mirrors apps/dashboard).
      exclude: [...coverageConfigDefaults.exclude, "src/main.ts", "src/widgets/test-helpers.ts"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
