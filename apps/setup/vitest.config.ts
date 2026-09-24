import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import type { BrowserCommand } from "vitest/node";

type ColorScheme = "light" | "dark" | null;

interface PlaywrightPage {
  emulateMedia(options: { colorScheme?: ColorScheme }): Promise<void>;
}

/**
 * Only the playwright provider's command context carries a `page` (`getCommandsContext` in
 * @vitest/browser-playwright), so it is not typed on `BrowserCommandContext` and is cast here.
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
  // that can flake CI. Pre-bundling it up front removes the mid-run discovery.
  optimizeDeps: { include: ["axe-core"] },
  test: {
    globals: true,
    clearMocks: false,
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
      // `exclude` replaces rather than merges, so the spread keeps a future non-empty default.
      // No test imports the page entry point src/main.ts; test-helpers.ts is test-only support.
      exclude: [...coverageConfigDefaults.exclude, "src/main.ts", "src/widgets/test-helpers.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
