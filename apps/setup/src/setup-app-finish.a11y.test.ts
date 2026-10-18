import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton, WtInput } from "@waitron/ui";
import { SetupApp } from "./setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { setLocale } from "./i18n/t.js";
import { initial, venue, wizardApi } from "../test/first-setup-browser.js";
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
      for (const screen of ["first-owner", "cert", "email", "review"] as const)
        it(`${locale} ${theme} ${width} ${screen}: accessible publication recovery`, async () => {
          const previous = [innerWidth, innerHeight];
          try {
            await page.viewport(width, screen === "review" ? 2200 : 1200);
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
                if (path.endsWith("/recover"))
                  return Response.json({ state, capability: "B".repeat(43), ownerGeneration: 2 });
                if (path.endsWith("/status") && headers.has("X-Waitron-Setup-Owner"))
                  return Response.json({ claimed: true, state });
              },
            });
            const { el: app, host } = await mountWidget<SetupApp>(
              "setup-app",
              { api, browserLanguages: [locale] },
              theme,
            );
            await expect
              .poll(() => app.shadowRoot!.querySelector("[data-test=resume-password]"))
              .not.toBeNull();
            const field = app.shadowRoot!.querySelector<WtInput>("[data-test=resume-password]")!;
            await userEvent.fill(field.shadowRoot!.querySelector("input")!, venue.admin.password);
            await userEvent.click(
              app
                .shadowRoot!.querySelector<WtButton>("[data-test=resume]")!
                .shadowRoot!.querySelector("button")!,
            );
            await expect
              .poll(() => app.shadowRoot!.querySelector("[data-test=finish-setup]"))
              .not.toBeNull();
            if (screen !== "first-owner") {
              await userEvent.click(
                app
                  .shadowRoot!.querySelector<WtButton>("[data-test=finish-setup]")!
                  .shadowRoot!.querySelector("button")!,
              );
              if (screen !== "cert") {
                if (screen === "review")
                  app.shadowRoot!.querySelector("main")!.dispatchEvent(
                    new CustomEvent("setup-patch", {
                      detail: {
                        patch: {
                          aeatCert: {
                            pfxBase64: btoa("synthetic certificate"),
                            passphrase: "synthetic passphrase",
                            certKind: "sello",
                          },
                          email: {
                            server: "smtp.example.test",
                            port: 465,
                            encryption: "tls",
                            user: "",
                            password: "",
                            from: "venue@example.test",
                          },
                        },
                      },
                      bubbles: true,
                      composed: true,
                    }),
                  );
                app.shadowRoot!.querySelector("main")!.dispatchEvent(
                  new CustomEvent("setup-goto", {
                    detail: { screen },
                    bubbles: true,
                    composed: true,
                  }),
                );
              }
            }
            await expect
              .poll(() => app.shadowRoot!.querySelector(`[data-test=screen-${screen}]`))
              .not.toBeNull();
            await app.updateComplete;
            await expectNoA11yViolations(host);
            expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
            expect(
              requests.some((r) => /\/(finish|provision|email-test|fiscal-test)$/.test(r.path)),
            ).toBe(false);
            if (import.meta.env.VITE_A679_FINISH_LOOK === "1")
              await page.screenshot({
                element: host,
                path: `__screenshots__/a679-finish/${locale}-${theme}-${width}-${screen}.png`,
              });
          } finally {
            await page.viewport(previous[0]!, previous[1]!);
          }
        });
