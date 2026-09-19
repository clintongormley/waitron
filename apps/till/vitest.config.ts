import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import type { BrowserCommand } from "vitest/node";
import { parkPointerCommands } from "@waitron/ui/src/vitest-park-pointer.js";

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
  // axe-core is imported only by the a11y suites (via src/widgets/test-helpers.ts), so Vite
  // discovers it mid-run and re-optimises — which reloads the in-flight test file and prints a
  // "Vite unexpectedly reloaded a test" warning that can flake CI. Pre-bundling it up front
  // removes the mid-run discovery. (packages/ui gets away without this because many of its test
  // files import axe from the first file on, so the optimisation settles before any assertion.)
  // Same mid-run re-optimise flake as axe-core (below): qrcode-generator and the unsafe-html
  // directive are first imported by the ticket view / its tests, and `lit/directives/keyed.js` is
  // first imported by till-app (per-user-locale), so Vite discovers them mid-run and reloads the
  // in-flight file ("Vite unexpectedly reloaded a test"). Pre-bundle them up front.
  optimizeDeps: {
    include: [
      "axe-core",
      "qrcode-generator",
      "lit/directives/unsafe-html.js",
      "lit/directives/keyed.js",
    ],
  },
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
        ...parkPointerCommands,
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
      // This app's own non-source surface: src/main.ts is the browser entry point that wires
      // the app together at startup (tokens, icons, the placeholder render) and is
      // exercised only in a real browser, not under the test runner; and
      // src/widgets/test-helpers.ts is test-only mount/cleanup/axe support, mirroring
      // packages/ui's exclusion of its src/test-helpers.ts and a11y-helpers.ts.
      exclude: [...coverageConfigDefaults.exclude, "src/main.ts", "src/widgets/test-helpers.ts"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
