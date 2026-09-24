import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import type { BrowserCommand } from "vitest/node";
import { parkPointerCommands } from "@waitron/ui/src/vitest-park-pointer.js";

type ColorScheme = "light" | "dark" | null;

interface PlaywrightPage {
  emulateMedia(options: { colorScheme?: ColorScheme }): Promise<void>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
}

/**
 * Only the playwright provider's command context carries a `page` (see
 * `provider.getCommandsContext` in @vitest/browser-playwright), hence the cast.
 */
const emulateColorScheme: BrowserCommand<[colorScheme: ColorScheme]> = async (
  context,
  colorScheme,
) => {
  const { page } = context as unknown as { page: PlaywrightPage };
  await page.emulateMedia({ colorScheme });
};

/**
 * Resizes the outer Playwright page, NOT the frame a test renders in: the test's `window.innerWidth`
 * does not change. `page.viewport` from `vitest/browser` resizes the frame. See
 * docs/developers/testing-guide.md.
 */
const setViewportSize: BrowserCommand<[width: number, height: number]> = async (
  context,
  width,
  height,
) => {
  const { page } = context as unknown as { page: PlaywrightPage };
  await page.setViewportSize({ width, height });
};

// The browser context is pinned to UTC so screen tests' wall-clock assertions read the same on every
// machine. That pin cannot test local-time rendering, so date-utils runs in a Node project below.
const browserProject = {
  extends: true,
  test: {
    name: "browser",
    globals: true,
    clearMocks: false,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/date-utils.test.ts"],
    browser: {
      enabled: true,
      // On the provider: Vitest 4 silently ignores a `context` key on the instance.
      provider: playwright({ contextOptions: { timezoneId: "UTC" } }),
      headless: true,
      instances: [{ browser: "chromium" }],
      commands: {
        emulateColorScheme,
        setViewportSize,
        ...parkPointerCommands,
      },
    },
  },
} as const;

// `env.TZ` pins the zone only in Node; Chromium's clock follows Playwright's context timezone. A
// non-UTC zone keeps the local-vs-UTC difference visible on a UTC CI runner.
const nodeTimezoneProject = {
  extends: true,
  test: {
    name: "node-tz",
    globals: true,
    clearMocks: false,
    environment: "node",
    include: ["src/date-utils.test.ts"],
    env: { TZ: "America/New_York" },
  },
} as const;

export default defineConfig({
  // Pre-bundled so Vite cannot discover it mid-run and reload an in-flight browser test.
  optimizeDeps: { include: ["axe-core"] },
  test: {
    projects: [browserProject, nodeTimezoneProject],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // `exclude` replaces rather than merges; the spread keeps any future Vitest default.
      // src/main.ts is the browser entry point, which no test loads; test-helpers.ts is test support.
      exclude: [...coverageConfigDefaults.exclude, "src/main.ts", "src/widgets/test-helpers.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
