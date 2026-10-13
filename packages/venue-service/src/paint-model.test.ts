import { describe, expect, it } from "vitest";
import {
  changeBlockPeriod,
  copyDay,
  deleteBlock,
  paintStretch,
  stepAt,
  type Paint,
} from "./paint-model.js";

const LUNCH = "lunch";
const AFTERNOON = "afternoon";
const BREAKFAST = "breakfast";
const paint = (periodId: string | null, startsAt: string, endsAt: string): Paint => ({
  periodId,
  startsAt,
  endsAt,
});

describe("paintStretch", () => {
  it("a stretch dragged over the end of a block replaces that end", () => {
    const day = [paint(LUNCH, "13:00", "16:00")];
    expect(paintStretch(day, paint(AFTERNOON, "15:00", "20:00"), "06:00", true)).toEqual([
      paint(LUNCH, "13:00", "15:00"),
      paint(AFTERNOON, "15:00", "20:00"),
    ]);
    expect(day).toEqual([paint(LUNCH, "13:00", "16:00")]);
  });

  it("two touching stretches of one period become one block", () => {
    const once = paintStretch([], paint(BREAKFAST, "08:00", "10:00"), "06:00", true);
    expect(paintStretch(once, paint(BREAKFAST, "10:00", "12:00"), "06:00", true)).toEqual([
      paint(BREAKFAST, "08:00", "12:00"),
    ]);
  });

  it("a stretch inside a block splits it in two", () => {
    expect(
      paintStretch(
        [paint(LUNCH, "12:00", "16:00")],
        paint(AFTERNOON, "13:00", "14:00"),
        "06:00",
        true,
      ),
    ).toEqual([
      paint(LUNCH, "12:00", "13:00"),
      paint(AFTERNOON, "13:00", "14:00"),
      paint(LUNCH, "14:00", "16:00"),
    ]);
  });

  it("orders blocks from the changeover, so a block after midnight comes last", () => {
    const day = [paint(LUNCH, "00:00", "02:00")];
    expect(paintStretch(day, paint(AFTERNOON, "20:00", "00:00"), "06:00", true)).toEqual([
      paint(AFTERNOON, "20:00", "00:00"),
      paint(LUNCH, "00:00", "02:00"),
    ]);
  });

  it("a stretch ending at the changeover runs to the end of the business day", () => {
    expect(paintStretch([], paint(LUNCH, "20:00", "06:00"), "06:00", true)).toEqual([
      paint(LUNCH, "20:00", "06:00"),
    ]);
  });

  it("Closed in a season week erases what is under it", () => {
    const day = [paint(LUNCH, "12:00", "16:00")];
    expect(paintStretch(day, paint(null, "14:00", "18:00"), "06:00", true)).toEqual([
      paint(LUNCH, "12:00", "14:00"),
    ]);
  });

  it("Closed on a special day or a zone is stored, and touching Closed joins", () => {
    const day = [paint(LUNCH, "12:00", "16:00")];
    const closed = paintStretch(day, paint(null, "14:00", "18:00"), "06:00", false);
    expect(closed).toEqual([paint(LUNCH, "12:00", "14:00"), paint(null, "14:00", "18:00")]);
    expect(paintStretch(closed, paint(null, "18:00", "19:00"), "06:00", false)).toEqual([
      paint(LUNCH, "12:00", "14:00"),
      paint(null, "14:00", "19:00"),
    ]);
  });

  it("a same-period stretch after midnight joins the block before midnight", () => {
    const day = [paint(LUNCH, "20:00", "00:30")];
    expect(paintStretch(day, paint(LUNCH, "00:30", "02:00"), "06:00", true)).toEqual([
      paint(LUNCH, "20:00", "02:00"),
    ]);
  });

  it("blocks of one period at the two ends of the business day stay apart", () => {
    const day = [paint(LUNCH, "05:00", "06:00")];
    expect(paintStretch(day, paint(LUNCH, "06:00", "07:00"), "06:00", true)).toEqual([
      paint(LUNCH, "06:00", "07:00"),
      paint(LUNCH, "05:00", "06:00"),
    ]);
  });

  it("an upward drag paints the same stretch as a downward one", () => {
    const day = [paint(LUNCH, "13:00", "16:00")];
    expect(paintStretch(day, paint(AFTERNOON, "14:00", "12:00"), "06:00", true)).toEqual([
      paint(AFTERNOON, "12:00", "14:00"),
      paint(LUNCH, "14:00", "16:00"),
    ]);
  });

  it("an upward drag ending past midnight is ordered from the changeover", () => {
    expect(paintStretch([], paint(LUNCH, "01:00", "22:00"), "06:00", true)).toEqual([
      paint(LUNCH, "22:00", "01:00"),
    ]);
  });

  it("Closed that erases also removes Closed already stored under it", () => {
    expect(
      paintStretch([paint(null, "10:00", "12:00")], paint(null, "11:00", "13:00"), "06:00", true),
    ).toEqual([paint(null, "10:00", "11:00")]);
  });
});

describe("deleteBlock", () => {
  const day = [paint(LUNCH, "12:00", "14:00"), paint(null, "14:00", "16:00")];

  it("removes the block at the index", () => {
    expect(deleteBlock(day, 1)).toEqual([paint(LUNCH, "12:00", "14:00")]);
    expect(deleteBlock(day, 0)).toEqual([paint(null, "14:00", "16:00")]);
    expect(day).toHaveLength(2);
  });

  it("returns the day unchanged for an index with no block", () => {
    expect(deleteBlock(day, 2)).toEqual(day);
    expect(deleteBlock(day, -1)).toEqual(day);
    expect(deleteBlock(day, 2)).not.toBe(day);
  });
});

describe("changeBlockPeriod", () => {
  it("changes a block's period and joins it with a touching block of the new period", () => {
    const day = [paint(LUNCH, "12:00", "14:00"), paint(AFTERNOON, "14:00", "16:00")];
    expect(changeBlockPeriod(day, 1, LUNCH, "06:00", true)).toEqual([
      paint(LUNCH, "12:00", "16:00"),
    ]);
    expect(changeBlockPeriod(day, 0, BREAKFAST, "06:00", true)).toEqual([
      paint(BREAKFAST, "12:00", "14:00"),
      paint(AFTERNOON, "14:00", "16:00"),
    ]);
  });

  it("a block changed to Closed is kept as Closed", () => {
    const day = [paint(LUNCH, "12:00", "14:00"), paint(null, "14:00", "16:00")];
    expect(changeBlockPeriod(day, 0, null, "06:00", false)).toEqual([
      paint(null, "12:00", "16:00"),
    ]);
  });

  it("in a department column a block changed to Closed is removed", () => {
    const day = [paint(LUNCH, "12:00", "14:00"), paint(AFTERNOON, "14:00", "16:00")];
    expect(changeBlockPeriod(day, 0, null, "06:00", true)).toEqual([
      paint(AFTERNOON, "14:00", "16:00"),
    ]);
    expect(changeBlockPeriod([paint(LUNCH, "12:00", "14:00")], 0, null, "06:00", true)).toEqual([]);
  });

  it("returns the day unchanged for an index with no block", () => {
    const day = [paint(LUNCH, "12:00", "14:00")];
    expect(changeBlockPeriod(day, 3, AFTERNOON, "06:00", true)).toEqual(day);
    expect(changeBlockPeriod(day, -1, AFTERNOON, "06:00", false)).toEqual(day);
  });
});

describe("copyDay", () => {
  it("copies one day to others by value and leaves the rest alone", () => {
    const tuesday = [paint(LUNCH, "12:00", "16:00")];
    const sunday = [paint(BREAKFAST, "08:00", "10:00")];
    const days = new Map<string, readonly Paint[]>([
      ["2", tuesday],
      ["3", [paint(AFTERNOON, "16:00", "20:00")]],
      ["7", sunday],
    ]);
    const copied = copyDay(days, "2", ["3", "4", "5", "6"]);
    for (const weekday of ["2", "3", "4", "5", "6"])
      expect(copied.get(weekday)).toEqual([paint(LUNCH, "12:00", "16:00")]);
    expect(copied.get("7")).toEqual(sunday);
    expect(copied.size).toBe(6);

    copied.get("4")![0]!.endsAt = "23:00";
    copied.get("3")!.push(paint(null, "20:00", "21:00"));
    expect(tuesday).toEqual([paint(LUNCH, "12:00", "16:00")]);
    expect(copied.get("2")).toEqual([paint(LUNCH, "12:00", "16:00")]);
    expect(copied.get("5")).toEqual([paint(LUNCH, "12:00", "16:00")]);
    copied.get("7")![0]!.startsAt = "09:00";
    expect(sunday).toEqual([paint(BREAKFAST, "08:00", "10:00")]);
  });

  it("copying a day with nothing in it empties the days named", () => {
    const days = new Map<string, readonly Paint[]>([["3", [paint(LUNCH, "12:00", "16:00")]]]);
    expect(copyDay(days, "1", ["3"]).get("3")).toEqual([]);
  });
});

describe("stepAt", () => {
  it("row 0 is the changeover and each row is 15 minutes", () => {
    expect(stepAt(0, 10, "06:00")).toBe("06:00");
    expect(stepAt(10, 10, "06:00")).toBe("06:15");
    expect(stepAt(40, 10, "06:00")).toBe("07:00");
    expect(stepAt(18 * 4 * 10 + 20, 10, "06:00")).toBe("00:30");
  });

  it("snaps to the nearest row line", () => {
    expect(stepAt(4, 10, "06:00")).toBe("06:00");
    expect(stepAt(5, 10, "06:00")).toBe("06:15");
    expect(stepAt(14, 10, "06:00")).toBe("06:15");
  });

  it("clamps above the day to the changeover and below it to the next changeover", () => {
    expect(stepAt(-50, 10, "06:00")).toBe("06:00");
    expect(stepAt(96 * 10, 10, "06:00")).toBe("06:00");
    expect(stepAt(5000, 10, "05:30")).toBe("05:30");
    expect(stepAt(95 * 10, 10, "05:30")).toBe("05:15");
  });

  it("on a changeover off the quarter hour, snaps to the clock's quarter hours inside the day", () => {
    expect(stepAt(0, 10, "05:50")).toBe("06:00");
    expect(stepAt(-30, 10, "05:50")).toBe("06:00");
    expect(stepAt(10, 10, "05:50")).toBe("06:00");
    expect(stepAt(14, 10, "05:50")).toBe("06:15");
    expect(stepAt(40, 10, "05:50")).toBe("06:45");
    expect(stepAt(96 * 10, 10, "05:50")).toBe("05:45");
    expect(stepAt(5000, 10, "05:50")).toBe("05:45");
  });

  it("a row with no height answers the first row line", () => {
    expect(stepAt(40, 0, "06:00")).toBe("06:00");
    expect(stepAt(40, 0, "05:50")).toBe("06:00");
    expect(stepAt(40, -10, "06:00")).toBe("06:00");
  });
});
