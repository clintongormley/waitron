import { describe, expect, it, vi } from "vitest";
import { LiveData, type DashboardRequest } from "@waitron/dashboard-kit";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { OpeningHoursApi } from "./opening-hours-client.js";

const model: OpeningHoursModel = {
  timeZone: "Europe/Madrid",
  clockReadable: true,
  dayCutover: "06:00",
  menus: [],
  departments: [],
  namedDays: [],
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
    expect(await api.createPeriod("d/1", input)).toEqual({ id: "p1" });
    expect(await api.updatePeriod("p/1", input)).toBeUndefined();
    await api.deletePeriod("p/1");
    await api.saveWeek("d/1", [{ weekday: 1, slots: [slot] }]);
    await api.saveDateMenus("s/1", "d/1", [slot]);
    expect(request.mock.calls).toEqual([
      [`${base}/departments/d%2F1/menu-periods`, "POST", input],
      [`${base}/menu-periods/p%2F1`, "PATCH", input],
      [`${base}/menu-periods/p%2F1`, "DELETE"],
      [`${base}/departments/d%2F1/menu-week`, "PUT", { days: [{ weekday: 1, slots: [slot] }] }],
      [`${base}/special-dates/s%2F1/menu-timetables/d%2F1`, "PUT", { slots: [slot] }],
    ]);
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
          "menu_day_timetables",
          "menu_slots",
          "special_dates",
          "departments",
          "catalogues",
          "locations",
          "zone_closed_times",
          "zone_service_policies",
          "floor_zones",
          "routing_cells",
          "routing_cell_periods",
          "categories",
          "category_details",
          "products",
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
            week: [],
            dates: [],
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
  await api.saveZoneWeek("z/1", days);
  await api.saveZoneDate("s/1", "z/1", ranges);
  expect(request.mock.calls).toEqual([
    [`${base}/zones/z%2F1/closed-week`, "PUT", { days }],
    [`${base}/special-dates/s%2F1/zone-closed-times/z%2F1`, "PUT", { ranges }],
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
