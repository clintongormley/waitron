import { describe, expect, it, vi } from "vitest";
import { LiveData, type DashboardRequest } from "@waitron/dashboard-kit";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { OpeningHoursApi } from "./opening-hours-client.js";

const model: OpeningHoursModel = {
  dayCutover: "06:00",
  menus: [],
  departments: [],
  specialDates: [],
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
    await api.clearDateMenus("s/1", "d/1");
    expect(request.mock.calls).toEqual([
      [`${base}/departments/d%2F1/menu-periods`, "POST", input],
      [`${base}/menu-periods/p%2F1`, "PATCH", input],
      [`${base}/menu-periods/p%2F1`, "DELETE"],
      [`${base}/departments/d%2F1/menu-week`, "PUT", { days: [{ weekday: 1, slots: [slot] }] }],
      [`${base}/special-dates/s%2F1/menu-timetables/d%2F1`, "PUT", { slots: [slot] }],
      [`${base}/special-dates/s%2F1/menu-timetables/d%2F1`, "DELETE"],
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
