import { describe, expect, it } from "vitest";
import {
  findEndOffsetClash,
  findScheduleEndOffsetClash,
  periodOrderCutoff,
} from "./period-end-offset.js";

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
