import { describe, expect, it } from "vitest";
import { zoneOwnHours } from "./zone-own-hours.js";

const day = { dayCutover: "06:00", endMinute: 1440 };
const range = (periodId: string, startsAt: string, endsAt: string) => ({
  periodId,
  startsAt,
  endsAt,
});
const closure = (startsAt: string, endsAt: string) => ({ startsAt, endsAt });

describe("zoneOwnHours", () => {
  it("keeps the department's hours when the zone has no closures", () => {
    const department = [range("lunch", "13:00", "16:00"), range("dinner", "20:00", "23:00")];
    expect(zoneOwnHours(department, [], day)).toEqual({ ranges: department, closed: [] });
  });

  it("splits a block around a closure inside it", () => {
    expect(
      zoneOwnHours([range("dinner", "20:00", "23:00")], [closure("21:00", "22:00")], day),
    ).toEqual({
      ranges: [range("dinner", "20:00", "21:00"), range("dinner", "22:00", "23:00")],
      closed: [closure("21:00", "22:00")],
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
      ranges: [range("lunch", "13:00", "16:00")],
      closed: [closure("20:00", "23:00")],
    });
  });

  it("cuts a closure past the department's close to the close (the Terrace case)", () => {
    expect(
      zoneOwnHours([range("open", "18:15", "02:00")], [closure("23:00", "05:00")], day),
    ).toEqual({
      ranges: [range("open", "18:15", "23:00")],
      closed: [closure("23:00", "02:00")],
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
      ranges: [range("lunch", "13:00", "15:00"), range("dinner", "21:00", "23:00")],
      closed: [closure("15:00", "16:00"), closure("20:00", "21:00")],
    });
  });

  it("leaves no closed piece for a closure wholly outside the hours", () => {
    expect(
      zoneOwnHours([range("open", "10:00", "23:00")], [closure("03:00", "05:00")], day),
    ).toEqual({ ranges: [range("open", "10:00", "23:00")], closed: [] });
  });

  it("trims a range ending at the changeover", () => {
    expect(
      zoneOwnHours([range("open", "18:00", "06:00")], [closure("05:00", "06:00")], day),
    ).toEqual({
      ranges: [range("open", "18:00", "05:00")],
      closed: [closure("05:00", "06:00")],
    });
  });

  it("places times past the changeover on a 25-hour day", () => {
    expect(
      zoneOwnHours([range("open", "22:00", "07:00")], [closure("05:00", "07:00")], {
        dayCutover: "06:00",
        endMinute: 1500,
      }),
    ).toEqual({
      ranges: [range("open", "22:00", "05:00")],
      closed: [closure("05:00", "07:00")],
    });
  });

  it("caps times at the end of a 23-hour day", () => {
    expect(
      zoneOwnHours([range("open", "22:00", "06:00")], [closure("04:00", "05:30")], {
        dayCutover: "06:00",
        endMinute: 1380,
      }),
    ).toEqual({
      ranges: [range("open", "22:00", "04:00")],
      closed: [closure("04:00", "06:00")],
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
        range("dinner", "20:00", "20:30"),
        range("dinner", "21:00", "22:00"),
        range("dinner", "22:30", "23:00"),
      ],
      closed: [closure("20:30", "21:00"), closure("22:00", "22:30")],
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
    ).toEqual({ ranges: [], closed: [closure("10:00", "23:00")] });
    expect(
      zoneOwnHours(
        [range("lunch", "13:00", "16:00"), range("dinner", "20:00", "23:00")],
        [closure("09:00", "00:00")],
        day,
      ),
    ).toEqual({
      ranges: [],
      closed: [closure("13:00", "16:00"), closure("20:00", "23:00")],
    });
  });
});
