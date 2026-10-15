import { describe, expect, it } from "vitest";
import {
  addBlock,
  changeBlock,
  copyBlocks,
  copyDay,
  deleteBlock,
  laneLayout,
  MAX_BLOCK_MINUTES,
  resizeBlock,
  sameBlock,
  sameBlocks,
} from "./block-model.js";
import { parseBlocks } from "./paint-rules.js";
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

  it("puts the longer of two blocks that start together in the first lane", () => {
    expect(
      laneLayout([block("a", "09:00", "10:00"), block("b", "09:00", "17:00")], "06:00"),
    ).toEqual([
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 2 },
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

  const ROLE = "7d4c1a52-0b8e-4f4e-9a57-3c2f1e6b9d10";
  const accepted = (day: StaffingBlock[], cutover: string) =>
    expect(parseBlocks(day, "blocks", cutover)).toEqual(day);

  it("never lets a block span the whole business day, which the server refuses", () => {
    expect(MAX_BLOCK_MINUTES).toBe(1425);
    const morning = [block(ROLE, "06:00", "12:00")];
    const toEnd = resizeBlock(morning, 0, "end", "06:00", "06:00");
    expect(toEnd).toEqual([block(ROLE, "06:00", "05:45")]);
    accepted(toEnd, "06:00");
    const evening = [block(ROLE, "18:00", "06:00")];
    const toStart = resizeBlock(evening, 0, "start", "06:00", "06:00");
    expect(toStart).toEqual([block(ROLE, "06:15", "06:00")]);
    accepted(toStart, "06:00");
  });

  it("stays on the clock quarter hours when the changeover is not on one", () => {
    // A 05:10 changeover: the day's first quarter hour is 05:15 and its last 05:00.
    const crossing = [block(ROLE, "04:00", "08:00")];
    const moved = resizeBlock(crossing, 0, "start", "03:00", "05:10");
    expect(moved).toEqual([block(ROLE, "03:00", "05:00")]);
    accepted(moved, "05:10");
    const pinned = resizeBlock(crossing, 0, "start", "05:00", "05:10");
    expect(pinned).toEqual([block(ROLE, "04:45", "05:00")]);
    accepted(pinned, "05:10");
    const longest = resizeBlock([block(ROLE, "05:15", "12:00")], 0, "end", "05:00", "05:10");
    expect(longest).toEqual([block(ROLE, "05:15", "05:00")]);
    accepted(longest, "05:10");
    const atChangeover = resizeBlock([block(ROLE, "12:00", "14:00")], 0, "end", "05:10", "05:10");
    expect(atChangeover).toEqual([block(ROLE, "12:00", "05:00")]);
    accepted(atChangeover, "05:10");
  });

  it("moves the start of a kept block on the day's last quarter hour back, as its end has no room", () => {
    // Saved as 06:00–08:00 before the changeover moved to 06:10: 06:00 is the day's last quarter
    // hour, so no end after it is inside the day.
    const kept = [block(ROLE, "06:00", "08:00")];
    const moved = resizeBlock(kept, 0, "end", "05:00", "06:10");
    expect(moved).toEqual([block(ROLE, "05:45", "06:00")]);
    accepted(moved, "06:10");
    expect(resizeBlock(kept, 0, "end", "06:00", "06:10")).toEqual(moved);
  });

  it("answers a block the server accepts for any block and any quarter hour, kept ones included", () => {
    const quarters = Array.from(
      { length: 96 },
      (_, n) =>
        `${String(Math.floor(n / 4)).padStart(2, "0")}:${String((n % 4) * 15).padStart(2, "0")}`,
    );
    for (const cutover of ["06:00", "06:10"]) {
      const refused: string[] = [];
      for (const startsAt of quarters)
        for (const endsAt of quarters) {
          if (startsAt === endsAt) continue;
          const day = [block(ROLE, startsAt, endsAt)];
          for (const edge of ["start", "end"] as const)
            for (const time of edge === "end" ? [...quarters, cutover] : quarters) {
              const resized = resizeBlock(day, 0, edge, time, cutover);
              try {
                parseBlocks(resized, "blocks", cutover);
              } catch {
                refused.push(`${startsAt}–${endsAt} ${edge} to ${time}`);
              }
            }
        }
      expect(refused, cutover).toEqual([]);
    }
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

describe("sameBlocks and copyBlocks", () => {
  const day = [block("sous", "09:00", "15:00"), block("cook", "12:00", "14:00", 2)];

  it("compares each block's staff role, headcount and times, in order", () => {
    expect(sameBlocks(day, structuredClone(day))).toBe(true);
    expect(sameBlocks(day, [day[1]!, day[0]!])).toBe(false);
    expect(sameBlocks(day, day.slice(0, 1))).toBe(false);
    for (const change of [
      { staffRoleId: "cook" },
      { headcount: 3 },
      { startsAt: "09:15" },
      { endsAt: "15:15" },
    ])
      expect(sameBlocks(day, [{ ...day[0]!, ...change }, day[1]!]), JSON.stringify(change)).toBe(
        false,
      );
    expect(sameBlock(day[0], undefined)).toBe(false);
    expect(sameBlock(undefined, undefined)).toBe(false);
  });

  it("holds a null day equal only to another null day, and a missing day equal to an empty one", () => {
    expect(sameBlocks(null, null)).toBe(true);
    expect(sameBlocks(null, [])).toBe(false);
    expect(sameBlocks([], null)).toBe(false);
    expect(sameBlocks(null, undefined)).toBe(false);
    expect(sameBlocks(undefined, null)).toBe(false);
    expect(sameBlocks(undefined, [])).toBe(true);
    expect(sameBlocks([], undefined)).toBe(true);
    expect(sameBlocks(undefined, day)).toBe(false);
  });

  it("copies each block by value and keeps a null day null", () => {
    const copied = copyBlocks(day);
    expect(copied).toEqual(day);
    copied[0]!.headcount = 9;
    expect(day[0]!.headcount).toBe(1);
    expect(copyBlocks(null)).toBeNull();
  });
});
