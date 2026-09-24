import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import type { BrowserCommand } from "vitest/node";
import { parkPointerCommands } from "./src/vitest-park-pointer.js";

type ColorScheme = "light" | "dark" | null;

interface PlaywrightPage {
  emulateMedia(options: { colorScheme?: ColorScheme }): Promise<void>;
}

/** Only the playwright provider's command context carries a `page`, hence the cast. */
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
    // A crashed Stryker run leaves mutated copies of the source in .stryker-tmp, which Vitest would
    // otherwise run as real test files.
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
      // `exclude` replaces the default list rather than merging, so the spread keeps any future default.
      exclude: [
        ...coverageConfigDefaults.exclude,
        "demo/**",
        "**/ui-core/**",
        // The hand-run icon generator's whole job is shelling out to Inkscape, which is not a
        // workspace dependency.
        "brand/**",
        // Helpers that exist only for *.test.ts files (mounting, axe).
        "src/test-helpers.ts",
        "src/a11y-helpers.ts",
        "src/tokens/token-test-helpers.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
