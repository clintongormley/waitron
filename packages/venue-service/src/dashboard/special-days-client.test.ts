import { describe, expect, it, vi } from "vitest";
import { LiveData, type DashboardRequest } from "@waitron/dashboard-kit";
import * as clients from "./special-days-client.js";
import type { SpecialDaysModel } from "../holiday-types.js";

const model: SpecialDaysModel = {
  businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
  clockRevision: 0,
  currentBusinessDay: "2026-10-09",
  pending: null,
  timeZone: "Europe/Madrid",
  dayCutover: "06:00",
  civilDate: "2026-10-09",
  clockReadable: true,
  days: [],
  holidayCoverage: [],
  holidaySources: [],
  area: {
    addressKey: "fixture-address",
    readiness: "ready",
    options: [],
    required: false,
    chosen: null,
  },
  localHolidaysPerYear: 2,
};
describe("SpecialDaysApi", () => {
  it("reads independent date ranges passively and refreshes when their sources change", async () => {
    const live = new LiveData();
    const request = vi.fn(async () => model);
    expect(clients).toHaveProperty("SpecialDaysApi", expect.any(Function));
    const api = new clients.SpecialDaysApi(request as DashboardRequest, live);
    const apply = vi.fn();
    const stop = api.watchSpecialDays("2026-10-01", "2026-10-31", apply, vi.fn(), vi.fn());
    const other = api.watchSpecialDays("2026-11-01", "2026-11-30", vi.fn(), vi.fn(), vi.fn());
    try {
      await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(model));
      expect(request.mock.calls).toEqual([
        [
          "/management-api/venue-service/named-days?from=2026-10-01&to=2026-10-31",
          "GET",
          undefined,
          { passive: true },
        ],
        [
          "/management-api/venue-service/named-days?from=2026-11-01&to=2026-11-30",
          "GET",
          undefined,
          { passive: true },
        ],
      ]);
      expect(live.interests).toEqual(
        [
          "departments",
          "tenants",
          "locations",
          "location_business_day_settings",
          "location_day_cutover_changes",
          "holiday_geographies",
          "seasons",
          "department_days",
          "department_day_ranges",
          "zone_days",
          "zone_day_ranges",
          "special_days",
          "special_day_dates",
        ].map((type) => ({ type })),
      );
      api.rereadWatches();
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    } finally {
      stop();
      other();
    }
    api.rereadWatches();
    expect(request).toHaveBeenCalledTimes(4);
  });
});

const facts = {
  name: "Christmas dinners",
  repeatsYearly: false,
  dates: [{ date: "2026-12-20", closedAllDay: true }],
};
it("sends a special day's facts to its routes with the clock revision and nothing else", async () => {
  const requests: unknown[][] = [];
  const saved = { id: "a/b", ...facts, paint: [], zonePaint: [] };
  const api = new clients.SpecialDaysApi((async (path, method, body, options) => {
    requests.push([path, method, body, options]);
    return method === "DELETE" ? undefined : saved;
  }) as DashboardRequest);
  expect(await api.saveSpecialDay(null, facts, () => true, 3)).toEqual(saved);
  expect(await api.saveSpecialDay("a/b", facts, () => true, 3)).toEqual(saved);
  expect(await api.readSpecialDay("a/b")).toEqual(saved);
  expect(await api.deleteSpecialDay("a/b", 3)).toBeUndefined();
  expect(requests).toEqual([
    [
      "/management-api/venue-service/special-days",
      "POST",
      { ...facts, expectedClockRevision: 3 },
      undefined,
    ],
    [
      "/management-api/venue-service/special-days/a%2Fb",
      "PUT",
      { ...facts, expectedClockRevision: 3 },
      undefined,
    ],
    ["/management-api/venue-service/special-days/a%2Fb", "GET", undefined, undefined],
    [
      "/management-api/venue-service/special-days/a%2Fb",
      "DELETE",
      { expectedClockRevision: 3 },
      undefined,
    ],
  ]);
});
it("a failed special-day write passes its refusal on", async () => {
  const methods: unknown[] = [];
  const api = new clients.SpecialDaysApi((async (_path, method) => {
    methods.push(method);
    throw new Error("write offline");
  }) as DashboardRequest);
  await expect(api.saveSpecialDay("source", facts, () => true, 0)).rejects.toThrow("write offline");
  expect(methods).toEqual(["PUT"]);
});
it("a dialog that has left cannot begin a special-day write", async () => {
  const methods: unknown[] = [];
  const api = new clients.SpecialDaysApi((async (_path, method) => {
    methods.push(method);
    return {};
  }) as DashboardRequest);
  expect(await api.saveSpecialDay("source", facts, () => false, 0)).toBeUndefined();
  expect(methods).toEqual([]);
});

it("the replacement named-day watch reads passively, reports failure and recovery, and stops when detached", async () => {
  const live = new LiveData();
  const updated = { ...model, area: { ...model.area, chosen: "aran" } };
  const answers: (SpecialDaysModel | Error)[] = [model, new Error("offline"), updated];
  const request = vi.fn(async () => {
    const next = answers.shift()!;
    if (next instanceof Error) throw next;
    return next;
  });
  const apply = vi.fn();
  const failed = vi.fn();
  const recovered = vi.fn();
  const stop = new clients.SpecialDaysApi(request as DashboardRequest, live).watchSpecialDays(
    "2026-10-01",
    "2026-10-31",
    apply,
    failed,
    recovered,
  );
  await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(model));
  expect(request.mock.calls).toEqual([
    [
      "/management-api/venue-service/named-days?from=2026-10-01&to=2026-10-31",
      "GET",
      undefined,
      { passive: true },
    ],
  ]);
  live.invalidate([{ type: "locations" }]);
  await vi.waitFor(() => expect(failed).toHaveBeenCalledWith(new Error("offline")));
  live.invalidate([{ type: "holiday_geographies" }]);
  await vi.waitFor(() => expect(apply).toHaveBeenLastCalledWith(updated));
  expect(recovered).toHaveBeenCalledTimes(1);
  stop();
  expect(live.interests).toEqual([]);
  live.invalidate([{ type: "special_days" }]);
  live.refresh();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(request).toHaveBeenCalledTimes(3);
});

it("the replacement named-day watch rereads after a write with live data and without it", async () => {
  for (const live of [new LiveData(), undefined]) {
    const request = vi.fn(async () => model);
    const api = new clients.SpecialDaysApi(request as DashboardRequest, live);
    const apply = vi.fn();
    const stop = api.watchSpecialDays("2026-10-01", "2026-10-31", apply, vi.fn(), vi.fn());
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    api.rereadWatches();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    stop();
    api.rereadWatches();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(request).toHaveBeenCalledTimes(2);
  }
});

it("retired station rows do not start another Calendar read", async () => {
  const live = new LiveData();
  const request = vi.fn(async () => model);
  const apply = vi.fn();
  const stop = new clients.SpecialDaysApi(request as DashboardRequest, live).watchSpecialDays(
    "2026-10-01",
    "2026-10-31",
    apply,
    vi.fn(),
    vi.fn(),
  );
  try {
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    live.invalidate([
      { type: "special_date_hours" },
      { type: "special_date_hours_periods" },
      { type: "hours_week_cells" },
      { type: "hours_week_periods" },
      { type: "station_fallbacks" },
      { type: "station_day_states" },
    ]);
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    live.invalidate([{ type: "special_days" }]);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    stop();
  }
});

it("a Calendar reread leaves a station-only observer's snapshot alone", async () => {
  const live = new LiveData();
  let stationReads = 0;
  const station = live.observe(
    {
      key: "station-only-control",
      dependencies: [{ type: "kitchen_stations" }],
      read: async () => ++stationReads,
    },
    () => {},
  );
  const request = vi.fn(async () => model);
  const apply = vi.fn();
  const api = new clients.SpecialDaysApi(request as DashboardRequest, live);
  const stop = api.watchSpecialDays("2026-10-01", "2026-10-31", apply, vi.fn(), vi.fn());
  try {
    await vi.waitFor(() => expect(station.snapshot.value).toBe(1));
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    api.rereadWatches();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(stationReads).toBe(1);
    expect(station.snapshot.value).toBe(1);
    live.invalidate([{ type: "kitchen_stations" }]);
    await vi.waitFor(() => expect(station.snapshot.value).toBe(2));
    expect(apply).toHaveBeenCalledTimes(2);
  } finally {
    stop();
    station.unsubscribe();
  }
});
it("lists the venue's special days with one GET", async () => {
  const requests: unknown[][] = [];
  const list = [{ id: "a", name: "Navidad", repeatsYearly: false, dates: facts.dates }];
  const api = new clients.SpecialDaysApi((async (path, method, body, options) => {
    requests.push([path, method, body, options]);
    return list;
  }) as DashboardRequest);
  expect(await api.listSpecialDays()).toEqual(list);
  expect(requests).toEqual([
    ["/management-api/venue-service/special-days", "GET", undefined, undefined],
  ]);
});
