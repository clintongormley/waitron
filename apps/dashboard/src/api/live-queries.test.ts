import { expect, it, vi } from "vitest";
import { DashboardApi } from "./client.js";
import { dashboardQuery } from "./live-queries.js";

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
  ["listOptionLists", [], ["option_lists", "option_labels"]],
  ["getOptionList", ["o1"], ["option_lists", "option_labels"]],
  ["listExtraLists", [], ["extra_lists", "extra_list_items"]],
  ["getExtraList", ["e1"], ["extra_lists", "extra_list_items"]],
  // A label's product count is read from `product_labels` (`listLabels`, packages/catalogue/src/labels.ts).
  ["listLabels", [], ["labels", "product_labels"]],
  ["getProductLabels", ["p1"], ["products", "product_labels"]],
  ["listLibraryProducts", [], ["products", "product_labels"]],
  // `listSections` and `librarySectionUsages` (packages/catalogue/src/sections.ts); the usages
  // also name each menu from `catalogues`.
  ["listSections", [], ["sections", "section_members"]],
  ["listSectionUsages", [], ["sections", "section_members", "catalogues"]],
  // "Below it too" walks `category_details`' parent links (`listCategoryProducts`, categories.ts).
  [
    "listCategoryProducts",
    ["c1", { includeDescendants: true }],
    ["categories", "category_details", "products", "product_labels"],
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
