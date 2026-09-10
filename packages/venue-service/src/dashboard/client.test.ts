import { describe, expect, it, vi } from "vitest";
import { createRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (status === 204 ? "" : JSON.stringify(body)),
  } as Response;
}

describe("VenueServiceApi", () => {
  it("loads the service model and its authoring choices", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ departments: [], zones: [], routes: [], hours: [], zoneMenus: [] }),
      )
      .mockResolvedValueOnce(jsonResponse([{ id: "m1", name: "Restaurant", active: true }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "c1", name: "Cocktails" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "s1", name: "Bar", isDefault: false }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "z1", name: "Upstairs" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "p1", descriptions: { en: "Negroni" } }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "i1", productId: "p1", grossPrice: "9.00" }]));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));

    await expect(api.load()).resolves.toMatchObject({
      menus: [{ id: "m1", name: "Restaurant" }],
      categories: [{ id: "c1", name: "Cocktails" }],
      stations: [{ id: "s1", name: "Bar" }],
      floorZones: [{ id: "z1", name: "Upstairs" }],
    });
    expect(fetchImpl.mock.calls.map(([path]) => path)).toEqual([
      "/management-api/venue-service",
      "/management-api/catalogues",
      "/management-api/categories",
      "/management-api/stations",
      "/management-api/zones",
      "/management-api/catalogues/m1/products",
      "/management-api/catalogues/m1/offers",
    ]);
  });

  it("writes departments, hours, zone policy, menu assignment and preparation route", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "d1" }, 201))
      .mockResolvedValue(jsonResponse(undefined, 204));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    await api.createDepartment({
      name: "Deli",
      tradingName: "Casa Delgado Deli",
      defaultServiceMode: "prepay",
    });
    await api.replaceHours("d1", [{ weekday: 1, opensAt: "09:00", closesAt: "18:00" }]);
    await api.configureZone("z1", { departmentId: "d1", serviceMode: null });
    await api.allowMenu("z1", "m1", { displayOrder: 0, makeDefault: true });
    await api.createRoute({ zoneId: "z1", categoryId: "c1", stationId: "s1" });
    await api.createMenu("Terrace drinks");
    await api.createMenuSection("m1", { name: { en: "Cocktails" }, displayOrder: 0 });
    await api.createMenuItem("m1", {
      productId: "p1",
      sectionId: "sec1",
      grossPrice: "11.00",
      displayOrder: 0,
    });

    expect(fetchImpl.mock.calls.map(([path, init]) => [path, init.method])).toEqual([
      ["/management-api/venue-service/departments", "POST"],
      ["/management-api/venue-service/departments/d1/hours", "PUT"],
      ["/management-api/venue-service/zones/z1", "PUT"],
      ["/management-api/venue-service/zones/z1/menus/m1", "PUT"],
      ["/management-api/venue-service/routes", "POST"],
      ["/management-api/catalogues", "POST"],
      ["/management-api/catalogues/m1/sections", "POST"],
      ["/management-api/catalogues/m1/items", "POST"],
    ]);
  });
});
