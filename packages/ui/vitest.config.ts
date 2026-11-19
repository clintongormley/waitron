import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import type { BrowserCommand } from "vitest/node";
import { parkPointerCommands } from "./src/vitest-park-pointer.js";

type ColorScheme = "light" | "dark" | null;
type ReducedMotion = "reduce" | "no-preference" | null;
type ForcedColors = "active" | "none" | null;

interface PlaywrightPage {
  emulateMedia(options: {
    colorScheme?: ColorScheme;
    reducedMotion?: ReducedMotion;
    forcedColors?: ForcedColors;
  }): Promise<void>;
}

/** Only the playwright provider's command context carries a `page`, hence the cast. */
const emulateColorScheme: BrowserCommand<[colorScheme: ColorScheme]> = async (
  context,
  colorScheme,
) => {
  const { page } = context as unknown as { page: PlaywrightPage };
  await page.emulateMedia({ colorScheme });
};

const emulateReducedMotion: BrowserCommand<[reducedMotion: ReducedMotion]> = async (
  context,
  reducedMotion,
) => {
  const { page } = context as unknown as { page: PlaywrightPage };
  await page.emulateMedia({ reducedMotion });
};

const emulateForcedColors: BrowserCommand<[forcedColors: ForcedColors]> = async (
  context,
  forcedColors,
) => {
  const { page } = context as unknown as { page: PlaywrightPage };
  await page.emulateMedia({ forcedColors });
};

interface NewPageClick {
  button?: "middle";
  modifiers?: ("Shift" | "ControlOrMeta")[];
}

interface OpenedPage {
  url(): string;
  close(): Promise<void>;
}

interface PlaywrightBrowserContext {
  waitForEvent(event: "page", options: { timeout: number }): Promise<OpenedPage>;
  pages(): OpenedPage[];
}

interface PlaywrightFrame {
  click(selector: string, options: NewPageClick & { force: true }): Promise<void>;
}

/** Clicks the element and answers the URL of the first page opened in this test run's browser
 * context within `waitMs`, or "none". A new page is outside the test's page, so only the provider
 * can see it. Forced, because Playwright will not click an aria-disabled element. Every page but
 * the runner's own is closed before it returns. */
const clickForNewPage: BrowserCommand<
  [selector: string, click: NewPageClick, waitMs: number]
> = async (context, selector, click, waitMs) => {
  const {
    page: runner,
    context: browserContext,
    frame,
  } = context as unknown as {
    page: unknown;
    context: PlaywrightBrowserContext;
    frame(): Promise<PlaywrightFrame>;
  };
  try {
    const opened = browserContext
      .waitForEvent("page", { timeout: waitMs })
      .catch((error: unknown) =>
        error instanceof Error && error.name === "TimeoutError" ? null : Promise.reject(error),
      );
    await (await frame()).click(selector, { ...click, force: true });
    const page = await opened;
    return page === null ? "none" : page.url();
  } finally {
    await Promise.all(
      browserContext
        .pages()
        .filter((page) => page !== runner)
        .map((page) => page.close()),
    );
  }
};

// A crashed Stryker run leaves mutated copies of the source in .stryker-tmp, which Vitest would
// otherwise run as real test files.
const exclude = [...configDefaults.exclude, "**/.stryker-tmp/**"];
const refusePopoverChunk: BrowserCommand<[refuse: boolean]> = async (context, refuse) => {
  const { page } = context as unknown as {
    page: {
      route: (
        pattern: string,
        handle: (route: { abort(): Promise<void> }) => Promise<void>,
      ) => Promise<void>;
      unroute: (pattern: string) => Promise<void>;
    };
  };
  const pattern = "**/*popover-polyfill*";
  if (refuse) await page.route(pattern, (route) => route.abort());
  else await page.unroute(pattern);
};
const fallbackTests = "src/popover-fallback.test.ts";
const touchTests = "src/icon-button.touch.test.ts";
const scaledTests = "src/components/wt-data-table.scaled.test.ts";

export default defineConfig({
  server: { forwardConsole: false },
  optimizeDeps: {
    include: [
      "lit/directives/repeat.js",
      "lit/directives/class-map.js",
      "lit/async-directive.js",
      "lit/directive.js",
      "@oddbird/popover-polyfill",
    ],
  },
  test: {
    globals: true,
    clearMocks: false,
    exclude,
    // An instance's own `setupFiles` is added after this list, not in place of it.
    setupFiles: ["test/stryker-dry-run-settle.ts"],
    browser: {
      enabled: true,
      provider: playwright({}),
      headless: true,
      instances: [
        // An instance's own `exclude` replaces the root one rather than adding to it.
        { browser: "chromium", exclude: [...exclude, touchTests, fallbackTests, scaledTests] },
        {
          browser: "chromium",
          name: "chromium-fallback",
          include: [fallbackTests],
          setupFiles: ["test/popover-fallback-setup.ts"],
        },
        // A touch context makes `(hover: hover)` false for the whole page, so touch tests get their
        // own instance; it is split by file because Stryker replaces every instance's test-name filter.
        {
          browser: "chromium",
          name: "chromium-touch",
          include: [touchTests],
          provider: playwright({ contextOptions: { hasTouch: true } }),
        },
        // A screen scaling applies to the whole browser context, so the scaled test gets its own instance.
        {
          browser: "chromium",
          name: "chromium-scaled",
          include: [scaledTests],
          provider: playwright({ contextOptions: { deviceScaleFactor: 1.5 } }),
        },
      ],
      commands: {
        refusePopoverChunk,
        emulateColorScheme,
        emulateReducedMotion,
        emulateForcedColors,
        clickForNewPage,
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
        // `packages/ui-core` starts with `packages/ui`, so Vitest counts ui-core's files as this
        // package's: testing-guide.md, "A package's `coverage.include` does not mean
        // "this package's src"".
        "**/ui-core/**",
        // Helpers that exist only for *.test.ts files (mounting, axe, icon buttons).
        "src/test-helpers.ts",
        "src/a11y-helpers.ts",
        "src/icon-button-test-helpers.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
