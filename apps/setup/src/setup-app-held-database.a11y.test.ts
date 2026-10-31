import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import { setLocale } from "./i18n/t.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { initial } from "../test/first-setup-browser.js";
import { q, click, stoppedSummary } from "../test/missing-database-browser.js";
import { cleanupWidgets, expectNoA11yViolations } from "./widgets/test-helpers.js";
import { initialOwnerStrings } from "./screens/initial-owner-strings.js";
import { heldFixture, refusedCause, settled, tradingEnv } from "../test/held-database-browser.js";

afterEach(async () => {
  cleanupWidgets();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
  setLocale("en-GB");
});
const summaries = {
  offered: () => Response.json(stoppedSummary),
  confirmation: () => Response.json(stoppedSummary),
  "refused-fault": () => refusedCause("kept-records"),
  unreadable: () => Response.json({ ...stoppedSummary, databaseUnreadable: true }),
} as const;
/** What each state draws once it is reached, and the control left to focus there. */
const reached = {
  offered: ["start-again", "start-again"],
  confirmation: ["start-again-deletes", "confirm-start-again"],
  "refused-fault": ["start-again-refused", "reconnect-first"],
  unreadable: ["setup-database-unreadable", "confirm-start-again"],
} as const;
for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      for (const state of ["offered", "confirmation", "refused-fault", "unreadable"] as const)
        it(`${locale} ${theme} ${width} ${state}: accessible Start again beside a stopped recovery and a setup database holding records`, async () => {
          const previous = [innerWidth, innerHeight];
          try {
            await page.viewport(width, 1200);
            const { app, host, requests } = await heldFixture({
              locale,
              theme,
              summary: summaries[state],
            });
            await settled(app);
            const [shownAs, focusable] = reached[state];
            if (state !== "offered") {
              await click(app, "start-again");
              await expect.poll(() => q(app, shownAs)).not.toBeNull();
              await settled(app);
              if (state !== "refused-fault")
                await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
            }
            await app.updateComplete;
            await expectNoA11yViolations(host);
            expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
            const section = q<HTMLElement>(app, "screen-first-owner")!;
            expect(section.getBoundingClientRect().right).toBeLessThanOrEqual(width);
            if (import.meta.env.VITE_A1131BC_HELD_LOOK === "1")
              await page.screenshot({
                path: `__screenshots__/a1131bc-held/${locale}-${theme}-${width}-${state}.png`,
              });
            const button = q<WtButton>(app, focusable)!;
            expect(button.disabled).toBe(false);
            const native = button.shadowRoot!.querySelector("button")!;
            native.focus();
            expect(button.shadowRoot!.activeElement).toBe(native);
            expect(native.getBoundingClientRect().width).toBeGreaterThan(0);
            expect(requests.some((r) => r.path.endsWith("/resolution/start-again"))).toBe(false);
          } finally {
            await page.viewport(previous[0]!, previous[1]!);
          }
        });

for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const view of ["trading-saved", "setup-finished"] as const)
      it(`${locale} ${theme} ${view}: accessible refusal beside a stopped recovery and a setup database holding records`, async () => {
        const { app, host } = await heldFixture({
          locale,
          theme,
          inspection: () => (view === "trading-saved" ? { artifacts: [tradingEnv] } : {}),
          summary: () => refusedCause(view === "setup-finished" ? view : "trading-settings"),
        });
        const t = initialOwnerStrings[locale === "es-ES" ? "es" : "en"];
        await settled(app);
        await click(app, "start-again");
        await expect
          .poll(() => q(app, "start-again-refused")?.textContent?.trim())
          .toBe(
            view === "setup-finished"
              ? t.setupFinished
              : `${t.tradingSaved} ${t.tradingSavedPassword}`,
          );
        await settled(app);
        await app.updateComplete;
        await expectNoA11yViolations(host);
        expect(q<WtButton>(app, "reconnect-first")!.disabled).toBe(false);
      });
