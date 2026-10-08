import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { DashboardApp } from "./dashboard-app.js";
import type { DashboardApi } from "./api/client.js";
import { setLocale } from "./i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  sessionStorage.clear();
  localStorage.clear();
  setLocale("es-ES");
});

it("keeps touch nav rows at 44px and their chevrons visible without hover", async () => {
  await page.viewport(390, 844);
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  expect(matchMedia("(hover: none)").matches).toBe(true);
  const api = {
    getGoogleConfig: async () => ({ configured: false }),
    getMe: async () => ({
      personId: "p1",
      role: "manager",
      email: "manager@example.com",
      locale: null,
      venueLocale: "es-ES",
      sessionDefault: "es-ES",
      venueName: "Deli Test SL",
      onboardingIntent: "prepare",
      permissions: [],
      modules: [],
    }),
    getContentLanguages: async () => ({ defaultLanguage: "es", languages: ["es"] }),
    listAlerts: async () => ({ visible: false, alerts: [] }),
    getSalesOverview: async () => ({
      businessDay: "2026-08-30",
      takings: { tenderTotal: "0.00", tipTotal: "0.00", grossTotal: "0.00" },
      counts: { sales: 0, corrections: 0, voids: 0 },
      openTables: { open: 0, total: 0 },
      topSellers: [],
    }),
    getOverdueOrders: async () => ({ orders: [] }),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=nav-overview]")).not.toBeNull();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!.click();
  await el.updateComplete;
  const headers = el.shadowRoot!.querySelectorAll<HTMLElement>("button.nav-group");
  expect(headers.length).toBeGreaterThan(0);
  for (const header of headers) {
    expect(header.matches(":hover")).toBe(false);
    expect(header.matches(":focus-visible")).toBe(false);
    expect(header.getBoundingClientRect().height).toBe(44);
    expect(getComputedStyle(header.querySelector(".chevron")!).opacity).toBe("1");
  }
  expect(
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]")!.getBoundingClientRect()
      .height,
  ).toBe(44);
});
