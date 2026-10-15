import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRequest } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import type { DashboardApi } from "./api/client.js";
import type { DashboardApp } from "./dashboard-app.js";
import "./dashboard-app.js";
import.meta.glob("./screens/attendance-corrections-screen.ts", { eager: true });
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en-GB");
});
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
async function mount(modules: string[], permissions: string[], role = "supervisor") {
  await page.viewport(1280, 900);
  history.replaceState(null, "", "/");
  const api = {
    getMe: vi.fn().mockResolvedValue({
      personId: "boss",
      role,
      email: "boss@example.com",
      locale: "en-GB",
      venueLocale: "es-ES",
      sessionDefault: "en-GB",
      venueName: "Deli",
      permissions,
      modules,
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getSalesOverview: vi.fn(() => new Promise(() => undefined)),
    listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
  } as unknown as DashboardApi;
  const requests: string[] = [];
  const request = createRequest({
    fetchImpl: async (path) => {
      requests.push(path);
      if (path.endsWith("/lookups"))
        return Response.json({
          viewer: { personId: "boss", canSelfApprove: false },
          locations: [{ id: "shop", name: "Deli", timeZone: "Europe/Madrid" }],
          people: [{ personId: "worker", displayName: "Ana" }],
        });
      if (path.includes("/queue?")) return Response.json({ locationId: "shop", items: [] });
      throw new Error(path);
    },
  });
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request });
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=nav-overview]")).not.toBeNull();
  return { el, requests };
}
it("a permitted supervisor opens the real workforce correction screen from Team", async () => {
  const { el, requests } = await mount(["workforce"], ["workforce.correct"]);
  const nav = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-time-corrections]");
  expect(nav).not.toBeNull();
  const team = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-group-team]")!;
  if (team.getAttribute("aria-expanded") === "false") await userEvent.click(team);
  await userEvent.click(nav!);
  const screen = el.shadowRoot!.querySelector("dashboard-attendance-corrections-screen")!;
  await expect.poll(() => screen.shadowRoot?.textContent).toContain("Time corrections");
  await expect.poll(() => requests.some((path) => path.includes("/attendance/queue?"))).toBe(true);
});
it.each([
  [[], ["workforce.correct"]],
  [["workforce"], []],
])(
  "hides corrections when the module or permission is absent: %j / %j",
  async (modules, permissions) => {
    const { el, requests } = await mount(modules, permissions);
    expect(el.shadowRoot!.querySelector("[data-test=nav-time-corrections]")).toBeNull();
    expect(el.shadowRoot!.querySelector("dashboard-attendance-corrections-screen")).toBeNull();
    expect(requests).toEqual([]);
  },
);
