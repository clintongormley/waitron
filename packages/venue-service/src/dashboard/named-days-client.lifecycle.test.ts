import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveData, type DashboardRequest } from "@waitron/dashboard-kit";
import type { NamedDaysModel } from "../holiday-types.js";
import { NamedDaysApi } from "./named-days-client.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";

const model = (civilDate: string): NamedDaysModel => ({
  timeZone: "Europe/Madrid",
  dayCutover: "06:00",
  civilDate,
  clockReadable: true,
  days: [],
  holidayCoverage: [],
  holidaySources: [],
  area: { addressKey: "fixture", readiness: "ready", options: [], required: false, chosen: null },
  localHolidaysPerYear: 2,
});
const NAMED_PATH = "/management-api/venue-service/named-days?from=2030-10-01&to=2030-10-31";
afterEach(() => {
  vi.useRealTimers();
});
async function settled(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}

describe("NamedDaysApi.watchNamedDays", () => {
  it("subscribes to exactly the Calendar sources and reads passively", async () => {
    const liveData = new LiveData();
    const request = vi.fn(async () => model("2030-10-06"));
    const apply = vi.fn();
    const detach = new NamedDaysApi(request as DashboardRequest, liveData).watchNamedDays(
      "2030-10-01",
      "2030-10-31",
      apply,
      vi.fn(),
      vi.fn(),
    );
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(model("2030-10-06")));
    expect(liveData.interests).toEqual(QUERY_DEPENDENCIES["named-days"].map((type) => ({ type })));
    expect(QUERY_DEPENDENCIES["named-days"]).toEqual([
      "special_dates",
      "menu_day_timetables",
      "menu_slots",
      "departments",
      "tenants",
      "locations",
      "holiday_geographies",
    ]);
    expect(request.mock.calls).toEqual([[NAMED_PATH, "GET", undefined, { passive: true }]]);
    detach();
  });

  it("applies another tab's change, reports a failed read and its recovery, and stops reading once detached", async () => {
    const liveData = new LiveData();
    const answers: (NamedDaysModel | Error)[] = [
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
    const detach = new NamedDaysApi(request as DashboardRequest, liveData).watchNamedDays(
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

    liveData.invalidate([{ type: "menu_slots" }]);
    await vi.waitFor(() => expect(apply).toHaveBeenLastCalledWith(model("2030-10-08")));
    expect(recovered).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(3);

    // Service settings are outside the Calendar read.
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
    const api = new NamedDaysApi(request as DashboardRequest, liveData);
    const first = vi.fn();
    const detachFirst = api.watchNamedDays("2030-10-01", "2030-10-31", first, vi.fn(), vi.fn());
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    const second = vi.fn();
    const detachSecond = api.watchNamedDays("2030-10-01", "2030-10-31", second, vi.fn(), vi.fn());
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
    const detach = new NamedDaysApi(request as DashboardRequest, liveData).watchNamedDays(
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
    const detach = new NamedDaysApi(request as DashboardRequest).watchNamedDays(
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
    expect(request.mock.calls[1]).toEqual([NAMED_PATH, "GET", undefined, { passive: true }]);
    expect(failed).not.toHaveBeenCalled();
  });

  it("without live data applies only the latest read: an earlier one that answers late changes nothing", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const answers: {
      resolve: (value: NamedDaysModel) => void;
      reject: (error: unknown) => void;
    }[] = [];
    const request = vi.fn(
      () => new Promise<NamedDaysModel>((resolve, reject) => answers.push({ resolve, reject })),
    );
    const apply = vi.fn();
    const failed = vi.fn();
    const detach = new NamedDaysApi(request as DashboardRequest).watchNamedDays(
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
    const answers: ((value: NamedDaysModel) => void)[] = [];
    const request = vi.fn(() => new Promise<NamedDaysModel>((resolve) => answers.push(resolve)));
    const apply = vi.fn();
    const detach = new NamedDaysApi(request as DashboardRequest).watchNamedDays(
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

describe("NamedDaysApi.rereadWatches", () => {
  it("has every Calendar watch read once more through live data, and reads nothing with neither live data nor a watch", async () => {
    const liveData = new LiveData();
    const request = vi.fn(async (path: string) =>
      model(path.includes("2030-11") ? "2030-11-06" : "2030-10-06"),
    );
    const api = new NamedDaysApi(request as DashboardRequest, liveData);
    const october = vi.fn();
    const november = vi.fn();
    const detachOctober = api.watchNamedDays("2030-10-01", "2030-10-31", october, vi.fn(), vi.fn());
    const detachNovember = api.watchNamedDays(
      "2030-11-01",
      "2030-11-30",
      november,
      vi.fn(),
      vi.fn(),
    );
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
    ).toEqual([
      NAMED_PATH,
      "/management-api/venue-service/named-days?from=2030-11-01&to=2030-11-30",
    ]);
    detachOctober();
    detachNovember();

    const alone = vi.fn(async () => model("2030-10-06"));
    new NamedDaysApi(alone as DashboardRequest).rereadWatches();
    await settled();
    expect(alone).not.toHaveBeenCalled();
  });

  it("without live data has each attached watch read again, in order with its timer reads", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const answers: ((value: NamedDaysModel) => void)[] = [];
    const request = vi.fn(() => new Promise<NamedDaysModel>((resolve) => answers.push(resolve)));
    const api = new NamedDaysApi(request as DashboardRequest);
    const apply = vi.fn();
    const detach = api.watchNamedDays("2030-10-01", "2030-10-31", apply, vi.fn(), vi.fn());
    answers[0]!(model("2030-10-06"));
    await settled();
    // A timer read starts, then a write's reread starts and answers first.
    vi.advanceTimersByTime(60_000);
    api.rereadWatches();
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2]).toEqual([NAMED_PATH, "GET", undefined, { passive: true }]);
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
    const answers: {
      resolve: (value: NamedDaysModel) => void;
      reject: (error: unknown) => void;
    }[] = [];
    const request = vi.fn(
      () => new Promise<NamedDaysModel>((resolve, reject) => answers.push({ resolve, reject })),
    );
    const api = new NamedDaysApi(request as DashboardRequest);
    const apply = vi.fn();
    const failed = vi.fn();
    const recovered = vi.fn();
    const detach = api.watchNamedDays("2030-10-01", "2030-10-31", apply, failed, recovered);
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
    const answers: {
      resolve: (value: NamedDaysModel) => void;
      reject: (error: unknown) => void;
    }[] = [];
    const request = vi.fn(
      () => new Promise<NamedDaysModel>((resolve, reject) => answers.push({ resolve, reject })),
    );
    const api = new NamedDaysApi(request as DashboardRequest);
    const apply = vi.fn();
    const failed = vi.fn();
    const detach = api.watchNamedDays("2030-10-01", "2030-10-31", apply, failed, vi.fn());
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
