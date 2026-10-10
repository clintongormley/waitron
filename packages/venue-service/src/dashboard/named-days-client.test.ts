import { describe, expect, it, vi } from "vitest";
import { LiveData, type DashboardRequest } from "@waitron/dashboard-kit";
import * as clients from "./named-days-client.js";
import type { NamedDaysModel } from "../holiday-types.js";

const model: NamedDaysModel = {
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
describe("NamedDaysApi", () => {
  it("reads independent date ranges passively and refreshes when their sources change", async () => {
    const live = new LiveData();
    const request = vi.fn(async () => model);
    expect(clients).toHaveProperty("NamedDaysApi", expect.any(Function));
    const api = new clients.NamedDaysApi(request as DashboardRequest, live);
    const apply = vi.fn();
    const stop = api.watchNamedDays("2026-10-01", "2026-10-31", apply, vi.fn(), vi.fn());
    const other = api.watchNamedDays("2026-11-01", "2026-11-30", vi.fn(), vi.fn(), vi.fn());
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
          "special_dates",
          "menu_day_timetables",
          "menu_slots",
          "departments",
          "tenants",
          "locations",
          "holiday_geographies",
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

it("edits calendar metadata without reading or resending retained station cells", async () => {
  const { parseSpecialDateInput } = await import("../hours-rules.js");
  const requests: unknown[][] = [];
  const api = new clients.NamedDaysApi((async (path, method, body, options) => {
    requests.push([path, method, body, options]);
    if (method === "GET") throw new Error("station source offline");
    parseSpecialDateInput(body);
    return {};
  }) as DashboardRequest);
  const input = {
    date: "2026-10-02",
    name: "Edited",
    kind: "holiday" as const,
    repeats: false,
    ownHours: false,
    closeWholeVenue: false,
  };
  await api.saveDay("source", input);
  expect(requests).toEqual([
    ["/management-api/venue-service/special-dates/source", "PUT", input, undefined],
  ]);
});
it("a failed calendar write preserves its refusal without a station-source read", async () => {
  const methods: unknown[] = [];
  const api = new clients.NamedDaysApi((async (_path, method) => {
    methods.push(method);
    throw new Error("write offline");
  }) as DashboardRequest);
  await expect(
    api.saveDay("source", {
      date: "2026-10-02",
      name: "Edited",
      kind: "holiday",
      repeats: false,
      ownHours: false,
      closeWholeVenue: false,
    }),
  ).rejects.toThrow("write offline");
  expect(methods).toEqual(["PUT"]);
});
it("an editor that has left cannot begin a calendar write", async () => {
  const methods: unknown[] = [];
  const api = new clients.NamedDaysApi((async (_path, method) => {
    methods.push(method);
    return {};
  }) as DashboardRequest);
  await api.saveDay(
    "source",
    {
      date: "2026-10-02",
      name: "Edited",
      kind: "holiday",
      repeats: false,
      ownHours: false,
      closeWholeVenue: false,
    },
    () => false,
  );
  expect(methods).toEqual([]);
});

it("calendar metadata edits need no station-cell snapshot", async () => {
  const { parseSpecialDateInput } = await import("../hours-rules.js");
  const requests: unknown[][] = [];
  const api = new clients.NamedDaysApi((async (path, method, body, options) => {
    requests.push([path, method, body, options]);
    if (method === "GET") throw new Error("no station-cell snapshot");
    parseSpecialDateInput(body);
    return {};
  }) as DashboardRequest);
  const input = {
    date: "2026-10-02",
    name: "Edited",
    kind: "holiday" as const,
    repeats: false,
    ownHours: false,
    closeWholeVenue: false,
  };
  await api.saveDay("source", input);
  expect(requests).toEqual([
    ["/management-api/venue-service/special-dates/source", "PUT", input, undefined],
  ]);
});

it("the replacement named-day watch reads passively, reports failure and recovery, and stops when detached", async () => {
  const live = new LiveData();
  const updated = { ...model, area: { ...model.area, chosen: "aran" } };
  const answers: (NamedDaysModel | Error)[] = [model, new Error("offline"), updated];
  const request = vi.fn(async () => {
    const next = answers.shift()!;
    if (next instanceof Error) throw next;
    return next;
  });
  const apply = vi.fn();
  const failed = vi.fn();
  const recovered = vi.fn();
  const stop = new clients.NamedDaysApi(request as DashboardRequest, live).watchNamedDays(
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
  live.invalidate([{ type: "special_dates" }]);
  live.refresh();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(request).toHaveBeenCalledTimes(3);
});

it("the replacement named-day watch rereads after a write with live data and without it", async () => {
  for (const live of [new LiveData(), undefined]) {
    const request = vi.fn(async () => model);
    const api = new clients.NamedDaysApi(request as DashboardRequest, live);
    const apply = vi.fn();
    const stop = api.watchNamedDays("2026-10-01", "2026-10-31", apply, vi.fn(), vi.fn());
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
  const stop = new clients.NamedDaysApi(request as DashboardRequest, live).watchNamedDays(
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
    live.invalidate([{ type: "special_dates" }]);
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
  const api = new clients.NamedDaysApi(request as DashboardRequest, live);
  const stop = api.watchNamedDays("2026-10-01", "2026-10-31", apply, vi.fn(), vi.fn());
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
