import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequest, LiveData, type DashboardRequest } from "@waitron/dashboard-kit";
import type {
  HolidayGeography,
  HolidayRead,
  LocalHoliday,
  LocalHolidayModel,
} from "../holiday-types.js";
import type { HoursModel, SpecialDateInput, WeekDay } from "../hours-types.js";
import { HoursApi } from "./hours-client.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";

const model = (civilDate: string): HoursModel => ({
  timeZone: "Europe/Madrid",
  dayCutover: "06:00",
  civilDate,
  clockReadable: true,
  departments: [],
  subjects: [],
  week: [],
  days: [],
  specialDates: [],
  specialCells: [],
  holidayCoverage: [],
  holidaySources: [],
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
        : method === "DELETE" || path.endsWith("/week")
          ? undefined
          : saved,
    );
    const api = new HoursApi(request as DashboardRequest);
    const subject = { kind: "station" as const, id: "station" };
    const days: WeekDay[] = [];
    const input: SpecialDateInput = {
      date: "2030-10-15",
      name: "Party",
      colour: "red",
      closeWholeVenue: false,
      cells: [],
    };
    expect(await api.saveWeek(subject, days)).toBeUndefined();
    expect(await api.saveDate(null, input)).toEqual(saved);
    expect(await api.saveDate("d1", input)).toEqual(saved);
    expect(await api.duplicateDate("d1", ["2030-10-22"])).toEqual([saved]);
    expect(await api.deleteDate("d1")).toBeUndefined();
    expect(request.mock.calls).toEqual([
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
    api.watchHours("2030-10-01&x=1", "2030-10-31", vi.fn(), vi.fn(), vi.fn())();
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
      "tenants",
      "holiday_geographies",
      "local_holidays",
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

  it("without live data applies only the latest read: an earlier one that answers late changes nothing", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const answers: { resolve: (value: HoursModel) => void; reject: (error: unknown) => void }[] =
      [];
    const request = vi.fn(
      () => new Promise<HoursModel>((resolve, reject) => answers.push({ resolve, reject })),
    );
    const apply = vi.fn();
    const failed = vi.fn();
    const detach = new HoursApi(request as DashboardRequest).watchHours(
      "2030-10-01",
      "2030-10-31",
      apply,
      failed,
      vi.fn(),
    );
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(60_000);
    expect(request).toHaveBeenCalledTimes(3);
    answers[1]!.reject({ code: "connection.failed" });
    await settled();
    answers[2]!.resolve(model("2030-10-08"));
    await settled();
    answers[0]!.resolve(model("2030-10-06"));
    await settled();
    expect(apply.mock.calls).toEqual([[model("2030-10-08")]]);
    expect(failed).not.toHaveBeenCalled();
    detach();
  });
  it("without live data still applies reads that each take longer than the timer, oldest first", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const answers: ((value: HoursModel) => void)[] = [];
    const request = vi.fn(() => new Promise<HoursModel>((resolve) => answers.push(resolve)));
    const apply = vi.fn();
    const detach = new HoursApi(request as DashboardRequest).watchHours(
      "2030-10-01",
      "2030-10-31",
      apply,
      vi.fn(),
      vi.fn(),
    );
    vi.advanceTimersByTime(60_000);
    answers[0]!(model("2030-10-06"));
    await settled();
    vi.advanceTimersByTime(60_000);
    answers[1]!(model("2030-10-07"));
    await settled();
    expect(apply.mock.calls).toEqual([[model("2030-10-06")], [model("2030-10-07")]]);
    detach();
  });
});

describe("HoursApi.rereadWatches", () => {
  it("has every Hours watch read once more through live data, and reads nothing with neither live data nor a watch", async () => {
    const liveData = new LiveData();
    const request = vi.fn(async (path: string) =>
      model(path.includes("2030-11") ? "2030-11-06" : "2030-10-06"),
    );
    const api = new HoursApi(request as DashboardRequest, liveData);
    const october = vi.fn();
    const november = vi.fn();
    const detachOctober = api.watchHours("2030-10-01", "2030-10-31", october, vi.fn(), vi.fn());
    const detachNovember = api.watchHours("2030-11-01", "2030-11-30", november, vi.fn(), vi.fn());
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    api.rereadWatches();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    await vi.waitFor(() =>
      expect([october.mock.calls.length, november.mock.calls.length]).toEqual([2, 2]),
    );
    expect(
      request.mock.calls
        .slice(2)
        .map(([path]) => path)
        .sort(),
    ).toEqual([HOURS_PATH, "/management-api/venue-service/hours?from=2030-11-01&to=2030-11-30"]);
    detachOctober();
    detachNovember();

    const alone = vi.fn(async () => model("2030-10-06"));
    new HoursApi(alone as DashboardRequest).rereadWatches();
    await settled();
    expect(alone).not.toHaveBeenCalled();
  });

  it("without live data has each attached watch read again, in order with its timer reads", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const answers: ((value: HoursModel) => void)[] = [];
    const request = vi.fn(() => new Promise<HoursModel>((resolve) => answers.push(resolve)));
    const api = new HoursApi(request as DashboardRequest);
    const apply = vi.fn();
    const detach = api.watchHours("2030-10-01", "2030-10-31", apply, vi.fn(), vi.fn());
    answers[0]!(model("2030-10-06"));
    await settled();
    // A timer read starts, then a write's reread starts and answers first.
    vi.advanceTimersByTime(60_000);
    api.rereadWatches();
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2]).toEqual([HOURS_PATH, "GET", undefined, { passive: true }]);
    answers[2]!(model("2030-10-08"));
    await settled();
    answers[1]!(model("2030-10-07"));
    await settled();
    expect(apply.mock.calls).toEqual([[model("2030-10-06")], [model("2030-10-08")]]);
    detach();
    api.rereadWatches();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("without live data keeps a write's failed reread showing when an earlier timer read answers after it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const answers: { resolve: (value: HoursModel) => void; reject: (error: unknown) => void }[] =
      [];
    const request = vi.fn(
      () => new Promise<HoursModel>((resolve, reject) => answers.push({ resolve, reject })),
    );
    const api = new HoursApi(request as DashboardRequest);
    const apply = vi.fn();
    const failed = vi.fn();
    const recovered = vi.fn();
    const detach = api.watchHours("2030-10-01", "2030-10-31", apply, failed, recovered);
    answers[0]!.resolve(model("2030-10-06"));
    await settled();
    vi.advanceTimersByTime(60_000);
    api.rereadWatches();
    answers[2]!.reject({ code: "connection.failed" });
    await settled();
    answers[1]!.resolve(model("2030-10-07"));
    await settled();
    expect(apply.mock.calls).toEqual([[model("2030-10-06")]]);
    expect(failed.mock.calls).toEqual([[{ code: "connection.failed" }]]);
    expect(recovered).not.toHaveBeenCalled();
    detach();
  });

  it("without live data drops an earlier timer read after a write's reread fails while a later read is still out", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const answers: { resolve: (value: HoursModel) => void; reject: (error: unknown) => void }[] =
      [];
    const request = vi.fn(
      () => new Promise<HoursModel>((resolve, reject) => answers.push({ resolve, reject })),
    );
    const api = new HoursApi(request as DashboardRequest);
    const apply = vi.fn();
    const failed = vi.fn();
    const detach = api.watchHours("2030-10-01", "2030-10-31", apply, failed, vi.fn());
    answers[0]!.resolve(model("2030-10-06"));
    await settled();
    vi.advanceTimersByTime(60_000);
    api.rereadWatches();
    vi.advanceTimersByTime(60_000);
    answers[2]!.reject({ code: "connection.failed" });
    await settled();
    answers[1]!.resolve(model("2030-10-07"));
    await settled();
    expect(apply.mock.calls).toEqual([[model("2030-10-06")]]);
    answers[3]!.resolve(model("2030-10-08"));
    await settled();
    expect(apply.mock.calls).toEqual([[model("2030-10-06")], [model("2030-10-08")]]);
    expect(failed).not.toHaveBeenCalled();
    detach();
  });
});

const LOCAL_PATH = "/management-api/venue-service/local-holidays";

/** A local-holiday model as a server would answer it; `limit` stands for the country's allowance. */
const localModel = (limit: number, entries: LocalHoliday[] = []): LocalHolidayModel => ({
  venue: { country: "ZZ", provinceCode: "10", city: "Villa Real" },
  localEntryLimit: limit,
  areaOptions: [],
  areaRequired: false,
  geographies:
    entries.length === 0
      ? []
      : [
          {
            id: "g1",
            country: "ZZ",
            provinceCode: "10",
            city: "Villa Real",
            areaKey: null,
            matchesVenue: true,
          },
        ],
  entries,
});

/** The dashboard's real request primitive over a fetch that answers `status` with `body`. */
function answering(status: number, body?: unknown) {
  const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );
  return { request: createRequest({ fetchImpl }), fetchImpl };
}

describe("HoursApi holidays", () => {
  it("reads holidays and the local holiday model passively, with nothing but the range in the path", async () => {
    const read: HolidayRead = { facts: [], coverage: [], sources: [] };
    const fresh: LocalHolidayModel = {
      venue: { country: "ES", provinceCode: "41", city: "Sevilla" },
      localEntryLimit: 2,
      areaOptions: [],
      areaRequired: false,
      geographies: [],
      entries: [],
    };
    const request = vi.fn(async (path: string) => (path.includes("/holidays?") ? read : fresh));
    const api = new HoursApi(request as DashboardRequest);
    expect(await api.loadHolidays("2026-10-01", "2026-10-31")).toEqual(read);
    expect(await api.loadLocalHolidays()).toEqual(fresh);
    expect(request.mock.calls).toEqual([
      [
        "/management-api/venue-service/holidays?from=2026-10-01&to=2026-10-31",
        "GET",
        undefined,
        { passive: true },
      ],
      [LOCAL_PATH, "GET", undefined, { passive: true }],
    ]);
  });

  it("passes each allowance through unchanged, 0 included for a country without the capability", async () => {
    for (const limit of [1, 3, 0]) {
      const request = vi.fn(async () => localModel(limit));
      expect(await new HoursApi(request as DashboardRequest).loadLocalHolidays()).toEqual(
        localModel(limit),
      );
    }
  });

  it("sends each holiday write with exactly its body and returns what the server saved", async () => {
    const entry: LocalHoliday = { id: "e1", geographyId: "g1", date: "2026-05-30", name: "Feria" };
    const geography: HolidayGeography = {
      id: "g1",
      country: "ES",
      provinceCode: "25",
      city: "Vielha",
      areaKey: "aran",
      matchesVenue: true,
    };
    const request = vi.fn(async (path: string, method: string) =>
      method === "DELETE" ? undefined : path.endsWith("/holiday-area") ? geography : entry,
    );
    const api = new HoursApi(request as DashboardRequest);
    const input = { date: "2026-05-30", name: "Feria" };
    expect(await api.saveHolidayArea("aran")).toEqual(geography);
    expect(await api.saveLocalHoliday(null, input)).toEqual(entry);
    expect(await api.saveLocalHoliday("e/1", input)).toEqual(entry);
    expect(await api.deleteLocalHoliday("e/1")).toBeUndefined();
    expect(await api.deleteRetainedGeography("g/1")).toBeUndefined();
    expect(request.mock.calls).toEqual([
      ["/management-api/venue-service/holiday-area", "PUT", { areaKey: "aran" }],
      [LOCAL_PATH, "POST", input],
      [`${LOCAL_PATH}/e%2F1`, "PUT", input],
      [`${LOCAL_PATH}/e%2F1`, "DELETE"],
      ["/management-api/venue-service/holiday-geographies/g%2F1", "DELETE"],
    ]);
  });

  it("answers null when the server cleared an area choice it never stored", async () => {
    const { request, fetchImpl } = answering(204);
    expect(await new HoursApi(request).saveHolidayArea(null)).toBeNull();
    expect(fetchImpl.mock.calls[0]![1]!.body).toBe(JSON.stringify({ areaKey: null }));
  });

  it("hands on a refusal's code, field and status, for an unresolved address, a retained id and a foreign id", async () => {
    const refusals = [
      [400, "holiday.invalid", { field: "geography" }],
      [400, "holiday.invalid", { field: "id" }],
      [404, "holiday.not_found", { holidayId: "e1" }],
      [409, "holiday.local_limit", { limit: 0, year: 2026 }],
    ] as const;
    for (const [status, code, params] of refusals) {
      const { request } = answering(status, { error: { code, params } });
      await expect(
        new HoursApi(request).saveLocalHoliday("e1", { date: "2026-05-30", name: "Feria" }),
      ).rejects.toEqual({ code, params, status });
    }
  });
});

describe("HoursApi.watchLocalHolidays", () => {
  it("subscribes to exactly the holiday sources, reads passively, recovers and stops once detached", async () => {
    const liveData = new LiveData();
    const answers: (LocalHolidayModel | Error)[] = [
      localModel(2),
      new Error("offline"),
      localModel(2, [{ id: "e1", geographyId: "g1", date: "2026-05-30", name: "Feria" }]),
    ];
    const request = vi.fn(async () => {
      const next = answers.shift()!;
      if (next instanceof Error) throw next;
      return next;
    });
    const apply = vi.fn();
    const failed = vi.fn();
    const recovered = vi.fn();
    const detach = new HoursApi(request as DashboardRequest, liveData).watchLocalHolidays(
      apply,
      failed,
      recovered,
    );
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(localModel(2)));
    expect(QUERY_DEPENDENCIES.holidays).toEqual([
      "tenants",
      "locations",
      "holiday_geographies",
      "local_holidays",
    ]);
    expect(liveData.interests).toEqual(QUERY_DEPENDENCIES.holidays.map((type) => ({ type })));
    expect(request.mock.calls).toEqual([[LOCAL_PATH, "GET", undefined, { passive: true }]]);

    liveData.invalidate([{ type: "locations" }]);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith(new Error("offline")));
    liveData.invalidate([{ type: "local_holidays" }]);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(recovered).toHaveBeenCalledTimes(1);

    // Hours' own tables are not a holiday source.
    liveData.invalidate([{ type: "special_dates" }]);
    detach();
    expect(liveData.interests).toEqual([]);
    liveData.invalidate([{ type: "local_holidays" }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("is read again after a write, through live data and without it", async () => {
    const liveData = new LiveData();
    const live = vi.fn(async () => localModel(2));
    const liveApi = new HoursApi(live as DashboardRequest, liveData);
    const liveApply = vi.fn();
    const detachLive = liveApi.watchLocalHolidays(liveApply, vi.fn(), vi.fn());
    await vi.waitFor(() => expect(liveApply).toHaveBeenCalledTimes(1));
    liveApi.rereadWatches();
    await vi.waitFor(() => expect(liveApply).toHaveBeenCalledTimes(2));
    detachLive();

    const plain = vi.fn(async () => localModel(2));
    const plainApi = new HoursApi(plain as DashboardRequest);
    const plainApply = vi.fn();
    const detachPlain = plainApi.watchLocalHolidays(plainApply, vi.fn(), vi.fn());
    await vi.waitFor(() => expect(plainApply).toHaveBeenCalledTimes(1));
    plainApi.rereadWatches();
    await vi.waitFor(() => expect(plainApply).toHaveBeenCalledTimes(2));
    detachPlain();
    plainApi.rereadWatches();
    await settled();
    expect(plain).toHaveBeenCalledTimes(2);
  });
});
