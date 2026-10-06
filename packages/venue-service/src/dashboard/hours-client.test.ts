import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveData, type DashboardRequest } from "@waitron/dashboard-kit";
import type { HoursModel, SpecialDateInput, WeekDay } from "../hours-types.js";
import { HoursApi } from "./hours-client.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";

const model = (civilDate: string): HoursModel => ({
  timeZone: "Europe/Madrid",
  dayCutover: "06:00",
  civilDate,
  clockReadable: true,
  subjects: [],
  week: [],
  days: [],
  specialDates: [],
  specialCells: [],
});

const HOURS_PATH = "/management-api/venue-service/hours?from=2030-10-01&to=2030-10-31";

afterEach(() => {
  vi.useRealTimers();
});

/** Lets pending reads settle without moving fake time, which `vi.waitFor` would advance. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}

describe("HoursApi writes", () => {
  it("sends each write to its route and returns what the server saved", async () => {
    const saved = { id: "d1", date: "2030-10-15", name: "Party", colour: "red" };
    const request = vi.fn(async (path: string, method: string) =>
      method === "POST" && path.endsWith("/duplicate")
        ? [saved]
        : method === "GET"
          ? model("2030-10-01")
          : method === "DELETE" || path.endsWith("/week")
            ? undefined
            : saved,
    );
    const api = new HoursApi(request as DashboardRequest);
    const subject = { kind: "department" as const, id: "dept" };
    const days: WeekDay[] = [];
    const input: SpecialDateInput = {
      date: "2030-10-15",
      name: "Party",
      colour: "red",
      closeWholeVenue: false,
      cells: [],
    };
    expect(await api.load("2030-10-01", "2030-10-31")).toEqual(model("2030-10-01"));
    expect(await api.saveWeek(subject, days)).toBeUndefined();
    expect(await api.saveDate(null, input)).toEqual(saved);
    expect(await api.saveDate("d1", input)).toEqual(saved);
    expect(await api.duplicateDate("d1", ["2030-10-22"])).toEqual([saved]);
    expect(await api.deleteDate("d1")).toBeUndefined();
    expect(request.mock.calls).toEqual([
      [HOURS_PATH, "GET", undefined, { passive: false }],
      ["/management-api/venue-service/hours/week", "PUT", { subject, days }],
      ["/management-api/venue-service/special-dates", "POST", input],
      ["/management-api/venue-service/special-dates/d1", "PUT", input],
      [
        "/management-api/venue-service/special-dates/d1/duplicate",
        "POST",
        { dates: ["2030-10-22"] },
      ],
      ["/management-api/venue-service/special-dates/d1", "DELETE"],
    ]);
  });

  it("encodes ids and range values into the path", async () => {
    const request = vi.fn<(path: string) => Promise<undefined>>(async () => undefined);
    const api = new HoursApi(request as DashboardRequest);
    await api.deleteDate("a/b");
    await api.load("2030-10-01&x=1", "2030-10-31");
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      "/management-api/venue-service/special-dates/a%2Fb",
      "/management-api/venue-service/hours?from=2030-10-01%26x%3D1&to=2030-10-31",
    ]);
  });
});

describe("HoursApi.watchHours", () => {
  it("subscribes to exactly the Hours sources and reads passively", async () => {
    const liveData = new LiveData();
    const request = vi.fn(async () => model("2030-10-06"));
    const apply = vi.fn();
    const detach = new HoursApi(request as DashboardRequest, liveData).watchHours(
      "2030-10-01",
      "2030-10-31",
      apply,
      vi.fn(),
      vi.fn(),
    );
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(model("2030-10-06")));
    expect(liveData.interests).toEqual(QUERY_DEPENDENCIES.hours.map((type) => ({ type })));
    expect(QUERY_DEPENDENCIES.hours).toEqual([
      "locations",
      "departments",
      "kitchen_stations",
      "hours_week_cells",
      "hours_week_periods",
      "special_dates",
      "special_date_hours",
      "special_date_hours_periods",
      "station_day_states",
      "station_fallbacks",
    ]);
    expect(request.mock.calls).toEqual([[HOURS_PATH, "GET", undefined, { passive: true }]]);
    detach();
  });

  it("applies another tab's change, reports a failed read and its recovery, and stops reading once detached", async () => {
    const liveData = new LiveData();
    const answers: (HoursModel | Error)[] = [
      model("2030-10-06"),
      model("2030-10-07"),
      new Error("offline"),
      model("2030-10-08"),
    ];
    const request = vi.fn(async () => {
      const next = answers.shift()!;
      if (next instanceof Error) throw next;
      return next;
    });
    const apply = vi.fn();
    const failed = vi.fn();
    const recovered = vi.fn();
    const detach = new HoursApi(request as DashboardRequest, liveData).watchHours(
      "2030-10-01",
      "2030-10-31",
      apply,
      failed,
      recovered,
    );
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));

    liveData.invalidate([{ type: "special_dates" }]);
    await vi.waitFor(() => expect(apply).toHaveBeenLastCalledWith(model("2030-10-07")));

    liveData.invalidate([{ type: "locations" }]);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith(new Error("offline")));
    expect(recovered).not.toHaveBeenCalled();

    liveData.invalidate([{ type: "hours_week_cells" }]);
    await vi.waitFor(() => expect(apply).toHaveBeenLastCalledWith(model("2030-10-08")));
    expect(recovered).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(3);

    // A change Hours does not read starts no read.
    liveData.invalidate([{ type: "service_settings" }]);
    detach();
    expect(liveData.interests).toEqual([]);
    liveData.invalidate([{ type: "special_dates" }]);
    liveData.refresh();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(request).toHaveBeenCalledTimes(4);
    expect(apply).toHaveBeenCalledTimes(3);
  });

  it("gives a second watcher of an already loaded range that model at once, without another read", async () => {
    const liveData = new LiveData();
    const request = vi.fn(async () => model("2030-10-06"));
    const api = new HoursApi(request as DashboardRequest, liveData);
    const first = vi.fn();
    const detachFirst = api.watchHours("2030-10-01", "2030-10-31", first, vi.fn(), vi.fn());
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    const second = vi.fn();
    const detachSecond = api.watchHours("2030-10-01", "2030-10-31", second, vi.fn(), vi.fn());
    await vi.waitFor(() => expect(second).toHaveBeenCalledWith(model("2030-10-06")));
    expect(request).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    detachFirst();
    detachSecond();
  });

  it("re-reads on a timer with no row written, so today's date and labels move on", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const liveData = new LiveData();
    const request = vi
      .fn()
      .mockResolvedValueOnce(model("2030-10-06"))
      .mockResolvedValueOnce(model("2030-10-07"));
    const apply = vi.fn();
    const detach = new HoursApi(request as DashboardRequest, liveData).watchHours(
      "2030-10-01",
      "2030-10-31",
      apply,
      vi.fn(),
      vi.fn(),
    );
    await settled();
    expect(apply).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(59_999);
    await settled();
    expect(request).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await settled();
    expect(apply).toHaveBeenLastCalledWith(model("2030-10-07"));
    detach();
    vi.advanceTimersByTime(120_000);
    await settled();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("without live data reads once and then on the same timer, until detached", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const request = vi.fn(async () => model("2030-10-06"));
    const apply = vi.fn();
    const failed = vi.fn();
    const detach = new HoursApi(request as DashboardRequest).watchHours(
      "2030-10-01",
      "2030-10-31",
      apply,
      failed,
      vi.fn(),
    );
    await settled();
    expect(apply).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    await settled();
    expect(apply).toHaveBeenCalledTimes(2);
    detach();
    vi.advanceTimersByTime(60_000);
    await settled();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]).toEqual([HOURS_PATH, "GET", undefined, { passive: true }]);
    expect(failed).not.toHaveBeenCalled();
  });
});
