import type { DeleteImpact } from "@waitron/shared";
import { expect, it, vi } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { PrepStationsApi } from "./routing-client.js";

it("has no station-hours, fallback or today writer, and reads output failures passively", async () => {
  const request = vi.fn(async () => ({ printersDown: [], screensDark: [] }));
  const api = new PrepStationsApi(request as DashboardRequest);
  expect("setStationHours" in api).toBe(false);
  expect("setStationFallback" in api).toBe(false);
  expect("setStationToday" in api).toBe(false);
  await api.listOutputsDown();
  expect(request.mock.calls).toEqual([
    ["/management-api/stations/outputs-down", "GET", undefined, { passive: true }],
  ]);
});

it("loads the routing and station context, including each station printer assignment", async () => {
  const responses: Record<string, unknown> = {
    "/management-api/venue-service/routing": {
      zones: [],
      categories: [],
      products: [],
      cells: [],
      canMakeDefault: true,
      defaultStationId: null,
      stations: [],
    },
    "/management-api/stations": [{ id: "bar", name: "Bar" }],
    "/management-api/categories": [],
    "/management-api/zones": [],
    "/management-api/products": [],
    "/management-api/printers": [],
    "/management-api/devices": [],
    "/management-api/stations/bar/printers": [{ stationId: "bar", printerId: "receipt" }],
  };
  const request = vi.fn(async (path: string) => responses[path]);
  const view = await new PrepStationsApi(request as DashboardRequest).load();
  expect(request.mock.calls.map((call) => call[0])).toEqual(Object.keys(responses));
  expect(view.stationPrinters).toEqual([{ stationId: "bar", printerId: "receipt" }]);
});

it("keeps top-level product names, active or not, and lists no variants", async () => {
  const request = vi.fn(async (path: string) =>
    path === "/management-api/products"
      ? [
          {
            id: "lager",
            name: "Lager",
            active: true,
            variants: [
              { id: "large", name: "Large", active: true },
              { id: "old", name: "Old", active: false },
            ],
          },
          { id: "retired", name: "Retired lager", active: false, variants: [] },
        ]
      : path === "/management-api/venue-service/routing"
        ? {
            zones: [],
            categories: [],
            products: [],
            cells: [],
            defaultStationId: null,
            stations: [],
            canMakeDefault: true,
          }
        : [],
  );
  const result = await new PrepStationsApi(request as DashboardRequest).load();
  expect(result.products).toEqual([
    { id: "lager", name: "Lager" },
    { id: "retired", name: "Retired lager" },
  ]);
  expect(result).not.toHaveProperty("testProducts");
});

it("uses passive reads for the background routing refresh", async () => {
  const request = vi.fn(async (path: string) =>
    path === "/management-api/venue-service/routing"
      ? {
          zones: [],
          categories: [],
          products: [],
          cells: [],
          canMakeDefault: true,
          defaultStationId: null,
          stations: [],
        }
      : [],
  );
  const liveData = {} as ConstructorParameters<typeof PrepStationsApi>[1];
  const background = new PrepStationsApi(request as DashboardRequest, liveData).background;
  expect(background.liveData).toBe(liveData);
  await background.load();
  expect(request).toHaveBeenCalledTimes(7);
  expect(
    (request.mock.calls as unknown as [string, string, unknown, { passive: boolean }][]).every(
      (call) => call[3]?.passive === true,
    ),
  ).toBe(true);
});

it("loadRouting reads …/routing passively from the background client", async () => {
  const routing = {
    stationTimes: [],
    todayEnds: null,
    clockReadable: true,
    zones: [{ id: "terrace", name: "Terrace" }],
    categories: [{ id: "drinks", name: "Drinks", parentId: null }],
    products: [{ id: "lager", name: "Lager", categoryId: "drinks" }],
    cells: [
      {
        row: { kind: "category", categoryId: "drinks" },
        zoneId: null,
        target: { kind: "no_preparation" },
      },
    ],
    defaultStationId: "bar",
    stations: [{ id: "bar", name: "Bar", active: true }],
    canMakeDefault: false,
  };
  const request = vi.fn(async (path: string) =>
    path === "/management-api/venue-service/routing" ? routing : [],
  );
  const view = await new PrepStationsApi(request as DashboardRequest).background.load();
  expect(view.routing).toEqual(routing);
  expect(request).toHaveBeenCalledWith("/management-api/venue-service/routing", "GET", undefined, {
    passive: true,
  });
});

it("sends a station's printers in the station's own create and edit", async () => {
  const request = vi.fn(async () => ({ id: "grill" }));
  const api = new PrepStationsApi(request as unknown as DashboardRequest);
  const station = {
    name: "Grill",
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
    colour: "orange" as const,
  };
  await api.createStation({ ...station, printerIds: ["epson"] });
  await api.updateStation("grill", { name: "Hot grill", printerIds: ["epson", "star"] });
  expect(request.mock.calls).toEqual([
    ["/management-api/stations", "POST", { ...station, printerIds: ["epson"] }],
    [
      "/management-api/stations/grill",
      "PATCH",
      { name: "Hot grill", printerIds: ["epson", "star"] },
    ],
  ]);
});

it("writes station changes to core and cells to venue-service", async () => {
  const request = vi.fn(async (path: string) =>
    path === "/management-api/stations" ? { id: "new-bar" } : undefined,
  );
  const api = new PrepStationsApi(request as DashboardRequest);
  await api.createStation({
    name: "Bar",
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
    colour: "blue",
  });
  await api.updateStation("bar", {
    name: "Terrace bar",
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  });
  await api.setDefaultStation("bar");
  await api.deleteStation("bar");
  await api.setCell(
    { row: { kind: "category", categoryId: "drinks" }, zoneId: null },
    {
      kind: "no_preparation",
    },
  );
  await api.setCell({ row: { kind: "category", categoryId: "drinks" }, zoneId: null }, null);
  await api.setCell(
    { row: { kind: "product", productId: "bread" }, zoneId: null },
    { kind: "station", stationId: "bar" },
  );
  expect(request.mock.calls).toEqual([
    [
      "/management-api/stations",
      "POST",
      {
        name: "Bar",
        warmAfterMinutes: 5,
        overdueAfterMinutes: 10,
        forgottenAfterMinutes: 15,
        colour: "blue",
      },
    ],
    [
      "/management-api/stations/bar",
      "PATCH",
      {
        name: "Terrace bar",
        warmAfterMinutes: 5,
        overdueAfterMinutes: 10,
        forgottenAfterMinutes: 15,
      },
    ],
    ["/management-api/stations/bar/default", "POST"],
    ["/management-api/stations/bar", "DELETE"],
    [
      "/management-api/venue-service/routing/cell",
      "PUT",
      {
        address: { row: { kind: "category", categoryId: "drinks" }, zoneId: null },
        target: { kind: "no_preparation" },
      },
    ],
    [
      "/management-api/venue-service/routing/cell",
      "PUT",
      { address: { row: { kind: "category", categoryId: "drinks" }, zoneId: null }, target: null },
    ],
    [
      "/management-api/venue-service/routing/cell",
      "PUT",
      {
        address: { row: { kind: "product", productId: "bread" }, zoneId: null },
        target: { kind: "station", stationId: "bar" },
      },
    ],
  ]);
});
it("setCell sends a cell's period lines when it is given them", async () => {
  const request = vi.fn(async () => undefined);
  const api = new PrepStationsApi(request as DashboardRequest).background;
  const address = { row: { kind: "category", categoryId: "drinks" }, zoneId: null } as const;
  const periods = [{ periodId: "lunch", target: { kind: "no_preparation" } }] as const;
  await api.setCell(address, { kind: "station", stationId: "bar" }, periods);
  await api.setCell(address, { kind: "station", stationId: "bar" }, []);
  expect(request.mock.calls).toEqual([
    [
      "/management-api/venue-service/routing/cell",
      "PUT",
      { address, target: { kind: "station", stationId: "bar" }, periods },
    ],
    [
      "/management-api/venue-service/routing/cell",
      "PUT",
      { address, target: { kind: "station", stationId: "bar" }, periods: [] },
    ],
  ]);
});
it("setCell sends PUT …/routing/cell with address and target (or null)", async () => {
  const request = vi.fn(async () => undefined);
  const api = new PrepStationsApi(request as DashboardRequest).background;
  const address = { row: { kind: "product", productId: "bread" }, zoneId: "terrace" } as const;
  await api.setCell(address, { kind: "station", stationId: "bar" });
  await api.setCell(address, null);
  expect(request.mock.calls).toEqual([
    [
      "/management-api/venue-service/routing/cell",
      "PUT",
      { address, target: { kind: "station", stationId: "bar" } },
    ],
    ["/management-api/venue-service/routing/cell", "PUT", { address, target: null }],
  ]);
});
it("preview sends POST with kind cell", async () => {
  const move = {
    productId: "bread",
    productName: "Bread",
    zoneId: null,
    zoneName: null,
    from: null,
    to: { kind: "station", stationId: "bar" },
  };
  const request = vi.fn(async () => [move]);
  const api = new PrepStationsApi(request as DashboardRequest).background;
  const change = {
    kind: "cell",
    address: { row: { kind: "category", categoryId: "drinks" }, zoneId: "terrace" },
    target: { kind: "station", stationId: "bar" },
  } as const;
  await expect(api.preview(change)).resolves.toEqual([move]);
  expect(request.mock.calls).toEqual([
    ["/management-api/venue-service/routing/preview", "POST", change],
  ]);
});
it("creates station and its timing thresholds with one POST", async () => {
  const request = vi.fn(async () => ({ id: "new-bar" }));
  const api = new PrepStationsApi(request as DashboardRequest);
  await expect(
    api.createStation({
      name: "Bar",
      warmAfterMinutes: 3,
      overdueAfterMinutes: 8,
      forgottenAfterMinutes: 12,
      colour: "blue",
    }),
  ).resolves.toEqual({ id: "new-bar" });
  expect(request.mock.calls).toEqual([
    [
      "/management-api/stations",
      "POST",
      {
        name: "Bar",
        warmAfterMinutes: 3,
        overdueAfterMinutes: 8,
        forgottenAfterMinutes: 12,
        colour: "blue",
      },
    ],
  ]);
});
it("clears a zone cell through the cell endpoint", async () => {
  const request = vi.fn(async () => undefined);
  const api = new PrepStationsApi(request as DashboardRequest);
  await api.setCell({ row: { kind: "all" }, zoneId: "terrace" }, null);
  expect(request.mock.calls).toEqual([
    [
      "/management-api/venue-service/routing/cell",
      "PUT",
      { address: { row: { kind: "all" }, zoneId: "terrace" }, target: null },
    ],
  ]);
});
it("writes a no-preparation cell without a station id", async () => {
  const request = vi.fn(async () => undefined);
  const api = new PrepStationsApi(request as DashboardRequest);
  await api.setCell(
    { row: { kind: "product", productId: "bread" }, zoneId: "terrace" },
    { kind: "no_preparation" },
  );
  expect(request.mock.calls).toEqual([
    [
      "/management-api/venue-service/routing/cell",
      "PUT",
      {
        address: { row: { kind: "product", productId: "bread" }, zoneId: "terrace" },
        target: { kind: "no_preparation" },
      },
    ],
  ]);
});
it("writes station targets for a category cell and a category zone cell", async () => {
  const request = vi.fn(async () => undefined);
  const api = new PrepStationsApi(request as DashboardRequest);
  await api.setCell(
    { row: { kind: "category", categoryId: "drinks" }, zoneId: null },
    { kind: "station", stationId: "bar" },
  );
  await api.setCell(
    { row: { kind: "category", categoryId: "drinks" }, zoneId: "terrace" },
    { kind: "station", stationId: "bar" },
  );
  expect(request.mock.calls).toEqual([
    [
      "/management-api/venue-service/routing/cell",
      "PUT",
      {
        address: { row: { kind: "category", categoryId: "drinks" }, zoneId: null },
        target: { kind: "station", stationId: "bar" },
      },
    ],
    [
      "/management-api/venue-service/routing/cell",
      "PUT",
      {
        address: { row: { kind: "category", categoryId: "drinks" }, zoneId: "terrace" },
        target: { kind: "station", stationId: "bar" },
      },
    ],
  ]);
});

it("delete impact reads passively in the background and delete sends no body or passive option", async () => {
  const impact = { target: { id: "grill", name: "Grill" }, refusals: [], ends: [], removes: [] };
  const request = vi.fn(async () => impact);
  const api = new PrepStationsApi(request as DashboardRequest).background;
  expect(await api.getStationDeleteImpact("a/b")).toEqual(impact);
  expect(await api.deleteStation("a/b")).toEqual(impact);
  expect(request.mock.calls).toEqual([
    ["/management-api/stations/a%2Fb/delete-impact", "GET", undefined, { passive: true }],
    ["/management-api/stations/a%2Fb", "DELETE"],
  ]);
});

it("delete impact refreshes a new blocker and a removed binding through the module's subscription", async () => {
  const { LiveData } = await import("@waitron/dashboard-kit");
  const { QUERY_DEPENDENCIES } = await import("./live-queries.js");
  const liveData = new LiveData();
  let model: DeleteImpact = {
    target: { id: "grill", name: "Grill" },
    refusals: [],
    ends: [],
    removes: [{ key: "station_made_here", count: 1, targets: [{ id: "till", name: "Till" }] }],
  };
  const request = vi.fn(async () => model);
  const api = new PrepStationsApi(request as DashboardRequest, liveData).background;
  const observed = liveData.observe(
    {
      key: "station-delete-impact:grill",
      dependencies: QUERY_DEPENDENCIES["station-delete-impact"].map((type) => ({ type })),
      read: () => api.getStationDeleteImpact("grill"),
    },
    () => {},
  );
  try {
    await vi.waitFor(() => expect(observed.snapshot.value).toEqual(model));
    model = {
      ...model,
      refusals: [
        {
          code: "station.work_in_progress",
          params: { stationId: "grill", count: 1 },
          targets: [{ id: "order", name: "Table 8" }],
        },
      ],
    };
    liveData.invalidate([{ type: "ticket_items", id: "arriving" }]);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(observed.snapshot.value).toEqual(model);
    model = { ...model, removes: [] };
    liveData.invalidate([{ type: "device_made_here_stations", id: "removed" }]);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(observed.snapshot.value).toEqual(model);
    expect(request.mock.calls).toEqual(
      Array.from({ length: 3 }, () => [
        "/management-api/stations/grill/delete-impact",
        "GET",
        undefined,
        { passive: true },
      ]),
    );
  } finally {
    observed.unsubscribe();
  }
});
