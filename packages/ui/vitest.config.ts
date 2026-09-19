import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import type { BrowserCommand } from "vitest/node";
import { parkPointerCommands } from "./src/vitest-park-pointer.js";

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
  // Prebundle the table directives so discovering one cannot reload an in-flight browser test.
  optimizeDeps: { include: ["lit/directives/repeat.js", "lit/directives/class-map.js"] },
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
      // This package's own non-source surfaces: the demo/workbench app, the brand assets and their
      // hand-run generator, and the test-only helpers that exist purely to support
      // *.test.ts files (mount/cleanup, axe assertions).
      exclude: [
        ...coverageConfigDefaults.exclude,
        "demo/**",
        // Without this the hand-run generator counts as 0%-covered source and drags the package
        // under its 90% floor — measured at 88.87% against an earlier, shorter draft of it — which
        // would buy a test of a tool whose whole job is shelling out to a binary that is not a
        // workspace dependency. What the exclude gives up is coverage pressure to test that tool;
        // the property worth holding instead, that the apps' icon links and publicDir still agree
        // with this directory, is pinned from the root project by scripts/brand-icons.test.ts.
        "brand/**",
        "src/test-helpers.ts",
        "src/a11y-helpers.ts",
        "src/tokens/token-test-helpers.ts",
      ],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
