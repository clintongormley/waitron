import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import type { BrowserCommand } from "vitest/node";
import { parkPointerCommands } from "@waitron/ui/src/vitest-park-pointer.js";

type ColorScheme = "light" | "dark" | null;

interface PlaywrightPage {
  emulateMedia(options: { colorScheme?: ColorScheme }): Promise<void>;
}

/**
 * Only the playwright provider's command context carries a `page`, so it is not typed on
 * `BrowserCommandContext`.
 */
const emulateColorScheme: BrowserCommand<[colorScheme: ColorScheme]> = async (
  context,
  colorScheme,
) => {
  const { page } = context as unknown as { page: PlaywrightPage };
  await page.emulateMedia({ colorScheme });
};

export default defineConfig({
  // Pre-bundled up front rather than discovered by the optimizer partway through a run.
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
    // A crashed Stryker run leaves mutated copies of the source, tests included, in .stryker-tmp.
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
      // `exclude` replaces the default list rather than merging, hence the spread. main.ts runs only at
      // browser startup; test-helpers.ts is test-only support.
      exclude: [...coverageConfigDefaults.exclude, "src/main.ts", "src/widgets/test-helpers.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
