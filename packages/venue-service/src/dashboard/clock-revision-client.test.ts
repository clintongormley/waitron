import { expect, it } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { OpeningHoursApi } from "./opening-hours-client.js";
import { NamedDaysApi } from "./named-days-client.js";
it("sends the editor's retained revision on every time-affecting request", async () => {
  const bodies: unknown[] = [];
  const request = (async (_path, _method, body) => {
    bodies.push(body);
    return { id: "new" };
  }) as DashboardRequest;
  const api = new OpeningHoursApi(request);
  await api.createPeriod(
    "dept",
    { name: "Lunch", colour: "blue", menuId: "m", staffMenuIds: [] },
    7,
  );
  await api.updatePeriod("period", { endOffsetMinutes: 15 }, 7);
  await api.saveWeek("dept", "season", [], 7);
  await api.saveZoneWeek("zone", "season", [], 7);
  await api.saveZoneDate("day", "zone", [], 7);
  await api.saveDateMenus("day", "dept", [], 7);
  expect(bodies).toEqual([
    { name: "Lunch", colour: "blue", menuId: "m", staffMenuIds: [], expectedClockRevision: 7 },
    { endOffsetMinutes: 15, expectedClockRevision: 7 },
    { days: [], seasonId: "season", expectedClockRevision: 7 },
    { days: [], seasonId: "season", expectedClockRevision: 7 },
    { ranges: [], expectedClockRevision: 7 },
    { slots: [], expectedClockRevision: 7 },
  ]);
});
it("sends the retained calendar revision on save, copy and removal", async () => {
  const bodies: unknown[] = [];
  const api = new NamedDaysApi((async (_path, _method, body) => {
    bodies.push(body);
  }) as DashboardRequest);
  const input = {
    name: "Holiday",
    date: "2026-11-04",
    kind: "holiday" as const,
    repeats: false,
    ownHours: true,
    closeWholeVenue: false,
  };
  await api.saveDay(null, input, () => true, 9);
  await api.saveDay("date", input, () => true, 9);
  await api.copyDay("date", ["2026-11-05"], 9);
  await api.deleteDay("date", 9);
  expect(bodies).toEqual([
    { ...input, expectedClockRevision: 9 },
    { ...input, expectedClockRevision: 9 },
    { dates: ["2026-11-05"], expectedClockRevision: 9 },
    { expectedClockRevision: 9 },
  ]);
});
