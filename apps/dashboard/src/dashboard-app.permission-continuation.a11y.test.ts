import { html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DashboardModuleContext } from "@waitron/dashboard-kit";
import type { DashboardApi } from "./api/client.js";
import { DashboardApp } from "./dashboard-app.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./widgets/test-helpers.js";

let moduleContext: DashboardModuleContext;
vi.mock("@waitron/dashboard-modules", async (original) => ({
  ...(await original<typeof import("@waitron/dashboard-modules")>()),
  DASHBOARD_MODULES: [
    {
      module: "test-evidence",
      strings: {
        en: { "nav.test-evidence": "Evidence" },
        es: { "nav.test-evidence": "Evidencia" },
      },
      screen: {
        id: "test-evidence",
        navLabelKey: "nav.test-evidence",
        group: "service",
        requiresPermission: "system.manage",
        readPermission: "fiscal.view",
      },
      create(ctx: DashboardModuleContext) {
        moduleContext = ctx;
        return {
          render: () =>
            html`<h1>Evidence</h1>
              <wt-button
                data-test="sign-in"
                @click=${() => void ctx.permissionContinuation!.signIn({ permission: "system.manage", signal: new AbortController().signal })}
                >Sign in</wt-button
              >`,
        };
      },
    },
  ],
}));

const originalLocale = currentLocale();
const originalSize = { width: window.innerWidth, height: window.innerHeight };
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    "PublicKeyCredential",
    class {
      static isConditionalMediationAvailable = async () => false;
    },
  );
});
afterEach(async () => {
  cleanupWidgets();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setLocale(originalLocale);
  await page.viewport(originalSize.width, originalSize.height);
});

describe.each(["light", "dark"] as const)("permission continuation in %s", (theme) => {
  it.each(["en-GB", "es-ES"] as const)(
    "%s has named controls, keyboard close/focus return and no axe violations at both widths",
    async (locale) => {
      setLocale(locale);
      const api = {
        getMe: async () => ({
          personId: "reader",
          role: "manager",
          email: "reader@example.test",
          locale,
          venueLocale: locale,
          sessionDefault: locale,
          venueName: "Test venue",
          permissions: ["fiscal.view"],
          modules: ["test-evidence"],
        }),
        getGoogleConfig: async () => ({ configured: false }),
        getVenueTheme: async () => ({ hash: "waitron", css: "", logo: null }),
        getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
        listAlerts: async () => ({ visible: false, alerts: [] }),
        getDiskStop: async () => ({ stopped: false, deleted: null }),
      } as unknown as DashboardApi;
      history.replaceState(null, "", "/manage/test-evidence");
      const { el: app, host } = await mountWidget<DashboardApp>(
        "dashboard-app",
        { api, request: async () => ({}) as never },
        theme,
      );
      await vi.waitFor(() =>
        expect(app.shadowRoot!.querySelector("[data-test=sign-in]")).not.toBeNull(),
      );
      for (const width of [1280, 390]) {
        await page.viewport(width, 900);
        const invoker =
          app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=sign-in]")!;
        await invoker.updateComplete;
        const nativeInvoker = invoker.shadowRoot!.querySelector("button")!;
        await userEvent.click(nativeInvoker);
        await vi.waitFor(() =>
          expect(
            app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
              "[data-test=permission-sign-in]",
            )?.open,
          ).toBe(true),
        );
        const dialog = app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
          "[data-test=permission-sign-in]",
        )!;
        await dialog.updateComplete;
        expect(
          dialog.shadowRoot!.querySelector("dialog")!.getAttribute("aria-labelledby"),
        ).toBeTruthy();
        const stop = dialog.querySelector<HTMLElementTagNameMap["wt-button"]>(
          "[data-test=permission-stop]",
        )!;
        await stop.updateComplete;
        expect(stop.shadowRoot!.querySelector("button")!.checkVisibility()).toBe(true);
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `__screenshots__/a1089-permission-${locale}-${theme}-${width}.png`,
        });
        const closed = new Promise<void>((resolve) =>
          dialog.addEventListener("wt-close", () => resolve(), { once: true }),
        );
        await userEvent.keyboard("{Escape}");
        await closed;
        await vi.waitFor(() =>
          expect(app.shadowRoot!.querySelector("[data-test=permission-sign-in]")).toBeNull(),
        );
        expect(invoker.shadowRoot!.activeElement).toBe(nativeInvoker);
        expect(moduleContext.permissionContinuation!.snapshot().authenticated).toBe(true);
      }
    },
  );
});
