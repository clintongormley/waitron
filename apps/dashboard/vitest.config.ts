import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import type { BrowserCommand } from "vitest/node";

type ColorScheme = "light" | "dark" | null;

interface PlaywrightPage {
  emulateMedia(options: { colorScheme?: ColorScheme }): Promise<void>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  mouse: { move(x: number, y: number): Promise<void> };
}

/**
 * Emulates the OS `prefers-color-scheme` media feature for the current test.
 * Only the playwright provider's command context carries a `page` (see
 * `provider.getCommandsContext` in @vitest/browser), which is why this isn't
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

/**
 * Moves the real mouse cursor off every element, so nothing is left matching CSS `:hover`.
 *
 * The cursor position belongs to the PAGE, and every test file in a worker shares one page — so a
 * `userEvent` click or hover parks the cursor at those coordinates for every later test, in this
 * file and in every file that runs after it. Whatever then renders under those coordinates is
 * `:hover`ed with no test having asked for it, and `wt-button`'s hover rule dims it to
 * `--wt-opacity-hover`, which axe scores as a colour-contrast violation.
 *
 * `userEvent.unhover()` cannot do this: @vitest/browser implements it as a hover of `html > body`,
 * which parks the cursor in the MIDDLE of the page, on top of whatever is mounted there. Negative
 * coordinates are outside the viewport, so no element can be under them. Same narrow cast at the
 * boundary as the two commands above.
 */
const parkPointer: BrowserCommand<[]> = async (context) => {
  const { page } = context as unknown as { page: PlaywrightPage };
  await page.mouse.move(-1, -1);
};

export default defineConfig({
  // axe-core is imported only by the a11y suites (via src/widgets/test-helpers.ts), so Vite
  // discovers it mid-run and re-optimises — which reloads the in-flight test file and prints a
  // "Vite unexpectedly reloaded a test" warning that can flake CI. Pre-bundling it up front
  // removes the mid-run discovery. (packages/ui gets away without this because many of its test
  // files import axe from the first file on, so the optimisation settles before any assertion.)
  // Unlike apps/till, the dashboard has no qrcode-generator/unsafe-html surface to pre-bundle yet.
  optimizeDeps: { include: ["axe-core"] },
  test: {
    globals: true,
    // A crashed Stryker run leaves .stryker-tmp holding mutated copies of the
    // source. Without this exclude Vitest discovers them as real test files, so
    // one interrupted mutation run makes every later test run fail confusingly.
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      instances: [{ browser: "chromium" }],
      commands: {
        emulateColorScheme,
        setViewportSize,
        parkPointer,
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // `coverage.exclude` replaces (does not merge with) Vitest's own default exclude
      // list — verified empirically in packages/ui, whose config this mirrors: omitting
      // the spread lets vite.config.ts, vitest.config.ts, and vite-env.d.ts reappear in
      // the report. Spread the defaults (test files, *.d.ts, config files) and add this
      // app's own non-source surface: src/main.ts is the browser entry point that wires
      // the app together at startup (tokens, the placeholder render) and is
      // exercised only in a real browser, not under the test runner; and
      // src/widgets/test-helpers.ts is test-only mount/cleanup/axe support, mirroring
      // packages/ui's exclusion of its src/test-helpers.ts and a11y-helpers.ts.
      exclude: [...coverageConfigDefaults.exclude, "src/main.ts", "src/widgets/test-helpers.ts"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
