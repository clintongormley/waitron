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
        api: {
          ...apiWith(() => new Promise(() => {})),
          nodeStanding: () => Promise.resolve("serving-secondary"),
        } as unknown as SetupApi,
        startDelayMs: 0,
        mirrorJoin: true,
        breakGlassSecret: "synthetic-key-for-visual-check",
        breakGlassKeyName: "2026-10-15 · K7QF",
      },
      theme,
    );
    await vi.waitFor(() => expect(q(el, "[data-test=break-glass-key-name]")).not.toBeNull());
    try {
      for (const locale of ["en-GB", "es-ES"] as const) {
        setLocale(locale);
        await el.updateComplete;
        for (const width of [390, 1280]) {
          await page.viewport(width, 1100);
          expect(window.innerWidth).toBe(width);
          expect(q(el, "[data-test=break-glass-key-name]")?.textContent?.trim()).toBe(
            locale === "en-GB"
              ? "Box key 15 Oct 2026 · K7QF"
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

  it("has no violations on the Recovery pack step, before and after Copy, at phone and desktop widths in both languages", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const { host, el } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      {
        api: apiWith(() => new Promise(() => {})),
        startDelayMs: 100000,
        onboardingIntent: "prepare",
        masterKey: "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5",
        masterKeyName: "2026-11-23 · QZJV",
        recoveryPackPdf: btoa("%PDF-test"),
      },
      theme,
    );
    try {
      for (const locale of ["en-GB", "es-ES"] as const) {
        setLocale(locale);
        await el.updateComplete;
        for (const width of [390, 1280]) {
          await page.viewport(width, 1100);
          expect(q(el, "[data-test=master-key]")?.textContent).toBe(
            "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5",
          );
          await expectNoA11yViolations(host);
        }
      }
      q(el, "[data-test=pack-copy]")!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=pack-continue]")).not.toBeNull());
      await expectNoA11yViolations(host);
    } finally {
      vi.restoreAllMocks();
      await page.viewport(1280, 720);
    }
  });

  it("has no violations when a Copy is refused, in both languages", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const { host, el } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      {
        api: apiWith(() => new Promise(() => {})),
        startDelayMs: 100000,
        onboardingIntent: "prepare",
        masterKey: "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5",
        masterKeyName: "2026-11-23 · QZJV",
        recoveryPackPdf: btoa("%PDF-test"),
      },
      theme,
    );
    try {
      q(el, "[data-test=pack-copy]")!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=pack-copy-failed]")).not.toBeNull());
      for (const locale of ["en-GB", "es-ES"] as const) {
        setLocale(locale);
        await el.updateComplete;
        await expectNoA11yViolations(host);
      }
    } finally {
      vi.restoreAllMocks();
    }
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
        "The box is ready. Open it here:",
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

  it("has no violations on a new restaurant's finished page offering this box's label", async () => {
    const { host, el } = await mountWidget<SetupDoneScreen>(
      "setup-done-screen",
      {
        api: apiWith(() => new Promise(() => {})),
        startDelayMs: 100000,
        onboardingIntent: "live",
        contactUrl: "https://box-7c21.waitron.local",
      },
      theme,
    );
    const label = q(el, "setup-box-label")!;
    await vi.waitFor(() =>
      expect(label.shadowRoot!.querySelector("[data-test=label-qr]")).not.toBeNull(),
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

  it.each(["en-GB", "es-ES"] as const)(
    "has no violations on the joining page while copying, after losing the box, at the key task, at the label task and with every task done (%s)",
    async (locale) => {
      setLocale(locale);
      let answer: "copying" | "lost" | "joined" = "copying";
      const { host, el } = await mountWidget<SetupDoneScreen>(
        "setup-done-screen",
        {
          api: {
            ...apiWith(() => new Promise(() => {})),
            nodeStanding: () => {
              if (answer === "joined") return Promise.resolve("serving-secondary");
              if (answer === "lost") return Promise.reject(new TypeError("Failed to fetch"));
              return Promise.reject({ code: "server.not_found", status: 404 });
            },
            joinCopyStage: () => Promise.resolve("restoring"),
          } as unknown as SetupApi,
          startDelayMs: 0,
          pollIntervalMs: 5,
          lostAfterMs: 30,
          lostPollIntervalMs: 5,
          mirrorJoin: true,
          breakGlassSecret: "bg-9f3a",
          serversUrl: "https://waitron.local/servers",
          contactUrl: "https://box-41aa.waitron.local",
        },
        theme,
      );
      const status = () => q(el, "[data-test=joining-status]")!;
      await vi.waitFor(() => expect(status().textContent).toMatch(/Copying|Copiando/));
      expect(q(el, "[data-test=task-join]")!.getAttribute("data-done")).toBe("false");
      await expectNoA11yViolations(host);
      answer = "lost";
      await vi.waitFor(() => expect(status().querySelector("a")).not.toBeNull());
      await expectNoA11yViolations(host);
      answer = "joined";
      await vi.waitFor(() =>
        expect(q(el, "[data-test=task-join]")!.getAttribute("data-done")).toBe("true"),
      );
      await expectNoA11yViolations(host);
      q(el, "[data-test=key-wrote]")!.click();
      await el.updateComplete;
      const label = q(el, "setup-box-label")!;
      await vi.waitFor(() =>
        expect(label.shadowRoot!.querySelector("[data-test=label-qr]")).not.toBeNull(),
      );
      await expectNoA11yViolations(host);
      q(el, "[data-test=label-stuck]")!.click();
      await el.updateComplete;
      expect(q(el, "[data-test=task-key]")!.getAttribute("data-done")).toBe("true");
      expect(q(el, "[data-test=task-label]")!.getAttribute("data-done")).toBe("true");
      await expectNoA11yViolations(host);
    },
  );

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
        "The box is ready. Open it here:",
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
