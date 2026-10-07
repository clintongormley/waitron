import { expect, it, vi } from "vitest";
import { venueDetailsFixture } from "../testing/venue-details-fixture.js";
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
  ["listOrderPages", [{ status: "all", anyDate: false, credited: false }, 1], "working_orders"],
  ["listOrderPages", [{ status: "all", anyDate: false, credited: false }, 1], "bill_payments"],
  ["getOrder", ["bill-1"], "receipt_reprints"],
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
  ["getReceiptLanguage", [], "locations"],
  ["getBumpMode", [], "locations"],
] as const)(
  "refreshes %s when its contributing %s query changes through %s",
  async (name, args, type) => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          name === "listOrderPages"
            ? JSON.stringify({ rows: [], next: null, from: null, to: null })
            : "[]",
        ),
    );
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
  ["listExtraLists", [], ["extra_lists", "extra_list_items", "product_modifiers"]],
  ["getExtraList", ["e1"], ["extra_lists", "extra_list_items"]],
  ["listLibraryProducts", [], ["products"]],
  // `readMenuStructure` reads the root from `menu_details`, then the whole section graph.
  ["getMenuStructure", ["menu-1"], ["menu_details", "sections", "section_members", "catalogues"]],
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
      "content_languages",
      "product_modifiers",
      "extra_lists",
      "extra_list_items",
      "option_lists",
      "option_labels",
      "product_units",
      "units",
    ],
  ],
  // `readMenuHome` (packages/catalogue/src/menu-home.ts): the details row, the section graph with
  // its menus, and each shortcut's name from `products` or `sections`.
  [
    "getMenuHome",
    ["menu-1"],
    ["menu_details", "sections", "section_members", "products", "catalogues"],
  ],
  // `/management-api/printer-profiles` (apps/server/src/print-api.ts): the list rows, joined to
  // their profile. Not `devices`, which a device's heartbeat changes every minute.
  ["listPrinterProfiles", [], ["device_profile_printers", "device_profiles"]],
  // `readProfileKitchenLists` (packages/venue-service/src/profile-access.ts): the list rows of
  // live profiles, filtered and ordered by the station and watcher rows they name.
  [
    "listProfileKitchenLists",
    [],
    [
      "device_profiles",
      "device_profile_stations",
      "device_profile_watchers",
      "kitchen_stations",
      "watchers",
    ],
  ],
  // `computeCategorySales` (packages/reporting/src/category-sales.ts) reads the period's lines under
  // the same inclusion clauses as the other reports, on the venue clock from `locations`; current
  // mode adds today's classification (`currentClassifications`, packages/catalogue).
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
    ],
  ],
  // At time of sale names each line's category from the snapshot the line recorded, so no
  // catalogue table moves the answer.
  [
    "getCategorySales",
    ["2026-09-01", "2026-09-11", "at_time_of_sale", false],
    ["sales", "sale_lines", "sale_voids", "sale_substitutions", "locations"],
  ],
  ["getReportPrinters", [], ["printers"]],
  // A device's ask also carries a returning device's own row and whether its profile was retired
  // (`returningDevicesOf`, apps/server/src/join-requests.ts).
  ["joinRequests", ["device"], ["join_requests", "devices", "device_profiles"]],
  // A print agent's ask reads no `devices` or `device_profiles` row; a stored battery report
  // rewrites a `devices` row.
  ["joinRequests", ["print_agent"], ["join_requests"]],
  // The server works the rules out once at boot, so no table change moves them.
  ["getContentLanguageRules", [], []],
  // `listTranslationGapReport` (packages/catalogue/src/content-translation-report.ts): the setting,
  // then each table it names a row from.
  [
    "getContentTranslationGaps",
    [],
    [
      "content_languages",
      "products",
      "option_lists",
      "option_labels",
      "extra_lists",
      "sections",
      "section_members",
      "catalogues",
      "units",
    ],
  ],
] as const)(
  "subscribes %s %j to exactly the tables its read selects from",
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

it("reads the course list again when a course or a product changes, never on an order's lines", () => {
  const query = dashboardQuery(new DashboardApi("", vi.fn()), "listCoursesWithDisabled", []);
  expect(query.dependencies).toEqual([{ type: "kitchen_courses" }, { type: "products" }]);
});

it("subscribes no read to the product label tables, which products no longer carry", () => {
  const named = Object.values(QUERY_DEPENDENCIES).flat();
  expect(named).not.toContain("labels");
  expect(named).not.toContain("product_labels");
});

it.each(["getMenuPrices", "getMenuStatus", "getMenuStatuses", "getMenuPreview"] as const)(
  "refreshes %s after an included menu's decision changes",
  async (name) => {
    const fetchImpl = vi.fn(async () => new Response("[]"));
    const api = new DashboardApi("", fetchImpl);
    const args: [] | [string] = name === "getMenuStatuses" ? [] : ["parent"];
    const observed = api.liveData.observe(dashboardQuery(api, name, args), () => {});
    try {
      await vi.waitFor(() => expect(observed.snapshot.status).toBe("ready"));
      for (const type of [
        "menu_items",
        "menu_item_variant_overrides",
        "catalogues",
        "sections",
        "section_members",
      ]) {
        const before = fetchImpl.mock.calls.length;
        api.liveData.invalidate([{ type, id: "included-menu-record" }]);
        await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(before + 1));
      }
    } finally {
      observed.unsubscribe();
    }
  },
);

it.each(["getMenuStatus", "getMenuStatuses", "getMenuPreview"] as const)(
  "refreshes %s when a category changes, since a category's colour is part of each offer's",
  async (name) => {
    const fetchImpl = vi.fn(async () => new Response("[]"));
    const api = new DashboardApi("", fetchImpl);
    const args: [] | [string] = name === "getMenuStatuses" ? [] : ["lunch"];
    const observed = api.liveData.observe(dashboardQuery(api, name, args), () => {});
    try {
      await vi.waitFor(() => expect(observed.snapshot.status).toBe("ready"));
      for (const type of ["categories", "category_details"]) {
        const before = fetchImpl.mock.calls.length;
        api.liveData.invalidate([{ type, id: "soft-drinks" }]);
        await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(before + 1));
      }
    } finally {
      observed.unsubscribe();
    }
  },
);

it("leaves the category report at time of sale alone when the catalogue is edited", async () => {
  const fetchImpl = vi.fn(async () => new Response("{}"));
  const api = new DashboardApi("", fetchImpl);
  const query = dashboardQuery(api, "getCategorySales", [
    "2026-09-01",
    "2026-09-11",
    "at_time_of_sale",
    false,
  ]);
  const observed = api.liveData.observe(query, () => {});
  try {
    await vi.waitFor(() => expect(observed.snapshot.status).toBe("ready"));
    for (const type of ["products", "categories", "category_details"]) {
      api.liveData.invalidate([{ type, id: "edited" }]);
      await new Promise((settle) => setTimeout(settle, 0));
      expect(observed.snapshot.loading).toBe(false);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    api.liveData.invalidate([{ type: "sales", id: "sold" }]);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  } finally {
    observed.unsubscribe();
  }
});

it.each(["locations", "tenants", "sales", "working_orders", "daily_closes"])(
  "refreshes venue details passively after %s changes, retaining active PATCH activity",
  async (type) => {
    const model = venueDetailsFixture();
    const afterSale = {
      ...model,
      hasSales: true,
      policy: {
        ...model.policy,
        province: { decision: "refuse", reasons: ["sales"] },
        timeZone: { decision: "refuse", reasons: ["sales"] },
        dayCutover: { decision: "refuse", reasons: ["sales"] },
      },
    };
    let reads = 0;
    const fetchImpl = vi.fn(async (_path: string, init: RequestInit) => {
      if (init.method === "PATCH") return new Response(JSON.stringify({ changed: false, model }));
      reads++;
      return new Response(JSON.stringify(reads === 1 ? model : afterSale));
    });
    const active = vi.fn();
    const api = new DashboardApi("", fetchImpl, undefined, active);
    const query = dashboardQuery(api, "getVenueDetails", []);
    expect(query.dependencies).toEqual([
      { type: "locations" },
      { type: "tenants" },
      { type: "sales" },
      { type: "working_orders" },
      { type: "daily_closes" },
    ]);
    const observed = api.liveData.observe(query, () => {});
    try {
      await vi.waitFor(() => expect(observed.snapshot.status).toBe("ready"));
      expect(observed.snapshot.value).toEqual(model);
      api.liveData.invalidate([{ type, id: "another-client" }]);
      await vi.waitFor(() => expect(observed.snapshot.value).toEqual(afterSale));
      expect(fetchImpl.mock.calls.map(([path, init]) => [path, init.method])).toEqual([
        ["/management-api/venue-details", "GET"],
        ["/management-api/venue-details", "GET"],
      ]);
      expect(new Headers(fetchImpl.mock.calls[0]![1].headers).has("x-waitron-live")).toBe(false);
      expect(new Headers(fetchImpl.mock.calls[1]![1].headers).get("x-waitron-live")).toBe("1");
      expect(active).toHaveBeenCalledTimes(1);
      expect(
        await api.background.patchVenueDetails({
          changes: {},
          expected: venueDetailsFixture().details,
        }),
      ).toEqual({ changed: false, model });
      expect(new Headers(fetchImpl.mock.calls[2]![1].headers).has("x-waitron-live")).toBe(false);
      expect(active).toHaveBeenCalledTimes(1);
      expect(await api.patchVenueDetails({ changes: {}, expected: model.details })).toEqual({
        changed: false,
        model,
      });
      expect(new Headers(fetchImpl.mock.calls[3]![1].headers).has("x-waitron-live")).toBe(false);
      expect(active).toHaveBeenCalledTimes(2);
    } finally {
      observed.unsubscribe();
    }
  },
);

it("reads a shared menu snapshot through one encoded GET, preserving independent refusals", async () => {
  const paths: string[] = [];
  const headers: Headers[] = [];
  const response = {
    structure: { status: 200, body: { rootSectionId: "root" } },
    home: { status: 200, body: { handheld: { columns: 5 } } },
    status: {
      status: 409,
      body: { error: { code: "menu.reset_required", params: { menuId: "menu&one" } } },
    },
  };
  const api = new DashboardApi("", async (path, init) => {
    paths.push(path);
    headers.push(new Headers(init.headers));
    return Response.json(response);
  });
  const query = dashboardQuery(api, "getMenuRead", ["menu&one", ["structure", "home", "status"]]);
  expect(await query.read()).toEqual(response);
  expect(paths).toEqual([
    "/management-api/catalogues/menu%26one/read?part=structure&part=home&part=status",
  ]);
  expect(headers[0]!.has("x-waitron-live")).toBe(false);
  expect(await query.read()).toEqual(response);
  expect(headers[1]!.get("x-waitron-live")).toBe("1");
});

it("refreshes the shared menu snapshot for product and publication changes", async () => {
  let columns = 3;
  const reads: string[] = [];
  const api = new DashboardApi("", async (path) => {
    reads.push(path);
    return Response.json({ home: { status: 200, body: { handheld: { columns } } } });
  });
  const observed = api.liveData.observe(
    dashboardQuery(api, "getMenuRead", ["menu-1", ["home", "preview"]]),
    () => {},
  );
  try {
    await vi.waitFor(() => expect(observed.snapshot.status).toBe("ready"));
    columns = 5;
    api.liveData.invalidate([{ type: "products", id: "changed-product" }]);
    await vi.waitFor(() =>
      expect(observed.snapshot.value).toEqual({
        home: { status: 200, body: { handheld: { columns: 5 } } },
      }),
    );
    columns = 6;
    api.liveData.invalidate([{ type: "menu_publications" }]);
    await vi.waitFor(() =>
      expect(observed.snapshot.value).toEqual({
        home: { status: 200, body: { handheld: { columns: 6 } } },
      }),
    );
    expect(reads).toHaveLength(3);
  } finally {
    observed.unsubscribe();
  }
});

it("does not subscribe a Structure-only shared read to unrelated publication tables", () => {
  const api = new DashboardApi("", async () => Response.json({}));
  const query = dashboardQuery(api, "getMenuRead", ["menu-1", ["structure"]]);
  expect(query.dependencies).toEqual([
    { type: "menu_details" },
    { type: "sections" },
    { type: "section_members" },
    { type: "catalogues" },
  ]);
});

it("subscribes catalogue defaults to their stored settings", async () => {
  const api = new DashboardApi(
    "",
    async () => new Response('{"defaultProductVatClass":"reduced"}'),
  );
  const query = dashboardQuery(api, "getCatalogueSettings", []);
  expect(query.dependencies).toEqual([{ type: "catalogue_settings" }]);
  expect(await query.read()).toEqual({ defaultProductVatClass: "reduced" });
});
