import { expect, it, vi } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { PrepStationsApi } from "./routing-client.js";

it("writes station hours, fallback and today to venue service, and reads output failures passively", async () => {
  const request = vi.fn(async () => ({ printersDown: [], screensDark: [] }));
  const api = new PrepStationsApi(request as DashboardRequest);
  const hours = [{ weekday: 5, opensAt: "22:00", closesAt: "02:00" }];
  await api.setStationHours("bar", hours);
  await api.setStationFallback("bar", null);
  await api.setStationToday("bar", "closed");
  await api.listOutputsDown();
  expect(request.mock.calls).toEqual([
    ["/management-api/venue-service/stations/bar/hours", "PUT", { hours }],
    ["/management-api/venue-service/stations/bar/fallback", "PUT", { fallbackStationId: null }],
    ["/management-api/venue-service/stations/bar/today", "PUT", { state: "closed" }],
    ["/management-api/stations/outputs-down", "GET", undefined, { passive: true }],
  ]);
});

it("loads the routing and station context, including each station printer assignment", async () => {
  const responses: Record<string, unknown> = {
    "/management-api/venue-service/routing": {
      claims: [],
      exceptions: [],
      unassigned: { folders: [], products: [] },
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
            claims: [],
            exceptions: [],
            unassigned: { folders: [], products: [] },
            defaultStationId: null,
            stations: [],
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

it("creates, updates and removes watchers through management routes", async () => {
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
  await api.createWatcher(input);
  await api.updateWatcher("pass", input);
  await api.removeWatcher("pass", { disable: false });
  await api.removeWatcher("pass", { disable: true });
  expect(request.mock.calls).toEqual([
    ["/management-api/watchers", "POST", input],
    ["/management-api/watchers/pass", "PUT", input],
    ["/management-api/watchers/pass", "DELETE"],
    ["/management-api/watchers/pass?disable=true", "DELETE"],
  ]);
});

it("keeps top-level names for exceptions and offers active variants only to the tester", async () => {
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
            claims: [],
            exceptions: [],
            unassigned: { folders: [], products: [] },
            defaultStationId: null,
            stations: [],
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
            claims: [],
            exceptions: [],
            unassigned: { folders: [], products: [] },
            defaultStationId: null,
            stations: [],
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
          claims: [],
          exceptions: [],
          unassigned: { folders: [], products: [] },
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

it("writes station changes to core and claims to venue-service", async () => {
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
  await api.setClaim("drinks", { kind: "no_preparation" });
  await api.removeClaim("drinks");
  await api.createException({
    zoneId: null,
    categoryId: null,
    productId: "bread",
    target: { kind: "station", stationId: "bar" },
  });
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
    ["/management-api/venue-service/routing/claims/drinks", "PUT", { noPreparation: true }],
    ["/management-api/venue-service/routing/claims/drinks", "DELETE"],
    [
      "/management-api/venue-service/routing/exceptions",
      "POST",
      { zoneId: null, categoryId: null, productId: "bread", stationId: "bar" },
    ],
  ]);
});
it("assigns an unfiled product through the prioritized assignment route", async () => {
  const request = vi.fn(async () => undefined);
  const api = new PrepStationsApi(request as DashboardRequest);
  await api.assignProduct("bread", { kind: "station", stationId: "bar" });
  expect(request).toHaveBeenCalledWith(
    "/management-api/venue-service/routing/products/bread/assignment",
    "PUT",
    { stationId: "bar" },
  );
});
it("sends the assignment preview as a no-write request", async () => {
  const move = {
    productId: "bread",
    productName: "Bread",
    zoneId: null,
    zoneName: null,
    from: null,
    to: { kind: "station", stationId: "bar" },
  };
  const request = vi.fn(async () => [move]);
  const api = new PrepStationsApi(request as DashboardRequest);
  await expect(
    api.preview({
      kind: "assignment",
      productId: "bread",
      target: { kind: "station", stationId: "bar" },
    }),
  ).resolves.toEqual([move]);
  expect(request).toHaveBeenCalledWith("/management-api/venue-service/routing/preview", "POST", {
    kind: "assignment",
    productId: "bread",
    target: { kind: "station", stationId: "bar" },
  });
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
it("updates, deletes and reorders exceptions using the routing endpoints", async () => {
  const request = vi.fn(async () => undefined);
  const api = new PrepStationsApi(request as DashboardRequest);
  await api.updateException("e1", {
    zoneId: "terrace",
    categoryId: null,
    productId: "lager",
    target: { kind: "no_preparation" },
  });
  await api.deleteException("e1");
  await api.reorderExceptions(["e2", "e1"]);
  expect(request.mock.calls).toEqual([
    [
      "/management-api/venue-service/routing/exceptions/e1",
      "PUT",
      { zoneId: "terrace", categoryId: null, productId: "lager", noPreparation: true },
    ],
    ["/management-api/venue-service/routing/exceptions/e1", "DELETE"],
    ["/management-api/venue-service/routing/exception-order", "PUT", { ids: ["e2", "e1"] }],
  ]);
});

it("writes a no-preparation exception and product assignment without a station id", async () => {
  const request = vi.fn(async () => undefined);
  const api = new PrepStationsApi(request as DashboardRequest);
  await api.createException({
    zoneId: "terrace",
    categoryId: null,
    productId: "bread",
    target: { kind: "no_preparation" },
  });
  await api.assignProduct("bread", { kind: "no_preparation" });
  expect(request.mock.calls).toEqual([
    [
      "/management-api/venue-service/routing/exceptions",
      "POST",
      {
        zoneId: "terrace",
        categoryId: null,
        productId: "bread",
        noPreparation: true,
      },
    ],
    [
      "/management-api/venue-service/routing/products/bread/assignment",
      "PUT",
      {
        noPreparation: true,
      },
    ],
  ]);
});

it("writes station targets for a claim and an edited exception", async () => {
  const request = vi.fn(async () => undefined);
  const api = new PrepStationsApi(request as DashboardRequest);
  await api.setClaim("drinks", { kind: "station", stationId: "bar" });
  await api.updateException("rule-1", {
    zoneId: null,
    categoryId: "drinks",
    productId: null,
    target: { kind: "station", stationId: "bar" },
  });
  expect(request.mock.calls).toEqual([
    ["/management-api/venue-service/routing/claims/drinks", "PUT", { stationId: "bar" }],
    [
      "/management-api/venue-service/routing/exceptions/rule-1",
      "PUT",
      {
        zoneId: null,
        categoryId: "drinks",
        productId: null,
        stationId: "bar",
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
    claims: [],
    exceptions: [],
    unassigned: { folders: [], products: [] },
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
