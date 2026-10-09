import { expect, it, vi } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { PrepStationsApi } from "./routing-client.js";

it("writes station fallback to venue service without a today writer, and reads output failures passively", async () => {
  const request = vi.fn(async () => ({ printersDown: [], screensDark: [] }));
  const api = new PrepStationsApi(request as DashboardRequest);
  expect("setStationHours" in api).toBe(false);
  await api.setStationFallback("bar", null);
  expect("setStationToday" in api).toBe(false);
  await api.listOutputsDown();
  expect(request.mock.calls).toEqual([
    ["/management-api/venue-service/stations/bar/fallback", "PUT", { fallbackStationId: null }],
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
    "/management-api/stations?includeDisabled=true": [{ id: "bar", name: "Bar" }],
    "/management-api/categories": [],
    "/management-api/zones": [],
    "/management-api/products": [],
    "/management-api/printers": [],
    "/management-api/devices": [],
    "/management-api/watchers?includeDisabled=true": [],
    "/management-api/stations/bar/printers": [{ stationId: "bar", printerId: "receipt" }],
  };
  const request = vi.fn(async (path: string) => responses[path]);
  const view = await new PrepStationsApi(request as DashboardRequest).load();
  expect(request.mock.calls.map((call) => call[0])).toEqual(Object.keys(responses));
  expect(view.stationPrinters).toEqual([{ stationId: "bar", printerId: "receipt" }]);
});

it("reads disabled watchers too, keeping them out of the watchers every other part of the page reads", async () => {
  const watcher = {
    displayOrder: 0,
    everyStation: true,
    stationIds: [],
    everyZone: true,
    zoneIds: [],
    runsPass: false,
    printerIds: [],
    inUse: false,
  };
  const pass = { ...watcher, id: "pass", name: "Pass", active: true };
  const old = { ...watcher, id: "old", name: "Old pass", active: false };
  const request = vi.fn(async (path: string) =>
    path === "/management-api/watchers?includeDisabled=true"
      ? [old, pass]
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
  const view = await new PrepStationsApi(request as DashboardRequest).load();
  expect(view.watchers).toEqual([pass]);
  expect(view.disabledWatchers).toEqual([old]);
});

it("enables a disabled watcher through its reactivate route", async () => {
  const request = vi.fn(async () => undefined);
  await new PrepStationsApi(request as DashboardRequest).enableWatcher("old");
  expect(request.mock.calls).toEqual([["/management-api/watchers/old/reactivate", "POST"]]);
});

it("updates and removes watchers through management routes", async () => {
  const request = vi.fn(async () => ({ id: "pass" }));
  const api = new PrepStationsApi(request as DashboardRequest);
  const input = {
    name: "Pass",
    everyStation: true,
    stationIds: [],
    everyZone: true,
    zoneIds: [],
    runsPass: true,
  };
  await api.updateWatcher("pass", input);
  await api.removeWatcher("pass", { disable: false });
  await api.removeWatcher("pass", { disable: true });
  expect(request.mock.calls).toEqual([
    ["/management-api/watchers/pass", "PUT", input],
    ["/management-api/watchers/pass", "DELETE"],
    ["/management-api/watchers/pass?disable=true", "DELETE"],
  ]);
});

it("keeps top-level product names, and offers active variants only to the tester", async () => {
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
  expect(result.testProducts).toEqual([
    { id: "lager", name: "Lager" },
    { id: "large", name: "Lager · Large" },
  ]);
});

it("offers an active product to the tester when it has no variants", async () => {
  const request = vi.fn(async (path: string) =>
    path === "/management-api/products"
      ? [{ id: "bread", name: "Bread", active: true }]
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
  expect(result.testProducts).toEqual([{ id: "bread", name: "Bread" }]);
});

it("asks the route tester for a product and an optional zone", async () => {
  const request = vi.fn(async () => ({
    route: null,
    decidedBy: null,
    fallbacks: [],
    noReplacement: false,
    stations: [],
  }));
  const result = await new PrepStationsApi(request as DashboardRequest).explain("lager", null);
  expect(result.route).toBeNull();
  expect(request).toHaveBeenCalledWith(
    "/management-api/venue-service/routing/explain?productId=lager&zoneId=",
    "GET",
    undefined,
    { passive: false },
  );
});

it("escapes product and zone identifiers in a zoned route explanation", async () => {
  const request = vi.fn(async () => ({
    route: null,
    decidedBy: null,
    fallbacks: [],
    noReplacement: false,
    stations: [],
  }));
  await new PrepStationsApi(request as DashboardRequest).explain("rice & beans", "front/bar");
  expect(request).toHaveBeenCalledWith(
    "/management-api/venue-service/routing/explain?productId=rice+%26+beans&zoneId=front%2Fbar",
    "GET",
    undefined,
    { passive: false },
  );
});

it("sends every chosen extra in order with a scheduled explanation", async () => {
  const request = vi.fn(async () => ({ extras: [] }));
  await new PrepStationsApi(request as DashboardRequest).explain(
    "burger",
    null,
    { weekday: 5, timeOfDay: "22:00" },
    ["chips", "cheese"],
  );
  expect(request).toHaveBeenCalledWith(
    "/management-api/venue-service/routing/explain?productId=burger&zoneId=&extraId=chips&extraId=cheese&weekday=5&time=22%3A00",
    "GET",
    undefined,
    { passive: false },
  );
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
  expect(request).toHaveBeenCalledTimes(8);
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

it("writes station changes to core and cells to venue-service", async () => {
  const request = vi.fn(async (path: string) =>
    path === "/management-api/stations" ? { id: "new-bar" } : undefined,
  );
  const api = new PrepStationsApi(request as DashboardRequest);
  await api.createStation({
    name: "Bar",
    displayOrder: 2,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  });
  await api.updateStation("bar", {
    name: "Terrace bar",
    displayOrder: 3,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  });
  await api.setDefaultStation("bar");
  await api.deactivateStation("bar");
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
        displayOrder: 2,
        warmAfterMinutes: 5,
        overdueAfterMinutes: 10,
        forgottenAfterMinutes: 15,
      },
    ],
    [
      "/management-api/stations/bar",
      "PATCH",
      {
        name: "Terrace bar",
        displayOrder: 3,
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
      displayOrder: 2,
      warmAfterMinutes: 3,
      overdueAfterMinutes: 8,
      forgottenAfterMinutes: 12,
    }),
  ).resolves.toEqual({ id: "new-bar" });
  expect(request.mock.calls).toEqual([
    [
      "/management-api/stations",
      "POST",
      {
        name: "Bar",
        displayOrder: 2,
        warmAfterMinutes: 3,
        overdueAfterMinutes: 8,
        forgottenAfterMinutes: 12,
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
it("switches a station on through the core station PATCH", async () => {
  const request = vi.fn(async () => undefined);
  await new PrepStationsApi(request as DashboardRequest).activateStation("bar");
  expect(request).toHaveBeenCalledWith("/management-api/stations/bar", "PATCH", { active: true });
});

it("serializes the scheduled weekday and time together", async () => {
  const request = vi.fn(async () => undefined);
  const api = new PrepStationsApi(request as DashboardRequest);
  await api.explain("lager", null, { weekday: 5, timeOfDay: "22:00" });
  expect(request).toHaveBeenCalledWith(
    "/management-api/venue-service/routing/explain?productId=lager&zoneId=&weekday=5&time=22%3A00",
    "GET",
    undefined,
    { passive: false },
  );
});

it("sends a date instead of a weekday to preview that date's own hours", async () => {
  const request = vi.fn(async () => undefined);
  const api = new PrepStationsApi(request as DashboardRequest);
  await api.explain("lager", null, { civilDate: "2026-10-09", weekday: 5, timeOfDay: "22:00" });
  expect(request).toHaveBeenCalledWith(
    "/management-api/venue-service/routing/explain?productId=lager&zoneId=&date=2026-10-09&time=22%3A00",
    "GET",
    undefined,
    { passive: false },
  );
});

it("reads station health passively and preserves summary and drilldown data", async () => {
  const snapshot = {
    capturedAt: "2026-10-05T18:00:00.000Z",
    stations: [
      {
        id: "bar",
        waiting: 1,
        preparing: null,
        ready: null,
        items: [{ name: "CANA", remainingQuantity: "2.000" }],
      },
    ],
    outputsDown: { printersDown: [], screensDark: [] },
  };
  const request = vi.fn(async () => snapshot);
  const api = new PrepStationsApi(request as DashboardRequest);
  expect(await api.readStationHealth()).toEqual(snapshot);
  expect(await api.background.readStationHealth()).toEqual(snapshot);
  expect(request.mock.calls).toEqual([
    ["/management-api/stations/health", "GET", undefined, { passive: true }],
    ["/management-api/stations/health", "GET", undefined, { passive: true }],
  ]);
});

it("writes a complete station order as one active request even from a background client", async () => {
  const request = vi.fn(async () => undefined);
  const client = new PrepStationsApi(request as DashboardRequest).background;
  await client.reorderStations(["bar", "kitchen"]);
  expect(request.mock.calls).toEqual([
    ["/management-api/stations/order", "PUT", { ids: ["bar", "kitchen"] }],
  ]);
});

it("saves a station's complete printer set in one non-passive request", async () => {
  const request = vi.fn(async () => undefined);
  await new PrepStationsApi(request as DashboardRequest).background.setStationPrinters("bar", [
    "p2",
    "p1",
  ]);
  expect(request.mock.calls).toEqual([
    ["/management-api/stations/bar/printers", "PUT", { printerIds: ["p2", "p1"] }],
  ]);
});

it("submits a whole watcher printer set as an active write even from a background client", async () => {
  const request = vi.fn(async () => undefined);
  const api = new PrepStationsApi(request as DashboardRequest).background;
  await api.setWatcherPrinters("pass", ["front", "back"]);
  await api.setWatcherPrinters("pass", []);
  expect(request.mock.calls).toEqual([
    ["/management-api/watchers/pass/printers", "PUT", { printerIds: ["front", "back"] }],
    ["/management-api/watchers/pass/printers", "PUT", { printerIds: [] }],
  ]);
});

it("loads the supervisor overview without requesting management-only context, including passive refresh", async () => {
  const request = vi.fn(async (path: string) => {
    if (path === "/management-api/venue-service/stations/overview")
      return {
        stations: [{ id: "bar", name: "Bar", active: true }],
        defaultStationId: "bar",
        stationTimes: [],
        todayEnds: { timeOfDay: "06:00", tomorrow: true },
        clockReadable: true,
      };
    if (path === "/management-api/stations?includeDisabled=true")
      return [{ id: "bar", name: "Bar", active: true }];
    throw new Error(`Unexpected management read ${path}`);
  });
  const overview = new PrepStationsApi(request as DashboardRequest).overview;
  const loaded = await overview.load();
  expect(loaded.stations).toEqual([{ id: "bar", name: "Bar", active: true }]);
  expect(loaded.routing).toEqual({
    stations: [{ id: "bar", name: "Bar", active: true }],
    defaultStationId: "bar",
    stationTimes: [],
    todayEnds: { timeOfDay: "06:00", tomorrow: true },
    clockReadable: true,
    zones: [],
    categories: [],
    products: [],
    cells: [],
    canMakeDefault: false,
  });
  for (const key of [
    "categories",
    "zones",
    "products",
    "testProducts",
    "printers",
    "stationPrinters",
    "devices",
    "watchers",
  ] as const)
    expect(loaded[key]).toEqual([]);
  await overview.background.load();
  expect(request.mock.calls).toEqual([
    ["/management-api/venue-service/stations/overview", "GET", undefined, { passive: false }],
    ["/management-api/stations?includeDisabled=true", "GET", undefined, { passive: false }],
    ["/management-api/venue-service/stations/overview", "GET", undefined, { passive: true }],
    ["/management-api/stations?includeDisabled=true", "GET", undefined, { passive: true }],
  ]);
});
