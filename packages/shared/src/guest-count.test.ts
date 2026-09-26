import { describe, expect, it } from "vitest";
import { isValidGuestCount, MAX_GUEST_COUNT } from "./guest-count.js";

describe("isValidGuestCount", () => {
  it("accepts every whole number from 1 to the largest party", () => {
    expect(isValidGuestCount(1)).toBe(true);
    expect(isValidGuestCount(4)).toBe(true);
    expect(isValidGuestCount(MAX_GUEST_COUNT)).toBe(true);
  });

  it("refuses a count below 1 or above the largest party", () => {
    expect(isValidGuestCount(0)).toBe(false);
    expect(isValidGuestCount(-1)).toBe(false);
    expect(isValidGuestCount(MAX_GUEST_COUNT + 1)).toBe(false);
  });

  it("refuses a number that is not whole", () => {
    expect(isValidGuestCount(1.5)).toBe(false);
    expect(isValidGuestCount(Number.NaN)).toBe(false);
    expect(isValidGuestCount(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("refuses anything that is not a number, a numeric string included", () => {
    expect(isValidGuestCount("3")).toBe(false);
    expect(isValidGuestCount(true)).toBe(false);
    expect(isValidGuestCount(null)).toBe(false);
    expect(isValidGuestCount(undefined)).toBe(false);
  });
});
