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
  it("sends edits to the existing department", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    const department = {
      name: "Deli",
      tradingName: "Deli counter",
      defaultServiceMode: "prepay" as const,
    };
    await api.updateDepartment("d1", department);
    expect(
      fetchImpl.mock.calls.map(([path, init]) => [
        path,
        init.method,
        JSON.parse(init.body as string),
      ]),
    ).toEqual([["/management-api/venue-service/departments/d1", "PATCH", department]]);
  });

  it("stores whether items already sent to the kitchen may be changed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    await api.saveSettings({ editSentLines: false });
    expect(
      fetchImpl.mock.calls.map(([path, init]) => [
        path,
        init.method,
        JSON.parse(init.body as string),
      ]),
    ).toEqual([["/management-api/venue-service/settings", "PUT", { editSentLines: false }]]);
  });

  it("stores how identical dishes print on a kitchen ticket", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    await api.saveKitchenTicketGrouping("separate");
    expect(
      fetchImpl.mock.calls.map(([path, init]) => [
        path,
        init.method,
        JSON.parse(init.body as string),
      ]),
    ).toEqual([
      [
        "/management-api/venue-service/settings/kitchen-ticket-grouping",
        "PUT",
        { kitchenTicketGrouping: "separate" },
      ],
    ]);
  });

  it("stores whether held groups print in advance", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    await api.savePrintHeldWork(true);
    expect(
      fetchImpl.mock.calls.map(([path, init]) => [
        path,
        init.method,
        JSON.parse(init.body as string),
      ]),
    ).toEqual([
      ["/management-api/venue-service/settings/print-held-work", "PUT", { printHeldWork: true }],
    ]);
  });

  it("stores the release reminder's minutes, or none for off", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    await api.saveReleaseReminderMinutes(15);
    await api.saveReleaseReminderMinutes(null);
    expect(
      fetchImpl.mock.calls.map(([path, init]) => [
        path,
        init.method,
        JSON.parse(init.body as string),
      ]),
    ).toEqual([
      [
        "/management-api/venue-service/settings/release-reminder-minutes",
        "PUT",
        { releaseReminderMinutes: 15 },
      ],
      [
        "/management-api/venue-service/settings/release-reminder-minutes",
        "PUT",
        { releaseReminderMinutes: null },
      ],
    ]);
  });

  it("loads the service model and its authoring choices", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          departments: [],
          zones: [],
          hours: [],
          zoneMenus: [],
          readiness: [],
        }),
      )
      .mockResolvedValueOnce(jsonResponse([{ id: "m1", name: "Restaurant", active: true }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "z1", name: "Upstairs" }]))
      .mockResolvedValueOnce(
        jsonResponse([{ id: "t1", label: "Till", kind: "till", active: true }]),
      );
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));

    await expect(api.load()).resolves.toMatchObject({
      menus: [{ id: "m1", name: "Restaurant" }],
      floorZones: [{ id: "z1", name: "Upstairs" }],
      devices: [{ id: "t1", label: "Till", kind: "till", active: true }],
    });
    expect(fetchImpl.mock.calls.map(([path]) => path)).toEqual([
      "/management-api/venue-service",
      "/management-api/catalogues",
      "/management-api/zones",
      "/management-api/devices",
    ]);
  });

  it("writes departments, hours, zone policy and menu assignment", async () => {
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

    expect(fetchImpl.mock.calls.map(([path, init]) => [path, init.method])).toEqual([
      ["/management-api/venue-service/departments", "POST"],
      ["/management-api/venue-service/departments/d1", "DELETE"],
      ["/management-api/venue-service/departments/d1/hours", "PUT"],
      ["/management-api/venue-service/zones/z1", "PUT"],
      ["/management-api/venue-service/zones/z1/menus/m1", "PUT"],
    ]);
  });

  it("sets and clears a device's default zone through the same device endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    await api.setDeviceDefaultZone("till-1", "terrace");
    await api.clearDeviceDefaultZone("till-1");
    expect(fetchImpl.mock.calls.map(([path, init]) => [path, init.method, init.body])).toEqual([
      [
        "/management-api/venue-service/devices/till-1/default-zone",
        "PUT",
        JSON.stringify({ zoneId: "terrace" }),
      ],
      ["/management-api/venue-service/devices/till-1/default-zone", "DELETE", undefined],
    ]);
  });

  it("reads through its background copy passively, so a refresh keeps no session alive", async () => {
    const empty = {
      departments: [],
      zones: [],
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
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchImpl.mock.calls as unknown as [string, RequestInit][]) {
      expect(new Headers(init.headers).get("x-waitron-live")).toBe("1");
    }
    expect(onSuccess).not.toHaveBeenCalled();

    fetchImpl.mockClear();
    await api.load();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchImpl.mock.calls as unknown as [string, RequestInit][]) {
      expect(new Headers(init.headers).get("x-waitron-live")).toBeNull();
    }
    expect(onSuccess).toHaveBeenCalledTimes(4);
  });
});
