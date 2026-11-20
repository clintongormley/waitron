import { page } from "vitest/browser";
import { setLocale } from "../i18n/t.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./done-screen.js";
import type { SetupDoneScreen } from "./done-screen.js";
import type { SetupApi } from "../api/client.js";

function apiWith(getStatus: () => Promise<unknown>): SetupApi {
  return {
    getStatus,
    getRecoveryStatus: () => Promise.reject({ code: "server.internal", status: 404 }),
  } as unknown as SetupApi;
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
              ? "Server key 15 Oct 2026 · K7QF"
              : "Clave del servidor 15 oct 2026 · K7QF",
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

  it("has no violations showing the Preparation PDF download link", async () => {
    const { host } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      {
        api: apiWith(() => new Promise(() => {})),
        startDelayMs: 100000,
        onboardingIntent: "prepare",
        breakGlassSecret: "key-on-paper",
        recoveryPackPdf: btoa("%PDF-test"),
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

  it.each([undefined, "bucket"] as const)(
    "has no violations asking for the time, then once it is confirmed (restored: %s)",
    async (restored) => {
      const times = {
        deviceMs: Date.UTC(2026, 10, 14, 9, 30, 7),
        serverMs: Date.UTC(2026, 10, 14, 9, 30, 5),
      };
      const api = {
        getStatus: () => Promise.reject({ code: "server.waiting_for_clock", status: 503 }),
        restoreClock: async (route: string) =>
          route === "challenge"
            ? { id: "challenge" }
            : { result: route === "confirm" ? "confirmed" : "agrees", ...times },
      } as unknown as SetupApi;
      const { host, el } = await mountWidget<SetupDoneScreen>(
        "setup-done-screen",
        { api, startDelayMs: 0, pollIntervalMs: 100000, restored, nodeRecoveryKey: "key" },
        theme,
      );
      await vi.waitFor(() => expect(q(el, "[data-test=clock-server]")?.textContent).not.toBe(""));
      await expectNoA11yViolations(host);
      q(el, "[data-test=clock-confirm]")!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=clock-confirm]")).toBeNull());
      await expectNoA11yViolations(host);
    },
  );

  it("has no violations while the server has not answered the comparison", async () => {
    const api = {
      getStatus: () => Promise.reject({ code: "server.waiting_for_clock", status: 503 }),
      restoreClock: async (route: string) => {
        if (route === "challenge") return { id: "challenge" };
        throw new TypeError("Failed to fetch");
      },
    } as unknown as SetupApi;
    const { host, el } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      { api, startDelayMs: 0, pollIntervalMs: 100000, nodeRecoveryKey: "key" },
      theme,
    );
    await vi.waitFor(() => expect(q(el, "[data-test=clock-note]")).not.toBeNull());
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

  it("has no violations once the start has failed", async () => {
    const { el, host } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      {
        api: {
          getStatus: vi.fn().mockRejectedValue({ code: "server.internal", status: 404 }),
          getRecoveryStatus: vi.fn().mockResolvedValue({ failures: 3, level: "recovery" }),
        } as unknown as SetupApi,
        startDelayMs: 0,
        pollIntervalMs: 100000,
        restored: "archive",
        breakGlassSecret: "bg-9f3a",
      },
      theme,
    );
    await vi.waitFor(() => expect(q(el, "[data-test=link-server]")).not.toBeNull());
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
        restored: "bucket",
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
  it("has no violations live with the server ready", async () => {
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
