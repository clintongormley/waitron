import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseTheme, registerIcons, type WtButton } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { DashboardApp } from "../dashboard-app.js";
import type { VenueZoneRepair } from "./venue-zone-repair.js";
registerIcons(DASHBOARD_ICONS);
afterEach(() => {
  cleanupWidgets();
  chooseTheme("device");
  setLocale("es-ES");
});
for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280]) {
      it(`repairs accessibly in ${locale} ${theme} ${width}`, async () => {
        await page.viewport(width, 1100);
        setLocale(locale);
        chooseTheme(theme);
        let saved = false;
        const status = {
          nodeId: "node",
          legalName: "Deli Test SL",
          country: "ES",
          province: "08",
          category: "invalid",
          eligible: true,
          clockRevision: 4,
          choices: ["Europe/Madrid", "Atlantic/Canary"],
          suggestion: "Europe/Madrid",
          admission: { state: "invalid" },
          clock: { dayCutover: "06:00", cutoverChanges: [] },
        };
        const preview = {
          at: "2026-10-14T23:30:00.000Z",
          timeZone: "Europe/Madrid",
          civilDate: "2026-10-15",
          timeOfDay: "01:30:00",
          offsetMinutes: 120,
          businessDay: "2026-10-14",
          dayCutover: "06:00",
        };
        const api = {
          getMe: vi.fn().mockResolvedValue({
            personId: "manager",
            role: "manager",
            email: "manager@example.test",
            locale,
            venueLocale: locale,
            sessionDefault: locale,
            permissions: ["venue.configure"],
            modules: [],
            venueName: "Deli Test SL",
            tradingAdmission: { state: "invalid" },
          }),
          getLocales: vi.fn().mockResolvedValue({
            loginDefault: locale,
            venueDefault: locale,
            venueName: "Deli Test SL",
            locales: [],
          }),
          getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
          getVenueZoneRepair: vi.fn(async (zone?: string) => {
            if (saved) throw { code: "connection.failed" };
            return zone ? { ...status, preview } : status;
          }),
          confirmVenueZone: vi.fn(async () => {
            saved = true;
            return { repaired: true, clockRevision: 5, admission: "restart_required" };
          }),
          passkeyAuthOptions: vi.fn(),
        } as unknown as DashboardApi;
        const { el: app, host } = await mountWidget<DashboardApp>(
          "dashboard-app",
          { api, reload: vi.fn() },
          theme,
        );
        await expect
          .poll(() => app.shadowRoot!.querySelector("dashboard-venue-zone-repair"))
          .not.toBeNull();
        const editor = app.shadowRoot!.querySelector<VenueZoneRepair>(
          "dashboard-venue-zone-repair",
        )!;
        await expect.poll(() => editor.shadowRoot!.querySelector("[name=timeZone]")).not.toBeNull();
        const snapshot = async (state: string) => {
          await editor.updateComplete;
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `__screenshots__/a696-task9/${locale}-${theme}-${width}-${state}.png`,
            fullPage: true,
          });
        };
        if (width === 1280) expect(editor.getBoundingClientRect().width).toBeLessThanOrEqual(600);
        await snapshot("initial");
        editor.shadowRoot!.querySelector("[name=timeZone]")!.dispatchEvent(
          new CustomEvent("wt-change", {
            detail: { value: "Europe/Madrid" },
            bubbles: true,
            composed: true,
          }),
        );
        await expect
          .poll(() => editor.shadowRoot!.querySelector("[data-test=preview]"))
          .not.toBeNull();
        await userEvent.click(editor.shadowRoot!.querySelector<WtButton>("[data-test=save]")!);
        await expect
          .poll(() => editor.shadowRoot!.querySelector("[data-test=confirmation-error]"))
          .not.toBeNull();
        await snapshot("error");
        editor
          .shadowRoot!.querySelector("[name=confirmed]")!
          .shadowRoot!.querySelector<HTMLInputElement>("input")!
          .focus();
        await userEvent.keyboard(" ");
        await editor.updateComplete;
        await snapshot("preview");
        await userEvent.click(editor.shadowRoot!.querySelector<WtButton>("[data-test=save]")!);
        await expect
          .poll(() => editor.shadowRoot!.querySelector("[data-test=load-error]"))
          .not.toBeNull();
        await snapshot("restart-load-failure");
        expect(api.confirmVenueZone).toHaveBeenCalledTimes(1);
        expect(api.passkeyAuthOptions).not.toHaveBeenCalled();
      });
    }
