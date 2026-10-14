import { afterEach, expect, it, vi } from "vitest";
import { businessDateToday } from "./business-date.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";

afterEach(() => vi.useRealTimers());

const model = (overrides: Partial<OpeningHoursModel> = {}) =>
  ({
    clockReadable: true,
    clockRevision: 4,
    currentBusinessDay: "2026-10-24",
    pending: null,
    menus: [],
    seasons: [],
    currentSeasonId: null,
    departments: [],
    timeZone: "Europe/Madrid",
    dayCutover: "02:30",
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "02:30", cutoverChanges: [] },
    ...overrides,
  }) as OpeningHoursModel;

it("Today keeps chronological ownership in a repeated hour instead of applying today's scalar start", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T00:45:00Z"));
  expect(businessDateToday(model())).toBe("2026-10-24");
  vi.setSystemTime(new Date("2026-10-25T01:45:00Z"));
  expect(businessDateToday(model())).toBe("2026-10-25");
});

it("answers no date when the venue's clock cannot be read", () => {
  expect(businessDateToday(model({ clockReadable: false }))).toBe("");
});

it("answers no date when the clock's time zone is not one the browser knows", () => {
  const clock = { timeZone: "Not/A_Zone", dayCutover: "02:30", cutoverChanges: [] };
  expect(businessDateToday(model({ businessDayClock: clock }))).toBe("");
});
