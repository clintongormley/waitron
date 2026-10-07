import { describe, expect, it, vi } from "vitest";
import { LiveData, type DashboardRequest } from "@waitron/dashboard-kit";
import type { MenuTimetableModel } from "../menu-timetable-types.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { MenuTimetableApi } from "./menu-timetable-client.js";

const model: MenuTimetableModel = {
  menus: [],
  timeZone: "Europe/Madrid",
  clockReadable: true,
  civilDate: "2026-10-07",
  departments: [],
  specialDates: [],
};
const PATH = "/management-api/venue-service/menu-timetable";

describe("MenuTimetableApi writes", () => {
  it("sends each write to its route with exactly its body, encoding ids into the path", async () => {
    const period = { id: "p1", name: "Mañanas", menuId: "m1" };
    const request = vi.fn(async (_path: string, method: string) =>
      method === "POST" || (method === "PUT" && _path.includes("/menu-periods/"))
        ? period
        : undefined,
    );
    const api = new MenuTimetableApi(request as DashboardRequest);
    const slot = { periodId: "p1", startsAt: "08:00", endsAt: "12:00" };
    expect(await api.setDepartmentMenus("d/1", ["m1", "m2"])).toBeUndefined();
    await api.setDepartmentAllDayMenu("d1", null);
    await api.setZoneAllDayMenu("z1", "m1");
    expect(await api.createPeriod("d1", { name: "Mañanas", menuId: "m1" })).toEqual(period);
    expect(await api.updatePeriod("p1", { name: "Mañanas", menuId: "m1" })).toEqual(period);
    await api.deletePeriod("p1");
    await api.saveWeek("d1", [{ weekday: 1, slots: [slot] }]);
    await api.saveDateMenus("s1", "d1", [slot]);
    await api.clearDateMenus("s1", "d1");
    await api.setZonePeriodMenu("z1", "p1", null);
    const base = "/management-api/venue-service";
    expect(request.mock.calls).toEqual([
      [`${base}/departments/d%2F1/menus`, "PUT", { menuIds: ["m1", "m2"] }],
      [`${base}/departments/d1/all-day-menu`, "PUT", { menuId: null }],
      [`${base}/zones/z1/all-day-menu`, "PUT", { menuId: "m1" }],
      [`${base}/departments/d1/menu-periods`, "POST", { name: "Mañanas", menuId: "m1" }],
      [`${base}/menu-periods/p1`, "PUT", { name: "Mañanas", menuId: "m1" }],
      [`${base}/menu-periods/p1`, "DELETE"],
      [`${base}/departments/d1/menu-week`, "PUT", { days: [{ weekday: 1, slots: [slot] }] }],
      [`${base}/special-dates/s1/menu-timetables/d1`, "PUT", { slots: [slot] }],
      [`${base}/special-dates/s1/menu-timetables/d1`, "DELETE"],
      [`${base}/zones/z1/period-menus/p1`, "PUT", { menuId: null }],
    ]);
  });
});

describe("MenuTimetableApi.watchTimetable", () => {
  it("subscribes to the timetable's tables, reads passively, and reads again after a write", async () => {
    const liveData = new LiveData();
    const request = vi.fn(async () => model);
    const apply = vi.fn();
    const api = new MenuTimetableApi(request as DashboardRequest, liveData);
    const detach = api.watchTimetable(apply, vi.fn(), vi.fn());
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(model));
    expect(QUERY_DEPENDENCIES["menu-timetable"]).toEqual([
      "department_menus",
      "department_all_day_menus",
      "zone_all_day_menus",
      "menu_periods",
      "menu_day_timetables",
      "menu_slots",
      "zone_period_menus",
      "special_dates",
      "departments",
      "floor_zones",
      "zone_service_policies",
      "catalogues",
      "locations",
    ]);
    expect(liveData.interests).toEqual(
      QUERY_DEPENDENCIES["menu-timetable"].map((type) => ({ type })),
    );
    expect(request.mock.calls).toEqual([[PATH, "GET", undefined, { passive: true }]]);
    api.rereadWatches();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    detach();
  });

  it("without live data reads once, again after a write, and reports a failed read and its recovery", async () => {
    const request = vi
      .fn<() => Promise<MenuTimetableModel>>()
      .mockResolvedValueOnce(model)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(model);
    const apply = vi.fn();
    const failed = vi.fn();
    const recovered = vi.fn();
    const api = new MenuTimetableApi(request as unknown as DashboardRequest);
    const detach = api.watchTimetable(apply, failed, recovered);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    api.rereadWatches();
    await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    api.rereadWatches();
    await vi.waitFor(() => expect(recovered).toHaveBeenCalledTimes(1));
    expect(apply).toHaveBeenCalledTimes(2);
    detach();
    api.rereadWatches();
    expect(request).toHaveBeenCalledTimes(3);
  });
});
