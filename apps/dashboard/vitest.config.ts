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

/**
 * Resizes the Playwright page viewport so a test can exercise the responsive breakpoints (Task 12's
 * off-canvas drawer at `max-width: 48rem`). Changing the viewport re-evaluates the page's media
 * queries and fires `matchMedia` `change` listeners, which is what flips the shell's `narrow` state.
 * Same narrow cast at the boundary as `emulateColorScheme` — only the playwright provider's context
 * carries a `page`. Tests must restore a desktop width afterwards so it never leaks between them.
 */
const setViewportSize: BrowserCommand<[width: number, height: number]> = async (
  context,
  width,
  height,
) => {
  const { page } = context as unknown as { page: PlaywrightPage };
  await page.setViewportSize({ width, height });
};

// Two projects, because two test kinds need two environments. Most of the suite renders real
// components and MUST run in a browser; a handful of pure helpers (date-utils) are plain functions
// whose behaviour depends on the process timezone, which only a Node worker can pin.
//
// The browser context is pinned to UTC. Every screen test that shows a timestamp asserts the exact
// wall-clock string, and `formatIsoMinute` renders in the browser's LOCAL zone — so without a pin
// those assertions would read one value on a UTC CI runner and another on a developer's machine in
// Madrid. Pinning the browser to UTC makes them read the same everywhere; it does NOT prove the
// local-time behaviour, which is exactly why the timezone-sensitive helper is tested in Node below.
//
// The mouse-parking command is shared: `parkPointerCommands` comes from @waitron/ui so every package
// whose a11y suites run the `parkPointer` hook registers it the same way (a root guard enforces it).
const browserProject = {
  extends: true,
  test: {
    name: "browser",
    globals: true,
    clearMocks: false,
    // A crashed Stryker run leaves .stryker-tmp holding mutated copies of the
    // source. Without this exclude Vitest discovers them as real test files, so
    // one interrupted mutation run makes every later test run fail confusingly.
    // `date-utils.test.ts` is owned by the Node project below.
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/date-utils.test.ts"],
    browser: {
      enabled: true,
      // The timezone pin belongs to the PROVIDER, as `contextOptions`. Vitest 3 read a `context`
      // key off the instance; Vitest 4's playwright provider reads `contextOptions` off the factory
      // and ignores an unknown instance key in silence, so the pin stopped applying and the
      // wall-clock assertions read the host's zone (measured: "14:00" in Madrid for a 12:00Z
      // instant, "12:00" again once the pin moved here).
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

// `date-utils.ts` is pure timezone-dependent logic with no DOM. It runs in Node so `env.TZ` actually
// pins the zone (in the browser project it would not — Playwright's context timezone, not the OS TZ
// the worker inherits, governs Chromium's clock). A non-UTC zone is deliberate: it makes the
// local-vs-UTC difference visible on a UTC CI runner, so the test cannot pass vacuously.
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
  // axe-core is imported only by the a11y suites (via src/widgets/test-helpers.ts), so Vite
  // discovers it mid-run and re-optimises — which reloads the in-flight test file and prints a
  // "Vite unexpectedly reloaded a test" warning that can flake CI. Pre-bundling it up front
  // removes the mid-run discovery. (packages/ui gets away without this because many of its test
  // files import axe from the first file on, so the optimisation settles before any assertion.)
  // Unlike apps/till, the dashboard has no qrcode-generator/unsafe-html surface to pre-bundle yet.
  optimizeDeps: { include: ["axe-core"] },
  test: {
    projects: [browserProject, nodeTimezoneProject],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // `coverage.exclude` replaces rather than merges, but Vitest 4's own default list is EMPTY
      // (`coverageConfigDefaults.exclude` is `[]`), so the spread adds nothing today — keep it so a
      // later non-empty default is not silently dropped. What scopes the report now is `include`
      // above; the test files the runner ran are left out by the runner itself, not by this list.
      // This app's own non-source surface: src/main.ts is the browser entry point that wires
      // the app together at startup (tokens, the placeholder render) and is
      // exercised only in a real browser, not under the test runner; and
      // src/widgets/test-helpers.ts is test-only mount/cleanup/axe support, mirroring
      // packages/ui's exclusion of its src/test-helpers.ts and a11y-helpers.ts.
      exclude: [...coverageConfigDefaults.exclude, "src/main.ts", "src/widgets/test-helpers.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
