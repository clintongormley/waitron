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
  area: { addressKey: "fixture-address", options: [], required: false, chosen: null },
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
          "special_date_hours",
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

it("preserves non-default station hours when editing metadata and passes real request validation", async () => {
  const { parseSpecialDateInput } = await import("../hours-rules.js");
  const cells = [
    {
      subject: { kind: "station", id: "bar" },
      cell: {
        mode: "periods",
        periods: [
          { id: "00000000-0000-4000-8000-000000000001", opensAt: "12:00", closesAt: "16:00" },
        ],
      },
    },
    { subject: { kind: "station", id: "default" }, cell: { mode: "closed", periods: [] } },
  ];
  const requests: unknown[][] = [];
  const api = new clients.NamedDaysApi((async (path, method, body, options) => {
    requests.push([path, method, body, options]);
    if (method === "GET")
      return {
        timeZone: "Europe/Madrid",
        dayCutover: "06:00",
        civilDate: "2026-10-07",
        clockReadable: true,
        departments: [],
        subjects: [
          { kind: "station", id: "bar", name: "Bar", active: true, isDefault: false },
          { kind: "station", id: "default", name: "Default", active: true, isDefault: true },
        ],
        week: [],
        days: [],
        specialDates: [],
        specialCells: [{ specialDateId: "source", cells }],
        holidayCoverage: [],
        holidaySources: [],
      };
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
  await (
    api.saveDay as unknown as (id: string, value: typeof input, source: unknown) => Promise<unknown>
  )("source", input, {
    id: "source",
    date: "2026-10-01",
    name: "Original",
    kind: "holiday",
    repeats: false,
    ownHours: false,
    closeWholeVenue: false,
    hasStationHours: true,
  });
  expect(requests).toEqual([
    [
      "/management-api/venue-service/hours?from=2026-10-01&to=2026-10-01",
      "GET",
      undefined,
      { passive: true },
    ],
    [
      "/management-api/venue-service/special-dates/source",
      "PUT",
      { ...input, cells: [cells[0]] },
      undefined,
    ],
  ]);
});
it("a failed station-source read prevents a metadata write", async () => {
  const methods: unknown[] = [];
  const api = new clients.NamedDaysApi((async (_path, method) => {
    methods.push(method);
    throw new Error("source offline");
  }) as DashboardRequest);
  await expect(
    (api.saveDay as unknown as (id: string, input: unknown, source: unknown) => Promise<unknown>)(
      "source",
      {
        date: "2026-10-02",
        name: "Edited",
        kind: "holiday",
        repeats: false,
        ownHours: false,
        closeWholeVenue: false,
      },
      { id: "source", date: "2026-10-01", hasStationHours: true },
    ),
  ).rejects.toThrow("source offline");
  expect(methods).toEqual(["GET"]);
});
it("a station read that settles after its editor leaves cannot begin the write", async () => {
  const methods: unknown[] = [];
  let finish!: (value: unknown) => void;
  let current = true;
  const api = new clients.NamedDaysApi((async (_path, method) => {
    methods.push(method);
    if (method === "GET")
      return new Promise<unknown>((resolve) => {
        finish = resolve;
      });
    return {};
  }) as DashboardRequest);
  const saving = (
    api.saveDay as unknown as (
      id: string,
      input: unknown,
      source: unknown,
      current: () => boolean,
    ) => Promise<unknown>
  )(
    "source",
    {
      date: "2026-10-02",
      name: "Edited",
      kind: "holiday",
      repeats: false,
      ownHours: false,
      closeWholeVenue: false,
    },
    { id: "source", date: "2026-10-01", hasStationHours: true },
    () => current,
  );
  await expect.poll(() => methods).toEqual(["GET"]);
  current = false;
  finish({ subjects: [], specialCells: [] });
  await saving;
  expect(methods).toEqual(["GET"]);
});

it("preserves current station cells when the calendar snapshot says there are none", async () => {
  const { parseSpecialDateInput } = await import("../hours-rules.js");
  const cell = {
    subject: { kind: "station" as const, id: "bar" },
    cell: {
      mode: "periods" as const,
      periods: [
        { id: "00000000-0000-4000-8000-000000000001", opensAt: "12:00", closesAt: "16:00" },
      ],
    },
  };
  const requests: unknown[][] = [];
  const api = new clients.NamedDaysApi((async (path, method, body, options) => {
    requests.push([path, method, body, options]);
    if (method === "GET")
      return {
        timeZone: "Europe/Madrid",
        dayCutover: "06:00",
        civilDate: "2026-10-07",
        clockReadable: true,
        departments: [],
        subjects: [{ kind: "station", id: "bar", name: "Bar", active: true, isDefault: false }],
        week: [],
        days: [],
        specialDates: [],
        specialCells: [{ specialDateId: "source", cells: [cell] }],
        holidayCoverage: [],
        holidaySources: [],
      };
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
  await api.saveDay("source", input, {
    id: "source",
    date: "2026-10-01",
    name: "Original",
    kind: "holiday",
    repeats: false,
    ownHours: false,
    closeWholeVenue: false,
    hasStationHours: false,
  });
  expect(requests).toEqual([
    [
      "/management-api/venue-service/hours?from=2026-10-01&to=2026-10-01",
      "GET",
      undefined,
      { passive: true },
    ],
    [
      "/management-api/venue-service/special-dates/source",
      "PUT",
      { ...input, cells: [cell] },
      undefined,
    ],
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
