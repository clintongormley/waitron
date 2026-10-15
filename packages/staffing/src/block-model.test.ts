import { describe, expect, it } from "vitest";
import {
  addBlock,
  changeBlock,
  copyDay,
  deleteBlock,
  laneLayout,
  resizeBlock,
} from "./block-model.js";
import type { StaffingBlock } from "./slots.js";

const block = (
  staffRoleId: string,
  startsAt: string,
  endsAt: string,
  headcount = 1,
): StaffingBlock => ({ staffRoleId, headcount, startsAt, endsAt });

const FRIDAY = [
  block("head-chef", "09:00", "16:30"),
  block("sous", "09:00", "15:00"),
  block("sous", "11:00", "17:00"),
  block("dishwasher", "13:00", "16:30"),
];

describe("laneLayout", () => {
  it("gives the mockup's Friday four lanes, one per block", () => {
    expect(laneLayout(FRIDAY, "06:00")).toEqual([
      { lane: 0, lanes: 4 },
      { lane: 1, lanes: 4 },
      { lane: 2, lanes: 4 },
      { lane: 3, lanes: 4 },
    ]);
  });

  it("lets two blocks that only touch share a lane", () => {
    expect(
      laneLayout([block("sous", "15:00", "17:00"), block("sous", "09:00", "15:00")], "06:00"),
    ).toEqual([
      { lane: 0, lanes: 1 },
      { lane: 0, lanes: 1 },
    ]);
  });

  it("reuses a freed lane inside one overlap group, and counts each group's lanes apart", () => {
    expect(
      laneLayout(
        [
          block("a", "09:00", "15:00"),
          block("b", "12:00", "16:00"),
          block("c", "15:00", "17:00"),
          block("d", "20:00", "22:00"),
        ],
        "06:00",
      ),
    ).toEqual([
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 2 },
      { lane: 0, lanes: 1 },
    ]);
  });

  it("places blocks from the changeover, so one after midnight comes after the evening", () => {
    expect(
      laneLayout([block("a", "01:00", "03:00"), block("b", "22:00", "02:00")], "06:00"),
    ).toEqual([
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 2 },
    ]);
  });

  it("puts identical blocks side by side in their own order", () => {
    const sous = block("sous", "09:00", "15:00");
    expect(laneLayout([sous, { ...sous }], "06:00")).toEqual([
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
    ]);
  });

  it("answers nothing for an empty day", () => {
    expect(laneLayout([], "06:00")).toEqual([]);
  });
});

describe("resizeBlock", () => {
  const day = [block("sous", "09:00", "15:00"), block("cook", "12:00", "14:00")];

  it("moves one edge of the indexed block and leaves the others", () => {
    expect(resizeBlock(day, 0, "end", "16:15", "06:00")).toEqual([
      block("sous", "09:00", "16:15"),
      block("cook", "12:00", "14:00"),
    ]);
    expect(resizeBlock(day, 1, "start", "10:00", "06:00")[1]).toEqual(
      block("cook", "10:00", "14:00"),
    );
  });

  it("keeps a block at least one quarter hour long rather than letting start reach end", () => {
    expect(resizeBlock(day, 0, "start", "15:00", "06:00")[0]).toEqual(
      block("sous", "14:45", "15:00"),
    );
    expect(resizeBlock(day, 0, "start", "18:00", "06:00")[0]).toEqual(
      block("sous", "14:45", "15:00"),
    );
    expect(resizeBlock(day, 0, "end", "08:00", "06:00")[0]).toEqual(
      block("sous", "09:00", "09:15"),
    );
  });

  it("never crosses the changeover: an end at the changeover is the day's end, a start its beginning", () => {
    expect(resizeBlock(day, 0, "end", "06:00", "06:00")[0]).toEqual(
      block("sous", "09:00", "06:00"),
    );
    expect(resizeBlock(day, 0, "start", "06:00", "06:00")[0]).toEqual(
      block("sous", "06:00", "15:00"),
    );
    // 05:00 is just before the changeover, the last hour of the business day, so a start there
    // would sit after the end: it is held one quarter hour before the end instead.
    expect(resizeBlock(day, 0, "start", "05:00", "06:00")[0]).toEqual(
      block("sous", "14:45", "15:00"),
    );
    expect(resizeBlock(day, 0, "end", "05:00", "06:00")[0]).toEqual(
      block("sous", "09:00", "05:00"),
    );
  });

  it("reads a block that crosses the changeover as ending at the day's end", () => {
    const crossing = [block("night", "04:00", "08:00")];
    expect(resizeBlock(crossing, 0, "start", "03:00", "06:00")).toEqual([
      block("night", "03:00", "06:00"),
    ]);
  });

  it("leaves the day unchanged for an index it does not hold, and never edits its input", () => {
    const before = structuredClone(day);
    expect(resizeBlock(day, 5, "end", "20:00", "06:00")).toEqual(day);
    resizeBlock(day, 0, "end", "20:00", "06:00");
    expect(day).toEqual(before);
  });
});

describe("addBlock, changeBlock and deleteBlock", () => {
  it("adds a copy of the block at the end", () => {
    const added = block("cook", "18:00", "23:00", 2);
    const day = addBlock([block("sous", "09:00", "15:00")], added);
    expect(day).toEqual([block("sous", "09:00", "15:00"), block("cook", "18:00", "23:00", 2)]);
    day[1]!.headcount = 9;
    expect(added.headcount).toBe(2);
  });

  it("changes the indexed block's staff role or headcount only", () => {
    const day = [block("sous", "09:00", "15:00"), block("sous", "09:00", "15:00")];
    expect(changeBlock(day, 1, { headcount: 3 })).toEqual([
      block("sous", "09:00", "15:00"),
      block("sous", "09:00", "15:00", 3),
    ]);
    expect(changeBlock(day, 0, { staffRoleId: "cook" })[0]).toEqual(
      block("cook", "09:00", "15:00"),
    );
    expect(changeBlock(day, 4, { headcount: 3 })).toEqual(day);
    expect(day[1]!.headcount).toBe(1);
  });

  it("deletes the indexed block, even among blocks that start together", () => {
    const day = [block("sous", "09:00", "15:00"), block("cook", "09:00", "15:00")];
    expect(deleteBlock(day, 0)).toEqual([block("cook", "09:00", "15:00")]);
    expect(deleteBlock(day, 7)).toEqual(day);
    expect(day).toHaveLength(2);
  });
});

describe("copyDay", () => {
  it("copies one day onto others by value, leaving the source and the rest unchanged", () => {
    const days = new Map<number, StaffingBlock[] | null>([
      [1, [block("sous", "09:00", "15:00")]],
      [2, [block("cook", "12:00", "16:00")]],
      [3, []],
    ]);
    const copied = copyDay(days, 1, [3, 4]);
    expect(copied).toEqual(
      new Map([
        [1, [block("sous", "09:00", "15:00")]],
        [2, [block("cook", "12:00", "16:00")]],
        [3, [block("sous", "09:00", "15:00")]],
        [4, [block("sous", "09:00", "15:00")]],
      ]),
    );
    copied.get(3)![0]!.headcount = 5;
    copied.get(2)![0]!.headcount = 5;
    expect(days.get(1)![0]!.headcount).toBe(1);
    expect(days.get(2)![0]!.headcount).toBe(1);
    expect(copied.get(4)![0]!.headcount).toBe(1);
  });

  it("copies a day that follows the season as following the season", () => {
    const days = new Map<string, StaffingBlock[] | null>([
      ["a", null],
      ["b", [block("sous", "09:00", "15:00")]],
    ]);
    expect(copyDay(days, "a", ["b"])).toEqual(
      new Map([
        ["a", null],
        ["b", null],
      ]),
    );
  });

  it("copies a day it does not hold as an empty day", () => {
    const days = new Map<string, StaffingBlock[] | null>([["b", null]]);
    expect(copyDay(days, "z", ["b"])).toEqual(new Map([["b", []]]));
  });
});
