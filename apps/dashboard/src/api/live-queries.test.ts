import { expect, it, vi } from "vitest";
import { DashboardApi } from "./client.js";
import { QUERY_DEPENDENCIES, dashboardQuery } from "./live-queries.js";

it("counts the initial screen read as activity and subsequent refreshes as passive", async () => {
  const fetchImpl = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
    async () => new Response("[]", { status: 200 }),
  );
  const active = vi.fn();
  const api = new DashboardApi("", fetchImpl, undefined, active);
  const query = dashboardQuery(api, "listPrinters", []);
  await query.read();
  expect(new Headers(fetchImpl.mock.calls[0]![1].headers).has("x-waitron-live")).toBe(false);
  await query.read();
  expect(new Headers(fetchImpl.mock.calls[1]![1].headers).get("x-waitron-live")).toBe("1");
  expect(active).toHaveBeenCalledOnce();
});

it.each([
  ["getOverdueOrders", [], "ticket_items"],
  ["getDailyClose", ["2026-09-11"], "sale_substitutions"],
  ["getDailyClose", ["2026-09-11"], "sale_lines"],
  ["getSalesPeriod", ["2026-09-01", "2026-09-11"], "sale_substitutions"],
  ["getPlannedVsActual", ["location", "2026-09-01", "2026-09-11"], "roster_versions"],
  ["listAlerts", [], "incidents"],
  ["listHandledAlerts", [], "incidents"],
  ["listHandledAlerts", [], "persons"],
  ["listStuckPayments", [], "payments"],
  ["listStuckPayments", [], "working_orders"],
  ["listStuckBillPayments", [], "bill_payments"],
  ["listStuckBillPayments", [], "payments"],
  ["listStuckBillRefunds", [], "bill_payments"],
  ["listStuckBillRefunds", [], "bill_payment_refunds"],
  ["listStuckBillRefunds", [], "payments"],
  ["listStuckBillRefunds", [], "working_orders"],
  ["listServers", [], "node_membership"],
  ["listServers", [], "nodes"],
] as const)(
  "refreshes %s when its contributing %s query changes through %s",
  async (name, args, type) => {
    const fetchImpl = vi.fn(async () => new Response("[]"));
    const api = new DashboardApi("", fetchImpl);
    const observed = api.liveData.observe(dashboardQuery(api, name, [...args]), () => {});
    try {
      await vi.waitFor(() => expect(observed.snapshot.status).toBe("ready"));
      api.liveData.invalidate([{ type, id: "changed-elsewhere" }]);
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    } finally {
      observed.unsubscribe();
    }
  },
);

it("refreshes the open alerts passively and when incidents change", async () => {
  const fetchImpl = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify({ visible: true, alerts: [] })),
  );
  const api = new DashboardApi("", fetchImpl);
  const query = dashboardQuery(api, "listAlerts", []);
  expect(query.dependencies).toEqual([{ type: "incidents" }]);
  expect(query.refreshMs).toBe(60_000);
  await query.read();
  await query.read();
  expect(new Headers(fetchImpl.mock.calls[1]![1].headers).get("x-waitron-live")).toBe("1");
});

it.each([
  // The list reads also count what carries each list (`listOptionLists` in
  // packages/catalogue/src/options.ts, `listExtraLists` in extras.ts).
  ["listOptionLists", [], ["option_lists", "option_labels", "product_modifiers"]],
  ["getOptionList", ["o1"], ["option_lists", "option_labels"]],
  [
    "listExtraLists",
    [],
    ["extra_lists", "extra_list_items", "product_modifiers", "menu_item_extra_lists"],
  ],
  ["getExtraList", ["e1"], ["extra_lists", "extra_list_items"]],
  ["listLibraryProducts", [], ["products"]],
  // `listSections` and `librarySectionUsages` (packages/catalogue/src/sections.ts); the usages
  // also name each menu from `catalogues`.
  ["listSections", [], ["sections", "section_members"]],
  ["listSectionUsages", [], ["sections", "section_members", "catalogues"]],
  // `readMenuStructure` reads the root from `menu_details`, then the whole section graph.
  ["getMenuStructure", ["menu-1"], ["menu_details", "sections", "section_members"]],
  [
    "getMenuPrices",
    ["menu-1"],
    [
      "menu_details",
      "sections",
      "section_members",
      "menu_items",
      "catalogues",
      "products",
      "menu_item_variant_overrides",
    ],
  ],
  // `listHomeLayouts` (packages/catalogue/src/home-layouts.ts): the menu's root and default from
  // `menu_details`, the section graph, and each tile's name from `products` or `sections`.
  ["listHomeLayouts", ["menu-1"], ["menu_details", "sections", "section_members", "products"]],
  // `deviceHomeLayouts` (the same file): every menu by name, each menu's layouts, and the choices.
  [
    "getDeviceHomeLayouts",
    ["dp-1"],
    ["device_profile_home_layouts", "sections", "menu_details", "catalogues"],
  ],
  // `computeCategorySales` (packages/reporting/src/category-sales.ts) reads the period's lines under
  // the same inclusion clauses as the other reports, on the venue clock from `locations`; current
  // mode adds today's classification (`currentClassifications`, packages/catalogue) named in the
  // saved default content language.
  [
    "getCategorySales",
    ["2026-09-01", "2026-09-11", "current", false],
    [
      "sales",
      "sale_lines",
      "sale_voids",
      "sale_substitutions",
      "locations",
      "products",
      "categories",
      "category_details",
      "content_languages",
    ],
  ],
  ["getReportPrinters", [], ["printers"]],
  // "Below it too" walks `category_details`' parent links (`listCategoryProducts`, categories.ts).
  [
    "listCategoryProducts",
    ["c1", { includeDescendants: true }],
    ["categories", "category_details", "products"],
  ],
] as const)(
  "subscribes %s to exactly the tables its read selects from",
  async (name, args, types) => {
    const query = dashboardQuery(new DashboardApi("", vi.fn()), name, [...args]);
    expect(query.dependencies).toEqual(types.map((type) => ({ type })));
  },
);

it("refreshes the bucket copy's settings every ten seconds, and depends on `backup_status` alone", () => {
  const query = dashboardQuery(new DashboardApi("", vi.fn()), "getStreamSettings", []);
  expect(query.dependencies).toEqual([{ type: "backup_status" }]);
  expect(query.refreshMs).toBe(10_000);
});

it("subscribes no read to the product label tables, which products no longer carry", () => {
  const named = Object.values(QUERY_DEPENDENCIES).flat();
  expect(named).not.toContain("labels");
  expect(named).not.toContain("product_labels");
});
