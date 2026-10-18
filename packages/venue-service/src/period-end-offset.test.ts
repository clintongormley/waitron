import { describe, expect, it } from "vitest";
import {
  findEndOffsetClash,
  findSeasonEndOffsetClash,
  periodOrderCutoff,
  type SeasonSchedule,
} from "./period-end-offset.js";
import type { ServiceRange } from "./service-day.js";
import { inForceClock, settledClock } from "./service-day-context.js";
import type { BusinessDayClock } from "@waitron/shared";

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
        [{ date: "2026-10-13", closeWholeVenue: false, paint: [early] }],
        offsets,
        "06:00",
      ),
    ).toEqual({ periodId: "late", slotIndex: 0, date: "2026-10-12" });
    expect(
      findSeasonEndOffsetClash(
        seasons,
        [{ date: "2026-10-13", closeWholeVenue: true, paint: [early] }],
        offsets,
        "06:00",
      ),
    ).toBeNull();
    expect(
      findSeasonEndOffsetClash(
        seasons,
        [
          {
            date: "2026-10-13",
            closeWholeVenue: false,
            paint: [{ periodId: null, startsAt: "09:00", endsAt: "12:00" }],
          },
        ],
        offsets,
        "06:00",
      ),
    ).toBeNull();
  });
  it("reads a next day painted Closed as closed, not as its season's day", () => {
    const late = { periodId: "late", startsAt: "21:00", endsAt: "06:00" };
    const week: ServiceRange[][] = Array.from({ length: 7 }, () => []);
    week[2] = [{ periodId: "early", startsAt: "07:00", endsAt: "09:00" }];
    const seasons = [{ seasonId: "year", startsOn: "01-01", week }];
    const offsets = new Map([["late", 120]]);
    const monday = { date: "2026-10-12", closeWholeVenue: false, paint: [late] };
    expect(findSeasonEndOffsetClash(seasons, [], offsets, "06:00")).toBeNull();
    expect(findSeasonEndOffsetClash(seasons, [monday], offsets, "06:00")).toEqual({
      periodId: "late",
      slotIndex: 0,
      date: "2026-10-12",
    });
    expect(
      findSeasonEndOffsetClash(
        seasons,
        [
          monday,
          {
            date: "2026-10-13",
            closeWholeVenue: false,
            paint: [{ periodId: null, startsAt: "07:00", endsAt: "09:00" }],
          },
        ],
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
          occursIn: (year: number) => (year >= 2026 ? `${year}-11-06` : null),
          closeWholeVenue: false,
          paint: [{ periodId: "early", startsAt: "07:15", endsAt: "09:00" }],
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
    const specialDay = (date: string) => [{ date, closeWholeVenue: false, paint: [dinner] }];
    // 2026-11-30, a Monday, is Autumn's last day; the Tuesday after it is Winter's.
    expect(
      findSeasonEndOffsetClash([autumn!, winter!], specialDay("2026-11-30"), offsets, "06:00"),
    ).toEqual({ periodId: "dinner", slotIndex: 0, date: "2026-11-30" });
    expect(
      findSeasonEndOffsetClash([autumn!, winter!], specialDay("2026-11-23"), offsets, "06:00"),
    ).toBeNull();
  });
});

describe("end offsets around special days", () => {
  const empty = (): ServiceRange[][] => Array.from({ length: 7 }, () => []);
  const special = (
    date: string,
    paint: { periodId: string | null; startsAt: string; endsAt: string }[],
    repeats = false,
  ) => ({
    date,
    closeWholeVenue: false,
    ...(repeats
      ? {
          occursIn: (year: number) =>
            year >= Number(date.slice(0, 4)) ? `${year}${date.slice(4)}` : null,
        }
      : {}),
    paint,
    specialDayId: "sd-1",
  });

  it("pairs a one-off special date with the day before it", () => {
    const week = empty();
    week[1] = [{ periodId: "late", startsAt: "21:00", endsAt: "06:00" }];
    const seasons = [{ seasonId: "year", startsOn: "01-01", week }];
    const offsets = new Map([["late", 120]]);
    // 2026-10-13 is a Tuesday; the season leaves Tuesday empty.
    const tuesday = special("2026-10-13", [
      { periodId: "early", startsAt: "07:00", endsAt: "09:00" },
    ]);
    expect(findSeasonEndOffsetClash(seasons, [], offsets, "06:00")).toBeNull();
    expect(findSeasonEndOffsetClash(seasons, [tuesday], offsets, "06:00")).toEqual({
      periodId: "late",
      slotIndex: 0,
      date: "2026-10-12",
      specialDayId: "sd-1",
    });
  });

  it("pairs a one-off special date with the day after it", () => {
    const week = empty();
    week[6] = [{ periodId: "early", startsAt: "07:15", endsAt: "09:00" }];
    const seasons = [{ seasonId: "year", startsOn: "01-01", week }];
    const offsets = new Map([["late", 180]]);
    // 2026-11-06 is a Friday.
    const friday = special("2026-11-06", [
      { periodId: "late", startsAt: "22:00", endsAt: "04:30" },
    ]);
    expect(findSeasonEndOffsetClash(seasons, [friday], offsets, "06:00")).toEqual({
      periodId: "late",
      slotIndex: 0,
      date: "2026-11-06",
      specialDayId: "sd-1",
    });
    expect(findSeasonEndOffsetClash(seasons, [friday], new Map([["late", 0]]), "06:00")).toBeNull();
  });

  it("lays the paint over the season's day rather than beside it", () => {
    const week = empty();
    week[1] = [{ periodId: "late", startsAt: "21:00", endsAt: "06:00" }];
    week[2] = [{ periodId: "early", startsAt: "07:00", endsAt: "09:00" }];
    const seasons = [{ seasonId: "year", startsOn: "01-01", week }];
    // Monday's late paint is Closed on 2026-10-12, so its grace meets nothing that Tuesday.
    const closedMonday = special("2026-10-12", [
      { periodId: null, startsAt: "21:00", endsAt: "06:00" },
    ]);
    const offsets = new Map([["late", 120]]);
    expect(
      findSeasonEndOffsetClash([{ ...seasons[0]!, week: empty() }], [], offsets, "06:00"),
    ).toBeNull();
    const repainted = { ...seasons[0]!, week: [...week] };
    repainted.week[2] = [];
    expect(
      findSeasonEndOffsetClash(
        [repainted],
        [
          special("2026-10-13", [{ periodId: "early", startsAt: "07:00", endsAt: "09:00" }]),
          { ...closedMonday, specialDayId: "sd-2" },
        ],
        offsets,
        "06:00",
      ),
    ).toBeNull();
  });

  it("checks a repeating special date under every weekday it falls on", () => {
    const week = empty();
    week[6] = [{ periodId: "dinner", startsAt: "20:00", endsAt: "05:45" }];
    const seasons = [{ seasonId: "year", startsOn: "01-01", week }];
    const christmasEve = special(
      "2026-12-24",
      [{ periodId: "breakfast", startsAt: "06:00", endsAt: "09:00" }],
      true,
    );
    // 24 December first falls on a Sunday in 2028, after a Saturday whose Dinner sends until 06:15.
    expect(
      findSeasonEndOffsetClash(seasons, [christmasEve], new Map([["dinner", 30]]), "06:00"),
    ).toEqual({ periodId: "dinner", slotIndex: 0, date: "2028-12-23", specialDayId: "sd-1" });
    expect(
      findSeasonEndOffsetClash(seasons, [christmasEve], new Map([["dinner", 14]]), "06:00"),
    ).toBeNull();
  });

  it("closes a Closed-all-day special date whatever it paints", () => {
    const week = empty();
    week[1] = [{ periodId: "late", startsAt: "21:00", endsAt: "06:00" }];
    const seasons = [{ seasonId: "year", startsOn: "01-01", week }];
    const tuesday = {
      ...special("2026-10-13", [{ periodId: "early", startsAt: "07:00", endsAt: "09:00" }]),
      closeWholeVenue: true,
    };
    expect(
      findSeasonEndOffsetClash(seasons, [tuesday], new Map([["late", 120]]), "06:00"),
    ).toBeNull();
  });
});

it("walks a repeating special date through where it says it falls each year", () => {
  const week: ServiceRange[][] = Array.from({ length: 7 }, () => []);
  week[6] = [{ periodId: "dinner", startsAt: "20:00", endsAt: "05:45" }];
  const moved = {
    date: "2026-12-24",
    closeWholeVenue: false,
    paint: [{ periodId: "breakfast", startsAt: "06:00", endsAt: "09:00" }],
    specialDayId: "sd-1",
    // Stored on 24 December (first a Sunday in 2028) but falling on 20 December (a Sunday in 2026).
    occursIn: (year: number) => (year >= 2026 ? `${year}-12-20` : null),
  };
  expect(
    findSeasonEndOffsetClash(
      [{ seasonId: "year", startsOn: "01-01", week }],
      [moved],
      new Map([["dinner", 30]]),
      "06:00",
    ),
  ).toEqual({ periodId: "dinner", slotIndex: 0, date: "2026-12-19", specialDayId: "sd-1" });
});

describe("end offsets for an hours save after the start moved", () => {
  // 05:00, then 03:00 from 2026-10-21, then 05:00 again from 2026-10-28; saved on 2026-11-02.
  const clock: BusinessDayClock = {
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
    cutoverChanges: [
      { effectiveBusinessDay: "2026-10-21", dayCutover: "03:00" },
      { effectiveBusinessDay: "2026-10-28", dayCutover: "05:00" },
    ],
  };
  const at = new Date("2026-11-02T12:00:00Z");
  const settled = settledClock(clock, at);
  const weekly = inForceClock(clock, at).dayCutover;
  const offsets = new Map([["p", 30]]);
  const oneOff = (date: string, startsAt: string, endsAt: string) => ({
    date,
    closeWholeVenue: false,
    paint: [{ periodId: "p", startsAt, endsAt }],
    specialDayId: `sd-${date}`,
  });
  const noWeek = [
    { seasonId: "year", startsOn: "01-01", week: Array.from({ length: 7 }, () => []) },
  ];

  it("judges a past one-off date under its own start", () => {
    const past = [oneOff("2026-10-23", "03:00", "04:30"), oneOff("2026-10-24", "05:00", "06:00")];
    expect(findSeasonEndOffsetClash(noWeek, past, offsets, settled, weekly)).toBeNull();
  });
  it("still finds a future one-off date's clash", () => {
    const future = [oneOff("2026-11-12", "03:00", "04:30"), oneOff("2026-11-13", "05:00", "06:00")];
    expect(findSeasonEndOffsetClash(noWeek, future, offsets, settled, weekly)).toMatchObject({
      periodId: "p",
      date: "2026-11-12",
    });
  });
  it("judges the weekly ranges under the start in force alone", () => {
    const week: ServiceRange[][] = Array.from({ length: 7 }, () => []);
    week[3] = [{ periodId: "p", startsAt: "22:00", endsAt: "04:30" }];
    const seasons = [{ seasonId: "year", startsOn: "01-01", week }];
    expect(findSeasonEndOffsetClash(seasons, [], offsets, settled)).not.toBeNull();
    expect(findSeasonEndOffsetClash(seasons, [], offsets, settled, weekly)).toBeNull();
  });
});
