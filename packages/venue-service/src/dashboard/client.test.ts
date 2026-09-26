import { describe, expect, it, vi } from "vitest";
import { LiveData, createRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (status === 204 ? "" : JSON.stringify(body)),
  } as Response;
}

describe("VenueServiceApi", () => {
  it("sends edits to the existing department and route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    const department = {
      name: "Deli",
      tradingName: "Deli counter",
      defaultServiceMode: "prepay" as const,
    };
    const route = {
      zoneId: null,
      categoryId: "c1",
      productId: null,
      stationId: null,
      noPreparation: true,
    };
    await api.updateDepartment("d1", department);
    await api.updateRoute("r1", route);
    expect(
      fetchImpl.mock.calls.map(([path, init]) => [
        path,
        init.method,
        JSON.parse(init.body as string),
      ]),
    ).toEqual([
      ["/management-api/venue-service/departments/d1", "PATCH", department],
      ["/management-api/venue-service/routes/r1", "PUT", route],
    ]);
  });

  it("loads the service model and its authoring choices", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          departments: [],
          zones: [],
          routes: [],
          hours: [],
          zoneMenus: [],
          readiness: [],
        }),
      )
      .mockResolvedValueOnce(jsonResponse([{ id: "m1", name: "Restaurant", active: true }]))
      .mockResolvedValueOnce(
        jsonResponse([{ id: "c1", name: { en: "Cocktails" }, image: null, parentId: null }]),
      )
      .mockResolvedValueOnce(jsonResponse([{ id: "s1", name: "Bar", isDefault: false }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "z1", name: "Upstairs" }]))
      .mockResolvedValueOnce(
        jsonResponse([{ id: "p1", name: "Negroni", customerName: { en: "House Aperitivo" } }]),
      );
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));

    await expect(api.load()).resolves.toMatchObject({
      menus: [{ id: "m1", name: "Restaurant" }],
      categories: [{ id: "c1", name: { en: "Cocktails" }, image: null, parentId: null }],
      stations: [{ id: "s1", name: "Bar" }],
      floorZones: [{ id: "z1", name: "Upstairs" }],
      products: [{ id: "p1", name: "Negroni", customerName: { en: "House Aperitivo" } }],
    });
    expect(fetchImpl.mock.calls.map(([path]) => path)).toEqual([
      "/management-api/venue-service",
      "/management-api/catalogues",
      "/management-api/categories",
      "/management-api/stations",
      "/management-api/zones",
      "/management-api/catalogues/m1/products",
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
    await api.deactivateDepartment("d1");
    await api.replaceHours("d1", [{ weekday: 1, opensAt: "09:00", closesAt: "18:00" }]);
    await api.configureZone("z1", { departmentId: "d1", serviceMode: null });
    await api.allowMenu("z1", "m1", { displayOrder: 0, makeDefault: true });
    await api.createRoute({ zoneId: "z1", categoryId: "c1", stationId: "s1" });
    await api.deleteRoute("r1");

    expect(fetchImpl.mock.calls.map(([path, init]) => [path, init.method])).toEqual([
      ["/management-api/venue-service/departments", "POST"],
      ["/management-api/venue-service/departments/d1", "DELETE"],
      ["/management-api/venue-service/departments/d1/hours", "PUT"],
      ["/management-api/venue-service/zones/z1", "PUT"],
      ["/management-api/venue-service/zones/z1/menus/m1", "PUT"],
      ["/management-api/venue-service/routes", "POST"],
      ["/management-api/venue-service/routes/r1", "DELETE"],
    ]);
  });

  it("reads through its background copy passively, so a refresh keeps no session alive", async () => {
    const empty = {
      departments: [],
      zones: [],
      routes: [],
      hours: [],
      zoneMenus: [],
      readiness: [],
    };
    const fetchImpl = vi.fn((path: string) =>
      Promise.resolve(
        jsonResponse(path === "/management-api/venue-service" ? empty : [{ id: "m1" }]),
      ),
    );
    const onSuccess = vi.fn();
    const liveData = new LiveData();
    const api = new VenueServiceApi(
      createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch, onSuccess }),
      liveData,
    );
    const background = api.background;
    expect(background.liveData).toBe(liveData);

    await background.load();
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    for (const [, init] of fetchImpl.mock.calls as unknown as [string, RequestInit][]) {
      expect(new Headers(init.headers).get("x-waitron-live")).toBe("1");
    }
    expect(onSuccess).not.toHaveBeenCalled();

    fetchImpl.mockClear();
    await api.load();
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    for (const [, init] of fetchImpl.mock.calls as unknown as [string, RequestInit][]) {
      expect(new Headers(init.headers).get("x-waitron-live")).toBeNull();
    }
    expect(onSuccess).toHaveBeenCalledTimes(6);
  });
});
