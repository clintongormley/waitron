import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import { SetupApp } from "./setup-app.js";
import { setLocale } from "./i18n/t.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { initial, wizardApi } from "../test/first-setup-browser.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./widgets/test-helpers.js";

afterEach(async () => {
  cleanupWidgets();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
  setLocale("en-GB");
});
for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      for (const state of ["normal", "confirmation", "uncheckable", "missing", "refusal"] as const)
        it(`${locale} ${theme} ${width} ${state}: accessible interrupted setup`, async () => {
          const previous = [innerWidth, innerHeight];
          try {
            await page.viewport(width, 1200);
            const { api, requests } = wizardApi({
              claimed: true,
              intercept(path) {
                if (path.endsWith("/resolution"))
                  return Response.json({
                    version: 2,
                    inspectionId: "a".repeat(64),
                    pair: "valid",
                    database: state === "missing" ? "missing" : "no-venue-rows",
                    emptyDatabase: !["missing", "uncheckable"].includes(state),
                    password: state === "uncheckable" ? "uncheckable" : "checkable",
                    revision: 1,
                    ownerGeneration: 1,
                    repairEligible: false,
                    artifacts: [],
                  });
              },
            });
            const { el, host } = await mountWidget<SetupApp>(
              "setup-app",
              { api, browserLanguages: [locale] },
              theme,
            );
            await expect
              .poll(() => el.shadowRoot!.querySelector("[data-test=start-again]"))
              .not.toBeNull();
            if (state === "confirmation") {
              const start = el.shadowRoot!.querySelector<WtButton>("[data-test=start-again]")!;
              await userEvent.click(start.shadowRoot!.querySelector("button")!);
              await userEvent.click(
                el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=retire-confirmed]")!,
              );
            }
            if (state === "refusal")
              Object.assign(el, {
                firstOwnerError: () =>
                  locale.startsWith("es")
                    ? "No se ha podido comprobar la contraseña."
                    : "The password could not be checked.",
              });
            await el.updateComplete;
            await expectNoA11yViolations(host);
            expect(innerWidth).toBe(width);
            expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
            const section = el.shadowRoot!.querySelector<HTMLElement>(
              "[data-test=screen-first-owner]",
            )!;
            expect(section.getBoundingClientRect().right).toBeLessThanOrEqual(width);
            expect(
              requests.some((request) => /\/(recover|start-again|provision)$/.test(request.path)),
            ).toBe(false);
            if (import.meta.env.VITE_A679_RESOLUTION_LOOK === "1")
              await page.screenshot({
                path: `__screenshots__/a679-interruption/${locale}-${theme}-${width}-${state}.png`,
              });
          } finally {
            await page.viewport(previous[0]!, previous[1]!);
          }
        });
