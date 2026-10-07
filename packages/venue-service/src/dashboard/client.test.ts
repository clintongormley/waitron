import { describe, expect, it, vi } from "vitest";
import { LiveData, createRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (status === 204 ? "" : JSON.stringify(body)),
    json: async () => body,
  } as Response;
}

describe("VenueServiceApi", () => {
  it("createZone POSTs { name, departmentId } and returns the id (201)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "z1" }, 201));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    expect(await api.createZone({ name: "Comedor", departmentId: "d1" })).toEqual({ id: "z1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/venue-service/zones", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Comedor", departmentId: "d1" }),
    });
  });

  it("createZone can carry an optional displayOrder", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "z2" }, 201));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    expect(await api.createZone({ name: "Terraza", departmentId: "d1", displayOrder: 3 })).toEqual({
      id: "z2",
    });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/venue-service/zones", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Terraza", departmentId: "d1", displayOrder: 3 }),
    });
  });

  it("createZone rejects with { code } on a non-2xx (name already taken)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "zone.name_taken" } }, 409));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    await expect(api.createZone({ name: "Comedor", departmentId: "d1" })).rejects.toMatchObject({
      code: "zone.name_taken",
    });
  });

  it("loads transfer settings and choices and sends the exact directional settings", async () => {
    const settings = {
      departmentId: "d1",
      receivingProfileId: "p1",
      destinationDepartmentIds: ["d2"],
    };
    const profiles = [{ id: "p1", name: "Counter" }];
    const fetchImpl = vi.fn(async (path: string, init: RequestInit) => {
      if (init.method === "PUT") {
        expect(JSON.parse(init.body as string)).toEqual({
          receivingProfileId: null,
          destinationDepartmentIds: [],
        });
        return jsonResponse(undefined, 204);
      }
      return jsonResponse(path.endsWith("/profiles") ? profiles : settings);
    });
    const api = new VenueServiceApi(
      createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    );
    expect(await api.loadDepartmentTransfers("d1")).toEqual({ ...settings, profiles });
    await api.saveDepartmentTransfers("d1", {
      receivingProfileId: null,
      destinationDepartmentIds: [],
    });
    expect(fetchImpl.mock.calls.map(([path]) => path)).toEqual([
      "/management-api/venue-service/departments/d1/transfers",
      "/management-api/venue-service/departments/d1/transfers/profiles",
      "/management-api/venue-service/departments/d1/transfers",
    ]);
  });

  it("renames a floor zone through the zone route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    await api.updateZone("z1", { name: "Garden room" });
    expect(
      fetchImpl.mock.calls.map(([path, init]) => [
        path,
        init.method,
        JSON.parse(init.body as string),
      ]),
    ).toEqual([["/management-api/zones/z1", "PATCH", { name: "Garden room" }]]);
  });

  it("enables a disabled floor zone through the zone route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    await api.updateZone("z1", { active: true });
    expect(
      fetchImpl.mock.calls.map(([path, init]) => [
        path,
        init.method,
        JSON.parse(init.body as string),
      ]),
    ).toEqual([["/management-api/zones/z1", "PATCH", { active: true }]]);
  });

  it("removes a floor zone through the zone route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    await api.deactivateZone("z1");
    expect(fetchImpl.mock.calls.map(([path, init]) => [path, init.method])).toEqual([
      ["/management-api/zones/z1", "DELETE"],
    ]);
  });

  it("writes one department field and clears one zone override", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    await api.setDepartmentSalePolicyField("d1", "receiptPrintMode", "on_request");
    await api.setZoneSalePolicyOverride("z1", "paidWhen", null);
    expect(
      fetchImpl.mock.calls.map(([path, init]) => [
        path,
        init.method,
        JSON.parse(init.body as string),
      ]),
    ).toEqual([
      [
        "/management-api/venue-service/departments/d1/sale-policy/receiptPrintMode",
        "PATCH",
        { value: "on_request" },
      ],
      ["/management-api/venue-service/zones/z1/sale-policy/paidWhen", "PATCH", { value: null }],
    ]);
  });

  it("loads a supervisor's settings from the settings-only route", async () => {
    const settings = {
      settings: { editSentLines: true },
      kitchenTicketGrouping: "combined",
      printHeldWork: false,
      releaseReminderMinutes: 10,
      clearingWorkflow: false,
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(settings));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    expect(await api.loadSettingsReadOnly()).toEqual(settings);
    expect(fetchImpl.mock.calls.map(([path, init]) => [path, init.method])).toEqual([
      ["/management-api/venue-service/settings", "GET"],
    ]);
  });
  it("stores whether tables need clearing after Finish table", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    await api.saveClearingWorkflow(true);
    expect(
      fetchImpl.mock.calls.map(([path, init]) => [
        path,
        init.method,
        JSON.parse(init.body as string),
      ]),
    ).toEqual([
      [
        "/management-api/venue-service/settings/clearing-workflow",
        "PUT",
        { clearingWorkflow: true },
      ],
    ]);
  });

  it("loads only the settings from the venue-service read", async () => {
    const model = {
      departments: [{ id: "d1" }],
      zones: [],
      readiness: [],
      settings: { editSentLines: false },
      kitchenTicketGrouping: "separate",
      printHeldWork: true,
      releaseReminderMinutes: null,
      clearingWorkflow: true,
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(model));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    expect(await api.loadSettings()).toEqual({
      settings: { editSentLines: false },
      kitchenTicketGrouping: "separate",
      printHeldWork: true,
      releaseReminderMinutes: null,
      clearingWorkflow: true,
    });
    expect(fetchImpl.mock.calls.map(([path, init]) => [path, init.method])).toEqual([
      ["/management-api/venue-service", "GET"],
    ]);
  });

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

  it("enables a disabled department through the department edit route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    await api.updateDepartment("d1", { active: true });
    expect(
      fetchImpl.mock.calls.map(([path, init]) => [
        path,
        init.method,
        JSON.parse(init.body as string),
      ]),
    ).toEqual([["/management-api/venue-service/departments/d1", "PATCH", { active: true }]]);
  });

  it("reads the exact removal impact before asking a manager to confirm", async () => {
    const impact = { zones: [{ id: "z1", name: "Dining room", activeTableCount: 2 }] };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(impact));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    expect(await api.departmentRemovalImpact("d1")).toEqual(impact);
    expect(fetchImpl.mock.calls.map(([path, init]) => [path, init.method ?? "GET"])).toEqual([
      ["/management-api/venue-service/departments/d1/removal-impact", "GET"],
    ]);
  });

  it("reads an unconfigured zone's removal impact", async () => {
    const impact = { zones: [{ id: "z2", name: "Deli counter", activeTableCount: 2 }] };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(impact));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    expect(await api.zoneRemovalImpact("z2")).toEqual(impact);
    expect(fetchImpl.mock.calls.map(([path, init]) => [path, init.method ?? "GET"])).toEqual([
      ["/management-api/venue-service/zones/z2/removal-impact", "GET"],
    ]);
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
          readiness: [],
        }),
      )
      .mockResolvedValueOnce(jsonResponse([{ id: "z1", name: "Upstairs", active: false }]));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));

    const loaded = await api.load();
    expect(loaded).toMatchObject({
      floorZones: [{ id: "z1", name: "Upstairs", active: false }],
    });
    expect(loaded).not.toHaveProperty("menus");
    expect(fetchImpl.mock.calls.map(([path]) => path)).toEqual([
      "/management-api/venue-service",
      "/management-api/zones?includeInactive=true",
    ]);
  });

  it("writes departments and zone policy, and has no per-zone menu write", async () => {
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
    expect("replaceHours" in api).toBe(false);
    await api.configureZone("z1", { departmentId: "d1", serviceMode: null });
    expect("allowMenu" in api).toBe(false);

    expect(fetchImpl.mock.calls.map(([path, init]) => [path, init.method])).toEqual([
      ["/management-api/venue-service/departments", "POST"],
      ["/management-api/venue-service/departments/d1", "DELETE"],
      ["/management-api/venue-service/zones/z1", "PUT"],
    ]);
  });

  it("reads through its background copy passively, so a refresh keeps no session alive", async () => {
    const empty = {
      departments: [],
      zones: [],
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
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchImpl.mock.calls as unknown as [string, RequestInit][]) {
      expect(new Headers(init.headers).get("x-waitron-live")).toBe("1");
    }
    expect(onSuccess).not.toHaveBeenCalled();

    fetchImpl.mockClear();
    await api.load();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchImpl.mock.calls as unknown as [string, RequestInit][]) {
      expect(new Headers(init.headers).get("x-waitron-live")).toBeNull();
    }
    expect(onSuccess).toHaveBeenCalledTimes(2);
  });
});
