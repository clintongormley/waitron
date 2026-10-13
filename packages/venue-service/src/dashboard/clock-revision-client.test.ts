import { expect, it } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { OpeningHoursApi } from "./opening-hours-client.js";
import { SpecialDaysApi } from "./special-days-client.js";
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
  await api.saveSeasonWeeks("season", { departments: [], zones: [] }, 7);
  expect(bodies).toEqual([
    { name: "Lunch", colour: "blue", menuId: "m", staffMenuIds: [], expectedClockRevision: 7 },
    { endOffsetMinutes: 15, expectedClockRevision: 7 },
    { departments: [], zones: [], expectedClockRevision: 7 },
  ]);
});
it("sends the retained calendar revision on save and removal", async () => {
  const bodies: unknown[] = [];
  const api = new SpecialDaysApi((async (_path, _method, body) => {
    bodies.push(body);
  }) as DashboardRequest);
  const input = {
    name: "Holiday",
    repeatsYearly: false,
    dates: [{ date: "2026-11-04", closedAllDay: false }],
  };
  await api.saveSpecialDay(null, input, () => true, 9);
  await api.saveSpecialDay("day", input, () => true, 9);
  await api.deleteSpecialDay("day", 9);
  expect(bodies).toEqual([
    { ...input, expectedClockRevision: 9 },
    { ...input, expectedClockRevision: 9 },
    { expectedClockRevision: 9 },
  ]);
});
