import { afterEach, beforeEach, expect, it } from "vitest";
import { registerIcons, type WtIcon } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { DashboardApp } from "./dashboard-app.js";
import type { DashboardApi } from "./api/client.js";
import { DASHBOARD_ICONS } from "./icons.js";
import { setLocale } from "./i18n/t.js";

const SECTION_ICONS = {
  reports: "section-reports",
  service: "section-service",
  menu: "section-menu",
  operations: "section-operations",
  team: "section-team",
  purchasing: "section-purchasing",
  configuration: "gear",
} as const;

beforeEach(() => registerIcons(DASHBOARD_ICONS));

afterEach(() => {
  cleanupWidgets();
  sessionStorage.clear();
  localStorage.clear();
  setLocale("es-ES");
});

/** A manager with the bookings module, so every headed section has a page to show. */
function stubApi(): DashboardApi {
  return {
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
      permissions: ["booking.manage"],
      modules: ["bookings"],
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
}

async function mountApp() {
  const mounted = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
  await expect
    .poll(() => mounted.el.shadowRoot!.querySelector("[data-test=nav-overview]"))
    .not.toBeNull();
  await mounted.el.updateComplete;
  return mounted;
}

it("draws each headed section icon on its header, from a registered path", async () => {
  const { el } = await mountApp();
  const headers = [...el.shadowRoot!.querySelectorAll<HTMLElement>("button.nav-group")];
  expect(headers.map((header) => header.dataset.test)).toEqual(
    Object.keys(SECTION_ICONS).map((id) => `nav-group-${id}`),
  );
  for (const [id, name] of Object.entries(SECTION_ICONS)) {
    const header = el.shadowRoot!.querySelector(`[data-test=nav-group-${id}]`)!;
    const icon = header.querySelector<WtIcon>("wt-icon.group-icon");
    expect(icon?.getAttribute("name"), id).toBe(name);
    await icon!.updateComplete;
    const d = icon!.shadowRoot!.querySelector("svg path")?.getAttribute("d");
    expect(d, id).toBe(DASHBOARD_ICONS[name]);
    expect(d, id).toBeTruthy();
  }
});

it("draws the section icons in the text colour, not the header label's primary colour", async () => {
  const { el, host } = await mountApp();
  host.style.setProperty("--wt-color-text", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-primary-text", "rgb(4, 5, 6)");
  for (const id of Object.keys(SECTION_ICONS)) {
    const header = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=nav-group-${id}]`)!;
    const icon = header.querySelector<HTMLElement>("wt-icon.group-icon")!;
    expect(getComputedStyle(icon).color, id).toBe("rgb(1, 2, 3)");
    expect(getComputedStyle(header.querySelector(".nav-group-label")!).color, id).toBe(
      "rgb(4, 5, 6)",
    );
  }
});
