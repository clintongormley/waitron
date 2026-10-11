import { describe, expect, it, vi } from "vitest";
import {
  LiveConnection,
  LiveData,
  createRequest,
  type DashboardRequest,
} from "@waitron/dashboard-kit";
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
    });
    await api.deactivateDepartment("d1");
    expect("replaceHours" in api).toBe(false);
    await api.configureZone("z1", { departmentId: "d1" });
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

describe("combined settings requests", () => {
  it("sends every department field and optional transfers in one active PUT", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }))
      .background;
    await api.saveDepartmentSettings("d1", {
      name: "Dining",
      tradingName: "Receipt",
      printTradingName: true,
      orderStart: "table",
      paidWhen: "ticket_then_pay",
      collectionNumber: "numbered",
      receiptPrintMode: "on_request",
      transfers: { receivingProfileId: "p1", destinationDepartmentIds: ["d2"] },
    });
    expect(
      fetchImpl.mock.calls.map(([path, init]) => [
        path,
        init.method,
        JSON.parse(init.body as string),
      ]),
    ).toEqual([
      [
        "/management-api/venue-service/departments/d1/settings",
        "PUT",
        {
          name: "Dining",
          tradingName: "Receipt",
          printTradingName: true,
          orderStart: "table",
          paidWhen: "ticket_then_pay",
          collectionNumber: "numbered",
          receiptPrintMode: "on_request",
          transfers: { receivingProfileId: "p1", destinationDepartmentIds: ["d2"] },
        },
      ],
    ]);
  });

  it("sends four inherited zone settings in one PUT and preserves a refusal", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "service_zone.not_found" } }, 404));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    await expect(
      api.saveZoneServiceSettings("z1", {
        orderStart: null,
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: null,
      }),
    ).rejects.toMatchObject({ code: "service_zone.not_found" });
    expect(
      fetchImpl.mock.calls.map(([path, init]) => [
        path,
        init.method,
        JSON.parse(init.body as string),
      ]),
    ).toEqual([
      [
        "/management-api/venue-service/zones/z1/service-settings",
        "PUT",
        {
          orderStart: null,
          paidWhen: null,
          collectionNumber: null,
          receiptPrintMode: null,
        },
      ],
    ]);
  });
});

it("creates a department through the real request with name only", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    jsonResponse(
      {
        id: "d3",
        name: "Brunch",
        tradingName: "Brunch",

        active: true,
      },
      201,
    ),
  );
  const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
  expect(await api.createDepartment({ name: "Brunch" })).toEqual({
    id: "d3",
    name: "Brunch",
    tradingName: "Brunch",

    active: true,
  });
  expect(fetchImpl).toHaveBeenCalledWith("/management-api/venue-service/departments", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: '{"name":"Brunch"}',
  });
});

it("watches one zone's master floor plan passively and rereads it when a plan table changes", async () => {
  const plan = { zoneId: "z/1", revision: 2, savedAt: null, tables: [], joins: [] };
  const live = new LiveData();
  const request = vi.fn(async () => structuredClone(plan));
  const api = new VenueServiceApi(request as unknown as DashboardRequest, live);
  const apply = vi.fn();
  const stop = api.watchZoneFloorPlan("z/1", apply, vi.fn(), vi.fn());
  try {
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(plan));
    expect(request.mock.calls).toEqual([
      ["/management-api/zones/z%2F1/floor-plan", "GET", undefined, { passive: true }],
    ]);
    expect(live.interests).toEqual(
      [
        "floor_plans",
        "floor_plan_tables",
        "floor_plan_joins",
        "floor_plan_join_tables",
        "dining_tables",
        "floor_zones",
      ].map((type) => ({ type })),
    );
    live.invalidate([{ type: "floor_plan_tables" }]);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  } finally {
    stop();
  }
  expect(live.interests).toEqual([]);
});

it.each(["Zone", "Department"] as const)(
  "hierarchy %s uses encoded impact GET and active DELETE with complete 200 responses",
  async (kind) => {
    const impact = {
      target: { id: "a/b", name: "Garden" },
      refusals: [
        {
          code: "zone.profile_in_use",
          params: { zoneId: "a/b", profileId: "p1" },
          targets: [{ id: "p1", name: "Terrace till" }],
        },
      ],
      ends: [],
      removes: [{ key: "tables", count: 1, targets: [{ id: "t1", name: "Table 1" }] }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(impact));
    const active = vi.fn();
    const api = new VenueServiceApi(
      createRequest({ fetchImpl: fetchImpl as typeof fetch, onSuccess: active }),
    );
    const path =
      kind === "Zone"
        ? "/management-api/zones/a%2Fb"
        : "/management-api/venue-service/departments/a%2Fb";
    expect(await api[`get${kind}DeleteImpact`]("a/b")).toEqual(impact);
    expect(fetchImpl.mock.calls[0]).toEqual([
      `${path}/delete-impact`,
      { method: "GET", credentials: "include", signal: expect.any(AbortSignal) },
    ]);
    expect(await api.background[`get${kind}DeleteImpact`]("a/b")).toEqual(impact);
    expect(new Headers(fetchImpl.mock.calls[1]![1].headers).get("x-waitron-live")).toBe("1");
    expect(active).toHaveBeenCalledOnce();
    expect(await api.background[`delete${kind}`]("a/b")).toEqual(impact);
    expect(fetchImpl.mock.calls[2]).toEqual([path, { method: "DELETE", credentials: "include" }]);
    expect(active).toHaveBeenCalledTimes(2);
  },
);

it.each(["Zone", "Department"] as const)(
  "hierarchy %s watch receives booking-related table changes, recovers from errors and disposes",
  async (kind) => {
    const before = { target: { id: "a/b", name: "Garden" }, refusals: [], ends: [], removes: [] };
    const blocked = {
      ...before,
      refusals: [
        {
          code: "table.booked",
          params: { tableId: "t1", date: "2026-10-11", time: "20:00" },
          targets: [{ id: "b1", name: "Ana · 2026-10-11 20:00" }],
        },
      ],
    };
    let model = before as import("@waitron/shared").DeleteImpact;
    let fail = false;
    const fetchImpl = vi.fn(async () =>
      fail
        ? jsonResponse({ error: { code: "management_session.expired" } }, 401)
        : jsonResponse(model),
    );
    const active = vi.fn();
    const live = new LiveData();
    const api = new VenueServiceApi(
      createRequest({ fetchImpl: fetchImpl as typeof fetch, onSuccess: active }),
      live,
    );
    const apply = vi.fn();
    const failed = vi.fn();
    const recovered = vi.fn();
    const stream = Object.assign(new EventTarget(), { close: vi.fn() });
    const open = vi.fn(() => stream);
    const connection = new LiveConnection(live, { open });
    const stop = api[`watch${kind}DeleteImpact`]("a/b", apply, failed, recovered);
    connection.start();
    try {
      await vi.waitFor(() => expect(apply).toHaveBeenLastCalledWith(before));
      expect(live.interests.some(({ type }) => type === "bookings")).toBe(false);
      expect(live.interests).toContainEqual({ type: "dining_tables" });
      model = blocked;
      stream.dispatchEvent(
        new MessageEvent("change", { data: JSON.stringify([{ type: "dining_tables", id: "t1" }]) }),
      );
      await vi.waitFor(() => expect(apply).toHaveBeenLastCalledWith(blocked));
      fail = true;
      live.invalidate([{ type: "department_transfer_requests" }]);
      await vi.waitFor(() =>
        expect(failed).toHaveBeenCalledWith(
          expect.objectContaining({ code: "management_session.expired" }),
        ),
      );
      fail = false;
      model = before;
      live.invalidate([{ type: "device_profile_zones" }]);
      await vi.waitFor(() => expect(recovered).toHaveBeenCalledOnce());
      expect(apply).toHaveBeenLastCalledWith(before);
      expect(active).not.toHaveBeenCalled();
      expect(fetchImpl.mock.calls).toHaveLength(4);
      expect(open).toHaveBeenCalledOnce();
      expect(stream.close).not.toHaveBeenCalled();
    } finally {
      stop();
      connection.stop();
    }
    expect(live.interests).toEqual([]);
    const count = fetchImpl.mock.calls.length;
    live.invalidate([{ type: "floor_zones" }]);
    await Promise.resolve();
    expect(fetchImpl.mock.calls).toHaveLength(count);
  },
);

it.each(["Zone", "Department"] as const)(
  "hierarchy %s watch ignores a disposed generation's late answer",
  async (kind) => {
    const pending: ((model: import("@waitron/shared").DeleteImpact) => void)[] = [];
    const request = (() =>
      new Promise<import("@waitron/shared").DeleteImpact>((resolve) =>
        pending.push(resolve),
      )) as unknown as DashboardRequest;
    const api = new VenueServiceApi(request, new LiveData());
    const oldApply = vi.fn();
    const apply = vi.fn();
    const stopOld = api[`watch${kind}DeleteImpact`]("a/b", oldApply, vi.fn(), vi.fn());
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    stopOld();
    const stop = api[`watch${kind}DeleteImpact`]("a/b", apply, vi.fn(), vi.fn());
    try {
      await vi.waitFor(() => expect(pending).toHaveLength(2));
      const newest = { target: { id: "new", name: "New" }, refusals: [], ends: [], removes: [] };
      pending[1]!(newest);
      await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(newest));
      pending[0]!({ ...newest, target: { id: "a/b", name: "Old" } });
      await Promise.resolve();
      expect(oldApply).not.toHaveBeenCalled();
      expect(apply).toHaveBeenCalledOnce();
    } finally {
      stop();
    }
  },
);
