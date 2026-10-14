import { describe, expect, it } from "vitest";
import {
  areaKey,
  blockSpan,
  matchAreaDay,
  minuteOfServiceDay,
  placeShift,
  slotsForDay,
  type AreaRef,
  type PlacedShift,
} from "./slots.js";

const KITCHEN: AreaRef = { kind: "station", id: "s1" };
const block = (staffRoleId: string, headcount: number, startsAt: string, endsAt: string) => ({
  staffRoleId,
  headcount,
  startsAt,
  endsAt,
});

function placed(
  shiftId: string,
  startsAt: string,
  endsAt: string,
  staffRoleId: string | null = "sous",
): PlacedShift {
  const { start, end } = blockSpan({ startsAt, endsAt }, "06:00");
  return {
    shiftId,
    personId: `p-${shiftId}`,
    startsAt: `2026-12-04T${startsAt}:00Z`,
    startsOffsetMinutes: 0,
    endsAt: `2026-12-04T${endsAt}:00Z`,
    endsOffsetMinutes: 0,
    area: KITCHEN,
    staffRoleId,
    businessDay: "2026-12-04",
    start,
    end,
  };
}

describe("areaKey and minuteOfServiceDay", () => {
  it("names an area by kind and id", () => {
    expect(areaKey({ kind: "department", id: "d1" })).toBe("department:d1");
    expect(areaKey(KITCHEN)).toBe("station:s1");
  });
  it("counts minutes from the changeover, wrapping past midnight", () => {
    expect(minuteOfServiceDay("06:00", "06:00")).toBe(0);
    expect(minuteOfServiceDay("05:45", "06:00")).toBe(1425);
    expect(minuteOfServiceDay("00:15", "06:00")).toBe(1095);
  });
});

describe("slotsForDay", () => {
  it("makes one slot per person a block asks for, with business-day minutes", () => {
    const slots = slotsForDay("2026-12-04", KITCHEN, [block("sous", 2, "08:00", "14:00")], "06:00");
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({
      staffRoleId: "sous",
      start: 120,
      end: 480,
      startsAt: "08:00",
      endsAt: "14:00",
      businessDay: "2026-12-04",
      area: KITCHEN,
    });
    expect(new Set(slots.map((s) => s.key)).size).toBe(2);
  });
  it("places a block running to the changeover at minute 1440 and past midnight after 1080", () => {
    const [late] = slotsForDay("2026-12-04", KITCHEN, [block("dw", 1, "20:00", "06:00")], "06:00");
    expect(late).toMatchObject({ start: 840, end: 1440 });
    const [night] = slotsForDay("2026-12-04", KITCHEN, [block("dw", 1, "23:00", "01:30")], "06:00");
    expect(night).toMatchObject({ start: 1020, end: 1170 });
  });
  it("ends a block that crosses a new changeover at the changeover", () => {
    // Saved as 05:00–07:00 under a 04:00 changeover, read under 06:00.
    const [slot] = slotsForDay("2026-12-04", KITCHEN, [block("dw", 1, "05:00", "07:00")], "06:00");
    expect(slot).toMatchObject({ start: 1380, end: 1440, startsAt: "05:00", endsAt: "07:00" });
  });
  it("orders slots by start, then staff role, then key", () => {
    const slots = slotsForDay(
      "2026-12-04",
      KITCHEN,
      [
        block("sous", 1, "10:00", "12:00"),
        block("dw", 1, "08:00", "10:00"),
        block("chef", 2, "10:00", "14:00"),
      ],
      "06:00",
    );
    expect(slots.map((s) => [s.staffRoleId, s.key])).toEqual([
      ["dw", "2026-12-04|station:s1|1|0"],
      ["chef", "2026-12-04|station:s1|2|0"],
      ["chef", "2026-12-04|station:s1|2|1"],
      ["sous", "2026-12-04|station:s1|0|0"],
    ]);
  });
});

describe("placeShift", () => {
  const cutover = () => "06:00";
  it("puts a 01:00 Monday start on Sunday's business day", () => {
    const placedShift = placeShift(
      {
        shiftId: "x",
        personId: "p",
        startsAt: "2026-11-30T00:00:00Z",
        startsOffsetMinutes: 60,
        endsAt: "2026-11-30T04:00:00Z",
        endsOffsetMinutes: 60,
        area: KITCHEN,
        staffRoleId: "sous",
      },
      cutover,
    );
    expect(placedShift).toMatchObject({
      shiftId: "x",
      businessDay: "2026-11-29",
      start: 1140,
      end: 1380,
    });
  });
  it("lets a shift run past the changeover (end above 1440)", () => {
    // Friday 22:00 to Saturday 08:00 on the wall.
    const placedShift = placeShift(
      {
        shiftId: "y",
        personId: "p",
        startsAt: "2026-12-04T21:00:00Z",
        startsOffsetMinutes: 60,
        endsAt: "2026-12-05T07:00:00Z",
        endsOffsetMinutes: 60,
        area: KITCHEN,
        staffRoleId: "sous",
      },
      cutover,
    );
    expect(placedShift).toMatchObject({ businessDay: "2026-12-04", start: 960, end: 1560 });
  });
  it("uses the cutover of the shift's own business day when the clock changed", () => {
    // Saturday 03:00 on the wall: before Saturday's 04:00 changeover, so it belongs to Friday,
    // whose changeover is 02:00.
    const cutoverFor = (day: string) => (day === "2026-12-05" ? "04:00" : "02:00");
    const placedShift = placeShift(
      {
        shiftId: "z",
        personId: "p",
        startsAt: "2026-12-05T02:00:00Z",
        startsOffsetMinutes: 60,
        endsAt: "2026-12-05T04:00:00Z",
        endsOffsetMinutes: 60,
        area: KITCHEN,
        staffRoleId: "sous",
      },
      cutoverFor,
    );
    expect(placedShift).toMatchObject({ businessDay: "2026-12-04", start: 60, end: 180 });
  });
  it("measures length on the wall clock across the spring-forward night", () => {
    // Europe/Madrid, 2027-03-28: 22:00 (+60) to 04:00 (+120) is 5 elapsed hours, 6 on the wall.
    const placedShift = placeShift(
      {
        shiftId: "n",
        personId: "p",
        startsAt: "2027-03-27T21:00:00Z",
        startsOffsetMinutes: 60,
        endsAt: "2027-03-28T02:00:00Z",
        endsOffsetMinutes: 120,
        area: KITCHEN,
        staffRoleId: "sous",
      },
      cutover,
    );
    expect(placedShift).toMatchObject({ businessDay: "2027-03-27", start: 960, end: 1320 });
  });
});

describe("matchAreaDay", () => {
  const holdsAll = () => true;
  it("pairs staggered shifts with the staggered slots they were meant for", () => {
    const slots = slotsForDay(
      "2026-12-04",
      KITCHEN,
      [block("sous", 1, "08:00", "14:00"), block("sous", 1, "10:00", "16:00")],
      "06:00",
    );
    const shifts = [placed("a", "08:00", "14:00"), placed("b", "10:00", "16:00")];
    const match = matchAreaDay(slots, shifts, holdsAll);
    expect(match.slots.map((s) => s.status)).toEqual([
      { kind: "filled", shiftId: "a", outsideRole: false },
      { kind: "filled", shiftId: "b", outsideRole: false },
    ]);
    expect(match.over).toEqual([]);
  });
  it("reports the part of a slot a short shift leaves uncovered", () => {
    const late = slotsForDay("2026-12-04", KITCHEN, [block("sous", 1, "11:00", "17:00")], "06:00");
    const lateMatch = matchAreaDay(late, [placed("a", "11:00", "14:00")], holdsAll);
    expect(lateMatch.slots.map((s) => s.status)).toEqual([
      {
        kind: "partly_uncovered",
        shiftId: "a",
        outsideRole: false,
        uncovered: [{ start: 480, end: 660 }],
      },
    ]);
    const early = slotsForDay("2026-12-04", KITCHEN, [block("sous", 1, "08:00", "12:00")], "06:00");
    const earlyMatch = matchAreaDay(early, [placed("b", "09:00", "11:00")], holdsAll);
    expect(earlyMatch.slots.map((s) => s.status)).toEqual([
      {
        kind: "partly_uncovered",
        shiftId: "b",
        outsideRole: false,
        uncovered: [
          { start: 120, end: 180 },
          { start: 300, end: 360 },
        ],
      },
    ]);
  });
  it("reports a slot with no shift as unfilled and a shift with no slot as over", () => {
    const slots = slotsForDay(
      "2026-12-04",
      KITCHEN,
      [block("sous", 1, "08:00", "14:00"), block("dw", 1, "16:00", "20:00")],
      "06:00",
    );
    const shifts = [
      placed("d", "15:00", "18:00"),
      placed("c", "09:00", "13:00"),
      placed("a", "08:00", "14:00"),
    ];
    const match = matchAreaDay(slots, shifts, holdsAll);
    expect(match.slots.map((s) => [s.slot.staffRoleId, s.status])).toEqual([
      ["sous", { kind: "filled", shiftId: "a", outsideRole: false }],
      ["dw", { kind: "unfilled" }],
    ]);
    expect(match.over).toEqual(["c", "d"]);
  });
  it("prefers the earlier shift when two cover a slot equally", () => {
    const slots = slotsForDay("2026-12-04", KITCHEN, [block("sous", 1, "08:00", "14:00")], "06:00");
    const match = matchAreaDay(
      slots,
      [placed("b", "09:00", "14:00"), placed("a", "07:00", "13:00")],
      holdsAll,
    );
    expect(match.slots.map((s) => s.status)).toEqual([
      {
        kind: "partly_uncovered",
        shiftId: "a",
        outsideRole: false,
        uncovered: [{ start: 420, end: 480 }],
      },
    ]);
    expect(match.over).toEqual(["b"]);
  });
  it("marks a shift whose person does not hold the staff role as outside role", () => {
    const slots = slotsForDay("2026-12-04", KITCHEN, [block("sous", 1, "08:00", "14:00")], "06:00");
    const holds = (personId: string, staffRoleId: string) =>
      personId === "p-a" && staffRoleId === "sous";
    expect(matchAreaDay(slots, [placed("a", "08:00", "14:00")], holds).slots[0]?.status).toEqual({
      kind: "filled",
      shiftId: "a",
      outsideRole: false,
    });
    expect(matchAreaDay(slots, [placed("b", "08:00", "14:00")], holds).slots[0]?.status).toEqual({
      kind: "filled",
      shiftId: "b",
      outsideRole: true,
    });
  });
  it("never pairs across staff roles", () => {
    const slots = slotsForDay("2026-12-04", KITCHEN, [block("sous", 1, "08:00", "14:00")], "06:00");
    const match = matchAreaDay(
      slots,
      [placed("a", "08:00", "14:00", "dw"), placed("b", "08:00", "14:00", null)],
      holdsAll,
    );
    expect(match.slots.map((s) => s.status)).toEqual([{ kind: "unfilled" }]);
    expect(match.over).toEqual(["a", "b"]);
  });
  it("breaks ties the same way whatever order the shifts arrive in", () => {
    const slots = slotsForDay("2026-12-04", KITCHEN, [block("sous", 3, "08:00", "14:00")], "06:00");
    const [x, y, z] = ["x", "y", "z"].map((id) => placed(id, "08:00", "14:00")) as [
      PlacedShift,
      PlacedShift,
      PlacedShift,
    ];
    const orders = [
      [x, y, z],
      [x, z, y],
      [y, x, z],
      [y, z, x],
      [z, x, y],
      [z, y, x],
    ];
    for (const order of orders) {
      const match = matchAreaDay(slots, order, holdsAll);
      expect(match.slots.map((s) => [s.slot.key, s.status])).toEqual([
        ["2026-12-04|station:s1|0|0", { kind: "filled", shiftId: "x", outsideRole: false }],
        ["2026-12-04|station:s1|0|1", { kind: "filled", shiftId: "y", outsideRole: false }],
        ["2026-12-04|station:s1|0|2", { kind: "filled", shiftId: "z", outsideRole: false }],
      ]);
      expect(match.over).toEqual([]);
    }
  });
});
