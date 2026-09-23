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
  test: {
    globals: true,
    clearMocks: false,
    // A crashed Stryker run leaves .stryker-tmp holding mutated copies of the
    // source. Without this exclude Vitest discovers them as real test files, so
    // one interrupted mutation run makes every later test run fail confusingly.
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "test/**"],
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
      // Measure the shipped controls and helpers; mounting, axe and Node-side pointer support
      // are test infrastructure and are excluded from the artifact too.
      exclude: [
        ...coverageConfigDefaults.exclude,
        "src/test-helpers.ts",
        "src/vitest-park-pointer.ts",
        "src/a11y-helpers.ts",
        "src/tokens/token-test-helpers.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
