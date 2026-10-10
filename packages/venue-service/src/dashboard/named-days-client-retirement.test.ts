import { describe, expect, it, vi } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { NamedDayInput } from "./named-day-editor.js";
import { NamedDaysApi } from "./named-days-client.js";

describe("Named Days writes after Hours retirement", () => {
  it("sends each write to its route and returns what the server saved", async () => {
    const saved = {
      id: "d1",
      date: "2030-10-15",
      name: "Party",
      kind: "working_day",
      repeats: false,
      ownHours: false,
      closeWholeVenue: false,
    };
    const request = vi.fn(async (path: string, method: string) =>
      method === "POST" && path.endsWith("/duplicate")
        ? [saved]
        : method === "DELETE"
          ? undefined
          : saved,
    );
    const api = new NamedDaysApi(request as DashboardRequest);
    const input: NamedDayInput = {
      date: "2030-10-15",
      name: "Party",
      kind: "working_day",
      repeats: false,
      ownHours: false,
      closeWholeVenue: false,
    };
    expect(await api.saveDay(null, input)).toEqual(saved);
    expect(await api.saveDay("d1", input)).toEqual(saved);
    expect(await api.copyDay("d1", ["2030-10-22"])).toEqual([saved]);
    expect(await api.deleteDay("d1")).toBeUndefined();
    expect(request.mock.calls).toEqual([
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
    const api = new NamedDaysApi(request as DashboardRequest);
    await api.deleteDay("a/b");
    api.watchNamedDays("2030-10-01&x=1", "2030-10-31", vi.fn(), vi.fn(), vi.fn())();
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      "/management-api/venue-service/special-dates/a%2Fb",
      "/management-api/venue-service/named-days?from=2030-10-01%26x%3D1&to=2030-10-31",
    ]);
  });
});
