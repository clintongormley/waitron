import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import type { BrowserCommand } from "vitest/node";
import { parkPointerCommands } from "@waitron/ui/src/vitest-park-pointer.js";
import { pointerGestureCommands } from "@waitron/ui/src/vitest-pointer-gestures.js";
import { probeTillReload } from "./test/native-reload.js";
import { holdDraftLine } from "./test/hold-draft-line.js";
import {
  startupEnginesFromEnv,
  venueThemeStartupProbe,
} from "@waitron/ui/test/venue-theme-startup.js";

type ColorScheme = "light" | "dark" | null;

interface PlaywrightPage {
  emulateMedia(options: {
    colorScheme?: ColorScheme;
    reducedMotion?: "reduce" | "no-preference";
  }): Promise<void>;
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
  optimizeDeps: {
    // Pre-bundled up front rather than discovered by the optimizer partway through a run.
    include: [
      "axe-core",
      "qrcode-generator",
      "jsqr",
      "lit/directives/unsafe-html.js",
      "lit/directives/keyed.js",
      "lit/directives/live.js",
      "lit/async-directive.js",
    ],
    entries: ["src/main.ts"],
  },
  test: {
    globals: true,
    clearMocks: false,
    // A crashed Stryker run leaves mutated copies of the source, tests included, in .stryker-tmp.
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    provide: {
      startupEngines: startupEnginesFromEnv(),
    },
    browser: {
      enabled: true,
      provider: playwright({}),
      headless: true,
      instances: [{ browser: "chromium" }],
      commands: {
        probeTillReload,
        holdDraftLine,
        emulateColorScheme,
        emulateReducedMotion: async (context, reduced: boolean) => {
          const { page } = context as unknown as { page: PlaywrightPage };
          await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
        },
        ...parkPointerCommands,
        ...pointerGestureCommands,
        probeVenueThemeStartup: venueThemeStartupProbe(new URL("./index.html", import.meta.url)),
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
