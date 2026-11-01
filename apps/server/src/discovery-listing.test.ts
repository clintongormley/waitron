import { describe, expect, it } from "vitest";
import { DISCOVERED_TTL_MS, isListed, withinTtl } from "./discovery-listing.js";

const DAY = 86_400_000;

describe("a report's freshness across a backward clock step", () => {
  it.each([
    ["400 days ahead", 1_000 + 400 * DAY, false],
    ["its limit ahead exactly", 1_000 + DISCOVERED_TTL_MS, true],
    ["a millisecond past its limit ahead", 1_000 + DISCOVERED_TTL_MS + 1, false],
  ])(
    "lists a report stamped ahead of the clock only within its limit (%s)",
    (_case, at, listed) => {
      expect(isListed(at, 1_000, 0)).toBe(listed);
      expect(withinTtl(at, 1_000, DISCOVERED_TTL_MS)).toBe(listed);
    },
  );

  it("an open window's longer limit also bounds a report stamped ahead", () => {
    expect(isListed(1_000 + DISCOVERED_TTL_MS + 1, 1_000, 2_000)).toBe(true);
    expect(isListed(1_000 + 400 * DAY, 1_000, 2_000)).toBe(false);
  });
});
