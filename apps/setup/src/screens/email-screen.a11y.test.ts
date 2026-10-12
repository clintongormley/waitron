import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./email-screen.js";
import type { SetupEmailScreen } from "./email-screen.js";

const email = {
  server: "smtp.example.com",
  port: 587,
  encryption: "starttls" as const,
  user: "venue",
  password: "secret",
  from: "invoices@example.com",
};
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
describe.each(["light", "dark"] as const)("Email step in %s", (theme) => {
  it.each(["initial", "invalid", "accepted", "refused", "timeout", "busy"] as const)(
    "has accessible %s state in both languages and sizes",
    async (state) => {
      const runEmailTest =
        state === "busy"
          ? vi.fn(() => new Promise<never>(() => {}))
          : vi.fn().mockResolvedValue(
              state === "accepted"
                ? { accepted: true }
                : {
                    accepted: false,
                    code: state === "timeout" ? "email.test_timeout" : "email.test_refused",
                  },
            );
      const { el, host } = await mountWidget<SetupEmailScreen>(
        "setup-email-screen",
        {
          email: state === "invalid" ? undefined : email,
          adminEmail: "admin@example.com",
          api: { runEmailTest },
        },
        theme,
      );
      if (state !== "initial") {
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=test]")!.click();
        await el.updateComplete;
        if (state !== "busy" && state !== "invalid")
          await vi.waitFor(() =>
            expect(
              (
                el.shadowRoot!.querySelector("[data-test=test]") as HTMLElement & {
                  disabled: boolean;
                }
              ).disabled,
            ).toBe(false),
          );
      }
      try {
        for (const locale of ["en-GB", "es-ES"]) {
          setLocale(locale);
          await el.updateComplete;
          for (const width of [390, 1280]) {
            await page.viewport(width, 1100);
            expect(window.innerWidth).toBe(width);
            await expectNoA11yViolations(host);
            expect(el.getBoundingClientRect().width).toBeLessThanOrEqual(width);
            if (import.meta.env.VITE_A231Q_VISUAL === "1")
              await page.screenshot({
                path: `__screenshots__/a231q-email-${state}-${theme}-${locale}-${width}.png`,
              });
          }
        }
      } finally {
        await page.viewport(1280, 720);
      }
    },
  );
});
