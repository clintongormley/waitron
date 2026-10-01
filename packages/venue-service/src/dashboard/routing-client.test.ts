import { expect, it, vi } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { PrepStationsApi } from "./routing-client.js";

it("loads the routing and station context, including each station printer assignment", async () => {
  const responses: Record<string, unknown> = {
    "/management-api/venue-service/routing": {
      claims: [],
      exceptions: [],
      unassigned: { folders: [], products: [] },
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

it("offers active products and their variants to the route tester", async () => {
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
    { id: "large", name: "Lager · Large" },
  ]);
});

it("asks the route tester for a product and an optional zone", async () => {
  const request = vi.fn(async () => ({ route: null, decidedBy: null, skipped: [], stations: [] }));
  const result = await new PrepStationsApi(request as DashboardRequest).explain("lager", null);
  expect(result.route).toBeNull();
  expect(request).toHaveBeenCalledWith(
    "/management-api/venue-service/routing/explain?productId=lager&zoneId=",
    "GET",
    undefined,
    { passive: false },
  );
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
