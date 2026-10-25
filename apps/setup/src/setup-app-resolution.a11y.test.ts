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
for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      it(`${locale} ${theme} ${width} restarting: accessible page after Start again`, async () => {
        const previous = [innerWidth, innerHeight];
        try {
          await page.viewport(width, 1200);
          const { api, requests } = wizardApi({
            claimed: true,
            intercept(path) {
              if (path.endsWith("/resolution/start-again"))
                return Response.json({ restarting: true });
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
          const start = el.shadowRoot!.querySelector<WtButton>("[data-test=start-again]")!;
          await userEvent.click(start.shadowRoot!.querySelector("button")!);
          await userEvent.click(
            el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=retire-confirmed]")!,
          );
          await el.updateComplete;
          const confirm = el.shadowRoot!.querySelector<WtButton>(
            "[data-test=confirm-start-again]",
          )!;
          await userEvent.click(confirm.shadowRoot!.querySelector("button")!);
          await expect
            .poll(() => el.shadowRoot!.querySelector("[data-test=start-again]"))
            .toBeNull();
          expect(requests.filter((request) => request.path.endsWith("/start-again"))).toHaveLength(
            1,
          );
          await el.updateComplete;
          await expectNoA11yViolations(host);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
          if (import.meta.env.VITE_A679_RESOLUTION_LOOK === "1")
            await page.screenshot({
              path: `__screenshots__/a679-interruption/${locale}-${theme}-${width}-restarting.png`,
            });
        } finally {
          await page.viewport(previous[0]!, previous[1]!);
        }
      });
for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      for (const step of ["password", "warning"] as const)
        it(`${locale} ${theme} ${width} damaged record ${step}: accessible Start again with the database present`, async () => {
          const previous = [innerWidth, innerHeight];
          try {
            await page.viewport(width, 1200);
            let recovered = false;
            const { api, requests } = wizardApi({
              claimed: true,
              intercept(path, _body, headers) {
                if (path.endsWith("/resolution"))
                  return Response.json({
                    version: 2,
                    inspectionId: "a".repeat(64),
                    pair: "valid",
                    database: "no-venue-rows",
                    emptyDatabase: true,
                    password: "checkable",
                    revision: recovered ? 2 : 1,
                    ownerGeneration: recovered ? 2 : 1,
                    repairEligible: false,
                    artifacts: [],
                  });
                if (
                  path.endsWith("/resolution/start-again") &&
                  !headers.has("X-Waitron-Setup-Owner")
                )
                  return Response.json(
                    { error: { code: "setup.start_again_password_required", params: {} } },
                    { status: 403 },
                  );
                if (path.endsWith("/resolution/recover")) {
                  recovered = true;
                  return Response.json({
                    state: { ...initial, revision: 2, ownerGeneration: 2 },
                    capability: "B".repeat(43),
                    ownerGeneration: 2,
                  });
                }
              },
            });
            const { el, host } = await mountWidget<SetupApp>(
              "setup-app",
              { api, browserLanguages: [locale] },
              theme,
            );
            const find = <T extends Element>(name: string) =>
              el.shadowRoot!.querySelector<T>(`[data-test=${name}]`);
            await expect.poll(() => find("start-again")).not.toBeNull();
            await userEvent.click(
              find<WtButton>("start-again")!.shadowRoot!.querySelector("button")!,
            );
            await userEvent.click(find<HTMLInputElement>("retire-confirmed")!);
            await userEvent.click(
              find<WtButton>("confirm-start-again")!.shadowRoot!.querySelector("button")!,
            );
            await expect.poll(() => find("damaged-record-password")).not.toBeNull();
            if (step === "warning") {
              const field = find<HTMLElement>("resume-password")!;
              await userEvent.fill(field.shadowRoot!.querySelector("input")!, "original password");
              await userEvent.click(
                find<WtButton>("damaged-record-continue")!.shadowRoot!.querySelector("button")!,
              );
              await expect.poll(() => find("recovery-record-damaged")).not.toBeNull();
              await userEvent.click(find<HTMLInputElement>("retire-confirmed")!);
            }
            await el.updateComplete;
            await expectNoA11yViolations(host);
            expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
            expect(
              el
                .shadowRoot!.querySelector("[data-test=screen-first-owner]")!
                .getBoundingClientRect().right,
            ).toBeLessThanOrEqual(width);
            expect(
              requests.filter((request) => request.path.endsWith("/start-again")),
            ).toHaveLength(1);
          } finally {
            await page.viewport(previous[0]!, previous[1]!);
          }
        });
