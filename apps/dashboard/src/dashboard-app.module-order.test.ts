import { html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { DASHBOARD_MODULES } from "@waitron/dashboard-modules";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";
import type { DashboardApi } from "./api/client.js";
import "./dashboard-app.js";
import type { DashboardApp } from "./dashboard-app.js";

// The shipped registry has no two modules in one group that state an `order`, so the sort is
// exercised against a registry of its own.
function contribution(id: string, order?: number): DashboardContribution {
  return {
    module: id,
    screen: {
      id,
      navLabelKey: `nav.${id}`,
      group: "service",
      requiresPermission: "test.use",
      ...(order === undefined ? {} : { order }),
    },
    strings: { en: { [`nav.${id}`]: id }, es: { [`nav.${id}`]: id } },
    create: () => ({ render: () => html`<p>${id}</p>` }),
  } as DashboardContribution;
}

vi.mock("@waitron/dashboard-modules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@waitron/dashboard-modules")>()),
  DASHBOARD_MODULES: [
    contribution("second", 2),
    contribution("unordered"),
    contribution("first", 1),
  ],
}));

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

function stubApi(modules: string[] = ["second", "unordered", "first"]): DashboardApi {
  const pending = () => vi.fn(() => new Promise(() => undefined));
  return {
    getMe: vi.fn().mockResolvedValue({
      personId: "p1",
      role: "manager",
      email: "manager@example.com",
      locale: null,
      venueLocale: "es-ES",
      sessionDefault: "es-ES",
      venueName: "Deli Test SL",
      permissions: ["test.use"],
      modules,
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    getSalesOverview: pending(),
    listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
    getKitchenTimingDefaults: vi.fn().mockResolvedValue({
      warmAfterMinutes: 5,
      overdueAfterMinutes: 10,
      forgottenAfterMinutes: 15,
    }),
    setKitchenTimingDefaults: vi.fn().mockResolvedValue(undefined),
    getFireControl: vi.fn().mockResolvedValue({ enabled: false }),
    getBumpMode: vi.fn().mockResolvedValue({ mode: "line" }),
    listCourses: vi.fn().mockResolvedValue([]),
    listStatuses: vi.fn().mockResolvedValue([]),
  } as unknown as DashboardApi;
}

it("orders a group's module items by their stated order, an unstated order counting as zero", async () => {
  const { el } = await mountWidget<DashboardApp>("dashboard-app", {
    api: stubApi(),
    request: async () => [] as never,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("#nav-group-panel-service [data-test]")).not.toBeNull(),
  );
  const service = [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>("#nav-group-panel-service [data-test]"),
  ].map((item) => item.dataset.test);
  expect(service).toEqual(["nav-unordered", "nav-first", "nav-second"]);
});

it("sorts a group's core items among its module items by their order", async () => {
  const list = DASHBOARD_MODULES as unknown as DashboardContribution[];
  const original = [...list];
  list.length = 0;
  list.push(
    {
      ...contribution("before", 19),
      screen: { ...contribution("before", 19).screen, group: "operations" },
    },
    {
      ...contribution("after", 21),
      screen: { ...contribution("after", 21).screen, group: "operations" },
    },
  );
  try {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi(["before", "after"]),
      request: async () => [] as never,
    });
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector("#nav-group-panel-operations [data-test=nav-after]"),
      ).not.toBeNull(),
    );
    expect(
      [
        ...el.shadowRoot!.querySelectorAll<HTMLElement>("#nav-group-panel-operations [data-test]"),
      ].map((item) => item.dataset.test),
    ).toEqual(["nav-before", "nav-floor", "nav-after", "nav-venue-settings"]);
  } finally {
    list.length = 0;
    list.push(...original);
  }
});
