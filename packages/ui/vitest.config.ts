import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import type { BrowserCommand } from "vitest/node";
import { parkPointerCommands } from "./src/vitest-park-pointer.js";

type ColorScheme = "light" | "dark" | null;
type ReducedMotion = "reduce" | "no-preference" | null;

interface PlaywrightPage {
  emulateMedia(options: {
    colorScheme?: ColorScheme;
    reducedMotion?: ReducedMotion;
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

export default defineConfig({
  optimizeDeps: {
    include: [
      "lit/directives/repeat.js",
      "lit/directives/class-map.js",
      "lit/async-directive.js",
      "lit/directive.js",
    ],
  },
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
        emulateReducedMotion,
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
        "demo/**",
        "**/ui-core/**",
        // The hand-run icon generator's whole job is shelling out to Inkscape, which is not a
        // workspace dependency.
        "brand/**",
        // Helpers that exist only for *.test.ts files (mounting, axe).
        "src/test-helpers.ts",
        "src/a11y-helpers.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
