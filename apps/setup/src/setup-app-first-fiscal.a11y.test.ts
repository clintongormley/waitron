import { afterEach, expect, it } from "vitest";
import { SetupApp } from "./setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { initial, wizardApi } from "../test/first-setup-browser.js";
import { setLocale } from "./i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./widgets/test-helpers.js";

afterEach(async () => {
  cleanupWidgets();
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  setLocale("en-GB");
});
for (const theme of ["light", "dark"] as const)
  for (const locale of ["en-GB", "es-ES"] as const)
    for (const stage of [
      "resume",
      "missing-password",
      "refusal",
      "abandoned",
      "uncertain",
      "complete",
    ] as const) {
      it(`${locale} ${theme} owner ${stage} is accessible`, async () => {
        sessionStorage.setItem(
          FIRST_SETUP_SESSION_KEY,
          JSON.stringify({
            version: 1,
            clientClaimNonce: "C".repeat(43),
            claimPending: false,
            owner: {
              attemptId: initial.attemptId,
              revision: 1,
              ownerGeneration: 1,
              capability: "A".repeat(43),
            },
          }),
        );
        const terminal = ["abandoned", "uncertain", "complete"].includes(stage);
        const { api, requests } = wizardApi({
          claimed: true,
          intercept(path, _body, headers) {
            if (path.endsWith("/first-setup/status") && headers.has("X-Waitron-Setup-Owner"))
              return Response.json({
                claimed: true,
                state: {
                  ...initial,
                  status: terminal ? stage : "claimed",
                  consumptionIntent: terminal,
                },
              });
          },
        });
        const { el, host } = await mountWidget<SetupApp>(
          "setup-app",
          { api, browserLanguages: [locale] },
          theme,
        );
        await expect
          .poll(() => el.shadowRoot!.querySelector("[data-test=screen-first-owner]"))
          .not.toBeNull();
        if (stage === "missing-password") Object.assign(el, { firstPasswordAttempted: true });
        if (stage === "refusal")
          Object.assign(el, {
            firstOwnerError: () =>
              locale.startsWith("es")
                ? "Otra pestaña está usando esta configuración."
                : "Another tab owns this setup.",
          });
        await el.updateComplete;
        await expectNoA11yViolations(host);
        expect(requests.some((request) => request.path.endsWith("/provision"))).toBe(false);
      });
    }
