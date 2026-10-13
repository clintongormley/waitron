import { expect, it } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import * as clients from "./special-days-client.js";

const facts = {
  name: "Christmas dinners",
  repeatsYearly: false,
  dates: [{ date: "2026-12-20", closedAllDay: true }],
};
it("reads a special day and deletes it with the clock revision", async () => {
  const requests: unknown[][] = [];
  const saved = { id: "a/b", ...facts, paint: [], zonePaint: [] };
  const api = new clients.SpecialDaysApi((async (path, method, body, options) => {
    requests.push([path, method, body, options]);
    return method === "DELETE" ? undefined : saved;
  }) as DashboardRequest);
  expect(await api.readSpecialDay("a/b")).toEqual(saved);
  expect(await api.deleteSpecialDay("a/b", 3)).toBeUndefined();
  expect(requests).toEqual([
    ["/management-api/venue-service/special-days/a%2Fb", "GET", undefined, undefined],
    [
      "/management-api/venue-service/special-days/a%2Fb",
      "DELETE",
      { expectedClockRevision: 3 },
      undefined,
    ],
  ]);
});
it("a failed special-day write passes its refusal on", async () => {
  const methods: unknown[] = [];
  const api = new clients.SpecialDaysApi((async (_path, method) => {
    methods.push(method);
    throw new Error("write offline");
  }) as DashboardRequest);
  await expect(api.writeSpecialDay("source", { ...facts, paint: [] }, 0)).rejects.toThrow(
    "write offline",
  );
  expect(methods).toEqual(["PUT"]);
});
it("lists the venue's special days with one GET", async () => {
  const requests: unknown[][] = [];
  const list = [{ id: "a", name: "Navidad", repeatsYearly: false, dates: facts.dates }];
  const api = new clients.SpecialDaysApi((async (path, method, body, options) => {
    requests.push([path, method, body, options]);
    return list;
  }) as DashboardRequest);
  expect(await api.listSpecialDays()).toEqual(list);
  expect(requests).toEqual([
    ["/management-api/venue-service/special-days", "GET", undefined, undefined],
  ]);
});

it("writes a whole special-day input, paint included, creating it when it has no id", async () => {
  const requests: unknown[][] = [];
  const input = {
    name: "Fair",
    repeatsYearly: true,
    dates: [{ date: "2027-04-20", closedAllDay: false }],
    paint: [{ departmentId: "d1", date: "2027-04-20", ranges: [] }],
  };
  const saved = { id: "a/b", ...input, zonePaint: [] };
  const api = new clients.SpecialDaysApi((async (path, method, body) => {
    requests.push([path, method, body]);
    return saved;
  }) as DashboardRequest);
  expect(await api.writeSpecialDay(null, input, 5)).toEqual(saved);
  expect(await api.writeSpecialDay("a/b", input, 6)).toEqual(saved);
  expect(requests).toEqual([
    ["/management-api/venue-service/special-days", "POST", { ...input, expectedClockRevision: 5 }],
    [
      "/management-api/venue-service/special-days/a%2Fb",
      "PUT",
      { ...input, expectedClockRevision: 6 },
    ],
  ]);
});
