import type { DeleteImpact } from "@waitron/shared";
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

it("reads a printer's delete impact passively after the first read, and sends its delete as activity", async () => {
  const impact = { target: { id: "p1", name: "Cocina" }, refusals: [], ends: [], removes: [] };
  const fetchImpl = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(impact), { status: 200 }),
  );
  const active = vi.fn();
  const api = new DashboardApi("", fetchImpl, undefined, active);
  const query = dashboardQuery(api, "getPrinterDeleteImpact", ["p1"]);
  expect(await query.read()).toEqual(impact);
  await query.read();
  expect(fetchImpl.mock.calls[1]![0]).toBe("/management-api/printers/p1/delete-impact");
  expect(fetchImpl.mock.calls[1]![1].method).toBe("GET");
  expect(new Headers(fetchImpl.mock.calls[1]![1].headers).get("x-waitron-live")).toBe("1");
  expect(active).toHaveBeenCalledOnce();

  expect(await api.deletePrinter("p1")).toEqual(impact);
  expect(fetchImpl.mock.calls[2]![0]).toBe("/management-api/printers/p1");
  expect(fetchImpl.mock.calls[2]![1].method).toBe("DELETE");
  expect(new Headers(fetchImpl.mock.calls[2]![1].headers).has("x-waitron-live")).toBe(false);
  expect(active).toHaveBeenCalledTimes(2);
});

it("reads a device's delete impact passively after the first read, and sends its delete as activity", async () => {
  const impact = { target: { id: "d1", name: "Bar till" }, refusals: [], ends: [], removes: [] };
  const fetchImpl = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(impact), { status: 200 }),
  );
  const active = vi.fn();
  const api = new DashboardApi("", fetchImpl, undefined, active);
  const query = dashboardQuery(api, "getDeviceDeleteImpact", ["d1"]);
  expect(await query.read()).toEqual(impact);
  await query.read();
  expect(fetchImpl.mock.calls[1]![0]).toBe("/management-api/devices/d1/delete-impact");
  expect(fetchImpl.mock.calls[1]![1].method).toBe("GET");
  expect(new Headers(fetchImpl.mock.calls[1]![1].headers).get("x-waitron-live")).toBe("1");
  expect(active).toHaveBeenCalledOnce();

  expect(await api.deleteDevice("d1")).toEqual(impact);
  expect(fetchImpl.mock.calls[2]![0]).toBe("/management-api/devices/d1");
  expect(fetchImpl.mock.calls[2]![1].method).toBe("DELETE");
  expect(new Headers(fetchImpl.mock.calls[2]![1].headers).has("x-waitron-live")).toBe(false);
  expect(active).toHaveBeenCalledTimes(2);
});

it("reads a card reader's delete impact passively after the first read, and sends its delete as activity", async () => {
  const impact = { target: { id: "r1", name: "Barra" }, refusals: [], ends: [], removes: [] };
  const fetchImpl = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(impact), { status: 200 }),
  );
  const active = vi.fn();
  const api = new DashboardApi("", fetchImpl, undefined, active);
  const query = dashboardQuery(api, "getReaderDeleteImpact", ["r1"]);
  expect(await query.read()).toEqual(impact);
  await query.read();
  expect(fetchImpl.mock.calls[1]![0]).toBe("/management-api/payments/readers/r1/delete-impact");
  expect(fetchImpl.mock.calls[1]![1].method).toBe("GET");
  expect(new Headers(fetchImpl.mock.calls[1]![1].headers).get("x-waitron-live")).toBe("1");
  expect(active).toHaveBeenCalledOnce();

  expect(await api.deleteReader("r1")).toEqual(impact);
  expect(fetchImpl.mock.calls[2]![0]).toBe("/management-api/payments/readers/r1");
  expect(fetchImpl.mock.calls[2]![1].method).toBe("DELETE");
  expect(new Headers(fetchImpl.mock.calls[2]![1].headers).has("x-waitron-live")).toBe(false);
  expect(await api.deleteReader("r1", { acceptRegistrationKept: true })).toEqual(impact);
  expect(fetchImpl.mock.calls[3]![0]).toBe(
    "/management-api/payments/readers/r1?acceptRegistrationKept=true",
  );
  expect(fetchImpl.mock.calls[3]![1].method).toBe("DELETE");
  expect(active).toHaveBeenCalledTimes(3);
});

it.each([
  ["listMyShifts", ["2026-05-04", "2026-05-11"], "roster_versions"],
  ["listOrderPages", [{ status: "all", anyDate: false, credited: false }, 1], "working_orders"],
  ["listOrderPages", [{ status: "all", anyDate: false, credited: false }, 1], "bill_payments"],
  ["getOrder", ["bill-1"], "receipt_reprints"],
  ["getOrder", ["bill-1"], "invoice_deliveries"],
  ["getOrder", ["bill-1"], "invoice_pdf_downloads"],
  ["getOrder", ["bill-1"], "page_printers"],
  ["getOverdueOrders", [], "ticket_items"],
  ["getOverdueOrders", [], "party_tables"],
  ["getOverdueOrders", [], "parties"],
  ["getOverdueOrders", [], "floor_today_tables"],
  ["getOverdueOrders", [], "floor_today_join_tables"],
  ["getOverdueOrders", [], "floor_today_joins"],
  ["getDailyClose", ["2026-09-11"], "sale_substitutions"],
  ["getDailyClose", ["2026-09-11"], "sale_lines"],
  ["getSalesPeriod", ["2026-09-01", "2026-09-11"], "sale_substitutions"],
  ["getPlannedVsActual", ["location", "2026-09-01", "2026-09-11"], "roster_versions"],
  ["listAlerts", [], "incidents"],
  ["listAlerts", [], "content_suggestion_jobs"],
  ["listAlerts", [], "content_suggestions"],
  ["getContentSuggestions", ["es"], "content_suggestions"],
  ["getContentSuggestions", ["es"], "content_suggestion_jobs"],
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
  ["listReaders", [], "devices"],
  ["listReaders", [], "device_profile_card_readers"],
  ["listServers", [], "node_membership"],
  ["listServers", [], "nodes"],
  ["getReceiptLanguage", [], "locations"],
  ["getVenueDefaults", [], "locations"],
  ["getVenueDefaults", [], "catalogue_settings"],
  ["getBumpMode", [], "locations"],
  ["getFloorPlan", ["z1"], "floor_plans"],
  ["getFloorPlan", ["z1"], "floor_plan_tables"],
  ["getFloorPlan", ["z1"], "floor_plan_table_parts"],
  ["getFloorPlan", ["z1"], "dining_tables"],
  ["getFloorPlan", ["z1"], "floor_plan_table_sizes"],
  ["getSalesOverview", [], "floor_reset_tables"],
  ["getSalesOverview", [], "floor_reset_table_parts"],
  ["getSalesOverview", [], "floor_today_join_tables"],
  ["getSalesOverview", [], "floor_today_split_parts"],
  ["getSalesOverview", [], "party_tables"],
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
  expect(query.dependencies).toEqual([
    { type: "incidents" },
    { type: "content_suggestion_jobs" },
    { type: "content_suggestions" },
  ]);
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
  // `printerDeleteRules` (apps/server/src/printer-delete.ts): the printer, its live jobs and
  // invoice receipts, its holder, the devices choosing or inheriting it and the profile rows they
  // inherit through, and the stations it prints for, each named.
  [
    "getPrinterDeleteImpact",
    ["p1"],
    [
      "printers",
      "print_jobs",
      "invoice_deliveries",
      "printer_holders",
      "devices",
      "device_profiles",
      "device_profile_printers",
      "kitchen_stations",
      "station_printers",
    ],
  ],
  // `deviceDeleteRules` (apps/server/src/device-delete.ts): the device, its pending payments and
  // their orders, the printers and readers it holds, its join request, and the printers,
  // stations, profiles, reader and kitchen screens it names. Not `sessions`, which no module
  // declares as a live resource.
  [
    "getDeviceDeleteImpact",
    ["d1"],
    [
      "devices",
      "payments",
      "bill_payments",
      "bill_payment_refunds",
      "working_orders",
      "printer_holders",
      "printers",
      "card_reader_holders",
      "card_readers",
      "join_requests",
      "device_made_here_stations",
      "kitchen_stations",
      "device_approved_profiles",
      "device_profiles",
      "device_card_readers",
      "device_kitchen_screens",
    ],
  ],
  // `cardReaderDeleteRules` (apps/server/src/card-reader-delete.ts): the reader, its payments in
  // progress, and the devices, profiles and holders it would be taken from, each named. The
  // provider check reads `tenant_credentials`, which no module declares as a live resource.
  [
    "getReaderDeleteImpact",
    ["r1"],
    [
      "card_readers",
      "payments",
      "devices",
      "device_profiles",
      "device_card_readers",
      "device_profile_card_readers",
      "card_reader_holders",
    ],
  ],
  // `readProfileKitchenScreens` (packages/venue-service/src/kitchen-screens.ts): each profile's
  // rows and lists, joined to the stations and zones they name.
  [
    "listProfileKitchenScreens",
    [],
    [
      "device_profiles",
      "device_profile_kitchen_screens",
      "device_profile_kitchen_screen_stations",
      "device_profile_kitchen_screen_zones",
      "kitchen_stations",
      "floor_zones",
    ],
  ],
  // `GET /management-api/devices` (apps/server/src/device-api.ts): each device with its profile,
  // equipment and kitchen screens, which `readDevicesKitchenScreens`
  // (packages/venue-service/src/kitchen-screens.ts) resolves against the profile's lists, the
  // stations and zones, and what narrowings took. No watchers: a device no longer holds one.
  [
    "listDevices",
    [],
    [
      "devices",
      "device_profiles",
      "kitchen_stations",
      "device_made_here_stations",
      "device_approved_profiles",
      "printer_holders",
      "card_reader_holders",
      "device_card_readers",
      "device_profile_printers",
      "device_profile_card_readers",
      "printers",
      "page_printers",
      "card_readers",
      "device_kitchen_screens",
      "device_kitchen_screen_stations",
      "device_kitchen_screen_zones",
      "device_kitchen_screen_removals",
      "device_profile_kitchen_screens",
      "device_profile_kitchen_screen_stations",
      "device_profile_kitchen_screen_zones",
      "floor_zones",
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
      "location_business_day_settings",
      "location_day_cutover_changes",
    ],
  ],
  // At time of sale names each line's category from the snapshot the line recorded, so no
  // catalogue table moves the answer.
  [
    "getCategorySales",
    ["2026-09-01", "2026-09-11", "at_time_of_sale", false],
    [
      "sales",
      "sale_lines",
      "sale_voids",
      "sale_substitutions",
      "locations",
      "location_business_day_settings",
      "location_day_cutover_changes",
    ],
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

it("reads the active course list on course changes alone", () => {
  const query = dashboardQuery(new DashboardApi("", vi.fn()), "listCourses", []);
  expect(query.dependencies).toEqual([{ type: "kitchen_courses" }]);
});

it("reads the folders' Made at again when a routing cell's period lines change", () => {
  const query = dashboardQuery(new DashboardApi("", vi.fn()), "getFolderRouting", []);
  expect(query.dependencies).toContainEqual({ type: "routing_cell_periods" });
});

it("reads the folders' Made at again when a zone's department changes", () => {
  const query = dashboardQuery(new DashboardApi("", vi.fn()), "getFolderRouting", []);
  expect(query.dependencies).toContainEqual({ type: "zone_service_policies" });
});

it("reads the folders' Made at again when a season week changes", () => {
  const query = dashboardQuery(new DashboardApi("", vi.fn()), "getFolderRouting", []);
  for (const type of [
    "seasons",
    "department_days",
    "department_day_ranges",
    "zone_days",
    "zone_day_ranges",
  ])
    expect(query.dependencies).toContainEqual({ type });
});

it("reads the folders' Made at again when a special day or one of its dates changes", () => {
  const query = dashboardQuery(new DashboardApi("", vi.fn()), "getFolderRouting", []);
  for (const type of ["special_days", "special_day_dates"])
    expect(query.dependencies).toContainEqual({ type });
});

it("reads the folders' Made at again when a period, its department or the products its menus reach change", () => {
  const query = dashboardQuery(new DashboardApi("", vi.fn()), "getFolderRouting", []);
  for (const type of [
    "menu_periods",
    "menu_period_staff_menus",
    "departments",
    "sections",
    "section_members",
    "catalogues",
  ])
    expect(query.dependencies).toContainEqual({ type });
});

it("subscribes no read to the retired watcher tables, and has no watcher list", () => {
  const named = Object.values(QUERY_DEPENDENCIES).flat();
  for (const table of ["watchers", "watcher_stations", "watcher_zones", "watcher_printers"]) {
    expect(named).not.toContain(table);
  }
  expect(Object.keys(QUERY_DEPENDENCIES)).not.toContain("listWatchers");
  expect(QUERY_DEPENDENCIES.listPrinters).toEqual(["printers", "print_jobs", "printer_holders"]);
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

it.each(["getMenuStatus", "getMenuStatuses", "getMenuPreview"] as const)(
  "refreshes %s when the catalogue settings change, since the venue default colour ends each offer's colour walk",
  async (name) => {
    const fetchImpl = vi.fn(async () => new Response("[]"));
    const api = new DashboardApi("", fetchImpl);
    const args: [] | [string] = name === "getMenuStatuses" ? [] : ["lunch"];
    const observed = api.liveData.observe(dashboardQuery(api, name, args), () => {});
    try {
      await vi.waitFor(() => expect(observed.snapshot.status).toBe("ready"));
      const before = fetchImpl.mock.calls.length;
      api.liveData.invalidate([{ type: "catalogue_settings", id: "1" }]);
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(before + 1));
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
      { type: "location_business_day_settings" },
      { type: "location_day_cutover_changes" },
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

it("subscribes the venue defaults to the location and the catalogue settings alone", () => {
  const api = new DashboardApi("", async () => new Response("{}"));
  expect(dashboardQuery(api, "getVenueDefaults", []).dependencies).toEqual([
    { type: "locations" },
    { type: "catalogue_settings" },
  ]);
});

it.each([
  "content_languages",
  "products",
  "option_lists",
  "option_labels",
  "extra_lists",
  "sections",
  "section_members",
  "menu_details",
  "catalogues",
  "units",
])("refreshes translation targets passively when %s changes", async (type) => {
  const calls: RequestInit[] = [];
  const api = new DashboardApi("", async (_path, init) => {
    calls.push(init);
    return new Response(
      JSON.stringify({
        language: "en",
        config: { defaultLanguage: "es", languages: ["es", "en"] },
        required: [],
        rows: [],
        next: null,
        total: 0,
      }),
    );
  });
  const observed = api.liveData.observe(
    dashboardQuery(api, "getContentTranslationTargets", ["en", {}]),
    () => {},
  );
  try {
    await vi.waitFor(() => expect(observed.snapshot.status).toBe("ready"));
    api.liveData.invalidate([{ type, id: "changed-elsewhere" }]);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(new Headers(calls[1]!.headers).get("x-waitron-live")).toBe("1");
  } finally {
    observed.unsubscribe();
  }
});

it.each(["getFolderRouting", "listMadeAt"] as const)(
  "%s ignores retired station sources and applies current station changes",
  async (name) => {
    let station = "bar";
    const value = () =>
      name === "listMadeAt"
        ? {
            cocktail: {
              stationId: station,
              stationName: station,
              noPreparation: false,
              noReplacement: false,
              unavailableStationId: null,
              variesByZone: false,
            },
          }
        : {
            stationTimes: [],
            todayEnds: null,
            clockReadable: true,
            zones: [],
            categories: [],
            products: [],
            cells: [],
            defaultStationId: station,
            stations: [{ id: station, name: station, active: true }],
            canMakeDefault: true,
          };
    const fetchImpl = vi.fn(async () => Response.json(value()));
    const api = new DashboardApi("", fetchImpl);
    const observed = api.liveData.observe(dashboardQuery(api, name, []), () => {});
    try {
      await vi.waitFor(() => expect(observed.snapshot.value).toEqual(value()));
      station = "kitchen";
      for (const type of [
        "hours_week_cells",
        "hours_week_periods",
        "special_date_hours",
        "special_date_hours_periods",
        "station_fallbacks",
      ]) {
        api.liveData.invalidate([{ type }]);
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      }
      api.liveData.invalidate([{ type: "kitchen_stations" }]);
      await vi.waitFor(() => expect(observed.snapshot.value).toEqual(value()));
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      observed.unsubscribe();
    }
  },
);

it("scopes department receipt subscriptions by department and refreshes passively", async () => {
  const fetchImpl = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
    async () =>
      new Response(
        JSON.stringify({
          receipt: {},
          venueDefaults: {},
          languages: ["es-ES"],
          warningLanguages: [],
          venueAddress: [],
        }),
      ),
  );
  const active = vi.fn();
  const api = new DashboardApi("", fetchImpl, undefined, active);
  // The runtime boundary also makes a missing registry entry fail on its undefined dependencies.
  const query = dashboardQuery(api, "getDepartmentReceipt", ["bar"]);
  expect(query.dependencies).toEqual([
    { type: "department_receipts" },
    { type: "department_sale_policies" },
    { type: "departments" },
    { type: "locations" },
    { type: "content_languages" },
  ]);
  const other = dashboardQuery(api, "getDepartmentReceipt", ["cafe"]);
  expect(other.key).not.toBe(query.key);
  await query.read();
  await query.read();
  expect(fetchImpl.mock.calls.map(([path]) => path)).toEqual([
    "/management-api/venue-service/departments/bar/receipt",
    "/management-api/venue-service/departments/bar/receipt",
  ]);
  expect(active).toHaveBeenCalledOnce();
});

it("department receipt, policy, content and address refresh through the department route passively", async () => {
  const fetchImpl = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
    async () =>
      new Response(
        JSON.stringify({
          receipt: {},
          policy: { receiptPrintMode: "auto", printTradingName: true },
          operationDescriptionRequired: false,
          receiptLanguage: "es-ES",
          languages: ["es-ES"],
          warningLanguages: [],
          venueAddress: [],
        }),
      ),
  );
  const active = vi.fn();
  const api = new DashboardApi("", fetchImpl, undefined, active);
  const observed = api.liveData.observe(
    dashboardQuery(api, "getDepartmentReceipt", ["dept"]),
    () => {},
  );
  try {
    await vi.waitFor(() => expect(observed.snapshot.status).toBe("ready"));
    for (const [index, type] of [
      "department_sale_policies",
      "content_languages",
      "locations",
      "department_receipts",
      "departments",
    ].entries()) {
      api.liveData.invalidate([{ type }]);
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(index + 2));
      expect(fetchImpl.mock.calls[index + 1]![0]).toBe(
        "/management-api/venue-service/departments/dept/receipt",
      );
      expect(new Headers(fetchImpl.mock.calls[index + 1]![1].headers).get("x-waitron-live")).toBe(
        "1",
      );
    }
    expect(active).toHaveBeenCalledOnce();
  } finally {
    observed.unsubscribe();
  }
});

it.each(["Course", "Station"] as const)(
  "kitchen delete %s reads impact passively and deletes actively without a body",
  async (kind) => {
    const impact = { target: { id: "a/b", name: "Kitchen" }, refusals: [], ends: [], removes: [] };
    const fetchImpl = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify(impact), { status: 200 }),
    );
    const active = vi.fn();
    const api = new DashboardApi("", fetchImpl, undefined, active);
    const query = dashboardQuery(
      api,
      kind === "Course" ? "getCourseDeleteImpact" : "getStationDeleteImpact",
      ["a/b"],
    );
    expect(await query.read()).toEqual(impact);
    expect(await query.read()).toEqual(impact);
    const path = `/management-api/${kind === "Course" ? "courses" : "stations"}/a%2Fb`;
    expect(fetchImpl.mock.calls[1]![0]).toBe(`${path}/delete-impact`);
    expect(fetchImpl.mock.calls[1]![1].method).toBe("GET");
    expect(new Headers(fetchImpl.mock.calls[1]![1].headers).get("x-waitron-live")).toBe("1");
    expect(active).toHaveBeenCalledOnce();
    expect(await (kind === "Course" ? api.deleteCourse("a/b") : api.deleteStation("a/b"))).toEqual(
      impact,
    );
    expect(fetchImpl.mock.calls[2]![0]).toBe(path);
    expect(fetchImpl.mock.calls[2]![1].method).toBe("DELETE");
    expect(fetchImpl.mock.calls[2]![1].body).toBeUndefined();
    expect(new Headers(fetchImpl.mock.calls[2]![1].headers).has("x-waitron-live")).toBe(false);
    expect(active).toHaveBeenCalledTimes(2);
    await (kind === "Course"
      ? api.background.deleteCourse("a/b")
      : api.background.deleteStation("a/b"));
    expect(new Headers(fetchImpl.mock.calls[3]![1].headers).has("x-waitron-live")).toBe(false);
    expect(fetchImpl.mock.calls[3]![1].body).toBeUndefined();
  },
);

const stationDeleteReads = [
  "kitchen_stations",
  "ticket_items",
  "working_order_lines",
  "working_orders",
  "dining_tables",
  "party_tables",
  "parties",
  "order_drafts",
  "order_draft_lines",
  "station_printers",
  "printers",
  "device_made_here_stations",
  "devices",
  "device_profiles",
  "device_kitchen_screens",
  "device_kitchen_screen_stations",
  "device_kitchen_screen_zones",
  "device_kitchen_screen_removals",
  "device_profile_kitchen_screens",
  "device_profile_kitchen_screen_stations",
  "device_profile_kitchen_screen_zones",
  "routing_cells",
  "routing_cell_periods",
  "station_day_states",
  "kitchen_station_timing",
  "floor_zones",
  "floor_today_tables",
  "floor_today_join_tables",
  "floor_today_joins",
] as const;
it("kitchen delete impact subscribes to every refusal, setting and naming source", () => {
  const api = new DashboardApi("", vi.fn());
  expect(dashboardQuery(api, "getStationDeleteImpact", ["station"]).dependencies).toEqual(
    stationDeleteReads.map((type) => ({ type })),
  );
  expect(dashboardQuery(api, "getCourseDeleteImpact", ["course"]).dependencies).toEqual([
    { type: "kitchen_courses" },
    { type: "products" },
  ]);
});
it("kitchen delete receives an arriving blocker and removed binding through passive rereads", async () => {
  const before = {
    target: { id: "grill", name: "Grill" },
    refusals: [],
    ends: [],
    removes: [{ key: "station_made_here", count: 1, targets: [{ id: "till", name: "Till" }] }],
  };
  const blocked = {
    ...before,
    refusals: [
      {
        code: "station.work_in_progress",
        params: { stationId: "grill", count: 1 },
        targets: [{ id: "order", name: "Table 8" }],
      },
    ],
  };
  const cleared = { ...blocked, removes: [] };
  let model: DeleteImpact = before;
  const fetchImpl = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(model), { status: 200 }),
  );
  const active = vi.fn();
  const api = new DashboardApi("", fetchImpl, undefined, active);
  const observed = api.liveData.observe(
    dashboardQuery(api, "getStationDeleteImpact", ["grill"]),
    () => {},
  );
  try {
    await vi.waitFor(() => expect(observed.snapshot.value).toEqual(before));
    model = blocked;
    api.liveData.invalidate([{ type: "ticket_items", id: "new-ticket" }]);
    await vi.waitFor(() => expect(observed.snapshot.value).toEqual(blocked));
    model = cleared;
    api.liveData.invalidate([{ type: "device_made_here_stations", id: "removed-binding" }]);
    await vi.waitFor(() => expect(observed.snapshot.value).toEqual(cleared));
    expect(fetchImpl.mock.calls).toHaveLength(3);
    expect(
      fetchImpl.mock.calls
        .slice(1)
        .every(
          ([path, init]) =>
            path === "/management-api/stations/grill/delete-impact" &&
            new Headers(init.headers).get("x-waitron-live") === "1",
        ),
    ).toBe(true);
    expect(active).toHaveBeenCalledOnce();
  } finally {
    observed.unsubscribe();
  }
});

it.each(["Zone", "Department"] as const)(
  "hierarchy %s query refreshes every dependency passively and disposes its interests",
  async (kind) => {
    const reads = [
      "floor_zones",
      "dining_tables",
      "floor_plans",
      "floor_plan_tables",
      "floor_reset_tables",
      "floor_today_zones",
      "floor_today_tables",
      "floor_today_joins",
      "floor_today_join_tables",
      "parties",
      "party_tables",
      "working_orders",
      "working_order_lines",
      "ticket_items",
      "order_service_contexts",
      "departments",
      "device_profiles",
      "devices",
      "device_profile_service_access",
      "device_profile_zones",
      "device_kitchen_screens",
      "device_kitchen_screen_stations",
      "device_kitchen_screen_zones",
      "device_kitchen_screen_removals",
      "device_profile_kitchen_screens",
      "device_profile_kitchen_screen_stations",
      "device_profile_kitchen_screen_zones",
      "routing_cells",
      "routing_cell_periods",
      "zone_service_policies",
      "zone_sale_policies",
      "zone_extensions",
      "department_sale_policies",
      "menu_periods",
      "menu_period_staff_menus",
      "department_days",
      "department_day_ranges",
      "zone_days",
      "zone_day_ranges",
      "period_extensions",
      "department_transfer_desks",
      "department_transfer_destinations",
      "department_transfer_requests",
    ];
    let revision = 0;
    const fetchImpl = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            target: { id: "a/b", name: `Garden ${revision}` },
            refusals: [],
            ends: [],
            removes: [],
          }),
        ),
    );
    const active = vi.fn();
    const api = new DashboardApi("", fetchImpl, undefined, active);
    const query = dashboardQuery(
      api,
      kind === "Zone" ? "getZoneDeleteImpact" : "getDepartmentDeleteImpact",
      ["a/b"],
    );
    expect(query.dependencies).toEqual(reads.map((type) => ({ type })));
    const observed = api.liveData.observe(query, () => {});
    try {
      await vi.waitFor(() => expect(observed.snapshot.value?.target.name).toBe("Garden 0"));
      for (const type of reads) {
        revision++;
        api.liveData.invalidate([{ type, id: "changed" }]);
        await vi.waitFor(() =>
          expect(observed.snapshot.value?.target.name).toBe(`Garden ${revision}`),
        );
      }
      expect(active).toHaveBeenCalledOnce();
      expect(
        fetchImpl.mock.calls
          .slice(1)
          .every(
            ([, init]) => new Headers((init as RequestInit).headers).get("x-waitron-live") === "1",
          ),
      ).toBe(true);
    } finally {
      observed.unsubscribe();
    }
    expect(api.liveData.interests).toEqual([]);
  },
);

for (const type of ["location_business_day_settings", "location_day_cutover_changes"]) {
  it(`an order detail is refreshed passively when ${type} changes its today's-order visibility`, async () => {
    let reads = 0;
    const fetchImpl = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ id: "order", snapshot: ++reads }), { status: 200 }),
    );
    const active = vi.fn();
    const api = new DashboardApi("", fetchImpl, undefined, active);
    const observed = api.liveData.observe(dashboardQuery(api, "getOrder", ["order"]), () => {});
    try {
      await expect.poll(() => observed.snapshot.value).toEqual({ id: "order", snapshot: 1 });
      api.liveData.invalidate([{ type }]);
      await expect.poll(() => observed.snapshot.value).toEqual({ id: "order", snapshot: 2 });
      expect(new Headers(fetchImpl.mock.calls[1]![1].headers).get("x-waitron-live")).toBe("1");
      expect(active).toHaveBeenCalledOnce();
    } finally {
      observed.unsubscribe();
    }
  });
}
