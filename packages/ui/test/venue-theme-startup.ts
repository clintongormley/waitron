import { readFileSync } from "node:fs";
import type { Browser, Page, Route } from "playwright";
import type { BrowserCommand } from "vitest/node";

export type StartupAnswer = "never" | "late" | "refused" | "failed" | "not-json";

export interface StartupScenario {
  readonly stored: string | null;
  readonly answer: StartupAnswer;
  readonly answerBody: string;
  readonly colorScheme: "light" | "dark";
  readonly engine: "chromium" | "webkit";
}

export interface StartupProbeResult {
  readonly engine: string;
  readonly firstThemedBg: string | null;
  /** `performance.now()` in the page when the first themed frame was sampled. */
  readonly firstThemedAtMs: number | null;
  readonly bgAfter: string;
  readonly storedAfter: string | null;
  readonly themeRequests: number;
  /** Theme requests carrying the `x-request-id` the app's instrumented fetch sets. */
  readonly themeRequestsTraced: number;
  readonly appRendered: boolean;
}

const STORAGE_KEY = "waitron-venue-theme";
const SETTLE_MS = 500;
const LATE_MS = 500;
const REPAINT_LIMIT_MS = 5_000;
const LOAD_LIMIT_MS = 15_000;
const ASK_LIMIT_MS = 5_000;

type Frame = readonly [themedRoot: boolean, bg: string, atMs: number];

function answerTheme(route: Route, scenario: StartupScenario): Promise<void> | undefined {
  switch (scenario.answer) {
    case "never":
      return undefined;
    case "late":
      return new Promise<void>((resolve) => setTimeout(resolve, LATE_MS)).then(() =>
        route.fulfill({ status: 200, contentType: "application/json", body: scenario.answerBody }),
      );
    case "refused":
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"server.internal"}}',
      });
    case "failed":
      return route.abort("failed");
    case "not-json":
      return route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" });
  }
}

/**
 * Opens the app's real `index.html` in a fresh browser context, so its `localStorage` is not the
 * runner's. The page's own `/src/main.ts` is served by the Vitest server.
 */
export function venueThemeStartupProbe(indexHtml: URL): BrowserCommand<[StartupScenario]> {
  return async (context, scenario): Promise<StartupProbeResult> => {
    const runner = (context as unknown as { page: Page }).page;
    if (scenario.engine !== "chromium" && scenario.engine !== "webkit") {
      throw new Error(`not a start-up engine: ${String(scenario.engine)}`);
    }
    const html = readFileSync(indexHtml, "utf8");
    const ownBrowser: Browser | null =
      scenario.engine === "webkit" ? await (await import("playwright")).webkit.launch() : null;
    const browser = ownBrowser ?? runner.context().browser()!;
    const subjectContext = await browser.newContext({ colorScheme: scenario.colorScheme });
    try {
      const subject = await subjectContext.newPage();
      const errors: string[] = [];
      subject.on("pageerror", (error) => errors.push(error.message));
      let themeRequests = 0;
      let themeRequestsTraced = 0;
      let markHandled!: () => void;
      const themeHandled = new Promise<void>((resolve) => (markHandled = resolve));
      await subject.route(
        (url) => url.pathname === "/__a841_startup__",
        (route) => route.fulfill({ contentType: "text/html", body: html }),
      );
      await subject.route(
        (url) => url.pathname.startsWith("/api/") || url.pathname.startsWith("/management-api/"),
        async (route) => {
          if (new URL(route.request().url()).pathname !== "/api/theme") {
            await route.fulfill({
              status: 401,
              contentType: "application/json",
              body: '{"error":{"code":"management_session.required"}}',
            });
            return;
          }
          themeRequests += 1;
          if (route.request().headers()["x-request-id"] !== undefined) themeRequestsTraced += 1;
          const answered = answerTheme(route, scenario);
          if (answered === undefined) markHandled();
          else await answered.then(markHandled);
        },
      );
      await subject.addInitScript(
        ({ key, stored }) => {
          if (stored === null) window.localStorage.removeItem(key);
          else window.localStorage.setItem(key, stored);
          const frames: Array<readonly [boolean, string, number]> = [];
          (window as unknown as { __startupFrames: typeof frames }).__startupFrames = frames;
          const sample = (): void => {
            const root = document.documentElement;
            frames.push([
              root.hasAttribute("data-wt-theme-root"),
              getComputedStyle(root).getPropertyValue("--wt-color-bg").trim(),
              performance.now(),
            ]);
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        },
        { key: STORAGE_KEY, stored: scenario.stored },
      );
      const readFrames = () =>
        subject.evaluate(() => (window as unknown as { __startupFrames: Frame[] }).__startupFrames);
      try {
        await subject.goto(new URL("/__a841_startup__", runner.url()).href, {
          timeout: LOAD_LIMIT_MS,
        });
        await subject.waitForFunction(
          () => document.querySelector("#app")?.firstElementChild != null,
          null,
          { timeout: LOAD_LIMIT_MS },
        );
      } catch (error) {
        throw new Error(`${String(error)}\npage errors:\n${errors.join("\n")}`, { cause: error });
      }
      // An app that never asks still settles, so its result reports themeRequests 0.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        themeHandled,
        new Promise<void>((resolve) => (timer = setTimeout(resolve, ASK_LIMIT_MS))),
      ]);
      clearTimeout(timer);
      await subject.waitForTimeout(SETTLE_MS);
      const firstThemed = (await readFrames()).find(([themed]) => themed);
      const firstThemedBg = firstThemed?.[1] ?? null;
      if (scenario.answer === "late") {
        await subject
          .waitForFunction(
            (first) => {
              const frames = (window as unknown as { __startupFrames: Frame[] }).__startupFrames;
              return frames[frames.length - 1]?.[1] !== first;
            },
            firstThemedBg,
            { timeout: REPAINT_LIMIT_MS },
          )
          .catch(() => undefined);
      }
      const settled = await subject.evaluate((key) => {
        const root = document.documentElement;
        return {
          bgAfter: getComputedStyle(root).getPropertyValue("--wt-color-bg").trim(),
          storedAfter: window.localStorage.getItem(key),
          appRendered: document.querySelector("#app")?.firstElementChild != null,
        };
      }, STORAGE_KEY);
      return {
        engine: `${browser.browserType().name()} ${browser.version()}`,
        firstThemedBg,
        firstThemedAtMs: firstThemed?.[2] ?? null,
        themeRequests,
        themeRequestsTraced,
        ...settled,
      };
    } finally {
      await subjectContext.close();
      await ownBrowser?.close();
    }
  };
}
