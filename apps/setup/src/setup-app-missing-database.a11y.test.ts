import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import { setLocale } from "./i18n/t.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { initial } from "../test/first-setup-browser.js";
import { cleanupWidgets, expectNoA11yViolations } from "./widgets/test-helpers.js";
import {
  q,
  click,
  missingDatabaseFixture,
  recoverMissing,
} from "../test/missing-database-browser.js";

afterEach(async () => {
  cleanupWidgets();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
  setLocale("en-GB");
});
for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      for (const state of ["password", "recovered", "confirmation", "refusal"] as const)
        it(`${locale} ${theme} ${width} ${state}: accessible missing-database repair`, async () => {
          const previous = [innerWidth, innerHeight];
          try {
            await page.viewport(width, 1200);
            const { app, host, requests } = await missingDatabaseFixture({
              locale,
              theme,
              intercept(path) {
                if (state === "refusal" && path.endsWith("/start-again"))
                  return Response.json(
                    { error: { code: "setup.attempt_conflict", params: {} } },
                    { status: 409 },
                  );
              },
            });
            if (state !== "password") await recoverMissing(app);
            if (state === "confirmation" || state === "refusal") {
              await click(app, "start-again");
              await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
            }
            if (state === "refusal") {
              await click(app, "confirm-start-again");
              await expect.poll(() => q(app, "resume-password")).not.toBeNull();
            }
            await app.updateComplete;
            await expectNoA11yViolations(host);
            expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
            const section = q<HTMLElement>(app, "screen-first-owner")!;
            expect(section.getBoundingClientRect().right).toBeLessThanOrEqual(width);
            expect(q(app, "screen-cert")).toBeNull();
            const button = q<WtButton>(
              app,
              state === "confirmation"
                ? "confirm-start-again"
                : state === "recovered"
                  ? "start-again"
                  : "resume",
            )!;
            const native = button.shadowRoot!.querySelector("button")!;
            native.focus();
            expect(button.shadowRoot!.activeElement).toBe(native);
            expect(native.getBoundingClientRect().width).toBeGreaterThan(0);
            expect(requests.some((r) => /\/(claim|provision|abandon)$/.test(r.path))).toBe(false);
            if (import.meta.env.VITE_A679_MISSING_LOOK === "1")
              await page.screenshot({
                path: `__screenshots__/a679-missing/${locale}-${theme}-${width}-${state}.png`,
              });
          } finally {
            await page.viewport(previous[0]!, previous[1]!);
          }
        });
