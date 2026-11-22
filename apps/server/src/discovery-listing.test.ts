import { describe, expect, it } from "vitest";
import { isListed } from "./discovery-listing.js";

describe("discovery report freshness", () => {
  it("leaves a device without a report unlisted", () => {
    expect(isListed(undefined, 1_000, 90_000)).toBe(false);
  });

  it("lists a report through fifteen seconds with the window closed", () => {
    expect(isListed(1_000, 16_000, 0)).toBe(true);
    expect(isListed(1_000, 16_001, 0)).toBe(false);
  });

  it("lists a report through forty-five seconds with the window open", () => {
    expect(isListed(1_000, 46_000, 90_000)).toBe(true);
    expect(isListed(1_000, 46_001, 90_000)).toBe(false);
  });

  it("uses the shorter age limit as soon as the window closes", () => {
    expect(isListed(1_000, 21_000, 21_001)).toBe(true);
    expect(isListed(1_000, 21_001, 21_001)).toBe(false);
  });
});
