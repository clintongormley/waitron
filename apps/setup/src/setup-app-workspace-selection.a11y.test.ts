import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import type { WtButton, WtInput } from "@waitron/ui";
import { setLocale } from "./i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations } from "./widgets/test-helpers.js";
import { click, enterPassword, q, selectionFixture } from "../test/workspace-selection-browser.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      for (const state of ["password", "refusal", "restarting"] as const)
        it(`${locale} ${theme} ${width} ${state}: accessible interrupted workspace selection`, async () => {
          const previous = [innerWidth, innerHeight];
          try {
            await page.viewport(width, 1200);
            const { app, host } = await selectionFixture({
              locale,
              theme,
              intercept(path) {
                if (state === "refusal" && path.endsWith("/resume-selection"))
                  return Response.json(
                    { error: { code: "setup.owner_required", params: {} } },
                    { status: 403 },
                  );
              },
            });
            if (state !== "password") {
              await enterPassword(app);
              await click(app, "resume");
              if (state === "refusal")
                await expect.poll(() => q(app, "resume-password")).not.toBeNull();
              else await expect.poll(() => q(app, "resume-password")).toBeNull();
            }
            await app.updateComplete;
            if (state === "refusal")
              expect(
                app.shadowRoot!.querySelector("wt-form-actions")!.shadowRoot!.textContent,
              ).toContain(locale === "es-ES" ? "Contraseña no aceptada" : "Password not accepted");
            await expectNoA11yViolations(host);
            expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
            const section = q<HTMLElement>(app, "screen-first-owner")!;
            expect(section.getBoundingClientRect().right).toBeLessThanOrEqual(width);
            const button = q<WtButton>(app, state === "restarting" ? "reconnect-first" : "resume")!;
            const native = button.shadowRoot!.querySelector("button")!;
            native.focus();
            expect(button.shadowRoot!.activeElement).toBe(native);
            expect(native.getBoundingClientRect().width).toBeGreaterThan(0);
            if (state !== "restarting") {
              const input = q<WtInput>(app, "resume-password")!.shadowRoot!.querySelector("input")!;
              expect(input.name).toBe("setup-resume-password");
              expect(input.value).toBe("");
            }
            expect(q(app, "start-again")).toBeNull();
            expect(q(app, "finish-setup")).toBeNull();
            if (import.meta.env.VITE_A679_SELECTION_LOOK === "1")
              await page.screenshot({
                path: `__screenshots__/a679-selection/${locale}-${theme}-${width}-${state}.png`,
              });
          } finally {
            await page.viewport(previous[0]!, previous[1]!);
          }
        });
