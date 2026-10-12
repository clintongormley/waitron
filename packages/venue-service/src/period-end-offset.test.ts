import { describe, expect, it } from "vitest";
import {
  findEndOffsetClash,
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
    const week: ServiceRange[][] = Array.from({ length: 7 }, () => []);
    week[1] = [late];
    week[2] = [{ ...early, startsAt: "09:00", endsAt: "12:00" }];
    const seasons = [{ seasonId: "year", startsOn: "01-01", week }];
    const offsets = new Map([["late", 120]]);
    expect(
      findSeasonEndOffsetClash(
        seasons,
        [{ date: "2026-10-13", closeWholeVenue: false, slots: [early] }],
        offsets,
        "06:00",
      ),
    ).toEqual({ periodId: "late", slotIndex: 0, date: "2026-10-12" });
    expect(
      findSeasonEndOffsetClash(
        seasons,
        [{ date: "2026-10-13", closeWholeVenue: true, slots: [early] }],
        offsets,
        "06:00",
      ),
    ).toBeNull();
    expect(
      findSeasonEndOffsetClash(
        seasons,
        [{ date: "2026-10-13", closeWholeVenue: false, slots: [] }],
        offsets,
        "06:00",
      ),
    ).toBeNull();
  });
  it("reads an explicitly empty named next day as closed, not as its season's day", () => {
    const late = { periodId: "late", startsAt: "21:00", endsAt: "06:00" };
    const week: ServiceRange[][] = Array.from({ length: 7 }, () => []);
    week[2] = [{ periodId: "early", startsAt: "07:00", endsAt: "09:00" }];
    const seasons = [{ seasonId: "year", startsOn: "01-01", week }];
    const offsets = new Map([["late", 120]]);
    const monday = { date: "2026-10-12", closeWholeVenue: false, slots: [late] };
    expect(findSeasonEndOffsetClash(seasons, [], offsets, "06:00")).toBeNull();
    expect(findSeasonEndOffsetClash(seasons, [monday], offsets, "06:00")).toEqual({
      periodId: "late",
      slotIndex: 0,
      date: "2026-10-12",
    });
    expect(
      findSeasonEndOffsetClash(
        seasons,
        [monday, { date: "2026-10-13", closeWholeVenue: false, slots: [] }],
        offsets,
        "06:00",
      ),
    ).toBeNull();
  });
});

it("checks annual neighbors beyond their saved and following years", () => {
  const week: ServiceRange[][] = Array.from({ length: 7 }, () => []);
  week[1] = [{ periodId: "late", startsAt: "22:00", endsAt: "04:30" }];
  expect(
    findSeasonEndOffsetClash(
      [{ seasonId: "year", startsOn: "01-01", week }],
      [
        {
          date: "2026-11-06",
          repeatOn: "11-06",
          ownHours: true,
          closeWholeVenue: false,
          slots: [{ periodId: "early", startsAt: "07:15", endsAt: "09:00" }],
        },
      ],
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

  it("pairs only a season with the one after it among the four default seasons", () => {
    const late = { periodId: "dinner", startsAt: "20:00", endsAt: "05:45" };
    const four = (saturday: string, sunday: string): SeasonSchedule[] =>
      [
        ["spring", "03-01"],
        ["summer", "06-01"],
        ["autumn", "09-01"],
        ["winter", "12-01"],
      ].map(([seasonId, startsOn]) => {
        const week = empty();
        if (seasonId === saturday) week[6] = [late];
        if (seasonId === sunday) week[0] = [breakfast];
        return { seasonId: seasonId!, startsOn: startsOn!, week };
      });
    // Summer never meets Winter, and Winter is followed by Spring, not Autumn.
    expect(findSeasonEndOffsetClash(four("summer", "winter"), [], offsets, "06:00")).toBeNull();
    expect(findSeasonEndOffsetClash(four("winter", "autumn"), [], offsets, "06:00")).toBeNull();
    expect(findSeasonEndOffsetClash(four("spring", "autumn"), [], offsets, "06:00")).toBeNull();
    // Winter's last day, at the end of February, meets Spring's first.
    expect(findSeasonEndOffsetClash(four("winter", "spring"), [], offsets, "06:00")).toEqual({
      periodId: "dinner",
      slotIndex: 0,
      seasonId: "winter",
      weekday: 6,
    });
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
