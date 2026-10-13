import { describe, expect, it, vi } from "vitest";
import { LiveData, type DashboardRequest } from "@waitron/dashboard-kit";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { OpeningHoursApi } from "./opening-hours-client.js";

const model: OpeningHoursModel = {
  businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
  clockRevision: 0,
  currentBusinessDay: "2026-10-12",
  pending: null,
  timeZone: "Europe/Madrid",
  clockReadable: true,
  dayCutover: "06:00",
  menus: [],
  departments: [],
  seasons: [],
  currentSeasonId: null,
};
const base = "/management-api/venue-service";

describe("OpeningHoursApi", () => {
  it("encodes write identities and sends colour and staff menus without changing the timetable body", async () => {
    const request = vi.fn(async (_path: string, method: string) =>
      method === "POST" ? { id: "p1" } : undefined,
    );
    const api = new OpeningHoursApi(request as DashboardRequest);
    const input = {
      name: "Lunch",
      colour: "blue" as const,
      menuId: "lunch",
      staffMenuIds: ["deli"],
    };
    const slot = { periodId: "p1", startsAt: "12:00", endsAt: "16:00" };
    expect(await api.createPeriod("d/1", input, 0)).toEqual({ id: "p1" });
    expect(await api.updatePeriod("p/1", input, 0)).toBeUndefined();
    await api.deletePeriod("p/1");
    await api.saveWeek("d/1", "s-1", [{ weekday: 1, slots: [slot] }], 0);
    expect(request.mock.calls).toEqual([
      [`${base}/departments/d%2F1/menu-periods`, "POST", { ...input, expectedClockRevision: 0 }],
      [`${base}/menu-periods/p%2F1`, "PATCH", { ...input, expectedClockRevision: 0 }],
      [`${base}/menu-periods/p%2F1`, "DELETE"],
      [
        `${base}/departments/d%2F1/menu-week`,
        "PUT",
        { expectedClockRevision: 0, seasonId: "s-1", days: [{ weekday: 1, slots: [slot] }] },
      ],
    ]);
  });

  it("sends each season write with the clock revision and reads a delete's impact", async () => {
    const request = vi.fn(async (_path: string, method: string) =>
      method === "GET" ? { departments: [] } : { id: "s/1", name: "Winter", startsOn: "12-01" },
    );
    const api = new OpeningHoursApi(request as DashboardRequest);
    const input = { name: "Winter", startsOn: "12-01" };
    await api.saveSeason("s/1", input, 3);
    await api.addSeason(input, 4);
    await api.deleteSeason("s/1", 5);
    expect(await api.readSeasonDeleteImpact("s/1")).toEqual({ departments: [] });
    expect(request.mock.calls).toEqual([
      [`${base}/seasons/s%2F1`, "PUT", { ...input, expectedClockRevision: 3 }],
      [`${base}/seasons`, "POST", { ...input, expectedClockRevision: 4 }],
      [`${base}/seasons/s%2F1`, "DELETE", { expectedClockRevision: 5 }],
      [`${base}/seasons/s%2F1/delete-impact`, "GET"],
    ]);
  });

  it("reads a year passively on the special-day calendar's dependencies, and re-reads it with the special days", async () => {
    const live = new LiveData();
    const year = { year: 2027, days: [] };
    const request = vi.fn(async () => year);
    const api = new OpeningHoursApi(request as DashboardRequest, live);
    const apply = vi.fn();
    const stop = api.watchYear(2027, apply, vi.fn(), vi.fn());
    try {
      await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(year));
      expect(request.mock.calls).toEqual([
        [`${base}/opening-hours/year?year=2027`, "GET", undefined, { passive: true }],
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
      api.specialDays.rereadWatches();
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    } finally {
      stop();
    }
  });

  it("asks for a year below 1000 with the four digits the server reads", async () => {
    const request = vi.fn(async () => ({ year: 100, days: [] }));
    const api = new OpeningHoursApi(request as DashboardRequest);
    const apply = vi.fn();
    const stop = api.watchYear(100, apply, vi.fn(), vi.fn());
    try {
      await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      expect(request.mock.calls).toEqual([
        [`${base}/opening-hours/year?year=0100`, "GET", undefined, { passive: true }],
      ]);
    } finally {
      stop();
    }
  });

  it("reads a month passively on the calendar's dependencies and its zones, and re-reads it with the special days", async () => {
    const live = new LiveData();
    const month = { month: "2030-12", days: [] };
    const request = vi.fn(async () => month);
    const api = new OpeningHoursApi(request as DashboardRequest, live);
    const apply = vi.fn();
    const stop = api.watchMonth("2030-12", apply, vi.fn(), vi.fn());
    try {
      await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(month));
      expect(request.mock.calls).toEqual([
        [`${base}/opening-hours/month?month=2030-12`, "GET", undefined, { passive: true }],
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
          "zone_service_policies",
          "floor_zones",
        ].map((type) => ({ type })),
      );
      api.specialDays.rereadWatches();
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    } finally {
      stop();
    }
  });

  it("re-reads a watched year with the special days when there is no live data", async () => {
    const request = vi.fn(async (path: string) =>
      path.includes("/year?") ? { year: 2027, days: [] } : model,
    );
    const api = new OpeningHoursApi(request as DashboardRequest);
    const apply = vi.fn();
    const stop = api.watchYear(2027, apply, vi.fn(), vi.fn());
    try {
      await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      api.rereadWithSpecialDays();
      await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    } finally {
      stop();
    }
  });

  it("lists the special days passively when asked to", async () => {
    const request = vi.fn(async () => []);
    const api = new OpeningHoursApi(request as DashboardRequest);
    await api.specialDays.listSpecialDays({ passive: true });
    await api.specialDays.listSpecialDays();
    expect(request.mock.calls).toEqual([
      [`${base}/special-days`, "GET", undefined, { passive: true }],
      [`${base}/special-days`, "GET", undefined, undefined],
    ]);
  });

  it("re-reads both the opening hours and the special-day calendar after a special-day write", async () => {
    const request = vi.fn(async (path: string) =>
      path.includes("named-days") ? { days: [] } : model,
    );
    const api = new OpeningHoursApi(request as DashboardRequest);
    const hours = vi.fn();
    const calendar = vi.fn();
    const stopHours = api.watchOpeningHours(hours, vi.fn(), vi.fn());
    const stopCalendar = api.specialDays.watchSpecialDays(
      "2026-10-01",
      "2026-10-31",
      calendar,
      vi.fn(),
      vi.fn(),
    );
    try {
      await vi.waitFor(() =>
        expect([hours.mock.calls.length, calendar.mock.calls.length]).toEqual([1, 1]),
      );
      api.rereadWithSpecialDays();
      await vi.waitFor(() =>
        expect([hours.mock.calls.length, calendar.mock.calls.length]).toEqual([2, 2]),
      );
    } finally {
      stopHours();
      stopCalendar();
    }
  });

  it("reads opening hours passively with staff-menu dependencies and refreshes after writes", async () => {
    const live = new LiveData();
    const request = vi.fn(async () => model);
    const api = new OpeningHoursApi(request as DashboardRequest, live);
    const apply = vi.fn();
    const stop = api.watchOpeningHours(apply, vi.fn(), vi.fn());
    try {
      await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(model));
      expect(live.interests).toEqual(
        [
          "menu_periods",
          "menu_period_staff_menus",
          "departments",
          "catalogues",
          "locations",
          "location_business_day_settings",
          "location_day_cutover_changes",
          "zone_service_policies",
          "floor_zones",
          "routing_cells",
          "routing_cell_periods",
          "categories",
          "category_details",
          "products",
          "seasons",
          "department_days",
          "department_day_ranges",
          "zone_days",
          "zone_day_ranges",
          "special_days",
          "special_day_dates",
        ].map((type) => ({ type })),
      );
      expect(request.mock.calls).toEqual([
        [`${base}/opening-hours`, "GET", undefined, { passive: true }],
      ]);
      api.rereadWatches();
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    } finally {
      stop();
    }
    api.rereadWatches();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each(["routing_cell_periods", "routing_cells", "categories", "products", "floor_zones"])(
    "re-reads opening hours when %s changes, so a period's routing uses stay current",
    async (type) => {
      const live = new LiveData();
      const named: OpeningHoursModel = {
        ...model,
        departments: [
          {
            id: "d1",
            name: "Restaurant",
            active: true,
            zones: [],
            seasonWeeks: [],
            periods: [
              {
                id: "p1",
                name: "Lunch",
                colour: "green",
                menuId: "lunch",
                staffMenuIds: [],
                endOffsetMinutes: 0,
                weekdays: [],
                routingUses: [{ rowKind: "category", rowLabel: "Cocktails", zoneName: null }],
              },
            ],
          },
        ],
      };
      const request = vi.fn().mockResolvedValueOnce(model).mockResolvedValueOnce(named);
      const api = new OpeningHoursApi(request as DashboardRequest, live);
      const apply = vi.fn();
      const stop = api.watchOpeningHours(apply, vi.fn(), vi.fn());
      try {
        await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(model));
        live.invalidate([{ type }]);
        await vi.waitFor(() => expect(apply).toHaveBeenLastCalledWith(named));
        expect(request).toHaveBeenCalledTimes(2);
      } finally {
        stop();
      }
    },
  );

  it("reports offline reads and their recovery without live data and detaches", async () => {
    const offline = new Error("offline");
    const request = vi
      .fn<() => Promise<OpeningHoursModel>>()
      .mockResolvedValueOnce(model)
      .mockRejectedValueOnce(offline)
      .mockResolvedValue(model);
    const api = new OpeningHoursApi(request as DashboardRequest);
    const apply = vi.fn();
    const failed = vi.fn();
    const recovered = vi.fn();
    const stop = api.watchOpeningHours(apply, failed, recovered);
    try {
      await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      api.rereadWatches();
      await vi.waitFor(() => expect(failed).toHaveBeenCalledWith(offline));
      api.rereadWatches();
      await vi.waitFor(() => expect(recovered).toHaveBeenCalledTimes(1));
      expect(apply).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
    api.rereadWatches();
    expect(request).toHaveBeenCalledTimes(3);
  });
});

it("encodes zone closing-time writes and preserves their bodies", async () => {
  const request = vi.fn(async () => undefined);
  const api = new OpeningHoursApi(request as DashboardRequest);
  const ranges = [{ startsAt: "23:00", endsAt: "06:00" }];
  const days = [{ weekday: 1, ranges }];
  await api.saveZoneWeek("z/1", "s-1", days, 0);
  expect(request.mock.calls).toEqual([
    [`${base}/zones/z%2F1/closed-week`, "PUT", { expectedClockRevision: 0, seasonId: "s-1", days }],
  ]);
});

it.each([
  "hours_week_cells",
  "hours_week_periods",
  "special_date_hours",
  "special_date_hours_periods",
  "station_fallbacks",
])("Opening hours ignores retired %s changes and still applies a period refresh", async (type) => {
  const live = new LiveData();
  let current = model;
  const request = vi.fn(async () => current);
  const api = new OpeningHoursApi(request as DashboardRequest, live);
  const received: OpeningHoursModel[] = [];
  const stop = api.watchOpeningHours((value) => received.push(value), vi.fn(), vi.fn());
  try {
    await vi.waitFor(() => expect(received).toEqual([model]));
    current = { ...model, dayCutover: "07:00" };
    live.invalidate([{ type }]);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(request).toHaveBeenCalledTimes(1);
    expect(received).toEqual([model]);
    live.invalidate([{ type: "menu_periods" }]);
    await vi.waitFor(() => expect(received).toEqual([model, current]));
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    stop();
  }
});

it("loads and refreshes the station picker as passive session activity", async () => {
  const live = new LiveData();
  const stations = [{ id: "bar", name: "Bar", active: true, isDefault: true }];
  const request = vi.fn(async () => stations);
  const api = new OpeningHoursApi(request as DashboardRequest, live);
  const apply = vi.fn();
  const stop = api.watchStations(apply, vi.fn(), vi.fn());
  try {
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(stations));
    live.invalidate([{ type: "kitchen_stations" }]);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(request.mock.calls).toEqual([
      ["/management-api/stations", "GET", undefined, { passive: true }],
      ["/management-api/stations", "GET", undefined, { passive: true }],
    ]);
  } finally {
    stop();
  }
  live.invalidate([{ type: "kitchen_stations" }]);
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(request).toHaveBeenCalledTimes(2);
});

it.each(["sections", "section_members", "catalogues"])(
  "refreshes worked-out station times when menu composition changes in %s",
  async (type) => {
    const live = new LiveData();
    const before = {
      always: null,
      days: [
        "2026-10-12",
        "2026-10-13",
        "2026-10-14",
        "2026-10-15",
        "2026-10-16",
        "2026-10-17",
        "2026-10-18",
      ].map((date) => ({ date, departments: [] })),
    };
    const after = {
      always: null,
      days: [
        {
          date: "2026-10-12",
          departments: [
            {
              departmentId: "dining",
              ranges: [{ periodId: "lunch", startsAt: "12:00", endsAt: "16:00" }],
            },
          ],
        },
        ...before.days.slice(1),
      ],
    };
    const request = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const api = new OpeningHoursApi(request as DashboardRequest, live);
    const received: unknown[] = [];
    const stop = api.watchStationTimes(
      "bar",
      "2026-10-12",
      "2026-10-18",
      false,
      (times) => received.push(times),
      vi.fn(),
      vi.fn(),
    );
    try {
      await vi.waitFor(() => expect(received).toEqual([before]));
      live.invalidate([{ type }]);
      await vi.waitFor(() => expect(received).toEqual([before, after]));
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  },
);

it("sends a season's edited department and zone weeks in one request with the clock revision", async () => {
  const request = vi.fn(async () => undefined);
  const api = new OpeningHoursApi(request as DashboardRequest);
  const departments = [
    {
      departmentId: "d1",
      days: [{ weekday: 1, slots: [{ periodId: "p1", startsAt: "13:00", endsAt: "16:00" }] }],
    },
  ];
  const zones = [
    { zoneId: "z1", days: [{ weekday: 2, ranges: [{ startsAt: "15:00", endsAt: "17:00" }] }] },
  ];
  await api.saveSeasonWeeks("s/1", { departments, zones }, 6);
  expect(request.mock.calls).toEqual([
    [`${base}/seasons/s%2F1/weeks`, "PUT", { departments, zones, expectedClockRevision: 6 }],
  ]);
});
