import { describe, expect, it } from "vitest";
import {
  findEndOffsetClash,
  findScheduleEndOffsetClash,
  findSeasonEndOffsetClash,
  periodOrderCutoff,
  type SeasonSchedule,
} from "./period-end-offset.js";
import type { ServiceRange } from "./service-day.js";

const lunch = { periodId: "lunch", startsAt: "12:00", endsAt: "14:00" };
const next = { periodId: "dinner", startsAt: "14:15", endsAt: "18:00" };
describe("wall-minute end offsets", () => {
  it.each([
    [-15, 465],
    [0, 480],
    [15, 495],
  ])("cutoff for offset %s uses business-day minutes", (offset, cutoff) => {
    expect(periodOrderCutoff(lunch, offset!, "06:00")).toBe(cutoff);
  });
  it("keeps original slot positions when finding the next sorted placement", () => {
    expect(findEndOffsetClash([[next, lunch]], new Map([["lunch", 15]]), "06:00")).toEqual({
      periodId: "lunch",
      dayIndex: 0,
      slotIndex: 1,
    });
    expect(findEndOffsetClash([[next, lunch]], new Map([["lunch", 14]]), "06:00")).toBeNull();
  });
  it("uses an explicit empty override rather than its week, and suppresses closed days", () => {
    const late = { periodId: "late", startsAt: "21:00", endsAt: "06:00" };
    const early = { periodId: "early", startsAt: "07:00", endsAt: "09:00" };
    const days = [
      { weekday: 1, date: null, slots: [late] },
      { weekday: 2, date: null, slots: [{ ...early, startsAt: "09:00", endsAt: "12:00" }] },
      { weekday: null, date: "2026-10-13", slots: [early] },
    ];
    const offsets = new Map([["late", 120]]);
    expect(
      findScheduleEndOffsetClash(
        days,
        [{ date: "2026-10-13", closeWholeVenue: false }],
        offsets,
        "06:00",
      ),
    ).toEqual({ periodId: "late", slotIndex: 0, date: "2026-10-12" });
    expect(
      findScheduleEndOffsetClash(
        days,
        [{ date: "2026-10-13", closeWholeVenue: true }],
        offsets,
        "06:00",
      ),
    ).toBeNull();
    days[2]!.slots = [];
    expect(
      findScheduleEndOffsetClash(
        days,
        [{ date: "2026-10-13", closeWholeVenue: false }],
        offsets,
        "06:00",
      ),
    ).toBeNull();
  });
});

it("checks annual neighbors beyond their saved and following years", () => {
  expect(
    findScheduleEndOffsetClash(
      [
        {
          weekday: 1,
          date: null,
          slots: [{ periodId: "late", startsAt: "22:00", endsAt: "04:30" }],
        },
        {
          weekday: null,
          date: "2026-11-06",
          slots: [{ periodId: "early", startsAt: "07:15", endsAt: "09:00" }],
        },
      ],
      [{ date: "2026-11-06", repeatOn: "11-06", ownHours: true, closeWholeVenue: false }],
      new Map([["late", 180]]),
      {
        timeZone: "UTC",
        dayCutover: "05:00",
        cutoverChanges: [{ effectiveBusinessDay: "2026-11-04", dayCutover: "07:00" }],
      },
    ),
  ).toEqual({ periodId: "late", slotIndex: 0, date: "2029-11-05" });
});

describe("end offsets across seasons", () => {
  const dinner = { periodId: "dinner", startsAt: "20:00", endsAt: "05:45" };
  const breakfast = { periodId: "breakfast", startsAt: "06:00", endsAt: "09:00" };
  const empty = (): ServiceRange[][] => Array.from({ length: 7 }, () => []);
  const offsets = new Map([["dinner", 30]]);
  /** Autumn's Saturday Dinner sends until 06:15; Winter's Sunday opens Breakfast at 06:00. */
  function seasons(): SeasonSchedule[] {
    const autumn = empty();
    autumn[6] = [dinner];
    const winter = empty();
    winter[0] = [breakfast];
    return [
      { seasonId: "autumn", startsOn: "09-01", week: autumn },
      { seasonId: "winter", startsOn: "12-01", week: winter },
    ];
  }

  it("finds no clash inside either season", () => {
    for (const season of seasons())
      expect(findSeasonEndOffsetClash([season], [], offsets, "06:00")).toBeNull();
  });

  it("pairs the last day of one season with the first day of the next", () => {
    expect(findSeasonEndOffsetClash(seasons(), [], offsets, "06:00")).toEqual({
      periodId: "dinner",
      slotIndex: 0,
      seasonId: "autumn",
      weekday: 6,
    });
    expect(findSeasonEndOffsetClash(seasons(), [], new Map([["dinner", 14]]), "06:00")).toBeNull();
  });

  it("reads a dated day's neighbour from the season holding it", () => {
    const [autumn, winter] = seasons();
    autumn!.week = empty();
    const tuesday = empty();
    tuesday[2] = [breakfast];
    winter!.week = tuesday;
    const named = (date: string) => [
      { date, closeWholeVenue: false, ownHours: true, slots: [dinner] },
    ];
    // 2026-11-30, a Monday, is Autumn's last day; the Tuesday after it is Winter's.
    expect(
      findSeasonEndOffsetClash([autumn!, winter!], named("2026-11-30"), offsets, "06:00"),
    ).toEqual({ periodId: "dinner", slotIndex: 0, date: "2026-11-30" });
    expect(
      findSeasonEndOffsetClash([autumn!, winter!], named("2026-11-23"), offsets, "06:00"),
    ).toBeNull();
  });
});
