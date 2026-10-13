import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { DashboardApi, EmailSettingsView } from "../api/client.js";
import "./email-settings-panel.js";
const stored: EmailSettingsView = {
  mode: "smtp",
  editable: true,
  settings: {
    server: "smtp.example.test",
    port: 465,
    encryption: "tls",
    from: "invoices@example.test",
    hasAuthentication: true,
  },
};
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
describe.each(["light", "dark"] as const)("email settings in %s", (theme) => {
  it.each([
    "configured",
    "unconfigured",
    "captured",
    "prepare",
    "initial",
    "invalid",
    "accepted",
    "refused",
    "saving",
    "read-failure",
  ] as const)(
    "renders accessible %s at phone and desktop widths in both languages",
    async (state) => {
      const view: EmailSettingsView =
        state === "unconfigured"
          ? { mode: "unconfigured", editable: true, settings: null }
          : state === "captured"
            ? { mode: "local_capture", editable: false, settings: null }
            : { ...stored, editable: state !== "prepare" };
      const api = {
        getEmailSettings:
          state === "read-failure"
            ? vi.fn().mockRejectedValue({ code: "connection.failed" })
            : vi.fn().mockResolvedValue(view),
        saveEmailSettings: vi.fn(() => new Promise<never>(() => {})),
        testEmailSettings: vi
          .fn()
          .mockResolvedValue(
            state === "accepted"
              ? { accepted: true }
              : { accepted: false, code: "email.test_refused" },
          ),
      } as unknown as DashboardApi;
      const { el, host } = await mountWidget<
        HTMLElementTagNameMap["dashboard-email-settings-panel"]
      >("dashboard-email-settings-panel", { api }, theme);
      await vi.waitFor(() =>
        expect(
          el.shadowRoot!.querySelector(
            state === "read-failure" ? "[role=alert]" : "[data-test=summary]",
          ),
        ).not.toBeNull(),
      );
      if (["initial", "invalid", "accepted", "refused", "saving"].includes(state)) {
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=change]")!.click();
        await el.updateComplete;
        const form = el.shadowRoot!.querySelector("dashboard-email-settings-form")!;
        await form.updateComplete;
        if (["accepted", "refused", "saving"].includes(state)) {
          for (const [field, value] of [
            ["user", "invoice-user"],
            ["password", "fixture-secret"],
          ]) {
            form
              .shadowRoot!.querySelector(`[data-test=${field}]`)!
              .dispatchEvent(
                new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
              );
          }
          await form.updateComplete;
        }
        if (state !== "initial") {
          form
            .shadowRoot!.querySelector<HTMLElement>(
              `[data-test=${state === "saving" ? "save" : "test"}]`,
            )!
            .click();
          await form.updateComplete;
          if (state === "accepted")
            await vi.waitFor(() =>
              expect(form.shadowRoot!.querySelector("[role=status]")).not.toBeNull(),
            );
          if (state === "refused" || state === "invalid")
            await vi.waitFor(() =>
              expect(form.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe(""),
            );
        }
      }
      const family = getComputedStyle(host).getPropertyValue("--wt-font-family");
      expect(family).not.toBe("");
      // Verdana is about as wide as CI's Linux system font, where the reveal button once covered
      // the password's label although macOS's narrower font fitted.
      const fonts = state === "initial" ? [family, `Verdana, ${family}`] : [family];
      try {
        for (const [locale, font] of ["en-GB", "es"].flatMap((l) => fonts.map((f) => [l, f]))) {
          setLocale(locale);
          host.style.setProperty("--wt-font-family", font);
          await el.updateComplete;
          const form = el.shadowRoot!.querySelector("dashboard-email-settings-form");
          if (form) await form.updateComplete;
          for (const width of [390, 1280]) {
            await page.viewport(width, 1100);
            expect(window.innerWidth).toBe(width);
            await expectNoA11yViolations(host);
            expect(host.scrollWidth).toBeLessThanOrEqual(width);
            if (form && state === "initial") {
              const password = form.shadowRoot!.querySelector("[data-test=password]")!;
              const native = password.shadowRoot!.querySelector("input")!;
              expect(native.getBoundingClientRect().width).toBeGreaterThanOrEqual(100);
              const label = password.shadowRoot!.querySelector("label")!;
              const range = document.createRange();
              range.selectNodeContents(label);
              const text = range.getBoundingClientRect();
              const reveal = form
                .shadowRoot!.querySelector<HTMLElement>("[data-test=reveal]")!
                .getBoundingClientRect();
              expect(text.right).toBeLessThanOrEqual(reveal.left);
            }
            if (import.meta.env.VITE_A231Q_VISUAL === "1")
              await page.screenshot({
                path: `__screenshots__/a231q-dashboard-${state}-${theme}-${locale}${font === family ? "" : "-verdana"}-${width}.png`,
              });
          }
        }
      } finally {
        await page.viewport(1280, 720);
      }
    },
  );
});
