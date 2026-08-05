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
  // axe-core is imported only by the a11y suites (via src/widgets/test-helpers.ts), so Vite
  // discovers it mid-run and re-optimises — which reloads the in-flight test file and prints a
  // "Vite unexpectedly reloaded a test" warning that can flake CI. Pre-bundling it up front
  // removes the mid-run discovery. (packages/ui gets away without this because many of its test
  // files import axe from the first file on, so the optimisation settles before any assertion.)
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
      // `coverage.exclude` replaces (does not merge with) Vitest's own default exclude
      // list — verified empirically in packages/ui, whose config this mirrors: omitting
      // the spread lets vite.config.ts, vitest.config.ts, and vite-env.d.ts reappear in
      // the report. Spread the defaults (test files, *.d.ts, config files) and add this
      // app's own non-source surface: src/main.ts is the browser entry point that wires
      // the app together at startup (tokens, icons, the placeholder render) and is
      // exercised only in a real browser, not under the test runner; and
      // src/widgets/test-helpers.ts is test-only mount/cleanup/axe support, mirroring
      // packages/ui's exclusion of its src/test-helpers.ts and a11y-helpers.ts.
      exclude: [...coverageConfigDefaults.exclude, "src/main.ts", "src/widgets/test-helpers.ts"],
      // Thresholds match packages/ui — the workspace's other browser (Chromium/Playwright)
      // package — rather than the 98/98/98/95 the pure-Node packages carry. A browser app
      // is a small number of files where per-percent swings are coarse, so functions and
      // branches get more slack than statements and lines. Global, not `perFile`.
      thresholds: {
        statements: 95,
        lines: 95,
        functions: 90,
        branches: 88,
      },
    },
  },
});
