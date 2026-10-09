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
  area: { options: [], required: false, chosen: null },
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
          "local_holidays",
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
