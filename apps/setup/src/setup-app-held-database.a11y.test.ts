import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton, WtInput } from "@waitron/ui";
import { SetupApp } from "./setup-app.js";
import { setLocale } from "./i18n/t.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { initial, venue, wizardApi } from "../test/first-setup-browser.js";
import { q, click, stoppedActivity, stoppedSummary } from "../test/missing-database-browser.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./widgets/test-helpers.js";
import { initialOwnerStrings } from "./screens/initial-owner-strings.js";
import {
  heldFixture,
  heldPasswordAccepted,
  refusedCause,
  settled,
  tradingEnv,
} from "../test/held-database-browser.js";

afterEach(async () => {
  cleanupWidgets();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
  setLocale("en-GB");
});
for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      for (const state of ["offered", "confirmation"] as const)
        it(`${locale} ${theme} ${width} ${state}: accessible Start again beside a stopped recovery and a setup database holding records`, async () => {
          const previous = [innerWidth, innerHeight];
          try {
            await page.viewport(width, 1200);
            let generation = 1;
            const { api, requests } = wizardApi({
              claimed: true,
              intercept(path) {
                if (path.endsWith("/backup/activity"))
                  return Response.json({ activity: stoppedActivity });
                if (path.endsWith("/start-again/summary"))
                  return Response.json({
                    ...stoppedSummary,
                    held: { rows: 105, kept: 0, records: 0, accepted: 0 },
                  });
                if (path.endsWith("/resolution/recover")) {
                  generation += 1;
                  return Response.json({
                    state: { ...initial, revision: generation, ownerGeneration: generation },
                    capability: "B".repeat(43),
                    ownerGeneration: generation,
                  });
                }
                if (path.endsWith("/resolution"))
                  return Response.json({
                    version: 2,
                    inspectionId: "a".repeat(64),
                    pair: "valid",
                    database: "occupied",
                    emptyDatabase: false,
                    password: "checkable",
                    revision: generation,
                    ownerGeneration: generation,
                    repairEligible: false,
                    artifacts: [],
                  });
              },
            });
            const { el: app, host } = await mountWidget<SetupApp>(
              "setup-app",
              { api, browserLanguages: [locale] },
              theme,
            );
            await expect.poll(() => q(app, "recovery-stopped")).not.toBeNull();
            await app.updateComplete;
            if (state === "confirmation") {
              await click(app, "start-again");
              await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
              await userEvent.fill(
                q<WtInput>(app, "resume-password")!.shadowRoot!.querySelector("input")!,
                venue.admin.password,
              );
              await click(app, "damaged-record-continue");
              await expect.poll(() => q(app, "start-again-deletes")).not.toBeNull();
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
            const button = q<WtButton>(
              app,
              state === "confirmation" ? "confirm-start-again" : "start-again",
            )!;
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
    for (const view of ["kept", "trading-saved", "setup-finished"] as const)
      it(`${locale} ${theme} ${view}: accessible refusal beside a stopped recovery and a setup database holding records`, async () => {
        const { app, host } = await heldFixture({
          locale,
          theme,
          inspection: () => (view === "trading-saved" ? { artifacts: [tradingEnv] } : {}),
          summary:
            view === "setup-finished"
              ? () => refusedCause("setup-finished")
              : () => Response.json(stoppedSummary),
        });
        const t = initialOwnerStrings[locale === "es-ES" ? "es" : "en"];
        if (view !== "trading-saved") await heldPasswordAccepted(app);
        await expect
          .poll(() =>
            view === "kept"
              ? q(app, "held-refused")
              : app.shadowRoot!.textContent!.includes(
                  view === "setup-finished" ? t.setupFinished : t.tradingSaved,
                ) || null,
          )
          .not.toBeNull();
        if (view === "setup-finished") await settled(app);
        await app.updateComplete;
        await expectNoA11yViolations(host);
        const focusable = q<WtButton>(
          app,
          view === "kept" ? "cancel-start-again" : "reconnect-first",
        )!;
        expect(focusable.disabled).toBe(false);
      });
