import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import { SetupApp } from "./setup-app.js";
import { setLocale } from "./i18n/t.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { initial, wizardApi } from "../test/first-setup-browser.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./widgets/test-helpers.js";

beforeEach(() => sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY));
afterEach(async () => {
  cleanupWidgets();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
  setLocale("en-GB");
});
for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      it(`${locale} ${theme} ${width} after activation: accessible page holding the key`, async () => {
        const previous = [innerWidth, innerHeight];
        try {
          await page.viewport(width, 1200);
          sessionStorage.setItem(
            FIRST_SETUP_SESSION_KEY,
            JSON.stringify({
              version: 1,
              tabLockId: "N".repeat(43),
              claimPending: false,
              owner: {
                attemptId: initial.attemptId,
                revision: 2,
                ownerGeneration: 2,
                capability: "A".repeat(43),
              },
            }),
          );
          const state = {
            ...initial,
            status: "committed",
            consumptionIntent: true,
            revision: 2,
            ownerGeneration: 2,
          };
          const { api, requests } = wizardApi({
            claimed: true,
            intercept(path, _body, headers) {
              if (path.endsWith("/status") && headers.has("X-Waitron-Setup-Owner"))
                return Response.json({ claimed: true, state });
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
          await el.updateComplete;
          await expectNoA11yViolations(host);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
          expect(requests.some((r) => /\/(provision|email-test|fiscal-test)$/.test(r.path))).toBe(
            false,
          );
        } finally {
          await page.viewport(previous[0]!, previous[1]!);
        }
      });
for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      for (const state of [
        "normal",
        "confirmation",
        "unreadable",
        "missing",
        "repairable",
      ] as const)
        it(`${locale} ${theme} ${width} ${state}: accessible interrupted setup`, async () => {
          const previous = [innerWidth, innerHeight];
          try {
            await page.viewport(width, 1200);
            const { api, requests } = wizardApi({
              claimed: true,
              intercept(path) {
                if (path.endsWith("/start-again/summary"))
                  return Response.json({ reached: "claimed" });
                if (path.endsWith("/resolution"))
                  return Response.json({
                    version: 2,
                    inspectionId: "a".repeat(64),
                    pair:
                      state === "repairable"
                        ? "repairable"
                        : state === "unreadable"
                          ? "invalid"
                          : "valid",
                    database: state === "missing" ? "missing" : "no-venue-rows",
                    emptyDatabase: !["missing", "unreadable"].includes(state),
                    revision: state === "unreadable" ? null : 1,
                    ownerGeneration: state === "unreadable" ? null : 1,
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
              await expect
                .poll(() => el.shadowRoot!.querySelector("[data-test=retire-confirmed]"))
                .not.toBeNull();
              await el.updateComplete;
              await userEvent.click(
                el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=retire-confirmed]")!,
              );
            }
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
              if (path.endsWith("/start-again/summary"))
                return Response.json({ reached: "claimed" });
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
          await expect
            .poll(() => el.shadowRoot!.querySelector("[data-test=retire-confirmed]"))
            .not.toBeNull();
          await el.updateComplete;
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
      it(`${locale} ${theme} ${width} damaged record warning: accessible Start again with the database present`, async () => {
        const previous = [innerWidth, innerHeight];
        try {
          await page.viewport(width, 1200);
          const { api, requests } = wizardApi({
            claimed: true,
            intercept(path) {
              if (path.endsWith("/start-again/summary"))
                return Response.json({ reached: "claimed", recoveryRecordDamaged: true });
              if (path.endsWith("/resolution"))
                return Response.json({
                  version: 2,
                  inspectionId: "a".repeat(64),
                  pair: "valid",
                  database: "no-venue-rows",
                  emptyDatabase: true,
                  revision: 1,
                  ownerGeneration: 1,
                  artifacts: [],
                });
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
          await expect.poll(() => find("recovery-record-damaged")).not.toBeNull();
          await el.updateComplete;
          await userEvent.click(find<HTMLInputElement>("retire-confirmed")!);
          await el.updateComplete;
          await expectNoA11yViolations(host);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
          expect(
            el.shadowRoot!.querySelector("[data-test=screen-first-owner]")!.getBoundingClientRect()
              .right,
          ).toBeLessThanOrEqual(width);
          expect(requests.filter((request) => request.path.endsWith("/start-again"))).toEqual([]);
        } finally {
          await page.viewport(previous[0]!, previous[1]!);
        }
      });
for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [375, 1280])
      for (const step of ["asks", "stopped"] as const)
        it(`${locale} ${theme} ${width} ${step}: accessible stop confirmation in a new tab on the ordinary server`, async () => {
          const previous = [innerWidth, innerHeight];
          try {
            await page.viewport(width, 1200);
            const { api, requests } = wizardApi({
              claimed: true,
              resolution: false,
              intercept(path) {
                if (path.endsWith("/resolution/stop")) return Response.json({ restarting: true });
              },
            });
            const { el, host } = await mountWidget<SetupApp>(
              "setup-app",
              { api, browserLanguages: [locale] },
              theme,
            );
            const find = (name: string) =>
              el.shadowRoot!.querySelector<WtButton>(`[data-test=${name}]`);
            await expect.poll(() => find("start-again")).not.toBeNull();
            await userEvent.click(find("start-again")!.shadowRoot!.querySelector("button")!);
            await expect.poll(() => find("confirm-stop")).not.toBeNull();
            if (step === "stopped") {
              await userEvent.click(find("confirm-stop")!.shadowRoot!.querySelector("button")!);
              await expect.poll(() => find("confirm-stop")).toBeNull();
              await expect.poll(() => find("reconnect-first")?.disabled).toBe(false);
              expect(requests.filter((r) => r.path.endsWith("/resolution/stop"))).toHaveLength(1);
            }
            await el.updateComplete;
            await expectNoA11yViolations(host);
            expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
            expect(
              el
                .shadowRoot!.querySelector("[data-test=screen-first-owner]")!
                .getBoundingClientRect().right,
            ).toBeLessThanOrEqual(width);
            if (import.meta.env.VITE_A1379_STOP_LOOK === "1")
              await page.screenshot({
                path: `__screenshots__/a1379-stop/${locale}-${theme}-${width}-${step}.png`,
              });
          } finally {
            await page.viewport(previous[0]!, previous[1]!);
          }
        });
