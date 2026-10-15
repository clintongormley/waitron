import { describe, expect, it } from "vitest";
import { zoneOwnHours } from "./zone-own-hours.js";

const day = { dayCutover: "06:00", endMinute: 1440 };
const range = (periodId: string, startsAt: string, endsAt: string) => ({
  periodId,
  startsAt,
  endsAt,
});
const closure = (startsAt: string, endsAt: string) => ({ startsAt, endsAt });
/** A piece and where it falls, in minutes after the day's changeover. */
const at = <T>(piece: T, start: number, end: number) => ({ ...piece, start, end });

describe("zoneOwnHours", () => {
  it("keeps the department's hours when the zone has no closures", () => {
    const department = [range("lunch", "13:00", "16:00"), range("dinner", "20:00", "23:00")];
    expect(zoneOwnHours(department, [], day)).toEqual({
      ranges: [at(department[0], 420, 600), at(department[1], 840, 1020)],
      closed: [],
    });
  });

  it("splits a block around a closure inside it", () => {
    expect(
      zoneOwnHours([range("dinner", "20:00", "23:00")], [closure("21:00", "22:00")], day),
    ).toEqual({
      ranges: [
        at(range("dinner", "20:00", "21:00"), 840, 900),
        at(range("dinner", "22:00", "23:00"), 960, 1020),
      ],
      closed: [at(closure("21:00", "22:00"), 900, 960)],
    });
  });

  it("removes a block a closure covers", () => {
    expect(
      zoneOwnHours(
        [range("lunch", "13:00", "16:00"), range("dinner", "20:00", "23:00")],
        [closure("19:00", "23:30")],
        day,
      ),
    ).toEqual({
      ranges: [at(range("lunch", "13:00", "16:00"), 420, 600)],
      closed: [at(closure("20:00", "23:00"), 840, 1020)],
    });
  });

  it("cuts a closure past the department's close to the close", () => {
    expect(
      zoneOwnHours([range("open", "18:15", "02:00")], [closure("23:00", "05:00")], day),
    ).toEqual({
      ranges: [at(range("open", "18:15", "23:00"), 735, 1020)],
      closed: [at(closure("23:00", "02:00"), 1020, 1200)],
    });
  });

  it("trims both blocks a closure spans", () => {
    expect(
      zoneOwnHours(
        [range("lunch", "13:00", "16:00"), range("dinner", "20:00", "23:00")],
        [closure("15:00", "21:00")],
        day,
      ),
    ).toEqual({
      ranges: [
        at(range("lunch", "13:00", "15:00"), 420, 540),
        at(range("dinner", "21:00", "23:00"), 900, 1020),
      ],
      closed: [at(closure("15:00", "16:00"), 540, 600), at(closure("20:00", "21:00"), 840, 900)],
    });
  });

  it("leaves no closed piece for a closure wholly outside the hours", () => {
    expect(
      zoneOwnHours([range("open", "10:00", "23:00")], [closure("03:00", "05:00")], day),
    ).toEqual({ ranges: [at(range("open", "10:00", "23:00"), 240, 1020)], closed: [] });
  });

  it("trims a range ending at the changeover", () => {
    expect(
      zoneOwnHours([range("open", "18:00", "06:00")], [closure("05:00", "06:00")], day),
    ).toEqual({
      ranges: [at(range("open", "18:00", "05:00"), 720, 1380)],
      closed: [at(closure("05:00", "06:00"), 1380, 1440)],
    });
  });

  it("places times past the changeover on a 25-hour day", () => {
    expect(
      zoneOwnHours([range("open", "22:00", "07:00")], [closure("05:00", "07:00")], {
        dayCutover: "06:00",
        endMinute: 1500,
      }),
    ).toEqual({
      ranges: [at(range("open", "22:00", "05:00"), 960, 1380)],
      closed: [at(closure("05:00", "07:00"), 1380, 1500)],
    });
  });

  it("places a piece past the changeover at the end of a 25-hour day, its times as written", () => {
    const own = zoneOwnHours([range("dinner", "22:00", "07:00")], [closure("05:00", "06:00")], {
      dayCutover: "06:00",
      endMinute: 1500,
    });
    expect(own.ranges).toEqual([
      { ...range("dinner", "22:00", "05:00"), start: 960, end: 1380 },
      { ...range("dinner", "06:00", "07:00"), start: 1440, end: 1500 },
    ]);
    expect(own.closed).toEqual([{ ...closure("05:00", "06:00"), start: 1380, end: 1440 }]);
  });

  it("caps times at the end of a 23-hour day", () => {
    expect(
      zoneOwnHours([range("open", "22:00", "06:00")], [closure("04:00", "05:30")], {
        dayCutover: "06:00",
        endMinute: 1380,
      }),
    ).toEqual({
      ranges: [at(range("open", "22:00", "04:00"), 960, 1320)],
      closed: [at(closure("04:00", "06:00"), 1320, 1380)],
    });
  });

  it("lists closures given out of day order in day order", () => {
    expect(
      zoneOwnHours(
        [range("dinner", "20:00", "23:00")],
        [closure("22:00", "22:30"), closure("20:30", "21:00")],
        day,
      ),
    ).toEqual({
      ranges: [
        at(range("dinner", "20:00", "20:30"), 840, 870),
        at(range("dinner", "21:00", "22:00"), 900, 960),
        at(range("dinner", "22:30", "23:00"), 990, 1020),
      ],
      closed: [at(closure("20:30", "21:00"), 870, 900), at(closure("22:00", "22:30"), 960, 990)],
    });
  });

  it("gives a closed department no hours and no closed pieces, whatever the closures", () => {
    expect(zoneOwnHours([], [closure("09:00", "00:00"), closure("03:00", "05:00")], day)).toEqual({
      ranges: [],
      closed: [],
    });
  });

  it("closes the zone for its department's whole day", () => {
    expect(
      zoneOwnHours([range("open", "10:00", "23:00")], [closure("09:00", "00:00")], day),
    ).toEqual({ ranges: [], closed: [at(closure("10:00", "23:00"), 240, 1020)] });
    expect(
      zoneOwnHours(
        [range("lunch", "13:00", "16:00"), range("dinner", "20:00", "23:00")],
        [closure("09:00", "00:00")],
        day,
      ),
    ).toEqual({
      ranges: [],
      closed: [at(closure("13:00", "16:00"), 420, 600), at(closure("20:00", "23:00"), 840, 1020)],
    });
  });
});
