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
