import { page } from "vitest/browser";
import { setLocale } from "../i18n/t.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./done-screen.js";
import type { SetupDoneScreen } from "./done-screen.js";
import type { SetupApi } from "../api/client.js";

function apiWith(getStatus: () => Promise<unknown>): SetupApi {
  return { getStatus } as unknown as SetupApi;
}

const q = (el: SetupDoneScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

afterEach(() => {
  setLocale("en-GB");
  cleanupWidgets();
});

describe.each(["light", "dark"] as const)("setup-done-screen a11y (%s theme)", (theme) => {
  it("shows the named paper key at phone and desktop widths in both languages", async () => {
    const { host, el } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      {
        api: apiWith(() => new Promise(() => {})),
        startDelayMs: 100000,
        mirrorJoin: true,
        breakGlassSecret: "synthetic-key-for-visual-check",
        breakGlassKeyName: "2026-10-15 · K7QF",
      },
      theme,
    );
    try {
      for (const locale of ["en-GB", "es-ES"] as const) {
        setLocale(locale);
        await el.updateComplete;
        for (const width of [390, 1280]) {
          await page.viewport(width, 1100);
          expect(window.innerWidth).toBe(width);
          expect(q(el, "[data-test=break-glass-key-name]")?.textContent?.trim()).toBe(
            locale === "en-GB"
              ? "Recovery key 15 Oct 2026 · K7QF"
              : "Clave de recuperación 15 oct 2026 · K7QF",
          );
          await expectNoA11yViolations(host);
          if (import.meta.env.VITE_W41S_VISUAL === "1") {
            await page.screenshot({
              path: `__screenshots__/w41s-key-name-${theme}-${locale}-${width}.png`,
            });
          }
        }
      }
    } finally {
      await page.viewport(1280, 720);
    }
  });

  it("has no violations showing the first hours and their link", async () => {
    const { host } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      {
        api: apiWith(() => new Promise(() => {})),
        startDelayMs: 100000,
        openingHours: { departmentId: "first-department" },
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations while waiting for the restart", async () => {
    const { host } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      { api: apiWith(() => new Promise(() => {})), startDelayMs: 100000, pollIntervalMs: 100000 },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations once the server is ready", async () => {
    const { el, host } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      {
        api: apiWith(vi.fn().mockRejectedValue({ code: "server.internal" })),
        startDelayMs: 0,
        pollIntervalMs: 3,
      },
      theme,
    );
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(
        "The server is ready. Open it here:",
      ),
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations on the mirror path", async () => {
    const { host } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      {
        api: apiWith(() => new Promise(() => {})),
        startDelayMs: 100000,
        pollIntervalMs: 100000,
        mirrorJoin: true,
        breakGlassSecret: "bg-9f3a",
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations on the rebuilt copy", async () => {
    const { host } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      {
        api: apiWith(() => new Promise(() => {})),
        startDelayMs: 100000,
        pollIntervalMs: 100000,
        rebuilt: true,
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with the backup nudge suppressed in demo mode", async () => {
    const { host } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      {
        api: apiWith(() => new Promise(() => {})),
        startDelayMs: 100000,
        pollIntervalMs: 100000,
        onboardingIntent: "demo",
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });
  it("has no violations live, with the backup nudge and the server ready", async () => {
    const { el, host } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      {
        api: apiWith(vi.fn().mockRejectedValue({ code: "server.internal" })),
        startDelayMs: 0,
        pollIntervalMs: 3,
        onboardingIntent: "live",
      },
      theme,
    );
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent?.trim()).toBe(
        "The server is ready. Open it here:",
      ),
    );
    expect(q(el, "[data-test=backup-nudge]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations showing the break-glass code on a trading server", async () => {
    const { el, host } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      {
        api: apiWith(() => new Promise(() => {})),
        startDelayMs: 100000,
        pollIntervalMs: 100000,
        onboardingIntent: "live",
        breakGlassSecret: "bg-9f3a",
      },
      theme,
    );
    expect(q(el, "[data-test=break-glass-secret]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations in preparation mode while waiting", async () => {
    const { el, host } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      {
        api: apiWith(() => new Promise(() => {})),
        startDelayMs: 100000,
        pollIntervalMs: 100000,
        onboardingIntent: "prepare",
      },
      theme,
    );
    expect(q(el, "[data-test=mode-indicator]")).not.toBeNull();
    expect(q(el, "[data-test=status]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
