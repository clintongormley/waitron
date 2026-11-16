import { describe, expect, it } from "vitest";
import { byMoment, earliestTime, latestTime } from "./time-order.js";

// 10:30+01:00 is 09:30Z, earlier than 10:00Z, though it sorts after it as text.
const zulu = "2026-11-16T10:00:00.000Z";
const offset = "2026-11-16T10:30:00+01:00";

describe("earliestTime and latestTime", () => {
  it("compare stored times as moments and return the winner as stored", () => {
    expect(earliestTime([zulu, offset])).toBe(offset);
    expect(earliestTime([offset, zulu])).toBe(offset);
    expect(latestTime([zulu, offset])).toBe(zulu);
    expect(latestTime([offset, zulu])).toBe(zulu);
  });

  it("never let an unparseable time win over a parseable one, in either order", () => {
    expect(earliestTime(["bad", zulu])).toBe(zulu);
    expect(earliestTime([zulu, "bad"])).toBe(zulu);
    expect(latestTime(["bad", zulu])).toBe(zulu);
    expect(latestTime([zulu, "bad"])).toBe(zulu);
    expect(earliestTime(["bad", offset, "worse", zulu])).toBe(offset);
    expect(latestTime(["bad", offset, "worse", zulu])).toBe(zulu);
  });

  it("break a tie by text, so either list order gives the same winner", () => {
    // Both name 09:30Z; as text the Z spelling is the smaller.
    const sameAsOffset = "2026-11-16T09:30:00.000Z";
    for (const times of [
      [sameAsOffset, offset],
      [offset, sameAsOffset],
    ]) {
      expect(earliestTime(times)).toBe(sameAsOffset);
      expect(latestTime(times)).toBe(offset);
    }
    for (const times of [
      ["bad", "worse"],
      ["worse", "bad"],
    ]) {
      expect(earliestTime(times)).toBe("bad");
      expect(latestTime(times)).toBe("worse");
    }
  });

  it("return nothing for no times", () => {
    expect(earliestTime([])).toBeUndefined();
    expect(latestTime([])).toBeUndefined();
  });
});

describe("byMoment", () => {
  const sorted = (times: (string | null)[]) => [...times].sort(byMoment);

  it("orders stored times as moments, whatever their spelling", () => {
    expect(sorted([zulu, offset])).toEqual([offset, zulu]);
    expect(sorted([offset, zulu])).toEqual([offset, zulu]);
  });

  it("puts no time first and an unparseable time after every parseable one, in either order", () => {
    expect(sorted(["bad", zulu, null, offset])).toEqual([null, offset, zulu, "bad"]);
    expect(sorted([offset, null, zulu, "bad"])).toEqual([null, offset, zulu, "bad"]);
    expect(sorted(["worse", "bad"])).toEqual(["bad", "worse"]);
  });

  it("calls two spellings of one moment equal", () => {
    expect(byMoment("2026-11-16T09:30:00.000Z", offset)).toBe(0);
    expect(byMoment(null, null)).toBe(0);
  });
});
